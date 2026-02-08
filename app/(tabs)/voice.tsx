import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  Alert,
  Image,
  LayoutAnimation,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Sparkles, Mic, MessageSquare, WifiOff } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useOrderStore, useTunaSpecialistStore } from '@/store';
import { SoundVisualizer } from '@/components/tuna-specialist/SoundVisualizer';
import { ConversationHistory } from '@/components/tuna-specialist/ConversationHistory';
import { DebugPanel } from '@/components/tuna-specialist/DebugPanel';
import type { Location } from '@/types/database';

// ━━━ FEATURE FLAG ━━━
// Flip to `true` to re-enable the full voice interface
const VOICE_FEATURE_ENABLED = false;

const WARN_SECONDS = 55;
const MAX_SECONDS = 60;

export default function VoiceScreen() {
  const insets = useSafeAreaInsets();

  // Auth / location
  const { location, locations, setLocation, fetchLocations } = useAuthStore();
  const { addToCart } = useOrderStore();

  // Tuna Specialist store — keep subscriptions alive so flipping the flag works instantly
  const isListening = useTunaSpecialistStore((s) => s.isListening);
  const isProcessing = useTunaSpecialistStore((s) => s.isProcessing);
  const liveTranscript = useTunaSpecialistStore((s) => s.liveTranscript);
  const currentSpeaker = useTunaSpecialistStore((s) => s.currentSpeaker);
  const conversation = useTunaSpecialistStore((s) => s.conversation);
  const cartItems = useTunaSpecialistStore((s) => s.cartItems);
  const error = useTunaSpecialistStore((s) => s.error);
  const isOnline = useTunaSpecialistStore((s) => s.isOnline);
  const offlineQueue = useTunaSpecialistStore((s) => s.offlineQueue);
  const hasSeenOnboarding = useTunaSpecialistStore((s) => s.hasSeenOnboarding);

  const initVoice = useTunaSpecialistStore((s) => s.initVoice);
  const destroyVoice = useTunaSpecialistStore((s) => s.destroyVoice);
  const startListening = useTunaSpecialistStore((s) => s.startListening);
  const stopListening = useTunaSpecialistStore((s) => s.stopListening);
  const sendToGemini = useTunaSpecialistStore((s) => s.sendToGemini);
  const processOfflineQueue = useTunaSpecialistStore((s) => s.processOfflineQueue);
  const removeCartItem = useTunaSpecialistStore((s) => s.removeCartItem);
  const updateCartItemQuantity = useTunaSpecialistStore((s) => s.updateCartItemQuantity);
  const clearCart = useTunaSpecialistStore((s) => s.clearCart);
  const getCartForOrder = useTunaSpecialistStore((s) => s.getCartForOrder);
  const setOnboardingSeen = useTunaSpecialistStore((s) => s.setOnboardingSeen);

  // Local state
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showConversation, setShowConversation] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Animations
  const cartSlideAnim = useRef(new Animated.Value(0)).current;
  const micPulseAnim = useRef(new Animated.Value(1)).current;
  const offlineBannerAnim = useRef(new Animated.Value(0)).current;
  const listeningDotOpacity = useRef(new Animated.Value(1)).current;

  // Timer ref
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ━━━ VOICE-GATED EFFECTS ━━━

  // Init/destroy — only when feature is enabled
  useEffect(() => {
    if (VOICE_FEATURE_ENABLED) {
      try {
        initVoice();
        fetchLocations();
        if (!hasSeenOnboarding) setShowOnboarding(true);
      } catch (e) {
        console.log('Voice modules not available:', e);
      }
      return () => {
        try {
          destroyVoice();
        } catch (e) {
          console.log('Voice cleanup error:', e);
        }
      };
    }
  }, []);

  // Process offline queue when online
  useEffect(() => {
    if (VOICE_FEATURE_ENABLED && isOnline && offlineQueue.length > 0 && location) {
      processOfflineQueue(location.short_code);
    }
  }, [isOnline]);

  // Offline banner
  useEffect(() => {
    if (!VOICE_FEATURE_ENABLED) return;
    Animated.timing(offlineBannerAnim, {
      toValue: isOnline ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOnline]);

  // Auto-send to Gemini
  const finalTranscript = useTunaSpecialistStore((s) => s.finalTranscript);
  useEffect(() => {
    if (VOICE_FEATURE_ENABLED && finalTranscript && !isProcessing && location) {
      sendToGemini(location.short_code);
    }
  }, [finalTranscript]);

  // Cart slide
  useEffect(() => {
    if (!VOICE_FEATURE_ENABLED) return;
    Animated.spring(cartSlideAnim, {
      toValue: cartItems.length > 0 ? 1 : 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 90,
      mass: 1,
    }).start();
  }, [cartItems.length > 0]);

  // Mic pulse + recording timer
  useEffect(() => {
    if (!VOICE_FEATURE_ENABLED) return;
    if (isListening) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(micPulseAnim, {
            toValue: 1.15,
            duration: 750,
            useNativeDriver: true,
          }),
          Animated.timing(micPulseAnim, {
            toValue: 1,
            duration: 750,
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();

      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => {
          const next = s + 1;
          if (next === WARN_SECONDS && Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          }
          if (next >= MAX_SECONDS) stopListening();
          return next;
        });
      }, 1000);

      return () => {
        pulse.stop();
        micPulseAnim.setValue(1);
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isListening]);

  // Pulsing "Listening..." dot
  useEffect(() => {
    if (!VOICE_FEATURE_ENABLED) return;
    if (isListening && !liveTranscript) {
      const blink = Animated.loop(
        Animated.sequence([
          Animated.timing(listeningDotOpacity, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(listeningDotOpacity, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
      blink.start();
      return () => blink.stop();
    } else {
      listeningDotOpacity.setValue(1);
    }
  }, [isListening, !liveTranscript]);

  // ━━━ HANDLERS (kept for when feature is re-enabled) ━━━

  const handleMicPress = useCallback(async () => {
    if (isProcessing) return;
    if (isListening) {
      await stopListening();
    } else {
      setPermissionDenied(false);
      await startListening();
      const currentError = useTunaSpecialistStore.getState().error;
      if (currentError?.includes('access needed')) setPermissionDenied(true);
    }
  }, [isListening, isProcessing, startListening, stopListening]);

  const handleSaveToCart = useCallback(() => {
    if (!location || cartItems.length === 0) return;
    const items = getCartForOrder();
    for (const item of items) {
      if (item.inventory_item_id) {
        addToCart(location.id, item.inventory_item_id, item.quantity, 'pack', {
          inputMode: 'quantity',
          quantityRequested: item.quantity,
        });
      }
    }
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    Alert.alert('Saved!', `${items.length} item${items.length !== 1 ? 's' : ''} added to your order cart.`);
    clearCart();
  }, [location, cartItems, getCartForOrder, addToCart, clearCart]);

  const handleClearCart = useCallback(() => {
    Alert.alert('Clear all items?', 'This will also clear the conversation.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clearCart },
    ]);
  }, [clearCart]);

  const handleSelectLocation = useCallback((loc: Location) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLocation(loc);
    setShowLocationDropdown(false);
  }, [setLocation]);

  const handleDismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    setOnboardingSeen();
  }, [setOnboardingSeen]);

  // Visualizer state
  const vizState: 'idle' | 'listening' | 'processing' | 'speaking' =
    isListening ? 'listening' : isProcessing ? 'processing' : currentSpeaker === 'ai' ? 'speaking' : 'idle';

  // Most recent messages
  const lastHumanMsg = [...conversation].reverse().find((m) => m.type === 'human');
  const lastAiMsg = [...conversation].reverse().find((m) => m.type === 'ai');
  const lastAiParsed = lastAiMsg?.parsedItems;

  const cartTranslateY = cartSlideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [300, 0],
  });

  const offlineBannerTranslateY = offlineBannerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-40, 0],
  });

  const isIdle = !isListening && !isProcessing && conversation.length === 0 && !liveTranscript;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // COMING SOON UI — shown when VOICE_FEATURE_ENABLED is false
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  if (!VOICE_FEATURE_ENABLED) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>

          {/* 1. LOGO WITH AI BADGE */}
          <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
            <Image
              source={require('../../assets/images/babytuna-logo-black.png')}
              style={{ width: 80, height: 80 }}
              resizeMode="contain"
            />
            {/* AI sparkle badge */}
            <View
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: '#FFFFFF',
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#000000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 8,
                elevation: 4,
              }}
            >
              <Sparkles size={16} color="#F97316" />
            </View>
          </View>

          {/* 2. TITLE */}
          <Text
            style={{
              fontSize: 28,
              fontWeight: '800',
              color: '#1F2937',
              textAlign: 'center',
              letterSpacing: -0.5,
              marginTop: 20,
            }}
          >
            Tuna Specialist
          </Text>

          {/* 3. COMING SOON PILL */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#FFF7ED',
              borderWidth: 1,
              borderColor: '#FED7AA',
              borderRadius: 20,
              paddingVertical: 6,
              paddingHorizontal: 16,
              marginTop: 10,
              gap: 8,
            }}
          >
            <Sparkles size={14} color="#F97316" />
            <Text style={{ fontSize: 13, color: '#EA580C', fontWeight: '600' }}>Coming Soon</Text>
          </View>

          {/* 4. DESCRIPTION */}
          <Text
            style={{
              fontSize: 15,
              color: '#6B7280',
              textAlign: 'center',
              lineHeight: 22,
              maxWidth: 300,
              paddingHorizontal: 24,
              marginTop: 16,
            }}
          >
            Your AI-powered voice ordering assistant. Speak naturally in English or Chinese — Tuna Specialist figures out the rest.
          </Text>

          {/* 5. FEATURE PREVIEW CARD */}
          <View
            style={{
              width: '100%',
              backgroundColor: '#FFFFFF',
              borderRadius: 16,
              padding: 20,
              marginTop: 24,
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.06,
              shadowRadius: 3,
              elevation: 2,
            }}
          >
            {[
              { Icon: Mic, text: 'Order by voice in English or Chinese' },
              { Icon: MessageSquare, text: 'AI that remembers your past orders' },
              { Icon: WifiOff, text: 'Works offline — even in the freezer' },
            ].map((row, index) => (
              <View
                key={index}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: index > 0 ? 16 : 0,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: '#FFF7ED',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <row.Icon size={20} color="#F97316" />
                </View>
                <Text style={{ fontSize: 14, color: '#374151', flex: 1 }}>{row.text}</Text>
              </View>
            ))}
          </View>

          {/* 6. NOTIFY BUTTON */}
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                "You're on the list! 🐟",
                "We'll let you know as soon as Tuna Specialist is ready.",
              )
            }
            activeOpacity={0.8}
            style={{
              width: 220,
              height: 50,
              backgroundColor: '#F97316',
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 24,
              shadowColor: '#F97316',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 12,
              elevation: 6,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>Notify Me When Ready</Text>
          </TouchableOpacity>

          {/* 7. FOOTER */}
          <Text style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 16 }}>
            We're working hard on this ✨
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FULL VOICE INTERFACE — shown when VOICE_FEATURE_ENABLED is true
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0A0F' }}>
      <LinearGradient colors={['#0A0A0F', '#111827']} style={{ flex: 1 }}>
        {/* OFFLINE BANNER */}
        <Animated.View
          style={{
            position: 'absolute',
            top: insets.top,
            left: 0,
            right: 0,
            zIndex: 20,
            transform: [{ translateY: offlineBannerTranslateY }],
            opacity: offlineBannerAnim,
          }}
          pointerEvents={isOnline ? 'none' : 'auto'}
        >
          <View
            style={{
              backgroundColor: '#7C2D12',
              paddingVertical: 8,
              paddingHorizontal: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="cloud-offline-outline" size={16} color="#FDBA74" />
            <Text style={{ color: '#FDBA74', fontSize: 12, fontWeight: '600', marginLeft: 6 }}>
              Offline — orders will be queued
            </Text>
            {offlineQueue.length > 0 && (
              <View style={{ backgroundColor: 'rgba(253,186,116,0.2)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 }}>
                <Text style={{ color: '#FDBA74', fontSize: 10, fontWeight: '700' }}>{offlineQueue.length} queued</Text>
              </View>
            )}
          </View>
        </Animated.View>

        {/* ━━━ HEADER ━━━ */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: insets.top + 8,
            paddingHorizontal: 20,
            paddingBottom: 8,
          }}
        >
          {/* Location pill */}
          <TouchableOpacity
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setShowLocationDropdown((p) => !p);
            }}
            accessibilityLabel={`Location: ${location?.name || 'Select'}. Tap to change.`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.08)',
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 20,
            }}
          >
            <Text style={{ fontSize: 13, color: '#E2E8F0', fontWeight: '600' }}>
              {location?.name || 'Select Location'}
            </Text>
            <Ionicons
              name={showLocationDropdown ? 'chevron-up' : 'chevron-down'}
              size={14}
              color="#9CA3AF"
              style={{ marginLeft: 6 }}
            />
          </TouchableOpacity>

          {/* Right side */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {/* Conversation history */}
            {conversation.length > 0 && (
              <TouchableOpacity
                onPress={() => setShowConversation(true)}
                accessibilityLabel="View conversation history"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="chatbubbles-outline" size={17} color="#9CA3AF" />
              </TouchableOpacity>
            )}

            {/* Debug toggle */}
            {__DEV__ && (
              <TouchableOpacity
                onPress={() => setShowDebug((p) => !p)}
                accessibilityLabel="Toggle debug panel"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: showDebug ? 'rgba(249,115,22,0.2)' : 'rgba(255,255,255,0.08)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="bug-outline" size={17} color={showDebug ? '#FDBA74' : '#9CA3AF'} />
              </TouchableOpacity>
            )}

            {/* Cart badge */}
            {cartItems.length > 0 && (
              <View
                style={{
                  backgroundColor: '#F97316',
                  borderRadius: 12,
                  minWidth: 24,
                  height: 24,
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingHorizontal: 7,
                }}
              >
                <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>
                  {cartItems.length}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Location dropdown */}
        {showLocationDropdown && (
          <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            {locations.map((loc) => {
              const isSelected = location?.id === loc.id;
              return (
                <TouchableOpacity
                  key={loc.id}
                  onPress={() => handleSelectLocation(loc)}
                  accessibilityLabel={`Select ${loc.name}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: isSelected ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.05)',
                    marginBottom: 4,
                  }}
                >
                  <Ionicons
                    name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                    size={16}
                    color={isSelected ? '#F97316' : '#6B7280'}
                  />
                  <Text style={{ marginLeft: 8, fontSize: 14, color: isSelected ? '#F97316' : '#D1D5DB', fontWeight: isSelected ? '600' : '400' }}>
                    {loc.name}
                  </Text>
                  <Text style={{ marginLeft: 6, fontSize: 12, color: '#6B7280' }}>
                    {loc.short_code}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* DEBUG PANEL */}
        {__DEV__ && showDebug && (
          <DebugPanel locationShortCode={location?.short_code || ''} />
        )}

        {/* ━━━ VOICE INTERACTION AREA ━━━ */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>

          {/* Branding — only idle, no conversation */}
          {isIdle && (
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 32 }}>🐟</Text>
              <Text style={{ fontSize: 22, fontWeight: '800', color: '#F9FAFB', letterSpacing: -0.5, marginTop: 4 }} accessibilityRole="header">
                Tuna Specialist
              </Text>
              <Text style={{ fontSize: 13, color: '#64748B', marginTop: 8 }}>
                Your AI ordering assistant
              </Text>
            </View>
          )}

          {/* Sound Visualizer */}
          <SoundVisualizer state={vizState} />

          {/* Transcript Area (24px below visualizer) */}
          <View style={{ marginTop: 24, alignItems: 'center', minHeight: 80, maxWidth: '100%' }}>

            {/* Idle — no conversation */}
            {isIdle && (
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 14, color: '#6B7280', textAlign: 'center' }}>
                  Tap the mic to start ordering
                </Text>
                <Text style={{ fontSize: 12, color: '#4B5563', marginTop: 4, textAlign: 'center' }}>
                  Speak in English or Chinese
                </Text>
              </View>
            )}

            {/* Listening */}
            {isListening && (
              <View style={{ alignItems: 'center' }}>
                {liveTranscript ? (
                  <Text
                    style={{ fontSize: 17, color: '#4ADE80', fontWeight: '600', textAlign: 'center', lineHeight: 24 }}
                    accessibilityLiveRegion="polite"
                  >
                    {liveTranscript}
                  </Text>
                ) : (
                  <Animated.Text style={{ fontSize: 17, color: '#4ADE80', fontWeight: '600', opacity: listeningDotOpacity }}>
                    Listening...
                  </Animated.Text>
                )}
                <Text style={{ fontSize: 12, color: recordingSeconds >= WARN_SECONDS ? '#FBBF24' : '#EF4444', marginTop: 8, textAlign: 'center' }}>
                  0:{String(recordingSeconds).padStart(2, '0')}
                  {recordingSeconds >= WARN_SECONDS && ` — auto-stop in ${MAX_SECONDS - recordingSeconds}s`}
                </Text>
              </View>
            )}

            {/* Processing */}
            {isProcessing && (
              <View style={{ alignItems: 'center' }}>
                {lastHumanMsg && (
                  <Text style={{ fontSize: 14, color: 'rgba(74,222,128,0.6)', textAlign: 'center', marginBottom: 8 }}>
                    {lastHumanMsg.text}
                  </Text>
                )}
                <Text style={{ fontSize: 13, color: '#F97316' }}>Thinking...</Text>
              </View>
            )}

            {/* AI has responded */}
            {!isListening && !isProcessing && conversation.length > 0 && (
              <View style={{ alignItems: 'center', maxWidth: '100%' }}>
                {lastHumanMsg && (
                  <Text style={{ fontSize: 14, color: 'rgba(74,222,128,0.6)', textAlign: 'center', marginBottom: 8 }} numberOfLines={2}>
                    {lastHumanMsg.text}
                  </Text>
                )}
                {lastAiMsg && (
                  <Text
                    style={{ fontSize: 15, color: '#F0F0F0', fontWeight: '500', textAlign: 'center', lineHeight: 22 }}
                    accessibilityLiveRegion="polite"
                  >
                    {lastAiMsg.text}
                  </Text>
                )}
                {/* Parsed items inline */}
                {lastAiParsed && lastAiParsed.length > 0 && (
                  <Text style={{ fontSize: 12, color: '#FB923C', marginTop: 6, textAlign: 'center' }}>
                    Added: {lastAiParsed.map((it) => `${it.emoji} ${it.item_name} ×${it.quantity}`).join(', ')}
                  </Text>
                )}
                {conversation.length > 2 && (
                  <TouchableOpacity onPress={() => setShowConversation(true)} style={{ marginTop: 10 }} accessibilityLabel="View full conversation">
                    <Text style={{ fontSize: 11, color: '#64748B', textDecorationLine: 'underline' }}>
                      View history
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Error */}
            {error && !isListening && !isProcessing && (
              <View style={{ alignItems: 'center', marginTop: 8 }}>
                <Text style={{ fontSize: 13, color: '#FCA5A5', textAlign: 'center' }}>{error}</Text>
                {permissionDenied && (
                  <TouchableOpacity
                    onPress={() => Linking.openSettings()}
                    style={{ marginTop: 10, backgroundColor: 'rgba(249,115,22,0.2)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}
                    accessibilityLabel="Open device settings to grant microphone permission"
                  >
                    <Text style={{ fontSize: 12, color: '#FDBA74', fontWeight: '600' }}>Open Settings</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>

        {/* ━━━ MIC BUTTON ━━━ */}
        <View style={{ alignItems: 'center', paddingVertical: 16 }}>
          <Animated.View style={{ transform: [{ scale: isListening ? micPulseAnim : 1 }] }}>
            {/* Pulse ring */}
            {isListening && (
              <Animated.View
                style={{
                  position: 'absolute',
                  width: 88,
                  height: 88,
                  borderRadius: 44,
                  borderWidth: 2,
                  borderColor: 'rgba(239,68,68,0.4)',
                  top: -8,
                  left: -8,
                  transform: [{ scale: micPulseAnim }],
                }}
              />
            )}
            <TouchableOpacity
              onPress={handleMicPress}
              disabled={isProcessing}
              activeOpacity={0.7}
              accessibilityLabel={
                isProcessing ? 'Processing your order' : isListening ? 'Tap to stop recording' : 'Tap to start voice ordering'
              }
              accessibilityRole="button"
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isProcessing ? '#374151' : isListening ? '#EF4444' : '#F97316',
                // Glow shadow
                shadowColor: isProcessing ? '#374151' : isListening ? '#EF4444' : '#F97316',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.5,
                shadowRadius: 20,
                elevation: 10,
              }}
            >
              {isProcessing ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : isListening ? (
                <Ionicons name="stop" size={24} color="#FFFFFF" />
              ) : (
                <Ionicons name="mic" size={28} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </Animated.View>

          <Text
            style={{
              fontSize: 12,
              marginTop: 8,
              color: isProcessing ? '#9CA3AF' : isListening ? '#EF4444' : '#6B7280',
            }}
          >
            {isProcessing ? 'Processing...' : isListening ? `0:${String(recordingSeconds).padStart(2, '0')}` : 'Tap to speak'}
          </Text>
        </View>

        {/* ━━━ CART AREA ━━━ */}
        <Animated.View
          style={{
            transform: [{ translateY: cartTranslateY }],
            maxHeight: '40%',
            backgroundColor: '#1A1F2E',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1,
            borderTopColor: 'rgba(255,255,255,0.06)',
            paddingBottom: insets.bottom + 8,
            overflow: 'hidden',
          }}
        >
          {cartItems.length > 0 && (
            <>
              {/* Cart header */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 16,
                  paddingTop: 14,
                  paddingBottom: 10,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#E2E8F0' }}>Items</Text>
                  <View
                    style={{
                      backgroundColor: '#F97316',
                      borderRadius: 10,
                      minWidth: 20,
                      height: 20,
                      justifyContent: 'center',
                      alignItems: 'center',
                      marginLeft: 8,
                      paddingHorizontal: 6,
                    }}
                  >
                    <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>{cartItems.length}</Text>
                  </View>
                </View>
                {conversation.length > 2 && (
                  <TouchableOpacity onPress={() => setShowConversation(true)} accessibilityLabel="View conversation history">
                    <Text style={{ fontSize: 11, color: '#64748B' }}>History</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Cart items */}
              <ScrollView style={{ maxHeight: 200, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
                {cartItems.map((item, index) => (
                  <View
                    key={`${item.item_name}-${index}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 10,
                      borderBottomWidth: index < cartItems.length - 1 ? 1 : 0,
                      borderBottomColor: 'rgba(255,255,255,0.04)',
                    }}
                    accessibilityLabel={`${item.item_name}, ${item.quantity} ${item.unit}`}
                  >
                    {/* Left */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 }}>
                      <Text style={{ fontSize: 18, marginRight: 8 }}>{item.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, color: '#E2E8F0', fontWeight: '600' }} numberOfLines={1}>
                          {item.item_name}
                        </Text>
                        {item.spoken_text && item.spoken_text !== item.item_name && (
                          <Text style={{ fontSize: 10, color: '#4B5563', fontStyle: 'italic' }} numberOfLines={1}>
                            spoken as: {item.spoken_text}
                          </Text>
                        )}
                      </View>
                    </View>

                    {/* Right: quantity controls */}
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TouchableOpacity
                        onPress={() => item.quantity <= 1 ? removeCartItem(index) : updateCartItemQuantity(index, item.quantity - 1)}
                        accessibilityLabel={`Decrease ${item.item_name}`}
                        style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text style={{ color: '#94A3B8', fontSize: 16, fontWeight: '600' }}>−</Text>
                      </TouchableOpacity>

                      <Text style={{ width: 36, textAlign: 'center', fontSize: 16, color: '#FFFFFF', fontWeight: '700' }}>
                        {item.quantity}
                      </Text>

                      <TouchableOpacity
                        onPress={() => updateCartItemQuantity(index, item.quantity + 1)}
                        accessibilityLabel={`Increase ${item.item_name}`}
                        style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text style={{ color: '#94A3B8', fontSize: 16, fontWeight: '600' }}>+</Text>
                      </TouchableOpacity>

                      <Text style={{ fontSize: 12, color: '#64748B', width: 24, textAlign: 'center', marginLeft: 2 }}>
                        {item.unit}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>

              {/* Cart buttons */}
              <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12 }}>
                <TouchableOpacity
                  onPress={handleClearCart}
                  accessibilityLabel="Clear voice cart"
                  style={{
                    flex: 1,
                    height: 48,
                    backgroundColor: 'rgba(239,68,68,0.12)',
                    borderWidth: 1,
                    borderColor: 'rgba(239,68,68,0.25)',
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#FCA5A5', fontSize: 13, fontWeight: '600' }}>Clear</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleSaveToCart}
                  disabled={cartItems.length === 0}
                  accessibilityLabel={`Save ${cartItems.length} items to order cart`}
                  style={{
                    flex: 2.5,
                    height: 48,
                    backgroundColor: cartItems.length > 0 ? '#F97316' : '#374151',
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: '#F97316',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: cartItems.length > 0 ? 0.4 : 0,
                    shadowRadius: 15,
                    elevation: cartItems.length > 0 ? 8 : 0,
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>
                    Save {cartItems.length} Item{cartItems.length !== 1 ? 's' : ''} to Cart
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Animated.View>
      </LinearGradient>

      {/* ONBOARDING OVERLAY */}
      {showOnboarding && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.88)',
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 32,
            zIndex: 100,
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: 'rgba(249,115,22,0.2)',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 24,
              }}
            >
              <Text style={{ fontSize: 40 }}>🐟</Text>
            </View>

            <Text style={{ fontSize: 22, fontWeight: '800', color: '#F9FAFB', textAlign: 'center' }}>
              Tuna Specialist
            </Text>
            <Text style={{ fontSize: 15, color: '#94A3B8', textAlign: 'center', marginTop: 12, lineHeight: 22 }}>
              Order by voice — just tap the mic and say what you need.
            </Text>
            <Text style={{ fontSize: 13, color: '#64748B', textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
              Speak naturally in English or Chinese.{'\n'}
              I'll figure out the items and quantities.
            </Text>

            <View style={{ marginTop: 32, gap: 16, width: '100%' }}>
              {[
                { icon: 'mic-outline' as const, text: 'Tap mic and say your order' },
                { icon: 'chatbubble-outline' as const, text: 'Ask questions or make changes' },
                { icon: 'cart-outline' as const, text: 'Review and save to your order cart' },
              ].map((step) => (
                <View key={step.icon} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name={step.icon} size={20} color="#F97316" />
                  <Text style={{ color: '#D1D5DB', fontSize: 13, marginLeft: 10, flex: 1 }}>{step.text}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              onPress={handleDismissOnboarding}
              accessibilityLabel="Get started with Tuna Specialist"
              style={{
                marginTop: 36,
                backgroundColor: '#F97316',
                borderRadius: 16,
                paddingVertical: 14,
                paddingHorizontal: 48,
                shadowColor: '#F97316',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.4,
                shadowRadius: 15,
                elevation: 8,
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>Get Started</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* CONVERSATION HISTORY MODAL */}
      <ConversationHistory
        visible={showConversation}
        onClose={() => setShowConversation(false)}
        conversation={conversation}
      />
    </View>
  );
}

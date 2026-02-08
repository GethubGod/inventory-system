import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  Alert,
  LayoutAnimation,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore, useOrderStore, useTunaSpecialistStore } from '@/store';
import { SoundVisualizer } from '@/components/tuna-specialist/SoundVisualizer';
import type { Location } from '@/types/database';

export default function VoiceScreen() {
  const insets = useSafeAreaInsets();

  // Auth / location
  const { location, locations, setLocation, fetchLocations } = useAuthStore();
  const { addToCart } = useOrderStore();

  // Tuna Specialist store
  const isListening = useTunaSpecialistStore((s) => s.isListening);
  const isProcessing = useTunaSpecialistStore((s) => s.isProcessing);
  const liveTranscript = useTunaSpecialistStore((s) => s.liveTranscript);
  const currentSpeaker = useTunaSpecialistStore((s) => s.currentSpeaker);
  const conversation = useTunaSpecialistStore((s) => s.conversation);
  const cartItems = useTunaSpecialistStore((s) => s.cartItems);
  const error = useTunaSpecialistStore((s) => s.error);
  const isOnline = useTunaSpecialistStore((s) => s.isOnline);
  const offlineQueue = useTunaSpecialistStore((s) => s.offlineQueue);

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

  // Local state
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Animations
  const cartSlideAnim = useRef(new Animated.Value(0)).current;
  const micPulseAnim = useRef(new Animated.Value(1)).current;
  const transcriptOpacity = useRef(new Animated.Value(0)).current;

  // Timer ref for recording duration
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Init/destroy voice listeners
  useEffect(() => {
    initVoice();
    fetchLocations();
    return () => {
      destroyVoice();
    };
  }, []);

  // Process offline queue when online
  useEffect(() => {
    if (isOnline && offlineQueue.length > 0 && location) {
      processOfflineQueue(location.short_code);
    }
  }, [isOnline]);

  // Auto-send to Gemini when speech recognition finishes
  const finalTranscript = useTunaSpecialistStore((s) => s.finalTranscript);
  useEffect(() => {
    if (finalTranscript && !isProcessing && location) {
      sendToGemini(location.short_code);
    }
  }, [finalTranscript]);

  // Cart slide animation
  useEffect(() => {
    Animated.spring(cartSlideAnim, {
      toValue: cartItems.length > 0 ? 1 : 0,
      useNativeDriver: true,
      tension: 50,
      friction: 9,
    }).start();
  }, [cartItems.length > 0]);

  // Mic pulse when listening
  useEffect(() => {
    if (isListening) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(micPulseAnim, {
            toValue: 1.15,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(micPulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();

      // Start recording timer
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
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

  // Transcript fade-in
  useEffect(() => {
    if (liveTranscript || conversation.length > 0) {
      Animated.timing(transcriptOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [liveTranscript, conversation.length]);

  const handleMicPress = useCallback(async () => {
    if (isProcessing) return;
    if (isListening) {
      await stopListening();
    } else {
      await startListening();
    }
  }, [isListening, isProcessing]);

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

    Alert.alert(
      'Saved!',
      `${items.length} item${items.length !== 1 ? 's' : ''} added to your order cart.`,
    );
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

  // Determine visualizer state
  const getVisualizerState = (): 'idle' | 'listening' | 'processing' | 'speaking' => {
    if (isListening) return 'listening';
    if (isProcessing) return 'processing';
    if (currentSpeaker === 'ai') return 'speaking';
    return 'idle';
  };

  // Get most recent exchange
  const lastHumanMsg = [...conversation].reverse().find((m) => m.type === 'human');
  const lastAiMsg = [...conversation].reverse().find((m) => m.type === 'ai');

  const cartTranslateY = cartSlideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [300, 0],
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0A0A' }}>
      <LinearGradient
        colors={['#0A0A0A', '#111827']}
        style={{ flex: 1 }}
      >
        {/* HEADER */}
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
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.08)',
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 20,
            }}
          >
            <Text style={{ fontSize: 13, color: '#F9FAFB' }}>
              {location?.name || 'Select Location'}
            </Text>
            <Ionicons
              name={showLocationDropdown ? 'chevron-up' : 'chevron-down'}
              size={14}
              color="#9CA3AF"
              style={{ marginLeft: 4 }}
            />
          </TouchableOpacity>

          {/* Cart badge (links to cart tab) */}
          {cartItems.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View
                style={{
                  backgroundColor: '#F97316',
                  borderRadius: 10,
                  minWidth: 20,
                  height: 20,
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingHorizontal: 6,
                }}
              >
                <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>
                  {cartItems.length}
                </Text>
              </View>
            </View>
          )}
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
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: isSelected
                      ? 'rgba(249,115,22,0.15)'
                      : 'rgba(255,255,255,0.05)',
                    marginBottom: 4,
                  }}
                >
                  <Ionicons
                    name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                    size={16}
                    color={isSelected ? '#F97316' : '#6B7280'}
                  />
                  <Text
                    style={{
                      marginLeft: 8,
                      fontSize: 14,
                      color: isSelected ? '#F97316' : '#D1D5DB',
                      fontWeight: isSelected ? '600' : '400',
                    }}
                  >
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

        {/* TOP HALF — VOICE INTERACTION AREA */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          {/* Visualizer */}
          <SoundVisualizer state={getVisualizerState()} />

          {/* Transcript area below visualizer */}
          <Animated.View
            style={{
              marginTop: 32,
              alignItems: 'center',
              opacity: transcriptOpacity,
              minHeight: 80,
            }}
          >
            {/* Idle state — no conversation yet */}
            {!isListening && !isProcessing && conversation.length === 0 && !liveTranscript && (
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: '#F9FAFB' }}>
                  Tuna Specialist
                </Text>
                <Text style={{ fontSize: 13, color: '#64748B', marginTop: 6 }}>
                  Tap the mic to start ordering
                </Text>
                <Text style={{ fontSize: 11, color: '#4B5563', marginTop: 4 }}>
                  Speak in English or Chinese
                </Text>
              </View>
            )}

            {/* Listening — live transcript */}
            {isListening && (
              <Text
                style={{
                  fontSize: 16,
                  color: '#22C55E',
                  textAlign: 'center',
                  lineHeight: 24,
                }}
              >
                {liveTranscript || 'Listening...'}
              </Text>
            )}

            {/* Processing */}
            {isProcessing && (
              <View style={{ alignItems: 'center' }}>
                {lastHumanMsg && (
                  <Text
                    style={{
                      fontSize: 14,
                      color: 'rgba(34,197,94,0.6)',
                      textAlign: 'center',
                      marginBottom: 8,
                    }}
                  >
                    {lastHumanMsg.text}
                  </Text>
                )}
                <Text style={{ fontSize: 13, color: '#F97316' }}>Thinking...</Text>
              </View>
            )}

            {/* AI has responded — show most recent exchange */}
            {!isListening && !isProcessing && conversation.length > 0 && (
              <View style={{ alignItems: 'center', maxWidth: '100%' }}>
                {lastHumanMsg && (
                  <Text
                    style={{
                      fontSize: 14,
                      color: 'rgba(34,197,94,0.6)',
                      textAlign: 'center',
                      marginBottom: 8,
                    }}
                    numberOfLines={2}
                  >
                    {lastHumanMsg.text}
                  </Text>
                )}
                {lastAiMsg && (
                  <Text
                    style={{
                      fontSize: 15,
                      color: '#F9FAFB',
                      textAlign: 'center',
                      lineHeight: 22,
                    }}
                  >
                    {lastAiMsg.text}
                  </Text>
                )}
                {conversation.length > 2 && (
                  <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 10 }}>
                    {Math.floor(conversation.length / 2)} exchanges
                  </Text>
                )}
              </View>
            )}

            {/* Error */}
            {error && !isListening && !isProcessing && (
              <Text style={{ fontSize: 13, color: '#FCA5A5', textAlign: 'center', marginTop: 8 }}>
                {error}
              </Text>
            )}
          </Animated.View>
        </View>

        {/* MIC BUTTON */}
        <View style={{ alignItems: 'center', paddingVertical: 16 }}>
          <Animated.View style={{ transform: [{ scale: isListening ? micPulseAnim : 1 }] }}>
            {/* Pulse ring behind mic when listening */}
            {isListening && (
              <Animated.View
                style={{
                  position: 'absolute',
                  width: 88,
                  height: 88,
                  borderRadius: 44,
                  backgroundColor: 'rgba(239,68,68,0.15)',
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
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isProcessing
                  ? '#374151'
                  : isListening
                    ? '#EF4444'
                    : '#F97316',
              }}
            >
              {isProcessing ? (
                <Ionicons name="hourglass-outline" size={28} color="#9CA3AF" />
              ) : isListening ? (
                <Ionicons name="stop" size={28} color="#FFFFFF" />
              ) : (
                <Ionicons name="mic" size={28} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </Animated.View>

          {/* Label below mic */}
          <Text
            style={{
              fontSize: 11,
              marginTop: 8,
              color: isProcessing
                ? '#F97316'
                : isListening
                  ? '#EF4444'
                  : '#6B7280',
            }}
          >
            {isProcessing
              ? 'Processing...'
              : isListening
                ? `0:${String(recordingSeconds).padStart(2, '0')}`
                : 'Tap to speak'}
          </Text>
        </View>

        {/* BOTTOM — CART AREA */}
        <Animated.View
          style={{
            transform: [{ translateY: cartTranslateY }],
            maxHeight: '45%',
            backgroundColor: '#1E293B',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
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
                  paddingHorizontal: 18,
                  paddingTop: 14,
                  paddingBottom: 10,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#F9FAFB' }}>Cart</Text>
                  <View
                    style={{
                      backgroundColor: '#F97316',
                      borderRadius: 8,
                      minWidth: 18,
                      height: 18,
                      justifyContent: 'center',
                      alignItems: 'center',
                      marginLeft: 8,
                      paddingHorizontal: 5,
                    }}
                  >
                    <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '700' }}>
                      {cartItems.length}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Cart items list */}
              <ScrollView
                style={{ maxHeight: 200, paddingHorizontal: 18 }}
                showsVerticalScrollIndicator={false}
              >
                {cartItems.map((item, index) => (
                  <View
                    key={`${item.item_name}-${index}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 10,
                      borderBottomWidth: index < cartItems.length - 1 ? 1 : 0,
                      borderBottomColor: 'rgba(255,255,255,0.06)',
                    }}
                  >
                    {/* Left: emoji + name + unit */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <Text style={{ fontSize: 20, marginRight: 8 }}>{item.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{ fontSize: 14, color: '#F9FAFB', fontWeight: '600' }}
                          numberOfLines={1}
                        >
                          {item.item_name}
                        </Text>
                        <Text style={{ fontSize: 13, color: '#94A3B8' }}>
                          {item.quantity} x {item.unit}
                        </Text>
                      </View>
                    </View>

                    {/* Right: quantity controls */}
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TouchableOpacity
                        onPress={() => {
                          if (item.quantity <= 1) {
                            removeCartItem(index);
                          } else {
                            updateCartItemQuantity(index, item.quantity - 1);
                          }
                        }}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: '#F9FAFB', fontSize: 16, fontWeight: '600' }}>
                          -
                        </Text>
                      </TouchableOpacity>

                      <Text
                        style={{
                          width: 32,
                          textAlign: 'center',
                          fontSize: 16,
                          color: '#F9FAFB',
                          fontWeight: '700',
                        }}
                      >
                        {item.quantity}
                      </Text>

                      <TouchableOpacity
                        onPress={() => updateCartItemQuantity(index, item.quantity + 1)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: '#F9FAFB', fontSize: 16, fontWeight: '600' }}>
                          +
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </ScrollView>

              {/* Cart action buttons */}
              <View
                style={{
                  flexDirection: 'row',
                  gap: 12,
                  paddingHorizontal: 18,
                  paddingTop: 12,
                }}
              >
                {/* Clear button */}
                <TouchableOpacity
                  onPress={handleClearCart}
                  style={{
                    flex: 1,
                    backgroundColor: 'rgba(239,68,68,0.15)',
                    borderWidth: 1,
                    borderColor: 'rgba(239,68,68,0.3)',
                    borderRadius: 14,
                    paddingVertical: 12,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#FCA5A5', fontSize: 13, fontWeight: '700' }}>
                    Clear
                  </Text>
                </TouchableOpacity>

                {/* Save to Cart button */}
                <TouchableOpacity
                  onPress={handleSaveToCart}
                  disabled={cartItems.length === 0}
                  style={{
                    flex: 2,
                    backgroundColor: cartItems.length > 0 ? '#F97316' : '#374151',
                    borderRadius: 14,
                    paddingVertical: 12,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>
                    Save {cartItems.length} Item{cartItems.length !== 1 ? 's' : ''}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Animated.View>
      </LinearGradient>
    </View>
  );
}

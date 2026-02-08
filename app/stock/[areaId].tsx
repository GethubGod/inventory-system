import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Animated,
  StyleSheet,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Image,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { colors, CATEGORY_LABELS } from '@/constants';
import { useAuthStore, useDisplayStore, useStockStore } from '@/store';
import { useStockNetworkStatus } from '@/hooks';
import { ItemCategory, StockUpdateMethod } from '@/types';
import { supabase } from '@/lib/supabase';
import {
  cancelStockCountPausedNotifications,
} from '@/services/notificationService';

const CATEGORY_EMOJI: Record<ItemCategory, string> = {
  fish: '🐟',
  protein: '🥩',
  produce: '🥬',
  dry: '🍚',
  dairy_cold: '🧊',
  frozen: '❄️',
  sauces: '🍶',
  alcohol: '🍺',
  packaging: '📦',
};

function getRelativeTimeLabel(timestamp: string | null): string {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Never';
  const diffMs = Date.now() - date.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function parseScanMethod(value: string | string[] | undefined): 'nfc' | 'qr' | 'manual' {
  if (value === 'qr') return 'qr';
  if (value === 'nfc') return 'nfc';
  return 'manual';
}

function toNumber(value: string): number {
  const numeric = parseFloat(value);
  if (Number.isNaN(numeric)) return 0;
  return Math.max(0, numeric);
}

export default function StockCountingScreen() {
  const params = useLocalSearchParams();
  const areaId = Array.isArray(params.areaId) ? params.areaId[0] : params.areaId;
  const scanMethod = parseScanMethod(params.scanMethod);
  const resumeParam = Array.isArray(params.resume) ? params.resume[0] : params.resume;
  const shouldResume = resumeParam === '1' || resumeParam === 'true';

  const { user, location } = useAuthStore();
  const { reduceMotion } = useDisplayStore();
  const {
    storageAreas,
    currentAreaItems,
    currentItemIndex,
    isLoading,
    isOnline,
    pendingUpdates,
    currentSession,
    sessionNotice,
    skippedItemCounts,
    fetchAreaItems,
    startSession,
    updateItemStock,
    skipItem,
    nextItem,
    previousItem,
    pauseCurrentSession,
    resumePausedSession,
    setSessionNotice,
  } = useStockStore();

  const [quantityValue, setQuantityValue] = useState('0');
  const [note, setNote] = useState<string>('');
  const [noteDraft, setNoteDraft] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [pendingPhotoUri, setPendingPhotoUri] = useState<string | null>(null);
  const [showPhotoPreview, setShowPhotoPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const quantityInputRef = useRef<TextInput>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const { width: screenWidth } = useWindowDimensions();

  useStockNetworkStatus();

  const area = useMemo(
    () => storageAreas.find((entry) => entry.id === areaId) ?? null,
    [storageAreas, areaId]
  );

  const currentItem = currentAreaItems[currentItemIndex];
  const totalItems = currentAreaItems.length;
  const isLastItem = totalItems > 0 && currentItemIndex === totalItems - 1;

  useEffect(() => {
    if (!areaId) return;
    let isCancelled = false;

    const initialize = async () => {
      const state = useStockStore.getState();
      const hasActiveSessionForArea = state.currentSession?.area_id === areaId;
      const hasHydratedAreaItems =
        state.currentAreaId === areaId && state.currentAreaItems.length > 0;
      const hasPausedSessionForArea =
        shouldResume && state.pausedSession?.areaId === areaId;

      if (hasPausedSessionForArea) {
        await fetchAreaItems(areaId);
        if (isCancelled) return;

        const resumed = resumePausedSession(areaId);
        if (resumed) {
          await cancelStockCountPausedNotifications();
          setSessionNotice('Stock counting resumed.');
          return;
        }
      }

      if (hasActiveSessionForArea && hasHydratedAreaItems) {
        return;
      }

      await fetchAreaItems(areaId);
      if (isCancelled) return;

      const latest = useStockStore.getState();
      const stillHasActiveSession = latest.currentSession?.area_id === areaId;
      if (!stillHasActiveSession) {
        await startSession(areaId, scanMethod);
      }
    };

    initialize();

    return () => {
      isCancelled = true;
    };
  }, [
    areaId,
    fetchAreaItems,
    resumePausedSession,
    scanMethod,
    setSessionNotice,
    shouldResume,
    startSession,
  ]);

  useEffect(() => {
    if (!currentItem) return;
    setQuantityValue(String(currentItem.current_quantity ?? 0));
    setNote('');
    setNoteDraft('');
    setPhotoUri(null);
  }, [currentItem?.id]);

  const handleChangeQuantity = useCallback((value: string) => {
    setQuantityValue(value.replace(/[^0-9]/g, ''));
  }, []);

  const handleIncrement = useCallback(
    async (delta: number) => {
      const nextValue = toNumber(quantityValue) + delta;
      setQuantityValue(String(Math.max(0, nextValue)));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [quantityValue]
  );

  const handleQuantityFocus = useCallback(() => {
    const length = quantityValue.length;
    requestAnimationFrame(() => {
      quantityInputRef.current?.setNativeProps({
        selection: { start: 0, end: length },
      });
    });
  }, [quantityValue]);

  useEffect(() => {
    if (!currentItem) return;
    const timer = setTimeout(() => {
      quantityInputRef.current?.focus();
      handleQuantityFocus();
    }, 60);
    return () => clearTimeout(timer);
  }, [currentItem?.id, handleQuantityFocus]);

  const showInlineToast = useCallback((message: string) => {
    setToastMessage(message);
    setShowToast(true);
    Animated.sequence([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.delay(900),
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => setShowToast(false));
  }, [toastOpacity]);

  useEffect(() => {
    if (sessionNotice !== 'Stock counting resumed.') return;
    showInlineToast(sessionNotice);
    setSessionNotice(null);
  }, [sessionNotice, setSessionNotice, showInlineToast]);

  const animateToNext = useCallback(
    (advance: () => void) => {
      if (reduceMotion) {
        advance();
        return;
      }

      Animated.timing(slideAnim, {
        toValue: -screenWidth,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        advance();
        slideAnim.setValue(screenWidth);
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      });
    },
    [reduceMotion, screenWidth, slideAnim]
  );

  const animateToPrevious = useCallback(
    (retreat: () => void) => {
      if (reduceMotion) {
        retreat();
        return;
      }

      Animated.timing(slideAnim, {
        toValue: screenWidth,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        retreat();
        slideAnim.setValue(-screenWidth);
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      });
    },
    [reduceMotion, screenWidth, slideAnim]
  );

  const uploadPhoto = useCallback(
    async (uri: string, itemId: string) => {
      const response = await fetch(uri);
      const blob = await response.blob();
      const filePath = `stock/${areaId}/${itemId}/${Date.now()}.jpg`;

      const { error: uploadError } = await supabase
        .storage
        .from('stock-photos')
        .upload(filePath, blob, { contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('stock-photos').getPublicUrl(filePath);
      return data.publicUrl;
    },
    [areaId]
  );

  const handleSaveItem = useCallback(
    async (shouldAdvance: boolean, shouldComplete: boolean) => {
      if (!currentItem) return;
      if (isSaving) return;

      setIsSaving(true);
      try {
        const quantity = toNumber(quantityValue);

        let photoUrl: string | null = null;
        if (photoUri) {
          if (!isOnline) {
            Alert.alert('Offline', 'Photo uploads require an internet connection.');
          } else {
            try {
              photoUrl = await uploadPhoto(photoUri, currentItem.inventory_item_id);
            } catch (err) {
              Alert.alert('Photo Upload Failed', 'Unable to upload the photo. Try again later.');
            }
          }
        }

        const method: StockUpdateMethod = scanMethod;

        await updateItemStock(currentItem.id, quantity, method, {
          notes: note || null,
          photoUrl,
          updatedBy: user?.id ?? undefined,
        });

        if (shouldComplete) {
          router.push({
            pathname: '/stock/completion',
            params: {
              areaId,
            },
          });
          return;
        }

        if (shouldAdvance) {
          animateToNext(() => nextItem());
        }
      } finally {
        setIsSaving(false);
      }
    },
    [
      currentItem,
      quantityValue,
      scanMethod,
      note,
      photoUri,
      isOnline,
      updateItemStock,
      nextItem,
      isSaving,
      uploadPhoto,
      user?.id,
      areaId,
      animateToNext,
    ]
  );

  const handleSkip = useCallback(() => {
    if (!currentItem) return;
    const prevCount = skippedItemCounts[currentItem.id] ?? 0;
    if (prevCount === 0) {
      showInlineToast('Moved to end of list');
    }
    animateToNext(() => skipItem());
  }, [animateToNext, currentItem, skippedItemCounts, skipItem, showInlineToast]);

  const handleAddNote = useCallback(() => {
    setNoteDraft(note);
    setShowNoteModal(true);
  }, [note]);

  const handleSaveNote = useCallback(() => {
    setNote(noteDraft);
    setShowNoteModal(false);
    setTimeout(() => quantityInputRef.current?.focus(), 80);
  }, [noteDraft]);

  const handlePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Camera access required',
        'Camera access is required to take photos.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: true,
    });

    if (!result.canceled) {
      setPendingPhotoUri(result.assets[0].uri);
      setShowPhotoPreview(true);
    }
  }, []);

  const handleUsePhoto = useCallback(() => {
    if (pendingPhotoUri) {
      setPhotoUri(pendingPhotoUri);
    }
    setPendingPhotoUri(null);
    setShowPhotoPreview(false);
    setTimeout(() => quantityInputRef.current?.focus(), 80);
  }, [pendingPhotoUri]);

  const handleRetakePhoto = useCallback(async () => {
    setPendingPhotoUri(null);
    setShowPhotoPreview(false);
    await handlePhoto();
  }, [handlePhoto]);

  const pauseAndExit = useCallback(async () => {
    if (!areaId) return;

    pauseCurrentSession(location?.id ?? null);
    setSessionNotice('Stock count paused.');

    await cancelStockCountPausedNotifications();

    router.replace('/(tabs)/stock');
  }, [
    areaId,
    location?.id,
    pauseCurrentSession,
    setSessionNotice,
  ]);

  const confirmPauseAndExit = useCallback(() => {
    Alert.alert(
      'Finish later?',
      'Your current progress will be saved and you can resume from Update Stock.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finish Later',
          onPress: () => {
            void pauseAndExit();
          },
        },
      ]
    );
  }, [pauseAndExit]);

  const handleGoBack = useCallback(() => {
    if (currentItemIndex <= 0) {
      showInlineToast('Already at first item');
      return;
    }

    animateToPrevious(() => previousItem());
  }, [animateToPrevious, currentItemIndex, previousItem, showInlineToast]);

  if (!areaId) {
    return null;
  }

  const countedItems = (currentSession?.items_checked ?? 0) + (currentSession?.items_skipped ?? 0);
  const progressIndex = totalItems > 0 ? Math.min(countedItems + 1, totalItems) : 0;
  const progressPercent = totalItems > 0 ? progressIndex / totalItems : 0;
  const currentSkipCount = currentItem ? skippedItemCounts[currentItem.id] ?? 0 : 0;

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <View className="flex-1">
          <View className="px-4 pt-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 items-start">
                <TouchableOpacity
                  onPress={confirmPauseAndExit}
                  className="h-10 w-10 items-center justify-center"
                >
                  <Ionicons name="chevron-back" size={24} color={colors.gray[800]} />
                </TouchableOpacity>
              </View>
              <View className="flex-1 items-center px-2">
                <Text className="text-base font-semibold text-gray-900">
                  {area?.name ?? 'Storage Area'}
                </Text>
              </View>
              <View className="flex-1 items-end">
                <Text className="text-xs text-gray-500">
                  {totalItems > 0 ? `${progressIndex} of ${totalItems} items` : 'Loading...'}
                </Text>
              </View>
            </View>

            <View className="mt-3 h-2 w-full rounded-full bg-gray-200">
              <View
                style={{
                  height: '100%',
                  borderRadius: 999,
                  backgroundColor: colors.primary[500],
                  width: `${Math.round(progressPercent * 100)}%`,
                }}
              />
            </View>
          </View>

          {!isOnline && (
            <View className="mx-4 mt-3 rounded-2xl bg-amber-100 px-4 py-3">
              <Text className="text-sm font-semibold text-amber-800">
                Offline mode - {pendingUpdates.length} updates pending
              </Text>
            </View>
          )}

          {isLoading ? (
            <View className="flex-1 items-center justify-center">
              <Text className="text-gray-500">Loading items...</Text>
            </View>
          ) : currentAreaItems.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <Text className="text-gray-500 text-center">
                No items assigned to this station.
              </Text>
            </View>
          ) : (
            <View className="flex-1 px-4 pb-4">
              <Animated.View style={{ transform: [{ translateX: slideAnim }], flex: 1 }}>
                <View className="flex-1 mt-4 rounded-3xl bg-white px-6 py-6 border border-gray-100 shadow-sm">
                  <View className="items-center">
                    <Text className="text-5xl">
                      {CATEGORY_EMOJI[currentItem.inventory_item.category] ?? '📦'}
                    </Text>
                    <Text className="mt-4 text-2xl font-bold text-gray-900 text-center">
                      {currentItem.inventory_item.name}
                    </Text>
                    <Text className="mt-1 text-sm text-gray-500">
                      {CATEGORY_LABELS[currentItem.inventory_item.category]}
                    </Text>
                    {currentSkipCount > 0 ? (
                      <View className="mt-2 rounded-full bg-amber-100 px-3 py-1">
                        <Text className="text-xs font-semibold text-amber-700">
                          {currentSkipCount >= 2 ? 'Skipped' : 'Skipped once'}
                        </Text>
                      </View>
                    ) : null}

                    <View className="mt-2" />
                  </View>

                  <View className="my-5 h-px bg-gray-200" />

                  <Text className="text-center text-sm font-semibold text-gray-600">
                    How many {currentItem.unit_type}?
                  </Text>

                  <View className="mt-4 items-center">
                    <View className="flex-row items-center">
                      <TouchableOpacity
                        className="h-12 w-12 rounded-full bg-gray-100 items-center justify-center"
                        onPress={() => handleIncrement(-1)}
                      >
                        <Ionicons name="remove" size={22} color={colors.gray[700]} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={1}
                        onPress={() => quantityInputRef.current?.focus()}
                        className="mx-5"
                      >
                        <TextInput
                          ref={quantityInputRef}
                          value={quantityValue}
                          onChangeText={handleChangeQuantity}
                          onFocus={handleQuantityFocus}
                          keyboardType="number-pad"
                          autoFocus
                          blurOnSubmit={false}
                          className="text-5xl font-bold text-gray-900 text-center min-w-[120px]"
                          returnKeyType="done"
                        />
                      </TouchableOpacity>

                      <TouchableOpacity
                        className="h-12 w-12 rounded-full bg-gray-100 items-center justify-center"
                        onPress={() => handleIncrement(1)}
                      >
                        <Ionicons name="add" size={22} color={colors.gray[700]} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View className="mt-auto pt-5">
                    <View className="flex-row items-center justify-between">
                      <TouchableOpacity
                        className="flex-1 rounded-full border border-gray-200 py-3 mr-2 items-center"
                        onPress={handleSkip}
                      >
                        <Text className="text-sm font-semibold text-gray-600">Skip</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="flex-1 rounded-full border border-gray-200 py-3 mr-2 items-center"
                        onPress={handleAddNote}
                      >
                        <Text className="text-sm font-semibold text-gray-600">Add Note</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="flex-1 rounded-full border border-gray-200 py-3 items-center"
                        onPress={handlePhoto}
                      >
                        <Text className="text-sm font-semibold text-gray-600">📷 Photo</Text>
                      </TouchableOpacity>
                    </View>

                    {note ? (
                      <View className="mt-3 rounded-2xl bg-blue-50 px-4 py-3">
                        <Text className="text-xs text-blue-700">Note: {note}</Text>
                      </View>
                    ) : null}

                    {photoUri ? (
                      <View className="mt-3 rounded-2xl bg-white px-4 py-3 border border-gray-100">
                        <View className="flex-row items-center justify-between">
                          <Text className="text-xs text-gray-500">Photo attached</Text>
                          <TouchableOpacity onPress={() => setPhotoUri(null)}>
                            <Ionicons name="close" size={16} color={colors.gray[400]} />
                          </TouchableOpacity>
                        </View>
                        <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                      </View>
                    ) : null}

                    <TouchableOpacity
                      className="mt-4 rounded-2xl bg-orange-500 py-4 items-center"
                      onPress={() => handleSaveItem(true, isLastItem)}
                      disabled={isSaving}
                    >
                      <Text className="text-base font-semibold text-white">
                        {isSaving ? 'Saving...' : isLastItem ? 'Finish' : 'Next Item →'}
                      </Text>
                    </TouchableOpacity>

                    <View className="mt-3 flex-row">
                      <TouchableOpacity
                        className="flex-1 rounded-2xl border border-gray-200 py-3 items-center mr-2"
                        onPress={handleGoBack}
                      >
                        <Text className="text-sm font-semibold text-gray-600">Go Back</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        className="flex-1 rounded-2xl border border-gray-200 py-3 items-center"
                        onPress={confirmPauseAndExit}
                      >
                        <Text className="text-sm font-semibold text-gray-600">Finish Later</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </Animated.View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {showToast && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Text className="text-white text-center font-medium">{toastMessage}</Text>
        </Animated.View>
      )}

      <Modal visible={showNoteModal} transparent animationType="fade" onRequestClose={() => setShowNoteModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add a note for this item</Text>
            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Type your note"
              multiline
              style={styles.modalInput}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setShowNoteModal(false)} style={styles.modalButtonSecondary}>
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSaveNote} style={styles.modalButtonPrimary}>
                <Text style={styles.modalButtonPrimaryText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showPhotoPreview}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPhotoPreview(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.photoModalCard}>
            <Text style={styles.modalTitle}>Review Photo</Text>
            {pendingPhotoUri ? (
              <Image source={{ uri: pendingPhotoUri }} style={styles.photoPreviewLarge} />
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={handleRetakePhoto} style={styles.modalButtonSecondary}>
                <Text style={styles.modalButtonSecondaryText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleUsePhoto} style={styles.modalButtonPrimary}>
                <Text style={styles.modalButtonPrimaryText}>Use Photo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  photoModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  modalInput: {
    marginTop: 12,
    minHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
    textAlignVertical: 'top',
  },
  modalActions: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalButtonSecondary: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginRight: 8,
  },
  modalButtonSecondaryText: {
    color: '#6B7280',
    fontWeight: '600',
  },
  modalButtonPrimary: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.primary[500],
  },
  modalButtonPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  photoPreview: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    marginTop: 8,
  },
  photoPreviewLarge: {
    width: '100%',
    height: 260,
    borderRadius: 16,
    marginTop: 16,
  },
  toast: {
    position: 'absolute',
    top: 110,
    left: 20,
    right: 20,
    backgroundColor: '#111827',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: 'center',
  },
});

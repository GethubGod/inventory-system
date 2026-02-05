import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { colors, CATEGORY_LABELS } from '@/constants';
import { useAuthStore, useStockStore } from '@/store';
import { ItemCategory, StockUpdateMethod, QuickSelectValue } from '@/types';
import { supabase } from '@/lib/supabase';

const CATEGORY_EMOJI: Record<ItemCategory, string> = {
  fish: '🐟',
  protein: '🥩',
  produce: '🥬',
  dry: '🍚',
  dairy_cold: '🧊',
  frozen: '❄️',
  sauces: '🍶',
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

function parseScanMethod(value: string | string[] | undefined): StockUpdateMethod {
  if (value === 'qr') return 'qr';
  if (value === 'nfc') return 'nfc';
  return 'manual';
}

function toNumber(value: string): number {
  const numeric = parseFloat(value);
  if (Number.isNaN(numeric)) return 0;
  return Math.max(0, numeric);
}

function getQuickRanges(min: number, max: number, par: number | null) {
  const safeMin = Math.max(0, Math.round(min));
  const safeMax = Math.max(safeMin, Math.round(max));
  const safePar = Math.min(Math.max(par ?? Math.round((safeMin + safeMax) / 2), safeMin), safeMax);

  const lowMax = Math.max(safeMin - 1, 1);
  const goodMax = Math.max(safeMin, Math.min(safePar, safeMax));
  const fullMin = Math.min(Math.max(safePar + 1, safeMin), safeMax);

  const formatRange = (start: number, end: number) =>
    start === end ? `${start}` : `${start}-${end}`;

  return {
    empty: { label: '0', value: 0 },
    low: {
      label: safeMin <= 1 ? '1' : formatRange(1, lowMax),
      value: safeMin <= 1 ? 1 : lowMax,
    },
    good: { label: formatRange(safeMin, goodMax), value: safePar },
    full: { label: formatRange(fullMin, safeMax), value: safeMax },
  } as const;
}

export default function StockCountingScreen() {
  const params = useLocalSearchParams();
  const areaId = Array.isArray(params.areaId) ? params.areaId[0] : params.areaId;
  const scanMethod = parseScanMethod(params.scanMethod);

  const { user } = useAuthStore();
  const {
    storageAreas,
    currentAreaItems,
    currentItemIndex,
    isLoading,
    isOnline,
    fetchAreaItems,
    startSession,
    updateItemStock,
    skipItem,
    nextItem,
    completeSession,
    abandonSession,
  } = useStockStore();

  const [quantityValue, setQuantityValue] = useState('0');
  const [selectedQuick, setSelectedQuick] = useState<QuickSelectValue | null>(null);
  const [note, setNote] = useState<string>('');
  const [noteDraft, setNoteDraft] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [pendingPhotoUri, setPendingPhotoUri] = useState<string | null>(null);
  const [showPhotoPreview, setShowPhotoPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const quantityInputRef = useRef<TextInput>(null);

  const area = useMemo(
    () => storageAreas.find((entry) => entry.id === areaId) ?? null,
    [storageAreas, areaId]
  );

  const currentItem = currentAreaItems[currentItemIndex];
  const totalItems = currentAreaItems.length;
  const isLastItem = totalItems > 0 && currentItemIndex === totalItems - 1;

  useEffect(() => {
    if (!areaId) return;

    const initialize = async () => {
      await fetchAreaItems(areaId);
      await startSession(areaId, scanMethod === 'qr' ? 'qr' : scanMethod === 'nfc' ? 'nfc' : 'manual');
    };

    initialize();
  }, [areaId, fetchAreaItems, startSession, scanMethod]);

  useEffect(() => {
    if (!currentItem) return;
    setQuantityValue(String(currentItem.current_quantity ?? 0));
    setSelectedQuick(null);
    setNote('');
    setNoteDraft('');
    setPhotoUri(null);
  }, [currentItem?.id]);

  const quickRanges = useMemo(() => {
    if (!currentItem) return null;
    return getQuickRanges(currentItem.min_quantity, currentItem.max_quantity, currentItem.par_level);
  }, [currentItem]);

  const handleSelectQuick = useCallback(
    (key: QuickSelectValue) => {
      if (!quickRanges) return;
      setSelectedQuick(key);
      setQuantityValue(String(quickRanges[key].value));
    },
    [quickRanges]
  );

  const handleChangeQuantity = useCallback((value: string) => {
    setSelectedQuick(null);
    setQuantityValue(value.replace(/[^0-9.]/g, ''));
  }, []);

  const handleIncrement = useCallback(
    async (delta: number) => {
      setSelectedQuick(null);
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

        const method: StockUpdateMethod = selectedQuick ? 'quick_select' : scanMethod;
        const quickSelectValue = selectedQuick ?? null;

        await updateItemStock(currentItem.id, quantity, method, {
          quickSelectValue,
          notes: note || null,
          photoUrl,
          updatedBy: user?.id ?? undefined,
        });

        if (shouldComplete) {
          await completeSession();
          router.back();
          return;
        }

        if (shouldAdvance) {
          nextItem();
        }
      } finally {
        setIsSaving(false);
      }
    },
    [
      currentItem,
      quantityValue,
      selectedQuick,
      scanMethod,
      note,
      photoUri,
      isOnline,
      updateItemStock,
      nextItem,
      completeSession,
      isSaving,
      uploadPhoto,
      user?.id,
    ]
  );

  const handleSkip = useCallback(() => {
    skipItem();
  }, [skipItem]);

  const handleAddNote = useCallback(() => {
    setNoteDraft(note);
    setShowNoteModal(true);
  }, [note]);

  const handleSaveNote = useCallback(() => {
    setNote(noteDraft);
    setShowNoteModal(false);
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
  }, [pendingPhotoUri]);

  const handleRetakePhoto = useCallback(async () => {
    setPendingPhotoUri(null);
    setShowPhotoPreview(false);
    await handlePhoto();
  }, [handlePhoto]);

  const handleBack = useCallback(() => {
    Alert.alert('Exit Counting?', 'You have unsaved progress. Exit anyway?', [
      {
        text: 'Continue Counting',
        style: 'cancel',
      },
      {
        text: 'Save & Exit',
        onPress: async () => {
          await handleSaveItem(false, false);
          await abandonSession();
          router.back();
        },
      },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          await abandonSession();
          router.back();
        },
      },
    ]);
  }, [handleSaveItem, abandonSession]);

  if (!areaId) {
    return null;
  }

  const progressPercent = totalItems > 0 ? (currentItemIndex + 1) / totalItems : 0;

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="px-4 pt-4">
          <View className="flex-row items-center justify-between">
            <TouchableOpacity onPress={handleBack}>
              <Ionicons name="chevron-back" size={24} color={colors.gray[800]} />
            </TouchableOpacity>
            <View className="flex-1 items-center">
              <Text className="text-base font-semibold text-gray-900">
                {area?.name ?? 'Storage Area'}
              </Text>
              <Text className="text-xs text-gray-500">
                {totalItems > 0 ? `${currentItemIndex + 1} of ${totalItems} items` : 'Loading...'}
              </Text>
            </View>
            <View style={{ width: 24 }} />
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

        {isLoading || !currentItem ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-gray-500">Loading items...</Text>
          </View>
        ) : (
          <View className="flex-1 px-4 pb-6">
            <View className="mt-5 rounded-3xl bg-white px-5 py-6 shadow-sm border border-gray-100">
              <View className="items-center">
                <Text className="text-5xl">
                  {CATEGORY_EMOJI[currentItem.inventory_item.category] ?? '📦'}
                </Text>
                <Text className="mt-3 text-2xl font-bold text-gray-900 text-center">
                  {currentItem.inventory_item.name}
                </Text>
                <Text className="mt-1 text-sm text-gray-500">
                  {CATEGORY_LABELS[currentItem.inventory_item.category]}
                </Text>
                <Text className="mt-3 text-sm text-gray-700">
                  Min: {currentItem.min_quantity} {currentItem.unit_type} • Max: {currentItem.max_quantity} {currentItem.unit_type}
                </Text>
                <Text className="mt-1 text-xs text-gray-400">
                  Last count: {currentItem.current_quantity} {currentItem.unit_type} • {getRelativeTimeLabel(currentItem.last_updated_at)}
                  {currentItem.last_updated_by ? ' by team member' : ''}
                </Text>
              </View>

              <View className="mt-6 items-center">
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
                    className="mx-4"
                  >
                    <TextInput
                      ref={quantityInputRef}
                      value={quantityValue}
                      onChangeText={handleChangeQuantity}
                      onFocus={handleQuantityFocus}
                      keyboardType="decimal-pad"
                      className="text-4xl font-bold text-gray-900 text-center min-w-[120px]"
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
                <Text className="mt-2 text-sm text-gray-500">{currentItem.unit_type}</Text>
              </View>

              {quickRanges && (
                <View className="mt-6">
                  <View className="flex-row justify-between">
                    {(['empty', 'low', 'good', 'full'] as QuickSelectValue[]).map((key) => {
                      const isActive = selectedQuick === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          className={`flex-1 rounded-2xl border px-3 py-2 mr-2 ${
                            isActive
                              ? 'border-orange-500 bg-orange-50'
                              : 'border-gray-200 bg-white'
                          }`}
                          onPress={() => handleSelectQuick(key)}
                        >
                          <Text
                            className={`text-sm font-semibold text-center ${
                              isActive ? 'text-orange-600' : 'text-gray-700'
                            }`}
                          >
                            {key.charAt(0).toUpperCase() + key.slice(1)}
                          </Text>
                          <Text className="text-xs text-gray-500 text-center mt-1">
                            {quickRanges[key].label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>

            <View className="mt-5 flex-row items-center justify-between">
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
              className="mt-6 rounded-full bg-orange-500 py-4 items-center"
              onPress={() => handleSaveItem(true, isLastItem)}
              disabled={isSaving}
            >
              <Text className="text-base font-semibold text-white">
                {isSaving ? 'Saving...' : isLastItem ? 'Finish' : 'Next Item →'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

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
});

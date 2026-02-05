import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Alert,
  Linking,
  Modal,
  useWindowDimensions,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { useAuthStore, useStockStore } from '@/store';
import { useNfcScanner, useStockNetworkStatus } from '@/hooks';
import { QrScannerModal } from '@/components';
import { CheckFrequency, StorageAreaWithStatus } from '@/types';

const CHECK_FREQUENCY_LABELS: Record<CheckFrequency, string> = {
  daily: 'Daily check required',
  every_2_days: 'Every 2 days',
  every_3_days: 'Every 3 days',
  weekly: 'Weekly check required',
};

const STATUS_COLORS: Record<StorageAreaWithStatus['check_status'], string> = {
  overdue: colors.error,
  due_soon: colors.warning,
  ok: colors.success,
};

const STATUS_LABELS: Record<StorageAreaWithStatus['check_status'], string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  ok: 'Checked',
};

const STATUS_EMOJI: Record<StorageAreaWithStatus['check_status'], string> = {
  overdue: '🔴',
  due_soon: '🟡',
  ok: '🟢',
};

function formatLastChecked(lastCheckedAt: string | null): string {
  if (!lastCheckedAt) return 'Never checked';
  const lastChecked = new Date(lastCheckedAt);
  const diffMs = Date.now() - lastChecked.getTime();

  if (Number.isNaN(diffMs) || diffMs < 0) return 'Never checked';

  const minutes = Math.round(diffMs / (1000 * 60));
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (minutes < 60) {
    return `Last checked: ${Math.max(1, minutes)} min ago`;
  }
  if (hours < 24) {
    return `Last checked: ${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  return `Last checked: ${days} day${days === 1 ? '' : 's'} ago`;
}

function getLocationLabel(name: string | null, shortCode: string | null): string {
  if (!name && !shortCode) return 'No location';
  const lower = (name || '').toLowerCase();
  if (lower.includes('sushi')) return 'Sushi';
  if (lower.includes('poki') || lower.includes('poke') || lower.includes('pho')) return 'Poki';
  return shortCode || name || 'Location';
}

export default function UpdateStockScreen() {
  const { location } = useAuthStore();
  const {
    storageAreas,
    pendingUpdates,
    isOnline,
    isLoading,
    error,
    fetchStorageAreas,
    prefetchAreaItems,
    syncPendingUpdates,
    lastSyncAt,
  } = useStockStore();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showBypassModal, setShowBypassModal] = useState(false);
  const [showSyncToast, setShowSyncToast] = useState(false);

  const {
    isSupported,
    isEnabled,
    isScanning,
    startScanning,
    stopScanning,
    lastScannedTag,
    error: nfcError,
  } = useNfcScanner();

  const pulse = useRef(new Animated.Value(0)).current;
  const { height: screenHeight } = useWindowDimensions();
  const nfcCardHeight = Math.max(320, screenHeight * 0.5);

  useStockNetworkStatus();

  const locationLabel = useMemo(
    () => getLocationLabel(location?.name ?? null, location?.short_code ?? null),
    [location?.name, location?.short_code]
  );

  const startPulse = useCallback(() => {
    pulse.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1400,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulse]);

  useEffect(() => {
    startPulse();
  }, [startPulse]);

  useEffect(() => {
    if (location?.id) {
      fetchStorageAreas(location.id).then(() => {
        const areaIds = useStockStore.getState().storageAreas.map((area) => area.id);
        prefetchAreaItems(areaIds);
      });
    }
  }, [location?.id, fetchStorageAreas, prefetchAreaItems]);

  useFocusEffect(
    useCallback(() => {
      if (location?.id) {
        fetchStorageAreas(location.id);
      }

      startScanning();

      return () => {
        stopScanning();
      };
    }, [location?.id, fetchStorageAreas, startScanning, stopScanning])
  );

  const onRefresh = useCallback(async () => {
    if (!location?.id) return;
    setIsRefreshing(true);
    await fetchStorageAreas(location.id);
    setIsRefreshing(false);
  }, [location?.id, fetchStorageAreas]);

  const handleStationPress = useCallback((area: StorageAreaWithStatus) => {
    Alert.alert(
      'Scan Required',
      `Please scan the NFC tag at ${area.name} to update stock.`
    );
  }, []);

  const handleScanQr = useCallback(() => {
    stopScanning();
    setShowQrModal(true);
  }, [stopScanning]);

  const handleBypassOpen = useCallback(() => {
    stopScanning();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowBypassModal(true);
  }, [stopScanning]);

  const handleBypassSelect = useCallback(
    (areaId: string) => {
      setShowBypassModal(false);
      router.push({
        pathname: '/stock/[areaId]',
        params: { areaId, scanMethod: 'manual' },
      });
    },
    [router]
  );

  const handleOpenSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  const handleDetectedTag = useCallback(
    async (tagId: string) => {
      const normalized = tagId.toLowerCase();
      const match = storageAreas.find(
        (area) => area.nfc_tag_id?.toLowerCase() === normalized
      );
      if (!match) {
        Alert.alert('Unregistered Tag', 'This NFC tag is not registered.');
        startScanning();
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push({
        pathname: '/stock/[areaId]',
        params: { areaId: match.id, scanMethod: 'nfc' },
      });
    },
    [storageAreas, startScanning]
  );

  const handleDetectedQr = useCallback(
    async (value: string) => {
      const normalized = value.toLowerCase();
      const match =
        storageAreas.find((area) => area.qr_code?.toLowerCase() === normalized) ||
        storageAreas.find((area) => area.id === value);

      if (!match) {
        Alert.alert('Unrecognized QR', 'This QR code is not registered.');
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push({
        pathname: '/stock/[areaId]',
        params: { areaId: match.id, scanMethod: 'qr' },
      });
    },
    [storageAreas]
  );

  useEffect(() => {
    if (isOnline && pendingUpdates.length > 0) {
      syncPendingUpdates();
    }
  }, [isOnline, pendingUpdates.length, syncPendingUpdates]);

  useEffect(() => {
    if (!showQrModal && isEnabled) {
      startScanning();
    }
  }, [showQrModal, isEnabled, startScanning]);

  useEffect(() => {
    if (!showBypassModal && !showQrModal && isEnabled) {
      startScanning();
    }
  }, [showBypassModal, showQrModal, isEnabled, startScanning]);

  useEffect(() => {
    if (!lastScannedTag) return;
    handleDetectedTag(lastScannedTag);
  }, [lastScannedTag, handleDetectedTag]);

  useEffect(() => {
    if (!lastSyncAt) return;
    if (pendingUpdates.length === 0) {
      setShowSyncToast(true);
      const timer = setTimeout(() => setShowSyncToast(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [lastSyncAt, pendingUpdates.length]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0],
  });

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        {!isOnline && (
          <View className="mx-4 mt-4 rounded-2xl bg-amber-100 px-4 py-3">
            <Text className="text-sm font-semibold text-amber-800">
              You&apos;re offline. Updates will sync when connected.
            </Text>
            <Text className="text-xs text-amber-700 mt-1">
              Pending updates: {pendingUpdates.length}
            </Text>
          </View>
        )}

        {!isSupported && nfcError && (
          <View className="mx-4 mt-4 rounded-full bg-blue-50 px-4 py-2 flex-row items-center">
            <Ionicons name="information-circle-outline" size={16} color={colors.info} />
            <Text className="ml-2 text-xs font-semibold text-blue-700">
              NFC unavailable in Expo Go — use QR.
            </Text>
          </View>
        )}

        {isSupported && !isEnabled && (
          <View className="mx-4 mt-4 rounded-2xl bg-amber-100 px-4 py-3 flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-amber-800">
                NFC is turned off. Enable it in Settings to scan tags.
              </Text>
            </View>
            <TouchableOpacity
              className="rounded-full bg-amber-600 px-3 py-2"
              onPress={handleOpenSettings}
            >
              <Text className="text-xs font-semibold text-white">Open Settings</Text>
            </TouchableOpacity>
          </View>
        )}

        <View className="px-4 pt-5 pb-2 flex-row items-start justify-between">
          <View>
            <Text className="text-2xl font-bold text-gray-900">Update Stock</Text>
            <View className="mt-2 flex-row items-center">
              <View className="flex-row items-center rounded-full bg-orange-100 px-3 py-1">
                <Ionicons name="location-outline" size={12} color={colors.primary[700]} />
                <Text className="ml-1 text-xs font-semibold text-orange-700">
                  {locationLabel}
                </Text>
              </View>
            </View>
          </View>

          {pendingUpdates.length > 0 && (
            <View className="flex-row items-center rounded-full bg-amber-100 px-3 py-1">
              <Ionicons name="cloud-upload-outline" size={14} color={colors.warning} />
              <Text className="ml-1 text-xs font-semibold text-amber-700">
                {pendingUpdates.length} pending
              </Text>
            </View>
          )}
        </View>

        <View className="px-4 mt-4">
          <View
            className="rounded-3xl bg-white px-5 py-6 shadow-sm border border-gray-100"
            style={{ minHeight: nfcCardHeight }}
          >
            <View className="flex-1 items-center justify-center pt-6">
              <View className="relative items-center justify-center">
                <Animated.View
                  style={[
                    styles.pulseRing,
                    {
                      opacity: pulseOpacity,
                      transform: [{ scale: pulseScale }],
                    },
                  ]}
                />
                <TouchableOpacity
                  className="h-16 w-16 rounded-2xl bg-orange-100 items-center justify-center"
                  onLongPress={handleBypassOpen}
                  delayLongPress={600}
                >
                  <Ionicons name="phone-portrait-outline" size={32} color={colors.primary[600]} />
                </TouchableOpacity>
              </View>
              <Text className="mt-4 text-lg font-semibold text-gray-900">
                Tap NFC Tag to Start
              </Text>
              <Text className="mt-1 text-sm text-gray-500 text-center">
                {isSupported || !nfcError
                  ? 'Hold your phone near the NFC tag at any storage station.'
                  : 'NFC unavailable. Use QR instead.'}
              </Text>
            </View>

            <TouchableOpacity
              className="mt-6 rounded-full border border-orange-200 px-4 py-2 flex-row items-center justify-center"
              onPress={handleScanQr}
            >
              <Ionicons name="qr-code-outline" size={16} color={colors.primary[600]} />
              <Text className="ml-2 text-sm font-semibold text-orange-700">
                Scan QR Instead
              </Text>
            </TouchableOpacity>

            <Text className="mt-3 text-xs text-gray-400 text-center">
              NFC scanning requires a physical device and NFC setup (react-native-nfc-manager).
            </Text>
          </View>
        </View>

        {nfcError && isSupported && isEnabled && (
          <View className="mx-4 mt-3 rounded-2xl bg-red-50 px-4 py-3">
            <Text className="text-xs text-red-700">{nfcError}</Text>
          </View>
        )}

        <View className="px-4 mt-6">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-semibold text-gray-500 tracking-widest">
              STATION STATUS
            </Text>
            {isScanning && (
              <View className="flex-row items-center">
                <View className="h-2 w-2 rounded-full bg-green-500 mr-2" />
                <Text className="text-xs text-gray-400">Listening for NFC</Text>
              </View>
            )}
          </View>

          {error && (
            <View className="mb-3 rounded-xl bg-red-50 px-3 py-2">
              <Text className="text-xs text-red-700">{error}</Text>
            </View>
          )}

          {storageAreas.length === 0 && !isLoading ? (
            <View className="rounded-2xl bg-white px-4 py-6 items-center border border-gray-100">
              <Text className="text-sm text-gray-500">No stations found for this location.</Text>
            </View>
          ) : (
            storageAreas.map((area) => {
              const statusColor = STATUS_COLORS[area.check_status];
              const statusLabel = STATUS_LABELS[area.check_status];
              const statusEmoji = STATUS_EMOJI[area.check_status];
              const itemCount = area.item_count ?? 0;

              return (
                <TouchableOpacity
                  key={area.id}
                  className="rounded-2xl bg-white px-4 py-4 mb-3 border border-gray-100"
                  onPress={() => handleStationPress(area)}
                  activeOpacity={0.8}
                >
                  <View className="flex-row items-start justify-between">
                    <View className="flex-row items-start">
                      <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                      <View className="ml-3">
                        <View className="flex-row items-center">
                          <Text className="text-lg mr-2">{area.icon || '📦'}</Text>
                          <Text className="text-base font-semibold text-gray-900">
                            {area.name}
                          </Text>
                        </View>
                        <Text className="mt-1 text-xs text-gray-500">
                          {formatLastChecked(area.last_checked_at)}
                        </Text>
                        <Text className="mt-1 text-xs text-gray-500">
                          {itemCount} item{itemCount === 1 ? '' : 's'} •{' '}
                          {CHECK_FREQUENCY_LABELS[area.check_frequency]}
                        </Text>
                      </View>
                    </View>
                    <View className="flex-row items-center">
                      <Text className="text-xs font-semibold text-gray-400 mr-2">
                        {statusEmoji} {statusLabel}
                      </Text>
                      <Ionicons name="chevron-forward" size={18} color={colors.gray[400]} />
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
      {showSyncToast && (
        <View style={styles.syncToast}>
          <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" />
          <Text style={styles.syncToastText}>Updates synced</Text>
        </View>
      )}
      <QrScannerModal
        visible={showQrModal}
        onClose={() => setShowQrModal(false)}
        onScan={handleDetectedQr}
      />
      <Modal
        visible={showBypassModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBypassModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-base font-semibold text-gray-900">Select Station</Text>
              <TouchableOpacity onPress={() => setShowBypassModal(false)}>
                <Ionicons name="close" size={20} color={colors.gray[600]} />
              </TouchableOpacity>
            </View>
            <Text className="text-xs text-gray-500 mb-3">
              Bypass scanning and choose a station manually.
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {storageAreas.length === 0 ? (
                <Text className="text-sm text-gray-500">No stations available.</Text>
              ) : (
                storageAreas.map((area) => (
                  <TouchableOpacity
                    key={area.id}
                    className="py-3 border-b border-gray-100"
                    onPress={() => handleBypassSelect(area.id)}
                  >
                    <View className="flex-row items-center">
                      <Text className="text-lg mr-2">{area.icon || '📦'}</Text>
                      <Text className="text-sm font-semibold text-gray-900">{area.name}</Text>
                    </View>
                    <Text className="text-xs text-gray-400 mt-1">
                      Last checked: {formatLastChecked(area.last_checked_at)}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pulseRing: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#FDBA74',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 6,
  },
  syncToast: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    backgroundColor: '#16A34A',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncToastText: {
    color: '#FFFFFF',
    fontWeight: '600',
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    maxHeight: '80%',
  },
});

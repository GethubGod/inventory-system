import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Alert,
  Modal,
  useWindowDimensions,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore, useStockStore, useDisplayStore } from '@/store';
import { useNfcScanner, useStockNetworkStatus } from '@/hooks';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { BrandLogo, QrScannerModal } from '@/components';
import type { CheckFrequency, Location, StorageAreaWithStatus } from '@/types';
import { cancelStockCountPausedNotifications } from '@/services/notificationService';

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


export default function UpdateStockScreen() {
  const { location, locations, setLocation, fetchLocations } = useAuthStore(useShallow((state) => ({
    location: state.location,
    locations: state.locations,
    setLocation: state.setLocation,
    fetchLocations: state.fetchLocations,
  })));
  const {
    storageAreas,
    pendingUpdates,
    isOnline,
    isLoading,
    fetchStorageAreas,
    prefetchAreaItems,
    syncPendingUpdates,
    pausedSession,
    discardPausedSession,
  } = useStockStore(useShallow((state) => ({
    storageAreas: state.storageAreas,
    pendingUpdates: state.pendingUpdates,
    isOnline: state.isOnline,
    isLoading: state.isLoading,
    fetchStorageAreas: state.fetchStorageAreas,
    prefetchAreaItems: state.prefetchAreaItems,
    syncPendingUpdates: state.syncPendingUpdates,
    pausedSession: state.pausedSession,
    discardPausedSession: state.discardPausedSession,
  })));
  const { reduceMotion } = useDisplayStore(useShallow((state) => ({
    reduceMotion: state.reduceMotion,
  })));
  const ds = useScaledStyles();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showBypassModal, setShowBypassModal] = useState(false);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);

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
  const nfcCardHeight = Math.max(260, screenHeight * 0.35);

  useStockNetworkStatus();

  const pausedSessionForLocation = useMemo(() => {
    if (!pausedSession) return null;
    if (!pausedSession.locationId) return pausedSession;
    if (!location?.id) return null;
    return pausedSession.locationId === location.id ? pausedSession : null;
  }, [location?.id, pausedSession]);

  const nfcButtonSize = Math.max(44, ds.icon(64));

  const startPulse = useCallback(() => {
    if (reduceMotion) return;
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
  }, [pulse, reduceMotion]);

  useEffect(() => {
    startPulse();
  }, [startPulse]);

  useEffect(() => {
    if (locations.length === 0) {
      fetchLocations();
    }
  }, [locations.length, fetchLocations]);

  useEffect(() => {
    if (!location && locations.length > 0) {
      setLocation(locations[0]);
    }
  }, [location, locations, setLocation]);

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

  const toggleLocationDropdown = useCallback(() => {
    setShowLocationDropdown((prev) => !prev);
  }, []);

  const handleSelectLocation = useCallback(
    async (selectedLocation: Location) => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setLocation(selectedLocation);
      setShowLocationDropdown(false);
    },
    [setLocation]
  );

  const handleResumeSession = useCallback(async () => {
    if (!pausedSessionForLocation) return;

    await cancelStockCountPausedNotifications();

    router.push({
      pathname: '/stock/[areaId]',
      params: {
        areaId: pausedSessionForLocation.areaId,
        scanMethod: pausedSessionForLocation.session.scan_method,
        resume: '1',
      },
    });
  }, [pausedSessionForLocation]);

  const handleDiscardSession = useCallback(() => {
    if (!pausedSessionForLocation) return;

    Alert.alert(
      'Discard paused stock count?',
      `Your paused count for ${pausedSessionForLocation.areaName} will be removed from this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await cancelStockCountPausedNotifications();
            discardPausedSession();
          },
        },
      ]
    );
  }, [discardPausedSession, pausedSessionForLocation]);

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
    []
  );

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
        contentContainerStyle={{ paddingBottom: ds.spacing(32), flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <View
          style={{
            paddingHorizontal: ds.spacing(16),
            paddingTop: ds.spacing(20),
            paddingBottom: ds.spacing(8),
          }}
        >
          <View className="flex-row items-center">
            <View className="flex-row items-center flex-1" style={{ minWidth: 0, paddingRight: ds.spacing(8) }}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={{
                  width: Math.max(44, ds.icon(40)),
                  height: Math.max(44, ds.icon(40)),
                  borderRadius: ds.radius(10),
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: ds.spacing(4),
                }}
              >
                <Ionicons name="arrow-back" size={ds.icon(22)} color={colors.gray[700]} />
              </TouchableOpacity>
              <Text
                className="font-bold text-gray-900"
                style={{ fontSize: ds.fontSize(22), flexShrink: 1 }}
                numberOfLines={1}
              >
                Update Stock
              </Text>
            </View>

            {pendingUpdates.length > 0 && (
              <View
                className="flex-row items-center rounded-full bg-amber-100"
                style={{ paddingHorizontal: ds.spacing(12), paddingVertical: ds.spacing(4) }}
              >
                <Ionicons name="cloud-upload-outline" size={ds.icon(14)} color={colors.warning} />
                <Text
                  className="font-semibold text-amber-700"
                  style={{ fontSize: ds.fontSize(12), marginLeft: ds.spacing(4) }}
                >
                  {pendingUpdates.length} pending
                </Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            className="flex-row items-center bg-gray-100 rounded-full self-start"
            style={{
              marginTop: ds.spacing(8),
              marginLeft: Math.max(44, ds.icon(40)) + ds.spacing(4),
              paddingHorizontal: ds.spacing(12),
              paddingVertical: ds.spacing(6),
              maxWidth: '100%',
            }}
            onPress={toggleLocationDropdown}
          >
            <Ionicons name="location" size={ds.icon(14)} color="#F97316" />
            <Text
              className="font-medium text-gray-900"
              style={{ fontSize: ds.fontSize(13), marginLeft: ds.spacing(6), flexShrink: 1 }}
              numberOfLines={1}
            >
              {location?.name || 'Select Location'}
            </Text>
            <Ionicons
              name={showLocationDropdown ? 'chevron-up' : 'chevron-down'}
              size={ds.icon(14)}
              color={colors.gray[500]}
              style={{ marginLeft: ds.spacing(4) }}
            />
          </TouchableOpacity>
        </View>

        {showLocationDropdown && (
          <View
            className="rounded-2xl bg-white border border-gray-100 overflow-hidden"
            style={{
              marginHorizontal: ds.spacing(16),
              marginTop: ds.spacing(4),
              marginBottom: ds.spacing(4),
            }}
          >
            {locations.map((loc) => {
              const isSelected = location?.id === loc.id;

              return (
                <TouchableOpacity
                  key={loc.id}
                  className={`flex-row items-center justify-between ${
                    isSelected ? 'bg-primary-50' : 'bg-white'
                  }`}
                  style={{
                    paddingHorizontal: ds.spacing(16),
                    paddingVertical: ds.spacing(12),
                  }}
                  onPress={() => handleSelectLocation(loc)}
                >
                  <View className="flex-row items-center">
                    <View
                      className={`rounded-full items-center justify-center ${
                        isSelected ? 'bg-primary-500' : 'bg-gray-200'
                      }`}
                      style={{
                        width: ds.spacing(32),
                        height: ds.spacing(32),
                        marginRight: ds.spacing(12),
                      }}
                    >
                      <BrandLogo variant="inline" size={16} colorMode={isSelected ? 'dark' : 'light'} />
                    </View>
                    <Text
                      className={`${isSelected ? 'font-semibold text-primary-700' : 'text-gray-800'}`}
                      style={{ fontSize: ds.fontSize(14) }}
                    >
                      {loc.name}
                    </Text>
                  </View>
                  {isSelected && <Ionicons name="checkmark" size={ds.icon(18)} color={colors.primary[500]} />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {pausedSessionForLocation && (
          <View
            className="rounded-3xl border border-orange-200 bg-orange-50"
            style={{
              marginHorizontal: ds.spacing(16),
              marginTop: ds.spacing(12),
              paddingHorizontal: ds.spacing(16),
              paddingVertical: ds.spacing(16),
            }}
          >
            <Text
              className="font-semibold text-orange-700 tracking-wide"
              style={{ fontSize: ds.fontSize(12) }}
            >
              RESUME STOCK COUNT
            </Text>
            <Text
              className="text-orange-900"
              style={{ fontSize: ds.fontSize(14), marginTop: ds.spacing(4) }}
            >
              You have an in-progress stock count for {pausedSessionForLocation.areaName}.
            </Text>

            <View className="flex-row" style={{ marginTop: ds.spacing(12) }}>
              <TouchableOpacity
                className="flex-1 rounded-full bg-orange-500 items-center"
                style={{
                  paddingVertical: ds.spacing(12),
                  marginRight: ds.spacing(8),
                  minHeight: ds.buttonH,
                  justifyContent: 'center',
                }}
                onPress={handleResumeSession}
              >
                <Text
                  className="font-semibold text-white"
                  style={{ fontSize: ds.buttonFont }}
                >
                  Resume
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="flex-1 rounded-full border border-orange-200 bg-white items-center"
                style={{
                  paddingVertical: ds.spacing(12),
                  minHeight: ds.buttonH,
                  justifyContent: 'center',
                }}
                onPress={handleDiscardSession}
              >
                <Text
                  className="font-semibold text-orange-700"
                  style={{ fontSize: ds.buttonFont }}
                >
                  Discard
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={{ paddingHorizontal: ds.spacing(16), marginTop: ds.spacing(16) }}>
          <View
            className="rounded-3xl bg-white shadow-sm border border-gray-100"
            style={{
              paddingHorizontal: ds.spacing(20),
              paddingVertical: ds.spacing(24),
              minHeight: nfcCardHeight,
            }}
          >
            <View className="flex-1 items-center justify-center" style={{ paddingTop: ds.spacing(16) }}>
              <View className="relative items-center justify-center">
                {!reduceMotion && (
                  <Animated.View
                    style={[
                      styles.pulseRing,
                      {
                        opacity: pulseOpacity,
                        transform: [{ scale: pulseScale }],
                      },
                    ]}
                  />
                )}
                <TouchableOpacity
                  className="rounded-full bg-orange-100 items-center justify-center"
                  style={{
                    width: nfcButtonSize,
                    height: nfcButtonSize,
                  }}
                  onLongPress={handleBypassOpen}
                  delayLongPress={600}
                >
                  <Ionicons name="phone-portrait-outline" size={ds.icon(28)} color={colors.primary[600]} />
                </TouchableOpacity>
              </View>
              <Text
                className="font-semibold text-gray-900"
                style={{ fontSize: ds.fontSize(18), marginTop: ds.spacing(16) }}
              >
                Tap NFC Tag to Start
              </Text>
              <Text
                className="text-gray-500 text-center"
                style={{ fontSize: ds.fontSize(14), marginTop: ds.spacing(4) }}
              >
                {isSupported || !nfcError
                  ? 'Hold your phone near the NFC tag at any storage station.'
                  : 'NFC unavailable. Use QR instead.'}
              </Text>
            </View>

            <TouchableOpacity
              className="rounded-full border border-orange-200 flex-row items-center justify-center"
              style={{
                marginTop: ds.spacing(24),
                paddingHorizontal: ds.buttonPadH,
                paddingVertical: ds.spacing(8),
                minHeight: ds.buttonH,
              }}
              onPress={handleScanQr}
            >
              <Ionicons name="qr-code-outline" size={ds.icon(16)} color={colors.primary[600]} />
              <Text
                className="font-semibold text-orange-700"
                style={{ fontSize: ds.fontSize(14), marginLeft: ds.spacing(8) }}
              >
                Scan QR Instead
              </Text>
            </TouchableOpacity>

            <Text
              className="text-gray-400 text-center"
              style={{ fontSize: ds.fontSize(11), marginTop: ds.spacing(12) }}
            >
              Hold your device near the tag or use QR to begin counting.
            </Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: ds.spacing(16), marginTop: ds.spacing(24) }}>
          <View
            className="flex-row items-center justify-between"
            style={{ marginBottom: ds.spacing(8) }}
          >
            <Text
              className="font-semibold text-gray-500 tracking-widest"
              style={{ fontSize: ds.fontSize(12) }}
            >
              STATION STATUS
            </Text>
            {isScanning && (
              <View className="flex-row items-center">
                <View
                  className="rounded-full bg-green-500"
                  style={{
                    width: ds.spacing(8),
                    height: ds.spacing(8),
                    marginRight: ds.spacing(8),
                  }}
                />
                <Text className="text-gray-400" style={{ fontSize: ds.fontSize(12) }}>
                  Listening for NFC
                </Text>
              </View>
            )}
          </View>

          {storageAreas.length === 0 && !isLoading ? (
            <View
              className="rounded-2xl bg-white items-center border border-gray-100"
              style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(24) }}
            >
              <Text className="text-gray-500" style={{ fontSize: ds.fontSize(14) }}>
                No stations found for this location.
              </Text>
            </View>
          ) : (
            storageAreas.map((area) => {
              const statusColor = STATUS_COLORS[area.check_status];
              const statusLabel = STATUS_LABELS[area.check_status];
              const itemCount = area.item_count ?? 0;

              return (
                <TouchableOpacity
                  key={area.id}
                  className="rounded-2xl bg-white border border-gray-100"
                  style={{
                    paddingHorizontal: ds.spacing(16),
                    paddingVertical: ds.spacing(16),
                    marginBottom: ds.spacing(12),
                  }}
                  onPress={() => handleStationPress(area)}
                  activeOpacity={0.8}
                >
                  <View className="flex-row items-start justify-between">
                    <View className="flex-row items-start">
                      <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                      <View style={{ marginLeft: ds.spacing(12) }}>
                        <View className="flex-row items-center">
                          <Text style={{ fontSize: ds.fontSize(18), marginRight: ds.spacing(8) }}>
                            {area.icon || '📦'}
                          </Text>
                          <Text
                            className="font-semibold text-gray-900"
                            numberOfLines={1}
                            style={{ fontSize: ds.fontSize(16) }}
                          >
                            {area.name}
                          </Text>
                        </View>
                        <Text
                          className="text-gray-500"
                          style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(4) }}
                        >
                          {formatLastChecked(area.last_checked_at)}
                        </Text>
                        <Text
                          className="text-gray-500"
                          style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(4) }}
                        >
                          {itemCount} item{itemCount === 1 ? '' : 's'} •{' '}
                          {CHECK_FREQUENCY_LABELS[area.check_frequency]}
                        </Text>
                      </View>
                    </View>
                    <View className="flex-row items-center">
                      <View
                        className="flex-row items-center rounded-full"
                        style={{
                          paddingHorizontal: ds.spacing(8),
                          paddingVertical: ds.spacing(3),
                          backgroundColor: statusColor + '18',
                          marginRight: ds.spacing(6),
                        }}
                      >
                        <View
                          style={{
                            width: ds.spacing(6),
                            height: ds.spacing(6),
                            borderRadius: 999,
                            backgroundColor: statusColor,
                            marginRight: ds.spacing(4),
                          }}
                        />
                        <Text
                          className="font-semibold"
                          style={{ fontSize: ds.fontSize(11), color: statusColor }}
                        >
                          {statusLabel}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={ds.icon(18)} color={colors.gray[400]} />
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
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
            <View
              className="flex-row items-center justify-between"
              style={{ marginBottom: ds.spacing(12) }}
            >
              <Text
                className="font-semibold text-gray-900"
                style={{ fontSize: ds.fontSize(16) }}
              >
                Select Station
              </Text>
              <TouchableOpacity onPress={() => setShowBypassModal(false)}>
                <Ionicons name="close" size={ds.icon(20)} color={colors.gray[600]} />
              </TouchableOpacity>
            </View>
            <Text
              className="text-gray-500"
              style={{ fontSize: ds.fontSize(12), marginBottom: ds.spacing(12) }}
            >
              Bypass scanning and choose a station manually.
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {storageAreas.length === 0 ? (
                <Text className="text-gray-500" style={{ fontSize: ds.fontSize(14) }}>
                  No stations available.
                </Text>
              ) : (
                storageAreas.map((area) => (
                  <TouchableOpacity
                    key={area.id}
                    className="border-b border-gray-100"
                    style={{ paddingVertical: ds.spacing(12) }}
                    onPress={() => handleBypassSelect(area.id)}
                  >
                    <View className="flex-row items-center">
                      <Text style={{ fontSize: ds.fontSize(18), marginRight: ds.spacing(8) }}>
                        {area.icon || '📦'}
                      </Text>
                      <Text
                        className="font-semibold text-gray-900"
                        numberOfLines={1}
                        style={{ fontSize: ds.fontSize(14) }}
                      >
                        {area.name}
                      </Text>
                    </View>
                    <Text
                      className="text-gray-400"
                      style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(4) }}
                    >
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

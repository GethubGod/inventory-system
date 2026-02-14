import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { BrandLogo } from './BrandLogo';
import { BottomSheetShell } from './BottomSheetShell';
import { resolveLocationSwitchTarget } from '@/features/cart/locationSwitch';

export interface ConfirmLocationOption {
  id: string;
  name: string;
  shortCode?: string;
}

interface ConfirmLocationBottomSheetProps {
  visible: boolean;
  selectedLocationId: string | null;
  locationOptions: ConfirmLocationOption[];
  isSubmitting?: boolean;
  onLocationChange: (locationId: string) => void;
  onNoLocationAvailable?: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmLocationBottomSheet({
  visible,
  selectedLocationId,
  locationOptions,
  isSubmitting = false,
  onLocationChange,
  onNoLocationAvailable,
  onConfirm,
  onClose,
}: ConfirmLocationBottomSheetProps) {
  const ds = useScaledStyles();
  const [viewMode, setViewMode] = useState<'confirm' | 'change'>('confirm');

  useEffect(() => {
    if (visible) {
      setViewMode('confirm');
    }
  }, [visible, selectedLocationId]);

  const selectedLocation = useMemo(() => {
    if (!selectedLocationId) return locationOptions[0] ?? null;
    return locationOptions.find((location) => location.id === selectedLocationId) ?? locationOptions[0] ?? null;
  }, [locationOptions, selectedLocationId]);

  const otherLocations = useMemo(
    () =>
      locationOptions.filter((location) =>
        selectedLocation ? location.id !== selectedLocation.id : true
      ),
    [locationOptions, selectedLocation]
  );

  const changeResolution = useMemo(
    () =>
      resolveLocationSwitchTarget({
        currentLocationId: selectedLocationId,
        availableLocationIds: locationOptions.map((location) => location.id),
      }),
    [locationOptions, selectedLocationId]
  );

  const handlePressChangeLocation = useCallback(() => {
    if (changeResolution.mode === 'toggle' && changeResolution.targetLocationId) {
      onLocationChange(changeResolution.targetLocationId);
      return;
    }

    if (changeResolution.mode === 'selector') {
      setViewMode('change');
      return;
    }

    onNoLocationAvailable?.();
  }, [changeResolution, onLocationChange, onNoLocationAvailable]);

  const submitLabel = selectedLocation
    ? `Submitting for ${selectedLocation.name}`
    : 'Submitting for selected location';

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      {viewMode === 'change' ? (
        <>
          <View style={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(8) }}>
            <Text style={{ fontSize: ds.fontSize(18) }} className="font-bold text-gray-900">
              Change Location
            </Text>
            <Text style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(4) }} className="text-gray-500">
              Select another location.
            </Text>
          </View>

          <ScrollView
            style={{ maxHeight: ds.spacing(360) }}
            contentContainerStyle={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(8) }}
            showsVerticalScrollIndicator={false}
          >
            {otherLocations.length > 0 ? (
              <View className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                {otherLocations.map((location, index) => (
                  <TouchableOpacity
                    key={location.id}
                    activeOpacity={0.75}
                    className={`flex-row items-center ${index < otherLocations.length - 1 ? 'border-b border-gray-100' : ''}`}
                    style={{ minHeight: Math.max(56, ds.rowH), paddingHorizontal: ds.spacing(14), paddingVertical: ds.spacing(10) }}
                    onPress={() => {
                      onLocationChange(location.id);
                      setViewMode('confirm');
                    }}
                  >
                    <View
                      style={{ width: ds.icon(36), height: ds.icon(36), borderRadius: ds.icon(18) }}
                      className="bg-gray-100 items-center justify-center"
                    >
                      <BrandLogo variant="inline" size={16} colorMode="light" />
                    </View>
                    <View className="flex-1" style={{ marginLeft: ds.spacing(12) }}>
                      <Text style={{ fontSize: ds.fontSize(16) }} className="font-medium text-gray-900">
                        {location.name}
                      </Text>
                    </View>
                    <Ionicons name="arrow-forward" size={ds.icon(18)} color={colors.gray[500]} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-5 items-center">
                <Text style={{ fontSize: ds.fontSize(14) }} className="text-gray-500 text-center">
                  No other cart locations available.
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => setViewMode('confirm')}
              className="py-4"
              style={{ marginTop: ds.spacing(4) }}
            >
              <Text style={{ fontSize: ds.fontSize(14) }} className="font-semibold text-gray-500 text-center">
                Back
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </>
      ) : (
        <>
          <View style={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(10) }}>
            <Text style={{ fontSize: ds.fontSize(18) }} className="font-bold text-gray-900">
              Confirm Location
            </Text>
          </View>

          <ScrollView
            style={{ maxHeight: ds.spacing(420) }}
            contentContainerStyle={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(8) }}
            showsVerticalScrollIndicator={false}
          >
            <View
              className="rounded-2xl border bg-white"
              style={{
                borderColor: colors.gray[200],
                backgroundColor: colors.gray[50],
                paddingHorizontal: ds.spacing(14),
                paddingVertical: ds.spacing(12),
              }}
            >
              <View className="flex-row items-center">
                <View
                  style={{ width: ds.icon(38), height: ds.icon(38), borderRadius: ds.icon(19) }}
                  className="bg-white items-center justify-center"
                >
                  <BrandLogo variant="inline" size={16} colorMode="light" />
                </View>
                <View className="flex-1" style={{ marginLeft: ds.spacing(12) }}>
                  <Text style={{ fontSize: ds.fontSize(16) }} className="font-semibold text-gray-900" numberOfLines={1}>
                    {selectedLocation?.name || 'Selected location'}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(10) }} className="text-gray-500">
              {submitLabel}
            </Text>

            <TouchableOpacity
              onPress={onConfirm}
              activeOpacity={0.8}
              disabled={isSubmitting || !selectedLocation}
              className={`${isSubmitting || !selectedLocation ? 'bg-primary-300' : 'bg-primary-500'} rounded-xl items-center justify-center flex-row`}
              style={{ minHeight: ds.buttonH, marginTop: ds.spacing(14) }}
            >
              {isSubmitting ? (
                <>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={{ fontSize: ds.buttonFont, marginLeft: ds.spacing(8) }} className="text-white font-semibold">
                    Submitting...
                  </Text>
                </>
              ) : (
                <Text style={{ fontSize: ds.buttonFont }} className="text-white font-semibold">
                  Confirm & Submit
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handlePressChangeLocation}
              activeOpacity={0.8}
              disabled={isSubmitting}
              className={`rounded-xl border items-center justify-center ${
                isSubmitting ? 'border-gray-200 bg-gray-100' : 'border-gray-200 bg-white'
              }`}
              style={{ minHeight: ds.buttonH, marginTop: ds.spacing(10) }}
            >
              <Text style={{ fontSize: ds.buttonFont }} className="font-semibold text-gray-700">
                Change Location
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onClose}
              disabled={isSubmitting}
              className="py-4"
              style={{ marginTop: ds.spacing(4) }}
            >
              <Text style={{ fontSize: ds.fontSize(14) }} className="font-semibold text-gray-500 text-center">
                Cancel
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </>
      )}
    </BottomSheetShell>
  );
}

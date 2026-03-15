import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, hairline, radii } from '@/theme/design';
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
            <Text style={{ fontSize: ds.fontSize(18), fontWeight: '700', color: colors.textPrimary }}>
              Change Location
            </Text>
            <Text style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(4), color: colors.textSecondary }}>
              Select another location.
            </Text>
          </View>

          <ScrollView
            style={{ maxHeight: ds.spacing(360) }}
            contentContainerStyle={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(8) }}
            showsVerticalScrollIndicator={false}
          >
            {otherLocations.length > 0 ? (
              <View style={{ borderRadius: radii.button, borderWidth: hairline, borderColor: colors.glassBorder, backgroundColor: colors.white, overflow: 'hidden' }}>
                {otherLocations.map((location, index) => (
                  <TouchableOpacity
                    key={location.id}
                    activeOpacity={0.75}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      minHeight: Math.max(56, ds.rowH),
                      paddingHorizontal: ds.spacing(16),
                      paddingVertical: ds.spacing(10),
                      borderBottomWidth: index < otherLocations.length - 1 ? hairline : 0,
                      borderBottomColor: colors.divider,
                    }}
                    onPress={() => {
                      onLocationChange(location.id);
                      setViewMode('confirm');
                    }}
                  >
                    <View
                      style={{
                        width: ds.icon(40),
                        height: ds.icon(40),
                        borderRadius: ds.icon(20),
                        backgroundColor: colors.background,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <BrandLogo variant="inline" size={18} colorMode="light" />
                    </View>
                    <View style={{ flex: 1, marginLeft: ds.spacing(12) }}>
                      <Text style={{ fontSize: ds.fontSize(16), fontWeight: '500', color: colors.textPrimary }}>
                        {location.name}
                      </Text>
                    </View>
                    <Ionicons name="arrow-forward" size={ds.icon(18)} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={{ borderRadius: radii.button, borderWidth: hairline, borderColor: colors.glassBorder, backgroundColor: colors.background, paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(20), alignItems: 'center' }}>
                <Text style={{ fontSize: ds.fontSize(14), color: colors.textSecondary, textAlign: 'center' }}>
                  No other cart locations available.
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => setViewMode('confirm')}
              style={{ paddingVertical: ds.spacing(16), marginTop: ds.spacing(4) }}
            >
              <Text style={{ fontSize: ds.fontSize(15), fontWeight: '600', color: colors.textSecondary, textAlign: 'center' }}>
                Back
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </>
      ) : (
        <>
          <View style={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(10) }}>
            <Text style={{ fontSize: ds.fontSize(18), fontWeight: '700', color: colors.textPrimary }}>
              Confirm Location
            </Text>
          </View>

          <ScrollView
            style={{ maxHeight: ds.spacing(420) }}
            contentContainerStyle={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(8) }}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={{
                borderRadius: radii.button,
                borderWidth: hairline,
                borderColor: colors.glassBorder,
                backgroundColor: colors.background,
                paddingHorizontal: ds.spacing(16),
                paddingVertical: ds.spacing(14),
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                  style={{
                    width: ds.icon(42),
                    height: ds.icon(42),
                    borderRadius: ds.icon(21),
                    backgroundColor: colors.white,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <BrandLogo variant="inline" size={18} colorMode="light" />
                </View>
                <View style={{ flex: 1, marginLeft: ds.spacing(12) }}>
                  <Text style={{ fontSize: ds.fontSize(17), fontWeight: '600', color: colors.textPrimary }} numberOfLines={1}>
                    {selectedLocation?.name || 'Selected location'}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(10), color: colors.textSecondary }}>
              {submitLabel}
            </Text>

            <TouchableOpacity
              onPress={onConfirm}
              activeOpacity={0.8}
              disabled={isSubmitting || !selectedLocation}
              style={{
                minHeight: ds.buttonH,
                marginTop: ds.spacing(14),
                borderRadius: radii.submitButton,
                backgroundColor: isSubmitting || !selectedLocation ? colors.primaryLight : colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
              }}
            >
              {isSubmitting ? (
                <>
                  <ActivityIndicator color={colors.white} size="small" />
                  <Text style={{ fontSize: ds.fontSize(17), marginLeft: ds.spacing(8), color: colors.white, fontWeight: '600' }}>
                    Submitting...
                  </Text>
                </>
              ) : (
                <Text style={{ fontSize: ds.fontSize(17), color: colors.white, fontWeight: '600' }}>
                  Confirm & Submit
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handlePressChangeLocation}
              activeOpacity={0.8}
              disabled={isSubmitting}
              style={{
                minHeight: ds.buttonH,
                marginTop: ds.spacing(10),
                borderRadius: radii.submitButton,
                borderWidth: 1.5,
                borderColor: 'rgba(0,0,0,0.15)',
                backgroundColor: isSubmitting ? colors.background : colors.white,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: ds.fontSize(17), fontWeight: '600', color: colors.textPrimary }}>
                Change Location
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onClose}
              disabled={isSubmitting}
              style={{ paddingVertical: ds.spacing(16), marginTop: ds.spacing(4) }}
            >
              <Text style={{ fontSize: ds.fontSize(15), fontWeight: '600', color: colors.textSecondary, textAlign: 'center' }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </>
      )}
    </BottomSheetShell>
  );
}

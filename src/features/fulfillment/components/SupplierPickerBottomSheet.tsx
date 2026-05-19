import React, { memo, useCallback, useMemo } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';

export interface SupplierPickerOption {
  id: string;
  name: string;
}

interface SupplierPickerBottomSheetProps {
  visible: boolean;
  itemName?: string;
  suppliers: SupplierPickerOption[];
  currentSupplierId: string | null;
  isMoving?: boolean;
  onSelect: (supplierId: string) => void;
  onClose: () => void;
}

interface SupplierRowProps {
  supplier: SupplierPickerOption;
  isLast: boolean;
  disabled: boolean;
  onSelect: (supplierId: string) => void;
}

const SupplierRow = memo(function SupplierRow({
  supplier,
  isLast,
  disabled,
  onSelect,
}: SupplierRowProps) {
  const ds = useScaledStyles();
  const handlePress = useCallback(() => onSelect(supplier.id), [onSelect, supplier.id]);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={supplier.name}
      activeOpacity={0.75}
      disabled={disabled}
      onPress={handlePress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: Math.max(56, ds.rowH),
        paddingHorizontal: ds.spacing(16),
        paddingVertical: ds.spacing(10),
        borderBottomWidth: isLast ? 0 : glassHairlineWidth,
        borderBottomColor: glassColors.divider,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: ds.icon(36),
          height: ds.icon(36),
          borderRadius: ds.icon(18),
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: glassColors.mediumFill,
          marginRight: ds.spacing(12),
        }}
      >
        <Ionicons name="storefront-outline" size={ds.icon(18)} color={glassColors.textPrimary} />
      </View>
      <Text
        style={{
          flex: 1,
          fontSize: ds.fontSize(16),
          fontWeight: '600',
          color: glassColors.textPrimary,
        }}
        numberOfLines={2}
      >
        {supplier.name}
      </Text>
      <Ionicons name="chevron-forward" size={ds.icon(16)} color={glassColors.textSecondary} />
    </TouchableOpacity>
  );
});

export const SupplierPickerBottomSheet = memo(function SupplierPickerBottomSheet({
  visible,
  itemName,
  suppliers,
  currentSupplierId,
  isMoving = false,
  onSelect,
  onClose,
}: SupplierPickerBottomSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  const selectableSuppliers = useMemo(
    () =>
      suppliers.filter((supplier) => {
        if (!currentSupplierId) return true;
        return supplier.id !== currentSupplierId;
      }),
    [currentSupplierId, suppliers]
  );

  const handleSelect = useCallback(
    (supplierId: string) => {
      if (isMoving) return;
      onSelect(supplierId);
    },
    [isMoving, onSelect]
  );

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(ds.spacing(10), insets.bottom + ds.spacing(8))}
    >
      <View style={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(8) }}>
        <Text
          style={{
            fontSize: ds.fontSize(20),
            fontWeight: '700',
            color: glassColors.textPrimary,
            letterSpacing: -0.3,
          }}
        >
          Choose Supplier
        </Text>
        {itemName ? (
          <Text
            style={{
              fontSize: ds.fontSize(13),
              marginTop: ds.spacing(6),
              color: glassColors.textSecondary,
              lineHeight: ds.fontSize(18),
            }}
          >
            {itemName}
          </Text>
        ) : null}
      </View>

      <ScrollView
        style={{ maxHeight: ds.spacing(432) }}
        contentContainerStyle={{
          paddingHorizontal: ds.spacing(6),
          paddingBottom: ds.spacing(4),
        }}
        showsVerticalScrollIndicator={false}
      >
        {isMoving ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: ds.spacing(24),
            }}
          >
            <ActivityIndicator color={glassColors.accent} size="small" />
            <Text
              style={{
                marginLeft: ds.spacing(10),
                fontSize: ds.fontSize(14),
                color: glassColors.textSecondary,
              }}
            >
              Moving item...
            </Text>
          </View>
        ) : selectableSuppliers.length === 0 ? (
          <View
            style={{
              borderRadius: glassRadii.surface,
              borderWidth: glassHairlineWidth,
              borderColor: glassColors.cardBorder,
              backgroundColor: colors.white,
              paddingHorizontal: ds.spacing(16),
              paddingVertical: ds.spacing(24),
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(14),
                color: glassColors.textSecondary,
                textAlign: 'center',
                lineHeight: ds.fontSize(20),
              }}
            >
              No other suppliers are available.
            </Text>
          </View>
        ) : (
          <View
            style={{
              borderRadius: glassRadii.surface,
              borderWidth: glassHairlineWidth,
              borderColor: glassColors.cardBorder,
              backgroundColor: colors.white,
              overflow: 'hidden',
            }}
          >
            {selectableSuppliers.map((supplier, index) => (
              <SupplierRow
                key={supplier.id}
                supplier={supplier}
                isLast={index === selectableSuppliers.length - 1}
                disabled={isMoving}
                onSelect={handleSelect}
              />
            ))}
          </View>
        )}

        <TouchableOpacity
          onPress={onClose}
          disabled={isMoving}
          style={{
            paddingVertical: ds.spacing(16),
            marginTop: ds.spacing(4),
            opacity: isMoving ? 0.5 : 1,
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '600',
              color: glassColors.textSecondary,
              textAlign: 'center',
            }}
          >
            Cancel
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </BottomSheetShell>
  );
});

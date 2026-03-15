import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, hairline, radii } from '@/theme/design';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { BottomSheetShell } from './BottomSheetShell';

export interface OrderLaterSupplierOption {
  id: string;
  name: string;
}

interface OrderLaterAddToSheetProps {
  visible: boolean;
  itemName?: string;
  suppliers: OrderLaterSupplierOption[];
  selectedSupplierId: string | null;
  supplierError?: string | null;
  isSubmitting?: boolean;
  onSupplierChange: (supplierId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function OrderLaterAddToSheet({
  visible,
  itemName,
  suppliers,
  selectedSupplierId,
  supplierError = null,
  isSubmitting = false,
  onSupplierChange,
  onConfirm,
  onClose,
}: OrderLaterAddToSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const [showSupplierPicker, setShowSupplierPicker] = useState(false);

  useEffect(() => {
    if (visible) {
      setShowSupplierPicker(false);
    }
  }, [visible]);

  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === selectedSupplierId) ?? null,
    [selectedSupplierId, suppliers]
  );
  const confirmDisabled = isSubmitting || !selectedSupplierId;

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(ds.spacing(10), insets.bottom + ds.spacing(8))}
    >
      <View style={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(10) }}>
        <Text style={{ fontSize: ds.fontSize(18), fontWeight: '700', color: colors.textPrimary }}>
          Add to Supplier
        </Text>
        {itemName ? (
          <Text style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(4), color: colors.textSecondary }}>
            {itemName}
          </Text>
        ) : null}
      </View>

      <ScrollView
        style={{ maxHeight: ds.spacing(360) }}
        contentContainerStyle={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(4) }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={{
            fontSize: ds.fontSize(12),
            marginBottom: ds.spacing(6),
            marginLeft: ds.spacing(6),
            fontWeight: '600',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: colors.textSecondary,
          }}
        >
          Supplier
        </Text>
        <View style={{ borderRadius: radii.button, borderWidth: hairline, borderColor: colors.glassBorder, backgroundColor: colors.white, overflow: 'hidden' }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: Math.max(56, ds.rowH),
              paddingHorizontal: ds.spacing(16),
              paddingVertical: ds.spacing(10),
            }}
          >
            <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
              <Text style={{ fontSize: ds.fontSize(16), fontWeight: '500', color: colors.textPrimary }}>
                {selectedSupplier?.name || 'Select supplier'}
              </Text>
              {!selectedSupplier && (
                <Text style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(2), color: colors.textSecondary }}>
                  A supplier is required to add this item.
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={() => setShowSupplierPicker((prev) => !prev)}
              style={{
                paddingHorizontal: ds.spacing(12),
                paddingVertical: ds.spacing(8),
                borderRadius: radii.tag,
                borderWidth: hairline,
                borderColor: colors.glassBorder,
                backgroundColor: colors.background,
              }}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: ds.fontSize(13), fontWeight: '600', color: colors.textPrimary }}>
                {showSupplierPicker ? 'Done' : 'Change'}
              </Text>
            </TouchableOpacity>
          </View>

          {showSupplierPicker && (
            <View style={{ borderTopWidth: hairline, borderTopColor: colors.divider }}>
              {suppliers.length === 0 ? (
                <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(16) }}>
                  <Text style={{ fontSize: ds.fontSize(13), color: colors.textSecondary }}>
                    No suppliers are available.
                  </Text>
                </View>
              ) : (
                suppliers.map((supplier, index) => {
                  const selected = supplier.id === selectedSupplierId;
                  return (
                    <TouchableOpacity
                      key={supplier.id}
                      onPress={() => {
                        onSupplierChange(supplier.id);
                        setShowSupplierPicker(false);
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        minHeight: Math.max(52, ds.rowH),
                        paddingHorizontal: ds.spacing(16),
                        paddingVertical: ds.spacing(9),
                        borderBottomWidth: index < suppliers.length - 1 ? hairline : 0,
                        borderBottomColor: colors.divider,
                      }}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={{
                          fontSize: ds.fontSize(15),
                          fontWeight: selected ? '600' : '500',
                          color: selected ? colors.primary : colors.textPrimary,
                        }}
                      >
                        {supplier.name}
                      </Text>
                      {selected && (
                        <Ionicons name="checkmark-circle" size={ds.icon(20)} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}
        </View>

        {supplierError ? (
          <Text style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(8), color: colors.primary, fontWeight: '500' }}>
            {supplierError}
          </Text>
        ) : null}
      </ScrollView>

      <View style={{ paddingHorizontal: ds.spacing(6), paddingTop: ds.spacing(10) }}>
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity
            onPress={onClose}
            disabled={isSubmitting}
            style={{
              flex: 1,
              borderRadius: radii.submitButton,
              borderWidth: hairline,
              borderColor: colors.glassBorder,
              backgroundColor: colors.white,
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: ds.buttonH,
              marginRight: ds.spacing(8),
            }}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: ds.fontSize(17), fontWeight: '600', color: colors.textPrimary }}>
              Cancel
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onConfirm}
            disabled={confirmDisabled}
            style={{
              flex: 1,
              borderRadius: radii.submitButton,
              backgroundColor: confirmDisabled ? colors.primaryLight : colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: ds.buttonH,
            }}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ActivityIndicator color={colors.white} size="small" />
                <Text style={{ fontSize: ds.fontSize(17), marginLeft: ds.spacing(8), fontWeight: '600', color: colors.white }}>
                  Adding...
                </Text>
              </View>
            ) : (
              <Text style={{ fontSize: ds.fontSize(17), fontWeight: '600', color: colors.white }}>
                Add
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheetShell>
  );
}

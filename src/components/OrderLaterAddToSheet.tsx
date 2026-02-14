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
import { colors } from '@/constants';
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
        <Text style={{ fontSize: ds.fontSize(18) }} className="font-bold text-gray-900">
          Add to Supplier
        </Text>
        {itemName ? (
          <Text style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(4) }} className="text-gray-500">
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
            fontSize: ds.fontSize(11),
            marginBottom: ds.spacing(6),
            marginLeft: ds.spacing(6),
          }}
          className="font-semibold uppercase tracking-wide text-gray-500"
        >
          Supplier
        </Text>
        <View className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <View
            className="flex-row items-center justify-between"
            style={{
              minHeight: Math.max(56, ds.rowH),
              paddingHorizontal: ds.spacing(14),
              paddingVertical: ds.spacing(10),
            }}
          >
            <View className="flex-1 pr-3">
              <Text style={{ fontSize: ds.fontSize(16) }} className="font-medium text-gray-900">
                {selectedSupplier?.name || 'Select supplier'}
              </Text>
              {!selectedSupplier && (
                <Text style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(2) }} className="text-gray-500">
                  A supplier is required to add this item.
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={() => setShowSupplierPicker((prev) => !prev)}
              className="px-3 py-2 rounded-lg border border-gray-200 bg-gray-50"
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: ds.fontSize(13) }} className="font-semibold text-gray-700">
                {showSupplierPicker ? 'Done' : 'Change'}
              </Text>
            </TouchableOpacity>
          </View>

          {showSupplierPicker && (
            <View className="border-t border-gray-100">
              {suppliers.length === 0 ? (
                <View className="px-4 py-4">
                  <Text style={{ fontSize: ds.fontSize(13) }} className="text-gray-500">
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
                      className={`flex-row items-center justify-between ${
                        index < suppliers.length - 1 ? 'border-b border-gray-100' : ''
                      }`}
                      style={{
                        minHeight: Math.max(52, ds.rowH),
                        paddingHorizontal: ds.spacing(14),
                        paddingVertical: ds.spacing(9),
                      }}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={{ fontSize: ds.fontSize(15) }}
                        className={selected ? 'font-semibold text-primary-700' : 'font-medium text-gray-700'}
                      >
                        {supplier.name}
                      </Text>
                      {selected && (
                        <Ionicons name="checkmark-circle" size={ds.icon(18)} color={colors.primary[500]} />
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}
        </View>

        {supplierError ? (
          <Text style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(8) }} className="text-red-600 font-medium">
            {supplierError}
          </Text>
        ) : null}
      </ScrollView>

      <View style={{ paddingHorizontal: ds.spacing(6), paddingTop: ds.spacing(10) }}>
        <View className="flex-row">
          <TouchableOpacity
            onPress={onClose}
            disabled={isSubmitting}
            className="flex-1 rounded-xl border border-gray-200 bg-white items-center justify-center mr-2"
            style={{ minHeight: ds.buttonH }}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: ds.buttonFont }} className="font-semibold text-gray-700">
              Cancel
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onConfirm}
            disabled={confirmDisabled}
            className={`flex-1 rounded-xl items-center justify-center ${
              confirmDisabled ? 'bg-primary-300' : 'bg-primary-500'
            }`}
            style={{ minHeight: ds.buttonH }}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <View className="flex-row items-center">
                <ActivityIndicator color="#FFFFFF" size="small" />
                <Text
                  style={{ fontSize: ds.buttonFont, marginLeft: ds.spacing(8) }}
                  className="font-semibold text-white"
                >
                  Adding...
                </Text>
              </View>
            ) : (
              <Text style={{ fontSize: ds.buttonFont }} className="font-semibold text-white">
                Add
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheetShell>
  );
}

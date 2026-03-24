import React from 'react';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import type { FulfillmentSupplierPreviewItem } from './FulfillmentSupplierCard';

const BADGE_PALETTE = [
  { background: '#EAF1FF', text: '#5A84EF' },
  { background: '#FFF1DE', text: '#D38A1E' },
  { background: '#EEF8EF', text: '#41A868' },
  { background: '#F3ECFB', text: '#8B5FB6' },
] as const;

interface FulfillmentExpandedSupplierItemsProps {
  items: FulfillmentSupplierPreviewItem[];
  orderLabel: string;
  onOrderPress: () => void;
}

export function FulfillmentExpandedSupplierItems({
  items,
  orderLabel,
  onOrderPress,
}: FulfillmentExpandedSupplierItemsProps) {
  const ds = useScaledStyles();

  return (
    <View style={{ paddingHorizontal: ds.spacing(24), paddingBottom: ds.spacing(24), paddingTop: ds.spacing(8) }}>
      {items.map((item, index) => {
        const palette = BADGE_PALETTE[Math.abs(item.badgeToneIndex) % BADGE_PALETTE.length];

        return (
          <Pressable
            key={item.id}
            onPress={item.onPress || undefined}
            style={({ pressed }) => ({
              backgroundColor: '#FFFFFF',
              borderRadius: 12,
              borderWidth: glassHairlineWidth,
              borderColor: '#EFEFEF',
              opacity: item.onPress && pressed ? 0.96 : 1,
              paddingHorizontal: ds.spacing(16),
              paddingVertical: ds.spacing(16),
              marginTop: index === 0 ? 0 : ds.spacing(10),
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1, paddingRight: ds.spacing(10) }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'nowrap' }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: glassColors.textPrimary,
                      fontSize: ds.fontSize(15),
                      fontWeight: '700',
                      flexShrink: 1,
                    }}
                  >
                    {item.name}
                  </Text>
                  <Text
                    style={{
                      color: glassColors.textSecondary,
                      fontSize: ds.fontSize(13),
                      fontWeight: '500',
                      marginLeft: ds.spacing(6),
                    }}
                  >
                    {item.quantityLabel}
                  </Text>
                </View>

                {item.summaryLabel && item.isRemaining ? (
                  <Text
                    style={{
                      color: glassColors.textSecondary,
                      fontSize: ds.fontSize(12),
                      marginTop: ds.spacing(6),
                    }}
                  >
                    {item.summaryLabel}
                  </Text>
                ) : null}
              </View>

              {item.badgeLabel ? (
                <View
                  style={{
                    minWidth: 22,
                    height: 22,
                    paddingHorizontal: ds.spacing(6),
                    borderRadius: 11,
                    backgroundColor: palette.background,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: palette.text,
                      fontSize: ds.fontSize(9),
                      fontWeight: '700',
                    }}
                  >
                    {item.badgeLabel}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      <TouchableOpacity
        onPress={onOrderPress}
        activeOpacity={0.88}
        style={{
          marginTop: ds.spacing(24),
          minHeight: Math.max(52, ds.buttonH + 10),
          paddingHorizontal: ds.spacing(24),
          paddingVertical: ds.spacing(14),
          borderRadius: glassRadii.pill,
          backgroundColor: glassColors.accent,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: 'rgba(15, 23, 42, 0.22)',
          shadowOpacity: 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 2,
        }}
      >
        <Text
          style={{
            color: glassColors.textOnPrimary,
            fontSize: ds.fontSize(17),
            fontWeight: '700',
          }}
        >
          {orderLabel}
        </Text>
        <Ionicons
          name="chevron-forward"
          size={ds.icon(20)}
          color={glassColors.textOnPrimary}
          style={{ marginLeft: ds.spacing(6) }}
        />
      </TouchableOpacity>
    </View>
  );
}

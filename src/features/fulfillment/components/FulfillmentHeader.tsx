import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassRadii } from '@/theme/design';

interface FulfillmentHeaderProps {
  title?: string;
  historyLabel?: string;
  onHistoryPress: () => void;
}

export function FulfillmentHeader({
  title = 'Fulfillment',
  historyLabel = 'History',
  onHistoryPress,
}: FulfillmentHeaderProps) {
  const ds = useScaledStyles();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: ds.spacing(16) }}>
      <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
        <Text
          style={{
            fontSize: ds.fontSize(31),
            fontWeight: '800',
            color: glassColors.textPrimary,
            letterSpacing: -0.8,
          }}
        >
          {title}
        </Text>
      </View>

      <GlassSurface intensity="subtle" style={{ borderRadius: glassRadii.pill }}>
        <TouchableOpacity
          onPress={onHistoryPress}
          activeOpacity={0.7}
          style={{
            minHeight: 38,
            paddingHorizontal: ds.spacing(14),
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Ionicons name="time-outline" size={ds.icon(15)} color={glassColors.textSecondary} />
          <Text
            style={{
              marginLeft: ds.spacing(6),
              fontSize: ds.fontSize(13),
              fontWeight: '600',
              color: glassColors.textPrimary,
            }}
          >
            {historyLabel}
          </Text>
        </TouchableOpacity>
      </GlassSurface>
    </View>
  );
}

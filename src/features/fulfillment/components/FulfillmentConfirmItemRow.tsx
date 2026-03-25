import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';
import { GlassSurface } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassRadii, glassHairlineWidth } from '@/theme/design';

type ChipTone = 'amber' | 'gray' | 'blue';

export interface FulfillmentConfirmItemChip {
  id: string;
  label: string;
  tone?: ChipTone;
}

interface FulfillmentConfirmItemRowProps {
  title: string;
  headerActions?: React.ReactNode;
  chips?: FulfillmentConfirmItemChip[];
  trailingChip?: React.ReactNode;
  quantityValue: string;
  onQuantityChangeText: (value: string) => void;
  onDecrement: () => void;
  onIncrement: () => void;
  quantityPlaceholder?: string;
  unitSelector: React.ReactNode;
  details?: React.ReactNode;
  detailsVisible?: boolean;
  footer?: React.ReactNode;
  disableControls?: boolean;
}

export const FulfillmentConfirmItemRow = React.memo(function FulfillmentConfirmItemRow({
  title,
  headerActions,
  chips = [],
  trailingChip,
  quantityValue,
  onQuantityChangeText,
  onDecrement,
  onIncrement,
  quantityPlaceholder = 'Set qty',
  unitSelector,
  details,
  detailsVisible = false,
  footer,
  disableControls = false,
}: FulfillmentConfirmItemRowProps) {
  const ds = useScaledStyles();

  return (
    <GlassSurface
      intensity="subtle"
      style={{
        borderRadius: glassRadii.surface,
        padding: ds.spacing(16),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text
          style={{
            flex: 1,
            paddingRight: ds.spacing(8),
            fontSize: ds.fontSize(16),
            fontWeight: '700',
            color: glassColors.textPrimary,
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {headerActions ? <View style={{ flexDirection: 'row', alignItems: 'center' }}>{headerActions}</View> : null}
      </View>

      {(chips.length > 0 || trailingChip) && (
        <View style={{ marginTop: ds.spacing(8), flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          {chips.length > 0 ? (
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: ds.spacing(6), paddingRight: ds.spacing(8) }}>
              {chips.map((chip) => {
                const getToneStyle = () => {
                  switch (chip.tone) {
                    case 'amber':
                      return { bg: glassColors.warningSoft, border: glassColors.accentBorder, text: glassColors.warningText };
                    case 'blue':
                      return { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' }; // generic fallback colors
                    default:
                      return { bg: glassColors.subtleFill, border: 'transparent', text: glassColors.textSecondary };
                  }
                };
                const tone = getToneStyle();
                return (
                  <View
                    key={chip.id}
                    style={{
                      borderRadius: glassRadii.pill,
                      paddingHorizontal: ds.spacing(8),
                      paddingVertical: ds.spacing(2),
                      backgroundColor: tone.bg,
                      borderWidth: glassHairlineWidth,
                      borderColor: tone.border,
                    }}
                  >
                    <Text style={{ fontSize: ds.fontSize(11), fontWeight: '700', color: tone.text }}>{chip.label}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {trailingChip ? <View style={{ marginLeft: ds.spacing(8) }}>{trailingChip}</View> : null}
        </View>
      )}

      <View style={{ marginTop: ds.spacing(12), flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity
          onPress={onDecrement}
          disabled={disableControls}
          style={{
            width: ds.spacing(38),
            height: ds.spacing(38),
            borderRadius: glassRadii.button,
            borderWidth: glassHairlineWidth,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: disableControls ? glassColors.subtleFill : glassColors.mediumFill,
            borderColor: glassColors.cardBorder,
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="remove" size={ds.icon(16)} color={glassColors.textSecondary} />
        </TouchableOpacity>

        <TextInput
          value={quantityValue}
          onChangeText={onQuantityChangeText}
          editable={!disableControls}
          keyboardType="decimal-pad"
          placeholder={quantityPlaceholder}
          placeholderTextColor={glassColors.textMuted}
          style={{
            marginHorizontal: ds.spacing(8),
            height: ds.spacing(38),
            width: ds.spacing(64),
            borderRadius: glassRadii.button,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.cardBorder,
            backgroundColor: disableControls ? glassColors.subtleFill : '#FFFFFF',
            paddingHorizontal: ds.spacing(8),
            textAlign: 'center',
            fontSize: ds.fontSize(15),
            fontWeight: '700',
            color: glassColors.textPrimary,
          }}
        />

        <TouchableOpacity
          onPress={onIncrement}
          disabled={disableControls}
          style={{
            width: ds.spacing(38),
            height: ds.spacing(38),
            borderRadius: glassRadii.button,
            borderWidth: glassHairlineWidth,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: disableControls ? glassColors.subtleFill : glassColors.mediumFill,
            borderColor: glassColors.cardBorder,
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="add" size={ds.icon(16)} color={glassColors.textSecondary} />
        </TouchableOpacity>

        <View style={{ marginLeft: ds.spacing(8), flexShrink: 1 }}>{unitSelector}</View>
      </View>

      {detailsVisible && details ? (
        <View style={{ marginTop: ds.spacing(14), borderTopWidth: glassHairlineWidth, borderTopColor: glassColors.cardBorder, paddingTop: ds.spacing(14) }}>{details}</View>
      ) : null}

      {footer ? <View style={{ marginTop: ds.spacing(8) }}>{footer}</View> : null}
    </GlassSurface>
  );
});

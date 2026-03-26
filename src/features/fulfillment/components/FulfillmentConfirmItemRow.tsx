import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';
import { GlassSurface } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassRadii, glassHairlineWidth } from '@/theme/design';

type ChipTone = 'amber' | 'gray' | 'blue';
type SurfaceTone = 'subtle' | 'homeGray';

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
  orderedByContent?: React.ReactNode;
  inlineNotesContent?: React.ReactNode;
  surfaceTone?: SurfaceTone;
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
  orderedByContent,
  inlineNotesContent,
  surfaceTone = 'subtle',
}: FulfillmentConfirmItemRowProps) {
  const ds = useScaledStyles();
  const isGraySurface = surfaceTone === 'homeGray';

  const content = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text
          style={{
            flex: 1,
            paddingRight: ds.spacing(8),
            fontSize: ds.fontSize(17),
            fontWeight: '700',
            color: glassColors.textPrimary,
          }}
          numberOfLines={2}
        >
          {title}
        </Text>
        {headerActions ? <View style={{ flexDirection: 'row', alignItems: 'center' }}>{headerActions}</View> : null}
      </View>

      {(chips.length > 0 || trailingChip) && (
        <View style={{ marginTop: ds.spacing(10), flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          {chips.length > 0 ? (
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: ds.spacing(6), paddingRight: ds.spacing(8) }}>
              {chips.map((chip) => {
                const getToneStyle = () => {
                  switch (chip.tone) {
                    case 'amber':
                      return { bg: glassColors.warningSoft, border: glassColors.accentBorder, text: glassColors.warningText };
                    case 'blue':
                      return { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' };
                    default:
                      return { bg: colors.gray[100], border: glassColors.cardBorder, text: glassColors.textSecondary };
                  }
                };
                const tone = getToneStyle();
                return (
                  <View
                    key={chip.id}
                    style={{
                      borderRadius: glassRadii.pill,
                      paddingHorizontal: ds.spacing(10),
                      paddingVertical: ds.spacing(4),
                      backgroundColor: tone.bg,
                      borderWidth: glassHairlineWidth,
                      borderColor: tone.border,
                    }}
                  >
                    <Text style={{ fontSize: ds.fontSize(12), fontWeight: '700', color: tone.text }}>{chip.label}</Text>
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

      {orderedByContent ? <View style={{ marginTop: ds.spacing(10) }}>{orderedByContent}</View> : null}

      <View style={{ marginTop: ds.spacing(14), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <TouchableOpacity
            onPress={onDecrement}
            disabled={disableControls}
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              borderWidth: glassHairlineWidth,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: disableControls ? colors.gray[100] : colors.gray[200],
              borderColor: glassColors.cardBorder,
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="remove" size={ds.icon(20)} color={glassColors.textPrimary} />
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
              height: 42,
              width: ds.spacing(74),
              borderRadius: 13,
              borderWidth: glassHairlineWidth,
              borderColor: glassColors.cardBorder,
              backgroundColor: disableControls
                ? colors.gray[100]
                : isGraySurface
                  ? glassColors.subtleFill
                  : colors.gray[100],
              paddingHorizontal: ds.spacing(8),
              textAlign: 'center',
              fontSize: ds.fontSize(17),
              fontWeight: '700',
              color: glassColors.textPrimary,
            }}
          />

          <TouchableOpacity
            onPress={onIncrement}
            disabled={disableControls}
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              borderWidth: glassHairlineWidth,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: disableControls ? colors.gray[100] : colors.gray[200],
              borderColor: glassColors.cardBorder,
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="add" size={ds.icon(20)} color={glassColors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={{ marginLeft: ds.spacing(12), flexShrink: 0 }}>{unitSelector}</View>
      </View>

      {inlineNotesContent ? <View style={{ marginTop: ds.spacing(12) }}>{inlineNotesContent}</View> : null}

      {detailsVisible && details ? (
        <View style={{ marginTop: ds.spacing(14), borderTopWidth: glassHairlineWidth, borderTopColor: glassColors.cardBorder, paddingTop: ds.spacing(14) }}>{details}</View>
      ) : null}

      {footer ? <View style={{ marginTop: ds.spacing(10) }}>{footer}</View> : null}
    </>
  );

  if (isGraySurface) {
    return (
      <View
        style={{
          backgroundColor: colors.gray[100],
          borderRadius: glassRadii.surface,
          borderWidth: glassHairlineWidth,
          borderColor: glassColors.cardBorder,
          padding: ds.spacing(20),
        }}
      >
        {content}
      </View>
    );
  }

  return (
    <GlassSurface
      intensity="subtle"
      style={{
        borderRadius: glassRadii.surface,
        padding: ds.spacing(20),
      }}
    >
      {content}
    </GlassSurface>
  );
});

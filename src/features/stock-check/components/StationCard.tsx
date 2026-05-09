import React, { memo, useCallback } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  grayScale,
} from '@/theme/design';
import type { AreaProgress, StockCheckArea } from '../types';

export type StationCardTone = 'danger' | 'warning' | 'neutral' | 'success';

export interface StationCardModel {
  area: StockCheckArea;
  progress: AreaProgress;
  tone: StationCardTone;
  statusLabel: string;
  statusMeta: string | null;
  itemSubtitle: string | null;
}

export function buildStationCardModel(
  area: StockCheckArea,
  progress: AreaProgress,
): StationCardModel {
  const remaining = Math.max(0, progress.totalItems - progress.checkedItems);
  const isComplete = progress.totalItems > 0 && remaining === 0;
  const isStarted = progress.checkedItems > 0 && !isComplete;
  const hasOrderRisk = progress.itemsToOrder > 0;

  if (isComplete) {
    return {
      area,
      progress,
      tone: 'success',
      statusLabel: 'DONE',
      statusMeta: null,
      itemSubtitle: null,
    };
  }

  if (isStarted) {
    return {
      area,
      progress,
      tone: 'warning',
      statusLabel: 'IN PROGRESS',
      statusMeta: `${progress.checkedItems} of ${progress.totalItems} done`,
      itemSubtitle: `${remaining} left${
        hasOrderRisk ? ` · ${progress.itemsToOrder} to order` : ''
      }`,
    };
  }

  return {
    area,
    progress,
    tone: 'danger',
    statusLabel: 'NOT CHECKED',
    statusMeta: null,
    itemSubtitle: `${progress.totalItems} items${
      hasOrderRisk ? ` · ${progress.itemsToOrder} likely below par` : ''
    }`,
  };
}

function toneColor(tone: StationCardTone): string {
  switch (tone) {
    case 'danger':
      return glassColors.accent;
    case 'warning':
      return '#FF9500';
    case 'success':
      return colors.statusGreen;
    case 'neutral':
    default:
      return grayScale[500];
  }
}

function actionButtonColors(tone: StationCardTone): {
  backgroundColor: string;
  iconColor: string;
} {
  switch (tone) {
    case 'danger':
      return { backgroundColor: glassColors.accent, iconColor: colors.white };
    case 'warning':
      return { backgroundColor: '#FF9500', iconColor: colors.white };
    case 'success':
    case 'neutral':
    default:
      return { backgroundColor: '#EFE9DE', iconColor: colors.black };
  }
}

export const StationSeparator = memo(function StationSeparator() {
  return <View style={{ height: 12 }} />;
});

export const StationCard = memo(function StationCard({
  model,
  onPress,
}: {
  model: StationCardModel;
  onPress: (stationId: string) => void;
}) {
  const ds = useScaledStyles();
  const accent = toneColor(model.tone);
  const buttonColors = actionButtonColors(model.tone);
  const handlePress = useCallback(
    () => onPress(model.area.id),
    [model.area.id, onPress],
  );

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Open ${model.area.name} stock check`}
      onPress={handlePress}
      activeOpacity={0.88}
      style={{
        minHeight: 102,
        borderRadius: glassRadii.surface + 6,
        backgroundColor: colors.white,
        overflow: 'hidden',
        borderWidth: glassHairlineWidth,
        borderColor: glassColors.cardBorder,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: 4,
          backgroundColor: accent,
        }}
      />
      <View
        style={{
          minHeight: 102,
          paddingLeft: ds.spacing(24),
          paddingRight: ds.spacing(18),
          paddingVertical: ds.spacing(14),
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            paddingRight: ds.spacing(14),
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: ds.spacing(5),
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(12),
                fontWeight: '900',
                color: accent,
                letterSpacing: 1.3,
              }}
              numberOfLines={1}
            >
              {model.tone === 'success' ? '✓ ' : ''}
              {model.statusLabel}
            </Text>
            {model.statusMeta ? (
              <>
                <Text
                  style={{
                    marginHorizontal: ds.spacing(8),
                    fontSize: ds.fontSize(12),
                    color: glassColors.textSecondary,
                  }}
                >
                  ·
                </Text>
                <Text
                  style={{
                    flexShrink: 1,
                    fontSize: ds.fontSize(12),
                    fontWeight: '700',
                    color: glassColors.textSecondary,
                  }}
                  numberOfLines={1}
                >
                  {model.statusMeta}
                </Text>
              </>
            ) : null}
          </View>

          <Text
            style={{
              fontSize: ds.fontSize(20),
              fontWeight: '900',
              color: glassColors.textPrimary,
              letterSpacing: 0,
            }}
            numberOfLines={2}
          >
            {model.area.name}
          </Text>
          {model.itemSubtitle ? (
            <Text
              style={{
                marginTop: ds.spacing(3),
                fontSize: ds.fontSize(15),
                fontWeight: '600',
                color:
                  model.progress.itemsToOrder > 0
                    ? glassColors.accent
                    : glassColors.textSecondary,
              }}
              numberOfLines={1}
            >
              {model.itemSubtitle}
            </Text>
          ) : null}
        </View>

        <View
          style={{
            width: 50,
            height: 50,
            borderRadius: glassRadii.round,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: buttonColors.backgroundColor,
          }}
        >
          <Ionicons
            name="chevron-forward"
            size={ds.icon(20)}
            color={buttonColors.iconColor}
          />
        </View>
      </View>
    </TouchableOpacity>
  );
});

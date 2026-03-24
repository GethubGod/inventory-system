import React from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';
import { colors } from '@/constants';

interface EmptyCartReorderStateProps {
  quickOrderRoute: string;
  browseRoute: string;
}

export function EmptyCartReorderState({
  quickOrderRoute,
  browseRoute,
}: EmptyCartReorderStateProps) {
  const ds = useScaledStyles();
  const { height } = useWindowDimensions();
  const heroMinHeight = Math.min(
    Math.max(ds.spacing(286), Math.round(height * 0.38)),
    ds.spacing(356),
  );
  const actionButtonHeight = Math.max(52, Math.min(ds.buttonH + ds.spacing(6), 60));
  const actionButtonRadius = glassRadii.pill;
  const actionButtonHorizontalPadding = ds.spacing(16);
  const actionIconSize = ds.icon(16);
  const actionTextSize = ds.fontSize(15);
  const supportTextMaxWidth = ds.spacing(280);
  const actionGroupMaxWidth = ds.spacing(332);

  return (
    <View
      style={{
        flex: 1,
        paddingHorizontal: glassSpacing.screen,
        paddingTop: ds.spacing(8),
        paddingBottom: glassTabBarHeight + ds.spacing(20),
      }}
    >
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: heroMinHeight,
          paddingTop: ds.spacing(20),
          paddingBottom: ds.spacing(26),
        }}
      >
        <View
          style={{
            width: ds.icon(64),
            height: ds.icon(64),
            borderRadius: glassRadii.round,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.white,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.cardBorder,
          }}
        >
          <Ionicons
            name="bag-outline"
            size={ds.icon(28)}
            color={glassColors.textTertiary}
          />
        </View>

        <Text
          style={{
            marginTop: ds.spacing(20),
            fontSize: ds.fontSize(19),
            fontWeight: '700',
            color: glassColors.textPrimary,
            textAlign: 'center',
          }}
        >
          No items in cart
        </Text>

        <Text
          style={{
            marginTop: ds.spacing(8),
            maxWidth: supportTextMaxWidth,
            fontSize: ds.fontSize(13),
            lineHeight: ds.fontSize(18),
            color: glassColors.textSecondary,
            textAlign: 'center',
          }}
        >
          Browse inventory or use Quick to start a new order.
        </Text>

        <View
          style={{
            width: '100%',
            maxWidth: actionGroupMaxWidth,
            alignSelf: 'center',
            marginTop: ds.spacing(24),
            flexDirection: 'row',
            gap: ds.spacing(10),
          }}
        >
          <TouchableOpacity
            onPress={() => router.push(browseRoute as never)}
            style={{
              flex: 1.35,
              minHeight: actionButtonHeight,
              borderRadius: actionButtonRadius,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              backgroundColor: colors.primary[500],
              paddingHorizontal: actionButtonHorizontalPadding,
            }}
            activeOpacity={0.85}
          >
            <Ionicons
              name="grid-outline"
              size={actionIconSize}
              color={glassColors.textOnPrimary}
            />
            <Text
              style={{
                marginLeft: ds.spacing(6),
                fontSize: actionTextSize,
                fontWeight: '700',
                color: glassColors.textOnPrimary,
              }}
            >
              Browse
            </Text>
          </TouchableOpacity>

          <GlassSurface
            intensity="subtle"
            style={{
              flex: 1,
              borderRadius: actionButtonRadius,
            }}
          >
            <TouchableOpacity
              onPress={() => router.push(quickOrderRoute as never)}
              style={{
                minHeight: actionButtonHeight,
                borderRadius: actionButtonRadius,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                paddingHorizontal: actionButtonHorizontalPadding,
              }}
              activeOpacity={0.85}
            >
              <Ionicons
                name="flash-outline"
                size={actionIconSize}
                color={glassColors.textPrimary}
              />
              <Text
                style={{
                  marginLeft: ds.spacing(6),
                  fontSize: actionTextSize,
                  fontWeight: '700',
                  color: glassColors.textPrimary,
                }}
              >
                Quick
              </Text>
            </TouchableOpacity>
          </GlassSurface>
        </View>
      </View>
    </View>
  );
}

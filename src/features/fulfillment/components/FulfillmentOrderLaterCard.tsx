import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { GlassSurface } from '@/components';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';

interface FulfillmentOrderLaterCardProps {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function FulfillmentOrderLaterCard({
  count,
  expanded,
  onToggle,
  disabled = false,
  children,
}: FulfillmentOrderLaterCardProps) {
  const ds = useScaledStyles();
  const chevronProgress = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const contentProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(chevronProgress, {
      toValue: expanded ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [chevronProgress, expanded]);

  useEffect(() => {
    if (!expanded) return;

    contentProgress.setValue(0);
    Animated.timing(contentProgress, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [contentProgress, expanded]);

  const chevronStyle = useMemo(
    () => ({
      transform: [
        {
          rotate: chevronProgress.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', '180deg'],
          }),
        },
      ],
    }),
    [chevronProgress]
  );

  const contentStyle = useMemo(
    () => ({
      opacity: contentProgress,
      transform: [
        {
          translateY: contentProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [8, 0],
          }),
        },
      ],
    }),
    [contentProgress]
  );

  return (
    <GlassSurface
      intensity="subtle"
      style={{ borderRadius: glassRadii.surface }}
    >
      <Pressable
        onPress={disabled ? undefined : onToggle}
        style={({ pressed }) => ({
          opacity: disabled ? 1 : pressed ? 0.94 : 1,
          paddingHorizontal: ds.spacing(14),
          paddingTop: ds.spacing(14),
          paddingBottom: disabled ? ds.spacing(16) : ds.spacing(14),
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '700',
              color: glassColors.textPrimary,
            }}
          >
            Order Later
          </Text>

          {!disabled && (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text
                style={{
                  color: glassColors.textSecondary,
                  fontSize: ds.fontSize(13),
                  fontWeight: '600',
                  marginRight: ds.spacing(6),
                }}
              >
                {count} Item{count === 1 ? '' : 's'}
              </Text>
              <Animated.View style={chevronStyle}>
                <Ionicons name="chevron-down" size={16} color={glassColors.textSecondary} />
              </Animated.View>
            </View>
          )}
        </View>
        
        {disabled ? (
          <View
            style={{
              marginTop: ds.spacing(12),
              minHeight: ds.spacing(124),
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: ds.icon(36),
                height: ds.icon(36),
                borderRadius: glassRadii.iconTile,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: glassColors.mediumFill,
              }}
            >
              <Ionicons
                name="time-outline"
                size={ds.icon(18)}
                color={glassColors.textSecondary}
              />
            </View>
            <Text
              style={{
                marginTop: ds.spacing(12),
                fontSize: ds.fontSize(15),
                fontWeight: '600',
                color: glassColors.textPrimary,
              }}
            >
              No pending items
            </Text>
            <Text
              style={{
                marginTop: ds.spacing(6),
                fontSize: ds.fontSize(12),
                color: glassColors.textSecondary,
                lineHeight: ds.fontSize(18),
              }}
            >
              Items scheduled for a future order will appear here.
            </Text>
          </View>
        ) : null}
      </Pressable>

      {expanded && !disabled ? (
        <Animated.View
          style={[
            contentStyle,
            { paddingHorizontal: ds.spacing(14), paddingBottom: ds.spacing(14) },
          ]}
        >
          <View style={{ marginTop: ds.spacing(6) }}>{children}</View>
        </Animated.View>
      ) : null}
    </GlassSurface>
  );
}

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { GlassSurface } from '@/components';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';

interface FulfillmentSuppliersCardProps {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function FulfillmentSuppliersCard({
  count,
  expanded,
  onToggle,
  disabled = false,
  children,
}: FulfillmentSuppliersCardProps) {
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
      <TouchableOpacity
        onPress={disabled ? undefined : onToggle}
        disabled={disabled}
        activeOpacity={0.94}
        style={{
          paddingHorizontal: ds.spacing(14),
          paddingTop: ds.spacing(14),
          paddingBottom: disabled ? ds.spacing(16) : ds.spacing(14),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons
              name="swap-vertical"
              size={ds.icon(16)}
              color={glassColors.textPrimary}
              style={{ marginRight: ds.spacing(8) }}
            />
            <Text
              style={{
                fontSize: ds.fontSize(15),
                fontWeight: '700',
                color: glassColors.textPrimary,
              }}
            >
              Suppliers
            </Text>
          </View>

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
                {count} Ready
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
                width: ds.icon(44),
                height: ds.icon(44),
                borderRadius: glassRadii.round,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: glassColors.mediumFill,
              }}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={ds.icon(22)}
                color={glassColors.textSecondary}
              />
            </View>
            <Text
              style={{
                marginTop: ds.spacing(12),
                fontSize: ds.fontSize(16),
                fontWeight: '700',
                color: glassColors.textPrimary,
              }}
            >
              All caught up
            </Text>
            <Text
              style={{
                marginTop: ds.spacing(6),
                fontSize: ds.fontSize(13),
                color: glassColors.textSecondary,
                lineHeight: ds.fontSize(18),
                maxWidth: 240,
              }}
            >
              No pending orders to fulfill at this time.
            </Text>
          </View>
        ) : null}
      </TouchableOpacity>

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

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
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
    <View
      style={{
        backgroundColor: '#FBFAF8',
        borderRadius: 18,
        borderWidth: glassHairlineWidth,
        borderColor: '#DEDAD4',
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={disabled ? undefined : onToggle}
        style={({ pressed }) => ({
          opacity: disabled ? 1 : pressed ? 0.94 : 1,
          paddingHorizontal: ds.spacing(16),
          paddingVertical: ds.spacing(12),
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons
            name="time-outline"
            size={15}
            color={glassColors.textSecondary}
            style={{ marginRight: ds.spacing(10) }}
          />

          <Text
            style={{
              flex: 1,
              color: glassColors.textPrimary,
              fontSize: ds.fontSize(15),
              fontWeight: '700',
            }}
          >
            Order Later
          </Text>

          <Text
            style={{
              color: glassColors.textSecondary,
              fontSize: ds.fontSize(13),
              fontWeight: '600',
              marginRight: ds.spacing(8),
            }}
          >
            {count} item{count === 1 ? '' : 's'}
          </Text>

          <Animated.View style={disabled ? undefined : chevronStyle}>
            <Ionicons name="chevron-down" size={16} color={glassColors.textSecondary} />
          </Animated.View>
        </View>
      </Pressable>

      {expanded && !disabled ? (
        <Animated.View
          style={[
            contentStyle,
            { paddingHorizontal: ds.spacing(16), paddingBottom: ds.spacing(16) },
          ]}
        >
          <View
            style={{
              height: glassHairlineWidth,
              backgroundColor: glassColors.divider,
              marginBottom: ds.spacing(4),
            }}
          />
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

import React, { useCallback } from 'react';
import {
  GestureResponderEvent,
  Insets,
  StyleProp,
  Text,
  TextStyle,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { glassColors } from '@/theme/design';

interface AddButtonProps {
  onPress: () => void;
  label?: string;
  style: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  activeOpacity?: number;
  hitSlop?: Insets | number;
}

function normalizeHitSlop(hitSlop: Insets | number | undefined): Insets | undefined {
  if (typeof hitSlop === 'number') {
    return {
      top: hitSlop,
      right: hitSlop,
      bottom: hitSlop,
      left: hitSlop,
    };
  }

  return hitSlop;
}

export function AddButton({
  onPress,
  label = 'Add',
  style,
  textStyle,
  activeOpacity = 0.85,
  hitSlop = 8,
}: AddButtonProps) {
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation?.();
      onPress();
    },
    [onPress],
  );

  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={handlePress}
      style={style}
      activeOpacity={activeOpacity}
      hitSlop={normalizeHitSlop(hitSlop)}
      pressRetentionOffset={normalizeHitSlop(hitSlop)}
    >
      <Text
        style={[
          {
            color: glassColors.textOnPrimary,
            fontWeight: '700',
          },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Text,
  View,
} from 'react-native';
import { colors } from '@/constants';

interface LoadingIndicatorProps {
  size?: 'small' | 'medium' | 'large';
  color?: string;
  showText?: boolean;
  text?: string;
}

const SMALL_CONFIG = {
  indicatorSize: 'small' as const,
  defaultColor: 'rgba(255,255,255,0.96)',
};

const BAR_CONFIG = {
  small: {
    trackWidth: 0,
    trackHeight: 0,
    segmentWidth: 0,
    textMarginTop: 0,
    fontSize: 14,
  },
  medium: {
    trackWidth: 48,
    trackHeight: 3,
    segmentWidth: 18,
    textMarginTop: 12,
    fontSize: 13,
  },
  large: {
    trackWidth: 64,
    trackHeight: 4,
    segmentWidth: 24,
    textMarginTop: 14,
    fontSize: 14,
  },
};

export function LoadingIndicator({
  size = 'medium',
  color,
  showText = false,
  text = 'Loading...',
}: LoadingIndicatorProps) {
  const isCompact = size === 'small';
  const config = BAR_CONFIG[size];
  const indicatorColor = color ?? (isCompact ? SMALL_CONFIG.defaultColor : colors.primary[500]);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isCompact) {
      return;
    }

    progress.setValue(0);
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 900,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );

    animation.start();
    return () => {
      animation.stop();
      progress.stopAnimation();
    };
  }, [isCompact, progress]);

  const segmentTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-config.segmentWidth, config.trackWidth],
  });

  const segmentOpacity = progress.interpolate({
    inputRange: [0, 0.15, 0.85, 1],
    outputRange: [0.35, 1, 1, 0.35],
  });

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={showText ? text : 'Loading'}
      className="items-center justify-center"
    >
      {isCompact ? (
        <ActivityIndicator
          size={SMALL_CONFIG.indicatorSize}
          color={indicatorColor}
        />
      ) : (
        <View
          style={{
            width: config.trackWidth,
            height: config.trackHeight,
            borderRadius: config.trackHeight / 2,
            overflow: 'hidden',
            backgroundColor: colors.gray[200],
            opacity: 0.9,
          }}
        >
          <Animated.View
            style={{
              width: config.segmentWidth,
              height: config.trackHeight,
              borderRadius: config.trackHeight / 2,
              backgroundColor: indicatorColor,
              opacity: segmentOpacity,
              transform: [{ translateX: segmentTranslateX }],
            }}
          />
        </View>
      )}
      {showText && (
        <Text
          className="font-medium text-gray-500"
          style={{
            marginTop: config.textMarginTop,
            fontSize: config.fontSize,
            letterSpacing: 0.2,
          }}
        >
          {text}
        </Text>
      )}
    </View>
  );
}

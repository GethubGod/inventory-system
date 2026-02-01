import { useEffect, useRef } from 'react';
import { Animated, Easing, View, Text } from 'react-native';

interface SpinningFishProps {
  size?: 'small' | 'medium' | 'large';
  color?: string;
  showText?: boolean;
  text?: string;
}

export function SpinningFish({
  size = 'medium',
  color = '#F97316',
  showText = false,
  text = 'Loading...',
}: SpinningFishProps) {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spin.start();
    return () => spin.stop();
  }, [spinValue]);

  const rotate = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const sizeMap = {
    small: { fish: 24, container: 40 },
    medium: { fish: 40, container: 60 },
    large: { fish: 56, container: 80 },
  };

  const { fish: fishSize, container: containerSize } = sizeMap[size];

  return (
    <View className="items-center justify-center">
      <View
        style={{
          width: containerSize,
          height: containerSize,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Animated.Text
          style={{
            transform: [{ rotate }],
            fontSize: fishSize,
          }}
        >
          🐟
        </Animated.Text>
      </View>
      {showText && (
        <Text className="text-gray-500 mt-2 text-sm font-medium">{text}</Text>
      )}
    </View>
  );
}

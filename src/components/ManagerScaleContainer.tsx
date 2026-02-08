import React, { useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import { useDisplayStore } from '@/store';

const UI_MULTIPLIER = {
  compact: 0.9,
  default: 1,
  large: 1.15,
} as const;

const BUTTON_MULTIPLIER = {
  small: 0.9,
  medium: 1,
  large: 1.12,
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

interface ManagerScaleContainerProps {
  children: React.ReactNode;
}

export function ManagerScaleContainer({ children }: ManagerScaleContainerProps) {
  const { uiScale, textScale, buttonSize } = useDisplayStore((state) => ({
    uiScale: state.uiScale,
    textScale: state.textScale,
    buttonSize: state.buttonSize,
  }));
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  const scale = useMemo(() => {
    const uiMultiplier = UI_MULTIPLIER[uiScale];
    const buttonMultiplier = BUTTON_MULTIPLIER[buttonSize];
    const textContribution = 1 + (textScale - 1) * 0.2;
    return clamp(uiMultiplier * buttonMultiplier * textContribution, 0.82, 1.35);
  }, [buttonSize, textScale, uiScale]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((previous) => {
      if (Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5) {
        return previous;
      }
      return { width, height };
    });
  }, []);

  if (Math.abs(scale - 1) < 0.01 || layout.width === 0 || layout.height === 0) {
    return (
      <View style={{ flex: 1 }} onLayout={onLayout}>
        {children}
      </View>
    );
  }

  const scaledWidth = layout.width / scale;
  const scaledHeight = layout.height / scale;
  const translateX = (layout.width - scaledWidth) / 2;
  const translateY = (layout.height - scaledHeight) / 2;

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <View
        style={{
          width: scaledWidth,
          height: scaledHeight,
          transform: [{ translateX }, { translateY }, { scale }],
        }}
      >
        {children}
      </View>
    </View>
  );
}

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  View,
} from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';

interface BottomSheetShellProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  horizontalPadding?: number;
  bottomPadding?: number;
}

export function BottomSheetShell({
  visible,
  onClose,
  children,
  horizontalPadding,
  bottomPadding,
}: BottomSheetShellProps) {
  const ds = useScaledStyles();
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      translateY.setValue(0);
    }
  }, [translateY, visible]);

  const animateClose = useCallback(() => {
    Animated.timing(translateY, {
      toValue: ds.spacing(360),
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      translateY.setValue(0);
      onClose();
    });
  }, [ds, onClose, translateY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          gestureState.dy > 6 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy <= 0) return;
          translateY.setValue(gestureState.dy);
        },
        onPanResponderRelease: (_, gestureState) => {
          const shouldClose = gestureState.dy > ds.spacing(90) || gestureState.vy > 1.2;
          if (shouldClose) {
            animateClose();
            return;
          }
          Animated.spring(translateY, {
            toValue: 0,
            bounciness: 0,
            speed: 22,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, {
            toValue: 0,
            bounciness: 0,
            speed: 22,
            useNativeDriver: true,
          }).start();
        },
      }),
    [animateClose, ds, translateY]
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 justify-end" onPress={onClose}>
        <Animated.View
          style={{
            paddingHorizontal: horizontalPadding ?? ds.spacing(20),
            paddingBottom: bottomPadding ?? ds.spacing(10),
            transform: [{ translateY }],
          }}
          className="bg-white rounded-t-3xl pt-4"
        >
          <Pressable onPress={(event) => event.stopPropagation()}>
            <View className="items-center pb-3" {...panResponder.panHandlers}>
              <View className="h-1 rounded-full bg-gray-300" style={{ width: ds.spacing(42) }} />
            </View>
            {children}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

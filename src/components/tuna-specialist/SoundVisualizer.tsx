import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';

type VisualizerState = 'idle' | 'listening' | 'processing' | 'speaking';

interface SoundVisualizerProps {
  state: VisualizerState;
  intensity?: number;
}

const COLORS = {
  idle: '#F97316',
  listening: '#22C55E',
  processing: '#F97316',
  speaking: '#3B82F6',
};

const SIZE = 200;

export function SoundVisualizer({ state, intensity = 0.5 }: SoundVisualizerProps) {
  // Animated values for 4 concentric rings
  const ring1Scale = useRef(new Animated.Value(1)).current;
  const ring2Scale = useRef(new Animated.Value(0.85)).current;
  const ring3Scale = useRef(new Animated.Value(0.7)).current;
  const ring4Scale = useRef(new Animated.Value(0.55)).current;

  const ring1Opacity = useRef(new Animated.Value(0.15)).current;
  const ring2Opacity = useRef(new Animated.Value(0.1)).current;
  const ring3Opacity = useRef(new Animated.Value(0.08)).current;
  const ring4Opacity = useRef(new Animated.Value(0.05)).current;

  const rotation = useRef(new Animated.Value(0)).current;

  // Color overlay opacities (cross-fade between colors)
  const idleOpacity = useRef(new Animated.Value(1)).current;
  const listeningOpacity = useRef(new Animated.Value(0)).current;
  const processingOpacity = useRef(new Animated.Value(0)).current;
  const speakingOpacity = useRef(new Animated.Value(0)).current;

  const animationsRef = useRef<Animated.CompositeAnimation[]>([]);

  const stopAnimations = () => {
    animationsRef.current.forEach((a) => a.stop());
    animationsRef.current = [];
  };

  useEffect(() => {
    stopAnimations();

    // Cross-fade colors
    const colorFade = Animated.parallel([
      Animated.timing(idleOpacity, {
        toValue: state === 'idle' ? 1 : 0,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(listeningOpacity, {
        toValue: state === 'listening' ? 1 : 0,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(processingOpacity, {
        toValue: state === 'processing' ? 1 : 0,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(speakingOpacity, {
        toValue: state === 'speaking' ? 1 : 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]);
    colorFade.start();

    if (state === 'idle') {
      // Gentle breathing pulse
      const breathe = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring1Scale, {
              toValue: 1.05,
              duration: 1500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(ring1Opacity, {
              toValue: 0.2,
              duration: 1500,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(ring1Scale, {
              toValue: 0.95,
              duration: 1500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(ring1Opacity, {
              toValue: 0.12,
              duration: 1500,
              useNativeDriver: true,
            }),
          ]),
        ]),
      );

      // Subtle outer rings
      const outerBreath = Animated.loop(
        Animated.sequence([
          Animated.timing(ring2Scale, {
            toValue: 0.9,
            duration: 2000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ring2Scale, {
            toValue: 0.8,
            duration: 2000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );

      animationsRef.current = [breathe, outerBreath];
      breathe.start();
      outerBreath.start();

      // Reset other rings
      Animated.parallel([
        Animated.timing(ring3Scale, { toValue: 0.7, duration: 300, useNativeDriver: true }),
        Animated.timing(ring4Scale, { toValue: 0.55, duration: 300, useNativeDriver: true }),
        Animated.timing(ring2Opacity, { toValue: 0.08, duration: 300, useNativeDriver: true }),
        Animated.timing(ring3Opacity, { toValue: 0.05, duration: 300, useNativeDriver: true }),
        Animated.timing(ring4Opacity, { toValue: 0.03, duration: 300, useNativeDriver: true }),
      ]).start();
    } else if (state === 'listening') {
      // Dynamic pulsing rings — more rings visible, varied timing
      const intensityFactor = 0.5 + intensity * 0.5;

      const ring1Pulse = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring1Scale, {
              toValue: 1.0 + 0.15 * intensityFactor,
              duration: 300 + Math.random() * 100,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(ring1Opacity, {
              toValue: 0.3 * intensityFactor,
              duration: 300,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(ring1Scale, {
              toValue: 0.92,
              duration: 350 + Math.random() * 100,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(ring1Opacity, {
              toValue: 0.15,
              duration: 350,
              useNativeDriver: true,
            }),
          ]),
        ]),
      );

      const ring2Pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(ring2Scale, {
            toValue: 0.85 + 0.12 * intensityFactor,
            duration: 400 + Math.random() * 150,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ring2Scale, {
            toValue: 0.78,
            duration: 450 + Math.random() * 150,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );

      const ring3Pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(ring3Scale, {
            toValue: 0.7 + 0.1 * intensityFactor,
            duration: 500 + Math.random() * 200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ring3Scale, {
            toValue: 0.62,
            duration: 550 + Math.random() * 200,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );

      const ring4Pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(ring4Scale, {
            toValue: 0.55 + 0.08 * intensityFactor,
            duration: 600,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ring4Scale, {
            toValue: 0.48,
            duration: 650,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );

      // Show all rings
      Animated.parallel([
        Animated.timing(ring2Opacity, { toValue: 0.15, duration: 200, useNativeDriver: true }),
        Animated.timing(ring3Opacity, { toValue: 0.12, duration: 200, useNativeDriver: true }),
        Animated.timing(ring4Opacity, { toValue: 0.08, duration: 200, useNativeDriver: true }),
      ]).start();

      animationsRef.current = [ring1Pulse, ring2Pulse, ring3Pulse, ring4Pulse];
      ring1Pulse.start();
      ring2Pulse.start();
      ring3Pulse.start();
      ring4Pulse.start();
    } else if (state === 'processing') {
      // Contract + rotate
      Animated.parallel([
        Animated.timing(ring1Scale, { toValue: 0.85, duration: 400, useNativeDriver: true }),
        Animated.timing(ring2Scale, { toValue: 0.72, duration: 400, useNativeDriver: true }),
        Animated.timing(ring3Scale, { toValue: 0.6, duration: 400, useNativeDriver: true }),
        Animated.timing(ring4Scale, { toValue: 0.48, duration: 400, useNativeDriver: true }),
        Animated.timing(ring1Opacity, { toValue: 0.25, duration: 400, useNativeDriver: true }),
        Animated.timing(ring2Opacity, { toValue: 0.15, duration: 400, useNativeDriver: true }),
        Animated.timing(ring3Opacity, { toValue: 0.1, duration: 400, useNativeDriver: true }),
        Animated.timing(ring4Opacity, { toValue: 0.05, duration: 400, useNativeDriver: true }),
      ]).start();

      const spin = Animated.loop(
        Animated.timing(rotation, {
          toValue: 1,
          duration: 3000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );

      // Subtle shimmer on inner ring
      const shimmer = Animated.loop(
        Animated.sequence([
          Animated.timing(ring1Opacity, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(ring1Opacity, {
            toValue: 0.18,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      );

      animationsRef.current = [spin, shimmer];
      spin.start();
      shimmer.start();
    } else if (state === 'speaking') {
      // Smooth, rhythmic pulsing — more uniform than listening
      rotation.setValue(0);

      const ring1Pulse = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring1Scale, {
              toValue: 1.08,
              duration: 500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(ring1Opacity, {
              toValue: 0.25,
              duration: 500,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(ring1Scale, {
              toValue: 0.94,
              duration: 500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(ring1Opacity, {
              toValue: 0.15,
              duration: 500,
              useNativeDriver: true,
            }),
          ]),
        ]),
      );

      const ring2Pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(ring2Scale, {
            toValue: 0.9,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ring2Scale, {
            toValue: 0.82,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );

      Animated.parallel([
        Animated.timing(ring2Opacity, { toValue: 0.12, duration: 200, useNativeDriver: true }),
        Animated.timing(ring3Opacity, { toValue: 0.06, duration: 200, useNativeDriver: true }),
        Animated.timing(ring4Opacity, { toValue: 0.03, duration: 200, useNativeDriver: true }),
      ]).start();

      animationsRef.current = [ring1Pulse, ring2Pulse];
      ring1Pulse.start();
      ring2Pulse.start();
    }

    return () => {
      stopAnimations();
    };
  }, [state, intensity]);

  const rotateInterp = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const renderRing = (
    scale: Animated.Value,
    opacity: Animated.Value,
    sizeFactor: number,
    extraStyle?: object,
  ) => {
    const ringSize = SIZE * sizeFactor;
    return (
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            transform: [{ scale }],
            opacity,
          },
          extraStyle,
        ]}
      >
        {/* Layer colored circles for cross-fading */}
        <Animated.View
          style={{
            ...fillCircle(ringSize),
            backgroundColor: COLORS.idle,
            opacity: idleOpacity,
          }}
        />
        <Animated.View
          style={{
            ...fillCircle(ringSize),
            backgroundColor: COLORS.listening,
            opacity: listeningOpacity,
          }}
        />
        <Animated.View
          style={{
            ...fillCircle(ringSize),
            backgroundColor: COLORS.processing,
            opacity: processingOpacity,
          }}
        />
        <Animated.View
          style={{
            ...fillCircle(ringSize),
            backgroundColor: COLORS.speaking,
            opacity: speakingOpacity,
          }}
        />
      </Animated.View>
    );
  };

  return (
    <View
      style={{
        width: SIZE,
        height: SIZE,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Ring 4 (outermost) */}
      {renderRing(ring4Scale, ring4Opacity, 1)}

      {/* Ring 3 */}
      {renderRing(ring3Scale, ring3Opacity, 0.85)}

      {/* Ring 2 */}
      {renderRing(ring2Scale, ring2Opacity, 0.7)}

      {/* Ring 1 (innermost, may rotate during processing) */}
      <Animated.View
        style={{
          position: 'absolute',
          width: SIZE * 0.55,
          height: SIZE * 0.55,
          borderRadius: (SIZE * 0.55) / 2,
          transform: [
            { scale: ring1Scale },
            { rotate: state === 'processing' ? rotateInterp : '0deg' },
          ],
          opacity: ring1Opacity,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={{
            ...fillCircle(SIZE * 0.55),
            backgroundColor: COLORS.idle,
            opacity: idleOpacity,
          }}
        />
        <Animated.View
          style={{
            ...fillCircle(SIZE * 0.55),
            backgroundColor: COLORS.listening,
            opacity: listeningOpacity,
          }}
        />
        <Animated.View
          style={{
            ...fillCircle(SIZE * 0.55),
            backgroundColor: COLORS.processing,
            opacity: processingOpacity,
          }}
        />
        <Animated.View
          style={{
            ...fillCircle(SIZE * 0.55),
            backgroundColor: COLORS.speaking,
            opacity: speakingOpacity,
          }}
        />
      </Animated.View>
    </View>
  );
}

function fillCircle(size: number) {
  return {
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: size / 2,
  };
}

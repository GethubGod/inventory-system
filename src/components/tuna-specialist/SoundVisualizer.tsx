import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';

type VisualizerState = 'idle' | 'listening' | 'processing' | 'speaking';

interface SoundVisualizerProps {
  state: VisualizerState;
}

const COLORS = {
  orange: '#F97316',
  green: '#22C55E',
  blue: '#3B82F6',
};

const SIZE = 220;

export function SoundVisualizer({ state }: SoundVisualizerProps) {
  // --- Color cross-fade opacities ---
  const orangeOpacity = useRef(new Animated.Value(1)).current;
  const greenOpacity = useRef(new Animated.Value(0)).current;
  const blueOpacity = useRef(new Animated.Value(0)).current;

  // --- Ring scale values ---
  const outermostScale = useRef(new Animated.Value(0.9)).current;
  const outermostOpacity = useRef(new Animated.Value(0)).current;
  const outerScale = useRef(new Animated.Value(1)).current;
  const outerOpacity = useRef(new Animated.Value(0.1)).current;
  const middleScale = useRef(new Animated.Value(1)).current;
  const middleOpacity = useRef(new Animated.Value(0.15)).current;
  const innerGlowScale = useRef(new Animated.Value(1)).current;
  const innerGlowOpacity = useRef(new Animated.Value(0.15)).current;
  const coreScale = useRef(new Animated.Value(1)).current;
  const coreOpacity = useRef(new Animated.Value(0.85)).current;

  // --- Rotation for processing ---
  const middleRotation = useRef(new Animated.Value(0)).current;

  // Track running animations for cleanup
  const animationsRef = useRef<Animated.CompositeAnimation[]>([]);

  const stopAll = () => {
    animationsRef.current.forEach((a) => a.stop());
    animationsRef.current = [];
  };

  const run = (anim: Animated.CompositeAnimation) => {
    animationsRef.current.push(anim);
    anim.start();
  };

  useEffect(() => {
    stopAll();

    // --- Cross-fade colors ---
    const isOrange = state === 'idle' || state === 'processing';
    const isGreen = state === 'listening';
    const isBlue = state === 'speaking';

    run(
      Animated.parallel([
        Animated.timing(orangeOpacity, {
          toValue: isOrange ? 1 : 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(greenOpacity, {
          toValue: isGreen ? 1 : 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(blueOpacity, {
          toValue: isBlue ? 1 : 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    );

    if (state === 'idle') {
      // Hide outermost ring
      run(
        Animated.timing(outermostOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      );

      // Outer ring: slow pulse
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(outerScale, {
              toValue: 1.08,
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(outerScale, {
              toValue: 0.95,
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );
      run(
        Animated.timing(outerOpacity, {
          toValue: 0.1,
          duration: 400,
          useNativeDriver: true,
        }),
      );

      // Middle ring: offset pulse
      run(
        Animated.loop(
          Animated.sequence([
            Animated.delay(1000),
            Animated.timing(middleScale, {
              toValue: 1.06,
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(middleScale, {
              toValue: 0.96,
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );
      run(
        Animated.timing(middleOpacity, {
          toValue: 0.15,
          duration: 400,
          useNativeDriver: true,
        }),
      );

      // Stop rotation
      middleRotation.setValue(0);

      // Inner glow: breathing
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(innerGlowScale, {
              toValue: 1.1,
              duration: 1500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(innerGlowScale, {
              toValue: 0.9,
              duration: 1500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );
      run(
        Animated.timing(innerGlowOpacity, {
          toValue: 0.15,
          duration: 400,
          useNativeDriver: true,
        }),
      );

      // Core: gentle pulse
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(coreScale, {
              toValue: 1.04,
              duration: 1800,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(coreScale, {
              toValue: 0.97,
              duration: 1800,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );
      run(
        Animated.timing(coreOpacity, {
          toValue: 0.85,
          duration: 400,
          useNativeDriver: true,
        }),
      );
    } else if (state === 'listening') {
      // Show outermost ring
      run(
        Animated.timing(outermostOpacity, {
          toValue: 0.06,
          duration: 300,
          useNativeDriver: true,
        }),
      );
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(outermostScale, {
              toValue: 1.15,
              duration: 800,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(outermostScale, {
              toValue: 0.9,
              duration: 900,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      // Outer ring: dramatic pulse, staggered
      run(
        Animated.timing(outerOpacity, {
          toValue: 0.15,
          duration: 200,
          useNativeDriver: true,
        }),
      );
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(outerScale, {
              toValue: 1.25,
              duration: 600,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(outerScale, {
              toValue: 0.88,
              duration: 700,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      // Middle ring: staggered ripple
      run(
        Animated.timing(middleOpacity, {
          toValue: 0.2,
          duration: 200,
          useNativeDriver: true,
        }),
      );
      middleRotation.setValue(0);
      run(
        Animated.loop(
          Animated.sequence([
            Animated.delay(150),
            Animated.timing(middleScale, {
              toValue: 1.2,
              duration: 550,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(middleScale, {
              toValue: 0.85,
              duration: 650,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      // Inner glow: energetic
      run(
        Animated.timing(innerGlowOpacity, {
          toValue: 0.2,
          duration: 200,
          useNativeDriver: true,
        }),
      );
      run(
        Animated.loop(
          Animated.sequence([
            Animated.delay(250),
            Animated.timing(innerGlowScale, {
              toValue: 1.18,
              duration: 500,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(innerGlowScale, {
              toValue: 0.88,
              duration: 600,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      // Core: aggressive pulse
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(coreScale, {
              toValue: 1.15,
              duration: 400,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(coreScale, {
              toValue: 0.88,
              duration: 500,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );
      run(
        Animated.timing(coreOpacity, {
          toValue: 0.95,
          duration: 200,
          useNativeDriver: true,
        }),
      );
    } else if (state === 'processing') {
      // Hide outermost
      run(
        Animated.timing(outermostOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      );

      // Contract rings
      run(
        Animated.timing(outerScale, {
          toValue: 0.85,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      );
      run(
        Animated.timing(outerOpacity, {
          toValue: 0.12,
          duration: 400,
          useNativeDriver: true,
        }),
      );

      // Middle ring: rotate
      run(
        Animated.timing(middleScale, {
          toValue: 0.88,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      );
      run(
        Animated.timing(middleOpacity, {
          toValue: 0.2,
          duration: 400,
          useNativeDriver: true,
        }),
      );
      run(
        Animated.loop(
          Animated.timing(middleRotation, {
            toValue: 1,
            duration: 3000,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ),
      );

      // Inner glow: subtle breathing
      run(
        Animated.timing(innerGlowOpacity, {
          toValue: 0.18,
          duration: 400,
          useNativeDriver: true,
        }),
      );
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(innerGlowScale, {
              toValue: 1.05,
              duration: 1000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(innerGlowScale, {
              toValue: 0.95,
              duration: 1000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      // Core: shimmer
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(coreOpacity, {
              toValue: 0.95,
              duration: 800,
              useNativeDriver: true,
            }),
            Animated.timing(coreOpacity, {
              toValue: 0.7,
              duration: 800,
              useNativeDriver: true,
            }),
          ]),
        ),
      );
      run(
        Animated.timing(coreScale, {
          toValue: 0.92,
          duration: 500,
          useNativeDriver: true,
        }),
      );
    } else if (state === 'speaking') {
      // Hide outermost
      run(
        Animated.timing(outermostOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      );

      middleRotation.setValue(0);

      // All rings pulse IN SYNC
      const d = 700;

      run(
        Animated.timing(outerOpacity, {
          toValue: 0.12,
          duration: 300,
          useNativeDriver: true,
        }),
      );
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(outerScale, {
              toValue: 1.1,
              duration: d,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(outerScale, {
              toValue: 0.93,
              duration: d,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      run(
        Animated.timing(middleOpacity, {
          toValue: 0.16,
          duration: 300,
          useNativeDriver: true,
        }),
      );
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(middleScale, {
              toValue: 1.08,
              duration: d,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(middleScale, {
              toValue: 0.94,
              duration: d,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      run(
        Animated.timing(innerGlowOpacity, {
          toValue: 0.18,
          duration: 300,
          useNativeDriver: true,
        }),
      );
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(innerGlowScale, {
              toValue: 1.06,
              duration: d,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(innerGlowScale, {
              toValue: 0.95,
              duration: d,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      run(
        Animated.timing(coreOpacity, {
          toValue: 0.9,
          duration: 300,
          useNativeDriver: true,
        }),
      );
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(coreScale, {
              toValue: 1.06,
              duration: d,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(coreScale, {
              toValue: 0.95,
              duration: d,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      );
    }

    return () => {
      stopAll();
    };
  }, [state]);

  const middleRotateInterp = middleRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Determine shadow color (can't animate, pick from state)
  const shadowColor =
    state === 'listening'
      ? COLORS.green
      : state === 'speaking'
        ? COLORS.blue
        : COLORS.orange;

  const coreSize = 72;

  return (
    <View
      style={{
        width: SIZE,
        height: SIZE,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Layer 1: Outermost ring (220x220) */}
      <Animated.View
        style={{
          position: 'absolute',
          width: 220,
          height: 220,
          borderRadius: 110,
          opacity: outermostOpacity,
          transform: [{ scale: outermostScale }],
        }}
      >
        <ColoredBorderRing size={220} orangeOp={orangeOpacity} greenOp={greenOpacity} blueOp={blueOpacity} />
      </Animated.View>

      {/* Layer 2: Outer ring (180x180) */}
      <Animated.View
        style={{
          position: 'absolute',
          width: 180,
          height: 180,
          borderRadius: 90,
          opacity: outerOpacity,
          transform: [{ scale: outerScale }],
        }}
      >
        <ColoredBorderRing size={180} orangeOp={orangeOpacity} greenOp={greenOpacity} blueOp={blueOpacity} />
      </Animated.View>

      {/* Layer 3: Middle ring (140x140) — rotates during processing */}
      <Animated.View
        style={{
          position: 'absolute',
          width: 140,
          height: 140,
          borderRadius: 70,
          opacity: middleOpacity,
          transform: [
            { scale: middleScale },
            { rotate: state === 'processing' ? middleRotateInterp : '0deg' },
          ],
        }}
      >
        <ColoredBorderRing size={140} orangeOp={orangeOpacity} greenOp={greenOpacity} blueOp={blueOpacity} />
      </Animated.View>

      {/* Layer 4: Inner glow (110x110) */}
      <Animated.View
        style={{
          position: 'absolute',
          width: 110,
          height: 110,
          borderRadius: 55,
          opacity: innerGlowOpacity,
          transform: [{ scale: innerGlowScale }],
        }}
      >
        <ColoredFill size={110} orangeOp={orangeOpacity} greenOp={greenOpacity} blueOp={blueOpacity} />
      </Animated.View>

      {/* Layer 5: Core (72x72) with glow shadow */}
      <Animated.View
        style={{
          position: 'absolute',
          width: coreSize,
          height: coreSize,
          borderRadius: coreSize / 2,
          opacity: coreOpacity,
          transform: [{ scale: coreScale }],
          shadowColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 25,
          elevation: 15,
        }}
      >
        <ColoredFill size={coreSize} orangeOp={orangeOpacity} greenOp={greenOpacity} blueOp={blueOpacity} />
      </Animated.View>
    </View>
  );
}

// Sub-component: 3 overlapping border rings for color cross-fade
function ColoredBorderRing({
  size,
  orangeOp,
  greenOp,
  blueOp,
}: {
  size: number;
  orangeOp: Animated.Value;
  greenOp: Animated.Value;
  blueOp: Animated.Value;
}) {
  const r = size / 2;
  const base = { position: 'absolute' as const, width: size, height: size, borderRadius: r, borderWidth: 1.5 };
  return (
    <>
      <Animated.View style={[base, { borderColor: COLORS.orange, opacity: orangeOp }]} />
      <Animated.View style={[base, { borderColor: COLORS.green, opacity: greenOp }]} />
      <Animated.View style={[base, { borderColor: COLORS.blue, opacity: blueOp }]} />
    </>
  );
}

// Sub-component: 3 overlapping filled circles for color cross-fade
function ColoredFill({
  size,
  orangeOp,
  greenOp,
  blueOp,
}: {
  size: number;
  orangeOp: Animated.Value;
  greenOp: Animated.Value;
  blueOp: Animated.Value;
}) {
  const r = size / 2;
  const base = { position: 'absolute' as const, width: size, height: size, borderRadius: r };
  return (
    <>
      <Animated.View style={[base, { backgroundColor: COLORS.orange, opacity: orangeOp }]} />
      <Animated.View style={[base, { backgroundColor: COLORS.green, opacity: greenOp }]} />
      <Animated.View style={[base, { backgroundColor: COLORS.blue, opacity: blueOp }]} />
    </>
  );
}

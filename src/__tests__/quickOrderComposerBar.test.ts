import React from 'react';
import renderer, { ReactTestRendererJSON } from 'react-test-renderer';
import { QuickOrderComposerBar } from '../features/ordering/QuickOrderComposerBar';

jest.mock('react-native', () => {
  const React = require('react');
  const createComponent = (name: string) => {
    const Component = React.forwardRef(
      ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) =>
        React.createElement(name, { ...props, ref }, children),
    );
    Component.displayName = name;
    return Component;
  };

  return {
    View: createComponent('View'),
    Text: createComponent('Text'),
    TextInput: createComponent('TextInput'),
    Pressable: createComponent('Pressable'),
    ActivityIndicator: createComponent('ActivityIndicator'),
    Keyboard: {
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      dismiss: jest.fn(),
    },
    StyleSheet: {
      absoluteFillObject: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      },
      create: (styles: unknown) => styles,
      hairlineWidth: 1,
    },
    Platform: {
      OS: 'ios',
      select: (values: Record<string, unknown>) => values.ios ?? values.default,
    },
  };
});

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const createComponent = (name: string) => {
    const Component = React.forwardRef(
      ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) =>
        React.createElement(name, { ...props, ref }, children),
    );
    Component.displayName = name;
    return Component;
  };

  return {
    __esModule: true,
    default: {
      View: createComponent('Animated.View'),
      createAnimatedComponent: (Component: React.ComponentType) => Component,
    },
    Easing: {
      cubic: jest.fn(),
      out: jest.fn((value) => value),
    },
    interpolateColor: jest.fn((_value, _input, output) => output[0]),
    useAnimatedStyle: jest.fn((factory) => factory()),
    useSharedValue: jest.fn((value) => ({ value })),
    withTiming: jest.fn((value) => value),
  };
});

jest.mock('react-native-svg', () => {
  const ReactActual = jest.requireActual('react');
  const createComponent = (name: string) => {
    const Component = ({ children, ...props }: { children?: unknown }) =>
      ReactActual.createElement(name, props, children);
    Component.displayName = name;
    return Component;
  };
  const Svg = createComponent('Svg');
  return { __esModule: true, default: Svg, Svg, Rect: createComponent('Rect') };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const Ionicons = (props: Record<string, unknown>) => React.createElement('Ionicons', props);
  Ionicons.glyphMap = {};
  return { Ionicons };
});

jest.mock('@/hooks/useScaledStyles', () => ({
  useScaledStyles: () => ({
    spacing: (value: number) => value,
    radius: (value: number) => value,
    fontSize: (value: number) => value,
    icon: (value: number) => value,
  }),
}));

jest.mock('@/lib/haptics', () => ({
  triggerSelectionHaptic: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/theme/design', () => ({
  colors: {
    textMuted: '#9CA3AF',
    textOnPrimary: '#FFFFFF',
    textSecondary: '#8C8F99',
    textPrimary: '#1F2937',
    white: '#FFFFFF',
    statusAmber: '#F59E0B',
    statusGreen: '#22C55E',
  },
  grayScale: {
    100: '#F3F4F6',
    200: '#E5E7EB',
  },
  quickOrderAccent: '#EF4E3E',
}));

function renderComposer(props: Partial<React.ComponentProps<typeof QuickOrderComposerBar>> = {}) {
  let component!: renderer.ReactTestRenderer;
  renderer.act(() => {
    component = renderer.create(
      React.createElement(QuickOrderComposerBar, {
        onSubmit: jest.fn(),
        isSending: false,
        bottomInset: 0,
        tabBarHeight: 60,
        onComposerModeChange: jest.fn(),
        ...props,
      }),
    );
  });
  return component;
}

function collectByType(
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null,
  type: string,
  out: ReactTestRendererJSON[] = [],
): ReactTestRendererJSON[] {
  if (!node || typeof node === 'string') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => collectByType(child, type, out));
    return out;
  }
  if (node.type === type) out.push(node);
  if (node.children) {
    node.children.forEach((child) => collectByType(child as ReactTestRendererJSON, type, out));
  }
  return out;
}

function mergeStyle(style: unknown): Record<string, unknown> {
  const value =
    typeof style === 'function'
      ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  const flat: Record<string, unknown>[] = [];
  const walk = (entry: unknown) => {
    if (!entry) return;
    if (Array.isArray(entry)) entry.forEach(walk);
    else if (typeof entry === 'object') flat.push(entry as Record<string, unknown>);
  };
  walk(value);
  return Object.assign({}, ...flat);
}

describe('QuickOrderComposerBar mode selector', () => {
  beforeAll(() => {
    Object.assign(globalThis, {
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
      cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    });
  });

  it('switches between order and inventory modes through tappable mode buttons', () => {
    const onComposerModeChange = jest.fn();
    const component = renderComposer({ composerMode: 'order', onComposerModeChange });

    const pressables = collectByType(component.toJSON(), 'Pressable');
    const inventory = pressables.find(
      (node) => node.props?.accessibilityLabel === 'Inventory mode',
    );
    const order = pressables.find(
      (node) => node.props?.accessibilityLabel === 'Order mode',
    );

    expect(inventory).toBeDefined();
    expect(order).toBeDefined();
    expect(mergeStyle(inventory!.props.style).height).toBeGreaterThan(0);
    expect(mergeStyle(order!.props.style).height).toBeGreaterThan(0);
    expect(mergeStyle(order!.props.style).backgroundColor).toBe('#EF4E3E');
    expect(mergeStyle(inventory!.props.style).backgroundColor).toBe('transparent');

    renderer.act(() => {
      (inventory!.props.onPress as () => void)();
    });
    expect(onComposerModeChange).toHaveBeenCalledWith('inventory');

    renderer.act(() => {
      component.update(
        React.createElement(QuickOrderComposerBar, {
          onSubmit: jest.fn(),
          isSending: false,
          bottomInset: 0,
          tabBarHeight: 60,
          composerMode: 'inventory',
          onComposerModeChange,
        }),
      );
    });

    const nextOrder = collectByType(component.toJSON(), 'Pressable').find(
      (node) => node.props?.accessibilityLabel === 'Order mode',
    );
    const nextInventory = collectByType(component.toJSON(), 'Pressable').find(
      (node) => node.props?.accessibilityLabel === 'Inventory mode',
    );
    expect(mergeStyle(nextOrder!.props.style).backgroundColor).toBe('transparent');
    expect(mergeStyle(nextInventory!.props.style).backgroundColor).toBe('#EF4E3E');

    renderer.act(() => {
      (nextOrder!.props.onPress as () => void)();
    });
    expect(onComposerModeChange).toHaveBeenCalledWith('order');
  });

  it('does not switch modes while a message is sending', () => {
    const onComposerModeChange = jest.fn();
    const component = renderComposer({
      composerMode: 'order',
      isSending: true,
      onComposerModeChange,
    });
    const inventory = collectByType(component.toJSON(), 'Pressable').find(
      (node) => node.props?.accessibilityLabel === 'Inventory mode',
    );

    renderer.act(() => {
      (inventory!.props.onPress as () => void)();
    });

    expect(onComposerModeChange).not.toHaveBeenCalled();
  });

  it('renders voice controls and retry state', () => {
    const onStartVoice = jest.fn();
    const onRetryVoice = jest.fn();
    const component = renderComposer({
      voiceEnabled: true,
      voiceStatus: 'failed',
      voiceError: "Couldn't understand. Try again.",
      onStartVoice,
      onRetryVoice,
    });

    const pressables = collectByType(component.toJSON(), 'Pressable');
    const mic = pressables.find(
      (node) => node.props?.accessibilityLabel === 'Start voice input',
    );
    const retry = pressables.find(
      (node) => node.props?.accessibilityLabel === 'Retry voice order',
    );
    const discard = pressables.find(
      (node) => node.props?.accessibilityLabel === 'Discard voice order',
    );

    expect(mic).toBeDefined();
    expect(retry).toBeDefined();
    expect(discard).toBeDefined();

    renderer.act(() => {
      (retry!.props.onPress as () => void)();
    });
    expect(onRetryVoice).toHaveBeenCalled();
  });

  it('stops and submits from both the square stop and the send button while recording', () => {
    const onSubmitVoice = jest.fn();
    const component = renderComposer({
      voiceEnabled: true,
      voiceStatus: 'recording',
      onSubmitVoice,
    });

    const pressables = collectByType(component.toJSON(), 'Pressable');
    const stop = pressables.find(
      (node) => node.props?.accessibilityLabel === 'Stop voice input',
    );
    const send = pressables.find(
      (node) => node.props?.accessibilityLabel === 'Send',
    );

    expect(stop).toBeDefined();
    expect(send).toBeDefined();
    // Send is active (tappable) during recording, not disabled.
    expect(send!.props.accessibilityState?.disabled).toBe(false);

    renderer.act(() => {
      (stop!.props.onPress as () => void)();
    });
    renderer.act(() => {
      (send!.props.onPress as () => void)();
    });
    expect(onSubmitVoice).toHaveBeenCalledTimes(2);

    // Unmount so the waveform's metering interval is cleared (no leaked timer).
    renderer.act(() => {
      component.unmount();
    });
  });
});

describe('QuickOrderComposerBar suggestion pills', () => {
  beforeAll(() => {
    Object.assign(globalThis, {
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
      cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    });
  });

  const PILLS = [
    { id: 'usual', label: 'Usual', icon: 'sparkles' as const, accent: true },
    { id: 'recent', label: 'Recent', icon: 'time-outline' as const },
    { id: 'last_week', label: 'Last week', icon: 'calendar-outline' as const },
  ];
  const PILL_LABELS = ['Usual', 'Recent', 'Last week'];

  function findPills(component: renderer.ReactTestRenderer): ReactTestRendererJSON[] {
    return collectByType(component.toJSON(), 'Pressable').filter((node) =>
      PILL_LABELS.includes(node.props?.accessibilityLabel as string),
    );
  }

  function findInput(component: renderer.ReactTestRenderer): ReactTestRendererJSON | undefined {
    return collectByType(component.toJSON(), 'TextInput').find(
      (node) => node.props?.accessibilityLabel === 'Order message',
    );
  }

  function baseProps(
    overrides: Partial<React.ComponentProps<typeof QuickOrderComposerBar>> = {},
  ): React.ComponentProps<typeof QuickOrderComposerBar> {
    return {
      onSubmit: jest.fn(),
      isSending: false,
      bottomInset: 0,
      tabBarHeight: 60,
      onComposerModeChange: jest.fn(),
      suggestionPills: PILLS,
      onSuggestionPillPress: jest.fn(),
      ...overrides,
    };
  }

  function rerender(
    component: renderer.ReactTestRenderer,
    props: React.ComponentProps<typeof QuickOrderComposerBar>,
  ) {
    renderer.act(() => {
      component.update(React.createElement(QuickOrderComposerBar, props));
    });
  }

  it('shows pills when offered and the composer is empty', () => {
    const component = renderComposer(baseProps());
    expect(findPills(component)).toHaveLength(3);
  });

  it('hides pills while typing and re-shows them once the field is cleared', () => {
    const component = renderComposer(baseProps());
    const input = findInput(component);

    renderer.act(() => {
      (input!.props.onChangeText as (next: string) => void)('salmon 2 cases');
    });
    expect(findPills(component)).toHaveLength(0);

    renderer.act(() => {
      (findInput(component)!.props.onChangeText as (next: string) => void)('');
    });
    expect(findPills(component)).toHaveLength(3);
  });

  it('hides pills after a tap and does not flash them back before the prefill lands', () => {
    const onSuggestionPillPress = jest.fn();
    const props = baseProps({ onSuggestionPillPress });
    const component = renderComposer(props);

    const usual = findPills(component).find(
      (node) => node.props?.accessibilityLabel === 'Usual',
    );
    renderer.act(() => {
      (usual!.props.onPress as () => void)();
    });
    expect(onSuggestionPillPress).toHaveBeenCalledWith('usual');
    // Composer is still empty (prefill not yet arrived) but pills must stay hidden.
    expect(findPills(component)).toHaveLength(0);

    // Prefill arrives: text becomes non-empty, pills remain hidden.
    rerender(component, { ...props, prefillText: 'Salmon\nTuna Loin', prefillNonce: 1 });
    expect(findPills(component)).toHaveLength(0);
  });

  it('re-shows pills after a no-result tap once sending completes with an empty composer', () => {
    const props = baseProps({ isSending: false });
    const component = renderComposer(props);

    const recent = findPills(component).find(
      (node) => node.props?.accessibilityLabel === 'Recent',
    );
    renderer.act(() => {
      (recent!.props.onPress as () => void)();
    });
    expect(findPills(component)).toHaveLength(0);

    // Send in flight, then completes — no prefill ever arrived (empty history).
    rerender(component, { ...props, isSending: true });
    rerender(component, { ...props, isSending: false });
    expect(findPills(component)).toHaveLength(3);
  });
});

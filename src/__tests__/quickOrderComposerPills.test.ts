import React from 'react';
import renderer, { ReactTestRendererJSON } from 'react-test-renderer';
import { ComposerSuggestionPills } from '../features/ordering/ComposerSuggestionPills';

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
    Pressable: createComponent('Pressable'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
  };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props) };
});

jest.mock('@/hooks/useScaledStyles', () => ({
  useScaledStyles: () => ({
    spacing: (n: number) => n,
    radius: (n: number) => n,
    fontSize: (n: number) => n,
  }),
}));

jest.mock('@/lib/haptics', () => ({ triggerSelectionHaptic: () => Promise.resolve() }));

const PILLS = [
  { id: 'usual', label: 'Usual', icon: 'sparkles' as const },
  { id: 'recent', label: 'Recent', icon: 'time-outline' as const },
  { id: 'last_week', label: 'Last week', icon: 'calendar-outline' as const },
];

function renderPills(props: Record<string, unknown> = {}) {
  let r!: renderer.ReactTestRenderer;
  renderer.act(() => {
    r = renderer.create(
      React.createElement(ComposerSuggestionPills, {
        pills: PILLS,
        onPress: () => {},
        ...props,
      }),
    );
  });
  return r;
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

/** Resolve a style prop (which may be a Pressable style function) to a merged object. */
function mergeStyle(style: unknown): Record<string, unknown> {
  const value =
    typeof style === 'function'
      ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  const flat: Record<string, unknown>[] = [];
  const walk = (s: unknown) => {
    if (!s) return;
    if (Array.isArray(s)) s.forEach(walk);
    else if (typeof s === 'object') flat.push(s as Record<string, unknown>);
  };
  walk(value);
  return Object.assign({}, ...flat);
}

describe('ComposerSuggestionPills', () => {
  it('renders each pill as a row-direction filled pill with the icon beside the label', () => {
    const tree = renderPills().toJSON();
    const pressables = collectByType(tree, 'Pressable');
    expect(pressables).toHaveLength(PILLS.length);

    for (const pill of PILLS) {
      const node = pressables.find((p) => p.props?.accessibilityLabel === pill.label);
      expect(node).toBeDefined();

      // Pill shape: laid out as a row, opaque background, rounded corners, padded.
      const style = mergeStyle(node!.props.style);
      expect(style.flexDirection).toBe('row');
      expect(style.alignItems).toBe('center');
      expect(style.backgroundColor).toBeTruthy();
      expect(Number(style.borderRadius)).toBeGreaterThan(0);
      expect(Number(style.borderWidth)).toBeGreaterThan(0);
      expect(Number(style.paddingHorizontal)).toBeGreaterThan(0);
      expect(Number(style.paddingVertical)).toBeGreaterThan(0);

      // Icon then label, side by side (icon first).
      const children = (node!.children ?? []).filter(
        (c): c is ReactTestRendererJSON => typeof c !== 'string' && c != null,
      );
      const icon = children.find((c) => c.type === 'Ionicons');
      const label = children.find((c) => c.type === 'Text');
      expect(icon).toBeDefined();
      expect(icon!.props.name).toBe(pill.icon);
      expect(label).toBeDefined();
      expect(children.indexOf(icon!)).toBeLessThan(children.indexOf(label!));
      expect(label!.children).toContain(pill.label);
    }
  });

  it('fires onPress with the pill id when tapped', () => {
    const onPress = jest.fn();
    const tree = renderPills({ onPress }).toJSON();
    const recent = collectByType(tree, 'Pressable').find(
      (p) => p.props?.accessibilityLabel === 'Recent',
    );
    (recent!.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledWith('recent');
  });

  it('does not fire onPress while disabled', () => {
    const onPress = jest.fn();
    const tree = renderPills({ onPress, disabled: true }).toJSON();
    const recent = collectByType(tree, 'Pressable').find(
      (p) => p.props?.accessibilityLabel === 'Recent',
    );
    (recent!.props.onPress as () => void)();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders nothing when there are no pills (chat already started)', () => {
    const tree = renderPills({ pills: [] }).toJSON();
    expect(tree).toBeNull();
  });

  it('renders an accent pill with a filled background and a contrasting label/icon', () => {
    const tree = renderPills({
      pills: [
        { id: 'usual', label: 'Usual', icon: 'sparkles', accent: true },
        { id: 'recent', label: 'Recent', icon: 'time-outline' },
      ],
    }).toJSON();
    const pressables = collectByType(tree, 'Pressable');
    const accent = pressables.find((p) => p.props?.accessibilityLabel === 'Usual')!;
    const plain = pressables.find((p) => p.props?.accessibilityLabel === 'Recent')!;

    const accentBg = mergeStyle(accent.props.style).backgroundColor;
    const plainBg = mergeStyle(plain.props.style).backgroundColor;
    expect(accentBg).not.toBe(plainBg);

    const pickColor = (node: ReactTestRendererJSON, type: string) => {
      const child = (node.children ?? []).find(
        (c): c is ReactTestRendererJSON => typeof c !== 'string' && c?.type === type,
      );
      return type === 'Ionicons' ? child!.props.color : mergeStyle(child!.props.style).color;
    };

    // Accent pill: icon and label share one (white) foreground, distinct from plain.
    expect(pickColor(accent, 'Ionicons')).toBe(pickColor(accent, 'Text'));
    expect(pickColor(accent, 'Text')).not.toBe(pickColor(plain, 'Text'));
  });
});

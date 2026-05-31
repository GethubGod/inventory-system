import React from 'react';
import renderer from 'react-test-renderer';
import { InventoryUpdateCard } from '../features/ordering/QuickOrderInventoryUpdateCard';
import type { QuickOrderInventoryUpdate } from '../features/ordering/quickOrderInventoryUpdates';

jest.mock('react-native', () => {
  const React = require('react');
  const createComponent = (name: string) => {
    const Component = React.forwardRef(({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) =>
      React.createElement(name, { ...props, ref }, children)
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
  return {
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props),
  };
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
  triggerSelectionHaptic: jest.fn(),
}));

type TestNode = {
  type: string;
  props: Record<string, unknown>;
  children: unknown;
};

function isNode(value: unknown): value is TestNode {
  return Boolean(value) && typeof value === 'object' && 'type' in (value as object);
}

function walk(node: unknown, visit: (node: TestNode) => void): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (!isNode(node)) return;
  visit(node);
  walk(node.children, visit);
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }
  return style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}

function textContent(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (isNode(node)) return textContent(node.children);
  return '';
}

function render(updates: QuickOrderInventoryUpdate[]) {
  let component!: renderer.ReactTestRenderer;
  renderer.act(() => {
    component = renderer.create(
      React.createElement(InventoryUpdateCard, {
        updates,
        onNeedsInput: jest.fn(),
      }),
    );
  });
  return component;
}

const SAMPLE_UPDATES: QuickOrderInventoryUpdate[] = [
  {
    item_id: 'white-fish',
    item_name: 'White Fish (Izumidai)',
    current_quantity: 5,
    current_unit: 'pack',
    new_quantity: null,
    new_unit: 'pack',
    status: 'needs_input',
    composer_prefill: 'White Fish 5 packs',
  },
  {
    item_id: 'salmon',
    item_name: 'Salmon',
    current_quantity: 2,
    current_unit: 'bag',
    new_quantity: 1,
    new_unit: 'pc',
    status: 'ordered',
  },
  {
    item_id: 'tuna-loin',
    item_name: 'Tuna Loin',
    current_quantity: 1,
    current_unit: 'cs',
    new_quantity: null,
    new_unit: 'cs',
    status: 'no_order',
  },
];

describe('InventoryUpdateCard', () => {
  test('renders each status with its counted quantity and trailing value', () => {
    const tree = render(SAMPLE_UPDATES).toJSON();
    const texts: string[] = [];
    walk(tree, (node) => {
      if (node.type === 'Text') texts.push(textContent(node.children));
    });
    const joined = texts.join('\n');

    expect(joined).toContain('White Fish (Izumidai) 5 packs');
    expect(joined).toContain('Needs input');
    expect(joined).toContain('Salmon 2 bags');
    expect(joined).toContain('1 piece');
    expect(joined).toContain('Tuna Loin 1 case');
    expect(joined).toContain('0 cases');
  });

  test('keeps the item name on a single line so the row never wraps', () => {
    const tree = render(SAMPLE_UPDATES).toJSON();
    const nameNodes: TestNode[] = [];
    walk(tree, (node) => {
      if (node.type === 'Text' && textContent(node.children).startsWith('White Fish (Izumidai)')) {
        nameNodes.push(node);
      }
    });

    expect(nameNodes).toHaveLength(1);
    // numberOfLines={1} + ellipsis is what stops a long name from forcing the
    // "Needs input" action onto a second line.
    expect(nameNodes[0].props.numberOfLines).toBe(1);
    const nameStyle = flattenStyle(nameNodes[0].props.style);
    expect(nameStyle.flexShrink).toBe(1);
    expect(nameStyle.minWidth).toBe(0);
  });

  test('never applies flexWrap to any row element', () => {
    const tree = render(SAMPLE_UPDATES).toJSON();
    const wrappers: Record<string, unknown>[] = [];
    walk(tree, (node) => {
      const style = flattenStyle(node.props?.style);
      if (style.flexWrap === 'wrap') wrappers.push(style);
    });
    expect(wrappers).toEqual([]);
  });

  test('pins the trailing value cluster as a non-shrinking row', () => {
    const tree = render(SAMPLE_UPDATES).toJSON();
    const trailingClusters: Record<string, unknown>[] = [];
    walk(tree, (node) => {
      if (node.type !== 'View') return;
      const style = flattenStyle(node.props.style);
      if (style.flexDirection === 'row' && style.flexShrink === 0) {
        trailingClusters.push(style);
      }
    });
    // One trailing cluster per row (3) plus the "Needs input" pressable.
    expect(trailingClusters.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Employee-app restructure: pure logic for the checklist-first Order screen —
 * display sections (categories/density), unit options, per-line unit + clear
 * with undo + reorder reducer actions, save-as-default mapping, and the
 * history payload → reorder mapping.
 */

import {
  buildDefaultLines,
  EMPTY_SELECTION_STATE,
  initSelection,
  selectionReducer,
  type SelectionState,
} from '@/features/simpleOrder/checklistSelection';
import { deriveDisplaySections } from '@/features/simpleOrder/displaySections';
import { unitOptionsForLine } from '@/features/simpleOrder/unitOptions';
import {
  buildReorderItemsFromPayload,
  formatSentTime,
} from '@/features/simpleOrder/recentOrders';
import type { Checklist } from '@/services/orderChecklist';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.default },
  StyleSheet: { hairlineWidth: 0.5 },
}));

const CHECKLIST: Checklist = {
  id: 'cl-1',
  locationGroup: 'sushi',
  generatedAt: '2026-08-18T00:00:00Z',
  items: [
    {
      id: 'row-salmon',
      itemId: 'item-salmon',
      itemName: 'Salmon (whole)',
      unit: 'fillet',
      defaultChecked: true,
      recommendedQty: 2,
      stalenessBucket: 'frequent',
      lastOrderedAt: null,
      sortOrder: 0,
    },
    {
      id: 'row-rice',
      itemId: 'item-rice',
      itemName: 'Sushi rice 50 lb',
      unit: 'bag',
      defaultChecked: false,
      recommendedQty: 1,
      stalenessBucket: 'occasional',
      lastOrderedAt: null,
      sortOrder: 1,
    },
    {
      id: 'row-yuzu',
      itemId: 'item-yuzu',
      itemName: 'Yuzu juice',
      unit: 'bottle',
      defaultChecked: false,
      recommendedQty: 1,
      stalenessBucket: 'rare',
      lastOrderedAt: null,
      sortOrder: 2,
    },
  ],
};

const CATEGORY_BY_ITEM: Record<string, string> = {
  'item-salmon': 'fish',
  'item-rice': 'dry',
  'item-yuzu': 'sauces',
};

function categoryForItemId(itemId: string | null): string | null {
  return itemId ? CATEGORY_BY_ITEM[itemId] ?? null : null;
}

function freshState(): SelectionState {
  return initSelection(CHECKLIST);
}

describe('deriveDisplaySections', () => {
  it('groups non-rare lines under ordered category labels when categories are on', () => {
    const sections = deriveDisplaySections(freshState(), {
      showCategories: true,
      rareExpanded: true,
      categoryForItemId,
    });

    expect(sections.map((section) => section.title)).toEqual([
      'Fish & Seafood',
      'Dry Goods',
      'Rarely ordered (1)',
    ]);
    expect(sections[0].data.map((line) => line.key)).toEqual(['row-salmon']);
    expect(sections[2].isRare).toBe(true);
    expect(sections[2].data.map((line) => line.key)).toEqual(['row-yuzu']);
  });

  it('renders one flat untitled list when categories are off', () => {
    const sections = deriveDisplaySections(freshState(), {
      showCategories: false,
      rareExpanded: true,
      categoryForItemId,
    });
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBeNull();
    expect(sections[0].data.map((line) => line.key)).toEqual(['row-salmon', 'row-rice']);
    expect(sections[1].isRare).toBe(true);
  });

  it('collapses the rare section to a header-only entry', () => {
    const sections = deriveDisplaySections(freshState(), {
      showCategories: false,
      rareExpanded: false,
      categoryForItemId,
    });
    const rare = sections.find((section) => section.isRare);
    expect(rare?.data).toEqual([]);
    expect(rare?.rareCount).toBe(1);
  });

  it('puts unknown-category lines in a trailing Other group', () => {
    let state = freshState();
    state = selectionReducer(state, {
      type: 'addInventoryItem',
      item: {
        id: 'item-mystery',
        name: 'Mystery jar',
        base_unit: 'jar',
        pack_unit: 'case',
      } as never,
    });
    const sections = deriveDisplaySections(state, {
      showCategories: true,
      rareExpanded: false,
      categoryForItemId,
    });
    const titles = sections.map((section) => section.title);
    expect(titles.indexOf('Other')).toBe(titles.length - 2); // before the rare section
    const other = sections.find((section) => section.title === 'Other');
    expect(other?.data.map((line) => line.itemName)).toEqual(['Mystery jar']);
  });
});

describe('unitOptionsForLine', () => {
  it('keeps the line unit first and dedupes against item + common units', () => {
    const options = unitOptionsForLine('case', {
      base_unit: 'fillet',
      pack_unit: 'case',
      default_order_unit: null as never,
    });
    expect(options[0]).toBe('case');
    expect(options).toContain('fillet');
    expect(options).toHaveLength(4);
    expect(new Set(options.map((unit) => unit.toLowerCase())).size).toBe(options.length);
  });

  it('works without inventory data', () => {
    expect(unitOptionsForLine('bag', null)).toEqual(['bag', 'case', 'lb', 'pack']);
  });
});

describe('selection reducer: setUnit / clearAll / restore / applyReorder', () => {
  it('setUnit overrides only the targeted line and ignores empty units', () => {
    let state = freshState();
    state = selectionReducer(state, { type: 'setUnit', key: 'row-salmon', unit: ' lb ' });
    expect(state.lines.find((line) => line.key === 'row-salmon')?.unit).toBe('lb');
    expect(state.lines.find((line) => line.key === 'row-rice')?.unit).toBe('bag');
    expect(selectionReducer(state, { type: 'setUnit', key: 'row-salmon', unit: '  ' })).toBe(state);
  });

  it('clearAll unchecks everything and resets quantities to recommended', () => {
    let state = freshState();
    state = selectionReducer(state, { type: 'setQuantity', key: 'row-rice', quantity: 9 });
    state = selectionReducer(state, { type: 'clearAll' });
    expect(state.lines.every((line) => !line.checked)).toBe(true);
    expect(state.lines.find((line) => line.key === 'row-rice')?.quantity).toBe(1);
    expect(state.lines.find((line) => line.key === 'row-salmon')?.quantity).toBe(2);
  });

  it('restore brings back the pre-clear snapshot (the Undo path)', () => {
    const before = selectionReducer(freshState(), {
      type: 'setQuantity',
      key: 'row-rice',
      quantity: 9,
    });
    const cleared = selectionReducer(before, { type: 'clearAll' });
    expect(cleared).not.toEqual(before);
    const restored = selectionReducer(cleared, { type: 'restore', state: before });
    expect(restored).toEqual(before);
  });

  it('applyReorder makes the past order the exact checked set', () => {
    let state = freshState(); // salmon starts checked
    state = selectionReducer(state, {
      type: 'applyReorder',
      items: [
        { itemId: 'item-rice', itemName: 'Sushi rice 50 lb', unit: null, quantity: 3 },
        { itemId: 'item-new', itemName: 'Tempura flour', unit: 'bag', quantity: 2 },
      ],
    });

    const rice = state.lines.find((line) => line.key === 'row-rice');
    expect(rice?.checked).toBe(true);
    expect(rice?.quantity).toBe(3);
    // Salmon was checked by default but is not part of the reordered order.
    expect(state.lines.find((line) => line.key === 'row-salmon')?.checked).toBe(false);

    const added = state.lines.find((line) => line.itemName === 'Tempura flour');
    expect(added?.source).toBe('search');
    expect(added?.checked).toBe(true);
    expect(added?.unit).toBe('bag');
  });

  it('applyReorder matches by name when the archived id is missing', () => {
    const state = selectionReducer(freshState(), {
      type: 'applyReorder',
      items: [{ itemId: null, itemName: 'sushi rice 50 LB', unit: null, quantity: 2 }],
    });
    const rice = state.lines.find((line) => line.key === 'row-rice');
    expect(rice?.checked).toBe(true);
    expect(rice?.quantity).toBe(2);
  });

  it('applyReorder with nothing usable leaves state untouched', () => {
    const state = freshState();
    expect(
      selectionReducer(state, {
        type: 'applyReorder',
        items: [{ itemId: null, itemName: '  ', unit: null, quantity: 0 }],
      }),
    ).toBe(state);
  });
});

describe('buildDefaultLines', () => {
  it('maps checked lines with row ids for checklist rows and null for search adds', () => {
    let state = freshState();
    state = selectionReducer(state, { type: 'setQuantity', key: 'row-rice', quantity: 4 });
    state = selectionReducer(state, {
      type: 'addInventoryItem',
      item: {
        id: 'item-nori',
        name: 'Nori half-cut',
        base_unit: 'pack',
        pack_unit: 'case',
      } as never,
    });

    const lines = buildDefaultLines(state);
    expect(lines).toEqual([
      {
        checklistItemId: 'row-salmon',
        itemId: 'item-salmon',
        itemName: 'Salmon (whole)',
        unit: 'fillet',
        quantity: 2,
      },
      {
        checklistItemId: 'row-rice',
        itemId: 'item-rice',
        itemName: 'Sushi rice 50 lb',
        unit: 'bag',
        quantity: 4,
      },
      {
        checklistItemId: null,
        itemId: 'item-nori',
        itemName: 'Nori half-cut',
        unit: 'pack',
        quantity: 1,
      },
    ]);
  });

  it('returns nothing for an empty selection', () => {
    expect(buildDefaultLines(EMPTY_SELECTION_STATE)).toEqual([]);
  });
});

describe('buildReorderItemsFromPayload', () => {
  it('parses archived regularItems and drops junk', () => {
    const items = buildReorderItemsFromPayload({
      regularItems: [
        {
          inventoryItemId: '11111111-2222-4333-8444-555555555555',
          name: 'Ahi tuna',
          quantity: 10,
          unitLabel: 'lb',
        },
        { inventoryItemId: 'unassigned:mystery:1', name: 'Mystery', quantity: 1, unitLabel: 'jar' },
        { name: '', quantity: 2 },
        { name: 'Bad qty', quantity: 0 },
      ],
    });

    expect(items).toEqual([
      {
        itemId: '11111111-2222-4333-8444-555555555555',
        itemName: 'Ahi tuna',
        unit: 'lb',
        quantity: 10,
      },
      { itemId: null, itemName: 'Mystery', unit: 'jar', quantity: 1 },
    ]);
  });

  it('handles foreign payload shapes without throwing', () => {
    expect(buildReorderItemsFromPayload(null)).toEqual([]);
    expect(buildReorderItemsFromPayload('nope')).toEqual([]);
    expect(buildReorderItemsFromPayload({})).toEqual([]);
  });
});

describe('formatSentTime', () => {
  it('formats an ISO timestamp as a short time', () => {
    expect(formatSentTime('2026-08-18T09:14:00')).toMatch(/9:14/);
  });

  it('is empty for junk input', () => {
    expect(formatSentTime('')).toBe('');
    expect(formatSentTime('not-a-date')).toBe('');
  });
});

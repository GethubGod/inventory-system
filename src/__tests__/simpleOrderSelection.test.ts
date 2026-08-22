import type { Checklist, ChecklistItem } from '@/services/orderChecklist';
import {
  addedLineKey,
  buildSendLines,
  clampQuantity,
  countChecked,
  defaultQuantityFor,
  EMPTY_SELECTION_STATE,
  initSelection,
  locationGroupForLocation,
  MAX_QUANTITY,
  sectionizeLines,
  selectionReducer,
  unitForInventoryItem,
  type SelectionState,
} from '@/features/simpleOrder/checklistSelection';
import type { InventoryItem } from '@/types';

function makeChecklistItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'chk-item-1',
    itemId: 'inv-1',
    itemName: 'Salmon',
    unit: 'lb',
    defaultChecked: true,
    recommendedQty: 3,
    stalenessBucket: 'frequent',
    lastOrderedAt: '2026-08-01T00:00:00Z',
    sortOrder: 0,
    ...overrides,
  };
}

function makeChecklist(items: ChecklistItem[]): Checklist {
  return {
    id: 'chk-1',
    locationGroup: 'sushi',
    generatedAt: '2026-08-10T00:00:00Z',
    items,
  };
}

function makeInventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'inv-9',
    name: 'Nori',
    category: 'dry',
    supplier_category: 'main_distributor',
    base_unit: 'pack',
    pack_unit: 'case',
    pack_size: 10,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as InventoryItem;
}

describe('initSelection', () => {
  it('checks default-checked items and seeds quantities from recommended qty', () => {
    const state = initSelection(
      makeChecklist([
        makeChecklistItem({ id: 'a', defaultChecked: true, recommendedQty: 2.5 }),
        makeChecklistItem({
          id: 'b',
          itemId: 'inv-2',
          itemName: 'Wasabi',
          defaultChecked: false,
          recommendedQty: null,
          stalenessBucket: 'occasional',
        }),
      ]),
    );

    expect(state.checklistId).toBe('chk-1');
    expect(state.lines).toHaveLength(2);
    expect(state.lines[0]).toMatchObject({
      key: 'a',
      checked: true,
      quantity: 2.5,
      bucket: 'frequent',
      source: 'checklist',
    });
    expect(state.lines[1]).toMatchObject({
      key: 'b',
      checked: false,
      quantity: 1,
      bucket: 'occasional',
    });
  });

  it('falls back to quantity 1 for zero/negative recommended quantities', () => {
    expect(defaultQuantityFor({ recommendedQty: 0 })).toBe(1);
    expect(defaultQuantityFor({ recommendedQty: -4 })).toBe(1);
    expect(defaultQuantityFor({ recommendedQty: null })).toBe(1);
    expect(defaultQuantityFor({ recommendedQty: 6 })).toBe(6);
  });
});

describe('selectionReducer', () => {
  const baseState = initSelection(
    makeChecklist([
      makeChecklistItem({ id: 'a', recommendedQty: 2 }),
      makeChecklistItem({
        id: 'b',
        itemId: 'inv-2',
        itemName: 'Wasabi',
        defaultChecked: false,
        stalenessBucket: 'rare',
        recommendedQty: null,
      }),
    ]),
  );

  it('toggles checked state', () => {
    const toggled = selectionReducer(baseState, { type: 'toggle', key: 'a' });
    expect(toggled.lines[0].checked).toBe(false);
    const toggledBack = selectionReducer(toggled, { type: 'toggle', key: 'a' });
    expect(toggledBack.lines[0].checked).toBe(true);
  });

  it('ignores unknown keys without changing state identity', () => {
    expect(selectionReducer(baseState, { type: 'toggle', key: 'missing' })).toBe(
      baseState,
    );
  });

  it('adjusts quantity with whole-unit stepping and a floor of 1', () => {
    let state = selectionReducer(baseState, {
      type: 'adjustQuantity',
      key: 'a',
      delta: 1,
    });
    expect(state.lines[0].quantity).toBe(3);

    state = selectionReducer(state, { type: 'adjustQuantity', key: 'a', delta: -1 });
    state = selectionReducer(state, { type: 'adjustQuantity', key: 'a', delta: -1 });
    expect(state.lines[0].quantity).toBe(1);

    // Decrement at the floor stays at the floor.
    state = selectionReducer(state, { type: 'adjustQuantity', key: 'a', delta: -1 });
    expect(state.lines[0].quantity).toBe(1);
  });

  it('snaps fractional quantities to whole steps when stepping', () => {
    const fractional = selectionReducer(baseState, {
      type: 'setQuantity',
      key: 'a',
      quantity: 2.5,
    });
    const up = selectionReducer(fractional, {
      type: 'adjustQuantity',
      key: 'a',
      delta: 1,
    });
    expect(up.lines[0].quantity).toBe(3);

    const down = selectionReducer(fractional, {
      type: 'adjustQuantity',
      key: 'a',
      delta: -1,
    });
    expect(down.lines[0].quantity).toBe(2);
  });

  it('clamps manual quantity input to valid bounds', () => {
    const tooBig = selectionReducer(baseState, {
      type: 'setQuantity',
      key: 'a',
      quantity: 100000,
    });
    expect(tooBig.lines[0].quantity).toBe(MAX_QUANTITY);

    const tooSmall = selectionReducer(baseState, {
      type: 'setQuantity',
      key: 'a',
      quantity: 0,
    });
    expect(tooSmall.lines[0].quantity).toBeGreaterThan(0);

    expect(clampQuantity(Number.NaN)).toBe(1);
  });

  it('adds an inventory item as a checked "added" line with quantity 1', () => {
    const item = makeInventoryItem();
    const state = selectionReducer(baseState, { type: 'addInventoryItem', item });

    const added = state.lines.find((line) => line.key === addedLineKey('inv-9'));
    expect(added).toMatchObject({
      source: 'search',
      itemId: 'inv-9',
      itemName: 'Nori',
      unit: 'pack',
      checked: true,
      quantity: 1,
      bucket: 'added',
    });
  });

  it('re-checks an existing checklist line instead of duplicating it', () => {
    const item = makeInventoryItem({ id: 'inv-2', name: 'Wasabi' });
    const state = selectionReducer(baseState, { type: 'addInventoryItem', item });

    expect(state.lines).toHaveLength(2);
    expect(state.lines[1]).toMatchObject({ key: 'b', checked: true });

    // Adding again when already checked is a no-op.
    expect(selectionReducer(state, { type: 'addInventoryItem', item })).toBe(state);
  });

  it('prefers default_order_unit, then base_unit, for added items', () => {
    expect(
      unitForInventoryItem(
        makeInventoryItem({ default_order_unit: 'case', base_unit: 'pack' }),
      ),
    ).toBe('case');
    expect(
      unitForInventoryItem(
        makeInventoryItem({ default_order_unit: '  ', base_unit: 'pack' }),
      ),
    ).toBe('pack');
    expect(
      unitForInventoryItem(
        makeInventoryItem({ base_unit: '', pack_unit: 'case' }),
      ),
    ).toBe('case');
  });

  it('removes search-added lines but only unchecks checklist lines', () => {
    const withAdded = selectionReducer(baseState, {
      type: 'addInventoryItem',
      item: makeInventoryItem(),
    });

    const removedAdded = selectionReducer(withAdded, {
      type: 'removeLine',
      key: addedLineKey('inv-9'),
    });
    expect(
      removedAdded.lines.find((line) => line.key === addedLineKey('inv-9')),
    ).toBeUndefined();

    const removedChecklist = selectionReducer(baseState, {
      type: 'removeLine',
      key: 'a',
    });
    expect(removedChecklist.lines[0]).toMatchObject({ key: 'a', checked: false });
    expect(removedChecklist.lines).toHaveLength(2);
  });

  it('replaces state on init', () => {
    const next = selectionReducer(EMPTY_SELECTION_STATE, {
      type: 'init',
      checklist: makeChecklist([makeChecklistItem()]),
    });
    expect(next.checklistId).toBe('chk-1');
    expect(next.lines).toHaveLength(1);
  });
});

describe('sectionizeLines / countChecked', () => {
  it('groups lines into frequent, occasional, rare, and added buckets', () => {
    let state: SelectionState = initSelection(
      makeChecklist([
        makeChecklistItem({ id: 'f', stalenessBucket: 'frequent' }),
        makeChecklistItem({
          id: 'o',
          itemId: 'inv-2',
          stalenessBucket: 'occasional',
          defaultChecked: false,
        }),
        makeChecklistItem({
          id: 'r',
          itemId: 'inv-3',
          stalenessBucket: 'rare',
          defaultChecked: false,
        }),
      ]),
    );
    state = selectionReducer(state, {
      type: 'addInventoryItem',
      item: makeInventoryItem(),
    });

    const sections = sectionizeLines(state);
    expect(sections.frequent.map((line) => line.key)).toEqual(['f']);
    expect(sections.occasional.map((line) => line.key)).toEqual(['o']);
    expect(sections.rare.map((line) => line.key)).toEqual(['r']);
    expect(sections.added.map((line) => line.key)).toEqual([addedLineKey('inv-9')]);

    expect(countChecked(state)).toBe(2); // 'f' default-checked + added line
  });
});

describe('buildSendLines', () => {
  it('builds send lines from checked items only and reports unmatched names', () => {
    let state = initSelection(
      makeChecklist([
        makeChecklistItem({ id: 'a', itemId: 'inv-1', recommendedQty: 2 }),
        makeChecklistItem({
          id: 'unmatched',
          itemId: null,
          itemName: 'Mystery Sauce',
          defaultChecked: true,
        }),
        makeChecklistItem({
          id: 'unchecked',
          itemId: 'inv-3',
          itemName: 'Tobiko',
          defaultChecked: false,
        }),
      ]),
    );
    state = selectionReducer(state, { type: 'setQuantity', key: 'a', quantity: 4 });

    const built = buildSendLines(state);
    expect(built.lines).toEqual([
      { itemId: 'inv-1', itemName: 'Salmon', unit: 'lb', quantity: 4 },
    ]);
    expect(built.unmatchedNames).toEqual(['Mystery Sauce']);
  });

  it('returns nothing for an empty selection', () => {
    const built = buildSendLines(EMPTY_SELECTION_STATE);
    expect(built.lines).toEqual([]);
    expect(built.unmatchedNames).toEqual([]);
  });
});

describe('locationGroupForLocation', () => {
  it('matches the fulfillment heuristic', () => {
    expect(locationGroupForLocation('Babytuna Sushi', 'S1')).toBe('sushi');
    expect(locationGroupForLocation('Babytuna Poki & Pho', 'P1')).toBe('poki');
    expect(locationGroupForLocation('Poke Bar', null)).toBe('poki');
    expect(locationGroupForLocation(null, 'p2')).toBe('poki');
    expect(locationGroupForLocation(null, null)).toBe('sushi');
    expect(locationGroupForLocation('Somewhere Else', 'X')).toBe('sushi');
  });
});

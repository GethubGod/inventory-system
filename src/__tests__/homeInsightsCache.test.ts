const storage = { getItem: jest.fn(async (): Promise<string | null> => null), setItem: jest.fn(async () => undefined) };
jest.mock('@react-native-async-storage/async-storage', () => storage);

// eslint-disable-next-line import/first
import { clearHomeInsightsCache, getHomeInsights, getHomeInsightsGeneration, hydrateHomeInsightsCache, setHomeInsights } from '../features/home/homeInsightsCache';

const entry = { predictedItems: [], reorderOrder: null, activeReminder: null, cachedAt: Date.now() };
beforeEach(() => { jest.clearAllMocks(); clearHomeInsightsCache(); });

it('keeps the same location separate for two employees', () => {
  setHomeInsights('employee-a', 'location-1', entry);
  expect(getHomeInsights('employee-a', 'location-1')).toEqual(entry);
  expect(getHomeInsights('employee-b', 'location-1')).toBeUndefined();
});

it('clears memory and rejects a previous-session result after logout', () => {
  const previousGeneration = getHomeInsightsGeneration();
  setHomeInsights('employee-a', 'location-1', entry);
  clearHomeInsightsCache();
  setHomeInsights('employee-a', 'location-1', entry, previousGeneration);
  expect(getHomeInsights('employee-a', 'location-1')).toBeUndefined();
});

it('does not restore disk cache if its read finishes after logout', async () => {
  let finishRead!: (value: string) => void;
  storage.getItem.mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve; }));
  const hydration = hydrateHomeInsightsCache();
  clearHomeInsightsCache();
  finishRead(JSON.stringify({ 'employee-a:location-1': entry }));
  await hydration;
  expect(getHomeInsights('employee-a', 'location-1')).toBeUndefined();
});


const item = {
  inventoryItemId: 'inventory-1', name: 'Rice', category: 'dry_goods', supplierCategory: 'restaurant',
  quantity: 2, unitType: 'pack', baseUnit: 'lb', packUnit: 'bag', packSize: 25, note: null,
};
const validCards = {
  ...entry,
  predictedItems: [{ ...item, occurrenceCount: 3 }],
  reorderOrder: { id: 'order-1', createdAt: '2026-09-01T12:00:00Z', locationId: 'location-1', items: [item], itemCount: 1 },
  activeReminder: { id: 'reminder-1', message: 'Count the freezer', senderName: null, createdAt: '2026-09-01T12:00:00Z' },
};

it('restores valid nested cards from disk', async () => {
  storage.getItem.mockResolvedValueOnce(JSON.stringify({ 'employee-a:location-1': validCards }));
  await hydrateHomeInsightsCache();
  expect(getHomeInsights('employee-a', 'location-1')).toEqual(validCards);
});

it.each([
  { ...validCards, predictedItems: [null] },
  { ...validCards, predictedItems: [{ ...item, occurrenceCount: 3, name: {} }] },
  { ...validCards, predictedItems: [{ ...item, occurrenceCount: '3' }] },
  { ...validCards, predictedItems: [{ ...item, occurrenceCount: 3, unitType: 'invalid' }] },
  { ...validCards, reorderOrder: { ...validCards.reorderOrder, items: [null] } },
  { ...validCards, reorderOrder: { ...validCards.reorderOrder, createdAt: 'not-a-date' } },
  { ...validCards, reorderOrder: { ...validCards.reorderOrder, itemCount: {} } },
  { ...validCards, activeReminder: { ...validCards.activeReminder, message: {} } },
  { ...validCards, activeReminder: { ...validCards.activeReminder, senderName: [] } },
  { ...validCards, activeReminder: [] },
])('ignores malformed nested cards %# while retaining valid entries', async (malformed) => {
  storage.getItem.mockResolvedValueOnce(JSON.stringify({
    'employee-a:location-1': malformed,
    'employee-b:location-2': validCards,
  }));
  await hydrateHomeInsightsCache();
  expect(getHomeInsights('employee-a', 'location-1')).toBeUndefined();
  expect(getHomeInsights('employee-b', 'location-2')).toEqual(validCards);
});

it.each(['null', '[]', '"invalid"', '{broken'])('ignores invalid root payload %s', async (raw) => {
  storage.getItem.mockResolvedValueOnce(raw);
  await expect(hydrateHomeInsightsCache()).resolves.toBeUndefined();
  expect(getHomeInsights('employee-a', 'location-1')).toBeUndefined();
});

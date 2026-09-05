import React from 'react';
import renderer, { act } from 'react-test-renderer';

let params: Record<string, string | string[] | undefined> = {};
const copy = jest.fn(async (_message: string) => undefined);
const share = jest.fn(async () => ({ action: 'sharedAction' }));
const replace = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => params, Stack: { Screen: 'StackScreen' }, router: { canGoBack: () => false, back: jest.fn(), replace } }));
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity', TextInput: 'TextInput', Alert: { alert: jest.fn() }, Platform: { OS: 'ios' }, Share: { share, sharedAction: 'sharedAction' } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-clipboard', () => ({ setStringAsync: copy }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('@/constants', () => ({ colors: { primary: { 500: '#000' }, gray: { 600: '#000', 700: '#000' } } }));
jest.mock('@/components/ManagerScaleContainer', () => ({ ManagerScaleContainer: 'ManagerScaleContainer' }));
jest.mock('@/components/EmptyStateCard', () => ({ EmptyStateCard: 'EmptyStateCard' }));

// eslint-disable-next-line import/first
import ExportFishOrderScreen from '../../app/(manager)/export-fish-order';
// eslint-disable-next-line import/first
import { parseFishOrderExportParams } from '../features/fulfillment/fishOrderExportParams';

beforeEach(() => {
  params = {};
  jest.clearAllMocks();
});

async function renderScreen() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(React.createElement(ExportFishOrderScreen)); });
  return tree;
}

it.each([
  {},
  { fishItems: '[null]', locationName: 'Sushi', locationShortCode: 'SU' },
  { fishItems: 'broken JSON', locationName: 'Sushi', locationShortCode: 'SU' },
])('shows an honest non-exportable state for invalid parameters %s', async (invalidParams) => {
  params = invalidParams;
  const tree = await renderScreen();
  expect(tree.root.findAll((node) => String(node.type) === 'EmptyStateCard')).toHaveLength(1);
  expect(tree.root.findAll((node) => String(node.type) === 'TextInput')).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).not.toContain('Fish Item');
  expect(copy).not.toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});


const validItem = { itemId: 'salmon', itemName: 'Salmon', quantity: 2, unit: 'case' };
const validMulti = { locationName: 'Sushi', locationShortCode: 'SU', fishItems: JSON.stringify([validItem]) };
const validLegacy = { fishItemName: 'Salmon', fishItemUnit: 'case', fishItemLocations: JSON.stringify([{ name: 'Sushi', shortCode: 'SU', quantity: 2 }]) };

it.each([
  { ...validItem, quantity: '2' },
  { ...validItem, quantity: -1 },
  { ...validItem, quantity: 0 },
  { ...validItem, quantity: null },
  { ...validItem, itemName: {} },
  { ...validItem, itemId: '' },
  { ...validItem, unit: ' ' },
])('rejects malformed item fields or empty quantities %s', (item) => {
  expect(parseFishOrderExportParams({ ...validMulti, fishItems: JSON.stringify([item]) })).toBeNull();
});

it('rejects invalid legacy rows and incomplete legacy names', () => {
  expect(parseFishOrderExportParams({ ...validLegacy, fishItemName: '' })).toBeNull();
  expect(parseFishOrderExportParams({ ...validLegacy, fishItemLocations: '[null]' })).toBeNull();
  expect(parseFishOrderExportParams({ ...validLegacy, fishItemLocations: '[{"name":"Sushi","shortCode":"SU","quantity":"2"}]' })).toBeNull();
});

it('rejects empty arrays, nonfinite quantities, and a malformed line alongside a valid line', () => {
  expect(parseFishOrderExportParams({ ...validMulti, fishItems: '[]' })).toBeNull();
  expect(parseFishOrderExportParams({ ...validMulti, fishItems: '[{"itemId":"salmon","itemName":"Salmon","quantity":1e999,"unit":"case"}]' })).toBeNull();
  expect(parseFishOrderExportParams({ ...validMulti, fishItems: JSON.stringify([validItem, null]) })).toBeNull();
});

function findAction(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find((node) => String(node.type) === 'TouchableOpacity' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0);
}

it.each([validMulti, validLegacy])('preserves the message and export actions for valid input %s', async (input) => {
  params = input;
  const tree = await renderScreen();
  expect(tree.root.findAll((node) => String(node.type) === 'EmptyStateCard')).toHaveLength(0);
  expect(tree.root.find((node) => String(node.type) === 'TextInput').props.value).toBe('2');
  await act(async () => findAction(tree, 'Copy').props.onPress());
  expect(copy).toHaveBeenCalledWith(expect.stringContaining('Sushi:\n- Salmon: 2 case'));
  await act(async () => findAction(tree, 'Share').props.onPress());
  expect(share).toHaveBeenCalledWith(expect.objectContaining({ message: copy.mock.calls[0][0], title: 'Fish Order' }));
  await act(async () => tree.unmount());
});

it('disables export after all editable quantities are set to zero', async () => {
  params = validMulti;
  const tree = await renderScreen();
  await act(async () => tree.root.find((node) => String(node.type) === 'TextInput').props.onChangeText('0'));
  const copyAction = findAction(tree, 'Copy');
  const shareAction = findAction(tree, 'Share');
  expect(copyAction.props.disabled).toBe(true);
  expect(shareAction.props.disabled).toBe(true);
  await act(async () => { await copyAction.props.onPress(); await shareAction.props.onPress(); });
  expect(copy).not.toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain('Set a quantity greater than zero');
  await act(async () => tree.unmount());
});

it('provides a back action when a deep link has no usable order', async () => {
  const tree = await renderScreen();
  await act(async () => tree.root.find((node) => String(node.type) === 'EmptyStateCard').props.onPressAction());
  expect(replace).toHaveBeenCalledWith('/(manager)');
  await act(async () => tree.unmount());
});

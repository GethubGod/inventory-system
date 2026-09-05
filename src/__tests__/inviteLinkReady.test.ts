import React from 'react';
import renderer, { act } from 'react-test-renderer';

let params: Record<string, string | string[] | undefined> = {};
const copy = jest.fn(async (_value: string) => undefined);
const openURL = jest.fn(async (_value: string) => undefined);
const share = jest.fn(async (_input: { message: string }) => undefined);
const replace = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => params, router: { replace } }));
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', Linking: { openURL }, Platform: { OS: 'ios' }, Share: { share } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-clipboard', () => ({ setStringAsync: copy }));
jest.mock('@/components', () => ({ StackScreenHeader: 'StackScreenHeader' }));
jest.mock('@/components/ManagerScaleContainer', () => ({ ManagerScaleContainer: 'ManagerScaleContainer' }));
jest.mock('@/components/EmptyStateCard', () => ({ EmptyStateCard: 'EmptyStateCard' }));
jest.mock('@/hooks/useScaledStyles', () => ({ useScaledStyles: () => ({ spacing: (n: number) => n, icon: (n: number) => n, fontSize: (n: number) => n, buttonH: 44 }) }));
jest.mock('@/theme/design', () => ({ glassHairlineWidth: 1, radii: {}, tipsTheme: {} }));
jest.mock('@/lib/haptics', () => ({ triggerNotificationHaptic: jest.fn(), NotificationFeedbackType: {} }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

// eslint-disable-next-line import/first
import InviteLinkReadyScreen from '../features/team/InviteLinkReadyScreen';

beforeEach(() => {
  params = {};
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

async function renderScreen() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(React.createElement(InviteLinkReadyScreen)); });
  return tree;
}

it.each(['', 'not a URL', 'https://example.com/join/token'])('does not claim an invalid invitation is ready: %s', async (joinUrl) => {
  if (joinUrl) params = { joinUrl };
  const tree = await renderScreen();
  expect(tree.root.findAll((node) => String(node.type) === 'EmptyStateCard')).toHaveLength(1);
  expect(JSON.stringify(tree.toJSON())).not.toContain('expires in 7 days');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Send via Messages');
  expect(copy).not.toHaveBeenCalled();
  expect(openURL).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

const validUrl = 'https://tips.babytunasystems.com/join/abcdefghijklmnopqrstuvwx_0123456';

it.each([
  'http://tips.babytunasystems.com/join/token',
  'https://evilbabytunasystems.com/join/token',
  'https://tips.babytunasystems.com.evil.example/join/token',
  'https://tips.babytunasystems.com/join/',
  'https://tips.babytunasystems.com/join/a/b',
  'https://tips.babytunasystems.com/join/a%2Fb',
  'https://tips.babytunasystems.com/join/token?token=different',
  'javascript://join/token',
])('rejects a URL outside the generated invitation contract: %s', async (joinUrl) => {
  params = { joinUrl, expiryLabel: '7 days', group: 'both' };
  const tree = await renderScreen();
  expect(tree.root.findAll((node) => String(node.type) === 'EmptyStateCard')).toHaveLength(1);
  expect(JSON.stringify(tree.toJSON())).not.toContain('Send via Messages');
  await act(async () => tree.unmount());
});

function findAction(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find((node) => String(node.type) === 'TouchableOpacity' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0);
}

it('preserves the ready screen, copy and Messages behavior for a valid generated link', async () => {
  params = { name: 'Alex', joinUrl: validUrl, expiryLabel: '3 days', group: 'sushi' };
  const tree = await renderScreen();
  expect(JSON.stringify(tree.toJSON())).toContain("Alex's link is ready");
  expect(JSON.stringify(tree.toJSON())).toContain('One use · expires in 3 days · Sushi');
  await act(async () => findAction(tree, 'Copy').props.onPress());
  expect(copy).toHaveBeenCalledWith(validUrl);
  await act(async () => findAction(tree, 'Send via Messages').props.onPress());
  expect(openURL).toHaveBeenCalledWith(`sms:&body=${encodeURIComponent(`Hi Alex, here's your Smelter setup link: ${validUrl}`)}`);
  expect(share).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

it.each([{}, { expiryLabel: 'forever', group: 'administrator' }])('does not invent missing or invalid expiry/location metadata %s', async (metadata) => {
  params = { joinUrl: validUrl, ...metadata };
  const tree = await renderScreen();
  const rendered = JSON.stringify(tree.toJSON());
  expect(rendered).not.toContain('expires in');
  expect(rendered).not.toContain('Both');
  expect(rendered).not.toContain('administrator');
  expect(rendered).toContain('Send via Messages');
  await act(async () => tree.unmount());
});

it('returns an invalid-link screen to Team without copy or send actions', async () => {
  const tree = await renderScreen();
  await act(async () => tree.root.find((node) => String(node.type) === 'EmptyStateCard').props.onPressAction());
  expect(replace).toHaveBeenCalledWith('/(manager)/manager-settings/team');
  expect(copy).not.toHaveBeenCalled();
  expect(openURL).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';

const credentialKind = jest.fn();
const alert = jest.fn();
const getUser = jest.fn();
const signInWithPassword = jest.fn();
const updateUser = jest.fn();

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Modal: 'Modal', Pressable: 'Pressable', TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView', ScrollView: 'ScrollView',
  Alert: { alert }, Platform: { OS: 'ios' },
  Animated: { Value: class { setValue() {} }, View: 'AnimatedView', timing: () => ({ start: (done: () => void) => done() }), spring: () => ({ start: () => {} }) },
  PanResponder: { create: () => ({ panHandlers: {} }) },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/theme/design', () => ({ colors: { white: '#fff' }, radii: { card: 12 }, hairline: 1, glassHairlineWidth: 1, tipsTheme: {} }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@/hooks/useScaledStyles', () => ({ useScaledStyles: () => ({ spacing: (n: number) => n, fontSize: (n: number) => n, icon: (n: number) => n }) }));
jest.mock('@/services/loginCredentials', () => ({ getMyCredentialKind: (id: string) => credentialKind(id), isValidPin: (value: string) => /^\d{4}$/.test(value), isValidPassword: (value: string) => value.length >= 8, setMyCredential: jest.fn() }));
const mockAuthState = { session: { user: { id: 'user-1' } }, isLoading: false };
jest.mock('@/store/authStore', () => ({ useAuthStore: Object.assign((selector: (state: unknown) => unknown) => selector(mockAuthState), { getState: () => mockAuthState }) }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser } }, createCredentialClient: () => ({ auth: { signInWithPassword, updateUser } }) }));

// The mocks above provide native components before the modal module loads.
// eslint-disable-next-line import/first
import { ChangePasswordModal } from '../components/settings/ChangePasswordModal';
// eslint-disable-next-line import/first
import { ChangeCredentialSheet } from '../components/settings/ChangeCredentialSheet';

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'person@example.com' } }, error: null });
  signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

async function openModal() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(React.createElement(ChangePasswordModal, { visible: true, onClose: jest.fn() })); });
  return tree;
}

it('opens the existing PIN sheet for a name-login account', async () => {
  credentialKind.mockResolvedValue('pin');
  const tree = await openModal();
  expect(tree.root.findAll((node) => String(node.type) === 'TextInput')).toHaveLength(2);
  expect(tree.root.find((node) => node.props.accessibilityLabel === 'New PIN').props.keyboardType).toBe('number-pad');
  await act(async () => tree.unmount());
});

it('shows the load error without offering an unrelated password editor', async () => {
  credentialKind.mockRejectedValue(new Error('Check your connection.'));
  const tree = await openModal();
  expect(JSON.stringify(tree.toJSON())).toContain('Check your connection.');
  expect(tree.root.findAll((node) => String(node.type) === 'TextInput')).toHaveLength(0);
  expect(tree.root.findAll((node) => String(node.type) === 'ChangeCredentialSheet')).toHaveLength(0);
  await act(async () => tree.unmount());
});

it('rejects a wrong current email password through the visible legacy form', async () => {
  credentialKind.mockResolvedValue(null);
  const tree = await openModal();
  const fields = tree.root.findAll((node) => String(node.type) === 'TextInput');
  await act(async () => {
    fields[0].props.onChangeText('incorrect');
    fields[1].props.onChangeText('new-password');
    fields[2].props.onChangeText('new-password');
  });
  const save = tree.root.findAll((node) => String(node.type) === 'TouchableOpacity').find((button) => button.findAll((node) => String(node.type) === 'Text').some((text) => text.children.join('') === 'Update Password'));
  expect(save).toBeDefined();
  await act(async () => { await save?.props.onPress(); });
  expect(updateUser).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Error', 'Current password is incorrect.');
  await act(async () => tree.unmount());
});


it.each(['pin', 'password', null])('preserves one native Modal host when lookup resolves to %s', async (kind) => {
  let resolveLookup!: (value: string | null) => void;
  credentialKind.mockReturnValue(new Promise<string | null>((resolve) => { resolveLookup = resolve; }));
  const tree = await openModal();
  const originalHost = tree.root.find((node) => String(node.type) === 'Modal');
  expect(tree.root.findAll((node) => String(node.type) === 'Modal')).toHaveLength(1);
  await act(async () => resolveLookup(kind));
  expect(tree.root.findAll((node) => String(node.type) === 'Modal')).toHaveLength(1);
  expect(Object.is(tree.root.find((node) => String(node.type) === 'Modal'), originalHost)).toBe(true);
  expect(tree.root.findAll((node) => String(node.type) === 'TextInput')).toHaveLength(kind ? 2 : 3);
  await act(async () => tree.unmount());
});


it('keeps the loading modal host when lookup fails', async () => {
  let rejectLookup!: (reason: Error) => void;
  credentialKind.mockReturnValue(new Promise<null>((_resolve, reject) => { rejectLookup = reject; }));
  const tree = await openModal();
  const originalHost = tree.root.find((node) => String(node.type) === 'Modal');
  await act(async () => rejectLookup(new Error('Offline')));
  expect(tree.root.findAll((node) => String(node.type) === 'Modal')).toHaveLength(1);
  expect(Object.is(tree.root.find((node) => String(node.type) === 'Modal'), originalHost)).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain('Offline');
  await act(async () => tree.unmount());
});

it('retains a native modal for the standalone employee credential sheet', async () => {
  let tree!: renderer.ReactTestRenderer;
  const onClose = jest.fn();
  await act(async () => { tree = renderer.create(React.createElement(ChangeCredentialSheet, { visible: true, onClose })); });
  const host = tree.root.find((node) => String(node.type) === 'Modal');
  expect(tree.root.findAll((node) => String(node.type) === 'Modal')).toHaveLength(1);
  expect(tree.root.findAll((node) => String(node.type) === 'TextInput')).toHaveLength(2);
  await act(async () => host.props.onRequestClose());
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

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
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/theme/design', () => ({ colors: { white: '#fff' }, radii: { card: 12 }, hairline: 1 }));
jest.mock('@/hooks/useScaledStyles', () => ({ useScaledStyles: () => ({ spacing: (n: number) => n, fontSize: (n: number) => n, icon: (n: number) => n }) }));
jest.mock('@/services/loginCredentials', () => ({ getMyCredentialKind: (id: string) => credentialKind(id) }));
const mockAuthState = { session: { user: { id: 'user-1' } }, isLoading: false };
jest.mock('@/store/authStore', () => ({ useAuthStore: Object.assign((selector: (state: unknown) => unknown) => selector(mockAuthState), { getState: () => mockAuthState }) }));
jest.mock('@/components/settings/ChangeCredentialSheet', () => ({ ChangeCredentialSheet: 'ChangeCredentialSheet' }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser } }, createCredentialClient: () => ({ auth: { signInWithPassword, updateUser } }) }));

// The mocks above provide native components before the modal module loads.
// eslint-disable-next-line import/first
import { ChangePasswordModal } from '../components/settings/ChangePasswordModal';

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
  expect(tree.root.find((node) => String(node.type) === 'ChangeCredentialSheet').props.initialKind).toBe('pin');
  expect(tree.root.findAll((node) => String(node.type) === 'TextInput')).toHaveLength(0);
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

const getUser = jest.fn();
const signInWithPassword = jest.fn();
const updateUser = jest.fn();
const signOut = jest.fn();
const isolatedSignIn = jest.fn();
const isolatedUpdate = jest.fn();
const originalSession = { user: { id: 'user-1' } };
let authState = { session: originalSession, isLoading: false };
jest.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => authState } }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser, signInWithPassword, updateUser, signOut } }, createCredentialClient: () => ({ auth: { signInWithPassword: isolatedSignIn, updateUser: isolatedUpdate } }) }));

/* eslint-disable import/first -- Mock factories reference initialized bindings before the subject loads. */
import { changeEmailPassword } from '../services/changePassword';
/* eslint-enable import/first */

beforeEach(() => {
  jest.clearAllMocks();
  authState = { session: originalSession, isLoading: false };
  isolatedSignIn.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  isolatedUpdate.mockResolvedValue({ error: null });
  getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'employee@example.com' } }, error: null });
  signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  updateUser.mockResolvedValue({ error: null });
});

it('rejects an incorrect current password without changing the password or signing out', async () => {
  isolatedSignIn.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });
  await expect(changeEmailPassword('incorrect', 'new-password')).rejects.toThrow('Current password is incorrect');
  expect(isolatedUpdate).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
});

it('verifies the current user before updating their email password', async () => {
  await changeEmailPassword('current-password', 'new-password');
  expect(isolatedSignIn).toHaveBeenCalledWith({ email: 'employee@example.com', password: 'current-password' });
  expect(isolatedUpdate).toHaveBeenCalledWith({ password: 'new-password' });
  expect(isolatedSignIn.mock.invocationCallOrder[0]).toBeLessThan(isolatedUpdate.mock.invocationCallOrder[0]);
});

it('does not change a password when current user verification fails offline', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Network request failed' } });
  await expect(changeEmailPassword('current-password', 'new-password')).rejects.toThrow('Unable to verify');
  expect(isolatedSignIn).not.toHaveBeenCalled();
  expect(isolatedUpdate).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
});

it('does not update a different account returned during reauthentication', async () => {
  isolatedSignIn.mockResolvedValue({ data: { user: { id: 'different-user' } }, error: null });
  await expect(changeEmailPassword('current-password', 'new-password')).rejects.toThrow('Unable to verify');
  expect(isolatedUpdate).not.toHaveBeenCalled();
});


it('verifies without replacing the shared client session', async () => {
  await changeEmailPassword('current-password', 'new-password');
  expect(signInWithPassword).not.toHaveBeenCalled();
  expect(isolatedSignIn).toHaveBeenCalledWith({ email: 'employee@example.com', password: 'current-password' });
  expect(isolatedUpdate).toHaveBeenCalledWith({ password: 'new-password' });
});

it('discards verification that completes after logout begins', async () => {
  isolatedSignIn.mockImplementation(async () => {
    authState = { session: originalSession, isLoading: true };
    return { data: { user: { id: 'user-1' } }, error: null };
  });
  await expect(changeEmailPassword('current-password', 'new-password')).rejects.toThrow('Sign in again');
  expect(updateUser).not.toHaveBeenCalled();
  expect(isolatedUpdate).not.toHaveBeenCalled();
});


it('does not update after verification if the form has been dismissed', async () => {
  const controller = new AbortController();
  isolatedSignIn.mockImplementationOnce(async () => {
    controller.abort();
    return { data: { user: { id: 'user-1' } }, error: null };
  });
  await expect(changeEmailPassword('current-password', 'new-password', controller.signal)).rejects.toThrow('Sign in again');
  expect(isolatedUpdate).not.toHaveBeenCalled();
});

it('rejects a changed app session even when the returning account has the same user ID', async () => {
  isolatedSignIn.mockImplementationOnce(async () => {
    authState = { session: { user: { id: 'user-1' } }, isLoading: false };
    return { data: { user: { id: 'user-1' } }, error: null };
  });
  await expect(changeEmailPassword('current-password', 'new-password')).rejects.toThrow('Sign in again');
  expect(isolatedUpdate).not.toHaveBeenCalled();
});

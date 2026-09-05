import { changeEmailPassword } from '../services/changePassword';

const getUser = jest.fn();
const signInWithPassword = jest.fn();
const updateUser = jest.fn();
const signOut = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser, signInWithPassword, updateUser, signOut } } }));

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'employee@example.com' } }, error: null });
  signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  updateUser.mockResolvedValue({ error: null });
});

it('rejects an incorrect current password without changing the password or signing out', async () => {
  signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });
  await expect(changeEmailPassword('incorrect', 'new-password')).rejects.toThrow('Current password is incorrect');
  expect(updateUser).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
});

it('verifies the current user before updating their email password', async () => {
  await changeEmailPassword('current-password', 'new-password');
  expect(signInWithPassword).toHaveBeenCalledWith({ email: 'employee@example.com', password: 'current-password' });
  expect(updateUser).toHaveBeenCalledWith({ password: 'new-password' });
  expect(signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(updateUser.mock.invocationCallOrder[0]);
});

it('does not change a password when current user verification fails offline', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Network request failed' } });
  await expect(changeEmailPassword('current-password', 'new-password')).rejects.toThrow('Unable to verify');
  expect(signInWithPassword).not.toHaveBeenCalled();
  expect(updateUser).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
});

it('does not update a different account returned during reauthentication', async () => {
  signInWithPassword.mockResolvedValue({ data: { user: { id: 'different-user' } }, error: null });
  await expect(changeEmailPassword('current-password', 'new-password')).rejects.toThrow('Unable to verify');
  expect(updateUser).not.toHaveBeenCalled();
});

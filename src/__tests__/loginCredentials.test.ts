// Login-credential client service: validation, error classification, and the
// sign-in exchange (edge fn -> verifyOtp -> store hydration).

const invoke = jest.fn();
const identityMaybeSingle = jest.fn();
const identityEq = jest.fn(() => ({ maybeSingle: identityMaybeSingle }));
const identitySelect = jest.fn(() => ({ eq: identityEq }));
const from = jest.fn(() => ({ select: identitySelect }));
const verifyOtp = jest.fn();
const rpc = jest.fn();
const adoptExternalSession = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from,
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    auth: { verifyOtp: (...args: unknown[]) => verifyOtp(...args) },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

jest.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ adoptExternalSession }),
  },
}));

import {
  getLoginFailureCode,
  getMyCredentialKind,
  isValidPassword,
  isValidPin,
  LoginCredentialError,
  resetUserCredential,
  setMyCredential,
  signInWithName,
} from '@/services/loginCredentials';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('credential validation', () => {
  it('accepts exactly four digits as a PIN', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('0000')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });

  it('requires at least 8 characters for a password', () => {
    expect(isValidPassword('12345678')).toBe(true);
    expect(isValidPassword('1234567')).toBe(false);
    expect(isValidPassword('x'.repeat(257))).toBe(false);
  });
});

describe('setMyCredential', () => {
  it('rejects malformed secrets before calling the server', async () => {
    await expect(setMyCredential('pin', '12345')).rejects.toThrow('4 digits');
    await expect(setMyCredential('password', 'short')).rejects.toThrow('between 8 and 256');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stores a valid PIN through the RPC', async () => {
    rpc.mockResolvedValue({ error: null });
    await setMyCredential('pin', '4321');
    expect(rpc).toHaveBeenCalledWith('set_my_login_credential', {
      p_kind: 'pin',
      p_secret: '4321',
    });
  });

  it('passes readable server errors through', async () => {
    rpc.mockResolvedValue({
      error: { message: 'This name is already used for sign-in. Ask the manager to adjust it.' },
    });
    await expect(setMyCredential('pin', '4321')).rejects.toThrow('already used for sign-in');
  });
});

describe('signInWithName', () => {
  it('exchanges the token hash for a session and hydrates the store', async () => {
    invoke.mockResolvedValue({ data: { ok: true, tokenHash: 'hash-1' }, error: null });
    verifyOtp.mockResolvedValue({ data: { session: { access_token: 'a' } }, error: null });
    adoptExternalSession.mockResolvedValue(null);

    await signInWithName('  Nate ', '4321');

    expect(invoke).toHaveBeenCalledWith('login-with-name', {
      body: { name: 'Nate', secret: '4321' },
    });
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'magiclink', token_hash: 'hash-1' });
    expect(adoptExternalSession).toHaveBeenCalledWith({ access_token: 'a' });
  });

  it('classifies structured failure codes for inline errors', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: { error: 'Too many tries. Wait a few minutes, then try again', code: 'rate_limited' },
      },
    });

    const failure = await signInWithName('Nate', '0000').catch((error) => error);
    expect(failure).toBeInstanceOf(LoginCredentialError);
    expect(getLoginFailureCode(failure)).toBe('rate_limited');
    expect(failure.message).toContain('Too many tries');
  });

  it('rejects empty input as invalid without a network call', async () => {
    const failure = await signInWithName('   ', '').catch((error) => error);
    expect(getLoginFailureCode(failure)).toBe('invalid');
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('resetUserCredential', () => {
  it('validates the PIN and calls the manager RPC', async () => {
    rpc.mockResolvedValue({ error: null });
    await resetUserCredential('user-1', '9999');
    expect(rpc).toHaveBeenCalledWith('reset_login_credential', {
      p_user_id: 'user-1',
      p_pin: '9999',
    });
    await expect(resetUserCredential('user-1', '12')).rejects.toThrow('4 digits');
  });
});


describe('credential editor selection', () => {
  it.each(['pin', 'password'] as const)('uses the stored %s name credential', async (kind) => {
    identityMaybeSingle.mockResolvedValue({ data: { credential_kind: kind }, error: null });
    await expect(getMyCredentialKind('user-1')).resolves.toBe(kind);
    expect(identitySelect).toHaveBeenCalledWith('credential_kind');
    expect(identityEq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('uses the legacy email editor only when the identity is absent', async () => {
    identityMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getMyCredentialKind('legacy-user')).resolves.toBeNull();
  });

  it('does not fall back to the wrong credential editor on an offline lookup', async () => {
    identityMaybeSingle.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await expect(getMyCredentialKind('user-1')).rejects.toThrow('Unable to load your sign-in settings');
  });
});


it.each(['Failed to send a request to the Edge Function', 'Network request failed', 'Failed to fetch'])(
  'explains connectivity errors without server implementation details: %s',
  async (message) => {
    invoke.mockResolvedValue({ data: null, error: { message } });
    await expect(signInWithName('Nate', '4321')).rejects.toThrow('Unable to connect. Check your connection and try again.');
    expect(verifyOtp).not.toHaveBeenCalled();
  },
);

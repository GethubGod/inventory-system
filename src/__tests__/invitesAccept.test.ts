// F5 regression — acceptInvite must prefer the structured `reason` field the
// accept-invite 409 body carries (like the dry-run path does) and only fall
// back to keyword classification of the error message.

const mockInvoke = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}));

import { acceptInvite, getInviteFailureReason } from '@/services/invites';

const input = {
  token: 'tok_abc',
  email: 'new@example.com',
  password: 'pw',
  name: 'New Person',
};

describe('acceptInvite error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the structured reason from the error body even when the message has no keywords', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { error: 'This link can no longer be redeemed.', reason: 'used' },
      },
    });

    const failure = await acceptInvite(input).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(getInviteFailureReason(failure)).toBe('used');
    expect((failure as Error).message).toBe('This link can no longer be redeemed.');
  });

  it('falls back to keyword classification when the body has no structured reason', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { error: 'Invite has expired' },
      },
    });

    const failure = await acceptInvite(input).catch((error) => error);
    expect(getInviteFailureReason(failure)).toBe('expired');
  });

  it('returns the accepted role on success', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, role: 'employee' }, error: null });

    await expect(acceptInvite(input)).resolves.toEqual({ role: 'employee' });
  });
});

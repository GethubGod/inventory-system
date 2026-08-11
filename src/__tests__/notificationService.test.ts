const mockFrom = jest.fn();
const mockGetNotificationsModule = jest.fn();

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('../lib/notifications', () => ({
  getNotificationsModule: mockGetNotificationsModule,
}));

jest.mock('../store', () => ({
  useSettingsStore: { getState: jest.fn() },
}));

jest.mock('../lib/supabase', () => ({
  supabase: { from: mockFrom },
}));

import {
  isPushTokenRefreshDue,
  refreshCurrentDevicePushTokenIfStale,
} from '../services/notificationService';

function pushTokenFreshnessQuery(result: { data: unknown; error: unknown }) {
  const query: any = {
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    maybeSingle: jest.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue(result);
  return query;
}

describe('push token foreground refresh policy', () => {
  const nowMs = Date.parse('2026-08-12T12:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refreshes missing, invalid, and tokens older than seven days', () => {
    expect(isPushTokenRefreshDue(null, nowMs)).toBe(true);
    expect(isPushTokenRefreshDue('not-a-date', nowMs)).toBe(true);
    expect(isPushTokenRefreshDue('2026-08-05T11:59:59.999Z', nowMs)).toBe(true);
  });

  it('does not refresh a token at or under the seven-day threshold', () => {
    expect(isPushTokenRefreshDue('2026-08-05T12:00:00.000Z', nowMs)).toBe(false);
    expect(isPushTokenRefreshDue('2026-08-11T12:00:00.000Z', nowMs)).toBe(false);
  });

  it('checks the most recently refreshed active token before deciding to renew it', async () => {
    const query = pushTokenFreshnessQuery({ data: { updated_at: new Date().toISOString() }, error: null });
    mockFrom.mockReturnValue(query);

    await expect(refreshCurrentDevicePushTokenIfStale('employee-1')).resolves.toBeNull();

    expect(mockFrom).toHaveBeenCalledWith('device_push_tokens');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'user_id', 'employee-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'active', true);
    expect(query.order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(mockGetNotificationsModule).not.toHaveBeenCalled();
  });
});

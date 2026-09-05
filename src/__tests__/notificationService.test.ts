const mockFrom = jest.fn();
const mockDeviceStorage = { getItem: jest.fn(async (): Promise<string | null> => null), setItem: jest.fn(async () => undefined) };
jest.mock('@react-native-async-storage/async-storage', () => mockDeviceStorage);
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
  clearDeviceNotifications,
  deactivateCurrentDevicePushToken,
  isPushTokenRefreshDue,
  refreshCurrentDevicePushTokenIfStale,
  registerCurrentDevicePushToken,
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


describe('shared-device notification cleanup', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deactivates only the departing user token on this device', async () => {
    mockGetNotificationsModule.mockResolvedValue({
      setNotificationHandler: jest.fn(),
      getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
      getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[this-phone]' })),
    });
    const finalEq = jest.fn(async () => ({ error: null }));
    const userEq = jest.fn(() => ({ eq: finalEq }));
    const update = jest.fn(() => ({ eq: userEq }));
    mockFrom.mockReturnValue({ update });

    await deactivateCurrentDevicePushToken('departing-user');

    expect(mockFrom).toHaveBeenCalledWith('device_push_tokens');
    expect(update).toHaveBeenCalledWith({ active: false });
    expect(userEq).toHaveBeenCalledWith('user_id', 'departing-user');
    expect(finalEq).toHaveBeenCalledWith('expo_push_token', 'ExponentPushToken[this-phone]');
  });

  it('clears scheduled reminders, delivered notifications, and the badge', async () => {
    const notifications = {
      setNotificationHandler: jest.fn(),
      cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
      dismissAllNotificationsAsync: jest.fn(async () => undefined),
      setBadgeCountAsync: jest.fn(async () => true),
    };
    mockGetNotificationsModule.mockResolvedValue(notifications);

    await clearDeviceNotifications();

    expect(notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
  });
});


it('does not register a token whose lookup finishes after logout starts', async () => {
  let finishToken!: (value: { data: string }) => void;
  const tokenLookup = new Promise<{ data: string }>((resolve) => { finishToken = resolve; });
  const getToken = jest.fn().mockReturnValueOnce(tokenLookup).mockResolvedValue({ data: 'phone-token' });
  mockGetNotificationsModule.mockResolvedValue({
    setNotificationHandler: jest.fn(),
    getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
    getExpoPushTokenAsync: getToken,
  });
  const finalEq = jest.fn(async () => ({ error: null }));
  const update = jest.fn(() => ({ eq: jest.fn(() => ({ eq: finalEq })) }));
  const upsert = jest.fn(async () => ({ error: null }));
  mockFrom.mockReturnValue({ update, upsert });

  const registration = registerCurrentDevicePushToken('race-user');
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  expect(getToken).toHaveBeenCalledTimes(1);
  const logout = deactivateCurrentDevicePushToken('race-user');
  finishToken({ data: 'phone-token' });
  await registration;
  await logout;
  expect(upsert).not.toHaveBeenCalled();
  expect(finalEq).toHaveBeenCalledWith('expo_push_token', 'phone-token');
});


it('does not request a token when notification permission is denied', async () => {
  jest.clearAllMocks();
  mockDeviceStorage.getItem.mockResolvedValue(null);
  const getToken = jest.fn();
  mockGetNotificationsModule.mockResolvedValue({
    setNotificationHandler: jest.fn(),
    getPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
    getExpoPushTokenAsync: getToken,
  });
  await deactivateCurrentDevicePushToken('denied-user');
  expect(getToken).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
});

it('uses the saved device token without contacting Expo during logout', async () => {
  jest.clearAllMocks();
  mockDeviceStorage.getItem.mockResolvedValue('saved-device-token');
  const finalEq = jest.fn(async () => ({ error: null }));
  mockFrom.mockReturnValue({ update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: finalEq })) })) });
  await deactivateCurrentDevicePushToken('cached-user');
  expect(mockGetNotificationsModule).not.toHaveBeenCalled();
  expect(finalEq).toHaveBeenCalledWith('expo_push_token', 'saved-device-token');
  mockDeviceStorage.getItem.mockResolvedValue(null);
});

it('does not clear the next session notifications after cleanup expires', async () => {
  const clear = jest.fn();
  let finishModule!: (value: unknown) => void;
  mockGetNotificationsModule.mockReturnValue(new Promise((resolve) => { finishModule = resolve; }));
  let cleanupActive = true;
  const cleanup = clearDeviceNotifications(() => cleanupActive);
  cleanupActive = false;
  finishModule({ setNotificationHandler: jest.fn(), cancelAllScheduledNotificationsAsync: clear });
  await cleanup;
  expect(clear).not.toHaveBeenCalled();
});

import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { resolveLocation } from '../hooks/useResolvedActiveLocation';
import type { Location } from '../types';

const updateDefaultLocationMock = jest.fn(async () => undefined);

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  multiRemove: jest.fn(async () => undefined),
}));

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'babytunasystems://auth/callback'),
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('../lib/api/client', () => ({
  registerSessionGetter: jest.fn(),
}));

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(async () => ({ error: null })),
      })),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(async () => ({ data: { id: '2', name: 'Babytuna Sushi', active: true } })),
        })),
      })),
    })),
  },
}));

describe('Quick Order State Persistence & Default Location', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      user: {
        id: 'user-1',
        email: 'manager@babytuna.com',
        name: 'Manager',
        role: 'manager',
        default_location_id: null,
        created_at: new Date().toISOString(),
      },
      location: null,
      locations: [
        { id: '1', name: 'Babytuna Poki', active: true, short_code: 'poki', created_at: new Date().toISOString() } as Location,
        { id: '2', name: 'Babytuna Sushi', active: true, short_code: 'sushi', created_at: new Date().toISOString() } as Location,
      ],
    });
    useSettingsStore.setState({
      quickOrderComposerMode: 'order',
    });
  });

  test('resolveLocation defaults to the location containing "sushi" if no location is active', () => {
    const locations = useAuthStore.getState().locations;
    const resolved = resolveLocation(null, locations);
    expect(resolved).toEqual(locations[1]); // Babytuna Sushi
  });

  test('setLocation syncs selected location to database for manager role', async () => {
    const updateSpy = jest.spyOn(useAuthStore.getState(), 'updateDefaultLocation').mockImplementation(updateDefaultLocationMock);

    const locations = useAuthStore.getState().locations;
    
    // Simulate setLocation
    useAuthStore.getState().setLocation(locations[0]);

    expect(updateSpy).toHaveBeenCalledWith('1');
    updateSpy.mockRestore();
  });

  test('persists and updates quickOrderComposerMode in settingsStore', () => {
    expect(useSettingsStore.getState().quickOrderComposerMode).toBe('order');
    
    useSettingsStore.getState().setQuickOrderComposerMode('inventory');
    
    expect(useSettingsStore.getState().quickOrderComposerMode).toBe('inventory');
  });
});

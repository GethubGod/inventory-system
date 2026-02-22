import { Platform } from 'react-native';
import type * as NotificationsType from 'expo-notifications';

let cachedNotificationsModule: typeof NotificationsType | null | undefined;

function isServerSideWeb(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof (globalThis as { document?: unknown }).document === 'undefined'
  );
}

export async function getNotificationsModule(): Promise<typeof NotificationsType | null> {
  if (isServerSideWeb()) {
    return null;
  }

  if (cachedNotificationsModule !== undefined) {
    return cachedNotificationsModule;
  }

  try {
    const module = await import('expo-notifications');
    cachedNotificationsModule = module as typeof NotificationsType;
  } catch {
    cachedNotificationsModule = null;
  }

  return cachedNotificationsModule;
}

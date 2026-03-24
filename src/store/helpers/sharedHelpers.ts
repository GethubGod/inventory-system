// Shared utility functions used across all order store helper domains.

import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { getNotificationsModule } from '@/lib/notifications';
import type { FulfillmentLocationGroup } from '../orderStore.types';

// ---------------------------------------------------------------------------
// Module-level mutable state
// ---------------------------------------------------------------------------

export const tableFlags = {
  pastOrdersTableAvailable: null as boolean | null,
  orderLaterItemsTableAvailable: null as boolean | null,
  pastOrderItemsTableAvailable: null as boolean | null,
  pastOrderItemsNoteColumnAvailable: null as boolean | null,
  orderItemsStatusColumnAvailable: null as boolean | null,
  pastOrderSyncListenerInitialized: false,
};

export const orderLaterMoveInFlightIds = new Set<string>();

// ---------------------------------------------------------------------------
// General utilities
// ---------------------------------------------------------------------------

export function createFulfillmentId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function toIsoString(value: unknown, fallback = new Date().toISOString()): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return fallback;
}

export function toJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function normalizeSupplierId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeLocationGroup(value: unknown): FulfillmentLocationGroup | null {
  if (value === 'sushi' || value === 'poki') return value;
  return null;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

export function normalizeHistoryLookupUnit(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Error detection
// ---------------------------------------------------------------------------

export function isNetworkLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { message?: string; details?: string };
  const text = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  return (
    text.includes('network') ||
    text.includes('offline') ||
    text.includes('failed to fetch') ||
    text.includes('connection') ||
    text.includes('timed out')
  );
}

export function isMissingTableError(error: unknown, tableName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string; details?: string };
  const message = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  if (!message.includes(tableName.toLowerCase())) return false;
  return (
    err.code === 'PGRST205' ||
    err.code === 'PGRST204' ||
    err.code === '42P01' ||
    message.includes('does not exist') ||
    message.includes('could not find')
  );
}

export function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.toLowerCase();
  if (!text.includes(columnName.toLowerCase())) return false;
  return (
    err.code === '42703' ||
    err.code === 'PGRST204' ||
    text.includes('column') && text.includes('does not exist')
  );
}

// ---------------------------------------------------------------------------
// Order-later notification helpers
// ---------------------------------------------------------------------------

export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = await getNotificationsModule();
  if (!Notifications || Platform.OS === 'web') {
    return false;
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

export async function cancelOrderLaterNotification(notificationId: string | null) {
  if (!notificationId) return;
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return;

    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Ignore stale notification identifiers.
  }
}

export async function scheduleOrderLaterNotification(input: {
  orderLaterItemId: string;
  itemName: string;
  scheduledAt: string;
}): Promise<string | null> {
  const targetDate = new Date(input.scheduledAt);
  if (Number.isNaN(targetDate.getTime())) return null;

  const granted = await ensureNotificationPermission().catch(() => false);
  if (!granted) return null;

  const minimum = Date.now() + 2_000;
  const safeTarget = targetDate.getTime() < minimum ? new Date(minimum) : targetDate;

  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return null;

    return await Notifications.scheduleNotificationAsync({
      content: {
        title: `Order later reminder: ${input.itemName}`,
        body: 'Tap to add this item to a supplier order.',
        data: {
          type: 'order-later-reminder',
          orderLaterItemId: input.orderLaterItemId,
        },
        sound: true,
      },
      trigger: safeTarget as any,
    });
  } catch {
    return null;
  }
}

export async function createOrderLaterInAppNotification(params: {
  userId: string;
  itemName: string;
  scheduledAt: string;
}) {
  try {
    await (supabase as any).from('notifications').insert({
      user_id: params.userId,
      title: `Order later scheduled: ${params.itemName}`,
      body: `Reminder set for ${new Date(params.scheduledAt).toLocaleString()}.`,
      notification_type: 'order_later_scheduled',
      payload: {
        itemName: params.itemName,
        scheduledAt: params.scheduledAt,
      },
    });
  } catch {
    // Best-effort signal only.
  }
}

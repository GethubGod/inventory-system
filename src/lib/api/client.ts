/**
 * Centralized API client for Supabase Edge Functions.
 *
 * Handles mobile-specific concerns:
 * - Offline detection via NetInfo
 * - Request timeouts (12s default)
 * - Automatic 401 → token refresh → retry
 * - Exponential-backoff retry for GET requests (1 retry max)
 * - Consistent { data, error } return shape
 *
 * Supports two server response formats:
 *  - Dashboard v1-* functions: { data: T, error: null }
 *  - Mobile-repo functions:   T (flat body) or { error: string }
 */

import NetInfo from '@react-native-community/netinfo';
import { supabase } from '@/lib/supabase';
import type { InventoryItem } from '@/types';
import type { SupplierLookupRow } from '@/services/supplierResolver';
import type { ManagedUser } from '@/services/userManagement';
import type { EmployeeReminderOverview } from '@/services/employeeReminders';

// ── Response type ─────────────────────────────────────────

export type ApiResult<T> = {
  data: T | null;
  error: string | null;
};

// ── Configuration ─────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 12_000;
const RETRY_DELAY_MS = 1_500;

function getBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return 'https://invalid.supabase.local/functions/v1';
  return `${url}/functions/v1`;
}

// ── Auth helpers ──────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) return null;
    return data.session.access_token;
  } catch {
    return null;
  }
}

// ── Network helpers ───────────────────────────────────────

async function checkConnectivity(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected !== false;
  } catch {
    return true;
  }
}

// ── Core fetch ────────────────────────────────────────────

const AUTH_EXPIRED_SENTINEL = '__AUTH_EXPIRED__';

async function rawFetch<T>(
  functionName: string,
  opts: {
    method: 'GET' | 'POST';
    body?: unknown;
    token: string | null;
    timeoutMs: number;
  }
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.token) {
    headers['Authorization'] = `Bearer ${opts.token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}/${functionName}`, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      return { data: null, error: 'Request timed out. Please try again.' };
    }
    return { data: null, error: 'Network error — please check your connection.' };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    return { data: null, error: AUTH_EXPIRED_SENTINEL };
  }

  let body: any;
  try {
    body = await response.json();
  } catch {
    return { data: null, error: `Unexpected response (${response.status})` };
  }

  if (response.status === 403) {
    const msg = typeof body?.error === 'string' ? body.error : 'Access denied. Your permissions may have changed.';
    return { data: null, error: msg };
  }

  // Dashboard format: { data: T, error: null | string }
  if (body && typeof body === 'object' && 'data' in body && 'error' in body) {
    if (!response.ok || body.error) {
      return { data: null, error: body.error ?? `Request failed (${response.status})` };
    }
    return { data: body.data as T, error: null };
  }

  // Mobile-repo format: flat body IS the data, or { error: string }
  if (!response.ok) {
    const msg = typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`;
    return { data: null, error: msg };
  }

  return { data: body as T, error: null };
}

/**
 * Make a request with automatic 401 → refresh → retry.
 * For GET requests, also retries once on transient network errors.
 */
async function request<T>(
  functionName: string,
  opts: {
    method?: 'GET' | 'POST';
    body?: unknown;
    timeoutMs?: number;
  } = {}
): Promise<ApiResult<T>> {
  const method = opts.method ?? 'POST';
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const online = await checkConnectivity();
  if (!online) {
    return { data: null, error: 'No internet connection. Please check your network and try again.' };
  }

  const token = await getAccessToken();
  let result = await rawFetch<T>(functionName, { method, body: opts.body, token, timeoutMs });

  // 401 → attempt one token refresh and retry
  if (result.error === AUTH_EXPIRED_SENTINEL) {
    const refreshedToken = await refreshAccessToken();
    if (!refreshedToken) {
      return { data: null, error: 'Session expired. Please sign in again.' };
    }
    result = await rawFetch<T>(functionName, { method, body: opts.body, token: refreshedToken, timeoutMs });
    if (result.error === AUTH_EXPIRED_SENTINEL) {
      return { data: null, error: 'Session expired. Please sign in again.' };
    }
  }

  // GET-only: retry once on transient errors (network, timeout, 5xx)
  if (method === 'GET' && result.error && isTransientError(result.error)) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    const retryToken = await getAccessToken();
    result = await rawFetch<T>(functionName, { method, body: opts.body, token: retryToken, timeoutMs });
    if (result.error === AUTH_EXPIRED_SENTINEL) {
      return { data: null, error: 'Session expired. Please sign in again.' };
    }
  }

  return result;
}

function isTransientError(error: string): boolean {
  return (
    error.includes('Network error') ||
    error.includes('timed out') ||
    error.includes('Unexpected response')
  );
}

// ── DTO transforms ────────────────────────────────────────
// Dashboard v1-* functions return camelCase DTOs.
// The mobile app uses snake_case types from the database schema.

interface InventoryItemDTO {
  id: string;
  orgId: string;
  name: string;
  emoji: string;
  category: string;
  supplierCategory: string | null;
  baseUnit: string;
  packUnit: string | null;
  packSize: number | null;
  supplierId: string | null;
  active: boolean;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface SupplierDTO {
  id: string;
  name: string;
  category: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

function inventoryDtoToItem(dto: InventoryItemDTO): InventoryItem {
  return {
    id: dto.id,
    name: dto.name,
    category: dto.category as InventoryItem['category'],
    supplier_category: (dto.supplierCategory ?? 'main_distributor') as InventoryItem['supplier_category'],
    supplier_id: dto.supplierId ?? null,
    base_unit: dto.baseUnit,
    pack_unit: dto.packUnit ?? '',
    pack_size: dto.packSize ?? 1,
    active: dto.active,
    created_at: dto.createdAt ?? '',
    created_by: null,
  };
}

function supplierDtoToLookupRow(dto: SupplierDTO): SupplierLookupRow {
  return {
    id: dto.id,
    name: dto.name,
    supplierType: dto.category,
    isDefault: false,
    active: dto.active,
  };
}

// ── User context ──────────────────────────────────────────

export interface UserContextData {
  profile: { id: string; fullName: string | null };
  membership: { orgId: string; role: string } | null;
  organization: { id: string; name: string } | null;
}

export async function getUserContext(): Promise<ApiResult<UserContextData>> {
  return request<UserContextData>('v1-get-user-context', { method: 'GET' });
}

// ── Inventory (read-only in Phase 2) ──────────────────────
// Write operations (create, update, soft-delete) require org_memberships
// rows that mobile users don't have yet. Deferred to Phase 3.

export async function listInventory(params?: {
  orgId?: string;
  limit?: number;
  offset?: number;
}): Promise<ApiResult<InventoryItem[]>> {
  const result = await request<{ items: InventoryItemDTO[]; total: number; orgId: string }>(
    'v1-list-inventory',
    { body: params ?? {} }
  );

  if (result.error || !result.data) {
    return { data: null, error: result.error };
  }

  return {
    data: result.data.items.map(inventoryDtoToItem),
    error: null,
  };
}

// ── Suppliers (read-only in Phase 2) ──────────────────────

export async function listSuppliers(params?: {
  orgId?: string;
  limit?: number;
  offset?: number;
}): Promise<ApiResult<SupplierLookupRow[]>> {
  const result = await request<{ suppliers: SupplierDTO[]; total: number; orgId: string }>(
    'v1-list-suppliers',
    { body: params ?? {} }
  );

  if (result.error || !result.data) {
    return { data: null, error: result.error };
  }

  return {
    data: result.data.suppliers.map(supplierDtoToLookupRow),
    error: null,
  };
}

// ── User management (mobile-repo edge functions) ──────────

interface ListUsersUser {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_suspended: boolean;
  last_active_at: string | null;
  last_order_at: string | null;
  created_at: string | null;
}

export async function listUsers(): Promise<ApiResult<ManagedUser[]>> {
  const result = await request<{ users: ListUsersUser[] }>('list-users');

  if (result.error || !result.data) {
    return { data: null, error: result.error };
  }

  const users: ManagedUser[] = result.data.users.map((u) => ({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role === 'manager' ? 'manager' as const : 'employee' as const,
    is_suspended: u.is_suspended,
    suspended_at: null,
    suspended_by: null,
    last_active_at: u.last_active_at,
    last_order_at: u.last_order_at,
    created_at: u.created_at,
  }));

  return { data: users, error: null };
}

export async function setUserSuspended(params: {
  userId: string;
  isSuspended: boolean;
}): Promise<ApiResult<{ success: boolean }>> {
  return request<{ success: boolean }>('set-user-suspended', { body: params });
}

// ── Employee reminders (mobile-repo edge function) ────────

export async function listEmployeesWithStatus(params?: {
  locationId?: string | null;
  includeManagers?: boolean;
  overdueThresholdDays?: number;
}): Promise<ApiResult<EmployeeReminderOverview>> {
  return request<EmployeeReminderOverview>('list-employees-with-status', {
    body: params ?? {},
  });
}

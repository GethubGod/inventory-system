import { supabase } from '@/lib/supabase';

export type ReceivingLocationGroup = 'sushi' | 'poki';
export type ReceiptStatus = 'in_progress' | 'complete' | 'partial';

export interface ReceivableOrder {
  id: string;
  supplierId: string | null;
  supplierName: string;
  createdAt: string;
  messageText: string;
  itemCount: number;
}

export interface ReceiptLineInput {
  pastOrderItemId: string;
  received: boolean;
  receivedQty?: number | null;
  note?: string | null;
}

export interface ReceiptLine {
  id: string;
  receiptId: string;
  pastOrderItemId: string;
  itemName: string;
  unit: string;
  orderedQty: number;
  locationGroup: ReceivingLocationGroup;
  received: boolean;
  receivedQty: number | null;
  note: string | null;
  updatedAt: string | null;
}

export interface ReceiptDetail {
  id: string;
  pastOrderId: string;
  receivedBy: string;
  receivedAt: string;
  status: ReceiptStatus;
  createdAt: string;
  updatedAt: string;
  pastOrder: {
    id: string;
    supplierName: string;
    createdAt: string;
    messageText: string;
  } | null;
  lines: ReceiptLine[];
}

export interface OpenReceiptSummary {
  openReceiptCount: number;
  openItemCount: number;
  discrepancyCount: number;
  oldestReceivedAt: string | null;
}

export interface ReceiptDiscrepancy {
  receiptId: string;
  receiptStatus: ReceiptStatus;
  receiptReceivedAt: string;
  pastOrderId: string;
  supplierName: string;
  orderCreatedAt: string | null;
  employee: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  line: ReceiptLine;
}

export interface ReceiptStatusLine {
  received: boolean;
  receivedQty: number | string | null | undefined;
  orderedQty: number | string | null | undefined;
}

type ReceiptRow = Record<string, any>;
type PastOrderItemRow = Record<string, any>;

const db = supabase as any;
const RECEIVABLE_ORDER_DAYS = 30;
const PROTECTING_RECEIPT_STATUSES: ReceiptStatus[] = ['in_progress', 'complete'];

const RECEIPT_COLUMNS = 'id,past_order_id,received_by,received_at,status,created_at,updated_at';
const RECEIPT_DETAIL_COLUMNS = `
  ${RECEIPT_COLUMNS},
  past_order:past_orders(id,supplier_name,created_at,message_text),
  order_receipt_items(
    id,receipt_id,past_order_item_id,received,received_qty,note,updated_at,
    past_order_item:past_order_items(id,item_name,unit,quantity,location_group,location_name)
  )
`;

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStatus(value: unknown): ReceiptStatus {
  if (value === 'complete' || value === 'partial' || value === 'in_progress') return value;
  return 'in_progress';
}

function relatedRow(value: unknown): Record<string, any> | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === 'object' ? value as Record<string, any> : null;
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function normalizedSinceDays(sinceDays: number | undefined): number {
  const parsed = Math.floor(Number(sinceDays));
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(parsed, 365));
}

/**
 * Keep this fallback aligned with fulfillmentDataSource's location grouping:
 * poki/poke names and p* short codes win; all unknown locations fall back to
 * sushi so historical rows without a location group remain receivable.
 */
export function locationGroupForLocation(
  locationName?: string | null,
  shortCode?: string | null,
): ReceivingLocationGroup {
  const name = (locationName ?? '').toLowerCase();
  const code = (shortCode ?? '').toLowerCase();

  if (name.includes('poki') || name.includes('poke') || code.startsWith('p')) return 'poki';
  return 'sushi';
}

function locationGroupForPastOrderItem(row: PastOrderItemRow): ReceivingLocationGroup {
  if (row.location_group === 'poki') return 'poki';
  if (row.location_group === 'sushi') return 'sushi';
  return locationGroupForLocation(asString(row.location_name), asString(row.location_short_code));
}

/** True for an explicitly unchecked line or a checked line received short. */
export function isReceiptLineDiscrepancy(line: ReceiptStatusLine): boolean {
  if (line.received !== true) return true;

  const orderedQty = asNumber(line.orderedQty);
  const receivedQty = asNumber(line.receivedQty);
  return orderedQty !== null && receivedQty !== null && receivedQty < orderedQty;
}

/** A receipt is complete only when every line is checked and not short. */
export function deriveReceiptStatus(lines: ReceiptStatusLine[]): Extract<ReceiptStatus, 'complete' | 'partial'> {
  return lines.some(isReceiptLineDiscrepancy) ? 'partial' : 'complete';
}

function toReceiptLine(row: ReceiptRow): ReceiptLine {
  const pastOrderItem = relatedRow(row.past_order_item);
  return {
    id: asString(row.id) ?? '',
    receiptId: asString(row.receipt_id) ?? '',
    pastOrderItemId: asString(row.past_order_item_id) ?? '',
    itemName: asString(pastOrderItem?.item_name) ?? 'Unknown item',
    unit: asString(pastOrderItem?.unit) ?? '',
    orderedQty: asNumber(pastOrderItem?.quantity) ?? 0,
    locationGroup: locationGroupForPastOrderItem(pastOrderItem ?? {}),
    received: row.received !== false,
    receivedQty: asNumber(row.received_qty),
    note: asString(row.note),
    updatedAt: asString(row.updated_at),
  };
}

function toReceiptDetail(row: ReceiptRow): ReceiptDetail {
  const pastOrder = relatedRow(row.past_order);
  return {
    id: asString(row.id) ?? '',
    pastOrderId: asString(row.past_order_id) ?? '',
    receivedBy: asString(row.received_by) ?? '',
    receivedAt: asString(row.received_at) ?? '',
    status: asStatus(row.status),
    createdAt: asString(row.created_at) ?? '',
    updatedAt: asString(row.updated_at) ?? '',
    pastOrder: pastOrder
      ? {
          id: asString(pastOrder.id) ?? '',
          supplierName: asString(pastOrder.supplier_name) ?? 'Unknown supplier',
          createdAt: asString(pastOrder.created_at) ?? '',
          messageText: asString(pastOrder.message_text) ?? '',
        }
      : null,
    lines: (Array.isArray(row.order_receipt_items) ? row.order_receipt_items : [])
      .map(toReceiptLine)
      .sort((left, right) => left.itemName.localeCompare(right.itemName)),
  };
}

function normalizedReceiptLineInput(line: ReceiptLineInput): {
  past_order_item_id: string;
  received: boolean;
  received_qty: number | null;
  note: string | null;
} {
  const pastOrderItemId = asString(line.pastOrderItemId);
  if (!pastOrderItemId) throw new Error('A receipt line is missing its past order item ID.');

  const receivedQty = line.receivedQty === undefined || line.receivedQty === null
    ? null
    : asNumber(line.receivedQty);
  if (line.receivedQty !== undefined && line.receivedQty !== null && (receivedQty === null || receivedQty < 0)) {
    throw new Error('Received quantity must be a non-negative number.');
  }

  return {
    past_order_item_id: pastOrderItemId,
    received: line.received !== false,
    received_qty: receivedQty,
    note: asString(line.note),
  };
}

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;

  const userId = data.user?.id;
  if (!userId) throw new Error('You must be signed in to receive an order.');
  return userId;
}

async function loadPastOrderForReceipt(pastOrderId: string): Promise<ReceiptRow> {
  const { data, error } = await db
    .from('past_orders')
    .select('id,past_order_items(id)')
    .eq('id', pastOrderId)
    .single();

  if (error) throw error;
  if (!data) throw new Error('Past order was not found.');
  return data as ReceiptRow;
}

async function findProtectingReceipt(pastOrderId: string): Promise<ReceiptRow | null> {
  const { data, error } = await db
    .from('order_receipts')
    .select(RECEIPT_COLUMNS)
    .eq('past_order_id', pastOrderId)
    .in('status', PROTECTING_RECEIPT_STATUSES)
    .maybeSingle();

  if (error) throw error;
  return data as ReceiptRow | null;
}

async function seedMissingReceiptLines(receiptId: string, pastOrder: ReceiptRow): Promise<void> {
  const pastOrderItems = Array.isArray(pastOrder.past_order_items) ? pastOrder.past_order_items : [];
  if (pastOrderItems.length === 0) return;

  const rows = pastOrderItems
    .map((item: ReceiptRow) => asString(item.id))
    .filter((id: string | null): id is string => Boolean(id))
    .map((pastOrderItemId: string) => ({
      receipt_id: receiptId,
      past_order_item_id: pastOrderItemId,
      received: true,
      received_qty: null,
      note: null,
    }));

  if (rows.length === 0) return;

  const { error } = await db
    .from('order_receipt_items')
    .upsert(rows, {
      onConflict: 'receipt_id,past_order_item_id',
      ignoreDuplicates: true,
    });
  if (error) throw error;
}

/** Lists sent orders from the last 30 days with lines for the requested group. */
export async function listReceivableOrders(locationGroup: ReceivingLocationGroup): Promise<ReceivableOrder[]> {
  const { data, error } = await db
    .from('past_orders')
    .select(`
      id,supplier_id,supplier_name,created_at,message_text,
      past_order_items(id,location_group,location_name),
      order_receipts(id,status)
    `)
    .gte('created_at', daysAgoIso(RECEIVABLE_ORDER_DAYS))
    .order('created_at', { ascending: false })
    .limit(250);

  if (error) throw error;

  return (Array.isArray(data) ? data : [])
    .map((order: ReceiptRow) => {
      const matchingItems = (Array.isArray(order.past_order_items) ? order.past_order_items : [])
        .filter((item: ReceiptRow) => locationGroupForPastOrderItem(item) === locationGroup);
      const hasCompleteReceipt = (Array.isArray(order.order_receipts) ? order.order_receipts : [])
        .some((receipt: ReceiptRow) => receipt.status === 'complete');

      if (matchingItems.length === 0 || hasCompleteReceipt) return null;
      return {
        id: asString(order.id) ?? '',
        supplierId: asString(order.supplier_id),
        supplierName: asString(order.supplier_name) ?? 'Unknown supplier',
        createdAt: asString(order.created_at) ?? '',
        messageText: asString(order.message_text) ?? '',
        itemCount: matchingItems.length,
      } satisfies ReceivableOrder;
    })
    .filter((order: ReceivableOrder | null): order is ReceivableOrder => order !== null);
}

/** Loads one receipt with its source order and ordered quantities. */
export async function getReceipt(receiptId: string): Promise<ReceiptDetail> {
  const id = asString(receiptId);
  if (!id) throw new Error('Missing receipt ID.');

  const { data, error } = await db
    .from('order_receipts')
    .select(RECEIPT_DETAIL_COLUMNS)
    .eq('id', id)
    .single();

  if (error) throw error;
  if (!data) throw new Error('Receipt was not found.');
  return toReceiptDetail(data as ReceiptRow);
}

/**
 * Opens a receipt and creates default-checked lines for every source line.
 * Calling this again resumes an in-progress receipt; a completed receipt is
 * deliberately not reopened. A partial receipt may start a follow-up receipt.
 */
export async function startReceipt(pastOrderId: string): Promise<ReceiptDetail> {
  const id = asString(pastOrderId);
  if (!id) throw new Error('Missing past order ID.');

  const [userId, pastOrder] = await Promise.all([getCurrentUserId(), loadPastOrderForReceipt(id)]);
  let receipt = await findProtectingReceipt(id);

  if (receipt?.status === 'complete') {
    throw new Error('This order already has a completed receipt.');
  }

  if (!receipt) {
    const { data, error } = await db
      .from('order_receipts')
      .insert({ past_order_id: id, received_by: userId })
      .select(RECEIPT_COLUMNS)
      .single();

    if (error) {
      // The partial unique index can race with another device beginning the
      // same receipt. Re-load the winner and continue instead of failing a
      // normal retry.
      if ((error as any).code !== '23505') throw error;
      receipt = await findProtectingReceipt(id);
      if (!receipt) throw error;
      if (receipt.status === 'complete') throw new Error('This order already has a completed receipt.');
    } else {
      receipt = data as ReceiptRow;
    }
  }

  if (!receipt?.id) throw new Error('Receipt could not be created.');
  await seedMissingReceiptLines(receipt.id, pastOrder);
  return getReceipt(receipt.id);
}

/** Saves checked, short-quantity, and note changes without completing the receipt. */
export async function saveReceiptLines(receiptId: string, lines: ReceiptLineInput[]): Promise<ReceiptLine[]> {
  const id = asString(receiptId);
  if (!id) throw new Error('Missing receipt ID.');

  const normalizedLines = lines.map(normalizedReceiptLineInput);
  if (normalizedLines.length === 0) return [];

  const { data, error } = await db
    .from('order_receipt_items')
    .upsert(
      normalizedLines.map((line) => ({ receipt_id: id, ...line })),
      { onConflict: 'receipt_id,past_order_item_id' },
    )
    .select(`
      id,receipt_id,past_order_item_id,received,received_qty,note,updated_at,
      past_order_item:past_order_items(id,item_name,unit,quantity,location_group,location_name)
    `);

  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((row: ReceiptRow) => toReceiptLine(row));
}

/** Finalizes a receipt as complete or partial from its saved receipt lines. */
export async function completeReceipt(receiptId: string): Promise<ReceiptDetail> {
  const id = asString(receiptId);
  if (!id) throw new Error('Missing receipt ID.');

  const { data: lines, error: linesError } = await db
    .from('order_receipt_items')
    .select('received,received_qty,past_order_item:past_order_items(quantity)')
    .eq('receipt_id', id);
  if (linesError) throw linesError;

  const status = deriveReceiptStatus(
    (Array.isArray(lines) ? lines : []).map((line: ReceiptRow) => ({
      received: line.received !== false,
      receivedQty: line.received_qty,
      orderedQty: relatedRow(line.past_order_item)?.quantity,
    })),
  );

  const { error: updateError } = await db
    .from('order_receipts')
    .update({ status })
    .eq('id', id);
  if (updateError) throw updateError;

  return getReceipt(id);
}

/** Counts receipts that are still being checked, for the manager receiving view. */
export async function getOpenReceiptSummary(): Promise<OpenReceiptSummary> {
  const { data, error } = await db
    .from('order_receipts')
    .select(`
      id,received_at,
      order_receipt_items(
        received,received_qty,
        past_order_item:past_order_items(quantity)
      )
    `)
    .eq('status', 'in_progress')
    .order('received_at', { ascending: true });

  if (error) throw error;

  const receipts = Array.isArray(data) ? data : [];
  const lines = receipts.flatMap((receipt: ReceiptRow) =>
    Array.isArray(receipt.order_receipt_items) ? receipt.order_receipt_items : [],
  );

  return {
    openReceiptCount: receipts.length,
    openItemCount: lines.length,
    discrepancyCount: lines.filter((line: ReceiptRow) => isReceiptLineDiscrepancy({
      received: line.received !== false,
      receivedQty: line.received_qty,
      orderedQty: relatedRow(line.past_order_item)?.quantity,
    })).length,
    oldestReceivedAt: receipts.length > 0 ? asString(receipts[0].received_at) : null,
  };
}

/**
 * Returns missing/short lines received in the requested window. The embedded
 * query joins receipt -> past order + receiving employee and line -> ordered
 * item; quantity comparison stays client-side because it compares two joined
 * columns in PostgREST.
 */
export async function listDiscrepancies(sinceDays = 30): Promise<ReceiptDiscrepancy[]> {
  const since = daysAgoIso(normalizedSinceDays(sinceDays));
  const { data, error } = await db
    .from('order_receipt_items')
    .select(`
      id,receipt_id,past_order_item_id,received,received_qty,note,updated_at,
      past_order_item:past_order_items!inner(id,item_name,unit,quantity,location_group,location_name),
      receipt:order_receipts!inner(
        id,past_order_id,received_by,received_at,status,
        past_order:past_orders!inner(id,supplier_name,created_at),
        employee:users!order_receipts_received_by_fkey(id,name,email)
      )
    `)
    .gte('receipt.received_at', since)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  return (Array.isArray(data) ? data : [])
    .map((row: ReceiptRow) => {
      const receipt = relatedRow(row.receipt);
      const pastOrder = relatedRow(receipt?.past_order);
      const employee = relatedRow(receipt?.employee);
      const line = toReceiptLine(row);
      if (!receipt || !isReceiptLineDiscrepancy(line)) return null;

      return {
        receiptId: asString(receipt.id) ?? line.receiptId,
        receiptStatus: asStatus(receipt.status),
        receiptReceivedAt: asString(receipt.received_at) ?? '',
        pastOrderId: asString(receipt.past_order_id) ?? '',
        supplierName: asString(pastOrder?.supplier_name) ?? 'Unknown supplier',
        orderCreatedAt: asString(pastOrder?.created_at),
        employee: employee
          ? {
              id: asString(employee.id) ?? '',
              name: asString(employee.name),
              email: asString(employee.email),
            }
          : null,
        line,
      } satisfies ReceiptDiscrepancy;
    })
    .filter((discrepancy: ReceiptDiscrepancy | null): discrepancy is ReceiptDiscrepancy => discrepancy !== null);
}

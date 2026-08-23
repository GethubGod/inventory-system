import { supabase } from '@/lib/supabase';

export type InvoiceScanStatus = 'uploaded' | 'parsed' | 'failed';

export interface InvoiceScanItem {
  id: string;
  lineNumber: number;
  rawName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  matchedItemId: string | null;
  matchedPastOrderItemId: string | null;
  matchedItemName: string | null;
  orderedQuantity: number | null;
  orderedUnit: string | null;
  priceDelta: number | null;
  quantityDelta: number | null;
}

export interface InvoiceMismatchSummary {
  totalLines: number;
  matchedLines: number;
  unmatchedLines: number;
  priceMismatchCount: number;
  quantityMismatchCount: number;
}

export interface InvoiceScanDetail {
  id: string;
  pastOrderId: string | null;
  supplierId: string;
  uploadedBy: string;
  status: InvoiceScanStatus;
  imagePath: string;
  createdAt: string;
  parsedAt: string | null;
  parseError: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  pastOrder: {
    id: string;
    supplierName: string;
    createdAt: string | null;
  } | null;
  items: InvoiceScanItem[];
  mismatchSummary: InvoiceMismatchSummary;
}

export interface InvoiceParseResult {
  scanId: string;
  status: InvoiceScanStatus;
  itemCount: number;
  matchedCount?: number;
  priceMismatchCount?: number;
  quantityMismatchCount?: number;
  idempotent?: boolean;
  modelUsed?: string;
}

export interface InvoiceConfirmResult {
  scanId: string;
  status: InvoiceScanStatus;
  priceHistoryRowsWritten?: number;
  idempotent: boolean;
}

export interface SupplierPriceHistoryEntry {
  id: string;
  supplierId: string;
  itemId: string;
  unit: string;
  unitPrice: number;
  observedAt: string;
  sourceInvoiceScanId: string;
  sourceInvoiceScanItemId: string;
}

type Row = Record<string, any>;

const db = supabase as any;
const EPSILON = 0.000001;
const SCAN_COLUMNS = `
  id,past_order_id,supplier_id,uploaded_by,status,image_path,created_at,parsed_at,parse_error,confirmed_at,confirmed_by,
  past_order:past_orders(id,supplier_name,created_at),
  invoice_scan_items(
    id,line_number,raw_name,qty,unit,unit_price,total_price,matched_item_id,matched_past_order_item_id,price_delta,quantity_delta,
    past_order_item:past_order_items(id,item_name,unit,quantity)
  )
`;

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function relatedRow(value: unknown): Row | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === 'object' ? value as Row : null;
}

function scanStatus(value: unknown): InvoiceScanStatus {
  if (value === 'parsed' || value === 'failed' || value === 'uploaded') return value;
  return 'uploaded';
}

function requireId(value: string | null | undefined, label: string): string {
  const id = asString(value);
  if (!id) throw new Error(`${label} is required.`);
  return id;
}

function toInvoiceScanItem(row: Row): InvoiceScanItem {
  const pastOrderItem = relatedRow(row.past_order_item);
  return {
    id: asString(row.id) ?? '',
    lineNumber: asNumber(row.line_number) ?? 0,
    rawName: asString(row.raw_name) ?? '',
    quantity: asNumber(row.qty) ?? 0,
    unit: asString(row.unit) ?? '',
    unitPrice: asNumber(row.unit_price) ?? 0,
    totalPrice: asNumber(row.total_price) ?? 0,
    matchedItemId: asString(row.matched_item_id),
    matchedPastOrderItemId: asString(row.matched_past_order_item_id),
    matchedItemName: asString(pastOrderItem?.item_name),
    orderedQuantity: asNumber(pastOrderItem?.quantity),
    orderedUnit: asString(pastOrderItem?.unit),
    priceDelta: asNumber(row.price_delta),
    quantityDelta: asNumber(row.quantity_delta),
  };
}

export function isInvoicePriceMismatch(item: Pick<InvoiceScanItem, 'priceDelta'>): boolean {
  return item.priceDelta !== null && Math.abs(item.priceDelta) > EPSILON;
}

export function isInvoiceQuantityMismatch(item: Pick<InvoiceScanItem, 'quantityDelta'>): boolean {
  return item.quantityDelta !== null && Math.abs(item.quantityDelta) > EPSILON;
}

export function summarizeInvoiceMismatches(items: InvoiceScanItem[]): InvoiceMismatchSummary {
  const matchedLines = items.filter((item) => item.matchedPastOrderItemId !== null).length;
  return {
    totalLines: items.length,
    matchedLines,
    unmatchedLines: items.length - matchedLines,
    priceMismatchCount: items.filter(isInvoicePriceMismatch).length,
    quantityMismatchCount: items.filter(isInvoiceQuantityMismatch).length,
  };
}

function toInvoiceScanDetail(row: Row): InvoiceScanDetail {
  const pastOrder = relatedRow(row.past_order);
  const items = (Array.isArray(row.invoice_scan_items) ? row.invoice_scan_items : [])
    .map((item: Row) => toInvoiceScanItem(item))
    .sort((left: InvoiceScanItem, right: InvoiceScanItem) => left.lineNumber - right.lineNumber);
  return {
    id: asString(row.id) ?? '',
    pastOrderId: asString(row.past_order_id),
    supplierId: asString(row.supplier_id) ?? '',
    uploadedBy: asString(row.uploaded_by) ?? '',
    status: scanStatus(row.status),
    imagePath: asString(row.image_path) ?? '',
    createdAt: asString(row.created_at) ?? '',
    parsedAt: asString(row.parsed_at),
    parseError: asString(row.parse_error),
    confirmedAt: asString(row.confirmed_at),
    confirmedBy: asString(row.confirmed_by),
    pastOrder: pastOrder
      ? {
          id: asString(pastOrder.id) ?? '',
          supplierName: asString(pastOrder.supplier_name) ?? 'Unknown supplier',
          createdAt: asString(pastOrder.created_at),
        }
      : null,
    items,
    mismatchSummary: summarizeInvoiceMismatches(items),
  };
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const userId = asString(data.user?.id);
  if (!userId) throw new Error('You must be signed in to scan a supplier invoice.');
  return userId;
}

function assertUploaderScopedImagePath(imagePath: string, userId: string): string {
  const path = requireId(imagePath, 'Invoice image path');
  if (path.includes('..') || !path.startsWith(`${userId}/`)) {
    throw new Error('Invoice image path must be in the signed-in uploader folder.');
  }
  return path;
}

async function assertPastOrderSupplier(pastOrderId: string, supplierId: string): Promise<void> {
  const { data, error } = await db
    .from('past_orders')
    .select('id,supplier_id')
    .eq('id', pastOrderId)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Past order was not found.');
  const orderSupplierId = asString(data.supplier_id);
  if (orderSupplierId && orderSupplierId !== supplierId) {
    throw new Error('Invoice supplier must match the linked past order supplier.');
  }
}

/** Create the scan record after the caller uploaded `<userId>/<filename>` to supplier-invoices. */
export async function createScan(
  pastOrderId: string | null,
  supplierId: string,
  imagePath: string,
): Promise<InvoiceScanDetail> {
  const [userId, normalizedSupplierId] = await Promise.all([
    currentUserId(),
    Promise.resolve(requireId(supplierId, 'Supplier ID')),
  ]);
  const normalizedPastOrderId = pastOrderId === null ? null : requireId(pastOrderId, 'Past order ID');
  const normalizedImagePath = assertUploaderScopedImagePath(imagePath, userId);

  if (normalizedPastOrderId) {
    await assertPastOrderSupplier(normalizedPastOrderId, normalizedSupplierId);
  }

  const { data, error } = await db
    .from('invoice_scans')
    .insert({
      past_order_id: normalizedPastOrderId,
      supplier_id: normalizedSupplierId,
      uploaded_by: userId,
      image_path: normalizedImagePath,
    })
    .select(SCAN_COLUMNS)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Invoice scan could not be created.');
  return toInvoiceScanDetail(data as Row);
}

export async function triggerParse(scanId: string): Promise<InvoiceParseResult> {
  const id = requireId(scanId, 'Invoice scan ID');
  const { data, error } = await supabase.functions.invoke('parse-invoice', { body: { scanId: id } });
  if (error) throw error;
  const result = data as Record<string, unknown> | null;
  if (!result?.success) throw new Error(asString(result?.message) ?? 'Invoice parsing failed.');
  return {
    scanId: asString(result.scanId) ?? id,
    status: scanStatus(result.status),
    itemCount: asNumber(result.itemCount) ?? 0,
    matchedCount: asNumber(result.matchedCount) ?? undefined,
    priceMismatchCount: asNumber(result.priceMismatchCount) ?? undefined,
    quantityMismatchCount: asNumber(result.quantityMismatchCount) ?? undefined,
    idempotent: result.idempotent === true,
    modelUsed: asString(result.modelUsed) ?? undefined,
  };
}

export async function getScan(scanId: string): Promise<InvoiceScanDetail> {
  const id = requireId(scanId, 'Invoice scan ID');
  const { data, error } = await db
    .from('invoice_scans')
    .select(SCAN_COLUMNS)
    .eq('id', id)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Invoice scan was not found.');
  return toInvoiceScanDetail(data as Row);
}

export async function confirmScan(scanId: string): Promise<InvoiceConfirmResult> {
  const id = requireId(scanId, 'Invoice scan ID');
  const { data, error } = await supabase.functions.invoke('confirm-invoice-scan', { body: { scanId: id } });
  if (error) throw error;
  const result = data as Record<string, unknown> | null;
  if (!result?.success) throw new Error(asString(result?.message) ?? 'Invoice confirmation failed.');
  return {
    scanId: asString(result.scanId) ?? id,
    status: scanStatus(result.status),
    priceHistoryRowsWritten: asNumber(result.priceHistoryRowsWritten) ?? undefined,
    idempotent: result.idempotent === true,
  };
}

/** Manager-only under RLS. Returns the most recent confirmed supplier prices first. */
export async function listSupplierPriceHistory(supplierId: string): Promise<SupplierPriceHistoryEntry[]> {
  const id = requireId(supplierId, 'Supplier ID');
  const { data, error } = await db
    .from('supplier_price_history')
    .select('id,supplier_id,item_id,unit,unit_price,observed_at,source_invoice_scan_id,source_invoice_scan_item_id')
    .eq('supplier_id', id)
    .order('observed_at', { ascending: false });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((row: Row) => ({
    id: asString(row.id) ?? '',
    supplierId: asString(row.supplier_id) ?? '',
    itemId: asString(row.item_id) ?? '',
    unit: asString(row.unit) ?? '',
    unitPrice: asNumber(row.unit_price) ?? 0,
    observedAt: asString(row.observed_at) ?? '',
    sourceInvoiceScanId: asString(row.source_invoice_scan_id) ?? '',
    sourceInvoiceScanItemId: asString(row.source_invoice_scan_item_id) ?? '',
  }));
}

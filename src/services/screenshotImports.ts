import { supabase } from '@/lib/supabase';

export const ORDER_SCREENSHOTS_BUCKET = 'order-screenshots';

export type ScreenshotImportStatus = 'uploaded' | 'parsed' | 'reviewed' | 'merged' | 'failed';
export type ScreenshotItemReviewState = 'matched' | 'manual' | 'skipped' | 'pending';
export type ScreenshotLocationGroup = 'sushi' | 'poki';
export type ScreenshotUploadBody = Blob | ArrayBuffer | Uint8Array;

export interface ScreenshotImageMetadata {
  path: string;
  originalName?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

export interface CreateScreenshotImportInput {
  /** Generate this first when upload paths are needed before the row is created. */
  id?: string;
  locationId: string;
  /** Defaults to today when the review flow has no historical date picker. */
  orderDate?: string;
  images: ScreenshotImageMetadata[];
  supplierId?: string | null;
  employeeId?: string | null;
  originalText?: string | null;
}

export interface ScreenshotImportItem {
  id: string;
  importId: string;
  rawName: string;
  quantity: number | null;
  unit: string | null;
  confidence: number | null;
  matchedItemId: string | null;
  reviewState: ScreenshotItemReviewState;
  sourceImagePath: string | null;
  sourceLineIndex: number | null;
  note: string | null;
}

export interface ScreenshotImport {
  id: string;
  importedBy: string | null;
  employeeId: string | null;
  locationId: string;
  supplierId: string | null;
  orderDate: string | null;
  status: ScreenshotImportStatus;
  confidence: number | null;
  parseError: string | null;
  images: ScreenshotImageMetadata[];
  createdAt: string | null;
  parsedAt: string | null;
  reviewedAt: string | null;
  mergedAt: string | null;
  items: ScreenshotImportItem[];
}

export type SetScreenshotItemReviewInput =
  | { matchedItemId: string; skip?: never }
  | { skip: true; matchedItemId?: never };

type Row = Record<string, any>;

const db = supabase as any;
const IMPORT_COLUMNS = [
  'id',
  'imported_by',
  'employee_id',
  'location_id',
  'supplier_id',
  'order_date',
  'status',
  'confidence',
  'parse_error',
  'image_paths',
  'created_at',
  'parsed_at',
  'reviewed_at',
  'merged_at',
].join(',');
const ITEM_COLUMNS = [
  'id',
  'import_id',
  'raw_name',
  'item_name_snapshot',
  'quantity',
  'unit',
  'confidence',
  'matched_item_id',
  'item_id',
  'review_state',
  'source_image_path',
  'source_line_index',
  'original_line',
].join(',');
const IMPORT_WITH_ITEMS_COLUMNS = `${IMPORT_COLUMNS},historical_order_import_items(${ITEM_COLUMNS})`;

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

function asStatus(value: unknown): ScreenshotImportStatus {
  if (value === 'uploaded' || value === 'parsed' || value === 'reviewed' || value === 'merged' || value === 'failed') {
    return value;
  }
  return 'failed';
}

function asReviewState(value: unknown): ScreenshotItemReviewState {
  if (value === 'matched' || value === 'manual' || value === 'skipped' || value === 'pending') {
    return value;
  }
  return 'pending';
}

function imageMetadataFromStored(value: unknown): ScreenshotImageMetadata[] {
  if (!Array.isArray(value)) return [];
  const images: ScreenshotImageMetadata[] = [];
  for (const entry of value) {
    const record = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : null;
    const path = typeof entry === 'string' ? asString(entry) : asString(record?.path);
    if (!path) continue;
    images.push({
      path,
      originalName: asString(record?.original_name) ?? asString(record?.originalName),
      mimeType: asString(record?.mime_type) ?? asString(record?.mimeType),
      size: asNumber(record?.size),
    });
  }
  return images;
}

function toItem(row: Row): ScreenshotImportItem {
  return {
    id: asString(row.id) ?? '',
    importId: asString(row.import_id) ?? '',
    rawName: asString(row.raw_name) ?? asString(row.item_name_snapshot) ?? 'Unknown item',
    quantity: asNumber(row.quantity),
    unit: asString(row.unit),
    confidence: asNumber(row.confidence),
    matchedItemId: asString(row.matched_item_id) ?? asString(row.item_id),
    reviewState: asReviewState(row.review_state),
    sourceImagePath: asString(row.source_image_path),
    sourceLineIndex: asNumber(row.source_line_index),
    note: asString(row.original_line),
  };
}

function toImport(row: Row): ScreenshotImport {
  return {
    id: asString(row.id) ?? '',
    importedBy: asString(row.imported_by),
    employeeId: asString(row.employee_id),
    locationId: asString(row.location_id) ?? '',
    supplierId: asString(row.supplier_id),
    orderDate: asString(row.order_date),
    status: asStatus(row.status),
    confidence: asNumber(row.confidence),
    parseError: asString(row.parse_error),
    images: imageMetadataFromStored(row.image_paths),
    createdAt: asString(row.created_at),
    parsedAt: asString(row.parsed_at),
    reviewedAt: asString(row.reviewed_at),
    mergedAt: asString(row.merged_at),
    items: (Array.isArray(row.historical_order_import_items) ? row.historical_order_import_items : [])
      .map((item) => toItem(item as Row))
      .sort((left, right) => {
        const byImage = (left.sourceImagePath ?? '').localeCompare(right.sourceImagePath ?? '');
        return byImage || (left.sourceLineIndex ?? Number.MAX_SAFE_INTEGER) - (right.sourceLineIndex ?? Number.MAX_SAFE_INTEGER);
      }),
  };
}

function requireUuidLike(value: string, field: string): string {
  const trimmed = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    throw new Error(`${field} must be a valid UUID.`);
  }
  return trimmed;
}

function requireOrderDate(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T12:00:00.000Z`))) {
    throw new Error('orderDate must be an ISO calendar date (YYYY-MM-DD).');
  }
  return trimmed;
}

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error('You must be signed in to manage screenshot imports.');
  return userId;
}

/** A UUID can be generated before upload so every image gets a stable path. */
export function createScreenshotImportId(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return id;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

/** Returns a private, import-scoped object path safe for Storage RLS. */
export function screenshotImportUploadPath(importId: string, originalName: string, index: number): string {
  const safeImportId = requireUuidLike(importId, 'importId');
  if (!Number.isInteger(index) || index < 0) throw new Error('image index must be a non-negative integer.');
  const sourceName = originalName.trim() || 'screenshot';
  const safeName = sourceName
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'screenshot';
  return `imports/${safeImportId}/${String(index + 1).padStart(3, '0')}-${safeName}`;
}

export async function uploadScreenshotImage(input: {
  path: string;
  body: ScreenshotUploadBody;
  contentType: string;
}): Promise<string> {
  const path = asString(input.path);
  if (!path || path.includes('..')) throw new Error('Screenshot upload path is invalid.');
  const contentType = asString(input.contentType)?.toLowerCase();
  if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    throw new Error('Screenshots must be JPEG, PNG, or WebP images.');
  }

  const { data, error } = await db
    .storage
    .from(ORDER_SCREENSHOTS_BUCKET)
    .upload(path, input.body, { contentType, upsert: false });
  if (error) throw error;
  return asString(data?.path) ?? path;
}

export async function createImport(input: CreateScreenshotImportInput): Promise<ScreenshotImport> {
  const importedBy = await getCurrentUserId();
  const id = input.id ? requireUuidLike(input.id, 'id') : createScreenshotImportId();
  const locationId = requireUuidLike(input.locationId, 'locationId');
  const orderDate = requireOrderDate(input.orderDate ?? new Date().toISOString().slice(0, 10));
  if (!Array.isArray(input.images) || input.images.length === 0) {
    throw new Error('Add at least one screenshot before creating an import.');
  }

  const images = input.images.map((image, index) => {
    const path = asString(image.path);
    if (!path || path.includes('..')) throw new Error(`Screenshot ${index + 1} has an invalid upload path.`);
    return {
      path,
      original_name: asString(image.originalName),
      mime_type: asString(image.mimeType),
      size: image.size == null ? null : asNumber(image.size),
    };
  });

  const { data, error } = await db
    .from('historical_order_imports')
    .insert({
      id,
      imported_by: importedBy,
      employee_id: input.employeeId ? requireUuidLike(input.employeeId, 'employeeId') : null,
      location_id: locationId,
      supplier_id: input.supplierId ? requireUuidLike(input.supplierId, 'supplierId') : null,
      placed_at: `${orderDate}T12:00:00.000Z`,
      order_date: orderDate,
      original_text: asString(input.originalText) ?? `Screenshot import (${images.length} image${images.length === 1 ? '' : 's'})`,
      source: 'screenshot',
      status: 'uploaded',
      image_paths: images,
    })
    .select(IMPORT_COLUMNS)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Screenshot import was not created.');
  return toImport(data as Row);
}

export async function triggerParse(importId: string): Promise<{ status: ScreenshotImportStatus; idempotent: boolean }> {
  const safeImportId = requireUuidLike(importId, 'importId');
  const { data, error } = await db.functions.invoke('parse-order-screenshot', {
    body: { importId: safeImportId },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(asString(data?.message) ?? 'Screenshot parsing failed.');
  return {
    status: asStatus(data.status),
    idempotent: data.idempotent === true,
  };
}

export async function getImport(importId: string): Promise<ScreenshotImport | null> {
  const safeImportId = requireUuidLike(importId, 'importId');
  const { data, error } = await db
    .from('historical_order_imports')
    .select(IMPORT_WITH_ITEMS_COLUMNS)
    .eq('id', safeImportId)
    .eq('source', 'screenshot')
    .maybeSingle();
  if (error) throw error;
  return data ? toImport(data as Row) : null;
}

export async function setItemReview(
  itemId: string,
  review: SetScreenshotItemReviewInput,
): Promise<ScreenshotImportItem> {
  const safeItemId = requireUuidLike(itemId, 'itemId');
  const patch = 'skip' in review && review.skip === true
    ? { review_state: 'skipped', matched_item_id: null, item_id: null }
    : (() => {
      const matchedItemId = requireUuidLike((review as { matchedItemId: string }).matchedItemId, 'matchedItemId');
      return { review_state: 'manual', matched_item_id: matchedItemId, item_id: matchedItemId };
    })();

  const { data, error } = await db
    .from('historical_order_import_items')
    .update(patch)
    .eq('id', safeItemId)
    .select(ITEM_COLUMNS)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Screenshot import item was not found.');
  return toItem(data as Row);
}

export async function confirmReview(importId: string): Promise<void> {
  const safeImportId = requireUuidLike(importId, 'importId');
  const { error } = await db.rpc('confirm_screenshot_import_review', { p_import_id: safeImportId });
  if (error) throw error;
}

export async function merge(importId: string, locationGroup: ScreenshotLocationGroup): Promise<string> {
  const safeImportId = requireUuidLike(importId, 'importId');
  const userId = await getCurrentUserId();
  if (locationGroup !== 'sushi' && locationGroup !== 'poki') {
    throw new Error('locationGroup must be sushi or poki.');
  }
  const { data, error } = await db.rpc('merge_screenshot_import', {
    p_import_id: safeImportId,
    p_user_id: userId,
    p_location_group: locationGroup,
  });
  if (error) throw error;
  const checklistId = asString(data);
  if (!checklistId) throw new Error('Screenshot import merge did not return a checklist.');
  return checklistId;
}

const mockAuthGetUser = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockStorageFrom = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: mockAuthGetUser },
    from: mockFrom,
    rpc: mockRpc,
    functions: { invoke: mockInvoke },
    storage: { from: mockStorageFrom },
  },
}));

import {
  ORDER_SCREENSHOTS_BUCKET,
  confirmReview,
  createImport,
  getImport,
  merge,
  screenshotImportUploadPath,
  setItemReview,
  triggerParse,
  uploadScreenshotImage,
} from '../services/screenshotImports';

const IMPORT_ID = '10000000-0000-4000-8000-000000000001';
const LOCATION_ID = '20000000-0000-4000-8000-000000000001';
const ITEM_ID = '30000000-0000-4000-8000-000000000001';
const INVENTORY_ID = '40000000-0000-4000-8000-000000000001';

type QueryResult = { data: unknown; error: unknown };

function insertQuery(result: QueryResult) {
  const query: any = { insert: jest.fn(), select: jest.fn(), single: jest.fn() };
  query.insert.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.single.mockResolvedValue(result);
  return query;
}

function readQuery(result: QueryResult) {
  const query: any = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue(result);
  return query;
}

function updateQuery(result: QueryResult) {
  const query: any = { update: jest.fn(), eq: jest.fn(), select: jest.fn(), single: jest.fn() };
  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.single.mockResolvedValue(result);
  return query;
}

function importRow(overrides: Record<string, unknown> = {}) {
  return {
    id: IMPORT_ID,
    imported_by: 'manager-1',
    employee_id: null,
    location_id: LOCATION_ID,
    supplier_id: null,
    order_date: '2026-08-12',
    status: 'uploaded',
    confidence: null,
    parse_error: null,
    image_paths: [{
      path: `imports/${IMPORT_ID}/001-order.png`,
      original_name: 'order.png',
      mime_type: 'image/png',
      size: 123,
    }],
    created_at: '2026-08-12T12:00:00.000Z',
    parsed_at: null,
    reviewed_at: null,
    merged_at: null,
    ...overrides,
  };
}

describe('screenshotImports service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'manager-1' } }, error: null });
  });

  test('creates an uploaded screenshot import with storage metadata and a supplied stable ID', async () => {
    const query = insertQuery({ data: importRow(), error: null });
    mockFrom.mockReturnValue(query);

    const created = await createImport({
      id: IMPORT_ID,
      locationId: LOCATION_ID,
      orderDate: '2026-08-12',
      images: [{
        path: `imports/${IMPORT_ID}/001-order.png`,
        originalName: 'order.png',
        mimeType: 'image/png',
        size: 123,
      }],
    });

    expect(mockFrom).toHaveBeenCalledWith('historical_order_imports');
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: IMPORT_ID,
      imported_by: 'manager-1',
      location_id: LOCATION_ID,
      placed_at: '2026-08-12T12:00:00.000Z',
      order_date: '2026-08-12',
      source: 'screenshot',
      status: 'uploaded',
      image_paths: [expect.objectContaining({ path: `imports/${IMPORT_ID}/001-order.png` })],
    }));
    expect(created).toEqual(expect.objectContaining({
      id: IMPORT_ID,
      status: 'uploaded',
      images: [expect.objectContaining({ path: `imports/${IMPORT_ID}/001-order.png`, mimeType: 'image/png' })],
    }));
  });

  test('builds stable private paths and uploads only supported image types', async () => {
    expect(screenshotImportUploadPath(IMPORT_ID, 'Kitchen Order (final).png', 0))
      .toBe(`imports/${IMPORT_ID}/001-Kitchen-Order-final-.png`);

    const upload = jest.fn().mockResolvedValue({
      data: { path: `imports/${IMPORT_ID}/001-order.png` },
      error: null,
    });
    mockStorageFrom.mockReturnValue({ upload });

    await expect(uploadScreenshotImage({
      path: `imports/${IMPORT_ID}/001-order.png`,
      body: new ArrayBuffer(1),
      contentType: 'image/png',
    })).resolves.toBe(`imports/${IMPORT_ID}/001-order.png`);

    expect(mockStorageFrom).toHaveBeenCalledWith(ORDER_SCREENSHOTS_BUCKET);
    expect(upload).toHaveBeenCalledWith(
      `imports/${IMPORT_ID}/001-order.png`,
      expect.any(ArrayBuffer),
      { contentType: 'image/png', upsert: false },
    );
  });

  test('loads parsed items and retains pending review state for the review UI', async () => {
    const query = readQuery({
      data: importRow({
        status: 'parsed',
        historical_order_import_items: [{
          id: ITEM_ID,
          import_id: IMPORT_ID,
          raw_name: 'samon',
          item_name_snapshot: 'samon',
          quantity: '2',
          unit: 'cs',
          confidence: '0.81',
          matched_item_id: null,
          item_id: null,
          review_state: 'pending',
          source_image_path: `imports/${IMPORT_ID}/001-order.png`,
          source_line_index: 0,
          original_line: 'samon 2 cs',
        }],
      }),
      error: null,
    });
    mockFrom.mockReturnValue(query);

    await expect(getImport(IMPORT_ID)).resolves.toEqual(expect.objectContaining({
      status: 'parsed',
      items: [expect.objectContaining({
        id: ITEM_ID,
        rawName: 'samon',
        quantity: 2,
        confidence: 0.81,
        reviewState: 'pending',
      })],
    }));
  });

  test('marks manual selections with both legacy and screenshot match IDs, or skips explicitly', async () => {
    const manualQuery = updateQuery({
      data: {
        id: ITEM_ID, import_id: IMPORT_ID, raw_name: 'samon', item_name_snapshot: 'samon',
        quantity: '2', unit: 'cs', confidence: '0.81', matched_item_id: INVENTORY_ID,
        item_id: INVENTORY_ID, review_state: 'manual', source_image_path: null,
        source_line_index: null, original_line: null,
      },
      error: null,
    });
    mockFrom.mockReturnValueOnce(manualQuery);

    await expect(setItemReview(ITEM_ID, { matchedItemId: INVENTORY_ID }))
      .resolves.toEqual(expect.objectContaining({ matchedItemId: INVENTORY_ID, reviewState: 'manual' }));
    expect(manualQuery.update).toHaveBeenCalledWith({
      review_state: 'manual', matched_item_id: INVENTORY_ID, item_id: INVENTORY_ID,
    });

    const skipQuery = updateQuery({
      data: {
        id: ITEM_ID, import_id: IMPORT_ID, raw_name: 'ignore me', item_name_snapshot: 'ignore me',
        quantity: '1', unit: 'cs', confidence: '0.2', matched_item_id: null, item_id: null,
        review_state: 'skipped', source_image_path: null, source_line_index: null, original_line: null,
      },
      error: null,
    });
    mockFrom.mockReturnValueOnce(skipQuery);

    await expect(setItemReview(ITEM_ID, { skip: true }))
      .resolves.toEqual(expect.objectContaining({ reviewState: 'skipped', matchedItemId: null }));
    expect(skipQuery.update).toHaveBeenCalledWith({
      review_state: 'skipped', matched_item_id: null, item_id: null,
    });
  });

  test('triggers parsing then confirms and merges for the signed-in checklist user', async () => {
    mockInvoke.mockResolvedValue({ data: { success: true, status: 'parsed', idempotent: false }, error: null });
    mockRpc
      .mockResolvedValueOnce({ data: IMPORT_ID, error: null })
      .mockResolvedValueOnce({ data: '50000000-0000-4000-8000-000000000001', error: null });

    await expect(triggerParse(IMPORT_ID)).resolves.toEqual({ status: 'parsed', idempotent: false });
    await expect(confirmReview(IMPORT_ID)).resolves.toBeUndefined();
    await expect(merge(IMPORT_ID, 'sushi')).resolves.toBe('50000000-0000-4000-8000-000000000001');

    expect(mockInvoke).toHaveBeenCalledWith('parse-order-screenshot', { body: { importId: IMPORT_ID } });
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'confirm_screenshot_import_review', { p_import_id: IMPORT_ID });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'merge_screenshot_import', {
      p_import_id: IMPORT_ID,
      p_user_id: 'manager-1',
      p_location_group: 'sushi',
    });
  });
});

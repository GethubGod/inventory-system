// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { z } from "https://esm.sh/zod@3.25.76";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import {
  type InvoiceOrderCandidate,
  type InvoiceParsedLine,
  reconcileInvoiceLines,
  supplierPriceKey,
} from "../_shared/invoice-reconciliation.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

type Row = Record<string, unknown>;

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY") ??
  Deno.env.get("GOOGLE_API_KEY");
// Keep invoice vision on the same cost/latency model family as the repository's
// order parsers, while permitting an independent rollout override.
const INVOICE_PARSE_MODEL = Deno.env.get("INVOICE_PARSE_MODEL") ??
  Deno.env.get("QUICK_ORDER_DEFAULT_MODEL") ??
  "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const InvoiceLineSchema = z.object({
  raw_name: z.string().trim().min(1).max(300),
  quantity: z.number().finite().min(0),
  unit: z.string().trim().min(1).max(80),
  unit_price: z.number().finite().min(0),
  total_price: z.number().finite().min(0),
});

const InvoiceParseSchema = z.object({
  line_items: z.array(InvoiceLineSchema).max(300),
});

type InvoiceParse = z.infer<typeof InvoiceParseSchema>;

const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          raw_name: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          unit_price: { type: "number" },
          total_price: { type: "number" },
        },
        required: ["raw_name", "quantity", "unit", "unit_price", "total_price"],
      },
    },
  },
  required: ["line_items"],
};

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
    },
  });
}

function errorResponse(
  req: Request,
  status: number,
  errorCode: string,
  message: string,
  retryable = false,
): Response {
  return jsonResponse(
    req,
    { success: false, errorCode, message, retryable },
    status,
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

function parseScanId(body: unknown): string | null {
  const scanId = asString(asRecord(body)?.scanId);
  return scanId && UUID_PATTERN.test(scanId) ? scanId : null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function parseGeminiJson(rawText: string): InvoiceParse | null {
  const candidates = [rawText, rawText.match(/\{[\s\S]*\}/)?.[0]].filter(
    (value): value is string => Boolean(value),
  );
  for (const candidate of candidates) {
    try {
      return InvoiceParseSchema.parse(JSON.parse(candidate));
    } catch {
      // One retry is requested from Gemini below if this response is malformed.
    }
  }
  return null;
}

function buildInvoicePrompt(): string {
  return `You extract purchasable line items from a supplier invoice image for a restaurant inventory app.

Return only strict JSON that follows the supplied response schema. Do not return markdown, explanation, tax, subtotal, discount, shipping, payment, balance, invoice number, date, or supplier name.

For every actual product line:
- raw_name: product name exactly enough to match the invoice; omit SKU-only noise.
- quantity: numeric quantity. Use 1 only when the line clearly represents one item and prints no quantity.
- unit: printed purchase unit normalized when obvious (case, box, bag, pack, bottle, tray, each, lb, oz, kg, g). Use "each" only when a product line has no stated unit.
- unit_price: per-unit price, never the extended total. If only quantity and total are printed, divide total by quantity.
- total_price: extended price for the product line, excluding tax and fees. If only unit price and quantity are printed, multiply them.

Handle decimal quantities and dollar signs. Ignore ambiguous non-product lines rather than inventing values.`;
}

async function callGeminiInvoice(
  input: { imageBase64: string; mimeType: string },
): Promise<InvoiceParse> {
  if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not configured");
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${INVOICE_PARSE_MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiApiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                {
                  text: attempt === 0
                    ? buildInvoicePrompt()
                    : `${buildInvoicePrompt()}\n\nThe previous response was invalid. Return only JSON matching every required field in the response schema.`,
                },
                {
                  inlineData: {
                    mimeType: input.mimeType,
                    data: input.imageBase64,
                  },
                },
              ],
            }],
            generationConfig: {
              temperature: 0,
              responseMimeType: "application/json",
              responseSchema: GEMINI_RESPONSE_SCHEMA,
            },
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Gemini invoice request failed: ${response.status}`);
      }
      const payload = await response.json();
      const parsed = parseGeminiJson(
        String(payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""),
      );
      if (!parsed) throw new Error("Gemini returned invalid invoice JSON");
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("Gemini returned invalid invoice JSON");
}

async function getAuthenticatedActor(req: Request): Promise<
  {
    id: string;
    isManager: boolean;
  } | null
> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length).trim();
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role,is_suspended")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.is_suspended === true) return null;
  return { id: user.id, isManager: profile?.role === "manager" };
}

async function getAuthorizedScan(
  scanId: string,
  actor: { id: string; isManager: boolean },
): Promise<Row | null> {
  const { data, error } = await supabaseAdmin
    .from("invoice_scans")
    .select(
      "id,past_order_id,supplier_id,uploaded_by,status,image_path,confirmed_at",
    )
    .eq("id", scanId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const scan = data as Row;
  if (scan.uploaded_by !== actor.id && !actor.isManager) return null;
  return scan;
}

function orderedUnitPriceFromPayload(
  payload: unknown,
  itemId: string,
): number | null {
  const root = asRecord(payload);
  const lines = Array.isArray(root?.regularItems) ? root?.regularItems : [];
  for (const entry of lines) {
    const line = asRecord(entry);
    if (!line) continue;
    const lineItemId = asString(line.inventoryItemId) ?? asString(line.itemId);
    if (lineItemId !== itemId) continue;
    const price = asNumber(line.unit_price) ?? asNumber(line.unitPrice) ??
      asNumber(line.price);
    if (price !== null && price >= 0) return price;
  }
  return null;
}

async function fetchOrderCandidates(
  pastOrderId: string | null,
): Promise<InvoiceOrderCandidate[]> {
  if (!pastOrderId) return [];
  const [
    { data: orderItems, error: itemError },
    { data: order, error: orderError },
  ] = await Promise.all([
    supabaseAdmin
      .from("past_order_items")
      .select("id,item_id,item_name,quantity,unit")
      .eq("past_order_id", pastOrderId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("past_orders")
      .select("payload")
      .eq("id", pastOrderId)
      .maybeSingle(),
  ]);
  if (itemError) throw itemError;
  if (orderError) throw orderError;

  const itemIds = [
    ...new Set(
      (orderItems ?? [])
        .map((row: Row) => asString(row.item_id))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const aliasesByItemId = new Map<string, string[]>();
  if (itemIds.length > 0) {
    const { data: inventoryRows, error: inventoryError } = await supabaseAdmin
      .from("inventory_items")
      .select("id,aliases")
      .in("id", itemIds);
    if (inventoryError) {
      // The raw past-order name remains a safe deterministic fallback. Do not
      // fail invoice parsing only because aliases are unavailable.
      console.warn(
        "[parse-invoice] inventory aliases unavailable",
        inventoryError.message,
      );
    } else {
      for (const row of (inventoryRows ?? []) as Row[]) {
        const id = asString(row.id);
        if (!id) continue;
        aliasesByItemId.set(
          id,
          Array.isArray(row.aliases)
            ? row.aliases.filter((alias): alias is string =>
              typeof alias === "string"
            )
            : [],
        );
      }
    }
  }

  return (orderItems ?? []).map((row: Row): InvoiceOrderCandidate | null => {
    const id = asString(row.id);
    const itemId = asString(row.item_id);
    const itemName = asString(row.item_name);
    const quantity = asNumber(row.quantity);
    const unit = asString(row.unit);
    if (!id || !itemId || !itemName || quantity === null || !unit) return null;
    return {
      id,
      itemId,
      itemName,
      quantity,
      unit,
      aliases: aliasesByItemId.get(itemId) ?? [],
      orderedUnitPrice: orderedUnitPriceFromPayload(order?.payload, itemId),
    };
  }).filter((candidate): candidate is InvoiceOrderCandidate =>
    candidate !== null
  );
}

async function fetchLatestPrices(
  supplierId: string,
  candidates: InvoiceOrderCandidate[],
): Promise<Map<string, number>> {
  const itemIds = [...new Set(candidates.map((candidate) => candidate.itemId))];
  if (itemIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from("supplier_price_history")
    .select("item_id,unit,unit_price,observed_at")
    .eq("supplier_id", supplierId)
    .in("item_id", itemIds)
    .order("observed_at", { ascending: false });
  if (error) throw error;

  const prices = new Map<string, number>();
  for (const row of (data ?? []) as Row[]) {
    const itemId = asString(row.item_id);
    const unit = asString(row.unit);
    const unitPrice = asNumber(row.unit_price);
    if (!itemId || !unit || unitPrice === null) continue;
    const key = supplierPriceKey(itemId, unit);
    if (!prices.has(key)) prices.set(key, unitPrice);
  }
  return prices;
}

async function markScanFailed(scanId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("invoice_scans")
    .update({
      status: "failed",
      parse_error: "Invoice parsing failed. Please try again.",
    })
    .eq("id", scanId);
  if (error) {
    console.error(
      "[parse-invoice] failed to record parse failure",
      error.message,
    );
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersForRequest(req) });
  }
  if (req.method !== "POST") {
    return errorResponse(
      req,
      405,
      "METHOD_NOT_ALLOWED",
      "Use POST for invoice parsing.",
      false,
    );
  }

  let scanId: string | null = null;
  let authorized = false;
  try {
    const body = await req.json().catch(() => null);
    scanId = parseScanId(body);
    if (!scanId) {
      return errorResponse(
        req,
        400,
        "INVALID_SCAN_ID",
        "A valid scanId is required.",
        false,
      );
    }

    const actor = await getAuthenticatedActor(req);
    if (!actor) {
      return errorResponse(
        req,
        401,
        "UNAUTHORIZED",
        "Sign in to parse an invoice.",
        false,
      );
    }

    const scan = await getAuthorizedScan(scanId, actor);
    if (!scan) {
      return errorResponse(
        req,
        404,
        "SCAN_NOT_FOUND",
        "Invoice scan was not found.",
        false,
      );
    }
    authorized = true;

    if (scan.status === "parsed") {
      const { data: items, error } = await supabaseAdmin
        .from("invoice_scan_items")
        .select("id")
        .eq("invoice_scan_id", scanId);
      if (error) throw error;
      return jsonResponse(req, {
        success: true,
        scanId,
        status: "parsed",
        itemCount: (items ?? []).length,
        idempotent: true,
      });
    }
    if (!geminiApiKey) {
      return errorResponse(
        req,
        503,
        "API_KEY_MISSING",
        "Invoice parsing is temporarily unavailable.",
        true,
      );
    }

    const imagePath = asString(scan.image_path);
    if (!imagePath) {
      await markScanFailed(scanId);
      return errorResponse(
        req,
        422,
        "IMAGE_MISSING",
        "Invoice image path is missing.",
        false,
      );
    }
    const { data: image, error: imageError } = await supabaseAdmin.storage
      .from("supplier-invoices")
      .download(imagePath);
    if (imageError || !image) {
      throw new Error("Invoice image could not be downloaded");
    }
    if (image.size <= 0 || image.size > MAX_IMAGE_BYTES) {
      await markScanFailed(scanId);
      return errorResponse(
        req,
        413,
        "IMAGE_TOO_LARGE",
        "Invoice image must be no larger than 10 MB.",
        false,
      );
    }
    const mimeType = image.type.toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
      await markScanFailed(scanId);
      return errorResponse(
        req,
        415,
        "UNSUPPORTED_IMAGE",
        "Use a JPEG, PNG, or WebP invoice image.",
        false,
      );
    }

    const [parsed, candidates] = await Promise.all([
      callGeminiInvoice({
        imageBase64: arrayBufferToBase64(await image.arrayBuffer()),
        mimeType,
      }),
      fetchOrderCandidates(asString(scan.past_order_id)),
    ]);
    const latestPrices = await fetchLatestPrices(
      asString(scan.supplier_id) ?? "",
      candidates,
    );
    const lines: InvoiceParsedLine[] = parsed.line_items.map((line) => ({
      rawName: line.raw_name,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unit_price,
      totalPrice: line.total_price,
    }));
    const reconciled = reconcileInvoiceLines({
      lines,
      candidates,
      latestPriceByItemAndUnit: latestPrices,
    });

    const { error: clearError } = await supabaseAdmin
      .from("invoice_scan_items")
      .delete()
      .eq("invoice_scan_id", scanId);
    if (clearError) throw clearError;

    if (reconciled.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("invoice_scan_items")
        .insert(reconciled.map((line, index) => ({
          invoice_scan_id: scanId,
          line_number: index + 1,
          raw_name: line.rawName,
          qty: line.quantity,
          unit: line.unit,
          unit_price: line.unitPrice,
          total_price: line.totalPrice,
          matched_item_id: line.matchedItemId,
          matched_past_order_item_id: line.matchedPastOrderItemId,
          price_delta: line.priceDelta,
          quantity_delta: line.quantityDelta,
        })));
      if (insertError) throw insertError;
    }

    const { error: scanUpdateError } = await supabaseAdmin
      .from("invoice_scans")
      .update({
        status: "parsed",
        parsed_at: new Date().toISOString(),
        parse_error: null,
      })
      .eq("id", scanId);
    if (scanUpdateError) throw scanUpdateError;

    return jsonResponse(req, {
      success: true,
      scanId,
      status: "parsed",
      itemCount: reconciled.length,
      matchedCount: reconciled.filter((line) =>
        line.matchedPastOrderItemId
      ).length,
      priceMismatchCount: reconciled.filter((line) =>
        line.priceMismatch
      ).length,
      quantityMismatchCount: reconciled.filter((line) =>
        line.quantityMismatch
      ).length,
      modelUsed: INVOICE_PARSE_MODEL,
    });
  } catch (error) {
    console.error(
      "[parse-invoice] failed",
      error instanceof Error ? error.message : error,
    );
    if (scanId && authorized) await markScanFailed(scanId);
    return errorResponse(
      req,
      500,
      "PARSE_FAILED",
      "Invoice parsing failed. Please try again.",
      true,
    );
  }
});

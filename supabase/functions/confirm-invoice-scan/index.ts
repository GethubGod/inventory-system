// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2?no-dts";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import { normalizeInvoiceUnit } from "../_shared/invoice-reconciliation.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

type Row = Record<string, unknown>;
type SupplierPriceHistoryInsert = {
  supplier_id: string;
  item_id: string;
  unit: string;
  unit_price: number;
  observed_at: string;
  source_invoice_scan_id: string;
  source_invoice_scan_item_id: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

function parseScanId(body: unknown): string | null {
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Row
    : null;
  const scanId = asString(record?.scanId);
  return scanId && UUID_PATTERN.test(scanId) ? scanId : null;
}

async function getAuthenticatedActor(
  req: Request,
): Promise<{ id: string; isManager: boolean } | null> {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersForRequest(req) });
  }
  if (req.method !== "POST") {
    return errorResponse(
      req,
      405,
      "METHOD_NOT_ALLOWED",
      "Use POST to confirm an invoice scan.",
      false,
    );
  }

  try {
    const scanId = parseScanId(await req.json().catch(() => null));
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
        "Sign in to confirm an invoice scan.",
        false,
      );
    }

    const { data: scanData, error: scanError } = await supabaseAdmin
      .from("invoice_scans")
      .select("id,supplier_id,uploaded_by,status,confirmed_at")
      .eq("id", scanId)
      .maybeSingle();
    if (scanError) throw scanError;
    const scan = scanData as Row | null;
    if (!scan || (scan.uploaded_by !== actor.id && !actor.isManager)) {
      return errorResponse(
        req,
        404,
        "SCAN_NOT_FOUND",
        "Invoice scan was not found.",
        false,
      );
    }
    if (scan.confirmed_at) {
      return jsonResponse(req, {
        success: true,
        scanId,
        status: "parsed",
        idempotent: true,
      });
    }
    if (scan.status !== "parsed") {
      return errorResponse(
        req,
        409,
        "SCAN_NOT_PARSED",
        "Parse the invoice before confirming it.",
        false,
      );
    }

    const { data: itemData, error: itemError } = await supabaseAdmin
      .from("invoice_scan_items")
      .select("id,matched_item_id,unit,unit_price")
      .eq("invoice_scan_id", scanId)
      .order("line_number", { ascending: true });
    if (itemError) throw itemError;

    const sourceSupplierId = asString(scan.supplier_id);
    if (!sourceSupplierId) throw new Error("Invoice scan has no supplier");
    const historyRows: SupplierPriceHistoryInsert[] = (itemData ?? []).map(
      (row: Row) => {
        const sourceItemId = asString(row.id);
        const itemId = asString(row.matched_item_id);
        const unit = asString(row.unit);
        const unitPrice = asNumber(row.unit_price);
        if (
          !sourceItemId || !itemId || !unit || unitPrice === null ||
          unitPrice < 0
        ) return null;
        return {
          supplier_id: sourceSupplierId,
          item_id: itemId,
          unit: normalizeInvoiceUnit(unit) || "each",
          unit_price: unitPrice,
          observed_at: new Date().toISOString(),
          source_invoice_scan_id: scanId,
          source_invoice_scan_item_id: sourceItemId,
        };
      },
    ).filter((row): row is SupplierPriceHistoryInsert => row !== null);

    if (historyRows.length > 0) {
      const { error: historyError } = await supabaseAdmin
        .from("supplier_price_history")
        .upsert(historyRows, {
          onConflict: "source_invoice_scan_item_id",
          ignoreDuplicates: true,
        });
      if (historyError) throw historyError;
    }

    const { error: confirmError } = await supabaseAdmin
      .from("invoice_scans")
      .update({
        confirmed_at: new Date().toISOString(),
        confirmed_by: actor.id,
      })
      .eq("id", scanId)
      .is("confirmed_at", null);
    if (confirmError) throw confirmError;

    return jsonResponse(req, {
      success: true,
      scanId,
      status: "parsed",
      priceHistoryRowsWritten: historyRows.length,
      idempotent: false,
    });
  } catch (error) {
    console.error(
      "[confirm-invoice-scan] failed",
      error instanceof Error ? error.message : error,
    );
    return errorResponse(
      req,
      500,
      "CONFIRM_FAILED",
      "Invoice confirmation failed. Please try again.",
      true,
    );
  }
});

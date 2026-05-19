import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeadersForRequest } from '../_shared/cors.ts';

type Role = 'employee' | 'manager';
type ValidateAccessCodeRpcResult =
  | { ok: true; role: Role }
  | { ok: false; code?: string };

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ACCESS_CODE_REGEX = /^\d{4}$/;
const FAILURE_DELAY_MS = 350;

function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersForRequest(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed' }, 405);
  }

  const clientIp = getClientIp(req);
  let accessCode = '';
  let subject = '';

  try {
    const payload = await req.json();
    accessCode =
      typeof payload?.accessCode === 'string'
        ? payload.accessCode.trim()
        : '';
    subject =
      typeof payload?.email === 'string'
        ? payload.email.trim().toLowerCase()
        : typeof payload?.subject === 'string'
          ? payload.subject.trim().toLowerCase()
          : '';
  } catch {
    return jsonResponse(req, { error: 'Invalid request body' }, 400);
  }

  const identifierHash = await sha256Hex(`${clientIp}:${req.headers.get('user-agent') ?? ''}`);
  const subjectHash = subject ? await sha256Hex(subject) : null;

  if (!ACCESS_CODE_REGEX.test(accessCode)) {
    await delay(FAILURE_DELAY_MS);
    return jsonResponse(req, { error: 'Invalid access code' }, 400);
  }

  const { data, error } = await supabaseAdmin.rpc('validate_access_code_attempt', {
    p_access_code: accessCode,
    p_identifier_hash: identifierHash,
    p_subject_hash: subjectHash,
  });

  if (error) {
    console.error('validate_access_code_attempt failed', error);
    await delay(FAILURE_DELAY_MS);
    return jsonResponse(req, { error: 'Unable to validate access code' }, 500);
  }

  const result = data as ValidateAccessCodeRpcResult | null;
  if (!result?.ok || (result.role !== 'employee' && result.role !== 'manager')) {
    await delay(FAILURE_DELAY_MS);
    return jsonResponse(req, { error: 'Invalid access code' }, 400);
  }

  return jsonResponse(req, { role: result.role });
});

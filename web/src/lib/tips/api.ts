// Typed client for the tip entry edge functions. All entry-device traffic
// goes through these three functions (tip-entry-auth, tip-entries,
// tip-voice-parse) — entry devices never query the database directly.

import { getFunctionsBaseUrl, getSupabaseAnonKey } from "@/lib/supabase";
import type { MealPeriod, VoiceVariant } from "@/types/database";
import type { AnomalyResult } from "./anomaly";
import { parseVoiceResponse, type TipVoiceParseResponse } from "./voiceSchema";

export class TipApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface RosterPerson {
  id: string;
  name: string;
}

export interface TodayStatus {
  businessDate: string;
  lunchRecorded: boolean;
  dinnerRecorded: boolean;
  defaultMeal: MealPeriod;
}

export interface SessionState {
  location: { id: string; name: string };
  roster: RosterPerson[];
  today: TodayStatus;
  closer: RosterPerson | null;
}

export interface SlotEntry {
  id: string;
  businessDate: string;
  meal: MealPeriod;
  cash: number;
  card: number;
  splitCount: number;
  entryMethod: "typed" | "voice";
  voiceVariant: VoiceVariant | null;
  correctionsCount: number;
  enteredBy: string | null;
  flaggedAnomaly: boolean;
  updatedAt: string;
  peopleIds: string[];
}

export interface SaveResult {
  saved: boolean;
  entry: SlotEntry | null;
  /** Present when the save needs an explicit "Save anyway?" confirmation. */
  anomaly: AnomalyResult | null;
}

async function callFunction(
  name: "tip-entry-auth" | "tip-entries",
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const anonKey = getSupabaseAnonKey();
  let response: Response;
  try {
    response = await fetch(`${getFunctionsBaseUrl()}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TipApiError(
      "No connection. Your entry is still on this screen — try again.",
      "network",
      0,
    );
  }
  let json: Record<string, unknown>;
  try {
    json = await response.json();
  } catch {
    throw new TipApiError("Something went wrong. Try again.", "bad_response", response.status);
  }
  if (!response.ok && json?.needsConfirm !== true) {
    throw new TipApiError(
      typeof json?.error === "string" ? json.error : "Something went wrong. Try again.",
      typeof json?.code === "string" ? json.code : "error",
      response.status,
    );
  }
  return json;
}

export interface FreshSignIn extends SessionState {
  sessionToken: string;
}

export async function validateToken(token: string): Promise<FreshSignIn> {
  const json = await callFunction("tip-entry-auth", { action: "validate_token", token });
  return json as unknown as FreshSignIn;
}

/**
 * Best-effort session revoke once the save confirmation has run its course.
 * Never throws — the local session is cleared regardless, and the server
 * expiry backstops a lost request.
 */
export async function endSession(sessionToken: string): Promise<void> {
  try {
    await callFunction("tip-entry-auth", { action: "end_session", sessionToken });
  } catch {
    // Ignore: the 12h server-side expiry cleans up after us.
  }
}

export async function fetchState(sessionToken: string): Promise<SessionState> {
  const json = await callFunction("tip-entry-auth", { action: "state", sessionToken });
  return json as unknown as SessionState;
}

export async function setCloser(sessionToken: string, closerId: string): Promise<void> {
  await callFunction("tip-entry-auth", { action: "set_closer", sessionToken, closerId });
}

export async function getSlot(
  sessionToken: string,
  meal: MealPeriod,
): Promise<{ businessDate: string; entry: SlotEntry | null }> {
  const json = await callFunction("tip-entries", { action: "get_slot", sessionToken, meal });
  return {
    businessDate: json.businessDate as string,
    entry: (json.entry as SlotEntry | null) ?? null,
  };
}

export interface SavePayload {
  meal: MealPeriod;
  cash: number;
  card: number;
  peopleIds: string[];
  entryMethod: "typed" | "voice";
  voiceVariant: VoiceVariant | null;
  correctionsCount: number;
  confirmAnomaly: boolean;
}

export async function saveEntry(
  sessionToken: string,
  payload: SavePayload,
): Promise<SaveResult> {
  const json = await callFunction("tip-entries", {
    action: "save",
    sessionToken,
    ...payload,
  });
  if (json.needsConfirm === true) {
    return { saved: false, entry: null, anomaly: (json.anomaly as AnomalyResult) ?? null };
  }
  return { saved: true, entry: (json.entry as SlotEntry | null) ?? null, anomaly: null };
}

export async function parseVoiceChunk(input: {
  sessionToken: string;
  audio: Blob;
  knownState: Record<string, unknown>;
  targetField?: "meal" | "cash" | "card" | "people" | null;
}): Promise<TipVoiceParseResponse> {
  // One transparent retry on transient failures (network drop, 5xx): a lost
  // chunk otherwise silently loses that stretch of speech.
  try {
    return await parseVoiceChunkOnce(input);
  } catch (error) {
    const transient =
      error instanceof TipApiError &&
      (error.code === "network" || error.status >= 500);
    if (!transient) throw error;
    await new Promise((resolve) => setTimeout(resolve, 800));
    return parseVoiceChunkOnce(input);
  }
}

async function parseVoiceChunkOnce(input: {
  sessionToken: string;
  audio: Blob;
  knownState: Record<string, unknown>;
  targetField?: "meal" | "cash" | "card" | "people" | null;
}): Promise<TipVoiceParseResponse> {
  const anonKey = getSupabaseAnonKey();
  const form = new FormData();
  form.set("session_token", input.sessionToken);
  form.set("known_state", JSON.stringify(input.knownState));
  if (input.targetField) form.set("target_field", input.targetField);
  const extension = input.audio.type.includes("mp4") ? "m4a" : "webm";
  form.set("audio", input.audio, `chunk.${extension}`);

  let response: Response;
  try {
    response = await fetch(`${getFunctionsBaseUrl()}/tip-voice-parse`, {
      method: "POST",
      headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
      body: form,
    });
  } catch {
    throw new TipApiError("Voice upload failed.", "network", 0);
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json) {
    throw new TipApiError(
      typeof json?.error === "string" ? json.error : "Voice processing failed.",
      typeof json?.code === "string" ? json.code : "parse_failed",
      response.status,
    );
  }
  const parsed = parseVoiceResponse(json);
  if (!parsed) {
    throw new TipApiError("Voice processing returned an invalid result.", "bad_response", 200);
  }
  return parsed;
}

/**
 * wss:// URL for the live-transcript stream (Variant B). Exchanges the
 * session token for a single-use 60s ticket so the long-lived token never
 * appears in a WebSocket URL.
 */
export async function requestVoiceStreamUrl(sessionToken: string): Promise<string> {
  const json = await callFunction("tip-entry-auth", { action: "voice_ticket", sessionToken });
  const ticket = typeof json.ticket === "string" ? json.ticket : "";
  if (!ticket) throw new TipApiError("Live transcript unavailable.", "no_ticket", 500);
  const base = getFunctionsBaseUrl().replace(/^http/, "ws");
  return `${base}/tip-voice-stream?ticket=${encodeURIComponent(ticket)}`;
}

export function isSessionInvalid(error: unknown): boolean {
  return error instanceof TipApiError && error.code === "session_invalid";
}

/** Another device already saved this meal slot today (server duplicate guard). */
export function isAlreadyRecorded(error: unknown): boolean {
  return error instanceof TipApiError && error.code === "already_recorded";
}

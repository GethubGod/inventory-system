// Voice-parse accuracy harness: synthesizes speech with macOS `say`,
// converts to AAC with `afconvert`, and POSTs it through the live
// tip-voice-parse edge function exactly as the voice sheet would —
// asserting the parsed fields. Run it after prompt changes to
// supabase/functions/tip-voice-parse/index.ts.
//
//   node e2e/voice-parse-harness.mjs            (from web/)
//
// Needs web/.env.local (Supabase URL + anon key) and web/.env.e2e
// (E2E_SUSHI_TOKEN). macOS only (say/afconvert). Each case counts against
// the session's 40-parses-per-5-min quota; the run mints one session and
// leaves quota ledger rows that e2e/cleanup.sql removes.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

for (const file of [".env.e2e", ".env.local"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ENTRY_TOKEN = process.env.E2E_SUSHI_TOKEN;
if (!SUPABASE_URL || !ANON_KEY || !ENTRY_TOKEN) {
  console.error("Missing env: need web/.env.local and web/.env.e2e (see e2e/README.md)");
  process.exit(2);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-voice-"));

function synthesize(text, index) {
  const aiff = path.join(workDir, `case-${index}.aiff`);
  const m4a = path.join(workDir, `case-${index}.m4a`);
  // Trailing silence: `say` clips the final word hard enough that STT can
  // lose it ("ninety five" → "ninety") — an artifact real microphones don't
  // have. The [[slnc]] marker pads the tail without changing the speech.
  execFileSync("say", ["-o", aiff, `${text} [[slnc 500]]`]);
  execFileSync("afconvert", [aiff, "-f", "m4af", "-d", "aac", m4a]);
  return fs.readFileSync(m4a);
}

async function callAuth(body) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/tip-entry-auth`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`auth failed: ${JSON.stringify(json)}`);
  return json;
}

async function parseChunk(sessionToken, audioBytes, { knownState, targetField } = {}) {
  const form = new FormData();
  form.set("session_token", sessionToken);
  form.set("known_state", JSON.stringify(knownState ?? {}));
  if (targetField) form.set("target_field", targetField);
  form.set("audio", new Blob([audioBytes], { type: "audio/mp4" }), "chunk.m4a");
  const response = await fetch(`${SUPABASE_URL}/functions/v1/tip-voice-parse`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ANON_KEY}` },
    body: form,
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`parse failed: ${response.status} ${JSON.stringify(json)}`);
  return json;
}

// ---- Cases. `expect` maps field → predicate over the response.

const matchedNames = (result) =>
  result.fields.people.matched.map((person) => person.name).sort();

const CASES = [
  {
    name: "full utterance (meal + cash + card + two people)",
    text: "Dinner. Cash one twenty, card three forty. Split between Maria and Jose.",
    expect: (r) =>
      r.fields.meal.value === "dinner" &&
      r.fields.cash.value === 120 &&
      r.fields.card.value === 340 &&
      JSON.stringify(matchedNames(r)) === JSON.stringify(["Jose", "Maria"]),
  },
  {
    name: "in-utterance correction (card 200 → no wait, 350)",
    text: "Cash eighty. Card two hundred. No wait, card was three fifty.",
    expect: (r) => r.fields.cash.value === 80 && r.fields.card.value === 350,
  },
  {
    name: "cash-only chunk against known state (server returns only what was spoken)",
    text: "Cash was ninety five.",
    knownState: { meal: "dinner", card: 340, people: ["Maria", "Jose"] },
    expect: (r) => r.fields.cash.value === 95 && r.fields.card.value === null,
  },
  {
    name: "target_field=card re-record (bare amount)",
    text: "Three fifty.",
    targetField: "card",
    expect: (r) => r.fields.card.value === 350,
  },
  {
    name: "zero cash is a value, not a miss",
    text: "No cash tips tonight. Card two hundred ten. Just Ken.",
    expect: (r) =>
      r.fields.cash.value === 0 &&
      r.fields.card.value === 210 &&
      JSON.stringify(matchedNames(r)) === JSON.stringify(["Ken"]),
  },
];

const auth = await callAuth({ action: "validate_token", token: ENTRY_TOKEN });
const sessionToken = auth.sessionToken;
console.log(`session minted for ${auth.location.name}; roster: ${auth.roster.map((p) => p.name).join(", ")}\n`);

let failures = 0;
for (const [index, testCase] of CASES.entries()) {
  const audio = synthesize(testCase.text, index);
  let result;
  try {
    result = await parseChunk(sessionToken, audio, testCase);
  } catch (error) {
    failures += 1;
    console.log(`✗ ${testCase.name}\n    ${error.message}`);
    continue;
  }
  const pass = testCase.expect(result);
  if (!pass) failures += 1;
  console.log(`${pass ? "✓" : "✗"} ${testCase.name}  (${result.latencyMs}ms)`);
  console.log(`    heard: "${result.rawTranscript.trim()}"`);
  console.log(
    `    meal=${result.fields.meal.value} cash=${result.fields.cash.value} card=${result.fields.card.value} people=[${matchedNames(result).join(", ")}] unmatched=[${result.fields.people.unmatched.join(", ")}]`,
  );
}

fs.rmSync(workDir, { recursive: true, force: true });
console.log(failures === 0 ? "\nall voice cases passed" : `\n${failures} case(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);

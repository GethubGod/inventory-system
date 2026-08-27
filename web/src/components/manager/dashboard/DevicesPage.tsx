"use client";

// Devices & entry log — device cards FIRST (per-location QR code status,
// Rotate with plaintext-shown-once, scan-session summary, Sign out all),
// then the entry log: one row per entry with a timing badge against close
// time, missing scheduled shifts in red on top, and on-time KPIs.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { getSupabase } from "@/lib/supabase";
import { TIPS_TIMEZONE } from "@/lib/tips/businessDate";
import {
  classifyEntryTiming,
  formatLoggedAt,
  timingText,
  type EntryTiming,
} from "@/lib/tips/entryTiming";
import { shortDayLabel } from "@/lib/tips/dashboardRange";
import {
  btn,
  btnDanger,
  btnPrim,
  ConfirmDialog,
  ModalShell,
  InfoButton,
  LocationChip,
  panelWrap,
  sectionH3,
  td,
  th,
  useToast,
} from "./ui";
import type { LocationInfo, PageContext } from "./types";

/** "Sun 10:24 PM" — LA weekday + time for scan rows. */
function scanLabel(iso: string): string {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: TIPS_TIMEZONE,
    weekday: "short",
  }).format(date);
  return `${weekday} ${formatLoggedAt(date)}`;
}

function rotatedLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIPS_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

/** Build the phone-facing entry URL a QR code encodes. Browser only. */
function entryUrlFor(token: string): string {
  return `${window.location.origin}/e?t=${encodeURIComponent(token)}`;
}

/** Renders the location's live entry QR as a data URL; null while pending. */
function useQrDataUrl(token: string | null): string | null {
  // Keyed by token so a stale image never shows for a rotated code.
  const [generated, setGenerated] = useState<{ token: string; url: string } | null>(null);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    QRCode.toDataURL(entryUrlFor(token), { width: 480, margin: 2 })
      .then((url) => {
        if (!cancelled) setGenerated({ token, url });
      })
      .catch(() => {
        // leave the previous (or empty) state; the card falls back to the glyph
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  return token !== null && generated?.token === token ? generated.url : null;
}

/**
 * The full printable QR sheet, previewed in the View dialog. Printing
 * hides everything except `.qr-print-sheet` (see globals.css), so the same
 * DOM prints as a clean instruction sheet.
 */
function StickerSheetDialog({
  location,
  qrDataUrl,
  onClose,
}: {
  location: LocationInfo;
  qrDataUrl: string;
  onClose: () => void;
}) {
  return (
    <ModalShell title={`${location.label} — entry QR`} onClose={onClose} wide>
      <div className="mt-3 max-h-[62vh] overflow-y-auto rounded-well bg-well p-3">
        <div className="qr-print-sheet mx-auto flex max-w-[430px] flex-col items-center gap-1 rounded-[6px] border border-line bg-white px-8 py-9 text-center text-[#111]">
          <div className="text-[11px] font-bold tracking-[0.18em]">
            <span className="text-[#e84d38]">smelter</span>
            <span className="text-[#888]"> · tip entry</span>
          </div>
          <h2 className="text-[26px] font-extrabold leading-tight">{location.name}</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt={`Tip entry QR code for ${location.name}`}
            className="qr-print-code my-3 h-[230px] w-[230px]"
          />
          <ol className="w-full list-none space-y-2 text-left text-[13.5px] leading-snug">
            {[
              "Open the phone camera and point it at the code.",
              "Tap the link that pops up.",
              "Pick who closed, then enter tonight's cash and card tips.",
              "Save — the phone signs itself out after each entry.",
            ].map((step, index) => (
              <li key={step} className="flex gap-2.5">
                <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-[#111] text-[12px] font-bold text-white">
                  {index + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btn} onClick={onClose}>
          Close
        </button>
        <button type="button" className={btnPrim} onClick={() => window.print()}>
          Print QR code
        </button>
      </div>
    </ModalShell>
  );
}

/** Decorative QR placeholder shown before a location's first rotation. */
function QrGlyph() {
  return (
    <svg viewBox="0 0 21 21" width="100%" height="100%" aria-hidden>
      <rect width="21" height="21" fill="#fff" />
      <path
        fill="#111"
        d="M0 0h7v7H0zM2 2h3v3H2zM14 0h7v7h-7zM16 2h3v3h-3zM0 14h7v7H0zM2 16h3v3H2zM9 0h2v3H9zM9 4h3v2H9zM13 9h2v2h-2zM9 9h2v3H9zM16 9h5v2h-5zM9 14h2v2H9zM12 12h3v3h-3zM16 13h2v4h-2zM19 14h2v3h-2zM9 18h4v3H9zM14 18h3v2h-3zM18 19h3v2h-3z"
      />
    </svg>
  );
}

function timingClass(timing: EntryTiming): string {
  if (timing.kind === "ok") return "text-okgreen";
  if (timing.kind === "late") return "text-warnamber";
  return "text-alert";
}

function timingDot(timing: EntryTiming): string {
  if (timing.kind === "ok") return "bg-okgreen";
  if (timing.kind === "late") return "bg-warnamber";
  return "bg-alert";
}

function DeviceCard({ ctx, location }: { ctx: PageContext; location: LocationInfo }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState<"rotate" | "signout" | null>(null);
  const [working, setWorking] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  const access = ctx.data.access.find((row) => row.locationId === location.id);
  const rotatedAt = access?.tokenRotatedAt ?? null;
  // A just-rotated token wins over the fetched one until the refetch lands.
  const token = freshToken ?? access?.entryToken ?? null;
  const qrDataUrl = useQrDataUrl(token);

  const sessions = ctx.data.sessions.filter((session) => session.locationId === location.id);
  const closerName = (closerId: string | null) =>
    closerId
      ? (ctx.data.employees.find((employee) => employee.id === closerId)?.name ?? "Unknown")
      : "No closer";
  const lastScan = sessions[0]?.createdAt ?? null; // sessions arrive newest-first

  async function rotate() {
    setWorking(true);
    const { data, error } = await getSupabase().rpc("tip_rotate_entry_token", {
      p_location_id: location.id,
    });
    setWorking(false);
    setConfirming(null);
    if (error || typeof data !== "string") {
      toast(`Could not rotate: ${error?.message ?? "unexpected response"}`);
      return;
    }
    setFreshToken(data);
    toast("Token rotated — the old QR code is dead. Open View to print the new one.");
    ctx.refetch();
  }

  async function signOutAll() {
    setWorking(true);
    const { data, error } = await getSupabase().rpc("tip_revoke_location_sessions", {
      p_location_id: location.id,
    });
    setWorking(false);
    setConfirming(null);
    if (error || typeof data !== "number") {
      toast(`Could not sign out: ${error?.message ?? "unexpected response"}`);
      return;
    }
    toast(`${data} ${data === 1 ? "phone" : "phones"} signed out at ${location.label}`);
    ctx.refetch();
  }

  return (
    <div className={panelWrap}>
      <div className="flex items-center gap-[9px] border-b border-line px-[18px] py-3">
        <span
          className={`h-2 w-2 rounded-full ${rotatedAt ? "bg-okgreen" : "bg-warnamber"}`}
          aria-hidden
        />
        <h4 className="text-[14.5px] font-extrabold text-ink">{location.label}</h4>
        <span className="ml-auto text-xs font-semibold text-ink2">
          {rotatedAt ? "QR code active" : "Never rotated"}
        </span>
      </div>
      <div className="flex flex-col gap-3.5 px-[18px] py-3.5">
        <div className="flex items-center gap-3.5">
          {qrDataUrl ? (
            <button
              type="button"
              onClick={() => setViewing(true)}
              title="View and print the QR code"
              aria-label={`View the ${location.label} entry QR`}
              className="h-16 w-16 flex-none overflow-hidden rounded-[10px] border border-line bg-white p-1 hover:border-accent"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="" className="h-full w-full" />
            </button>
          ) : (
            <span className="h-16 w-16 flex-none rounded-[10px] border border-line bg-white p-[7px] opacity-40">
              <QrGlyph />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <b className="block text-[13.5px] text-ink">QR code</b>
            <span className="mt-px block text-[12.5px] text-ink2">
              {rotatedAt ? (
                <>Rotated {rotatedLabel(rotatedAt)}</>
              ) : (
                <span className="font-semibold text-warnamber">
                  never rotated — mint one so closers can scan in
                </span>
              )}
            </span>
          </span>
          <span className="flex flex-none gap-2">
            {qrDataUrl && (
              <button type="button" className={btn} onClick={() => setViewing(true)}>
                View
              </button>
            )}
            <button type="button" className={btn} onClick={() => setConfirming("rotate")}>
              Rotate…
            </button>
          </span>
        </div>

        <div className="flex items-center gap-3 rounded-well bg-well px-3.5 py-[11px]">
          <span className="flex-1 text-[12.5px] text-ink2">
            <b className="block text-[13.5px] text-ink">
              {sessions.length} {sessions.length === 1 ? "phone" : "phones"} scanned in{" "}
              {ctx.rangeNoun}
            </b>
            {lastScan ? `Last scan ${scanLabel(lastScan)} · ` : ""}sessions end after each save
          </span>
          <button type="button" className={btnDanger} onClick={() => setConfirming("signout")}>
            Sign out all
          </button>
        </div>

        {sessions.length > 0 && (
          <div className="flex flex-wrap gap-3.5 text-xs text-ink3">
            {sessions.slice(0, 3).map((session) => (
              <span key={session.id}>
                <b className="font-semibold text-ink2">{closerName(session.closerId)}</b> ·{" "}
                {scanLabel(session.createdAt)}
              </span>
            ))}
          </div>
        )}
      </div>

      {viewing && token && qrDataUrl && (
        <StickerSheetDialog
          location={location}
          qrDataUrl={qrDataUrl}
          onClose={() => setViewing(false)}
        />
      )}
      {confirming === "rotate" && (
        <ConfirmDialog
          title={`Rotate the ${location.label} QR code?`}
          body="This kills the current QR code immediately — phones can no longer scan it. Print the new one right away."
          confirmLabel="Rotate"
          busyLabel="Rotating…"
          busy={working}
          onConfirm={() => void rotate()}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === "signout" && (
        <ConfirmDialog
          title={`Sign out every ${location.label} phone?`}
          body="Every phone signed into this location will need to scan the QR code again. Use this for a lost phone."
          confirmLabel="Sign out all"
          busyLabel="Signing out…"
          busy={working}
          onConfirm={() => void signOutAll()}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

export function DevicesPage({ ctx }: { ctx: PageContext }) {
  const entries = ctx.entries;
  const timings = entries.map((entry) =>
    classifyEntryTiming(new Date(entry.createdAt), entry.businessDate, entry.meal),
  );
  const okCount = timings.filter((timing) => timing.kind === "ok").length;
  const total = entries.length + ctx.missing.length;
  const sameNightMinutes = timings
    .filter((timing) => timing.kind !== "nextDay")
    .map((timing) => Math.max(0, timing.minutes))
    .sort((a, b) => a - b);
  const medianMinutes =
    sameNightMinutes.length > 0
      ? sameNightMinutes[Math.floor(sameNightMinutes.length / 2)]
      : 0;

  return (
    <>
      <section className="mb-[30px]">
        <div className="mb-2.5 flex items-center gap-2">
          <h3 className={sectionH3}>Device access</h3>
          <InfoButton label="About device access">
            Each restaurant signs in by scanning its <b>QR code</b> — one scan per entry, the
            phone signs out after saving. Rotating replaces the code immediately; only a hash is
            stored, so print right after rotating. Sign out all is for a lost phone.
          </InfoButton>
        </div>
        <div className="grid gap-[18px] min-[940px]:grid-cols-2">
          {ctx.visibleLocations.map((location) => (
            <DeviceCard key={location.id} ctx={ctx} location={location} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-2.5 flex items-center gap-2">
          <h3 className={sectionH3}>Entry log</h3>
          <span className="text-[12.5px] font-semibold text-ink3">
            when each shift actually got recorded
          </span>
          <InfoButton label="About the entry log">
            <b>Logged at</b> is the moment the closer saved the entry on the phone. Timing compares
            it to close — lunch closes 3 PM, dinner 10 PM. Green ≤ 45 min, amber later that night,
            red = next day or never logged.
          </InfoButton>
        </div>
        <div className={panelWrap}>
          <div className="flex flex-wrap gap-2.5 border-b border-line px-3.5 py-3">
            <span className="rounded-well bg-well px-3.5 py-2 text-[12.5px] text-ink2">
              Logged on time (≤ 45 min)
              <b className="mt-px block text-base font-extrabold text-ink">
                {total > 0 ? Math.round((okCount / total) * 100) : 0}%
              </b>
            </span>
            <span className="rounded-well bg-well px-3.5 py-2 text-[12.5px] text-ink2">
              Median time after close
              <b className="mt-px block text-base font-extrabold text-ink">{medianMinutes} min</b>
            </span>
            <span className="rounded-well bg-well px-3.5 py-2 text-[12.5px] text-ink2">
              Missing in this range
              <b
                className={`mt-px block text-base font-extrabold ${
                  ctx.missing.length > 0 ? "text-alert" : "text-ink"
                }`}
              >
                {ctx.missing.length}
              </b>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Business date</th>
                  <th className={th}>Restaurant</th>
                  <th className={th}>Meal</th>
                  <th className={th}>Entered by</th>
                  <th className={th}>Method</th>
                  <th className={th}>Logged at</th>
                  <th className={th}>Timing</th>
                </tr>
              </thead>
              <tbody>
                {ctx.missing.map((shift) => (
                  <tr
                    key={`missing-${shift.businessDate}-${shift.locationId}-${shift.meal}`}
                    className="bg-flagtint font-semibold text-alert"
                  >
                    <td className={`${td} bg-transparent`}>{shortDayLabel(shift.businessDate)}</td>
                    <td className={`${td} bg-transparent`}>
                      {ctx.locationById.get(shift.locationId)?.label ?? "?"}
                    </td>
                    <td className={`${td} bg-transparent`}>
                      {shift.meal.charAt(0).toUpperCase() + shift.meal.slice(1)}
                    </td>
                    <td colSpan={3} className={`${td} bg-transparent`}>
                      —
                    </td>
                    <td className={`${td} bg-transparent`}>not logged</td>
                  </tr>
                ))}
                {entries.map((entry, index) => {
                  const location = ctx.locationById.get(entry.locationId);
                  const timing = timings[index];
                  const loggedAt = new Date(entry.createdAt);
                  return (
                    <tr key={entry.id}>
                      <td className={td}>{shortDayLabel(entry.businessDate)}</td>
                      <td className={td}>{location ? <LocationChip location={location} /> : "?"}</td>
                      <td className={td}>
                        {entry.meal.charAt(0).toUpperCase() + entry.meal.slice(1)}
                      </td>
                      <td className={td}>{entry.enteredByName ?? "—"}</td>
                      <td className={`${td} text-[12.5px] text-ink2`}>
                        {entry.entryMethod === "voice" ? "dictated" : "typed"}
                      </td>
                      <td className={`${td} font-semibold tabular-nums`}>
                        {formatLoggedAt(loggedAt)}
                      </td>
                      <td className={`${td} font-semibold ${timingClass(timing)}`}>
                        <span
                          className={`mr-1.5 inline-block h-[7px] w-[7px] rounded-full align-[1px] ${timingDot(timing)}`}
                          aria-hidden
                        />
                        {timingText(timing, loggedAt)}
                      </td>
                    </tr>
                  );
                })}
                {entries.length === 0 && ctx.missing.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-[26px] text-center text-ink3">
                      No records in this range for this filter
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

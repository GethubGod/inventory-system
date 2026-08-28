/** Canonical phone-facing host. Manager and preview origins must never leak into printed QRs. */
export const TIPS_ENTRY_ORIGIN = "https://tips.smelterpos.com";

/** Build the location-token URL encoded into QR codes and NFC tags. */
export function entryUrlFor(token: string): string {
  const url = new URL("/e", TIPS_ENTRY_ORIGIN);
  url.searchParams.set("t", token);
  return url.toString();
}

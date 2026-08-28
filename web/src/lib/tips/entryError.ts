import { TipApiError } from "./api";

/** Keep connectivity/server failures from being misreported as revoked QR codes. */
export function entrySignInErrorMessage(error: unknown): string {
  if (!(error instanceof TipApiError)) {
    return "Couldn’t verify this QR code. Try again.";
  }
  if (error.code === "rate_limited") return error.message;
  if (error.code === "invalid") {
    return "This QR code is no longer active. Ask a manager for the new one.";
  }
  if (error.code === "network") {
    return "Couldn’t reach smelter. Check your connection and try again.";
  }
  return "Couldn’t verify this QR code. Try again.";
}

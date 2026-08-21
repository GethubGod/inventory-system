// Login-name normalization — TypeScript mirror of the SQL
// public.normalize_login_name (supabase/migrations/20260820123000_login_credentials.sql).
// Both sides MUST stay in sync: lowercase, trim, collapse inner whitespace.

export function normalizeLoginName(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  const normalized = name.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

// Shared shapes for the Tip Dashboard (manager surface).

import type { LedgerEntry } from "@/lib/tips/dashboardDerive";
import type { MealPeriod } from "@/types/database";

/**
 * Which restaurant a location row is, resolved from its name at runtime —
 * ids are never hardcoded. Drives the black (Sushi) / blue (Poki & Pho)
 * color coding.
 */
export type LocationKind = "sushi" | "poki";

export interface LocationInfo {
  id: string;
  /** DB display name, e.g. "Babytuna Sushi" (used by the printable QR page). */
  name: string;
  kind: LocationKind | null;
  /** Dashboard label: "Sushi" / "Poki & Pho". */
  label: string;
  /** Schedule-line chip label: "Sushi" / "Poki". */
  shortLabel: string;
}

export interface EmployeeRow {
  id: string;
  name: string;
  /** null = works at both locations. */
  locationId: string | null;
  active: boolean;
  sortOrder: number;
}

export interface ScheduleRowDb {
  id: string;
  tipEmployeeId: string;
  locationId: string;
  weekday: number; // 0 = Sunday … 6 = Saturday
  meal: MealPeriod;
  createdAt: string;
}

export interface DeviceSessionRow {
  id: string;
  locationId: string;
  closerId: string | null;
  createdAt: string;
}

export interface AccessRow {
  locationId: string;
  tokenRotatedAt: string | null;
  /** Manager-viewable entry token backing the printable QR (null pre-rotation). */
  entryToken: string | null;
}

export interface DashboardData {
  locations: LocationInfo[];
  employees: EmployeeRow[];
  schedules: ScheduleRowDb[];
  /** Entries for the selected range, both locations, newest first. */
  entries: LedgerEntry[];
  /** Device sessions whose scan falls in the selected range. */
  sessions: DeviceSessionRow[];
  access: AccessRow[];
  /** Each location's first-ever entry business date (missing-shift floor). */
  firstEntryDates: Record<string, string | undefined>;
}

export type LocFilter = "both" | LocationKind;

export type NavId = "overview" | "ledger" | "staff" | "logdev";

/** Everything a dashboard page needs, already filtered by range × location. */
export interface PageContext {
  data: DashboardData;
  /** Entries after the location filter, newest first. */
  entries: LedgerEntry[];
  /** Locations after the location filter (both → all). */
  visibleLocations: LocationInfo[];
  locationById: Map<string, LocationInfo>;
  /** Scheduled-but-unrecorded shifts in range (location-filtered). */
  missing: Array<{ businessDate: string; locationId: string; meal: MealPeriod }>;
  rangeLabel: string;
  /** "this week" / "last week" / "this month" / "this year" / "this range". */
  rangeNoun: string;
  today: string;
  /** auth.users id of the signed-in manager (Verify writes it). */
  userId: string;
  navigate: (nav: NavId) => void;
  refetch: () => void;
}

export function locationKindFor(name: string): LocationKind | null {
  const lower = name.toLowerCase();
  if (lower.includes("sushi")) return "sushi";
  if (lower.includes("poki") || lower.includes("poke") || lower.includes("pho")) return "poki";
  return null;
}

export function toLocationInfo(row: { id: string; name: string }): LocationInfo {
  const kind = locationKindFor(row.name);
  return {
    id: row.id,
    name: row.name,
    kind,
    label: kind === "sushi" ? "Sushi" : kind === "poki" ? "Poki & Pho" : row.name,
    shortLabel: kind === "sushi" ? "Sushi" : kind === "poki" ? "Poki" : row.name,
  };
}

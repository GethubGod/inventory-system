"use client";

// Admin tab: roster management plus per-location entry-token rotation.
// Rotation secrets are shown exactly once (they are stored hashed).
// PIN entry was removed from the product — sessions are QR-scan only.

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { formatBusinessDate } from "@/lib/tips/businessDate";

interface LocationRow {
  id: string;
  name: string;
}

interface EmployeeRow {
  id: string;
  name: string;
  location_id: string | null;
  active: boolean;
  sort_order: number;
}

interface AccessRow {
  location_id: string;
  token_rotated_at: string | null;
}

interface AdminData {
  locations?: LocationRow[];
  employees?: EmployeeRow[];
  access?: AccessRow[];
  error?: string;
}

/** Inline-confirmed per-location actions: token rotation plus session revoke. */
type ActionKind = "token" | "revoke";

interface PendingConfirm {
  locationId: string;
  kind: ActionKind;
}

interface RotationResult {
  locationId: string;
  value: string;
}

async function fetchAdminData(): Promise<AdminData> {
  const supabase = getSupabase();
  try {
    const [locRes, empRes, accessRes] = await Promise.all([
      supabase.from("locations").select("id, name").order("name"),
      supabase
        .from("tip_employees")
        .select("id, name, location_id, active, sort_order")
        .order("active", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("tip_location_access")
        .select("location_id, token_rotated_at"),
    ]);
    if (locRes.error) throw new Error(locRes.error.message);
    if (empRes.error) throw new Error(empRes.error.message);
    if (accessRes.error) throw new Error(accessRes.error.message);
    return {
      locations: locRes.data ?? [],
      employees: empRes.data ?? [],
      access: accessRes.data ?? [],
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to load admin data.",
    };
  }
}

function formatRotatedAt(iso: string | null): string {
  if (!iso) return "never";
  const businessDate = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(businessDate)
    ? formatBusinessDate(businessDate)
    : "never";
}

export default function AdminTab() {
  const router = useRouter();

  const [reload, setReload] = useState(0);
  const [loadedKey, setLoadedKey] = useState(-1);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Add-employee form.
  const [newName, setNewName] = useState("");
  const [newScope, setNewScope] = useState<string>("both");
  const [adding, setAdding] = useState(false);

  // Rotation flow.
  const [confirming, setConfirming] = useState<PendingConfirm | null>(null);
  const [rotating, setRotating] = useState(false);
  const [result, setResult] = useState<RotationResult | null>(null);
  const [revoked, setRevoked] = useState<{
    locationId: string;
    count: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAdminData().then((data) => {
      if (cancelled) return;
      if (data.error) {
        setError(data.error);
      } else {
        setError(null);
        setLocations(data.locations ?? []);
        setEmployees(data.employees ?? []);
        setAccess(data.access ?? []);
      }
      setLoadedKey(reload);
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const loading = loadedKey !== reload;

  async function refreshAccess() {
    const { data } = await getSupabase()
      .from("tip_location_access")
      .select("location_id, token_rotated_at");
    if (data) setAccess(data);
  }

  async function updateEmployee(
    id: string,
    patch: { location_id?: string | null; active?: boolean },
  ) {
    setActionError(null);
    const previous = employees;
    setEmployees((current) =>
      current.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
    const { error: updateError } = await getSupabase()
      .from("tip_employees")
      .update(patch)
      .eq("id", id);
    if (updateError) {
      setEmployees(previous);
      setActionError(updateError.message);
    }
  }

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    setActionError(null);
    const maxSort = employees.reduce((m, e) => Math.max(m, e.sort_order), 0);
    const { error: insertError } = await getSupabase()
      .from("tip_employees")
      .insert({
        name,
        location_id: newScope === "both" ? null : newScope,
        active: true,
        sort_order: maxSort + 1,
      });
    if (insertError) {
      setActionError(insertError.message);
    } else {
      setNewName("");
      setNewScope("both");
      const data = await fetchAdminData();
      if (data.employees) setEmployees(data.employees);
    }
    setAdding(false);
  }

  function startConfirm(locationId: string, kind: ActionKind) {
    setConfirming({ locationId, kind });
    setResult(null);
    setRevoked(null);
    setActionError(null);
  }

  async function runRotation(location: LocationRow) {
    if (rotating) return;
    setRotating(true);
    setActionError(null);
    const response = await getSupabase().rpc("tip_rotate_entry_token", {
      p_location_id: location.id,
    });
    if (response.error || typeof response.data !== "string") {
      setActionError(response.error?.message ?? "Rotation failed.");
    } else {
      setResult({ locationId: location.id, value: response.data });
      setConfirming(null);
      await refreshAccess();
    }
    setRotating(false);
  }

  async function runRevoke(location: LocationRow) {
    if (rotating) return;
    setRotating(true);
    setActionError(null);
    const response = await getSupabase().rpc("tip_revoke_location_sessions", {
      p_location_id: location.id,
    });
    if (response.error || typeof response.data !== "number") {
      setActionError(response.error?.message ?? "Sign-out failed.");
    } else {
      setRevoked({ locationId: location.id, count: response.data });
      setConfirming(null);
    }
    setRotating(false);
  }

  if (loading) {
    return <p className="text-ink3 text-sm">Loading…</p>;
  }
  if (error) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-alert text-sm">{error}</p>
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          className="bg-card rounded-full px-4 py-2 text-sm font-semibold text-ink2"
        >
          Retry
        </button>
      </div>
    );
  }

  const scopeSelect =
    "bg-well rounded-well px-3 py-2 text-sm text-ink outline-none";
  const whitePill =
    "bg-card border border-hairline rounded-full px-4 py-2 text-sm font-semibold text-ink2";
  const redPill =
    "bg-accent text-white rounded-full px-4 py-2 text-sm font-semibold";

  return (
    <div className="flex flex-col gap-4">
      {actionError ? <p className="text-alert text-sm">{actionError}</p> : null}

      <div className="bg-card rounded-card p-5">
        <p className="section-label mb-3">Roster</p>
        {employees.length === 0 ? (
          <p className="text-ink3 text-sm mb-3">No people yet.</p>
        ) : (
          <ul className="flex flex-col mb-4">
            {employees.map((emp) => (
              <li
                key={emp.id}
                className="flex flex-wrap items-center gap-2 py-2 border-b border-hairline last:border-0"
              >
                <span
                  className={`flex-1 min-w-32 font-semibold ${
                    emp.active ? "text-ink" : "text-ink3"
                  }`}
                >
                  {emp.name}
                </span>
                <select
                  value={emp.location_id ?? "both"}
                  onChange={(e) =>
                    void updateEmployee(emp.id, {
                      location_id:
                        e.target.value === "both" ? null : e.target.value,
                    })
                  }
                  className={scopeSelect}
                  aria-label={`Scope for ${emp.name}`}
                >
                  <option value="both">Both</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    void updateEmployee(emp.id, { active: !emp.active })
                  }
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    emp.active ? "bg-tint text-alert" : "bg-well text-ink3"
                  }`}
                >
                  {emp.active ? "Active" : "Inactive"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addEmployee} className="flex flex-wrap gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            className="bg-well rounded-well px-3 py-2 text-sm text-ink outline-none flex-1 min-w-40"
          />
          <select
            value={newScope}
            onChange={(e) => setNewScope(e.target.value)}
            className={scopeSelect}
            aria-label="Scope for new person"
          >
            <option value="both">Both</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={adding || newName.trim().length === 0}
            className={`rounded-full px-4 py-2 text-sm font-semibold text-white ${
              adding || newName.trim().length === 0
                ? "bg-disabled"
                : "bg-accent"
            }`}
          >
            Add
          </button>
        </form>
      </div>

      {locations.map((loc) => {
        const accessRow = access.find((a) => a.location_id === loc.id);
        const confirmingHere =
          confirming && confirming.locationId === loc.id ? confirming : null;
        const resultHere =
          result && result.locationId === loc.id ? result : null;
        const revokedHere =
          revoked && revoked.locationId === loc.id ? revoked : null;
        return (
          <div key={loc.id} className="bg-card rounded-card p-5">
            <p className="section-label mb-3">{loc.name} access</p>
            <p className="text-sm text-ink2 mb-4">
              Entry token last rotated{" "}
              <span className="text-ink font-semibold">
                {formatRotatedAt(accessRow?.token_rotated_at ?? null)}
              </span>
            </p>

            {confirmingHere ? (
              <div className="bg-well rounded-well p-3 mb-3">
                <p className="text-sm text-ink mb-2">
                  {confirmingHere.kind === "token"
                    ? "This kills the current QR/NFC sticker. Rotate?"
                    : `Every phone signed into ${loc.name} will need to scan the sticker again.`}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={rotating}
                    onClick={() =>
                      confirmingHere.kind === "revoke"
                        ? void runRevoke(loc)
                        : void runRotation(loc)
                    }
                    className={rotating ? `${redPill} bg-disabled` : redPill}
                  >
                    {confirmingHere.kind === "revoke"
                      ? rotating
                        ? "Signing out…"
                        : "Sign out"
                      : rotating
                        ? "Rotating…"
                        : "Rotate"}
                  </button>
                  <button
                    type="button"
                    disabled={rotating}
                    onClick={() => setConfirming(null)}
                    className={whitePill}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startConfirm(loc.id, "token")}
                  className={redPill}
                >
                  Rotate entry token
                </button>
                <button
                  type="button"
                  onClick={() => startConfirm(loc.id, "revoke")}
                  className={whitePill}
                >
                  Sign out all devices
                </button>
              </div>
            )}

            {revokedHere ? (
              <p className="text-sm text-ink2 mt-3">
                {revokedHere.count} device(s) signed out.
              </p>
            ) : null}

            {resultHere ? (
              <div className="bg-well rounded-well p-3 mt-3">
                <p className="section-label mb-1">New entry token</p>
                <p className="break-all font-mono text-sm text-ink">
                  {resultHere.value}
                </p>
                <p className="text-sm text-alert mt-2">
                  Shown once — print the new QR now.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    // Token travels in the fragment — fragments never reach
                    // servers or request logs.
                    router.push(
                      `/manager/qr?location=${loc.id}&name=${encodeURIComponent(
                        loc.name,
                      )}#t=${encodeURIComponent(resultHere.value)}`,
                    )
                  }
                  className={`${redPill} mt-3`}
                >
                  Open printable QR page
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

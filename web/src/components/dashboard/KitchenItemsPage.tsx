"use client";

// Kitchen items editor: what chefs can request, with the unit and which
// location sees it. Text fields save on blur, scope saves immediately, rows
// reorder with arrows, and items are deactivated rather than deleted.

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import {
  createKitchenItem,
  fetchKitchenItems,
  moveItem,
  nextSortOrder,
  updateKitchenItem,
  validateKitchenItemInput,
  type KitchenItemRecord,
} from "@/lib/dashboard/kitchenItems";

interface LocationOption {
  id: string;
  name: string;
}

type RowStatus = { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

const ALL_SCOPE = "__all__";

function scopeLabel(locationId: string | null, locations: LocationOption[]): string {
  if (!locationId) return "All locations";
  return locations.find((location) => location.id === locationId)?.name ?? "Unknown location";
}

function ItemRow({
  item,
  locations,
  status,
  canMoveUp,
  canMoveDown,
  onSave,
  onMove,
}: {
  item: KitchenItemRecord;
  locations: LocationOption[];
  status: RowStatus | undefined;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSave: (id: string, patch: Partial<KitchenItemRecord>) => void;
  onMove: (id: string, direction: "up" | "down") => void;
}) {
  const [name, setName] = useState(item.name);
  const [unit, setUnit] = useState(item.unit);
  const inputClasses = "bg-well rounded-well px-3 py-2 text-ink text-sm outline-none w-full";
  const muted = !item.active;

  return (
    <tr className={`border-b border-hairline last:border-b-0 align-top ${muted ? "opacity-60" : ""}`}>
      <td className="px-3 py-3 whitespace-nowrap">
        <span className="inline-flex gap-1">
          <button
            type="button"
            aria-label={`Move ${item.name} up`}
            disabled={!canMoveUp}
            onClick={() => onMove(item.id, "up")}
            className="w-7 h-7 rounded-full bg-well text-ink2 text-xs disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move ${item.name} down`}
            disabled={!canMoveDown}
            onClick={() => onMove(item.id, "down")}
            className="w-7 h-7 rounded-full bg-well text-ink2 text-xs disabled:opacity-30"
          >
            ↓
          </button>
        </span>
      </td>
      <td className="px-3 py-3 min-w-44">
        <input
          type="text"
          value={name}
          aria-label={`Name for ${item.name}`}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = name.trim();
            if (!next) {
              setName(item.name);
              return;
            }
            if (next !== item.name) onSave(item.id, { name: next });
          }}
          className={inputClasses}
        />
        {status?.kind === "saving" ? (
          <p className="text-ink3 text-xs mt-1">Saving…</p>
        ) : status?.kind === "saved" ? (
          <p className="text-ink3 text-xs mt-1">Saved</p>
        ) : status?.kind === "error" ? (
          <p className="text-alert text-xs mt-1">{status.message}</p>
        ) : null}
      </td>
      <td className="px-3 py-3 min-w-32">
        <input
          type="text"
          value={unit}
          aria-label={`Unit for ${item.name}`}
          onChange={(e) => setUnit(e.target.value)}
          onBlur={() => {
            const next = unit.trim();
            if (!next) {
              setUnit(item.unit);
              return;
            }
            if (next !== item.unit) onSave(item.id, { unit: next });
          }}
          className={inputClasses}
        />
      </td>
      <td className="px-3 py-3 min-w-40">
        <select
          value={item.location_id ?? ALL_SCOPE}
          aria-label={`Scope for ${item.name}`}
          onChange={(e) => {
            const next = e.target.value === ALL_SCOPE ? null : e.target.value;
            if (next !== item.location_id) onSave(item.id, { location_id: next });
          }}
          className={`${inputClasses} appearance-none`}
        >
          <option value={ALL_SCOPE}>All locations</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={() => onSave(item.id, { active: !item.active })}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
            item.active ? "bg-well text-ink2" : "bg-accent text-white"
          }`}
        >
          {item.active ? "Deactivate" : "Reactivate"}
        </button>
      </td>
    </tr>
  );
}

export default function KitchenItemsPage() {
  const [items, setItems] = useState<KitchenItemRecord[] | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusById, setStatusById] = useState<Record<string, RowStatus>>({});
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newScope, setNewScope] = useState<string>(ALL_SCOPE);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchKitchenItems(),
      getSupabase().from("locations").select("id, name").eq("active", true).order("name"),
    ])
      .then(([rows, locationResult]) => {
        if (cancelled) return;
        if (locationResult.error) {
          setLoadError(locationResult.error.message);
          return;
        }
        setItems(rows);
        setLocations(locationResult.data ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Unable to load items");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(id: string, patch: Partial<KitchenItemRecord>) {
    setStatusById((prev) => ({ ...prev, [id]: { kind: "saving" } }));
    try {
      await updateKitchenItem(id, patch);
      setItems((prev) => (prev ? prev.map((i) => (i.id === id ? { ...i, ...patch } : i)) : prev));
      setStatusById((prev) => ({ ...prev, [id]: { kind: "saved" } }));
    } catch (err: unknown) {
      setStatusById((prev) => ({
        ...prev,
        [id]: {
          kind: "error",
          message: `Couldn't save: ${err instanceof Error ? err.message : "unknown error"}`,
        },
      }));
    }
  }

  async function move(id: string, direction: "up" | "down") {
    if (!items) return;
    const changes = moveItem(items, id, direction);
    if (changes.length === 0) return;
    setStatusById((prev) => ({ ...prev, [id]: { kind: "saving" } }));
    try {
      for (const change of changes) {
        await updateKitchenItem(change.id, { sort_order: change.sort_order });
      }
      setItems((prev) =>
        prev
          ? prev.map((item) => {
              const change = changes.find((c) => c.id === item.id);
              return change ? { ...item, sort_order: change.sort_order } : item;
            })
          : prev,
      );
      setStatusById((prev) => ({ ...prev, [id]: { kind: "saved" } }));
    } catch (err: unknown) {
      setStatusById((prev) => ({
        ...prev,
        [id]: {
          kind: "error",
          message: `Couldn't reorder: ${err instanceof Error ? err.message : "unknown error"}`,
        },
      }));
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding || !items) return;
    const input = {
      name: newName,
      unit: newUnit,
      location_id: newScope === ALL_SCOPE ? null : newScope,
    };
    const problem = validateKitchenItemInput(input);
    if (problem) {
      setAddError(problem);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const created = await createKitchenItem(input, nextSortOrder(items));
      setItems((prev) => (prev ? [...prev, created] : [created]));
      setNewName("");
      setNewUnit("");
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : "Couldn't add the item");
    } finally {
      setAdding(false);
    }
  }

  const ordered = items
    ? [...items].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    : null;
  const inputClasses = "bg-well rounded-well px-3 py-2 text-ink text-sm outline-none w-full";

  return (
    <div>
      <h1 className="text-xl font-bold text-ink mb-1">Kitchen</h1>
      <p className="text-ink2 text-sm mb-2">
        Items chefs can request from the kitchen. Name and unit save when you leave the field.
        Who can send or see requests is set per person under Team → Modules.
      </p>
      <p className="text-sm mb-5">
        <Link href="/kitchen" className="font-semibold text-accent underline">
          Open the kitchen app ↗
        </Link>
      </p>

      {loadError ? (
        <div className="bg-card rounded-card p-6">
          <p className="text-alert text-sm">{loadError}</p>
        </div>
      ) : ordered === null ? (
        <p className="text-ink3 text-sm">Loading items…</p>
      ) : (
        <>
          <div className="bg-card rounded-card overflow-x-auto mb-5">
            {ordered.length === 0 ? (
              <p className="text-ink2 text-sm p-6">No items yet. Add the first one below.</p>
            ) : (
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left border-b border-hairline">
                    <th className="section-label px-3 py-3 font-semibold">Order</th>
                    <th className="section-label px-3 py-3 font-semibold">Item</th>
                    <th className="section-label px-3 py-3 font-semibold">Unit</th>
                    <th className="section-label px-3 py-3 font-semibold">Scope</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((item, index) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      locations={locations}
                      status={statusById[item.id]}
                      canMoveUp={index > 0}
                      canMoveDown={index < ordered.length - 1}
                      onSave={(id, patch) => void save(id, patch)}
                      onMove={(id, direction) => void move(id, direction)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <form onSubmit={add} className="bg-card rounded-card p-5 flex flex-col gap-3">
            <span className="section-label">Add an item</span>
            <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink3">Name</span>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Fried Shrimp"
                  className={inputClasses}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink3">Unit</span>
                <input
                  type="text"
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  placeholder="pieces"
                  className={inputClasses}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink3">Scope</span>
                <select
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value)}
                  className={`${inputClasses} appearance-none`}
                >
                  <option value={ALL_SCOPE}>All locations</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={adding}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold text-white ${
                  adding ? "bg-disabled" : "bg-accent"
                }`}
              >
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
            {addError ? <p className="text-alert text-sm">{addError}</p> : null}
            <p className="text-ink3 text-xs">
              Scope: {scopeLabel(newScope === ALL_SCOPE ? null : newScope, locations)}
            </p>
          </form>
        </>
      )}
    </div>
  );
}

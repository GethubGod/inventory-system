"use client";

// Suppliers contact editor: plain supabase-js reads/writes to `suppliers`
// (RLS is manager-scoped for writes). Text fields save on blur when changed,
// the channel select saves immediately. Values are stored as typed; phone
// display formatting is cosmetic only.

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneDisplay, phoneForStore } from "@/lib/dashboard/phone";

const CHANNEL_OPTIONS = [
  { value: "sms", label: "SMS / iMessage" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "share_sheet", label: "Share sheet" },
] as const;

type ContactChannel = (typeof CHANNEL_OPTIONS)[number]["value"];

interface SupplierRow {
  id: string;
  name: string;
  contact_phone: string | null;
  contact_channel: ContactChannel;
  contact_name: string | null;
  contact_notes: string | null;
}

type RowStatus = { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

type ContactPatch = Partial<
  Pick<
    SupplierRow,
    "contact_phone" | "contact_channel" | "contact_name" | "contact_notes"
  >
>;

function asChannel(value: string | null | undefined): ContactChannel {
  return value === "sms" || value === "whatsapp" ? value : "share_sheet";
}

function SupplierEditorRow({
  supplier,
  status,
  onSave,
}: {
  supplier: SupplierRow;
  status: RowStatus | undefined;
  onSave: (id: string, patch: ContactPatch) => void;
}) {
  const [phone, setPhone] = useState(supplier.contact_phone ?? "");
  const [contactName, setContactName] = useState(supplier.contact_name ?? "");
  const [notes, setNotes] = useState(supplier.contact_notes ?? "");

  const phoneHint = formatPhoneDisplay(phone.trim());
  const inputClasses =
    "bg-well rounded-well px-3 py-2 text-ink text-sm outline-none w-full";

  return (
    <tr className="border-b border-hairline last:border-b-0 align-top">
      <td className="px-5 py-3.5">
        <p className="font-semibold text-ink">{supplier.name}</p>
        {status?.kind === "saving" ? (
          <p className="text-ink3 text-xs mt-1">Saving…</p>
        ) : status?.kind === "saved" ? (
          <p className="text-ink3 text-xs mt-1">Saved</p>
        ) : status?.kind === "error" ? (
          <p className="text-alert text-xs mt-1">{status.message}</p>
        ) : null}
      </td>
      <td className="px-3 py-3 min-w-36">
        <input
          type="text"
          value={contactName}
          placeholder="Contact name"
          onChange={(e) => setContactName(e.target.value)}
          onBlur={() => {
            const next = contactName.trim() || null;
            if (next !== supplier.contact_name) {
              onSave(supplier.id, { contact_name: next });
            }
          }}
          className={inputClasses}
        />
      </td>
      <td className="px-3 py-3 min-w-40">
        <input
          type="tel"
          value={phone}
          placeholder="Phone"
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => {
            const next = phoneForStore(phone);
            if (next !== supplier.contact_phone) {
              onSave(supplier.id, { contact_phone: next });
            }
          }}
          className={inputClasses}
        />
        {phoneHint && phoneHint !== phone.trim() ? (
          <p className="text-ink3 text-xs mt-1">{phoneHint}</p>
        ) : null}
      </td>
      <td className="px-3 py-3 min-w-36">
        <select
          value={supplier.contact_channel}
          onChange={(e) => {
            const next = asChannel(e.target.value);
            if (next !== supplier.contact_channel) {
              onSave(supplier.id, { contact_channel: next });
            }
          }}
          className={`${inputClasses} appearance-none`}
        >
          {CHANNEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-3 min-w-48">
        <input
          type="text"
          value={notes}
          placeholder="Notes"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            const next = notes.trim() || null;
            if (next !== supplier.contact_notes) {
              onSave(supplier.id, { contact_notes: next });
            }
          }}
          className={inputClasses}
        />
      </td>
    </tr>
  );
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusById, setStatusById] = useState<Record<string, RowStatus>>({});

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .from("suppliers")
      .select(
        "id, name, contact_phone, contact_channel, contact_name, contact_notes",
      )
      .or("active.is.null,active.eq.true")
      .order("name")
      .order("id")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLoadError(error.message);
          return;
        }
        setSuppliers(
          (data ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            contact_phone: row.contact_phone ?? null,
            contact_channel: asChannel(row.contact_channel),
            contact_name: row.contact_name ?? null,
            contact_notes: row.contact_notes ?? null,
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveField(id: string, patch: ContactPatch) {
    setStatusById((prev) => ({ ...prev, [id]: { kind: "saving" } }));
    const { error } = await getSupabase()
      .from("suppliers")
      .update(patch)
      .eq("id", id);
    if (error) {
      setStatusById((prev) => ({
        ...prev,
        [id]: { kind: "error", message: `Couldn't save: ${error.message}` },
      }));
      return;
    }
    setSuppliers((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, ...patch } : s)) : prev,
    );
    setStatusById((prev) => ({ ...prev, [id]: { kind: "saved" } }));
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-ink mb-1">Suppliers</h1>
      <p className="text-ink2 text-sm mb-5">
        Contact details used by the app&apos;s Send All flow. Changes save when
        you leave a field.
      </p>

      {loadError ? (
        <div className="bg-card rounded-card p-6">
          <p className="text-alert text-sm">{loadError}</p>
        </div>
      ) : suppliers === null ? (
        <p className="text-ink3 text-sm">Loading suppliers…</p>
      ) : suppliers.length === 0 ? (
        <div className="bg-card rounded-card p-6">
          <p className="text-ink2 text-sm">No suppliers yet.</p>
        </div>
      ) : (
        <div className="bg-card rounded-card overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left border-b border-hairline">
                <th className="section-label px-5 py-3 font-semibold">
                  Supplier
                </th>
                <th className="section-label px-3 py-3 font-semibold">
                  Contact
                </th>
                <th className="section-label px-3 py-3 font-semibold">Phone</th>
                <th className="section-label px-3 py-3 font-semibold">
                  Channel
                </th>
                <th className="section-label px-3 py-3 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <SupplierEditorRow
                  key={supplier.id}
                  supplier={supplier}
                  status={statusById[supplier.id]}
                  onSave={(id, patch) => void saveField(id, patch)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

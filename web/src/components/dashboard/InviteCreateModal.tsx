"use client";

// "Invite" modal: name + role + expiry form → create-invite edge fn → shows
// the personalized join link with a copy button. Flat card over dim, matching
// ConfirmDialog.

import { useState } from "react";
import {
  createInvite,
  DEFAULT_EXPIRY_HOURS,
  EXPIRY_OPTIONS,
  type CreatedInvite,
  type InviteRole,
} from "@/lib/dashboard/invites";
import CopyButton from "@/components/dashboard/CopyButton";

export default function InviteCreateModal({
  onCreated,
  onClose,
}: {
  /** Called after a successful create so the invites list can refresh. */
  onCreated: () => void;
  onClose: () => void;
}) {
  const [invitedName, setInvitedName] = useState("");
  const [role, setRole] = useState<InviteRole>("employee");
  const [expiresInHours, setExpiresInHours] = useState(DEFAULT_EXPIRY_HOURS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  const canSubmit = invitedName.trim().length > 0 && !busy;

  async function handleCreate() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const invite = await createInvite({
        invitedName: invitedName.trim(),
        role,
        expiresInHours,
      });
      setCreated(invite);
      onCreated();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Couldn't create the invite",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-dim flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-label="Invite a team member"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-card rounded-card p-6 w-full max-w-md flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {created ? (
          <>
            <p className="text-ink font-bold">
              Invite ready for {invitedName.trim()}
            </p>
            <p className="text-ink2 text-sm">
              Send them this personal link. It signs them up as{" "}
              <span className="font-semibold">{role}</span> and stops working
              after it&apos;s used, revoked, or expires.
            </p>
            <div className="bg-well rounded-well px-4 py-3 flex items-center gap-3">
              <p className="text-ink text-sm break-all flex-1">
                {created.joinUrl}
              </p>
              <CopyButton value={created.joinUrl} />
            </div>
            <div className="flex justify-end mt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-5 py-2.5 text-sm font-semibold text-white bg-accent"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-ink font-bold">Invite a team member</p>

            <label className="flex flex-col gap-1.5">
              <span className="section-label">Name</span>
              <input
                type="text"
                value={invitedName}
                onChange={(e) => setInvitedName(e.target.value)}
                placeholder="Who is this invite for?"
                autoFocus
                className="bg-well rounded-well px-4 py-2.5 text-sm text-ink placeholder:text-ink3 outline-none border-2 border-transparent focus:border-accent focus:bg-card"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="section-label">Role</span>
              <div className="flex gap-2">
                {(["employee", "manager"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRole(option)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${
                      role === option
                        ? "bg-accent text-white"
                        : "bg-well text-ink2"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="section-label">Link expires in</span>
              <select
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(Number(e.target.value))}
                className="bg-well rounded-well px-4 py-2.5 text-sm text-ink outline-none border-2 border-transparent focus:border-accent"
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.hours} value={option.hours}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {error ? <p className="text-alert text-sm">{error}</p> : null}

            <div className="flex justify-end gap-2 mt-1">
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="rounded-full px-5 py-2.5 text-sm font-semibold text-ink2 bg-well"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void handleCreate()}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold text-white ${
                  canSubmit ? "bg-accent" : "bg-disabled"
                }`}
              >
                {busy ? "Creating…" : "Create invite"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

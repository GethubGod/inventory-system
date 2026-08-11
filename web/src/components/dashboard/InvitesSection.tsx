"use client";

// Invites list under the roster: status chips (pending/used/expired/revoked),
// copyable personalized link for pending invites, revoke with confirm.
// Reads the `invites` table directly (manager RLS), mutates via revoke-invite.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import {
  buildJoinUrl,
  deriveInviteStatus,
  fetchInvites,
  revokeInvite,
  type InviteRow,
  type InviteStatus,
} from "@/lib/dashboard/invites";
import ConfirmDialog from "@/components/dashboard/ConfirmDialog";
import CopyButton from "@/components/dashboard/CopyButton";

export interface InvitesSectionHandle {
  refresh: () => void;
}

const STATUS_STYLES: Record<InviteStatus, string> = {
  pending: "bg-tint text-accent",
  used: "bg-well text-ink2",
  expired: "bg-well text-ink3",
  revoked: "bg-alert text-white",
};

function StatusChip({ status }: { status: InviteStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const InvitesSection = forwardRef<InvitesSectionHandle>(
  function InvitesSection(_props, ref) {
    const [invites, setInvites] = useState<InviteRow[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [revoking, setRevoking] = useState<InviteRow | null>(null);
    const [revokeBusy, setRevokeBusy] = useState(false);

    const load = useCallback(() => {
      fetchInvites()
        .then((rows) => {
          setInvites(rows);
          setLoadError(null);
        })
        .catch((err: unknown) => {
          setLoadError(
            err instanceof Error ? err.message : "Unable to load invites",
          );
        });
    }, []);

    useEffect(() => {
      load();
    }, [load]);

    useImperativeHandle(ref, () => ({ refresh: load }), [load]);

    async function handleRevoke(target: InviteRow) {
      setRevokeBusy(true);
      setActionError(null);
      try {
        await revokeInvite(target.id);
        setRevoking(null);
        load();
      } catch (err: unknown) {
        setRevoking(null);
        setActionError(
          err instanceof Error
            ? `Couldn't revoke the invite for ${target.invited_name}: ${err.message}`
            : `Couldn't revoke the invite for ${target.invited_name}`,
        );
      } finally {
        setRevokeBusy(false);
      }
    }

    return (
      <section className="mt-8">
        <h2 className="text-lg font-bold text-ink mb-1">Invites</h2>
        <p className="text-ink2 text-sm mb-4">
          Each link is personal and single-use. Share it with the person it was
          created for; revoke it if it shouldn&apos;t be used anymore.
        </p>

        {actionError ? (
          <p className="text-alert text-sm mb-4">{actionError}</p>
        ) : null}

        {loadError ? (
          <div className="bg-card rounded-card p-6">
            <p className="text-alert text-sm">{loadError}</p>
          </div>
        ) : invites === null ? (
          <p className="text-ink3 text-sm">Loading invites…</p>
        ) : invites.length === 0 ? (
          <div className="bg-card rounded-card p-6">
            <p className="text-ink2 text-sm">
              No invites yet. Use the Invite button above to create one.
            </p>
          </div>
        ) : (
          <div className="bg-card rounded-card overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left border-b border-hairline">
                  <th className="section-label px-5 py-3 font-semibold">
                    Invited
                  </th>
                  <th className="section-label px-5 py-3 font-semibold">
                    Role
                  </th>
                  <th className="section-label px-5 py-3 font-semibold">
                    Status
                  </th>
                  <th className="section-label px-5 py-3 font-semibold">
                    Expires
                  </th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => {
                  const status = deriveInviteStatus(invite);
                  return (
                    <tr
                      key={invite.id}
                      className="border-b border-hairline last:border-b-0"
                    >
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-ink">
                          {invite.invited_name}
                        </p>
                        <p className="text-ink3 text-xs">
                          Created {formatDateTime(invite.created_at)}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 capitalize text-ink2">
                        {invite.role}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusChip status={status} />
                      </td>
                      <td className="px-5 py-3.5 text-ink2">
                        {formatDateTime(invite.expires_at)}
                        {status === "used"
                          ? ` · used ${formatDateTime(invite.used_at)}`
                          : ""}
                      </td>
                      <td className="px-5 py-3.5">
                        {status === "pending" ? (
                          <span className="flex items-center justify-end gap-2">
                            <CopyButton value={buildJoinUrl(invite.token)} />
                            <button
                              type="button"
                              onClick={() => setRevoking(invite)}
                              className="rounded-full px-4 py-1.5 text-xs font-semibold bg-well text-alert"
                            >
                              Revoke
                            </button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {revoking ? (
          <ConfirmDialog
            title={`Revoke ${revoking.invited_name}'s invite?`}
            body="The link stops working immediately. You can always create a new invite for them later."
            confirmLabel="Revoke"
            destructive
            busy={revokeBusy}
            onConfirm={() => void handleRevoke(revoking)}
            onCancel={() => setRevoking(null)}
          />
        ) : null}
      </section>
    );
  },
);

export default InvitesSection;

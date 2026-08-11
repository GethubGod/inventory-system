"use client";

// Team roster: list-users edge fn, role/suspended badges, suspend/unsuspend
// via set-user-suspended with confirm dialog. Optimistic flip with rollback
// on error. Phase 3 adds a per-user module toggle row (expandable under each
// user) backed by rpc get_effective_modules + user_modules upserts.

import { Fragment, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  fetchTeam,
  setUserSuspended,
  type TeamUser,
} from "@/lib/dashboard/team";
import {
  fetchModulesForUser,
  moduleKeysForRole,
  MODULE_LABELS,
  setUserModule,
  type ModuleKey,
  type ModuleMap,
} from "@/lib/dashboard/modules";
import ConfirmDialog from "@/components/dashboard/ConfirmDialog";
import InviteCreateModal from "@/components/dashboard/InviteCreateModal";
import InvitesSection, {
  type InvitesSectionHandle,
} from "@/components/dashboard/InvitesSection";

function displayName(user: TeamUser): string {
  return user.full_name?.trim() || user.email || "Unknown user";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function RoleBadge({ role }: { role: TeamUser["role"] }) {
  const managerStyle = "bg-tint text-accent";
  const employeeStyle = "bg-well text-ink2";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        role === "manager" ? managerStyle : employeeStyle
      }`}
    >
      {role}
    </span>
  );
}

type ModuleRowState = {
  loading: boolean;
  error: string | null;
  modules: ModuleMap | null;
  pendingKey: ModuleKey | null;
};

export default function TeamPage() {
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TeamUser | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [expandedModulesId, setExpandedModulesId] = useState<string | null>(
    null,
  );
  const [moduleRows, setModuleRows] = useState<Record<string, ModuleRowState>>(
    {},
  );
  const invitesRef = useRef<InvitesSectionHandle>(null);

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setSelfId(data.session?.user.id ?? null);
      });
    fetchTeam()
      .then((team) => {
        if (!cancelled) setUsers(team);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Unable to load the roster",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function applySuspension(target: TeamUser) {
    const nextSuspended = !target.is_suspended;
    setPendingId(target.id);
    setActionError(null);
    // Optimistic flip.
    setUsers((prev) =>
      prev
        ? prev.map((u) =>
            u.id === target.id ? { ...u, is_suspended: nextSuspended } : u,
          )
        : prev,
    );
    setConfirming(null);
    try {
      await setUserSuspended(target.id, nextSuspended);
    } catch (err: unknown) {
      // Rollback.
      setUsers((prev) =>
        prev
          ? prev.map((u) =>
              u.id === target.id
                ? { ...u, is_suspended: target.is_suspended }
                : u,
            )
          : prev,
      );
      setActionError(
        err instanceof Error
          ? `Couldn't update ${displayName(target)}: ${err.message}`
          : `Couldn't update ${displayName(target)}`,
      );
    } finally {
      setPendingId(null);
    }
  }

  async function loadModules(target: TeamUser) {
    setModuleRows((prev) => ({
      ...prev,
      [target.id]: {
        loading: true,
        error: null,
        modules: prev[target.id]?.modules ?? null,
        pendingKey: null,
      },
    }));
    try {
      const modules = await fetchModulesForUser(target.id, target.role);
      setModuleRows((prev) => ({
        ...prev,
        [target.id]: { loading: false, error: null, modules, pendingKey: null },
      }));
    } catch (err: unknown) {
      setModuleRows((prev) => ({
        ...prev,
        [target.id]: {
          loading: false,
          error:
            err instanceof Error ? err.message : "Unable to load modules",
          modules: prev[target.id]?.modules ?? null,
          pendingKey: null,
        },
      }));
    }
  }

  function toggleModulesRow(target: TeamUser) {
    const expanding = expandedModulesId !== target.id;
    setExpandedModulesId(expanding ? target.id : null);
    const existing = moduleRows[target.id];
    if (expanding && !existing?.modules && !existing?.loading) {
      void loadModules(target);
    }
  }

  async function applyModuleToggle(target: TeamUser, key: ModuleKey) {
    const row = moduleRows[target.id];
    if (!row?.modules || row.pendingKey) return;
    const previousModules = row.modules;
    const nextEnabled = !previousModules[key];
    setActionError(null);
    // Optimistic flip.
    setModuleRows((prev) => ({
      ...prev,
      [target.id]: {
        ...row,
        modules: { ...previousModules, [key]: nextEnabled },
        pendingKey: key,
      },
    }));
    try {
      await setUserModule(target.id, key, nextEnabled);
      setModuleRows((prev) => {
        const current = prev[target.id];
        if (!current) return prev;
        return { ...prev, [target.id]: { ...current, pendingKey: null } };
      });
    } catch (err: unknown) {
      // Rollback.
      setModuleRows((prev) => {
        const current = prev[target.id];
        if (!current) return prev;
        return {
          ...prev,
          [target.id]: {
            ...current,
            modules: previousModules,
            pendingKey: null,
          },
        };
      });
      setActionError(
        err instanceof Error
          ? `Couldn't update ${MODULE_LABELS[key]} for ${displayName(target)}: ${err.message}`
          : `Couldn't update ${MODULE_LABELS[key]} for ${displayName(target)}`,
      );
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-xl font-bold text-ink">Team</h1>
        <button
          type="button"
          onClick={() => setInviting(true)}
          className="rounded-full px-5 py-2 text-sm font-semibold bg-accent text-white"
        >
          Invite
        </button>
      </div>
      <p className="text-ink2 text-sm mb-5">
        Everyone with a Babytuna account. Suspending an employee blocks the app
        until you lift it.
      </p>

      {actionError ? (
        <p className="text-alert text-sm mb-4">{actionError}</p>
      ) : null}

      {loadError ? (
        <div className="bg-card rounded-card p-6">
          <p className="text-alert text-sm">{loadError}</p>
        </div>
      ) : users === null ? (
        <p className="text-ink3 text-sm">Loading roster…</p>
      ) : users.length === 0 ? (
        <div className="bg-card rounded-card p-6">
          <p className="text-ink2 text-sm">No users yet.</p>
        </div>
      ) : (
        <div className="bg-card rounded-card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left border-b border-hairline">
                <th className="section-label px-5 py-3 font-semibold">Name</th>
                <th className="section-label px-5 py-3 font-semibold">Role</th>
                <th className="section-label px-5 py-3 font-semibold">
                  Last active
                </th>
                <th className="section-label px-5 py-3 font-semibold">
                  Joined
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const moduleRow = moduleRows[user.id];
                const modulesExpanded = expandedModulesId === user.id;
                return (
                <Fragment key={user.id}>
                <tr
                  className={
                    modulesExpanded
                      ? ""
                      : "border-b border-hairline last:border-b-0"
                  }
                >
                  <td className="px-5 py-3.5">
                    <p
                      className={`font-semibold ${
                        user.is_suspended ? "text-ink3" : "text-ink"
                      }`}
                    >
                      {displayName(user)}
                      {user.id === selfId ? (
                        <span className="text-ink3 font-normal"> (you)</span>
                      ) : null}
                    </p>
                    <p className="text-ink3 text-xs">{user.email}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <RoleBadge role={user.role} />
                      {user.is_suspended ? (
                        <span className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide bg-alert text-white">
                          Suspended
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-ink2">
                    {formatDate(user.last_active_at)}
                  </td>
                  <td className="px-5 py-3.5 text-ink2">
                    {formatDate(user.created_at)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleModulesRow(user)}
                        aria-expanded={modulesExpanded}
                        className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                          modulesExpanded
                            ? "bg-tint text-accent"
                            : "bg-well text-ink2"
                        }`}
                      >
                        Modules
                      </button>
                      {user.role === "employee" && user.id !== selfId ? (
                        <button
                          type="button"
                          disabled={pendingId === user.id}
                          onClick={() => setConfirming(user)}
                          className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                            pendingId === user.id
                              ? "bg-disabled text-white"
                              : user.is_suspended
                                ? "bg-accent text-white"
                                : "bg-well text-ink2"
                          }`}
                        >
                          {pendingId === user.id
                            ? "Saving…"
                            : user.is_suspended
                              ? "Unsuspend"
                              : "Suspend"}
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
                {modulesExpanded ? (
                  <tr className="border-b border-hairline last:border-b-0">
                    <td colSpan={5} className="px-5 pb-4 pt-0">
                      {moduleRow?.loading && !moduleRow.modules ? (
                        <p className="text-ink3 text-xs">Loading modules…</p>
                      ) : moduleRow?.error && !moduleRow.modules ? (
                        <p className="text-alert text-xs">
                          {moduleRow.error}{" "}
                          <button
                            type="button"
                            onClick={() => void loadModules(user)}
                            className="font-semibold underline"
                          >
                            Retry
                          </button>
                        </p>
                      ) : moduleRow?.modules ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {moduleKeysForRole(user.role).map((key) => {
                            const enabled = moduleRow.modules?.[key] ?? false;
                            const saving = moduleRow.pendingKey === key;
                            return (
                              <button
                                key={key}
                                type="button"
                                disabled={moduleRow.pendingKey !== null}
                                onClick={() =>
                                  void applyModuleToggle(user, key)
                                }
                                aria-pressed={enabled}
                                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                                  saving
                                    ? "bg-disabled text-white"
                                    : enabled
                                      ? "bg-accent text-white"
                                      : "bg-well text-ink2"
                                }`}
                              >
                                {saving
                                  ? "Saving…"
                                  : `${MODULE_LABELS[key]}: ${enabled ? "On" : "Off"}`}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <InvitesSection ref={invitesRef} />

      {inviting ? (
        <InviteCreateModal
          onCreated={() => invitesRef.current?.refresh()}
          onClose={() => setInviting(false)}
        />
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title={
            confirming.is_suspended
              ? `Unsuspend ${displayName(confirming)}?`
              : `Suspend ${displayName(confirming)}?`
          }
          body={
            confirming.is_suspended
              ? "They'll immediately get app access back."
              : "They'll be signed out of the app and blocked until you unsuspend them."
          }
          confirmLabel={confirming.is_suspended ? "Unsuspend" : "Suspend"}
          destructive={!confirming.is_suspended}
          onConfirm={() => void applySuspension(confirming)}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}

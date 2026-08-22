"use client";

// Per-employee ordering checklist editor (Phase 5b). Pick an employee (roster
// via the list-users edge function, same as TeamPage) and location group,
// then edit that employee's generated checklist directly over supabase-js —
// manager RLS covers order_checklists/order_checklist_items, and the profiles
// trigger scopes the send-mode toggle to manager-on-employee writes. Editing
// style follows SuppliersPage: optimistic updates with rollback, text fields
// save on blur, toggles save immediately.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { fetchTeam, type TeamUser } from "@/lib/dashboard/team";
import {
  deleteChecklistItem,
  fetchChecklistFor,
  fetchSendMode,
  insertChecklistItem,
  itemProvenanceLabel,
  nextSortOrder,
  parseRecommendedQty,
  regenerateChecklist,
  searchInventoryItems,
  sortChecklistItems,
  updateChecklistItem,
  updateSendMode,
  type ChecklistItemRecord,
  type ChecklistRecord,
  type InventoryOption,
  type LocationGroup,
  type OrderSendMode,
} from "@/lib/dashboard/ordering";

const GROUP_OPTIONS: { value: LocationGroup; label: string }[] = [
  { value: "sushi", label: "Sushi" },
  { value: "poki", label: "Poki & Pho" },
];

const SEND_MODE_OPTIONS: {
  value: OrderSendMode;
  label: string;
  hint: string;
}[] = [
  {
    value: "review",
    label: "Review",
    hint: "Orders go to the manager review queue.",
  },
  {
    value: "direct",
    label: "Direct",
    hint: "Orders send straight to suppliers from the employee's phone.",
  },
];

const inputClasses =
  "bg-well rounded-well px-3 py-2 text-ink text-sm outline-none w-full";

function displayName(user: TeamUser): string {
  return user.full_name?.trim() || user.email;
}

function ChecklistItemEditorRow({
  item,
  onToggleChecked,
  onSaveQty,
  onRemove,
}: {
  item: ChecklistItemRecord;
  onToggleChecked: (item: ChecklistItemRecord) => void;
  onSaveQty: (item: ChecklistItemRecord, value: number | null) => void;
  onRemove: (item: ChecklistItemRecord) => void;
}) {
  const [qtyText, setQtyText] = useState(
    item.recommendedQty === null ? "" : String(item.recommendedQty),
  );

  return (
    <tr className="border-b border-hairline last:border-b-0">
      <td className="px-5 py-3 w-12">
        <input
          type="checkbox"
          checked={item.defaultChecked}
          onChange={() => onToggleChecked(item)}
          aria-label={`${item.itemName} checked by default`}
          className="h-4 w-4 accent-accent"
        />
      </td>
      <td className="px-3 py-3">
        <p className="font-semibold text-ink">{item.itemName}</p>
        {item.itemId === null ? (
          <p className="text-ink3 text-xs mt-0.5">Not matched to inventory</p>
        ) : null}
      </td>
      <td className="px-3 py-3 text-ink2">{item.unit}</td>
      <td className="px-3 py-3 w-28">
        <input
          type="text"
          inputMode="decimal"
          value={qtyText}
          placeholder="—"
          aria-label={`${item.itemName} recommended quantity`}
          onChange={(e) => setQtyText(e.target.value)}
          onBlur={() => {
            const parsed = parseRecommendedQty(qtyText);
            if (!parsed.ok) {
              setQtyText(
                item.recommendedQty === null ? "" : String(item.recommendedQty),
              );
              return;
            }
            if (parsed.value !== item.recommendedQty) {
              onSaveQty(item, parsed.value);
            }
          }}
          className={inputClasses}
        />
      </td>
      <td className="px-3 py-3">
        <span className="text-ink3 text-xs">{itemProvenanceLabel(item)}</span>
      </td>
      <td className="px-3 py-3 w-20 text-right">
        <button
          type="button"
          onClick={() => onRemove(item)}
          className="text-alert text-xs font-semibold"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

export default function OrderingPage() {
  const [team, setTeam] = useState<TeamUser[] | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [group, setGroup] = useState<LocationGroup>("sushi");

  const [checklist, setChecklist] = useState<ChecklistRecord | null>(null);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const checklistRequestRef = useRef(0);

  const [sendMode, setSendMode] = useState<OrderSendMode | null>(null);
  const [sendModeError, setSendModeError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<InventoryOption[] | null>(
    null,
  );

  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);

  const employees = useMemo(
    () => (team ?? []).filter((user) => user.role === "employee"),
    [team],
  );
  const selectedEmployee = useMemo(
    () => employees.find((user) => user.id === selectedUserId) ?? null,
    [employees, selectedUserId],
  );

  useEffect(() => {
    let cancelled = false;
    fetchTeam()
      .then((users) => {
        if (!cancelled) setTeam(users);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTeamError(
            error instanceof Error ? error.message : "Could not load the team.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadChecklist = useCallback(async () => {
    if (!selectedUserId) return;
    const requestId = ++checklistRequestRef.current;
    try {
      const record = await fetchChecklistFor(selectedUserId, group);
      if (requestId === checklistRequestRef.current) setChecklist(record);
    } catch (error) {
      if (requestId === checklistRequestRef.current) {
        setChecklist(null);
        setChecklistError(
          error instanceof Error ? error.message : "Could not load the checklist.",
        );
      }
    } finally {
      if (requestId === checklistRequestRef.current) {
        setChecklistLoading(false);
      }
    }
  }, [group, selectedUserId]);

  useEffect(() => {
    if (!selectedUserId) return;
    const requestId = ++checklistRequestRef.current;
    fetchChecklistFor(selectedUserId, group)
      .then((record) => {
        if (requestId === checklistRequestRef.current) setChecklist(record);
      })
      .catch((error: unknown) => {
        if (requestId !== checklistRequestRef.current) return;
        setChecklist(null);
        setChecklistError(
          error instanceof Error ? error.message : "Could not load the checklist.",
        );
      })
      .finally(() => {
        if (requestId === checklistRequestRef.current) {
          setChecklistLoading(false);
        }
      });
  }, [group, selectedUserId]);

  useEffect(() => {
    if (!selectedUserId) return;
    let cancelled = false;
    fetchSendMode(selectedUserId)
      .then((mode) => {
        if (!cancelled) setSendMode(mode);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSendModeError(
            error instanceof Error
              ? error.message
              : "Could not load the send mode.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedUserId]);

  // Debounced inventory search for the add-item box.
  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchInventoryItems(query)
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  function handleEmployeeChange(nextUserId: string) {
    checklistRequestRef.current += 1;
    setSelectedUserId(nextUserId);
    setChecklist(null);
    setChecklistLoading(Boolean(nextUserId));
    setChecklistError(null);
    setSendMode(null);
    setSendModeError(null);
    setSearchQuery("");
    setSearchResults(null);
    setActionError(null);
  }

  function handleGroupChange(nextGroup: LocationGroup) {
    if (nextGroup === group) return;
    checklistRequestRef.current += 1;
    setGroup(nextGroup);
    setChecklist(null);
    setChecklistLoading(Boolean(selectedUserId));
    setChecklistError(null);
    setSearchQuery("");
    setSearchResults(null);
    setActionError(null);
  }

  function handleSearchQueryChange(nextQuery: string) {
    setSearchQuery(nextQuery);
    setSearchResults(null);
  }

  function patchItems(
    updater: (items: ChecklistItemRecord[]) => ChecklistItemRecord[],
  ) {
    setChecklist((prev) =>
      prev ? { ...prev, items: updater(prev.items) } : prev,
    );
  }

  async function handleToggleChecked(item: ChecklistItemRecord) {
    const next = !item.defaultChecked;
    setActionError(null);
    patchItems((items) =>
      items.map((row) =>
        row.id === item.id ? { ...row, defaultChecked: next } : row,
      ),
    );
    try {
      await updateChecklistItem(item.id, { default_checked: next });
    } catch (error) {
      patchItems((items) =>
        items.map((row) =>
          row.id === item.id ? { ...row, defaultChecked: item.defaultChecked } : row,
        ),
      );
      setActionError(
        error instanceof Error ? error.message : "Couldn't save the change.",
      );
    }
  }

  async function handleSaveQty(item: ChecklistItemRecord, value: number | null) {
    setActionError(null);
    const previous = item.recommendedQty;
    patchItems((items) =>
      items.map((row) =>
        row.id === item.id ? { ...row, recommendedQty: value } : row,
      ),
    );
    try {
      await updateChecklistItem(item.id, { recommended_qty: value });
    } catch (error) {
      patchItems((items) =>
        items.map((row) =>
          row.id === item.id ? { ...row, recommendedQty: previous } : row,
        ),
      );
      setActionError(
        error instanceof Error ? error.message : "Couldn't save the quantity.",
      );
    }
  }

  async function handleRemove(item: ChecklistItemRecord) {
    setActionError(null);
    const snapshot = checklist?.items ?? [];
    patchItems((items) => items.filter((row) => row.id !== item.id));
    try {
      await deleteChecklistItem(item.id);
    } catch (error) {
      patchItems(() => snapshot);
      setActionError(
        error instanceof Error ? error.message : "Couldn't remove the item.",
      );
    }
  }

  async function handleAddItem(option: InventoryOption) {
    if (!checklist) return;
    setActionError(null);
    setSearchQuery("");
    setSearchResults(null);

    if (checklist.items.some((row) => row.itemId === option.id)) {
      setActionError(`${option.name} is already on this checklist.`);
      return;
    }

    const tempId = `pending-${option.id}`;
    const optimistic: ChecklistItemRecord = {
      id: tempId,
      itemId: option.id,
      itemName: option.name,
      unit: option.unit,
      defaultChecked: true,
      recommendedQty: null,
      stalenessBucket: null,
      itemSource: "manual",
      sortOrder: nextSortOrder(checklist.items),
    };
    patchItems((items) => sortChecklistItems([...items, optimistic]));
    try {
      const saved = await insertChecklistItem({
        checklistId: checklist.id,
        itemId: option.id,
        itemName: option.name,
        unit: option.unit,
        sortOrder: optimistic.sortOrder,
      });
      patchItems((items) =>
        items.map((row) => (row.id === tempId ? saved : row)),
      );
    } catch (error) {
      patchItems((items) => items.filter((row) => row.id !== tempId));
      setActionError(
        error instanceof Error ? error.message : "Couldn't add the item.",
      );
    }
  }

  async function handleSendModeChange(mode: OrderSendMode) {
    if (!selectedUserId || sendMode === null || mode === sendMode) return;
    const previous = sendMode;
    setSendModeError(null);
    setSendMode(mode);
    try {
      await updateSendMode(selectedUserId, mode);
    } catch (error) {
      setSendMode(previous);
      setSendModeError(
        error instanceof Error ? error.message : "Couldn't save the send mode.",
      );
    }
  }

  async function handleRegenerate() {
    if (!selectedUserId) return;
    setRegenBusy(true);
    setActionError(null);
    try {
      await regenerateChecklist(selectedUserId, group);
      setRegenConfirmOpen(false);
      setChecklistLoading(true);
      setChecklistError(null);
      await loadChecklist();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Couldn't regenerate the checklist.",
      );
      setRegenConfirmOpen(false);
    } finally {
      setRegenBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-ink mb-1">Ordering setup</h1>
      <p className="text-ink2 text-sm mb-5">
        Each employee&apos;s simplified ordering checklist and how their orders
        are sent.
      </p>

      {teamError ? (
        <div className="bg-card rounded-card p-6">
          <p className="text-alert text-sm">{teamError}</p>
        </div>
      ) : team === null ? (
        <p className="text-ink3 text-sm">Loading team…</p>
      ) : employees.length === 0 ? (
        <div className="bg-card rounded-card p-6">
          <p className="text-ink2 text-sm">No employees yet.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <select
              value={selectedUserId}
              onChange={(e) => handleEmployeeChange(e.target.value)}
              aria-label="Employee"
              className={`${inputClasses} appearance-none max-w-72`}
            >
              <option value="">Choose an employee…</option>
              {employees.map((user) => (
                <option key={user.id} value={user.id}>
                  {displayName(user)}
                  {user.is_suspended ? " (suspended)" : ""}
                </option>
              ))}
            </select>

            <div className="flex rounded-full bg-well p-1" role="tablist">
              {GROUP_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={group === option.value}
                  onClick={() => handleGroupChange(option.value)}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                    group === option.value
                      ? "bg-card text-ink shadow-sm"
                      : "text-ink2"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {!selectedEmployee ? (
            <div className="bg-card rounded-card p-6">
              <p className="text-ink2 text-sm">
                Pick an employee to edit their checklist and send mode.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="bg-card rounded-card p-5">
                <p className="section-label mb-2">Send mode</p>
                {sendModeError ? (
                  <p className="text-alert text-sm mb-2">{sendModeError}</p>
                ) : null}
                {sendMode === null && !sendModeError ? (
                  <p className="text-ink3 text-sm">Loading…</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {SEND_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={sendMode === option.value}
                        onClick={() => void handleSendModeChange(option.value)}
                        className={`rounded-well px-4 py-3 text-left border ${
                          sendMode === option.value
                            ? "border-accent bg-well"
                            : "border-hairline"
                        }`}
                      >
                        <p className="text-ink text-sm font-semibold">
                          {option.label}
                        </p>
                        <p className="text-ink3 text-xs mt-0.5">{option.hint}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-card rounded-card">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
                  <div>
                    <p className="section-label">
                      Checklist —{" "}
                      {GROUP_OPTIONS.find((o) => o.value === group)?.label}
                    </p>
                    {checklist ? (
                      <p className="text-ink3 text-xs mt-1">
                        Generated{" "}
                        {new Date(checklist.generatedAt).toLocaleDateString()}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRegenConfirmOpen(true)}
                    disabled={checklistLoading}
                    className="rounded-full px-4 py-2 text-sm font-semibold text-ink2 bg-well"
                  >
                    Regenerate from history
                  </button>
                </div>

                {actionError ? (
                  <p className="text-alert text-sm px-5 pt-3">{actionError}</p>
                ) : null}

                {checklistLoading ? (
                  <p className="text-ink3 text-sm px-5 py-5">
                    Loading checklist…
                  </p>
                ) : checklistError ? (
                  <p className="text-alert text-sm px-5 py-5">
                    {checklistError}
                  </p>
                ) : checklist === null ? (
                  <p className="text-ink2 text-sm px-5 py-5">
                    No checklist yet for this employee and location group. Use
                    &ldquo;Regenerate from history&rdquo; to create one from
                    their order history.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto mt-3">
                      <table className="w-full text-sm min-w-[640px]">
                        <thead>
                          <tr className="text-left border-b border-hairline">
                            <th className="section-label px-5 py-2 font-semibold">
                              On
                            </th>
                            <th className="section-label px-3 py-2 font-semibold">
                              Item
                            </th>
                            <th className="section-label px-3 py-2 font-semibold">
                              Unit
                            </th>
                            <th className="section-label px-3 py-2 font-semibold">
                              Rec. qty
                            </th>
                            <th className="section-label px-3 py-2 font-semibold">
                              Source
                            </th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {checklist.items.length === 0 ? (
                            <tr>
                              <td
                                colSpan={6}
                                className="px-5 py-4 text-ink2 text-sm"
                              >
                                No items on this checklist yet.
                              </td>
                            </tr>
                          ) : (
                            checklist.items.map((item) => (
                              <ChecklistItemEditorRow
                                key={`${item.id}:${item.recommendedQty ?? "none"}`}
                                item={item}
                                onToggleChecked={(row) =>
                                  void handleToggleChecked(row)
                                }
                                onSaveQty={(row, value) =>
                                  void handleSaveQty(row, value)
                                }
                                onRemove={(row) => void handleRemove(row)}
                              />
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="relative px-5 py-4">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => handleSearchQueryChange(e.target.value)}
                        placeholder="Add item — search inventory…"
                        aria-label="Search inventory to add an item"
                        className={inputClasses}
                      />
                      {searchResults !== null ? (
                        <div className="absolute left-5 right-5 z-10 mt-1 bg-card rounded-card border border-hairline shadow-lg max-h-64 overflow-y-auto">
                          {searchResults.length === 0 ? (
                            <p className="text-ink3 text-sm px-4 py-3">
                              No matching inventory items.
                            </p>
                          ) : (
                            searchResults.map((option) => {
                              const alreadyAdded = checklist.items.some(
                                (row) => row.itemId === option.id,
                              );
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  disabled={alreadyAdded}
                                  onClick={() => void handleAddItem(option)}
                                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-well disabled:opacity-50"
                                >
                                  <span className="text-ink font-medium">
                                    {option.name}
                                  </span>
                                  <span className="text-ink3 ml-2 text-xs">
                                    {option.unit}
                                    {alreadyAdded ? " • already added" : ""}
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {regenConfirmOpen && selectedEmployee ? (
        <ConfirmDialog
          title="Regenerate checklist?"
          body={`Rebuild ${displayName(selectedEmployee)}'s ${
            GROUP_OPTIONS.find((o) => o.value === group)?.label
          } checklist from their order history. Generated rows are replaced; items added by hand are kept.`}
          confirmLabel="Regenerate"
          busy={regenBusy}
          onConfirm={() => void handleRegenerate()}
          onCancel={() => setRegenConfirmOpen(false)}
        />
      ) : null}
    </div>
  );
}

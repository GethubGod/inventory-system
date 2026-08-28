"use client";

// One optional free-text note per entry (Tips v3). Three states: a dashed
// "+ Add a note" button, the open editor (280 cap with a live counter,
// Cancel / Save), and a one-line truncated preview with an edit affordance.
// Saving empty text collapses back to the dashed button.

import { useRef, useState } from "react";

export const NOTE_MAX_LENGTH = 280;

export function NoteField({
  note,
  onChange,
}: {
  /** The saved note, null when there is none. */
  note: string | null;
  /** Called with the trimmed note, or null when it was cleared. */
  onChange: (note: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEditing = () => {
    setDraft(note ?? "");
    setOpen(true);
  };

  const save = () => {
    const trimmed = draft.trim();
    onChange(trimmed === "" ? null : trimmed);
    setOpen(false);
  };

  if (open) {
    return (
      <div className="bg-card rounded-card p-4">
        <div className="flex items-center">
          <span className="section-label">Note</span>
          <span className="ml-auto text-sm text-ink3">
            {draft.length} / {NOTE_MAX_LENGTH}
          </span>
        </div>
        <textarea
          ref={textareaRef}
          autoFocus
          rows={3}
          maxLength={NOTE_MAX_LENGTH}
          value={draft}
          onChange={(event) =>
            setDraft(event.target.value.slice(0, NOTE_MAX_LENGTH))
          }
          placeholder="Drawer was $20 short — Marco recounted, still short."
          aria-label="Note"
          className="mt-2 w-full resize-none rounded-well bg-well p-3 text-ink outline-none placeholder:text-ink3"
        />
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-well border border-dashed border-line bg-card px-4 py-2 text-sm font-semibold text-ink2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-well border border-accent bg-tint px-4 py-2 text-sm font-semibold text-alert"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  if (note !== null) {
    return (
      <div className="bg-card rounded-card flex items-center gap-2 px-4 py-3">
        <span className="rounded-[5px] bg-poki/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-poki">
          note
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink2">{note}</span>
        <button
          type="button"
          onClick={startEditing}
          className="shrink-0 font-bold text-accent"
        >
          edit
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className="w-full rounded-well border border-dashed border-line bg-card p-3 text-center text-sm font-semibold text-ink2"
    >
      + Add a note
    </button>
  );
}

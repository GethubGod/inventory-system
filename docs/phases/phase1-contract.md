# Phase 1 contract — Rapid Send All (agents: read before coding)

Roadmap spec: `docs/ROADMAP.md` Phase 1. This file pins the seam between the backend
(Codex) and frontend (Claude) agents so they can build in parallel. Do not change these
signatures without updating this doc.

## Schema (backend owns)

Additive migration on `public.suppliers`:

```sql
alter table public.suppliers
  add column if not exists contact_phone text,          -- E.164-ish, stored as typed
  add column if not exists contact_channel text not null default 'share_sheet'
    check (contact_channel in ('sms', 'whatsapp', 'share_sheet')),
  add column if not exists contact_name text,
  add column if not exists contact_notes text;
```

RLS: managers read/write (match existing suppliers policies).

## Service seam (backend owns implementation; frontend imports)

`src/services/supplierContacts.ts`:

```ts
export type SupplierContactChannel = 'sms' | 'whatsapp' | 'share_sheet';

export interface SupplierContact {
  supplierId: string;
  supplierName: string;
  contactPhone: string | null;
  contactChannel: SupplierContactChannel;
  contactName: string | null;
  contactNotes: string | null;
}

export async function listSupplierContacts(): Promise<SupplierContact[]>;
export async function updateSupplierContact(
  supplierId: string,
  patch: Partial<Pick<SupplierContact, 'contactPhone' | 'contactChannel' | 'contactName' | 'contactNotes'>>,
): Promise<SupplierContact>;
```

`src/services/supplierSendLink.ts` (pure logic + expo-linking, unit-tested):

```ts
export interface SendTarget {
  channel: SupplierContactChannel;
  phone: string | null;
}

/** Returns null when channel is share_sheet or phone missing → caller falls back to share sheet. */
export function buildSupplierSendUrl(target: SendTarget, body: string): string | null;
```

- `sms`: handle the iOS/Android body-separator quirk (`sms:+1555...&body=` on iOS,
  `?body=` on Android) — Platform-branched, URL-encode body, preserve newlines.
- `whatsapp`: `whatsapp://send?phone=<digits>&text=<encoded>`.
- Phone normalization: strip spaces/dashes/parens; keep leading `+`.

## Frontend (Claude owns)

- **Supplier contacts editor** in the existing manager settings area: list suppliers,
  edit phone/channel/name/notes inline via `listSupplierContacts`/`updateSupplierContact`.
- **Send All** entry point in the fulfillment confirmation flow
  (`app/(manager)/fulfillment-confirmation.tsx`, data via `buildSupplierConfirmationData`
  / per-supplier drafts / `finalizeSupplierOrder` in `src/store/orderStore.ts`):
  card queue, one card per supplier — full message preview, primary button
  "Send to {supplier}" opens `buildSupplierSendUrl` result (prefer `expo-sms`
  `SMS.composeAsync([phone], body)` for the sms channel — already a dependency, gives a
  completion callback for auto-advance; keep the `sms:` URL as fallback), on
  return/AppState-active auto-advance to next card. Per-card fallbacks: Copy, Share
  sheet (existing path), Skip. Orders archive exactly as today (`finalizeSupplierOrder`
  unchanged).
- No new npm dependencies. Design tokens from `@/theme/design`, haptics via `@/lib/haptics`.

## Non-goals (binding)

No automatic sending, no reply handling, no dashboard UI (Phase 2), no changes to
archive semantics.

## Verification split

- Backend: migration applies on local stack (`supabase start` already running);
  service + URL-builder unit tests; typecheck.
- Frontend: typecheck + jest; screens smoke-testable in iOS simulator.
- Independent verifier agent checks acceptance criteria after merge.

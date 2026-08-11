# Needs David — running ledger (roadmap build, Aug 2026)

Things only David can do. Agents keep building; none of these block later phases.
Each phase also gets a deploy checklist in `docs/deploy/phase-N.md` (staged — nothing
is pushed to production by agents).

## Carry-over from tips launch (production, do whenever)
- [ ] Set Supabase secret `ALLOWED_ORIGINS=https://tips.babytunasystems.com`
- [ ] Rotate seeded entry tokens + PINs from `/manager` (Sushi 4271, Poki 8356 are seeded fixtures)
- [ ] Rename placeholder roster (Maria/Jose/Lena/Tom/Ken)
- [ ] Print QR stickers — ONLY from `tips.babytunasystems.com/manager/qr` (vercel.app URL bakes wrong host)

## Phase gates
- [ ] **Phase 4 go-signal:** tell this session when the two tips chats
      ("Tips entry speaker and QR" / "tips dashboard variants") are merged to main.
      Phase 4 is frozen until then and builds on top of their edge-fn rewrites.

## Small decisions
- [ ] Phase 2b: real App Store link for the `/join/[token]` page (currently a
      `TODO-DAVID` placeholder pointing at https://apps.apple.com/)

## Real-world verification (build is done with fixtures; these prove it)
- [ ] Phase 1: send a real order-day Send All run from a physical iPhone
      (`sms:` deep-link recipient+body quirks can only be proven on-device)
- [ ] Phase 5c: confirm an order-day reminder push lands on a real device
- [ ] Phase 6a/6b: provide ~2 months of real order screenshots for parse accuracy + import
- [ ] Phase 7b: provide a few real supplier invoices (incl. one with a price change)
- [ ] Phase 9b: lay out the Virtual Shelf grid to match the physical shelves

## Final
- [ ] Review `roadmap/integration` branch end-to-end; merging to `main` deploys `web/` via Vercel
- [ ] Run staged deploy checklists in order (`docs/deploy/phase-*.md`)

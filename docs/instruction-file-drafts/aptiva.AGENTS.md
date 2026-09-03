# Aptiva AI Agent Guide

Repository-wide product, safety, and process rules. Global working rules (git, PRs, orchestration, quality, definition of done) live in `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`; this file adds only what is specific to Aptiva. Phase-specific instructions live in the authorized pack under `docs/phases/`.

## Mission

Aptiva AI is an Expo Router React Native app that recommends healthier versions of familiar meals. Current phase state, gates, and history live in `docs/STATUS.md`; do not restate them here.

**An Aptiva account is required.** There is no guest, demo, or offline-recovery entry. When auth is unavailable the honest response is an error and a retry, never a bypass. Recommendation and catalog logic runs locally from the bundled corpus and should degrade gracefully offline, but no unauthenticated path is required to exist. Never invent product behavior to fill a gap.

## Authority and phase discipline

- Read order: `docs/STATUS.md`, then the explicitly authorized phase pack in `docs/phases/`, then the relevant `docs/product/` files. `docs/README.md` is the documentation map.
- Never implement from `docs/archive/`. It is history and evidence only.
- The user must name a phase (or explicitly authorize multi-phase work) before feature implementation begins. Implement only that phase. Never pull later-phase features forward or unlock the next phase because its predecessor passed.
- Never mark a gate complete without repository evidence. When a gate passes, write `docs/archive/phase-reports/PHASE_N_REPORT.md` and update `docs/STATUS.md` per its gate rule.

## Safety and content invariants (release blockers)

- Allergy and diet exclusions are deterministic and fail closed. A record missing the data needed to prove it safe is excluded, never guessed safe.
- Never fabricate nutrition, allergen, certification, source, provenance, or cultural claims. AI-authored recipe content is allowed only in its authorized phase, with explicit provenance and structured validation, and is never presented as a verified fact.
- Only reviewed/safety-complete records (competition path) or versions passing structured validation and publication policy (Phase 7+) may enter recommendations.
- Generative AI never overrides structured eligibility or factual ranking. AI suggestions pass the same deterministic allergen/diet screening as curated data before display.
- Before changing ranking, filters, eligibility, or curated data, read `docs/product/safety-and-ranking.md` and `docs/product/data-and-content.md`.

## Architecture

```text
app/ -> features/ -> domain/ (pure) + infrastructure/ + lib/ -> Supabase / provider API
```

- `app/` routes, params, and screen mounting only. `features/` product behavior per area. `domain/` pure, typed, deterministic logic with no React, UI, network, or platform imports. `infrastructure/` provider adapters behind explicit ports. `lib/` app-wide clients. `data/` curated corpus, taxonomy, substitutions, loaders (reviewed data, never mutated by generated content). `supabase/` migrations, Edge Functions, config, tests. `scripts/` operator harnesses. `tests/` unit, integration, fixtures, e2e.
- Validate all external, persisted, and dataset inputs with zod at the boundary.
- Keep recommendation and safety logic pure, deterministic, and student-explainable.
- The Phase 8 operator catalog (`domain/catalog/`, `infrastructure/catalog/`, private Supabase tables) never mutates the bundled corpus and never feeds recommendations.
- Cross-file details (provider tree, RouteGate, recommendation pipeline, sync engine): `docs/architecture/overview.md`.

## Data, privacy, and security

- The Supabase client uses publishable/anon credentials only. AI provider calls from the client go through the authenticated Edge Function proxy, never with an embedded key.
- Sync consent is granted at sign-up through Terms/Privacy acceptance. Withdrawal lives in Account settings, and withdrawal, expiry, cancellation, and network failure must preserve the local path.
- Preserve owner RLS, immutable recipe versions, append-only audits, and idempotent sync clocks.
- Preview, QA, and fixture data must be clearly named and isolated from curated and production paths.

## Validation

Commands are in `CLAUDE.md`. Aptiva-specific requirements:

- Ranking, filtering, or scoring changes: run `npm run recommendations:harness` and bump `ALGORITHM_CONFIG.version` in `domain/recommendation/config.ts`.
- Eligibility changes: run the safety-invariant tests.
- Cloud schema or RLS work: `npm run supabase:verify` (needs `.env.local`).
- `npm test` inside `.claude/worktrees/` finds zero tests because `testPathIgnorePatterns` excludes `.claude/`. Run from the main checkout or pass explicit file paths.
- Behavior changes require tests, especially safety, eligibility, ranking, and sync. Verify significant UI changes on representative mobile viewports.

## Aptiva-specific orchestration and git rules

- Safety, schema, and ranking contract changes are never parallelized and never delegated without explicit assignment and primary review.
- Worktrees live at `.claude/worktrees/<short-task>/`. One task branch and one PR per cohesive implementation.
- Respect parallel/blocked notes in `docs/STATUS.md` and the active phase pack.
- Ask when phase authorization is unclear or a safety or privacy trade-off is the user's to make.

## References

- `docs/STATUS.md` phase state, gates, current truth
- `docs/phases/` phase packs and copy-ready prompts
- `docs/product/` safety/ranking, data/content, MVP, and platform contracts
- `docs/evidence/` disclosures and competition evidence

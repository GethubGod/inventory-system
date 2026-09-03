# CLAUDE.md

@AGENTS.md

`AGENTS.md` is the authoritative guide. This file adds the mechanical commands and the Claude-specific notes only.

## Commands

Node 22 LTS (`.nvmrc`); `engines` pins `>=22.13 <23`.

```sh
npm run verify        # typecheck + lint + format:check + test; required for substantive changes
npm run typecheck     # tsc --noEmit
npm run lint          # expo lint
npm run format:check  # prettier --check .
npm test              # jest --runInBand (jest-expo preset)
npm run web           # expo start --web; also start / ios / android
```

Focused testing (Jest runs serially by design; sync/storage tests share fake state):

```sh
npm test -- tests/unit/filter.test.ts          # one file
npm test -- -t "excludes unresolved allergen"  # one test by name
npm run test:watch
```

`tests/e2e/maestro/` is excluded from Jest. `tests/e2e/primary-journey.test.ts` is a normal Jest test, not a device run.

Ranking and eligibility work additionally requires:

```sh
npm run recommendations:harness   # replays tests/fixtures/personas.ts through recommendMeals; the diffable artifact for any ranking change
```

Operator scripts read `.env.local` via `--env-file`. Only `dry-run`, `status`, `plan`, and `verify` are read-only; the rest spend provider quota and write private catalog data:

```sh
npm run supabase:verify
npm run catalog:themealdb -- dry-run         # also: import | status | retry-enrichment
npm run catalog:images -- plan               # plan|submit|status|collect|retry|review|sync-bundled|verify|setup-bucket
npm run catalog:backup
npm run catalog:canonical:migrate
```

There is no CI. Local `npm run verify` is the gate.

## Architecture quick reference

Full detail: `docs/architecture/overview.md` (moved from this file). The two things you will get wrong without reading it:

- Provider order in `app/_layout.tsx`, outermost first: `AptivaCatalogProvider > AuthProvider > CommunityRootProvider > ModerationRootProvider > LaunchFlowProvider > LocalProfileProvider > CreationRootProvider > LocalPersonalizationProvider > HybridSyncProvider`, with `<RouteGate />` as a sibling of the `Stack`. Catalog comes before auth so the bundled corpus never waits on network.
- Routing is gated, not linked. `features/launch/RouteGate.tsx` is the single enforcement point. Adding a guarded route means adding its segment to `AUTH_REQUIRED_SEGMENTS`, not just to the `Stack`.

## Conventions

- Import via the `@/*` alias, not deep relative paths.
- TS is strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitOverride`.
- Each `domain/*` area re-exports through its `index.ts`; import from the barrel.
- Styling comes from `constants/tokens.ts` and `constants/layout.ts`. No ad-hoc hex values.
- Tests are named after the phase or module they cover; shared personas and catalog fixtures live in `tests/fixtures/`.

## Claude-specific

- Gate first: confirm the authorized phase in `docs/STATUS.md` before any feature work. If no phase was named, ask.
- Rerun `npm run verify` (plus the harness for ranking changes and safety-invariant tests for eligibility changes) before reporting complete, and confirm the offline path still works.

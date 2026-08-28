# Agent Guide: Smelter iOS App (InventorySystem)

Rules for every agent (Claude, Codex, or other) working in this repo.

## Simulator rules (critical)

This Mac runs a second project (Nellit) with its own booted simulator. Two
simulators are typically booted at once.

- Target device: iPhone 17 Pro Max, iOS 26.2, UDID
  `FCADAB49-3A22-4167-B3EB-F794BEB32D9E`.
- Forbidden device: UDID `7C0CA22A-4895-44BA-BF7E-F53BB5CAF7F8` (Nellit).
  It also carries a stale `com.babytuna.systems` build, so launching there
  looks plausible and produces garbage results.
- NEVER pass `booted` to simctl or any build tool. With two devices booted,
  simctl picks one arbitrarily and exits 0.
- Use `scripts/sim.sh` for all simulator work. It pins the UDID and refuses
  `booted`. Examples:
  - `scripts/sim.sh assert` (run before any test pass; fails if wrong sim)
  - `scripts/sim.sh boot`
  - `scripts/sim.sh launch com.babytuna.systems`
  - `npx expo run:ios --device "$(scripts/sim.sh udid)"`
- Never run `simctl shutdown all`, `erase all`, or quit Simulator.app.
  Those hit both projects.

## Build gotchas

- The repo path contains a space. `expo run:ios` needs 3 quoting patches,
  two of which live in `node_modules` and are lost on reinstall. If an iOS
  build fails oddly after `npm install`, reapply them before debugging.
- Edge functions expect the `sb_publishable_` API key. The legacy anon key
  returns 401 on invite accept. Check the key before filing an auth bug.
- Config sheet sync fails silently on a misspelled column header.

## Validation

- `npm run typecheck`, `npm run lint`, `npm run test:ci`
- Ordering harnesses: `npm run verify:submit-order-rpc`,
  `npm run audit:quick-order-recognition`
- Report exact commands and honest results. A red test is reported red.

## Style

User-facing copy, PR prose, commit messages, and reports: short and
professional. No em-dashes. No filler.

## Concurrency with the other project

Both projects may test their simulators at the same time. That is safe only
while both sides stay headless.

- Drive the simulator headlessly by UDID only: simctl / scripts/sim.sh for
  launch, input injection, and screenshots (`scripts/sim.sh io screenshot ...`
  captures the device framebuffer, not the Mac screen).
- Never use macOS screen control (computer-use: real mouse, keyboard,
  full-screen screenshots) for simulator testing. The Mac GUI is a single
  shared resource; two agents using it at once corrupt each other's runs.
- Run the Expo dev server on a pinned port to avoid colliding with the other
  project's Metro on 8081: `npx expo start --port 8091`.

# David's global rules

These apply in every repo. Each project's AGENTS.md adds repo-specific commands, architecture, and invariants. A project file may tighten these rules but never loosen the git or authorization rules.

## Git and PRs

- No push, PR, merge, deploy, migration, remote database write, or destructive git unless I ask for it in this task. Local commits inside a worktree are fine and expected; commit early so nothing is lost.
- "Open a PR" includes branch, commit, and push. It never includes merge. I merge.
- PRs open ready for review, never draft unless I ask. Validation results or blockers go in the PR body.
- One deliverable per PR. Do not stack PRs; I merge out of order.
- When I say "merge it", merged means gone: confirm the PR merged (`gh pr view <n> --json state,mergedAt`), remove that task's worktree without force, delete the local branch (`git branch -d`; if it was squash-merged and `-d` refuses, confirm the PR shows merged, then `-D`), and `git fetch --prune`. Keep only branches that have an open PR or unmerged work.
- Never bulk-clean or force-remove dirty or unmerged worktrees on your own. If I ask for a cleanup pass, list every branch and worktree you would delete with its PR state and whether it has uncommitted changes, then wait for my go.
- Never revert, stage, or commit another workstream's changes.

## Asking vs doing

- Before building or testing, state in one line which branch you are on and whether it is up to date with `origin/main` (or the PR head I named). Do not switch branches to find out.
- Review and diagnosis requests are read-only. "Don't make changes yet" means analysis plus a proposal section that I confirm.
- Ask 1 to 3 focused questions when the answer changes product behavior, design, data, auth, cost, or is irreversible. Recommend a default. Otherwise state your assumption and proceed. No ceremonial questions.
- Never invent product behavior, placeholder business data, or test results to avoid asking.
- For new screens, redesigns, or architecture changes, give me 3 or 4 options first (one self-contained HTML file for anything visual) with a recommendation. Build only the one I pick, and match the reference exactly.
- When I ask for commands, give me the commands with a one-line explanation each so I can learn them. Do not run them for me unless I say so.

## Orchestration: match the team to the job

- Trivial (a few minutes, one or two files: resize a logo, fix a typo, adjust spacing, rename something): do it yourself, in place. No subagents, no worktree, no plan document, no cross-vendor review.
- Medium (one cohesive change, a handful of files, under an hour): one agent, in a worktree. At most one subagent, and only for a genuinely separable piece such as an investigation or a review.
- Large, or I explicitly ask for orchestration (a phase, a feature that spans frontend and backend, two or more independent workstreams): you are the orchestrator and reviewer. Run 2 to 4 subagents in parallel, each with a bounded objective, exclusive file ownership, and the validation it must run. Agree contracts first, then parallel writes.
- When unsure, start with one agent and scale up only once the work proves to be independent streams. Say in one line which tier you picked.
- Respect any model or effort I name. Otherwise route by kind of work:

| Work | Claude side | Codex side |
|---|---|---|
| Complex implementation, debugging, architecture, UI | Opus | Sol (`gpt-5.6-sol`, xhigh) |
| Mechanical: renames, scaffolding, formatting, docs, searches, boilerplate | Sonnet | Terra (`gpt-5.6-terra`, high) |
| End-to-end testing of the integrated build: simulator runs by UDID, E2E suites, reproduce then verify | Opus | Luna (`gpt-5.6-luna`, max; fall back to xhigh if max is rejected) |
| Adversarial review, and bugs that survived two attempts on one side | Opus reviews Codex work | Sol reviews Claude work |

- Use the Codex side when a second model family adds value (review, independent verification, or a workstream I assigned to Codex) or when I name it. Invoke with the `codex:codex-rescue` agent (`--model`, `--effort`), `/codex:review`, or `/codex:adversarial-review`. Never call `Skill(codex:rescue)`.
- Escalation ladder for a stuck task: Terra or Sonnet → Sol or Opus → the other vendor. Never retry the same failure on the same model with the same approach.
- Stop agents that loop, retry unchanged failures, or drift out of scope. Salvage what is useful and re-dispatch tighter.
- Never trust "done". Read every subagent diff and rerun the checks yourself.

## Reviews

- When asked to review, review only. Return findings with file and line, severity, and a concrete failure scenario. Do not fix in the same breath unless asked.
- Adversarial reviews on auth, RLS, money, migrations, or schema contracts: challenge the design, not just the lines.

## Definition of done

- Medium and large tiers: independent cross-vendor review happened (Codex reviews Claude's work, Claude reviews Codex's work). Say which review ran and on which commit.
- Checks ran locally (typecheck, lint, tests) with exact commands and honest results. A red check is reported red. Never claim an unrun check passed. Do not rely on GitHub Actions.
- For mobile work, the integrated build ran on the iOS simulator by UDID and you tell me what to look for. Never test a mobile app through the browser.
- Fix root causes. Do not report "fixed" until you reproduced the original failure and watched it pass.
- Stop background test runners when you finish.

## Code quality

- Strict TypeScript. `unknown` plus validation over `any`, casts, or `@ts-ignore`.
- Search before creating. Reuse existing components, tokens, hooks, and contracts.
- No debug output, dead code, unexplained TODOs, or new production dependencies without a stated reason.
- Honest loading, empty, error, and offline states. Never fake business data.
- Never put server-only secrets (service-role keys, provider keys) in client bundles such as `EXPO_PUBLIC_*`, logs, or commits.

## How to talk to me

- Short and plain English. Bullets or tables. Lead with the answer. No em-dashes, no emoji.
- When I paste an error: one paragraph on what it means, then fix it.
- Status updates: done / remaining / what to test.
- When context is about to roll over or I ask for a handoff, write a copy-pasteable prompt with decisions, paths, validation state, and the mistakes made so far.
- Do not add guardrails, warning banners, or safety scaffolding I did not ask for.

## This Mac

- If an iOS simulator is already running, do not take it over, shut it down, or reboot it. Boot a second simulator (a different device or UDID) for your work so you do not disrupt another agent testing a different app. Never pass `booted` to simctl; always target a UDID, and use the repo's simulator script if it has one. Never run `simctl shutdown all` or `erase all`.
- In repos whose AGENTS.md says deploys key off the commit author, commit as `GethubGod <164276379+GethubGod@users.noreply.github.com>` (`git -c user.name=GethubGod -c user.email=164276379+GethubGod@users.noreply.github.com commit ...`).

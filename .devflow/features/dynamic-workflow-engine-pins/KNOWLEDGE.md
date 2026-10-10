---
feature: dynamic-workflow-engine-pins
name: Dynamic Workflow Engine Compiled Output and Pins
description: "Use when counting MDS hosts or partials, changing a doctrine literal the suite pins in a dynamic command, or editing .mds sources. Keywords: build-mds.test.ts, DIST_FILES, marker ownership."
category: conventions
directories:
  - src/assets/commands
  - src/assets/commands/_partials
  - dist/commands
  - dist/learning-off/commands
  - scripts/build-mds.ts
  - tests/build-mds.test.ts
  - tests/fixtures/mds-manifest.ts
  - tests/fixtures/numeric-floors.json
  - tests/guards/code-review-diff-gating.test.ts
created: 2026-10-10
updated: 2026-10-10
---

# Dynamic Workflow Engine Compiled Output and Pins

## Rules

- **KB-INV-1** Five rosters count five different sets, never conflated: `MDS_COMMAND_HOSTS`, `MDS_PARTIALS`, `ALL_MDS_PARTIALS`, `ALL_DISCOVERED_HOSTS`, `ALL_MDS_HOSTS` (plus `DIST_COMMAND_FILES`, the same roster as the command hosts seen from the output side). Derive every count from `tests/fixtures/mds-manifest.ts`; never pin a bare literal.
- **KB-INV-2** Compilation-scope guards use `COMMAND_HOSTS` or `ALL_DISCOVERED_HOSTS`; deployed-behaviour guards (gh-issue scope, compliance gate, retired wording, marker-literal ownership) use `DIST_FILES`.
- **KB-INV-3** The suite reads compiled `dist/commands/dynamic-build.md` for exact doctrine strings; changing a doctrine literal in a partial breaks its pin by design, so change doctrine and pin together.
- **KB-INV-4** Simplify and Scrutinize are each spawned exactly twice in dynamic-build (Gate 1 #1 and Gate 1 #2 only), and the review pass appears once: the single-pass literals are present and the delta-review, cycle-loop and `maxCycles`-style tokens are absent.
- **KB-INV-5** `/dynamic-build` is outside `/code-review`'s diff-class work: `_engine.mds`, `dynamic-build.mds`, `_wave.mds` and the compiled command carry no `DIFF_FILE`, `DIFF_CLASS`, `diff*.patch` name, docs-only, tests-only or lockfile-only reduced set, installed-language stamp or `stamp-gated` row.
- **KB-INV-6** `--dry-run` appears in compiled dynamic-profile only, never in dynamic-build, dynamic-plan or dynamic-tickets.
- **KB-INV-7** No compiled command contains a `<!-- devflow:` marker literal: the Git-agent operation owns its marker format, and a caller says only that the Git agent deduplicates via its own marker.
- **KB-INV-8** No `gh issue` invocation or descriptive mention appears in a dist command outside a Git spawn fence. The only allowlisted exceptions are `gh pr view` PR-description fetches in code-review, bug-analysis and resolve (`GH_PR_VIEW_EXCEPTION_FILES`), plus release's local `.devflow/conventions.md` read, which involves no `gh`.
- **KB-INV-9** `_partials/` is flat. Partials declare no `output-dir:`; hosts declare it as the last frontmatter key with no non-blank line after it inside the `---` block; the build fails if the `dist/` parent does not exist.
- **KB-INV-10** In `.mds`, literal `{...}` (such as `{ISSUE_REF}`) is plain text and only `{{name}}` / `{{helper()}}` interpolate; there is no `\{` escape (it ships its backslash), `${...}` is literal everywhere, and every fence kind is passthrough.
- **KB-INV-11** Removed or renamed doctrine leaves only its end-state in compiled output and in this KB: no tombstone comments, no `*_old` names, no guards for now-impossible states.
- **KB-AP-1** Never restate a Git-agent dedup marker literal in a caller command (dynamic-build, code-review): two copies that must match exactly diverged once and produced duplicate comments.
- **KB-AP-2** Never accept a guard that finds nothing: every guard needs a non-empty-target assertion (a scanned-file counter) and a known-bad probe seeded in a temp copy, never in the committed tree.
- **KB-AP-3** Never weaken an occurrence-equality pin to `toContain`: a moved, duplicated and removed rendering must each fail differently.
- **KB-AP-4** Never read the marker negative guard alone as a deletion guard: it is a relocation guard, and its positive arm keeps the literals alive in the Git agent's sink corpus.
- **KB-AP-5** Never run `npm run build:cli` expecting installable commands, agents or learning-off variants: only `npm run build:mds` writes them.
- **KB-AP-6** Never loosen an exception with a wider regex: recorded exceptions are explicit file sets.

## Overview

The dynamic commands are compiled MDS hosts, and the test suite pins their compiled text. This KB covers the build-side facts a dynamic-command author trips over: which host/partial number counts what, which doctrine literals the suite pins, who owns a dedup marker, which `gh` exceptions are deliberate, and the `.mds` authoring gotchas. It owns the count rule: the `feature-knowledge-system` and `tracker-references` KBs point here rather than restating it, so there is one place to correct when a roster moves.

It does not own the MDS build pipeline itself (discovery, destination validation, frontmatter stripping, the reference-module host kind), which is `feature-knowledge-system`, nor the tracker/git reference-module split and byte-budget guards (`tracker-references`). Engine doctrine is in `.devflow/features/dynamic-workflow-engine/KNOWLEDGE.md`, WAVE mode in `.devflow/features/dynamic-workflow-engine-waves/KNOWLEDGE.md`, and the settings, decisions, learning-arm and tracker-vocabulary contracts in `.devflow/features/dynamic-workflow-engine-contracts/KNOWLEDGE.md`.

## Compiled output: the count rule

Read `tests/fixtures/mds-manifest.ts` for the canonical rosters; every count is derived from it, not pinned as a bare literal. The same manifest names `TRACKER_PARTIAL_ADOPTERS`, `SETTINGS_BLOCK_HOSTS` and `SETTINGS_BLOCK_HOSTS_LEARNING_OFF`.

| Constant | The set it counts | Why it differs from the others |
|---|---|---|
| `COMMAND_HOSTS` (`MDS_COMMAND_HOSTS`) | Command hosts under `src/assets/commands/`: the knowledge hosts, the four dynamic hosts and `release`, compiled into `dist/commands/` | Excludes the generator hosts (`src/assets/agents/*.mds`) and the reference modules |
| `MDS_PARTIALS` | Partials in `src/assets/commands/_partials/` (flat) | Not the whole partial roster: `ALL_MDS_PARTIALS` adds `src/assets/mds/tracker/_common.mds` and `_steps.mds`, the two partials outside `_partials/`. It is the number the build prints as `"N partial(s) skipped (no output-dir:)"`; floors rise with the roster, never fall |
| `ALL_DISCOVERED_HOSTS` | Every `output-dir:`-declaring source the build discovers: the command hosts, the generator hosts (`MDS_GENERATOR_HOSTS`: the agents `code`, `design`, `diagnose`, `git`, `knowledge`, `research`, `review`, `scrutinize`, `skim`, `triage`) and the reference modules (`MDS_REFERENCE_MODULES`: `tracker/_github.mds`, `_jira.mds`, `_linear.mds`, `_mcp.mds`, `_contract.mds`, `git/_pr.mds`, `git/_references.mds` under `src/assets/mds/`) | The number the build prints as `"N host(s) to compile:"`. The reference-module host kind is owned by `feature-knowledge-system` |
| `ALL_MDS_HOSTS` | The command hosts plus the generator hosts: every host whose basename becomes an output filename | Reference modules are excluded: their filenames come from an operation registry (`src/core/mds-variants.ts`), and `_github` would not even pass `validateOutputName` |
| `DIST_COMMAND_FILES` (`DIST_FILES`) | The compiled command outputs, one per command host | Every command is a compiled host, so no file in `dist/commands/` is copied rather than compiled |

`DIST_COMMAND_FILES` and `COMMAND_HOSTS` share a length because they are the same roster seen from two ends (hosts in, files out). `ALL_MDS_HOSTS` adds the agents the build writes to `dist/agents/`, and `ALL_DISCOVERED_HOSTS` is total build-time discovery across all three host kinds. `numeric-floors.json` registers `partial-count` as a floor on `ALL_MDS_PARTIALS`, and `dist-host-count` and `dist-files-count` on the command-host roster (`dist-files-count` is spelled at several sites, including the marker negative guard, which asserts both the built file count and its own scanned counter). The learning-off tree is a separate roster, `LEARNING_VARIANT_HOSTS`: every command host plus the agent hosts that carry an arm (every generator host but `git`), one `dist/learning-off/` file per entry.

## What the suite pins

`tests/build-mds.test.ts` reads the compiled `dist/commands/dynamic-build.md` and greps exact doctrine strings:

- `agentType: "Simplify"` and `agentType: "Scrutinize"` each spawned exactly twice (Gate 1 #1 and Gate 1 #2 only).
- **Single-pass review.** Present: `The review pass runs exactly ONCE`, `The pass runs exactly ONCE`, `Never author additional cycles or a delta re-review of fix commits` (engine invariant 7, unique), `Budget scales roster and verification votes, NEVER the number of passes` (review_pass prose, unique). Absent: `DELTA REVIEW`, `reviewBaseSha`, `preFixSha`, `maxCycles`, `cyclesRun`, `fixedInCycle`, `allCoverageGaps`, `for (let cycle` (skeleton guard), `review_loop`, `/review[- ]loop/i`.
- Also present: `reviewed: true`, `coverageGaps.length === 0`, `FAIL-FIXED`, `ALWAYS ready`, `Cheapest-sufficient validation`, `One build gate per phase`, `Never wrap a build or test command in`, `never poll across turns`, `Gate 1 #2`, `gate1-final`, and `No unauthorized tracker or remote side-effects` (engine invariant 6, neutralised from GitHub-bound wording; a grep guard over the compiled dynamic hosts is non-vacuous against the old literal).
- **Post-wave-report block.** `OPERATION: post-wave-report`, `TRACKING_ISSUE:`, `WAVE_REPORT_PATH: .devflow/docs/waves/`, `WAVE_ID:`, `WORKTREE_PATH:`, `skip this step entirely in SINGLE mode`, `TRACEABILITY: DEGRADED (no tracking issue for this run)`. The wave-report marker literal is deliberately not pinned caller-side (see below).
- **`meta.phases` agrees with `phase()` calls:** the SINGLE-mode phases array matches every `phase("...",` call site (a structural check, not a literal pin).
- `--dry-run` absent from build, plan and tickets, present only in dynamic-profile.
- **No diff-class gating in dynamic-build** (`tests/guards/code-review-diff-gating.test.ts`, its /dynamic-build exclusion block); known-bad probes seed `DIFF_FILE` and the language stamp into the engine and expect them reported.
- Declared receivers and Code keys are pinned by `tests/decisions/decisions-seam.test.ts` (see the contracts KB).
- The gate rows, the Running commands block parity and the bind-once input have their own guards (see the hub KB and the contracts KB).

## Dedup-marker ownership: `<!-- devflow:` absent from every dist command

The operation owns its marker format. A caller that restates the literal is a second authority on a string whose two copies must match exactly for dedup to work, and they diverged once, producing duplicate comments. `dynamic-build.mds` says only "the Git agent deduplicates via its own marker" in its post-wave-report prose, and passes `WAVE_ID`; `code-review.mds` makes the same disposition for `<!-- devflow:review-summary`. The caller-side literal was removed outright, not commented as "no longer restated here".

`tests/build-mds.test.ts` section 23 is a two-sided guard: (1) a negative scan of every `DIST_FILES` entry proves no `<!-- devflow:` literal survives in any compiled command, non-vacuous through its scanned-file counter and backed by a seeded-restatement probe in a temp copy; (2) a positive arm proves the marker literals (`<!-- devflow:review-summary`, `<!-- devflow:resolution-summary`, `<!-- devflow:wave-report`) still live in the Git agent's sink corpus (`gitAgentSinkCorpus()`). Without the positive arm, deleting dedup everywhere would turn the negative guard green for the wrong reason (KB-AP-4).

## Deliberate exceptions to the gh-issue scope guard

`tests/build-mds.test.ts` section 21 (AC-0.4) bars `gh issue` invocations or descriptive mentions from deployed commands outside Git spawn fences, scanning every `DIST_FILES` entry with explicit allowlists rather than a loosened regex.

- **`gh pr view` at three prose sites**: `code-review.md`, `bug-analysis.md` and `resolve.md` each fetch a PR description via `gh pr view {pr_number}` in a bash prose block, not inside a Git spawn fence. This is an explicit PR-hosting exception: `gh pr` is not `gh issue`, and fetching the PR body for display is unrelated to the issue-routing contract. It is encoded in `GH_PR_VIEW_EXCEPTION_FILES`.
- **`release.mds` conventions read**: the `**Conventions naming:**` paragraph tells the release orchestrator to consult `.devflow/conventions.md` directly for version, tag and version-PR naming (a local file, not a GitHub API call). It does not route through the Git agent and involves no `gh` CLI, so it is exempt by definition. It is recorded here so a future guard author does not flag it as an oversight.

## `.mds` authoring gotchas

- **Flat `_partials/`.** No subdirectories at any depth: a nested partial would be invisible to any flat reader (`tests/build-mds.test.ts` "commands/_partials/ is flat", with a seeded known-bad nested-partial probe). Partials declare no `output-dir:`; hosts declare it as the LAST frontmatter key, and no non-blank line may follow it inside the block.
- **Braces and templates.** Under `@mdscript/mds` 0.4.4 literal `{...}` is plain text and only `{{name}}` / `{{helper()}}` interpolate. There is no `\{` escape, so a backslash ships verbatim (caught by the backslash-leak guard). `${...}` is literal text in prose and inside a `js` fence alike. Every fence kind (column-0, indented, tilde, blockquote) is passthrough, so nothing in a fence is interpolated.
- **Which build.** `npm run build:mds` compiles command hosts, agent generator hosts and reference modules, and writes `dist/learning-off/` alongside; `npm run build:cli` produces none of them (KB-AP-5). Rebuild after editing any `.mds`.

## Guard patterns

- **Named collector plus seeded probe.** `tests/dynamic/depends-on-grammar.test.ts` and `tests/build-mds.test.ts` sections 22 and 23 share one shape: a named collector backs each assertion, and a known-bad probe seeded in a temp copy proves the collector discriminates rather than passing vacuously (the test-harness KB owns the shape).
- **A green test proves nothing unless it exercised a non-empty target.** The scanned-file counters and probe arms exist for exactly this (KB-AP-2).
- **A guard that finds nothing, or a doctrine string that reads clean, proves only the weakest reading of its matcher, corpus and predicate.** The round-refresh guard (contracts KB) checks a capability noun against the Git agent's live roster instead of trusting the string.

## Anti-Patterns

**KB-AP-1.** The Git agent's marker is the format authority; the caller passes `WAVE_ID` or its equivalent and never the literal. Two copies must match byte for byte for dedup to find the earlier comment.

**KB-AP-3.** The rendering battery uses `== 1` occurrence counts against the deployed dist files; `toContain` would stay green for a duplicated or relocated rendering.

**KB-AP-6.** The recorded exceptions are file sets (`GH_PR_VIEW_EXCEPTION_FILES`); adding a new `gh pr` site means adding its file, with its reason, to the set.

## Key Files

- `tests/build-mds.test.ts`: doctrine-literal pinning (sections for single-pass review, post-wave-report, `--dry-run` removal, gh-issue scope, `_tracker.mds` adoption, marker ownership).
- `tests/fixtures/mds-manifest.ts`: the shared name manifest: `MDS_COMMAND_HOSTS`, `MDS_GENERATOR_HOSTS`, `MDS_PARTIALS`, `MDS_REFERENCE_PARTIALS`, `ALL_MDS_PARTIALS`, `MDS_REFERENCE_MODULES`, `LEARNING_VARIANT_HOSTS`, `DIST_COMMAND_FILES`, `ALL_MDS_HOSTS`, `ALL_DISCOVERED_HOSTS`.
- `tests/fixtures/numeric-floors.json`: the ratchet manifest (`partial-count`, `dist-host-count`, `dist-files-count`, `arguments-once-max`, `gate-ownership-body-count`, `running-commands-site-count`, `issue-pr-link-forwarding-sites`); floors raise, ceilings lower.
- `tests/guards/code-review-diff-gating.test.ts`: beside `/code-review`'s diff-class gating, the block that holds the engine, wave and dynamic-build sources free of any gating token.
- `scripts/build-mds.ts`: the unified MDS compiler for all three host kinds (command hosts to `dist/commands/`, generator hosts to `dist/agents/`, reference modules to `dist/skills/git/references/`).
- `src/core/mds-variants.ts`: the operation registries that name reference-module output files.
- `src/assets/commands/*.mds`: the command hosts; `src/assets/commands/_partials/*.mds`: the flat partial directory.

## Related

- `.devflow/features/dynamic-workflow-engine/KNOWLEDGE.md`: the engine doctrine these literals pin.
- `.devflow/features/dynamic-workflow-engine-waves/KNOWLEDGE.md`: the wave doctrine behind the post-wave-report pins.
- `.devflow/features/dynamic-workflow-engine-contracts/KNOWLEDGE.md`: the contracts whose compiled text `build-mds.test.ts` also pins (tracker adoption in section 22).
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md`: the MDS build pipeline, discovery, destination validation, the reference-module host kind and the knowledge host commands that share the compile infrastructure with the dynamic commands.
- `.devflow/features/tracker-references/KNOWLEDGE.md`: the tracker/git reference-module split and the byte-budget guards.
- `.devflow/features/test-harness/KNOWLEDGE.md`: the named-collector, seeded-probe and ratchet-manifest guard shape, and the known full-suite-load timeouts.

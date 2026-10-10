---
feature: learning-capture-system
name: Learning capture system
description: "Use when changing the capture hooks, memory/learning queues, machine feature switches or ledger root, or choosing which learning KB to read. Keywords: capture-prompt, queue-append, manifest.json, DF_LEDGER_ROOT."
category: architecture
directories:
  - src/assets/scripts/hooks
  - src/assets/agents/learning.md
  - src/assets/agents/tracker.md
  - src/assets/agents/skim.mds
  - src/assets/commands/_partials/_decisions.mds
  - src/assets/skills/apply-decisions/SKILL.md
  - src/cli/commands/learning.ts
  - src/cli/commands/memory.ts
  - src/cli/commands/knowledge
  - src/targets/claude-code/learning-install.ts
  - src/core/learning-variants.ts
  - src/core/learning-store.ts
  - src/core/observations.ts
  - src/core/feature-switch.ts
  - src/core/feature-config.ts
  - src/core/learning-tuning-config.ts
  - src/core/learning-queue-cleanup.ts
  - src/core/linked-path.ts
  - src/core/queue-drain.ts
  - src/core/project-paths.ts
  - src/hud/components/learning-counts.ts
created: 2026-07-15
updated: 2026-10-10
---

# Learning Capture System

## Rules

- **KB-INV-1** Ledger IDs (the ADR and PF numbers) stay on the machine: anything committed, pushed or posted states a rule in words, never by its number; `tests/guards/no-ledger-citations.test.ts` enforces the committed half.
- **KB-INV-2** Plumbing never judges: hooks capture and trigger, the Learning agent decides what is a decision, a pitfall or still true, and plumbing validates, numbers, locks, projects and renders.
- **KB-INV-3** Content identifiers keep their "decisions" names (`decisions-*.jsonl`, `DECISIONS_CONTEXT`, `decisions_load()`, `render-decisions.cjs`) while the directory is `learning/`, the switch `features.learning` and the agent `Learning`; never "fix" the mismatch.
- **KB-INV-4** `features.memory|learning|knowledge` in `~/.devflow/manifest.json` is the MACHINE switch; a repository can only turn a feature OFF, by a literal `false` in `project.json` or `config.json` `features.<name>`, and the retired top-level keys (`RETIRED_CONFIG_KEYS`) never narrow.
- **KB-INV-5** Only an explicit boolean `false` switches a feature off (an absent manifest, `features` object or key, or a non-boolean, reads ON), by `isMachineFeatureOn` and `queue_read_gates` alike; neither is built on `readManifest()`.
- **KB-INV-6** A feature reads its current key when boolean, else its legacy key (`learning` from `decisions`, `knowledge` from `kb`) when boolean, else ON; `queue_read_gates` mirrors this for learning only.
- **KB-INV-7** Hooks resolve roots from git, never from cwd: learning turns append under `DF_LEDGER_ROOT` (the main worktree), memory under `DF_ROOT`; the CLI and HUD twin is `getLedgerRoot` (parity pinned by `tests/core/ledger-root.test.ts`), and memory is never resolved that way.
- **KB-INV-8** The three capture hooks only append (no scanner runs, no worker starts), and each runs the `DEVFLOW_BG_UPDATER=1` re-entrancy guard before `hook-bootstrap`, so the memory worker's own `claude -p` session is never captured.
- **KB-INV-9** A queue row is JSONL built by `jq` or `node JSON.stringify`, never string concatenation; the append is lock-free by design and only overflow truncation takes the queue lock.
- **KB-INV-10** A hook is devflow's only when its command ENDS in `/scripts/hooks/run-hook <marker>` (`devflowHookOwner`); earlier endings live in `LEGACY_HOOK_SUFFIXES`, are removed on each converge and are never counted as current.
- **KB-INV-11** `drainDisabledFeatureQueues` drains only AFTER the manifest write lands, and `--hud-only` re-init keeps every recorded manifest value and changes only `features.hud`.
- **KB-INV-12** `.devflow/config.json` keeps one non-boolean field, `tracker`, read by `parseTrackerOverride` (TS) and `resolve-settings.cjs` (`parsePersonalBytes`), which must agree (`tests/seams/tracker-key-path.test.ts`).
- **KB-INV-13** Every loop and read in this area has a bound, each a named constant (see Constraints), and the shell cap on hook log folders is pinned equal to the TS `MAX_HOOK_LOG_DIRS`.
- **KB-INV-14** `writeMachineFeature` (`src/core/feature-switch.ts`, `D-NOOP-TOGGLE`) skips the write when the stored boolean already equals the request, so a no-op `devflow memory|learning|knowledge --enable/--disable` leaves `manifest.json` byte-identical and `updatedAt` unmoved; it is the one write point of all three.
- **KB-AP-1** Reading feature flags with two separate calls: `queue_read_gates` is one fork. Never read or write top-level `.devflow/config.json` keys for on/off state, omit `<root>` from a `queue_read_gates` call, or resolve the manifest from the project root (the gate then fails open).
- **KB-AP-2** Consuming `config.tracker` raw instead of through `parseTrackerOverride` or `parsePersonalBytes`.
- **KB-AP-3** Omitting the `DEVFLOW_BG_UPDATER=1` guard from a capture hook.
- **KB-AP-4** Seeding a learning queue for a worktree session under the session's own root: in a linked worktree the learning queue is the main worktree's.
- **KB-AP-5** Draining a switched-off feature's queues before the manifest write lands: a session still reading "on" appends turns that survive the disable.
- **KB-AP-6** Reading a `.devflow` data file with `cat` or `head` where exactness matters: a shell rewrite hook can truncate it, announced only on stderr; use the Read tool.

## Overview

Three always-on hooks capture conversation turns into two independently gated JSONL queues, and two processors drain them. The **memory queue** (`.devflow/memory/.pending-turns.jsonl`) is drained by the detached `background-memory-update` worker, started by `memory-worker` on a throttle. The **learning queue** (`.devflow/learning/.pending-turns.jsonl`) is drained by the **Learning agent**, a background subagent that `session-start-context` tells the main model to spawn whenever turns are pending. Scripts capture and trigger only. The agent makes every judgment (is this a decision or a pitfall, is that entry still true); plumbing does the rest: validate, number, lock, project, render.

**Ledger IDs stay on the machine.** The ledger is gitignored and numbered per machine, so an ADR or PF number resolves on no other clone and numbers get reused. Anything committed, pushed or posted (code, docs, this KB, commit messages, PR text) states the rule in words; IDs live only in a session's reasoning, handoffs and reports. An observation's title, rule and why may not name an entry either (the op refuses).

This area is large, so it is split into a hub (this file) and five focused KBs:

| KB | Read it for |
|---|---|
| `.devflow/features/learning-capture-system-store/KNOWLEDGE.md` | The store module as single schema authority: observations and ledger rows, validation, the `json-helper` learning ops, the one lock, rendering of `decisions.md`, `pitfalls.md` and `index.md` |
| `.devflow/features/learning-capture-system-agent/KNOWLEDGE.md` | The Learning agent, the owned queue claim and heartbeat, the `session-start-context` directives (maintenance, tracker setup), the `devflow learning` CLI, the TS seam and HUD counts |
| `.devflow/features/learning-capture-system-delivery/KNOWLEDGE.md` | How decisions reach agents (`DECISIONS_CONTEXT`, the defines, the pass rule), the learning-on and learning-off prompt variants and the converge |
| `.devflow/features/learning-capture-system-links/KNOWLEDGE.md` | The rule that nothing writes, renames or reads through a symbolic link under a project's `.devflow/`, and the safe-create and mode rules |
| `.devflow/features/learning-capture-system-memory-worker/KNOWLEDGE.md` | The memory worker, its model, effort and argv, the pre-compact backup and the jq-less JSON fallback |

This hub holds what they share: the data files and the naming boundary, the machine feature switches, roots, the capture hooks and queues, hook ownership and logs, the bounds, and the table of D-series names with the KB that records each.

## System Context

### Data files and the naming boundary

| File in `.devflow/learning/` | Holds |
|---|---|
| `decisions-log.jsonl` | observations, the content authority |
| `decisions-ledger.jsonl` | entries: projections of log rows plus ledger-owned fields |
| `decisions-log.archive.jsonl` | observations rotated out of the log |
| `decisions-history.jsonl` | the last `HISTORY_DEPTH` prior versions of each rewritten observation and its entries |
| `*.rejected.jsonl` | malformed lines a writer moved aside before rewriting a file |
| `*.pre-v2.jsonl` | one-time copies of the log, ledger and archive made before the first v2 write to a v1 tree |
| `decisions.md`, `pitfalls.md`, `index.md` | generated from the ledger, never hand-edited |
| `.decisions.lock/` | the one learning lock |
| `.pending-turns.jsonl`, `.pending-turns.processing`, `.pending-turns.owner` | the queue, the claimed batch, its owner's token |
| `learning.json` | agent tuning `{model, debug}`; the project file overrides `~/.devflow/learning.json`, and for the model a `devflow agents` Learning mapping outranks the global file (see the agent KB) |

Content identifiers keep their "decisions" names although the system is "learning": `decisions-*.jsonl`, `decisions_status`, `DECISIONS_CONTEXT`, `decisions_load()`, `render-decisions.cjs`, `decisions-format.cjs`, ADR/PF numbers. The directory is `learning/`, the switch `features.learning`, the agent `Learning`. Do not "fix" the mismatch.

### Feature switches: machine switch, repository narrows (D-FEATURES-NARROW-ONLY)

`features.memory|learning|knowledge` in `~/.devflow/manifest.json` is the MACHINE switch; `devflow init` and `devflow memory|learning|knowledge --enable/--disable` write it (the toggles through `writeMachineFeature`, which writes nothing when the stored boolean already equals the request: KB-INV-14). A repository can only turn a feature OFF: effective = machine AND `.devflow/project.json` `features.<name>` (team, committed) AND `.devflow/config.json` `features.<name>` (personal), where only a literal `false` narrows. The retired top-level keys (`RETIRED_CONFIG_KEYS`: memory, learning, knowledge, decisions, autoCommit) never narrow and are dropped on the next managed write, so no repository can keep a feature running that the machine switched off. Readers:

- `resolve-settings.cjs` folds all three layers into the `MEMORY=`/`LEARNING=`/`KNOWLEDGE=` settings line, which the knowledge write-back gate consumes.
- The shell hooks call `queue_read_gates <manifest_path> <root>` (memory and learning only; every caller passes `$PROJECT_ROOT`).
- The CLI's `--status` calls `readMachineFeature`, plus `Effective here: disabled (<file>)` when a repository file narrows.
- The installer reads the MACHINE value alone, to pick which compiled prompt variant to install (D-LEARNING-VARIANT-INSTALL, in the delivery KB): `devflow init` passes its settled value and `devflow learning --enable/--disable` passes the value it just wrote. A repository's narrowing never changes an installed file, which is why the learning-on variants keep the run-time `LEARNING` gate.

Rules: **D-GATES-FAST-PATH**: each repository file gets a bounded builtin read (`read -r -d '' -n`, one byte past the limit so a cut-short read shows); a cut-short read (NUL, or over the limit) is invalid and narrows nothing; text with no `\u` and no `"features"…{…"memory|learning"…false` sequence cannot narrow, so zero forks. Otherwise exactly ONE `node` fork runs `resolve-settings.cjs`'s `readRepoLayers` + `foldSettings`, so every file rule (symlink, size, BOM, UTF-8, duplicate keys) is the parser's. **D-FEATURES-ABSENT-ON**: only an explicit boolean `false` switches off; an absent manifest, `features` object or key, or a non-boolean, reads ON. `isMachineFeatureOn(rawManifest, feature)` is the pure predicate and `queue_read_gates` applies the identical rule; neither is built on `readManifest()`, which returns null for a manifest missing required fields and heals writes back to disk. **Legacy keys**: a feature reads its current key when boolean, else its legacy key (`learning` from `decisions`, `knowledge` from `kb`) when boolean, else ON; `queue_read_gates` mirrors it for learning only. `writeMachineFeature` writes ONLY `features.<feature>` and `updatedAt` and answers `{ok:false, error:'not-installed'}` when no manifest exists.

`.devflow/config.json` keeps one non-boolean field, `tracker` (the per-repo provider override), read by `parseTrackerOverride` (TS) and `resolve-settings.cjs` (`parsePersonalBytes`); both must agree (`tests/seams/tracker-key-path.test.ts`). Never consume `config.tracker` raw.

### Roots and gates (D-HOOKS-GIT-ONLY, D-LEDGER-MAIN-WORKTREE)

Hooks resolve roots from git, never from cwd. `df_resolve_roots` (`resolve-project-root`) makes ONE `git rev-parse --path-format=absolute --show-toplevel --git-common-dir` call and sets `DF_ROOT` (the checkout toplevel: memory, carve-out, KBs) and `DF_LEDGER_ROOT` (the main worktree when its `.devflow/` exists and it is not HOME, else `DF_ROOT`). The capture hooks append learning turns under `DF_LEDGER_ROOT`; memory stays at `DF_ROOT`. `ensure-devflow-init` scaffolds `learning/` only where the ledger lives; the capture hooks and `session-start-context` (healing an older install) create it at the ledger root. `df_is_project_root` (a `.git` entry AT the root, physical path not HOME's, D-HOOKS-TOPLEVEL-ONLY) gates per-project work, so memory and learning stop together outside git. The CLI/HUD twin is `getLedgerRoot` (`src/core/ledger-root.ts`, parity pinned by `tests/core/ledger-root.test.ts`); memory is never resolved that way.

## Component Interactions

### Capture hooks and the queues

All three hooks (`capture-prompt`, `capture-turn`, `capture-question`) source `queue-append` and call `queue_append_both`, handing each queue the root it lies below (`$PROJECT_ROOT` for memory, `$LEDGER_ROOT` for learning; they differ in a linked worktree) and gating each write by `_QG_MEMORY` / `_QG_LEARNING` from one `queue_read_gates "$DEVFLOW_MANIFEST" "$PROJECT_ROOT"` call (at most one fork per invocation, none when the fast paths settle it; `$DEVFLOW_MANIFEST` is `$HOME/.devflow/manifest.json`, D-ONE-HOME). They only append: no scanner runs and no background worker starts. In order:

1. The `DEVFLOW_BG_UPDATER=1` re-entrancy guard, before `hook-bootstrap`, so the memory worker's own `claude -p` session is never captured.
2. The one gate fork.
3. `ensure-devflow-init`, whose non-zero return ends the hook, as it does for a `.devflow` that is a symbolic link.
4. In `queue_append_row`, `df_no_symlink_below <root> <queue>` (D-HOOKS-NO-SYMLINK): a queue, or a folder between its root and it, that is a link skips the append, logs `Queue skipped: a symbolic link sits on the path to <queue>; nothing written` and returns 0, and only a clear path gets `mkdir -p` of its folder (the hook bodies create no queue folder themselves; `queue-append` sources `git-marker` itself, and a failed source is a command not found, which is the refusing branch).
5. JSONL append via `jq` or `node JSON.stringify`, never string concatenation, `umask 077`, lock-free by design.
6. Overflow guard: a queue over its line bound is truncated to the newest rows under `learning_lock_acquire "<queue>.lock"` (`QUEUE_LOCK_TIMEOUT_MS` wait, `QUEUE_LOCK_STALE_MS` stale). The copy is created under the safe-create and mode rules of the links KB, so both queues keep mode 0600 through a trim.

`capture-question` emits one `qa` row per answered question, joining `cwd` and field with ASCII SOH.

| What | File | Contains |
|---|---|---|
| Feature on/off | `~/.devflow/manifest.json` | `{features: {memory, learning, knowledge, …}}` |
| Team narrowing and facts | `.devflow/project.json` (committed, never devflow-written) | `{version, evidence, compliance, tracker, reviewPublication, features}`; `reviewPublication` only lowers |
| Personal per-repo facts | `.devflow/config.json` | `{reviewPublication, tracker?, features?}` |
| Agent tuning | `.devflow/learning/learning.json`, then (for the model only) the `devflow agents` Learning mapping in `~/.devflow/agent-models.json`, then `~/.devflow/learning.json` | `{model, debug}` |

### Hook ownership, init and logs

- **D-EXACT-HOOK-OWNER**: a hook is devflow's only when its command ENDS in `/scripts/hooks/run-hook <marker>` (`devflowHookOwner` in `src/targets/claude-code/hooks.ts`); `removeHooks` takes single hooks out of a matcher group. `memory.ts`'s `LEGACY_HOOK_SUFFIXES` names every earlier ending, removed on each converge and never counted as current. `devflow memory --enable/--disable` converges Stop/SessionStart/PreCompact (the settings transform runs FIRST, so the switch is not recorded unless the hooks can follow); `devflow knowledge` is a thin `handleToggle` router (KBs are written only by `knowledge_writeback`).
- **D-INIT-DRAIN-AFTER-SWITCH**: `drainDisabledFeatureQueues` drains this repo's queues for each feature `init` switched off, only AFTER the manifest write lands (draining first leaves a window where a session still reading "on" appends turns that survive the disable), and it returns one warning for each drain a linked folder refused (D-CLI-NO-SYMLINK), which `init` prints. **D-HUD-ONLY-PRESERVE**: `--hud-only` re-init keeps every recorded manifest value and changes only `features.hud`.
- **D-LOG-DIR-CAP**: hooks log under `~/.devflow/logs/<cwd-slug>/`; `devflow init` prunes to `MAX_HOOK_LOG_DIRS` (`src/core/hook-log-dirs.ts`, oldest first, with a scan bound) and `log-paths`' `devflow_log_dir` prunes only when it creates a folder (one `ls -1At`, a bounded removal count, bash 3.2); the shell cap is pinned equal to the TS one.

### Integration points

- **git**: `ls-files` (scope matching, the cited-number scan), `rev-parse` (roots, verify ref), `cat-file blob` (the Encoded quote); the store makes its calls through its `git()` wrapper, whose body prepends the fsmonitor override; the agent reads files at the ref with `git show`.
- **Install**: the store, renderer, formatter, `mkdir-lock`, `safe-path` and `json-helper` install under `~/.devflow/scripts/hooks/` (the install goldens list each), and `core/observations.js` rides with the HUD. A prompt that names an op needs that op in the installed copy. The learning-off variants ride in the package under `dist/learning-off/` and are what a learning-off machine installs in place of the on files; the `devflow:apply-decisions` skill installs on a learning-on machine only.
- **Claude Code**: SessionStart `additionalContext` carries Sections 1 to 5 (Section 6 is a top-level `systemMessage`); the Learning and Tracker agents are spawned from directives, never from commands; hooks of one event run in parallel.
- **Docs**: `docs/reference/hooks.md` (the Learning pipeline), `docs/reference/file-organization.md` (the data-file table and ops), `docs/cli-reference.md` (the `devflow learning` flags) describe this area.

## Constraints

Every loop and read has a bound, each a named constant: in the store `E4_MAX_SKIPS`, `CITED_SCAN_MAX_ENTRIES`, `CITED_SCAN_MAX_FILE_BYTES`, `DUE` (entries and byte budget), `HISTORY_DEPTH`, `GIT_TIMEOUT_MS` and `GIT_MAX_BUFFER`, the stdin cap in `readStdinJson`, and the lock waits (`LOCK_ACQUIRE_TIMEOUT_MS`, the queue lock's `QUEUE_LOCK_TIMEOUT_MS`, the CLI's `LOCK_WAIT_MS`); in the hooks the queue line bounds, `MEMORY_READ_LIMIT`, `DEVFLOW_BG_VERSION_PROBE_SECS`, the claim and processing staleness constants; in the learning-install converge `MAX_LEARNING_ROSTER`; in the HUD `LEDGER_MAX_BYTES`; in the log pruning `MAX_HOOK_LOG_DIRS`. Paths: no op takes one; every git call in the store goes through its one `git(root, args)` wrapper, whose body prepends `['-c', 'core.fsmonitor=false', …]` (**D-NO-FSMONITOR**, in the store KB). Nothing under a project's `.devflow/` is written or renamed through a symbolic link by the hooks, the store, the CLI or the HUD, and the hooks read nothing through one into the session, a backup, a prompt or an agent directive (the links KB).

## D-series names and where each is recorded

| D-series name | Governs | Site | KB |
|---|---|---|---|
| D-ONE-LEARNING-LOCK, D-NO-STRAY-TREE, D-NO-LINKED-TREE | one lock, no stray tree, no linked tree | `withDecisionsLock` (store); `linkedLearningFolder` | store, links |
| D-LEDGER-REGISTRY | promotion state lives in the ledger | `ledgerRegistry` | store |
| D-LOG-CONTENT-AUTHORITY | the log owns content; the ledger projects | `toLedgerRowV2` | store |
| D-PUT-NOT-MERGE | whole-content puts, key refusals | `validateObservationInput` | store |
| D-PUT-REPROJECTS | a put re-projects and renders under its lock | `putObservation` | store |
| D-QUARANTINE-MALFORMED | malformed lines move aside, never drop | `readJsonl` | store |
| D-CONTENT-HISTORY | prior versions kept | `appendHistory` | store |
| D-V1-BACKUP-ONCE | one-time pre-v2 copies | `ensurePreV2Backup` | store |
| D-DUE-ORDER | what maintenance gets, in what order | `selectDue` | store |
| D-VERIFY-REF | where claims about code are checked | `resolveVerifyRef` | store |
| D-ENCODED-QUOTE | Encoded needs a quote found at the ref | `quoteAtRef` | store |
| D-E4-SKIP | assign skips cited numbers | `assignAnchor` | store |
| D-ROTATE-UNREFERENCED | archive only unreferenced rows | `rotateObservations` | store |
| D-V1-BYTE-STABLE | v1 rows render unchanged | `buildBodyBlocks` (render-decisions) | store |
| D-NO-FSMONITOR | no repository-chosen code on index reads | full block at `listGitTrackedFiles`; guard `no-fsmonitor-index-read` | store |
| D-CLEAR-UNREFERENCED, D-RESET-UNDER-LOCK | `--clear` and `--reset` | `clearUnreferenced`, `resetLearning` | agent |
| D-OWNED-CLAIM | exclusive, owner-checked queue claim | `claimQueue`; cited at `releaseClaim`, `touchClaim`, `LEARNING_OPS`, the hook's Section 2 | agent |
| D-LEARNING-STORE-SEAM | the CLI touches ledger state only through the store, loaded by the seam | `src/core/learning-store.ts` | agent |
| D201, D309 | status-list parity, HUD count | `src/core/observations.ts`, `LedgerCountRow` in the HUD | agent |
| D-HOOKS-NO-SYMLINK | a hook never writes or renames through a link at or below a project's `.devflow/`, nor reads through one into the session, a backup, a prompt or an agent directive | `df_no_symlink_below`, `df_file_below` (`git-marker`) | links |
| D-NO-LINKED-READ | a learning file that is a link reads as missing | `readTextUnlinked` (`readJsonl`), `ensurePreV2Backup` | links |
| D-CLI-NO-SYMLINK | the CLI writes and deletes under `.devflow/`, and uninstall's legacy local removal under `.claude/` too, only past a link check | `firstSymbolicLink`, `drainQueueFiles`, `legacyLocalChangeGuard` | links |
| D-GITIGNORE-LINK-INSIDE | a linked root `.gitignore` is written only inside the project and outside any `.git` in it, in any letter case | `_erg_resolve_inside` (shell), `resolveGitignoreTarget` (TS) | links |
| D-HUD-LEDGER-BOUNDED | the statusline reads only a regular ledger of bounded size | `readBoundedLedger` | links |
| D-LEARNING-VARIANTS | learning off compiles the decisions text out of every prompt; the on variant keeps today's path | `splitLearningVariants` (`learning-variants.ts`), `materializeOutputs` (`scripts/build-mds.ts`) | delivery |
| D-LEARNING-VARIANT-INSTALL, D-LEARNING-PRELOAD-MACHINE-ONLY | the install and the toggle follow the machine switch; the skill preload is met by the variant | `convergeLearningVariants`, `applyLearningToggle`, `commandSourceDirs`/`agentSourceDirs`, `LEARNING_GATED_SKILLS` | delivery |
| D-AGENT-OVERRIDE-CARRY | the converge keeps an installed agent's `model:` and `effort:` | `withInstalledState` (`learning-install.ts`), `carryAgentOverrides` | delivery |
| D-DECISIONS-LEARNING-GATE | a decisions load skips on `LEARNING=off` before it locates or reads | `decisions_gate()` (`_decisions.mds`) | delivery |
| D-DECISIONS-DECLARED-ONLY | the index goes only to agents whose contract declares it | `authoring_decisions()` (`_preamble.mds`), `tests/decisions/decisions-seam.test.ts` | delivery |
| D-DECISIONS-CHARTER-HANDOFF | the pass rule lives in the session-start decisions block | `DECISIONS_PASS_RULE` (`session-start-context`) | delivery |
| D-BACKUP-RENAME | the pre-compact backup is replaced by a rename, never rewritten in place | `pre-compact-memory` | memory-worker |
| D-MEMORY-WORKER-LEAN, D-QUEUE-NO-ORPHAN-DELETE | the memory worker's argv and probe; an orphan queue is left in place | `background-memory-update` | memory-worker |
| D-FEATURES-NARROW-ONLY, D-GATES-FAST-PATH, D-FEATURES-ABSENT-ON | machine switch, narrowing, fast paths | `isMachineFeatureOn`, `queue_read_gates`, `resolve-settings.cjs` | hub |

## Anti-Patterns

- **KB-AP-1, two flag reads or a wrong root**: the gate is one fork per hook invocation, and a call that omits `<root>` or resolves the manifest from the project root fails open. Keep the single `queue_read_gates <manifest_path> <root>` call (the manifest is `$HOME/.devflow/manifest.json`) and never encode on/off state in top-level `config.json` keys, which are retired and never narrow.
- **KB-AP-5, draining before the switch**: see D-INIT-DRAIN-AFTER-SWITCH; `init` drains only after the manifest write lands.

## Gotchas

- **KB-INV-6: the legacy key wins only when the renamed key is not a boolean** (`"decisions": false` with no `"learning"` switches learning off).
- **KB-AP-4: the learning queue is not always under the session's own root.** In a linked worktree it is the main worktree's (`DF_LEDGER_ROOT`); tests seeding a queue for a worktree session must seed main's.
- **KB-AP-6: a shell rewrite hook can truncate `cat`/`head` reads of a `.devflow` data file**, announced only on stderr; use the Read tool where exactness matters.
- **Hooks of one event run in parallel**: the memory worker can start before `capture-turn` has appended the assistant row, so it leaves such a queue in place (memory-worker KB).

## Key Files

| File | Purpose |
|------|---------|
| `src/assets/scripts/hooks/capture-prompt` · `capture-turn` · `capture-question` · `queue-append` · `learning-lock` | Capture hooks, shared append (each queue path checked against its own root first), overflow truncation, queue lock |
| `src/assets/scripts/hooks/resolve-project-root` · `git-marker` · `ensure-devflow-init` | Roots, git-only gate, scaffolding that refuses a linked `.devflow`; `git-marker` also holds the link helpers (links KB) |
| `src/assets/scripts/hooks/session-start-context` | Sections 1 to 6 (agent and delivery KBs) |
| `src/assets/scripts/hooks/log-paths` · `src/core/hook-log-dirs.ts` | Log folder cap |
| `src/core/feature-switch.ts` · `feature-config.ts` · `learning-tuning-config.ts` | Switch predicate and I/O, per-repo config, tuning merge |
| `src/cli/commands/memory.ts` · `knowledge/toggle.ts` · `init.ts` | Memory and knowledge toggles, init drains and `--hud-only` |
| `src/targets/claude-code/hooks.ts` | `devflowHookOwner`, `removeHooks`, `ensureHook` |
| `src/core/project-paths.ts` · `src/core/ledger-root.ts` | Path single source; `getLedgerRoot`, the twin of `DF_LEDGER_ROOT` |
| `tests/queue-append.test.ts` · `tests/shell-hooks.test.ts` · `tests/core/ledger-root.test.ts` | Queue trims, hook behaviour, root parity |

## Related

- `.devflow/features/learning-capture-system-store/KNOWLEDGE.md`, `.devflow/features/learning-capture-system-agent/KNOWLEDGE.md`, `.devflow/features/learning-capture-system-delivery/KNOWLEDGE.md`, `.devflow/features/learning-capture-system-links/KNOWLEDGE.md`, `.devflow/features/learning-capture-system-memory-worker/KNOWLEDGE.md`: the five focused KBs of this area (see the table in the Overview).
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md`: the Knowledge agent write-back; its gate takes `KNOWLEDGE=` from the settings line that folds the same switch.
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md`: the charter injection, `session-start-orchestrator` and the `git-marker` basics (`df_has_git_marker`, `df_is_project_root`); the link helpers beside them are recorded in the links KB, and the decisions pass rule in the delivery KB.
- `.devflow/features/tracker-feature/KNOWLEDGE.md`: provider selection, the Tracker agent's schema and the Git agent's reader side for the tracker-setup section.
- `.devflow/features/installer-shadowing/KNOWLEDGE.md`: managed config writes, queue drains at init, the install goldens that list the store, and the carve-out block and its TS twin.
- `.devflow/features/test-harness/KNOWLEDGE.md`: guards on this area (`no-ledger-citations`, `no-fsmonitor-index-read`, `retired-wording`), the install snapshots and the write-set fence.
- `.devflow/features/external-model-routing/KNOWLEDGE.md`: the `agents.memory` entry's shape and worker domain, the `devflow agents` writer, and the per-agent frontmatter rewrite that the Learning mapping rides on.
- `docs/reference/hooks.md`, `docs/reference/file-organization.md`, `docs/cli-reference.md`: the Learning pipeline, the data-file table, the learning-off variants and the `devflow learning` flags.

---
feature: curation-capture-system
name: Curation capture system
description: "Use when changing the capture hooks, memory/curation queues, machine feature switches or ledger root, or choosing which curation KB to read. Keywords: capture-prompt, queue-append, manifest.json, DF_LEDGER_ROOT."
category: architecture
directories:
  - src/assets/scripts/hooks
  - src/assets/scripts/hooks/lib/curation-move.cjs
  - src/assets/scripts/hooks/lib/tracked-areas.cjs
  - src/assets/agents/curate.md
  - src/assets/agents/tracker.md
  - src/assets/agents/skim.mds
  - src/assets/commands/_partials/_decisions.mds
  - src/assets/skills/apply-decisions/SKILL.md
  - src/cli/commands/curation.ts
  - src/cli/commands/curation-move-io.ts
  - src/cli/commands/curation-move-step.ts
  - src/cli/commands/memory.ts
  - src/cli/commands/knowledge
  - src/targets/claude-code/curation-install.ts
  - src/core/curation-variants.ts
  - src/core/curation-store.ts
  - src/core/curation-move.ts
  - src/core/curation-move-notice.ts
  - src/core/tracked-areas.ts
  - src/core/area-pause-notice.ts
  - src/core/observations.ts
  - src/core/feature-switch.ts
  - src/core/manifest.ts
  - src/core/manifest-lock.ts
  - src/core/pool.ts
  - src/core/feature-config.ts
  - src/core/curate-tuning-config.ts
  - src/core/curation-queue-cleanup.ts
  - src/core/linked-path.ts
  - src/core/queue-drain.ts
  - src/core/project-paths.ts
  - src/hud/components/curation-counts.ts
created: 2026-07-15
updated: 2026-10-21
---

# Curation Capture System

## Rules

- **KB-INV-1** Ledger IDs (the ADR and PF numbers) stay on the machine: anything committed, pushed or posted states a rule in words, never by its number; `tests/guards/no-ledger-citations.test.ts` enforces the committed half.
- **KB-INV-2** Plumbing never judges: hooks capture and trigger, the Curate agent decides what is a decision, a pitfall or still true, and plumbing validates, numbers, locks, projects and renders.
- **KB-INV-3** Content identifiers keep their "decisions" names (`decisions-*.jsonl`, `DECISIONS_CONTEXT`, `decisions_load()`, `render-decisions.cjs`) while the directory is `curation/`, the switch `features.curation` and the agent `Curate`; never "fix" the mismatch.
- **KB-INV-4** `features.memory|curation|knowledge` in `~/.devflow/manifest.json` is the MACHINE switch; a repository can only turn a feature OFF, by a literal `false` in `project.json` or `config.json` `features.<name>` (for curation, in `curation` or in `learning`: KB-INV-15), and the retired top-level keys (`RETIRED_CONFIG_KEYS`: memory, learning, knowledge, decisions, autoCommit) never narrow.
- **KB-INV-5** Only an explicit boolean `false` switches a feature off (an absent manifest, `features` object or key, or a non-boolean, reads ON), by `isMachineFeatureOn` and `queue_read_gates` alike; neither is built on `readManifest()`.
- **KB-INV-6** A feature reads its current keys when boolean, else its legacy key (`decisions` for curation, `kb` for knowledge) when boolean, else ON; curation has two current keys, `curation` and `learning`, and a boolean `false` in either one switches it off. `queue_read_gates` mirrors this for curation only.
- **KB-INV-7** Hooks resolve roots from git, never from cwd: curation turns append under `DF_LEDGER_ROOT` (the main worktree), memory under `DF_ROOT`; the CLI and HUD twin is `getLedgerRoot` (parity pinned by `tests/core/ledger-root.test.ts`), and memory is never resolved that way.
- **KB-INV-8** The three capture hooks only append (no scanner runs, no worker starts), and each runs the `DEVFLOW_BG_UPDATER=1` re-entrancy guard before `hook-bootstrap`, so the memory worker's own `claude -p` session is never captured.
- **KB-INV-9** A queue row is JSONL built by `jq` or `node JSON.stringify`, never string concatenation; the append is lock-free by design and only overflow truncation takes the queue lock.
- **KB-INV-10** A hook is devflow's only when its command ENDS in `/scripts/hooks/run-hook <marker>` (`devflowHookOwner`); earlier endings live in `LEGACY_HOOK_SUFFIXES`, are removed on each converge and are never counted as current.
- **KB-INV-11** `drainDisabledFeatureQueues` drains only AFTER the manifest write lands, and `--hud-only` re-init keeps every recorded manifest value and changes only `features.hud`.
- **KB-INV-12** `.devflow/config.json` holds three non-boolean fields, `reviewPublication` (`off`, `auto` or `full`), `tracker` and `gateLevel`. `tracker` is read by `parseTrackerOverride` (TS) and `resolve-settings.cjs` (`parsePersonalBytes`), which must agree (`tests/seams/tracker-key-path.test.ts`). `gateLevel` is the personal gate level, read by the resolver alone and written by no command (`mergeManagedConfig` carries it verbatim): it is not a switch, so it may raise the machine level as well as lower it. A `gateLevel` in `project.json` is ignored.
- **KB-INV-13** Every loop and read in this area has a bound, each a named constant (see Constraints), and the shell cap on hook log folders is pinned equal to the TS `MAX_HOOK_LOG_DIRS`.
- **KB-INV-14** `writeMachineFeature` (`src/core/feature-switch.ts`, `D-NOOP-TOGGLE`) skips the write when the stored boolean already equals the request, so a no-op `devflow memory|curation|knowledge --enable/--disable` leaves `manifest.json` byte-identical and `updatedAt` unmoved; it is the one write point of all three.
- **KB-INV-15** (mirror) The manifest holds the curation switch under two keys, `curation` and the pre-rename mirror `learning`, so a 3.7 install still reads the right value. Every write sets both to one boolean (`writtenKeys` in `feature-switch.ts`, `writeManifest` through `withCurationMirror`), and a recorded value counts only when every written key equals it. A read heals an unequal or incomplete pair, or a leftover legacy `decisions` key, on its first run and writes nothing on the second. When the two keys disagree, false wins.
- **KB-INV-16** (union) A repository narrows curation through either key. A literal `false` in `features.curation` or in `features.learning` of `project.json` or `config.json` turns it off (`feature-config.ts`, `resolve-settings.cjs`, `queue_read_gates`). The sources only narrow; none can turn the feature on.
- **KB-INV-17** (move) The old `.devflow/learning/` folder moves to `.devflow/curation/` once per project, by the `move-ledger <root>` op of `json-helper.cjs`: `moveLedger` lives in `lib/curation-move.cjs` (TS seam `src/core/curation-move.ts`), not in the store, no op takes a folder name, and one classifier, `moveEntryClass`, decides every entry of an old or backup folder. The move never waits (a busy lock answers `busy`, and the next event tries again). Among the toggles, only `devflow curation --disable` drains (`--clear` also drains, and init drains where curation is off).
- **KB-INV-18** The move journal is machine-side, `~/.devflow/.curation-move-<16hex>.journal` beside the move lock; a `.curation-move.journal` inside the old folder is never read and stays in the backup, and a machine journal holds store writers off only while the old folder exists.
- **KB-INV-19** A queue merge fills the new queue to at most `QUEUE_MERGE_CAP_LINES` lines (the capture trim's keep size) and sends the rest to a counted overflow file in the backup; it runs only where the tracked check (KB-INV-24) answered `untracked`.
- **KB-INV-20** The shim keeps four markers, `curation-move.<key>.<suffix>` under `~/.devflow/logs/`: `.skip` (refused), `.busy` (a fresh queue claim held the move: `busy claim`), `.tracked` and `.unknown` (skipped). While one exists it forks no node; session start clears all four. `gatherMoveNotice` has the kinds `refused`, `tracked` and `unknown` and never reads the busy marker; the HUD and `--status`/`--list`/`--show` show the skip notice also when both folders exist, but only after the pause check answers `untracked`. While git tracks files in a curation data folder, or does not answer, the pause notice shows instead: `--status` shows no counts, `--list` and `--show` exit 1, the writing subcommands (`--restore`, `--clear`, `--reset`, project-scope `--configure`) refuse with it and print no `Ledger move skipped` line, and the HUD, where the new ledger file exists, shows no counts and no skip line. A skip can reach those commands only if git's answer changes between the pause check and the move. The skip notice then shows only until the move runs again at session start. `devflow init`, `--enable` and `--disable` run no pause check first, and their move check still prints `Ledger move skipped`.
- **KB-INV-21** No creator makes the old ledger folder: `df_make_ledger_folder` (`git-marker`) makes the new folder only where the old name is absent, and `_qar_append` in `queue-append` never makes the old folder's directory.
- **KB-INV-22** `LEDGER_ROOT_TIMEOUT_MS` bounds every per-project and own-root ledger lookup in `devflow init`; a lookup that times out is a `skipped` outcome for the move and a printed warning for the drain, never a guess.
- **KB-INV-23** The manifest has a lock, `manifest.json.lock` (`src/core/manifest-lock.ts`): the toggle write and the `readManifest` heal run under it, a stale lock is broken by rename-then-verify, and the heal skips when the lock is busy and writes only if the file's bytes are unchanged.
- **KB-INV-24** (tracked areas) The curation area (the curation folder, the old ledger folder and the backup folders at the ledger root) and the memory area (`.devflow/memory/` of the checkout) are judged apart. An area is paused while git tracks a file in it, or a `.git` entry stands and git does not answer: `unknown` pauses like `tracked`, with a `cause <word>` from `UNKNOWN_CAUSES`. Devflow reads and writes no file in a paused area: the move, the backup sweep and every drain leave it, and so do capture, the session-start and memory hooks, the memory worker, the store ops and `render-decisions` (error kind `tracked`), the settings line (`CURATION=off`, `MEMORY=off`), `devflow curation` and `devflow memory`, the HUD counts and uninstall. Session start sends one fixed notice (`AREA_PAUSE_NOTICE`), and no marker is left, so the next event asks again.
- **KB-INV-25** (one source, asked first) `lib/tracked-areas.cjs` alone holds the pathspecs (`AREA_PATHSPECS`: `curation`, `memory`, `both`), the git environment scrub and the answer mapping: `trackedAreaCall` describes the call and `judgeTrackedAreas` judges its result. The TS seam (`probeTrackedArea`), the shell twin (`queue_tracked_area`) and the settings resolver run that description and copy none of it; `tests/decisions/tracked-area-parity.test.ts` holds them equal. A caller asks before it reads, builds a row, makes a folder, takes a lock or makes a git call of its own, and once for each area and root in a process (`inspectTrackedAreaOnce`, the `_QTA_ASKED_*` memo); only the memory worker asks again, after its `claude -p` run.
- **KB-AP-1** Reading feature flags with two separate calls: `queue_read_gates` is one fork. Never read or write top-level `.devflow/config.json` keys for on/off state, omit `<root>` from a `queue_read_gates` call, or resolve the manifest from the project root (the gate then fails open).
- **KB-AP-2** Consuming `config.tracker` raw instead of through `parseTrackerOverride` or `parsePersonalBytes`.
- **KB-AP-3** Omitting the `DEVFLOW_BG_UPDATER=1` guard from a capture hook.
- **KB-AP-4** Seeding a curation queue for a worktree session under the session's own root: in a linked worktree the curation queue is the main worktree's.
- **KB-AP-5** Draining a switched-off feature's queues before the manifest write lands: a session still reading "on" appends turns that survive the disable.
- **KB-AP-6** Reading a `.devflow` data file with `cat` or `head` where exactness matters: a shell rewrite hook can truncate it, announced only on stderr; use the Read tool.
- **KB-AP-7** Sweeping the rename by a blanket swap or by the old literal alone: derived and split names (a prefix beside a suffix, a key, a marker, a helper's output) are missed, and the old names that must stay (`LEGACY_NAMES`, the shim's old-folder name, the uninstall matchers) are rewritten.
- **KB-AP-8** Changing the read form of `_qta_probe` in `queue-append`: under bash 3.2 with `set -e` the git listing goes through a pipeline held in an `if` condition, `PIPESTATUS` is copied in both arms before any other command, and `IFS= read -r -n 1` is the reader (reader status 0 is `tracked`, else git status 0 is `untracked`, else `unknown`); nothing follows the pipeline in an `||` list.

## Overview

Three always-on hooks capture conversation turns into two independently gated JSONL queues, and two processors drain them. The **memory queue** (`.devflow/memory/.pending-turns.jsonl`) is drained by the detached `background-memory-update` worker, started by `memory-worker` on a throttle. The **curation queue** (`.devflow/curation/.pending-turns.jsonl`) is drained by the **Curate agent**, a background subagent that `session-start-context` tells the main model to spawn whenever turns are pending. Scripts capture and trigger only. The agent makes every judgment (is this a decision or a pitfall, is that entry still true); plumbing does the rest: validate, number, lock, project, render.

**Ledger IDs stay on the machine** (KB-INV-1): the ledger is gitignored and numbered per machine, so a number resolves on no other clone and gets reused. An observation's title, rule and why may not name an entry either (the op refuses).

This area is large, so it is split into a hub (this file) and five focused KBs:

| KB | Read it for |
|---|---|
| `.devflow/features/curation-capture-system-store/KNOWLEDGE.md` | The store module as single schema authority: observations and ledger rows, validation, the `json-helper` curation ops, the one lock, rendering of `decisions.md`, `pitfalls.md` and `index.md` |
| `.devflow/features/curation-capture-system-agent/KNOWLEDGE.md` | The Curate agent, the owned queue claim and heartbeat, the `session-start-context` directives (maintenance, tracker setup), the `devflow curation` CLI, the TS seam and HUD counts |
| `.devflow/features/curation-capture-system-delivery/KNOWLEDGE.md` | How decisions reach agents (`DECISIONS_CONTEXT`, the defines, the pass rule), the curation-on and curation-off prompt variants and the converge |
| `.devflow/features/curation-capture-system-links/KNOWLEDGE.md` | The rule that nothing writes, renames or reads through a symbolic link under a project's `.devflow/`, and the safe-create and mode rules |
| `.devflow/features/curation-capture-system-memory-worker/KNOWLEDGE.md` | The memory worker, its model, effort and argv, the pre-compact backup and the jq-less JSON fallback |

This hub holds what they share: the data files and the naming boundary, the machine feature switches, roots, the capture hooks and queues, hook ownership and logs, the bounds, and the table of D-series names with the KB that records each.

## System Context

### Data files and the naming boundary

| File in `.devflow/curation/` | Holds |
|---|---|
| `decisions-log.jsonl` | observations, the content authority |
| `decisions-ledger.jsonl` | entries: projections of log rows plus ledger-owned fields |
| `decisions-log.archive.jsonl` | observations rotated out of the log |
| `decisions-history.jsonl` | the last `HISTORY_DEPTH` prior versions of each rewritten observation and its entries |
| `*.rejected.jsonl` | malformed lines a writer moved aside before rewriting a file |
| `*.pre-v2.jsonl` | one-time copies of the log, ledger and archive made before the first v2 write to a v1 tree |
| `decisions.md`, `pitfalls.md`, `index.md` | generated from the ledger, never hand-edited |
| `.decisions.lock/` | the one curation lock |
| `.pending-turns.jsonl`, `.pending-turns.processing`, `.pending-turns.owner` | the queue, the claimed batch, its owner's token |
| `curation.json` | agent tuning `{model, debug}`; the project file overrides `~/.devflow/curation.json`, and for the model a `devflow agents` Curate mapping outranks the global file (see the agent KB) |

Content identifiers keep their "decisions" names (KB-INV-3): `decisions-*.jsonl`, `decisions_status`, `DECISIONS_CONTEXT`, `decisions_load()`, `render-decisions.cjs`, `decisions-format.cjs`. Before 3.8.0 the folder was `learning/`, its backups `learning.backup-*` and the tuning file `learning.json`; the move (KB-INV-17) renames them, and the code keeps the old names only as `LEGACY_NAMES` (`project-paths.cjs` and `.ts`) and the shim's `df_curation_move_names`, held equal by `tests/project-paths.test.ts`. A rename sweep has to reach the derived and split names (the backup prefix, the lock and journal names, the markers' key) and has to leave those old names alone (KB-AP-7).

### Feature switches: machine switch, repository narrows (D-FEATURES-NARROW-ONLY)

`features.memory|curation|knowledge` in `~/.devflow/manifest.json` is the MACHINE switch; `devflow init` and `devflow memory|curation|knowledge --enable/--disable` write it (the toggles through `writeMachineFeature`, which writes nothing when the stored boolean already equals the request: KB-INV-14). A repository can only turn a feature OFF: effective = machine AND `.devflow/project.json` `features.<name>` (team, committed) AND `.devflow/config.json` `features.<name>` (personal), where only a literal `false` narrows (KB-INV-15, KB-INV-16). The retired top-level keys (`RETIRED_CONFIG_KEYS`: memory, learning, knowledge, decisions, autoCommit) never narrow and are dropped on the next managed write, so no repository can keep a feature running that the machine switched off. Readers:

- `resolve-settings.cjs` folds all three layers into the `MEMORY=`/`CURATION=`/`KNOWLEDGE=` settings line, which the knowledge write-back gate consumes. It then turns `MEMORY` or `CURATION` off for an area that KB-INV-24 pauses (it asks per area: the ledger root for curation, the toplevel for memory), and its fail-closed line has both off.
- The shell hooks call `queue_read_gates <manifest_path> <root>` (memory and curation only; every caller passes `$PROJECT_ROOT`).
- The CLI's `--status` calls `readMachineFeature`, plus `Effective here: disabled (<file>)` when a repository file narrows.
- The installer reads the MACHINE value alone, to pick which compiled prompt variant to install (D-LEARNING-VARIANT-INSTALL, in the delivery KB): `devflow init` passes its settled value and `devflow curation --enable/--disable` passes the value it just wrote. A repository's narrowing never changes an installed file, which is why the curation-on variants keep the run-time `CURATION` gate.

Rules: **D-GATES-FAST-PATH**: each repository file gets a bounded builtin read (`read -r -d '' -n`, one byte past the limit so a cut-short read shows); a cut-short read (NUL, or over the limit) is invalid and narrows nothing; text with no `\u` and no `"features"…{…"memory|curation|learning"…false` sequence cannot narrow, so zero forks. Otherwise exactly ONE `node` fork runs `resolve-settings.cjs`'s `readRepoLayers` + `foldSettings`, so every file rule (symlink, size, BOM, UTF-8, duplicate keys) is the parser's. **D-FEATURES-ABSENT-ON** (KB-INV-5, KB-INV-6): `isMachineFeatureOn(rawManifest, feature)` is the pure predicate and `queue_read_gates` applies the identical rule (its no-jq path calls the resolver's `machineSwitchOn`, so the rule is not copied in shell); neither is built on `readManifest()`, which returns null for a manifest missing required fields and heals writes back to disk. `writeMachineFeature` writes ONLY the feature's keys (both `curation` and `learning` for curation) and `updatedAt` and answers `{ok:false, error:'not-installed'}` when no manifest exists. It reads and writes under the manifest lock (KB-INV-23) and waits at most `MANIFEST_LOCK_WAIT_MS`, longer than `MANIFEST_LOCK_STALE_MS`, so a dead holder's lock is broken inside the wait; a lock still held after it is passed over rather than refusing an explicit switch.

### Roots and gates (D-HOOKS-GIT-ONLY, D-LEDGER-MAIN-WORKTREE)

Hooks resolve roots from git, never from cwd. `df_resolve_roots` (`resolve-project-root`) makes ONE `git rev-parse --path-format=absolute --show-toplevel --git-common-dir` call and sets `DF_ROOT` (the checkout toplevel: memory, carve-out, KBs) and `DF_LEDGER_ROOT` (the main worktree when its `.devflow/` exists and it is not HOME, else `DF_ROOT`). The capture hooks append curation turns under `DF_LEDGER_ROOT`; memory stays at `DF_ROOT`. `ensure-devflow-init` scaffolds the ledger folder only where the ledger lives; the capture hooks and `session-start-context` (healing an older install) create it at the ledger root. Every creator follows KB-INV-21 (`df_make_ledger_folder`, with `df_ledger_folder` and `df_ledger_queue` naming the old folder while it is present). `df_is_project_root` (a `.git` entry AT the root, physical path not HOME's, D-HOOKS-TOPLEVEL-ONLY) gates per-project work, so memory and curation stop together outside git. The CLI/HUD twin is `getLedgerRoot` (`src/core/ledger-root.ts`, parity pinned by `tests/core/ledger-root.test.ts`); memory is never resolved that way.

## Component Interactions

### Capture hooks and the queues

All three hooks (`capture-prompt`, `capture-turn`, `capture-question`) source `queue-append` and call `queue_append_both`, handing each queue the root it lies below (`$PROJECT_ROOT` for memory, `$LEDGER_ROOT` for curation; they differ in a linked worktree) and gating each write by `_QG_MEMORY` / `_QG_CURATION` from one `queue_read_gates "$DEVFLOW_MANIFEST" "$PROJECT_ROOT"` call (at most one fork per invocation, none when the fast paths settle it; `$DEVFLOW_MANIFEST` is `$HOME/.devflow/manifest.json`, D-ONE-HOME). They only append: no scanner runs and no background worker starts. In order:

1. The `DEVFLOW_BG_UPDATER=1` re-entrancy guard, before `hook-bootstrap`, so the memory worker's own `claude -p` session is never captured.
2. The one gate fork.
3. `ensure-devflow-init`, whose non-zero return ends the hook, as it does for a `.devflow` that is a symbolic link.
4. `_qar_gate` (in `queue_append_row` and `queue_append_both`) asks the tracked check for each enabled queue before the row is built, with one `both` call when the two queues share a root (KB-INV-24): a paused queue gets no row and no folder, and one fixed log line says so.
5. In `_qar_append` (the one append step under `queue_append_row` and `queue_append_both`), the ledger queue's folder is first named by the creator rule (the old folder while it is present), then `df_no_symlink_below <root> <queue>` (D-HOOKS-NO-SYMLINK): a queue, or a folder between its root and it, that is a link skips the append, logs `Queue skipped: a symbolic link sits on the path to <queue>; nothing written` and returns 0, and only a clear path gets `mkdir -p` of its folder, never the old folder's (the hook bodies create no queue folder themselves; `queue-append` sources `git-marker` itself, and a failed source is a command not found, which is the refusing branch). A write that fails because the old folder moved away is tried once more under the new name, and names that cannot be had (the shim failed to source) skip the append.
6. JSONL append of the row `_qar_build_row` built once for both queues, via `jq` or `node JSON.stringify`, never string concatenation, `umask 077`, lock-free by design.
7. Overflow guard: a queue over its line bound is truncated to the newest rows under `curation_lock_acquire "<queue>.lock"` (`QUEUE_LOCK_TIMEOUT_MS` wait, `QUEUE_LOCK_STALE_MS` stale). The copy is created under the safe-create and mode rules of the links KB, so both queues keep mode 0600 through a trim.

`capture-question` emits one `qa` row per answered question, joining `cwd` and field with ASCII SOH.

| What | File | Contains |
|---|---|---|
| Feature on/off | `~/.devflow/manifest.json` | `{features: {memory, curation, knowledge, …}}` |
| Team narrowing and facts | `.devflow/project.json` (committed, never devflow-written) | `{version, evidence, compliance, tracker, reviewPublication, features}`; `reviewPublication` only lowers |
| Personal per-repo facts | `.devflow/config.json` | `{reviewPublication, tracker?, gateLevel?, features?}` |
| Agent tuning | `.devflow/curation/curation.json`, then (for the model only) the `devflow agents` Curate mapping in `~/.devflow/agent-models.json`, then `~/.devflow/curation.json` | `{model, debug}` |

### Hook ownership, init and logs

- **D-EXACT-HOOK-OWNER** (KB-INV-10): `devflowHookOwner` and `removeHooks` live in `src/targets/claude-code/hooks.ts`, `LEGACY_HOOK_SUFFIXES` in `memory.ts`. `devflow memory --enable/--disable` converges Stop/SessionStart/PreCompact (the settings transform runs FIRST, so the switch is not recorded unless the hooks can follow); `devflow knowledge` is a thin `handleToggle` router (KBs are written only by `knowledge_writeback`).
- **D-INIT-DRAIN-AFTER-SWITCH**: `drainDisabledFeatureQueues` drains this repo's queues for each feature `init` switched off, only AFTER the manifest write lands (KB-INV-11, KB-AP-5), and it returns one warning for each drain a linked folder refused (D-CLI-NO-SYMLINK) and one for a drain the tracked check left alone (KB-INV-24, the memory drain included), which `init` prints. Its curation drain is `drainDisabledCurationQueue` (as for `--disable`), which asks that check before it deletes anything and also deletes the pending rows of the backups a move left, so a later re-enable cannot merge them back; its ledger root comes from `lookupDrainLedgerRoot`, which asks only when curation is off (KB-INV-22). **D-HUD-ONLY-PRESERVE**: `--hud-only` re-init keeps every recorded manifest value and changes only `features.hud`.
- **D-LOG-DIR-CAP**: hooks log under `~/.devflow/logs/<cwd-slug>/`; `devflow init` prunes to `MAX_HOOK_LOG_DIRS` (`src/core/hook-log-dirs.ts`, oldest first, with a scan bound) and `log-paths`' `devflow_log_dir` prunes only when it creates a folder (one `ls -1At`, a bounded removal count, bash 3.2); the shell cap is pinned equal to the TS one.

### The ledger folder move (KB-INV-17 to KB-INV-22, KB-INV-24)

The op's rules (new folder wins or not, the journal, the merge cap, the locks) are in the store KB. Here are the callers and the shim:

- **Hooks.** `df_curation_move <ledger_root> [retry]` (the sourced shim `curation-move`) runs from `ensure-devflow-init`, so each capture event tries once, and from `session-start-context` with `retry`, on the ledger root and whether or not curation is on, because the old folder holds the decisions either way. With no old folder it costs one builtin test and no fork; it refuses without a fork for a root that is a link, HOME or `~/.devflow`, or a link on the way down; otherwise it forks node once on `move-ledger <root>`, the root as one argv word.
- **The shim's reading of the answer (KB-INV-20).** `moved <mode>` logs one line; `busy` and `none` log nothing and leave no marker; `busy claim` writes the `.busy` marker; `skipped tracked` and `skipped unknown` log one fixed line (`unknown` with the op's `cause <word>`), write the `.tracked` or `.unknown` marker and set `DF_CURATION_MOVE_SKIPPED`; anything else (a refusal or an I/O error) logs one line and writes `.skip`. Section 4b of `session-start-context` shows no move-skip text: while curation is on, the skip reason pauses curation and the pause notice of KB-INV-24 goes to the user; while it is off, session start shows no curation text, and `devflow init`, the CLI and the HUD show `MOVE_SKIP_NOTICE` (`curation-move-skip.ts`). The HUD and `--status` read every marker but the busy one, because a busy move is no refusal (`curation-move-notice.ts`).
- **The tracked check (KB-INV-24, KB-INV-25).** `tracked-areas.cjs` is a leaf (node built-ins and `project-paths.cjs` only), so the store, the move, the sweep and the CLI can all load it. It never throws and decides from git's index, not the disk: no `.git` entry at the root is `untracked` with no git call; otherwise one bounded `git ls-files` call (no shell, `core.fsmonitor` off in its own argv, the redirecting `GIT_*` variables removed) runs over the area's pathspecs, matched without regard to letter case and spelled both plain and with the `fl` ligature (`DEVFLOW_SPELLINGS`): for curation the data folders (`AREA_FOLDERS`) and the backup folders with everything below them, for memory the memory folder, and for each an index entry named `.devflow` itself (`both` is their union, in one call). Any listed byte, a staged entry included, is `tracked`; a failed or cut-off call is `unknown` with a fixed word of `UNKNOWN_CAUSES`, never git's text. The move asks right after its refusal checks, before it makes or locks anything, and the sweep once a backup holds rows. Capture and the Stop hook ask in `git` mode; the session-start and pre-compact hooks ask in `node` mode (`json-helper.cjs tracked-area <area> <root>`), which the leaf's own timeout cuts; `background-memory-update` cuts its calls with `DEVFLOW_BG_AREA_PROBE_SECS`.
- **Init and the CLI.** `runInitCurationMove` (`curation-move-step.ts`, importing no fs, os or store) moves every discovered project and the repository's own ledger root, each mapped to its ledger root and listed once by physical path, through `pooled` (`src/core/pool.ts`, `MOVE_POOL_LIMIT`), then sweeps each project's backups; a per-project outcome never decides init's exit code. A `skipped` move or sweep becomes the outcome `left-alone`, whose line is the fixed notice; the disable drain's line then omits it (`shownSkipAt`). `devflow curation` (`pausedCurationLine`) and `devflow memory` (`memoryPauseReason`) ask their area first through `probeTrackedArea` and print the `AREA_PAUSE_NOTICE` words for a paused one: `--status` exits 0, the other curation subcommands exit 1 (the toggles write only the manifest), and the memory drains skip the project. `devflow curation` runs `runSharedMove` (`curation-move-io.ts`) for its writing subcommands, which print the move notice and write nothing, and for the toggles, where `tryMoveForToggle` hands the printed reason to the disable drain.

### Integration points

- **git**: `ls-files` (scope matching, the cited-number scan), `rev-parse` (roots, verify ref), `cat-file blob` (the Encoded quote); the store makes its calls through its `git()` wrapper, whose body prepends the fsmonitor override; the agent reads files at the ref with `git show`; the tracked check makes its one `ls-files` call with the override in its own argv.
- **Install**: the store, the move module, the tracked check, renderer, formatter, `mkdir-lock`, `safe-path` and `json-helper` install under `~/.devflow/scripts/hooks/` (the install goldens list each), and `core/observations.js` rides with the HUD. A prompt that names an op needs that op in the installed copy. The curation-off variants ride in the package under `dist/curation-off/` and are what a curation-off machine installs in place of the on files; the `devflow:apply-decisions` skill installs on a curation-on machine only.
- **Claude Code**: SessionStart `additionalContext` carries Sections 1 to 5 (Section 6 is a top-level `systemMessage`); the Curate and Tracker agents are spawned from directives, never from commands; hooks of one event run in parallel.

## Constraints

Every loop and read has a bound, each a named constant: in the store those its KB lists (`E4_MAX_SKIPS`, `DUE`, `HISTORY_DEPTH`, `GIT_TIMEOUT_MS`, the stdin cap, the lock waits); in the hooks the queue line bounds, `MEMORY_READ_LIMIT`, `DEVFLOW_BG_VERSION_PROBE_SECS`, `DEVFLOW_BG_AREA_PROBE_SECS`, the claim and processing staleness constants; in the curation-install converge `MAX_CURATION_ROSTER`; in the HUD `LEDGER_MAX_BYTES`; in the log pruning `MAX_HOOK_LOG_DIRS`; in the move `MOVE_LOCK_STALE_MS`, the other `MOVE_MAX_*` bounds, `MOVE_JOURNAL_MAX_BYTES`, `MOVE_GIT_TIMEOUT_MS`, `QUEUE_FILE_MAX_BYTES`, `MOVE_POOL_LIMIT` and `LEDGER_ROOT_TIMEOUT_MS`; in the tracked check `TRACKED_AREAS_GIT_TIMEOUT_MS`, `TRACKED_AREAS_GIT_MAX_BUFFER` and `ANSWER_MEMO_MAX_ENTRIES`; in the manifest lock `MANIFEST_LOCK_STALE_MS` and `MANIFEST_LOCK_WAIT_MS`. Paths: no curation op takes one (`move-ledger` takes the root, as one argv word); every git call in the store goes through its one `git(root, args)` wrapper, whose body prepends `['-c', 'core.fsmonitor=false', …]` (**D-NO-FSMONITOR**, in the store KB). Nothing under a project's `.devflow/` is written or renamed through a symbolic link by the hooks, the store, the CLI or the HUD, and the hooks read nothing through one into the session, a backup, a prompt or an agent directive (the links KB).

## D-series names and where each is recorded

| D-series name | Governs | Site | KB |
|---|---|---|---|
| D-ONE-LEARNING-LOCK, D-NO-STRAY-TREE, D-NO-LINKED-TREE | one lock, no stray tree, no linked tree | `withDecisionsLock` (store); `linkedCurationFolder` | store, links |
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
| D-CLEAR-UNREFERENCED, D-RESET-UNDER-LOCK | `--clear` and `--reset` | `clearUnreferenced`, `resetCuration` | agent |
| D-OWNED-CLAIM | exclusive, owner-checked queue claim | `claimQueue`; cited at `releaseClaim`, `touchClaim`, `CURATION_OPS`, the hook's Section 2 | agent |
| D-LEARNING-STORE-SEAM | the CLI touches ledger state only through the store and the move module, loaded by their seams | `src/core/curation-store.ts`, `src/core/curation-move.ts` | agent, store |
| D201, D309 | status-list parity, HUD count | `src/core/observations.ts`, `LedgerCountRow` in the HUD | agent |
| D-HOOKS-NO-SYMLINK | a hook never writes or renames through a link at or below a project's `.devflow/`, nor reads through one into the session, a backup, a prompt or an agent directive | `df_no_symlink_below`, `df_file_below` (`git-marker`) | links |
| D-NO-LINKED-READ | a curation file that is a link reads as missing | `readTextUnlinked` (`readJsonl`), `ensurePreV2Backup` | links |
| D-CLI-NO-SYMLINK | the CLI writes and deletes under `.devflow/`, and uninstall's legacy local removal under `.claude/` too, only past a link check | `firstSymbolicLink`, `drainQueueFiles`, `legacyLocalChangeGuard` | links |
| D-GITIGNORE-LINK-INSIDE | a linked root `.gitignore` is written only inside the project and outside any `.git` in it, in any letter case | `_erg_resolve_inside` (shell), `resolveGitignoreTarget` (TS) | links |
| D-HUD-LEDGER-BOUNDED | the statusline reads only a regular ledger of bounded size | `readBoundedLedger` | links |
| D-LEARNING-VARIANTS | curation off compiles the decisions text out of every prompt; the on variant keeps today's path | `splitCurationVariants` (`curation-variants.ts`), `materializeOutputs` (`scripts/build-mds.ts`) | delivery |
| D-LEARNING-VARIANT-INSTALL, D-LEARNING-PRELOAD-MACHINE-ONLY | the install and the toggle follow the machine switch; the skill preload is met by the variant | `convergeCurationVariants`, `applyCurationToggle`, `commandSourceDirs`/`agentSourceDirs`, `CURATION_GATED_SKILLS` | delivery |
| D-AGENT-OVERRIDE-CARRY | the converge keeps an installed agent's `model:` and `effort:` | `withInstalledState` (`curation-install.ts`), `carryAgentOverrides` | delivery |
| D-DECISIONS-LEARNING-GATE | a decisions load skips on `CURATION=off` before it locates or reads | `decisions_gate()` (`_decisions.mds`) | delivery |
| D-DECISIONS-DECLARED-ONLY | the index goes only to agents whose contract declares it | `authoring_decisions()` (`_preamble.mds`), `tests/decisions/decisions-seam.test.ts` | delivery |
| D-DECISIONS-CHARTER-HANDOFF | the pass rule lives in the session-start decisions block | `DECISIONS_PASS_RULE` (`session-start-context`) | delivery |
| D-BACKUP-RENAME | the pre-compact backup is replaced by a rename, never rewritten in place | `pre-compact-memory` | memory-worker |
| D-MEMORY-WORKER-LEAN, D-QUEUE-NO-ORPHAN-DELETE | the memory worker's argv and probe; an orphan queue is left in place | `background-memory-update` | memory-worker |
| D-FEATURES-NARROW-ONLY, D-GATES-FAST-PATH, D-FEATURES-ABSENT-ON | machine switch, narrowing, fast paths | `isMachineFeatureOn`, `queue_read_gates`, `resolve-settings.cjs` | hub |

## Anti-Patterns

- **KB-AP-1, KB-AP-5 and KB-AP-7** are stated in Rules. The one `queue_read_gates <manifest_path> <root>` call reads `$HOME/.devflow/manifest.json`; `init` drains only after the manifest write lands (D-INIT-DRAIN-AFTER-SWITCH); a rename sweep keeps `LEGACY_NAMES` and the shim's old-folder name (Data files and the naming boundary).

## Gotchas

- **KB-INV-6: the legacy key wins only when the renamed key is not a boolean** (`"decisions": false` with no `"curation"` switches curation off).
- **KB-AP-4: the curation queue is not always under the session's own root.** In a linked worktree it is the main worktree's (`DF_LEDGER_ROOT`); tests seeding a queue for a worktree session must seed main's.
- **Hooks of one event run in parallel**: the memory worker can start before `capture-turn` has appended the assistant row, so it leaves such a queue in place (memory-worker KB).

## Key Files

| File | Purpose |
|------|---------|
| `src/assets/scripts/hooks/capture-prompt` · `capture-turn` · `capture-question` · `queue-append` · `curation-lock` | Capture hooks, shared append (each queue path checked against its own root first), the area gate and shell twin (`_qar_gate`, `queue_tracked_area`), overflow truncation, queue lock |
| `src/assets/scripts/hooks/resolve-project-root` · `git-marker` · `ensure-devflow-init` | Roots, git-only gate, scaffolding that refuses a linked `.devflow`; `git-marker` also holds the link helpers (links KB) |
| `src/assets/scripts/hooks/session-start-context` | Sections 1 to 6 (agent and delivery KBs) |
| `src/assets/scripts/hooks/curation-move` · `lib/curation-move.cjs` · `src/core/curation-move.ts` | The folder move: the hook shim, the op module, its typed seam (KB-INV-17) |
| `src/assets/scripts/hooks/lib/tracked-areas.cjs` · `src/core/tracked-areas.ts` · `area-pause-notice.ts` | The tracked check, its typed seam and the fixed pause notice (KB-INV-24) |
| `src/cli/commands/curation-move-step.ts` · `curation-move-io.ts` · `src/core/curation-move-notice.ts` · `curation-move-skip.ts` · `pool.ts` | The init step, its real I/O, the HUD and status notice, the fixed skip notice, the bounded pool |
| `src/core/curation-queue-cleanup.ts` | The `--clear` and disable drains (KB-INV-24) |
| `src/core/manifest-lock.ts` · `manifest.ts` · `feature-switch.ts` | The manifest lock, the heal under it, the toggle write under it (KB-INV-23) |
| `src/assets/scripts/hooks/log-paths` · `src/core/hook-log-dirs.ts` | Log folder cap |
| `src/core/feature-switch.ts` · `feature-config.ts` · `curate-tuning-config.ts` | Switch predicate and I/O, per-repo config, tuning merge |
| `src/core/gate-level.ts` · `src/cli/commands/gates.ts` | The gate level: closed set, raw manifest reader and writer, `devflow gates` |
| `src/cli/commands/memory.ts` · `knowledge/toggle.ts` · `init.ts` | Memory and knowledge toggles, init drains and `--hud-only` |
| `src/targets/claude-code/hooks.ts` | `devflowHookOwner`, `removeHooks`, `ensureHook` |
| `src/core/project-paths.ts` · `src/core/ledger-root.ts` | Path single source; `getLedgerRoot`, the twin of `DF_LEDGER_ROOT` |
| `tests/queue-append.test.ts` · `tests/shell-hooks.test.ts` · `tests/core/ledger-root.test.ts` | Queue trims, hook behaviour, root parity |
| `tests/decisions/curation-move.test.ts` · `tests/decisions/tracked-areas.test.ts` · `tests/decisions/tracked-area-parity.test.ts` · `tests/init-curation-move.test.ts` · `tests/core/manifest-lock.test.ts` | The move op (cap, journal, busy claim, skips), the tracked check (answers, pathspecs, causes) and its runners held equal, the init step, the manifest lock |

## Related

- The five focused KBs of this area: the table in the Overview.
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md`: the Knowledge agent write-back; its gate takes `KNOWLEDGE=` from the settings line that folds the same switch.
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md`: the charter hand-off, `session-start-orchestrator` and the `git-marker` basics (`df_has_git_marker`, `df_is_project_root`); the link helpers beside them are recorded in the links KB, and the decisions pass rule in the delivery KB.
- `.devflow/features/tracker-feature/KNOWLEDGE.md`: provider selection, the Tracker agent's schema and the Git agent's reader side for the tracker-setup section.
- `.devflow/features/installer-shadowing/KNOWLEDGE.md`: managed config writes, queue drains at init, the install goldens that list the store, and the carve-out block and its TS twin.
- `.devflow/features/test-harness/KNOWLEDGE.md`: guards on this area (`no-ledger-citations`, `no-fsmonitor-index-read`, `retired-wording`), the install snapshots and the write-set fence.
- `.devflow/features/external-model-routing/KNOWLEDGE.md`: the `agents.memory` entry's shape and worker domain, the `devflow agents` writer, and the per-agent frontmatter rewrite that the Curate mapping rides on.
- `docs/reference/hooks.md`, `docs/reference/file-organization.md`, `docs/cli-reference.md`: the Curation pipeline, the data-file table, the curation-off variants and the `devflow curation` flags.

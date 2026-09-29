---
feature: learning-capture-system
name: Learning & Capture System
description: "Use when modifying capture hooks (capture-prompt/capture-turn/capture-question), the learning or memory pending-turns queues, the Learning agent (src/assets/agents/learning.md), the session-start-context learning or tracker-setup directives, the machine-wide feature switches (memory/learning/knowledge in ~/.devflow/manifest.json), the per-repo tracker override in .devflow/config.json, the learning tuning config, the decisions content files (decisions.md/pitfalls.md/index.md) or their ledger ops, or the devflow learning/memory/knowledge CLI. Keywords: capture-prompt, capture-turn, capture-question, queue-append, pending-turns, memory-worker, Learning agent, learning directive, LEARNING MAINTENANCE, TRACKER SETUP, TRACKER_PROCESSING_STALE_SECS, TRACKER_PROVIDER_KEY_PATH, tracker-section-max-chars, .tracker.attempts, .tracker.enabled, .tracker.processing, hookEnv, DEVFLOW_BG_UPDATER, learning-lock, queue_read_gates, isMachineFeatureOn, readMachineFeature, writeMachineFeature, feature-switch, manifest.json, RETIRED_CONFIG_KEYS, decisions_load, DECISIONS_CONTEXT, feature-config, learning.json, decisions-ledger, assign-anchor, retire-anchor, refresh-anchor, render-decisions, staged-write CAS, WORKING-MEMORY.md.new, segmentDetails, amendments, is-hex-sha, verify_and_swap, compute_commits_since_note, divergence guard, isSafeRawBody."
category: architecture
directories:
  - src/assets/scripts/hooks
  - src/assets/agents/learning.md
  - src/assets/agents/tracker.md
  - src/cli/commands/learning.ts
  - src/cli/commands/memory.ts
  - src/cli/commands/knowledge
  - src/core/feature-switch.ts
  - src/core/feature-config.ts
  - src/core/learning-tuning-config.ts
  - src/core/learning-queue-cleanup.ts
  - src/core/project-paths.ts
  - src/hud/components/learning-counts.ts
  - src/assets/commands/_partials
created: 2026-07-15
updated: 2026-09-29
---

# Learning & Capture System

## Overview

A capture-then-process model: three always-on hooks write conversation turns into two
independently-gated JSONL queues, and two processors drain each queue on its own schedule. The
**memory queue** (`.devflow/memory/.pending-turns.jsonl`) is drained by the detached
`background-memory-update` worker on a 120s throttle. The **learning queue**
(`.devflow/learning/.pending-turns.jsonl`) is drained by the **Learning agent** — a background
subagent that `session-start-context` instructs the main model to spawn whenever the queue has
pending turns. Scripts capture and trigger only; the Learning agent does all decision/pitfall
detection by reading and editing the data files directly. No marker files, no deterministic
detection thresholds, no per-session JSON state on the learning side.

`session-start-context` also carries a second, independent directive — `--- TRACKER SETUP ---` —
sharing the injection shape but gating issue-tracker provider inference and spawning the
`Tracker` agent (KB scope here is the shared hook-plumbing only; `tracker-feature` owns
provider selection and the agent's schema). The content the Learning agent produces —
`decisions.md`, `pitfalls.md`, `decisions-ledger.jsonl`, `decisions-log.jsonl`, `index.md` —
**deliberately keeps its "decisions" naming** even though the system is called "learning" (see
Naming Boundary).

**`memory`, `learning`, and `knowledge` are machine switches a repository can only narrow**
(D-FEATURES-NARROW-ONLY, `src/core/feature-switch.ts`; #378 made them machine-wide, #392 added
the narrow-only repository layer). See System Architecture for the full model.

## System Architecture

### Feature Switches: Machine, Narrowed by the Repository (D-FEATURES-NARROW-ONLY)

`features.memory`, `features.learning`, and `features.knowledge` in `~/.devflow/manifest.json`
are the MACHINE switch. `devflow init` and `devflow memory|learning|knowledge
--enable/--disable` write that one value. A repository adds two layers that can only turn a
feature OFF: effective = machine AND `.devflow/project.json` `features.<name>` (team-committed)
AND `.devflow/config.json` `features.<name>` (personal, per worktree), where only a literal
`false` narrows. `features` is a new namespace — the retired top-level keys never narrow, and
`features.decisions` in a repository file is not a switch. Readers:
- `resolve-settings.cjs` folds all three (`MEMORY=`/`LEARNING=`/`KNOWLEDGE=`), parsed by the
  shared `scripts/lib/project-config.cjs`.
- The shell hooks via `queue_read_gates <manifest_path> <root>` (memory/learning only). Every
  caller passes `$PROJECT_ROOT` (= `DF_ROOT`, the checkout toplevel) as `<root>`, for learning
  too — the files are per branch/worktree, the ledger root only says where the queue lands.
  D-GATES-FAST-PATH: each repository file gets a bounded builtin read (`read -r -d '' -n 4097`);
  a cut-short read (NUL or > 4096 bytes) is invalid and narrows nothing; a text with no `\u` and
  no `"features"…{…"memory|learning"…false` sequence cannot narrow. Zero forks then. Otherwise
  exactly ONE `node` fork runs `resolve-settings.cjs`'s `readRepoLayers` + `foldSettings`
  (folding the manifest too when its own fast path flagged it), so every file rule — symlink,
  size, BOM, fatal UTF-8, duplicate keys — is the parser's. The shared table
  `tests/fixtures/settings-switch-table.ts` runs against both (TP-49).
- The CLI's `--status` via `readMachineFeature(devflowDir, feature)`, plus an
  `Effective here: disabled (<file>)` line when a repository file narrows.
- The knowledge write-back gate via the `knowledge_writeback` MDS partial, which takes
  `KNOWLEDGE=` from the settings line (`_partials/_settings.mds`) and reads no file itself.

**Why narrow-only**: per-repo toggles were a leftover of the per-repo-install era — `init --no-<feature>`
recorded "off" in one repo's manifest while every OTHER repo, reading its own
`.devflow/config.json`, kept the feature running (#378). Those keys are retired:
`RETIRED_CONFIG_KEYS` in `feature-config.ts` (`memory`, `learning`, `knowledge`, `decisions`,
`autoCommit`) — no gate reads them, and `mergeManagedConfig`/`writeManagedConfig` drop them on
the next managed write. A repository layer that can only narrow cannot reintroduce #378: no repo
can keep a feature running that the machine switched off. The old `updateFeature`/`isFeatureEnabled` pair is deleted outright —
only `readMachineFeature`/`writeMachineFeature` remain.

**D-FEATURES-ABSENT-ON (fail-open)**: only an explicit boolean `false` switches a feature off —
an absent manifest, absent `features` object, missing key, or non-boolean value all read as ON.
`isMachineFeatureOn(rawManifest, feature)` is the pure predicate; `queue_read_gates` applies the
identical rule in shell. Deliberately NOT built on `readManifest()`: that returns `null` for a
manifest missing required fields (must still read "on" here) and writes heals back to disk,
which a read-only gate must never do.

**Legacy key coalescing** (`learning`←`decisions`, `knowledge`←`kb`, per ADR-011's rename): a
feature reads its current key when that is a boolean, else its legacy key when THAT is a
boolean, else ON — `isMachineFeatureOn`'s `LEGACY_KEYS` map and `queue_read_gates`'s jq/node
fallback apply the identical precedence for `learning`/`decisions` (D-LEARNING-LEGACY-DECISIONS),
so the hook and the CLI never disagree. `knowledge`/`kb` follows the same rule
(D-KNOWLEDGE-LEGACY-KB), except `queue_read_gates` never reads knowledge (no shell mirror), and
`knowledge_writeback` deliberately does not learn the legacy `kb` key (ADR-028: no prompt text
for a state only an un-upgraded install can hold) — some other command's `readManifest()` heals
it on disk first.

`setMachineFeature`/`writeMachineFeature` write ONLY `features.<feature>` and `updatedAt`,
carrying every other key verbatim — also NOT built on `readManifest()`/`writeManifest()`, which
would refuse a rejected manifest, drop unmodeled keys, and persist unrelated heals as a side
effect of a one-key toggle. Refuses `{ok: false, error: 'not-installed'}` when no manifest exists
(created only by `devflow init`, never manufactured by a toggle).

### Two-Pipeline, Shared Capture

All three hooks source `queue-append` and call `queue_append_both`, which gates each write
independently via `_QG_MEMORY`/`_QG_LEARNING` flags from a single
`queue_read_gates "$DEVFLOW_MANIFEST" "$PROJECT_ROOT"` call (AC-P1 — at most one subprocess per
hook invocation, none when the fast paths settle it).
`$DEVFLOW_MANIFEST` is `$HOME/.devflow/manifest.json` — the machine root, which no environment
variable relocates (D-ONE-HOME, #389). The project's own `.devflow` is a separate hook-local,
`PROJECT_DEVFLOW_DIR="$PROJECT_ROOT/.devflow"`.

Config splits along a different line than before #378:

| What | File | Contains |
|------|------|---------|
| Feature on/off | `~/.devflow/manifest.json` (machine-wide) | `{features: {memory, learning, knowledge, ...}}` |
| Team narrowing + facts | `.devflow/project.json` (committed, never devflow-written) | `{version, evidence, compliance, tracker, reviewPublication, features}` — `features.<x>: false` only narrows |
| Per-repo facts | `.devflow/config.json` (project root, per worktree) | `{reviewPublication, tracker?, features?}` — `features.<x>: false` only narrows; top-level switch keys retired |
| Agent tuning | `.devflow/learning/learning.json` → `~/.devflow/learning.json` | `{model, debug}`, project overrides global |

`.devflow/config.json`'s only feature-adjacent field left is the optional `tracker` key — a
per-repo provider override, not a boolean toggle (`FeatureConfig.tracker` is `unknown`,
unvalidated at the field level; ADR-011's neutral-config-home rationale now applies only to this
field). It round-trips through `coerceConfig`/`mergeManagedConfig` byte-for-byte
(D-CONFIG-PRESERVE-UNMANAGED). `parseTrackerOverride` (routes through `parseTrackerId`) is the
only sanctioned reader, returning `{absent | valid | invalid}` — see `tracker-feature` KB for the
Git agent's resolution order.

### Project Roots (D-HOOKS-GIT-ONLY, D-LEDGER-MAIN-WORKTREE)

Hooks resolve roots from git, never from cwd. `resolve-project-root`'s `df_resolve_roots <cwd>` makes ONE `git rev-parse --path-format=absolute --show-toplevel --git-common-dir` call, accepts exactly two absolute lines (else falls back to `df_resolve_root` — git < 2.31 echoes the flag as a third line), and sets `DF_ROOT` (the checkout toplevel: memory, carve-out, KBs) and `DF_LEDGER_ROOT` (the main worktree = parent of a `…/.git` common dir, when `$MAIN/.devflow` already exists and the main worktree is not HOME — `df_is_project_root "$MAIN"`, a physical-path compare, since a dotfiles repo's `~/.devflow` is the machine root and always exists; else `DF_ROOT`). The capture hooks append learning turns under `DF_LEDGER_ROOT` and pass it to `decisions-usage-scan.cjs`; `session-start-context` reads the TL;DR, the queue and `learning.json` there and names it in the directive; memory stays at `DF_ROOT`. A worktree ledger created before this rule stays on disk, unused. `ensure-devflow-init` scaffolds `learning/` only when `DF_LEDGER_ROOT` is `DF_ROOT`: a linked worktree whose ledger is at main gets no `learning/`, and the capture hooks create the ledger's own `learning/` when they append. `ensure-devflow-init` and `session-start-context` both refuse per-project work unless `df_is_project_root` (git-marker) passes — a git marker AND a physical path that is not HOME's — so memory and learning stop together outside git and in a HOME-rooted repo. `ensure-root-gitignore` itself stays ungated (PF-059 parity suite runs it in plain dirs).

### Capture Hook Protocol

All three capture hooks enforce in order: (1) **re-entrancy guard**
(`if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then exit 0; fi`, before `hook-bootstrap`, prevents
double-capture of the memory worker's own claude session); (2) **single config fork** via
`queue_read_gates "$DEVFLOW_MANIFEST" "$PROJECT_ROOT"` (the machine-root manifest, narrowed by the
checkout's repository files; zero forks unless one could narrow); (3) **JSONL
append** via `jq` or `node JSON.stringify` (never string concatenation), `umask 077`;
(4) **overflow guard** (>200 lines → truncate to newest 100, under `learning_lock_acquire`, 2s
timeout). `capture-turn` also runs `decisions-usage-scan.cjs` before append when the assistant
message contains `ADR-\d+|PF-\d+` (D29 grep-first gate), regardless of queue feature flags.
`capture-question` emits one `"qa"` row per answered question using ASCII SOH (`\001`) as
delimiter for the combined `cwd+field` in `json_extract_cwd_field` — one subprocess, two fields.

### session-start-context Directive

Emits `--- LEARNING MAINTENANCE ---` when `.pending-turns.jsonl` is non-empty OR
`.pending-turns.processing` is stale (>= 900s); a fresh `.processing` suppresses it. It embeds
`$LEDGER_ROOT` only when `DIRECTIVE_LEDGER_SAFE` admits it — the positive shape
`^[A-Za-z0-9/._+-]+$` (`+` for Claude Code's `feat+x` worktrees), one `case` per embedded value
(ledger root for Section 2; project root + `~/.devflow` for Section 3). A refused root with
pending work emits the fixed single-quoted `--- LEARNING PAUSED ---` notice, which interpolates
nothing. Gated by the
same `queue_read_gates` read, resolved from `$TRACKER_DEVFLOW_DIR/manifest.json` and `$PROJECT_ROOT`
(`TRACKER_DEVFLOW_DIR="$HOME/.devflow"`, the machine root; the project root's `.devflow` is
`PROJECT_DEVFLOW_DIR` — the global `learning.json` read spells `$HOME/.devflow` too, so the two
no longer diverge). Model resolves bash-side (project → global → `"opus"`)
through a mandatory `case "$LEARNING_MODEL" in opus|sonnet|haiku)` allowlist before
interpolation — `learning.json` is user-controlled, so a newline-injected value must not reach
`additionalContext`. Emitted with `subagent_type="Learning"`, `run_in_background: true`.

### Section 3: Tracker Setup Directive

A second, independent directive shares the hook and injection shape but gates a different
feature and spawns the `Tracker` agent. NOT gated by the `learning` machine switch — tracker
provider selection is its own manifest field (`features.tracker.provider`), unaffected by #378.

**Gate order is cheapest-first**: sentinel-present-and-conventions-absent (1–2 `stat`, 0 forks
— proven, under provider `github`, to fork ZERO subprocesses); attempt cap via `read` (0 forks);
`source` ∈ {`startup`, `clear`} (1 fork); claim-file freshness (0–2 forks); provider allowlist
`jira|linear`, never `!= github` (1 fork).

**`.tracker.attempts`** is one decimal-integer line and nothing else (PF-062) — absent/malformed
→ 0, self-healed; 6+ digits treated as already at `TRACKER_ATTEMPTS_MAX=5` (a naive `-ge` on an
out-of-range value fails OPEN). The hook increments on EMISSION (a crashed agent still burns an
attempt); the agent deletes the counter only on a successful write, and always deletes the claim
file last. `TRACKER_PROVIDER_KEY_PATH` must literally match `src/core/tracker.ts`'s exported
constant (pinned in `tests/seams/tracker-key-path.test.ts`, forcing the node backend via
`_HAS_JQ=false` rather than editing `PATH`, avoiding PF-045). `TRACKER_PROCESSING_STALE_SECS=600`
is its own literal, deliberately not shared with Learning's 900s. Capped at
`tracker-section-max-chars` = 800 (ceiling in `tests/fixtures/numeric-floors.json`).

### Learning Agent

`src/assets/agents/learning.md` (`model: opus`) is self-contained. **Claim**: if `.processing`
is fresh (< 900s), exit silently; if stale (>= 900s), re-claim (touch + fold in queue); else
`mv .pending-turns.jsonl .pending-turns.processing` atomically — the 900s discriminator is
shared with `session-start-context`. **Processing**: Part 1 (detection) reads claimed turns +
log, appends/reinforces observations, promotes via `assign-anchor`, calls `refresh-anchor` after
reinforcing anchored obs; Part 2 (curation) runs `rotate-observations`/`retire-anchor`/
`refresh-anchor` for citation cleanup, heartbeating `.processing` at the boundary. **Final act**:
`unlink .pending-turns.processing` (PF-003 — `rm -f` denied; `unlink` passes).

**Ledger ops** — four, all via `json-helper.cjs`: `assign-anchor`, `retire-anchor`,
`refresh-anchor`, `rotate-observations`. Each self-locks (`withDecisionsLock`, `.decisions.lock`,
`LOCK_ACQUIRE_TIMEOUT_MS=30000`, `LOCK_STALE_MS=60000`; `rotate-observations` uses a separate
`.observations.lock`) — never wrap in an external lock or call >1 concurrently. All three of
`assign-anchor`/`retire-anchor`/`refresh-anchor` re-render `decisions.md`/`pitfalls.md`/
`index.md` (each write atomic; the sequence self-heals on the next op after a crash).
`assign-anchor` writes `anchor_id` back to the log row (arming a guard against a duplicate call)
and stamps `date` — older pitfall rows promoted before date-stamping may lack `date` (D5 fallback
in Gotchas). `refresh-anchor <anchor_id> [...]` (ADR-022 content-update path) is variadic — ONE
lock + ONE parse + ONE render for N anchors, all-or-nothing: locates the log obs by the LEDGER
ROW's `id` (not `anchor_id` — covers pre-write-back corpora, avoids PF-041), runs the REG-1
details-divergence guard (refuses when ledger `details` carries content absent from the log
row), re-projects via `toLedgerRow`, asserts row-count unchanged, writes once, renders once. A
ledger-existence guard refuses before acquiring the lock when no `decisions-ledger.jsonl`
exists; PF-014 throw-not-exit discipline applies to every error path (`process.exit()` skips
`finally` and leaks the lock — the outer `catch` in `require.main === module` prints
`json-helper error: <message>` and exits 1 instead).

`toLedgerRow` is a positive whitelist projector (ADR-022): committed row is exactly `{id, type,
pattern, details, anchor_id, decisions_status}` plus optional `{date, raw_body, amendments}` —
sink-validated (PF-023: type-mismatch throws, `pattern` line-terminator collapse prevents forged
`## ADR-NNN:` headings, `raw_body` gated by `isSafeRawBody`). A new ledger field must be added
here or it never survives projection. **details grammar**: `Key: value;` segments, anchored-key
detection at segment start (`reissue:` does not match `issue:`); decision keys `context`/
`decision`/`rationale`, pitfall keys `area`/`issue`/`impact`/`resolution`.
`decisions-format.cjs#segmentDetails` is the single authority (avoids PF-042); its **recovery
pass** (PF-044) searches any still-unset key via unanchored regex for legacy mid-segment rows,
never overriding an anchored match. **7-day protection window (D5)**: ledger `date` → log
`last_seen` → assume outside window — never assume the ledger row has `date`. **PF-040**: before
acting on a missing-path signal, determine live pointer (repair) vs. historical citation (leave
intact). **Directory bootstrapping** (PF-013): all three write ops `mkdirSync(recursive: true)`
before acquiring the lock, creating `.devflow/learning/` on first run.

### Tracker Agent

`src/assets/agents/tracker.md` (`model: sonnet`, no `tools:` key) is the second hook-spawned
background agent — the same claim/heartbeat/consume-then-delete shape as Learning, its own 600s
bound, and its own files (`.tracker.processing`, `.tracker.attempts`). The write is scrub-gated
through `redact-secrets.cjs` and create-exclusive (`umask 077` + `noclobber` + `chmod 600`) —
schema, domain rules, and the write-chain detail are owned by the `tracker-feature` KB.

### decisions-format.cjs

Shared pure formatting helpers (single source of truth for byte-compatible output strings):
`segmentDetails` (anchored-key parser; `LINE_TERMINATORS` `/[\r\n  ]/g` collapses at five sites
to guard the single-line field contract); `amendmentToString(entry)` (normalises `{date, note}`
objects — a bare `join` would emit `[object Object]`, load-bearing); `isSafeRawBody(body,
anchorId)` (PF-023 sink — accepts only a string with exactly one `## ${anchorId}:` heading;
rejected bodies render through the sanitised formatter); the `amendments` producer (`{date,
note}` objects only, schema rejects bare strings, PF-024 — follow with `refresh-anchor` to
propagate). **Date purity**: formatters read `row.date || ''` — no clock reads inside a
formatter (D5).

### Memory Worker (background-memory-update)

**Manifest handoff**: `memory-worker` resolves `DEVFLOW_MANIFEST` (`$HOME/.devflow/manifest.json`),
gates its own spawn decision on it, then hands that path explicitly to `background-memory-update`
as `$2` (`background-memory-update <CWD> [<manifest_path>]`) — the worker re-checks the switch
after spawn against the same manifest. When `$2` is absent, the worker falls back to
`$HOME/.devflow/manifest.json`. An exported `DEVFLOW_DIR` is ignored everywhere (D-ONE-HOME).

**Staged-write CAS (`verify_and_swap()` — applies ADR-023)**: the model writes ONLY
`WORKING-MEMORY.md.new`, never the real file; `verify_and_swap()` assigns one OUTCOME —
`updated` (valid stamp + matching pre/post cksums → atomic `mv`, remove `.processing`, touch
`.last-refresh-ok`), `conflict` (cksum mismatch or failure → staged file dropped, `.processing`
retained with a heartbeat touch extending the 300s cold-path liveness window, `.last-refresh-ok`
untouched), or `failed` (staged file missing/empty/unstamped or `mv` failed → `.processing` left
for D56c cold-path recovery). `cksum` must be on PATH at startup or the worker exits rather than
run without a CAS guard; a `cksum` failure on the target file forces `conflict` (fail-closed).
The stale-staged-file cleanup (`rm -f WORKING-MEMORY.md.new`) runs at the START of each run.

`compute_commits_since_note()` sets `COMMITS_SINCE_NOTE` in caller scope. Five exact outcome
literals form a **test contract**: no-stamp full-synthesis, invalid-SHA-format,
SHA-not-ancestor-of-HEAD, none-current-as-of-HEAD, and `N commit(s)... (showing newest 20)`
(disclosure only when total > 20; subjects bounded at `%.100s`). **Prompt security**: the four
untrusted data blocks are wrapped in named XML tags with a DATA-not-instructions preamble
(PF-023); the prompt is passed via heredoc stdin, never argv (visible to `ps(1)`).

### Shared Sourced Helpers, Bootstrap, and Refresh-Failing Detection

**`is-hex-sha`** (sourced, no forks, PF-008-safe): `is_hex_sha <value> [min=7] [max=40]`.
`background-memory-update`/`session-start-memory` use the default 7–40; `pre-compact-memory`
requires exactly 40 (a full SHA). **pre-compact-memory** bootstraps `WORKING-MEMORY.md` only
when `is_hex_sha "$GIT_HEAD_SHA" 40 40` (an unborn branch fails); a detached HEAD is labelled
`(detached)` first (D-DETACHED-HEAD), so it bootstraps with `branch: (detached)`, a Context line
`- Branch: (detached) @ <short-sha>` and `git.branch: "(detached)"` in backup.json, and
`background-memory-update` stamps the same label. `session-start-memory` renders the header's
location as `on <branch>`, `detached @ <short-sha>`, or `on unknown` only when unreadable. The
bootstrap is noclobber-atomic (`set -o noclobber; : >
"$MEMORY_FILE"`, REL-5) so a worker CAS `mv` landing in the narrow window fails `noclobber`
rather than truncating. **session-start-memory**'s `detect_refresh_failing()` (B4) counts
BOTH `.pending-turns.jsonl` and `.pending-turns.processing` additively, so an orphaned
`.processing` left by CONFLICT is no longer invisible to the State-C warning.

### decisions_load() and index.md Consumption

`decisions_load()` has the main model run ONE `git -C "{start}" rev-parse --path-format=absolute
--show-toplevel --git-common-dir` and read `{ledger}/.devflow/learning/index.md`, where `{ledger}`
is the main worktree (when its `.devflow/` exists and it is not HOME), else the toplevel (on git < 2.31, the line
after the echoed `--path-format=absolute`), else the start directory —
the hooks' D-LEDGER-MAIN-WORKTREE rule (D-PROMPT-ROOT). No script (ADR-007). Absent/empty →
`DECISIONS_CONTEXT` is `(none)`. Consuming
commands use `devflow:apply-decisions`: scan index → Read entry bodies on demand → cite verbatim
IDs. Never parse `decisions-ledger.jsonl` directly.

### HUD and CLI

`src/hud/components/learning-counts.ts` reads `decisions-ledger.jsonl` and counts rows where
`anchor_id` is set and `decisions_status` is not in `{Deprecated, Superseded, Retired}` (D309 —
avoids HUD coupling to markdown format).

The HUD (`gatherLedgerLearningCounts`, run inside the git-status `Promise.all`, 1 s git budget)
and `devflow learning --status/--list/--clear/--reset` plus the `--disable` drain locate the
ledger with `getLedgerRoot` (`src/core/ledger-root.ts`) — the TypeScript twin of
`DF_LEDGER_ROOT`: one `rev-parse --path-format=absolute --show-toplevel --git-common-dir`,
main worktree when `<main>/.devflow` is a directory and `<main>` is not HOME (realpath compare),
else the toplevel (git < 2.31's echo included), `null` outside git (the caller keeps its cwd
fallback). Parity with `df_resolve_roots` is pinned by `tests/core/ledger-root.test.ts`, which
runs the shell helper on the same fixtures. `--configure` writes the project `learning.json` at `getLedgerRoot()` (cwd outside git), where `session-start-context` reads it; `init --no-learning` drains the learning queue there too.
Memory is never resolved this way — it stays per checkout (`getGitRoot`).

All three feature CLIs share the `writeMachineFeature`/`readMachineFeature` shape, plus their
own per-repo side effects: **`devflow learning --enable/--disable`** writes `features.learning`
(same call `init --learning/--no-learning` makes); disable drains the CURRENT project's queue
via `drainLearningQueue` (other repos are already inert once the manifest switch is off);
`--status` pairs `readMachineFeature` with observation counts; `--list`/`--configure`/`--clear`/
`--reset` are per-repo, untouched by the switch. **`devflow memory --enable/--disable`**
converges the Stop/SessionStart/PreCompact hooks via `convergeMemoryHooks` (settings transform
runs FIRST — can reject malformed JSON, so the switch must not record unless the hooks can
follow) AND writes `features.memory`; disable drains via `drainMemoryQueue`; `--status` pairs
`readMachineFeature` with the installed hook count (`enabled, but N/3 hooks registered` on
mismatch). **`devflow knowledge --enable/--disable/--status`** (`knowledge/toggle.ts`) is a thin
router into `handleToggle` for `features.knowledge`; the CRUD subcommands (create/check/refresh/
remove) are deleted — KBs are created only via write-through from `knowledge_writeback`.

**Hook ownership (D-EXACT-HOOK-OWNER, #391).** `memory.ts`, `capture.ts`, `context.ts` and
`legacy-hooks.ts` identify their hooks through the shared helpers in
`src/targets/claude-code/hooks.ts`: a hook is devflow's only when its command ENDS in
`/scripts/hooks/run-hook <marker>` (`devflowHookOwner`) under any directory, never because it
contains the marker word, and `removeHooks` takes single hooks out of a matcher group, dropping
the group only when it ends up empty. `memory.ts`'s `LEGACY_HOOK_SUFFIXES` names each ending an
earlier release registered, per event: the v1 (<= v1.2) direct scripts
`/scripts/hooks/{stop-update-memory,session-start-memory,pre-compact-memory}.sh` and the retired
run-hook markers (prompt-capture-memory, stop-update-memory, stop-update-learning,
session-end-learning, session-end-decisions, session-end-knowledge-refresh, sidecar-*, dream-*).
Those are removed on every converge but never counted as a current memory hook. Capture, context
and spawn-dream-worker only ever shipped through run-hook, so they have no legacy form. Remove-then-add
keeps a user's group in place and appends devflow's hook after it, so the Stop-array
append-before-spawn order (capture-turn before memory-worker) still holds.

### devflow init and the Machine Switches

**D-INIT-DRAIN-AFTER-SWITCH**: `drainDisabledFeatureQueues` drains this repo's memory/learning
queues for each feature `init` switched off — the same drains the standalone `--disable`
commands perform — but ONLY AFTER the manifest write (`trackerLifecycle.manifestWritten`) lands,
never before (draining first would leave a window where a concurrent session, still reading the
old "on" manifest, appends turns that survive the disable). A failed manifest write leaves the
feature on everywhere, so its queue is correctly left alone; other repos never need draining.

**`--hud-only` preserves every feature** (`D-HUD-ONLY-PRESERVE`): re-init keeps every recorded
manifest value — plugins, version, scope, `installedAt`, every `features.*` — changing only
`features.hud`. With memory/learning/knowledge living ONLY in the manifest, a HUD-only install
that reset those would really disable them everywhere.

### Locking

`learning-lock`: `learning_lock_acquire <lock_dir> [timeout=3s]` polls `mkdir`; breaks stale
locks older than 30s via `get_mtime`. Scope is narrow — only the overflow truncation path. JSONL
append is intentionally lock-free (accepted-class race, shared with memory design).

## Naming Boundary (Critical Convention)

The Learning agent processes the queue and produces **decisions content**; content identifiers
deliberately keep their original "decisions" names even though the outer system is "learning."
Do not rename them: `decisions.md`/`pitfalls.md` (rendered output), `decisions-ledger.jsonl`
(anchored ledger), `decisions-log.jsonl`/`decisions-log.archive.jsonl` (raw observation history),
`index.md` (pre-rendered compact index), `decisions_status` (ledger field),
`DECISIONS_CONTEXT`/`decisions_load()` (macros), `render-decisions.cjs`/`decisions-format.cjs`/
`decisions-usage-scan.cjs` (scripts), ADR-NNN/PF-NNN (anchor ID format). The directory is
`learning/`, the feature toggle is `features.learning` (manifest, repo-narrowable), the agent is `Learning`
— but everything it produces uses "decisions" identifiers. Intentional; do not "fix" the mismatch.

## Anti-Patterns

- **Reading feature flags with two separate `json_field_file` calls**: use `queue_read_gates`
  (AC-P1 — one subprocess). Two forks double overhead on every hook invocation.

- **Reading or writing top-level `.devflow/config.json` keys for memory/learning/knowledge on/off
  state**: those keys are retired (`RETIRED_CONFIG_KEYS`); no gate reads them. Use
  `readMachineFeature`/`writeMachineFeature` against `~/.devflow/manifest.json` instead — this is
  exactly the bug #378 fixed. The only repository switch is `features.<x>: false`, and it only
  narrows.

- **Omitting `<root>` from a `queue_read_gates` call**: the repository's narrowing is then silently
  ignored. `tests/queue-append.test.ts` pins every caller's shape.

- **Resolving the manifest path from the project root**: the manifest lives at the machine root
  (`$HOME/.devflow/manifest.json`), never under `PROJECT_DEVFLOW_DIR`. A gate pointed at the
  project path finds no manifest — reads as fail-open ON regardless of the real switch.

- **Editing `decisions.md`/`pitfalls.md`/`index.md` directly**: exclusively owned by the ledger
  ops; hand-edits get silently overwritten.

- **Editing the ledger directly for content changes**: the log is the content authority
  (ADR-022); edit the log row then call `refresh-anchor`.

- **Using `rm -f` to delete `.pending-turns.processing`**: denied by the recommend deny-list
  (denial keys on flags, not verb — PF-003). Use `unlink`; a flagless `rm` also passes.

- **Skipping the model allowlist in `session-start-context`**: always apply `case "$LEARNING_MODEL"
  in opus|sonnet|haiku)` before interpolating — the tracker directive applies the identical
  discipline to `TRACKER_MODEL`.

- **Adding throttle or lock on the learning directive side**: queue emptiness is the natural
  gate; a live `.processing` already suppresses the directive.

- **Omitting `DEVFLOW_BG_UPDATER=1` guard**: without it, the memory worker's `claude -p` session
  double-captures its own turns into both queues.

- **Running more than 10 `refresh-anchor` calls per run**: batch into a single variadic call; the
  next run continues.

- **Consuming `config.tracker` (the raw field) directly**: always go through
  `parseTrackerOverride`, not a hand-rolled check.

- **Simulating a missing shell tool by subtracting it from `PATH`** in a hook test:
  platform-dependent. Force a backend via a variable override (`_HAS_JQ=false`) instead (PF-045).

## Gotchas

- **900s staleness threshold is shared**: `session-start-context` and the Learning agent both
  use it — if one changes, both must. `TRACKER_PROCESSING_STALE_SECS=600` is deliberately a
  SEPARATE literal — a shared constant would let either feature reclassify the other's live runs.

- **The legacy key wins only when the renamed key is not a boolean**: an older manifest with
  `"decisions": false`/no `"learning"` switches learning off, and `"kb": false`/no `"knowledge"`
  switches knowledge off; once the renamed key is a boolean, it wins outright.

- **HUD reads `decisions-ledger.jsonl`**: an `observing` row without `anchor_id` contributes 0 —
  a row is active only when `anchor_id` is set AND `decisions_status` is not in the inactive set.

- **`capture-turn` runs `decisions-usage-scan.cjs` regardless of queue gates**: the grep-first
  gate precedes the feature flag check.

- **`process.exit()` skips `finally` in `.cjs` helpers**: throw inside any locked `try` block;
  never `process.exit(1)`.

- **`refresh-anchor` looks up log obs by the LEDGER ROW's `id`** (not `anchor_id`): pre-write-back
  corpora had no `anchor_id` in the log.

- **D5 pitfall-rows date fallback**: ledger `date` → log `last_seen` → outside window — never
  assume the ledger row has `date` for old pitfall rows.

- **CAS CONFLICT heartbeat-touches `.processing`**: distinct from the claim-time touch; removing
  it would let the cold path reclaim a live retry batch after 300s.

- **Pre-compact bootstrap skips only unborn branches**: a detached HEAD bootstraps with the
  `(detached)` label (D-DETACHED-HEAD). `(detached)` is a legal git branch name, so the label is a
  name, never a decision input beyond the session-start mismatch note.

- **The learning queue is not always under the session's own root**: in a linked worktree it is
  the main worktree's (`DF_LEDGER_ROOT`). Tests seeding a queue for a worktree session must seed
  main's.

- **`compute_commits_since_note()` outcome literals are a test contract**: exact strings, do not
  fail loudly if changed.

- **Orphan gate skips when `.processing` already exists**: with a live retry batch, the combined
  content is used directly.

- **`is_hex_sha` bounds are call-site-specific**: pre-compact-memory uses 40–40; the other two
  callers use the default 7–40.

- **`json_extract_cwd_field` SOH delimiter**: split with `$'\001'`; both jq and the node fallback
  must emit `\x01`.

- **Section 3 is not gated by the `learning` toggle**: disabling learning does not disable the
  issue tracker.

- **Every `session-start-context` test seeds a temp `$HOME`** (the hooks read `$HOME/.devflow`
  only, so HOME is the whole isolation) — since manifest resolution is user-scope by design, a real `~/.devflow/manifest.json` with
  `features.learning: false` on the test machine would otherwise silently gate the test.

- **A shell command-rewrite hook can silently truncate a `cat`/`head` read of a `.devflow` data
  file**, announced only on stderr — exactness-critical reads need the Read tool (PF-035).

## Key Files

| File | Purpose |
|------|---------|
| `src/assets/scripts/hooks/capture-prompt` | UserPromptSubmit: dual-queue user turn append |
| `src/assets/scripts/hooks/capture-turn` | Stop: dual-queue assistant turn + usage scanner |
| `src/assets/scripts/hooks/capture-question` | PostToolUse: AskUserQuestion Q&A row append |
| `src/assets/scripts/hooks/queue-append` | Shared JSONL append + overflow truncation + `queue_read_gates` |
| `src/assets/scripts/hooks/resolve-project-root` | `df_resolve_root` (toplevel) and `df_resolve_roots` (one git call → `DF_ROOT` + `DF_LEDGER_ROOT`) |
| `src/assets/scripts/hooks/git-marker` | `df_has_git_marker`, `df_is_project_root` — the zero-fork git-only gate |
| `src/assets/scripts/hooks/learning-lock` | mkdir-based lock (30s stale-break) |
| `src/assets/scripts/hooks/is-hex-sha` | Pure-shell hex-SHA check; sourced by three memory hooks with different bounds |
| `src/assets/scripts/hooks/session-start-context` | Learning directive (Section 2) + tracker-setup directive (Section 3) |
| `src/assets/scripts/hooks/memory-worker` | Resolves the manifest path, gates on it, spawns background-memory-update with that path as `$2` |
| `src/assets/scripts/hooks/background-memory-update` | Detached worker: compute_commits_since_note, verify_and_swap, CAS; accepts manifest path as `$2` |
| `src/assets/scripts/hooks/pre-compact-memory` | PreCompact: backup.json + noclobber-atomic WORKING-MEMORY.md bootstrap |
| `src/assets/scripts/hooks/session-start-memory` | SessionStart: 3-state memory header + State-C refresh-failing |
| `src/assets/agents/learning.md` | Learning agent spec (claim, detect, curate, unlink) |
| `src/assets/agents/tracker.md` | Tracker agent spec — schema/domain owned by `tracker-feature` KB |
| `src/assets/scripts/hooks/json-helper.cjs` | Ledger ops: assign-anchor, retire-anchor, refresh-anchor, rotate-observations; withDecisionsLock |
| `src/assets/scripts/hooks/lib/decisions-format.cjs` | segmentDetails, amendmentToString, isSafeRawBody, toLedgerRow |
| `src/assets/scripts/hooks/lib/render-decisions.cjs` | Pure renderer — decisions.md, pitfalls.md, index.md from ledger rows |
| `src/core/feature-switch.ts` | `MachineFeature` type; `isMachineFeatureOn`/`setMachineFeature` (pure); `readMachineFeature`/`writeMachineFeature` (I/O) — the single authority for memory/learning/knowledge on-off |
| `src/core/feature-config.ts` | `.devflow/config.json` read/write; `RETIRED_CONFIG_KEYS`; per-repo `tracker` override; `mergeManagedConfig`/`writeManagedConfig` |
| `src/core/learning-tuning-config.ts` | Tuning config merge (project → global → defaults) — unrelated to the on/off switch |
| `src/core/project-paths.ts` | Path construction — single source of truth, mirrored in `src/assets/scripts/hooks/lib/project-paths.cjs` |
| `src/cli/commands/learning.ts` | `devflow learning` CLI — `writeMachineFeature`/`readMachineFeature` |
| `src/cli/commands/memory.ts` | `devflow memory` CLI — `convergeMemoryHooks` + `writeMachineFeature`; `drainMemoryQueue`; `LEGACY_HOOK_SUFFIXES` |
| `src/targets/claude-code/hooks.ts` | Shared hook types + D-EXACT-HOOK-OWNER helpers: `devflowHookOwner`, `endsWithAny`, `removeHooks`, `hasHook`, `ensureHook`, `runHookCommand` |
| `src/cli/commands/knowledge/toggle.ts` | `devflow knowledge --enable/--disable/--status` |
| `src/cli/commands/init.ts` | `drainDisabledFeatureQueues` (D-INIT-DRAIN-AFTER-SWITCH), `D-HUD-ONLY-PRESERVE`, the one `manifestData.features` write site |
| `src/hud/components/learning-counts.ts` | HUD counts from `decisions-ledger.jsonl` |
| `src/core/ledger-root.ts` | `getLedgerRoot` — the CLI/HUD twin of the hooks' `DF_LEDGER_ROOT` |
| `src/assets/commands/_partials/_knowledge.mds` | `knowledge_load()`/`knowledge_writeback()` — write-back takes `KNOWLEDGE=` from the settings line |
| `src/assets/commands/_partials/_decisions.mds` | `decisions_load()` macro (plain file Read per ADR-007) |
| `src/assets/scripts/hooks/decisions-usage-scan.cjs` | Citation counter (D29 grep-first gate) |
| `tests/seams/tracker-key-path.test.ts`, `tests/seams/tracker-claim-staleness.test.ts` | Pin key-path parity and the shared claim-staleness bound |

## Related

- **ADR-022** — decisions-log.jsonl is the single content authority; the ledger is an anchor registry; ops project log→ledger→rendered .md; `refresh-anchor` is the projection-refresh path
- **ADR-023** — staged CAS for the memory worker (`WORKING-MEMORY.md.new`); `verify_and_swap()` is the sole CAS decision point; `CKSUM_FAILED` forces conflict (fail-closed)
- **PF-044** — REG-1 divergence guard in `refresh-anchor`; recovery pass in `segmentDetails` for legacy mid-segment keys
- **PF-023** — validate at the sink: `isSafeRawBody` in `toLedgerRow`; named XML tags in memory worker prompt
- **PF-042** — `segmentDetails` anchored-key approach avoids delimiter-regex truncation
- **PF-040** — pointer-vs-citation gate for missing-path signals in decisions/evidence
- **ADR-007** — `index.md` consumption via plain Read; no subprocess
- **ADR-011** — original rationale for a neutral, feature-agnostic config home for multi-feature toggles; superseded for memory/learning/knowledge by D-FEATURES-NARROW-ONLY (`src/core/feature-switch.ts`, #378/#392: machine switch, repository narrows via the new `features` namespace) — its top-level toggles stay retired
- **PF-003** — use `unlink` not `rm -f` for the agent's final act
- **PF-014** — throw inside lock scopes, never `process.exit()`; precondition asserts in `refresh-anchor`
- **PF-013** — parent directory of lock dir created before acquire (`withDecisionsLock`)
- **PF-045** — simulating a missing shell tool via `PATH` subtraction is platform-dependent; `tests/seams/tracker-key-path.test.ts` avoids it with a backend variable-switch override
- **PF-062** — document the shape of any file that gates a suppressing action, and keep absent and malformed distinct from a value; the `.tracker.attempts` parse follows this directly
- **PF-035** — a shell rewrite hook can silently substitute a lossy view for a literal file read; the load-bearing surface is exactly the Learning/Tracker agents' direct `.devflow` data-file consumption
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — Knowledge agent write-back pattern (parallel write-through system); its opt-out gate takes `KNOWLEDGE=` from the settings line, which folds the same `features.knowledge` switch this KB documents with the two repo files
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md` — Ambient orchestrator that also uses `session-start-context` for charter injection
- `.devflow/features/tracker-feature/KNOWLEDGE.md` — owns the tracker feature's full story (provider selection, the Tracker agent's schema/domain, the Git agent's reader-side preamble); this KB owns only the hook plumbing and the directive pattern shared with Section 2

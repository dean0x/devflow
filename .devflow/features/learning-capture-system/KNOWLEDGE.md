---
feature: learning-capture-system
name: Learning capture system
description: "Use when modifying the learning store (hooks/lib/learning-store.cjs) or any json-helper learning op (put-observation, list, show, claim-due, claim-queue, release-claim, assign-anchor, refresh-anchor, retire-anchor, restore-anchor, rotate-observations), the v2 observation and ledger schema or its limits, the decisions log, ledger, history, rejected and pre-v2 files, the rendered decisions.md, pitfalls.md and index.md (v2 body, Inactive table, TL;DR count), the Learning agent (src/assets/agents/learning.md), the owned queue claim and its heartbeat, the devflow learning CLI (--status, --list, --show, --restore, --clear, --reset), how commands, the Code agent and the orchestrator charter load DECISIONS_CONTEXT from the main worktree, the capture hooks (capture-prompt/capture-turn/capture-question/queue-append), the learning or memory pending-turns queues, the session-start-context learning (TL;DR, Index line, LEARNING MAINTENANCE) or tracker-setup directives, the machine-wide feature switches (memory/learning/knowledge in ~/.devflow/manifest.json), the per-repo tracker override in .devflow/config.json, the learning tuning config, the memory worker, the pre-compact backup (backup.json) and its read at session start, the jq-less JSON fallback (the json-parse wrappers over json-helper's generic ops), how the hooks, the store, the CLI and the HUD refuse to read, write or rename through a symbolic link under a project .devflow (df_no_symlink_below and df_file_below in git-marker, the linked-tree refusal of the learning writers, the link-safe store reads, firstSymbolicLink and the queue drains, the root .gitignore link rule, the bounded HUD ledger read), or the Skim agent's decisions TL;DR. Keywords: learning-store, learning-store.cjs, withDecisionsLock, .decisions.lock, put-observation, observation, claim-due, claim-queue, release-claim, assign-anchor, refresh-anchor, retire-anchor, restore-anchor, rotate-observations, decisions-log, decisions-ledger, decisions-history, rejected.jsonl, pre-v2, schema 2, ledger registry, quarantine, verify ref, due selection, integrity flags, last_verified, last_attempt, Inactive table, TL;DR, index.md, render-decisions, decisions-format, formatEntryBodyV2, DECISIONS_CONTEXT, decisions_locate, decisions_load, apply-decisions, orchestrator charter, Learning agent, LEARNING MAINTENANCE, LEARNING PAUSED, heartbeat, .pending-turns.processing, .pending-turns.owner, D-OWNED-CLAIM, clearUnreferenced, resetLearning, LEARNING_STORE_SURFACE, loadLearningStore, capture-prompt, capture-turn, capture-question, queue-append, pending-turns, queue_read_gates, memory-worker, TRACKER SETUP, TRACKER_PROCESSING_STALE_SECS, tracker-section-max-chars, .tracker.{provider}.attempts, .tracker.enabled, .tracker.processing, DEVFLOW_BG_UPDATER, learning-lock, isMachineFeatureOn, readMachineFeature, writeMachineFeature, feature-switch, manifest.json, RETIRED_CONFIG_KEYS, feature-config, learning.json, staged-write CAS, WORKING-MEMORY.md.new, verify_and_swap, compute_commits_since_note, is-hex-sha, pre-compact-memory, session-start-memory, backup.json, D-BACKUP-RENAME, noclobber, mode 0600, json-parse, json_field_file, jq-less fallback, get-field, extract-cwd-field, backup-construct, Skim agent, symbolic link, symlink, D-HOOKS-NO-SYMLINK, df_no_symlink_below, df_file_below, git-marker, D-NO-LINKED-TREE, D-NO-LINKED-READ, linkedLearningFolder, readTextUnlinked, D-CLI-NO-SYMLINK, firstSymbolicLink, drainQueueFiles, formatRefusedDrain, D-GITIGNORE-LINK-INSIDE, _erg_resolve_inside, resolveGitignoreTarget, D-HUD-LEDGER-BOUNDED, LEDGER_MAX_BYTES, readBoundedLedger."
category: architecture
directories:
  - src/assets/scripts/hooks
  - src/assets/scripts/hooks/assets/orchestrator-charter.md
  - src/assets/agents/learning.md
  - src/assets/agents/tracker.md
  - src/assets/agents/skim.md
  - src/assets/commands/_partials/_decisions.mds
  - src/assets/skills/apply-decisions/SKILL.md
  - src/cli/commands/learning.ts
  - src/cli/commands/memory.ts
  - src/cli/commands/knowledge
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
updated: 2026-10-07
---

# Learning Capture System

## Overview

Three always-on hooks capture conversation turns into two independently gated JSONL queues, and two processors drain them. The **memory queue** (`.devflow/memory/.pending-turns.jsonl`) is drained by the detached `background-memory-update` worker on a 120s throttle. The **learning queue** (`.devflow/learning/.pending-turns.jsonl`) is drained by the **Learning agent**, a background subagent that `session-start-context` tells the main model to spawn whenever turns are pending. Scripts capture and trigger only. The agent makes every judgment (is this a decision or a pitfall, is that entry still true); plumbing does the rest: validate, number, lock, project, render.

Learning v2 makes **`hooks/lib/learning-store.cjs` the single schema authority**. An *observation* (title, rule, why, scope, provenance) is stored once in the log, the content authority. A *ledger* row projects it under an ADR/PF number and adds what is about the entry rather than in it. `decisions.md`, `pitfalls.md` and `index.md` are generated from the ledger. The agent has four tools (Read, Bash, Glob, Grep) and writes only through `json-helper.cjs` ops that take JSON on stdin. Files are rewritten in place under one lock; history, quarantine and a one-time backup protect what a rewrite replaces.

**Ledger IDs stay on the machine.** The ledger is gitignored and numbered per machine, so an ADR-NNN or PF-NNN resolves on no other clone and numbers get reused. Anything committed, pushed or posted (code, docs, this KB, commit messages, PR text) states the rule in words; IDs live only in a session's reasoning, handoffs and reports. An observation's title, rule and why may not name an entry either (the op refuses). `tests/guards/no-ledger-citations.test.ts` enforces the committed half.

**No read, write or rename goes through a symbolic link under a project's `.devflow/`.** A repository can commit a link anywhere in its own `.devflow/`, so the hooks, the learning store, the CLI and the HUD each refuse to follow one, by their own helper (Links under `.devflow/`, below). Someone who deliberately links `.devflow`, or its `memory` or `learning` folder, gets no capture there.

## System Context

### Data files and the naming boundary

| File in `.devflow/learning/` | Holds |
|---|---|
| `decisions-log.jsonl` | observations, the content authority |
| `decisions-ledger.jsonl` | entries: projections of log rows plus ledger-owned fields |
| `decisions-log.archive.jsonl` | observations rotated out of the log |
| `decisions-history.jsonl` | the last 3 prior versions of each rewritten observation and its entries |
| `*.rejected.jsonl` | malformed lines a writer moved aside before rewriting a file |
| `*.pre-v2.jsonl` | one-time copies of the log, ledger and archive made before the first v2 write to a v1 tree |
| `decisions.md`, `pitfalls.md`, `index.md` | generated from the ledger, never hand-edited |
| `.decisions.lock/` | the one learning lock |
| `.pending-turns.jsonl`, `.pending-turns.processing`, `.pending-turns.owner` | the queue, the claimed batch, its owner's token |
| `learning.json` | agent tuning `{model, debug}`; the project file overrides `~/.devflow/learning.json` |

Content identifiers keep their "decisions" names although the system is "learning": `decisions-*.jsonl`, `decisions_status`, `DECISIONS_CONTEXT`, `decisions_load()`, `render-decisions.cjs`, `decisions-format.cjs`, ADR-NNN/PF-NNN. The directory is `learning/`, the switch `features.learning`, the agent `Learning`. Do not "fix" the mismatch.

### Feature switches: machine switch, repository narrows (D-FEATURES-NARROW-ONLY)

`features.memory|learning|knowledge` in `~/.devflow/manifest.json` is the MACHINE switch; `devflow init` and `devflow memory|learning|knowledge --enable/--disable` write it. A repository can only turn a feature OFF: effective = machine AND `.devflow/project.json` `features.<name>` (team, committed) AND `.devflow/config.json` `features.<name>` (personal), where only a literal `false` narrows. The retired top-level keys (`RETIRED_CONFIG_KEYS`: memory, learning, knowledge, decisions, autoCommit) never narrow and are dropped on the next managed write, so no repository can keep a feature running that the machine switched off. Readers:

- `resolve-settings.cjs` folds all three layers into the `MEMORY=`/`LEARNING=`/`KNOWLEDGE=` settings line, which the knowledge write-back gate consumes.
- The shell hooks call `queue_read_gates <manifest_path> <root>` (memory and learning only; every caller passes `$PROJECT_ROOT`).
- The CLI's `--status` calls `readMachineFeature`, plus `Effective here: disabled (<file>)` when a repository file narrows.

Rules: **D-GATES-FAST-PATH**: each repository file gets a bounded builtin read (`read -r -d '' -n 4097`); a cut-short read (NUL or over 4096 bytes) is invalid and narrows nothing; text with no `\u` and no `"features"…{…"memory|learning"…false` sequence cannot narrow, so zero forks. Otherwise exactly ONE `node` fork runs `resolve-settings.cjs`'s `readRepoLayers` + `foldSettings`, so every file rule (symlink, size, BOM, UTF-8, duplicate keys) is the parser's. **D-FEATURES-ABSENT-ON**: only an explicit boolean `false` switches off; an absent manifest, `features` object or key, or a non-boolean, reads ON. `isMachineFeatureOn(rawManifest, feature)` is the pure predicate and `queue_read_gates` applies the identical rule; neither is built on `readManifest()`, which returns null for a manifest missing required fields and heals writes back to disk. **Legacy keys**: a feature reads its current key when boolean, else its legacy key (`learning`←`decisions`, `knowledge`←`kb`) when boolean, else ON; `queue_read_gates` mirrors it for learning only. `writeMachineFeature` writes ONLY `features.<feature>` and `updatedAt` and answers `{ok:false, error:'not-installed'}` when no manifest exists.

`.devflow/config.json` keeps one non-boolean field, `tracker` (the per-repo provider override), read by `parseTrackerOverride` (TS) and `resolve-settings.cjs` (`parsePersonalBytes`); both must agree (`tests/seams/tracker-key-path.test.ts`). Never consume `config.tracker` raw.

### Roots and gates (D-HOOKS-GIT-ONLY, D-LEDGER-MAIN-WORKTREE)

Hooks resolve roots from git, never from cwd. `df_resolve_roots` (`resolve-project-root`) makes ONE `git rev-parse --path-format=absolute --show-toplevel --git-common-dir` call and sets `DF_ROOT` (the checkout toplevel: memory, carve-out, KBs) and `DF_LEDGER_ROOT` (the main worktree when its `.devflow/` exists and it is not HOME, else `DF_ROOT`). The capture hooks append learning turns under `DF_LEDGER_ROOT`; memory stays at `DF_ROOT`. `ensure-devflow-init` scaffolds `learning/` only where the ledger lives; the capture hooks and `session-start-context` (healing an older install) create it at the ledger root. `df_is_project_root` (a `.git` entry AT the root, physical path not HOME's, D-HOOKS-TOPLEVEL-ONLY) gates per-project work, so memory and learning stop together outside git. The CLI/HUD twin is `getLedgerRoot` (`src/core/ledger-root.ts`, parity pinned by `tests/core/ledger-root.test.ts`); memory is never resolved that way.

### Links under `.devflow/` (D-HOOKS-NO-SYMLINK and its siblings)

A repository can commit a symbolic link anywhere in its own `.devflow/`, and the shell's `>>`, `touch`, `mkdir -p`, `mv`, `head`, `sed`, `read` and `jq` follow one, as Node's file calls do. A linked queue would carry captured conversation text out of the project; a linked working memory, backup, decisions file or ledger would bring a file from elsewhere on the machine into the session, a prompt, a backup or a render, with no one choosing to read it; a linked folder would take a lock, a rewrite or a delete to wherever it points. Each surface refuses by its own helper:

- **D-HOOKS-NO-SYMLINK (hooks).** A hook writes, reads or renames under a project's `.devflow/` only where no link sits on the way down from the project root. A refused write or rename is skipped and a refused read is treated as an absent file; each is logged once through the caller's `log()` and the hook carries on. The hooks that apply it are the three capture hooks (through `queue-append`), `ensure-devflow-init`, `session-start-context`, `session-start-memory`, `pre-compact-memory`, `memory-worker` and `background-memory-update`. `hooks/git-marker` holds the helpers, builtins only (`[ -L ]` and parameter expansion, zero forks): `df_no_symlink_below <root> <path>...` answers 0 when no path, and no folder between `<root>` and it, is a link, and 1 for a link and for any call it cannot vouch for (no path, an empty root, a path not below the root, an empty, `.` or `..` part, more than 64 parts); `df_file_below <root> <path>` answers 0 only for a regular file the first admits and logs the refusal (`[ -f ]` follows a link, so a dangling link or a link to a folder reads as absent with nothing logged). Both are predicates: call them in an `if` or `||`, never as a plain statement under `set -e`. The root and the folders above it are deliberately not checked: the root is where the session runs or where git keeps the ledger, the user's choice and not the repository's, and a parent may legitimately be a link (macOS `/tmp` and `/var` lead into `/private`). The check runs just before the use, so a link swapped in between is not stopped; that process already runs as the user.
- **D-NO-LINKED-TREE (store writers).** `withDecisionsLock` refuses, changing nothing and before it takes the lock, when `<root>/.devflow` or `<root>/.devflow/learning` is a link: error kind `not-a-directory`, message `<op>: <folder> is a symbolic link, not a directory; nothing was changed`, exit 1 with empty stdout from `json-helper`. Every writer is refused in that one place (the puts, assign, refresh, retire, restore, rotate, claim-due, claim-queue, release-claim, `render`, `--clear`, `--reset`), and the claim heartbeat leaves a claim in such a tree alone (`touchClaim` answers `touched: false`). `linkedLearningFolder` lstat-checks the two folders and `linkedFolder` builds the refusal; `resetLearning` carries no check of its own.
- **D-NO-LINKED-READ (store reads).** `readJsonl` reads a learning file that is itself a link as missing: `readTextUnlinked` lstats it, then opens with `O_NOFOLLOW`, so a link swapped in after the lstat fails the open instead of being read. A linked log, ledger, archive or history file is therefore invisible to `list`, `show`, `--status` and every writer's own read, so no rewrite, quarantine or render copies its lines into the project, and `ensurePreV2Backup` skips a linked source. Only the file itself is checked, not the folders above it.
- **D-CLI-NO-SYMLINK (CLI).** `firstSymbolicLink(paths)` in `src/core/linked-path.ts` lstats each path, returns the first link, and rethrows any lstat failure other than ENOENT or ENOTDIR, so a caller that cannot check acts on nothing. The CLI writes or deletes under `.devflow/` only past it: `devflow init` (the carve-out marker, the legacy markers and `config.json` through `writeManagedConfig`, whose temp copy is created with `wx`), `devflow learning --configure` (the project `learning.json`) and every queue drain: `drainLearningQueue` and `drainMemoryQueue` share `drainQueueFiles` in `src/core/queue-drain.ts`, and `devflow memory --clear` checks each project in `cleanQueueFiles`. A drain that meets a link deletes nothing and answers `{drained: false, linkedFolder}` (`cleanQueueFiles` lists the project in `refused`); `formatRefusedDrain` words the warning, which is all a refused drain adds: the switch the command turned off stays off.
- **D-GITIGNORE-LINK-INSIDE (root `.gitignore`).** The one file a hook writes outside `.devflow/`. A linked root `.gitignore` is written only when the file it resolves to lies inside the project and outside its `.git`, and then that file is read and written directly, never through the link; otherwise nothing is read or written anywhere, no marker is stamped, and the skip is logged once by the hook or warned by `init`. A file under `.git` is git's own hooks and config, not one of the repository's. The link is followed one hop at a time, at most 40; a relative target is joined to the folder the link sits in without normalising `..`; only the last folder is resolved physically, so a missing file inside the project is created there. Shell: `_erg_resolve_inside` in `ensure-root-gitignore`. TS twin: `resolveGitignoreTarget` behind `ensureDevflowGitignore` in `src/targets/claude-code/post-install.ts`; a table test in `tests/shell-hooks.test.ts` builds each layout in two sandboxes, runs one twin on each and compares the whole sandbox, links included, so the twins must refuse the same layouts and write the same bytes to the same file (parity is byte equality, not has-line booleans).
- **D-HUD-LEDGER-BOUNDED (statusline).** The statusline reads the ledger on every prompt, so `readBoundedLedger` in `src/hud/components/learning-counts.ts` reads it only when lstat says it is a regular file, opens it with `O_NOFOLLOW | O_NONBLOCK`, re-checks with fstat and reads at most `LEDGER_MAX_BYTES` (8 MiB; real ledgers are about 0.5 MB). A link (to `/dev/zero`, say), a FIFO, any other non-regular file or a larger one shows no counts, as an absent ledger does.

## Component Architecture

### The learning store: single schema authority

**Contract.** Store functions return a Result, `{ok:true,value}` or `{ok:false,error:{kind,message}}`, for anything that can fail on input or the lock; they never print and never call `process.exit`. A throw means a broken invariant or an I/O failure. `json-helper.cjs` prints Results (`emit`), and the CLI reaches the same file through `src/core/learning-store.ts`. The store requires only node built-ins, `project-paths`, `mkdir-lock` and `safe-path`; `decisions-format` and `render-decisions` require the store, never the reverse (`renderAll` lazy-requires the renderer on first render). `now` is epoch milliseconds throughout.

| What | Keys |
|---|---|
| Observation (log row), written by the caller | `id` (`obs_` + 3 to 60 of `[a-z0-9_]`), `type` (`decision` or `pitfall`, fixed once stored), `title` ≤120, `rule` ≤400, `why` ≤300, `scope` 1 to 5 entries of ≤200, `provenance` ≤120, optional `evidence` ≤5 items of ≤300. Limits count code points. |
| Plumbing-owned log keys | `schema: 2`, `observations`, `first_seen`, `last_seen`. A put carrying these, `status` or `anchor_id` is refused. |
| Ledger row (projection) | `schema, id, type, anchor_id, decisions_status, title, rule, why, scope, provenance`, then the ledger-owned keys present: `date`, `last_verified`, `last_attempt`, `status_note`, `superseded_by`, `encoded_at`, `retired_on`. Evidence and counters stay in the log. |
| Statuses | active: `Accepted` (decisions), `Active` (pitfalls). Inactive: `Encoded`, `Superseded`, `Retired`, `Deprecated`. An absent or unknown status counts as active. |

**Validation (D-PUT-NOT-MERGE).** A create or update carries the whole content and the stored row is exactly that content plus the counters plumbing keeps; an update never merges, because a merge keeps what the new content no longer says and a stale clause would outlive every rewrite. A reinforce carries `{id}` alone. `validateObservationInput` lists every bad key and field in one refusal, key refusals first (plumbing-owned, ledger-owned, unknown: distinct messages), then id, type, title, rule, why, scope, provenance, evidence; nothing is written. A title, rule or why that is one line reports its length and every reference problem together; a value with a bad shape (text that is not one line, a scope with the wrong number of entries, a malformed glob) reports that alone, and its other problems surface on the retry.

- Every string is one line with no control character (C0, C1, DEL, U+2028/U+2029, bidi controls) and not blank.
- Title, rule and why also refuse a held ledger anchor, an issue reference (`#` + digits after the start or a non-word character other than `&`) and a file-and-line reference (`name.ext:N` or `#LN` over an explicit extension list, so `host:port` passes). Provenance and evidence may cite all three.
- A scope entry is an `area:` tag (`area:[a-z0-9][a-z0-9-]{0,39}`) or a glob that is relative (no leading `/` or `:`), has no `..` segment, whitespace, backtick or `|`, and matches a tracked file (`gitScopeMatcher`: memoized `git ls-files`, 5 s timeout; any git failure answers false, so an uncheckable scope is refused).
- `create` needs an id the log lacks; `update` and `reinforce` need one it holds; `update` cannot change the type.

**Invariants the store keeps:**

- **Ledger registry (D-LEDGER-REGISTRY).** Only the ledger records what is promoted: an observation is promoted when any ledger row carries its id, an anchor is taken when any ledger row carries it. Never decide from a log row's `anchor_id` or status: most anchored rows have none, so a guard keyed to it promotes one observation twice under two numbers. `ledgerRegistry` gives `byAnchor` (first row kept) and `byObsId`.
- **Content authority (D-LOG-CONTENT-AUTHORITY).** A ledger row is built only by `toLedgerRowV2(logRow, priorRow, {anchorId, status, date, expectType})`, at promotion and at every re-projection; ledger-owned keys carry over from the prior row. It throws on a non-v2 log row, a type that differs from `expectType`, a malformed anchor, an anchor whose prefix does not match the type (ADR with decision, PF with pitfall) or a non-entry status. It copies faithfully and does not sanitize: formatters collapse control characters at render time, because a hand-edited row can hold anything. A new ledger key must join `LEDGER_OWNED_KEYS` or it does not survive projection.
- **History (D-CONTENT-HISTORY).** Before a write replaces content, `appendHistory` records the prior log row and ledger rows `{id, at, ledger, log}`, keeping the last 3 per id. A write that leaves content as it was records nothing; deciding that is the caller's job.
- **Quarantine (D-QUARANTINE-MALFORMED).** A line that is not exactly one JSON object is never read as a row and never silently dropped: `readJsonl` returns it among `rejected`, and a writer appends `{rejected_at, source, line, text}` to the file's `.rejected.jsonl` sibling (O_APPEND, O_NOFOLLOW) before rewriting. Read-only paths (`list`, `show`, `--status`, `render`, `--check`, the HUD) count and report, never write. A file that is itself a symbolic link reads as missing (D-NO-LINKED-READ).
- **One-time backup (D-V1-BACKUP-ONCE).** The first write to a tree holding any non-v2 row copies log, ledger and archive to `*.pre-v2.jsonl` with an exclusive create (never overwritten), before any quarantine or rewrite so the copies hold the original bytes. An all-v2 tree makes none. A source file that is a symbolic link is not copied (D-NO-LINKED-READ).
- **Due selection (D-DUE-ORDER).** `selectDue` hands maintenance active entries in three classes: integrity-flagged (by anchor), legacy v1 (decisions before pitfalls, by number), then v2 entries last verified over 30 days ago (never verified counts as oldest). An entry attempted within 24 h is leased and skipped. At most 5 entries, stopping before the first that would pass 61,440 bytes (compact JSON of ledger row plus log row) but always at least one. Integrity flags, active entries only: `duplicate-obs-id`, `ledger-without-log`, `scope-matches-nothing` (v2 globs; `area:` always matches). The printed reason is the flags joined by `,`, `legacy-v1` or `verify-age`.
- **Verify ref (D-VERIFY-REF).** Claims about code are checked at `origin/HEAD` as last fetched, at `HEAD` only when there is no usable `origin/HEAD`, never in the working tree or index, because the ledger serves every checkout. `resolveVerifyRef` answers `{ref, commit}` or null (no repository or no commit).

### The ops (json-helper.cjs)

Each runs as `cd "<root>" && node "$HOME/.devflow/scripts/hooks/json-helper.cjs" <op> …` from the project root and takes **no path**: every file path is built from the cwd. argv carries only shape-gated tokens (type, anchor `^(ADR|PF)-\d{3,}$`, observation id, status, flags, the 16-hex claim token). Text arrives as one JSON object on stdin (≤65,536 bytes, read from fd 0). Exit 0 means the op did what stdout says; exit 1 means empty stdout and the reason on stderr, with nothing written (no lock left, no quarantine, no backup, no history). A multi-problem refusal reads `<op>: the input has <N> problems; nothing was written` then one `  <field>: <message>` per problem. Every learning op except `claim-queue` and `release-claim` sends the claim heartbeat first. The same file serves the hooks' jq-less fallback through five generic ops (see Generic ops below), which load no learning module and send no heartbeat.

```bash
# Text reaches an op only on stdin, through a QUOTED heredoc, so the shell expands nothing in it
cd "<root>" && node "$HOME/.devflow/scripts/hooks/json-helper.cjs" put-observation --create <<'EOF'
{"id":"obs_...","type":"pitfall","title":"...","rule":"...","why":"...","scope":["area:hooks"],"provenance":"..."}
EOF
# stdout: created obs_...     refusal: put-observation: the input has 2 problems; nothing was written
```

The shape is the op contract: the whole content every time, ids and statuses on argv only, results on stdout, reasons on stderr.

**`put-observation --create|--update|--reinforce`** (D-PUT-REPROJECTS). stdout `created|updated|unchanged <id>` or `reinforced <id> <n>`, then `reprojected <anchor>` per entry re-projected (create and update).

- *Create* stores `schema: 2`, the content, `observations: 1`, `first_seen = last_seen = now`. An active entry already carrying the id is re-projected: the repair for an entry whose log row went missing.
- *Update* replaces the whole content, keeps the counters, refuses a type change. A v1 row converts (count→observations, created→first_seen; pattern, details, amendments and over-limit evidence leave the live row, kept in history and the backup) and is never `unchanged`. A v2 row whose content keys all equal the input is `unchanged` and writes nothing, even if its entries are stale (refresh-anchor repairs that).
- *Reinforce* adds one observation and sets `last_seen`, on v1 rows too (a v1 row stays v1). No history, re-projection or render.
- Every mode refuses a log id held twice, an observation whose anchored entries are all inactive (`restore first`), and an active entry that cannot take the type.
- Re-projection rebuilds every active ledger row carrying the id through `toLedgerRowV2` and re-renders, all under the lock the log was written under (a separate refresh step could be skipped or interleaved); inactive rows stay unchanged. Write order: backup, quarantine log, history, log, then quarantine ledger, ledger, render.

**Read-only ops.**

- **`list`** always prints `ACTIVE n`, `INACTIVE n` (with `<status>` and an indented `note:`: `encoded in <path>`, `superseded by <anchor>` or the status note), `OBSERVATIONS n` (log rows no ledger row carries), `INTEGRITY n`; `MALFORMED n` only when lines were skipped. An ACTIVE item reads `<anchor> <obs_id> v<1|2> verified <date|never> observed <count|?> last-seen <last_seen|-> scope <scope|-> <title>`: the count and last sighting come from the log row carrying its id, and the scope entries are joined by `,` (`-` for a v1 entry). Titles come last, one line, cut to 120 (a v1 title is its pattern); a missing or multi-word token prints `-`.
- **`show <anchor|obs_id>`** prints pretty JSON `{key, ledger, log, history_versions, flags, malformed?}`. `ledger` is every ledger row carrying the observation (a twin shows too); `flags` holds a `ledger-only-content` flag with `fields` per row whose content its log row lacks (v1: normalized `details` containment; v2: any differing projected field).

**Writers.**

- **`claim-due`** prints `ref <origin/HEAD|HEAD> <sha12>` (`ref none` without a commit), then `<anchor> <reason> <bytes>` lines or `due none`. It stamps `last_attempt` on each active entry handed out and writes only then (backup, ledger quarantine, ledger); it never renders, since no template shows `last_attempt`. Scope-glob git calls run before the lock.
- **`assign-anchor <decision|pitfall> <obs_id>`** (D-E4-SKIP) promotes a v2 observation no ledger row carries. The number is one past the highest any ledger row of that type holds (inactive included; decisions and pitfalls number separately; three digits), skipping each number a tracked file cites as a whole word, at most 100 skips, then it refuses. The scan runs once before the lock: `git ls-files`, else a bounded walk of 200,000 entries; it skips the learning tree, `.git`, `node_modules`, `target`, `dist`, symlinks, binaries and files over 5 MB. stdout is the anchor; each skip is the stderr line `assign-anchor: skipped <anchor>, cited in <path>:<line>`, information not an error. The row is the v2 projection with the type's active status and today (UTC) as `date` and `last_verified`; the log is never written. Refuses an id not in the log or held twice, already promoted, a v1 observation, a type mismatch. Minting over a cited number would silently bind that citation to an unrelated entry.
- **`refresh-anchor <anchor>… [--verified]`**, all or nothing. Without `--verified` each active v2 entry is re-projected from its log row (`reprojected|unchanged <anchor>`, history first when content changes); with it only `last_verified` becomes today (`verified <anchor>`, no log row needed). One refused anchor refuses the batch and every refused anchor is listed: not held once, inactive (`restore it with restore-anchor first`), v1, and without `--verified` a log row missing, doubled, v1 or of another type. A batch that changes nothing writes and renders nothing and exits 0.
- **`retire-anchor <anchor> <Encoded|Superseded|Retired|Deprecated>`** (D-ENCODED-QUOTE) takes stdin by status (other keys refused) and prints `<status in lower case> <anchor>`:
  - `Retired`, `Deprecated`: `{reason}`, one line of 1 to 120 characters, kept as `status_note`.
  - `Superseded`: `{by}`, an active entry other than this one (either type), kept as `superseded_by`; every inactive entry that named this one is re-pointed and printed `repointed <anchor>`.
  - `Encoded`: `{at, quote}`: `at` is a relative path ≤300 with no empty, `.` or `..` segment; `quote` is one line ≤200 and ≥12 once whitespace collapses. The quote must appear in the file as committed at the verify ref's resolved commit (`git cat-file blob <commit>:<path>`, whitespace collapsed on both sides, checked before the lock); kept as `encoded_at: {path, quote, ref, commit}`. A path alone can point anywhere; only a quote found at a ref every checkout shares shows the lesson lives there.
  - Every retirement sets `retired_on` and clears the other notes; content stays, so a v1 entry stays v1. Refuses an already-inactive entry and an absent or inactive successor.
- **`restore-anchor <anchor>`**: an inactive entry becomes active with its type's status and loses `status_note`, `superseded_by`, `encoded_at`, `retired_on`, `last_verified` and `last_attempt`, so the next `claim-due` hands it out ahead of every verified entry; content and `date` stay. Prints `restored <anchor>`.
- **`rotate-observations`** (D-ROTATE-UNREFERENCED) prints `rotated <N> observations` (always plural). Under the lock it deletes leftover `.decisions-usage.json` and `.decisions-usage.lock/`, then archives each log row that no ledger row carries (a log row's own status or copied `anchor_id` is ignored) once its last activity (`last_seen`, else `first_seen`, else `created`) is at least 30 days old; an unparseable date keeps the row. An archived row is appended unless an identical JSON line is already there, then the log is rewritten without it; backup and log quarantine happen only when rows are due. Only the ledger knows what is promoted, and a dedup by id would drop the newer version of a row whose older one is already archived.
- **`claim-queue`** and **`release-claim <token>`**: see the claim below.

**Generic ops (the hooks' jq-less fallback).** `hooks/json-parse` is the JSON seam the shell hooks source: each wrapper runs `jq` when it is installed and otherwise one generic op on `node`, and with neither tool `_JSON_AVAILABLE` is false, the flag a hook checks after sourcing before it calls a wrapper. The ops are exactly `get-field` (behind `json_field` and `json_field_file`), `extract-cwd-field` (`json_extract_cwd_field`, and `json_extract_cwd_prompt` over it), `session-output` (`json_session_output`), `prompt-output` (`json_prompt_output`) and `backup-construct` (`json_backup_construct`).

- **Silent where jq is.** Where a jq path discards stderr (`json_field`, `json_field_file`, `json_extract_cwd_field`), its node fallback does too, so input that cannot be parsed fails silently on either backend, with a failing status. `json_field_file` redirects stderr BEFORE stdin (`2>/dev/null < "$file"`), so the shell's own error for a file it cannot open is discarded as well. The three envelope wrappers (`json_session_output`, `json_prompt_output`, `json_backup_construct`) keep stderr on both backends.
- **Failure is a status, not a message.** An unparseable or missing file gives a failing status and no message, so a caller that must survive it, or must not trust partial output (jq prints each value it parsed before the one that failed), checks the status. A `set -e` hook guards the call (`session-start-memory` does for its backup read, see the memory worker below).
- **Files arrive on stdin.** No op takes a path, so `json_field_file` feeds its file on stdin to `get-field`.
- **`backup-construct` reads `--arg name value` pairs only** (`ts`, `branch`, `status`, `log`, `diff`, `memory`), the shape `pre-compact-memory` passes.

### One lock, no stray tree, no linked tree

**D-ONE-LEARNING-LOCK.** Every write to the log, ledger, side files and rendered files happens under `.decisions.lock`, taken through `withDecisionsLock(opName, root, fn, {timeoutMs, staleMs})` (default wait 30 s, stale break 60 s, mkdir-based). Two writers under two locks each read a file, change it and rename their copy over it, and the second rename silently discards the first's change. `fn` must return a Result (anything else throws a TypeError); a throw propagates after the lock is released; a busy lock answers `<op>: timeout acquiring lock at <lockDir>`. The ops, `render`, `--clear`, `--restore` and `--reset` all use it, and `render` reads the ledger inside it. `render --check` takes none, because taking it would create the lock directory.

**D-NO-STRAY-TREE.** The store never creates `.devflow/learning/` or its parent (the lock mkdir is non-recursive, so ENOENT means no tree). A writer run where the tree is absent refuses `<op>: no .devflow/learning/ under <root> — run from the project root` and creates nothing; `list`, `show` and `render --check` refuse the same way. A writer run from the wrong directory would otherwise create a ledger no session ever reads. Only the capture hooks (through `queue_append_row`, after its link check), `ensure-devflow-init`, `session-start-context` (healing an older install) and `devflow learning --configure` create the tree, each only where no link sits on the way (D-HOOKS-NO-SYMLINK, D-CLI-NO-SYMLINK).

**D-NO-LINKED-TREE.** `withDecisionsLock` is also where a writer learns that `.devflow` or `.devflow/learning` is a symbolic link: it refuses with kind `not-a-directory` before taking the lock, so no writer locks, rewrites, quarantines, archives, renders or deletes in whatever folder a committed link names (the full rule is in the section Links under `.devflow/`, above). An absent tree and a linked tree both leave everything unchanged.

### The owned queue claim and heartbeat (D-OWNED-CLAIM)

The queue is claimed and released only by the `claim-queue` and `release-claim` ops, under the learning lock.

- **Claim.** No learning directory gives `none` (nothing created). A claim path that is not a regular file is an error. A claim younger than `CLAIM_STALE_SECS` (900) is `busy`. An older one is a **takeover** (`claimed <token> takeover`): new owner token, mtime set to now, the waiting queue left for the next claim. No claim and a missing or empty queue gives `none`.
- **Fresh claim.** Under `<queue>.lock` (2 s wait, 30 s stale; the lock queue-append's overflow truncation takes, so truncation never rewrites rows already claimed): `link(queue, claim)` (EEXIST busy, ENOENT none, EPERM/ENOTSUP fall back to rename), unlink the queue (undoing the link if that fails), set mtime to now, write `.pending-turns.owner` (8 random bytes, 16 hex) and answer `claimed <token>`.
- **Release.** Claim gone → `gone` (the owner file is removed only if it names this token); owner file not naming the token → `not-owner`; else both removed → `released`.
- Why: a check-then-`mv` claim lets two runs claim at once and clobber a batch, `mv` keeps the queue's old mtime so a fresh claim looks stale, and an unconditional final unlink deletes another run's claim.

**Heartbeat.** Every `LEARNING_OPS` op (assign, retire, restore, refresh, rotate, put, list, show, claim-due) first runs `touchClaim`: `lutimes` on an existing claim, never creating one, never following a symlink at the claim path, no lock, and nothing at all (`touched: false`) when `.devflow` or `.devflow/learning` is a symbolic link (D-NO-LINKED-TREE: `lutimes` follows a linked folder above the claim, and the op that follows refuses that tree anyway); a failure goes to stderr and never stops the op. A new learning op must join `LEARNING_OPS` and `LEARNING_OP_RUNS` in `tests/decisions/learning-claim.test.ts`.

**Staleness.** `CLAIM_STALE_SECS` and the hook's `PROCESSING_STALE_SECS` are both 900, pinned equal by a lockstep test; the hook's check is advisory (it decides only whether to spawn), the op decides under the lock. The Tracker's `TRACKER_PROCESSING_STALE_SECS=600` is a separate literal on purpose. Left open by design: a live run silent over 900 s can be taken over (duplicate work, no loss, the old run's release answers `not-owner`); `--clear`, `--disable` and `--reset` delete a live claim and the run stops on vanished inputs; a crash leaves the claim for takeover after 900 s.

### Render (render-decisions.cjs, decisions-format.cjs)

A pure, clock-free render of ledger rows. `renderLearningFiles(root, rows)` returns decisions, pitfalls, index in write order; `renderAndWriteAll` writes them atomically (index last) and throws before writing without the learning directory; the store's `renderAll` writes the same contents and prints nothing, so an op's stderr stays empty on success. **D-V1-BYTE-STABLE**: a row without `schema: 2` renders byte for byte as before (`raw_body` verbatim, else the v1 formatters from `details`) and keeps its v1 index line; only a schema-2 row takes the v2 body and line, because moving v1 bytes would show every untouched entry as changed.

```markdown
<!-- TL;DR: 2 decisions -->      <- active count only; plural even for one
# Architectural Decisions

Generated from the local learning ledger by devflow; do not edit. Active entries follow; retired ones are listed under Inactive.

## ADR-NNN: {title}

- **Status**: Accepted · verified 2026-10-03    <- type's active status; ` · verified` only with last_verified
- **Scope**: `src/assets/scripts/hooks/**`, `area:learning`
- **Decision**: {rule}                           <- pitfalls: `Active` and `**Rule**`
- **Why**: {why}
- **Source**: {provenance}

## Inactive

| ID | Status | Note |
|---|---|---|
| ADR-NNN | Encoded | encoded in docs/reference/hooks.md |
```

This is the v2 shape the renderer pins; the arrows are annotations only. Every field passes through `singleLine`; a non-string field renders empty and its line stays; `|` in a cell becomes `\|`.

- **Inactive table**: one row per inactive entry of the file's type (v1 and v2 alike) by anchor number; Note is `encoded in <path>`, else `superseded by <anchor>`, else the status note, else `—`; omitted when none; never in `index.md`. Inactive entries keep their numbers.
- **Index lines**: v1 `  {anchor}  {title cut to 60 + …}  [{status}]` (+ `  —  {area cut to 80 + …}`); v2 `  {anchor}  {title}` (+ `  —  {scope joined ', ' cut to 80 code points + …}`), no status tag, title whole. `Decisions (N):` and `Pitfalls (N):` count both kinds; the footer names the absolute `decisions.md` and `pitfalls.md` paths, so the same ledger rendered at two roots differs in exactly those two lines. An empty corpus writes `(none)`.
- **Render CLI**: `render-decisions.cjs render|--check <worktree>` runs from the project root and `<worktree>` must realpath-equal the cwd (it is only compared; no path is built from argv). `render` locks and reads the ledger inside the lock; `--check` locks nothing, writes nothing, prints `[render-decisions] DRIFT: <path>[ (missing)]` and exits 1 on drift. Malformed ledger lines print `MALFORMED: N …` on stderr and are never quarantined by render. The one `process.exit` sits outside every lock.

### The Learning agent

`src/assets/agents/learning.md`: `model: opus`, tools exactly Read, Bash, Glob, Grep (no Write, no Edit), skill `devflow:apply-decisions`; hook-spawned, never named by a command. Iron Law: assign-anchor owns numbering, render owns the `.md`, never hand-edit. One run, in order:

- **Step 0.** `claim-queue`: `claimed <token>` (keep it for the final release), `claimed <token> takeover` (the stale run may have stored part of the batch, so do not reinforce an observation that already states a turn), `busy` (exit silently), `none` (report "no pending decisions work"), non-zero exit (stop, report stderr).
- **Part 1, capture.** Read the claimed turns (all, or the last 30 dialog-worthy when huge). Abstain by default: a decision is a real fork with rationale, a pitfall a non-obvious transferable failure; one incident yields an ADR or a PF, never both; if Grep/Glob finds a test, guard, CLAUDE.md, rule or prompt that already states it, record nothing.
  - Run `list` once and `show` candidates. An active entry or stored observation covers it → `--reinforce` (or `--update` with the whole content when the turns sharpen it); a Superseded one → act on its successor; any other inactive entry → `restore-anchor`, then `--update`, never a new entry; else `--create`.
  - Promote with `assign-anchor` once it recurs or is clearly significant; an unpromoted observation waits, then rotates after 30 idle days.
  - A status change the turns report is checked at the verify ref (`git show <ref>:<path>`, never `git grep` or the working tree) before acting.
- **Part 2, maintain.** `rotate-observations`, then `claim-due` once (its ref line is the verify ref; `due none` ends; `ref none` leaves every due entry). Per due entry `show`; a `ledger-without-log` entry first gets `put-observation --create` under its id. Then the first matching rung, exactly one final action, Keep when unsure:
  1. **Encoded**, by a strict bar: a test or guard that fails on any new violation in scope, or the rule stated in CLAUDE.md, a rules file or a prompt loaded for that scope. A refused quote means Keep.
  2. No longer true at the ref → rewrite the scope, or Retired.
  3. Duplicate → absorb into the survivor with `--update`, then Superseded.
  4. One-off → Retired.
  5. Keep, rewriting only when legacy-v1, wrong or vague (read a v1 entry's `ledger-only-content` flags first).
  - Close with one `refresh-anchor … --verified` batch of the kept entries (active v2 only; if refused, drop the named anchors and run once more).
- **Heartbeat and vanished inputs.** Every op refreshes the claim; at the Part 1→2 boundary and after each maintained entry the agent runs `touch -c <claim> && test -f <claim>` (the `test -f` fails once the claim is gone). If that fails, or an op answers `no .devflow/learning/ under …`, stop writing, go to Finishing, never recreate anything.
- **Finishing.** `release-claim <token>` is the FINAL act (`not-owner`, `gone` or a no-learning-dir refusal is noted in the summary); never delete, move or rewrite the claim or owner file. End with a 1 to 3 line summary, the run's only visibility surface.

The prompt carries the entry format with a good and a bad example and quotes every op's stdout form. It states no plumbing numbers (claim staleness, the claim-due batch size): they live in plumbing and a prose copy drifts. Only the 30 days (rotation, verify age) stays, pinned by a test.

### devflow learning CLI (`src/cli/commands/learning.ts`)

A thin router (status, list, show, configure, reset, clear, restore, enable, disable). It reads and writes the log, ledger and rendered files only through the store loaded by `loadLearningStore()` (`--configure` and the queue drain write their own files directly, each only past firstSymbolicLink, D-CLI-NO-SYMLINK), and locates the ledger with `getLedgerRoot()` (the main checkout from a linked worktree). Writers wait at most `LOCK_WAIT_MS` (5 s) for the lock and answer `The learning store is busy: another run holds its lock. Nothing was <cleared|restored|reset>; try again in a moment.` (exit 1). A writer facing a linked `.devflow` or `.devflow/learning` answers the store refusal instead (`<op>: <folder> is a symbolic link, not a directory; nothing was changed`, exit 1; D-NO-LINKED-TREE).

- **`--status`**: `Learning: enabled|disabled` (+ `Effective here:`), `Entries: A active (n decisions, m pitfalls), I inactive (Status k, …)`, `Legacy v1 entries: v of A active`, `Observations: L in the log, U not yet promoted`, and a warning when lines were skipped. Reads only, no scope check, no path printed; outside git `Entries: not in a git project`.
- **`--list`** prints exactly the `list` op's text; **`--show <id>`** prints the `show` JSON with every DEL, C1, directional, line-separator and bidi character escaped as `\uXXXX`, so a terminal shows it as written. Both read the cwd outside git; no learning directory → `No learning data in this project yet.`
- **`--restore <id>`** needs a git root and an entry id and calls `restoreAnchor`: `Restored <anchor> (<status>); it is due for review again.`
- **`--clear`** (D-CLEAR-UNREFERENCED): TTY confirm, then `clearUnreferenced` drops exactly the log rows no ledger row carries, whatever their age or status, and keeps every row an entry carries. It refuses while the ledger holds a malformed line (that line may carry a row it would drop), never writes the ledger, archive or rendered files, and with nothing to drop writes nothing. Only after it succeeds does the CLI drain the queue, claim and owner file (through a linked `.devflow` or `.devflow/learning` it deletes nothing: the success line then omits "drained the learning queue" and a warning names the link, D-CLI-NO-SYMLINK). Truncating the whole log would orphan every entry, each losing its content authority.
- **`--reset`** (D-RESET-UNDER-LOCK): no learning directory → `No learning data to reset.`, nothing created. The TTY confirmation comes BEFORE the lock; `resetLearning` then empties the directory under the lock, sparing only the lock directory, and removes the emptied directory after the release, only if nothing arrived meanwhile (removing the lock with the directory would let a release delete the lock of a writer that recreated the tree). It removes everything: queue, claim, owner and tuning config included. A `.devflow` or `.devflow/learning` that is a symbolic link is refused with nothing removed (`not-a-directory`, by `withDecisionsLock`, D-NO-LINKED-TREE), since emptying it would empty the directory it leads to; a link inside the directory is removed, never what it points to.
- **`--enable/--disable`** write `features.learning`; disable drains this project's queue (`drainLearningQueue`: queue, claim, owner), and through a linked `.devflow` or `.devflow/learning` it deletes nothing and warns, the switch still turned off and the exit code 0. **`--configure`** writes `learning.json` at the ledger root (project) or `~/.devflow` (global); the project file is written only when `.devflow`, `learning/` and `learning.json` are all not links, else `Project config not written: <link> is a symbolic link, and devflow writes nothing through one` and exit 1 (D-CLI-NO-SYMLINK).

### TypeScript seam, status lists and HUD

**D-LEARNING-STORE-SEAM.** `loadLearningStore(dir = scriptsDir())` loads `hooks/lib/learning-store.cjs` with evidence-policy's `loadScript` and shape-checks it against `LEARNING_STORE_SURFACE` (`satisfies Record<keyof LearningStoreModule, SurfaceKind>`: `INACTIVE_STATUSES`, `ANCHOR_ID_RE`, `readLearningState`, `buildListing`, `readListing`, `formatListing`, `showByKey`, `restoreAnchor`, `clearUnreferenced`, `resetLearning`). It never throws (`not-found` and `unusable` map to "learning store not found|failed to load — reinstall devflow-kit"). The interfaces are transcribed from the store's JSDoc and are the TS side's only shape authority, so a store function the CLI calls needs the interface entry, the surface entry and the fixtures' `LearningStoreApi`. The CLI loads the package copy while hooks and ops run `~/.devflow/scripts`, so the two can differ until `devflow init`.

`src/core/observations.ts` mirrors the status lists (D201) and imports nothing, so the HUD import closure does not grow (the install goldens list `core/observations.js`); a parity test pins it equal to the store's lists. The HUD component (D309) counts ledger rows with `anchor_id` set and `isActiveDecisionsStatus`, from `decisions-ledger.jsonl` and never the rendered markdown, silent on malformed lines, and it reads the ledger only when it is a regular file of at most 8 MiB, never through a link (D-HUD-LEDGER-BOUNDED, above), showing no counts otherwise; `gatherLedgerLearningCounts` uses `getLedgerRoot` inside the git-status `Promise.all` (1 s budget).

## Component Interactions

### Capture hooks and the queues

All three hooks source `queue-append` and call `queue_append_both`, handing each queue the root it lies below (`$PROJECT_ROOT` for memory, `$LEDGER_ROOT` for learning; they differ in a linked worktree) and gating each write by `_QG_MEMORY` / `_QG_LEARNING` from one `queue_read_gates "$DEVFLOW_MANIFEST" "$PROJECT_ROOT"` call (at most one fork per invocation, none when the fast paths settle it; `$DEVFLOW_MANIFEST` is `$HOME/.devflow/manifest.json`, D-ONE-HOME). They only append: no scanner runs and no background worker starts. In order: (1) the `DEVFLOW_BG_UPDATER=1` re-entrancy guard before `hook-bootstrap`, so the memory worker's own `claude -p` session is never captured; (2) the one gate fork; (3) `ensure-devflow-init`, whose non-zero return ends the hook, as it does for a `.devflow` that is a symbolic link; (4) in `queue_append_row`, `df_no_symlink_below <root> <queue>` (D-HOOKS-NO-SYMLINK): a queue, or a folder between its root and it, that is a link skips the append, logs `Queue skipped: a symbolic link sits on the path to <queue>; nothing written` and returns 0, and only a clear path gets `mkdir -p` of its folder (the hook bodies no longer create it; `queue-append` sources `git-marker` itself, and a failed source is a command not found, which is the refusing branch); (5) JSONL append via `jq` or `node JSON.stringify`, never string concatenation, `umask 077`, lock-free by design; (6) overflow guard: over 200 lines truncates to the newest 100 under `learning_lock_acquire "<queue>.lock"` (2 s wait, stale after 30 s). The newest-100 copy is created under `umask 077` and `set -o noclobber`, so a regular file or a link to one planted at its name is never written through: the trim fails, the entry is removed, `Queue overflow: not truncated, its copy could not be written` is logged and the trim waits for a later append. A copy that lands is renamed over the queue, so both queues keep mode 0600 through a trim: the rename gives the queue the copy's inode and mode whatever umask the hook inherited, and a `chmod` after it would leave a window. `capture-question` emits one `qa` row per answered question, joining `cwd` and field with ASCII SOH.

| What | File | Contains |
|---|---|---|
| Feature on/off | `~/.devflow/manifest.json` | `{features: {memory, learning, knowledge, …}}` |
| Team narrowing and facts | `.devflow/project.json` (committed, never devflow-written) | `{version, evidence, compliance, tracker, reviewPublication, features}`; `reviewPublication` only lowers |
| Personal per-repo facts | `.devflow/config.json` | `{reviewPublication, tracker?, features?}` |
| Agent tuning | `.devflow/learning/learning.json`, then `~/.devflow/learning.json` | `{model, debug}` |

### session-start-context

- **Carve-out** (before Section 1): the hook sources `ensure-root-gitignore` (the `.devflow/` carve-out) unless `df_no_symlink_below` finds `.devflow` a symbolic link (the marker would land in the folder the link names); the skip is a debug line and context injection goes on.
- **Section 1** emits `--- PROJECT DECISIONS (TL;DR) ---`: the count line from each of `decisions.md` and `pitfalls.md` (`N decisions`, `N pitfalls`, cut from line 1 with sed), then, last, `Index: <ledger root>/.devflow/learning/index.md`. The Index line exists only when `DIRECTIVE_LEDGER_SAFE` admits the ledger root and the index is non-empty with a first line other than `(none)`; builtins only. Every file it reads goes through `df_file_below "$LEDGER_ROOT"`, so one a link leads to reads as absent and is logged once; an index a link leads to gets no Index line, since the model would read the file the link names and pass it on as `DECISIONS_CONTEXT`. The healing `mkdir -p` of a missing `learning/` runs only where `df_no_symlink_below` admits the path. The section is emitted when either part exists.
- **Section 2** emits `--- LEARNING MAINTENANCE ---` when the queue is non-empty or `.pending-turns.processing` is stale (≥900 s); a fresh claim suppresses it. The queue, the batch and the project `learning.json` are read through `df_file_below "$LEDGER_ROOT"`, so one a link leads to counts as absent: a linked queue or stale batch sends no agent to it, and a linked `learning.json` does not choose the model. The check is advisory: a spawn that loses the race exits on `busy`. `$LEDGER_ROOT` is embedded only when `DIRECTIVE_LEDGER_SAFE` (positive shape `^[A-Za-z0-9/._+-]+$`, `+` for Claude Code's `feat+x` worktrees) admits it; a refused root with pending work emits the fixed `--- LEARNING PAUSED ---` notice, which interpolates nothing. The model resolves project → global → `opus` through the `opus|sonnet|haiku` allowlist (learning.json is user-controlled). The spawn is `subagent_type="Learning"`, `run_in_background: true`, prompt "Process the pending learning queue per your agent instructions. Project root: $LEDGER_ROOT".
- **Section 3, tracker setup** (`--- TRACKER SETUP ---`, not gated by the learning switch):
  - The machine provider comes from the `.tracker.enabled` sentinel (provider name on one line, read with `read`, zero forks), overridden by committed `project.json` or narrowed by personal `config.json` only when a bounded read shows a `"tracker"` key (one fork of `resolve-settings.cjs`; a git-tracked `config.json` is ignored, D-PERSONAL-UNTRACKED). Then a POSITIVE `jira|linear` allowlist (never `!= github`) and a skip when `~/.devflow/tracker/$P.md` exists.
  - `tracker_gates_open()` runs cheapest first: attempt cap, git marker, `source` in {startup, clear}, claim freshness, path shape, and the counter increment must land. GitHub and a learned provider fork nothing.
  - `.tracker.{provider}.attempts` is one decimal-integer line (absent, malformed or zero-padded → 0 and self-healed; 7+ digits count as `TRACKER_ATTEMPTS_MAX=5`); the hook increments on emission, the agent deletes it only on a successful write and the claim file last. The section is capped at `tracker-section-max-chars` (800).
  - The Tracker agent (`tracker.md`, `model: sonnet`) has the same claim/heartbeat shape with its own 600 s bound; provider selection and schema belong to the `tracker-feature` KB.
- **Section 4** (D-LEGACY-LOCAL-NOTICE): one line asking the user, once, to run `devflow uninstall --scope local` when `<root>/.claude/settings.json` registers a devflow hook (a command ending in `/scripts/hooks/run-hook <marker>`).

### Consumers of the decisions index

`decisions_locate()` in `_decisions.mds` runs ONE `git -C "{start}" rev-parse --path-format=absolute --show-toplevel --git-common-dir` from `WORKTREE_PATH` or the cwd and picks `{ledger}`: the main worktree (line 2 without `/.git`, when the output is exactly two absolute lines, line 2 ends `/.git`, and the parent is not HOME and holds a `.devflow/`), else the toplevel (the line after the echoed flag on git < 2.31), else the start directory. It mirrors the hooks' rule (D-PROMPT-ROOT). `decisions_load()` reads `{ledger}/.devflow/learning/index.md` (absent or empty → `DECISIONS_CONTEXT` is `(none)`) and applies `devflow:apply-decisions`; nothing parses the ledger.

- Nine hosts import `{ decisions_load }`: bug-analysis, code-review, debug, plan, implement, explore, self-review, research, resolve.
- `_preamble.mds` imports the module as `decisions` and calls `decisions_locate()` for the four dynamic commands; `_engine.mds` passes the loaded index to Code.
- `commands/release.md` Phase 1b carries the locate text word for word (a test pins it to the define body).
- `agents/code.md` reads the main worktree's index itself when no `DECISIONS_CONTEXT` is given, and states applied decisions in words, never by ID.
- `agents/skim.md` Step 6 reads the decisions TL;DR (the first line of `{ledger}/.devflow/learning/decisions.md`, `<!-- TL;DR: N decisions -->`, reported as the active decision count) and nothing else of the file. An agent has no MDS partial, so Step 6 spells the locate rule out in prose: the same one `git -C "{start}" rev-parse --path-format=absolute --show-toplevel --git-common-dir` from `WORKTREE_PATH` or the cwd, then the main worktree, else the toplevel, else `{start}`. A linked worktree therefore reports the main worktree's count; `tests/decisions/command-adoption.test.ts` pins the three tiers in order.
- The charter bullet tells the main model to pass the index named under PROJECT DECISIONS as `DECISIONS_CONTEXT` on direct delegations (charter capped at 3,072 characters).
- The `apply-decisions` skill documents both index line kinds and the v2 body; its Skip Guard treats an index an agent's own instructions tell it to read as that agent's `DECISIONS_CONTEXT`.

### Memory worker (background-memory-update)

`memory-worker` resolves `DEVFLOW_MANIFEST`, gates its spawn on it and passes the path as `$2` (`background-memory-update <CWD> [<manifest_path>]`; the worker re-checks after spawn and falls back to `$HOME/.devflow/manifest.json`). The model writes ONLY `WORKING-MEMORY.md.new`; `verify_and_swap()` assigns one outcome:

- `updated`: valid stamp and matching pre/post `cksum` → atomic `mv`, remove `.processing`, touch `.last-refresh-ok`.
- `conflict`: mismatch or failure, or a symbolic link that appeared on the working memory path during the run (D-HOOKS-NO-SYMLINK) → staged file dropped, `.processing` kept with a heartbeat touch that extends the 300 s cold-path liveness window.
- `failed`: staged file missing, empty or unstamped, or `mv` failed → `.processing` left for cold-path recovery.

`cksum` must be on PATH or the worker exits; a `cksum` failure on the target forces `conflict`; stale staged files are cleaned at the start of each run.

**Link refusals (D-HOOKS-NO-SYMLINK).** `memory-worker` checks the throttle stamp's path first: a link on it gets no stamp and no spawned worker (`SKIP`, logged). `background-memory-update` checks the lock, queue, batch, `.last-refresh-ok` and `WORKING-MEMORY.md` paths together before it takes the lock or starts an LLM run, and skips the whole run when any has a link on its path; the existing working memory then reaches the prompt only through `df_file_below`, and `verify_and_swap` refuses the swap (`conflict`, above) when a link has appeared on the working memory's path since the run began, because `mv` would move the staged file into the folder the link names.

A leftover `.pending-turns.processing` (a crashed run's batch) takes the waiting queue merged into it and, over 200 lines, is trimmed to the newest 100 through a copy created under `umask 077` and `set -o noclobber` (an entry planted at its name is removed and never written through; the batch is then left untrimmed and the log says `Processing overflow: not truncated`) and renamed over it, so the batch stays 0600 like the queue: the session-start cold path moves a stale batch back into the queue, which would otherwise carry the copy's wider mode.

**D-QUEUE-NO-ORPHAN-DELETE.** Claude Code runs one event's hooks in PARALLEL, so the worker can start after `capture-prompt` appended the user row and before `capture-turn` appends the assistant row. A queue with no `assistant`/`qa` row exits with no LLM run and is LEFT in place; the next run takes the whole turn. `compute_commits_since_note()` yields five exact outcome literals that are a test contract (no-stamp full-synthesis, invalid-SHA-format, SHA-not-ancestor-of-HEAD, none-current-as-of-HEAD, `N commit(s)… (showing newest 20)`, subjects `%.100s`). The four untrusted data blocks are wrapped in named XML tags under a DATA-not-instructions preamble, and the prompt goes by heredoc stdin, never argv. `is_hex_sha <value> [min=7] [max=40]` is sourced with no forks (pre-compact uses 40–40); `pre-compact-memory` bootstraps `WORKING-MEMORY.md` noclobber-atomically only for a full SHA, labelling a detached HEAD `(detached)`; `session-start-memory`'s `detect_refresh_failing()` counts both `.pending-turns.jsonl` and `.pending-turns.processing`, each through `df_file_below` (a linked one counts as absent), and its cold path moves a stale batch back into the queue only where `df_no_symlink_below` admits the batch and the queue path.

**D-BACKUP-RENAME (the pre-compact backup).** `pre-compact-memory` writes `.devflow/memory/backup.json` (timestamp, branch, status, log, diff stat and a snapshot of `WORKING-MEMORY.md`) whole into `backup.json.tmp.<pid>` and renames it over the old backup; it never truncates and refills the file in place, because `session-start-memory` reads the backup twice and a read landing between the truncate and the refill would meet a partial file. A rename hands every read the previous backup or the new one.

- **Checked before it is written (D-HOOKS-NO-SYMLINK).** The hook ends, logged, when `.devflow` or `.devflow/memory` is a link: no backup and no working memory are written. The snapshot of `WORKING-MEMORY.md` is read through `df_file_below`, so a linked working memory is absent and never enters the backup the next session injects. The rename's target is checked first, because `mv` moves the copy into the folder a link at `backup.json` names: a link there, to anything, skips the backup (`Backup not written: a symbolic link sits on the path to <backup.json>`) and the `WORKING-MEMORY.md` bootstrap below it still runs.
- **Created safely.** The copy is made in a subshell under `umask 077` and `set -o noclobber`, so neither setting reaches the rest of the hook and the create fails when a regular file, or a link to one, already holds the copy's name: the write never goes through such a link and never reuses a pre-existing 0644 file (`noclobber` still opens a link to a device or a FIFO, see Gotchas). The rename gives `backup.json` the copy's inode and mode, so the backup, which holds the working memory, is 0600 whatever the caller's umask.
- **A failed write keeps the old backup.** A write or rename that fails logs `Backup not written; the previous one is kept`, removes whatever holds the copy's name and carries on, so the `WORKING-MEMORY.md` bootstrap below it still runs.
- **Leftover copies expire.** A run killed between creating its copy and renaming it (the hook's timeout) leaves the copy under its own PID, a name no later run writes. Each run first deletes the regular files named `backup.json.tmp.*` in the memory directory that are over an hour old (`find -maxdepth 1 -type f -mmin +60`); a write ends within the hook's timeout, so no live run's copy is that old and a concurrent run's copy survives.
- **The reader treats a bad backup as no backup.** `session-start-memory` reads `memory_snapshot` first, then `timestamp`. Under `set -e` a failed `json_field_file` would end the hook before it prints the working memory built above, so the first read is guarded (`|| BACKUP_MEMORY=""`): a backup that does not parse reads as no snapshot, like an absent one, and whatever jq printed before it failed is discarded. The `timestamp` read runs only once the first has parsed the whole file, so it needs no guard. A backup, working memory or batch that a link leads to reads as absent, through `df_file_below` (D-HOOKS-NO-SYMLINK).

### Hook ownership, init and logs

- **D-EXACT-HOOK-OWNER**: a hook is devflow's only when its command ENDS in `/scripts/hooks/run-hook <marker>` (`devflowHookOwner` in `src/targets/claude-code/hooks.ts`); `removeHooks` takes single hooks out of a matcher group. `memory.ts`'s `LEGACY_HOOK_SUFFIXES` names every earlier ending, removed on each converge and never counted as current. `devflow memory --enable/--disable` converges Stop/SessionStart/PreCompact (the settings transform runs FIRST, so the switch is not recorded unless the hooks can follow); `devflow knowledge` is a thin `handleToggle` router (KBs are written only by `knowledge_writeback`).
- **D-INIT-DRAIN-AFTER-SWITCH**: `drainDisabledFeatureQueues` drains this repo's queues for each feature `init` switched off, only AFTER the manifest write lands (draining first leaves a window where a session still reading "on" appends turns that survive the disable), and it returns one warning for each drain a linked folder refused (D-CLI-NO-SYMLINK), which `init` prints. **D-HUD-ONLY-PRESERVE**: `--hud-only` re-init keeps every recorded manifest value and changes only `features.hud`.
- **D-LOG-DIR-CAP**: hooks log under `~/.devflow/logs/<cwd-slug>/`; `devflow init` prunes to `MAX_HOOK_LOG_DIRS` (200, `src/core/hook-log-dirs.ts`, oldest first, at most 100,000 scanned) and `log-paths`' `devflow_log_dir` prunes only when it creates a folder (one `ls -1At`, at most 50 removed, bash 3.2); the shell cap is pinned equal to the TS one.

### Integration points

- **git**: `ls-files` (scope matching, the cited-number scan), `rev-parse` (roots, verify ref), `cat-file blob` (the Encoded quote); the store makes its calls through its `git()` wrapper, whose body prepends the fsmonitor override; the agent reads files at the ref with `git show`.
- **Install**: the store, renderer, formatter, `mkdir-lock`, `safe-path` and `json-helper` install under `~/.devflow/scripts/hooks/` (the install goldens list each), and `core/observations.js` rides with the HUD. A prompt that names an op needs that op in the installed copy.
- **Claude Code**: SessionStart `additionalContext` carries Sections 1 to 4; the Learning and Tracker agents are spawned from directives, never from commands; hooks of one event run in parallel.
- **Docs**: `docs/reference/hooks.md` (the Learning pipeline), `docs/reference/file-organization.md` (the data-file table and ops), `docs/cli-reference.md` (the nine `devflow learning` flags) describe this area.

## Constraints

Every loop and read has a bound: 100 cited-number skips, a 200,000-entry fallback walk, files over 5 MB skipped, 5 due entries and 61,440 bytes, 3 history versions, 64 KiB of stdin, a 5 s git timeout and 16 MB git buffer, lock waits of 30 s (2 s for the queue lock, 5 s from the CLI). Paths: no op takes one; every git call in the store goes through its one `git(root, args)` wrapper, whose body prepends `['-c', 'core.fsmonitor=false', …]` (**D-NO-FSMONITOR**: an index read runs the command a repository's `core.fsmonitor` names; the guard honours a wrapper only when its own body prepends the override, so a new call outside it must spell the override); nothing under a project's `.devflow/` is written, read or renamed through a symbolic link by the hooks, the store, the CLI or the HUD (Links under `.devflow/`, above): the store appends with O_NOFOLLOW and reads with lstat plus O_NOFOLLOW, its writers and `--reset` refuse a linked `.devflow` or `.devflow/learning`, the claim heartbeat skips one, the hooks check each path with `df_no_symlink_below` or `df_file_below`, and the cited-number scan opens files with O_NOFOLLOW and O_NONBLOCK.

| D-series name | Governs | Site |
|---|---|---|
| D-ONE-LEARNING-LOCK, D-NO-STRAY-TREE, D-NO-LINKED-TREE | one lock, no stray tree, no linked tree | `withDecisionsLock` (store); `linkedLearningFolder` |
| D-LEDGER-REGISTRY | promotion state lives in the ledger | `ledgerRegistry` |
| D-LOG-CONTENT-AUTHORITY | the log owns content; the ledger projects | `toLedgerRowV2` |
| D-PUT-NOT-MERGE | whole-content puts, key refusals | `validateObservationInput` |
| D-PUT-REPROJECTS | a put re-projects and renders under its lock | `putObservation` |
| D-QUARANTINE-MALFORMED | malformed lines move aside, never drop | `readJsonl` |
| D-CONTENT-HISTORY | last 3 versions kept | `appendHistory` |
| D-V1-BACKUP-ONCE | one-time pre-v2 copies | `ensurePreV2Backup` |
| D-DUE-ORDER | what maintenance gets, in what order | `selectDue` |
| D-VERIFY-REF | where claims about code are checked | `resolveVerifyRef` |
| D-ENCODED-QUOTE | Encoded needs a quote found at the ref | `quoteAtRef` |
| D-E4-SKIP | assign skips cited numbers | `assignAnchor` |
| D-ROTATE-UNREFERENCED | archive only unreferenced rows | `rotateObservations` |
| D-CLEAR-UNREFERENCED, D-RESET-UNDER-LOCK | `--clear` and `--reset` | `clearUnreferenced`, `resetLearning` |
| D-OWNED-CLAIM | exclusive, owner-checked queue claim | `claimQueue`; cited at `releaseClaim`, `touchClaim`, `LEARNING_OPS`, the hook's Section 2 |
| D-NO-FSMONITOR | no repository-chosen code on index reads | full block at `listGitTrackedFiles`; guard `no-fsmonitor-index-read` |
| D-LEARNING-STORE-SEAM | the CLI touches ledger state only through the store, loaded by the seam | `src/core/learning-store.ts` |
| D-V1-BYTE-STABLE | v1 rows render unchanged | `buildBodyBlocks` (render-decisions) |
| D-BACKUP-RENAME | the pre-compact backup is replaced by a rename, never rewritten in place | `pre-compact-memory` |
| D201, D309 | status-list parity, HUD count | `src/core/observations.ts`, `LedgerCountRow` in the HUD |
| D-HOOKS-NO-SYMLINK | a hook never writes, reads or renames through a link at or below a project's `.devflow/` | `df_no_symlink_below`, `df_file_below` (`git-marker`) |
| D-NO-LINKED-READ | a learning file that is a link reads as missing | `readTextUnlinked` (`readJsonl`), `ensurePreV2Backup` |
| D-CLI-NO-SYMLINK | the CLI writes and deletes under `.devflow/` only past a link check | `firstSymbolicLink`, `drainQueueFiles` |
| D-GITIGNORE-LINK-INSIDE | a linked root `.gitignore` is written only inside the project and outside `.git` | `_erg_resolve_inside` (shell), `resolveGitignoreTarget` (TS) |
| D-HUD-LEDGER-BOUNDED | the statusline reads only a regular ledger of at most 8 MiB | `readBoundedLedger` |

## Anti-Patterns

- **Hand-editing `decisions.md`, `pitfalls.md`, `index.md` or any data file**: the ops overwrite the rendered files, and the agent has no Write tool. Change content with `put-observation`, status with `retire-anchor`/`restore-anchor`.
- **Writing entry content into the ledger by any path but `toLedgerRowV2`**: the log is the content authority; an entry that disagrees with its log row shows as a `ledger-only-content` flag.
- **Deciding promotion from a log row's `anchor_id` or status**: use the ledger registry.
- **A second lock, a lock-free write, or `process.exit()` inside a store function**: exit skips the `finally` that releases the lock. Return a Result and let `json-helper` set `process.exitCode` once, outside every lock.
- **Creating `.devflow/learning/` from a writer or render path**, or passing a path or text on argv: argv holds shape-gated tokens only.
- **Claiming the queue with `mv`, or deleting, moving or rewriting the claim or owner file by hand**: only `claim-queue`/`release-claim` (and the deliberate `--clear`/`--disable`/`--reset` drains) touch them.
- **Quoting plumbing numbers in the Learning prompt**: staleness and batch sizes live in plumbing.
- **A git call that reads the index without `-c core.fsmonitor=false` in its argv, outside a wrapper whose body prepends the override**, or one whose argv is built at run time.
- **A ledger ID, `#123` issue reference or file-and-line reference in an observation's title, rule or why**, or any ledger ID in committed text.
- **Reading feature flags with two separate calls**: use `queue_read_gates` (one fork). Never read or write top-level `.devflow/config.json` keys for on/off state, omit `<root>` from a `queue_read_gates` call, or resolve the manifest from the project root (the gate then fails open).
- **Skipping the model allowlist in `session-start-context`**, or omitting the `DEVFLOW_BG_UPDATER=1` guard from a capture hook.
- **Simulating a missing shell tool by subtracting it from `PATH`** in a hook test: force a backend with a variable (`_HAS_JQ=false`).
- **Trimming or rewriting a 0600 queue, batch or backup through a copy made under the caller's umask**: the rename gives the file the copy's inode and mode, and a hook inherits its parent's umask (typically 022), so a 0600 file turns 0644. Create the copy under `umask 077`; a `chmod` after the `mv` leaves a window.
- **Rewriting `backup.json` in place** (truncate, then refill): `session-start-memory` reads it twice, and a read between the two meets a partial file. Write a complete copy and rename it.
- **A write, rename or read under a project's `.devflow/` that skips its link check**: a hook without `df_no_symlink_below` (writes, renames) or `df_file_below` (reads), a CLI write or delete without `firstSymbolicLink`, a store file read around `readJsonl`, a learning writer around `withDecisionsLock`. A committed link then carries conversation text out of the project, or a foreign file into the session, a prompt or a render. Never widen the hook helpers to the project root or the folders above it: a project reached through a linked parent (macOS `/tmp`, `/var`) would stop capturing.
- **Reading the ledger in the HUD unbounded**: the statusline runs on every prompt, and a ledger linked to `/dev/zero` or grown huge would hang it. Keep the lstat, `O_NOFOLLOW`, `O_NONBLOCK`, fstat and size cap of `readBoundedLedger`.

## Gotchas

- **`unchanged` means equal content keys**: a v2 row whose entries lag is not repaired by an update; run `refresh-anchor` without `--verified`. Every writer re-serializes all rows with `JSON.stringify`, so a hand-edited non-canonical line is normalized with the same values.
- **`refresh-anchor` refuses v1 and inactive entries**, so the closing `--verified` batch must list active v2 entries only; rewrite a kept v1 entry with `put-observation --update` first. `retire-anchor` and `restore-anchor` work on v1 and leave it v1; `assign-anchor` refuses a v1 observation.
- **A put's "restore first"** applies in every mode: run `restore-anchor`, then the put. Restore clears `last_verified` and `last_attempt`, so the entry is due again whatever lease it had: D-DUE-ORDER hands it out after integrity problems and legacy v1 entries (among them if it is one), ahead of every verified entry.
- **`claim-due` leases for 24 h** and a second call in one run hands out different entries; treat each line as that run's work list.
- **900 s is two literals** (`CLAIM_STALE_SECS` and the hook's `PROCESSING_STALE_SECS`); change both. The Tracker's 600 is separate.
- **Empty corpus**: `index.md` is `(none)`; consumers treat `(none)` and empty as absent. The TL;DR is plural for one (`1 decisions`).
- **The legacy key wins only when the renamed key is not a boolean** (`"decisions": false` with no `"learning"` switches learning off).
- **The learning queue is not always under the session's own root**: in a linked worktree it is the main worktree's (`DF_LEDGER_ROOT`); tests seeding a queue for a worktree session must seed main's.
- **`noclobber` is not a link check.** `set -o noclobber` makes a `>` fail only when its target already exists as a regular file, so it stops a create over a planted regular file or a link to one and still opens a link whose target is a device or a FIFO. The hooks lean on it for the names of the files they create beside a checked path (the trimmed queue and batch copies, the backup copy, the legacy `.gitignore` copy, the carve-out marker, the working-memory bootstrap). A new write under `.devflow/` checks its path with `df_no_symlink_below` first and keeps `noclobber` as the second line, never the only one.
- **A linked `.devflow`, or its `memory` or `learning` folder, gets no capture, on purpose.** `ensure-devflow-init` returns non-zero for a linked `.devflow` (the capture hooks then exit 0), `queue_append_row` skips a queue below a linked folder, the memory hooks skip the memory folder, and the learning ops refuse the learning tree (`claim-queue` included, so the Learning agent stops at Step 0 with the refusal on stderr). The hooks log each skip once under `~/.devflow/logs/<cwd-slug>/`; the ops answer on stderr.
- **Reads through a linked folder are by design.** The read-only paths (`list`, `show`, `render --check`, `devflow learning --status|--list|--show`) and the HUD refuse a linked file (a linked log, ledger, archive or history file reads as missing, and a linked ledger shows no counts) but still read through a linked `.devflow` or `.devflow/learning` folder; only the writers refuse the folder. The hooks differ: they refuse a file below a linked folder as well. Do not add folder checks to the read paths.
- **`df_no_symlink_below` answers 1 for a call it cannot vouch for, and the log line then still names a link.** Each queue is checked against the root it lies below, memory against `$PROJECT_ROOT` and learning against `$LEDGER_ROOT`, which differ in a linked worktree. A queue handed the wrong root, or a path with an empty, `.` or `..` part or more than 64 parts, is refused as "not below its root" with the same `Queue skipped: a symbolic link sits on the path to ...` line, so a capture that goes missing is not always a link.
- **A file sourced by a `set -e` hook must not leak a non-zero status.** `ensure-root-gitignore`, reached through `ensure-devflow-init`, is sourced by the capture hooks, `memory-worker` and `pre-compact-memory`, all running under `set -e`. A function call is a fresh simple command that returns its last status, so a helper that ends on a failed test kills the hook with no message, and a background hook's death is invisible. A helper therefore ends in an explicit `return 0` or in a command that cannot fail; the link predicates are the deliberate exception, called only inside an `if` or an `||`; and a create that `noclobber` may refuse ends in `|| true` (the carve-out marker). Pin each path with a test that sources the file under `set -e` and asserts the caller keeps running.
- **Section 3 is not gated by the learning toggle**; disabling learning does not disable the issue tracker.
- **CAS conflict heartbeat-touches `.processing`**: removing that touch lets the cold path reclaim a live retry batch after 300 s. The orphan gate skips when `.processing` already exists.
- **`is_hex_sha` bounds are call-site specific**; the `json_extract_cwd_field` SOH delimiter must be `\x01` in both the jq and node paths; a detached HEAD bootstraps with the `(detached)` label.
- **Every `session-start-context` test seeds a temp `$HOME`** (the hooks read `$HOME/.devflow` only); a real manifest with learning off would otherwise silently gate the test.
- **A shell rewrite hook can truncate `cat`/`head` reads of a `.devflow` data file**, announced only on stderr; use the Read tool where exactness matters.
- **New CLI flags need a write-set fence row** (`tests/write-set-fence.test.ts`) and a floor bump in `tests/fixtures/numeric-floors.json`; the fence runs the built CLI. Spawn-backed learning tests need spawn-sized timeouts under full-suite load.

## Key Files

| File | Purpose |
|------|---------|
| `src/assets/scripts/hooks/lib/learning-store.cjs` | The store: schema, validation, projection, locking, every writer and reader |
| `src/assets/scripts/hooks/json-helper.cjs` | Op dispatcher: `learning()` lazy load, `emit`, `readStdinJson`, `LEARNING_OPS`, heartbeat, the five generic ops; exports nothing |
| `src/assets/scripts/hooks/json-parse` | jq-first JSON wrappers; their node fallbacks run the generic ops, silent on stderr where the jq path is |
| `src/assets/scripts/hooks/lib/render-decisions.cjs` | Renderer, `renderLearningFiles`, `render`/`--check` CLI |
| `src/assets/scripts/hooks/lib/decisions-format.cjs` | v1 formatters (byte-stable), v2 body, Inactive table, TL;DR, index builder |
| `src/assets/scripts/hooks/lib/project-paths.cjs` · `src/core/project-paths.ts` | Path single source, export parity pinned by a test |
| `src/assets/scripts/hooks/lib/mkdir-lock.cjs` · `lib/safe-path.cjs` | mkdir lock helpers, path safety |
| `src/assets/scripts/hooks/capture-prompt` · `capture-turn` · `capture-question` · `queue-append` · `learning-lock` | Capture hooks, shared append (each queue path checked against its own root first, D-HOOKS-NO-SYMLINK), overflow truncation, queue lock |
| `src/assets/scripts/hooks/session-start-context` | Sections 1 to 4 |
| `src/assets/scripts/hooks/resolve-project-root` · `git-marker` · `ensure-devflow-init` | Roots, git-only gate, scaffolding that refuses a linked `.devflow`; `git-marker` also holds `df_no_symlink_below` and `df_file_below` (D-HOOKS-NO-SYMLINK) |
| `src/assets/scripts/hooks/ensure-root-gitignore` · `src/targets/claude-code/post-install.ts` | The carve-out and its root `.gitignore` link rule: `_erg_resolve_inside` (shell), `resolveGitignoreTarget` behind `ensureDevflowGitignore` (TS twin) |
| `src/assets/scripts/hooks/memory-worker` · `background-memory-update` · `pre-compact-memory` · `session-start-memory` · `is-hex-sha` | Memory pipeline; `pre-compact-memory` writes `backup.json` by rename, `session-start-memory` reads it |
| `src/assets/scripts/hooks/log-paths` · `src/core/hook-log-dirs.ts` | Log folder cap |
| `src/assets/scripts/hooks/assets/orchestrator-charter.md` | Charter bullet that forwards the decisions index |
| `src/assets/agents/learning.md` · `tracker.md` | The two hook-spawned agents |
| `src/assets/agents/skim.md` | Step 6 reads the decisions TL;DR through the main-worktree locate rule |
| `src/assets/commands/_partials/_decisions.mds` | `decisions_locate()` and `decisions_load()` |
| `src/assets/skills/apply-decisions/SKILL.md` | Consumer algorithm, both index line kinds, v2 body |
| `src/cli/commands/learning.ts` | `devflow learning` |
| `src/core/learning-store.ts` | Typed seam onto the store (D-LEARNING-STORE-SEAM) |
| `src/core/observations.ts` | Status lists (D201) |
| `src/core/learning-queue-cleanup.ts` | `drainLearningQueue`: queue, claim, owner; answers a `QueueDrain` (D-CLI-NO-SYMLINK) |
| `src/core/linked-path.ts` · `src/core/queue-drain.ts` | `firstSymbolicLink`; `drainQueueFiles`, `QueueDrain`, `formatRefusedDrain` (D-CLI-NO-SYMLINK) |
| `src/core/ledger-root.ts` | `getLedgerRoot`, the twin of `DF_LEDGER_ROOT` |
| `src/hud/components/learning-counts.ts` | HUD counts (D309); `readBoundedLedger` and `LEDGER_MAX_BYTES` (D-HUD-LEDGER-BOUNDED) |
| `src/core/feature-switch.ts` · `feature-config.ts` · `learning-tuning-config.ts` | Switch predicate and I/O, per-repo config, tuning merge |
| `src/cli/commands/memory.ts` · `knowledge/toggle.ts` · `init.ts` | Memory/knowledge toggles, init drains and `--hud-only` |
| `src/targets/claude-code/hooks.ts` | `devflowHookOwner`, `removeHooks`, `ensureHook` |
| `tests/decisions/learning-fixtures.ts` | Row factories, `seedLearningTree`, `initGitRepo`, `runJsonHelper`, `requireLearningStore` |
| `tests/decisions/learning-claim.test.ts` · `learning-store.test.ts` · `tests/learning-agent.test.ts` | Claim, store and prompt pins (including the 900 s lockstep) |
| `tests/queue-append.test.ts` · `tests/eager-memory-refresh.test.ts` · `tests/shell-hooks.test.ts` | Queue and batch trims keep 0600, the backup rename arms, the json-parse fallbacks' silence, and the link rules (the git-marker helpers, each hook's refusals, the gitignore twin table) |
| `tests/decisions/learning-store.test.ts` (linked tree and linked file suites) · `tests/decisions/cli-subcommands.test.ts` · `tests/core/linked-path.test.ts` · `tests/core/queue-drain.test.ts` · `tests/hud-learning-counts.test.ts` | The store, CLI and HUD link rules |
| `tests/seams/tracker-key-path.test.ts` · `tracker-claim-staleness.test.ts` | Tracker key-path parity and the shared claim-staleness bound |

## Related

- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md`: the Knowledge agent write-back; its gate takes `KNOWLEDGE=` from the settings line that folds the same switch.
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md`: the charter injection, `session-start-orchestrator` and the `git-marker` basics (`df_has_git_marker`, `df_is_project_root`); the link helpers beside them are recorded here.
- `.devflow/features/tracker-feature/KNOWLEDGE.md`: provider selection, the Tracker agent's schema and the Git agent's reader side for Section 3.
- `.devflow/features/installer-shadowing/KNOWLEDGE.md`: managed config writes, queue drains at init, the install goldens that list the store, and the carve-out block and its TS twin, whose root `.gitignore` link rule is recorded here.
- `.devflow/features/dynamic-workflow-engine/KNOWLEDGE.md`: the preamble and engine partials that load the decisions index.
- `.devflow/features/resolve-pipeline/KNOWLEDGE.md`: `/resolve` and `/code-review`, consumers of `decisions_load()`.
- `.devflow/features/test-harness/KNOWLEDGE.md`: guards on this area (`no-ledger-citations`, `no-fsmonitor-index-read`, `retired-wording`), the install snapshots and the write-set fence.
- `docs/reference/hooks.md`, `docs/reference/file-organization.md`, `docs/cli-reference.md`: the Learning pipeline and the hooks' rule against reading or writing through a symbolic link, the data-file table and the `devflow learning` flags.

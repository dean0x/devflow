---
feature: learning-capture-system-store
name: Learning store, ops and rendering
description: "Use when changing learning-store.cjs, a json-helper learning op, the observation or ledger schema, the one lock, or rendered decisions.md, pitfalls.md and index.md. Keywords: put-observation, assign-anchor."
category: architecture
directories:
  - src/assets/scripts/hooks/lib/learning-store.cjs
  - src/assets/scripts/hooks/lib/render-decisions.cjs
  - src/assets/scripts/hooks/lib/decisions-format.cjs
  - src/assets/scripts/hooks/json-helper.cjs
  - src/core/learning-store.ts
  - src/core/observations.ts
created: 2026-10-10
updated: 2026-10-10
---

# Learning Store, Ops and Rendering

## Rules

- **KB-INV-1** The log (`decisions-log.jsonl`) is the content authority: a ledger row is built only by `toLedgerRowV2`, at promotion and at every re-projection, and a new ledger-owned key must join `LEDGER_OWNED_KEYS` or it does not survive projection.
- **KB-INV-2** Only the ledger records what is promoted (`ledgerRegistry`): an observation is promoted when any ledger row carries its id, an anchor is taken when any ledger row carries it.
- **KB-INV-3** Every write to the log, ledger, side files and rendered files happens under the one `.decisions.lock`, taken through `withDecisionsLock`; its `fn` returns a Result, and only `render --check` takes no lock.
- **KB-INV-4** A put carries the whole content and never merges (`validateObservationInput`); a reinforce carries `{id}` alone; text reaches an op only on stdin through a quoted heredoc, argv holds shape-gated tokens only.
- **KB-INV-5** Store functions return a Result and never print or `process.exit`; `json-helper` sets `process.exitCode` once, outside every lock, and a refusal (exit 1, empty stdout) leaves no lock, quarantine, backup or history behind.
- **KB-INV-6** The store never creates `.devflow/learning/` or its parent: a writer, `list`, `show` or `render --check` run where the tree is absent refuses and creates nothing.
- **KB-INV-7** A malformed line is quarantined to the file's `.rejected.jsonl` before a writer rewrites, never read as a row and never silently dropped; read-only paths count and report but never write.
- **KB-INV-8** Before a write replaces content, `appendHistory` records the prior log and ledger rows (`HISTORY_DEPTH` versions per id); a write that leaves content as it was records nothing.
- **KB-INV-9** Claims about code are checked at `origin/HEAD` as last fetched (`HEAD` only without one), never in the working tree or index (`resolveVerifyRef`), and Encoded needs a quote found at that ref's commit.
- **KB-INV-10** A legacy row (no current `schema`) renders byte for byte as before (`raw_body`, else the legacy formatters) and keeps its legacy index line; only a current-schema row takes the new body and line.
- **KB-INV-11** Every git call in the store goes through the `git(root, args)` wrapper, whose body prepends `-c core.fsmonitor=false`; the guard `no-fsmonitor-index-read` honours a wrapper only when its own body does.
- **KB-AP-1** Hand-editing `decisions.md`, `pitfalls.md`, `index.md` or any data file: the ops overwrite the rendered files; change content with `put-observation`, status with `retire-anchor` / `restore-anchor`.
- **KB-AP-2** Writing entry content into the ledger by any path but `toLedgerRowV2`: an entry that disagrees with its log row shows as a `ledger-only-content` flag.
- **KB-AP-3** Deciding promotion from a log row's `anchor_id` or status: most anchored rows have none, so the guard promotes one observation twice under two numbers.
- **KB-AP-4** A second lock, a lock-free write, or `process.exit()` inside a store function: exit skips the `finally` that releases the lock.
- **KB-AP-5** Creating `.devflow/learning/` from a writer or render path, or passing a path or text on argv.
- **KB-AP-6** A git call that reads the index without the fsmonitor override in its argv, outside a wrapper whose body prepends it, or whose argv is built at run time.
- **KB-AP-7** A ledger ID, `#123` issue reference or file-and-line reference in an observation's title, rule or why, or any ledger ID in committed text.
- **KB-AP-8** Minting an anchor over a number a tracked file cites: that citation would silently bind to an unrelated entry, so `assign-anchor` skips cited numbers.
- **KB-AP-9** Expecting `unchanged` to repair stale entries: it means equal content keys, and only `refresh-anchor` without `--verified` re-projects them.
- **KB-AP-10** Listing a v1 or inactive entry in the closing `refresh-anchor --verified` batch: it refuses the whole batch.
- **KB-AP-11** Putting over an observation whose anchored entries are all inactive: every put mode refuses, so run `restore-anchor` first.
- **KB-AP-12** Treating a `claim-due` line as stable work: entries are leased, so a second call in one run hands out different ones.

## Overview

The store is **the single schema authority** for the learning ledger. An *observation* (title, rule, why, scope, provenance) is stored once in the log. A *ledger row* projects it under an ADR/PF number and adds what is about the entry rather than in it. `decisions.md`, `pitfalls.md` and `index.md` are generated from the ledger. Files are rewritten in place under one lock; history, quarantine and a one-time backup protect what a rewrite replaces. This KB covers the store module, the `json-helper.cjs` ops, the lock and the renderer; the hooks and switches are in the hub (`learning-capture-system`), the Learning agent, the owned queue claim, the CLI and the HUD in `learning-capture-system-agent`, and the symbolic-link rules in `learning-capture-system-links`.

## The learning store

**Contract.** Store functions return a Result, `{ok:true,value}` or `{ok:false,error:{kind,message}}`, for anything that can fail on input or the lock; they never print and never call `process.exit`. A throw means a broken invariant or an I/O failure. `json-helper.cjs` prints Results (`emit`), and the CLI reaches the same file through `src/core/learning-store.ts`. The store requires only node built-ins, `project-paths`, `mkdir-lock` and `safe-path`; `decisions-format` and `render-decisions` require the store, never the reverse (`renderAll` lazy-requires the renderer on first render). `now` is epoch milliseconds throughout.

| What | Keys |
|---|---|
| Observation (log row), written by the caller | `id` (`OBS_ID_RE`: `obs_` plus lowercase letters, digits, underscore), `type` (`decision` or `pitfall`, fixed once stored), `title`, `rule`, `why`, `scope` (a list), `provenance`, optional `evidence` (a list). Every limit is in `FIELD_LIMITS` and counts code points. |
| Plumbing-owned log keys | `schema: 2` (`SCHEMA_VERSION`), `observations`, `first_seen`, `last_seen` (`PLUMBING_OWNED_KEYS`). A put carrying these, `status` or `anchor_id` is refused. |
| Ledger row (projection) | `schema, id, type, anchor_id, decisions_status, title, rule, why, scope, provenance`, then the ledger-owned keys present: `date`, `last_verified`, `last_attempt`, `status_note`, `superseded_by`, `encoded_at`, `retired_on`. Evidence and counters stay in the log. |
| Statuses | active: `Accepted` (decisions), `Active` (pitfalls). Inactive: `Encoded`, `Superseded`, `Retired`, `Deprecated`. An absent or unknown status counts as active. |

**Validation (D-PUT-NOT-MERGE).** A create or update carries the whole content and the stored row is exactly that content plus the counters plumbing keeps; an update never merges, because a merge keeps what the new content no longer says and a stale clause would outlive every rewrite. A reinforce carries `{id}` alone. `validateObservationInput` lists every bad key and field in one refusal, key refusals first (plumbing-owned, ledger-owned, unknown: distinct messages), then id, type, title, rule, why, scope, provenance, evidence; nothing is written. A title, rule or why that is one line reports its length and every reference problem together; a value with a bad shape (text that is not one line, a scope with the wrong number of entries, a malformed glob) reports that alone, and its other problems surface on the retry.

- Every string is one line with no control character (C0, C1, DEL, U+2028/U+2029, bidi controls) and not blank.
- Title, rule and why also refuse a held ledger anchor (`ANCHOR_WORD_RE`), an issue reference (`ISSUE_REF_RE`: `#` plus digits after the start or a non-word character other than `&`) and a file-and-line reference (`FILE_LINE_REF_RE`: `name.ext:N` or `#LN` over the explicit `LINE_REF_EXTENSIONS` list, so `host:port` passes). Provenance and evidence may cite all three.
- A scope entry is an `area:` tag (`AREA_TAG_RE`) or a glob that is relative (no leading `/` or `:`), has no `..` segment, whitespace, backtick or `|`, and matches a tracked file (`gitScopeMatcher`: memoized `git ls-files` under `GIT_TIMEOUT_MS`; any git failure answers false, so an uncheckable scope is refused).
- `create` needs an id the log lacks; `update` and `reinforce` need one it holds; `update` cannot change the type.

**Invariants the store keeps:**

- **Ledger registry (D-LEDGER-REGISTRY).** Only the ledger records what is promoted. Never decide from a log row's `anchor_id` or status: most anchored rows have none, so a guard keyed to it promotes one observation twice under two numbers. `ledgerRegistry` gives `byAnchor` (first row kept) and `byObsId`.
- **Content authority (D-LOG-CONTENT-AUTHORITY).** A ledger row is built only by `toLedgerRowV2(logRow, priorRow, {anchorId, status, date, expectType})`; ledger-owned keys carry over from the prior row. It throws on a non-v2 log row, a type that differs from `expectType`, a malformed anchor, an anchor whose prefix does not match the type (ADR with decision, PF with pitfall) or a non-entry status. It copies faithfully and does not sanitize: formatters collapse control characters at render time, because a hand-edited row can hold anything.
- **History (D-CONTENT-HISTORY).** Before a write replaces content, `appendHistory` records the prior log row and ledger rows `{id, at, ledger, log}`, keeping the last `HISTORY_DEPTH` per id. Deciding that a write leaves content as it was is the caller's job.
- **Quarantine (D-QUARANTINE-MALFORMED).** A line that is not exactly one JSON object is never read as a row and never silently dropped: `readJsonl` returns it among `rejected`, and a writer appends `{rejected_at, source, line, text}` to the file's `.rejected.jsonl` sibling (O_APPEND, O_NOFOLLOW) before rewriting. Read-only paths (`list`, `show`, `--status`, `render`, `--check`, the HUD) count and report, never write. A file that is itself a symbolic link reads as missing (D-NO-LINKED-READ, see the links KB).
- **One-time backup (D-V1-BACKUP-ONCE).** The first write to a tree holding any non-v2 row copies log, ledger and archive to `*.pre-v2.jsonl` with an exclusive create (never overwritten), before any quarantine or rewrite so the copies hold the original bytes. An all-v2 tree makes none. A source file that is a symbolic link is not copied.
- **Due selection (D-DUE-ORDER).** `selectDue` hands maintenance active entries in three classes: integrity-flagged (by anchor), legacy v1 (decisions before pitfalls, by number), then v2 entries last verified more than `DUE.verifyAgeDays` ago (never verified counts as oldest). An entry attempted within `DUE.leaseHours` is leased and skipped. At most `DUE.maxEntries` entries, stopping before the first that would pass `DUE.byteBudget` bytes (compact JSON of ledger row plus log row) but always at least one. Integrity flags, active entries only: `duplicate-obs-id`, `ledger-without-log`, `scope-matches-nothing` (v2 globs; `area:` always matches). The printed reason is the flags joined by `,`, `legacy-v1` or `verify-age`.
- **Verify ref (D-VERIFY-REF).** Claims about code are checked at `origin/HEAD` as last fetched, at `HEAD` only when there is no usable `origin/HEAD`, never in the working tree or index, because the ledger serves every checkout. `resolveVerifyRef` answers `{ref, commit}` or null (no repository or no commit).

## The ops (json-helper.cjs)

Each runs as `cd "<root>" && node "$HOME/.devflow/scripts/hooks/json-helper.cjs" <op> …` from the project root and takes **no path**: every file path is built from the cwd. argv carries only shape-gated tokens (type, anchor `ANCHOR_ID_RE`, observation id, status, flags, the 16-hex claim token). Text arrives as one JSON object on stdin (read from fd 0, capped inside `readStdinJson`). Exit 0 means the op did what stdout says; exit 1 means empty stdout and the reason on stderr, with nothing written. A multi-problem refusal reads `<op>: the input has <N> problems; nothing was written` then one `  <field>: <message>` per problem. Every learning op except `claim-queue` and `release-claim` sends the claim heartbeat first (see the agent KB). The same file serves the hooks' jq-less fallback through generic ops (see the memory-worker KB), which load no learning module and send no heartbeat.

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
- *Update* replaces the whole content, keeps the counters, refuses a type change. A v1 row converts (count becomes observations, created becomes first_seen; pattern, details, amendments and over-limit evidence leave the live row, kept in history and the backup) and is never `unchanged`. A v2 row whose content keys all equal the input is `unchanged` and writes nothing, even if its entries are stale (refresh-anchor repairs that).
- *Reinforce* adds one observation and sets `last_seen`, on v1 rows too (a v1 row stays v1). No history, re-projection or render.
- Every mode refuses a log id held twice, an observation whose anchored entries are all inactive (`restore first`), and an active entry that cannot take the type.
- Re-projection rebuilds every active ledger row carrying the id through `toLedgerRowV2` and re-renders, all under the lock the log was written under (a separate refresh step could be skipped or interleaved); inactive rows stay unchanged. Write order: backup, quarantine log, history, log, then quarantine ledger, ledger, render.

**Read-only ops.**

- **`list`** always prints `ACTIVE n`, `INACTIVE n` (with `<status>` and an indented `note:`: `encoded in <path>`, `superseded by <anchor>` or the status note), `OBSERVATIONS n` (log rows no ledger row carries), `INTEGRITY n`; `MALFORMED n` only when lines were skipped. An ACTIVE item reads `<anchor> <obs_id> v<1|2> verified <date|never> observed <count|?> last-seen <last_seen|-> scope <scope|-> <title>`: the count and last sighting come from the log row carrying its id, and the scope entries are joined by `,` (`-` for a v1 entry). Titles come last, one line, cut to the `FIELD_LIMITS.title` length (a v1 title is its pattern); a missing or multi-word token prints `-`.
- **`show <anchor|obs_id>`** prints pretty JSON `{key, ledger, log, history_versions, flags, malformed?}`. `ledger` is every ledger row carrying the observation (a twin shows too); `flags` holds a `ledger-only-content` flag with `fields` per row whose content its log row lacks (v1: normalized `details` containment; v2: any differing projected field).

**Writers.**

- **`claim-due`** prints `ref <origin/HEAD|HEAD> <sha12>` (`ref none` without a commit), then `<anchor> <reason> <bytes>` lines or `due none`. It stamps `last_attempt` on each active entry handed out and writes only then (backup, ledger quarantine, ledger); it never renders, since no template shows `last_attempt`. Scope-glob git calls run before the lock.
- **`assign-anchor <decision|pitfall> <obs_id>`** (D-E4-SKIP) promotes a v2 observation no ledger row carries. The number is one past the highest any ledger row of that type holds (inactive included; decisions and pitfalls number separately; padded to three digits), skipping each number a tracked file cites as a whole word, at most `E4_MAX_SKIPS`, then it refuses. The scan runs once before the lock: `git ls-files`, else a bounded walk of `CITED_SCAN_MAX_ENTRIES` entries; it skips the learning tree, `CITED_SCAN_EXCLUDED_SEGMENTS` (`.git`, `node_modules`, `target`, `dist`), symlinks, binaries and files over `CITED_SCAN_MAX_FILE_BYTES`, and opens files with O_NOFOLLOW and O_NONBLOCK. stdout is the anchor; each skip is the stderr line `assign-anchor: skipped <anchor>, cited in <path>:<line>`, information not an error. The row is the v2 projection with the type's active status and today (UTC) as `date` and `last_verified`; the log is never written. Refuses an id not in the log or held twice, already promoted, a v1 observation, a type mismatch. Minting over a cited number would silently bind that citation to an unrelated entry.
- **`refresh-anchor <anchor>… [--verified]`**, all or nothing. Without `--verified` each active v2 entry is re-projected from its log row (`reprojected|unchanged <anchor>`, history first when content changes); with it only `last_verified` becomes today (`verified <anchor>`, no log row needed). One refused anchor refuses the batch and every refused anchor is listed: not held once, inactive (`restore it with restore-anchor first`), v1, and without `--verified` a log row missing, doubled, v1 or of another type. A batch that changes nothing writes and renders nothing and exits 0.
- **`retire-anchor <anchor> <Encoded|Superseded|Retired|Deprecated>`** (D-ENCODED-QUOTE) takes stdin by status (other keys refused) and prints `<status in lower case> <anchor>`:
  - `Retired`, `Deprecated`: `{reason}`, one line within `FIELD_LIMITS.note`, kept as `status_note`.
  - `Superseded`: `{by}`, an active entry other than this one (either type), kept as `superseded_by`; every inactive entry that named this one is re-pointed and printed `repointed <anchor>`.
  - `Encoded`: `{at, quote}`: `at` is a relative path within `FIELD_LIMITS.path` with no empty, `.` or `..` segment; `quote` is one line within `quoteMin`..`quoteMax` once whitespace collapses. The quote must appear in the file as committed at the verify ref's resolved commit (`git cat-file blob <commit>:<path>`, whitespace collapsed on both sides, checked before the lock, `quoteAtRef`); kept as `encoded_at: {path, quote, ref, commit}`. A path alone can point anywhere; only a quote found at a ref every checkout shares shows the lesson lives there.
  - Every retirement sets `retired_on` and clears the other notes; content stays, so a v1 entry stays v1. Refuses an already-inactive entry and an absent or inactive successor.
- **`restore-anchor <anchor>`**: an inactive entry becomes active with its type's status and loses `status_note`, `superseded_by`, `encoded_at`, `retired_on`, `last_verified` and `last_attempt`, so the next `claim-due` hands it out ahead of every verified entry; content and `date` stay. Prints `restored <anchor>`.
- **`rotate-observations`** (D-ROTATE-UNREFERENCED) prints `rotated <N> observations` (always plural). Under the lock it deletes leftover `.decisions-usage.json` and `.decisions-usage.lock/`, then archives each log row that no ledger row carries (a log row's own status or copied `anchor_id` is ignored) once its last activity (`last_seen`, else `first_seen`, else `created`) is at least `ROTATE_AGE_DAYS` old; an unparseable date keeps the row. An archived row is appended unless an identical JSON line is already there, then the log is rewritten without it; backup and log quarantine happen only when rows are due. Only the ledger knows what is promoted, and a dedup by id would drop the newer version of a row whose older one is already archived.
- **`claim-queue`** and **`release-claim <token>`**: see the owned claim in the agent KB.

## One lock, no stray tree, no linked tree

**D-ONE-LEARNING-LOCK.** Every write to the log, ledger, side files and rendered files happens under `.decisions.lock`, taken through `withDecisionsLock(opName, root, fn, {timeoutMs, staleMs})` (defaults `LOCK_ACQUIRE_TIMEOUT_MS` and `LOCK_STALE_MS`, mkdir-based). Two writers under two locks each read a file, change it and rename their copy over it, and the second rename silently discards the first's change. `fn` must return a Result (anything else throws a TypeError); a throw propagates after the lock is released; a busy lock answers `<op>: timeout acquiring lock at <lockDir>`. The ops, `render`, `--clear`, `--restore` and `--reset` all use it, and `render` reads the ledger inside it. `render --check` takes none, because taking it would create the lock directory.

**D-NO-STRAY-TREE.** The store never creates `.devflow/learning/` or its parent (the lock mkdir is non-recursive, so ENOENT means no tree). A writer run where the tree is absent refuses `<op>: no .devflow/learning/ under <root> — run from the project root` and creates nothing; `list`, `show` and `render --check` refuse the same way. A writer run from the wrong directory would otherwise create a ledger no session ever reads. Only the capture hooks (through `queue_append_row`, after its link check), `ensure-devflow-init`, `session-start-context` (healing an older install) and `devflow learning --configure` create the tree, each only where no link sits on the way.

**D-NO-LINKED-TREE.** `withDecisionsLock` is also where a writer learns that `.devflow` or `.devflow/learning` is a symbolic link: it refuses with kind `not-a-directory` before taking the lock (the full rule is in the links KB). An absent tree and a linked tree both leave everything unchanged.

## Render (render-decisions.cjs, decisions-format.cjs)

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
- **Index lines** (`formatIndexEntryLine`, `formatIndexEntryLineV2`; the cut lengths are literals there, exercised by `tests/decisions/decisions-format.test.ts`): v1 `  {anchor}  {title cut + …}  [{status}]` (+ `  —  {area cut + …}`); v2 `  {anchor}  {title}` (+ `  —  {scope joined ', ' cut + …}`), no status tag, title whole. `Decisions (N):` and `Pitfalls (N):` count both kinds; the footer names the absolute `decisions.md` and `pitfalls.md` paths, so the same ledger rendered at two roots differs in exactly those two lines. An empty corpus writes `(none)`.
- **Render CLI**: `render-decisions.cjs render|--check <worktree>` runs from the project root and `<worktree>` must realpath-equal the cwd (it is only compared; no path is built from argv). `render` locks and reads the ledger inside the lock; `--check` locks nothing, writes nothing, prints `[render-decisions] DRIFT: <path>[ (missing)]` and exits 1 on drift. Malformed ledger lines print `MALFORMED: N …` on stderr and are never quarantined by render. The one `process.exit` sits outside every lock.

## Constraints

Every loop and read has a bound, each a named constant: `E4_MAX_SKIPS`, `CITED_SCAN_MAX_ENTRIES`, `CITED_SCAN_MAX_FILE_BYTES`, `DUE` (entries and byte budget), `HISTORY_DEPTH`, the stdin cap in `readStdinJson`, `GIT_TIMEOUT_MS` and `GIT_MAX_BUFFER`, and the lock waits (`LOCK_ACQUIRE_TIMEOUT_MS`; the queue lock's `QUEUE_LOCK_TIMEOUT_MS`; the CLI's `LOCK_WAIT_MS`). No op takes a path. Every git call in the store goes through its one `git(root, args)` wrapper, whose body prepends `['-c', 'core.fsmonitor=false', …]` (**D-NO-FSMONITOR**: an index read runs the command a repository's `core.fsmonitor` names; the guard honours a wrapper only when its own body prepends the override, so a new call outside it must spell the override; the full block is at `listGitTrackedFiles`). The store appends with O_NOFOLLOW and reads a file with lstat plus O_NOFOLLOW (see the links KB).

## Anti-Patterns

- **KB-AP-4, a store function that exits**: `process.exit()` skips the `finally` that releases the lock. Return a Result and let `json-helper` set `process.exitCode` once, outside every lock.
- **KB-AP-6, the fsmonitor override**: see Constraints (D-NO-FSMONITOR); a call whose argv is built at run time is equally an anti-pattern.
- **KB-AP-5, passing text or a path on argv**: argv holds the shape-gated tokens of each op; text reaches an op only on stdin, through a quoted heredoc, so the shell expands nothing in it.

## Gotchas

- **KB-AP-9**: `unchanged` means equal content keys, so a v2 row whose entries lag is not repaired by an update; run `refresh-anchor` without `--verified`. Every writer re-serializes all rows with `JSON.stringify`, so a hand-edited non-canonical line is normalized with the same values.
- **KB-AP-10**: `refresh-anchor` refuses v1 and inactive entries, so the closing `--verified` batch must list active v2 entries only; rewrite a kept v1 entry with `put-observation --update` first. `retire-anchor` and `restore-anchor` work on v1 and leave it v1; `assign-anchor` refuses a v1 observation.
- **KB-AP-11**: a put's "restore first" applies in every mode: run `restore-anchor`, then the put. Restore clears `last_verified` and `last_attempt`, so the entry is due again whatever lease it had: `selectDue` hands it out after integrity problems and legacy v1 entries (among them if it is one), ahead of every verified entry.
- **KB-AP-12**: `claim-due` leases an entry for `DUE.leaseHours`; treat each line as that run's work list.
- **Empty corpus**: `index.md` is `(none)`; consumers treat `(none)` and empty as absent. The TL;DR is plural for one (`1 decisions`).
- **A new ledger key** must join `LEDGER_OWNED_KEYS` or it does not survive projection (KB-INV-1).

## Key Files

| File | Purpose |
|------|---------|
| `src/assets/scripts/hooks/lib/learning-store.cjs` | The store: schema, validation, projection, locking, every writer and reader |
| `src/assets/scripts/hooks/json-helper.cjs` | Op dispatcher: `learning()` lazy load, `emit`, `readStdinJson`, `LEARNING_OPS`, heartbeat; exports nothing |
| `src/assets/scripts/hooks/lib/render-decisions.cjs` | Renderer, `renderLearningFiles`, `render`/`--check` CLI |
| `src/assets/scripts/hooks/lib/decisions-format.cjs` | v1 formatters (byte-stable), v2 body, Inactive table, TL;DR, index builder |
| `src/assets/scripts/hooks/lib/project-paths.cjs` · `src/core/project-paths.ts` | Path single source, export parity pinned by a test |
| `src/assets/scripts/hooks/lib/mkdir-lock.cjs` · `lib/safe-path.cjs` | mkdir lock helpers, path safety |
| `src/core/learning-store.ts` | Typed seam onto the store (see the agent KB) |
| `src/core/observations.ts` | Status lists mirrored for the HUD, parity pinned by a test |
| `tests/decisions/learning-fixtures.ts` | Row factories, `seedLearningTree`, `initGitRepo`, `runJsonHelper`, `requireLearningStore` |
| `tests/decisions/learning-store.test.ts` | Store behaviour, including the linked-tree and linked-file suites |

## Related

- `.devflow/features/learning-capture-system/KNOWLEDGE.md`: the hub: data files, feature switches, roots, the capture hooks and the table of D-series names.
- `.devflow/features/learning-capture-system-agent/KNOWLEDGE.md`: the Learning agent that drives these ops, the owned queue claim and heartbeat, `devflow learning`, the TypeScript seam and the HUD.
- `.devflow/features/learning-capture-system-links/KNOWLEDGE.md`: how the store refuses to write or read through a symbolic link (`linkedLearningFolder`, `readTextUnlinked`).
- `.devflow/features/learning-capture-system-memory-worker/KNOWLEDGE.md`: the generic jq-less ops that share `json-helper.cjs`.
- `.devflow/features/test-harness/KNOWLEDGE.md`: the guards on this area (`no-ledger-citations`, `no-fsmonitor-index-read`).
- `docs/reference/hooks.md` (the Learning pipeline) and `docs/reference/file-organization.md` (the data-file table and ops).

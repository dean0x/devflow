---
feature: learning-capture-system-agent
name: Learning agent, queue claim, directives and CLI
description: "Use when changing the Learning agent, the queue claim and heartbeat, session-start-context directives, the devflow learning CLI, the store TS seam or HUD counts. Keywords: claim-queue, LEARNING MAINTENANCE."
category: architecture
directories:
  - src/assets/agents/learning.md
  - src/assets/agents/tracker.md
  - src/assets/scripts/hooks/session-start-context
  - src/cli/commands/learning.ts
  - src/core/learning-store.ts
  - src/core/observations.ts
  - src/core/learning-tuning-config.ts
  - src/core/learning-queue-cleanup.ts
  - src/core/queue-drain.ts
  - src/hud/components/learning-counts.ts
created: 2026-10-10
updated: 2026-10-10
---

# Learning Agent, Queue Claim, Directives and CLI

## Rules

- **KB-INV-1** The learning queue is claimed and released only by the `claim-queue` and `release-claim` ops, under the learning lock; the claim and owner files are never deleted, moved or rewritten by hand (only the deliberate `--clear`, `--disable` and `--reset` drains touch them).
- **KB-INV-2** `CLAIM_STALE_SECS` (store) and `PROCESSING_STALE_SECS` (hook) are two literals held equal by the lockstep test in `tests/decisions/learning-claim.test.ts`; the hook's check is advisory, the op decides under the lock. The Tracker's `TRACKER_PROCESSING_STALE_SECS` is separate on purpose.
- **KB-INV-3** Every `LEARNING_OPS` op first sends the claim heartbeat (`touchClaim`); a new learning op must join `LEARNING_OPS` and `LEARNING_OP_RUNS` in `tests/decisions/learning-claim.test.ts`.
- **KB-INV-4** The Learning agent writes only through `json-helper.cjs` ops (no Write or Edit tool); `release-claim` is its final act, and it never recreates anything once its inputs vanish.
- **KB-INV-5** The Learning agent is hook-spawned, never named by a command; its shipped tier (model, no `effort:` line, no preload, CLAUDE.md kept) is one row in `tests/fixtures/agent-config.ts`, edited together with the `model:` line and `DEFAULTS.model` in `learning-tuning-config.ts`.
- **KB-INV-6** The directive's model resolves by precedence (project `learning.json`, the `devflow agents` Learning mapping, global `learning.json`, none); the two `learning.json` values pass the `opus|sonnet|haiku` allowlist, and the mapping never emits `model=`.
- **KB-INV-7** `$LEDGER_ROOT` enters a directive only when `DIRECTIVE_LEDGER_SAFE` admits it; a refused root with pending work emits the fixed `LEARNING PAUSED` notice, which interpolates nothing.
- **KB-INV-8** The `devflow learning` CLI reaches ledger state only through the store loaded by `loadLearningStore()`; a store function it calls needs the interface entry, the `LEARNING_STORE_SURFACE` entry and the fixtures' `LearningStoreApi`.
- **KB-INV-9** `--clear` drops exactly the log rows no ledger row carries (`clearUnreferenced`); `--reset` empties the directory under the lock, sparing only the lock directory; both confirm on a TTY before the lock.
- **KB-INV-10** `src/core/observations.ts` imports nothing, so the HUD import closure does not grow; its status lists are held equal to the store's by a parity test.
- **KB-AP-1** Claiming the queue with `mv`, or hand-editing the claim or owner file: a check-then-`mv` claim lets two runs claim at once and clobber a batch.
- **KB-AP-2** Quoting plumbing numbers (claim staleness, the claim-due batch size) in the Learning prompt: they live in plumbing and a prose copy drifts.
- **KB-AP-3** Skipping the model allowlist in `session-start-context`: `learning.json` is user-controlled.
- **KB-AP-4** Emitting `model=` from the `devflow agents` mapping: a model named at an Agent spawn outranks the installed frontmatter, which is where `devflow agents` writes its override.
- **KB-AP-5** Adding a CLI flag without a write-set fence row (`tests/write-set-fence.test.ts`) and a floor bump in `tests/fixtures/numeric-floors.json`.
- **KB-AP-6** Truncating the whole log to clear learning: every entry would lose its content authority.
- **KB-AP-7** Seeding a `session-start-context` test without a temp `$HOME`: a real manifest with learning off would silently gate the test.
- **KB-AP-8** Assuming the learning switch gates the tracker-setup directive: it does not.
- **KB-AP-9** Recreating a claim, owner file or learning tree once it has vanished mid-run: the agent stops writing and goes to Finishing.

## Overview

Learning is processed by the **Learning agent**, a background subagent that `session-start-context` tells the main model to spawn whenever turns are pending. It claims the queue through the owned claim, judges the claimed turns, and maintains the ledger through the store's ops (see `learning-capture-system-store`). The agent's frontmatter lists four tools (Read, Bash, Glob, Grep), but Claude Code offers no Grep or Glob to an agent that holds Bash, so its search steps are Bash commands (`git grep -P`, `find`). This KB covers the claim, the agent, the directives `session-start-context` emits, the `devflow learning` CLI, the TypeScript seam and the HUD counts.

## The owned queue claim and heartbeat (D-OWNED-CLAIM)

The queue is claimed and released only by the `claim-queue` and `release-claim` ops, under the learning lock.

- **Claim.** No learning directory gives `none` (nothing created). A claim path that is not a regular file is an error. A claim younger than `CLAIM_STALE_SECS` is `busy`. An older one is a **takeover** (`claimed <token> takeover`): new owner token, mtime set to now, the waiting queue left for the next claim. No claim and a missing or empty queue gives `none`.
- **Fresh claim.** Under `<queue>.lock` (`QUEUE_LOCK_TIMEOUT_MS` wait, `QUEUE_LOCK_STALE_MS` stale; the lock queue-append's overflow truncation takes, so truncation never rewrites rows already claimed): `link(queue, claim)` (EEXIST busy, ENOENT none, EPERM/ENOTSUP fall back to rename), unlink the queue (undoing the link if that fails), set mtime to now, write `.pending-turns.owner` (8 random bytes, 16 hex, `CLAIM_TOKEN_RE`) and answer `claimed <token>`.
- **Release.** Claim gone gives `gone` (the owner file is removed only if it names this token); owner file not naming the token gives `not-owner`; else both removed give `released`.
- Why: a check-then-`mv` claim lets two runs claim at once and clobber a batch, `mv` keeps the queue's old mtime so a fresh claim looks stale, and an unconditional final unlink deletes another run's claim.

**Heartbeat.** Every `LEARNING_OPS` op (assign, retire, restore, refresh, rotate, put, list, show, claim-due) first runs `touchClaim`: `lutimes` on an existing claim, never creating one, never following a symlink at the claim path, no lock, and nothing at all (`touched: false`) when `.devflow` or `.devflow/learning` is a symbolic link (D-NO-LINKED-TREE: `lutimes` follows a linked folder above the claim, and the op that follows refuses that tree anyway); a failure goes to stderr and never stops the op.

**Staleness.** `CLAIM_STALE_SECS` and the hook's `PROCESSING_STALE_SECS` are pinned equal by a lockstep test; the hook's check is advisory (it decides only whether to spawn), the op decides under the lock. Left open by design: a live run silent past the bound can be taken over (duplicate work, no loss, the old run's release answers `not-owner`); `--clear`, `--disable` and `--reset` delete a live claim and the run stops on vanished inputs; a crash leaves the claim for takeover after the bound.

## The Learning agent

`src/assets/agents/learning.md`: `model: opus` with no `effort:` line (it follows the session), tools listed Read, Bash, Glob, Grep (no Write, no Edit; the Grep and Glob entries are inert because the agent holds Bash, so it searches with `git grep -P` and `find`), no preloaded skill (its body never reads one), and the CLAUDE.md context kept (the frontmatter has no `omitClaudeMd:` line): its Encoded check reads the rules stated there, and without that context the agent stopped retiring entries as Encoded (an A/B over frozen batches also showed a cheaper sonnet candidate falling short of the capture bar). Hook-spawned, never named by a command. `tests/guards/agent-config.test.ts` pins the row against the shared table in `tests/fixtures/agent-config.ts`, and `tests/decisions/config.test.ts` holds the default model in `learning-tuning-config.ts` equal to it (D-LEARNING-SHIPPED-ROW). Iron Law: assign-anchor owns numbering, render owns the `.md`, never hand-edit. One run, in order:

- **Step 0.** `claim-queue`: `claimed <token>` (keep it for the final release), `claimed <token> takeover` (the stale run may have stored part of the batch, so do not reinforce an observation that already states a turn), `busy` (exit silently), `none` (report "no pending decisions work"), non-zero exit (stop, report stderr).
- **Part 1, capture.** Read the claimed turns (all, or only the latest dialog-worthy ones when huge; the prompt states the window). Abstain by default: a decision is a real fork with rationale, a pitfall a non-obvious transferable failure; one incident yields an ADR or a PF, never both; if `git grep -P` or `find` finds a test, guard, CLAUDE.md, rule or prompt that already states it, record nothing.
  - Run `list` once and `show` candidates. An active entry or stored observation covers it: `--reinforce` (or `--update` with the whole content when the turns sharpen it); a Superseded one: act on its successor; any other inactive entry: `restore-anchor`, then `--update`, never a new entry; else `--create`.
  - Promote with `assign-anchor` once it recurs or is clearly significant; an unpromoted observation waits, then rotates after `ROTATE_AGE_DAYS` idle days.
  - A status change the turns report is checked at the verify ref (`git show <ref>:<path>`, never `git grep` or the working tree) before acting.
- **Part 2, maintain.** `rotate-observations`, then `claim-due` once (its ref line is the verify ref; `due none` ends; `ref none` leaves every due entry). Per due entry `show`; a `ledger-without-log` entry first gets `put-observation --create` under its id. Then the first matching rung, exactly one final action, Keep when unsure:
  1. **Encoded**, by a strict bar: a test or guard that fails on any new violation in scope, or the rule stated in CLAUDE.md, a rules file or a prompt loaded for that scope. A refused quote means Keep.
  2. No longer true at the ref: rewrite the scope, or Retired.
  3. Duplicate: absorb into the survivor with `--update`, then Superseded.
  4. One-off: Retired.
  5. Keep, rewriting only when legacy-v1, wrong or vague (read a v1 entry's `ledger-only-content` flags first).
  - Close with one `refresh-anchor … --verified` batch of the kept entries (active v2 only; if refused, drop the named anchors and run once more).
- **Heartbeat and vanished inputs.** Every op refreshes the claim; at the Part 1 to Part 2 boundary and after each maintained entry the agent runs `touch -c <claim> && test -f <claim>` (the `test -f` fails once the claim is gone). If that fails, or an op answers `no .devflow/learning/ under …`, stop writing, go to Finishing, never recreate anything.
- **Finishing.** `release-claim <token>` is the FINAL act (`not-owner`, `gone` or a no-learning-dir refusal is noted in the summary); never delete, move or rewrite the claim or owner file. End with a 1 to 3 line summary, the run's only visibility surface.

The prompt carries the entry format with a good and a bad example and quotes every op's stdout form. It states no plumbing numbers (claim staleness, the claim-due batch size): they live in plumbing and a prose copy drifts. Only the rotation and verify-age days stay, pinned by a test (`tests/learning-agent.test.ts`).

## session-start-context directives

The hook assembles `additionalContext` from numbered sections. Section 1 (the decisions TL;DR, the Index line and the pass rule) belongs to the decisions delivery route and is in `learning-capture-system-delivery`. The rest:

- **Carve-out** (before Section 1): the hook sources `ensure-root-gitignore` (the `.devflow/` carve-out) unless `df_no_symlink_below` finds `.devflow` a symbolic link (the marker would land in the folder the link names); the skip is logged once through `log()` and context injection goes on. `hook-log-init` is sourced before the carve-out, so `ensure-root-gitignore`'s own skips (a linked root `.gitignore`, a legacy copy it could not write, a linked marker) reach the log too: with memory and learning both off, this is the only hook that reaches the carve-out.
- **Section 2** emits `--- LEARNING MAINTENANCE ---` when the queue is non-empty or `.pending-turns.processing` is stale (at least `PROCESSING_STALE_SECS`); a fresh claim suppresses it. The queue, the batch and the project `learning.json` are read through `df_file_below "$LEDGER_ROOT"`, so one a link leads to counts as absent: a linked queue or stale batch sends no agent to it, and a linked `learning.json` does not choose the model. The check is advisory: a spawn that loses the race exits on `busy`. `$LEDGER_ROOT` is embedded only when `DIRECTIVE_LEDGER_SAFE` (positive shape `^[A-Za-z0-9/._+-]+$`, `+` for Claude Code's `feat+x` worktrees) admits it; a refused root with pending work emits the fixed `--- LEARNING PAUSED ---` notice, which interpolates nothing. The spawn is `subagent_type="Learning"`, `run_in_background: true`, prompt "Process the pending learning queue per your agent instructions. Project root: $LEDGER_ROOT".
  - **Model resolution (D-LEARNING-MODEL-PRECEDENCE)**: four layers, the first that supplies one decides. (1) A valid project `learning.json` `model`, which emits `model="<value>"`. (2) The `devflow agents` Learning mapping, `agents.learning.model` in `$HOME/.devflow/agent-models.json`, which emits no `model=` so the installed frontmatter decides. (3) A valid global `learning.json` `model`, which emits `model=`. (4) None, again no `model=`. Layers 1 and 3 pass the `opus|sonnet|haiku` allowlist (learning.json is user-controlled) and an invalid value falls through.
  - **Layer 2 detail.** It counts only when `agents.learning.model` is a JSON **string** that is a model name by the rule `readAgentMapping` keeps a model by (`MODEL_NAME_RE` in `src/core/agent-frontmatter.ts`: a letter or digit, then letters, digits, `.`, `_` or `-`, within the length bound), read through `json_string_field_file` so the number `42` is not the name `"42"`; its value is never interpolated into the directive, only its validity decides precedence. Anything `readAgentMapping` would drop (a number, boolean, object, array, empty or out-of-charset string) supplies no model, so the layer reads as absent and the lookup falls through to the global file rather than honouring a mapping for a model nothing will run. An effort-only mapping entry supplies no model; a missing, unreadable or malformed `agent-models.json` reads as absent; a dormant external mapping model still decides, since the hook does not know the proxy state. The name test spells its character sets out because a range such as `A-Za-z` matches accented letters in a UTF-8 locale on bash 3.2, and the value is read with a trailing sentinel so a trailing newline fails the test instead of being stripped.
  - **No `opus` fallback in the hook.** The shipped tier lives in `agents/learning.md`, and `DEFAULTS.model` in `learning-tuning-config.ts` is that same tier (D-LEARNING-SHIPPED-ROW), held equal to the Learning row of the shared agent-config table, so a change of the shipped tier edits the row, the `model:` line and that default together. Layer 2 sends no model because a model named at an Agent spawn outranks the installed frontmatter, which is where `devflow agents` writes a user's override; the no-hardcoded-model guard scans commands, agents, skills and reference modules, and hook directives sit outside it by design (the Tracker directive pins its model; this one emits one only under the precedence above).
- **Section 3, tracker setup** (`--- TRACKER SETUP ---`, not gated by the learning switch, so disabling learning does not disable the issue tracker):
  - The machine provider comes from the `.tracker.enabled` sentinel (provider name on one line, read with `read`, zero forks), overridden by committed `project.json` or narrowed by personal `config.json` only when a bounded read shows a `"tracker"` key (one fork of `resolve-settings.cjs`; a git-tracked `config.json` is ignored, D-PERSONAL-UNTRACKED). Then a POSITIVE `jira|linear` allowlist (never `!= github`) and a skip when `~/.devflow/tracker/$P.md` exists.
  - `tracker_gates_open()` runs cheapest first: attempt cap, git marker, `source` in {startup, clear}, claim freshness, path shape, and the counter increment must land. GitHub and a learned provider fork nothing.
  - `.tracker.{provider}.attempts` is one decimal-integer line (absent, malformed or zero-padded counts as 0 and is self-healed; an over-long digit run counts as `TRACKER_ATTEMPTS_MAX`); the hook increments on emission, the agent deletes it only on a successful write and the claim file last. The section is capped at `TRACKER_SECTION_MAX_CHARS` (the numeric-floors ceiling `tracker-section-max-chars`).
  - The Tracker agent (`tracker.md`, `model: sonnet`) has the same claim and heartbeat shape with its own `TRACKER_PROCESSING_STALE_SECS` bound; provider selection and schema belong to the `tracker-feature` KB.
- **Section 4** (D-LEGACY-LOCAL-NOTICE): one line asking the user, once, to run `devflow uninstall --scope local` when `<root>/.claude/settings.json` registers a devflow hook (a command ending in `/scripts/hooks/run-hook <marker>`).
- **Sections 5 and 6** have nothing to do with learning and add no exit path. Section 5 (D-COMPACT-RESUME-DIRECTIVE): on a positive `compact` case of the SessionStart `source` (read with `cwd` in one `json_extract_cwd_field` subprocess), one fixed single-quoted line, capped by the numeric-floors ceiling `compact-directive-max-chars`, is appended to the context, telling the model to re-read a running devflow command from the phase in progress. Section 6 (D-CLAUDE-MD-IMPORT-AUDIT, D-AUDIT-STAMP): an audit of CLAUDE.md `@path` imports by `claude-md-audit.cjs`, reported in a top-level `systemMessage` that never enters the model's context, with a stamp at `~/.devflow/.claude-md-audit` that makes an unchanged start free of forks.

## devflow learning CLI (`src/cli/commands/learning.ts`)

A thin router (status, list, show, configure, reset, clear, restore, enable, disable). It reads and writes the log, ledger and rendered files only through the store loaded by `loadLearningStore()` (`--configure` and the queue drain write their own files directly, each only past `firstSymbolicLink`, D-CLI-NO-SYMLINK), and locates the ledger with `getLedgerRoot()` (the main checkout from a linked worktree). Writers wait at most `LOCK_WAIT_MS` for the lock and answer `The learning store is busy: another run holds its lock. Nothing was <cleared|restored|reset>; try again in a moment.` (exit 1). A writer facing a linked `.devflow` or `.devflow/learning` answers the store refusal instead (`<op>: <folder> is a symbolic link, not a directory; nothing was changed`, exit 1; D-NO-LINKED-TREE).

- **`--status`**: `Learning: enabled|disabled` (+ `Effective here:`), `Entries: A active (n decisions, m pitfalls), I inactive (Status k, …)`, `Legacy v1 entries: v of A active`, `Observations: L in the log, U not yet promoted`, and a warning when lines were skipped. Reads only, no scope check, no path printed; outside git `Entries: not in a git project`.
- **`--list`** prints exactly the `list` op's text; **`--show <id>`** prints the `show` JSON with every DEL, C1, directional, line-separator and bidi character escaped as `\uXXXX`, so a terminal shows it as written. Both read the cwd outside git; no learning directory gives `No learning data in this project yet.`
- **`--restore <id>`** needs a git root and an entry id and calls `restoreAnchor`: `Restored <anchor> (<status>); it is due for review again.`
- **`--clear`** (D-CLEAR-UNREFERENCED): TTY confirm, then `clearUnreferenced` drops exactly the log rows no ledger row carries, whatever their age or status, and keeps every row an entry carries. It refuses while the ledger holds a malformed line (that line may carry a row it would drop), never writes the ledger, archive or rendered files, and with nothing to drop writes nothing. Only after it succeeds does the CLI drain the queue, claim and owner file (through a linked `.devflow` or `.devflow/learning` it deletes nothing: the success line then omits "drained the learning queue" and a warning names the link, D-CLI-NO-SYMLINK). Truncating the whole log would orphan every entry, each losing its content authority.
- **`--reset`** (D-RESET-UNDER-LOCK): no learning directory gives `No learning data to reset.`, nothing created. The TTY confirmation comes BEFORE the lock; `resetLearning` then empties the directory under the lock, sparing only the lock directory, and removes the emptied directory after the release, only if nothing arrived meanwhile (removing the lock with the directory would let a release delete the lock of a writer that recreated the tree). It removes everything: queue, claim, owner and tuning config included. A `.devflow` or `.devflow/learning` that is a symbolic link is refused with nothing removed (`not-a-directory`, by `withDecisionsLock`, D-NO-LINKED-TREE), since emptying it would empty the directory it leads to; a link inside the directory is removed, never what it points to. `resetLearning` carries no check of its own.
- **`--enable/--disable`** write `features.learning`, then converge the installed prompts onto it through `applyLearningToggle` (the learning-on or learning-off commands and agents, and the `devflow:apply-decisions` skill, with the `devflow agents` mapping reapplied when an agent was rewritten; see `learning-capture-system-delivery`). The converge warns on a skip (no readable manifest, or a manifest version that is not the running CLI's) or a failure and never changes the exit code; when it changed something it prints one `Installed prompts:` line. Disable also drains this project's queue (`drainLearningQueue`: queue, claim, owner), and through a linked `.devflow` or `.devflow/learning` it deletes nothing and warns, the switch still turned off and the exit code 0.
- **`--configure`** writes `learning.json` at the ledger root (project) or `~/.devflow` (global; its scope hint says a `devflow agents` Learning mapping takes precedence over the global file); the project file is written only when `.devflow`, `learning/` and `learning.json` are all not links, else `Project config not written: <link> is a symbolic link, and devflow writes nothing through one` and exit 1 (D-CLI-NO-SYMLINK). The model picker marks as Recommended the model the Learning agent ships with, read from its frontmatter through `loadShippedAgentDefaults` (`learningModelOptions`, D-LEARNING-SHIPPED-ROW), never from a list of its own.

## TypeScript seam, status lists and HUD

**D-LEARNING-STORE-SEAM.** `loadLearningStore(dir = scriptsDir())` loads `hooks/lib/learning-store.cjs` with evidence-policy's `loadScript` and shape-checks it against `LEARNING_STORE_SURFACE` (`satisfies Record<keyof LearningStoreModule, SurfaceKind>`: `INACTIVE_STATUSES`, `ANCHOR_ID_RE`, `readLearningState`, `buildListing`, `readListing`, `formatListing`, `showByKey`, `restoreAnchor`, `clearUnreferenced`, `resetLearning`). It never throws (`not-found` and `unusable` map to "learning store not found|failed to load — reinstall devflow-kit"). The interfaces are transcribed from the store's JSDoc and are the TS side's only shape authority, so a store function the CLI calls needs the interface entry, the surface entry and the fixtures' `LearningStoreApi`. The CLI loads the package copy while hooks and ops run `~/.devflow/scripts`, so the two can differ until `devflow init`.

`src/core/observations.ts` mirrors the status lists (D201) and imports nothing, so the HUD import closure does not grow (the install goldens list `core/observations.js`); a parity test pins it equal to the store's lists. The HUD component (D309) counts ledger rows with `anchor_id` set and `isActiveDecisionsStatus`, from `decisions-ledger.jsonl` and never the rendered markdown, silent on malformed lines, and it reads the ledger only through `readBoundedLedger` (see the links KB), showing no counts otherwise; `gatherLedgerLearningCounts` uses `getLedgerRoot` inside the git-status `Promise.all` (a tight time budget).

## Anti-Patterns

- **KB-AP-1, claiming by `mv`**: `mv` keeps the queue's old mtime, so a fresh claim looks stale; an unconditional final unlink deletes another run's claim. Use only the two ops (the deliberate `--clear`, `--disable` and `--reset` drains are the exceptions).
- **KB-AP-4, honouring the Learning mapping with `model=`**: see the layer 2 detail; the installed frontmatter must decide.

## Gotchas

- **KB-INV-2**: the staleness is two literals (`CLAIM_STALE_SECS` and the hook's `PROCESSING_STALE_SECS`); change both. The Tracker's bound is separate.
- **KB-AP-7**: every `session-start-context` test seeds a temp `$HOME` (the hooks read `$HOME/.devflow` only).
- **KB-AP-5**: new CLI flags need a write-set fence row (`tests/write-set-fence.test.ts`) and a floor bump in `tests/fixtures/numeric-floors.json`; the fence runs the built CLI. Spawn-backed learning tests need spawn-sized timeouts under full-suite load.
- **KB-AP-8**: Section 3 is not gated by the learning toggle.
- **The CLI package copy and the installed copy of the store can differ** until `devflow init` (the seam loads the package copy).

## Key Files

| File | Purpose |
|------|---------|
| `src/assets/agents/learning.md` · `tracker.md` | The two hook-spawned agents |
| `src/assets/scripts/hooks/session-start-context` | Sections 1 to 6; Sections 2 to 6 are recorded here |
| `src/cli/commands/learning.ts` | `devflow learning`; `--enable/--disable` converge the installed prompts through `applyLearningToggle` |
| `src/core/learning-store.ts` | Typed seam onto the store (D-LEARNING-STORE-SEAM) |
| `src/core/observations.ts` | Status lists (D201) |
| `src/core/learning-queue-cleanup.ts` | `drainLearningQueue`: queue, claim, owner; answers a `QueueDrain` (D-CLI-NO-SYMLINK) |
| `src/core/queue-drain.ts` | `drainQueueFiles`, `QueueDrain`, `formatRefusedDrain` |
| `src/core/ledger-root.ts` | `getLedgerRoot`, the twin of `DF_LEDGER_ROOT` |
| `src/hud/components/learning-counts.ts` | HUD counts (D309); `readBoundedLedger` and `LEDGER_MAX_BYTES` |
| `src/core/learning-tuning-config.ts` | Tuning merge; `DEFAULTS.model` held equal to the Learning row |
| `tests/decisions/learning-claim.test.ts` · `learning-store.test.ts` · `tests/learning-agent.test.ts` | Claim, store and prompt pins (including the staleness lockstep) |
| `tests/decisions/cli-subcommands.test.ts` | The CLI's subcommands and link rules |
| `tests/guards/agent-config.test.ts` · `tests/fixtures/agent-config.ts` | The shipped agent table (Learning's row: opus, no effort line, no preload, CLAUDE.md kept) |
| `tests/seams/tracker-key-path.test.ts` · `tracker-claim-staleness.test.ts` | Tracker key-path parity and the shared claim-staleness bound |

## Related

- `.devflow/features/learning-capture-system/KNOWLEDGE.md`: the hub: capture hooks, feature switches, roots and the table of D-series names.
- `.devflow/features/learning-capture-system-store/KNOWLEDGE.md`: the ops the agent calls, the lock, `clearUnreferenced` and `resetLearning`, rendering.
- `.devflow/features/learning-capture-system-delivery/KNOWLEDGE.md`: session-start Section 1, `DECISIONS_CONTEXT`, the learning variants and the converge that `--enable/--disable` runs.
- `.devflow/features/learning-capture-system-links/KNOWLEDGE.md`: the symbolic-link rules behind `firstSymbolicLink`, `touchClaim`, `df_file_below` and `readBoundedLedger`.
- `.devflow/features/tracker-feature/KNOWLEDGE.md`: provider selection, the Tracker agent's schema and the Git agent's reader side for Section 3.
- `.devflow/features/external-model-routing/KNOWLEDGE.md`: the `agents.*` entries in `agent-models.json` and the `devflow agents` writer the Learning mapping rides on.
- `docs/reference/hooks.md`, `docs/cli-reference.md`: the Learning pipeline and the `devflow learning` flags.

---
feature: learning-capture-system-memory-worker
name: Memory worker, backup and jq-less JSON fallback
description: "Use when changing background-memory-update, memory-worker, the claude -p argv or version probe, the pre-compact backup, or the json-parse jq-less wrappers. Keywords: verify_and_swap, agents.memory, backup.json."
category: component-patterns
directories:
  - src/assets/scripts/hooks/memory-worker
  - src/assets/scripts/hooks/background-memory-update
  - src/assets/scripts/hooks/pre-compact-memory
  - src/assets/scripts/hooks/session-start-memory
  - src/assets/scripts/hooks/is-hex-sha
  - src/assets/scripts/hooks/json-parse
  - src/assets/scripts/hooks/json-helper.cjs
  - src/core/agent-models.ts
  - src/cli/commands/memory.ts
created: 2026-10-10
updated: 2026-10-10
---

# Memory Worker, Backup and jq-less JSON Fallback

## Rules

- **KB-INV-1** The model writes ONLY `WORKING-MEMORY.md.new`; `verify_and_swap()` assigns exactly one outcome: `updated` (valid stamp, matching `cksum`, atomic `mv`), `conflict` (`.processing` kept) or `failed` (`.processing` left for cold-path recovery).
- **KB-INV-2** A CAS conflict heartbeat-touches `.processing`, which extends the cold-path liveness window; the orphan gate skips when `.processing` already exists.
- **KB-INV-3** The worker's model and effort come from `agents.memory` in `agent-models.json` (shipped row `WORKER_AGENTS.memory`), each checked on its own; only a value that passed its match reaches argv, and `tests/agent-models-worker.test.ts` holds the hook's literals equal to `agent-models.ts`.
- **KB-INV-4** A CLI version probe (`probe_claude_version`, bounded by `DEVFLOW_BG_VERSION_PROBE_SECS`, run before the lock) picks the argv: at or above `MEMORY_MIN_CLAUDE_VERSION` the lean form, otherwise the legacy form, because one flag an older CLI does not know fails every run.
- **KB-INV-5** Write-only is safe only because the staged path is empty before every run: after the lock the worker removes a leftover `WORKING-MEMORY.md.new`, and if anything still stands there it logs `SKIP`, exits 0 before claiming the queue and runs no LLM.
- **KB-INV-6** The prompt carries everything uncut and goes by heredoc stdin, never argv: the bound is the row window and `MEMORY_READ_LIMIT`, never a cut turn; the untrusted data blocks sit in named XML tags under a DATA-not-instructions preamble.
- **KB-INV-7** A queue with no `assistant` or `qa` row exits with no LLM run and is LEFT in place (hooks of one event run in parallel); the next run takes the whole turn.
- **KB-INV-8** The outcome literals of `compute_commits_since_note()` are a test contract, and `cksum` must be on PATH or the worker exits (a `cksum` failure on the target forces `conflict`).
- **KB-INV-9** `CLAUDE_CODE_EFFORT_LEVEL` is unset before the spawn on both argv forms, while `DEVFLOW_BG_UPDATER=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` stay set on both.
- **KB-INV-10** `pre-compact-memory` writes `backup.json` whole into `backup.json.tmp.<pid>` and renames it over the old one; a bad backup reads as no backup (the guarded first read in `session-start-memory`).
- **KB-INV-11** `hooks/json-parse` wrappers run `jq` when installed and otherwise one generic op on `node`; with neither, `_JSON_AVAILABLE` is false and a hook checks it after sourcing; no op takes a path, files arrive on stdin.
- **KB-INV-12** A node fallback is silent on stderr exactly where its jq path is; failure is a status, not a message, so a caller that must survive it checks the status.
- **KB-AP-1** Widening the worker's tools, restoring `--allowedTools`, or adding a lean flag outside the version floor: every Write can fail while the run exits 0, and an unknown flag fails every run on an older CLI.
- **KB-AP-2** Rewriting `backup.json` in place (truncate, then refill): `session-start-memory` reads it twice and a read between them meets a partial file.
- **KB-AP-3** An unguarded `json_field_file` under `set -e` in `session-start-memory`: a bad backup would end the hook before it prints the working memory.
- **KB-AP-4** Taking `json_field_file` for a typed read: it stringifies, so the number `42` and the string `"42"` read the same; use `json_string_field_file`.
- **KB-AP-5** Deleting a queue whose assistant row has not landed yet: capture-prompt and capture-turn run in parallel.
- **KB-AP-6** Reading the `Spawning claude -p` line as proof of the effort a run used: a value set in a settings file's `env` is outside the hook's reach.
- **KB-AP-7** Simulating a missing shell tool by subtracting it from `PATH` in a hook test: force a backend with a variable (`_HAS_JQ=false`).

## Overview

The memory queue (`.devflow/memory/.pending-turns.jsonl`) is drained by the detached `background-memory-update` worker, started by `memory-worker` (which owns the throttle, keyed on the `.working-memory-last-trigger` mtime, and the nohup spawn). The worker turns the queued turns into `WORKING-MEMORY.md` through a headless `claude -p` run that makes one Write. This KB also holds the pre-compact backup and the jq-less JSON fallback that every hook sources. The capture hooks that fill the queue are in the hub (`learning-capture-system`); the link and safe-create rules this pipeline follows are in `learning-capture-system-links`.

## Memory worker (background-memory-update)

`memory-worker` resolves `DEVFLOW_MANIFEST`, gates its spawn on it and passes the path as `$2` (`background-memory-update <CWD> [<manifest_path>]`; the worker re-checks after spawn and falls back to `$HOME/.devflow/manifest.json`). The model writes ONLY `WORKING-MEMORY.md.new`; `verify_and_swap()` assigns one outcome:

- `updated`: valid stamp and matching pre/post `cksum` gives an atomic `mv`, removes `.processing`, touches `.last-refresh-ok`.
- `conflict`: mismatch or failure, or a symbolic link that appeared on the working memory path during the run (D-HOOKS-NO-SYMLINK): the staged file is dropped, `.processing` kept with a heartbeat touch that extends the cold-path liveness window.
- `failed`: staged file missing, empty or unstamped, or `mv` failed: `.processing` left for cold-path recovery.

`cksum` must be on PATH or the worker exits; a `cksum` failure on the target forces `conflict`.

**Model, effort and argv (D-MEMORY-WORKER-LEAN).** The worker opens a headless session to make one Write, so the session is cut to what that Write needs.

- **Model and effort.** `agents.memory.model` and `agents.memory.effort` in `$HOME/.devflow/agent-models.json` (set with `devflow agents`; the shipped row is `WORKER_AGENTS.memory`) decide the run. Each is read with `json_string_field_file` (only a JSON string counts) and checked on its own, so a bad model keeps a good effort and the reverse. The model is `default`, an alias (`haiku sonnet opus fable`) or a `claude-` name of the `MODEL_NAME_RE` shape (`src/core/agent-frontmatter.ts`: a letter or digit, then letters, digits, `.`, `_` or `-`, within the length bound); the effort is `default` or a level (`low medium high xhigh max`). `inherit` and external models are outside both domains, since a worker has no session to inherit from. Only a value that passed its match reaches argv: an absent, empty or non-string value silently takes the shipped one, and a string that fails logs one line naming the field, never the value. The character sets are spelled out because a range such as `A-Za-z` collates by locale on bash 3.2. `tests/agent-models-worker.test.ts` holds the hook's literals equal to `agent-models.ts` (see the `external-model-routing` KB).
- **A CLI version probe picks the argv.** Before the lock is taken, `probe_claude_version` runs `claude --version` under `DEVFLOW_BG_VERSION_PROBE_SECS` (a default and a ceiling; background-and-kill like the watchdog, TERM to the process group, then KILL), so a hung probe cannot extend the lock's hold, and `claude_version_at_least` compares the first `X.Y.Z` in its output with `MEMORY_MIN_CLAUDE_VERSION` as base-10 numbers. At or above the floor the run takes the **lean** argv: `-p --model M --effort E --safe-mode --tools Write --disable-slash-commands --strict-mcp-config --mcp-config '{"mcpServers":{}}' --max-turns <cap> --dangerously-skip-permissions --output-format text` (pinned in `tests/eager-memory-refresh.test.ts`). Below it, or when the probe fails, hangs or prints no version, the **legacy** argv is `-p --model M --tools Write --dangerously-skip-permissions --output-format text`: no effort is applied, MCP servers stay loaded and there is no turn cap, because one flag an older CLI does not know fails every run. The `Spawning claude -p` log line names the model, the effort (or `no effort passed`) and the form.
- **What the lean flags buy.** `--safe-mode` turns off the user's instruction files, skills, plugins, hooks, MCP servers, custom commands and agents, while auth, model selection, built-in tools and settings `env` (the provider URL and key of a routed or keyed install) still apply. `--tools Write` leaves Write as the only tool. The turn cap is the worker's one Write and end of turn plus a margin; a run that hits the cap exits non-zero and its batch stays for the retry. `CLAUDE_CODE_EFFORT_LEVEL` is unset before the spawn on both forms, because an inherited value beats `--effort`; `DEVFLOW_BG_UPDATER=1` (the capture hooks' recursion guard), `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` stay set on both. The measurements and the re-verification recipe are in `docs/reference/platform-assumptions.md`.
- **The prompt carries everything, uncut.** The model cannot Read, so the existing working memory (capped at `MEMORY_READ_LIMIT`) and the newest queue rows (`MAX_TURNS` turns, `MAX_LINES` rows) arrive in the prompt. There is no byte cap on the turns block: the queue holds every turn whole by design, so the bound is the row-count window and the memory cap, never a cut turn.
- **Stale-staged precondition (SKIP).** After the lock the worker removes a leftover `WORKING-MEMORY.md.new` and then checks that nothing still stands at the path (`-e` or `-L`, so a link counts). If something does (a directory, say), it logs `SKIP: … could not be removed` and exits 0 before claiming the queue: no LLM run, the batch and the queue untouched, the lock released by the EXIT trap. Write refuses an existing file that has not been read, and a Write-only model cannot read one, so Write-only is safe only because the path is empty and the one Write is always a create. An earlier Write-only worker failed silently this way: every Write errored while the run exited 0.

**Link refusals (D-HOOKS-NO-SYMLINK).** `memory-worker` checks the throttle stamp's path first: a link on it gets no stamp and no spawned worker (`SKIP`, logged). `background-memory-update` checks the lock, queue, batch, `.last-refresh-ok` and `WORKING-MEMORY.md` paths together before it takes the lock or starts an LLM run, and skips the whole run when any has a link on its path; the existing working memory then reaches the prompt only through `df_file_below`, and `verify_and_swap` refuses the swap (`conflict`, above) when a link has appeared on the working memory's path since the run began, because `mv` would move the staged file into the folder the link names. The post-run stamps are checked again the same way just before each `touch`, which follows a link: `.last-refresh-ok` (on `updated`) and the batch's heartbeat (on `conflict`) are touched only where `df_no_symlink_below` still admits the path, since the LLM run can take minutes and a link can appear on either path meanwhile; a refused stamp is skipped and logged.

**Leftover batch.** A leftover `.pending-turns.processing` (a crashed run's batch) takes the waiting queue merged into it and, over the queue's line bound, is trimmed to the newest rows through a copy created by the safe-create rules of the links KB (a planted entry, a link to a FIFO or a device included, is removed and never opened; the batch is then left untrimmed and the log says `Processing overflow: not truncated`) and renamed over it, so the batch stays 0600 like the queue: the session-start cold path moves a stale batch back into the queue, which would otherwise carry the copy's wider mode.

**D-QUEUE-NO-ORPHAN-DELETE.** Claude Code runs one event's hooks in PARALLEL, so the worker can start after `capture-prompt` appended the user row and before `capture-turn` appends the assistant row. A queue with no `assistant`/`qa` row exits with no LLM run and is LEFT in place; the next run takes the whole turn. `compute_commits_since_note()` yields five exact outcome literals that are a test contract (no-stamp full-synthesis, invalid-SHA-format, SHA-not-ancestor-of-HEAD, none-current-as-of-HEAD, `N commit(s)… (showing newest …)`, with subjects cut by `%.100s`). The four untrusted data blocks are wrapped in named XML tags under a DATA-not-instructions preamble, and the prompt goes by heredoc stdin, never argv. `is_hex_sha <value> [min=7] [max=40]` is sourced with no forks (pre-compact uses 40-40); `pre-compact-memory` bootstraps `WORKING-MEMORY.md` only for a full SHA, labelling a detached HEAD `(detached)`, and only where nothing stands: builtin tests come first and `noclobber` makes the create exclusive, while a link there is logged (`Working memory not bootstrapped: <path> is a symbolic link`) and left alone; `session-start-memory`'s `detect_refresh_failing()` counts both `.pending-turns.jsonl` and `.pending-turns.processing`, each through `df_file_below` (a linked one counts as absent), and its cold path moves a stale batch back into the queue only where `df_no_symlink_below` admits the batch and the queue path.

## The pre-compact backup (D-BACKUP-RENAME)

`pre-compact-memory` writes `.devflow/memory/backup.json` (timestamp, branch, status, log, diff stat and a snapshot of `WORKING-MEMORY.md`) whole into `backup.json.tmp.<pid>` and renames it over the old backup; it never truncates and refills the file in place, because `session-start-memory` reads the backup twice and a read landing between the truncate and the refill would meet a partial file. A rename hands every read the previous backup or the new one.

- **Checked before it is written (D-HOOKS-NO-SYMLINK).** The hook ends, logged, when `.devflow` or `.devflow/memory` is a link: no backup and no working memory are written. The snapshot of `WORKING-MEMORY.md` is read through `df_file_below`, so a linked working memory is absent and never enters the backup the next session injects. The rename's target is checked first, because `mv` moves the copy into the folder a link at `backup.json` names: a link there, to anything, skips the backup (`Backup not written: a symbolic link sits on the path to <backup.json>`) and the `WORKING-MEMORY.md` bootstrap below it still runs.
- **Created safely.** The copy is made only where nothing stands at its name: builtin tests (`[ ! -e ]`, `[ ! -L ]`) come first, so an entry already there, a link to a FIFO or a device included, is never opened (`noclobber` alone would open one, since no regular file stands there), and the create runs in a subshell under `umask 077` and `set -o noclobber`, so neither setting reaches the rest of the hook and the create itself is exclusive. The write never goes through a link and never reuses a pre-existing 0644 file. The rename gives `backup.json` the copy's inode and mode, so the backup, which holds the working memory, is 0600 whatever the caller's umask.
- **A failed write keeps the old backup.** A write or rename that fails logs `Backup not written; the previous one is kept`, removes whatever holds the copy's name and carries on, so the `WORKING-MEMORY.md` bootstrap below it still runs.
- **Leftover copies expire.** A run killed between creating its copy and renaming it (the hook's timeout) leaves the copy under its own PID, a name no later run writes. Each run first deletes the regular files named `backup.json.tmp.*` in the memory directory that are over an hour old (`find -maxdepth 1 -type f -mmin +60`); a write ends within the hook's timeout, so no live run's copy is that old and a concurrent run's copy survives.
- **The reader treats a bad backup as no backup.** `session-start-memory` reads `memory_snapshot` first, then `timestamp`. Under `set -e` a failed `json_field_file` would end the hook before it prints the working memory built above, so the first read is guarded (`|| BACKUP_MEMORY=""`): a backup that does not parse reads as no snapshot, like an absent one, and whatever jq printed before it failed is discarded. The `timestamp` read runs only once the first has parsed the whole file, so it needs no guard. A backup, working memory or batch that a link leads to reads as absent, through `df_file_below`.

## Generic ops (the hooks' jq-less fallback)

`hooks/json-parse` is the JSON seam the shell hooks source: each wrapper runs `jq` when it is installed and otherwise one generic op of `json-helper.cjs` on `node`, and with neither tool `_JSON_AVAILABLE` is false, the flag a hook checks after sourcing before it calls a wrapper. The generic ops load no learning module and send no heartbeat. They are exactly `get-field` (behind `json_field` and `json_field_file`), `get-string-field` (behind `json_string_field_file`), `extract-cwd-field` (`json_extract_cwd_field`, and `json_extract_cwd_prompt` over it), `session-output <context> [message]` (`json_session_output "$ctx" ["$msg"]`; with one argument or an empty message the envelope is the plain one, and a message becomes the top-level `systemMessage`, alone when the context is empty, D-SYSTEMMESSAGE-ENVELOPE), `prompt-output` (`json_prompt_output`) and `backup-construct` (`json_backup_construct`).

- **Silent where jq is.** Where a jq path discards stderr (`json_field`, `json_field_file`, `json_string_field_file`, `json_extract_cwd_field`), its node fallback does too, so input that cannot be parsed fails silently on either backend, with a failing status. `json_field_file` redirects stderr BEFORE stdin (`2>/dev/null < "$file"`), so the shell's own error for a file it cannot open is discarded as well. The three envelope wrappers (`json_session_output`, `json_prompt_output`, `json_backup_construct`) keep stderr on both backends.
- **Failure is a status, not a message.** An unparseable or missing file gives a failing status and no message, so a caller that must survive it, or must not trust partial output (jq prints each value it parsed before the one that failed), checks the status. A `set -e` hook guards the call (`session-start-memory` does for its backup read).
- **Files arrive on stdin.** No op takes a path, so `json_field_file` feeds its file on stdin to `get-field`, and `json_string_field_file` feeds its file to `get-string-field`.
- **`json_string_field_file` is the typed read.** `json_field_file` stringifies, so the number `42` and the string `"42"` read the same; the typed read prints a field only when it is a JSON string, byte-exact with no newline added, and nothing for any other type (number, boolean, object, array, null), an absent field, or a string holding a NUL (no shell variable can carry one). The jq path selects `type == "string"`; the node path is the `get-string-field` op, so both backends agree. A caller that must see a trailing newline appends a sentinel before the substitution strips it: `v=$(json_string_field_file "$f" k; printf x); v=${v%x}`.
- **`backup-construct` reads `--arg name value` pairs only** (`ts`, `branch`, `status`, `log`, `diff`, `memory`), the shape `pre-compact-memory` passes.

## Anti-Patterns

- **KB-AP-1, widening the worker**: Write-only is safe only because the staged path is empty before the run, so give the model Read or leave the path occupied and every Write can fail while the run exits 0. `--allowedTools` only pre-approves and leaves every tool, listing and MCP server loaded. A flag an older CLI does not know fails every run, so the lean flags ride only on the argv the probe admits.
- **KB-AP-2, in-place backup rewrite**: write a complete copy and rename it.

## Gotchas

- **KB-INV-2**: a CAS conflict heartbeat-touches `.processing`; removing that touch lets the cold path reclaim a live retry batch after its liveness window.
- **`is_hex_sha` bounds are call-site specific**; the `json_extract_cwd_field` SOH delimiter must be `\x01` in both the jq and node paths; a detached HEAD bootstraps with the `(detached)` label.
- **KB-AP-6: the worker's effort has one blind spot.** The hook unsets an inherited `CLAUDE_CODE_EFFORT_LEVEL`, but a value set in a settings file's `env` is outside its reach and was not measured, so a run's effort can then differ from the one its `Spawning claude -p` log line names.
- **A failed or version-less probe is the legacy argv, not an error.** A hung, failing or `X.Y.Z`-less `claude --version` is logged and the run goes without effort, with MCP servers loaded and no turn cap, which brings the worker's old token cost back; the `Spawning claude -p` line states which argv ran.
- **KB-AP-7: simulating a missing shell tool in a hook test.** Force a backend with a variable (`_HAS_JQ=false`) instead.

## Key Files

| File | Purpose |
|------|---------|
| `src/assets/scripts/hooks/memory-worker` · `background-memory-update` | Throttle and spawn; the worker: probe, `agents.memory`, argv, `verify_and_swap` |
| `src/assets/scripts/hooks/pre-compact-memory` · `session-start-memory` · `is-hex-sha` | `pre-compact-memory` writes `backup.json` by rename and bootstraps the working memory; `session-start-memory` reads it |
| `src/assets/scripts/hooks/json-parse` · `json-helper.cjs` | jq-first JSON wrappers (`json_field_file`, the typed `json_string_field_file`, …) and the generic ops behind their node fallbacks |
| `src/core/agent-models.ts` | `WORKER_AGENTS.memory`, the model and effort the memory worker falls back to; `devflow agents` writes the `agents.memory` entry the worker reads |
| `src/cli/commands/memory.ts` | Memory toggle; converges Stop, SessionStart and PreCompact hooks |
| `tests/eager-memory-refresh.test.ts` · `tests/queue-append.test.ts` · `tests/shell-hooks.test.ts` | The lean and legacy argv, the backup rename arms, the batch trim keeping 0600, the json-parse fallbacks' silence |
| `tests/agent-models-worker.test.ts` | The worker's hook literals held equal to `WORKER_AGENTS` and the worker domain |
| `docs/reference/platform-assumptions.md` | The lean flags' measurements and the re-verification recipe |

## Related

- `.devflow/features/learning-capture-system/KNOWLEDGE.md`: the hub: the capture hooks that fill the memory queue, the feature switches and hook ownership.
- `.devflow/features/learning-capture-system-links/KNOWLEDGE.md`: the helpers (`df_no_symlink_below`, `df_file_below`) and the safe-create and mode rules this pipeline applies.
- `.devflow/features/learning-capture-system-store/KNOWLEDGE.md`: `json-helper.cjs` and the learning ops that share the file with the generic ops.
- `.devflow/features/external-model-routing/KNOWLEDGE.md`: the `agents.memory` entry's shape and worker domain, and the `devflow agents` writer.
- `docs/reference/hooks.md`: the Working Memory pipeline.

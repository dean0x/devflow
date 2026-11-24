---
feature: curation-capture-system-memory-backup-json
name: Pre-compact backup and jq-less JSON fallback
description: "Use when changing pre-compact-memory, backup.json, the first-note bootstrap, hooks/json-parse or the json-helper.cjs generic ops; not the worker. Keywords: backup.json, json-parse, jq-less."
category: component-patterns
directories:
  - src/assets/scripts/hooks/pre-compact-memory
  - src/assets/scripts/hooks/session-start-memory
  - src/assets/scripts/hooks/json-parse
  - src/assets/scripts/hooks/json-helper.cjs
created: 2026-11-23
updated: 2026-11-23
---

# Pre-compact Backup and jq-less JSON Fallback

## Rules

- **KB-INV-1** `pre-compact-memory` writes `backup.json` whole into `backup.json.tmp.<pid>` and renames it over the old one; a bad backup reads as no backup (the guarded first read in `session-start-memory`).
- **KB-INV-2** `hooks/json-parse` wrappers run `jq` when installed and otherwise one generic op on `node`; with neither, `_JSON_AVAILABLE` is false and a hook checks it after sourcing; no op takes a path, files arrive on stdin.
- **KB-INV-3** A node fallback is silent on stderr exactly where its jq path is; failure is a status, not a message, so a caller that must survive it checks the status.
- **KB-INV-4** The backup hook writes nothing when `.devflow` or `.devflow/memory` is a link, never follows a link at `backup.json`, reads the working memory through `df_file_below`, and makes the backup 0600 whatever the caller's umask.
- **KB-INV-5** `json_string_field_file` is the typed read: it prints a field only when it is a JSON string, byte-exact, and nothing for any other type, an absent field or a string with a NUL; both backends agree.
- **KB-INV-6** The SOH delimiter of `json_extract_cwd_field` and `extract-cwd-sid-field` is the byte `\x01` in both the jq path and the node path.
- **KB-AP-1** Rewriting `backup.json` in place (truncate, then refill): `session-start-memory` reads it twice and a read between them meets a partial file.
- **KB-AP-2** An unguarded `json_field_file` under `set -e` in `session-start-memory`: a bad backup would end the hook before it prints the working memory.
- **KB-AP-3** Taking `json_field_file` for a typed read: it stringifies, so the number `42` and the string `"42"` read the same; use `json_string_field_file`.
- **KB-AP-4** Faking a missing JSON parser in a hook-script test by dropping it from `PATH` (a bare `/bin` brings `jq` back on Linux) or exporting `_HAS_JQ=false` (`json-parse` re-detects on every source): use an additive `buildToolFarm` PATH, no trailing `/bin`, and assert `resolveOnPath('jq'|'node')`; a variable works only after a test sources `json-parse` itself.

## Overview

`pre-compact-memory` saves a backup of the working state before a context compaction, and `session-start-memory` reads it back in the next session. Every shell hook that parses JSON sources `hooks/json-parse`, which uses `jq` when it is installed and a generic op of `json-helper.cjs` on `node` when it is not. This KB holds those two pieces. The memory worker that builds `WORKING-MEMORY.md`, its note format and its argv are in the sibling KB named in Related.

## The pre-compact backup (D-BACKUP-RENAME)

`pre-compact-memory` writes `.devflow/memory/backup.json` (timestamp, branch, status, log, diff stat and a snapshot of `WORKING-MEMORY.md`) whole into `backup.json.tmp.<pid>` and renames it over the old backup, so every read meets the previous backup or the new one; it never truncates and refills in place, because `session-start-memory` reads the backup twice and a read between the truncate and the refill would meet a partial file.

- **Checked before it is written (D-HOOKS-NO-SYMLINK).** The hook ends, logged, when `.devflow` or `.devflow/memory` is a link: no backup and no working memory are written. The snapshot of `WORKING-MEMORY.md` is read through `df_file_below`, so a linked working memory never enters the backup the next session injects. The rename's target is checked first, because `mv` moves the copy into the folder a link at `backup.json` names: a link there skips the backup (`Backup not written: a symbolic link sits on the path to <backup.json>`) and the `WORKING-MEMORY.md` bootstrap below it still runs.
- **Created safely** under the exclusive-create and 0600 rules of the links KB: builtin tests (`[ ! -e ]`, `[ ! -L ]`) first, then a subshell under `umask 077` and `set -o noclobber`. The rename gives `backup.json` the copy's inode and mode, so the backup, which holds the working memory, is 0600 whatever the caller's umask.
- **A failed write keeps the old backup.** A write or rename that fails logs `Backup not written; the previous one is kept`, removes whatever holds the copy's name and goes on to the bootstrap.
- **Leftover copies expire.** A run killed between creating its copy and renaming it (the hook's timeout) leaves the copy under its own PID, a name no later run writes. Each run first deletes the regular files named `backup.json.tmp.*` in the memory directory over an hour old (`find -maxdepth 1 -type f -mmin +60`); a write ends within the hook's timeout, so a concurrent run's copy survives.
- **The reader treats a bad backup as no backup.** `session-start-memory` reads `memory_snapshot` first, then `timestamp`. Under `set -e` a failed `json_field_file` would end the hook before it prints the working memory built above, so the first read is guarded (`|| BACKUP_MEMORY=""`): a backup that does not parse reads as no snapshot, like an absent one, and whatever jq printed before it failed is discarded. The `timestamp` read runs only once the first has parsed the whole file, so it needs no guard.

**The first-note bootstrap and the note read.** `pre-compact-memory` bootstraps `WORKING-MEMORY.md` only for a full SHA (`is_hex_sha` with 40 to 40), labelling a detached HEAD `(detached)`, as a `memory_stamp_line` stamp, `## Now` and `## Progress` only, mode 0600, and only where nothing stands (the backup's builtin-test and `noclobber` create; a link there is logged as `Working memory not bootstrapped: <path> is a symbolic link` and left alone). `session-start-memory` reads the note once through `read_bounded_memory_note` (one more byte than the cap, a null byte refused) and takes the stamp through `memory_stamp_parse`, so a field that fails its format reads empty. The note format, cap and stamp rules are in the worker KB.

## Generic ops (the hooks' jq-less fallback)

`hooks/json-parse` is the JSON seam the shell hooks source: each wrapper runs `jq` when it is installed and otherwise one generic op of `json-helper.cjs` on `node`, and with neither tool `_JSON_AVAILABLE` is false, which a hook checks after sourcing. The generic ops load no curation module and send no heartbeat. They are the eight behind the wrappers, and `tracked-area`, which no wrapper uses (the shell gates call it on `node` directly; see the store KB). The eight are `get-field` (behind `json_field` and `json_field_file`), `get-string-field` (behind `json_string_field_file`), `array-length` (behind `json_array_length_file`: the element count of an array field as digits, the word `unknown` for an absent field or any other type, and no output with a failing status for a file that cannot be read or parsed), `extract-cwd-field` (`json_extract_cwd_field`, and `json_extract_cwd_prompt` over it), `extract-cwd-sid-field <field>` (`json_extract_cwd_sid_field`: `cwd`, a session ID that passed the session ID rule of the worker KB (`curation-capture-system-memory-worker` KB-INV-27) or empty, and the field, split by two SOH bytes at the first two only; a `cwd` holding a NUL or SOH fails the call), `session-output <context> [message]` (`json_session_output "$ctx" ["$msg"]`; with one argument or an empty message the envelope is the plain one, and a message becomes the top-level `systemMessage`, alone when the context is empty, D-SYSTEMMESSAGE-ENVELOPE), `prompt-output` (`json_prompt_output`) and `backup-construct` (`json_backup_construct`).

- **Silent where jq is; failure is a status, not a message.** Where a jq path discards stderr (`json_field`, `json_field_file`, `json_string_field_file`, `json_array_length_file`, `json_extract_cwd_field`), its node fallback does too; a caller that must survive an unparseable file, or must not trust partial output (jq prints each value it parsed before the one that failed), checks the status, and a `set -e` hook guards the call. `json_field_file` redirects stderr BEFORE stdin (`2>/dev/null < "$file"`), so the shell's own error for a file it cannot open is discarded too. The three envelope wrappers keep stderr on both backends.
- **`json_string_field_file` is the typed read.** It prints a field only when it is a JSON string, byte-exact with no newline added, and nothing for any other type (number, boolean, object, array, null), an absent field, or a string holding a NUL (no shell variable can carry one). The jq path selects `type == "string"` and the node path is `get-string-field`, so both backends agree. A caller that must see a trailing newline appends a sentinel before the substitution strips it: `v=$(json_string_field_file "$f" k; printf x); v=${v%x}`.
- **`backup-construct` reads `--arg name value` pairs only** (`ts`, `branch`, `status`, `log`, `diff`, `memory`), the shape `pre-compact-memory` passes.

## Anti-Patterns

- **KB-AP-1, KB-AP-2: the backup read and write.** The write is a rename and the first read is guarded, so a partial or bad backup is never seen as a half-read one. A backup that cannot be read is an absent backup, and the session still gets its working memory.
- **KB-AP-3: a stringified read.** `json_field_file` is right for a field whose type does not matter. A field whose type matters (a version, a flag stored as a string) goes through `json_string_field_file`, which refuses any other type on both backends.
- **KB-AP-4: a fake missing parser.** A test that wants the no-`jq` path builds a PATH of links to the tools it needs and leaves out `jq`; it then asserts that `jq` and `node` resolve or fail to resolve as the test means. A variable set before the test sources `json-parse` is overwritten at once, because the file detects the tools again on every source.

## Gotchas

- **KB-INV-6: the SOH delimiter.** The `json_extract_cwd_field` delimiter must be `\x01` in both the jq and the node path, or the two backends split the same input in two ways.
- **KB-INV-3: a silent fallback hides a failed read.** The node fallback prints nothing on a bad file, as the jq path does, so only the exit status tells a caller that a read failed.

## Key Files

| File | Purpose |
|------|---------|
| `src/assets/scripts/hooks/pre-compact-memory` | Writes `backup.json` by rename, expires leftover copies and bootstraps the working memory |
| `src/assets/scripts/hooks/session-start-memory` | Reads the backup twice (the guarded snapshot read, then the timestamp) |
| `src/assets/scripts/hooks/json-parse` · `json-helper.cjs` | jq-first JSON wrappers (`json_field_file`, the typed `json_string_field_file`, `json_array_length_file`, ...) and the generic ops behind their node fallbacks |
| `tests/shell-hooks.test.ts` · `tests/eager-memory-refresh.test.ts` | The backup rename arms, the json-parse fallbacks' silence, `buildToolFarm` |

## Related

- `.devflow/features/curation-capture-system-memory-worker/KNOWLEDGE.md`: the memory worker, the note format and stamp, the session pairing, the staged-file limit and the `claude -p` argv.
- `.devflow/features/curation-capture-system/KNOWLEDGE.md`: the hub: the capture hooks and the feature switches.
- `.devflow/features/curation-capture-system-links/KNOWLEDGE.md`: the helpers (`df_no_symlink_below`, `df_file_below`) and the safe-create and mode rules the backup applies.
- `.devflow/features/curation-capture-system-store/KNOWLEDGE.md`: `json-helper.cjs` and the curation ops that share the file with the generic ops.

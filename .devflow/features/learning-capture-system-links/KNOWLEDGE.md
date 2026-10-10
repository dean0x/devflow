---
feature: learning-capture-system-links
name: Symbolic-link and safe-create rules under .devflow
description: "Use when a hook, store writer, CLI command, root .gitignore write or HUD read touches .devflow files, or a queue, batch or backup is created or trimmed. Keywords: symlink, df_no_symlink_below, noclobber."
category: conventions
directories:
  - src/assets/scripts/hooks
  - src/core/linked-path.ts
  - src/core/queue-drain.ts
  - src/targets/claude-code/post-install.ts
  - src/hud/components/learning-counts.ts
created: 2026-10-10
updated: 2026-10-10
---

# Symbolic-Link and Safe-Create Rules Under .devflow

## Rules

- **KB-INV-1** A hook writes or renames under a project's `.devflow/`, and reads a file there into the session, a backup, a prompt or an agent directive, only where no link sits on the way down from the project root: `df_no_symlink_below` for writes and renames, `df_file_below` for reads.
- **KB-INV-2** The hook helpers check the path below the root, never the root or the folders above it, because a parent may legitimately be a link (macOS `/tmp` and `/var` lead into `/private`).
- **KB-INV-3** `df_no_symlink_below` and `df_file_below` are predicates, called in an `if` or `||`, never as a plain statement under `set -e`; `df_no_symlink_below` answers 1 for any call it cannot vouch for.
- **KB-INV-4** `withDecisionsLock` refuses every store writer, before taking the lock, when `.devflow` or `.devflow/learning` is a link (`not-a-directory`); the claim heartbeat leaves a claim in such a tree alone.
- **KB-INV-5** `readJsonl` reads a learning file that is itself a link as missing (`readTextUnlinked`: lstat, then `O_NOFOLLOW`); only the file is checked, not the folders above it.
- **KB-INV-6** The CLI writes or deletes under `.devflow/` only past `firstSymbolicLink`, and uninstall's legacy local removal passes each target through `legacyLocalChangeGuard`; a refused drain deletes nothing and the switch it follows stays as set.
- **KB-INV-7** A linked root `.gitignore` is written only when its resolved target lies inside the project and outside any `.git` folder in it (any letter case); the shell `_erg_resolve_inside` and the TS `resolveGitignoreTarget` must refuse the same layouts and write the same bytes.
- **KB-INV-8** The HUD reads the ledger only through `readBoundedLedger`: a regular file by lstat, opened with `O_NOFOLLOW | O_NONBLOCK`, re-checked by fstat, read to at most `LEDGER_MAX_BYTES`.
- **KB-INV-9** A create the hooks make by name under `.devflow/` first tests with builtins that nothing stands at the path (`[ ! -e ]`, `[ ! -L ]`), and `noclobber` is the second line that makes the create exclusive.
- **KB-INV-10** A 0600 queue, batch or backup stays 0600: its replacement copy is created under `umask 077` and renamed over it.
- **KB-INV-11** A file sourced by a `set -e` hook ends each helper in an explicit `return 0` or a command that cannot fail, and a create that `noclobber` may refuse ends in `|| true`.
- **KB-AP-1** A write, rename or read under a project's `.devflow/` that skips its link check: a hook without the helper, a CLI write without `firstSymbolicLink`, a store read around `readJsonl`, a learning writer around `withDecisionsLock`.
- **KB-AP-2** Widening the hook helpers to the project root or the folders above it: a project reached through a linked parent would stop capturing.
- **KB-AP-3** Adding folder checks to the read-only paths: reads through a linked folder are by design (only the writers refuse the folder).
- **KB-AP-4** Treating `noclobber` as a link check: it still opens a link to a device or FIFO.
- **KB-AP-5** Trimming or rewriting a 0600 file through a copy made under the caller's umask, or fixing the mode with a `chmod` after the `mv`.
- **KB-AP-6** Reading the ledger in the HUD unbounded: it runs on every prompt, and a ledger linked to `/dev/zero` would hang it.
- **KB-AP-7** Assuming a missing capture is always a link: an unvouchable call (wrong root, empty, `.` or `..` part, too many parts) logs the same line.
- **KB-AP-8** Comparing the gitignore twins by has-line booleans: parity is byte equality of the whole sandbox, links included.

## Overview

A repository can commit a symbolic link anywhere in its own `.devflow/`, and the shell's `>>`, `touch`, `mkdir -p`, `mv`, `head`, `sed`, `read` and `jq` follow one, as Node's file calls do. A linked queue would carry captured conversation text out of the project; a linked working memory, backup, decisions file or ledger would bring a file from elsewhere on the machine into the session, a prompt, a backup or a render, with no one choosing to read it; a linked folder would take a lock, a rewrite or a delete to wherever it points. So the hooks, the learning store, the CLI and the HUD each refuse by their own helper, and none writes or renames through a link under `.devflow/`, while the hooks read nothing through one into the session, a backup, a prompt or an agent directive.

Three kinds of read do follow a link: the hooks' bounded pre-reads of `project.json` and `config.json`, which only decide whether to run the settings resolver (which refuses a linked file); the store's and the HUD's reads, which check the file itself and not the folders above it; and an agent's Read of `index.md`, `decisions.md` or `pitfalls.md`. Someone who deliberately links `.devflow`, or its `memory` or `learning` folder, gets no capture there.

## The surfaces and their helpers

- **D-HOOKS-NO-SYMLINK (hooks).** A refused write or rename is skipped and a refused read is treated as an absent file; each is logged once through the caller's `log()` and the hook carries on. The hooks that apply it are the three capture hooks (through `queue-append`), `ensure-devflow-init`, `session-start-context`, `session-start-memory`, `pre-compact-memory`, `memory-worker` and `background-memory-update`. `hooks/git-marker` holds the helpers, builtins only (`[ -L ]` and parameter expansion, zero forks): `df_no_symlink_below <root> <path>...` answers 0 when no path, and no folder between `<root>` and it, is a link, and 1 for a link and for any call it cannot vouch for (no path, an empty root, a path not below the root, an empty, `.` or `..` part, more than the part bound, a literal in `git-marker`); `df_file_below <root> <path>` answers 0 only for a regular file the first admits and logs the refusal (`[ -f ]` follows a link, so a dangling link or a link to a folder reads as absent with nothing logged). The root and the folders above it are deliberately not checked: the root is where the session runs or where git keeps the ledger, the user's choice and not the repository's. The check runs just before the use, so a link swapped in between is not stopped; that process already runs as the user.
- **D-NO-LINKED-TREE (store writers).** `withDecisionsLock` refuses, changing nothing and before it takes the lock, when `<root>/.devflow` or `<root>/.devflow/learning` is a link: error kind `not-a-directory`, message `<op>: <folder> is a symbolic link, not a directory; nothing was changed`, exit 1 with empty stdout from `json-helper`. Every writer is refused in that one place (the puts, assign, refresh, retire, restore, rotate, claim-due, claim-queue, release-claim, `render`, `--clear`, `--reset`), and the claim heartbeat leaves a claim in such a tree alone (`touchClaim` answers `touched: false`). `linkedLearningFolder` lstat-checks the two folders and `linkedFolder` builds the refusal; `resetLearning` carries no check of its own.
- **D-NO-LINKED-READ (store reads).** `readJsonl` reads a learning file that is itself a link as missing: `readTextUnlinked` lstats it, then opens with `O_NOFOLLOW`, so a link swapped in after the lstat fails the open instead of being read. A linked log, ledger, archive or history file is therefore invisible to `list`, `show`, `--status` and every writer's own read, so no rewrite, quarantine or render copies its lines into the project, and `ensurePreV2Backup` skips a linked source.
- **D-CLI-NO-SYMLINK (CLI).** `firstSymbolicLink(paths)` in `src/core/linked-path.ts` lstats each path, returns the first link, and rethrows any lstat failure other than ENOENT or ENOTDIR, so a caller that cannot check acts on nothing. The CLI writes or deletes under `.devflow/` only past it: `devflow init` (the carve-out marker, the legacy markers and `config.json` through `writeManagedConfig`, whose temp copy is created with `wx` and removed again when a later step fails), `devflow learning --configure` (the project `learning.json`) and every queue drain: `drainLearningQueue` and `drainMemoryQueue` share `drainQueueFiles` in `src/core/queue-drain.ts`, and `devflow memory --clear` checks each project in `cleanQueueFiles`. A drain that meets a link deletes nothing and answers `{drained: false, linkedFolder}` (`cleanQueueFiles` lists the project in `refused`); `formatRefusedDrain` words the warning, which is all a refused drain adds: the switch the command turned off stays off. `devflow uninstall`, removing a legacy local install (a plain run adds that scope whenever the project's `.claude` holds devflow commands, agents or skills, which a repository can commit), passes each removal of that install and each settings rewrite under the project's `.claude` and `.devflow` through `legacyLocalChangeGuard` in `src/cli/commands/uninstall.ts` (the project-data step keeps its own check, D-UNINSTALL-CARVE-OUT), which checks the folder and every path below it down to the target, the target included: a refused target is skipped, the link is kept, one warning per link names it, and the rest of the install is still removed. The user scope passes no guard, since `~/.claude` and `~/.devflow` are the user's own.
- **D-GITIGNORE-LINK-INSIDE (root `.gitignore`).** The one file a hook writes outside `.devflow/`. A linked root `.gitignore` is written only when the file it resolves to lies inside the project and outside any `.git` folder in it, the project's own or a nested repository's: no part of its path below the root may be named `.git`, in any letter case (git refuses such a path too). Then that file is read and written directly, never through the link; otherwise nothing is read or written anywhere, no marker is stamped, and the skip is logged once by the hook or warned by `init`. A file in a `.git` is git's own hooks and config, not one of the repository's, and a line appended to a hook runs as a command. The letter case matters because a case-insensitive file system (macOS) opens `.git` for `.GIT`, and the link's spelling survives resolution: the shell's `cd -P` keeps it, and the TS twin's realpath corrects only the folders, never the file's own name. The link is followed one hop at a time, with a fixed hop bound (`GITIGNORE_LINK_HOPS` in the TS twin, a matching literal in the shell); a relative target is joined to the folder the link sits in without normalising `..`; only the last folder is resolved physically, so a missing file inside the project is created there. Shell: `_erg_resolve_inside` in `ensure-root-gitignore`. TS twin: `resolveGitignoreTarget` behind `ensureDevflowGitignore` in `src/targets/claude-code/post-install.ts`; a table test in `tests/shell-hooks.test.ts` builds each layout in two sandboxes, runs one twin on each and compares the whole sandbox, links included, so the twins must refuse the same layouts and write the same bytes to the same file.
- **D-HUD-LEDGER-BOUNDED (statusline).** The statusline reads the ledger on every prompt, so `readBoundedLedger` in `src/hud/components/learning-counts.ts` reads it only when lstat says it is a regular file, opens it with `O_NOFOLLOW | O_NONBLOCK`, re-checks with fstat and reads at most `LEDGER_MAX_BYTES` (real ledgers are far smaller). A link (to `/dev/zero`, say), a FIFO, any other non-regular file or a larger one shows no counts, as an absent ledger does.

## Safe creates and modes

- **Exclusive create.** `set -o noclobber` makes a `>` fail only when its target already exists as a regular file, so it stops a create over a planted regular file or a link to one but still opens a link whose target is a device or a FIFO: a FIFO waits for a reader that never comes, a device takes the text. So every create the hooks make by name under `noclobber` first tests with builtins that nothing stands there (`[ ! -e ]` and `[ ! -L ]`), and `noclobber` is the second line, making the create itself exclusive. The sites: the trimmed queue and batch copies, the backup copy, the legacy `.gitignore` copy, the carve-out marker and the working-memory bootstrap. A new create under `.devflow/` checks its path with `df_no_symlink_below`, tests that nothing stands at its name, and keeps `noclobber` as the second line, never the only one.
- **Mode 0600.** A hook inherits its parent's umask (typically 022). The rename gives the file the copy's inode and mode, so trimming or rewriting a 0600 queue, batch or backup through a copy made under that umask turns it 0644, and a `chmod` after the `mv` leaves a window. So the copy is created under `umask 077`, in a subshell with `noclobber` where the create must also be exclusive, so neither setting reaches the rest of the hook.
- **Queue overflow trim.** When a queue exceeds its line bound, `queue-append` keeps the newest rows under `learning_lock_acquire "<queue>.lock"`. The copy is created by the two rules above; where something already stands at its name (a planted entry, a link to a FIFO or a device included) it is removed and never opened, the trim fails, `Queue overflow: not truncated, its copy could not be written` is logged and the trim waits for a later append. A copy that lands is renamed over the queue. The memory worker applies the same rule to a leftover batch (see the memory-worker KB).
- **Created-by-name sites that skip on a link.** `queue_append_row` (`Queue skipped: a symbolic link sits on the path to <queue>; nothing written`, return 0), `pre-compact-memory` (backup and bootstrap), `ensure-root-gitignore` (marker, legacy copy), `background-memory-update` (lock, queue, batch, stamps).
- **`set -e` discipline.** `ensure-root-gitignore`, reached through `ensure-devflow-init`, is sourced by the capture hooks, `memory-worker` and `pre-compact-memory`, all running under `set -e`. A function call is a fresh simple command that returns its last status, so a helper that ends on a failed test kills the hook with no message, and a background hook's death is invisible. A helper therefore ends in an explicit `return 0` or in a command that cannot fail; the link predicates are the deliberate exception, called only inside an `if` or an `||`; and a create that `noclobber` may refuse ends in `|| true` (the carve-out marker). Pin each path with a test that sources the file under `set -e` and asserts the caller keeps running.

## Anti-Patterns

- **KB-AP-1, a missing link check**: a committed link then carries conversation text out of the project, or a foreign file into the session, a prompt or a render. The surfaces and their helpers are listed under The surfaces and their helpers; a new site uses the one for its layer.
- **KB-AP-2, widening the helpers**: never extend `df_no_symlink_below` or `df_file_below` to the project root or the folders above it. A project reached through a linked parent (macOS `/tmp`, `/var`) would stop capturing.
- **KB-AP-5, a copy under the caller's umask**: see Safe creates and modes.
- **KB-AP-6, an unbounded HUD ledger read**: keep the lstat, `O_NOFOLLOW`, `O_NONBLOCK`, fstat and size cap of `readBoundedLedger`.

## Gotchas

- **KB-AP-4**: `noclobber` is not a link check (see Exclusive create).
- **A linked `.devflow`, or its `memory` or `learning` folder, gets no capture, on purpose.** `ensure-devflow-init` returns non-zero for a linked `.devflow` (the capture hooks then exit 0), `queue_append_row` skips a queue below a linked folder, the memory hooks skip the memory folder, and the learning ops refuse the learning tree (`claim-queue` included, so the Learning agent stops at Step 0 with the refusal on stderr). The hooks log each skip once under `~/.devflow/logs/<cwd-slug>/`; the ops answer on stderr.
- **KB-AP-3: reads through a linked folder are by design.** The read-only paths (`list`, `show`, `render --check`, `devflow learning --status|--list|--show`) and the HUD refuse a linked file (a linked log, ledger, archive or history file reads as missing, and a linked ledger shows no counts) but still read through a linked `.devflow` or `.devflow/learning` folder; only the writers refuse the folder. The hooks differ: they refuse a file below a linked folder as well.
- **KB-AP-7: `df_no_symlink_below` answers 1 for a call it cannot vouch for, and the log line then still names a link.** Each queue is checked against the root it lies below, memory against `$PROJECT_ROOT` and learning against `$LEDGER_ROOT`, which differ in a linked worktree. A queue handed the wrong root, or a path with an empty, `.` or `..` part or more than the part bound, is refused as "not below its root" with the same `Queue skipped: a symbolic link sits on the path to ...` line, so a capture that goes missing is not always a link.
- **KB-INV-11**: a helper that ends on a failed test under `set -e` kills the hook silently (see `set -e` discipline).

## Key Files

| File | Purpose |
|------|---------|
| `src/assets/scripts/hooks/git-marker` | `df_no_symlink_below` and `df_file_below` (D-HOOKS-NO-SYMLINK), plus the git-marker basics |
| `src/assets/scripts/hooks/queue-append` | Shared append: each queue path checked against its own root first, overflow trim |
| `src/assets/scripts/hooks/ensure-devflow-init` · `ensure-root-gitignore` | Scaffolding that refuses a linked `.devflow`; the carve-out and `_erg_resolve_inside` |
| `src/targets/claude-code/post-install.ts` | `resolveGitignoreTarget` behind `ensureDevflowGitignore` (the TS twin) |
| `src/assets/scripts/hooks/lib/learning-store.cjs` | `linkedLearningFolder`, `linkedFolder`, `readTextUnlinked`, `ensurePreV2Backup` |
| `src/core/linked-path.ts` · `src/core/queue-drain.ts` | `firstSymbolicLink`; `drainQueueFiles`, `QueueDrain`, `formatRefusedDrain` |
| `src/cli/commands/uninstall.ts` | `legacyLocalChangeGuard` |
| `src/hud/components/learning-counts.ts` | `readBoundedLedger`, `LEDGER_MAX_BYTES` |
| `tests/shell-hooks.test.ts` · `tests/queue-append.test.ts` | The link rules (the git-marker helpers, each hook's refusals, the gitignore twin table); queue trims keep 0600 |
| `tests/decisions/learning-store.test.ts` (linked tree and linked file suites) · `tests/decisions/cli-subcommands.test.ts` · `tests/core/linked-path.test.ts` · `tests/core/queue-drain.test.ts` · `tests/hud-learning-counts.test.ts` | The store, CLI and HUD link rules |

## Related

- `.devflow/features/learning-capture-system/KNOWLEDGE.md`: the hub: the capture hooks that call these helpers and the table of D-series names.
- `.devflow/features/learning-capture-system-store/KNOWLEDGE.md`: `withDecisionsLock`, `readJsonl` and the lock the writers share.
- `.devflow/features/learning-capture-system-memory-worker/KNOWLEDGE.md`: the memory pipeline's own link refusals and the backup's safe create.
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md`: the `git-marker` basics (`df_has_git_marker`, `df_is_project_root`); the link helpers beside them are recorded here.
- `.devflow/features/installer-shadowing/KNOWLEDGE.md`: managed config writes, queue drains at init, and the carve-out block and its TS twin, whose root `.gitignore` link rule is recorded here.
- `docs/reference/hooks.md`: the hooks' rule against writing through a symbolic link under `.devflow/` or reading through one into the session.

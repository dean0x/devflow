---
feature: installer-shadowing-init-artifacts
name: Gitignore Carve-out & CLAUDE.md Import Audit
description: "Use when changing DEVFLOW_GITIGNORE_BLOCK, computeDevflowGitignore, ensure-root-gitignore or init's CLAUDE.md import audit and stamp. Keywords: gitignore carve-out, claudeignore, audit stamp."
category: architecture
directories: [src/targets/claude-code/post-install.ts, src/assets/scripts/hooks/ensure-root-gitignore, src/assets/scripts/hooks/ensure-devflow-init, src/core/claude-md-audit.ts, src/core/fs-atomic.ts, src/cli/commands/init.ts]
created: 2026-10-10
updated: 2026-10-10
---

# Gitignore Carve-out & CLAUDE.md Import Audit

## Rules

- **KB-AP-1** `DEVFLOW_GITIGNORE_BLOCK` is never updated in only one of its two implementations: the TS `computeDevflowGitignore` and the shell `ensure-root-gitignore` must emit byte-identical output. Update both, plus the marker name in `ensure-devflow-init`, in the same commit.
- **KB-AP-2** `.claudeignore` (and every completion line) is never a block-presence sentinel: users author those lines themselves, so asserting presence through them gives false negatives. Only `!.devflow/conventions.md` (the v3 sentinel) detects the block.
- **KB-AP-3** Top-ups never append at the end of the file: gitignore is last-match-wins, so a late `!.devflow/project.json` would override a user's own later re-ignore. Missing lines are inserted inside the block, in block order.
- **KB-AP-4** The fast-path marker is project-local (`.devflow/.root-gitignore-configured-v6`), never under `~/.devflow/`: a global marker would mark every project configured after the first init.
- **KB-AP-5** Bumping the marker version means updating the marker in `post-install.ts`, `ensure-root-gitignore` and `ensure-devflow-init` together and adding the prior version to both legacy-marker removal lists (`LEGACY_GITIGNORE_MARKERS` / `_erg_drop_legacy_markers`).
- **KB-AP-6** `_erg_drop_legacy_markers` keeps its explicit `return 0`: every hook that sources it runs under `set -e`, and a shell function's own exit status (unlike an inlined loop's last statement) is not exempt, so without it the final false `[ -e ]` test kills the caller.
- **KB-AP-7** Never write the CLAUDE.md audit stamp without an owner-only `createMode` and without the `lstat` regular-file check: the stamp names the user's project paths, and the atomic writer renames over whatever sits at the target, a symbolic link included.
- **KB-AP-8** Never create the machine root for the audit stamp: `writeClaudeMdAuditStamp` refuses, writing nothing, when `~/.devflow` does not exist.
- **KB-INV-1** The block's completion lines, in order, are `!.devflow/policy.json`, `!.devflow/project.json`, `.claudeignore`; the block's last line stays `.claudeignore`.
- **KB-INV-2** The fast-path marker is a claim, not proof: even a marked install re-reads `.gitignore`, re-runs `computeDevflowGitignore` and writes only on a non-`null` result.
- **KB-INV-3** Legacy marker cleanup runs on every path, fast-path hit and on-success stamp alike, in both implementations.
- **KB-INV-4** A linked root `.gitignore` is written only when it resolves inside the project and outside any `.git` (any letter case); init creates the marker exclusively (`wx`) and writes or removes nothing under a `.devflow` or marker that is a symbolic link.
- **KB-INV-5** The audit step never changes init's exit code and is decided AFTER the install; the audit logic lives once in `claude-md-audit.cjs`, and the typed facade loads the package's own copy, never the installed `~/.devflow/scripts` one.
- **KB-INV-6** Uninstall classifies the audit stamp and its temp-prefix sibling as install artifacts, not user content.

## Overview

Two small init-time side artifacts share this KB because both are written by init (or a hook) outside the asset install and both are cleaned by uninstall as install artifacts or tracked paths: the Devflow-managed `.gitignore` carve-out that makes a repository's `.devflow/` local by default while sharing a few tracked paths, and the after-install note about CLAUDE.md `@path` imports that put a large file into every thread's always-loaded context.

## Devflow-managed `.gitignore` Carve-out (`D-GITIGNORE-V6`, `D-GITIGNORE-IN-BLOCK`)

`src/targets/claude-code/post-install.ts` exports `DEVFLOW_GITIGNORE_BLOCK` and `DEVFLOW_GITIGNORE_BLOCK_WITHOUT_CLAUDEIGNORE` (the exact block, with and without its final `.claudeignore` line) and `computeDevflowGitignore(existingContent)` (the new content, or `null` when no change is needed). Everything under `.devflow/` is ignored except the tracked paths: `features/` (`index.md` and every `{slug}/KNOWLEDGE.md`), `conventions.md`, `policy.json` and `project.json` (`DEVFLOW_TRACKED_PATHS`, exported from the same file, which uninstall's project-data step never deletes). The shell hook `src/assets/scripts/hooks/ensure-root-gitignore` must produce byte-identical output — a cross-parity table in `tests/shell-hooks.test.ts` asserts it, each row verifying the `changed` / `devflowSentinelPresent` / `claudeignoreLinePresent` booleans plus TS and shell idempotency. README.md quotes the block byte for byte. The carve-out version numbering is unrelated to any other feature's versions.

**Completion lines.** Three, in block order: `!.devflow/policy.json`, `!.devflow/project.json`, `.claudeignore`. The policy line re-includes the retired evidence-policy file — `resolve-evidence-policy.cjs` never parses it, but where `project.json` has no `evidence` its presence holds a repository at `required`, so a team's committed copy must stay shared (`D-POLICY-JSON-RETIRED`); the block comment calls it "retired; presence only". The project line shares the team settings file (Devflow never writes it). **Block-presence detection uses only the v3 sentinel** `!.devflow/conventions.md`. No completion line is a sentinel: each is a line a user may author, so each is topped up only when missing and never read as proof the block exists — `hasClaudeignoreEntry` (`.claudeignore` or `!.claudeignore`), `hasPolicyLine` and `hasProjectLine` are independent whole-trimmed-line booleans. `.claudeignore` is in the block because `installClaudeignore()` writes it unconditionally in a git repo, which left an untracked `??` entry in `git status` (a violation of prefix-shippability); gitignore has no effect on already-tracked files, so existing users are safe. The leak was caught by `tests/integration/clause-ii-file-residue.test.ts` (`test-harness` KB).

**Upgrade paths in `computeDevflowGitignore`:** `/.devflow/` present (user opt-out) → no-op; v3 sentinel present → insert the missing completion lines (`null` when none is missing: a v5 block gains only the project line, a v4 block the policy and project lines); v2 sentinel (`!.devflow/features/*/KNOWLEDGE.md`) present without v3 → insert the v3 sentinel plus the missing completion lines right after the v2 sentinel; legacy bare `.devflow/` or no block → append the full block via `appendBlock` (blank-line separated), using `DEVFLOW_GITIGNORE_BLOCK_WITHOUT_CLAUDEIGNORE` when `hasClaudeignoreEntry`. The v2 and v3 sentinels are module-private constants.

**Top-ups go INSIDE the block (`D-GITIGNORE-IN-BLOCK`), never at the end.** The missing lines are inserted as one run, in block order, after the sentinel line and the lines right after it that a fresh block places before the first missing line (`blockRunBefore`, bounded at `BLOCK_RUN_MAX`; the shell loop has the same bound). Every other byte of the file is kept, and a v5 block upgrades to the current block byte for byte. The shell twin mirrors the insert and the append form.

**Fast path.** Marker file `.devflow/.root-gitignore-configured-v6` (project-local, NOT `~/.devflow/`) AND the v3 sentinel AND every completion line present. The marker is a claim, not proof; bumping the version forces one re-run per install. A change to a block whose marker version has not yet shipped in a release edits it in place with no bump (the in-block insert and the comment wording were done that way); once shipped, a change needs a bump. **Legacy marker cleanup runs on every path:** `removeLegacyGitignoreMarkers` (TS, looping `LEGACY_GITIGNORE_MARKERS`) and the shell's `_erg_drop_legacy_markers` remove every older marker — `-v5` / `-v4` / `-v3` / `-v2` / unversioned — from both the fast-path hit and the on-success stamp.

**Links.** A linked root `.gitignore` is written only when it resolves inside the project and outside any `.git`, in any letter case (`D-GITIGNORE-LINK-INSIDE`; `resolveGitignoreTarget`, shell twin `_erg_resolve_inside`). init creates the marker exclusively (`wx`) and writes or removes nothing under a `.devflow` or marker that is a symbolic link (`D-CLI-NO-SYMLINK`); each skip is reported (link rules: `learning-capture-system` KB).

## CLAUDE.md Import Audit Step (`init.ts`, `D-CLAUDE-MD-IMPORT-AUDIT`, `D-AUDIT-STAMP`)

`init` ends with one note on the CLAUDE.md `@path` imports that put a large file into every thread's always-loaded context. `claudeMdAuditStep(outcome)` is the pure formatter both wizard paths share, returning `{ note, degraded }`; its one call site in `run` sits after the tracker summary lines and before the proxy status line and the outro. It is decided AFTER the install because Recommended's pre-install summary has no room for it and Advanced prints no end-of-wizard summary. It prints `p.note(note, 'CLAUDE.md import audit')` only when something is flagged, or one `p.log.warn` degraded line when the audit could not run, and it never changes the exit code. The audit logic lives once in `src/assets/scripts/claude-md-audit.cjs`; `src/core/claude-md-audit.ts` is the typed facade, loading the package's own copy from `scriptsDir()` (never the installed `~/.devflow/scripts`, which may be older than the CLI).
- `auditAndRecordClaudeMd({claudeDir, projectRoot: gitRoot, home, devflowDir})` runs the audit with `showAll` — init is a deliberate command, so it states every current finding even when an earlier SessionStart already showed it, while the stamp it writes keeps the earlier keys. Roots are `{claudeDir}/CLAUDE.md` always, plus the project's `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` at its toplevel only when `gitRoot` is non-null (a HOME-rooted repo is treated as no repo, per the init-writes-nothing-at-HOME rule).
- The stamp (`~/.devflow/.claude-md-audit`) is what stops the first SessionStart after init from repeating what init printed. `writeClaudeMdAuditStamp` refuses, writing nothing, when `~/.devflow` does not exist (a command never creates the machine root for it) and when the stamp path is a symbolic link or any other non-regular file (its own `lstat` check, because the atomic writer renames over whatever sits at the target). Otherwise it calls `writeFileAtomicExclusive(stampPath, text, 0o600)`: the optional `createMode` argument creates the sibling `.tmp.<pid>` file with that mode (masked by the umask), so the file naming the user's project paths is never readable by others, not even between write and rename. A stamp that cannot be written costs a repeated message at most and is not reported.
- Uninstall classifies the stamp and its `.claude-md-audit.tmp.` prefix entry as install artifacts (uninstall KB).

## Anti-Patterns

- **KB-AP-1** The parity table in `tests/shell-hooks.test.ts` enforces the byte identity; both implementations and the fast-path marker version change in one commit.
- **KB-AP-2** `.claudeignore` may or may not be in the block depending on `hasClaudeignoreEntry`, so using it to detect the block produces false negatives on repos that already had a `.claudeignore` entry before the block was written.
- **KB-AP-3** A top-up at the end of the file would silently override a user's own later `.devflow/project.json` re-ignore.
- **KB-AP-7** The stamp holds paths, existence flags and finding keys; the temp file must never be readable by others, and a symlink at the target must not be written through.

## Gotchas

- **KB-AP-4** A global marker path would mark every project configured after the first init and prevent the block from being written to others.
- **KB-AP-5** A superseded marker version left unlisted is orphaned rather than cleaned up.
- **KB-AP-6** `tests/shell-hooks.test.ts` pins the `return 0` with a mutant that removes it; the failure is silent and breaks every sourcing hook (capture-prompt, capture-turn, capture-question, memory-worker, pre-compact-memory) on both the fast path and the stamping path.
- **`createMode` only governs creation.** `writeFileAtomicExclusive(path, text, createMode)` applies the mode (masked by the umask) to the sibling temp file; an existing target's mode still wins across the rename, so an older stamp keeps whatever mode it had.
- **Parity tables assert bytes, not structure** (content-anchored fixtures; equality baselines, not floors): a structural assertion would pass a block that differed in a comment line.

## Key Files

- `src/targets/claude-code/post-install.ts` — `DEVFLOW_TRACKED_PATHS`, `DEVFLOW_GITIGNORE_BLOCK`, `DEVFLOW_GITIGNORE_BLOCK_WITHOUT_CLAUDEIGNORE`, `computeDevflowGitignore` (idempotent; every upgrade path), the module-private sentinels and completion-line constants, `BLOCK_RUN_MAX`, `GITIGNORE_MARKER_V6`, `LEGACY_GITIGNORE_MARKERS`, `removeLegacyGitignoreMarkers`, `resolveGitignoreTarget`; must stay byte-identical with `ensure-root-gitignore`
- `src/assets/scripts/hooks/ensure-root-gitignore` — the shell implementation of the same block logic; `_erg_drop_legacy_markers` (shared by the fast path and the on-success stamp, explicit `return 0`), `_erg_resolve_inside`
- `src/assets/scripts/hooks/ensure-devflow-init` — the fast-path check for the project-local marker; its version must match the stamper's in both other files
- `src/core/claude-md-audit.ts` — typed facade over `claude-md-audit.cjs`: `auditAndRecordClaudeMd`, `runClaudeMdAudit`, `writeClaudeMdAuditStamp`, `CLAUDE_MD_AUDIT_STAMP_FILE`, `CLAUDE_MD_AUDIT_STAMP_TMP_PREFIX`, `formatClaudeMdAuditNote`, `formatClaudeMdAuditUnavailable`
- `src/core/fs-atomic.ts` — `writeFileAtomicExclusive(filePath, data, createMode?)`: a PID-scoped `wx` temp file renamed into place, an existing target's mode preserved
- `src/cli/commands/init.ts` — `claudeMdAuditStep` (pure; one call site after the tracker summary lines), the `auditAndRecordClaudeMd` call
- `tests/shell-hooks.test.ts` — the TS/shell parity table and the `return 0` mutant

## Related

- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — hub: install pipeline overview
- `.devflow/features/installer-shadowing-init-seed/KNOWLEDGE.md` — init's other behaviours (no repository writes at HOME, atomic settings)
- `.devflow/features/installer-shadowing-uninstall/KNOWLEDGE.md` — the project-data step that keeps `DEVFLOW_TRACKED_PATHS` and the artifact entries for the audit stamp
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md` — the SessionStart hook (`session-start-context`) that reads and refreshes the audit stamp init writes; this KB covers only init's after-install call, the stamp's creation mode and the uninstall artifact entries
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — the Knowledge agent writes to `.devflow/features/`, tracked in git through this same carve-out
- `.devflow/features/test-harness/KNOWLEDGE.md` — the residue test that motivated the `.claudeignore` line, and the parity-table conventions
- `.devflow/features/learning-capture-system/KNOWLEDGE.md` — link rules under `.devflow/`

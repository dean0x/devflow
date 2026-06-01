# Documentation Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### HIGH

**CLAUDE.md missing `devflow debug` command and debug tracing system documentation** - `CLAUDE.md:55` and `CLAUDE.md:83`
**Confidence**: 95%
- Problem: This branch introduces a significant new feature -- hook debug tracing with a `devflow debug --enable/--disable/--status` CLI command, a `debug-trace` shared helper, `hook-bootstrap` shared helper, and `DEVFLOW_HOOK_DEBUG` env var stored in `~/.claude/settings.json`. ADR-007 documents this as an architectural decision (applies ADR-007). However, the CLAUDE.md Architecture Overview has no section describing this system. Line 55 says only "Debug logs stored at `~/.devflow/logs/{project-slug}/`." without mentioning the debug tracing toggle, the `.hook-debug.log` log file, or the two-phase logging (global fallback then per-project). The CLI commands list at line 83 (`src/cli/ # TypeScript CLI (init, list, uninstall, ambient, learn, decisions, flags, knowledge, rules)`) omits `debug`.
- Fix: Add a `**Debug Tracing**` paragraph to the Architecture Overview section after "Debug logs stored at..." covering: the `devflow debug --enable/--disable/--status` command, the `DEVFLOW_HOOK_DEBUG=1` env var toggle stored in `~/.claude/settings.json` env block, the `debug-trace` shared helper sourced by all hooks via `hook-bootstrap`, two-phase log routing (pre-CWD global fallback `~/.devflow/logs/.hook-debug.log`, post-CWD per-project `~/.devflow/logs/{project-slug}/.hook-debug.log`), and 5MB size guard with tail truncation. Also add `debug` to the CLI commands list at line 83.

### MEDIUM

**CLAUDE.md Working Memory section does not mention the modular sidecar-evaluate decomposition** - `CLAUDE.md:45`
**Confidence**: 82%
- Problem: `sidecar-evaluate` was refactored from a single monolithic script (~400 lines removed) into an orchestrator that sources 5 modules: `eval-helpers`, `eval-reinforce`, `eval-learning`, `eval-decisions`, `eval-knowledge`. The CLAUDE.md description of sidecar-evaluate still describes it as a monolithic hook. While the behavioral description remains accurate, the architectural change is significant enough to note -- particularly the module naming convention, the shared `_eval_release_lock()` helper, and the fail-fast `${VAR:?}` guards pattern. The Project Structure tree on line 82 was updated to list the new files, but the Working Memory prose was not.
- Fix: Add a brief clause to the sidecar-evaluate description: "Orchestrator that sources `eval-helpers` + 4 feature modules (`eval-reinforce`, `eval-learning`, `eval-decisions`, `eval-knowledge`) after shared setup; each module uses `${VAR:?}` fail-fast guards and `_MODULENAME_` variable prefixes for namespace isolation."

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`sidecar-capture` internal variable `RESPONSE_TEXT` is a vestige of the old field name** - `scripts/hooks/sidecar-capture:44`
**Confidence**: 80%
- Problem: The code reads `last_assistant_message` from the JSON input (line 37) but stores it in a variable called `RESPONSE_TEXT` (line 44). This is a documentation-level concern: the variable name implies `response_text` (the old field name documented in PF-006), which could mislead future maintainers into thinking the old field is still used. The comment on line 34 correctly lists the current field names, which partially mitigates this, but the variable name itself contradicts the comment.
- Fix: Rename the shell variable from `RESPONSE_TEXT` to `ASSISTANT_MSG` (or similar) throughout `sidecar-capture`. This aligns the internal naming with the actual JSON field and avoids confusion for maintainers who read PF-006 (avoids PF-006).

## Pre-existing Issues (Not Blocking)

### MEDIUM

**CLAUDE.md Phase number inconsistency for feature knowledge sentinel** - `CLAUDE.md:59` vs `CLAUDE.md:180`
**Confidence**: 90%
- Problem: The Feature Knowledge Bases prose (line 59) says "`.devflow/features/.disabled` sentinel gates Phase 12 generation and refresh hook" while the project structure tree (line 180) says "`.disabled # Sentinel -- gates Phase 9 generation and refresh hook". These Phase numbers disagree. This is not introduced by this branch but is pre-existing.
- Fix: Determine the correct Phase number from the `/implement` command definition and update both references to match.

## Suggestions (Lower Confidence)

- **eval-reinforce Node fallback lacks inline comment explaining the slug extraction algorithm** - `scripts/hooks/eval-reinforce:64-66` (Confidence: 65%) -- The `artifact_path.split('/').slice(-2, -1)[0]` pattern extracts a slug from a path, but the comment only says "Extract slugs" without explaining the two extraction modes (commands vs skills paths). The jq equivalent above (lines 30-34) has the same logic but with a named helper `extract_slug` which is self-documenting.

- **New decisions and pitfalls entries (PF-006, PF-007, ADR-007) lack cross-references to the implementing code** - `.devflow/decisions/pitfalls.md:51-67`, `.devflow/decisions/decisions.md:60-67` (Confidence: 62%) -- PF-006 and PF-007 describe what happened but don't reference the specific commits or files that implement the fix. ADR-007 mentions the helper script and CLI command by name, which is better. The PF entries would benefit from a "See also" line pointing to the implementing files.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Documentation Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The branch introduces well-documented shell scripts (each with clear usage headers, exports, and requires sections) and well-documented TypeScript (JSDoc on all pure functions). The decisions entries (ADR-007, PF-006, PF-007) are thorough. However, the CLAUDE.md -- the project's primary architectural reference -- was not updated to describe the new debug tracing system, which is a first-class feature with its own CLI command, env var toggle, and shared helpers across all 7 hooks. The CLI commands list is also stale. These gaps mean an agent or developer reading only CLAUDE.md would not know the debug tracing system exists.

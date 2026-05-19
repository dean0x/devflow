# Architecture Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-26

## Issues in Your Changes (BLOCKING)

### HIGH

**`removeEntry` early return inside lock leaves lock unreleased** - `scripts/hooks/lib/feature-kb.cjs:350`
**Confidence**: 92%
- Problem: When `removeEntry` fails to parse `index.json` (the `catch` block at line 350), it executes `return;` which exits the function immediately. However, this return is inside a `try/finally` block, so the `finally` at line 361 will run `releaseLock(lockPath)`. On re-reading: the `finally` block does correctly release the lock even on early return. This is actually correct behavior. *(Self-correction: this finding is withdrawn after closer inspection -- `try/finally` handles early return in JS.)*

### MEDIUM

**Background script `set -e` combined with `|| true` fallbacks creates fragile error handling** - `scripts/hooks/background-kb-refresh:8`
**Confidence**: 82%
- Problem: The script uses `set -e` (exit on error) at the top, then relies on `|| true` patterns throughout (lines 37, 59, 107, 162, 163) to prevent premature termination. The `wait "$CLAUDE_PID"` at line 153 can fail under `set -e` before reaching the exit code check. The `2>/dev/null` on the `wait` helps, but the interaction between `set -e` and backgrounded processes is notoriously fragile across bash versions.
- Fix: Either remove `set -e` and handle errors explicitly (matching the pattern in `background-learning`), or add `|| true` to the `wait` call at line 153. Check whether `background-learning` uses `set -e` and align.

**Dual-gating mechanism for KB feature (hook + sentinel file) creates state consistency risk** - `src/cli/commands/init.ts:955-1004`, `scripts/hooks/session-end-kb-refresh:29-30`
**Confidence**: 80%
- Problem: The KB feature is gated by two independent mechanisms: (1) the SessionEnd hook presence in `settings.json`, and (2) the `.features/.disabled` sentinel file. The `--status` command (kb.ts:238) correctly checks both, but the production guard (`session-end-kb-refresh:30`) only checks the sentinel. If a user manually removes the hook but keeps the sentinel absent, the feature appears enabled in `--status` but the refresh hook never fires. Conversely, if the hook is present but `.disabled` exists, the hook fires but exits immediately (line 30). This dual-gating is intentional for the plan:orch Phase 12 case (sentinel gates generation even when hook is present), but the two mechanisms can drift out of sync.
- Fix: Document the dual-gate design in a JSDoc comment on the `addKbHook`/`removeKbHook` functions explaining that the hook gates session-end auto-refresh while the sentinel gates plan-time generation. Alternatively, have the `session-end-kb-refresh` hook check for both conditions for defense-in-depth.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`background-kb-refresh` prompt embeds full KB content in a shell variable without size guard** - `scripts/hooks/background-kb-refresh:104,116-139`
**Confidence**: 85%
- Problem: The `EXISTING=$(cat "$KB_PATH")` at line 104 reads the entire KNOWLEDGE.md into a shell variable, then interpolates it into `PROMPT` at line 125. With the 500-line cap from the Knowledge agent specification, this could be up to ~25KB of content embedded in a single shell variable that gets passed as a CLI argument to `claude -p`. On some systems, `ARG_MAX` limits the total size of arguments + environment passed to `execve`. While modern Linux/macOS typically have a 2MB+ `ARG_MAX`, this pattern is fragile and differs from the `background-learning` hook which passes prompts via a smaller, bounded format.
- Fix: Write the prompt to a temporary file and pass it via `cat "$TMPFILE" | claude -p --model sonnet ...` (pipe via stdin) instead of as a positional argument. This avoids `ARG_MAX` limits and aligns with how `background-learning` handles large inputs.

**`checkEntryFiles` extracted but `checkStaleness` still calls `execFileSync` for git-dir check independently** - `scripts/hooks/lib/feature-kb.cjs:154-167`
**Confidence**: 80%
- Problem: The refactoring extracted `checkEntryFiles` as a shared helper, but `checkStaleness` (the single-slug variant) still does its own git-dir check at line 160-163 before calling `checkEntryFiles`. Meanwhile, `checkAllStaleness` does the git-dir check once at line 184 and then loops over entries calling `checkEntryFiles` directly. This asymmetry is correct but the git-dir check is duplicated in the codebase (once in `checkStaleness`, once in `checkAllStaleness`). A minor DRY concern.
- Fix: Extract a `isGitRepo(worktreePath)` helper to encapsulate the git-dir check, used by both `checkStaleness` and `checkAllStaleness`.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`feature-kb.cjs` exports both library functions and CLI handler in one module** - `scripts/hooks/lib/feature-kb.cjs`
**Confidence**: 85%
- Problem: The file serves dual purposes: it is both a library (imported via `require` in tests and other modules) and a CLI entry point (via `require.main === module` block starting around line 390). This dual-mode pattern is common in Node.js but the file is now ~565 lines with 9 exported functions, 6 CLI subcommands, and growing. The PR adds 2 more subcommands (`stale-slugs`, `refresh-context`). As the KB system grows, this module risks becoming a god module with too many responsibilities.
- Fix: Consider splitting into `feature-kb-lib.cjs` (pure functions) and `feature-kb-cli.cjs` (CLI handler that imports the lib). Not blocking for this PR but worth tracking.

## Suggestions (Lower Confidence)

- **watchdog PID leak on `set -e` failure** - `scripts/hooks/background-kb-refresh:150-163` (Confidence: 65%) -- If the main script exits early due to `set -e` after spawning the watchdog subprocess (line 150) but before the `kill "$WATCHDOG_PID"` (line 162), the watchdog sleep process may linger for 180 seconds. The EXIT trap only cleans up the lock, not the watchdog.

- **Explore:orch asymmetric knowledge pattern differs from plan:orch** - `shared/skills/explore:orch/SKILL.md:44-46,52-53` (Confidence: 70%) -- The explore:orch skill explicitly keeps both `KNOWLEDGE_CONTEXT` and `FEATURE_KNOWLEDGE` orchestrator-local and does NOT pass them to Explore sub-agents. This differs from plan:orch Phase 5 (line 148-154) which DOES pass both to Explore agents. The asymmetry is documented with rationale ("investigation workers examine code without pre-loaded context") but could confuse future contributors.

- **`init.ts` KB enable/disable logic has no re-entrancy guard** - `src/cli/commands/init.ts:995-1004` (Confidence: 62%) -- If `devflow init` is run concurrently (unlikely but possible in CI), two processes could race on creating/removing `.features/.disabled`.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates strong architectural discipline: the KB toggleability and auto-refresh system follows established project patterns (mkdir-based locking, background process spawning via `nohup`/`disown`, throttle markers, log rotation). The `kb-builder` to `knowledge` agent rename improves naming consistency. The refactoring of `checkEntryFiles` as a shared helper reduces duplication in `checkAllStaleness`. The new CLI subcommands (`stale-slugs`, `refresh-context`) provide clean, testable interfaces for the background refresh hook.

Key architectural strengths:
- Follows the established hook pattern (session-end trigger -> background worker -> claude -p)
- Clean separation: session-end hook is a thin dispatcher, background script handles orchestration
- Toggleable via both CLI and init, with manifest tracking
- Tests cover the new CLI subcommands and hook functions comprehensively

Conditions: address the `set -e` fragility in `background-kb-refresh` and the prompt-as-argument size risk. The dual-gate design should be documented as an explicit architectural decision.

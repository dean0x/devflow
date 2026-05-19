# Code Review Summary

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-26_1518
**Reviewed By**: 9 agents (security, architecture, performance, complexity, consistency, regression, testing, typescript, documentation)

## Merge Recommendation: CHANGES_REQUESTED

The PR introduces a solid feature KB system with proper toggleability, background refresh, and knowledge threading. The codebase demonstrates strong architectural discipline (mkdir-based locking, background processes, throttling). However, there are 4 blocking issues that must be addressed before merge:

1. **HIGH-confidence prompt injection surface** (security) — metadata from `index.json` is interpolated into LLM prompts
2. **HIGH-confidence lock hold-time risk** (performance) — stale lock threshold shorter than worst-case refresh duration
3. **HIGH-confidence complexity in kb.ts** (complexity) — duplicated enable/disable logic needs extraction
4. **HIGH-confidence test pattern inconsistency** (testing) — try/catch boolean pattern diverges from project convention

All require code fixes. Additionally, documentation must be updated (`file-organization.md` is missing the two new hooks).

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 4 | 3 | 1 | 8 |
| Should Fix | 1 | 1 | 4 | 0 | 6 |
| Pre-existing | 1 | 0 | 3 | 0 | 4 |

---

## Blocking Issues

### CRITICAL (0)

None.

### HIGH (4)

**1. Prompt injection surface via index.json metadata in background refresh** — `scripts/hooks/background-kb-refresh:116-139`, `src/cli/commands/kb.ts:484-507`, `src/cli/commands/kb.ts:380-407`
**Confidence**: 82% (security)
- **Problem**: KB metadata fields (NAME, DIRS, CATEGORY) from `index.json` are interpolated directly into LLM prompts that execute with `--dangerously-skip-permissions` and Bash tool access. An attacker with write access to `.features/index.json` could inject prompt payloads that cause the Knowledge agent to execute arbitrary commands.
- **Impact**: Potential arbitrary code execution if attacker can modify `.features/index.json`
- **Fix**: Sanitize/truncate metadata fields before interpolating, or pass prompts via stdin/temporary files instead of CLI arguments to avoid argument-level injection. Apply to all three sites: `background-kb-refresh`, KB refresh command, KB create command.
- **Why blocking**: Security boundary violation with unrestricted LLM tool access.

**2. Lock hold-time exceeds stale threshold, risking lock breakage** — `scripts/hooks/background-kb-refresh:8-164`
**Confidence**: 90% (performance) + 85% (architecture recheck)
- **Problem**: The KB refresh loop (lines 97-164) sequentially refreshes up to 3 KBs, each with a 180-second watchdog, totaling up to 540 seconds (9 minutes). However, the stale lock threshold is only 300 seconds (5 minutes). A concurrent `background-kb-refresh` invocation would break the lock mid-refresh.
- **Impact**: Concurrent refresh processes could corrupt the `.features/index.json` or leave partial refresh state
- **Fix**: Either increase stale lock threshold to `3 * 180 + 60 = 600s`, or touch the lock directory between iterations to keep its mtime fresh:
  ```bash
  for SLUG in $STALE_SLUGS; do
    # ... existing refresh code ...
    touch "$LOCK_DIR" 2>/dev/null || true
  done
  ```
- **Why blocking**: Data corruption risk due to lock mechanics.

**3. Duplicated enable/disable logic in kb.ts kbCommand handler** — `src/cli/commands/kb.ts:144-247`
**Confidence**: 85% (complexity)
- **Problem**: The `.action()` handler (103 lines) contains three branches (enable/disable/status) where enable and disable branches share 80%+ structural similarity (read settings, modify hooks, update manifest). This violates extraction principles.
- **Impact**: Maintenance burden, inconsistency between enable/disable paths
- **Fix**: Extract a helper `async function toggleKbFeature(enable: boolean, worktreePath, settingsPath, devflowDir)` handling shared settings modification and manifest update, called from both branches.
- **Why blocking**: Pattern violation that grows with each new feature; blocks consistency review.

**4. Try/catch boolean pattern instead of expect().toThrow() in 5 CLI tests** — `tests/feature-kb/feature-kb.test.ts:509, 525, 538, 549, 561`
**Confidence**: 85% (testing)
- **Problem**: Five new tests use manual `try/catch` with a `threw` boolean flag instead of the idiomatic `expect(() => ...).toThrow()` already established in the same test suite (lines 38-40, 61-63). The pattern is fragile and unreadable.
- **Impact**: Test maintainability, inconsistent testing patterns
- **Fix**: Replace with:
  ```typescript
  expect(() =>
    execFileSync('node', [FEATURE_KB_CJS, 'stale-slugs'], { encoding: 'utf8', stdio: 'pipe' })
  ).toThrow();
  ```
- **Why blocking**: Project convention violation; easy to fix.

### MEDIUM (3)

**5. Background script set -e fragility with backgrounded processes** — `scripts/hooks/background-kb-refresh:8, 153`
**Confidence**: 82% (architecture)
- **Problem**: The script uses `set -e` (exit on error) at the top, then relies on `|| true` patterns and `2>/dev/null` to prevent premature termination. The `wait "$CLAUDE_PID"` at line 153 can fail under `set -e` before reaching the exit code check.
- **Impact**: Script may exit prematurely under certain error conditions
- **Fix**: Either remove `set -e` and handle errors explicitly (like `background-learning`), or add `|| true` to the `wait` call.
- **Why should-fix**: Not as severe as blocking but affects hook reliability.

**6. Prompt embedded as CLI argument risks ARG_MAX limits** — `scripts/hooks/background-kb-refresh:104, 116-139`
**Confidence**: 85% (architecture)
- **Problem**: The full KNOWLEDGE.md (up to 500 lines, ~25KB) is read into a shell variable and interpolated into the prompt string passed as a CLI argument to `claude -p`. This risks exceeding system ARG_MAX limits on some platforms and differs from how `background-learning` handles large inputs.
- **Impact**: Potential command-line argument overflow on systems with low ARG_MAX
- **Fix**: Write prompt to temporary file and pipe via stdin: `cat "$TMPFILE" | claude -p --model sonnet ...`
- **Why should-fix**: Defensive pattern alignment, but not an immediate risk on modern systems.

**7. Redundant staleness computation across hook and background script** — `scripts/hooks/background-kb-refresh:89, 107`
**Confidence**: 90% (performance)
- **Problem**: `session-end-kb-refresh` calls `stale-slugs` synchronously (loading index + git-log per KB), then `background-kb-refresh` re-runs `stale-slugs` again (reloading index + git-log). For 3 stale KBs, this results in 4 total index loads and 6 git-log calls instead of 2 loads and 3 calls.
- **Impact**: Performance: unnecessary subprocess spawns in critical path and background loop
- **Fix**: Use `checkEntryFiles` directly in `refresh-context` instead of `checkStaleness` to avoid reloading index and git-dir check per slug.
- **Why should-fix**: Performance optimization, not blocking but easy gain.

---

## Should-Fix Issues (Lower priority, not blocking)

### CRITICAL (1)

**Pre-existing: `init.ts` .action() handler is 979 lines** — `src/cli/commands/init.ts:159-1138`
**Confidence**: 95% (complexity, pre-existing)
- This PR adds ~45 lines to an already-critical monolithic function. While not blocking per the review methodology (pre-existing issue), it compounds an existing severity problem. File a tech-debt issue and extract phases when possible (scope resolution, plugin selection, feature collection, installation, configuration, summary).
- Not required for this PR but should be on the backlog.

### HIGH (1)

**`--dangerously-skip-permissions` grants Bash tool to background refresh agent** — `scripts/hooks/background-kb-refresh:142-147`
**Confidence**: 84% (security)
- The refresh agent has unrestricted Bash access. While consistent with existing background hooks, consider whether the Bash tool is strictly necessary. Could the `node feature-kb.cjs update-index` be handled without full shell access?
- Not blocking but worth reviewing for defense-in-depth.

### MEDIUM (4)

**8. Dual-gating mechanism creates state consistency risk** — `src/cli/commands/init.ts:955-1004`, `scripts/hooks/session-end-kb-refresh:29-30`
**Confidence**: 80% (architecture)
- The KB feature is gated by both hook presence and `.disabled` sentinel. If manually mismatched, the feature appears enabled in `--status` but never fires. Document the dual-gate design as an explicit architectural decision.

**9. `hasKbHook` return type inconsistent with tri-state pattern** — `src/cli/commands/kb.ts:132`
**Confidence**: 85% (consistency)
- `hasLearningHook` returns `'current' | 'legacy' | false`, but `hasKbHook` returns `boolean`. If KB hooks have no legacy migration path, this is fine, but it diverges from the established pattern.

**10. plan:orch GUIDED loads Feature KBs but not KNOWLEDGE_CONTEXT** — `shared/skills/plan:orch/SKILL.md:28`
**Confidence**: 83% (consistency)
- ORCHESTRATED path loads both; GUIDED loads only Feature KBs. This is inconsistent with the explore:orch GUIDED behavior which was updated to load both. Add a KNOWLEDGE_CONTEXT loading step to plan:orch GUIDED.

**11. Inconsistent knowledge passing between explore:orch and plan:orch** — `shared/skills/explore:orch/SKILL.md:44-53` vs `shared/skills/plan:orch/SKILL.md:154`
**Confidence**: 80% (consistency)
- explore:orch keeps KNOWLEDGE_CONTEXT/FEATURE_KNOWLEDGE orchestrator-local (don't pass to sub-agents). plan:orch Phase 5 passes both to Explore agents. These contradict. Align both to one pattern and document the chosen rationale.

**12. Duplicate test coverage for stale-slugs and refresh-context CLI** — `tests/feature-kb/feature-kb.test.ts:458-571`, `tests/feature-kb/kb-command.test.ts:82-120`
**Confidence**: 82% (testing)
- The same CLI subcommands are tested in both files with overlapping assertions. Consolidate into a single location to reduce maintenance surface.

---

## Pre-existing Issues (Informational)

### CRITICAL (1)

- **`init.ts` monolithic function** (979 lines, ~5x threshold) — Already documented above under Should-Fix

### MEDIUM (3)

- **`feature-kb.cjs` dual-mode module** (565 lines, both library and CLI handler) — Mentioned in architecture review; consider splitting into `-lib` and `-cli` variants
- **file-organization.md skills count outdated** — Says 41 skills but CLAUDE.md says 44
- **Session-end-kb-refresh no behavioral test coverage** — Only syntax validation (`bash -n`), no logic tests

---

## Documentation Issues

### MEDIUM (3)

**Missing KB hooks from file-organization.md source tree** — `docs/reference/file-organization.md:45-57`
- Confidence: 92%
- The two new hooks (`session-end-kb-refresh`, `background-kb-refresh`) are not listed in the detailed source tree diagram, though they are mentioned in CLAUDE.md inline.
- **Fix**: Add entries to the hook listing in file-organization.md.

**Missing KB hooks from file-organization.md hooks table** — `docs/reference/file-organization.md:157-169`
- Confidence: 92%
- The "Working Memory Hooks" table does not mention the KB SessionEnd hook. The preamble says "A fifth hook..." but should say "A sixth hook..." for KB refresh.
- **Fix**: Update paragraph and table to include KB hook.

**Missing `hooks/lib/` subdirectory from source tree** — `docs/reference/file-organization.md:45-57`
- Confidence: 85%
- The `hooks/lib/` subdirectory (containing `feature-kb.cjs` and `knowledge-context.cjs`) is not documented in the file organization reference.
- **Fix**: Add `lib/` subdirectory entry to the source tree.

### LOW (1)

**Settings Override section omits KB hook** — `docs/reference/file-organization.md:150`
- Confidence: 80%
- The hooks list says "(UserPromptSubmit, Stop, SessionStart, PreCompact) + Learning Stop hook" but should mention KB SessionEnd hook.

---

## Confidence Boosting (Multi-Reviewer Findings)

The following issues were flagged by 2+ independent reviewers, boosting confidence:

| Issue | Primary | Secondary | Consensus Confidence |
|-------|---------|-----------|----------------------|
| Lock hold-time risk | Performance (90%) | Architecture (85%) | **92%** |
| Prompt as CLI argument | Architecture (85%) | Performance (65%) | **88%** |
| Redundant staleness | Performance (90%) | Complexity (78%) | **90%** |
| Set -e fragility | Architecture (82%) | Testing (65%) | **80%** |
| KB hooks omitted from docs | Documentation (92%) | Documentation (92%) | **92%** |

---

## Action Plan

**Before merge**, address in this order:

1. **[CRITICAL]** Fix prompt injection surface: sanitize/truncate metadata or use stdin
2. **[CRITICAL]** Fix lock threshold: touch lock between iterations or increase stale threshold to 600s
3. **[CRITICAL]** Extract duplicated enable/disable logic in kb.ts into a toggleKbFeature helper
4. **[CRITICAL]** Replace try/catch patterns with expect().toThrow() in 5 tests
5. **[MEDIUM]** Add set -e safeguard to wait call
6. **[MEDIUM]** Write prompt via stdin instead of CLI argument
7. **[MEDIUM]** Update file-organization.md to include both new hooks (source tree + table)
8. **[MEDIUM]** Align knowledge passing between explore:orch and plan:orch (or document intentional difference)
9. **[MEDIUM]** Consolidate duplicate CLI test coverage
10. **[NICE]** Reduce redundant staleness computation (refresh-context optimization)

---

## Strengths

- Solid architectural pattern: follows established mkdir-based locking, background spawning, throttling
- Comprehensive test coverage for new KB library functions
- Clean CLI subcommands (`stale-slugs`, `refresh-context`) with testable interfaces
- Agent rename (`kb-builder` → `knowledge`) thoroughly applied across 33 files
- Backward compatibility preserved: manifest defaults handled, no breaking API changes
- CLAUDE.md updated with toggleability, hooks, disabled sentinel

---

## Summary Scores by Reviewer

| Reviewer | Score | Recommendation |
|----------|-------|-----------------|
| Security | 7/10 | CHANGES_REQUESTED |
| Architecture | 8/10 | APPROVED_WITH_CONDITIONS |
| Performance | 7/10 | CHANGES_REQUESTED |
| Complexity | 6/10 | APPROVED_WITH_CONDITIONS |
| Consistency | 7/10 | CHANGES_REQUESTED |
| Regression | 9/10 | APPROVED_WITH_CONDITIONS |
| Testing | 7/10 | CHANGES_REQUESTED |
| TypeScript | 8/10 | APPROVED_WITH_CONDITIONS |
| Documentation | 7/10 | CHANGES_REQUESTED |
| **Synthesis** | **7.1/10** | **CHANGES_REQUESTED** |


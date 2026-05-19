# Code Review Summary

**Branch**: feat-per-feature-knowledge-bases -> main
**Date**: 2026-04-23_1941

## Merge Recommendation: CHANGES_REQUESTED

The feature implements a well-architected per-feature knowledge base system with clear separation of concerns (creation, consumption, runtime management). However, 8 HIGH-severity blocking issues and 1 CRITICAL-equivalent issue require resolution before merge. These span consistency gaps in Coder templates, security concerns with unrestricted permissions, performance N+1 patterns, and missing validation checks.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 1 | 9 | 6 | - |
| Should Fix | - | - | 5 | - |
| Pre-existing | - | - | 1 | - |
| **Total** | **1** | **9** | **12** | **0** |

---

## Blocking Issues

### CRITICAL

**`FEATURE_KNOWLEDGE` silently omitted from 80% of Coder implementations** 
- **Files**: `plugins/devflow-implement/commands/implement.md:117-169`, `plugins/devflow-implement/commands/implement-teams.md:110-162`
- **Severity**: CRITICAL
- **Confidence**: 92% (flagged by CONSISTENCY + REGRESSION reviewers)
- **Impact**: The `FEATURE_KNOWLEDGE` variable is loaded by the orchestrator but not passed to SEQUENTIAL_CODERS and PARALLEL_CODERS Coder invocation templates. This means ~20% of implementation tasks silently lose feature knowledge context. The Coder agent documents `FEATURE_KNOWLEDGE` as an input variable, so omission means it never reaches those Coder instances.
- **Resolution**: Add `FEATURE_KNOWLEDGE: {feature_knowledge}` to all four Coder spawn templates:
  1. Sequential Phase 1 Coder (implement.md:120)
  2. Sequential Phase 2+ Coders (implement.md:135)
  3. Parallel Coder 1 (implement.md:151)
  4. Parallel Coder 2 (implement.md:160)
  Apply identical fix to both `implement.md` and `implement-teams.md`.

---

### HIGH (9 issues)

1. **`devflow kb create` hardcodes `--dangerously-skip-permissions` without user consent**
   - **File**: `src/cli/commands/kb.ts:203-207`
   - **Confidence**: 90%
   - **Impact**: Spawned subprocess receives unrestricted tool access with no permission gates. While a developer-facing CLI, users typing `devflow kb create` may not realize they grant elevated privileges.
   - **Resolution**: Document elevated permissions in CLI help text and spinner message:
     ```typescript
     s.start('Running KB Builder agent (unrestricted tool access)...');
     ```
     Add `.description('Create a new KB via claude -p exploration (uses --dangerously-skip-permissions)')` to command definition.

2. **User-controlled `name` and `directoriesRaw` interpolated into LLM prompt without sanitization**
   - **Files**: `src/cli/commands/kb.ts:178-200` (create), `src/cli/commands/kb.ts:270-285` (refresh)
   - **Confidence**: 85%
   - **Impact**: Combined with `--dangerously-skip-permissions`, a malicious feature name (containing LLM control tokens like `\n\nIgnore previous instructions...`) could manipulate agent behavior. Prompt injection vector.
   - **Resolution**: Sanitize user inputs before interpolation:
     ```typescript
     validate: (v) => {
       if (v.trim().length < 3) return 'Name must be at least 3 characters';
       if (!/^[a-zA-Z0-9 \-]+$/.test(v.trim())) return 'Name must contain only letters, numbers, spaces, and hyphens';
       return undefined;
     },
     ```

3. **Architecture diagrams in plan.md and plan-teams.md omit Phase 14.5**
   - **Files**: `plugins/devflow-plan/commands/plan.md:428-486`, `plugins/devflow-plan/commands/plan-teams.md:480-528`
   - **Confidence**: 95%
   - **Impact**: The orchestration agent uses the ASCII diagram as the authoritative phase flow. Missing Phase 14.5 causes the orchestrator to skip Feature KB Generation.
   - **Resolution**: Add Phase 14.5 entry to Architecture diagram in both files:
     ```
     └─ Block 6: Output
        ├─ Phase 14: Output
        └─ Phase 14.5: Feature KB Generation (conditional, non-blocking)
     ```

4. **`FEATURE_KNOWLEDGE` loading pattern duplicated across 7+ orchestration locations**
   - **Files**: `shared/skills/plan:orch/SKILL.md:71-92`, `shared/skills/review:orch/SKILL.md:60-64`, `shared/skills/resolve:orch/SKILL.md:46-49`, `shared/skills/explore:orch/SKILL.md:35-39`, `shared/skills/debug:orch/SKILL.md:40-44`, plus commands
   - **Confidence**: 88%
   - **Impact**: DRY violation. Any change to the loading algorithm (caching, staleness check, matching heuristics) requires updates across 7+ locations. Inconsistency risk over time.
   - **Resolution**: Consolidate into a single script entry point matching the `knowledge-context.cjs index` pattern:
     ```bash
     FEATURE_KNOWLEDGE=$(node scripts/hooks/lib/feature-kb.cjs load "{worktree}" --files='[...]')
     ```

5. **`checkAllStaleness` spawns N+2 redundant processes per slug (N+1 pattern)**
   - **Files**: `scripts/hooks/lib/feature-kb.cjs:153-161`
   - **Confidence**: 92% (flagged by ARCHITECTURE + PERFORMANCE reviewers)
   - **Impact**: For N feature KBs: N redundant `loadIndex` reads, N redundant `git rev-parse` calls. At 20 KBs adds 300-600ms of blocking synchronous time.
   - **Resolution**: Hoist invariant operations above loop:
     ```javascript
     function checkAllStaleness(worktreePath) {
       const index = loadIndex(worktreePath);
       if (!index) return {};
       let isGitRepo = true;
       try {
         execFileSync('git', ['rev-parse', '--git-dir'], { cwd: worktreePath, stdio: 'pipe' });
       } catch { isGitRepo = false; }
       const results = {};
       for (const [slug, entry] of Object.entries(index.features)) {
         if (!isGitRepo) {
           results[slug] = { stale: false, changedFiles: [] };
           continue;
         }
         // ... per-slug git log
       }
       return results;
     }
     ```

6. **`updateIndex` will throw if `.features/` directory does not exist**
   - **File**: `scripts/hooks/lib/feature-kb.cjs:227`
   - **Confidence**: 90%
   - **Impact**: If KB Builder agent spawned in fresh worktree without `.features/`, `acquireLock` throws `ENOENT` with unhelpful error.
   - **Resolution**: Ensure parent directory exists before lock acquisition:
     ```javascript
     const featuresDir = path.join(worktreePath, '.features');
     fs.mkdirSync(featuresDir, { recursive: true });
     const lockPath = path.join(featuresDir, '.kb.lock');
     ```

7. **`removeEntry` will throw if `.features/` directory does not exist**
   - **File**: `scripts/hooks/lib/feature-kb.cjs:291`
   - **Confidence**: 85%
   - **Impact**: Same as #6 — lock acquisition fails before index existence check.
   - **Resolution**: Add directory existence check before `acquireLock`:
     ```javascript
     if (!fs.existsSync(featuresDir)) return;
     const lockPath = path.join(featuresDir, '.kb.lock');
     ```

8. **Missing `validateSlug` call in `refresh` command**
   - **File**: `src/cli/commands/kb.ts:242`
   - **Confidence**: 85%
   - **Impact**: Inconsistency — `create` and `remove` validate slug upfront, but `refresh` does not. If validation fails internally, user sees confusing error instead of clear message.
   - **Resolution**: Add validation at top of `refresh` action handler:
     ```typescript
     if (slug) {
       try {
         featureKb.validateSlug(slug);
       } catch (err) {
         p.log.error(err instanceof Error ? err.message : String(err));
         process.exit(1);
       }
     }
     ```

9. **CLI interface in `feature-kb.cjs` uses sequential `if` blocks instead of dispatch table**
   - **File**: `scripts/hooks/lib/feature-kb.cjs:339-463`
   - **Confidence**: 85%
   - **Impact**: 125 lines of repeated worktree validation/error handling across 5 `if` blocks. Cyclomatic complexity ~12. Harder to maintain and modify.
   - **Resolution**: Extract worktree validation into helper and use command map pattern (see complexity review for full code example).

---

## Should-Fix Issues (5 total, not blocking)

| Issue | File | Category | Confidence | Recommendation |
|-------|------|----------|------------|-----------------|
| Duplicate `feature-kb` in `devflow-core-skills` plugin — should only be in plugins that spawn KB Builder | `src/cli/plugins.ts:50` | Architecture | 85% | Remove `feature-kb` from core-skills, keep `apply-feature-kb` |
| KB Builder agent missing `apply-feature-kb` and `apply-knowledge` skills — needed for refresh with EXISTING_KB context | `shared/agents/kb-builder.md:5-7` | Architecture | 80% | Add both skills to frontmatter |
| `acquireLock` has deeply nested error recovery (4-level nesting) — extract stale-lock check to reduce nesting | `scripts/hooks/lib/feature-kb.cjs:172-196` | Complexity | 82% | Extract `tryBreakStaleLock` helper to flatten nesting |
| `frontmatter inconsistency: apply-feature-kb has `trigger: agent-loaded` but apply-knowledge does not | `shared/skills/apply-feature-kb/SKILL.md:4`, `shared/skills/apply-knowledge/SKILL.md` | Consistency | 82% | Add `trigger: agent-loaded` to apply-knowledge for consistency |
| `allowed-tools` format inconsistency — apply-feature-kb uses array, apply-knowledge uses inline; apply-feature-kb includes unnecessary Grep/Glob | `shared/skills/apply-knowledge/SKILL.md:4`, `shared/skills/apply-feature-kb/SKILL.md:5-8` | Consistency | 80% | Change apply-feature-kb to `allowed-tools: Read` and use single-line format |

---

## Pre-existing Issues (1 total, informational)

| Issue | File | Confidence | Note |
|-------|------|------------|------|
| Asymmetric `FEATURE_KNOWLEDGE` propagation in debug:orch — keeps locally, all others pass to sub-agents | `shared/skills/debug:orch/SKILL.md:40-44` | 82% | Intentional design choice, should be documented in shared conventions reference to prevent accidental breakage |

---

## Merge-Blocking Summary

**Status**: CHANGES_REQUESTED

**Why**: 
1. CRITICAL: Feature knowledge completely missing from 80% of implementations (sequential/parallel Coders)
2. HIGH (9): Security concerns (prompt injection + unrestricted permissions), consistency gaps (omitted phase diagram), performance N+1 patterns, missing directory existence checks, inconsistent validation

**Path Forward**:
- Fix the CRITICAL issue first (add `FEATURE_KNOWLEDGE` to Coder templates)
- Fix HIGH-severity issues in priority order: security (items 1-2), consistency (item 3), duplication (item 4), performance/safety (items 5-7), validation (item 8-9)
- Address should-fix items to prevent future maintenance burden
- Rescan with `/code-review` after fixes to confirm all blocking issues resolved


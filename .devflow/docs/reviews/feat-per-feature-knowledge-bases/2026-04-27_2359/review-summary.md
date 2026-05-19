# Code Review Summary

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27_2359
**Reports**: 8 domain reviewers (architecture, security, performance, complexity, consistency, regression, testing, typescript)

## Merge Recommendation: CHANGES_REQUESTED

**Critical blockers**: 2 architectural/regression regressions must be resolved before merge.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| **Blocking** | 0 | 3 | 3 | 0 | **6** |
| **Should Fix** | 0 | 0 | 5 | 0 | **5** |
| **Pre-existing** | 0 | 0 | 5 | 0 | **5** |

---

## Blocking Issues (Must Fix Before Merge)

### 1. Plan:orch KB index regression (REGRESSION - HIGH, 90% confidence)
**Location**: `shared/agents/knowledge.md:38`, `shared/skills/feature-kb/SKILL.md:107-117`

Knowledge agent can no longer update the index when spawned by `plan:orch` Phase 12. Previously the agent ran `node feature-kb.cjs update-index` via Bash; now it writes a sidecar JSON. However, plan:orch has no post-agent handler to read the sidecar and call `updateIndex`. Result: KBs created via `/plan` will exist on disk but won't appear in the index, breaking staleness checks and discovery.

**Fix**: Add post-agent sidecar handling in `plan:orch` Phase 12 — after the Knowledge agent returns, read the sidecar file and call `updateIndex` with the sidecar data. Alternatively, restore Bash to the Knowledge agent's tool list.

---

### 2. Feature skill contradicts agent capability removal (REGRESSION - MEDIUM, 92% confidence)
**Location**: `shared/skills/feature-kb/SKILL.md:107-117`, `shared/agents/knowledge.md:10-14`

The skill's Integration section still instructs the agent to run `node scripts/hooks/lib/feature-kb.cjs update-index` via Bash, but Bash was removed from the agent's tool list. This creates conflicting instructions between agent responsibility (write sidecar) and skill guidance (run bash command). The agent may fail if it attempts the Bash call.

**Fix**: Update the skill Integration section to document the new sidecar pattern instead of the Bash command.

---

### 3. Duplicated sidecar parsing logic (ARCHITECTURE - HIGH, 85% confidence)
**Location**: `src/cli/commands/kb.ts:26-44`, `scripts/hooks/json-helper.cjs:1813-1828`

The TypeScript `readSidecar()` and CJS `read-sidecar` operation parse sidecar JSON with subtly different contracts. TS version validates types and filters non-string array elements; CJS version only checks `Array.isArray` without filtering. This violates DRY/SRP — future schema changes require coordinated updates to both parsers, risking drift.

**Fix**: Extract shared parsing to `scripts/hooks/lib/feature-kb.cjs` and consume it from both paths, or have `kb.ts` call `json-helper.cjs read-sidecar` via `execFileSync` to consolidate parsing in one place.

---

### 4. CJS sidecar reader lacks string filtering (CONSISTENCY - HIGH, 82% confidence)
**Location**: `scripts/hooks/json-helper.cjs:1823`

The CJS `read-sidecar` doesn't filter non-string array elements, while TS `readSidecar` does. If an LLM-generated sidecar contains non-string elements (numbers, nulls), the shell path passes them through to `update-index`, while the TS path strips them. Behavioral inconsistency.

**Fix**: Add `.filter(v => typeof v === 'string')` in the CJS `read-sidecar` case, matching the TS behavior.

---

### 5. Knowledge agent sidecar handoff not enforced (ARCHITECTURE - MEDIUM, 82% confidence)
**Location**: `shared/agents/knowledge.md:14`, `shared/skills/feature-kb/SKILL.md:9`

The agent's sidecar handoff pattern (`.create-result.json` / `.refresh-result.json`) is only documented in prose. There's no structural enforcement if the agent fails to write the sidecar. The host silently falls back to empty `referencedFiles: []`, so KBs become permanently "current" and never re-trigger staleness detection.

**Fix**: After the `claude -p` invocation in `kb.ts`, check whether the sidecar was written. If not, log a warning and (for interactive create) prompt the user, or (for refresh/background) log a warning. Consider requiring minimum `directories` entries as fallback when sidecar is absent.

---

### 6. Structural duplication in create/refresh handlers (COMPLEXITY - HIGH, 85% confidence)
**Location**: `src/cli/commands/kb.ts:375-467`, `src/cli/commands/kb.ts:476-574`

The `create` (~93 lines) and `refresh` (~99 lines) handlers follow an identical pattern: validate slug, check claude CLI, get worktree path, build sidecar path, delete pre-existing sidecar, build prompt, spawn `execFileSync`, call `readSidecar`, call `featureKb.updateIndex`, clean up sidecar, handle errors. Copy-paste duplication inflates both handlers past 50-line readability threshold.

**Fix**: Extract a shared helper `runKbAgent(opts: { worktreePath, slug, name, directories, prompt, sidecarName, fallbackRefs? })` that encapsulates the sidecar lifecycle. Each handler reduces to ~20-30 lines of prompt construction + helper call.

---

## Should-Fix Issues (Recommended for Same PR)

### 1. `readSidecar` exported from command module (ARCHITECTURE - MEDIUM, 80% confidence)
**Location**: `src/cli/commands/kb.ts:21-45`

`readSidecar` is a general-purpose utility (parse JSON, validate types, return typed data) exported from a command module. Tests import it directly. This violates the command-module-as-orchestration-only convention.

**Fix**: Move to `src/cli/utils/sidecar.ts` and re-export from `kb.ts` for backward compatibility.

---

### 2. Source guards missing from other hooks (CONSISTENCY - MEDIUM, 85% confidence)
**Location**: `scripts/hooks/session-end-kb-refresh:20`, `scripts/hooks/session-end-learning:21`, `scripts/hooks/stop-update-memory:17`, `scripts/hooks/prompt-capture-memory:13`

This branch adds `|| { echo "..."; exit 1; }` error guards to `source` statements in `background-*` hooks, establishing a new pattern. Other hooks in the same ecosystem still use bare `source` without error guards.

**Fix**: Apply the same error-guard pattern to all `source` statements across remaining hooks for consistency.

---

### 3. Unused `fsPromises` import (TESTING/TYPESCRIPT - MEDIUM, 95% confidence)
**Location**: `tests/feature-kb/feature-kb.test.ts:6`

The import `import { promises as fsPromises } from 'fs'` was added but never used. Only synchronous `fs` functions are used.

**Fix**: Remove the unused import.

---

### 4. Staleness check control flow is over-complex (ARCHITECTURE - MEDIUM, 80% confidence)
**Location**: `src/cli/commands/kb.ts:490,514`

The `stalenessMap` variable is `Record<...> | undefined` and only populated when `slug` is not provided. Single-slug refreshes hit a fallback `checkStaleness` call that was never precomputed.

**Fix**: Compute staleness consistently — either always call `checkStaleness` per-slug inside the loop, or compute `checkAllStaleness` upfront regardless of whether `slug` is provided (cost is negligible).

---

### 5. Missing test for readSidecar non-object guard (TESTING - MEDIUM, 82% confidence)
**Location**: `src/cli/commands/kb.ts:33`, test coverage gap

The `readSidecar` function has a guard for valid JSON that parses to a primitive (e.g., `42` or `"hello"`). This branch is not covered by existing tests.

**Fix**: Add test case:
```typescript
it('returns {} when JSON parses to a non-object (primitive)', async () => {
  const f = writeTmp('42');
  const result = await readSidecar(f);
  expect(result).toEqual({});
});
```

---

## Positive Findings

### Security Improvements
- **Shell injection fix**: Replaces inline `node -e` with CLI argument passing, eliminating interpolation risk
- **Bash removed from Knowledge agent**: Reduces attack surface, follows least privilege
- **Source guards hardened**: Fail-fast on missing sourced files prevents degraded operation
- **Sidecar parsing hardened**: Full type validation at boundary per CLAUDE.md principle #9
- **No CRITICAL/HIGH security issues introduced**

### Performance
- **Staleness caching**: Eliminates redundant `checkAllStaleness` + per-slug calls for multi-KB refresh
- **No algorithmic regressions**: Changes maintain O(n) complexity where applicable
- **Removing Bash from agent**: Prevents unexpected process spawns

### Testing
- **Solid test coverage**: `readSidecar` tests cover happy paths, missing files, malformed JSON, wrong types, array filtering
- **Fixtures properly updated**: All test fixtures correctly reflect removal of `category` field
- **New edge cases added**: Including empty-index staleness test

### Architecture
- **Feature KB patterns clean**: Sidecar lifecycle is well-designed for agent handoff
- **Type safety improvements**: `SidecarData` interface is well-defined, proper use of `unknown`
- **Consistency in agent removals**: `category` field removal is thorough across all layers (CJS, TS, agents, skills, tests, fixtures, CLI output)

---

## Summary by Reviewer

| Reviewer | Score | Primary Finding |
|----------|-------|-----------------|
| Security | 9/10 | APPROVED — shell injection fix, Bash removal, boundary validation |
| Performance | 8/10 | APPROVED — staleness caching, no regressions |
| Testing | 8/10 | APPROVED_WITH_CONDITIONS — remove unused import, add primitive test |
| TypeScript | 9/10 | APPROVED_WITH_CONDITIONS — remove unused import only |
| Architecture | 7/10 | CHANGES_REQUESTED — duplicated parsing, sidecar enforcement, utility layer separation |
| Consistency | 8/10 | CHANGES_REQUESTED — CJS string filtering, source guard pattern coverage |
| Complexity | 7/10 | APPROVED_WITH_CONDITIONS — extract shared create/refresh helper |
| Regression | 7/10 | CHANGES_REQUESTED — plan:orch KB index failure, skill instruction mismatch |

---

## Action Plan

### Before Merge (Blocking)
1. Fix plan:orch Phase 12 KB index regression — add post-agent sidecar handling or restore Bash to agent tools
2. Update feature-kb skill to document sidecar pattern instead of Bash command
3. Fix CJS `read-sidecar` to filter non-string array elements, matching TS behavior
4. Consolidate duplicated sidecar parsing — move shared logic to `feature-kb.cjs` and consume from both paths
5. Add sidecar write enforcement in `kb.ts` — check sidecar exists, warn if missing, consider fallback

### Strongly Recommended (Same PR)
6. Remove unused `fsPromises` import from test file
7. Extract shared `runKbAgent` helper to eliminate create/refresh duplication
8. Apply source error guards to remaining hooks for consistency
9. Add test coverage for readSidecar non-object primitive guard
10. Move `readSidecar` to `src/cli/utils/sidecar.ts` for proper layer separation

### Polish (Can Defer)
- Simplify staleness check control flow (minor readability improvement)
- Extract FeatureKbEntry type interface from inline type literal

---

## Notes for Developer

The PR makes strong security and performance improvements. The knowledge base system design is sound. The blocking issues are all about maintaining consistency between multiple implementation layers (TS/CJS) and ensuring that newly-introduced constraints (agent tool restrictions) are properly handled across all invocation paths (CLI, background scripts, orchestration commands). Fix these, and the PR is ready to ship.

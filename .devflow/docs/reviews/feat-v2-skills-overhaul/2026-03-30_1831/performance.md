# Performance Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-30

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Sequential `await` in `migrateShadowOverrides` loop** - `src/cli/commands/init.ts:66-84`
**Confidence**: 82%
- Problem: The `migrateShadowOverrides` function performs sequential `fs.access` and `fs.rename` calls inside a `for...of` loop over `SHADOW_RENAMES` (7 entries). Each iteration issues 1-2 filesystem calls sequentially, totaling up to 14 sequential I/O operations. These are independent per rename entry and could be parallelized.
- Impact: Adds ~7-14ms of sequential filesystem latency to every `devflow init` run. The impact is MEDIUM rather than HIGH because: (1) `SHADOW_RENAMES` is a small fixed array of 7 entries, (2) `devflow init` is an infrequent CLI command (not a hot path), and (3) `fs.access`/`fs.rename` on local filesystem are fast operations.
- Fix: Use `Promise.all` with `map` to parallelize the independent rename checks:
```typescript
export async function migrateShadowOverrides(devflowDir: string): Promise<{ migrated: number; warnings: string[] }> {
  const shadowsRoot = path.join(devflowDir, 'skills');
  const warnings: string[] = [];

  const results = await Promise.all(
    SHADOW_RENAMES.map(async ([oldName, newName]) => {
      const oldShadow = path.join(shadowsRoot, oldName);
      const newShadow = path.join(shadowsRoot, newName);
      try {
        await fs.access(oldShadow);
        try {
          await fs.access(newShadow);
          warnings.push(`Shadow '${oldName}' found alongside '${newName}' — keeping '${newName}', old shadow at ${oldShadow}`);
          return 0;
        } catch {
          await fs.rename(oldShadow, newShadow);
          return 1;
        }
      } catch {
        return 0;
      }
    })
  );

  return { migrated: results.reduce((sum, n) => sum + n, 0), warnings };
}
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Regex construction inside triple-nested loop** - `tests/skill-references.test.ts:726` (Confidence: 68%) — Inside a triple-nested loop (files x old-names x lines), a `new RegExp(...)` is constructed per matching line. At typical test sizes this is negligible, but pre-compiling the regex map before the loop would be marginally cleaner. Test-only code; no runtime impact.

- **Repeated `readFileSync` in test assertions** - `tests/skill-references.test.ts` (Confidence: 62%) — Multiple test cases independently read the same files (e.g., `reviewer.md`, `CLAUDE.md`, plugin manifests). In test code this is acceptable since Vitest runs tests sequentially within a file and the OS caches file reads. No action needed.

- **`collectTsFiles` uses synchronous `readdirSync`/`statSync` recursion** - `tests/skill-references.test.ts:604-616` (Confidence: 60%) — Recursive directory walk using sync I/O. Acceptable in test infrastructure scoped to the small `tests/` directory. Would matter if applied to a large source tree at runtime.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Rationale

This PR is predominantly a skill-rename refactor: 7 skills renamed from verbose forms (`core-patterns`, `test-patterns`, etc.) to shorter names (`software-design`, `testing`, etc.), with corresponding updates across 143 files (agents, plugins, commands, tests, docs). The bulk of the diff is markdown skill content being restructured and enriched with academic citations. There is no new runtime hot-path code introduced.

The single blocking MEDIUM finding (sequential `await` in `migrateShadowOverrides`) is a minor optimization opportunity in a cold CLI path. The function is correct, handles edge cases well, and runs only during `devflow init`. The condition for approval is acknowledging this is a minor inefficiency rather than requiring an immediate fix.

Known pitfall PF-006 (per-line jq spawning in session-start hooks) is not reintroduced by this PR. No other pitfall patterns overlap with the changed files.

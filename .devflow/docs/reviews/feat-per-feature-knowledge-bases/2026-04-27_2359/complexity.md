# Complexity Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Structural duplication between `create` and `refresh` command handlers** - `src/cli/commands/kb.ts:375-467`, `src/cli/commands/kb.ts:476-574`
**Confidence**: 85%
- Problem: The `create` (~93 lines) and `refresh` (~99 lines) command handler closures share a near-identical pattern: validate slug, check claude CLI, get worktree path, build sidecar path, delete pre-existing sidecar, build prompt string, spawn `execFileSync('claude', ...)`, call `readSidecar`, call `featureKb.updateIndex`, clean up sidecar, handle errors. The structural duplication inflates both handlers past the 50-line warning threshold and makes each harder to follow than necessary. While the prompts differ, the ceremony around them (sidecar lifecycle, index update, error handling) is copy-pasted.
- Fix: Extract a shared helper such as `runKbAgent(opts: { worktreePath, slug, name, directories, prompt, sidecarName, fallbackRefs? })` that encapsulates the sidecar lifecycle (pre-clean, spawn, readSidecar, updateIndex, post-clean, error handling). Each command handler would then reduce to ~20-30 lines of prompt construction + calling the helper.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`FeatureKbModule.listKBs` return type is a single-line 160+ character type literal** - `src/cli/commands/kb.ts:48`
**Confidence**: 82%
- Problem: The inline type `Array<{ slug: string; name: string; directories: string[]; lastUpdated: string; referencedFiles?: string[]; description?: string; createdBy?: string }>` spans roughly 160 characters in a single line. This was already present with the `category` field; the diff removed `category` and added `referencedFiles`, `description`, and `createdBy`, making the inline type slightly longer. This hurts readability and makes the interface declaration harder to scan.
- Fix: Extract to a named interface (e.g., `FeatureKbEntry`) at the top of the file, alongside the existing `SidecarData` interface, and reference it in `FeatureKbModule`.

```typescript
interface FeatureKbEntry {
  slug: string;
  name: string;
  directories: string[];
  lastUpdated: string;
  referencedFiles?: string[];
  description?: string;
  createdBy?: string;
}

interface FeatureKbModule {
  listKBs: (worktreePath: string) => FeatureKbEntry[];
  // ...
}
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`json-helper.cjs` is 1859 lines — a monolith CLI dispatcher** - `scripts/hooks/json-helper.cjs`
**Confidence**: 85%
- Problem: The file contains a single giant `switch` statement dispatching 15+ operations. Adding `read-sidecar` (the new case) is individually clean (~15 lines), but it further grows a file already well past the 500-line CRITICAL threshold for file length. Each new case makes the file harder to navigate and reason about.
- Impact: Not blocking because this is a pre-existing structural issue. The new `read-sidecar` case itself is well-scoped.

**`kb.ts` is 607 lines total** - `src/cli/commands/kb.ts`
**Confidence**: 82%
- Problem: The file exceeds the 500-line warning threshold for file length. It contains 6 subcommand handlers (enable/disable/status, list, check, create, refresh, remove) plus shared utilities. The handlers for `create` and `refresh` are the primary contributors. This is a pre-existing concern that the diff does not materially worsen.

## Suggestions (Lower Confidence)

- **Repeated sidecar cleanup pattern** - `src/cli/commands/kb.ts:407,455,460,520,563,567` (Confidence: 70%) -- The `try { await fs.unlink(sidecarPath); } catch {}` one-liner appears 6 times across the create and refresh handlers (pre-clean, post-success, post-error). A tiny `async function cleanSidecar(path: string)` would reduce noise.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 2 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The primary complexity concern is the structural duplication between the `create` and `refresh` command handlers -- they follow an identical sidecar-lifecycle pattern that could be extracted into a shared helper, reducing both handlers from ~95 lines to ~25 lines each. The changes themselves (removing `category`, adding `readSidecar`, hardening source guards) are individually clean and actually simplify the data model. The `readSidecar` function is well-structured with clear early returns and proper type narrowing. The new tests are thorough and well-organized. No knowledge entries from KNOWLEDGE_CONTEXT are directly applicable to the complexity findings in this diff.

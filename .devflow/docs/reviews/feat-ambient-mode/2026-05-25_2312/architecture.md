# Architecture Review Report

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Dual-source content duplication between `COMMANDS_RULE_CONTENT` and `shared/rules/commands.md`** - `src/cli/commands/ambient.ts:26-52`
**Confidence**: 82%
- Problem: The `COMMANDS_RULE_CONTENT` constant in `ambient.ts` is a full verbatim copy of `shared/rules/commands.md`. Although the new test (`tests/ambient.test.ts:383-389`) guards against drift, there are now two sources of truth for the same content. Updating the rule requires editing both files and relying on CI to catch forgetting one. This is a shallow module pattern — the string constant hides no complexity and adds duplication.
- Fix: Read `shared/rules/commands.md` from disk at runtime (or at build time) rather than maintaining an inline copy. A build-time approach fits the existing `npm run build:plugins` pattern that distributes skills/agents from `shared/` to plugins:

```typescript
// Option A: read at build-time, embed as generated const (preferred — zero runtime I/O)
// scripts/build-plugins.ts could generate a commands-rule-content.ts from the shared file.

// Option B: read at runtime (simpler, negligible perf cost for a CLI)
import { readFileSync } from 'fs';
import { resolve } from 'path';
const SHARED_RULES_DIR = resolve(__dirname, '../../shared/rules');
export const COMMANDS_RULE_CONTENT = readFileSync(
  resolve(SHARED_RULES_DIR, 'commands.md'), 'utf-8'
);
```

The test that guards drift is a good stopgap — this is not blocking — but the architectural direction should be single-source.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`devflowDir` resolution heuristic in `ambientCommand` action is fragile** - `src/cli/commands/ambient.ts:233-246`
**Confidence**: 80%
- Problem: The `devflowDir` is inferred by parsing the first Stop hook's command path and navigating `../../..` relative to the binary. This couples the ambient command to an internal convention of how other hooks happen to be formatted. If the Stop hook structure changes, or a user's settings has a differently-shaped Stop hook first, this silently resolves to the wrong directory. This is a Feature Envy / Law of Demeter smell — reaching deep into another subsystem's data shape.
- Fix: Consider a dedicated resolution function (e.g., the already-available `getDevFlowDirectory()`) as the primary source, with the hook-path extraction as a validated fallback:

```typescript
devflowDir = getDevFlowDirectory();
// Only fallback to hook-path inference if getDevFlowDirectory() fails
```

The current code already falls back to `getDevFlowDirectory()` in the catch, but attempts the fragile heuristic first, inverting the priority.

## Suggestions (Lower Confidence)

- **Unbounded growth of `LEGACY_SKILL_NAMES` array** - `src/cli/plugins.ts:300-523` (Confidence: 65%) -- The array has grown to 180+ entries across version boundaries. Consider a structured registry (version-keyed map) or periodic pruning per the existing "entries can be removed after 2 major versions" comment. applies ADR-001 (clean break philosophy supports aggressive pruning).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | - | 0 | 1 | 0 |
| Pre-existing | - | 0 | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED

The changes demonstrate good architectural judgment:
- Extraction of `installCommandsRule()` and `removeCommandsRule()` as named, documented helpers improves SRP (applies ADR-001 — no unnecessary compat layer, just clean helper extraction).
- The narrowed ENOENT catch in `removeCommandsRule` avoids swallowing unrelated filesystem errors — correct defense-in-depth.
- The `filterHookEntries` utility now correctly tracks both classification and prompt removal, eliminating a subtle bug where stale classification hooks were silently ignored in the return value.
- Legacy skill name additions to `LEGACY_SKILL_NAMES` follow the established clean-break pattern (applies ADR-001) — add names for cleanup, don't add migration code.
- Test mocking of filesystem operations properly isolates unit tests from side effects.

No blocking architectural issues. The dual-source content issue is a mild DRY concern mitigated by the new drift-detection test. The `devflowDir` resolution priority is pre-existing and non-critical.

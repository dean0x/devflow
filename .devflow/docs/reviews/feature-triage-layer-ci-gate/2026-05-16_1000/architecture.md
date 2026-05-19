# Architecture Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-16

## Issues in Your Changes (BLOCKING)

### HIGH

**Context hook utilities defined in init.ts break Single Responsibility** - `src/cli/commands/init.ts:103-186`
**Confidence**: 85%
- Problem: The `addContextHook`, `removeContextHook`, and `hasContextHook` functions are defined directly in `init.ts` (a 1409-line command module) rather than in a dedicated module. Every other hook feature follows the pattern of a dedicated command module (`ambient.ts`, `memory.ts`, `learn.ts`, `decisions.ts`, `knowledge/index.ts`) that exports its add/remove/has functions, with `init.ts` importing and re-exporting them. The context hook breaks this established pattern: it is the only hook whose utilities live inside `init.ts`. This creates a circular-like import concern where `uninstall.ts` imports `removeContextHook` from `./init.js` -- coupling uninstall to the init command module instead of a focused hook-utility module.
- Impact: Violates SRP (init.ts now has two reasons to change: the init command flow AND the context hook utility functions). Creates an inconsistent dependency direction: `uninstall.ts -> init.ts` for a utility function, while all other hook utilities flow from dedicated modules. Future maintainers adding a `devflow context --enable/--disable/--status` command would need to extract these functions or create the circular dependency they avoided everywhere else.
- Fix: Extract to a dedicated `src/cli/commands/context.ts` module following the exact same pattern as `memory.ts`, `learn.ts`, `decisions.ts`, etc. Then import from there in both `init.ts` and `uninstall.ts`. The module is small (3 functions, ~80 lines) and fits the established pattern exactly.

```typescript
// src/cli/commands/context.ts — new file following the memory.ts / learn.ts pattern
import * as path from 'path';
import type { Settings, HookMatcher } from '../utils/hooks.js';

const CONTEXT_HOOK_MARKER = 'session-start-context';

export function addContextHook(settingsJson: string, devflowDir: string): string { /* ... */ }
export function removeContextHook(settingsJson: string): string { /* ... */ }
export function hasContextHook(input: string | Settings): boolean { /* ... */ }
```

### MEDIUM

**Sentinel management code in init.ts is structurally repetitive (4 consecutive blocks)** - `src/cli/commands/init.ts:1227-1269`
**Confidence**: 82%
- Problem: Four nearly-identical sentinel management blocks at the end of init's action handler each follow the same pattern: check `gitRoot`, compute sentinel path, enable removes sentinel, disable creates directory + writes sentinel. The only variation is the sentinel path string. This duplication increases init.ts's already-large size and creates a maintenance risk -- adding a new sentinel-guarded feature requires copy-pasting the block.
- Impact: init.ts is already 1409 lines. Each sentinel block adds ~10 lines of repetitive code. If the sentinel management pattern changes (e.g., writing a timestamp instead of empty file, or adding error logging), all 4 blocks must be updated in lockstep. The knowledge, decisions, memory, and learning sentinels all use identical logic.
- Fix: Extract a small pure helper and call it 4 times.

```typescript
// Could live in a utils/sentinel.ts or inline in init.ts
async function manageSentinel(gitRoot: string | null, sentinelPath: string, enabled: boolean): Promise<void> {
  if (!gitRoot) return;
  const fullPath = path.join(gitRoot, sentinelPath);
  if (enabled) {
    try { await fs.unlink(fullPath); } catch { /* doesn't exist */ }
  } else {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, '', 'utf-8');
  }
}

// Usage:
await manageSentinel(gitRoot, '.features/.disabled', knowledgeEnabled);
await manageSentinel(gitRoot, '.memory/decisions/.disabled', decisionsEnabled);
await manageSentinel(gitRoot, '.memory/.working-memory-disabled', memoryEnabled);
await manageSentinel(gitRoot, '.memory/.learning-disabled', learnEnabled);
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**init.ts is a 1409-line god module** - `src/cli/commands/init.ts`
**Confidence**: 85%
- Problem: `init.ts` combines the init command handler (900+ lines of interactive prompts and installation logic), plugin selection parsing, safe-delete classification, migration orchestration, and now context hook utilities. The single action handler alone spans from line 251 to line 1409 (~1158 lines). Per the architecture skill's detection patterns, modules above 500 lines with multiple public utility functions are god-class candidates.
- Impact: Cognitive load for developers modifying any single feature within init. The file already has 10+ re-exports from other modules, indicating it functions as both a command and a utility barrel. Adding the context hook utilities (this PR) extends this pattern further.
- Fix: Long-term, the init command's action handler could be decomposed into phases: prompt collection, installation execution, settings configuration, and sentinel management. Each phase could be a pure function or small module. The sentinel extraction suggested above and the context hook module extraction would be first steps.

## Suggestions (Lower Confidence)

- **Decisions manifest reconciliation gated by learning sentinel, not decisions sentinel** - `scripts/hooks/session-start-context:38-41` (Confidence: 72%) -- The comment says "Reconcile decisions manifest (still done here even if decisions disabled -- manifest is learning's)" which implies an intentional design choice, but the coupling between learning and decisions manifest reconciliation is architecturally subtle. If learning is disabled but decisions is enabled, the decisions manifest will not be reconciled. This may be correct per the data ownership model but warrants a code comment explaining the downstream effect.

- **Dual gating on decisions scanner (shell + CJS)** - `scripts/hooks/stop-update-memory:104`, `scripts/hooks/decisions-usage-scan.cjs:29-30` (Confidence: 65%) -- The decisions scanner is now checked for the `.disabled` sentinel in two places: once in the calling shell script (`stop-update-memory`) and once in the CJS script itself. The shell-level gate makes the CJS-level gate redundant for the normal call path. This is likely defense-in-depth (the CJS script could be called directly), but it creates two locations to keep in sync if the sentinel path changes.

- **No dedicated `devflow context` CLI subcommand** - `src/cli/commands/init.ts` (Confidence: 62%) -- The context hook is always-on and has no user-facing enable/disable/status command, unlike every other hook feature (memory, learn, decisions, knowledge, ambient). While the always-on nature may justify this, users who see `session-start-context` in their settings.json have no obvious CLI path to understand or manage it. A minimal `devflow context --status` would complete the pattern.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The extraction of cross-feature context from `session-start-memory` into `session-start-context` is a sound architectural move -- it correctly separates concerns so that disabling memory does not disable context injection. The sentinel-based disable pattern is well-applied across all hooks with consistent shell idioms. The PR applies ADR-001 (no migration/compat code) cleanly -- no backward-compatibility shims were introduced (avoids PF-001).

The main architectural concern is that the context hook utilities break the established module-per-hook-feature pattern by living in `init.ts` instead of a dedicated module. This is a moderate coupling issue that is straightforward to fix by extracting ~80 lines into `context.ts`. The sentinel code repetition is a secondary concern that becomes more pressing as sentinel-guarded features grow.

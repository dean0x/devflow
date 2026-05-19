# Performance Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-16

## Issues in Your Changes (BLOCKING)

No CRITICAL or HIGH performance issues found in the changed lines.

### MEDIUM

**Duplicate sentinel file checks across memory hooks (4 occurrences)** -- Confidence: 82%
- `scripts/hooks/prompt-capture-memory:26`, `scripts/hooks/stop-update-memory:40`, `scripts/hooks/background-memory-update:26`, `scripts/hooks/pre-compact-memory:25`
- Problem: Each memory hook independently checks `[ -f "$CWD/.memory/.working-memory-disabled" ]` via a stat syscall. When all four hooks fire in a single session cycle (UserPromptSubmit + Stop + PreCompact + background), that is four redundant filesystem stat() calls for the same sentinel file. Similarly, `session-start-context` checks both `.learning-disabled` and `decisions/.disabled` independently from the hooks that also check them.
- Impact: On hot paths (every prompt + every stop), these add ~4 stat() calls per cycle. On local SSDs this is sub-millisecond total, making this LOW actual impact -- but it violates the principle of measuring I/O on request paths.
- Fix: Acceptable as-is. Sentinel file checks are O(1) stat() operations that the OS page cache handles efficiently. The hooks run in separate shell processes, so there is no practical way to share state between them. This is the correct design for process-isolated shell hooks.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Node.js fallback spawns two separate processes for commands and skills formatting** -- `scripts/hooks/session-start-context:95-102`
**Confidence**: 83%
- Problem: When jq is unavailable, the learned behaviors section spawns two sequential `node -e` processes to format commands and skills separately. Each Node.js process startup costs ~30-50ms, so this path adds ~60-100ms of latency to session start.
- Impact: Only affects users without jq installed (the jq path is fast). The PR description does not claim to change this behavior -- it is moved code from `session-start-memory`, not new logic. However, this is an optimization opportunity in code you touched.
- Fix: Combine into a single `node -e` invocation that outputs both values:
```bash
# Single node process for both values (saves ~30-50ms startup)
read -r LEARNED_COMMANDS LEARNED_SKILLS <<< $(echo "$LEARNED_JSON" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const cmds = d.commands.map(c => '/self-learning/' + c.name + ' (' + c.conf + ')').join(', ');
  const skills = d.skills.map(s => s.name + ' (' + s.conf + ')').join(', ');
  console.log(cmds + '\t' + skills);
" 2>/dev/null)
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Sequential node process spawns in session-start-context manifest reconciliation** -- `scripts/hooks/session-start-context:35,40`
**Confidence**: 85%
- Problem: Lines 35 and 40 each spawn `node "$_JSON_HELPER" reconcile-manifest` sequentially -- two separate Node.js process invocations for learning and decisions manifest reconciliation. Each Node.js cold start costs ~30-50ms, adding ~60-100ms to every session start when both manifests exist.
- Impact: This runs once per session start, not per prompt. Tolerable latency, but could be combined into a single `json-helper.cjs` invocation that reconciles both manifests in one process.
- Fix: Add a `reconcile-all-manifests` subcommand to `json-helper.cjs` that accepts multiple manifest paths and reconciles them in a single Node.js process invocation. This would save one cold start (~30-50ms) per session start.

### LOW

**String concatenation pattern for CONTEXT assembly** -- `scripts/hooks/session-start-context:62-72,139-145`
**Confidence**: 80%
- Problem: The CONTEXT variable is built through repeated string concatenation with conditional newline insertion. In bash, each concatenation creates a new string copy. For the small sizes involved (TL;DR lines and learned behavior summaries are typically under 1KB), this is negligible.
- Impact: Negligible. Bash string operations on sub-1KB strings are effectively instant.
- Fix: No fix needed. The pattern is appropriate for the data sizes involved.

## Suggestions (Lower Confidence)

- **Parallel sentinel checks in init.ts** -- `src/cli/commands/init.ts:1250-1269` (Confidence: 65%) -- The four sentinel management blocks (knowledge, decisions, memory, learning) each do sequential `fs.unlink`/`fs.writeFile`. These could be batched with `Promise.all` since they target independent files, saving a few milliseconds during init.

- **getGitRoot() called per subcommand in learn.ts and memory.ts** -- `src/cli/commands/learn.ts:390,934,951` and `src/cli/commands/memory.ts:298` (Confidence: 70%) -- `getGitRoot()` is called multiple times within the same command execution (once in --status, again in --enable/--disable). The result could be computed once and reused. Impact is minimal since `git rev-parse --show-toplevel` is fast.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | - | 1 | 1 |

**Performance Score**: 8/10
**Recommendation**: APPROVED

The changes are primarily structural (extracting cross-feature context injection into a dedicated hook) and add sentinel-based early-exit guards that improve performance by short-circuiting disabled hooks before any meaningful work. The sentinel file checks (`[ -f ... ] && exit 0`) are the lightest possible gate -- a single stat() syscall that returns immediately. The new `session-start-context` hook faithfully moves existing code from `session-start-memory` without introducing new bottlenecks. The Node.js fallback path (two process spawns instead of one) is the only actionable optimization, and it only affects users without jq.

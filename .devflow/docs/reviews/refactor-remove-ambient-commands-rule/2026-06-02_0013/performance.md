# Performance Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**Date**: 2026-06-02_0013
**PR**: #233

## Scope

Focused review of whether the unconditional `removeLegacyCommandsRule` call on
every `addAmbientHook` / `removeAmbientHook` (i.e. every `devflow ambient
--enable/--disable` and `devflow init`) introduces meaningful overhead.

**Verdict**: No meaningful overhead. The added work is a single `fs.unlink`
syscall — one async I/O operation, no directory scans, no loops, no synchronous
blocking I/O. The PR author's own assessment ("a single unlink — likely
negligible") is correct.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None.

## Suggestions (Lower Confidence)

- **Redundant double `unlink` during `init`** — `src/cli/commands/init.ts:1131-1132` (Confidence: 90%) — When ambient is enabled, init calls `removeAmbientHook` (line 1131, which calls `removeLegacyCommandsRule`) immediately followed by `addAmbientHook` (line 1132, which calls it again). The legacy file is already gone after the first call, so the second `fs.unlink` always hits ENOENT and is swallowed. Cost is one wasted syscall per init — truly negligible, not worth restructuring the clean remove-then-add upgrade flow to avoid. Noted only for completeness.

## Performance Analysis Detail

Verified against current code at `src/cli/commands/ambient.ts:65-73`:

```ts
export async function removeLegacyCommandsRule(): Promise<void> {
  try {
    await fs.unlink(COMMANDS_RULE_PATH);
  } catch {
    // swallow all errors — best-effort cleanup
  }
}
```

Performance characteristics of the added hot-path work:

| Concern | Finding |
|---------|---------|
| Directory scans | None — `COMMANDS_RULE_PATH` is a fixed precomputed path (`ambient.ts:21`); no `readdir`/glob/walk. |
| Loops | None — single `unlink`, not invoked inside any iteration. |
| Synchronous/blocking I/O | None — uses `fs.promises.unlink` (async), does not block the event loop [3][16]. |
| I/O cost | One filesystem metadata operation. SSD unlink latency ~100µs [7]; ENOENT path (file already absent, the steady-state case) returns even faster without touching data blocks. |
| Allocation | None significant — no buffers read, no JSON parsed by this function. |

The call placement (`addAmbientHook:107`, `removeAmbientHook:128`) runs once per
invocation, before the early-return. These functions execute only during
interactive CLI commands (`devflow ambient`, `devflow init`) — not in any
request path, hook hot path, or per-turn loop. A single sub-millisecond syscall
on an interactive CLI operation that already performs `readFile` + `writeFile`
of `settings.json` is immeasurable relative to existing work.

Cross-cycle awareness: PRIOR_RESOLUTIONS Cycle 1 fixed items (fail-safe error
handling, README count, fabricated citation) are not performance-related and
were not re-raised; current code at `ambient.ts:65-73` confirms the fail-safe
catch is present.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 10
**Recommendation**: APPROVED

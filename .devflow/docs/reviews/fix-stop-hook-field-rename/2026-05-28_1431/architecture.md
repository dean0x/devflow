# Architecture Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

(none)

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Implicit orchestrator contract via shell global namespace** - `scripts/hooks/sidecar-evaluate:112-116`
**Confidence**: 82%
- Problem: The eval-* modules (`eval-reinforce`, `eval-learning`, `eval-decisions`, `eval-knowledge`) depend on a large set of orchestrator-scoped variables communicated through the shell's global namespace (e.g., `LEARNING_ENABLED`, `TRANSCRIPT`, `SIDECAR_DIR`, `_HAS_JQ`, `MARKER_SUFFIX`, `NOW`, `TODAY`, and functions like `log()`, `dbg()`, `sidecar_lock_acquire()`). The only enforcement is fail-fast `: "${VAR:?}"` guards at the top of each module. While each module documents its required variables in a header comment, there is no compile-time or structural contract -- a missed variable in the orchestrator produces a runtime crash rather than a clear contract violation. This is inherent to the `source`-based module system in bash and is partially mitigated by the `?` guards, but the surface area is large (eval-learning alone requires 12 orchestrator-provided names).
- Impact: Adding a new eval-* module or modifying the orchestrator namespace risks silently breaking existing modules if a variable is renamed or removed. The fail-fast guards catch missing variables at runtime but do not prevent accidental shadowing or type misuse (e.g., setting `NOW` to a non-numeric value).
- Fix: This is a known trade-off of the bash `source` decomposition pattern. The current mitigation (fail-fast guards + header comments) is adequate for the scope. No structural change recommended -- just ensure that any new module added to this family follows the same `: "${VAR:?}"` + header comment convention. Consider adding a comment in `sidecar-evaluate` listing all exported names for module consumers (a "contract manifest" comment block).

## Pre-existing Issues (Not Blocking)

### MEDIUM

**dbg() function redefinition pattern creates a subtle coupling contract** - `scripts/hooks/debug-trace:56-58`, `scripts/hooks/debug-trace:72-74`
**Confidence**: 82%
- Problem: `devflow_debug_init` and `devflow_debug_set_cwd` both redefine the global `dbg()` function as a side effect. Every hook must define `dbg() { :; }` as a safe no-op fallback _before_ sourcing `hook-bootstrap`, and then `hook-bootstrap` calls `devflow_debug_init` which overwrites it. Later, `devflow_debug_set_cwd` overwrites it again to point to a different log file. This is a "function slot" pattern where the contract is implicit: callers must pre-define the slot, and the sourced file fills it. If a hook fails to pre-define `dbg`, it gets the previously-defined version from the shell environment (or an error under `set -e`).
- Impact: Low in practice -- the pattern is consistently applied across all 7 hooks. But it means the debug system's architecture relies on a global mutation protocol rather than an explicit interface. The applies ADR-007 decision explicitly chose this single-global-toggle design, and the consistency of the pattern across all hooks limits risk.
- Fix: No change needed. The pattern is appropriate for bash and is consistently applied. Document that `dbg() { :; }` is mandatory before `hook-bootstrap` (already done in the `hook-bootstrap` header comment).

## Suggestions (Lower Confidence)

- **eval-learning deep nesting** - `scripts/hooks/eval-learning:74-136` (Confidence: 68%) -- The lock-acquisition path in eval-learning reaches 6 levels of nesting (if enabled + if deep + if not capped + if count >= batch + if lock acquired + if count >= batch again). While each level is semantically justified (guard checks), the depth makes the control flow harder to trace. Consider extracting the inner lock-held block into a separate sourced helper if this module grows further.

- **Duplicated jq/node dual-path pattern** - `scripts/hooks/eval-learning:101-116`, `scripts/hooks/eval-decisions:54-68`, `scripts/hooks/eval-knowledge:48-61` (Confidence: 65%) -- Each eval-* module independently implements the `if _HAS_JQ then jq else node` marker-writing pattern with near-identical structure. This is a conscious trade-off (each module's JSON shape differs slightly), but if a fourth marker type is added, consider extracting a shared `write_marker` helper into `eval-helpers` that accepts field arguments.

- **sidecar-capture feedback-loop guard ordering differs from sidecar-evaluate** - `scripts/hooks/sidecar-capture:19-21` vs `scripts/hooks/sidecar-evaluate:17-19` (Confidence: 62%) -- `sidecar-capture` places its feedback-loop guards _after_ `hook-bootstrap` sourcing, while `sidecar-evaluate` places them _before_. The comment on sidecar-evaluate says "before hook-bootstrap to minimize background session overhead." The inconsistency is intentional per the prior resolution cycle (sidecar-capture needs SCRIPT_DIR set first), but the architectural rationale could be documented more clearly.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED

## Architectural Assessment

This PR executes two well-structured architectural changes:

**1. Sidecar-evaluate decomposition (applies ADR-007, avoids PF-006)**

The monolithic ~400-line `sidecar-evaluate` script has been decomposed into an orchestrator + 5 sourced modules (`eval-helpers`, `eval-reinforce`, `eval-learning`, `eval-decisions`, `eval-knowledge`). This is a clean application of SRP -- each module has one reason to change (its specific feature evaluation). The orchestrator retains shared setup (CWD resolution, config reading, transcript discovery, session depth check) and delegates feature-specific logic to modules.

The decomposition correctly maintains the `source`-based composition pattern already established in the codebase (hooks source `json-parse`, `sidecar-lock`, `get-mtime`, etc.). The new `hook-bootstrap` and `hook-log-init` helpers extract the two most duplicated setup sequences (debug init + log init) into reusable modules, reducing boilerplate across all 7 hooks.

**2. Debug tracing system (applies ADR-007)**

The `debug-trace` shared helper implements a two-phase logging architecture (global pre-CWD, per-project post-CWD) that maps cleanly to the hook lifecycle: hooks don't know their project context until they parse the JSON input and validate CWD. The `devflow debug` CLI command follows the established `applyFlags`/`stripFlags` pure-function pattern from `flags.ts`, keeping I/O at the edges and logic testable.

**3. Stop hook field rename (avoids PF-006)**

The `response_text` to `last_assistant_message` fix and `stop_reason` guard removal are minimal, targeted changes that directly address the field rename documented in PF-006. The fix is appropriately scoped -- no speculative changes.

**Cross-cycle note**: The prior resolution cycle fixed 10 of 11 issues (eval-reinforce prefix, fail-fast guards, EXIT trap helper, hook-log-init stat cascade, sidecar-evaluate dbg annotations, guard ordering, CWD validation, test names, readDebugStatus test, load_existing_ids tests). All fixes are present in the current diff. The single deferred item (Node fallback in load_existing_ids) remains correctly deferred as a pre-existing bounded concern.

**Dependency direction**: All dependencies point inward -- eval-* modules depend on the orchestrator's namespace; the orchestrator does not depend on module internals. `hook-bootstrap` depends on `debug-trace`; hooks depend on `hook-bootstrap`. No circular dependencies. The CLI `debug.ts` depends only on `paths.ts` utilities. Clean layering throughout.

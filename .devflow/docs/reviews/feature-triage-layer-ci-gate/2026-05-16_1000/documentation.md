# Documentation Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-16

## Issues in Your Changes (BLOCKING)

### HIGH

**Hook count inconsistency: "Five" hooks but "all four" check sentinel** - `CLAUDE.md:44`
**Confidence**: 85%
- Problem: The Working Memory paragraph opens with "Five shell-script hooks (`scripts/hooks/`) provide automatic session continuity" but then says "all four memory hooks check this sentinel." The 5th hook is `session-start-context`, which is explicitly described as "always-on" and cross-feature, not a memory hook. Counting it as one of the "five shell-script hooks" that "provide automatic session continuity" conflates two distinct concerns and will confuse readers trying to understand memory's scope. Five scripts check `.working-memory-disabled` (including `background-memory-update`, a spawned script), but only four are registered hooks. The paragraph mixes "shell-script hooks" (5 registered hooks including context) with "memory hooks" (4 registered hooks) without clarifying the distinction.
- Fix: Either revert to "Four shell-script hooks" (the memory hooks) and describe session-start-context separately as a cross-feature hook, or keep "Five" but add a clarifying parenthetical: "Five shell-script hooks (four memory hooks plus one always-on cross-feature hook)..."

### MEDIUM

**Missing `decisions/.disabled` sentinel from `.memory/` file tree** - `CLAUDE.md:154-160`
**Confidence**: 88%
- Problem: This PR adds sentinel file listings to the `.memory/` file tree (`.working-memory-disabled` at line 154, `.learning-disabled` at line 155) and references `decisions/.disabled` in the narrative at line 44 ("sections internally gated by `decisions/.disabled` and `.learning-disabled` sentinels respectively"). However, the `decisions/` subdirectory listing at lines 158-160 only shows `decisions.md` and `pitfalls.md` — it omits `decisions/.disabled`. The implementation confirms the sentinel exists: `session-start-context:46` checks `$CWD/.memory/decisions/.disabled`. All three sentinel files should be documented in the file tree for consistency.
- Fix: Add `.disabled` to the `decisions/` subtree:
```
└── decisions/
    ├── .disabled              # Runtime sentinel — decisions sections in session-start-context skip if present
    ├── decisions.md           # Architectural decisions (ADR-NNN, append-only)
    └── pitfalls.md            # Known pitfalls (PF-NNN, area-specific gotchas)
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Decisions agent paragraph lacks sentinel documentation** - `CLAUDE.md:52`
**Confidence**: 82%
- Problem: The Learning agent paragraph (line 50) was updated in this PR to add "Runtime sentinel: `.memory/.learning-disabled` ..." but the Decisions agent paragraph (line 52) was not updated with analogous sentinel documentation. The decisions agent uses `decisions/.disabled` as its sentinel (confirmed in `session-start-context:46` and `stop-update-memory:104`), and this PR introduces sentinel documentation as a pattern across the other paragraphs. Omitting the decisions sentinel creates an inconsistency where readers see sentinel docs for memory and learning but not for decisions.
- Fix: Add a sentinel sentence to the Decisions agent paragraph similar to the Learning agent pattern: "Runtime sentinel: `.memory/decisions/.disabled` — the decisions sections in `session-start-context` skip if present; `devflow decisions --enable` removes it, `devflow decisions --disable` creates it."

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Feature knowledge `referencedFiles` dropped `reliability.md`** - `.features/index.json:23-24` (Confidence: 65%) — The `shared/rules/reliability.md` file still exists on disk but was removed from `referencedFiles` in the cli-rules feature knowledge index entry. If the file is still relevant to the cli-rules knowledge base, the reference should remain for accurate staleness detection.

- **README demo block two-line format may confuse** - `README.md:26-27` (Confidence: 62%) — The demo output changed from one line (`Devflow: IMPLEMENT/ORCHESTRATED`) to two lines (`Devflow: IMPLEMENT. Loading: devflow:implement:triage.` / `Scope: ORCHESTRATED`). This is more accurate to the new triage flow, but the indentation on line 27 may not render well in all markdown viewers inside a code block.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Documentation Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The core documentation updates (sentinel system, session-start-context extraction, ci-status-gate marker rename) are well done and accurately reflect the implementation. The `SYNC:` to `PATTERN:` rename is consistent across all 4 files. The session-start-context hook behavior matches the code. However, the "Five hooks" / "four hooks" contradiction in the Working Memory paragraph, the missing `decisions/.disabled` from the file tree, and the asymmetric sentinel documentation (present for memory and learning, absent for decisions) reduce clarity. The ci-status-gate documentation changes ("proceed to next phase" instead of "proceed to Phase 8", "global budget, see step 6" instead of "max 10 iterations") are correct and consistent across `implement:orch`, `resolve:orch`, `resolve.md`, and `resolve-teams.md`. The KNOWLEDGE.md additions (manifest features catalog, `kb → knowledge` gotcha citing ADR-001) are accurate and well-placed — applies ADR-001.

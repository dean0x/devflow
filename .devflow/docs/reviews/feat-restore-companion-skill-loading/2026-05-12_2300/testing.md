# Testing Review Report

**Branch**: feat-restore-companion-skill-loading -> main
**Date**: 2026-05-12

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**No tests validate companion skill consistency between orch skills, commands, and skill-catalog** - `shared/skills/router/references/skill-catalog.md` + 5 orch skills + 10 commands
**Confidence**: 85%
- Problem: This PR adds companion skill loading instructions to 5 orch skills (`implement:orch`, `debug:orch`, `plan:orch`, `review:orch`, `release:orch`), 10 command files (base + teams variants), and a new "ORCHESTRATED Companion Skills" reference table in `skill-catalog.md`. All three locations must stay in sync -- the skill-catalog table, the orch skill `## Load Companion Skills` sections, and the command `**Load Companion Skills**` lines. Today these are maintained manually across 16 files. The existing `skill-references.test.ts` validates that skill *names* are canonical (exist in `getAllSkillNames()`), and it validates cross-component alignment between reviewer focus areas, code-review commands, and review orch skills. However, no test validates that the *companion skill lists* are consistent across these three surfaces. A future edit to one file could silently desync the others.
- Fix: Add a test to `tests/skill-references.test.ts` (or a new `tests/companion-skills.test.ts`) that:
  1. Parses the ORCHESTRATED Companion Skills table from `shared/skills/router/references/skill-catalog.md`
  2. For each row with non-"(none)" companions, parses the `Load via Skill tool:` line from the corresponding orch skill
  3. For each row with non-"(none)" companions, parses the `Load via Skill tool:` line from each corresponding command file (base + teams)
  4. Asserts all three sources produce the same skill set for each intent

```typescript
// Example test structure:
describe('Companion skill consistency', () => {
  it('orch skill companion lists match skill-catalog table', () => {
    const catalog = parseCatalogTable(catalogContent);
    for (const [intent, expected] of catalog) {
      if (expected === '(none)') continue;
      const orchContent = readFileSync(orchSkillPath(intent), 'utf-8');
      const actual = parseCompanionLine(orchContent);
      expect(actual).toEqual(expected);
    }
  });

  it('command companion lists match skill-catalog table', () => {
    // Same pattern for command files
  });
});
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Phase completion checklist item is not programmatically verifiable** - `shared/skills/debug:orch/SKILL.md:113`, `shared/skills/implement:orch/SKILL.md:245`, and 3 others (Confidence: 65%) -- Each orch skill adds `- [ ] Companion Skills -> loaded (or continued without on failure)` to its Phase Completion Checklist. These checklists are documentation consumed by the LLM orchestrator at runtime, not executable checks. The "continue without it" fallback makes this inherently untestable at the unit level. This is an informational observation, not a deficiency in this PR.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Testing Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The single blocking HIGH finding is about missing regression protection for the new three-surface consistency invariant. The PR itself is correct -- all 16 files are consistent today, and the existing 1411-test suite passes cleanly. However, the project already has strong precedent for structural consistency tests (`skill-references.test.ts` validates 11 different reference formats), and this PR introduces a new invariant (companion skill lists across catalog, orch skills, and commands) that is not yet covered. Adding a consistency test would follow the established pattern and protect against future drift.

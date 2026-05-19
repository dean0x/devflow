# Tests Review Report

**Branch**: feat/ambient-orchestration -> main
**Date**: 2026-03-19

## Overview

This PR introduces agent orchestration for ambient mode: three new orchestration skills (implementation-orchestration, debug-orchestration, plan-orchestration), a remodeled ambient-router (BUILD -> IMPLEMENT, ELEVATE -> ORCHESTRATED), updated integration tests, and modifications to the plugin registry, coder agent, and ambient hook.

### Changed Files (18 total)

**Test files changed (2):**
- `tests/integration/ambient-activation.test.ts` -- Updated intent/depth terminology
- `tests/integration/helpers.ts` -- Updated regex patterns for new classification vocabulary

**New source files (3):**
- `shared/skills/implementation-orchestration/SKILL.md` -- Full agent pipeline for IMPLEMENT/ORCHESTRATED
- `shared/skills/debug-orchestration/SKILL.md` -- Hypothesis-based debug pipeline
- `shared/skills/plan-orchestration/SKILL.md` -- Codebase-oriented plan pipeline

**Modified source files (13):**
- `shared/skills/ambient-router/SKILL.md` -- Major rewrite: three-tier model, scope-based depth classification
- `shared/skills/ambient-router/references/skill-catalog.md` -- Updated skill mapping tables
- `shared/skills/test-driven-development/SKILL.md` -- BUILD -> IMPLEMENT, ELEVATE -> ORCHESTRATED terminology
- `shared/agents/coder.md` -- Added search-first and test-driven-development skills
- `plugins/devflow-ambient/.claude-plugin/plugin.json` -- Added 7 agents and 3 orchestration skills
- `plugins/devflow-ambient/README.md` -- Updated documentation
- `plugins/devflow-ambient/commands/ambient.md` -- Three-tier model with agent orchestration
- `scripts/hooks/ambient-prompt` -- Updated classification preamble with new vocabulary and Skill tool instructions
- `src/cli/commands/ambient.ts` -- Minor description text update
- `src/cli/plugins.ts` -- Updated devflow-ambient plugin registry entry (agents + skills)
- `CHANGELOG.md` -- Release notes
- `CLAUDE.md` -- Updated project docs
- `README.md` -- Updated project docs

---

## Issues in Your Changes (BLOCKING)

### CRITICAL

None found.

### HIGH

**H1: No explicit test for the devflow-ambient plugin's new agents and orchestration skills** - `src/cli/plugins.ts:72-77`
- Problem: The `devflow-ambient` plugin gained 7 agents (`coder`, `validator`, `simplifier`, `scrutinizer`, `shepherd`, `skimmer`, `reviewer`) and 3 new skills (`implementation-orchestration`, `debug-orchestration`, `plan-orchestration`). This is the core structural change of the PR. The existing `tests/build.test.ts` provides *implicit* coverage via its filesystem-scanning tests ("every skill referenced in plugins exists in `shared/skills/`" and "every shared agent referenced in plugins exists in `shared/agents/`"), and `tests/plugins.test.ts` validates structural integrity of all plugins. However, no test explicitly asserts that the `devflow-ambient` plugin declares these specific assets. If someone reverts the plugin.json or removes agents/skills from the registry, the existing tests would only catch missing files -- not missing declarations.
- Impact: The central change of this PR (ambient mode gaining agent orchestration capability) has no targeted regression test. A revert of the plugin registry changes would go undetected by existing tests.
- Fix: Add an explicit test in `tests/plugins.test.ts`:
```typescript
describe('devflow-ambient orchestration', () => {
  it('declares orchestration skills', () => {
    const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
    expect(ambient).toBeDefined();
    expect(ambient!.skills).toContain('ambient-router');
    expect(ambient!.skills).toContain('implementation-orchestration');
    expect(ambient!.skills).toContain('debug-orchestration');
    expect(ambient!.skills).toContain('plan-orchestration');
  });

  it('declares agents for orchestration pipelines', () => {
    const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
    expect(ambient).toBeDefined();
    expect(ambient!.agents).toContain('coder');
    expect(ambient!.agents).toContain('validator');
    expect(ambient!.agents).toContain('simplifier');
    expect(ambient!.agents).toContain('scrutinizer');
    expect(ambient!.agents).toContain('shepherd');
  });
});
```

**H2: Integration test for DEBUG intent can pass with zero assertions** - `tests/integration/ambient-activation.test.ts:50-56`
- Problem: The DEBUG classification test wraps its assertions inside `if (hasClassification(output))`. If the LLM does not emit a classification marker, the test body executes zero `expect()` calls and passes vacuously. Compare this with the IMPLEMENT test (lines 36-48) which has a fallback assertion checking for "test" or "tdd" keywords when classification is absent. The DEBUG test has no such fallback.
- Impact: A complete regression where ambient classification is broken for DEBUG intent would not be caught. The test would silently pass with no assertions verified.
- Fix: Add a fallback assertion to ensure the test always verifies something:
```typescript
it('classifies "fix the auth error" as DEBUG/GUIDED or ORCHESTRATED', () => {
  const output = runClaude('fix the authentication error in the login handler');
  if (hasClassification(output)) {
    expect(extractIntent(output)).toBe('DEBUG');
    expect(['GUIDED', 'ORCHESTRATED']).toContain(extractDepth(output));
  }
  // Fallback: DEBUG prompts should produce substantive diagnostic output
  expect(output.length).toBeGreaterThan(20);
});
```

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**S1: Integration test helper functions duplicate the classification regex pattern three times** - `tests/integration/helpers.ts:40,55,63`
- Problem: `hasClassification`, `extractIntent`, and `extractDepth` each define their own regex with the classification vocabulary (`IMPLEMENT|DEBUG|REVIEW|PLAN|EXPLORE|CHAT` and `QUICK|GUIDED|ORCHESTRATED`). This PR updated all three regexes correctly (BUILD -> IMPLEMENT, ELEVATE -> ORCHESTRATED), demonstrating that vocabulary changes propagate to three separate locations. A future vocabulary change requires editing three lines instead of one.
- Impact: Maintenance burden. If a new intent or depth is added, forgetting to update one of the three regexes would create a subtle test failure.
- Fix: Define the pattern once and derive all functions from it:
```typescript
const CLASSIFICATION_PATTERN =
  /ambient:\s*(IMPLEMENT|DEBUG|REVIEW|PLAN|EXPLORE|CHAT)\s*\/\s*(QUICK|GUIDED|ORCHESTRATED)/i;

export function hasClassification(output: string): boolean {
  return CLASSIFICATION_PATTERN.test(output);
}

export function extractIntent(output: string): string | null {
  const match = output.match(CLASSIFICATION_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

export function extractDepth(output: string): string | null {
  const match = output.match(CLASSIFICATION_PATTERN);
  return match ? match[2].toUpperCase() : null;
}
```

**S2: No test coverage for the ORCHESTRATED depth path** - `shared/skills/ambient-router/SKILL.md:47`, `tests/integration/ambient-activation.test.ts`
- Problem: The ambient-router now has a significant ORCHESTRATED depth path (Step 5) with three distinct agent pipelines (IMPLEMENT, DEBUG, PLAN). The integration tests only cover QUICK and GUIDED-or-ORCHESTRATED paths -- the IMPLEMENT test (line 40) loosely accepts either depth, and there is no test specifically targeting ORCHESTRATED classification. The most expensive code path in the system (5-6 agent spawns) has no dedicated test.
- Impact: A broken ORCHESTRATED classification or a broken pipeline would not be caught by any test. Since this is the headline feature of the PR, the gap is notable.
- Fix: Add an integration test case. Note that since classification depends on LLM judgment, this test is inherently non-deterministic:
```typescript
it('classifies large-scope refactoring as IMPLEMENT/ORCHESTRATED', () => {
  const output = runClaude(
    'refactor the entire authentication system to use OAuth2 across all modules and update all tests'
  );
  if (hasClassification(output)) {
    expect(extractIntent(output)).toBe('IMPLEMENT');
    // Large scope should trigger ORCHESTRATED, but GUIDED is acceptable from conservative LLM
    expect(['GUIDED', 'ORCHESTRATED']).toContain(extractDepth(output));
  }
});
```

**S3: Coder agent skill additions have no validation test** - `shared/agents/coder.md:5`
- Problem: The Coder agent gained `search-first` and `test-driven-development` in its frontmatter skills list. No test validates that agent frontmatter skill references resolve to real skills. The build test checks that agent *files* exist, but does not parse their content.
- Impact: A typo in the agent frontmatter (e.g., `test-drivn-development`) would silently fail at runtime -- the agent would not load that skill and TDD enforcement would be silently disabled. This class of issue affects all agents but is newly relevant since skills were added in this PR.
- Fix: Add a test in `tests/build.test.ts` that parses agent frontmatter:
```typescript
it('all skill references in agent frontmatter resolve to registered skills', async () => {
  const agentFiles = await fs.readdir(path.join(ROOT, 'shared', 'agents'));
  const allSkills = new Set(getAllSkillNames());
  for (const file of agentFiles) {
    const content = await fs.readFile(
      path.join(ROOT, 'shared', 'agents', file), 'utf-8'
    );
    const skillsMatch = content.match(/^skills:\s*(.+)$/m);
    if (skillsMatch) {
      const skills = skillsMatch[1].split(',').map(s => s.trim());
      for (const skill of skills) {
        expect(
          allSkills.has(skill),
          `agent '${file}' references unregistered skill '${skill}'`
        ).toBe(true);
      }
    }
  }
});
```

### LOW

**S4: IMPLEMENT test loosened depth assertion without explanatory comment** - `tests/integration/ambient-activation.test.ts:40`
- Problem: `expect(['GUIDED', 'ORCHESTRATED']).toContain(extractDepth(output))` accepts either depth for "add a login form with email and password fields". The previous version asserted specifically `GUIDED`. The loosened assertion was presumably needed because the LLM may now classify this prompt as ORCHESTRATED under the new model, but there is no comment explaining the reasoning.
- Impact: Minor readability issue. A future maintainer may not understand why both depths are accepted.
- Fix: Add a brief comment:
```typescript
// LLM may classify small scope as GUIDED or ORCHESTRATED -- both acceptable
expect(['GUIDED', 'ORCHESTRATED']).toContain(extractDepth(output));
```

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**P1: No unit-level tests for the ambient-prompt hook shell script** - `scripts/hooks/ambient-prompt`
- Problem: The hook script has five distinct branches (jq missing, empty CWD, slash commands, single-word prompts, normal prompts) exercised only through manual testing or the integration test suite (which requires a live `claude` CLI). The word count check on line 28-30 uses `wc -w | tr -d ' '` which may behave differently across platforms (some `wc` implementations produce leading whitespace).
- Impact: Edge case regressions in the hook would be caught only by manual testing. The hook is the gateway to all ambient mode functionality.
- Fix: Consider a shell-level test using BATS or a vitest test that invokes the script via `execSync` with mock JSON input.

**P2: CLI command action handler has no unit test coverage** - `src/cli/commands/ambient.ts:111-183`
- Problem: The `action` handler for the `ambient` CLI command contains devflowDir resolution logic (lines 146-161), file I/O operations, and multiple conditional branches (--enable, --disable, --status). The existing `tests/ambient.test.ts` covers only the pure functions (`addAmbientHook`, `removeAmbientHook`, `hasAmbientHook`). The action handler is tested only via manual invocation.
- Impact: The devflowDir resolution logic (extracting path from existing Stop hook command string) is particularly fragile and would benefit from unit testing.
- Fix: Extract the devflowDir resolution logic into a testable pure function.

**P3: Plugin count assertion uses stale magic number** - `tests/plugins.test.ts:121`
- Problem: `expect(DEVFLOW_PLUGINS.length).toBeGreaterThanOrEqual(8)` provides negligible protection. With 17 plugins in the registry, 9 could be accidentally deleted and this assertion would still pass.
- Impact: The assertion provides a false sense of safety. It was originally meaningful (when there were exactly 8 core plugins) but has not been updated as plugins were added.
- Fix: Update to `toBeGreaterThanOrEqual(15)` or use an exact count.

### LOW

**P4: Integration tests are documentation rather than regression guards** - `tests/integration/ambient-activation.test.ts:22`
- Problem: `describe.skipIf(!isClaudeAvailable())` means these tests never run in CI. They serve as executable documentation for how ambient classification should behave, not as automated regression tests.
- Impact: Minimal -- this is an appropriate design choice for LLM-dependent integration tests. The tests provide value during manual development but cannot prevent regressions.

**P5: Integration test helper hardcodes `--model haiku`** - `tests/integration/helpers.ts:25`
- Problem: `runClaude` uses `--model haiku` regardless of what model the user configures for ambient mode. Classification behavior may differ between models.
- Impact: Minimal -- Haiku is appropriate for fast, cheap integration tests. But results may not reflect production behavior with a different model.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | 0 |
| Should Fix | 0 | 0 | 3 | 1 |
| Pre-existing | 0 | 0 | 3 | 2 |

### Key Findings

1. **The PR correctly updated integration test vocabulary** -- `tests/integration/helpers.ts` and `tests/integration/ambient-activation.test.ts` were updated to use `IMPLEMENT` and `ORCHESTRATED` terminology, matching the ambient-router changes.

2. **Three new orchestration skills and seven new agents** added to the `devflow-ambient` plugin have no dedicated test assertions. They are covered only implicitly by filesystem-scanning build tests. An explicit plugin registry test (H1) would provide targeted regression protection.

3. **The DEBUG integration test can pass with zero assertions** (H2). The `if (hasClassification(output))` guard with no fallback creates a vacuous pass scenario.

4. **The ORCHESTRATED depth path** -- the headline feature of this PR -- has no integration test coverage (S2). This is the most expensive code path in the system (5-6 agent spawns).

5. **Agent frontmatter skill references** (S3) are a test blind spot across the entire codebase, newly relevant since skills were added to the Coder agent.

6. **Integration test helpers** duplicate the classification regex three times (S1), creating a maintenance burden demonstrated by this very PR's updates.

**Tests Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The test updates correctly track the vocabulary rename, and the existing build/plugin tests provide implicit coverage for the new skill files and agent references. However, the PR's headline feature (agent orchestration via ORCHESTRATED depth) has no dedicated test, and the two HIGH blocking issues are straightforward to resolve: add an explicit plugin manifest test (H1) and add a fallback assertion to the DEBUG integration test (H2).

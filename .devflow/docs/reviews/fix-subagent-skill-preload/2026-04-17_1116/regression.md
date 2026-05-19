# Regression Review Report

**Branch**: fix-subagent-skill-preload -> main
**Date**: 2026-04-17

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Coder agent silently-fail fallback removed without graceful degradation for optional skills** - `shared/agents/coder.md:56`
**Confidence**: 85%
- Problem: The old coder agent had a line: `If a Read fails (skill not installed), skip it silently and continue.` This allowed the Coder to function even when optional language/ecosystem skills (e.g., `devflow:go`, `devflow:rust`) were not installed. The new version replaces this with: `If a Skill invocation fails, report BLOCKED to the orchestrator with the error and stop.` -- This means the Coder will now hard-block on any missing optional domain skill (e.g., if a Go project user only installed core plugins without `devflow-go`). Previously this was a graceful degradation path.
- Fix: Distinguish between preloaded core skills (frontmatter -- should block on failure) and dynamically-loaded domain skills (Skill tool invocations -- should degrade gracefully). Consider restoring skip-on-failure behavior specifically for the domain skill loading step:
```markdown
2. **First action -- load domain skills**: Before any analysis, invoke the Skill tool for each domain skill matching DOMAIN hint. If a Skill invocation fails, log the missing skill and continue -- domain skills are optional enhancements.
```

### MEDIUM

**Test safety net removed: `totalRefs > 15` assertion for shared agent install paths** - `tests/skill-references.test.ts:246`
**Confidence**: 82%
- Problem: The old test had `expect(totalRefs, 'shared agents should have install path references').toBeGreaterThan(15)` which served as a completeness guard ensuring shared agents collectively maintained at least 15 install path references. This was removed because reviewer.md and coder.md no longer use install path references (they use Skill tool invocations). However, no replacement guard was added to verify those Skill tool invocations exist at the expected density. The remaining loop still validates correctness of any paths found, but no longer validates that paths/references exist at all in agents that need them. This creates a blind spot: if a future change accidentally removes all skill references from an agent, the test would silently pass.
- Fix: Add a replacement assertion that validates the Skill tool invocation references or frontmatter skills are present at expected density:
```typescript
// Replacement guard: agents must declare skills via frontmatter OR reference them via Skill tool
const agentsWithSkillRefs = agentFiles.filter(file => {
  const content = readFileSync(path.join(agentsDir, file), 'utf-8');
  return parseFrontmatterSkills(content).length > 0 || extractInstallPaths(content).length > 0;
});
expect(agentsWithSkillRefs.length, 'most shared agents should declare skills').toBeGreaterThan(8);
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Reviewer agent's dynamic Skill loading is new BLOCKED behavior inconsistent with prior graceful pattern** - `shared/agents/reviewer.md:59`
**Confidence**: 80%
- Problem: The reviewer agent now says: `If the Skill invocation fails, report BLOCKED to the orchestrator with the error and stop.` The old pattern was `Read the pattern skill file for your focus area from the table above` which would fail with a Read error but the reviewer could still attempt analysis with whatever methodology it had. The new hard-block behavior means that if any single focus skill fails to load (e.g., the Skill tool returns an error due to transient issues), the entire reviewer agent stops dead and reports no findings for that focus. In a `/code-review` run with 7-11 parallel reviewers, one reviewer blocking reduces coverage silently. The orchestrator/synthesizer sees a BLOCKED status but has no partial findings to work with.
- Fix: Consider a two-tier approach: preloaded skills (in frontmatter) should block because they are fundamental, but the dynamically loaded focus skill could fail gracefully with a warning in the report header noting degraded analysis.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Designer preloads both mode skills simultaneously** - `shared/agents/designer.md:4-9` (Confidence: 65%) -- The Designer always runs in one mode (gap-analysis OR design-review), but now preloads both mode skills. This doubles the token cost for skill injection into the agent context. Previously only the needed skill was read on demand. This is an intentional trade-off for reliability but could be noted in the cost/benefit assessment.

- **`import.meta.dirname` compatibility** - `tests/integration/helpers.ts:24` (Confidence: 60%) -- The change from `__dirname` to `import.meta.dirname` assumes Node.js >= 21.2 or a bundler that polyfills it. If the test infrastructure runs on older Node, this would break. Low concern since the project appears to use modern ESM tooling.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

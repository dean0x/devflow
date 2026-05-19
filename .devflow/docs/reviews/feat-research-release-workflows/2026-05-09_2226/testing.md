# Testing Review Report

**Branch**: feat/research-release-workflows -> main
**Date**: 2026-05-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing RESEARCH and RELEASE intents in ambient test intent count comment and assertions** - `tests/ambient.test.ts:659`
**Confidence**: 95%
- Problem: The preamble drift detection test has a comment "Must contain all 8 intents" but classification-rules.md now defines 10 intents (RESEARCH and RELEASE were added). More critically, the test only asserts the presence of the original 8 intents (CHAT, EXPLORE, PLAN, IMPLEMENT, REVIEW, RESOLVE, DEBUG, PIPELINE) without checking for RESEARCH or RELEASE. If someone accidentally removes the RESEARCH or RELEASE intent from classification-rules.md, no test would catch it.
- Fix: Update the comment to "Must contain all 10 intents" and add two assertions:
```typescript
// Must contain all 10 intents
expect(rulesContent).toContain('RESEARCH');
expect(rulesContent).toContain('RELEASE');
```

**Integration test alignment regex excludes RESEARCH and RELEASE intents** - `tests/ambient.test.ts:605`
**Confidence**: 95%
- Problem: The `classMatch` regex in the "integration test expectations align with router skill tables" structural validation test uses `(IMPLEMENT|EXPLORE|DEBUG|PLAN|REVIEW|RESOLVE|PIPELINE)` which silently skips any integration test named with RESEARCH or RELEASE intent. This means if integration tests for RESEARCH/RELEASE are added later, their expected skills won't be cross-checked against the router table. The safety net is structurally broken for the new intents.
- Fix: Update the regex to include RESEARCH and RELEASE:
```typescript
const classMatch = name.match(/(IMPLEMENT|EXPLORE|DEBUG|PLAN|REVIEW|RESOLVE|PIPELINE|RESEARCH|RELEASE)\/(GUIDED|ORCHESTRATED)/);
```

**No integration tests for RESEARCH or RELEASE ambient classification** - `tests/integration/ambient-activation.test.ts`
**Confidence**: 90%
- Problem: The ambient-activation integration test file covers GUIDED and ORCHESTRATED tiers for IMPLEMENT, EXPLORE, DEBUG, PLAN, REVIEW, RESOLVE, and PIPELINE, but has no test cases for the new RESEARCH or RELEASE intents. This means the classification of prompts like "research how competitor X handles caching" or "cut a release" has zero test coverage. Every other intent/depth pair has at least one integration test.
- Fix: Add integration tests for RESEARCH and RELEASE (at minimum ORCHESTRATED since both intents route to orch skills):
```typescript
it('RESEARCH/ORCHESTRATED — loads research:orch', async () => {
  const required = ['research:orch'];
  const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
    'research how competitor tools handle plugin distribution and compare approaches',
    (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
  );
  const skills = getSkillInvocations(result);
  console.log(`RESEARCH/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
  if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
  expect(passed).toBe(true);
});

it('RELEASE/ORCHESTRATED — loads release:orch', async () => {
  const required = ['release:orch'];
  const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
    'prepare and publish a new release with changelog generation',
    (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
  );
  const skills = getSkillInvocations(result);
  console.log(`RELEASE/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
  if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
  expect(passed).toBe(true);
});
```

### MEDIUM

**devflow-ambient plugin test does not assert research:orch, release:orch skills or researcher agent** - `tests/plugins.test.ts:203-220`
**Confidence**: 85%
- Problem: The existing test "devflow-ambient declares review/resolve skill dependencies" explicitly asserts that the ambient plugin includes `review:orch`, `resolve:orch`, `pipeline:orch`, and key agents. However, it does not assert the newly added `research:orch`, `release:orch` skills or the `researcher` agent. This creates an asymmetry where removing these new dependencies from the ambient plugin would not be caught by the plugin dependency test. The existing test pattern clearly intends to guard against accidental removal of critical orchestration dependencies.
- Fix: Add assertions to the existing test:
```typescript
// Research and release orchestration skills
expect(ambient!.skills).toContain('research:orch');
expect(ambient!.skills).toContain('release:orch');
// Researcher agent for research workflows
expect(ambient!.agents).toContain('researcher');
```

**No subagent-skill-preload test for the Researcher agent** - `tests/integration/subagent-skill-preload.test.ts`
**Confidence**: 82%
- Problem: The subagent-skill-preload integration test verifies that Simplifier, Scrutinizer, Reviewer, Coder, Designer, and Git agents correctly receive their declared frontmatter skills at spawn time. The new Researcher agent (which preloads worktree-support, apply-decisions, apply-feature-knowledge) has no equivalent test. Every other shared agent with frontmatter skills is covered. This is a pattern consistency gap that means a skill preload regression in the Researcher agent would go undetected.
- Fix: Add a test case:
```typescript
it('Researcher preloads worktree-support, apply-decisions, apply-feature-knowledge', async () => {
  const allPreloads = await spawnAgentAndGetAllPreloads('Researcher', 'research this topic: what testing frameworks exist');
  const expected = ['worktree-support', 'apply-decisions', 'apply-feature-knowledge'];
  expect(
    allPreloads.some((p) => expected.every((s) => p.includes(s))),
    `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
  ).toBe(true);
}, 90000);
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **SHADOW_RENAMES removal of `search-first` -> `research` not covered by a specific test** - `src/cli/plugins.ts:485` (Confidence: 65%) -- The SHADOW_RENAMES consistency test checks that old names appear in LEGACY_SKILL_NAMES and new names appear in getAllSkillNames(). Since `research` was removed from the skill registry, the `['search-first', 'research']` rename was correctly removed (avoids a test failure). However, there is no test that explicitly validates that removed renames are cleaned up. The existing structural tests (SHADOW_RENAMES consistency) implicitly cover this since a stale rename would fail the "new name in getAllSkillNames" check. Low risk. Applies ADR-001 (clean break philosophy).

- **GUIDED RESEARCH and RELEASE routes are not tested at all** - `tests/integration/ambient-activation.test.ts` (Confidence: 70%) -- The router GUIDED table has RESEARCH -> `devflow:research:orch` and RELEASE -> `devflow:git`. Unlike other intents that map to domain skills in GUIDED mode, RESEARCH in GUIDED mode escalates directly to the orch skill, and RELEASE loads only `devflow:git`. These unusual GUIDED mappings have zero integration test coverage. Could add GUIDED-tier tests if the LLM classification boundary between GUIDED and ORCHESTRATED is worth validating for these intents.

- **Synthesizer research mode not unit-tested** - `shared/agents/synthesizer.md` (Confidence: 62%) -- The Synthesizer agent gained a new `research` mode with trust-aware merging logic (trusted > mixed > untrusted weighting, convergent vs divergent finding categorization). The other modes (exploration, planning, review, design) have no dedicated unit tests either, so this is consistent with the existing pattern, but the trust-aware merging is more complex than the other modes.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 4/10
**Recommendation**: CHANGES_REQUESTED

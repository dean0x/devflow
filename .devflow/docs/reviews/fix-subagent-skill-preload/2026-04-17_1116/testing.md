# Testing Review Report

**Branch**: fix-subagent-skill-preload -> main
**Date**: 2026-04-17

## Issues in Your Changes (BLOCKING)

### HIGH

**Integration tests rely on non-deterministic filesystem timing for transcript discovery** - `tests/integration/helpers.ts:231-298`
**Confidence**: 85%
- Problem: `getLatestSubagentPreloadedSkills(since)` finds subagent transcripts by comparing file `mtime` against a `since` timestamp captured via `new Date()` immediately before spawning `claude`. On a loaded machine, the process spawn and transcript write may happen in the same millisecond as `since`, causing the `stat.mtime > since` comparison (strict greater-than, line 255) to miss the transcript. This is a classic off-by-one timing race in test infrastructure.
- Fix: Subtract a small epsilon from `since` to avoid the boundary condition:
  ```typescript
  const since = new Date(Date.now() - 100); // 100ms buffer
  ```
  Alternatively, change the comparison to `>=` — but that risks picking up transcripts from a prior test if they share the same millisecond. The epsilon approach is safer.

**No assertion that `getLatestSubagentPreloadedSkills` actually found a transcript** - `tests/integration/subagent-skill-preload.test.ts:23-96`
**Confidence**: 90%
- Problem: Every test follows the pattern: spawn agent, call `getLatestSubagentPreloadedSkills(since)`, then assert `expect(preloaded).toEqual(expect.arrayContaining([...]))`. If `getLatestSubagentPreloadedSkills` returns `[]` (transcript not found, structure changed, mtime race), `arrayContaining` against an empty array PASSES for any non-empty expected set... wait, no -- `arrayContaining` would FAIL. But the real problem is different: if the function returns `[]` due to an infrastructure failure (Claude CLI not actually spawning the agent, transcript path convention changing), the test failure message would say "expected [] to contain 'software-design'" which is unhelpful for debugging. There is no guard assertion like `expect(preloaded.length).toBeGreaterThan(0)` with a clear message that the transcript was not found.
- Fix: Add a guard assertion at the start of each test (or factor into a helper):
  ```typescript
  expect(preloaded.length, 'No subagent transcript found — check that claude spawned the agent and transcript path convention has not changed').toBeGreaterThan(0);
  ```

**6 of 12 shared agents not covered by integration smoke tests** - `tests/integration/subagent-skill-preload.test.ts`
**Confidence**: 82%
- Problem: The PR adds integration tests for 6 agents (Simplifier, Scrutinizer, Reviewer, Coder, Designer, Git) but omits Evaluator, Resolver, Skimmer, Synthesizer, Tester, and Validator. All 12 agents had their `skills:` frontmatter converted from comma-string to YAML block-list in this PR. The 6 untested agents could silently regress if the block-list format is not parsed correctly at runtime.
- Fix: Either add integration tests for the remaining 6 agents, or add a unit-level test that parses each agent's frontmatter and validates the `skills:` block-list produces the expected skill names (cheaper, faster, no Claude CLI dependency). The existing `parseFrontmatterSkills` utility in `skill-references.test.ts` already does this parsing — a test that cross-references each agent's parsed skills against a known expected set would close this gap without requiring expensive CLI invocations.

### MEDIUM

**`totalRefs` guard removed from shared-agent install-path test without replacement** - `tests/skill-references.test.ts:246-258`
**Confidence**: 85%
- Problem: The original test had `expect(totalRefs).toBeGreaterThan(15)` to ensure reviewer.md and coder.md had install path references (a canary that the test was actually exercising real content). The PR removes this guard because those agents now use Skill tool invocations instead of install paths. But no replacement canary was added. The test now iterates agents and checks each found install path is canonical — but if ALL install paths are removed from ALL agents, the test would pass vacuously (zero iterations, zero assertions).
- Fix: Add a comment explaining the intentional removal, or better: add a complementary test that verifies agents using Skill tool invocations reference valid skill names. The existing frontmatter skills test partly covers this, but a `totalRefs` guard on the new pattern (Skill tool references) would be the direct replacement.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`getLatestSubagentPreloadedSkills` walks ALL session directories without bounding** - `tests/integration/helpers.ts:239-244`
**Confidence**: 80%
- Problem: The function reads every directory under `~/.claude/projects/{encodedPath}/`, then walks into each session's `subagents/` directory. On a developer machine with hundreds of sessions, this does O(sessions) `readdirSync` + `statSync` calls synchronously in the test process. While acceptable for a test helper, this could make tests slow on machines with long histories.
- Fix: Sort session directories by name (they appear to be UUIDs but could contain timestamps) and limit the walk to the most recent N (e.g., 10) directories, since the transcript we want was just created.

## Pre-existing Issues (Not Blocking)

No pre-existing CRITICAL issues found.

## Suggestions (Lower Confidence)

- **Test isolation across parallel runs** - `tests/integration/subagent-skill-preload.test.ts` (Confidence: 65%) — If two test runs execute concurrently against the same project directory, `getLatestSubagentPreloadedSkills` could pick up a transcript from the other run. The `since` timestamp provides some protection, but concurrent spawns within the same second could interfere.

- **Negative test for Skill tool invocation failure** - `shared/agents/coder.md:56`, `shared/agents/reviewer.md:59` (Confidence: 70%) — Both coder.md and reviewer.md now instruct: "If a Skill invocation fails, report BLOCKED." No integration test verifies this failure path. Consider a test with an invalid skill name to verify the BLOCKED behavior.

- **Missing `exactOptionalPropertyTypes` consideration in transcript parsing** - `tests/integration/helpers.ts:277` (Confidence: 60%) — The expression `event.message?.content ?? event.content ?? ''` chains optional accesses that could produce `undefined` if properties exist but are explicitly set to `undefined` vs absent. Low risk since `JSON.parse` never produces `undefined` values, but the typing is loose (`any` from `JSON.parse`).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces a well-structured integration test suite and properly updates the existing `skill-references.test.ts` to match the new YAML block-list format. The test infrastructure helper (`getLatestSubagentPreloadedSkills`) is creative — parsing subagent transcripts from disk to verify preloaded skills. However, three HIGH issues affect test reliability: a timing race in transcript discovery, missing guard assertions that would catch infrastructure failures, and incomplete agent coverage (6/12 agents tested). The removed `totalRefs` canary weakens the existing test suite's ability to detect vacuous passes. These issues risk false-green results that hide real regressions.

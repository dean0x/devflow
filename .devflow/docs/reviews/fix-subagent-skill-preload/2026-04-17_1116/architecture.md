# Architecture Review Report

**Branch**: fix-subagent-skill-preload -> main
**Date**: 2026-04-17

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent skill loading strategy across agents: preload-all vs dynamic Skill tool** - `shared/agents/reviewer.md:59`, `shared/agents/coder.md:56`, `shared/agents/designer.md:5-9`
**Confidence**: 85%
- Problem: The PR introduces two different architectural patterns for skill loading within the same system. The designer agent preloads all mode-specific skills (`gap-analysis`, `design-review`) via frontmatter and treats them as already available. The reviewer and coder agents declare only their base skills in frontmatter but then use `Skill(skill="devflow:{FOCUS}")` as a "first action" runtime call. This creates two fundamentally different contracts: (1) preload everything in frontmatter so skills are always present, vs (2) preload a subset and dynamically load the rest via Skill tool at runtime. The designer has a bounded set of 2 mode skills so preloading works, but the reviewer has 18 possible focus skills and preloading all would be wasteful. The coder similarly loads domain skills dynamically based on a runtime DOMAIN hint. The two approaches are individually justified, but the PR does not document or codify when to use which pattern. A future contributor adding a new agent has no guidance.
- Fix: Add a brief section to the shared agents' documentation (or to `docs/reference/agent-design.md`) codifying the two strategies:
  - **Preload pattern**: Use when the set of skills is small and bounded (e.g., designer's 2 mode skills). Declare all in frontmatter.
  - **Dynamic pattern**: Use when skill selection depends on runtime parameters (e.g., reviewer focus, coder domain). Declare base skills in frontmatter, load domain skills via Skill tool as first action.

### MEDIUM

**Test helper couples to undocumented Claude Code internal path structure** - `tests/integration/helpers.ts:231-299`
**Confidence**: 82%
- Problem: `getLatestSubagentPreloadedSkills()` assumes Claude Code writes subagent transcripts to `~/.claude/projects/-{encoded-project-path}/{sessionId}/subagents/agent-{agentId}.jsonl` with a specific JSONL event schema (`type: 'user'`, `role: 'user'`, `message.content` containing `<command-name>` tags). This is an undocumented internal format. Any Claude Code update that changes transcript paths, encoding, event schema, or tag names would silently break all 6 integration tests. The function returns `[]` on any structural change (silent failure), making broken tests appear to pass vacuously if the assertion is `toEqual(expect.arrayContaining([...]))` on a non-empty expected array (which would actually fail), but the coupling risk remains.
- Fix: Add a comment at the top of `getLatestSubagentPreloadedSkills` documenting the coupling explicitly (e.g., `// COUPLING: Relies on Claude Code internal transcript format as of v1.x. If transcript schema changes, tests will fail with empty preloaded arrays.`). Consider extracting the path encoding and event parsing into named constants/types so the coupling points are visible and updatable in one place.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Reviewer agent has a dual-mechanism skill loading contract** - `shared/agents/reviewer.md:5-8,59`
**Confidence**: 80%
- Problem: The reviewer declares `review-methodology`, `worktree-support`, and `apply-knowledge` in frontmatter (preloaded), then also tells the agent to invoke `Skill(skill="devflow:{FOCUS}")` as its first action (dynamic). The frontmatter preloads 3 skills and the agent dynamically loads 1 more. This works correctly, but it means the reviewer has a split contract: some skills come from frontmatter injection and others from runtime Skill tool calls. If a future contributor adds a skill to frontmatter assuming it will be preloaded and also adds a Skill tool call for the same skill, there is no deduplication mechanism documented. The test in `subagent-skill-preload.test.ts:49-59` only validates the frontmatter-preloaded skills, not the dynamically loaded focus skill.
- Fix: Add a test case that validates the dynamic skill loading path for the reviewer (e.g., spawn a reviewer with a specific focus and verify the focus skill appears in the Skill tool invocation events from `runClaudeStreaming`, not just in the preloaded `<command-name>` tags).

## Pre-existing Issues (Not Blocking)

_None identified at CRITICAL severity._

## Suggestions (Lower Confidence)

- **`getLatestSubagentPreloadedSkills` walks all session directories** - `tests/integration/helpers.ts:240-244` (Confidence: 65%) -- Over time, `~/.claude/projects/{encoded}/` can accumulate hundreds of session directories. Walking all of them on every test invocation is O(sessions * subagents). Consider filtering by directory mtime against `since` before descending into each session.

- **Integration tests lack negative assertion for unexpected extra skills** - `tests/integration/subagent-skill-preload.test.ts` (Confidence: 70%) -- All tests use `expect.arrayContaining([...])` which validates that expected skills are present but does not catch unexpected extra skills being preloaded. If a future change accidentally adds a skill to frontmatter, these tests would still pass. Consider adding `expect(preloaded).toHaveLength(N)` or `toEqual` with an exact set for at least one representative test.

- **Designer preloads both mode skills but only uses one per invocation** - `shared/agents/designer.md:5-9` (Confidence: 72%) -- The designer frontmatter preloads both `gap-analysis` and `design-review` even though each invocation uses exactly one mode. This means every designer invocation pays the token cost for the unused skill. With skills being small markdown files this may be acceptable, but it deviates from the principle of loading only what is needed.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR makes a sound architectural improvement: converting comma-separated skill strings to YAML block-lists for frontmatter, switching from Read-based skill loading to Claude Code's native Skill tool mechanism, and adding integration tests that verify the preload contract. The two skill loading strategies (preload vs dynamic) are both individually valid. The main condition is documenting which strategy to use when, so the codebase does not accumulate ad-hoc agent designs. The test coupling to Claude Code internals is a pragmatic tradeoff for an integration test suite and is acceptable if documented.

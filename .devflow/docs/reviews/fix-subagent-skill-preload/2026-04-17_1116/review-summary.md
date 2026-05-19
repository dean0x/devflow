# Code Review Summary

**Branch**: fix-subagent-skill-preload -> main  
**Date**: 2026-04-17  
**Reviewers**: Architecture, Complexity, Consistency, Performance, Regression, Security, Testing, TypeScript

## Merge Recommendation: CHANGES_REQUESTED

The PR introduces foundational improvements to agent skill loading architecture (YAML block-list frontmatter, Skill tool-based dynamic loading, integration tests) but has **3 blocking issues** that must be resolved:

1. **Regression risk**: Coder and Reviewer agents now hard-block on optional domain/focus skill failures, breaking the graceful degradation pattern
2. **Test reliability**: Three HIGH-severity test infrastructure issues (timing race, missing guards, incomplete coverage)
3. **Inconsistent patterns**: Three different skill-loading strategies across Designer, Reviewer, and Coder with no guidance for future maintainers

These are fixable and should not block—they are conditions on the path to merge.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 5 | 4 | 0 | 9 |
| Should Fix | 0 | 0 | 4 | 0 | 4 |
| Pre-existing | 0 | 0 | 3 | 1 | 4 |

**Total Findings**: 17  
**Blocking Severity**: 5 HIGH + 4 MEDIUM  
**Confidence Boost Applied**: 4 findings boosted by co-review (architecture, consistency, testing, typescript reviews identified same issues)

---

## Blocking Issues

### HIGH Severity (5)

**1. Coder/Reviewer hard-block on optional skill failures** — Confidence: 85%  
`shared/agents/coder.md:56`, `shared/agents/reviewer.md:59`

**Problem**: The PR removes graceful degradation for optional domain/focus skills. The old Coder pattern was "skip silently if skill not installed"; the new pattern is "report BLOCKED and stop". This breaks Coder on projects using unsupported languages (e.g., Go project without devflow-go plugin) and breaks any Reviewer if a focus skill fails to load. In `/code-review`, one failed Reviewer leaves coverage gaps with no partial findings.

**Impact**: REGRESSION - existing workflows will fail on optional skill misses  
**Fix**: Distinguish preloaded core skills (should block) from dynamic domain/focus skills (should degrade). For Coder step 2:
```markdown
2. **Load domain skills**: Invoke Skill tool for each domain skill matching DOMAIN hint.
   If a Skill invocation fails, log the missing skill and continue — domain skills are optional enhancements.
```
Same pattern for Reviewer focus skill loading.

---

**2. Integration tests rely on non-deterministic filesystem timing** — Confidence: 85%  
`tests/integration/helpers.ts:231-298`, `tests/integration/subagent-skill-preload.test.ts:23-96`

**Problem**: `getLatestSubagentPreloadedSkills(since)` uses `stat.mtime > since` (strict greater-than) where `since = new Date()` is captured immediately before spawning `claude`. On loaded machines, the process and transcript write happen within the same millisecond, causing the comparison to miss the file. This is a classic off-by-one race.

**Impact**: Tests may pass or fail based on system load, making CI unreliable  
**Fix**: Subtract small epsilon from `since`:
```typescript
const since = new Date(Date.now() - 100);  // 100ms buffer
```

---

**3. No guard assertion when transcript discovery fails** — Confidence: 90%  
`tests/integration/subagent-skill-preload.test.ts:23-96`

**Problem**: Every test spawns agent and calls `getLatestSubagentPreloadedSkills(since)`, but never asserts that the function actually found a transcript. If the function returns `[]` due to timing, path convention change, or transcript not being created, the test assertion `expect([]).toEqual(expect.arrayContaining(['software-design']))` would fail but the error message doesn't indicate "transcript not found"—it just shows the empty array.

**Impact**: Test failures are cryptic when transcript discovery fails; infrastructure issues hidden in test failure messages  
**Fix**: Add guard at test start:
```typescript
expect(preloaded.length, 'No subagent transcript found').toBeGreaterThan(0);
```

---

**4. Inconsistent skill-loading strategies across agents** — Confidence: 85%  
`shared/agents/designer.md:5-9`, `shared/agents/reviewer.md:59`, `shared/agents/coder.md:56`

**Problem**: Three different patterns introduced in this PR:
- **Designer**: Preloads both mode skills in frontmatter (guaranteed availability)
- **Reviewer**: Declares base skills in frontmatter, dynamically loads focus skill via Skill tool (runtime dependency)
- **Coder**: Declares base skills in frontmatter, dynamically loads domain skills via Skill tool (runtime dependency)

No guidance codifies when to use which pattern. A contributor adding a new agent has no principle to follow.

**Impact**: Inconsistent agent design; future agents will be ad-hoc  
**Fix**: Document canonical patterns in `docs/reference/agent-design.md`:
- **Preload pattern**: Use when skill set is small and bounded (Designer's 2 mode skills)
- **Dynamic pattern**: Use when skill selection depends on runtime parameters (Reviewer's 18 focus areas, Coder's unbounded domains)

---

**5. Coder step 2 label conflicts with step numbering** — Confidence: 82%  
`shared/agents/coder.md:56`

**Problem**: Text reads `2. **First action -- load domain skills**` but "First action" contradicts step number 2. Step 1 is "Orient on branch state". The Reviewer's pattern correctly places dynamic loading at step 1, so this inconsistency confuses execution ordering.

**Impact**: Agent may misinterpret execution sequence  
**Fix**: Change label to `2. **Load domain skills**:` or reorder so skill loading is step 1 (matching Reviewer).

---

### MEDIUM Severity (4)

**1. Deep nesting and high cyclomatic complexity in `getLatestSubagentPreloadedSkills`** — Confidence: 90%  
`tests/integration/helpers.ts:231-299`

**Problem**: 69-line function with 5 levels of nesting depth and cyclomatic complexity 12-13. Per complexity guidelines, nesting >4 is CRITICAL and complexity 10-20 is HIGH.

**Fix**: Extract three focused functions:
```typescript
function findSubagentTranscripts(projectDir: string, since: Date): Array<{ path: string; mtime: Date }> { ... }
function parsePreloadedSkills(transcriptPath: string): string[] { ... }
export function getLatestSubagentPreloadedSkills(since: Date): string[] {
  const transcripts = findSubagentTranscripts(projectDir, since);
  if (transcripts.length === 0) return [];
  transcripts.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return parsePreloadedSkills(transcripts[0].path);
}
```

---

**2. Test helper couples to undocumented Claude Code internal path structure** — Confidence: 82%  
`tests/integration/helpers.ts:231-299`

**Problem**: `getLatestSubagentPreloadedSkills` assumes Claude Code writes transcripts to `~/.claude/projects/-{encoded-path}/{sessionId}/subagents/agent-{agentId}.jsonl` with specific JSONL event schema. This is undocumented internal format. Any Claude Code update that changes paths, encoding, or schema silently breaks all 6 integration tests.

**Fix**: Add coupling documentation comment at function top:
```typescript
// COUPLING: Relies on Claude Code internal transcript format as of v1.x.
// Path: ~/.claude/projects/-{encoded-cwd}/{sessionId}/subagents/agent-*.jsonl
// Event schema: type:'user'|'assistant', role, message.content containing <command-name>
// If Claude Code changes this format, tests return [] and pass vacuously.
```

---

**3. Test helper walks all session directories without bounding** — Confidence: 80%  
`tests/integration/helpers.ts:239-244`

**Problem**: `readdirSync` on `~/.claude/projects/{encodedPath}/` without bounding. On developer machines with hundreds of sessions, this does O(sessions) filesystem calls. Makes tests slow.

**Fix**: Limit walk to recent N directories (the transcript was just created):
```typescript
const sessionDirs = readdirSync(projectDir)
  .map(d => resolve(projectDir, d))
  .filter(d => isDirectory(d))
  .sort()
  .slice(-10);  // Most recent 10 sessions
```

---

**4. 6 of 12 shared agents not covered by integration tests** — Confidence: 82%  
`tests/integration/subagent-skill-preload.test.ts`

**Problem**: PR adds smoke tests for 6 agents (Simplifier, Scrutinizer, Reviewer, Coder, Designer, Git) but omits Evaluator, Resolver, Skimmer, Synthesizer, Tester, Validator. All 12 had frontmatter converted in this PR. Untested agents could silently regress.

**Fix**: Either add integration tests for remaining 6, or add unit test that parses each agent's frontmatter `skills:` block-list and validates it produces expected skill names (faster, cheaper, no CLI dependency). Existing `parseFrontmatterSkills` utility in `skill-references.test.ts` already does the parsing.

---

## Should-Fix Issues (Code You Touched)

### MEDIUM Severity (4)

**1. Reviewer agent has split skill-loading contract** — Confidence: 80%  
`shared/agents/reviewer.md:5-8,59`

**Problem**: Frontmatter preloads 3 skills (review-methodology, worktree-support, apply-knowledge), then instructions also say "invoke Skill tool for focus skill". If a future contributor adds a skill to both frontmatter and Skill tool calls, there's no documented deduplication. Test only validates frontmatter preloads, not dynamic loading path.

**Fix**: Add test case that validates dynamic focus skill loading (spawn reviewer with focus, verify Skill tool invocation in events).

---

**2. Untyped `JSON.parse` results without validation** — Confidence: 85%  
`tests/integration/helpers.ts:106,276`

**Problem**: `JSON.parse(line)` returns `any`, accessed with property chains without type narrowing. Two new instances match PF-010 (known pitfall). While `try/catch` prevents crashes, typos are invisible to compiler.

**Fix**: Define interface and narrow type:
```typescript
const event: unknown = JSON.parse(line);
if (typeof event !== 'object' || event === null) continue;
if (!('type' in event)) continue;
const typed = event as { type: string; message?: { content?: unknown[] } };
```

---

**3. Inconsistent error-handling instructions for Skill tool failures** — Confidence: 80%  
`shared/agents/coder.md:56`, `shared/agents/reviewer.md:59`, `shared/agents/designer.md:40`

**Problem**: Coder and Reviewer say "If Skill invocation fails, report BLOCKED". Designer (preloaded pattern) has no failure-handling instruction. No distinction between required and optional skills.

**Fix**: For Designer, add sentence about preloaded skill failure. For Coder/Reviewer, distinguish core (required) from domain/focus (optional) skills.

---

**4. `hasDevFlowBranding` now identical to `hasClassification`** — Confidence: 90%  
`tests/integration/helpers.ts:206-208`

**Problem**: After this PR's change on line 208, both functions are functionally identical—they join fragments and test against `CLASSIFICATION_PATTERN`. Dead-code smell.

**Fix**: Remove `hasDevFlowBranding` or create alias with JSDoc noting intentional identity.

---

## Pre-existing Issues (Not Blocking)

**MEDIUM**:
- `resolve` identifier shadows imported `resolve` from `path` (helpers.ts:60) — Confusing scope shadowing
- Test `totalRefs > 15` guard removed without replacement — Weakens vacuous-pass detection
- Plugin-local designer.md is duplicate of shared agent (consistency check)

**LOW**:
- Frontmatter field ordering inconsistency in 2 of 12 agents (simplifier.md, skimmer.md) — `model` should precede `skills` in all agents

---

## Action Plan

1. **Fix regression (HIGH)**: Restore graceful degradation for optional domain/focus skills in Coder and Reviewer
2. **Fix test reliability (HIGH)**: Add epsilon buffer to timing race, add guard assertions, extend agent coverage
3. **Fix architecture (HIGH)**: Document skill-loading patterns and fix Coder step numbering
4. **Refactor complexity (MEDIUM)**: Decompose `getLatestSubagentPreloadedSkills` into three functions
5. **Type safety (MEDIUM)**: Validate JSON.parse results and document Claude Code coupling
6. **Code quality (MEDIUM)**: Remove/alias duplicate function, add test for dynamic reviewer skill loading

---

## Summary by Reviewer

| Reviewer | Score | Recommendation | Key Finding |
|----------|-------|-----------------|-------------|
| Architecture | 7/10 | APPROVED_WITH_CONDITIONS | Two skill-loading strategies need codification |
| Complexity | 7/10 | APPROVED_WITH_CONDITIONS | `getLatestSubagentPreloadedSkills` nesting/complexity too high |
| Consistency | 6/10 | CHANGES_REQUESTED | Three different patterns; Coder step label conflicts |
| Performance | 9/10 | APPROVED | Designer dual skill preload has minor overhead, acceptable |
| Regression | 7/10 | CHANGES_REQUESTED | Hard-block behavior breaks optional skill graceful degradation |
| Security | 9/10 | APPROVED | No security concerns identified |
| Testing | 6/10 | CHANGES_REQUESTED | Timing race, missing guards, incomplete coverage |
| TypeScript | 7/10 | APPROVED_WITH_CONDITIONS | Untyped JSON.parse introduces PF-010 pattern twice |

**Overall Consensus**: CHANGES_REQUESTED — Fix blocking regressions and test reliability before merge.

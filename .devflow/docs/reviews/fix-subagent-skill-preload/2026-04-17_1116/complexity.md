# Complexity Review Report

**Branch**: fix/subagent-skill-preload -> main
**Date**: 2026-04-17

## Issues in Your Changes (BLOCKING)

### HIGH

**Deep nesting and high cyclomatic complexity in `getLatestSubagentPreloadedSkills`** - `tests/integration/helpers.ts:231-299`
**Confidence**: 90%
- Problem: This new 69-line function has 5 levels of nesting depth (outer try > for > inner try > for > inner try/if) and an estimated cyclomatic complexity of 12-13. It combines three distinct responsibilities — directory traversal, file filtering by mtime, and transcript parsing — in a single function with 3 nested try/catch blocks. Per the complexity skill severity guidelines, nesting > 4 is CRITICAL territory and complexity 10-20 is HIGH.
- Fix: Extract into three focused functions:
```typescript
function findSubagentTranscripts(projectDir: string, since: Date): Array<{ path: string; mtime: Date }> {
  const sessionDirs = readdirSync(projectDir)
    .map(d => resolve(projectDir, d))
    .filter(d => { try { return statSync(d).isDirectory(); } catch { return false; } });

  const transcripts: Array<{ path: string; mtime: Date }> = [];
  for (const sessionDir of sessionDirs) {
    const subagentsDir = resolve(sessionDir, 'subagents');
    try {
      const files = readdirSync(subagentsDir).filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'));
      for (const file of files) {
        const filePath = resolve(subagentsDir, file);
        const stat = statSync(filePath);
        if (stat.mtime > since) {
          transcripts.push({ path: filePath, mtime: stat.mtime });
        }
      }
    } catch { /* no subagents dir */ }
  }
  return transcripts;
}

function parsePreloadedSkills(transcriptPath: string): string[] {
  const content = readFileSync(transcriptPath, 'utf-8');
  for (const line of content.split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'user' || event.role === 'user') {
        const text = typeof event.message === 'string'
          ? event.message
          : JSON.stringify(event.message?.content ?? event.content ?? '');
        return [...text.matchAll(/<command-name>([\w:/-]+)<\/command-name>/g)]
          .map(m => m[1].replace(/^devflow:/, ''));
      }
    } catch { /* malformed line */ }
  }
  return [];
}

export function getLatestSubagentPreloadedSkills(since: Date): string[] {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const encodedPath = '-' + process.cwd().replace(/\//g, '-').replace(/^-/, '');
  const projectDir = resolve(homeDir, '.claude', 'projects', encodedPath);

  try {
    const transcripts = findSubagentTranscripts(projectDir, since);
    if (transcripts.length === 0) return [];
    transcripts.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return parsePreloadedSkills(transcripts[0].path);
  } catch {
    return [];
  }
}
```

### MEDIUM

**Test file has 6 near-identical test cases with duplicated structure** - `tests/integration/subagent-skill-preload.test.ts:23-96`
**Confidence**: 82%
- Problem: Each of the 6 tests follows the exact same pattern: `const since = new Date()` -> `await runClaudeStreaming(prompt, { timeout: 60000, model: 'haiku' })` -> `getLatestSubagentPreloadedSkills(since)` -> `expect(preloaded).toEqual(expect.arrayContaining([...]))`. The only varying parts are the agent name, the prompt text, and the expected skills. This is a readability/maintainability issue — adding a new agent test requires copy-pasting the entire block.
- Fix: Use a data-driven test table with `it.each`:
```typescript
const agentCases = [
  {
    agent: 'Simplifier',
    prompt: 'simplify this trivial function: function add(a, b) { return a + b; }',
    expected: ['software-design', 'worktree-support'],
    excluded: ['apply-knowledge'],
  },
  {
    agent: 'Scrutinizer',
    prompt: 'evaluate this code: const x = 1;',
    expected: ['quality-gates', 'software-design', 'worktree-support', 'apply-knowledge'],
  },
  // ... remaining cases
] as const;

it.each(agentCases)('$agent preloads expected skills', async ({ agent, prompt, expected, excluded }) => {
  const since = new Date();
  await runClaudeStreaming(
    `Use the Agent tool with subagent_type="${agent}" to ${prompt}. Only spawn the agent, do not do any other work.`,
    { timeout: 60000, model: 'haiku' },
  );
  const preloaded = getLatestSubagentPreloadedSkills(since);
  expect(preloaded).toEqual(expect.arrayContaining([...expected]));
  for (const ex of excluded ?? []) {
    expect(preloaded).not.toContain(ex);
  }
}, 90000);
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`runClaudeStreaming` is 93 lines with nesting depth 4** - `tests/integration/helpers.ts:53-145`
**Confidence**: 80%
- Problem: This pre-existing function was touched (removal of the dead `tool_result` event handler at former lines 129-132) but the function itself remains at 93 lines with 4 levels of nesting (Promise > stdout handler > for loop > if chain). Per complexity guidelines, functions > 50 lines warrant attention and nesting at 3-4 is in warning territory.
- Note: Not blocking — the function was not introduced by this PR and the change was a minor cleanup.

## Suggestions (Lower Confidence)

- **Magic string duplication across test prompts** - `tests/integration/subagent-skill-preload.test.ts` (Confidence: 65%) — The phrase "Only spawn the agent, do not do any other work." appears 6 times; could be a shared constant.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The frontmatter format changes (comma-string to YAML block-list) across 12 agent files are pure formatting with zero complexity impact. The agent instruction changes (Read-based skill loading to Skill tool invocations) are straightforward and reduce cognitive complexity by removing runtime path construction from agent prompts. The one significant complexity concern is the `getLatestSubagentPreloadedSkills` function which exceeds both nesting depth and cyclomatic complexity thresholds — decomposition into focused helpers would bring all metrics into the "good" range. The test duplication is a lower-priority maintainability concern addressable with `it.each`.

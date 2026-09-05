import { describe, it, expect } from 'vitest';
import {
  isClaudeAvailable,
  runClaudeAndWait,
  getSessionSubagentPreloadedSkills,
} from './helpers.js';

/**
 * Spawn an agent by name and return the preloaded skills from all subagent
 * transcripts in the session that was actually spawned.
 *
 * D33 — uses session-scoped transcript scanning: runClaudeAndWait captures the
 * session_id from the JSON result, then getSessionSubagentPreloadedSkills reads
 * only that session's subagents/ directory. Concurrent agents running in the
 * same cwd (e.g., the devflow pipeline's own Code/Validate agents) cannot
 * contaminate the result.
 *
 * Returns string[][] — one skill list per transcript. The caller asserts that
 * at least one transcript contains the expected skills, avoiding a race where
 * Claude spawns auxiliary subagents whose transcript appears alongside the target.
 */
async function spawnAgentAndGetAllPreloads(agentType: string, prompt: string): Promise<string[][]> {
  const result = await runClaudeAndWait(
    `Use the Agent tool with subagent_type="${agentType}" to ${prompt}. Only spawn the agent, do not do any other work.`,
    { timeout: 60000, model: 'haiku', allowedTools: 'Agent' },
  );
  expect(
    result.sessionId,
    `No session_id in claude output for ${agentType} (exit=${result.exitCode}, ${result.durationMs}ms, cwd=${process.cwd()})`,
  ).not.toBeNull();
  const allPreloads = getSessionSubagentPreloadedSkills(result.sessionId!);
  expect(
    allPreloads.length,
    `No subagent transcript found for ${agentType} (sessionId=${result.sessionId}, exit=${result.exitCode}, ${result.durationMs}ms, cwd=${process.cwd()})`,
  ).toBeGreaterThan(0);
  return allPreloads;
}

/**
 * Smoke tests for subagent skill preload via YAML block-list frontmatter.
 *
 * Verifies that skills declared in agent frontmatter are actually injected
 * into the subagent context at spawn time (visible as <command-name> tags
 * in subagent transcripts).
 *
 * Requirements:
 * - `claude` CLI installed and authenticated
 * - Devflow skills and agents installed (`devflow init`)
 *
 * Run: npm run test:integration (not part of `npm test`)
 */
describe.skipIf(!isClaudeAvailable())('subagent skill preload', () => {

  it('Simplify agent preloads software-design and worktree-support', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Simplify', 'reply with one line only — do not create, modify, or delete any file, do not run git: function add(a, b) { return a + b; }');
    const expected = ['software-design', 'worktree-support'];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
    // Simplify agent must NOT have apply-decisions (PR #182 explicit assertion)
    const simplifyTranscript = allPreloads.find((p) => expected.every((s) => p.includes(s)))!;
    expect(simplifyTranscript).not.toContain('apply-decisions');
  }, 90000);

  it('Scrutinize agent preloads quality-gates, software-design, worktree-support, apply-decisions', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Scrutinize', 'reply with one line only — do not create, modify, or delete any file, do not run git: const x = 1;');
    const expected = ['quality-gates', 'software-design', 'worktree-support', 'apply-decisions'];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
  }, 90000);

  it('Review agent preloads review-methodology, worktree-support, apply-decisions', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Review', 'reply with one line only — do not create, modify, or delete any file, do not run git: const y = 2;');
    const expected = ['review-methodology', 'worktree-support', 'apply-decisions'];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
  }, 90000);

  it('Code agent preloads all 8 declared core skills', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Code', 'reply with one line only — do not create, modify, or delete any file, do not run git, do not write any code');
    const expected = [
      'software-design', 'git', 'patterns', 'testing',
      'test-driven-development', 'dependency-research', 'boundary-validation', 'worktree-support',
    ];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
  }, 90000);

  it('Design agent preloads worktree-support, apply-decisions, gap-analysis, design-review', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Design', 'reply with one line only — do not create, modify, or delete any file, do not run git: Add a cache layer.');
    const expected = ['worktree-support', 'apply-decisions', 'gap-analysis', 'design-review'];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
  }, 90000);

  it('Git agent preloads git and worktree-support', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Git', 'Report the current branch name only. Do not run any git command that writes (no commit, add, checkout, push, stash, tag, reset).');
    const expected = ['git', 'worktree-support'];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
  }, 90000);

  it('Research agent preloads worktree-support, apply-decisions, apply-feature-knowledge', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Research', 'reply with one line only naming one testing framework — do not create, modify, or delete any file, do not run git');
    const expected = ['worktree-support', 'apply-decisions', 'apply-feature-knowledge'];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
  }, 90000);
});

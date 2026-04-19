import { describe, it, expect } from 'vitest';
import {
  isClaudeAvailable,
  runClaudeAndWait,
  getAllSubagentPreloadedSkills,
} from './helpers.js';

/**
 * Spawn an agent by name and return ALL subagent transcripts' preloaded skills.
 *
 * Returns string[][] — one skill list per transcript. The caller asserts that
 * at least one transcript contains the expected skills, avoiding a race where
 * Claude spawns auxiliary subagents whose transcript mtime beats the target's.
 */
async function spawnAgentAndGetAllPreloads(agentType: string, prompt: string): Promise<string[][]> {
  const since = new Date();
  const result = await runClaudeAndWait(
    `Use the Agent tool with subagent_type="${agentType}" to ${prompt}. Only spawn the agent, do not do any other work.`,
    { timeout: 60000, model: 'haiku', allowedTools: 'Agent' },
  );
  const allPreloads = getAllSubagentPreloadedSkills(since);
  expect(
    allPreloads.length,
    `No subagent transcript found for ${agentType} (exit=${result.exitCode}, ${result.durationMs}ms, cwd=${process.cwd()})`,
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

  it('Simplifier preloads software-design and worktree-support', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Simplifier', 'simplify this trivial function: function add(a, b) { return a + b; }');
    const expected = ['software-design', 'worktree-support'];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
    // Simplifier must NOT have apply-knowledge (PR #182 explicit assertion)
    const simplifierTranscript = allPreloads.find((p) => expected.every((s) => p.includes(s)))!;
    expect(simplifierTranscript).not.toContain('apply-knowledge');
  }, 90000);

  it('Scrutinizer preloads quality-gates, software-design, worktree-support, apply-knowledge', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Scrutinizer', 'evaluate this code: const x = 1;');
    const expected = ['quality-gates', 'software-design', 'worktree-support', 'apply-knowledge'];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
  }, 90000);

  it('Reviewer preloads review-methodology, worktree-support, apply-knowledge', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Reviewer', 'review this code: const y = 2;');
    const expected = ['review-methodology', 'worktree-support', 'apply-knowledge'];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
  }, 90000);

  it('Coder preloads all 8 declared core skills', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Coder', 'implement a no-op task');
    const expected = [
      'software-design', 'git', 'patterns', 'testing',
      'test-driven-development', 'research', 'boundary-validation', 'worktree-support',
    ];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
  }, 90000);

  it('Designer preloads worktree-support, apply-knowledge, gap-analysis, design-review', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Designer', 'analyze this design: "Add a cache layer."');
    const expected = ['worktree-support', 'apply-knowledge', 'gap-analysis', 'design-review'];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
  }, 90000);

  it('Git agent preloads git and worktree-support', async () => {
    const allPreloads = await spawnAgentAndGetAllPreloads('Git', 'run git status');
    const expected = ['git', 'worktree-support'];
    expect(
      allPreloads.some((p) => expected.every((s) => p.includes(s))),
      `No transcript contains ${expected.join(', ')}. Found: ${JSON.stringify(allPreloads)}`,
    ).toBe(true);
  }, 90000);
});

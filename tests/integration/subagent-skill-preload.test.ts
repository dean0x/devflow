import { describe, it, expect } from 'vitest';
import {
  isClaudeAvailable,
  runClaudeAndWait,
  getLatestSubagentPreloadedSkills,
} from './helpers.js';

/**
 * Spawn an agent by name and return the preloaded skills from its transcript.
 * Asserts that a transcript was actually found before returning.
 */
async function spawnAgentAndGetPreloads(agentType: string, prompt: string): Promise<string[]> {
  const since = new Date();
  const result = await runClaudeAndWait(
    `Use the Agent tool with subagent_type="${agentType}" to ${prompt}. Only spawn the agent, do not do any other work.`,
    { timeout: 60000, model: 'haiku', allowedTools: 'Agent' },
  );
  const preloaded = getLatestSubagentPreloadedSkills(since);
  expect(
    preloaded.length,
    `No subagent transcript found for ${agentType} (exit=${result.exitCode}, ${result.durationMs}ms, cwd=${process.cwd()})`,
  ).toBeGreaterThan(0);
  return preloaded;
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
    const preloaded = await spawnAgentAndGetPreloads('Simplifier', 'simplify this trivial function: function add(a, b) { return a + b; }');
    expect(preloaded).toEqual(expect.arrayContaining(['software-design', 'worktree-support']));
    // Simplifier must NOT have apply-knowledge (PR #182 explicit assertion)
    expect(preloaded).not.toContain('apply-knowledge');
  }, 90000);

  it('Scrutinizer preloads quality-gates, software-design, worktree-support, apply-knowledge', async () => {
    const preloaded = await spawnAgentAndGetPreloads('Scrutinizer', 'evaluate this code: const x = 1;');
    expect(preloaded).toEqual(expect.arrayContaining([
      'quality-gates', 'software-design', 'worktree-support', 'apply-knowledge',
    ]));
  }, 90000);

  it('Reviewer preloads review-methodology, worktree-support, apply-knowledge', async () => {
    const preloaded = await spawnAgentAndGetPreloads('Reviewer', 'review this code: const y = 2;');
    expect(preloaded).toEqual(expect.arrayContaining([
      'review-methodology', 'worktree-support', 'apply-knowledge',
    ]));
  }, 90000);

  it('Coder preloads all 8 declared core skills', async () => {
    const preloaded = await spawnAgentAndGetPreloads('Coder', 'implement a no-op task');
    expect(preloaded).toEqual(expect.arrayContaining([
      'software-design', 'git', 'patterns', 'testing',
      'test-driven-development', 'research', 'boundary-validation', 'worktree-support',
    ]));
  }, 90000);

  it('Designer preloads worktree-support, apply-knowledge, gap-analysis, design-review', async () => {
    const preloaded = await spawnAgentAndGetPreloads('Designer', 'analyze this design: "Add a cache layer."');
    expect(preloaded).toEqual(expect.arrayContaining([
      'worktree-support', 'apply-knowledge', 'gap-analysis', 'design-review',
    ]));
  }, 90000);

  it('Git agent preloads git and worktree-support', async () => {
    const preloaded = await spawnAgentAndGetPreloads('Git', 'run git status');
    expect(preloaded).toEqual(expect.arrayContaining(['git', 'worktree-support']));
  }, 90000);
});

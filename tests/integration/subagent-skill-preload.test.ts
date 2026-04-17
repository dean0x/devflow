import { describe, it, expect } from 'vitest';
import {
  isClaudeAvailable,
  runClaudeStreaming,
  getLatestSubagentPreloadedSkills,
} from './helpers.js';

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
    const since = new Date();
    await runClaudeStreaming(
      'Use the Agent tool with subagent_type="Simplifier" to simplify this trivial function: function add(a, b) { return a + b; }. Only spawn the agent, do not do any other work.',
      { timeout: 60000, model: 'haiku' },
    );
    const preloaded = getLatestSubagentPreloadedSkills(since);
    expect(preloaded.length, 'No subagent transcript found — check Claude Code transcript path format').toBeGreaterThan(0);
    expect(preloaded).toEqual(expect.arrayContaining([
      'software-design', 'worktree-support',
    ]));
    // Simplifier must NOT have apply-knowledge (PR #182 explicit assertion)
    expect(preloaded).not.toContain('apply-knowledge');
  }, 90000);

  it('Scrutinizer preloads quality-gates, software-design, worktree-support, apply-knowledge', async () => {
    const since = new Date();
    await runClaudeStreaming(
      'Use the Agent tool with subagent_type="Scrutinizer" to evaluate this code: const x = 1;. Only spawn the agent, do not do any other work.',
      { timeout: 60000, model: 'haiku' },
    );
    const preloaded = getLatestSubagentPreloadedSkills(since);
    expect(preloaded.length, 'No subagent transcript found — check Claude Code transcript path format').toBeGreaterThan(0);
    expect(preloaded).toEqual(expect.arrayContaining([
      'quality-gates', 'software-design', 'worktree-support', 'apply-knowledge',
    ]));
  }, 90000);

  it('Reviewer preloads review-methodology, worktree-support, apply-knowledge', async () => {
    const since = new Date();
    await runClaudeStreaming(
      'Use the Agent tool with subagent_type="Reviewer" to review this code: const y = 2;. Only spawn the agent, do not do any other work.',
      { timeout: 60000, model: 'haiku' },
    );
    const preloaded = getLatestSubagentPreloadedSkills(since);
    expect(preloaded.length, 'No subagent transcript found — check Claude Code transcript path format').toBeGreaterThan(0);
    expect(preloaded).toEqual(expect.arrayContaining([
      'review-methodology', 'worktree-support', 'apply-knowledge',
    ]));
  }, 90000);

  it('Coder preloads all 8 declared core skills', async () => {
    const since = new Date();
    await runClaudeStreaming(
      'Use the Agent tool with subagent_type="Coder" to implement a no-op task. Only spawn the agent, do not do any other work.',
      { timeout: 60000, model: 'haiku' },
    );
    const preloaded = getLatestSubagentPreloadedSkills(since);
    expect(preloaded.length, 'No subagent transcript found — check Claude Code transcript path format').toBeGreaterThan(0);
    expect(preloaded).toEqual(expect.arrayContaining([
      'software-design', 'git', 'patterns', 'testing',
      'test-driven-development', 'research', 'boundary-validation', 'worktree-support',
    ]));
  }, 90000);

  it('Designer preloads worktree-support, apply-knowledge, gap-analysis, design-review', async () => {
    const since = new Date();
    await runClaudeStreaming(
      'Use the Agent tool with subagent_type="Designer" to analyze this design: "Add a cache layer." Only spawn the agent, do not do any other work.',
      { timeout: 60000, model: 'haiku' },
    );
    const preloaded = getLatestSubagentPreloadedSkills(since);
    expect(preloaded.length, 'No subagent transcript found — check Claude Code transcript path format').toBeGreaterThan(0);
    expect(preloaded).toEqual(expect.arrayContaining([
      'worktree-support', 'apply-knowledge', 'gap-analysis', 'design-review',
    ]));
  }, 90000);

  it('Git agent preloads git and worktree-support', async () => {
    const since = new Date();
    await runClaudeStreaming(
      'Use the Agent tool with subagent_type="Git" to run git status. Only spawn the agent, do not do any other work.',
      { timeout: 60000, model: 'haiku' },
    );
    const preloaded = getLatestSubagentPreloadedSkills(since);
    expect(preloaded.length, 'No subagent transcript found — check Claude Code transcript path format').toBeGreaterThan(0);
    expect(preloaded).toEqual(expect.arrayContaining([
      'git', 'worktree-support',
    ]));
  }, 90000);
});

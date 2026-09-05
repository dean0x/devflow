import { describe, it, expect } from 'vitest';
import {
  isClaudeAvailable,
  runClaudeAndWait,
  getSubagentPreloadResult,
} from './helpers.js';

/**
 * Maximum spawn attempts per agent type. One bounded retry is legitimate
 * mitigation for LLM non-determinism: haiku may occasionally answer the
 * parent prompt directly (exit 0) without calling the Agent tool, leaving
 * no subagents/ directory. A second attempt almost always succeeds.
 *
 * Two attempts total (1 original + 1 retry). Never more.
 */
const MAX_SPAWN_ATTEMPTS = 2;

/**
 * Spawn an agent by name and return the preloaded skills from all subagent
 * transcripts in the session that was actually spawned.
 *
 * Session identity is deterministic: `runClaudeAndWait` generates a UUID before
 * spawning and passes it via `--session-id`. The subagents/ directory is then
 * read by exact path, eliminating the directory-diff race that caused sporadic
 * null session IDs when background Claude processes (e.g., devflow memory worker)
 * created new session directories concurrently.
 *
 * Outcome classification:
 *  - 'no-session-dir': parent answered directly without spawning — retry once.
 *  - 'no-transcripts': subagents/ dir exists but no agent-*.jsonl files — fail.
 *  - 'ok': one or more transcripts found; return them for skill assertion.
 *
 * Returns string[][] — one skill list per transcript. The caller asserts that
 * at least one transcript contains the expected skills, avoiding a race where
 * Claude spawns auxiliary subagents whose transcript appears alongside the target.
 */
async function spawnAgentAndGetAllPreloads(agentType: string, prompt: string): Promise<string[][]> {
  for (let attempt = 1; attempt <= MAX_SPAWN_ATTEMPTS; attempt++) {
    const result = await runClaudeAndWait(
      // Explicit imperative so haiku cannot answer the task itself.
      `You MUST call the Agent tool exactly once with subagent_type="${agentType}" and the prompt below. ` +
      `Do not answer the task yourself. After the agent returns, reply with the single word DONE.\n\n` +
      `Prompt: ${prompt}`,
      { timeout: 60000, model: 'haiku', allowedTools: 'Agent' },
    );

    const preloadResult = getSubagentPreloadResult(result.sessionId);

    if (preloadResult.kind === 'no-session-dir') {
      if (attempt < MAX_SPAWN_ATTEMPTS) {
        // Parent answered directly without spawning — one bounded retry (PF-018: no silent vacuous pass).
        console.warn(
          `[attempt ${attempt}/${MAX_SPAWN_ATTEMPTS}] ${agentType}: parent spawned no subagent ` +
          `(exit=${result.exitCode}, ${result.durationMs}ms). Retrying.\n` +
          `Output tail: ${result.stdoutTail.slice(-400)}`,
        );
        continue;
      }
      expect.fail(
        `${agentType}: parent spawned no subagent after ${MAX_SPAWN_ATTEMPTS} attempts. ` +
        `exit=${result.exitCode}, duration=${result.durationMs}ms.\n` +
        `Output tail (last ${result.stdoutTail.length}B):\n${result.stdoutTail}`,
      );
    }

    if (preloadResult.kind === 'no-transcripts') {
      expect.fail(
        `${agentType}: subagents/ directory exists but contains zero agent-*.jsonl transcripts. ` +
        `sessionId=${result.sessionId}, exit=${result.exitCode}, duration=${result.durationMs}ms.\n` +
        `Output tail (last ${result.stdoutTail.length}B):\n${result.stdoutTail}`,
      );
    }

    return preloadResult.transcripts;
  }

  // Unreachable: loop either returns or calls expect.fail().
  throw new Error('unreachable: MAX_SPAWN_ATTEMPTS loop exited without returning');
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

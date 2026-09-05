/**
 * Unit tests for pure helper functions in tests/integration/helpers.ts.
 *
 * These tests do NOT require the `claude` CLI — they test synchronous, injectable
 * functions with synthesised fixture data. No `describe.skipIf(!isClaudeAvailable())`
 * guard needed here.
 *
 * Fixture shape note (PF-043): JSONL record fields were copied from a real
 * `agent-*.jsonl` line observed under ~/.claude/projects/…/subagents/ on this
 * machine. Only the values are synthetic — the shape (camelCase fields, sessionId
 * in each record, preloadedSkills already parsed) matches what the runtime produces.
 */

import { describe, it, expect } from 'vitest';
import { selectTranscriptsBySession } from './helpers.js';
import type { TranscriptRecord } from './helpers.js';

describe('selectTranscriptsBySession', () => {
  /**
   * Fixture: two transcript records from concurrent sessions.
   *
   * - Record A: spawned session (Simplify agent) with a small skill set.
   * - Record B: contaminating concurrent session (Code agent) with a superset
   *             that includes 'apply-decisions' — the skill the Simplify test
   *             asserts must be absent. This is exactly the contamination that
   *             caused the nondeterministic integration test failure.
   */
  const SPAWNED_SESSION = 'aaa-111-spawned';
  const CONCURRENT_SESSION = 'bbb-222-concurrent';

  const simplifyRecord: TranscriptRecord = {
    path: `/fake/${SPAWNED_SESSION}/subagents/agent-simplify000.jsonl`,
    sessionId: SPAWNED_SESSION,
    preloadedSkills: ['software-design', 'worktree-support'],
  };

  const codeAgentRecord: TranscriptRecord = {
    path: `/fake/${CONCURRENT_SESSION}/subagents/agent-code000.jsonl`,
    sessionId: CONCURRENT_SESSION,
    preloadedSkills: [
      'apply-decisions',
      'apply-feature-knowledge',
      'boundary-validation',
      'dependency-research',
      'git',
      'patterns',
      'software-design',
      'test-driven-development',
      'testing',
      'worktree-support',
    ],
  };

  const allRecords: TranscriptRecord[] = [simplifyRecord, codeAgentRecord];

  it('returns only the transcript from the target session', () => {
    const selected = selectTranscriptsBySession(allRecords, SPAWNED_SESSION);

    expect(selected).toHaveLength(1);
    expect(selected[0]!.sessionId).toBe(SPAWNED_SESSION);
  });

  it('excludes the contaminating concurrent session transcript', () => {
    const selected = selectTranscriptsBySession(allRecords, SPAWNED_SESSION);

    // The Code agent's superset (contains 'apply-decisions') must not appear
    const skills = selected.flatMap((r) => r.preloadedSkills);
    expect(skills).not.toContain('apply-decisions');
  });

  it('the selected transcript contains the expected Simplify skills', () => {
    const selected = selectTranscriptsBySession(allRecords, SPAWNED_SESSION);

    const skills = selected.flatMap((r) => r.preloadedSkills);
    expect(skills).toContain('software-design');
    expect(skills).toContain('worktree-support');
  });

  it('returns empty array when sessionId does not match any record', () => {
    const selected = selectTranscriptsBySession(allRecords, 'nonexistent-session');
    expect(selected).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    const selected = selectTranscriptsBySession([], SPAWNED_SESSION);
    expect(selected).toHaveLength(0);
  });
});

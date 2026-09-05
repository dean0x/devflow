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
import { selectTranscriptsBySession, buildSubagentsPath } from './helpers.js';
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

describe('buildSubagentsPath', () => {
  it('encodes forward slashes in cwd as hyphens and prepends a leading hyphen', () => {
    // PF-043: path encoding must match what Claude Code uses for the project directory.
    // The encoding: replace every '/' with '-', then ensure a leading '-'.
    const result = buildSubagentsPath(
      '/home/user',
      '/Users/dean/Sandbox/devflow',
      'abc12345-1234-1234-1234-abcdef012345',
    );
    expect(result).toBe(
      '/home/user/.claude/projects/-Users-dean-Sandbox-devflow/abc12345-1234-1234-1234-abcdef012345/subagents',
    );
  });

  it('handles a single-segment cwd', () => {
    const result = buildSubagentsPath('/home/user', '/project', 'uuid-1234');
    expect(result).toBe('/home/user/.claude/projects/-project/uuid-1234/subagents');
  });

  it('uses the sessionId verbatim as the directory segment', () => {
    const sessionId = 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';
    const result = buildSubagentsPath('/Users/h', '/p', sessionId);
    expect(result).toContain(sessionId);
    expect(result).toContain('/subagents');
  });
});

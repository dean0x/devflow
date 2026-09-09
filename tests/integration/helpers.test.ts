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
import { buildSubagentsPath } from './helpers.js';

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

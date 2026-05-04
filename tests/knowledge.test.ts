import { describe, it, expect } from 'vitest';
import { addKbHook, removeKbHook, hasKbHook } from '../src/cli/commands/kb.js';

const DEVFLOW_DIR = '/home/user/.devflow';

describe('addKbHook', () => {
  it('adds hook to empty settings', () => {
    const result = addKbHook('{}', DEVFLOW_DIR);
    const parsed = JSON.parse(result);
    expect(parsed.hooks?.SessionEnd).toHaveLength(1);
    expect(parsed.hooks.SessionEnd[0].hooks[0].command).toContain('session-end-kb-refresh');
  });

  it('adds hook with correct run-hook path', () => {
    const result = addKbHook('{}', '/custom/.devflow');
    const parsed = JSON.parse(result);
    expect(parsed.hooks.SessionEnd[0].hooks[0].command).toContain('/custom/.devflow/scripts/hooks/run-hook session-end-kb-refresh');
  });

  it('is idempotent — does not add duplicate', () => {
    const first = addKbHook('{}', DEVFLOW_DIR);
    const second = addKbHook(first, DEVFLOW_DIR);
    const parsed = JSON.parse(second);
    const kbHooks = parsed.hooks.SessionEnd.filter(
      (m: { hooks: Array<{ command: string }> }) =>
        m.hooks.some((h) => h.command.includes('session-end-kb-refresh'))
    );
    expect(kbHooks).toHaveLength(1);
  });

  it('adds alongside existing SessionEnd hooks', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/to/other-hook', timeout: 10 }] },
        ],
      },
    });
    const result = addKbHook(input, DEVFLOW_DIR);
    const parsed = JSON.parse(result);
    expect(parsed.hooks.SessionEnd).toHaveLength(2);
  });

  it('preserves other settings', () => {
    const input = JSON.stringify({ theme: 'dark', model: 'claude-sonnet' });
    const result = addKbHook(input, DEVFLOW_DIR);
    const parsed = JSON.parse(result);
    expect(parsed.theme).toBe('dark');
    expect(parsed.model).toBe('claude-sonnet');
  });

  it('hook entry has correct timeout', () => {
    const result = addKbHook('{}', DEVFLOW_DIR);
    const parsed = JSON.parse(result);
    expect(parsed.hooks.SessionEnd[0].hooks[0].timeout).toBe(10);
    expect(parsed.hooks.SessionEnd[0].hooks[0].type).toBe('command');
  });
});

describe('removeKbHook', () => {
  it('removes KB hook from SessionEnd', () => {
    const withHook = addKbHook('{}', DEVFLOW_DIR);
    const result = removeKbHook(withHook);
    const parsed = JSON.parse(result);
    expect(parsed.hooks).toBeUndefined();
  });

  it('preserves other SessionEnd hooks', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/to/other-hook', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/devflow/scripts/hooks/run-hook session-end-kb-refresh', timeout: 10 }] },
        ],
      },
    });
    const result = removeKbHook(input);
    const parsed = JSON.parse(result);
    expect(parsed.hooks.SessionEnd).toHaveLength(1);
    expect(parsed.hooks.SessionEnd[0].hooks[0].command).toContain('other-hook');
  });

  it('cleans empty hooks object when last hook removed', () => {
    const withHook = addKbHook('{}', DEVFLOW_DIR);
    const result = removeKbHook(withHook);
    const parsed = JSON.parse(result);
    expect(parsed.hooks).toBeUndefined();
  });

  it('is idempotent — removing absent hook returns same JSON', () => {
    const input = JSON.stringify({ theme: 'dark' });
    const result = removeKbHook(input);
    expect(JSON.parse(result)).toEqual(JSON.parse(input));
  });

  it('preserves other hook event types', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/path/preamble', timeout: 5 }] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: '/devflow/scripts/hooks/run-hook session-end-kb-refresh', timeout: 10 }] }],
      },
    });
    const result = removeKbHook(input);
    const parsed = JSON.parse(result);
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(1);
    expect(parsed.hooks.SessionEnd).toBeUndefined();
  });
});

describe('hasKbHook', () => {
  it('returns true when hook present on SessionEnd', () => {
    const withHook = addKbHook('{}', DEVFLOW_DIR);
    expect(hasKbHook(withHook)).toBe(true);
  });

  it('returns false when hook absent', () => {
    expect(hasKbHook('{}')).toBe(false);
  });

  it('returns false when only other SessionEnd hooks exist', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/to/session-end-learning', timeout: 10 }] },
        ],
      },
    });
    expect(hasKbHook(input)).toBe(false);
  });

  it('accepts parsed Settings object', () => {
    const withHook = addKbHook('{}', DEVFLOW_DIR);
    const parsed = JSON.parse(withHook);
    expect(hasKbHook(parsed)).toBe(true);
  });

  it('returns false for empty hooks object', () => {
    expect(hasKbHook(JSON.stringify({ hooks: {} }))).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { addMemoryHooks, removeMemoryHooks, hasMemoryHooks, countMemoryHooks } from '../src/cli/commands/memory.js';

describe('addMemoryHooks', () => {
  it('adds all 3 hook types to empty settings', () => {
    const result = addMemoryHooks('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('stop-update-memory.sh');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-memory.sh');
    expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('pre-compact-memory.sh');
  });

  it('preserves existing hooks (UserPromptSubmit/ambient untouched)', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ambient-prompt.sh' }] }],
      },
    });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('ambient-prompt.sh');
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
  });

  it('is idempotent — calling twice returns identical JSON', () => {
    const first = addMemoryHooks('{}', '/home/user/.devflow');
    const second = addMemoryHooks(first, '/home/user/.devflow');

    expect(second).toBe(first);
  });

  it('adds only missing hooks when partial state (1 hook missing)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory.sh', timeout: 10 }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory.sh', timeout: 10 }] }],
      },
    });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    // Existing hooks preserved
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    // Missing hook added
    expect(settings.hooks.PreCompact).toHaveLength(1);
    expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('pre-compact-memory.sh');
  });

  it('creates hooks object if missing', () => {
    const input = JSON.stringify({ statusLine: { type: 'command' } });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  it('uses correct devflowDir path in command', () => {
    const result = addMemoryHooks('{}', '/custom/path/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop[0].hooks[0].command).toContain('/custom/path/.devflow/scripts/hooks/stop-update-memory.sh');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('/custom/path/.devflow/scripts/hooks/session-start-memory.sh');
    expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('/custom/path/.devflow/scripts/hooks/pre-compact-memory.sh');
  });

  it('preserves other settings (statusLine, env)', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: 'statusline.sh' },
      env: { SOME_VAR: '1' },
    });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine.command).toBe('statusline.sh');
    expect(settings.env.SOME_VAR).toBe('1');
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  it('sets timeout to 10 for all hooks', () => {
    const result = addMemoryHooks('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop[0].hooks[0].timeout).toBe(10);
    expect(settings.hooks.SessionStart[0].hooks[0].timeout).toBe(10);
    expect(settings.hooks.PreCompact[0].hooks[0].timeout).toBe(10);
  });
});

describe('removeMemoryHooks', () => {
  it('removes all 3 hook types', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    const result = removeMemoryHooks(withHooks);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other hooks (UserPromptSubmit)', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ambient-prompt.sh' }] }],
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory.sh' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory.sh' }] }],
        PreCompact: [{ hooks: [{ type: 'command', command: '/path/pre-compact-memory.sh' }] }],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.Stop).toBeUndefined();
    expect(settings.hooks.SessionStart).toBeUndefined();
    expect(settings.hooks.PreCompact).toBeUndefined();
  });

  it('is idempotent — safe to call when not present', () => {
    const input = JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'other.sh' }] }] },
    });
    const result = removeMemoryHooks(input);

    expect(result).toBe(input);
  });

  it('cleans empty hook type arrays', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory.sh' }] }],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('cleans empty hooks object when all arrays removed', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    const result = removeMemoryHooks(withHooks);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('removes only the hooks that exist (partial)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory.sh' }] }],
        // SessionStart and PreCompact already missing
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other settings', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command' },
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory.sh' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory.sh' }] }],
        PreCompact: [{ hooks: [{ type: 'command', command: '/path/pre-compact-memory.sh' }] }],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toEqual({ type: 'command' });
  });
});

describe('hasMemoryHooks', () => {
  it('returns true when all 3 present', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    expect(hasMemoryHooks(withHooks)).toBe(true);
  });

  it('returns false when none present', () => {
    expect(hasMemoryHooks('{}')).toBe(false);
  });

  it('returns false when partial (1 or 2 of 3)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory.sh' }] }],
      },
    });
    expect(hasMemoryHooks(input)).toBe(false);
  });

  it('returns false for non-memory hooks only', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ambient-prompt.sh' }] }],
      },
    });
    expect(hasMemoryHooks(input)).toBe(false);
  });
});

describe('countMemoryHooks', () => {
  it('returns 3 when all present', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    expect(countMemoryHooks(withHooks)).toBe(3);
  });

  it('returns 0 when none present', () => {
    expect(countMemoryHooks('{}')).toBe(0);
  });

  it('returns correct partial count', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory.sh' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory.sh' }] }],
      },
    });
    expect(countMemoryHooks(input)).toBe(2);
  });
});

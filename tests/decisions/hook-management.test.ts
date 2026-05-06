/**
 * Tests for decisions hook management in src/cli/commands/decisions.ts.
 * Mirrors the structure of tests/learn.test.ts for learning hook management.
 */
import { describe, it, expect } from 'vitest';
import {
  addDecisionsHook,
  removeDecisionsHook,
  hasDecisionsHook,
} from '../../src/cli/commands/decisions.js';

const DEVFLOW_DIR = '/home/user/.devflow';

// ---------------------------------------------------------------------------
// addDecisionsHook
// ---------------------------------------------------------------------------

describe('addDecisionsHook', () => {
  it('adds hook to empty settings', () => {
    const result = addDecisionsHook('{}', DEVFLOW_DIR);
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toContain('session-end-decisions');
    expect(settings.hooks.SessionEnd[0].hooks[0].timeout).toBe(10);
  });

  it('is idempotent — does not add duplicate', () => {
    const first = addDecisionsHook('{}', DEVFLOW_DIR);
    const second = addDecisionsHook(first, DEVFLOW_DIR);

    expect(second).toBe(first);
  });

  it('uses the run-hook wrapper with correct marker', () => {
    const result = addDecisionsHook('{}', '/custom/path/.devflow');
    const settings = JSON.parse(result);
    const command = settings.hooks.SessionEnd[0].hooks[0].command;

    expect(command).toContain('/custom/path/.devflow/scripts/hooks/run-hook');
    expect(command).toContain('session-end-decisions');
  });

  it('preserves other settings fields', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: 'statusline.sh' },
      env: { SOME_VAR: '1' },
    });
    const result = addDecisionsHook(input, DEVFLOW_DIR);
    const settings = JSON.parse(result);

    expect(settings.statusLine.command).toBe('statusline.sh');
    expect(settings.env.SOME_VAR).toBe('1');
    expect(settings.hooks.SessionEnd).toHaveLength(1);
  });

  it('adds alongside existing SessionEnd hooks', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [{ hooks: [{ type: 'command', command: 'other-session-end.sh' }] }],
      },
    });
    const result = addDecisionsHook(input, DEVFLOW_DIR);
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionEnd).toHaveLength(2);
  });

  it('adds alongside learning SessionEnd hook', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [{ hooks: [{ type: 'command', command: '/path/to/run-hook session-end-learning' }] }],
      },
    });
    const result = addDecisionsHook(input, DEVFLOW_DIR);
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionEnd).toHaveLength(2);
    const commands = settings.hooks.SessionEnd.flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks.map((h: { command: string }) => h.command));
    expect(commands.some((c: string) => c.includes('session-end-learning'))).toBe(true);
    expect(commands.some((c: string) => c.includes('session-end-decisions'))).toBe(true);
  });

  it('preserves non-SessionEnd hook event types', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop-update-memory' }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'preamble' }] }],
      },
    });
    const result = addDecisionsHook(input, DEVFLOW_DIR);
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.SessionEnd).toHaveLength(1);
  });

  it('returns JSON with trailing newline', () => {
    const result = addDecisionsHook('{}', DEVFLOW_DIR);
    expect(result.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeDecisionsHook
// ---------------------------------------------------------------------------

describe('removeDecisionsHook', () => {
  it('removes decisions hook from SessionEnd', () => {
    const withHook = addDecisionsHook('{}', DEVFLOW_DIR);
    const result = removeDecisionsHook(withHook);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('is idempotent — no-op when hook absent', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop-update-memory' }] }],
      },
    });
    const result = removeDecisionsHook(input);

    expect(result).toBe(input);
  });

  it('preserves other SessionEnd hooks', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: 'other-session-end-hook' }] },
          { hooks: [{ type: 'command', command: '/path/run-hook session-end-decisions' }] },
        ],
      },
    });
    const result = removeDecisionsHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toBe('other-session-end-hook');
  });

  it('cleans empty SessionEnd array and hooks object', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/run-hook session-end-decisions' }] },
        ],
      },
    });
    const result = removeDecisionsHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other hook event types', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'preamble' }] }],
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/run-hook session-end-decisions' }] },
        ],
      },
    });
    const result = removeDecisionsHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.SessionEnd).toBeUndefined();
  });

  it('does not remove the learning hook when removing decisions hook', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/run-hook session-end-learning' }] },
          { hooks: [{ type: 'command', command: '/path/run-hook session-end-decisions' }] },
        ],
      },
    });
    const result = removeDecisionsHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toContain('session-end-learning');
  });
});

// ---------------------------------------------------------------------------
// hasDecisionsHook
// ---------------------------------------------------------------------------

describe('hasDecisionsHook', () => {
  it('returns false for empty settings', () => {
    expect(hasDecisionsHook('{}')).toBe(false);
  });

  it('returns true when hook is present', () => {
    const withHook = addDecisionsHook('{}', DEVFLOW_DIR);
    expect(hasDecisionsHook(withHook)).toBe(true);
  });

  it('returns false after hook is removed', () => {
    const withHook = addDecisionsHook('{}', DEVFLOW_DIR);
    const withoutHook = removeDecisionsHook(withHook);
    expect(hasDecisionsHook(withoutHook)).toBe(false);
  });

  it('returns false when only learning hook is present', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [{ hooks: [{ type: 'command', command: '/path/run-hook session-end-learning' }] }],
      },
    });
    expect(hasDecisionsHook(input)).toBe(false);
  });

  it('accepts parsed Settings object as input', () => {
    const settings = {
      hooks: {
        SessionEnd: [{ hooks: [{ type: 'command', command: '/path/run-hook session-end-decisions' }] }],
      },
    };
    expect(hasDecisionsHook(settings)).toBe(true);
  });

  it('returns false for settings with no hooks', () => {
    const input = JSON.stringify({ env: { FOO: 'bar' } });
    expect(hasDecisionsHook(input)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  addCaptureHooks,
  removeCaptureHooks,
  hasCaptureHooks,
  countCaptureHooks,
} from '../src/cli/commands/capture.js';

describe('addCaptureHooks', () => {
  it('adds all 3 capture hook types to empty settings', () => {
    const result = addCaptureHooks('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('capture-prompt');
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('capture-turn');
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain('capture-question');
  });

  it('scopes the PostToolUse entry with matcher: "AskUserQuestion"', () => {
    const result = addCaptureHooks('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);
    expect(settings.hooks.PostToolUse[0].matcher).toBe('AskUserQuestion');
  });

  it('matcher persists through a JSON settings round-trip', () => {
    const first = addCaptureHooks('{}', '/home/user/.devflow');
    // Simulate a settings.json read/write cycle (JSON.stringify -> disk -> JSON.parse)
    const roundTripped = JSON.stringify(JSON.parse(first));
    const parsed = JSON.parse(roundTripped);
    expect(parsed.hooks.PostToolUse[0].matcher).toBe('AskUserQuestion');
  });

  it('is idempotent — calling twice returns identical JSON', () => {
    const first = addCaptureHooks('{}', '/home/user/.devflow');
    const second = addCaptureHooks(first, '/home/user/.devflow');
    expect(second).toBe(first);
  });

  it('adds only missing hooks when partial state (1 hook missing)', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/path/capture-prompt', timeout: 10 }] }],
        Stop: [{ hooks: [{ type: 'command', command: '/path/capture-turn', timeout: 10 }] }],
      },
    });
    const result = addCaptureHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain('capture-question');
    expect(settings.hooks.PostToolUse[0].matcher).toBe('AskUserQuestion');
  });

  it('preserves existing ambient preamble hook on UserPromptSubmit when adding capture-prompt', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/path/run-hook preamble' }] }],
      },
    });
    const result = addCaptureHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    const commands = settings.hooks.UserPromptSubmit.map((m: { hooks: { command: string }[] }) => m.hooks[0].command);
    expect(commands.some((c: string) => c.includes('preamble'))).toBe(true);
    expect(commands.some((c: string) => c.includes('capture-prompt'))).toBe(true);
  });

  it('creates hooks object if missing', () => {
    const input = JSON.stringify({ statusLine: { type: 'command' } });
    const result = addCaptureHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  it('uses correct devflowDir path in command via run-hook wrapper', () => {
    const result = addCaptureHooks('{}', '/custom/path/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('/custom/path/.devflow/scripts/hooks/run-hook');
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('run-hook');
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain('run-hook');
  });

  it('preserves other settings (statusLine, env)', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: 'statusline.sh' },
      env: { SOME_VAR: '1' },
    });
    const result = addCaptureHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine.command).toBe('statusline.sh');
    expect(settings.env.SOME_VAR).toBe('1');
  });

  it('sets timeout to 10 for all hooks', () => {
    const result = addCaptureHooks('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit[0].hooks[0].timeout).toBe(10);
    expect(settings.hooks.Stop[0].hooks[0].timeout).toBe(10);
    expect(settings.hooks.PostToolUse[0].hooks[0].timeout).toBe(10);
  });
});

describe('removeCaptureHooks', () => {
  it('removes all 3 capture hook types', () => {
    const withHooks = addCaptureHooks('{}', '/home/user/.devflow');
    const result = removeCaptureHooks(withHooks);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves ambient preamble on UserPromptSubmit when removing capture-prompt', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'preamble' }] },
          { hooks: [{ type: 'command', command: '/path/capture-prompt' }] },
        ],
      },
    });
    const result = removeCaptureHooks(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('preamble');
  });

  it('preserves memory-worker on Stop when removing capture-turn (adjacent hook, different module)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/path/capture-turn' }] },
          { hooks: [{ type: 'command', command: '/path/memory-worker' }] },
        ],
      },
    });
    const result = removeCaptureHooks(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('memory-worker');
  });

  it('does not touch legacy dream-dispatch/dream-capture entries — that sweep belongs to memory.ts', () => {
    // capture.ts is a pure always-on registrar (context.ts pattern) with no legacy
    // awareness of its own; the dream-dispatch/dream-capture/dream-evaluate legacy
    // sweep is memory.ts's LEGACY_HOOK_MARKERS responsibility (see memory.test.ts).
    // This test proves removeCaptureHooks coexists safely: it removes only its own
    // current markers and leaves legacy entries untouched for memory.ts to sweep.
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/run-hook dream-dispatch', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook capture-prompt', timeout: 10 }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: '/path/run-hook dream-capture', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook capture-turn', timeout: 10 }] },
        ],
      },
    });
    const result = removeCaptureHooks(input);
    const settings = JSON.parse(result);

    // Only the current capture-* markers are removed
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('dream-dispatch');
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('dream-capture');
  });

  it('is idempotent — safe to call when not present', () => {
    const input = JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'other.sh' }] }] },
    });
    const result = removeCaptureHooks(input);

    expect(result).toBe(input);
  });

  it('cleans empty hooks object when all arrays removed', () => {
    const withHooks = addCaptureHooks('{}', '/home/user/.devflow');
    const result = removeCaptureHooks(withHooks);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('accepts a parsed Settings object and does not mutate the original', () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command' as const, command: '/path/capture-turn', timeout: 10 }] }],
      },
    };
    const result = removeCaptureHooks(settings);
    const parsed = JSON.parse(result);
    expect(parsed.hooks).toBeUndefined();
    // Original must be unchanged
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  it('toggle cycle: enable → disable → enable produces clean state', () => {
    const enabled = addCaptureHooks('{}', '/home/user/.devflow');
    const disabled = removeCaptureHooks(enabled);
    const reEnabled = addCaptureHooks(disabled, '/home/user/.devflow');
    const settings = JSON.parse(reEnabled);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].matcher).toBe('AskUserQuestion');
  });
});

describe('hasCaptureHooks / countCaptureHooks', () => {
  it('hasCaptureHooks returns true when all 3 present', () => {
    const withHooks = addCaptureHooks('{}', '/home/user/.devflow');
    expect(hasCaptureHooks(withHooks)).toBe(true);
    expect(countCaptureHooks(withHooks)).toBe(3);
  });

  it('hasCaptureHooks returns false when none present', () => {
    expect(hasCaptureHooks('{}')).toBe(false);
    expect(countCaptureHooks('{}')).toBe(0);
  });

  it('returns false/partial-count when only 2 of 3 present', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/path/capture-prompt' }] }],
        Stop: [{ hooks: [{ type: 'command', command: '/path/capture-turn' }] }],
      },
    });
    expect(hasCaptureHooks(input)).toBe(false);
    expect(countCaptureHooks(input)).toBe(2);
  });

  it('accepts a parsed Settings object (not just JSON string)', () => {
    const settings = {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command' as const, command: '/path/capture-prompt', timeout: 10 }] }],
        Stop: [{ hooks: [{ type: 'command' as const, command: '/path/capture-turn', timeout: 10 }] }],
        PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command' as const, command: '/path/capture-question', timeout: 10 }] }],
      },
    };
    expect(countCaptureHooks(settings)).toBe(3);
    expect(hasCaptureHooks(settings)).toBe(true);
  });
});

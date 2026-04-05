import { describe, it, expect } from 'vitest';
import {
  addHudStatusLine,
  removeHudStatusLine,
  hasHudStatusLine,
  hasNonDevFlowStatusLine,
} from '../src/cli/commands/hud.js';

describe('addHudStatusLine', () => {
  it('adds statusLine to empty settings', () => {
    const result = addHudStatusLine('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeDefined();
    expect(settings.statusLine.type).toBe('command');
    expect(settings.statusLine.command).toContain('hud.sh');
    expect(settings.statusLine.command).toContain('/home/user/.devflow');
  });

  it('uses correct devflowDir path', () => {
    const result = addHudStatusLine('{}', '/custom/path/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine.command).toBe(
      '/custom/path/.devflow/scripts/hud.sh',
    );
  });

  it('is idempotent — does not duplicate', () => {
    const first = addHudStatusLine('{}', '/home/user/.devflow');
    const second = addHudStatusLine(first, '/home/user/.devflow');

    expect(second).toBe(first);
  });

  it('preserves other settings', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }],
      },
      env: { SOME_VAR: '1' },
    });
    const result = addHudStatusLine(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.env.SOME_VAR).toBe('1');
    expect(settings.statusLine.command).toContain('hud.sh');
  });

  it('replaces existing Devflow statusline.sh with HUD', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/old/path/statusline.sh' },
    });
    const result = addHudStatusLine(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine.command).toContain('hud.sh');
    expect(settings.statusLine.command).not.toContain('statusline.sh');
  });
});

describe('removeHudStatusLine', () => {
  it('removes HUD statusLine', () => {
    const withHud = addHudStatusLine('{}', '/home/user/.devflow');
    const result = removeHudStatusLine(withHud);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeUndefined();
  });

  it('removes legacy statusline.sh', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/path/statusline.sh' },
    });
    const result = removeHudStatusLine(input);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeUndefined();
  });

  it('does not remove non-Devflow statusLine', () => {
    const input = JSON.stringify({
      statusLine: {
        type: 'command',
        command: '/some/other/tool/status.sh',
      },
    });
    const result = removeHudStatusLine(input);

    expect(result).toBe(input);
  });

  it('is idempotent — safe when no statusLine', () => {
    const input = JSON.stringify({ hooks: {} });
    const result = removeHudStatusLine(input);

    expect(result).toBe(input);
  });

  it('preserves other settings', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/path/hud.sh' },
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }],
      },
    });
    const result = removeHudStatusLine(input);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeUndefined();
    expect(settings.hooks.Stop).toHaveLength(1);
  });
});

describe('hasHudStatusLine', () => {
  it('returns true when HUD is present', () => {
    const withHud = addHudStatusLine('{}', '/home/user/.devflow');
    expect(hasHudStatusLine(withHud)).toBe(true);
  });

  it('returns true for legacy statusline.sh', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/path/statusline.sh' },
    });
    expect(hasHudStatusLine(input)).toBe(true);
  });

  it('returns false when absent', () => {
    expect(hasHudStatusLine('{}')).toBe(false);
  });

  it('returns false for non-Devflow statusLine', () => {
    const input = JSON.stringify({
      statusLine: {
        type: 'command',
        command: '/other/tool/status.sh',
      },
    });
    expect(hasHudStatusLine(input)).toBe(false);
  });
});

describe('hasNonDevFlowStatusLine', () => {
  it('returns true for external statusLine', () => {
    const input = JSON.stringify({
      statusLine: {
        type: 'command',
        command: '/other/tool/my-status.sh',
      },
    });
    expect(hasNonDevFlowStatusLine(input)).toBe(true);
  });

  it('returns false for Devflow HUD', () => {
    const withHud = addHudStatusLine('{}', '/home/user/.devflow');
    expect(hasNonDevFlowStatusLine(withHud)).toBe(false);
  });

  it('returns false when no statusLine', () => {
    expect(hasNonDevFlowStatusLine('{}')).toBe(false);
  });
});

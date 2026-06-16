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

/**
 * Drift self-healing contract tests.
 *
 * The --disable command is now idempotent end-to-end: it always attempts to
 * strip a lingering Devflow statusLine from settings.json even when hud.json
 * already says disabled. The pure-function layer that --disable delegates to
 * (removeHudStatusLine) must satisfy these properties for the self-healing
 * to be correct.
 */
describe('--disable drift self-healing (via removeHudStatusLine)', () => {
  it('removes a lingering Devflow hud.sh statusLine when config was already disabled', () => {
    // Simulates: hud.json says enabled=false but settings.json still has the statusLine
    // (drift from a partial prior state such as a crash between config-write and settings-write).
    const driftedSettings = JSON.stringify({
      statusLine: { type: 'command', command: '/home/user/.devflow/scripts/hud.sh' },
      env: { FOO: 'bar' },
    });

    const result = removeHudStatusLine(driftedSettings);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeUndefined();
    // Other settings must survive
    expect(settings.env.FOO).toBe('bar');
  });

  it('removes a lingering legacy statusline.sh when config was already disabled', () => {
    const driftedSettings = JSON.stringify({
      statusLine: { type: 'command', command: '/old/path/.devflow/scripts/statusline.sh' },
    });

    const result = removeHudStatusLine(driftedSettings);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeUndefined();
  });

  it('does NOT remove a non-Devflow statusLine — third-party statusLine must survive --disable', () => {
    // A user may have their own statusLine from another tool.
    // --disable must never remove it (removeHudStatusLine returns unchanged JSON).
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/usr/local/bin/my-custom-statusbar.sh' },
    });

    const result = removeHudStatusLine(input);

    expect(result).toBe(input);
    expect(JSON.parse(result).statusLine.command).toBe('/usr/local/bin/my-custom-statusbar.sh');
  });

  it('is a no-op (returns identical JSON) when no statusLine is present', () => {
    // When config is already disabled AND settings has no statusLine,
    // removeHudStatusLine must return the same string (content unchanged).
    // The --disable command uses changed-content detection (updated !== settingsContent)
    // to decide whether to write; unchanged means no write.
    const input = JSON.stringify({ env: { FOO: 'bar' } });

    const result = removeHudStatusLine(input);

    expect(result).toBe(input);
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

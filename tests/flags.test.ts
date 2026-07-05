import { describe, it, expect } from 'vitest';
import {
  FLAG_REGISTRY,
  getDefaultFlags,
  applyFlags,
  stripFlags,
  applyViewMode,
  stripViewMode,
  type ViewMode,
} from '../src/cli/utils/flags.js';

describe('FLAG_REGISTRY', () => {
  it('has unique IDs', () => {
    const ids = FLAG_REGISTRY.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every flag has required fields', () => {
    for (const flag of FLAG_REGISTRY) {
      expect(flag.id).toBeTruthy();
      expect(flag.label).toBeTruthy();
      expect(flag.description).toBeTruthy();
      expect(flag.target).toBeDefined();
      expect(typeof flag.defaultEnabled).toBe('boolean');
    }
  });

  it('target is either env or setting type', () => {
    for (const flag of FLAG_REGISTRY) {
      expect(['env', 'setting']).toContain(flag.target.type);
      if (flag.target.type === 'env') {
        expect(typeof flag.target.key).toBe('string');
        expect(typeof flag.target.value).toBe('string');
      } else {
        expect(typeof flag.target.key).toBe('string');
        expect(flag.target.value).toBeDefined();
      }
    }
  });

  it('has unique target keys (no duplicate env var or setting keys)', () => {
    const envKeys = FLAG_REGISTRY
      .filter(f => f.target.type === 'env')
      .map(f => f.target.key);
    const settingKeys = FLAG_REGISTRY
      .filter(f => f.target.type === 'setting')
      .map(f => f.target.key);
    expect(new Set(envKeys).size).toBe(envKeys.length);
    expect(new Set(settingKeys).size).toBe(settingKeys.length);
  });
});

describe('getDefaultFlags', () => {
  it('returns IDs of flags where defaultEnabled is true', () => {
    const defaults = getDefaultFlags();
    const expected = FLAG_REGISTRY.filter(f => f.defaultEnabled).map(f => f.id);
    expect(defaults).toEqual(expected);
  });
});

describe('applyFlags', () => {
  it('adds env vars for env-type flags', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, ['tool-search']));
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
  });

  it('adds top-level settings for setting-type flags', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, ['clear-context-on-plan']));
    expect(result.showClearContextOnPlanAccept).toBe(true);
  });

  it('applies string-value setting (tui → "fullscreen")', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, ['tui']));
    expect(result.tui).toBe('fullscreen');
  });

  it('applies all registered flags at once', () => {
    const allIds = FLAG_REGISTRY.map(f => f.id);
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, allIds));
    for (const flag of FLAG_REGISTRY) {
      if (flag.target.type === 'env') {
        expect(result.env[flag.target.key]).toBe(flag.target.value);
      } else {
        expect(result[flag.target.key]).toBe(flag.target.value);
      }
    }
  });

  it('applies multiple flags at once', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, ['tool-search', 'lsp', 'clear-context-on-plan']));
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
    expect(result.env.ENABLE_LSP_TOOL).toBe('true');
    expect(result.showClearContextOnPlanAccept).toBe(true);
  });

  it('preserves existing settings', () => {
    const input = JSON.stringify({
      hooks: { Stop: [] },
      statusLine: { type: 'command' },
      env: { EXISTING_VAR: 'keep' },
    }, null, 2);
    const result = JSON.parse(applyFlags(input, ['tool-search']));
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.statusLine).toEqual({ type: 'command' });
    expect(result.env.EXISTING_VAR).toBe('keep');
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
  });

  it('ignores unknown flag IDs', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, ['nonexistent-flag']));
    expect(result.env).toBeUndefined();
  });

  it('returns unchanged JSON when no flags provided', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = applyFlags(input, []);
    expect(JSON.parse(result)).toEqual({ hooks: {} });
  });
});

describe('stripFlags', () => {
  it('removes env vars managed by flags', () => {
    const input = JSON.stringify({
      env: {
        ENABLE_TOOL_SEARCH: 'true',
        ENABLE_LSP_TOOL: 'true',
        EXISTING_VAR: 'keep',
      },
    }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.env.ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(result.env.ENABLE_LSP_TOOL).toBeUndefined();
    expect(result.env.EXISTING_VAR).toBe('keep');
  });

  it('removes top-level settings managed by flags', () => {
    const input = JSON.stringify({
      showClearContextOnPlanAccept: true,
      hooks: {},
    }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.showClearContextOnPlanAccept).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('removes string-valued setting (tui) when stripped', () => {
    const input = JSON.stringify({
      tui: 'fullscreen',
      hooks: {},
    }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.tui).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('removes empty env object after stripping', () => {
    const input = JSON.stringify({
      hooks: {},
      env: { ENABLE_TOOL_SEARCH: 'true' },
    }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.env).toBeUndefined();
  });

  it('removes CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS when agent-teams flag is registered', () => {
    // agent-teams is now a registered flag, so stripFlags removes its env var
    const input = JSON.stringify({
      env: {
        ENABLE_TOOL_SEARCH: 'true',
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CUSTOM_VAR: 'keep',
      },
    }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
    expect(result.env.ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(result.env.CUSTOM_VAR).toBe('keep');
  });

  it('strips flag-managed env keys regardless of their value', () => {
    const input = JSON.stringify({ env: { ENABLE_TOOL_SEARCH: 'false' } }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.env).toBeUndefined();
  });

  it('handles missing env object gracefully', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result).toEqual({ hooks: {} });
  });

  it('is inverse of applyFlags (roundtrip)', () => {
    const base = JSON.stringify({
      hooks: { Stop: [] },
      env: { CUSTOM: 'value' },
    }, null, 2);

    const withFlags = applyFlags(base, ['tool-search', 'lsp', 'clear-context-on-plan']);
    const stripped = stripFlags(withFlags);
    const result = JSON.parse(stripped);

    expect(result.env.ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(result.env.ENABLE_LSP_TOOL).toBeUndefined();
    expect(result.showClearContextOnPlanAccept).toBeUndefined();
    expect(result.env.CUSTOM).toBe('value');
    expect(result.hooks).toEqual({ Stop: [] });
  });

  it('roundtrip with all registered flags', () => {
    const allIds = FLAG_REGISTRY.map(f => f.id);
    const base = JSON.stringify({
      hooks: { Stop: [] },
      env: { CUSTOM: 'value' },
    }, null, 2);

    const result = JSON.parse(stripFlags(applyFlags(base, allIds)));

    for (const flag of FLAG_REGISTRY) {
      if (flag.target.type === 'env') {
        expect(result.env?.[flag.target.key]).toBeUndefined();
      } else {
        expect(result[flag.target.key]).toBeUndefined();
      }
    }
    expect(result.env.CUSTOM).toBe('value');
    expect(result.hooks).toEqual({ Stop: [] });
  });
});

describe('agent-teams flag', () => {
  it('is registered in FLAG_REGISTRY', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'agent-teams');
    expect(flag).toBeDefined();
  });

  it('is defaultEnabled: false (opt-in, not default)', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'agent-teams')!;
    expect(flag.defaultEnabled).toBe(false);
  });

  it('maps to CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'agent-teams')!;
    expect(flag.target.type).toBe('env');
    if (flag.target.type === 'env') {
      expect(flag.target.key).toBe('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS');
      expect(flag.target.value).toBe('1');
    }
  });

  it('is NOT in getDefaultFlags() (off by default)', () => {
    const defaults = getDefaultFlags();
    expect(defaults).not.toContain('agent-teams');
  });

  it('applyFlags adds CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS when agent-teams is enabled', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, ['agent-teams']));
    expect(result.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe('1');
  });

  it('stripFlags removes CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', () => {
    const input = JSON.stringify({
      env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', CUSTOM: 'keep' },
    }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
    expect(result.env?.CUSTOM).toBe('keep');
  });

  it('roundtrip: apply then strip is idempotent', () => {
    const base = JSON.stringify({ hooks: { Stop: [] } }, null, 2);
    const applied = applyFlags(base, ['agent-teams']);
    const stripped = stripFlags(applied);
    const result = JSON.parse(stripped);
    expect(result.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
    expect(result.hooks).toEqual({ Stop: [] });
  });
});

describe('disable-bundled-skills flag', () => {
  it('is registered in FLAG_REGISTRY', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'disable-bundled-skills');
    expect(flag).toBeDefined();
  });

  it('is defaultEnabled: true', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'disable-bundled-skills')!;
    expect(flag.defaultEnabled).toBe(true);
  });

  it('maps to disableBundledSkills setting = true', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'disable-bundled-skills')!;
    expect(flag.target.type).toBe('setting');
    if (flag.target.type === 'setting') {
      expect(flag.target.key).toBe('disableBundledSkills');
      expect(flag.target.value).toBe(true);
    }
  });

  it('is in getDefaultFlags() (on by default)', () => {
    expect(getDefaultFlags()).toContain('disable-bundled-skills');
  });
});

describe('pin-sonnet-4-6 flag', () => {
  it('is registered in FLAG_REGISTRY', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'pin-sonnet-4-6');
    expect(flag).toBeDefined();
  });

  it('is defaultEnabled: true', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'pin-sonnet-4-6')!;
    expect(flag.defaultEnabled).toBe(true);
  });

  it('maps to ANTHROPIC_DEFAULT_SONNET_MODEL env var = claude-sonnet-4-6', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'pin-sonnet-4-6')!;
    expect(flag.target.type).toBe('env');
    if (flag.target.type === 'env') {
      expect(flag.target.key).toBe('ANTHROPIC_DEFAULT_SONNET_MODEL');
      expect(flag.target.value).toBe('claude-sonnet-4-6');
    }
  });

  it('is in getDefaultFlags() (on by default)', () => {
    expect(getDefaultFlags()).toContain('pin-sonnet-4-6');
  });
});

describe('applyViewMode', () => {
  it('sets viewMode to verbose', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'verbose'));
    expect(result.viewMode).toBe('verbose');
  });

  it('sets viewMode to focus', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'focus'));
    expect(result.viewMode).toBe('focus');
  });

  it('removes viewMode key when mode is default', () => {
    const input = JSON.stringify({ hooks: {}, viewMode: 'verbose' }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'default'));
    expect(result.viewMode).toBeUndefined();
  });

  it('does not add viewMode key when mode is default and key is absent', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'default'));
    expect(result.viewMode).toBeUndefined();
    expect(Object.keys(result)).not.toContain('viewMode');
  });

  it('preserves existing settings when applying view mode', () => {
    const input = JSON.stringify({
      hooks: { Stop: [] },
      env: { EXISTING: 'keep' },
    }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'focus'));
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.env.EXISTING).toBe('keep');
    expect(result.viewMode).toBe('focus');
  });

  it('overwrites an existing viewMode value', () => {
    const input = JSON.stringify({ viewMode: 'verbose' }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'focus'));
    expect(result.viewMode).toBe('focus');
  });
});

describe('stripViewMode', () => {
  it('removes viewMode key', () => {
    const input = JSON.stringify({ viewMode: 'verbose', hooks: {} }, null, 2);
    const result = JSON.parse(stripViewMode(input));
    expect(result.viewMode).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('handles missing viewMode key gracefully', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(stripViewMode(input));
    expect(result).toEqual({ hooks: {} });
  });

  it('preserves all other settings', () => {
    const input = JSON.stringify({
      viewMode: 'focus',
      hooks: { Stop: [] },
      env: { CUSTOM: 'value' },
    }, null, 2);
    const result = JSON.parse(stripViewMode(input));
    expect(result.viewMode).toBeUndefined();
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.env.CUSTOM).toBe('value');
  });

  it('roundtrip: applyViewMode then stripViewMode restores original', () => {
    const base = JSON.stringify({ hooks: { Stop: [] } }, null, 2);
    const modes: ViewMode[] = ['verbose', 'focus', 'default'];
    for (const mode of modes) {
      const applied = applyViewMode(base, mode);
      const stripped = stripViewMode(applied);
      const result = JSON.parse(stripped);
      expect(result.viewMode).toBeUndefined();
      expect(result.hooks).toEqual({ Stop: [] });
    }
  });
});

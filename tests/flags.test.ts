import { describe, it, expect } from 'vitest';
import {
  FLAG_REGISTRY,
  getDefaultFlags,
  applyFlags,
  stripFlags,
} from '../src/cli/utils/flags.js';

describe('FLAG_REGISTRY', () => {
  it('contains at least 14 flags', () => {
    expect(FLAG_REGISTRY.length).toBeGreaterThanOrEqual(14);
  });

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

  it('applies all 14 flags at once', () => {
    const allIds = FLAG_REGISTRY.map(f => f.id);
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, allIds));
    // env flags
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
    expect(result.env.ENABLE_LSP_TOOL).toBe('true');
    expect(result.env.ENABLE_PROMPT_CACHING_1H).toBe('true');
    expect(result.env.CLAUDE_CODE_BRIEF).toBe('true');
    expect(result.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('1');
    expect(result.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('true');
    expect(result.env.CLAUDE_CODE_FORK_SUBAGENT).toBe('1');
    expect(result.env.DISABLE_COMPACT).toBe('true');
    expect(result.env.CLAUDE_CODE_DISABLE_1M_CONTEXT).toBe('true');
    expect(result.env.DISABLE_AUTOUPDATER).toBe('true');
    // setting flags
    expect(result.showTurnDuration).toBe(true);
    expect(result.showClearContextOnPlanAccept).toBe(true);
    expect(result.tui).toBe('fullscreen');
    expect(result.showThinkingSummaries).toBe(true);
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

  it('preserves non-flag env vars', () => {
    const input = JSON.stringify({
      env: {
        ENABLE_TOOL_SEARCH: 'true',
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      },
    }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe('1');
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

  it('roundtrip with mixed new flags including string-valued settings', () => {
    const base = JSON.stringify({
      hooks: { Stop: [] },
      env: { CUSTOM: 'value' },
    }, null, 2);

    const withFlags = applyFlags(base, [
      'prompt-caching-1h',
      'show-turn-duration',
      'tui',
      'thinking-summaries',
      'subprocess-env-scrub',
      'forked-subagents',
    ]);
    const stripped = stripFlags(withFlags);
    const result = JSON.parse(stripped);

    expect(result.env.ENABLE_PROMPT_CACHING_1H).toBeUndefined();
    expect(result.showTurnDuration).toBeUndefined();
    expect(result.tui).toBeUndefined();
    expect(result.showThinkingSummaries).toBeUndefined();
    expect(result.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBeUndefined();
    expect(result.env.CLAUDE_CODE_FORK_SUBAGENT).toBeUndefined();
    expect(result.env.CUSTOM).toBe('value');
    expect(result.hooks).toEqual({ Stop: [] });
  });

  it('roundtrip with all 14 flags', () => {
    const allIds = FLAG_REGISTRY.map(f => f.id);
    const base = JSON.stringify({
      hooks: { Stop: [] },
      env: { CUSTOM: 'value' },
    }, null, 2);

    const withFlags = applyFlags(base, allIds);
    const stripped = stripFlags(withFlags);
    const result = JSON.parse(stripped);

    // All flag-managed keys removed
    expect(result.env.ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(result.env.ENABLE_LSP_TOOL).toBeUndefined();
    expect(result.env.ENABLE_PROMPT_CACHING_1H).toBeUndefined();
    expect(result.showTurnDuration).toBeUndefined();
    expect(result.showClearContextOnPlanAccept).toBeUndefined();
    expect(result.env.CLAUDE_CODE_BRIEF).toBeUndefined();
    expect(result.tui).toBeUndefined();
    expect(result.showThinkingSummaries).toBeUndefined();
    expect(result.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBeUndefined();
    expect(result.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBeUndefined();
    expect(result.env.CLAUDE_CODE_FORK_SUBAGENT).toBeUndefined();
    expect(result.env.DISABLE_COMPACT).toBeUndefined();
    expect(result.env.CLAUDE_CODE_DISABLE_1M_CONTEXT).toBeUndefined();
    expect(result.env.DISABLE_AUTOUPDATER).toBeUndefined();
    // Non-flag keys preserved
    expect(result.env.CUSTOM).toBe('value');
    expect(result.hooks).toEqual({ Stop: [] });
  });
});

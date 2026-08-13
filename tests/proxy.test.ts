/**
 * Tests for the devflow proxy CLI pure functions.
 *
 * Strategy: import exported pure functions from proxy.ts and test them directly —
 * no I/O, no Commander, no network. All tests operate on plain JSON strings or
 * plain Settings objects. runProxyPreflight tests use injected ProxyPreflightDeps
 * so every branch is exercised without real TCP/HTTP/spawn.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  applyProxyEnv,
  stripProxyEnv,
  readProxyEnvState,
  addProxyHooks,
  removeProxyHooks,
  hasProxyHooks,
  applyDisableToSettings,
  runProxyPreflight,
  runPostSpawnVerification,
  isOurRelayBody,
  resolvePort,
  type ProxyPreflightDeps,
  type PostSpawnDoctorDeps,
} from '../src/cli/commands/proxy.js';
import type { Settings } from '../src/targets/claude-code/hooks.js';

const DEVFLOW_DIR = '/home/test/.devflow';
const DEFAULT_PORT = 4141;
const OUR_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

// ─── applyProxyEnv ───────────────────────────────────────────────────────────

describe('applyProxyEnv', () => {
  it('sets ANTHROPIC_BASE_URL to relay URL', () => {
    const result = JSON.parse(applyProxyEnv(JSON.stringify({}), DEFAULT_PORT));
    expect((result.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe(OUR_URL);
  });

  it('creates env object when settings has none', () => {
    const result = JSON.parse(applyProxyEnv(JSON.stringify({ hooks: {} }), DEFAULT_PORT));
    expect((result.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe(OUR_URL);
  });

  it('preserves other env vars', () => {
    const input = JSON.stringify({ env: { SOME_OTHER_VAR: 'keep' } });
    const result = JSON.parse(applyProxyEnv(input, DEFAULT_PORT));
    const env = result.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe(OUR_URL);
    expect(env.SOME_OTHER_VAR).toBe('keep');
  });

  it('uses the correct port in URL', () => {
    const result = JSON.parse(applyProxyEnv(JSON.stringify({}), 9999));
    expect((result.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9999');
  });

  it('is idempotent — double apply produces same result', () => {
    const once = applyProxyEnv(JSON.stringify({}), DEFAULT_PORT);
    const twice = applyProxyEnv(once, DEFAULT_PORT);
    expect(JSON.parse(twice).env.ANTHROPIC_BASE_URL).toBe(OUR_URL);
  });

  it('does not mutate input — returns new serialized string', () => {
    const input = JSON.stringify({});
    applyProxyEnv(input, DEFAULT_PORT);
    expect(JSON.parse(input).env).toBeUndefined();
  });

  it('throws on malformed JSON', () => {
    expect(() => applyProxyEnv('not json', DEFAULT_PORT)).toThrow(SyntaxError);
  });
});

// ─── stripProxyEnv ───────────────────────────────────────────────────────────
//
// REG-1 regression: the old implementation used OUR_BASE_URL_PATTERN which matched
// ANY localhost port.  A user with LiteLLM on 127.0.0.1:4000 had ANTHROPIC_BASE_URL
// silently deleted on every `devflow init`.  The fix scopes the strip to the exact
// managed port Devflow owns (proxy.json.port or DEFAULT_PROXY_PORT).

describe('stripProxyEnv', () => {
  it('removes ANTHROPIC_BASE_URL when it matches our relay on the managed port', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: OUR_URL, OTHER: 'keep' } });
    const result = JSON.parse(stripProxyEnv(input, DEFAULT_PORT));
    expect((result.env as Record<string, string>).ANTHROPIC_BASE_URL).toBeUndefined();
    expect((result.env as Record<string, string>).OTHER).toBe('keep');
  });

  it('removes env object entirely when relay URL was the only key', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: OUR_URL } });
    const result = JSON.parse(stripProxyEnv(input, DEFAULT_PORT));
    expect(result.env).toBeUndefined();
  });

  it('does NOT remove ANTHROPIC_BASE_URL when it points to a foreign HTTPS gateway', () => {
    const foreignUrl = 'https://my-custom-gateway.example.com';
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: foreignUrl } });
    const result = JSON.parse(stripProxyEnv(input, DEFAULT_PORT));
    expect((result.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe(foreignUrl);
  });

  it('does NOT remove ANTHROPIC_BASE_URL when it uses HTTPS (not our relay)', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://127.0.0.1:4141' } });
    const result = JSON.parse(stripProxyEnv(input, DEFAULT_PORT));
    expect((result.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://127.0.0.1:4141');
  });

  // REG-1 regression: foreign localhost URL must survive init-path strip
  it('REG-1: does NOT strip a localhost URL on a port Devflow does not manage', () => {
    // User has their own LiteLLM gateway on 4000; Devflow manages 4141.
    const litellmUrl = 'http://127.0.0.1:4000';
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: litellmUrl } });
    const result = JSON.parse(stripProxyEnv(input, DEFAULT_PORT /* 4141 */));
    // 4000 ≠ 4141 → must NOT be stripped
    expect((result.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe(litellmUrl);
  });

  // REG-1 regression: our port IS stripped when managed port matches
  it('REG-1: strips relay URL on a non-default managed port when port matches', () => {
    const customPortUrl = 'http://127.0.0.1:9999';
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: customPortUrl } });
    const result = JSON.parse(stripProxyEnv(input, 9999 /* managedPort */));
    expect(result.env).toBeUndefined();
  });

  // REG-1 regression: ours-other-port (not managed) is left alone
  it('REG-1: does NOT strip ours-other-port URL when managed port is different', () => {
    // URL=5000 (old enable), managed port now 4141 → 5000 is not our current port
    const oldUrl = 'http://127.0.0.1:5000';
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: oldUrl } });
    const result = JSON.parse(stripProxyEnv(input, DEFAULT_PORT /* 4141 */));
    expect((result.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe(oldUrl);
  });

  it('is a no-op when ANTHROPIC_BASE_URL not set', () => {
    const input = JSON.stringify({ env: { SOME_VAR: 'value' } });
    const result = JSON.parse(stripProxyEnv(input, DEFAULT_PORT));
    expect((result.env as Record<string, string>).SOME_VAR).toBe('value');
  });

  it('is a no-op when env block absent', () => {
    const input = JSON.stringify({ hooks: {} });
    const result = JSON.parse(stripProxyEnv(input, DEFAULT_PORT));
    expect(result.env).toBeUndefined();
  });

  it('is idempotent — double strip is the same as single strip', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: OUR_URL } });
    const once = stripProxyEnv(input, DEFAULT_PORT);
    const twice = stripProxyEnv(once, DEFAULT_PORT);
    expect(JSON.parse(twice).env).toBeUndefined();
  });

  it('does not mutate input', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: OUR_URL } });
    stripProxyEnv(input, DEFAULT_PORT);
    expect(JSON.parse(input).env.ANTHROPIC_BASE_URL).toBe(OUR_URL);
  });
});

// ─── readProxyEnvState ───────────────────────────────────────────────────────

describe('readProxyEnvState', () => {
  it('returns "ours" when ANTHROPIC_BASE_URL matches relay on given port', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: OUR_URL } });
    expect(readProxyEnvState(input, DEFAULT_PORT)).toBe('ours');
  });

  it('returns "ours-other-port" when relay URL but different port', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999' } });
    expect(readProxyEnvState(input, DEFAULT_PORT)).toBe('ours-other-port');
  });

  it('returns "foreign" when ANTHROPIC_BASE_URL points to a different gateway', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://custom.gateway.io' } });
    expect(readProxyEnvState(input, DEFAULT_PORT)).toBe('foreign');
  });

  it('returns "absent" when ANTHROPIC_BASE_URL not set', () => {
    const input = JSON.stringify({ env: { OTHER_VAR: 'value' } });
    expect(readProxyEnvState(input, DEFAULT_PORT)).toBe('absent');
  });

  it('returns "absent" when env block absent', () => {
    const input = JSON.stringify({});
    expect(readProxyEnvState(input, DEFAULT_PORT)).toBe('absent');
  });

  it('returns "foreign" for HTTPS relay-looking URL (we only use http)', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://127.0.0.1:4141' } });
    expect(readProxyEnvState(input, DEFAULT_PORT)).toBe('foreign');
  });
});

// ─── addProxyHooks / removeProxyHooks / hasProxyHooks ────────────────────────

describe('addProxyHooks', () => {
  it('adds ensure-proxy to both SessionStart and UserPromptSubmit', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    expect(hasProxyHooks(settings)).toBe(true);
    const sessionHooks = settings.hooks?.['SessionStart'];
    const promptHooks = settings.hooks?.['UserPromptSubmit'];
    expect(sessionHooks?.some(m => m.hooks.some(h => h.command.includes('ensure-proxy')))).toBe(true);
    expect(promptHooks?.some(m => m.hooks.some(h => h.command.includes('ensure-proxy')))).toBe(true);
  });

  it('sets timeout 15 on added hooks', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    const sessionEntry = settings.hooks?.['SessionStart']?.[0].hooks[0];
    expect(sessionEntry?.timeout).toBe(15);
    const promptEntry = settings.hooks?.['UserPromptSubmit']?.[0].hooks[0];
    expect(promptEntry?.timeout).toBe(15);
  });

  it('includes run-hook ensure-proxy in command string', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    const cmd = settings.hooks?.['SessionStart']?.[0].hooks[0].command ?? '';
    expect(cmd).toContain('run-hook');
    expect(cmd).toContain('ensure-proxy');
  });

  it('uses devflowDir to build hook command path', () => {
    const settings: Settings = {};
    addProxyHooks(settings, '/custom/devflow');
    const cmd = settings.hooks?.['SessionStart']?.[0].hooks[0].command ?? '';
    expect(cmd).toContain('/custom/devflow');
  });

  it('is idempotent — adding twice does not duplicate hooks', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    addProxyHooks(settings, DEVFLOW_DIR);
    const sessionHooks = settings.hooks?.['SessionStart'] ?? [];
    const proxyCount = sessionHooks.filter(m => m.hooks.some(h => h.command.includes('ensure-proxy'))).length;
    expect(proxyCount).toBe(1);
  });

  it('repairs partial state — adds missing event when other is present', () => {
    // Only SessionStart exists
    const settings: Settings = {
      hooks: {
        'SessionStart': [{ hooks: [{ type: 'command', command: `${DEVFLOW_DIR}/scripts/hooks/run-hook ensure-proxy`, timeout: 15 }] }],
      },
    };
    const changed = addProxyHooks(settings, DEVFLOW_DIR);
    expect(changed).toBe(true);
    // UserPromptSubmit now also has it
    expect(settings.hooks?.['UserPromptSubmit']?.some(m => m.hooks.some(h => h.command.includes('ensure-proxy')))).toBe(true);
  });

  it('preserves other hooks on the same events', () => {
    const settings: Settings = {
      hooks: {
        'SessionStart': [{ hooks: [{ type: 'command', command: 'other-hook', timeout: 5 }] }],
      },
    };
    addProxyHooks(settings, DEVFLOW_DIR);
    const sessionHooks = settings.hooks?.['SessionStart'] ?? [];
    // Both hooks should be present
    expect(sessionHooks.some(m => m.hooks.some(h => h.command === 'other-hook'))).toBe(true);
    expect(sessionHooks.some(m => m.hooks.some(h => h.command.includes('ensure-proxy')))).toBe(true);
  });

  it('returns true when hooks were added', () => {
    const settings: Settings = {};
    expect(addProxyHooks(settings, DEVFLOW_DIR)).toBe(true);
  });

  it('returns false when hooks already present (no-op)', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    expect(addProxyHooks(settings, DEVFLOW_DIR)).toBe(false);
  });
});

describe('removeProxyHooks', () => {
  it('removes ensure-proxy from both events', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    removeProxyHooks(settings);
    expect(hasProxyHooks(settings)).toBe(false);
  });

  it('preserves other hooks on the same events', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    settings.hooks!['SessionStart']!.push({ hooks: [{ type: 'command', command: 'other-hook', timeout: 5 }] });
    removeProxyHooks(settings);
    const sessionHooks = settings.hooks?.['SessionStart'] ?? [];
    expect(sessionHooks.some(m => m.hooks.some(h => h.command === 'other-hook'))).toBe(true);
    expect(sessionHooks.some(m => m.hooks.some(h => h.command.includes('ensure-proxy')))).toBe(false);
  });

  it('cleans up empty hooks event array', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    // remove leaves hooks.SessionStart/UserPromptSubmit empty — should delete keys
    removeProxyHooks(settings);
    expect(settings.hooks?.['SessionStart']).toBeUndefined();
    expect(settings.hooks?.['UserPromptSubmit']).toBeUndefined();
  });

  it('cleans up empty hooks object', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    removeProxyHooks(settings);
    expect(settings.hooks).toBeUndefined();
  });

  it('is a no-op when hooks are not present', () => {
    const settings: Settings = {};
    expect(() => removeProxyHooks(settings)).not.toThrow();
  });

  it('returns true when hooks were removed', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    expect(removeProxyHooks(settings)).toBe(true);
  });

  it('returns false when nothing to remove', () => {
    const settings: Settings = {};
    expect(removeProxyHooks(settings)).toBe(false);
  });

  it('is idempotent — removing twice does not throw', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    removeProxyHooks(settings);
    expect(() => removeProxyHooks(settings)).not.toThrow();
    expect(removeProxyHooks(settings)).toBe(false);
  });
});

describe('hasProxyHooks', () => {
  it('returns false for empty settings', () => {
    expect(hasProxyHooks({})).toBe(false);
  });

  it('returns true after addProxyHooks', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    expect(hasProxyHooks(settings)).toBe(true);
  });

  it('returns false after removeProxyHooks', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    removeProxyHooks(settings);
    expect(hasProxyHooks(settings)).toBe(false);
  });

  it('accepts a JSON string (object or string)', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    expect(hasProxyHooks(JSON.stringify(settings))).toBe(true);
  });

  it('returns true when only one event is present (partial state)', () => {
    const settings: Settings = {
      hooks: {
        'SessionStart': [{ hooks: [{ type: 'command', command: `${DEVFLOW_DIR}/scripts/hooks/run-hook ensure-proxy`, timeout: 15 }] }],
      },
    };
    expect(hasProxyHooks(settings)).toBe(true);
  });

  it('returns false when hooks exist but none are ensure-proxy', () => {
    const settings: Settings = {
      hooks: {
        'SessionStart': [{ hooks: [{ type: 'command', command: 'other-hook', timeout: 5 }] }],
      },
    };
    expect(hasProxyHooks(settings)).toBe(false);
  });
});

// ─── applyDisableToSettings ──────────────────────────────────────────────────
//
// Regression for the || short-circuit bug: when hooks were present, the old
// code `removeProxyHooks(s) || _stripProxyEnv(s)` short-circuited and never
// stripped ANTHROPIC_BASE_URL, leaving sessions pointed at a disabled relay.
//
// REG-1: the second argument is the managed port.  Tests use DEFAULT_PORT (4141)
// which matches OUR_URL — callers in production read proxy.json.port.

describe('applyDisableToSettings', () => {
  it('removes BOTH proxy hooks AND ANTHROPIC_BASE_URL when both are present (regression)', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);
    (settings as Record<string, unknown>).env = { ANTHROPIC_BASE_URL: OUR_URL };

    const changed = applyDisableToSettings(settings, DEFAULT_PORT);

    expect(changed).toBe(true);
    expect(hasProxyHooks(settings)).toBe(false);
    expect((settings as Record<string, unknown>).env).toBeUndefined();
  });

  it('removes only hooks when env var absent', () => {
    const settings: Settings = {};
    addProxyHooks(settings, DEVFLOW_DIR);

    const changed = applyDisableToSettings(settings, DEFAULT_PORT);

    expect(changed).toBe(true);
    expect(hasProxyHooks(settings)).toBe(false);
  });

  it('removes only ANTHROPIC_BASE_URL when hooks absent', () => {
    const settings = { env: { ANTHROPIC_BASE_URL: OUR_URL } } as unknown as Settings;

    const changed = applyDisableToSettings(settings, DEFAULT_PORT);

    expect(changed).toBe(true);
    expect((settings as Record<string, unknown>).env).toBeUndefined();
  });

  it('returns false when settings already clean (no-op)', () => {
    const settings: Settings = {};
    expect(applyDisableToSettings(settings, DEFAULT_PORT)).toBe(false);
  });

  it('does NOT strip ANTHROPIC_BASE_URL when it points to a foreign HTTPS gateway', () => {
    const settings = {
      env: { ANTHROPIC_BASE_URL: 'https://my-custom-gateway.example.com' },
    } as unknown as Settings;

    const changed = applyDisableToSettings(settings, DEFAULT_PORT);

    expect(changed).toBe(false);
    expect(
      (settings as Record<string, unknown> & { env: Record<string, string> }).env.ANTHROPIC_BASE_URL,
    ).toBe('https://my-custom-gateway.example.com');
  });

  // REG-1: disable strips OUR port but not a foreign localhost port
  it('REG-1: strips relay URL on the managed port', () => {
    const settings = { env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:5000' } } as unknown as Settings;
    const changed = applyDisableToSettings(settings, 5000 /* managedPort = our port */);
    expect(changed).toBe(true);
    expect((settings as Record<string, unknown>).env).toBeUndefined();
  });

  it('REG-1: does NOT strip a foreign localhost URL on a different port from managedPort', () => {
    // User's own LiteLLM on 4000; we manage 4141 → leave 4000 alone
    const settings = { env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' } } as unknown as Settings;
    const changed = applyDisableToSettings(settings, DEFAULT_PORT /* 4141 */);
    expect(changed).toBe(false);
    expect(
      (settings as Record<string, unknown> & { env: Record<string, string> }).env.ANTHROPIC_BASE_URL,
    ).toBe('http://127.0.0.1:4000');
  });
});

// ─── runProxyPreflight ────────────────────────────────────────────────────────

/** Build a complete passing set of preflight deps for customization. */
function makeDeps(overrides: Partial<ProxyPreflightDeps> = {}): ProxyPreflightDeps {
  return {
    resolveProxyBin: vi.fn().mockResolvedValue({ ok: true, value: { binPath: '/path/to/relay.js', npxWarning: false } }),
    fileExists: vi.fn().mockResolvedValue(true),
    tcpConnectable: vi.fn().mockResolvedValue(false), // port free by default
    httpGet: vi.fn().mockResolvedValue({ ok: true, value: '{"name":"subswitch","version":"0.2.0","providers":[{"id":"anthropic","configured":true,"modelCount":0}]}' }),
    readSettingsJson: vi.fn().mockResolvedValue('{}'),
    spawnDoctor: vi.fn().mockResolvedValue(0),
    onWarn: vi.fn(),
    ...overrides,
  };
}

describe('runProxyPreflight', () => {
  const port = DEFAULT_PORT;
  const codexAuthPath = '/home/test/.codex/auth.json';
  const configPath = '/home/test/.devflow/proxy-routing.json';
  const logPath = '/home/test/.devflow/logs/proxy.log';

  // ① Routing runtime bin
  it('returns Err when resolveProxyBin fails', async () => {
    const deps = makeDeps({
      resolveProxyBin: vi.fn().mockResolvedValue({ ok: false, error: 'routing runtime missing — reinstall devflow-kit' }),
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('routing runtime missing');
    }
  });

  // ② Codex auth
  it('returns Err when codex auth file absent', async () => {
    const deps = makeDeps({
      fileExists: vi.fn().mockResolvedValue(false),
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('codex login');
    }
  });

  // ③ Port probe — free
  it('returns Ok when all checks pass with port free', async () => {
    const deps = makeDeps(); // tcpConnectable=false
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.adopted).toBe(false);
      expect(result.value.binPath).toBe('/path/to/relay.js');
    }
    // Doctor is no longer called by preflight — it moved to runPostSpawnVerification
    expect(deps.spawnDoctor).not.toHaveBeenCalled();
  });

  // ③ Port probe — already ours (adopt)
  it('returns Ok with adopted:true when port is up and health matches our relay', async () => {
    const deps = makeDeps({
      tcpConnectable: vi.fn().mockResolvedValue(true), // port up
      httpGet: vi.fn().mockResolvedValue({ ok: true, value: '{"name":"subswitch","version":"0.2.0","providers":[{"id":"anthropic","configured":true,"modelCount":0}]}' }),
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.adopted).toBe(true);
    }
  });

  // ③ Port probe — squatted by another app
  it('returns Err when port is up but health does not match our relay', async () => {
    const deps = makeDeps({
      tcpConnectable: vi.fn().mockResolvedValue(true),
      httpGet: vi.fn().mockResolvedValue({ ok: true, value: '{"name":"some-other-app"}' }),
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('in use by another application');
    }
  });

  // ③ Port probe — squatted, health fails too
  it('returns Err when port is up but health request fails (not our relay)', async () => {
    const deps = makeDeps({
      tcpConnectable: vi.fn().mockResolvedValue(true),
      httpGet: vi.fn().mockResolvedValue({ ok: false, error: 'connection refused' }),
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('in use by another application');
    }
  });

  // ④ Settings check — foreign ANTHROPIC_BASE_URL
  it('returns Err when ANTHROPIC_BASE_URL is set to a foreign gateway', async () => {
    const deps = makeDeps({
      readSettingsJson: vi.fn().mockResolvedValue(JSON.stringify({
        env: { ANTHROPIC_BASE_URL: 'https://custom.gateway.example.com' },
      })),
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ANTHROPIC_BASE_URL');
    }
  });

  // ④ Settings check — ANTHROPIC_API_KEY warning (non-fatal)
  it('calls onWarn when ANTHROPIC_API_KEY is present in settings', async () => {
    const onWarn = vi.fn();
    const deps = makeDeps({
      readSettingsJson: vi.fn().mockResolvedValue(JSON.stringify({
        env: { ANTHROPIC_API_KEY: 'sk-test-key' },
      })),
      onWarn,
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(true); // warning is non-fatal
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('ANTHROPIC_API_KEY'));
  });

  // ④ Settings check — our own relay URL (not foreign)
  it('does not fail when ANTHROPIC_BASE_URL is already our relay URL', async () => {
    const deps = makeDeps({
      readSettingsJson: vi.fn().mockResolvedValue(JSON.stringify({
        env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` },
      })),
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(true);
  });

  // ④ Settings check — settings.json unreadable
  it('returns Err when readSettingsJson throws', async () => {
    const deps = makeDeps({
      readSettingsJson: vi.fn().mockRejectedValue(new Error('ENOENT')),
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('settings.json');
    }
  });

  // npxWarning propagated (from check ①)
  it('propagates npxWarning from resolveProxyBin', async () => {
    const deps = makeDeps({
      resolveProxyBin: vi.fn().mockResolvedValue({ ok: true, value: { binPath: '/path/.../relay.js', npxWarning: true } }),
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.npxWarning).toBe(true);
    }
  });

  // TEST-11: Health-check timeout path — httpGet Err('timeout') must fold into the
  // port-conflict Err, not a separate path. Pinned explicitly so a future refactor
  // cannot accidentally diverge timeout from connection-refused.
  it('returns port-conflict Err when port is up but health check times out (timeout folds into port-conflict path)', async () => {
    const deps = makeDeps({
      tcpConnectable: vi.fn().mockResolvedValue(true),
      httpGet: vi.fn().mockResolvedValue({ ok: false, error: 'timeout' }),
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // timeout folds into the same port-conflict path as connection-refused
      expect(result.error).toContain('in use by another application');
    }
  });

  // Ordering: later checks not run if earlier checks fail
  it('does not check codex auth when bin resolution fails', async () => {
    const fileExists = vi.fn();
    const deps = makeDeps({
      resolveProxyBin: vi.fn().mockResolvedValue({ ok: false, error: 'routing runtime missing — reinstall devflow-kit' }),
      fileExists,
    });
    await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(fileExists).not.toHaveBeenCalled();
  });

  // Preflight never calls spawnDoctor — doctor runs post-spawn in runPostSpawnVerification
  it('never calls spawnDoctor — doctor moved to post-spawn verification', async () => {
    const spawnDoctor = vi.fn();
    // Test across the non-adopt path (port free, all checks pass)
    const deps = makeDeps({ spawnDoctor });
    await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(spawnDoctor).not.toHaveBeenCalled();
  });

  it('never calls spawnDoctor even when port is squatted (early return path)', async () => {
    const spawnDoctor = vi.fn();
    const deps = makeDeps({
      tcpConnectable: vi.fn().mockResolvedValue(true),
      httpGet: vi.fn().mockResolvedValue({ ok: true, value: '{"name":"other"}' }),
      spawnDoctor,
    });
    await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(spawnDoctor).not.toHaveBeenCalled();
  });
});

// ─── runPostSpawnVerification ─────────────────────────────────────────────────
//
// D-EFR-2: Doctor runs post-spawn against a live relay, not pre-spawn where the
// relay port is always down on a cold path. Kill-on-rollback is restricted to
// self-spawned relays (spawnedPid defined) — adopted relays must not be killed.

/** Build a complete passing set of PostSpawnDoctorDeps for customisation. */
function makePostSpawnDeps(overrides: Partial<PostSpawnDoctorDeps> = {}): PostSpawnDoctorDeps {
  return {
    spawnDoctor: vi.fn().mockResolvedValue(0),
    killProcess: vi.fn(),
    writeDisabledProxyState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runPostSpawnVerification', () => {
  const BIN = '/path/to/relay.js';
  const CONFIG = '/home/test/.devflow/proxy-routing.json';
  const LOG = '/home/test/.devflow/logs/proxy.log';

  // (a) doctor runs after port is confirmed up (i.e. spawnDoctor is called by this function)
  it('calls spawnDoctor — runs against the live relay, not during preflight', async () => {
    const deps = makePostSpawnDeps();
    await runPostSpawnVerification(BIN, CONFIG, LOG, undefined, deps);
    expect(deps.spawnDoctor).toHaveBeenCalled();
  });

  // (d) doctor exits zero → Ok; no rollback, no kill
  it('doctor exits zero — returns Ok (settings pass proceeds)', async () => {
    const deps = makePostSpawnDeps({ spawnDoctor: vi.fn().mockResolvedValue(0) });
    const result = await runPostSpawnVerification(BIN, CONFIG, LOG, 1234, deps);
    expect(result.ok).toBe(true);
    expect(deps.writeDisabledProxyState).not.toHaveBeenCalled();
    expect(deps.killProcess).not.toHaveBeenCalled();
  });

  // (b) doctor non-zero + self-spawned → rollback AND kill
  it('doctor non-zero with self-spawned relay — rolls back proxy state and kills spawned pid', async () => {
    const deps = makePostSpawnDeps({ spawnDoctor: vi.fn().mockResolvedValue(1) });
    const result = await runPostSpawnVerification(BIN, CONFIG, LOG, 1234, deps);
    expect(result.ok).toBe(false);
    expect(deps.writeDisabledProxyState).toHaveBeenCalled();
    expect(deps.killProcess).toHaveBeenCalledWith(1234);
  });

  // (c) doctor non-zero + adopted (spawnedPid undefined) → rollback WITHOUT kill
  it('doctor non-zero with adopted relay — rolls back proxy state without killing', async () => {
    const deps = makePostSpawnDeps({ spawnDoctor: vi.fn().mockResolvedValue(1) });
    const result = await runPostSpawnVerification(BIN, CONFIG, LOG, undefined, deps);
    expect(result.ok).toBe(false);
    expect(deps.writeDisabledProxyState).toHaveBeenCalled();
    expect(deps.killProcess).not.toHaveBeenCalled();
  });

  // Branding constraint: error message must not expose internal relay package name
  it('error message does not expose internal relay package name', async () => {
    const deps = makePostSpawnDeps({ spawnDoctor: vi.fn().mockResolvedValue(1) });
    const result = await runPostSpawnVerification(BIN, CONFIG, LOG, undefined, deps);
    if (!result.ok) {
      expect(result.error.toLowerCase()).not.toContain('subswitch');
    } else {
      throw new Error('Expected Err result');
    }
  });

  // Error message references the log path for diagnostics
  it('error message references the log path', async () => {
    const deps = makePostSpawnDeps({ spawnDoctor: vi.fn().mockResolvedValue(1) });
    const result = await runPostSpawnVerification(BIN, CONFIG, LOG, undefined, deps);
    if (!result.ok) {
      expect(result.error).toContain(LOG);
    } else {
      throw new Error('Expected Err result');
    }
  });
});

// ─── isOurRelayBody ──────────────────────────────────────────────────────────
//
// CPLX-9: extracted helper used by both runProxyPreflight and resolveProcessState
// to identify the relay without duplicating the parse/check logic.

describe('isOurRelayBody', () => {
  it('returns true for a valid relay health body with name=subswitch (0.2.0 shape with providers)', () => {
    expect(isOurRelayBody('{"name":"subswitch","version":"0.2.0","providers":[{"id":"anthropic","configured":true,"modelCount":0}]}')).toBe(true);
  });

  it('returns false for a body with a different name field', () => {
    expect(isOurRelayBody('{"name":"some-other-app"}')).toBe(false);
  });

  it('returns false for invalid JSON', () => {
    expect(isOurRelayBody('not json')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isOurRelayBody('')).toBe(false);
  });

  it('returns false for valid JSON without a name field', () => {
    expect(isOurRelayBody('{"status":"ok","version":"0.1.0"}')).toBe(false);
  });

  it('returns false for a body where name is not exactly "subswitch"', () => {
    expect(isOurRelayBody('{"name":"Subswitch"}')).toBe(false);
    expect(isOurRelayBody('{"name":"subswitch2"}')).toBe(false);
  });
});

// ─── resolvePort ─────────────────────────────────────────────────────────────
//
// TS-1 regression: commander had `.option('--port <n>', ..., String(DEFAULT_PROXY_PORT))`
// which made options.port always the string '4141' — never undefined. The remembered-port
// fallback inside runEnable was dead code: a user who enabled on port 5000, disabled, then
// re-enabled without --port would silently revert to 4141 (spawning a second relay, leaking
// the old one on 5000).
//
// Fix: drop the commander default so omission is detectable as undefined; resolvePort treats
// undefined as "use prior port".

describe('resolvePort', () => {
  it('prior port 5000 + no --port → uses remembered port 5000 (TS-1 regression)', () => {
    const result = resolvePort(undefined, 5000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(5000);
  });

  it('explicit --port 8080 overrides prior port', () => {
    const result = resolvePort('8080', 5000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(8080);
  });

  it('returns prior port when portOption is undefined regardless of prior value', () => {
    const result = resolvePort(undefined, 4141);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(4141);
  });

  it('returns Err for non-numeric --port (NaN)', () => {
    const result = resolvePort('not-a-port', 4141);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Invalid port');
  });

  it('returns Err for port 0 (out of range)', () => {
    const result = resolvePort('0', 4141);
    expect(result.ok).toBe(false);
  });

  it('returns Err for port 65536 (out of range)', () => {
    const result = resolvePort('65536', 4141);
    expect(result.ok).toBe(false);
  });

  it('returns Ok for port 1 (min valid)', () => {
    const result = resolvePort('1', 4141);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
  });

  it('returns Ok for port 65535 (max valid)', () => {
    const result = resolvePort('65535', 4141);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(65535);
  });
});

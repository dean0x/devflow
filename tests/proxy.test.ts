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
  runProxyPreflight,
  type ProxyPreflightDeps,
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

describe('stripProxyEnv', () => {
  it('removes ANTHROPIC_BASE_URL when it matches our relay pattern', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: OUR_URL, OTHER: 'keep' } });
    const result = JSON.parse(stripProxyEnv(input));
    expect((result.env as Record<string, string>).ANTHROPIC_BASE_URL).toBeUndefined();
    expect((result.env as Record<string, string>).OTHER).toBe('keep');
  });

  it('removes env object entirely when relay URL was the only key', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: OUR_URL } });
    const result = JSON.parse(stripProxyEnv(input));
    expect(result.env).toBeUndefined();
  });

  it('does NOT remove ANTHROPIC_BASE_URL when it points to a foreign gateway', () => {
    const foreignUrl = 'https://my-custom-gateway.example.com';
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: foreignUrl } });
    const result = JSON.parse(stripProxyEnv(input));
    expect((result.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe(foreignUrl);
  });

  it('does NOT remove ANTHROPIC_BASE_URL when it uses HTTPS (not our relay)', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://127.0.0.1:4141' } });
    const result = JSON.parse(stripProxyEnv(input));
    expect((result.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://127.0.0.1:4141');
  });

  it('removes relay URLs on any port matching the pattern', () => {
    const otherPortUrl = 'http://127.0.0.1:9999';
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: otherPortUrl } });
    const result = JSON.parse(stripProxyEnv(input));
    expect(result.env).toBeUndefined();
  });

  it('is a no-op when ANTHROPIC_BASE_URL not set', () => {
    const input = JSON.stringify({ env: { SOME_VAR: 'value' } });
    const result = JSON.parse(stripProxyEnv(input));
    expect((result.env as Record<string, string>).SOME_VAR).toBe('value');
  });

  it('is a no-op when env block absent', () => {
    const input = JSON.stringify({ hooks: {} });
    const result = JSON.parse(stripProxyEnv(input));
    expect(result.env).toBeUndefined();
  });

  it('is idempotent — double strip is the same as single strip', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: OUR_URL } });
    const once = stripProxyEnv(input);
    const twice = stripProxyEnv(once);
    expect(JSON.parse(twice).env).toBeUndefined();
  });

  it('does not mutate input', () => {
    const input = JSON.stringify({ env: { ANTHROPIC_BASE_URL: OUR_URL } });
    stripProxyEnv(input);
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

// ─── runProxyPreflight ────────────────────────────────────────────────────────

/** Build a complete passing set of preflight deps for customization. */
function makeDeps(overrides: Partial<ProxyPreflightDeps> = {}): ProxyPreflightDeps {
  return {
    resolveProxyBin: vi.fn().mockResolvedValue({ ok: true, value: { binPath: '/path/to/relay.js', npxWarning: false } }),
    fileExists: vi.fn().mockResolvedValue(true),
    tcpConnectable: vi.fn().mockResolvedValue(false), // port free by default
    httpGet: vi.fn().mockResolvedValue({ ok: true, value: '{"name":"subswitch","version":"0.1.0"}' }),
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
    const deps = makeDeps(); // tcpConnectable=false, spawnDoctor=0
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.adopted).toBe(false);
      expect(result.value.binPath).toBe('/path/to/relay.js');
    }
  });

  // ③ Port probe — already ours (adopt)
  it('returns Ok with adopted:true when port is up and health matches our relay', async () => {
    const deps = makeDeps({
      tcpConnectable: vi.fn().mockResolvedValue(true), // port up
      httpGet: vi.fn().mockResolvedValue({ ok: true, value: '{"name":"subswitch","version":"0.1.0"}' }),
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

  // ⑤ Doctor
  it('returns Err when doctor exits non-zero', async () => {
    const deps = makeDeps({
      spawnDoctor: vi.fn().mockResolvedValue(1),
    });
    const result = await runProxyPreflight(port, codexAuthPath, configPath, logPath, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('preflight failed');
    }
  });

  // ⑤ Doctor — npxWarning propagated
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

  it('does not run doctor when port is squatted', async () => {
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

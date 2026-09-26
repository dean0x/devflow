/**
 * Pure helpers behind init's machine-wide learning/knowledge switch (#378):
 * the --hud-only manifest (D-HUD-ONLY-PRESERVE) and the Recommended summary
 * wording (D-LEARNING-MASTER-SWITCH). The end-to-end behaviour is pinned in
 * init-machine-switch-e2e.test.ts; these cover the arms a sandboxed CLI run
 * cannot reach cheaply.
 */
import { describe, it, expect } from 'vitest';
import { buildHudOnlyManifest, formatMachineSwitchSummary } from '../src/cli/commands/init.js';
import type { ManifestData } from '../src/core/manifest.js';

const NOW = '2026-09-26T00:00:00.000Z';

function fullInstall(): ManifestData {
  return {
    version: '3.1.0',
    plugins: ['devflow-implement', 'devflow-code-review'],
    scope: 'user',
    knownPlugins: ['devflow-implement', 'devflow-code-review'],
    features: {
      ambient: true, memory: true, hud: false, knowledge: true, learning: true, rules: true,
      flags: { tui: true }, security: 'user', proxy: true,
      compliance: { enabled: true, frameworks: ['gdpr'] },
      tracker: { provider: 'jira' },
    },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('buildHudOnlyManifest', () => {
  it('over a prior install keeps every value and turns only the HUD on', () => {
    const prior = fullInstall();
    const result = buildHudOnlyManifest(prior, '9.9.9', 'user', NOW);
    expect(result).toEqual({ ...prior, features: { ...prior.features, hud: true }, updatedAt: NOW });
  });

  it('keeps the prior version — --hud-only reinstalls no plugin', () => {
    expect(buildHudOnlyManifest(fullInstall(), '9.9.9', 'user', NOW).version).toBe('3.1.0');
  });

  it('never mutates the manifest it was given', () => {
    const prior = fullInstall();
    const snapshot = JSON.stringify(prior);
    buildHudOnlyManifest(prior, '9.9.9', 'user', NOW);
    expect(JSON.stringify(prior)).toBe(snapshot);
  });

  it('with no prior install records a HUD-only fresh install', () => {
    const result = buildHudOnlyManifest(null, '9.9.9', 'user', NOW);
    expect(result).toMatchObject({
      version: '9.9.9',
      plugins: [],
      scope: 'user',
      installedAt: NOW,
      updatedAt: NOW,
      features: { hud: true, ambient: false, memory: false, learning: false, knowledge: false, rules: false, proxy: false },
    });
    expect(result.features.tracker.provider).toBe('github');
    expect(result.features.compliance).toEqual({ enabled: false, frameworks: [] });
  });
});

describe('formatMachineSwitchSummary', () => {
  const CMD = 'devflow learning --enable';

  it('a machine-wide off says so, whatever the project says', () => {
    expect(formatMachineSwitchSummary(false, true, CMD)).toBe('disabled in every project');
    expect(formatMachineSwitchSummary(false, null, CMD)).toBe('disabled in every project');
    expect(formatMachineSwitchSummary(false, false, CMD)).toBe('disabled in every project');
  });

  it('on machine-wide but off in this project names the per-repo command', () => {
    const line = formatMachineSwitchSummary(true, false, CMD);
    expect(line).toContain('enabled');
    expect(line).toContain('off in this project');
    expect(line).toContain(CMD);
  });

  it('on machine-wide and not narrowed here is plainly enabled', () => {
    expect(formatMachineSwitchSummary(true, true, CMD)).toBe('enabled');
    expect(formatMachineSwitchSummary(true, null, CMD)).toBe('enabled');
  });
});

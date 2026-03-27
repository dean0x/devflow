import { describe, it, expect } from 'vitest';
import {
  formatFeatures,
  resolveScope,
  getPluginInstallStatus,
  formatPluginCommands,
} from '../src/cli/commands/list.js';
import type { ManifestData } from '../src/cli/utils/manifest.js';

describe('formatFeatures', () => {
  it('returns all enabled features comma-separated', () => {
    const features: ManifestData['features'] = { teams: true, ambient: true, memory: true };
    expect(formatFeatures(features)).toBe('teams, ambient, memory');
  });

  it('returns subset of enabled features', () => {
    const features: ManifestData['features'] = { teams: false, ambient: true, memory: true };
    expect(formatFeatures(features)).toBe('ambient, memory');
  });

  it('returns single enabled feature', () => {
    const features: ManifestData['features'] = { teams: true, ambient: false, memory: false };
    expect(formatFeatures(features)).toBe('teams');
  });

  it('returns "none" when no features are enabled', () => {
    const features: ManifestData['features'] = { teams: false, ambient: false, memory: false };
    expect(formatFeatures(features)).toBe('none');
  });

  it('preserves feature order: teams, ambient, memory', () => {
    const features: ManifestData['features'] = { teams: true, ambient: false, memory: true };
    expect(formatFeatures(features)).toBe('teams, memory');
  });

  it('includes flags count when flags are present', () => {
    const features: ManifestData['features'] = {
      teams: true, ambient: false, memory: false, hud: false, learn: false,
      flags: ['tool-search', 'lsp', 'clear-context-on-plan'],
    };
    expect(formatFeatures(features)).toBe('teams, flags: 3');
  });

  it('omits flags when flags array is empty', () => {
    const features: ManifestData['features'] = {
      teams: true, ambient: false, memory: false, hud: false, learn: false,
      flags: [],
    };
    expect(formatFeatures(features)).toBe('teams');
  });

  it('shows only flags when no boolean features are enabled', () => {
    const features: ManifestData['features'] = {
      teams: false, ambient: false, memory: false, hud: false, learn: false,
      flags: ['lsp'],
    };
    expect(formatFeatures(features)).toBe('flags: 1');
  });

  it('handles missing flags gracefully for legacy manifests', () => {
    const features = { teams: true, ambient: false, memory: false } as ManifestData['features'];
    expect(formatFeatures(features)).toBe('teams');
  });
});

describe('resolveScope', () => {
  it('returns "local" when local manifest exists', () => {
    const localManifest: ManifestData = {
      version: '1.0.0',
      plugins: [],
      scope: 'local',
      features: { teams: false, ambient: false, memory: false },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(resolveScope(localManifest)).toBe('local');
  });

  it('returns "user" when local manifest is null', () => {
    expect(resolveScope(null)).toBe('user');
  });
});

describe('getPluginInstallStatus', () => {
  const installedPlugins = new Set(['devflow-core-skills', 'devflow-implement']);

  it('returns "installed" for a plugin in the installed set', () => {
    expect(getPluginInstallStatus('devflow-core-skills', installedPlugins, true)).toBe('installed');
  });

  it('returns "not_installed" for a plugin not in the installed set', () => {
    expect(getPluginInstallStatus('devflow-debug', installedPlugins, true)).toBe('not_installed');
  });

  it('returns "unknown" when no manifest exists', () => {
    expect(getPluginInstallStatus('devflow-core-skills', installedPlugins, false)).toBe('unknown');
  });

  it('returns "unknown" when no manifest, even with empty set', () => {
    expect(getPluginInstallStatus('devflow-implement', new Set(), false)).toBe('unknown');
  });
});

describe('formatPluginCommands', () => {
  it('returns comma-separated commands', () => {
    expect(formatPluginCommands(['/implement'])).toBe('/implement');
  });

  it('joins multiple commands with comma', () => {
    expect(formatPluginCommands(['/code-review', '/resolve'])).toBe('/code-review, /resolve');
  });

  it('returns "(skills only)" for empty commands array', () => {
    expect(formatPluginCommands([])).toBe('(skills only)');
  });
});

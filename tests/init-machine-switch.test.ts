/**
 * The pure --hud-only manifest (D-HUD-ONLY-PRESERVE) behind init's
 * machine-wide feature record (#378, D-FEATURES-NARROW-ONLY). The end-to-end
 * behaviour is pinned in init-machine-switch-e2e.test.ts; these cover the arms a
 * sandboxed CLI run cannot reach cheaply.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildHudOnlyManifest, drainDisabledFeatureQueues, type DisabledQueueDrainIO } from '../src/cli/commands/init.js';
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
    const result = buildHudOnlyManifest(prior, '9.9.9', NOW);
    expect(result).toEqual({ ...prior, features: { ...prior.features, hud: true }, updatedAt: NOW });
  });

  it('keeps the prior version — --hud-only reinstalls no plugin', () => {
    expect(buildHudOnlyManifest(fullInstall(), '9.9.9', NOW).version).toBe('3.1.0');
  });

  it('never mutates the manifest it was given', () => {
    const prior = fullInstall();
    const snapshot = JSON.stringify(prior);
    buildHudOnlyManifest(prior, '9.9.9', NOW);
    expect(JSON.stringify(prior)).toBe(snapshot);
  });

  it('with no prior install records a HUD-only fresh install', () => {
    const result = buildHudOnlyManifest(null, '9.9.9', NOW);
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

describe('drainDisabledFeatureQueues (D-INIT-DRAIN-AFTER-SWITCH)', () => {
  const ROOT = '/repo';

  function recorder(): { calls: string[]; io: DisabledQueueDrainIO } {
    const calls: string[] = [];
    return {
      calls,
      io: {
        drainMemoryQueue: async (r) => { calls.push(`memory:${r}`); return { drained: true }; },
        drainLearningQueue: async (r) => { calls.push(`learning:${r}`); return { drained: true }; },
      },
    };
  }

  it('drains the queue of every feature switched off once the switch is persisted, with nothing to report', async () => {
    const { calls, io } = recorder();
    const refused = await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: false, learningEnabled: false, manifestWritten: true }, io);
    expect(calls).toEqual([`memory:${ROOT}`, `learning:${ROOT}`]);
    expect(refused).toEqual([]);
  });

  it('returns one warning per drain refused at a linked folder, naming the queue and the link (D-CLI-NO-SYMLINK)', async () => {
    const io: DisabledQueueDrainIO = {
      drainMemoryQueue: async (r) => ({ drained: false, linkedFolder: `${r}/.devflow/memory` }),
      drainLearningQueue: async (r) => ({ drained: false, linkedFolder: `${r}/.devflow` }),
    };
    const refused = await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: false, learningEnabled: false, manifestWritten: true }, io);
    expect(refused).toEqual([
      expect.stringMatching(/memory queue.*\/repo\/\.devflow\/memory is a symbolic link/),
      expect.stringMatching(/learning queue.*\/repo\/\.devflow is a symbolic link/),
    ]);
  });

  it('with the real drains: linked memory and learning folders lose nothing, and both refusals are returned (D-CLI-NO-SYMLINK)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-init-drain-linked-'));
    vi.stubEnv('HOME', path.join(tmp, 'home'));
    try {
      const repo = path.join(tmp, 'repo');
      const outside = path.join(tmp, 'outside');
      const queue = path.join(outside, '.pending-turns.jsonl');
      await fs.mkdir(path.join(repo, '.devflow'), { recursive: true });
      await fs.mkdir(outside);
      await fs.writeFile(queue, 'a file outside the project\n');
      await fs.symlink(outside, path.join(repo, '.devflow', 'memory'));
      await fs.symlink(outside, path.join(repo, '.devflow', 'learning'));

      const refused = await drainDisabledFeatureQueues({ gitRoot: repo, ledgerRoot: repo, memoryEnabled: false, learningEnabled: false, manifestWritten: true });

      expect(await fs.readFile(queue, 'utf-8'), 'nothing is deleted through either link').toBe('a file outside the project\n');
      expect(refused).toHaveLength(2);
      expect(refused[0]).toContain(`${path.join(repo, '.devflow', 'memory')} is a symbolic link`);
      expect(refused[1]).toContain(`${path.join(repo, '.devflow', 'learning')} is a symbolic link`);
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('drains only the features that are off', async () => {
    const memOff = recorder();
    await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: false, learningEnabled: true, manifestWritten: true }, memOff.io);
    expect(memOff.calls).toEqual([`memory:${ROOT}`]);

    const learnOff = recorder();
    await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: true, learningEnabled: false, manifestWritten: true }, learnOff.io);
    expect(learnOff.calls).toEqual([`learning:${ROOT}`]);
  });

  it('drains learning at the ledger root and memory at this checkout (D-LEDGER-MAIN-WORKTREE)', async () => {
    // In a linked worktree the hooks queue learning turns into the main
    // checkout's ledger, while working memory stays per checkout.
    const { calls, io } = recorder();
    await drainDisabledFeatureQueues({ gitRoot: '/repo-wt', ledgerRoot: '/repo', memoryEnabled: false, learningEnabled: false, manifestWritten: true }, io);
    expect(calls).toEqual(['memory:/repo-wt', 'learning:/repo']);
  });

  it('drains nothing when the manifest was not written — the switch is still on, so the turns are live', async () => {
    const { calls, io } = recorder();
    await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: false, learningEnabled: false, manifestWritten: false }, io);
    expect(calls).toEqual([]);
  });

  it('drains nothing outside a git repository', async () => {
    const { calls, io } = recorder();
    await drainDisabledFeatureQueues({ gitRoot: null, ledgerRoot: null, memoryEnabled: false, learningEnabled: false, manifestWritten: true }, io);
    expect(calls).toEqual([]);
  });

  it('init calls it only after the manifest write, never before (a concurrent session could refill the queue)', () => {
    const src = readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'cli', 'commands', 'init.ts'), 'utf-8');
    const persistAt = src.indexOf('await persistManifestThenConvergeTracker({');
    const drainCalls = [...src.matchAll(/await drainDisabledFeatureQueues\(/g)].map(m => m.index ?? -1);
    expect(persistAt).toBeGreaterThan(-1);
    expect(drainCalls).toHaveLength(1);
    expect(drainCalls[0]).toBeGreaterThan(persistAt);
    // No direct drain remains in the action body ahead of the manifest write.
    expect(src.slice(0, persistAt)).not.toMatch(/await drain(Memory|Learning)Queue\(gitRoot\)/);
  });
});

describe('init --security none clears the managed deny list too', () => {
  // The managed-settings path is a root-owned system file with no env seam, so
  // the e2e re-init covers only the user-settings arm; this pins the managed arm.
  const src = readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'cli', 'commands', 'init.ts'), 'utf-8');

  it('the `none` branch calls removeManagedDenyList when a managed deny list was detected', () => {
    const noneAt = src.indexOf("} else if (securityMode === 'none') {");
    expect(noneAt).toBeGreaterThan(-1);
    // The branch ends at the exhaustive guard that follows it.
    const endAt = src.indexOf('const _exhaustive: never = securityMode;', noneAt);
    expect(endAt).toBeGreaterThan(noneAt);
    const branch = src.slice(noneAt, endAt);

    expect(branch).toContain('await stripUserSecurityDenyList(userSettingsPath)');
    const guardAt = branch.indexOf('if (managedDenyDetected) {');
    const removeAt = branch.indexOf('await removeManagedDenyList(rootDir, verbose)');
    expect(guardAt).toBeGreaterThan(-1);
    expect(removeAt, 'the managed removal runs inside the detection guard').toBeGreaterThan(guardAt);
    // The outcome is reported, never thrown.
    expect(branch).toMatch(/describeManagedDenyRemoval\(await removeManagedDenyList\(rootDir, verbose\)\)/);
  });

  it('the detection guard is set from the managed file\'s parse-safe deny state', () => {
    expect(src).toMatch(/detectDenyState\(userSettingsJson, managedExists, managedContentJson\)/);
    expect(src).toContain('managedDenyDetected = detected.managed;');
  });
});

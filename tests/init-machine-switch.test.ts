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
import {
  buildHudOnlyManifest,
  drainDisabledFeatureQueues,
  formatHudOnlySkew,
  lookupDrainLedgerRoot,
  lookupOwnLedgerRoot,
  moveCurationData,
  type DisabledQueueDrainIO,
} from '../src/cli/commands/init.js';
import { LEDGER_ROOT_TIMEOUT_MS, type LedgerRootLookup } from '../src/core/ledger-root.js';
import { installedVersionMatches } from '../src/targets/claude-code/curation-install.js';
import { MOVE_SKIP_NOTICE } from '../src/core/curation-move-skip.js';
import { initGitRepo, pathWithFailingGit, snapshotTree, trackInGit } from './decisions/curation-fixtures.js';
import type { ManifestData } from '../src/core/manifest.js';

const NOW = '2026-09-26T00:00:00.000Z';

function fullInstall(): ManifestData {
  return {
    version: '3.1.0',
    plugins: ['devflow-implement', 'devflow-code-review'],
    scope: 'user',
    knownPlugins: ['devflow-implement', 'devflow-code-review'],
    features: {
      ambient: true, memory: true, hud: false, knowledge: true, curation: true, rules: true,
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
      features: { hud: true, ambient: false, memory: false, curation: false, knowledge: false, rules: false, proxy: false },
    });
    expect(result.features.tracker.provider).toBe('github');
    expect(result.features.compliance).toEqual({ enabled: false, frameworks: [] });
  });
});

describe('buildHudOnlyManifest keeps the machine gate level', () => {
  it.each([
    ['a valid level', 'lean'],
    ['a malformed level', 'Lean'],
    ['null', null],
  ])('over a prior install keeps a stored %s as it is', (_label, value) => {
    const prior = fullInstall();
    prior.features.gateLevel = value;
    const result = buildHudOnlyManifest(prior, '9.9.9', NOW);
    expect(Object.hasOwn(result.features, 'gateLevel')).toBe(true);
    expect(result.features.gateLevel).toBe(value);
  });

  it('over a prior install with no key writes none', () => {
    const result = buildHudOnlyManifest(fullInstall(), '9.9.9', NOW);
    expect(Object.hasOwn(result.features, 'gateLevel')).toBe(false);
  });

  it('a fresh record holds no key', () => {
    const result = buildHudOnlyManifest(null, '9.9.9', NOW);
    expect(Object.hasOwn(result.features, 'gateLevel')).toBe(false);
  });

  it.each([
    ['a valid level', 'lean'],
    ['a malformed level', 'Lean'],
    ['null', null],
  ])('a fresh record keeps %s read raw from a manifest readManifest refused', (_label, value) => {
    const result = buildHudOnlyManifest(null, '9.9.9', NOW, value);
    expect(Object.hasOwn(result.features, 'gateLevel')).toBe(true);
    expect(result.features.gateLevel).toBe(value);
  });

  it('a fresh record holds no key when the refused manifest stored none', () => {
    const result = buildHudOnlyManifest(null, '9.9.9', NOW, undefined);
    expect(Object.hasOwn(result.features, 'gateLevel')).toBe(false);
  });

  it('over a prior install the prior level wins over a level read from a refused manifest', () => {
    const prior = fullInstall();
    prior.features.gateLevel = 'lean';
    expect(buildHudOnlyManifest(prior, '9.9.9', NOW, 'full').features.gateLevel).toBe('lean');
  });
});

describe('installedVersionMatches', () => {
  it('is true only when the recorded and running versions are equal', () => {
    expect(installedVersionMatches('3.3.0', '3.3.0')).toBe(true);
    expect(installedVersionMatches('3.2.0', '3.3.0')).toBe(false);
    expect(installedVersionMatches('3.4.0', '3.3.0')).toBe(false);
  });

  it('known-bad probe: an unknown running version is a difference, never a match', () => {
    expect(installedVersionMatches('3.3.0', null)).toBe(false);
  });
});

describe('formatHudOnlySkew', () => {
  it('says nothing when the versions agree', () => {
    expect(formatHudOnlySkew('3.3.0', '3.3.0')).toBeNull();
  });

  it('says nothing when no version is recorded (a fresh install, an unreadable manifest)', () => {
    expect(formatHudOnlySkew(null, '3.3.0')).toBeNull();
    expect(formatHudOnlySkew(null, null)).toBeNull();
  });

  it.each([
    ['an older recorded version', '3.2.0', '3.3.0'],
    ['a newer recorded version', '3.4.0', '3.3.0'],
  ])('names both versions and ends with the remedy for %s', (_label, recorded, running) => {
    const message = formatHudOnlySkew(recorded, running);
    expect(message).toContain(`devflow ${recorded}`);
    expect(message).toContain(`CLI is ${running}`);
    expect(message?.endsWith('run `devflow init` to update the prompts.')).toBe(true);
  });

  it('an unknown running version is a difference and says so', () => {
    const message = formatHudOnlySkew('3.3.0', null);
    expect(message).toContain('devflow 3.3.0');
    expect(message).toContain('of unknown version');
    expect(message).toContain('`devflow init`');
  });

  it('prints a recorded version with its control characters replaced', () => {
    // The manifest check on `version` is only that it is truthy, so a hand-edited
    // file can put terminal escapes and a newline in it. The escapes are written
    // as source escapes: tests/guards/no-control-bytes.test.ts forbids raw bytes.
    const message = formatHudOnlySkew('3.2.0\u001b[31m\u0007\n', '3.3.0');
    expect(message).toContain('devflow 3.2.0?[31m??');
    expect([...(message ?? '')].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)).toBe(false);
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
        drainCurationQueue: async (r) => { calls.push(`curation:${r}`); return { drained: true }; },
      },
    };
  }

  it('drains the queue of every feature switched off once the switch is persisted, with nothing to report', async () => {
    const { calls, io } = recorder();
    const refused = await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: false, curationEnabled: false, manifestWritten: true }, io);
    expect(calls).toEqual([`memory:${ROOT}`, `curation:${ROOT}`]);
    expect(refused).toEqual([]);
  });

  it('returns one warning per drain refused at a linked folder, naming the queue and the link (D-CLI-NO-SYMLINK)', async () => {
    const io: DisabledQueueDrainIO = {
      drainMemoryQueue: async (r) => ({ drained: false, linkedFolder: `${r}/.devflow/memory` }),
      drainCurationQueue: async (r) => ({ drained: false, linkedFolder: `${r}/.devflow` }),
    };
    const refused = await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: false, curationEnabled: false, manifestWritten: true }, io);
    expect(refused).toEqual([
      expect.stringMatching(/memory queue.*\/repo\/\.devflow\/memory is a symbolic link/),
      expect.stringMatching(/curation queue.*\/repo\/\.devflow is a symbolic link/),
    ]);
  });

  it('returns the warning of a curation drain that could not list the backups, and still drains memory first', async () => {
    const calls: string[] = [];
    const io: DisabledQueueDrainIO = {
      drainMemoryQueue: async (r) => { calls.push(`memory:${r}`); return { drained: true }; },
      drainCurationQueue: async (r) => { calls.push(`curation:${r}`); return { drained: true, warning: 'The queue files of the backup folders were not drained: EACCES' }; },
    };
    const refused = await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: false, curationEnabled: false, manifestWritten: true }, io);
    expect(calls).toEqual([`memory:${ROOT}`, `curation:${ROOT}`]);
    expect(refused).toEqual(['The queue files of the backup folders were not drained: EACCES']);
  });

  it.skipIf(process.getuid?.() === 0)('with the real drains: a backup folder that cannot be read gives a warning, and the live queue is still drained', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-init-drain-unreadable-'));
    vi.stubEnv('HOME', path.join(tmp, 'home'));
    const backup = path.join(tmp, 'repo', '.devflow', 'learning.backup-20261017T020304Z-ab12cd34');
    try {
      const repo = path.join(tmp, 'repo');
      const live = path.join(repo, '.devflow', 'curation', '.pending-turns.jsonl');
      await fs.mkdir(backup, { recursive: true });
      await fs.writeFile(path.join(backup, '.pending-turns.jsonl'), '{"role":"user"}\n');
      await fs.mkdir(path.dirname(live), { recursive: true });
      await fs.writeFile(live, '{"role":"user"}\n');
      await fs.chmod(backup, 0o000);

      const refused = await drainDisabledFeatureQueues({ gitRoot: repo, ledgerRoot: repo, memoryEnabled: true, curationEnabled: false, manifestWritten: true });

      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatch(/backup folders were not drained/);
      await expect(fs.lstat(live), 'the live queue is drained').rejects.toThrow(/ENOENT/);
    } finally {
      await fs.chmod(backup, 0o755).catch(() => undefined);
      vi.unstubAllEnvs();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('with the real drains: linked memory and curation folders lose nothing, and both refusals are returned (D-CLI-NO-SYMLINK)', async () => {
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
      await fs.symlink(outside, path.join(repo, '.devflow', 'curation'));

      const refused = await drainDisabledFeatureQueues({ gitRoot: repo, ledgerRoot: repo, memoryEnabled: false, curationEnabled: false, manifestWritten: true });

      expect(await fs.readFile(queue, 'utf-8'), 'nothing is deleted through either link').toBe('a file outside the project\n');
      expect(refused).toHaveLength(2);
      expect(refused[0]).toContain(`${path.join(repo, '.devflow', 'memory')} is a symbolic link`);
      expect(refused[1]).toContain(`${path.join(repo, '.devflow', 'curation')} is a symbolic link`);
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('with the real drains: curation off also removes the pending rows of the backups a move left, and keeps their ledger', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-init-drain-backup-'));
    vi.stubEnv('HOME', path.join(tmp, 'home'));
    try {
      const repo = path.join(tmp, 'repo');
      const backup = path.join(repo, '.devflow', 'learning.backup-20261017T020304Z-ab12cd34');
      await fs.mkdir(backup, { recursive: true });
      const pending = ['.pending-turns.jsonl', '.pending-turns.jsonl.overflow-20261017T020304Z-00000001'];
      for (const file of [...pending, 'decisions-ledger.jsonl']) await fs.writeFile(path.join(backup, file), '{"role":"user"}\n');

      const refused = await drainDisabledFeatureQueues({ gitRoot: repo, ledgerRoot: repo, memoryEnabled: true, curationEnabled: false, manifestWritten: true });

      expect(refused).toEqual([]);
      expect(await fs.readdir(backup)).toEqual(['decisions-ledger.jsonl']);
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns the fixed notice of a curation drain that left the project alone, and still drains memory first', async () => {
    const calls: string[] = [];
    const io: DisabledQueueDrainIO = {
      drainMemoryQueue: async (r) => { calls.push(`memory:${r}`); return { drained: true }; },
      drainCurationQueue: async (r) => { calls.push(`curation:${r}`); return { drained: false, skipped: 'tracked' }; },
    };
    const refused = await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: false, curationEnabled: false, manifestWritten: true }, io);
    expect(calls).toEqual([`memory:${ROOT}`, `curation:${ROOT}`]);
    expect(refused).toEqual([expect.stringContaining(MOVE_SKIP_NOTICE.tracked)]);
  });

  describe.each(['tracked', 'unknown'] as const)('with the real drains: the tracked-folder check answers %s', (reason) => {
    it('curation off deletes no curation file, returns the fixed notice, and still drains the memory queue', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-init-drain-skip-'));
      vi.stubEnv('HOME', path.join(tmp, 'home'));
      try {
        const repo = path.join(tmp, 'repo');
        await fs.mkdir(repo);
        initGitRepo(repo);
        const queue = '.pending-turns.jsonl';
        for (const dir of ['learning', 'curation', 'memory']) {
          await fs.mkdir(path.join(repo, '.devflow', dir), { recursive: true });
          await fs.writeFile(path.join(repo, '.devflow', dir, queue), '{"role":"user"}\n');
        }
        if (reason === 'tracked') trackInGit(repo, `.devflow/learning/${queue}`);
        else vi.stubEnv('PATH', pathWithFailingGit(tmp));
        const curationFolders = (): Map<string, string> => new Map([
          ...snapshotTree(path.join(repo, '.devflow', 'learning')),
          ...[...snapshotTree(path.join(repo, '.devflow', 'curation'))].map(([k, v]) => [`curation/${k}`, v] as const),
        ]);
        const before = curationFolders();

        const refused = await drainDisabledFeatureQueues({ gitRoot: repo, ledgerRoot: repo, memoryEnabled: false, curationEnabled: false, manifestWritten: true });

        expect(curationFolders()).toEqual(before);
        expect(refused).toEqual([expect.stringContaining(MOVE_SKIP_NOTICE[reason])]);
        await expect(fs.lstat(path.join(repo, '.devflow', 'memory', queue)), 'the memory queue is drained').rejects.toThrow(/ENOENT/);
      } finally {
        vi.unstubAllEnvs();
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  it('drains only the features that are off', async () => {
    const memOff = recorder();
    await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: false, curationEnabled: true, manifestWritten: true }, memOff.io);
    expect(memOff.calls).toEqual([`memory:${ROOT}`]);

    const curationOff = recorder();
    await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: true, curationEnabled: false, manifestWritten: true }, curationOff.io);
    expect(curationOff.calls).toEqual([`curation:${ROOT}`]);
  });

  it('drains curation at the ledger root and memory at this checkout (D-LEDGER-MAIN-WORKTREE)', async () => {
    // In a linked worktree the hooks queue curation turns into the main
    // checkout's ledger, while working memory stays per checkout.
    const { calls, io } = recorder();
    await drainDisabledFeatureQueues({ gitRoot: '/repo-wt', ledgerRoot: '/repo', memoryEnabled: false, curationEnabled: false, manifestWritten: true }, io);
    expect(calls).toEqual(['memory:/repo-wt', 'curation:/repo']);
  });

  it('drains nothing when the manifest was not written — the switch is still on, so the turns are live', async () => {
    const { calls, io } = recorder();
    await drainDisabledFeatureQueues({ gitRoot: ROOT, ledgerRoot: ROOT, memoryEnabled: false, curationEnabled: false, manifestWritten: false }, io);
    expect(calls).toEqual([]);
  });

  it('drains nothing outside a git repository', async () => {
    const { calls, io } = recorder();
    await drainDisabledFeatureQueues({ gitRoot: null, ledgerRoot: null, memoryEnabled: false, curationEnabled: false, manifestWritten: true }, io);
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
    expect(src.slice(0, persistAt)).not.toMatch(/await drain(Memory|Curation)Queue\(gitRoot\)/);
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

describe("init asks for its own repository's ledger root within the shared budget", () => {
  const timedOut = async (): Promise<LedgerRootLookup> => ({ kind: 'timed-out' });

  describe('lookupOwnLedgerRoot', () => {
    it('asks nothing outside a git repository', async () => {
      const lookup = vi.fn(async (): Promise<LedgerRootLookup> => ({ kind: 'root', root: '/repo' }));
      expect(await lookupOwnLedgerRoot(null, lookup)).toEqual({ root: null, timedOut: false });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('passes the shared timeout to the lookup, so a hung mount cannot stall init', async () => {
      const lookup = vi.fn(async (): Promise<LedgerRootLookup> => ({ kind: 'root', root: '/main' }));
      expect(await lookupOwnLedgerRoot('/repo-wt', lookup)).toEqual({ root: '/main', timedOut: false });
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup.mock.calls[0][1]).toEqual({ timeoutMs: LEDGER_ROOT_TIMEOUT_MS });
    });

    it('a timeout is no ledger root, and says it timed out', async () => {
      expect(await lookupOwnLedgerRoot('/repo', timedOut)).toEqual({ root: null, timedOut: true });
    });

    it('an answer of no work tree is no ledger root, and no timeout', async () => {
      expect(await lookupOwnLedgerRoot('/repo', async () => ({ kind: 'no-root' }))).toEqual({ root: null, timedOut: false });
    });
  });

  describe('lookupDrainLedgerRoot', () => {
    it('asks nothing while curation is on: there is nothing to drain', async () => {
      const lookup = vi.fn(timedOut);
      expect(await lookupDrainLedgerRoot({ gitRoot: '/repo', curationEnabled: true, manifestWritten: true }, lookup)).toEqual({ ledgerRoot: null, warning: null });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('asks nothing, and prints nothing, when the manifest was not written: the drain does not run', async () => {
      const lookup = vi.fn(timedOut);
      expect(await lookupDrainLedgerRoot({ gitRoot: '/repo', curationEnabled: false, manifestWritten: false }, lookup)).toEqual({ ledgerRoot: null, warning: null });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('asks nothing outside a git repository', async () => {
      const lookup = vi.fn(timedOut);
      expect(await lookupDrainLedgerRoot({ gitRoot: null, curationEnabled: false, manifestWritten: true }, lookup)).toEqual({ ledgerRoot: null, warning: null });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('answers the ledger root, with the shared timeout', async () => {
      const lookup = vi.fn(async (): Promise<LedgerRootLookup> => ({ kind: 'root', root: '/main' }));
      expect(await lookupDrainLedgerRoot({ gitRoot: '/repo-wt', curationEnabled: false, manifestWritten: true }, lookup)).toEqual({ ledgerRoot: '/main', warning: null });
      expect(lookup.mock.calls[0][1]).toEqual({ timeoutMs: LEDGER_ROOT_TIMEOUT_MS });
    });

    it('a timeout drains nothing and prints one line that names the repository', async () => {
      const answer = await lookupDrainLedgerRoot({ gitRoot: '/repo', curationEnabled: false, manifestWritten: true }, timedOut);
      expect(answer.ledgerRoot).toBeNull();
      expect(answer.warning).toBe('The curation queue was not drained for /repo: git did not answer in time. The next init tries again.');
    });

    it('prints the repository name with its control characters replaced', async () => {
      const answer = await lookupDrainLedgerRoot({ gitRoot: '/re\u001b[31mpo\n', curationEnabled: false, manifestWritten: true }, timedOut);
      expect([...(answer.warning ?? '')].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)).toBe(false);
    });
  });

  describe('moveCurationData', () => {
    async function withDirs<T>(body: (dirs: { base: string; home: string; devflowDir: string }) => Promise<T>): Promise<T> {
      const base = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-init-own-root-'));
      try {
        const home = path.join(base, 'home');
        const devflowDir = path.join(home, '.devflow');
        await fs.mkdir(devflowDir, { recursive: true });
        return await body({ base, home, devflowDir });
      } finally {
        await fs.rm(base, { recursive: true, force: true });
      }
    }

    it('an own-root lookup that times out moves nothing, and prints one skipped line for the repository', async () => {
      await withDirs(async ({ base, home, devflowDir }) => {
        const repo = path.join(base, 'repo');
        const other = path.join(base, 'other');
        await fs.mkdir(path.join(repo, '.devflow', 'learning'), { recursive: true });
        await fs.mkdir(other);

        const report = await moveCurationData({ discoveredProjects: [other], gitRoot: repo, homeDir: home, devflowDir }, timedOut);

        expect(report.movedCount).toBe(0);
        expect(report.lines.filter((line) => line.includes(repo))).toEqual([
          `Ledger move skipped for ${repo}: git did not answer in time. Nothing was moved. The next init or session start tries again.`,
        ]);
        await expect(fs.stat(path.join(repo, '.devflow', 'learning'))).resolves.toBeTruthy();
      });
    });

    it('does not print the line twice when the step already covers the repository as a project root', async () => {
      await withDirs(async ({ base, home, devflowDir }) => {
        const repo = path.join(base, 'repo');
        await fs.mkdir(repo);

        const report = await moveCurationData({ discoveredProjects: [], gitRoot: repo, homeDir: home, devflowDir }, timedOut);

        expect(report.lines.filter((line) => line.includes('git did not answer in time'))).toHaveLength(0);
      });
    });

    it('asks for no own root outside a git repository', async () => {
      await withDirs(async ({ home, devflowDir }) => {
        const lookup = vi.fn(timedOut);
        const report = await moveCurationData({ discoveredProjects: [], gitRoot: null, homeDir: home, devflowDir }, lookup);
        expect(lookup).not.toHaveBeenCalled();
        expect(report.lines).toEqual([]);
      });
    });
  });

  it('init.ts never asks for a ledger root without a time budget', () => {
    const src = readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'cli', 'commands', 'init.ts'), 'utf-8');
    expect(src).not.toMatch(/\bgetLedgerRoot\(\s*\)/);
    expect(src).toMatch(/timeoutMs:\s*LEDGER_ROOT_TIMEOUT_MS/);
  });
});

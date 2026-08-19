import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readAppliedMigrations,
  writeAppliedMigrations,
  runMigrations,
  reportMigrationResult,
  MIGRATIONS,
  type Migration,
  type MigrationLogger,
  type RunMigrationsResult,
} from '../src/core/migrations.js';
import { LEGACY_AGENT_KEYS } from '../src/core/agent-models.js';

describe('readAppliedMigrations', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-migrations-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when file does not exist', async () => {
    const result = await readAppliedMigrations(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns applied list when file exists', async () => {
    const filePath = path.join(tmpDir, 'migrations.json');
    await fs.writeFile(filePath, JSON.stringify({ applied: ['migration-a', 'migration-b'] }), 'utf-8');
    const result = await readAppliedMigrations(tmpDir);
    expect(result).toEqual(['migration-a', 'migration-b']);
  });

  it('returns empty array when file is malformed JSON', async () => {
    const filePath = path.join(tmpDir, 'migrations.json');
    await fs.writeFile(filePath, 'not valid json', 'utf-8');
    const result = await readAppliedMigrations(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns empty array when applied field is missing', async () => {
    const filePath = path.join(tmpDir, 'migrations.json');
    await fs.writeFile(filePath, JSON.stringify({ something: 'else' }), 'utf-8');
    const result = await readAppliedMigrations(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns empty array when applied field is not an array', async () => {
    const filePath = path.join(tmpDir, 'migrations.json');
    await fs.writeFile(filePath, JSON.stringify({ applied: 'not-an-array' }), 'utf-8');
    const result = await readAppliedMigrations(tmpDir);
    expect(result).toEqual([]);
  });
});

describe('writeAppliedMigrations', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-migrations-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates migrations.json atomically (no .tmp file left behind)', async () => {
    await writeAppliedMigrations(tmpDir, ['migration-a']);
    const filePath = path.join(tmpDir, 'migrations.json');
    await expect(fs.access(filePath)).resolves.toBeUndefined();
    await expect(fs.access(`${filePath}.tmp`)).rejects.toThrow();
  });

  it('writes the correct applied list', async () => {
    await writeAppliedMigrations(tmpDir, ['migration-a', 'migration-b']);
    const result = await readAppliedMigrations(tmpDir);
    expect(result).toEqual(['migration-a', 'migration-b']);
  });

  it('overwrites existing file', async () => {
    await writeAppliedMigrations(tmpDir, ['migration-a']);
    await writeAppliedMigrations(tmpDir, ['migration-a', 'migration-b']);
    const result = await readAppliedMigrations(tmpDir);
    expect(result).toEqual(['migration-a', 'migration-b']);
  });

  it('creates devflowDir if it does not exist', async () => {
    const nestedDir = path.join(tmpDir, 'nested', 'devflow');
    await writeAppliedMigrations(nestedDir, ['migration-a']);
    const result = await readAppliedMigrations(nestedDir);
    expect(result).toEqual(['migration-a']);
  });
});

describe('MIGRATIONS', () => {
  it('contains canonicalise-agent-keys-v1 as the first entry', () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(1);
    const entry = MIGRATIONS.find(m => m.id === 'canonicalise-agent-keys-v1');
    expect(entry).toBeDefined();
    expect(entry!.scope).toBe('global');
  });

  it('has unique IDs', () => {
    const ids = MIGRATIONS.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every migration has required fields', () => {
    for (const m of MIGRATIONS) {
      expect(m.id).toBeTruthy();
      expect(m.description).toBeTruthy();
      expect(['global', 'per-project']).toContain(m.scope);
      expect(typeof m.run).toBe('function');
    }
  });
});

describe('runMigrations', () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-run-migrations-test-'));
    // Redirect os.homedir() by overriding HOME so migrations.ts uses our tmpDir
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, 'home');
    // Pre-create the .devflow dir under fake home
    await fs.mkdir(path.join(tmpDir, 'home', '.devflow'), { recursive: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * registryOverride is the seam for isolated testing — pass a stub registry
   * as the third argument to runMigrations. The live MIGRATIONS export is
   * empty; tests that need entry behavior supply their own Migration objects
   * inline.
   */

  it('skips already-applied migrations', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');
    const stub: Migration = {
      id: 'test-skip-stub',
      description: 'should not run',
      scope: 'global',
      run: async () => { throw new Error('should not run'); },
    };
    await writeAppliedMigrations(fakeHome, ['test-skip-stub']);

    const ctx = { devflowDir: fakeHome };
    const result = await runMigrations(ctx, [], [stub]);
    expect(result.newlyApplied).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('records newly applied migrations to state file', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');
    let ran = false;
    const stub: Migration = {
      id: 'test-record-stub',
      description: 'simple no-op stub',
      scope: 'global',
      run: async () => { ran = true; return { infos: [], warnings: [] }; },
    };

    const ctx = { devflowDir: fakeHome };
    const result = await runMigrations(ctx, [], [stub]);

    expect(result.failures).toEqual([]);
    expect(result.newlyApplied).toContain('test-record-stub');
    expect(ran).toBe(true);

    // State should be persisted
    const persisted = await readAppliedMigrations(fakeHome);
    expect(persisted).toContain('test-record-stub');
  });

  it('does not mark global migration applied when it fails, continues with other migrations', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');

    let successRan = false;
    const failingGlobal: Migration = {
      id: 'test-global-failing',
      description: 'Test: always throws',
      scope: 'global',
      run: async () => { throw new Error('simulated global failure'); },
    };
    const succeedingGlobal: Migration = {
      id: 'test-global-succeeding',
      description: 'Test: always succeeds',
      scope: 'global',
      run: async () => { successRan = true; return { infos: [], warnings: [] }; },
    };

    const ctx = { devflowDir: fakeHome };
    const result = await runMigrations(ctx, [], [failingGlobal, succeedingGlobal]);

    // Failing migration recorded in failures
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].id).toBe('test-global-failing');
    expect(result.failures[0].error.message).toContain('simulated global failure');

    // Failing migration NOT marked applied
    expect(result.newlyApplied).not.toContain('test-global-failing');

    // Succeeding migration WAS applied (failures are non-fatal, D33)
    expect(result.newlyApplied).toContain('test-global-succeeding');
    expect(successRan).toBe(true);

    // State file reflects only the successful migration
    const applied = await readAppliedMigrations(fakeHome);
    expect(applied).not.toContain('test-global-failing');
    expect(applied).toContain('test-global-succeeding');
  });

  it('records per-project failure and does not mark migration applied', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');
    const project1 = path.join(tmpDir, 'ok-project');
    const project2 = path.join(tmpDir, 'fail-project');
    await fs.mkdir(path.join(project1, '.devflow', 'learning'), { recursive: true });
    await fs.mkdir(path.join(project2, '.devflow', 'learning'), { recursive: true });

    // Create a custom per-project migration that always throws for project2
    const failingPerProjectMigration: Migration = {
      id: 'test-per-project-failing',
      description: 'Test: fails for one project',
      scope: 'per-project',
      run: async (ctx) => {
        if (ctx.projectRoot === project2) {
          throw new Error('simulated per-project failure');
        }
        return { infos: [], warnings: [] };
      },
    };

    const ctx = { devflowDir: fakeHome };
    const result = await runMigrations(ctx, [project1, project2], [failingPerProjectMigration]);

    // Should have one failure for project2
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].id).toBe('test-per-project-failing');
    expect(result.failures[0].project).toBe(project2);
    expect(result.failures[0].error.message).toContain('simulated per-project failure');

    // Migration should NOT be marked applied (one project failed)
    expect(result.newlyApplied).not.toContain('test-per-project-failing');
    const applied = await readAppliedMigrations(fakeHome);
    expect(applied).not.toContain('test-per-project-failing');
  });

  /**
   * D37 edge case: when discoveredProjects is empty, a per-project migration has
   * nothing to sweep and is marked applied via vacuous truth of
   * `results.every(r => r.status === 'fulfilled')` on an empty array. This lock-in
   * test asserts the documented behaviour — the migration is considered "done"
   * without running anywhere, and a project cloned after this point won't be
   * swept unless the marker is manually cleared.
   */
  it('marks per-project migration applied when discoveredProjects is empty (D37 edge case)', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');
    let ranAnywhere = false;

    const perProjectMigration: Migration = {
      id: 'test-per-project-empty-sweep',
      description: 'Test: per-project with no projects',
      scope: 'per-project',
      run: async () => { ranAnywhere = true; return { infos: [], warnings: [] }; },
    };

    const ctx = { devflowDir: fakeHome };
    const result = await runMigrations(ctx, [], [perProjectMigration]);

    // D37: vacuous truth — migration marked applied even though it didn't run.
    expect(ranAnywhere).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.newlyApplied).toContain('test-per-project-empty-sweep');

    const applied = await readAppliedMigrations(fakeHome);
    expect(applied).toContain('test-per-project-empty-sweep');
  });

  it('is idempotent — second call with same state does nothing new', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');
    let runCount = 0;
    const stub: Migration = {
      id: 'test-idem-stub',
      description: 'counts invocations',
      scope: 'global',
      run: async () => { runCount++; return { infos: [], warnings: [] }; },
    };

    const ctx = { devflowDir: fakeHome };
    const first = await runMigrations(ctx, [], [stub]);
    const second = await runMigrations(ctx, [], [stub]);

    expect(second.newlyApplied).toEqual([]);
    expect(second.failures).toEqual([]);
    expect(runCount).toBe(1); // only ran once
    expect(first.newlyApplied).toContain('test-idem-stub');
  });

  it('runs per-project migrations for each discovered project', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');
    const project1 = path.join(tmpDir, 'p1');
    const project2 = path.join(tmpDir, 'p2');
    await fs.mkdir(project1, { recursive: true });
    await fs.mkdir(project2, { recursive: true });

    const receivedCtxs: Array<{ scope: string; devflowDir: string; memoryDir: string; projectRoot: string }> = [];
    const stub: Migration = {
      id: 'test-per-project-fanout',
      description: 'records context for each project',
      scope: 'per-project',
      run: async (ctx) => {
        receivedCtxs.push({
          scope: ctx.scope,
          devflowDir: ctx.devflowDir,
          memoryDir: ctx.memoryDir,
          projectRoot: ctx.projectRoot,
        });
        return { infos: [], warnings: [] };
      },
    };

    const ctx = { devflowDir: fakeHome };
    const result = await runMigrations(ctx, [project1, project2], [stub]);

    expect(result.failures).toEqual([]);
    expect(result.newlyApplied).toContain('test-per-project-fanout');
    expect(receivedCtxs).toHaveLength(2);
    for (const received of receivedCtxs) {
      expect(received.scope).toBe('per-project');
      expect(received.devflowDir).toBe(fakeHome);
      expect(received.projectRoot).toBeDefined();
      expect(received.memoryDir).toBeDefined();
    }
    expect(receivedCtxs.map(c => c.projectRoot)).toContain(project1);
    expect(receivedCtxs.map(c => c.projectRoot)).toContain(project2);
  });

  it('runs global migrations against devflowDir (not project root)', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');
    let receivedCtx: { scope: string; devflowDir: string } | null = null;
    const stub: Migration = {
      id: 'test-global-ctx-stub',
      description: 'captures global context',
      scope: 'global',
      run: async (ctx) => { receivedCtx = { scope: ctx.scope, devflowDir: ctx.devflowDir }; return { infos: [], warnings: [] }; },
    };

    const ctx = { devflowDir: fakeHome };
    const result = await runMigrations(ctx, [], [stub]);

    expect(result.failures).toEqual([]);
    expect(result.newlyApplied).toContain('test-global-ctx-stub');
    expect(receivedCtx).not.toBeNull();
    expect(receivedCtx!.scope).toBe('global');
    expect(receivedCtx!.devflowDir).toBe(fakeHome);
  });

  it('aggregates infos and warnings from global and per-project migration run() results', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');
    const project1 = path.join(tmpDir, 'info-warn-project');
    await fs.mkdir(project1, { recursive: true });

    const globalMigration: Migration = {
      id: 'test-global-infos-warnings',
      description: 'Test: global migration that returns infos and warnings',
      scope: 'global',
      run: async () => ({
        infos: ['global info one', 'global info two'],
        warnings: ['global warning one'],
      }),
    };

    const perProjectMigration: Migration = {
      id: 'test-per-project-infos-warnings',
      description: 'Test: per-project migration that returns infos and warnings',
      scope: 'per-project',
      run: async () => ({
        infos: ['project info'],
        warnings: ['project warning'],
      }),
    };

    const ctx = { devflowDir: fakeHome };
    const result = await runMigrations(ctx, [project1], [globalMigration, perProjectMigration]);

    expect(result.failures).toEqual([]);
    expect(result.newlyApplied).toContain('test-global-infos-warnings');
    expect(result.newlyApplied).toContain('test-per-project-infos-warnings');

    // Global migration infos and warnings are aggregated into the result
    expect(result.infos).toContain('global info one');
    expect(result.infos).toContain('global info two');
    expect(result.warnings).toContain('global warning one');

    // Per-project migration infos and warnings are aggregated into the result
    expect(result.infos).toContain('project info');
    expect(result.warnings).toContain('project warning');
  });
});

describe('reportMigrationResult', () => {
  // Exercises the extracted reporter helper — verifies that each branch of the
  // reporting logic (failures, infos, warnings, newlyApplied, verbose) calls
  // the correct logger method with the expected message.

  function makeLogger(): { logger: MigrationLogger; calls: { method: string; msg: string }[] } {
    const calls: { method: string; msg: string }[] = [];
    const logger: MigrationLogger = {
      warn: (msg) => calls.push({ method: 'warn', msg }),
      info: (msg) => calls.push({ method: 'info', msg }),
      success: (msg) => calls.push({ method: 'success', msg }),
    };
    return { logger, calls };
  }

  const emptyResult: RunMigrationsResult = {
    newlyApplied: [], failures: [], infos: [], warnings: [],
  };

  it('does nothing when result is fully empty', () => {
    const { logger, calls } = makeLogger();
    reportMigrationResult(emptyResult, logger, false);
    expect(calls).toHaveLength(0);
  });

  it('logs warnings for each failure with project context', () => {
    const { logger, calls } = makeLogger();
    const result: RunMigrationsResult = {
      ...emptyResult,
      failures: [
        { id: 'mig-a', scope: 'per-project', project: '/abs/my-project', error: new Error('oops') },
      ],
    };
    reportMigrationResult(result, logger, false);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('warn');
    expect(calls[0].msg).toContain("'mig-a'");
    expect(calls[0].msg).toContain('my-project');
    expect(calls[0].msg).toContain('oops');
  });

  it('logs failures without project when project is absent', () => {
    const { logger, calls } = makeLogger();
    const result: RunMigrationsResult = {
      ...emptyResult,
      failures: [{ id: 'mig-b', scope: 'global', error: new Error('global fail') }],
    };
    reportMigrationResult(result, logger, false);
    expect(calls[0].msg).not.toContain(' in ');
  });

  it('logs infos via logger.info', () => {
    const { logger, calls } = makeLogger();
    const result: RunMigrationsResult = { ...emptyResult, infos: ['info-one', 'info-two'] };
    reportMigrationResult(result, logger, false);
    const infoCalls = calls.filter(c => c.method === 'info');
    expect(infoCalls.map(c => c.msg)).toEqual(['info-one', 'info-two']);
  });

  it('logs warnings via logger.warn', () => {
    const { logger, calls } = makeLogger();
    const result: RunMigrationsResult = { ...emptyResult, warnings: ['warn-one'] };
    reportMigrationResult(result, logger, false);
    const warnCalls = calls.filter(c => c.method === 'warn');
    expect(warnCalls.map(c => c.msg)).toEqual(['warn-one']);
  });

  it('emits success when newlyApplied is non-empty', () => {
    const { logger, calls } = makeLogger();
    const result: RunMigrationsResult = { ...emptyResult, newlyApplied: ['mig-x', 'mig-y'] };
    reportMigrationResult(result, logger, false);
    const successCall = calls.find(c => c.method === 'success');
    expect(successCall).toBeDefined();
    expect(successCall!.msg).toContain('2');
  });

  it('logs per-migration detail when verbose=true', () => {
    const { logger, calls } = makeLogger();
    const result: RunMigrationsResult = { ...emptyResult, newlyApplied: ['mig-x'] };
    reportMigrationResult(result, logger, true);
    const infoCalls = calls.filter(c => c.method === 'info');
    expect(infoCalls.length).toBeGreaterThanOrEqual(1);
    expect(infoCalls.some(c => c.msg.includes('mig-x'))).toBe(true);
  });

  it('does not log per-migration detail when verbose=false', () => {
    const { logger, calls } = makeLogger();
    const result: RunMigrationsResult = { ...emptyResult, newlyApplied: ['mig-x'] };
    reportMigrationResult(result, logger, false);
    const infoCalls = calls.filter(c => c.method === 'info');
    expect(infoCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// canonicalise-agent-keys-v1 migration
// ---------------------------------------------------------------------------

/**
 * Tests for the 'canonicalise-agent-keys-v1' migration entry in MIGRATIONS.
 *
 * Because the migration reads LEGACY_AGENT_KEYS at runtime, we populate it
 * in each test and restore to empty in afterEach (matching the pattern in
 * agent-models.test.ts).
 *
 * We call the migration's `run()` function directly through MIGRATIONS.find()
 * rather than through runMigrations(), so we can inspect infos/warnings without
 * the full runner machinery.
 */
describe('canonicalise-agent-keys-v1 migration', () => {
  let tmpDir: string;

  // Snapshot the shipped entries at describe-eval time so they can be
  // restored after each test. Each test starts from a known-empty map.
  const SHIPPED_ENTRIES: Record<string, string> = { ...LEGACY_AGENT_KEYS };

  beforeEach(async () => {
    // Clear the map so each test starts from a known-empty state.
    for (const key of Object.keys(LEGACY_AGENT_KEYS)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (LEGACY_AGENT_KEYS as Record<string, string>)[key];
    }
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-cak-migration-test-'));
  });

  afterEach(async () => {
    // Clear any entries added by the test body, then restore shipped state.
    for (const key of Object.keys(LEGACY_AGENT_KEYS)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (LEGACY_AGENT_KEYS as Record<string, string>)[key];
    }
    Object.assign(LEGACY_AGENT_KEYS, SHIPPED_ENTRIES);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /** Helper: find the migration entry (test will fail loudly if absent). */
  function getMigration() {
    const m = MIGRATIONS.find(m => m.id === 'canonicalise-agent-keys-v1');
    if (!m) throw new Error('canonicalise-agent-keys-v1 not found in MIGRATIONS');
    return m;
  }

  it('fast path: returns empty infos/warnings when LEGACY_AGENT_KEYS is empty', async () => {
    // beforeEach emptied the map — migration should take the fast path and no-op.
    // NOTE: the shipped map is NOT empty (13 entries); its integrity is pinned by
    // GAP-6 in agent-name-guards.test.ts, which never mutates it.
    await fs.writeFile(
      path.join(tmpDir, 'agent-models.json'),
      JSON.stringify({ version: 1, agents: { coder: { model: 'sonnet' } } }),
      'utf-8',
    );

    const result = await getMigration().run({ scope: 'global', devflowDir: tmpDir });
    expect(result.infos).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('renames legacy key and writes updated file', async () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    await fs.writeFile(
      path.join(tmpDir, 'agent-models.json'),
      JSON.stringify({ version: 1, agents: { 'old-coder': { model: 'sonnet' } } }),
      'utf-8',
    );

    const result = await getMigration().run({ scope: 'global', devflowDir: tmpDir });
    expect(result.warnings).toEqual([]);
    expect(result.infos).toHaveLength(1);
    expect(result.infos[0]).toContain('old-coder');
    expect(result.infos[0]).toContain('coder');

    // Verify the file was updated
    const updated = JSON.parse(await fs.readFile(path.join(tmpDir, 'agent-models.json'), 'utf-8')) as {
      agents: Record<string, unknown>;
    };
    expect(Object.hasOwn(updated.agents, 'coder')).toBe(true);
    expect(Object.hasOwn(updated.agents, 'old-coder')).toBe(false);
  });

  it('collision-on-disk: canonical wins, legacy dropped, warnings mention drop, infos silent', async () => {
    // Both 'coder' (legacy) and 'code' (canonical) are present.
    // Expected: 'code' (canonical) wins; 'coder' removed; warnings mention drop; no rename info.
    (LEGACY_AGENT_KEYS as Record<string, string>)['coder'] = 'code';
    await fs.writeFile(
      path.join(tmpDir, 'agent-models.json'),
      JSON.stringify({ version: 1, agents: { coder: { model: 'opus' }, code: { model: 'haiku' } } }),
      'utf-8',
    );

    const result = await getMigration().run({ scope: 'global', devflowDir: tmpDir });
    // No rename info — the legacy key was dropped, not renamed
    expect(result.infos.some(i => i.includes('renamed') && i.includes('coder'))).toBe(false);
    // Warnings must mention the drop
    expect(result.warnings.some(w => w.includes('coder') && w.toLowerCase().includes('drop'))).toBe(true);

    // On disk: 'code' present with canonical value ('haiku'), 'coder' absent
    const onDisk = JSON.parse(await fs.readFile(path.join(tmpDir, 'agent-models.json'), 'utf-8')) as {
      agents: Record<string, { model: string }>;
    };
    expect(Object.hasOwn(onDisk.agents, 'code')).toBe(true);
    expect(onDisk.agents['code'].model).toBe('haiku'); // canonical value wins
    expect(Object.hasOwn(onDisk.agents, 'coder')).toBe(false);
  });

  it('is a no-op when file does not exist', async () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    const result = await getMigration().run({ scope: 'global', devflowDir: tmpDir });
    expect(result.infos).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('is a no-op when agents field is absent', async () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    await fs.writeFile(
      path.join(tmpDir, 'agent-models.json'),
      JSON.stringify({ version: 1 }),
      'utf-8',
    );
    const result = await getMigration().run({ scope: 'global', devflowDir: tmpDir });
    expect(result.infos).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('is a no-op when no legacy keys are present in the file', async () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    // File has 'coder' (canonical), no 'old-coder'
    await fs.writeFile(
      path.join(tmpDir, 'agent-models.json'),
      JSON.stringify({ version: 1, agents: { coder: { model: 'sonnet' } } }),
      'utf-8',
    );

    const result = await getMigration().run({ scope: 'global', devflowDir: tmpDir });
    expect(result.infos).toEqual([]);
    expect(result.warnings).toEqual([]);
    // File unchanged
    const raw = JSON.parse(await fs.readFile(path.join(tmpDir, 'agent-models.json'), 'utf-8')) as {
      agents: Record<string, unknown>;
    };
    expect(Object.hasOwn(raw.agents, 'coder')).toBe(true);
  });

  it('emits warning on invalid JSON, does not throw', async () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    await fs.writeFile(path.join(tmpDir, 'agent-models.json'), 'not valid json', 'utf-8');

    const result = await getMigration().run({ scope: 'global', devflowDir: tmpDir });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('invalid JSON');
    expect(result.infos).toEqual([]);
  });

  it('unreadable file (EACCES): warns without throwing, leaving legacy keys on disk', async () => {
    // Pins the contract the MIGRATIONS docstring relies on: this migration NEVER
    // throws, so runGlobalMigration records it applied and it never retries. A
    // transient read failure therefore loses the one-time disk rewrite permanently
    // — survivable only because readAgentMapping re-applies canonicalisation on
    // every read. If someone makes this path throw, the unbounded-retry runner
    // path activates and this test should be revisited deliberately.
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    const file = path.join(tmpDir, 'agent-models.json');
    await fs.writeFile(file, JSON.stringify({ version: 1, agents: { 'old-coder': { model: 'sonnet' } } }), 'utf-8');
    await fs.chmod(file, 0o000);

    // Guard: running as root ignores mode bits — skip rather than assert falsely.
    let readable = true;
    try { await fs.readFile(file, 'utf-8'); } catch { readable = false; }
    if (readable) {
      await fs.chmod(file, 0o600);
      return;
    }

    const result = await getMigration().run({ scope: 'global', devflowDir: tmpDir });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('cannot read');
    expect(result.infos).toEqual([]);

    // The file is untouched — the legacy key survives on disk.
    await fs.chmod(file, 0o600);
    const onDisk = JSON.parse(await fs.readFile(file, 'utf-8')) as { agents: Record<string, unknown> };
    expect(Object.keys(onDisk.agents)).toEqual(['old-coder']);
  });

  it('strips BOM before parsing', async () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    const json = JSON.stringify({ version: 1, agents: { 'old-coder': { model: 'sonnet' } } });
    // Prepend BOM
    await fs.writeFile(path.join(tmpDir, 'agent-models.json'), '﻿' + json, 'utf-8');

    const result = await getMigration().run({ scope: 'global', devflowDir: tmpDir });
    expect(result.warnings).toEqual([]);
    expect(result.infos).toHaveLength(1);
    const updated = JSON.parse(await fs.readFile(path.join(tmpDir, 'agent-models.json'), 'utf-8')) as {
      agents: Record<string, unknown>;
    };
    expect(Object.hasOwn(updated.agents, 'coder')).toBe(true);
  });

  it('emits warning when agents field is an array', async () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    await fs.writeFile(
      path.join(tmpDir, 'agent-models.json'),
      JSON.stringify({ version: 1, agents: [] }),
      'utf-8',
    );

    const result = await getMigration().run({ scope: 'global', devflowDir: tmpDir });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('non-object agents field');
    expect(result.infos).toEqual([]);
  });

  it('preserves other top-level fields after rewrite (envelope preservation)', async () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    await fs.writeFile(
      path.join(tmpDir, 'agent-models.json'),
      JSON.stringify({ version: 1, extra: 'preserved', agents: { 'old-coder': { model: 'sonnet' } } }),
      'utf-8',
    );

    await getMigration().run({ scope: 'global', devflowDir: tmpDir });

    const updated = JSON.parse(await fs.readFile(path.join(tmpDir, 'agent-models.json'), 'utf-8')) as Record<string, unknown>;
    expect(updated['extra']).toBe('preserved');
    expect(updated['version']).toBe(1);
  });

  it('is idempotent: running twice produces the same result', async () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    await fs.writeFile(
      path.join(tmpDir, 'agent-models.json'),
      JSON.stringify({ version: 1, agents: { 'old-coder': { model: 'sonnet' } } }),
      'utf-8',
    );

    const mig = getMigration();
    await mig.run({ scope: 'global', devflowDir: tmpDir });

    // Second run: old key is gone, nothing to do
    const second = await mig.run({ scope: 'global', devflowDir: tmpDir });
    expect(second.infos).toEqual([]);
    expect(second.warnings).toEqual([]);

    // File content stable
    const final = JSON.parse(await fs.readFile(path.join(tmpDir, 'agent-models.json'), 'utf-8')) as {
      agents: Record<string, unknown>;
    };
    expect(Object.hasOwn(final.agents, 'coder')).toBe(true);
    expect(Object.hasOwn(final.agents, 'old-coder')).toBe(false);
  });
});

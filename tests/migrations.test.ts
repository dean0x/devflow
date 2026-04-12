import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readAppliedMigrations,
  writeAppliedMigrations,
  runMigrations,
  MIGRATIONS,
  type Migration,
  type MigrationContext,
} from '../src/cli/utils/migrations.js';

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

  it('contains shadow-overrides-v2-names with global scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'shadow-overrides-v2-names');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('global');
  });

  it('contains purge-legacy-knowledge-v2 with per-project scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'purge-legacy-knowledge-v2');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('per-project');
  });
});

describe('runMigrations', () => {
  let tmpDir: string;
  let homeDevflowDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-run-migrations-test-'));
    homeDevflowDir = path.join(tmpDir, 'home-devflow');
    await fs.mkdir(homeDevflowDir, { recursive: true });
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
   * Build a minimal registry override for isolated testing.
   * Patches the MIGRATIONS array by temporarily swapping it — but since ES
   * modules are live bindings we test via custom Migration objects that wrap
   * spy functions, then call runMigrations with those.
   *
   * runMigrations reads MIGRATIONS directly, so we use vi.mock or a
   * test-specific invocation approach instead.
   */

  it('skips already-applied migrations', async () => {
    // Pre-mark all migrations as applied
    const fakeHome = path.join(tmpDir, 'home', '.devflow');
    await writeAppliedMigrations(fakeHome, MIGRATIONS.map(m => m.id));

    const ctx = {
      devflowDir: fakeHome,
      claudeDir: tmpDir,
    };

    const result = await runMigrations(ctx, []);
    expect(result.newlyApplied).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('records newly applied migrations to state file', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');
    // Don't pre-apply anything — but we need the migrations to be safe no-ops.
    // With no discovered projects, per-project migrations run against 0 projects
    // and succeed (empty allSettled array = allSucceeded). Global migrations
    // (shadow-overrides-v2-names) will try to read a non-existent skills dir,
    // which is a no-op.
    const projectRoot = path.join(tmpDir, 'project1');
    await fs.mkdir(path.join(projectRoot, '.memory', 'knowledge'), { recursive: true });

    const ctx = { devflowDir: fakeHome, claudeDir: tmpDir };
    const result = await runMigrations(ctx, [projectRoot]);

    // Both migrations should succeed (they're designed to be no-ops on empty dirs)
    expect(result.failures).toEqual([]);
    expect(result.newlyApplied.length).toBeGreaterThan(0);

    // State should be persisted
    const persisted = await readAppliedMigrations(fakeHome);
    expect(persisted).toEqual(expect.arrayContaining(result.newlyApplied));
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
      run: async () => { successRan = true; },
    };

    const ctx = { devflowDir: fakeHome, claudeDir: tmpDir };
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
    await fs.mkdir(path.join(project1, '.memory', 'knowledge'), { recursive: true });
    await fs.mkdir(path.join(project2, '.memory', 'knowledge'), { recursive: true });

    // Create a custom per-project migration that always throws for project2
    const failingPerProjectMigration: Migration = {
      id: 'test-per-project-failing',
      description: 'Test: fails for one project',
      scope: 'per-project',
      run: async (ctx) => {
        if (ctx.projectRoot === project2) {
          throw new Error('simulated per-project failure');
        }
      },
    };

    const ctx = { devflowDir: fakeHome, claudeDir: tmpDir };
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

  it('is idempotent — second call with same state does nothing new', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');
    const projectRoot = path.join(tmpDir, 'project-idem');
    await fs.mkdir(path.join(projectRoot, '.memory', 'knowledge'), { recursive: true });

    const ctx = { devflowDir: fakeHome, claudeDir: tmpDir };

    const first = await runMigrations(ctx, [projectRoot]);
    const second = await runMigrations(ctx, [projectRoot]);

    expect(second.newlyApplied).toEqual([]);
    expect(second.failures).toEqual([]);
    // Applied list should be the same after second run
    const applied = await readAppliedMigrations(fakeHome);
    expect(applied).toEqual(expect.arrayContaining(first.newlyApplied));
  });

  it('runs per-project migrations for each discovered project', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');

    // Pre-apply global migrations so we only test per-project behaviour
    const globalIds = MIGRATIONS.filter(m => m.scope === 'global').map(m => m.id);
    await writeAppliedMigrations(fakeHome, globalIds);

    // Create two project roots
    const project1 = path.join(tmpDir, 'p1');
    const project2 = path.join(tmpDir, 'p2');
    for (const p of [project1, project2]) {
      await fs.mkdir(path.join(p, '.memory', 'knowledge'), { recursive: true });
      // Place a PROJECT-PATTERNS.md in each to verify per-project sweep
      await fs.writeFile(path.join(p, '.memory', 'PROJECT-PATTERNS.md'), '# stale', 'utf-8');
    }

    const ctx = { devflowDir: fakeHome, claudeDir: tmpDir };
    const result = await runMigrations(ctx, [project1, project2]);

    expect(result.failures).toEqual([]);
    expect(result.newlyApplied).toContain('purge-legacy-knowledge-v2');

    // Both projects should have PROJECT-PATTERNS.md removed
    for (const p of [project1, project2]) {
      await expect(fs.access(path.join(p, '.memory', 'PROJECT-PATTERNS.md'))).rejects.toThrow();
    }
  });

  it('runs global migrations against devflowDir (not project root)', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');

    // Pre-apply per-project migrations so we only test global behaviour
    const perProjectIds = MIGRATIONS.filter(m => m.scope === 'per-project').map(m => m.id);
    await writeAppliedMigrations(fakeHome, perProjectIds);

    // Create a shadow skill at old name to verify global migration ran
    const shadowsDir = path.join(fakeHome, 'skills');
    const oldShadow = path.join(shadowsDir, 'core-patterns');
    await fs.mkdir(oldShadow, { recursive: true });
    await fs.writeFile(path.join(oldShadow, 'SKILL.md'), '# Custom', 'utf-8');

    const ctx = { devflowDir: fakeHome, claudeDir: tmpDir };
    const result = await runMigrations(ctx, []);

    expect(result.failures).toEqual([]);
    expect(result.newlyApplied).toContain('shadow-overrides-v2-names');

    // Old shadow should be renamed to new name
    await expect(fs.access(oldShadow)).rejects.toThrow();
    await expect(
      fs.access(path.join(shadowsDir, 'software-design')),
    ).resolves.toBeUndefined();
  });
});

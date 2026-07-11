import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  it('contains purge-legacy-knowledge-v3 with per-project scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'purge-legacy-knowledge-v3');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('per-project');
    expect(m?.description).toBeTruthy();
    expect(typeof m?.run).toBe('function');
  });

  it('v3 description explains source discriminator approach', () => {
    const m = MIGRATIONS.find(m => m.id === 'purge-legacy-knowledge-v3');
    expect(m?.description).toContain('pre-v2');
    expect(m?.description).toContain('self-learning');
  });

  it('v3 is after v2 in the MIGRATIONS array (ordering preserved)', () => {
    const v2Index = MIGRATIONS.findIndex(m => m.id === 'purge-legacy-knowledge-v2');
    const v3Index = MIGRATIONS.findIndex(m => m.id === 'purge-legacy-knowledge-v3');
    expect(v2Index).toBeGreaterThanOrEqual(0);
    expect(v3Index).toBeGreaterThan(v2Index);
  });

  it('contains rename-kb-to-knowledge with per-project scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'rename-kb-to-knowledge');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('per-project');
  });

  it('contains consolidate-to-devflow-dir with per-project scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'consolidate-to-devflow-dir');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('per-project');
  });

  it('rename-kb-to-knowledge runs before consolidate-to-devflow-dir', () => {
    const renameIdx = MIGRATIONS.findIndex(m => m.id === 'rename-kb-to-knowledge');
    const consolidateIdx = MIGRATIONS.findIndex(m => m.id === 'consolidate-to-devflow-dir');
    expect(renameIdx).toBeGreaterThanOrEqual(0);
    expect(consolidateIdx).toBeGreaterThan(renameIdx);
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
    await fs.mkdir(path.join(projectRoot, '.devflow', 'decisions'), { recursive: true });

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
    await fs.mkdir(path.join(project1, '.devflow', 'decisions'), { recursive: true });
    await fs.mkdir(path.join(project2, '.devflow', 'decisions'), { recursive: true });

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
      run: async () => { ranAnywhere = true; },
    };

    const ctx = { devflowDir: fakeHome, claudeDir: tmpDir };
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
    const projectRoot = path.join(tmpDir, 'project-idem');
    await fs.mkdir(path.join(projectRoot, '.devflow', 'decisions'), { recursive: true });

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
      await fs.mkdir(path.join(p, '.devflow', 'decisions'), { recursive: true });
      await fs.mkdir(path.join(p, '.devflow', 'memory'), { recursive: true });
      // Place a PROJECT-PATTERNS.md in each to verify per-project sweep
      await fs.writeFile(path.join(p, '.devflow', 'memory', 'PROJECT-PATTERNS.md'), '# stale', 'utf-8');
    }

    const ctx = { devflowDir: fakeHome, claudeDir: tmpDir };
    const result = await runMigrations(ctx, [project1, project2]);

    expect(result.failures).toEqual([]);
    expect(result.newlyApplied).toContain('purge-legacy-knowledge-v2');

    // Both projects should have PROJECT-PATTERNS.md removed
    for (const p of [project1, project2]) {
      await expect(fs.access(path.join(p, '.devflow', 'memory', 'PROJECT-PATTERNS.md'))).rejects.toThrow();
    }
  });

  it('v3 migration runs independently even when v2 is already applied', async () => {
    const fakeHome = path.join(tmpDir, 'home', '.devflow');

    // Mark v2 (and global migrations) as already applied — v3 has NOT been applied yet
    const appliedBefore = [
      ...MIGRATIONS.filter(m => m.scope === 'global').map(m => m.id),
      'purge-legacy-knowledge-v2',
    ];
    await writeAppliedMigrations(fakeHome, appliedBefore);

    // Create a project with a seeded entry (no self-learning: source)
    const projectRoot = path.join(tmpDir, 'project-v3-independent');
    const decisionsDir = path.join(projectRoot, '.devflow', 'decisions');
    await fs.mkdir(decisionsDir, { recursive: true });
    const decisionsPath = path.join(decisionsDir, 'decisions.md');
    await fs.writeFile(decisionsPath, `<!-- TL;DR: 1 decisions. Key: -->

## ADR-003: Seeded entry lacking self-learning marker

- **Status**: accepted
- **Source**: /code-review (seed)
`, 'utf-8');

    const ctx = { devflowDir: fakeHome, claudeDir: tmpDir };
    const result = await runMigrations(ctx, [projectRoot]);

    // v3 should have run and succeeded
    expect(result.failures).toEqual([]);
    expect(result.newlyApplied).toContain('purge-legacy-knowledge-v3');
    expect(result.newlyApplied).not.toContain('purge-legacy-knowledge-v2'); // v2 was pre-applied

    // The seeded entry should be gone
    const updated = await fs.readFile(decisionsPath, 'utf-8');
    expect(updated).not.toContain('ADR-003');
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

describe('rename-kb-to-knowledge migration', () => {
  let tmpDir: string;
  let projectRoot: string;
  let featuresDir: string;
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rename-kb-test-'));
    projectRoot = path.join(tmpDir, 'project');
    featuresDir = path.join(projectRoot, '.devflow', 'features');
    await fs.mkdir(featuresDir, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, 'home');
    fakeHome = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(fakeHome, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function getMigration(): Migration<'per-project'> {
    const m = MIGRATIONS.find(m => m.id === 'rename-kb-to-knowledge');
    if (!m) throw new Error('rename-kb-to-knowledge migration not found');
    return m as Migration<'per-project'>;
  }

  function makeCtx(): import('../src/cli/utils/migrations.js').PerProjectMigrationContext {
    return {
      scope: 'per-project',
      devflowDir: fakeHome,
      memoryDir: path.join(projectRoot, '.devflow', 'memory'),
      projectRoot,
    };
  }

  it('renames .kb.lock to .knowledge.lock when it exists', async () => {
    await fs.writeFile(path.join(featuresDir, '.kb.lock'), '', 'utf-8');
    await getMigration().run(makeCtx());
    await expect(fs.access(path.join(featuresDir, '.kb.lock'))).rejects.toThrow();
    await expect(fs.access(path.join(featuresDir, '.knowledge.lock'))).resolves.toBeUndefined();
  });

  it('renames .kb-last-refresh to .knowledge-last-refresh when it exists', async () => {
    await fs.writeFile(path.join(featuresDir, '.kb-last-refresh'), '1234567890', 'utf-8');
    await getMigration().run(makeCtx());
    await expect(fs.access(path.join(featuresDir, '.kb-last-refresh'))).rejects.toThrow();
    await expect(fs.access(path.join(featuresDir, '.knowledge-last-refresh'))).resolves.toBeUndefined();
    const content = await fs.readFile(path.join(featuresDir, '.knowledge-last-refresh'), 'utf-8');
    expect(content).toBe('1234567890');
  });

  it('renames .kb-refresh.lock to .knowledge-refresh.lock when it exists', async () => {
    await fs.writeFile(path.join(featuresDir, '.kb-refresh.lock'), '', 'utf-8');
    await getMigration().run(makeCtx());
    await expect(fs.access(path.join(featuresDir, '.kb-refresh.lock'))).rejects.toThrow();
    await expect(fs.access(path.join(featuresDir, '.knowledge-refresh.lock'))).resolves.toBeUndefined();
  });

  it('is a no-op when old files do not exist (missing files handled gracefully)', async () => {
    // No old files created — migration should succeed without errors
    const result = await getMigration().run(makeCtx());
    // No infos since no renames occurred
    expect(result?.infos ?? []).toHaveLength(0);
  });

  it('updates .gitignore entries from kb to knowledge names', async () => {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    await fs.writeFile(gitignorePath, [
      '.features/.kb.lock',
      '.features/.kb-last-refresh',
      '.features/.kb-refresh.lock',
      '.devflow/',
    ].join('\n'), 'utf-8');

    await getMigration().run(makeCtx());

    const updated = await fs.readFile(gitignorePath, 'utf-8');
    expect(updated).toContain('.features/.knowledge.lock');
    expect(updated).toContain('.features/.knowledge-last-refresh');
    expect(updated).toContain('.features/.knowledge-refresh.lock');
    expect(updated).not.toContain('.features/.kb.lock');
    expect(updated).not.toContain('.features/.kb-last-refresh');
    expect(updated).not.toContain('.features/.kb-refresh.lock');
    // Unrelated entries are preserved
    expect(updated).toContain('.devflow/');
  });

  it('does not modify .gitignore when no kb entries are present', async () => {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const original = '.devflow/\nnode_modules/\n';
    await fs.writeFile(gitignorePath, original, 'utf-8');

    await getMigration().run(makeCtx());

    const unchanged = await fs.readFile(gitignorePath, 'utf-8');
    expect(unchanged).toBe(original);
  });

  it('does not fail when .gitignore does not exist', async () => {
    // No .gitignore created — migration should be a no-op, not throw
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('is idempotent — running twice produces same result', async () => {
    await fs.writeFile(path.join(featuresDir, '.kb.lock'), '', 'utf-8');
    const gitignorePath = path.join(projectRoot, '.gitignore');
    await fs.writeFile(gitignorePath, '.features/.kb.lock\n', 'utf-8');

    await getMigration().run(makeCtx());
    // Second run: .kb.lock is gone, .knowledge.lock exists — should not throw
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();

    // State is the same after second run
    await expect(fs.access(path.join(featuresDir, '.knowledge.lock'))).resolves.toBeUndefined();
    const gitignore = await fs.readFile(gitignorePath, 'utf-8');
    expect(gitignore).toContain('.features/.knowledge.lock');
  });
});

describe('consolidate-to-devflow-dir migration', () => {
  let tmpDir: string;
  let projectRoot: string;
  let devflowDir: string;
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-consolidate-test-'));
    projectRoot = path.join(tmpDir, 'project');
    devflowDir = path.join(projectRoot, '.devflow');
    await fs.mkdir(projectRoot, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, 'home');
    fakeHome = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(fakeHome, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function getMigration(): Migration<'per-project'> {
    const m = MIGRATIONS.find(m => m.id === 'consolidate-to-devflow-dir');
    if (!m) throw new Error('consolidate-to-devflow-dir migration not found');
    return m as Migration<'per-project'>;
  }

  function makeCtx(): import('../src/cli/utils/migrations.js').PerProjectMigrationContext {
    return {
      scope: 'per-project',
      devflowDir: fakeHome,
      memoryDir: path.join(devflowDir, 'memory'),
      projectRoot,
    };
  }

  it('moves WORKING-MEMORY.md from .memory/ to .devflow/memory/', async () => {
    const src = path.join(projectRoot, '.memory');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'WORKING-MEMORY.md'), '# Now\n', 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(path.join(src, 'WORKING-MEMORY.md'))).rejects.toThrow();
    const content = await fs.readFile(path.join(devflowDir, 'memory', 'WORKING-MEMORY.md'), 'utf-8');
    expect(content).toBe('# Now\n');
  });

  it('moves learning-log.jsonl from .memory/ to .devflow/learning/', async () => {
    const src = path.join(projectRoot, '.memory');
    await fs.mkdir(src, { recursive: true });
    const logContent = '{"type":"workflow"}\n';
    await fs.writeFile(path.join(src, 'learning-log.jsonl'), logContent, 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(path.join(src, 'learning-log.jsonl'))).rejects.toThrow();
    const content = await fs.readFile(path.join(devflowDir, 'learning', 'learning-log.jsonl'), 'utf-8');
    expect(content).toBe(logContent);
  });

  it('moves decisions-log.jsonl from .memory/ to .devflow/decisions/', async () => {
    const src = path.join(projectRoot, '.memory');
    await fs.mkdir(src, { recursive: true });
    const logContent = '{"type":"decision"}\n';
    await fs.writeFile(path.join(src, 'decisions-log.jsonl'), logContent, 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(path.join(src, 'decisions-log.jsonl'))).rejects.toThrow();
    const content = await fs.readFile(path.join(devflowDir, 'decisions', 'decisions-log.jsonl'), 'utf-8');
    expect(content).toBe(logContent);
  });

  it('moves .memory/decisions/ subdirectory contents to .devflow/decisions/', async () => {
    const decisionsDir = path.join(projectRoot, '.memory', 'decisions');
    await fs.mkdir(decisionsDir, { recursive: true });
    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), '# Decisions\n', 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), '# Pitfalls\n', 'utf-8');

    await getMigration().run(makeCtx());

    const dm = await fs.readFile(path.join(devflowDir, 'decisions', 'decisions.md'), 'utf-8');
    const pm = await fs.readFile(path.join(devflowDir, 'decisions', 'pitfalls.md'), 'utf-8');
    expect(dm).toBe('# Decisions\n');
    expect(pm).toBe('# Pitfalls\n');
  });

  it('moves .features/ contents to .devflow/features/', async () => {
    const featSrc = path.join(projectRoot, '.features');
    await fs.mkdir(path.join(featSrc, 'my-feature'), { recursive: true });
    await fs.writeFile(path.join(featSrc, 'my-feature', 'KNOWLEDGE.md'), '# Knowledge\n', 'utf-8');
    await fs.writeFile(path.join(featSrc, 'index.json'), '{}', 'utf-8');

    await getMigration().run(makeCtx());

    const km = await fs.readFile(path.join(devflowDir, 'features', 'my-feature', 'KNOWLEDGE.md'), 'utf-8');
    expect(km).toBe('# Knowledge\n');
    const idx = await fs.readFile(path.join(devflowDir, 'features', 'index.json'), 'utf-8');
    expect(idx).toBe('{}');
  });

  it('moves .docs/ contents to .devflow/docs/', async () => {
    const docsSrc = path.join(projectRoot, '.docs');
    await fs.mkdir(path.join(docsSrc, 'reviews', 'feat-my-branch'), { recursive: true });
    await fs.writeFile(
      path.join(docsSrc, 'reviews', 'feat-my-branch', 'review-summary.md'),
      '# Review\n',
      'utf-8',
    );

    await getMigration().run(makeCtx());

    const review = await fs.readFile(
      path.join(devflowDir, 'docs', 'reviews', 'feat-my-branch', 'review-summary.md'),
      'utf-8',
    );
    expect(review).toBe('# Review\n');
  });

  it('removes stale .gitignore entries from the root .gitignore', async () => {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    await fs.writeFile(gitignorePath, [
      'node_modules/',
      '.memory/',
      '.docs/',
      '.features/.knowledge.lock',
      '.features/.disabled',
      '.features/.knowledge-last-refresh',
      '.features/.knowledge-refresh.lock',
      '.devflow/',
      'dist/',
    ].join('\n'), 'utf-8');

    await getMigration().run(makeCtx());

    const updated = await fs.readFile(gitignorePath, 'utf-8');
    expect(updated).not.toContain('.memory/');
    expect(updated).not.toContain('.docs/');
    expect(updated).not.toContain('.features/.knowledge.lock');
    expect(updated).not.toContain('.features/.disabled');
    expect(updated).not.toContain('.features/.knowledge-last-refresh');
    expect(updated).not.toContain('.features/.knowledge-refresh.lock');
    // Non-stale entries are preserved — including .devflow/, which is now the
    // canonical wholesale-ignore entry (no longer stripped by consolidation).
    expect(updated).toContain('.devflow/');
    expect(updated).toContain('node_modules/');
    expect(updated).toContain('dist/');
  });

  it('removes empty old directories after migration', async () => {
    const memorySrc = path.join(projectRoot, '.memory');
    const featuresSrc = path.join(projectRoot, '.features');
    const docsSrc = path.join(projectRoot, '.docs');

    // Create the old dirs with one file each
    await fs.mkdir(memorySrc, { recursive: true });
    await fs.mkdir(featuresSrc, { recursive: true });
    await fs.mkdir(docsSrc, { recursive: true });
    await fs.writeFile(path.join(memorySrc, 'WORKING-MEMORY.md'), '# Now\n', 'utf-8');
    await fs.writeFile(path.join(featuresSrc, 'index.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(docsSrc, 'design.md'), '# Design\n', 'utf-8');

    await getMigration().run(makeCtx());

    // All old dirs should be removed (they're now empty)
    await expect(fs.access(memorySrc)).rejects.toThrow();
    await expect(fs.access(featuresSrc)).rejects.toThrow();
    await expect(fs.access(docsSrc)).rejects.toThrow();
  });

  it('leaves .memory/ in place when unrecognized user files remain', async () => {
    const memorySrc = path.join(projectRoot, '.memory');
    await fs.mkdir(memorySrc, { recursive: true });
    // Pre-create dest so catch-all moveDirContents skips the source
    await fs.mkdir(path.join(devflowDir, 'memory'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'memory', 'user-notes.txt'), 'existing', 'utf-8');
    // Source file — not in MEMORY_LEGACY_SKIP_FILES, not in memMap, dest already exists
    await fs.writeFile(path.join(memorySrc, 'user-notes.txt'), 'my notes', 'utf-8');

    await getMigration().run(makeCtx());

    // .memory/ survives because user-notes.txt couldn't be moved (dest exists)
    // and wasn't cleaned (not a legacy skip file)
    await expect(fs.access(memorySrc)).resolves.toBeUndefined();
    await expect(fs.access(path.join(memorySrc, 'user-notes.txt'))).resolves.toBeUndefined();
  });

  it('deletes legacy skip files from .memory/ and removes the directory', async () => {
    const memorySrc = path.join(projectRoot, '.memory');
    await fs.mkdir(path.join(memorySrc, 'knowledge'), { recursive: true });
    await fs.writeFile(path.join(memorySrc, 'knowledge', 'old-data.json'), '{}', 'utf-8');
    await fs.mkdir(path.join(memorySrc, 'short'), { recursive: true });
    await fs.writeFile(path.join(memorySrc, 'short', 'old.md'), '', 'utf-8');
    await fs.writeFile(path.join(memorySrc, 'index.md'), '# V1\n', 'utf-8');
    await fs.writeFile(path.join(memorySrc, 'candidates.json'), '[]', 'utf-8');
    await fs.writeFile(path.join(memorySrc, '.gitignore-configured'), '', 'utf-8');

    await getMigration().run(makeCtx());

    // All legacy files deleted, .memory/ removed
    await expect(fs.access(path.join(memorySrc, 'knowledge'))).rejects.toThrow();
    await expect(fs.access(path.join(memorySrc, 'index.md'))).rejects.toThrow();
    await expect(fs.access(memorySrc)).rejects.toThrow();
  });

  it('removes .features/ after cleaning leftover duplicates', async () => {
    const featSrc = path.join(projectRoot, '.features');
    await fs.mkdir(featSrc, { recursive: true });
    await fs.writeFile(path.join(featSrc, 'index.json'), '{"version":1,"features":{}}', 'utf-8');
    // Pre-create dest so moveDirContents skips the source
    await fs.mkdir(path.join(devflowDir, 'features'), { recursive: true });
    await fs.writeFile(
      path.join(devflowDir, 'features', 'index.json'),
      '{"version":1,"features":{"existing":{}}}',
      'utf-8',
    );

    await getMigration().run(makeCtx());

    // .features/ removed after cleaning leftover index.json
    await expect(fs.access(featSrc)).rejects.toThrow();
    // Dest content preserved (not overwritten by src)
    const dest = await fs.readFile(path.join(devflowDir, 'features', 'index.json'), 'utf-8');
    expect(dest).toContain('existing');
  });

  it('is idempotent — running twice produces the same result', async () => {
    const memorySrc = path.join(projectRoot, '.memory');
    await fs.mkdir(memorySrc, { recursive: true });
    await fs.writeFile(path.join(memorySrc, 'WORKING-MEMORY.md'), '# Now\n', 'utf-8');

    await getMigration().run(makeCtx());
    // Second run: src file is gone, dest exists — should not throw
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();

    // State unchanged after second run
    const content = await fs.readFile(path.join(devflowDir, 'memory', 'WORKING-MEMORY.md'), 'utf-8');
    expect(content).toBe('# Now\n');
  });

  it('is a no-op when old directories do not exist', async () => {
    // No .memory/, .features/, .docs/ created — should succeed without errors
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('moves .memory/.sidecar/ contents to .devflow/sidecar/', async () => {
    const memorySrc = path.join(projectRoot, '.memory');
    const sidecarSrc = path.join(memorySrc, '.sidecar');
    await fs.mkdir(sidecarSrc, { recursive: true });
    await fs.writeFile(path.join(sidecarSrc, 'memory.json'), '{"type":"memory"}', 'utf-8');
    await fs.writeFile(path.join(sidecarSrc, 'learning.abc123.json'), '{"type":"learning"}', 'utf-8');

    await getMigration().run(makeCtx());

    // Files should appear in .devflow/sidecar/
    const mem = await fs.readFile(path.join(devflowDir, 'sidecar', 'memory.json'), 'utf-8');
    expect(mem).toBe('{"type":"memory"}');
    const learn = await fs.readFile(path.join(devflowDir, 'sidecar', 'learning.abc123.json'), 'utf-8');
    expect(learn).toBe('{"type":"learning"}');
    // Source files should be gone
    await expect(fs.access(path.join(sidecarSrc, 'memory.json'))).rejects.toThrow();
    await expect(fs.access(path.join(sidecarSrc, 'learning.abc123.json'))).rejects.toThrow();
  });

  it('moves unknown .memory/ files to .devflow/memory/ via catch-all pass', async () => {
    const memorySrc = path.join(projectRoot, '.memory');
    await fs.mkdir(memorySrc, { recursive: true });
    // A file not in the explicit memMap — should be swept by the catch-all moveDirContents
    await fs.writeFile(path.join(memorySrc, 'custom-notes.txt'), 'user notes', 'utf-8');

    await getMigration().run(makeCtx());

    // File should land in .devflow/memory/
    const content = await fs.readFile(path.join(devflowDir, 'memory', 'custom-notes.txt'), 'utf-8');
    expect(content).toBe('user notes');
    // Source should be gone
    await expect(fs.access(path.join(memorySrc, 'custom-notes.txt'))).rejects.toThrow();
  });

  it('handles partial state — files not yet migrated are moved, already-absent sources are skipped', async () => {
    const memorySrc = path.join(projectRoot, '.memory');
    await fs.mkdir(memorySrc, { recursive: true });
    // Only backup.json remains in the source (WORKING-MEMORY.md was already moved in a previous partial run)
    await fs.writeFile(path.join(memorySrc, 'backup.json'), '{}', 'utf-8');

    // Pre-place WORKING-MEMORY.md in the destination (simulates partial migration)
    await fs.mkdir(path.join(devflowDir, 'memory'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'memory', 'WORKING-MEMORY.md'), '# Already migrated\n', 'utf-8');

    await getMigration().run(makeCtx());

    // Pre-existing dest file stays (source was absent — ENOENT path)
    const content = await fs.readFile(path.join(devflowDir, 'memory', 'WORKING-MEMORY.md'), 'utf-8');
    expect(content).toBe('# Already migrated\n');

    // File that was still in source should be migrated
    const backup = await fs.readFile(path.join(devflowDir, 'memory', 'backup.json'), 'utf-8');
    expect(backup).toBe('{}');
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

describe('rename-sidecar-to-dream-v1 migration', () => {
  let tmpDir: string;
  let projectRoot: string;
  let devflowDir: string;
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rename-dream-test-'));
    projectRoot = path.join(tmpDir, 'project');
    devflowDir = path.join(projectRoot, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, 'home');
    fakeHome = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(fakeHome, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function getMigration(): Migration<'per-project'> {
    const m = MIGRATIONS.find(m => m.id === 'rename-sidecar-to-dream-v1');
    if (!m) throw new Error('rename-sidecar-to-dream-v1 migration not found');
    return m as Migration<'per-project'>;
  }

  function makeCtx(): import('../src/cli/utils/migrations.js').PerProjectMigrationContext {
    return {
      scope: 'per-project',
      devflowDir: fakeHome,
      memoryDir: path.join(devflowDir, 'memory'),
      projectRoot,
    };
  }

  // M1: seeded .devflow/sidecar/ with config + marker + .processor-spawned-at
  it('M1: moves sidecar/ contents to dream/ and removes sidecar/', async () => {
    const sidecarDir = path.join(devflowDir, 'sidecar');
    await fs.mkdir(sidecarDir, { recursive: true });
    await fs.writeFile(
      path.join(sidecarDir, 'config.json'),
      JSON.stringify({ memory: true, learning: false, decisions: true, knowledge: true }),
      'utf-8',
    );
    await fs.writeFile(path.join(sidecarDir, 'memory.abc123.json'), '{"ts":1}', 'utf-8');
    await fs.writeFile(path.join(sidecarDir, '.processor-spawned-at'), '1234567890', 'utf-8');

    const result = await getMigration().run(makeCtx());

    // config preserved at dream/
    const dreamDir = path.join(devflowDir, 'dream');
    const config = JSON.parse(await fs.readFile(path.join(dreamDir, 'config.json'), 'utf-8'));
    expect(config.learning).toBe(false); // preserved

    // marker moved to dream/
    await expect(fs.access(path.join(dreamDir, 'memory.abc123.json'))).resolves.toBeUndefined();

    // sidecar/ removed
    await expect(fs.access(sidecarDir)).rejects.toThrow();

    expect(result?.infos).toContain('Renamed .devflow/sidecar/ → .devflow/dream/');
  });

  // M2: old wins — pre-existing fresh-default dream/config.json is overwritten by old sidecar config
  it('M2: old sidecar config.json wins over fresh dream/config.json', async () => {
    const sidecarDir = path.join(devflowDir, 'sidecar');
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(sidecarDir, { recursive: true });
    await fs.mkdir(dreamDir, { recursive: true });

    // Old sidecar config has learning:false
    await fs.writeFile(
      path.join(sidecarDir, 'config.json'),
      JSON.stringify({ memory: true, learning: false, decisions: true, knowledge: true }),
      'utf-8',
    );
    // Fresh dream config has all-true defaults
    await fs.writeFile(
      path.join(dreamDir, 'config.json'),
      JSON.stringify({ memory: true, learning: true, decisions: true, knowledge: true }),
      'utf-8',
    );

    await getMigration().run(makeCtx());

    const config = JSON.parse(await fs.readFile(path.join(dreamDir, 'config.json'), 'utf-8'));
    expect(config.learning).toBe(false); // old wins
  });

  // M3: idempotent — re-run with no sidecar/ → no-op, no error
  it('M3: idempotent when sidecar/ does not exist', async () => {
    const result = await getMigration().run(makeCtx());
    expect(result?.infos ?? []).toHaveLength(0);
    // No dream/ should be created either (nothing to migrate)
    await expect(fs.access(path.join(devflowDir, 'dream'))).rejects.toThrow();
  });

  // M4: no-clobber — an existing destination marker is never overwritten
  it('M4: does not overwrite existing marker at destination', async () => {
    const sidecarDir = path.join(devflowDir, 'sidecar');
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(sidecarDir, { recursive: true });
    await fs.mkdir(dreamDir, { recursive: true });

    await fs.writeFile(
      path.join(sidecarDir, 'config.json'),
      JSON.stringify({ memory: true, learning: true, decisions: true, knowledge: true }),
      'utf-8',
    );
    // Both have the same marker
    await fs.writeFile(path.join(sidecarDir, 'learning.abc.json'), '"sidecar-version"', 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'learning.abc.json'), '"dream-version"', 'utf-8');

    await getMigration().run(makeCtx());

    // Existing dream marker should NOT be overwritten
    const dreamMarker = await fs.readFile(path.join(dreamDir, 'learning.abc.json'), 'utf-8');
    expect(dreamMarker).toBe('"dream-version"');
  });

  // M5: true re-run idempotency — run on already-migrated state preserves data, no throw
  it('M5: re-run after full migration is a clean no-op that preserves data', async () => {
    const sidecarDir = path.join(devflowDir, 'sidecar');
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(sidecarDir, { recursive: true });
    await fs.writeFile(
      path.join(sidecarDir, 'config.json'),
      JSON.stringify({ memory: true, learning: false, decisions: true, knowledge: true }),
      'utf-8',
    );
    await fs.writeFile(path.join(sidecarDir, 'learning.abc.json'), '{"type":"learning"}', 'utf-8');

    // First run: migrates sidecar/ → dream/
    await getMigration().run(makeCtx());

    // Confirm first run succeeded
    await expect(fs.access(sidecarDir)).rejects.toThrow(); // sidecar/ removed
    const configAfterFirstRun = JSON.parse(await fs.readFile(path.join(dreamDir, 'config.json'), 'utf-8'));
    expect(configAfterFirstRun.learning).toBe(false);

    // Second run: sidecar/ no longer exists — should be a no-op, not throw
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();

    // dream/ data preserved exactly as the first run left it
    const configAfterSecondRun = JSON.parse(await fs.readFile(path.join(dreamDir, 'config.json'), 'utf-8'));
    expect(configAfterSecondRun.learning).toBe(false);
    const markerContent = await fs.readFile(path.join(dreamDir, 'learning.abc.json'), 'utf-8');
    expect(markerContent).toBe('{"type":"learning"}');
  });

  // M6: partial-failure resume — config moved but markers remain; second run completes migration
  it('M6: handles partial state — config already in dream/, remaining sidecar markers are moved', async () => {
    const sidecarDir = path.join(devflowDir, 'sidecar');
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(sidecarDir, { recursive: true });
    await fs.mkdir(dreamDir, { recursive: true });

    // Simulate partial migration: config.json was already moved to dream/, but
    // sidecar/ still exists with residual markers that were not yet moved.
    await fs.writeFile(
      path.join(dreamDir, 'config.json'),
      JSON.stringify({ memory: true, learning: false, decisions: true, knowledge: true }),
      'utf-8',
    );
    await fs.writeFile(path.join(sidecarDir, 'memory.abc.json'), '{"ts":42}', 'utf-8');

    await getMigration().run(makeCtx());

    // Residual marker should be moved to dream/
    await expect(fs.access(path.join(dreamDir, 'memory.abc.json'))).resolves.toBeUndefined();
    const movedMarker = await fs.readFile(path.join(dreamDir, 'memory.abc.json'), 'utf-8');
    expect(movedMarker).toBe('{"ts":42}');

    // sidecar/ should be removed after the run
    await expect(fs.access(sidecarDir)).rejects.toThrow();

    // dream/config.json content preserved (no overwrite from absent sidecar/config.json)
    const config = JSON.parse(await fs.readFile(path.join(dreamDir, 'config.json'), 'utf-8'));
    expect(config.learning).toBe(false);
  });

  // Registry test: migration is registered with correct metadata
  it('is registered in MIGRATIONS with per-project scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'rename-sidecar-to-dream-v1');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('per-project');
    expect(m?.description).toContain('sidecar');
    expect(m?.description).toContain('dream');
  });
});

// ---------------------------------------------------------------------------
// purge-learning-pipeline-v1 (per-project)
// ---------------------------------------------------------------------------

describe('purge-learning-pipeline-v1 migration', () => {
  let tmpDir: string;
  let projectRoot: string;
  let devflowDir: string;
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-purge-learning-test-'));
    projectRoot = path.join(tmpDir, 'project');
    devflowDir = path.join(projectRoot, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, 'home');
    fakeHome = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(fakeHome, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function getMigration(): Migration<'per-project'> {
    const m = MIGRATIONS.find(m => m.id === 'purge-learning-pipeline-v1');
    if (!m) throw new Error('purge-learning-pipeline-v1 migration not found');
    return m as Migration<'per-project'>;
  }

  function makeCtx(): import('../src/cli/utils/migrations.js').PerProjectMigrationContext {
    return {
      scope: 'per-project',
      devflowDir: fakeHome,
      memoryDir: path.join(devflowDir, 'memory'),
      projectRoot,
    };
  }

  it('is registered in MIGRATIONS with per-project scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'purge-learning-pipeline-v1');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('per-project');
  });

  it('removes .devflow/learning/ directory when it exists', async () => {
    const learningDir = path.join(devflowDir, 'learning');
    await fs.mkdir(learningDir, { recursive: true });
    await fs.writeFile(path.join(learningDir, 'learning-log.jsonl'), '{"type":"workflow"}\n', 'utf-8');
    await fs.writeFile(path.join(learningDir, 'learning.json'), '{}', 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(learningDir)).rejects.toThrow();
  });

  it('is a no-op when .devflow/learning/ does not exist', async () => {
    // No learning dir created — migration should succeed without errors
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('removes learning.*.json dream markers', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, 'learning.abc123.json'), '{"ts":1}', 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'learning.def456.json'), '{"ts":2}', 'utf-8');
    // Non-learning markers should be preserved
    await fs.writeFile(path.join(dreamDir, 'decisions.abc123.json'), '{"ts":3}', 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'memory.abc123.json'), '{"ts":4}', 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(path.join(dreamDir, 'learning.abc123.json'))).rejects.toThrow();
    await expect(fs.access(path.join(dreamDir, 'learning.def456.json'))).rejects.toThrow();
    // Non-learning markers preserved
    await expect(fs.access(path.join(dreamDir, 'decisions.abc123.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dreamDir, 'memory.abc123.json'))).resolves.toBeUndefined();
  });

  it('removes learning.*.processing dream markers', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, 'learning.abc123.processing'), '{"ts":1}', 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(path.join(dreamDir, 'learning.abc123.processing'))).rejects.toThrow();
  });

  it('drops the learning key from .devflow/dream/config.json', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(
      path.join(dreamDir, 'config.json'),
      JSON.stringify({ memory: true, learning: true, decisions: true, knowledge: true }),
      'utf-8',
    );

    await getMigration().run(makeCtx());

    const config = JSON.parse(await fs.readFile(path.join(dreamDir, 'config.json'), 'utf-8'));
    expect(config.learning).toBeUndefined();
    expect(config.memory).toBe(true);
    expect(config.decisions).toBe(true);
    expect(config.knowledge).toBe(true);
  });

  it('drops the learning key from .devflow/sidecar/config.json when present (legacy)', async () => {
    const sidecarDir = path.join(devflowDir, 'sidecar');
    await fs.mkdir(sidecarDir, { recursive: true });
    await fs.writeFile(
      path.join(sidecarDir, 'config.json'),
      JSON.stringify({ memory: true, learning: false, decisions: true, knowledge: true }),
      'utf-8',
    );

    await getMigration().run(makeCtx());

    const config = JSON.parse(await fs.readFile(path.join(sidecarDir, 'config.json'), 'utf-8'));
    expect(config.learning).toBeUndefined();
    expect(config.memory).toBe(true);
    expect(config.decisions).toBe(true);
  });

  it('does NOT delete sidecar/config.json — only drops the learning key', async () => {
    const sidecarDir = path.join(devflowDir, 'sidecar');
    await fs.mkdir(sidecarDir, { recursive: true });
    await fs.writeFile(
      path.join(sidecarDir, 'config.json'),
      JSON.stringify({ memory: true, learning: true, decisions: true, knowledge: false }),
      'utf-8',
    );

    await getMigration().run(makeCtx());

    // File must still exist
    await expect(fs.access(path.join(sidecarDir, 'config.json'))).resolves.toBeUndefined();
  });

  it('removes .claude/commands/self-learning/ directory', async () => {
    const claudeDir = path.join(projectRoot, '.claude');
    const selfLearningDir = path.join(claudeDir, 'commands', 'self-learning');
    await fs.mkdir(selfLearningDir, { recursive: true });
    await fs.writeFile(
      path.join(selfLearningDir, 'my-command.md'),
      '---\n# devflow-learning: auto-generated\n---\n',
      'utf-8',
    );

    await getMigration().run(makeCtx());

    await expect(fs.access(selfLearningDir)).rejects.toThrow();
  });

  it('removes auto-generated skills but preserves user skills (step 6)', async () => {
    const claudeDir = path.join(projectRoot, '.claude');
    const skillsDir = path.join(claudeDir, 'skills');

    // Auto-generated skill: non-devflow-prefixed dir, marker in first 10 lines
    const markedSkillDir = path.join(skillsDir, 'my-workflow');
    await fs.mkdir(markedSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(markedSkillDir, 'SKILL.md'),
      `---\n# devflow-learning: auto-generated\n---\n\n# My workflow skill\n`,
      'utf-8',
    );

    // User-authored skill: no marker — must survive
    const userSkillDir = path.join(skillsDir, 'my-custom-skill');
    await fs.mkdir(userSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(userSkillDir, 'SKILL.md'),
      `# My Custom Skill\n\nUser-authored — no auto-generated marker here.\n`,
      'utf-8',
    );

    await getMigration().run(makeCtx());

    // Marked skill removed
    await expect(fs.access(markedSkillDir)).rejects.toThrow();
    // User skill preserved
    await expect(fs.access(userSkillDir)).resolves.toBeUndefined();
  });

  it('is idempotent — running twice produces no errors', async () => {
    // Set up full scenario
    const learningDir = path.join(devflowDir, 'learning');
    await fs.mkdir(learningDir, { recursive: true });
    await fs.writeFile(path.join(learningDir, 'learning-log.jsonl'), '', 'utf-8');
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, 'learning.abc.json'), '{}', 'utf-8');
    await fs.writeFile(
      path.join(dreamDir, 'config.json'),
      JSON.stringify({ memory: true, learning: true, decisions: true, knowledge: true }),
      'utf-8',
    );

    await getMigration().run(makeCtx());
    // Second run — everything already removed
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();

    // Config still has no learning key
    const config = JSON.parse(await fs.readFile(path.join(dreamDir, 'config.json'), 'utf-8'));
    expect(config.learning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// purge-learning-global-v1 (global)
// ---------------------------------------------------------------------------

describe('purge-learning-global-v1 migration', () => {
  let tmpDir: string;
  let fakeHome: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-purge-global-learning-test-'));
    fakeHome = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(fakeHome, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function getMigration(): Migration<'global'> {
    const m = MIGRATIONS.find(m => m.id === 'purge-learning-global-v1');
    if (!m) throw new Error('purge-learning-global-v1 migration not found');
    return m as Migration<'global'>;
  }

  function makeCtx(): import('../src/cli/utils/migrations.js').GlobalMigrationContext {
    return { scope: 'global', devflowDir: fakeHome };
  }

  it('is registered in MIGRATIONS with global scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'purge-learning-global-v1');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('global');
  });

  it('removes learning.json from devflowDir when it exists', async () => {
    await fs.writeFile(path.join(fakeHome, 'learning.json'), '{"max_daily_runs":5}', 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(path.join(fakeHome, 'learning.json'))).rejects.toThrow();
  });

  it('is a no-op when learning.json does not exist', async () => {
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('is idempotent — running twice produces no errors', async () => {
    await fs.writeFile(path.join(fakeHome, 'learning.json'), '{"max_daily_runs":5}', 'utf-8');
    await getMigration().run(makeCtx());
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });
});

// purge-orphaned-dream-commit-hook-v1 (global)
// ---------------------------------------------------------------------------

describe('purge-orphaned-dream-commit-hook-v1 migration', () => {
  let tmpDir: string;
  let fakeHome: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-purge-dream-commit-test-'));
    fakeHome = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(path.join(fakeHome, 'scripts', 'hooks'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const hookPath = (): string => path.join(fakeHome, 'scripts', 'hooks', 'dream-commit');

  function getMigration(): Migration<'global'> {
    const m = MIGRATIONS.find(m => m.id === 'purge-orphaned-dream-commit-hook-v1');
    if (!m) throw new Error('purge-orphaned-dream-commit-hook-v1 migration not found');
    return m as Migration<'global'>;
  }

  function makeCtx(): import('../src/cli/utils/migrations.js').GlobalMigrationContext {
    return { scope: 'global', devflowDir: fakeHome };
  }

  it('is registered in MIGRATIONS with global scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'purge-orphaned-dream-commit-hook-v1');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('global');
  });

  it('removes the orphaned dream-commit hook when present (additive copy would leave it)', async () => {
    await fs.writeFile(hookPath(), '#!/bin/bash\n', 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(hookPath())).rejects.toThrow();
  });

  it('is a no-op when the hook does not exist (fresh install)', async () => {
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('is idempotent — running twice produces no errors', async () => {
    await fs.writeFile(hookPath(), '#!/bin/bash\n', 'utf-8');
    await getMigration().run(makeCtx());
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });
});

// purge-orphaned-decisions-index-v1 (global)
// ---------------------------------------------------------------------------

describe('purge-orphaned-decisions-index-v1 migration', () => {
  let tmpDir: string;
  let fakeHome: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-purge-decisions-index-test-'));
    fakeHome = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(path.join(fakeHome, 'scripts', 'hooks', 'lib'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const scriptPath = (): string =>
    path.join(fakeHome, 'scripts', 'hooks', 'lib', 'decisions-index.cjs');

  function getMigration(): Migration<'global'> {
    const m = MIGRATIONS.find(m => m.id === 'purge-orphaned-decisions-index-v1');
    if (!m) throw new Error('purge-orphaned-decisions-index-v1 migration not found');
    return m as Migration<'global'>;
  }

  function makeCtx(): import('../src/cli/utils/migrations.js').GlobalMigrationContext {
    return { scope: 'global', devflowDir: fakeHome };
  }

  it('is registered in MIGRATIONS with global scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'purge-orphaned-decisions-index-v1');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('global');
  });

  it('removes the orphaned decisions-index.cjs file when present', async () => {
    await fs.writeFile(scriptPath(), '// orphaned cjs\n', 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(scriptPath())).rejects.toThrow();
  });

  it('is ENOENT-idempotent — a second run (file already gone) does not throw', async () => {
    await fs.writeFile(scriptPath(), '// orphaned cjs\n', 'utf-8');
    await getMigration().run(makeCtx());
    // File is now gone; second run must be a no-op
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('is a no-op when the file does not exist (fresh install)', async () => {
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });
});

// purge-stale-memory-markers-v1 (per-project)
// ---------------------------------------------------------------------------

describe('purge-stale-memory-markers-v1 migration', () => {
  let tmpDir: string;
  let projectRoot: string;
  let devflowDir: string;
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-purge-memory-markers-test-'));
    projectRoot = path.join(tmpDir, 'project');
    devflowDir = path.join(projectRoot, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, 'home');
    fakeHome = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(fakeHome, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function getMigration(): Migration<'per-project'> {
    const m = MIGRATIONS.find(m => m.id === 'purge-stale-memory-markers-v1');
    if (!m) throw new Error('purge-stale-memory-markers-v1 migration not found');
    return m as Migration<'per-project'>;
  }

  function makeCtx(): import('../src/cli/utils/migrations.js').PerProjectMigrationContext {
    return {
      scope: 'per-project',
      devflowDir: fakeHome,
      memoryDir: path.join(devflowDir, 'memory'),
      projectRoot,
    };
  }

  it('is registered in MIGRATIONS with per-project scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'purge-stale-memory-markers-v1');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('per-project');
  });

  it('removes legacy memory.json and memory.processing (no session suffix)', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, 'memory.json'), '{"model":"haiku"}', 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'memory.processing'), '{}', 'utf-8');

    const result = await getMigration().run(makeCtx());

    await expect(fs.access(path.join(dreamDir, 'memory.json'))).rejects.toThrow();
    await expect(fs.access(path.join(dreamDir, 'memory.processing'))).rejects.toThrow();
    expect(result?.infos?.length).toBeGreaterThan(0);
  });

  it('removes per-session memory.*.json, memory.*.processing, memory.*.retries, memory.*.failed', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, 'memory.abc123.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'memory.abc123.processing'), '{}', 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'memory.abc123.retries'), '2', 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'memory.abc123.failed'), '{}', 'utf-8');
    // Non-memory markers must survive
    await fs.writeFile(path.join(dreamDir, 'decisions.abc123.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'config.json'), '{}', 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(path.join(dreamDir, 'memory.abc123.json'))).rejects.toThrow();
    await expect(fs.access(path.join(dreamDir, 'memory.abc123.processing'))).rejects.toThrow();
    await expect(fs.access(path.join(dreamDir, 'memory.abc123.retries'))).rejects.toThrow();
    await expect(fs.access(path.join(dreamDir, 'memory.abc123.failed'))).rejects.toThrow();
    // decisions and config survive
    await expect(fs.access(path.join(dreamDir, 'decisions.abc123.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dreamDir, 'config.json'))).resolves.toBeUndefined();
  });

  it('is a no-op when dream dir does not exist', async () => {
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('is idempotent (ENOENT-safe on second run)', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, 'memory.json'), '{}', 'utf-8');

    await getMigration().run(makeCtx());
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('appears after purge-learning-global-v1 in MIGRATIONS array', () => {
    const learningIdx = MIGRATIONS.findIndex(m => m.id === 'purge-learning-global-v1');
    const memoryIdx = MIGRATIONS.findIndex(m => m.id === 'purge-stale-memory-markers-v1');
    expect(learningIdx).toBeGreaterThanOrEqual(0);
    expect(memoryIdx).toBeGreaterThan(learningIdx);
  });

  it('rethrows non-ENOENT errors from fixed-file unlink (avoids PF-004 silent-swallow)', async () => {
    // avoids PF-004: migration idempotency means a buggy run is never re-swept —
    // so the non-ENOENT error contract must be correct the first time.
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });

    // Place a real file so readdir succeeds; spy on the unlink for the fixed-name file
    await fs.writeFile(path.join(dreamDir, 'memory.json'), '{}', 'utf-8');

    const originalUnlink = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async (p: fs.PathLike) => {
      const filePath = p.toString();
      if (filePath.endsWith('memory.json')) {
        const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
        throw err;
      }
      return originalUnlink(p as Parameters<typeof originalUnlink>[0]);
    });

    try {
      await expect(getMigration().run(makeCtx())).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('rethrows non-ENOENT errors from readdir (avoids PF-004 silent-swallow)', async () => {
    // avoids PF-004: readdir on a non-existent dir is ENOENT (handled), but
    // other errors (EACCES, EIO, etc.) must propagate to the migration runner.
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });

    const spy = vi.spyOn(fs, 'readdir').mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    );

    try {
      await expect(getMigration().run(makeCtx())).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// purge-devflow-teammate-mode-global-v1 (global)
// ---------------------------------------------------------------------------

describe('purge-devflow-teammate-mode-global-v1 migration', () => {
  let tmpDir: string;
  let devflowDir: string;

  const getMigration = () => {
    const m = MIGRATIONS.find(m => m.id === 'purge-devflow-teammate-mode-global-v1');
    if (!m) throw new Error('purge-devflow-teammate-mode-global-v1 migration not found');
    return m;
  };

  const makeCtx = () => ({ devflowDir });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-teammate-global-test-'));
    devflowDir = path.join(tmpDir, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('is registered in MIGRATIONS array', () => {
    expect(getMigration()).toBeDefined();
    expect(getMigration().scope).toBe('global');
  });

  it('appears after purge-stale-memory-markers-v1 in MIGRATIONS array', () => {
    const memoryIdx = MIGRATIONS.findIndex(m => m.id === 'purge-stale-memory-markers-v1');
    const teammateIdx = MIGRATIONS.findIndex(m => m.id === 'purge-devflow-teammate-mode-global-v1');
    expect(memoryIdx).toBeGreaterThanOrEqual(0);
    expect(teammateIdx).toBeGreaterThan(memoryIdx);
  });

  it('runs without error even when settings file is absent', async () => {
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('returns empty infos and warnings', async () => {
    const result = await getMigration().run(makeCtx());
    expect(result?.infos ?? []).toEqual([]);
    expect(result?.warnings ?? []).toEqual([]);
  });

  it('is idempotent (second run also succeeds)', async () => {
    await getMigration().run(makeCtx());
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// purge-devflow-teammate-mode-v1 (per-project)
// ---------------------------------------------------------------------------

describe('purge-devflow-teammate-mode-v1 migration', () => {
  let tmpDir: string;
  let devflowDir: string;
  let projectRoot: string;
  let settingsPath: string;

  const getMigration = () => {
    const m = MIGRATIONS.find(m => m.id === 'purge-devflow-teammate-mode-v1');
    if (!m) throw new Error('purge-devflow-teammate-mode-v1 migration not found');
    return m;
  };

  const makeCtx = () => ({ devflowDir, projectRoot });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-teammate-perproj-test-'));
    devflowDir = path.join(tmpDir, '.devflow');
    projectRoot = tmpDir;
    settingsPath = path.join(projectRoot, '.claude', 'settings.json');
    await fs.mkdir(devflowDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('is registered in MIGRATIONS array', () => {
    expect(getMigration()).toBeDefined();
    expect(getMigration().scope).toBe('per-project');
  });

  it('appears after purge-devflow-teammate-mode-global-v1 in MIGRATIONS array', () => {
    const globalIdx = MIGRATIONS.findIndex(m => m.id === 'purge-devflow-teammate-mode-global-v1');
    const perProjIdx = MIGRATIONS.findIndex(m => m.id === 'purge-devflow-teammate-mode-v1');
    expect(globalIdx).toBeGreaterThanOrEqual(0);
    expect(perProjIdx).toBeGreaterThan(globalIdx);
  });

  it('removes Devflow-written teammateMode:"auto" from project settings.json', async () => {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    const settings = { teammateMode: 'auto', hooks: { Stop: [] }, env: { TOOL: 'true' } };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    await getMigration().run(makeCtx());

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBeUndefined();
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.env.TOOL).toBe('true');
  });

  it('preserves user-set teammateMode values (e.g., "tmux")', async () => {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    const settings = { teammateMode: 'tmux', hooks: {} };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    await getMigration().run(makeCtx());

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBe('tmux');
  });

  it('preserves user-set teammateMode values (e.g., "in-process")', async () => {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    const settings = { teammateMode: 'in-process', hooks: {} };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    await getMigration().run(makeCtx());

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBe('in-process');
  });

  it('is a no-op when settings file does not exist', async () => {
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('is idempotent (second run also succeeds)', async () => {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    const settings = { teammateMode: 'auto' };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    await getMigration().run(makeCtx());
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBeUndefined();
  });

  it('returns empty infos and warnings', async () => {
    const result = await getMigration().run(makeCtx());
    expect(result?.infos ?? []).toEqual([]);
    expect(result?.warnings ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// purge-dead-working-memory-sentinel-v1 (per-project)
// applies ADR-001 (clean-break; dream config is sole source of truth)
// avoids PF-004 (idempotency means a buggy run is never re-swept — the
//   rethrow contract must be correct on the first attempt)
// ---------------------------------------------------------------------------

describe('purge-dead-working-memory-sentinel-v1 migration', () => {
  let tmpDir: string;
  let projectRoot: string;
  let devflowDir: string;
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-purge-dead-sentinel-test-'));
    projectRoot = path.join(tmpDir, 'project');
    devflowDir = path.join(projectRoot, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, 'home');
    fakeHome = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(fakeHome, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function getMigration(): Migration<'per-project'> {
    const m = MIGRATIONS.find(m => m.id === 'purge-dead-working-memory-sentinel-v1');
    if (!m) throw new Error('purge-dead-working-memory-sentinel-v1 migration not found');
    return m as Migration<'per-project'>;
  }

  function makeCtx(): import('../src/cli/utils/migrations.js').PerProjectMigrationContext {
    return {
      scope: 'per-project',
      devflowDir: fakeHome,
      memoryDir: path.join(devflowDir, 'memory'),
      projectRoot,
    };
  }

  it('is registered in MIGRATIONS with per-project scope', () => {
    // applies ADR-001: per-project scope ensures cleanup targets the correct project tree
    const m = MIGRATIONS.find(m => m.id === 'purge-dead-working-memory-sentinel-v1');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('per-project');
  });

  it('removes .working-memory-disabled sentinel when present and returns info', async () => {
    // applies ADR-001: file is dead code — dream config is now the sole gate
    const memoryDir = path.join(devflowDir, 'memory');
    await fs.mkdir(memoryDir, { recursive: true });
    const sentinelPath = path.join(memoryDir, '.working-memory-disabled');
    await fs.writeFile(sentinelPath, '', 'utf-8');

    const result = await getMigration().run(makeCtx());

    await expect(fs.access(sentinelPath)).rejects.toThrow();
    expect(result?.infos?.length).toBeGreaterThan(0);
    expect(result?.warnings ?? []).toEqual([]);
  });

  it('is a no-op when sentinel is absent (ENOENT) without throwing', async () => {
    // avoids PF-004: idempotency — sentinel already gone is a valid success state
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
    const result = await getMigration().run(makeCtx());
    expect(result?.infos ?? []).toEqual([]);
    expect(result?.warnings ?? []).toEqual([]);
  });

  it('rethrows non-ENOENT errors (avoids PF-004 silent-swallow)', async () => {
    // avoids PF-004: migration idempotency means a buggy run is never re-swept;
    // the rethrow contract must be correct on the first attempt so callers know it failed.
    // Point unlink at a path that yields ENOTDIR by putting a file where the dir should be.
    const memoryParent = path.join(devflowDir, 'memory');
    // Write a plain file where the memory directory should be so that
    // path.join(memoryParent, '.working-memory-disabled') produces ENOTDIR.
    await fs.writeFile(memoryParent, 'not-a-dir', 'utf-8');

    await expect(getMigration().run(makeCtx())).rejects.toThrow();
  });

  it('appears after purge-stale-memory-markers-v1 in MIGRATIONS array', () => {
    const staleIdx = MIGRATIONS.findIndex(m => m.id === 'purge-stale-memory-markers-v1');
    const deadIdx = MIGRATIONS.findIndex(m => m.id === 'purge-dead-working-memory-sentinel-v1');
    expect(staleIdx).toBeGreaterThanOrEqual(0);
    expect(deadIdx).toBeGreaterThan(staleIdx);
  });
});

// ---------------------------------------------------------------------------
// purge-dream-marker-pipeline-v1 (per-project)
// Sweeps decisions.*/curation.* markers and fixed-name stamps from the retired
// marker pipeline. The queue files and config.json are live inputs of the
// Dream agent and must survive.
// avoids PF-004 (idempotency means a buggy run is never re-swept — the rethrow
//   contract must be correct on the first attempt)
// ---------------------------------------------------------------------------

describe('purge-dream-marker-pipeline-v1 migration', () => {
  let tmpDir: string;
  let projectRoot: string;
  let devflowDir: string;
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-purge-dream-markers-test-'));
    projectRoot = path.join(tmpDir, 'project');
    devflowDir = path.join(projectRoot, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, 'home');
    fakeHome = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(fakeHome, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function getMigration(): Migration<'per-project'> {
    const m = MIGRATIONS.find(m => m.id === 'purge-dream-marker-pipeline-v1');
    if (!m) throw new Error('purge-dream-marker-pipeline-v1 migration not found');
    return m as Migration<'per-project'>;
  }

  function makeCtx(): import('../src/cli/utils/migrations.js').PerProjectMigrationContext {
    return {
      scope: 'per-project',
      devflowDir: fakeHome,
      memoryDir: path.join(devflowDir, 'memory'),
      projectRoot,
    };
  }

  it('is registered in MIGRATIONS with per-project scope', () => {
    const m = MIGRATIONS.find(m => m.id === 'purge-dream-marker-pipeline-v1');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('per-project');
  });

  it('removes legacy fixed-name stamps: .decisions-runs-today, .curation-last, .processor-spawned-at', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, '.decisions-runs-today'), '2026-01-01\t2', 'utf-8');
    await fs.writeFile(path.join(dreamDir, '.curation-last'), '1234567890', 'utf-8');
    await fs.writeFile(path.join(dreamDir, '.processor-spawned-at'), '1234567890', 'utf-8');

    const result = await getMigration().run(makeCtx());

    await expect(fs.access(path.join(dreamDir, '.decisions-runs-today'))).rejects.toThrow();
    await expect(fs.access(path.join(dreamDir, '.curation-last'))).rejects.toThrow();
    await expect(fs.access(path.join(dreamDir, '.processor-spawned-at'))).rejects.toThrow();
    expect(result?.infos?.length).toBeGreaterThan(0);
  });

  it('removes per-session decisions.*/curation.* markers across all 4 suffixes', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    for (const type of ['decisions', 'curation']) {
      for (const suffix of ['json', 'processing', 'retries', 'failed']) {
        await fs.writeFile(path.join(dreamDir, `${type}.abc123.${suffix}`), '{}', 'utf-8');
      }
    }

    await getMigration().run(makeCtx());

    for (const type of ['decisions', 'curation']) {
      for (const suffix of ['json', 'processing', 'retries', 'failed']) {
        await expect(fs.access(path.join(dreamDir, `${type}.abc123.${suffix}`))).rejects.toThrow();
      }
    }
  });

  it('does NOT touch config.json (shared multi-feature config)', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    const configContent = JSON.stringify({ memory: true, decisions: true, knowledge: true });
    await fs.writeFile(path.join(dreamDir, 'config.json'), configContent, 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'decisions.abc123.json'), '{}', 'utf-8');

    await getMigration().run(makeCtx());

    const survived = await fs.readFile(path.join(dreamDir, 'config.json'), 'utf-8');
    expect(survived).toBe(configContent);
  });

  it('does NOT touch the new .pending-turns.jsonl/.pending-turns.processing queue', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, '.pending-turns.jsonl'), '{"role":"user","content":"hi","ts":1}\n', 'utf-8');
    await fs.writeFile(path.join(dreamDir, '.pending-turns.processing'), '{"role":"user","content":"hi","ts":1}\n', 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'decisions.abc123.json'), '{}', 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(path.join(dreamDir, '.pending-turns.jsonl'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dreamDir, '.pending-turns.processing'))).resolves.toBeUndefined();
  });

  it('does NOT touch .last-dream-ok or .worker.lock (owned by purge-dream-worker-state-v1)', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, '.last-dream-ok'), '', 'utf-8');
    await fs.mkdir(path.join(dreamDir, '.worker.lock'), { recursive: true });
    await fs.writeFile(path.join(dreamDir, 'decisions.abc123.json'), '{}', 'utf-8');

    await getMigration().run(makeCtx());

    await expect(fs.access(path.join(dreamDir, '.last-dream-ok'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dreamDir, '.worker.lock'))).resolves.toBeUndefined();
  });

  it('is a no-op when dream dir does not exist', async () => {
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('is idempotent (ENOENT-safe on second run)', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, '.decisions-runs-today'), '2026-01-01\t2', 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'decisions.abc123.json'), '{}', 'utf-8');

    await getMigration().run(makeCtx());
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('returns empty infos when nothing to remove', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, 'config.json'), '{}', 'utf-8');

    const result = await getMigration().run(makeCtx());
    expect(result?.infos ?? []).toEqual([]);
  });

  it('appears after purge-dead-working-memory-sentinel-v1 in MIGRATIONS array', () => {
    const deadIdx = MIGRATIONS.findIndex(m => m.id === 'purge-dead-working-memory-sentinel-v1');
    const dreamIdx = MIGRATIONS.findIndex(m => m.id === 'purge-dream-marker-pipeline-v1');
    expect(deadIdx).toBeGreaterThanOrEqual(0);
    expect(dreamIdx).toBeGreaterThan(deadIdx);
  });

  it('rethrows non-ENOENT errors from fixed-file unlink (avoids PF-004 silent-swallow)', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.writeFile(path.join(dreamDir, '.decisions-runs-today'), '2026-01-01\t2', 'utf-8');

    const originalUnlink = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async (p: fs.PathLike) => {
      const filePath = p.toString();
      if (filePath.endsWith('.decisions-runs-today')) {
        const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
        throw err;
      }
      return originalUnlink(p as Parameters<typeof originalUnlink>[0]);
    });

    try {
      await expect(getMigration().run(makeCtx())).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('rethrows non-ENOENT errors from readdir (avoids PF-004 silent-swallow)', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });

    const spy = vi.spyOn(fs, 'readdir').mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    );

    try {
      await expect(getMigration().run(makeCtx())).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});


// ---------------------------------------------------------------------------
// purge-dream-worker-state-v1 (per-project)
// Removes inert state files left by the retired detached dream worker:
// decisions/.disabled, dream/.last-dream-ok, dream/last-run-summary, and the
// dream/.worker.lock directory. The queue files and config.json are live
// inputs of the Dream agent and must survive.
// ---------------------------------------------------------------------------

describe('purge-dream-worker-state-v1 migration', () => {
  let tmpDir: string;
  let projectRoot: string;
  let devflowDir: string;
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-purge-dream-worker-test-'));
    projectRoot = path.join(tmpDir, 'project');
    devflowDir = path.join(projectRoot, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, 'home');
    fakeHome = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(fakeHome, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function getMigration(): Migration<'per-project'> {
    const m = MIGRATIONS.find(m => m.id === 'purge-dream-worker-state-v1');
    if (!m) throw new Error('purge-dream-worker-state-v1 migration not found');
    return m as Migration<'per-project'>;
  }

  function makeCtx(): import('../src/cli/utils/migrations.js').PerProjectMigrationContext {
    return {
      scope: 'per-project',
      devflowDir: fakeHome,
      memoryDir: path.join(devflowDir, 'memory'),
      projectRoot,
    };
  }

  it('is registered in MIGRATIONS with per-project scope, after purge-dream-marker-pipeline-v1', () => {
    const markerIdx = MIGRATIONS.findIndex(m => m.id === 'purge-dream-marker-pipeline-v1');
    const workerIdx = MIGRATIONS.findIndex(m => m.id === 'purge-dream-worker-state-v1');
    expect(workerIdx).toBeGreaterThan(markerIdx);
    expect(MIGRATIONS[workerIdx].scope).toBe('per-project');
  });

  it('removes .disabled sentinel, .last-dream-ok, last-run-summary, and the .worker.lock dir', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    const decisionsDir = path.join(devflowDir, 'decisions');
    await fs.mkdir(dreamDir, { recursive: true });
    await fs.mkdir(decisionsDir, { recursive: true });
    await fs.writeFile(path.join(decisionsDir, '.disabled'), '', 'utf-8');
    await fs.writeFile(path.join(dreamDir, '.last-dream-ok'), '', 'utf-8');
    await fs.writeFile(path.join(dreamDir, 'last-run-summary'), 'Materialized ADR-009.', 'utf-8');
    await fs.mkdir(path.join(dreamDir, '.worker.lock'), { recursive: true });

    const result = await getMigration().run(makeCtx());

    await expect(fs.access(path.join(decisionsDir, '.disabled'))).rejects.toThrow();
    await expect(fs.access(path.join(dreamDir, '.last-dream-ok'))).rejects.toThrow();
    await expect(fs.access(path.join(dreamDir, 'last-run-summary'))).rejects.toThrow();
    await expect(fs.access(path.join(dreamDir, '.worker.lock'))).rejects.toThrow();
    expect(result?.infos?.length).toBeGreaterThan(0);
  });

  it('does NOT touch config.json or the queue files', async () => {
    const dreamDir = path.join(devflowDir, 'dream');
    await fs.mkdir(dreamDir, { recursive: true });
    const configContent = JSON.stringify({ memory: true, decisions: true, knowledge: true });
    await fs.writeFile(path.join(dreamDir, 'config.json'), configContent, 'utf-8');
    await fs.writeFile(path.join(dreamDir, '.pending-turns.jsonl'), '{"role":"user","content":"hi","ts":1}\n', 'utf-8');
    await fs.writeFile(path.join(dreamDir, '.pending-turns.processing'), '{"role":"user","content":"hi","ts":1}\n', 'utf-8');
    await fs.writeFile(path.join(dreamDir, '.last-dream-ok'), '', 'utf-8');

    await getMigration().run(makeCtx());

    expect(await fs.readFile(path.join(dreamDir, 'config.json'), 'utf-8')).toBe(configContent);
    await expect(fs.access(path.join(dreamDir, '.pending-turns.jsonl'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dreamDir, '.pending-turns.processing'))).resolves.toBeUndefined();
  });

  it('is a no-op when nothing exists (fresh project) and idempotent on second run', async () => {
    const first = await getMigration().run(makeCtx());
    expect(first?.infos ?? []).toEqual([]);
    await expect(getMigration().run(makeCtx())).resolves.not.toThrow();
  });

  it('rethrows non-ENOENT errors from unlink (avoids PF-004 silent-swallow)', async () => {
    const decisionsDir = path.join(devflowDir, 'decisions');
    await fs.mkdir(decisionsDir, { recursive: true });
    await fs.writeFile(path.join(decisionsDir, '.disabled'), '', 'utf-8');

    const spy = vi.spyOn(fs, 'unlink').mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    );

    try {
      await expect(getMigration().run(makeCtx())).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

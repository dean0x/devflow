import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeFileAtomicExclusive } from './fs-atomic.js';

/**
 * @file migrations.ts
 *
 * Run-once migration registry for devflow init. Migrations execute at most once
 * per machine (global scope) or once per machine across all discovered projects
 * (per-project scope). State is persisted at ~/.devflow/migrations.json.
 */

export type MigrationScope = 'global' | 'per-project';

/**
 * D38: Discriminated union for MigrationContext eliminates ISP violation.
 *
 * GlobalMigrationContext: only devflowDir — per-project fields (memoryDir,
 * projectRoot) are structurally absent, so migrations that accidentally
 * reference them fail at compile time rather than receiving empty-string
 * sentinels. claudeDir is dropped entirely (was present in original but never
 * consumed by any migration).
 *
 * PerProjectMigrationContext: adds memoryDir and projectRoot so per-project
 * migrations can access them without receiving '' sentinels.
 */
export type GlobalMigrationContext = {
  scope: 'global';
  devflowDir: string;
};

export type PerProjectMigrationContext = {
  scope: 'per-project';
  devflowDir: string;
  memoryDir: string;
  projectRoot: string;
};

export type MigrationContext = GlobalMigrationContext | PerProjectMigrationContext;

export interface MigrationRunResult {
  infos: string[];
  warnings: string[];
}

/**
 * Inline migrations return MigrationRunResult for structured output (infos/warnings
 * surfaced to the user). Test overrides may return void — the runner treats void as
 * { infos: [], warnings: [] } for backward compat.
 */
export interface Migration<S extends MigrationScope = MigrationScope> {
  id: string;
  description: string;
  scope: S;
  run(
    ctx: S extends 'global' ? GlobalMigrationContext : PerProjectMigrationContext,
  ): Promise<MigrationRunResult | void>;
}

/**
 * D31: Registry pattern over scattered `if (!applied.includes(...))` conditionals.
 *
 * A typed array of Migration entries provides:
 * - Single authoritative list of all one-time migrations (no hunting across files)
 * - Explicit scope field that drives the runner's dispatch logic without branching
 *   on migration IDs
 * - Append-only growth: adding a migration = adding an entry here, nothing else
 *
 * The `scope` field distinguishes global (one run per machine, no project context
 * needed) from per-project (sweeps every discovered Claude-enabled project root).
 */

/**
 * D36: The `shadow-overrides-v2-names` entry retrofits the inline
 * `migrateShadowOverrides` call that previously lived directly in init.ts (~line 822).
 * Retrofitting into the registry eliminates the one-off migration pattern and
 * establishes the registry as the single entry point for all one-time changes.
 * The semantics are identical — the function is imported from its new home in
 * shadow-overrides-migration.ts.
 */
const MIGRATION_SHADOW_OVERRIDES: Migration<'global'> = {
  id: 'shadow-overrides-v2-names',
  description: 'Rename shadow-override skill directories to V2 names',
  scope: 'global',
  run: async (ctx: GlobalMigrationContext): Promise<MigrationRunResult> => {
    const { migrateShadowOverridesRegistry } = await import('./shadow-overrides-migration.js');
    const result = await migrateShadowOverridesRegistry(ctx.devflowDir);
    const infos = result.migrated > 0
      ? [`Migrated ${result.migrated} shadow override(s)`]
      : [];
    return { infos, warnings: result.warnings };
  },
};

const MIGRATION_PURGE_LEGACY_KNOWLEDGE: Migration<'per-project'> = {
  id: 'purge-legacy-knowledge-v2',
  description: 'Remove pre-v2 low-signal knowledge entries (ADR-002, PF-001, PF-003, PF-005)',
  scope: 'per-project',
  run: async (ctx: PerProjectMigrationContext): Promise<MigrationRunResult> => {
    const { purgeLegacyKnowledgeEntries } = await import('./legacy-knowledge-purge.js');
    const result = await purgeLegacyKnowledgeEntries({ memoryDir: ctx.memoryDir });
    const infos = result.removed > 0
      ? [`Purged ${result.removed} legacy knowledge entry(ies) in ${result.files.length} file(s)`]
      : [];
    return { infos, warnings: [] };
  },
};

export const MIGRATIONS: readonly Migration[] = [
  MIGRATION_SHADOW_OVERRIDES,
  MIGRATION_PURGE_LEGACY_KNOWLEDGE,
];

const MIGRATIONS_FILE = 'migrations.json';

interface MigrationsFile {
  applied: string[];
}

/**
 * D30: State lives at `~/.devflow/migrations.json` (scope-independent) rather
 * than the install manifest because:
 *
 * - The install manifest is scope-specific: user-scope manifests live at
 *   `~/.devflow/manifest.json` while local-scope manifests live at
 *   `.devflow/manifest.json` inside the repo. A migration that runs on user-scope
 *   init wouldn't be recorded in a local-scope manifest, so the migration would
 *   re-run on the next local-scope init.
 * - Migration state is machine-wide: once a global migration runs on a machine it
 *   should never re-run regardless of which project or scope triggered devflow init.
 * - `~/.devflow/migrations.json` is always writable (home-dir location), whereas
 *   local-scope devflowDir may be inside a read-only checkout.
 *
 * @param devflowDir - absolute path to `~/.devflow` (always the home-dir location)
 */
export async function readAppliedMigrations(devflowDir: string): Promise<string[]> {
  const filePath = path.join(devflowDir, MIGRATIONS_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as MigrationsFile;
    if (!Array.isArray(parsed.applied)) return [];
    return parsed.applied;
  } catch {
    // File missing or malformed — treat as empty
    return [];
  }
}

/**
 * Write applied migration IDs to `~/.devflow/migrations.json` atomically.
 * Uses exclusive-create tmp + rename so readers never observe a partial file
 * and a stale tmp from a previous crash does not silently overwrite good data.
 *
 * Delegates to `writeFileAtomicExclusive` in fs-atomic.ts (D34/D39: canonical
 * TS atomic-write helper with race-tolerant unlink before retry).
 *
 * @param devflowDir - absolute path to `~/.devflow`
 * @param ids - full list of applied migration IDs (cumulative, not incremental)
 */
export async function writeAppliedMigrations(
  devflowDir: string,
  ids: string[],
): Promise<void> {
  await fs.mkdir(devflowDir, { recursive: true });
  const filePath = path.join(devflowDir, MIGRATIONS_FILE);
  const data: MigrationsFile = { applied: ids };
  const content = JSON.stringify(data, null, 2) + '\n';
  await writeFileAtomicExclusive(filePath, content);
}

export interface MigrationFailure {
  id: string;
  scope: MigrationScope;
  project?: string;
  error: Error;
}

export interface RunMigrationsResult {
  newlyApplied: string[];
  failures: MigrationFailure[];
  infos: string[];
  warnings: string[];
}

/**
 * Process an array of items with at most `limit` concurrent Promises.
 * Returns PromiseSettledResult for every item in the original order.
 */
async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.allSettled(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

/** Coerce a migration run result (may be void for test stubs) to { infos, warnings }. */
function normaliseRunResult(result: MigrationRunResult | void): MigrationRunResult {
  if (result == null) return { infos: [], warnings: [] };
  return result;
}

/**
 * Run a single global migration, returning { applied, failure, infos, warnings }.
 *
 * D33: Non-fatal semantics — if a global migration fails, we record the failure
 * and continue. The failing migration is NOT marked as applied so it retries on
 * the next `devflow init` run (transient errors such as filesystem contention
 * are eventually resolved without blocking the install).
 */
async function runGlobalMigration(
  migration: Migration<'global'>,
  ctx: GlobalMigrationContext,
): Promise<{
  applied: boolean;
  failure: MigrationFailure | null;
  infos: string[];
  warnings: string[];
}> {
  try {
    const raw = await migration.run(ctx);
    const runResult = normaliseRunResult(raw);
    return { applied: true, failure: null, infos: runResult.infos, warnings: runResult.warnings };
  } catch (error) {
    return {
      applied: false,
      failure: {
        id: migration.id,
        scope: migration.scope,
        error: error instanceof Error ? error : new Error(String(error)),
      },
      infos: [],
      warnings: [],
    };
  }
}

/**
 * Run a single per-project migration across all discovered project roots with a
 * concurrency cap, returning { applied, failures, infos, warnings }.
 *
 * D35: Per-project migrations run across all discovered projects with a
 * concurrency cap of 16 to avoid EMFILE on machines with 50–200 projects.
 * This matches the pattern used for .claudeignore multi-project install at
 * init.ts:962-974 — each project has its own `.memory/.knowledge.lock` so
 * there is no cross-project contention. Promise.allSettled collects all
 * outcomes without short-circuiting on partial failures.
 *
 * Marking strategy: the migration is considered applied globally only when
 * ALL projects succeed. Any per-project failure causes the ID to remain
 * unapplied so the next `devflow init` (which may discover the same or
 * additional projects) can retry the failed projects.
 *
 * D37: When discoveredProjects is empty, Promise.allSettled([]) resolves
 * to [] and [].every(...) returns true (vacuous truth), which would mark
 * the migration applied even though no projects were swept. This is the
 * intended behaviour for machines that cloned a repo after the migration
 * ran — there are no legacy entries to purge. Recovery: if you later find
 * a project that was missed, remove ~/.devflow/migrations.json to force a
 * re-sweep on the next `devflow init`.
 */
async function runPerProjectMigration(
  migration: Migration<'per-project'>,
  ctx: { devflowDir: string },
  discoveredProjects: string[],
): Promise<{
  applied: boolean;
  failures: MigrationFailure[];
  infos: string[];
  warnings: string[];
}> {
  const results = await pooled(
    discoveredProjects,
    16,
    (projectRoot) => {
      const memoryDir = path.join(projectRoot, '.memory');
      return migration.run({
        scope: 'per-project',
        devflowDir: ctx.devflowDir,
        memoryDir,
        projectRoot,
      });
    },
  );

  const failures: MigrationFailure[] = [];
  const infos: string[] = [];
  const warnings: string[] = [];

  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      failures.push({
        id: migration.id,
        scope: migration.scope,
        project: discoveredProjects[i],
        error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
      });
    } else {
      const runResult = normaliseRunResult(result.value);
      infos.push(...runResult.infos);
      warnings.push(...runResult.warnings);
    }
  }

  const applied = results.every(r => r.status === 'fulfilled');
  return { applied, failures, infos, warnings };
}

/**
 * Run all unapplied migrations from MIGRATIONS.
 *
 * D32: Always-run-unapplied semantics (no fresh-vs-upgrade branch).
 * Fresh installs with no knowledge files are effectively no-ops — each migration
 * helper short-circuits when the data it targets doesn't exist (e.g.,
 * purgeLegacyKnowledgeEntries returns immediately when `.memory/knowledge/` is
 * absent; migrateShadowOverridesRegistry skips when no old-name directories exist).
 * Adding a fresh-vs-upgrade branch would require detecting "is this a fresh
 * install" reliably, which is harder than it appears (partial installs, reinstalls,
 * migrations from local to user scope). The always-run path is simpler and correct.
 *
 * @param ctx - devflowDir (memoryDir and projectRoot filled per-project)
 * @param discoveredProjects - absolute paths to discovered Claude-enabled project roots
 * @param registryOverride - override MIGRATIONS for testing (defaults to module-level MIGRATIONS)
 */
export async function runMigrations(
  ctx: { devflowDir: string },
  discoveredProjects: string[],
  registryOverride?: readonly Migration[],
): Promise<RunMigrationsResult> {
  const registry = registryOverride ?? MIGRATIONS;
  // Always read from home-dir devflow location so state is machine-wide
  const homeDevflowDir = path.join(os.homedir(), '.devflow');
  const appliedArray = await readAppliedMigrations(homeDevflowDir);
  // Convert to Set once for O(1) lookups throughout the loop (issue #9)
  const applied = new Set(appliedArray);

  const newlyApplied: string[] = [];
  const failures: MigrationFailure[] = [];
  const infos: string[] = [];
  const warnings: string[] = [];

  for (const migration of registry) {
    if (applied.has(migration.id)) continue; // Already done — skip

    if (migration.scope === 'global') {
      const globalCtx: GlobalMigrationContext = {
        scope: 'global',
        devflowDir: ctx.devflowDir,
      };
      // Type assertion required: TS narrows `migration.scope` to 'global' but cannot
      // narrow the generic parameter S of Migration<S> — the discriminant check is the
      // runtime guarantee. This replaces the original `as Migration<'global'>` cast.
      const outcome = await runGlobalMigration(migration as Migration<'global'>, globalCtx);
      if (outcome.applied) {
        newlyApplied.push(migration.id);
        infos.push(...outcome.infos);
        warnings.push(...outcome.warnings);
      } else if (outcome.failure) {
        failures.push(outcome.failure);
      }
    } else if (migration.scope === 'per-project') {
      // Same generic-narrowing constraint applies — discriminant check IS the guarantee.
      const outcome = await runPerProjectMigration(migration as Migration<'per-project'>, ctx, discoveredProjects);
      failures.push(...outcome.failures);
      infos.push(...outcome.infos);
      warnings.push(...outcome.warnings);
      if (outcome.applied) {
        newlyApplied.push(migration.id);
      }
    } else {
      // Exhaustiveness check — catches unhandled MigrationScope values at runtime
      const _exhaustive: never = migration.scope;
      throw new Error(`Unknown migration scope: ${_exhaustive}`);
    }
  }

  // Write state once at end, accumulating all newly applied IDs (issue #5 — O(N²) → O(1))
  if (newlyApplied.length > 0) {
    await writeAppliedMigrations(homeDevflowDir, [...appliedArray, ...newlyApplied]);
  }

  return { newlyApplied, failures, infos, warnings };
}

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * @file migrations.ts
 *
 * Run-once migration registry for devflow init. Migrations execute at most once
 * per machine (global scope) or once per machine across all discovered projects
 * (per-project scope). State is persisted at ~/.devflow/migrations.json.
 */

export type MigrationScope = 'global' | 'per-project';

export interface MigrationContext {
  memoryDir: string;
  projectRoot: string;
  devflowDir: string;
  claudeDir: string;
}

export interface Migration {
  id: string;
  description: string;
  scope: MigrationScope;
  run(ctx: MigrationContext): Promise<void>;
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
export const MIGRATIONS: Migration[] = [
  {
    id: 'shadow-overrides-v2-names',
    description: 'Rename shadow-override skill directories to V2 names',
    scope: 'global',
    run: async (ctx) => {
      const { migrateShadowOverridesRegistry } = await import('./shadow-overrides-migration.js');
      await migrateShadowOverridesRegistry(ctx.devflowDir);
    },
  },
  {
    id: 'purge-legacy-knowledge-v2',
    description: 'Remove pre-v2 low-signal knowledge entries (ADR-002, PF-001, PF-003, PF-005)',
    scope: 'per-project',
    run: async (ctx) => {
      const { purgeLegacyKnowledgeEntries } = await import('./legacy-knowledge-purge.js');
      await purgeLegacyKnowledgeEntries({ memoryDir: ctx.memoryDir });
    },
  },
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
 * Uses write-temp + rename so readers never observe a partial file.
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
  const tmp = `${filePath}.tmp`;
  const data: MigrationsFile = { applied: ids };
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  await fs.rename(tmp, filePath);
}

export interface MigrationFailure {
  id: string;
  scope: MigrationScope;
  project?: string;
  error: Error;
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
 * @param ctx - devflowDir and claudeDir (memoryDir and projectRoot filled per-project)
 * @param discoveredProjects - absolute paths to discovered Claude-enabled project roots
 * @param registryOverride - override MIGRATIONS for testing (defaults to module-level MIGRATIONS)
 */
export async function runMigrations(
  ctx: Omit<MigrationContext, 'memoryDir' | 'projectRoot'>,
  discoveredProjects: string[],
  registryOverride?: Migration[],
): Promise<{ newlyApplied: string[]; failures: MigrationFailure[] }> {
  const registry = registryOverride ?? MIGRATIONS;
  // Always read from home-dir devflow location so state is machine-wide
  const homeDevflowDir = path.join(os.homedir(), '.devflow');
  const applied = await readAppliedMigrations(homeDevflowDir);

  const newlyApplied: string[] = [];
  const failures: MigrationFailure[] = [];

  for (const migration of registry) {
    if (applied.includes(migration.id)) continue; // Already done — skip

    if (migration.scope === 'global') {
      /**
       * D33: Non-fatal semantics — if a global migration fails, we record the
       * failure and continue to the next migration. The failing migration is NOT
       * marked as applied so it will be retried on the next `devflow init` run.
       * This approach avoids blocking the install on transient errors (e.g.,
       * filesystem contention) while ensuring the migration is eventually applied.
       */
      try {
        await migration.run({ ...ctx, devflowDir: ctx.devflowDir, memoryDir: '', projectRoot: '' });
        newlyApplied.push(migration.id);
        // Persist after each successful migration so one failure doesn't lose
        // progress on previously completed migrations in this same run.
        await writeAppliedMigrations(homeDevflowDir, [...applied, ...newlyApplied]);
      } catch (error) {
        failures.push({
          id: migration.id,
          scope: migration.scope,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    } else {
      /**
       * D35: Per-project migrations run in parallel across all discovered projects.
       * This matches the pattern used for .claudeignore multi-project install at
       * init.ts:962-974 — each project has its own `.memory/.knowledge.lock` so
       * there is no cross-project contention. Promise.allSettled collects all
       * outcomes without short-circuiting on partial failures.
       *
       * Marking strategy: the migration is considered applied globally only when
       * ALL projects succeed. Any per-project failure causes the ID to remain
       * unapplied so the next `devflow init` (which may discover the same or
       * additional projects) can retry the failed projects.
       */
      const projectsToSweep =
        discoveredProjects.length > 0 ? discoveredProjects : [];

      const results = await Promise.allSettled(
        projectsToSweep.map(async (projectRoot) => {
          const memoryDir = path.join(projectRoot, '.memory');
          await migration.run({ ...ctx, memoryDir, projectRoot });
        }),
      );

      let allSucceeded = true;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          allSucceeded = false;
          failures.push({
            id: migration.id,
            scope: migration.scope,
            project: projectsToSweep[i],
            error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
          });
        }
      }

      if (allSucceeded) {
        newlyApplied.push(migration.id);
        // Persist incrementally so prior migrations aren't lost if this or a
        // later migration fails.
        await writeAppliedMigrations(homeDevflowDir, [...applied, ...newlyApplied]);
      }
    }
  }

  return { newlyApplied, failures };
}

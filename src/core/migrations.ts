/**
 * @file migrations.ts
 *
 * Run-once migration registry for devflow init. Migrations execute at most once
 * per machine (global scope) or once per machine across all discovered projects
 * (per-project scope). State is persisted at ~/.devflow/migrations.json.
 *
 * Registry holds 2.x entries only (first: canonicalise-agent-keys-v1). To add a
 * migration, append an entry to MIGRATIONS below. No 1.x → 2.0 upgrade path.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import { getMemoryDir } from './project-paths.js';
import { LEGACY_AGENT_KEYS, canonicaliseAgentKeys, parseAgentMappingEnvelope } from './agent-models.js';

export type MigrationScope = 'global' | 'per-project';

/**
 * D38: Discriminated union context types eliminate ISP violation.
 *
 * GlobalMigrationContext: only devflowDir — per-project fields (memoryDir,
 * projectRoot) are structurally absent, so migrations that accidentally
 * reference them fail at compile time rather than receiving empty-string
 * sentinels. claudeDir is dropped entirely (was present in original but never
 * consumed by any migration).
 *
 * PerProjectMigrationContext: adds memoryDir and projectRoot so per-project
 * migrations can access them without receiving '' sentinels.
 *
 * Migration.run uses a conditional type directly over these two concrete types;
 * a union alias is not needed.
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

export interface MigrationRunResult {
  infos: string[];
  warnings: string[];
}

/**
 * A single migration entry. The `run` method returns a structured result
 * carrying infos and warnings surfaced to the user after `devflow init`.
 */
export interface Migration<S extends MigrationScope = MigrationScope> {
  id: string;
  description: string;
  scope: S;
  run(
    ctx: S extends 'global' ? GlobalMigrationContext : PerProjectMigrationContext,
  ): Promise<MigrationRunResult>;
}

/**
 * Discriminated union of all concrete migration variants.
 *
 * Prefer AnyMigration over the bare Migration<MigrationScope> (= Migration) in
 * registry and runner signatures: the union form lets TypeScript narrow the run()
 * overload by discriminating on `scope` at the call site, eliminating the
 * `as Migration<'global'>` casts that were previously required.
 */
export type AnyMigration = Migration<'global'> | Migration<'per-project'>;

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
 *
 * Append new migrations here.
 *
 * KNOWN ISSUE (out of scope for this wave): the migration runner retries a
 * THROWING migration on every `devflow init`, forever, with no cap or backoff.
 * This was acceptable with an empty MIGRATIONS registry (D37: the vacuous-truth
 * case); this registry's first real entry is added below. Fix deferred.
 *
 * Note how that interacts with `canonicalise-agent-keys-v1`: runGlobalMigration
 * marks a migration applied for ANY non-throwing return, and that entry never
 * throws — it catches every I/O and parse failure and returns it as a *warning*.
 * So it does NOT hit the unbounded-retry path. It hits the opposite one: a
 * transient EACCES or a failed write records the migration as applied and it
 * never runs again, leaving legacy keys on disk permanently.
 *
 * That is survivable by design rather than by luck: `readAgentMapping` applies
 * canonicaliseAgentKeys on EVERY read, so a user whose disk migration silently
 * failed still resolves their overrides correctly, and the next write persists
 * the canonical keys. The disk file self-heals; only the one-time rewrite is
 * lost. A future fix should make genuine I/O failure (as distinct from
 * "malformed file, skip it") throw so the runner retries it.
 */
export const MIGRATIONS: readonly AnyMigration[] = [
  {
    id: 'canonicalise-agent-keys-v1',
    description: 'Rename legacy agent keys in ~/.devflow/agent-models.json to their canonical names',
    scope: 'global',

    async run(ctx): Promise<MigrationRunResult> {
      const infos: string[] = []
      const warnings: string[] = []

      // Fast path: no legacy keys defined — skip without touching the file.
      if (Object.keys(LEGACY_AGENT_KEYS).length === 0) return { infos, warnings }

      const filePath = path.join(ctx.devflowDir, 'agent-models.json')
      // parseAgentMappingEnvelope handles IO, BOM-strip, JSON parse, and shape validation.
      // Raw read intentionally avoids readAgentMapping (which would drop unknown fields).
      const envelope = await parseAgentMappingEnvelope(filePath)
      if (envelope.kind === 'skip') return { infos, warnings }
      if (envelope.kind === 'warn') {
        warnings.push(`canonicalise-agent-keys-v1: ${envelope.message}`)
        return { infos, warnings }
      }

      const onWarning = (msg: string) => warnings.push(msg)
      const { agents: migrated, didMutate, renamed, dropped } = canonicaliseAgentKeys(
        envelope.rawAgents,
        onWarning,
      )
      if (!didMutate) return { infos, warnings }

      // Write back with the canonical keys, preserving the rest of the envelope.
      // Idempotent under concurrent execution (no lock needed; see D31 comment above).
      const updated = { ...envelope.envelope, agents: migrated }
      try {
        await writeFileAtomicExclusive(filePath, JSON.stringify(updated, null, 2) + '\n')
      } catch (err: unknown) {
        warnings.push(`canonicalise-agent-keys-v1: failed to write ${filePath}: ${(err as Error).message}`)
        return { infos, warnings }
      }

      if (renamed.length > 0) {
        infos.push(
          `Migrated agent-models.json: renamed ${renamed.map(k => `'${k}' → '${LEGACY_AGENT_KEYS[k] as string}'`).join(', ')}`,
        )
      }
      if (dropped.length > 0) {
        warnings.push(
          `canonicalise-agent-keys-v1: dropped legacy key(s) ${dropped.map(k => `'${k}'`).join(', ')} — canonical key already present, existing value kept`,
        )
      }
      return { infos, warnings }
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
 * Logger interface for surfacing migration output to the user.
 * Injected so the reporter can be tested without a live clack prompt session.
 */
export interface MigrationLogger {
  warn(msg: string): void;
  info(msg: string): void;
  success(msg: string): void;
}

/**
 * Surface migration result infos, warnings, failures, and newly-applied IDs
 * to the user via the provided logger.
 *
 * Extracted from runMigrationsWithFallback (init.ts) so reporting can be
 * tested independently of the project-list routing logic.
 */
export function reportMigrationResult(
  result: RunMigrationsResult,
  logger: MigrationLogger,
  verbose: boolean,
): void {
  for (const f of result.failures) {
    // D33: Non-fatal — warn but continue; migration will retry on next init
    const where = f.project ? ` in ${path.basename(f.project)}` : '';
    logger.warn(`Migration '${f.id}'${where} failed: ${f.error.message}`);
  }
  for (const info of result.infos) {
    logger.info(info);
  }
  for (const warn of result.warnings) {
    logger.warn(warn);
  }
  if (result.newlyApplied.length > 0) {
    logger.success(`Applied ${result.newlyApplied.length} migration(s)`);
  }
  if (verbose) {
    for (const id of result.newlyApplied) logger.info(`  ✓ ${id}`);
  }
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
    const runResult = await migration.run(ctx);
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
 * This matches the pattern used by `installClaudeignore` in init.ts for
 * multi-project install — each project has its own `.memory/.decisions.lock`
 * so there is no cross-project contention. Promise.allSettled collects all
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
 * intended behaviour: when MIGRATIONS is empty the applied-set write is
 * skipped entirely (newlyApplied stays empty), so the vacuous-truth branch
 * is a constant-time no-op.
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
      const memoryDir = getMemoryDir(projectRoot);
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
      infos.push(...result.value.infos);
      warnings.push(...result.value.warnings);
    }
  }

  const applied = results.every(r => r.status === 'fulfilled');
  return { applied, failures, infos, warnings };
}

/**
 * Run all unapplied migrations from MIGRATIONS.
 *
 * D32: Always-run-unapplied semantics (no fresh-vs-upgrade branch).
 * With an empty registry this is a constant-time no-op — the per-entry loop
 * never executes and migrations.json is never written.
 *
 * @param ctx - devflowDir (memoryDir and projectRoot filled per-project)
 * @param discoveredProjects - absolute paths to discovered Claude-enabled project roots
 * @param registryOverride - override MIGRATIONS for testing (defaults to module-level MIGRATIONS)
 */
export async function runMigrations(
  ctx: { devflowDir: string },
  discoveredProjects: string[],
  registryOverride?: readonly AnyMigration[],
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
      const outcome = await runGlobalMigration(migration, globalCtx);
      if (outcome.applied) {
        newlyApplied.push(migration.id);
        infos.push(...outcome.infos);
        warnings.push(...outcome.warnings);
      } else if (outcome.failure) {
        failures.push(outcome.failure);
      }
    } else if (migration.scope === 'per-project') {
      const outcome = await runPerProjectMigration(migration, ctx, discoveredProjects);
      failures.push(...outcome.failures);
      infos.push(...outcome.infos);
      warnings.push(...outcome.warnings);
      if (outcome.applied) {
        newlyApplied.push(migration.id);
      }
    } else {
      // Exhaustiveness check — AnyMigration covers all MigrationScope values;
      // migration is narrowed to `never` here so this branch is unreachable at runtime.
      const _exhaustive: never = migration;
      void _exhaustive;
      throw new Error('Unknown migration scope');
    }
  }

  // Write state once at end, accumulating all newly applied IDs (issue #5 — O(N²) → O(1))
  if (newlyApplied.length > 0) {
    await writeAppliedMigrations(homeDevflowDir, [...appliedArray, ...newlyApplied]);
  }

  return { newlyApplied, failures, infos, warnings };
}

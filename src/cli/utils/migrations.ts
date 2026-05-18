import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import { getMemoryDir, getFeaturesDir } from './project-paths.js';

// ---------------------------------------------------------------------------
// consolidate-to-devflow-dir helpers
// ---------------------------------------------------------------------------

/**
 * Move src to dest, skipping when src doesn't exist or dest already exists
 * (idempotent). Falls back to copy+delete on EXDEV (cross-device rename).
 */
async function moveFile(src: string, dest: string): Promise<void> {
  // Check source exists
  try { await fs.access(src); } catch { return; }
  // Skip if dest already present
  try { await fs.access(dest); return; } catch { /* dest absent, proceed */ }
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(src, dest);
  } catch (err) {
    // Cross-device: fall back to copy+delete
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fs.cp(src, dest, { recursive: true });
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

/**
 * Move a directory entry-by-entry into destDir.
 * srcDir itself is left in place (emptied); callers remove it after.
 */
async function moveDirContents(
  srcDir: string,
  destDir: string,
  skipNames: Set<string>,
): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true }) as import('fs').Dirent[];
  } catch { return; }

  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    await moveFile(src, dest);
  }
}

const DEVFLOW_GITIGNORE_CONTENT = `# Per-developer session state (fully transient)
memory/

# Sidecar dispatch system (fully transient)
sidecar/

# Per-developer observation logs and transient state
learning/learning-log.jsonl
learning/learning-log.v1.jsonl.bak
learning/learning.json
learning/.learning-manifest.json
learning/.learning.lock/
learning/.learning-notified-at
learning/.learning-notifications.json
learning/.learning-runs-today
learning/.learning-session-count
learning/.learning-batch-ids

# Per-developer decisions observation log and transient state
decisions/decisions-log.jsonl
decisions/decisions.json
decisions/.decisions-manifest.json
decisions/.decisions.lock/
decisions/.decisions-usage.json
decisions/.decisions-usage.lock/
decisions/.decisions-notifications.json
decisions/.decisions-runs-today
decisions/.decisions-batch-ids
decisions/.disabled

# Ephemeral doc artifacts
docs/handoff-*.md
docs/reviews/*/.last-review-head

# Transient files in features
features/.knowledge.lock/
features/.knowledge-last-refresh
features/.knowledge-refresh.lock
features/.disabled
features/.gitignore-configured

# Install state (local-scope only)
manifest.json

# Init marker
.gitignore-configured
`;

/** Known legacy / V1 files in .memory/ that must NOT be migrated. */
const MEMORY_SKIP_FILES = new Set([
  'knowledge',                        // pre-rename V1 decisions dir
  'short',                            // V1 format
  'index.md',                         // V1 format
  'candidates.json',                  // V1 format
  '.knowledge-usage.json',            // pre-rename
  '.working-memory-last-trigger',     // obsolete
  '.working-memory-update.log',       // old log
  '.gitignore-configured',            // replaced
  // Explicit files handled by mapped moves below — exclude from catch-all
  'WORKING-MEMORY.md',
  'backup.json',
  '.pending-turns.jsonl',
  '.pending-turns.processing',
  '.pending-turns.lock',
  '.learning-disabled',
  '.working-memory-disabled',
  '.sidecar',
  'decisions',
  'decisions-log.jsonl',
  'decisions.json',
  '.decisions-manifest.json',
  '.decisions.lock',
  '.decisions-usage.json',
  '.decisions-usage.lock',
  '.decisions-notifications.json',
  '.decisions-runs-today',
  '.decisions-batch-ids',
  'learning-log.jsonl',
  'learning.json',
  '.learning-manifest.json',
  '.learning-notified-at',
  '.learning-notifications.json',
  '.learning-runs-today',
  '.learning-session-count',
  '.learning-batch-ids',
  'debug',
  'working',
]);

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
  description: 'Remove pre-v2 low-signal decisions entries (ADR-002, PF-001, PF-003, PF-005)',
  scope: 'per-project',
  run: async (ctx: PerProjectMigrationContext): Promise<MigrationRunResult> => {
    const { purgeLegacyDecisionsEntries } = await import('./legacy-decisions-purge.js');
    const result = await purgeLegacyDecisionsEntries({ memoryDir: ctx.memoryDir, projectRoot: ctx.projectRoot });
    const infos = result.removed > 0
      ? [`Purged ${result.removed} legacy decisions entry(ies) in ${result.files.length} file(s)`]
      : [];
    return { infos, warnings: [] };
  },
};

/**
 * D-Fix3: Widens the v2 purge from 4 hardcoded IDs to ALL pre-v2 seeded
 * entries. The discriminator is the `- **Source**: self-learning:` marker:
 * any ADR/PF section lacking that marker is pre-v2 seeded content and is
 * removed. This fixes the gap where 7 of 10 seed entries survived the v2
 * migration on upgraded projects.
 *
 * v2 and v3 run independently — both must complete for the migration to be
 * considered done. On fresh installs, both are no-ops (no decisions files
 * exist). On projects where only v2 ran, v3 cleans up the remaining 7 entries.
 */
const MIGRATION_PURGE_LEGACY_KNOWLEDGE_V3: Migration<'per-project'> = {
  id: 'purge-legacy-knowledge-v3',
  description: 'Remove all pre-v2 seeded decisions entries (entries lacking self-learning: source marker)',
  scope: 'per-project',
  run: async (ctx: PerProjectMigrationContext): Promise<MigrationRunResult> => {
    const { purgeAllPreV2DecisionsEntries } = await import('./legacy-decisions-purge.js');
    const result = await purgeAllPreV2DecisionsEntries({ memoryDir: ctx.memoryDir, projectRoot: ctx.projectRoot });
    const infos = result.removed > 0
      ? [`Purged ${result.removed} pre-v2 decisions entry(ies) in ${result.files.length} file(s)`]
      : [];
    return { infos, warnings: [] };
  },
};

const MIGRATION_RENAME_KB_TO_KNOWLEDGE: Migration<'per-project'> = {
  id: 'rename-kb-to-knowledge',
  description: 'Rename .features/.kb.lock, .kb-last-refresh, .kb-refresh.lock to knowledge equivalents; update .gitignore entries',
  scope: 'per-project',
  run: async (ctx: PerProjectMigrationContext): Promise<MigrationRunResult> => {
    const infos: string[] = [];
    const warnings: string[] = [];

    const featuresDir = getFeaturesDir(ctx.projectRoot);
    const renames: Array<[string, string]> = [
      ['.kb.lock', '.knowledge.lock'],
      ['.kb-last-refresh', '.knowledge-last-refresh'],
      ['.kb-refresh.lock', '.knowledge-refresh.lock'],
    ];

    for (const [oldName, newName] of renames) {
      const oldPath = path.join(featuresDir, oldName);
      const newPath = path.join(featuresDir, newName);
      try {
        await fs.access(oldPath);
        await fs.rename(oldPath, newPath);
        infos.push(`Renamed .features/${oldName} → .features/${newName}`);
      } catch {
        // File doesn't exist — nothing to do
      }
    }

    // Update .gitignore entries
    const gitignorePath = path.join(ctx.projectRoot, '.gitignore');
    try {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      const updated = content
        .replace(/\.features\/\.kb\.lock/g, '.features/.knowledge.lock')
        .replace(/\.features\/\.kb-last-refresh/g, '.features/.knowledge-last-refresh')
        .replace(/\.features\/\.kb-refresh\.lock/g, '.features/.knowledge-refresh.lock');
      if (updated !== content) {
        await fs.writeFile(gitignorePath, updated, 'utf-8');
        infos.push('Updated .gitignore: kb → knowledge entries');
      }
    } catch {
      // .gitignore may not exist — non-fatal
    }

    return { infos, warnings };
  },
};

/**
 * Moves .memory/, .features/, and .docs/ into .devflow/ subdirectories.
 * Idempotent and resumable: each file/dir move skips if destination exists.
 *
 * Layout after migration:
 *   .devflow/memory/    — working memory files
 *   .devflow/sidecar/   — promoted from .memory/.sidecar/
 *   .devflow/decisions/ — promoted from .memory/decisions/
 *   .devflow/learning/  — promoted from .memory/ learning-* files
 *   .devflow/features/  — promoted from .features/
 *   .devflow/docs/      — promoted from .docs/
 */
const MIGRATION_CONSOLIDATE_TO_DEVFLOW: Migration<'per-project'> = {
  id: 'consolidate-to-devflow-dir',
  description: 'Move .memory/, .features/, .docs/ under .devflow/',
  scope: 'per-project',
  run: async (ctx: PerProjectMigrationContext): Promise<MigrationRunResult> => {
    const infos: string[] = [];
    const { projectRoot } = ctx;

    const devflowDir = path.join(projectRoot, '.devflow');
    const memSrc     = path.join(projectRoot, '.memory');
    const featSrc    = path.join(projectRoot, '.features');
    const docsSrc    = path.join(projectRoot, '.docs');

    // 1. Create target subdirectories
    await fs.mkdir(path.join(devflowDir, 'memory'),    { recursive: true });
    await fs.mkdir(path.join(devflowDir, 'sidecar'),   { recursive: true });
    await fs.mkdir(path.join(devflowDir, 'decisions'), { recursive: true });
    await fs.mkdir(path.join(devflowDir, 'learning'),  { recursive: true });
    await fs.mkdir(path.join(devflowDir, 'features'),  { recursive: true });
    await fs.mkdir(path.join(devflowDir, 'docs'),      { recursive: true });

    // 2. Explicit mapped moves from .memory/
    const memMap: Array<[string, string]> = [
      ['WORKING-MEMORY.md',             path.join(devflowDir, 'memory',    'WORKING-MEMORY.md')],
      ['backup.json',                   path.join(devflowDir, 'memory',    'backup.json')],
      ['.pending-turns.jsonl',          path.join(devflowDir, 'memory',    '.pending-turns.jsonl')],
      ['.pending-turns.processing',     path.join(devflowDir, 'memory',    '.pending-turns.processing')],
      ['.pending-turns.lock',           path.join(devflowDir, 'memory',    '.pending-turns.lock')],
      ['.learning-disabled',            path.join(devflowDir, 'memory',    '.learning-disabled')],
      ['.working-memory-disabled',      path.join(devflowDir, 'memory',    '.working-memory-disabled')],
      // decisions files
      ['decisions-log.jsonl',           path.join(devflowDir, 'decisions', 'decisions-log.jsonl')],
      ['decisions.json',                path.join(devflowDir, 'decisions', 'decisions.json')],
      ['.decisions-manifest.json',      path.join(devflowDir, 'decisions', '.decisions-manifest.json')],
      ['.decisions.lock',               path.join(devflowDir, 'decisions', '.decisions.lock')],
      ['.decisions-usage.json',         path.join(devflowDir, 'decisions', '.decisions-usage.json')],
      ['.decisions-usage.lock',         path.join(devflowDir, 'decisions', '.decisions-usage.lock')],
      ['.decisions-notifications.json', path.join(devflowDir, 'decisions', '.decisions-notifications.json')],
      ['.decisions-runs-today',         path.join(devflowDir, 'decisions', '.decisions-runs-today')],
      ['.decisions-batch-ids',          path.join(devflowDir, 'decisions', '.decisions-batch-ids')],
      // learning files
      ['learning-log.jsonl',            path.join(devflowDir, 'learning',  'learning-log.jsonl')],
      ['learning.json',                 path.join(devflowDir, 'learning',  'learning.json')],
      ['.learning-manifest.json',       path.join(devflowDir, 'learning',  '.learning-manifest.json')],
      ['.learning-notified-at',         path.join(devflowDir, 'learning',  '.learning-notified-at')],
      ['.learning-notifications.json',  path.join(devflowDir, 'learning',  '.learning-notifications.json')],
      ['.learning-runs-today',          path.join(devflowDir, 'learning',  '.learning-runs-today')],
      ['.learning-session-count',       path.join(devflowDir, 'learning',  '.learning-session-count')],
      ['.learning-batch-ids',           path.join(devflowDir, 'learning',  '.learning-batch-ids')],
      ['debug',                         path.join(devflowDir, 'learning',  'debug')],
      ['working',                       path.join(devflowDir, 'memory',    'working')],
    ];

    for (const [name, dest] of memMap) {
      await moveFile(path.join(memSrc, name), dest);
    }

    // 2b. Move .memory/.sidecar/ → .devflow/sidecar/ (directory contents)
    await moveDirContents(
      path.join(memSrc, '.sidecar'),
      path.join(devflowDir, 'sidecar'),
      new Set(),
    );

    // 2c. Move .memory/decisions/ contents → .devflow/decisions/
    await moveDirContents(
      path.join(memSrc, 'decisions'),
      path.join(devflowDir, 'decisions'),
      new Set(),
    );

    // 2d. Catch-all: move any remaining .memory/ files not already handled
    await moveDirContents(memSrc, path.join(devflowDir, 'memory'), MEMORY_SKIP_FILES);

    // 3. Move .features/ contents → .devflow/features/
    await moveDirContents(featSrc, path.join(devflowDir, 'features'), new Set());

    // 4. Move .docs/ contents → .devflow/docs/
    await moveDirContents(docsSrc, path.join(devflowDir, 'docs'), new Set());

    // 5. Create .devflow/.gitignore if not present
    const devflowGitignore = path.join(devflowDir, '.gitignore');
    try { await fs.access(devflowGitignore); } catch {
      await fs.writeFile(devflowGitignore, DEVFLOW_GITIGNORE_CONTENT, 'utf-8');
    }

    // 6. Clean up project .gitignore — remove stale entries
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const staleEntries = [
      '.memory/',
      '.docs/',
      '.features/.knowledge.lock',
      '.features/.disabled',
      '.features/.knowledge-last-refresh',
      '.features/.knowledge-refresh.lock',
      '.devflow/',
    ];
    try {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      const lines = content.split('\n');
      const cleaned = lines.filter(line => !staleEntries.includes(line.trim()));
      if (cleaned.length !== lines.length) {
        await fs.writeFile(gitignorePath, cleaned.join('\n'), 'utf-8');
        infos.push('Cleaned stale entries from .gitignore');
      }
    } catch { /* .gitignore may not exist */ }

    // 7. Remove empty old directories (best-effort)
    for (const oldDir of [memSrc, featSrc, docsSrc]) {
      try {
        const remaining = await fs.readdir(oldDir);
        if (remaining.length === 0) {
          await fs.rmdir(oldDir);
        }
      } catch { /* may already be removed or non-empty — non-fatal */ }
    }

    infos.push('Consolidated .memory/, .features/, .docs/ under .devflow/');
    return { infos, warnings: [] };
  },
};

/**
 * Migration ID suffix conventions:
 *
 * - `-vN`        A revision of a migration. `-v2`, `-v3`, etc. indicate
 *                successive sweeps targeting the same data set (e.g. widening
 *                the purge scope). Each revision runs independently so partially-
 *                migrated machines get the incremental cleanup on next init.
 *
 * - `-vN-{tag}`  A named variant within a revision. The tag distinguishes
 *                migrations that operate on the same version epoch but target
 *                different data (e.g. `shadow-overrides-v2-names` vs a
 *                hypothetical `shadow-overrides-v2-config`).
 *
 * All IDs are append-only — never rename an existing ID or already-applied
 * machines will re-run the migration.
 */
export const MIGRATIONS: readonly Migration[] = [
  MIGRATION_SHADOW_OVERRIDES,
  MIGRATION_PURGE_LEGACY_KNOWLEDGE,
  MIGRATION_PURGE_LEGACY_KNOWLEDGE_V3,
  MIGRATION_RENAME_KB_TO_KNOWLEDGE,
  MIGRATION_CONSOLIDATE_TO_DEVFLOW,
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
 * init.ts:962-974 — each project has its own `.memory/.decisions.lock` so
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
 * Fresh installs with no decisions files are effectively no-ops — each migration
 * helper short-circuits when the data it targets doesn't exist (e.g.,
 * purgeLegacyDecisionsEntries returns immediately when `.memory/decisions/` is
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

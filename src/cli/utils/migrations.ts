import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import { getMemoryDir, getFeaturesDir, getDevflowGitignoreContent } from './project-paths.js';

// ---------------------------------------------------------------------------
// consolidate-to-devflow-dir helpers
// ---------------------------------------------------------------------------

/**
 * Move src to dest, skipping when src doesn't exist or dest already exists
 * (idempotent). Falls back to copy+delete on EXDEV (cross-device rename).
 *
 * POSIX rename(2) atomically replaces files and does not return EEXIST, so
 * we check dest existence with lstat before rename to preserve idempotency.
 * For directory renames, POSIX returns ENOTEMPTY when dest is a non-empty
 * directory — treated the same as EEXIST (idempotent skip).
 *
 * @param overwrite - when true, proceed even if dest already exists (old-wins
 *   semantics). Used for config.json in rename-sidecar-to-dream-v1.
 */
async function moveFile(src: string, dest: string, opts?: { overwrite?: boolean }): Promise<void> {
  const overwrite = opts?.overwrite ?? false;
  // Ensure parent directory exists before attempting rename
  await fs.mkdir(path.dirname(dest), { recursive: true });
  // Check dest existence first: POSIX rename(2) silently overwrites files
  // and returns ENOTEMPTY (not EEXIST) for non-empty directory destinations.
  // An explicit lstat guard restores idempotency for both cases.
  if (!overwrite) {
    try {
      await fs.lstat(dest);
      return; // dest already present — idempotent skip
    } catch { /* dest absent — proceed with rename */ }
  }
  // Security: guard against symlinks at the source before any copy operation.
  // fs.rename(2) does not follow symlinks; the EXDEV copy path must match that
  // behaviour. Refuse to copy if src is a symlink — avoids arbitrary-file-read
  // via a crafted symlink at the migration source path.
  try {
    const srcStat = await fs.lstat(src);
    if (srcStat.isSymbolicLink()) return; // symlink at source — skip silently (avoids PF-004-style no-op-is-safe)
  } catch {
    return; // src absent — already moved or never existed
  }
  try {
    await fs.rename(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;               // src gone — already moved or never existed
    if (code === 'EEXIST' || code === 'ENOTEMPTY') return; // dest appeared concurrently — idempotent skip
    // Cross-device: fall back to copy+delete.
    // The symlink guard above ensures src is not a symlink before we reach here,
    // so copyFile cannot be redirected to an arbitrary path via symlink.
    if (code === 'EXDEV') {
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
 *
 * Uses Promise.allSettled so a failure on one entry does not mask sibling
 * errors — all partial failures are surfaced as warning strings in the
 * return value. Callers append these to their MigrationRunResult.warnings.
 *
 * Per PF-004: correctness on first run is critical; partial failures must be
 * visible so the manual sweep runbook can identify exactly which entries need
 * attention on re-run.
 */
async function moveDirContents(
  srcDir: string,
  destDir: string,
  skipNames: Set<string>,
): Promise<string[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch { return []; }

  const filtered = entries.filter(entry => !skipNames.has(entry.name));
  const settled = await Promise.allSettled(
    filtered.map(entry =>
      moveFile(path.join(srcDir, entry.name), path.join(destDir, entry.name)),
    ),
  );

  const warnings: string[] = [];
  for (const [i, result] of settled.entries()) {
    if (result.status === 'rejected') {
      const name = filtered[i]?.name ?? '(unknown)';
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`moveDirContents: failed to move ${path.join(srcDir, name)}: ${msg}`);
    }
  }
  return warnings;
}

/**
 * Legacy / V1 files in .memory/ that no longer exist in any meaningful sense
 * and must NOT be migrated to .devflow/. These are entries NOT present in the
 * memMap below — derived programmatically from the mapping.
 *
 * The full catch-all skip set is computed inside the migration run function as:
 *   new Set([...MEMORY_LEGACY_SKIP_FILES, ...memMap.map(([name]) => name)])
 * This ensures that adding a new entry to memMap automatically excludes it
 * from the catch-all moveDirContents pass without a manual update here.
 */
const MEMORY_LEGACY_SKIP_FILES = [
  'knowledge',                        // pre-rename V1 decisions dir
  'short',                            // V1 format
  'index.md',                         // V1 format
  'candidates.json',                  // V1 format
  '.knowledge-usage.json',            // pre-rename
  '.working-memory-last-trigger',     // obsolete
  '.working-memory-update.log',       // old log
  '.gitignore-configured',            // replaced
  // Directories handled by moveDirContents — exclude from catch-all
  '.sidecar',
  'decisions',
] as const;

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
        await fs.rename(oldPath, newPath);
        infos.push(`Renamed .devflow/features/${oldName} → .devflow/features/${newName}`);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') continue; // src absent — nothing to rename
        throw err;                        // unexpected error — surface to caller
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
 * Stale .gitignore entries removed by the consolidate-to-devflow-dir migration.
 * Extracted as a module-level constant so tests can assert against it.
 */
const CONSOLIDATE_STALE_GITIGNORE_ENTRIES = [
  '.memory/',
  '.docs/',
  '.features/.knowledge.lock',
  '.features/.disabled',
  '.features/.knowledge-last-refresh',
  '.features/.knowledge-refresh.lock',
  '.devflow/',
] as const;

/**
 * Step 5 helper: create .devflow/.gitignore only when absent.
 *
 * Uses O_EXCL (flag: 'wx') so the kernel rejects the open atomically if the
 * file already exists — no TOCTOU window between the existence check and the
 * write. EEXIST is silently ignored (idempotent).
 */
async function createDevflowGitignoreIfAbsent(devflowDir: string): Promise<void> {
  const gitignore = path.join(devflowDir, '.gitignore');
  try {
    await fs.writeFile(gitignore, getDevflowGitignoreContent(), { encoding: 'utf-8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    // File already present — idempotent skip
  }
}

/**
 * Step 6 helper: remove stale old-layout entries from the project .gitignore.
 *
 * Uses writeFileAtomicExclusive (temp+rename) so a crash between read and
 * write never leaves the .gitignore truncated.
 *
 * @returns Info messages suitable for appending to MigrationRunResult.infos.
 */
async function cleanStaleGitignoreEntries(projectRoot: string): Promise<string[]> {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  try {
    const content = await fs.readFile(gitignorePath, 'utf-8');
    const lines = content.split('\n');
    const cleaned = lines.filter(
      line => !CONSOLIDATE_STALE_GITIGNORE_ENTRIES.includes(
        line.trim() as typeof CONSOLIDATE_STALE_GITIGNORE_ENTRIES[number],
      ),
    );
    if (cleaned.length !== lines.length) {
      await writeFileAtomicExclusive(gitignorePath, cleaned.join('\n'));
      return ['Cleaned stale entries from .gitignore'];
    }
  } catch { /* .gitignore may not exist — non-fatal */ }
  return [];
}

/**
 * Step 2 helper: move all .memory/ content into the appropriate .devflow/
 * subdirectories using the explicit memMap plus catch-all subdirectory sweeps.
 *
 * Returns accumulated warnings from moveDirContents so callers can surface
 * partial failures in their MigrationRunResult.warnings.
 */
async function migrateMemoryDir(
  memSrc: string,
  devflowDir: string,
  memMap: Array<[string, string]>,
): Promise<string[]> {
  // Explicit mapped moves (all independent — run in parallel)
  await Promise.all(memMap.map(([name, dest]) => moveFile(path.join(memSrc, name), dest)));

  // Move .memory/.sidecar/ → .devflow/sidecar/ (directory contents)
  const w1 = await moveDirContents(path.join(memSrc, '.sidecar'), path.join(devflowDir, 'sidecar'), new Set());

  // Move .memory/decisions/ contents → .devflow/decisions/
  const w2 = await moveDirContents(path.join(memSrc, 'decisions'), path.join(devflowDir, 'decisions'), new Set());

  // Catch-all: move any remaining .memory/ files not already handled.
  // Skip set is derived from memMap keys (already moved above) plus legacy-only
  // entries, so adding a new memMap entry never needs a manual skip-set update.
  const memSkipFiles = new Set([
    ...MEMORY_LEGACY_SKIP_FILES,
    ...memMap.map(([name]) => name),
  ]);
  const w3 = await moveDirContents(memSrc, path.join(devflowDir, 'memory'), memSkipFiles);

  return [...w1, ...w2, ...w3];
}

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
    const { projectRoot } = ctx;

    const devflowDir = path.join(projectRoot, '.devflow');
    const memSrc     = path.join(projectRoot, '.memory');
    const featSrc    = path.join(projectRoot, '.features');
    const docsSrc    = path.join(projectRoot, '.docs');

    // 1. Create target subdirectories (independent — run in parallel)
    await Promise.all([
      fs.mkdir(path.join(devflowDir, 'memory'),    { recursive: true }),
      fs.mkdir(path.join(devflowDir, 'sidecar'),   { recursive: true }),
      fs.mkdir(path.join(devflowDir, 'decisions'), { recursive: true }),
      fs.mkdir(path.join(devflowDir, 'learning'),  { recursive: true }),
      fs.mkdir(path.join(devflowDir, 'features'),  { recursive: true }),
      fs.mkdir(path.join(devflowDir, 'docs'),      { recursive: true }),
    ]);

    // 2. Move all .memory/ content into .devflow/ subdirectories
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
    const memWarnings = await migrateMemoryDir(memSrc, devflowDir, memMap);

    // 3. Move .features/ contents → .devflow/features/
    const featWarnings = await moveDirContents(featSrc, path.join(devflowDir, 'features'), new Set());

    // 4. Move .docs/ contents → .devflow/docs/ (skip WORKING-MEMORY.md — belongs in memory/)
    const docsWarnings = await moveDirContents(docsSrc, path.join(devflowDir, 'docs'), new Set(['WORKING-MEMORY.md']));

    // 5. Create .devflow/.gitignore if not present (atomic exclusive create — no TOCTOU)
    await createDevflowGitignoreIfAbsent(devflowDir);

    // 6. Clean up project .gitignore — remove stale entries (atomic temp+rename write)
    const gitignoreInfos = await cleanStaleGitignoreEntries(projectRoot);

    // 7. Clean up legacy/leftover files and remove old directories (best-effort)

    // 7a. Delete legacy skip files from old .memory/ — these were intentionally
    // not migrated (obsolete V1 artifacts)
    await Promise.all(
      MEMORY_LEGACY_SKIP_FILES.map(name =>
        fs.rm(path.join(memSrc, name), { recursive: true, force: true }).catch(() => {}),
      ),
    );

    // 7b. Delete leftover entries in .features/ and .docs/ — after moveDirContents,
    // any remaining entries are duplicates whose dest already existed
    for (const oldDir of [featSrc, docsSrc]) {
      try {
        const remaining = await fs.readdir(oldDir);
        await Promise.all(
          remaining.map(name =>
            fs.rm(path.join(oldDir, name), { recursive: true, force: true }).catch(() => {}),
          ),
        );
      } catch { /* dir may not exist */ }
    }

    // 7c. Attempt rmdir on all three old directories — if .memory/ has user files
    // not in the legacy skip list, the dir survives
    for (const oldDir of [memSrc, featSrc, docsSrc]) {
      try { await fs.rmdir(oldDir); } catch { /* non-empty or already removed */ }
    }

    return {
      infos: [...gitignoreInfos, 'Consolidated .memory/, .features/, .docs/ under .devflow/'],
      warnings: [...memWarnings, ...featWarnings, ...docsWarnings],
    };
  },
};

/** D38: The consolidation migration moved .docs/ → .devflow/docs/ without excluding
 * WORKING-MEMORY.md, which belongs in .devflow/memory/. Projects that already ran
 * the consolidation have a stale copy at .devflow/docs/WORKING-MEMORY.md.
 */
const MIGRATION_CLEANUP_STALE_WORKING_MEMORY: Migration<'per-project'> = {
  id: 'cleanup-stale-working-memory',
  description: 'Remove WORKING-MEMORY.md from .devflow/docs/ (belongs in memory/)',
  scope: 'per-project',
  async run(ctx) {
    const stale = path.join(ctx.projectRoot, '.devflow', 'docs', 'WORKING-MEMORY.md');
    try {
      await fs.rm(stale, { force: true });
    } catch { /* already removed or doesn't exist */ }
    return { infos: [], warnings: [] };
  },
};

const MIGRATION_SYNC_DEVFLOW_GITIGNORE: Migration<'per-project'> = {
  id: 'sync-devflow-gitignore-v1',
  description: 'Sync .devflow/.gitignore to latest canonical template',
  scope: 'per-project',
  async run(ctx) {
    const devflowDir = path.join(ctx.projectRoot, '.devflow');
    try { await fs.access(devflowDir); } catch { return { infos: [], warnings: [] }; }

    const canonical = getDevflowGitignoreContent();
    const gitignorePath = path.join(devflowDir, '.gitignore');

    try {
      const existing = await fs.readFile(gitignorePath, 'utf-8');
      if (existing === canonical) return { infos: [], warnings: [] };
    } catch { /* file missing — will be created below */ }

    await writeFileAtomicExclusive(gitignorePath, canonical);
    return { infos: ['Synced .devflow/.gitignore to latest template'], warnings: [] };
  },
};

/**
 * Re-sync .devflow/.gitignore to the new ignore-by-default allowlist policy.
 *
 * v1 already executed on existing machines (writing the old per-entry blocklist).
 * v2 is required to overwrite those with the new template — a new ID forces
 * machines that already ran v1 to re-fire.
 *
 * Applies PF-004 / PF-001: idempotent — no-op if content already matches
 * (covers this very repo which was manually updated to the new policy). Also
 * no-ops cleanly when .devflow/ does not exist.
 */
const MIGRATION_SYNC_DEVFLOW_GITIGNORE_V2: Migration<'per-project'> = {
  id: 'sync-devflow-gitignore-v2',
  description: 'Re-sync .devflow/.gitignore to new ignore-by-default allowlist policy',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const devflowDir = path.join(ctx.projectRoot, '.devflow');
    try { await fs.access(devflowDir); } catch { return { infos: [], warnings: [] }; }

    const canonical = getDevflowGitignoreContent();
    const gitignorePath = path.join(devflowDir, '.gitignore');

    try {
      const existing = await fs.readFile(gitignorePath, 'utf-8');
      if (existing === canonical) return { infos: [], warnings: [] };
    } catch { /* file missing — will be created below */ }

    await writeFileAtomicExclusive(gitignorePath, canonical);
    return { infos: ['Synced .devflow/.gitignore to ignore-by-default allowlist policy'], warnings: [] };
  },
};

/**
 * Phase 3 (reliable LLM sidecar consumption): remove orphaned state files
 * left by the removed deterministic capacity/manifest/reconcile features.
 *
 * Files removed (applies ADR-002: clean house, no skip-list stranding):
 *   - .devflow/learning/.learning-manifest.json  — no longer written
 *   - .devflow/decisions/.decisions-manifest.json — no longer written
 *   - .devflow/decisions/.decisions-notifications.json — no longer written
 *
 * Non-fatal, idempotent (applies PF-004: buggy first run never re-sweeps,
 * but these are simple unlinks so a non-existent file is a no-op).
 */
const MIGRATION_PURGE_ORPHANED_SIDECAR_JUDGMENT_STATE: Migration<'per-project'> = {
  id: 'purge-orphaned-sidecar-judgment-state',
  description: 'Remove manifest and capacity notification files orphaned by Phase 3 removal of deterministic judgment layer',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const toRemove = [
      path.join(ctx.projectRoot, '.devflow', 'learning', '.learning-manifest.json'),
      path.join(ctx.projectRoot, '.devflow', 'decisions', '.decisions-manifest.json'),
      path.join(ctx.projectRoot, '.devflow', 'decisions', '.decisions-notifications.json'),
    ];

    let removed = 0;
    for (const filePath of toRemove) {
      try {
        await fs.unlink(filePath);
        removed++;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw err; // unexpected error — surface to runner
        // ENOENT = already absent — idempotent skip
      }
    }

    const infos = removed > 0
      ? [`Removed ${removed} orphaned judgment-state file(s)`]
      : [];
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
/**
 * Per PF-002: config.json FIRST (rename out), then merge remaining entries so the
 * skip-list never leaves config.json behind to block the final rmdir.
 *
 * Per PF-003: Migration runs before hook reinstall and before the config write in
 * init.ts — the ordering is already correct; keep migration-first.
 *
 * Per ADR-001 EXCEPTION: A migration IS required here because .devflow/sidecar/config.json
 * holds the primary feature-toggle source of truth, and a silent toggle-reset on the
 * D37 edge case (project cloned after the global migration marker is set) would lose
 * user config. Do NOT skip this migration.
 */
const MIGRATION_RENAME_SIDECAR_TO_DREAM: Migration<'per-project'> = {
  id: 'rename-sidecar-to-dream-v1',
  description: 'Rename .devflow/sidecar/ to .devflow/dream/ — v3 internal name change',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const sidecarDir = path.join(ctx.projectRoot, '.devflow', 'sidecar');
    const dreamDir = path.join(ctx.projectRoot, '.devflow', 'dream');

    // Idempotent skip — nothing to migrate
    try {
      await fs.access(sidecarDir);
    } catch {
      return { infos: [], warnings: [] };
    }

    // Ensure destination exists
    await fs.mkdir(dreamDir, { recursive: true });

    // 1. config.json FIRST (old wins — overwrite fresh default) per PF-002.
    // Uses moveFile with overwrite:true so the shared EXDEV-safe, symlink-
    // guarded helper handles rename + cross-device fallback in one place
    // (avoids PF-003-style code drift between the two EXDEV implementations).
    await moveFile(
      path.join(sidecarDir, 'config.json'),
      path.join(dreamDir, 'config.json'),
      { overwrite: true },
    );

    // 2. Move remaining contents (no-overwrite) — markers, .processing, lock dirs, etc.
    const moveWarnings = await moveDirContents(sidecarDir, dreamDir, new Set(['config.json']));

    // 3. Best-effort rmdir (sidecar dir may still contain a live .reinforce.lock/ —
    //    NEVER lock the whole dir to avoid deadlocking a live Dream agent per migration note)
    try { await fs.rmdir(sidecarDir); } catch { /* non-empty or already removed */ }

    return { infos: ['Renamed .devflow/sidecar/ → .devflow/dream/'], warnings: moveWarnings };
  },
};

/**
 * Per-project: remove learning pipeline runtime artifacts.
 *
 * Removes:
 *   - .devflow/learning/ directory (all contents)
 *   - .devflow/dream/learning.*.json markers
 *   - .devflow/dream/learning.*.processing markers
 *   - drops `learning` key from .devflow/dream/config.json (if present)
 *   - drops `learning` key from .devflow/sidecar/config.json (legacy fallback — R8)
 *   - .claude/commands/self-learning/ directory (auto-generated artifacts)
 *   - auto-generated skills (detected via AUTO_GENERATED_MARKER)
 *
 * Applies ADR-002 (clean house), PF-004 (idempotent — ENOENT is a no-op).
 * CRITICAL: Do NOT import anything from learn.ts (being deleted this phase).
 */
const MIGRATION_PURGE_LEARNING_PIPELINE: Migration<'per-project'> = {
  id: 'purge-learning-pipeline-v1',
  description: 'Remove learning pipeline runtime artifacts (learning dir, dream markers, config key, auto-generated artifacts)',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const infos: string[] = [];
    const devflowDir = path.join(ctx.projectRoot, '.devflow');

    // 1. Remove .devflow/learning/ directory
    const learningDir = path.join(devflowDir, 'learning');
    try {
      await fs.rm(learningDir, { recursive: true, force: true });
      infos.push('Removed .devflow/learning/');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }

    // 2. Remove .devflow/dream/learning.*.json and *.processing markers
    const dreamDir = path.join(devflowDir, 'dream');
    try {
      const dreamEntries = await fs.readdir(dreamDir);
      for (const entry of dreamEntries) {
        if (entry.startsWith('learning.') && (entry.endsWith('.json') || entry.endsWith('.processing'))) {
          try {
            await fs.unlink(path.join(dreamDir, entry));
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT') throw err;
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }

    // 3. Drop `learning` key from dream/config.json (non-destructive read-modify-write)
    const dreamConfigPath = path.join(dreamDir, 'config.json');
    await _dropLearningKeyFromConfig(dreamConfigPath);

    // 4. Drop `learning` key from legacy sidecar/config.json (R8 — do NOT delete the file)
    const sidecarConfigPath = path.join(devflowDir, 'sidecar', 'config.json');
    await _dropLearningKeyFromConfig(sidecarConfigPath);

    // 5. Remove .claude/commands/self-learning/ directory
    // Inline cleanSelfLearningArtifacts logic — cannot import learn.ts (being deleted)
    const claudeDir = path.join(ctx.projectRoot, '.claude');
    const selfLearningCommandsDir = path.join(claudeDir, 'commands', 'self-learning');
    try {
      await fs.rm(selfLearningCommandsDir, { recursive: true, force: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }

    // 6. Remove auto-generated skills (detected via AUTO_GENERATED_MARKER from learning-cleanup.ts)
    const { cleanSelfLearningArtifacts } = await import('./learning-cleanup.js');
    await cleanSelfLearningArtifacts(claudeDir);

    return { infos, warnings: [] };
  },
};

/**
 * Helper: read config.json, drop the `learning` key if present, write back atomically.
 * Tolerates missing file (ENOENT = no-op). Never deletes the file.
 */
async function _dropLearningKeyFromConfig(configPath: string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return; // file absent — no-op
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // malformed JSON — leave untouched
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
  const config = parsed as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(config, 'learning')) return; // key absent — no-op

  delete config['learning'];

  const tmp = configPath + '.tmp.' + process.pid;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  try {
    await fs.rename(tmp, configPath);
  } catch (renameErr) {
    try { await fs.unlink(tmp); } catch { /* best-effort cleanup */ }
    throw renameErr;
  }
}

/**
 * Global: remove ~/.devflow/learning.json (global learning config).
 *
 * Applies PF-004 (idempotent — ENOENT is a no-op).
 */
const MIGRATION_PURGE_LEARNING_GLOBAL: Migration<'global'> = {
  id: 'purge-learning-global-v1',
  description: 'Remove global ~/.devflow/learning.json config file',
  scope: 'global',
  async run(ctx: GlobalMigrationContext): Promise<MigrationRunResult> {
    const learningJsonPath = path.join(ctx.devflowDir, 'learning.json');
    try {
      await fs.unlink(learningJsonPath);
      return { infos: ['Removed ~/.devflow/learning.json'], warnings: [] };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { infos: [], warnings: [] }; // already absent
      throw err;
    }
  },
};

export const MIGRATIONS: readonly Migration[] = [
  MIGRATION_SHADOW_OVERRIDES,
  MIGRATION_PURGE_LEGACY_KNOWLEDGE,
  MIGRATION_PURGE_LEGACY_KNOWLEDGE_V3,
  MIGRATION_RENAME_KB_TO_KNOWLEDGE,
  MIGRATION_CONSOLIDATE_TO_DEVFLOW,
  MIGRATION_CLEANUP_STALE_WORKING_MEMORY,
  MIGRATION_SYNC_DEVFLOW_GITIGNORE,
  MIGRATION_SYNC_DEVFLOW_GITIGNORE_V2,
  MIGRATION_PURGE_ORPHANED_SIDECAR_JUDGMENT_STATE,
  MIGRATION_RENAME_SIDECAR_TO_DREAM,
  MIGRATION_PURGE_LEARNING_PIPELINE,
  MIGRATION_PURGE_LEARNING_GLOBAL,
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

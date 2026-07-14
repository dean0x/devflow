import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import { getMemoryDir, getFeaturesDir, getLearningDir } from './project-paths.js';
import { sweepLegacyDreamMarkers } from './dream-cleanup.js';
import { writeConfig } from './feature-config.js';

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
] as const;

/**
 * Step 5 helper: remove stale old-layout entries from the project .gitignore.
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
      ['working',                       path.join(devflowDir, 'memory',    'working')],
    ];
    const memWarnings = await migrateMemoryDir(memSrc, devflowDir, memMap);

    // 3. Move .features/ contents → .devflow/features/
    const featWarnings = await moveDirContents(featSrc, path.join(devflowDir, 'features'), new Set());

    // 4. Move .docs/ contents → .devflow/docs/ (skip WORKING-MEMORY.md — belongs in memory/)
    const docsWarnings = await moveDirContents(docsSrc, path.join(devflowDir, 'docs'), new Set(['WORKING-MEMORY.md']));

    // 5. Clean up project .gitignore — remove stale entries (atomic temp+rename write)
    const gitignoreInfos = await cleanStaleGitignoreEntries(projectRoot);

    // 6. Clean up legacy/leftover files and remove old directories (best-effort)

    // 6a. Delete legacy skip files from old .memory/ — these were intentionally
    // not migrated (obsolete V1 artifacts)
    await Promise.all(
      MEMORY_LEGACY_SKIP_FILES.map(name =>
        fs.rm(path.join(memSrc, name), { recursive: true, force: true }).catch(() => {}),
      ),
    );

    // 6b. Delete leftover entries in .features/ and .docs/ — after moveDirContents,
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

    // 6c. Attempt rmdir on all three old directories — if .memory/ has user files
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

/**
 * Phase 3 (reliable LLM sidecar consumption): remove orphaned state files
 * left by the removed deterministic capacity/manifest/reconcile features.
 *
 * Files removed (applies ADR-002: clean house, no skip-list stranding):
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
 *                different data (e.g. `purge-legacy-knowledge-v2` for decisions
 *                vs a hypothetical `purge-legacy-knowledge-v2-config`).
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

    // 3. Best-effort rmdir (sidecar dir may still contain a live .observations.lock/ —
    //    NEVER lock the whole dir to avoid deadlocking a live Dream agent per migration note)
    try { await fs.rmdir(sidecarDir); } catch { /* non-empty or already removed */ }

    return { infos: ['Renamed .devflow/sidecar/ → .devflow/dream/'], warnings: moveWarnings };
  },
};

/**
 * Global: remove the orphaned dream-commit hook left in prior installs.
 *
 * dream-commit auto-committed curated .devflow/ artifacts via `git add` (no -f).
 * It became a permanent no-op once .devflow/ was gitignored wholesale (ADR-021) and
 * was deleted from the repo along with its three skill call-sites. The installer
 * copies scripts/ additively (copyDirectory never deletes target files absent from
 * source), so an unreferenced ~/.devflow/scripts/hooks/dream-commit would otherwise
 * linger on every existing machine. This sweeps it once per machine. Order-independent:
 * the source no longer contains dream-commit, so the script copy can never re-create it.
 *
 * ENOENT-idempotent (fresh installs never had it); rethrows other errors.
 */
const MIGRATION_PURGE_ORPHANED_DREAM_COMMIT_HOOK: Migration<'global'> = {
  id: 'purge-orphaned-dream-commit-hook-v1',
  description: 'Remove orphaned ~/.devflow/scripts/hooks/dream-commit (dream-commit helper removed)',
  scope: 'global',
  async run(ctx: GlobalMigrationContext): Promise<MigrationRunResult> {
    const hookPath = path.join(ctx.devflowDir, 'scripts', 'hooks', 'dream-commit');
    try {
      await fs.unlink(hookPath);
      return { infos: ['Removed orphaned ~/.devflow/scripts/hooks/dream-commit'], warnings: [] };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { infos: [], warnings: [] }; // already absent / fresh install
      throw err;
    }
  },
};

/**
 * Per-project: remove stale memory dream markers left by the old Dream-subagent
 * memory pipeline. Memory refresh is now handled by background-memory-update
 * (a detached `claude -p` worker spawned from dream-capture). Dream markers for
 * memory are no longer written or processed.
 *
 * Removes (ENOENT-idempotent):
 *   - .devflow/dream/memory.json        — old marker (no session suffix)
 *   - .devflow/dream/memory.processing  — old in-flight marker
 *   - .devflow/dream/memory.*.json      — per-session variants
 *   - .devflow/dream/memory.*.processing — per-session in-flight variants
 *   - .devflow/dream/memory.*.retries   — retry counters
 *   - .devflow/dream/memory.*.failed    — permanently-failed markers
 *
 * The installed devflow:dream-memory skill dir is NOT removed here — that cleanup
 * is owned by init.ts's LEGACY_SKILL_NAMES sweep (the bare + namespaced names are
 * registered there). This migration is scoped to dream/ marker files only.
 *
 * Applies ADR-008 (LLM-vs-plumbing: artifact content authored by LLM, not Dream subagent).
 */
const MIGRATION_PURGE_STALE_MEMORY_MARKERS: Migration<'per-project'> = {
  id: 'purge-stale-memory-markers-v1',
  description: 'Remove stale dream/memory.* markers from old Dream-subagent memory pipeline',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const dreamDir = path.join(ctx.projectRoot, '.devflow', 'dream');
    const infos: string[] = [];
    let removed = 0;

    // Remove fixed-name legacy markers (no session suffix — pre-D57a format)
    const fixed = [
      path.join(dreamDir, 'memory.json'),
      path.join(dreamDir, 'memory.processing'),
    ];
    for (const filePath of fixed) {
      try {
        await fs.unlink(filePath);
        removed++;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw err; // unexpected — surface to runner
      }
    }

    // Remove per-session variants: memory.*.json, memory.*.processing, memory.*.retries, memory.*.failed
    try {
      const entries = await fs.readdir(dreamDir);
      for (const entry of entries) {
        if (entry.startsWith('memory.') &&
          (entry.endsWith('.json') || entry.endsWith('.processing') ||
           entry.endsWith('.retries') || entry.endsWith('.failed'))) {
          try {
            await fs.unlink(path.join(dreamDir, entry));
            removed++;
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT') throw err;
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err; // unexpected — surface to runner
    }

    if (removed > 0) {
      infos.push(`Removed ${removed} stale memory dream marker(s)`);
    }

    return { infos, warnings: [] };
  },
};

/**
 * Global: remove Devflow-written `teammateMode: "auto"` from ~/.claude/settings.json.
 *
 * The env var (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) self-heals via the flags
 * registry (default OFF → stripFlags removes it on every init/uninstall).
 * Only the `teammateMode` key needs explicit cleanup.
 *
 * Applies ADR-001 EXCEPTION: this is the minimum required migration — only the
 * teammateMode key needs cleanup since the env var and manifest field self-heal.
 * Idempotent: no-op if key absent, file missing, or malformed JSON (PF-004).
 */
const MIGRATION_PURGE_TEAMMATE_MODE_GLOBAL: Migration<'global'> = {
  id: 'purge-devflow-teammate-mode-global-v1',
  description: 'Remove Devflow-written teammateMode:"auto" from ~/.claude/settings.json',
  scope: 'global',
  async run(ctx: GlobalMigrationContext): Promise<MigrationRunResult> {
    const { stripDevflowTeammateMode } = await import('./teammate-mode-cleanup.js');
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    await stripDevflowTeammateMode(settingsPath);
    return { infos: [], warnings: [] };
  },
};

/**
 * Per-project: remove Devflow-written `teammateMode: "auto"` from
 * <projectRoot>/.claude/settings.json (local-scope installs).
 *
 * Idempotent: no-op if key absent, file missing, or malformed JSON (PF-004).
 */
const MIGRATION_PURGE_TEAMMATE_MODE_PER_PROJECT: Migration<'per-project'> = {
  id: 'purge-devflow-teammate-mode-v1',
  description: 'Remove Devflow-written teammateMode:"auto" from <project>/.claude/settings.json',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const { stripDevflowTeammateMode } = await import('./teammate-mode-cleanup.js');
    const settingsPath = path.join(ctx.projectRoot, '.claude', 'settings.json');
    await stripDevflowTeammateMode(settingsPath);
    return { infos: [], warnings: [] };
  },
};

/**
 * Per-project: migrate existing decisions.md + pitfalls.md + decisions-log.jsonl
 * to the two-file split layout (anchored ledger as the render source of truth +
 * raw observation log — both gitignored under .devflow/ by default per ADR-021).
 *
 * Preserve-verbatim: every existing .md entry body is captured as raw_body and
 * re-rendered byte-identically (except the TL;DR Key list which is repopulated).
 *
 * Runs AFTER the legacy purge migrations so it operates on the already-cleaned
 * corpus. Non-fatal (PF-004 pattern): failures retry on next init.
 *
 * Applies ADR-001 EXCEPTION (data-preserving migration explicitly approved).
 * Applies ADR-008 (renderer is deterministic plumbing; content was LLM-authored).
 * Applies ADR-021 (.devflow/ is gitignored by default — the ledger stays local and
 *   sharing is opt-in; this supersedes ADR-012's commit-the-ledger-by-default premise).
 * Applies ADR-017 (.decisions.lock held for the full operation).
 * Avoids PF-007 (renderer resolved from bundled package, not installed ~/.devflow).
 */
const MIGRATION_DECISIONS_LEDGER_UNIFY: Migration<'per-project'> = {
  id: 'decisions-ledger-unify-v1',
  description: 'Migrate decisions.md + pitfalls.md to two-file split: anchored ledger + raw observation log',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const { migrateDecisionsLedger } = await import('./decisions-ledger-migration.js');
    const result = await migrateDecisionsLedger(ctx.projectRoot);

    const infos: string[] = [];
    if (result.anchored > 0 || result.synthesized > 0 || result.retired > 0) {
      const parts: string[] = [];
      if (result.anchored > 0) parts.push(`${result.anchored} anchored`);
      if (result.synthesized > 0) parts.push(`${result.synthesized} synthesized`);
      if (result.retired > 0) parts.push(`${result.retired} retired`);
      infos.push(`decisions-ledger-unify-v1: ${parts.join(', ')}`);
    }

    return { infos, warnings: result.warnings };
  },
};

/**
 * Per-project: unlink the stale `.devflow/memory/.working-memory-disabled`
 * sentinel that was previously used as a defense-in-depth gate for memory
 * hooks but is now dead code (dream config is the sole source of truth,
 * per ADR-001 clean-break philosophy).
 *
 * Best-effort cleanup of a runtime-inert file — ENOENT is success (ADR-001).
 * Non-fatal on any other error (PF-004 idempotency: failed cleanup is invisible
 * at runtime because no hook reads this path anymore).
 *
 * Applies ADR-001 (clean-break; minimal migration footprint).
 * Mirrors purge-stale-memory-markers-v1 in shape.
 */
const MIGRATION_PURGE_DEAD_WORKING_MEMORY_SENTINEL: Migration<'per-project'> = {
  id: 'purge-dead-working-memory-sentinel-v1',
  description: 'Remove stale .devflow/memory/.working-memory-disabled sentinel (config-only gate now)',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const sentinelPath = path.join(ctx.projectRoot, '.devflow', 'memory', '.working-memory-disabled');
    try {
      await fs.unlink(sentinelPath);
      return { infos: ['Removed stale .working-memory-disabled sentinel'], warnings: [] };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { infos: [], warnings: [] }; // already gone — no-op
      throw err; // unexpected — surface to runner
    }
  },
};

/**
 * Per-project: remove stale marker-pipeline files (`decisions.*`/`curation.*`
 * markers and their fixed-name stamps) from `.devflow/dream/`.
 *
 * MUST NOT touch: config.json (shared multi-feature config — memory/decisions/knowledge
 * keys) or the `.pending-turns.jsonl`/`.pending-turns.processing` queue files (live
 * inputs of the Dream agent). Worker-era state files are owned by
 * purge-dream-worker-state-v1 below.
 *
 * `.decisions-runs-today` historically lived at `.devflow/dream/.decisions-runs-today`
 * (via $DREAM_DIR, NOT under `.devflow/decisions/` despite the similar name) — swept
 * from its real location here.
 *
 * Mirrors purge-stale-memory-markers-v1 in shape.
 */
const MIGRATION_PURGE_DREAM_MARKER_PIPELINE: Migration<'per-project'> = {
  id: 'purge-dream-marker-pipeline-v1',
  description: 'Remove stale decisions.*/curation.* markers and legacy stamps from the retired dream marker pipeline',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const dreamDir = path.join(ctx.projectRoot, '.devflow', 'dream');
    const removed = await sweepLegacyDreamMarkers(dreamDir);

    const infos: string[] = [];
    if (removed > 0) {
      infos.push(`Removed ${removed} stale dream marker-pipeline file(s)`);
    }

    return { infos, warnings: [] };
  },
};

/**
 * Per-project: remove inert state files left by the retired detached dream
 * worker (background-dream-update). Decisions processing now runs as the
 * directive-spawned Dream agent, whose only state is the queue itself:
 *   - .devflow/decisions/.disabled   — runtime sentinel (gate is config-only now)
 *   - .devflow/dream/.last-dream-ok  — worker success stamp
 *   - .devflow/dream/last-run-summary — inject-once summary file
 *   - .devflow/dream/.worker.lock/   — worker concurrency lock (directory)
 *
 * MUST NOT touch: config.json or the `.pending-turns.jsonl`/`.processing`
 * queue files — both are live inputs of the current architecture.
 *
 * Mirrors purge-stale-memory-markers-v1 in shape.
 */
const MIGRATION_PURGE_DREAM_WORKER_STATE: Migration<'per-project'> = {
  id: 'purge-dream-worker-state-v1',
  description: 'Remove .disabled sentinel, .last-dream-ok, last-run-summary, and .worker.lock left by the retired detached dream worker',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const devflowDir = path.join(ctx.projectRoot, '.devflow');
    let removed = 0;

    const files = [
      path.join(devflowDir, 'decisions', '.disabled'),
      path.join(devflowDir, 'dream', '.last-dream-ok'),
      path.join(devflowDir, 'dream', 'last-run-summary'),
    ];
    for (const filePath of files) {
      try {
        await fs.unlink(filePath);
        removed++;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw err; // unexpected — surface to runner
      }
    }

    // Lock is a directory (mkdir-based) — remove recursively.
    try {
      await fs.rm(path.join(devflowDir, 'dream', '.worker.lock'), { recursive: true });
      removed++;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err; // unexpected — surface to runner
    }

    const infos: string[] = [];
    if (removed > 0) {
      infos.push(`Removed ${removed} inert dream-worker state file(s)`);
    }

    return { infos, warnings: [] };
  },
};

/**
 * Per-project: write `.devflow/decisions/index.md` from the existing ledger
 * (if any). This is a write-time artifact produced by render-decisions.cjs
 * alongside decisions.md / pitfalls.md since Phase 1 of the decisions-index
 * refactor. Projects that already had a ledger need this one-time bootstrap
 * to materialise the index without rewriting the body files.
 *
 * - If no ledger exists: no-op (index will be written on the next Dream run).
 * - Writes only index.md — never rewrites decisions.md / pitfalls.md.
 * - ENOENT-safe and idempotent: a second run overwrites the same content.
 */
const MIGRATION_RENDER_DECISIONS_INDEX: Migration<'per-project'> = {
  id: 'render-decisions-index-v1',
  description: 'Bootstrap .devflow/decisions/index.md from existing decisions-ledger.jsonl',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const { renderDecisionsIndex } = await import('./decisions-ledger-migration.js');
    const result = await renderDecisionsIndex(ctx.projectRoot);
    return {
      infos: result.written ? ['render-decisions-index-v1: wrote index.md'] : [],
      warnings: [],
    };
  },
};

/**
 * Global: remove the orphaned `~/.devflow/scripts/hooks/lib/decisions-index.cjs`
 * script that was superseded by the write-time index.md artifact (Phase 1 of
 * the decisions-index refactor). The installer copies scripts additively — it
 * never deletes — so the stale file would otherwise linger.
 *
 * ENOENT-idempotent: absent on fresh installs or after a previous run.
 */
const MIGRATION_PURGE_ORPHANED_DECISIONS_INDEX: Migration<'global'> = {
  id: 'purge-orphaned-decisions-index-v1',
  description: 'Remove orphaned ~/.devflow/scripts/hooks/lib/decisions-index.cjs',
  scope: 'global',
  async run(ctx: GlobalMigrationContext): Promise<MigrationRunResult> {
    const scriptPath = path.join(
      ctx.devflowDir, 'scripts', 'hooks', 'lib', 'decisions-index.cjs',
    );
    try {
      await fs.unlink(scriptPath);
      return {
        infos: ['Removed orphaned ~/.devflow/scripts/hooks/lib/decisions-index.cjs'],
        warnings: [],
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { infos: [], warnings: [] }; // already absent
      throw err;
    }
  },
};

/**
 * Global: remove the Devflow-written `devflow` entry from `extraKnownMarketplaces`
 * in ~/.claude/settings.json.
 *
 * Applies ADR-010 (completes the native-path removal by cleaning up the marketplace
 * entry that was written alongside it) and ADR-003 (clean end-state: remove only the
 * devflow key; preserve other marketplaces; remove the parent key if it becomes empty).
 *
 * ENOENT-idempotent (avoids PF-004): missing file, missing key, and malformed JSON
 * are all silent no-ops that never crash init.
 */
const MIGRATION_PURGE_STALE_EXTRA_KNOWN_MARKETPLACES: Migration<'global'> = {
  id: 'purge-stale-extra-known-marketplaces-v1',
  description: 'Remove Devflow-written devflow entry from extraKnownMarketplaces in ~/.claude/settings.json',
  scope: 'global',
  async run(_ctx: GlobalMigrationContext): Promise<MigrationRunResult> {
    const { stripDevflowMarketplace } = await import('./marketplace-cleanup.js');
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    await stripDevflowMarketplace(settingsPath);
    return { infos: [], warnings: [] };
  },
};

/**
 * Per-project: consolidate .devflow/dream/ and .devflow/decisions/ into the new
 * flat .devflow/learning/ directory and write .devflow/config.json.
 *
 * Order of operations follows the sidecar-to-dream template (migrations.ts:541-578):
 * (1) Config FIRST — read dream/config.json, coerce to FeatureConfig (ignore stale
 *     `learning` key from old self-learning pipeline; map `decisions`→`learning`),
 *     atomic-write to .devflow/config.json ONLY when absent (idempotent: forced re-run
 *     must not clobber user-edited toggles), then unlink source (ENOENT-tolerant —
 *     lets the final rmdir dream/ succeed).
 * (2) Dream queue files (.pending-turns.jsonl, .pending-turns.processing) → learning/.
 * (3) Explicit move: decisions/decisions.json → learning/learning.json.
 * (4) Remaining decisions/ contents → learning/ via moveDirContents; skip-set drops
 *     transient lock dirs and orphaned telemetry files (see inline comment).
 * (5) Best-effort rmdir both sources (non-empty if live lock dirs remain — acceptable).
 * (6) Re-render index.md: footer paths still reference decisions/ until next Dream run;
 *     renderDecisionsIndex() updates them immediately (no-op when ledger absent).
 *
 * Applies ADR-001 (config-only gate), PF-002 (config first), PF-004 (ENOENT-tolerant).
 */
const MIGRATION_CONSOLIDATE_DREAM_DECISIONS_TO_LEARNING: Migration<'per-project'> = {
  id: 'consolidate-dream-decisions-to-learning-v1',
  description: 'Consolidate .devflow/dream/ + .devflow/decisions/ into .devflow/learning/ and write .devflow/config.json',
  scope: 'per-project',
  async run(ctx: PerProjectMigrationContext): Promise<MigrationRunResult> {
    const devflowDir = path.join(ctx.projectRoot, '.devflow');
    const dreamDir = path.join(devflowDir, 'dream');
    const decisionsDir = path.join(devflowDir, 'decisions');
    const learningDir = getLearningDir(ctx.projectRoot);

    const warnings: string[] = [];

    // Fast-path: nothing to migrate on fresh projects
    let hasDream = false;
    let hasDecisions = false;
    try { await fs.access(dreamDir); hasDream = true; } catch { /* absent */ }
    try { await fs.access(decisionsDir); hasDecisions = true; } catch { /* absent */ }
    if (!hasDream && !hasDecisions) return { infos: [], warnings: [] };

    // Ensure destination exists
    await fs.mkdir(learningDir, { recursive: true });

    // 1. Config FIRST — per PF-002 and sidecar-to-dream template ordering.
    //    Read dream/config.json; ignore stale `learning` key (old self-learning pipeline),
    //    map `decisions` → `learning`. Write .devflow/config.json only when absent.
    const oldConfigPath = path.join(dreamDir, 'config.json');
    const featureConfigPath = path.join(devflowDir, 'config.json');
    let configWritten = false;

    const newConfig = { memory: true, learning: true, knowledge: true };
    try {
      const raw = await fs.readFile(oldConfigPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const p = parsed as Record<string, unknown>;
        if (typeof p.memory === 'boolean') newConfig.memory = p.memory;
        if (typeof p.decisions === 'boolean') newConfig.learning = p.decisions;
        if (typeof p.knowledge === 'boolean') newConfig.knowledge = p.knowledge;
        // p.learning intentionally ignored: old self-learning pipeline key (ADR-001 clean break)
      }
    } catch { /* ENOENT or malformed — keep DEFAULT_CONFIG */ }

    try {
      await fs.access(featureConfigPath);
      // Already present — skip write (idempotent: don't clobber user-edited toggles)
    } catch {
      await writeConfig(ctx.projectRoot, newConfig);
      configWritten = true;
    }

    // Unlink source regardless (ENOENT-tolerant — lets final rmdir dream/ succeed)
    try { await fs.unlink(oldConfigPath); } catch { /* ENOENT is success */ }

    // 2. Move dream queue files to learning/
    await moveFile(
      path.join(dreamDir, '.pending-turns.jsonl'),
      path.join(learningDir, '.pending-turns.jsonl'),
    );
    await moveFile(
      path.join(dreamDir, '.pending-turns.processing'),
      path.join(learningDir, '.pending-turns.processing'),
    );

    // 3. Tuning config: decisions/decisions.json → learning/learning.json (explicit,
    //    so moveDirContents can skip it cleanly)
    await moveFile(
      path.join(decisionsDir, 'decisions.json'),
      path.join(learningDir, 'learning.json'),
    );

    // 4. Rest of decisions/ → learning/ via moveDirContents.
    //    Skip transient lock dirs and orphaned telemetry — see spec note in design doc.
    const decisionsSkip = new Set([
      'decisions.json',                // already moved above as learning.json
      '.decisions.lock',               // transient lock dir — drop
      '.decisions-usage.lock',         // transient lock dir — drop
      '.pending-turns.jsonl.lock',     // transient queue-overflow lock dir (under dream/) — drop
      '.observations.lock',            // may be LIVE — never move (PF lock-under-parent)
      '.decisions-usage.json',         // write-only telemetry; orphaned keys — drop
      '.decisions-manifest.json',      // orphaned sidecar judgment state — drop
      '.decisions-notifications.json', // orphaned — drop
      '.decisions-batch-ids',          // orphaned — drop
    ]);
    const moveWarnings = await moveDirContents(decisionsDir, learningDir, decisionsSkip);
    warnings.push(...moveWarnings);

    // 5. Best-effort rmdir both sources (may be non-empty if live lock dirs remain —
    //    acceptable; same pattern as sidecar-to-dream migration)
    try { await fs.rmdir(dreamDir); } catch { /* non-empty or already gone */ }
    try { await fs.rmdir(decisionsDir); } catch { /* non-empty or already gone */ }

    // 6. Re-render index.md so footer paths reference learning/ not decisions/.
    //    Without this, workflow commands hand sub-agents dead paths until the next
    //    Learning-agent render. No-op when ledger is absent.
    const { renderDecisionsIndex } = await import('./decisions-ledger-migration.js');
    await renderDecisionsIndex(ctx.projectRoot);

    const infos: string[] = [];
    if (configWritten) infos.push('Wrote .devflow/config.json from dream/config.json');
    infos.push('Consolidated .devflow/dream/ + .devflow/decisions/ → .devflow/learning/');

    return { infos, warnings };
  },
};

/**
 * Global: rename ~/.devflow/decisions.json → ~/.devflow/learning.json.
 *
 * The decisions.json file holds project-level model/debug tuning for the Learning
 * (formerly Decisions) agent. After this migration, decisions-config.ts (renamed to
 * learning-tuning-config.ts in commit 6) reads ~/.devflow/learning.json.
 *
 * overwrite: true — a pre-existing target can only be a stale old-pipeline schema;
 * the source decisions.json is the truth. Idempotent: absent source is a no-op.
 */
const MIGRATION_RENAME_GLOBAL_DECISIONS_CONFIG: Migration<'global'> = {
  id: 'rename-global-decisions-config-v1',
  description: 'Rename ~/.devflow/decisions.json → ~/.devflow/learning.json (global tuning config rename)',
  scope: 'global',
  async run(ctx: GlobalMigrationContext): Promise<MigrationRunResult> {
    const src = path.join(ctx.devflowDir, 'decisions.json');
    const dest = path.join(ctx.devflowDir, 'learning.json');
    // moveFile is ENOENT-tolerant and returns void; check existence before to detect no-op
    let srcExists = false;
    try { await fs.access(src); srcExists = true; } catch { /* absent — fresh install */ }
    if (!srcExists) return { infos: [], warnings: [] };
    await moveFile(src, dest, { overwrite: true });
    return { infos: ['Renamed ~/.devflow/decisions.json → ~/.devflow/learning.json'], warnings: [] };
  },
};

export const MIGRATIONS: readonly Migration[] = [
  MIGRATION_PURGE_LEGACY_KNOWLEDGE,
  MIGRATION_PURGE_LEGACY_KNOWLEDGE_V3,
  MIGRATION_RENAME_KB_TO_KNOWLEDGE,
  MIGRATION_CONSOLIDATE_TO_DEVFLOW,
  MIGRATION_CLEANUP_STALE_WORKING_MEMORY,
  MIGRATION_PURGE_ORPHANED_SIDECAR_JUDGMENT_STATE,
  MIGRATION_RENAME_SIDECAR_TO_DREAM,
  MIGRATION_PURGE_ORPHANED_DREAM_COMMIT_HOOK,
  MIGRATION_PURGE_STALE_MEMORY_MARKERS,
  MIGRATION_PURGE_TEAMMATE_MODE_GLOBAL,
  MIGRATION_PURGE_TEAMMATE_MODE_PER_PROJECT,
  MIGRATION_DECISIONS_LEDGER_UNIFY,
  MIGRATION_PURGE_DEAD_WORKING_MEMORY_SENTINEL,
  MIGRATION_PURGE_DREAM_MARKER_PIPELINE,
  MIGRATION_PURGE_DREAM_WORKER_STATE,
  MIGRATION_RENDER_DECISIONS_INDEX,
  MIGRATION_PURGE_ORPHANED_DECISIONS_INDEX,
  MIGRATION_PURGE_STALE_EXTRA_KNOWN_MARKETPLACES,
  MIGRATION_CONSOLIDATE_DREAM_DECISIONS_TO_LEARNING,
  MIGRATION_RENAME_GLOBAL_DECISIONS_CONFIG,
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
 * absent).
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

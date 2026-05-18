import { promises as fs } from 'fs';
import * as path from 'path';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import { acquireMkdirLock } from './mkdir-lock.js';
import { getDecisionsDir, getDecisionsLockDir } from './project-paths.js';

/**
 * @file legacy-decisions-purge.ts
 *
 * D34: Pure helper extracted from the legacy-decisions-purge handler in
 * learn.ts for two reasons:
 *
 * 1. **Reusable from registry**: The migration registry (migrations.ts) needs to
 *    call this logic without pulling in the full learnCommand and its UI
 *    dependencies (p.log, p.intro, @clack/prompts). Extraction makes the logic
 *    importable with zero side-channel output.
 *
 * 2. **Testable in isolation**: With no UI or process.cwd() calls, the function
 *    accepts its own memoryDir, enabling straightforward filesystem-level unit
 *    tests with temp directories and no environment coupling.
 *
 * The function acquires `.decisions.lock` (same mkdir-based lock used by
 * json-helper.cjs render-ready and updateDecisionsStatus in learn.ts) to
 * serialize against concurrent writers.
 *
 * D39: Atomic writes delegate to `writeFileAtomicExclusive` in fs-atomic.ts,
 * using `{ flag: 'wx' }` (O_EXCL | O_WRONLY) to guard against TOCTOU symlink
 * attacks. The unlink on EEXIST is race-tolerant (wrapped in try/catch before
 * the retry write), matching the CJS counterpart in json-helper.cjs.
 */

/**
 * Legacy entry IDs from the v2 signal-quality audit.
 * These were created by agent-summary extraction (v1) and replaced by
 * transcript-based extraction (v2). Widening this list requires another audit.
 */
const LEGACY_IDS = ['ADR-002', 'PF-001', 'PF-003', 'PF-005'];

export interface PurgeLegacyDecisionsResult {
  removed: number;
  files: string[];
}

/** Typed pair of (file path, section-prefix). Prefix is 'ADR' for decisions.md, 'PF' for pitfalls.md. */
type DecisionsFilePair = readonly [string, 'ADR' | 'PF'];

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex matching any `## ADR-NNN:` or `## PF-NNN:` section heading and all
 * lines that belong to that section (up to the next `## ` heading or end of
 * file).  The leading `\n` is included so removal does not leave a blank line
 * between sections when the preceding section ends with a newline.
 */
const SECTION_REGEX = /\n## (?:ADR|PF)-\d+:[^\n]*(?:\n(?!## )[^\n]*)*/g;

/**
 * Source marker that identifies a v2-era self-learning entry.  Any section
 * containing this literal string is authored by the background-learning
 * extractor and must be preserved.  Sections without it are pre-v2 seeded
 * content injected at install time.
 */
const SELF_LEARNING_SOURCE_MARKER = '\n- **Source**: self-learning:';

/**
 * Shared lock-and-loop helper used by both purge functions.
 *
 * Acquires the decisions lock, then for each file in `filePrefixPairs`:
 *   1. Reads the file (skips if absent).
 *   2. Calls `rewriteContent(content, prefix)` to get an updated string and a
 *      removed-section count.
 *   3. If the content changed, rewrites the TL;DR comment and writes atomically.
 *
 * The `rewriteContent` callback owns all domain-specific removal logic
 * (allowlist-based for v2, source-marker-based for v3), keeping this helper
 * free of policy.
 *
 * @param decisionsDir  Absolute path to the decisions directory (e.g. `.devflow/decisions/`)
 * @param lockDir       Absolute path to the mkdir-based lock directory
 * @param filePrefixPairs  Files to process with their heading prefix
 * @param rewriteContent  Per-file transform: returns updated content + sections removed
 */
async function withDecisionsFiles(
  decisionsDir: string,
  lockDir: string,
  filePrefixPairs: readonly DecisionsFilePair[],
  rewriteContent: (content: string, prefix: 'ADR' | 'PF') => { updated: string; removedCount: number },
): Promise<PurgeLegacyDecisionsResult> {
  // Bail early: nothing to do if decisions directory doesn't exist
  try {
    await fs.access(decisionsDir);
  } catch {
    return { removed: 0, files: [] };
  }

  const lockAcquired = await acquireMkdirLock(lockDir);
  if (!lockAcquired) {
    throw new Error('Decisions files are currently being written. Try again in a moment.');
  }

  let removed = 0;
  const modifiedFiles: string[] = [];

  try {
    for (const [filePath, prefix] of filePrefixPairs) {
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue; // File doesn't exist — skip
      }

      const { updated, removedCount } = rewriteContent(content, prefix);

      if (updated !== content) {
        removed += removedCount;

        // Update TL;DR count
        const headingMatches = updated.match(/^## (?:ADR|PF)-/gm) ?? [];
        const count = headingMatches.length;
        const label = prefix === 'ADR' ? 'decisions' : 'pitfalls';
        const withTldr = updated.replace(
          /<!-- TL;DR: \d+ (?:decisions|pitfalls)[^>]*-->/,
          `<!-- TL;DR: ${count} ${label}. Key: -->`,
        );

        await writeFileAtomicExclusive(filePath, withTldr);
        modifiedFiles.push(filePath);
      }
    }
  } finally {
    try { await fs.rmdir(lockDir); } catch { /* already cleaned */ }
  }

  return { removed, files: modifiedFiles };
}

/**
 * Remove pre-v2 low-signal decisions entries from decisions.md and pitfalls.md.
 *
 * The entries targeted are:
 *   - ADR-002  (decisions.md)
 *   - PF-001, PF-003, PF-005  (pitfalls.md)
 *
 * Returns immediately if `.devflow/decisions/` does not exist.
 *
 * @param options.memoryDir - absolute path to the `.devflow/memory/` directory
 * @returns number of sections removed and list of files that were modified
 * @throws if lock acquisition times out
 */
export async function purgeLegacyDecisionsEntries(options: {
  memoryDir: string;
  /** When provided, uses canonical project-paths for decisions dir and lock (new .devflow/ layout). */
  projectRoot?: string;
}): Promise<PurgeLegacyDecisionsResult> {
  const { memoryDir, projectRoot } = options;
  const decisionsDir = projectRoot ? getDecisionsDir(projectRoot) : path.join(memoryDir, 'decisions');
  const lockDir = projectRoot ? getDecisionsLockDir(projectRoot) : path.join(memoryDir, '.decisions.lock');
  const decisionsPath = path.join(decisionsDir, 'decisions.md');
  const pitfallsPath = path.join(decisionsDir, 'pitfalls.md');

  const filePrefixPairs: readonly DecisionsFilePair[] = [
    [decisionsPath, 'ADR'],
    [pitfallsPath, 'PF'],
  ];

  const result = await withDecisionsFiles(decisionsDir, lockDir, filePrefixPairs, (content, prefix) => {
    const legacyInFile = LEGACY_IDS.filter(id => id.startsWith(prefix));
    let updated = content;
    let removedCount = 0;
    for (const legacyId of legacyInFile) {
      // Remove the section from `## LEGACYID:` to the next `## ` or end-of-file
      const sectionRegex = new RegExp(
        `\\n## ${escapeRegExp(legacyId)}:[^\\n]*(?:\\n(?!## )[^\\n]*)*`,
        'g',
      );
      const before = updated;
      updated = updated.replace(sectionRegex, '');
      if (updated !== before) removedCount++;
    }
    return { updated, removedCount };
  });

  // Remove orphan PROJECT-PATTERNS.md — stale artifact, nothing generates/reads it.
  // D39-consistent: lstat guard ensures we only unlink regular files (defense-in-depth).
  // Check both the old path (.memory/PROJECT-PATTERNS.md, present on upgrading projects)
  // and the new path (.devflow/memory/PROJECT-PATTERNS.md, present on fresh installs or
  // post-migration projects). projectRoot is always provided by migrations.ts so memoryDir
  // already resolves to .devflow/memory/ — the old path is derived from projectRoot directly.
  const oldProjectPatternsPath = projectRoot
    ? path.join(projectRoot, '.memory', 'PROJECT-PATTERNS.md')
    : null;
  const newProjectPatternsPath = path.join(memoryDir, 'PROJECT-PATTERNS.md');
  for (const candidatePath of [oldProjectPatternsPath, newProjectPatternsPath]) {
    if (candidatePath === null) continue;
    try {
      const stat = await fs.lstat(candidatePath);
      if (stat.isFile()) {
        await fs.unlink(candidatePath);
        result.removed++;
        result.files.push(candidatePath);
      }
    } catch { /* File doesn't exist — fine */ }
  }

  return result;
}

/**
 * Remove ALL pre-v2 seeded decisions entries from decisions.md and pitfalls.md.
 *
 * Unlike `purgeLegacyDecisionsEntries` (which targets a fixed allow-list of 4
 * IDs), this function uses a format discriminator: any `## ADR-NNN:` or
 * `## PF-NNN:` section that does NOT contain the literal
 * `- **Source**: self-learning:` marker is considered pre-v2 seeded content
 * and is removed.  Self-learning entries always carry that marker; seeded
 * entries never do.
 *
 * D-Fix3: This widens the v2 migration's coverage from 4 hardcoded IDs to
 * ALL seeded entries, fixing the gap where 7 of the original 10 seed entries
 * survived the v2 purge on upgraded projects.
 *
 * Returns immediately if `.devflow/decisions/` does not exist.
 *
 * Does NOT remove PROJECT-PATTERNS.md — that file is v2's responsibility and
 * has already been handled by `purgeLegacyDecisionsEntries`.
 *
 * @param options.memoryDir - absolute path to the `.devflow/memory/` directory
 * @returns number of sections removed and list of files that were modified
 * @throws if lock acquisition times out
 */
export async function purgeAllPreV2DecisionsEntries(options: {
  memoryDir: string;
  /** When provided, uses canonical project-paths for decisions dir and lock (new .devflow/ layout). */
  projectRoot?: string;
}): Promise<PurgeLegacyDecisionsResult> {
  const { memoryDir, projectRoot } = options;
  const decisionsDir = projectRoot ? getDecisionsDir(projectRoot) : path.join(memoryDir, 'decisions');
  const lockDir = projectRoot ? getDecisionsLockDir(projectRoot) : path.join(memoryDir, '.decisions.lock');
  const decisionsPath = path.join(decisionsDir, 'decisions.md');
  const pitfallsPath = path.join(decisionsDir, 'pitfalls.md');

  const filePrefixPairs: readonly DecisionsFilePair[] = [
    [decisionsPath, 'ADR'],
    [pitfallsPath, 'PF'],
  ];

  return withDecisionsFiles(decisionsDir, lockDir, filePrefixPairs, (content) => {
    // Remove sections lacking the self-learning marker — those are pre-v2 seeded content.
    let removedCount = 0;
    const updated = content.replace(SECTION_REGEX, (section) => {
      if (!section.includes(SELF_LEARNING_SOURCE_MARKER)) {
        removedCount++;
        return '';
      }
      return section;
    });
    return { updated, removedCount };
  });
}

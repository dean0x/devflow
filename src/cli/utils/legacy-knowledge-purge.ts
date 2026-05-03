import { promises as fs } from 'fs';
import * as path from 'path';
import { writeFileAtomicExclusive } from './fs-atomic.js';

/**
 * @file legacy-knowledge-purge.ts
 *
 * D34: Pure helper extracted from the --purge-legacy-knowledge handler in
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

export interface PurgeLegacyKnowledgeResult {
  removed: number;
  files: string[];
}

/** Typed pair of (file path, section-prefix). Prefix is 'ADR' for decisions.md, 'PF' for pitfalls.md. */
type KnowledgeFilePair = readonly [string, 'ADR' | 'PF'];

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Acquire a mkdir-based lock, waiting up to timeoutMs.
 * Uses the same 60 s stale threshold as acquireMkdirLock in learn.ts and
 * json-helper.cjs (background-learning intentionally uses 300 s — see its DESIGN comment).
 */
async function acquireMkdirLock(
  lockDir: string,
  timeoutMs = 30_000,
  staleMs = 60_000,
): Promise<boolean> {
  const start = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockDir);
      return true;
    } catch {
      try {
        const stat = await fs.stat(lockDir);
        if (Date.now() - stat.mtimeMs > staleMs) {
          try { await fs.rmdir(lockDir); } catch { /* race OK */ }
          continue;
        }
      } catch { /* lock vanished between EEXIST and stat */ }
      if (Date.now() - start >= timeoutMs) return false;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
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
 * @param memoryDir     Absolute path to `.memory/`
 * @param filePrefixPairs  Files to process with their heading prefix
 * @param rewriteContent  Per-file transform: returns updated content + sections removed
 */
async function withKnowledgeFiles(
  memoryDir: string,
  filePrefixPairs: readonly KnowledgeFilePair[],
  rewriteContent: (content: string, prefix: 'ADR' | 'PF') => { updated: string; removedCount: number },
): Promise<PurgeLegacyKnowledgeResult> {
  const decisionsDir = path.join(memoryDir, 'decisions');

  // Bail early: nothing to do if decisions directory doesn't exist
  try {
    await fs.access(decisionsDir);
  } catch {
    return { removed: 0, files: [] };
  }

  const decisionsLockDir = path.join(memoryDir, '.decisions.lock');
  const lockAcquired = await acquireMkdirLock(decisionsLockDir);
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
    try { await fs.rmdir(decisionsLockDir); } catch { /* already cleaned */ }
  }

  return { removed, files: modifiedFiles };
}

/**
 * Remove pre-v2 low-signal knowledge entries from decisions.md and pitfalls.md.
 *
 * The entries targeted are:
 *   - ADR-002  (decisions.md)
 *   - PF-001, PF-003, PF-005  (pitfalls.md)
 *
 * Returns immediately if `.memory/decisions/` does not exist.
 *
 * @param options.memoryDir - absolute path to the `.memory/` directory
 * @returns number of sections removed and list of files that were modified
 * @throws if lock acquisition times out
 */
export async function purgeLegacyKnowledgeEntries(options: {
  memoryDir: string;
}): Promise<PurgeLegacyKnowledgeResult> {
  const { memoryDir } = options;
  const decisionsDir = path.join(memoryDir, 'decisions');
  const decisionsPath = path.join(decisionsDir, 'decisions.md');
  const pitfallsPath = path.join(decisionsDir, 'pitfalls.md');

  const filePrefixPairs: readonly KnowledgeFilePair[] = [
    [decisionsPath, 'ADR'],
    [pitfallsPath, 'PF'],
  ];

  const result = await withKnowledgeFiles(memoryDir, filePrefixPairs, (content, prefix) => {
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

  // Remove orphan PROJECT-PATTERNS.md — stale artifact, nothing generates/reads it
  // D39-consistent: lstat guard ensures we only unlink regular files (defense-in-depth)
  const projectPatternsPath = path.join(memoryDir, 'PROJECT-PATTERNS.md');
  try {
    const stat = await fs.lstat(projectPatternsPath);
    if (stat.isFile()) {
      await fs.unlink(projectPatternsPath);
      result.removed++;
      result.files.push(projectPatternsPath);
    }
  } catch { /* File doesn't exist — fine */ }

  return result;
}

/**
 * Remove ALL pre-v2 seeded knowledge entries from decisions.md and pitfalls.md.
 *
 * Unlike `purgeLegacyKnowledgeEntries` (which targets a fixed allow-list of 4
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
 * Returns immediately if `.memory/decisions/` does not exist.
 *
 * Does NOT remove PROJECT-PATTERNS.md — that file is v2's responsibility and
 * has already been handled by `purgeLegacyKnowledgeEntries`.
 *
 * @param options.memoryDir - absolute path to the `.memory/` directory
 * @returns number of sections removed and list of files that were modified
 * @throws if lock acquisition times out
 */
export async function purgeAllPreV2KnowledgeEntries(options: {
  memoryDir: string;
}): Promise<PurgeLegacyKnowledgeResult> {
  const { memoryDir } = options;
  const decisionsDir = path.join(memoryDir, 'decisions');
  const decisionsPath = path.join(decisionsDir, 'decisions.md');
  const pitfallsPath = path.join(decisionsDir, 'pitfalls.md');

  const filePrefixPairs: readonly KnowledgeFilePair[] = [
    [decisionsPath, 'ADR'],
    [pitfallsPath, 'PF'],
  ];

  return withKnowledgeFiles(memoryDir, filePrefixPairs, (content) => {
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

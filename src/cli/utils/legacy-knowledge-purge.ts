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
 * The function acquires `.knowledge.lock` (same mkdir-based lock used by
 * json-helper.cjs render-ready and updateKnowledgeStatus in learn.ts) to
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

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Acquire a mkdir-based lock, waiting up to timeoutMs.
 * Matches acquireMkdirLock in learn.ts so all lock holders use identical
 * staleness semantics.
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
 * Remove pre-v2 low-signal knowledge entries from decisions.md and pitfalls.md.
 *
 * The entries targeted are:
 *   - ADR-002  (decisions.md)
 *   - PF-001, PF-003, PF-005  (pitfalls.md)
 *
 * Returns immediately if `.memory/knowledge/` does not exist.
 *
 * @param options.memoryDir - absolute path to the `.memory/` directory
 * @returns number of sections removed and list of files that were modified
 * @throws if lock acquisition times out
 */
export async function purgeLegacyKnowledgeEntries(options: {
  memoryDir: string;
}): Promise<PurgeLegacyKnowledgeResult> {
  const { memoryDir } = options;
  const knowledgeDir = path.join(memoryDir, 'knowledge');
  const decisionsPath = path.join(knowledgeDir, 'decisions.md');
  const pitfallsPath = path.join(knowledgeDir, 'pitfalls.md');

  // Bail early: nothing to do if knowledge directory doesn't exist
  try {
    await fs.access(knowledgeDir);
  } catch {
    return { removed: 0, files: [] };
  }

  const knowledgeLockDir = path.join(memoryDir, '.knowledge.lock');
  const lockAcquired = await acquireMkdirLock(knowledgeLockDir);
  if (!lockAcquired) {
    throw new Error('Knowledge files are currently being written. Try again in a moment.');
  }

  let removed = 0;
  const modifiedFiles: string[] = [];

  try {
    const filePrefixPairs: [string, string][] = [
      [decisionsPath, 'ADR'],
      [pitfallsPath, 'PF'],
    ];

    for (const [filePath, prefix] of filePrefixPairs) {
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue; // File doesn't exist — skip
      }

      const legacyInFile = LEGACY_IDS.filter(id => id.startsWith(prefix));

      let updatedContent = content;
      for (const legacyId of legacyInFile) {
        // Remove the section from `## LEGACYID:` to the next `## ` or end-of-file
        const sectionRegex = new RegExp(
          `\\n## ${escapeRegExp(legacyId)}:[^\\n]*(?:\\n(?!## )[^\\n]*)*`,
          'g',
        );
        const before = updatedContent;
        updatedContent = updatedContent.replace(sectionRegex, '');
        if (updatedContent !== before) removed++;
      }

      if (updatedContent !== content) {
        // Update TL;DR count
        const headingMatches = updatedContent.match(/^## (ADR|PF)-/gm) ?? [];
        const count = headingMatches.length;
        const label = prefix === 'ADR' ? 'decisions' : 'pitfalls';
        updatedContent = updatedContent.replace(
          /<!-- TL;DR: \d+ (decisions|pitfalls)[^>]*-->/,
          `<!-- TL;DR: ${count} ${label}. Key: -->`,
        );
        await writeFileAtomicExclusive(filePath, updatedContent);
        modifiedFiles.push(filePath);
      }
    }

    // Remove orphan PROJECT-PATTERNS.md — stale artifact, nothing generates/reads it
    const projectPatternsPath = path.join(memoryDir, 'PROJECT-PATTERNS.md');
    try {
      await fs.unlink(projectPatternsPath);
      removed++;
      modifiedFiles.push(projectPatternsPath);
    } catch { /* File doesn't exist — fine */ }
  } finally {
    try { await fs.rmdir(knowledgeLockDir); } catch { /* already cleaned */ }
  }

  return { removed, files: modifiedFiles };
}

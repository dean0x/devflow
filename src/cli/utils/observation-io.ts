import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import { acquireMkdirLock } from './mkdir-lock.js';
import { type LearningObservation, type DecisionsEntryStatus, loadAndCountObservations } from './observations.js';

/**
 * @file observation-io.ts
 *
 * File I/O for observations and user-facing warnings.
 * Bridges the pure data module (observations.ts) with the filesystem.
 */

/**
 * Read and parse observations from a log file.
 * Returns empty results if the file does not exist.
 */
export async function readObservations(logPath: string): Promise<{ observations: LearningObservation[]; invalidCount: number }> {
  try {
    const logContent = await fs.readFile(logPath, 'utf-8');
    return loadAndCountObservations(logContent);
  } catch {
    return { observations: [], invalidCount: 0 };
  }
}

/**
 * Write observations back to a log file atomically.
 * Each observation is serialized as a JSON line. Uses a `.tmp` sibling + rename so
 * concurrent readers (e.g. background-learning during a race) never observe a
 * half-written file. Delegates to `writeFileAtomicExclusive` in fs-atomic.ts
 * (D34/D39: canonical TS atomic-write helper).
 */
export async function writeObservations(logPath: string, observations: LearningObservation[]): Promise<void> {
  const lines = observations.map(o => JSON.stringify(o));
  const content = lines.join('\n') + (lines.length ? '\n' : '');
  await writeFileAtomicExclusive(logPath, content);
}

/**
 * Warn the user if invalid entries were found in a log file.
 * Pass `command` to customize the purge command shown in the warning.
 */
export function warnIfInvalid(invalidCount: number, command = 'devflow learn --purge'): void {
  if (invalidCount > 0) {
    p.log.warn(`Note: ${invalidCount} invalid entry(ies) found. Run '${command}' to clean.`);
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Update the Status: field for a decision or pitfall entry in a decisions file.
 * Locates the entry by anchor ID (from artifact_path fragment), sets Status to the given value.
 * Acquires a mkdir-based lock before writing. Returns true if the file was updated.
 *
 * The lock path MUST match the render-ready writer in json-helper.cjs so CLI updates
 * serialize against the background learning pipeline.
 */
export async function updateDecisionsStatus(
  filePath: string,
  anchorId: string,
  newStatus: DecisionsEntryStatus,
): Promise<boolean> {
  const memoryDir = path.dirname(path.dirname(filePath));
  const lockPath = path.join(memoryDir, '.decisions.lock');

  const acquired = await acquireMkdirLock(lockPath);
  if (!acquired) return false;

  try {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      return false;
    }

    const anchorPattern = new RegExp(`(##[^#][^\n]*${escapeRegExp(anchorId)}[^\n]*\n(?:(?!^##)[^\n]*\n)*?)(- \\*\\*Status\\*\\*: )[^\n]+`, 'm');
    const updated = content.replace(anchorPattern, `$1$2${newStatus}`);

    if (updated === content) {
      const lines = content.split('\n');
      let inSection = false;
      let changed = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(anchorId)) {
          inSection = true;
        } else if (inSection && lines[i].startsWith('## ')) {
          break;
        } else if (inSection && lines[i].match(/^- \*\*Status\*\*: /)) {
          lines[i] = `- **Status**: ${newStatus}`;
          changed = true;
          break;
        }
      }
      if (!changed) return false;
      await writeFileAtomicExclusive(filePath, lines.join('\n'));
    } else {
      await writeFileAtomicExclusive(filePath, updated);
    }
    return true;
  } finally {
    try { await fs.rmdir(lockPath); } catch { /* already cleaned */ }
  }
}

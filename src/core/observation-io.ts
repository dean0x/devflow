import { promises as fs } from 'fs';
import * as p from '@clack/prompts';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import { type LearningObservation, loadAndCountObservations } from './observations.js';

/**
 * @file observation-io.ts
 *
 * File I/O for observations and user-facing warnings.
 * Bridges the pure data module (observations.ts) with the filesystem.
 *
 * The `.md` files are a pure render of the decisions ledger — never edit them
 * directly. To change the status of a decision or pitfall, use the
 * `retire-anchor` op in `json-helper.cjs`, which flips `decisions_status` on
 * the ledger row and re-renders both `.md` files atomically.
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
 * Invalid entries are cleaned up automatically by the background curation pass.
 */
export function warnIfInvalid(invalidCount: number): void {
  if (invalidCount > 0) {
    p.log.warn(`Note: ${invalidCount} invalid entry(ies) found. They will be cleaned up automatically.`);
  }
}

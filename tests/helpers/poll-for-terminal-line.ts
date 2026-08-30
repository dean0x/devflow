/**
 * tests/helpers/poll-for-terminal-line.ts
 *
 * Shared bounded poll helper for log-file assertion in hook integration tests.
 * Extracted from eager-memory-refresh.test.ts and capture-hooks.test.ts to
 * keep the 12 s total bound in one place (avoids PF-018(7): duplicated retry
 * loops wearing different names).
 */

import * as fs from 'fs';

/**
 * Poll a log file for a terminal needle line.
 * Retries up to maxAttempts times, each attempt polling for pollMs milliseconds.
 * Total bound = pollMs * maxAttempts (default call sites use 4000 * 3 = 12 s).
 * All waits and retry counts explicitly bounded (no unbounded while loop).
 */
export async function pollForTerminalLine(
  logFile: string,
  needle: string,
  pollMs: number,
  maxAttempts: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const deadline = Date.now() + pollMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf-8');
        if (content.includes(needle)) return true;
      }
      await new Promise<void>((r) => setTimeout(r, 100));
    }
  }
  return false;
}

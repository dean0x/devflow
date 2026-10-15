/**
 * tests/helpers/poll-for-terminal-line.ts
 *
 * Shared bounded poll helper for log-file assertion in hook integration tests.
 * Extracted from eager-memory-refresh.test.ts and capture-hooks.test.ts to
 * keep the 12 s total bound in one place, rather than in duplicated retry
 * loops wearing different names. Also holds the one definition of the lines that
 * end a background-memory-update run, and the one wait on them.
 */

import { expect } from 'vitest';
import * as fs from 'fs';

/**
 * Poll a log file for a terminal needle line: a substring, or a pattern when several
 * lines end the run (the first one logged wins). The pattern is tested without state,
 * so a pattern with the `g` or `y` flag is refused: its `lastIndex` would carry over
 * between polls and skip a line that is there.
 * Retries up to maxAttempts times, each attempt polling for pollMs milliseconds.
 * Total bound = pollMs * maxAttempts (default call sites use 4000 * 3 = 12 s).
 * All waits and retry counts explicitly bounded (no unbounded while loop).
 */
export async function pollForTerminalLine(
  logFile: string,
  needle: string | RegExp,
  pollMs: number,
  maxAttempts: number,
): Promise<boolean> {
  if (needle instanceof RegExp && (needle.global || needle.sticky)) {
    throw new Error(
      `pollForTerminalLine: the pattern ${needle} has the g or y flag, which keeps lastIndex between polls and can skip a line that is in the log; pass the pattern without g and y`,
    );
  }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const deadline = Date.now() + pollMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf-8');
        if (typeof needle === 'string' ? content.includes(needle) : needle.test(content)) return true;
      }
      await new Promise<void>((r) => setTimeout(r, 100));
    }
  }
  return false;
}

/**
 * The lines that end a background-memory-update run, read from the worker's own exits:
 * the outcome of a run that reached claude (drained, retained, killed or failed, failed
 * verification), and the reason a run stopped before it (skipped, aborted, a queue of
 * user turns only, an empty processing file, no turn that parses). The worker's first
 * line, "Starting", and its progress lines do not end a run. A new exit line in the
 * worker belongs here.
 */
export const WORKER_FINAL_LINE =
  /SUCCESS: queue drained|CONFLICT: queue retained|FAIL: (?:verification failed|claude -p)|SKIP:|ABORT:|User-only queue|Processing file empty|No parseable turns/;

const WORKER_POLL_MS = 4000;
const WORKER_POLL_ATTEMPTS = 3;

/**
 * Wait for the detached background-memory-update worker to FINISH, not to start. It keeps
 * writing into the project folder (the probe, the lock, the queue claim, the staged swap)
 * long after its first log line, so a test that returned at "Starting" would have afterEach
 * remove the folder under it and leave an orphan that retries the lock for up to 90 s. Fails
 * with the worker log when no final line shows up. Bounded: 4000ms × ≤3 attempts, so a test
 * that calls this allows itself a 15000ms it-timeout.
 */
export async function waitForWorkerToFinish(logFile: string): Promise<void> {
  const finished = await pollForTerminalLine(logFile, WORKER_FINAL_LINE, WORKER_POLL_MS, WORKER_POLL_ATTEMPTS);
  expect(
    finished,
    `the detached worker logged no final line within ${(WORKER_POLL_MS * WORKER_POLL_ATTEMPTS) / 1000} s:\n${fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '(no log)'}`,
  ).toBe(true);
}

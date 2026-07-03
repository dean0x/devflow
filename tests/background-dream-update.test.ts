/**
 * tests/background-dream-update.test.ts
 *
 * Tests for scripts/hooks/background-dream-update (the detached dream worker)
 * and scripts/hooks/dream-procedure.md (the procedure it points its agent at).
 *
 * Harness idioms follow eager-memory-refresh.test.ts: fake-claude PATH shim,
 * temp dirs, DEVFLOW_BG_WATCHDOG_SECS override, execSync. Real `claude` is
 * never invoked from these tests.
 *
 * DEVIATION NOTE (see handoff): "DW3 stdin dump contains full claimed queue"
 * is interpreted as "the prompt delivered via stdin contains the PATH to the
 * claimed queue snapshot, from which the full queue is reachable" — matching
 * the plan's own explicit prompt template ("Read dream-procedure.md and
 * follow it; inputs at <paths>"), rather than inlining raw queue content into
 * the prompt. The agent reads the queue file itself via its own Read tool.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HOOKS_DIR = path.resolve(__dirname, '..', 'scripts', 'hooks');
const JSON_HELPER = path.join(HOOKS_DIR, 'json-helper.cjs');
const WORKER = path.join(HOOKS_DIR, 'background-dream-update');
const PROCEDURE = path.join(HOOKS_DIR, 'dream-procedure.md');

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

function runWorker(
  projectDir: string,
  homeDir: string,
  shimDir: string,
  extraEnv: Record<string, string> = {},
): { exitCode: number } {
  try {
    execSync(`bash "${WORKER}" "${projectDir}"`, {
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        ...extraEnv,
      },
      stdio: 'ignore',
    });
    return { exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { status?: number };
    return { exitCode: err.status ?? 1 };
  }
}

function workerLogPath(projectDir: string, homeDir: string): string {
  const slug = projectDir.replace(/^\//, '').replace(/\//g, '-');
  return path.join(homeDir, '.devflow', 'logs', slug, '.background-dream-update.log');
}

/** A fake claude that dumps its stdin + argv, then acts as a scripted "agent"
 * calling the REAL json-helper.cjs ops before touching .last-dream-ok. */
function createRealAgentShim(shimDir: string, projectDir: string, opts: { skipStamp?: boolean } = {}): { stdinCapture: string; argvCapture: string } {
  const stdinCapture = path.join(shimDir, 'stdin-captured.txt');
  const argvCapture = path.join(shimDir, 'argv-captured.txt');
  const stampLine = opts.skipStamp ? '' : `touch "${projectDir}/.devflow/dream/.last-dream-ok"`;
  fs.writeFileSync(
    path.join(shimDir, 'claude'),
    `#!/bin/bash
echo "$@" > "${argvCapture}"
cat > "${stdinCapture}"
cd "${projectDir}"
node "${JSON_HELPER}" merge-observation \\
  ".devflow/decisions/decisions-log.jsonl" \\
  '{"id":"obs_dw1","type":"pitfall","pattern":"test pitfall","evidence":["e1"],"details":"area: x; issue: y; impact: z; resolution: w","confidence":0.7,"status":"ready","quality_ok":true}'
node "${JSON_HELPER}" assign-anchor "pitfall" "obs_dw1"
echo "Created PF-001 for test pitfall" > .devflow/dream/last-run-summary
node "${JSON_HELPER}" rotate-observations || true
${stampLine}
exit 0
`,
  );
  fs.chmodSync(path.join(shimDir, 'claude'), 0o755);
  return { stdinCapture, argvCapture };
}

function seedDreamQueue(projectDir: string, content = 'assistant reply mentioning a workaround for widget caching'): void {
  fs.writeFileSync(
    path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'),
    JSON.stringify({ role: 'assistant', content, ts: Math.floor(Date.now() / 1000) }) + '\n',
  );
}

describe('shell hook syntax: background-dream-update passes bash -n', () => {
  it('bash -n succeeds', () => {
    expect(() => {
      execSync(`bash -n "${WORKER}"`, { stdio: 'pipe' });
    }).not.toThrow();
  });
});

// =============================================================================
// DW1 — happy path
// =============================================================================
describe('DW1: happy path — claim, spawn, real ledger ops, success gate', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw1-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw1-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw1-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
    seedDreamQueue(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('assigns an anchor, renders .md, deletes .processing, touches .last-dream-ok', () => {
    createRealAgentShim(shimDir, projectDir);

    const { exitCode } = runWorker(projectDir, homeDir, shimDir);
    expect(exitCode).toBe(0);

    const ledger = fs
      .readFileSync(path.join(projectDir, '.devflow', 'decisions', 'decisions-ledger.jsonl'), 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ anchor_id: 'PF-001', decisions_status: 'Active' });

    const pitfallsMd = fs.readFileSync(path.join(projectDir, '.devflow', 'decisions', 'pitfalls.md'), 'utf-8');
    expect(pitfallsMd).toContain('PF-001');

    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.processing'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.last-dream-ok'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', 'last-run-summary'))).toBe(true);
  });

  it('no .worker.lock left behind on success', () => {
    createRealAgentShim(shimDir, projectDir);
    runWorker(projectDir, homeDir, shimDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.worker.lock'))).toBe(false);
  });
});

// =============================================================================
// DW3 — prompt (delivered via stdin) points at the full claimed queue
// =============================================================================
describe('DW3: stdin prompt contains a path from which the full claimed queue is reachable', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw3-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw3-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw3-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('stdin contains the claimed .pending-turns.processing path, and reading it yields the full queue', () => {
    const SENTINEL = 'DW3_UNIQUE_QUEUE_MARKER_widget_caching_decision';
    seedDreamQueue(projectDir, SENTINEL);

    // Snapshot the processing file's content from WITHIN the shim, before the
    // worker's own success-path cleanup (`rm -f "$PROCESSING_FILE"`) removes it.
    const stdinCapture = path.join(shimDir, 'stdin.txt');
    const queueSnapshot = path.join(shimDir, 'queue-snapshot.txt');
    const processingPath = path.join(projectDir, '.devflow', 'dream', '.pending-turns.processing');
    fs.writeFileSync(
      path.join(shimDir, 'claude'),
      `#!/bin/bash
cat > "${stdinCapture}"
cp "${processingPath}" "${queueSnapshot}"
touch "${projectDir}/.devflow/dream/.last-dream-ok"
exit 0
`,
    );
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    runWorker(projectDir, homeDir, shimDir);

    const prompt = fs.readFileSync(stdinCapture, 'utf-8');
    expect(prompt).toContain(processingPath);
    expect(prompt).toContain(path.join(projectDir, '.devflow', 'decisions', 'decisions-log.jsonl'));
    expect(prompt).toContain('dream-procedure.md');

    // The full queue was reachable at the path named in the prompt while the
    // agent ran (the claim renamed .pending-turns.jsonl -> .pending-turns.processing;
    // it is deleted only AFTER a successful run, which is why we snapshot it above).
    expect(fs.readFileSync(queueSnapshot, 'utf-8')).toContain(SENTINEL);
  });

  it('prompt does not inline raw queue content directly (path-pointing design)', () => {
    const SENTINEL = 'DW3_SHOULD_NOT_BE_INLINE_abcdef123456';
    seedDreamQueue(projectDir, SENTINEL);
    const stdinCapture = path.join(shimDir, 'stdin.txt');
    fs.writeFileSync(
      path.join(shimDir, 'claude'),
      `#!/bin/bash\ncat > "${stdinCapture}"\ntouch "${projectDir}/.devflow/dream/.last-dream-ok"\nexit 0\n`,
    );
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    runWorker(projectDir, homeDir, shimDir);

    const prompt = fs.readFileSync(stdinCapture, 'utf-8');
    expect(prompt).not.toContain(SENTINEL);
  });
});

// =============================================================================
// DW4 — malformed rows tolerated (the worker never parses the queue as JSON)
// =============================================================================
describe('DW4: malformed queue rows are tolerated by the worker script', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw4-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw4-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw4-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('claim + spawn + success gate all succeed even with malformed JSON lines in the queue', () => {
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'),
      ['not valid json at all', '{"role":"assistant","content":"valid row","ts":1}', '{{{broken', ''].join('\n'),
    );
    fs.writeFileSync(
      path.join(shimDir, 'claude'),
      `#!/bin/bash\ncat > /dev/null\ntouch "${projectDir}/.devflow/dream/.last-dream-ok"\nexit 0\n`,
    );
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    const { exitCode } = runWorker(projectDir, homeDir, shimDir);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.last-dream-ok'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.processing'))).toBe(false);
  });
});

// =============================================================================
// DW5 — leftover .processing merged with new queue entries
// =============================================================================
describe('DW5: leftover .processing from a previous crash is merged with new queue entries', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw5-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw5-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw5-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('both the leftover .processing batch and the new queue reach the claimed file', () => {
    const processingFile = path.join(projectDir, '.devflow', 'dream', '.pending-turns.processing');
    const queueFile = path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl');
    fs.writeFileSync(processingFile, JSON.stringify({ role: 'assistant', content: 'PRIOR-CRASHED-TURN', ts: 1 }) + '\n');
    fs.writeFileSync(queueFile, JSON.stringify({ role: 'assistant', content: 'NEW-QUEUE-TURN', ts: 2 }) + '\n');

    const stdinCapture = path.join(shimDir, 'stdin.txt');
    fs.writeFileSync(
      path.join(shimDir, 'claude'),
      `#!/bin/bash\ncat > "${stdinCapture}"\ntouch "${projectDir}/.devflow/dream/.last-dream-ok"\nexit 0\n`,
    );
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    runWorker(projectDir, homeDir, shimDir);

    // The queue file must be gone (merged in), and the (still-existing until
    // success) processing file contains both batches.
    expect(fs.existsSync(queueFile)).toBe(false);
    // On success .processing is removed — but the CONTENT it held before removal
    // is what the agent's stdin pointed at; verify via the captured prompt path
    // and a pre-removal snapshot check using a shim that reads before touching ok.
  });

  it('merged content is visible to the agent before .last-dream-ok is touched', () => {
    const processingFile = path.join(projectDir, '.devflow', 'dream', '.pending-turns.processing');
    const queueFile = path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl');
    fs.writeFileSync(processingFile, JSON.stringify({ role: 'assistant', content: 'PRIOR-CRASHED-TURN', ts: 1 }) + '\n');
    fs.writeFileSync(queueFile, JSON.stringify({ role: 'assistant', content: 'NEW-QUEUE-TURN', ts: 2 }) + '\n');

    const mergedSnapshot = path.join(shimDir, 'merged-snapshot.txt');
    fs.writeFileSync(
      path.join(shimDir, 'claude'),
      `#!/bin/bash
cat > /dev/null
cp "${processingFile}" "${mergedSnapshot}"
touch "${projectDir}/.devflow/dream/.last-dream-ok"
exit 0
`,
    );
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    runWorker(projectDir, homeDir, shimDir);

    const merged = fs.readFileSync(mergedSnapshot, 'utf-8');
    expect(merged).toContain('PRIOR-CRASHED-TURN');
    expect(merged).toContain('NEW-QUEUE-TURN');
  });

  it('200->100 overflow cap applies to the merged .processing file', () => {
    const processingFile = path.join(projectDir, '.devflow', 'dream', '.pending-turns.processing');
    const queueFile = path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl');
    const processingLines = Array.from({ length: 150 }, (_, i) => JSON.stringify({ role: 'assistant', content: `old-${i}`, ts: i }));
    const queueLines = Array.from({ length: 60 }, (_, i) => JSON.stringify({ role: 'assistant', content: `new-${i}`, ts: 200 + i }));
    fs.writeFileSync(processingFile, processingLines.join('\n') + '\n');
    fs.writeFileSync(queueFile, queueLines.join('\n') + '\n');

    const snapshot = path.join(shimDir, 'snapshot.txt');
    fs.writeFileSync(
      path.join(shimDir, 'claude'),
      `#!/bin/bash\ncat > /dev/null\ncp "${processingFile}" "${snapshot}"\ntouch "${projectDir}/.devflow/dream/.last-dream-ok"\nexit 0\n`,
    );
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    runWorker(projectDir, homeDir, shimDir);

    const lines = fs.readFileSync(snapshot, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(100);
  });
});

// =============================================================================
// DW6 — watchdog kill + invariant assertion + stamp-not-advanced
// =============================================================================
describe('DW6: watchdog kill, runtime invariant, and stamp-not-advanced all leave .processing', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw6-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw6-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw6-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
    seedDreamQueue(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('hanging claude is killed by the watchdog; worker exits 0; .processing retained', () => {
    fs.writeFileSync(path.join(shimDir, 'claude'), '#!/bin/bash\ncat > /dev/null\nsleep 300\n');
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    const { exitCode } = runWorker(projectDir, homeDir, shimDir, { DEVFLOW_BG_WATCHDOG_SECS: '2' });

    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.last-dream-ok'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.processing'))).toBe(true);
  }, 20000);

  it('runtime invariant assertion fails loud when WATCHDOG_TOTAL >= STALE_THRESHOLD (900)', () => {
    // 896 + 5 grace = 901 > 900 stale threshold -> the FATAL assertion must fire.
    fs.writeFileSync(path.join(shimDir, 'claude'), '#!/bin/bash\ncat > /dev/null\nexit 0\n');
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    let exitCode = 0;
    try {
      execSync(`bash "${WORKER}" "${projectDir}"`, {
        env: { ...process.env, HOME: homeDir, PATH: `${shimDir}:${process.env.PATH}`, DEVFLOW_BG_WATCHDOG_SECS: '896' },
        stdio: 'pipe',
      });
    } catch (e: unknown) {
      exitCode = (e as { status?: number }).status ?? 1;
    }
    expect(exitCode).toBe(1);
  });

  it('claude exits 0 but .last-dream-ok is not advanced -> .processing retained (no-op agent)', () => {
    // Agent runs and exits cleanly but forgets to touch the stamp (or a stale
    // stamp already exists and is not advanced past the pre-spawn baseline).
    fs.writeFileSync(path.join(shimDir, 'claude'), '#!/bin/bash\ncat > /dev/null\nexit 0\n');
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    const { exitCode } = runWorker(projectDir, homeDir, shimDir);

    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.processing'))).toBe(true);
  });

  it('pre-existing stale .last-dream-ok that is NOT touched again -> still treated as failure', () => {
    const okFile = path.join(projectDir, '.devflow', 'dream', '.last-dream-ok');
    fs.writeFileSync(okFile, '');
    const old = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(okFile, old, old);
    const baselineMtime = fs.statSync(okFile).mtimeMs;

    fs.writeFileSync(path.join(shimDir, 'claude'), '#!/bin/bash\ncat > /dev/null\nexit 0\n'); // does not touch the stamp
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    runWorker(projectDir, homeDir, shimDir);

    expect(fs.statSync(okFile).mtimeMs).toBe(baselineMtime);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.processing'))).toBe(true);
  });
});

// =============================================================================
// DW7 — lock discipline
// =============================================================================
describe('DW7: .worker.lock discipline (fail-fast acquire, 900s stale-evict)', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw7-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw7-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw7-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
    seedDreamQueue(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('a foreign FRESH lock blocks the worker immediately (<=3s measured), queue untouched', () => {
    fs.writeFileSync(path.join(shimDir, 'claude'), '#!/bin/bash\necho "SHOULD NOT RUN" >&2\nexit 0\n');
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream', '.worker.lock'));

    const start = Date.now();
    const { exitCode } = runWorker(projectDir, homeDir, shimDir);
    const elapsed = Date.now() - start;

    expect(exitCode).toBe(0);
    expect(elapsed).toBeLessThan(3000);
    // Queue was never claimed — still present as .pending-turns.jsonl, not renamed.
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'))).toBe(true);
  });

  it('a backdated (>900s) lock is evicted, allowing the worker to proceed', () => {
    fs.writeFileSync(
      path.join(shimDir, 'claude'),
      `#!/bin/bash\ncat > /dev/null\ntouch "${projectDir}/.devflow/dream/.last-dream-ok"\nexit 0\n`,
    );
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);
    const lockDir = path.join(projectDir, '.devflow', 'dream', '.worker.lock');
    fs.mkdirSync(lockDir);
    const old = new Date(Date.now() - 1000 * 1000); // > 900s
    fs.utimesSync(lockDir, old, old);

    const { exitCode } = runWorker(projectDir, homeDir, shimDir);

    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.last-dream-ok'))).toBe(true);
  });

  it('lock is released after a normal run completes', () => {
    fs.writeFileSync(
      path.join(shimDir, 'claude'),
      `#!/bin/bash\ncat > /dev/null\ntouch "${projectDir}/.devflow/dream/.last-dream-ok"\nexit 0\n`,
    );
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);
    runWorker(projectDir, homeDir, shimDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.worker.lock'))).toBe(false);
  });
});

// =============================================================================
// DW8 — CLI contract
// =============================================================================
describe('DW8: CLI contract — allowedTools without skip-permissions, env flag, no hostile argv', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw8-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw8-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw8-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('argv contains --allowedTools with the expected tool list and NEVER --dangerously-skip-permissions', () => {
    seedDreamQueue(projectDir);
    const { argvCapture } = createRealAgentShim(shimDir, projectDir);
    runWorker(projectDir, homeDir, shimDir);

    const argv = fs.readFileSync(argvCapture, 'utf-8');
    expect(argv).toContain('--allowedTools');
    expect(argv).toContain('Read,Grep,Glob,Write,Edit,Bash');
    expect(argv).not.toContain('--dangerously-skip-permissions');
  });

  it('DEVFLOW_BG_DREAM=1 is present in the child claude env', () => {
    seedDreamQueue(projectDir);
    const envCapture = path.join(shimDir, 'env-captured.txt');
    fs.writeFileSync(
      path.join(shimDir, 'claude'),
      `#!/bin/bash\ncat > /dev/null\nprintf '%s' "$DEVFLOW_BG_DREAM" > "${envCapture}"\ntouch "${projectDir}/.devflow/dream/.last-dream-ok"\nexit 0\n`,
    );
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    runWorker(projectDir, homeDir, shimDir);

    expect(fs.readFileSync(envCapture, 'utf-8')).toBe('1');
  });

  it('hostile queue content never appears in argv (path-pointing prompt design)', () => {
    const HOSTILE = 'HOSTILE_ARGV_LEAK_TEST $(rm -rf /) `evil` --dangerously-skip-permissions';
    seedDreamQueue(projectDir, HOSTILE);
    const { argvCapture } = createRealAgentShim(shimDir, projectDir);

    runWorker(projectDir, homeDir, shimDir);

    const argv = fs.readFileSync(argvCapture, 'utf-8');
    expect(argv).not.toContain('HOSTILE_ARGV_LEAK_TEST');
  });

  it('hostile queue content never appears in the prompt (stdin) either', () => {
    const HOSTILE = 'HOSTILE_STDIN_LEAK_TEST_marker_9f3a7b';
    seedDreamQueue(projectDir, HOSTILE);
    const stdinCapture = path.join(shimDir, 'stdin.txt');
    fs.writeFileSync(
      path.join(shimDir, 'claude'),
      `#!/bin/bash\ncat > "${stdinCapture}"\ntouch "${projectDir}/.devflow/dream/.last-dream-ok"\nexit 0\n`,
    );
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    runWorker(projectDir, homeDir, shimDir);

    expect(fs.readFileSync(stdinCapture, 'utf-8')).not.toContain(HOSTILE);
  });
});

// =============================================================================
// DW9 — AC-C5: model resolution (project decisions.json -> global -> opus default)
// =============================================================================
describe('DW9: AC-C5 — model resolution defaults to opus, project config wins', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw9-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw9-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-dw9-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
    seedDreamQueue(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('defaults to opus when neither project nor global decisions.json sets a model', () => {
    const { argvCapture } = createRealAgentShim(shimDir, projectDir);
    runWorker(projectDir, homeDir, shimDir);
    const argv = fs.readFileSync(argvCapture, 'utf-8');
    expect(argv).toContain('--model opus');
  });

  it('project decisions.json model field overrides the opus default', () => {
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'decisions', 'decisions.json'),
      JSON.stringify({ model: 'haiku' }),
    );
    const { argvCapture } = createRealAgentShim(shimDir, projectDir);
    runWorker(projectDir, homeDir, shimDir);
    const argv = fs.readFileSync(argvCapture, 'utf-8');
    expect(argv).toContain('--model haiku');
  });

  it('global decisions.json model field is used when project config is absent', () => {
    fs.mkdirSync(path.join(homeDir, '.devflow'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.devflow', 'decisions.json'),
      JSON.stringify({ model: 'sonnet' }),
    );
    const { argvCapture } = createRealAgentShim(shimDir, projectDir);
    runWorker(projectDir, homeDir, shimDir);
    const argv = fs.readFileSync(argvCapture, 'utf-8');
    expect(argv).toContain('--model sonnet');
  });

  it('project decisions.json wins over global when both set a model', () => {
    fs.mkdirSync(path.join(homeDir, '.devflow'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.devflow', 'decisions.json'),
      JSON.stringify({ model: 'sonnet' }),
    );
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'decisions', 'decisions.json'),
      JSON.stringify({ model: 'haiku' }),
    );
    const { argvCapture } = createRealAgentShim(shimDir, projectDir);
    runWorker(projectDir, homeDir, shimDir);
    const argv = fs.readFileSync(argvCapture, 'utf-8');
    expect(argv).toContain('--model haiku');
  });
});

// =============================================================================
// AC-C3 — dream-procedure.md contract (pinned)
// =============================================================================
describe('AC-C3: dream-procedure.md contract', () => {
  const content = fs.readFileSync(PROCEDURE, 'utf-8');

  it('exists and is readable', () => {
    expect(fs.existsSync(PROCEDURE)).toBe(true);
  });

  it('is not a skill (no allowed-tools frontmatter — skills do not load in claude -p)', () => {
    expect(content.startsWith('---')).toBe(false);
  });

  it('instructs read-only inputs: queue snapshot, decisions-log, decisions.md, pitfalls.md, usage file', () => {
    expect(content).toContain('decisions-log.jsonl');
    expect(content).toContain('decisions.md');
    expect(content).toContain('pitfalls.md');
    expect(content).toContain('.decisions-usage.json');
  });

  it('references only the sanctioned write ops: merge-observation, assign-anchor, retire-anchor, rotate-observations', () => {
    expect(content).toContain('merge-observation');
    expect(content).toContain('assign-anchor');
    expect(content).toContain('retire-anchor');
    expect(content).toContain('rotate-observations');
  });

  it('references .last-dream-ok and last-run-summary lifecycle', () => {
    expect(content).toContain('.last-dream-ok');
    expect(content).toContain('last-run-summary');
  });

  it('contains the Iron-Law strings: never hand-edit, ADR-XOR-PF, abstain-by-default', () => {
    expect(content.toLowerCase()).toContain('never hand-edit');
    expect(content).toContain('ADR-XOR-PF');
    expect(content).toContain('abstain-by-default');
  });

  it('contains the curation bounds: <=5 changes, 7-day protection window', () => {
    expect(content).toContain('7-day protection window');
    // \s+ between every word tolerates an incidental mid-sentence line wrap in
    // the markdown source (a literal newline, not just a space).
    expect(content.toLowerCase()).toMatch(/(≤5|<=5)\s+curation\s+changes/);
  });

  it('does NOT instruct marker claim/heartbeat/multi-marker-merge ceremony (worker script owns lifecycle)', () => {
    expect(content).not.toContain('.processing files (dream-recover');
    expect(content.toLowerCase()).toContain('do not need to claim, heartbeat, or merge');
  });
});

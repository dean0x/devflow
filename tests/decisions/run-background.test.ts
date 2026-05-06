/**
 * Tests for `devflow decisions --run-background` pipeline.
 *
 * Strategy: mock background-runner utilities, decisions-agent, decisions-config,
 * and child_process to verify pipeline ordering and argument correctness
 * without actually spawning claude or touching the filesystem.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Mocks — factories must NOT reference outer variables (hoisting restriction).
// ---------------------------------------------------------------------------

vi.mock('../../src/cli/utils/background-runner.js', () => ({
  acquireBackgroundLock: vi.fn(async () => undefined),
  releaseBackgroundLock: vi.fn(() => undefined),
  registerLockCleanup: vi.fn(() => vi.fn()),
  extractBatchMessages: vi.fn(async () => ({
    userSignals: [],
    dialogPairs: [{ prior: 'assistant response', user: 'user message' }],
  })),
  applyTemporalDecay: vi.fn(async () => undefined),
  capEntries: vi.fn(() => undefined),
  checkStaleness: vi.fn(async () => undefined),
}));

vi.mock('../../src/cli/utils/decisions-agent.js', () => ({
  runDecisionsAgent: vi.fn(async () => '/tmp/decisions-response.tmp'),
}));

vi.mock('../../src/cli/utils/decisions-config.js', () => ({
  loadDecisionsConfig: vi.fn(() => ({
    max_daily_runs: 3,
    throttle_minutes: 5,
    model: 'sonnet',
    debug: false,
    batch_size: 1,
  })),
}));

vi.mock('../../src/cli/utils/paths.js', () => ({
  getClaudeDirectory: vi.fn(() => '/home/user/.claude'),
  getDevFlowDirectory: vi.fn(() => '/home/user/.devflow'),
}));

// Capture execFileSync calls via a module-level array shared with the factory closure.
const _execFileSyncCalls: Array<{ cmd: string; args: string[] }> = [];
vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, callback: (err: null, result: { stdout: string; stderr: string }) => void) => {
    callback(null, { stdout: '', stderr: '' });
    return {} as ReturnType<typeof import('child_process').execFile>;
  }),
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    _execFileSyncCalls.push({ cmd, args });
  }),
}));

// ---------------------------------------------------------------------------
// Import modules AFTER mocks are set up.
// ---------------------------------------------------------------------------
import { decisionsCommand } from '../../src/cli/commands/decisions.js';
import * as backgroundRunner from '../../src/cli/utils/background-runner.js';
import * as decisionsAgent from '../../src/cli/utils/decisions-agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-bg-test-'));
}

/**
 * Invoke the decisions command with --run-background and a temp cwd.
 */
async function runBackground(tmpCwd: string): Promise<void> {
  // Create expected memory dir
  fs.mkdirSync(path.join(tmpCwd, '.memory'), { recursive: true });
  await decisionsCommand.parseAsync(['--run-background', '--cwd', tmpCwd], { from: 'user' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('decisions --run-background pipeline', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    _execFileSyncCalls.length = 0;
    vi.clearAllMocks();

    // Re-configure mocks after clearAllMocks resets call counts but keeps implementations.
    vi.mocked(backgroundRunner.registerLockCleanup).mockReturnValue(vi.fn());
    vi.mocked(backgroundRunner.extractBatchMessages).mockResolvedValue({
      userSignals: [],
      dialogPairs: [{ prior: 'assistant response', user: 'user message' }],
    });
    vi.mocked(decisionsAgent.runDecisionsAgent).mockResolvedValue('/tmp/decisions-response.tmp');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('acquires lock before extractBatchMessages', async () => {
    const callOrder: string[] = [];
    vi.mocked(backgroundRunner.acquireBackgroundLock).mockImplementation(async () => {
      callOrder.push('acquireLock');
    });
    vi.mocked(backgroundRunner.extractBatchMessages).mockImplementation(async () => {
      callOrder.push('extractBatch');
      return { userSignals: [], dialogPairs: [] };
    });

    await runBackground(tmpDir);

    expect(callOrder.indexOf('acquireLock')).toBeLessThan(callOrder.indexOf('extractBatch'));
  });

  it('calls runDecisionsAgent with dialog pairs from extractBatchMessages', async () => {
    const dialogPairs = [{ prior: 'prior assistant msg', user: 'user question' }];
    vi.mocked(backgroundRunner.extractBatchMessages).mockResolvedValue({ userSignals: [], dialogPairs });

    await runBackground(tmpDir);

    expect(decisionsAgent.runDecisionsAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        dialogPairs,
        cwd: tmpDir,
      }),
    );
  });

  it('calls process-observations with --types decision,pitfall', async () => {
    await runBackground(tmpDir);

    const processObsCall = _execFileSyncCalls.find(c =>
      c.cmd === 'node' && c.args.includes('process-observations'),
    );
    expect(processObsCall).toBeDefined();
    expect(processObsCall!.args).toContain('--types');
    const typesIdx = processObsCall!.args.indexOf('--types');
    expect(processObsCall!.args[typesIdx + 1]).toBe('decision,pitfall');
  });

  it('calls render-ready with --manifest-path pointing to .decisions-manifest.json', async () => {
    await runBackground(tmpDir);

    const renderReadyCall = _execFileSyncCalls.find(c =>
      c.cmd === 'node' && c.args.includes('render-ready'),
    );
    expect(renderReadyCall).toBeDefined();
    expect(renderReadyCall!.args).toContain('--manifest-path');
    const manifestIdx = renderReadyCall!.args.indexOf('--manifest-path');
    expect(renderReadyCall!.args[manifestIdx + 1]).toContain('.decisions-manifest.json');
  });

  it('calls render-ready with --notifications-path pointing to .decisions-notifications.json', async () => {
    await runBackground(tmpDir);

    const renderReadyCall = _execFileSyncCalls.find(c =>
      c.cmd === 'node' && c.args.includes('render-ready'),
    );
    expect(renderReadyCall).toBeDefined();
    expect(renderReadyCall!.args).toContain('--notifications-path');
    const notifIdx = renderReadyCall!.args.indexOf('--notifications-path');
    expect(renderReadyCall!.args[notifIdx + 1]).toContain('.decisions-notifications.json');
  });

  it('releases lock even when agent throws', async () => {
    vi.mocked(decisionsAgent.runDecisionsAgent).mockRejectedValue(new Error('agent failed'));

    await expect(runBackground(tmpDir)).rejects.toThrow('agent failed');

    expect(backgroundRunner.releaseBackgroundLock).toHaveBeenCalled();
  });

  it('releases lock on successful run', async () => {
    await runBackground(tmpDir);

    expect(backgroundRunner.releaseBackgroundLock).toHaveBeenCalled();
  });

  it('process-observations uses decisions-log.jsonl', async () => {
    await runBackground(tmpDir);

    const processObsCall = _execFileSyncCalls.find(c =>
      c.cmd === 'node' && c.args.includes('process-observations'),
    );
    expect(processObsCall).toBeDefined();
    expect(processObsCall!.args.some((a: string) => a.includes('decisions-log.jsonl'))).toBe(true);
  });

  it('applies temporal decay before running agent', async () => {
    const callOrder: string[] = [];
    vi.mocked(backgroundRunner.applyTemporalDecay).mockImplementation(async () => {
      callOrder.push('decay');
    });
    vi.mocked(decisionsAgent.runDecisionsAgent).mockImplementation(async () => {
      callOrder.push('agent');
      return '/tmp/response.tmp';
    });

    await runBackground(tmpDir);

    expect(callOrder.indexOf('decay')).toBeLessThan(callOrder.indexOf('agent'));
  });

  // Daily cap checking and incrementing is handled by the session-end-decisions hook,
  // not by the CLI --run-background path. Tests for cap logic live in shell-hooks tests.
});

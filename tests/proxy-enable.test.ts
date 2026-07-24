/**
 * Tests for runEnable spawn paths — the TDD anchor for the ARCH-1/REL-1/REL-2/CPLX-2 batch.
 *
 * Tests spawnRelayAndWaitForPort directly via injectable SpawnAndWaitDeps so every
 * relay spawn path is exercised without real processes, sockets, or file I/O:
 *   - adopted=true  — no spawn at all; returns ok:true
 *   - relay never accepts — 50-iteration wait exhausted; returns ok:false (triggers rollback in caller)
 *   - process dies early — isProcessAlive returns false; returns ok:false
 *   - OS-level spawn error (REL-1) — error event fires; returns ok:false without uncaught exception
 *   - port accepts on second probe — returns ok:true
 *   - process dies + port up (EADDRINUSE race adoption) — returns ok:true
 */

import { describe, it, expect, vi } from 'vitest';
import {
  spawnRelayAndWaitForPort,
  type SpawnAndWaitDeps,
  type SpawnRelayResult,
} from '../src/cli/commands/proxy.js';

const PORT = 4141;
const BIN = '/path/to/relay.js';
const CONFIG = '/home/test/.devflow/proxy-routing.json';
const LOG = '/home/test/.devflow/logs/proxy.log';
const PID_PATH = '/home/test/.devflow/proxy.pid';

/** Build a complete passing set of SpawnAndWaitDeps for customisation. */
function makeSpawnDeps(overrides: Partial<SpawnAndWaitDeps> = {}): SpawnAndWaitDeps {
  return {
    openLog: vi.fn().mockResolvedValue({ fd: 99, close: vi.fn().mockResolvedValue(undefined) }),
    spawnProcess: vi.fn().mockImplementation((_opts: unknown) => ({ pid: 1234 })),
    writePid: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined),
    isProcessAlive: vi.fn().mockReturnValue(true),
    tcpConnectable: vi.fn().mockResolvedValue(false), // default: port never accepts
    ...overrides,
  };
}

// Narrow assertion helper so TypeScript narrows the discriminated union.
function assertOk(result: SpawnRelayResult): asserts result is { ok: true } {
  if (!result.ok) throw new Error(`Expected ok:true, got ok:false (reason: ${(result as { ok: false; reason: string }).reason})`);
}
function assertFail(result: SpawnRelayResult): asserts result is { ok: false; reason: string } {
  if (result.ok) throw new Error('Expected ok:false, got ok:true');
}

describe('spawnRelayAndWaitForPort', () => {
  // ─── adopted path ────────────────────────────────────────────────────────────

  it('adopted=true — returns ok:true without calling spawnProcess', async () => {
    const spawnProcess = vi.fn();
    const deps = makeSpawnDeps({ spawnProcess });

    const result = await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, true, deps);

    assertOk(result);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  // ─── relay-never-accepts path ─────────────────────────────────────────────

  it('relay never accepts (50-iteration timeout) — returns ok:false (rollback trigger)', async () => {
    const deps = makeSpawnDeps({
      isProcessAlive: vi.fn().mockReturnValue(true),   // process always alive
      tcpConnectable: vi.fn().mockResolvedValue(false), // port never opens
    });

    const result = await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    assertFail(result);
  });

  it('relay never accepts — openLog was called (log written before wait)', async () => {
    const openLog = vi.fn().mockResolvedValue({ fd: 99, close: vi.fn().mockResolvedValue(undefined) });
    const deps = makeSpawnDeps({ openLog, tcpConnectable: vi.fn().mockResolvedValue(false) });

    await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    expect(openLog).toHaveBeenCalledWith(LOG);
  });

  it('relay never accepts — sleep is called ≤50 times (bounded wait)', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const deps = makeSpawnDeps({ sleep, tcpConnectable: vi.fn().mockResolvedValue(false) });

    await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    expect(sleep.mock.calls.length).toBeLessThanOrEqual(50);
    expect(sleep.mock.calls.length).toBeGreaterThan(0);
  });

  // ─── process-dies path ───────────────────────────────────────────────────

  it('process dies early (isProcessAlive=false) — returns ok:false when port not up', async () => {
    let callCount = 0;
    const deps = makeSpawnDeps({
      isProcessAlive: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount < 2; // alive on call 1, dead on call 2+
      }),
      tcpConnectable: vi.fn().mockResolvedValue(false), // port not up after death
    });

    const result = await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    assertFail(result);
  });

  it('process dies and port is up (EADDRINUSE race) — returns ok:true', async () => {
    let aliveCallCount = 0;
    const deps = makeSpawnDeps({
      isProcessAlive: vi.fn().mockImplementation(() => {
        aliveCallCount++;
        return aliveCallCount < 2; // dead on 2nd check
      }),
      tcpConnectable: vi.fn().mockResolvedValue(true), // port owned by race-winner
    });

    const result = await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    assertOk(result);
  });

  // ─── OS-level error event (REL-1) ────────────────────────────────────────

  it('OS-level spawn error (EMFILE) — returns ok:false without uncaught exception', async () => {
    const deps = makeSpawnDeps({
      spawnProcess: vi.fn().mockImplementation(({ onError }: { onError: (err: Error) => void }) => {
        // Synchronously fire the error event (simulates immediate OS rejection)
        onError(new Error('EMFILE: too many open files'));
        return { pid: 1234 };
      }),
      tcpConnectable: vi.fn().mockResolvedValue(false),
    });

    // Must not throw — the missing error handler (pre-fix) would have caused an uncaught exception
    const result = await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    assertFail(result);
  });

  it('OS-level spawn error — terminates the wait loop early (sleeps fewer times)', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const deps = makeSpawnDeps({
      spawnProcess: vi.fn().mockImplementation(({ onError }: { onError: (err: Error) => void }) => {
        onError(new Error('ENOMEM'));
        return { pid: undefined };
      }),
      sleep,
      tcpConnectable: vi.fn().mockResolvedValue(false),
    });

    await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    // With the error set synchronously, the loop should break on the first iteration
    expect(sleep.mock.calls.length).toBeLessThan(50);
  });

  // ─── port-accepts path ───────────────────────────────────────────────────

  it('port accepts on second probe — returns ok:true', async () => {
    let probeCount = 0;
    const deps = makeSpawnDeps({
      isProcessAlive: vi.fn().mockReturnValue(true),
      tcpConnectable: vi.fn().mockImplementation(async () => {
        probeCount++;
        return probeCount >= 2; // accepts on 2nd probe
      }),
    });

    const result = await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    assertOk(result);
  });

  it('port accepts on first probe — returns ok:true immediately', async () => {
    const deps = makeSpawnDeps({
      isProcessAlive: vi.fn().mockReturnValue(true),
      tcpConnectable: vi.fn().mockResolvedValue(true), // immediately accepts
    });

    const result = await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    assertOk(result);
  });

  // ─── pid write ───────────────────────────────────────────────────────────

  it('writes pid when process has a pid', async () => {
    const writePid = vi.fn().mockResolvedValue(undefined);
    const deps = makeSpawnDeps({
      writePid,
      spawnProcess: vi.fn().mockImplementation(() => ({ pid: 5678 })),
      tcpConnectable: vi.fn().mockResolvedValue(true), // immediately accepts
    });

    await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    expect(writePid).toHaveBeenCalledWith(PID_PATH, 5678);
  });

  it('skips pid write when spawnProcess returns no pid', async () => {
    const writePid = vi.fn().mockResolvedValue(undefined);
    const deps = makeSpawnDeps({
      writePid,
      spawnProcess: vi.fn().mockImplementation(() => ({ pid: undefined })),
      tcpConnectable: vi.fn().mockResolvedValue(true),
    });

    await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    expect(writePid).not.toHaveBeenCalled();
  });
});

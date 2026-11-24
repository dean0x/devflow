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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as proxyState from '../src/core/proxy-state.js';
import * as modelDiscovery from '../src/core/model-discovery.js';
import {
  proxyCommand,
  spawnRelayAndWaitForPort,
  type SpawnAndWaitDeps,
  type SpawnRelayResult,
} from '../src/cli/commands/proxy.js';

const PORT = 49152;
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

describe.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('proxy --enable with an installed relay', () => {
  let home: string;
  const originalExitCode = process.exitCode;

  afterEach(async () => {
    process.exitCode = originalExitCode;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(home, { recursive: true, force: true });
  });

  async function enableWithRelay(
    version: string,
    mode: 'success' | 'detach_fails' | 'no_listener' | 'late' | 'doctor_fails' = 'success',
    reportedPid?: string,
  ) {
    home = await fs.mkdtemp(path.join(tmpdir(), 'proxy-enable-'));
    const machineDir = path.join(home, '.devflow');
    const configDir = path.join(home, 'client-config');
    const binPath = path.join(home, 'fake-relay.cjs');
    const callPath = path.join(home, 'serve.json');
    const logPath = path.join(machineDir, 'logs', 'proxy.log');
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.mkdir(configDir);
    await fs.mkdir(path.join(home, '.codex'));
    await fs.writeFile(path.join(configDir, 'settings.json'), '{}');
    await fs.writeFile(path.join(home, '.codex', 'auth.json'), '{}');
    await fs.writeFile(logPath, 'original log\n');
    vi.stubEnv('HOME', home);
    vi.stubEnv('CLAUDE_CONFIG_DIR', configDir);
    vi.stubEnv('NODE_OPTIONS', '--trace-warnings');
    vi.spyOn(proxyState, 'resolveProxyBin').mockResolvedValue({ ok: true, value: { binPath, npxWarning: false } });
    vi.spyOn(modelDiscovery, 'discoverExternalModels').mockRejectedValue(new Error('no model catalog in this fixture'));

    const listener = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', () => {
        const address = listener.address();
        listener.close((error) => {
          if (error || !address || typeof address === 'string') reject(error ?? new Error('no free port'));
          else resolve(address.port);
        });
      });
    });
    const readyPath = path.join(home, 'ready');
    const finishedPath = path.join(home, 'launcher-finished');
    await fs.writeFile(binPath, `
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      const mode = ${JSON.stringify(mode)};
      const readyPath = ${JSON.stringify(readyPath)};
      if (args[0] === '--version') return console.log(${JSON.stringify(version)});
      if (args[0] === 'doctor') { process.exitCode = mode === 'doctor_fails' ? 1 : 0; return; }
      if (args[0] === 'serve') {
        fs.writeFileSync(${JSON.stringify(callPath)}, JSON.stringify({ args, cwd: process.cwd(), pid: process.pid,
          config: process.env.SUBSWITCH_CONFIG, nodeOptions: process.env.NODE_OPTIONS ?? null }));
        if (!args.includes('--detach')) console.log('legacy start output');
        else {
          if (mode === 'detach_fails') { process.exitCode = 1; return; }
          if (mode === 'no_listener') return;
          if (mode === 'late') {
            setTimeout(() => fs.writeFileSync(${JSON.stringify(finishedPath)}, ''), 2500);
            return;
          }
          const child = require('node:child_process').spawn(process.execPath, [__filename, 'listen'], {
            detached: true, stdio: ['ignore', 'ignore', 'ignore'],
          });
          child.unref();
          let attempts = 0;
          const wait = setInterval(() => {
            const ready = fs.existsSync(readyPath);
            if (!ready && ++attempts < 200) return;
            clearInterval(wait);
            if (!ready) { process.exitCode = 1; return; }
            const printedPid = ${JSON.stringify(reportedPid)} ?? String(child.pid);
            if (printedPid) console.log(printedPid);
          }, 10);
          console.error('launch diagnostic');
          return;
        }
      }
      require('node:net').createServer((socket) => socket.end())
        .listen(${port}, '127.0.0.1', () => fs.writeFileSync(readyPath, String(process.pid)));
      setTimeout(() => process.exit(), 10000);
    `);
    const enable = proxyCommand.parseAsync(['--enable', '--port', String(port)], { from: 'user' });
    if (mode === 'late') {
      await vi.waitFor(() => expect(existsSync(callPath)).toBe(true));
      await vi.advanceTimersByTimeAsync(12_000);
    }
    await enable;
    const call = JSON.parse(await fs.readFile(callPath, 'utf-8'));
    const log = await fs.readFile(logPath, 'utf-8');
    const pid = await fs.readFile(path.join(machineDir, 'proxy.pid'), 'utf-8').catch(() => '');
    return { machineDir, port, call, log, pid, finishedPath };
  }

  it.each(['relay v0.9.0', '0.10.0', '1.0.0'])('starts with detach for version %s and records the relay PID', async (version) => {
    const { machineDir, port, call, log, pid } = await enableWithRelay(version);
    expect(call).toMatchObject({
      args: ['serve', '--detach', '--port', String(port)], cwd: await fs.realpath(machineDir),
      config: path.join(machineDir, 'proxy-routing.json'), nodeOptions: null,
    });
    expect(pid).toMatch(/^[1-9][0-9]*$/);
    expect(pid).not.toBe(String(call.pid));
    expect(log).toBe('original log\n');
    expect(process.exitCode).toBe(originalExitCode);
  });

  it.each(['0.8.0', '0.8.9', 'unparseable', ''])('keeps the legacy start for version %j', async (version) => {
    const { machineDir, call, log, pid } = await enableWithRelay(version);
    expect(call.args).toEqual(['serve']);
    expect(call.cwd).not.toBe(machineDir);
    expect(pid).toBe(String(call.pid));
    expect(log).toBe('original log\nlegacy start output\n');
    expect(process.exitCode).toBe(originalExitCode);
  });

  it('fails enable and restores disabled state when detach fails', async () => {
    const { machineDir, log, pid } = await enableWithRelay('1.0.0', 'detach_fails');
    expect(process.exitCode).toBe(1);
    expect(await proxyState.readProxyState(machineDir)).toMatchObject({ ok: true, value: { enabled: false } });
    expect(pid).toBe('');
    expect(log).toBe('original log\n');
  });

  it.each([['nonnumeric PID', 'not-a-pid'], ['empty stdout', '']])(
    'enables a ready relay without a PID file for %s', async (_label, reportedPid) => {
      const { pid } = await enableWithRelay('0.9.0', 'success', reportedPid);
      expect(process.exitCode).toBe(originalExitCode);
      expect(pid).toBe('');
    },
  );

  it('restores disabled state if detach exits 0 but the port stays down', async () => {
    const { machineDir } = await enableWithRelay('0.9.0', 'no_listener');
    expect(process.exitCode).toBe(1);
    expect(await proxyState.readProxyState(machineDir)).toMatchObject({ ok: true, value: { enabled: false } });
  });

  it('stops the launcher at its deadline and restores disabled state', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { machineDir, call, finishedPath } = await enableWithRelay('0.9.0', 'late');
    expect(process.exitCode).toBe(1);
    expect(await proxyState.readProxyState(machineDir)).toMatchObject({ ok: true, value: { enabled: false } });
    await vi.waitFor(() => expect(() => process.kill(call.pid, 0)).toThrow(/ESRCH/));
    expect(existsSync(finishedPath)).toBe(false);
  });

  it('does not stop the PID from detach if doctor fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const { machineDir, pid } = await enableWithRelay('0.9.0', 'doctor_fails');
    expect(process.exitCode).toBe(1);
    expect(await proxyState.readProxyState(machineDir)).toMatchObject({ ok: true, value: { enabled: false } });
    expect(pid).toMatch(/^[1-9][0-9]*$/);
    expect(kill).not.toHaveBeenCalledWith(Number(pid), 'SIGTERM');
  });
});

describe('spawnRelayAndWaitForPort', () => {
  // ─── adopted path ────────────────────────────────────────────────────────────

  it('adopted=true — returns ok:true without calling spawnProcess', async () => {
    const spawnProcess = vi.fn();
    const deps = makeSpawnDeps({ spawnProcess });

    const result = await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, true, deps);

    assertOk(result);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('adopted=true — spawnedPid is absent (no relay was spawned by us)', async () => {
    const deps = makeSpawnDeps();
    const result = await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, true, deps);
    assertOk(result);
    expect(result.spawnedPid).toBeUndefined();
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

  it('self-spawned success — spawnedPid matches pid returned by spawnProcess', async () => {
    const deps = makeSpawnDeps({
      spawnProcess: vi.fn().mockImplementation(() => ({ pid: 9999 })),
      isProcessAlive: vi.fn().mockReturnValue(true),
      tcpConnectable: vi.fn().mockResolvedValue(true),
    });

    const result = await spawnRelayAndWaitForPort(PORT, BIN, CONFIG, LOG, PID_PATH, false, deps);

    assertOk(result);
    expect(result.spawnedPid).toBe(9999);
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

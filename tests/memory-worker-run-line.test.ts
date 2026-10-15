/**
 * The memory worker writes exactly one `Run:` line per run, from the worker process only.
 *
 * The worker starts subshells (the probe's watchdog, the claude spawn, the main watchdog)
 * while its exit trap is set. A subshell that a SIGTERM reaches before it has reset the
 * trap runs that trap, which writes a second `Run:` line. The worker cancels such a
 * subshell with SIGKILL, which runs no trap. The race depends on scheduling, so the first
 * test pins the rule in the source and the second runs many workers at once.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const WORKER = path.resolve(__dirname, '../src/assets/scripts/hooks/background-memory-update');

describe('the memory worker writes one Run line per run', () => {
  it('cancels every subshell it started with SIGKILL, and signals a process group only from a watchdog', () => {
    const code = fs.readFileSync(WORKER, 'utf-8')
      .split('\n')
      .filter(line => !/^\s*#/.test(line));
    const kills = code.filter(line => /(^|[;&|(]\s*|\s)kill\s/.test(line));

    expect(kills.length, 'the worker has kill calls to check').toBeGreaterThan(0);
    const single = kills.filter(line => !/kill\s+-[A-Z]+\s+-"/.test(line));
    for (const line of single) {
      expect(line, 'a kill of one subshell uses SIGKILL').toMatch(/kill\s+-KILL\s+"\$[A-Za-z_]+"/);
    }
  });

  /** One worker run in a fresh project, home and fake claude; resolves to the Run lines it wrote. */
  function runOnce(withFolderAtStagedPath: boolean): Promise<string[]> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-runline-'));
    const project = path.join(root, 'project');
    const home = path.join(root, 'home');
    const shim = path.join(root, 'shim');
    const memory = path.join(project, '.devflow', 'memory');
    const staged = path.join(memory, 'WORKING-MEMORY.md.new');
    fs.mkdirSync(memory, { recursive: true });
    fs.mkdirSync(home);
    fs.mkdirSync(shim);
    const ts = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      path.join(memory, '.pending-turns.jsonl'),
      `${JSON.stringify({ role: 'user', content: 'a', ts })}\n${JSON.stringify({ role: 'assistant', content: 'b', ts: ts + 1 })}\n`,
    );
    if (withFolderAtStagedPath) {
      fs.mkdirSync(path.join(staged, 'a', 'b'), { recursive: true });
      fs.writeFileSync(path.join(staged, 'inside'), 'x');
    }
    fs.writeFileSync(
      path.join(shim, 'claude'),
      [
        '#!/bin/bash',
        'if [ "${1:-}" = "--version" ]; then echo "2.1.293 (Claude Code)"; exit 0; fi',
        'cat >/dev/null',
        `echo '<!-- memory-head: testsha branch: main -->' > '${staged}'`,
        `echo '## Now' >> '${staged}'`,
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    return new Promise((resolve, reject) => {
      const child = spawn('bash', [WORKER, project], {
        env: { ...process.env, HOME: home, PATH: `${shim}:${process.env.PATH ?? '/usr/bin:/bin'}` },
        stdio: 'ignore',
      });
      child.on('error', reject);
      child.on('close', () => {
        try {
          const logs = path.join(home, '.devflow', 'logs');
          const lines = fs.readdirSync(logs).flatMap(slug =>
            fs.readFileSync(path.join(logs, slug, '.background-memory-update.log'), 'utf-8').split('\n'));
          resolve(lines.filter(line => line.includes('] Run: ')));
        } catch (e) {
          reject(e);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      });
    });
  }

  it('writes one Run line in each of many workers that run at once', async () => {
    const total = 64;
    const width = 8;
    const wrong: string[] = [];
    let next = 0;
    const lane = async (): Promise<void> => {
      while (next < total) {
        const i = next++;
        const lines = await runOnce(i % 2 === 0);
        if (lines.length !== 1) wrong.push(`run ${i}: ${lines.length} Run lines:\n${lines.join('\n')}`);
      }
    };
    await Promise.all(Array.from({ length: width }, lane));

    expect(wrong, 'every run wrote exactly one Run line').toEqual([]);
  }, 180000);
});

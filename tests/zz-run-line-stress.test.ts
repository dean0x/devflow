// TEMPORARY diagnostic: run the worker many times at once and print the trace of any run
// that writes more than one Run line.
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOOK = path.resolve(__dirname, '../src/assets/scripts/hooks/background-memory-update');

function oneRun(withFolder: boolean, trace: boolean): Promise<string | null> {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zzs-'));
  const P = path.join(d, 'p'); const H = path.join(d, 'h'); const SH = path.join(d, 's');
  const mem = path.join(P, '.devflow', 'memory');
  fs.mkdirSync(mem, { recursive: true }); fs.mkdirSync(path.join(P, '.devflow', 'dream')); fs.mkdirSync(H); fs.mkdirSync(SH);
  const ts = Math.floor(Date.now() / 1000);
  fs.writeFileSync(path.join(mem, '.pending-turns.jsonl'),
    `{"role":"user","content":"a","ts":${ts}}\n{"role":"assistant","content":"b","ts":${ts + 1}}\n`);
  if (withFolder) {
    fs.mkdirSync(path.join(mem, 'WORKING-MEMORY.md.new', 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(mem, 'WORKING-MEMORY.md.new', 'inside'), 'x');
  }
  const staged = path.join(mem, 'WORKING-MEMORY.md.new');
  fs.writeFileSync(path.join(SH, 'claude'), [
    '#!/bin/bash',
    'if [ "${1:-}" = "--version" ]; then echo "2.1.293 (Claude Code)"; exit 0; fi',
    'cat >/dev/null',
    `echo '<!-- memory-head: testsha branch: main -->' > '${staged}'`,
    `echo '## Now' >> '${staged}'`,
    'exit 0', ''].join('\n'), { mode: 0o755 });
  const traceFile = path.join(d, 'trace.txt');
  const args = trace ? ['-x', HOOK, P] : [HOOK, P];
  return new Promise((resolve) => {
    const err = fs.openSync(traceFile, 'w');
    const child = spawn('bash', args, {
      env: { ...process.env, HOME: H, PATH: `${SH}:${process.env.PATH}`, PS4: '+[${BASHPID:-$$}:${LINENO}] ' },
      stdio: ['ignore', 'ignore', err],
    });
    child.on('close', () => {
      fs.closeSync(err);
      const logs = path.join(H, '.devflow', 'logs');
      let msg: string | null = null;
      try {
        const slug = fs.readdirSync(logs)[0];
        const log = fs.readFileSync(path.join(logs, slug, '.background-memory-update.log'), 'utf-8');
        const n = log.split('\n').filter(l => l.includes('] Run: ')).length;
        if (n !== 1) {
          const tr = fs.readFileSync(traceFile, 'utf-8').split('\n');
          const idx = tr.map((l, i) => (l.includes('finish_run') ? i : -1)).filter(i => i >= 0);
          const keep = new Set<number>();
          for (const i of idx) for (let k = Math.max(0, i - 6); k < Math.min(tr.length, i + 14); k++) keep.add(k);
          msg = `runs=${n} trace=${trace}\nLOG:\n${log}\nTRACE (finish_run windows):\n${[...keep].sort((a, b) => a - b).map(i => tr[i]).join('\n')}`;
        }
      } catch (e) { msg = `harness error ${String(e)}`; }
      fs.rmSync(d, { recursive: true, force: true });
      resolve(msg);
    });
  });
}

describe('zz run-line stress', () => {
  it('many concurrent workers write one Run line each', async () => {
    const bad: string[] = [];
    const total = 240; const width = 8; let next = 0;
    const lane = async (): Promise<void> => {
      while (next < total) {
        const i = next++;
        const m = await oneRun(i % 2 === 0, i % 3 === 0);
        if (m) bad.push(`#${i} ${m}`);
      }
    };
    await Promise.all(Array.from({ length: width }, lane));
    expect(bad.length, bad.slice(0, 2).join('\n=====\n')).toBe(0);
  }, 280000);
});

/**
 * The built CLI (`node dist/cli.js`) against a temp HOME, as a subprocess.
 *
 * tests/agents-set-e2e.test.ts drives the same command in process. This file
 * adds what only the built binary can show: the real argument parsing and exit
 * codes, and `devflow init`'s reapply with an agents.memory entry on disk
 * (D-WORKER-AGENTS), plus the installed bytes at shipped defaults
 * (D-SHIPPED-EFFORT): no agent gains an `effort:` line, and a Validate entry
 * beside a memory entry changes nothing for any other agent.
 *
 * Every spawn gets a sandboxed HOME from sandboxEnv (it refuses a real home).
 * Requires a build: `npm run build` first.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { readFrontmatterEffort, readFrontmatterModel } from '../src/core/agent-frontmatter.js';
import { getAllAgentNames } from '../src/core/plugins.js';
import { requireBuiltCli, resolveAgentSource, sandboxEnv } from './helpers.js';

const CLI = requireBuiltCli();
const SPAWN_TIMEOUT_MS = 120_000;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

describe('devflow agents and init (built CLI, temp HOME)', () => {
  const homes: string[] = [];

  async function freshHome(): Promise<string> {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-agents-sub-'));
    homes.push(home);
    // `devflow init` refuses a machine without a Claude Code directory.
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    await fs.writeFile(path.join(home, '.claude', 'settings.json'), '{}\n', 'utf-8');
    return home;
  }

  afterEach(async () => {
    for (const home of homes.splice(0)) await fs.rm(home, { recursive: true, force: true });
  });

  const cli = (home: string, ...args: string[]): Run => {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: os.tmpdir(),
      encoding: 'utf-8',
      timeout: SPAWN_TIMEOUT_MS,
      env: sandboxEnv(home),
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };

  const init = (home: string): Run =>
    cli(home, 'init', '--recommended', '--no-ambient', '--no-memory', '--no-learning', '--no-knowledge', '--no-rules');

  const mappingFile = (home: string): string => path.join(home, '.devflow', 'agent-models.json');
  const installedAgentsDir = (home: string): string => path.join(home, '.claude', 'agents', 'devflow');

  async function writeMapping(home: string, agents: unknown): Promise<void> {
    await fs.mkdir(path.join(home, '.devflow'), { recursive: true });
    await fs.writeFile(mappingFile(home), JSON.stringify({ version: 1, agents }), 'utf-8');
  }

  describe('devflow agents', () => {
    let home: string;
    beforeEach(async () => { home = await freshHome(); });

    it('--set code --effort inherit stores "effort": "inherit"', async () => {
      const result = cli(home, 'agents', '--set', 'code', '--effort', 'inherit');

      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(await fs.readFile(mappingFile(home), 'utf-8'))).toEqual({
        version: 1,
        agents: { code: { effort: 'inherit' } },
      });
    });

    it('--list prints the memory worker row after the agents', () => {
      const result = cli(home, 'agents', '--list');

      expect(result.status, result.stderr).toBe(0);
      const lines = result.stdout.split('\n');
      const memoryAt = lines.findIndex(l => l.startsWith('memory'));
      expect(memoryAt).toBeGreaterThan(0);
      expect(lines[memoryAt]).toMatch(/^memory\s+claude-sonnet-5-5\s+default\s+default \(high\)\s+worker$/);
      expect(lines.slice(memoryAt + 1).filter(l => l.startsWith('memory'))).toEqual([]);
    });

    it('--set memory --model sonnet --effort medium persists, and --reset --yes removes it', async () => {
      expect(cli(home, 'agents', '--set', 'memory', '--model', 'sonnet', '--effort', 'medium').status).toBe(0);
      expect(JSON.parse(await fs.readFile(mappingFile(home), 'utf-8')).agents.memory).toEqual({
        model: 'sonnet',
        effort: 'medium',
      });

      expect(cli(home, 'agents', '--reset', '--yes').status).toBe(0);
      expect(JSON.parse(await fs.readFile(mappingFile(home), 'utf-8')).agents.memory).toBeUndefined();
    });

    it.each([
      ['an external model', ['--model', 'gpt-5']],
      ['inherit as the effort', ['--effort', 'inherit']],
    ])('--set memory with %s exits 1 and leaves agent-models.json byte-identical', async (_label, flags) => {
      await writeMapping(home, { memory: { model: 'haiku' } });
      const before = await fs.readFile(mappingFile(home), 'utf-8');

      const result = cli(home, 'agents', '--set', 'memory', ...flags);

      expect(result.status).toBe(1);
      expect(await fs.readFile(mappingFile(home), 'utf-8')).toBe(before);
    });

    it('--set memory --model claude-sonnet-4-6 is accepted', async () => {
      expect(cli(home, 'agents', '--set', 'memory', '--model', 'claude-sonnet-4-6').status).toBe(0);
    });
  });

  describe('devflow init at shipped defaults', () => {
    it('installs every agent at its shipped model with no effort line, and an agents.memory + validate mapping changes no other agent', async () => {
      const bare = await freshHome();
      const mapped = await freshHome();
      await writeMapping(mapped, {
        validate: { model: 'haiku' },
        memory: { model: 'sonnet', effort: 'medium' },
      });

      const bareRun = init(bare);
      const mappedRun = init(mapped);
      expect(bareRun.status, bareRun.stdout + bareRun.stderr).toBe(0);
      expect(mappedRun.status, mappedRun.stdout + mappedRun.stderr).toBe(0);

      for (const name of getAllAgentNames()) {
        const installed = await fs.readFile(path.join(installedAgentsDir(bare), `${name}.md`), 'utf-8');
        const source = resolveAgentSource(name).content;
        const model = readFrontmatterModel(installed);
        expect(model.ok && model.value, `${name}: installed model differs from its shipped source`)
          .toBe((readFrontmatterModel(source) as { value: string }).value);
        const effort = readFrontmatterEffort(installed);
        expect(effort.ok && effort.value, `${name} gained an effort line`).toBe('');

        const withMapping = await fs.readFile(path.join(installedAgentsDir(mapped), `${name}.md`), 'utf-8');
        expect(withMapping, `${name}: a validate + memory mapping changed the installed bytes`).toBe(installed);
      }
    }, 300_000);

    it('a following init creates or rewrites no memory.md', async () => {
      const home = await freshHome();
      await writeMapping(home, { memory: { model: 'sonnet', effort: 'medium' } });

      expect(init(home).status).toBe(0);
      expect(init(home).status).toBe(0);

      const installed = await fs.readdir(installedAgentsDir(home));
      expect(installed).not.toContain('memory.md');
      expect(JSON.parse(await fs.readFile(mappingFile(home), 'utf-8')).agents.memory).toEqual({
        model: 'sonnet',
        effort: 'medium',
      });
    }, 300_000);
  });
});

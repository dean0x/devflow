/**
 * `devflow agents` end to end, in process, against a temp HOME.
 *
 * Drives the real commander command (argument parsing, validation, persistence,
 * reapply, rendering) rather than its pure helpers, so the wiring is covered:
 *   - D-SHIPPED-EFFORT: `--set <agent> --effort inherit|default`
 *   - D-WORKER-AGENTS:  `--set memory`, `--list` and `--reset` with a worker entry
 *
 * HOME and CLAUDE_CONFIG_DIR are pointed at a fresh temp directory before the
 * command module is imported, so nothing here can reach the real ~/.devflow or
 * ~/.claude. Commander keeps parsed option values on the Command instance, so
 * every run imports a fresh module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readAgentMapping } from '../src/core/agent-models.js';
import { stripAnsi } from '../src/hud/colors.js';

interface RunResult {
  /** Everything the command wrote to stdout, clack log lines included. */
  out: string;
  exitCode: number | string | null | undefined;
}

describe('devflow agents (in process, temp HOME)', () => {
  let home: string;
  let devflowDir: string;
  let mappingFile: string;
  let installDir: string;
  let savedHome: string | undefined;
  let savedClaudeConfig: string | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-agents-e2e-'));
    devflowDir = path.join(home, '.devflow');
    mappingFile = path.join(devflowDir, 'agent-models.json');
    installDir = path.join(home, '.claude', 'agents', 'devflow');
    await fs.mkdir(devflowDir, { recursive: true });
    await fs.mkdir(installDir, { recursive: true });
    savedHome = process.env.HOME;
    savedClaudeConfig = process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = home;
    process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.exitCode = undefined;
    if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
    if (savedClaudeConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedClaudeConfig;
    vi.restoreAllMocks();
    await fs.rm(home, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<RunResult> {
    expect(process.env.HOME, 'the command must never run against the real HOME').toBe(home);
    vi.resetModules();
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    try {
      const { agentsCommand } = await import('../src/cli/commands/agents.js');
      await agentsCommand.parseAsync(['node', 'agents', ...args]);
    } finally {
      vi.restoreAllMocks();
    }
    const exitCode = process.exitCode;
    process.exitCode = undefined;
    return { out: stripAnsi(chunks.join('')), exitCode };
  }

  const readMapping = async (): Promise<unknown> => JSON.parse(await fs.readFile(mappingFile, 'utf-8'));

  // -------------------------------------------------------------------------
  // D-SHIPPED-EFFORT
  // -------------------------------------------------------------------------

  describe('--effort inherit', () => {
    it('stores "effort": "inherit" under agents.code, and it reads back with no warning', async () => {
      const result = await run('--set', 'code', '--effort', 'inherit');

      expect(result.exitCode).toBeUndefined();
      expect(await readMapping()).toEqual({ version: 1, agents: { code: { effort: 'inherit' } } });
      const warnings: string[] = [];
      const read = await readAgentMapping(devflowDir, { onWarning: (m) => warnings.push(m) });
      expect(read.ok && read.value.agents['code']?.effort).toBe('inherit');
      expect(warnings).toEqual([]);
    });

    it('--effort default deletes the key', async () => {
      await run('--set', 'code', '--effort', 'inherit');

      await run('--set', 'code', '--effort', 'default');

      const mapping = await readMapping() as { agents: Record<string, { effort?: string }> };
      expect(mapping.agents['code']?.effort).toBeUndefined();
    });

    it('--set code --effort turbo is rejected and leaves the file unchanged', async () => {
      await run('--set', 'code', '--effort', 'inherit');
      const before = await fs.readFile(mappingFile, 'utf-8');

      const result = await run('--set', 'code', '--effort', 'turbo');

      expect(result.exitCode).toBe(1);
      expect(result.out).toContain('inherit');
      expect(await fs.readFile(mappingFile, 'utf-8')).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // D-WORKER-AGENTS
  // -------------------------------------------------------------------------

  describe('the memory worker', () => {
    it('--list prints a memory row after the agent rows: haiku, default (high), worker', async () => {
      const result = await run('--list');

      const lines = result.out.split('\n');
      const memoryAt = lines.findIndex(l => l.startsWith('memory'));
      expect(memoryAt, `no memory row in:\n${result.out}`).toBeGreaterThan(0);
      expect(lines[memoryAt]).toMatch(/^memory\s+haiku\s+default\s+default \(high\)\s+worker$/);
      const agentRows = lines.slice(1, memoryAt).filter(l => l.trim() !== '');
      expect(agentRows.length, 'agent rows must precede the worker row').toBeGreaterThan(10);
      expect(agentRows.some(l => l.startsWith('memory'))).toBe(false);
    });

    it('--list footer totals are the same with and without an agents.memory entry', async () => {
      const footer = (out: string): string => out.split('\n').find(l => / installed · /.test(l)) ?? '';
      const bare = footer((await run('--list')).out);

      await run('--set', 'memory', '--model', 'sonnet', '--effort', 'medium');
      const configured = footer((await run('--list')).out);

      expect(bare).toMatch(/^\d+\/\d+ installed · 0 configured/);
      expect(configured).toBe(bare);
    });

    it('--set memory --model sonnet --effort medium persists agents.memory and writes no memory.md', async () => {
      const result = await run('--set', 'memory', '--model', 'sonnet', '--effort', 'medium');

      expect(result.exitCode).toBeUndefined();
      expect(await readMapping()).toEqual({
        version: 1,
        agents: { memory: { model: 'sonnet', effort: 'medium' } },
      });
      expect(await fs.readdir(installDir), 'a worker has no installed agent file').toEqual([]);
    });

    it('--list shows the configured worker values', async () => {
      await run('--set', 'memory', '--model', 'sonnet', '--effort', 'medium');

      const line = (await run('--list')).out.split('\n').find(l => l.startsWith('memory'));

      expect(line).toMatch(/^memory\s+haiku\s+sonnet\s+medium\s+worker$/);
    });

    it('--reset --yes removes agents.memory', async () => {
      await run('--set', 'memory', '--model', 'sonnet');

      const result = await run('--reset', '--yes');

      expect(result.exitCode).toBeUndefined();
      expect(await readMapping()).toEqual({ version: 1, agents: {} });
    });

    it('--set memory --model claude-sonnet-4-6 is accepted', async () => {
      const result = await run('--set', 'memory', '--model', 'claude-sonnet-4-6');

      expect(result.exitCode).toBeUndefined();
      expect(await readMapping()).toEqual({ version: 1, agents: { memory: { model: 'claude-sonnet-4-6' } } });
    });

    it.each([
      ['an external model', ['--model', 'gpt-5']],
      ['inherit as the effort', ['--effort', 'inherit']],
      ['inherit as the model', ['--model', 'inherit']],
    ])('--set memory with %s exits 1 and leaves agent-models.json byte-identical', async (_label, flags) => {
      await run('--set', 'memory', '--model', 'haiku');
      const before = await fs.readFile(mappingFile, 'utf-8');

      const result = await run('--set', 'memory', ...flags);

      expect(result.exitCode).toBe(1);
      expect(await fs.readFile(mappingFile, 'utf-8')).toBe(before);
    });

    it('a rejected first --set memory creates no agent-models.json', async () => {
      const result = await run('--set', 'memory', '--model', 'gpt-5');

      expect(result.exitCode).toBe(1);
      await expect(fs.access(mappingFile)).rejects.toThrow();
    });

    it('a hand-edited agents.memory.model of gpt-5 is dropped with a warning on read', async () => {
      await fs.writeFile(mappingFile, JSON.stringify({ version: 1, agents: { memory: { model: 'gpt-5' } } }), 'utf-8');

      const result = await run('--list');

      expect(result.out).toContain('gpt-5');
      expect(result.out).toMatch(/dropping out-of-domain model "gpt-5" for worker "memory"/);
      const line = result.out.split('\n').find(l => l.startsWith('memory'));
      expect(line).toMatch(/^memory\s+haiku\s+default\s/);
    });

    it('an unknown agent name is still rejected', async () => {
      const result = await run('--set', 'no-such-agent', '--model', 'sonnet');

      expect(result.exitCode).toBe(1);
      expect(result.out).toContain('memory');
    });
  });
});

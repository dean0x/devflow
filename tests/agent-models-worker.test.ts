/**
 * Tests for the worker half of src/core/agent-models.ts (D-WORKER-AGENTS) and
 * the `inherit` effort sentinel on the read side (D-SHIPPED-EFFORT).
 *
 * A worker is a background process that runs outside a Claude Code session and
 * has no installed agent file. `memory` is the only one. Its settings live in
 * the same agent-models.json map as agent entries, so every agent-only path
 * (the reapply walk, the init gate, the external-model count) has to leave
 * worker keys alone.
 *
 * Protocol: RED -> GREEN -> REFACTOR.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  WORKER_AGENTS,
  isWorkerAgent,
  validateWorkerValue,
  agentOnlyMapping,
  hasAgentMappingEntries,
  countExternalMappedAgents,
  readAgentMapping,
  reapplyAgentMapping,
  saveAgentMapping,
  type AgentMappingFile,
} from '../src/core/agent-models.js';
import { readFrontmatterEffort } from '../src/core/agent-frontmatter.js';
import { CLAUDE_MODEL_ALIASES } from '../src/core/external-models.js';
import { DEVFLOW_PLUGINS, getAllAgentNames } from '../src/core/plugins.js';
import { loadFile, resolveAgentSource } from './helpers.js';
import { AGENT_CONFIG } from './fixtures/agent-config.js';

const file = (agents: AgentMappingFile['agents']): AgentMappingFile => ({ version: 1, agents });

// ---------------------------------------------------------------------------
// WORKER_AGENTS / isWorkerAgent
// ---------------------------------------------------------------------------

describe('WORKER_AGENTS', () => {
  it('declares exactly the memory worker, shipping claude-sonnet-5-5 at high effort', () => {
    expect(WORKER_AGENTS).toEqual({ memory: { model: 'claude-sonnet-5-5', effort: 'high' } });
  });

  it('ships a model and an effort that the worker value domain accepts', () => {
    for (const [name, shipped] of Object.entries(WORKER_AGENTS)) {
      expect(validateWorkerValue('model', shipped.model).ok, `${name} model`).toBe(true);
      expect(validateWorkerValue('effort', shipped.effort).ok, `${name} effort`).toBe(true);
    }
  });

  it('isWorkerAgent is true for a worker key and false for everything else', () => {
    expect(isWorkerAgent('memory')).toBe(true);
    expect(isWorkerAgent('code')).toBe(false);
    expect(isWorkerAgent('tracker')).toBe(false);
    expect(isWorkerAgent('')).toBe(false);
  });

  it('isWorkerAgent never answers from the prototype chain', () => {
    for (const hostile of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(isWorkerAgent(hostile), hostile).toBe(false);
    }
  });

  it('memory is not an agent: the roster and every plugin declaration are unchanged', () => {
    expect(getAllAgentNames()).not.toContain('memory');
    for (const plugin of DEVFLOW_PLUGINS) {
      expect(plugin.agents, `plugin ${plugin.name} declares the memory worker as an agent`).not.toContain('memory');
    }
  });
});

// ---------------------------------------------------------------------------
// Runtime parity — the hook's model literal and the shipped worker row are one value
// ---------------------------------------------------------------------------

/**
 * The model literals background-memory-update hard-codes: the `--model` argument
 * of its `claude -p` spawn and the model named in its spawn log line.
 *
 * The worker does not read agents.memory yet, so the shipped row and the hook
 * agree only by being written to agree; this collector is what lets a test hold
 * them to it. Pure function over the hook text.
 */
function collectMemoryHookModels(hookSource: string): { flag: string[]; log: string[] } {
  const flag = [...hookSource.matchAll(/^[ \t]*--model[ \t]+([^\s\\]+)/gm)].map(m => m[1]);
  const log = [...hookSource.matchAll(/Spawning claude -p \(model ([^,)\s]+)/g)].map(m => m[1]);
  return { flag, log };
}

describe('memory worker runtime parity', () => {
  const HOOK_SOURCE = loadFile('src/assets/scripts/hooks/background-memory-update');

  it("the hook's `claude -p --model` literal is WORKER_AGENTS.memory.model", () => {
    expect(collectMemoryHookModels(HOOK_SOURCE).flag).toEqual([WORKER_AGENTS.memory.model]);
  });

  it("the hook's spawn log line names WORKER_AGENTS.memory.model", () => {
    expect(collectMemoryHookModels(HOOK_SOURCE).log).toEqual([WORKER_AGENTS.memory.model]);
  });

  it('known-bad probe: the collector reports a drifted literal and an absent one', () => {
    const drifted = [
      'log "Spawning claude -p (model claude-sonnet-4-6, ${TURN_COUNT} turns)"',
      'DEVFLOW_BG_UPDATER=1 "$CLAUDE_BIN" -p \\',
      '  --model claude-sonnet-4-6 \\',
      '  --output-format text',
    ].join('\n');
    expect(collectMemoryHookModels(drifted)).toEqual({
      flag: ['claude-sonnet-4-6'],
      log: ['claude-sonnet-4-6'],
    });
    expect(collectMemoryHookModels(drifted).flag).not.toEqual([WORKER_AGENTS.memory.model]);
    expect(collectMemoryHookModels('echo nothing here')).toEqual({ flag: [], log: [] });
  });
});

// ---------------------------------------------------------------------------
// validateWorkerValue — the one worker value domain
// ---------------------------------------------------------------------------

describe('validateWorkerValue', () => {
  describe('model', () => {
    it('accepts default, every Claude alias and a full claude- identifier', () => {
      for (const ok of ['default', ...CLAUDE_MODEL_ALIASES, 'claude-sonnet-4-6', 'claude-opus-4-8']) {
        expect(validateWorkerValue('model', ok).ok, ok).toBe(true);
      }
    });

    it('rejects an external model', () => {
      for (const bad of ['gpt-5', 'gpt-5.6-sol', 'sol']) {
        const result = validateWorkerValue('model', bad);
        expect(result.ok, bad).toBe(false);
        if (!result.ok) expect(result.error).toContain(bad);
      }
    });

    it('rejects inherit — a worker has no session model to inherit', () => {
      expect(validateWorkerValue('model', 'inherit').ok).toBe(false);
    });

    it('rejects a bare claude- prefix and a lookalike', () => {
      expect(validateWorkerValue('model', 'claude-').ok).toBe(false);
      expect(validateWorkerValue('model', 'claude').ok).toBe(false);
      expect(validateWorkerValue('model', 'xclaude-sonnet').ok).toBe(false);
    });

    it('rejects a name outside the model charset even with the claude- prefix', () => {
      expect(validateWorkerValue('model', 'claude-x\ntools: [bash]').ok).toBe(false);
    });
  });

  describe('effort', () => {
    it('accepts default and every level', () => {
      for (const ok of ['default', 'low', 'medium', 'high', 'xhigh', 'max']) {
        expect(validateWorkerValue('effort', ok).ok, ok).toBe(true);
      }
    });

    it('rejects inherit — a worker has no session effort to inherit', () => {
      const result = validateWorkerValue('effort', 'inherit');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('inherit');
    });

    it('rejects an unknown level', () => {
      expect(validateWorkerValue('effort', 'turbo').ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// readAgentMapping — inherit and the worker domain on read
// ---------------------------------------------------------------------------

describe('readAgentMapping — inherit and worker entries', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-agent-worker-read-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const writeRaw = (agents: unknown) =>
    fs.writeFile(path.join(dir, 'agent-models.json'), JSON.stringify({ version: 1, agents }), 'utf-8');

  it('reads effort inherit on an agent with no warning', async () => {
    await writeRaw({ code: { effort: 'inherit' } });
    const warnings: string[] = [];

    const result = await readAgentMapping(dir, { onWarning: (m) => warnings.push(m) });

    expect(result.ok && result.value.agents['code']?.effort).toBe('inherit');
    expect(warnings).toEqual([]);
  });

  it('still drops the literal "default" effort, which is a CLI word and never stored', async () => {
    await writeRaw({ code: { effort: 'default' } });
    const warnings: string[] = [];

    const result = await readAgentMapping(dir, { onWarning: (m) => warnings.push(m) });

    expect(result.ok && result.value.agents['code']?.effort).toBeUndefined();
    expect(warnings.some(w => w.includes('default'))).toBe(true);
  });

  it('keeps an in-domain memory entry', async () => {
    await writeRaw({ memory: { model: 'sonnet', effort: 'medium' } });
    const warnings: string[] = [];

    const result = await readAgentMapping(dir, { onWarning: (m) => warnings.push(m) });

    expect(result.ok && result.value.agents['memory']).toEqual({ model: 'sonnet', effort: 'medium' });
    expect(warnings).toEqual([]);
  });

  it('accepts a full claude- identifier for memory', async () => {
    await writeRaw({ memory: { model: 'claude-sonnet-4-6' } });

    const result = await readAgentMapping(dir);

    expect(result.ok && result.value.agents['memory']?.model).toBe('claude-sonnet-4-6');
  });

  it('drops a hand-edited external model for memory, with a warning that names the worker', async () => {
    await writeRaw({ memory: { model: 'gpt-5', effort: 'low' } });
    const warnings: string[] = [];

    const result = await readAgentMapping(dir, { onWarning: (m) => warnings.push(m) });

    expect(result.ok && result.value.agents['memory']).toEqual({ effort: 'low' });
    expect(warnings.filter(w => w.includes('memory') && w.includes('gpt-5'))).toHaveLength(1);
  });

  it('drops effort inherit for memory, with a warning', async () => {
    await writeRaw({ memory: { model: 'haiku', effort: 'inherit' } });
    const warnings: string[] = [];

    const result = await readAgentMapping(dir, { onWarning: (m) => warnings.push(m) });

    expect(result.ok && result.value.agents['memory']).toEqual({ model: 'haiku' });
    expect(warnings.filter(w => w.includes('memory') && w.includes('inherit'))).toHaveLength(1);
  });

  it('an external model is still valid for an ordinary agent', async () => {
    await writeRaw({ code: { model: 'gpt-5.6-sol' } });

    const result = await readAgentMapping(dir);

    expect(result.ok && result.value.agents['code']?.model).toBe('gpt-5.6-sol');
  });
});

// ---------------------------------------------------------------------------
// agentOnlyMapping / hasAgentMappingEntries / countExternalMappedAgents
// ---------------------------------------------------------------------------

describe('agentOnlyMapping', () => {
  it('drops worker keys and keeps every other key, unknown names included', () => {
    const mapping = file({
      code: { model: 'opus' },
      memory: { model: 'sonnet' },
      'third-party-agent': { effort: 'low' },
    });

    expect(Object.keys(agentOnlyMapping(mapping)).sort()).toEqual(['code', 'third-party-agent']);
  });

  it('does not mutate the mapping', () => {
    const mapping = file({ code: { model: 'opus' }, memory: { model: 'sonnet' } });

    agentOnlyMapping(mapping);

    expect(Object.keys(mapping.agents).sort()).toEqual(['code', 'memory']);
  });

  it('returns no entries for a memory-only mapping', () => {
    expect(Object.keys(agentOnlyMapping(file({ memory: { effort: 'low' } })))).toEqual([]);
  });
});

describe('hasAgentMappingEntries — the init reapply gate', () => {
  it('is closed for an empty mapping', () => {
    expect(hasAgentMappingEntries(file({}))).toBe(false);
  });

  it('stays closed for an agents.memory-only mapping', () => {
    expect(hasAgentMappingEntries(file({ memory: { model: 'sonnet', effort: 'medium' } }))).toBe(false);
  });

  it('opens for one agent entry', () => {
    expect(hasAgentMappingEntries(file({ validate: { model: 'haiku' } }))).toBe(true);
  });

  it('opens for an agent entry beside a memory entry', () => {
    expect(hasAgentMappingEntries(file({ memory: { effort: 'low' }, code: { effort: 'max' } }))).toBe(true);
  });
});

describe('countExternalMappedAgents — workers are not agents', () => {
  it('does not count a worker entry', () => {
    // A hand-edited external model on a worker is dropped on read, but the
    // count must hold on its own: the proxy status line counts AGENTS.
    const mapping = file({ memory: { model: 'gpt-5' }, code: { model: 'gpt-5.6-sol' } });

    expect(countExternalMappedAgents(mapping)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Shipped defaults stay put: the real tree through a reapply
// ---------------------------------------------------------------------------
//
// An install at shipped defaults carries the shipped `model:` and `effort:` lines
// of every agent (the rows of tests/fixtures/agent-config.ts), and neither a
// Validate entry that restates the shipped model nor an agents.memory entry
// changes a byte of any installed agent: a shipped effort survives a reapply.

describe('reapplyAgentMapping — the real shipped tree at shipped defaults', () => {
  let tmp: string;
  let installDir: string;
  let devflowDir: string;
  const names = getAllAgentNames();

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-reapply-real-'));
    installDir = path.join(tmp, 'install');
    devflowDir = path.join(tmp, 'devflow');
    await fs.mkdir(installDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });
    for (const name of names) {
      await fs.writeFile(path.join(installDir, `${name}.md`), resolveAgentSource(name).content, 'utf-8');
    }
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const installedBytes = async (): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    for (const name of names) out.set(name, await fs.readFile(path.join(installDir, `${name}.md`), 'utf-8'));
    return out;
  };

  it('every shipped agent carries the effort of its table row, and an exempt agent carries none', async () => {
    for (const [name, content] of await installedBytes()) {
      const effort = readFrontmatterEffort(content);
      expect(effort.ok && effort.value, `${name} ships the wrong effort`).toBe(AGENT_CONFIG[name]?.effort ?? '');
    }
  });

  it('an empty mapping rewrites nothing', async () => {
    const before = await installedBytes();

    const result = await reapplyAgentMapping({ installDir, devflowDir, proxyEnabled: false });

    expect(result.updated).toEqual([]);
    expect(await installedBytes()).toEqual(before);
  });

  it('a validate entry beside an agents.memory entry leaves every installed agent byte-identical', async () => {
    const before = await installedBytes();
    await saveAgentMapping(devflowDir, file({
      validate: { model: 'haiku' },
      memory: { model: 'sonnet', effort: 'medium' },
    }));

    const result = await reapplyAgentMapping({ installDir, devflowDir, proxyEnabled: false });

    expect(result.updated).toEqual([]);
    expect(await installedBytes()).toEqual(before);
  });

  it('a real override still lands, and only on its own agent', async () => {
    const before = await installedBytes();
    await saveAgentMapping(devflowDir, file({ validate: { model: 'opus' }, memory: { model: 'sonnet' } }));

    const result = await reapplyAgentMapping({ installDir, devflowDir, proxyEnabled: false });

    expect(result.updated).toEqual(['validate']);
    const after = await installedBytes();
    for (const name of names) {
      if (name === 'validate') expect(after.get(name)).toContain('model: opus');
      else expect(after.get(name), name).toBe(before.get(name));
    }
  });
});

// ---------------------------------------------------------------------------
// reapplyAgentMapping — the walk skips workers
// ---------------------------------------------------------------------------

describe('reapplyAgentMapping — worker keys', () => {
  let tmp: string;
  let installDir: string;
  let devflowDir: string;
  let srcDir: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-reapply-worker-'));
    installDir = path.join(tmp, 'install');
    devflowDir = path.join(tmp, 'devflow');
    srcDir = path.join(tmp, 'src-agents');
    await fs.mkdir(installDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'code.md'), '---\nname: Code\nmodel: sonnet\n---\n\nbody\n', 'utf-8');
    await fs.writeFile(path.join(installDir, 'code.md'), '---\nname: Code\nmodel: sonnet\n---\n\nbody\n', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('creates or rewrites no memory.md and files memory in no result bucket', async () => {
    await saveAgentMapping(devflowDir, file({ memory: { model: 'sonnet', effort: 'medium' }, code: { model: 'opus' } }));

    const result = await reapplyAgentMapping({
      installDir,
      devflowDir,
      proxyEnabled: false,
      agentSourceDirs: [path.join(tmp, 'no-such-dist'), srcDir],
    });

    expect((await fs.readdir(installDir)).sort()).toEqual(['code.md']);
    for (const bucket of [result.updated, result.unchanged, result.skippedMissing, result.invalidMapping]) {
      expect(bucket).not.toContain('memory');
    }
    expect(result.updated).toContain('code');
  });

  it('does not touch an installed file that happens to be named memory.md', async () => {
    const stray = '---\nname: Memory\nmodel: opus\n---\n\nbody\n';
    await fs.writeFile(path.join(installDir, 'memory.md'), stray, 'utf-8');
    await saveAgentMapping(devflowDir, file({ memory: { model: 'sonnet' } }));

    await reapplyAgentMapping({
      installDir,
      devflowDir,
      proxyEnabled: true,
      agentSourceDirs: [path.join(tmp, 'no-such-dist'), srcDir],
    });

    expect(await fs.readFile(path.join(installDir, 'memory.md'), 'utf-8')).toBe(stray);
  });
});

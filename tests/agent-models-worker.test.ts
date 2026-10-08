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
import { CLAUDE_MODEL_ALIASES } from '../src/core/external-models.js';
import { DEVFLOW_PLUGINS, getAllAgentNames } from '../src/core/plugins.js';

const file = (agents: AgentMappingFile['agents']): AgentMappingFile => ({ version: 1, agents });

// ---------------------------------------------------------------------------
// WORKER_AGENTS / isWorkerAgent
// ---------------------------------------------------------------------------

describe('WORKER_AGENTS', () => {
  it('declares exactly the memory worker, shipping haiku at high effort', () => {
    expect(WORKER_AGENTS).toEqual({ memory: { model: 'haiku', effort: 'high' } });
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

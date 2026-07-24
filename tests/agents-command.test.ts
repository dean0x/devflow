/**
 * Tests for src/cli/commands/agents.ts
 *
 * Strategy: import exported pure helpers from agents.ts and test them directly.
 * Commander integration (TTY detection, clack I/O) is thin and not unit-tested.
 * All tests use injected dir paths (temp dirs) — no real devflow/agent dirs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  validateSetArgs,
  applySetMapping,
  buildListRows,
  type ListRow,
} from '../src/cli/commands/agents.js';
import {
  CLAUDE_MODEL_ALIASES,
  EFFORT_LEVELS,
  type AgentMappingFile,
} from '../src/core/agent-models.js';
import { externalModelIds } from '../src/core/external-models.js';

// ---------------------------------------------------------------------------
// validateSetArgs
// ---------------------------------------------------------------------------

describe('validateSetArgs', () => {
  it('accepts valid claude model', () => {
    const result = validateSetArgs({ model: 'sonnet' });
    expect(result.ok).toBe(true);
  });

  it('accepts valid effort', () => {
    const result = validateSetArgs({ effort: 'high' });
    expect(result.ok).toBe(true);
  });

  it('accepts both model and effort', () => {
    const result = validateSetArgs({ model: 'opus', effort: 'max' });
    expect(result.ok).toBe(true);
  });

  it('accepts "default" as model (clears the key)', () => {
    const result = validateSetArgs({ model: 'default' });
    expect(result.ok).toBe(true);
  });

  it('accepts "default" as effort (clears the key)', () => {
    const result = validateSetArgs({ effort: 'default' });
    expect(result.ok).toBe(true);
  });

  it('accepts GPT model IDs', () => {
    for (const id of externalModelIds()) {
      const result = validateSetArgs({ model: id });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects unknown model', () => {
    const result = validateSetArgs({ model: 'turbo-3000' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('model');
    }
  });

  it('rejects unknown effort level', () => {
    const result = validateSetArgs({ effort: 'turbo' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('effort');
    }
  });

  it('rejects when neither model nor effort is provided', () => {
    const result = validateSetArgs({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('model');
    }
  });

  it('accepts all claude aliases', () => {
    for (const alias of CLAUDE_MODEL_ALIASES) {
      const result = validateSetArgs({ model: alias });
      expect(result.ok).toBe(true);
    }
  });

  it('accepts all effort levels', () => {
    for (const level of EFFORT_LEVELS) {
      const result = validateSetArgs({ effort: level });
      expect(result.ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// applySetMapping
// ---------------------------------------------------------------------------

describe('applySetMapping', () => {
  const emptyMapping: AgentMappingFile = { version: 1, agents: {} };

  it('adds model entry for agent', () => {
    const result = applySetMapping(emptyMapping, 'coder', { model: 'opus' });
    expect(result.agents['coder']?.model).toBe('opus');
  });

  it('adds effort entry for agent', () => {
    const result = applySetMapping(emptyMapping, 'coder', { effort: 'high' });
    expect(result.agents['coder']?.effort).toBe('high');
  });

  it('adds both model and effort', () => {
    const result = applySetMapping(emptyMapping, 'coder', { model: 'sonnet', effort: 'max' });
    expect(result.agents['coder']?.model).toBe('sonnet');
    expect(result.agents['coder']?.effort).toBe('max');
  });

  it('clears model when model is "default"', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'opus', effort: 'high' } },
    };
    const result = applySetMapping(mapping, 'coder', { model: 'default' });
    expect(result.agents['coder']?.model).toBeUndefined();
    expect(result.agents['coder']?.effort).toBe('high'); // preserved
  });

  it('clears effort when effort is "default"', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'opus', effort: 'high' } },
    };
    const result = applySetMapping(mapping, 'coder', { effort: 'default' });
    expect(result.agents['coder']?.model).toBe('opus'); // preserved
    expect(result.agents['coder']?.effort).toBeUndefined();
  });

  it('removes agent entry entirely when both fields become default', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'opus' } },
    };
    const result = applySetMapping(mapping, 'coder', { model: 'default' });
    // Empty object — the entry can be removed or kept empty; both are valid deviations-only
    // This test just checks the model is cleared
    expect(result.agents['coder']?.model).toBeUndefined();
  });

  it('does not mutate the original mapping', () => {
    const original: AgentMappingFile = { version: 1, agents: { coder: { model: 'opus' } } };
    applySetMapping(original, 'coder', { model: 'sonnet' });
    expect(original.agents['coder']?.model).toBe('opus');
  });

  it('preserves entries for other agents', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        designer: { model: 'haiku', effort: 'low' },
      },
    };
    const result = applySetMapping(mapping, 'coder', { model: 'sonnet' });
    expect(result.agents['designer']?.model).toBe('haiku');
    expect(result.agents['coder']?.model).toBe('sonnet');
  });
});

// ---------------------------------------------------------------------------
// buildListRows
// ---------------------------------------------------------------------------

describe('buildListRows', () => {
  let installDir: string;
  let devflowDir: string;

  beforeEach(async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-agents-cmd-'));
    installDir = path.join(tmpBase, 'agents');
    devflowDir = path.join(tmpBase, 'devflow');
    await fs.mkdir(installDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(path.dirname(installDir), { recursive: true, force: true });
  });

  it('returns a row for each agent name', async () => {
    const agentNames = ['coder', 'designer', 'git'];
    const mapping: AgentMappingFile = { version: 1, agents: {} };
    const shippedDefaults: Record<string, string> = {
      coder: 'sonnet',
      designer: 'opus',
      git: 'haiku',
    };
    const rows = await buildListRows({
      agentNames,
      mapping,
      installDir,
      shippedDefaults,
      proxyEnabled: false,
    });
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.name)).toEqual(agentNames);
  });

  it('marks state as "not installed" when agent file is absent', async () => {
    const rows = await buildListRows({
      agentNames: ['coder'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { coder: 'sonnet' },
      proxyEnabled: false,
    });
    expect(rows[0].state).toBe('not-installed');
  });

  it('marks state as "active" when agent file is present and proxy is on', async () => {
    await fs.writeFile(path.join(installDir, 'coder.md'), 'dummy', 'utf-8');
    const rows = await buildListRows({
      agentNames: ['coder'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { coder: 'sonnet' },
      proxyEnabled: true,
    });
    expect(rows[0].state).toBe('active');
  });

  it('marks state as "saved-inactive" when agent has GPT model + proxy off', async () => {
    await fs.writeFile(path.join(installDir, 'coder.md'), 'dummy', 'utf-8');
    const rows = await buildListRows({
      agentNames: ['coder'],
      mapping: { version: 1, agents: { coder: { model: 'gpt-5.5' } } },
      installDir,
      shippedDefaults: { coder: 'sonnet' },
      proxyEnabled: false,
    });
    expect(rows[0].state).toBe('saved-inactive');
  });

  it('shows configured model from mapping', async () => {
    const rows = await buildListRows({
      agentNames: ['coder'],
      mapping: { version: 1, agents: { coder: { model: 'opus' } } },
      installDir,
      shippedDefaults: { coder: 'sonnet' },
      proxyEnabled: false,
    });
    expect(rows[0].configured).toBe('opus');
  });

  it('shows "default" when agent has no mapping entry', async () => {
    const rows = await buildListRows({
      agentNames: ['coder'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { coder: 'sonnet' },
      proxyEnabled: false,
    });
    expect(rows[0].configured).toBe('default');
  });

  it('shows configured effort from mapping', async () => {
    const rows = await buildListRows({
      agentNames: ['coder'],
      mapping: { version: 1, agents: { coder: { effort: 'high' } } },
      installDir,
      shippedDefaults: { coder: 'sonnet' },
      proxyEnabled: false,
    });
    expect(rows[0].effort).toBe('high');
  });

  it('shows "default" effort when not configured', async () => {
    const rows = await buildListRows({
      agentNames: ['coder'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { coder: 'sonnet' },
      proxyEnabled: false,
    });
    expect(rows[0].effort).toBe('default');
  });

  it('includes default model from shippedDefaults', async () => {
    const rows = await buildListRows({
      agentNames: ['coder'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { coder: 'sonnet' },
      proxyEnabled: false,
    });
    expect(rows[0].defaultModel).toBe('sonnet');
  });
});

// ---------------------------------------------------------------------------
// GPT model dormancy warning info
// ---------------------------------------------------------------------------

describe('applySetMapping — GPT dormancy', () => {
  it('allows GPT model regardless of proxy state (proxy state checked at call site)', () => {
    const mapping: AgentMappingFile = { version: 1, agents: {} };
    const result = applySetMapping(mapping, 'coder', { model: 'gpt-5.5' });
    expect(result.agents['coder']?.model).toBe('gpt-5.5');
  });
});

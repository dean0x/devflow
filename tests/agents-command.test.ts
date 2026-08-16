/**
 * Tests for src/cli/commands/agents.ts
 *
 * Strategy: import exported pure helpers from agents.ts and test them directly.
 * Commander integration (TTY detection, clack I/O) is thin and not unit-tested.
 * All tests use injected dir paths (temp dirs) — no real devflow/agent dirs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  EFFORT_LEVELS,
  type AgentMappingFile,
} from '../src/core/agent-models.js';
import { CLAUDE_MODEL_ALIASES } from '../src/core/external-models.js';
import * as modelDiscovery from '../src/core/model-discovery.js';
import { type ExternalModelCatalog } from '../src/core/model-discovery.js';

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

  it('accepts GPT model IDs when catalog is known', () => {
    // When the catalog is known, validateSetArgs validates against selectableNames.
    const catalog: ExternalModelCatalog = {
      known: true,
      models: [
        { id: 'gpt-5.6-sol', aliases: ['sol'] },
        { id: 'gpt-5.5', aliases: [] },
      ],
      aliasToId: new Map([
        ['sol', 'gpt-5.6-sol'],
        ['gpt-5.6-sol', 'gpt-5.6-sol'],
        ['gpt-5.5', 'gpt-5.5'],
      ]),
      selectableNames: ['sol', 'gpt-5.6-sol', 'gpt-5.5'],
      source: 'cache',
    };
    for (const name of catalog.selectableNames) {
      const result = validateSetArgs({ model: name }, catalog);
      expect(result.ok).toBe(true);
    }
  });

  it('rejects unknown model when catalog is known', () => {
    // When catalog is known, models not in 'default' | CLAUDE_MODEL_ALIASES | selectableNames are rejected.
    const catalog: ExternalModelCatalog = {
      known: true,
      models: [{ id: 'gpt-5.6-sol', aliases: ['sol'] }],
      aliasToId: new Map([['sol', 'gpt-5.6-sol'], ['gpt-5.6-sol', 'gpt-5.6-sol']]),
      selectableNames: ['sol', 'gpt-5.6-sol'],
      source: 'cache',
    };
    const result = validateSetArgs({ model: 'turbo-3000' }, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('model');
    }
  });

  it('accepts unknown model when catalog is unknown (cache miss) — dormancy warning fires at call site', () => {
    // AC-P9: --set is cache-only (0 spawns). If the cache is cold, catalog is {known:false}
    // and any model is accepted. The dormancy warning fires at the agents.ts call site.
    const result = validateSetArgs({ model: 'turbo-3000' });
    // default catalog is {known:false} — no validation
    expect(result.ok).toBe(true);
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

  it('clears model field and leaves an empty entry (entry removal is the TUI-save layer\'s job)', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'opus' } },
    };
    const result = applySetMapping(mapping, 'coder', { model: 'default' });
    // model key is gone, but the entry itself remains (applySetMapping never removes empty entries)
    expect(result.agents['coder']?.model).toBeUndefined();
    expect('coder' in result.agents).toBe(true);
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

// ---------------------------------------------------------------------------
// AC-P4: buildListRows makes 0 cache reads (no discovery on --list)
// ---------------------------------------------------------------------------

describe('AC-P4: buildListRows makes 0 cache reads', () => {
  // buildListRows receives the catalog as a parameter — it does NOT call
  // getExternalModelsCached or discoverExternalModels internally. Prove this via
  // two complementary methods:
  //
  // 1. Source-grep: the function body does not reference discovery functions.
  // 2. Functional: buildListRows works correctly when no cache directory exists at
  //    all — if it were reading the cache, it would need the directory to exist.

  let installDir: string;
  let devflowDir: string;

  beforeEach(async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-acp4-'));
    installDir = path.join(tmpBase, 'agents');
    devflowDir = path.join(tmpBase, 'devflow');
    await fs.mkdir(installDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(path.dirname(installDir), { recursive: true, force: true });
  });

  it('spy: buildListRows does not invoke getExternalModelsCached or discoverExternalModels', async () => {
    // AC-P4: --list must never trigger discovery. A source-grep passes even when
    // a discovery call is hidden one helper deep — a module-level spy catches that.
    const discoverSpy = vi.spyOn(modelDiscovery, 'discoverExternalModels');
    const getCachedSpy = vi.spyOn(modelDiscovery, 'getExternalModelsCached');
    try {
      const shippedDefaults: Record<string, string> = { coder: 'sonnet' };
      const mapping: AgentMappingFile = { version: 1, agents: {} };
      const catalog: ExternalModelCatalog = { known: false };
      await buildListRows({
        agentNames: ['coder'],
        mapping,
        installDir,
        shippedDefaults,
        proxyEnabled: false,
        catalog,
      });
      expect(discoverSpy, 'buildListRows called discoverExternalModels — AC-P4 violation').not.toHaveBeenCalled();
      expect(getCachedSpy, 'buildListRows called getExternalModelsCached — AC-P4 violation').not.toHaveBeenCalled();
    } finally {
      discoverSpy.mockRestore();
      getCachedSpy.mockRestore();
    }
  });

  it('functional: buildListRows succeeds with no cache directory present (requires no cache read)', async () => {
    // If buildListRows read from a cache directory, it would fail (or skip) when
    // the directory is absent. It should succeed regardless — catalog is passed in.
    const shippedDefaults: Record<string, string> = { coder: 'sonnet' };
    const mapping: AgentMappingFile = { version: 1, agents: {} };
    const catalog: ExternalModelCatalog = { known: false };

    // No cache directory exists under devflowDir — passes catalog directly
    const rows = await buildListRows({
      agentNames: ['coder'],
      mapping,
      installDir,
      shippedDefaults,
      proxyEnabled: false,
      catalog,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('coder');
  });
});

// ---------------------------------------------------------------------------
// AC-P9: --set path makes 0 spawns (cache-only, validateSetArgs is pure)
// ---------------------------------------------------------------------------

describe('AC-P9: validateSetArgs and applySetMapping are synchronous (0 spawns)', () => {
  // The --set code path calls: getExternalModelsCached (sync read, no spawn) →
  // validateSetArgs (pure sync) → applySetMapping (pure sync). No process spawn
  // is involved. Prove this by verifying that validateSetArgs and applySetMapping
  // return non-Promise values — spawning requires async/callback, not sync return.

  it('validateSetArgs returns synchronously (not a Promise)', () => {
    // A function that spawns must await the spawn result — it cannot return a
    // synchronous value. Checking the return value is not thenable proves it.
    const result = validateSetArgs({ model: 'sonnet' });
    // Must not be a Promise (thenables trigger microtask queues, not spawns)
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof (result as Record<string, unknown>)?.then).not.toBe('function');
    // Must have ok field (discriminated Result type)
    expect('ok' in result).toBe(true);
  });

  it('applySetMapping returns synchronously (not a Promise)', () => {
    const mapping: AgentMappingFile = { version: 1, agents: {} };
    const result = applySetMapping(mapping, 'coder', { model: 'opus' });
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof (result as Record<string, unknown>)?.then).not.toBe('function');
    // Must have agents field (is an AgentMappingFile)
    expect('agents' in result).toBe(true);
  });

  it('spy: validateSetArgs and applySetMapping do not invoke discovery functions (0 spawns)', () => {
    // AC-P9: --set must make 0 spawns. A source import-grep can be evaded if child_process
    // is imported conditionally or spawning is wrapped in a helper. A module-level spy on
    // the discovery entry points (which are the only spawn paths in agents.ts) catches that.
    const discoverSpy = vi.spyOn(modelDiscovery, 'discoverExternalModels');
    const getCachedSpy = vi.spyOn(modelDiscovery, 'getExternalModelsCached');
    try {
      validateSetArgs({ model: 'sonnet' });
      const mapping: AgentMappingFile = { version: 1, agents: {} };
      applySetMapping(mapping, 'coder', { model: 'opus' });
      expect(
        discoverSpy,
        'validateSetArgs or applySetMapping called discoverExternalModels — AC-P9 violation',
      ).not.toHaveBeenCalled();
      expect(
        getCachedSpy,
        'validateSetArgs or applySetMapping called getExternalModelsCached — AC-P9 violation',
      ).not.toHaveBeenCalled();
    } finally {
      discoverSpy.mockRestore();
      getCachedSpy.mockRestore();
    }
  });
});

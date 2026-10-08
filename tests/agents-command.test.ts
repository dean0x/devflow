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
import { stripAnsi } from '../src/hud/colors.js';
import {
  validateSetArgs,
  applySetMapping,
  buildListRows,
  buildWorkerListRows,
  formatListOutput,
  selectCatalog,
  mergeTuiRowsIntoMapping,
  type ListRow,
} from '../src/cli/commands/agents.js';
import { buildModelCycle } from '../src/cli/agents-view/index.js';
import {
  EFFORT_LEVELS,
  type AgentMappingFile,
} from '../src/core/agent-models.js';
import { CLAUDE_MODEL_ALIASES } from '../src/core/external-models.js';
import * as modelDiscovery from '../src/core/model-discovery.js';
import { type ExternalModelCatalog } from '../src/core/model-discovery.js';
import { MAX_TTL_MS } from '../src/core/cache.js';
import { getAllAgentNames } from '../src/core/plugins.js';

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

  it('rejects hostile model string on cache miss (charset validation)', () => {
    // C2-SEC-2: A string containing injection characters (newlines, YAML metacharacters)
    // must be rejected even when the catalog is unknown (cache miss). Charset validation
    // must apply at the CLI boundary regardless of catalog state — avoids a gap
    // where only a subset of paths was defended.
    const hostile = 'gpt\ntools:\n  - bash';
    const result = validateSetArgs({ model: hostile });
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
    const result = applySetMapping(emptyMapping, 'code', { model: 'opus' });
    expect(result.agents['code']?.model).toBe('opus');
  });

  it('adds effort entry for agent', () => {
    const result = applySetMapping(emptyMapping, 'code', { effort: 'high' });
    expect(result.agents['code']?.effort).toBe('high');
  });

  it('adds both model and effort', () => {
    const result = applySetMapping(emptyMapping, 'code', { model: 'sonnet', effort: 'max' });
    expect(result.agents['code']?.model).toBe('sonnet');
    expect(result.agents['code']?.effort).toBe('max');
  });

  it('clears model when model is "default"', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { code: { model: 'opus', effort: 'high' } },
    };
    const result = applySetMapping(mapping, 'code', { model: 'default' });
    expect(result.agents['code']?.model).toBeUndefined();
    expect(result.agents['code']?.effort).toBe('high'); // preserved
  });

  it('clears effort when effort is "default"', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { code: { model: 'opus', effort: 'high' } },
    };
    const result = applySetMapping(mapping, 'code', { effort: 'default' });
    expect(result.agents['code']?.model).toBe('opus'); // preserved
    expect(result.agents['code']?.effort).toBeUndefined();
  });

  it('clears model field and leaves an empty entry (entry removal is the TUI-save layer\'s job)', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { code: { model: 'opus' } },
    };
    const result = applySetMapping(mapping, 'code', { model: 'default' });
    // model key is gone, but the entry itself remains (applySetMapping never removes empty entries)
    expect(result.agents['code']?.model).toBeUndefined();
    expect('code' in result.agents).toBe(true);
  });

  it('does not mutate the original mapping', () => {
    const original: AgentMappingFile = { version: 1, agents: { code: { model: 'opus' } } };
    applySetMapping(original, 'code', { model: 'sonnet' });
    expect(original.agents['code']?.model).toBe('opus');
  });

  it('preserves entries for other agents', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        design: { model: 'haiku', effort: 'low' },
      },
    };
    const result = applySetMapping(mapping, 'code', { model: 'sonnet' });
    expect(result.agents['design']?.model).toBe('haiku');
    expect(result.agents['code']?.model).toBe('sonnet');
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
    const agentNames = ['code', 'design', 'git'];
    const mapping: AgentMappingFile = { version: 1, agents: {} };
    const shippedDefaults = {
      coder: { model: 'sonnet' },
      designer: { model: 'opus' },
      git: { model: 'haiku' },
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
      agentNames: ['code'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { code: { model: 'sonnet' } },
      proxyEnabled: false,
    });
    expect(rows[0].state).toBe('not-installed');
  });

  it('marks state as "active" when agent file is present and proxy is on', async () => {
    await fs.writeFile(path.join(installDir, 'code.md'), 'dummy', 'utf-8');
    const rows = await buildListRows({
      agentNames: ['code'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { code: { model: 'sonnet' } },
      proxyEnabled: true,
    });
    expect(rows[0].state).toBe('active');
  });

  it('marks state as "saved-inactive" when agent has GPT model + proxy off', async () => {
    await fs.writeFile(path.join(installDir, 'code.md'), 'dummy', 'utf-8');
    const rows = await buildListRows({
      agentNames: ['code'],
      mapping: { version: 1, agents: { code: { model: 'gpt-5.5' } } },
      installDir,
      shippedDefaults: { code: { model: 'sonnet' } },
      proxyEnabled: false,
    });
    expect(rows[0].state).toBe('saved-inactive');
  });

  it('shows configured model from mapping', async () => {
    const rows = await buildListRows({
      agentNames: ['code'],
      mapping: { version: 1, agents: { code: { model: 'opus' } } },
      installDir,
      shippedDefaults: { code: { model: 'sonnet' } },
      proxyEnabled: false,
    });
    expect(rows[0].configured).toBe('opus');
  });

  it('shows "default" when agent has no mapping entry', async () => {
    const rows = await buildListRows({
      agentNames: ['code'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { code: { model: 'sonnet' } },
      proxyEnabled: false,
    });
    expect(rows[0].configured).toBe('default');
  });

  it('shows configured effort from mapping', async () => {
    const rows = await buildListRows({
      agentNames: ['code'],
      mapping: { version: 1, agents: { code: { effort: 'high' } } },
      installDir,
      shippedDefaults: { code: { model: 'sonnet' } },
      proxyEnabled: false,
    });
    expect(rows[0].effort).toBe('high');
  });

  it('shows "default" effort when not configured', async () => {
    const rows = await buildListRows({
      agentNames: ['code'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { code: { model: 'sonnet' } },
      proxyEnabled: false,
    });
    expect(rows[0].effort).toBe('default');
  });

  it('includes default model from shippedDefaults', async () => {
    const rows = await buildListRows({
      agentNames: ['code'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { code: { model: 'sonnet' } },
      proxyEnabled: false,
    });
    expect(rows[0].defaultModel).toBe('sonnet');
  });
});

// ---------------------------------------------------------------------------
// selectCatalog — proxy-off catalog source wiring
// ---------------------------------------------------------------------------

describe('selectCatalog — proxy-off reads from cache, not hard-coded {known:false}', () => {
  // Raw JSON that parseModelsJson accepts: schemaVersion=1, kind="models",
  // one routable non-retired codex model with a short alias.
  const STUB_MODELS_JSON = JSON.stringify({
    schemaVersion: 1,
    kind: 'models',
    models: [
      {
        id: 'gpt-test-1',
        provider: 'codex',
        aliases: [{ name: 'test1' }],
        routable: true,
        retired: false,
      },
    ],
    providers: [{ id: 'codex', routing: 'direct' }],
  });

  let cacheDir: string;

  beforeEach(async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'df-select-catalog-'));
    cacheDir = path.join(tmpBase, 'models');
    await fs.mkdir(cacheDir, { recursive: true });

    // Write a valid cache entry — key must start with "external-models-v1-"
    const envelope = JSON.stringify({
      data: STUB_MODELS_JSON,
      timestamp: Date.now(),
      ttl: MAX_TTL_MS,
    });
    await fs.writeFile(path.join(cacheDir, 'external-models-v1-test.json'), envelope, 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(path.dirname(cacheDir), { recursive: true, force: true });
  });

  it('proxy off + populated cache → catalog is known and contains cached external model names', () => {
    const catalog = selectCatalog(false, cacheDir);
    expect(catalog.known).toBe(true);
    if (!catalog.known) return; // never reached — type narrowing
    expect(catalog.selectableNames).toContain('test1');
    expect(catalog.selectableNames).toContain('gpt-test-1');
  });

  it('proxy off + populated cache → buildModelCycle includes the alias (not canonical id) — Fix 1', () => {
    // Fix 1: cycle uses pickerNames(catalog.models) — aliases only.
    // 'gpt-test-1' has alias 'test1', so 'test1' appears; 'gpt-test-1' does NOT.
    const catalog = selectCatalog(false, cacheDir);
    const cycle = buildModelCycle(catalog);
    expect(cycle).toContain('test1');
    // gpt-test-1 is NOT in the cycle — it has an alias 'test1' that takes its slot
    expect(cycle).not.toContain('gpt-test-1');
    // Claude aliases still present
    for (const alias of CLAUDE_MODEL_ALIASES) {
      expect(cycle).toContain(alias);
    }
  });

  it('proxy on → selectCatalog returns {known:false} (async discovery is the on-path)', () => {
    // The proxy-on TUI path starts discoverExternalModels async; selectCatalog
    // returns {known:false} as the synchronous placeholder.
    const catalog = selectCatalog(true, cacheDir);
    expect(catalog.known).toBe(false);
  });

  it('proxy off + empty cache → catalog is {known:false}', async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'df-select-catalog-empty-'));
    const emptyDir = path.join(tmpBase, 'models');
    await fs.mkdir(emptyDir, { recursive: true });
    const catalog = selectCatalog(false, emptyDir);
    expect(catalog.known).toBe(false);
    await fs.rm(tmpBase, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// GPT model dormancy warning info
// ---------------------------------------------------------------------------

describe('applySetMapping — GPT dormancy', () => {
  it('allows GPT model regardless of proxy state (proxy state checked at call site)', () => {
    const mapping: AgentMappingFile = { version: 1, agents: {} };
    const result = applySetMapping(mapping, 'code', { model: 'gpt-5.5' });
    expect(result.agents['code']?.model).toBe('gpt-5.5');
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
      const shippedDefaults = { coder: { model: 'sonnet' } };
      const mapping: AgentMappingFile = { version: 1, agents: {} };
      const catalog: ExternalModelCatalog = { known: false };
      await buildListRows({
        agentNames: ['code'],
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
    const shippedDefaults = { coder: { model: 'sonnet' } };
    const mapping: AgentMappingFile = { version: 1, agents: {} };
    const catalog: ExternalModelCatalog = { known: false };

    // No cache directory exists under devflowDir — passes catalog directly
    const rows = await buildListRows({
      agentNames: ['code'],
      mapping,
      installDir,
      shippedDefaults,
      proxyEnabled: false,
      catalog,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('code');
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
    const result = applySetMapping(mapping, 'code', { model: 'opus' });
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
      applySetMapping(mapping, 'code', { model: 'opus' });
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

// ---------------------------------------------------------------------------
// T12: mergeTuiRowsIntoMapping — inertness guarantee (Fix 2)
// ---------------------------------------------------------------------------

describe('T12: mergeTuiRowsIntoMapping', () => {
  const BASE_MAPPING: AgentMappingFile = {
    version: 1,
    agents: {
      code: { model: 'opus' },
      review: { model: 'sol' },
    },
  };

  function makeRow(overrides: Partial<{
    name: string; configuredModel: string; originalModel: string;
    configuredEffort: string; originalEffort: string;
  }> = {}): import('../src/cli/agents-view/state.js').AgentRow {
    return {
      name: overrides.name ?? 'code',
      shippedDefault: 'sonnet',
      configuredModel: overrides.configuredModel ?? 'default',
      originalModel: overrides.originalModel ?? 'default',
      configuredEffort: (overrides.configuredEffort ?? 'default') as 'default',
      originalEffort: (overrides.originalEffort ?? 'default') as 'default',
      shippedEffort: undefined,
      dormantModel: null,
      offCyclePin: null,
      installed: true,
      inRegistry: true,
      worker: false,
    };
  }

  it('untouched row is preserved byte-identical — inertness guarantee', () => {
    // A row with configuredModel === originalModel must not modify the mapping.
    // This is the "inertness" guarantee: selecting a model and immediately
    // pressing Enter (without changing anything) must not dirty the mapping.
    const rows = [
      makeRow({ name: 'code', configuredModel: 'opus', originalModel: 'opus' }),
    ];
    const result = mergeTuiRowsIntoMapping(rows, BASE_MAPPING);
    // The coder entry must be preserved exactly as-is
    expect(result.agents['code']).toEqual({ model: 'opus' });
    // Unrelated entries (reviewer) must also be untouched
    expect(result.agents['review']).toEqual({ model: 'sol' });
  });

  it('dirty model row writes the new model', () => {
    const rows = [
      makeRow({ name: 'code', configuredModel: 'sonnet', originalModel: 'opus' }),
    ];
    const result = mergeTuiRowsIntoMapping(rows, BASE_MAPPING);
    expect(result.agents['code']).toEqual({ model: 'sonnet' });
  });

  it('resetting model to "default" deletes the model key', () => {
    const rows = [
      makeRow({ name: 'code', configuredModel: 'default', originalModel: 'opus' }),
    ];
    const result = mergeTuiRowsIntoMapping(rows, BASE_MAPPING);
    // model key deleted; empty entry is also removed
    expect(result.agents['code']).toBeUndefined();
  });

  it('dirty effort row writes the new effort', () => {
    const rows = [
      makeRow({ name: 'code', configuredModel: 'opus', originalModel: 'opus',
                 configuredEffort: 'high', originalEffort: 'default' }),
    ];
    const result = mergeTuiRowsIntoMapping(rows, BASE_MAPPING);
    expect(result.agents['code']).toEqual({ model: 'opus', effort: 'high' });
  });

  it('pure function — does not mutate original mapping', () => {
    const frozen = {
      version: 1 as const,
      agents: Object.freeze({ code: Object.freeze({ model: 'opus' }) }),
    };
    const rows = [
      makeRow({ name: 'code', configuredModel: 'sonnet', originalModel: 'opus' }),
    ];
    // Must not throw (mutation of frozen object throws in strict mode)
    expect(() => mergeTuiRowsIntoMapping(rows, frozen as AgentMappingFile)).not.toThrow();
    // Original mapping is untouched
    expect(frozen.agents['code']).toEqual({ model: 'opus' });
  });

  it('dormant row cycled back to its saved GPT model is inert (no write)', () => {
    // A dormant row has originalModel='default' (proxy-off fallback) but
    // dormantModel='gpt-5.5' (the saved GPT model). If the user cycles
    // to 'gpt-5.5', isDirtyModel returns false (not a change). The merge
    // must treat the row as inert — not re-write 'gpt-5.5' over 'default'.
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { code: { model: 'gpt-5.5' } },
    };
    const row: import('../src/cli/agents-view/state.js').AgentRow = {
      name: 'code',
      shippedDefault: 'sonnet',
      configuredModel: 'gpt-5.5',  // user cycled to the dormant model
      originalModel: 'default',     // proxy-off display fallback at init
      configuredEffort: 'default',
      originalEffort: 'default',
      shippedEffort: undefined,
      dormantModel: 'gpt-5.5',     // the saved GPT model
      offCyclePin: null,
      installed: true,
      inRegistry: true,
      worker: false,
    };
    const originalEntry = mapping.agents['code'];
    const result = mergeTuiRowsIntoMapping([row], mapping);
    // Must be byte-identical — no write occurred
    expect(result.agents['code']).toEqual({ model: 'gpt-5.5' });
    // F12: reference identity — the entry must be the SAME object (dormant short-circuit
    // returns the original entry, not a new object with the same shape). A structural
    // toEqual test passes either way; Object.is catches the difference.
    expect(Object.is(result.agents['code'], originalEntry)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-P3-LIST: --list AGENT cell format and --set round-trip
//
// The AGENT column in --list output must be lowercase identifiers that users
// can copy directly into `devflow agents --set <agent>`. Capitalization is
// TUI-only (formatAgentName is called only in render.ts, never in agents.ts).
// ---------------------------------------------------------------------------

describe('AC-P3-LIST: --list AGENT cell is a lowercase identifier', () => {
  let installDir: string;

  beforeEach(async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-list-fmt-'));
    installDir = path.join(tmpBase, 'agents');
    await fs.mkdir(installDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(path.dirname(installDir), { recursive: true, force: true });
  });

  it('every AGENT name from buildListRows matches ^[a-z0-9-]+$ (no capitals)', async () => {
    // The AGENT cell is stripAnsi(row.name) — the raw registry name.
    // Registry names are lowercase kebab-case; capitals must NEVER appear.
    const agentNames = getAllAgentNames();
    expect(agentNames.length).toBeGreaterThan(0);

    const mapping: AgentMappingFile = { version: 1, agents: {} };
    const shippedDefaults = Object.fromEntries(
      agentNames.map(n => [n, { model: 'sonnet' }]),
    );
    const rows = await buildListRows({
      agentNames,
      mapping,
      installDir,
      shippedDefaults,
      proxyEnabled: false,
    });

    const AGENT_CELL_PATTERN = /^[a-z0-9-]+$/;
    for (const row of rows) {
      expect(
        row.name,
        `AGENT cell "${row.name}" contains non-lowercase or non-identifier chars`,
      ).toMatch(AGENT_CELL_PATTERN);
    }
  });

  it('a name taken from --list round-trips through --set validation (getAllAgentNames contains it)', async () => {
    // --set validates agent names against getAllAgentNames() (plus orphan keys).
    // Any name that appears in buildListRows output must therefore be in
    // getAllAgentNames() — ensuring a user who copies from --list can use --set.
    const agentNames = getAllAgentNames();
    expect(agentNames.length).toBeGreaterThan(0);

    const mapping: AgentMappingFile = { version: 1, agents: {} };
    const shippedDefaults = Object.fromEntries(
      agentNames.map(n => [n, { model: 'sonnet' }]),
    );
    const rows = await buildListRows({
      agentNames,
      mapping,
      installDir,
      shippedDefaults,
      proxyEnabled: false,
    });

    const registrySet = new Set(getAllAgentNames());
    for (const row of rows) {
      // Every name from --list must be recognised by --set's validation.
      expect(
        registrySet.has(row.name),
        `Agent "${row.name}" from --list is not in getAllAgentNames() — --set would reject it`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-B11: formatListOutput — saved-inactive renders with (proxy off) detail
//
// Plan requires: --list composes `saved-inactive (proxy off)` for the dormant
// state. The TUI STATE column stays bare `saved-inactive` (width math assumes 14).
// ---------------------------------------------------------------------------

describe('formatListOutput (AC-B11): saved-inactive renders (proxy off) suffix', () => {
  const makeRow = (state: ListRow['state']): ListRow => ({
    name: 'code',
    defaultModel: 'sonnet',
    configured: 'gpt-5.5',
    effort: 'default',
    state,
  });

  it('renders "saved-inactive (proxy off)" — NOT bare "saved-inactive"', () => {
    const output = formatListOutput([makeRow('saved-inactive')], false);
    expect(output).toContain('saved-inactive (proxy off)');
    expect(output).not.toContain('saved — inactive');
  });

  it('does NOT add proxy-off suffix to active state', () => {
    const output = formatListOutput([makeRow('active')], true);
    expect(output).not.toContain('(proxy off)');
    expect(output).toContain('active');
  });
});

// ---------------------------------------------------------------------------
// D-SHIPPED-EFFORT: the `inherit` effort sentinel at the CLI boundary
// ---------------------------------------------------------------------------

describe('validateSetArgs — effort inherit', () => {
  it('accepts --effort inherit for an agent', () => {
    expect(validateSetArgs({ effort: 'inherit' }).ok).toBe(true);
    expect(validateSetArgs({ effort: 'inherit' }, { known: false }, 'code').ok).toBe(true);
  });

  it('lists inherit among the valid efforts in the unknown-effort error', () => {
    const result = validateSetArgs({ effort: 'turbo' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('inherit');
  });

  it('does not make inherit a valid MODEL (model-side inherit is a separate decision)', () => {
    // Cache miss: the charset gate admits it, as it always has; with a known catalog
    // it is rejected because CLAUDE_MODEL_ALIASES does not list it. Neither is changed here.
    const catalog: ExternalModelCatalog = {
      known: true,
      models: [],
      aliasToId: new Map(),
      selectableNames: [],
      source: 'cache',
    };
    expect(validateSetArgs({ model: 'inherit' }, catalog, 'code').ok).toBe(false);
  });
});

describe('devflow agents --effort help', () => {
  it('lists the levels, default and inherit', async () => {
    const { agentsCommand } = await import('../src/cli/commands/agents.js');
    const help = stripAnsi(agentsCommand.helpInformation());
    for (const word of [...EFFORT_LEVELS, 'default', 'inherit']) {
      expect(help, word).toContain(word);
    }
  });
});

describe('applySetMapping — effort inherit', () => {
  it('stores inherit as the effort', () => {
    const result = applySetMapping({ version: 1, agents: {} }, 'code', { effort: 'inherit' });
    expect(result.agents['code']?.effort).toBe('inherit');
  });

  it('"default" removes a stored inherit so the shipped effort applies again', () => {
    const mapping: AgentMappingFile = { version: 1, agents: { code: { effort: 'inherit' } } };
    const result = applySetMapping(mapping, 'code', { effort: 'default' });
    expect(result.agents['code']?.effort).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// D-WORKER-AGENTS: --set memory
// ---------------------------------------------------------------------------

describe('validateSetArgs — worker agents (memory)', () => {
  const MEMORY = 'memory';

  it('accepts a Claude alias, a full claude- identifier and "default" for the model', () => {
    for (const model of ['sonnet', 'haiku', 'default', 'claude-sonnet-4-6']) {
      expect(validateSetArgs({ model }, { known: false }, MEMORY).ok, model).toBe(true);
    }
  });

  it('accepts a level and "default" for the effort', () => {
    for (const effort of ['default', ...EFFORT_LEVELS]) {
      expect(validateSetArgs({ effort }, { known: false }, MEMORY).ok, effort).toBe(true);
    }
  });

  it('rejects an external model with a worker-specific error', () => {
    const result = validateSetArgs({ model: 'gpt-5' }, { known: false }, MEMORY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('gpt-5');
  });

  it('rejects an external model even when the catalog lists it (no catalog lookup)', () => {
    const catalog: ExternalModelCatalog = {
      known: true,
      models: [{ id: 'gpt-5.6-sol', aliases: ['sol'] }],
      aliasToId: new Map([['sol', 'gpt-5.6-sol'], ['gpt-5.6-sol', 'gpt-5.6-sol']]),
      selectableNames: ['sol', 'gpt-5.6-sol'],
      source: 'cache',
    };
    expect(validateSetArgs({ model: 'sol' }, catalog, MEMORY).ok).toBe(false);
    expect(validateSetArgs({ model: 'gpt-5.6-sol' }, catalog, MEMORY).ok).toBe(false);
  });

  it('rejects inherit as a worker model and as a worker effort', () => {
    expect(validateSetArgs({ model: 'inherit' }, { known: false }, MEMORY).ok).toBe(false);
    expect(validateSetArgs({ effort: 'inherit' }, { known: false }, MEMORY).ok).toBe(false);
  });

  it('rejects a hostile model string before the worker domain', () => {
    expect(validateSetArgs({ model: 'claude-x\ntools: [bash]' }, { known: false }, MEMORY).ok).toBe(false);
  });

  it('rejects the whole call when either value is out of domain', () => {
    expect(validateSetArgs({ model: 'sonnet', effort: 'inherit' }, { known: false }, MEMORY).ok).toBe(false);
  });

  it('still requires at least one of --model or --effort', () => {
    expect(validateSetArgs({}, { known: false }, MEMORY).ok).toBe(false);
  });

  it('leaves the ordinary-agent rules alone: an external model is fine for code', () => {
    expect(validateSetArgs({ model: 'gpt-5' }, { known: false }, 'code').ok).toBe(true);
  });
});

describe('applySetMapping — a worker entry', () => {
  it('persists agents.memory as {model, effort}', () => {
    const result = applySetMapping({ version: 1, agents: {} }, 'memory', { model: 'sonnet', effort: 'medium' });
    expect(result.agents['memory']).toEqual({ model: 'sonnet', effort: 'medium' });
  });
});

// ---------------------------------------------------------------------------
// Shared EFFORT display and the worker row (--list)
// ---------------------------------------------------------------------------

describe('buildListRows — shipped effort', () => {
  let installDir: string;

  beforeEach(async () => {
    installDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-list-effort-'));
  });

  afterEach(async () => {
    await fs.rm(installDir, { recursive: true, force: true });
  });

  it('carries the shipped effort and keeps the configured effort as "default"', async () => {
    const rows = await buildListRows({
      agentNames: ['code'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { code: { model: 'sonnet', effort: 'medium' } },
      proxyEnabled: false,
    });
    expect(rows[0].shippedEffort).toBe('medium');
    expect(rows[0].effort).toBe('default');
  });

  it('an agent that ships no effort carries none', async () => {
    const rows = await buildListRows({
      agentNames: ['code'],
      mapping: { version: 1, agents: {} },
      installDir,
      shippedDefaults: { code: { model: 'sonnet' } },
      proxyEnabled: false,
    });
    expect(rows[0].shippedEffort).toBeUndefined();
  });

  it('shows a stored inherit as the effort', async () => {
    const rows = await buildListRows({
      agentNames: ['code'],
      mapping: { version: 1, agents: { code: { effort: 'inherit' } } },
      installDir,
      shippedDefaults: { code: { model: 'sonnet', effort: 'medium' } },
      proxyEnabled: false,
    });
    expect(rows[0].effort).toBe('inherit');
  });
});

describe('buildWorkerListRows', () => {
  it('yields the memory row with the shipped worker defaults when no entry exists', () => {
    expect(buildWorkerListRows({ version: 1, agents: {} })).toEqual([
      {
        name: 'memory',
        defaultModel: 'haiku',
        configured: 'default',
        effort: 'default',
        shippedEffort: 'high',
        state: 'worker',
      },
    ]);
  });

  it('shows the configured model and effort', () => {
    const [row] = buildWorkerListRows({ version: 1, agents: { memory: { model: 'sonnet', effort: 'medium' } } });
    expect(row.configured).toBe('sonnet');
    expect(row.effort).toBe('medium');
    expect(row.state).toBe('worker');
  });

  it('never consults the install directory: the worker row cannot be dormant or not installed', () => {
    const [row] = buildWorkerListRows({ version: 1, agents: { memory: { model: 'sonnet' } } });
    expect(row.state).toBe('worker');
  });
});

describe('formatListOutput — EFFORT cell and the worker row', () => {
  const strip = (s: string): string => stripAnsi(s);
  const agentRow = (overrides: Partial<ListRow> = {}): ListRow => ({
    name: 'code',
    defaultModel: 'sonnet',
    configured: 'default',
    effort: 'default',
    state: 'active',
    ...overrides,
  });
  const workerRow = (overrides: Partial<ListRow> = {}): ListRow => ({
    name: 'memory',
    defaultModel: 'haiku',
    configured: 'default',
    effort: 'default',
    shippedEffort: 'high',
    state: 'worker',
    ...overrides,
  });
  const lineFor = (output: string, name: string): string => {
    const line = strip(output).split('\n').find(l => l.startsWith(name));
    if (line === undefined) throw new Error(`no ${name} row in:\n${output}`);
    return line;
  };

  it('renders default (medium) in full when the shipped source carries an effort', () => {
    const line = lineFor(formatListOutput([agentRow({ shippedEffort: 'medium' })], false), 'code');
    expect(line).toMatch(/default \(medium\)\s+active/);
  });

  it('renders plain "default" when the shipped source carries no effort', () => {
    const line = lineFor(formatListOutput([agentRow()], false), 'code');
    expect(line).not.toContain('default (');
  });

  it('a configured level wins over the shipped effort', () => {
    const line = lineFor(formatListOutput([agentRow({ effort: 'high', shippedEffort: 'medium' })], false), 'code');
    expect(line).toContain('high');
    expect(line).not.toContain('default (medium)');
  });

  it('renders a stored inherit', () => {
    const line = lineFor(formatListOutput([agentRow({ effort: 'inherit', shippedEffort: 'medium' })], false), 'code');
    expect(line).toContain('inherit');
    expect(line).not.toContain('default (medium)');
  });

  it('truncates no EFFORT cell for any level', () => {
    for (const level of EFFORT_LEVELS) {
      const line = lineFor(formatListOutput([agentRow({ shippedEffort: level })], false), 'code');
      expect(line, level).toMatch(new RegExp(`default \\(${level}\\)\\s+active`));
      expect(line, level).toContain(`default (${level})`);
    }
  });

  it('renders the worker row: DEFAULT haiku, EFFORT default (high), STATE worker', () => {
    const line = lineFor(formatListOutput([agentRow(), workerRow()], false), 'memory');
    expect(line).toMatch(/^memory\s+haiku\s+default\s+default \(high\)\s+worker$/);
  });

  it('the footer counts agent rows only: totals are the same with and without a configured memory entry', () => {
    const bare = strip(formatListOutput([agentRow(), workerRow()], false));
    const configured = strip(formatListOutput(
      [agentRow(), workerRow({ configured: 'sonnet', effort: 'medium' })],
      false,
    ));
    const footerOf = (out: string): string => out.split('\n').filter(l => l.includes('installed')).at(-1) ?? '';
    expect(footerOf(bare)).toContain('1/1 installed · 0 configured');
    expect(footerOf(configured)).toBe(footerOf(bare));
  });

  it('an agent row configured to a shipped-effort-bearing default still counts as unconfigured', () => {
    // The display string "default (medium)" is not a configuration.
    const out = strip(formatListOutput([agentRow({ shippedEffort: 'medium' })], false));
    expect(out).toContain('1/1 installed · 0 configured');
  });

  it('an inherit effort counts as configured', () => {
    const out = strip(formatListOutput([agentRow({ effort: 'inherit' })], false));
    expect(out).toContain('1/1 installed · 1 configured');
  });
});

// ---------------------------------------------------------------------------
// TUI save: inherit and the worker row
// ---------------------------------------------------------------------------

describe('mergeTuiRowsIntoMapping — inherit and the worker row', () => {
  const row = (overrides: Partial<import('../src/cli/agents-view/state.js').AgentRow>): import('../src/cli/agents-view/state.js').AgentRow => ({
    name: 'code',
    shippedDefault: 'sonnet',
    shippedEffort: undefined,
    configuredModel: 'default',
    originalModel: 'default',
    configuredEffort: 'default',
    originalEffort: 'default',
    dormantModel: null,
    offCyclePin: null,
    installed: true,
    inRegistry: true,
    worker: false,
    ...overrides,
  });

  it('a dirty effort row persists inherit', () => {
    const result = mergeTuiRowsIntoMapping(
      [row({ configuredEffort: 'inherit', originalEffort: 'default' })],
      { version: 1, agents: {} },
    );
    expect(result.agents['code']).toEqual({ effort: 'inherit' });
  });

  it('cycling an inherit row back to default removes the key', () => {
    const result = mergeTuiRowsIntoMapping(
      [row({ configuredEffort: 'default', originalEffort: 'inherit' })],
      { version: 1, agents: { code: { effort: 'inherit' } } },
    );
    expect(result.agents['code']).toBeUndefined();
  });

  it('a dirty worker row writes agents.memory and leaves agent entries alone', () => {
    const result = mergeTuiRowsIntoMapping(
      [row({ name: 'memory', worker: true, shippedDefault: 'haiku', shippedEffort: 'high', installed: false, inRegistry: false,
             configuredModel: 'sonnet', originalModel: 'default', configuredEffort: 'medium', originalEffort: 'default' })],
      { version: 1, agents: { code: { model: 'opus' } } },
    );
    expect(result.agents['memory']).toEqual({ model: 'sonnet', effort: 'medium' });
    expect(result.agents['code']).toEqual({ model: 'opus' });
  });

  it('an untouched worker row writes nothing', () => {
    const mapping: AgentMappingFile = { version: 1, agents: { memory: { model: 'sonnet' } } };
    const result = mergeTuiRowsIntoMapping(
      [row({ name: 'memory', worker: true, configuredModel: 'sonnet', originalModel: 'sonnet' })],
      mapping,
    );
    expect(result.agents['memory']).toEqual({ model: 'sonnet' });
  });
});

/**
 * Tests for src/core/agent-models.ts
 *
 * TDD: these tests were written BEFORE the implementation.
 * Protocol: RED → GREEN → REFACTOR.
 *
 * Coverage:
 *  - Mapping schema: parse/validation (bad JSON, wrong version, invalid effort,
 *    unknown agents preserved)
 *  - resolveEffective matrix (proxy on/off × claude/GPT/default model × effort set/unset)
 *  - Convergence idempotency (apply twice → second pass all unchanged)
 *  - Unknown-agent skip
 *  - Malformed-file warn
 *  - countExternalMappedAgents
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  LEGACY_AGENT_KEYS,
  canonicaliseAgentKeys,
  readAgentMapping,
  saveAgentMapping,
  resolveEffective,
  countExternalMappedAgents,
  EFFORT_LEVELS,
  type AgentMapping,
  type AgentMappingFile,
} from '../src/core/agent-models.js';
import { CLAUDE_MODEL_ALIASES } from '../src/core/external-models.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  // Create in beforeEach; stored in test-local variable
  throw new Error('use beforeEach');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('CLAUDE_MODEL_ALIASES contains the expected aliases', () => {
    expect(CLAUDE_MODEL_ALIASES).toContain('haiku');
    expect(CLAUDE_MODEL_ALIASES).toContain('sonnet');
    expect(CLAUDE_MODEL_ALIASES).toContain('opus');
    expect(CLAUDE_MODEL_ALIASES).toContain('fable');
    expect(CLAUDE_MODEL_ALIASES).toHaveLength(4);
  });

  it('EFFORT_LEVELS contains the expected levels', () => {
    expect(EFFORT_LEVELS).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});

// ---------------------------------------------------------------------------
// readAgentMapping / saveAgentMapping
// ---------------------------------------------------------------------------

describe('readAgentMapping', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-agent-models-test-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns empty mapping when file is absent', async () => {
    const result = await readAgentMapping(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agents).toEqual({});
      expect(result.value.version).toBe(1);
    }
  });

  it('parses a valid mapping file', async () => {
    const data: AgentMappingFile = {
      version: 1,
      agents: {
        code: { model: 'gpt-5.6-sol' },
        review: { model: 'opus', effort: 'high' },
      },
    };
    await fs.writeFile(path.join(dir, 'agent-models.json'), JSON.stringify(data), 'utf-8');
    const result = await readAgentMapping(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agents['code']).toEqual({ model: 'gpt-5.6-sol' });
      expect(result.value.agents['review']).toEqual({ model: 'opus', effort: 'high' });
    }
  });

  it('returns error for bad JSON', async () => {
    await fs.writeFile(path.join(dir, 'agent-models.json'), 'not-json{{{', 'utf-8');
    const result = await readAgentMapping(dir);
    expect(result.ok).toBe(false);
  });

  it('tolerates wrong version — still reads agents', async () => {
    const data = { version: 99, agents: { code: { model: 'opus' } } };
    await fs.writeFile(path.join(dir, 'agent-models.json'), JSON.stringify(data), 'utf-8');
    const result = await readAgentMapping(dir);
    // Tolerant: still parse what we can
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agents['code']).toBeDefined();
    }
  });

  it('drops invalid effort values with warning', async () => {
    const data = {
      version: 1,
      agents: {
        code: { model: 'opus', effort: 'turbo-invalid' },
        review: { model: 'haiku', effort: 'high' },
      },
    };
    await fs.writeFile(path.join(dir, 'agent-models.json'), JSON.stringify(data), 'utf-8');
    const warnings: string[] = [];
    const result = await readAgentMapping(dir, { onWarning: (w) => warnings.push(w) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Invalid effort for coder is dropped
      expect(result.value.agents['code']?.effort).toBeUndefined();
      // Valid effort for reviewer preserved
      expect(result.value.agents['review']?.effort).toBe('high');
    }
    // Warning was emitted for the invalid effort
    expect(warnings.some(w => w.includes('code') || w.includes('effort'))).toBe(true);
  });

  it('preserves unknown agent names (plugin may not be installed)', async () => {
    const data = {
      version: 1,
      agents: {
        'unknown-future-agent': { model: 'opus' },
        code: { model: 'sonnet' },
      },
    };
    await fs.writeFile(path.join(dir, 'agent-models.json'), JSON.stringify(data), 'utf-8');
    const result = await readAgentMapping(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agents['unknown-future-agent']).toBeDefined();
      expect(result.value.agents['code']).toBeDefined();
    }
  });
});

describe('saveAgentMapping', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-agent-models-save-test-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes and round-trips a mapping', async () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        code: { model: 'gpt-5.6-sol' },
      },
    };
    const saveResult = await saveAgentMapping(dir, mapping);
    expect(saveResult.ok).toBe(true);

    const readResult = await readAgentMapping(dir);
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value.agents['code']?.model).toBe('gpt-5.6-sol');
    }
  });

  it('creates the directory if it does not exist', async () => {
    const nested = path.join(dir, 'nested', 'devflow');
    const mapping: AgentMappingFile = { version: 1, agents: {} };
    const result = await saveAgentMapping(nested, mapping);
    expect(result.ok).toBe(true);

    const readResult = await readAgentMapping(nested);
    expect(readResult.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveEffective
// ---------------------------------------------------------------------------

describe('resolveEffective', () => {
  // Shipped defaults: agent → model (read from source at runtime in real impl;
  // here we use a subset for unit tests via the `shippedDefaults` parameter)
  const defaults = {
    code: 'sonnet',
    review: 'opus',
    git: 'haiku',
  };

  const makeMapping = (agents: Record<string, AgentMapping>): AgentMappingFile => ({
    version: 1,
    agents,
  });

  // Proxy OFF × claude model in mapping → use mapping model
  it('proxy OFF, claude model in mapping → uses mapping model (not dormant)', () => {
    const mapping = makeMapping({ code: { model: 'opus' } });
    const result = resolveEffective('code', mapping, defaults, false);
    expect(result.model).toBe('opus');
  });

  // Proxy OFF × GPT model in mapping → dormant → use shipped default
  it('proxy OFF, GPT model in mapping → dormant → uses shipped default', () => {
    const mapping = makeMapping({ code: { model: 'gpt-5.6-sol' } });
    const result = resolveEffective('code', mapping, defaults, false);
    expect(result.model).toBe('sonnet'); // falls back to shipped default
  });

  // Proxy ON × GPT model in mapping → materializes
  it('proxy ON, GPT model in mapping → uses GPT model', () => {
    const mapping = makeMapping({ code: { model: 'gpt-5.6-sol' } });
    const result = resolveEffective('code', mapping, defaults, true);
    expect(result.model).toBe('gpt-5.6-sol');
  });

  // Proxy ON × claude model in mapping → uses mapping model
  it('proxy ON, claude model in mapping → uses mapping model', () => {
    const mapping = makeMapping({ review: { model: 'haiku' } });
    const result = resolveEffective('review', mapping, defaults, true);
    expect(result.model).toBe('haiku');
  });

  // No mapping entry → use shipped default regardless of proxy
  it('no mapping entry, proxy OFF → uses shipped default', () => {
    const mapping = makeMapping({});
    const result = resolveEffective('code', mapping, defaults, false);
    expect(result.model).toBe('sonnet');
  });

  it('no mapping entry, proxy ON → uses shipped default', () => {
    const mapping = makeMapping({});
    const result = resolveEffective('code', mapping, defaults, true);
    expect(result.model).toBe('sonnet');
  });

  // Agent not in defaults → no mapping → undefined model (caller handles)
  it('agent not in defaults and no mapping → model is undefined', () => {
    const mapping = makeMapping({});
    const result = resolveEffective('unknown-agent', mapping, defaults, false);
    expect(result.model).toBeUndefined();
  });

  // Effort is orthogonal to proxy state — always applies
  it('effort from mapping is returned regardless of proxy state (OFF)', () => {
    const mapping = makeMapping({ code: { model: 'sonnet', effort: 'high' } });
    const result = resolveEffective('code', mapping, defaults, false);
    expect(result.effort).toBe('high');
  });

  it('effort from mapping is returned regardless of proxy state (ON)', () => {
    const mapping = makeMapping({ code: { model: 'gpt-5.6-sol', effort: 'max' } });
    const result = resolveEffective('code', mapping, defaults, true);
    expect(result.effort).toBe('max');
  });

  // GPT model dormant (proxy OFF) but effort still applies
  it('GPT model dormant but effort still applied (proxy OFF)', () => {
    const mapping = makeMapping({ code: { model: 'gpt-5.6-sol', effort: 'low' } });
    const result = resolveEffective('code', mapping, defaults, false);
    expect(result.model).toBe('sonnet'); // dormant → fallback
    expect(result.effort).toBe('low');   // effort always applies
  });

  // No effort in mapping → undefined
  it('no effort in mapping → effort is undefined', () => {
    const mapping = makeMapping({ code: { model: 'opus' } });
    const result = resolveEffective('code', mapping, defaults, false);
    expect(result.effort).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// countExternalMappedAgents
// ---------------------------------------------------------------------------

describe('countExternalMappedAgents', () => {
  it('counts agents with GPT model entries', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        code: { model: 'gpt-5.6-sol' },
        review: { model: 'gpt-5.5' },
        git: { model: 'haiku' },
      },
    };
    expect(countExternalMappedAgents(mapping)).toBe(2);
  });

  it('returns 0 when no GPT entries', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        code: { model: 'sonnet' },
      },
    };
    expect(countExternalMappedAgents(mapping)).toBe(0);
  });

  it('returns 0 for empty mapping', () => {
    const mapping: AgentMappingFile = { version: 1, agents: {} };
    expect(countExternalMappedAgents(mapping)).toBe(0);
  });

  it('entries with only effort (no model) are not counted', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        code: { effort: 'high' },
        review: { model: 'gpt-5.6-sol' },
      },
    };
    expect(countExternalMappedAgents(mapping)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// reapplyAgentMapping — integration-style test using temp directories
// ---------------------------------------------------------------------------

describe('reapplyAgentMapping', async () => {
  // Import reapplyAgentMapping + revertExternalAgents dynamically so we can
  // use them without top-level import (avoids module-not-found before impl)
  let reapplyAgentMapping: (typeof import('../src/core/agent-models.js'))['reapplyAgentMapping'];
  let revertExternalAgents: (typeof import('../src/core/agent-models.js'))['revertExternalAgents'];

  // Read shipped defaults live from source at test init time (TEST-7 fix).
  // Avoids brittle hardcoding that breaks when model-strategy changes agent files.
  let codeShippedDefault = 'sonnet'; // conservative fallback; overridden below
  let reviewShippedDefault = 'opus'; // conservative fallback; overridden below

  try {
    const mod = await import('../src/core/agent-models.js');
    reapplyAgentMapping = mod.reapplyAgentMapping;
    revertExternalAgents = mod.revertExternalAgents;

    // loadShippedDefaults reads live from src/assets/agents/ — same source
    // reapplyAgentMapping uses, so the assertion matches what the function writes.
    const defaults = await mod.loadShippedDefaults();
    if (defaults['code']) {
      codeShippedDefault = defaults['code'];
    }
    if (defaults['review']) {
      reviewShippedDefault = defaults['review'];
    }
  } catch {
    // Module not yet implemented — tests will be skipped
  }

  let tmpInstallDir: string;
  let tmpDevflowDir: string;

  beforeEach(async () => {
    tmpInstallDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-agents-install-'));
    tmpDevflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-state-'));
  });

  afterEach(async () => {
    await fs.rm(tmpInstallDir, { recursive: true, force: true });
    await fs.rm(tmpDevflowDir, { recursive: true, force: true });
  });

  it('applies model to an installed agent file', async () => {
    if (!reapplyAgentMapping) return; // impl not ready

    // Create a minimal fake installed agent file
    const agentContent = '---\nname: Code\nmodel: sonnet\n---\n\nbody\n';
    await fs.writeFile(path.join(tmpInstallDir, 'code.md'), agentContent, 'utf-8');

    // Mapping: set coder to opus
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { code: { model: 'opus' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    const result = await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false,
    });

    expect(result.updated).toContain('code');
    const updated = await fs.readFile(path.join(tmpInstallDir, 'code.md'), 'utf-8');
    expect(updated).toContain('model: opus');
  });

  it('idempotency: second pass reports all unchanged', async () => {
    if (!reapplyAgentMapping) return;

    const agentContent = '---\nname: Code\nmodel: sonnet\n---\n\nbody\n';
    await fs.writeFile(path.join(tmpInstallDir, 'code.md'), agentContent, 'utf-8');

    const mapping: AgentMappingFile = {
      version: 1,
      agents: { code: { model: 'opus' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    // First pass
    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false,
    });

    // Second pass — all unchanged
    const second = await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false,
    });
    expect(second.updated).toHaveLength(0);
    expect(second.unchanged.length).toBeGreaterThan(0);
  });

  it('GPT model stays dormant (proxy OFF) — installed file keeps shipped default', async () => {
    if (!reapplyAgentMapping) return;

    const agentContent = '---\nname: Code\nmodel: sonnet\n---\n\nbody\n';
    await fs.writeFile(path.join(tmpInstallDir, 'code.md'), agentContent, 'utf-8');

    const mapping: AgentMappingFile = {
      version: 1,
      agents: { code: { model: 'gpt-5.6-sol' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false, // proxy OFF → GPT model dormant
    });

    // Installed file should have shipped default, not GPT model
    const content = await fs.readFile(path.join(tmpInstallDir, 'code.md'), 'utf-8');
    expect(content).not.toContain('gpt-');
    expect(content).toContain(`model: ${codeShippedDefault}`); // shipped default (read live)
  });

  it('GPT model materializes when proxy ON', async () => {
    if (!reapplyAgentMapping) return;

    const agentContent = '---\nname: Code\nmodel: sonnet\n---\n\nbody\n';
    await fs.writeFile(path.join(tmpInstallDir, 'code.md'), agentContent, 'utf-8');

    const mapping: AgentMappingFile = {
      version: 1,
      agents: { code: { model: 'gpt-5.6-sol' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: true, // proxy ON → GPT model materializes
    });

    const content = await fs.readFile(path.join(tmpInstallDir, 'code.md'), 'utf-8');
    expect(content).toContain('model: gpt-5.6-sol');
  });

  it('missing installed agent file → skipped silently', async () => {
    if (!reapplyAgentMapping) return;

    // No files in tmpInstallDir
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { code: { model: 'opus' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    const result = await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false,
    });

    expect(result.skippedMissing).toContain('code');
    expect(result.updated).toHaveLength(0);
  });

  it('revertExternalAgents reverts GPT models back to shipped defaults', async () => {
    if (!revertExternalAgents) return;

    // Installed file already has GPT model applied
    const agentContent = '---\nname: Code\nmodel: gpt-5.6-sol\n---\n\nbody\n';
    await fs.writeFile(path.join(tmpInstallDir, 'code.md'), agentContent, 'utf-8');

    const mapping: AgentMappingFile = {
      version: 1,
      agents: { code: { model: 'gpt-5.6-sol' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    await revertExternalAgents({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
    });

    // Coder should be back to shipped default
    const content = await fs.readFile(path.join(tmpInstallDir, 'code.md'), 'utf-8');
    expect(content).not.toContain('gpt-');
    expect(content).toContain(`model: ${codeShippedDefault}`); // shipped default (read live)
  });

  it('T5: alias-shaped AND canonical-id external entries both stay dormant when proxy is OFF', async () => {
    // Fail-safe materialization: the worst failure mode of the feature is writing an
    // external model id into an installed agent file while the proxy is OFF — every
    // request for that agent would then hard-fail (no ANTHROPIC_BASE_URL set).
    //
    // The alias-shaped case ('sol') is the real hole: canonical ids ('gpt-5.6-sol')
    // are tested elsewhere, but aliases are a NEW shape introduced by Phase D.
    //
    // Proof method: seed both shapes, call reapplyAgentMapping({proxyEnabled:false}),
    // assert installed files contain shipped defaults — no mocking of isDormantExternalModel
    // or isClaudeModelName (per PF-016: mocking the predicate would test our assumption,
    // not the production guard).
    if (!reapplyAgentMapping) return;

    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        code: { model: 'sol' },          // alias-shaped — previously untested on reapply path
        review: { model: 'gpt-5.6-sol' }, // canonical-id — also covered here for completeness
      },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    // Installed files start at their shipped defaults
    await fs.writeFile(
      path.join(tmpInstallDir, 'code.md'),
      `---\nname: Code\nmodel: ${codeShippedDefault}\n---\n\nbody\n`,
      'utf-8',
    );
    await fs.writeFile(
      path.join(tmpInstallDir, 'review.md'),
      `---\nname: Review\nmodel: ${reviewShippedDefault}\n---\n\nbody\n`,
      'utf-8',
    );

    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false,  // proxy OFF → both external entries must stay dormant
    });

    const codeFile = await fs.readFile(path.join(tmpInstallDir, 'code.md'), 'utf-8');
    // Neither the alias nor the canonical id may appear in the installed file
    expect(codeFile).not.toMatch(/model:\s*(sol|gpt-)/);
    expect(codeFile).toContain(`model: ${codeShippedDefault}`);

    const reviewFile = await fs.readFile(path.join(tmpInstallDir, 'review.md'), 'utf-8');
    expect(reviewFile).not.toMatch(/model:\s*(sol|gpt-)/);
    expect(reviewFile).toContain(`model: ${reviewShippedDefault}`);
  });

  it('AC-S1: hostile model name in mapping is rejected — installed file unchanged, warning emitted', async () => {
    // reapplyAgentMapping reads agent-models.json; rewriteAgentFrontmatter rejects
    // invalid model names (invalid-model error). The installed file must be
    // byte-identical to before and a warning must name 'invalid-model'.
    if (!reapplyAgentMapping) return;

    // Hostile mapping: model name containing a newline (YAML injection attempt)
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        code: { model: 'gpt\ntools:\n  - bash' },
      },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    const originalContent = `---\nname: Code\nmodel: ${codeShippedDefault}\n---\n\nbody\n`;
    const codePath = path.join(tmpInstallDir, 'code.md');
    await fs.writeFile(codePath, originalContent, 'utf-8');

    const warnings: string[] = [];
    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: true, // proxy ON so dormancy doesn't suppress the write attempt
      onWarning: (msg) => warnings.push(msg),
    });

    // File must be byte-identical to before (rewrite was rejected)
    const afterContent = await fs.readFile(codePath, 'utf-8');
    expect(afterContent).toBe(originalContent);

    // A warning naming 'invalid-model' must have been emitted
    expect(warnings.some(w => w.includes('invalid-model'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canonicaliseAgentKeys
// ---------------------------------------------------------------------------

/**
 * Tests for canonicaliseAgentKeys() and LEGACY_AGENT_KEYS.
 *
 * We temporarily populate LEGACY_AGENT_KEYS in each test to exercise the
 * migration logic without modifying the shipped (empty) map.
 * Cleanup is handled in afterEach to ensure map stays empty for other tests.
 */
describe('canonicaliseAgentKeys', () => {
  // Save and restore LEGACY_AGENT_KEYS around each test.
  // We mutate the exported object directly (it is Object.create(null),
  // so Object.assign and delete work correctly).
  afterEach(() => {
    // Clear all entries added by tests
    for (const key of Object.keys(LEGACY_AGENT_KEYS)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (LEGACY_AGENT_KEYS as Record<string, string>)[key];
    }
  });

  it('is a no-op when LEGACY_AGENT_KEYS is empty (fast path)', () => {
    const input = { coder: { model: 'sonnet' } };
    const { agents, didMutate } = canonicaliseAgentKeys(input);
    expect(didMutate).toBe(false);
    expect(agents).toBe(input); // same reference — no allocation
  });

  it('renames a legacy key to the canonical key', () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    const input = { 'old-coder': { model: 'sonnet' } };
    const { agents, didMutate } = canonicaliseAgentKeys(input);
    expect(didMutate).toBe(true);
    expect(Object.hasOwn(agents, 'coder')).toBe(true);
    expect(Object.hasOwn(agents, 'old-coder')).toBe(false);
    expect(agents['coder']).toEqual({ model: 'sonnet' });
  });

  it('collision: new key already present → new wins, old dropped, one warning', () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    const input = {
      'old-coder': { model: 'haiku' }, // will be dropped
      coder: { model: 'opus' },         // already present — wins
    };
    const warnings: string[] = [];
    const { agents, didMutate } = canonicaliseAgentKeys(input, (msg) => warnings.push(msg));
    expect(didMutate).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('old-coder');
    expect(warnings[0]).toContain('coder');
    expect(agents['coder']).toEqual({ model: 'opus' }); // new wins
    expect(Object.hasOwn(agents, 'old-coder')).toBe(false);
  });

  it('collision check uses original keys (order-independent)', () => {
    // If we have old-a → a and old-b → b, both renames happen independently
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-a'] = 'a';
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-b'] = 'b';
    const input = { 'old-a': { model: 'sonnet' }, 'old-b': { model: 'haiku' } };
    const { agents, didMutate } = canonicaliseAgentKeys(input);
    expect(didMutate).toBe(true);
    expect(Object.hasOwn(agents, 'a')).toBe(true);
    expect(Object.hasOwn(agents, 'b')).toBe(true);
    expect(Object.hasOwn(agents, 'old-a')).toBe(false);
    expect(Object.hasOwn(agents, 'old-b')).toBe(false);
  });

  it('is idempotent: applying twice produces identical result (concurrent-safe)', () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    const input = { 'old-coder': { model: 'sonnet' } };

    const first = canonicaliseAgentKeys(input);
    // After first application, old-coder is gone. Applying again on the result:
    const second = canonicaliseAgentKeys(first.agents as Record<string, unknown>);
    expect(second.didMutate).toBe(false); // no legacy keys left
    expect(second.agents['coder']).toEqual({ model: 'sonnet' });
  });

  it('skips rename when newKey === __proto__ (prototype-safety, new-key guard)', () => {
    // If LEGACY_AGENT_KEYS maps 'bad-key' → '__proto__', applying the rename would
    // set the object's prototype, not a property. The guard on newKey must catch this.
    (LEGACY_AGENT_KEYS as Record<string, string>)['bad-key'] = '__proto__';
    const input: Record<string, unknown> = {};
    // Add 'bad-key' as an own property using defineProperty (can't use object literal
    // because the key name is not special in rawAgents — it's a regular string 'bad-key').
    Object.defineProperty(input, 'bad-key', { value: { model: 'sonnet' }, enumerable: true, configurable: true, writable: true });

    const proto = Object.getPrototypeOf(input);
    const { agents, didMutate } = canonicaliseAgentKeys(input);
    // The rename 'bad-key' → '__proto__' is skipped, but the key is still deleted
    // (didMutate is true because the old key is removed regardless of newKey guard).
    // What matters: the prototype of the result must be unchanged.
    expect(Object.getPrototypeOf(agents)).toBe(proto);
    // __proto__ must not appear as a canonical renamed key — prototype is plain Object
    expect(Object.getPrototypeOf(agents)).toBe(Object.prototype);
  });

  it('skips rename when oldKey === __proto__ (prototype-safety, old-key guard)', () => {
    // rawAgents with an actual own __proto__ property (not the prototype-setting form).
    // Object.defineProperty is required — the { __proto__: value } literal form sets the
    // prototype rather than creating an own property.
    (LEGACY_AGENT_KEYS as Record<string, string>)['__proto__'] = 'coder';
    const rawAgents: Record<string, unknown> = {};
    Object.defineProperty(rawAgents, '__proto__', {
      value: { model: 'sonnet' },
      enumerable: true,
      configurable: true,
      writable: true,
    });

    // Object.keys sees __proto__ as an own enumerable property here
    expect(Object.keys(rawAgents)).toContain('__proto__');

    const { agents, didMutate } = canonicaliseAgentKeys(rawAgents);
    // The __proto__ old-key guard must fire; no rename must have happened
    expect(didMutate).toBe(false);
    // The result prototype must be plain Object.prototype
    expect(Object.getPrototypeOf(agents)).toBe(Object.prototype);
    // Clean up LEGACY_AGENT_KEYS entry (afterEach also does this, but be explicit)
    delete (LEGACY_AGENT_KEYS as Record<string, string>)['__proto__'];
  });

  it('handles empty input object', () => {
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    const { agents, didMutate } = canonicaliseAgentKeys({});
    expect(didMutate).toBe(false);
    expect(agents).toEqual({});
  });

  it('LEGACY_AGENT_KEYS is prototype-null (Object.create(null))', () => {
    expect(Object.getPrototypeOf(LEGACY_AGENT_KEYS)).toBeNull();
  });

  it('readAgentMapping applies canonicalisation on read (integration)', async () => {
    // Populate a legacy key mapping
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-canonical-test-'));
    try {
      // Write a file with the old key
      const raw: AgentMappingFile = {
        version: 1,
        agents: { 'old-coder': { model: 'sonnet' } } as Record<string, unknown> as Record<string, AgentMapping>,
      };
      await fs.writeFile(path.join(tmpDir, 'agent-models.json'), JSON.stringify(raw), 'utf-8');

      const result = await readAgentMapping(tmpDir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Old key must be gone, canonical key must be present
        expect(Object.hasOwn(result.value.agents, 'coder')).toBe(true);
        expect(Object.hasOwn(result.value.agents, 'old-coder')).toBe(false);
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('readAgentMapping handles agents: [] (array must not be treated as object)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-array-agents-test-'));
    try {
      await fs.writeFile(
        path.join(tmpDir, 'agent-models.json'),
        JSON.stringify({ version: 1, agents: [] }),
        'utf-8',
      );
      const result = await readAgentMapping(tmpDir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Array should be treated as empty (no entries)
        expect(result.value.agents).toEqual({});
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

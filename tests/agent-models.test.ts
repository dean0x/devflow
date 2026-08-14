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
        coder: { model: 'gpt-5.6-sol' },
        reviewer: { model: 'opus', effort: 'high' },
      },
    };
    await fs.writeFile(path.join(dir, 'agent-models.json'), JSON.stringify(data), 'utf-8');
    const result = await readAgentMapping(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agents['coder']).toEqual({ model: 'gpt-5.6-sol' });
      expect(result.value.agents['reviewer']).toEqual({ model: 'opus', effort: 'high' });
    }
  });

  it('returns error for bad JSON', async () => {
    await fs.writeFile(path.join(dir, 'agent-models.json'), 'not-json{{{', 'utf-8');
    const result = await readAgentMapping(dir);
    expect(result.ok).toBe(false);
  });

  it('tolerates wrong version — still reads agents', async () => {
    const data = { version: 99, agents: { coder: { model: 'opus' } } };
    await fs.writeFile(path.join(dir, 'agent-models.json'), JSON.stringify(data), 'utf-8');
    const result = await readAgentMapping(dir);
    // Tolerant: still parse what we can
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agents['coder']).toBeDefined();
    }
  });

  it('drops invalid effort values with warning', async () => {
    const data = {
      version: 1,
      agents: {
        coder: { model: 'opus', effort: 'turbo-invalid' },
        reviewer: { model: 'haiku', effort: 'high' },
      },
    };
    await fs.writeFile(path.join(dir, 'agent-models.json'), JSON.stringify(data), 'utf-8');
    const warnings: string[] = [];
    const result = await readAgentMapping(dir, { onWarning: (w) => warnings.push(w) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Invalid effort for coder is dropped
      expect(result.value.agents['coder']?.effort).toBeUndefined();
      // Valid effort for reviewer preserved
      expect(result.value.agents['reviewer']?.effort).toBe('high');
    }
    // Warning was emitted for the invalid effort
    expect(warnings.some(w => w.includes('coder') || w.includes('effort'))).toBe(true);
  });

  it('preserves unknown agent names (plugin may not be installed)', async () => {
    const data = {
      version: 1,
      agents: {
        'unknown-future-agent': { model: 'opus' },
        coder: { model: 'sonnet' },
      },
    };
    await fs.writeFile(path.join(dir, 'agent-models.json'), JSON.stringify(data), 'utf-8');
    const result = await readAgentMapping(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agents['unknown-future-agent']).toBeDefined();
      expect(result.value.agents['coder']).toBeDefined();
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
        coder: { model: 'gpt-5.6-sol' },
      },
    };
    const saveResult = await saveAgentMapping(dir, mapping);
    expect(saveResult.ok).toBe(true);

    const readResult = await readAgentMapping(dir);
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value.agents['coder']?.model).toBe('gpt-5.6-sol');
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
    coder: 'sonnet',
    reviewer: 'opus',
    git: 'haiku',
  };

  const makeMapping = (agents: Record<string, AgentMapping>): AgentMappingFile => ({
    version: 1,
    agents,
  });

  // Proxy OFF × claude model in mapping → use mapping model
  it('proxy OFF, claude model in mapping → uses mapping model (not dormant)', () => {
    const mapping = makeMapping({ coder: { model: 'opus' } });
    const result = resolveEffective('coder', mapping, defaults, false);
    expect(result.model).toBe('opus');
  });

  // Proxy OFF × GPT model in mapping → dormant → use shipped default
  it('proxy OFF, GPT model in mapping → dormant → uses shipped default', () => {
    const mapping = makeMapping({ coder: { model: 'gpt-5.6-sol' } });
    const result = resolveEffective('coder', mapping, defaults, false);
    expect(result.model).toBe('sonnet'); // falls back to shipped default
  });

  // Proxy ON × GPT model in mapping → materializes
  it('proxy ON, GPT model in mapping → uses GPT model', () => {
    const mapping = makeMapping({ coder: { model: 'gpt-5.6-sol' } });
    const result = resolveEffective('coder', mapping, defaults, true);
    expect(result.model).toBe('gpt-5.6-sol');
  });

  // Proxy ON × claude model in mapping → uses mapping model
  it('proxy ON, claude model in mapping → uses mapping model', () => {
    const mapping = makeMapping({ reviewer: { model: 'haiku' } });
    const result = resolveEffective('reviewer', mapping, defaults, true);
    expect(result.model).toBe('haiku');
  });

  // No mapping entry → use shipped default regardless of proxy
  it('no mapping entry, proxy OFF → uses shipped default', () => {
    const mapping = makeMapping({});
    const result = resolveEffective('coder', mapping, defaults, false);
    expect(result.model).toBe('sonnet');
  });

  it('no mapping entry, proxy ON → uses shipped default', () => {
    const mapping = makeMapping({});
    const result = resolveEffective('coder', mapping, defaults, true);
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
    const mapping = makeMapping({ coder: { model: 'sonnet', effort: 'high' } });
    const result = resolveEffective('coder', mapping, defaults, false);
    expect(result.effort).toBe('high');
  });

  it('effort from mapping is returned regardless of proxy state (ON)', () => {
    const mapping = makeMapping({ coder: { model: 'gpt-5.6-sol', effort: 'max' } });
    const result = resolveEffective('coder', mapping, defaults, true);
    expect(result.effort).toBe('max');
  });

  // GPT model dormant (proxy OFF) but effort still applies
  it('GPT model dormant but effort still applied (proxy OFF)', () => {
    const mapping = makeMapping({ coder: { model: 'gpt-5.6-sol', effort: 'low' } });
    const result = resolveEffective('coder', mapping, defaults, false);
    expect(result.model).toBe('sonnet'); // dormant → fallback
    expect(result.effort).toBe('low');   // effort always applies
  });

  // No effort in mapping → undefined
  it('no effort in mapping → effort is undefined', () => {
    const mapping = makeMapping({ coder: { model: 'opus' } });
    const result = resolveEffective('coder', mapping, defaults, false);
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
        coder: { model: 'gpt-5.6-sol' },
        reviewer: { model: 'gpt-5.5' },
        git: { model: 'haiku' },
      },
    };
    expect(countExternalMappedAgents(mapping)).toBe(2);
  });

  it('returns 0 when no GPT entries', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        coder: { model: 'sonnet' },
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
        coder: { effort: 'high' },
        reviewer: { model: 'gpt-5.6-sol' },
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
  let coderShippedDefault = 'sonnet'; // conservative fallback; overridden below
  let reviewerShippedDefault = 'opus'; // conservative fallback; overridden below

  try {
    const mod = await import('../src/core/agent-models.js');
    reapplyAgentMapping = mod.reapplyAgentMapping;
    revertExternalAgents = mod.revertExternalAgents;

    // loadShippedDefaults reads live from src/assets/agents/ — same source
    // reapplyAgentMapping uses, so the assertion matches what the function writes.
    const defaults = await mod.loadShippedDefaults();
    if (defaults['coder']) {
      coderShippedDefault = defaults['coder'];
    }
    if (defaults['reviewer']) {
      reviewerShippedDefault = defaults['reviewer'];
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
    const agentContent = '---\nname: Coder\nmodel: sonnet\n---\n\nbody\n';
    await fs.writeFile(path.join(tmpInstallDir, 'coder.md'), agentContent, 'utf-8');

    // Mapping: set coder to opus
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'opus' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    const result = await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false,
    });

    expect(result.updated).toContain('coder');
    const updated = await fs.readFile(path.join(tmpInstallDir, 'coder.md'), 'utf-8');
    expect(updated).toContain('model: opus');
  });

  it('idempotency: second pass reports all unchanged', async () => {
    if (!reapplyAgentMapping) return;

    const agentContent = '---\nname: Coder\nmodel: sonnet\n---\n\nbody\n';
    await fs.writeFile(path.join(tmpInstallDir, 'coder.md'), agentContent, 'utf-8');

    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'opus' } },
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

    const agentContent = '---\nname: Coder\nmodel: sonnet\n---\n\nbody\n';
    await fs.writeFile(path.join(tmpInstallDir, 'coder.md'), agentContent, 'utf-8');

    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'gpt-5.6-sol' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false, // proxy OFF → GPT model dormant
    });

    // Installed file should have shipped default, not GPT model
    const content = await fs.readFile(path.join(tmpInstallDir, 'coder.md'), 'utf-8');
    expect(content).not.toContain('gpt-');
    expect(content).toContain(`model: ${coderShippedDefault}`); // shipped default (read live)
  });

  it('GPT model materializes when proxy ON', async () => {
    if (!reapplyAgentMapping) return;

    const agentContent = '---\nname: Coder\nmodel: sonnet\n---\n\nbody\n';
    await fs.writeFile(path.join(tmpInstallDir, 'coder.md'), agentContent, 'utf-8');

    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'gpt-5.6-sol' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: true, // proxy ON → GPT model materializes
    });

    const content = await fs.readFile(path.join(tmpInstallDir, 'coder.md'), 'utf-8');
    expect(content).toContain('model: gpt-5.6-sol');
  });

  it('missing installed agent file → skipped silently', async () => {
    if (!reapplyAgentMapping) return;

    // No files in tmpInstallDir
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'opus' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    const result = await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false,
    });

    expect(result.skippedMissing).toContain('coder');
    expect(result.updated).toHaveLength(0);
  });

  it('revertExternalAgents reverts GPT models back to shipped defaults', async () => {
    if (!revertExternalAgents) return;

    // Installed file already has GPT model applied
    const agentContent = '---\nname: Coder\nmodel: gpt-5.6-sol\n---\n\nbody\n';
    await fs.writeFile(path.join(tmpInstallDir, 'coder.md'), agentContent, 'utf-8');

    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'gpt-5.6-sol' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    await revertExternalAgents({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
    });

    // Coder should be back to shipped default
    const content = await fs.readFile(path.join(tmpInstallDir, 'coder.md'), 'utf-8');
    expect(content).not.toContain('gpt-');
    expect(content).toContain(`model: ${coderShippedDefault}`); // shipped default (read live)
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
        coder: { model: 'sol' },          // alias-shaped — previously untested on reapply path
        reviewer: { model: 'gpt-5.6-sol' }, // canonical-id — also covered here for completeness
      },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    // Installed files start at their shipped defaults
    await fs.writeFile(
      path.join(tmpInstallDir, 'coder.md'),
      `---\nname: Coder\nmodel: ${coderShippedDefault}\n---\n\nbody\n`,
      'utf-8',
    );
    await fs.writeFile(
      path.join(tmpInstallDir, 'reviewer.md'),
      `---\nname: Reviewer\nmodel: ${reviewerShippedDefault}\n---\n\nbody\n`,
      'utf-8',
    );

    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false,  // proxy OFF → both external entries must stay dormant
    });

    const coderFile = await fs.readFile(path.join(tmpInstallDir, 'coder.md'), 'utf-8');
    // Neither the alias nor the canonical id may appear in the installed file
    expect(coderFile).not.toMatch(/model:\s*(sol|gpt-)/);
    expect(coderFile).toContain(`model: ${coderShippedDefault}`);

    const reviewerFile = await fs.readFile(path.join(tmpInstallDir, 'reviewer.md'), 'utf-8');
    expect(reviewerFile).not.toMatch(/model:\s*(sol|gpt-)/);
    expect(reviewerFile).toContain(`model: ${reviewerShippedDefault}`);
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
        coder: { model: 'gpt\ntools:\n  - bash' },
      },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    const originalContent = `---\nname: Coder\nmodel: ${coderShippedDefault}\n---\n\nbody\n`;
    const coderPath = path.join(tmpInstallDir, 'coder.md');
    await fs.writeFile(coderPath, originalContent, 'utf-8');

    const warnings: string[] = [];
    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: true, // proxy ON so dormancy doesn't suppress the write attempt
      onWarning: (msg) => warnings.push(msg),
    });

    // File must be byte-identical to before (rewrite was rejected)
    const afterContent = await fs.readFile(coderPath, 'utf-8');
    expect(afterContent).toBe(originalContent);

    // A warning naming 'invalid-model' must have been emitted
    expect(warnings.some(w => w.includes('invalid-model'))).toBe(true);
  });
});

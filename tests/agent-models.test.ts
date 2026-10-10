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
  carryAgentOverrides,
  canonicaliseAgentKeys,
  parseAgentMappingEnvelope,
  readAgentMapping,
  saveAgentMapping,
  resolveEffective,
  countExternalMappedAgents,
  readInstalledAgentNames,
  reapplyAgentMapping,
  revertExternalAgents,
  loadShippedAgentDefaults,
  EFFORT_LEVELS,
  type AgentMapping,
  type AgentMappingFile,
} from '../src/core/agent-models.js';
import { CLAUDE_MODEL_ALIASES } from '../src/core/external-models.js';
import { getAllAgentNames } from '../src/core/plugins.js';

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

  it('F1: tolerates a BOM-prefixed JSON file (BOM stripped before parse)', async () => {
    // Windows editors often prepend U+FEFF to JSON files; JSON.parse rejects it.
    // parseAgentMappingEnvelope strips the BOM — readAgentMapping must share that path.
    const data = { version: 1, agents: { code: { model: 'opus' } } };
    const bom = '﻿';
    await fs.writeFile(path.join(dir, 'agent-models.json'), bom + JSON.stringify(data), 'utf-8');
    const result = await readAgentMapping(dir);
    expect(result.ok, 'BOM-prefixed file must be parseable (not an Err)').toBe(true);
    if (result.ok) {
      expect(result.value.agents['code']).toEqual({ model: 'opus' });
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
  // Shipped defaults: agent → { model, effort? } (read from source at runtime in
  // the real impl; here we use a subset for unit tests via the `shippedDefaults` parameter)
  const defaults = {
    code: { model: 'sonnet' },
    review: { model: 'opus' },
    git: { model: 'haiku' },
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

  // No effort in mapping and none shipped → undefined
  it('no effort in mapping and none shipped → effort is undefined', () => {
    const mapping = makeMapping({ code: { model: 'opus' } });
    const result = resolveEffective('code', mapping, defaults, false);
    expect(result.effort).toBeUndefined();
  });

  describe('shipped effort (D-SHIPPED-EFFORT)', () => {
    const shipped = {
      code: { model: 'sonnet', effort: 'medium' as const },
      review: { model: 'opus' },
    };

    it('a mapping effort level wins over the shipped effort', () => {
      const mapping = makeMapping({ code: { effort: 'max' } });
      expect(resolveEffective('code', mapping, shipped, false).effort).toBe('max');
    });

    it('no mapping entry → the shipped effort applies', () => {
      expect(resolveEffective('code', makeMapping({}), shipped, false).effort).toBe('medium');
    });

    it('a mapping entry without an effort → the shipped effort applies', () => {
      const mapping = makeMapping({ code: { model: 'opus' } });
      const result = resolveEffective('code', mapping, shipped, false);
      expect(result.model).toBe('opus');
      expect(result.effort).toBe('medium');
    });

    it('a mapping inherit yields no effort and does not fall back to the shipped effort', () => {
      const mapping = makeMapping({ code: { effort: 'inherit' } });
      expect(resolveEffective('code', mapping, shipped, false).effort).toBeUndefined();
    });

    it('an agent that ships no effort stays without one', () => {
      expect(resolveEffective('review', makeMapping({}), shipped, true).effort).toBeUndefined();
    });

    it('proxy OFF with a dormant external model: shipped model, shipped effort still applies', () => {
      const mapping = makeMapping({ code: { model: 'gpt-5.6-sol' } });
      const result = resolveEffective('code', mapping, shipped, false);
      expect(result.model).toBe('sonnet');
      expect(result.effort).toBe('medium');
    });

    it('proxy state never changes the effort', () => {
      const mapping = makeMapping({ code: { model: 'gpt-5.6-sol' } });
      expect(resolveEffective('code', mapping, shipped, true).effort).toBe('medium');
    });
  });

  // D-LEARNING-MODEL-PRECEDENCE: the session-start hook lets a Learning mapping
  // decide the spawn's model by omitting model=, so the installed frontmatter is
  // what runs. With the proxy off an external mapping model is dormant, and the
  // frontmatter the reapply writes must be the shipped Learning model.
  it('learning: a dormant external mapping resolves to the shipped Learning model while the proxy is off', () => {
    const mapping = makeMapping({ learning: { model: 'gpt-5.5' } });
    const shipped = { learning: { model: 'opus' } };

    expect(resolveEffective('learning', mapping, shipped, false).model).toBe('opus');
    expect(resolveEffective('learning', mapping, shipped, true).model).toBe('gpt-5.5');
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
  // Read shipped defaults live from source at test init time (TEST-7 fix).
  // Avoids brittle hardcoding that breaks when model-strategy changes agent files.
  const defaults = await loadShippedAgentDefaults();
  const codeShippedDefault = defaults['code']?.model ?? 'sonnet';
  const reviewShippedDefault = defaults['review']?.model ?? 'opus';
  // D-SHIPPED-EFFORT: an agent that ships an effort keeps it across a reapply, so the
  // shipped-default frontmatter of `code` carries that effort line when it ships one.
  const codeShippedEffortLine = defaults['code']?.effort === undefined ? '' : `effort: ${defaults['code'].effort}\n`;
  const codeShippedFrontmatter = `---\nname: Code\nmodel: ${codeShippedDefault}\n${codeShippedEffortLine}---\n\nbody\n`;

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
    // or isClaudeModelName (mocking the predicate would test our assumption,
    // not the production guard).

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

  it('AC-S1: hostile model name in mapping is rejected — installed file stays at the shipped default, warning emitted', async () => {
    // readAgentMapping drops a mapping entry whose model name is invalid, so the agent has
    // no mapping and reapply resolves its shipped default (D-SHIPPED-EFFORT: shipped model
    // AND shipped effort). The hostile value is never written, and an installed file that
    // already holds the shipped default stays byte-identical. A warning must name
    // 'invalid-model'.

    // Hostile mapping: model name containing a newline (YAML injection attempt)
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        code: { model: 'gpt\ntools:\n  - bash' },
      },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    const codePath = path.join(tmpInstallDir, 'code.md');
    await fs.writeFile(codePath, codeShippedFrontmatter, 'utf-8');

    const warnings: string[] = [];
    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: true, // proxy ON so dormancy doesn't suppress the write attempt
      onWarning: (msg) => warnings.push(msg),
    });

    // File must be byte-identical to before (the rejected entry changed nothing)
    const afterContent = await fs.readFile(codePath, 'utf-8');
    expect(afterContent).toBe(codeShippedFrontmatter);

    // A warning naming 'invalid-model' must have been emitted
    expect(warnings.some(w => w.includes('invalid-model'))).toBe(true);
  });

  it('AC-S1: a rejected mapping entry means the shipped default — a file without the shipped effort converges to it', async () => {
    // The dropped entry leaves `code` with no mapping, so reapply writes what devflow ships
    // for it (model and effort), and still injects nothing from the hostile value.
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        code: { model: 'gpt\ntools:\n  - bash' },
      },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    const codePath = path.join(tmpInstallDir, 'code.md');
    await fs.writeFile(codePath, `---\nname: Code\nmodel: ${codeShippedDefault}\n---\n\nbody\n`, 'utf-8');

    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: true,
    });

    const afterContent = await fs.readFile(codePath, 'utf-8');
    expect(afterContent).toBe(codeShippedFrontmatter);
    expect(afterContent).not.toContain('tools:');
  });

  it('A3: path-traversal mapping key is warned and skipped — containment guard', async () => {
    // A corrupted or adversarial agent-models.json may contain a key like
    // '../../evil' that would resolve outside opts.installDir. The guard must
    // emit a warning and skip, never reading or writing outside the install dir.

    const traversalKey = '../../a3-traversal-sentinel';
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { [traversalKey]: { model: 'opus' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    const warnings: string[] = [];
    const result = await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false,
      onWarning: (msg) => warnings.push(msg),
    });

    // The traversal key must be in skippedMissing (containment guard fires before readFile).
    expect(result.skippedMissing).toContain(traversalKey);
    // A warning mentioning the traversal key must have been emitted.
    expect(warnings.some(w => w.includes(traversalKey))).toBe(true);
    // The warning must mention the containment guard, not a generic message.
    expect(warnings.some(w => w.includes('containment guard') || w.includes('resolves outside'))).toBe(true);
  });

  it('F13: traversal key whose TARGET EXISTS outside installDir is still blocked by the containment guard', async () => {
    // The guard must block based on the resolved path, not on ENOENT from the target.
    // Create a sentinel file OUTSIDE the install dir — the guard must fire (not ENOENT)
    // and the file must remain byte-identical (never touched).
    const sentinelName = 'f13-traversal-target-exists';
    const sentinelPath = path.join(tmpDevflowDir, sentinelName);
    const originalContent = '# sentinel — must not be modified\n';
    await fs.writeFile(sentinelPath, originalContent, 'utf-8');

    // The traversal key resolves the sentinel through the install dir
    const traversalKey = `../../${path.relative(path.dirname(tmpInstallDir), tmpDevflowDir)}/${sentinelName}`;
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { [traversalKey]: { model: 'opus' } },
    };
    await saveAgentMapping(tmpDevflowDir, mapping);

    const warnings: string[] = [];
    await reapplyAgentMapping({
      installDir: tmpInstallDir,
      devflowDir: tmpDevflowDir,
      proxyEnabled: false,
      onWarning: (msg) => warnings.push(msg),
    });

    // The sentinel file outside installDir must remain byte-identical (guard blocked it).
    const afterContent = await fs.readFile(sentinelPath, 'utf-8');
    expect(afterContent).toBe(originalContent);

    // A containment-guard warning must have fired (not ENOENT — the file exists).
    expect(warnings.some(w => w.includes('containment guard') || w.includes('resolves outside'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readInstalledAgentNames
// ---------------------------------------------------------------------------

describe('readInstalledAgentNames', () => {
  let tmpInstall: string;

  beforeEach(async () => {
    tmpInstall = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-riq-'));
  });

  afterEach(async () => {
    await fs.rm(tmpInstall, { recursive: true, force: true });
  });

  it('returns empty set when directory does not exist (ENOENT)', async () => {
    const missing = path.join(tmpInstall, 'nonexistent');
    const result = await readInstalledAgentNames(missing);
    expect(result.size).toBe(0);
  });

  it('returns empty set when path is a file, not a directory (ENOTDIR)', async () => {
    // Place a regular file at the target path; readdir will error with ENOTDIR.
    const filePath = path.join(tmpInstall, 'not-a-dir');
    await fs.writeFile(filePath, 'I am a file', 'utf-8');
    const result = await readInstalledAgentNames(filePath);
    expect(result.size).toBe(0);
  });

  it('returns names of .md files in a valid directory', async () => {
    await fs.writeFile(path.join(tmpInstall, 'code.md'), '', 'utf-8');
    await fs.writeFile(path.join(tmpInstall, 'review.md'), '', 'utf-8');
    const result = await readInstalledAgentNames(tmpInstall);
    expect(result.has('code')).toBe(true);
    expect(result.has('review')).toBe(true);
    expect(result.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// canonicaliseAgentKeys
// ---------------------------------------------------------------------------

/**
 * Tests for canonicaliseAgentKeys() and LEGACY_AGENT_KEYS.
 *
 * We temporarily populate LEGACY_AGENT_KEYS in each test to exercise the
 * migration logic without disturbing the shipped map or other tests.
 * Cleanup is handled by beforeEach/afterEach: clear → test body → restore.
 *
 * SCOPE LIMIT: every test below runs against a map this suite EMPTIED first and
 * then seeded with synthetic entries. Nothing here can detect that the shipped
 * 13-entry map regressed to empty. That coverage lives in GAP-6
 * ("shipped LEGACY_AGENT_KEYS integrity") in tests/agent-name-guards.test.ts,
 * which reads the map as shipped and never mutates it. Do not add
 * shipped-map assertions here — beforeEach would defeat them.
 */
describe('canonicaliseAgentKeys', () => {
  // Snapshot the shipped entries at describe-eval time so they can be
  // restored after each test. Tests that need specific entries add them
  // themselves; tests that need an empty map rely on the clear in beforeEach.
  const SHIPPED_ENTRIES: Record<string, string> = { ...LEGACY_AGENT_KEYS };

  beforeEach(() => {
    // Clear the map so each test starts from a known-empty state.
    // Tests that need entries add them in their bodies.
    for (const key of Object.keys(LEGACY_AGENT_KEYS)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (LEGACY_AGENT_KEYS as Record<string, string>)[key];
    }
  });

  afterEach(() => {
    // Clear any entries added by the test body, then restore shipped state.
    for (const key of Object.keys(LEGACY_AGENT_KEYS)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (LEGACY_AGENT_KEYS as Record<string, string>)[key];
    }
    Object.assign(LEGACY_AGENT_KEYS, SHIPPED_ENTRIES);
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
    const { agents, didMutate, renamed, dropped } = canonicaliseAgentKeys(input);
    expect(didMutate).toBe(true);
    expect(Object.hasOwn(agents, 'coder')).toBe(true);
    expect(Object.hasOwn(agents, 'old-coder')).toBe(false);
    expect(agents['coder']).toEqual({ model: 'sonnet' });
    expect(renamed).toEqual(['old-coder']);
    expect(dropped).toEqual([]);
  });

  it('collision: new key already present → new wins, old dropped, no inline warn (caller surfaces via dropped array)', () => {
    // F8: The collision warning is surfaced by the caller's structured dropped-block
    // (e.g. migrations.ts) rather than via onWarning here, to avoid double-reporting
    // the same event in two different vocabularies. onWarning fires 0 times for collision.
    (LEGACY_AGENT_KEYS as Record<string, string>)['old-coder'] = 'coder';
    const input = {
      'old-coder': { model: 'haiku' }, // will be dropped
      coder: { model: 'opus' },         // already present — wins
    };
    const warnings: string[] = [];
    const { agents, didMutate, renamed, dropped } = canonicaliseAgentKeys(input, (msg) => warnings.push(msg));
    expect(didMutate).toBe(true);
    // No inline warning — collision is reported by the caller's structured dropped array.
    expect(warnings).toHaveLength(0);
    expect(agents['coder']).toEqual({ model: 'opus' }); // new wins
    expect(Object.hasOwn(agents, 'old-coder')).toBe(false);
    expect(renamed).toEqual([]);
    expect(dropped).toEqual(['old-coder']);
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
    const { agents, didMutate, dropped, guardDropped } = canonicaliseAgentKeys(input);
    // The rename 'bad-key' → '__proto__' is skipped, but the key is still deleted
    // (didMutate is true because the old key is removed regardless of newKey guard).
    // What matters: the prototype of the result must be unchanged.
    expect(Object.getPrototypeOf(agents)).toBe(proto);
    // __proto__ must not appear as a canonical renamed key — prototype is plain Object
    expect(Object.getPrototypeOf(agents)).toBe(Object.prototype);
    // The drop must be reported under guardDropped (pollution-guard reason), NOT under
    // dropped (which is reserved for canonical-key-collision reason).
    expect(dropped).toEqual([]);
    expect(guardDropped).toEqual(['bad-key']);
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

    const { agents, didMutate, dropped, guardDropped } = canonicaliseAgentKeys(rawAgents);
    // The __proto__ old-key guard must fire and report a truthful result:
    // - didMutate is true (the key was deleted from the output object)
    // - dropped is empty (prototype-guard skips are NOT collision drops)
    // - guardDropped records the skipped key under the correct category
    expect(didMutate).toBe(true);
    expect(dropped).toEqual([]);
    expect(guardDropped).toEqual(['__proto__']);
    // The result prototype must be plain Object.prototype (guard must not pollute it)
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

// ---------------------------------------------------------------------------
// parseAgentMappingEnvelope — direct unit tests (one per parser arm)
// ---------------------------------------------------------------------------

/**
 * Direct tests for parseAgentMappingEnvelope().
 *
 * Plan item B6 required "one per parser arm": ok, skip, warn.
 * The function was previously covered only transitively through the
 * canonicalise-agent-keys-v1 migration harness.
 *
 * Each arm is pinned via its discriminant (`kind`) and the detail substrings
 * the migration tests already rely on.
 */
describe('parseAgentMappingEnvelope', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-parse-envelope-'));
    filePath = path.join(dir, 'agent-models.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // --- ok arm ---

  it('ok: valid envelope with agents object returns kind=ok and rawAgents verbatim', async () => {
    // {"agents":{"x":42}} — rawAgents.x must be 42 (no coercion, no filtering)
    await fs.writeFile(filePath, '{"agents":{"x":42}}', 'utf-8');
    const result = await parseAgentMappingEnvelope(filePath);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.rawAgents['x']).toBe(42);
    }
  });

  // --- skip arms ---

  it('skip: file absent (ENOENT) returns kind=skip', async () => {
    const missing = path.join(dir, 'nonexistent.json');
    const result = await parseAgentMappingEnvelope(missing);
    expect(result.kind).toBe('skip');
  });

  it('skip: empty file returns kind=skip', async () => {
    await fs.writeFile(filePath, '', 'utf-8');
    const result = await parseAgentMappingEnvelope(filePath);
    expect(result.kind).toBe('skip');
  });

  it('skip: BOM-only file returns kind=skip', async () => {
    // U+FEFF stripped → empty string → skip
    await fs.writeFile(filePath, '﻿', 'utf-8');
    const result = await parseAgentMappingEnvelope(filePath);
    expect(result.kind).toBe('skip');
  });

  // --- warn arms ---

  it('warn: invalid JSON — message contains "invalid JSON"', async () => {
    await fs.writeFile(filePath, 'not valid json {{{', 'utf-8');
    const result = await parseAgentMappingEnvelope(filePath);
    expect(result.kind).toBe('warn');
    if (result.kind === 'warn') {
      expect(result.message).toContain('invalid JSON');
    }
  });

  it('warn: unreadable file — message contains "cannot read"', async () => {
    await fs.writeFile(filePath, '{"agents":{}}', 'utf-8');
    await fs.chmod(filePath, 0o000);

    // Guard: running as root ignores mode bits — skip rather than assert falsely.
    let readable = true;
    try { await fs.readFile(filePath, 'utf-8'); } catch { readable = false; }
    if (readable) {
      await fs.chmod(filePath, 0o644);
      return;
    }

    try {
      const result = await parseAgentMappingEnvelope(filePath);
      expect(result.kind).toBe('warn');
      if (result.kind === 'warn') {
        expect(result.message).toContain('cannot read');
      }
    } finally {
      await fs.chmod(filePath, 0o644).catch(() => undefined);
    }
  });

  it('warn: non-object agents field — message contains "non-object agents field"', async () => {
    await fs.writeFile(filePath, '{"agents":[1,2,3]}', 'utf-8');
    const result = await parseAgentMappingEnvelope(filePath);
    expect(result.kind).toBe('warn');
    if (result.kind === 'warn') {
      expect(result.message).toContain('non-object agents field');
    }
  });

  // --- arms ~:247-249 and ~:253-255 (previously untested) ---

  it('warn: top-level JSON non-object (bare number) — message contains "not a JSON object"', async () => {
    // Arm ~:247-249: parsed is a primitive, not an object → kind=warn
    await fs.writeFile(filePath, '42', 'utf-8');
    const result = await parseAgentMappingEnvelope(filePath);
    expect(result.kind).toBe('warn');
    if (result.kind === 'warn') {
      expect(result.message).toContain('not a JSON object');
    }
  });

  it('skip: agents field is null — kind=skip (no agents to migrate)', async () => {
    // Arm ~:253-255: rawAgents is null → kind=skip (treated as absent, nothing to migrate)
    await fs.writeFile(filePath, '{"agents":null}', 'utf-8');
    const result = await parseAgentMappingEnvelope(filePath);
    expect(result.kind).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// loadShippedAgentDefaults — compiled dir wins over source dir
// ---------------------------------------------------------------------------
//
// Shipped defaults are read live from the agent files at convergence time, so
// once an agent is generated into dist/agents/ its frontmatter must be the one
// that answers "what model did devflow ship for this agent?". The dirs are
// most-preferred first (the convention owned by agentSourceDirs()) and the
// first to supply a name wins; they are injectable so the precedence can be
// proved against a synthetic tree instead of the live build state.

/**
 * Write a minimal agent file carrying a model: key (and an effort: key when
 * `effort` is given). Shared by the describes below.
 */
async function writeAgentFile(dir: string, name: string, model: string, effort?: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const effortLine = effort === undefined ? '' : `effort: ${effort}\n`;
  await fs.writeFile(
    path.join(dir, `${name}.md`),
    `---\nname: ${name}\nmodel: ${model}\n${effortLine}---\n\nbody\n`,
    'utf-8',
  );
}

describe('loadShippedAgentDefaults — compiled over source merge', () => {
  let mergeTmp: string;

  beforeEach(async () => {
    mergeTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-shipped-defaults-'));
  });

  afterEach(async () => {
    await fs.rm(mergeTmp, { recursive: true, force: true });
  });

  it('covers every agent in the registry, not merely "some agents were scanned"', async () => {
    // `scanned > 0` would survive 15 of 16 agents silently disappearing (GAP-07).
    const defaults = await loadShippedAgentDefaults();
    expect(Object.keys(defaults)).toEqual(expect.arrayContaining([...getAllAgentNames()]));
  });

  it('reports the git agent as haiku from the live tree', async () => {
    const defaults = await loadShippedAgentDefaults();
    expect(defaults['git']?.model).toBe('haiku');
  });

  it('reads an agent that exists ONLY in the compiled dir', async () => {
    const srcDir = path.join(mergeTmp, 'src-agents');
    const distDir = path.join(mergeTmp, 'dist-agents');
    await writeAgentFile(srcDir, 'other', 'sonnet');
    await writeAgentFile(distDir, 'git', 'haiku');

    const defaults = await loadShippedAgentDefaults([distDir, srcDir]);
    expect(defaults['git']?.model).toBe('haiku');
    expect(defaults['other']?.model).toBe('sonnet');
  });

  it('known-bad probe: dropping the compiled dir loses the generated agent', async () => {
    // Non-vacuity for the test above: without the dist side, git is simply absent.
    const srcDir = path.join(mergeTmp, 'src-agents');
    const distDir = path.join(mergeTmp, 'dist-agents');
    await writeAgentFile(srcDir, 'other', 'sonnet');
    await writeAgentFile(distDir, 'git', 'haiku');

    const srcOnly = await loadShippedAgentDefaults([srcDir]);
    expect(srcOnly['git']).toBeUndefined();
    expect(srcOnly['other']?.model).toBe('sonnet');
  });

  it('lets the compiled dir win for a name present in both', async () => {
    const srcDir = path.join(mergeTmp, 'src-agents');
    const distDir = path.join(mergeTmp, 'dist-agents');
    await writeAgentFile(srcDir, 'git', 'opus');
    await writeAgentFile(distDir, 'git', 'haiku');

    expect((await loadShippedAgentDefaults([distDir, srcDir]))['git']?.model).toBe('haiku');
    // Reversing the order must change the answer, or the precedence proves nothing.
    expect((await loadShippedAgentDefaults([srcDir, distDir]))['git']?.model).toBe('opus');
  });

  it('tolerates an absent compiled dir', async () => {
    const srcDir = path.join(mergeTmp, 'src-agents');
    await writeAgentFile(srcDir, 'git', 'haiku');

    const defaults = await loadShippedAgentDefaults([path.join(mergeTmp, 'no-such-dir'), srcDir]);
    expect(defaults['git']?.model).toBe('haiku');
  });

  it('ignores non-.md entries in either dir', async () => {
    const srcDir = path.join(mergeTmp, 'src-agents');
    const distDir = path.join(mergeTmp, 'dist-agents');
    await writeAgentFile(srcDir, 'git', 'haiku');
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, 'git.mds'), '---\nmodel: opus\n---\n', 'utf-8');

    // The .mds source must not be mistaken for a compiled agent.
    expect((await loadShippedAgentDefaults([distDir, srcDir]))['git']?.model).toBe('haiku');
  });
});

// ---------------------------------------------------------------------------
// loadShippedAgentDefaults — shipped effort (D-SHIPPED-EFFORT)
// ---------------------------------------------------------------------------

describe('loadShippedAgentDefaults — shipped effort', () => {
  let effortTmp: string;

  beforeEach(async () => {
    effortTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-shipped-effort-'));
  });

  afterEach(async () => {
    await fs.rm(effortTmp, { recursive: true, force: true });
  });

  it('returns { model, effort } per agent, with effort undefined where none ships', async () => {
    const srcDir = path.join(effortTmp, 'src-agents');
    await writeAgentFile(srcDir, 'code', 'sonnet', 'medium');
    await writeAgentFile(srcDir, 'review', 'opus');

    const defaults = await loadShippedAgentDefaults([srcDir]);

    expect(defaults['code']).toEqual({ model: 'sonnet', effort: 'medium' });
    expect(defaults['review']?.model).toBe('opus');
    expect(defaults['review']?.effort).toBeUndefined();
  });

  it('dist-over-src precedence holds for the whole record: effort is never read from the losing file', async () => {
    const srcDir = path.join(effortTmp, 'src-agents');
    const distDir = path.join(effortTmp, 'dist-agents');
    await writeAgentFile(srcDir, 'git', 'opus', 'max');
    await writeAgentFile(distDir, 'git', 'haiku');

    const defaults = await loadShippedAgentDefaults([distDir, srcDir]);

    expect(defaults['git']?.model).toBe('haiku');
    expect(defaults['git']?.effort, 'src effort leaked into the dist record').toBeUndefined();
  });

  it('known-bad probe: reversing the order swaps the whole record, effort included', async () => {
    const srcDir = path.join(effortTmp, 'src-agents');
    const distDir = path.join(effortTmp, 'dist-agents');
    await writeAgentFile(srcDir, 'git', 'opus', 'max');
    await writeAgentFile(distDir, 'git', 'haiku', 'low');

    expect((await loadShippedAgentDefaults([distDir, srcDir]))['git']).toEqual({ model: 'haiku', effort: 'low' });
    expect((await loadShippedAgentDefaults([srcDir, distDir]))['git']).toEqual({ model: 'opus', effort: 'max' });
  });

  it('drops a shipped effort outside EFFORT_LEVELS, with one warning naming the agent', async () => {
    const srcDir = path.join(effortTmp, 'src-agents');
    await writeAgentFile(srcDir, 'code', 'sonnet', 'hgih');
    await writeAgentFile(srcDir, 'review', 'opus', 'high');
    const warnings: string[] = [];

    const defaults = await loadShippedAgentDefaults([srcDir], { onWarning: (m) => warnings.push(m) });

    expect(defaults['code']?.model, 'the model survives a bad effort').toBe('sonnet');
    expect(defaults['code']?.effort).toBeUndefined();
    expect(defaults['review']?.effort, 'a valid sibling is untouched').toBe('high');
    const naming = warnings.filter(w => w.includes('code') && w.includes('hgih'));
    expect(naming, `expected exactly one warning naming the agent:\n  ${warnings.join('\n  ')}`).toHaveLength(1);
    expect(warnings.filter(w => w.includes('review'))).toEqual([]);
  });

  it('does not warn about the effort of an agent whose losing file carries the bad value', async () => {
    const srcDir = path.join(effortTmp, 'src-agents');
    const distDir = path.join(effortTmp, 'dist-agents');
    await writeAgentFile(srcDir, 'code', 'sonnet', 'hgih');
    await writeAgentFile(distDir, 'code', 'sonnet', 'high');
    const warnings: string[] = [];

    const defaults = await loadShippedAgentDefaults([distDir, srcDir], { onWarning: (m) => warnings.push(m) });

    expect(defaults['code']?.effort).toBe('high');
    expect(warnings.filter(w => w.includes('hgih'))).toEqual([]);
  });

  it('a shipped effort of inherit is not a shipped level and is dropped', async () => {
    const srcDir = path.join(effortTmp, 'src-agents');
    await writeAgentFile(srcDir, 'code', 'sonnet', 'inherit');
    const warnings: string[] = [];

    const defaults = await loadShippedAgentDefaults([srcDir], { onWarning: (m) => warnings.push(m) });

    expect(defaults['code']?.effort).toBeUndefined();
    expect(warnings.some(w => w.includes('code'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadShippedAgentDefaults — registry-gap warning
// ---------------------------------------------------------------------------
//
// A registry agent whose file is in NEITHER source directory has no shipped
// default, and every downstream answer degrades quietly: resolveEffective
// returns model === undefined, reapplyAgentMapping buckets the agent
// 'unchanged', and `devflow agents --list` renders a blank default. The live
// shape that produces it is ordinary — `npm run build:cli` leaves dist/agents/
// unbuilt while the generated agent has no .md in the source tree — and its
// worst consequence is that disabling the proxy silently fails to revert a
// GPT-pinned agent (a feature is OFF when its files say so).
// The installer throws on the same invariant; a read path that must keep
// rendering warns instead.

describe('loadShippedAgentDefaults — registry-gap warning', () => {
  let gapTmp: string;
  /** Every registry agent except the one deliberately left unresolvable. */
  const MISSING = 'git';

  beforeEach(async () => {
    gapTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-shipped-gap-'));
  });

  afterEach(async () => {
    await fs.rm(gapTmp, { recursive: true, force: true });
  });

  /** A source tree holding every registry agent except MISSING (the build:cli-only shape). */
  async function srcWithoutMissing(): Promise<string> {
    const srcDir = path.join(gapTmp, 'src-agents');
    for (const name of getAllAgentNames()) {
      if (name === MISSING) continue;
      await writeAgentFile(srcDir, name, 'sonnet');
    }
    return srcDir;
  }

  it('warns once, naming the unresolved agent and the build step', async () => {
    const srcDir = await srcWithoutMissing();
    const warnings: string[] = [];

    const defaults = await loadShippedAgentDefaults(
      [path.join(gapTmp, 'no-such-dist-dir'), srcDir],
      { onWarning: (msg) => warnings.push(msg) },
    );

    expect(defaults[MISSING], 'the gap is real — the agent has no shipped default').toBeUndefined();
    expect(warnings, 'the gap must be reported as ONE aggregate warning').toHaveLength(1);
    expect(warnings[0]).toContain(MISSING);
    expect(warnings[0]).toContain('npm run build:mds');
  });

  it('non-vacuity: no warning when every registry agent resolves', async () => {
    const srcDir = await srcWithoutMissing();
    const distDir = path.join(gapTmp, 'dist-agents');
    await writeAgentFile(distDir, MISSING, 'haiku');
    const warnings: string[] = [];

    const defaults = await loadShippedAgentDefaults([distDir, srcDir], {
      onWarning: (msg) => warnings.push(msg),
    });

    expect(defaults[MISSING]?.model).toBe('haiku');
    expect(warnings, 'a complete tree must warn about nothing').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reapplyAgentMapping — the gap reaches the caller on the proxy-disable path
// ---------------------------------------------------------------------------

describe('reapplyAgentMapping — unresolved shipped default is reported, not silent', () => {
  let gapTmp: string;
  let installDir: string;
  let devflowDir: string;
  const MISSING = 'git';
  const EXTERNAL = 'gpt-5.6-sol';

  beforeEach(async () => {
    gapTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-reapply-gap-'));
    installDir = path.join(gapTmp, 'install');
    devflowDir = path.join(gapTmp, 'devflow');
    await fs.mkdir(installDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });

    // The installed agent is pinned to an external model, as proxy --enable left it.
    await fs.writeFile(
      path.join(installDir, `${MISSING}.md`),
      `---\nname: Git\nmodel: ${EXTERNAL}\n---\n\nbody\n`,
      'utf-8',
    );
    await saveAgentMapping(devflowDir, {
      version: 1,
      agents: { [MISSING]: { model: EXTERNAL } },
    });
  });

  afterEach(async () => {
    await fs.rm(gapTmp, { recursive: true, force: true });
  });

  /** Source tree missing the generated agent; dist/agents/ absent (build:cli-only). */
  async function unbuiltDirs(): Promise<[string, string]> {
    const srcDir = path.join(gapTmp, 'src-agents');
    for (const name of getAllAgentNames()) {
      if (name === MISSING) continue;
      await writeAgentFile(srcDir, name, 'sonnet');
    }
    return [path.join(gapTmp, 'no-such-dist-dir'), srcDir];
  }

  it('revertExternalAgents reports the gap for the agent it could not revert', async () => {
    const warnings: string[] = [];
    const result = await revertExternalAgents({
      installDir,
      devflowDir,
      agentSourceDirs: await unbuiltDirs(),
      onWarning: (msg) => warnings.push(msg),
    });

    // The revert genuinely cannot happen — there is no shipped default to revert TO.
    const content = await fs.readFile(path.join(installDir, `${MISSING}.md`), 'utf-8');
    expect(content, 'without a shipped default the external model stays pinned').toContain(EXTERNAL);
    expect(result.unchanged, 'the agent is bucketed unchanged — that is the silent no-op').toContain(MISSING);

    // ...and that no-op must be visible to the caller rather than inferred.
    expect(
      result.warnings.some(w => w.includes(MISSING) && w.includes('npm run build:mds')),
      `no warning named the unrevertable agent:\n  ${result.warnings.join('\n  ')}`,
    ).toBe(true);
    expect(warnings, 'the live onWarning channel must see it too').toEqual(result.warnings);
  });

  it('non-vacuity: a resolvable shipped default reverts and warns about nothing', async () => {
    const [, srcDir] = await unbuiltDirs();
    const distDir = path.join(gapTmp, 'dist-agents');
    await writeAgentFile(distDir, MISSING, 'haiku');

    const result = await revertExternalAgents({
      installDir,
      devflowDir,
      agentSourceDirs: [distDir, srcDir],
    });

    const content = await fs.readFile(path.join(installDir, `${MISSING}.md`), 'utf-8');
    expect(content).toContain('model: haiku');
    expect(result.updated).toContain(MISSING);
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reapplyAgentMapping — a shipped effort survives a reapply (D-SHIPPED-EFFORT)
// ---------------------------------------------------------------------------
//
// Reapply used to write `effort: effective.effort ?? null`, which removes the
// effort line from every installed agent that the mapping has no effort for —
// including one that SHIPS an effort. These tests inject a source tree of their
// own, so they hold whatever the shipped table says; the real shipped tree goes
// through a reapply in tests/agent-models-worker.test.ts.

describe('reapplyAgentMapping — shipped effort survives', () => {
  let tmp: string;
  let installDir: string;
  let devflowDir: string;
  let srcDir: string;

  /** The installed bytes `devflow init` would write for an agent shipping effort: medium. */
  const SHIPPED_CODE = '---\nname: Code\nmodel: sonnet\neffort: medium\n---\n\nbody\n';

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-reapply-effort-'));
    installDir = path.join(tmp, 'install');
    devflowDir = path.join(tmp, 'devflow');
    srcDir = path.join(tmp, 'src-agents');
    await fs.mkdir(installDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });
    await writeAgentFile(srcDir, 'code', 'sonnet', 'medium');
    await writeAgentFile(srcDir, 'validate', 'haiku');
    await fs.writeFile(path.join(installDir, 'code.md'), SHIPPED_CODE, 'utf-8');
    await fs.writeFile(path.join(installDir, 'validate.md'), '---\nname: Validate\nmodel: haiku\n---\n\nbody\n', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const reapply = () => reapplyAgentMapping({
    installDir,
    devflowDir,
    proxyEnabled: false,
    agentSourceDirs: [path.join(tmp, 'no-such-dist'), srcDir],
  });

  const installedCode = () => fs.readFile(path.join(installDir, 'code.md'), 'utf-8');

  it('strip regression: an unrelated entry leaves the shipped effort and reports the agent unchanged', async () => {
    await saveAgentMapping(devflowDir, { version: 1, agents: { validate: { model: 'haiku' } } });

    const result = await reapply();

    expect(await installedCode()).toBe(SHIPPED_CODE);
    expect(result.unchanged).toContain('code');
    expect(result.updated).not.toContain('code');
  });

  it('an empty mapping keeps the shipped effort', async () => {
    const result = await reapply();

    expect(await installedCode()).toBe(SHIPPED_CODE);
    expect(result.unchanged).toContain('code');
  });

  it('a mapping effort level replaces the shipped effort', async () => {
    await saveAgentMapping(devflowDir, { version: 1, agents: { code: { effort: 'max' } } });

    const result = await reapply();

    expect(await installedCode()).toContain('effort: max');
    expect(await installedCode()).not.toContain('effort: medium');
    expect(result.updated).toContain('code');
  });

  it('a mapping inherit removes the effort line', async () => {
    await saveAgentMapping(devflowDir, { version: 1, agents: { code: { effort: 'inherit' } } });

    const result = await reapply();

    expect(await installedCode()).toBe('---\nname: Code\nmodel: sonnet\n---\n\nbody\n');
    expect(result.updated).toContain('code');
  });

  it('dropping the mapping effort ("--effort default") restores the shipped effort on the next reapply', async () => {
    await saveAgentMapping(devflowDir, { version: 1, agents: { code: { effort: 'inherit' } } });
    await reapply();
    expect(await installedCode()).not.toContain('effort:');

    await saveAgentMapping(devflowDir, { version: 1, agents: {} });
    const result = await reapply();

    expect(await installedCode()).toBe(SHIPPED_CODE);
    expect(result.updated).toContain('code');
  });

  it('a dormant external model keeps the shipped model and still applies the shipped effort', async () => {
    await saveAgentMapping(devflowDir, { version: 1, agents: { code: { model: 'gpt-5.6-sol' } } });

    const result = await reapply();

    expect(await installedCode()).toBe(SHIPPED_CODE);
    expect(result.unchanged).toContain('code');
  });
});

// ---------------------------------------------------------------------------
// carryAgentOverrides — the converge's frontmatter carry
// ---------------------------------------------------------------------------

describe('carryAgentOverrides', () => {
  const shipped = '---\nname: Code\nmodel: sonnet\neffort: high\n---\n\nbody ON\n';
  const variant = '---\nname: Code\nmodel: sonnet\neffort: high\n---\n\nbody OFF\n';

  it('carries the installed model and effort into the source text and leaves the body alone', () => {
    const installed = '---\nname: Code\nmodel: opus\neffort: low\n---\n\nbody ON\n';

    expect(carryAgentOverrides(variant, installed)).toBe('---\nname: Code\nmodel: opus\neffort: low\n---\n\nbody OFF\n');
  });

  it('returns the source unchanged when the installed copy already holds the shipped values', () => {
    expect(carryAgentOverrides(variant, shipped)).toBe(variant);
  });

  it('an installed copy with no effort line (mapping "inherit") drops the shipped effort, as the reapply does', () => {
    const installed = '---\nname: Code\nmodel: sonnet\n---\n\nbody ON\n';

    expect(carryAgentOverrides(variant, installed)).toBe('---\nname: Code\nmodel: sonnet\n---\n\nbody OFF\n');
  });

  it('agrees with reapplyAgentMapping: carrying an installed copy that was reapplied yields what the reapply would write', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-carry-'));
    try {
      const installDir = path.join(dir, 'installed');
      const sourceDir = path.join(dir, 'source');
      const devflowDir = path.join(dir, 'devflow');
      await fs.mkdir(installDir, { recursive: true });
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.mkdir(devflowDir, { recursive: true });
      await fs.writeFile(path.join(sourceDir, 'code.md'), variant, 'utf-8');
      await fs.writeFile(path.join(installDir, 'code.md'), shipped, 'utf-8');
      await saveAgentMapping(devflowDir, { version: 1, agents: { code: { model: 'opus', effort: 'low' } } });

      await reapplyAgentMapping({ installDir, devflowDir, proxyEnabled: false, agentSourceDirs: [sourceDir] });
      const reapplied = await fs.readFile(path.join(installDir, 'code.md'), 'utf-8');

      expect(carryAgentOverrides(variant, reapplied)).toBe(
        '---\nname: Code\nmodel: opus\neffort: low\n---\n\nbody OFF\n',
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('known-bad probe: an installed model that fails the model-name charset is never copied into the source', () => {
    const installed = '---\nname: Code\nmodel: "opus\\ntools: bash"\neffort: high\n---\n';

    expect(carryAgentOverrides(variant, installed)).toBe(variant);
  });

  it('an installed effort that is not an effort level is never copied into the source', () => {
    const installed = '---\nname: Code\nmodel: opus\neffort: turbo\n---\n';

    expect(carryAgentOverrides(variant, installed)).toBe(variant);
  });

  it('returns the source unchanged when either side has no frontmatter, or the installed copy has no model', () => {
    expect(carryAgentOverrides(variant, 'code ON\n')).toBe(variant);
    expect(carryAgentOverrides('code OFF\n', shipped)).toBe('code OFF\n');
    expect(carryAgentOverrides(variant, '---\nname: Code\n---\n\nbody\n')).toBe(variant);
  });

  it('reads only the leading frontmatter block of the installed copy', () => {
    const installed = '---\nname: Code\nmodel: sonnet\neffort: high\n---\n\nmodel: opus\neffort: low\n';

    expect(carryAgentOverrides(variant, installed)).toBe(variant);
  });

  it('keeps the file\'s CRLF line endings', () => {
    const crlfVariant = variant.replace(/\n/g, '\r\n');
    const installed = '---\r\nname: Code\r\nmodel: opus\r\neffort: low\r\n---\r\n\r\nbody ON\r\n';

    expect(carryAgentOverrides(crlfVariant, installed)).toBe(
      '---\r\nname: Code\r\nmodel: opus\r\neffort: low\r\n---\r\n\r\nbody OFF\r\n',
    );
  });
});

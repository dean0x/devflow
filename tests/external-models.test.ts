/**
 * Tests for src/core/external-models.ts
 *
 * Coverage:
 *   - T9: Claude-set superset — every Anthropic runtime passthrough name is
 *     isClaudeModelName; fable is explicitly covered as a devflow alias that
 *     the runtime's regex does not match but devflow's set must include.
 *   - isDormantExternalModel: single dormancy export; alias-shaped non-Claude
 *     names are counted correctly by countExternalMappedAgents.
 *   - CLAUDE_MODEL_ALIASES contents
 *   - isClaudeModelName edge cases (claude- prefix, inherit, non-Claude names)
 *   - isDormantExternalModel semantics (proxy on/off, undefined, default)
 */

import { describe, it, expect } from 'vitest';
import {
  CLAUDE_MODEL_ALIASES,
  isClaudeModelName,
  isDormantExternalModel,
} from '../src/core/external-models.js';

// Literal GPT model IDs — independent of the deleted hardcoded registry.
// These reflect the subswitch@0.2.0 catalog used throughout Phase D tests.
// applies ADR-003: end-state only — no compatibility imports from deleted exports.
const KNOWN_GPT_IDS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'];
import {
  countExternalMappedAgents,
  type AgentMappingFile,
} from '../src/core/agent-models.js';

// ---------------------------------------------------------------------------
// CLAUDE_MODEL_ALIASES
// ---------------------------------------------------------------------------

describe('CLAUDE_MODEL_ALIASES', () => {
  it('contains haiku, sonnet, opus, fable', () => {
    expect(CLAUDE_MODEL_ALIASES).toContain('haiku');
    expect(CLAUDE_MODEL_ALIASES).toContain('sonnet');
    expect(CLAUDE_MODEL_ALIASES).toContain('opus');
    expect(CLAUDE_MODEL_ALIASES).toContain('fable');
    expect(CLAUDE_MODEL_ALIASES).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// T9 — Claude-set superset
//
// Devflow's Claude set must be a superset of the routing runtime's Anthropic
// passthrough regex (/^(inherit|sonnet|opus|haiku|claude-)/i) so that no
// Claude model is misclassified as external.
//
// fable is separately tested: the runtime's regex does NOT match 'fable' (its
// fallbackProvider=anthropic routes it correctly), but devflow's set includes
// 'fable' to prevent misclassification when the proxy is off.
// ---------------------------------------------------------------------------

describe('T9 — isClaudeModelName: Claude-set superset of runtime passthrough regex', () => {
  // Names matching the routing runtime's own Anthropic passthrough regex:
  // /^(inherit|sonnet|opus|haiku|claude-)/i
  const runtimePassthroughNames = [
    'inherit',
    'sonnet',
    'opus',
    'haiku',
    'claude-sonnet-4-6',
    'claude-opus-3',
    'claude-haiku-3',
    'claude-3-5-sonnet-20241022',
    'CLAUDE-anything',   // case-insensitive in runtime, but devflow's startsWith is case-sensitive
  ];

  // Subset that must be recognised by isClaudeModelName (case-sensitive)
  const caseSensitiveSubset = [
    'inherit',
    'sonnet',
    'opus',
    'haiku',
    'claude-sonnet-4-6',
    'claude-opus-3',
    'claude-haiku-3',
    'claude-3-5-sonnet-20241022',
  ];

  for (const name of caseSensitiveSubset) {
    it(`isClaudeModelName("${name}") is true`, () => {
      expect(isClaudeModelName(name)).toBe(true);
    });
  }

  it('isClaudeModelName("fable") is true — devflow alias not in runtime regex', () => {
    // fable is in CLAUDE_MODEL_ALIASES but not in the runtime's regex.
    // Devflow's Claude set must be a superset: fable must NOT be treated as external.
    expect(isClaudeModelName('fable')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isClaudeModelName — additional edge cases
// ---------------------------------------------------------------------------

describe('isClaudeModelName', () => {
  it('returns true for "inherit"', () => {
    expect(isClaudeModelName('inherit')).toBe(true);
  });

  it('returns true for all CLAUDE_MODEL_ALIASES', () => {
    for (const alias of CLAUDE_MODEL_ALIASES) {
      expect(isClaudeModelName(alias)).toBe(true);
    }
  });

  it('returns true for any model starting with "claude-"', () => {
    expect(isClaudeModelName('claude-anything')).toBe(true);
    expect(isClaudeModelName('claude-3-5-sonnet-20241022')).toBe(true);
  });

  it('returns false for external GPT model IDs', () => {
    for (const id of KNOWN_GPT_IDS) {
      expect(isClaudeModelName(id)).toBe(false);
    }
  });

  it('returns false for "default"', () => {
    expect(isClaudeModelName('default')).toBe(false);
  });

  it('returns false for an alias-shaped non-Claude name ("sol")', () => {
    // "sol" looks like a short alias but is not in CLAUDE_EXACT and does not
    // start with "claude-". It must be classified as external.
    expect(isClaudeModelName('sol')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isClaudeModelName('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDormantExternalModel — single dormancy export
// ---------------------------------------------------------------------------

describe('isDormantExternalModel — single dormancy predicate', () => {
  it('returns false when proxyEnabled is true (not dormant)', () => {
    expect(isDormantExternalModel('gpt-5.6-sol', true)).toBe(false);
    expect(isDormantExternalModel('sol', true)).toBe(false);
  });

  it('returns false when model is undefined', () => {
    expect(isDormantExternalModel(undefined, false)).toBe(false);
  });

  it('returns false when model is "default"', () => {
    expect(isDormantExternalModel('default', false)).toBe(false);
  });

  it('returns false when model is a Claude alias (proxy off)', () => {
    for (const alias of CLAUDE_MODEL_ALIASES) {
      expect(isDormantExternalModel(alias, false)).toBe(false);
    }
  });

  it('returns false when model starts with "claude-" (proxy off)', () => {
    expect(isDormantExternalModel('claude-sonnet-4-6', false)).toBe(false);
  });

  it('returns true for a known GPT model ID when proxy is off', () => {
    for (const id of KNOWN_GPT_IDS) {
      expect(isDormantExternalModel(id, false)).toBe(true);
    }
  });

  it('returns true for an alias-shaped non-Claude name ("sol") when proxy is off', () => {
    // An alias-shaped name that is not in the Claude set must be dormant-when-off.
    // This validates the complement-predicate approach: the external set is
    // "everything that is not Claude", not just "known GPT IDs".
    expect(isDormantExternalModel('sol', false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// countExternalMappedAgents uses complement predicate
// ---------------------------------------------------------------------------

describe('countExternalMappedAgents — complement predicate (AC-C6)', () => {
  it('counts alias-shaped non-Claude names as external', () => {
    // "sol" is not in CLAUDE_EXACT and does not start with "claude-".
    // The complement predicate must count it as external.
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'sol' } },
    };
    expect(countExternalMappedAgents(mapping)).toBe(1);
  });

  it('does not count Claude aliases as external', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        coder: { model: 'sonnet' },
        reviewer: { model: 'fable' },
        git: { model: 'haiku' },
      },
    };
    expect(countExternalMappedAgents(mapping)).toBe(0);
  });

  it('does not count "default" as external', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { coder: { model: 'default' } },
    };
    expect(countExternalMappedAgents(mapping)).toBe(0);
  });

  it('counts known GPT IDs as external', () => {
    const mapping: AgentMappingFile = {
      version: 1,
      agents: {
        coder: { model: 'gpt-5.6-sol' },
        reviewer: { model: 'gpt-5.5' },
      },
    };
    expect(countExternalMappedAgents(mapping)).toBe(2);
  });

  it('no file outside src/core/external-models.ts inlines the dormancy predicate (!isClaudeModelName)', () => {
    // AC-C6: isDormantExternalModel is the single dormancy export — no call site may
    // inline its expansion (!isClaudeModelName(model)). If any file outside
    // external-models.ts contains `!isClaudeModelName(`, it has re-implemented the
    // check inline, creating a divergence risk. (avoids PF-015)
    //
    // This test will FAIL if countExternalMappedAgents (or any other call site) ever
    // reverts to the inlined predicate instead of calling isDormantExternalModel.
    const { execSync } = require('child_process') as typeof import('child_process');
    const srcDir = new URL('../src/', import.meta.url).pathname;

    let output = '';
    try {
      output = execSync(
        `grep -rn '!isClaudeModelName(' .`,
        { cwd: srcDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ) as string;
    } catch (e: unknown) {
      // grep exits non-zero when no matches found — that is the desired outcome.
      output = '';
    }

    const violations = (output as string)
      .split('\n')
      .filter(line => line.trim())
      .filter(line => !line.includes('external-models.ts'));

    expect(
      violations,
      `Found inline dormancy predicate (!isClaudeModelName) outside external-models.ts:\n${violations.join('\n')}\nFix: call isDormantExternalModel() instead (AC-C6).`,
    ).toHaveLength(0);
  });
});

/**
 * Tests for src/core/agent-state.ts
 *
 * Pins the vocabulary shared by --list and the TUI so they cannot drift.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyAgentState,
  AGENT_STATE_LABELS,
  type AgentState,
} from '../src/core/agent-state.js';

// ---------------------------------------------------------------------------
// AGENT_STATE_LABELS — vocabulary alignment
// ---------------------------------------------------------------------------

describe('AGENT_STATE_LABELS', () => {
  it('covers all four AgentState values', () => {
    const states: AgentState[] = ['active', 'saved-inactive', 'not-installed', 'unknown'];
    for (const s of states) {
      expect(AGENT_STATE_LABELS[s]).toBeDefined();
      expect(typeof AGENT_STATE_LABELS[s]).toBe('string');
    }
  });

  it('saved-inactive label is "saved-inactive" (matches TUI render cell)', () => {
    expect(AGENT_STATE_LABELS['saved-inactive']).toBe('saved-inactive');
  });

  it('active label is "active"', () => {
    expect(AGENT_STATE_LABELS['active']).toBe('active');
  });

  it('not-installed label is "not installed"', () => {
    expect(AGENT_STATE_LABELS['not-installed']).toBe('not installed');
  });

  it('unknown label is "unknown"', () => {
    expect(AGENT_STATE_LABELS['unknown']).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// classifyAgentState — options-object form
// ---------------------------------------------------------------------------

describe('classifyAgentState', () => {
  it('returns "unknown" when not in registry', () => {
    expect(classifyAgentState({ configured: 'sonnet', proxyEnabled: false, installed: true, inRegistry: false })).toBe('unknown');
  });

  it('returns "not-installed" when not installed but in registry', () => {
    expect(classifyAgentState({ configured: 'sonnet', proxyEnabled: false, installed: false, inRegistry: true })).toBe('not-installed');
  });

  it('returns "saved-inactive" for dormant GPT model with proxy off', () => {
    expect(classifyAgentState({ configured: 'gpt-5.5', proxyEnabled: false, installed: true, inRegistry: true })).toBe('saved-inactive');
  });

  it('returns "active" for claude model with proxy off', () => {
    expect(classifyAgentState({ configured: 'sonnet', proxyEnabled: false, installed: true, inRegistry: true })).toBe('active');
  });

  it('returns "active" for GPT model with proxy ON', () => {
    expect(classifyAgentState({ configured: 'gpt-5.5', proxyEnabled: true, installed: true, inRegistry: true })).toBe('active');
  });

  it('returns "active" for default model', () => {
    expect(classifyAgentState({ configured: 'default', proxyEnabled: false, installed: true, inRegistry: true })).toBe('active');
  });
});

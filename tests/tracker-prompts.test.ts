/**
 * Tests for src/cli/commands/tracker-prompts.ts
 *
 * Covers:
 *   - shouldRunTrackerStep: all 8 gate rows (the compliance gate table, AC-3.6)
 *   - runTrackerStep: step semantics via fake recorded IO (injectable prompts)
 *   - providerChoices / formatTrackerSummary / TRACKER_SELECT_MESSAGE
 *
 * AC-3.6 (repurposed): the step is reachable under interactive-Recommended AND
 * Advanced, unreachable under --recommended / non-TTY, and --tracker suppresses
 * the prompt on both paths. The gate predicate is the single authority for both
 * wizard paths — a Recommended-only implementation would be dead on every
 * re-init (re-init is Advanced-only by construction).
 *
 * Per PF-029: the gate keys on `modePromptShown`, never on the mode name.
 * Per PF-014: runTrackerStep never calls process.exit and never throws — the
 * returned discriminated union drives every caller decision.
 * Per PF-018: the fake IO fails loudly when over-consumed, and the payload
 * tables assert their own row counts.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  shouldRunTrackerStep,
  runTrackerStep,
  providerChoices,
  formatProviderCatalogue,
  formatTrackerSummary,
  TRACKER_SELECT_MESSAGE,
  type TrackerPromptIO,
} from '../src/cli/commands/tracker-prompts.js';
import type { PromptOutcome } from '../src/cli/commands/prompt-io.js';
import {
  TRACKER_PROVIDERS,
  TRACKER_PROVIDER_IDS,
  type TrackerProvider,
} from '../src/core/tracker.js';

// ── Fake prompt builder ────────────────────────────────────────────────────────

/**
 * Build a fake TrackerPromptIO from queued responses.
 * Responses are consumed in order; the test fails loudly if a prompt is called
 * more times than responses were queued (PF-018: non-vacuous assertions).
 */
function makePrompts(noteFn?: (message: string, title: string) => void) {
  const providerQueue: PromptOutcome<TrackerProvider>[] = [];
  let lastProviderOpts: Parameters<TrackerPromptIO['selectProvider']>[0] | null = null;

  const prompts: TrackerPromptIO = {
    note: noteFn ?? vi.fn(),
    select: async (): Promise<PromptOutcome<boolean>> => {
      throw new Error('runTrackerStep must not use the boolean select — it asks a 3-value question');
    },
    selectProvider: async (opts): Promise<PromptOutcome<TrackerProvider>> => {
      lastProviderOpts = opts;
      const next = providerQueue.shift();
      if (!next) throw new Error('No selectProvider response queued — test missing a queued outcome');
      return next;
    },
  };

  return { prompts, providerQueue, getLastProviderOpts: () => lastProviderOpts };
}

// ── shouldRunTrackerStep — all 8 gate rows ────────────────────────────────────

describe('shouldRunTrackerStep', () => {
  it('row 1: --recommended flag (mode=recommended, modePromptShown=false, isTTY=true) → false', () => {
    expect(shouldRunTrackerStep({
      mode: 'recommended',
      modePromptShown: false,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(false);
  });

  it('row 2: !isTTY fallback (mode=recommended, modePromptShown=false, isTTY=false) → false', () => {
    expect(shouldRunTrackerStep({
      mode: 'recommended',
      modePromptShown: false,
      isTTY: false,
      hasCliOverride: false,
    })).toBe(false);
  });

  it('row 3: interactive mode-prompt → Recommended (modePromptShown=true, isTTY=true) → true', () => {
    expect(shouldRunTrackerStep({
      mode: 'recommended',
      modePromptShown: true,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(true);
  });

  it('row 4: --advanced flag (mode=advanced, modePromptShown=false, isTTY=true) → true', () => {
    expect(shouldRunTrackerStep({
      mode: 'advanced',
      modePromptShown: false,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(true);
  });

  it('row 5: re-init banner path (mode=advanced, modePromptShown=false, isTTY=true) → true', () => {
    // Same gate inputs as --advanced; re-init routes to the Advanced list by
    // construction, which is why a Recommended-only wiring would be dead there.
    expect(shouldRunTrackerStep({
      mode: 'advanced',
      modePromptShown: false,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(true);
  });

  it('row 6: interactive mode-prompt → Advanced (mode=advanced, modePromptShown=true, isTTY=true) → true', () => {
    expect(shouldRunTrackerStep({
      mode: 'advanced',
      modePromptShown: true,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(true);
  });

  it('row 7: --tracker suppresses the prompt on the Recommended path → false', () => {
    expect(shouldRunTrackerStep({
      mode: 'recommended',
      modePromptShown: true,
      isTTY: true,
      hasCliOverride: true,
    })).toBe(false);
  });

  it('row 8: --tracker suppresses the prompt on the Advanced path → false', () => {
    expect(shouldRunTrackerStep({
      mode: 'advanced',
      modePromptShown: false,
      isTTY: true,
      hasCliOverride: true,
    })).toBe(false);
  });

  it('AC-3.6 summary: reachable on interactive-Recommended AND Advanced, unreachable promptless', () => {
    // Both-path reachability behind ONE shared predicate — the predicate, not
    // lexical placement in init.ts, is the authority for both wizard paths.
    const reachable = (mode: 'recommended' | 'advanced', modePromptShown: boolean) =>
      shouldRunTrackerStep({ mode, modePromptShown, isTTY: true, hasCliOverride: false });
    expect(reachable('recommended', true)).toBe(true);
    expect(reachable('advanced', false)).toBe(true);
    // The two promptless contracts stay promptless.
    expect(reachable('recommended', false)).toBe(false);
    expect(shouldRunTrackerStep({
      mode: 'advanced', modePromptShown: true, isTTY: false, hasCliOverride: false,
    })).toBe(false);
  });
});

// ── runTrackerStep — step semantics ───────────────────────────────────────────

describe('runTrackerStep', () => {
  it('selecting jira from a github seed → resolved with {provider:"jira"}', async () => {
    const { prompts, providerQueue } = makePrompts();
    providerQueue.push({ kind: 'value', value: 'jira' });

    const result = await runTrackerStep({ seed: { provider: 'github' }, prompts });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.state).toEqual({ provider: 'jira' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].level).toBe('success');
    expect(result.messages[0].text).toContain('jira');
  });

  it('Enter-through preserves the seeded provider (initialValue is the seed)', async () => {
    const { prompts, providerQueue, getLastProviderOpts } = makePrompts();
    // Enter on a clack select returns the initialValue.
    providerQueue.push({ kind: 'value', value: 'linear' });

    const result = await runTrackerStep({ seed: { provider: 'linear' }, prompts });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.state).toEqual({ provider: 'linear' });
    const opts = getLastProviderOpts();
    expect(opts).not.toBeNull();
    expect(opts!.initialValue).toBe('linear');
    expect(opts!.message).toBe(TRACKER_SELECT_MESSAGE);
  });

  it('keeping github → resolved with an info-level outcome line', async () => {
    const { prompts, providerQueue } = makePrompts();
    providerQueue.push({ kind: 'value', value: 'github' });

    const result = await runTrackerStep({ seed: { provider: 'github' }, prompts });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.state).toEqual({ provider: 'github' });
    // github is the off position — an info line, never a "success" claim.
    expect(result.messages[0].level).toBe('info');
    expect(result.messages[0].text).toContain('github');
  });

  it('offers every registry provider as a choice (the step cannot widen the domain)', async () => {
    const { prompts, providerQueue, getLastProviderOpts } = makePrompts();
    providerQueue.push({ kind: 'value', value: 'github' });

    await runTrackerStep({ seed: { provider: 'github' }, prompts });

    const opts = getLastProviderOpts();
    expect(opts).not.toBeNull();
    expect(opts!.options.map(o => o.value)).toEqual([...TRACKER_PROVIDER_IDS]);
  });

  it('cancel at the provider select → kind=cancelled (never process.exit, never throws)', async () => {
    const { prompts, providerQueue } = makePrompts();
    providerQueue.push({ kind: 'cancel' });

    const result = await runTrackerStep({ seed: { provider: 'github' }, prompts });

    expect(result.kind).toBe('cancelled');
  });

  it('mutation safety: the returned state is never the seed object', async () => {
    const seed = { provider: 'jira' as TrackerProvider };
    const { prompts, providerQueue } = makePrompts();
    providerQueue.push({ kind: 'value', value: 'jira' });

    const result = await runTrackerStep({ seed, prompts });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.state).toEqual(seed);
    expect(result.state).not.toBe(seed);
  });

  it('mutation safety: mutating the returned state does not corrupt the seed', async () => {
    const seed = { provider: 'github' as TrackerProvider };
    const { prompts, providerQueue } = makePrompts();
    providerQueue.push({ kind: 'value', value: 'linear' });

    const result = await runTrackerStep({ seed, prompts });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    result.state.provider = 'jira';
    expect(seed.provider).toBe('github');
  });

  it('note copy includes "Current setting:" reflecting the seed', async () => {
    let capturedNote = '';
    const { prompts, providerQueue } = makePrompts((message) => { capturedNote = message; });
    providerQueue.push({ kind: 'value', value: 'jira' });

    await runTrackerStep({ seed: { provider: 'jira' }, prompts });

    expect(capturedNote).toContain('Current setting:');
    expect(capturedNote).toMatch(/Current setting:.*jira/);
  });

  it('note copy for a github seed names it as the default', async () => {
    let capturedNote = '';
    const { prompts, providerQueue } = makePrompts((message) => { capturedNote = message; });
    providerQueue.push({ kind: 'value', value: 'github' });

    await runTrackerStep({ seed: { provider: 'github' }, prompts });

    expect(capturedNote).toContain('Current setting: github (default)');
  });

  it('never mentions MCP in any rendered copy (standing prohibition)', async () => {
    let capturedNote = '';
    const { prompts, providerQueue } = makePrompts((message) => { capturedNote = message; });
    providerQueue.push({ kind: 'value', value: 'jira' });

    const result = await runTrackerStep({ seed: { provider: 'github' }, prompts });

    expect(capturedNote).not.toMatch(/MCP/i);
    expect(TRACKER_SELECT_MESSAGE).not.toMatch(/MCP/i);
    if (result.kind === 'resolved') {
      for (const msg of result.messages) expect(msg.text).not.toMatch(/MCP/i);
    }
  });
});

// ── Shared helpers ────────────────────────────────────────────────────────────

describe('providerChoices', () => {
  it('returns one entry per TRACKER_PROVIDERS entry, in registry order', () => {
    const choices = providerChoices();
    expect(choices).toHaveLength(TRACKER_PROVIDERS.length);
    for (const [i, provider] of TRACKER_PROVIDERS.entries()) {
      expect(choices[i]).toEqual({ value: provider.id, label: provider.label, hint: provider.hint });
    }
  });

  it('TRACKER_SELECT_MESSAGE names the tracker question', () => {
    expect(TRACKER_SELECT_MESSAGE.toLowerCase()).toContain('tracker');
  });
});

describe('formatProviderCatalogue', () => {
  it('includes each provider id and hint', () => {
    const catalogue = formatProviderCatalogue();
    for (const provider of TRACKER_PROVIDERS) {
      expect(catalogue).toContain(provider.id);
      expect(catalogue).toContain(provider.hint);
    }
  });
});

describe('formatTrackerSummary', () => {
  it('marks github as the default', () => {
    expect(formatTrackerSummary('github')).toBe('github (default)');
  });

  it('renders a non-default provider as its bare id', () => {
    expect(formatTrackerSummary('jira')).toBe('jira');
    expect(formatTrackerSummary('linear')).toBe('linear');
  });
});

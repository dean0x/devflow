/**
 * Tests for attribution-prompts.ts (D27 / PF-029).
 *
 * Coverage:
 *  - shouldRunAttributionStep: gate predicate matrix (PF-029 invariants)
 *  - runAttributionStep: step runner with injected DI seam (PF-014 invariants)
 */

import { describe, it, expect } from 'vitest';
import {
  shouldRunAttributionStep,
  runAttributionStep,
  type AttributionPromptIO,
} from '../src/cli/commands/attribution-prompts.js';

// ── shouldRunAttributionStep ──────────────────────────────────────────────────

describe('shouldRunAttributionStep — gate predicate (D27 / PF-029)', () => {
  // ── Advanced-only invariant (D27) ───────────────────────────────────────────
  // The attribution question is reachable from the Advanced path ONLY. Unlike the
  // compliance step, interactive Recommended never asks — it silently applies the
  // seeded value. These tests are the authority for that divergence.

  it('Advanced mode with TTY → true (the only path that asks)', () => {
    expect(shouldRunAttributionStep({ mode: 'advanced', isTTY: true })).toBe(true);
  });

  it('interactive Recommended → false (Recommended NEVER asks, D27)', () => {
    // Divergence from shouldRunComplianceStep, which returns true here. Interactive
    // Recommended silently applies the seeded value (fresh install: off).
    expect(shouldRunAttributionStep({ mode: 'recommended', isTTY: true })).toBe(false);
  });

  it('--recommended flag (non-interactive Recommended) → false', () => {
    expect(shouldRunAttributionStep({ mode: 'recommended', isTTY: true })).toBe(false);
  });

  // ── Promptless contracts (PF-029) ───────────────────────────────────────────

  it('non-TTY → false for Advanced (no prompt without a TTY)', () => {
    expect(shouldRunAttributionStep({ mode: 'advanced', isTTY: false })).toBe(false);
  });

  it('non-TTY → false for Recommended (promptless contract preserved)', () => {
    expect(shouldRunAttributionStep({ mode: 'recommended', isTTY: false })).toBe(false);
  });

  it('exhaustive gate matrix: only (advanced, TTY) is true', () => {
    const matrix: Array<[('recommended' | 'advanced'), boolean, boolean]> = [
      ['advanced', true, true],
      ['advanced', false, false],
      ['recommended', true, false],
      ['recommended', false, false],
    ];
    for (const [mode, isTTY, expected] of matrix) {
      expect(shouldRunAttributionStep({ mode, isTTY }), `mode=${mode} isTTY=${isTTY}`).toBe(expected);
    }
  });
});

// ── runAttributionStep ────────────────────────────────────────────────────────

/** Build a no-op AttributionPromptIO that always yields the given select result. */
function makeIO(selectResult: boolean | 'cancel'): AttributionPromptIO {
  return {
    note: () => {},
    select: async () =>
      selectResult === 'cancel'
        ? { kind: 'cancel' }
        : { kind: 'value', value: selectResult },
  };
}

describe('runAttributionStep — step runner (PF-014)', () => {
  it('user selects Yes (true) → resolved with suppress:true and success message', async () => {
    const result = await runAttributionStep({ seed: false, prompts: makeIO(true) });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.suppress).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.level).toBe('success');
      expect(result.messages[0]?.text).toContain('suppressed');
    }
  });

  it('user selects No (false) → resolved with suppress:false and info message', async () => {
    const result = await runAttributionStep({ seed: true, prompts: makeIO(false) });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.suppress).toBe(false);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.level).toBe('info');
      expect(result.messages[0]?.text).toContain('shown (default)');
    }
  });

  it('cancel → kind:cancelled (PF-014: never throws)', async () => {
    const result = await runAttributionStep({ seed: false, prompts: makeIO('cancel') });
    expect(result.kind).toBe('cancelled');
  });

  it('note is called with "suppressed" when seed=true', async () => {
    let noteMsg = '';
    const io: AttributionPromptIO = {
      note: (msg) => { noteMsg = msg; },
      select: async () => ({ kind: 'value', value: false }),
    };
    await runAttributionStep({ seed: true, prompts: io });
    expect(noteMsg).toContain('suppressed');
    expect(noteMsg).not.toContain('shown (default)');
  });

  it('note is called with "shown (default)" when seed=false', async () => {
    let noteMsg = '';
    const io: AttributionPromptIO = {
      note: (msg) => { noteMsg = msg; },
      select: async () => ({ kind: 'value', value: false }),
    };
    await runAttributionStep({ seed: false, prompts: io });
    expect(noteMsg).toContain('shown (default)');
  });

  it('does not throw — never calls process.exit() (PF-014)', async () => {
    // The step runner must return a value, never throw or process.exit.
    await expect(runAttributionStep({ seed: false, prompts: makeIO(false) })).resolves.toBeDefined();
    await expect(runAttributionStep({ seed: false, prompts: makeIO('cancel') })).resolves.toBeDefined();
  });

  it('seeded true → initialValue passed as true to select prompt', async () => {
    let capturedInitialValue: boolean | undefined;
    const io: AttributionPromptIO = {
      note: () => {},
      select: async (opts) => {
        capturedInitialValue = opts.initialValue;
        return { kind: 'value', value: opts.initialValue };
      },
    };
    await runAttributionStep({ seed: true, prompts: io });
    expect(capturedInitialValue).toBe(true);
  });

  it('seeded false → initialValue passed as false to select prompt', async () => {
    let capturedInitialValue: boolean | undefined;
    const io: AttributionPromptIO = {
      note: () => {},
      select: async (opts) => {
        capturedInitialValue = opts.initialValue;
        return { kind: 'value', value: opts.initialValue };
      },
    };
    await runAttributionStep({ seed: false, prompts: io });
    expect(capturedInitialValue).toBe(false);
  });
});

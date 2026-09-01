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

describe('shouldRunAttributionStep — gate predicate (PF-029)', () => {
  it('--recommended flag (no modePromptShown) → false (promptless contract preserved)', () => {
    expect(shouldRunAttributionStep({
      mode: 'recommended',
      modePromptShown: false,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(false);
  });

  it('non-TTY → false regardless of mode (promptless contract preserved)', () => {
    expect(shouldRunAttributionStep({
      mode: 'advanced',
      modePromptShown: true,
      isTTY: false,
      hasCliOverride: false,
    })).toBe(false);
  });

  it('hasCliOverride → false regardless of mode/TTY/modePromptShown', () => {
    expect(shouldRunAttributionStep({
      mode: 'advanced',
      modePromptShown: true,
      isTTY: true,
      hasCliOverride: true,
    })).toBe(false);
  });

  it('interactive Recommended + modePromptShown=true → true', () => {
    expect(shouldRunAttributionStep({
      mode: 'recommended',
      modePromptShown: true,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(true);
  });

  it('Advanced mode with TTY → true regardless of modePromptShown', () => {
    expect(shouldRunAttributionStep({
      mode: 'advanced',
      modePromptShown: false,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(true);
  });

  it('Advanced mode with TTY and modePromptShown=true → true', () => {
    expect(shouldRunAttributionStep({
      mode: 'advanced',
      modePromptShown: true,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(true);
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

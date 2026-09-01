/**
 * Tests for attribution-prompts.ts (D27 / PF-029).
 *
 * Coverage:
 *  - shouldRunAttributionStep: exhaustive gate matrix (PF-029 invariants)
 *  - structural reachability guard: init.ts call site must be in Advanced half with
 *    a non-literal mode binding — test fails when the block is moved or the literal
 *    is restored (applies PF-029, PF-018)
 *  - runAttributionStep: step runner with injected DI seam (PF-014 invariants)
 *  - applyAttributionAnswer: immutable merge of wizard answer into FlagsRecord
 *  - attributionSeedFrom: boolean seed derivation from FlagsRecord (PF-018)
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import {
  shouldRunAttributionStep,
  runAttributionStep,
  applyAttributionAnswer,
  attributionSeedFrom,
  type AttributionPromptIO,
  type AttributionStepResolved,
} from '../src/cli/commands/attribution-prompts.js';
import type { FlagsRecord } from '../src/core/flags.js';

// ── shouldRunAttributionStep ──────────────────────────────────────────────────

describe('shouldRunAttributionStep — gate predicate (D27 / PF-029)', () => {
  // ── Advanced-only invariant (D27) ───────────────────────────────────────────
  // The attribution question is reachable from the Advanced path ONLY. Unlike the
  // compliance step, interactive Recommended never asks — it silently applies the
  // seeded value. This exhaustive matrix is the authority for that divergence.

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

// ── Structural reachability guard ─────────────────────────────────────────────

describe('init.ts structural guard — D27 call site must be in Advanced half, non-literal mode (PF-029 / PF-018)', () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const initTsPath = path.resolve(__dirname, '../src/cli/commands/init.ts');

  // Robustly split init.ts at the Recommended / Advanced boundary.
  // SPLIT_ANCHOR uniquely identifies the start of the Advanced interactive flow.
  const SPLIT_ANCHOR = '// ── Advanced path: full interactive flow ──';
  const REC_ANCHOR = 'if (useRecommended) {';

  it('non-empty corpus: source and both halves must be non-empty (PF-018 non-vacuity)', () => {
    const source = fs.readFileSync(initTsPath, 'utf8');
    expect(source.length, 'init.ts is empty — file may have been deleted or renamed').toBeGreaterThan(0);

    const splitIdx = source.indexOf(SPLIT_ANCHOR);
    expect(splitIdx, `Split anchor "${SPLIT_ANCHOR}" not found in init.ts — the boundary label was renamed`).not.toBe(-1);

    const recIdx = source.indexOf(REC_ANCHOR);
    expect(recIdx, `Recommended anchor "${REC_ANCHOR}" not found in init.ts — the variable was renamed`).not.toBe(-1);

    const recommendedHalf = source.slice(0, splitIdx);
    const advancedHalf = source.slice(splitIdx);
    expect(recommendedHalf.length, 'Recommended half is empty — split boundary is at position 0').toBeGreaterThan(0);
    expect(advancedHalf.length, 'Advanced half is empty — split boundary is at end of file').toBeGreaterThan(0);
  });

  it('runAttributionStep( appears exactly once in Advanced half and zero times in Recommended half', () => {
    const source = fs.readFileSync(initTsPath, 'utf8');
    const splitIdx = source.indexOf(SPLIT_ANCHOR);
    expect(splitIdx).not.toBe(-1);

    const recommendedHalf = source.slice(0, splitIdx);
    const advancedHalf = source.slice(splitIdx);

    const countIn = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1;

    expect(
      countIn(advancedHalf, 'runAttributionStep('),
      'runAttributionStep( should appear exactly once in the Advanced half',
    ).toBe(1);

    expect(
      countIn(recommendedHalf, 'runAttributionStep('),
      'runAttributionStep( must not appear in the Recommended half — D27 Advanced-only',
    ).toBe(0);
  });

  it('attribution call site does NOT pass a literal mode: "advanced" — must use the ternary (D27-GATE)', () => {
    const source = fs.readFileSync(initTsPath, 'utf8');
    const splitIdx = source.indexOf(SPLIT_ANCHOR);
    expect(splitIdx).not.toBe(-1);

    const advancedHalf = source.slice(splitIdx);

    // Narrow to the shouldRunAttributionStep call block (not the broader Advanced half,
    // which also contains the compliance call site that legitimately uses mode:'advanced').
    const attrCallStart = advancedHalf.indexOf('shouldRunAttributionStep({');
    expect(
      attrCallStart,
      'shouldRunAttributionStep({ not found in Advanced half',
    ).not.toBe(-1);
    const attrCallEnd = advancedHalf.indexOf('})', attrCallStart);
    expect(attrCallEnd, '}}) closing not found after shouldRunAttributionStep({').not.toBe(-1);
    const attrCallBlock = advancedHalf.slice(attrCallStart, attrCallEnd + 2);
    expect(attrCallBlock.length, 'attribution call block is empty').toBeGreaterThan(0);

    // After the fix, the attribution gate call must NOT contain the bare literal
    // `mode: 'advanced'` — that pattern is what made the predicate always-true and
    // three of the four gate rows unreachable (applies PF-029).
    expect(
      attrCallBlock.includes("mode: 'advanced'"),
      "Found bare literal `mode: 'advanced'` at the attribution call site — must be the ternary `mode: useRecommended ? 'recommended' : 'advanced'`",
    ).toBe(false);

    // The ternary that binds to the resolved mode must be present in this block.
    expect(
      attrCallBlock.includes('mode: useRecommended'),
      "Ternary `mode: useRecommended` not found in shouldRunAttributionStep block — attribution gate is not bound to the resolved init mode",
    ).toBe(true);
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

// ── applyAttributionAnswer ────────────────────────────────────────────────────

describe('applyAttributionAnswer — immutable FlagsRecord merge (D27)', () => {
  function makeResolved(suppress: boolean): AttributionStepResolved {
    return {
      kind: 'resolved',
      suppress,
      messages: [],
    };
  }

  it('suppress:true → suppress-attribution written as true', () => {
    const flags: FlagsRecord = {};
    const result = applyAttributionAnswer(flags, makeResolved(true));
    expect(result['suppress-attribution']).toBe(true);
  });

  it('suppress:false → suppress-attribution written as false', () => {
    const flags: FlagsRecord = { 'suppress-attribution': true };
    const result = applyAttributionAnswer(flags, makeResolved(false));
    expect(result['suppress-attribution']).toBe(false);
  });

  it('neighbouring entries survive the spread (immutable merge)', () => {
    const flags: FlagsRecord = {
      'brief': true,
      'thinking-summaries': false,
      'suppress-attribution': false,
    };
    const result = applyAttributionAnswer(flags, makeResolved(true));
    expect(result['suppress-attribution']).toBe(true);
    expect(result['brief']).toBe(true);
    expect(result['thinking-summaries']).toBe(false);
  });

  it('input object is not mutated', () => {
    const flags: FlagsRecord = { 'suppress-attribution': false, 'brief': true };
    const before = { ...flags };
    applyAttributionAnswer(flags, makeResolved(true));
    expect(flags).toEqual(before);
  });
});

// ── attributionSeedFrom ───────────────────────────────────────────────────────

describe('attributionSeedFrom — boolean seed from FlagsRecord (PF-018)', () => {
  it('true stored → returns true (real boolean)', () => {
    const result = attributionSeedFrom({ 'suppress-attribution': true });
    expect(result).toBe(true);
    expect(typeof result).toBe('boolean');
  });

  it('false stored → returns false (real boolean)', () => {
    const result = attributionSeedFrom({ 'suppress-attribution': false });
    expect(result).toBe(false);
    expect(typeof result).toBe('boolean');
  });

  it('absent key → returns false (real boolean)', () => {
    const result = attributionSeedFrom({});
    expect(result).toBe(false);
    expect(typeof result).toBe('boolean');
  });

  it('null stored → returns false (real boolean)', () => {
    const result = attributionSeedFrom({ 'suppress-attribution': null });
    expect(result).toBe(false);
    expect(typeof result).toBe('boolean');
  });
});

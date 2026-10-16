/**
 * Tests for src/cli/commands/gate-level-prompts.ts
 *
 * Covers:
 *   - resolveGateLevelInitOption: the --gate-level boundary (valid, invalid, --hud-only)
 *   - shouldRunGateLevelStep: all 8 gate rows (the compliance/tracker gate table)
 *   - gateLevelPromptSeed / describeGateLevel: first install, re-init, malformed values
 *   - runGateLevelStep: step semantics via fake recorded IO (injectable prompts)
 *   - resolveGateLevelForInit: both init paths (Recommended / Advanced), the flag, the
 *     promptless contracts, and the cancel outcome
 *   - formatGateLevelSummary: the post-install row, from the state the run acted on
 *   - init.ts wiring: both wizard paths call the one shared helper with their own mode
 *
 * The gate keys on `modePromptShown`, never on the mode name. Nothing here calls
 * process.exit and nothing throws: the returned discriminated unions drive every
 * caller decision. The fake IO fails loudly when over-consumed, and each table
 * asserts its own row count, so no test passes without exercising what it claims to.
 */
import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'fs';
import {
  GATE_LEVEL_HINTS,
  GATE_LEVEL_SELECT_MESSAGE,
  describeGateLevel,
  formatGateLevelCatalogue,
  formatGateLevelSummary,
  gateLevelChoices,
  gateLevelPromptSeed,
  resolveGateLevelForInit,
  resolveGateLevelInitOption,
  runGateLevelStep,
  shouldRunGateLevelStep,
  type GateLevelPromptIO,
} from '../src/cli/commands/gate-level-prompts.js';
import type { PromptOutcome } from '../src/cli/commands/prompt-io.js';
import { DEFAULT_GATE_LEVEL, GATE_LEVELS, type GateLevel } from '../src/core/gate-level.js';
import { FEATURE_DEFAULTS, resolveSeedFeatures } from '../src/cli/commands/init-seed.js';
import { makeManifest } from './helpers.js';

// ── Fake prompt builder ────────────────────────────────────────────────────────

/**
 * Build a fake GateLevelPromptIO from queued responses. Responses are consumed in
 * order; the test fails loudly if a prompt is called more times than responses
 * were queued (non-vacuous assertions).
 */
function makePrompts() {
  const levelQueue: PromptOutcome<GateLevel>[] = [];
  const notes: Array<{ message: string; title: string }> = [];
  const asked: Array<Parameters<GateLevelPromptIO['selectLevel']>[0]> = [];

  const prompts: GateLevelPromptIO = {
    note: (message, title) => { notes.push({ message, title }); },
    select: async (): Promise<PromptOutcome<boolean>> => {
      throw new Error('the gate-level step must not use the boolean select — it asks a 3-value question');
    },
    selectLevel: async (opts): Promise<PromptOutcome<GateLevel>> => {
      asked.push(opts);
      const next = levelQueue.shift();
      if (!next) throw new Error('No selectLevel response queued — test missing a queued outcome');
      return next;
    },
  };

  return { prompts, levelQueue, notes, asked };
}

/** A prompt set that fails the test if anything is shown. */
function neverPrompts(): GateLevelPromptIO {
  const fail = (): never => { throw new Error('no prompt may be shown on this path'); };
  return { note: fail, select: fail, selectLevel: fail };
}

// ── resolveGateLevelInitOption — the --gate-level boundary ─────────────────────

describe('resolveGateLevelInitOption', () => {
  it('returns undefined when the option was not passed', () => {
    expect(resolveGateLevelInitOption(undefined, false)).toBeUndefined();
  });

  it('accepts each of the three levels', () => {
    expect(GATE_LEVELS).toHaveLength(3);
    for (const level of GATE_LEVELS) {
      expect(resolveGateLevelInitOption(level, false)).toEqual({ ok: true, value: level });
    }
  });

  it('rejects a value that is not exactly one of the three words, naming the valid ones', () => {
    const BAD = ['Lean', 'lean ', ' lean', 'FULL', 'strict', '', 'standard,lean'];
    expect(BAD).toHaveLength(7);
    for (const value of BAD) {
      const result = resolveGateLevelInitOption(value, false);
      expect(result?.ok, `expected ${JSON.stringify(value)} to be rejected`).toBe(false);
      if (result !== undefined && !result.ok) {
        expect(result.error).toContain('--gate-level');
        expect(result.error).toContain('Valid levels: full, standard, lean');
      }
    }
  });

  it('refuses --hud-only with a valid level instead of ignoring the flag', () => {
    const result = resolveGateLevelInitOption('lean', true);
    expect(result?.ok).toBe(false);
    if (result !== undefined && !result.ok) expect(result.error).toContain('--hud-only');
  });

  it('reports a bad value before the --hud-only conflict', () => {
    const result = resolveGateLevelInitOption('Lean', true);
    expect(result?.ok).toBe(false);
    if (result !== undefined && !result.ok) expect(result.error).toContain('Valid levels');
  });
});

// ── shouldRunGateLevelStep — all 8 gate rows ───────────────────────────────────

describe('shouldRunGateLevelStep', () => {
  const rows: Array<{
    name: string;
    input: Parameters<typeof shouldRunGateLevelStep>[0];
    expected: boolean;
  }> = [
    {
      name: '--recommended flag (mode=recommended, modePromptShown=false, isTTY=true)',
      input: { mode: 'recommended', modePromptShown: false, isTTY: true, hasCliOverride: false },
      expected: false,
    },
    {
      name: '!isTTY fallback (mode=recommended, modePromptShown=false, isTTY=false)',
      input: { mode: 'recommended', modePromptShown: false, isTTY: false, hasCliOverride: false },
      expected: false,
    },
    {
      name: 'interactive mode-prompt → Recommended (modePromptShown=true)',
      input: { mode: 'recommended', modePromptShown: true, isTTY: true, hasCliOverride: false },
      expected: true,
    },
    {
      name: '--advanced flag / re-init banner path (mode=advanced, modePromptShown=false)',
      input: { mode: 'advanced', modePromptShown: false, isTTY: true, hasCliOverride: false },
      expected: true,
    },
    {
      name: 'interactive mode-prompt → Advanced (modePromptShown=true)',
      input: { mode: 'advanced', modePromptShown: true, isTTY: true, hasCliOverride: false },
      expected: true,
    },
    {
      name: '--gate-level on the Recommended path',
      input: { mode: 'recommended', modePromptShown: true, isTTY: true, hasCliOverride: true },
      expected: false,
    },
    {
      name: '--gate-level on the Advanced path',
      input: { mode: 'advanced', modePromptShown: false, isTTY: true, hasCliOverride: true },
      expected: false,
    },
    {
      name: '--gate-level on the non-TTY fallback',
      input: { mode: 'recommended', modePromptShown: false, isTTY: false, hasCliOverride: true },
      expected: false,
    },
  ];

  it('has exactly 8 rows', () => {
    expect(rows).toHaveLength(8);
  });

  for (const row of rows) {
    it(`${row.name} → ${row.expected}`, () => {
      expect(shouldRunGateLevelStep(row.input)).toBe(row.expected);
    });
  }
});

// ── Seeding: first install default, re-init keeps the stored level ─────────────

describe('gateLevelPromptSeed and describeGateLevel', () => {
  it('a first install (no manifest) starts on the default level', () => {
    expect(DEFAULT_GATE_LEVEL).toBe('standard');
    expect(gateLevelPromptSeed(resolveSeedFeatures(null).gateLevel)).toBe('standard');
    expect(describeGateLevel(resolveSeedFeatures(null).gateLevel)).toBe('standard (default)');
  });

  it('a registry seed starts on the default level', () => {
    expect(gateLevelPromptSeed(FEATURE_DEFAULTS.gateLevel)).toBe('standard');
  });

  it('a re-init over a manifest with no key starts on the default level', () => {
    expect(gateLevelPromptSeed(resolveSeedFeatures(makeManifest()).gateLevel)).toBe('standard');
  });

  it('a re-init starts on, and names, the stored level', () => {
    for (const level of GATE_LEVELS) {
      const features = { ...makeManifest().features, gateLevel: level };
      const seed = resolveSeedFeatures(makeManifest({ features }));
      expect(gateLevelPromptSeed(seed.gateLevel)).toBe(level);
      expect(describeGateLevel(seed.gateLevel)).toBe(level);
    }
  });

  it('a malformed stored value starts on the level it reads as (full) and says why', () => {
    const MALFORMED: unknown[] = ['Lean', 'lean ', '', null, false, 0, 5, { level: 'lean' }];
    expect(MALFORMED).toHaveLength(8);
    for (const value of MALFORMED) {
      expect(gateLevelPromptSeed(value), `expected ${JSON.stringify(value)} to read as full`).toBe('full');
      expect(describeGateLevel(value)).toContain('reads as full');
    }
  });
});

describe('gateLevelChoices and formatGateLevelCatalogue', () => {
  it('lists the three levels, most to least checking, each with a one-line effect', () => {
    const choices = gateLevelChoices();
    expect(choices.map(c => c.value)).toEqual(['full', 'standard', 'lean']);
    for (const choice of choices) {
      expect(choice.label).toBe(choice.value);
      expect(choice.hint).toBe(GATE_LEVEL_HINTS[choice.value]);
      expect(choice.hint.length).toBeGreaterThan(0);
      expect(choice.hint).not.toContain('\n');
    }
  });

  it('marks only the default level as the default', () => {
    const marked = gateLevelChoices().filter(c => c.hint.includes('default'));
    expect(marked.map(c => c.value)).toEqual([DEFAULT_GATE_LEVEL]);
  });

  it('prints one catalogue line per level', () => {
    const lines = formatGateLevelCatalogue().split('\n');
    expect(lines[0]).toBe('Levels:');
    expect(lines).toHaveLength(1 + GATE_LEVELS.length);
    GATE_LEVELS.forEach((level, i) => expect(lines[i + 1]).toContain(level));
  });
});

// ── runGateLevelStep ───────────────────────────────────────────────────────────

describe('runGateLevelStep', () => {
  it('first install: the select starts on the default level and offers all three', async () => {
    const { prompts, levelQueue, asked } = makePrompts();
    levelQueue.push({ kind: 'value', value: 'standard' });

    await runGateLevelStep({ stored: undefined, prompts });

    expect(asked).toHaveLength(1);
    expect(asked[0].message).toBe(GATE_LEVEL_SELECT_MESSAGE);
    expect(asked[0].initialValue).toBe('standard');
    expect(asked[0].options.map(o => o.value)).toEqual(['full', 'standard', 'lean']);
  });

  it('re-init: the select starts on the stored level, and accepting it keeps it', async () => {
    for (const stored of GATE_LEVELS) {
      const { prompts, levelQueue, asked } = makePrompts();
      // Accept the prompt exactly as shown: answer with whatever it starts on.
      levelQueue.push({ kind: 'value', value: stored });

      const outcome = await runGateLevelStep({ stored, prompts });

      expect(asked[0].initialValue).toBe(stored);
      expect(outcome).toEqual({ kind: 'resolved', level: stored });
    }
  });

  it('the note shows the current machine value', async () => {
    const { prompts, levelQueue, notes } = makePrompts();
    levelQueue.push({ kind: 'value', value: 'lean' });

    await runGateLevelStep({ stored: 'lean', prompts });

    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Gate level');
    expect(notes[0].message).toContain('Current setting: lean');
    expect(notes[0].message).toContain('devflow gates --set');
    expect(notes[0].message).toContain('.devflow/config.json');
  });

  it('the note on a first install names the default', async () => {
    const { prompts, levelQueue, notes } = makePrompts();
    levelQueue.push({ kind: 'value', value: 'standard' });

    await runGateLevelStep({ stored: undefined, prompts });

    expect(notes[0].message).toContain('Current setting: standard (default)');
  });

  it('returns the chosen level when it differs from the starting one', async () => {
    const { prompts, levelQueue } = makePrompts();
    levelQueue.push({ kind: 'value', value: 'lean' });

    expect(await runGateLevelStep({ stored: 'full', prompts })).toEqual({ kind: 'resolved', level: 'lean' });
  });

  it('returns cancelled when the user presses Escape, without throwing', async () => {
    const { prompts, levelQueue } = makePrompts();
    levelQueue.push({ kind: 'cancel' });

    expect(await runGateLevelStep({ stored: 'lean', prompts })).toEqual({ kind: 'cancelled' });
  });

  it('does not exit the process', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      const { prompts, levelQueue } = makePrompts();
      levelQueue.push({ kind: 'cancel' });
      await runGateLevelStep({ stored: undefined, prompts });
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });
});

// ── resolveGateLevelInitOption + resolveGateLevelForInit: the init paths ───────

describe('resolveGateLevelForInit', () => {
  const base = { cliLevel: undefined, stored: undefined, modePromptShown: false, isTTY: true } as const;

  describe('promptless paths keep the stored value untouched', () => {
    const STORED: unknown[] = [undefined, 'full', 'standard', 'lean', 'Lean', '', null, 5];
    const PROMPTLESS = [
      { name: '--recommended flag', mode: 'recommended', modePromptShown: false, isTTY: true },
      { name: 'non-TTY fallback', mode: 'recommended', modePromptShown: false, isTTY: false },
    ] as const;

    for (const path of PROMPTLESS) {
      it(`${path.name}: shows no prompt and carries every stored value through`, async () => {
        expect(STORED).toHaveLength(8);
        for (const stored of STORED) {
          const outcome = await resolveGateLevelForInit({
            ...base,
            mode: path.mode,
            modePromptShown: path.modePromptShown,
            isTTY: path.isTTY,
            stored,
            prompts: neverPrompts(),
          });
          expect(outcome, `stored ${JSON.stringify(stored)}`).toEqual({ kind: 'resolved', level: stored });
        }
      });
    }

    it('a first install leaves the level unrecorded, so the default applies at read time', async () => {
      const outcome = await resolveGateLevelForInit({
        ...base, mode: 'recommended', stored: resolveSeedFeatures(null).gateLevel, prompts: neverPrompts(),
      });
      expect(outcome).toEqual({ kind: 'resolved', level: undefined });
    });
  });

  describe('--gate-level sets the level with no prompt on every path', () => {
    const PATHS = [
      { name: '--recommended', mode: 'recommended', modePromptShown: false, isTTY: true },
      { name: 'non-TTY', mode: 'recommended', modePromptShown: false, isTTY: false },
      { name: 'interactive Recommended', mode: 'recommended', modePromptShown: true, isTTY: true },
      { name: '--advanced / re-init', mode: 'advanced', modePromptShown: false, isTTY: true },
      { name: 'interactive Advanced', mode: 'advanced', modePromptShown: true, isTTY: true },
    ] as const;

    for (const path of PATHS) {
      it(`${path.name}: lean wins over a stored full`, async () => {
        const outcome = await resolveGateLevelForInit({
          cliLevel: 'lean',
          stored: 'full',
          mode: path.mode,
          modePromptShown: path.modePromptShown,
          isTTY: path.isTTY,
          prompts: neverPrompts(),
        });
        expect(outcome).toEqual({ kind: 'resolved', level: 'lean' });
      });
    }

    it('lean replaces a malformed stored value', async () => {
      const outcome = await resolveGateLevelForInit({
        ...base, cliLevel: 'lean', stored: 'Lean', mode: 'advanced', prompts: neverPrompts(),
      });
      expect(outcome).toEqual({ kind: 'resolved', level: 'lean' });
    });
  });

  describe('interactive paths ask, and the answer is the level', () => {
    it('first install, Recommended chosen at the mode prompt: asks, starting on the default', async () => {
      const { prompts, levelQueue, asked } = makePrompts();
      levelQueue.push({ kind: 'value', value: 'lean' });

      const outcome = await resolveGateLevelForInit({
        ...base, mode: 'recommended', modePromptShown: true, prompts,
      });

      expect(asked).toHaveLength(1);
      expect(asked[0].initialValue).toBe('standard');
      expect(outcome).toEqual({ kind: 'resolved', level: 'lean' });
    });

    it('first install, Advanced chosen at the mode prompt: asks, and accepting keeps the default', async () => {
      const { prompts, levelQueue, asked } = makePrompts();
      levelQueue.push({ kind: 'value', value: 'standard' });

      const outcome = await resolveGateLevelForInit({
        ...base, mode: 'advanced', modePromptShown: true, prompts,
      });

      expect(asked[0].initialValue).toBe('standard');
      expect(outcome).toEqual({ kind: 'resolved', level: 'standard' });
    });

    it('re-init (Advanced, no mode prompt): asks, starting on the stored level, and accepting keeps it', async () => {
      const { prompts, levelQueue, asked } = makePrompts();
      levelQueue.push({ kind: 'value', value: 'full' });

      const outcome = await resolveGateLevelForInit({
        ...base, mode: 'advanced', stored: 'full', prompts,
      });

      expect(asked).toHaveLength(1);
      expect(asked[0].initialValue).toBe('full');
      expect(outcome).toEqual({ kind: 'resolved', level: 'full' });
    });

    it('re-init: a different answer replaces the stored level', async () => {
      const { prompts, levelQueue } = makePrompts();
      levelQueue.push({ kind: 'value', value: 'lean' });

      const outcome = await resolveGateLevelForInit({
        ...base, mode: 'advanced', stored: 'full', prompts,
      });

      expect(outcome).toEqual({ kind: 'resolved', level: 'lean' });
    });

    it('a cancelled prompt returns cancelled and records nothing', async () => {
      for (const mode of ['recommended', 'advanced'] as const) {
        const { prompts, levelQueue } = makePrompts();
        levelQueue.push({ kind: 'cancel' });

        const outcome = await resolveGateLevelForInit({
          ...base, mode, modePromptShown: true, stored: 'lean', prompts,
        });

        expect(outcome).toEqual({ kind: 'cancelled' });
      }
    });
  });
});

// ── formatGateLevelSummary ─────────────────────────────────────────────────────

describe('formatGateLevelSummary', () => {
  it('names the level the run recorded, as the machine default', () => {
    const lines = formatGateLevelSummary({ level: 'lean', priorLevel: 'full', manifestWritten: true });
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('info');
    expect(lines[0].message).toContain('Gate level: lean');
    expect(lines[0].message).toContain('machine default');
    expect(lines[0].message).toContain('devflow gates --set');
  });

  it('names the default when no level is recorded', () => {
    const [line] = formatGateLevelSummary({ level: undefined, priorLevel: undefined, manifestWritten: true });
    expect(line.message).toContain('Gate level: standard (default)');
  });

  it('shows the level a malformed stored value reads as, not the raw value', () => {
    const [line] = formatGateLevelSummary({ level: 'ZZ-raw-canary', priorLevel: undefined, manifestWritten: true });
    expect(line.message).toContain('Gate level: full');
    expect(line.message).not.toContain('ZZ-raw-canary');
  });

  it('when the manifest was not written, reports the prior level and warns that nothing changed', () => {
    const [line] = formatGateLevelSummary({ level: 'lean', priorLevel: 'full', manifestWritten: false });
    expect(line.level).toBe('warn');
    expect(line.message).toContain('Gate level: full');
    expect(line.message).not.toContain('lean');
    expect(line.message).toContain('changed nothing');
  });
});

// ── init.ts wiring: both wizard paths reach the one shared helper ──────────────

/**
 * A spawned child has no TTY, so the end-to-end suite cannot reach the prompt.
 * These read init.ts and pin the wiring that the tests above assume: one shared
 * helper, called once on each wizard path, with the caller's own mode and
 * modePromptShown. A literal mode would collapse the gate table to one row.
 */
describe('init.ts wiring', () => {
  const INIT_SOURCE = new URL('../src/cli/commands/init.ts', import.meta.url);

  /** The `resolveGateLevelForInit({...})` call, verbatim. Throws when it is not findable. */
  function gateCall(source: string): string {
    const call = /resolveGateLevelForInit\(\{[\s\S]*?\}\)/.exec(source);
    if (call === null) {
      throw new Error('the resolveGateLevelForInit call is not findable in init.ts, so no assertion below reads it');
    }
    return call[0];
  }

  it('calls the one shared helper, once on each wizard path', async () => {
    const source = await fs.readFile(INIT_SOURCE, 'utf-8');
    expect((source.match(/resolveGateLevelForInit\(\{/g) ?? []).length).toBe(1);
    expect((source.match(/await runGateLevelStepAt\('recommended'\)/g) ?? []).length).toBe(1);
    expect((source.match(/await runGateLevelStepAt\('advanced'\)/g) ?? []).length).toBe(1);
  });

  it('forwards the caller\'s mode and modePromptShown, never a literal', async () => {
    const lines = gateCall(await fs.readFile(INIT_SOURCE, 'utf-8')).split('\n').map(line => line.trim());
    expect(lines).toContain('mode,');
    expect(lines).toContain('modePromptShown,');
  });
});

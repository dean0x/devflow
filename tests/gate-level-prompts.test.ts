/**
 * Tests for src/cli/commands/gate-level-prompts.ts
 *
 * Covers:
 *   - resolveGateLevelInitState: the --gate-level boundary (valid, invalid, --hud-only)
 *   - shouldRunGateLevelStep: all 8 gate rows (the compliance/tracker gate table)
 *   - classifyGateLevel / gateLevelPromptSeed / describeGateLevel: first install, re-init,
 *     malformed values
 *   - runGateLevelStep: step semantics via fake recorded IO (injectable prompts)
 *   - resolveGateLevelForInit: both init paths (Recommended / Advanced), the flag, the
 *     promptless contracts, and the cancel outcome
 *   - formatGateLevelSummary: the post-install row, from the state the run acted on
 *   - storedGateLevelFromRaw / readStoredGateLevel / carriedGateLevel: the level init keeps
 *     from a manifest readManifest refuses, the level a run carries into the manifest it
 *     writes, and the prompt and summary texts for a level read from one or not readable at all
 *   - formatGateLevelRow: the gate-level row of the Recommended settings note
 *   - parity with devflow gates: the two level tables and the malformed wording agree
 *   - init.ts wiring: both wizard paths call the one shared helper with their own mode
 *
 * The gate keys on `modePromptShown`, never on the mode name. Nothing here calls
 * process.exit and nothing throws: the returned discriminated unions drive every
 * caller decision. The fake IO fails loudly when over-consumed, and each table
 * asserts its own row count, so no test passes without exercising what it claims to.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  GATE_LEVEL_HINTS,
  GATE_LEVEL_SELECT_MESSAGE,
  carriedGateLevel,
  classifyGateLevel,
  describeGateLevel,
  formatGateLevelCatalogue,
  formatGateLevelRow,
  formatGateLevelSummary,
  gateLevelChoices,
  gateLevelPromptSeed,
  readStoredGateLevel,
  resolveGateLevelForInit,
  resolveGateLevelInitState,
  runGateLevelStep,
  shouldRunGateLevelStep,
  storedGateLevelFromRaw,
  type GateLevelPromptIO,
} from '../src/cli/commands/gate-level-prompts.js';
import type { PromptOutcome } from '../src/cli/commands/prompt-io.js';
import { GATE_LEVEL_EFFECT, GATE_LEVEL_MEANINGS, renderGateStatus } from '../src/cli/commands/gates.js';
import {
  DEFAULT_GATE_LEVEL,
  GATE_LEVELS,
  MALFORMED_GATE_LEVEL_READS_AS,
  parseGateLevel,
  type GateLevel,
  type GateManifestRead,
} from '../src/core/gate-level.js';
import { FEATURE_DEFAULTS, resolveSeedFeatures } from '../src/cli/commands/init-seed.js';
import { makeManifest } from './helpers.js';

// ── Fake prompt builder ────────────────────────────────────────────────────────

/**
 * What a test answers at the level prompt: a chosen level, a cancel, or `accept`, which
 * is Enter on the value the prompt showed. `accept` returns what the prompt offered as
 * `initialValue`, so a test that accepts checks that the shown start value is what Enter writes.
 */
type LevelAnswer = PromptOutcome<GateLevel> | { kind: 'accept' };

/**
 * Build a fake GateLevelPromptIO from queued responses. Responses are consumed in
 * order; the test fails loudly if a prompt is called more times than responses
 * were queued (non-vacuous assertions).
 */
function makePrompts() {
  const levelQueue: LevelAnswer[] = [];
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
      if (next.kind === 'accept') return { kind: 'value', value: opts.initialValue };
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

// ── resolveGateLevelInitState — the --gate-level boundary ─────────────────────

describe('resolveGateLevelInitState', () => {
  it('returns undefined when the option was not passed', () => {
    expect(resolveGateLevelInitState(undefined, false)).toBeUndefined();
  });

  it('accepts each of the three levels', () => {
    expect(GATE_LEVELS).toHaveLength(3);
    for (const level of GATE_LEVELS) {
      expect(resolveGateLevelInitState(level, false)).toEqual({ ok: true, value: level });
    }
  });

  it('rejects a value that is not exactly one of the three words, naming the valid ones', () => {
    const BAD = ['Lean', 'lean ', ' lean', 'FULL', 'strict', '', 'standard,lean'];
    expect(BAD).toHaveLength(7);
    for (const value of BAD) {
      const result = resolveGateLevelInitState(value, false);
      expect(result?.ok, `expected ${JSON.stringify(value)} to be rejected`).toBe(false);
      if (result !== undefined && !result.ok) {
        expect(result.error).toContain('Valid levels: full, standard, lean');
      }
    }
  });

  it('passes the parser error through unchanged, as the tracker and compliance parsers do', () => {
    for (const value of ['Lean', 'strict', '']) {
      const parsed = parseGateLevel(value);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(resolveGateLevelInitState(value, false)).toEqual({ ok: false, error: parsed.error });
      }
    }
  });

  it('refuses --hud-only with a valid level instead of ignoring the flag', () => {
    const result = resolveGateLevelInitState('lean', true);
    expect(result?.ok).toBe(false);
    if (result !== undefined && !result.ok) expect(result.error).toContain('--hud-only');
  });

  it('reports a bad value before the --hud-only conflict', () => {
    const result = resolveGateLevelInitState('Lean', true);
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
      expect(describeGateLevel(value)).toBe(`invalid (manifest.json; reads as ${MALFORMED_GATE_LEVEL_READS_AS})`);
    }
  });

  it('a level that cannot be read starts on the level that applies, and names no stored level', () => {
    expect(gateLevelPromptSeed(undefined, 'unreadable')).toBe(DEFAULT_GATE_LEVEL);
  });
});

describe('classifyGateLevel', () => {
  it('reads an absent value as the default', () => {
    expect(classifyGateLevel(undefined)).toEqual({ kind: 'default' });
    expect(classifyGateLevel(undefined, 'manifest')).toEqual({ kind: 'default' });
    expect(classifyGateLevel(undefined, 'rejected')).toEqual({ kind: 'default' });
  });

  it('reads each of the three words as that level', () => {
    for (const level of GATE_LEVELS) {
      expect(classifyGateLevel(level)).toEqual({ kind: 'level', level });
    }
  });

  it('reads every other present value as malformed, null and the empty string included', () => {
    const MALFORMED: unknown[] = ['Lean', 'lean ', '', null, false, 0, 5, { level: 'lean' }];
    expect(MALFORMED).toHaveLength(8);
    for (const value of MALFORMED) {
      expect(classifyGateLevel(value), `stored ${JSON.stringify(value)}`).toEqual({ kind: 'malformed' });
    }
  });

  it('reads an absent value from a manifest that cannot be read as unreadable, never as the default', () => {
    expect(classifyGateLevel(undefined, 'unreadable')).toEqual({ kind: 'unreadable' });
  });

  it('reads a value that is present as itself whatever the origin, so a recorded level is never unknown', () => {
    expect(classifyGateLevel('lean', 'unreadable')).toEqual({ kind: 'level', level: 'lean' });
    expect(classifyGateLevel('Lean', 'rejected')).toEqual({ kind: 'malformed' });
  });
});

/** An array nested `depth` levels deep, built without recursion. */
function nestedArray(depth: number): unknown {
  let value: unknown = [];
  for (let level = 0; level < depth; level++) value = [value];
  return value;
}

/** Deep enough that JSON.stringify runs out of stack, shallow enough that JSON.parse still reads it. */
const DEEP_NESTING = 200_000;

describe('storedGateLevelFromRaw', () => {
  const rawManifest = (features: Record<string, unknown>): Record<string, unknown> => ({ features });

  it('reads no level from a machine without a manifest, so a first install stays a first install', () => {
    expect(storedGateLevelFromRaw({ kind: 'absent' })).toEqual({ origin: 'manifest', value: undefined });
  });

  it('keeps the raw level of a manifest readManifest refuses, whatever the value is', () => {
    const VALUES: unknown[] = ['full', 'standard', 'lean', 'Lean', '', null, 5, false];
    expect(VALUES).toHaveLength(8);
    for (const value of VALUES) {
      const read: GateManifestRead = { kind: 'rejected', raw: rawManifest({ gateLevel: value }) };
      expect(storedGateLevelFromRaw(read), `stored ${JSON.stringify(value)}`).toEqual({ origin: 'rejected', value });
    }
  });

  it('reads no level from a refused manifest that records none', () => {
    expect(storedGateLevelFromRaw({ kind: 'rejected', raw: rawManifest({ ambient: true }) }))
      .toEqual({ origin: 'manifest', value: undefined });
  });

  it('reports a manifest that cannot be read as unreadable, and never invents a level for it', () => {
    expect(storedGateLevelFromRaw({ kind: 'corrupt' })).toEqual({ origin: 'unreadable', value: undefined });
  });

  it('reads the level of a manifest readManifest would accept as an ordinary stored level', () => {
    expect(storedGateLevelFromRaw({ kind: 'object', raw: rawManifest({ gateLevel: 'lean' }) }))
      .toEqual({ origin: 'manifest', value: 'lean' });
    expect(storedGateLevelFromRaw({ kind: 'object', raw: rawManifest({}) }))
      .toEqual({ origin: 'manifest', value: undefined });
  });

  it('reports a level that cannot be written back as JSON as unreadable, so the write that replaces the manifest cannot fail on it', () => {
    const deep = nestedArray(DEEP_NESTING);
    // The precondition: this value parses, and serializing it fails.
    expect(() => JSON.stringify(deep)).toThrow(RangeError);
    for (const kind of ['rejected', 'object'] as const) {
      const stored = storedGateLevelFromRaw({ kind, raw: rawManifest({ gateLevel: deep }) });
      expect(stored, kind).toEqual({ origin: 'unreadable', value: undefined });
    }
  });
});

describe('readStoredGateLevel', () => {
  it('reads the level from a manifest readManifest returned, without opening the file', async () => {
    const manifest = makeManifest({ features: { ...makeManifest().features, gateLevel: 'lean' } });
    expect(await readStoredGateLevel('/nonexistent-devflow-dir', manifest, false))
      .toEqual({ origin: 'manifest', value: 'lean' });
  });

  describe('with no manifest from readManifest', () => {
    let devflowDir: string;
    beforeEach(async () => {
      devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-stored-gate-'));
    });
    afterEach(async () => {
      await fs.rm(devflowDir, { recursive: true, force: true });
    });
    const writeManifestText = (text: string): Promise<void> => fs.writeFile(path.join(devflowDir, 'manifest.json'), text, 'utf-8');

    it('reads no level on a first install', async () => {
      expect(await readStoredGateLevel(devflowDir, null, false)).toEqual({ origin: 'manifest', value: undefined });
    });

    it('keeps the raw level of a manifest it refuses, malformed and null included', async () => {
      for (const stored of ['full', 'Lean', null]) {
        await writeManifestText(JSON.stringify({ features: { gateLevel: stored } }));
        expect(await readStoredGateLevel(devflowDir, null, false), `stored ${JSON.stringify(stored)}`)
          .toEqual({ origin: 'rejected', value: stored });
      }
    });

    it('reports a manifest that cannot be read as unreadable', async () => {
      await writeManifestText('{not json');
      expect(await readStoredGateLevel(devflowDir, null, false)).toEqual({ origin: 'unreadable', value: undefined });
    });

    it('reports a level nested too deeply to write back as unreadable', async () => {
      await writeManifestText(`{"features":{"gateLevel":${'['.repeat(DEEP_NESTING)}${']'.repeat(DEEP_NESTING)}}}`);
      expect(await readStoredGateLevel(devflowDir, null, false)).toEqual({ origin: 'unreadable', value: undefined });
    });

    it('under --reset still reads the level a refused manifest stores, as the level the run replaces', async () => {
      await writeManifestText(JSON.stringify({ features: { gateLevel: 'full' } }));
      expect(await readStoredGateLevel(devflowDir, null, true)).toEqual({ origin: 'rejected', value: 'full' });
    });

    it('under --reset reports no warning for a manifest it cannot read, which the reset forgets anyway', async () => {
      await writeManifestText('{not json');
      expect(await readStoredGateLevel(devflowDir, null, true)).toEqual({ origin: 'manifest', value: undefined });
    });

    it('under --reset reads the level of a manifest readManifest returned, as before', async () => {
      const manifest = makeManifest({ features: { ...makeManifest().features, gateLevel: 'lean' } });
      expect(await readStoredGateLevel(devflowDir, manifest, true)).toEqual({ origin: 'manifest', value: 'lean' });
    });
  });
});

describe('carriedGateLevel', () => {
  const manifest = makeManifest({ features: { ...makeManifest().features, gateLevel: 'lean' } });

  it('over a manifest readManifest returned, carries the seed level', () => {
    expect(carriedGateLevel({ manifest, reset: false, stored: { origin: 'manifest', value: 'lean' }, seedLevel: 'lean' }))
      .toEqual({ origin: 'manifest', value: 'lean' });
  });

  it('when readManifest returned none, carries the level read raw, malformed and null included', () => {
    for (const value of ['full', 'Lean', null]) {
      expect(carriedGateLevel({ manifest: null, reset: false, stored: { origin: 'rejected', value }, seedLevel: undefined }), `stored ${JSON.stringify(value)}`)
        .toEqual({ origin: 'rejected', value });
    }
  });

  it('when the raw read finds a manifest readManifest returned none for, carries its level, as --hud-only does', () => {
    expect(carriedGateLevel({ manifest: null, reset: false, stored: { origin: 'manifest', value: 'full' }, seedLevel: undefined }))
      .toEqual({ origin: 'manifest', value: 'full' });
  });

  it('carries no level for a manifest that cannot be read, and keeps the origin', () => {
    expect(carriedGateLevel({ manifest: null, reset: false, stored: { origin: 'unreadable', value: undefined }, seedLevel: undefined }))
      .toEqual({ origin: 'unreadable', value: undefined });
  });

  it('on a first install carries no level', () => {
    expect(carriedGateLevel({ manifest: null, reset: false, stored: { origin: 'manifest', value: undefined }, seedLevel: undefined }))
      .toEqual({ origin: 'manifest', value: undefined });
  });

  it('under --reset carries the seed level alone, whatever was stored', () => {
    const STORED = [
      { origin: 'rejected', value: 'full' },
      { origin: 'manifest', value: 'full' },
      { origin: 'unreadable', value: undefined },
    ] as const;
    for (const stored of STORED) {
      expect(carriedGateLevel({ manifest: null, reset: true, stored, seedLevel: undefined }), stored.origin)
        .toEqual({ origin: 'manifest', value: undefined });
    }
    expect(carriedGateLevel({ manifest, reset: true, stored: { origin: 'manifest', value: 'lean' }, seedLevel: undefined }))
      .toEqual({ origin: 'manifest', value: undefined });
  });
});

describe('formatGateLevelRow', () => {
  it('names the default when no level is recorded', () => {
    expect(formatGateLevelRow(undefined, 'manifest')).toBe('standard (default)');
  });

  it('names a level, whether it was chosen or kept', () => {
    expect(formatGateLevelRow('lean', 'manifest')).toBe('lean');
    expect(formatGateLevelRow('full', 'rejected')).toBe('full');
    expect(formatGateLevelRow('lean', 'unreadable')).toBe('lean');
  });

  it('shows the level a malformed value reads as, never the raw value', () => {
    const row = formatGateLevelRow('ZZ-raw-canary', 'rejected');
    expect(row).toBe(describeGateLevel('ZZ-raw-canary'));
    expect(row).toContain('reads as full');
    expect(row).not.toContain('ZZ-raw-canary');
  });

  it('shows an unreadable level as unknown, never as the default', () => {
    const row = formatGateLevelRow(undefined, 'unreadable');
    expect(row).toMatch(/^unknown\b/);
    expect(row).not.toContain('standard (default)');
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
    levelQueue.push({ kind: 'accept' });

    await runGateLevelStep({ stored: undefined, prompts });

    expect(asked).toHaveLength(1);
    expect(asked[0].message).toBe(GATE_LEVEL_SELECT_MESSAGE);
    expect(asked[0].initialValue).toBe('standard');
    expect(asked[0].options.map(o => o.value)).toEqual(['full', 'standard', 'lean']);
  });

  it('re-init: the select starts on the stored level, and accepting it keeps it', async () => {
    for (const stored of GATE_LEVELS) {
      const { prompts, levelQueue, asked } = makePrompts();
      // Accept the prompt exactly as shown: Enter on whatever it starts on.
      levelQueue.push({ kind: 'accept' });

      const outcome = await runGateLevelStep({ stored, prompts });

      expect(asked[0].initialValue).toBe(stored);
      expect(outcome).toEqual({ kind: 'resolved', level: stored });
    }
  });

  it('the note shows the current machine value', async () => {
    const { prompts, levelQueue, notes } = makePrompts();
    levelQueue.push({ kind: 'accept' });

    await runGateLevelStep({ stored: 'lean', prompts });

    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Gate level');
    expect(notes[0].message).toContain('Current setting: lean');
    expect(notes[0].message).toContain('devflow gates --set');
    expect(notes[0].message).toContain('.devflow/config.json');
  });

  it('the note on a first install names the default', async () => {
    const { prompts, levelQueue, notes } = makePrompts();
    levelQueue.push({ kind: 'accept' });

    await runGateLevelStep({ stored: undefined, prompts });

    expect(notes[0].message).toContain('Current setting: standard (default)');
  });

  it('a level read from a refused manifest: the note names it and says init keeps it, and the select starts on it', async () => {
    const { prompts, levelQueue, notes, asked } = makePrompts();
    levelQueue.push({ kind: 'accept' });

    const outcome = await runGateLevelStep({ stored: 'full', storedOrigin: 'rejected', prompts });

    expect(notes[0].message).toContain('Current setting: full');
    expect(notes[0].message).toContain('devflow rejects');
    expect(notes[0].message).toContain('keeps this level');
    expect(notes[0].message).not.toContain('standard (default)');
    expect(asked[0].initialValue).toBe('full');
    expect(outcome).toEqual({ kind: 'resolved', level: 'full' });
  });

  it('a malformed level read from a refused manifest: the note says how it reads, never the raw value', async () => {
    const { prompts, levelQueue, notes, asked } = makePrompts();
    levelQueue.push({ kind: 'accept' });

    await runGateLevelStep({ stored: 'ZZ-raw-canary', storedOrigin: 'rejected', prompts });

    expect(notes[0].message).toContain('Current setting: invalid (manifest.json; reads as full)');
    expect(notes[0].message).not.toContain('ZZ-raw-canary');
    expect(asked[0].initialValue).toBe('full');
  });

  it('a stored level that cannot be read: the note says so and never shows the default as if it were stored', async () => {
    const { prompts, levelQueue, notes, asked } = makePrompts();
    levelQueue.push({ kind: 'accept' });

    await runGateLevelStep({ stored: undefined, storedOrigin: 'unreadable', prompts });

    expect(notes[0].message).toContain('Current setting: unknown');
    expect(notes[0].message).toContain('cannot be read');
    expect(notes[0].message).toContain('standard applies');
    expect(notes[0].message).not.toContain('standard (default)');
    expect(asked[0].initialValue).toBe('standard');
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

// ── resolveGateLevelInitState + resolveGateLevelForInit: the init paths ───────

describe('resolveGateLevelForInit', () => {
  const base = { cliLevel: undefined, stored: undefined, storedOrigin: 'manifest', modePromptShown: false, isTTY: true } as const;

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
          expect(outcome, `stored ${JSON.stringify(stored)}`).toEqual({ kind: 'resolved', level: stored, carried: true });
        }
      });
    }

    it('a first install leaves the level unrecorded, so the default applies at read time', async () => {
      const outcome = await resolveGateLevelForInit({
        ...base, mode: 'recommended', stored: resolveSeedFeatures(null).gateLevel, prompts: neverPrompts(),
      });
      expect(outcome).toEqual({ kind: 'resolved', level: undefined, carried: true });
    });
  });

  describe('a stored level read from a refused manifest, or not readable, reaches the prompt and the carry', () => {
    it('promptless: a level read from a refused manifest is carried raw, and an unreadable one stays unrecorded', async () => {
      for (const stored of ['full', 'ZZ-raw-canary', null]) {
        const kept = await resolveGateLevelForInit({
          ...base, mode: 'recommended', stored, storedOrigin: 'rejected', prompts: neverPrompts(),
        });
        expect(kept, `stored ${JSON.stringify(stored)}`).toEqual({ kind: 'resolved', level: stored, carried: true });
      }
      const unreadable = await resolveGateLevelForInit({
        ...base, mode: 'recommended', stored: undefined, storedOrigin: 'unreadable', prompts: neverPrompts(),
      });
      expect(unreadable).toEqual({ kind: 'resolved', level: undefined, carried: true });
    });

    it('interactive: the prompt receives the origin, so an unreadable level is not shown as the default', async () => {
      const { prompts, levelQueue, notes } = makePrompts();
      levelQueue.push({ kind: 'value', value: 'lean' });

      const outcome = await resolveGateLevelForInit({
        ...base, mode: 'advanced', stored: undefined, storedOrigin: 'unreadable', prompts,
      });

      expect(notes[0].message).toContain('Current setting: unknown');
      expect(notes[0].message).toContain('cannot be read');
      expect(notes[0].message).not.toContain('standard (default)');
      expect(outcome).toEqual({ kind: 'resolved', level: 'lean', carried: false });
    });

    it('interactive: the prompt receives the origin, so a level from a refused manifest is named as kept', async () => {
      const { prompts, levelQueue, notes, asked } = makePrompts();
      levelQueue.push({ kind: 'accept' });

      const outcome = await resolveGateLevelForInit({
        ...base, mode: 'advanced', stored: 'full', storedOrigin: 'rejected', prompts,
      });

      expect(notes[0].message).toContain('Current setting: full');
      expect(notes[0].message).toContain('devflow rejects');
      expect(notes[0].message).toContain('keeps this level');
      expect(asked[0].initialValue).toBe('full');
      expect(outcome).toEqual({ kind: 'resolved', level: 'full', carried: false });
    });

    it('--gate-level replaces either without a prompt', async () => {
      for (const storedOrigin of ['rejected', 'unreadable'] as const) {
        const outcome = await resolveGateLevelForInit({
          ...base, cliLevel: 'lean', mode: 'advanced', stored: storedOrigin === 'rejected' ? 'full' : undefined,
          storedOrigin, prompts: neverPrompts(),
        });
        expect(outcome, storedOrigin).toEqual({ kind: 'resolved', level: 'lean', carried: false });
      }
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
          storedOrigin: 'manifest',
          mode: path.mode,
          modePromptShown: path.modePromptShown,
          isTTY: path.isTTY,
          prompts: neverPrompts(),
        });
        expect(outcome).toEqual({ kind: 'resolved', level: 'lean', carried: false });
      });
    }

    it('lean replaces a malformed stored value', async () => {
      const outcome = await resolveGateLevelForInit({
        ...base, cliLevel: 'lean', stored: 'Lean', mode: 'advanced', prompts: neverPrompts(),
      });
      expect(outcome).toEqual({ kind: 'resolved', level: 'lean', carried: false });
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
      expect(outcome).toEqual({ kind: 'resolved', level: 'lean', carried: false });
    });

    it('first install, Advanced chosen at the mode prompt: asks, and accepting keeps the default', async () => {
      const { prompts, levelQueue, asked } = makePrompts();
      levelQueue.push({ kind: 'accept' });

      const outcome = await resolveGateLevelForInit({
        ...base, mode: 'advanced', modePromptShown: true, prompts,
      });

      expect(asked[0].initialValue).toBe('standard');
      expect(outcome).toEqual({ kind: 'resolved', level: 'standard', carried: false });
    });

    it('re-init (Advanced, no mode prompt): asks, starting on the stored level, and accepting keeps it', async () => {
      const { prompts, levelQueue, asked } = makePrompts();
      levelQueue.push({ kind: 'accept' });

      const outcome = await resolveGateLevelForInit({
        ...base, mode: 'advanced', stored: 'full', prompts,
      });

      expect(asked).toHaveLength(1);
      expect(asked[0].initialValue).toBe('full');
      expect(outcome).toEqual({ kind: 'resolved', level: 'full', carried: false });
    });

    it('re-init: a different answer replaces the stored level', async () => {
      const { prompts, levelQueue } = makePrompts();
      levelQueue.push({ kind: 'value', value: 'lean' });

      const outcome = await resolveGateLevelForInit({
        ...base, mode: 'advanced', stored: 'full', prompts,
      });

      expect(outcome).toEqual({ kind: 'resolved', level: 'lean', carried: false });
    });

    it('a cancelled prompt returns cancelled on both paths', async () => {
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
    const lines = formatGateLevelSummary({ level: 'lean', priorLevel: 'full', kept: false, manifestWritten: true });
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('info');
    expect(lines[0].message).toContain('Gate level: lean');
    expect(lines[0].message).toContain('machine default');
    expect(lines[0].message).toContain('devflow gates --set');
  });

  it('names the default when no level is recorded', () => {
    const [line] = formatGateLevelSummary({ level: undefined, priorLevel: undefined, kept: false, manifestWritten: true });
    expect(line.message).toContain('Gate level: standard (default)');
  });

  it('shows the level a malformed stored value reads as, not the raw value', () => {
    const [line] = formatGateLevelSummary({ level: 'ZZ-raw-canary', priorLevel: 'ZZ-raw-canary', kept: false, manifestWritten: true });
    expect(line.message).toContain('Gate level: invalid (manifest.json; reads as full)');
    expect(line.message).not.toContain('ZZ-raw-canary');
  });

  it('when the manifest was not written, reports the prior level and warns that the gate level did not change', () => {
    const [line] = formatGateLevelSummary({ level: 'lean', priorLevel: 'full', kept: false, manifestWritten: false });
    expect(line.level).toBe('warn');
    expect(line.message).toContain('Gate level: full');
    expect(line.message).not.toContain('lean');
    expect(line.message).toContain('so the gate level did not change');
    expect(line.message).not.toContain('changed nothing');
  });

  describe('a run that changes the level names the prior one', () => {
    const only = (input: Parameters<typeof formatGateLevelSummary>[0]): string => {
      const lines = formatGateLevelSummary(input);
      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe('info');
      return lines[0].message;
    };

    it('--reset over a stored level: the default it falls back to, and the level it replaced', () => {
      expect(only({ level: undefined, priorLevel: 'lean', kept: false, manifestWritten: true }))
        .toContain('Gate level: standard (default) (was lean) — the machine default');
    });

    it('a chosen level over another: the level it replaced', () => {
      expect(only({ level: 'lean', priorLevel: 'full', kept: false, manifestWritten: true }))
        .toContain('Gate level: lean (was full) — the machine default');
    });

    it('a chosen level over a default nobody recorded: the level that applied until now', () => {
      expect(only({ level: 'lean', priorLevel: undefined, kept: false, manifestWritten: true }))
        .toContain('Gate level: lean (was standard) — the machine default');
    });

    it('a chosen level over a malformed one: the level that malformed value read as, never the raw value', () => {
      const message = only({ level: 'lean', priorLevel: 'ZZ-raw-canary', kept: false, manifestWritten: true });
      expect(message).toContain('Gate level: lean (was full)');
      expect(message).not.toContain('ZZ-raw-canary');
    });

    it('is silent when the level that applies did not change', () => {
      const SAME: Array<[unknown, unknown, string]> = [
        ['lean', 'lean', 'the same level'],
        [undefined, undefined, 'a first install'],
        ['standard', undefined, 'an explicit standard over the default'],
        [undefined, 'standard', 'the default over a stored standard'],
        ['ZZ-raw-canary', 'ZZ-raw-canary', 'a malformed value written back as it was stored'],
        ['full', 'ZZ-raw-canary', 'the level a malformed value reads as, accepted at the prompt'],
        [null, null, 'a null written back as it was stored'],
      ];
      expect(SAME).toHaveLength(7);
      for (const [level, priorLevel, label] of SAME) {
        expect(only({ level, priorLevel, kept: false, manifestWritten: true }), label).not.toContain('(was');
      }
    });
  });

  describe('a level read from a refused manifest', () => {
    it('--reset over it: the default it falls back to, the level it replaced, and no claim that it was kept', () => {
      const lines = formatGateLevelSummary({ level: undefined, priorLevel: 'full', priorOrigin: 'rejected', kept: false, manifestWritten: true });
      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe('info');
      expect(lines[0].message).toContain('Gate level: standard (default) (was full) — the machine default');
    });

    it('names the kept level, and warns that init kept it while it replaced the refused manifest', () => {
      const lines = formatGateLevelSummary({ level: 'full', priorLevel: 'full', priorOrigin: 'rejected', kept: true, manifestWritten: true });
      expect(lines).toHaveLength(2);
      expect(lines[0].level).toBe('info');
      expect(lines[0].message).toContain('Gate level: full');
      expect(lines[0].message).not.toContain('(default)');
      expect(lines[1].level).toBe('warn');
      expect(lines[1].message).toContain('kept the stored gate level');
      expect(lines[1].message).toContain('replaced a manifest that devflow rejects');
    });

    it('names no prior level for a level it kept', () => {
      const lines = formatGateLevelSummary({ level: 'full', priorLevel: 'full', priorOrigin: 'rejected', kept: true, manifestWritten: true });
      expect(lines[0].message).not.toContain('(was');
    });

    it('says nothing of a kept level when the run set another one, and names the level it replaced', () => {
      const lines = formatGateLevelSummary({ level: 'lean', priorLevel: 'full', priorOrigin: 'rejected', kept: false, manifestWritten: true });
      expect(lines).toHaveLength(1);
      expect(lines[0].message).toContain('Gate level: lean (was full)');
    });

    it('says nothing of a kept level when the user chose the level the manifest stored (--gate-level, or an answer at the prompt)', () => {
      for (const priorLevel of ['full', 'ZZ-raw-canary']) {
        const lines = formatGateLevelSummary({ level: priorLevel, priorLevel, priorOrigin: 'rejected', kept: false, manifestWritten: true });
        expect(lines, `stored ${priorLevel}`).toHaveLength(1);
        expect(lines[0].level).toBe('info');
        expect(lines[0].message).not.toContain('kept');
      }
    });

    it('keeps a malformed level as it is stored, names how it reads, and never prints the raw value', () => {
      const lines = formatGateLevelSummary({ level: 'ZZ-raw-canary', priorLevel: 'ZZ-raw-canary', priorOrigin: 'rejected', kept: true, manifestWritten: true });
      expect(lines).toHaveLength(2);
      expect(lines[0].message).toContain('Gate level: invalid (manifest.json; reads as full)');
      expect(lines[0].message).not.toContain('(was');
      expect(lines.map(line => line.message).join('\n')).not.toContain('ZZ-raw-canary');
    });

    it('when the manifest was not written, names the level still on disk and claims nothing was kept', () => {
      const lines = formatGateLevelSummary({ level: 'full', priorLevel: 'full', priorOrigin: 'rejected', kept: true, manifestWritten: false });
      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe('warn');
      expect(lines[0].message).toContain('Gate level: full');
      expect(lines[0].message).toContain('so the gate level did not change');
    });
  });

  describe('a stored level that cannot be read', () => {
    it('warns that it could not be read, names the level that applies, and says how to set it again', () => {
      const lines = formatGateLevelSummary({ level: undefined, priorLevel: undefined, priorOrigin: 'unreadable', kept: false, manifestWritten: true });
      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe('warn');
      expect(lines[0].message).toContain('could not be read');
      expect(lines[0].message).toContain('standard');
      expect(lines[0].message).toContain('machine default');
      expect(lines[0].message).toContain('devflow gates --set <level>');
      expect(lines[0].message).not.toContain('standard (default)');
    });

    it('is a plain summary line when the run recorded a level, with no prior level invented for it', () => {
      const lines = formatGateLevelSummary({ level: 'lean', priorLevel: undefined, priorOrigin: 'unreadable', kept: false, manifestWritten: true });
      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe('info');
      expect(lines[0].message).toContain('Gate level: lean');
      expect(lines[0].message).not.toContain('(was');
    });

    it('when the manifest was not written, does not show the default as the prior level', () => {
      const lines = formatGateLevelSummary({ level: undefined, priorLevel: undefined, priorOrigin: 'unreadable', kept: false, manifestWritten: false });
      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe('warn');
      expect(lines[0].message).toContain('cannot be read');
      expect(lines[0].message).toContain('so the gate level did not change');
      expect(lines[0].message).not.toContain('standard (default)');
    });
  });
});

// ── Parity with devflow gates ──────────────────────────────────────────────────

/**
 * `devflow gates` and the init prompt each describe the levels, in tables:
 * GATE_LEVEL_MEANINGS and GATE_LEVEL_EFFECT in gates.ts, GATE_LEVEL_HINTS here.
 *
 * Two kinds of check hold them together:
 *   - the pin: the exact text of every table, so a change to any table fails until the
 *     other tables are checked and the pin is updated. It cannot tell which change is
 *     right; it makes every change a deliberate one.
 *   - the facet rows: the level sets, the level a malformed value reads as, the lint pack
 *     level, the levels that run fewer review focuses and the levels that skip Polish.
 *     They fail when the tables disagree on those facets, and they do not read any
 *     other clause.
 */
describe('the init prompt and devflow gates describe the same levels', () => {
  const sorted = (keys: readonly string[]): string[] => [...keys].sort();

  describe('the exact text of the tables is pinned', () => {
    const UPDATE_BOTH =
      'The init prompt (GATE_LEVEL_HINTS) and devflow gates (GATE_LEVEL_EFFECT, GATE_LEVEL_MEANINGS) '
      + 'describe the same levels. Update the other table too, then update this pin.';

    it('GATE_LEVEL_HINTS', () => {
      expect({ ...GATE_LEVEL_HINTS }, `GATE_LEVEL_HINTS changed. ${UPDATE_BOTH}`).toEqual({
        full: 'the most checking: every review focus, the full planning shape and Polish',
        standard: 'fewer review focuses and planning agents, no Polish in /implement and /resolve, severity tiers in /resolve, and one Evaluate pass in /implement (the default)',
        lean: 'the least checking, and no Polish in /implement and /resolve; /resolve also applies severity tiers; /implement also runs one Evaluate pass, has Validate run the project lint pack, and skips Harden on a docs-only diff',
      });
    });

    it('GATE_LEVEL_EFFECT', () => {
      expect(
        GATE_LEVEL_EFFECT,
        `GATE_LEVEL_EFFECT changed. ${UPDATE_BOTH}`,
      ).toBe(
        '/code-review and /plan read the level: standard and lean run fewer review focuses and fewer planning agents. '
        + 'At lean, /implement has Validate run the project\'s lint pack. '
        + '/implement and /resolve also read the level and name it in their report; at standard and lean they skip Polish, and full keeps it. '
        + 'At lean, /implement skips Harden on a docs-only diff. '
        + 'At standard and lean, /implement runs one Evaluate pass and at most one Fix round. '
        + 'At standard and lean, /resolve applies severity tiers: it fixes CRITICAL, HIGH, severe MEDIUM and security findings in batches, fixes prose-only findings with text edits alone, and sends the rest to one backlog issue.',
      );
    });

    it('GATE_LEVEL_MEANINGS', () => {
      expect({ ...GATE_LEVEL_MEANINGS }, `GATE_LEVEL_MEANINGS changed. ${UPDATE_BOTH}`).toEqual({
        full: 'the most checking; any value that is not a level also reads as full',
        standard: 'the default when no level is set',
        lean: 'the least checking',
      });
    });
  });

  it('both tables hold exactly the levels the registry lists', () => {
    expect(sorted(Object.keys(GATE_LEVEL_HINTS))).toEqual(sorted(GATE_LEVELS));
    expect(sorted(Object.keys(GATE_LEVEL_MEANINGS))).toEqual(sorted(GATE_LEVELS));
    for (const level of GATE_LEVELS) {
      expect(GATE_LEVEL_HINTS[level].length, `hint for ${level}`).toBeGreaterThan(0);
      expect(GATE_LEVEL_MEANINGS[level].length, `meaning for ${level}`).toBeGreaterThan(0);
    }
  });

  it('both name the one level a malformed value reads as, and no other', () => {
    const meaningsThatFold = GATE_LEVELS.filter(level => GATE_LEVEL_MEANINGS[level].includes('reads as'));
    expect(meaningsThatFold).toEqual([MALFORMED_GATE_LEVEL_READS_AS]);
    expect(GATE_LEVEL_MEANINGS[MALFORMED_GATE_LEVEL_READS_AS]).toContain(`reads as ${MALFORMED_GATE_LEVEL_READS_AS}`);
    expect(describeGateLevel('Lean')).toContain(`reads as ${MALFORMED_GATE_LEVEL_READS_AS}`);
    expect(gateLevelPromptSeed('Lean')).toBe(MALFORMED_GATE_LEVEL_READS_AS);
  });

  it('init words a malformed value exactly as the Machine line of devflow gates does', () => {
    const { lines } = renderGateStatus({
      kind: 'resolved',
      manifest: 'readable',
      manifestPath: '/home/user/.devflow/manifest.json',
      level: MALFORMED_GATE_LEVEL_READS_AS,
      source: 'machine',
      invalid: true,
      machine: 'invalid',
      trackedWarning: null,
    });
    expect(lines).toContain(`Machine:   ${describeGateLevel('Lean')}`);
  });

  it('both state the same lint-pack effect, for the same level', () => {
    const lintLevels = GATE_LEVELS.filter(level => GATE_LEVEL_HINTS[level].includes('lint pack'));
    expect(lintLevels).toHaveLength(1);
    expect(GATE_LEVEL_EFFECT).toMatch(new RegExp(`At ${lintLevels[0]}, .*lint pack`));
  });

  it('both say fewer review focuses for the same levels', () => {
    const [strictest] = GATE_LEVELS;
    const fewerInHints = GATE_LEVELS.filter(level => GATE_LEVEL_HINTS[level].includes('fewer review focuses'));
    const clause = /read the level: (.+?) run fewer review focuses/.exec(GATE_LEVEL_EFFECT)?.[1] ?? '';
    expect(clause, 'GATE_LEVEL_EFFECT names the levels that run fewer review focuses').not.toBe('');
    expect(fewerInHints.length).toBeGreaterThan(0);
    for (const level of fewerInHints) expect(clause, `the effect text names ${level}`).toContain(level);
    expect(clause).not.toContain(strictest);
    expect(GATE_LEVEL_HINTS[strictest]).not.toContain('fewer');
  });

  it('both say the same levels run no Polish, and the strictest level keeps it', () => {
    const [strictest] = GATE_LEVELS;
    const noPolishInHints = GATE_LEVELS.filter(level => GATE_LEVEL_HINTS[level].includes('no Polish'));
    const clause = /; at (.+?) they skip Polish/.exec(GATE_LEVEL_EFFECT)?.[1] ?? '';
    expect(clause, 'GATE_LEVEL_EFFECT names the levels that skip Polish').not.toBe('');
    const namedInEffect = GATE_LEVELS.filter(level => clause.includes(level));
    expect(noPolishInHints.length).toBeGreaterThan(0);
    expect(sorted(namedInEffect), 'the levels GATE_LEVEL_EFFECT says skip Polish').toEqual(sorted(noPolishInHints));
    expect(noPolishInHints).not.toContain(strictest);
    expect(GATE_LEVEL_EFFECT).toContain(`${strictest} keeps it`);
    expect(GATE_LEVEL_HINTS[strictest]).toContain('Polish');
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

  it('assigns the gate decision in exactly three places: its start, and the step outcome on each path', async () => {
    const source = await fs.readFile(INIT_SOURCE, 'utf-8');
    expect((source.match(/\blet gateDecision\b/g) ?? []).length).toBe(1);
    expect((source.match(/\blet gateDecision: GateLevelDecision = \{ level: carriedGate\.value, carried: true \};/g) ?? []).length).toBe(1);
    expect((source.match(/\bgateDecision = /g) ?? []).length).toBe(2);
    expect((source.match(/gateDecision = await runGateLevelStepAt\('recommended'\)/g) ?? []).length).toBe(1);
    expect((source.match(/gateDecision = await runGateLevelStepAt\('advanced'\)/g) ?? []).length).toBe(1);
    expect(source).not.toMatch(/const runGateLevelStepAt = async \([^)]*\): Promise<void>/);
  });

  it('starts the gate level from the one shared decision, over the seed and the stored reading', async () => {
    const source = await fs.readFile(INIT_SOURCE, 'utf-8');
    const call = /const carriedGate = carriedGateLevel\(\{[\s\S]*?\}\);/.exec(source);
    expect(call, 'the carriedGateLevel call is not findable in init.ts').not.toBeNull();
    const lines = (call?.[0] ?? '').split('\n').map(line => line.trim());
    expect(lines).toContain('manifest: existingManifest,');
    expect(lines).toContain('reset: !!options.reset,');
    expect(lines).toContain('stored: storedGate,');
    expect(lines).toContain('seedLevel: seed.features.gateLevel,');
  });

  it('forwards the caller\'s mode and modePromptShown, never a literal', async () => {
    const lines = gateCall(await fs.readFile(INIT_SOURCE, 'utf-8')).split('\n').map(line => line.trim());
    expect(lines).toContain('mode,');
    expect(lines).toContain('modePromptShown,');
  });

  it('forwards the carried level and where it was found to the prompt', async () => {
    const lines = gateCall(await fs.readFile(INIT_SOURCE, 'utf-8')).split('\n').map(line => line.trim());
    expect(lines).toContain('stored: gateDecision.level,');
    expect(lines).toContain('storedOrigin: carriedGate.origin,');
  });

  it('tells the summary the stored level was kept only when it is the carried level of a refused manifest', async () => {
    const source = await fs.readFile(INIT_SOURCE, 'utf-8');
    const call = /logSummaryLines\(formatGateLevelSummary\(\{\s*level: gateDecision\.level,[\s\S]*?\}\)\);/.exec(source);
    expect(call, 'the init summary call is not findable in init.ts').not.toBeNull();
    const lines = (call?.[0] ?? '').split('\n').map(line => line.trim());
    expect(lines).toContain("kept: gateDecision.carried && carriedGate.origin === 'rejected',");
  });
});

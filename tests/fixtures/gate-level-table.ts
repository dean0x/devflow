/**
 * tests/fixtures/gate-level-table.ts
 *
 * THE shared fixture table for the gate level (`GATE_LEVEL=` on the settings
 * line). Each row is the exact bytes of a worktree's personal
 * `.devflow/config.json` (or null for "no file"), a parsed machine manifest
 * (undefined for "no manifest"), and the four gate fields every fold must reach:
 *
 *   gateLevel         the level that applies
 *   gateLevelSource   the layer that decided it: personal, machine or default
 *   gateLevelInvalid  the deciding layer holds a malformed level
 *   gateLevelMachine  the machine layer's own reading, whoever decided: a level,
 *                     'invalid' for a present malformed value, null for none
 *
 * The order is the rule under test: a valid personal value wins; a malformed
 * personal value is `full` and never falls through to the machine value; else a
 * valid machine value; a malformed machine value is `full`; else `standard`.
 *
 * Rows are data, never code. Consumers:
 *   - resolve-settings.cjs foldSettings and the real script — settings-mode.test.ts
 *   - src/core/gate-level.ts machineGateLevel — the `gateLevelMachine` column
 */

export type GateLevelWord = 'full' | 'standard' | 'lean';

export interface GateRow {
  readonly name: string;
  /** The parsed ~/.devflow/manifest.json, or undefined for "no manifest". */
  readonly manifest: unknown;
  /** The exact bytes of .devflow/config.json, or null for "no file". */
  readonly personal: string | null;
  readonly expect: {
    readonly gateLevel: GateLevelWord;
    readonly gateLevelSource: 'personal' | 'machine' | 'default';
    readonly gateLevelInvalid: boolean;
    readonly gateLevelMachine: GateLevelWord | 'invalid' | null;
  };
}

const MACHINE = (gateLevel: unknown): unknown => ({ features: { gateLevel } });
const PERSONAL = (gateLevel: string): string => `{"gateLevel":${gateLevel}}`;

const DEFAULT = { gateLevel: 'standard', gateLevelSource: 'default', gateLevelInvalid: false, gateLevelMachine: null } as const;
const personalWins = (gateLevel: GateLevelWord, machine: GateLevelWord | 'invalid' | null) =>
  ({ gateLevel, gateLevelSource: 'personal', gateLevelInvalid: false, gateLevelMachine: machine }) as const;
const personalBad = (machine: GateLevelWord | 'invalid' | null) =>
  ({ gateLevel: 'full', gateLevelSource: 'personal', gateLevelInvalid: true, gateLevelMachine: machine }) as const;
const machineWins = (gateLevel: GateLevelWord) =>
  ({ gateLevel, gateLevelSource: 'machine', gateLevelInvalid: false, gateLevelMachine: gateLevel }) as const;
const machineBad = { gateLevel: 'full', gateLevelSource: 'machine', gateLevelInvalid: true, gateLevelMachine: 'invalid' } as const;

/** Malformed personal values, as the JSON text that follows `"gateLevel":`. */
export const MALFORMED_PERSONAL_VALUES: ReadonlyArray<readonly [string, string]> = [
  ['a capitalised level', '"Lean"'],
  ['a trailing space', '"lean "'],
  ['a leading space', '" lean"'],
  ['an empty string', '""'],
  ['null', 'null'],
  ['a number', '1'],
  ['a boolean', 'true'],
  ['an array holding a level', '["lean"]'],
  ['an object', '{"level":"lean"}'],
  ['an unknown word', '"minimal"'],
];

/** Malformed machine values, as the JSON value of `features.gateLevel`. */
export const MALFORMED_MACHINE_VALUES: ReadonlyArray<readonly [string, unknown]> = [
  ['a capitalised level', 'Lean'],
  ['a number', 5],
  ['null', null],
  ['a boolean', true],
  ['an empty string', ''],
  ['an object', { level: 'lean' }],
  ['an array', ['lean']],
];

export const GATE_LEVEL_TABLE: readonly GateRow[] = [
  // AC-1: nothing records a level.
  { name: 'no personal file and no manifest', manifest: undefined, personal: null, expect: DEFAULT },
  { name: 'a manifest without the key', manifest: { features: {} }, personal: null, expect: DEFAULT },
  { name: 'a personal file without the key', manifest: undefined, personal: '{}', expect: DEFAULT },

  // AC-3: personal over machine, in both directions.
  { name: 'personal full over machine lean', manifest: MACHINE('lean'), personal: PERSONAL('"full"'), expect: personalWins('full', 'lean') },
  { name: 'personal lean over machine full', manifest: MACHINE('full'), personal: PERSONAL('"lean"'), expect: personalWins('lean', 'full') },
  { name: 'personal standard over machine lean', manifest: MACHINE('lean'), personal: PERSONAL('"standard"'), expect: personalWins('standard', 'lean') },
  { name: 'personal lean with no manifest', manifest: undefined, personal: PERSONAL('"lean"'), expect: personalWins('lean', null) },
  { name: 'machine lean with no personal key', manifest: MACHINE('lean'), personal: null, expect: machineWins('lean') },
  { name: 'machine full with an empty personal file', manifest: MACHINE('full'), personal: '{}', expect: machineWins('full') },
  { name: 'machine standard, recorded', manifest: MACHINE('standard'), personal: null, expect: machineWins('standard') },

  // AC-5: a malformed personal value is full, never the machine value or standard.
  ...MALFORMED_PERSONAL_VALUES.flatMap(([label, value]): GateRow[] => [
    { name: `malformed personal (${label}) over machine lean`, manifest: MACHINE('lean'), personal: PERSONAL(value), expect: personalBad('lean') },
    { name: `malformed personal (${label}) with no manifest`, manifest: undefined, personal: PERSONAL(value), expect: personalBad(null) },
  ]),
  {
    name: 'malformed personal (a duplicated key) over machine lean',
    manifest: MACHINE('lean'),
    personal: '{"gateLevel":"lean","gateLevel":"lean"}',
    expect: personalBad('lean'),
  },

  // AC-7: the machine layer alone.
  { name: 'a manifest that is null', manifest: null, personal: null, expect: DEFAULT },
  { name: 'a manifest that is an array', manifest: [], personal: null, expect: DEFAULT },
  { name: 'features that is a string', manifest: { features: 'lean' }, personal: null, expect: DEFAULT },
  { name: 'features that is an array', manifest: { features: [] }, personal: null, expect: DEFAULT },
  ...MALFORMED_MACHINE_VALUES.map(([label, value]): GateRow => (
    { name: `malformed machine (${label}), no personal key`, manifest: MACHINE(value), personal: null, expect: machineBad }
  )),

  // The machine invalid marker shows whichever layer decided.
  { name: 'valid personal over a malformed machine value', manifest: MACHINE('Lean'), personal: PERSONAL('"lean"'), expect: personalWins('lean', 'invalid') },
  { name: 'malformed personal over a malformed machine value', manifest: MACHINE('Lean'), personal: PERSONAL('"Lean"'), expect: personalBad('invalid') },
];

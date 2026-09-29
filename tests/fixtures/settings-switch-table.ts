/**
 * tests/fixtures/settings-switch-table.ts
 *
 * THE shared fixture table for the narrow-only feature switches
 * (D-FEATURES-NARROW-ONLY, src/core/feature-switch.ts). Each row is a machine
 * manifest plus the raw bytes of a worktree's `.devflow/project.json` and
 * `.devflow/config.json`, and the memory/learning/knowledge result every
 * implementation of the rule must reach:
 *
 *   - resolve-settings.cjs resolveSettings — tests/evidence-policy/settings-mode.test.ts
 *   - the shell gates (queue_read_gates fast path) — added with the hook work;
 *     knowledge has no shell gate, so a shell runner reads memory and learning only
 *
 * A switch is on iff the machine switch is on AND neither file's
 * `features.<name>` is the literal `false`. Only a literal `false` narrows; the
 * retired top-level keys (`memory`, `learning`, `knowledge`, `decisions`) never
 * do, in either file (TP-49).
 *
 * Rows are data, never code: `project`/`personal` are the exact file bytes, or
 * null for "no file".
 */

export interface SwitchRow {
  readonly name: string;
  /** The parsed ~/.devflow/manifest.json, or undefined for "no manifest". */
  readonly manifest: unknown;
  readonly project: string | null;
  readonly personal: string | null;
  readonly expect: { readonly memory: boolean; readonly learning: boolean; readonly knowledge: boolean };
}

const ALL_ON = { memory: true, learning: true, knowledge: true } as const;

/** A manifest with every switch on, as `devflow init` writes it. */
export const MANIFEST_ON = { version: '2.5.0', features: { memory: true, learning: true, knowledge: true } };

export const SETTINGS_SWITCH_TABLE: readonly SwitchRow[] = [
  { name: 'no files, no manifest', manifest: undefined, project: null, personal: null, expect: ALL_ON },
  { name: 'no files', manifest: MANIFEST_ON, project: null, personal: null, expect: ALL_ON },
  {
    name: 'machine off wins over everything',
    manifest: { features: { memory: false, learning: false, knowledge: false } },
    project: '{"features":{"memory":true,"learning":true,"knowledge":true}}',
    personal: '{"features":{"memory":true,"learning":true,"knowledge":true}}',
    expect: { memory: false, learning: false, knowledge: false },
  },
  {
    name: 'project narrows learning',
    manifest: MANIFEST_ON,
    project: '{"version":1,"features":{"learning":false}}',
    personal: null,
    expect: { memory: true, learning: false, knowledge: true },
  },
  {
    name: 'personal narrows memory',
    manifest: MANIFEST_ON,
    project: null,
    personal: '{"reviewPublication":"auto","features":{"memory":false}}',
    expect: { memory: false, learning: true, knowledge: true },
  },
  {
    name: 'project and personal narrow different switches',
    manifest: MANIFEST_ON,
    project: '{"features":{"knowledge":false}}',
    personal: '{"features":{"learning":false}}',
    expect: { memory: true, learning: false, knowledge: false },
  },
  {
    name: 'a literal true never widens a machine off',
    manifest: { features: { learning: false } },
    project: '{"features":{"learning":true}}',
    personal: null,
    expect: { memory: true, learning: false, knowledge: true },
  },
  {
    name: 'a string "false" is not a literal false',
    manifest: MANIFEST_ON,
    project: '{"features":{"memory":"false","learning":0,"knowledge":null}}',
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'legacy top-level keys in project.json are ignored',
    manifest: MANIFEST_ON,
    project: '{"memory":false,"learning":false,"knowledge":false,"decisions":false}',
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'legacy top-level keys in config.json are ignored',
    manifest: MANIFEST_ON,
    project: null,
    personal: '{"reviewPublication":"auto","memory":false,"learning":false,"decisions":false}',
    expect: ALL_ON,
  },
  {
    name: 'a "false" inside an unrelated string narrows nothing',
    manifest: MANIFEST_ON,
    project: '{"note":"features.learning:false","features":{}}',
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'features that is not an object narrows nothing',
    manifest: MANIFEST_ON,
    project: '{"features":false}',
    personal: '{"features":[false]}',
    expect: ALL_ON,
  },
  {
    name: 'an unparseable project.json narrows nothing',
    manifest: MANIFEST_ON,
    project: '{"features":{"learning":false}',
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'the machine legacy decisions:false switches learning off',
    manifest: { features: { decisions: false } },
    project: null,
    personal: null,
    expect: { memory: true, learning: false, knowledge: true },
  },
  {
    name: 'whitespace inside the literal false still narrows',
    manifest: MANIFEST_ON,
    project: '{ "features" : { "memory" :\n false } }',
    personal: null,
    expect: { memory: false, learning: true, knowledge: true },
  },
];

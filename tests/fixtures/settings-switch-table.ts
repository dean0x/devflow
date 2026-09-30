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
 *   - the shell gates (queue_read_gates and its per-file fast path) —
 *     tests/queue-append.test.ts; knowledge has no shell gate, so that runner
 *     reads memory and learning only
 *
 * A switch is on iff the machine switch is on AND neither file's
 * `features.<name>` is the literal `false`. Only a literal `false` narrows; the
 * retired top-level keys (`memory`, `learning`, `knowledge`, `decisions`) never
 * do, in either file (TP-49).
 *
 * Rows are data, never code: `project`/`personal` are the exact file bytes, or
 * null for "no file". The rows after the first block probe the shell fast path's
 * edges — its bounded read (4096 bytes, a NUL), its text match (escapes, nesting,
 * key order) and the parser rules it defers to (BOM, duplicates) — so the shell
 * and the resolver are held to the same answer on each.
 *
 * A row marked `unreadable` holds a file that EXISTS but is not a JSON object
 * within the parser's byte rules (unparseable, not an object, a BOM, a NUL, over
 * 4096 bytes), and names the first such layer. Such a file narrows nothing, so
 * `expect` is what the fold — and so every hook gate — reaches. resolveSettings
 * itself goes further: an unreadable file fails every field closed except the
 * compliance lens, which stays the union of every readable layer — the machine's,
 * the default branch's and a readable project.json's (D-SETTINGS-LINE whole-file
 * rule, D-LENS-UNION) — so settings-mode.test.ts holds those rows to the
 * fail-closed switches instead.
 */

/** A project.json of exactly `bytes` UTF-8 bytes that narrows memory when parsed. */
function paddedTo(bytes: number, filler = 'x'): string {
  const head = '{"features":{"memory":false},"pad":"';
  const tail = '"}';
  const fillerBytes = Buffer.byteLength(filler, 'utf8');
  const room = bytes - Buffer.byteLength(head + tail, 'utf8');
  const text = head + filler.repeat(Math.floor(room / fillerBytes)) + 'x'.repeat(room % fillerBytes) + tail;
  if (Buffer.byteLength(text, 'utf8') !== bytes) throw new Error(`paddedTo(${bytes}) produced the wrong size`);
  return text;
}

export interface SwitchRow {
  readonly name: string;
  /** The parsed ~/.devflow/manifest.json, or undefined for "no manifest". */
  readonly manifest: unknown;
  readonly project: string | null;
  readonly personal: string | null;
  readonly expect: { readonly memory: boolean; readonly learning: boolean; readonly knowledge: boolean };
  /** The first repository layer whose file exists but cannot be read as a JSON object. */
  readonly unreadable?: 'project' | 'personal';
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
    unreadable: 'project',
  },
  {
    name: 'an unparseable config.json narrows nothing',
    manifest: MANIFEST_ON,
    project: null,
    personal: '{"features":{"memory":false,"learning":false}',
    expect: ALL_ON,
    unreadable: 'personal',
  },
  {
    name: 'a project.json that is a JSON array narrows nothing',
    manifest: MANIFEST_ON,
    project: '[{"features":{"memory":false,"learning":false}}]',
    personal: null,
    expect: ALL_ON,
    unreadable: 'project',
  },
  {
    name: 'an unparseable project.json leaves the machine switch deciding',
    manifest: { features: { memory: false, learning: true, knowledge: true } },
    project: '{"features":{"learning":false}',
    personal: null,
    expect: { memory: false, learning: true, knowledge: true },
    unreadable: 'project',
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
  {
    name: 'a \\u-escaped features key and switch still narrow',
    manifest: MANIFEST_ON,
    project: '{"f\\u0065atures":{"le\\u0061rning":false}}',
    personal: null,
    expect: { memory: true, learning: false, knowledge: true },
  },
  {
    name: 'a nested object before the switch still narrows',
    manifest: MANIFEST_ON,
    project: '{"features":{"future":{"a":{"b":1}},"memory":false}}',
    personal: null,
    expect: { memory: false, learning: true, knowledge: true },
  },
  {
    name: 'features.decisions in a repository file narrows nothing',
    manifest: MANIFEST_ON,
    project: '{"features":{"decisions":false}}',
    personal: '{"features":{"decisions":false}}',
    expect: ALL_ON,
  },
  {
    name: 'a duplicated features.learning narrows nothing',
    manifest: MANIFEST_ON,
    project: '{"features":{"learning":false,"learning":false}}',
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'a legacy top-level key after features narrows nothing',
    manifest: MANIFEST_ON,
    project: '{"features":{"knowledge":true},"learning":false,"memory":false}',
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'a byte-order mark makes the file invalid',
    manifest: MANIFEST_ON,
    project: '\uFEFF{"features":{"memory":false}}',
    personal: null,
    expect: ALL_ON,
    unreadable: 'project',
  },
  {
    name: 'a NUL byte makes the file invalid',
    manifest: MANIFEST_ON,
    project: '{"features":{"memory":false}}\u0000',
    personal: '{"features":{"learning":\u0000false}}',
    expect: ALL_ON,
    unreadable: 'project',
  },
  {
    name: 'a file of exactly 4096 bytes still narrows',
    manifest: MANIFEST_ON,
    project: paddedTo(4096),
    personal: null,
    expect: { memory: false, learning: true, knowledge: true },
  },
  {
    name: 'a file of 4097 bytes narrows nothing',
    manifest: MANIFEST_ON,
    project: paddedTo(4097),
    personal: null,
    expect: ALL_ON,
    unreadable: 'project',
  },
  {
    name: 'multi-byte text past 4096 bytes narrows nothing',
    manifest: MANIFEST_ON,
    project: paddedTo(4098, '\u00e9'),
    personal: null,
    expect: ALL_ON,
    unreadable: 'project',
  },
  {
    name: 'machine, project and personal each switch one thing off',
    manifest: { features: { memory: true, learning: true, knowledge: false } },
    project: '{"features":{"memory":false}}',
    personal: '{"features":{"learning":false}}',
    expect: { memory: false, learning: false, knowledge: false },
  },
];

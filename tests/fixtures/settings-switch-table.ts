/**
 * tests/fixtures/settings-switch-table.ts
 *
 * THE shared fixture table for the narrow-only feature switches
 * (D-FEATURES-NARROW-ONLY, src/core/feature-switch.ts). Each row is a machine
 * manifest plus the raw bytes of a worktree's `.devflow/project.json` and
 * `.devflow/config.json`, and the memory/curation/knowledge result every
 * implementation of the rule must reach:
 *
 *   - resolve-settings.cjs resolveSettings — tests/evidence-policy/settings-mode.test.ts
 *   - the shell gates (queue_read_gates and its per-file fast path) —
 *     tests/queue-append.test.ts; knowledge has no shell gate, so that runner
 *     reads memory and curation only
 *
 * A switch is on iff the machine switch is on AND neither file's
 * `features.<name>` is the literal `false`. Only a literal `false` narrows; the
 * retired top-level keys (`memory`, `learning`, `knowledge`, `decisions`) never
 * do, in either file (TP-49).
 *
 * The `curation` column is read under TWO current keys, `curation` and its
 * pre-rename copy `learning` (#529):
 *
 *   - machine: off when either current key is a boolean false; on when either is
 *     a boolean true and neither is false; when neither is a boolean, the
 *     pre-rename `decisions` key decides if it is a boolean; otherwise on. A
 *     disagreeing pair therefore resolves to off.
 *   - repository files: a narrow-only union. A literal false in either key
 *     turns the switch off, a non-boolean value is ignored for that key only,
 *     each key is parsed on its own (so the duplicate-key rule applies per key),
 *     and `features.decisions` stays inert.
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
  readonly expect: { readonly memory: boolean; readonly curation: boolean; readonly knowledge: boolean };
  /** The first repository layer whose file exists but cannot be read as a JSON object. */
  readonly unreadable?: 'project' | 'personal';
}

const ALL_ON = { memory: true, curation: true, knowledge: true } as const;
const CURATION_OFF = { memory: true, curation: false, knowledge: true } as const;

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
    expect: { memory: false, curation: false, knowledge: false },
  },
  {
    name: 'project narrows curation through the legacy learning key',
    manifest: MANIFEST_ON,
    project: '{"version":1,"features":{"learning":false}}',
    personal: null,
    expect: { memory: true, curation: false, knowledge: true },
  },
  {
    name: 'personal narrows memory',
    manifest: MANIFEST_ON,
    project: null,
    personal: '{"reviewPublication":"auto","features":{"memory":false}}',
    expect: { memory: false, curation: true, knowledge: true },
  },
  {
    name: 'project and personal narrow different switches',
    manifest: MANIFEST_ON,
    project: '{"features":{"knowledge":false}}',
    personal: '{"features":{"learning":false}}',
    expect: { memory: true, curation: false, knowledge: false },
  },
  {
    name: 'a literal true never widens a machine off',
    manifest: { features: { learning: false } },
    project: '{"features":{"learning":true}}',
    personal: null,
    expect: { memory: true, curation: false, knowledge: true },
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
    expect: { memory: false, curation: true, knowledge: true },
    unreadable: 'project',
  },
  {
    name: 'the machine legacy decisions:false switches curation off',
    manifest: { features: { decisions: false } },
    project: null,
    personal: null,
    expect: { memory: true, curation: false, knowledge: true },
  },
  {
    name: 'whitespace inside the literal false still narrows',
    manifest: MANIFEST_ON,
    project: '{ "features" : { "memory" :\n false } }',
    personal: null,
    expect: { memory: false, curation: true, knowledge: true },
  },
  {
    name: 'a \\u-escaped features key and switch still narrow',
    manifest: MANIFEST_ON,
    project: '{"f\\u0065atures":{"le\\u0061rning":false}}',
    personal: null,
    expect: { memory: true, curation: false, knowledge: true },
  },
  {
    name: 'a nested object before the switch still narrows',
    manifest: MANIFEST_ON,
    project: '{"features":{"future":{"a":{"b":1}},"memory":false}}',
    personal: null,
    expect: { memory: false, curation: true, knowledge: true },
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
    expect: { memory: false, curation: true, knowledge: true },
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
    expect: { memory: false, curation: false, knowledge: false },
  },

  // ── The curation switch under its two current keys, curation and learning (#529) ──
  // Machine layer (the manifest).
  {
    name: 'machine curation:false alone switches curation off',
    manifest: { features: { curation: false } },
    project: null,
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'machine curation:true alone leaves curation on',
    manifest: { features: { curation: true } },
    project: null,
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'machine pair curation:true learning:false resolves off',
    manifest: { features: { curation: true, learning: false } },
    project: null,
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'machine pair curation:false learning:true resolves off',
    manifest: { features: { curation: false, learning: true } },
    project: null,
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'machine pair curation:false learning:false is off',
    manifest: { features: { curation: false, learning: false } },
    project: null,
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'machine pair curation:true learning:true is on',
    manifest: { features: { curation: true, learning: true } },
    project: null,
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'machine curation:true beats the pre-rename decisions:false',
    manifest: { features: { curation: true, decisions: false } },
    project: null,
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'machine learning:true beats the pre-rename decisions:false',
    manifest: { features: { learning: true, decisions: false } },
    project: null,
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'machine non-boolean curation is ignored, learning:false decides',
    manifest: { features: { curation: 'true', learning: false } },
    project: null,
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'machine non-boolean current keys let the pre-rename decisions:false decide',
    manifest: { features: { curation: 'x', learning: 0, decisions: false } },
    project: null,
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'machine non-boolean curation alone is ignored: the switch stays on',
    manifest: { features: { curation: 'false' } },
    project: null,
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'machine curation:false does not touch memory or knowledge',
    manifest: { features: { memory: true, curation: false, knowledge: true } },
    project: null,
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'a literal true in either repository key never widens a machine curation:false',
    manifest: { features: { curation: false } },
    project: '{"features":{"curation":true,"learning":true}}',
    personal: '{"features":{"curation":true}}',
    expect: CURATION_OFF,
  },
  // Repository layer (project.json and config.json).
  {
    name: 'project curation:false narrows curation',
    manifest: MANIFEST_ON,
    project: '{"version":1,"features":{"curation":false}}',
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'personal curation:false narrows curation',
    manifest: MANIFEST_ON,
    project: null,
    personal: '{"reviewPublication":"auto","features":{"curation":false}}',
    expect: CURATION_OFF,
  },
  {
    name: 'project curation:true with learning:false narrows curation',
    manifest: MANIFEST_ON,
    project: '{"features":{"curation":true,"learning":false}}',
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'project curation:false with learning:true narrows curation',
    manifest: MANIFEST_ON,
    project: '{"features":{"curation":false,"learning":true}}',
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'project curation:true and learning:true narrow nothing',
    manifest: MANIFEST_ON,
    project: '{"features":{"curation":true,"learning":true}}',
    personal: '{"features":{"curation":true,"learning":true}}',
    expect: ALL_ON,
  },
  {
    name: 'project and personal narrow through different keys',
    manifest: MANIFEST_ON,
    project: '{"features":{"curation":false}}',
    personal: '{"features":{"memory":false}}',
    expect: { memory: false, curation: false, knowledge: true },
  },
  {
    name: 'a non-boolean curation is ignored for that key only: learning:false still narrows',
    manifest: MANIFEST_ON,
    project: '{"features":{"curation":"false","learning":false}}',
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'a non-boolean curation alone narrows nothing',
    manifest: MANIFEST_ON,
    project: '{"features":{"curation":"false"}}',
    personal: '{"features":{"curation":0}}',
    expect: ALL_ON,
  },
  {
    name: 'a duplicated features.curation narrows nothing',
    manifest: MANIFEST_ON,
    project: '{"features":{"curation":false,"curation":false}}',
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'a duplicated curation does not hide a learning:false',
    manifest: MANIFEST_ON,
    project: '{"features":{"curation":true,"curation":true,"learning":false}}',
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'a duplicated learning does not hide a curation:false',
    manifest: MANIFEST_ON,
    project: '{"features":{"learning":false,"learning":false,"curation":false}}',
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'a \\u-escaped curation key still narrows',
    manifest: MANIFEST_ON,
    project: '{"f\\u0065atures":{"cur\\u0061tion":false}}',
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'a \\u-escaped learning key beside curation:true still narrows',
    manifest: MANIFEST_ON,
    project: '{"features":{"curation":true,"le\\u0061rning":false}}',
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'a \\u-escaped learning key beside curation:true in config.json still narrows',
    manifest: MANIFEST_ON,
    project: null,
    personal: '{"features":{"curation":true,"le\\u0061rning":false}}',
    expect: CURATION_OFF,
  },
  {
    name: 'a top-level curation key narrows nothing, in either file',
    manifest: MANIFEST_ON,
    project: '{"curation":false}',
    personal: '{"curation":false}',
    expect: ALL_ON,
  },
  {
    name: 'features.decisions beside features.curation stays inert',
    manifest: MANIFEST_ON,
    project: '{"features":{"curation":true,"decisions":false}}',
    personal: '{"features":{"decisions":false,"curation":true}}',
    expect: ALL_ON,
  },
  {
    name: 'whitespace and newlines around curation:false still narrow',
    manifest: MANIFEST_ON,
    project: '{ "features" : { "curation" :\n false , "learning" : true } }',
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'a nested object before curation:false still narrows',
    manifest: MANIFEST_ON,
    project: '{"features":{"future":{"a":{"b":1}},"curation":false}}',
    personal: null,
    expect: CURATION_OFF,
  },
  {
    name: 'a "false" inside an unrelated curation string narrows nothing',
    manifest: MANIFEST_ON,
    project: '{"note":"features.curation:false","features":{}}',
    personal: null,
    expect: ALL_ON,
  },
  {
    name: 'an unparseable project.json with curation:false narrows nothing',
    manifest: MANIFEST_ON,
    project: '{"features":{"curation":false}',
    personal: null,
    expect: ALL_ON,
    unreadable: 'project',
  },
  {
    name: 'an unparseable config.json with curation:false leaves the machine switch deciding',
    manifest: { features: { curation: true, learning: true, memory: false } },
    project: null,
    personal: '{"features":{"curation":false}',
    expect: { memory: false, curation: true, knowledge: true },
    unreadable: 'personal',
  },
  {
    name: 'machine curation:false, project learning:false and personal memory:false each switch one thing off',
    manifest: { features: { memory: true, curation: false, knowledge: true } },
    project: '{"features":{"learning":false}}',
    personal: '{"features":{"memory":false}}',
    expect: { memory: false, curation: false, knowledge: true },
  },
];

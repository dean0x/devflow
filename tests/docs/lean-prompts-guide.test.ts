/**
 * Docs guard for the lean-prompts guide (docs/reference/lean-prompts.md).
 *
 * The guide tells a person how to cut a workflow prompt. A cut that loses a rule is the failure
 * it exists to stop, so its own shape is pinned here:
 *
 *   - It has every part: where the tokens go, the rules for every target, the cut rules, the
 *     never-cut table, the core global rules, the architecture part, the cut record rule and the
 *     Turns section.
 *   - The token part names the four loads and the choice of targets by spend, and links the
 *     target inventory. The rules for every target hold the size measure, the rule for new
 *     structure, the model rule and the process rule.
 *   - The Turns section holds the four actions and no general efficiency line.
 *   - The never-cut table has the columns item, location and guard probe, and numbered rows. The
 *     rows include Principle 1 (orchestration only) and the Error Handling rule.
 *   - Each core global rule carries a mark, and Principle 1 and Error Handling are never-cut.
 *   - The architecture part names the one core file, the rare-branch rule and the skill folders.
 *   - The target inventory has its measure method, the always-loaded text, a ranked list of at
 *     least fifteen targets and the target groups.
 *   - The cut record rule names the bytes before and after, the importing hosts, and the stop
 *     for a cut below half of the before size.
 *   - The guide links to the live-check results, and those results sit in platform-assumptions.md
 *     with a date stamp and a drift symptom on every row, the compaction re-attach facts and the
 *     open risk of a resumed process included.
 *   - The new text names no local path, no ticket number, no ledger identifier and no workspace
 *     role, because the repository is public.
 *
 * Every collector is shown to fail on seeded known-bad input, so a guard that stops seeing its
 * subject fails instead of passing vacuously.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const GUIDE = read('docs/reference/lean-prompts.md');
const ASSUMPTIONS = read('docs/reference/platform-assumptions.md');
const TARGETS = read('docs/reference/lean-prompts-targets.md');

const TOKENS_SECTION = 'What to cut and where the tokens go';
const TARGET_RULES_SECTION = 'Rules for every target';

const REQUIRED_SECTIONS = [
  TOKENS_SECTION,
  TARGET_RULES_SECTION,
  'Cut rules',
  'Never-cut table',
  'Core global rules',
  'Architecture',
  'Cut record',
  'Turns',
] as const;

const ARCHITECTURE_PARTS = ['One core file', 'Rare branches', 'Skill folders'] as const;

const TARGET_SECTIONS = ['How the numbers were measured', 'Always-loaded text', 'Ranked targets', 'Target groups'] as const;
const MIN_RANKED_TARGETS = 15;

const TURN_ACTIONS = [
  'Batch independent tool calls in one turn.',
  'Read a reference only on its branch.',
  'Do not read back a file after a confirmed write.',
  'Do not send a turn that only narrates.',
] as const;

const NEVER_CUT_HEADER = ['No.', 'Item', 'Location', 'Guard probe'] as const;
const CORE_RULES_HEADER = ['No.', 'Rule', 'Never-cut', 'Reason'] as const;
const LIVE_CHECK_HEADER = [
  'Probe',
  'Assumption and result',
  'Date verified',
  'Observable symptom if it drifts',
  'Rule it sets',
] as const;
const LIVE_CHECK_HEADING = 'Skill folders and compaction re-attach';

/** The rows of each table when it was written. A deleted row lowers the count and fails the guard. */
const MIN_NEVER_CUT_ROWS = 18;
const MIN_CORE_RULES = 5;

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────────

/** The headings of one level, in order. */
function headingsOf(text: string, level: number): string[] {
  const prefix = `${'#'.repeat(level)} `;
  return text
    .split('\n')
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length).trim());
}

/** The lines under a level-2 heading, up to the next level-2 heading. Undefined when the heading is absent. */
function sectionBody(text: string, heading: string): string | undefined {
  const lines = text.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

interface Table {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly shapeDefects: readonly string[];
}

const cellsOf = (line: string): string[] => line.split('|').slice(1, -1).map(cell => cell.trim());

/** The first Markdown table of a text: its header cells, its rows, and the defects of its shape. */
function parseTable(body: string): Table | undefined {
  const lines = body.split('\n').filter(line => line.startsWith('|'));
  if (lines.length < 2) return undefined;
  const [headerLine = '', separatorLine = '', ...rowLines] = lines;
  const header = cellsOf(headerLine);
  const shapeDefects: string[] = [];
  if (!/^\|(?:\s*:?-+:?\s*\|)+$/.test(separatorLine)) shapeDefects.push('the second table line is not a separator');
  const rows = rowLines.map(cellsOf);
  rows.forEach((row, index) => {
    if (row.length !== header.length) shapeDefects.push(`row ${index + 1} holds ${row.length} cells, expected ${header.length}`);
    row.forEach((cell, column) => {
      if (cell === '') shapeDefects.push(`row ${index + 1}, column ${header[column] ?? column + 1} is empty`);
    });
  });
  return { header, rows, shapeDefects };
}

/** The anchor that GitHub makes from a heading. */
const anchorOf = (heading: string): string =>
  heading.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');

function sameCells(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((cell, index) => cell === expected[index]);
}

/** Defects of the numbering in the first column: the numbers run 1, 2, 3 and so on. */
function numberingDefects(table: Table): string[] {
  return table.rows.flatMap((row, index) =>
    row[0] === String(index + 1) ? [] : [`row ${index + 1} is numbered "${row[0] ?? ''}"`],
  );
}

// ── Collectors ───────────────────────────────────────────────────────────────────────────────────

function sectionDefects(guide: string): string[] {
  const found = headingsOf(guide, 2);
  const defects = REQUIRED_SECTIONS.filter(name => !found.includes(name)).map(name => `missing section "${name}"`);
  const order = REQUIRED_SECTIONS.map(name => found.indexOf(name)).filter(index => index >= 0);
  if (order.some((index, position) => position > 0 && index < (order[position - 1] ?? 0))) {
    defects.push('the sections are out of order');
  }
  return defects;
}

function turnsDefects(guide: string): string[] {
  const body = sectionBody(guide, 'Turns');
  if (body === undefined) return ['missing section "Turns"'];
  const lines = body.split('\n').map(line => line.trim()).filter(line => line !== '');
  const items = lines.filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, ''));
  const prose = lines.filter(line => !/^\d+\. /.test(line));
  const defects: string[] = [];
  if (!sameCells(items, TURN_ACTIONS)) defects.push(`Turns holds ${items.length} actions that differ from the four required`);
  if (prose.length > 1) defects.push(`Turns holds ${prose.length} prose lines, expected at most 1`);
  if (/efficien/i.test(body)) defects.push('Turns holds a general efficiency line');
  return defects;
}

function neverCutDefects(guide: string): string[] {
  const body = sectionBody(guide, 'Never-cut table');
  const table = body === undefined ? undefined : parseTable(body);
  if (table === undefined) return ['the never-cut table is missing'];
  const defects = [...table.shapeDefects];
  if (!sameCells(table.header, NEVER_CUT_HEADER)) defects.push(`the never-cut header is "${table.header.join(' | ')}"`);
  defects.push(...numberingDefects(table));
  if (table.rows.length < MIN_NEVER_CUT_ROWS) defects.push(`the table holds ${table.rows.length} rows, expected at least ${MIN_NEVER_CUT_ROWS}`);
  for (const subject of ['Principle 1', 'Error Handling']) {
    if (!table.rows.some(row => (row[1] ?? '').startsWith(subject))) defects.push(`no never-cut row for ${subject}`);
  }
  return defects;
}

function coreRuleDefects(guide: string): string[] {
  const body = sectionBody(guide, 'Core global rules');
  const table = body === undefined ? undefined : parseTable(body);
  if (table === undefined) return ['the core global rules table is missing'];
  const defects = [...table.shapeDefects];
  if (!sameCells(table.header, CORE_RULES_HEADER)) defects.push(`the core rules header is "${table.header.join(' | ')}"`);
  defects.push(...numberingDefects(table));
  if (table.rows.length < MIN_CORE_RULES) defects.push(`the table holds ${table.rows.length} rules, expected at least ${MIN_CORE_RULES}`);
  for (const [index, row] of table.rows.entries()) {
    if (row[2] !== 'Yes' && row[2] !== 'No') defects.push(`rule ${index + 1} is marked "${row[2] ?? ''}", expected Yes or No`);
  }
  for (const subject of ['Principle 1', 'Error Handling']) {
    const row = table.rows.find(candidate => (candidate[1] ?? '').startsWith(subject));
    if (row === undefined) defects.push(`no core rule for ${subject}`);
    else if (row[2] !== 'Yes') defects.push(`${subject} is not marked never-cut`);
  }
  return defects;
}

function architectureDefects(guide: string): string[] {
  const body = sectionBody(guide, 'Architecture');
  if (body === undefined) return ['missing section "Architecture"'];
  const parts = headingsOf(body, 3);
  const defects = ARCHITECTURE_PARTS.filter(part => !parts.includes(part)).map(part => `the architecture part lacks "${part}"`);
  for (const [needle, why] of [
    ['holds the whole typical path', 'the one-core-file decision'],
    ['fewer than half of real runs', 'the rare-branch test'],
    ['prefix must be at most 16,660 bytes', 'the prefix bound'],
    ['WORKFLOW_FOLDERS', 'the folder registry'],
    ['workflow-skill', 'the build variant'],
    ['dist/workflows', 'the build output'],
    ['12 hex digits', 'the build id length'],
    [' [build <id>]', 'the build stamp'],
  ] as const) {
    if (!body.includes(needle)) defects.push(`the architecture part does not state ${why} (${needle})`);
  }
  return defects;
}

function cutRecordDefects(guide: string): string[] {
  const body = sectionBody(guide, 'Cut record');
  if (body === undefined) return ['missing section "Cut record"'];
  return ([
    ['compiled bytes of the file before the cut and after it', 'the bytes before and after'],
    ['hosts that import the file', 'the importing hosts'],
    ['leaves less than half of the before size, stop', 'the stop for a cut below half'],
  ] as const)
    .filter(([needle]) => !body.includes(needle))
    .map(([, why]) => `the cut record rule lacks ${why}`);
}

function cutRuleDefects(guide: string): string[] {
  const body = sectionBody(guide, 'Cut rules');
  if (body === undefined) return ['missing section "Cut rules"'];
  return ([
    ['[never-cut table](#never-cut-table)', 'the link to the never-cut table'],
    ['Never cut Principles 1 to 4 or the Error Handling rule.', 'the rule for the principles and Error Handling'],
    ['A pinned sentence stays.', 'the rule for pinned sentences'],
    ['Never raise a limit in any other case.', 'the rule that no other limit rises'],
    ['One independent reader checks the diff against every lens below.', 'the one audit for each pull request'],
  ] as const)
    .filter(([needle]) => !body.includes(needle))
    .map(([, why]) => `the cut rules lack ${why}`);
}

function tokensDefects(guide: string): string[] {
  const body = sectionBody(guide, TOKENS_SECTION);
  if (body === undefined) return [`missing section "${TOKENS_SECTION}"`];
  const table = parseTable(body);
  const loads = (table?.rows ?? []).map(row => row[0] ?? '');
  const defects = [...(table?.shapeDefects ?? ['the load table is missing'])];
  for (const load of ['Always loaded', 'Main prompt', 'Agent prompt', 'On demand']) {
    if (!loads.includes(load)) defects.push(`the load table lacks "${load}"`);
  }
  for (const [needle, why] of [
    ['Rank the targets by token spend', 'the choice by spend'],
    ['Cut agent prompts that run many turns first.', 'the agent-first order'],
    ['Count a preloaded skill in every agent that preloads it.', 'the preload rule'],
    ['Cut a shared partial once', 'the shared-partial rule'],
  ] as const) {
    if (!body.includes(needle)) defects.push(`the token part lacks ${why}`);
  }
  if (!guide.includes('](lean-prompts-targets.md)')) defects.push('the guide does not link to the target inventory');
  return defects;
}

function targetRuleDefects(guide: string): string[] {
  const body = sectionBody(guide, TARGET_RULES_SECTION);
  if (body === undefined) return [`missing section "${TARGET_RULES_SECTION}"`];
  return ([
    ['No fixed size target.', 'the rule against a fixed target'],
    ['the bytes that a typical run reads in each build variant key, plus the turns per run', 'the size measure'],
    ['may rise only when the typical-run read of that key falls by more', 'the one ceiling exception'],
    ['All other ceilings only fall.', 'the rule for the other ceilings'],
    ['No new structure', 'the rule for new structure'],
    ['"finish and verify"', 'the model rule'],
    ['one independent audit for each pull request', 'the process for a text-only cut'],
    ['needs a plan first', 'the process for a structure or contract change'],
  ] as const)
    .filter(([needle]) => !body.includes(needle))
    .map(([, why]) => `the rules for every target lack ${why}`);
}

function targetsDefects(targets: string): string[] {
  const found = headingsOf(targets, 2);
  const defects = TARGET_SECTIONS.filter(name => !found.includes(name)).map(name => `the target inventory lacks "${name}"`);
  const ranked = sectionBody(targets, 'Ranked targets');
  const table = ranked === undefined ? undefined : parseTable(ranked);
  if (table === undefined) return [...defects, 'the ranked table is missing'];
  defects.push(...table.shapeDefects, ...numberingDefects(table));
  if (table.rows.length < MIN_RANKED_TARGETS) defects.push(`the ranked table holds ${table.rows.length} targets, expected at least ${MIN_RANKED_TARGETS}`);
  // A range ranks by its top value, so each row's volume is the largest number in its cell.
  const volumes = table.rows.map(row => Math.max(...[...(row[2] ?? '').matchAll(/\d[\d,]*/g)].map(match => Number(match[0].replace(/,/g, '')))));
  volumes.forEach((volume, index) => {
    if (index > 0 && volume > (volumes[index - 1] ?? 0)) defects.push(`rank ${index + 1} has a larger volume than rank ${index}`);
  });
  const groups = parseTable(sectionBody(targets, 'Target groups') ?? '');
  if (groups === undefined || !sameCells(groups.header, ['Group', 'Files', 'Cuts that fit'])) defects.push('the target groups table is missing');
  return defects;
}

function linkDefects(guide: string, assumptions: string): string[] {
  const anchors = headingsOf(assumptions, 2).map(anchorOf);
  const targets = [...guide.matchAll(/\]\(platform-assumptions\.md#([^)]+)\)/g)].map(match => match[1] ?? '');
  if (targets.length === 0) return ['the guide does not link to the live-check results'];
  return targets.filter(target => !anchors.includes(target)).map(target => `no heading in platform-assumptions.md makes the anchor #${target}`);
}

function liveCheckDefects(assumptions: string): string[] {
  const body = sectionBody(assumptions, LIVE_CHECK_HEADING);
  const table = body === undefined ? undefined : parseTable(body);
  if (table === undefined) return [`platform-assumptions.md has no table under "${LIVE_CHECK_HEADING}"`];
  const defects = [...table.shapeDefects];
  if (!sameCells(table.header, LIVE_CHECK_HEADER)) defects.push(`the live-check header is "${table.header.join(' | ')}"`);
  for (const [index, row] of table.rows.entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row[2] ?? '')) defects.push(`live-check row ${index + 1} has no date stamp`);
  }
  const reattach = table.rows.find(row => (row[0] ?? '').startsWith('Re-attach'));
  if (reattach === undefined || !(reattach[1] ?? '').includes('exactly 20,000 characters')) {
    defects.push('no row records the re-attach of exactly 20,000 characters');
  }
  const risk = table.rows.find(row => (row[0] ?? '').startsWith('Open risk'));
  if (risk === undefined || !(risk[1] ?? '').includes('--resume') || !(risk[1] ?? '').includes('/compact')) {
    defects.push('no open-risk row records a resumed process that runs /compact');
  }
  return defects;
}

const FORBIDDEN_IN_PUBLIC_TEXT: readonly (readonly [RegExp, string])[] = [
  [/\/(?:Users|private|tmp)\//, 'a local path'],
  [/#\d{2,}/, 'a ticket number'],
  [/\b(?:ADR|PF)-\d+/, 'a ledger identifier'],
  [/\b(?:Orchestrator|lanes?|board|workspace)\b/i, 'a workspace role or name'],
  [/\b(?:PA|PB)\d+\b|\bTP-\d+\b|\bstop \d+\b/, 'a plan step number'],
];

function publicTextDefects(text: string): string[] {
  return FORBIDDEN_IN_PUBLIC_TEXT.filter(([pattern]) => pattern.test(text)).map(([, what]) => `the text names ${what}`);
}

/** Replace `from` with `to`, and fail the test when `from` does not occur exactly once. */
function seedOnce(text: string, from: string, to: string): string {
  expect(text.split(from).length - 1, `the seed text occurs once: ${from}`).toBe(1);
  return text.replace(from, () => to);
}

// ── The guide ────────────────────────────────────────────────────────────────────────────────────

describe('the lean-prompts guide has every required part', () => {
  it('holds the sections in order', () => {
    expect(sectionDefects(GUIDE)).toEqual([]);
  });

  it('holds the cut rules, with the rules that bind every cut', () => {
    expect(cutRuleDefects(GUIDE)).toEqual([]);
  });

  it('holds the cut record rule', () => {
    expect(cutRecordDefects(GUIDE)).toEqual([]);
  });

  it('holds the architecture part', () => {
    expect(architectureDefects(GUIDE)).toEqual([]);
  });

  it('holds where the tokens go, and links the target inventory', () => {
    expect(tokensDefects(GUIDE)).toEqual([]);
  });

  it('holds the rules for every target', () => {
    expect(targetRuleDefects(GUIDE)).toEqual([]);
  });
});

describe('the target inventory', () => {
  it('holds the measure method, the always-loaded text, the ranked targets and the groups', () => {
    expect(targetsDefects(TARGETS)).toEqual([]);
  });

  it('shows a lost section, a renumbered rank and a short ranked list each as a defect', () => {
    expect(targetsDefects(seedOnce(TARGETS, '## Target groups\n', '## Groups\n'))).toContain('the target inventory lacks "Target groups"');
    expect(targetsDefects(seedOnce(TARGETS, '| 2 | `test-driven-development` skill', '| 3 | `test-driven-development` skill'))).not.toEqual([]);
    const ranked = sectionBody(TARGETS, 'Ranked targets') ?? '';
    const lastRow = ranked.split('\n').filter(line => line.startsWith('| 15 |'))[0] ?? '';
    expect(targetsDefects(seedOnce(TARGETS, `${lastRow}\n`, ''))).not.toEqual([]);
    expect(targetsDefects(seedOnce(TARGETS, '| Group | Files | Cuts that fit |', 'Group, Files, Cuts that fit'))).toContain('the target groups table is missing');
  });

  it('shows a rank out of order as a defect', () => {
    expect(targetsDefects(seedOnce(TARGETS, '| 15 | Git agent body | 46 |', '| 15 | Git agent body | 99 |'))).toContain('rank 15 has a larger volume than rank 14');
  });
});

describe('the Turns section holds the four actions', () => {
  it('lists the four actions in order and no general efficiency line', () => {
    expect(turnsDefects(GUIDE)).toEqual([]);
  });

  it('shows a missing action, an extra action and an efficiency line each as a defect', () => {
    const last = '4. Do not send a turn that only narrates.\n';
    expect(turnsDefects(seedOnce(GUIDE, last, ''))).not.toEqual([]);
    expect(turnsDefects(seedOnce(GUIDE, last, `${last}5. Check the result.\n`))).not.toEqual([]);
    expect(turnsDefects(seedOnce(GUIDE, 'A turn is one model call in the main session or in an agent.', 'Work efficiently.'))).toContain('Turns holds a general efficiency line');
    expect(turnsDefects(seedOnce(GUIDE, 'Read a reference only on its branch.', 'Read a reference.'))).not.toEqual([]);
  });
});

describe('the never-cut table', () => {
  it('has the columns item, location and guard probe, and numbered rows', () => {
    expect(neverCutDefects(GUIDE)).toEqual([]);
  });

  it('names the probe or the lack of one in every row', () => {
    const table = parseTable(sectionBody(GUIDE, 'Never-cut table') ?? '');
    for (const row of table?.rows ?? []) {
      expect(row[3], `row ${row[0]} names a pin or "No pin yet"`).toMatch(/Pinned in|pins|No pin yet/);
      expect(row[3], `row ${row[0]} states its seeded deletion`).toContain('Seed:');
    }
  });

  it('shows a renamed column, a renumbered row, an empty cell and a lost subject each as a defect', () => {
    expect(neverCutDefects(seedOnce(GUIDE, '| No. | Item | Location | Guard probe |', '| No. | Item | Place | Guard probe |'))).not.toEqual([]);
    expect(neverCutDefects(seedOnce(GUIDE, '| 3 | Principle 2', '| 4 | Principle 2'))).not.toEqual([]);
    expect(neverCutDefects(seedOnce(GUIDE, '| Phase 10, ci-fix spawn. |', '|  |'))).not.toEqual([]);
    expect(neverCutDefects(seedOnce(GUIDE, '| 6 | Error Handling rule.', '| 6 | Report rule.'))).toContain('no never-cut row for Error Handling');
  });
});

describe('the core global rules', () => {
  it('carry a mark each, and Principle 1 and Error Handling are never-cut', () => {
    expect(coreRuleDefects(GUIDE)).toEqual([]);
  });

  it('shows an unmarked rule and a cut Principle 1 each as a defect', () => {
    expect(coreRuleDefects(seedOnce(GUIDE, '| 5 | Error Handling | Yes |', '| 5 | Error Handling | Maybe |'))).not.toEqual([]);
    expect(coreRuleDefects(seedOnce(GUIDE, '| 1 | Principle 1, orchestration only | Yes |', '| 1 | Principle 1, orchestration only | No |'))).toContain('Principle 1 is not marked never-cut');
    expect(coreRuleDefects(seedOnce(GUIDE, '| Rule | Never-cut | Reason |', '| Rule | Mark | Reason |'))).not.toEqual([]);
  });
});

describe('the other parts show a loss as a defect', () => {
  it('a missing section, a lost architecture part, a lost bound and a lost cut-record clause', () => {
    expect(sectionDefects(seedOnce(GUIDE, '## Turns\n', '## Turn list\n'))).toContain('missing section "Turns"');
    expect(architectureDefects(seedOnce(GUIDE, '### Skill folders\n', '### Folders\n'))).toContain('the architecture part lacks "Skill folders"');
    expect(architectureDefects(seedOnce(GUIDE, 'The prefix must be at most 16,660 bytes', 'The prefix must be short'))).not.toEqual([]);
    expect(tokensDefects(seedOnce(GUIDE, '| Agent prompt |', '| Spawn |'))).toContain('the load table lacks "Agent prompt"');
    expect(tokensDefects(seedOnce(GUIDE, '](lean-prompts-targets.md)', '](targets.md)'))).toContain('the guide does not link to the target inventory');
    expect(targetRuleDefects(seedOnce(GUIDE, 'All other ceilings only fall.', 'Other ceilings may move.'))).not.toEqual([]);
    expect(cutRuleDefects(seedOnce(GUIDE, 'One independent reader checks the diff against every lens below.', 'Readers check the diff.'))).not.toEqual([]);
    expect(cutRecordDefects(seedOnce(GUIDE, 'leaves less than half of the before size, stop', 'leaves little'))).not.toEqual([]);
    expect(cutRuleDefects(seedOnce(GUIDE, 'A pinned sentence stays.', 'A pinned sentence can go.'))).not.toEqual([]);
  });
});

// ── The live-check results ───────────────────────────────────────────────────────────────────────

describe('the live-check results sit in platform-assumptions.md', () => {
  it('the guide links to a heading that exists', () => {
    expect(linkDefects(GUIDE, ASSUMPTIONS)).toEqual([]);
  });

  it('the table has a date stamp and a drift symptom on every row, the re-attach facts and the open risk', () => {
    expect(liveCheckDefects(ASSUMPTIONS)).toEqual([]);
  });

  it('shows a broken anchor, a missing date, an empty symptom and a lost open risk each as a defect', () => {
    expect(linkDefects(seedOnce(GUIDE, 'platform-assumptions.md#skill-folders-and-compaction-re-attach', 'platform-assumptions.md#skill-folders'), ASSUMPTIONS)).not.toEqual([]);
    expect(linkDefects('no link here', ASSUMPTIONS)).not.toEqual([]);
    expect(liveCheckDefects(seedOnce(ASSUMPTIONS, '| 2026-10-28 | `/devflow:implement` reports an unknown command', '|  | `/devflow:implement` reports an unknown command'))).not.toEqual([]);
    expect(liveCheckDefects(seedOnce(ASSUMPTIONS, '| 2026-10-28 | `/devflow:implement` reports an unknown command or runs another file. |', '| 2026-10-28 |  |'))).not.toEqual([]);
    expect(liveCheckDefects(seedOnce(ASSUMPTIONS, 'Open risk: `/compact` in a resumed process', 'Resumed compaction'))).toContain('no open-risk row records a resumed process that runs /compact');
    expect(liveCheckDefects(seedOnce(ASSUMPTIONS, 'exactly 20,000 characters', 'about 20,000 characters'))).toContain('no row records the re-attach of exactly 20,000 characters');
  });
});

// ── Public text ──────────────────────────────────────────────────────────────────────────────────

describe('the new text suits a public repository', () => {
  it('the guide names no local path, ticket, ledger identifier, workspace role or plan step', () => {
    expect(publicTextDefects(GUIDE)).toEqual([]);
  });

  it('the target inventory names none of them', () => {
    expect(publicTextDefects(TARGETS)).toEqual([]);
  });

  it('the live-check section names none of them', () => {
    expect(publicTextDefects(sectionBody(ASSUMPTIONS, LIVE_CHECK_HEADING) ?? '')).toEqual([]);
  });

  it('shows each kind of leak as a defect', () => {
    for (const leak of ['at /Users/x/work', 'in /tmp/x', 'see #675', 'per ADR-12', 'ask the Orchestrator', 'the lane', 'step PB4', 'row TP-15', 'at stop 2']) {
      expect(publicTextDefects(leak), leak).not.toEqual([]);
    }
  });
});

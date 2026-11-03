/**
 * The tdd variants of the Code agent and Triage (#758). Triage says the Code agent works
 * test-first only with tdd on; its four tdd-off files say it writes one test for each behaviour.
 *
 * `features.tdd` picks which Code file a machine installs. With tdd on, the Code agent preloads the
 * test-driven-development skill and its steps say "write one failing test first" and name the "TDD
 * cycle". With tdd off, the Code agent carries none of that text and keeps its test rules: one test
 * per behaviour, the trust-boundary, data-loss, security and fail-closed tests, the regression test
 * rule of issue-fix, and the typing rule. This file holds both sides, read from the COMPILED files a
 * session loads, in both curation variants (`dist/tdd-off/` and `dist/curation-tdd-off/` against
 * `dist/agents/` and `dist/curation-off/agents/`):
 *
 *   off   no preload of the skill, no "failing test first", no "TDD", and the kept test rules present,
 *         including the bug-fix test sentence that stands in for the skill's debug rule;
 *   on    the preload and the test-first wording present, so the switch removes something;
 *   pair  the off file is the on file with exactly the preload line, the test-first sentence of step 3
 *         and the words " in its TDD cycle" of step 4 replaced, so the two never drift apart;
 *   scope Fix and Refactor are not test-first builds and have no tdd variant;
 *   skills the skills a tdd-off machine keeps (every skill folder but the gated one, in the source and
 *         the generated tree) name neither the skill nor a TDD instruction, apart from two bibliographies.
 *
 * Every arm runs through a named collector, and each known-bad probe feeds the same collector a
 * mutated body, so a collector that stopped seeing a defect fails its own probe instead of passing
 * vacuously.
 *
 * What a green run does NOT prove: it proves the files carry and lack the text. It does not prove a
 * model follows them.
 */

import { readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect } from 'vitest'

import { ROOT, resolveAgentSource, resolveCurationOffSource, resolveVariantOffSource } from '../helpers.js'
import { TDD_GATED_SKILLS } from '../../src/core/plugins.js'
import type { OffVariantKey } from '../../src/core/curation-variants.js'

/** The skill folders a tdd-off machine keeps: every shipped skill except the gated ones. */
const SKILL_ROOTS = ['src/assets/skills', 'dist/skills'] as const
/** The two bibliographies that cite TDD book titles. They are sources, not instructions. */
const TDD_TEXT_ALLOWED_FILES: readonly string[] = [
  'src/assets/skills/qa/references/sources.md',
  'src/assets/skills/testing/references/sources.md',
]
/** Fewer files than this means the walk found no skill tree (src/assets/skills holds well over 100 files). */
const MIN_SKILL_FILES = 100

const TDD_SKILL_TEXT: ReadonlyArray<readonly [label: string, re: RegExp]> = [
  ['names TDD', /\bTDD\b/],
  ['names test-driven development', /test[- ]driven/i],
  ['says "failing test first"', /failing test first/i],
  ['asks to write a failing test', /write (?:a|one|the) failing test/i],
  ['names red-green-refactor', /red[- ]green/i],
  ['says test-first', /\btests?[- ]first\b/i],
]

const PRELOAD_LINE = `  - devflow:${TDD_GATED_SKILLS[0]}\n`
const STEP3_ON =
  '3. **Write tests**: Write one failing test first for each acceptance-criterion behaviour (else each behaviour your steps\' Must lines name). Add an edge-case test only for a named, concrete case. Always test trust boundaries, data loss, security and fail-closed paths.'
const STEP3_OFF =
  '3. **Write tests**: Write one test for each acceptance-criterion behaviour (else each behaviour your steps\' Must lines name), with the code. Add an edge-case test only for a named, concrete case. Always test trust boundaries, data loss, security and fail-closed paths. For a bug fix, first add a test that fails without the fix.'
const BUG_FIX_RULE = 'For a bug fix, first add a test that fails without the fix.'
const GATE_ON_PHRASE = 'for your change in its TDD cycle, plus'
const GATE_OFF_PHRASE = 'for your change, plus'

/** The test rules both variants keep. */
const KEPT_TEXT: ReadonlyArray<readonly [label: string, text: string]> = [
  ['the trust-boundary, data-loss, security and fail-closed test line', 'Always test trust boundaries, data loss, security and fail-closed paths.'],
  ['the regression test rule', '**Regression test rule**'],
  ['the typing rule', 'Type everything.'],
  ['the edge-case rule', 'Add an edge-case test only for a named, concrete case.'],
]

interface Pair { readonly label: string; readonly on: string; readonly off: string }

function offFile(key: 'tdd-off' | 'curation-tdd-off'): string {
  const text = resolveVariantOffSource(key, 'agents', 'code')
  if (text === null) throw new Error(`dist/${key}/agents/code.md is absent — run \`npm run build\` first`)
  return text
}

function onCurationOff(): string {
  const text = resolveCurationOffSource('agents', 'code')
  if (text === null) throw new Error('dist/curation-off/agents/code.md is absent — run `npm run build` first')
  return text
}

/** The two on/off pairs: curation on, and curation off. */
function pairs(): Pair[] {
  return [
    { label: 'curation on', on: resolveAgentSource('code').content, off: offFile('tdd-off') },
    { label: 'curation off', on: onCurationOff(), off: offFile('curation-tdd-off') },
  ]
}

/** Named collector: how a Code file falls short of the tdd-off shape. */
export function collectTddOffDefects(text: string): string[] {
  const out: string[] = []
  if (text.includes(`devflow:${TDD_GATED_SKILLS[0]}`)) out.push(`preloads or names the ${TDD_GATED_SKILLS[0]} skill`)
  if (/failing test first/i.test(text)) out.push('says "failing test first"')
  if (/\bTDD\b/.test(text)) out.push('names TDD')
  if (/test-driven/i.test(text)) out.push('names test-driven development')
  for (const [label, kept] of KEPT_TEXT) {
    if (!text.includes(kept)) out.push(`lost ${label}`)
  }
  if (!text.includes(BUG_FIX_RULE)) out.push('lost the bug-fix test rule (a /debug fix has no skill to carry it)')
  if (!text.includes(STEP3_OFF)) out.push('lacks the tdd-off step 3')
  return out
}

/** Named collector: how a Code file falls short of the tdd-on shape. */
export function collectTddOnDefects(text: string): string[] {
  const out: string[] = []
  if (!text.includes(PRELOAD_LINE)) out.push(`does not preload the ${TDD_GATED_SKILLS[0]} skill`)
  if (!text.includes(STEP3_ON)) out.push('lacks the test-first step 3')
  if (!text.includes(GATE_ON_PHRASE)) out.push('lacks "in its TDD cycle" in the gate line')
  for (const [label, kept] of KEPT_TEXT) {
    if (!text.includes(kept)) out.push(`lost ${label}`)
  }
  return out
}

/** Named collector: the tdd-off file a tdd-on file must produce, by the three replacements and no other change. */
export function deriveTddOff(on: string): string {
  return on.replace(PRELOAD_LINE, '').replace(STEP3_ON, STEP3_OFF).replace(GATE_ON_PHRASE, GATE_OFF_PHRASE)
}

describe('the tdd-off Code file (#758)', () => {
  it.each(pairs())('with $label: no skill preload, no test-first wording, and the test rules kept', ({ off }) => {
    expect(off.length, 'the file was read (non-vacuity)').toBeGreaterThan(1000)
    expect(collectTddOffDefects(off)).toEqual([])
  })

  it('both trees are the tdd-on file with exactly the preload, the step 3 sentence and the gate words replaced', () => {
    for (const { label, on, off } of pairs()) {
      expect(deriveTddOff(on), `${label}: the replacements change the on file (non-vacuity)`).not.toBe(on)
      expect(deriveTddOff(on), `${label}: the tdd-off file differs from the tdd-on file beyond the tdd arms`).toBe(off)
    }
  })

  it('known-bad probe: a re-added preload, a "TDD cycle" and a lost test line are each reported', () => {
    const { off } = pairs()[0]
    expect(collectTddOffDefects(off)).toEqual([])
    expect(collectTddOffDefects(off.replace('  - devflow:testing\n', `  - devflow:testing\n${PRELOAD_LINE}`))).toEqual([
      `preloads or names the ${TDD_GATED_SKILLS[0]} skill`,
      'names test-driven development',
    ])
    expect(collectTddOffDefects(off.replace(GATE_OFF_PHRASE, GATE_ON_PHRASE))).toEqual(['names TDD'])
    expect(collectTddOffDefects(off.replace(STEP3_OFF, STEP3_ON))).toEqual([
      'says "failing test first"',
      'lost the bug-fix test rule (a /debug fix has no skill to carry it)',
      'lacks the tdd-off step 3',
    ])
    expect(collectTddOffDefects(off.replace('Always test trust boundaries, data loss, security and fail-closed paths.', ''))).toEqual([
      'lost the trust-boundary, data-loss, security and fail-closed test line',
      'lacks the tdd-off step 3',
    ])
    expect(collectTddOffDefects(off.replace(` ${BUG_FIX_RULE}`, ''))).toEqual([
      'lost the bug-fix test rule (a /debug fix has no skill to carry it)',
      'lacks the tdd-off step 3',
    ])
    expect(collectTddOffDefects(off.replace('**Regression test rule**', 'Regression note'))).toEqual(['lost the regression test rule'])
    expect(collectTddOffDefects(off.replace('Type everything.', ''))).toEqual(['lost the typing rule'])
  })
})

describe('the tdd-on Code file (#758)', () => {
  it.each(pairs())('with $label: the skill preload and the test-first wording are there', ({ on }) => {
    expect(collectTddOnDefects(on)).toEqual([])
  })

  it('known-bad probe: the tdd-off file is not a tdd-on file, and each lost line is reported', () => {
    const { on, off } = pairs()[0]
    expect(collectTddOnDefects(off)).toEqual([
      `does not preload the ${TDD_GATED_SKILLS[0]} skill`,
      'lacks the test-first step 3',
      'lacks "in its TDD cycle" in the gate line',
    ])
    expect(collectTddOnDefects(on.replace(PRELOAD_LINE, ''))).toEqual([`does not preload the ${TDD_GATED_SKILLS[0]} skill`])
    expect(collectTddOnDefects(on.replace('**Regression test rule**', 'Regression note'))).toEqual(['lost the regression test rule'])
  })
})

/** Named collector: every file under a skill folder except the gated skills', as repo-relative path and text. */
export function collectKeptSkillFiles(root: string = ROOT): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = []
  const gated: readonly string[] = TDD_GATED_SKILLS
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push({ rel: path.relative(root, full).split(path.sep).join('/'), text: readFileSync(full, 'utf-8') })
    }
  }
  for (const skillsRoot of SKILL_ROOTS) {
    const base = path.join(root, skillsRoot)
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && !gated.includes(entry.name)) walk(path.join(base, entry.name))
    }
  }
  return out
}

/** Named collector: the kept skill files that hold TDD text, as `path: what`. The allowed bibliographies are skipped by exact path. */
export function collectSkillTddText(files: ReadonlyArray<{ rel: string; text: string }>, allowed: readonly string[] = TDD_TEXT_ALLOWED_FILES): string[] {
  const out: string[] = []
  for (const { rel, text } of files) {
    if (allowed.includes(rel)) continue
    if (text.includes(`devflow:${TDD_GATED_SKILLS[0]}`) || text.includes(`\`${TDD_GATED_SKILLS[0]}\``)) {
      out.push(`${rel}: names the ${TDD_GATED_SKILLS[0]} skill`)
    }
    for (const [label, re] of TDD_SKILL_TEXT) {
      if (re.test(text)) out.push(`${rel}: ${label}`)
    }
  }
  return out
}

describe('the skills a tdd-off machine keeps (#758)', () => {
  it('no skill but the gated one names the TDD skill or holds a TDD instruction', () => {
    const files = collectKeptSkillFiles()
    expect(files.length, 'the walk read the skill trees (non-vacuity)').toBeGreaterThan(MIN_SKILL_FILES)
    expect(files.some((f) => f.rel.startsWith('dist/skills/')), 'the generated skill files were read').toBe(true)
    expect(files.some((f) => f.rel.startsWith(`src/assets/skills/${TDD_GATED_SKILLS[0]}/`)), 'the gated skill is left out').toBe(false)
    for (const rel of TDD_TEXT_ALLOWED_FILES) {
      expect(files.some((f) => f.rel === rel), `${rel} exists, so the allowance is not stale`).toBe(true)
    }
    expect(collectSkillTddText(files)).toEqual([])
  })

  it('known-bad probe: each kind of TDD text in a kept skill is reported, and only the named bibliographies are exempt', () => {
    const bad = (text: string): string[] => collectSkillTddText([{ rel: 'src/assets/skills/testing/SKILL.md', text }])
    expect(bad('See `devflow:test-driven-development` for the cycle.')).toEqual([
      'src/assets/skills/testing/SKILL.md: names the test-driven-development skill',
      'src/assets/skills/testing/SKILL.md: names test-driven development',
    ])
    expect(bad('Apply TDD here.')).toEqual(['src/assets/skills/testing/SKILL.md: names TDD'])
    expect(bad('Write the failing test first.')).toEqual([
      'src/assets/skills/testing/SKILL.md: says "failing test first"',
      'src/assets/skills/testing/SKILL.md: asks to write a failing test',
      'src/assets/skills/testing/SKILL.md: says test-first',
    ])
    expect(bad('Follow red-green-refactor.')).toEqual(['src/assets/skills/testing/SKILL.md: names red-green-refactor'])
    expect(bad('Work test-first.')).toEqual(['src/assets/skills/testing/SKILL.md: says test-first'])
    expect(bad('Fix failing tests, then run the suite.')).toEqual([])
    const bibliography = { rel: TDD_TEXT_ALLOWED_FILES[0], text: 'Test Driven Development: By Example, TDD' }
    expect(collectSkillTddText([bibliography])).toEqual([])
    expect(collectSkillTddText([{ ...bibliography, rel: 'src/assets/skills/qa/references/other.md' }])).not.toEqual([])
  })
})

const TRIAGE_ON_LINE = '**Careful** (Code agent works test-first):'
const TRIAGE_OFF_LINE = '**Careful** (Code agent writes one test for each behaviour, with the code):'

/** The eight Triage files: each tdd-off tree against the tdd-on tree with the same curation and compliance state. */
const TRIAGE_PAIRS: ReadonlyArray<{ label: string; onKey: OffVariantKey | null; offKey: OffVariantKey }> = [
  { label: 'curation on, compliance on', onKey: null, offKey: 'tdd-off' },
  { label: 'curation off, compliance on', onKey: 'curation-off', offKey: 'curation-tdd-off' },
  { label: 'curation on, compliance off', onKey: 'compliance-off', offKey: 'compliance-tdd-off' },
  { label: 'curation off, compliance off', onKey: 'both-off', offKey: 'curation-compliance-tdd-off' },
]

function triageFile(key: OffVariantKey | null): string {
  if (key === null) return resolveAgentSource('triage').content
  const text = resolveVariantOffSource(key, 'agents', 'triage')
  if (text === null) throw new Error(`dist/${key}/agents/triage.md is absent — run \`npm run build\` first`)
  return text
}

/** Named collector: how a Triage file falls short of the tdd-off shape. */
export function collectTriageTddOffDefects(text: string): string[] {
  const out: string[] = []
  if (/test-first/i.test(text)) out.push('says test-first')
  if (!text.includes(TRIAGE_OFF_LINE)) out.push('lacks the tdd-off Careful line')
  return out
}

/** Named collector: how a Triage file falls short of the tdd-on shape. */
export function collectTriageTddOnDefects(text: string): string[] {
  const out: string[] = []
  if (!text.includes(TRIAGE_ON_LINE)) out.push('lacks the tdd-on Careful line')
  if (text.includes(TRIAGE_OFF_LINE)) out.push('carries the tdd-off Careful line')
  return out
}

describe('the Triage tdd arm (#758)', () => {
  it.each(TRIAGE_PAIRS)('with $label: the tdd-off file never says the Code agent works test-first', ({ offKey }) => {
    const off = triageFile(offKey)
    expect(off.length, 'the file was read (non-vacuity)').toBeGreaterThan(1000)
    expect(collectTriageTddOffDefects(off)).toEqual([])
  })

  it.each(TRIAGE_PAIRS)('with $label: the tdd-on file keeps its line', ({ onKey }) => {
    expect(collectTriageTddOnDefects(triageFile(onKey))).toEqual([])
  })

  it.each(TRIAGE_PAIRS)('with $label: the tdd-off file is the tdd-on file with that one line replaced', ({ onKey, offKey }) => {
    const on = triageFile(onKey)
    expect(on.replace(TRIAGE_ON_LINE, TRIAGE_OFF_LINE), 'the replacement changes the on file (non-vacuity)').not.toBe(on)
    expect(triageFile(offKey)).toBe(on.replace(TRIAGE_ON_LINE, TRIAGE_OFF_LINE))
  })

  it('known-bad probe: the old wording in a tdd-off file, a lost off line and a tdd-on file with the off line are each reported', () => {
    const off = triageFile('tdd-off')
    const on = triageFile(null)
    expect(collectTriageTddOffDefects(off)).toEqual([])
    expect(collectTriageTddOffDefects(off.replace(TRIAGE_OFF_LINE, TRIAGE_ON_LINE))).toEqual(['says test-first', 'lacks the tdd-off Careful line'])
    expect(collectTriageTddOffDefects(off.replace(TRIAGE_OFF_LINE, ''))).toEqual(['lacks the tdd-off Careful line'])
    expect(collectTriageTddOnDefects(on)).toEqual([])
    expect(collectTriageTddOnDefects(on.replace(TRIAGE_ON_LINE, TRIAGE_OFF_LINE))).toEqual([
      'lacks the tdd-on Careful line',
      'carries the tdd-off Careful line',
    ])
  })
})

describe('the other Code variants (#758)', () => {
  it.each(['fix', 'refactor'])('%s is not a test-first build and has no tdd variant', (name) => {
    expect(resolveVariantOffSource('tdd-off', 'agents', name)).toBeNull()
    expect(resolveVariantOffSource('curation-tdd-off', 'agents', name)).toBeNull()
    expect(resolveAgentSource(name).content).not.toContain(`devflow:${TDD_GATED_SKILLS[0]}`)
  })
})

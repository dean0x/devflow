/**
 * The tdd variants of the Code agent (#758).
 *
 * `features.tdd` picks which Code file a machine installs. With tdd on, the Code agent preloads the
 * test-driven-development skill and its steps say "write one failing test first" and name the "TDD
 * cycle". With tdd off, the Code agent carries none of that text and keeps its test rules: one test
 * per behaviour, the trust-boundary, data-loss, security and fail-closed tests, the regression test
 * rule of issue-fix, and the typing rule. This file holds both sides, read from the COMPILED files a
 * session loads, in both curation variants (`dist/tdd-off/` and `dist/curation-tdd-off/` against
 * `dist/agents/` and `dist/curation-off/agents/`):
 *
 *   off   no preload of the skill, no "failing test first", no "TDD", and the kept test rules present;
 *   on    the preload and the test-first wording present, so the switch removes something;
 *   pair  the off file is the on file with exactly the preload line, the test-first sentence of step 3
 *         and the words " in its TDD cycle" of step 4 replaced, so the two never drift apart;
 *   scope Fix and Refactor are not test-first builds and have no tdd variant.
 *
 * Every arm runs through a named collector, and each known-bad probe feeds the same collector a
 * mutated body, so a collector that stopped seeing a defect fails its own probe instead of passing
 * vacuously.
 *
 * What a green run does NOT prove: it proves the files carry and lack the text. It does not prove a
 * model follows them.
 */

import { describe, it, expect } from 'vitest'

import { resolveAgentSource, resolveCurationOffSource, resolveVariantOffSource } from '../helpers.js'
import { TDD_GATED_SKILLS } from '../../src/core/plugins.js'

const PRELOAD_LINE = `  - devflow:${TDD_GATED_SKILLS[0]}\n`
const STEP3_ON =
  '3. **Write tests**: Write one failing test first for each acceptance-criterion behaviour (else each behaviour your steps\' Must lines name). Add an edge-case test only for a named, concrete case. Always test trust boundaries, data loss, security and fail-closed paths.'
const STEP3_OFF =
  '3. **Write tests**: Write one test for each acceptance-criterion behaviour (else each behaviour your steps\' Must lines name), with the code. Add an edge-case test only for a named, concrete case. Always test trust boundaries, data loss, security and fail-closed paths.'
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
      'lacks the tdd-off step 3',
    ])
    expect(collectTddOffDefects(off.replace('Always test trust boundaries, data loss, security and fail-closed paths.', ''))).toEqual([
      'lost the trust-boundary, data-loss, security and fail-closed test line',
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

describe('the other Code variants (#758)', () => {
  it.each(['fix', 'refactor'])('%s is not a test-first build and has no tdd variant', (name) => {
    expect(resolveVariantOffSource('tdd-off', 'agents', name)).toBeNull()
    expect(resolveVariantOffSource('curation-tdd-off', 'agents', name)).toBeNull()
    expect(resolveAgentSource(name).content).not.toContain(`devflow:${TDD_GATED_SKILLS[0]}`)
  })
})

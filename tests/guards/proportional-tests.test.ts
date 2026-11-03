/**
 * Proportional tests and concrete-case review (#756, AC4, AC6 and AC7).
 *
 *   - The Architect flags a step above the lowest rung and an option, layer or config key with no ask.
 *   - Design-review rules 4 and 5, the Review agent and the patterns skill ask for a retry, a compensation
 *     step, a cache or idempotency only when the artifact shows a concrete case. Error handling at a trust
 *     boundary or for data loss, and a missing bound on an existing loop, retry or cache, stay findings.
 *   - No shipped prompt asks for the happy path, error cases and edge cases of every change. Code, the
 *     testing and quality-gates skills ask for one test per acceptance-criterion behaviour, an edge-case test
 *     only for a named case, and always a test of a trust boundary, data loss, security or fail-closed path.
 *   - The TDD Iron Law, the RED step and the bug-fix regression rule stay.
 *
 * Each rule has a named collector and known-bad probes. The one-Suggest-line rule of design-review lives in
 * design-variants.test.ts, and the byte ceilings in the group size guards.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import * as path from 'path'
import { ROOT, resolveAgentSource, resolveCurationOffSource } from '../helpers.js'

const ASSETS = path.join(ROOT, 'src', 'assets')
const readAsset = (...parts: string[]): string => readFileSync(path.join(ASSETS, ...parts), 'utf-8')

/** The text of rule `n` of the design-review skill, from its heading to the next heading. */
export function designReviewRule(skill: string, n: number): string {
  const start = skill.search(new RegExp(`^### ${n}\\. `, 'm'))
  if (start === -1) return ''
  const rest = skill.slice(start + 4)
  const end = rest.search(/^#{2,3} /m)
  return end === -1 ? rest : rest.slice(0, end)
}

/** Named collector: how the design-review skill falls short of the concrete-case rule for rules 4 and 5. */
export function collectConcreteCaseDefects(skill: string): string[] {
  const out: string[] = []
  if (!/external call[^.]*hot path[^.]*repeated delivery/.test(skill)) out.push('the skill does not define a concrete case')
  for (const n of [4, 5]) {
    const rule = designReviewRule(skill, n)
    if (rule === '') out.push(`design-review rule ${n} is absent`)
    else if (!rule.includes('concrete case')) out.push(`design-review rule ${n} does not ask for a concrete case`)
  }
  const four = designReviewRule(skill, 4)
  if (four !== '' && !(four.includes('trust boundary') && four.includes('data loss'))) {
    out.push('design-review rule 4 does not keep error handling at a trust boundary or for data loss')
  }
  const intro = skill.slice(skill.search(/^## Anti-Pattern Detection Rules/m), skill.search(/^### 1\. /m))
  if (/\bRules? 4 and 5\b/.test(intro)) out.push('the intro gates all of rule 4 on a concrete case, not only its retry and compensation line')
  return out
}

/** Named collector: how a compiled Review body falls short of the concrete-case rule. */
export function collectReviewDefects(label: string, review: string): string[] {
  const out: string[] = []
  if (!review.includes('do not ask for caching, retries, idempotency or compensation unless the diff shows a concrete case')) {
    out.push(`${label}: no concrete-case rule for caching, retries, idempotency and compensation`)
  }
  if (!review.includes('A missing bound on an existing loop, retry or cache stays a finding')) {
    out.push(`${label}: a missing bound on an existing loop, retry or cache is no longer a finding`)
  }
  if (!review.includes('A partial write that can lose data, a trust boundary and a fail-closed path need no case')) {
    out.push(`${label}: a partial write that can lose data, a trust boundary and a fail-closed path now need a concrete case`)
  }
  return out
}

/** Named collector: how a compiled Architect body falls short of the minimum lens. */
export function collectArchitectLensDefects(label: string, architect: string): string[] {
  const out: string[] = []
  if (!architect.includes('Flag a step above the lowest rung that meets the acceptance criteria, and name that rung')) {
    out.push(`${label}: no flag for a step above the lowest rung`)
  }
  if (!architect.includes('Flag an option, layer or config key with no ask and no concrete case')) {
    out.push(`${label}: no flag for an option, layer or config key with no ask`)
  }
  if (!architect.includes('Never flag a trust-boundary, security, data-loss or fail-closed guard, or its test')) {
    out.push(`${label}: no never-flag clause for a trust-boundary, security, data-loss or fail-closed guard`)
  }
  return out
}

/** Lines that ask for the happy path, errors and edges of every change. */
const EVERY_CASE_ASKS: readonly RegExp[] = [
  /happy[- ]path.*\bedges?\b/i,
  /\berror (?:cases|conditions)\b.*\bedge cases?\b/i,
]

interface TextFile {
  readonly path: string
  readonly text: string
}

/** Named collector: the lines of a prompt that ask for the happy path, error cases and edge cases together. */
export function collectEveryCaseAskDefects(files: readonly TextFile[]): string[] {
  return files.flatMap(file =>
    file.text.split('\n').flatMap((line, i) =>
      EVERY_CASE_ASKS.some(re => re.test(line)) ? [`${file.path}:${i + 1}: ${line.trim().slice(0, 80)}`] : []))
}

/** Named collector: the rules that must stay, and the proportional rule that replaces the cover-everything line. */
export function collectKeptRuleDefects(tdd: string, code: string): string[] {
  const out: string[] = []
  if (!tdd.includes('**Tests first, always.**')) out.push('the TDD Iron Law is gone')
  if (!tdd.includes('### Step 1: RED')) out.push('the TDD RED step is gone')
  if (!code.includes('**Regression test rule**: A regression fix without a failing-then-passing regression test is INCOMPLETE')) {
    out.push('the bug-fix regression rule is gone')
  }
  if (!code.includes('Type everything.')) out.push('the typing rule is gone')
  for (const want of [
    'one failing test first for each acceptance-criterion behaviour',
    'an edge-case test only for a named, concrete case',
    'Always test trust boundaries, data loss, security and fail-closed paths',
  ]) {
    if (!code.toLowerCase().includes(want.toLowerCase())) out.push(`the Code agent does not say: ${want}`)
  }
  return out
}

/** Every .md and .mds file under src/assets. */
function promptFiles(dir: string): TextFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return promptFiles(full)
    return /\.mds?$/.test(entry.name) ? [{ path: path.relative(ROOT, full), text: readFileSync(full, 'utf-8') }] : []
  })
}

describe('the Architect flags a step above the lowest rung (AC4)', () => {
  const builds = [
    ['architect (curation on)', resolveAgentSource('architect').content],
    ['architect (curation off)', resolveCurationOffSource('agents', 'architect') ?? ''],
  ] as const

  it.each(builds)('%s carries the minimum lens', (label, body) => {
    expect(body.length, 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(2_000)
    expect(collectArchitectLensDefects(label, body)).toEqual([])
  })

  it('known-bad probes: a lost rung flag and a lost no-ask flag are each reported', () => {
    const body = builds[0][1]
    const lostRung = body.replace('Flag a step above the lowest rung', 'Flag a step')
    expect(lostRung, 'the seed must land').not.toBe(body)
    expect(collectArchitectLensDefects('a', lostRung)).toEqual(['a: no flag for a step above the lowest rung'])
    const lostAsk = body.replace('with no ask and no concrete case', 'with no reason')
    expect(lostAsk, 'the seed must land').not.toBe(body)
    expect(collectArchitectLensDefects('a', lostAsk)).toEqual(['a: no flag for an option, layer or config key with no ask'])
    const lostNeverFlag = body.replace('Never flag a trust-boundary, security, data-loss or fail-closed guard, or its test.', '')
    expect(lostNeverFlag, 'the seed must land').not.toBe(body)
    expect(collectArchitectLensDefects('a', lostNeverFlag)).toEqual(['a: no never-flag clause for a trust-boundary, security, data-loss or fail-closed guard'])
  })
})

describe('design review asks for a retry, compensation step or cache only with a concrete case (AC6)', () => {
  const skill = readAsset('skills', 'design-review', 'SKILL.md')

  it('rules 4 and 5 carry the condition, and rule 4 keeps error handling at a trust boundary or for data loss', () => {
    expect(designReviewRule(skill, 4), 'rule 4 is read').toContain('Error Handling Gaps')
    expect(designReviewRule(skill, 5), 'rule 5 is read').toContain('Missing Caching')
    expect(collectConcreteCaseDefects(skill)).toEqual([])
  })

  it('known-bad probes: a rule without the condition and a rule 4 without the carve-out are each reported', () => {
    const noFive = skill.replace('Only with a concrete case; else no finding.', 'Flag it.')
    expect(noFive, 'the seed must land').not.toBe(skill)
    expect(collectConcreteCaseDefects(noFive)).toEqual(['design-review rule 5 does not ask for a concrete case'])
    const noFour = skill.replace('Retry or compensation absent: a finding only with a concrete case.', 'Retry or compensation absent.')
    expect(noFour, 'the seed must land').not.toBe(skill)
    expect(collectConcreteCaseDefects(noFour)).toEqual(['design-review rule 4 does not ask for a concrete case'])
    const noCarveOut = skill.replace('Error handling at a trust boundary or for data loss needs no case.', '')
    expect(noCarveOut, 'the seed must land').not.toBe(skill)
    expect(collectConcreteCaseDefects(noCarveOut)).toEqual(['design-review rule 4 does not keep error handling at a trust boundary or for data loss'])
    const noDefinition = skill.replace('A concrete case is an external call in this change, a stated or measured hot path, or a repeated delivery.', '')
    expect(noDefinition, 'the seed must land').not.toBe(skill)
    expect(collectConcreteCaseDefects(noDefinition)).toEqual(['the skill does not define a concrete case'])
    const gatesAllOfFour = skill.replace('a repeated delivery.', 'a repeated delivery. Rules 4 and 5 need one.')
    expect(gatesAllOfFour, 'the seed must land').not.toBe(skill)
    expect(collectConcreteCaseDefects(gatesAllOfFour)).toEqual([
      'the intro gates all of rule 4 on a concrete case, not only its retry and compensation line',
    ])
  })
})

describe('the Review agent skips speculative asks and keeps the missing-bound finding (AC6)', () => {
  const builds = [
    ['review (curation on)', resolveAgentSource('review').content],
    ['review (curation off)', resolveCurationOffSource('agents', 'review') ?? ''],
  ] as const

  it.each(builds)('%s carries the rule', (label, body) => {
    expect(body.length, 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(5_000)
    expect(collectReviewDefects(label, body)).toEqual([])
  })

  it('reliability keeps its bound rule and performance keeps its unbounded-cache rule', () => {
    expect(readAsset('skills', 'reliability', 'SKILL.md')).toContain('every loop, retry and pagination terminates after a known maximum')
    expect(readAsset('skills', 'performance', 'SKILL.md')).toContain('**Unbounded caches**')
  })

  it('the patterns skill asks for idempotency only with a repeated delivery', () => {
    expect(readAsset('skills', 'patterns', 'SKILL.md')).toContain('idempotent only when the change has a repeated delivery')
  })

  it('known-bad probes: a lost rule and a lost missing-bound finding are each reported', () => {
    const body = builds[0][1]
    const lostRule = body.replace('do not ask for caching, retries, idempotency or compensation', 'ask for caching')
    expect(lostRule, 'the seed must land').not.toBe(body)
    expect(collectReviewDefects('r', lostRule)).toEqual(['r: no concrete-case rule for caching, retries, idempotency and compensation'])
    const lostBound = body.replace('A missing bound on an existing loop, retry or cache stays a finding.', '')
    expect(lostBound, 'the seed must land').not.toBe(body)
    expect(collectReviewDefects('r', lostBound)).toEqual(['r: a missing bound on an existing loop, retry or cache is no longer a finding'])
    const lostExemption = body.replace('A partial write that can lose data, a trust boundary and a fail-closed path need no case.', '')
    expect(lostExemption, 'the seed must land').not.toBe(body)
    expect(collectReviewDefects('r', lostExemption)).toEqual([
      'r: a partial write that can lose data, a trust boundary and a fail-closed path now need a concrete case',
    ])
  })
})

describe('no shipped prompt asks for the happy path, error cases and edge cases of every change (AC7)', () => {
  it('holds none of those lines in src/assets', () => {
    const files = promptFiles(ASSETS)
    expect(files.length, 'the prompts are read: the guard would pass vacuously on none').toBeGreaterThan(100)
    expect(collectEveryCaseAskDefects(files)).toEqual([])
  })

  it('known-bad probes: the old Code, testing and TDD lines are each reported, and the new lines pass', () => {
    const probe = (text: string): string[] => collectEveryCaseAskDefects([{ path: 'probe.md', text }])
    expect(probe('Cover the happy path, error cases and edge cases of new behaviour, in the existing test patterns.')).toHaveLength(1)
    expect(probe('- [ ] All branches covered: happy path + errors + edge cases')).toHaveLength(1)
    expect(probe('| Error conditions and edge cases | Framework internals |')).toHaveLength(1)
    expect(probe('New code tested? Covers happy path, errors, edges.')).toHaveLength(1)
    expect(probe('Add an edge-case test only for a named, concrete case.')).toEqual([])
    expect(probe('Happy path tests verify about 20% of behavior.')).toEqual([])
  })
})

describe('the proportional-test rule replaces the cover-everything line, and the Iron Law stays (AC7)', () => {
  const tdd = readAsset('skills', 'test-driven-development', 'SKILL.md')
  const builds = [
    ['code (curation on)', resolveAgentSource('code').content],
    ['code (curation off)', resolveCurationOffSource('agents', 'code') ?? ''],
  ] as const

  it.each(builds)('%s keeps the Iron Law, the RED step and the regression rule, and states the proportional rule', (label, code) => {
    expect(code.length, `${label}: the body is read`).toBeGreaterThan(5_000)
    expect(collectKeptRuleDefects(tdd, code)).toEqual([])
  })

  it('known-bad probes: each lost rule is reported', () => {
    const code = builds[0][1]
    expect(collectKeptRuleDefects(tdd.replace('**Tests first, always.**', ''), code)).toEqual(['the TDD Iron Law is gone'])
    expect(collectKeptRuleDefects(tdd.replace('### Step 1: RED', '### Step 1'), code)).toEqual(['the TDD RED step is gone'])
    expect(collectKeptRuleDefects(tdd, code.replace('**Regression test rule**', '**Rule**'))).toEqual(['the bug-fix regression rule is gone'])
    expect(collectKeptRuleDefects(tdd, code.replace('Type everything.', ''))).toEqual(['the typing rule is gone'])
    expect(collectKeptRuleDefects(tdd, code.replace('an edge-case test only for a named, concrete case', 'edge cases'))).toEqual([
      'the Code agent does not say: an edge-case test only for a named, concrete case',
    ])
  })
})

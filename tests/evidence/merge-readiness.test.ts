/**
 * tests/evidence/merge-readiness.test.ts
 *
 * SDLC-evidence PR4 (#363) phase P5, and #352: the two PR-host classifiers a merge
 * decision rests on, held against their own declared output domains (PF-075).
 *
 *   #352   check-ci-status reads CI through a field gh actually has. The frozen
 *          steps asked `gh pr checks --json` for `conclusion`, which gh 2.88.1
 *          refuses (`Unknown JSON field`, exit 1), so step 4 read NO_CI on every
 *          PR. Held here: every `--json` field is one gh documents; no step names
 *          `conclusion`; exit 8 (checks pending) is a result; the fetch keeps its
 *          stderr, so "no checks reported" can be told from a failure; step 5 is a
 *          TOTAL classifier over `bucket` whose last arm is INDETERMINATE and whose
 *          PASSING arm is a positive conjunction; and steps 2, 4 and 5 between them
 *          produce exactly the Output enum git.md declares. Step 5 is EXECUTED: a
 *          small interpreter reads its clauses and runs them over every bucket
 *          multiset up to three checks, an undocumented bucket included.
 *   PF-075 Both ci-status-gate blocks (/implement Phase 9, /resolve Phase 8) name
 *          an arm for every status the op can return.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector (PF-064); the probes are the 660edc1 text.
 *
 * NOT covered: gh's behaviour itself. The JSON field list and the bucket
 * vocabulary are transcribed from `gh pr checks --help` (gh 2.88.1); a gh release
 * that renames a field is caught only when this list is re-probed.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { extractOpSectionFromCorpus, prHostRel, requireDistFile, resolveAgentSource } from '../helpers.js'

/** `gh pr checks --help`, gh 2.88.1: the JSON FIELDS section. */
const GH_PR_CHECKS_FIELDS: readonly string[] = [
  'bucket', 'completedAt', 'description', 'event', 'link', 'name', 'startedAt', 'state', 'workflow',
]
/** `gh pr checks --help`, gh 2.88.1: "categorizes the `state` field into pass, fail, pending, skipping, or cancel". */
const GH_BUCKETS: readonly string[] = ['pass', 'fail', 'pending', 'skipping', 'cancel']
/** A bucket gh does not document today — the classifier must still answer. */
const UNDOCUMENTED_BUCKET = 'neutral'

/** The 660edc1 steps 3–5 (fixture lines 143–145 before the D1 re-capture). */
const STEPS_660EDC1 = [
  '3. Fetch checks: `gh pr checks {number} --json name,state,conclusion 2>/dev/null`',
  '4. If empty or command fails → output status `NO_CI`',
  '5. Classify in priority order: if any check has state `IN_PROGRESS` or `PENDING` → `PENDING`; else if any conclusion is `FAILURE` → `FAILING`; else if all conclusions are `SUCCESS` → `PASSING`',
] as const

function requirePrRef(op: string): string {
  const file = path.join(compiledSkillRefsDir(), ...prHostRel(op).split('/'))
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`${prHostRel(op)} is absent — run \`npm run build\` first (this suite reads the built reference)`)
  }
}

/** An op's own section of the compiled agent — 'sole': git.md is the one contract authority. */
function contractSection(op: string): string {
  const git = resolveAgentSource('git')
  return extractOpSectionFromCorpus([{ path: git.path, content: git.content }], op, { mode: 'sole' }).content
}

/** The `**Status**:` enum an op's Output template declares. */
function declaredStatuses(op: string): string[] {
  const line = contractSection(op).split('\n').find(l => l.startsWith('**Status**: '))
  return line === undefined ? [] : line.slice('**Status**: '.length).split(' | ').map(s => s.trim())
}

/** The numbered Process steps of a reference, by number. */
function processSteps(ref: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const line of ref.split('\n')) {
    const m = /^(\d+)\. /.exec(line)
    if (m !== null && !out.has(Number(m[1]))) out.set(Number(m[1]), line)
  }
  return out
}

// ---------------------------------------------------------------------------
// check-ci-status step 5 — an interpreter for its clauses
// ---------------------------------------------------------------------------

type Clause =
  | { readonly kind: 'any'; readonly buckets: readonly string[]; readonly status: string }
  | { readonly kind: 'every'; readonly allowed: readonly string[]; readonly required: string; readonly status: string }
  | { readonly kind: 'else'; readonly status: string }

const TICKED = /`([a-z]+)`/g
const ticked = (text: string): string[] => [...text.matchAll(TICKED)].map(m => m[1])

/** Parse step 5's clauses; an unparseable clause is returned as a string. */
function parseClassifier(step5: string): Array<Clause | string> {
  const colon = step5.indexOf(': ')
  if (colon === -1 || !/\bby `bucket`/.test(step5.slice(0, colon))) return ['step 5 does not classify by `bucket`']
  return step5.slice(colon + 2).split('; ').map(raw => {
    const text = raw.trim()
    let m = /^(?:else )?any ((?:`[a-z]+`(?: or |, )?)+) → `([A-Z_]+)`$/.exec(text)
    if (m !== null) return { kind: 'any', buckets: ticked(m[1]), status: m[2] }
    m = /^else every check ((?:`[a-z]+`(?: or |, )?)+) with at least one `([a-z]+)` → `([A-Z_]+)`$/.exec(text)
    if (m !== null) return { kind: 'every', allowed: ticked(m[1]), required: m[2], status: m[3] }
    m = /^else → `([A-Z_]+)`$/.exec(text)
    if (m !== null) return { kind: 'else', status: m[1] }
    return `unparseable clause: ${text}`
  })
}

/** Run the clauses, first match wins; null when none matches. */
function classify(clauses: readonly Clause[], buckets: readonly string[]): { status: string; kind: Clause['kind'] } | null {
  for (const c of clauses) {
    if (c.kind === 'any' && buckets.some(b => c.buckets.includes(b))) return { status: c.status, kind: c.kind }
    if (c.kind === 'every' && buckets.every(b => c.allowed.includes(b)) && buckets.includes(c.required)) return { status: c.status, kind: c.kind }
    if (c.kind === 'else') return { status: c.status, kind: c.kind }
  }
  return null
}

/** Every bucket multiset of 1–3 checks, over gh's buckets plus one it does not document. */
function bucketDomain(): string[][] {
  const alphabet = [...GH_BUCKETS, UNDOCUMENTED_BUCKET]
  const out: string[][] = []
  const grow = (prefix: string[], from: number): void => {
    if (prefix.length > 0) out.push(prefix)
    if (prefix.length === 3) return
    for (let i = from; i < alphabet.length; i++) grow([...prefix, alphabet[i]], i)
  }
  grow([], 0)
  return out
}

/**
 * Named collector: what makes check-ci-status's Process wrong for its own
 * contract — a `--json` field gh lacks, a step naming `conclusion`, a swallowed
 * stderr or an unaccepted exit 8, step 5 not total over `bucket`, PASSING reached
 * by anything but its conjunction, a documented bucket no arm names, or a status
 * set that is not the declared Output enum.
 */
function collectCiClassifierDefects(ref: string, declared: readonly string[]): string[] {
  const steps = processSteps(ref)
  const out: string[] = []
  const step3 = steps.get(3) ?? ''
  const fields = /--json ([A-Za-z,]+)/.exec(step3)?.[1].split(',') ?? []
  if (fields.length === 0) out.push('step 3 requests no JSON fields')
  for (const f of fields) if (!GH_PR_CHECKS_FIELDS.includes(f)) out.push(`step 3 requests \`${f}\`, which gh pr checks --json does not have`)
  if (!fields.includes('bucket')) out.push('step 3 does not request `bucket`')
  if (/2>\/dev\/null/.test(step3)) out.push('step 3 discards stderr, so "no checks reported" cannot be told from a failure')
  if (!/\b8 \(checks pending\)/.test(step3)) out.push('step 3 does not accept exit 8 (checks pending) as a result')
  for (const [n, line] of steps) if (/conclusion/i.test(line)) out.push(`step ${n} names \`conclusion\``)

  const parsed = parseClassifier(steps.get(5) ?? '')
  const clauses = parsed.filter((c): c is Clause => typeof c !== 'string')
  out.push(...parsed.filter((c): c is string => typeof c === 'string'))
  if (clauses.length > 0) {
    if (clauses[clauses.length - 1].kind !== 'else') out.push('step 5 has no terminal `else` arm')
    const named = new Set(clauses.flatMap(c => (c.kind === 'any' ? c.buckets : c.kind === 'every' ? [...c.allowed, c.required] : [])))
    for (const b of GH_BUCKETS) if (!named.has(b)) out.push(`no arm names the documented bucket \`${b}\``)
    for (const b of named) if (!GH_BUCKETS.includes(b)) out.push(`an arm names \`${b}\`, which gh does not document`)
    for (const buckets of bucketDomain()) {
      const r = classify(clauses, buckets)
      if (r === null) out.push(`[${buckets.join(', ')}] matches no arm`)
      else if (r.status === 'PASSING' && r.kind !== 'every') out.push(`[${buckets.join(', ')}] reaches PASSING by exhaustion`)
    }
  }

  const produced = new Set<string>()
  for (const n of [2, 4, 5]) for (const m of (steps.get(n) ?? '').matchAll(/(?:→|output status) (?:output status )?`([A-Z_]+)`/g)) produced.add(m[1])
  const want = [...declared].sort().join(', ')
  const got = [...produced].sort().join(', ')
  if (want !== got) out.push(`steps 2, 4 and 5 produce [${got}], the Output enum declares [${want}]`)
  return out
}

describe('#352: check-ci-status reads CI through fields gh has, and classifies totally', () => {
  it('the Output enum is the six statuses, and the Process has its six steps', () => {
    expect(declaredStatuses('check-ci-status')).toEqual(['PASSING', 'FAILING', 'PENDING', 'NO_CI', 'NO_PR', 'INDETERMINATE'])
    expect([...processSteps(requirePrRef('check-ci-status')).keys()]).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('no defect: fields, stderr, exit 8, a total bucket classifier and the declared status set', () => {
    expect(bucketDomain().length, 'the bucket domain is empty').toBeGreaterThanOrEqual(80)
    expect(collectCiClassifierDefects(requirePrRef('check-ci-status'), declaredStatuses('check-ci-status'))).toEqual([])
  })

  it('step 5, executed, decides the rows a merge decision turns on', () => {
    const parsed = parseClassifier(processSteps(requirePrRef('check-ci-status')).get(5) ?? '')
    const clauses = parsed.filter((c): c is Clause => typeof c !== 'string')
    expect(clauses.length, 'no clause parsed — the interpreter is blind').toBe(4)
    const rows: ReadonlyArray<readonly [readonly string[], string]> = [
      [['pass'], 'PASSING'],
      [['pass', 'skipping'], 'PASSING'],
      [['skipping'], 'INDETERMINATE'],
      [['pass', 'pending'], 'PENDING'],
      [['fail', 'pending'], 'PENDING'],
      [['pass', 'fail'], 'FAILING'],
      [['pass', 'cancel'], 'FAILING'],
      [['pass', UNDOCUMENTED_BUCKET], 'INDETERMINATE'],
      [[UNDOCUMENTED_BUCKET], 'INDETERMINATE'],
    ]
    for (const [buckets, want] of rows) expect(classify(clauses, buckets)?.status, buckets.join(',')).toBe(want)
  })

  it('known-bad probe: the 660edc1 steps are reported on every count', () => {
    const live = requirePrRef('check-ci-status')
    const old = live.split('\n').map(l => (l.startsWith('3. ') ? STEPS_660EDC1[0] : l.startsWith('4. ') ? STEPS_660EDC1[1] : l.startsWith('5. ') ? STEPS_660EDC1[2] : l)).join('\n')
    expect(old, 'the seed must land').not.toBe(live)
    const defects = collectCiClassifierDefects(old, declaredStatuses('check-ci-status'))
    expect(defects).toEqual(expect.arrayContaining([
      'step 3 requests `conclusion`, which gh pr checks --json does not have',
      'step 3 does not request `bucket`',
      'step 3 discards stderr, so "no checks reported" cannot be told from a failure',
      'step 3 does not accept exit 8 (checks pending) as a result',
      'step 3 names `conclusion`',
      'step 5 names `conclusion`',
      'step 5 does not classify by `bucket`',
      'steps 2, 4 and 5 produce [FAILING, NO_CI, NO_PR, PASSING, PENDING], the Output enum declares [FAILING, INDETERMINATE, NO_CI, NO_PR, PASSING, PENDING]',
    ]))
  })

  it('known-bad probes: a permissive terminal arm, a dropped bucket and a stray field are each reported', () => {
    const live = requirePrRef('check-ci-status')
    const declared = declaredStatuses('check-ci-status')
    const permissive = live.replace('; else → `INDETERMINATE`', '; else → `PASSING`')
    expect(permissive, 'the seed must land').not.toBe(live)
    expect(collectCiClassifierDefects(permissive, declared).some(d => d.endsWith('reaches PASSING by exhaustion'))).toBe(true)
    const noCancel = live.replace('any `fail` or `cancel`', 'any `fail`')
    expect(noCancel, 'the seed must land').not.toBe(live)
    expect(collectCiClassifierDefects(noCancel, declared)).toContain('no arm names the documented bucket `cancel`')
    const stray = live.replace('--json name,state,bucket', '--json name,state,bucket,conclusion')
    expect(stray, 'the seed must land').not.toBe(live)
    expect(collectCiClassifierDefects(stray, declared)).toContain('step 3 requests `conclusion`, which gh pr checks --json does not have')
  })
})

// ---------------------------------------------------------------------------
// The ci-status-gate blocks: an arm for every status the op returns (PF-075)
// ---------------------------------------------------------------------------

const GATE_OPEN = '<!-- PATTERN: ci-status-gate'
const GATE_CLOSE = '<!-- /PATTERN: ci-status-gate -->'

/** The ci-status-gate block of a compiled command. */
function gateBlock(content: string): string {
  const at = content.indexOf(GATE_OPEN)
  const end = content.indexOf(GATE_CLOSE, at)
  return at === -1 || end === -1 ? '' : content.slice(at, end)
}

/** Named collector: the statuses a gate block names no `**If …**` arm for. */
function collectUnhandledCiStatuses(block: string, statuses: readonly string[]): string[] {
  const handled = new Set([...block.matchAll(/\*\*If ([A-Z_]+(?: or [A-Z_]+)*)\*\*/g)].flatMap(m => m[1].split(' or ')))
  return statuses.filter(s => !handled.has(s))
}

describe('PF-075: each ci-status-gate block has an arm for every status check-ci-status returns', () => {
  const hosts = ['implement.md', 'resolve.md'] as const

  it('both blocks name all six statuses', () => {
    const statuses = declaredStatuses('check-ci-status')
    expect(statuses.length, 'no Output enum parsed').toBe(6)
    for (const host of hosts) {
      const block = gateBlock(requireDistFile(host))
      expect(block.length, `${host}: no ci-status-gate block`).toBeGreaterThan(200)
      expect(collectUnhandledCiStatuses(block, statuses), host).toEqual([])
      expect(block, `${host}: an INDETERMINATE CI status is never a pass`).toContain('CI status unknown — verify manually before merging')
    }
  })

  it('known-bad probe: the pre-#352 block, without an INDETERMINATE arm, is reported', () => {
    const block = gateBlock(requireDistFile('implement.md'))
    const old = block.split('\n').filter(l => !l.includes('**If INDETERMINATE**')).join('\n')
    expect(old, 'the seed must land').not.toBe(block)
    expect(collectUnhandledCiStatuses(old, declaredStatuses('check-ci-status'))).toEqual(['INDETERMINATE'])
  })
})

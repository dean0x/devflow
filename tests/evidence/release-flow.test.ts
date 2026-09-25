/**
 * tests/evidence/release-flow.test.ts
 *
 * /release's traceability flow (SDLC-evidence PR5, #364, phase P2), read out of
 * the built command and agent rather than restated here.
 *
 *   AC-7  The Phase 5 classifier is TOTAL over the gather outcomes: every value
 *         of the status domain git.md DECLARES × every TRACE-header state × an
 *         untraced count of zero or more lands on at least one arm, on exactly
 *         one when the header is sound and nothing is untraced, and every unknown
 *         — a status outside the declared five included — lands on arm 1
 *         (PF-075: a gate that reaches its permissive verdict by exhaustion fails
 *         open). A `--dry-run` never asks and leaves no checkpoint to resume.
 *   AC-8  `## Traceability exceptions` renders with `evidence_exception()`'s
 *         login, time and reason rules copied BYTE-IDENTICALLY (the
 *         partial-wiring precedent for release.md, which is hand-authored and
 *         imports nothing); it is persisted in the checkpoint; create-release
 *         appends it last, where the notes cap never drops it; and with nothing
 *         asked, exempt commits still reach it (D3).
 *
 * The classifier is not re-implemented from memory: its arms are parsed from
 * release.md and its status domain from git.md, so either file drifting moves
 * the model with it — and the known-bad probes drive the same parser with a
 * seeded arm deleted (PF-018, PF-064).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, requireDistFile, resolveAgentSource } from '../helpers.js'

const release = (): string => requireDistFile('release.md')
const gitMd = (): string => resolveAgentSource('git').content

/** git.md's section for one operation, from its heading to the next operation's. */
function opSection(git: string, op: string): string {
  const start = git.indexOf(`## Operation: ${op}`)
  if (start === -1) throw new Error(`git.md: no ${op} operation`)
  const next = git.indexOf('\n## Operation:', start + 1)
  return next === -1 ? git.slice(start) : git.slice(start, next)
}

// ---------------------------------------------------------------------------
// AC-7 — the classifier, parsed
// ---------------------------------------------------------------------------

/** The gather Output's declared status keywords, in order (READY, PARTIAL, …). */
export function collectDeclaredStatuses(git: string): string[] {
  const line = opSection(git, 'gather-release-evidence').split('\n').find(l => l.startsWith('### Status: '))
  if (line === undefined) return []
  return line.slice('### Status: '.length).split(' | ').map(v => v.split(' ')[0])
}

/** Header states a gather can hand /release. Only `ok` carries a trustworthy count. */
const HEADER_STATES = ['ok', 'absent', 'sum-mismatch', 'bound:hit'] as const
type HeaderState = (typeof HEADER_STATES)[number]

/** How arm 1 must spell each unknown-coverage header state. */
const HEADER_PHRASES: Readonly<Record<Exclude<HeaderState, 'ok'>, RegExp>> = {
  absent: /no `TRACE` line/,
  'sum-mismatch': /the sum does not hold/,
  'bound:hit': /`bound:hit`/,
}

/**
 * Arm 1's catch-all for a status outside the declared domain. The gather is prose
 * an agent executes, so a value nobody declared (its own fallback's `THROTTLED`, a
 * habitual `COMPLETE`) can still arrive — and without this clause it would match no
 * arm, and /release would reach its confirm without asking (PF-075).
 */
const UNDECLARED_PHRASE = /a status that is none of the five/

/** A status outside the declared domain that a drifted gather could emit. */
const UNDECLARED_STATUS = 'THROTTLED'

interface Classifier {
  /** The four numbered arm lines, by label. */
  readonly arms: ReadonlyArray<{ readonly label: string; readonly line: string }>
  classify(status: string, header: HeaderState, untraced: number): string[]
}

/** The numbered arm lines under the `**Traceability**` step, up to the ask. */
export function collectArmLines(text: string): Array<{ label: string; line: string }> {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.startsWith('**Traceability**'))
  if (start === -1) return []
  const out: Array<{ label: string; line: string }> = []
  for (let i = start + 1; i < lines.length && !lines[i].startsWith('Arm '); i++) {
    const m = lines[i].match(/^\d\. \*\*([^*]+)\*\* — /)
    if (m) out.push({ label: m[1], line: lines[i] })
  }
  return out
}

/**
 * Named collector: the classifier release.md states, as a model. Each arm's
 * statuses are the declared values it names in backticks; arm 1's header states
 * are the ones it names, and it takes an undeclared status only when it carries
 * UNDECLARED_PHRASE; arm 2 fires on a positive count it can read; the clean arm
 * needs zero untraced and, when it says so, no arm above.
 */
export function parseClassifier(text: string, domain: readonly string[]): Classifier {
  const arms = collectArmLines(text)
  const find = (label: string): string => arms.find(a => a.label === label)?.line ?? ''
  const named = (line: string): string[] => domain.filter(s => line.includes(`\`${s}\``))
  const unknown = find('Coverage unknown')
  const untracedArm = find('Untraced')
  const partial = find('Partial')
  const clean = find('Clean')
  const unknownHeaders = (Object.keys(HEADER_PHRASES) as Array<Exclude<HeaderState, 'ok'>>)
    .filter(h => HEADER_PHRASES[h].test(unknown))
  const takesUndeclared = UNDECLARED_PHRASE.test(unknown)
  return {
    arms,
    classify(status, header, untraced) {
      const hit: string[] = []
      const readable = header === 'ok' || header === 'bound:hit' || header === 'sum-mismatch'
      const undeclared = takesUndeclared && !domain.includes(status)
      if ((header !== 'ok' && unknownHeaders.includes(header)) || named(unknown).includes(status) || undeclared) hit.push('Coverage unknown')
      if (/\*u\* > 0/.test(untracedArm) && readable && untraced > 0) hit.push('Untraced')
      if (named(partial).includes(status)) hit.push('Partial')
      const noneAbove = /no arm above/.test(clean) ? hit.length === 0 : true
      if (named(clean).includes(status) && /\*u\* = 0/.test(clean) && untraced === 0 && noneAbove) hit.push('Clean')
      return hit
    },
  }
}

/**
 * Named collector: every classifier gap over the full outcome grid, as report
 * lines. The grid is the declared domain plus UNDECLARED_STATUS, which must land
 * on arm 1 like any other unknown.
 */
export function collectClassifierGaps(model: Classifier, domain: readonly string[]): string[] {
  const gaps: string[] = []
  for (const status of new Set([...domain, UNDECLARED_STATUS])) {
    const declared = domain.includes(status)
    for (const header of HEADER_STATES) {
      for (const untraced of [0, 3]) {
        const hit = model.classify(status, header, untraced)
        const at = `${status} × ${header} × u=${untraced}`
        if (hit.length === 0) gaps.push(`${at}: no arm`)
        if (header === 'ok' && untraced === 0 && hit.length > 1) gaps.push(`${at}: ${hit.join(' + ')} (must be exactly one)`)
        if ((header !== 'ok' || status === 'INDETERMINATE' || !declared) && !hit.includes('Coverage unknown')) gaps.push(`${at}: unknown coverage misses arm 1`)
        if (hit.includes('Clean') && (header !== 'ok' || untraced > 0 || status !== 'READY')) gaps.push(`${at}: Clean without a sound, fully traced READY`)
      }
    }
  }
  return gaps
}

describe('AC-7: the Phase 5 classifier is total over the declared gather outcomes', () => {
  const domain = collectDeclaredStatuses(gitMd())

  it('reads the five-value domain from git.md and the four arms from release.md', () => {
    expect(domain).toEqual(['READY', 'PARTIAL', 'TRUNCATED', 'DEGRADED', 'INDETERMINATE'])
    expect(collectArmLines(release()).map(a => a.label)).toEqual(['Coverage unknown', 'Untraced', 'Partial', 'Clean'])
  })

  it('every outcome lands on an arm, exactly one when sound and fully traced, and unknown ⇒ arm 1', () => {
    expect(collectClassifierGaps(parseClassifier(release(), domain), domain)).toEqual([])
  })

  it('arms 1 and 2 ask, arm 3 only warns, and the ask has exactly two outcomes', () => {
    const text = release()
    const lines = text.split('\n')
    expect(collectArmLines(text).find(a => a.label === 'Partial')?.line).toContain('never blocks on its own')
    const ask = lines.findIndex(l => l.startsWith('Arm 1 or 2 ⇒ ask once, via AskUserQuestion'))
    expect(ask, 'the ask line').toBeGreaterThan(-1)
    expect(lines[ask]).toContain('with exactly two options')
    expect(lines[ask + 1]).toMatch(/^- \*\*Record\*\* — .*ask once more, then halt/)
    expect(lines[ask + 2]).toMatch(/^- \*\*Halt\*\* — stop now: nothing has been committed, tagged or published\.$/)
    expect(lines[ask + 1]).toContain('`.release/.progress.json`')
  })

  it('a dry run gathers, reports the arms and never asks: it halts before the ask exists', () => {
    const lines = release().split('\n')
    const gather = lines.findIndex(l => l.startsWith('**Gather release evidence**'))
    const dryRun = lines.findIndex((l, i) => i > gather && l.startsWith('`--dry-run`:'))
    const traceability = lines.findIndex(l => l.startsWith('**Traceability**'))
    const ask = lines.findIndex(l => l.includes('AskUserQuestion') && l.startsWith('Arm 1 or 2'))
    expect(gather).toBeGreaterThan(-1)
    expect(gather < dryRun && dryRun < traceability && traceability < ask, 'gather → dry-run halt → classify → ask').toBe(true)
    expect(collectDryRunAsks(lines[dryRun])).toEqual([])
    expect(lines[dryRun]).toContain('traceability arms')
  })

  it('known-bad probes: a status dropped from an arm, and bound:hit dropped from arm 1, are reported', () => {
    const text = release()
    const noTruncated = text.replace('`PARTIAL`, `TRUNCATED` or `DEGRADED`: warn', '`PARTIAL` or `DEGRADED`: warn')
    expect(noTruncated, 'the seed must land').not.toBe(text)
    expect(collectClassifierGaps(parseClassifier(noTruncated, domain), domain)).toContain('TRUNCATED × ok × u=0: no arm')
    const noBound = text.replace('the sum does not hold, `bound:hit`, status', 'the sum does not hold, status')
    expect(noBound, 'the seed must land').not.toBe(text)
    expect(collectClassifierGaps(parseClassifier(noBound, domain), domain)).toContain('READY × bound:hit × u=0: unknown coverage misses arm 1')
    // …and a sixth declared status nobody classifies is a gap, not a pass: the
    // catch-all is for values nobody declared, never a substitute for an arm.
    expect(collectClassifierGaps(parseClassifier(text, [...domain, 'COMPLETE']), [...domain, 'COMPLETE'])).toContain('COMPLETE × ok × u=0: no arm')
  })

  it('known-bad probe: without arm 1\'s catch-all, an undeclared status lands on no arm and /release proceeds unasked', () => {
    const text = release()
    expect(collectArmLines(text).find(a => a.label === 'Coverage unknown')?.line).toMatch(UNDECLARED_PHRASE)
    const noCatchAll = text.replace(', or a status that is none of the five.', '.')
    expect(noCatchAll, 'the seed must land').not.toBe(text)
    const gaps = collectClassifierGaps(parseClassifier(noCatchAll, domain), domain)
    expect(gaps).toContain(`${UNDECLARED_STATUS} × ok × u=0: no arm`)
    expect(gaps).toContain(`${UNDECLARED_STATUS} × ok × u=0: unknown coverage misses arm 1`)
  })
})

/** Named collector: the ways a `--dry-run` line could ask — naming the ask tool, or not saying it never asks. */
export function collectDryRunAsks(line: string): string[] {
  const out: string[] = []
  if (/AskUserQuestion/.test(line)) out.push('names AskUserQuestion')
  if (!/never ask/.test(line)) out.push('does not say it never asks')
  if (!/halt after this phase/.test(line)) out.push('does not halt after Phase 4')
  return out
}

describe('AC-7: known-bad probe — a dry run that asks is reported', () => {
  it('the collector reports an asking dry run and clears the shipped one', () => {
    expect(collectDryRunAsks('`--dry-run`: report the arms and ask via AskUserQuestion, then **halt after this phase**.'))
      .toEqual(['names AskUserQuestion', 'does not say it never asks'])
  })
})

/**
 * Named collector: Phase 4 lines that write the resume checkpoint without
 * excluding a dry run. A dry run's checkpoint is offered as an interrupted release
 * on the next run, and a Resume reuses the evidence traced at the dry run's HEAD:
 * a commit landed since would be neither traced nor listed.
 */
export function collectDryRunCheckpointWrites(text: string): string[] {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.startsWith('### Phase 4'))
  const end = lines.findIndex((l, i) => i > start && l.startsWith('### Phase 5'))
  if (start === -1 || end === -1) return ['Phase 4 not found']
  return lines.slice(start, end)
    .filter(l => l.includes('`.release/.progress.json`') && /\bwrite\b/i.test(l) && !l.includes('Unless `DRY_RUN` is true'))
}

describe('AC-7: a dry run leaves no checkpoint to resume', () => {
  it('Phase 4 writes the checkpoint only on a real release', () => {
    const text = release()
    expect(text, 'the checkpoint line must exist, or this arm clears nothing').toContain(
      'Unless `DRY_RUN` is true, write `.release/.progress.json` checkpoint',
    )
    expect(collectDryRunCheckpointWrites(text)).toEqual([])
  })

  it('known-bad probe: an unconditional checkpoint write in Phase 4 is reported', () => {
    const seeded = '### Phase 4\nWrite `.release/.progress.json` checkpoint, with RELEASE_EVIDENCE when it was gathered.\n### Phase 5'
    expect(collectDryRunCheckpointWrites(seeded)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// AC-8 — the exceptions block, its rendering rules and its sink
// ---------------------------------------------------------------------------

const PARTIAL_SOURCE = path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_evidence_policy.mds')

/** The three rendering bullets of `evidence_exception()`, braces unescaped as the compiler emits them. */
function renderingBullets(): string[] {
  const lines = readFileSync(PARTIAL_SOURCE, 'utf-8').split('\n')
  const start = lines.indexOf('@define evidence_exception():')
  const end = lines.indexOf('@end', start + 1)
  if (start === -1 || end === -1) throw new Error('_evidence_policy.mds: no evidence_exception() define')
  return lines.slice(start + 1, end)
    .filter(l => l.startsWith('- `@<login>`') || l.startsWith('- `<utc>`') || l.startsWith('- `<reason>`'))
    .map(l => l.replace(/\\([{}])/g, '$1'))
}

/** Named collector: each bullet a text does not hold exactly once. */
export function collectRenderingDrift(text: string, bullets: readonly string[]): string[] {
  return bullets
    .map(b => ({ b, n: text.split('\n').filter(l => l === b).length }))
    .filter(({ n }) => n !== 1)
    .map(({ b, n }) => `${b.slice(0, 40)}… held ${n} times (expected 1)`)
}

/**
 * The Phase 5 rule for a trace that asks nothing yet lists exempt commits (arms 3
 * and 4 only). Both exemption fields are self-asserted, so the D3 mitigation is
 * that exempt SHAs reach the release notes — on every path, not only on Record.
 */
const NO_ASK_EXEMPT_RULE = 'No ask, but the trace lists an exempt commit ⇒'

/** Named collector: what the no-ask exempt rule owes and does not state. */
export function collectHiddenExemptions(text: string): string[] {
  const line = text.split('\n').find(l => l.startsWith(NO_ASK_EXEMPT_RULE))
  if (line === undefined) return ['no-ask exempt rule missing']
  return ['`TRACEABILITY_EXCEPTIONS`', 'the `Exempt` line', '`.release/.progress.json`', 'never hidden']
    .filter(term => !line.includes(term))
    .map(term => `no-ask exempt rule omits ${term}`)
}

/** The fenced `## Traceability exceptions` template in release.md, line by line. */
function exceptionsTemplate(text: string): string[] {
  const lines = text.split('\n')
  const start = lines.indexOf('## Traceability exceptions')
  if (start === -1) return []
  const end = lines.indexOf('```', start)
  return lines.slice(start, end === -1 ? lines.length : end)
}

describe('AC-8: `## Traceability exceptions` — rendering, persistence and sink', () => {
  it('the three rendering bullets are copied byte-identically (the adopter proves the unescape model)', () => {
    const bullets = renderingBullets()
    expect(bullets, 'the login, time and reason bullets').toHaveLength(3)
    expect(collectRenderingDrift(requireDistFile('implement.md'), bullets), 'the compiled adopter').toEqual([])
    expect(collectRenderingDrift(release(), bullets), 'release.md, hand-kept').toEqual([])
  })

  it('the block has two closed kinds, four coverage causes, the exempt line and no subject', () => {
    const template = exceptionsTemplate(release())
    expect(template[0]).toBe('## Traceability exceptions')
    expect(template.slice(1).map(l => l.match(/^- `([a-z]+)`/)?.[1] ?? l.split(' ')[0])).toEqual(['untraced', 'coverage', 'Exempt'])
    expect(template[1]).toBe('- `untraced` <sha12> (<author>) self-attested by @<login> at <utc>: <reason>')
    const causes = template[2].match(/<([a-z|-]+)>/)?.[1].split('|')
    expect(causes).toEqual(['bound-hit', 'trace-unavailable', 'gather-indeterminate', 'untraced-beyond-list'])
    const mapping = release().split('\n').find(l => l.startsWith('- One `untraced` line per listed untraced commit'))
    for (const cause of causes!) expect(mapping, `${cause} must be mapped`).toContain(`\`${cause}\``)
    expect(release()).toContain('no commit subject is ever written into it')
    expect(template.join('\n')).not.toMatch(/<subject>/)
  })

  it('it is checkpointed, and passed to create-release only as TRACEABILITY_EXCEPTIONS', () => {
    const text = release()
    const step4 = text.split('\n').find(l => l.startsWith('4. **Tag and GitHub Release**'))
    expect(step4).toContain('`TRACEABILITY_EXCEPTIONS` when recorded')
    expect(text).toContain('Compose `TRACEABILITY_EXCEPTIONS` below and add it to `.release/.progress.json`.')
  })

  it('with nothing asked, an exempt commit is still printed (D3: exempt SHAs are printed, never hidden)', () => {
    const text = release()
    expect(collectHiddenExemptions(text)).toEqual([])
    const lines = text.split('\n')
    const rule = lines.findIndex(l => l.startsWith(NO_ASK_EXEMPT_RULE))
    const traceability = lines.findIndex(l => l.startsWith('**Traceability**'))
    const confirm = lines.findIndex(l => l.startsWith('Confirm with user via AskUserQuestion'))
    expect(traceability < rule && rule < confirm, 'the rule sits in Phase 5, before the confirm').toBe(true)
  })

  it('known-bad probe: a release.md with no no-ask exempt rule, or one that drops the notes, is reported', () => {
    const text = release()
    const line = text.split('\n').find(l => l.startsWith(NO_ASK_EXEMPT_RULE))!
    expect(collectHiddenExemptions(text.replace(line, ''))).toEqual(['no-ask exempt rule missing'])
    expect(collectHiddenExemptions(text.replace(line, line.replace('`TRACEABILITY_EXCEPTIONS`', 'the report'))))
      .toEqual(['no-ask exempt rule omits `TRACEABILITY_EXCEPTIONS`'])
  })

  it('known-bad probe: a one-character drift in release.md\'s reason bullet is reported', () => {
    const bullets = renderingBullets()
    const drifted = release().replace('keep the first 200 characters', 'keep the first 300 characters')
    expect(drifted, 'the seed must land').not.toBe(release())
    expect(collectRenderingDrift(drifted, bullets)).toHaveLength(1)
  })
})

/** The create-release step-5 bullets that must appear in this order. */
const NOTES_ORDER: readonly string[] = [
  '   - Start with `CHANGELOG_CONTENT`',
  '   - If `COMMIT_LIST` provided:',
  '   - If `TRACEABILITY_EXCEPTIONS` provided: append it verbatim, last; the cap below never drops it',
  '   - Cap the composed body at 60000 characters',
]

/** Named collector: order defects among create-release's step-5 bullets. */
export function collectNotesOrderDefects(section: string): string[] {
  const lines = section.split('\n')
  const at = NOTES_ORDER.map(prefix => lines.findIndex(l => l.startsWith(prefix)))
  const defects = NOTES_ORDER.filter((_, i) => at[i] === -1).map(p => `missing: ${p.trim()}`)
  for (let i = 1; i < at.length; i++) {
    if (at[i] !== -1 && at[i - 1] !== -1 && at[i] !== at[i - 1] + 1) defects.push(`not adjacent after: ${NOTES_ORDER[i - 1].trim()}`)
  }
  return defects
}

describe('AC-8: create-release appends the exceptions last, where the cap never drops them', () => {
  const section = opSection(gitMd(), 'create-release')

  it('declares the optional input', () => {
    expect(section.split('\n').find(l => l.startsWith('**Input:**'))).toContain('`TRACEABILITY_EXCEPTIONS` (optional)')
  })

  it('the bullet sits between the commit list and the cap, and the cap drops only `## Commits`', () => {
    expect(collectNotesOrderDefects(section)).toEqual([])
    const cap = section.split('\n').find(l => l.startsWith(NOTES_ORDER[3]))
    expect(cap).toContain('drop the `## Commits` section first')
    expect(cap).not.toMatch(/Traceability|EXCEPTIONS/)
  })

  it('known-bad probe: the bullet moved below the cap is reported', () => {
    const lines = section.split('\n')
    const i = lines.findIndex(l => l.startsWith(NOTES_ORDER[2]))
    const moved = [...lines.slice(0, i), lines[i + 1], lines[i], ...lines.slice(i + 2)].join('\n')
    expect(collectNotesOrderDefects(moved).length).toBeGreaterThan(0)
  })
})

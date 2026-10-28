/**
 * tests/dynamic/tickets-compliance-off.test.ts
 *
 * #648 phase C: the compliance-off builds of /dynamic-tickets file their issues with the plain inputs only.
 *
 *   AC-13  The filing spawn passes no PLAN_ARTIFACT_PATH. The same input is in the on builds, so the scan is
 *          not empty.
 *   AC-14  The filing spawn stays the plain ensure-traceable-issue with TASK_DESCRIPTION, REQUIREMENTS (the
 *          ticket's Wave and Depends on lines, then its Summary paragraph) and WORKTREE_PATH. The
 *          ISSUE_REQUIRED gate, the order and the cap of 50 are the on build's text.
 *   AC-18  The fixed local line is recorded once under `required`, and the filing report carries it.
 *
 * Both off builds are read: compliance off with curation on, and both off. Every guard has a named
 * collector, a non-empty-corpus assertion and a known-bad probe run through the same collector.
 */

import { describe, it, expect } from 'vitest'

import { countOf, isAgentBlock, parseFences, requireDistFile, resolveCurationOffSource, resolveVariantOffSource } from '../helpers.js'
import { seedOnce } from '../guards/level-guard-helpers.js'

type OffKey = 'compliance-off' | 'both-off'

const OFF_KEYS: ReadonlyArray<readonly [string, OffKey]> = [
  ['compliance off', 'compliance-off'],
  ['curation and compliance off', 'both-off'],
]

function offBuild(key: OffKey): string {
  const off = resolveVariantOffSource(key, 'commands', 'dynamic-tickets')
  if (off === null) throw new Error(`the ${key} build of /dynamic-tickets is absent: run \`npm run build:mds\``)
  return off
}

/** The compliance-on build with the same curation switch as an off key. */
function onVariant(key: OffKey): string {
  if (key === 'compliance-off') return requireDistFile('dynamic-tickets.md')
  const curationOff = resolveCurationOffSource('commands', 'dynamic-tickets')
  if (curationOff === null) throw new Error('the curation-off build of /dynamic-tickets is absent: run `npm run build:mds`')
  return curationOff
}

const OFF_POLICY_LINE = 'TRACEABILITY: DEGRADED (compliance off on this machine; the repository requires evidence)'
const FILING_FROM = '### After the workflow returns — file the issues'
const FILING_TO = '### Ticket body structure'
const PLAN_ARTIFACT_LINE = 'PLAN_ARTIFACT_PATH: {the ticket or tracking-issue file path, relative to {worktree}}\n'
const ON_REPORT = '4. **Report** each file\'s `**Issue:**` reference, or `not filed` and why, with every `TRACEABILITY: DEGRADED` line step 2 and the spawns produced.'
const OFF_REPORT = '4. **Report** each file\'s `**Issue:**` reference, or `not filed` and why, with the compliance-off line of Pre-authoring step 0 and every `TRACEABILITY: DEGRADED` line step 2 and the spawns produced.'
const ON_HANDOFF = '`/devflow:dynamic-build` reads these lines: the tracking issue\'s for its wave report, and each ticket\'s as that ticket\'s own reference.'
const OFF_HANDOFF = '`/devflow:dynamic-build` reads these lines: the tracking issue\'s for its wave block\'s tracking line, and each ticket\'s as that ticket\'s own reference.'

/** The filing section of a build: from its heading to the ticket body structure, or null. */
function filingOf(md: string): string | null {
  const at = md.indexOf(FILING_FROM)
  const end = md.indexOf(FILING_TO, at + 1)
  return at === -1 || end === -1 ? null : md.slice(at, end)
}

/**
 * Named collector: how an off build of /dynamic-tickets files its issues — one plain ensure-traceable-issue
 * spawn with its three inputs and no plan artifact path, the fixed line recorded once under `required`, and
 * the report carrying it.
 */
function collectTicketsOffDefects(md: string): string[] {
  const filing = filingOf(md)
  if (filing === null) return ['the filing section is not found']
  const out: string[] = []
  const spawns = parseFences(filing).filter(f => f.includes('Agent('))
  if (spawns.length !== 1) out.push(`the filing section holds ${spawns.length} spawns, expected 1`)
  else {
    const spawn = spawns[0]
    if (!isAgentBlock(spawn, 'Git') || !spawn.includes('"OPERATION: ensure-traceable-issue')) out.push('the one spawn is not ensure-traceable-issue')
    if (!spawn.includes('TASK_DESCRIPTION: {the ticket\'s title, or the tracking issue\'s H1}')) out.push('the spawn drops TASK_DESCRIPTION')
    if (!spawn.includes('REQUIREMENTS: {the ticket\'s **Wave:** and **Depends on:** lines, then its ## Summary paragraph; or the tracking issue\'s ## Context}')) out.push('the spawn drops the Wave, Depends on and Summary requirements')
    if (!spawn.includes('WORKTREE_PATH: {worktree}')) out.push('the spawn drops WORKTREE_PATH')
  }
  if (md.includes('PLAN_ARTIFACT_PATH')) out.push('the build names PLAN_ARTIFACT_PATH')
  if (!filing.includes('Its `## Summary` paragraph follows, less any line opening with either label.')) out.push('the Summary paragraph rule is lost')
  if (!filing.includes('**File the issues** only when `ISSUE_REQUIRED` is `true`.')) out.push('the ISSUE_REQUIRED gate is lost')
  if (!filing.includes('at most 50 spawns in all')) out.push('the cap of 50 spawns is lost')
  if (countOf(md, OFF_POLICY_LINE) !== 1) out.push(`the build holds the fixed line ${countOf(md, OFF_POLICY_LINE)} times, expected 1`)
  if (!md.includes(`When \`EVIDENCE_POLICY\` is \`required\`, record \`${OFF_POLICY_LINE}\` once, for the filing report.`)) out.push('the fixed line is not recorded only under `required`, for the filing report')
  if (!filing.includes(OFF_REPORT)) out.push('the filing report does not carry the compliance-off line')
  return out
}

describe('#648 AC-13, AC-14, AC-18: the compliance-off builds of /dynamic-tickets file with the plain inputs', () => {
  it('both off builds file with one plain spawn, no plan artifact path and the fixed line recorded once', () => {
    for (const [label, key] of OFF_KEYS) {
      const md = offBuild(key)
      expect(md, `${label}: the off build is the on build, so this proves nothing`).not.toBe(onVariant(key))
      expect(filingOf(md)?.length ?? 0, `${label}: the filing section is empty, so this guard proves nothing`).toBeGreaterThan(2_000)
      expect(collectTicketsOffDefects(md), label).toEqual([])
    }
  })

  it('the on build names the plan artifact path once and never the local line, so the scan is not vacuous', () => {
    for (const [label, key] of OFF_KEYS) {
      const on = onVariant(key)
      expect(countOf(on, 'PLAN_ARTIFACT_PATH'), label).toBe(1)
      expect(on, label).not.toContain(OFF_POLICY_LINE)
    }
  })

  it('the filing section is the on build\'s text with the plan artifact line, the report line and the handoff line changed, and nothing else', () => {
    for (const [label, key] of OFF_KEYS) {
      const onFiling = filingOf(onVariant(key))!
      const expected = seedOnce(seedOnce(seedOnce(onFiling, PLAN_ARTIFACT_LINE, ''), ON_REPORT, OFF_REPORT), ON_HANDOFF, OFF_HANDOFF)
      expect(filingOf(offBuild(key)), label).toBe(expected)
    }
  })

  it('known-bad probes: a restored plan artifact path, a lost input and a lost line are each reported', () => {
    const md = offBuild('compliance-off')
    expect(collectTicketsOffDefects(md)).toEqual([])
    expect(collectTicketsOffDefects(seedOnce(md, 'WORKTREE_PATH: {worktree}"', `${PLAN_ARTIFACT_LINE}WORKTREE_PATH: {worktree}"`))).toContain('the build names PLAN_ARTIFACT_PATH')
    expect(collectTicketsOffDefects(seedOnce(md, 'TASK_DESCRIPTION: {the ticket\'s title, or the tracking issue\'s H1}\n', ''))).toContain('the spawn drops TASK_DESCRIPTION')
    expect(collectTicketsOffDefects(seedOnce(md, 'once, for the filing report.', 'once.'))).toContain('the fixed line is not recorded only under `required`, for the filing report')
    expect(collectTicketsOffDefects(seedOnce(md, OFF_REPORT, ON_REPORT))).toContain('the filing report does not carry the compliance-off line')
    expect(collectTicketsOffDefects(seedOnce(md, '**File the issues** only when `ISSUE_REQUIRED` is `true`.', '**File the issues** always.'))).toContain('the ISSUE_REQUIRED gate is lost')
  })
})

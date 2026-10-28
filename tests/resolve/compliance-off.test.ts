/**
 * tests/resolve/compliance-off.test.ts
 *
 * #648 phase B: the compliance-off builds of /resolve keep the merge check local.
 *
 *   AC-18  Step 0d records the one fixed local DEGRADED line under `required`, for the Phase 10 report.
 *   AC-19  Phase 9b-3 runs `verify-evidence.cjs verify` over the local evidence file and writes the local
 *          result file. No Git agent is spawned and no publish call is made.
 *   AC-20  Phase 9c runs readiness on every cycle, whatever REQUIRE_NON_AUTHOR_APPROVAL is, with the
 *          approval flag, the evidence flag and the out file; the readiness file is the local merge check.
 *   AC-21  With no local evidence file, the build records `SKIPPED (no local evidence file)`, skips Steps
 *          9b-0 and 9b-3, and runs readiness without `--evidence`.
 *   AC-22  Step 9b-0 passes the evidence flag to the stale-out check and appends the claims to the local
 *          evidence file.
 *   AC-23  The report names the summary, result and readiness paths as not posted, and Tracked is `local`.
 *
 * Both off builds are read: compliance off with curation on, and both off. Every guard has a named
 * collector, a non-empty-corpus assertion and a known-bad probe run through the same collector.
 */

import { describe, it, expect } from 'vitest'

import { collectOrderViolations, countOf, isAgentBlock, parseFences, requireDistFile, resolveVariantOffSource, type OrderRule } from '../helpers.js'
import { seedOnce } from '../guards/level-guard-helpers.js'

type OffKey = 'compliance-off' | 'both-off'

/** The compliance-off builds of /resolve, by label. */
const OFF_BUILDS: ReadonlyArray<readonly [string, OffKey]> = [
  ['compliance off', 'compliance-off'],
  ['curation and compliance off', 'both-off'],
]

function resolveMdOff(key: OffKey): string {
  const off = resolveVariantOffSource(key, 'commands', 'resolve')
  if (off === null) throw new Error(`the ${key} build of /resolve is absent: run \`npm run build:mds\``)
  return off
}

const OFF_POLICY_LINE = 'TRACEABILITY: DEGRADED (compliance off on this machine; the repository requires evidence)'
const EVIDENCE_FILE = '.devflow/docs/evidence-{branch_slug}.md'
const RESULT_FILE = '.devflow/docs/evidence-result-{branch_slug}.md'
const READINESS_FILE = '.devflow/docs/readiness-{branch_slug}.md'
const NO_FILE = 'SKIPPED (no local evidence file)'

const PHASE9B = '### Phase 9b: Local Test-Plan Evidence'
const PHASE9C = '### Phase 9c: Merge Readiness (Report-only)'
const PHASE10 = '### Phase 10: Report'
const STEP0 = '**Step 9b-0: Re-verify stale test-plan items**'
const STEP3 = '**Step 9b-3: Verify the test-plan evidence locally**'
/** The stale-out call's flag pair; the result call has `--comment-out` after the evidence file instead. */
const STALE_RUN = '--evidence ".devflow/docs/evidence-{branch_slug}.md" --stale-out'
const RESULT_RUN = 'verify-evidence.cjs" verify --pr {pr_number} --evidence ".devflow/docs/evidence-{branch_slug}.md" --comment-out'
const READINESS_RUN = 'verify-evidence.cjs" readiness --pr {pr_number}'
const TEST_SPAWN = 'Agent(subagent_type="Test"):\n"TEST_PLAN: <untrusted-test-plan>'
const CLAIM_TEMPLATE = '- TP-<n> <PASS|FAIL|SKIP> sha:<head> by:test exit:<0-255>'

/** The text of a heading's section, up to the next phase heading, the knowledge write-back or the architecture section, or null when the heading is absent. */
function sectionOf(md: string, heading: string): string | null {
  const at = md.indexOf(heading)
  if (at === -1) return null
  const rest = md.slice(at + heading.length)
  const next = rest.search(/\n### Phase |\n### Feature Knowledge|\n## Architecture/)
  return next === -1 ? md.slice(at) : md.slice(at, at + heading.length + next)
}

/** The posting text an off build of /resolve names nowhere: [what it is, the text]. */
const ABSENT: ReadonlyArray<readonly [string, string]> = [
  ['the post-resolution-summary operation', 'post-resolution-summary'],
  ['the update-pr-evidence operation', 'update-pr-evidence'],
  ['the manage-debt operation', 'manage-debt'],
  ['the publish call', 'verify-evidence.cjs" publish'],
  ['the publication flag', '--publication'],
  ['the publication input an op takes', 'REVIEW_PUBLICATION: {REVIEW_PUBLICATION}'],
  ['the resolution-summary post step', 'Step 9b-2'],
  ['the external-thread step', 'Step 9b-1'],
  ['the external-thread phase', '### Phase 1b'],
  ['the tech-debt phase', '### Phase 9: Manage Debt'],
  ['the publish timeout', 'timeout: 180000'],
]

/** Named collector: what an off build of /resolve still names that a non-posting machine must not. */
function collectAbsenceDefects(md: string): string[] {
  return ABSENT.filter(([, text]) => md.includes(text)).map(([what, text]) => `the off build names ${what}: ${text}`)
}

/** Named collector: how Phase 9b-0 and 9b-3 of an off build keep the local evidence file the one source and the one sink. */
function collectLocalEvidenceDefects(md: string): string[] {
  const phase = sectionOf(md, PHASE9B)
  if (phase === null) return ['no Phase 9b section']
  const out: string[] = []
  const fences = parseFences(phase)
  const stale = fences.filter(f => f.includes('--stale-out "{TARGET_DIR_REL}/stale-plan.md"'))
  if (stale.length !== 1) out.push(`expected one stale-out call, found ${stale.length}`)
  else if (!stale[0].includes(STALE_RUN)) out.push('the stale-out call does not pass the evidence file before --stale-out')
  const results = fences.filter(f => f.includes(RESULT_RUN))
  if (results.length !== 1) out.push(`expected one result call, found ${results.length}`)
  else {
    if (!results[0].includes(`--comment-out "${RESULT_FILE}"`)) out.push('--comment-out is not the local result file')
    if (!results[0].startsWith('```bash\ncd {worktree} && node ')) out.push('the result call does not run from the worktree')
  }
  if (!phase.includes(`\`STALE_REVERIFICATION\` and \`EVIDENCE_REFRESH\` as \`${NO_FILE}\``)) out.push('no local evidence file does not record SKIPPED for both outputs')
  if (!phase.includes('skip Steps 9b-0 and 9b-3, and run Step 9c without `--evidence`')) out.push('no local evidence file does not skip 9b-0 and 9b-3 and drop --evidence from 9c')
  if (!phase.includes(`to the \`## Claims\` section of \`${EVIDENCE_FILE}\`, the local evidence file`)) out.push('the claims are not appended to the local evidence file')
  if (!phase.includes(CLAIM_TEMPLATE)) out.push('the claim shape is not the claim grammar\'s')
  if (!phase.includes('The lines came from the evidence file, so they travel wrapped')) out.push('the stale lines do not travel wrapped as untrusted')
  if (fences.some(f => isAgentBlock(f, 'Git'))) out.push('a Git agent is spawned')
  if (!phase.includes('it writes nothing to GitHub')) out.push('Step 9b-3 does not say it writes nothing to GitHub')
  if (!phase.includes('`TRACEABILITY: DEGRADED (evidence unavailable)`')) out.push('a failed run names no DEGRADED reason')
  if (!phase.includes('^[A-Za-z0-9._-]{1,200}$')) out.push('the branch slug reaches the shell ungated')
  return out
}

/** Named collector: how Phase 9c of an off build runs readiness — every cycle, all three flags, the local file. */
function collectReadinessDefects(md: string): string[] {
  const phase = sectionOf(md, PHASE9C)
  if (phase === null) return ['no Phase 9c section']
  const out: string[] = []
  const runs = parseFences(phase).filter(f => f.includes(READINESS_RUN))
  if (runs.length !== 1) return [`expected one readiness call, found ${runs.length}`]
  const run = runs[0]
  if (!run.startsWith('```bash\ncd {worktree} && node ')) out.push('the call does not run from the worktree')
  if (!run.includes('--require-non-author-approval {REQUIRE_NON_AUTHOR_APPROVAL}')) out.push('the call does not pass the approval value')
  if (!run.includes(`--evidence "${EVIDENCE_FILE}"`)) out.push('the call does not pass the evidence file')
  if (!run.includes(`--out "${READINESS_FILE}"`)) out.push('the call does not write the local readiness file')
  if (!phase.includes('Run this phase on every cycle, for each worktree with a known PR, whatever `REQUIRE_NON_AUTHOR_APPROVAL` is')) out.push('the phase is not run on every cycle')
  if (/Run this phase only when/.test(phase)) out.push('the phase is still gated on the approval value')
  if (!phase.includes(`Drop the \`--evidence\` pair when Phase 9b recorded \`${NO_FILE}\``)) out.push('the evidence flag is not dropped when no local evidence file exists')
  if (!phase.includes('nothing to GitHub')) out.push('the phase does not say it writes nothing to GitHub')
  if (!phase.includes('The script writes the local file (on exit 0 or 2)')) out.push('the phase does not say when the local readiness file is written')
  if (parseFences(phase).some(f => isAgentBlock(f, 'Git'))) out.push('a Git agent is spawned')
  return out
}

/** Named collector: how the report of an off build names its local files as not posted, and sets Tracked to `local`. */
function collectLocalReportDefects(md: string): string[] {
  const report = sectionOf(md, PHASE10)
  if (report === null) return ['no Phase 10 section']
  const out: string[] = []
  for (const [what, line] of [
    ['the resolution summary', '- Resolution summary: {TARGET_DIR}/resolution-summary.md (local; not posted)'],
    ['the evidence result', `- Evidence result: {${RESULT_FILE} (local; not posted) | SKIPPED (reason)}`],
    ['the readiness file', `- Readiness file: {${READINESS_FILE} (local; not posted) | SKIPPED (reason)}`],
  ] as const) {
    if (!report.includes(line)) out.push(`the report does not name ${what} as local and not posted`)
  }
  if (!report.includes('It stays local and is not posted.')) out.push('the report does not say the summary is not posted')
  if (!report.includes('(Tracked: local)')) out.push('the deferred line does not state Tracked: local')
  if (!md.includes('Give FIX_SEPARATE and TECH_DEBT items the `Tracked` value `local`: no backlog entry is created.')) out.push('Phase 5 does not set Tracked to local')
  if (!report.includes('- Traceability: {the compliance-off line Step 0d recorded, when it did}')) out.push('the report does not carry the Step 0d line')
  return out
}

/** Named collector: how the AC-18 line is recorded once, under `required`, before the report. */
function collectPolicyLineDefects(md: string): string[] {
  const out: string[] = []
  if (countOf(md, OFF_POLICY_LINE) !== 1) out.push(`the build holds the fixed line ${countOf(md, OFF_POLICY_LINE)} times, expected 1`)
  if (!md.includes(`When \`EVIDENCE_POLICY\` is \`required\`, record \`${OFF_POLICY_LINE}\` once, for the Phase 10 report.`)) out.push('the line is not recorded only under `required`, for the Phase 10 report')
  out.push(...collectOrderViolations('resolve.md', md, [
    { label: 'the policy resolves before the line is recorded', before: 'resolve-evidence-policy.cjs', after: OFF_POLICY_LINE },
    { label: 'the line is recorded before Phase 9b', before: OFF_POLICY_LINE, after: PHASE9B },
  ]))
  return out
}

/** The order the off build keeps from the evidence phase to the report. */
const ORDER: readonly OrderRule[] = [
  { label: '9b-0 opens Phase 9b', before: PHASE9B, after: STEP0 },
  { label: 'the stale-out check runs before the Test spawn', before: STALE_RUN, after: TEST_SPAWN },
  { label: 'the claims follow the Test spawn', before: TEST_SPAWN, after: CLAIM_TEMPLATE },
  { label: '9b-3 follows 9b-0', before: STEP0, after: STEP3 },
  { label: 'the result call sits in 9b-3', before: STEP3, after: RESULT_RUN },
  { label: 'Phase 9c follows 9b-3', before: RESULT_RUN, after: PHASE9C },
  { label: 'the readiness call sits in 9c', before: PHASE9C, after: READINESS_RUN },
  { label: 'the report follows 9c', before: READINESS_RUN, after: PHASE10 },
]

describe('#648 AC-13, AC-19: the compliance-off builds of /resolve post nothing and run the local verify', () => {
  it('both off builds hold the evidence phases in order and none of the posting text', () => {
    for (const [label, key] of OFF_BUILDS) {
      const md = resolveMdOff(key)
      expect(md, `${label}: the off build is the on build, so this proves nothing`).not.toBe(requireDistFile('resolve.md'))
      expect(sectionOf(md, PHASE9B)?.length ?? 0, `${label}: Phase 9b is empty, so this guard proves nothing`).toBeGreaterThan(2_000)
      expect(collectOrderViolations('resolve.md', md, ORDER), label).toEqual([])
      expect(collectAbsenceDefects(md), label).toEqual([])
      expect(collectLocalEvidenceDefects(md), label).toEqual([])
    }
  })

  it('the on build keeps each posting text, so the absence guard is not vacuous', () => {
    const on = requireDistFile('resolve.md')
    expect(ABSENT.length, 'the absence table is empty, so this guard proves nothing').toBeGreaterThanOrEqual(10)
    const silent = ABSENT.filter(([, text]) => !on.includes(text)).map(([what]) => what)
    expect(silent, 'a text the on build does not name proves nothing about an off one').toEqual([])
  })

  it('known-bad probes: a publish call, a Git spawn, a lost flag and a lost run are each reported', () => {
    const md = resolveMdOff('compliance-off')
    expect(collectLocalEvidenceDefects(md)).toEqual([])
    expect(collectAbsenceDefects(`${md}\nverify-evidence.cjs" publish --pr 1`)).toEqual(['the off build names the publish call: verify-evidence.cjs" publish'])
    expect(collectAbsenceDefects(`${md}\n"OPERATION: post-resolution-summary`)).toEqual(['the off build names the post-resolution-summary operation: post-resolution-summary'])
    const spawned = seedOnce(md, PHASE9C, '```\nAgent(subagent_type="Git"):\n"OPERATION: x"\n```\n\n' + PHASE9C)
    expect(collectLocalEvidenceDefects(spawned)).toEqual(['a Git agent is spawned'])
    expect(collectLocalEvidenceDefects(seedOnce(md, ` --evidence "${EVIDENCE_FILE}" --stale-out`, ' --stale-out'))).toEqual(['the stale-out call does not pass the evidence file before --stale-out'])
    expect(collectLocalEvidenceDefects(seedOnce(md, ` --comment-out "${RESULT_FILE}"`, ' --comment-out "x.md"'))).toEqual(['--comment-out is not the local result file'])
    expect(collectLocalEvidenceDefects(seedOnce(md, `to the \`## Claims\` section of \`${EVIDENCE_FILE}\`, the local evidence file`, 'to the PR body'))).toEqual(['the claims are not appended to the local evidence file'])
    expect(collectOrderViolations('resolve.md', seedOnce(md, STEP3, '**Step 9b-3 later**').replace(PHASE9B, `${STEP3}\n\n${PHASE9B}`), ORDER).some(v => v.includes('9b-3 follows 9b-0'))).toBe(true)
  })
})

describe('#648 AC-20: Phase 9c of the compliance-off builds runs readiness on every cycle', () => {
  it('both off builds run one readiness call from the worktree with the approval flag, the evidence flag and the out file', () => {
    for (const [label, key] of OFF_BUILDS) {
      const md = resolveMdOff(key)
      expect(sectionOf(md, PHASE9C)?.length ?? 0, `${label}: Phase 9c is empty, so this guard proves nothing`).toBeGreaterThan(800)
      expect(collectReadinessDefects(md), label).toEqual([])
    }
  })

  it('the on build gates 9c on the approval value and passes neither the evidence flag nor the out file', () => {
    const phase = sectionOf(requireDistFile('resolve.md'), PHASE9C) ?? ''
    expect(phase).toContain('Run this phase only when `REQUIRE_NON_AUTHOR_APPROVAL` is `true`')
    expect(phase).not.toContain('--evidence')
    expect(phase).not.toContain('--out')
    expect(collectReadinessDefects(requireDistFile('resolve.md')).length, 'the on build must not pass the off collector').toBeGreaterThan(0)
  })

  it('known-bad probes: a gated phase, a dropped flag, a lost out file and a Git spawn are each reported', () => {
    const md = resolveMdOff('compliance-off')
    expect(collectReadinessDefects(md)).toEqual([])
    expect(collectReadinessDefects(seedOnce(md, ' --require-non-author-approval {REQUIRE_NON_AUTHOR_APPROVAL} --evidence', ' --evidence'))).toEqual(['the call does not pass the approval value'])
    expect(collectReadinessDefects(seedOnce(md, ` --evidence "${EVIDENCE_FILE}" --out`, ' --out')).includes('the call does not pass the evidence file')).toBe(true)
    expect(collectReadinessDefects(seedOnce(md, ` --out "${READINESS_FILE}"`, ''))).toEqual(['the call does not write the local readiness file'])
    expect(collectReadinessDefects(seedOnce(md, 'Run this phase on every cycle, for each worktree with a known PR, whatever', 'Run this phase only when `REQUIRE_NON_AUTHOR_APPROVAL` is `true`, whatever')).sort()).toEqual([
      'the phase is not run on every cycle',
      'the phase is still gated on the approval value',
    ].sort())
    expect(collectReadinessDefects(seedOnce(md, 'cd {worktree} && node "$HOME/.devflow/scripts/verify-evidence.cjs" readiness', 'node "$HOME/.devflow/scripts/verify-evidence.cjs" readiness'))).toEqual(['the call does not run from the worktree'])
    expect(collectReadinessDefects(seedOnce(md, PHASE10, '```\nAgent(subagent_type="Git"):\n"OPERATION: x"\n```\n\n' + PHASE10))).toEqual(['a Git agent is spawned'])
  })
})

describe('#648 AC-21: with no local evidence file the compliance-off builds skip 9b-0 and 9b-3 and run readiness without --evidence', () => {
  it('each build states the SKIPPED value once in the 9b preface, the report row, the edge-case row and the 9c drop rule', () => {
    for (const [label, key] of OFF_BUILDS) {
      const md = resolveMdOff(key)
      const preface = sectionOf(md, PHASE9B) ?? ''
      expect(preface, label).toContain(`\`STALE_REVERIFICATION\` and \`EVIDENCE_REFRESH\` as \`${NO_FILE}\``)
      expect(preface, label).toContain('When `cd {worktree} && test -f ".devflow/docs/evidence-{branch_slug}.md"; echo "exit=$?"` prints anything but `exit=0`, no local evidence file exists')
      expect(sectionOf(md, PHASE9C), label).toContain(`Drop the \`--evidence\` pair when Phase 9b recorded \`${NO_FILE}\``)
      expect(sectionOf(md, PHASE10), label).toContain(`| ${NO_FILE} |`)
      expect(md, label).toContain('| No local evidence file exists | `STALE_REVERIFICATION` and `EVIDENCE_REFRESH` are `SKIPPED (no local evidence file)`; Phase 9c runs readiness without `--evidence` |')
    }
  })

  it('the existence test runs before any script of Phases 9b and 9c', () => {
    for (const [label, key] of OFF_BUILDS) {
      const md = resolveMdOff(key)
      expect(collectOrderViolations('resolve.md', md, [
        { label: 'the existence test precedes the stale-out call', before: 'test -f ".devflow/docs/evidence-{branch_slug}.md"', after: STALE_RUN },
        { label: 'the existence test precedes the readiness call', before: 'test -f ".devflow/docs/evidence-{branch_slug}.md"', after: READINESS_RUN },
      ]), label).toEqual([])
    }
  })

  it('known-bad probes: a lost skip value, a lost drop rule and a lost edge-case row are each reported', () => {
    const md = resolveMdOff('compliance-off')
    expect(collectLocalEvidenceDefects(seedOnce(md, 'skip Steps 9b-0 and 9b-3, and run Step 9c without `--evidence`', 'run every step'))).toEqual(['no local evidence file does not skip 9b-0 and 9b-3 and drop --evidence from 9c'])
    expect(collectReadinessDefects(seedOnce(md, 'Drop the `--evidence` pair when Phase 9b recorded', 'Keep the `--evidence` pair when Phase 9b recorded'))).toEqual(['the evidence flag is not dropped when no local evidence file exists'])
  })
})

describe('#648 AC-22: Step 9b-0 of the compliance-off builds reads and extends the local evidence file', () => {
  it('the stale-out check passes the evidence flag, the Test spawn wraps the lines as untrusted, and the claims are appended to the file', () => {
    for (const [label, key] of OFF_BUILDS) {
      const md = resolveMdOff(key)
      const spawn = md.indexOf(TEST_SPAWN)
      expect(spawn, `${label}: the Test spawn is absent`).toBeGreaterThan(-1)
      expect(collectOrderViolations('resolve.md', md, ORDER), label).toEqual([])
      expect(countOf(md, TEST_SPAWN), `${label}: one Test spawn`).toBe(1)
      expect(collectLocalEvidenceDefects(md), label).toEqual([])
    }
  })

  it('the on build reads the stale plan from the PR and does not pass the evidence flag to the stale-out check', () => {
    const on = requireDistFile('resolve.md')
    expect(on).toContain('verify-evidence.cjs" verify --pr {pr_number} --stale-out "{TARGET_DIR_REL}/stale-plan.md"')
    expect(on).not.toContain(STALE_RUN)
  })
})

describe('#648 AC-23, AC-18: the compliance-off builds report local files as not posted and record the fixed line once', () => {
  it('both off builds name the three local files as not posted and set Tracked to local', () => {
    for (const [label, key] of OFF_BUILDS) {
      const md = resolveMdOff(key)
      expect(sectionOf(md, PHASE10)?.length ?? 0, `${label}: the report is empty, so this guard proves nothing`).toBeGreaterThan(1_000)
      expect(collectLocalReportDefects(md), label).toEqual([])
    }
  })

  it('both off builds hold the fixed line once, under required, before Phase 9b, and no compliance-on build holds it', () => {
    for (const [label, key] of OFF_BUILDS) expect(collectPolicyLineDefects(resolveMdOff(key)), label).toEqual([])
    expect(requireDistFile('resolve.md')).not.toContain(OFF_POLICY_LINE)
    expect(resolveVariantOffSource('curation-off', 'commands', 'resolve') ?? '').not.toContain(OFF_POLICY_LINE)
  })

  it('known-bad probes: a posted path, a lost Tracked value, a doubled line and an unconditional line are each reported', () => {
    const md = resolveMdOff('compliance-off')
    expect(collectLocalReportDefects(seedOnce(md, `- Readiness file: {${READINESS_FILE} (local; not posted) | SKIPPED (reason)}`, `- Readiness file: ${READINESS_FILE} (local; not posted)`))).toEqual(['the report does not name the readiness file as local and not posted'])
    expect(collectLocalReportDefects(seedOnce(md, `- Evidence result: {${RESULT_FILE} (local; not posted) | SKIPPED (reason)}`, `- Evidence result: ${RESULT_FILE} (local; not posted), when Step 9b-3 ran`))).toEqual(['the report does not name the evidence result as local and not posted'])
    expect(collectReadinessDefects(seedOnce(md, 'The script writes the local file (on exit 0 or 2) and', 'The script writes the local file and'))).toEqual(['the phase does not say when the local readiness file is written'])
    expect(collectLocalReportDefects(seedOnce(md, '(Tracked: local)', '(Tracked: ledger)'))).toEqual(['the deferred line does not state Tracked: local'])
    expect(collectLocalReportDefects(seedOnce(md, 'the `Tracked` value `local`: no backlog entry is created.', 'the `Tracked` value `deferred`.'))).toEqual(['Phase 5 does not set Tracked to local'])
    expect(collectPolicyLineDefects(`${md}\n${OFF_POLICY_LINE}`)[0]).toContain('2 times')
    expect(collectPolicyLineDefects(seedOnce(md, 'When `EVIDENCE_POLICY` is `required`, record `TRACEABILITY: DEGRADED (compliance off', 'Record `TRACEABILITY: DEGRADED (compliance off')).some(d => d.includes('only under `required`'))).toBe(true)
  })
})

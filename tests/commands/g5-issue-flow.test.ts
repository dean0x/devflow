/**
 * SDLC-evidence PR2 (#360), phase P2 — the /plan → /implement issue flow (G5)
 * and /implement's PR-timing contradiction, structurally pinned.
 *
 * G5: /plan wrote its design artifact before it created the tracker issue, so
 * the frontmatter `issue:` never received the new ID; /implement read that
 * frontmatter only AFTER the setup-task spawn, so its "pass the issue to the Git
 * agent" step was unreachable, and under compliance setup-task step 1c created a
 * DUPLICATE issue. The fix orders both commands: /plan writes `issue: pending`,
 * spawns, then patches that one line in place; /implement reads the frontmatter
 * first and forwards a non-`pending` value as the setup-task `ISSUE_INPUT`.
 *
 * PR timing: Phase 9 skipped the CI gate for SEQUENTIAL because the PR was "not
 * yet created", while Phase 2 has the last sequential Code agent create it. The
 * resolution: SINGLE and SEQUENTIAL run the gate (their PR exists from Phase 2);
 * PARALLEL skips it (its unified PR is created in Phase 10).
 *
 * Every guard has the three parts PF-064 asks of an absence-based check: a NAMED
 * collector, an assertion that the text it read is the text it claims to read,
 * and known-bad probes that drive the SAME collector over the `d09da34`
 * spellings each fix replaces — quoted verbatim — and over per-site seeds of the
 * shipped file, so every site the live arm ranges over has a probe of its own.
 */

import { describe, it, expect } from 'vitest'

import { collectOrderViolations, requireDistFile, type OrderRule } from '../helpers.js'

// ---------------------------------------------------------------------------
// Shared text utilities
// ---------------------------------------------------------------------------

/** The slice of `text` from `startAnchor` up to `endAnchor` (or the end); null when the start is absent. */
function sliceBetween(text: string, startAnchor: string, endAnchor: string): string | null {
  const start = text.indexOf(startAnchor)
  if (start === -1) return null
  const end = text.indexOf(endAnchor, start + startAnchor.length)
  return end === -1 ? text.slice(start) : text.slice(start, end)
}

/** Replace the single line equal to `line` with `replacement`; throws when none or several match. */
function replaceWholeLine(content: string, line: string, replacement: string): string {
  const lines = content.split('\n')
  const hits = lines.filter(l => l === line).length
  if (hits !== 1) throw new Error(`replaceWholeLine: expected exactly one line "${line}", found ${hits} — the seed is inert`)
  return lines.map(l => (l === line ? replacement : l)).join('\n')
}

// ---------------------------------------------------------------------------
// 1. /plan — write `issue: pending`, spawn, patch that one line (§3.8, AC-9)
// ---------------------------------------------------------------------------

const PLAN_SPAWN = '"OPERATION: ensure-traceable-issue'
const PLAN_WRITE = '**Write the artifact now**'
const PLAN_PATCH = '**Patch the frontmatter'

/** The order G5 needs: the artifact exists before the spawn reads it, and is patched after. */
const PLAN_ISSUE_ORDER: readonly OrderRule[] = [
  { label: 'the artifact is written before the issue spawn', before: PLAN_WRITE, after: PLAN_SPAWN },
  { label: 'the frontmatter is patched after the issue spawn', before: PLAN_SPAWN, after: PLAN_PATCH },
]

/**
 * Every verb that would put the artifact on disk a second time, or move it.
 *
 * The capability surface of "change the file other than the one line": writing
 * it (again), rewriting or overwriting it, renaming or moving it (in prose or as
 * `mv`). Word-bounded, so `written` in "the design artifact path written above"
 * — the spawn's own back-reference to the pre-spawn write — is not a hit.
 */
const ARTIFACT_WRITE_VERB = /\b(?:re-?write|over-?write|write|rename|move|mv)\b/i

/** A negation earlier in the same clause turns an instruction into a prohibition. */
const NEGATION = /\b(?:never|not|no|don't)\b/i

/**
 * Named collector: every clause of `text` that INSTRUCTS a write, rewrite,
 * rename or move — one entry per offending line.
 *
 * Clause-level, not line-level, because the correct patch sentence itself names
 * the forbidden acts ("Never rename the artifact, never rewrite it"): a
 * prohibition must not read as an instruction. Clauses split on `,` `;` `.` and
 * `—`; a split inside a path only shortens the prefix a negation is searched in,
 * so it can over-report but never hide an instruction.
 */
export function collectArtifactWriteInstructions(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const instructs = line.split(/[,;.—]/).some(clause => {
      const verb = ARTIFACT_WRITE_VERB.exec(clause)
      return verb !== null && !NEGATION.test(clause.slice(0, verb.index))
    })
    if (instructs) out.push(line.trim())
  }
  return out
}

/** Phase 14 of /plan, split at the issue spawn. Null halves mean the anchor is absent. */
function planPhase14(plan: string): { beforeSpawn: string | null; afterSpawn: string | null } {
  const phase14 = sliceBetween(plan, '#### Phase 14: Output', '\n## Architecture')
  if (phase14 === null) return { beforeSpawn: null, afterSpawn: null }
  const at = phase14.indexOf(PLAN_SPAWN)
  if (at === -1) return { beforeSpawn: phase14, afterSpawn: null }
  return { beforeSpawn: phase14.slice(0, at), afterSpawn: phase14.slice(at) }
}

/**
 * Named collector: the ways /plan's Phase 14 breaks G5's single-write rule.
 * Exactly one write instruction before the spawn — the `pending` write — and
 * none after it: the spawn is followed by an in-place patch, never a second
 * write, a rename or a move.
 */
export function collectPlanArtifactRewrites(plan: string): string[] {
  const { beforeSpawn, afterSpawn } = planPhase14(plan)
  if (beforeSpawn === null) return ['plan.md has no `#### Phase 14: Output` section']
  if (afterSpawn === null) return ['Phase 14 has no ensure-traceable-issue spawn']
  const out: string[] = []
  const writes = collectArtifactWriteInstructions(beforeSpawn)
  if (writes.length !== 1 || !writes[0].includes(PLAN_WRITE)) {
    out.push(`before the spawn: expected exactly the ${PLAN_WRITE} instruction, found [${writes.join(' | ')}]`)
  }
  for (const line of collectArtifactWriteInstructions(afterSpawn)) {
    out.push(`after the spawn: a second write, rename or move — "${line}"`)
  }
  return out
}

/** The `d09da34` Phase 14 spelling (built), quoted verbatim: written once, never patched. */
const D09DA34_PLAN_PHASE14 = [
  '#### Phase 14: Output',
  '',
  '**Requires:** APPROVED_PLAN',
  '',
  '**Store design artifact:**',
  '',
  'Write design artifact to disk:',
  '- If no issue: `.devflow/docs/design/{topic-slug}.{YYYY-MM-DD_HHMM}.md`',
  '',
  'Spawn a Git agent with `OPERATION: ensure-traceable-issue`:',
  '',
  '```',
  'Agent(subagent_type="Git"):',
  '"OPERATION: ensure-traceable-issue',
  'PLAN_ARTIFACT_PATH: {the design artifact path written above}',
  'Return the issue number."',
  '```',
  '',
  'Capture `ISSUE_NUMBER` from the Git agent output for use in the completion report and the `/implement` hand-off suggestion.',
  '',
  '## Architecture',
].join('\n')

describe('/plan writes the artifact with `issue: pending`, then patches that line in place (§3.8, AC-9)', () => {
  it('the write precedes the ensure-traceable-issue spawn, and the patch follows it', () => {
    expect(collectOrderViolations('plan.md', requireDistFile('plan.md'), PLAN_ISSUE_ORDER)).toEqual([])
  })

  it('known-bad probe: the d09da34 Phase 14 has neither a pending write nor a patch', () => {
    const violations = collectOrderViolations('d09da34/plan.md', D09DA34_PLAN_PHASE14, PLAN_ISSUE_ORDER)
    expect(violations).toHaveLength(2)
    expect(violations.some(v => v.includes(`absent: "${PLAN_WRITE}"`))).toBe(true)
    expect(violations.some(v => v.includes(`absent: "${PLAN_PATCH}"`))).toBe(true)
  })

  it('the write names `issue: pending`; the patch is one line, in place, and leaves pending on a decline', () => {
    const plan = requireDistFile('plan.md')
    const write = plan.split('\n').filter(l => l.includes(PLAN_WRITE))
    expect(write, 'exactly one write sentence').toHaveLength(1)
    expect(write[0]).toContain('issue: pending')
    const patch = plan.split('\n').filter(l => l.includes(PLAN_PATCH))
    expect(patch, 'exactly one patch sentence').toHaveLength(1)
    // `still reads issue: pending` scopes the patch to the unknown-issue case: an
    // ID written up front is never re-spelled by the spawn's rendered reference.
    const PATCH_PHRASES = [
      'in place', 'still reads `issue: pending`', 'only that one line', 'leading `---` block', 'Edit tool',
      'leave `issue: pending`',
    ]
    for (const phrase of PATCH_PHRASES) {
      expect(patch[0], `the patch sentence must say "${phrase}"`).toContain(phrase)
    }
    // The patched value is the one this Phase captures from the spawn. The op
    // emits `**Issue**:` and no `ISSUE_ID` (c7bff85 removed that capture for
    // having no producer), so the patch must not read a value the spawn never set.
    expect(patch[0]).toContain('issue: {ISSUE_NUMBER}')
    expect(patch[0]).not.toContain('{ISSUE_ID}')
  })

  it('the artifact is written exactly once before the spawn, and never again, renamed or moved after it', () => {
    const plan = requireDistFile('plan.md')
    const { beforeSpawn, afterSpawn } = planPhase14(plan)
    // Non-vacuity: both halves are the text they claim to be.
    expect(beforeSpawn, 'Phase 14 is absent').not.toBeNull()
    expect(afterSpawn, 'the spawn is absent').not.toBeNull()
    expect(beforeSpawn).toContain('**Artifact format:**')
    expect(afterSpawn).toContain(PLAN_PATCH)
    expect(collectPlanArtifactRewrites(plan)).toEqual([])
  })

  it('known-bad probe: every verb shape, seeded after the spawn, is reported', () => {
    const plan = requireDistFile('plan.md')
    const SHAPES = [
      'Rename the artifact to `.devflow/docs/design/{ISSUE_NUMBER}-{topic-slug}.{YYYY-MM-DD_HHMM}.md`.',
      'Write the artifact again with the new `issue:` value.',
      'Rewrite the frontmatter with the returned issue.',
      'Overwrite the design artifact with the enriched copy.',
      'Move the artifact under its issue-prefixed name.',
      'Run `mv {old path} {new path}` so the name carries the issue.',
    ]
    for (const shape of SHAPES) {
      const seeded = plan.replace(PLAN_PATCH, `${shape}\n\n${PLAN_PATCH}`)
      expect(seeded, 'the seed must land').not.toBe(plan)
      const violations = collectPlanArtifactRewrites(seeded)
      expect(violations, `"${shape}" must be reported`).toHaveLength(1)
      expect(violations[0]).toContain('after the spawn')
    }
  })

  it('known-bad probe: the d09da34 pre-spawn write sentence is not the pending write', () => {
    const violations = collectPlanArtifactRewrites(D09DA34_PLAN_PHASE14)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('Write design artifact to disk:')
  })

  it('negative controls: a prohibition is not an instruction, and the spawn\'s back-reference is not a write', () => {
    expect(collectArtifactWriteInstructions('Never rename the artifact, never rewrite it, never spawn it again.')).toEqual([])
    expect(collectArtifactWriteInstructions('PLAN_ARTIFACT_PATH: {the design artifact path written above}')).toEqual([])
    expect(collectArtifactWriteInstructions('Do not move it.')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. /implement — read the frontmatter before setup-task; `pending` is absent (§3.9, AC-9)
// ---------------------------------------------------------------------------

const IMPLEMENT_ORDER: readonly OrderRule[] = [
  {
    label: 'the plan frontmatter is read before the setup-task spawn it feeds',
    before: '**Plan Document Handling**',
    after: 'OPERATION: setup-task',
  },
]

/** The setup-task payload's `ISSUE_INPUT:` line, or null when there is not exactly one. */
function setupTaskIssueInputLine(implement: string): string | null {
  const payload = sliceBetween(implement, 'OPERATION: setup-task', '```')
  if (payload === null) return null
  const lines = payload.split('\n').filter(l => l.trimStart().startsWith('ISSUE_INPUT:'))
  return lines.length === 1 ? lines[0] : null
}

/** The Plan Document Handling step that forwards the frontmatter `issue`, or null when not exactly one. */
function planHandlingIssueStep(implement: string): string | null {
  const block = sliceBetween(implement, '**Plan Document Handling**', '\n\n')
  if (block === null) return null
  const steps = block.split('\n').filter(l => /^\d+\. /.test(l) && l.includes('ISSUE_INPUT'))
  return steps.length === 1 ? steps[0] : null
}

/**
 * Named collector: the /implement sites that would forward a `pending` issue.
 *
 * Two sites, because the value crosses two: the Plan Document Handling step that
 * extracts it, and the setup-task payload line that carries it. `pending` is
 * /plan's marker for "no issue was created" — forwarded, it reaches setup-task
 * step 1 as a reference, fails the provider grammar, and the task runs with no
 * issue at all rather than letting step 1c create one.
 */
export function collectPendingForwarded(implement: string): string[] {
  const out: string[] = []
  const step = planHandlingIssueStep(implement)
  if (step === null) {
    out.push('Plan Document Handling: no single step forwards the frontmatter `issue` as ISSUE_INPUT')
  } else if (!step.includes('`pending`') || !/treat it as absent/.test(step)) {
    out.push(`Plan Document Handling: the issue step does not treat \`pending\` as absent — "${step.trim()}"`)
  }
  const line = setupTaskIssueInputLine(implement)
  if (line === null) {
    out.push('setup-task payload: no single ISSUE_INPUT: line')
  } else if (!line.includes('frontmatter') || !line.includes('pending')) {
    out.push(`setup-task payload: ISSUE_INPUT does not carry the frontmatter issue minus pending — "${line.trim()}"`)
  }
  return out
}

/** The `d09da34` lines each /implement site replaces, quoted verbatim. */
const D09DA34_ISSUE_INPUT =
  'ISSUE_INPUT: {$ARGUMENTS verbatim, when it is a single whitespace-delimited token that does not end in .md — otherwise omit}'
const D09DA34_ISSUE_STEP = '4. If `issue` field present in frontmatter: pass to Git agent as ISSUE_INPUT'

/** The `d09da34` Phase 1 order (built): spawn first, frontmatter read after it. */
const D09DA34_IMPLEMENT_PHASE1 = [
  'Spawn Git agent to set up task environment.',
  '',
  '```',
  'Agent(subagent_type="Git"):',
  '"OPERATION: setup-task',
  D09DA34_ISSUE_INPUT,
  '```',
  '',
  '**Plan Document Handling** (when $ARGUMENTS is a path ending in `.md`):',
  '1. Read the plan document from the path provided',
  D09DA34_ISSUE_STEP,
  '',
].join('\n')

describe('/implement reads the plan frontmatter before setup-task and treats `pending` as absent (§3.9, AC-9)', () => {
  it('Plan Document Handling precedes the setup-task spawn', () => {
    expect(collectOrderViolations('implement.md', requireDistFile('implement.md'), IMPLEMENT_ORDER)).toEqual([])
  })

  it('known-bad probe: the d09da34 order is reported by the same collector', () => {
    expect(collectOrderViolations('d09da34/implement.md', D09DA34_IMPLEMENT_PHASE1, IMPLEMENT_ORDER)).toHaveLength(1)
  })

  it('both sites forward the frontmatter issue and drop `pending`', () => {
    const implement = requireDistFile('implement.md')
    // Non-vacuity: both sites resolve to exactly one line.
    expect(planHandlingIssueStep(implement)).not.toBeNull()
    expect(setupTaskIssueInputLine(implement)).not.toBeNull()
    expect(collectPendingForwarded(implement)).toEqual([])
  })

  it('known-bad probe: the d09da34 Phase 1 is reported at both sites', () => {
    const violations = collectPendingForwarded(D09DA34_IMPLEMENT_PHASE1)
    expect(violations).toHaveLength(2)
    expect(violations[0]).toContain('Plan Document Handling')
    expect(violations[1]).toContain('setup-task payload')
  })

  it('known-bad probe: each site, reverted alone in the shipped file, is reported alone', () => {
    const implement = requireDistFile('implement.md')
    const step = planHandlingIssueStep(implement)
    const line = setupTaskIssueInputLine(implement)
    expect(step).not.toBeNull()
    expect(line).not.toBeNull()
    const seeds: ReadonlyArray<readonly [string, string, string]> = [
      ['Plan Document Handling', step as string, D09DA34_ISSUE_STEP],
      ['setup-task payload', line as string, D09DA34_ISSUE_INPUT],
    ]
    for (const [site, current, historical] of seeds) {
      const violations = collectPendingForwarded(replaceWholeLine(implement, current, historical))
      expect(violations, `reverting ${site} must be reported, and only it`).toHaveLength(1)
      expect(violations[0]).toContain(site)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. /implement PR timing — SINGLE and SEQUENTIAL run the CI gate (§3.10, AC-10)
// ---------------------------------------------------------------------------

const RUN_STRATEGIES = ['SINGLE', 'SEQUENTIAL'] as const
const SKIP_STRATEGY = 'PARALLEL'

/** One statement of which strategies Phase 9 runs for. */
interface TimingSite {
  readonly label: string
  readonly find: (implement: string) => string | null
}

/** The single line of `text` satisfying `match`, or null. */
function soleLine(text: string | null, match: (line: string) => boolean): string | null {
  if (text === null) return null
  const hits = text.split('\n').filter(match)
  return hits.length === 1 ? hits[0] : null
}

/** The three places that say which strategies Phase 9 gates. */
const GATE_SITES: readonly TimingSite[] = [
  {
    label: 'Phase 9 gate sentence',
    find: md => soleLine(sliceBetween(md, '### Phase 9: CI Status Gate', '\n### '), l => l.startsWith('Strategy-conditional:')),
  },
  { label: 'Architecture Phase 9', find: md => soleLine(md, l => l.includes('├─ Phase 9:')) },
  { label: 'Principle 12', find: md => soleLine(md, l => l.startsWith('12. **CI awareness**')) },
]

/** Phase 10's SEQUENTIAL sentence: it must state the PR already exists. */
function phase10SequentialLine(implement: string): string | null {
  return soleLine(sliceBetween(implement, '### Phase 10: Create PR', '\n### '), l => l.startsWith('**For SEQUENTIAL_CODE_AGENTS'))
}

/** Phase 2's `**Produces:**` line — where PR_URL must come from for Phase 9 to require it. */
function phase2ProducesLine(implement: string): string | null {
  return soleLine(sliceBetween(implement, '### Phase 2: Implement', '\n### '), l => l.startsWith('**Produces:**'))
}

/**
 * Named collector: every statement of /implement's PR timing that contradicts
 * the resolution (SINGLE + SEQUENTIAL run Phase 9, PARALLEL skips it).
 *
 * Each gate site is split at its first `skip`: the run set is what precedes it,
 * the skip set what follows. A site with no `skip` clause has an empty skip set,
 * so an unqualified "SINGLE only" is reported for leaving PARALLEL unstated.
 * Beyond the three gate sites: Phase 10 must say the SEQUENTIAL PR already
 * exists, Phase 2 must produce the PR_URL Phase 9 requires, and no line anywhere
 * may pair SEQUENTIAL with "not yet created" — the contradiction itself.
 */
export function collectPrTimingContradictions(implement: string): string[] {
  const out: string[] = []
  for (const site of GATE_SITES) {
    const line = site.find(implement)
    if (line === null) {
      out.push(`${site.label}: site not found (expected exactly one line)`)
      continue
    }
    const skipAt = line.search(/\bskip/i)
    const runSet = skipAt === -1 ? line : line.slice(0, skipAt)
    const skipSet = skipAt === -1 ? '' : line.slice(skipAt)
    for (const strategy of RUN_STRATEGIES) {
      if (!runSet.includes(strategy)) out.push(`${site.label}: ${strategy} is not in the run set`)
      if (skipSet.includes(strategy)) out.push(`${site.label}: ${strategy} is in the skip set`)
    }
    if (runSet.includes(SKIP_STRATEGY)) out.push(`${site.label}: ${SKIP_STRATEGY} is in the run set`)
    if (!skipSet.includes(SKIP_STRATEGY)) out.push(`${site.label}: ${SKIP_STRATEGY} is not in the skip set`)
  }
  const phase10 = phase10SequentialLine(implement)
  if (phase10 === null) out.push('Phase 10 SEQUENTIAL sentence: site not found (expected exactly one line)')
  else if (!phase10.includes('already exists')) out.push('Phase 10 SEQUENTIAL sentence: does not say the PR already exists')
  const produces = phase2ProducesLine(implement)
  if (produces === null) out.push('Phase 2 Produces: site not found (expected exactly one line)')
  else if (!/\bPR_URL\b/.test(produces)) out.push('Phase 2 Produces: does not produce PR_URL, which Phase 9 requires')
  for (const line of implement.split('\n')) {
    if (/sequential/i.test(line) && /not yet created/i.test(line)) {
      out.push(`a line pairs SEQUENTIAL with "not yet created": "${line.trim()}"`)
    }
  }
  return out
}

/** The `d09da34` line at each PR-timing site, quoted verbatim (built). */
const D09DA34_TIMING: Readonly<Record<string, string>> = {
  'Phase 9 gate sentence':
    'Strategy-conditional: run for **SINGLE_CODE_AGENT** (PR exists from Phase 2), skip for ' +
    '**SEQUENTIAL_CODE_AGENTS** / **PARALLEL_CODE_AGENTS** (PR not yet created).',
  'Architecture Phase 9': '├─ Phase 9: CI Status Gate (SINGLE_CODE_AGENT only)',
  'Principle 12': '12. **CI awareness** - CI status is checked before merge for SINGLE_CODE_AGENT strategy',
  'Phase 10 SEQUENTIAL sentence':
    '**For SEQUENTIAL_CODE_AGENTS or PARALLEL_CODE_AGENTS**: The last sequential Code agent (with ' +
    'CREATE_PR: true) handles PR creation. For parallel Code agents, spawn one Code agent to create the unified PR:',
  'Phase 2 Produces': '**Produces:** CODE_AGENT_OUTPUT, FILES_CHANGED',
}

/** Each site's finder, keyed by the label its violations carry. */
const TIMING_FINDERS: Readonly<Record<string, (implement: string) => string | null>> = {
  ...Object.fromEntries(GATE_SITES.map(site => [site.label, site.find])),
  'Phase 10 SEQUENTIAL sentence': phase10SequentialLine,
  'Phase 2 Produces': phase2ProducesLine,
}

describe('/implement PR timing — SINGLE and SEQUENTIAL gate CI, PARALLEL skips (§3.10, AC-10)', () => {
  it('every site agrees with the resolution, and nothing pairs SEQUENTIAL with "not yet created"', () => {
    const implement = requireDistFile('implement.md')
    // Non-vacuity: every site resolves to exactly one line of the shipped file.
    for (const [label, find] of Object.entries(TIMING_FINDERS)) {
      expect(find(implement), `${label} not found`).not.toBeNull()
    }
    expect(collectPrTimingContradictions(implement)).toEqual([])
  })

  it('known-bad probe: each site, reverted alone to its d09da34 line, is reported by name', () => {
    const implement = requireDistFile('implement.md')
    // Probe cardinality matches arm cardinality: one probe per site the live arm reads.
    expect(Object.keys(D09DA34_TIMING).sort()).toEqual(Object.keys(TIMING_FINDERS).sort())
    for (const [label, historical] of Object.entries(D09DA34_TIMING)) {
      const current = TIMING_FINDERS[label](implement)
      expect(current, `${label} not found`).not.toBeNull()
      const violations = collectPrTimingContradictions(replaceWholeLine(implement, current as string, historical))
      expect(violations.length, `reverting ${label} must be reported`).toBeGreaterThan(0)
      expect(
        violations.every(v => v.startsWith(label) || v.includes('"not yet created"')),
        `reverting ${label} must be reported against that site only:\n  ${violations.join('\n  ')}`,
      ).toBe(true)
    }
  })

  it('known-bad probe: the d09da34 Phase 9 sentence is also the SEQUENTIAL/"not yet created" contradiction', () => {
    const violations = collectPrTimingContradictions(D09DA34_TIMING['Phase 9 gate sentence'])
    expect(violations.some(v => v.includes('pairs SEQUENTIAL with "not yet created"'))).toBe(true)
  })
})

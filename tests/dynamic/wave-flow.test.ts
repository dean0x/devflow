/**
 * tests/dynamic/wave-flow.test.ts
 *
 * SDLC-evidence PR6 (#365), phase P3 — /dynamic-build around the wave PR.
 *
 *   AC-10  each ticket's setup-task gets that ticket's OWN reference, its Code
 *          agents get the Issue ID and link line captured from that setup-task,
 *          and the wave's tracking issue reaches no ticket. (The bug this fixes:
 *          the wave handed the tracking issue to every ticket.)
 *   AC-11  with issues required, a ticket with no captured Issue ID stops before
 *          implementation (ESCALATED `ticket-link-missing`); a wave quarantines
 *          it and cascades to its dependents; nothing records an exception.
 *   AC-12  every verdict the engine schema declares has exactly one wave arm:
 *          PASS and UNVERIFIED merge, every other value — or none — quarantines,
 *          and an UNVERIFIED ticket renders its closing line on a flagged row.
 *   AC-13  the wave PR opens only on `wave/<slug>`, with a merged ticket and an
 *          explicit "open"; a headless or declined ask creates nothing; a
 *          non-wave head degrades; a required-plan gap blocks; and under
 *          `required` a merged row that links no ticket blocks it too.
 *   AC-8   (its flow half) the two frozen dynamic-build anchors stay the first
 *          occurrences, and every new step sits below them.
 *   W2     (#376) the engine works on the branch its setup-task created, used
 *          verbatim in every phase and the merge; it mints no name, and a
 *          setup-task that reports none stops the ticket (ESCALATED
 *          `branch-missing`) — a correctness stop, not a shape gate.
 *   W3     (#376) with a tracking issue, the rendered wave block leads with its
 *          `Refs` line, and `check wave` admits it.
 *   W1     (#376) after the wave PR opens, step 7 runs one Test agent on the
 *          integration worktree, appends `/implement`'s TP claims to the wave
 *          evidence file, pushes (never forced) and refreshes the PR through
 *          `update-pr-evidence` — never blocking.
 *
 * The engine and the wave loop are checked by EXECUTING the shipped skeletons —
 * the SINGLE workflow script and the wave round loop, both read from the built
 * dynamic-build.md — with stub agents that answer each agent's return contract
 * and record every spawn. A wording pin would stay green over a loop that hands
 * a ticket the wrong reference.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe driven through the same collector.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { createHash } from 'crypto'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { ROOT, parseFences, requireDistFile } from '../helpers.js'
import { PR_EVIDENCE_SCRIPT, VERIFY_EVIDENCE_SCRIPT } from '../evidence/seam.js'

const BUILT = requireDistFile('dynamic-build.md')
const BUILD_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'dynamic-build.mds'), 'utf-8')
const WAVE_PARTIAL = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_wave.mds'), 'utf-8')

interface VerifyEvidence {
  main(argv: readonly string[], deps?: { stderr?: (t: string) => void }): { code: number; stdout: string }
}
const VE = createRequire(import.meta.url)(VERIFY_EVIDENCE_SCRIPT) as VerifyEvidence
const PE = createRequire(import.meta.url)(PR_EVIDENCE_SCRIPT) as { readonly CLAIM_LINE_RE: RegExp }

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-wave-flow-'))
afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }))

// ---------------------------------------------------------------------------
// Shared text utilities
// ---------------------------------------------------------------------------

/** Every start offset of a non-empty `needle` in `text`. Bounded: each hit moves past the needle. */
function offsetsOf(text: string, needle: string): number[] {
  const out: number[] = []
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) out.push(at)
  return out
}

/** Replace the single occurrence of `from`; throws when there is none or several — an inert seed proves nothing. */
function seedOnce(text: string, from: string, to: string): string {
  const hits = offsetsOf(text, from).length
  if (hits !== 1) throw new Error(`seedOnce: expected exactly one "${from.slice(0, 80)}", found ${hits} — the seed is inert`)
  return text.replace(from, () => to)
}

/** A fence's body: the lines between its opening and closing markers. */
function fenceBody(fence: string): string {
  return fence.slice(fence.indexOf('\n') + 1, fence.lastIndexOf('```'))
}

// ---------------------------------------------------------------------------
// The two shipped skeletons, as executable bodies
// ---------------------------------------------------------------------------

const SINGLE_MARKER = 'name: "devflow-dynamic-build"'
const WAVE_ENGINE_CALL = 'const engineResult = await runSingleTicketEngine('
/** The engine's one Issue ID binding: setup-task's capture, shape-gated so a non-ID value is no capture. */
const CAPTURE_LINE = 'const ISSUE_NUMBER = ISSUE_ID_SHAPE.test(String(setup?.issueId ?? "")) ? setup.issueId : "(none)";'

/** The SINGLE workflow script with its pure-literal `export const meta` dropped, or null. */
export function singleEngineBody(built: string): string | null {
  const hits = parseFences(built).filter(f => f.includes(SINGLE_MARKER))
  if (hits.length !== 1) return null
  const body = fenceBody(hits[0])
  const metaEnd = body.indexOf('\n};\n')
  return body.startsWith('export const meta = {') && metaEnd !== -1 ? body.slice(metaEnd + 4) : null
}

/** The wave round loop, or null unless exactly one fence carries the engine call. */
export function waveLoopBody(built: string): string | null {
  const hits = parseFences(built).filter(f => f.includes(WAVE_ENGINE_CALL))
  return hits.length === 1 ? fenceBody(hits[0]) : null
}

const SINGLE = singleEngineBody(BUILT)
const WAVE = waveLoopBody(BUILT)

type AsyncFn = (...args: unknown[]) => Promise<unknown>
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...params: string[]) => AsyncFn

interface Spawn { readonly agentType: string; readonly prompt: string }
type Agent = (prompt: string, opts: { agentType: string }) => Promise<unknown>
type EngineResult = Record<string, unknown> & { verdict?: string; escalations?: Array<{ type: string }> }

/** What one ticket's world answers: its setup-task Output and its Test verdict. */
interface TicketScript {
  /**
   * `- **Branch name**:` — absent ⇒ the branch a real setup-task derives (createdBranch);
   * null ⇒ setup-task reports none; a string ⇒ exactly that.
   */
  readonly branch?: string | null
  /** `- **Issue ID**:` — absent ⇒ setup-task captured none. */
  readonly issueId?: string
  /** `- **PR link line**:` — absent ⇒ none. */
  readonly prLinkLine?: string
  /** FAIL ⇒ fixed and recorded FAIL-FIXED ⇒ the run is UNVERIFIED. */
  readonly test?: 'PASS' | 'FAIL'
}

interface World {
  /** Keyed by the raw reference setup-task receives as ISSUE_INPUT. */
  readonly tickets: Readonly<Record<string, TicketScript>>
  /** The wave's input order. */
  readonly order?: readonly string[]
  readonly deps?: Readonly<Record<string, readonly string[]>>
  /** Tickets whose merge Git keeps but whose post-merge build is red: the workflow's Validate returns FAIL. */
  readonly failMerge?: readonly string[]
  /** Tickets whose merge Git itself refuses (`merged: false`). */
  readonly refuseMerge?: readonly string[]
  /** Tickets whose red merge Git will not undo (`undone: false`). */
  readonly refuseUndo?: readonly string[]
  /** Tickets whose Gate 1 Validate never passes: the pass is exhausted after two Code fixes. */
  readonly gate1Red?: readonly string[]
  /** Tickets whose Scrutinize agent returns BLOCKED, in Gate 1 #1. */
  readonly scrutinyBlocked?: readonly string[]
  /** Tickets whose Scrutinize agent returns BLOCKED only in the final Gate 1 (#2). */
  readonly scrutinyBlockedFinal?: readonly string[]
  /**
   * Raw returns for a ticket's Scrutinize spawns, in order: the first answers Gate 1 #1, the
   * second the final Gate 1. A spawn past the list answers PASS. This is how a Scrutinize
   * that returns no status, or one the skeleton does not know, is scripted.
   */
  readonly scrutinyReturns?: Readonly<Record<string, readonly unknown[]>>
  /** Tickets whose merge Git reports without a usable mergeSha. */
  readonly badMergeSha?: readonly string[]
  /** Tickets whose Evaluate agent answers FAIL. */
  readonly evaluateFail?: readonly string[]
  /** Ready IDs the reader adds that are not in the remaining set — an invented or injected ticket. */
  readonly injectReady?: readonly string[]
}

/**
 * The branch a stub setup-task creates when its script names none — the shape a
 * real one derives from the issue (`#12` → `feat/12-work`), and never the
 * `ticket/<slug>` shape the engine used to mint.
 */
function createdBranch(ref: string): string {
  return `feat/${ref.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}-work`
}

/** The `- **Branch name**:` a stub setup-task reports for `ref`: its script's, else createdBranch's; undefined ⇒ none. */
function reportedBranch(world: World, ref: string): string | undefined {
  const b = world.tickets[ref]?.branch
  return b === undefined ? createdBranch(ref) : b ?? undefined
}

/**
 * A stub agent for every type the two skeletons spawn. Each answers the return
 * contract its prompt pins, and every spawn is recorded in order. The ticket a
 * spawn belongs to is the one whose setup-task ran last — the engine runs its
 * phases in sequence, so that is exact.
 */
function stubAgent(world: World, spawns: Spawn[]): Agent {
  let current: TicketScript = {}
  let currentRef = ''
  /** merge commit → the ticket it merged, so the workflow's Validate and the undo are answered per ticket. */
  const mergedBy = new Map<string, string>()
  /** Scrutinize spawns seen per ticket: the second one is the final Gate 1. */
  const scrutinized = new Map<string, number>()
  return async (prompt, opts) => {
    spawns.push({ agentType: opts.agentType, prompt })
    if (opts.agentType === 'Design') {
      const remaining = JSON.parse(/^Remaining: (.*)$/m.exec(prompt)?.[1] ?? '[]') as string[]
      const quarantined = (JSON.parse(/^Quarantined [^:]*: (.*)$/m.exec(prompt)?.[1] ?? '[]') as Array<{ ticket: string }>).map(q => q.ticket)
      // The reader's rule: every named dependency has left the remaining set, and none was quarantined (the cascade).
      const ready = remaining.filter(t => (world.deps?.[t] ?? []).every(d => !remaining.includes(d) && !quarantined.includes(d)))
      return { ready: [...ready, ...(world.injectReady ?? [])], blocked: [] }
    }
    if (opts.agentType === 'Git' && prompt.startsWith('OPERATION: setup-task')) {
      const ref = /^ISSUE_INPUT: (.*)$/m.exec(prompt)?.[1] ?? '(none)'
      currentRef = ref
      current = world.tickets[ref] ?? {}
      return { branch: reportedBranch(world, ref), issueId: current.issueId, prLinkLine: current.prLinkLine }
    }
    if (opts.agentType === 'Git' && prompt.startsWith('Merge ')) {
      // The ticket is the ID the merge prompt names, never parsed back out of the branch spelling.
      const id = /Include ticket ID (\S+) in the merge commit message/.exec(prompt)?.[1] ?? ''
      if (world.refuseMerge?.includes(id)) return { merged: false, reason: 'merge conflict' }
      if (world.badMergeSha?.includes(id)) return { merged: true }
      const mergeSha = createHash('sha1').update(`merge:${id}`).digest('hex')
      mergedBy.set(mergeSha, id)
      return { merged: true, mergeSha, treeEqual: true }
    }
    if (opts.agentType === 'Git' && prompt.startsWith('Undo the merge ')) {
      const sha = /^Undo the merge ([0-9a-f]{40}) on /.exec(prompt)?.[1] ?? ''
      return world.refuseUndo?.includes(mergedBy.get(sha) ?? '') ? { undone: false, reason: 'integration HEAD moved' } : { undone: true }
    }
    if (opts.agentType === 'Validate' && prompt.includes('(merge commit ')) {
      // The workflow's post-merge Validate: red for a failMerge ticket, keyed by the merge commit it names.
      const sha = /\(merge commit ([0-9a-f]{40})\)/.exec(prompt)?.[1] ?? ''
      return world.failMerge?.includes(mergedBy.get(sha) ?? '') ? { verdict: 'FAIL', details: 'build red' } : { verdict: 'PASS' }
    }
    if (opts.agentType === 'Validate' && world.gate1Red?.includes(currentRef)) return { verdict: 'FAIL', details: 'tests red' }
    if (opts.agentType === 'Test') return { verdict: current.test ?? 'PASS', failures: 'TP-1 failed' }
    if (opts.agentType === 'Review') return { focus: 'x', reviewed: true, filesExamined: [], findings: [] }
    if (opts.agentType === 'Scrutinize') {
      const nth = (scrutinized.get(currentRef) ?? 0) + 1
      scrutinized.set(currentRef, nth)
      const scripted = world.scrutinyReturns?.[currentRef]
      if (scripted !== undefined && nth <= scripted.length) return scripted[nth - 1]
      const blocked = world.scrutinyBlocked?.includes(currentRef) || (nth === 2 && world.scrutinyBlockedFinal?.includes(currentRef))
      return { status: blocked ? 'BLOCKED' : 'PASS' }
    }
    if (opts.agentType === 'Evaluate') return world.evaluateFail?.includes(currentRef) ? { verdict: 'FAIL', rationale: 'criterion 2 is not met' } : { verdict: 'PASS', rationale: 'ok' }
    if (opts.agentType === 'Code') return { status: 'fixed', commitShas: ['abc1234'], unresolved: [] }
    return { verdict: 'PASS' }
  }
}

/** Run the SINGLE engine body over `args` with `agent`. */
async function runEngine(body: string, args: Record<string, unknown>, agent: Agent): Promise<EngineResult> {
  const phase = async (_n: string, fn: () => Promise<unknown>): Promise<unknown> => fn()
  const parallel = async (ts: Array<() => Promise<unknown>>): Promise<unknown[]> => Promise.all(ts.map(t => t()))
  const log = (): void => undefined
  const run = new AsyncFunction('args', 'phase', 'agent', 'parallel', 'log', body)
  return (await run(args, phase, agent, parallel, log)) as EngineResult
}

interface WaveRow {
  readonly ticket: string
  readonly ran: boolean
  readonly verdict: string | null
  readonly merged: boolean
  readonly treeEqual?: boolean | null
  readonly issuePrLink: string
  readonly evaluateVerdict?: string
  readonly testVerdict?: string
  readonly surviving?: number
  readonly coverageComplete?: boolean
}

/** One engine run the wave started: the args it passed, the result the engine returned, and the spawns it made. */
interface EngineRun {
  readonly args: Readonly<Record<string, unknown>>
  readonly result: EngineResult
  readonly spawns: readonly Spawn[]
}

interface WaveRun {
  readonly tickets: readonly WaveRow[]
  readonly quarantined: ReadonlyArray<{ ticket: string; reason: string }>
  readonly halted: { ticket: string; mergeSha: string | null; reason: string } | null
  readonly spawns: readonly Spawn[]
  readonly engines: readonly EngineRun[]
}

/** The wave's tracking issue: its values are in scope of the loop, and must reach no ticket. */
const TRACKING = '#99'
/** The wave's integration branch, the loop's INTEGRATION_BRANCH: every ticket's setup-task branches from it. */
const INTEGRATION = 'wave/demo'

/**
 * Run the wave loop body with the real SINGLE engine as `runSingleTicketEngine`.
 * The tracking issue's number and link line are in the loop's scope exactly as
 * the wave workflow has them, so a call that forwards them is visible.
 */
async function runWave(
  waveBody: string,
  engineBody: string,
  world: World,
  plans: Readonly<Record<string, Record<string, unknown>>>,
  issueRequired: 'true' | 'false',
): Promise<WaveRun> {
  const spawns: Spawn[] = []
  const engines: EngineRun[] = []
  const agent = stubAgent(world, spawns)
  const engine = async (args: Record<string, unknown>): Promise<EngineResult> => {
    const from = spawns.length
    const result = await runEngine(engineBody, args, agent)
    engines.push({ args, result, spawns: spawns.slice(from) })
    return result
  }
  const run = new AsyncFunction(
    'agent', 'runSingleTicketEngine', 'remainingTickets', 'INTEGRATION_BRANCH', 'plans', 'DECISIONS_CONTEXT',
    'ISSUE_REQUIRED', 'APPLY_CONVENTIONS', 'COMPLIANCE_FRAMEWORKS', 'ISSUE_NUMBER', 'ISSUE_PR_LINK', waveBody,
  )
  const order = world.order ?? Object.keys(world.tickets)
  const out = (await run(
    agent, engine, [...order], INTEGRATION, plans, '(none)', issueRequired, 'true', 'off', TRACKING, `Closes ${TRACKING}`,
  )) as { tickets: WaveRow[]; quarantined: Array<{ ticket: string; reason: string }>; halted: WaveRun['halted'] }
  return { ...out, spawns, engines }
}

describe('the two skeletons this suite executes', () => {
  it('are each exactly one fence, and the SINGLE body runs from the constants to the report phase', () => {
    expect(SINGLE, 'the SINGLE workflow fence must be found with its meta block').not.toBeNull()
    expect(SINGLE!).toContain('const ISSUE_INPUT = ')
    expect(SINGLE!).toContain('return phase("report"')
    expect(WAVE, 'exactly one fence must carry the engine call').not.toBeNull()
    expect(WAVE!).toContain('return { tickets: ')
  })
})

// ---------------------------------------------------------------------------
// AC-10 — each ticket's own reference in, its captured values out
// ---------------------------------------------------------------------------

const TP_12 = '- [ ] TP-1 (AC-1) the login form rejects an empty password — method:ci'
const TP_13 = '- [ ] TP-1 (AC-1) the audit log records each failed login — method:ci'

/**
 * Named collector: where the executed SINGLE engine hands a Code agent anything
 * but the values setup-task captured. The input token (`#42`) and the captured
 * Issue ID (`42`) differ on purpose: an engine that forwards its input instead of
 * its capture is then visible.
 */
export async function collectEngineHandoffViolations(body: string | null): Promise<string[]> {
  if (body === null) return ['the SINGLE engine body was not found']
  const spawns: Spawn[] = []
  const world: World = { tickets: { '#42': { issueId: '42', prLinkLine: 'Closes #42', test: 'FAIL' } } }
  const result = await runEngine(body, { ticket: 'add login', issueNumber: '#42', criteria: '1. works', issueRequired: 'true' }, stubAgent(world, spawns))
  const out: string[] = []
  const setups = spawns.filter(s => s.prompt.startsWith('OPERATION: setup-task'))
  if (setups.length !== 1 || !setups[0].prompt.split('\n').includes('ISSUE_INPUT: #42')) out.push('setup-task: it does not receive the ticket\'s own reference as ISSUE_INPUT')
  const codes = spawns.filter(s => s.agentType === 'Code')
  if (codes.length < 2) out.push(`code: expected the implement and the Test-fix Code spawns, got ${codes.length}`)
  for (const c of codes) {
    const lines = c.prompt.split('\n')
    if (!lines.includes('ISSUE_NUMBER: 42') || !lines.includes('ISSUE_PR_LINK: Closes #42')) {
      out.push(`code: a Code spawn carries ${lines.filter(l => l.startsWith('ISSUE_')).join(' / ')}, not the captured Issue ID and link line`)
      break
    }
  }
  if (result?.issueId !== '42' || result?.issuePrLink !== 'Closes #42') out.push('result: the engine result does not carry the captured issueId and issuePrLink')
  return out
}

/**
 * Named collector: where the executed wave hands a ticket anything but its own
 * reference and its own test plan, or lets the tracking issue reach any spawn.
 */
export function collectWaveHandoffViolations(run: WaveRun, own: Readonly<Record<string, string>>): string[] {
  const out: string[] = []
  const inputs = run.spawns.filter(s => s.prompt.startsWith('OPERATION: setup-task')).map(s => /^ISSUE_INPUT: (.*)$/m.exec(s.prompt)?.[1] ?? '(none)')
  const expected = Object.keys(own)
  if (JSON.stringify(inputs) !== JSON.stringify(expected)) out.push(`setup-task inputs were ${JSON.stringify(inputs)}, each ticket's own reference is ${JSON.stringify(expected)}`)
  const leaks = run.spawns.filter(s => s.prompt.includes(TRACKING))
  if (leaks.length > 0) out.push(`the tracking issue ${TRACKING} reached ${leaks.length} spawn(s): ${[...new Set(leaks.map(s => s.agentType))].join(', ')}`)
  const tests = run.spawns.filter(s => s.agentType === 'Test')
  for (const [ref, tp] of Object.entries(own)) {
    if (!tests.some(t => t.prompt.includes(`TEST_PLAN: ${tp}\n`))) out.push(`${ref}: its Test agent never received its own test plan`)
  }
  return out
}

/** The d9d1c8e wave call: the tracking issue's number and link line, and every plan at once. */
const D9D1C8E_ENGINE_CALL =
  'const engineResult = await runSingleTicketEngine({ ticketId, integrationBranch: INTEGRATION_BRANCH, plans, decisionsContext: DECISIONS_CONTEXT, issueNumber: ISSUE_NUMBER, issuePrLink: ISSUE_PR_LINK });'

/** The shipped wave call line, whole. */
function shippedEngineCall(wave: string): string {
  return wave.split('\n').find(l => l.includes(WAVE_ENGINE_CALL))!.trim()
}

const TWO_TICKETS: World = {
  tickets: {
    '#12': { issueId: '12', prLinkLine: 'Closes #12' },
    '#13': { issueId: '13', prLinkLine: 'Closes #13' },
  },
}
const TWO_PLANS = { '#12': { criteria: '1. rejects', testPlan: TP_12 }, '#13': { criteria: '1. records', testPlan: TP_13 } }

describe('AC-10: each ticket gets its own reference; its Code agents get what setup-task captured', () => {
  it('the SINGLE engine hands setup-task the input and its Code agents only the captured values', async () => {
    expect(await collectEngineHandoffViolations(SINGLE)).toEqual([])
  })

  it('the engine call carries issueInput: ticketId, the ticket\'s own plan, and no tracking-issue arg', () => {
    const call = shippedEngineCall(WAVE!)
    expect(call).toContain('issueInput: ticketId')
    expect(call).toContain('...(plans[ticketId] || {})')
    for (const tracking of ['issueNumber:', 'issuePrLink:', 'ISSUE_NUMBER', 'ISSUE_PR_LINK']) expect(call).not.toContain(tracking)
  })

  it('executed: every setup-task gets its own ticket\'s reference, and the tracking issue reaches no spawn', async () => {
    const run = await runWave(WAVE!, SINGLE!, TWO_TICKETS, TWO_PLANS, 'true')
    expect(run.spawns.length, 'the wave must have spawned the engines').toBeGreaterThan(10)
    expect(collectWaveHandoffViolations(run, { '#12': TP_12, '#13': TP_13 })).toEqual([])
    expect(run.tickets.map(t => [t.ticket, t.merged, t.issuePrLink])).toEqual([['#12', true, 'Closes #12'], ['#13', true, 'Closes #13']])
  })

  /** The shipped reader-result line: the ready set, narrowed to the pre-fetch's own refs. */
  const READY_LINE = 'const ready = (waveRead?.ready || []).filter(t => remainingTickets.includes(t));'
  const INVENTED = '#777'

  it('executed: a ready ID the reader invents never reaches an engine, and no row is added for it', async () => {
    const run = await runWave(WAVE!, SINGLE!, { ...TWO_TICKETS, injectReady: [INVENTED] }, TWO_PLANS, 'true')
    expect(run.spawns.some(s => s.agentType === 'Design'), 'the reader must have run').toBe(true)
    expect(run.spawns.filter(s => s.prompt.includes(INVENTED) && s.agentType !== 'Design')).toEqual([])
    expect(run.tickets.map(t => t.ticket)).toEqual(['#12', '#13'])
  })

  it('known-bad probe: an unfiltered ready set hands the invented ID to setup-task', async () => {
    const unfiltered = seedOnce(WAVE!, READY_LINE, 'const ready = waveRead?.ready || [];')
    const run = await runWave(unfiltered, SINGLE!, { ...TWO_TICKETS, injectReady: [INVENTED] }, TWO_PLANS, 'true')
    expect(run.spawns.some(s => s.prompt.startsWith('OPERATION: setup-task') && s.prompt.split('\n').includes(`ISSUE_INPUT: ${INVENTED}`))).toBe(true)
  })

  it('known-bad probe: the d9d1c8e call hands every ticket the tracking issue and no test plan', async () => {
    const d9d1c8e = seedOnce(WAVE!, shippedEngineCall(WAVE!), D9D1C8E_ENGINE_CALL)
    const run = await runWave(d9d1c8e, SINGLE!, TWO_TICKETS, TWO_PLANS, 'true')
    const found = collectWaveHandoffViolations(run, { '#12': TP_12, '#13': TP_13 })
    expect(found[0]).toBe('setup-task inputs were ["#99","#99"], each ticket\'s own reference is ["#12","#13"]')
    expect(found.some(f => f.startsWith(`the tracking issue ${TRACKING} reached`))).toBe(true)
    expect(found.filter(f => f.endsWith('never received its own test plan'))).toHaveLength(2)
  })

  it('known-bad probe: an engine that forwards its input token, not its capture, is reported', async () => {
    const forwarded = seedOnce(SINGLE!, CAPTURE_LINE, 'const ISSUE_NUMBER = ISSUE_INPUT;')
    expect(await collectEngineHandoffViolations(forwarded)).toEqual([
      expect.stringMatching(/^code: a Code spawn carries ISSUE_NUMBER: #42/),
      'result: the engine result does not carry the captured issueId and issuePrLink',
    ])
    expect(await collectEngineHandoffViolations(null)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// W2 (#376) — the engine works on the branch its setup-task created, verbatim,
// off the integration branch; it never mints one, and the merge names that
// branch. A setup-task that reports no branch stops the ticket.
// ---------------------------------------------------------------------------

/** The SINGLE engine's fallback ticket: no wave ticket may run under it. */
const FALLBACK_TICKET = 'see task description'

/** The branch prefix the engine minted before W2: no spawn may name a branch of it. */
const MINTED_PREFIX = 'ticket/'

/** Every setup-task's `BASE_BRANCH:` value, in spawn order; `(absent)` for a setup-task with no such line. */
function setupBaseBranches(run: WaveRun): string[] {
  return run.spawns
    .filter(s => s.prompt.startsWith('OPERATION: setup-task'))
    .map(s => /^BASE_BRANCH: (.*)$/m.exec(s.prompt)?.[1] ?? '(absent)')
}

/**
 * Named collector: where a wave ticket's engine run works under anything but its
 * own ticket — the engine's fallback included — or its setup-task branches from
 * anything but the integration branch, or the engine works on, returns or merges
 * any branch but the one its setup-task created, as that setup-task reported it.
 * `own` is the wave's refs, in run order; each ticket's setup-task is the one
 * whose ISSUE_INPUT is its ref, and `world` says which branch it reported.
 */
export function collectWaveTicketContextViolations(run: WaveRun, own: readonly string[], world: World): string[] {
  const out: string[] = []
  const tickets = run.engines.map(e => e.result.ticket)
  if (JSON.stringify(tickets) !== JSON.stringify(own)) out.push(`engine tickets were ${JSON.stringify(tickets)}, each ticket's own reference is ${JSON.stringify(own)}`)
  const fallbacks = run.spawns.filter(s => s.prompt.includes(FALLBACK_TICKET))
  if (fallbacks.length > 0) out.push(`the engine fallback reached ${fallbacks.length} spawn(s): ${[...new Set(fallbacks.map(s => s.agentType))].join(', ')}`)
  const setups = run.spawns.filter(s => s.prompt.startsWith('OPERATION: setup-task'))
  const merges = run.spawns.filter(s => s.agentType === 'Git' && s.prompt.startsWith('Merge '))
  for (const ref of own) {
    const setup = setups.find(s => s.prompt.split('\n').includes(`ISSUE_INPUT: ${ref}`))
    const base = setup === undefined ? undefined : /^BASE_BRANCH: (.*)$/m.exec(setup.prompt)?.[1]
    if (base !== INTEGRATION) out.push(`${ref}: its setup-task branches from ${base ?? 'no base'}, not the integration branch ${INTEGRATION}`)
    const created = reportedBranch(world, ref)
    const engine = run.engines.find(e => e.args.issueInput === ref)
    const built = engine?.result.branch
    if (built !== created) out.push(`${ref}: its engine built on ${String(built ?? 'no branch')}, its setup-task created ${created ?? 'none'}`)
    const offBranch = (engine?.spawns ?? []).filter(s => !s.prompt.startsWith('OPERATION: setup-task') && (created === undefined || !s.prompt.includes(created)))
    if (offBranch.length > 0) out.push(`${ref}: ${offBranch.length} spawn(s) after setup-task do not work on ${created ?? 'a branch'}: ${[...new Set(offBranch.map(s => s.agentType))].join(', ')}`)
    const merge = merges.find(m => m.prompt.includes(`Include ticket ID ${ref} in`))
    const merged = merge === undefined ? undefined : /^Merge (\S+) to /.exec(merge.prompt)?.[1]
    if (merge !== undefined && merged !== created) out.push(`${ref}: the merge step names ${merged ?? 'no branch'}, its setup-task created ${created ?? 'none'}`)
  }
  const minted = run.spawns.filter(s => s.prompt.includes(MINTED_PREFIX))
  if (minted.length > 0) out.push(`a minted ${MINTED_PREFIX}<slug> branch reached ${minted.length} spawn(s): ${[...new Set(minted.map(s => s.agentType))].join(', ')}`)
  return out
}

/** Two tickets whose setup-tasks name their own branches — one unlike anything the engine could derive. */
const OWN_BRANCHES: World = {
  tickets: {
    '#12': { branch: 'user/Login_Form.v2', issueId: '12', prLinkLine: 'Closes #12' },
    '#13': { issueId: '13', prLinkLine: 'Closes #13' },
  },
}

describe('W2: each wave ticket works on the branch its setup-task created, off the integration branch, and the merge names it', () => {
  /** The shipped call's ticket key: `ticket`, the key the SINGLE engine reads (`args.ticket`). */
  const TICKET_KEY = 'runSingleTicketEngine({ ticket: ticketId,'
  /** The shipped call's base key: `baseBranch`, the key the SINGLE engine reads (`args.baseBranch`). */
  const BASE_KEY = 'baseBranch: INTEGRATION_BRANCH,'
  /** The shipped merge lead: the branch the engine returned, the one its agents built on. */
  const MERGE_LEAD = 'Merge ${engineResult.branch} to '

  it('executed: each engine uses its setup-task\'s branch verbatim in every phase, and the merge names it', async () => {
    const run = await runWave(WAVE!, SINGLE!, OWN_BRANCHES, TWO_PLANS, 'true')
    expect(run.spawns.length, 'the wave must have spawned the engines').toBeGreaterThan(10)
    expect(run.engines.map(e => [e.result.ticket, e.result.branch])).toEqual([['#12', 'user/Login_Form.v2'], ['#13', 'feat/13-work']])
    expect(run.spawns.filter(s => s.prompt.startsWith('Merge ')).map(s => s.prompt.split(' to ')[0])).toEqual(['Merge user/Login_Form.v2', 'Merge feat/13-work'])
    expect(collectWaveTicketContextViolations(run, ['#12', '#13'], OWN_BRANCHES)).toEqual([])
  })

  it('executed: each ticket\'s setup-task branches from the integration branch, never HEAD', async () => {
    const run = await runWave(WAVE!, SINGLE!, TWO_TICKETS, TWO_PLANS, 'true')
    expect(setupBaseBranches(run)).toEqual([INTEGRATION, INTEGRATION])
    expect(collectWaveTicketContextViolations(run, ['#12', '#13'], TWO_TICKETS)).toEqual([])
  })

  it('known-bad probe: the unread `integrationBranch` key leaves every setup-task on BASE_BRANCH: HEAD', async () => {
    const unread = seedOnce(WAVE!, BASE_KEY, 'integrationBranch: INTEGRATION_BRANCH,')
    const run = await runWave(unread, SINGLE!, TWO_TICKETS, TWO_PLANS, 'true')
    expect(setupBaseBranches(run)).toEqual(['HEAD', 'HEAD'])
    expect(collectWaveTicketContextViolations(run, ['#12', '#13'], TWO_TICKETS)).toEqual([
      '#12: its setup-task branches from HEAD, not the integration branch wave/demo',
      '#13: its setup-task branches from HEAD, not the integration branch wave/demo',
    ])
  })

  it('executed: a keyed reference works on the branch its setup-task reported, as reported', async () => {
    const world: World = { tickets: { 'ENG-12': { branch: 'feature/ENG-12-sso', issueId: 'ENG-12', prLinkLine: 'Refs ENG-12' } } }
    const run = await runWave(WAVE!, SINGLE!, world, {}, 'true')
    expect(run.engines.map(e => e.result.branch)).toEqual(['feature/ENG-12-sso'])
    expect(collectWaveTicketContextViolations(run, ['ENG-12'], world)).toEqual([])
  })

  it('known-bad probe: the mismatched `ticketId` key leaves every engine on the fallback ticket', async () => {
    const misKeyed = seedOnce(WAVE!, TICKET_KEY, 'runSingleTicketEngine({ ticketId,')
    const run = await runWave(misKeyed, SINGLE!, TWO_TICKETS, TWO_PLANS, 'true')
    const found = collectWaveTicketContextViolations(run, ['#12', '#13'], TWO_TICKETS)
    expect(found[0]).toBe('engine tickets were ["see task description","see task description"], each ticket\'s own reference is ["#12","#13"]')
    expect(found[1]).toMatch(/^the engine fallback reached \d+ spawn\(s\): Git, Code/)
    expect(found).toHaveLength(2)
  })

  it('known-bad probe: a merge that names ticket/<raw ref> disagrees with the branch setup-task created', async () => {
    const rawMerge = seedOnce(WAVE!, MERGE_LEAD, 'Merge ticket/${ticketId} to ')
    const run = await runWave(rawMerge, SINGLE!, TWO_TICKETS, TWO_PLANS, 'true')
    expect(collectWaveTicketContextViolations(run, ['#12', '#13'], TWO_TICKETS)).toEqual([
      '#12: the merge step names ticket/#12, its setup-task created feat/12-work',
      '#13: the merge step names ticket/#13, its setup-task created feat/13-work',
      'a minted ticket/<slug> branch reached 2 spawn(s): Git',
    ])
  })

  it('known-bad probe: the 0e520fc engine, which minted ticket/<slug> over setup-task\'s branch, is reported', async () => {
    const minting = seedOnce(SINGLE!, BRANCH_LINE, 'const BRANCH = args.branch || `ticket/${TICKET.replace(/[^a-z0-9]/gi, \'-\').toLowerCase()}`;')
    const run = await runWave(WAVE!, minting, TWO_TICKETS, TWO_PLANS, 'true')
    const found = collectWaveTicketContextViolations(run, ['#12', '#13'], TWO_TICKETS)
    expect(found).toContain('#12: its engine built on ticket/-12, its setup-task created feat/12-work')
    expect(found).toContain('#13: the merge step names ticket/-13, its setup-task created feat/13-work')
    expect(found.some(f => f.startsWith('#12: ') && f.includes('spawn(s) after setup-task do not work on feat/12-work'))).toBe(true)
    expect(found[found.length - 1]).toMatch(/^a minted ticket\/<slug> branch reached \d+ spawn\(s\)/)
  })
})

/** The engine's one BRANCH binding: setup-task's reported branch, verbatim, or "(none)". */
const BRANCH_LINE = 'const BRANCH = typeof setup?.branch === "string" && setup.branch.trim() !== "" && setup.branch.trim() !== "(none)" ? setup.branch : "(none)";'
/** The engine's branch stop. */
const BRANCH_STOP_LINE = 'if (BRANCH === "(none)") {'

interface BranchCase {
  readonly label: string
  /** What setup-task reports as `- **Branch name**:`; null ⇒ no such value at all. */
  readonly branch: string | null
  readonly stops: boolean
}

/** Not a shape gate: every non-empty name setup-task reports is used as reported; only "no branch" stops. */
const BRANCH_TABLE: readonly BranchCase[] = [
  { label: 'a derived branch', branch: 'feat/7-login', stops: false },
  { label: 'an unusual name, used as reported', branch: 'user/Feat_7.v2', stops: false },
  { label: 'a keyed name', branch: 'PROJ-7-sso', stops: false },
  { label: 'no branch at all', branch: null, stops: true },
  { label: 'the literal (none)', branch: '(none)', stops: true },
  { label: 'an empty value', branch: '', stops: true },
  { label: 'only whitespace', branch: '  ', stops: true },
]

/**
 * Named collector: every branch case the executed engine decides wrongly — a stop
 * that is not ESCALATED `branch-missing` before any other spawn, or a run that
 * does not implement on exactly the reported branch. Each case runs under both
 * policies with a captured Issue ID, so the ticket-link stop never decides it.
 */
export async function collectBranchStopViolations(body: string | null): Promise<string[]> {
  if (body === null) return ['the SINGLE engine body was not found']
  const out: string[] = []
  for (const c of BRANCH_TABLE) {
    for (const issueRequired of ['true', 'false']) {
      const spawns: Spawn[] = []
      const world: World = { tickets: { '#7': { branch: c.branch, issueId: '7', prLinkLine: 'Closes #7' } } }
      const result = await runEngine(body, { ticket: 'x', issueNumber: '#7', issueRequired }, stubAgent(world, spawns))
      const beyondSetup = spawns.filter(s => !s.prompt.startsWith('OPERATION: setup-task')).length
      const where = `${c.label} (issueRequired ${issueRequired})`
      if (c.stops) {
        const stopped = result?.verdict === 'ESCALATED' && result.escalations?.[0]?.type === 'branch-missing' && result.branch === '(none)'
        if (!(stopped && beyondSetup === 0)) out.push(`${where}: expected ESCALATED branch-missing before any other spawn, got ${result?.verdict} after ${beyondSetup} more spawn(s)`)
      } else {
        const implement = spawns.find(s => s.agentType === 'Code')
        if (result?.branch !== c.branch || implement === undefined || !implement.prompt.includes(`on branch ${c.branch}`)) {
          out.push(`${where}: expected the ticket implemented on ${JSON.stringify(c.branch)}, got ${result?.verdict} on ${JSON.stringify(result?.branch)}`)
        }
      }
    }
  }
  return out
}

describe('W2: a setup-task that reports no branch stops the ticket; the engine mints none', () => {
  it('the table covers both outcomes', () => {
    expect(new Set(BRANCH_TABLE.map(c => c.stops))).toEqual(new Set([true, false]))
  })

  it('executed: the engine stops, or implements on the reported branch, exactly as the table says', async () => {
    expect(await collectBranchStopViolations(SINGLE)).toEqual([])
  })

  it('the binding follows setup-task and the stop precedes phase("implement"); nothing mints or passes a branch name', () => {
    const script = SINGLE!
    const setup = script.indexOf('phase("setup"')
    const binding = script.indexOf(BRANCH_LINE)
    const stop = script.indexOf(BRANCH_STOP_LINE)
    const implement = script.indexOf('phase("implement"')
    expect(setup).toBeGreaterThan(-1)
    expect(binding, 'BRANCH is bound from setup-task\'s Output').toBeGreaterThan(setup)
    expect(stop, 'the stop follows the binding').toBeGreaterThan(binding)
    expect(implement, 'and precedes the implement phase').toBeGreaterThan(stop)
    expect(offsetsOf(script, 'const BRANCH = '), 'one binding: the reported branch').toHaveLength(1)
    expect(script, 'setup-task is asked for its - **Branch name**: value').toContain('Return: {"branch": "<the - **Branch name**: value under your ### Branch, or (none)>"')
    for (const minted of [MINTED_PREFIX, 'args.branch']) expect(script, `the engine must not mint or pass a branch name: "${minted}"`).not.toContain(minted)
  })

  it('known-bad probe: an engine without the branch stop implements a ticket that has no branch', async () => {
    const unstopped = seedOnce(SINGLE!, BRANCH_STOP_LINE, 'if (false) {')
    const found = await collectBranchStopViolations(unstopped)
    expect(found.map(f => f.split(' (issueRequired')[0])).toEqual([
      'no branch at all', 'no branch at all',
      'the literal (none)', 'the literal (none)',
      'an empty value', 'an empty value',
      'only whitespace', 'only whitespace',
    ])
  })

  it('known-bad probe: a shape-gated binding stops a branch setup-task really created', async () => {
    const gated = seedOnce(SINGLE!, BRANCH_LINE, 'const BRANCH = /^(?:feat|fix)\\/[a-z0-9-]+$/.test(String(setup?.branch ?? "")) ? setup.branch : "(none)";')
    const found = await collectBranchStopViolations(gated)
    expect(found.map(f => f.split(' (issueRequired')[0])).toEqual([
      'an unusual name, used as reported', 'an unusual name, used as reported',
      'a keyed name', 'a keyed name',
    ])
  })

  it('executed: a wave quarantines the branchless ticket, cascades to its dependent, and runs its independent sibling', async () => {
    const world: World = {
      tickets: {
        '#12': { branch: null, issueId: '12', prLinkLine: 'Closes #12' },
        '#13': { issueId: '13', prLinkLine: 'Closes #13' },
        '#14': { issueId: '14', prLinkLine: 'Closes #14' },
      },
      deps: { '#13': ['#12'] },
    }
    const run = await runWave(WAVE!, SINGLE!, world, {}, 'true')
    expect(run.tickets.map(t => [t.ticket, t.ran, t.verdict, t.merged])).toEqual([
      ['#12', true, 'ESCALATED', false],
      ['#13', false, null, false],
      ['#14', true, 'PASS', true],
    ])
    expect(run.quarantined.map(q => q.ticket)).toEqual(['#12'])
    expect(run.quarantined[0].reason).toContain('setup-task reported no branch')
    expect(run.spawns.some(s => s.prompt.startsWith('Merge (none)'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AC-11 — no Issue ID under ISSUE_REQUIRED: stop before implementing
// ---------------------------------------------------------------------------

interface StopCase {
  readonly label: string
  readonly issueRequired: string | undefined
  readonly script: TicketScript
  readonly stops: boolean
}

const STOP_TABLE: readonly StopCase[] = [
  { label: 'required, no Issue ID', issueRequired: 'true', script: {}, stops: true },
  { label: 'required, no Issue ID but a link line', issueRequired: 'true', script: { prLinkLine: 'Closes #7' }, stops: true },
  { label: 'required, an Issue ID', issueRequired: 'true', script: { issueId: '7', prLinkLine: 'Closes #7' }, stops: false },
  { label: 'required, a keyed Issue ID', issueRequired: 'true', script: { issueId: 'PROJ-7', prLinkLine: 'Refs PROJ-7' }, stops: false },
  { label: 'required, an Issue ID of no tracker shape ("none")', issueRequired: 'true', script: { issueId: 'none', prLinkLine: 'Closes #7' }, stops: true },
  { label: 'required, an Issue ID of no tracker shape (prose)', issueRequired: 'true', script: { issueId: 'see issue 7' }, stops: true },
  { label: 'standard, no Issue ID', issueRequired: 'false', script: {}, stops: false },
  { label: 'unset (fails closed, like the resolver), no Issue ID', issueRequired: undefined, script: {}, stops: true },
]

/** Named collector: every stop case the executed engine decides wrongly. */
export async function collectTicketLinkStopViolations(body: string | null): Promise<string[]> {
  if (body === null) return ['the SINGLE engine body was not found']
  const out: string[] = []
  for (const c of STOP_TABLE) {
    const spawns: Spawn[] = []
    const world: World = { tickets: { '#7': c.script } }
    const args: Record<string, unknown> = { ticket: 'x', issueNumber: '#7' }
    if (c.issueRequired !== undefined) args.issueRequired = c.issueRequired
    const result = await runEngine(body, args, stubAgent(world, spawns))
    const stopped = result?.verdict === 'ESCALATED' && result.escalations?.[0]?.type === 'ticket-link-missing'
    const beyondSetup = spawns.filter(s => !s.prompt.startsWith('OPERATION: setup-task')).length
    if (c.stops && !(stopped && beyondSetup === 0)) out.push(`${c.label}: expected ESCALATED ticket-link-missing before any other spawn, got ${result?.verdict} after ${beyondSetup} more spawn(s)`)
    if (!c.stops && (stopped || !spawns.some(s => s.agentType === 'Code'))) out.push(`${c.label}: expected the ticket to be implemented, got ${result?.verdict}`)
  }
  return out
}

const STOP_LINE = 'if (ISSUE_REQUIRED === "true" && ISSUE_NUMBER === "(none)") {'

describe('AC-11: with issues required, no Issue ID stops the ticket before implementation', () => {
  it('the table covers both inputs and both outcomes', () => {
    expect(new Set(STOP_TABLE.map(c => c.stops))).toEqual(new Set([true, false]))
    expect(new Set(STOP_TABLE.map(c => c.issueRequired))).toEqual(new Set(['true', 'false', undefined]))
  })

  it('executed: the engine stops, or implements, exactly as the table says', async () => {
    expect(await collectTicketLinkStopViolations(SINGLE)).toEqual([])
  })

  it('the stop comes after the capture and before phase("implement"), and the engine records no exception', () => {
    const script = SINGLE!
    const capture = script.indexOf(CAPTURE_LINE)
    const stop = script.indexOf(STOP_LINE)
    const implement = script.indexOf('phase("implement"')
    expect(capture).toBeGreaterThan(-1)
    expect(stop, 'the stop follows the capture').toBeGreaterThan(capture)
    expect(implement, 'and precedes the implement phase').toBeGreaterThan(stop)
    expect(offsetsOf(script, 'const ISSUE_NUMBER = '), 'one binding: the capture').toHaveLength(1)
    for (const carrier of ['PR_EXCEPTIONS', '## Evidence Exceptions', 'self-attested']) {
      expect(BUILT, `/dynamic-build records no exception (decision (b)): "${carrier}"`).not.toContain(carrier)
    }
  })

  it('known-bad probe: an engine without the stop implements the unlinked ticket', async () => {
    const unstopped = seedOnce(SINGLE!, STOP_LINE, 'if (false) {')
    const found = await collectTicketLinkStopViolations(unstopped)
    expect(found.map(f => f.split(':')[0])).toEqual([
      'required, no Issue ID',
      'required, no Issue ID but a link line',
      'required, an Issue ID of no tracker shape ("none")',
      'required, an Issue ID of no tracker shape (prose)',
      'unset (fails closed, like the resolver), no Issue ID',
    ])
  })

  it('known-bad probe: an ungated capture lets a "none" or prose Issue ID through the stop', async () => {
    const ungated = seedOnce(SINGLE!, CAPTURE_LINE, 'const ISSUE_NUMBER = setup?.issueId || "(none)";')
    const found = await collectTicketLinkStopViolations(ungated)
    expect(found.map(f => f.split(':')[0])).toEqual([
      'required, an Issue ID of no tracker shape ("none")',
      'required, an Issue ID of no tracker shape (prose)',
    ])
  })

  it('executed: a wave quarantines the unlinked ticket, cascades to its dependent, and runs its independent sibling', async () => {
    const world: World = {
      tickets: { '#12': {}, '#13': { issueId: '13', prLinkLine: 'Closes #13' }, '#14': { issueId: '14', prLinkLine: 'Closes #14' } },
      deps: { '#13': ['#12'] },
    }
    const run = await runWave(WAVE!, SINGLE!, world, {}, 'true')
    expect(run.tickets.map(t => [t.ticket, t.ran, t.verdict, t.merged])).toEqual([
      ['#12', true, 'ESCALATED', false],
      ['#13', false, null, false],
      ['#14', true, 'PASS', true],
    ])
    expect(run.quarantined.map(q => q.ticket)).toEqual(['#12'])
    expect(run.quarantined[0].reason).toContain('link or create this ticket\'s issue')
    // #13 never reached setup-task: the cascade held it.
    expect(run.spawns.some(s => s.prompt.includes('ISSUE_INPUT: #13'))).toBe(false)
  })

  it('executed: the wave forwards the resolved input — under standard the same ticket is built, not stopped', async () => {
    const run = await runWave(WAVE!, SINGLE!, { tickets: { '#12': {} } }, {}, 'false')
    expect(run.tickets.map(t => [t.ticket, t.verdict, t.merged, t.issuePrLink])).toEqual([['#12', 'PASS', true, '(none)']])
  })

  it('known-bad probe: a wave call that drops issueRequired fails closed and stops the ticket under standard', async () => {
    const call = shippedEngineCall(WAVE!)
    const dropped = seedOnce(WAVE!, call, call.replace(' issueRequired: ISSUE_REQUIRED,', ''))
    const run = await runWave(dropped, SINGLE!, { tickets: { '#12': {} } }, {}, 'false')
    expect(run.tickets[0].verdict).toBe('ESCALATED')
  })
})

// ---------------------------------------------------------------------------
// AC-12 — every declared engine verdict has exactly one wave arm
// ---------------------------------------------------------------------------

/** The engine schema's verdict domain, as the build expands `engine_output_schema()`; null unless one line. */
function schemaVerdicts(text: string): string[] | null {
  const hits = [...text.matchAll(/^ {2}"verdict": "([A-Z-]+(?: \| [A-Z-]+)*)",$/gm)]
  return hits.length === 1 ? hits[0][1].split(' | ') : null
}

/** The wave skeleton's merge condition: the first `if (…) {` after the engine call. */
function mergeCondition(wave: string): string | null {
  const lines = wave.split('\n')
  const at = lines.findIndex(l => l.includes(WAVE_ENGINE_CALL))
  const test = lines.slice(at + 1).find(l => /^\s*if \(/.test(l))
  return test?.match(/^\s*if \((.*)\) \{\s*$/)?.[1] ?? null
}

/** The `_wave.mds` Step 2 arms: the verdicts its merge bullet and its quarantine bullet name. */
function waveArms(partial: string): { merge: string[]; quarantine: string[]; none: boolean } | null {
  const merge = /^- On engine ([A-Z-]+(?: or [A-Z-]+)*): merge/m.exec(partial)
  const quarantine = /^- On any other verdict \(([A-Z-]+(?:, [A-Z-]+)*)\)( or none)?: quarantine/m.exec(partial)
  if (merge === null || quarantine === null) return null
  return { merge: merge[1].split(' or '), quarantine: quarantine[1].split(', '), none: quarantine[2] !== undefined }
}

/**
 * Named collector: a declared verdict with no arm or two, an arm naming a
 * verdict the schema does not declare, and any disagreement between the prose
 * arms and the executed merge condition — including the verdict-less result.
 */
export function collectVerdictArmDefects(schema: string[] | null, condition: string | null, arms: ReturnType<typeof waveArms>): string[] {
  if (schema === null || condition === null || arms === null) return ['the schema line, the merge condition or the _wave.mds arms were not found']
  const decide = new Function('engineResult', `return (${condition});`) as (r: unknown) => unknown
  const out: string[] = []
  for (const v of schema) {
    const named = Number(arms.merge.includes(v)) + Number(arms.quarantine.includes(v))
    if (named !== 1) out.push(`${v}: named by ${named} wave arms`)
    if (Boolean(decide({ verdict: v })) !== arms.merge.includes(v)) out.push(`${v}: the executed condition and the prose arms disagree`)
  }
  for (const v of [...arms.merge, ...arms.quarantine]) if (!schema.includes(v)) out.push(`${v}: an arm names a verdict the schema does not declare`)
  if (Boolean(decide({})) || !arms.none) out.push('no verdict: it must quarantine, and the quarantine arm must say so')
  return out
}

describe('AC-12: every engine verdict the schema declares has exactly one wave arm', () => {
  const schema = schemaVerdicts(BUILT)

  it('the schema declares the five-value domain, and the arms partition it', () => {
    expect(schema).toEqual(['PASS', 'UNVERIFIED', 'PARTIAL', 'FAIL', 'ESCALATED'])
    expect(waveArms(WAVE_PARTIAL)).toEqual({ merge: ['PASS', 'UNVERIFIED'], quarantine: ['PARTIAL', 'FAIL', 'ESCALATED'], none: true })
    expect(collectVerdictArmDefects(schema, mergeCondition(WAVE!), waveArms(WAVE_PARTIAL))).toEqual([])
  })

  it('known-bad probe: the d9d1c8e _wave.mds arms leave UNVERIFIED and PARTIAL with no arm', () => {
    const d9d1c8e = WAVE_PARTIAL
      .replace(/^- On engine PASS or UNVERIFIED: merge/m, '- On engine PASS: merge')
      .replace(/^- On any other verdict \(PARTIAL, FAIL, ESCALATED\) or none: quarantine/m, '- On any other verdict (FAIL, ESCALATED): quarantine')
    expect(d9d1c8e).not.toBe(WAVE_PARTIAL)
    expect(collectVerdictArmDefects(schema, mergeCondition(WAVE!), waveArms(d9d1c8e))).toEqual([
      'UNVERIFIED: named by 0 wave arms',
      'UNVERIFIED: the executed condition and the prose arms disagree',
      'PARTIAL: named by 0 wave arms',
      'no verdict: it must quarantine, and the quarantine arm must say so',
    ])
  })

  it('known-bad probe: the d9d1c8e schema leaves the arms naming verdicts it never declared', () => {
    expect(collectVerdictArmDefects(['PASS', 'FAIL', 'ESCALATED'], mergeCondition(WAVE!), waveArms(WAVE_PARTIAL))).toEqual([
      'UNVERIFIED: an arm names a verdict the schema does not declare',
      'PARTIAL: an arm names a verdict the schema does not declare',
    ])
  })

  it('executed: the engine fills verdict from overallVerdict — PASS, UNVERIFIED — or ESCALATED from the stop', async () => {
    for (const [script, expected] of [
      [{ issueId: '7', prLinkLine: 'Closes #7' }, 'PASS'],
      [{ issueId: '7', prLinkLine: 'Closes #7', test: 'FAIL' }, 'UNVERIFIED'],
      [{}, 'ESCALATED'],
    ] as const) {
      const result = await runEngine(SINGLE!, { ticket: 'x', issueNumber: '#7', criteria: '1. works', issueRequired: 'true' }, stubAgent({ tickets: { '#7': script } }, []))
      expect(result.verdict).toBe(expected)
      expect(schema, `${expected} is a declared verdict`).toContain(result.verdict)
    }
  })
})

// ---------------------------------------------------------------------------
// The wave's return → step 3's block → `check wave` (AC-12's rendering half)
// ---------------------------------------------------------------------------

/** A reference a row may carry: the Ticket-cell grammar without `(none)`. */
const REF_RE = /^(?:#[1-9][0-9]{0,8}|[A-Z][A-Z0-9_]{0,9}-[1-9][0-9]{0,8})$/

/**
 * A model of step 3's rules — the prose the main model follows — over the
 * workflow's `tickets`. It is how this suite shows that what the loop returns is
 * enough to render a block `check wave` admits; the rules themselves are pinned
 * by wave-block.test.ts's step-3 parity arm.
 */
function renderWaveBlock(rows: readonly WaveRow[], trackingToken?: string): string {
  // The tracking line: first, `Refs` only, and only from a token that already is a reference.
  const related: string[] = trackingToken !== undefined && REF_RE.test(trackingToken) ? [`Refs ${trackingToken}`] : []
  const table = rows.map((r, i) => {
    const verdict = !r.ran ? 'BLOCKED' : r.merged && r.verdict === 'PASS' ? 'PASS' : r.merged && r.verdict === 'UNVERIFIED' ? 'UNVERIFIED' : 'QUARANTINED'
    const merged = verdict === 'PASS' || verdict === 'UNVERIFIED'
    let ticket = '(none)'
    if (r.issuePrLink !== '(none)' && verdict !== 'BLOCKED') {
      const line = merged ? r.issuePrLink : r.issuePrLink.replace(/^Closes /, 'Refs ')
      related.push(line)
      ticket = line.replace(/^(?:Closes|Refs) /, '')
    } else if (!merged && REF_RE.test(r.ticket)) {
      ticket = r.ticket
    }
    const gate = (v: string | undefined): string => (['PASS', 'FAIL', 'FAIL-FIXED', 'SKIPPED'].includes(v ?? '') ? v! : '—')
    const cells = verdict === 'BLOCKED'
      ? ['—', '—', '—', '—']
      : [gate(r.evaluateVerdict), gate(r.testVerdict), typeof r.surviving === 'number' && r.surviving <= 999 ? String(r.surviving) : '—', r.coverageComplete === true ? 'complete' : r.coverageComplete === false ? 'incomplete' : '—']
    return `| T${i + 1} | ${ticket} | ${verdict} | ${cells.join(' | ')} |`
  })
  return ['## Related Issues', ...related, '', '## Wave Evidence', '| T | Ticket | Verdict | Evaluate | Test | Surviving | Coverage |', '|---|---|---|---|---|---|---|', ...table, ''].join('\n')
}

/** `check wave` over `text`, in-process: its exit code. */
function checkWave(text: string): number {
  const file = path.join(fs.mkdtempSync(path.join(SCRATCH, 'case-')), 'wave.md')
  fs.writeFileSync(file, text)
  return VE.main(['node', 'verify-evidence.cjs', 'check', 'wave', file], { stderr: () => undefined }).code
}

describe('the wave\'s return renders a block check wave admits — UNVERIFIED closes on a flagged row', () => {
  const world: World = {
    order: ['#12', '#13', '#14', '#15', '#16'],
    tickets: {
      '#12': { issueId: '12', prLinkLine: 'Closes #12' },
      '#13': { issueId: '13', prLinkLine: 'Closes #13', test: 'FAIL' },
      '#14': { issueId: '14', prLinkLine: 'Closes #14' },
      '#15': {},
      '#16': { issueId: '16', prLinkLine: 'Closes #16' },
    },
    deps: { '#16': ['#15'] },
    failMerge: ['#14'],
  }

  it('executed: PASS, UNVERIFIED, a red post-merge build, a stopped ticket and its blocked dependent', async () => {
    const run = await runWave(WAVE!, SINGLE!, world, { '#13': { criteria: '1. works' } }, 'true')
    const block = renderWaveBlock(run.tickets)
    expect(block.split('\n').slice(0, 4)).toEqual(['## Related Issues', 'Closes #12', 'Closes #13', 'Refs #14'])
    expect(block).toContain('| T2 | #13 | UNVERIFIED | SKIPPED | FAIL-FIXED | 0 | complete |')
    expect(block).toContain('| T3 | #14 | QUARANTINED |')
    expect(block).toContain('| T4 | #15 | QUARANTINED | — | — | — | — |')
    expect(block).toContain('| T5 | #16 | BLOCKED | — | — | — | — |')
    expect(checkWave(block)).toBe(0)
  })

  it('known-bad probe: the quarantined ticket\'s line left as Closes is refused', async () => {
    const run = await runWave(WAVE!, SINGLE!, world, {}, 'true')
    const block = renderWaveBlock(run.tickets)
    expect(checkWave(seedOnce(block, 'Refs #14', 'Closes #14'))).toBe(5)
  })

  it('executed: with a tracking issue the block leads with its Refs line, and check wave admits it', async () => {
    const run = await runWave(WAVE!, SINGLE!, world, { '#13': { criteria: '1. works' } }, 'true')
    const block = renderWaveBlock(run.tickets, TRACKING)
    expect(block.split('\n').slice(0, 3)).toEqual(['## Related Issues', `Refs ${TRACKING}`, 'Closes #12'])
    expect(checkWave(block)).toBe(0)
    // A bare number is no reference: nothing is composed from it.
    expect(renderWaveBlock(run.tickets, TRACKING.slice(1)).split('\n')[1]).toBe('Closes #12')
  })

  it('known-bad probe: a tracking line rendered as Closes, or twice, is refused', async () => {
    const run = await runWave(WAVE!, SINGLE!, world, {}, 'true')
    const block = renderWaveBlock(run.tickets, TRACKING)
    expect(checkWave(seedOnce(block, `Refs ${TRACKING}`, `Closes ${TRACKING}`))).toBe(5)
    expect(checkWave(seedOnce(block, `Refs ${TRACKING}`, `Refs ${TRACKING}\nRefs ${TRACKING}`))).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// AC-13 — the wave PR steps after the workflow
// ---------------------------------------------------------------------------

const STEP3 = '3. **Compose the wave PR inputs**'
const STEP4 = '4. Surface ALL of them'
const STEP5 = '5. If `~/.devflow/preference-profile.md` was absent'
const STEP6 = '6. **Wave PR** — only after an explicit "open" in step 4.'
const BRANCH_GATE = 'Only a name matching `^wave/[a-z0-9][a-z0-9-]{0,59}$` opens a wave PR'

/** The built text from one step's lead to the next's, or null unless both are unique and ordered. */
function section(built: string, from: string, to: string): string | null {
  const a = offsetsOf(built, from)
  const b = offsetsOf(built, to)
  return a.length === 1 && b.length === 1 && b[0] > a[0] ? built.slice(a[0], b[0]) : null
}

/** The step-6 spawn fence, or null. */
function waveSpawn(built: string): string | null {
  const step6 = section(built, STEP6, 'Do NOT ask questions mid-workflow')
  const fences = step6 === null ? [] : parseFences(step6)
  return fences.length === 1 ? fences[0] : null
}

/**
 * Named collector: what the post-workflow wave PR steps fail to state, each site
 * labelled. One requirement per site, so a probe per site drives this collector.
 */
export function collectWavePrStepDefects(built: string): string[] {
  const step3 = section(built, STEP3, STEP4)
  const step4 = section(built, STEP4, STEP5)
  const spawn = waveSpawn(built)
  if (step3 === null || step4 === null || spawn === null) return ['steps: 3, 4 and 6 were not each found once, in order']
  const out: string[] = []
  const need = (site: string, ok: boolean): void => { if (!ok) out.push(site) }
  need('wave-only: step 3 runs in WAVE mode only', step3.includes('(WAVE mode only — skip this step entirely in SINGLE mode)'))
  need('branch gate: only wave/<slug> opens a wave PR', step3.includes(BRANCH_GATE))
  need('not a wave branch: any other head degrades', step3.includes('Any other name: record `TRACEABILITY: DEGRADED (not a wave branch)` and go to step 4 with no wave PR'))
  need('nothing merged: no wave PR', step3.includes('**Nothing merged** (no entry has `merged: true`): record `Wave PR: skipped (nothing merged)`'))
  need('required plan: a gap blocks, with no exception', step3.includes('**Required plan** — only when `EVIDENCE_POLICY` is `required`: a merged ticket with no usable test plan ⇒ `Wave PR: BLOCKED (no test plan for T<k>, …)`')
    && step3.includes('no exception is offered here'))
  need('the ask: one question, only after step 3 composed the block, with exactly two options',
    step4.includes('Only when step 3 composed `PR_WAVE_BLOCK`, the batch gains exactly one question') && step4.includes('It has exactly two options: open it, or don\'t.'))
  need('headless: a decline that creates and pushes nothing',
    step4.includes('**Headless** — `AskUserQuestion` is unavailable, or no answer comes — is a decline: nothing is created and nothing is pushed.'))
  need('the spawn: ensure-pr-ready with both blocks and counts-only guidance',
    spawn.includes('"OPERATION: ensure-pr-ready') && spawn.includes('PR_WAVE_BLOCK: {PR_WAVE_BLOCK verbatim}')
    && spawn.includes('PR_TEST_PLAN_BLOCK: {PR_TEST_PLAN_BLOCK verbatim, or (none)}') && spawn.includes('never an issue title or body'))
  need('no policy in the fence: the plan rule is read command-side', !spawn.includes('EVIDENCE_POLICY'))
  need('one spawn: the step-6 fence is the only ensure-pr-ready spawn', offsetsOf(built, 'OPERATION: ensure-pr-ready').length === 1)
  return out
}

/** One seed per site: the shipped text, and the text that removes that site's requirement. */
const STEP_SEEDS: ReadonlyArray<readonly [site: string, from: string, to: string]> = [
  ['wave-only', '(WAVE mode only — skip this step entirely in SINGLE mode). The workflow returned', '(in either mode). The workflow returned'],
  ['branch gate', BRANCH_GATE, 'Any name opens a wave PR'],
  ['not a wave branch', 'Any other name: record `TRACEABILITY: DEGRADED (not a wave branch)`', 'Any other name: record nothing'],
  ['nothing merged', '`Wave PR: skipped (nothing merged)`', '`Wave PR: opened anyway`'],
  ['required plan', 'no exception is offered here', 'a self-attested exception is offered here'],
  ['the ask', 'It has exactly two options: open it, or don\'t.', 'It has three options: open it, open a draft, or don\'t.'],
  ['headless', 'is a decline: nothing is created and nothing is pushed.', 'is an approval: the PR is opened.'],
  ['the spawn', 'PR_WAVE_BLOCK: {PR_WAVE_BLOCK verbatim}\n', ''],
  ['no policy in the fence', 'APPLY_CONVENTIONS: {APPLY_CONVENTIONS}\n   PR_WAVE_BLOCK', 'APPLY_CONVENTIONS: {APPLY_CONVENTIONS}\n   EVIDENCE_POLICY: {EVIDENCE_POLICY}\n   PR_WAVE_BLOCK'],
  ['one spawn', '6. **Wave PR**', '"OPERATION: ensure-pr-ready\n\n6. **Wave PR**'],
]

describe('AC-13: the wave PR opens only on wave/<slug>, with a merged ticket and an explicit "open"', () => {
  it('every step site states its rule', () => {
    expect(collectWavePrStepDefects(BUILT)).toEqual([])
  })

  it('probe cardinality equals site cardinality', () => {
    const sites = collectWavePrStepDefects('no steps').length
    expect(sites, 'a missing step set is one defect').toBe(1)
    expect(STEP_SEEDS.map(s => s[0])).toEqual([
      'wave-only', 'branch gate', 'not a wave branch', 'nothing merged', 'required plan',
      'the ask', 'headless', 'the spawn', 'no policy in the fence', 'one spawn',
    ])
  })

  for (const [site, from, to] of STEP_SEEDS) {
    it(`known-bad probe: ${site} removed is reported, and only it`, () => {
      const found = collectWavePrStepDefects(seedOnce(BUILT, from, to))
      expect(found, found.join('\n')).toHaveLength(1)
      expect(found[0].startsWith(site), found[0]).toBe(true)
    })
  }

  it('the steps run in order: compose, ask, profile note, then the spawn', () => {
    const at = [STEP3, STEP4, STEP5, STEP6].map(s => offsetsOf(BUILT, s))
    expect(at.every(a => a.length === 1), 'each step lead occurs once').toBe(true)
    const flat = at.map(a => a[0])
    expect([...flat].sort((x, y) => x - y)).toEqual(flat)
  })

  it('executed: the branch gate admits wave/<slug> and nothing else', () => {
    const pattern = /`(\^wave\/[^`]+\$)`/.exec(section(BUILT, STEP3, STEP4)!)?.[1]
    expect(pattern, 'the gate pattern is found in step 3').toBe('^wave/[a-z0-9][a-z0-9-]{0,59}$')
    const re = new RegExp(pattern!)
    const admitted = ['wave/auth', 'wave/a', 'wave/sdlc-pr6-2026', `wave/${'a'.repeat(60)}`]
    const refused = [
      'wave/', 'wave/Auth', 'wave/-x', 'wave/a b', 'wave/a/b', 'wave/$(id)', 'wave/a;rm', 'wave/ä',
      `wave/${'a'.repeat(61)}`, 'wave/a\nwave/b', 'feature/wave-x', 'main', 'ticket/12',
    ]
    expect(admitted.filter(n => !re.test(n)), 'refused a wave branch').toEqual([])
    expect(refused.filter(n => re.test(n)), 'admitted a non-wave or unsafe name').toEqual([])
  })
})

// ---------------------------------------------------------------------------
// AC-13 — under `required`, a merged row that links no ticket blocks the wave PR
// ---------------------------------------------------------------------------

/** Step 3's required-link rule as the built text states it: the policy it keys on, the row verdicts it covers, its outcome. */
interface RequiredLinkRule {
  readonly policy: string
  readonly verdicts: readonly string[]
  readonly outcome: string
}

const REQUIRED_LINK_RE = /\*\*Required link\*\* — only when `EVIDENCE_POLICY` is `([a-z]+)`: a ((?:`[A-Z]+`(?:, | or )?)+) row whose Ticket is `\(none\)`[^⇒\n]*⇒ `(Wave PR: BLOCKED \(no ticket link for T<k>, …\))`/g

/** The required-link rule read from built step 3, or null unless step 3 states exactly one. */
export function requiredLinkRule(built: string): RequiredLinkRule | null {
  const step3 = section(built, STEP3, STEP4)
  const hits = step3 === null ? [] : [...step3.matchAll(REQUIRED_LINK_RE)]
  if (hits.length !== 1) return null
  const [, policy, verdicts, outcome] = hits[0]
  return { policy, verdicts: [...verdicts.matchAll(/`([A-Z]+)`/g)].map(m => m[1]), outcome }
}

type WavePrOutcome =
  | { readonly kind: 'composed'; readonly block: string }
  | { readonly kind: 'blocked'; readonly line: string }
  | { readonly kind: 'refused'; readonly code: number }

/**
 * A model of step 3's compose decision under one policy: render the block, admit
 * it through `check wave`, then apply the required-link rule exactly as the built
 * step 3 states it — so a step that drops the rule, or narrows its verdicts or
 * its policy, composes here too.
 */
function composeWavePr(rows: readonly WaveRow[], policy: 'required' | 'standard', rule: RequiredLinkRule | null): WavePrOutcome {
  const block = renderWaveBlock(rows)
  const code = checkWave(block)
  if (code !== 0) return { kind: 'refused', code }
  if (rule !== null && rule.policy === policy) {
    const unlinked = block.split('\n')
      .map(l => /^\| (T[1-9][0-9]*) \| \(none\) \| ([A-Z]+) \|/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null && rule.verdicts.includes(m[2]))
      .map(m => m[1])
    if (unlinked.length > 0) return { kind: 'blocked', line: rule.outcome.replace('T<k>, …', unlinked.join(', ')) }
  }
  return { kind: 'composed', block }
}

/**
 * Named collector: where step 3's decision over the wave's rows breaks the
 * required-link rule. Under `required`, every merged row whose ticket has no
 * captured link line — a PASS or UNVERIFIED row with Ticket `(none)`, which
 * closes nothing — must block the wave PR, naming each such row; under
 * `standard` the same rows still compose a block `check wave` admits.
 */
export function collectRequiredLinkViolations(rows: readonly WaveRow[], rule: RequiredLinkRule | null): string[] {
  const out: string[] = []
  const unlinked = rows.flatMap((r, i) => (r.merged && r.issuePrLink === '(none)' ? [`T${i + 1}`] : []))
  if (unlinked.length === 0) return ['the corpus has no merged row without a ticket link — the rule is never exercised']
  const expected = `Wave PR: BLOCKED (no ticket link for ${unlinked.join(', ')})`
  const required = composeWavePr(rows, 'required', rule)
  if (required.kind !== 'blocked') out.push(`required: a wave PR ${required.kind === 'composed' ? 'composes' : 'is refused'} with merged row(s) ${unlinked.join(', ')} linking no ticket — expected ${expected}`)
  else if (required.line !== expected) out.push(`required: ${required.line} — expected ${expected}`)
  const standard = composeWavePr(rows, 'standard', rule)
  if (standard.kind !== 'composed') out.push(`standard: the (none) row rule must stand and the block compose, got ${standard.kind}`)
  return out
}

describe('AC-13: under required, a merged row that links no ticket blocks the wave PR', () => {
  /** Captured Issue IDs but no link line: #12 PASS, #13 UNVERIFIED — both merge under required; #14 is linked. */
  const UNLINKED: World = {
    tickets: {
      '#12': { issueId: '12' },
      '#13': { issueId: '13', test: 'FAIL' },
      '#14': { issueId: '14', prLinkLine: 'Closes #14' },
    },
  }
  const UNLINKED_PLANS = { '#13': { criteria: '1. works' } }

  it('executed: the wave merges both unlinked tickets, and step 3 blocks the wave PR naming each row', async () => {
    const run = await runWave(WAVE!, SINGLE!, UNLINKED, UNLINKED_PLANS, 'true')
    expect(run.tickets.map(t => [t.ticket, t.verdict, t.merged, t.issuePrLink])).toEqual([
      ['#12', 'PASS', true, '(none)'],
      ['#13', 'UNVERIFIED', true, '(none)'],
      ['#14', 'PASS', true, 'Closes #14'],
    ])
    const rule = requiredLinkRule(BUILT)
    expect(rule, 'step 3 states the required-link rule once').toEqual({
      policy: 'required',
      verdicts: ['PASS', 'UNVERIFIED'],
      outcome: 'Wave PR: BLOCKED (no ticket link for T<k>, …)',
    })
    expect(collectRequiredLinkViolations(run.tickets, rule)).toEqual([])
    expect(composeWavePr(run.tickets, 'required', rule)).toEqual({ kind: 'blocked', line: 'Wave PR: BLOCKED (no ticket link for T1, T2)' })
  })

  it('executed: under required a wave whose merged rows are all linked still composes', async () => {
    const run = await runWave(WAVE!, SINGLE!, TWO_TICKETS, TWO_PLANS, 'true')
    expect(composeWavePr(run.tickets, 'required', requiredLinkRule(BUILT)).kind).toBe('composed')
  })

  it('known-bad probe: step 3 without the rule composes a wave PR that closes nothing for a merged ticket', async () => {
    const step3 = section(BUILT, STEP3, STEP4)!
    const paragraph = /^ {3}\*\*Required link\*\*.*\n\n/m.exec(step3)?.[0]
    expect(paragraph, 'the rule is its own paragraph in step 3').toBeDefined()
    const dropped = seedOnce(BUILT, paragraph!, '')
    const run = await runWave(WAVE!, SINGLE!, UNLINKED, UNLINKED_PLANS, 'true')
    expect(requiredLinkRule(dropped)).toBeNull()
    expect(collectRequiredLinkViolations(run.tickets, requiredLinkRule(dropped))).toEqual([
      'required: a wave PR composes with merged row(s) T1, T2 linking no ticket — expected Wave PR: BLOCKED (no ticket link for T1, T2)',
    ])
  })

  it('known-bad probe: a rule narrowed to PASS rows lets the UNVERIFIED unlinked row through', async () => {
    const narrowed = seedOnce(BUILT, '`required`: a `PASS` or `UNVERIFIED` row whose Ticket is `(none)`', '`required`: a `PASS` row whose Ticket is `(none)`')
    const run = await runWave(WAVE!, SINGLE!, UNLINKED, UNLINKED_PLANS, 'true')
    expect(collectRequiredLinkViolations(run.tickets, requiredLinkRule(narrowed))).toEqual([
      'required: Wave PR: BLOCKED (no ticket link for T1) — expected Wave PR: BLOCKED (no ticket link for T1, T2)',
    ])
  })

  it('known-bad probe: the collector refuses a corpus with no unlinked merged row', () => {
    expect(collectRequiredLinkViolations([], requiredLinkRule(BUILT))).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// W1 (#376) — step 7: the wave PR gets Test-agent claims and an evidence refresh
// ---------------------------------------------------------------------------

const STEP7 = '7. **Wave PR evidence**'
const F4_LINE = 'Do NOT ask questions mid-workflow'
const MAINTENANCE = '### Maintenance note'
/** /implement's TP claim — the one grammar every claim appender writes. */
const TP_CLAIM_TEMPLATE = '- TP-<n> <PASS|FAIL|SKIP> sha:<head> by:test exit:<0-255>'
/** The wave evidence file, repo-relative, as step 3(b) writes it and step 7 hands it to update-pr-evidence. */
const WAVE_EVIDENCE_FILE = '.devflow/docs/evidence-wave-{slug}.md'

/** Built step 7, from its lead to the maintenance note, or null. */
function waveEvidenceStep(built: string): string | null {
  return section(built, STEP7, MAINTENANCE)
}

/**
 * Named collector: what step 7 fails to state, each site labelled — one
 * requirement per site, so one probe per site drives this collector.
 */
export function collectWaveEvidenceStepDefects(built: string): string[] {
  const step = waveEvidenceStep(built)
  if (step === null) return ['step 7: not found once, before the maintenance note']
  const out: string[] = []
  const need = (site: string, ok: boolean): void => { if (!ok) out.push(site) }
  const fences = parseFences(step)
  const tests = fences.filter(f => f.includes('Agent(subagent_type="Test")'))
  const gits = fences.filter(f => f.includes('Agent(subagent_type="Git")'))
  const f4 = offsetsOf(built, F4_LINE)
  need('placement: after step 6 and its F4 line, so step 6 keeps its one fence',
    f4.length === 1 && built.indexOf(STEP7) > f4[0] && built.indexOf(STEP7) > built.indexOf(STEP6))
  need('gate: only once step 6 reported the wave PR, and never blocking',
    step.includes('only when step 6 reported the wave PR') && step.includes('it never blocks'))
  need('the PR number: step 6\'s PR line, shape-checked, else degraded',
    step.includes('from step 6\'s `- **PR**: #{n}` line') && step.includes('`^[1-9][0-9]{0,9}$`')
    && step.includes('`TRACEABILITY: DEGRADED (wave PR number not captured)`'))
  need('no wave test plan: skipped, and named', step.includes('`PR_TEST_PLAN_BLOCK` `(none)` ⇒ record `Wave evidence: skipped (no wave test plan)`'))
  need('the Test spawn: one Test agent on the integration worktree with the wave TP lines',
    tests.length === 1 && tests[0].includes('\nWORKTREE_PATH: {integration worktree root}\n')
    && tests[0].includes('\nTEST_PLAN: {the TP lines of the wave evidence file\'s ## Test Plan section}\n'))
  need('the claims: /implement\'s TP claim, appended to the wave evidence file, keyed to one reported HEAD',
    step.split('\n').includes(TP_CLAIM_TEMPLATE) && step.includes(`/${WAVE_EVIDENCE_FILE}"\``) && step.includes('`## Claims`')
    && step.includes('gets no claim'))
  need('the push: once, never forced, and a failure does not stop the refresh',
    step.includes('push origin HEAD; echo "exit=$?"') && !/--force|\+HEAD|push -f\b/.test(step)
    && step.includes('`TRACEABILITY: DEGRADED (evidence push failed)` and refresh anyway'))
  need('the refresh: one update-pr-evidence spawn with the PR number, the repo-relative file, the publication value and the worktree',
    gits.length === 1 && gits[0].includes('"OPERATION: update-pr-evidence\n') && gits[0].includes('\nPR_NUMBER: {n}\n')
    && gits[0].includes(`\nEVIDENCE_FILE: ${WAVE_EVIDENCE_FILE}\n`) && /\nREVIEW_PUBLICATION: \{[^}\n]+\}\n/.test(gits[0])
    && gits[0].includes('\nWORKTREE_PATH: {integration worktree root}\n'))
  need('the publication value: resolved in this step, by the partial',
    step.includes('**Resolve `REVIEW_PUBLICATION` per worktree:**') && step.includes('**Evidence stub:**'))
  need('never blocks: a refresh that returns nothing degrades', step.includes('`TRACEABILITY: DEGRADED (evidence refresh failed)`'))
  need('no policy in a spawn: the partial reads it command-side', fences.every(f => !f.includes('EVIDENCE_POLICY')))
  return out
}

/** One seed per site: the shipped text, and the text that removes that site's requirement. */
const STEP7_SEEDS: ReadonlyArray<readonly [site: string, from: string, to: string]> = [
  ['placement', STEP7, `${F4_LINE}, again.\n\n${STEP7}`],
  ['gate', 'it never blocks', 'it may block'],
  ['the PR number', '`^[1-9][0-9]{0,9}$`', '`^[0-9]+$`'],
  ['no wave test plan', '`Wave evidence: skipped (no wave test plan)`', '`Wave evidence: attempted anyway`'],
  ['the Test spawn', 'Agent(subagent_type="Test")', 'Agent(subagent_type="Validate")'],
  ['the claims', TP_CLAIM_TEMPLATE, '- TP-<n> <outcome> sha:<head> by:test'],
  ['the push', 'push origin HEAD; echo', 'push --force origin HEAD; echo'],
  ['the refresh', `EVIDENCE_FILE: ${WAVE_EVIDENCE_FILE}\n`, ''],
  ['the publication value', '**Resolve `REVIEW_PUBLICATION` per worktree:**', 'Resolve it somehow:'],
  ['never blocks', '`TRACEABILITY: DEGRADED (evidence refresh failed)`', 'the run stops'],
  ['no policy in a spawn', 'WORKTREE_PATH: {integration worktree root}\nUpdate', 'WORKTREE_PATH: {integration worktree root}\nEVIDENCE_POLICY: {EVIDENCE_POLICY}\nUpdate'],
]

describe('W1: after the wave PR opens, step 7 claims its test plan and refreshes its evidence', () => {
  it('every step-7 site states its rule', () => {
    expect(waveEvidenceStep(BUILT)?.length ?? 0, 'step 7 is found').toBeGreaterThan(1000)
    expect(collectWaveEvidenceStepDefects(BUILT)).toEqual([])
  })

  it('probe cardinality equals site cardinality', () => {
    expect(collectWaveEvidenceStepDefects('no step 7'), 'a missing step is one defect').toHaveLength(1)
    expect(STEP7_SEEDS.map(s => s[0])).toEqual([
      'placement', 'gate', 'the PR number', 'no wave test plan', 'the Test spawn', 'the claims',
      'the push', 'the refresh', 'the publication value', 'never blocks', 'no policy in a spawn',
    ])
  })

  for (const [site, from, to] of STEP7_SEEDS) {
    it(`known-bad probe: ${site} removed is reported, and only it`, () => {
      const found = collectWaveEvidenceStepDefects(seedOnce(BUILT, from, to))
      expect(found, found.join('\n')).toHaveLength(1)
      expect(found[0].startsWith(site), found[0]).toBe(true)
    })
  }

  it('step 6 keeps its one spawn fence: step 7 sits past the F4 line', () => {
    expect(waveSpawn(BUILT), 'step 6\'s ensure-pr-ready fence').not.toBeNull()
    expect(offsetsOf(BUILT, 'OPERATION: update-pr-evidence'), 'one refresh spawn').toHaveLength(1)
  })

  it('the claim line is /implement\'s TP claim, byte for byte', () => {
    const implement = requireDistFile('implement.md')
    expect(implement.split('\n').filter(l => l.startsWith('- TP-<n> ')), '/implement states its TP claim once').toEqual([TP_CLAIM_TEMPLATE])
    expect(waveEvidenceStep(BUILT)!.split('\n').filter(l => l.startsWith('- TP-<n> '))).toEqual([TP_CLAIM_TEMPLATE])
  })

  it('filled in, the claim template is a line pr-evidence admits — with or without its exit', () => {
    const head = 'a'.repeat(40)
    const fill = (outcome: string, exit: string | null): string => {
      const line = TP_CLAIM_TEMPLATE.replace('<n>', '3').replace('<PASS|FAIL|SKIP>', outcome).replace('<head>', head)
      return exit === null ? line.replace(' exit:<0-255>', '') : line.replace('<0-255>', exit)
    }
    const lines = ['PASS', 'FAIL', 'SKIP'].flatMap(o => [fill(o, '0'), fill(o, '255'), fill(o, null)])
    expect(lines.filter(l => !PE.CLAIM_LINE_RE.test(l))).toEqual([])
    // Negative control: the template itself, unfilled, is never a claim.
    expect(PE.CLAIM_LINE_RE.test(TP_CLAIM_TEMPLATE)).toBe(false)
  })

  it('the repo-relative EVIDENCE_FILE of every admitted wave slug passes update-pr-evidence\'s value gate', () => {
    const mechanics = fs.readFileSync(path.join(compiledSkillRefsDir(), 'pr', 'update-pr-evidence.md'), 'utf-8')
    const gate = /only a value matching `(\^[^`]+\$)` reaches the shell/.exec(mechanics)?.[1]
    expect(gate, 'the op\'s EVIDENCE_FILE gate is found').toBe('^[A-Za-z0-9._/-]{1,255}$')
    const re = new RegExp(gate!)
    for (const slug of ['auth', 'a', 'sdlc-pr6-2026', 'a'.repeat(60)]) {
      expect(re.test(WAVE_EVIDENCE_FILE.replace('{slug}', slug)), slug).toBe(true)
    }
    // Negative control: the gate read is live — a value with a space is refused.
    expect(re.test('.devflow/docs/evidence-wave-a b.md')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AC-8 (flow half) — the frozen anchors stay the first occurrences
// ---------------------------------------------------------------------------

/** The two frozen-fixture anchors the status-line sampler reads from the raw .mds by first occurrence. */
const FROZEN_ANCHORS = ['deduplicates via its own marker', 'In WAVE mode, if no tracking-issue number'] as const

/** Named collector: an anchor whose first occurrence is not its frozen fixture line, or that new steps precede. */
export function collectAnchorDrift(source: string, fixture: string): string[] {
  const out: string[] = []
  const lines = source.split('\n')
  for (const anchor of FROZEN_ANCHORS) {
    const first = lines.find(l => l.includes(anchor))
    const frozen = fixture.split('\n').find(l => l.includes(anchor))
    if (frozen === undefined) out.push(`${anchor}: not in the frozen fixture`)
    else if (first !== frozen) out.push(`${anchor}: its first occurrence is not the frozen fixture line`)
    const step3 = source.indexOf('3. **Compose the wave PR inputs**')
    if (step3 !== -1 && source.indexOf(anchor) > step3) out.push(`${anchor}: a new step precedes it`)
  }
  return out
}

describe('AC-8: the frozen dynamic-build anchors stay first, above every new step', () => {
  const fixture = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'golden', 'github-status-lines.txt'), 'utf-8')

  it('both anchors\' first occurrences are their frozen fixture lines', () => {
    expect(fixture.length, 'the frozen fixture is read').toBeGreaterThan(10_000)
    expect(collectAnchorDrift(BUILD_SOURCE, fixture)).toEqual([])
  })

  it('known-bad probe: new text above the anchors that repeats one is reported', () => {
    const seeded = seedOnce(BUILD_SOURCE, '### SINGLE mode workflow structure', 'The Git agent deduplicates via its own marker, as ever.\n\n### SINGLE mode workflow structure')
    expect(collectAnchorDrift(seeded, fixture)).toEqual([`${FROZEN_ANCHORS[0]}: its first occurrence is not the frozen fixture line`])
  })
})

// ---------------------------------------------------------------------------
// #421 (t04) — Gate 1 order and its early stop, the single Evaluate spawn, and the
// workflow-owned post-merge Validate with its undo
// ---------------------------------------------------------------------------
//
// D-VALIDATE-ONCE        Gate 1 runs Simplify, Scrutinize, Validate in both passes, and
//                        Validate runs last and unconditionally.
// D-GATE1-ESCALATION     After Gate 1 #1, an exhausted Validate or a BLOCKED Scrutinize
//                        returns ESCALATED with one escalation (`validation-exhausted` or
//                        `scrutiny-blocked`) before Gate 2 and the review pass spawn
//                        anything. At Gate 1 #2 the same stops are ESCALATED phase results
//                        and the run reports PARTIAL.
// D-LENS-MERGE           A ticket with a plan gets exactly one Evaluate spawn whose prompt
//                        names both checks; a wave ticket runs the same skeleton.
// D-WAVE-MERGE-VALIDATE  Git merges locally and validates nothing. The workflow spawns the
//                        Validate after every kept merge; a merge counts as kept only on
//                        PASS. On FAIL the workflow spawns the undo (`reset --keep`, never
//                        `--hard`, never a push). A refused undo halts the wave.
//
// The skeletons are EXECUTED with stub agents, so a wording pin cannot stay green over a
// loop that merges a red build. Each absence guard has a named collector, a non-empty
// corpus assertion and a known-bad probe through the same collector.

const types = (spawns: readonly Spawn[]): string[] => spawns.map(s => s.agentType)

/** Named collector: whether `seq` holds `needle` as a subsequence, and how many times it holds in sequence. */
function countSequence(seq: readonly string[], needle: readonly string[]): number {
  let hits = 0
  let at = 0
  for (const t of seq) {
    if (t === needle[at]) {
      at++
      if (at === needle.length) { hits++; at = 0 }
    }
  }
  return hits
}

const ENGINE_ARGS = { ticket: 'add login', issueNumber: '#7', criteria: '1. works', issueRequired: 'true' }
const OWN = { issueId: '7', prLinkLine: 'Closes #7' }

describe('#421 AC-16: Gate 1 runs Simplify, Scrutinize, Validate in both passes', () => {
  it('executed: the type sequence holds the triple twice, and the first pass precedes Gate 2 and the review', async () => {
    const spawns: Spawn[] = []
    const result = await runEngine(SINGLE!, { ...ENGINE_ARGS, plan: 'the plan' }, stubAgent({ tickets: { '#7': OWN } }, spawns))
    const seq = types(spawns)
    expect(result.verdict).toBe('PASS')
    expect(countSequence(seq, ['Simplify', 'Scrutinize', 'Validate'])).toBe(2)
    expect(seq.filter(t => t === 'Simplify')).toHaveLength(2)
    expect(seq.filter(t => t === 'Scrutinize')).toHaveLength(2)
    expect(seq.filter(t => t === 'Validate')).toHaveLength(2)
    const firstValidate = seq.indexOf('Validate')
    expect(firstValidate).toBeGreaterThan(seq.indexOf('Scrutinize'))
    expect(firstValidate, 'Gate 1 #1 closes before Gate 2').toBeLessThan(seq.indexOf('Evaluate'))
    expect(seq.indexOf('Evaluate'), 'Gate 2 precedes the review pass').toBeLessThan(seq.indexOf('Review'))
    expect(seq.lastIndexOf('Validate'), 'Gate 1 #2 follows the review pass').toBeGreaterThan(seq.lastIndexOf('Review'))
  })

  it('Validate runs even when Scrutinize changed nothing, and re-runs once after each Code fix', async () => {
    const spawns: Spawn[] = []
    await runEngine(SINGLE!, ENGINE_ARGS, stubAgent({ tickets: { '#7': OWN }, gate1Red: ['#7'] }, spawns))
    const seq = types(spawns)
    // Simplify, Scrutinize, then Validate, Code, Validate, Code, Validate: the re-run follows each fix.
    expect(seq.slice(seq.indexOf('Simplify'), seq.indexOf('Simplify') + 7)).toEqual(['Simplify', 'Scrutinize', 'Validate', 'Code', 'Validate', 'Code', 'Validate'])
  })

  it('no Validate spawn names a model, and every Gate 1 Validate prompt pins the verdict return', async () => {
    const spawns: Spawn[] = []
    await runEngine(SINGLE!, ENGINE_ARGS, stubAgent({ tickets: { '#7': OWN } }, spawns))
    const validates = spawns.filter(s => s.agentType === 'Validate')
    expect(validates.length).toBeGreaterThanOrEqual(2)
    for (const v of validates) expect(v.prompt).toContain('Return: {"verdict": "PASS" | "FAIL", "details": "..."}')
    expect(spawns.filter(s => s.agentType === 'Scrutinize').every(s => s.prompt.includes('Return: {"status": "PASS" | "FIXED" | "BLOCKED"}'))).toBe(true)
  })
})

/**
 * Named collector: where a Gate 1 #1 stop is not a stop. The engine must return ESCALATED
 * with exactly one escalation of the expected type and spawn no Gate 2 or review agent.
 */
export async function collectGate1StopViolations(body: string | null, world: World, expectedType: string): Promise<string[]> {
  if (body === null) return ['the SINGLE engine body was not found']
  const spawns: Spawn[] = []
  const result = await runEngine(body, { ...ENGINE_ARGS, plan: 'the plan' }, stubAgent(world, spawns))
  const out: string[] = []
  if (result.verdict !== 'ESCALATED') out.push(`the verdict is ${String(result.verdict)}, not ESCALATED`)
  if (result.escalations?.length !== 1) out.push(`expected one escalation, found ${result.escalations?.length ?? 0}`)
  else if (result.escalations[0].type !== expectedType) out.push(`the escalation is ${result.escalations[0].type}, not ${expectedType}`)
  for (const t of ['Evaluate', 'Test', 'Review', 'Synthesize']) {
    const n = spawns.filter(s => s.agentType === t).length
    if (n > 0) out.push(`${n} ${t} spawn(s) ran on a stopped ticket`)
  }
  return out
}

describe('#421 AC-18: a Gate 1 #1 stop returns ESCALATED with one escalation before Gate 2', () => {
  it('Validate exhausted: validation-exhausted, and no Gate 2 or review spawn', async () => {
    expect(await collectGate1StopViolations(SINGLE, { tickets: { '#7': OWN }, gate1Red: ['#7'] }, 'validation-exhausted')).toEqual([])
  })

  it('Scrutinize BLOCKED: scrutiny-blocked, and Validate never runs on it', async () => {
    const spawns: Spawn[] = []
    const world: World = { tickets: { '#7': OWN }, scrutinyBlocked: ['#7'] }
    expect(await collectGate1StopViolations(SINGLE, world, 'scrutiny-blocked')).toEqual([])
    await runEngine(SINGLE!, ENGINE_ARGS, stubAgent(world, spawns))
    expect(spawns.some(s => s.agentType === 'Validate')).toBe(false)
  })

  it.each([
    ['no return at all', undefined],
    ['a return with no status field', {}],
    ['a status the skeleton does not know', { status: 'DONE' }],
  ])('Scrutinize returning %s counts as BLOCKED: scrutiny-blocked, and Validate never runs on it', async (_label, scrutinyReturn) => {
    const spawns: Spawn[] = []
    const world: World = { tickets: { '#7': OWN }, scrutinyReturns: { '#7': [scrutinyReturn] } }
    expect(await collectGate1StopViolations(SINGLE, world, 'scrutiny-blocked')).toEqual([])
    await runEngine(SINGLE!, ENGINE_ARGS, stubAgent(world, spawns))
    expect(spawns.some(s => s.agentType === 'Validate')).toBe(false)
  })

  it('known-bad probe: a Gate 1 #1 that only stops on an explicit BLOCKED carries a status-less Scrutinize on to Validate', async () => {
    const stopsOnBlockedOnly = SINGLE!.replace('if (!["PASS", "FIXED"].includes(scrutiny?.status)) {', 'if (scrutiny?.status === "BLOCKED") {')
    expect(stopsOnBlockedOnly, 'the seed must land').not.toBe(SINGLE)
    const world: World = { tickets: { '#7': OWN }, scrutinyReturns: { '#7': [undefined] } }
    const defects = await collectGate1StopViolations(stopsOnBlockedOnly, world, 'scrutiny-blocked')
    expect(defects.length).toBeGreaterThan(0)
    expect(defects.some(d => d.includes('not ESCALATED') || d.includes('ran on a stopped ticket'))).toBe(true)
  })

  it('the schema lists scrutiny-blocked among the escalation types', () => {
    const line = BUILT.split('\n').find(l => /^\s*"type": "merge-conflict \|/.test(l)) ?? ''
    expect(line).toContain('| scrutiny-blocked |')
  })

  it('known-bad probe: an engine that carries on after a stop (the pre-#421 skeleton) is reported', async () => {
    const carryOn = seedOnce(
      SINGLE!,
      'if (gate1.verdict === "ESCALATED") {',
      'if (false) {',
    )
    const defects = await collectGate1StopViolations(carryOn, { tickets: { '#7': OWN }, gate1Red: ['#7'] }, 'validation-exhausted')
    expect(defects.length).toBeGreaterThan(0)
    expect(defects.some(d => d.includes('ran on a stopped ticket'))).toBe(true)
  })

  it('Gate 1 #2 BLOCKED: the run reports PARTIAL with a scrutiny-blocked escalation, after the review pass', async () => {
    const spawns: Spawn[] = []
    const result = await runEngine(SINGLE!, ENGINE_ARGS, stubAgent({ tickets: { '#7': OWN }, scrutinyBlockedFinal: ['#7'] }, spawns))
    expect(result.verdict).toBe('PARTIAL')
    expect(result.escalations?.map(e => e.type)).toEqual(['scrutiny-blocked'])
    expect(types(spawns).filter(t => t === 'Validate'), 'the final Validate does not run on a BLOCKED Scrutinize').toHaveLength(1)
  })

  it('Gate 1 #2 with a status-less Scrutinize: the run reports PARTIAL with a scrutiny-blocked escalation, and the final Validate does not run', async () => {
    const spawns: Spawn[] = []
    const world: World = { tickets: { '#7': OWN }, scrutinyReturns: { '#7': [{ status: 'PASS' }, undefined] } }
    const result = await runEngine(SINGLE!, ENGINE_ARGS, stubAgent(world, spawns))
    expect(result.verdict).toBe('PARTIAL')
    expect(result.escalations?.map(e => e.type)).toEqual(['scrutiny-blocked'])
    expect(types(spawns).filter(t => t === 'Validate'), 'the final Validate does not run on a status-less Scrutinize').toHaveLength(1)
  })

  it('a wave quarantines the stopped ticket with its escalation text, and merges nothing for it', async () => {
    const world: World = { order: ['#51', '#52'], tickets: { '#51': { issueId: '51', prLinkLine: 'Closes #51' }, '#52': { issueId: '52', prLinkLine: 'Closes #52' } }, gate1Red: ['#51'] }
    const run = await runWave(WAVE!, SINGLE!, world, {}, 'true')
    expect(run.tickets.map(t => [t.ticket, t.verdict, t.merged])).toEqual([['#51', 'ESCALATED', false], ['#52', 'PASS', true]])
    expect(run.quarantined).toEqual([{ ticket: '#51', reason: 'Validation exhausted after 2 Code agent fix attempts' }])
    expect(run.spawns.filter(s => s.prompt.startsWith('Merge ')).map(s => s.prompt.split(' ')[1])).toEqual(['feat/52-work'])
  })
})

describe('#421 AC-19: Gate 2 issues one Evaluate spawn whose prompt names both checks', () => {
  it('executed: one spawn, both questions, the verdict return; wave tickets get the same single spawn', async () => {
    const spawns: Spawn[] = []
    const result = await runEngine(SINGLE!, { ...ENGINE_ARGS, plan: 'the plan' }, stubAgent({ tickets: { '#7': OWN } }, spawns))
    const evaluates = spawns.filter(s => s.agentType === 'Evaluate')
    expect(evaluates).toHaveLength(1)
    expect(evaluates[0].prompt).toMatch(/INCLUDING negative criteria/)
    expect(evaluates[0].prompt).toMatch(/unplanned changes, smuggled anti-features, or drift/)
    expect(evaluates[0].prompt).toContain('Return: {"verdict": "PASS" | "FAIL", "rationale": "..."}')
    expect((result.gate2 as { evaluateVerdict: string }).evaluateVerdict).toBe('PASS')

    const world: World = { order: ['#61', '#62'], tickets: { '#61': { issueId: '61', prLinkLine: 'Closes #61' }, '#62': { issueId: '62', prLinkLine: 'Closes #62' } } }
    const run = await runWave(WAVE!, SINGLE!, world, { '#61': { plan: 'p1' }, '#62': { plan: 'p2' } }, 'true')
    expect(run.engines.map(e => e.spawns.filter(s => s.agentType === 'Evaluate').length)).toEqual([1, 1])
  })

  it('a FAIL is fixed once and recorded FAIL-FIXED, and the run reports UNVERIFIED', async () => {
    const spawns: Spawn[] = []
    const result = await runEngine(SINGLE!, { ...ENGINE_ARGS, plan: 'the plan' }, stubAgent({ tickets: { '#7': OWN }, evaluateFail: ['#7'] }, spawns))
    expect((result.gate2 as { evaluateVerdict: string }).evaluateVerdict).toBe('FAIL-FIXED')
    expect(result.verdict).toBe('UNVERIFIED')
    const fix = spawns.find(s => s.agentType === 'Code' && s.prompt.startsWith('OPERATION: alignment-fix\nFix the alignment issues'))
    expect(fix?.prompt).toContain('criterion 2 is not met')
    expect(spawns.filter(s => s.agentType === 'Evaluate'), 'no re-evaluation by design').toHaveLength(1)
  })
})

/** The Git spawns of a run, by what they were asked to do. */
const gitSpawns = (spawns: readonly Spawn[], lead: string): Spawn[] => spawns.filter(s => s.agentType === 'Git' && s.prompt.startsWith(lead))

describe('#421 AC-20/21: Git merges locally and validates nothing; the workflow runs the post-merge Validate', () => {
  const world: World = { order: ['#71'], tickets: { '#71': { issueId: '71', prLinkLine: 'Closes #71' } } }

  it('executed: the merge prompt says local, no push, no build or test, and pins both return shapes', async () => {
    const run = await runWave(WAVE!, SINGLE!, world, {}, 'true')
    const [merge] = gitSpawns(run.spawns, 'Merge ')
    expect(merge.prompt).toContain('locally')
    expect(merge.prompt).toContain('Do not push, and run no build or test.')
    expect(merge.prompt).toContain('"merged": true, "mergeSha": "<40-hex merge commit>", "treeEqual":')
    expect(merge.prompt).toContain('{"merged": false, "reason": "<why>"}')
    expect(run.tickets[0]).toMatchObject({ ticket: '#71', merged: true, treeEqual: true })
  })

  it('executed: a Validate follows the merge on the merge commit, and no Git prompt asks for Validate', async () => {
    const run = await runWave(WAVE!, SINGLE!, world, {}, 'true')
    const seq = run.spawns.map(s => s.agentType + (s.prompt.startsWith('Merge ') ? ':merge' : ''))
    const mergeAt = seq.indexOf('Git:merge')
    expect(seq[mergeAt + 1], 'the post-merge Validate directly follows the merge').toBe('Validate')
    const post = run.spawns[mergeAt + 1]
    expect(post.prompt).toMatch(/\(merge commit [0-9a-f]{40}\)\.\nFollow your Running commands block/)
    expect(post.prompt).toContain('Return: {"verdict": "PASS" | "FAIL", "details": "..."}')
    for (const g of run.spawns.filter(s => s.agentType === 'Git')) expect(g.prompt, 'a Git prompt that asks for Validate').not.toMatch(/Validate/i)
  })

  it('treeEqual is recorded, not a reason to skip: the Validate runs when it is true', async () => {
    const run = await runWave(WAVE!, SINGLE!, world, {}, 'true')
    expect(run.tickets[0].treeEqual).toBe(true)
    expect(run.spawns.filter(s => s.agentType === 'Validate' && s.prompt.includes('(merge commit '))).toHaveLength(1)
  })
})

/**
 * Named collector: what a red post-merge Validate leaves behind. The merge is never
 * left kept: the undo spawns, the row reads merged: false, and the ticket is
 * quarantined with the reason.
 */
export async function collectRedMergeViolations(waveBody: string | null): Promise<string[]> {
  if (waveBody === null) return ['the wave loop body was not found']
  const world: World = {
    order: ['#21', '#22', '#23'],
    tickets: { '#21': { issueId: '21', prLinkLine: 'Closes #21' }, '#22': { issueId: '22', prLinkLine: 'Closes #22' }, '#23': { issueId: '23', prLinkLine: 'Closes #23' } },
    deps: { '#23': ['#22'] },
    failMerge: ['#22'],
  }
  const run = await runWave(waveBody, SINGLE!, world, {}, 'true')
  const out: string[] = []
  const undos = gitSpawns(run.spawns, 'Undo the merge ')
  if (undos.length !== 1) out.push(`expected one undo spawn, found ${undos.length}`)
  const row = run.tickets.find(t => t.ticket === '#22')
  if (row?.merged !== false) out.push('the red merge is left kept: the row does not read merged: false')
  if (run.quarantined.find(q => q.ticket === '#22')?.reason !== 'post-merge build red; merge undone') out.push('the ticket is not quarantined with "post-merge build red; merge undone"')
  if (run.tickets.find(t => t.ticket === '#21')?.merged !== true) out.push('the independent sibling lost its merge')
  if (run.tickets.find(t => t.ticket === '#23')?.ran !== false) out.push('the dependent of the quarantined ticket ran')
  if (run.halted !== null) out.push('a wave whose undo succeeded halted')
  return out
}

describe('#421 AC-22: a red post-merge Validate is undone, never left kept', () => {
  it('executed: the undo spawns, the row reads merged: false, the dependent is blocked, the sibling stays merged', async () => {
    expect(await collectRedMergeViolations(WAVE)).toEqual([])
  })

  it('the undo prompt names the merge commit, reset --keep and the guards, and no --hard and no push', async () => {
    const world: World = { order: ['#22'], tickets: { '#22': { issueId: '22', prLinkLine: 'Closes #22' } }, failMerge: ['#22'] }
    const run = await runWave(WAVE!, SINGLE!, world, {}, 'true')
    const [undo] = gitSpawns(run.spawns, 'Undo the merge ')
    const sha = /\(merge commit ([0-9a-f]{40})\)/.exec(run.spawns.find(s => s.agentType === 'Validate' && s.prompt.includes('(merge commit '))!.prompt)![1]
    expect(undo.prompt).toContain(`git reset --keep ${sha}^1`)
    expect(undo.prompt).toContain(`no remote branch contains ${sha}`)
    expect(undo.prompt).toContain(`the HEAD of ${INTEGRATION} still equals ${sha}`)
    expect(undo.prompt).not.toMatch(/--hard/)
    expect(undo.prompt).not.toMatch(/\bpush\b/i)
    expect(undo.prompt).toContain('{"undone": true}')
  })

  it('known-bad probe: a wave that never asks for the undo is reported by the same collector', async () => {
    // The Git spawn is renamed, so the stub no longer reads it as an undo.
    const noUndo = seedOnce(WAVE!, 'agent(`Undo the merge ${merge.mergeSha}', 'agent(`Revert the merge ${merge.mergeSha}')
    expect(await collectRedMergeViolations(noUndo)).toContain('expected one undo spawn, found 0')
  })

  it('known-bad probe: a wave that keeps the merge after a red Validate leaves the row merged', async () => {
    const kept = seedOnce(WAVE!, 'if (post?.verdict === "PASS") {', 'if (true) {')
    const defects = await collectRedMergeViolations(kept)
    expect(defects).toContain('the red merge is left kept: the row does not read merged: false')
  })
})

describe('#421 AC-22: a refused undo halts the wave and names the red integration HEAD', () => {
  const world: World = {
    order: ['#31', '#32', '#33'],
    tickets: { '#31': { issueId: '31', prLinkLine: 'Closes #31' }, '#32': { issueId: '32', prLinkLine: 'Closes #32' }, '#33': { issueId: '33', prLinkLine: 'Closes #33' } },
    failMerge: ['#32'],
    refuseUndo: ['#32'],
  }

  it('executed: no further merge or round, the row is not merged, and halted carries the merge commit', async () => {
    const run = await runWave(WAVE!, SINGLE!, world, {}, 'true')
    const sha = createHash('sha1').update('merge:#32').digest('hex')
    expect(run.halted).toMatchObject({ ticket: '#32', mergeSha: sha })
    expect(run.halted?.reason).toContain('post-merge build red; merge not undone')
    expect(run.tickets.map(t => [t.ticket, t.merged, t.ran])).toEqual([['#31', true, true], ['#32', false, true], ['#33', false, false]])
    expect(gitSpawns(run.spawns, 'Merge ').map(s => s.prompt.split(' ')[1]), 'no merge after the halt').toEqual(['feat/31-work', 'feat/32-work'])
    expect(run.engines.map(e => e.args.ticket), 'the third ticket never started').toEqual(['#31', '#32'])
    expect(run.spawns.filter(s => s.agentType === 'Design'), 'no further round').toHaveLength(1)
  })

  it('a merge reported with no usable SHA halts the wave too, and spawns neither Validate nor undo', async () => {
    const run = await runWave(WAVE!, SINGLE!, { ...world, failMerge: [], refuseUndo: [], badMergeSha: ['#32'] }, {}, 'true')
    expect(run.halted).toMatchObject({ ticket: '#32', mergeSha: null })
    expect(gitSpawns(run.spawns, 'Undo the merge ')).toHaveLength(0)
    expect(run.spawns.filter(s => s.agentType === 'Validate' && s.prompt.includes('(merge commit ')), 'only #31\'s merge is validated').toHaveLength(1)
    expect(run.tickets.find(t => t.ticket === '#33')?.ran).toBe(false)
  })

  it('known-bad probe: a wave that ignores the refusal keeps taking merges', async () => {
    const ignoring = seedOnce(WAVE!, '    if (waveState.halted !== null) break;  // a red integration HEAD takes no further merge in this round\n', '')
    const run = await runWave(ignoring, SINGLE!, world, {}, 'true')
    expect(run.tickets.find(t => t.ticket === '#33')?.ran, 'the seed lets #33 run').toBe(true)
  })
})

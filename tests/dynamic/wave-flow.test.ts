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
 *          non-wave head degrades; a required-plan gap blocks.
 *   AC-8   (its flow half) the two frozen dynamic-build anchors stay the first
 *          occurrences, and every new step sits below them.
 *
 * The engine and the wave loop are checked by EXECUTING the shipped skeletons —
 * the SINGLE workflow script and the wave round loop, both read from the built
 * dynamic-build.md — with stub agents that answer each agent's return contract
 * and record every spawn. A wording pin would stay green over a loop that hands
 * a ticket the wrong reference.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe driven through the same collector (PF-064).
 */

import { describe, it, expect, afterAll } from 'vitest'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { ROOT, parseFences, requireDistFile } from '../helpers.js'
import { VERIFY_EVIDENCE_SCRIPT } from '../evidence/seam.js'

const BUILT = requireDistFile('dynamic-build.md')
const BUILD_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'dynamic-build.mds'), 'utf-8')
const WAVE_PARTIAL = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_wave.mds'), 'utf-8')

interface VerifyEvidence {
  main(argv: readonly string[], deps?: { stderr?: (t: string) => void }): { code: number; stdout: string }
}
const VE = createRequire(import.meta.url)(VERIFY_EVIDENCE_SCRIPT) as VerifyEvidence

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

/** What one ticket's world answers: its setup-task Handoff Values and its Test verdict. */
interface TicketScript {
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
  /** Tickets whose merge or post-merge build fails. */
  readonly failMerge?: readonly string[]
}

/**
 * A stub agent for every type the two skeletons spawn. Each answers the return
 * contract its prompt pins, and every spawn is recorded in order. The ticket a
 * spawn belongs to is the one whose setup-task ran last — the engine runs its
 * phases in sequence, so that is exact.
 */
function stubAgent(world: World, spawns: Spawn[]): Agent {
  let current: TicketScript = {}
  return async (prompt, opts) => {
    spawns.push({ agentType: opts.agentType, prompt })
    if (opts.agentType === 'Design') {
      const remaining = JSON.parse(/^Remaining: (.*)$/m.exec(prompt)?.[1] ?? '[]') as string[]
      const quarantined = (JSON.parse(/^Quarantined [^:]*: (.*)$/m.exec(prompt)?.[1] ?? '[]') as Array<{ ticket: string }>).map(q => q.ticket)
      // The reader's rule: every named dependency has left the remaining set, and none was quarantined (the cascade).
      const ready = remaining.filter(t => (world.deps?.[t] ?? []).every(d => !remaining.includes(d) && !quarantined.includes(d)))
      return { ready, blocked: [] }
    }
    if (opts.agentType === 'Git' && prompt.startsWith('OPERATION: setup-task')) {
      current = world.tickets[/^ISSUE_INPUT: (.*)$/m.exec(prompt)?.[1] ?? '(none)'] ?? {}
      return { issueId: current.issueId, prLinkLine: current.prLinkLine }
    }
    if (opts.agentType === 'Git' && prompt.startsWith('Merge ticket/')) {
      const id = /^Merge ticket\/(\S+) to /.exec(prompt)?.[1] ?? ''
      return world.failMerge?.includes(id) ? { merged: false, reason: 'post-merge build red' } : { merged: true }
    }
    if (opts.agentType === 'Test') return { verdict: current.test ?? 'PASS', failures: 'TP-1 failed' }
    if (opts.agentType === 'Review') return { focus: 'x', reviewed: true, filesExamined: [], findings: [] }
    if (opts.agentType === 'Scrutinize') return { codeChanged: false }
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
  readonly issuePrLink: string
  readonly evaluateVerdict?: string
  readonly testVerdict?: string
  readonly surviving?: number
  readonly coverageComplete?: boolean
}

interface WaveRun {
  readonly tickets: readonly WaveRow[]
  readonly quarantined: ReadonlyArray<{ ticket: string; reason: string }>
  readonly spawns: readonly Spawn[]
}

/** The wave's tracking issue: its values are in scope of the loop, and must reach no ticket. */
const TRACKING = '#99'

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
  const agent = stubAgent(world, spawns)
  const engine = (args: Record<string, unknown>): Promise<EngineResult> => runEngine(engineBody, args, agent)
  const run = new AsyncFunction(
    'agent', 'runSingleTicketEngine', 'remainingTickets', 'INTEGRATION_BRANCH', 'plans', 'DECISIONS_CONTEXT',
    'ISSUE_REQUIRED', 'APPLY_CONVENTIONS', 'ISSUE_NUMBER', 'ISSUE_PR_LINK', waveBody,
  )
  const order = world.order ?? Object.keys(world.tickets)
  const out = (await run(
    agent, engine, [...order], 'wave/demo', plans, '(none)', issueRequired, 'true', TRACKING, `Closes ${TRACKING}`,
  )) as { tickets: WaveRow[]; quarantined: Array<{ ticket: string; reason: string }> }
  return { ...out, spawns }
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

  it('known-bad probe: the d9d1c8e call hands every ticket the tracking issue and no test plan', async () => {
    const d9d1c8e = seedOnce(WAVE!, shippedEngineCall(WAVE!), D9D1C8E_ENGINE_CALL)
    const run = await runWave(d9d1c8e, SINGLE!, TWO_TICKETS, TWO_PLANS, 'true')
    const found = collectWaveHandoffViolations(run, { '#12': TP_12, '#13': TP_13 })
    expect(found[0]).toBe('setup-task inputs were ["#99","#99"], each ticket\'s own reference is ["#12","#13"]')
    expect(found.some(f => f.startsWith(`the tracking issue ${TRACKING} reached`))).toBe(true)
    expect(found.filter(f => f.endsWith('never received its own test plan'))).toHaveLength(2)
  })

  it('known-bad probe: an engine that forwards its input token, not its capture, is reported', async () => {
    const forwarded = seedOnce(SINGLE!, 'const ISSUE_NUMBER = setup?.issueId || "(none)";', 'const ISSUE_NUMBER = ISSUE_INPUT;')
    expect(await collectEngineHandoffViolations(forwarded)).toEqual([
      expect.stringMatching(/^code: a Code spawn carries ISSUE_NUMBER: #42/),
      'result: the engine result does not carry the captured issueId and issuePrLink',
    ])
    expect(await collectEngineHandoffViolations(null)).toHaveLength(1)
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
    const capture = script.indexOf('const ISSUE_NUMBER = setup?.issueId')
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
      'unset (fails closed, like the resolver), no Issue ID',
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
// AC-12 — every declared engine verdict has exactly one wave arm (PF-075)
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
 * Named collector (PF-075): a declared verdict with no arm or two, an arm naming a
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
function renderWaveBlock(rows: readonly WaveRow[]): string {
  const related: string[] = []
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

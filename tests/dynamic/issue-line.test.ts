/**
 * tests/dynamic/issue-line.test.ts
 *
 * SDLC-evidence PR6 (#365), phase P3 — the `**Issue:**` line: /dynamic-tickets
 * writes it, /dynamic-build reads it. The same writer↔reader shape as
 * depends-on-grammar.test.ts, because the failure is the same: a writer that
 * emits one spelling into a reader that looks for another reads nothing, and a
 * wave that reads no reference runs its tickets with no issue at all — which,
 * under ISSUE_REQUIRED, stops every one of them before implementation.
 *
 *   Writers  the /dynamic-tickets filing step (after the workflow returns), and
 *            the ticket template, which documents the line as the filing step's.
 *   Readers  /dynamic-build Pre-authoring step 5 (the tracking issue's line) and
 *            step 3's WAVE input from a ticket directory (each ticket's line).
 *
 *   AC-9     under ISSUE_REQUIRED, /dynamic-tickets files the tracking issue and
 *            each ticket after the workflow, one at a time and at most 50, and
 *            writes only a shape-gated line; the six-phase workflow files nothing.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe through the same collector (PF-064).
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as path from 'path'

import { ROOT, parseFences, requireDistFile } from '../helpers.js'
import { PR_EVIDENCE_SCRIPT } from '../evidence/seam.js'

const TICKETS_MD = requireDistFile('dynamic-tickets.md')
const BUILD_MD = requireDistFile('dynamic-build.md')
const TEMPLATE_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_ticket_template.mds'), 'utf-8')

const PE = createRequire(import.meta.url)(PR_EVIDENCE_SCRIPT) as { readonly WAVE_TICKET_RE: RegExp }

/** The line both sides name, verbatim. */
const TOKEN = '**Issue:**'

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

/** The built text from `from` to `to`, or '' unless both are unique and ordered. */
function between(text: string, from: string, to: string): string {
  const a = offsetsOf(text, from)
  const b = offsetsOf(text, to)
  return a.length === 1 && b.length === 1 && b[0] > a[0] ? text.slice(a[0], b[0]) : ''
}

/** The filing step of built dynamic-tickets.md. */
const filingStep = (tickets: string): string =>
  between(tickets, '### After the workflow returns — file the issues', '### Ticket body structure')

/** Built dynamic-build.md step 3 (Detect mode) — the WAVE ticket-directory reader. */
const waveInputReader = (build: string): string =>
  between(build, '**3. Detect mode: SINGLE or WAVE**', '**4. Resolve plan and acceptance criteria**')

/** Built dynamic-build.md step 5 — the tracking-issue reader. */
const trackingReader = (build: string): string =>
  between(build, '**5. Resolve tracking-issue number', '### SINGLE mode workflow structure')

type Side = readonly [label: string, text: string]

function sides(tickets: string, build: string, template: string): Side[] {
  return [
    ['writer: the filing step', filingStep(tickets)],
    ['writer: the ticket template', template],
    ['reader: the WAVE ticket-directory input', waveInputReader(build)],
    ['reader: the tracking issue (step 5)', trackingReader(build)],
  ]
}

/** Named collector: the sides that do not name the line, or were not found at all. */
export function collectSidesMissingToken(all: readonly Side[], token: string): string[] {
  return all.filter(([, text]) => text === '' || !text.includes(token)).map(([label]) => label)
}

/**
 * The placement each side states, by file kind. A writer that puts the line
 * after the H1 of a ticket file and a reader that looks after `**Depends on:**`
 * disagree about where the reference is, and the reader then finds none.
 */
const TICKET_PLACEMENT = {
  writer: 'in a ticket file as the line directly after its `**Depends on:**` line',
  reader: 'the `**Issue:**` line directly after `**Depends on:**`',
} as const
const TRACKING_PLACEMENT = {
  writer: 'in `tracking-issue.md` as the line directly after its H1',
  reader: 'The `**Issue:**` line directly after the H1 of the ticket set\'s `tracking-issue.md`',
} as const

/** Named collector: where the two sides disagree about placement or treatment of the line. */
export function collectPlacementDrift(tickets: string, build: string, template: string): string[] {
  const out: string[] = []
  const writer = filingStep(tickets)
  const need = (label: string, ok: boolean): void => { if (!ok) out.push(label) }
  need('ticket file: the writer places it after **Depends on:**', writer.includes(TICKET_PLACEMENT.writer))
  need('ticket file: the reader reads it after **Depends on:**', waveInputReader(build).includes(TICKET_PLACEMENT.reader))
  need('tracking issue: the writer places it after the H1', writer.includes(TRACKING_PLACEMENT.writer))
  need('tracking issue: the reader reads it after the H1', trackingReader(build).includes(TRACKING_PLACEMENT.reader))
  // The template shows the line where the writer puts it: the line after **Depends on:**.
  const lines = template.split('\n')
  const dependsAt = lines.findIndex(l => l.startsWith('**Depends on:**'))
  need('template: the line directly follows **Depends on:**', dependsAt !== -1 && lines[dependsAt + 1]?.startsWith(TOKEN) === true)
  need('template: only the filing step writes it', template.includes('written only by `/devflow:dynamic-tickets`\' filing step, after the workflow; a drafting agent never writes it'))
  // The reader forwards the token raw — the L1 grammar: never rendered, normalised, or ruled out.
  need('reader: the ticket token is forwarded verbatim', waveInputReader(build).includes('forwarded to the wave\'s pre-fetch verbatim — never rendered, normalised or re-derived'))
  need('reader: the tracking token is read raw', trackingReader(build).includes('tracking-issue.md`), as a raw token'))
  return out
}

describe('**Issue:** — /dynamic-tickets writer ↔ /dynamic-build reader', () => {
  const all = sides(TICKETS_MD, BUILD_MD, TEMPLATE_SOURCE)

  it('every side is found and non-vacuous', () => {
    for (const [label, text] of all) expect(text.length, `${label} was not found`).toBeGreaterThan(200)
  })

  it('every side names the same line', () => {
    expect(collectSidesMissingToken(all, TOKEN)).toEqual([])
  })

  it('writers and readers agree on where the line sits, and how it is read', () => {
    expect(collectPlacementDrift(TICKETS_MD, BUILD_MD, TEMPLATE_SOURCE)).toEqual([])
  })

  it('known-bad probe: a renamed reader token is reported by the same collector, on that side only', () => {
    const renamed = seedOnce(BUILD_MD, 'the `**Issue:**` line directly after `**Depends on:**`', 'the `**Issue ref:**` line directly after `**Depends on:**`')
    // The reader's second mention must go too, or the side still names the token.
    const seeded = seedOnce(renamed, 'A ticket file with no `**Issue:**` line', 'A ticket file with no `**Issue ref:**` line')
    expect(collectSidesMissingToken(sides(TICKETS_MD, seeded, TEMPLATE_SOURCE), TOKEN)).toEqual(['reader: the WAVE ticket-directory input'])
  })

  const PLACEMENT_SEEDS: ReadonlyArray<readonly [label: string, target: 'tickets' | 'build' | 'template', from: string, to: string]> = [
    ['ticket file: the writer places it after **Depends on:**', 'tickets', TICKET_PLACEMENT.writer, 'in a ticket file as the line directly after its H1'],
    ['ticket file: the reader reads it after **Depends on:**', 'build', TICKET_PLACEMENT.reader, 'the `**Issue:**` line directly after the H1'],
    ['tracking issue: the writer places it after the H1', 'tickets', TRACKING_PLACEMENT.writer, 'in `tracking-issue.md` as its last line'],
    ['tracking issue: the reader reads it after the H1', 'build', TRACKING_PLACEMENT.reader, 'The `**Issue:**` line at the end of the ticket set\'s `tracking-issue.md`'],
    ['template: the line directly follows **Depends on:**', 'template', '**Wave:** N\n**Depends on:**', '**Depends on:**'],
    ['template: only the filing step writes it', 'template', 'a drafting agent never writes it', 'a drafting agent may write it'],
    ['reader: the ticket token is forwarded verbatim', 'build', 'verbatim — never rendered, normalised or re-derived', 'as rendered'],
    ['reader: the tracking token is read raw', 'build', 'tracking-issue.md`), as a raw token', 'tracking-issue.md`), rendered as a number'],
  ]

  it('probe cardinality equals site cardinality', () => {
    expect(PLACEMENT_SEEDS.map(s => s[0])).toEqual(collectPlacementDrift('', '', ''))
  })

  for (const [label, target, from, to] of PLACEMENT_SEEDS) {
    it(`known-bad probe: ${label} — broken, it is reported and only it`, () => {
      let tickets = TICKETS_MD
      let build = BUILD_MD
      let template = TEMPLATE_SOURCE
      if (target === 'tickets') tickets = seedOnce(tickets, from, to)
      else if (target === 'build') build = seedOnce(build, from, to)
      else if (label.startsWith('template: the line directly follows')) {
        // Move the line above **Depends on:** — the template then shows it where no reader looks.
        const line = template.split('\n').find(l => l.startsWith(TOKEN))!
        template = seedOnce(seedOnce(template, `${line}\n`, ''), from, `**Wave:** N\n${line}\n**Depends on:**`)
      } else template = seedOnce(template, from, to)
      expect(collectPlacementDrift(tickets, build, template)).toEqual([label])
    })
  }
})

// ---------------------------------------------------------------------------
// The writer's shape gate is the Ticket grammar the wave block enforces
// ---------------------------------------------------------------------------

/** Named collector: the filing step's shape gate, as a RegExp, or null unless exactly one is stated. */
export function writerShapeGate(tickets: string): RegExp | null {
  const hits = [...filingStep(tickets).matchAll(/with a reference that matches `(\^[^`]+\$)` as a whole/g)]
  return hits.length === 1 ? new RegExp(hits[0][1]) : null
}

/** A differential corpus over the two reference shapes, their near misses and hostile text. */
const REFS: readonly string[] = [
  '#1', '#42', '#123456789', '#0', '#1234567890', '#', '42', '# 42', '#42 ', ' #42',
  'PROJ-1', 'A-1', 'AB_C-12', 'ABCDEFGHIJ-9', 'ABCDEFGHIJK-9', 'proj-1', 'PROJ-0', 'PROJ-', '-1', 'PROJ_1',
  'ENG-123456789', 'ENG-1234567890', '(none)', '', '#42\n#43', '#42$(id)', 'Closes #42', '#٤٢', 'https://x/issues/42',
]

/** Named collector: the refs on which the writer's gate and the wave Ticket grammar (without `(none)`) disagree. */
export function collectGateGrammarDrift(gate: RegExp | null): string[] {
  if (gate === null) return ['the filing step states no single shape gate']
  return REFS.filter(ref => gate.test(ref) !== (ref !== '(none)' && PE.WAVE_TICKET_RE.test(ref))).map(ref => JSON.stringify(ref))
}

describe('the filing step writes only a reference the wave block can carry', () => {
  it('the gate is stated once and admits exactly the wave Ticket grammar\'s references', () => {
    const gate = writerShapeGate(TICKETS_MD)
    expect(gate, 'the filing step states one shape gate').not.toBeNull()
    expect(REFS.filter(r => gate!.test(r)).length, 'the corpus holds admitted refs').toBeGreaterThan(5)
    expect(REFS.filter(r => !gate!.test(r)).length, 'and refused ones').toBeGreaterThan(10)
    expect(collectGateGrammarDrift(gate)).toEqual([])
  })

  it('known-bad probe: a gate widened to lowercase keys, or losing its anchors, drifts', () => {
    expect(collectGateGrammarDrift(/^(#[1-9][0-9]{0,8}|[A-Za-z][A-Za-z0-9_]{0,9}-[1-9][0-9]{0,8})$/)).toEqual(['"proj-1"'])
    expect(collectGateGrammarDrift(/(#[1-9][0-9]{0,8}|[A-Z][A-Z0-9_]{0,9}-[1-9][0-9]{0,8})/).length).toBeGreaterThan(5)
    expect(collectGateGrammarDrift(writerShapeGate('no filing step'))).toEqual(['the filing step states no single shape gate'])
  })

  it('a ref of any other shape degrades with the canonical reason and writes no line', () => {
    expect(filingStep(TICKETS_MD)).toContain(
      'A reference of any other shape ⇒ `TRACEABILITY: DEGRADED (issue reference "{ref}" does not match any tracker reference grammar)`, and no line.',
    )
    expect(filingStep(TICKETS_MD)).toContain('`CREATED` or `ENRICHED`, with a reference that matches')
  })
})

// ---------------------------------------------------------------------------
// AC-9 — filing happens after the workflow, gated, sequential and bounded
// ---------------------------------------------------------------------------

const WORKFLOW_MARKER = 'name: "devflow-dynamic-tickets"'

/**
 * Named collector: what the filing step fails to state, one label per site —
 * and whether the six-phase workflow itself files anything.
 */
export function collectFilingStepDefects(tickets: string): string[] {
  const step = filingStep(tickets)
  if (step === '') return ['step: the filing step was not found']
  const out: string[] = []
  const need = (label: string, ok: boolean): void => { if (!ok) out.push(label) }
  const workflow = parseFences(tickets).filter(f => f.includes(WORKFLOW_MARKER))
  need('after the workflow: the step follows the workflow fence', workflow.length === 1 && tickets.indexOf(workflow[0]) < tickets.indexOf(step))
  need('the workflow files nothing', workflow.length === 1 && !workflow[0].includes('ensure-traceable-issue') && !workflow[0].includes(TOKEN))
  need('gate: only when ISSUE_REQUIRED is true', step.includes('**File the issues** only when `ISSUE_REQUIRED` is `true`. Otherwise file nothing'))
  need('order: the tracking issue first, then the tickets in slate order', step.includes('The tracking issue first, then each ticket file in slate order'))
  need('sequential: one spawn at a time', step.includes('One Git spawn at a time, never in parallel'))
  need('bounded: at most 50 spawns', step.includes('at most 50 spawns in all: a file past the cap is reported `not filed (cap 50)`'))
  need('rate limit: stop filing', step.includes('`DEGRADED (rate limited)` ⇒ stop filing: this file and every file after it are reported `not filed`'))
  const spawns = parseFences(step).filter(f => f.includes('"OPERATION: ensure-traceable-issue'))
  need('spawn: one ensure-traceable-issue fence with its title, summary and file', spawns.length === 1
    && ['TASK_DESCRIPTION: ', 'REQUIREMENTS: ', 'PLAN_ARTIFACT_PATH: '].every(k => spawns[0].includes(k)))
  need('edit: the line is inserted with the Edit tool, nothing else changed', step.includes('with the Edit tool') && step.includes('Change nothing else in the file.'))
  return out
}

const FILING_SEEDS: ReadonlyArray<readonly [label: string, from: string, to: string]> = [
  ['gate', '**File the issues** only when `ISSUE_REQUIRED` is `true`.', '**File the issues** always.'],
  ['order', 'The tracking issue first, then each ticket file in slate order', 'Each ticket file, then the tracking issue'],
  ['sequential', 'One Git spawn at a time, never in parallel', 'All Git spawns in parallel'],
  ['bounded', 'at most 50 spawns in all', 'as many spawns as needed'],
  ['rate limit', '`DEGRADED (rate limited)` ⇒ stop filing', '`DEGRADED (rate limited)` ⇒ retry'],
  ['spawn', 'PLAN_ARTIFACT_PATH: {the ticket or tracking-issue file path}\n', ''],
  ['edit', 'Change nothing else in the file.', 'Rewrite the file.'],
]

describe('AC-9: /dynamic-tickets files the issues after the workflow — gated, one at a time, at most 50', () => {
  it('every site is stated, and the workflow itself files nothing', () => {
    expect(filingStep(TICKETS_MD).length, 'the filing step is found').toBeGreaterThan(500)
    expect(collectFilingStepDefects(TICKETS_MD)).toEqual([])
  })

  for (const [label, from, to] of FILING_SEEDS) {
    it(`known-bad probe: ${label} — broken, it is reported and only it`, () => {
      const found = collectFilingStepDefects(seedOnce(TICKETS_MD, from, to))
      expect(found, found.join('\n')).toHaveLength(1)
      expect(found[0].startsWith(label), found[0]).toBe(true)
    })
  }

  it('known-bad probe: a seventh workflow phase that files the issues is reported', () => {
    const workflow = parseFences(TICKETS_MD).find(f => f.includes(WORKFLOW_MARKER))!
    const seeded = seedOnce(TICKETS_MD, workflow, workflow.replace('return phase("tracking-issue"', 'await agent(`OPERATION: ensure-traceable-issue`, { agentType: "Git" });\nreturn phase("tracking-issue"'))
    expect(collectFilingStepDefects(seeded)).toEqual(['the workflow files nothing'])
  })

  it('known-bad probe: a step moved above the workflow is reported', () => {
    const step = filingStep(TICKETS_MD)
    const moved = seedOnce(seedOnce(TICKETS_MD, step, ''), '### Ticket-factory workflow structure', `${step}### Ticket-factory workflow structure`)
    expect(collectFilingStepDefects(moved)).toEqual(['after the workflow: the step follows the workflow fence'])
  })

  it('the slate note says this command files them — the old setup-task promise is gone', () => {
    const note = TICKETS_MD.split('\n').find(l => l.startsWith('- **Evidence policy:**'))
    expect(note).toContain('this command files the tracking issue and one issue per ticket after the workflow returns')
    expect(note).not.toContain('creates it when the ticket is implemented')
  })
})

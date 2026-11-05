/**
 * Running-commands parity guard (D-FOREGROUND-RUN).
 *
 * The Code, Fix, Refactor, Validate and Test agents each run builds and tests, and
 * each carries the same `## Running commands` section: foreground runs under an
 * explicit Bash timeout, capture-then-tail in one call, no backgrounding and no
 * polling across turns. Five agents repeat one doctrine because an agent body is
 * its standing instruction. The section is the single source of that wording, so
 * a copy that drifts would put two different rules in front of two agents doing
 * the same job.
 *
 * What this holds, and why each arm exists:
 *
 *   - exactly one block per body, and the five byte-identical;
 *   - the block fits its byte target, so validate.md (whose old section was 1,488
 *     bytes) does not grow;
 *   - the block states every normative element, so a rewording cannot quietly
 *     drop a rule while the three copies stay identical to each other;
 *   - a run past its timeout moves to the background and is waited for: only its own last
 *     `EXIT=` line sets the label, and the block names no time bound of devflow's own, apart
 *     from the sentence that states the Bash ceiling;
 *   - the wait rule is one whole line as written, so a clause added, dropped or negated
 *     inside it is seen even when every marker stays, and no line keeps the retired
 *     wording that reported an overrun BLOCKED with no wait;
 *   - test.md's dev-server addendum follows the block as a section of its own and
 *     is where the dev server is started in the background: Monitor, which the
 *     block prohibits, is not named there or anywhere else in the body.
 *
 * Each arm runs through a named collector, and the known-bad probes feed the same
 * collectors synthetic copies, so a collector that stopped seeing defects fails
 * its own probe instead of passing the guard vacuously.
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { collectUnfencedH2, resolveAgentSource } from '../helpers.js'

const BLOCK_HEADING = '## Running commands'

/** The block's byte target. validate.md's retired section was 1,488 bytes. */
const BLOCK_MAX_BYTES = 1368

/** The five bodies that carry the block: the three Code variants share it from one partial (D-CODE-VARIANTS). */
const CARRIERS = ['code', 'fix', 'refactor', 'validate', 'test'] as const

/** The three markers of the wait rule: a run past its timeout is waited for with no tool call, and only the last `EXIT=` line of the file the move names sets the label. */
const WAIT_START_MARKER = 'no tool call, even a Read, until its end notice, then Read the last `EXIT=` line of the file the move names, not `$LOG`'
const WAIT_LABEL_MARKER = 'it alone sets the label, not the notice'
const WAIT_REPORT_MARKER = 'Report only after the end notice.'

/**
 * The wait rule as one whole line of the block. The markers are substring checks, so a negated, conditioned or
 * appended clause around them would still pass; this line pin sees it. It also holds the clauses no marker covers:
 * the move to the background, and BLOCKED only with no `EXIT=` line read.
 */
const WAIT_LINE = '- A run past its timeout moves to the background: no tool call, even a Read, until its end notice, then Read the last `EXIT=` line of the file the move names, not `$LOG`; it alone sets the label, not the notice. With none read it is BLOCKED: report its duration and log path. Report only after the end notice.'

/** The retired overrun wording: a run past its timeout was BLOCKED with no wait. A line that keeps it contradicts the wait rule. */
const RETIRED_OVERRUN = ['Do not wait on it', 'exceeds its timeout is BLOCKED', 'background a command and wait on it', 'If it cannot be split, report BLOCKED'] as const

/** The defect for a block whose wait rule is no longer its own whole line as written. */
const WAIT_LINE_CHANGED = 'the wait rule is not one whole line as written: a clause was added, dropped or changed'

/**
 * The normative elements, one marker each. A marker is a literal the block must
 * keep; the label names the rule it stands for.
 */
const ELEMENTS: ReadonlyArray<{ label: string; marker: string }> = [
  { label: '(a) foreground with an explicit Bash timeout', marker: 'in the foreground, each with an explicit Bash `timeout`' },
  { label: '(a) the ceiling and its override', marker: '`BASH_MAX_TIMEOUT_MS`' },
  { label: '(a) the ceiling is read, not assumed', marker: 'echo ${BASH_MAX_TIMEOUT_MS:-600000}' },
  { label: '(b) capture, then tail, in one call, printing the log path a BLOCKED report names, and the exit on a line of its own', marker: 'LOG=$(mktemp); echo "LOG=$LOG"; <command> >"$LOG" 2>&1; rc=$?; tail -n 40 "$LOG"; printf \'\\nEXIT=%s\\n\' "$rc"' },
  { label: '(b) the last EXIT= line is the result', marker: 'The last `EXIT=` line is the result' },
  { label: '(b) a result is never decided from a grep count', marker: 'never decide one from a grep count' },
  { label: '(c) never background a build or test', marker: 'Never background a build or test' },
  { label: '(c) never poll across turns', marker: 'never poll across turns' },
  { label: '(d) the scoped command', marker: 'Prefer the scoped command for the change' },
  { label: '(e) a run past its timeout: no tool call, even a Read, until its end notice, then Read the last EXIT= line of the file the move names, not $LOG', marker: WAIT_START_MARKER },
  { label: '(e) that EXIT= line alone sets the label, not the notice', marker: WAIT_LABEL_MARKER },
  { label: '(e) a run with no EXIT= line read is BLOCKED with duration and log path', marker: 'is BLOCKED: report its duration and log path' },
  { label: '(e) report only after the end notice', marker: WAIT_REPORT_MARKER },
  { label: '(f) a run expected to exceed the ceiling may be split into parts, run in sequence', marker: 'may be split into parts, run in sequence' },
  { label: '(g) no re-run without a change', marker: 'Never re-run a command when nothing it reads has changed' },
  { label: '(h) no interpreter wrapper', marker: '`sh -c`, `bash -c`, `python3 -c` or `node -e`' },
]

type Bodies = Readonly<Record<string, string>>

/**
 * Every `## Running commands` section of a body, each from its heading to the
 * next unfenced `## ` heading (or the end), without its trailing blank lines.
 */
function collectBlocks(content: string): string[] {
  const headings = collectUnfencedH2(content)
  const blocks: string[] = []
  headings.forEach((h, i) => {
    if (h.text !== BLOCK_HEADING) return
    const end = i + 1 < headings.length ? headings[i + 1].index : content.length
    blocks.push(content.slice(h.index, end).trimEnd())
  })
  return blocks
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf-8')
}

/** Named collector: what keeps the carriers from holding one identical block. */
function collectParityDefects(bodies: Bodies): string[] {
  const defects: string[] = []
  const found = new Map<string, string>()
  for (const [name, content] of Object.entries(bodies)) {
    const blocks = collectBlocks(content)
    if (blocks.length !== 1) {
      defects.push(`${name}: expected exactly one "${BLOCK_HEADING}" section, found ${blocks.length}`)
      continue
    }
    found.set(name, blocks[0])
    if (byteLength(blocks[0]) > BLOCK_MAX_BYTES) {
      defects.push(`${name}: block is ${byteLength(blocks[0])} bytes, over the ${BLOCK_MAX_BYTES}-byte target`)
    }
  }
  const [first, ...rest] = [...found.entries()]
  for (const [name, block] of rest) {
    if (first !== undefined && block !== first[1]) defects.push(`${name}: block differs from ${first[0]}'s`)
  }
  return defects
}

/** Named collector: normative elements a block no longer states. */
function collectElementDefects(block: string): string[] {
  return ELEMENTS.filter(e => !block.includes(e.marker)).map(e => `missing ${e.label}`)
}

/** Named collector: a wait rule that is not its own whole line as written, and each retired overrun phrase a block keeps. */
function collectWaitLineDefects(block: string): string[] {
  const defects = block.split('\n').includes(WAIT_LINE) ? [] : [WAIT_LINE_CHANGED]
  return [...defects, ...RETIRED_OVERRUN.filter(phrase => block.includes(phrase)).map(phrase => `the block still says: ${phrase}`)]
}

/** The one sentence of the block that names a number with a time unit: the Bash ceiling, which is the call's only limit. */
const CEILING_SENTENCE = 'The ceiling is 600000 ms, or `BASH_MAX_TIMEOUT_MS` when set (`echo ${BASH_MAX_TIMEOUT_MS:-600000}`).'

/**
 * What bounds a command in time: the `gtimeout` command, the `timeout` command given a duration, the old `{bound}`
 * placeholder, or a `-k` kill grace. The block's own "Bash `timeout`" names the call's parameter and does not match.
 */
const BOUND_TEXT = /\bgtimeout\b|\btimeout\s+(?:-\S+\s+)*\d+|\{bound\}|-k \d+ \d+/

/** A number with a time unit in prose, such as "at most 280 s" or "after 5 minutes". */
const PROSE_BOUND = /\b\d[\d,._]*\s*(?:ms|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?)\b/i

/**
 * Named collector: a time bound of devflow's own in a block. devflow puts no limit on a run: the Bash `timeout`
 * of the call, set at the ceiling, is the only one. The ceiling sentence is the only text skipped, so a bound added
 * to it, or a reworded ceiling, is reported too.
 */
function collectBoundDefects(block: string): string[] {
  const rest = block.split(CEILING_SENTENCE).join('')
  const defects: string[] = []
  const command = BOUND_TEXT.exec(rest)
  if (command !== null) defects.push(`the block carries a time bound: ${command[0]}`)
  const prose = PROSE_BOUND.exec(rest)
  if (prose !== null) defects.push(`the block's prose names a time bound: ${prose[0]}`)
  return defects
}

/** Named collector: what test.md's body does around the block. */
function collectTestAddendumDefects(test: string): string[] {
  const defects: string[] = []
  const headings = collectUnfencedH2(test).map(h => h.text)
  const at = headings.indexOf(BLOCK_HEADING)
  if (at === -1) return ['test.md: no block']
  if (headings[at + 1] !== '## Dev server (test.md only)') {
    defects.push('test.md: "## Dev server (test.md only)" does not follow the block')
  }
  const start = test.indexOf('## Dev server (test.md only)')
  const next = collectUnfencedH2(test).find(h => h.index > start)
  const section = start === -1 ? '' : test.slice(start, next?.index ?? test.length)
  for (const needle of ['browser-testing.md', 'background', 'bounded loop', 'kill', 'Never report while it runs']) {
    if (!section.includes(needle)) defects.push(`test.md: dev-server addendum lacks "${needle}"`)
  }
  const outsideBlock = collectBlocks(test).reduce((rest, b) => rest.replace(b, ''), test)
  if (/Monitor/.test(outsideBlock)) defects.push('test.md: Monitor is named outside the block\'s prohibition')
  return defects
}

/** The shipped capture form: the code span of the block's capture line, or null when the line is gone. */
function captureFormOf(block: string): string | null {
  return /^- Capture, then tail, in one Bash call: `([^`]+)`/m.exec(block)?.[1] ?? null
}

/** Only these ends of a run's stdout matter to the test, so the child gets a bounded wait. */
const CAPTURE_RUN_TIMEOUT_MS = 20_000

/**
 * Run the capture form in bash with `command` in place of its `<command>` slot, and return the lines it prints.
 * The form's `mktemp` writes to `scratch`, because the child's `TMPDIR` is `scratch`.
 */
function runCaptureForm(form: string, command: string, scratch: string): string[] {
  const script = form.replace('<command>', () => command)
  const run = spawnSync('bash', ['-c', script], {
    encoding: 'utf-8',
    env: { PATH: process.env.PATH, TMPDIR: scratch },
    timeout: CAPTURE_RUN_TIMEOUT_MS,
  })
  expect(run.error, 'the capture form ran to its end').toBeUndefined()
  return run.stdout.split('\n')
}

const carriers = (): Record<string, string> =>
  Object.fromEntries(CARRIERS.map(name => [name, resolveAgentSource(name).content]))

describe('D-FOREGROUND-RUN: the Running commands block', () => {
  it('Code, Fix, Refactor, Validate and Test each carry exactly one block, byte-identical, within the byte target', () => {
    expect(collectParityDefects(carriers())).toEqual([])
  })

  it('the block states every normative element', () => {
    const block = collectBlocks(carriers().code)[0]
    expect(block, 'code.md must carry the block').toBeDefined()
    expect(collectElementDefects(block)).toEqual([])
  })

  it('every carrier holds the wait rule as one whole line, and none keeps the retired overrun wording', () => {
    const defects = Object.entries(carriers()).flatMap(([name, body]) =>
      collectBlocks(body).flatMap(block => collectWaitLineDefects(block).map(defect => `${name}: ${defect}`)))
    expect(defects).toEqual([])
  })

  it('no carrier names a time bound of devflow\'s own, apart from the ceiling sentence', () => {
    const defects = Object.entries(carriers()).flatMap(([name, body]) =>
      collectBlocks(body).flatMap(block => collectBoundDefects(block).map(defect => `${name}: ${defect}`)))
    expect(defects).toEqual([])
  })

  it('test.md puts the dev server in a section of its own after the block, and names Monitor nowhere else', () => {
    expect(collectTestAddendumDefects(carriers().test)).toEqual([])
  })

  it('the capture form prints the run\'s own exit on a line of its own when the log ends mid-line after an earlier bare EXIT=0 line', () => {
    const form = captureFormOf(collectBlocks(carriers().code)[0])
    expect(form, 'the block carries a capture line').not.toBeNull()
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'running-commands-capture-'))
    try {
      const lines = runCaptureForm(form ?? '', "( printf 'EXIT=0\\nstopped mid-line'; exit 3 )", scratch)
      expect(lines.filter(line => line.startsWith('EXIT=')).at(-1)).toBe('EXIT=3')
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('known-bad probe: a one-character divergence in a synthetic copy fails the parity check', () => {
    const real = carriers()
    const code = collectBlocks(real.code)[0]
    const diverged = code.replace('tail -n 40', 'tail -n 41')
    expect(diverged, 'the seed must land').not.toBe(code)
    expect(collectParityDefects({ ...real, validate: real.validate.replace(code, diverged) })).toEqual([
      'validate: block differs from code\'s',
    ])
  })

  it('known-bad probe: a lost heading, a doubled block and an oversized block are reported', () => {
    const real = carriers()
    const code = collectBlocks(real.code)[0]
    expect(collectParityDefects({ ...real, test: real.test.replace(code, '') })).toContain(
      'test: expected exactly one "## Running commands" section, found 0',
    )
    expect(collectParityDefects({ ...real, test: `${real.test}\n${code}\n` })).toContain(
      'test: expected exactly one "## Running commands" section, found 2',
    )
    const padded = real.code.replace(code, `${code}\n\n${'x'.repeat(BLOCK_MAX_BYTES)}`)
    expect(collectParityDefects({ ...real, code: padded }).some(d => d.includes('over the 1368-byte target'))).toBe(true)
  })

  it('known-bad probe: a block with a dropped rule is reported by element', () => {
    const code = collectBlocks(carriers().code)[0]
    expect(collectElementDefects(code.replace('Never re-run a command when nothing it reads has changed.', ''))).toEqual([
      'missing (g) no re-run without a change',
    ])
  })

  it('known-bad probe: a wait line with a negated, conditioned or appended clause, or a retired overrun line, keeps every marker and is still reported', () => {
    const code = collectBlocks(carriers().code)[0]
    expect(collectWaitLineDefects(code)).toEqual([])
    const seeds: ReadonlyArray<readonly [from: string, to: string]> = [
      ['With none read it is BLOCKED', 'With it read it is BLOCKED'],
      ['moves to the background:', 'is stopped:'],
      ['it alone sets the label, not the notice.', 'it alone sets the label, not the notice, unless the log says otherwise.'],
      ['Report only after the end notice.', 'Report only after the end notice. Or report BLOCKED at once.'],
    ]
    for (const [from, to] of seeds) {
      const seeded = code.replace(from, to)
      expect(seeded, `the seed must land: ${from}`).not.toBe(code)
      expect(collectElementDefects(seeded), to).toEqual([])
      expect(collectWaitLineDefects(seeded), to).toEqual([WAIT_LINE_CHANGED])
    }
    const retired = `${code}\n- A run that exceeds its timeout is BLOCKED: report its duration and log path. Do not wait on it, poll it or re-run it.`
    expect(collectElementDefects(retired)).toEqual([])
    expect(collectWaitLineDefects(retired)).toEqual([
      'the block still says: Do not wait on it',
      'the block still says: exceeds its timeout is BLOCKED',
    ])
  })

  it('known-bad probe: a block that loses a wait, never-background or split marker is reported by element', () => {
    const code = collectBlocks(carriers().code)[0]
    const lostLabel = (marker: string): string => {
      const element = ELEMENTS.find(e => e.marker === marker)
      expect(element, `an element holds the marker ${marker}`).toBeDefined()
      return `missing ${element?.label}`
    }
    for (const marker of [WAIT_START_MARKER, WAIT_LABEL_MARKER, WAIT_REPORT_MARKER, 'Never background a build or test', 'may be split into parts, run in sequence']) {
      expect(code, `the block holds ${marker}`).toContain(marker)
      expect(collectElementDefects(code.replace(marker, '')), marker).toEqual([lostLabel(marker)])
    }
  })

  it('known-bad probe: a time bound added to the block, or to its ceiling sentence, is reported, and the ceiling sentence alone is not', () => {
    const code = collectBlocks(carriers().code)[0]
    expect(code, 'the block holds the ceiling sentence').toContain(CEILING_SENTENCE)
    expect(collectBoundDefects(code)).toEqual([])
    expect(collectBoundDefects(`${code}\n- Run each build under \`timeout 300\`.`)).toEqual(['the block carries a time bound: timeout 300'])
    expect(collectBoundDefects(`${code}\n- Run each build under \`gtimeout -k 5 30 <command>\`.`)).toEqual(['the block carries a time bound: gtimeout'])
    expect(collectBoundDefects(`${code}\n- Stop a run after 280 s.`)).toEqual(['the block\'s prose names a time bound: 280 s'])
    expect(collectBoundDefects(`${code}\n- Stop a run after 5 minutes.`)).toEqual(['the block\'s prose names a time bound: 5 minutes'])
    expect(collectBoundDefects(code.replace('600000 ms', '300000 ms'))).toContain('the block\'s prose names a time bound: 300000 ms')
  })

  it('known-bad probe: a Monitor clause in test.md is reported', () => {
    const test = carriers().test
    expect(collectTestAddendumDefects(`${test}\nKeep Monitor for dev-server readiness.\n`)).toEqual([
      'test.md: Monitor is named outside the block\'s prohibition',
    ])
  })
})

/**
 * Running-commands parity guard (D-FOREGROUND-RUN).
 *
 * The Code, Validate and Test agents each run builds and tests, and each carries
 * the same `## Running commands` section: foreground runs under an explicit Bash
 * timeout, capture-then-tail in one call, no backgrounding and no polling across
 * turns. Three agents repeat one doctrine because an agent body is its standing
 * instruction. The section is the single source of that wording, so a copy that
 * drifts would put two different rules in front of two agents doing the same job.
 *
 * What this holds, and why each arm exists:
 *
 *   - exactly one block per body, and the three byte-identical;
 *   - the block fits its byte target, so validate.md (whose old section was 1,488
 *     bytes) does not grow;
 *   - the block states every normative element, so a rewording cannot quietly
 *     drop a rule while the three copies stay identical to each other;
 *   - the engine's `build_execution_doctrine()` renders the same text, and the
 *     nine dynamic-build prompt sites name the block instead of copying it;
 *   - test.md's dev-server addendum follows the block as a section of its own and
 *     is where the dev server is started in the background: Monitor, which the
 *     block prohibits, is not named there or anywhere else in the body.
 *
 * Each arm runs through a named collector, and the known-bad probes feed the same
 * collectors synthetic copies, so a collector that stopped seeing defects fails
 * its own probe instead of passing the guard vacuously.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { ROOT, collectUnfencedH2, requireDistFile, resolveAgentSource } from '../helpers.js'

const BLOCK_HEADING = '## Running commands'

/** The block's byte target. validate.md's retired section was 1,488 bytes. */
const BLOCK_MAX_BYTES = 1400

/** The three bodies that carry the block. */
const CARRIERS = ['code', 'validate', 'test'] as const

/**
 * The normative elements, one marker each. A marker is a literal the block must
 * keep; the label names the rule it stands for.
 */
const ELEMENTS: ReadonlyArray<{ label: string; marker: string }> = [
  { label: '(a) foreground with an explicit Bash timeout', marker: 'in the foreground, each with an explicit Bash `timeout`' },
  { label: '(a) the ceiling and its override', marker: '`BASH_MAX_TIMEOUT_MS`' },
  { label: '(a) the ceiling is read, not assumed', marker: 'echo ${BASH_MAX_TIMEOUT_MS:-600000}' },
  { label: '(b) capture, then tail, in one call, printing the log path a BLOCKED report names', marker: 'LOG=$(mktemp); echo "LOG=$LOG"; <command> >"$LOG" 2>&1; rc=$?; tail -n 40 "$LOG"; echo "EXIT=$rc"' },
  { label: '(b) the printed EXIT value is the result', marker: 'never decide one from a grep count' },
  { label: '(c) never background a command and wait on it', marker: 'Never background a command and wait on it' },
  { label: '(c) never poll across turns', marker: 'never poll across turns' },
  { label: '(d) the scoped command', marker: 'Prefer the scoped command for the change' },
  { label: '(e) an overrun is BLOCKED with duration and log path', marker: 'is BLOCKED: report its duration and log path' },
  { label: '(f) split under 90% of the ceiling', marker: 'each under about 90% of it' },
  { label: '(f) the unsplittable remedy', marker: '`devflow flags --set bash-max-timeout-ms=<ms>`' },
  { label: '(g) no re-run without a change', marker: 'Never re-run a command when nothing it reads has changed' },
  { label: '(h) no interpreter wrapper', marker: '`sh -c`, `bash -c`, `python3 -c` or `node -e`' },
  { label: '(i) the same rules in a Workflow sub-agent', marker: 'inside a dynamic Workflow sub-agent' },
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

/** The body of the engine's `build_execution_doctrine()` define, or null when absent. */
function engineDoctrine(engine: string): string | null {
  const start = engine.indexOf('@define build_execution_doctrine():')
  if (start === -1) return null
  const end = engine.indexOf('\n@end', start)
  return end === -1 ? null : engine.slice(start, end)
}

/** The block without its heading line: the text the engine renders. */
function blockBody(block: string): string {
  return block.slice(block.indexOf('\n') + 1).trim()
}

/** Named collector: how the engine's doctrine departs from the block. */
function collectEngineDefects(engine: string, block: string): string[] {
  const doctrine = engineDoctrine(engine)
  if (doctrine === null) return ['_engine.mds: no build_execution_doctrine() define']
  return doctrine.includes(blockBody(block)) ? [] : ['_engine.mds: build_execution_doctrine() does not render the block\'s text']
}

/**
 * The nine dynamic-build prompt sites that name the block, each anchored by its
 * own quoted text. A site names "your Running commands block" and never copies
 * the block, because a sub-agent spawned with an agentType loads its body as
 * its standing instruction (measured on Claude Code 2.1.294 inside a Workflow).
 */
const DYNAMIC_BUILD_SITES: readonly string[] = [
  'When you build or run tests to verify your work, follow your Running commands block.',
  'Run build, typecheck, lint, and tests on branch ${BRANCH}.\nFollow your Running commands block',
  'Self-verify your fix compiles, following your Running commands block. Commit fixes.',
  'Follow your Running commands block for every scenario command.',
  'Self-verify your fix compiles and the scenarios pass, following your Running commands block.',
  'Fix all findings in this batch. Self-verify your fix compiles, following your Running commands block.',
  '(final gate after all fixing).\nFollow your Running commands block',
  '(follow your Running commands block). Report: PASS or FAIL.`, { agentType: "Validate" });\n      if (recheck',
  '(Scrutinize agent made changes; follow your Running commands block)',
]

/** Named collector: prompt sites a dynamic-build body does not carry exactly once. */
function collectSiteDefects(body: string): string[] {
  return DYNAMIC_BUILD_SITES.flatMap(site => {
    const hits = body.split(site).length - 1
    return hits === 1 ? [] : [`${hits} occurrences of: ${site.split('\n')[0]}`]
  })
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
  for (const needle of ['browser-testing.md', 'background', 'bounded loop', 'kill', 'Never end the turn while it runs']) {
    if (!section.includes(needle)) defects.push(`test.md: dev-server addendum lacks "${needle}"`)
  }
  const outsideBlock = collectBlocks(test).reduce((rest, b) => rest.replace(b, ''), test)
  if (/Monitor/.test(outsideBlock)) defects.push('test.md: Monitor is named outside the block\'s prohibition')
  return defects
}

const carriers = (): Record<string, string> =>
  Object.fromEntries(CARRIERS.map(name => [name, resolveAgentSource(name).content]))

const engineSource = (): string =>
  readFileSync(path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_engine.mds'), 'utf-8')

const dynamicBuildSource = (): string =>
  readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'dynamic-build.mds'), 'utf-8')

describe('D-FOREGROUND-RUN: the Running commands block', () => {
  it('Code, Validate and Test each carry exactly one block, byte-identical, within the byte target', () => {
    expect(collectParityDefects(carriers())).toEqual([])
  })

  it('the block states every normative element', () => {
    const block = collectBlocks(carriers().code)[0]
    expect(block, 'code.md must carry the block').toBeDefined()
    expect(collectElementDefects(block)).toEqual([])
  })

  it('the engine renders the same text', () => {
    const block = collectBlocks(carriers().code)[0]
    expect(collectEngineDefects(engineSource(), block)).toEqual([])
  })

  it('the nine dynamic-build prompt sites name the block, in the source and in the compiled command', () => {
    expect(DYNAMIC_BUILD_SITES.length).toBeGreaterThanOrEqual(9)
    expect(collectSiteDefects(dynamicBuildSource())).toEqual([])
    expect(collectSiteDefects(requireDistFile('dynamic-build.md'))).toEqual([])
  })

  it('test.md puts the dev server in a section of its own after the block, and names Monitor nowhere else', () => {
    expect(collectTestAddendumDefects(carriers().test)).toEqual([])
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
    expect(collectParityDefects({ ...real, code: padded }).some(d => d.includes('over the 1400-byte target'))).toBe(true)
  })

  it('known-bad probe: a block with a dropped rule is reported by element', () => {
    const code = collectBlocks(carriers().code)[0]
    expect(collectElementDefects(code.replace('Never re-run a command when nothing it reads has changed.', ''))).toEqual([
      'missing (g) no re-run without a change',
    ])
  })

  it('known-bad probe: a prompt site that goes back to prescribing a procedure is reported', () => {
    const reverted = dynamicBuildSource().replace(
      'Follow your Running commands block for every scenario command.',
      'Use the poll procedure for every scenario command.',
    )
    expect(collectSiteDefects(reverted)).toEqual([
      '0 occurrences of: Follow your Running commands block for every scenario command.',
    ])
  })

  it('known-bad probe: an engine that drifts from the block, and a Monitor clause in test.md, are reported', () => {
    const code = collectBlocks(carriers().code)[0]
    expect(collectEngineDefects(engineSource().replace('tail -n 40', 'tail -n 41'), code)).toEqual([
      '_engine.mds: build_execution_doctrine() does not render the block\'s text',
    ])
    const test = carriers().test
    expect(collectTestAddendumDefects(`${test}\nKeep Monitor for dev-server readiness.\n`)).toEqual([
      'test.md: Monitor is named outside the block\'s prohibition',
    ])
  })
})

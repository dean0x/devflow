/**
 * The commands that keep Polish at every level and read no level: /self-review, /debug and /dynamic-build (TP-5, an
 * item of the test plan of PR #574, which implements #481). In both builds, each command spawns Polish as often as it
 * did before (1, 1 and 2 times), names no level reference and puts no `GATE_LEVEL:` line in a Polish spawn. The check
 * runs through the named collector `collectPolishKeeperDefects`, and known-bad probes run over the same collector.
 *
 * The same holds for Evaluate in /dynamic-build and /dynamic-plan (#483): each spawns it once, in both builds, and puts
 * no `GATE_LEVEL:` line in the Evaluate spawn, so both keep full scope at every level. The check runs through the named
 * collector `collectEvaluateKeeperDefects`.
 *
 * Each build is read at import. A missing build throws, so the guard never skips. `implement-resolve-levels.test.ts`
 * holds the other arms.
 */

import { describe, it, expect } from 'vitest'

import { escapeRe, requireDistFile, resolveCurationOffSource } from '../helpers.js'
import { POLISH_MARKERS, POLISH_SPAWN, countOf } from './level-guard-helpers.js'

/** A command that keeps Polish at every level and reads no level: how many times it spawns Polish. */
interface KeeperSpec { readonly cmd: string; readonly spawns: number }
const KEEPERS: readonly KeeperSpec[] = [
  { cmd: 'self-review', spawns: 1 },
  { cmd: 'debug', spawns: 1 },
  { cmd: 'dynamic-build', spawns: 2 },
]
const POLISH_MARKER = new RegExp(POLISH_MARKERS.map(escapeRe).join('|'))
const polishSpawnCount = (body: string): number => POLISH_MARKERS.reduce((total, marker) => total + countOf(body, marker), 0)
const AGENT_CALL = /\bagent\(/i
/**
 * How many lines above its marker line a spawn call may open. A dynamic-build call opens on its marker line, but a probe
 * that puts a `GATE_LEVEL:` line inside the prompt moves `agent(` two lines up, and that is the longest shape here. The
 * bound is larger, so a prompt of several more lines still starts at its call.
 */
const SPAWN_CALL_LOOKBACK = 12

/** The line where the spawn call of the marker line `at` opens: the nearest `agent(` within the look-back, else `at`. */
function spawnCallStart(lines: readonly string[], at: number): number {
  for (let from = at; from >= Math.max(0, at - SPAWN_CALL_LOOKBACK); from--) if (AGENT_CALL.test(lines[from])) return from
  return at
}

/**
 * The text of each Polish spawn: the line that holds the spawn marker. A call that opens on an earlier line (see
 * `SPAWN_CALL_LOOKBACK`) starts there, and a block spawn (a marker line that ends `):`) runs to the next blank line or fence.
 */
function polishSpawnTexts(body: string): string[] {
  const lines = body.split('\n')
  const out: string[] = []
  lines.forEach((line, i) => {
    if (!POLISH_MARKER.test(line)) return
    const from = spawnCallStart(lines, i)
    let to = i
    if (line.trimEnd().endsWith('):')) while (to + 1 < lines.length && lines[to + 1].trim() !== '' && !lines[to + 1].startsWith('```')) to++
    out.push(lines.slice(from, to + 1).join('\n'))
  })
  return out
}

/** TP-5: the command spawns Polish as often as it does today, names no level reference and puts no `GATE_LEVEL:` line in a Polish spawn. */
export function collectPolishKeeperDefects(body: string, keeper: KeeperSpec): string[] {
  const out: string[] = []
  const spawns = polishSpawnCount(body)
  if (spawns !== keeper.spawns) out.push(`${keeper.cmd} spawns Polish ${spawns} times, expected ${keeper.spawns}`)
  if (body.includes('-levels.md')) out.push(`${keeper.cmd} names a level reference`)
  polishSpawnTexts(body).forEach((spawn, i) => {
    if (/\bGATE_LEVEL\s*:/.test(spawn)) out.push(`${keeper.cmd}: Polish spawn ${i + 1} carries a GATE_LEVEL: line`)
  })
  return out
}

/** A command that keeps Evaluate at full scope at every level: how many times it spawns Evaluate. */
const EVALUATE_KEEPERS: readonly KeeperSpec[] = [
  { cmd: 'dynamic-build', spawns: 1 },
  { cmd: 'dynamic-plan', spawns: 1 },
]
const EVALUATE_MARKER = /agentType:\s*"Evaluate"/g
const TEMPLATE_CALL = 'agent(`'

/**
 * The text of each Evaluate spawn: from the nearest template-literal call before the marker up to and including the
 * marker. The /dynamic-plan call opens 26 lines above its marker, so a fixed line look-back would cut it short.
 */
function evaluateSpawnTexts(body: string): string[] {
  return [...body.matchAll(EVALUATE_MARKER)].map(marker => {
    const at = marker.index ?? 0
    const from = body.lastIndexOf(TEMPLATE_CALL, at)
    return body.slice(from === -1 ? at : from, at + marker[0].length)
  })
}

/** The command spawns Evaluate as often as it does today and puts no `GATE_LEVEL:` line in an Evaluate spawn. */
export function collectEvaluateKeeperDefects(body: string, keeper: KeeperSpec): string[] {
  const out: string[] = []
  const spawns = evaluateSpawnTexts(body)
  if (spawns.length !== keeper.spawns) out.push(`${keeper.cmd} spawns Evaluate ${spawns.length} times, expected ${keeper.spawns}`)
  spawns.forEach((spawn, i) => {
    if (/\bGATE_LEVEL\s*:/.test(spawn)) out.push(`${keeper.cmd}: Evaluate spawn ${i + 1} carries a GATE_LEVEL: line`)
  })
  return out
}

interface KeeperBuild { readonly label: string; readonly keeper: KeeperSpec; readonly body: string }
/** Both builds of each command in `keepers`; a missing build throws. */
const buildsOf = (keepers: readonly KeeperSpec[]): readonly KeeperBuild[] => keepers.flatMap(keeper => {
  const off = resolveCurationOffSource('commands', keeper.cmd)
  if (off === null) throw new Error(`dist/curation-off/commands/${keeper.cmd}.md is absent: run \`npm run build:mds\``)
  return [
    { label: `${keeper.cmd}, curation on`, keeper, body: requireDistFile(`${keeper.cmd}.md`) },
    { label: `${keeper.cmd}, curation off`, keeper, body: off },
  ]
})
const KEEPER_BUILDS = buildsOf(KEEPERS)

describe('/self-review, /debug and /dynamic-build keep Polish and read no level (TP-5)', () => {
  it('the commands that keep Polish spawn it 1, 1 and 2 times', () => {
    expect(KEEPERS.map(k => `${k.cmd}: ${k.spawns}`)).toEqual(['self-review: 1', 'debug: 1', 'dynamic-build: 2'])
  })

  it.each(KEEPER_BUILDS)('$label: Polish is spawned as often as today, no level reference is named and no Polish spawn carries a GATE_LEVEL: line', ({ label, keeper, body }) => {
    expect(body.length, `${label}: nothing read`).toBeGreaterThan(5000)
    expect(collectPolishKeeperDefects(body, keeper)).toEqual([])
  })

  /** A level line put into each Polish spawn of the command: into the prompt of a block, onto the line of a prose spawn, or onto its own line inside a call. */
  const LEVEL_LINE_SEEDS: Readonly<Record<string, { readonly from: string; readonly to: string }>> = {
    'self-review': { from: 'Polish and refine the code for clarity and consistency while preserving functionality.', to: 'GATE_LEVEL: {GATE_LEVEL}\nPolish and refine the code for clarity and consistency while preserving functionality.' },
    'debug': { from: 'Agent(subagent_type="Polish")', to: 'Agent(subagent_type="Polish") with GATE_LEVEL: {GATE_LEVEL}' },
    'dynamic-build': { from: 'Polish and reduce complexity of recent changes on branch ${BRANCH}. Commit any improvements.`', to: 'Polish and reduce complexity of recent changes on branch ${BRANCH}.\nGATE_LEVEL: ${GATE_LEVEL}\nCommit any improvements.`' },
  }

  it.each(KEEPER_BUILDS)('$label: known-bad probes: Polish removed, a spare Polish spawn, a level line in a spawn and a level reference are each reported', ({ keeper, body }) => {
    const defects = (text: string): string[] => collectPolishKeeperDefects(text, keeper)
    const removed = POLISH_MARKERS.reduce((text, marker) => text.split(marker).join(marker.replace('Polish', 'Harden')), body)
    expect(removed, 'the removal landed').not.toBe(body)
    expect(defects(removed), 'Polish removed').toEqual([`${keeper.cmd} spawns Polish 0 times, expected ${keeper.spawns}`])
    expect(defects(`${body}\n${POLISH_SPAWN})\n`), 'a spare Polish spawn').toEqual([`${keeper.cmd} spawns Polish ${keeper.spawns + 1} times, expected ${keeper.spawns}`])
    const { from, to } = LEVEL_LINE_SEEDS[keeper.cmd]
    expect(countOf(body, from), `the level line seed lands in each Polish spawn of ${keeper.cmd}`).toBe(keeper.spawns)
    const leveled = body.split(from).join(to)
    expect(defects(leveled), 'a GATE_LEVEL: line in each Polish spawn').toEqual(Array.from({ length: keeper.spawns }, (_, i) => `${keeper.cmd}: Polish spawn ${i + 1} carries a GATE_LEVEL: line`))
    expect(defects(`${body}\n\nGATE_LEVEL: {GATE_LEVEL}\n`), 'a level line outside every Polish spawn').toEqual([])
    for (const file of ['implement-levels.md', 'resolve-levels.md', 'plan-levels.md', 'code-review-levels.md']) {
      expect(defects(`${body}\nRead the ${file} reference.\n`), file).toEqual([`${keeper.cmd} names a level reference`])
    }
  })
})

describe('/dynamic-build and /dynamic-plan keep Evaluate at full scope (#483)', () => {
  const EVALUATE_BUILDS = buildsOf(EVALUATE_KEEPERS)
  const LEVEL_LINE = 'GATE_LEVEL: ${GATE_LEVEL}\n'

  it('the commands that keep Evaluate spawn it 1 and 1 times', () => {
    expect(EVALUATE_KEEPERS.map(k => `${k.cmd}: ${k.spawns}`)).toEqual(['dynamic-build: 1', 'dynamic-plan: 1'])
  })

  it.each(EVALUATE_BUILDS)('$label: Evaluate is spawned as often as today and no Evaluate spawn carries a GATE_LEVEL: line', ({ label, keeper, body }) => {
    expect(body.length, `${label}: nothing read`).toBeGreaterThan(5000)
    expect(collectEvaluateKeeperDefects(body, keeper)).toEqual([])
  })

  it.each(EVALUATE_BUILDS)('$label: known-bad probes: a level line on line 1 or line 2 of the template and a spare spawn are reported, and a level line outside the spawn is not', ({ keeper, body }) => {
    const defects = (text: string): string[] => collectEvaluateKeeperDefects(text, keeper)
    const call = body.lastIndexOf(TEMPLATE_CALL, body.search(EVALUATE_MARKER))
    expect(call, `${keeper.cmd}: the Evaluate template call is found`).toBeGreaterThan(-1)
    const template = call + TEMPLATE_CALL.length
    const secondLine = body.indexOf('\n', template) + 1
    expect(secondLine, `${keeper.cmd}: the template has a second line`).toBeGreaterThan(template)
    const oneSpawn = [`${keeper.cmd}: Evaluate spawn 1 carries a GATE_LEVEL: line`]

    expect(defects(`${body.slice(0, template)}${LEVEL_LINE}${body.slice(template)}`), 'a level line on line 1 of the template').toEqual(oneSpawn)
    expect(defects(`${body.slice(0, secondLine)}${LEVEL_LINE}${body.slice(secondLine)}`), 'a level line on line 2 of the template').toEqual(oneSpawn)
    expect(defects(`${body.slice(0, call)}${LEVEL_LINE}${body.slice(call)}`), 'a level line before the call').toEqual([])
    expect(defects(`${body}\n\nGATE_LEVEL: {GATE_LEVEL}\n`), 'a level line after every spawn').toEqual([])
    expect(defects(`${body}\nawait agent(\`x\`, { agentType: "Evaluate" })\n`), 'a spare Evaluate spawn').toEqual([`${keeper.cmd} spawns Evaluate ${keeper.spawns + 1} times, expected ${keeper.spawns}`])
    expect(defects(body.replace(EVALUATE_MARKER, 'agentType: "Harden"')), 'Evaluate removed').toEqual([`${keeper.cmd} spawns Evaluate 0 times, expected ${keeper.spawns}`])
  })
})

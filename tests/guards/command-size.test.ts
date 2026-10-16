/**
 * D-CMD-SIZE (#456, AC-401, AC-402): every compiled command carries a byte ceiling, in both builds.
 *
 * A command is the main session's standing context: its whole text is read on the first turn and
 * re-read from cache on every later one, so a command that grows pays on every turn of every run.
 * The ceilings sit at the sizes measured when #456 closed (zero headroom) and are registered in
 * tests/fixtures/numeric-floors.json as `command-<name>-max` (the learning-on build, the one an
 * installation with learning on reads) and `command-<name>-learning-off-max` (the learning-off build).
 * A ceiling is lowered by a pass that cuts text and never raised to fit text that grew back: a command
 * that needs more bytes first moves a rare branch to a reference (D-CMD-REF-HAND) or condenses text a
 * line of the same command already states.
 *
 *   - AC-402. All 14 compiled commands have a ceiling in each build, and nothing else does.
 *   - AC-401. /implement, /resolve, /plan and /code-review end below the size main held, in both builds.
 *   - A learning-off build never exceeds its learning-on build: it is the same host with its learning
 *     arms removed.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad probe run through the
 * same collector.
 */

import { describe, it, expect } from 'vitest'

import { MDS_COMMAND_HOSTS } from '../fixtures/mds-manifest.js'
import { requireDistFile, resolveLearningOffSource } from '../helpers.js'

type Build = 'on' | 'off'

/** [command, build, ceiling in bytes]. Each row's text is the pattern its numeric-floors.json entry pins. */
const COMMAND_MAX_BYTES: ReadonlyArray<readonly [string, Build, number]> = [
  ['bug-analysis', 'on', 24_917],
  ['bug-analysis', 'off', 21_007],
  ['code-review', 'on', 34_974],
  ['code-review', 'off', 32_229],
  ['debug', 'on', 19_885],
  ['debug', 'off', 16_966],
  ['dynamic-build', 'on', 106_923],
  ['dynamic-build', 'off', 103_536],
  ['dynamic-plan', 'on', 36_880],
  ['dynamic-plan', 'off', 32_530],
  ['dynamic-profile', 'on', 16_389],
  ['dynamic-profile', 'off', 12_673],
  ['dynamic-tickets', 'on', 41_336],
  ['dynamic-tickets', 'off', 37_129],
  ['explore', 'on', 12_866],
  ['explore', 'off', 9_964],
  ['implement', 'on', 49_718],
  ['implement', 'off', 46_864],
  ['plan', 'on', 37_997],
  ['plan', 'off', 35_029],
  ['release', 'on', 22_825],
  ['release', 'off', 19_609],
  ['research', 'on', 14_894],
  ['research', 'off', 10_838],
  ['resolve', 'on', 51_824],
  ['resolve', 'off', 48_624],
  ['self-review', 'on', 15_228],
  ['self-review', 'off', 12_156],
]

/** The four commands #456 trims, and the sizes main held before wave 4C: [learning-on, learning-off]. */
const MAIN_BYTES: Readonly<Record<string, readonly [number, number]>> = {
  'implement': [57_212, 54_369],
  'resolve': [54_899, 51_692],
  'plan': [39_153, 36_166],
  'code-review': [36_680, 33_996],
}

const key = (command: string, build: Build): string => `${command}/${build}`

/** The compiled size of one command in one build, or null when the build has no such file. */
function builtBytes(command: string, build: Build): number | null {
  const text = build === 'on' ? requireDistFile(`${command}.md`) : resolveLearningOffSource('commands', command)
  return text === null ? null : Buffer.byteLength(text, 'utf-8')
}

/** Named collector: the command/build pairs the table does not cover, and the rows that cover none. */
export function collectCoverageDefects(
  rows: ReadonlyArray<readonly [string, Build, number]>,
  commands: readonly string[],
): string[] {
  const have = rows.map(([command, build]) => key(command, build))
  const want = commands.flatMap(command => (['on', 'off'] as const).map(build => key(command, build)))
  return [
    ...want.filter(k => !have.includes(k)).map(k => `${k}: no ceiling`),
    ...have.filter(k => !want.includes(k)).map(k => `${k}: a ceiling for no compiled command`),
    ...have.filter((k, i) => have.indexOf(k) !== i).map(k => `${k}: two ceilings`),
  ]
}

/** Named collector: the compiled commands above their ceiling, and the builds that are missing. */
export function collectOversize(
  rows: ReadonlyArray<readonly [string, Build, number]>,
  measure: (command: string, build: Build) => number | null,
): string[] {
  const out: string[] = []
  for (const [command, build, max] of rows) {
    const bytes = measure(command, build)
    if (bytes === null) out.push(`${key(command, build)}: the build has no file`)
    else if (bytes > max) out.push(`${key(command, build)}: ${bytes} bytes, ceiling ${max}`)
  }
  return out
}

/** Named collector: the commands whose learning-off figure exceeds the learning-on figure. */
export function collectOffAboveOn(figure: (command: string, build: Build) => number | null, commands: readonly string[]): string[] {
  return commands.flatMap(command => {
    const on = figure(command, 'on')
    const off = figure(command, 'off')
    return on === null || off === null || off > on ? [`${command}: learning-off ${off} bytes, learning-on ${on}`] : []
  })
}

/** The ceiling the table holds for one command and build, or null. */
const ceilingOf = (command: string, build: Build): number | null =>
  COMMAND_MAX_BYTES.find(([c, b]) => c === command && b === build)?.[2] ?? null

describe('AC-402: all 14 compiled commands have a byte ceiling in each build', () => {
  it('the table covers exactly the compiled commands, in both builds', () => {
    expect(MDS_COMMAND_HOSTS.length, 'the roster is empty, so this guard proves nothing').toBeGreaterThanOrEqual(14)
    expect(COMMAND_MAX_BYTES).toHaveLength(MDS_COMMAND_HOSTS.length * 2)
    expect(collectCoverageDefects(COMMAND_MAX_BYTES, MDS_COMMAND_HOSTS)).toEqual([])
  })

  it('no compiled command is above its ceiling', () => {
    expect(collectOversize(COMMAND_MAX_BYTES, builtBytes)).toEqual([])
  })

  it('known-bad probes: a missing row, a stray row, a duplicate, an over-size command and a missing build are each reported', () => {
    const rows = COMMAND_MAX_BYTES
    expect(collectCoverageDefects(rows.filter(([c, b]) => !(c === 'plan' && b === 'off')), MDS_COMMAND_HOSTS)).toEqual(['plan/off: no ceiling'])
    expect(collectCoverageDefects([...rows, ['gone', 'on', 1]], MDS_COMMAND_HOSTS)).toEqual(['gone/on: a ceiling for no compiled command'])
    expect(collectCoverageDefects([...rows, ['plan', 'on', 1]], MDS_COMMAND_HOSTS)).toEqual(['plan/on: two ceilings'])
    expect(collectOversize(rows, (c, b) => (c === 'plan' && b === 'on' ? ceilingOf('plan', 'on')! + 1 : 0))).toEqual([
      `plan/on: ${ceilingOf('plan', 'on')! + 1} bytes, ceiling ${ceilingOf('plan', 'on')}`,
    ])
    expect(collectOversize(rows, (c, b) => (c === 'plan' && b === 'off' ? null : 0))).toEqual(['plan/off: the build has no file'])
  })
})

describe('AC-401: the four trimmed commands end below main in both builds', () => {
  it('each ceiling is below the size main held', () => {
    expect(Object.keys(MAIN_BYTES), 'the comparison table is empty').toEqual(['implement', 'resolve', 'plan', 'code-review'])
    for (const [command, [on, off]] of Object.entries(MAIN_BYTES)) {
      expect(ceilingOf(command, 'on'), `${command}/on`).toBeLessThan(on)
      expect(ceilingOf(command, 'off'), `${command}/off`).toBeLessThan(off)
    }
  })

  it('each built command is below the size main held', () => {
    for (const [command, [on, off]] of Object.entries(MAIN_BYTES)) {
      expect(builtBytes(command, 'on'), `${command}/on`).toBeLessThan(on)
      expect(builtBytes(command, 'off'), `${command}/off`).toBeLessThan(off)
    }
  })
})

describe('a learning-off build never exceeds its learning-on build', () => {
  it('holds for the built commands and for their ceilings', () => {
    expect(collectOffAboveOn(builtBytes, MDS_COMMAND_HOSTS)).toEqual([])
    expect(collectOffAboveOn(ceilingOf, MDS_COMMAND_HOSTS)).toEqual([])
  })

  it('known-bad probe: an off build above its on build is reported', () => {
    expect(collectOffAboveOn((c, b) => (c === 'plan' ? (b === 'on' ? 10 : 11) : 5), ['plan', 'debug'])).toEqual(['plan: learning-off 11 bytes, learning-on 10'])
    expect(collectOffAboveOn(() => null, ['plan'])).toEqual(['plan: learning-off null bytes, learning-on null'])
  })
})

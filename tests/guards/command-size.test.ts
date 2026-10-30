/**
 * D-CMD-SIZE (#456, AC-401, AC-402): every compiled command carries a byte ceiling, in both builds.
 *
 * A command is the main session's standing context: its whole text is read on the first turn and
 * re-read from cache on every later one, so a command that grows pays on every turn of every run.
 * The ceilings sit at the sizes measured when #456 closed (zero headroom) and are registered in
 * tests/fixtures/numeric-floors.json as `command-<name>-max` (the curation-on build, the one an
 * installation with curation on reads) and `command-<name>-curation-off-max` (the curation-off build).
 * A ceiling is lowered by a pass that cuts text and never raised to fit text that grew back: a command
 * that needs more bytes first moves a rare branch to a reference (D-CMD-REF-HAND) or condenses text a
 * line of the same command already states.
 *
 *   - AC-402. All 14 compiled commands have a ceiling in each build, and nothing else does.
 *   - AC-401. /implement, /resolve, /plan and /code-review end below the size main held, in both builds.
 *   - A curation-off build never exceeds its curation-on build: it is the same host with its curation
 *     arms removed.
 *
 * Four builds exist (`Build`): `on`, `off` (curation off, the name its rows and floor ids have always
 * used), `compliance-off` and `both-off`. A command with a compliance arm has a compliance-off build,
 * and one that also has a curation arm has a both-off build (#648, AC-33). Those ceilings sit at the
 * size measured at their first build, with zero headroom, as `command-<name>-compliance-off-max` and
 * `command-<name>-both-off-max`. The rule sets no comparison between an off build and the on build:
 * a compliance-off command can carry a local line the on build replaces with a posting step, so it can
 * be larger (/implement and /dynamic-tickets are).
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad probe run through the
 * same collector.
 */

import { describe, it, expect } from 'vitest'

import { COMPLIANCE_VARIANT_HOSTS, CURATION_VARIANT_HOSTS, MDS_COMMAND_HOSTS } from '../fixtures/mds-manifest.js'
import { requireDistFile, resolveVariantOffSource } from '../helpers.js'
import type { OffVariantKey } from '../../src/core/curation-variants.js'

type Build = 'on' | 'off' | 'compliance-off' | 'both-off'

/** The off tree each non-`on` build is read from. */
const OFF_VARIANT: Readonly<Record<Exclude<Build, 'on'>, OffVariantKey>> = {
  'off': 'curation-off',
  'compliance-off': 'compliance-off',
  'both-off': 'both-off',
}

/** [command, build, ceiling in bytes]. Each row's text is the pattern its numeric-floors.json entry pins. */
const COMMAND_MAX_BYTES: ReadonlyArray<readonly [string, Build, number]> = [
  ['bug-analysis', 'on', 23_724],
  ['bug-analysis', 'off', 20_130],
  ['bug-analysis', 'compliance-off', 23_193],
  ['bug-analysis', 'both-off', 19_599],
  ['code-review', 'on', 34_062],
  ['code-review', 'off', 31_487],
  ['code-review', 'compliance-off', 31_269],
  ['code-review', 'both-off', 28_694],
  ['debug', 'on', 18_340],
  ['debug', 'off', 15_591],
  ['dynamic-build', 'on', 105_421],
  ['dynamic-build', 'off', 102_034],
  ['dynamic-build', 'compliance-off', 102_429],
  ['dynamic-build', 'both-off', 99_042],
  ['dynamic-plan', 'on', 35_740],
  ['dynamic-plan', 'off', 31_450],
  ['dynamic-profile', 'on', 16_329],
  ['dynamic-profile', 'off', 12_673],
  ['dynamic-tickets', 'on', 41_146],
  ['dynamic-tickets', 'off', 36_999],
  ['dynamic-tickets', 'compliance-off', 41_294],
  ['dynamic-tickets', 'both-off', 37_147],
  ['explore', 'on', 12_325],
  ['explore', 'off', 9_593],
  ['implement', 'on', 45_272],
  ['implement', 'off', 42_588],
  ['implement', 'compliance-off', 46_387],
  ['implement', 'both-off', 43_703],
  ['plan', 'on', 36_222],
  ['plan', 'off', 33_424],
  ['plan', 'compliance-off', 36_055],
  ['plan', 'both-off', 33_257],
  ['release', 'on', 22_297],
  ['release', 'off', 19_141],
  ['release', 'compliance-off', 17_199],
  ['release', 'both-off', 14_043],
  ['research', 'on', 14_177],
  ['research', 'off', 10_351],
  ['resolve', 'on', 50_283],
  ['resolve', 'off', 47_253],
  ['resolve', 'compliance-off', 43_936],
  ['resolve', 'both-off', 40_890],
  ['self-review', 'on', 14_255],
  ['self-review', 'off', 11_353],
]

/** The four commands #456 trims, and the sizes main held before wave 4C: [curation-on, curation-off]. */
const MAIN_BYTES: Readonly<Record<string, readonly [number, number]>> = {
  'implement': [57_212, 54_369],
  'resolve': [54_899, 51_692],
  'plan': [39_153, 36_166],
  'code-review': [36_680, 33_996],
}

const key = (command: string, build: Build): string => `${command}/${build}`

/** The compiled size of one command in one build, or null when the build has no such file. */
function builtBytes(command: string, build: Build): number | null {
  const text = build === 'on' ? requireDistFile(`${command}.md`) : resolveVariantOffSource(OFF_VARIANT[build], 'commands', command)
  return text === null ? null : Buffer.byteLength(text, 'utf-8')
}

/**
 * The builds a command is held to: `on` and curation-off for every compiled command, compliance-off for
 * a command with a compliance arm, and both-off for one that also has a curation arm. Named sets from
 * the host rosters, which the build's own variant manifest is asserted against in both directions.
 */
export function buildsOf(command: string): readonly Build[] {
  const host = `commands/${command}`
  const compliance = COMPLIANCE_VARIANT_HOSTS.includes(host)
  const curation = CURATION_VARIANT_HOSTS.includes(host)
  return [
    'on',
    'off',
    ...(compliance ? (['compliance-off'] as const) : []),
    ...(compliance && curation ? (['both-off'] as const) : []),
  ]
}

/** Named collector: the command/build pairs the table does not cover, and the rows that cover none. */
export function collectCoverageDefects(
  rows: ReadonlyArray<readonly [string, Build, number]>,
  commands: readonly string[],
): string[] {
  const have = rows.map(([command, build]) => key(command, build))
  const want = commands.flatMap(command => buildsOf(command).map(build => key(command, build)))
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

/** Named collector: the commands whose curation-off figure exceeds the curation-on figure. */
export function collectOffAboveOn(figure: (command: string, build: Build) => number | null, commands: readonly string[]): string[] {
  return commands.flatMap(command => {
    const on = figure(command, 'on')
    const off = figure(command, 'off')
    return on === null || off === null || off > on ? [`${command}: curation-off ${off} bytes, curation-on ${on}`] : []
  })
}

/** The ceiling the table holds for one command and build, or null. */
const ceilingOf = (command: string, build: Build): number | null =>
  COMMAND_MAX_BYTES.find(([c, b]) => c === command && b === build)?.[2] ?? null

/** Named collector: the ceilings that sit above the measured size, for the builds that carry no headroom. */
export function collectHeadroom(
  rows: ReadonlyArray<readonly [string, Build, number]>,
  builds: readonly Build[],
  measure: (command: string, build: Build) => number | null,
): string[] {
  return rows
    .filter(([, build]) => builds.includes(build))
    .flatMap(([command, build, max]) => {
      const bytes = measure(command, build)
      return bytes === null || bytes === max ? [] : [`${key(command, build)}: ${bytes} bytes, ceiling ${max}`]
    })
}

/** The builds #648 added: their ceilings are set at the measured size, so the figure and the ceiling are equal. */
const COMPLIANCE_BUILDS: readonly Build[] = ['compliance-off', 'both-off']

/** The command names among the compliance-armed hosts, in roster order. */
const COMPLIANCE_COMMANDS: readonly string[] = COMPLIANCE_VARIANT_HOSTS
  .filter(host => host.startsWith('commands/'))
  .map(host => host.slice('commands/'.length))

describe('AC-402: all 14 compiled commands have a byte ceiling in each build', () => {
  it('the table covers exactly the compiled commands, in each build they have', () => {
    expect(MDS_COMMAND_HOSTS.length, 'the roster is empty, so this guard proves nothing').toBeGreaterThanOrEqual(14)
    expect(COMMAND_MAX_BYTES).toHaveLength(MDS_COMMAND_HOSTS.reduce((rows, command) => rows + buildsOf(command).length, 0))
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

describe('AC-33: each compliance-off and both-off command build has a ceiling at its measured size', () => {
  it('the compliance commands are the roster hosts of kind commands, and each is a compiled command', () => {
    expect(COMPLIANCE_COMMANDS.length, 'the compliance roster holds no command, so this guard proves nothing').toBeGreaterThanOrEqual(8)
    for (const command of COMPLIANCE_COMMANDS) expect(MDS_COMMAND_HOSTS, command).toContain(command)
  })

  it('each of them has a compliance-off ceiling, and a both-off ceiling where it also has a curation arm', () => {
    for (const command of COMPLIANCE_COMMANDS) {
      expect(ceilingOf(command, 'compliance-off'), `${command}/compliance-off`).not.toBeNull()
      expect(ceilingOf(command, 'both-off') === null, `${command}/both-off`).toBe(!CURATION_VARIANT_HOSTS.includes(`commands/${command}`))
    }
  })

  it('no compliance build is above its ceiling, and none has headroom over it', () => {
    const rows = COMMAND_MAX_BYTES.filter(([, build]) => COMPLIANCE_BUILDS.includes(build))
    expect(rows.length, 'the table holds no compliance row, so this guard proves nothing').toBeGreaterThanOrEqual(COMPLIANCE_COMMANDS.length * 2)
    expect(collectOversize(rows, builtBytes)).toEqual([])
    expect(collectHeadroom(COMMAND_MAX_BYTES, COMPLIANCE_BUILDS, builtBytes)).toEqual([])
  })

  it('known-bad probes: a ceiling above the measured size and a missing compliance build are each reported', () => {
    const above = (c: string, b: Build): number | null => (c === 'plan' && b === 'compliance-off' ? ceilingOf('plan', 'compliance-off')! - 1 : ceilingOf(c, b))
    expect(collectHeadroom(COMMAND_MAX_BYTES, COMPLIANCE_BUILDS, above)).toEqual([
      `plan/compliance-off: ${ceilingOf('plan', 'compliance-off')! - 1} bytes, ceiling ${ceilingOf('plan', 'compliance-off')}`,
    ])
    expect(collectHeadroom(COMMAND_MAX_BYTES, ['on', 'off'], above), 'a build outside the listed ones is not held to equality').toEqual([])
    expect(collectCoverageDefects(COMMAND_MAX_BYTES.filter(([c, b]) => !(c === 'release' && b === 'both-off')), MDS_COMMAND_HOSTS)).toEqual(['release/both-off: no ceiling'])
    expect(collectOversize(COMMAND_MAX_BYTES, (c, b) => (c === 'release' && b === 'compliance-off' ? ceilingOf('release', 'compliance-off')! + 1 : 0))).toEqual([
      `release/compliance-off: ${ceilingOf('release', 'compliance-off')! + 1} bytes, ceiling ${ceilingOf('release', 'compliance-off')}`,
    ])
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

describe('a curation-off build never exceeds its curation-on build', () => {
  it('holds for the built commands and for their ceilings', () => {
    expect(collectOffAboveOn(builtBytes, MDS_COMMAND_HOSTS)).toEqual([])
    expect(collectOffAboveOn(ceilingOf, MDS_COMMAND_HOSTS)).toEqual([])
  })

  it('known-bad probe: an off build above its on build is reported', () => {
    expect(collectOffAboveOn((c, b) => (c === 'plan' ? (b === 'on' ? 10 : 11) : 5), ['plan', 'debug'])).toEqual(['plan: curation-off 11 bytes, curation-on 10'])
    expect(collectOffAboveOn(() => null, ['plan'])).toEqual(['plan: curation-off null bytes, curation-on null'])
  })
})

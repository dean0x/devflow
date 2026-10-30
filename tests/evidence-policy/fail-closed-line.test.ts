/**
 * tests/evidence-policy/fail-closed-line.test.ts
 *
 * Script change 6 (#675, PB2): `resolve-settings.cjs` and `resolve-evidence-policy.cjs`
 * print their own fail-closed line on EVERY error path, so a prompt's literal fallback
 * and the script's printed line are the same bytes.
 *
 *   exit 1  usage error (an unknown flag, a bare dash, two positionals)
 *   exit 2  input unusable (a missing directory, a regular file)
 *   exit 4  internal error (a spawn that throws; a formatter that throws)
 *   exit 5  output gate refused (a hostile composed line)
 *
 * The expected bytes are read from the PARTIAL: the one literal fallback its prompt
 * carries (`⇒ use `…` instead`). They are never copied into this file, so a change to
 * either side fails here. The literal must also be a line the script's own grammar accepts.
 *
 * The exits that real input can reach (1, 2 and 4 from a spawn that throws) run as a
 * process, so the line the model reads is the one the boundary writes and the exit code
 * is the one the boundary sets. The formatter faults (exit 4 and exit 5) cannot come from
 * real input: the formatter only composes lines its own gate accepts. They are checked on
 * `settleOutcome`, the step that turns main()'s outcome into the line and the exit code
 * the boundary writes.
 *
 * NOT covered: a script that cannot start at all (a missing file, a node that is not
 * installed). Nothing can print a line then. The partial's literal covers that run, and
 * tests/commands/settings-partial.test.ts and tests/evidence-policy/partial-wiring.test.ts
 * hold that literal in the prompt.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { ROOT } from '../helpers.js'
import { RESOLVER_SCRIPT, SETTINGS_SCRIPT, runResolver } from './scripted-shim.js'

type ScriptModule = Readonly<Record<string, unknown>>

interface Subject {
  readonly name: string
  readonly script: string
  readonly partial: string
  /** The script export that holds the grammar a line must match. */
  readonly grammar: 'SETTINGS_LINE_RE' | 'OUTPUT_LINE_RE'
}

const SUBJECTS: readonly Subject[] = [
  {
    name: 'resolve-settings.cjs',
    script: SETTINGS_SCRIPT,
    partial: 'src/assets/commands/_partials/_settings.mds',
    grammar: 'SETTINGS_LINE_RE',
  },
  {
    name: 'resolve-evidence-policy.cjs',
    script: RESOLVER_SCRIPT,
    partial: 'src/assets/commands/_partials/_evidence_policy.mds',
    grammar: 'OUTPUT_LINE_RE',
  },
]

/** Named collector: the literal fallbacks in a text, each the backticked span after `⇒ use`. */
function collectLiterals(text: string): string[] {
  return [...text.matchAll(/⇒ use `([^`\n]+)` instead/g)].map(m => m[1])
}

/** The one literal fallback the partial's prompt carries. */
function partialLiteral(partialRel: string): string {
  const found = collectLiterals(fs.readFileSync(path.join(ROOT, partialRel), 'utf-8'))
  if (found.length !== 1) throw new Error(`${partialRel}: expected one literal fallback, found ${found.length}`)
  return found[0]
}

/** The subprocess arms spawn node once each, which can take longer than the default test timeout. */
const SUBPROCESS_TIMEOUT = { timeout: 20_000 } as const

/** What `settleOutcome` returns: the stdout line (before its newline) and the exit code. */
interface Settled {
  readonly code: number
  readonly line: string
}

/** Run the script's own `settleOutcome` on an outcome main() could return. */
function settle(script: string, outcome: unknown): Settled {
  const mod = createRequire(import.meta.url)(script) as ScriptModule
  const settleOutcome = mod.settleOutcome
  if (typeof settleOutcome !== 'function') throw new Error(`${script}: settleOutcome is not exported by the script`)
  return settleOutcome(outcome) as Settled
}

/** A composed line the output gate refuses: two lines, the second one smuggled in. */
const HOSTILE_LINE = 'hostile\nsecond line'

let tmp: string
let home: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-fail-closed-'))
  home = path.join(tmp, 'home')
  fs.mkdirSync(path.join(home, '.devflow'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('the partial literal is the script line (one source of truth)', () => {
  it.each(SUBJECTS)('$name: the literal in $partial is a line its own grammar accepts', ({ script, partial, grammar }) => {
    const mod = createRequire(import.meta.url)(script) as ScriptModule
    const re = mod[grammar] as RegExp
    expect(re, `${grammar} is not exported by the script`).toBeInstanceOf(RegExp)
    expect(re.test(partialLiteral(partial))).toBe(true)
  })

  it('known-bad probe: a text with no literal, or with two, is reported by the collector', () => {
    const real = fs.readFileSync(path.join(ROOT, SUBJECTS[0].partial), 'utf-8')
    const literal = partialLiteral(SUBJECTS[0].partial)
    expect(collectLiterals(real)).toEqual([literal])
    expect(collectLiterals(real.replace(literal, ''))).toEqual([])
    expect(collectLiterals(`${real}\n⇒ use \`${literal}\` instead`)).toEqual([literal, literal])
  })
})

describe.each(SUBJECTS)('$name prints the partial literal on every error path', ({ script, partial }) => {
  const expectedStdout = (): string => `${partialLiteral(partial)}\n`

  describe('as a process', SUBPROCESS_TIMEOUT, () => {
    function throwingSpawnPreload(): string {
      const preload = path.join(tmp, 'throw-on-spawn.cjs')
      fs.writeFileSync(preload, "require('child_process').spawnSync = () => { throw new Error('seeded internal error'); };\n")
      return preload
    }

    it.each([
      ['an unknown flag', ['--help']],
      ['a bare dash', ['-']],
      ['two positionals', ['/a', '/b']],
    ])('exit 1, usage (%s): the literal on stdout, the usage on stderr', (_label, args) => {
      const run = runResolver({ home, script, args })
      expect(run.status).toBe(1)
      expect(run.stdout).toBe(expectedStdout())
      expect(run.stderr).toContain('Usage')
    })

    it('exit 2, input unusable (a missing directory): the literal on stdout', () => {
      const run = runResolver({ home, script, args: [path.join(tmp, 'does-not-exist')] })
      expect(run.status).toBe(2)
      expect(run.stdout).toBe(expectedStdout())
    })

    it('exit 2, input unusable (a regular file): the literal on stdout', () => {
      const file = path.join(tmp, 'a-file')
      fs.writeFileSync(file, 'x')
      const run = runResolver({ home, script, args: [file] })
      expect(run.status).toBe(2)
      expect(run.stdout).toBe(expectedStdout())
    })

    it('exit 4, internal error (a spawn that throws): the literal on stdout', () => {
      const run = runResolver({ home, script, args: [tmp], nodeArgs: ['--require', throwingSpawnPreload()] })
      expect(run.status, run.stderr).toBe(4)
      expect(run.stdout).toBe(expectedStdout())
    })
  })

  describe('settleOutcome, the step before the boundary writes', () => {
    it.each([
      ['a resolved outcome whose line is hostile', { code: 0, line: HOSTILE_LINE }],
      ['a refusal outcome from main()', { code: 5, line: HOSTILE_LINE }],
    ])('exit 5, output gate refused (%s): the literal and code 5', (_label, outcome) => {
      expect(settle(script, outcome)).toEqual({ code: 5, line: partialLiteral(partial) })
    })

    it.each([
      ['an internal-error outcome from main(), as when the formatter throws', { code: 4, line: HOSTILE_LINE }],
      ['an outcome that is not an object', null],
    ])('exit 4, internal error (%s): the literal and code 4', (_label, outcome) => {
      expect(settle(script, outcome)).toEqual({ code: 4, line: partialLiteral(partial) })
    })
  })
})

/**
 * The machine TDD switch, prompt side (#756, AC8).
 *
 *   - `/implement` passes `TDD: {TDD}`, the settings-line value, to every Code spawn, in every build.
 *   - The Code body says what `TDD: off` allows (tests may follow the code, no RED step) and what stays
 *     (the test plan and the bug-fix regression test). Its test-first rule and its typing rule stay.
 *   - The preloaded test-driven-development skill lists `TDD: off` among the cases where test first does not bind.
 *   - The switch is machine only: the repository config parser has no `tdd` switch, and no compiled prompt
 *     reads the manifest or a config file for it.
 *
 * The line grammar, the fail-closed line and the repo-key cases live in the settings tests; the CLI and the
 * manifest read in tests/cli/tdd.test.ts. Each rule here has a named collector and known-bad probes.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as path from 'path'
import { ROOT, requireDistFile, resolveAgentSource, resolveCurationOffSource, resolveVariantOffSource } from '../helpers.js'

const PROJECT_CONFIG = createRequire(import.meta.url)(
  path.join(ROOT, 'src', 'assets', 'scripts', 'lib', 'project-config.cjs'),
) as { readonly FEATURE_SWITCHES: readonly string[] }

/** The four compiled builds of /implement, by label. */
const IMPLEMENT_BUILDS: ReadonlyArray<readonly [string, string]> = [
  ['on', requireDistFile('implement.md')],
  ['curation-off', resolveCurationOffSource('commands', 'implement') ?? ''],
  ['compliance-off', resolveVariantOffSource('compliance-off', 'commands', 'implement') ?? ''],
  ['both-off', resolveVariantOffSource('both-off', 'commands', 'implement') ?? ''],
]

/** The prompt of every `Agent(subagent_type="Code")` spawn in a command: up to the next spawn or the closing fence. */
export function codeSpawnPrompts(command: string): string[] {
  return [...command.matchAll(/Agent\(subagent_type="Code"\):[^\n]*\n([\s\S]*?)(?=\nAgent\(|```)/g)].map(match => match[1])
}

/** Named collector: how a compiled /implement falls short of passing the TDD value to Code. */
export function collectTddSpawnDefects(label: string, command: string): string[] {
  const out: string[] = []
  const spawns = codeSpawnPrompts(command)
  if (spawns.length === 0) out.push(`${label}: no Code spawn found, so the check would pass on nothing`)
  spawns.forEach((spawn, i) => {
    const lines = spawn.split('\n')
    const at = lines.findIndex(line => line.includes('OPERATION: implement'))
    if (at === -1 || lines[at + 1] !== 'TDD: {TDD}') out.push(`${label}: Code spawn ${i + 1} does not pass TDD: {TDD} on the line after OPERATION`)
  })
  if (!/\*\*Produces:\*\*[^\n]*\bTDD\b/.test(command)) out.push(`${label}: Phase 1 does not list TDD in what it produces`)
  return out
}

/** Named collector: how a compiled Code body falls short of the TDD-off rule. */
export function collectCodeTddDefects(label: string, code: string): string[] {
  const out: string[] = []
  for (const phrase of [
    '`TDD: off`',
    'you may write tests after the code',
    'the RED step does not apply',
    'The test plan and the bug-fix regression test stay',
  ]) {
    if (!code.includes(phrase)) out.push(`${label}: the Code body lacks "${phrase}"`)
  }
  if (!code.includes('Write one failing test first for each acceptance-criterion behaviour')) {
    out.push(`${label}: the default test-first rule is gone`)
  }
  return out
}

describe('/implement passes the TDD value to every Code spawn', () => {
  it.each(IMPLEMENT_BUILDS)('%s: every Code spawn carries TDD: {TDD} after OPERATION', (label, command) => {
    expect(collectTddSpawnDefects(label, command)).toEqual([])
  })

  it('the four builds hold five Code spawns each (single, sequential first and next, two parallel)', () => {
    for (const [label, command] of IMPLEMENT_BUILDS) expect(codeSpawnPrompts(command), label).toHaveLength(5)
  })

  it('known-bad probes: a spawn without the line, a line in the wrong place and a missing Produces entry are reported', () => {
    const [, on] = IMPLEMENT_BUILDS[0]
    expect(collectTddSpawnDefects('x', on.replace('OPERATION: implement\nTDD: {TDD}\nTASK_ID: {task-id}\nTASK_DESCRIPTION: {description}', 'OPERATION: implement\nTASK_ID: {task-id}\nTASK_DESCRIPTION: {description}')))
      .toEqual(['x: Code spawn 1 does not pass TDD: {TDD} on the line after OPERATION'])
    expect(collectTddSpawnDefects('x', on.replaceAll('TDD: {TDD}\n', ''))).toHaveLength(5)
    expect(collectTddSpawnDefects('x', on.replace(/, TDD, GATE_LEVEL/g, ', GATE_LEVEL')))
      .toEqual(['x: Phase 1 does not list TDD in what it produces'])
    expect(collectTddSpawnDefects('x', 'no fences here')).toEqual([
      'x: no Code spawn found, so the check would pass on nothing',
      'x: Phase 1 does not list TDD in what it produces',
    ])
  })
})

describe('the Code body', () => {
  const BODIES: ReadonlyArray<readonly [string, string]> = [
    ['code (curation on)', resolveAgentSource('code').content],
    ['code (curation off)', resolveCurationOffSource('agents', 'code') ?? ''],
  ]

  it.each(BODIES)('%s says what TDD: off allows and what stays', (label, code) => {
    expect(collectCodeTddDefects(label, code)).toEqual([])
  })

  it('known-bad probes: each missing part is reported', () => {
    const [, code] = BODIES[0]
    expect(collectCodeTddDefects('x', code.replace('the RED step does not apply', ''))).toEqual(['x: the Code body lacks "the RED step does not apply"'])
    expect(collectCodeTddDefects('x', code.replace('The test plan and the bug-fix regression test stay', ''))).toHaveLength(1)
    expect(collectCodeTddDefects('x', code.replace('Write one failing test first for each acceptance-criterion behaviour', ''))).toEqual(['x: the default test-first rule is gone'])
  })

  it.each(BODIES)('%s keeps the typing rule', (_label, code) => {
    expect(code).toContain('Type everything.')
  })

  it('the Fix and Refactor bodies carry no TDD rule: only the implement spawn passes the value', () => {
    for (const name of ['fix', 'refactor']) expect(resolveAgentSource(name).content, name).not.toContain('TDD: off')
  })
})

describe('the preloaded TDD skill yields to TDD: off', () => {
  const SKILL = fs.readFileSync(path.join(ROOT, 'src/assets/skills/test-driven-development/SKILL.md'), 'utf8')
  const exceptions = (text: string): string => text.split('## When TDD Does Not Apply')[1]?.split('\n## ')[0] ?? ''

  it('lists `TDD: off` in the spawn as a case where test first does not bind', () => {
    expect(exceptions(SKILL)).toContain('**`TDD: off` in the spawn**: tests may follow the code')
  })

  it('known-bad probe: a skill without the exception is reported', () => {
    expect(exceptions(SKILL.replace('**`TDD: off` in the spawn**', '**other**'))).not.toContain('`TDD: off`')
  })

  it('keeps the Iron Law for the default', () => {
    expect(SKILL).toContain('> **Tests first, always.**')
  })
})

describe('the switch is machine only', () => {
  it('the repository config parser has no tdd switch', () => {
    expect(PROJECT_CONFIG.FEATURE_SWITCHES).toEqual(expect.arrayContaining(['memory', 'curation', 'knowledge']))
    expect(PROJECT_CONFIG.FEATURE_SWITCHES).not.toContain('tdd')
  })

  it('no compiled command or agent reads features.tdd or names a config key for it', () => {
    const texts = [...IMPLEMENT_BUILDS.map(([, text]) => text), resolveAgentSource('code').content]
    for (const text of texts) {
      expect(text).not.toMatch(/features\.tdd|"tdd"\s*:|manifest\.json[^\n]*\btdd\b/)
    }
  })
})

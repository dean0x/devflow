/**
 * D-ARGS-ONCE, on the INSTALLED build: what a user's machine receives binds the
 * command input once, and carries the amended orchestrator charter.
 *
 * tests/guards/arguments-once.test.ts holds `dist/commands`, the compiled source
 * of what is installed. This holds the installed copy itself, because the install
 * is the last step that could change a command's text: a command copied from a
 * stale build, or rewritten on the way, would leave the guard green over a file
 * the user never gets. The install runs ONCE, by the built CLI into the
 * D-SNAPSHOT-SANDBOX home (a temp HOME, never the real one), and is inspected
 * read-only afterwards.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, realpathSync } from 'fs'
import * as os from 'os'
import * as path from 'path'

import { ROOT, requireBuiltCli } from './helpers.js'
import { createSandbox, removeSandbox, runCliOk, type Sandbox } from './install-snapshot-helpers.js'

requireBuiltCli()

/** The most placeholders one installed command may carry: the figure the compiled-command guard holds, applied to the installed copy. */
const MAX_PER_COMMAND = 1
const INSTALL_ARGS = ['init', '--recommended', '--security', 'user'] as const

let sandbox: Sandbox | undefined

beforeAll(() => {
  sandbox = createSandbox()
  runCliOk(sandbox, INSTALL_ARGS)
}, 120_000)

afterAll(() => removeSandbox(sandbox))

function installedCommands(sb: Sandbox): Map<string, string> {
  const dir = path.join(sb.home, '.claude', 'commands', 'devflow')
  const commands = new Map<string, string>()
  for (const file of readdirSync(dir).filter(name => name.endsWith('.md')).sort()) {
    commands.set(file.replace(/\.md$/, ''), readFileSync(path.join(dir, file), 'utf-8'))
  }
  return commands
}

/** Named collector: the installed commands that carry more placeholders than allowed, or a placeholder outside a block. */
export function collectInstalledBindingViolations(commands: ReadonlyMap<string, string>): string[] {
  const violations: string[] = []
  for (const [name, body] of commands) {
    const count = (body.match(/\$ARGUMENTS/g) ?? []).length
    if (count > MAX_PER_COMMAND) violations.push(`${name}.md carries ${count} placeholders`)
    const bound = /<command-input>\n\$ARGUMENTS\n<\/command-input>/.test(body)
    if (count === 1 && !bound) violations.push(`${name}.md binds its placeholder outside a command-input block`)
  }
  return violations
}

describe('the installed build binds the command input once (D-ARGS-ONCE)', () => {
  it('runs in a temp HOME, never the real one', () => {
    const home = realpathSync(sandbox!.home)
    expect(home.startsWith(realpathSync(os.tmpdir()))).toBe(true)
    expect(home).not.toBe(realpathSync(os.homedir()))
  })

  it('every installed command carries at most one placeholder, inside its block', () => {
    const commands = installedCommands(sandbox!)
    // Non-vacuity: the install carried the commands this ticket changed.
    for (const name of ['implement', 'plan', 'debug', 'explore']) {
      expect(commands.has(name), `${name}.md was not installed`).toBe(true)
    }
    const violations = collectInstalledBindingViolations(commands)
    expect(violations, `Installed commands break the bind-once rule:\n  ${violations.join('\n  ')}`).toEqual([])
    expect((commands.get('implement')!.match(/\$ARGUMENTS/g) ?? []).length).toBe(1)
  })

  it('the installed charter is the amended source charter', () => {
    const installed = readFileSync(
      path.join(sandbox!.home, '.devflow', 'scripts', 'hooks', 'assets', 'orchestrator-charter.md'), 'utf-8')
    const source = readFileSync(
      path.join(ROOT, 'src', 'assets', 'scripts', 'hooks', 'assets', 'orchestrator-charter.md'), 'utf-8')
    expect(installed).toBe(source)
    expect(installed).toContain('single git, gh or script command')
    expect(installed).not.toMatch(/full plan/i)
  })

  it('known-bad probe: a second placeholder, and one outside a block, are reported', () => {
    const block = '<command-input>\n$ARGUMENTS\n</command-input>\n'
    expect(collectInstalledBindingViolations(new Map([['ok', block]]))).toEqual([])
    expect(collectInstalledBindingViolations(new Map([['twice', `${block}Again: $ARGUMENTS\n`]]))).toEqual([
      'twice.md carries 2 placeholders',
    ])
    expect(collectInstalledBindingViolations(new Map([['bare', 'The input is `$ARGUMENTS`.\n']]))).toEqual([
      'bare.md binds its placeholder outside a command-input block',
    ])
  })
})

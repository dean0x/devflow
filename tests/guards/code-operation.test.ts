/**
 * D-CODE-OPERATION-MODES — every Code spawn names its operating mode on its first prompt line.
 *
 * The Code agent works in one of eight modes, and its Step 0 table loads skills by mode. A spawn
 * that leaves the mode out falls back to `implement`, the loosest protocol, with no regression-test
 * rule and every mode skill judged against a plan that is not there. So the mode is not optional in
 * practice: each Code spawn in the compiled commands opens its prompt with `OPERATION: <mode>`, the
 * orchestrator charter's direct Code delegation does the same (tests/agent-name-guards.test.ts), and
 * this guard fails any compiled spawn that does not.
 *
 * The guard reads `dist/commands`, the text the Code agent actually receives, through the shared
 * collector in tests/helpers.ts that the compliance-lens test also uses. It fails loudly when dist is
 * absent. Per shape:
 *   - a fenced payload or a workflow template literal: the first non-empty prompt line is
 *     `OPERATION: <one of the eight>`;
 *   - a prose spawn sentence: the sentence contains `OPERATION: <one of the eight>`.
 * A mode on a later line does not count, because a reader skimming the first line must see it. Per-host
 * counts meet the floors below, which are test-local constants and not manifest rows: a floor on a
 * spawn count that later work legitimately lowers would block that work, because manifest floors never
 * fall.
 *
 * The `_preamble.mds` usage example (`agent("your prompt here", { agentType: "Code" })`) documents the
 * call and is not a spawn; it is not a template literal, so the collector does not count it.
 *
 * D-CODE-OPERATION-PINS: the mode each spawn names must fit what the spawn does. A review-finding fix is
 * `issue-fix`, so the regression-test rule applies to it, and the merge-conflict resolver is `implement`.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { CODE_OPERATIONS, collectCodeSpawnSites, requireDistFile, requireDistFiles, resolveAgentSource } from '../helpers.js'
import type { CodeSpawnSite } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const PREAMBLE_PATH = path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_preamble.mds')

/** Compiled commands that spawn Code, and the spawn sites each carries today. Floors: may only rise. */
const OPERATION_FLOORS: Readonly<Record<string, number>> = {
  'implement.md': 10,
  'resolve.md': 3,
  'dynamic-build.md': 8,
}

/** Named collector: the mode a spawn site names where its prompt opens, or why it names none. */
export function collectOperationDefect(site: CodeSpawnSite): string | null {
  const where = `${site.file}:${site.line}`
  let mode: string | undefined
  if (site.payload.startsWith('Agent(subagent_type="Code"):')) {
    // A fenced payload: the first non-empty line after the header, inside its opening quote.
    const first = (site.payload.split('\n').slice(1).map(l => l.trim()).find(l => l !== '') ?? '').replace(/^"/, '')
    mode = /^OPERATION: (\S+)$/.exec(first)?.[1]
    if (mode === undefined) return `${where}: the first prompt line is "${first.slice(0, 60)}", not OPERATION: <mode>`
  } else if (site.payload.startsWith('agent(`')) {
    // A template literal: the first non-empty line of the template.
    const first = site.payload.slice('agent(`'.length).split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
    mode = /^OPERATION: (\S+)$/.exec(first)?.[1]
    if (mode === undefined) return `${where}: the first prompt line is "${first.slice(0, 60)}", not OPERATION: <mode>`
  } else {
    // A prose spawn sentence.
    mode = /OPERATION: (\S+)/.exec(site.payload)?.[1]?.replace(/[`",.:;]+$/, '')
    if (mode === undefined) return `${where}: the spawn sentence names no OPERATION: <mode>`
  }
  if (!CODE_OPERATIONS.includes(mode)) return `${where}: OPERATION: ${mode} is not one of ${CODE_OPERATIONS.join(', ')}`
  return null
}

/** The mode a site names, or undefined when it names none (read after the defect check has passed). */
function modeOf(site: CodeSpawnSite): string | undefined {
  return /OPERATION: ([a-z-]+)/.exec(site.payload)?.[1]
}

/** Named collector: every site in a compiled-command set that names no valid mode on its first prompt line. */
export function collectOperationDefects(commands: ReadonlyArray<readonly [string, string]>): string[] {
  return commands.flatMap(([file, text]) => collectCodeSpawnSites(file, text).map(collectOperationDefect).filter((d): d is string => d !== null))
}

/**
 * D-CODE-OPERATION-PINS: a phrase from a spawn's prompt, the host it sits in, and the mode it must name.
 * Each anchor matches exactly one site; a miss or a double match fails.
 */
const MODE_PINS: ReadonlyArray<readonly [string, string, string]> = [
  ['implement.md', 'TASK_DESCRIPTION: {description}', 'implement'],
  ['implement.md', 'Fix alignment issues', 'alignment-fix'],
  ['implement.md', 'Fix validation failures', 'validation-fix'],
  ['implement.md', 'Fix QA test failures', 'qa-fix'],
  ['implement.md', 'Create the unified PR for the parallel implementation', 'pr-create'],
  ['implement.md', '`CI_FAILURES`', 'ci-fix'],
  ['resolve.md', 'ISSUES: {fix_now_issues_in_batch}', 'issue-fix'],
  ['resolve.md', 'VALIDATION_FAILURES: {parsed failures from Validate agent}', 'validation-fix'],
  ['resolve.md', '`CI_FAILURES`', 'ci-fix'],
  ['dynamic-build.md', 'Implement the following ticket on branch', 'implement'],
  ['dynamic-build.md', 'Fix the validation failures on branch', 'validation-fix'],
  ['dynamic-build.md', 'Fix the alignment issues identified by the Evaluate agent', 'alignment-fix'],
  ['dynamic-build.md', 'Fix the failing acceptance test scenarios', 'qa-fix'],
  ['dynamic-build.md', 'Fix the following confirmed review findings', 'issue-fix'],
  ['dynamic-build.md', 'Fix the final validation failures on branch', 'validation-fix'],
  ['dynamic-build.md', 'Spawn a Code agent', 'implement'],
]

/** Named collector: pins that match no site, more than one site, or a site naming another mode. */
export function collectPinDefects(commands: ReadonlyArray<readonly [string, string]>): string[] {
  const out: string[] = []
  for (const [host, anchor, mode] of MODE_PINS) {
    const text = commands.find(([file]) => file === host)?.[1]
    const sites = text === undefined ? [] : collectCodeSpawnSites(host, text).filter(s => s.payload.includes(anchor))
    if (sites.length !== 1) { out.push(`${host}: ${sites.length} sites match "${anchor}", expected one`); continue }
    if (modeOf(sites[0]) !== mode) out.push(`${host}:${sites[0].line}: "${anchor}" names ${modeOf(sites[0]) ?? 'no mode'}, expected ${mode}`)
  }
  return out
}

/** Named collector: how code.md's mode contract falls short of the eight. */
export function collectModeContractDefects(codeText: string): string[] {
  const out: string[] = []
  const line = codeText.split('\n').find(l => l.startsWith('- **OPERATION**')) ?? ''
  const listed = [...line.matchAll(/`([a-z-]+)`/g)].map(m => m[1])
  if (listed.join(',') !== CODE_OPERATIONS.join(',')) out.push(`the OPERATION line lists ${listed.join(', ')}, expected ${CODE_OPERATIONS.join(', ')}`)
  if (!/`implement` \(default when absent\)/.test(line)) out.push('the OPERATION line does not make `implement` the default when absent')
  if (!/every spawn passes it as the first prompt line/.test(line)) out.push('the OPERATION line does not say every spawn passes it as the first prompt line')
  for (const mode of CODE_OPERATIONS.filter(m => m !== 'implement')) {
    const start = codeText.indexOf(`## Mode: ${mode}\n`)
    if (start === -1) { out.push(`no "## Mode: ${mode}" section`); continue }
    const next = codeText.indexOf('\n## ', start + 1)
    const section = codeText.slice(start, next === -1 ? undefined : next)
    // The two modes this contract added each state what they return; the older five state inputs and protocol.
    const parts = mode === 'ci-fix' || mode === 'edit' ? ['**Inputs:**', '**Protocol:**', '**Return:**'] : ['**Inputs:**', '**Protocol:**']
    for (const part of parts) {
      if (!section.includes(part)) out.push(`## Mode: ${mode} has no ${part}`)
    }
  }
  return out
}

const compiled = (): Array<readonly [string, string]> => requireDistFiles().map(f => [f, requireDistFile(f)] as const)

describe('every compiled Code spawn opens with its OPERATION (D-CODE-OPERATION-MODES)', () => {
  it('finds every spawn the floors name, in the three hosts and no other', () => {
    const sites = compiled().flatMap(([file, text]) => collectCodeSpawnSites(file, text))
    for (const [host, floor] of Object.entries(OPERATION_FLOORS)) {
      const n = sites.filter(s => s.file === host).length
      expect(n, `${host}: ${n} Code spawn site(s), floor ${floor} — the collector stopped reading them`).toBeGreaterThanOrEqual(floor)
    }
    expect([...new Set(sites.map(s => s.file))].sort(), 'a command outside the named set spawns Code — name it in OPERATION_FLOORS')
      .toEqual(Object.keys(OPERATION_FLOORS).sort())
  })

  it('each spawn names one of the eight modes on its first prompt line (or in its sentence)', () => {
    expect(collectOperationDefects(compiled())).toEqual([])
  })

  it('each spawn names the mode that fits what it does (D-CODE-OPERATION-PINS)', () => {
    expect(collectPinDefects(compiled())).toEqual([])
  })

  it('the _preamble.mds usage example is unchanged and is not counted as a site', () => {
    expect(readFileSync(PREAMBLE_PATH, 'utf-8')).toContain('agent("your prompt here", { agentType: "Code" })')
    for (const host of ['dynamic-plan.md', 'dynamic-profile.md', 'dynamic-tickets.md']) {
      const text = requireDistFile(host)
      expect(text, `${host} carries the example`).toContain('agent("your prompt here", { agentType: "Code" })')
      expect(collectCodeSpawnSites(host, text), `${host}: the example is not a spawn`).toEqual([])
    }
  })
})

describe('known-bad probes: each shape of untagged spawn is reported (D-CODE-OPERATION-MODES)', () => {
  /** Replace `from` with `to` in a host's real compiled text, proving the seed lands. */
  function seeded(host: string, from: string, to: string): Array<readonly [string, string]> {
    const real = requireDistFile(host)
    expect(real, `the seed anchor must exist in ${host}`).toContain(from)
    const out = real.replace(from, to)
    expect(out, 'the seed must change the text').not.toBe(real)
    return [[host, out]]
  }

  it('the real text is clean, so each seed below fails for its own reason', () => {
    expect(collectOperationDefects(compiled())).toEqual([])
  })

  it('(a) a fenced payload whose first line is TASK_ID, with OPERATION on a later line', () => {
    const defects = collectOperationDefects(seeded(
      'implement.md',
      '"OPERATION: alignment-fix\n   TASK_ID: {task-id}\n   TASK_DESCRIPTION: Fix alignment issues\n',
      '"TASK_ID: {task-id}\n   TASK_DESCRIPTION: Fix alignment issues\n   OPERATION: alignment-fix\n',
    ))
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatch(/^implement\.md:\d+: the first prompt line is "TASK_ID: \{task-id\}", not OPERATION: <mode>$/)
  })

  it('(b) a template literal with OPERATION on its second line', () => {
    const defects = collectOperationDefects(seeded(
      'dynamic-build.md',
      'agent(`OPERATION: implement\nImplement the following ticket on branch ${BRANCH}:',
      'agent(`Implement the following ticket on branch ${BRANCH}:\nOPERATION: implement',
    ))
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatch(/^dynamic-build\.md:\d+: the first prompt line is "Implement the following ticket on branch/)
  })

  it('(c) a prose spawn sentence with no OPERATION', () => {
    const defects = collectOperationDefects(seeded(
      'dynamic-build.md',
      ' whose prompt opens with `OPERATION: implement` and carries `COMPLIANCE_FRAMEWORKS` and `DECISIONS_CONTEXT`, with FULL intent context:',
      ' with FULL intent context:',
    ))
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatch(/^dynamic-build\.md:\d+: the spawn sentence names no OPERATION: <mode>$/)
  })

  it('(c) the CI-fix prose spawn without its mode', () => {
    const defects = collectOperationDefects(seeded(
      'resolve.md',
      ' whose prompt opens with `OPERATION: ci-fix`, with `COMPLIANCE_FRAMEWORKS`',
      ' with `COMPLIANCE_FRAMEWORKS`',
    ))
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatch(/^resolve\.md:\d+: the spawn sentence names no OPERATION: <mode>$/)
  })

  it('(d) an OPERATION value outside the eight', () => {
    const defects = collectOperationDefects(seeded('implement.md', '"OPERATION: qa-fix\n', '"OPERATION: qa-patch\n'))
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatch(/^implement\.md:\d+: OPERATION: qa-patch is not one of implement, issue-fix,/)
  })

  it('a pinned spawn naming another mode, and a pin whose anchor vanished, are each reported', () => {
    const wrong = collectPinDefects(seeded('dynamic-build.md', '`OPERATION: issue-fix\nFix the following confirmed review findings', '`OPERATION: implement\nFix the following confirmed review findings'))
    expect(wrong.some(d => d.includes('"Fix the following confirmed review findings" names implement, expected issue-fix'))).toBe(true)
    const gone = collectPinDefects(seeded('resolve.md', 'ISSUES: {fix_now_issues_in_batch}', 'ISSUE_LIST: {fix_now_issues_in_batch}'))
    expect(gone).toContain('resolve.md: 0 sites match "ISSUES: {fix_now_issues_in_batch}", expected one')
  })
})

describe('code.md states the eight-mode contract (D-CODE-OPERATION-MODES)', () => {
  it('the OPERATION line lists exactly the eight values, and ci-fix and edit have Inputs, Protocol and Return', () => {
    expect(collectModeContractDefects(resolveAgentSource('code').content)).toEqual([])
  })

  it('known-bad probe: a lost mode, a lost default and a lost Protocol are each reported', () => {
    const real = resolveAgentSource('code').content
    expect(collectModeContractDefects(real), 'the real contract is clean, so each seed fails for its own reason').toEqual([])
    const lostMode = real.replace(' | `ci-fix` | `edit` —', ' | `ci-fix` —')
    expect(lostMode, 'the seed must land').not.toBe(real)
    expect(collectModeContractDefects(lostMode).some(d => d.startsWith('the OPERATION line lists'))).toBe(true)
    const lostDefault = real.replace('`implement` (default when absent)', '`implement`')
    expect(collectModeContractDefects(lostDefault)).toContain('the OPERATION line does not make `implement` the default when absent')
    const lostProtocol = real.replace(/(## Mode: edit[\s\S]*?)\*\*Protocol:\*\*/, '$1**Steps:**')
    expect(lostProtocol, 'the seed must land').not.toBe(real)
    expect(collectModeContractDefects(lostProtocol)).toEqual(['## Mode: edit has no **Protocol:**'])
  })
})

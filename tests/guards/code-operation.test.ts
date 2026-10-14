/**
 * D-CODE-OPERATION-MODES — every Code-family spawn names its operating mode on its first prompt line, and
 * D-CODE-VARIANTS — it names that mode on the variant that runs it.
 *
 * The Code family works in seven modes across three agents: Code (implement, issue-fix), Fix
 * (validation-fix, alignment-fix, qa-fix, ci-fix) and Refactor (edit). A spawn that leaves the mode out
 * falls back to the loosest protocol its agent has, with no regression-test rule and every mode skill judged
 * against a plan that is not there; a spawn that names a mode on the wrong variant reaches an agent that
 * carries neither the mode's section nor its skills. So the mode is not optional in practice: each spawn in
 * the compiled commands opens its prompt with `OPERATION: <mode>`, the mode belongs to the variant the spawn
 * names (AC-303), the orchestrator charter's direct delegation does the same (tests/agent-name-guards.test.ts),
 * and this guard fails any compiled spawn that does not.
 *
 * The guard reads `dist/commands`, the text the Code agents actually receive, through the shared collector in
 * tests/helpers.ts that the compliance-lens test also uses. It fails loudly when dist is absent. Per shape:
 *   - a fenced payload or a workflow template literal: the first non-empty prompt line is
 *     `OPERATION: <one of the seven>`;
 *   - a prose spawn sentence: the sentence contains `OPERATION: <one of the seven>`.
 * A mode on a later line does not count, because a reader skimming the first line must see it. Per-host,
 * per-variant counts meet the floors below, which are test-local constants and not manifest rows: a floor on
 * a spawn count that later work legitimately lowers would block that work, because manifest floors never fall.
 *
 * The `_preamble.mds` usage example (`agent("your prompt here", { agentType: "Code" })`) documents the
 * call and is not a spawn; it is not a template literal, so the collector does not count it.
 *
 * D-CODE-OPERATION-PINS: the mode each spawn names must fit what the spawn does, and the variant it names must
 * own that mode. A review-finding fix is `issue-fix` on Code, so the regression-test rule applies to it; a gate
 * failure fix is a Fix mode; the merge-conflict resolver is `implement` on Code.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import {
  CODE_AGENT_TYPES, CODE_MODES, CODE_OPERATIONS, codeSlugOf, collectCodeSpawnSites,
  requireDistFile, requireDistFiles, resolveAgentSource,
} from '../helpers.js'
import type { CodeSpawnSite } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const PREAMBLE_PATH = path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_preamble.mds')

/**
 * Compiled commands that spawn each variant, and the spawn sites each carries today. Floors: may only rise.
 * Refactor is spawned by the orchestrator charter alone, so no compiled command carries a site for it.
 */
const OPERATION_FLOORS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'Code': { 'implement.md': 5, 'resolve.md': 1, 'debug.md': 1, 'dynamic-build.md': 4 },
  'Fix': { 'implement.md': 4, 'resolve.md': 2, 'dynamic-build.md': 4 },
  'Refactor': {},
}

/** The variant that owns a mode. */
function ownerOf(mode: string): string | undefined {
  return CODE_AGENT_TYPES.find(type => CODE_OPERATIONS[type].includes(mode))
}

/** Named collector: the mode a spawn site names where its prompt opens, or why it names none or names it on the wrong variant. */
export function collectOperationDefect(site: CodeSpawnSite): string | null {
  const where = `${site.file}:${site.line}`
  let mode: string | undefined
  if (site.payload.startsWith(`Agent(subagent_type="${site.agentType}"):`)) {
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
  if (!CODE_MODES.includes(mode)) return `${where}: OPERATION: ${mode} is not one of ${CODE_MODES.join(', ')}`
  const owner = ownerOf(mode)
  if (owner !== site.agentType) return `${where}: OPERATION: ${mode} runs on ${owner}, but the spawn names ${site.agentType}`
  return null
}

/** The mode a site names, or undefined when it names none (read after the defect check has passed). */
function modeOf(site: CodeSpawnSite): string | undefined {
  return /OPERATION: ([a-z-]+)/.exec(site.payload)?.[1]
}

/** Named collector: every site in a compiled-command set that names no valid mode on its first prompt line, or names it on the wrong variant. */
export function collectOperationDefects(commands: ReadonlyArray<readonly [string, string]>): string[] {
  return commands.flatMap(([file, text]) => collectCodeSpawnSites(file, text).map(collectOperationDefect).filter((d): d is string => d !== null))
}

/**
 * Named collector (AC-303): agent types that look like a Code variant and are not one. A spawn that names
 * `Code-patch` resolves to no agent source, so it would fail at run time and no other guard would see it.
 */
export function collectUnknownCodeTypes(commands: ReadonlyArray<readonly [string, string]>): string[] {
  return commands.flatMap(([file, text]) =>
    [...text.matchAll(/(?:subagent_type="|agentType: ?")(Code[A-Za-z-]*)"/g)]
      .filter(m => !CODE_AGENT_TYPES.includes(m[1]))
      .map(m => `${file}: spawns ${m[1]}, which is not one of ${CODE_AGENT_TYPES.join(', ')}`),
  )
}

/**
 * D-CODE-OPERATION-PINS: a phrase from a spawn's prompt, the host it sits in, the mode it must name and the
 * variant it must name. Each anchor matches exactly one site of that variant; a miss or a double match fails.
 */
const MODE_PINS: ReadonlyArray<readonly [host: string, anchor: string, mode: string, agentType: string]> = [
  ['implement.md', 'TASK_DESCRIPTION: {description}', 'implement', 'Code'],
  ['implement.md', 'Fix alignment issues', 'alignment-fix', 'Fix'],
  ['implement.md', 'Fix validation failures', 'validation-fix', 'Fix'],
  ['implement.md', 'Fix QA test failures', 'qa-fix', 'Fix'],
  ['implement.md', '`CI_FAILURES`', 'ci-fix', 'Fix'],
  ['resolve.md', 'ISSUES: {fix_now_issues_in_batch}', 'issue-fix', 'Code'],
  ['resolve.md', 'VALIDATION_FAILURES: {parsed failures from Validate agent}', 'validation-fix', 'Fix'],
  ['resolve.md', '`CI_FAILURES`', 'ci-fix', 'Fix'],
  ['debug.md', 'TASK_DESCRIPTION: Implement the fix for this root cause', 'implement', 'Code'],
  ['dynamic-build.md', 'Implement the following ticket on branch', 'implement', 'Code'],
  ['dynamic-build.md', 'Fix the validation failures on branch', 'validation-fix', 'Fix'],
  ['dynamic-build.md', 'Fix the alignment issues identified by the Evaluate agent', 'alignment-fix', 'Fix'],
  ['dynamic-build.md', 'Fix the failing acceptance test scenarios', 'qa-fix', 'Fix'],
  ['dynamic-build.md', 'Fix the following confirmed review findings', 'issue-fix', 'Code'],
  ['dynamic-build.md', 'Fix the final validation failures on branch', 'validation-fix', 'Fix'],
  ['dynamic-build.md', 'Spawn a Code agent', 'implement', 'Code'],
]

/** Named collector: pins that match no site, more than one site, or a site naming another mode. */
export function collectPinDefects(commands: ReadonlyArray<readonly [string, string]>): string[] {
  const out: string[] = []
  for (const [host, anchor, mode, agentType] of MODE_PINS) {
    const text = commands.find(([file]) => file === host)?.[1]
    const sites = text === undefined ? [] : collectCodeSpawnSites(host, text, agentType).filter(s => s.payload.includes(anchor))
    if (sites.length !== 1) { out.push(`${host}: ${sites.length} ${agentType} sites match "${anchor}", expected one`); continue }
    if (modeOf(sites[0]) !== mode) out.push(`${host}:${sites[0].line}: "${anchor}" names ${modeOf(sites[0]) ?? 'no mode'}, expected ${mode}`)
  }
  return out
}

/** The mode a variant runs when OPERATION is absent. Fix has none: a missing OPERATION returns BLOCKED. */
const DEFAULT_MODE: Readonly<Record<string, string | null>> = { 'Code': 'implement', 'Fix': null, 'Refactor': 'edit' }

/** Named collector: how a variant's mode contract falls short of the modes it owns. */
export function collectModeContractDefects(agentType: string, text: string): string[] {
  const modes = CODE_OPERATIONS[agentType]
  const out: string[] = []
  const line = text.split('\n').find(l => l.startsWith('- **OPERATION**')) ?? ''
  const listed = [...line.matchAll(/`([a-z-]+)`/g)].map(m => m[1])
  if (listed.join(',') !== modes.join(',')) out.push(`the OPERATION line lists ${listed.join(', ')}, expected ${modes.join(', ')}`)
  const fallback = DEFAULT_MODE[agentType]
  if (fallback !== null) {
    if (!line.includes(`\`${fallback}\` (default when absent)`)) out.push(`the OPERATION line does not make \`${fallback}\` the default when absent`)
  } else {
    if (line.includes('(default when absent)')) out.push('the OPERATION line names a default, but the variant has none')
    if (!line.includes('there is no default')) out.push('the OPERATION line does not say there is no default')
  }
  if (!/returns BLOCKED/.test(line)) out.push('the OPERATION line does not say a missing or other value returns BLOCKED')
  if (!/every spawn passes it as the first prompt line/.test(line)) out.push('the OPERATION line does not say every spawn passes it as the first prompt line')
  for (const mode of modes.filter(m => m !== 'implement')) {
    const start = text.indexOf(`## Mode: ${mode}\n`)
    if (start === -1) { out.push(`no "## Mode: ${mode}" section`); continue }
    const next = text.indexOf('\n## ', start + 1)
    const section = text.slice(start, next === -1 ? undefined : next)
    // The two modes this contract added each state what they return; the older ones state inputs and protocol.
    const parts = mode === 'ci-fix' || mode === 'edit' ? ['**Inputs:**', '**Protocol:**', '**Return:**'] : ['**Inputs:**', '**Protocol:**']
    for (const part of parts) {
      if (!section.includes(part)) out.push(`## Mode: ${mode} has no ${part}`)
    }
  }
  for (const mode of CODE_MODES.filter(m => !modes.includes(m))) {
    if (text.includes(`## Mode: ${mode}\n`)) out.push(`carries "## Mode: ${mode}", a ${ownerOf(mode)} mode`)
  }
  return out
}

const compiled = (): Array<readonly [string, string]> => requireDistFiles().map(f => [f, requireDistFile(f)] as const)

describe('every compiled Code-family spawn opens with its OPERATION (D-CODE-OPERATION-MODES)', () => {
  it('finds every spawn the floors name, per variant, in the named hosts and no other', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      const sites = compiled().flatMap(([file, text]) => collectCodeSpawnSites(file, text, agentType))
      const floors = OPERATION_FLOORS[agentType]
      for (const [host, floor] of Object.entries(floors)) {
        const n = sites.filter(s => s.file === host).length
        expect(n, `${host}: ${n} ${agentType} spawn site(s), floor ${floor} — the collector stopped reading them`).toBeGreaterThanOrEqual(floor)
      }
      expect([...new Set(sites.map(s => s.file))].sort(), `a command outside the named set spawns ${agentType} — name it in OPERATION_FLOORS`)
        .toEqual(Object.keys(floors).sort())
    }
  })

  it('each spawn names one of the seven modes on its first prompt line (or in its sentence), on the variant that owns it', () => {
    expect(collectOperationDefects(compiled())).toEqual([])
  })

  it('each spawn names the mode that fits what it does (D-CODE-OPERATION-PINS)', () => {
    expect(collectPinDefects(compiled())).toEqual([])
  })

  it('every spawn site resolves to an existing variant, whose source is named for it (AC-303)', () => {
    expect(collectUnknownCodeTypes(compiled())).toEqual([])
    const sites = compiled().flatMap(([file, text]) => collectCodeSpawnSites(file, text))
    expect(sites.length, 'no Code-family spawn was read').toBeGreaterThan(15)
    for (const agentType of new Set(sites.map(s => s.agentType))) {
      expect(/^name: (\S+)$/m.exec(resolveAgentSource(codeSlugOf(agentType)).content)?.[1], `${agentType}: the agent source is named for the type`).toBe(agentType)
    }
    for (const agentType of CODE_AGENT_TYPES) {
      expect(/^name: (\S+)$/m.exec(resolveAgentSource(codeSlugOf(agentType)).content)?.[1], `${agentType}: the agent source`).toBe(agentType)
    }
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

describe('known-bad probes: each shape of untagged or misrouted spawn is reported (D-CODE-OPERATION-MODES)', () => {
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
    expect(collectUnknownCodeTypes(compiled())).toEqual([])
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
      ' whose prompt opens with `OPERATION: implement` and carries `COMPLIANCE_DIRECTIVE` (when it is not empty) and `DECISIONS_CONTEXT`, with FULL intent context:',
      ' with FULL intent context:',
    ))
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatch(/^dynamic-build\.md:\d+: the spawn sentence names no OPERATION: <mode>$/)
  })

  it('(c) the CI-fix prose spawn without its mode', () => {
    const defects = collectOperationDefects(seeded(
      'resolve.md',
      ' whose prompt opens with `OPERATION: ci-fix`, with `COMPLIANCE_DIRECTIVE`',
      ' with `COMPLIANCE_DIRECTIVE`',
    ))
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatch(/^resolve\.md:\d+: the spawn sentence names no OPERATION: <mode>$/)
  })

  it('(d) an OPERATION value outside the seven', () => {
    const defects = collectOperationDefects(seeded('implement.md', '"OPERATION: qa-fix\n', '"OPERATION: qa-patch\n'))
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatch(/^implement\.md:\d+: OPERATION: qa-patch is not one of implement, issue-fix,/)
  })

  it('(e) the PR-opening mode is not a Code mode: a Code-family spawn naming it is reported (D-PR-BY-GIT)', () => {
    const defects = collectOperationDefects(seeded('implement.md', '"OPERATION: qa-fix\n', '"OPERATION: pr-create\n'))
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatch(/^implement\.md:\d+: OPERATION: pr-create is not one of implement, issue-fix,/)
  })

  it('(f) a gate-failure fix spawned on Code, and a review-finding fix spawned on Fix, are each reported (AC-303)', () => {
    const fixOnCode = collectOperationDefects(seeded('implement.md', 'Agent(subagent_type="Fix"):\n   "OPERATION: qa-fix\n', 'Agent(subagent_type="Code"):\n   "OPERATION: qa-fix\n'))
    expect(fixOnCode).toHaveLength(1)
    expect(fixOnCode[0]).toMatch(/^implement\.md:\d+: OPERATION: qa-fix runs on Fix, but the spawn names Code$/)
    const templateOnCode = collectOperationDefects(seeded(
      'dynamic-build.md',
      'Commit fixes with conventional-commit message.`, { agentType: "Fix" });',
      'Commit fixes with conventional-commit message.`, { agentType: "Code" });',
    ))
    expect(templateOnCode).toHaveLength(1)
    expect(templateOnCode[0]).toMatch(/^dynamic-build\.md:\d+: OPERATION: validation-fix runs on Fix, but the spawn names Code$/)
    const issueFixOnFix = collectOperationDefects(seeded(
      'dynamic-build.md',
      'unresolved": ["<description of any finding that could not be fixed>"]}`, { agentType: "Code" });',
      'unresolved": ["<description of any finding that could not be fixed>"]}`, { agentType: "Fix" });',
    ))
    expect(issueFixOnFix).toHaveLength(1)
    expect(issueFixOnFix[0]).toMatch(/^dynamic-build\.md:\d+: OPERATION: issue-fix runs on Code, but the spawn names Fix$/)
  })

  it('(g) a spawn naming a Code variant that does not exist is reported (AC-303)', () => {
    const defects = collectUnknownCodeTypes(seeded('implement.md', 'Agent(subagent_type="Fix"):\n   "OPERATION: qa-fix\n', 'Agent(subagent_type="Code-patch"):\n   "OPERATION: qa-fix\n'))
    expect(defects).toEqual([`implement.md: spawns Code-patch, which is not one of ${CODE_AGENT_TYPES.join(', ')}`])
  })

  it('a pinned spawn naming another mode, and a pin whose anchor vanished, are each reported', () => {
    const wrong = collectPinDefects(seeded('dynamic-build.md', '`OPERATION: issue-fix\nFix the following confirmed review findings', '`OPERATION: implement\nFix the following confirmed review findings'))
    expect(wrong.some(d => d.includes('"Fix the following confirmed review findings" names implement, expected issue-fix'))).toBe(true)
    const gone = collectPinDefects(seeded('resolve.md', 'ISSUES: {fix_now_issues_in_batch}', 'ISSUE_LIST: {fix_now_issues_in_batch}'))
    expect(gone).toContain('resolve.md: 0 Code sites match "ISSUES: {fix_now_issues_in_batch}", expected one')
  })
})

describe('each variant states the mode contract it owns (D-CODE-OPERATION-MODES, D-CODE-VARIANTS)', () => {
  const source = (agentType: string): string => resolveAgentSource(codeSlugOf(agentType)).content

  it('the OPERATION line lists exactly the variant\'s modes, its default or its absence, and the BLOCKED rule', () => {
    expect(CODE_AGENT_TYPES.flatMap(agentType => collectModeContractDefects(agentType, source(agentType)).map(d => `${agentType}: ${d}`))).toEqual([])
    // Every one of the seven modes has exactly one owner.
    expect(CODE_MODES.length).toBe(7)
    expect(new Set(CODE_MODES).size).toBe(7)
  })

  it('known-bad probe: a lost mode, a lost default, a foreign section, a lost BLOCKED rule and a lost Protocol are each reported', () => {
    const code = source('Code')
    const fix = source('Fix')
    const edit = source('Refactor')
    for (const agentType of CODE_AGENT_TYPES) {
      expect(collectModeContractDefects(agentType, source(agentType)), `${agentType}: the real contract is clean, so each seed fails for its own reason`).toEqual([])
    }
    const lostMode = fix.replace(' | `ci-fix` —', ' —')
    expect(lostMode, 'the seed must land').not.toBe(fix)
    expect(collectModeContractDefects('Fix', lostMode).some(d => d.startsWith('the OPERATION line lists'))).toBe(true)
    const lostDefault = code.replace('`implement` (default when absent)', '`implement`')
    expect(lostDefault, 'the seed must land').not.toBe(code)
    expect(collectModeContractDefects('Code', lostDefault)).toContain('the OPERATION line does not make `implement` the default when absent')
    const gainedDefault = fix.replace('`validation-fix` | `alignment-fix`', '`validation-fix` (default when absent) | `alignment-fix`')
    expect(gainedDefault, 'the seed must land').not.toBe(fix)
    expect(collectModeContractDefects('Fix', gainedDefault)).toContain('the OPERATION line names a default, but the variant has none')
    const foreign = `${edit}\n## Mode: qa-fix\n\n**Inputs:** x\n`
    expect(collectModeContractDefects('Refactor', foreign)).toEqual(['carries "## Mode: qa-fix", a Fix mode'])
    const lostBlocked = code.replace('returns BLOCKED', 'returns an error')
    expect(lostBlocked, 'the seed must land').not.toBe(code)
    expect(collectModeContractDefects('Code', lostBlocked)).toContain('the OPERATION line does not say a missing or other value returns BLOCKED')
    const lostProtocol = edit.replace(/(## Mode: edit[\s\S]*?)\*\*Protocol:\*\*/, '$1**Steps:**')
    expect(lostProtocol, 'the seed must land').not.toBe(edit)
    expect(collectModeContractDefects('Refactor', lostProtocol)).toEqual(['## Mode: edit has no **Protocol:**'])
  })
})

// ── The Code family opens no PR (D-PR-BY-GIT, AC-203) and each variant stays under its body ceiling ────────
//
// The Git agent's ensure-pr-ready opens the PR under every strategy, so no Code body carries PR text:
// no input, no paste gate, no D11 PR-body paragraph, no mode. What each keeps is the commit and push of its
// commit step and the security-scan block (D-SCAN-IN-CODE). The compiled body of each variant is held under
// its ceiling, registered in tests/fixtures/numeric-floors.json as `code-body-max`, `fix-body-max` and
// `refactor-body-max`: lowered by a pass that cut the artifact, never raised to fit one that grew.

/** The compiled Code agent body, in bytes. Registered as `code-body-max`; lowered, never raised. */
const CODE_BODY_MAX_BYTES = 11_155

/** The compiled Fix agent body, in bytes. Registered as `fix-body-max`; lowered, never raised. */
const FIX_BODY_MAX_BYTES = 8_634

/** The compiled Refactor agent body, in bytes. Registered as `refactor-body-max`; lowered, never raised. */
const REFACTOR_BODY_MAX_BYTES = 6_550

const BODY_CEILINGS: Readonly<Record<string, number>> = {
  'Code': CODE_BODY_MAX_BYTES,
  'Fix': FIX_BODY_MAX_BYTES,
  'Refactor': REFACTOR_BODY_MAX_BYTES,
}

/** Phrases that belong to opening a PR, none of which a Code body may carry. */
const PR_ONLY_PHRASES: readonly string[] = [
  'CREATE_PR', 'pr-create', 'ISSUE_PR_LINK', 'ISSUE_NUMBER', 'PR_EXCEPTIONS', 'PR_TEST_PLAN_BLOCK',
  'PR_DESCRIPTION_GUIDANCE', '## Related Issues', 'D11 scrub', 'gh pr create', 'Create PR', 'PR (if created)',
]

/** Named collector: how a Code body falls short of "opens no PR, and stays under its size ceiling". */
export function collectCodeBodyDefects(body: string, ceiling: number): string[] {
  const out: string[] = []
  for (const phrase of PR_ONLY_PHRASES) if (body.includes(phrase)) out.push(`the Code body names "${phrase}"`)
  const bytes = Buffer.byteLength(body)
  if (bytes > ceiling) out.push(`the Code body is ${bytes} bytes, ceiling ${ceiling}`)
  for (const kept of ['**Commit and push**', '**Security scan (conditional):**']) {
    if (!body.includes(kept)) out.push(`the Code body lost "${kept}"`)
  }
  return out
}

describe('no Code variant opens a PR and each body stays under its ceiling (D-PR-BY-GIT, D-CODE-VARIANTS)', () => {
  const body = (agentType: string): string => resolveAgentSource(codeSlugOf(agentType)).content

  it('each compiled body names no PR-opening text, keeps commit-and-push and the scan, and fits its ceiling', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      expect(Buffer.byteLength(body(agentType)), `${agentType}: the body is empty — the guard would pass vacuously`).toBeGreaterThan(4_000)
      expect(collectCodeBodyDefects(body(agentType), BODY_CEILINGS[agentType]), agentType).toEqual([])
    }
  })

  it('the variants are ordered by what their modes need: Refactor < Fix < Code', () => {
    const size = (agentType: string): number => Buffer.byteLength(body(agentType))
    expect(size('Refactor')).toBeLessThan(size('Fix'))
    expect(size('Fix')).toBeLessThan(size('Code'))
  })

  it('known-bad probe: a PR phrase, a lost commit rule and an oversize body are each reported', () => {
    const real = body('Fix')
    expect(collectCodeBodyDefects(real, BODY_CEILINGS['Fix']), 'the real body is clean, so each seed fails for its own reason').toEqual([])
    // The ceiling is the measured size, so a seed that adds text needs headroom to fail for its own reason alone.
    const roomy = BODY_CEILINGS['Fix'] + 1_000
    expect(collectCodeBodyDefects(`${real}\nCREATE_PR: true\n`, roomy)).toEqual(['the Code body names "CREATE_PR"'])
    expect(collectCodeBodyDefects(real.replace('**Commit and push**', '**Commit**'), roomy))
      .toEqual(['the Code body lost "**Commit and push**"'])
    const bytes = Buffer.byteLength(real)
    expect(collectCodeBodyDefects(real, bytes - 1)).toEqual([`the Code body is ${bytes} bytes, ceiling ${bytes - 1}`])
  })
})

/**
 * setup-task's provider-independent steps, the compliance gate's single authority,
 * and the acceptance-criteria recipe (#359).
 *
 * PARITY. Jira and Linear setup-task said "unchanged from this operation's
 * provider-independent steps", but those steps existed only in the GitHub module —
 * so off the GitHub path conventions were never learned, the metacharacter guard
 * never ran, and the conventions-driven PR retitle silently no-opped. The two steps
 * are now `_common.mds` defines expanded into all three references, and this file
 * holds them byte-identical in the BUILT output.
 *
 * COMPLIANCE. The provider references used to carry their own "Compliance-gated"
 * prefix, which also wrapped Jira/Linear's explicit-`ISSUE_INPUT` fetch — a fetch no
 * command gates on compliance. The agent's `1b/1c are compliance-gated.` sentence is
 * now the one authority, and no provider reference restates a condition.
 *
 * AC RECIPE. The GitHub fetch-issue recipe was case-sensitive, matched checkboxes
 * only and piped an `echo`. The shipped line is extracted from the built reference
 * and EXECUTED over the shapes an issue body actually takes.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { spawnSync } from 'child_process'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { resolveAgentSource } from '../helpers.js'

const REFS_DIR = compiledSkillRefsDir()
const ROOT = path.resolve(import.meta.dirname, '../..')
const PROVIDERS = ['github', 'jira', 'linear'] as const

function requireRef(rel: string): string {
  const file = path.join(REFS_DIR, ...rel.split('/'))
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`${rel} is absent — run \`npm run build\` first (this guard reads built artifacts)`)
  }
}

/**
 * Named collector: the shared setup-task steps in one built reference — step 1b with
 * its indented bullets, and step 2's line. Null for a step that is absent.
 */
export function collectCommonSetupSteps(text: string): { conventions: string | null; detection: string | null } {
  const lines = text.split('\n')
  const at = lines.findIndex(l => l.startsWith('1b. **Branch convention:**'))
  let conventions: string | null = null
  if (at !== -1) {
    let end = at + 1
    while (end < lines.length && /^ {3}- /.test(lines[end])) end++
    conventions = lines.slice(at, end).join('\n')
  }
  const detection = lines.find(l => l.startsWith('2. **Detect the convention**')) ?? null
  return { conventions, detection }
}

describe('setup-task: the provider-independent steps are one text in every provider', () => {
  const steps = PROVIDERS.map(p => ({ provider: p, ...collectCommonSetupSteps(requireRef(`tracker/${p}/setup-task.md`)) }))

  it('every provider reference carries both steps', () => {
    for (const s of steps) {
      expect(s.conventions, `${s.provider}: step 1b (conventions + metacharacter guard) is missing`).not.toBeNull()
      expect(s.detection, `${s.provider}: step 2 (branch convention detection) is missing`).not.toBeNull()
    }
  })

  it('byte-identically', () => {
    expect(new Set(steps.map(s => s.conventions)).size, 'step 1b must be one author\'s bytes').toBe(1)
    expect(new Set(steps.map(s => s.detection)).size, 'step 2 must be one author\'s bytes').toBe(1)
  })

  it('the guarded step learns conventions, guards `#`, and binds the checkout variable', () => {
    const conventions = steps[0].conventions!
    expect(conventions).toContain('`learn-conventions`')
    expect(conventions).toContain('**Metacharacter guard:**')
    expect(conventions, '`#` opens a shell comment and must be in the guarded set').toContain('< > # ``')
    expect(conventions).toContain('`DEVFLOW_BRANCH="..."`')
  })

  it('the provider sources expand the shared defines instead of spelling them', () => {
    for (const p of PROVIDERS) {
      const source = readFileSync(path.join(ROOT, 'src', 'assets', 'mds', 'tracker', `_${p}.mds`), 'utf-8')
      expect(source, `_${p}.mds must expand the shared step`).toContain('{common.conventions_step()}')
      expect(source, `_${p}.mds must expand the shared step`).toContain('{common.branch_detection_step()}')
      expect(source, `_${p}.mds spells the guard itself — a second author`).not.toContain('**Metacharacter guard:**')
    }
  })

  it('known-bad probe: a diverged copy and a missing step are both reported', () => {
    const real = requireRef('tracker/jira/setup-task.md')
    const diverged = collectCommonSetupSteps(real.replace('< > # ``', '< > ``'))
    expect(diverged.conventions, 'the seed must still be found').not.toBeNull()
    expect(diverged.conventions).not.toBe(steps[0].conventions)
    expect(collectCommonSetupSteps('### Process\n3. Derive.\n')).toEqual({ conventions: null, detection: null })
  })
})

/** Named collector: compliance conditions a provider reference states for itself. */
export function collectComplianceConditions(text: string): string[] {
  return text.split('\n').filter(line => /COMPLIANCE|Compliance-gated/.test(line))
}

describe('the compliance gate on setup-task has one authority — the agent', () => {
  it('no provider setup-task or fetch-issue reference states a compliance condition', () => {
    const offenders: string[] = []
    for (const p of PROVIDERS) {
      for (const op of ['setup-task', 'fetch-issue']) {
        for (const line of collectComplianceConditions(requireRef(`tracker/${p}/${op}.md`))) {
          offenders.push(`tracker/${p}/${op}.md: ${line.trim().slice(0, 100)}`)
        }
      }
    }
    expect(offenders, `a second compliance authority:\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  it('the agent still gates 1b/1c', () => {
    expect(resolveAgentSource('git').content).toContain('1b/1c are compliance-gated.')
  })

  it('the explicit ISSUE_INPUT pre-flight is an ungated step 1 on every provider', () => {
    for (const p of PROVIDERS) {
      expect(requireRef(`tracker/${p}/setup-task.md`), `${p}: the pre-flight must not sit inside gated 1c`)
        .toMatch(/^1\. \*\*`ISSUE_INPUT` pre-flight\*\*/m)
    }
  })

  it('known-bad probe: the retired gate prefix is reported', () => {
    expect(collectComplianceConditions(
      '1c. (Compliance-gated — skip if `COMPLIANCE` is absent or `(none)`) Issue-first:',
    )).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// The acceptance-criteria recipe, executed.
// ---------------------------------------------------------------------------

/** Named collector: the shipped `CRITERIA=` line of a built reference, or null. */
export function collectCriteriaRecipe(text: string): string | null {
  return text.split('\n').find(line => line.startsWith('CRITERIA=$(')) ?? null
}

/** Run a recipe line under bash with BODY in the environment; stdout is `$CRITERIA`. */
function runRecipe(recipe: string, body: string): { status: number | null; criteria: string } {
  const run = spawnSync('bash', ['-c', `${recipe}\nprintf '%s' "$CRITERIA"`], {
    env: { PATH: process.env.PATH ?? '', BODY: body },
    encoding: 'utf-8',
    timeout: 10_000,
  })
  if (run.error) throw run.error
  return { status: run.status, criteria: run.stdout }
}

/** The recipe #359 replaced — a known-bad sample, quoted so the probe below can run it. */
const RETIRED_RECIPE =
  `CRITERIA=$(echo "$BODY" | sed -n '/## Acceptance Criteria/,/^##/p' | grep -E '^\\s*-\\s*\\[' || true)`

const NUMBERED_LOWERCASE = '## acceptance criteria:\n1. first item\n2) second item\n\n## Notes\n- [ ] not a criterion\n'

describe('fetch-issue: the acceptance-criteria recipe, executed', () => {
  const recipe = collectCriteriaRecipe(requireRef('tracker/github/fetch-issue.md'))

  it('the built reference carries one recipe line', () => {
    expect(recipe, 'no `CRITERIA=` line in tracker/github/fetch-issue.md').not.toBeNull()
  })

  const cases: ReadonlyArray<{ readonly label: string; readonly body: string; readonly expected: string }> = [
    { label: 'checkboxes', body: '## Acceptance Criteria\n- [ ] one\n- [x] two\n', expected: '- [ ] one\n- [x] two' },
    { label: 'numbered and lowercase', body: NUMBERED_LOWERCASE, expected: '1. first item\n2) second item' },
    { label: 'AC section at EOF, no trailing newline', body: 'Intro\n\n## Acceptance Criteria\n* last one', expected: '* last one' },
    {
      label: 'a nested ### stays inside, a following ## ends it',
      body: '## Acceptance Criteria\n- a\n### Detail\n- b\n## Notes\n- [ ] c\n',
      expected: '- a\n- b',
    },
    { label: 'CRLF line endings', body: '## Acceptance Criteria\r\n- [ ] one\r\n- two\r\n', expected: '- [ ] one\n- two' },
    { label: 'no heading', body: 'Nothing here\n- [ ] stray\n', expected: '' },
  ]

  for (const { label, body, expected } of cases) {
    it(`${label}`, () => {
      const { status, criteria } = runRecipe(recipe!, body)
      expect(status, 'the recipe must exit 0 whatever the body holds').toBe(0)
      expect(criteria).toBe(expected)
    })
  }

  it('known-bad probe: the retired recipe misses the numbered, lowercase section', () => {
    expect(runRecipe(RETIRED_RECIPE, NUMBERED_LOWERCASE).criteria).toBe('')
    expect(collectCriteriaRecipe('BODY=$(x)\n# nothing\n')).toBeNull()
  })
})

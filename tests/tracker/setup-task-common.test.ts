/**
 * setup-task's provider-independent steps, the gates each step states for itself,
 * and the acceptance-criteria recipe (#359).
 *
 * PARITY. Jira and Linear setup-task said "unchanged from this operation's
 * provider-independent steps", but those steps existed only in the GitHub module —
 * so off the GitHub path conventions were never learned, the metacharacter guard
 * never ran, and the conventions-driven PR retitle silently no-opped. The two steps
 * are now `_common.mds` defines expanded into all three references, and this file
 * holds them byte-identical in the BUILT output.
 *
 * GATES IN THE STEP TEXT (#362). Step 1b's conventions read and step 1c's
 * issue-first creation each state their own gate on the step's first line —
 * `APPLY_CONVENTIONS` and `ISSUE_REQUIRED` — in every provider's reference. This
 * reverses the doctrine this file used to enforce, that the agent's
 * `1b/1c are compliance-gated.` sentence was the one authority: that sentence sat in
 * a different file from the steps, and an agent reading the step alone learned and
 * committed `.devflow/conventions.md` with the gate off. The explicit-`ISSUE_INPUT`
 * pre-flight stays an ungated step 1, so a ticket a caller names is still linked
 * whatever the gate says.
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

/** The canonical gate phrase for each mechanism input — one spelling, so guards can collect it. */
const APPLY_CONVENTIONS_GATE = 'only when `APPLY_CONVENTIONS` is `true`'
const ISSUE_REQUIRED_GATE = 'only when `ISSUE_REQUIRED` is `true`'

/** One built setup-task reference, by provider. */
interface SetupRef {
  readonly name: string
  readonly content: string
}

/**
 * A numbered step's block: its own line plus the three-space sub-bullets under it.
 * Null when no line starts with `label`.
 */
function stepBlock(text: string, label: string): { head: string; block: string } | null {
  const lines = text.split('\n')
  const at = lines.findIndex(l => l.startsWith(label))
  if (at === -1) return null
  let end = at + 1
  while (end < lines.length && /^ {3}- /.test(lines[end])) end++
  return { head: lines[at], block: lines.slice(at, end).join('\n') }
}

/**
 * Named collector: a step whose gate is missing from its own first line, or stated
 * only after the action it gates. The rule is positional on purpose — a gate that
 * trails the action reads as an afterthought to the agent executing top to bottom,
 * which is the failure #362 fixed.
 */
function collectUngatedStep(
  refs: readonly SetupRef[],
  label: string,
  gate: string,
  action: string,
): string[] {
  const out: string[] = []
  for (const ref of refs) {
    const step = stepBlock(ref.content, label)
    if (step === null) {
      out.push(`${ref.name}: no \`${label}\` step`)
      continue
    }
    const acted = step.block.indexOf(action)
    if (acted === -1) {
      out.push(`${ref.name}: \`${label}\` never names ${action} — not the step this guard is about`)
      continue
    }
    const gated = step.head.indexOf(gate)
    if (gated === -1) out.push(`${ref.name}: \`${label}\` does not state "${gate}" on its own line`)
    else if (gated > acted) out.push(`${ref.name}: \`${label}\` states its gate only after ${action}`)
  }
  return out
}

/** Named collector: conventions steps that read or learn the file without stating `APPLY_CONVENTIONS` first. */
export function collectUngatedConventionsSteps(refs: readonly SetupRef[]): string[] {
  return collectUngatedStep(refs, '1b. **Branch convention:**', APPLY_CONVENTIONS_GATE, '`learn-conventions`')
}

/** Named collector: issue-first steps that reach `ensure-traceable-issue` without stating `ISSUE_REQUIRED` first. */
export function collectUngatedIssueFirstSteps(refs: readonly SetupRef[]): string[] {
  return collectUngatedStep(refs, '1c. ', ISSUE_REQUIRED_GATE, '`ensure-traceable-issue`')
}

/** The three setup-task steps as they shipped on `825077e`, before #362 — the regression's own text. */
const UNGATED_825077E = {
  conventions:
    "1b. **Branch convention:** read `.devflow/conventions.md`'s Branch Naming section (absent ⇒ run " +
    '`learn-conventions` first, then read it); step 3 MUST follow it.',
  githubIssueFirst: [
    '1c. Issue-first: before branch derivation, ensure a GitHub issue exists for this task:',
    '   - Otherwise: invoke `ensure-traceable-issue` with `TASK_DESCRIPTION` (and `PLAN_ARTIFACT_PATH` if provided) to create or find an issue. Capture the returned issue number.',
  ].join('\n'),
  jiraIssueFirst:
    '1c. Issue-first, if `ISSUE_INPUT` is absent: invoke `ensure-traceable-issue` with `TASK_DESCRIPTION` ' +
    "(and `PLAN_ARTIFACT_PATH` if provided) and capture the returned key for step 3's `{type}/{KEY}-{slug}`.",
} as const

describe('setup-task: each gated step states its own gate, in every provider (#362)', () => {
  const refs: SetupRef[] = PROVIDERS.map(p => ({
    name: `tracker/${p}/setup-task.md`,
    content: requireRef(`tracker/${p}/setup-task.md`),
  }))

  it('the corpus is the three built setup-task references', () => {
    expect(refs.map(r => r.name)).toEqual(PROVIDERS.map(p => `tracker/${p}/setup-task.md`))
    for (const r of refs) expect(r.content.length, `${r.name} is empty`).toBeGreaterThan(500)
  })

  it('step 1b states the APPLY_CONVENTIONS gate before it reads or learns conventions', () => {
    expect(collectUngatedConventionsSteps(refs)).toEqual([])
  })

  it('step 1c states the ISSUE_REQUIRED gate before it reaches ensure-traceable-issue', () => {
    expect(collectUngatedIssueFirstSteps(refs)).toEqual([])
  })

  it('the agent no longer states the gate in a second file', () => {
    // The regression's shape was a gate one file away from its step. The sentence
    // is deleted, not retargeted — a retargeted copy is still a second authority.
    expect(resolveAgentSource('git').content).not.toContain('1b/1c are compliance-gated.')
  })

  it('the explicit ISSUE_INPUT pre-flight is an ungated step 1 on every provider', () => {
    for (const p of PROVIDERS) {
      expect(requireRef(`tracker/${p}/setup-task.md`), `${p}: the pre-flight must not sit inside gated 1c`)
        .toMatch(/^1\. \*\*`ISSUE_INPUT` pre-flight\*\*/m)
    }
  })

  it('known-bad probe: the 825077e steps are reported by the same collectors', () => {
    const conventions = [{ name: '825077e/setup-task.md', content: `${UNGATED_825077E.conventions}\n` }]
    expect(collectUngatedConventionsSteps(conventions)).toEqual([
      '825077e/setup-task.md: `1b. **Branch convention:**` does not state "only when `APPLY_CONVENTIONS` is `true`" on its own line',
    ])
    const issueFirst = [
      { name: '825077e/github', content: UNGATED_825077E.githubIssueFirst },
      { name: '825077e/jira', content: UNGATED_825077E.jiraIssueFirst },
    ]
    expect(collectUngatedIssueFirstSteps(issueFirst)).toHaveLength(2)
  })

  it('known-bad probe: a gate that trails its action, and a missing step, are reported', () => {
    const trailing = [{
      name: 'trailing.md',
      content: '1b. **Branch convention:** run `learn-conventions` first, only when `APPLY_CONVENTIONS` is `true`.\n',
    }]
    expect(collectUngatedConventionsSteps(trailing)).toEqual([
      'trailing.md: `1b. **Branch convention:**` states its gate only after `learn-conventions`',
    ])
    expect(collectUngatedIssueFirstSteps([{ name: 'none.md', content: '### Process\n2. Detect.\n' }]))
      .toEqual(['none.md: no `1c. ` step'])
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

import { describe, it, expect } from 'vitest'
import { loadFile, extractSection } from './helpers'
import { resolveAgentSource, resolveAllAgents } from '../helpers'

/**
 * Named collector: sentences in an agent source that tell the agent to read the
 * learning index (`.devflow/learning/index.md`) for itself. A mention in an input
 * description ("pre-rendered to ...") is not an instruction, so the verb must come
 * first in the sentence.
 */
function collectSelfReadInstructions(agents: ReadonlyArray<readonly [string, string]>): string[] {
  return agents.flatMap(([name, content]) =>
    content.split(/(?<=[.!?])\s+|\n/)
      .filter(s => /\b[Rr]eads?\b[^.\n]*\.devflow\/learning\/index\.md/.test(s))
      .map(s => `${name}: ${s.trim().slice(0, 100)}`),
  )
}

// -------------------------------------------------------------------------
// Command surfaces — must reference index.md read (AC-3 updated)
// -------------------------------------------------------------------------

describe('Command surfaces — index.md direct read', () => {
  const surfaces: Array<[string, string]> = [
    ['plan.md', 'dist/commands/plan.md'],
    ['resolve.md', 'dist/commands/resolve.md'],
    ['self-review.md', 'dist/commands/self-review.md'],
    ['code-review.md', 'dist/commands/code-review.md'],
    ['debug.md', 'dist/commands/debug.md'],
    ['implement.md', 'dist/commands/implement.md'],
    ['research.md', 'dist/commands/research.md'],
    ['bug-analysis.md', 'dist/commands/bug-analysis.md'],
  ]

  for (const [label, relPath] of surfaces) {
    it(`${label} reads index.md (no decisions-index.cjs subprocess)`, () => {
      const content = loadFile(relPath)
      // Must reference the pre-rendered index.md artifact (now under learning/)
      expect(content).toContain('.devflow/learning/index.md')
      // Must NOT reference decisions-index.cjs in any form (the script is retired)
      expect(content).not.toContain('decisions-index.cjs')
    })
  }
})

// -------------------------------------------------------------------------
// debug.md — decisions orchestrator-local, not fanned
// -------------------------------------------------------------------------

describe('debug.md — decisions is orchestrator-local, not fanned to Explore investigators', () => {
  it('debug.md contains DECISIONS_CONTEXT (orchestrator uses it)', () => {
    const content = loadFile('dist/commands/debug.md')
    expect(content).toContain('DECISIONS_CONTEXT')
  })

  it('debug.md Investigate phase does NOT pass DECISIONS_CONTEXT to Explore investigators', () => {
    const content = loadFile('dist/commands/debug.md')
    const phase3 = extractSection(content, 'Phase 3: Investigate', '### Phase 4')
    expect(phase3).not.toContain('DECISIONS_CONTEXT')
  })
})

// -------------------------------------------------------------------------
// DECISIONS_CONTEXT substitution template — single canonical form
// -------------------------------------------------------------------------

describe('DECISIONS_CONTEXT template — uses canonical {decisions_context} form without fallback', () => {
  const templateSurfaces: Array<[string, string]> = [
    ['plan.md', 'dist/commands/plan.md'],
    ['resolve.md', 'dist/commands/resolve.md'],
    ['self-review.md', 'dist/commands/self-review.md'],
    ['code-review.md', 'dist/commands/code-review.md'],
  ]

  for (const [label, relPath] of templateSurfaces) {
    it(`${label} does not use the legacy quoted or prose-fallback forms`, () => {
      const content = loadFile(relPath)
      // Quoted fallback (Form A)
      expect(content).not.toContain(`{decisions_context or '(none)'}`)
      // Prose-descriptive fallback (Form B)
      expect(content).not.toMatch(/\{decisions index from[^}]+, or \(none\)\}/)
      expect(content).not.toMatch(/\{Phase \d+ decisions index, or \(none\)\}/)
    })
  }
})

// -------------------------------------------------------------------------
// Consumer agents — must reference devflow:apply-decisions in skills frontmatter
// -------------------------------------------------------------------------

describe('Consumer agents — devflow:apply-decisions in skills frontmatter', () => {
  const agents: Array<[string, string]> = [
    ['triage.md', 'triage'],
    ['design.md', 'design'],
    ['scrutinize.md', 'scrutinize'],
    ['review.md', 'review'],
  ]

  for (const [label, agent] of agents) {
    it(`${label} references devflow:apply-decisions in skills frontmatter`, () => {
      const content = resolveAgentSource(agent).content
      // Extract frontmatter (between first --- and second ---)
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/m)
      expect(frontmatterMatch).toBeTruthy()
      const frontmatter = frontmatterMatch![1]
      expect(frontmatter).toContain('devflow:apply-decisions')
    })
  }

  it('simplify.md does NOT reference devflow:apply-decisions (code-shape role, not quality gate)', () => {
    const content = loadFile('src/assets/agents/simplify.md')
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/m)
    expect(frontmatterMatch).toBeTruthy()
    const frontmatter = frontmatterMatch![1]
    expect(frontmatter).not.toContain('devflow:apply-decisions')
  })
})

// -------------------------------------------------------------------------
// DECISIONS_CONTEXT input description — canonical form across consumer agents
// -------------------------------------------------------------------------

describe('DECISIONS_CONTEXT input declaration — canonical form', () => {
  const CANONICAL_DESCRIPTION =
    '**DECISIONS_CONTEXT** (optional): Compact index of active ADR/PF entries for this repository (pre-rendered to `.devflow/learning/index.md` in its main worktree). `(none)` when absent. Use `devflow:apply-decisions` to Read full bodies on demand.'

  const consumerAgents: Array<[string, string]> = [
    ['triage.md', 'triage'],
    ['design.md', 'design'],
    ['scrutinize.md', 'scrutinize'],
    ['review.md', 'review'],
  ]

  for (const [label, agent] of consumerAgents) {
    it(`${label} declares DECISIONS_CONTEXT with canonical description`, () => {
      const content = resolveAgentSource(agent).content
      expect(content).toContain(CANONICAL_DESCRIPTION)
    })
  }
})

// -------------------------------------------------------------------------
// DECISIONS_CONTEXT variable present in all consumer surfaces
// -------------------------------------------------------------------------

describe('DECISIONS_CONTEXT variable — present in all four command surfaces', () => {
  it('plan.md contains DECISIONS_CONTEXT', () => {
    expect(loadFile('dist/commands/plan.md')).toContain('DECISIONS_CONTEXT')
  })

  it('self-review.md contains DECISIONS_CONTEXT', () => {
    expect(loadFile('dist/commands/self-review.md')).toContain('DECISIONS_CONTEXT')
  })

  it('code-review.md contains DECISIONS_CONTEXT', () => {
    expect(loadFile('dist/commands/code-review.md')).toContain('DECISIONS_CONTEXT')
  })

  it('debug.md contains DECISIONS_CONTEXT', () => {
    expect(loadFile('dist/commands/debug.md')).toContain('DECISIONS_CONTEXT')
  })

  it('resolve.md contains DECISIONS_CONTEXT', () => {
    expect(loadFile('dist/commands/resolve.md')).toContain('DECISIONS_CONTEXT')
  })
})

// -------------------------------------------------------------------------
// Review agent — apply-decisions section references skill
// -------------------------------------------------------------------------

describe('review.md — Apply Decisions section', () => {
  it('contains Apply Decisions section referencing devflow:apply-decisions', () => {
    const content = resolveAgentSource('review').content
    expect(content).toMatch(/## Apply Decisions|### Apply Decisions/)
    expect(content).toContain('devflow:apply-decisions')
  })
})

// -------------------------------------------------------------------------
// Consumers read the decisions index from the repository's main worktree
// -------------------------------------------------------------------------

describe('consumers read the decisions index from the main worktree', () => {
  it('code.md takes DECISIONS_CONTEXT or nothing: it has no fallback read and never names the checkout decisions files', () => {
    const content = resolveAgentSource('code').content
    expect(content).toContain('If `DECISIONS_CONTEXT` is provided, follow `devflow:apply-decisions` on it.')
    expect(content).toContain('An absent key or `(none)` means no decisions context.')
    expect(content).not.toContain('Otherwise read the decisions index')
    expect(content).not.toContain('--git-common-dir')
    expect(content).not.toContain('.devflow/learning/decisions.md')
    expect(content).not.toContain('.devflow/learning/pitfalls.md')
  })

  it('no agent is told to read the learning index itself, and the apply-decisions skip guard has no read-it-yourself clause', () => {
    const agents = [...resolveAllAgents().entries()]
    expect(agents.length, 'the agent corpus').toBeGreaterThanOrEqual(16)
    expect(collectSelfReadInstructions(agents.map(([name, a]) => [name, a.content] as const))).toEqual([])
    const skill = loadFile('src/assets/skills/apply-decisions/SKILL.md')
    expect(skill).not.toMatch(/unless your (agent )?instructions tell you to read/)
    expect(extractSection(skill, '## Skip Guard', null)).toContain('skip this skill')
  })

  it('known-bad probe: the retired Code fallback sentence is reported as a self-read instruction', () => {
    const retired =
      'Otherwise read the decisions index — `.devflow/learning/index.md` at the repository\'s main worktree ' +
      '(`git rev-parse --path-format=absolute --git-common-dir`) — and follow `devflow:apply-decisions` on it.'
    expect(collectSelfReadInstructions([['code', retired]])).toHaveLength(1)
    // An input description that names where the index is rendered is not an instruction to read it.
    expect(collectSelfReadInstructions([['triage', 'pre-rendered to `.devflow/learning/index.md` in its main worktree']])).toEqual([])
  })

  it('skim.md reads the decisions TL;DR at the main worktree, else the toplevel, else the start directory', () => {
    const step6 = extractSection(
      resolveAgentSource('skim').content, '### Step 6: Project Knowledge', '### Step 7',
    )
    expect(step6).toContain('`git -C "{start}" rev-parse --path-format=absolute --show-toplevel --git-common-dir`')
    const tiers = ['the main worktree', 'else the toplevel', 'else `{start}`'].map(tier => step6.indexOf(tier))
    expect(tiers.every(at => at > -1), step6).toBe(true)
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers)
    expect(step6).toContain('`{ledger}/.devflow/learning/decisions.md`')
    expect(step6).toContain('`<!-- TL;DR: N decisions -->`')
    expect(step6).not.toContain('If `.devflow/learning/decisions.md` exists')
  })

  it('code.md states applied decisions and pitfalls in words, never by ID', () => {
    expect(resolveAgentSource('code').content).toContain(
      'State every decision or pitfall you apply in words in code, comments, tests and commit messages, never by its ID.',
    )
  })

  it('_decisions.mds exports decisions_gate, decisions_locate and decisions_load, and the loader calls the gate before the locator', () => {
    const source = loadFile('src/assets/commands/_partials/_decisions.mds')
    for (const name of ['decisions_gate', 'decisions_locate', 'decisions_load']) {
      expect(source, name).toMatch(new RegExp(`^@define ${name}\\(\\):$`, 'm'))
      expect(source, name).toMatch(new RegExp(`^@export ${name}$`, 'm'))
    }
    const load = source.slice(source.indexOf('@define decisions_load():'))
    const body = load.slice(0, load.indexOf('@end'))
    expect(body).toContain('{{decisions_gate()}}')
    expect(body).toContain('{{decisions_locate()}}')
    expect(body.indexOf('{{decisions_gate()}}'), 'the gate comes before the locator').toBeLessThan(body.indexOf('{{decisions_locate()}}'))
  })

  it('_preamble.mds alias-imports the locator and calls it, with no selective import', () => {
    const source = loadFile('src/assets/commands/_partials/_preamble.mds')
    expect(source).toMatch(/^@import "\.\/_decisions\.mds" as decisions$/m)
    expect(source).toContain('{{decisions.decisions_locate()}}')
    expect(source).not.toMatch(/@import \{[^}]*\} from "\.\/_decisions\.mds"/)
    expect(source).toContain('`{ledger}/.devflow/learning/index.md`')
  })

  it('the decisions step is its own define, authoring_decisions: gate then locator, none of it in authoring_preamble', () => {
    const source = loadFile('src/assets/commands/_partials/_preamble.mds')
    const defineBody = (name: string): string => {
      const at = source.indexOf(`@define ${name}():`)
      return source.slice(at, source.indexOf('\n@end', at))
    }
    const decisions = defineBody('authoring_decisions')
    expect(decisions).toContain('{{decisions.decisions_gate()}}')
    expect(decisions.indexOf('{{decisions.decisions_gate()}}')).toBeLessThan(decisions.indexOf('{{decisions.decisions_locate()}}'))
    expect(source).toMatch(/^@export authoring_decisions$/m)
    const preamble = defineBody('authoring_preamble')
    for (const stray of ['DECISIONS_CONTEXT', 'decisions_locate', 'decisions_gate', 'apply-decisions']) {
      expect(preamble, `authoring_preamble carries ${stray}`).not.toContain(stray)
    }
  })

  it('the dynamic-build implement bundle passes the DECISIONS_CONTEXT loaded before authoring', () => {
    const content = loadFile('dist/commands/dynamic-build.md')
    expect(content).toContain('relevant DECISIONS_CONTEXT (the index you loaded before authoring)')
    expect(content).not.toContain('DECISIONS_CONTEXT (from `.devflow/learning/index.md`)')
  })
})

// -------------------------------------------------------------------------
// plan.md — decisions loading phase present
// -------------------------------------------------------------------------

describe('plan.md — decisions loading phase', () => {
  it('contains a decisions-loading step (load decisions index)', () => {
    const content = loadFile('dist/commands/plan.md')
    expect(content).toMatch(/[Ll]oad.*[Dd]ecisions|[Dd]ecisions.*[Ll]oad/i)
  })
})

// -------------------------------------------------------------------------
// code-review.md — decisions loading phase present
// -------------------------------------------------------------------------

describe('code-review.md — decisions loading phase', () => {
  it('contains a decisions-loading step', () => {
    const content = loadFile('dist/commands/code-review.md')
    expect(content).toMatch(/[Ll]oad.*[Dd]ecisions|[Dd]ecisions.*[Ll]oad/i)
  })
})

// -------------------------------------------------------------------------
// Skim — the LEARNING input and the skip rule (D-DECISIONS-LEARNING-GATE)
// -------------------------------------------------------------------------

describe('Skim takes LEARNING, skips Step 6 when it is off, and its callers pass it', () => {
  const SKIM_HOSTS = ['explore', 'plan', 'research'] as const
  const SETTINGS_OPENING = '**Resolve the settings line**'
  const SKIP_RULE = 'When `LEARNING` is `off`, skip this step'
  const TLDR_READ = 'Read the decisions TL;DR'

  /** Named collector: the spawn text of every Skim spawn — a fenced payload, else the rest of its line. */
  function collectSkimSpawns(text: string): Array<{ at: number; span: string }> {
    const out: Array<{ at: number; span: string }> = []
    for (const m of text.matchAll(/Agent\(subagent_type="Skim"\)(:?)/g)) {
      const at = m.index ?? 0
      const fenced = m[1] === ':' ? /^:\n"[\s\S]*?"\n```/.exec(text.slice(at + m[0].length - 1)) : null
      const lineEnd = text.indexOf('\n', at)
      out.push({ at, span: fenced !== null ? m[0] + fenced[0].slice(1) : text.slice(at, lineEnd === -1 ? text.length : lineEnd) })
    }
    return out
  }

  /** Named collector: Skim spawns that do not pass LEARNING, or that precede the host's settings block. */
  function collectSkimSpawnDefects(host: string, text: string): string[] {
    const spawns = collectSkimSpawns(text)
    if (spawns.length === 0) return [`${host}: no Skim spawn found`]
    const block = text.indexOf(SETTINGS_OPENING)
    return spawns.flatMap(({ at, span }) => [
      ...(span.includes('LEARNING') ? [] : [`${host}: a Skim spawn does not pass LEARNING`]),
      ...(block !== -1 && block < at ? [] : [`${host}: a Skim spawn precedes the settings block`]),
    ])
  }

  /** Named collector: Step 6 problems — the skip rule must open the step, before the TL;DR read. */
  function collectStep6Defects(step6: string): string[] {
    const skip = step6.indexOf(SKIP_RULE)
    const read = step6.indexOf(TLDR_READ)
    return [
      ...(skip === -1 ? ['Step 6 has no LEARNING skip rule'] : []),
      ...(skip !== -1 && read !== -1 && read < skip ? ['Step 6 reads the TL;DR before the skip rule'] : []),
    ]
  }

  it('explore, plan and research pass LEARNING into every Skim spawn, after their settings block', () => {
    for (const host of SKIM_HOSTS) {
      const text = loadFile(`dist/commands/${host}.md`)
      expect(collectSkimSpawns(text).length, `${host}: Skim spawns found`).toBeGreaterThanOrEqual(1)
      expect(collectSkimSpawnDefects(host, text), host).toEqual([])
    }
  })

  it('known-bad probes: a Skim spawn without LEARNING, and one before the settings block, are reported', () => {
    expect(collectSkimSpawnDefects('p', `${SETTINGS_OPENING}\nSpawn \`Agent(subagent_type="Skim")\` to orient.`))
      .toEqual(['p: a Skim spawn does not pass LEARNING'])
    expect(collectSkimSpawnDefects('p', `Spawn \`Agent(subagent_type="Skim")\` with \`LEARNING\` to orient.\n${SETTINGS_OPENING}`))
      .toEqual(['p: a Skim spawn precedes the settings block'])
    expect(collectSkimSpawnDefects('p', 'no spawn')).toEqual(['p: no Skim spawn found'])
  })

  it('Skim lists LEARNING in its input context and opens Step 6 with the skip rule', () => {
    const skim = resolveAgentSource('skim').content
    expect(extractSection(skim, '## Input Context', '**Worktree Support**')).toContain('- **LEARNING** (optional): `on` | `off`')
    const step6 = extractSection(skim, '### Step 6: Project Knowledge', '### Step 7')
    expect(step6.slice('### Step 6: Project Knowledge'.length).trimStart().startsWith(SKIP_RULE)).toBe(true)
    expect(collectStep6Defects(step6)).toEqual([])
  })

  it('known-bad probes: a Step 6 with no skip rule, and one that reads the TL;DR first, are reported', () => {
    expect(collectStep6Defects(`### Step 6\n${TLDR_READ} at the ledger.`)).toEqual(['Step 6 has no LEARNING skip rule'])
    expect(collectStep6Defects(`### Step 6\n${TLDR_READ} first. ${SKIP_RULE} after.`)).toEqual(['Step 6 reads the TL;DR before the skip rule'])
  })
})

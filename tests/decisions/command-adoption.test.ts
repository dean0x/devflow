import { describe, it, expect } from 'vitest'
import { loadFile, extractSection } from './helpers'
import { resolveAgentSource } from '../helpers'

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
  it('code.md falls back to the main worktree index, never to the checkout decisions files', () => {
    const content = resolveAgentSource('code').content
    expect(content).toContain('If `DECISIONS_CONTEXT` is provided, follow `devflow:apply-decisions` on it.')
    expect(content).toContain(
      'Otherwise read the decisions index — `.devflow/learning/index.md` at the repository\'s main worktree ' +
      '(`git rev-parse --path-format=absolute --git-common-dir`; when it ends in `/.git` the index lives under its parent)',
    )
    expect(content).toContain('skip it when absent, empty or `(none)`')
    expect(content).not.toContain('.devflow/learning/decisions.md')
    expect(content).not.toContain('.devflow/learning/pitfalls.md')
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

  it('_decisions.mds exports decisions_locate and decisions_load, and the loader calls the locator', () => {
    const source = loadFile('src/assets/commands/_partials/_decisions.mds')
    expect(source).toMatch(/^@define decisions_locate\(\):$/m)
    expect(source).toMatch(/^@define decisions_load\(\):$/m)
    expect(source).toMatch(/^@export decisions_locate$/m)
    expect(source).toMatch(/^@export decisions_load$/m)
    const load = source.slice(source.indexOf('@define decisions_load():'))
    expect(load.slice(0, load.indexOf('@end'))).toContain('{{decisions_locate()}}')
  })

  it('_preamble.mds alias-imports the locator and calls it, with no selective import', () => {
    const source = loadFile('src/assets/commands/_partials/_preamble.mds')
    expect(source).toMatch(/^@import "\.\/_decisions\.mds" as decisions$/m)
    expect(source).toContain('{{decisions.decisions_locate()}}')
    expect(source).not.toMatch(/@import \{[^}]*\} from "\.\/_decisions\.mds"/)
    expect(source).toContain('`{ledger}/.devflow/learning/index.md`')
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

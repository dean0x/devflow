import { describe, it, expect } from 'vitest'
import { loadFile, extractSection } from './helpers'

// -------------------------------------------------------------------------
// Command surfaces — must reference decisions-index.cjs index
// -------------------------------------------------------------------------

describe('Command surfaces — decisions-index.cjs index invocation', () => {
  const surfaces: Array<[string, string]> = [
    ['plan.md', 'plugins/devflow-plan/commands/plan.md'],
    ['plan-teams.md', 'plugins/devflow-plan/commands/plan-teams.md'],
    ['resolve.md', 'plugins/devflow-resolve/commands/resolve.md'],
    ['resolve-teams.md', 'plugins/devflow-resolve/commands/resolve-teams.md'],
    ['self-review.md', 'plugins/devflow-self-review/commands/self-review.md'],
    ['code-review.md', 'plugins/devflow-code-review/commands/code-review.md'],
    ['code-review-teams.md', 'plugins/devflow-code-review/commands/code-review-teams.md'],
    ['debug.md', 'plugins/devflow-debug/commands/debug.md'],
    ['debug-teams.md', 'plugins/devflow-debug/commands/debug-teams.md'],
  ]

  for (const [label, relPath] of surfaces) {
    it(`${label} invokes decisions-index.cjs index with {worktree} placeholder`, () => {
      const content = loadFile(relPath)
      expect(content).toContain('decisions-index.cjs index "{worktree}"')
    })
  }
})

// -------------------------------------------------------------------------
// Orch skill surfaces — must reference decisions-index.cjs index
// -------------------------------------------------------------------------

describe('Orch skill surfaces — decisions-index.cjs index invocation', () => {
  const orchSkills: Array<[string, string]> = [
    ['plan:orch', 'shared/skills/plan:orch/SKILL.md'],
    ['resolve:orch', 'shared/skills/resolve:orch/SKILL.md'],
    ['review:orch', 'shared/skills/review:orch/SKILL.md'],
    ['debug:orch', 'shared/skills/debug:orch/SKILL.md'],
  ]

  for (const [label, relPath] of orchSkills) {
    it(`${label} SKILL.md invokes decisions-index.cjs index with {worktree} placeholder`, () => {
      const content = loadFile(relPath)
      expect(content).toContain('decisions-index.cjs index "{worktree}"')
    })
  }
})

// -------------------------------------------------------------------------
// debug:orch — decisions loads orchestrator-locally, NOT fanned to Explore
// -------------------------------------------------------------------------

describe('debug:orch — decisions is orchestrator-local, not fanned to Explore spawns', () => {
  it('debug:orch SKILL.md contains DECISIONS_CONTEXT (orchestrator uses it)', () => {
    const content = loadFile('shared/skills/debug:orch/SKILL.md')
    expect(content).toContain('DECISIONS_CONTEXT')
  })

  it('debug:orch Explore spawn blocks do NOT pass DECISIONS_CONTEXT to sub-agents', () => {
    const content = loadFile('shared/skills/debug:orch/SKILL.md')
    // Find the Phase 3 Investigate section (Explore spawns)
    const phase3Section = extractSection(content, 'Phase 3: Investigate', '## Phase 4')
    // DECISIONS_CONTEXT should NOT appear in Explore spawn block parameters
    expect(phase3Section).not.toContain('DECISIONS_CONTEXT')
  })
})

// -------------------------------------------------------------------------
// debug.md & debug-teams.md — decisions orchestrator-local, not fanned
// -------------------------------------------------------------------------

describe('debug.md — decisions is orchestrator-local, not fanned to Explore investigators', () => {
  it('debug.md contains DECISIONS_CONTEXT (orchestrator uses it)', () => {
    const content = loadFile('plugins/devflow-debug/commands/debug.md')
    expect(content).toContain('DECISIONS_CONTEXT')
  })

  it('debug.md Investigate phase does NOT pass DECISIONS_CONTEXT to Explore investigators', () => {
    const content = loadFile('plugins/devflow-debug/commands/debug.md')
    const phase3 = extractSection(content, 'Phase 3: Investigate', '### Phase 4')
    expect(phase3).not.toContain('DECISIONS_CONTEXT')
  })
})

describe('debug-teams.md — decisions is orchestrator-local, not fanned to teammates', () => {
  it('debug-teams.md contains DECISIONS_CONTEXT (orchestrator uses it)', () => {
    const content = loadFile('plugins/devflow-debug/commands/debug-teams.md')
    expect(content).toContain('DECISIONS_CONTEXT')
  })

  it('debug-teams.md teammate spawn block does NOT pass DECISIONS_CONTEXT to investigators', () => {
    const content = loadFile('plugins/devflow-debug/commands/debug-teams.md')
    const phase3 = extractSection(content, 'Phase 3: Spawn Investigation Team', '### Phase 4')
    expect(phase3).not.toContain('DECISIONS_CONTEXT')
  })
})

// -------------------------------------------------------------------------
// DECISIONS_CONTEXT substitution template — single canonical form
// -------------------------------------------------------------------------

describe('DECISIONS_CONTEXT template — uses canonical {decisions_context} form without fallback', () => {
  const templateSurfaces: Array<[string, string]> = [
    ['plan.md', 'plugins/devflow-plan/commands/plan.md'],
    ['plan-teams.md', 'plugins/devflow-plan/commands/plan-teams.md'],
    ['resolve.md', 'plugins/devflow-resolve/commands/resolve.md'],
    ['resolve-teams.md', 'plugins/devflow-resolve/commands/resolve-teams.md'],
    ['self-review.md', 'plugins/devflow-self-review/commands/self-review.md'],
    ['code-review.md', 'plugins/devflow-code-review/commands/code-review.md'],
    ['code-review-teams.md', 'plugins/devflow-code-review/commands/code-review-teams.md'],
    ['plan:orch', 'shared/skills/plan:orch/SKILL.md'],
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
    ['resolver.md', 'shared/agents/resolver.md'],
    ['designer.md', 'shared/agents/designer.md'],
    ['scrutinizer.md', 'shared/agents/scrutinizer.md'],
    ['reviewer.md', 'shared/agents/reviewer.md'],
  ]

  for (const [label, relPath] of agents) {
    it(`${label} references devflow:apply-decisions in skills frontmatter`, () => {
      const content = loadFile(relPath)
      // Extract frontmatter (between first --- and second ---)
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/m)
      expect(frontmatterMatch).toBeTruthy()
      const frontmatter = frontmatterMatch![1]
      expect(frontmatter).toContain('devflow:apply-decisions')
    })
  }

  it('simplifier.md does NOT reference devflow:apply-decisions (code-shape role, not quality gate)', () => {
    const content = loadFile('shared/agents/simplifier.md')
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
    '**DECISIONS_CONTEXT** (optional): Compact index of active ADR/PF entries for this worktree (generated by `decisions-index.cjs index`). `(none)` when absent. Use `devflow:apply-decisions` to Read full bodies on demand.'

  const consumerAgents: Array<[string, string]> = [
    ['resolver.md', 'shared/agents/resolver.md'],
    ['designer.md', 'shared/agents/designer.md'],
    ['scrutinizer.md', 'shared/agents/scrutinizer.md'],
    ['reviewer.md', 'shared/agents/reviewer.md'],
  ]

  for (const [label, relPath] of consumerAgents) {
    it(`${label} declares DECISIONS_CONTEXT with canonical description`, () => {
      const content = loadFile(relPath)
      expect(content).toContain(CANONICAL_DESCRIPTION)
    })
  }
})

// -------------------------------------------------------------------------
// DECISIONS_CONTEXT variable present in all consumer surfaces
// -------------------------------------------------------------------------

describe('DECISIONS_CONTEXT variable — present in all four command surfaces', () => {
  it('plan.md contains DECISIONS_CONTEXT', () => {
    expect(loadFile('plugins/devflow-plan/commands/plan.md')).toContain('DECISIONS_CONTEXT')
  })

  it('self-review.md contains DECISIONS_CONTEXT', () => {
    expect(loadFile('plugins/devflow-self-review/commands/self-review.md')).toContain('DECISIONS_CONTEXT')
  })

  it('code-review.md contains DECISIONS_CONTEXT', () => {
    expect(loadFile('plugins/devflow-code-review/commands/code-review.md')).toContain('DECISIONS_CONTEXT')
  })

  it('plan:orch SKILL.md contains DECISIONS_CONTEXT', () => {
    expect(loadFile('shared/skills/plan:orch/SKILL.md')).toContain('DECISIONS_CONTEXT')
  })

  it('review:orch SKILL.md contains DECISIONS_CONTEXT', () => {
    expect(loadFile('shared/skills/review:orch/SKILL.md')).toContain('DECISIONS_CONTEXT')
  })

  it('debug:orch SKILL.md contains DECISIONS_CONTEXT', () => {
    expect(loadFile('shared/skills/debug:orch/SKILL.md')).toContain('DECISIONS_CONTEXT')
  })
})

// -------------------------------------------------------------------------
// Reviewer agent — apply-decisions section references skill
// -------------------------------------------------------------------------

describe('reviewer.md — Apply Decisions section', () => {
  it('contains Apply Decisions section referencing devflow:apply-decisions', () => {
    const content = loadFile('shared/agents/reviewer.md')
    expect(content).toMatch(/## Apply Decisions|### Apply Decisions/)
    expect(content).toContain('devflow:apply-decisions')
  })
})

// -------------------------------------------------------------------------
// plan:orch — decisions loading phase present
// -------------------------------------------------------------------------

describe('plan:orch — decisions loading phase', () => {
  it('contains a decisions-loading step (load decisions index)', () => {
    const content = loadFile('shared/skills/plan:orch/SKILL.md')
    // Should have a phase that loads decisions
    expect(content).toMatch(/[Ll]oad.*[Dd]ecisions|[Dd]ecisions.*[Ll]oad/i)
  })

  it('Explore spawn blocks receive DECISIONS_CONTEXT', () => {
    const content = loadFile('shared/skills/plan:orch/SKILL.md')
    // The Explore phase section should mention DECISIONS_CONTEXT
    const phase5 = extractSection(content, 'Phase 5: Explore', '## Phase 6')
    expect(phase5).toContain('DECISIONS_CONTEXT')
  })
})

// -------------------------------------------------------------------------
// review:orch — decisions loading phase present
// -------------------------------------------------------------------------

describe('review:orch — decisions loading phase', () => {
  it('contains a decisions-loading step', () => {
    const content = loadFile('shared/skills/review:orch/SKILL.md')
    expect(content).toMatch(/[Ll]oad.*[Dd]ecisions|[Dd]ecisions.*[Ll]oad/i)
  })

  it('Phase 5 Reviews section receives DECISIONS_CONTEXT', () => {
    const content = loadFile('shared/skills/review:orch/SKILL.md')
    const phase5 = extractSection(content, 'Phase 5: Reviews', '## Phase 6')
    expect(phase5).toContain('DECISIONS_CONTEXT')
  })
})

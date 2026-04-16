import { describe, it, expect } from 'vitest'
import { loadFile, extractSection } from './helpers'

// -------------------------------------------------------------------------
// Command surfaces — must reference knowledge-context.cjs index
// -------------------------------------------------------------------------

describe('Command surfaces — knowledge-context.cjs index invocation', () => {
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
    it(`${label} invokes knowledge-context.cjs index with {worktree} placeholder`, () => {
      const content = loadFile(relPath)
      expect(content).toContain('knowledge-context.cjs index "{worktree}"')
    })
  }
})

// -------------------------------------------------------------------------
// Orch skill surfaces — must reference knowledge-context.cjs index
// -------------------------------------------------------------------------

describe('Orch skill surfaces — knowledge-context.cjs index invocation', () => {
  const orchSkills: Array<[string, string]> = [
    ['plan:orch', 'shared/skills/plan:orch/SKILL.md'],
    ['resolve:orch', 'shared/skills/resolve:orch/SKILL.md'],
    ['review:orch', 'shared/skills/review:orch/SKILL.md'],
    ['debug:orch', 'shared/skills/debug:orch/SKILL.md'],
  ]

  for (const [label, relPath] of orchSkills) {
    it(`${label} SKILL.md invokes knowledge-context.cjs index with {worktree} placeholder`, () => {
      const content = loadFile(relPath)
      expect(content).toContain('knowledge-context.cjs index "{worktree}"')
    })
  }
})

// -------------------------------------------------------------------------
// debug:orch — knowledge loads orchestrator-locally, NOT fanned to Explore
// -------------------------------------------------------------------------

describe('debug:orch — knowledge is orchestrator-local, not fanned to Explore spawns', () => {
  it('debug:orch SKILL.md contains KNOWLEDGE_CONTEXT (orchestrator uses it)', () => {
    const content = loadFile('shared/skills/debug:orch/SKILL.md')
    expect(content).toContain('KNOWLEDGE_CONTEXT')
  })

  it('debug:orch Explore spawn blocks do NOT pass KNOWLEDGE_CONTEXT to sub-agents', () => {
    const content = loadFile('shared/skills/debug:orch/SKILL.md')
    // Find the Phase 2 Investigate section (Explore spawns)
    const phase2Section = extractSection(content, 'Phase 2: Investigate', '## Phase 3')
    // KNOWLEDGE_CONTEXT should NOT appear in Explore spawn block parameters
    expect(phase2Section).not.toContain('KNOWLEDGE_CONTEXT')
  })
})

// -------------------------------------------------------------------------
// debug.md & debug-teams.md — knowledge orchestrator-local, not fanned
// -------------------------------------------------------------------------

describe('debug.md — knowledge is orchestrator-local, not fanned to Explore investigators', () => {
  it('debug.md contains KNOWLEDGE_CONTEXT (orchestrator uses it)', () => {
    const content = loadFile('plugins/devflow-debug/commands/debug.md')
    expect(content).toContain('KNOWLEDGE_CONTEXT')
  })

  it('debug.md Investigate phase does NOT pass KNOWLEDGE_CONTEXT to Explore investigators', () => {
    const content = loadFile('plugins/devflow-debug/commands/debug.md')
    const phase3 = extractSection(content, 'Phase 3: Investigate', '### Phase 4')
    expect(phase3).not.toContain('KNOWLEDGE_CONTEXT')
  })
})

describe('debug-teams.md — knowledge is orchestrator-local, not fanned to teammates', () => {
  it('debug-teams.md contains KNOWLEDGE_CONTEXT (orchestrator uses it)', () => {
    const content = loadFile('plugins/devflow-debug/commands/debug-teams.md')
    expect(content).toContain('KNOWLEDGE_CONTEXT')
  })

  it('debug-teams.md teammate spawn block does NOT pass KNOWLEDGE_CONTEXT to investigators', () => {
    const content = loadFile('plugins/devflow-debug/commands/debug-teams.md')
    const phase3 = extractSection(content, 'Phase 3: Spawn Investigation Team', '### Phase 4')
    expect(phase3).not.toContain('KNOWLEDGE_CONTEXT')
  })
})

// -------------------------------------------------------------------------
// KNOWLEDGE_CONTEXT substitution template — single canonical form
// -------------------------------------------------------------------------

describe('KNOWLEDGE_CONTEXT template — uses canonical {knowledge_context} form without fallback', () => {
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
      expect(content).not.toContain(`{knowledge_context or '(none)'}`)
      // Prose-descriptive fallback (Form B)
      expect(content).not.toMatch(/\{knowledge index from[^}]+, or \(none\)\}/)
      expect(content).not.toMatch(/\{Phase \d+ knowledge index, or \(none\)\}/)
    })
  }
})

// -------------------------------------------------------------------------
// Consumer agents — must reference devflow:apply-knowledge in skills frontmatter
// -------------------------------------------------------------------------

describe('Consumer agents — devflow:apply-knowledge in skills frontmatter', () => {
  const agents: Array<[string, string]> = [
    ['resolver.md', 'shared/agents/resolver.md'],
    ['designer.md', 'shared/agents/designer.md'],
    ['scrutinizer.md', 'shared/agents/scrutinizer.md'],
    ['reviewer.md', 'shared/agents/reviewer.md'],
  ]

  for (const [label, relPath] of agents) {
    it(`${label} references devflow:apply-knowledge in skills frontmatter`, () => {
      const content = loadFile(relPath)
      // Extract frontmatter (between first --- and second ---)
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/m)
      expect(frontmatterMatch).toBeTruthy()
      const frontmatter = frontmatterMatch![1]
      expect(frontmatter).toContain('devflow:apply-knowledge')
    })
  }

  it('simplifier.md does NOT reference devflow:apply-knowledge (code-shape role, not quality gate)', () => {
    const content = loadFile('shared/agents/simplifier.md')
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/m)
    expect(frontmatterMatch).toBeTruthy()
    const frontmatter = frontmatterMatch![1]
    expect(frontmatter).not.toContain('devflow:apply-knowledge')
  })
})

// -------------------------------------------------------------------------
// KNOWLEDGE_CONTEXT input description — canonical form across consumer agents
// -------------------------------------------------------------------------

describe('KNOWLEDGE_CONTEXT input declaration — canonical form', () => {
  const CANONICAL_DESCRIPTION =
    '**KNOWLEDGE_CONTEXT** (optional): Compact index of active ADR/PF entries for this worktree (generated by `knowledge-context.cjs index`). `(none)` when absent. Use `devflow:apply-knowledge` to Read full bodies on demand.'

  const consumerAgents: Array<[string, string]> = [
    ['resolver.md', 'shared/agents/resolver.md'],
    ['designer.md', 'shared/agents/designer.md'],
    ['scrutinizer.md', 'shared/agents/scrutinizer.md'],
    ['reviewer.md', 'shared/agents/reviewer.md'],
  ]

  for (const [label, relPath] of consumerAgents) {
    it(`${label} declares KNOWLEDGE_CONTEXT with canonical description`, () => {
      const content = loadFile(relPath)
      expect(content).toContain(CANONICAL_DESCRIPTION)
    })
  }
})

// -------------------------------------------------------------------------
// KNOWLEDGE_CONTEXT variable present in all consumer surfaces
// -------------------------------------------------------------------------

describe('KNOWLEDGE_CONTEXT variable — present in all four command surfaces', () => {
  it('plan.md contains KNOWLEDGE_CONTEXT', () => {
    expect(loadFile('plugins/devflow-plan/commands/plan.md')).toContain('KNOWLEDGE_CONTEXT')
  })

  it('self-review.md contains KNOWLEDGE_CONTEXT', () => {
    expect(loadFile('plugins/devflow-self-review/commands/self-review.md')).toContain('KNOWLEDGE_CONTEXT')
  })

  it('code-review.md contains KNOWLEDGE_CONTEXT', () => {
    expect(loadFile('plugins/devflow-code-review/commands/code-review.md')).toContain('KNOWLEDGE_CONTEXT')
  })

  it('plan:orch SKILL.md contains KNOWLEDGE_CONTEXT', () => {
    expect(loadFile('shared/skills/plan:orch/SKILL.md')).toContain('KNOWLEDGE_CONTEXT')
  })

  it('review:orch SKILL.md contains KNOWLEDGE_CONTEXT', () => {
    expect(loadFile('shared/skills/review:orch/SKILL.md')).toContain('KNOWLEDGE_CONTEXT')
  })

  it('debug:orch SKILL.md contains KNOWLEDGE_CONTEXT', () => {
    expect(loadFile('shared/skills/debug:orch/SKILL.md')).toContain('KNOWLEDGE_CONTEXT')
  })
})

// -------------------------------------------------------------------------
// Reviewer agent — apply-knowledge section references skill
// -------------------------------------------------------------------------

describe('reviewer.md — Apply Knowledge section', () => {
  it('contains Apply Knowledge section referencing devflow:apply-knowledge', () => {
    const content = loadFile('shared/agents/reviewer.md')
    expect(content).toMatch(/## Apply Knowledge|### Apply Knowledge/)
    expect(content).toContain('devflow:apply-knowledge')
  })
})

// -------------------------------------------------------------------------
// plan:orch — knowledge loading phase present
// -------------------------------------------------------------------------

describe('plan:orch — knowledge loading phase', () => {
  it('contains a knowledge-loading step (load knowledge index)', () => {
    const content = loadFile('shared/skills/plan:orch/SKILL.md')
    // Should have a phase that loads knowledge
    expect(content).toMatch(/[Ll]oad.*[Kk]nowledge|[Kk]nowledge.*[Ll]oad/i)
  })

  it('Explore spawn blocks receive KNOWLEDGE_CONTEXT', () => {
    const content = loadFile('shared/skills/plan:orch/SKILL.md')
    // The Explore phase section should mention KNOWLEDGE_CONTEXT
    const phase2 = extractSection(content, 'Phase 2: Explore', '## Phase 3')
    expect(phase2).toContain('KNOWLEDGE_CONTEXT')
  })
})

// -------------------------------------------------------------------------
// review:orch — knowledge loading phase present
// -------------------------------------------------------------------------

describe('review:orch — knowledge loading phase', () => {
  it('contains a knowledge-loading step', () => {
    const content = loadFile('shared/skills/review:orch/SKILL.md')
    expect(content).toMatch(/[Ll]oad.*[Kk]nowledge|[Kk]nowledge.*[Ll]oad/i)
  })

  it('Phase 4 Reviews section receives KNOWLEDGE_CONTEXT', () => {
    const content = loadFile('shared/skills/review:orch/SKILL.md')
    const phase4 = extractSection(content, 'Phase 4: Reviews', '## Phase 5')
    expect(phase4).toContain('KNOWLEDGE_CONTEXT')
  })
})

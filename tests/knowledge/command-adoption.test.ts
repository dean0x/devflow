import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')

function loadFile(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

/**
 * Extract a named section from markdown content.
 * Returns the content from startAnchor to endAnchor (or end of string).
 */
function extractSection(content: string, startAnchor: string, endAnchor: string | null): string {
  const start = content.indexOf(startAnchor)
  if (start === -1) throw new Error(`Anchor not found: "${startAnchor}"`)
  if (endAnchor === null) return content.slice(start)
  const end = content.indexOf(endAnchor, start + startAnchor.length)
  if (end === -1) throw new Error(`End anchor not found after "${startAnchor}": "${endAnchor}"`)
  return content.slice(start, end)
}

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
  ]

  for (const [label, relPath] of surfaces) {
    it(`${label} invokes knowledge-context.cjs index`, () => {
      const content = loadFile(relPath)
      expect(content).toContain('knowledge-context.cjs index')
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
    it(`${label} SKILL.md invokes knowledge-context.cjs index`, () => {
      const content = loadFile(relPath)
      expect(content).toContain('knowledge-context.cjs index')
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
// Consumer agents — must reference devflow:apply-knowledge in skills frontmatter
// -------------------------------------------------------------------------

describe('Consumer agents — devflow:apply-knowledge in skills frontmatter', () => {
  const agents: Array<[string, string]> = [
    ['resolver.md', 'shared/agents/resolver.md'],
    ['designer.md', 'shared/agents/designer.md'],
    ['simplifier.md', 'shared/agents/simplifier.md'],
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

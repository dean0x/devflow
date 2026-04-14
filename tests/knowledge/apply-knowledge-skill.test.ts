import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SKILL_PATH = path.join(ROOT, 'shared/skills/apply-knowledge/SKILL.md')

function loadSkill(): string {
  return readFileSync(SKILL_PATH, 'utf8')
}

// -------------------------------------------------------------------------
// File existence
// -------------------------------------------------------------------------

describe('apply-knowledge skill — file existence', () => {
  it('shared/skills/apply-knowledge/SKILL.md exists', () => {
    expect(existsSync(SKILL_PATH)).toBe(true)
  })
})

// -------------------------------------------------------------------------
// Frontmatter
// -------------------------------------------------------------------------

describe('apply-knowledge skill — frontmatter', () => {
  it('has name: apply-knowledge in frontmatter', () => {
    const content = loadSkill()
    expect(content).toMatch(/^name:\s*apply-knowledge/m)
  })

  it('has a description field in frontmatter', () => {
    const content = loadSkill()
    expect(content).toMatch(/^description:/m)
  })

  it('has allowed-tools: Read in frontmatter', () => {
    const content = loadSkill()
    expect(content).toMatch(/^allowed-tools:.*Read/m)
  })
})

// -------------------------------------------------------------------------
// 5-step algorithm markers
// -------------------------------------------------------------------------

describe('apply-knowledge skill — 5-step algorithm', () => {
  it('contains "Scan the index" step', () => {
    const content = loadSkill()
    expect(content).toMatch(/Scan the index/i)
  })

  it('contains "Identify plausibly-relevant" step', () => {
    const content = loadSkill()
    expect(content).toMatch(/Identify plausibly.?relevant/i)
  })

  it('contains "Read the full body" step', () => {
    const content = loadSkill()
    expect(content).toMatch(/Read the full body/i)
  })

  it('contains "Cite inline" step', () => {
    const content = loadSkill()
    expect(content).toMatch(/Cite inline/i)
  })

  it('contains "verbatim IDs" instruction (hallucination guard)', () => {
    const content = loadSkill()
    expect(content).toMatch(/verbatim IDs?/i)
  })
})

// -------------------------------------------------------------------------
// Worked example
// -------------------------------------------------------------------------

describe('apply-knowledge skill — worked example', () => {
  it('contains PF-004 in the worked example', () => {
    const content = loadSkill()
    expect(content).toContain('PF-004')
  })
})

// -------------------------------------------------------------------------
// Citation format
// -------------------------------------------------------------------------

describe('apply-knowledge skill — citation format', () => {
  it('specifies "applies ADR-NNN" citation format', () => {
    const content = loadSkill()
    expect(content).toContain('applies ADR-NNN')
  })

  it('specifies "avoids PF-NNN" citation format', () => {
    const content = loadSkill()
    expect(content).toContain('avoids PF-NNN')
  })
})

// -------------------------------------------------------------------------
// Skip guard
// -------------------------------------------------------------------------

describe('apply-knowledge skill — skip guard', () => {
  it('instructs to skip when KNOWLEDGE_CONTEXT is empty or "(none)"', () => {
    const content = loadSkill()
    expect(content).toMatch(/skip|omit/i)
    expect(content).toContain('(none)')
  })
})

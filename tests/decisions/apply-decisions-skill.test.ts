import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SKILL_PATH = path.join(ROOT, 'shared/skills/apply-decisions/SKILL.md')

function loadSkill(): string {
  return readFileSync(SKILL_PATH, 'utf8')
}

// -------------------------------------------------------------------------
// File existence
// -------------------------------------------------------------------------

describe('apply-decisions skill — file existence', () => {
  it('shared/skills/apply-decisions/SKILL.md exists', () => {
    expect(existsSync(SKILL_PATH)).toBe(true)
  })
})

// -------------------------------------------------------------------------
// Frontmatter
// -------------------------------------------------------------------------

describe('apply-decisions skill — frontmatter', () => {
  it('has name: apply-decisions in frontmatter', () => {
    const content = loadSkill()
    expect(content).toMatch(/^name:\s*apply-decisions/m)
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

describe('apply-decisions skill — 5-step algorithm', () => {
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

describe('apply-decisions skill — worked example', () => {
  it('contains PF-004 in the worked example', () => {
    const content = loadSkill()
    expect(content).toContain('PF-004')
  })
})

// -------------------------------------------------------------------------
// Citation format
// -------------------------------------------------------------------------

describe('apply-decisions skill — citation format', () => {
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

describe('apply-decisions skill — skip guard', () => {
  it('instructs to skip when DECISIONS_CONTEXT is empty or "(none)"', () => {
    const content = loadSkill()
    expect(content).toMatch(/skip|omit/i)
    expect(content).toContain('(none)')
  })
})

// -------------------------------------------------------------------------
// Footer-as-source-of-truth — no hardcoded paths in Step 3 or Worked Example
// -------------------------------------------------------------------------

describe('apply-decisions skill — defers to footer for file paths', () => {
  it('Step 3 instructs to use the footer, not hardcoded paths', () => {
    const content = loadSkill()
    expect(content).toMatch(/footer is the single source of truth/i)
  })

  it('Step 3 example uses {worktree-from-footer} placeholder, not hardcoded .memory/decisions/', () => {
    const content = loadSkill()
    // Step 3 section up to Step 4
    const step3 = content.slice(
      content.indexOf('### Step 3'),
      content.indexOf('### Step 4')
    )
    // Must use the footer placeholder in the example
    expect(step3).toContain('{worktree-from-footer}')
    // Must not show a bare hardcoded .memory/decisions/decisions.md arrow example
    expect(step3).not.toMatch(/^\s*\.memory\/decisions\/decisions\.md\s+→/m)
    expect(step3).not.toMatch(/^\s*\.memory\/decisions\/pitfalls\.md\s+→/m)
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { createRequire } from 'module'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SKILL_PATH = path.join(ROOT, 'src/assets/skills/apply-decisions/SKILL.md')
const DECISIONS_FORMAT = path.join(ROOT, 'src/assets/scripts/hooks/lib/decisions-format.cjs')

function loadSkill(): string {
  return readFileSync(SKILL_PATH, 'utf8')
}

/** The skill text from the `start` heading up to the `end` heading. */
function sectionOf(content: string, start: string, end: string): string {
  return content.slice(content.indexOf(start), content.indexOf(end))
}

// -------------------------------------------------------------------------
// File existence
// -------------------------------------------------------------------------

describe('apply-decisions skill — file existence', () => {
  it('src/assets/skills/apply-decisions/SKILL.md exists', () => {
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

  it('"Cite inline" confines IDs to in-session handoffs and puts words in committed or posted text', () => {
    const content = loadSkill()
    const step4 = content.slice(
      content.indexOf('### Step 4'),
      content.indexOf('### Step 5')
    )
    expect(step4).toMatch(/in-session handoffs only/)
    expect(step4).toContain('Anything committed, pushed or posted states the rule in words, never its ID')
    expect(step4).not.toMatch(/inline comments/i)
  })

  it('contains "verbatim IDs" instruction (hallucination guard)', () => {
    const content = loadSkill()
    expect(content).toMatch(/verbatim IDs?/i)
  })
})

// -------------------------------------------------------------------------
// The two index line kinds and the v2 body, as the renderer writes them
// -------------------------------------------------------------------------

describe('apply-decisions skill — v1 and v2 index lines and the v2 body', () => {
  const { buildIndexContent, formatEntryBodyV2 } = createRequire(import.meta.url)(DECISIONS_FORMAT) as {
    buildIndexContent: (
      decisions: Record<string, unknown>[],
      pitfalls: Record<string, unknown>[],
      opts: { decisionsFilePath: string, pitfallsFilePath: string },
    ) => string
    formatEntryBodyV2: (row: Record<string, unknown>) => string
  }

  // One row of each kind and type, as the ledger holds them. The anchors are
  // fixture data: the rendered lines are compared with their numbers replaced by
  // the skill's placeholder.
  const v1Decision = {
    id: 'obs_result_types', type: 'decision', anchor_id: 'ADR-001', decisions_status: 'Accepted', date: '2026-01-01',
    pattern: 'Return Result types from every fallible operation',
    details: 'context: business logic; decision: return Result; rationale: failures stay explicit',
  }
  const v2Decision = {
    schema: 2, id: 'obs_claim_by_op', type: 'decision', anchor_id: 'ADR-002', decisions_status: 'Accepted',
    title: 'Claim the learning queue with an op, never with mv',
    rule: 'Claim the queue with claim-queue.', why: 'A rename is not exclusive.',
    scope: ['src/assets/scripts/hooks/**', 'area:learning'], provenance: 'Claim-race review', last_verified: '2026-10-01',
  }
  const v1Pitfall = {
    id: 'obs_god_scripts', type: 'pitfall', anchor_id: 'PF-001', decisions_status: 'Active',
    pattern: 'Background hook god scripts',
    details: 'area: src/assets/scripts/hooks/foo.cjs; issue: one script does it all; impact: untestable; resolution: split it',
  }
  const v2Pitfall = {
    schema: 2, id: 'obs_rename_claim', type: 'pitfall', anchor_id: 'PF-002', decisions_status: 'Active',
    title: 'A rename claims a shared file only while nothing re-creates it',
    rule: 'Claim with link or an exclusive create.', why: 'mv replaces the destination.',
    scope: ['area:hooks'], provenance: 'Claim-race review',
  }

  /** The index the renderer writes for the four rows, numbers replaced by the placeholder. */
  function renderedIndexLines(): string[] {
    return buildIndexContent([v1Decision, v2Decision], [v1Pitfall, v2Pitfall], {
      decisionsFilePath: '{worktree}/.devflow/learning/decisions.md',
      pitfallsFilePath: '{worktree}/.devflow/learning/pitfalls.md',
    }).split('\n').map(line => line.replace(/\b(ADR|PF)-\d{3}\b/g, '$1-NNN'))
  }

  it('Step 1 shows each entry line and the footer exactly as the renderer writes them', () => {
    const step1 = sectionOf(loadSkill(), '### Step 1', '### Step 2')
    const lines = renderedIndexLines().filter(line => line !== '' && !/^(Decisions|Pitfalls) \(\d+\):$/.test(line))
    expect(lines.filter(line => line.startsWith('  ')), 'four entry lines rendered').toHaveLength(4)
    for (const line of lines) {
      expect(step1, line).toContain(line)
    }
  })

  it('Step 1 tags a v1 decision [Accepted] and a v1 pitfall [Active], and gives a v2 line no tag', () => {
    const entryLines = sectionOf(loadSkill(), '### Step 1', '### Step 2')
      .split('\n').filter(line => /^ {2}(ADR|PF)-NNN {2}/.test(line))
    expect(entryLines.filter(line => /^ {2}ADR-NNN .*\[Accepted\]$/.test(line))).toHaveLength(1)
    expect(entryLines.filter(line => /^ {2}PF-NNN .*\[Active\] {2}— /.test(line))).toHaveLength(1)
    expect(entryLines.filter(line => !/\[(Accepted|Active)\]/.test(line)), 'two v2 lines, untagged').toHaveLength(2)
  })

  it('Step 3 names every field a v2 body renders, for a decision and a pitfall', () => {
    const step3 = sectionOf(loadSkill(), '### Step 3', '### Step 4')
    for (const row of [v2Decision, v2Pitfall]) {
      const labels = [...formatEntryBodyV2(row).matchAll(/^- \*\*([A-Za-z]+)\*\*:/gm)].map(match => match[1])
      expect(labels.length, `${row.type} body labels`).toBeGreaterThan(0)
      for (const label of labels) {
        expect(step3, `${row.type}: ${label}`).toContain(`**${label}**`)
      }
    }
    expect(step3).toMatch(/verified/)
  })
})

// -------------------------------------------------------------------------
// Worked example
// -------------------------------------------------------------------------

describe('apply-decisions skill — worked example', () => {
  it('uses the PF-NNN placeholder in the worked example', () => {
    const content = loadSkill()
    const example = content.slice(
      content.indexOf('## Worked Example'),
      content.indexOf('## Skip Guard')
    )
    expect(example).toContain('avoids PF-NNN')
    expect(example).not.toMatch(/\b(?:ADR|PF)-[0-9]{3}\b/)
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

  it('carries placeholders only — no real ledger ID anywhere in the skill', () => {
    const content = loadSkill()
    expect(content).not.toMatch(/\b(?:ADR|PF)-[0-9]{3}\b/)
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

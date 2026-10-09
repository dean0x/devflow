import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import * as path from 'path'

import { resolveAllAgents } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SKILL_PATH = path.join(ROOT, 'src/assets/skills/apply-decisions/SKILL.md')

function loadSkill(): string {
  return readFileSync(SKILL_PATH, 'utf8')
}

/** The skill text from the `start` heading up to the `end` heading. */
function sectionOf(content: string, start: string, end: string): string {
  return content.slice(content.indexOf(start), content.indexOf(end))
}

// -------------------------------------------------------------------------
// D-APPLY-DECISIONS-NO-RENDERER-PIN
//
// This file used to pin the skill's Step 1 and Step 3 to the renderer: the four
// index lines and the footer were compared byte for byte with what
// `buildIndexContent` writes, and Step 3 had to name every label
// `formatEntryBodyV2` renders. Both were removed, with the 0.7 KB of rendered
// examples they forced the skill to carry. The skill is billed in the preload of
// every agent that takes DECISIONS_CONTEXT, and a copy of the renderer's output
// there is a second place to keep in step with it. The renderer owns the index
// and body formats, and tests/decisions/decisions-format.test.ts holds them. The
// skill now describes the index by what each line carries, which does not drift
// with a rendering detail, and no test compares the skill with the renderer.
// -------------------------------------------------------------------------

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

  it('allows exactly Read and Bash: Step 3 reads through a shell search, and no Grep tool exists beside Bash', () => {
    const content = loadSkill()
    expect(content).toMatch(/^allowed-tools: Read, Bash$/m)
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
// Step 3 — grep-then-offset reader
// -------------------------------------------------------------------------

describe('apply-decisions skill — Step 3 locates a heading by shell search and reads by offset and limit', () => {
  const step3 = (): string => sectionOf(loadSkill(), '### Step 3', '### Step 4')

  it('runs `command grep -nF` for the entry heading through Bash', () => {
    expect(step3()).toContain("command grep -nF '## ADR-NNN:' ")
    expect(step3()).toMatch(/```bash\n[^`]*command grep -nF/)
  })

  it('reads the matched section with offset and limit, and never the whole file', () => {
    expect(step3()).toMatch(/`offset`/)
    expect(step3()).toMatch(/`limit`/)
    expect(loadSkill()).not.toMatch(/\b(?:whole|entire) (?:decisions |pitfalls )?file\b/i)
  })

  it('never instructs the Grep tool: an agent with Bash is given none, and the ledger is git-ignored', () => {
    const content = loadSkill()
    expect(content).not.toMatch(/\bGrep tool\b/)
    expect(content).not.toMatch(/\ballowed-tools:.*\bGrep\b/)
    expect(content).not.toMatch(/\bGrep\(/)
  })

  it('has neither a Worked Example nor a Citation Format Reference section', () => {
    const content = loadSkill()
    expect(content).not.toContain('## Worked Example')
    expect(content).not.toContain('Citation Format Reference')
  })

  it('shows no rendered index lines: the skill describes them and copies no renderer output', () => {
    const content = loadSkill()
    expect(content).not.toMatch(/^ {2}(?:ADR|PF)-NNN {2}/m)
    expect(content).not.toContain('Decisions (N):')
    expect(content).not.toMatch(/live in \{worktree\}/)
  })

  it('stays under the 3 KB threshold the settings-hoist ticket uses for conditional preload stripping', () => {
    expect(Buffer.byteLength(loadSkill())).toBeLessThan(3072)
  })
})

// -------------------------------------------------------------------------
// Citation format
// -------------------------------------------------------------------------

describe('apply-decisions skill — citation format', () => {
  const step4 = (): string => sectionOf(loadSkill(), '### Step 4', '### Step 5')

  it('specifies "applies ADR-NNN" citation format in Step 4', () => {
    expect(step4()).toContain('applies ADR-NNN')
  })

  it('specifies "avoids PF-NNN" citation format in Step 4', () => {
    expect(step4()).toContain('avoids PF-NNN')
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
// Footer-as-source-of-truth — no hardcoded paths in Step 3
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

// -------------------------------------------------------------------------
// Every preloader can run Step 3
// -------------------------------------------------------------------------

describe('apply-decisions skill — every agent that preloads it holds Bash', () => {
  /** The `- item` lines under `key:` in an agent's frontmatter block. */
  function frontmatterList(agentSource: string, key: string): string[] {
    const lines = (agentSource.split('\n---\n')[0] ?? '').split('\n')
    const start = lines.indexOf(`${key}:`)
    if (start === -1) return []
    const items: string[] = []
    for (const line of lines.slice(start + 1)) {
      if (!line.startsWith('  - ')) break
      items.push(line.slice(4).trim())
    }
    return items
  }

  /** Named collector: agents that preload the skill and cannot run its shell search. */
  function collectBashlessPreloaders(agents: ReadonlyMap<string, { content: string }>): string[] {
    const out: string[] = []
    for (const [name, source] of agents) {
      if (!frontmatterList(source.content, 'skills').includes('devflow:apply-decisions')) continue
      const allow = frontmatterList(source.content, 'tools')
      const deny = frontmatterList(source.content, 'disallowedTools')
      const holdsBash = allow.length > 0 ? allow.includes('Bash') : !deny.includes('Bash')
      if (!holdsBash) out.push(name)
    }
    return out
  }

  it('no preloader lacks Bash', () => {
    const agents = resolveAllAgents()
    const preloaders = [...agents].filter(([, s]) => frontmatterList(s.content, 'skills').includes('devflow:apply-decisions'))
    expect(preloaders.length, 'the collector read no preloader').toBeGreaterThanOrEqual(5)
    expect(collectBashlessPreloaders(agents)).toEqual([])
  })

  it('known-bad probe: an allowlist without Bash and a denylist that names it are each reported', () => {
    const withSkill = (extra: string): { content: string } => ({
      content: `---\nname: X\nskills:\n  - devflow:apply-decisions\n${extra}\n---\nbody\n`,
    })
    expect(collectBashlessPreloaders(new Map([['allow', withSkill('tools:\n  - Read\n  - Write')]]))).toEqual(['allow'])
    expect(collectBashlessPreloaders(new Map([['deny', withSkill('disallowedTools:\n  - Bash')]]))).toEqual(['deny'])
    expect(collectBashlessPreloaders(new Map([['ok', withSkill('tools:\n  - Read\n  - Bash')]]))).toEqual([])
  })
})

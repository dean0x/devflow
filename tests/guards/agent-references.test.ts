/**
 * D-AGENT-REFS, D-MODE-BY-PATH, D-MAINTAIN-ON-DUE — an agent mode that needs a long template reads it from
 * the `agent-references` skill by explicit path, so a spawn that does not run the mode never carries it.
 *
 *   - Synthesize keeps a shared head, a mode -> file routing table, Output, Principles, Core rules and
 *     Boundaries. Its six mode templates live in `references/synthesize/{mode}.md`, and a spawn reads
 *     exactly one, named by the prompt's `Mode: <mode>` line. No `Mode:` line reads none; an unknown mode
 *     answers `BLOCKED: unknown mode` (AC-402, AC-405).
 *   - Curate keeps claim-due in its body. The maintenance ladder lives in `references/curate/maintain.md`,
 *     read only when claim-due hands out an entry (AC-403, tests/curate-agent.test.ts).
 *   - Both bodies and the largest mode reference sit under ceilings registered in
 *     tests/fixtures/numeric-floors.json (AC-401): lowered by a pass that cut text, never raised to fit text
 *     that grew back.
 *
 * The skill's own flags, its one-name `disable-model-invocation` exception and the rule that nothing
 * preloads it are held in tests/guards/skill-description-caps.test.ts (AC-404).
 */

import { describe, it, expect } from 'vitest'
import { readdirSync } from 'fs'

import {
  SYNTHESIZE_MODES, agentReferencePath, isAgentBlock, parseFences, readAgentReference,
  requireDistFile, requireDistFiles, resolveAgentSource,
} from '../helpers.js'

/** The Synthesize agent body, in bytes. Registered as `synthesize-body-max`; lowered, never raised. */
const SYNTHESIZE_BODY_MAX_BYTES = 4_070

/** The largest single Synthesize mode reference, in bytes. Registered as `synthesize-mode-ref-max`; lowered, never raised. */
const SYNTHESIZE_MODE_REF_MAX_BYTES = 3_813

/** The `/code-review` gate-level reference, in bytes. Registered as `code-review-levels-ref-max`; lowered, never raised. */
const CODE_REVIEW_LEVELS_REF_MAX_BYTES = 1_352

/** The Curate agent body, in bytes. Registered as `curate-body-max`; lowered, never raised. */
const CURATE_BODY_MAX_BYTES = 16_710

/** What each mode's reference starts with and the output template it holds. */
const MODE_TEMPLATES: Readonly<Record<string, { readonly heading: string; readonly template: string }>> = {
  'exploration': { heading: '## Mode: Exploration', template: '## Exploration Synthesis' },
  'planning': { heading: '## Mode: Planning', template: '## Planning Synthesis' },
  'review': { heading: '## Mode: Review', template: '# Code Review Summary' },
  'bug-analysis': { heading: '## Mode: Bug Analysis', template: '# Bug Analysis Summary' },
  'design': { heading: '## Mode: Design', template: '## Design Synthesis' },
  'research': { heading: '## Mode: Research', template: '# Research Summary' },
}

const REFERENCE_DIR = 'synthesize'
const ROUTE_PATH = '${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/devflow:agent-references/references/synthesize'

interface Route {
  readonly mode: string
  readonly file: string
}

/** The text of the body's `## Mode reference` section, or '' when it has none. */
function routingSection(body: string): string {
  const from = body.indexOf('\n## Mode reference\n')
  if (from === -1) return ''
  const to = body.indexOf('\n## ', from + 1)
  return body.slice(from, to === -1 ? undefined : to)
}

/** The routing table's rows, in order. */
export function collectRoutes(body: string): Route[] {
  return [...routingSection(body).matchAll(/^\| ([a-z-]+) \| `([^`]+)` \|$/gm)].map(m => ({ mode: m[1], file: m[2] }))
}

/**
 * Named collector: how Synthesize's routing falls short of "six modes, each mapped to an existing file that
 * holds its template; no template in the body; no-mode and unknown-mode rules stated".
 *
 * @param body - the Synthesize agent body
 * @param readReference - the text of `synthesize/{file}`, or null when the file does not exist
 * @param listed - the file names present in the reference directory
 */
export function collectRoutingDefects(
  body: string,
  readReference: (file: string) => string | null,
  listed: readonly string[],
): string[] {
  const out: string[] = []
  const section = routingSection(body)
  if (section === '') return ['the body has no "## Mode reference" section']

  const routes = collectRoutes(body)
  const modes = routes.map(r => r.mode)
  if (modes.join(',') !== SYNTHESIZE_MODES.join(',')) {
    out.push(`the routing table maps [${modes.join(', ')}], expected [${SYNTHESIZE_MODES.join(', ')}]`)
  }
  for (const { mode, file } of routes) {
    const expected = MODE_TEMPLATES[mode]
    if (file !== `${mode}.md`) out.push(`${mode}: routes to ${file}, expected ${mode}.md`)
    const text = readReference(file)
    if (text === null) {
      out.push(`${mode}: ${file} does not exist`)
      continue
    }
    if (expected === undefined) continue
    if (!text.startsWith(`${expected.heading}\n`)) out.push(`${mode}: ${file} does not start with "${expected.heading}"`)
    if (!text.includes(expected.template)) out.push(`${mode}: ${file} lacks its template "${expected.template}"`)
  }
  for (const file of listed) {
    if (!routes.some(r => r.file === file)) out.push(`${file}: in the reference directory but no routing row names it`)
  }
  for (const [mode, { template }] of Object.entries(MODE_TEMPLATES)) {
    if (body.includes(template)) out.push(`the body still holds the ${mode} template`)
  }
  if (/^## Mode: /m.test(body)) out.push('the body still holds a "## Mode:" section')
  if (!section.includes(ROUTE_PATH)) out.push('the section does not give the reference directory path')
  if (!section.includes('Read exactly one reference')) out.push('the section does not say to read exactly one reference')
  if (!section.includes('No `Mode:` line: read no template')) out.push('the section does not say a missing Mode line reads no template')
  if (!section.includes('answer `BLOCKED: unknown mode`')) out.push('the section does not say an unknown mode answers BLOCKED')
  return out
}

const listedFiles = (): string[] => readdirSync(agentReferencePath(REFERENCE_DIR)).sort()

const readReference = (file: string): string | null => {
  try {
    return readAgentReference(`${REFERENCE_DIR}/${file}`)
  } catch {
    return null
  }
}

describe('Synthesize routes each mode to one reference file by explicit path (AC-402, AC-405)', () => {
  const body = resolveAgentSource('synthesize').content

  it('maps all six modes to existing files that hold their templates, with no orphan file and no template left in the body', () => {
    expect(collectRoutes(body).map(r => r.mode), 'the routing table is read, so the guard is not empty').toEqual([...SYNTHESIZE_MODES])
    expect(listedFiles(), 'the reference directory is read').toHaveLength(SYNTHESIZE_MODES.length)
    expect(collectRoutingDefects(body, readReference, listedFiles())).toEqual([])
  })

  it('says a prompt with no Mode line reads no template, and an unknown mode answers BLOCKED (AC-405)', () => {
    const section = routingSection(body)
    expect(section).toContain('No `Mode:` line: read no template.')
    expect(section).toContain('A `Mode:` value that is not in the table: read nothing and answer `BLOCKED: unknown mode`.')
  })

  it('known-bad probes: a lost row, a missing file, a lost template, a template back in the body, an orphan file and lost rules are each reported', () => {
    const files = listedFiles()
    expect(collectRoutingDefects(body, readReference, files), 'the real routing is clean, so each seed fails for its own reason').toEqual([])

    const lostRow = body.replace(/^\| design \| `design\.md` \|\n/m, '')
    expect(lostRow, 'the seed must land').not.toBe(body)
    expect(collectRoutingDefects(lostRow, readReference, files)).toEqual([
      `the routing table maps [${SYNTHESIZE_MODES.filter(m => m !== 'design').join(', ')}], expected [${SYNTHESIZE_MODES.join(', ')}]`,
      'design.md: in the reference directory but no routing row names it',
    ])

    const missing = (file: string): string | null => (file === 'planning.md' ? null : readReference(file))
    expect(collectRoutingDefects(body, missing, files)).toEqual(['planning: planning.md does not exist'])

    const hollow = (file: string): string | null => (file === 'review.md' ? (readReference(file) ?? '').replace('# Code Review Summary', '# Summary') : readReference(file))
    expect(collectRoutingDefects(body, hollow, files)).toEqual(['review: review.md lacks its template "# Code Review Summary"'])

    expect(collectRoutingDefects(`${body}\n${MODE_TEMPLATES.research.template}\n`, readReference, files)).toEqual(['the body still holds the research template'])
    expect(collectRoutingDefects(body, readReference, [...files, 'stray.md'])).toEqual(['stray.md: in the reference directory but no routing row names it'])

    const noBlocked = body.replace('answer `BLOCKED: unknown mode`', 'answer nothing')
    expect(collectRoutingDefects(noBlocked, readReference, files)).toEqual(['the section does not say an unknown mode answers BLOCKED'])
    const noRule = body.replace('No `Mode:` line: read no template', 'No `Mode:` line: read the exploration template')
    expect(collectRoutingDefects(noRule, readReference, files)).toEqual(['the section does not say a missing Mode line reads no template'])
    expect(collectRoutingDefects(body.replace('\n## Mode reference\n', '\n## Modes\n'), readReference, files)).toEqual([
      'the body has no "## Mode reference" section',
    ])
  })

  it('every mode a command passes to Synthesize is one the table routes, and /explore passes exploration', () => {
    const seen: Array<{ file: string; mode: string }> = []
    for (const file of requireDistFiles()) {
      for (const fence of parseFences(requireDistFile(file))) {
        if (!isAgentBlock(fence, 'Synthesize')) continue
        for (const m of fence.matchAll(/^"?Mode: ([^\s"]+)/gm)) seen.push({ file, mode: m[1] })
      }
    }
    expect(seen.length, 'the command corpus is read: plan x4, code-review, bug-analysis and research name a mode').toBeGreaterThanOrEqual(7)
    expect(seen.filter(s => !SYNTHESIZE_MODES.includes(s.mode)), 'a mode outside the table would answer BLOCKED').toEqual([])
    const explore = requireDistFile('explore.md')
    const phase4 = explore.slice(explore.indexOf('### Phase 4: Synthesize'), explore.indexOf('### Phase 5'))
    expect(phase4, 'the /explore spawn names its mode on a `Mode:` line').toContain('`Mode: exploration`')
  })
})

/** Named collector: how a body or a reference falls short of its size ceiling. */
export function collectSizeDefects(label: string, text: string, ceiling: number): string[] {
  const bytes = Buffer.byteLength(text)
  return bytes > ceiling ? [`${label} is ${bytes} bytes, ceiling ${ceiling}`] : []
}

describe('the Synthesize and Curate bodies sit under their ceilings, and the moved text lives in the references (AC-401)', () => {
  const synthesize = resolveAgentSource('synthesize').content
  const curate = resolveAgentSource('curate').content
  const modeRefs = SYNTHESIZE_MODES.map(mode => [mode, readAgentReference(`${REFERENCE_DIR}/${mode}.md`)] as const)

  it('the Synthesize body fits `synthesize-body-max`, and every mode reference fits `synthesize-mode-ref-max`', () => {
    expect(Buffer.byteLength(synthesize), 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(3_000)
    expect(collectSizeDefects('synthesize.md', synthesize, SYNTHESIZE_BODY_MAX_BYTES)).toEqual([])
    for (const [mode, text] of modeRefs) {
      expect(Buffer.byteLength(text), `${mode}: the reference is read`).toBeGreaterThan(500)
      expect(collectSizeDefects(`${mode}.md`, text, SYNTHESIZE_MODE_REF_MAX_BYTES)).toEqual([])
    }
  })

  it('the gate-level reference fits `code-review-levels-ref-max`, and a probe one byte under its size is reported', () => {
    const ref = readAgentReference('commands/code-review-levels.md')
    expect(Buffer.byteLength(ref), 'the reference is read: the guard would pass vacuously on an empty one').toBeGreaterThan(400)
    expect(collectSizeDefects('code-review-levels.md', ref, CODE_REVIEW_LEVELS_REF_MAX_BYTES)).toEqual([])
    const bytes = Buffer.byteLength(ref)
    expect(collectSizeDefects('code-review-levels.md', ref, bytes - 1)).toEqual([`code-review-levels.md is ${bytes} bytes, ceiling ${bytes - 1}`])
  })

  it('the Curate body fits `curate-body-max`, and the maintenance ladder is in maintain.md, not the body', () => {
    expect(Buffer.byteLength(curate), 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(10_000)
    expect(collectSizeDefects('curate.md', curate, CURATE_BODY_MAX_BYTES)).toEqual([])
    const maintain = readAgentReference('curate/maintain.md')
    expect(Buffer.byteLength(maintain), 'maintain.md holds the moved ladder').toBeGreaterThan(3_000)
    expect(curate).not.toContain('the maintenance ladder')
    expect(maintain).toContain('the maintenance ladder')
  })

  it('a spawn that runs one mode loads far less than the old whole body', () => {
    const largest = Math.max(...modeRefs.map(([, text]) => Buffer.byteLength(text)))
    const oldWholeBody = Buffer.byteLength(synthesize) + modeRefs.reduce((sum, [, text]) => sum + Buffer.byteLength(text), 0)
    expect(Buffer.byteLength(synthesize) + largest, 'body plus the largest mode').toBeLessThan(oldWholeBody / 2)
  })

  it('known-bad probe: an oversize body and an exact fit are told apart', () => {
    const bytes = Buffer.byteLength(synthesize)
    expect(collectSizeDefects('synthesize.md', synthesize, bytes)).toEqual([])
    expect(collectSizeDefects('synthesize.md', synthesize, bytes - 1)).toEqual([`synthesize.md is ${bytes} bytes, ceiling ${bytes - 1}`])
  })
})

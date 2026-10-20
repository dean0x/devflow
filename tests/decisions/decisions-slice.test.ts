/**
 * D-DECISIONS-SLICE (#454, AC-301 and AC-302) — the decisions index is handed on as a slice, never whole.
 *
 * The orchestrating main model cuts the slice: it copies the index lines that touch an agent's work,
 * verbatim, behind a `(slice: N of M entries — full index: <path>)` marker and ahead of the footer.
 * Siblings over one diff share ONE slice. No script slices, so the pre-rendered index stays a plain
 * file read and judgment stays with the model. The rule is curation-on text only: a curation-off
 * machine loads no index, so its build carries no trace of it.
 *
 * What this file holds:
 *   - every compiled curation-on command that loads decisions states the rule and the pointer to the
 *     full index (fourteen hosts, counted where they are read);
 *   - the fan-out notes name ONE shared slice, and the Knowledge spawn block takes the slice for its
 *     directories;
 *   - no curation-off variant carries any of it;
 *   - `devflow:apply-decisions` lets an agent read the full index when its work leaves the slice, in
 *     the same bytes it had before (the preload ceilings in tests/guards/code-preload.test.ts hold the
 *     total).
 *
 * Every collector is run over a seeded defect (a known-bad probe) so a green result cannot come from
 * an empty corpus or a needle the text supplies unconditionally.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { requireDistFile, resolveCurationOffSource } from '../helpers.js'
import { MDS_COMMAND_HOSTS } from '../fixtures/mds-manifest.js'

const ROOT = path.resolve(import.meta.dirname, '../..')

/** The marker the rule asks for, as the compiled prose spells it. Pinned here, not read from the source. */
const MARKER = '(slice: N of M entries — full index: '
const SHARED_SLICE = 'ONE slice'
const WHEN_UNSURE = 'When unsure, include the line'
const RULE_START = 'Hand each agent that takes `DECISIONS_CONTEXT` a slice, not the whole index'
/** The sentences that carry the rule; a curation-off build holds none of them. */
const RULE_LITERALS: readonly string[] = [RULE_START, MARKER, SHARED_SLICE, WHEN_UNSURE]

/** The rule paragraph of a compiled host: from its first words to the end of the shared-slice sentence. */
function ruleOf(text: string): string {
  const from = text.indexOf(RULE_START)
  const to = text.indexOf(SHARED_SLICE, from)
  return from === -1 || to === -1 ? '' : text.slice(from, to + SHARED_SLICE.length)
}

function sourceOf(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

/** Named collector: the hosts whose text lacks one of the literals. */
function collectHostsMissing(texts: ReadonlyMap<string, string>, literals: readonly string[]): string[] {
  return [...texts]
    .flatMap(([host, text]) => literals.filter(l => !text.includes(l)).map(l => `${host}: no "${l}"`))
}

/** Named collector: the hosts whose text carries one of the literals. */
function collectHostsCarrying(texts: ReadonlyMap<string, string>, literals: readonly string[]): string[] {
  return [...texts]
    .flatMap(([host, text]) => literals.filter(l => text.includes(l)).map(l => `${host}: carries "${l}"`))
}

const onTexts = (): Map<string, string> =>
  new Map(MDS_COMMAND_HOSTS.map(h => [h, requireDistFile(`${h}.md`)] as const))

const offTexts = (): Map<string, string> =>
  new Map(MDS_COMMAND_HOSTS.map(h => [h, resolveCurationOffSource('commands', h) ?? ''] as const))

// ---------------------------------------------------------------------------
// Curation-on hosts
// ---------------------------------------------------------------------------

describe('decisions slice — every compiled curation-on host states the rule and the full-index pointer', () => {
  it('reads all fourteen command hosts', () => {
    const texts = onTexts()
    expect(texts.size).toBe(14)
    for (const [host, text] of texts) expect(text.length, `${host} compiled empty`).toBeGreaterThan(1000)
  })

  it('each host carries the marker, the shared-slice rule and the include-when-unsure rule', () => {
    expect(collectHostsMissing(onTexts(), RULE_LITERALS)).toEqual([])
  })

  it('known-bad probe: a host stripped of the marker, and one stripped of the shared-slice rule, are each reported', () => {
    const texts = onTexts()
    texts.set('release', (texts.get('release') ?? '').replaceAll(MARKER, ''))
    texts.set('plan', (texts.get('plan') ?? '').replaceAll(SHARED_SLICE, 'one slice'))
    expect(collectHostsMissing(texts, RULE_LITERALS)).toEqual([
      `plan: no "${SHARED_SLICE}"`,
      `release: no "${MARKER}"`,
    ])
  })

  it('the rule names the files and task an agent works on, and ends with the footer', () => {
    for (const [host, text] of onTexts()) {
      const rule = ruleOf(text)
      expect(rule.length, `${host}: rule paragraph`).toBeGreaterThan(200)
      expect(rule, `${host}: scope of the slice`).toContain('touch the files and task')
      expect(rule, `${host}: footer`).toContain('closed by the index footer')
    }
  })

  it('no host tells the model to run a script to cut the slice', () => {
    const noScript = /\.cjs|\bnode\b|\bbash\b|\bscript\b/i
    for (const [host, text] of onTexts()) {
      expect(ruleOf(text).length, `${host}: rule paragraph`).toBeGreaterThan(200)
      expect(ruleOf(text), `${host}: slice rule`).not.toMatch(noScript)
    }
    // Probe: the check can fail on a rule that sends the model to a script.
    expect(`${ruleOf(onTexts().get('plan') ?? '')} Run slice-index.cjs.`).toMatch(noScript)
  })
})

// ---------------------------------------------------------------------------
// Fan-out notes and the Knowledge spawn block
// ---------------------------------------------------------------------------

describe('decisions slice — fan-out notes hand siblings one shared slice', () => {
  it('code-review passes the same slice to every Review agent', () => {
    const text = requireDistFile('code-review.md')
    expect(text).toContain('Pass `DECISIONS_CONTEXT` to all Review agents as one shared slice')
  })

  it('plan passes the same slice to the Design agents of the gap-analysis phase', () => {
    const text = requireDistFile('plan.md')
    expect(text).toContain('Pass `DECISIONS_CONTEXT` to the Design agents of the gap-analysis phase as one shared slice')
  })

  it('known-bad probe: a note that passes the key with no shared-slice clause does not satisfy the check', () => {
    const note = 'Pass `DECISIONS_CONTEXT` to all Review agents as one shared slice'
    const text = requireDistFile('code-review.md')
    expect(text).toContain(note)
    expect(text.replace(note, 'Pass `DECISIONS_CONTEXT` to all Review agents')).not.toContain(note)
  })
})

describe('decisions slice — the Knowledge spawn block takes the slice for its directories', () => {
  const KNOWLEDGE_BLOCK_ANCHOR = 'DIRECTORIES: {list of primary directories touched by this workflow}'
  const SLICE_LINE = 'DECISIONS_CONTEXT: {the slice for these directories, else (none)}'
  const OLD_LINE = 'DECISIONS_CONTEXT: {DECISIONS_CONTEXT if available, else (none)}'

  it('every host that spawns Knowledge writes the slice line, and none keeps the whole-index line', () => {
    const carriers = [...onTexts()].filter(([, text]) => text.includes(KNOWLEDGE_BLOCK_ANCHOR))
    expect(carriers.length, 'hosts with a Knowledge spawn block').toBeGreaterThanOrEqual(5)
    for (const [host, text] of carriers) {
      expect(text, `${host}: slice line`).toContain(SLICE_LINE)
      expect(text, `${host}: whole-index line`).not.toContain(OLD_LINE)
    }
  })

  it('known-bad probe: a block that kept the whole-index line is told apart from one that took the slice', () => {
    const [, text] = [...onTexts()].find(([, t]) => t.includes(KNOWLEDGE_BLOCK_ANCHOR)) ?? ['', '']
    expect(text.length).toBeGreaterThan(0)
    const seeded = text.replace(SLICE_LINE, OLD_LINE)
    expect(seeded).not.toBe(text)
    expect(seeded).toContain(OLD_LINE)
    expect(seeded).not.toContain(SLICE_LINE)
  })
})

// ---------------------------------------------------------------------------
// Curation-off
// ---------------------------------------------------------------------------

describe('decisions slice — a curation-off build carries none of it', () => {
  it('reads all fourteen curation-off hosts', () => {
    const texts = offTexts()
    expect(texts.size).toBe(14)
    for (const [host, text] of texts) expect(text.length, `${host}: curation-off variant missing`).toBeGreaterThan(1000)
  })

  it('no curation-off host holds a rule literal, a marker, or a slice of the index', () => {
    expect(collectHostsCarrying(offTexts(), [...RULE_LITERALS, '(slice:', 'full index'])).toEqual([])
  })

  it('known-bad probe: the curation-on text run through the same collector is reported for every host', () => {
    expect(collectHostsCarrying(onTexts(), [MARKER]).length).toBe(14)
  })

  it('the curation-on text of each host differs from its curation-off text by the rule (the pair is not one file twice)', () => {
    const on = onTexts()
    const off = offTexts()
    for (const host of MDS_COMMAND_HOSTS) {
      expect(on.get(host), `${host}: on/off identical`).not.toBe(off.get(host))
    }
  })
})

// ---------------------------------------------------------------------------
// Source shape: one define, expanded only inside curation-on arms
// ---------------------------------------------------------------------------

describe('decisions slice — the partial states the rule once, as a leaf', () => {
  const partial = (): string => sourceOf('src/assets/commands/_partials/_decisions.mds')

  it('defines and exports decisions_slice and records D-DECISIONS-SLICE', () => {
    expect(partial()).toMatch(/^@define decisions_slice\(\):$/m)
    expect(partial()).toMatch(/^@export decisions_slice$/m)
    expect(partial()).toContain('D-DECISIONS-SLICE')
  })

  it('the leaf carries no arm of its own: it is reached from inside an arm', () => {
    const body = partial().split('@define decisions_slice():')[1]?.split('@end')[0] ?? ''
    expect(body.length, 'leaf body').toBeGreaterThan(200)
    expect(body).not.toContain('learning:')
  })

  it('decisions_load expands the leaf after the index read, inside its curation-on arm', () => {
    const load = partial().split('@define decisions_load():')[1] ?? ''
    expect(load.indexOf('<!-- curation:on -->')).toBeGreaterThan(-1)
    const read = load.indexOf('Read the pre-rendered index')
    const slice = load.indexOf('{{decisions_slice()}}')
    expect(read).toBeGreaterThan(-1)
    expect(slice).toBeGreaterThan(read)
    expect(slice).toBeLessThan(load.indexOf('<!-- curation:end -->'))
  })

  it('every other expansion sits inside an on arm too', () => {
    for (const rel of ['src/assets/commands/release.mds', 'src/assets/commands/_partials/_preamble.mds']) {
      const text = sourceOf(rel)
      const at = text.search(/\{\{(?:decisions\.)?decisions_slice\(\)\}\}/)
      expect(at, `${rel}: expansion`).toBeGreaterThan(-1)
      const before = text.slice(0, at)
      expect(before.lastIndexOf('<!-- curation:on -->'), `${rel}: arm opens before`).toBeGreaterThan(before.lastIndexOf('<!-- curation:end -->'))
      expect(before.lastIndexOf('<!-- curation:on -->'), `${rel}: no off arm between`).toBeGreaterThan(before.lastIndexOf('<!-- curation:off -->'))
    }
  })
})

// ---------------------------------------------------------------------------
// apply-decisions: the slice allowance, at no extra preload cost
// ---------------------------------------------------------------------------

describe('decisions slice — apply-decisions lets an agent read the full index when its work leaves the slice', () => {
  const skill = (): string => sourceOf('src/assets/skills/apply-decisions/SKILL.md')

  /** Named collector: where the skill fails to allow a full-index read outside the slice. */
  function collectSkillDefects(text: string): string[] {
    const ironLaw = text.slice(text.indexOf('## Iron Law'), text.indexOf('## 5-Step Algorithm'))
    const step1 = text.slice(text.indexOf('### Step 1'), text.indexOf('### Step 2'))
    const out: string[] = []
    if (!ironLaw.includes('DECISIONS_CONTEXT may be a slice')) out.push('Iron Law: no slice allowance')
    if (!ironLaw.includes("read the full index at the named path only when your work leaves the slice's scope")) {
      out.push('Iron Law: no full-index fallback')
    }
    if (!step1.includes('(slice: N of M entries — full index: <path>)')) out.push('Step 1: no marker')
    return out
  }

  it('the Iron Law allows the read and Step 1 names the marker', () => {
    expect(collectSkillDefects(skill())).toEqual([])
  })

  it('known-bad probe: a skill without the allowance and one without the marker are each reported', () => {
    const text = skill()
    expect(collectSkillDefects(text.replace('DECISIONS_CONTEXT may be a slice', 'DECISIONS_CONTEXT is whole'))).toEqual([
      'Iron Law: no slice allowance',
    ])
    expect(collectSkillDefects(text.replace('(slice: N of M entries — full index: <path>)', 'a marker'))).toEqual([
      'Step 1: no marker',
    ])
  })

  it('the full-index read stays a fallback: the lookup in Step 3 still names the footer as the path authority', () => {
    expect(skill()).toMatch(/footer is the single source of truth/i)
  })
})

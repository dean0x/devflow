/**
 * tests/evidence/release-trace-parity.test.ts
 *
 * AC-4 (SDLC-evidence PR5, #364): release-trace.cjs decides which commits are
 * TRACED with its own copy of the closing-keyword rule, the three history
 * grammars and the message field it scans (`%B`, #376 S1), while the Git agent
 * reads the same rules out of the built
 * gather-release-evidence references. Two copies agree only until one is edited,
 * so every literal the script exports is compared here with the literal the
 * built reference states — and the two line grammars the gather step and
 * /release parse (`LAST_TAG …`, `TRACE from:…`) are compared with the script's
 * own line regexes by field order and by instantiation.
 *
 * Built artifacts are read, never sources: the MDS escaping of `\(` and `\]` is
 * the kind of defect only the emitted bytes show (PF-018). Every comparison runs
 * through one named collector, which the known-bad probes drive with a drifted
 * reference (PF-064).
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import * as path from 'path'

import { RELEASE_TRACE_SCRIPT } from './seam.js'
import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { requireDistFile } from '../helpers.js'

type Grammar = 'github' | 'jira' | 'linear'

/** Transcribed from the script's exports. Open release-trace.cjs before changing this. */
interface ReleaseTraceLiterals {
  readonly KEYWORD_RE: RegExp
  readonly TRAILING_CLASS: string
  readonly MESSAGE_LOG_FLAGS: readonly string[]
  readonly GRAMMARS: Readonly<Record<Grammar, RegExp>>
  readonly TRACE_HEADER_RE: RegExp
  readonly LAST_TAG_LINE_RE: RegExp
}

const SCRIPT = createRequire(import.meta.url)(RELEASE_TRACE_SCRIPT) as ReleaseTraceLiterals
const PROVIDERS: readonly Grammar[] = ['github', 'jira', 'linear']

function gatherRef(provider: Grammar): string {
  const file = path.join(compiledSkillRefsDir(), 'tracker', provider, 'gather-release-evidence.md')
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`${file} is absent — run \`npm run build\` first (this guard reads built artifacts)`)
  }
}

// ---------------------------------------------------------------------------
// Collectors — each reads one literal out of a built text, or null
// ---------------------------------------------------------------------------

/** Named collector: step 3a's keyword regex and trailing-strip class. */
export function collectKeywordRule(text: string): { keyword: string; trailingClass: string } | null {
  const step = text.split('\n').find(line => line.startsWith('3a. **Closing-keyword rule.**'))
  const keyword = step?.match(/whitespace token matching `([^`]+)`/)?.[1]
  const trailingClass = step?.match(/every trailing character in `(\[[^`]+\])`/)?.[1]
  return keyword && trailingClass ? { keyword, trailingClass } : null
}

/**
 * Named collector: the `git log --format=` field step 3a reads each message as —
 * "Read each message as `git log --format=%B` lines." — or null.
 */
export function collectMessageField(text: string): string | null {
  const step = text.split('\n').find(line => line.startsWith('3a. **Closing-keyword rule.**'))
  return step?.match(/[Rr]ead each message as `git log --format=(%[A-Za-z])` lines/)?.[1] ?? null
}

/** The field the script's message log scans for references: the last one before its `%x1e` record end. */
export function scriptMessageField(flags: readonly string[]): string | null {
  const format = flags.find(f => f.startsWith('--format='))
  return format?.match(/%x00(%[A-Za-z])%x1e$/)?.[1] ?? null
}

/**
 * Named collector: the anchored history grammar GitHub's step 3b and Jira's step 4
 * state — "**…history grammar** is `^…$`".
 */
export function collectHistoryGrammar(text: string): string | null {
  return text.match(/history grammar\*\* is `(\^[^`]+\$)`/)?.[1] ?? null
}

/**
 * Named collector, dedicated to Linear: its grammar line reads "**This provider's
 * history grammar is the TEAM-KEY form only** — `^…$`", which the collector above
 * does not match, because the bold closes after "only" rather than after "grammar".
 */
export function collectLinearHistoryGrammar(text: string): string | null {
  return text.match(/history grammar is the TEAM-KEY form only\*\* — `(\^[^`]+\$)`/)?.[1] ?? null
}

const GRAMMAR_COLLECTORS: Readonly<Record<Grammar, (text: string) => string | null>> = {
  github: collectHistoryGrammar,
  jira: collectHistoryGrammar,
  linear: collectLinearHistoryGrammar,
}

/** Named collector: the `TRACE from:<ref> …` line template a text states, or null. */
export function collectTraceTemplate(text: string): string | null {
  return text.match(/`(TRACE from:<ref>[^`]*)`/)?.[1] ?? null
}

/** Field keys of a `KEY:<value>` template, in order. */
function templateKeys(template: string): string[] {
  return [...template.matchAll(/([a-z]+):</g)].map(m => m[1])
}

/** Named-group keys of a RegExp source, in order. */
function groupKeys(re: RegExp): string[] {
  return [...re.source.matchAll(/\(\?<(\w+)>/g)].map(m => m[1])
}

/** Instantiate a template's placeholders with a value the script's grammar admits. */
function instantiate(template: string): string {
  return template.replace('<ref>', 'v1.2.3').replace('<tag>', 'v1.2.3').replace('<ok|hit>', 'ok').replace(/<n>/g, '0')
}

/**
 * Named collector: every place the script's literals and the built references
 * disagree, as report lines. An empty result is parity.
 */
export function collectParityDrift(script: ReleaseTraceLiterals, refs: Readonly<Record<Grammar, string>>): string[] {
  const drift: string[] = []
  for (const p of PROVIDERS) {
    const rule = collectKeywordRule(refs[p])
    if (rule === null) {
      drift.push(`${p}: step 3a or its literals are missing`)
    } else {
      if (rule.keyword !== script.KEYWORD_RE.source) drift.push(`${p}: keyword ${rule.keyword} ≠ KEYWORD_RE ${script.KEYWORD_RE.source}`)
      if (rule.trailingClass !== script.TRAILING_CLASS) drift.push(`${p}: trailing class ${rule.trailingClass} ≠ TRAILING_CLASS ${script.TRAILING_CLASS}`)
    }
    const field = collectMessageField(refs[p])
    if (field === null || field !== scriptMessageField(script.MESSAGE_LOG_FLAGS)) {
      drift.push(`${p}: step 3a reads messages as ${field} ≠ the script's ${scriptMessageField(script.MESSAGE_LOG_FLAGS)}`)
    }
    const grammar = GRAMMAR_COLLECTORS[p](refs[p])
    if (grammar !== script.GRAMMARS[p].source) drift.push(`${p}: history grammar ${grammar} ≠ GRAMMARS.${p} ${script.GRAMMARS[p].source}`)
  }
  if (script.KEYWORD_RE.flags !== 'i') drift.push(`KEYWORD_RE flags ${script.KEYWORD_RE.flags} ≠ i (step 3a is case-insensitive, nothing else)`)
  return drift
}

/** Named collector: texts whose `TRACE` template names other fields than TRACE_HEADER_RE, or does not instantiate into it. */
export function collectHeaderDrift(script: ReleaseTraceLiterals, texts: readonly { label: string; text: string }[]): string[] {
  const keys = groupKeys(script.TRACE_HEADER_RE)
  const drift: string[] = []
  for (const { label, text } of texts) {
    const template = collectTraceTemplate(text)
    if (template === null) {
      drift.push(`${label}: no \`TRACE from:<ref> …\` template`)
      continue
    }
    if (JSON.stringify(templateKeys(template)) !== JSON.stringify(keys)) drift.push(`${label}: fields ${templateKeys(template).join(',')} ≠ ${keys.join(',')}`)
    if (!script.TRACE_HEADER_RE.test(instantiate(template))) drift.push(`${label}: ${instantiate(template)} is not a TRACE header`)
  }
  return drift
}

const builtRefs = (): Record<Grammar, string> => ({ github: gatherRef('github'), jira: gatherRef('jira'), linear: gatherRef('linear') })

// ---------------------------------------------------------------------------
// The arms
// ---------------------------------------------------------------------------

describe('AC-4: release-trace.cjs and the built gather references state one rule', () => {
  it('reads every literal out of the shipped tree (the comparison is not vacuous)', () => {
    for (const p of PROVIDERS) {
      expect(collectKeywordRule(gatherRef(p)), `${p}: step 3a`).not.toBeNull()
      expect(GRAMMAR_COLLECTORS[p](gatherRef(p)), `${p}: history grammar`).not.toBeNull()
      expect(collectMessageField(gatherRef(p)), `${p}: step 3a's message format`).toBe('%B')
    }
    expect(SCRIPT.KEYWORD_RE.source.length).toBeGreaterThan(20)
    expect(scriptMessageField(SCRIPT.MESSAGE_LOG_FLAGS), 'the script scans the full message').toBe('%B')
  })

  it('the keyword rule, the trailing class and all three grammars are equal', () => {
    expect(collectParityDrift(SCRIPT, builtRefs())).toEqual([])
  })

  it('step 6 in every reference and /release name the TRACE header\'s fields, in the script\'s order', () => {
    expect(groupKeys(SCRIPT.TRACE_HEADER_RE)).toEqual(['from', 'scanned', 'traced', 'untraced', 'exempt', 'unmatched', 'bound'])
    const texts = [
      ...PROVIDERS.map(p => ({ label: `tracker/${p}/gather-release-evidence.md`, text: gatherRef(p) })),
      { label: 'commands/release.md', text: requireDistFile('release.md') },
    ]
    expect(collectHeaderDrift(SCRIPT, texts)).toEqual([])
  })

  it('step 1a names both LAST_TAG line forms the script prints', () => {
    for (const p of PROVIDERS) {
      const step = gatherRef(p).split('\n').find(line => line.startsWith('1a. '))
      expect(step, `${p}: step 1a`).toBeDefined()
      for (const form of ['LAST_TAG <tag>', 'LAST_TAG none']) {
        expect(step, `${p}: ${form}`).toContain(`\`${form}\``)
        expect(SCRIPT.LAST_TAG_LINE_RE.test(instantiate(form)), `${form} instantiated`).toBe(true)
      }
    }
  })
})

describe('AC-4: known-bad probes — a drifted reference is reported by the same collectors', () => {
  it('a drifted keyword in one provider is reported for that provider only', () => {
    const refs = builtRefs()
    const drifted = { ...refs, jira: refs.jira.replace('resolve[sd]?|refs)', 'resolve[sd]?|ref)') }
    expect(drifted.jira, 'the seed must land').not.toBe(refs.jira)
    const drift = collectParityDrift(SCRIPT, drifted)
    expect(drift).toHaveLength(1)
    expect(drift[0]).toMatch(/^jira: keyword/)
  })

  it('a drifted grammar, and a Linear line the generic collector cannot read, are reported', () => {
    const refs = builtRefs()
    // A function replacement: a `$` followed by a backtick in a replacement STRING is a
    // special pattern, and would splice the text before the match into the seed.
    const drifted = { ...refs, github: refs.github.replace('`^#[1-9][0-9]{0,8}$`', () => '`^#[0-9]{1,9}$`') }
    expect(collectParityDrift(SCRIPT, drifted)).toEqual([`github: history grammar ^#[0-9]{1,9}$ ≠ GRAMMARS.github ${SCRIPT.GRAMMARS.github.source}`])
    // Why Linear has its own collector: the generic one reads nothing there.
    expect(collectHistoryGrammar(refs.linear)).toBeNull()
    expect(collectLinearHistoryGrammar(refs.github)).toBeNull()
  })

  it('step 3a reading another field than the script scans is reported for that provider only (S1)', () => {
    const refs = builtRefs()
    const drifted = { ...refs, linear: refs.linear.replace('`git log --format=%B` lines', '`git log --format=%s` lines') }
    expect(drifted.linear, 'the seed must land').not.toBe(refs.linear)
    expect(collectParityDrift(SCRIPT, drifted)).toEqual(['linear: step 3a reads messages as %s ≠ the script\'s %B'])
    expect(scriptMessageField(['--format=%H%x00%an%x00%ae%x00%s%x00%b%x1e']), 'a %b script is read as %b').toBe('%b')
  })

  it('a TRACE template missing a field, or reordered, is reported', () => {
    const release = requireDistFile('release.md')
    const missing = release.replace(' unmatched:<n>', '')
    const reordered = release.replace('traced:<n> untraced:<n>', 'untraced:<n> traced:<n>')
    expect(missing, 'the seed must land').not.toBe(release)
    expect(collectHeaderDrift(SCRIPT, [{ label: 'probe', text: missing }])).toHaveLength(2)
    expect(collectHeaderDrift(SCRIPT, [{ label: 'probe', text: reordered }])).toHaveLength(2)
    expect(collectHeaderDrift(SCRIPT, [{ label: 'probe', text: 'no template here' }])).toEqual(['probe: no `TRACE from:<ref> …` template'])
  })
})

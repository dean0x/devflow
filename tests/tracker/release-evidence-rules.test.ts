/**
 * gather-release-evidence — the closing-keyword rule (G2) and the merged-PR
 * listing (G1), executed and structurally pinned (#359).
 *
 * G2. The candidate parse used to full-match whitespace tokens after three
 * keywords, so `Closes #12.`, `fixes #3,` and `(closes #4)` produced nothing, and
 * `close/closed/fix/fixed/resolve/resolves/resolved` were not keywords at all. The
 * rule now lives once in `_common.mds` as step 3a of every provider's reference.
 * This file READS the keyword regex and the trailing-strip class out of the BUILT
 * reference and RUNS the procedure the step states — a hand-copied regex here would
 * be a second authority that agrees with the shipped one only until one is edited
 * (PF-018), and the MDS escaping of `\(` and `\]` in prose is exactly the kind of
 * defect only an executing reader sees.
 *
 * G1. A squash-merged PR's commit rarely carries a closing keyword, so the only
 * record of which issue it closed is the PR's `closingIssuesReferences`. The GitHub
 * mechanics now read them from ONE merged-PR listing, map PRs into the range
 * locally, render each number `#{n}` before the gate, and report what the listing
 * could not cover instead of calling an empty result "empty, not degraded".
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { resolveAgentSource } from '../helpers.js'

const REFS_DIR = compiledSkillRefsDir()
const PROVIDERS = ['github', 'jira', 'linear'] as const

function requireRef(rel: string): string {
  const file = path.join(REFS_DIR, ...rel.split('/'))
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`${rel} is absent — run \`npm run build\` first (this guard reads built artifacts)`)
  }
}

const gatherRef = (provider: string): string =>
  requireRef(`tracker/${provider}/gather-release-evidence.md`)

/** Named collector: the step-3a line of a gather reference, or null when absent. */
export function collectClosingKeywordStep(text: string): string | null {
  return text.split('\n').find(line => line.startsWith('3a. **Closing-keyword rule.**')) ?? null
}

/** The two literals the procedure needs, read out of the step's own code spans. */
interface ClosingKeywordRule {
  readonly keyword: string
  readonly trailingClass: string
}

/** Named collector: the keyword regex and the trailing-strip class a step-3a line states. */
export function parseClosingKeywordRule(step: string): ClosingKeywordRule | null {
  const keyword = step.match(/whitespace token matching `([^`]+)`/)?.[1]
  const trailingClass = step.match(/every trailing character in `(\[[^`]+\])`/)?.[1]
  return keyword && trailingClass ? { keyword, trailingClass } : null
}

/**
 * Step 3a, executed: the candidates a text yields under a rule.
 *
 * Bounded by the input's own token count — every loop below walks a finite array
 * forward and never re-enters.
 */
export function extractCandidates(text: string, rule: ClosingKeywordRule): string[] {
  const keyword = new RegExp(rule.keyword, 'i')
  const trailing = new RegExp(`${rule.trailingClass}+$`)
  const candidates: string[] = []
  for (const line of text.split('\n')) {
    const tokens = line.split(/\s+/).filter(Boolean)
    for (let i = 0; i < tokens.length; i++) {
      if (!keyword.test(tokens[i])) continue
      for (let j = i + 1; j < tokens.length; j++) {
        for (const part of tokens[j].split(',')) {
          const stripped = part.replace(/^\(/, '').replace(trailing, '')
          if (stripped !== '') candidates.push(stripped)
        }
        if (!tokens[j].endsWith(',')) break
      }
    }
  }
  return candidates
}

/** Named collector: the anchored history grammar a gather reference states. */
export function collectHistoryGrammar(text: string): string | null {
  return text.match(/history grammar\*\* is `(\^[^`]+\$)`/)?.[1] ?? null
}

/** Step 5's gate: the provider grammar, anchored, plus KEY equality where the grammar is KEY-N. */
function gate(candidates: readonly string[], grammar: string, projectKey?: string): string[] {
  const re = new RegExp(grammar)
  return candidates.filter(c => re.test(c) && (projectKey === undefined || c.split('-')[0] === projectKey))
}

const RULE = (() => {
  const step = collectClosingKeywordStep(gatherRef('github'))
  const parsed = step === null ? null : parseClosingKeywordRule(step)
  if (parsed === null) throw new Error('github gather-release-evidence: step 3a or its literals are missing')
  return parsed
})()

const GITHUB_GRAMMAR = collectHistoryGrammar(gatherRef('github'))
const JIRA_GRAMMAR = collectHistoryGrammar(gatherRef('jira'))

/** The accept/reject table. `expected` is what survives step 5's gate. */
const CASES: ReadonlyArray<{ readonly text: string; readonly provider: 'github' | 'jira'; readonly expected: readonly string[] }> = [
  // Accepted — every one of these was dropped by the pre-#359 whitespace full-match.
  { text: 'Closes #12.', provider: 'github', expected: ['#12'] },
  { text: 'fixes #12,', provider: 'github', expected: ['#12'] },
  { text: '(Resolves #12)', provider: 'github', expected: ['#12'] },
  { text: 'Closes: #12', provider: 'github', expected: ['#12'] },
  { text: 'Closes #1, #2', provider: 'github', expected: ['#1', '#2'] },
  { text: 'Refs KEY-9;', provider: 'jira', expected: ['KEY-9'] },
  // Rejected — by the gate, or because no keyword precedes the token.
  { text: 'Closes #12abc', provider: 'github', expected: [] },
  { text: 'Closes owner/repo#12', provider: 'github', expected: [] },
  { text: 'bare #12', provider: 'github', expected: [] },
  { text: 'prefixes #12', provider: 'github', expected: [] },
  { text: 'Merge pull request #12 from owner/branch', provider: 'github', expected: [] },
]

describe('G2: the closing-keyword rule, executed from the built reference', () => {
  it('reads non-empty literals and both grammars out of the shipped tree', () => {
    expect(RULE.keyword.startsWith('^') && RULE.keyword.endsWith('$'), 'the keyword regex is anchored')
      .toBe(true)
    expect(RULE.trailingClass, 'the MDS build must emit the class with its escaped bracket intact')
      .toBe('[.,;:)\\]!?]')
    expect(GITHUB_GRAMMAR, 'github 3b must state an anchored grammar').toBe('^#[1-9][0-9]{0,8}$')
    expect(JIRA_GRAMMAR, 'jira must state its anchored KEY-N grammar').not.toBeNull()
  })

  it('accepts and rejects exactly per the table', () => {
    const wrong: string[] = []
    for (const { text, provider, expected } of CASES) {
      const grammar = provider === 'github' ? GITHUB_GRAMMAR! : JIRA_GRAMMAR!
      const got = gate(extractCandidates(text, RULE), grammar, provider === 'jira' ? 'KEY' : undefined)
      if (JSON.stringify(got) !== JSON.stringify(expected)) {
        wrong.push(`${JSON.stringify(text)} (${provider}): got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`)
      }
    }
    expect(wrong, `closing-keyword outcomes the shipped rule does not produce:\n  ${wrong.join('\n  ')}`).toEqual([])
  })

  it('every keyword form is admitted, and a keyword-shaped substring is not', () => {
    const keyword = new RegExp(RULE.keyword, 'i')
    for (const word of ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved', 'refs', 'Closes:', '(fixes']) {
      expect(keyword.test(word), `${word} must be a closing keyword`).toBe(true)
    }
    for (const word of ['prefixes', 'fixture', 'closest', 'ref', 'resolver']) {
      expect(keyword.test(word), `${word} must not be a closing keyword`).toBe(false)
    }
  })

  it('states the rule byte-identically in all three providers, and names no grammar in it', () => {
    const steps = PROVIDERS.map(p => collectClosingKeywordStep(gatherRef(p)))
    expect(steps.every(s => s !== null), 'every provider reference must carry step 3a').toBe(true)
    expect(new Set(steps).size, 'one author: the three step-3a lines must be byte-identical').toBe(1)
    expect(steps[0], 'the shared rule lands in jira/linear too — it must carry no `#` grammar').not.toMatch(/#/)
  })

  it('known-bad probe: the pre-#359 rule rejects `Closes #12.`, which the shipped rule accepts', () => {
    // The retired procedure: whitespace tokens, three keywords, full-match `#[0-9]+`.
    const retired = (text: string): string[] => {
      const out: string[] = []
      for (const line of text.split('\n')) {
        const tokens = line.split(/\s+/).filter(Boolean)
        tokens.forEach((t, i) => {
          if (['refs', 'closes', 'fixes'].includes(t.toLowerCase()) && i + 1 < tokens.length) out.push(tokens[i + 1])
        })
      }
      return out.filter(c => /^#[0-9]+$/.test(c))
    }
    expect(retired('Closes #12.'), 'the retired rule is the defect this file exists for').toEqual([])
    expect(gate(extractCandidates('Closes #12.', RULE), GITHUB_GRAMMAR!)).toEqual(['#12'])
    // …and the collector reports a reference that lost its step.
    expect(collectClosingKeywordStep('### Process\n4. Resolve.\n')).toBeNull()
    expect(parseClosingKeywordRule('3a. **Closing-keyword rule.** no literals here')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// G1 — one merged-PR listing, rendered `#{n}`, with its honest statuses.
// ---------------------------------------------------------------------------

/** Named collector: listing calls that carry no explicit `--limit N` bound. */
export function collectUnboundedListings(text: string): string[] {
  return text.split('\n').filter(line => /gh pr list\b/.test(line) && !/--limit \d+/.test(line))
}

/** Named collector: `gh pr view` fallback lines that state no `≤N` bound. */
export function collectUnboundedFallbacks(text: string): string[] {
  return text.split('\n').filter(line => /gh pr view\b/.test(line) && !/≤\d+/.test(line))
}

describe('G1: the GitHub merged-PR listing', () => {
  const text = gatherRef('github')

  it('resolves the range with exactly one bounded listing', () => {
    const listings = text.split('\n').filter(line => /gh pr list\b/.test(line))
    expect(listings, 'one listing line, not one call per commit').toHaveLength(1)
    expect(listings[0]).toContain('closingIssuesReferences')
    expect(listings[0]).toContain('mergeCommit')
    expect(collectUnboundedListings(text)).toEqual([])
    expect(text, 'the aliased per-commit GraphQL batch is retired').not.toContain('associatedPullRequests')
  })

  it('renders every merged-PR number `#{n}` before the gate', () => {
    expect(text).toContain('renders every number it reads from a merged PR as `#{n}` before step 5\'s gate')
  })

  it('reports what the listing could not answer instead of an empty "not degraded"', () => {
    expect(text).toContain('`TRACEABILITY: DEGRADED (merged-PR listing did not cover the range)`')
    expect(text).toContain('`INDETERMINATE (merged-PR listing hit its 200 cap)`')
    expect(text, 'a foreign reference is the canonical reason, not a shipped issue')
      .toContain('`TRACEABILITY: DEGRADED (foreign issue reference {ref})`')
  })

  it('keeps a bounded fallback for a gh that cannot list the field', () => {
    const fallbacks = text.split('\n').filter(line => /gh pr view\b/.test(line))
    expect(fallbacks, 'the listing-failure fallback must exist').toHaveLength(1)
    expect(collectUnboundedFallbacks(text)).toEqual([])
    expect(fallbacks[0]).toContain('THROTTLED ({n} not processed)')
  })

  it('the agent reports the new status and reads the flagged-empty case', () => {
    const git = resolveAgentSource('git').content
    expect(git).toContain('### Status: READY | DEGRADED ({reason}) | INDETERMINATE ({reason})')
    expect(git).toContain('unless the Mechanics flag merged PRs they could not resolve')
  })

  it('known-bad probe: an unbounded listing and an unbounded fallback are both reported', () => {
    expect(collectUnboundedListings('- `gh pr list --state merged --json number,closingIssuesReferences`'))
      .toHaveLength(1)
    expect(collectUnboundedFallbacks('- fall back to `gh pr view N --json closingIssuesReferences` for every PR'))
      .toHaveLength(1)
  })
})

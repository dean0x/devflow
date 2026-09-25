/**
 * tests/evidence/trust-rule.test.ts
 *
 * SDLC-evidence PR4 (#363), phase P3 — AC-7: the trust rule has ONE prose
 * statement, the generated `references/trust-rule.md` (`_references.mds` define
 * `trust_rule()`), and ONE implementation, `trust()` / `permissionLookups()` in
 * pr-evidence.cjs.
 *
 *   PARITY       every term the document states equals the script constant that
 *                implements it — associations, permissions, the role mapping,
 *                the login grammar, the lookup cap, the `[bot]` suffix, the fork
 *                clause, the viewer arm — and the script names no term the
 *                document leaves out.
 *   BEHAVIOUR    trust() is driven with the document's OWN terms, so the prose
 *                and the code cannot agree on words and disagree on outcomes.
 *   ONE STATEMENT no other installed prompt file states the rule.
 *
 * The constants are required from the script, never transcribed: a hand-copied
 * list is a second authority that agrees with the first only until one of them
 * is edited. Every guard has a named collector, a non-empty-corpus assertion and a
 * known-bad probe through the same collector (PF-064).
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import {
  gitAgentSinkCorpus,
  requireDistFiles,
  resolveAllAgents,
  ROOT,
  walkFiles,
  type CorpusEntry,
} from '../helpers.js'
import { PR_EVIDENCE_SCRIPT } from './seam.js'

interface Actor {
  readonly login: string
  readonly association: string
}

interface TrustCtx {
  readonly viewer: string
  readonly prAuthor: string
  readonly isCrossRepository: boolean | undefined
  readonly permissions: ReadonlyMap<string, string | null>
}

/** Only what this suite reads from the script. */
interface TrustExports {
  readonly TRUSTED_ASSOCIATIONS: readonly string[]
  readonly TRUSTED_PERMISSIONS: readonly string[]
  readonly LOGIN_RE: RegExp
  readonly LIMITS: Readonly<{ TRUST_LOOKUPS: number }>
  trust(actor: Actor, ctx: TrustCtx): boolean
  permissionLookups(actors: readonly Actor[], ctx: TrustCtx): readonly string[]
}

const PE = createRequire(import.meta.url)(PR_EVIDENCE_SCRIPT) as TrustExports

const DOC_NAME = 'trust-rule.md'

function requireTrustRule(): string {
  const file = path.join(compiledSkillRefsDir(), DOC_NAME)
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`${DOC_NAME} is absent — run \`npm run build\` first (this suite reads the built document)`)
  }
}

// ---------------------------------------------------------------------------
// Collectors over the document
// ---------------------------------------------------------------------------

/** The terms the document states, parsed from its own bullets. Null = the term is absent. */
interface TrustTerms {
  readonly associations: readonly string[] | null
  readonly permissions: readonly string[] | null
  /** Role → what the permission endpoint prints for it. */
  readonly roles: ReadonlyMap<string, string>
  readonly loginPattern: string | null
  readonly cap: number | null
  readonly viewerAlways: boolean
  readonly botSuffix: boolean
  readonly forkClause: boolean
  readonly lookup: boolean
}

/** The bullet that opens with `- **<label>:**`, or null. */
function bullet(doc: string, label: string): string | null {
  return doc.split('\n').find(line => line.startsWith(`- **${label}:**`)) ?? null
}

/** Every backticked token in a span. */
function codeSpans(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map(m => m[1])
}

/** Named collector: the terms the trust document states. */
export function collectTrustTerms(doc: string): TrustTerms {
  const trusted = bullet(doc, 'Trusted') ?? ''
  const never = bullet(doc, 'The association arm never trusts') ?? ''
  const bounded = bullet(doc, 'Bounded') ?? ''

  const assoc = /`authorAssociation` is (.+?) \*\*and\*\*/.exec(trusted)
  const perms = /--jq \.permission` prints (.+?)\./.exec(trusted)
  const roles = new Map<string, string>()
  for (const m of trusted.matchAll(/`([a-z]+)` role prints `([a-z]+)`/g)) roles.set(m[1], m[2])
  for (const m of trusted.matchAll(/`([a-z]+)` and `([a-z]+)` print `([a-z]+)`/g)) {
    roles.set(m[1], m[3])
    roles.set(m[2], m[3])
  }
  const login = codeSpans(never).find(span => span.startsWith('^') && span.endsWith('$')) ?? null
  const cap = /at most (\d+) in total/.exec(bounded)

  return {
    associations: assoc === null ? null : codeSpans(assoc[1]),
    permissions: perms === null ? null : codeSpans(perms[1]),
    roles,
    loginPattern: login,
    cap: cap === null ? null : Number(cap[1]),
    viewerAlways: trusted.startsWith('- **Trusted:** `VIEWER_LOGIN` always;'),
    botSuffix: codeSpans(never).includes('[bot]'),
    forkClause: never.includes('the PR author when `isCrossRepository`'),
    lookup: trusted.includes('`gh api "repos/{owner}/{repo}/collaborators/{login}/permission" --jq .permission`'),
  }
}

/** Named collector: every term on which the document and the script disagree. */
export function collectTrustRuleDisagreements(terms: TrustTerms, exports: TrustExports): string[] {
  const out: string[] = []
  const same = (a: readonly string[] | null, b: readonly string[]): boolean =>
    a !== null && a.length === b.length && a.every((v, i) => v === b[i])

  if (!same(terms.associations, exports.TRUSTED_ASSOCIATIONS)) {
    out.push(`associations: document ${JSON.stringify(terms.associations)} ≠ TRUSTED_ASSOCIATIONS ${JSON.stringify(exports.TRUSTED_ASSOCIATIONS)}`)
  }
  if (!same(terms.permissions, exports.TRUSTED_PERMISSIONS)) {
    out.push(`permissions: document ${JSON.stringify(terms.permissions)} ≠ TRUSTED_PERMISSIONS ${JSON.stringify(exports.TRUSTED_PERMISSIONS)}`)
  }
  // The role mapping: a role the document says prints a trusted permission must be
  // trusted BY WHAT IT PRINTS, never by its own name — trust() refuses a literal
  // `maintain`, because the endpoint never returns one.
  if (terms.roles.size === 0) out.push('roles: the document maps no role to what the endpoint prints')
  for (const [role, prints] of terms.roles) {
    if (role !== prints && exports.TRUSTED_PERMISSIONS.includes(role)) {
      out.push(`roles: \`${role}\` prints \`${prints}\`, but TRUSTED_PERMISSIONS names \`${role}\` itself`)
    }
  }
  if (terms.loginPattern !== exports.LOGIN_RE.source) {
    out.push(`login grammar: document ${JSON.stringify(terms.loginPattern)} ≠ LOGIN_RE ${JSON.stringify(exports.LOGIN_RE.source)}`)
  }
  if (terms.cap !== exports.LIMITS.TRUST_LOOKUPS) {
    out.push(`lookup cap: document ${terms.cap} ≠ LIMITS.TRUST_LOOKUPS ${exports.LIMITS.TRUST_LOOKUPS}`)
  }
  if (!terms.viewerAlways) out.push('viewer arm: the document does not open with `VIEWER_LOGIN` always')
  if (!terms.botSuffix) out.push('bot exclusion: the document does not name `[bot]`')
  if (!terms.forkClause) out.push('fork exclusion: the document does not exclude the PR author by `isCrossRepository`')
  if (!terms.lookup) out.push('lookup: the document does not state the permission endpoint')
  return out
}

// ---------------------------------------------------------------------------
// PARITY
// ---------------------------------------------------------------------------

describe('AC-7: trust-rule.md and trust() state the same rule', () => {
  const doc = requireTrustRule()

  it('the document is the built one and carries every bullet the parity reads', () => {
    expect(doc.startsWith('## Trust rule\n'), 'the generated document must open with its own heading').toBe(true)
    for (const label of ['Trusted', 'The association arm never trusts', 'Bounded']) {
      expect(bullet(doc, label), `the document must carry its "${label}" bullet`).not.toBeNull()
    }
    const terms = collectTrustTerms(doc)
    expect(terms.associations?.length ?? 0, 'no association parsed — parity would compare nothing').toBeGreaterThan(0)
    expect(terms.permissions?.length ?? 0, 'no permission parsed').toBeGreaterThan(0)
    expect(terms.roles.size, 'no role mapping parsed').toBeGreaterThan(0)
  })

  it('every term equals the script constant that implements it', () => {
    expect(collectTrustRuleDisagreements(collectTrustTerms(doc), PE)).toEqual([])
  })

  it('known-bad probe: a document that drops COLLABORATOR is reported', () => {
    const seeded = doc.replace('`OWNER`, `MEMBER` or `COLLABORATOR`', '`OWNER` or `MEMBER`')
    expect(seeded, 'the seed must land').not.toBe(doc)
    expect(collectTrustRuleDisagreements(collectTrustTerms(seeded), PE)).toEqual([
      `associations: document ["OWNER","MEMBER"] ≠ TRUSTED_ASSOCIATIONS ["OWNER","MEMBER","COLLABORATOR"]`,
    ])
  })

  it('known-bad probe: a script that trusts the literal `maintain` is reported', () => {
    const widened: TrustExports = { ...PE, TRUSTED_PERMISSIONS: [...PE.TRUSTED_PERMISSIONS, 'maintain'] }
    expect(collectTrustRuleDisagreements(collectTrustTerms(doc), widened)).toEqual([
      `permissions: document ["admin","write"] ≠ TRUSTED_PERMISSIONS ["admin","write","maintain"]`,
      'roles: `maintain` prints `write`, but TRUSTED_PERMISSIONS names `maintain` itself',
    ])
  })

  it('known-bad probe: a raised cap, a widened login grammar and a dropped [bot] clause are each reported', () => {
    const seeded = doc
      .replace('at most 20 in total', 'at most 25 in total')
      .replace('{0,38}', '{0,39}')
      .replace('a login ending in `[bot]`; ', '')
    expect(collectTrustRuleDisagreements(collectTrustTerms(seeded), PE)).toEqual([
      `login grammar: document "^[A-Za-z0-9][A-Za-z0-9-]{0,39}$" ≠ LOGIN_RE "${PE.LOGIN_RE.source}"`,
      `lookup cap: document 25 ≠ LIMITS.TRUST_LOOKUPS ${PE.LIMITS.TRUST_LOOKUPS}`,
      'bot exclusion: the document does not name `[bot]`',
    ])
  })

  it('known-bad probe: a viewer arm the fork clause can bind is reported', () => {
    const seeded = doc.replace('`VIEWER_LOGIN` always; otherwise', '`VIEWER_LOGIN`, or')
    expect(seeded, 'the seed must land').not.toBe(doc)
    expect(collectTrustRuleDisagreements(collectTrustTerms(seeded), PE)).toEqual([
      'viewer arm: the document does not open with `VIEWER_LOGIN` always',
    ])
  })
})

// ---------------------------------------------------------------------------
// BEHAVIOUR — trust() driven by the document's own terms
// ---------------------------------------------------------------------------

describe('AC-7: trust() does what the document says, term by term', () => {
  const terms = collectTrustTerms(requireTrustRule())
  const associations = terms.associations ?? []
  const permissions = terms.permissions ?? []
  const base = (over: Partial<TrustCtx> = {}): TrustCtx => ({
    viewer: 'me',
    prAuthor: 'author',
    isCrossRepository: false,
    permissions: new Map(),
    ...over,
  })

  it('the document supplies terms to drive with', () => {
    expect(associations.length).toBeGreaterThan(0)
    expect(permissions.length).toBeGreaterThan(0)
  })

  it('every stated association with every stated permission is trusted', () => {
    for (const association of associations) {
      for (const permission of permissions) {
        const ctx = base({ permissions: new Map([['alice', permission]]) })
        expect(PE.trust({ login: 'alice', association }, ctx), `${association} + ${permission}`).toBe(true)
      }
    }
  })

  it('a role the document maps to a lower print is untrusted by what it prints', () => {
    for (const [role, prints] of terms.roles) {
      const ctx = base({ permissions: new Map([['alice', prints]]) })
      expect(
        PE.trust({ login: 'alice', association: associations[0] ?? '' }, ctx),
        `${role} prints ${prints}`,
      ).toBe(permissions.includes(prints))
    }
  })

  it('any other association is untrusted with no lookup', () => {
    const ctx = base({ permissions: new Map([['alice', 'admin']]) })
    for (const association of ['CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'NONE', 'MANNEQUIN']) {
      expect(associations).not.toContain(association)
      expect(PE.trust({ login: 'alice', association }, ctx), association).toBe(false)
      expect(PE.permissionLookups([{ login: 'alice', association }], ctx), `${association} is never looked up`).toEqual([])
    }
  })

  it('the association arm never trusts a [bot] login, a login outside the grammar, or a fork author', () => {
    const owner = associations[0] ?? ''
    const admin = (login: string): TrustCtx => base({ permissions: new Map([[login, 'admin']]) })
    expect(PE.trust({ login: 'ci[bot]', association: owner }, admin('ci[bot]'))).toBe(false)
    expect(PE.trust({ login: '-alice', association: owner }, admin('-alice'))).toBe(false)
    for (const isCrossRepository of [true, undefined]) {
      const fork = base({ isCrossRepository, permissions: new Map([['author', 'admin']]) })
      expect(PE.trust({ login: 'author', association: owner }, fork), `fork = ${String(isCrossRepository)}`).toBe(false)
    }
  })

  it('VIEWER_LOGIN is trusted always — even as a fork PR\'s author — and never looked up', () => {
    const fork = base({ viewer: 'author', isCrossRepository: true })
    expect(PE.trust({ login: 'author', association: 'NONE' }, fork)).toBe(true)
    expect(PE.permissionLookups([{ login: 'me', association: associations[0] ?? '' }], base())).toEqual([])
  })

  it('at most the stated cap is looked up, and a login past it is untrusted', () => {
    const cap = terms.cap ?? 0
    expect(cap).toBeGreaterThan(0)
    const actors = Array.from({ length: cap + 1 }, (_, i) => ({ login: `m${i}`, association: associations[0] ?? '' }))
    const looked = PE.permissionLookups(actors, base())
    expect(looked).toHaveLength(cap)
    const permissionsMap = new Map(looked.map(login => [login, permissions[0] ?? '']))
    const ctx = base({ permissions: permissionsMap })
    expect(PE.trust(actors[cap - 1], ctx), 'the last login inside the cap').toBe(true)
    expect(PE.trust(actors[cap], ctx), 'the first login past the cap').toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ONE STATEMENT — no other installed prompt file states the rule
// ---------------------------------------------------------------------------

/**
 * The shapes a restatement takes: the trusted-association triple in any order of
 * separators, or the permission endpoint. Either is the rule's substance; a file
 * carrying one outside the document is a second statement nothing pins to trust().
 */
const RESTATEMENT_SHAPES: readonly RegExp[] = [
  /`OWNER`[^\n]{0,40}`MEMBER`[^\n]{0,40}`COLLABORATOR`/,
  /collaborators\/\\?\{login\\?\}\/permission/,
]

/** Named collector: installed prompt files other than the document that restate the rule. */
export function collectTrustRestatements(corpus: readonly CorpusEntry[]): string[] {
  return corpus
    .filter(entry => path.basename(entry.path) !== DOC_NAME)
    .filter(entry => RESTATEMENT_SHAPES.some(shape => shape.test(entry.content)))
    .map(entry => path.relative(ROOT, entry.path))
}

/** Every installed prompt surface the Git agent or a command can read. */
function promptCorpus(): CorpusEntry[] {
  const distCommands = path.join(ROOT, 'dist', 'commands')
  const skills = path.join(ROOT, 'src', 'assets', 'skills')
  const byPath = new Map<string, CorpusEntry>()
  const add = (entry: CorpusEntry): void => { byPath.set(entry.path, entry) }
  for (const entry of gitAgentSinkCorpus()) add(entry)
  for (const agent of resolveAllAgents().values()) add({ path: agent.path, content: agent.content })
  for (const name of requireDistFiles()) {
    const file = path.join(distCommands, name)
    add({ path: file, content: readFileSync(file, 'utf-8') })
  }
  for (const file of walkFiles(skills, f => f.endsWith('.md'))) add({ path: file, content: readFileSync(file, 'utf-8') })
  return [...byPath.values()]
}

describe('AC-7: the trust rule has one prose statement', () => {
  const corpus = promptCorpus()

  it('the corpus reaches the document, the PR-host tree, the agents, the commands and the skills', () => {
    const rel = corpus.map(e => path.relative(ROOT, e.path).split(path.sep).join('/'))
    expect(rel.some(r => r.endsWith(`references/${DOC_NAME}`)), 'the document itself').toBe(true)
    expect(rel.some(r => r.includes('references/pr/fetch-review-threads.md')), 'the op that applies it').toBe(true)
    expect(rel.some(r => r.startsWith('dist/commands/')), 'compiled commands').toBe(true)
    expect(rel.some(r => r.startsWith('src/assets/skills/')), 'skills').toBe(true)
    expect(rel.some(r => r.startsWith('src/assets/agents/')), 'hand-authored agents').toBe(true)
    expect(
      corpus.filter(e => path.basename(e.path) === DOC_NAME).every(e => RESTATEMENT_SHAPES.every(s => s.test(e.content))),
      'every shape must match the document itself — otherwise the scan cannot see a restatement either',
    ).toBe(true)
  })

  it('no file but the document states it', () => {
    expect(collectTrustRestatements(corpus)).toEqual([])
  })

  it('known-bad probe: the 660edc1 step 2 — the rule inline in the PR-host op — is reported', () => {
    const inline =
      '2. **Trusted first-comment author:** `VIEWER_LOGIN` always; otherwise `authorAssociation` `OWNER`, ' +
      '`MEMBER` or `COLLABORATOR` — never for the PR author when `isCrossRepository` is true.\n'
    const seeded = corpus.map(e =>
      e.path.endsWith(path.join('references', 'pr', 'fetch-review-threads.md')) ? { ...e, content: e.content + inline } : e)
    expect(collectTrustRestatements(seeded)).toEqual([
      path.relative(ROOT, path.join(compiledSkillRefsDir(), 'pr', 'fetch-review-threads.md')),
    ])
  })
})

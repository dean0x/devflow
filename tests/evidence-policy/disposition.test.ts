/**
 * The evidence-policy DISPOSITION table, held two ways (#362, AC-8).
 *
 * Design §6 disposes of every site that used to key on compliance: each one now
 * gates on a mechanism input (`ISSUE_REQUIRED`, `APPLY_CONVENTIONS`,
 * `REQUIRE_NON_AUTHOR_APPROVAL`), on `EVIDENCE_POLICY` itself at a caller, or
 * stays on `COMPLIANCE_SKILL_INSTALLED` because it is the review lens rather than
 * evidence. `DISPOSITION` below is that table as data.
 *
 *   Direction 1  every row's sites are where the table says, and each located
 *                line carries the phrase that states its gate — its canonical
 *                `only when …` clause, its spawn-fence key, or its Input
 *                declaration.
 *   Direction 2  every condition-shaped mention of the five gate names in the
 *                built agent, references and commands is one of those sites,
 *                exactly once. A gate the table does not govern is a policy
 *                nobody reviewed.
 *
 * Rows 9 and 12 still gate on `COMPLIANCE_SKILL_INSTALLED` at this commit; later
 * commits of #362 move them to `EVIDENCE_POLICY` and re-point their sites here.
 * Row 13's op side is the `stub` publication value, which names no gate, so it is
 * held by direction 1 alone.
 *
 * ORCHESTRATOR DECISIONS encoded as their own arms (user-confirmed 2026-09-25):
 * /code-review and /bug-analysis never gate on a ticket under either policy —
 * they create or ensure the PR exactly as they did — and /implement is the only
 * command that records an evidence exception.
 *
 * NOT covered (PF-064): a gate spelled in synonyms ("for regulated projects
 * only"), a conditional clause more than 80 characters before the name, and gates
 * outside the three built surfaces (skills, rules, other agents). A clean result
 * means none of the collected shapes is ungoverned — not that no other gate exists.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { requireDistFiles, requireDistFile, walkFiles } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const REFS_DIR = compiledSkillRefsDir()

/** The five names a gate can key on. */
const GATE_NAMES = [
  'EVIDENCE_POLICY',
  'ISSUE_REQUIRED',
  'APPLY_CONVENTIONS',
  'REQUIRE_NON_AUTHOR_APPROVAL',
  'COMPLIANCE_SKILL_INSTALLED',
] as const
type GateName = (typeof GATE_NAMES)[number]

/** What a row gates on: a gate name, or — for row 13's op side — the `stub` value a caller passes. */
type GateInput = GateName | 'stub'

/** The canonical spellings (design §3, "Canonical gate phrases"): one each, so guards can collect them. */
const gate = (name: GateName): string => `only when \`${name}\` is \`true\``
/** The caller-side policy gate — the one canonical phrase that keys on `EVIDENCE_POLICY` itself. */
const policyGate = 'only when `EVIDENCE_POLICY` is `required`'
const fenceKey = (name: GateName): string => `${name}: {${name}}`
const recipeKey = (name: GateName): string => `${name}: \${${name}}`
const recipeConst = (name: GateName): string => `const ${name} = `
const declared = (name: GateName): string => `\`${name}\``

/**
 * One gated line: `file` (relative to `dist/`), located as the first line holding
 * `anchor` at or after the first line holding `after` (or from the top), and
 * required to carry `phrase`. `after` exists because two gated lines can be
 * byte-identical in one file — /resolve skips Phase 1b and Phase 9c with the same
 * sentence — and a site must name one of them.
 */
interface Site {
  readonly file: string
  readonly anchor: string
  readonly phrase: string
  readonly after?: string
}

interface DispositionRow {
  readonly row: number
  readonly subject: string
  readonly inputs: readonly GateInput[]
  /** Behaviour when the input is on (`true`, `required`, or the skill installed). */
  readonly on: string
  /** Behaviour when it is off. */
  readonly off: string
  readonly sites: readonly Site[]
}

const PROVIDERS = ['github', 'jira', 'linear'] as const
const setupTask = (p: string): string => `skills/git/references/tracker/${p}/setup-task.md`

const DISPOSITION: readonly DispositionRow[] = [
  {
    row: 1,
    subject: 'setup-task step 1b — the branch convention',
    inputs: ['APPLY_CONVENTIONS'],
    on: 'read the convention; learn and commit it when absent',
    off: 'never read, learned or committed',
    sites: PROVIDERS.map(p => ({ file: setupTask(p), anchor: '1b. **Branch convention:**', phrase: gate('APPLY_CONVENTIONS') })),
  },
  {
    row: 2,
    subject: 'setup-task step 1c — issue-first',
    inputs: ['ISSUE_REQUIRED'],
    on: 'create or find the issue (DEGRADED ⇒ /implement asks)',
    off: 'skip; an explicitly passed ticket is still linked by step 1',
    sites: PROVIDERS.map(p => ({ file: setupTask(p), anchor: '1c. Issue-first', phrase: gate('ISSUE_REQUIRED') })),
  },
  {
    row: 3,
    subject: 'ensure-pr-ready step 4c — the conventions retitle — and its Input',
    inputs: ['APPLY_CONVENTIONS'],
    on: 'retitle to the recorded convention',
    off: 'no retitle',
    sites: [
      { file: 'skills/git/references/pr/ensure-pr-ready.md', anchor: '4c. ', phrase: gate('APPLY_CONVENTIONS') },
      { file: 'agents/git.md', after: '## Operation: ensure-pr-ready', anchor: '**Input:**', phrase: declared('APPLY_CONVENTIONS') },
    ],
  },
  {
    row: 4,
    subject: 'setup-task Input',
    inputs: ['ISSUE_REQUIRED', 'APPLY_CONVENTIONS'],
    on: 'passed by every caller',
    off: 'passed by every caller',
    sites: [
      {
        file: 'agents/git.md',
        after: '## Operation: setup-task',
        anchor: '- `ISSUE_REQUIRED`, `APPLY_CONVENTIONS`:',
        phrase: `${declared('ISSUE_REQUIRED')}, ${declared('APPLY_CONVENTIONS')}`,
      },
    ],
  },
  {
    row: 5,
    subject: '/implement setup-task spawn',
    inputs: ['ISSUE_REQUIRED', 'APPLY_CONVENTIONS'],
    on: 'forward the resolved inputs',
    off: 'forward the resolved inputs',
    sites: [
      { file: 'commands/implement.md', anchor: fenceKey('ISSUE_REQUIRED'), phrase: fenceKey('ISSUE_REQUIRED') },
      { file: 'commands/implement.md', anchor: fenceKey('APPLY_CONVENTIONS'), phrase: fenceKey('APPLY_CONVENTIONS') },
    ],
  },
  {
    row: 6,
    subject: '/dynamic-build recipe setup-task call (headless; blocks nothing)',
    inputs: ['ISSUE_REQUIRED', 'APPLY_CONVENTIONS'],
    on: 'forward the resolved inputs',
    off: 'forward the resolved inputs',
    sites: [
      { file: 'commands/dynamic-build.md', anchor: recipeConst('ISSUE_REQUIRED'), phrase: recipeConst('ISSUE_REQUIRED') },
      { file: 'commands/dynamic-build.md', anchor: recipeConst('APPLY_CONVENTIONS'), phrase: recipeConst('APPLY_CONVENTIONS') },
      { file: 'commands/dynamic-build.md', anchor: recipeKey('ISSUE_REQUIRED'), phrase: recipeKey('ISSUE_REQUIRED') },
      { file: 'commands/dynamic-build.md', anchor: recipeKey('APPLY_CONVENTIONS'), phrase: recipeKey('APPLY_CONVENTIONS') },
    ],
  },
  {
    row: 7,
    subject: '/code-review, /bug-analysis PR creation (ensure-pr-ready)',
    inputs: ['APPLY_CONVENTIONS'],
    on: 'create as today; retitle per the recorded convention',
    off: 'create as today',
    sites: [
      { file: 'commands/code-review.md', anchor: fenceKey('APPLY_CONVENTIONS'), phrase: fenceKey('APPLY_CONVENTIONS') },
      { file: 'commands/bug-analysis.md', anchor: fenceKey('APPLY_CONVENTIONS'), phrase: fenceKey('APPLY_CONVENTIONS') },
    ],
  },
  {
    row: 8,
    subject: 'review lens — compliance review focus and compliance Design agent',
    inputs: ['COMPLIANCE_SKILL_INSTALLED'],
    on: 'add the compliance lens',
    off: 'no compliance lens',
    sites: [
      { file: 'commands/code-review.md', anchor: '| COMPLIANCE_SKILL_INSTALLED AND diff touches', phrase: 'COMPLIANCE_SKILL_INSTALLED AND' },
      { file: 'commands/code-review.md', anchor: 'If `COMPLIANCE_SKILL_INSTALLED` AND the diff', phrase: 'If `COMPLIANCE_SKILL_INSTALLED` AND' },
      { file: 'commands/plan.md', anchor: '**Single-issue**: Spawn 4 Design agents', phrase: '5 when COMPLIANCE_SKILL_INSTALLED' },
      { file: 'commands/plan.md', anchor: '| compliance | Regulatory gaps', phrase: 'only when COMPLIANCE_SKILL_INSTALLED' },
      { file: 'commands/plan.md', anchor: '**Multi-issue**: Spawn 6 Design agents', phrase: '7 when COMPLIANCE_SKILL_INSTALLED' },
      { file: 'commands/plan.md', anchor: 'Design agent: compliance (', phrase: 'only when COMPLIANCE_SKILL_INSTALLED' },
    ],
  },
  {
    // §6 row 9 → EVIDENCE_POLICY in P3.
    row: 9,
    subject: '/plan tracker issue',
    inputs: ['COMPLIANCE_SKILL_INSTALLED'],
    on: 'mandatory (DEGRADED exempt with a warning)',
    off: 'ask the user',
    sites: [
      { file: 'commands/plan.md', anchor: 'When `COMPLIANCE_SKILL_INSTALLED` is true, issue linking', phrase: 'When `COMPLIANCE_SKILL_INSTALLED` is true' },
      { file: 'commands/plan.md', anchor: 'When `COMPLIANCE_SKILL_INSTALLED` is false, issue linking', phrase: 'When `COMPLIANCE_SKILL_INSTALLED` is false' },
    ],
  },
  {
    row: 10,
    subject: '/resolve Phase 1b and Step 9b-1 — external review threads',
    inputs: ['EVIDENCE_POLICY'],
    on: 'fetch and resolve external threads',
    off: 'skip; the resolution summary still posts',
    sites: [
      { file: 'commands/resolve.md', after: '### Phase 1b:', anchor: 'Run this phase only when', phrase: policyGate },
      { file: 'commands/resolve.md', after: '**Step 9b-1', anchor: 'Run this step only when', phrase: policyGate },
      { file: 'commands/resolve.md', anchor: '_(Omit `## Third-Party Threads`', phrase: 'unless `EVIDENCE_POLICY` is `required`' },
      { file: 'commands/resolve.md', after: '## Edge Cases', anchor: '| `EVIDENCE_POLICY` is `standard` |', phrase: '`EVIDENCE_POLICY` is `standard`' },
    ],
  },
  {
    // Caller-side only: check-merge-readiness is unchanged and takes no new input in #362.
    row: 11,
    subject: '/resolve Phase 9c — merge readiness',
    inputs: ['REQUIRE_NON_AUTHOR_APPROVAL'],
    on: 'report merge readiness',
    off: 'skip; report SKIPPED',
    sites: [
      { file: 'commands/resolve.md', after: '### Phase 9c:', anchor: 'Run this phase only when', phrase: gate('REQUIRE_NON_AUTHOR_APPROVAL') },
      { file: 'commands/resolve.md', after: '## Edge Cases', anchor: '| `REQUIRE_NON_AUTHOR_APPROVAL` is `false` |', phrase: '`REQUIRE_NON_AUTHOR_APPROVAL` is `false`' },
    ],
  },
  {
    // §6 row 12 → EVIDENCE_POLICY in P3.
    row: 12,
    subject: '/release evidence, conventions and back-link',
    inputs: ['COMPLIANCE_SKILL_INSTALLED'],
    on: 'gather evidence and back-link shipped issues',
    off: 'skip both',
    sites: [
      { file: 'commands/release.md', anchor: '2b. **Gather release evidence**', phrase: 'compliance-gated: only when COMPLIANCE_SKILL_INSTALLED' },
      { file: 'commands/release.md', anchor: '4. **Tag and GitHub Release**', phrase: 'when COMPLIANCE_SKILL_INSTALLED' },
      { file: 'commands/release.md', anchor: '4b. **Back-link shipped issues**', phrase: 'compliance-gated: only when COMPLIANCE_SKILL_INSTALLED' },
    ],
  },
  {
    // The caller side (a resolved `off` becomes `stub` under the policy) lands in P3.
    row: 13,
    subject: 'publication `stub` — the op side',
    inputs: ['stub'],
    on: 'mode STUB, no probe; report STUB (evidence policy)',
    off: 'mode STUB, no probe; report STUB (evidence policy)',
    sites: [
      { file: 'skills/git/references/publication-gate.md', anchor: '   - `stub` (never unrecognised)', phrase: 'report `STUB (evidence policy)`' },
      { file: 'agents/git.md', after: '## Operation: post-review-summary', anchor: '**Input:**', phrase: '| `off` | `stub`;' },
      { file: 'agents/git.md', after: '## Operation: post-review-summary', anchor: '**Publication**:', phrase: '| STUB (evidence policy)' },
      { file: 'agents/git.md', after: '## Operation: post-resolution-summary', anchor: '**Input:**', phrase: '| `off` | `stub`;' },
      { file: 'agents/git.md', after: '## Operation: post-resolution-summary', anchor: '**Publication**:', phrase: '| STUB (evidence policy)' },
    ],
  },
]

// ---------------------------------------------------------------------------
// The corpus and the collector
// ---------------------------------------------------------------------------

/** One built file, by its path relative to `dist/`. */
interface BuiltFile {
  readonly file: string
  readonly content: string
}

/** Built git.md, every generated reference, and every compiled command. */
function builtCorpus(): BuiltFile[] {
  const distRoot = path.join(ROOT, 'dist')
  const rel = (f: string): string => path.relative(distRoot, f).split(path.sep).join('/')
  const gitMd = path.join(distRoot, 'agents', 'git.md')
  const refs = walkFiles(REFS_DIR, f => f.endsWith('.md'))
  const read = (f: string): string => {
    try {
      return readFileSync(f, 'utf-8')
    } catch {
      throw new Error(`${rel(f)} is absent — run \`npm run build\` first (this guard reads built artifacts)`)
    }
  }
  return [
    { file: 'agents/git.md', content: read(gitMd) },
    ...refs.map(f => ({ file: rel(f), content: read(f) })),
    ...requireDistFiles().map(name => ({ file: `commands/${name}`, content: requireDistFile(name) })),
  ]
}

const NAME_ALT = `(?:${GATE_NAMES.join('|')})`
const NAME_RE = new RegExp(`\\b${NAME_ALT}\\b`, 'g')

/**
 * The shapes a gate takes. A line mentioning a gate name in any of these is a
 * gated site; a bare mention (a Produces line, a diagram label, the prose that
 * says which inputs a step passes) is not.
 */
const CONDITION_SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
  ['spawn-fence key', new RegExp(`^[ \\t]*"?${NAME_ALT}:\\s`)],
  ['recipe constant', new RegExp(`\\b(?:const|let|var)\\s+${NAME_ALT}\\s*=`)],
  ['op Input line', new RegExp(`^\\*\\*Input:\\*\\*.*\`${NAME_ALT}\``)],
  ['op Input bullet', new RegExp(`^- \`${NAME_ALT}\``)],
  ['clause before the name', new RegExp(`\\b(?:if|when|unless|only when|regardless of|skip|gated (?:on|by))\\b[^\\n]{0,80}?\\b${NAME_ALT}\\b`, 'i')],
  ['state after the name', new RegExp(`\\b${NAME_ALT}\\b\`?\\s*(?:\\?|AND\\b|is\\b|false\\b|true\\b|===)`)],
]

/** The body of `@define {name}():` … `@end` in an MDS source, braces unescaped as the compiler emits them. */
function defineLines(sourcePath: string, name: string): string[] {
  const source = readFileSync(path.join(ROOT, sourcePath), 'utf-8')
  const open = `@define ${name}():\n`
  const start = source.indexOf(open)
  const end = source.indexOf('\n@end', start)
  if (start === -1 || end === -1) throw new Error(`${sourcePath}: no \`@define ${name}()\` block`)
  return source.slice(start + open.length, end).replace(/\\([{}])/g, '$1').split('\n')
}

/**
 * NOT A GATE: the resolution text of the two command partials. They SET the
 * names ("Accept the output only when it is exactly two lines …", "Set
 * `COMPLIANCE_SKILL_INSTALLED = true` if the file exists"), they gate nothing,
 * and they are byte-pinned by their own guards. Exempted by exact line equality
 * with the define bodies, so no other line can hide behind the exemption.
 */
function resolutionLines(): ReadonlySet<string> {
  return new Set([
    ...defineLines('src/assets/commands/_partials/_evidence_policy.mds', 'evidence_policy'),
    ...defineLines('src/assets/commands/_partials/_compliance.mds', 'compliance_gate'),
  ].filter(l => l.trim() !== ''))
}

interface GatedLine {
  readonly file: string
  readonly index: number
  readonly text: string
  readonly names: readonly GateName[]
}

/** Named collector: every condition-shaped mention of a gate name in the corpus. */
export function collectGatedSites(corpus: readonly BuiltFile[], exempt: ReadonlySet<string>): GatedLine[] {
  const out: GatedLine[] = []
  for (const { file, content } of corpus) {
    content.split('\n').forEach((text, index) => {
      const names = [...new Set(text.match(NAME_RE) ?? [])] as GateName[]
      if (names.length === 0 || exempt.has(text)) return
      if (CONDITION_SHAPES.some(([, re]) => re.test(text))) out.push({ file, index, text, names })
    })
  }
  return out
}

/** The line index a site names, or -1. */
function locate(site: Site, content: string): number {
  const lines = content.split('\n')
  const from = site.after === undefined ? 0 : lines.findIndex(l => l.includes(site.after!))
  if (from === -1) return -1
  for (let i = from; i < lines.length; i++) if (lines[i].includes(site.anchor)) return i
  return -1
}

/** Named collector (direction 1): sites that are missing, or whose line does not carry its phrase. */
export function collectSiteDefects(rows: readonly DispositionRow[], corpus: readonly BuiltFile[]): string[] {
  const out: string[] = []
  for (const row of rows) {
    for (const site of row.sites) {
      const where = `row ${row.row} ${site.file}${site.after ? ` (after "${site.after}")` : ''}`
      const file = corpus.find(f => f.file === site.file)
      if (file === undefined) {
        out.push(`${where}: file not in the corpus`)
        continue
      }
      const at = locate(site, file.content)
      if (at === -1) {
        out.push(`${where}: no line holds "${site.anchor}"`)
        continue
      }
      const line = file.content.split('\n')[at]
      if (!line.includes(site.phrase)) out.push(`${where}:${at + 1}: does not carry "${site.phrase}"`)
    }
  }
  return out
}

/**
 * Named collector (direction 2): gated lines that map to no row, or to more than
 * one site, or that name a gate their row does not declare.
 */
export function collectUngovernedGates(
  rows: readonly DispositionRow[],
  corpus: readonly BuiltFile[],
  gated: readonly GatedLine[],
): string[] {
  const located = rows.flatMap(row =>
    row.sites.map(site => {
      const file = corpus.find(f => f.file === site.file)
      return { row, file: site.file, index: file === undefined ? -1 : locate(site, file.content) }
    }))
  const out: string[] = []
  for (const g of gated) {
    const owners = located.filter(s => s.file === g.file && s.index === g.index)
    const where = `${g.file}:${g.index + 1}: ${g.text.trim().slice(0, 100)}`
    if (owners.length === 0) out.push(`${where} — gates on ${g.names.join(', ')} and no DISPOSITION row governs it`)
    else if (owners.length > 1) out.push(`${where} — claimed by ${owners.length} sites (rows ${owners.map(o => o.row.row).join(', ')})`)
    else {
      const foreign = g.names.filter(n => !owners[0].row.inputs.includes(n))
      if (foreign.length > 0) out.push(`${where} — row ${owners[0].row.row} does not gate on ${foreign.join(', ')}`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The arms
// ---------------------------------------------------------------------------

describe('evidence-policy disposition: the table and the tree agree, both ways (AC-8)', () => {
  const corpus = builtCorpus()
  const exempt = resolutionLines()
  const gated = collectGatedSites(corpus, exempt)

  it('the corpus holds git.md, the references and the commands, and the collector finds gates in each', () => {
    const files = corpus.map(f => f.file)
    expect(files).toContain('agents/git.md')
    expect(files).toContain('skills/git/references/tracker/github/setup-task.md')
    expect(files).toContain('commands/implement.md')
    expect(files.filter(f => f.startsWith('commands/')).length, 'every compiled command').toBe(requireDistFiles().length)
    for (const prefix of ['agents/', 'skills/git/references/', 'commands/']) {
      expect(gated.some(g => g.file.startsWith(prefix)), `no gated line found under ${prefix}`).toBe(true)
    }
    expect(exempt.size, 'the resolution text the exemption names is empty').toBeGreaterThanOrEqual(4)
  })

  it('the table is well-formed: numbered 1..13 in order, each row with sites and a named input', () => {
    expect(DISPOSITION.map(r => r.row)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
    for (const row of DISPOSITION) {
      expect(row.sites.length, `row ${row.row} has no site`).toBeGreaterThan(0)
      expect(row.inputs.length, `row ${row.row} gates on nothing`).toBeGreaterThan(0)
    }
  })

  it('direction 1: every site is where the table says, and carries its gate phrase', () => {
    expect(collectSiteDefects(DISPOSITION, corpus)).toEqual([])
  })

  it('direction 1: every site of a gate-name row is itself a gated line (no row pads the table)', () => {
    const padded: string[] = []
    for (const row of DISPOSITION.filter(r => r.inputs.every(i => i !== 'stub'))) {
      for (const site of row.sites) {
        const file = corpus.find(f => f.file === site.file)!
        const at = locate(site, file.content)
        if (!gated.some(g => g.file === site.file && g.index === at)) padded.push(`row ${row.row} ${site.file}:${at + 1}`)
      }
    }
    expect(padded).toEqual([])
  })

  it('direction 2: every condition-shaped gate in the built tree is governed by exactly one row', () => {
    expect(gated.length, 'fewer gated lines than the table lists — is the collector reading the tree?').toBeGreaterThanOrEqual(30)
    expect(collectUngovernedGates(DISPOSITION, corpus, gated)).toEqual([])
  })

  it('known-bad probe: a seeded ungoverned gate line is reported by direction 2', () => {
    const seeded = corpus.map(f =>
      f.file === 'commands/code-review.md'
        ? { ...f, content: `${f.content}\nSkip the pre-flight if \`APPLY_CONVENTIONS\` is false.\n` }
        : f)
    const found = collectUngovernedGates(DISPOSITION, seeded, collectGatedSites(seeded, exempt))
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('no DISPOSITION row governs it')
  })

  it('known-bad probe: a row whose anchor was deleted is reported by direction 1', () => {
    const stripped = corpus.map(f =>
      f.file === setupTask('jira')
        ? { ...f, content: f.content.replace('1c. Issue-first', '1c. Issue') }
        : f)
    expect(collectSiteDefects(DISPOSITION, stripped)).toEqual([
      `row 2 ${setupTask('jira')}: no line holds "1c. Issue-first"`,
    ])
    const ungated = corpus.map(f =>
      f.file === setupTask('linear')
        ? { ...f, content: f.content.replace(`1b. **Branch convention:** ${gate('APPLY_CONVENTIONS')}`, '1b. **Branch convention:**') }
        : f)
    expect(collectSiteDefects(DISPOSITION, ungated)).toHaveLength(1)
  })

  it('known-bad probe: a gate on a name its row does not declare is reported', () => {
    const drifted = corpus.map(f =>
      f.file === 'commands/bug-analysis.md'
        ? { ...f, content: f.content.replace(fenceKey('APPLY_CONVENTIONS'), `${fenceKey('APPLY_CONVENTIONS')} ${fenceKey('ISSUE_REQUIRED')}`) }
        : f)
    const found = collectUngovernedGates(DISPOSITION, drifted, collectGatedSites(drifted, exempt))
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('row 7 does not gate on ISSUE_REQUIRED')
  })
})

describe('orchestrator decisions (2026-09-25): no ticket gate outside /implement and /plan; exceptions are /implement-only', () => {
  const corpus = builtCorpus()
  const gated = collectGatedSites(corpus, resolutionLines())
  const REVIEW_HOSTS = ['commands/code-review.md', 'commands/bug-analysis.md'] as const

  /**
   * Named collector: a ticket gate in the two review hosts — a gate on
   * `ISSUE_REQUIRED` (the input a ticket gate keys on, design §8 delta 7), or a
   * gate on the policy itself that names a ticket. A bare `EVIDENCE_POLICY` gate
   * is NOT one: /code-review legitimately turns a resolved `off` publication into
   * `stub` under the policy (row 13's caller side), and that gates a comment, not
   * the PR.
   */
  function collectReviewTicketGates(lines: readonly GatedLine[]): string[] {
    return lines
      .filter(g => (REVIEW_HOSTS as readonly string[]).includes(g.file))
      .filter(g => g.names.includes('ISSUE_REQUIRED') || (g.names.includes('EVIDENCE_POLICY') && /\bticket/i.test(g.text)))
      .map(g => `${g.file}:${g.index + 1}: ${g.text.trim().slice(0, 100)}`)
  }

  it('/code-review and /bug-analysis create the PR as today under both policies', () => {
    const row7 = DISPOSITION.find(r => r.row === 7)!
    expect(row7.sites.map(s => s.file).sort()).toEqual([...REVIEW_HOSTS].sort())
    expect(row7.on.startsWith('create as today'), 'row 7 on').toBe(true)
    expect(row7.off, 'row 7 off').toBe('create as today')
    expect(collectReviewTicketGates(gated), 'a ticket gate in a review host').toEqual([])
    for (const host of REVIEW_HOSTS) {
      const content = corpus.find(f => f.file === host)!.content
      expect(content, `${host} must never refuse a PR for a missing ticket`).not.toMatch(/no ticket link/i)
    }
  })

  it('known-bad probe: a seeded ticket gate in /code-review is reported, in either keying', () => {
    const seed = (line: string): string[] => {
      const seeded = corpus.map(f =>
        f.file === 'commands/code-review.md' ? { ...f, content: `${f.content}\n${line}\n` } : f)
      return collectReviewTicketGates(collectGatedSites(seeded, resolutionLines()))
    }
    expect(seed('Only when `ISSUE_REQUIRED` is `true`: stop with BLOCKED.')).toHaveLength(1)
    expect(seed('When `EVIDENCE_POLICY` is `required` and no ticket is linked, stop.')).toHaveLength(1)
    // Negative control: the publication stub gates a comment, not the PR.
    expect(seed('Only when `EVIDENCE_POLICY` is `required`, a resolved `off` becomes `stub`.')).toEqual([])
  })

  it('/implement is the only command that records an evidence exception', () => {
    const carriers = corpus
      .filter(f => f.file.startsWith('commands/'))
      .filter(f => f.content.includes('PR_EXCEPTIONS') || f.content.includes('## Evidence Exceptions'))
      .map(f => f.file)
    expect(carriers.filter(f => f !== 'commands/implement.md')).toEqual([])
  })
})

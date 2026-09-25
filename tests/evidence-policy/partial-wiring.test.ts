/**
 * tests/evidence-policy/partial-wiring.test.ts
 *
 * SDLC-evidence PR3b (#362), phase P1. These guards cover the `_evidence_policy.mds`
 * partial and how the command layer calls resolve-evidence-policy.cjs.
 *
 *   AC-1  The partial holds at most two defines and no imports (PF-073). Exactly
 *         the EVIDENCE_POLICY_PARTIAL_ADOPTERS hosts import it, and each calls
 *         `evidence_policy()` once.
 *   AC-2  The invocation line is byte-identical in all eight command files (seven
 *         built adopters plus the hand-authored release.md). release.md also holds
 *         the define's whole expansion. The parse template is pinned to the
 *         script's own OUTPUT_LINE_RE by key order and by a differential
 *         accept/reject table. The fallback is FAIL_CLOSED_LINE, pinned by equality.
 *   AC-3  No prompt restates the policy → mechanism mapping (MECHANISM_INPUTS in
 *         the script is its one authority). No spawn fence carries EVIDENCE_POLICY.
 *
 * The script's grammar is required, never transcribed: OUTPUT_LINE_RE,
 * FAIL_CLOSED_LINE, MECHANISM_INPUTS and formatLine come from the .cjs itself, so
 * a change to the script moves these pins with it.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector (PF-064). Each guard's JSDoc records what
 * it does NOT cover, because a clean result only proves the shapes it can express.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import * as path from 'path'

import {
  ROOT,
  isAgentBlock,
  parseFences,
  requireDistFile,
  requireDistFiles,
  resolveAllAgents,
  walkFiles,
} from '../helpers.js'
import { EVIDENCE_POLICY_PARTIAL_ADOPTERS, HAND_AUTHORED_COMMAND_FILES } from '../fixtures/mds-manifest.js'
import { getAllAgentNames } from '../../src/core/plugins.js'
import { RESOLVER_SCRIPT } from './scripted-shim.js'

// ---------------------------------------------------------------------------
// The .cjs seam: the grammar consumers are pinned to
// ---------------------------------------------------------------------------

type Policy = 'required' | 'standard'

/** Transcribed from the script's JSDoc typedefs. Open those before changing this. */
interface ResolverGrammar {
  readonly POLICIES: readonly Policy[]
  readonly SOURCES: readonly string[]
  readonly WARNINGS: readonly string[]
  readonly MECHANISM_INPUTS: Readonly<Record<Policy, Readonly<Record<string, boolean>>>>
  readonly OUTPUT_LINE_RE: RegExp
  readonly FAIL_CLOSED_LINE: string
  formatLine(r: {
    policy: Policy
    source: string
    ref: string
    warnings: readonly string[]
    inputs: Readonly<Record<string, boolean>>
  }): string
}

const RESOLVER = createRequire(import.meta.url)(RESOLVER_SCRIPT) as ResolverGrammar

/** The three mechanism inputs, in the script's own order. */
const MECHANISM_KEYS: readonly string[] = Object.keys(RESOLVER.MECHANISM_INPUTS.required)

/** Every variable the define sets: the policy, then the mechanism inputs. */
const POLICY_NAMES: readonly string[] = ['EVIDENCE_POLICY', ...MECHANISM_KEYS]

// ---------------------------------------------------------------------------
// The partial and its corpus
// ---------------------------------------------------------------------------

const PARTIAL_PATH = path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_evidence_policy.mds')
const PARTIAL_IMPORT = './_partials/_evidence_policy.mds'
const DEFINE = 'evidence_policy'

/**
 * Every define the partial may hold. P3 adds `evidence_exception`, the exception
 * grammar (design §3.14). A define this list does not model would expand into
 * every host that imports it with nothing here to notice.
 */
const KNOWN_DEFINES: readonly string[] = [DEFINE]

/** PF-073: compile cost is exponential in the define count, so the partial stays at ≤2. */
const MAX_DEFINES = 2

/** The sentence that opens the define, and the anchor the order guard measures from. */
const RESOLUTION_SENTENCE = '**Resolve the evidence policy once per run**'

const SCRIPT_NAME = 'resolve-evidence-policy.cjs'

/** The hand-authored command that carries the expansion instead of importing it. */
const RELEASE = HAND_AUTHORED_COMMAND_FILES[0]

interface TextFile {
  readonly name: string
  readonly content: string
}

function partialSource(): string {
  return readFileSync(PARTIAL_PATH, 'utf-8')
}

/** The body between `@define <name>():` and its `@end`, or null when either is absent. */
function defineBody(source: string, name: string): string | null {
  const lines = source.split('\n')
  const start = lines.indexOf(`@define ${name}():`)
  if (start === -1) return null
  const end = lines.indexOf('@end', start + 1)
  if (end === -1) return null
  return lines.slice(start + 1, end).join('\n')
}

/**
 * Resolve prose brace escapes the way the MDS compiler emits them (`\{` → `{`).
 * This is a model of the compiler. The expansion arm below checks it against every
 * built adopter, so a wrong model fails there instead of passing quietly.
 */
function unescapeMds(text: string): string {
  return text.replace(/\\([{}])/g, '$1')
}

/** The define's built text: what every adopter expands to and release.md carries. */
function builtExpansion(): string {
  const body = defineBody(partialSource(), DEFINE)
  if (body === null) throw new Error(`${PARTIAL_PATH}: no \`@define ${DEFINE}():\` … \`@end\` block`)
  return unescapeMds(body)
}

/** The eight command files that resolve the policy: seven built adopters, then release.md. */
function policyCommandCorpus(): TextFile[] {
  return [...EVIDENCE_POLICY_PARTIAL_ADOPTERS.map(h => `${h}.md`), RELEASE].map(name => ({
    name,
    content: requireDistFile(name),
  }))
}

// ---------------------------------------------------------------------------
// AC-1 — the partial's shape and its adopters
// ---------------------------------------------------------------------------

/** Named collector: the `@define`, `@export` and `@import` lines of an MDS source. */
function collectPartialDeclarations(source: string): { defines: string[]; exports: string[]; imports: string[] } {
  return {
    defines: [...source.matchAll(/^@define ([A-Za-z_][A-Za-z0-9_]*)\(\):/gm)].map(m => m[1]),
    exports: [...source.matchAll(/^@export ([A-Za-z_][A-Za-z0-9_]*)\s*$/gm)].map(m => m[1]),
    imports: [...source.matchAll(/^@import\b.*$/gm)].map(m => m[0]),
  }
}

/**
 * Named collector: which MDS sources import the partial, in any import form
 * (selective or alias). An alias import names no define, so the match is on the
 * module path, not on `evidence_policy`.
 */
function collectEvidencePolicyImporters(sources: readonly TextFile[]): string[] {
  const importLine = new RegExp(`^@import\\b.*"${PARTIAL_IMPORT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"`, 'm')
  return sources.filter(s => importLine.test(s.content)).map(s => s.name).sort()
}

/** Every `.mds` under src/, as {host basename, source}. */
function srcMdsCorpus(): TextFile[] {
  return walkFiles(path.join(ROOT, 'src'), f => f.endsWith('.mds')).map(f => ({
    name: path.basename(f, '.mds'),
    content: readFileSync(f, 'utf-8'),
  }))
}

describe('AC-1: the _evidence_policy partial and its adopters', () => {
  it('declares only known defines (at most two), exports each, and imports nothing (PF-073)', () => {
    const { defines, exports, imports } = collectPartialDeclarations(partialSource())
    expect([...defines].sort(), 'the partial declares a define this guard does not model').toEqual([...KNOWN_DEFINES].sort())
    expect(defines.length, 'PF-073: every added define doubles the capture copy').toBeLessThanOrEqual(MAX_DEFINES)
    expect([...exports].sort(), 'every define must be exported, and nothing else').toEqual([...defines].sort())
    expect(imports, 'an import puts its module\'s capture graph in every define\'s scope (PF-073)').toEqual([])
  })

  it('known-bad probe: a seeded third define and an import are reported', () => {
    const seeded = [
      '@import { issue_ref_grammar } from "./_tracker.mds"',
      '@define evidence_policy():',
      'body',
      '@end',
      '@define smuggled():',
      'body',
      '@end',
      '@export evidence_policy',
      '',
    ].join('\n')
    const { defines, exports, imports } = collectPartialDeclarations(seeded)
    expect(defines).toEqual(['evidence_policy', 'smuggled'])
    expect(exports).toEqual(['evidence_policy'])
    expect(imports).toHaveLength(1)
  })

  it('is imported by exactly the adopter set, and each adopter calls the define once', () => {
    const corpus = srcMdsCorpus()
    expect(corpus.length, 'the src/ .mds walk found nothing, so this guard proves nothing').toBeGreaterThanOrEqual(20)
    expect(corpus.map(s => s.name), 'the walk must reach the command hosts').toContain('implement')

    expect(collectEvidencePolicyImporters(corpus)).toEqual([...EVIDENCE_POLICY_PARTIAL_ADOPTERS].sort())

    const call = `{${DEFINE}()}`
    for (const host of EVIDENCE_POLICY_PARTIAL_ADOPTERS) {
      const source = corpus.find(s => s.name === host)
      expect(source, `${host}.mds is missing from the src/ walk`).toBeDefined()
      const calls = (source?.content ?? '').split('\n').filter(l => l.trim() === call)
      expect(calls, `${host}.mds must call ${call} exactly once`).toHaveLength(1)
    }
  })

  it('known-bad probe: an unlisted importer and an alias import are both reported', () => {
    const seeded: TextFile[] = [
      { name: 'stray', content: `@import { ${DEFINE} } from "${PARTIAL_IMPORT}"\n` },
      { name: 'aliased', content: `@import "${PARTIAL_IMPORT}" as ep\n` },
      { name: 'unrelated', content: '@import { publication_gate } from "./_partials/_publication.mds"\n' },
    ]
    expect(collectEvidencePolicyImporters(seeded)).toEqual(['aliased', 'stray'])
  })
})

// ---------------------------------------------------------------------------
// AC-2 — one invocation, one expansion, one grammar
// ---------------------------------------------------------------------------

/**
 * Named collector: the lines that invoke the resolver, per command file. Every
 * file must hold exactly one, and all of them must be the same bytes.
 */
function collectPolicyInvocations(files: readonly TextFile[]): Array<{ name: string; lines: string[] }> {
  return files.map(f => ({ name: f.name, lines: f.content.split('\n').filter(l => l.includes(SCRIPT_NAME)) }))
}

/** Named collector: the files that do not hold `expansion` exactly once. */
function collectExpansionDefects(files: readonly TextFile[], expansion: string): string[] {
  const defects: string[] = []
  for (const f of files) {
    const count = f.content.split(expansion).length - 1
    if (count !== 1) defects.push(`${f.name}: holds the evidence_policy() expansion ${count} times (expected 1)`)
  }
  return defects
}

/** Change one character of `content` inside its first line that contains `anchor`. */
function mutateOneChar(content: string, anchor: string): string {
  const at = content.indexOf(anchor)
  if (at === -1) throw new Error(`mutateOneChar: anchor "${anchor}" not found — the probe is inert`)
  const lineStart = content.lastIndexOf('\n', at) + 1
  const target = content[lineStart] === 'X' ? 'Y' : 'X'
  return content.slice(0, lineStart) + target + content.slice(lineStart + 1)
}

/**
 * Named collector: every backticked `EVIDENCE_POLICY=…` span in a text, split into
 * TEMPLATES (spans that hold a `<…>` placeholder) and LITERALS (whole lines).
 */
function collectPolicyLines(text: string): { templates: string[]; literals: string[] } {
  const spans = [...text.matchAll(/`(EVIDENCE_POLICY=[^`\n]*)`/g)].map(m => m[1])
  return {
    templates: spans.filter(s => s.includes('<')),
    literals: spans.filter(s => !s.includes('<')),
  }
}

/** Escape a literal for a RegExp source. */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
}

/**
 * The source of one named capture group in a RegExp source, without the group
 * itself: `(?<ref>A|B)` → `A|B`. Tracks escapes and character classes, so a paren
 * inside `[…]` or after `\` is not counted. Bounded by the source length.
 */
function namedGroupSource(source: string, group: string): string {
  const open = `(?<${group}>`
  const start = source.indexOf(open)
  if (start === -1) throw new Error(`OUTPUT_LINE_RE has no (?<${group}>…) group`)
  let depth = 1
  let inClass = false
  for (let i = start + open.length; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\\') { i++; continue }
    if (inClass) { if (ch === ']') inClass = false; continue }
    if (ch === '[') { inClass = true; continue }
    if (ch === '(') depth++
    if (ch === ')') {
      depth--
      if (depth === 0) return source.slice(start + open.length, i)
    }
  }
  throw new Error(`OUTPUT_LINE_RE's (?<${group}>…) group is unbalanced`)
}

/** The template placeholder that stands for OUTPUT_LINE_RE's `ref` group. */
const REF_PLACEHOLDER = 'branch|none'

/** The template's repetition marker: `,` plus the previous alternation, again. */
const REPEAT_MARKER = '[,…]'

/**
 * Compile the partial's human-readable line template into a RegExp, so its
 * accept/reject behaviour can be compared with OUTPUT_LINE_RE's.
 *
 *   `<a|b|c>`        one of the listed values
 *   `<branch|none>`  OUTPUT_LINE_RE's own `ref` group (a branch name is a
 *                    grammar, not a list, so the script's expression is reused)
 *   `[…]`            an optional part
 *   `[,…]`           `,` plus the previous list again. The bound is the list's
 *                    length minus one, because the script prints each token at
 *                    most once. The differential table holds that reading to the
 *                    script's own bound.
 *   anything else    literal text
 */
function grammarRegexFromTemplate(template: string): RegExp {
  let out = '^'
  let lastList: { src: string; size: number } | null = null
  let depth = 0
  for (let i = 0; i < template.length;) {
    if (template.startsWith(REPEAT_MARKER, i)) {
      if (lastList === null) throw new Error(`template: ${REPEAT_MARKER} follows no <…> list`)
      out += `(?:,${lastList.src}){0,${lastList.size - 1}}`
      i += REPEAT_MARKER.length
      continue
    }
    const ch = template[i]
    if (ch === '<') {
      const close = template.indexOf('>', i)
      if (close === -1) throw new Error('template: unclosed <')
      const body = template.slice(i + 1, close)
      if (body === REF_PLACEHOLDER) {
        out += `(?:${namedGroupSource(RESOLVER.OUTPUT_LINE_RE.source, 'ref')})`
        lastList = null
      } else {
        const values = body.split('|')
        const src = `(?:${values.map(escapeRe).join('|')})`
        out += src
        lastList = { src, size: values.length }
      }
      i = close + 1
      continue
    }
    if (ch === '[') { out += '(?:'; depth++; i++; continue }
    if (ch === ']') {
      if (depth === 0) throw new Error('template: unbalanced ]')
      out += ')?'
      depth--
      i++
      continue
    }
    out += escapeRe(ch)
    i++
  }
  if (depth !== 0) throw new Error('template: unbalanced [')
  return new RegExp(`${out}$`)
}

/** Field keys in the template, in order. */
function templateKeys(template: string): string[] {
  return [...template.matchAll(/([A-Z][A-Z_]*)=</g)].map(m => m[1])
}

/** Field keys in OUTPUT_LINE_RE, in order: each is `KEY=` followed by its named group. */
function outputLineKeys(re: RegExp): string[] {
  return [...re.source.matchAll(/([A-Z][A-Z_]*)=\(\?<\w+>/g)].map(m => m[1])
}

/**
 * The differential table: lines the script's grammar accepts, and hostile
 * near-misses. The accepted half comes from the script's own formatLine, over
 * both policies, every SOURCE, three REFs and every WARN subset.
 */
function differentialTable(): string[] {
  const lines: string[] = [RESOLVER.FAIL_CLOSED_LINE]
  const warn = RESOLVER.WARNINGS
  for (const policy of RESOLVER.POLICIES) {
    for (const source of RESOLVER.SOURCES) {
      for (const ref of ['none', 'main', 'feat/362-x.y']) {
        for (let mask = 0; mask < 1 << warn.length; mask++) {
          const warnings = warn.filter((_, bit) => (mask & (1 << bit)) !== 0)
          lines.push(RESOLVER.formatLine({ policy, source, ref, warnings, inputs: RESOLVER.MECHANISM_INPUTS[policy] }))
        }
      }
    }
  }
  const F = RESOLVER.FAIL_CLOSED_LINE
  const at = (needle: string, replacement: string): string => {
    if (!F.includes(needle)) throw new Error(`hostile row: "${needle}" not in FAIL_CLOSED_LINE`)
    return F.replace(needle, replacement)
  }
  lines.push(
    at('EVIDENCE_POLICY=', 'evidence_policy='),                        // lowercase key
    at('ISSUE_REQUIRED=', 'issue_required='),
    `${F} EXTRA=1`,                                                   // extra field, appended
    at(' REF=none', ' REF=none EXTRA=1'),                             // extra field, inserted
    at('EVIDENCE_POLICY=required SOURCE=error', 'SOURCE=error EVIDENCE_POLICY=required'), // reordered
    at(' ISSUE_REQUIRED=true APPLY_CONVENTIONS=true', ' APPLY_CONVENTIONS=true ISSUE_REQUIRED=true'),
    at('EVIDENCE_POLICY=required', 'EVIDENCE_POLICY=REQUIRED'),       // uppercase value
    at('ISSUE_REQUIRED=true', 'ISSUE_REQUIRED=TRUE'),
    `${F} `,                                                          // trailing space
    ` ${F}`,                                                          // leading space
    `${F}\n`,                                                         // trailing newline
    `${F}\n${F}`,                                                     // two lines
    at('REF=none', 'REF=..'),                                         // traversal refs
    at('REF=none', 'REF=main..feat'),
    at('REF=none', 'REF=-rf'),                                        // option-shaped ref
    at('REF=none', 'REF='),
    at('REF=none', 'REF=feat_x'),                                     // outside the ref class
    at(' ISSUE_REQUIRED', ' WARN= ISSUE_REQUIRED'),                   // empty WARN
    at(' ISSUE_REQUIRED', ' WARN=bogus ISSUE_REQUIRED'),              // unknown token
    at(' ISSUE_REQUIRED', ' WARN=invalid-file, ISSUE_REQUIRED'),      // trailing comma
    at(' ISSUE_REQUIRED', ' WARN=invalid-file,invalid-file ISSUE_REQUIRED'), // repeat within bound
    at(' ISSUE_REQUIRED', ` WARN=${[...warn, warn[0]].join(',')} ISSUE_REQUIRED`), // over the bound
    at(' SOURCE=error', ''),                                          // missing fields
    at(' REQUIRE_NON_AUTHOR_APPROVAL=true', ''),
    at('SOURCE=error', 'SOURCE=remote'),                              // unlisted values
    at('ISSUE_REQUIRED=true', 'ISSUE_REQUIRED=maybe'),
    at('EVIDENCE_POLICY=required', 'EVIDENCE_POLICY=strict'),
    '',
  )
  return lines
}

/** Named collector: the table rows on which two grammars disagree. */
function collectGrammarDisagreements(candidate: RegExp, rows: readonly string[]): string[] {
  return rows
    .filter(row => candidate.test(row) !== RESOLVER.OUTPUT_LINE_RE.test(row))
    .map(row => `${JSON.stringify(row)}: template ${candidate.test(row) ? 'accepts' : 'rejects'}, OUTPUT_LINE_RE ${RESOLVER.OUTPUT_LINE_RE.test(row) ? 'accepts' : 'rejects'}`)
}

/** The partial's one template, from its source. */
function partialTemplate(): string {
  const { templates } = collectPolicyLines(builtExpansion())
  if (templates.length !== 1) throw new Error(`the evidence_policy() define holds ${templates.length} line templates (expected 1)`)
  return templates[0]
}

describe('AC-2: the invocation is identical in all eight command files', () => {
  it('each command file holds exactly one invocation line, and all eight are the same bytes', () => {
    const corpus = policyCommandCorpus()
    expect(corpus.map(f => f.name), 'the corpus is the seven adopters plus release.md').toHaveLength(8)

    const invocations = collectPolicyInvocations(corpus)
    for (const { name, lines } of invocations) {
      expect(lines, `${name} must invoke ${SCRIPT_NAME} on exactly one line`).toHaveLength(1)
    }
    const distinct = new Set(invocations.flatMap(i => i.lines))
    expect([...distinct], 'the invocation line diverges between command files').toHaveLength(1)
    expect([...distinct][0], 'the invocation must discard stderr and echo the exit code').toBe(
      'node "${DEVFLOW_DIR:-$HOME/.devflow}/scripts/resolve-evidence-policy.cjs" 2>/dev/null; echo "exit=$?"',
    )
  })

  it('known-bad probe: a one-character change in release.md\'s copy yields two distinct lines', () => {
    const corpus = policyCommandCorpus()
    const seeded = corpus.map(f => (f.name === RELEASE ? { ...f, content: mutateOneChar(f.content, SCRIPT_NAME) } : f))
    const distinct = new Set(collectPolicyInvocations(seeded).flatMap(i => i.lines))
    expect(distinct.size).toBe(2)
  })

  it('every adopter and release.md hold the define\'s whole expansion exactly once', () => {
    const expansion = builtExpansion()
    expect(expansion.length, 'the define body is empty — nothing is being compared').toBeGreaterThan(400)
    expect(expansion.startsWith(RESOLUTION_SENTENCE), 'the define must open with its resolution sentence').toBe(true)
    // The adopters prove the unescape model of the compiler; release.md is the
    // hand-kept copy this arm exists for.
    expect(collectExpansionDefects(policyCommandCorpus(), expansion)).toEqual([])
  })

  it('known-bad probe: a one-character change inside release.md\'s expansion is reported', () => {
    const expansion = builtExpansion()
    const seeded = policyCommandCorpus().map(f =>
      f.name === RELEASE ? { ...f, content: mutateOneChar(f.content, 'these fields, in this order') } : f,
    )
    expect(collectExpansionDefects(seeded, expansion)).toEqual([
      `${RELEASE}: holds the evidence_policy() expansion 0 times (expected 1)`,
    ])
  })
})

describe('AC-2: the parse is pinned to the script\'s OUTPUT_LINE_RE', () => {
  it('the template names the same fields in the same order as OUTPUT_LINE_RE', () => {
    const scriptKeys = outputLineKeys(RESOLVER.OUTPUT_LINE_RE)
    expect(scriptKeys, 'no keys parsed from OUTPUT_LINE_RE — the comparison is vacuous').toHaveLength(7)
    expect(templateKeys(partialTemplate())).toEqual(scriptKeys)
  })

  it('the template accepts and rejects exactly what OUTPUT_LINE_RE does over the differential table', () => {
    const rows = differentialTable()
    const accepted = rows.filter(r => RESOLVER.OUTPUT_LINE_RE.test(r))
    // Both halves must be populated, or the table only exercises one direction.
    expect(accepted.length, 'the table holds too few accepted lines').toBeGreaterThanOrEqual(400)
    expect(rows.length - accepted.length, 'the table holds too few hostile lines').toBeGreaterThanOrEqual(25)
    expect(collectGrammarDisagreements(grammarRegexFromTemplate(partialTemplate()), rows)).toEqual([])
  })

  it('known-bad probes: a template missing a field fails key parity; one missing `error` rejects FAIL_CLOSED_LINE', () => {
    const template = partialTemplate()
    const missing = template.replace(' REQUIRE_NON_AUTHOR_APPROVAL=<true|false>', '')
    expect(missing, 'the seed must land').not.toBe(template)
    expect(templateKeys(missing)).not.toEqual(outputLineKeys(RESOLVER.OUTPUT_LINE_RE))

    const noError = template.replace('|error>', '>')
    expect(noError, 'the seed must land').not.toBe(template)
    const narrowed = grammarRegexFromTemplate(noError)
    expect(narrowed.test(RESOLVER.FAIL_CLOSED_LINE)).toBe(false)
    expect(collectGrammarDisagreements(narrowed, differentialTable()).length).toBeGreaterThan(0)
  })

  it('every command file carries FAIL_CLOSED_LINE verbatim as its only literal policy line', () => {
    for (const { name, content } of policyCommandCorpus()) {
      const { templates, literals } = collectPolicyLines(content)
      expect(templates, `${name}: expected exactly one line template`).toHaveLength(1)
      expect(literals, `${name}: the fallback must be FAIL_CLOSED_LINE, byte for byte`).toEqual([RESOLVER.FAIL_CLOSED_LINE])
    }
  })

  it('known-bad probe: a drifted fallback is reported as a non-matching literal', () => {
    const drifted = RESOLVER.FAIL_CLOSED_LINE.replace('ISSUE_REQUIRED=true', 'ISSUE_REQUIRED=false')
    const { literals } = collectPolicyLines(`use \`${drifted}\` instead`)
    expect(literals).toEqual([drifted])
    expect(literals).not.toEqual([RESOLVER.FAIL_CLOSED_LINE])
  })
})

// ---------------------------------------------------------------------------
// AC-3 — no second authority for the mapping, no policy in a spawn
// ---------------------------------------------------------------------------

interface CorpusClass {
  readonly label: string
  readonly files: readonly TextFile[]
  /** A file that must be present, proving this class was actually read. */
  readonly sentinel: string
}

/**
 * The installed prompt surface, by class: compiled commands, every agent (the
 * compiled git.md included), the compiled git references, and the hand-authored
 * skills and rules. Each class carries a sentinel, because a non-empty total says
 * nothing about a class that went missing (PF-064).
 */
function promptSurface(): CorpusClass[] {
  const commands = requireDistFiles().map(name => ({ name: `commands/${name}`, content: requireDistFile(name) }))
  const agents = [...resolveAllAgents().entries()].map(([name, a]) => ({ name: `agents/${name}.md`, content: a.content }))
  const refsDir = path.join(ROOT, 'dist', 'skills', 'git', 'references')
  const refs = walkFiles(refsDir, f => f.endsWith('.md')).map(f => ({
    name: `references/${path.relative(refsDir, f).split(path.sep).join('/')}`,
    content: readFileSync(f, 'utf-8'),
  }))
  const skillsDir = path.join(ROOT, 'src', 'assets', 'skills')
  const skills = walkFiles(skillsDir, f => f.endsWith('.md')).map(f => ({
    name: `skills/${path.relative(skillsDir, f).split(path.sep).join('/')}`,
    content: readFileSync(f, 'utf-8'),
  }))
  const rulesDir = path.join(ROOT, 'src', 'assets', 'rules')
  const rules = walkFiles(rulesDir, f => f.endsWith('.md')).map(f => ({
    name: `rules/${path.basename(f)}`,
    content: readFileSync(f, 'utf-8'),
  }))
  return [
    { label: 'commands', files: commands, sentinel: 'commands/implement.md' },
    { label: 'agents', files: agents, sentinel: 'agents/git.md' },
    { label: 'references', files: refs, sentinel: 'references/publication-gate.md' },
    { label: 'skills', files: skills, sentinel: 'skills/git/SKILL.md' },
    { label: 'rules', files: rules, sentinel: 'rules/security.md' },
  ]
}

/** A policy value as a word: `required`/`standard`, never part of an identifier like ISSUE_REQUIRED. */
const POLICY_VALUE_RE = /(?<![A-Za-z0-9_])(?:required|standard)(?![A-Za-z0-9_])/i

/** A mechanism input paired with a boolean: `KEY=true`, `KEY: false`, `` `KEY` is `true` ``. */
const MECHANISM_VALUE_RE = new RegExp(`\\b(?:${MECHANISM_KEYS.join('|')})\\b[^\\n.;|]{0,24}?\\b(?:true|false)\\b`)

/** A line that introduces a list with a policy value: `` Under `required`: `` / `standard ⇒`. */
const LEAD_IN_RE = /(?<![A-Za-z0-9_])(?:required|standard)`?\**\s*(?::|⇒|→|->|=>)\s*$/i

/** How far below a lead-in line its list is read. */
const LEAD_IN_SPAN = 6

/** One cell of a markdown table row, trimmed and unquoted. */
function tableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim().replace(/^`|`$/g, ''))
}

/**
 * Named collector: the lines that pair a policy value with a mechanism value, in
 * the three shapes a restatement takes.
 *
 *   inline     a policy value and a mechanism assignment on one line (arrow,
 *              colon, prose): "`required` ⇒ `ISSUE_REQUIRED=true`"
 *   table row  a row with a policy-value cell and a boolean cell:
 *              "| required | true | true | true |"
 *   lead-in    a line ending in a policy value and `:` or an arrow, followed by a
 *              list line that assigns a mechanism value
 *
 * The verbatim FAIL_CLOSED_LINE and the partial's own template are removed from
 * each line first. They are the two sanctioned spellings, and both are pinned to
 * the script above.
 *
 * NOT covered: a restatement in synonyms ("the strict policy turns every input
 * on"), a mechanism named without its key ("requires an issue"), and a pairing
 * split across paragraphs. A clean result means none of the three shapes above
 * occurred. It does not mean the mapping is stated nowhere else.
 */
function collectRestatedMappings(files: readonly TextFile[], sanctioned: readonly string[]): string[] {
  const hits: string[] = []
  for (const f of files) {
    const lines = f.content.split('\n').map(l => sanctioned.reduce((acc, s) => acc.split(s).join(''), l))
    lines.forEach((line, i) => {
      const cells = line.trim().startsWith('|') ? tableCells(line) : []
      const inline = POLICY_VALUE_RE.test(line) && MECHANISM_VALUE_RE.test(line)
      const tableRow = cells.some(c => /^(?:EVIDENCE_POLICY\s*=\s*)?(?:required|standard)$/i.test(c))
        && cells.some(c => /^(?:[A-Z_]+\s*[=:]\s*)?(?:true|false)$/i.test(c))
      let leadIn = false
      if (LEAD_IN_RE.test(line.trim())) {
        for (let j = i + 1; j < Math.min(lines.length, i + 1 + LEAD_IN_SPAN) && lines[j].trim() !== ''; j++) {
          if (MECHANISM_VALUE_RE.test(lines[j])) { leadIn = true; break }
        }
      }
      if (inline || tableRow || leadIn) hits.push(`${f.name}:${i + 1}: ${line.trim().slice(0, 120)}`)
    })
  }
  return hits
}

/** Named collector: the lines in agent spawn fences that pass EVIDENCE_POLICY as a key. */
function collectPolicyKeyInSpawns(files: readonly TextFile[]): { scanned: number; hits: string[] } {
  const spawnKey = /(?:^|[\s"'`{,(])(?:EVIDENCE_POLICY|evidencePolicy)\s*:/
  let scanned = 0
  const hits: string[] = []
  for (const f of files) {
    for (const fence of parseFences(f.content)) {
      if (!/Agent\(subagent_type="|agentType:\s*"/.test(fence)) continue
      scanned++
      for (const line of fence.split('\n')) {
        if (spawnKey.test(line)) hits.push(`${f.name}: ${line.trim().slice(0, 120)}`)
      }
    }
  }
  return { scanned, hits }
}

describe('AC-3: the mapping has one authority and the policy never reaches an agent', () => {
  it('no prompt surface restates the policy → mechanism mapping', () => {
    const surface = promptSurface()
    for (const { label, files, sentinel } of surface) {
      expect(files.length, `${label}: the corpus class is empty`).toBeGreaterThan(0)
      expect(files.map(f => f.name), `${label}: sentinel ${sentinel} was not read`).toContain(sentinel)
    }
    expect(
      surface.find(c => c.label === 'agents')?.files.length,
      'every registered agent must be in the corpus',
    ).toBe(getAllAgentNames().length)

    const all = surface.flatMap(c => c.files)
    const sanctioned = [RESOLVER.FAIL_CLOSED_LINE, partialTemplate()]
    expect(collectRestatedMappings(all, sanctioned)).toEqual([])
  })

  it('known-bad probes: each restatement shape is reported, and the sanctioned spellings are not', () => {
    const sanctioned = [RESOLVER.FAIL_CLOSED_LINE, partialTemplate()]
    const probe = (content: string): string[] => collectRestatedMappings([{ name: 'probe.md', content }], sanctioned)

    expect(probe('`required` ⇒ `ISSUE_REQUIRED=true`'), 'inline arrow').toHaveLength(1)
    expect(probe('standard: `APPLY_CONVENTIONS` is `false`'), 'inline colon').toHaveLength(1)
    expect(probe('| Policy | Issue | Conventions | Approval |\n|---|---|---|---|\n| `required` | true | true | true |'), 'table row').toHaveLength(1)
    expect(probe('Under `standard`:\n- `ISSUE_REQUIRED` is `false`\n- `APPLY_CONVENTIONS` is `false`'), 'lead-in list').toHaveLength(1)

    // Negative controls: the sanctioned spellings, the P2 setup-task Input shape,
    // and ordinary English.
    expect(probe(`use \`${RESOLVER.FAIL_CLOSED_LINE}\` instead`)).toEqual([])
    expect(probe(`one line of the form \`${partialTemplate()}\``)).toEqual([])
    expect(probe("- `ISSUE_REQUIRED`, `APPLY_CONVENTIONS`: `true`/`false` from the caller's evidence policy")).toEqual([])
    expect(probe('A tracked issue is required before the PR is created.')).toEqual([])
  })

  it('no agent spawn fence passes EVIDENCE_POLICY', () => {
    const files = [
      ...requireDistFiles().map(name => ({ name: `commands/${name}`, content: requireDistFile(name) })),
      ...[...resolveAllAgents().entries()].map(([name, a]) => ({ name: `agents/${name}.md`, content: a.content })),
    ]
    const { scanned, hits } = collectPolicyKeyInSpawns(files)
    expect(scanned, 'no spawn fences were scanned, so the guard is vacuous').toBeGreaterThanOrEqual(20)
    // Sentinel: the /implement setup-task spawn is one of the fences read.
    expect(
      parseFences(requireDistFile('implement.md')).some(f => isAgentBlock(f, 'Git') && f.includes('OPERATION: setup-task')),
      'the /implement setup-task spawn fence must be in the corpus',
    ).toBe(true)
    expect(hits).toEqual([])
  })

  it('known-bad probe: EVIDENCE_POLICY seeded into a Git fence and a recipe is reported; a bash fence is not', () => {
    const seeded = [
      '```',
      'Agent(subagent_type="Git"):',
      '"OPERATION: setup-task',
      'EVIDENCE_POLICY: {EVIDENCE_POLICY}',
      'Return the branch setup summary."',
      '```',
      '',
      '```js',
      'await agent({ agentType: "Code", prompt: `TASK',
      'EVIDENCE_POLICY: ${EVIDENCE_POLICY}` })',
      '```',
      '',
      '```bash',
      'EVIDENCE_POLICY: required',
      '```',
    ].join('\n')
    const { scanned, hits } = collectPolicyKeyInSpawns([{ name: 'probe.md', content: seeded }])
    expect(scanned).toBe(2)
    expect(hits).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Order — the policy resolves before anything reads it
// ---------------------------------------------------------------------------

const POLICY_NAME_RE = new RegExp(`\\b(?:${POLICY_NAMES.join('|')})\\b`)

/**
 * Named collector: lines that read one of the four policy names before the
 * resolution sentence, in one command file. The resolution sentence must occur
 * exactly once. Non-reads are excluded, with a reason each:
 *   **Produces:** / **Requires:**  the phase-ordering DAG, not a read (PF-039)
 *   a heading line                 names the step, does not read the value
 */
function collectPolicyReadsBeforeResolution(file: string, content: string): string[] {
  const lines = content.split('\n')
  const at = lines.flatMap((l, i) => (l.includes(RESOLUTION_SENTENCE) ? [i] : []))
  if (at.length !== 1) return [`${file}: the resolution sentence occurs ${at.length} times (expected 1)`]
  const out: string[] = []
  for (let i = 0; i < at[0]; i++) {
    const line = lines[i]
    if (!POLICY_NAME_RE.test(line)) continue
    if (line.startsWith('**Produces:**') || line.startsWith('**Requires:**') || line.startsWith('#')) continue
    out.push(`${file}:${i + 1}: reads a policy name before it is resolved at line ${at[0] + 1} — "${line.trim().slice(0, 80)}"`)
  }
  return out
}

describe('order: the evidence policy resolves before its first read', () => {
  it('in every adopter and in release.md', () => {
    const corpus = policyCommandCorpus()
    expect(corpus).toHaveLength(8)
    expect(corpus.flatMap(f => collectPolicyReadsBeforeResolution(f.name, f.content))).toEqual([])
  })

  it('known-bad probes: a consumer above the sentence, a missing sentence and a doubled one are reported', () => {
    const above = [
      '**Produces:** EVIDENCE_POLICY, ISSUE_REQUIRED',
      '### Step 0: Resolve the evidence policy',
      'ISSUE_REQUIRED: {ISSUE_REQUIRED}',
      `${RESOLUTION_SENTENCE}, from the repository root …`,
    ].join('\n')
    expect(collectPolicyReadsBeforeResolution('probe.md', above)).toHaveLength(1)
    expect(collectPolicyReadsBeforeResolution('probe.md', 'APPLY_CONVENTIONS: {APPLY_CONVENTIONS}')).toHaveLength(1)
    expect(
      collectPolicyReadsBeforeResolution('probe.md', `${RESOLUTION_SENTENCE}\n${RESOLUTION_SENTENCE}`),
    ).toHaveLength(1)
  })
})

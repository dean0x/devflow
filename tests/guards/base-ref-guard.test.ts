/**
 * tests/guards/base-ref-guard.test.ts
 *
 * The base-ref guard for #495 (use a fresh base for branch diffs, tighten branch-name
 * validation). It reads the BUILT prompts: the commands, the agents and the Git-op
 * references, in both curation variants, plus the hand-authored /implement re-validation
 * reference. It collects every shell line that names a base value and checks each site
 * against the rules below.
 *
 *   AC-8   A base name reaches a shell line only through the resolver call or the PR
 *          target, double-quoted and after its base-name check. Every other command takes
 *          the BASE_REF value (a commit id).
 *   AC-9   Every base source carries a check that equals the exported STRICT_NAME_RE and
 *          states the allowed set. The code-review and bug-analysis commands carry no copy
 *          of it. No prompt copies LINE_RE or FALLBACK_LINE.
 *   AC-10  Diff sinks take the BASE_REF value. A non-zero diff exit stops the step, and an
 *          empty list counts only with exit 0.
 *   AC-15  The invocation text is accepted by the script's own argument parser. Every
 *          resolver call is counted per file (the call budget).
 *   AC-16  No built prompt carries a flagged base site: every collector finds nothing.
 *
 * This file holds the sweeps that find a new site anywhere in the corpus. The text one command
 * or one Git op states alone belongs to its own guard: the review commands' Return, Extract,
 * full-range, DIFF_RANGE and freshness text (`collectFreshBaseDefects` in tests/helpers.ts, driven
 * by tests/guards/code-review-diff-gating.test.ts and tests/bug-analysis/structural.test.ts), the
 * review agent's DIFF_RANGE fallback (code-review-diff-gating), /implement's Phase 1 and
 * re-validation text (tests/evidence/implement-flow.test.ts) and the Git ops' steps 5 to 7
 * (tests/git-agent.test.ts).
 *
 * How a site is identified. Every collector returns Findings: a file label, the curation
 * arm, a rule and an anchor. For a shell line the anchor is the command text. For a
 * required text the anchor is a fixed site label (the requirement table names it).
 *
 * Every collector has a known-bad probe on seeded text (in memory; nothing is written
 * into dist/ or src/) and a non-empty-corpus assertion, so a green result cannot come
 * from a collector that finds nothing.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import * as path from 'path'

import {
  MIN_COMPILED_PROMPTS,
  ROOT,
  collectStaleOutputs,
  compiledPrompts,
  ensurePrReadyReference,
  findNameClassCopies,
  gitOperationReferenceCorpus,
  readAgentReference,
  requireDistFile,
  requireDistFiles,
  resolveAllAgents,
  resolveCurationOffSource,
} from '../helpers.js'
import { RESOLVE_BASE_SCRIPT } from '../evidence/seam.js'

// ---------------------------------------------------------------------------
// The script seam: the exported constants are the one source of truth
// ---------------------------------------------------------------------------

interface ParsedArgs { readonly kind: 'ok' | 'usage' }

interface ResolverExports {
  readonly STRICT_NAME_RE: RegExp
  readonly LINE_RE: RegExp
  readonly FALLBACK_LINE: string
  readonly REASON_NOTES: Readonly<Record<string, string>>
  readonly parseArgs: (args: readonly string[]) => ParsedArgs
}

const resolver = createRequire(import.meta.url)(RESOLVE_BASE_SCRIPT) as ResolverExports
const STRICT = resolver.STRICT_NAME_RE.source
const SCRIPT_REF = `$HOME/.devflow/scripts/${path.basename(RESOLVE_BASE_SCRIPT)}`

/** The parts of the stop message of the base-name check that state the allowed set. */
const ALLOWED_SET_PARTS: readonly string[] = ['ASCII letters, digits and `._/+@,#-`', 'at most 200', '`origin/`', '`..`']

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

type Arm = 'on' | 'off'

interface Prompt {
  /** `commands/<name>.md`, `agents/<name>.md`, `git-ops/<op>.md` or `references/<name>.md`. */
  readonly file: string
  readonly arm: Arm
  readonly text: string
}

function seeded(file: string, text: string, arm: Arm = 'on'): Prompt {
  return { file, arm, text }
}

/** Every prompt the guard reads, built from the current `dist/` (and the hand-authored reference). */
function builtPrompts(): Prompt[] {
  const prompts: Prompt[] = []
  for (const name of requireDistFiles()) {
    prompts.push(seeded(`commands/${name}`, requireDistFile(name)))
    const off = resolveCurationOffSource('commands', name.replace(/\.md$/, ''))
    if (off !== null) prompts.push(seeded(`commands/${name}`, off, 'off'))
  }
  for (const [name, source] of resolveAllAgents()) {
    prompts.push(seeded(`agents/${name}.md`, source.content))
    const off = resolveCurationOffSource('agents', name)
    if (off !== null) prompts.push(seeded(`agents/${name}.md`, off, 'off'))
  }
  for (const entry of gitOperationReferenceCorpus('github')) {
    prompts.push(seeded(`git-ops/${path.basename(entry.path)}`, entry.content))
  }
  prompts.push(seeded('references/implement-revalidate.md', readAgentReference('commands/implement-revalidate.md')))
  return prompts
}

// ---------------------------------------------------------------------------
// Text readers
// ---------------------------------------------------------------------------

interface SourceLine {
  readonly index: number
  /** Character offset of the line start in the prompt text. */
  readonly offset: number
  readonly text: string
  /** The info string of the enclosing fence, `''` for an untagged fence, null outside a fence. */
  readonly tag: string | null
}

/** The lines outside fence markers, each with the info string of its fence. */
function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = []
  const raw = text.split('\n')
  let fence: { readonly char: string; readonly length: number; readonly tag: string } | null = null
  let offset = 0
  for (let index = 0; index < raw.length; index++) {
    const line = raw[index]
    const marker = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(line)
    if (fence === null) {
      if (marker !== null) fence = { char: marker[1][0], length: marker[1].length, tag: marker[2] }
      else lines.push({ index, offset, text: line, tag: null })
    } else if (marker !== null && marker[1][0] === fence.char && marker[1].length >= fence.length && marker[2] === '') {
      fence = null
    } else {
      lines.push({ index, offset, text: line, tag: fence.tag })
    }
    offset += line.length + 1
  }
  return lines
}

const SHELL_TAGS: ReadonlySet<string> = new Set(['bash', 'sh', 'shell', 'zsh', 'console'])
/** Output templates are not run, so the lines in them are not shell lines. */
const TEMPLATE_TAGS: ReadonlySet<string> = new Set(['markdown', 'md', 'text'])
const COMMAND_IN_SPAN_RE = /(?:^|[\s(;|&=])(?:git|gh|node)\s/
const COMMAND_LINE_RE = /^(?:[A-Za-z_]\w*=)?(?:\$\()?\s*(?:git|gh|node)\s/

/** The shell commands on one line: a whole line in a shell fence, and the inline code spans that run git, gh or node. */
function commandSpans(line: SourceLine): string[] {
  if (line.tag !== null && TEMPLATE_TAGS.has(line.tag)) return []
  const trimmed = line.text.trim()
  if (line.tag !== null && SHELL_TAGS.has(line.tag)) return trimmed === '' ? [] : [trimmed]
  const spans = [...line.text.matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(s => COMMAND_IN_SPAN_RE.test(s))
  if (spans.length === 0 && line.tag !== null && COMMAND_LINE_RE.test(trimmed)) spans.push(trimmed)
  return spans
}

/**
 * The placeholders that stand for a base NAME (the default-branch probe value is one): the brace forms, and the
 * angle-bracket forms that the `B=` binding of a resolver call uses. The literal `<base>` stays as written.
 */
const NAME_PATTERN = '(?:\\{(?:BASE_BRANCH|base_branch|base|base branch|default)\\}|<(?:name|base_branch)>)'
const hasName = (s: string): boolean => new RegExp(NAME_PATTERN).test(s)
const nameHits = (s: string): RegExpMatchArray[] => [...s.matchAll(new RegExp(NAME_PATTERN, 'g'))]
const HEX_PATTERN = '\\{(?:BASE_REF|base_ref)\\}'

function insideDoubleQuotes(span: string, index: number): boolean {
  let quote: string | null = null
  for (let i = 0; i < index; i++) {
    const c = span[i]
    if (c === '\\' && quote !== "'") { i++; continue }
    if (quote === null && (c === '"' || c === "'")) quote = c
    else if (quote === c) quote = null
  }
  return quote === '"'
}

interface Word {
  readonly value: string
  readonly quoted: 'none' | 'double' | 'single' | 'mixed'
}

/** The words of a simple shell command: quotes removed, `;` its own word. Models the quoting the prompts use, nothing more. */
function shellWords(command: string): Word[] {
  const words: Word[] = []
  let value = ''
  let kinds = new Set<string>()
  let inWord = false
  let quote: string | null = null
  const flush = (): void => {
    if (inWord) {
      const only = kinds.size === 1 ? [...kinds][0] : 'mixed'
      words.push({ value, quoted: only as Word['quoted'] })
    }
    value = ''
    kinds = new Set()
    inWord = false
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote === null) {
      if (c === ' ' || c === '\t') flush()
      else if (c === ';') { flush(); words.push({ value: ';', quoted: 'none' }) }
      else if (c === '"' || c === "'") { quote = c; inWord = true; kinds.add(c === '"' ? 'double' : 'single') }
      else if (c === '\\' && i + 1 < command.length) { value += command[++i]; inWord = true; kinds.add('none') }
      else { value += c; inWord = true; kinds.add('none') }
    } else if (c === quote) {
      quote = null
    } else if (c === '\\' && quote === '"' && i + 1 < command.length && '"\\$`'.includes(command[i + 1])) {
      value += command[++i]
    } else {
      value += c
    }
  }
  flush()
  return words
}

interface Block { readonly start: number; readonly end: number }

/** Blank-line separated blocks of a text. */
function splitBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let start = 0
  for (const m of text.matchAll(/\n(?:[ \t]*\n)+/g)) {
    blocks.push({ start, end: m.index })
    start = m.index + m[0].length
  }
  blocks.push({ start, end: text.length })
  return blocks
}

/** The block that holds `needle` and the `following` blocks after it, or null when `needle` is absent. */
function regionAround(text: string, needle: string, following: number): string | null {
  const at = text.indexOf(needle)
  if (at === -1) return null
  const blocks = splitBlocks(text)
  const i = blocks.findIndex(b => at >= b.start && at <= b.end)
  if (i === -1) return null
  return text.slice(blocks[i].start, blocks[Math.min(i + following, blocks.length - 1)].end)
}

/** One list item: the line that matches `start` and its indented continuation lines. */
function listItem(text: string, start: RegExp): string | null {
  const lines = text.split('\n')
  const first = lines.findIndex(l => start.test(l))
  if (first === -1) return null
  let last = first + 1
  while (last < lines.length && /^\s+\S/.test(lines[last])) last++
  return lines.slice(first, last).join('\n')
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const RULES = ['shell-name', 'strict-copy', 'grammar-copy', 'diff-range', 'sink-exit', 'resolver-call', 'reason-fix-table'] as const

type Rule = typeof RULES[number]

interface Finding {
  readonly rule: Rule
  readonly file: string
  readonly arm: Arm
  readonly anchor: string
  readonly detail: string
}

interface Unmet {
  readonly anchor: string
  readonly detail: string
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()
const describeFinding = (f: Finding): string => `${f.file} [${f.arm}] ${f.rule} :: ${f.anchor} -- ${f.detail}`

// ---------------------------------------------------------------------------
// Deferred scope: kept outside the name-site collectors
// ---------------------------------------------------------------------------

/** These prompts take the resolved base in a later change; until then their base sites stay out of the name-site collectors. */
const DEFERRED_FILES: readonly string[] = [
  'commands/dynamic-build.md',
  'agents/debug.md',
]

/** The review-focus skill files keep their literal range wording until #545 (review-focus skills read the base from DIFF_RANGE) lands. */
const DEFERRED_SKILL_FILES: readonly string[] = [
  'src/assets/skills/consistency/references/detection.md',
  'src/assets/skills/regression/references/detection.md',
  'src/assets/skills/regression/SKILL.md',
  'src/assets/skills/review-methodology/references/patterns.md',
  'src/assets/skills/review-methodology/references/violations.md',
]

/** A literal base name in a diff or log range, the shape the deferred skill files carry. */
const LITERAL_BASE_RANGE_RE = /(?:\b(?:main|master|develop|BASE)|\$BASE_BRANCH)\.\.\.?HEAD|git (?:diff|log)[^\n]* (?:main|master)\b/

// ---------------------------------------------------------------------------
// Collector 1: base names in shell lines, and class copies anywhere
// ---------------------------------------------------------------------------

/** Any copy of the base-name check, exact or widened (the detector the review-command Extract check shares). */
const hasClassCopy = (text: string): boolean => findNameClassCopies(text).length > 0

/** The files whose check line is a required base source: file label to the site label. */
const CHECKED_SOURCES: Readonly<Record<string, string>> = {
  'commands/implement.md': 'setup check',
  'references/implement-revalidate.md': 'revalidate check',
  'git-ops/ensure-pr-ready.md': 'step 5 check',
  'git-ops/validate-branch.md': 'steps 6 and 7 check',
}

/** The review commands take the checked name from ensure-pr-ready; they carry no copy. */
const REVIEW_COMMANDS: readonly string[] = ['commands/code-review.md', 'commands/bug-analysis.md']

function isAllowedUse(span: string): boolean {
  return span.includes('resolve-base.cjs') || /\bgh pr create\b[^\n]*--base\b/.test(span)
}

/** A line that holds the exact copy of the strict class and states the allowed set. */
function hasCheckLine(text: string): boolean {
  return text.split('\n').some(line => line.includes(`\`${STRICT}\``) && ALLOWED_SET_PARTS.every(part => line.includes(part)))
}

function collectNameSites(p: Prompt, includeDeferred = false): Finding[] {
  if (!includeDeferred && DEFERRED_FILES.includes(p.file)) return []
  const found: Finding[] = []
  const guardAt = p.text.indexOf(STRICT)
  for (const line of sourceLines(p.text)) {
    for (const span of commandSpans(line)) {
      const hits = nameHits(span)
      if (hits.length === 0) continue
      const reasons: string[] = []
      if (!isAllowedUse(span)) reasons.push('only the resolver call and the PR target take a base name')
      if (hits.some(h => !insideDoubleQuotes(span, h.index ?? 0))) reasons.push('the name is not double-quoted')
      if (guardAt === -1 || guardAt > line.offset) reasons.push('no exact base-name check precedes it')
      if (reasons.length > 0) found.push({ rule: 'shell-name', file: p.file, arm: p.arm, anchor: squash(span), detail: reasons.join('; ') })
    }
    for (const copy of findNameClassCopies(line.text)) {
      if (copy === STRICT) continue
      found.push({ rule: 'strict-copy', file: p.file, arm: p.arm, anchor: `copy ${copy.slice(0, 60)}`, detail: 'a copy of the class differs from STRICT_NAME_RE.source' })
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// Requirements: sites that must hold a text
// ---------------------------------------------------------------------------

interface Requirement {
  readonly rule: Rule
  /** File labels the requirement applies to; `'*'` applies to every prompt. */
  readonly files: readonly string[] | '*'
  readonly check: (p: Prompt) => Unmet[]
  /** Seeded text for the known-bad probe: `bad` is reported against `anchor`, `good` is not. */
  readonly probe: { readonly file: string; readonly anchor: string; readonly bad: string; readonly good: string }
}

const unmet = (anchor: string, detail: string): Unmet[] => [{ anchor, detail }]

/** Expected resolver calls per file; a file not listed expects none. */
interface CallBudget {
  /** Direct calls of the script. */
  readonly direct: number
  /** The mode of every direct call. */
  readonly mode?: 'local' | 'pr'
  /** The mode of each direct call, in any order, for a file that makes one call per mode. */
  readonly modes?: readonly ('local' | 'pr')[]
  /** ensure-pr-ready spawns (each is one call inside the Git op). */
  readonly spawns?: number
}

const CALL_BUDGET: Readonly<Record<string, CallBudget>> = {
  // One resolver run per /implement run: this call. The Phase 9 ensure-pr-ready spawn takes its BASE_REF and runs none.
  'commands/implement.md': { direct: 1, mode: 'local', spawns: 1 },
  // One call per reviewed worktree: the spawn sits inside the per-worktree step.
  'commands/code-review.md': { direct: 0, spawns: 1 },
  // One call per run.
  'commands/bug-analysis.md': { direct: 0, spawns: 1 },
  // One ensure-pr-ready call per wave PR; counted here, the file is not edited.
  'commands/dynamic-build.md': { direct: 0, spawns: 1 },
  'git-ops/ensure-pr-ready.md': { direct: 1, mode: 'pr' },
  // One call per validate-branch run.
  'git-ops/validate-branch.md': { direct: 1, mode: 'pr' },
  // A PR takes the pr rule; no PR takes the pre-PR local rule.
  'references/implement-revalidate.md': { direct: 2, modes: ['pr', 'local'] },
}

function callSpans(p: Prompt): string[] {
  return sourceLines(p.text).flatMap(line => commandSpans(line).filter(s => s.includes('resolve-base.cjs')))
}

/** Why a resolver call is not the invocation the script accepts; empty when it is. */
function invocationErrors(span: string): string[] {
  const words = shellWords(span)
  const at = words.findIndex(w => w.value.endsWith('resolve-base.cjs'))
  if (at === -1) return ['no script word']
  const errors: string[] = []
  if (words[at - 1]?.value !== 'node') errors.push('the script is not started with node')
  if (words[at].value !== SCRIPT_REF) errors.push(`the script path is not ${SCRIPT_REF}`)
  const args: Word[] = []
  for (const w of words.slice(at + 1)) {
    if (w.value === ';' || /^\d*>/.test(w.value)) break
    args.push(w)
  }
  const crossAt = args.findIndex(w => w.value === '--cross')
  const argv = args.map((w, i) => (i === 1 ? 'name' : crossAt !== -1 && i === crossAt + 1 && /^[${]/.test(w.value) ? 'true' : w.value))
  if (resolver.parseArgs(argv).kind !== 'ok') errors.push('the script refuses these arguments')
  if (args[1] !== undefined && args[1].quoted !== 'double') errors.push('the name is not a double-quoted word')
  if (!/echo "exit=\$\?"/.test(span)) errors.push('the exit status is not echoed')
  return errors
}

const modeOf = (span: string): string | undefined => shellWords(span).find((w, i, all) => all[i - 1]?.value.endsWith('resolve-base.cjs'))?.value

function callFindings(p: Prompt): Unmet[] {
  const budget = CALL_BUDGET[p.file] ?? { direct: 0 }
  const calls = callSpans(p)
  const out: Unmet[] = []
  if (calls.length !== budget.direct) out.push({ anchor: 'call count', detail: `found ${calls.length} direct call(s), expected ${budget.direct}` })
  for (const span of calls) {
    const errors = invocationErrors(span)
    if (errors.length > 0) out.push({ anchor: 'invocation', detail: errors.join('; ') })
    const mode = modeOf(span)
    if (budget.mode !== undefined && mode !== budget.mode) out.push({ anchor: 'invocation', detail: `mode ${mode} where ${budget.mode} is expected` })
  }
  if (budget.modes !== undefined) {
    const got = calls.map(modeOf).sort().join()
    const want = [...budget.modes].sort().join()
    if (got !== want) out.push({ anchor: 'invocation', detail: `modes ${got} where ${want} are expected` })
  }
  if (budget.spawns !== undefined) {
    const spawns = p.text.split('OPERATION: ensure-pr-ready').length - 1
    if (spawns !== budget.spawns) out.push({ anchor: 'ensure-pr-ready spawns', detail: `found ${spawns}, expected ${budget.spawns}` })
  }
  return out
}

/** The REASONs that end a base line as degraded or stop with no fix to name. */
const NO_FIX_REASONS: readonly string[] = ['fetch-failed', 'usage']

/** The reasons a base line can carry that name a fix: every stop or degraded REASON the script defines, less the no-fix ones. */
const FIX_REASONS: readonly string[] = Object.entries(resolver.REASON_NOTES)
  .filter(([reason, note]) => (note === 'stop' || note === 'degraded') && !NO_FIX_REASONS.includes(reason))
  .map(([reason]) => reason)

const FIX_TABLE_RE = /Fix by REASON:[^\n]*?\{fix\}` is left out\./

/** The fix a consumer names when the resolver gives no usable line. */
const RESOLVER_FIX = 're-run; if it repeats, run devflow init'

/** The reason-to-fix sentence of ensure-pr-ready step 5b: the one text every other copy equals. */
const CANONICAL_FIX_TABLE: string | null = (() => {
  const entry = gitOperationReferenceCorpus('github').find(e => path.basename(e.path) === 'ensure-pr-ready.md')
  return entry === undefined ? null : (FIX_TABLE_RE.exec(entry.content)?.[0] ?? null)
})()

/** Why the reason-to-fix sentence of a file does not equal the Git op sentence or cover the script's vocabulary; empty when it does. */
function fixTableFindings(p: Prompt): Unmet[] {
  const table = FIX_TABLE_RE.exec(p.text)?.[0]
  if (table === undefined) return unmet('reason-fix table', 'the file has no reason-to-fix sentence')
  const missing = FIX_REASONS.filter(reason => !table.includes(reason))
  const extra = NO_FIX_REASONS.filter(reason => table.includes(reason))
  const out: Unmet[] = []
  if (missing.length > 0) out.push({ anchor: 'reason-fix table', detail: `no fix for: ${missing.join(', ')}` })
  if (extra.length > 0) out.push({ anchor: 'reason-fix table', detail: `a fix for a reason that has none: ${extra.join(', ')}` })
  if (!table.includes(`resolver-unavailable \`${RESOLVER_FIX}\``)) out.push({ anchor: 'reason-fix table', detail: 'resolver-unavailable does not say to re-run before devflow init' })
  if (CANONICAL_FIX_TABLE === null) out.push({ anchor: 'reason-fix table', detail: 'ensure-pr-ready has no reason-to-fix sentence to compare with' })
  else if (table !== CANONICAL_FIX_TABLE) out.push({ anchor: 'reason-fix table', detail: 'the sentence differs from the ensure-pr-ready step 5b sentence' })
  return out
}

interface SinkSpec {
  readonly file: string
  readonly anchor: string
  /** The text that must read the exit status of the diff: the sink and the text right after it. */
  readonly region: (text: string) => string | null
  /** The sink's own stop fact: a non-zero diff exit stops the step. An `exit=` echo alone does not state it. */
  readonly stop: RegExp
  /** The sink's own empty-list fact, for a sink that states the rule: an empty list counts only with exit 0. */
  readonly empty?: RegExp
}

const STOP_UNMET = 'the sink does not say that a non-zero diff exit stops the step'
const EMPTY_UNMET = 'the sink does not say that an empty list counts only with exit 0'

const SINKS: readonly SinkSpec[] = [
  {
    file: 'commands/implement.md',
    anchor: 'branch_diff',
    region: t => regionAround(t, '`{branch_diff}` is the output of', 1),
    stop: /a non-zero exit stops\b/,
    empty: /an empty list counts only on exit 0\b/,
  },
  {
    file: 'commands/code-review.md',
    anchor: 'paths listing',
    region: t => regionAround(t, 'diff --name-only --no-renames {DIFF_RANGE}', 1),
    stop: /A non-zero diff exit stops\b/,
  },
  {
    file: 'commands/bug-analysis.md',
    anchor: 'CHANGED_FILES',
    region: t => {
      const listing = regionAround(t, 'CHANGED_FILES=$(git diff', 1)
      const row = t.split('\n').find(l => l.includes('Zero changed files in DIFF_RANGE')) ?? ''
      return listing === null ? null : `${listing}\n${row}`
    },
    stop: /A non-zero diff exit stops\b/,
    empty: /Zero changed files in DIFF_RANGE with exit 0\b/,
  },
  {
    file: 'git-ops/validate-branch.md',
    anchor: 'Diff Scope',
    region: t => listItem(t, /^7\.\s/),
    stop: /a non-zero exit is BLOCKED\b/,
    empty: /an empty list counts only with `exit=0`/,
  },
  {
    file: 'commands/code-review.md',
    anchor: 'patch writes',
    region: t => regionAround(t, '> "{REVIEW_DIR}/diff.patch"', 1),
    stop: /A non-zero exit of any patch write stops\b/,
  },
]

/** The facts a sink region lacks: its own stop fact, and its own empty-list fact when the sink states that rule. */
function sinkFacts(sink: SinkSpec, region: string): string[] {
  const lacking: string[] = []
  if (!sink.stop.test(region)) lacking.push(STOP_UNMET)
  if (sink.empty !== undefined && !sink.empty.test(region)) lacking.push(EMPTY_UNMET)
  return lacking
}

function sinkFindings(p: Prompt): Unmet[] {
  return SINKS.filter(s => s.file === p.file).flatMap(s => {
    const region = s.region(p.text)
    if (region === null) return unmet(s.anchor, 'the sink text was not found')
    return sinkFacts(s, region).map(detail => ({ anchor: s.anchor, detail }))
  })
}

const CALL_SEED = (rest: string): string => `node "${SCRIPT_REF}" ${rest}`
const CHECK_SEED = `Stop the run unless it matches \`${STRICT}\`, telling the user it allows ASCII letters, digits and \`._/+@,#-\`, at most 200; no leading \`-\` or \`#\`, no \`origin/\` prefix, no \`..\`.`
const STALE_CHECK_SEED = 'Stop the run unless it matches `^[A-Za-z0-9._/+@,#-]{1,200}$`, telling the user it allows only ASCII letters, digits and `._/+@,#-`, at most 200.'

const REQUIREMENTS: readonly Requirement[] = [
  {
    rule: 'strict-copy',
    files: Object.keys(CHECKED_SOURCES),
    check: p => (hasCheckLine(p.text) ? [] : unmet(CHECKED_SOURCES[p.file], 'no line carries the exact STRICT_NAME_RE.source copy with the allowed-set message')),
    probe: { file: 'commands/implement.md', anchor: 'setup check', bad: STALE_CHECK_SEED, good: CHECK_SEED },
  },
  {
    rule: 'strict-copy',
    files: REVIEW_COMMANDS,
    check: p => (hasClassCopy(p.text) ? unmet('no copy in the review commands', 'the Extract line takes the name from ensure-pr-ready and carries no copy of the class') : []),
    probe: { file: 'commands/code-review.md', anchor: 'no copy in the review commands', bad: CHECK_SEED, good: 'Check the Base line and the hex base_ref.' },
  },
  {
    rule: 'grammar-copy',
    files: '*',
    check: p => {
      const copied = [resolver.FALLBACK_LINE, resolver.LINE_RE.source, '(?<baseRef>'].filter(part => p.text.includes(part))
      return copied.length === 0 ? [] : unmet('output grammar', 'a prompt copies LINE_RE or FALLBACK_LINE; prompts copy STRICT_NAME_RE only')
    },
    probe: { file: 'commands/implement.md', anchor: 'output grammar', bad: `Accept \`${resolver.FALLBACK_LINE}\` as the fallback.`, good: 'Accept only a line that starts `BASE_REF=`.' },
  },
  {
    rule: 'resolver-call',
    files: '*',
    check: callFindings,
    probe: {
      file: 'git-ops/ensure-pr-ready.md',
      anchor: 'invocation',
      bad: `5a. ${'`'}${CALL_SEED('pr "${B}" --cross maybe; echo "exit=$?"')}${'`'}`,
      good: `5a. ${'`'}${CALL_SEED('pr "${B}" --cross "${C}"; echo "exit=$?"')}${'`'}`,
    },
  },
  {
    rule: 'reason-fix-table',
    files: ['commands/implement.md', 'git-ops/ensure-pr-ready.md', 'git-ops/validate-branch.md'],
    check: fixTableFindings,
    probe: {
      file: 'commands/implement.md',
      anchor: 'reason-fix table',
      bad: (CANONICAL_FIX_TABLE ?? '').replace('no-ref or timeout', 'timeout'),
      good: CANONICAL_FIX_TABLE ?? '',
    },
  },
  {
    rule: 'diff-range',
    files: '*',
    check: p => [...p.text.matchAll(/Set `DIFF_RANGE` to `([^`]+)`/g)]
      .filter(m => hasName(m[1]))
      .map(m => ({ anchor: `DIFF_RANGE ${m[1]}`, detail: 'the range is built from a base name; it takes the BASE_REF value' })),
    probe: {
      file: 'commands/code-review.md',
      anchor: 'DIFF_RANGE {base_branch}...HEAD',
      bad: 'Set `DIFF_RANGE` to `{base_branch}...HEAD`',
      good: 'Set `DIFF_RANGE` to `{base_ref}...HEAD`; the incremental range `{sha}...HEAD` is unchanged',
    },
  },
  {
    rule: 'sink-exit',
    files: SINKS.map(s => s.file),
    check: sinkFindings,
    probe: {
      file: 'commands/implement.md',
      anchor: 'branch_diff',
      bad: '`{branch_diff}` is the output of `git diff --name-only {BASE_REF}...HEAD`, run again at each spawn.\n\nNext paragraph.',
      good: '`{branch_diff}` is the output of `git diff --name-only {BASE_REF}...HEAD`, run again at each spawn; a non-zero exit stops, and an empty list counts only on exit 0.\n\nNext paragraph.',
    },
  },
]

function appliesTo(r: Requirement, file: string): boolean {
  return r.files === '*' || r.files.includes(file)
}

function collectRequirements(p: Prompt): Finding[] {
  return REQUIREMENTS.filter(r => appliesTo(r, p.file)).flatMap(r =>
    r.check(p).map(u => ({ rule: r.rule, file: p.file, arm: p.arm, anchor: u.anchor, detail: u.detail })))
}

function allFindings(prompts: readonly Prompt[]): Finding[] {
  return prompts.flatMap(p => [...collectNameSites(p), ...collectRequirements(p)])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const prompts = builtPrompts()
const findings = allFindings(prompts)

describe('the corpus the guard reads', () => {
  it('dist/ is current, so the scans read the text that ships', () => {
    expect(compiledPrompts().length, 'no compiled prompt found, run `npm run build:mds`').toBeGreaterThanOrEqual(MIN_COMPILED_PROMPTS)
    expect(collectStaleOutputs(), 'dist/ is older than its sources, run `npm run build:mds`').toEqual([])
  })

  it('holds both curation variants of the commands and the review agent, the Git ops and the re-validation reference', () => {
    expect(prompts.length).toBeGreaterThanOrEqual(MIN_COMPILED_PROMPTS)
    const have = (file: string, arm: Arm): boolean => prompts.some(p => p.file === file && p.arm === arm)
    for (const file of ['commands/implement.md', 'commands/code-review.md', 'commands/bug-analysis.md', 'agents/review.md']) {
      expect(have(file, 'on'), `${file} curation-on`).toBe(true)
      expect(have(file, 'off'), `${file} curation-off`).toBe(true)
    }
    for (const file of Object.keys(CHECKED_SOURCES)) expect(have(file, 'on'), file).toBe(true)
  })

  it('every file a rule names is in the corpus, so no rule passes by reading nothing', () => {
    const named = new Set<string>([
      ...Object.keys(CHECKED_SOURCES), ...Object.keys(CALL_BUDGET), ...REVIEW_COMMANDS,
      ...SINKS.map(s => s.file), ...REQUIREMENTS.flatMap(r => (r.files === '*' ? [] : r.files)), ...DEFERRED_FILES,
    ])
    const present = new Set(prompts.map(p => p.file))
    expect([...named].filter(file => !present.has(file))).toEqual([])
  })

  it('the shell-name collector matches every resolver call span, whatever spelling binds the name', () => {
    const spans = prompts.flatMap(callSpans)
    const budgeted = prompts.reduce((total, p) => total + (CALL_BUDGET[p.file]?.direct ?? 0), 0)
    expect(spans.length, 'the resolver call spans differ from the call budget').toBe(budgeted)
    expect(spans.filter(span => !hasName(span)).map(squash), 'a resolver call span that the name pattern does not match').toEqual([])
  })

  it('the shell-line collector sees base-value lines: names and BASE_REF uses', () => {
    const spans = prompts
      .filter(p => !DEFERRED_FILES.includes(p.file))
      .flatMap(p => sourceLines(p.text).flatMap(commandSpans))
      .filter(s => hasName(s) || new RegExp(HEX_PATTERN).test(s) || s.includes('resolve-base.cjs'))
    expect(spans.length, 'the shell-line collector found no line that names a base value').toBeGreaterThanOrEqual(4)
  })
})

describe('known-bad probes: each collector reports the seeded bad text and passes the good text', () => {
  const nameSites = (file: string, text: string): string[] => collectNameSites(seeded(file, text)).map(f => f.anchor)
  const CHECKED = `${CHECK_SEED}\n`

  it('shell-name: an unguarded unquoted name in a diff line is reported', () => {
    expect(nameSites('commands/implement.md', 'run `git diff --name-only {BASE_BRANCH}...HEAD`')).toHaveLength(1)
  })

  it('shell-name: a name inside a merge-base probe on a spawn line is reported', () => {
    expect(nameSites('commands/implement.md', 'BASE_SHA: {output of `git merge-base {BASE_BRANCH} HEAD`}')).toHaveLength(1)
  })

  it('shell-name: a name in a shell fence is reported', () => {
    expect(nameSites('git-ops/validate-branch.md', '```bash\ngit -C "{worktree}" diff {base_branch}...HEAD\n```')).toHaveLength(1)
  })

  it('shell-name: a double-quoted resolver call without a check before it is reported', () => {
    expect(nameSites('commands/implement.md', `\`${CALL_SEED('local "{BASE_BRANCH}"')}\``)).toHaveLength(1)
  })

  it('shell-name: an unquoted resolver call after its check is reported', () => {
    expect(nameSites('commands/implement.md', `${CHECKED}\`${CALL_SEED('local {BASE_BRANCH}')}\``)).toHaveLength(1)
  })

  it('shell-name: the resolver call and the PR target after their check pass, and so do BASE_REF uses', () => {
    expect(nameSites('commands/implement.md', `${CHECKED}\`${CALL_SEED('local "{BASE_BRANCH}"')}\``)).toEqual([])
    expect(nameSites('commands/implement.md', `${CHECKED}\`gh pr create --base "{BASE_BRANCH}"\``)).toEqual([])
    expect(nameSites('commands/implement.md', 'run `git diff --name-only --diff-filter=d {BASE_REF}...HEAD`')).toEqual([])
    expect(nameSites('git-ops/validate-branch.md', '`git -C "{worktree}" diff --name-only {base_ref}...HEAD; echo "exit=$?"`')).toEqual([])
  })

  it('shell-name: a name in an output template is not a shell line', () => {
    expect(nameSites('git-ops/validate-branch.md', '```markdown\n{list of files, from git diff {base}...HEAD --name-only}\n```')).toEqual([])
  })

  /** A resolver call as the Git ops and the re-validation reference write it: the name is bound to `B` first. */
  const bound = (value: string): string => `\`cd "{worktree}" && B=${value} && X=false && ${CALL_SEED('pr "${B}" --cross "${X}"; echo "exit=$?"')}\``

  it('shell-name: an unquoted angle-bracket name binding in a resolver call is reported, the double-quoted binding is not', () => {
    for (const placeholder of ['<name>', '<base_branch>']) {
      expect(nameSites('git-ops/ensure-pr-ready.md', `${CHECKED}${bound(placeholder)}`), `B=${placeholder}`).toHaveLength(1)
      expect(nameSites('git-ops/ensure-pr-ready.md', `${CHECKED}${bound(`"${placeholder}"`)}`), `B="${placeholder}"`).toEqual([])
    }
  })

  it('shell-name: an angle-bracket name binding without its check before it is reported', () => {
    for (const placeholder of ['<name>', '<base_branch>']) {
      expect(nameSites('git-ops/validate-branch.md', bound(`"${placeholder}"`)), `B="${placeholder}"`).toHaveLength(1)
    }
  })

  it('strict-copy: a stale copy outside a base source is reported, the exact copy is not', () => {
    expect(nameSites('agents/seeded.md', STALE_CHECK_SEED)).toHaveLength(1)
    expect(nameSites('agents/seeded.md', CHECKED)).toEqual([])
  })

  describe('strict-copy: any other check of the class is reported, in a base source as much as outside one', () => {
    const copySites = (file: string, text: string): string[] => collectNameSites(seeded(file, text)).filter(f => f.rule === 'strict-copy').map(f => f.anchor)
    const files = ['agents/seeded.md', ...Object.keys(CHECKED_SOURCES)]
    const widened: ReadonlyArray<readonly [string, string]> = [
      ['a longer length', STRICT.replace('{1,200}', '{1,255}')],
      ['an extra character', STRICT.replace('#-]', '#~-]')],
      ['a plus sign for the length', STRICT.replace('{1,200}', '+')],
      ['a reordered class', STRICT.replace('+@,#', '@+,#')],
      ['an extra character inside the +@,# run', STRICT.replace('+@,#', '+~@,#')],
      ['a lowercase-first class', STRICT.replace('A-Za-z0-9', 'a-zA-Z0-9')],
    ]

    for (const [label, copy] of widened) {
      it(`${label}`, () => {
        expect(copy, 'the widened copy equals the strict source').not.toBe(STRICT)
        for (const file of files) expect(copySites(file, `${CHECKED}Check again: \`${copy}\`.`), `${label} in ${file}`).toHaveLength(1)
      })
    }

    it('a second, different check in a base source', () => {
      expect(copySites('git-ops/validate-branch.md', `${CHECKED}${STALE_CHECK_SEED}`)).toHaveLength(1)
    })

    it('the exact check alone, in every file, and the branch-slug pattern are not copies', () => {
      for (const file of files) expect(copySites(file, CHECKED), file).toEqual([])
      expect(copySites('commands/implement.md', `${CHECKED}Slug: \`^[A-Za-z0-9._-]{1,200}$\`.`)).toEqual([])
    })

    it('a widened copy in a review command is reported, and so is the exact one', () => {
      const reviewCopies = (file: string, text: string): string[] =>
        collectRequirements(seeded(file, text)).filter(f => f.rule === 'strict-copy').map(f => f.anchor)
      for (const file of REVIEW_COMMANDS) {
        for (const [label, copy] of [...widened, ['the literal class with an extra character', '^[A-Za-z0-9._/+@,#~-]+$'] as const]) {
          expect(reviewCopies(file, `Extract: stop unless it matches \`${copy}\`.`), `${label} in ${file}`).toEqual(['no copy in the review commands'])
        }
        expect(reviewCopies(file, 'Extract: check the Base line and the hex base_ref.'), file).toEqual([])
      }
    })
  })

  for (const r of REQUIREMENTS) {
    const { file, anchor, bad, good } = r.probe
    it(`${r.rule} :: ${anchor} (${file}): the seeded bad text is reported and the good text is not`, () => {
      expect(appliesTo(r, file), 'the probe file is outside the requirement').toBe(true)
      const reported = (text: string): string[] => r.check(seeded(file, text)).map(u => u.anchor).filter(a => a.includes(anchor))
      expect(reported(bad), 'bad text').not.toEqual([])
      expect(reported(good), 'good text').toEqual([])
    })
  }

  it('RULES lists exactly the rule names that the requirements and the name-site collector report', () => {
    const reported = new Set<string>([
      ...REQUIREMENTS.map(r => r.rule),
      ...collectNameSites(seeded('commands/implement.md', 'run `git diff --name-only {BASE_BRANCH}...HEAD`')).map(f => f.rule),
      ...collectNameSites(seeded('agents/seeded.md', STALE_CHECK_SEED)).map(f => f.rule),
    ])
    expect([...reported].sort()).toEqual([...RULES].sort())
  })

  it('sink-exit: the code-review patch writes without an exit rule are reported, and with one are not', () => {
    const write = '```bash\ngit -C "{WORKTREE_PATH}" diff --no-color --no-ext-diff --no-textconv {DIFF_RANGE} > "{REVIEW_DIR}/diff.patch"\n```\n\nIt holds the whole diff of `DIFF_RANGE`.'
    const anchors = (text: string): string[] => sinkFindings(seeded('commands/code-review.md', text)).map(u => u.anchor).filter(a => a === 'patch writes')
    expect(anchors(write)).toEqual(['patch writes'])
    expect(anchors(`${write} A non-zero exit of any patch write stops.`)).toEqual([])
  })

  describe('sink-exit: each sink states its own stop fact, and its own empty-list fact when it states the rule', () => {
    for (const sink of SINKS) {
      it(`${sink.anchor} (${sink.file}): dropping its stop clause or its empty-list clause is reported, and an exit= echo does not stand in`, () => {
        const built = prompts.find(p => p.file === sink.file && p.arm === 'on')
        const region = built === undefined ? null : sink.region(built.text)
        expect(region, 'the sink text was not found in the built prompt').not.toBeNull()
        const text = region ?? ''
        expect(sinkFacts(sink, text), 'the built sink').toEqual([])

        const withoutStop = text.replace(sink.stop, '')
        expect(withoutStop, 'the stop clause was not found in the sink').not.toBe(text)
        expect(sinkFacts(sink, withoutStop)).toEqual([STOP_UNMET])
        expect(sinkFacts(sink, `${withoutStop}\necho "exit=$?"`), 'an exit= echo alone').toEqual([STOP_UNMET])

        if (sink.empty === undefined) return
        const withoutEmpty = text.replace(sink.empty, '')
        expect(withoutEmpty, 'the empty-list clause was not found in the sink').not.toBe(text)
        expect(sinkFacts(sink, withoutEmpty)).toEqual([EMPTY_UNMET])
      })
    }

    it('a sink that echoes only exit=$? is reported for both facts', () => {
      const echoOnly = '7. Compute diff scope: `git -C "{worktree}" diff --name-only {base_ref}...HEAD; echo "exit=$?"` → newline-separated file list'
      expect(sinkFindings(seeded('git-ops/validate-branch.md', echoOnly)).map(u => u.detail)).toEqual([STOP_UNMET, EMPTY_UNMET])
    })
  })

  it('resolver-call: a wrong script path, an unquoted name, a bad mode and a missing exit echo are each reported', () => {
    const errors = (rest: string, script = SCRIPT_REF): string[] => invocationErrors(`node "${script}" ${rest}`)
    expect(errors('local "{BASE_BRANCH}"; echo "exit=$?"')).toEqual([])
    expect(errors('local "{BASE_BRANCH}"; echo "exit=$?"', '$HOME/.devflow/scripts/other.cjs').join()).toContain('script')
    expect(errors('local {BASE_BRANCH}; echo "exit=$?"').join()).toContain('double-quoted')
    expect(errors('both "{BASE_BRANCH}"; echo "exit=$?"').join()).toContain('refuses')
    expect(errors('local "{BASE_BRANCH}"').join()).toContain('exit status')
    expect(errors('pr "{BASE_BRANCH}" --cross yes; echo "exit=$?"').join()).toContain('refuses')
  })

  it('resolver-call: a call count over or under the budget is reported', () => {
    const call = `\`${CALL_SEED('local "{BASE_BRANCH}"; echo "exit=$?"')}\`\n`
    const anchors = (file: string, text: string): string[] => callFindings(seeded(file, text)).map(u => u.anchor)
    expect(anchors('agents/seeded.md', call)).toContain('call count')
    expect(anchors('commands/dynamic-build.md', 'OPERATION: ensure-pr-ready')).toEqual([])
    expect(anchors('commands/dynamic-build.md', 'OPERATION: ensure-pr-ready\nOPERATION: ensure-pr-ready')).toContain('ensure-pr-ready spawns')
    expect(anchors('commands/dynamic-build.md', 'no spawn')).toContain('ensure-pr-ready spawns')
  })

  it('resolver-call: the re-validation reference makes one pr call and one local call, never two of a mode', () => {
    const pr = `\`${CALL_SEED('pr "${B}" --cross "${X}"; echo "exit=$?"')}\``
    const local = `\`${CALL_SEED('local "${B}"; echo "exit=$?"')}\``
    const details = (text: string): string[] => callFindings(seeded('references/implement-revalidate.md', text)).map(u => u.detail)
    expect(details(`${pr} when gh returned a PR, else ${local}`)).toEqual([])
    expect(details(`${pr} when gh returned a PR, else ${pr}`)).toEqual(['modes pr,pr where local,pr are expected'])
    expect(details(pr)).toEqual(['found 1 direct call(s), expected 2', 'modes pr where local,pr are expected'])
  })

  it('reason-fix-table: a copy that differs from the ensure-pr-ready sentence, or lacks the re-run, is reported', () => {
    expect(CANONICAL_FIX_TABLE, 'ensure-pr-ready step 5b holds no reason-to-fix sentence').not.toBeNull()
    const canonical = CANONICAL_FIX_TABLE ?? ''
    const details = (text: string): string[] => fixTableFindings(seeded('commands/implement.md', text)).map(u => u.detail)
    expect(details(canonical)).toEqual([])
    expect(details(canonical.replace('`git fetch --unshallow`', '`git fetch --depth=1000`'))).toEqual(['the sentence differs from the ensure-pr-ready step 5b sentence'])
    expect(details('The file names no fix for a base stop.')).toEqual(['the file has no reason-to-fix sentence'])
    expect(details(canonical.replace('invalid-name the allowed set', 'fetch-failed `git fetch`; invalid-name the allowed set'))).toEqual([
      'a fix for a reason that has none: fetch-failed',
      'the sentence differs from the ensure-pr-ready step 5b sentence',
    ])
    expect(details(canonical.replace(`\`${RESOLVER_FIX}\``, '`run devflow init`'))).toEqual([
      'resolver-unavailable does not say to re-run before devflow init',
      'the sentence differs from the ensure-pr-ready step 5b sentence',
    ])
  })
})

describe('accepted names reach each use as one literal word (AC-8)', () => {
  const SPECIALS = [...'._/+@,#-']

  /** A corpus of names the class admits: plain names, slash names, and each admitted special at the middle and the end. */
  function acceptedNames(): string[] {
    const names = ['main', 'master', 'develop', 'trunk', '0', 'v1.0.0', 'release/1.2', 'feature/a+b', 'user@host', 'a,b', 'x#y', 'a_b', 'a-b', 'a'.repeat(200)]
    for (const c of SPECIALS) names.push(`a${c}b`, `a${c}`, ...('-#'.includes(c) ? [] : [`${c}a`]))
    return names
  }

  /** The uses: every resolver call and PR target that takes a name in the corpus, and the seeded forms of both. */
  function useTemplates(): string[] {
    const fromCorpus = prompts.flatMap(p => sourceLines(p.text).flatMap(commandSpans)).filter(s => hasName(s) && isAllowedUse(s))
    return [...fromCorpus, CALL_SEED('local "{BASE_BRANCH}"; echo "exit=$?"'), CALL_SEED('pr "{BASE_BRANCH}" --cross false'), 'gh pr create --base "{BASE_BRANCH}"']
  }

  it('the class admits every generated name', () => {
    const names = acceptedNames()
    expect(names.length).toBeGreaterThanOrEqual(20)
    expect(names.filter(n => !resolver.STRICT_NAME_RE.test(n))).toEqual([])
  })

  it('each admitted name stays one double-quoted word and every character in it is literal', () => {
    const uses = useTemplates()
    expect(uses.length).toBeGreaterThanOrEqual(3)
    const bad: string[] = []
    for (const name of acceptedNames()) {
      if (/[$`\\"!]/.test(name)) bad.push(`${name}: holds a character that is not literal inside double quotes`)
      for (const use of uses) {
        const filled = use.replace(new RegExp(NAME_PATTERN, 'g'), () => name)
        // The name is one double-quoted word, or the double-quoted value of the `B=` binding that the call then passes as "${B}".
        const kept = shellWords(filled).some(w => (w.value === name && w.quoted === 'double') || (w.value === `B=${name}` && filled.includes(`B="${name}"`)))
        if (!kept) bad.push(`${name}: not one double-quoted word in ${use.slice(0, 60)}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('known-bad probe: a name outside the class is refused, and an unquoted use does not keep it as a quoted word', () => {
    expect(resolver.STRICT_NAME_RE.test('a b')).toBe(false)
    expect(resolver.STRICT_NAME_RE.test('a"b')).toBe(false)
    expect(shellWords('git diff main...HEAD').some(w => w.quoted === 'double')).toBe(false)
  })
})

describe('deferred scope stays visible', () => {
  it('each deferred prompt file still holds a site the name-site collector would report', () => {
    for (const file of DEFERRED_FILES) {
      const here = prompts.filter(p => p.file === file)
      expect(here.length, `${file} is not in the corpus`).toBeGreaterThan(0)
      expect(here.flatMap(p => collectNameSites(p, true)).length, `${file} no longer holds a flagged site: remove it from the deferred list`).toBeGreaterThan(0)
    }
  })

  it('each deferred skill file still holds a literal base name in a diff range', () => {
    for (const rel of DEFERRED_SKILL_FILES) {
      const text = readFileSync(path.join(ROOT, rel), 'utf-8')
      expect(LITERAL_BASE_RANGE_RE.test(text), `${rel} no longer holds a literal base range: remove it from the deferred list`).toBe(true)
    }
  })
})

describe('the Git op copies agree', () => {
  it('step 5 of ensure-pr-ready is identical under every tracker provider', () => {
    const step5 = (provider: string): string | null => listItem(ensurePrReadyReference(provider), /^5\.\s/)
    const github = step5('github')
    expect(github, 'step 5 was not found').not.toBeNull()
    expect(step5('jira')).toBe(github)
    expect(step5('linear')).toBe(github)
  })
})

describe('no base site is flagged (AC-16)', () => {
  it('every collector finds nothing in the built prompts', () => {
    expect(findings.map(describeFinding)).toEqual([])
  })
})

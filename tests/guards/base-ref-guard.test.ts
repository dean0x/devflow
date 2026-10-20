/**
 * tests/guards/base-ref-guard.test.ts
 *
 * The base-ref guard for #495 (use a fresh base for branch diffs, tighten branch-name
 * validation). It reads the BUILT prompts: the commands, the agents and the Git-op
 * references, in both learning variants, plus the hand-authored /implement re-validation
 * reference. It collects every shell line that names a base value and checks each site
 * against the rules below.
 *
 *   AC-8   A base name never reaches a shell line. The Write tool puts it in a temp file, and the
 *          resolver call and the PR target read that file. A name file or a title file is
 *          removed with the plain `rm --` form: a flagged `rm` (`-f`, `-rf`, `--force`) in a
 *          resolver call or beside either file is a finding. Every other command takes the
 *          BASE_REF value (a commit id).
 *   AC-9   Every base source carries a check that equals the exported STRICT_NAME_RE and
 *          states the allowed set. The code-review and bug-analysis commands carry no copy
 *          of it. No prompt copies LINE_RE or FALLBACK_LINE.
 *   AC-10  Diff sinks take the BASE_REF value. A non-zero diff exit stops the step, and an
 *          empty list counts only with exit 0.
 *   AC-15  The invocation text is accepted by the script's own argument parser. The name slot
 *          holds `--name-stdin`, and the call reads the name file with `< "$F"`. No resolver
 *          call carries a name word, a shell variable bound to the name or an extra positional
 *          word. Every resolver call is counted per file (the call budget).
 *   AC-16  No built prompt carries a flagged base site: every collector finds nothing.
 *   Review ranges  Every review spawn of the ticket workflow in dynamic-build takes
 *          `DIFF_RANGE: {base commit}...HEAD` on its own line. The base commit is the 40 or 64
 *          lowercase hex commit that the setup spawn reports, and a ticket without one stops with
 *          `base-missing` before the implement phase. The changed-files list of the wave evidence step
 *          starts at the hex Base ref, filters deletions and checks the diff exit. The review-pass
 *          description states the same source (the `review-range` rule).
 *
 * This file holds the sweeps that find a new site anywhere in the corpus. The text one command
 * or one Git op states alone belongs to its own guard: the review commands' Return, Extract,
 * full-range, DIFF_RANGE and freshness text (`collectFreshBaseDefects` in tests/helpers.ts, driven
 * by tests/guards/code-review-diff-gating.test.ts and tests/bug-analysis/structural.test.ts), the
 * review agent's DIFF_RANGE rule (code-review-diff-gating), /implement's Phase 1 and
 * re-validation text (tests/evidence/implement-flow.test.ts) and the Git ops' steps 5 to 7
 * (tests/git-agent.test.ts).
 *
 * How a site is identified. Every collector returns Findings: a file label, the learning
 * arm, a rule and an anchor. For a shell line the anchor is the command text. For a
 * required text the anchor is a fixed site label (the requirement table names it).
 *
 * Every collector has a known-bad probe on seeded text (in memory; nothing is written
 * into dist/ or src/) and a non-empty-corpus assertion, so a green result cannot come
 * from a collector that finds nothing.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

import {
  FLAGGED_RM,
  MIN_COMPILED_PROMPTS,
  ROOT,
  collectStaleOutputs,
  compiledPrompts,
  ensurePrReadyReference,
  findNameClassCopies,
  gitOperationReferenceCorpus,
  parseFences,
  readAgentReference,
  requireDistFile,
  requireDistFiles,
  resolveAllAgents,
  resolveLearningOffSource,
} from '../helpers.js'
import { RESOLVE_BASE_SCRIPT } from '../evidence/seam.js'

// ---------------------------------------------------------------------------
// The script seam: the exported constants are the one source of truth
// ---------------------------------------------------------------------------

interface ParsedArgs { readonly kind: 'ok' | 'stdin' | 'usage' }

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
    const off = resolveLearningOffSource('commands', name.replace(/\.md$/, ''))
    if (off !== null) prompts.push(seeded(`commands/${name}`, off, 'off'))
  }
  for (const [name, source] of resolveAllAgents()) {
    prompts.push(seeded(`agents/${name}.md`, source.content))
    const off = resolveLearningOffSource('agents', name)
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

/** Every code span on a line, whatever command it holds: a whole line in a shell fence, and each inline code span. */
function codeSpans(line: SourceLine): string[] {
  if (line.tag !== null && TEMPLATE_TAGS.has(line.tag)) return []
  const trimmed = line.text.trim()
  if (line.tag !== null && SHELL_TAGS.has(line.tag)) return trimmed === '' ? [] : [trimmed]
  return [...line.text.matchAll(/`([^`]+)`/g)].map(m => m[1])
}

/**
 * The placeholders that stand for a base NAME (the default-branch probe value is one): the brace forms anywhere, and
 * the angle-bracket forms only as the value of a variable binding (`B=<name>`, `B="<name>"`). A bare angle placeholder
 * is something else, such as `<isCrossRepository, else false>`. The literal `<base>` stays as written.
 */
const BRACE_NAME = '\\{(?:BASE_BRANCH|base_branch|base|base branch|default)\\}'
const BOUND_ANGLE_NAME = '\\b[A-Za-z_]\\w*="?<(?:name|base_branch)>"?'
const NAME_PATTERN = `(?:${BRACE_NAME}|${BOUND_ANGLE_NAME})`
const hasName = (s: string): boolean => new RegExp(NAME_PATTERN).test(s)
const HEX_PATTERN = '\\{(?:BASE_REF|base_ref)\\}'

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

const RULES = ['shell-name', 'strict-copy', 'grammar-copy', 'diff-range', 'sink-exit', 'resolver-call', 'file-removal', 'reason-fix-table', 'review-range'] as const

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

/** These prompts stay out of the name-site collectors while they hold a site those collectors would report; the test at the end checks that each still does. */
const DEFERRED_FILES: readonly string[] = [
  // Its review ranges are read by the review-range rule.
  'commands/dynamic-build.md',
  // Its caller passes the resolved range.
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

/** A line that holds the exact copy of the strict class and states the allowed set. */
function hasCheckLine(text: string): boolean {
  return text.split('\n').some(line => line.includes(`\`${STRICT}\``) && ALLOWED_SET_PARTS.every(part => line.includes(part)))
}

/** A base name never reaches a shell line: the resolver call and the PR target read it from the name file. */
function collectNameSites(p: Prompt, includeDeferred = false): Finding[] {
  if (!includeDeferred && DEFERRED_FILES.includes(p.file)) return []
  const found: Finding[] = []
  for (const line of sourceLines(p.text)) {
    for (const span of commandSpans(line)) {
      if (!hasName(span)) continue
      found.push({ rule: 'shell-name', file: p.file, arm: p.arm, anchor: squash(span), detail: 'a base name reaches a shell line; a command takes it only from the name file' })
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
  // One ensure-pr-ready call per wave PR.
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

/** The shell variables a resolver call may bind or expand: HOME in the script path, the name file F and the cross value X. */
const CALL_VARIABLES: ReadonlySet<string> = new Set(['HOME', 'F', 'X'])
const VARIABLE_BINDING_RE = /^([A-Za-z_]\w*)=/
const VARIABLE_EXPANSION_RE = /\$\{?([A-Za-z_]\w*)\}?/g

/**
 * Why a resolver call is not the invocation the script accepts; empty when it is. The name slot holds `--name-stdin`,
 * the call reads the name file with `< "$F"`, and the span binds and expands no variable but F and X. A positional
 * name, a variable bound to the name, its expansion, an extra positional word and a flagged `rm` are each reported.
 */
function invocationErrors(span: string): string[] {
  const words = shellWords(span)
  const at = words.findIndex(w => w.value.endsWith('resolve-base.cjs'))
  if (at === -1) return ['no script word']
  const errors: string[] = []
  if (words[at - 1]?.value !== 'node') errors.push('the script is not started with node')
  if (words[at].value !== SCRIPT_REF) errors.push(`the script path is not ${SCRIPT_REF}`)
  const args: Word[] = []
  for (const w of words.slice(at + 1)) {
    if (w.value === ';' || w.value.startsWith('<') || /^\d*>/.test(w.value)) break
    args.push(w)
  }
  const crossAt = args.findIndex(w => w.value === '--cross')
  const argv = args.map((w, i) => (crossAt !== -1 && i === crossAt + 1 && /^[${]/.test(w.value) ? 'true' : w.value))
  if (resolver.parseArgs(argv).kind === 'usage') errors.push('the script refuses these arguments')
  if (args[1]?.value !== '--name-stdin') errors.push('the name slot does not hold --name-stdin; a positional name is not allowed')
  if (args.length > (args[2]?.value === '--cross' ? 4 : 2)) errors.push('an extra positional word follows the arguments')
  const redirect = words.slice(at + 1 + args.length)
  if (redirect[0]?.value !== '<' || redirect[1]?.value !== '$F' || redirect[1].quoted !== 'double') errors.push('the call does not read the name file with `< "$F"`')
  const bound = words.slice(0, at).map(w => VARIABLE_BINDING_RE.exec(w.value)?.[1]).filter((v): v is string => v !== undefined && !CALL_VARIABLES.has(v))
  if (bound.length > 0) errors.push(`a shell variable is bound before the call: ${bound.join(', ')}`)
  const expanded = [...span.matchAll(VARIABLE_EXPANSION_RE)].map(m => m[1]).filter(v => !CALL_VARIABLES.has(v))
  if (expanded.length > 0) errors.push(`a shell variable is expanded in the call: ${expanded.join(', ')}`)
  if (FLAGGED_RM.test(span)) errors.push('the name file is removed with a flagged rm')
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

/** A code span that names a name file or a title file: the file placeholders, or the `$F` operand that holds the file. */
const FILE_OPERAND_RE = /\{(?:name|title) file\}|\$\{?F\b/

/**
 * Name files and title files are removed with the plain `rm --` form. A flagged `rm` in a span that names either file
 * is reported; a resolver call is judged whole by `invocationErrors`, and an unrelated flagged `rm` is not this rule's.
 */
function fileRemovalFindings(p: Prompt): Unmet[] {
  return sourceLines(p.text).flatMap(codeSpans)
    .filter(span => FILE_OPERAND_RE.test(span) && !span.includes('resolve-base.cjs') && FLAGGED_RM.test(span))
    .map(span => ({ anchor: 'name or title file removal', detail: `a flagged rm beside a name or title file: ${squash(span).slice(0, 80)}` }))
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

// ---------------------------------------------------------------------------
// Collector: review ranges start at the commit that setup reported
// ---------------------------------------------------------------------------

const TICKET_WORKFLOW_MARKER = 'name: "devflow-dynamic-build"'
/** The line every review spawn of a ticket carries: the commit that setup reported, to HEAD. */
const RANGE_LINE = 'DIFF_RANGE: ${BASE_SHA}...HEAD'
const RANGE_LINE_RE = /^DIFF_RANGE: \$\{BASE_SHA\}\.\.\.HEAD$/m
/** The end of the review-scope string: the range line on its own line, and a newline after it. */
const SCOPE_TAIL = `\\n${RANGE_LINE}\\n`
const BASE_BINDING = 'const BASE_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(String(setup?.baseSha ?? "")) ? setup.baseSha : "(none)";'
const SETUP_BASE_RETURN = '"baseSha": "<the 40 or 64 hex git rev-parse HEAD prints before step 4>"'
const BASE_STOP = 'if (BASE_SHA === "(none)") {'

/** The parts the review-scope description of the engine states: the range, its source and the stop. */
const SCOPE_LINE_PARTS: readonly string[] = [
  '`DIFF_RANGE: {base commit}...HEAD`',
  'the base commit is the 40 or 64 hex commit that the ticket branch was forked from',
  'as the setup step reported it',
  'a ticket with none stops `base-missing`',
]

/** The parts of the changed-files step of the wave evidence: its source, its command and its stop. */
const CHANGED_FILES_PARTS: ReadonlyArray<readonly [string, string]> = [
  ['Take `{base_ref}` from step 6\'s `- **Base ref**:` line', 'the list does not start from the Base ref that step 6 returned'],
  ['git -C "{integration worktree root}" diff --name-only --diff-filter=d {base_ref}...HEAD; echo "exit=$?"', 'the command is not the name-only diff that starts at {base_ref}, filters deletions and echoes its exit status'],
  ['Unless `{base_ref}` is 40 or 64 lowercase hex and the diff prints `exit=0`', 'the step does not require a 40 or 64 lowercase hex {base_ref} and a zero diff exit'],
  ['record `TRACEABILITY: DEGRADED (wave base unusable)` and skip this step.', 'the step does not record one degraded line and skip'],
]

/** The one fence of a command that holds the ticket workflow, or null. */
function ticketWorkflow(text: string): string | null {
  const hits = parseFences(text).filter(f => f.includes(TICKET_WORKFLOW_MARKER))
  return hits.length === 1 ? hits[0] : null
}

/** The text of each Review spawn: from its `agent(` to its `agentType: "Review"`. */
function reviewSpawns(workflow: string): string[] {
  return [...workflow.matchAll(/agentType: "Review"/g)].map(m => {
    const from = workflow.lastIndexOf('agent(', m.index)
    return from === -1 ? '' : workflow.slice(from, m.index)
  })
}

/** The block of a text that opens with `marker`, or null unless the marker occurs once. */
function blockOf(text: string, marker: string): string | null {
  const at = text.indexOf(marker)
  if (at === -1 || text.indexOf(marker, at + marker.length) !== -1) return null
  const block = splitBlocks(text).find(b => at >= b.start && at <= b.end)
  return block === undefined ? null : text.slice(block.start, block.end)
}

/** Why the setup spawn, the base binding and the base stop do not give every later spawn a hex base commit; empty when they do. */
function baseCommitFindings(workflow: string): Unmet[] {
  const out: Unmet[] = []
  const setupAt = workflow.indexOf('OPERATION: setup-task')
  const setupEnd = setupAt === -1 ? -1 : workflow.indexOf('agentType: "Git"', setupAt)
  if (setupEnd === -1 || !workflow.slice(setupAt, setupEnd).includes(SETUP_BASE_RETURN)) {
    out.push(...unmet('setup Return', 'the setup spawn does not ask for baseSha: the 40 or 64 hex that git rev-parse HEAD prints before the branch is made'))
  }
  const bindings = workflow.match(/^const BASE_SHA = .*$/gm) ?? []
  if (bindings.length !== 1) out.push(...unmet('BASE_SHA binding', `${bindings.length} const BASE_SHA bindings, expected 1`))
  else if (!bindings[0].startsWith(BASE_BINDING)) out.push(...unmet('BASE_SHA binding', 'BASE_SHA is not the 40 or 64 lowercase hex commit that setup reported, else "(none)"'))
  if ((workflow.match(/\bBASE_SHA\s*=(?!=)/g) ?? []).length > 1) out.push(...unmet('BASE_SHA binding', 'BASE_SHA is assigned more than once'))
  const stopAt = workflow.indexOf(BASE_STOP)
  if (stopAt === -1) return [...out, ...unmet('base stop', 'no stop on a missing base commit')]
  const stopEnd = workflow.indexOf('\n}', stopAt)
  const stop = workflow.slice(stopAt, stopEnd === -1 ? stopAt : stopEnd)
  if (!stop.includes('verdict: "ESCALATED"') || !stop.includes('type: "base-missing"')) out.push(...unmet('base stop', 'the stop does not escalate with type base-missing'))
  const implementAt = workflow.indexOf('phase("implement"')
  if (implementAt === -1 || implementAt < stopAt) out.push(...unmet('base stop', 'the base stop does not come before the implement phase'))
  const bindingAt = workflow.search(/^const BASE_SHA = /m)
  if (bindingAt !== -1 && bindingAt < stopAt && /\b(?:agent|phase)\(/.test(workflow.slice(bindingAt, stopAt))) {
    out.push(...unmet('base stop', 'a spawn or a phase runs between the base binding and the base stop'))
  }
  return out
}

/** Why a Review spawn, or the string that two of them share, does not carry the range from the base commit; empty when each does. */
function reviewSpawnFindings(workflow: string): Unmet[] {
  const out: Unmet[] = []
  const spawns = reviewSpawns(workflow)
  if (spawns.length === 0) out.push(...unmet('Review call', 'the ticket workflow holds no Review spawn'))
  for (const spawn of spawns) {
    if (!spawn.includes('${reviewScope}') && !RANGE_LINE_RE.test(spawn)) {
      out.push(...unmet('Review call', `a Review spawn that carries no range from the resolved base commit: ${squash(spawn).slice(0, 60)}`))
    }
  }
  const scope = /^\s*const reviewScope = `([^`]*)`;/m.exec(workflow)
  if (scope === null) out.push(...unmet('reviewScope', 'the ticket workflow holds no reviewScope string'))
  else if (!scope[1].endsWith(SCOPE_TAIL)) out.push(...unmet('reviewScope', `reviewScope does not end with ${RANGE_LINE} on its own line and a newline`))
  return out
}

/** Why the prose that states the review range source, and the changed-files step of the wave evidence, differ from the spawns; empty when they agree. */
function rangeSourceFindings(text: string): Unmet[] {
  const out: Unmet[] = []
  const lines = text.split('\n').filter(l => l.startsWith('**Review scope:**'))
  if (lines.length !== 1) out.push(...unmet('review scope description', `${lines.length} Review scope lines, expected 1`))
  else out.push(...SCOPE_LINE_PARTS.filter(part => !lines[0].includes(part)).flatMap(part => unmet('review scope description', `the description does not state: ${part}`)))
  if (!/"type": "[^"\n]*\bbase-missing\b[^"\n]*"/.test(text)) out.push(...unmet('escalation types', 'the escalation type list does not name base-missing'))
  const changed = blockOf(text, '**Changed files.**')
  if (changed === null) return [...out, ...unmet('changed files', 'the wave evidence step has no single Changed files paragraph')]
  out.push(...CHANGED_FILES_PARTS.filter(([part]) => !changed.includes(part)).flatMap(([, detail]) => unmet('changed files', detail)))
  if (!text.includes('FILES_CHANGED: {the file list that diff printed}')) out.push(...unmet('changed files', 'the Test spawn does not take the list that diff printed'))
  return out
}

/** The review-range rule: every review spawn takes its range from the commit that setup reported, and the prose states the same source. */
function reviewRangeFindings(p: Prompt): Unmet[] {
  const workflow = ticketWorkflow(p.text)
  if (workflow === null) return unmet('ticket workflow', 'the command holds no single ticket workflow fence')
  return [...baseCommitFindings(workflow), ...reviewSpawnFindings(workflow), ...rangeSourceFindings(p.text)]
}

const CALL_SEED = (rest: string, script: string = SCRIPT_REF): string => `node "${script}" ${rest}`
/** What a resolver call span holds before the script: the name file bound and removed by a plain-rm trap, the worktree and the cross value. */
const CALL_PREFIX = `F="{name file}"; trap 'rm -- "$F"' EXIT; cd "{worktree}" && X=false && `
/** A resolver call as the Git ops and the re-validation reference write it. */
const callOf = (rest: string, prefix: string = CALL_PREFIX, script: string = SCRIPT_REF): string => `${prefix}${CALL_SEED(rest, script)}`
const PR_REST = 'pr --name-stdin --cross "${X}" < "$F"; echo "exit=$?"'
const LOCAL_REST = 'local --name-stdin < "$F"; echo "exit=$?"'
const CHECK_SEED = `Stop the run unless it matches \`${STRICT}\`, telling the user it allows ASCII letters, digits and \`._/+@,#-\`, at most 200; no leading \`-\` or \`#\`, no \`origin/\` prefix, no \`..\`.`
const STALE_CHECK_SEED = 'Stop the run unless it matches `^[A-Za-z0-9._/+@,#-]{1,200}$`, telling the user it allows only ASCII letters, digits and `._/+@,#-`, at most 200.'

/** `text` with the one occurrence of `from` replaced by `to`; it throws unless there is exactly one, so no seed is inert. */
function withOnce(text: string, from: string, to: string): string {
  const first = text.indexOf(from)
  if (first === -1 || text.indexOf(from, first + from.length) !== -1) throw new Error(`withOnce: expected exactly one "${from.slice(0, 80)}"`)
  return text.slice(0, first) + to + text.slice(first + from.length)
}

const BUILT_TICKET_COMMAND = requireDistFile('dynamic-build.md')
const SCOPE_DEFINITION_TAIL = `${SCOPE_TAIL}\`;`
const PANEL_RANGE = `${RANGE_LINE}\nLens `

/** A defect seeded into the built ticket command: its label, the text it replaces, the replacement and the finding it must give. */
type RangeSeed = readonly [label: string, from: string, to: string, detail: string]

const NO_RANGE = 'a Review spawn that carries no range from the resolved base commit'
const REVIEW_RANGE_SEEDS: readonly RangeSeed[] = [
  ['the focus spawns carry no scope', ' review. ${reviewScope}\nFocus discipline', ' review.\nFocus discipline', NO_RANGE],
  ['the retry carries no scope', ' review. ${reviewScope} Focus: ${focus} discipline.', ' review. Focus: ${focus} discipline.', NO_RANGE],
  ['the panel carries no range line', PANEL_RANGE, 'Lens ', NO_RANGE],
  ['the panel range shares its line with other text', PANEL_RANGE, `Range ${PANEL_RANGE}`, NO_RANGE],
  ['the panel range starts at a base branch', PANEL_RANGE, PANEL_RANGE.replace('BASE_SHA', 'BASE_BRANCH'), NO_RANGE],
  ['a new Review spawn carries no range', '// Phase 5: Review', 'await agent("Review once more.", { agentType: "Review" });\n// Phase 5: Review', NO_RANGE],
  ['the scope range starts at the branch', SCOPE_DEFINITION_TAIL, SCOPE_DEFINITION_TAIL.replace('BASE_SHA', 'BRANCH'), 'reviewScope does not end with'],
  ['the scope string has no final newline', SCOPE_DEFINITION_TAIL, `\\n${RANGE_LINE}\`;`, 'reviewScope does not end with'],
  ['the hex test admits uppercase', 'const BASE_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/', 'const BASE_SHA = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/', 'BASE_SHA is not the 40 or 64 lowercase hex commit'],
  ['the base commit has no hex test', BASE_BINDING, 'const BASE_SHA = setup?.baseSha || "(none)";', 'BASE_SHA is not the 40 or 64 lowercase hex commit'],
  ['the base commit is assigned twice', BASE_STOP, `BASE_SHA = "HEAD";\n${BASE_STOP}`, 'BASE_SHA is assigned more than once'],
  ['the setup spawn does not ask for baseSha', `, ${SETUP_BASE_RETURN}`, '', 'the setup spawn does not ask for baseSha'],
  ['there is no base stop', BASE_STOP, 'if (false) {', 'no stop on a missing base commit'],
  ['the base stop does not escalate with base-missing', 'type: "base-missing", description: "setup-task', 'type: "branch-missing", description: "setup-task', 'the stop does not escalate with type base-missing'],
  ['the base stop comes after the implement phase', '// Base stop: every review range', 'await phase("implement", () => agent("x", { agentType: "Code" }));\n// Base stop: every review range', 'the base stop does not come before the implement phase'],
  ['a spawn runs between the base binding and the base stop', '// Base stop: every review range', 'await agent("x", { agentType: "Git" });\n// Base stop: every review range', 'a spawn or a phase runs between the base binding and the base stop'],
  ['the changed-files diff keeps deletions', '--diff-filter=d {base_ref}...HEAD', '{base_ref}...HEAD', 'the command is not the name-only diff'],
  ['the changed-files diff starts at a branch', '--diff-filter=d {base_ref}...HEAD', '--diff-filter=d main...HEAD', 'the command is not the name-only diff'],
  ['the changed-files diff does not echo its exit status', '{base_ref}...HEAD; echo "exit=$?"', '{base_ref}...HEAD', 'the command is not the name-only diff'],
  ['the changed-files step takes any base ref', 'Unless `{base_ref}` is 40 or 64 lowercase hex and the diff prints `exit=0`', 'Unless the diff prints `exit=0`', 'the step does not require a 40 or 64 lowercase hex {base_ref}'],
  ['the changed-files step does not skip with one degraded line', 'record `TRACEABILITY: DEGRADED (wave base unusable)` and skip this step.', 'skip this step.', 'the step does not record one degraded line and skip'],
  ['the changed-files step reads another base', 'Take `{base_ref}` from step 6\'s `- **Base ref**:` line', 'Take `{base_ref}` from the branch', 'the list does not start from the Base ref that step 6 returned'],
  ['the Test spawn takes another list', 'FILES_CHANGED: {the file list that diff printed}', 'FILES_CHANGED: {the branch diff}', 'the Test spawn does not take the list that diff printed'],
  ['the review-pass description names no stop', '; a ticket with none stops `base-missing`.', '.', 'the description does not state: a ticket with none stops `base-missing`'],
  ['the review-pass description names another range', '`DIFF_RANGE: {base commit}...HEAD`', '`DIFF_RANGE: {base branch}...HEAD`', 'the description does not state: `DIFF_RANGE: {base commit}...HEAD`'],
  ['the escalation types omit base-missing', ' | base-missing"', '"', 'the escalation type list does not name base-missing'],
]

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
      bad: `5a. ${'`'}${callOf('pr --name-stdin --cross maybe < "$F"; echo "exit=$?"')}${'`'}`,
      good: `5a. ${'`'}${callOf(PR_REST)}${'`'}`,
    },
  },
  {
    rule: 'file-removal',
    files: '*',
    check: fileRemovalFindings,
    probe: {
      file: 'git-ops/ensure-pr-ready.md',
      anchor: 'name or title file removal',
      bad: 'An empty file ends with Status BLOCKED after `rm -f "{name file}"`.',
      good: 'An empty file ends with Status BLOCKED after `rm -- "{name file}"`.',
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
  {
    rule: 'review-range',
    files: ['commands/dynamic-build.md'],
    check: reviewRangeFindings,
    probe: {
      file: 'commands/dynamic-build.md',
      anchor: 'Review call',
      bad: withOnce(BUILT_TICKET_COMMAND, REVIEW_RANGE_SEEDS[0][1], REVIEW_RANGE_SEEDS[0][2]),
      good: BUILT_TICKET_COMMAND,
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

  it('holds both learning variants of the commands and the review agent, the Git ops and the re-validation reference', () => {
    expect(prompts.length).toBeGreaterThanOrEqual(MIN_COMPILED_PROMPTS)
    const have = (file: string, arm: Arm): boolean => prompts.some(p => p.file === file && p.arm === arm)
    for (const file of ['commands/implement.md', 'commands/code-review.md', 'commands/bug-analysis.md', 'agents/review.md']) {
      expect(have(file, 'on'), `${file} learning-on`).toBe(true)
      expect(have(file, 'off'), `${file} learning-off`).toBe(true)
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

  it('every resolver call span reads the name file on stdin and holds no name word', () => {
    const spans = prompts.flatMap(callSpans)
    const budgeted = prompts.reduce((total, p) => total + (CALL_BUDGET[p.file]?.direct ?? 0), 0)
    expect(spans.length, 'the resolver call spans differ from the call budget').toBe(budgeted)
    expect(spans.filter(hasName).map(squash), 'a resolver call span that holds a name word').toEqual([])
    expect(spans.filter(span => !/ --name-stdin\b[^;]*< "\$F"; echo "exit=\$\?"/.test(span)).map(squash), 'a resolver call span that does not read the name file').toEqual([])
  })

  it('both learning variants of the ticket command hold the ticket workflow with its three Review spawns: the focus spawns, the retry and the panel', () => {
    const variants = prompts.filter(p => p.file === 'commands/dynamic-build.md')
    expect(variants.map(p => p.arm).sort()).toEqual(['off', 'on'])
    for (const p of variants) {
      const workflow = ticketWorkflow(p.text)
      expect(workflow, `${p.arm}: the ticket workflow fence was not found`).not.toBeNull()
      const spawns = reviewSpawns(workflow ?? '')
      expect(spawns, `${p.arm}: the Review spawns`).toHaveLength(3)
      expect(spawns[0], `${p.arm}: the focus spawns`).toContain('Focus discipline')
      expect(spawns[1], `${p.arm}: the retry`).toContain('Retry ${focus} review.')
      expect(spawns[2], `${p.arm}: the panel`).toContain('Adversarially verify')
    }
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

  it('shell-name: a resolver call or a PR target that takes the name as a word is reported, quoted or not, checked or not', () => {
    for (const named of ['local "{BASE_BRANCH}"', 'local {BASE_BRANCH}', 'pr "{base_branch}" --cross "${X}"']) {
      expect(nameSites('commands/implement.md', `\`${CALL_SEED(named)}\``), named).toHaveLength(1)
      expect(nameSites('commands/implement.md', `${CHECKED}\`${CALL_SEED(named)}\``), `checked ${named}`).toHaveLength(1)
    }
    expect(nameSites('git-ops/ensure-pr-ready.md', `${CHECKED}\`gh pr create --base "{BASE_BRANCH}"\``)).toHaveLength(1)
  })

  it('shell-name: the stdin resolver call, the file-read PR target and BASE_REF uses pass', () => {
    expect(nameSites('commands/implement.md', `\`${callOf(PR_REST)}\``)).toEqual([])
    expect(nameSites('commands/implement.md', `\`${callOf(LOCAL_REST)}\``)).toEqual([])
    expect(nameSites('git-ops/ensure-pr-ready.md', '`test -s "$F" && gh pr create … --base="$(cat -- "$F")"`')).toEqual([])
    expect(nameSites('commands/implement.md', 'run `git diff --name-only --diff-filter=d {BASE_REF}...HEAD`')).toEqual([])
    expect(nameSites('git-ops/validate-branch.md', '`git -C "{worktree}" diff --name-only {base_ref}...HEAD; echo "exit=$?"`')).toEqual([])
  })

  it('shell-name: a name in an output template is not a shell line', () => {
    expect(nameSites('git-ops/validate-branch.md', '```markdown\n{list of files, from git diff {base}...HEAD --name-only}\n```')).toEqual([])
  })

  const BOUND_PREFIX = (value: string): string => `cd "{worktree}" && B=${value} && X=false && `

  it('shell-name: a variable bound to an angle-bracket name is reported, quoted or not, in the old positional call', () => {
    for (const placeholder of ['<name>', '<base_branch>']) {
      for (const value of [placeholder, `"${placeholder}"`]) {
        expect(nameSites('git-ops/ensure-pr-ready.md', `\`${callOf('pr "${B}" --cross "${X}"; echo "exit=$?"', BOUND_PREFIX(value))}\``), `B=${value}`).toHaveLength(1)
      }
    }
  })

  it('shell-name: an angle-bracket name counts only in a binding, and an unrelated placeholder in a shell span is not reported', () => {
    expect(nameSites('git-ops/ensure-pr-ready.md', '`cd "{worktree}" && X=<isCrossRepository, else false> && git rev-parse HEAD`')).toEqual([])
    expect(nameSites('git-ops/ensure-pr-ready.md', '`git -C "{worktree}" log -1 <name>`')).toEqual([])
    expect(nameSites('git-ops/ensure-pr-ready.md', '`git -C "{worktree}" log -1 B=<name>`')).toHaveLength(1)
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

  it('resolver-call: the stdin call in each mode is accepted', () => {
    expect(invocationErrors(callOf(PR_REST))).toEqual([])
    expect(invocationErrors(callOf(LOCAL_REST))).toEqual([])
  })

  describe('resolver-call: each seeded bad call is reported for its own defect', () => {
    const OLD_PREFIX = BOUND_PREFIX('"<name>"')
    const bad: ReadonlyArray<readonly [string, string, string]> = [
      ['the old positional call: a bound variable, its expansion and no stdin', callOf('pr "${B}" --cross "${X}"; echo "exit=$?"', OLD_PREFIX), 'a shell variable is bound before the call: B'],
      ['the old positional call: the expansion of the bound variable', callOf('pr "${B}" --cross "${X}"; echo "exit=$?"', OLD_PREFIX), 'a shell variable is expanded in the call: B'],
      ['the old positional call: the name slot', callOf('pr "${B}" --cross "${X}"; echo "exit=$?"', OLD_PREFIX), 'the name slot does not hold --name-stdin'],
      ['a literal name in the name slot, with the file on stdin', callOf('local main < "$F"; echo "exit=$?"'), 'the name slot does not hold --name-stdin'],
      ['a missing --name-stdin in pr mode', callOf('pr --cross "${X}" < "$F"; echo "exit=$?"'), 'the name slot does not hold --name-stdin'],
      ['a missing --name-stdin in local mode', callOf('local < "$F"; echo "exit=$?"'), 'the name slot does not hold --name-stdin'],
      ['a missing stdin redirect', callOf('pr --name-stdin --cross "${X}"; echo "exit=$?"'), 'the call does not read the name file'],
      ['a stdin redirect of another file', callOf('local --name-stdin < "$G"; echo "exit=$?"'), 'the call does not read the name file'],
      ['an unquoted stdin redirect', callOf('local --name-stdin < $F; echo "exit=$?"'), 'the call does not read the name file'],
      ['an extra positional word after the flag', callOf('local --name-stdin main < "$F"; echo "exit=$?"'), 'an extra positional word'],
      ['an extra positional word after the cross value', callOf('pr --name-stdin --cross "${X}" main < "$F"; echo "exit=$?"'), 'an extra positional word'],
      ['a flagged rm -f trap', callOf(PR_REST, CALL_PREFIX.replace('rm --', 'rm -f')), 'a flagged rm'],
      ['a flagged rm -rf trap', callOf(PR_REST, CALL_PREFIX.replace('rm --', 'rm -rf')), 'a flagged rm'],
      ['a wrong script path', callOf(LOCAL_REST, CALL_PREFIX, '$HOME/.devflow/other/resolve-base.cjs'), 'the script path'],
      ['a bad mode', callOf('both --name-stdin < "$F"; echo "exit=$?"'), 'refuses'],
      ['a cross value that is not true or false', callOf('pr --name-stdin --cross yes < "$F"; echo "exit=$?"'), 'refuses'],
      ['a missing exit echo', callOf('local --name-stdin < "$F"'), 'exit status'],
    ]
    it.each(bad)('%s', (_label, call, detail) => {
      expect(invocationErrors(call).join('; ')).toContain(detail)
    })
  })

  it('resolver-call: every built resolver span reports each defect seeded into its own text', () => {
    const spans = prompts.flatMap(callSpans)
    expect(spans.length, 'the corpus holds too few resolver call spans').toBeGreaterThanOrEqual(5)
    const mutations: ReadonlyArray<readonly [string, (span: string) => string]> = [
      ['a positional name in the name slot', span => span.replace('--name-stdin', '"${B}"')],
      ['no --name-stdin', span => span.replace('--name-stdin ', '')],
      ['no stdin redirect', span => span.replace(' < "$F"', '')],
      ['a trap with rm -f', span => span.replace('rm -- ', 'rm -f ')],
      ['a trap with rm -rf', span => span.replace('rm -- ', 'rm -rf ')],
      ['an extra positional word', span => span.replace(' < "$F"', ' main < "$F"')],
    ]
    for (const span of spans) {
      expect(invocationErrors(span), squash(span).slice(0, 80)).toEqual([])
      for (const [label, mutate] of mutations) {
        const mutated = mutate(span)
        expect(mutated, `${label} did not change the span`).not.toBe(span)
        expect(invocationErrors(mutated), `${label}: ${squash(span).slice(0, 80)}`).not.toEqual([])
      }
    }
  })

  it('file-removal: every built prompt that removes a name or title file reports the flagged spelling of its own text', () => {
    const removesFile = (p: Prompt): boolean => sourceLines(p.text).flatMap(codeSpans)
      .some(span => FILE_OPERAND_RE.test(span) && span.includes('rm -- ') && !span.includes('resolve-base.cjs'))
    const holders = prompts.filter(removesFile)
    expect(holders.length, 'the corpus holds too few name or title file removals').toBeGreaterThanOrEqual(2)
    for (const p of holders) {
      expect(fileRemovalFindings(p), p.file).toEqual([])
      expect(fileRemovalFindings({ ...p, text: p.text.replace(/rm -- /g, 'rm -f ') }), p.file).not.toEqual([])
    }
  })

  describe('file-removal: a flagged rm beside a name file or a title file is reported', () => {
    const removals = (text: string, file = 'git-ops/ensure-pr-ready.md'): string[] => fileRemovalFindings(seeded(file, text)).map(u => u.anchor)
    const flagged = ['rm -f', 'rm -rf', 'rm --force', 'rm -r']

    for (const form of flagged) {
      it(`${form} on the name file, the title file and the $F operand`, () => {
        expect(removals(`after \`${form} "{name file}"\``)).toHaveLength(1)
        expect(removals(`after \`${form} "{title file}"\``)).toHaveLength(1)
        expect(removals(`Run \`F="{title file}"; trap '${form} "$F"' EXIT; test -s "$F" && gh pr edit {PR_NUMBER} --title="$(cat -- "$F")"; echo "gh=$?"\`.`)).toHaveLength(1)
        expect(removals(`\`\`\`bash\nF="{name file}"\ntrap '${form} "$F"' EXIT\n\`\`\``)).toHaveLength(1)
      })
    }

    it('the plain rm -- form passes, and so does a flagged rm of an unrelated file', () => {
      expect(removals('after `rm -- "{name file}"`, and `rm -- "{title file}"`')).toEqual([])
      expect(removals('Run `F="{title file}"; trap \'rm -- "$F"\' EXIT; test -s "$F" && gh pr edit {PR_NUMBER} --title="$(cat -- "$F")"`.')).toEqual([])
      expect(removals('```bash\ntrap \'rm -rf "${CODEQL_TMP}"\' EXIT INT TERM\n```', 'commands/bug-analysis.md')).toEqual([])
    })

    it('a flagged rm in a resolver call is the call rule\'s finding, not a second one', () => {
      const span = callOf(PR_REST, CALL_PREFIX.replace('rm --', 'rm -f'))
      expect(removals(`\`${span}\``)).toEqual([])
      expect(callFindings(seeded('git-ops/ensure-pr-ready.md', `\`${span}\``)).map(u => u.detail).join('; ')).toContain('a flagged rm')
    })
  })

  it('resolver-call: a call count over or under the budget is reported', () => {
    const call = `\`${callOf(LOCAL_REST)}\`\n`
    const anchors = (file: string, text: string): string[] => callFindings(seeded(file, text)).map(u => u.anchor)
    expect(anchors('agents/seeded.md', call)).toContain('call count')
    expect(anchors('commands/dynamic-build.md', 'OPERATION: ensure-pr-ready')).toEqual([])
    expect(anchors('commands/dynamic-build.md', 'OPERATION: ensure-pr-ready\nOPERATION: ensure-pr-ready')).toContain('ensure-pr-ready spawns')
    expect(anchors('commands/dynamic-build.md', 'no spawn')).toContain('ensure-pr-ready spawns')
  })

  it('resolver-call: the re-validation reference makes one pr call and one local call, never two of a mode', () => {
    const pr = `\`${callOf(PR_REST)}\``
    const local = `\`${callOf(LOCAL_REST)}\``
    const details = (text: string): string[] => callFindings(seeded('references/implement-revalidate.md', text)).map(u => u.detail)
    expect(details(`${pr} when gh returned a PR, else ${local}`)).toEqual([])
    expect(details(`${pr} when gh returned a PR, else ${pr}`)).toEqual(['modes pr,pr where local,pr are expected'])
    expect(details(pr)).toEqual(['found 1 direct call(s), expected 2', 'modes pr where local,pr are expected'])
  })

  describe('review-range: each defect seeded into the built ticket command is reported for its own defect', () => {
    const variants = prompts.filter(p => p.file === 'commands/dynamic-build.md')
    const details = (p: Prompt): string => reviewRangeFindings(p).map(u => u.detail).join('\n')

    it('the built command in both learning variants has no finding', () => {
      expect(variants).toHaveLength(2)
      for (const p of variants) expect(reviewRangeFindings(p), p.arm).toEqual([])
    })

    it('a command with no ticket workflow fence is reported', () => {
      expect(reviewRangeFindings(seeded('commands/dynamic-build.md', 'Review the diff.\n')).map(u => u.anchor)).toEqual(['ticket workflow'])
    })

    it.each(REVIEW_RANGE_SEEDS)('%s', (_label, from, to, detail) => {
      for (const p of variants) {
        expect(from, `${p.arm}: the seed replaces itself`).not.toBe(to)
        expect(details({ ...p, text: withOnce(p.text, from, to) }), p.arm).toContain(detail)
      }
    })

    it('a seeded defect is reported by the requirement, with the rule name, on top of the corpus findings', () => {
      const [, from, to] = REVIEW_RANGE_SEEDS[0]
      const found = variants.flatMap(p => collectRequirements({ ...p, text: withOnce(p.text, from, to) }))
      expect(found.map(f => f.rule)).toEqual(['review-range', 'review-range'])
      expect(found.map(f => f.arm).sort()).toEqual(['off', 'on'])
    })
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

describe('accepted names reach the PR target as one literal word read from the name file (AC-8)', () => {
  const SPECIALS = [...'._/+@,#-']
  /** The PR target of step 4a: the name is the content of the name file, never command text. */
  const PR_TARGET = '--base="$(cat -- "$F")"'

  /** A corpus of names the class admits: plain names, slash names, and each admitted special at the middle and the end. */
  function acceptedNames(): string[] {
    const names = ['main', 'master', 'develop', 'trunk', '0', 'v1.0.0', 'release/1.2', 'feature/a+b', 'user@host', 'a,b', 'x#y', 'a_b', 'a-b', 'a'.repeat(200)]
    for (const c of SPECIALS) names.push(`a${c}b`, `a${c}`, ...('-#'.includes(c) ? [] : [`${c}a`]))
    return names
  }

  it('the class admits every generated name', () => {
    const names = acceptedNames()
    expect(names.length).toBeGreaterThanOrEqual(20)
    expect(names.filter(n => !resolver.STRICT_NAME_RE.test(n))).toEqual([])
  })

  it('the built step 4a passes the PR base only in the file-read form', () => {
    const op = prompts.find(p => p.file === 'git-ops/ensure-pr-ready.md')
    expect(op, 'ensure-pr-ready is not in the corpus').toBeDefined()
    expect(op?.text.includes(PR_TARGET), `step 4a holds no ${PR_TARGET}`).toBe(true)
    const targets = sourceLines(op?.text ?? '').flatMap(commandSpans).filter(span => /\bgh pr create\b/.test(span) && /--base\b/.test(span))
    expect(targets.length, 'no gh pr create span passes a base').toBeGreaterThanOrEqual(1)
    expect(targets.filter(span => !span.includes(PR_TARGET)).map(squash), 'a gh pr create span that does not read the base from the name file').toEqual([])
  })

  it('each admitted name read from the name file is one word with every character literal', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'base-ref-guard-'))
    try {
      const bad: string[] = []
      for (const name of acceptedNames()) {
        const file = path.join(dir, 'name')
        writeFileSync(file, `${name}\n`)
        const out = execFileSync('/bin/sh', ['-c', `F="$1"; set -- ${PR_TARGET}; printf '%s' "$#:$1"`, 'sh', file], { encoding: 'utf-8' })
        if (out !== `1:--base=${name}`) bad.push(`${name}: read back as ${out}`)
      }
      expect(bad).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('known-bad probe: a name outside the class is refused, and an unquoted use does not keep it as a quoted word', () => {
    expect(resolver.STRICT_NAME_RE.test('a b')).toBe(false)
    expect(resolver.STRICT_NAME_RE.test('a"b')).toBe(false)
    expect(resolver.STRICT_NAME_RE.test('a$b')).toBe(false)
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

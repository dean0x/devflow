/**
 * tests/guards/base-ref-guard.test.ts
 *
 * The base-ref guard for #495 (use a fresh base for branch diffs, tighten branch-name
 * validation). It reads the BUILT prompts: the commands, the agents and the Git-op
 * references, in both curation variants, plus the hand-authored /implement re-validation
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
 *
 * This file holds the sweeps that find a new site anywhere in the corpus. The text one command
 * or one Git op states alone belongs to its own guard: the review commands' Return, Extract,
 * full-range, DIFF_RANGE and freshness text (`collectFreshBaseDefects` in tests/helpers.ts, driven
 * by tests/guards/code-review-diff-gating.test.ts and tests/bug-analysis/structural.test.ts), the
 * review agent's DIFF_RANGE rule (code-review-diff-gating), /implement's Phase 1 and
 * re-validation text (tests/evidence/implement-flow.test.ts), the Git ops' steps 5 to 7
 * (tests/git-agent.test.ts) and the ticket command's base commit, review ranges and changed-files
 * step (tests/dynamic/wave-flow.test.ts). The ticket command is swept like any other prompt
 * for base names and class copies; its `BRANCH_NAME` class variant is the one exempt copy.
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
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

import {
  DEFAULT_BRANCH_FILL,
  DEFAULT_BRANCH_PROBE,
  FLAGGED_RM,
  GH_FAILED_RULE,
  MASTER_FALLBACK,
  MIN_COMPILED_PROMPTS,
  NAME_FILE_TRAP,
  NO_PR_CLAUSE,
  NO_PR_DEFINITION,
  OTHER_GH_FAILURE_CLAUSE,
  PRODUCER_NAME_TAIL,
  PRODUCER_STATUS_CAPTURE,
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
  seedOnce,
} from '../helpers.js'
import { RESOLVE_BASE_SCRIPT, SUBPROCESS_TIMEOUT_MS } from '../evidence/seam.js'

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

const RULES = ['shell-name', 'strict-copy', 'grammar-copy', 'diff-range', 'sink-exit', 'resolver-call', 'file-removal', 'reason-fix-table', 'name-file-procedure'] as const

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

/** These prompts stay out of the name-site collectors. Each holds a site those collectors would report, and the test at the end checks that it does. */
const DEFERRED_FILES: readonly string[] = [
  // Its caller passes the resolved range.
  'agents/debug.md',
]

/**
 * The one copy of the class that a built prompt may hold besides `STRICT_NAME_RE.source`: the ticket command's
 * `BRANCH_NAME`, the same class less its `origin/` refusal. Only this exact text is exempt, and only in that command.
 */
const ENGINE_BRANCH_VARIANT: { readonly file: string; readonly copy: string } = {
  file: 'commands/dynamic-build.md',
  copy: '^(?![-#]|(?:@|(?:FETCH_|ORIG_|MERGE_)?HEAD)$)(?!.*\\.\\.)[A-Za-z0-9._/+@,#-]{1,200}$',
}

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
      if (copy === STRICT || (p.file === ENGINE_BRANCH_VARIANT.file && copy === ENGINE_BRANCH_VARIANT.copy)) continue
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
 * name, a variable bound to the name, its expansion and a flagged `rm` are each reported. An extra positional word
 * is reported through the script's own parser, which refuses any argument count but 2 and 4.
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

/** The prompts that write the name file for a base: each carries the one text of the name-file procedure. */
const PROCEDURE_FILES: readonly string[] = ['git-ops/ensure-pr-ready.md', 'git-ops/validate-branch.md', 'references/implement-revalidate.md']

/** The default-branch fill as a copy writes it: from the origin read to the Write-failure rule, inside one line. */
const DEFAULT_FILL_RE = /`F="\{name file\}"; git -C[^\n]*?never write it with a shell command\./

/** The producer's tail without the status of the first `gh` call. */
const UNCAPTURED_PRODUCER_TAIL = '--jq .baseRefName > "$F"; echo "gh=$?"'

const occurrences = (text: string, part: string): number => text.split(part).length - 1

/**
 * Why a copy of the name-file procedure differs from the one text (the exports of tests/helpers.ts); empty when it equals
 * it. The producer keeps the status of both `gh` calls, the two `gh` failure splits are written once each, with the
 * definition of "no PR applies", and the default-branch fill is equal to the one text, an empty line counting as empty.
 */
function nameFileProcedureFindings(p: Prompt): Unmet[] {
  const out: Unmet[] = []
  const flag = (anchor: string, detail: string): void => { out.push({ anchor, detail }) }
  if (occurrences(p.text, PRODUCER_STATUS_CAPTURE) !== 1) flag('producer status', 'the producer does not keep the status of the first gh call before the call that writes the name file')
  if (occurrences(p.text, PRODUCER_NAME_TAIL) !== 1) flag('producer status', 'the producer does not echo the statuses of both gh calls')
  if (p.text.includes(UNCAPTURED_PRODUCER_TAIL)) flag('producer status', 'the producer echoes only the status of the second gh call')
  if (occurrences(p.text, GH_FAILED_RULE) !== 1) flag('gh-failed rule', 'the text does not say once that either printed status makes gh fail')
  if (occurrences(p.text, 'shows that no PR applies') !== 1 || occurrences(p.text, NO_PR_CLAUSE) !== 1) flag('no-PR clause', 'the default-branch trigger is not written once, with the definition of "no PR applies"')
  if (occurrences(p.text, 'does not show that no PR applies') !== 1 || occurrences(p.text, OTHER_GH_FAILURE_CLAUSE) !== 1) flag('other-failure clause', 'the gh failure that leaves no name is not written once as the one text')
  const fill = DEFAULT_FILL_RE.exec(p.text)?.[0]
  if (fill === undefined) flag('default-branch fill', 'the text has no default-branch fill')
  else if (fill !== DEFAULT_BRANCH_FILL) flag('default-branch fill', 'the default-branch fill differs from the one text')
  return out
}

/** A text that holds the whole procedure once, as the probes seed it. */
const PROCEDURE_TEXT = `\`cd "{worktree}" && ${PRODUCER_STATUS_CAPTURE} ${PRODUCER_NAME_TAIL}\`. ${GH_FAILED_RULE}. If ${NO_PR_CLAUSE}, take the default branch: ${DEFAULT_BRANCH_FILL} Stop if ${OTHER_GH_FAILURE_CLAUSE}.`

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

const CALL_SEED = (rest: string, script: string = SCRIPT_REF): string => `node "${script}" ${rest}`
/** What a resolver call span holds before the script: the name file bound and removed by a plain-rm trap, the worktree and the cross value. */
const CALL_PREFIX = `${NAME_FILE_TRAP} cd "{worktree}" && X=false && `
/** A resolver call as the Git ops and the re-validation reference write it. */
const callOf = (rest: string, prefix: string = CALL_PREFIX, script: string = SCRIPT_REF): string => `${prefix}${CALL_SEED(rest, script)}`
const PR_REST = 'pr --name-stdin --cross "${X}" < "$F"; echo "exit=$?"'
const LOCAL_REST = 'local --name-stdin < "$F"; echo "exit=$?"'
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
    rule: 'name-file-procedure',
    files: PROCEDURE_FILES,
    check: nameFileProcedureFindings,
    probe: {
      file: 'git-ops/validate-branch.md',
      anchor: 'default-branch fill',
      bad: PROCEDURE_TEXT.replace(MASTER_FALLBACK, 'else `master` the same way'),
      good: PROCEDURE_TEXT,
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

  it('every resolver call span reads the name file on stdin and holds no name word', () => {
    const spans = prompts.flatMap(callSpans)
    const budgeted = prompts.reduce((total, p) => total + (CALL_BUDGET[p.file]?.direct ?? 0), 0)
    expect(spans.length, 'the resolver call spans differ from the call budget').toBe(budgeted)
    expect(spans.filter(hasName).map(squash), 'a resolver call span that holds a name word').toEqual([])
    expect(spans.filter(span => !/ --name-stdin\b[^;]*< "\$F"; echo "exit=\$\?"/.test(span)).map(squash), 'a resolver call span that does not read the name file').toEqual([])
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

  it('shell-name: a variable bound to an angle-bracket name is reported, quoted or not, in the argument-form call', () => {
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

  it('shell-name: the ticket command is swept like any other prompt, so a base name seeded into a shell span of either curation variant is reported', () => {
    const variants = prompts.filter(p => p.file === 'commands/dynamic-build.md')
    expect(variants.map(p => p.arm).sort()).toEqual(['off', 'on'])
    for (const p of variants) {
      expect(collectNameSites(p), `${p.arm}: the built command`).toEqual([])
      const sites = collectNameSites({ ...p, text: `${p.text}\nRun \`git diff --name-only {BASE_BRANCH}...HEAD\`.\n` })
      expect(sites.map(f => f.rule), `${p.arm}: the seeded name`).toEqual(['shell-name'])
    }
  })

  it('strict-copy: the ticket command\'s own variant of the class is the one exempt copy; a widened variant there, or the variant in another prompt, is reported', () => {
    const { file, copy } = ENGINE_BRANCH_VARIANT
    const copySites = (at: string, text: string): string[] => collectNameSites(seeded(at, text)).filter(f => f.rule === 'strict-copy').map(f => f.anchor)
    for (const p of prompts.filter(q => q.file === file)) expect(p.text, `${p.arm}: the built command holds the exempt variant`).toContain(copy)
    expect(copySites(file, `const BRANCH_NAME = /${copy}/;`)).toEqual([])
    expect(copySites(file, `const BRANCH_NAME = /${copy.replace('{1,200}', '{1,255}')}/;`)).toHaveLength(1)
    expect(copySites(file, `const BRANCH_NAME = /${copy.replace('+@,#', '+~@,#')}/;`)).toHaveLength(1)
    expect(copySites('agents/seeded.md', `const BRANCH_NAME = /${copy}/;`)).toHaveLength(1)
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
    const ARGUMENT_FORM_PREFIX = BOUND_PREFIX('"<name>"')
    const bad: ReadonlyArray<readonly [string, string, string]> = [
      ['the argument-form call: a bound variable, its expansion and no stdin', callOf('pr "${B}" --cross "${X}"; echo "exit=$?"', ARGUMENT_FORM_PREFIX), 'a shell variable is bound before the call: B'],
      ['the argument-form call: the expansion of the bound variable', callOf('pr "${B}" --cross "${X}"; echo "exit=$?"', ARGUMENT_FORM_PREFIX), 'a shell variable is expanded in the call: B'],
      ['the argument-form call: the name slot', callOf('pr "${B}" --cross "${X}"; echo "exit=$?"', ARGUMENT_FORM_PREFIX), 'the name slot does not hold --name-stdin'],
      ['a literal name in the name slot, with the file on stdin', callOf('local main < "$F"; echo "exit=$?"'), 'the name slot does not hold --name-stdin'],
      ['a missing --name-stdin in pr mode', callOf('pr --cross "${X}" < "$F"; echo "exit=$?"'), 'the name slot does not hold --name-stdin'],
      ['a missing --name-stdin in local mode', callOf('local < "$F"; echo "exit=$?"'), 'the name slot does not hold --name-stdin'],
      ['a missing stdin redirect', callOf('pr --name-stdin --cross "${X}"; echo "exit=$?"'), 'the call does not read the name file'],
      ['a stdin redirect of another file', callOf('local --name-stdin < "$G"; echo "exit=$?"'), 'the call does not read the name file'],
      ['an unquoted stdin redirect', callOf('local --name-stdin < $F; echo "exit=$?"'), 'the call does not read the name file'],
      ['an extra positional word after the flag', callOf('local --name-stdin main < "$F"; echo "exit=$?"'), 'the script refuses these arguments'],
      ['an extra positional word after the cross value', callOf('pr --name-stdin --cross "${X}" main < "$F"; echo "exit=$?"'), 'the script refuses these arguments'],
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

  it('file-removal: every built prompt that removes a name or title file reports the flagged spelling of each of its removal spans', () => {
    const removalSpans = (p: Prompt): string[] => sourceLines(p.text).flatMap(codeSpans)
      .filter(span => FILE_OPERAND_RE.test(span) && span.includes('rm -- ') && !span.includes('resolve-base.cjs'))
    const holders = prompts.filter(p => removalSpans(p).length > 0)
    expect(holders.length, 'the corpus holds too few name or title file removals').toBeGreaterThanOrEqual(2)
    for (const p of holders) {
      expect(fileRemovalFindings(p), p.file).toEqual([])
      const flagged = { ...p, text: p.text.replace(/rm -- /g, 'rm -f ') }
      expect(fileRemovalFindings(flagged), `${p.file} [${p.arm}]: one finding per removal span`).toHaveLength(removalSpans(p).length)
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

describe('the name-file procedure is one text in the Git ops and the re-validation step', () => {
  const details = (text: string): string[] => nameFileProcedureFindings(seeded('git-ops/validate-branch.md', text)).map(u => u.detail)
  const SECOND_STATUS_ONLY = 'the producer echoes only the status of the second gh call'
  const FILL_DIFFERS = 'the default-branch fill differs from the one text'

  it('each of the three prompts is in the corpus and carries the one text', () => {
    for (const file of PROCEDURE_FILES) {
      const copy = prompts.find(p => p.file === file)
      expect(copy, `${file} is not in the corpus`).toBeDefined()
      expect(nameFileProcedureFindings(copy ?? seeded(file, '')).map(u => u.detail), file).toEqual([])
    }
  })

  it('the seeded one text is accepted', () => {
    expect(details(PROCEDURE_TEXT)).toEqual([])
  })

  it('the origin read prints one empty line when origin/HEAD is not a symbolic ref, and nothing when it is absent', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'base-ref-guard-'))
    try {
      const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
      const git = (...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { env, encoding: 'utf-8' })
      const originRead = (): string => execFileSync('sh', ['-c', DEFAULT_BRANCH_PROBE.replace('"{worktree}"', '"$1"'), 'sh', dir], { env, encoding: 'utf-8' })
      git('init', '-q')
      git('-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'probe')
      expect(originRead(), 'no origin/HEAD').toBe('')
      git('update-ref', 'refs/remotes/origin/HEAD', 'HEAD')
      expect(originRead(), 'origin/HEAD is a direct ref').toBe('\n')
      git('update-ref', 'refs/remotes/origin/main', 'HEAD')
      git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
      expect(originRead(), 'origin/HEAD is a symbolic ref').toBe('main\n')
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('a copy that drifts from the one text is reported by part', () => {
    const drifted = (from: string, to: string): string => seedOnce(PROCEDURE_TEXT, from, to)
    expect(details(drifted(MASTER_FALLBACK, 'else `master` the same way'))).toEqual([FILL_DIFFERS])
    expect(details(drifted(' (a file whose only content is an empty line is empty)', ''))).toEqual([FILL_DIFFERS])
    expect(details(drifted('write a literal name with the Write tool, after a Read of the file', 'written with the Write tool after a Read of the file'))).toEqual([FILL_DIFFERS])
    expect(details(drifted(PRODUCER_STATUS_CAPTURE, 'gh pr view'))).toEqual(['the producer does not keep the status of the first gh call before the call that writes the name file'])
    expect(details(drifted(PRODUCER_NAME_TAIL, UNCAPTURED_PRODUCER_TAIL))).toEqual(['the producer does not echo the statuses of both gh calls', SECOND_STATUS_ONLY])
    expect(details(drifted(GH_FAILED_RULE, '`gh` failed when its status is not 0'))).toEqual(['the text does not say once that either printed status makes gh fail'])
    expect(details(drifted(` ${NO_PR_DEFINITION}`, ''))).toEqual(['the default-branch trigger is not written once, with the definition of "no PR applies"'])
    expect(details(drifted(OTHER_GH_FAILURE_CLAUSE, '`gh` failed'))).toEqual(['the gh failure that leaves no name is not written once as the one text'])
    expect(details('No fill is written here.')).toContain('the text has no default-branch fill')
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
      const names = acceptedNames()
      const files = names.map((name, i) => {
        const file = path.join(dir, `name-${i}`)
        writeFileSync(file, `${name}\n`)
        return file
      })
      // one shell reads every name file in turn, each through the PR target text, and prints the word count and the first word
      const script = `read_back() { F="$1"; set -- ${PR_TARGET}; printf '%s\\n' "$#:$1"; }; for f in "$@"; do read_back "$f"; done`
      const out = execFileSync('/bin/sh', ['-c', script, 'sh', ...files], { encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS })
      expect(out.split('\n').slice(0, -1)).toEqual(names.map(name => `1:--base=${name}`))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 2 * SUBPROCESS_TIMEOUT_MS)

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

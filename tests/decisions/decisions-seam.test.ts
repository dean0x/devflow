/**
 * D-DECISIONS-DECLARED-ONLY (#426) — `DECISIONS_CONTEXT` goes only to the agent
 * types whose contract declares it, and every Code spawn carries it. The Code agent
 * opens no PR (D-PR-BY-GIT), so no spawn is exempt.
 *
 * The index is the largest single input a command can hand an agent, and the Code
 * agent no longer reads it for itself, so the seam between a command and the agents
 * it spawns is where decisions reach an agent or do not. This guard reads the
 * compiled commands (`dist/commands/*.md`) and holds that seam to three rules:
 *
 *   1. every Code spawn site passes the key, with no exemption by operation;
 *   2. a spawn site that passes the key names a declared type;
 *   3. every prose sentence that gives `DECISIONS_CONTEXT` away — it holds the word
 *      "pass" or "inject" — names its receiver, and every receiver it names is
 *      declared. "To all subsequent agents" fails: it names none.
 *
 * The declared set is computed from the agent sources (an agent declares the key by
 * listing it among its inputs); this file does not type it. Spawn sites come from
 * `collectCodeSpawnSites` in tests/helpers.ts, the one collector the OPERATION guard
 * and the compliance-lens test read, so the three count the same sites. It takes the
 * agent type as a parameter and, with none, reads the whole Code family (Code, Fix and
 * Refactor: D-CODE-VARIANTS), so a fix spawn moved to Fix keeps the rule 1 check.
 *
 * Rule 3 reads unfenced prose only: a fenced payload is a spawn, and rules 1 and 2
 * read it. Sentences that cannot name a declared receiver by construction — a
 * universal rule, a prohibition — sit in a literal classification table, each row
 * the exact sentence and why it is allowed. A row whose sentence has gone is stale
 * and fails, so the table cannot outlive its text.
 *
 * Counts here are test-local constants beside the assertion that uses them (a count
 * kept in the manifest is a second place to keep in step).
 *
 * Also held here (AC-105): in every decisions-loading host the `CURATION=off` gate
 * sentence comes before the ledger-locate git call and the index read.
 */
import { describe, it, expect } from 'vitest'
import {
  collectCodeSpawnSites,
  collectUnfencedLines,
  requireDistFile,
  requireDistFiles,
  resolveAllAgents,
} from '../helpers.js'

const CONTEXT_TOKEN = 'DECISIONS_CONTEXT'

/**
 * Code-family spawn sites (Code, Fix and Refactor, D-CODE-VARIANTS) the hosts carry: implement 9,
 * resolve 3, debug 1 (13 in all). Floor: may only rise.
 * LOWERED 21 -> 13 by #756 (a deliberate exception to "a floor may only rise") on 2026-11-05: the 8
 * Code-family spawn sites of the dynamic-build host left the roster, so the counted code is removed and
 * no coverage is lost.
 */
const CODE_SITE_FLOOR = 13

/** Decisions-loading hosts: every command host (10) loads the index behind the gate. */
const DECISIONS_HOST_COUNT = 10

// ── The declared set, from the agent sources ────────────────────────────────

/** Named collector: the agent types whose source lists `DECISIONS_CONTEXT` among its inputs. */
function collectDeclaredTypes(): Set<string> {
  const declared = new Set<string>()
  for (const [, agent] of resolveAllAgents()) {
    if (!/^- \*\*DECISIONS_CONTEXT\*\*/m.test(agent.content)) continue
    const name = /^name: (\S+)$/m.exec(agent.content)?.[1]
    if (name !== undefined) declared.add(name)
  }
  return declared
}

/** Every agent type a command (or the agent corpus) names: spawned in the commands, or an agent of its own. */
function collectKnownTypes(commands: ReadonlyArray<readonly [string, string]>): Set<string> {
  const known = new Set<string>()
  for (const [, agent] of resolveAllAgents()) {
    const name = /^name: (\S+)$/m.exec(agent.content)?.[1]
    if (name !== undefined) known.add(name)
  }
  for (const [, text] of commands) {
    for (const m of text.matchAll(SPAWNED_TYPE)) known.add(m[1])
  }
  return known
}

/** A spawned agent type in `subagent_type="…"` or `agentType: "…"`; a Code variant's hyphen joins its two words. */
const SPAWNED_TYPE = /(?:subagent_type="|agentType: ?")([A-Z][A-Za-z]*(?:-[a-z]+)?)"/g

const compiled = (): Array<readonly [string, string]> => requireDistFiles().map(f => [f, requireDistFile(f)] as const)

// ── Rules 1 and 2: spawn sites ──────────────────────────────────────────────

/** Named collector: the agent types a command text spawns, by any of the four spellings. */
function spawnedTypes(text: string): string[] {
  return [...new Set([...text.matchAll(SPAWNED_TYPE)].map(m => m[1]))]
}

/** Named collector: Code spawn sites that do not pass the key (rule 1). */
function collectKeylessCodeSites(commands: ReadonlyArray<readonly [string, string]>): string[] {
  return commands.flatMap(([file, text]) =>
    collectCodeSpawnSites(file, text)
      .filter(s => !s.payload.includes(CONTEXT_TOKEN))
      .map(s => `${file}:${s.line}`),
  )
}

/** Named collector: sites that pass the key to a type no agent source declares (rule 2). */
function collectUndeclaredReceivers(
  commands: ReadonlyArray<readonly [string, string]>,
  declared: ReadonlySet<string>,
): string[] {
  return commands.flatMap(([file, text]) =>
    spawnedTypes(text)
      .filter(type => !declared.has(type))
      .flatMap(type => collectCodeSpawnSites(file, text, type).filter(s => s.payload.includes(CONTEXT_TOKEN)).map(s => `${file}:${s.line} (${type})`)),
  )
}

// ── Rule 3: the sentences that give the key away ────────────────────────────

/** A sentence the guard allows although it names no declared receiver, with the reason. */
interface Classified {
  readonly sentence: string
  readonly why: string
}

/**
 * The literal classification table. Each row is a sentence verbatim as compiled; none of them hands the
 * key to an undeclared agent: the first states the universal rule itself, the others forbid a pass.
 */
const CLASSIFIED: readonly Classified[] = [
  {
    sentence: 'Pass `DECISIONS_CONTEXT` and `FEATURE_KNOWLEDGE` only to agents whose contract declares them; the Validate and Git agents this command spawns do not.',
    why: 'release: the universal declared-only rule; the Validate and Git agents are named as non-receivers',
  },
  {
    sentence: '**Do NOT pass `DECISIONS_CONTEXT` to Explore investigators** — decisions context stays in the orchestrator; investigators examine code directly.',
    why: 'debug: a prohibition on the Explore investigators',
  },
  {
    sentence: '**Do NOT pass `DECISIONS_CONTEXT` to Explore sub-agents** — decisions context stays in the orchestrator, not in the investigation workers.',
    why: 'explore: a prohibition on the Explore sub-agents',
  },
]

/** Named collector: the prose sentences of a compiled command that hold the key and a pass/inject verb. */
function collectGiveAwaySentences(text: string): string[] {
  const lines = collectUnfencedLines(text, l => l.includes(CONTEXT_TOKEN)).map(l => l.text)
  return lines
    .flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-Z*`(])/))
    .map(s => s.trim())
    .filter(s => s.includes(CONTEXT_TOKEN) && /\b(?:[Pp]ass(?:es)?|[Ii]nject(?:s|ed)?)\b/.test(s))
}

/** The receiver phrase of a give-away sentence: what follows the first "to"/"into" after its verb. */
function receiverPhrase(sentence: string): string {
  const verb = /\b(?:[Pp]ass(?:es)?|[Ii]nject(?:s|ed)?)\b/.exec(sentence)
  const rest = verb === null ? '' : sentence.slice((verb.index ?? 0) + verb[0].length)
  const to = /\b(?:to|into)\b/.exec(rest)
  return to === null ? '' : rest.slice((to.index ?? 0) + to[0].length)
}

/** The agent types a phrase names, whole words, in order of appearance. */
function namedTypes(phrase: string, known: ReadonlySet<string>): string[] {
  return [...phrase.matchAll(/\b[A-Z][A-Za-z]+\b/g)].map(m => m[0]).filter(w => known.has(w))
}

/** Named collector: give-away sentences that name no receiver or an undeclared one, and are not classified. */
function collectBadSentences(
  file: string,
  text: string,
  declared: ReadonlySet<string>,
  known: ReadonlySet<string>,
  classified: readonly Classified[],
): string[] {
  return collectGiveAwaySentences(text).flatMap(sentence => {
    if (classified.some(c => c.sentence === sentence)) return []
    const receivers = namedTypes(receiverPhrase(sentence), known)
    if (receivers.length === 0) return [`${file}: names no receiver — "${sentence.slice(0, 90)}"`]
    const undeclared = receivers.filter(r => !declared.has(r))
    return undeclared.length === 0 ? [] : [`${file}: passes to undeclared ${undeclared.join(', ')} — "${sentence.slice(0, 90)}"`]
  })
}

// ── Gate order (AC-105) ─────────────────────────────────────────────────────

const GATE = 'When the settings line says `CURATION=off`'
/** The first sentence of the decisions step's locate text; the shared root step, with its script call, follows it. */
const LOCATE = 'The decisions ledger belongs to the repository'
const ROOT_CALL = 'resolve-root.cjs'
const INDEX_READ = '/.devflow/curation/index.md`'

/**
 * Named collector: how a decisions-loading host orders its gate sentence, its locate step and its index read.
 * A docs or knowledge step earlier in the host can run the root call first, so the call that counts is the
 * first one after the decisions step's own locate sentence.
 */
function collectGateOrderDefects(host: string, text: string): string[] {
  const gate = text.indexOf(GATE)
  const locate = text.indexOf(LOCATE)
  const call = locate === -1 ? -1 : text.indexOf(ROOT_CALL, locate)
  const read = text.indexOf(INDEX_READ)
  const out: string[] = []
  if (gate === -1) out.push(`${host}: no CURATION=off gate sentence`)
  if (locate === -1) out.push(`${host}: no ledger-locate step`)
  if (locate !== -1 && call === -1) out.push(`${host}: the ledger-locate step runs no root call`)
  if (read === -1) out.push(`${host}: no index read`)
  if (gate !== -1 && locate !== -1 && gate > locate) out.push(`${host}: the gate follows the ledger-locate call`)
  if (gate !== -1 && read !== -1 && gate > read) out.push(`${host}: the gate follows the index read`)
  if (call !== -1 && read !== -1 && call > read) out.push(`${host}: the index read precedes the ledger-locate call`)
  return out
}

// ═══════════════════════════════════════════════════════════════════════════

describe('the declared set is computed from the agent sources', () => {
  it('is the eleven agents that list DECISIONS_CONTEXT among their inputs, the three Code variants and the two Design variants among them', () => {
    const declared = collectDeclaredTypes()
    expect([...declared].sort()).toEqual(
      ['Architect', 'Code', 'Debug', 'Design', 'Fix', 'Harden', 'Knowledge', 'Refactor', 'Research', 'Review', 'Triage'],
    )
  })

  it('does not declare the agents that never take the index', () => {
    const declared = collectDeclaredTypes()
    for (const type of ['Validate', 'Git', 'Evaluate', 'Synthesize', 'Polish', 'Test', 'Skim']) {
      expect(declared.has(type), type).toBe(false)
    }
  })
})

describe('rule 1: every Code spawn site passes the key', () => {
  it('finds the Code sites in the compiled commands (non-vacuous)', () => {
    const total = compiled().reduce((n, [file, text]) => n + collectCodeSpawnSites(file, text).length, 0)
    expect(total, 'Code spawn sites found').toBeGreaterThanOrEqual(CODE_SITE_FLOOR)
  })

  it('every site carries DECISIONS_CONTEXT, in each syntax the commands use', () => {
    expect(collectKeylessCodeSites(compiled())).toEqual([])
  })

  it('known-bad probe: no operation is exempt, so a keyless spawn that names the retired pr-create mode is reported', () => {
    const host = 'implement.md'
    const real = requireDistFile(host)
    const from = '"OPERATION: alignment-fix\n   TASK_ID: {task-id}\n   TASK_DESCRIPTION: Fix alignment issues\n   MISALIGNMENTS: {structured misalignments from Evaluate agent}\n   SCOPE: Fix only the listed misalignments, no other changes\n   DECISIONS_CONTEXT: {decisions_context}\n'
    expect(real, `the seed anchor must exist in ${host}`).toContain(from)
    const seeded = real.replace(from, '"OPERATION: pr-create\n   TASK_ID: {task-id}\n   TASK_DESCRIPTION: Fix alignment issues\n')
    expect(seeded, 'the seed must change the text').not.toBe(real)
    const found = collectKeylessCodeSites([[host, seeded]])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/^implement\.md:\d+$/)
  })

  /** Seed a real host: remove `from` (which must exist), expect exactly one keyless site. */
  function probe(host: string, from: string, to: string): string[] {
    const real = requireDistFile(host)
    expect(real, `the seed anchor must exist in ${host}`).toContain(from)
    const seeded = real.replace(from, to)
    expect(seeded, 'the seed must change the text').not.toBe(real)
    return collectKeylessCodeSites([[host, seeded]])
  }

  it('known-bad probe: a fenced Code spawn without the key is reported', () => {
    const found = probe('implement.md', '   DECISIONS_CONTEXT: {decisions_context}\n   {COMPLIANCE_DIRECTIVE}"\n   ```\n   - Loop back to Phase 5', '   {COMPLIANCE_DIRECTIVE}"\n   ```\n   - Loop back to Phase 5')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/^implement\.md:\d+$/)
  })

  it('known-bad probe: a prose Code task without the key is reported', () => {
    const found = probe('implement.md', '`CI_FAILURES`, `DECISIONS_CONTEXT` and `PUSH: false`', '`CI_FAILURES` and `PUSH: false`')
    expect(found).toHaveLength(1)
  })
})

describe('rule 2: a site that passes the key names a declared type', () => {
  it('no compiled spawn site passes the key to an undeclared type', () => {
    expect(collectUndeclaredReceivers(compiled(), collectDeclaredTypes())).toEqual([])
  })

  it('the declared receivers do pass it (non-vacuous: Triage, Design, Review, Harden, Code)', () => {
    const declared = collectDeclaredTypes()
    const passing = new Set<string>()
    for (const [file, text] of compiled()) {
      for (const type of spawnedTypes(text)) {
        if (declared.has(type) && collectCodeSpawnSites(file, text, type).some(s => s.payload.includes(CONTEXT_TOKEN))) passing.add(type)
      }
    }
    for (const type of ['Triage', 'Design', 'Review', 'Harden', 'Code']) expect(passing.has(type), type).toBe(true)
  })

  it('known-bad probe: a Validate spawn handed the key is reported', () => {
    const host = 'implement.md'
    const real = requireDistFile(host)
    const from = 'VALIDATION_SCOPE: full\nRun build, typecheck, lint, test. Report pass/fail with failure details."'
    expect(real).toContain(from)
    const seeded = real.replace(from, 'VALIDATION_SCOPE: full\nDECISIONS_CONTEXT: {decisions_context}\nRun build, typecheck, lint, test. Report pass/fail with failure details."')
    const found = collectUndeclaredReceivers([[host, seeded]], collectDeclaredTypes())
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/\(Validate\)$/)
  })

  it('known-bad probe: an Evaluate spawn handed the key is reported', () => {
    const host = 'implement.md'
    const real = requireDistFile(host)
    const from = 'Validate alignment with request and plan. Report ALIGNED or MISALIGNED with details."'
    expect(real).toContain(from)
    const seeded = real.replace(from, 'DECISIONS_CONTEXT: {decisions_context}\n' + from)
    const found = collectUndeclaredReceivers([[host, seeded]], collectDeclaredTypes())
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/\(Evaluate\)$/)
  })

  it('release spawns nothing that carries the key (or the knowledge)', () => {
    const text = requireDistFile('release.md')
    const spawnLines = text.split('\n').filter(l => /subagent_type="|agentType: "(?!Code")/.test(l))
    expect(spawnLines.length, 'release.md: spawn lines found').toBeGreaterThanOrEqual(1)
    for (const line of spawnLines) {
      expect(line, `release.md: ${line.slice(0, 60)}`).not.toContain(CONTEXT_TOKEN)
      expect(line, `release.md: ${line.slice(0, 60)}`).not.toContain('FEATURE_KNOWLEDGE')
    }
  })

  it('the plan\'s Explore and Plan phases and its Git spawns carry no decisions', () => {
    const text = requireDistFile('plan.md')
    for (const type of ['Explore', 'Plan', 'Git']) {
      const sites = collectCodeSpawnSites('plan.md', text, type)
      expect(sites.length, `${type} sites in plan.md`).toBeGreaterThanOrEqual(1)
      for (const s of sites) expect(s.payload, `${type} at plan.md:${s.line}`).not.toContain(CONTEXT_TOKEN)
    }
  })

  it('the Evaluate spawn of implement and the Synthesize spawns of plan and code-review carry none', () => {
    for (const [host, type] of [['implement.md', 'Evaluate'], ['plan.md', 'Synthesize'], ['code-review.md', 'Synthesize']] as const) {
      const sites = collectCodeSpawnSites(host, requireDistFile(host), type)
      expect(sites.length, `${type} sites in ${host}`).toBeGreaterThanOrEqual(1)
      for (const s of sites) expect(s.payload, `${type} at ${host}:${s.line}`).not.toContain(CONTEXT_TOKEN)
    }
  })
})

describe('rule 3: every sentence that gives the key away names a declared receiver', () => {
  const declared = collectDeclaredTypes()
  const known = collectKnownTypes(compiled())

  it('the corpus holds give-away sentences, and the known types include the shipped agents', () => {
    const sentences = compiled().flatMap(([, text]) => collectGiveAwaySentences(text))
    expect(sentences.length, 'give-away sentences found').toBeGreaterThanOrEqual(10)
    for (const type of ['Explore', 'Plan', 'Validate', 'Git', 'Code']) expect(known.has(type), type).toBe(true)
  })

  it('no compiled command gives the key to an undeclared or unnamed receiver', () => {
    const bad = compiled().flatMap(([file, text]) => collectBadSentences(file, text, declared, known, CLASSIFIED))
    expect(bad).toEqual([])
  })

  it('every row of the classification table still matches a sentence (no stale row)', () => {
    const live = new Set(compiled().flatMap(([, text]) => collectGiveAwaySentences(text)))
    for (const row of CLASSIFIED) expect(live.has(row.sentence), `stale row: ${row.why}`).toBe(true)
  })

  it('known-bad probes: a pass to Validate, a blanket "to all subsequent agents" and an unnamed receiver are reported', () => {
    const bad = (s: string): string[] => collectBadSentences('p.md', s, declared, known, [])
    expect(bad('Pass `DECISIONS_CONTEXT` to the Validate agent.')).toHaveLength(1)
    expect(bad('Pass `DECISIONS_CONTEXT` to the Validate agent.')[0]).toContain('undeclared Validate')
    expect(bad('Pass Skim agent context and `DECISIONS_CONTEXT` to all subsequent agents — prior decisions constrain design.')[0])
      .toContain('names no receiver')
    expect(bad('Inject the relevant `DECISIONS_CONTEXT` into agent prompts.')[0]).toContain('names no receiver')
  })

  it('known-bad probe: a pass that names an undeclared type beside a declared one is reported', () => {
    const found = collectBadSentences('p.md', 'Pass `DECISIONS_CONTEXT` to Design and Evaluate agents.', declared, known, [])
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('undeclared Evaluate')
  })

  it('declared receivers pass, in each phrasing the commands use', () => {
    const ok = (s: string): string[] => collectBadSentences('p.md', s, declared, known, [])
    expect(ok('Pass `DECISIONS_CONTEXT` to all Review agents.')).toEqual([])
    expect(ok('Pass `DECISIONS_CONTEXT` to the Triage agent in Phase 2 and to Code agents in Phase 4.')).toEqual([])
    expect(ok('Pass `DECISIONS_CONTEXT` to Design agents only.')).toEqual([])
    expect(ok('Then inject the relevant DECISIONS_CONTEXT into the prompts of the Code, Design, Knowledge, Review and Harden agents, using the algorithm.')).toEqual([])
  })

  it('a fenced line is not a sentence: a JavaScript comment that says "injected" is left to rules 1 and 2', () => {
    const text = '```js\nconst DECISIONS_CONTEXT = args.decisionsContext || "";  // injected before authoring\n```\n'
    expect(collectGiveAwaySentences(text)).toEqual([])
  })
})

describe('the CURATION gate precedes the ledger-locate call and the index read (AC-105)', () => {
  it('holds in every decisions-loading host', () => {
    const hosts = compiled().filter(([, text]) => text.includes(LOCATE))
    expect(hosts.length, 'decisions-loading hosts').toBe(DECISIONS_HOST_COUNT)
    for (const [file, text] of hosts) expect(collectGateOrderDefects(file, text), file).toEqual([])
  })

  it('known-bad probes: a gate moved after the read, after the locate call, or dropped, is reported', () => {
    const host = 'self-review.md'
    const real = requireDistFile(host)
    const gateLine = real.split('\n').find(l => l.startsWith(GATE)) ?? ''
    expect(gateLine, 'the gate sentence').not.toBe('')
    const without = real.replace(`${gateLine}\n`, '')
    expect(without).not.toBe(real)
    const afterRead = without.replace('The index is one direct file read', `${gateLine}\n\nThe index is one direct file read`)
    expect(collectGateOrderDefects(host, afterRead)).toEqual([
      `${host}: the gate follows the ledger-locate call`,
      `${host}: the gate follows the index read`,
    ])
    expect(collectGateOrderDefects(host, without)).toEqual([`${host}: no CURATION=off gate sentence`])
    const beforeLocate = without.replace('The decisions ledger belongs', `${gateLine}\n\nThe decisions ledger belongs`)
    expect(collectGateOrderDefects(host, beforeLocate)).toEqual([])
  })
})

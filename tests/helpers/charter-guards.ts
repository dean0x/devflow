/**
 * Named collectors for the orchestrator charter's prompt doctrine.
 *
 * Each collector takes charter text and returns the ways it falls short, so one guard can run it on
 * the packaged source and on any rendering of that source. A collector reads nothing from disk and
 * keeps no state. A missing line reports a violation: the callers decide which lines may be absent.
 *
 * D-CHARTER-BOUNDED-INLINE. The orchestrator may run one small command inline instead of paying a
 * spawn for it, and the permission is only as safe as its bounds, so the bounds are held where the
 * permission is granted: ONE sentence names the command kinds (a single git, gh or script command),
 * the output ceiling (about 40 lines) and the exclusions (diffs, logs, test runs). Two sentences
 * would let an edit keep the grant and lose the bound.
 *
 * Two neighbours hold with it. Direct delegations ask for a report of bounded size, so a delegated
 * result does not flood the main thread. And a plan handoff invokes the workflow with NO plan text:
 * the model already holds the plan, so passing it again as skill input doubles it in context.
 *
 * Deterministic code checks shape here and makes no judgment: it looks for the bound words in one
 * sentence, a token figure on the report cap, and the absence of "full plan" on the handoff line.
 */

export const BOUND_WORDS: ReadonlyArray<readonly [string, RegExp]> = [
  ['single', /\bsingle\b/i],
  ['git', /\bgit\b/i],
  ['gh', /\bgh\b/i],
  ['40 lines', /\b40 lines\b/],
  ['diff', /\bdiffs?\b/i],
  ['log', /\blogs?\b/i],
  ['test', /\btests?\b/i],
]
export const REPORT_CAP = /\bat most (?:about )?\d[\d,]* tokens\b/i
export const HANDOFF_PREFIX = 'Implement the following plan:'

/** The last routing line: everything else goes to the closest roster agent, and no model is named. */
export const ROSTER_FALLBACK = '- Anything else: the closest roster agent, never general-purpose.'

/** Named collector: how a charter's amended rules fall short of the shape above. */
export function collectCharterContentViolations(charter: string): string[] {
  const violations: string[] = []

  const sentences = charter.split(/(?<=[.!?])\s+|\n+/)
  const bounded = sentences.some(sentence => BOUND_WORDS.every(([, word]) => word.test(sentence)))
  if (!bounded) {
    const best = Math.max(0, ...sentences.map(s => BOUND_WORDS.filter(([, word]) => word.test(s)).length))
    violations.push(
      `no single sentence holds all of ${BOUND_WORDS.map(([name]) => name).join(', ')} ` +
      `(the closest holds ${best} of ${BOUND_WORDS.length}) — the bounded-inline exception must carry its bounds`,
    )
  }

  if (!sentences.some(s => /\breport/i.test(s) && REPORT_CAP.test(s))) {
    violations.push('no delegation report cap carries a token figure ("at most about N tokens")')
  }

  // D-CODE-OPERATION-MODES: a direct Code delegation is not a compiled command, so no spawn guard
  // reads it. Its routing line carries the rule instead: the prompt opens with `OPERATION: <mode>`.
  const codeLines = charter.split('\n').filter(line => /^- Execution against a spec:/.test(line))
  if (codeLines.length !== 1) {
    violations.push(`expected exactly one Code routing line ("- Execution against a spec:"), found ${codeLines.length}`)
  } else {
    const line = codeLines[0]
    if (!line.includes('`OPERATION: <mode>`')) {
      violations.push('the Code routing line does not tell a direct Code delegation to open with OPERATION: <mode>')
    }
    // D-CODE-VARIANTS (AC-303): a mechanical edit goes to Refactor, and Code keeps implement and issue-fix.
    const editAt = line.indexOf('Refactor')
    if (editAt === -1 || !/^Refactor \([^)]*`OPERATION: edit`/.test(line.slice(editAt))) {
      violations.push('the Code routing line does not route `OPERATION: edit` to Refactor')
    }
    if (/`edit`|OPERATION: edit/.test(editAt === -1 ? line : line.slice(0, editAt))) {
      violations.push('the Code routing line still routes edit to Code')
    }
    if (!/`issue-fix`/.test(line) || !/else `implement`/.test(line)) {
      violations.push('the Code routing line does not keep issue-fix and implement on Code')
    }
  }

  const handoffLines = charter.split('\n').filter(line => line.includes(HANDOFF_PREFIX))
  if (handoffLines.length !== 1) {
    violations.push(`expected exactly one line naming "${HANDOFF_PREFIX}", found ${handoffLines.length}`)
  } else {
    if (!handoffLines[0].includes('devflow:implement')) {
      violations.push('the handoff line does not invoke devflow:implement')
    }
    if (/full plan/i.test(handoffLines[0])) {
      violations.push('the handoff line tells the orchestrator to pass the full plan as skill input')
    }
  }
  return violations
}

/**
 * Named collector for D-CHARTER-ROSTER-ONLY. The open-ended "delegate all of it" left the
 * orchestrator to improvise a type for work no routing line covered, and it reached for
 * general-purpose, which inherits the session model and has no roster discipline. The last routing
 * line sends everything else to the closest roster agent. It names no model: dispatch is by kind of
 * work, and tiers live in each agent's frontmatter.
 */
export function collectCharterRoutingViolations(charter: string): string[] {
  const lines = charter.split('\n')
  const routingStart = lines.findIndex(line => line.startsWith('Routing (Agent tool)'))
  if (routingStart === -1) return ['no "Routing (Agent tool)" line']
  const routing: string[] = []
  for (const line of lines.slice(routingStart + 1)) {
    if (!line.startsWith('- ')) break
    routing.push(line)
  }
  const violations: string[] = []
  if (routing[routing.length - 1] !== ROSTER_FALLBACK) {
    violations.push(`the routing list does not end with "${ROSTER_FALLBACK}"`)
  }
  if (/\b(?:opus|sonnet|haiku)\b/i.test(routing.join('\n'))) {
    violations.push('the routing lines name a model')
  }
  return violations
}

/**
 * D-KB-DELIVERY-TIERS (#427): the charter's Feature knowledge bullet.
 *
 * The charter reaches direct delegations that no workflow covers, so its bullet passes the same
 * delivery the workflows use: each matching KB's one to three most relevant Rules bullets (verbatim,
 * IDs included), the KB path and its heading index. It keeps its three limits: direct delegations
 * only, before non-trivial code work only, and a delegated change to a covered area spawns
 * Knowledge afterwards. The bullet is where a covered change has Knowledge refresh its KB; a
 * separate routing line sends Knowledge a new KB when the user asks. The length ceiling is held by
 * the charter size test, the single site the numeric-floor manifest pins.
 */
export function collectCharterKnowledgeDefects(charter: string): string[] {
  const bullet = charter.split('\n').find(l => l.startsWith('- Feature knowledge')) ?? ''
  if (bullet === '') return ['no "- Feature knowledge" bullet']
  const out: string[] = []
  for (const [label, re] of [
    ['direct delegations only', /direct delegations only/],
    ['before non-trivial code work only', /before delegating non-trivial code work/],
    ['matches the task area against the index', /match the task area against \.devflow\/features\/index\.md/],
    ['the one to three Rules bullets', /one to three most relevant `## Rules` bullets/],
    ['verbatim with IDs', /verbatim, IDs included/],
    ['the KB path', /\bits path\b/],
    ['the heading index', /`##` heading index/],
    ['the legacy fallback by section', /Anti-Patterns or Gotchas entries, cited by section/],
    ['passed as FEATURE_KNOWLEDGE', /as FEATURE_KNOWLEDGE/],
    ['a covered change spawns Knowledge afterwards', /after delegated changes to a covered area, spawn Knowledge to refresh that KB/],
  ] as const) if (!re.test(bullet)) out.push(`the bullet does not state: ${label}`)
  if (/KNOWLEDGE\.md content/.test(bullet)) out.push('the bullet still passes whole KNOWLEDGE.md content')
  return out
}

/**
 * command→agent spawn-key seam (PF-024).
 *
 * Two-sided seam test pinning the command→agent input contract. Complements
 * registry-integrity.test.ts Guard 6 (which checks OPERATION: name accuracy)
 * by checking key accuracy: are the keys actually passed correct?
 *
 * This file pins the *caller* side of the seam. registry-integrity.test.ts
 * Guard 6 pins the OPERATION: name side. build-mds.test.ts §16b pins the
 * compiled command literals. Together they form the PF-024 triad.
 *
 * Three directions:
 *   1. Forward  — every KEY: passed in a Git fence is declared in that op's
 *                 **Input:** line in git.md (the single contract authority).
 *   2. Reverse  — every non-optional **Input:** identifier is passed by at
 *                 least one caller fence.
 *   3. Producer — every value named in issue_capture_contract() has a
 *                 greppable producer in the DIST_FILES corpus (plan-side capture
 *                 list in Phase 0; _tracker.mds define from Phase 2 onward).
 *
 * Exclusions (asserted as a literal set with a rationale comment):
 *   OPERATION   — routing key, not an agent input field
 *   COMPLIANCE  — injected by the orchestrator, not declared in agent **Input:**
 *   WORKTREE_PATH — cross-cutting optional; excluded by convention (PF-039 analogy)
 *
 * **Produces:** / **Requires:** are excluded as a literal set (PF-039, B10(13)):
 * they are a phase-ordering DAG naming principal upstream state, not a
 * spawn-block field contract.
 *
 * Header doctrine and framing copied verbatim from
 * tests/resolve/duplicate-verdict.test.ts:4-15 (the repo's only two-sided
 * producer/consumer test).
 *
 * Fence and key parsing from registry-integrity.test.ts:449-459 verbatim.
 * Op→section map built once per corpus [DR-24].
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import * as path from 'path'
import {
  resolveAgentSource,
  extractOpSectionFromCorpus,
  parseFences,
  isAgentBlock,
  requireDistFiles,
  type CorpusEntry,
} from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const DIST_COMMANDS_DIR = path.join(ROOT, 'dist', 'commands')

// Keys that are excluded from forward/reverse key checks.
// Rationale must be stated per key so the exclusion is never read as accidental.
const EXCLUDED_KEYS = new Set([
  'OPERATION',    // routing key, not an agent **Input:** field
  'COMPLIANCE',   // injected by the orchestrator, not declared in agent **Input:**
  'WORKTREE_PATH', // cross-cutting optional; excluded by convention (PF-039 analogy)
])

// Decision-ledger references restated inside a caller fence as a reminder to the
// agent — never agent **Input:** fields. `D9:` at dist/commands/resolve.md
// mirrors the D9 row of git.md's decision table (git.md:96); A1 aligned the
// caller to that row verbatim.
//
// Kept as a literal set rather than a /^D\d+$/ class on purpose: a future `D12:`
// that IS a field must fail loudly here instead of being silently swallowed by a
// pattern. Same doctrine as EXCLUDED_KEYS and PRODUCES/REQUIRES (PF-039).
const DECISION_ANNOTATION_KEYS = new Set(['D9'])

// Phase-ordering DAG annotations, not spawn-block field contracts (PF-039, B10(13)).
const DAG_ANNOTATION_KEYS = new Set(['PRODUCES', 'REQUIRES'])

function isNonFieldKey(key: string): boolean {
  return (
    EXCLUDED_KEYS.has(key) ||
    DAG_ANNOTATION_KEYS.has(key) ||
    DECISION_ANNOTATION_KEYS.has(key)
  )
}

// ── Fence-line anchors ───────────────────────────────────────────────────────
//
// Compiled command fences carry the agent prompt as a quoted prose block, and
// some hosts indent it:
//
//     Agent(subagent_type="Git"):
//     "OPERATION: fetch-issue
//     ISSUE_INPUT: {issue reference}
//     Return issue title, body, labels…"
//
// so both anchors must tolerate leading whitespace and the opening double quote.
// Anchoring at a bare line start (/^OPERATION: /m) matched ZERO of the 18 Git
// fences in dist/commands/ — keysPassedByOp stayed empty and Directions 1 and 2
// iterated nothing while every assertion stayed green (PF-018). The
// opMatchedFences invariant below is what makes that failure mode loud.
const OPERATION_LINE_RE = /^[ \t]*"?OPERATION: (\S+)/m
const PASSED_KEY_RE = /^[ \t]*"?([A-Z_][A-Z0-9_]*): /gm

/**
 * True for a language-tagged fence (```js …), i.e. a dynamic-workflow recipe
 * rather than a prose spawn block.
 *
 * The corpus splits cleanly along this line: every `Agent(subagent_type="X")`
 * spawn lives in an untagged prose fence, and every `agentType: "X"` call lives
 * in a ```js recipe. A recipe is one fence holding many agent() calls of
 * different types — dist/commands/dynamic-build.md has a single fence with 24
 * calls across 9 agent types — so fence-level key attribution is meaningless
 * there: harvesting every `KEY:` line would credit the Code agents' prompts to
 * whichever OPERATION appeared first.
 *
 * Recorded scope limitation: the `setup-task` spawn inside that recipe is
 * therefore not key-checked by this seam. Per-call parsing of recipe bodies is
 * a separate guard, not a widened regex here.
 */
function isRecipeFence(fence: string): boolean {
  const firstNewline = fence.indexOf('\n')
  return fence.slice(3, firstNewline === -1 ? undefined : firstNewline).trim().length > 0
}

/**
 * Harvest the operation name and passed keys from one spawn fence.
 * Returns null when the fence declares no OPERATION.
 *
 * Shared by the live corpus scan and the known-bad RED proof so the proof
 * exercises the same parser the guard uses — an inline re-implementation would
 * keep passing after the real parser stopped matching (exactly the defect this
 * function's anchors fix).
 */
function harvestFence(fence: string): { op: string; keys: Set<string> } | null {
  const opMatch = fence.match(OPERATION_LINE_RE)
  if (!opMatch) return null
  const keys = new Set<string>()
  for (const km of fence.matchAll(PASSED_KEY_RE)) keys.add(km[1])
  return { op: opMatch[1], keys }
}

/** Keys in a fence that its op's **Input:** line does not declare. */
function forwardViolationsFor(section: string, keys: Set<string>): string[] {
  const bad: string[] = []
  // Scope to **Input:** line only via parseInputIdentifiers (P0-S10).
  // The old `section.includes(`\`KEY\``)` checked the WHOLE section, so a key
  // mentioned in **Process:** but not declared in **Input:** would silently pass.
  const { required, optional } = parseInputIdentifiers(section)
  const declared = new Set([...required, ...optional])
  for (const key of keys) {
    if (isNonFieldKey(key)) continue
    // Membership against the parsed **Input:** identifiers only — never whole-section scan.
    // Exact match: 'ISSUE' is not satisfied by 'ISSUE_INPUT' (parseInputIdentifiers uses
    // backtick-delimited identifier extraction, same AC-0.1 guard as before).
    if (!declared.has(key)) bad.push(key)
  }
  return bad
}

// Values from issue_capture_contract() (Direction 3 — producer check).
//
// Each entry names what git.md emits in its fetch-issue / fetch-issues-batch Output
// template (the producer's vocabulary), NOT the variable name the plan command uses
// (the consumer's vocabulary). Variable names like ISSUE_CONTENT, ACCEPTANCE_CRITERIA,
// and ISSUE_REF never appear in git.md — they are plan.md's capture-side labels.
// Searching DIST_FILES for them found only the consumer (plan.md's own capture line)
// and called it the producer; that was the defect.
//
// ISSUE_ID and ISSUE_URL are excluded: neither name appears in git.md's Output templates
// (no URL field is emitted; the issue id is embedded in the heading, not separately
// labelled). Including them violated ADR-003 (no artifact without a reachable producer);
// they were removed from the plan capture list in c7bff85.
//
// From Phase 2 onward this runs against the compiled _tracker.mds define.
const ISSUE_CAPTURE_CONTRACT: Array<{ label: string; producerPattern: string }> = [
  // The issue body is wrapped in <untrusted-issue-body> in both fetch-issue and
  // fetch-issues-batch Output templates (Principle 8 containment, commit 75f13e7).
  { label: 'ISSUE_CONTENT', producerPattern: '<untrusted-issue-body>' },
  // "### Acceptance Criteria" heading in fetch-issue; "**Acceptance Criteria**:" in batch.
  { label: 'ACCEPTANCE_CRITERIA', producerPattern: 'Acceptance Criteria' },
  // "## Issue #{number}:" heading in fetch-issue; "### Issue #{number1}:" in batch.
  { label: 'ISSUE_REF', producerPattern: '## Issue #' },
]

// ── Build state shared across all directions (beforeAll) ─────────────────────

// The op→section index is built ONCE per corpus in beforeAll [DR-24].
// Building it per-fence would multiply extractOpSectionFromCorpus's
// throw-on-missing-anchor by the fence count.

/** Parse the **Input:** identifiers from an op section.
 * Returns { required: string[], optional: string[] }.
 */
function parseInputIdentifiers(section: string): { required: string[]; optional: string[] } {
  const required: string[] = []
  const optional: string[] = []

  const inputLineMatch = section.match(/^\*\*Input:\*\*(.*?)$/m)
  if (!inputLineMatch) return { required, optional }

  // Build the full input text: content on the **Input:** line itself, plus any
  // following bullet lines (multi-line format used by setup-task and similar ops).
  // Bullet lines look like `- \`KEY\` (optional): description` immediately after **Input:**
  // and continue until the first non-bullet, non-blank line (next **Heading:** etc.).
  let inputText = inputLineMatch[1]
  const afterInputLine = section.slice(
    (inputLineMatch.index ?? 0) + inputLineMatch[0].length,
  )
  // Collect consecutive lines that start with optional whitespace + dash (list items).
  const bulletBlockMatch = afterInputLine.match(/^((?:\n[ \t]*-[ \t][^\n]*)*)/)
  if (bulletBlockMatch?.[1]) {
    inputText += bulletBlockMatch[1]
  }

  // Extract all backtick-delimited UPPERCASE identifiers from the combined text.
  const identPattern = /`([A-Z_][A-Z0-9_]*)`/g
  let m
  while ((m = identPattern.exec(inputText)) !== null) {
    const name = m[1]
    // Determine optional: check if (optional) appears immediately after the closing backtick.
    const afterBt = inputText.slice(m.index + m[0].length)
    const isOptional = /^\s*\(optional\)/.test(afterBt)
    if (isOptional) {
      optional.push(name)
    } else {
      required.push(name)
    }
  }

  return { required, optional }
}

let distFiles: string[]
let corpusEntries: CorpusEntry[]
let opSectionMap: Map<string, string>   // op → section text from git.md sole corpus
let gitCorpus: CorpusEntry[]            // sole corpus (git.md only, for Direction 1)

// All keys passed by any Git fence, keyed by op name.
let keysPassedByOp: Map<string, Set<string>>
// All fences scanned, by agent type.
let fencesScanned: Map<string, number>
// Git fences whose text mentions OPERATION: anywhere (the population the parser
// must cover) vs the ones harvestFence actually parsed. Divergence means the
// anchors stopped matching the corpus — the vacuity failure mode (PF-018).
let gitFencesMentioningOperation: number
let gitFencesOpMatched: number
// Language-tagged recipe fences skipped by the scan (see isRecipeFence).
let recipeFencesSkipped: number

beforeAll(() => {
  distFiles = requireDistFiles()
  corpusEntries = distFiles.map(f => ({
    path: path.join(DIST_COMMANDS_DIR, f),
    content: readFileSync(path.join(DIST_COMMANDS_DIR, f), 'utf-8'),
  }))

  const git = resolveAgentSource('git')
  gitCorpus = [{ path: git.path, content: git.content }]

  // Build op→section map once [DR-24]: sole corpus (git.md), all declared ops.
  opSectionMap = new Map()
  const opNames = [...git.content.matchAll(/^## Operation: (\S+)/gm)].map(m => m[1])
  for (const op of opNames) {
    const { content } = extractOpSectionFromCorpus(gitCorpus, op, { mode: 'sole' })
    opSectionMap.set(op, content)
  }

  // Scan all compiled commands for Git and Code fences.
  keysPassedByOp = new Map()
  fencesScanned = new Map([['Git', 0], ['Code', 0]])
  gitFencesMentioningOperation = 0
  gitFencesOpMatched = 0
  recipeFencesSkipped = 0

  for (const entry of corpusEntries) {
    const fences = parseFences(entry.content)
    for (const fence of fences) {
      if (isRecipeFence(fence)) {
        if (isAgentBlock(fence, 'Git') || isAgentBlock(fence, 'Code')) recipeFencesSkipped++
        continue
      }
      if (isAgentBlock(fence, 'Git')) {
        fencesScanned.set('Git', fencesScanned.get('Git')! + 1)
        if (fence.includes('OPERATION:')) gitFencesMentioningOperation++

        const harvested = harvestFence(fence)
        if (!harvested) continue
        gitFencesOpMatched++

        const existing = keysPassedByOp.get(harvested.op) ?? new Set<string>()
        for (const k of harvested.keys) existing.add(k)
        keysPassedByOp.set(harvested.op, existing)
      } else if (isAgentBlock(fence, 'Code')) {
        fencesScanned.set('Code', fencesScanned.get('Code')! + 1)
      }
    }
  }
})

// ── Non-vacuity ───────────────────────────────────────────────────────────────

describe('non-vacuity: per-agent-type fence counts', () => {
  it('at least one Git agent fence is scanned from DIST_FILES', () => {
    expect(
      fencesScanned.get('Git'),
      `No Git agent fences found in DIST_FILES — the forward check would pass vacuously (PF-018)`,
    ).toBeGreaterThan(0)
  })

  it('at least one Code agent fence is scanned from DIST_FILES', () => {
    expect(
      fencesScanned.get('Code'),
      `No Code agent fences found in DIST_FILES — the per-type non-vacuity check would pass vacuously (PF-018)`,
    ).toBeGreaterThan(0)
  })

  it('recipe fences are excluded and the exclusion arm is live', () => {
    // Non-vacuity for the isRecipeFence arm: if it ever stops matching, the
    // multi-agent ```js recipes would be swept into the prose scan and attribute
    // unrelated keys to whichever OPERATION appeared first.
    expect(
      recipeFencesSkipped,
      'no language-tagged agent recipe fence was skipped — isRecipeFence no longer matches the corpus',
    ).toBeGreaterThan(0)
  })

  it('every prose Git fence that mentions OPERATION: is actually parsed (anchor coverage)', () => {
    // The assertion that would have caught the original defect. Counting fences
    // is not enough: a fence can be scanned, fail the OPERATION anchor, and be
    // skipped while `fencesScanned > 0` stays green. This compares the parsed
    // population against the population that must be parsed, so a regex that
    // stops matching the corpus fails here instead of going quietly vacuous.
    expect(
      gitFencesMentioningOperation,
      'no Git fence mentions OPERATION: — the corpus shape changed (PF-018)',
    ).toBeGreaterThan(0)
    expect(
      gitFencesOpMatched,
      `${gitFencesOpMatched}/${gitFencesMentioningOperation} Git fences with an OPERATION: line were parsed. ` +
      'The OPERATION anchor no longer matches the compiled fence shape — the forward/reverse ' +
      'directions would iterate an empty map and pass vacuously (PF-018).',
    ).toBe(gitFencesMentioningOperation)
  })

  it('at least 10 operations have a live caller fence (key-map non-vacuity)', () => {
    // Directions 1 and 2 iterate keysPassedByOp. An empty or near-empty map makes
    // both of them assert nothing regardless of how many fences were counted.
    // M9: the spec-level AC says git.md declares 17 ops (REQUIRED_OPS), but the
    // corpus scan finds 13 live caller fences (17 ops minus ops with no callers yet, e.g.
    // fetch-issues-batch). Floor is 10, not 17 — intentionally conservative pending Phase 1
    // wiring. Raise when new caller fences are added (numeric-floors.json seam-ops-with-callers).
    expect(
      keysPassedByOp.size,
      `only ${keysPassedByOp.size} operations have caller fences — expected ≥ 10; ` +
      'the forward and reverse directions iterate this map and would be near-vacuous',
    ).toBeGreaterThanOrEqual(10)
  })

  it('op→section map covers at least 15 operations [DR-24]', () => {
    expect(
      opSectionMap.size,
      `op→section map has only ${opSectionMap.size} ops — expected ≥ 15 (matching opsCovered floor); is git.md truncated?`,
    ).toBeGreaterThanOrEqual(15)
  })

  it('DIST_FILES has exactly 14 compiled command files', () => {
    expect(
      distFiles.length,
      `DIST_FILES has ${distFiles.length} files, expected 14 — DIST_FILES vs ALL_HOSTS divergence is permanent (SG-13)`,
    ).toBe(14)
  })
})

// ── Direction 1: forward key check ───────────────────────────────────────────
//
// Every KEY: passed in a Git fence (minus EXCLUDED_KEYS) must be declared in
// that op's **Input:** line. Mode 'sole' — git.md is the single authority
// (unioning three providers' sections would accept a key declared by only one).

describe('forward: every KEY: passed is declared in **Input:**', () => {
  it('every passed key is in the op **Input:** line (sole mode — git.md is the authority)', () => {
    const violations: string[] = []

    for (const [op, passedKeys] of keysPassedByOp) {
      const section = opSectionMap.get(op)
      if (!section) {
        violations.push(`OPERATION: ${op} — not declared as ## Operation: ${op} in git.md`)
        continue
      }

      for (const key of forwardViolationsFor(section, passedKeys)) {
        violations.push(
          `OPERATION: ${op} passes key '${key}' but it is not declared in **Input:** in git.md`,
        )
      }
    }

    expect(
      violations,
      `Forward seam violations (command passes a key git.md does not declare):\n${violations.join('\n')}`,
    ).toHaveLength(0)
  })

  // Known-bad inline sample — RED proof (mechanic 2, H10).
  //
  // Verbatim pre-A1 text of src/assets/commands/debug.mds:49-53
  // (`git show e726874:src/assets/commands/debug.mds`), including the opening
  // double quote and the `{issue number}` placeholder. Runtime shape, not a
  // stylised one (PF-043): a stripped-down `ISSUE: 42` fence with the anchor at
  // a bare line start does not occur anywhere in the compiled corpus, so a proof
  // built on it stays green even when the parser matches nothing real.
  //
  // Harvested through harvestFence/forwardViolationsFor — the same parser the
  // live scan uses — so the proof tracks the guard rather than shadowing it.
  const KNOWN_BAD_FENCE =
    '```\n' +
    'Agent(subagent_type="Git"):\n' +
    '"OPERATION: fetch-issue\n' +
    'ISSUE: {issue number}\n' +
    'Return issue title, body, labels, and any linked error logs."\n' +
    '```'

  it('known-bad sample: pre-A1 debug.mds fence is parsed by the live parser (PF-043 shape)', () => {
    const harvested = harvestFence(KNOWN_BAD_FENCE)
    expect(
      harvested,
      'the live parser must parse the pre-A1 debug.mds fence — if it returns null the ' +
      'RED proof below is testing a shape the guard cannot see',
    ).not.toBeNull()
    expect(harvested!.op).toBe('fetch-issue')
    expect(harvested!.keys, 'the wrong key ISSUE must be harvested').toContain('ISSUE')
  })

  it('known-bad sample: pre-A1 debug.mds fence produces exactly one violation (ISSUE)', () => {
    const harvested = harvestFence(KNOWN_BAD_FENCE)!
    const section = opSectionMap.get(harvested.op)
    expect(section, `op '${harvested.op}' must be in the map for the RED proof to work`).toBeTruthy()

    const violations = forwardViolationsFor(section!, harvested.keys)

    expect(
      violations,
      `Known-bad sample must produce exactly one violation (key 'ISSUE'), got: [${violations.join(', ')}]`,
    ).toHaveLength(1)
    expect(violations[0]).toBe('ISSUE')
  })

  it('post-A1 debug.mds fence produces no violation (GREEN counterpart)', () => {
    // The same fence with the A1 fix applied. Pairing GREEN with RED proves the
    // guard discriminates on the key, not on the fence shape.
    const FIXED_FENCE = KNOWN_BAD_FENCE.replace(
      'ISSUE: {issue number}',
      'ISSUE_INPUT: {issue reference}',
    )
    const harvested = harvestFence(FIXED_FENCE)!
    const section = opSectionMap.get(harvested.op)!
    expect(
      forwardViolationsFor(section, harvested.keys),
      'the post-A1 fence must be clean — ISSUE_INPUT is declared in fetch-issue **Input:**',
    ).toHaveLength(0)
  })

  it('process-only key: a key mentioned only in **Process:** but not in **Input:** is a violation', () => {
    // The OLD predicate (section.includes(`\`KEY\``)) checked the WHOLE section, so a key
    // appearing in **Process:** (e.g. "`PROCESS_ONLY_KEY`") would pass — no violation reported.
    // The NEW predicate (parseInputIdentifiers) scopes to **Input:** only, so the same key
    // is flagged as undeclared — correct behaviour.
    //
    // RED: pass a key that appears in **Process:** but is absent from **Input:**
    const syntheticSection =
      '## Operation: test-op\n' +
      '**Input:** `DECLARED_KEY` - The real input\n' +
      '**Process:**\n' +
      '1. Process using `PROCESS_ONLY_KEY` here\n'

    const redViolations = forwardViolationsFor(syntheticSection, new Set(['PROCESS_ONLY_KEY']))
    expect(
      redViolations,
      'a key present only in **Process:** must be caught by the forward check (RED proof)',
    ).toHaveLength(1)
    expect(redViolations[0]).toBe('PROCESS_ONLY_KEY')

    // GREEN: pass a key that is actually declared in **Input:**
    const greenViolations = forwardViolationsFor(syntheticSection, new Set(['DECLARED_KEY']))
    expect(
      greenViolations,
      'a key declared in **Input:** must not be flagged (GREEN)',
    ).toHaveLength(0)
  })
})

// ── Direction 2: reverse key check ───────────────────────────────────────────
//
// Every non-optional **Input:** identifier for an op that has at least one
// caller fence must be passed by at least one of those callers.

describe('reverse: every required **Input:** value is passed by at least one caller', () => {
  it('no required **Input:** identifier is uncovered by all callers', () => {
    const violations: string[] = []

    for (const [op, passedKeys] of keysPassedByOp) {
      const section = opSectionMap.get(op)
      if (!section) continue

      const { required } = parseInputIdentifiers(section)
      for (const key of required) {
        if (isNonFieldKey(key)) continue
        if (!passedKeys.has(key)) {
          violations.push(
            `OPERATION: ${op} declares required Input '${key}' but no caller fence passes it`,
          )
        }
      }
    }

    expect(
      violations,
      `Reverse seam violations (required Input not passed by any caller):\n${violations.join('\n')}`,
    ).toHaveLength(0)
  })
})

// ── Direction 3: producer check ──────────────────────────────────────────────
//
// Every entry in issue_capture_contract() has a greppable producer in git.md's
// fetch-issue / fetch-issues-batch Output templates.
//
// The corpus is git.md (via gitCorpus built in beforeAll), NOT DIST_FILES.
// Searching DIST_FILES found only plan.md's own capture line — the consumer —
// and mistook it for the producer. That vacuity hid the fact that ISSUE_ID and
// ISSUE_URL had no producer at all (removed from plan capture list in c7bff85).
//
// The consumer (plan.md) is excluded by construction: we search only the two
// fetching-op full sections from git.md, never the compiled command files.
//
// FILE-SCOPED SLICING (not extractOpSectionFromCorpus): the Output templates in
// fetch-issue and fetch-issues-batch contain "## Issue #" headings that would
// truncate the extracted section at the first \n## , cutting off the
// <untrusted-issue-body> content. Per-op full-file slicing avoids truncation
// (same pattern as AC-0.3 / Guard 10 in git-agent.test.ts).

describe('third direction: every issue_capture_contract() value has a producer in git.md', () => {
  it('every contract entry has a greppable producer in fetch-issue / fetch-issues-batch Output (git.md sole corpus)', () => {
    // File-scoped slicing: slice the full git.md content between ## Operation: anchors so
    // that ## headings inside Output templates do not prematurely end the section.
    const gitContent = gitCorpus[0]?.content ?? ''
    expect(gitContent.length, 'git.md corpus must be non-empty (non-vacuity)').toBeGreaterThan(0)

    function fileSlice(op: string): string {
      const start = gitContent.indexOf(`## Operation: ${op}`)
      if (start === -1) return ''
      const next = gitContent.indexOf('\n## Operation: ', start + 1)
      return next === -1 ? gitContent.slice(start) : gitContent.slice(start, next)
    }

    // Concatenate the two issue-fetching op slices — both may emit a given field.
    const fetchIssueSec = fileSlice('fetch-issue')
    const fetchBatchSec = fileSlice('fetch-issues-batch')
    expect(
      fetchIssueSec.length + fetchBatchSec.length,
      'fetch-issue and fetch-issues-batch sections must be non-empty (corpus non-vacuity)',
    ).toBeGreaterThan(0)
    const producerContent = fetchIssueSec + '\n' + fetchBatchSec

    const missing: string[] = []
    for (const { label, producerPattern } of ISSUE_CAPTURE_CONTRACT) {
      if (!producerContent.includes(producerPattern)) {
        missing.push(
          `${label}: pattern "${producerPattern}" not found in git.md fetch-issue or fetch-issues-batch Output`,
        )
      }
    }

    expect(
      missing,
      `issue_capture_contract values missing from git.md producer sections (fetch-issue / fetch-issues-batch):\n` +
      missing.join('\n'),
    ).toHaveLength(0)
  })

  it('issue_capture_contract has 3 values (non-vacuous floor)', () => {
    expect(ISSUE_CAPTURE_CONTRACT.length).toBe(3)
  })
})

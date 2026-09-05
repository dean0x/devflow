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

// Values from issue_capture_contract() (Direction 3 — producer check).
// In Phase 0 this runs against the plan-side capture list in the DIST_FILES corpus.
// From Phase 2 onward this runs against the compiled _tracker.mds define.
const ISSUE_CAPTURE_CONTRACT = [
  'ISSUE_CONTENT',
  'ACCEPTANCE_CRITERIA',
  'ISSUE_REF',
  'ISSUE_ID',
  'ISSUE_URL',
] as const

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

  const line = inputLineMatch[1]
  // Extract all backtick-delimited identifiers on this line.
  // Format: `IDENTIFIER` possibly followed by (optional) and/or a description.
  const identPattern = /`([A-Z_][A-Z0-9_]*)`(?:\s*\(optional\))?/g
  let m
  while ((m = identPattern.exec(line)) !== null) {
    const name = m[1]
    // Check if (optional) appears after the closing backtick of this identifier.
    const afterBt = line.slice(m.index + m[0].indexOf(m[1]) + m[1].length + 1)
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

  for (const entry of corpusEntries) {
    const fences = parseFences(entry.content)
    for (const fence of fences) {
      if (isAgentBlock(fence, 'Git')) {
        fencesScanned.set('Git', fencesScanned.get('Git')! + 1)

        const opMatch = fence.match(/^OPERATION: (\S+)/m)
        if (!opMatch) continue
        const op = opMatch[1]

        // Harvest passed keys: all UPPERCASE_KEY: lines in the fence.
        const passedKeys = new Set<string>()
        for (const km of fence.matchAll(/^([A-Z_][A-Z0-9_]*): /gm)) {
          passedKeys.add(km[1])
        }

        const existing = keysPassedByOp.get(op) ?? new Set()
        for (const k of passedKeys) existing.add(k)
        keysPassedByOp.set(op, existing)
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

      for (const key of passedKeys) {
        if (EXCLUDED_KEYS.has(key)) continue
        // Produces / Requires are phase-ordering DAG annotations, not field contracts (PF-039).
        if (key === 'PRODUCES' || key === 'REQUIRES') continue

        // Exact-match: the key must appear as `KEY` in the **Input:** line.
        // Never startsWith — 'ISSUE' must not satisfy 'ISSUE_INPUT' (AC-0.1).
        if (!section.includes(`\`${key}\``)) {
          violations.push(
            `OPERATION: ${op} passes key '${key}' but it is not declared in **Input:** in git.md`,
          )
        }
      }
    }

    expect(
      violations,
      `Forward seam violations (command passes a key git.md does not declare):\n${violations.join('\n')}`,
    ).toHaveLength(0)
  })

  // Known-bad inline sample — RED proof (mechanic 2, H10):
  // An inline `OPERATION: fetch-issue\nISSUE: 42\n` fence proves the guard
  // goes RED on a wrong key. A1 fixed debug.mds:51 (ISSUE: → ISSUE_INPUT:),
  // so this fixture replays the pre-fix state without reverting any commit.
  it('known-bad sample: inline fence with wrong key ISSUE produces exactly one violation', () => {
    const KNOWN_BAD_FENCE =
      '```\n' +
      'Agent(subagent_type="Git"):\n' +
      'OPERATION: fetch-issue\n' +
      'ISSUE: 42\n' +
      '```'

    // Extract keys from the known-bad fence (same logic as main scan above)
    const opMatch = KNOWN_BAD_FENCE.match(/^OPERATION: (\S+)/m)
    expect(opMatch, 'known-bad fence must contain OPERATION:').not.toBeNull()
    const op = opMatch![1]

    const section = opSectionMap.get(op)
    expect(section, `op '${op}' must be in the map for the RED proof to work`).toBeTruthy()

    const violations: string[] = []
    for (const km of KNOWN_BAD_FENCE.matchAll(/^([A-Z_][A-Z0-9_]*): /gm)) {
      const key = km[1]
      if (EXCLUDED_KEYS.has(key) || key === 'PRODUCES' || key === 'REQUIRES') continue
      if (!section!.includes(`\`${key}\``)) {
        violations.push(key)
      }
    }

    expect(
      violations,
      `Known-bad sample must produce exactly one violation (key 'ISSUE'), got: [${violations.join(', ')}]`,
    ).toHaveLength(1)
    expect(violations[0]).toBe('ISSUE')
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
        if (EXCLUDED_KEYS.has(key)) continue
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
// Every value in issue_capture_contract() has a greppable producer in the
// DIST_FILES corpus (plan-side capture list in Phase 0).
// From Phase 2 onward this runs against the compiled _tracker.mds define.

describe('third direction: every issue_capture_contract() value has a producer', () => {
  it('every contract value appears in at least one compiled command (plan-side capture, Phase 0)', () => {
    const allContent = corpusEntries.map(e => e.content).join('\n')
    const missing: string[] = []

    for (const value of ISSUE_CAPTURE_CONTRACT) {
      if (!allContent.includes(value)) {
        missing.push(value)
      }
    }

    expect(
      missing,
      `issue_capture_contract values missing from DIST_FILES corpus (plan-side capture list):\n` +
      missing.join('\n'),
    ).toHaveLength(0)
  })

  it('issue_capture_contract has 5 values (non-vacuous floor)', () => {
    expect(ISSUE_CAPTURE_CONTRACT.length).toBe(5)
  })
})

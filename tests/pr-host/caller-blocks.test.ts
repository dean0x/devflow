/**
 * ensure-pr-ready step 4a's caller block (#365, PR6; AC-4).
 *
 * A caller may hand ensure-pr-ready one pre-rendered block for the PR body it
 * creates: `PR_TEST_PLAN_BLOCK` (the rendered test plan, from /code-review and
 * /bug-analysis). It is attacker-influenceable text by the time it reaches a
 * GitHub-visible sink, so the reference admits it only behind the script that
 * owns its grammar — never a prose regex:
 *
 *   - the gate: it is Written to a new file in a `mktemp -d` folder and passed through
 *     `verify-evidence.cjs check block`; only `exit=0` admits it, verbatim;
 *   - the refusal: anything else omits it — never repaired or partly pasted —
 *     and emits its named DEGRADED reason;
 *   - the scrub: the block joins the body before the D11 scrub, and a failed
 *     scrub posts nothing;
 *   - the absence: no wave block input, gate or reason is left in any provider's file.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector, so a guard that cannot see its subject
 * fails instead of passing on an empty read. The gate is also EXECUTED: the
 * subcommand the reference names is run against the real script, so a
 * reference naming a subcommand the script does not route goes red here rather
 * than at a user's PR.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

import { TRACKER_PROVIDERS } from '../../src/core/tracker.js'
import { operationReferenceRel } from '../../src/core/mds-variants.js'
import { collectOrderViolations, ensurePrReadyReference, type OrderRule } from '../helpers.js'
import { VERIFY_EVIDENCE_SCRIPT } from '../evidence/seam.js'

/** Transcribed from the script's JSDoc — only what this suite calls. */
interface VerifyEvidenceApi {
  main(argv: readonly string[], deps?: { stderr?: (text: string) => void }): { code: number; stdout: string }
}
const VE = createRequire(import.meta.url)(VERIFY_EVIDENCE_SCRIPT) as VerifyEvidenceApi

const SCRATCH = mkdtempSync(path.join(tmpdir(), 'devflow-caller-blocks-'))
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

/** The reference path the order rules and messages name. */
const PR_READY_REL = operationReferenceRel('ensure-pr-ready', 'github') ?? ''

// ---------------------------------------------------------------------------
// The rule, as the reference states it
// ---------------------------------------------------------------------------

const STEP_4A = '4a. Check if PR exists'
const STEP_4C = '4c. Retitle'
const CALLER_BLOCKS = '   - **Caller blocks**'
const BLOCK_WHEN_GIVEN = '`PR_TEST_PLAN_BLOCK` (`check block`), when given and not `(none)`'
const GATE = 'verify-evidence.cjs" check block <file>; echo "exit=$?"'
const APPEND = 'then append the caller blocks'
const SCRUB = 'Apply the Comment-sink scrub (D11)'
const TEST_PLAN_REASON = '`TRACEABILITY: DEGRADED (test-plan block does not match its grammar)`'
/** What the removed wave block left in a reference: its input name and its gate. */
const WAVE_LITERALS = ['PR_WAVE_BLOCK', 'check wave'] as const

/** The ordering claims over the whole reference: the bullet sits inside 4a, the block joins before the scrub. */
const REF_ORDER: readonly OrderRule[] = [
  { label: 'the caller blocks are step 4a\'s', before: STEP_4A, after: CALLER_BLOCKS },
  { label: 'the caller blocks precede 4c', before: CALLER_BLOCKS, after: STEP_4C },
  { label: 'the blocks join the body before the D11 scrub', before: APPEND, after: SCRUB },
]

/** The caller-blocks bullet — one line under step 4a — or null. */
function callerBlocksLine(ref: string): string | null {
  const hits = ref.split('\n').filter(l => l.startsWith(CALLER_BLOCKS))
  return hits.length === 1 ? hits[0] : null
}

/** Named collector: what step 4a's caller-block rule fails to state. */
export function collectCallerBlockDefects(ref: string): string[] {
  const line = callerBlocksLine(ref)
  if (line === null) return ['no single caller-blocks rule under step 4a']
  const step4a = ref.split('\n').find(l => l.startsWith(STEP_4A)) ?? ''
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  need('the test-plan block is taken only when given and not `(none)`', line.includes(BLOCK_WHEN_GIVEN))
  need('the value is Written to a new file in a mktemp -d folder, not a shell string',
    line.includes('to a new file in a `mktemp -d` folder with the Write tool') && line.includes('never via a shell string'))
  need('the gate is `verify-evidence.cjs check block`', line.includes(GATE))
  need('only `exit=0` admits a block, verbatim', line.includes('Only `exit=0` admits it, verbatim'))
  need('a refused block is omitted, never repaired or partly pasted', line.includes('never repaired or partly pasted'))
  need('the test-plan refusal reason', line.includes(TEST_PLAN_REASON))
  need('the refusals report under the Output\'s steps-4b/4c line', line.includes('with steps 4b/4c\'s lines'))
  need('a failed scrub posts neither block', step4a.includes(`${SCRUB} — a failed one posts neither block`))
  out.push(...collectOrderViolations(PR_READY_REL, ref, REF_ORDER))
  return out
}

/** Named collector: the `check` subcommand the gate names, read out of `check <name> <file>`. */
export function collectGateSubcommands(ref: string): string[] {
  const m = /verify-evidence\.cjs" check ([a-z]+) <file>/.exec(callerBlocksLine(ref) ?? '')
  return m === null ? [] : [m[1]]
}

/** Named collector: every line that still names the removed wave block's input or gate. */
export function collectWaveResidue(ref: string): string[] {
  return ref.split('\n').filter(l => WAVE_LITERALS.some(w => l.includes(w)))
}

describe('ensure-pr-ready 4a: the caller block is pasted only behind its check (AC-4)', () => {
  it('the reference states the gate, the refusal and the scrub exclusion', () => {
    const ref = ensurePrReadyReference()
    expect(ref.length, 'the PR-host reference is empty').toBeGreaterThan(0)
    expect(collectCallerBlockDefects(ref)).toEqual([])
  })

  it('known-bad probes: a lost gate, a repair, an unscrubbed paste, a late append', () => {
    const ref = ensurePrReadyReference()
    const seeds: ReadonlyArray<{ label: string; from: string; to: string; expected: string }> = [
      {
        label: 'ungated',
        from: ' check block <file>',
        to: ' render --plan <file>',
        expected: 'the gate is `verify-evidence.cjs check block`',
      },
      {
        label: 'repairing',
        from: 'never repaired or partly pasted',
        to: 'repaired, then pasted',
        expected: 'a refused block is omitted, never repaired or partly pasted',
      },
      {
        label: 'scrub failure pastes',
        from: ' — a failed one posts neither block',
        to: '',
        expected: 'a failed scrub posts neither block',
      },
      {
        label: 'interpolated',
        from: ', never via a shell string,',
        to: ' or an echo,',
        expected: 'the value is Written to a new file in a mktemp -d folder, not a shell string',
      },
    ]
    for (const seed of seeds) {
      const wounded = ref.replace(seed.from, seed.to)
      expect(wounded, `${seed.label}: the seed must land`).not.toBe(ref)
      expect(collectCallerBlockDefects(wounded), seed.label).toEqual([seed.expected])
    }
    // The blocks appended AFTER the scrub would publish them unredacted.
    const late = ref.replace(`${APPEND}. ${SCRUB}`, `${SCRUB}, ${APPEND}`)
    expect(late, 'late-append: the seed must land').not.toBe(ref)
    expect(collectCallerBlockDefects(late)).toEqual([
      'a failed scrub posts neither block',
      `${PR_READY_REL}: [the blocks join the body before the D11 scrub] "${APPEND}" does not precede "${SCRUB}"`,
    ])
    // A rule that left step 4a is no rule at all.
    expect(collectCallerBlockDefects(ref.replace(CALLER_BLOCKS, '   - **Blocks**')))
      .toEqual(['no single caller-blocks rule under step 4a'])
  })

  it('the reference states the same caller-block rule under every provider', () => {
    // The PR skeleton is one write expanded into three files; each provider's copy must carry it.
    for (const provider of TRACKER_PROVIDERS.map(p => p.id)) {
      expect(collectCallerBlockDefects(ensurePrReadyReference(provider)), provider).toEqual([])
    }
  })

  it('the ensure-pr-ready reference declares the test-plan block as an optional input, and no wave block', () => {
    for (const provider of TRACKER_PROVIDERS.map(p => p.id)) {
      const ref = ensurePrReadyReference(provider)
      const section = ref.slice(ref.indexOf('## Operation: ensure-pr-ready'))
      const input = section.split('\n').find(l => l.startsWith('**Input:**')) ?? ''
      expect(input, `${provider}: the ensure-pr-ready Input line`).not.toBe('')
      expect(input, provider).toContain('`PR_TEST_PLAN_BLOCK` (optional)')
      expect(input, provider).not.toContain('PR_WAVE_BLOCK')
    }
  })

  it('no provider reference names the wave block input or its gate', () => {
    for (const provider of TRACKER_PROVIDERS.map(p => p.id)) {
      const ref = ensurePrReadyReference(provider)
      expect(ref.length, `${provider}: the reference is empty`).toBeGreaterThan(0)
      expect(collectWaveResidue(ref), provider).toEqual([])
    }
  })

  it('known-bad probe: a wave input or gate seeded into the reference is reported', () => {
    const ref = ensurePrReadyReference()
    expect(collectWaveResidue(`${ref}\n- PR_WAVE_BLOCK (optional)`)).toEqual(['- PR_WAVE_BLOCK (optional)'])
    expect(collectWaveResidue(ref.replace('check block <file>', 'check wave <file>'))).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// The gate the reference names — executed against the real script
// ---------------------------------------------------------------------------

const EM = '—'

const PLAN = [
  '## Test Plan',
  `- [ ] TP-1 (AC-1) the PR carries its test plan ${EM} method:ci`,
  '',
].join('\n')

/** Run one verify-evidence subcommand in-process over a text written to a scratch file. */
function runOnText(sub: readonly string[], text: string, name: string): { code: number; stdout: string } {
  const file = path.join(SCRATCH, name)
  writeFileSync(file, text)
  return VE.main(['node', 'verify-evidence.cjs', ...sub, file], { stderr: () => {} })
}

/** The block the gate must admit: a rendered test plan. */
function admittedSample(): string {
  const r = runOnText(['render', '--plan'], PLAN, 'plan.md')
  if (r.code !== 0) throw new Error(`render --plan exited ${r.code}`)
  return r.stdout
}

/** Named collector: subcommands the script does not decide as the paste rule needs. */
export function collectGateMisroutes(subs: readonly string[]): string[] {
  const out: string[] = []
  const sample = admittedSample()
  for (const sub of subs) {
    const admit = runOnText(['check', sub], sample, `${sub}-ok.md`)
    if (admit.code !== 0 || admit.stdout !== '') out.push(`check ${sub}: its own block exits ${admit.code}, not an admit`)
    const refuse = runOnText(['check', sub], '(none)\n', `${sub}-none.md`)
    if (refuse.code !== 5 || refuse.stdout !== '') out.push(`check ${sub}: the (none) placeholder exits ${refuse.code}, not 5`)
  }
  return out
}

describe('ensure-pr-ready 4a: the named gate routes to the real script (AC-4)', () => {
  it('the reference names exactly `check block`, and it admits its block and refuses (none)', () => {
    const subs = collectGateSubcommands(ensurePrReadyReference())
    expect(subs).toEqual(['block'])
    expect(collectGateMisroutes(subs)).toEqual([])
  })

  it('the wave gate is no subcommand of the script: it exits 1 with nothing on stdout', () => {
    expect(runOnText(['check', 'wave'], admittedSample(), 'wave.md')).toEqual({ code: 1, stdout: '' })
  })

  it('known-bad probe: a reference naming a subcommand the script does not route is reported', () => {
    const wounded = ensurePrReadyReference().replace('check block <file>', 'check blocks <file>')
    const subs = collectGateSubcommands(wounded)
    expect(subs).toEqual(['blocks'])
    expect(collectGateMisroutes(subs)).toEqual([
      'check blocks: its own block exits 1, not an admit',
      'check blocks: the (none) placeholder exits 1, not 5',
    ])
  })
})

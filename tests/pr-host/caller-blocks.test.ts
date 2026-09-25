/**
 * ensure-pr-ready step 4a's caller blocks (#365, PR6; AC-4).
 *
 * A caller may hand ensure-pr-ready two pre-rendered blocks for the PR body it
 * creates: `PR_WAVE_BLOCK` (the wave's `## Related Issues` plus its evidence
 * table, from /dynamic-build) and `PR_TEST_PLAN_BLOCK` (the rendered test plan,
 * from /code-review and /bug-analysis). Both are attacker-influenceable text by
 * the time they reach a GitHub-visible sink, so the reference admits each one
 * only behind the script that owns its grammar — never a prose regex:
 *
 *   - order: the wave block, then the test-plan block;
 *   - the gate: each is Written to a fresh `mktemp` file and passed through
 *     `verify-evidence.cjs check wave|block`; only `exit=0` admits it, verbatim;
 *   - the refusal: anything else omits it — never repaired or partly pasted —
 *     and emits its named DEGRADED reason;
 *   - the 4b skip: an admitted wave block IS the body's `## Related Issues`;
 *   - the scrub: the blocks join the body before the D11 scrub, and a failed
 *     scrub posts neither.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector (PF-064). The gate is also EXECUTED: the
 * two subcommands the reference names are run against the real script, so a
 * reference naming a subcommand the script does not route goes red here rather
 * than at a user's PR.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { collectOrderViolations, prHostRel, resolveAgentSource, type OrderRule } from '../helpers.js'
import { VERIFY_EVIDENCE_SCRIPT } from '../evidence/seam.js'

/** Transcribed from the script's JSDoc — only what this suite calls. */
interface VerifyEvidenceApi {
  main(argv: readonly string[], deps?: { stderr?: (text: string) => void }): { code: number; stdout: string }
}
const VE = createRequire(import.meta.url)(VERIFY_EVIDENCE_SCRIPT) as VerifyEvidenceApi

const SCRATCH = mkdtempSync(path.join(tmpdir(), 'devflow-caller-blocks-'))
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

/** The built PR-host reference for ensure-pr-ready — fail-loud when dist is absent. */
function prReadyRef(): string {
  const file = path.join(compiledSkillRefsDir(), ...prHostRel('ensure-pr-ready').split('/'))
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`${prHostRel('ensure-pr-ready')} is absent — run \`npm run build\` first`)
  }
}

// ---------------------------------------------------------------------------
// The rule, as the reference states it
// ---------------------------------------------------------------------------

const STEP_4A = '4a. Check if PR exists'
const STEP_4C = '4c. Retitle'
const CALLER_BLOCKS = '   - **Caller blocks**'
const WAVE_FIRST = '`PR_WAVE_BLOCK` (`check wave`), then `PR_TEST_PLAN_BLOCK` (`check block`)'
const GATE = 'verify-evidence.cjs" check <wave|block> <file>; echo "exit=$?"'
const APPEND = 'then append the caller blocks'
const SCRUB = 'Apply the Comment-sink scrub (D11)'
const WAVE_REASON = '`TRACEABILITY: DEGRADED (wave block does not match its grammar)`'
const TEST_PLAN_REASON = '`TRACEABILITY: DEGRADED (test-plan block does not match its grammar)`'

/** The ordering claims over the whole reference: the bullet sits inside 4a, blocks join before the scrub. */
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
  need('the wave block comes first, then the test-plan block', line.includes(WAVE_FIRST))
  need('a block is taken only when given and not `(none)`', line.includes('each when given and not `(none)`'))
  need('the value is Written to a fresh mktemp file, not a shell string',
    line.includes('to a fresh `mktemp` file with the Write tool') && line.includes('never via a shell string'))
  need('the gate is `verify-evidence.cjs check wave|block`', line.includes(GATE))
  need('only `exit=0` admits a block, verbatim', line.includes('Only `exit=0` admits it, verbatim'))
  need('a refused block is omitted, never repaired or partly pasted', line.includes('never repaired or partly pasted'))
  need('the wave refusal reason', line.includes(WAVE_REASON))
  need('the test-plan refusal reason', line.includes(TEST_PLAN_REASON))
  need('the refusals report under the Output\'s steps-4b/4c line', line.includes('with steps 4b/4c\'s lines'))
  need('an admitted wave block skips step 4b',
    line.includes('An admitted wave block is the body\'s only `## Related Issues`: skip 4b.'))
  need('a failed scrub posts neither block', step4a.includes(`${SCRUB} — a failed one posts neither block`))
  out.push(...collectOrderViolations('pr/ensure-pr-ready.md', ref, REF_ORDER))
  return out
}

/** Named collector: the `check` subcommands the gate names, read out of `check <a|b>`. */
export function collectGateSubcommands(ref: string): string[] {
  const m = /verify-evidence\.cjs" check <([a-z|]+)> <file>/.exec(callerBlocksLine(ref) ?? '')
  return m === null ? [] : m[1].split('|')
}

describe('ensure-pr-ready 4a: the caller blocks are pasted only behind their checks (AC-4)', () => {
  it('the reference states the order, the gate, the refusal, the 4b skip and the scrub exclusion', () => {
    const ref = prReadyRef()
    expect(ref.length, 'the PR-host reference is empty').toBeGreaterThan(0)
    expect(collectCallerBlockDefects(ref)).toEqual([])
  })

  it('known-bad probes: a reversed order, a lost gate, a repair, a kept 4b, an unscrubbed paste', () => {
    const ref = prReadyRef()
    const seeds: ReadonlyArray<{ label: string; from: string; to: string; expected: string }> = [
      {
        label: 'reversed',
        from: WAVE_FIRST,
        to: '`PR_TEST_PLAN_BLOCK` (`check block`), then `PR_WAVE_BLOCK` (`check wave`)',
        expected: 'the wave block comes first, then the test-plan block',
      },
      {
        label: 'ungated',
        from: ' check <wave|block> <file>',
        to: ' render --plan <file>',
        expected: 'the gate is `verify-evidence.cjs check wave|block`',
      },
      {
        label: 'repairing',
        from: 'never repaired or partly pasted',
        to: 'repaired, then pasted',
        expected: 'a refused block is omitted, never repaired or partly pasted',
      },
      {
        label: '4b kept',
        from: ' An admitted wave block is the body\'s only `## Related Issues`: skip 4b.',
        to: '',
        expected: 'an admitted wave block skips step 4b',
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
        expected: 'the value is Written to a fresh mktemp file, not a shell string',
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
      `pr/ensure-pr-ready.md: [the blocks join the body before the D11 scrub] "${APPEND}" does not precede "${SCRUB}"`,
    ])
    // A rule that left step 4a is no rule at all.
    expect(collectCallerBlockDefects(ref.replace(CALLER_BLOCKS, '   - **Blocks**')))
      .toEqual(['no single caller-blocks rule under step 4a'])
  })

  it('git.md declares both blocks as optional ensure-pr-ready inputs', () => {
    const git = resolveAgentSource('git').content
    const section = git.slice(git.indexOf('## Operation: ensure-pr-ready'))
    const input = section.split('\n').find(l => l.startsWith('**Input:**')) ?? ''
    expect(input, 'the ensure-pr-ready Input line').not.toBe('')
    expect(input).toContain('`PR_TEST_PLAN_BLOCK` (optional)')
    expect(input).toContain('`PR_WAVE_BLOCK` (optional)')
  })
})

// ---------------------------------------------------------------------------
// The gate the reference names — executed against the real script
// ---------------------------------------------------------------------------

const EM = '—'

/** The §3.1 wave block of the #365 design: admitted as written. */
const WAVE_BLOCK = [
  '## Related Issues',
  'Closes #12',
  'Closes #14',
  'Refs #13',
  '',
  '## Wave Evidence',
  '| T | Ticket | Verdict | Evaluate | Test | Surviving | Coverage |',
  '|---|---|---|---|---|---|---|',
  '| T1 | #12 | PASS | PASS | PASS | 0 | complete |',
  '| T2 | #14 | UNVERIFIED | PASS | FAIL-FIXED | 0 | complete |',
  '| T3 | #13 | QUARANTINED | FAIL-FIXED | SKIPPED | 2 | incomplete |',
  `| T4 | #15 | BLOCKED | ${EM} | ${EM} | ${EM} | ${EM} |`,
  '',
].join('\n')

const PLAN = [
  '## Test Plan',
  `- [ ] TP-1 (AC-1) the wave PR carries its evidence table ${EM} method:ci`,
  '',
].join('\n')

/** Run one verify-evidence subcommand in-process over a text written to a scratch file. */
function runOnText(sub: readonly string[], text: string, name: string): { code: number; stdout: string } {
  const file = path.join(SCRATCH, name)
  writeFileSync(file, text)
  return VE.main(['node', 'verify-evidence.cjs', ...sub, file], { stderr: () => {} })
}

/** The block each subcommand must admit: the wave example, or a rendered test plan. */
function admittedSample(sub: string): string {
  if (sub === 'wave') return WAVE_BLOCK
  const r = runOnText(['render', '--plan'], PLAN, 'plan.md')
  if (r.code !== 0) throw new Error(`render --plan exited ${r.code}`)
  return r.stdout
}

/** Named collector: subcommands the script does not decide as the paste rule needs. */
export function collectGateMisroutes(subs: readonly string[]): string[] {
  const out: string[] = []
  for (const sub of subs) {
    const sample = sub === 'wave' || sub === 'block' ? admittedSample(sub) : WAVE_BLOCK
    const admit = runOnText(['check', sub], sample, `${sub}-ok.md`)
    if (admit.code !== 0 || admit.stdout !== '') out.push(`check ${sub}: its own block exits ${admit.code}, not an admit`)
    const refuse = runOnText(['check', sub], '(none)\n', `${sub}-none.md`)
    if (refuse.code !== 5 || refuse.stdout !== '') out.push(`check ${sub}: the (none) placeholder exits ${refuse.code}, not 5`)
  }
  return out
}

describe('ensure-pr-ready 4a: the named gate routes to the real script (AC-4)', () => {
  it('the reference names exactly `check wave` and `check block`, and each admits its block and refuses (none)', () => {
    const subs = collectGateSubcommands(prReadyRef())
    expect(subs).toEqual(['wave', 'block'])
    expect(collectGateMisroutes(subs)).toEqual([])
  })

  it('a closing line moved onto the QUARANTINED row is refused, so it never reaches the PR body', () => {
    const moved = WAVE_BLOCK.replace('Refs #13', 'Closes #13')
    expect(moved).not.toBe(WAVE_BLOCK)
    expect(runOnText(['check', 'wave'], moved, 'moved.md')).toEqual({ code: 5, stdout: '' })
  })

  it('known-bad probe: a reference naming a subcommand the script does not route is reported', () => {
    const wounded = prReadyRef().replace('check <wave|block> <file>', 'check <waves|block> <file>')
    const subs = collectGateSubcommands(wounded)
    expect(subs).toEqual(['waves', 'block'])
    expect(collectGateMisroutes(subs)).toEqual([
      'check waves: its own block exits 1, not an admit',
      'check waves: the (none) placeholder exits 1, not 5',
    ])
  })
})

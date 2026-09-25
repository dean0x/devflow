/**
 * AC-17 — each release write to the shipped issues is policy-gated at its ONE
 * call site: `backlink-shipped-issues` (step 4b) and, since #364 (PR5),
 * `associate-release` (step 4c), which adds each issue to the release's tracker
 * marker.
 *
 * Both operations write to every issue a release shipped, so whether they run at
 * all is a policy question and not a mechanics one. `/release` decides: Phase 6
 * spawns each only when the resolved evidence policy is `required` — two spawns,
 * never one two-op spawn — and Phase 4's **Gather release evidence** step gates
 * the evidence-gathering that feeds them on the same condition (#362 moved both
 * from the installed compliance skill to `EVIDENCE_POLICY`; #364 moved the gather
 * from Phase 6 to Phase 4 and let a `--dry-run` gather under either policy, which
 * never reaches Phase 6). Nothing else may decide, and that is the property with
 * no executed evidence before this file.
 *
 * WHY A MATRIX AND NOT A PRESENCE CHECK. "The gate is stated" is cleared by the
 * caller alone. The failure this guards is the other half: a provider's
 * `backlink-shipped-issues.md` acquiring its own compliance condition. Twenty
 * per-operation files authored against a caller-side gate will eventually
 * restate it, and a second copy is a second policy — one that varies per
 * provider and that `/release` cannot see. So both halves are asserted for every
 * registered provider: the caller gates, the operation does not.
 *
 * The operation half is not a bare absence either. A file that shipped EMPTY
 * would pass an absence-only arm, so each provider's file is also required to
 * carry the mechanics it exists for — its own entry gate and the never-report-
 * COMPLETE-over-zero rule — read off what the generated files actually say.
 *
 * THE OPERATION HALF, WIDENED (#362, AC-5). The same doctrine holds for every
 * operation, not only this one: a caller decides whether a compliance-dependent
 * step runs, and passes the Git agent a mechanism input (`ISSUE_REQUIRED`,
 * `APPLY_CONVENTIONS`) that the step names. So the second describe below reads
 * the whole op surface — `dist/agents/git.md` and every generated reference —
 * and requires ZERO condition-shaped compliance mentions in it. A mention that
 * names compliance without gating on it (the conventions learner's "compliance
 * defaults") is not a condition and stays legal.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { compiledSkillRefsDir } from '../../src/core/assets.js';
import { walkFiles } from '../helpers.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const REFS_DIR = compiledSkillRefsDir();

/**
 * The operations this file is about, each with the /release step that spawns it
 * and any clause that step adds to the policy gate.
 *
 * `associate-release` is also skipped when there is nothing to associate: an
 * empty `SHIPPED_ISSUES` would resolve — and on GitHub CREATE — a release marker
 * with no item to put on it.
 */
const OPS: ReadonlyArray<{ readonly op: string; readonly step: string; readonly extraClause?: string }> = [
  { op: 'backlink-shipped-issues', step: '4b' },
  { op: 'associate-release', step: '4c', extraClause: 'and `SHIPPED_ISSUES` is non-empty' },
];

/**
 * The gate's condition as `/release` spells it — the canonical caller-side policy
 * phrase. A near-miss spelling is the failure mode a substring search would not
 * catch: the step would read as gated to a human and name a variable nothing sets.
 */
const GATE = 'only when `EVIDENCE_POLICY` is `required`';

/**
 * The gather step's own condition (#364): a `--dry-run` gathers under either
 * policy — it reports the trace and halts after Phase 4, so it never reaches the
 * back-link — and a real release gathers under the same GATE as the back-link.
 * Asserted to CONTAIN `GATE`, so the pair cannot diverge on the real-release arm.
 */
const GATHER_GATE = 'under either policy when `DRY_RUN` is true, otherwise only when `EVIDENCE_POLICY` is `required`';

/**
 * Named collector: the release command's lines that spawn `op` through the Git
 * agent — the call sites AC-17 counts. Driven by the live arm and by the probes.
 */
function collectSpawnSteps(release: string, op: string): string[] {
  return release
    .split('\n')
    .filter(line => line.includes(`\`${op}\``) && line.includes('Agent(subagent_type="Git")'));
}

/**
 * Named collector: lines of an operation's mechanics that name the evidence
 * policy at all. An agent is passed the mechanism inputs only, never
 * `EVIDENCE_POLICY` (the partial's hand-off rule), so any mention in an op file
 * is a second policy decision the caller cannot see.
 */
function collectPolicyMentions(label: string, body: string): string[] {
  const hits: string[] = [];
  body.split('\n').forEach((line, i) => {
    if (/\bEVIDENCE_POLICY\b/.test(line)) hits.push(`${label}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return hits;
}

/**
 * Every provider whose mechanics ship. Hardcoded rather than derived from the
 * variant registry ON PURPOSE: the registry is what decides which files are
 * generated, so deriving the roster from it would make a provider that silently
 * stopped generating its mechanics disappear from this matrix instead of failing
 * it. A new provider fails here until someone adds the row — which is the
 * prompt to decide whether its back-link is gated the same way.
 */
const PROVIDERS = ['github', 'jira', 'linear'] as const;

function requireFile(label: string, filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    throw new Error(
      `${label}: ${filePath} is absent — run \`npm run build\` first\n` +
      '  (this guard reads generated references; it cannot be skipped)',
    );
  }
}

/**
 * A compliance CONDITION, case-insensitive — the shapes a gate on compliance takes:
 *
 *   compliance-gated / compliance gated      the retired step prefix
 *   COMPLIANCE_SKILL_INSTALLED               the command-layer variable
 *   `COMPLIANCE` / **COMPLIANCE**            the retired op-level input, as an Input
 *                                            line and as a prose reference
 *   compliance mode|input|enabled|skill is installed
 *                                            a condition named as a state
 *   if|when|unless|only when|gated on|by … compliance
 *                                            a conditional clause, up to 60 chars
 *                                            and within one sentence
 *
 * The last arm is negated for `compliance defaults` and `compliance framework(s)`:
 * the conventions learner applies "compliance defaults" when git history shows no
 * pattern, which names a set of defaults and gates nothing.
 *
 * One more arm is case-SENSITIVE, so it lives in COMPLIANCE_KEY_RE: the bare
 * uppercase key `COMPLIANCE` in any spelling (`COMPLIANCE: enabled`, "when
 * COMPLIANCE is set"). The retired setup-task-common guard matched it anywhere in
 * the setup-task and fetch-issue references; this collector keeps that reach on the
 * whole op surface, so widening the corpus never narrowed the token set.
 *
 * NOT covered (PF-064): a compliance gate in synonyms ("only for regulated
 * projects"), or a conditional clause more than 60 characters, or a sentence
 * boundary, before the word. A clean result means none of these shapes occurred.
 */
const COMPLIANCE_CONDITION_RE =
  /compliance[- ]gated|COMPLIANCE_SKILL_INSTALLED|`COMPLIANCE`|\*\*COMPLIANCE\*\*|\bcompliance (?:mode|input|enabled|skill is installed)\b|\b(?:if|when|unless|only when|gated (?:on|by))\b[^.\n]{0,60}\bcompliance\b(?!\s+(?:defaults|frameworks?)\b)/i;

/**
 * Named collector: compliance conditions stated inside an operation's own
 * mechanics or the agent's contract.
 *
 * Driven by every live arm and by the known-bad probes, so each probe exercises
 * the real predicate rather than a copy of it.
 */
/** The retired op-level key as a bare uppercase word — never part of `COMPLIANCE_SKILL_INSTALLED`. */
const COMPLIANCE_KEY_RE = /\bCOMPLIANCE\b/;

function collectComplianceConditions(label: string, body: string): string[] {
  const hits: string[] = [];
  body.split('\n').forEach((line, i) => {
    if (COMPLIANCE_CONDITION_RE.test(line) || COMPLIANCE_KEY_RE.test(line)) {
      hits.push(`${label}:${i + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
  return hits;
}

describe('AC-17: the release writes to shipped issues are gated by the caller and by nobody else', () => {
  const release = requireFile('release command', path.join(ROOT, 'dist', 'commands', 'release.md'));

  it('the release command no longer keys either step on the compliance skill', () => {
    expect(release, 'the retired gate variable').not.toContain('COMPLIANCE_SKILL_INSTALLED');
    expect(release, 'the retired step prefix').not.toMatch(/compliance-gated/i);
  });

  for (const { op, step, extraClause } of OPS) {
    it(`${op}: the release command spawns it exactly once, at step ${step}, and gates that spawn`, () => {
      const spawnSteps = collectSpawnSteps(release, op);

      expect(
        spawnSteps.length,
        `expected exactly one step spawning ${op}; a second call site is a second policy`,
      ).toBe(1);
      expect(spawnSteps[0].startsWith(`${step}. `), `the ${op} spawn must be step ${step}`).toBe(true);
      expect(
        spawnSteps[0],
        `the ${op} spawn must carry ${JSON.stringify(GATE)} — an ungated release write touches every ` +
        'issue of every release, for every user, whether or not they asked for traceability',
      ).toContain(GATE);
      if (extraClause !== undefined) {
        expect(spawnSteps[0], `the ${op} spawn must also carry ${JSON.stringify(extraClause)}`).toContain(
          `${GATE} ${extraClause}`,
        );
      }
    });
  }

  it('the two writes are two spawns, never one spawn running both operations', () => {
    for (const { op } of OPS) {
      const others = OPS.filter(o => o.op !== op).map(o => o.op);
      for (const line of collectSpawnSteps(release, op)) {
        for (const other of others) {
          expect(line, `the ${op} spawn also names ${other}`).not.toContain(`\`${other}\``);
        }
      }
    }
  });

  it('known-bad probe: a second call site, an ungated spawn and a dropped clause are reported', () => {
    const [backlink, associate] = OPS;
    const gated = collectSpawnSteps(release, associate.op);
    expect(gated, 'the live 4c line is the probe\'s base').toHaveLength(1);
    const doubled = `${release}\n${gated[0]}`;
    expect(collectSpawnSteps(doubled, associate.op), 'a pasted second 4c is a second call site').toHaveLength(2);

    const ungated = '4c. **Associate shipped issues with the release** — spawn `Agent(subagent_type="Git")` with `associate-release` operation.';
    const [seeded] = collectSpawnSteps(ungated, associate.op);
    expect(seeded, 'the collector must pick up the seeded spawn').toBeDefined();
    expect(seeded).not.toContain(GATE);

    const clauseDropped = gated[0].replace(` ${associate.extraClause}`, '');
    expect(clauseDropped, 'the probe must actually remove the clause').not.toBe(gated[0]);
    expect(clauseDropped).not.toContain(`${GATE} ${associate.extraClause}`);

    // A name that is a prefix-free substring of another op must not be counted for it.
    expect(collectSpawnSteps(gated[0], backlink.op)).toEqual([]);
  });

  it('the evidence it consumes is gated on the same condition, so the pair cannot diverge', () => {
    expect(GATHER_GATE.includes(GATE), 'the gather condition must hold the back-link GATE verbatim').toBe(true);
    const evidenceSteps = release
      .split('\n')
      .filter(line => line.includes('gather-release-evidence') && line.includes('Agent(subagent_type="Git")'));

    expect(evidenceSteps, 'exactly one gather-release-evidence spawn in the release command').toHaveLength(1);
    expect(
      evidenceSteps[0],
      'SHIPPED_ISSUES is what the back-link posts against. Gating the poster while ungating its ' +
      'input would run the enrichment for users who never receive the comment it feeds; only a ' +
      '--dry-run, which halts before the back-link, may gather under either policy',
    ).toContain(GATHER_GATE);
  });

  it('known-bad probe: a gather line that dropped the real-release arm is not GATHER_GATE', () => {
    const ungated = '**Gather release evidence** — under either policy: spawn `Agent(subagent_type="Git")` with `gather-release-evidence` operation.';
    expect(ungated).not.toContain(GATHER_GATE);
    expect(ungated).not.toContain(GATE);
  });

  for (const { op: OP, step } of OPS) for (const provider of PROVIDERS) {
    const rel = `tracker/${provider}/${OP}.md`;

    it(`${OP} / ${provider}: the operation file states its mechanics and NOT the gate`, () => {
      const body = requireFile(rel, path.join(REFS_DIR, rel));

      // The ungated half. A mechanics file that also decided whether to run would
      // be a second policy the caller cannot see.
      expect(
        collectComplianceConditions(rel, body),
        `${rel} states a compliance condition. The gate belongs to /release step ${step}, which is the ` +
        'one site that knows whether the run is a compliance run; a per-provider copy is free to ' +
        'drift from it and nothing compares the two:\n  ' +
        collectComplianceConditions(rel, body).join('\n  '),
      ).toEqual([]);
      expect(
        collectPolicyMentions(rel, body),
        `${rel} names the evidence policy. Agents are never passed it — /release step ${step} gates the ` +
        'spawn, and the operation runs whenever it is spawned',
      ).toEqual([]);

      // …and the file is not empty-passing. These two sentences are what the
      // generated file actually carries for every provider; an absence-only arm
      // above would be cleared by a file that shipped blank.
      expect(
        body,
        `${rel} must state this provider's own entry gate — the shape every SHIPPED_ISSUES entry ` +
        'must satisfy before it reaches a call',
      ).toContain('Ref pre-flight (the always-loaded entry gate, instantiated for this provider).');
      expect(
        body,
        `${rel} must keep the never-COMPLETE-over-zero rule: a COMPLETE over zero processed issues ` +
        'is the report a release believes',
      ).toContain('never report the status as `COMPLETE`');
    });
  }

  it('known-bad probe: the collector reports a gate restated in a mechanics file', () => {
    for (const seeded of [
      '4b. Post the comment (compliance-gated: only when COMPLIANCE_SKILL_INSTALLED).',
      'Run this operation when COMPLIANCE_SKILL_INSTALLED is set.',
    ]) {
      expect(
        collectComplianceConditions('(probe)', seeded),
        `the collector must report ${JSON.stringify(seeded)} — a rule that cannot be shown to fire ` +
        'is a rule that can be deleted unnoticed',
      ).toHaveLength(1);
    }
    // The opposite direction: mechanics prose that merely mentions the word.
    expect(
      collectComplianceConditions('(probe)', 'Compliance frameworks are listed in the skill directory.'),
      'a sentence that names compliance without stating a run condition is not a second gate',
    ).toEqual([]);
    // The policy half: the 825077e release gate, moved into a mechanics file.
    expect(
      collectPolicyMentions('(probe)', `4b. Post the comment (${GATE}).`),
      'the collector must report the caller\'s gate restated in an operation',
    ).toHaveLength(1);
    expect(collectPolicyMentions('(probe)', 'Post one comment per shipped issue.')).toEqual([]);
  });
});

/** One file of the op surface, by its path relative to `dist/`. */
interface OpSurfaceFile {
  readonly rel: string;
  readonly content: string;
}

/** The whole op surface: the compiled agent plus every generated reference. */
function opSurface(): OpSurfaceFile[] {
  const distRoot = path.join(ROOT, 'dist');
  const gitMd = path.join(distRoot, 'agents', 'git.md');
  const files = [gitMd, ...walkFiles(REFS_DIR, f => f.endsWith('.md'))];
  return files.map(f => ({
    rel: path.relative(distRoot, f).split(path.sep).join('/'),
    content: requireFile('op surface', f),
  }));
}

/**
 * One sentinel per corpus class, so reach is proven by name rather than by a size
 * floor (PF-064), each paired with the retired text that class used to carry.
 */
const CLASS_PROBES: ReadonlyArray<{ readonly cls: string; readonly sentinel: string; readonly seeds: readonly string[] }> = [
  {
    cls: 'agent contract',
    sentinel: 'agents/git.md',
    seeds: [
      '- **COMPLIANCE** (optional): `enabled` when the compliance skill is installed; absent or `(none)` otherwise',
      '1b/1c are compliance-gated. When step 1b finds `.devflow/conventions.md` absent it invokes `learn-conventions`.',
    ],
  },
  {
    cls: 'tracker reference',
    sentinel: 'skills/git/references/tracker/github/ensure-traceable-issue.md',
    seeds: [
      '- Issue creation is gated by the `COMPLIANCE` input: `enabled` → mandatory (DEGRADED states exempt), absent or `(none)` → optional.',
    ],
  },
  {
    cls: 'PR-host reference',
    sentinel: 'skills/git/references/pr/ensure-pr-ready.md',
    seeds: [
      '4c. (Compliance-gated — skip if `COMPLIANCE` is absent or `(none)`) Read `.devflow/conventions.md` PR Titles section.',
    ],
  },
  {
    cls: 'cross-cutting reference',
    sentinel: 'skills/git/references/publication-gate.md',
    seeds: ['Run only when compliance is enabled.'],
  },
];

describe('AC-5: no operation or reference states a compliance condition (#362)', () => {
  const surface = opSurface();

  it('the corpus is git.md plus every generated reference, and reaches each class', () => {
    expect(surface.map(f => f.rel), 'the compiled agent must be in the corpus').toContain('agents/git.md');
    expect(surface.length, 'fewer references than the installed tree carries — is dist/ stale?').toBeGreaterThanOrEqual(30);
    for (const { cls, sentinel } of CLASS_PROBES) {
      expect(surface.map(f => f.rel), `${cls}: sentinel ${sentinel} was not read`).toContain(sentinel);
    }
  });

  it('zero condition-shaped compliance mentions across the op surface', () => {
    const hits = surface.flatMap(f => collectComplianceConditions(f.rel, f.content));
    expect(
      hits,
      'a compliance condition in an op or reference is a second policy the caller cannot see. The ' +
      'caller resolves the evidence policy and passes a mechanism input; the step names that input:\n  ' +
      hits.join('\n  '),
    ).toEqual([]);
  });

  for (const { cls, sentinel, seeds } of CLASS_PROBES) {
    it(`known-bad probe (${cls}): the retired text, seeded into ${sentinel}, is reported`, () => {
      const real = surface.find(f => f.rel === sentinel);
      expect(real, `${sentinel} is not in the corpus`).toBeDefined();
      for (const seed of seeds) {
        const hits = collectComplianceConditions(sentinel, `${real!.content}\n${seed}\n`);
        expect(hits, `the collector must report ${JSON.stringify(seed)} inside ${sentinel}`).toHaveLength(1);
        expect(hits[0]).toContain(seed.slice(0, 40));
      }
    });
  }

  it('known-bad probe: the bare uppercase key, unquoted, is reported in any reference', () => {
    // The retired setup-task-common guard matched /COMPLIANCE/ anywhere; the key
    // without backticks or bold must not slip past the widened collector.
    for (const seed of ['COMPLIANCE: enabled', 'Skip this step when COMPLIANCE is (none).']) {
      expect(collectComplianceConditions('(probe)', seed), JSON.stringify(seed)).toHaveLength(1);
    }
    expect(collectComplianceConditions('(probe)', 'DEVFLOW_COMPLIANCE_SCOPE'), 'part of a longer identifier').toEqual([]);
  });

  it('negative probes: a mention that names compliance without gating on it is not a condition', () => {
    for (const benign of [
      '3. For each section, apply heuristics with a 50% majority rule. If no clear pattern: apply compliance defaults:',
      'Learn project conventions from git history and write `.devflow/conventions.md` once. Uses compliance defaults for unlearnable sections.',
      'Compliance frameworks are listed in the skill directory.',
    ]) {
      expect(collectComplianceConditions('(probe)', benign), JSON.stringify(benign)).toEqual([]);
    }
  });
});

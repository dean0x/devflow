/**
 * AC-17 — `backlink-shipped-issues` is compliance-gated at its ONE call site.
 *
 * The operation writes to every issue a release shipped, so whether it runs at
 * all is a policy question and not a mechanics one. `/release` decides: step 4b
 * spawns it only when the compliance skill is installed, and step 2b gates the
 * evidence-gathering that feeds it on the same condition. Nothing else may
 * decide, and that is the property with no executed evidence before this file.
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
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { compiledSkillRefsDir } from '../../src/core/assets.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const REFS_DIR = compiledSkillRefsDir();

/** The operation this file is about, spelled once. */
const OP = 'backlink-shipped-issues';

/**
 * The gate's condition as `/release` spells it. A near-miss spelling is the
 * failure mode a substring search over `compliance` would not catch: the step
 * would read as gated to a human and name a variable nothing sets.
 */
const GATE = 'compliance-gated: only when COMPLIANCE_SKILL_INSTALLED';

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
 * Named collector: compliance conditions stated inside an operation's own
 * mechanics.
 *
 * Both spellings the caller uses, because either one appearing in a mechanics
 * file is the same defect. Driven by the live arms and by the known-bad probe,
 * so the probe exercises the real predicate rather than a copy of it.
 */
function collectComplianceConditions(label: string, body: string): string[] {
  const hits: string[] = [];
  for (const line of body.split('\n')) {
    if (/COMPLIANCE_SKILL_INSTALLED|compliance-gated/.test(line)) {
      hits.push(`${label}: ${line.trim().slice(0, 120)}`);
    }
  }
  return hits;
}

describe(`AC-17: ${OP} is gated by the caller and by nobody else`, () => {
  const release = requireFile('release command', path.join(ROOT, 'dist', 'commands', 'release.md'));

  it('the release command spawns the operation exactly once, and gates that spawn', () => {
    const spawnSteps = release
      .split('\n')
      .filter(line => line.includes(OP) && line.includes('Agent(subagent_type="Git")'));

    expect(
      spawnSteps.length,
      `expected exactly one step spawning ${OP}; a second call site is a second policy`,
    ).toBe(1);
    expect(
      spawnSteps[0],
      `the ${OP} spawn must carry ${JSON.stringify(GATE)} — an ungated back-link writes to every ` +
      'issue of every release, for every user, whether or not they asked for traceability',
    ).toContain(GATE);
  });

  it('the evidence it consumes is gated on the same condition, so the pair cannot diverge', () => {
    const evidenceStep = release
      .split('\n')
      .find(line => line.includes('gather-release-evidence') && line.includes('Agent(subagent_type="Git")'));

    expect(evidenceStep, 'no gather-release-evidence spawn in the release command').toBeDefined();
    expect(
      evidenceStep,
      'SHIPPED_ISSUES is what the back-link posts against. Gating the poster while ungating its ' +
      'input would run the enrichment for users who never receive the comment it feeds',
    ).toContain(GATE);
  });

  for (const provider of PROVIDERS) {
    const rel = `tracker/${provider}/${OP}.md`;

    it(`${provider}: the operation file states its mechanics and NOT the gate`, () => {
      const body = requireFile(rel, path.join(REFS_DIR, rel));

      // The ungated half. A mechanics file that also decided whether to run would
      // be a second policy the caller cannot see.
      expect(
        collectComplianceConditions(rel, body),
        `${rel} states a compliance condition. The gate belongs to /release step 4b, which is the ` +
        'one site that knows whether the run is a compliance run; a per-provider copy is free to ' +
        'drift from it and nothing compares the two:\n  ' +
        collectComplianceConditions(rel, body).join('\n  '),
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
  });
});

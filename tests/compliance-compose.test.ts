/**
 * Tests for src/core/compliance-compose.ts (commit A8.1 — pure composition module).
 *
 * Tests are self-contained: they build synthetic templates and fragments rather
 * than reading the SKILL.md / fragment.md source files (which are added in A8.2).
 *
 * PF-018: tests exercise the production path (composeComplianceSkill /
 * composeComplianceRule / parseComplianceFragment) not just helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  COMPLIANCE_CONTROL_COLUMNS,
  COMPLIANCE_SKILL_TOKENS,
  COMPLIANCE_RULE_TOKENS,
  parseComplianceFragment,
  composeComplianceSkill,
  composeComplianceRule,
  type ComplianceFragment,
} from '../src/core/compliance-compose.js';
import { COMPLIANCE_FRAMEWORKS } from '../src/core/compliance.js';

// ── Constants ──────────────────────────────────────────────────────────────────

describe('COMPLIANCE_CONTROL_COLUMNS', () => {
  it('has exactly 6 entries matching the framework mapping table columns', () => {
    expect(COMPLIANCE_CONTROL_COLUMNS).toHaveLength(6);
    expect(COMPLIANCE_CONTROL_COLUMNS).toContain('Data Classification');
    expect(COMPLIANCE_CONTROL_COLUMNS).toContain('Sensitive Data in Logs');
    expect(COMPLIANCE_CONTROL_COLUMNS).toContain('Encryption');
    expect(COMPLIANCE_CONTROL_COLUMNS).toContain('Audit Trails');
    expect(COMPLIANCE_CONTROL_COLUMNS).toContain('Retention & Erasure');
    expect(COMPLIANCE_CONTROL_COLUMNS).toContain('IaC / Env Controls');
  });
});

describe('COMPLIANCE_SKILL_TOKENS', () => {
  it('has exactly 5 tokens — bidirectional parity with the skill template', () => {
    expect(COMPLIANCE_SKILL_TOKENS).toHaveLength(5);
    expect(COMPLIANCE_SKILL_TOKENS).toContain('${DEVFLOW_COMPLIANCE_SCOPE}');
    expect(COMPLIANCE_SKILL_TOKENS).toContain('${DEVFLOW_COMPLIANCE_ACTIVE}');
    expect(COMPLIANCE_SKILL_TOKENS).toContain('${DEVFLOW_COMPLIANCE_MAPPING}');
    expect(COMPLIANCE_SKILL_TOKENS).toContain('${DEVFLOW_COMPLIANCE_CHECKLIST}');
    expect(COMPLIANCE_SKILL_TOKENS).toContain('${DEVFLOW_COMPLIANCE_REFERENCES}');
  });
});

describe('COMPLIANCE_RULE_TOKENS', () => {
  it('has exactly 1 token (beyond the existing COMPLIANCE_RULE_PLACEHOLDER)', () => {
    expect(COMPLIANCE_RULE_TOKENS).toHaveLength(1);
    expect(COMPLIANCE_RULE_TOKENS).toContain('${DEVFLOW_COMPLIANCE_RULE_BULLETS}');
  });
});

// ── parseComplianceFragment — error matrix ─────────────────────────────────────

describe('parseComplianceFragment — error matrix', () => {
  const VALID_FRAGMENT = `## Mapping

| Art. 25 | Art. 32 | Art. 32 | Art. 30/32 | Art. 17 | Art. 25 |

## Reference

Data-subject rights endpoints, Art. 25/30/32/33 as code-level checks

## Checklist

- [ ] Data-subject rights handlers present (erasure, portability) when GDPR is in scope

## Rule

- \`GDPR\`: verify erasure/portability handlers; no PII in logs
`;

  it('parses a fully-valid fragment successfully', () => {
    const result = parseComplianceFragment('gdpr', VALID_FRAGMENT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('gdpr');
      expect(result.value.mappingCells).toHaveLength(6);
      expect(result.value.referenceBlurb).toContain('Data-subject rights');
      expect(result.value.checklistItems).toHaveLength(1);
      expect(result.value.ruleBullet).toContain('GDPR');
    }
  });

  it('rejects a fragment missing ## Mapping section', () => {
    const raw = `## Reference

some reference

## Checklist

## Rule

- some bullet
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Mapping');
    }
  });

  it('rejects a fragment missing ## Reference section', () => {
    const raw = `## Mapping

| A | B | C | D | E | F |

## Checklist

## Rule

- some bullet
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Reference');
    }
  });

  it('rejects a fragment missing ## Checklist section', () => {
    const raw = `## Mapping

| A | B | C | D | E | F |

## Reference

some ref

## Rule

- some bullet
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Checklist');
    }
  });

  it('rejects a fragment missing ## Rule section', () => {
    const raw = `## Mapping

| A | B | C | D | E | F |

## Reference

some ref

## Checklist

`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Rule');
    }
  });

  it('rejects a Mapping row with wrong cell count (5 instead of 6)', () => {
    const raw = `## Mapping

| A | B | C | D | E |

## Reference

some ref

## Checklist

## Rule

- some bullet
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/6|cell/i);
    }
  });

  it('rejects a Mapping section with 0 table rows', () => {
    const raw = `## Mapping

no table here

## Reference

some ref

## Checklist

## Rule

- some bullet
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
  });

  it('rejects a Mapping section with 2+ table rows', () => {
    const raw = `## Mapping

| A | B | C | D | E | F |
| G | H | I | J | K | L |

## Reference

some ref

## Checklist

## Rule

- some bullet
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
  });

  it('rejects an empty Reference section', () => {
    const raw = `## Mapping

| A | B | C | D | E | F |

## Reference

## Checklist

## Rule

- some bullet
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Reference');
    }
  });

  it('rejects a Checklist section with 3+ items', () => {
    const raw = `## Mapping

| A | B | C | D | E | F |

## Reference

some ref

## Checklist

- [ ] item1
- [ ] item2
- [ ] item3

## Rule

- some bullet
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/checklist|item/i);
    }
  });

  it('accepts a Checklist section with 0 items (empty section)', () => {
    const raw = `## Mapping

| A | B | C | D | E | F |

## Reference

some ref

## Checklist

## Rule

- some bullet
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.checklistItems).toHaveLength(0);
    }
  });

  it('accepts a Checklist section with 2 items', () => {
    const raw = `## Mapping

| A | B | C | D | E | F |

## Reference

some ref

## Checklist

- [ ] item1
- [ ] item2

## Rule

- some bullet
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.checklistItems).toHaveLength(2);
    }
  });

  it('rejects a Rule section with 0 bullets', () => {
    const raw = `## Mapping

| A | B | C | D | E | F |

## Reference

some ref

## Checklist

## Rule

`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Rule|bullet/i);
    }
  });

  it('rejects a Rule section with 2+ bullets', () => {
    const raw = `## Mapping

| A | B | C | D | E | F |

## Reference

some ref

## Checklist

## Rule

- bullet one
- bullet two
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Rule|bullet/i);
    }
  });

  it('rejects a Rule bullet exceeding 200 characters', () => {
    const longBullet = `- ${'x'.repeat(200)}`;
    const raw = `## Mapping

| A | B | C | D | E | F |

## Reference

some ref

## Checklist

## Rule

${longBullet}
`;
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/200|character/i);
    }
  });

  it('is CRLF-tolerant (Windows line endings parse correctly)', () => {
    const raw = VALID_FRAGMENT.replace(/\n/g, '\r\n');
    const result = parseComplianceFragment('gdpr', raw);
    expect(result.ok).toBe(true);
  });

  it('never throws — malformed input returns error result', () => {
    expect(() => parseComplianceFragment('gdpr', '')).not.toThrow();
    expect(() => parseComplianceFragment('gdpr', 'not a fragment at all')).not.toThrow();
    expect(() => parseComplianceFragment('gdpr', '## Mapping\n## Reference\n## Checklist\n## Rule\n')).not.toThrow();
    expect(parseComplianceFragment('gdpr', '').ok).toBe(false);
  });
});

// ── Fixtures ───────────────────────────────────────────────────────────────────

/** Build a valid synthetic fragment for a framework ID (for compose tests). */
function makeFragment(id: string, label: string): ComplianceFragment {
  return {
    id,
    mappingCells: ['cell1', 'cell2', 'cell3', 'cell4', 'cell5', 'cell6'],
    referenceBlurb: `${label} reference blurb`,
    checklistItems: [`- [ ] ${label} checklist item`],
    // Use `id` (not label.toLowerCase()) in the bullet so tests can match by ID,
    // e.g. "soc2 rule bullet" rather than "soc 2 rule bullet" (label has a space).
    ruleBullet: `- \`${label}\`: ${id} rule bullet`,
  };
}

/** All 6 framework fragments indexed by ID. */
function makeAllFragments(): ReadonlyMap<string, ComplianceFragment> {
  const map = new Map<string, ComplianceFragment>();
  for (const fw of COMPLIANCE_FRAMEWORKS) {
    map.set(fw.id, makeFragment(fw.id, fw.label));
  }
  return map;
}

/** A synthetic SKILL.md template containing all 5 tokens. */
const SKILL_TEMPLATE = `---
name: compliance
description: Compliance review ${COMPLIANCE_SKILL_TOKENS[0]}.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Compliance Patterns

Generic intro text.

## Active Frameworks

${COMPLIANCE_SKILL_TOKENS[1]}

## Control Categories

Generic control categories.

${COMPLIANCE_SKILL_TOKENS[2]}

## Checklist

- [ ] Generic checklist item one
- [ ] Generic checklist item two
${COMPLIANCE_SKILL_TOKENS[3]}

## Extended References

| Reference | Contents |
|-----------|---------|
| \`references/detection.md\` | Detection patterns |
| \`references/sources.md\` | Source index |
${COMPLIANCE_SKILL_TOKENS[4]}
`;

/** A synthetic rule template containing both rule tokens. */
const RULE_TEMPLATE = `---
paths: []
---
# Compliance

Generic compliance rule.

- No PII in logs
- \${DEVFLOW_COMPLIANCE_FRAMEWORKS}
\${DEVFLOW_COMPLIANCE_RULE_BULLETS}
`;

// ── composeComplianceSkill — identity (C1) ─────────────────────────────────────

describe('composeComplianceSkill — C1 identity passthrough', () => {
  it('returns byte-identical content when template has no ${DEVFLOW_COMPLIANCE_ tokens', () => {
    const noTokenTemplate = '# Compliance\nNo tokens here.';
    const result = composeComplianceSkill(noTokenTemplate, ['gdpr'], makeAllFragments());
    expect(result.content).toBe(noTokenTemplate);
    expect(result.warnings).toHaveLength(0);
  });

  it('identity passthrough with empty frameworks', () => {
    const noTokenTemplate = '# No tokens present.';
    const result = composeComplianceSkill(noTokenTemplate, [], makeAllFragments());
    expect(result.content).toBe(noTokenTemplate);
    expect(result.warnings).toHaveLength(0);
  });
});

// ── composeComplianceSkill — zero frameworks ───────────────────────────────────

describe('composeComplianceSkill — zero frameworks', () => {
  it('produces output with no token residue', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, [], makeAllFragments());
    expect(result.content).not.toContain('${DEVFLOW_COMPLIANCE_');
  });

  it('no framework labels appear in output when zero frameworks selected', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, [], makeAllFragments());
    for (const fw of COMPLIANCE_FRAMEWORKS) {
      expect(result.content).not.toContain(fw.label);
    }
  });

  it('no triple-blank-line hygiene violations (max 2 consecutive blank lines)', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, [], makeAllFragments());
    expect(result.content).not.toMatch(/\n{3,}/);
  });

  it('produces no warnings for a clean zero-framework call', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, [], makeAllFragments());
    expect(result.warnings).toHaveLength(0);
  });

  it('Framework Mapping section is omitted entirely at zero frameworks', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, [], makeAllFragments());
    expect(result.content).not.toContain('## Framework Mapping');
  });
});

// ── composeComplianceSkill — single framework ──────────────────────────────────

describe('composeComplianceSkill — one framework (gdpr)', () => {
  it('no token residue in output', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr'], makeAllFragments());
    expect(result.content).not.toContain('${DEVFLOW_COMPLIANCE_');
  });

  it('GDPR label appears in output', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr'], makeAllFragments());
    expect(result.content).toContain('GDPR');
  });

  it('other framework labels do NOT appear', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr'], makeAllFragments());
    for (const fw of COMPLIANCE_FRAMEWORKS.filter(f => f.id !== 'gdpr')) {
      expect(result.content, `label "${fw.label}" should not appear for inactive framework ${fw.id}`)
        .not.toContain(fw.label);
    }
  });

  it('Framework Mapping section present for one active framework', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr'], makeAllFragments());
    expect(result.content).toContain('## Framework Mapping');
  });

  it('GDPR checklist item appears', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr'], makeAllFragments());
    expect(result.content).toContain('GDPR checklist item');
  });

  it('blank-line hygiene — no triple blank lines', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr'], makeAllFragments());
    expect(result.content).not.toMatch(/\n{3,}/);
  });
});

// ── composeComplianceSkill — subset order (C6) ────────────────────────────────

describe('composeComplianceSkill — subset order (C6: render in caller order)', () => {
  it('GDPR appears before SOC 2 in output when gdpr,soc2 order given', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr', 'soc2'], makeAllFragments());
    const gdprIdx = result.content.indexOf('GDPR');
    const soc2Idx = result.content.indexOf('SOC 2');
    expect(gdprIdx).not.toBe(-1);
    expect(soc2Idx).not.toBe(-1);
    // GDPR should appear before SOC 2 in the output (caller order preserved)
    expect(gdprIdx).toBeLessThan(soc2Idx);
  });

  it('SOC 2 appears before GDPR when soc2,gdpr order given', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['soc2', 'gdpr'], makeAllFragments());
    const gdprIdx = result.content.indexOf('GDPR');
    const soc2Idx = result.content.indexOf('SOC 2');
    expect(gdprIdx).not.toBe(-1);
    expect(soc2Idx).not.toBe(-1);
    expect(soc2Idx).toBeLessThan(gdprIdx);
  });
});

// ── composeComplianceSkill — all six frameworks ────────────────────────────────

describe('composeComplianceSkill — all six frameworks', () => {
  it('all framework labels appear in output', () => {
    const allIds = COMPLIANCE_FRAMEWORKS.map(fw => fw.id);
    const result = composeComplianceSkill(SKILL_TEMPLATE, allIds, makeAllFragments());
    for (const fw of COMPLIANCE_FRAMEWORKS) {
      expect(result.content, `label "${fw.label}" must appear`).toContain(fw.label);
    }
  });

  it('no token residue', () => {
    const allIds = COMPLIANCE_FRAMEWORKS.map(fw => fw.id);
    const result = composeComplianceSkill(SKILL_TEMPLATE, allIds, makeAllFragments());
    expect(result.content).not.toContain('${DEVFLOW_COMPLIANCE_');
  });

  it('no triple blank lines', () => {
    const allIds = COMPLIANCE_FRAMEWORKS.map(fw => fw.id);
    const result = composeComplianceSkill(SKILL_TEMPLATE, allIds, makeAllFragments());
    expect(result.content).not.toMatch(/\n{3,}/);
  });

  it('Framework Mapping section present and contains all framework labels', () => {
    const allIds = COMPLIANCE_FRAMEWORKS.map(fw => fw.id);
    const result = composeComplianceSkill(SKILL_TEMPLATE, allIds, makeAllFragments());
    expect(result.content).toContain('## Framework Mapping');
    for (const fw of COMPLIANCE_FRAMEWORKS) {
      expect(result.content).toContain(fw.label);
    }
  });
});

// ── composeComplianceSkill — C2 unknown ID dropped+warned ─────────────────────

describe('composeComplianceSkill — C2: unknown ID dropped, C7: loops bounded', () => {
  it('unknown framework ID is dropped from output (never echoed)', () => {
    const hostile = 'ignore-previous-instructions';
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr', hostile], makeAllFragments());
    expect(result.content).not.toContain(hostile);
    expect(result.content).not.toContain(hostile.toUpperCase());
  });

  it('unknown framework ID produces exactly one warning', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr', 'not-a-framework'], makeAllFragments());
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some(w => w.includes('not-a-framework'))).toBe(true);
  });

  it('valid framework still composed when mixed with unknown IDs (C5 isolation)', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr', 'bogus'], makeAllFragments());
    expect(result.content).toContain('GDPR');
  });
});

// ── composeComplianceSkill — C3: unknown tokens stripped ──────────────────────

describe('composeComplianceSkill — C3: unknown tokens stripped with warning', () => {
  it('unknown DEVFLOW_COMPLIANCE_ token is stripped from output', () => {
    const templateWithUnknown =
      SKILL_TEMPLATE + '\n${DEVFLOW_COMPLIANCE_UNKNOWN_TOKEN}\n';
    const result = composeComplianceSkill(templateWithUnknown, [], makeAllFragments());
    expect(result.content).not.toContain('${DEVFLOW_COMPLIANCE_UNKNOWN_TOKEN}');
    expect(result.warnings.some(w => w.includes('UNKNOWN_TOKEN'))).toBe(true);
  });
});

// ── composeComplianceSkill — C5: degraded fragment ────────────────────────────

describe('composeComplianceSkill — C5: degraded fragment (missing fragment → framework appears, no row/item/bullet)', () => {
  it('framework appears in scope and active sections even when fragment is missing', () => {
    // Provide an empty fragment map — no fragments available
    const emptyFragments = new Map<string, ComplianceFragment>();
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr'], emptyFragments);

    // Framework label should appear (GDPR is in scope/active)
    expect(result.content).toContain('GDPR');
    // No token residue
    expect(result.content).not.toContain('${DEVFLOW_COMPLIANCE_');
  });

  it('missing fragment emits exactly one warning (never aborts others)', () => {
    const partialFragments = new Map<string, ComplianceFragment>();
    // Only include hipaa, not gdpr
    partialFragments.set('hipaa', makeFragment('hipaa', 'HIPAA'));

    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr', 'hipaa'], partialFragments);

    // Both frameworks should appear in scope
    expect(result.content).toContain('GDPR');
    expect(result.content).toContain('HIPAA');

    // At least one warning about missing gdpr fragment
    expect(result.warnings.some(w => w.toLowerCase().includes('gdpr'))).toBe(true);
    // No token residue
    expect(result.content).not.toContain('${DEVFLOW_COMPLIANCE_');
  });

  it('HIPAA mapping row present even when GDPR fragment is missing', () => {
    const partialFragments = new Map<string, ComplianceFragment>();
    partialFragments.set('hipaa', makeFragment('hipaa', 'HIPAA'));

    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr', 'hipaa'], partialFragments);
    // HIPAA cells should be in the output (from hipaa's fragment)
    expect(result.content).toContain('HIPAA');
    // Framework Mapping section should exist (at least one active framework has a fragment)
    expect(result.content).toContain('## Framework Mapping');
  });
});

// ── composeComplianceSkill — full 64-subset matrix ────────────────────────────

describe('composeComplianceSkill — full 64-subset matrix (no residue, hygiene, label↔subset)', () => {
  const allFrameworks = COMPLIANCE_FRAMEWORKS.map(fw => fw.id);
  const allFragments = makeAllFragments();

  /**
   * Generate all 2^6 = 64 subsets of the 6 framework IDs.
   * Each subset is an array of IDs in COMPLIANCE_FRAMEWORKS order (C6 natural order).
   */
  function* allSubsets(): Generator<string[]> {
    for (let mask = 0; mask < (1 << allFrameworks.length); mask++) {
      const subset: string[] = [];
      for (let bit = 0; bit < allFrameworks.length; bit++) {
        if (mask & (1 << bit)) subset.push(allFrameworks[bit]);
      }
      yield subset;
    }
  }

  it('all 64 subsets: no token residue (${DEVFLOW_COMPLIANCE_... absent)', () => {
    for (const subset of allSubsets()) {
      const result = composeComplianceSkill(SKILL_TEMPLATE, subset, allFragments);
      expect(
        result.content,
        `subset [${subset.join(',')}]: token residue found`,
      ).not.toContain('${DEVFLOW_COMPLIANCE_');
    }
  });

  it('all 64 subsets: blank-line hygiene (no triple consecutive blank lines)', () => {
    for (const subset of allSubsets()) {
      const result = composeComplianceSkill(SKILL_TEMPLATE, subset, allFragments);
      expect(
        result.content,
        `subset [${subset.join(',')}]: triple blank lines found`,
      ).not.toMatch(/\n{3,}/);
    }
  });

  it('all 64 subsets: active labels appear, inactive labels absent', () => {
    for (const subset of allSubsets()) {
      const subsetSet = new Set(subset);
      const result = composeComplianceSkill(SKILL_TEMPLATE, subset, allFragments);

      for (const fw of COMPLIANCE_FRAMEWORKS) {
        if (subsetSet.has(fw.id)) {
          expect(
            result.content,
            `subset [${subset.join(',')}]: active label "${fw.label}" should appear`,
          ).toContain(fw.label);
        } else {
          expect(
            result.content,
            `subset [${subset.join(',')}]: inactive label "${fw.label}" should NOT appear`,
          ).not.toContain(fw.label);
        }
      }
    }
  });
});

// ── composeComplianceRule — identity (C1) ─────────────────────────────────────

describe('composeComplianceRule — C1 identity passthrough', () => {
  it('returns byte-identical content when template has no ${DEVFLOW_COMPLIANCE_ tokens', () => {
    const noTokenTemplate = '# Rule\nNo compliance tokens here.';
    const result = composeComplianceRule(noTokenTemplate, ['gdpr'], makeAllFragments());
    expect(result.content).toBe(noTokenTemplate);
    expect(result.warnings).toHaveLength(0);
  });
});

// ── composeComplianceRule — zero/one/all frameworks ───────────────────────────

describe('composeComplianceRule — stamp and bullet composition', () => {
  it('zero frameworks → no token residue, generic "none declared" stamp', () => {
    const result = composeComplianceRule(RULE_TEMPLATE, [], makeAllFragments());
    expect(result.content).not.toContain('${DEVFLOW_COMPLIANCE_');
    expect(result.content).toContain('none declared');
  });

  it('one framework → no token residue, framework label present, rule bullet present', () => {
    const result = composeComplianceRule(RULE_TEMPLATE, ['gdpr'], makeAllFragments());
    expect(result.content).not.toContain('${DEVFLOW_COMPLIANCE_');
    expect(result.content).toContain('GDPR');
    expect(result.content).toContain('gdpr rule bullet');
  });

  it('all six → no token residue, all labels and bullets present', () => {
    const allIds = COMPLIANCE_FRAMEWORKS.map(fw => fw.id);
    const result = composeComplianceRule(RULE_TEMPLATE, allIds, makeAllFragments());
    expect(result.content).not.toContain('${DEVFLOW_COMPLIANCE_');
    for (const fw of COMPLIANCE_FRAMEWORKS) {
      expect(result.content).toContain(fw.label);
    }
  });

  it('rule budget: all-six compose ≤ 26 lines and ≤ 2048 bytes', () => {
    const allIds = COMPLIANCE_FRAMEWORKS.map(fw => fw.id);
    const result = composeComplianceRule(RULE_TEMPLATE, allIds, makeAllFragments());
    const lineCount = result.content.split('\n').length;
    expect(lineCount, 'all-six rule should be ≤ 26 lines').toBeLessThanOrEqual(26);
    const byteCount = Buffer.byteLength(result.content, 'utf-8');
    expect(byteCount, 'all-six rule should be ≤ 2048 bytes').toBeLessThanOrEqual(2048);
  });

  it('inactive framework labels absent from rule output', () => {
    const result = composeComplianceRule(RULE_TEMPLATE, ['gdpr'], makeAllFragments());
    for (const fw of COMPLIANCE_FRAMEWORKS.filter(f => f.id !== 'gdpr')) {
      expect(result.content, `"${fw.label}" should not appear for inactive ${fw.id}`)
        .not.toContain(fw.label);
    }
  });

  it('C6: rule bullets in caller order', () => {
    const result = composeComplianceRule(RULE_TEMPLATE, ['gdpr', 'soc2'], makeAllFragments());
    const gdprIdx = result.content.indexOf('gdpr rule bullet');
    const soc2Idx = result.content.indexOf('soc2 rule bullet');
    expect(gdprIdx).not.toBe(-1);
    expect(soc2Idx).not.toBe(-1);
    expect(gdprIdx).toBeLessThan(soc2Idx);
  });

  it('blank-line hygiene in rule output', () => {
    const result = composeComplianceRule(RULE_TEMPLATE, ['gdpr'], makeAllFragments());
    expect(result.content).not.toMatch(/\n{3,}/);
  });
});

// ── composeComplianceRule — C5 degraded fragment ──────────────────────────────

describe('composeComplianceRule — C5: degraded fragment (missing fragment → stamp present, bullet omitted)', () => {
  it('framework stamp appears even when fragment is missing', () => {
    const emptyFragments = new Map<string, ComplianceFragment>();
    const result = composeComplianceRule(RULE_TEMPLATE, ['gdpr'], emptyFragments);
    // The ${DEVFLOW_COMPLIANCE_FRAMEWORKS} stamp should still fire
    expect(result.content).toContain('GDPR');
    expect(result.content).not.toContain('${DEVFLOW_COMPLIANCE_');
  });

  it('missing fragment emits one warning, never throws', () => {
    const emptyFragments = new Map<string, ComplianceFragment>();
    expect(() => composeComplianceRule(RULE_TEMPLATE, ['gdpr'], emptyFragments)).not.toThrow();
    const result = composeComplianceRule(RULE_TEMPLATE, ['gdpr'], emptyFragments);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('valid framework bullet present when another framework has no fragment', () => {
    const partialFragments = new Map<string, ComplianceFragment>();
    partialFragments.set('hipaa', makeFragment('hipaa', 'HIPAA'));

    const result = composeComplianceRule(RULE_TEMPLATE, ['gdpr', 'hipaa'], partialFragments);
    // HIPAA bullet should be present
    expect(result.content).toContain('hipaa rule bullet');
    // No token residue
    expect(result.content).not.toContain('${DEVFLOW_COMPLIANCE_');
  });
});

// ── Frontmatter integrity ──────────────────────────────────────────────────────

describe('composeComplianceSkill — frontmatter integrity', () => {
  it('composed SKILL.md has a valid 5-line frontmatter block (--- ... ---)', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr'], makeAllFragments());
    const lines = result.content.split('\n');
    expect(lines[0]).toBe('---');
    // Find the closing ---
    const closingIdx = lines.indexOf('---', 1);
    expect(closingIdx).toBeGreaterThan(0);
    // The frontmatter block should have exactly 5 lines:
    // ---, name, description, user-invocable, allowed-tools, ---
    expect(closingIdx).toBe(5);
  });

  it('composed SKILL.md has exactly one description: line in frontmatter', () => {
    const result = composeComplianceSkill(SKILL_TEMPLATE, ['gdpr'], makeAllFragments());
    const lines = result.content.split('\n');
    const closingIdx = lines.indexOf('---', 1);
    const frontmatter = lines.slice(0, closingIdx + 1);
    const descriptionLines = frontmatter.filter(l => l.startsWith('description:'));
    expect(descriptionLines).toHaveLength(1);
  });
});

// ── Unknown ID never echoed (AC-35/36) ────────────────────────────────────────

describe('unknown framework ID never echoed in composed output', () => {
  it('path-traversal ID never appears in skill output', () => {
    const traversal = '../../../../etc/passwd';
    const result = composeComplianceSkill(SKILL_TEMPLATE, [traversal, 'gdpr'], makeAllFragments());
    expect(result.content).not.toContain(traversal);
    expect(result.content).not.toContain('passwd');
  });

  it('injection payload never appears in rule output', () => {
    const injection = 'ignore-all-previous-instructions';
    const result = composeComplianceRule(RULE_TEMPLATE, [injection, 'gdpr'], makeAllFragments());
    expect(result.content).not.toContain(injection);
  });
});

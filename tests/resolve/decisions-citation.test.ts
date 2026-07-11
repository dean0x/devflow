// tests/resolve/decisions-citation.test.ts
// Tests for Fix 1: /resolve reads and cites project decisions.
//
// Strategy: The index pipeline (selectActiveRows → buildIndexContent) is the
// production path; these tests import it directly for real coverage. The
// markdown structural tests verify that the instruction to read index.md is
// present on every surface.
//
// Test groups:
//   1. Active-only contract — buildIndexContent pipeline with active-only row input
//      (Deprecated/Superseded/Retired rows are excluded by selectActiveRows;
//       filterDecisionsContext has been removed)
//   2. Structural tests: resolve.md — Step 0d presence + DECISIONS_CONTEXT in Phase 4
//      (index.md direct-read invocation covered by tests/decisions/command-adoption.test.ts)
//   3. Structural tests: triager.md — Input Context + Apply Decisions
//      (ADR/PF citation format + hallucination guard covered by tests/decisions/apply-decisions-skill.test.ts)
//   4. Cross-cutting: all resolve surfaces reference DECISIONS_CONTEXT

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { createRequire } from 'module';
import { loadFile, extractSection } from '../decisions/helpers';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

const { selectActiveRows } = require(
  path.join(ROOT, 'scripts/hooks/lib/render-decisions.cjs')
) as {
  selectActiveRows: (rows: Record<string, unknown>[], kind: 'decisions' | 'pitfalls') => Record<string, unknown>[];
};

const { buildIndexContent } = require(
  path.join(ROOT, 'scripts/hooks/lib/decisions-format.cjs')
) as {
  buildIndexContent: (
    activeDecisionRows: Record<string, unknown>[],
    activePitfallRows: Record<string, unknown>[],
    opts: { decisionsFilePath: string; pitfallsFilePath: string }
  ) => string;
};

const OPTS = {
  decisionsFilePath: '/project/.devflow/decisions/decisions.md',
  pitfallsFilePath: '/project/.devflow/decisions/pitfalls.md',
};

const NOW = '2026-01-01T00:00:00Z';

function makeAdrRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_adr001',
    type: 'decision',
    anchor_id: 'ADR-001',
    pattern: 'Use Result types everywhere',
    date: '2026-01-01',
    decisions_status: 'Accepted',
    confidence: 0.9,
    observations: 1,
    first_seen: NOW,
    last_seen: NOW,
    status: 'created',
    evidence: [],
    details: 'context: TypeScript project; decision: return Result<T,E>; rationale: functional error handling',
    quality_ok: true,
    ...overrides,
  };
}

function makePfRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_pf004',
    type: 'pitfall',
    anchor_id: 'PF-004',
    pattern: 'Background hook scripts grow into god scripts over time',
    decisions_status: undefined,
    confidence: 0.95,
    observations: 2,
    first_seen: NOW,
    last_seen: NOW,
    status: 'created',
    evidence: [],
    details: 'area: scripts/hooks/foo.cjs, scripts/hooks/background-learning; issue: god scripts; impact: hard to test; resolution: split concerns',
    quality_ok: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Active-only contract: buildIndexContent pipeline with active-only row input
//
// The renderer guarantees .md files only contain active entries.
// selectActiveRows performs the active-only filter before buildIndexContent.
// filterDecisionsContext has been removed — these tests validate the
// active-only parse path that the index will always receive in practice.
// ---------------------------------------------------------------------------

describe('decisions pipeline active-only contract (post-render row input)', () => {
  it('includes Active ADR in index output', () => {
    const rows = [makeAdrRow()];
    const adrRows = selectActiveRows(rows, 'decisions');
    const pfRows = selectActiveRows(rows, 'pitfalls');
    const result = buildIndexContent(adrRows, pfRows, OPTS);
    expect(result).toContain('ADR-001');
    expect(result).toContain('Use Result types everywhere');
  });

  it('includes Active PF in index output', () => {
    const rows = [makePfRow()];
    const adrRows = selectActiveRows(rows, 'decisions');
    const pfRows = selectActiveRows(rows, 'pitfalls');
    const result = buildIndexContent(adrRows, pfRows, OPTS);
    expect(result).toContain('PF-004');
    expect(result).toContain('Background hook scripts');
  });

  it('returns "(none)" when corpus is empty', () => {
    const adrRows = selectActiveRows([], 'decisions');
    const pfRows = selectActiveRows([], 'pitfalls');
    expect(buildIndexContent(adrRows, pfRows, OPTS)).toBe('(none)');
  });

  it('tags Accepted decisions with [Accepted] (renderer default for decisions)', () => {
    const rows = [makeAdrRow({ anchor_id: 'ADR-010', pattern: 'Use ledger for decisions', decisions_status: 'Accepted' })];
    const adrRows = selectActiveRows(rows, 'decisions');
    const pfRows = selectActiveRows(rows, 'pitfalls');
    const result = buildIndexContent(adrRows, pfRows, OPTS);
    expect(result).toContain('[Accepted]');
    expect(result).toContain('ADR-010');
  });

  it('tags Active pitfalls with [Active] (renderer default for pitfalls)', () => {
    const rows = [makePfRow({ anchor_id: 'PF-010', pattern: 'Watch for lock contention' })];
    const adrRows = selectActiveRows(rows, 'decisions');
    const pfRows = selectActiveRows(rows, 'pitfalls');
    const result = buildIndexContent(adrRows, pfRows, OPTS);
    expect(result).toContain('[Active]');
    expect(result).toContain('PF-010');
  });

  it('shows both Decisions and Pitfalls blocks with correct counts', () => {
    const rows = [makeAdrRow(), makePfRow()];
    const adrRows = selectActiveRows(rows, 'decisions');
    const pfRows = selectActiveRows(rows, 'pitfalls');
    const result = buildIndexContent(adrRows, pfRows, OPTS);
    expect(result).toContain('Decisions (1):');
    expect(result).toContain('Pitfalls (1):');
  });

  it('filterDecisionsContext is NOT a function on decisions-format (removed in Phase 8 cleanup)', () => {
    const mod = require(path.join(ROOT, 'scripts/hooks/lib/decisions-format.cjs')) as Record<string, unknown>;
    expect(mod.filterDecisionsContext).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Structural tests: resolve.md (base command)
// ---------------------------------------------------------------------------

describe('resolve.md — base command', () => {
  const content = loadFile('plugins/devflow-resolve/commands/resolve.md');

  it('contains Step 0d: Load Project Decisions after Phase 0c', () => {
    expect(content).toMatch(/Step 0d.*Load Project Decisions/i);
  });

  it('Step 0d instructs passing DECISIONS_CONTEXT to Triager and Coders', () => {
    const step0dSection = extractSection(content, 'Step 0d', '\n### Phase 1');
    expect(step0dSection).toContain('DECISIONS_CONTEXT');
  });

  it('Step 0d emits (none) when both files are absent or empty', () => {
    const step0dSection = extractSection(content, 'Step 0d', '\n### Phase 1');
    expect(step0dSection).toContain('(none)');
  });

  it('Phase 4 Coder spawn block includes DECISIONS_CONTEXT variable', () => {
    const phase4Section = extractSection(content, '### Phase 4', '### Phase 5');
    expect(phase4Section).toContain('DECISIONS_CONTEXT');
  });

  it('Phase 5 or Phase 8 mentions Decisions Citations in resolution-summary.md (D-B)', () => {
    expect(content).toContain('Decisions Citations');
  });

  it('Step 0d is nested inside the per-worktree Phase 0 section (multi-worktree constraint)', () => {
    const phase0Start = content.indexOf('### Phase 0');
    const phase1Start = content.indexOf('### Phase 1');
    const step0dIdx = content.indexOf('Step 0d');
    expect(step0dIdx).toBeGreaterThan(phase0Start);
    expect(step0dIdx).toBeLessThan(phase1Start);
  });

  it('compiled resolve.md output artifact includes ## Verification section', () => {
    expect(content).toContain('## Verification');
  });

  it('compiled resolve.md output artifact includes ## By Design section', () => {
    expect(content).toContain('## By Design');
  });

  it('compiled resolve.md output artifact includes ## Fix Separately section', () => {
    expect(content).toContain('## Fix Separately');
  });

  it('compiled resolve.md output artifact includes ## Escalations section', () => {
    expect(content).toContain('## Escalations');
  });
});

// ---------------------------------------------------------------------------
// Structural tests: shared/agents/triager.md
// ---------------------------------------------------------------------------

describe('triager.md — Input Context and Apply Decisions section', () => {
  const content = loadFile('shared/agents/triager.md');

  it('declares DECISIONS_CONTEXT in Input Context section', () => {
    const inputContextSection = extractSection(content, '## Input Context', '\n## ');
    expect(inputContextSection).toContain('DECISIONS_CONTEXT');
  });

  it('contains Apply Decisions section in Responsibilities', () => {
    expect(content).toMatch(/Apply Decisions/);
  });

  it('Apply Decisions usage describes citing inline in Reasoning column', () => {
    // Extract only the Apply Decisions bullet from Responsibilities — triager.md has
    // "Reasoning" columns in three unrelated output tables, so asserting against the
    // whole file is self-ratifying. This scopes the assertion to the actual coupling.
    const applyDecisionsStep = extractSection(content, '**Apply Decisions**', '\n3. **Assign disposition**');
    expect(applyDecisionsStep).toContain('Reasoning column');
  });

  it('DECISIONS_CONTEXT is marked optional in Input Context', () => {
    const inputContextSection = extractSection(content, '## Input Context', '\n## ');
    const decisionsIdx = inputContextSection.indexOf('DECISIONS_CONTEXT');
    if (decisionsIdx === -1) throw new Error('DECISIONS_CONTEXT not found in Input Context section');
    const surroundingText = inputContextSection.slice(
      Math.max(0, decisionsIdx - 20),
      Math.min(inputContextSection.length, decisionsIdx + 120)
    );
    expect(surroundingText).toMatch(/optional|if provided|when provided|non-empty/i);
  });

  it('security gate rule is present and overrides other dispositions', () => {
    // Scope to the matrix section so wording drift elsewhere cannot satisfy this test.
    // Pins clause-0 identity, the "overrides all" declaration (first-match ordering), and
    // the specific outcome constraint — matching loose word co-occurrence is not enough.
    const matrixSection = extractSection(content, '## Blast-Radius Disposition Matrix', '## Risk Tier Definitions');
    expect(matrixSection).toMatch(/\*\*0\. SECURITY GATE \(overrides all\)/);
    expect(matrixSection).toContain('FIX_NOW or ESCALATED only');
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: all resolve surfaces reference DECISIONS_CONTEXT
// ---------------------------------------------------------------------------

describe('cross-cutting — DECISIONS_CONTEXT on resolve surfaces', () => {
  it('resolve.md contains DECISIONS_CONTEXT', () => {
    const content = loadFile('plugins/devflow-resolve/commands/resolve.md');
    expect(content).toContain('DECISIONS_CONTEXT');
  });

  it('triager.md contains DECISIONS_CONTEXT', () => {
    const content = loadFile('shared/agents/triager.md');
    expect(content).toContain('DECISIONS_CONTEXT');
  });

  it('resolve.md Phase 2 passes DECISIONS_CONTEXT to Triager', () => {
    const content = loadFile('plugins/devflow-resolve/commands/resolve.md');
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:');
    expect(phase2).toContain('DECISIONS_CONTEXT');
  });
});

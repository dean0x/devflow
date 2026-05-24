// tests/resolve/bug-analysis-fallback.test.ts
// Structural tests for the /resolve bug-analysis fallback added in feat/bug-analysis.
//
// Behavioral change: resolve.md now falls back to bug-analysis reports when no
// qualifying code review report exists. These tests verify:
//   1. Reviews take priority over bug-analysis reports (priority invariant)
//   2. Bug-analysis fallback path is documented in Step 0c (step 5b)
//   3. Exclusion list in Phase 1 includes bug-analysis-summary.md and static-findings.md
//   4. Error message mentions both /code-review and /bug-analysis
//   5. 10-directory scan limit is documented for the fallback

import { describe, it, expect } from 'vitest';
import { loadFile, extractSection } from '../helpers';

const resolveContent = loadFile('plugins/devflow-resolve/commands/resolve.md');

// ---------------------------------------------------------------------------
// Group 1: resolve.md — bug-analysis fallback (Step 0c-5b)
// ---------------------------------------------------------------------------

describe('resolve.md — bug-analysis fallback (Step 0c-5b)', () => {
  const step0c = extractSection(resolveContent, 'Step 0c:', 'Step 0d:');

  it('documents bug-analysis fallback as step 5b inside Step 0c', () => {
    expect(step0c).toMatch(/5b|bug.analysis fallback/i);
  });

  it('reviews take priority — bug-analysis only used when no qualifying review exists', () => {
    expect(step0c).toMatch(/[Rr]eviews take priority|[Rr]eview.*priority.*bug.analysis|priority/i);
  });

  it('fallback scans bug-analysis directory under {worktree}/.devflow/docs/bug-analysis/', () => {
    expect(resolveContent).toContain('.devflow/docs/bug-analysis/');
  });

  it('fallback selects directory containing at least one focus report', () => {
    expect(step0c).toMatch(/security\.md|functional\.md|integration\.md|usability\.md/);
  });

  it('fallback excludes directories that already have resolution-summary.md', () => {
    // The fallback must skip already-resolved bug-analysis dirs — narrow to the fallback sub-section
    const fallbackSection = extractSection(step0c, '5b.', null);
    expect(fallbackSection).toContain('resolution-summary.md');
  });

  it('fallback scans at most 10 most recent directories (scan limit)', () => {
    expect(step0c).toMatch(/10\s+(most recent|directories)|scan.*10|10.*scan/i);
  });

  it('fallback not-found error mentions both /code-review and /bug-analysis', () => {
    expect(step0c).toContain('/code-review');
    expect(step0c).toContain('/bug-analysis');
  });
});

// ---------------------------------------------------------------------------
// Group 2: resolve.md — Phase 1 exclusion list
// ---------------------------------------------------------------------------

describe('resolve.md — Phase 1 issue exclusion list', () => {
  const phase1 = extractSection(resolveContent, '### Phase 1:', '### Phase 2:');

  it('Phase 1 excludes bug-analysis-summary.md from issue extraction', () => {
    expect(phase1).toContain('bug-analysis-summary.md');
  });

  it('Phase 1 excludes static-findings.md from issue extraction', () => {
    expect(phase1).toContain('static-findings.md');
  });

  it('Phase 1 excludes review-summary.md from issue extraction', () => {
    expect(phase1).toContain('review-summary.md');
  });

  it('Phase 1 excludes resolution-summary.md from issue extraction', () => {
    expect(phase1).toContain('resolution-summary.md');
  });
});

// ---------------------------------------------------------------------------
// Group 3: resolve.md — blocked message and user guidance
// ---------------------------------------------------------------------------

describe('resolve.md — blocked message guidance', () => {
  it('pre-flight BLOCKED message suggests /code-review or /bug-analysis', () => {
    // The blocked message in Step 0b must mention both commands
    const step0b = extractSection(resolveContent, 'Step 0b:', 'Step 0c:');
    expect(step0b).toContain('/code-review');
    expect(step0b).toContain('/bug-analysis');
  });
});

// ---------------------------------------------------------------------------
// Group 4: resolve.md — Edge Cases table coverage
// ---------------------------------------------------------------------------

describe('resolve.md — Edge Cases table covers bug-analysis scenarios', () => {
  it('Edge Cases table covers "No reviews exist" with bug-analysis fallback note', () => {
    // resolve.md has a dedicated ## Edge Cases section — assert it unconditionally
    const edgeCases = extractSection(resolveContent, '## Edge Cases', '## Principles');
    expect(edgeCases).toMatch(/[Nn]o reviews exist|no.*review.*found/i);
    expect(edgeCases).toMatch(/bug.analysis/i);
  });
});

// ---------------------------------------------------------------------------
// Group 5: resolve:orch SKILL.md — bug-analysis fallback (Phase 1)
// ---------------------------------------------------------------------------

describe('resolve:orch SKILL.md — bug-analysis fallback (Phase 1)', () => {
  const content = loadFile('shared/skills/resolve:orch/SKILL.md');
  const phase1 = extractSection(content, '## Phase 1:', '## Phase 2:');
  const phase3 = extractSection(content, '## Phase 3:', '## Phase 4:');

  it('Phase 1 contains bug-analysis fallback path', () => {
    expect(phase1).toMatch(/bug.analysis/i);
  });

  it('Phase 1 reviews path scans at most 10 most recent directories', () => {
    expect(phase1).toMatch(/10\s+(most recent|directories)|scan.*10|10.*scan/i);
  });

  it('Phase 1 bug-analysis fallback also scans at most 10 most recent directories', () => {
    // Narrow to the fallback sub-section to verify the scan limit is documented there specifically
    const bugAnalysisPart = extractSection(phase1, 'If no unresolved review found:', null);
    expect(bugAnalysisPart).toMatch(/10\s+(most recent|directories)|scan.*10|10.*scan/i);
  });

  it('Phase 3 excludes bug-analysis-summary.md from issue extraction', () => {
    expect(phase3).toContain('bug-analysis-summary.md');
  });

  it('Phase 3 excludes static-findings.md from issue extraction', () => {
    expect(phase3).toContain('static-findings.md');
  });

  it('error handling mentions both /code-review and /bug-analysis', () => {
    const errorHandling = extractSection(content, '## Error Handling', '## Phase Completion Checklist');
    expect(errorHandling).toContain('/code-review');
    expect(errorHandling).toContain('/bug-analysis');
  });

  it('Phase 1 halt message mentions both /code-review and /bug-analysis', () => {
    expect(phase1).toContain('/code-review');
    expect(phase1).toContain('/bug-analysis');
  });
});

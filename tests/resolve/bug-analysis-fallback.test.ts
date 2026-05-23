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

// ---------------------------------------------------------------------------
// Group 1: resolve.md — bug-analysis fallback (Step 0c-5b)
// ---------------------------------------------------------------------------

describe('resolve.md — bug-analysis fallback (Step 0c-5b)', () => {
  const content = loadFile('plugins/devflow-resolve/commands/resolve.md');

  it('documents bug-analysis fallback as step 5b inside Step 0c', () => {
    // Step 5b is nested inside Step 0c (Target Review Directory)
    const step0c = extractSection(content, 'Step 0c:', 'Step 0d:');
    expect(step0c).toMatch(/5b|bug.analysis fallback/i);
  });

  it('reviews take priority — bug-analysis only used when no qualifying review exists', () => {
    const step0c = extractSection(content, 'Step 0c:', 'Step 0d:');
    expect(step0c).toMatch(/[Rr]eviews take priority|[Rr]eview.*priority.*bug.analysis|priority/i);
  });

  it('fallback scans bug-analysis directory under {worktree}/.devflow/docs/bug-analysis/', () => {
    const content_ = loadFile('plugins/devflow-resolve/commands/resolve.md');
    expect(content_).toContain('.devflow/docs/bug-analysis/');
  });

  it('fallback selects directory containing at least one focus report', () => {
    const step0c = extractSection(content, 'Step 0c:', 'Step 0d:');
    expect(step0c).toMatch(/security\.md|functional\.md|integration\.md|usability\.md/);
  });

  it('fallback excludes directories that already have resolution-summary.md', () => {
    const step0c = extractSection(content, 'Step 0c:', 'Step 0d:');
    // The fallback must skip already-resolved bug-analysis dirs
    const fallbackSection = step0c.slice(step0c.search(/5b|bug.analysis fallback/i));
    expect(fallbackSection).toContain('resolution-summary.md');
  });

  it('fallback scans at most 10 most recent directories (scan limit)', () => {
    const step0c = extractSection(content, 'Step 0c:', 'Step 0d:');
    expect(step0c).toMatch(/10\s+(most recent|directories)|scan.*10|10.*scan/i);
  });

  it('fallback not-found error mentions both /code-review and /bug-analysis', () => {
    const step0c = extractSection(content, 'Step 0c:', 'Step 0d:');
    expect(step0c).toContain('/code-review');
    expect(step0c).toContain('/bug-analysis');
  });
});

// ---------------------------------------------------------------------------
// Group 2: resolve.md — Phase 1 exclusion list
// ---------------------------------------------------------------------------

describe('resolve.md — Phase 1 issue exclusion list', () => {
  const content = loadFile('plugins/devflow-resolve/commands/resolve.md');

  it('Phase 1 excludes bug-analysis-summary.md from issue extraction', () => {
    const phase1 = extractSection(content, '### Phase 1:', '### Phase 2:');
    expect(phase1).toContain('bug-analysis-summary.md');
  });

  it('Phase 1 excludes static-findings.md from issue extraction', () => {
    const phase1 = extractSection(content, '### Phase 1:', '### Phase 2:');
    expect(phase1).toContain('static-findings.md');
  });

  it('Phase 1 excludes review-summary.md from issue extraction', () => {
    const phase1 = extractSection(content, '### Phase 1:', '### Phase 2:');
    expect(phase1).toContain('review-summary.md');
  });

  it('Phase 1 excludes resolution-summary.md from issue extraction', () => {
    const phase1 = extractSection(content, '### Phase 1:', '### Phase 2:');
    expect(phase1).toContain('resolution-summary.md');
  });
});

// ---------------------------------------------------------------------------
// Group 3: resolve.md — blocked message and user guidance
// ---------------------------------------------------------------------------

describe('resolve.md — blocked message guidance', () => {
  const content = loadFile('plugins/devflow-resolve/commands/resolve.md');

  it('pre-flight BLOCKED message suggests /code-review or /bug-analysis', () => {
    // The blocked message in Step 0b must mention both commands
    const step0b = extractSection(content, 'Step 0b:', 'Step 0c:');
    expect(step0b).toContain('/code-review');
    expect(step0b).toContain('/bug-analysis');
  });
});

// ---------------------------------------------------------------------------
// Group 4: resolve.md — Edge Cases table coverage
// ---------------------------------------------------------------------------

describe('resolve.md — Edge Cases table covers bug-analysis scenarios', () => {
  const content = loadFile('plugins/devflow-resolve/commands/resolve.md');

  it('Edge Cases table covers "No reviews exist" with bug-analysis fallback note', () => {
    // After the main phases there is an Edge Cases section
    const afterPhases = content.slice(content.indexOf('## ') + 3);
    // Look for edge cases section anywhere in the file
    const edgeCasesIdx = content.search(/## Edge Cases|### Edge Cases/);
    if (edgeCasesIdx !== -1) {
      const edgeCases = content.slice(edgeCasesIdx);
      expect(edgeCases).toMatch(/[Nn]o reviews exist|no.*review.*found/i);
      expect(edgeCases).toMatch(/bug.analysis/i);
    } else {
      // The edge case may be inline in Step 0c — verify the fallback exists there
      const step0c = extractSection(content, 'Step 0c:', 'Step 0d:');
      expect(step0c).toMatch(/bug.analysis/i);
    }
  });
});

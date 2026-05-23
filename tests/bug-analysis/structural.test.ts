// tests/bug-analysis/structural.test.ts
// Structural tests for plugins/devflow-bug-analysis/commands/bug-analysis.md.
//
// Strategy: parse the markdown command file to verify structural invariants:
//   1. Phase ordering — all 7 phases present in correct order with Produces/Requires annotations
//   2. Incremental detection — .last-analysis-head read/write semantics documented
//   3. Static tool invocation — xargs, timeout, mktemp patterns for safety
//   4. BugAnalyzer agent spawning — parallel spawn in a single message, required inputs
//   5. Synthesizer agent — mode: bug-analysis output path
//   6. Resolve compatibility — /resolve suggestion on blocking bugs
//   7. Exclusion list — static-findings.md and bug-analysis-summary.md excluded from issue extraction
//
// These tests pin the structural contract of the command so future edits
// cannot silently remove safety-critical patterns.

import { describe, it, expect } from 'vitest';
import { loadFile, extractSection } from '../helpers';

const content = loadFile('plugins/devflow-bug-analysis/commands/bug-analysis.md');

// ---------------------------------------------------------------------------
// Group 1: Phase ordering — Produces/Requires annotations
// ---------------------------------------------------------------------------

describe('bug-analysis.md — phase ordering and annotations', () => {
  it('has all 7 phases in order', () => {
    const phase1 = content.indexOf('### Phase 1:');
    const phase2 = content.indexOf('### Phase 2:');
    const phase3 = content.indexOf('### Phase 3:');
    const phase4 = content.indexOf('### Phase 4:');
    const phase5 = content.indexOf('### Phase 5:');
    const phase6 = content.indexOf('### Phase 6:');
    const phase7 = content.indexOf('### Phase 7:');
    expect(phase1).not.toBe(-1);
    expect(phase2).not.toBe(-1);
    expect(phase3).not.toBe(-1);
    expect(phase4).not.toBe(-1);
    expect(phase5).not.toBe(-1);
    expect(phase6).not.toBe(-1);
    expect(phase7).not.toBe(-1);
    expect(phase1).toBeLessThan(phase2);
    expect(phase2).toBeLessThan(phase3);
    expect(phase3).toBeLessThan(phase4);
    expect(phase4).toBeLessThan(phase5);
    expect(phase5).toBeLessThan(phase6);
    expect(phase6).toBeLessThan(phase7);
  });

  it('Phase 1 declares Produces: BRANCH_INFO', () => {
    const phase1 = extractSection(content, '### Phase 1:', '### Phase 2:');
    expect(phase1).toContain('**Produces:**');
    expect(phase1).toContain('BRANCH_INFO');
  });

  it('Phase 2 declares Requires: BRANCH_INFO and Produces: DIFF_RANGE, ANALYSIS_DIR', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:');
    expect(phase2).toContain('**Requires:**');
    expect(phase2).toContain('BRANCH_INFO');
    expect(phase2).toContain('**Produces:**');
    expect(phase2).toContain('DIFF_RANGE');
    expect(phase2).toContain('ANALYSIS_DIR');
  });

  it('Phase 5 declares Requires including all context variables', () => {
    const phase5 = extractSection(content, '### Phase 5:', '### Phase 6:');
    expect(phase5).toContain('**Requires:**');
    expect(phase5).toContain('DIFF_RANGE');
    expect(phase5).toContain('ANALYSIS_DIR');
    expect(phase5).toContain('STATIC_FINDINGS');
    expect(phase5).toContain('DECISIONS_CONTEXT');
    expect(phase5).toContain('FEATURE_KNOWLEDGE');
  });

  it('Phase 7 declares Requires: BRANCH_INFO, ANALYSIS_DIR', () => {
    const phase7 = extractSection(content, '### Phase 7:', '## Architecture');
    expect(phase7).toContain('**Requires:**');
    expect(phase7).toContain('BRANCH_INFO');
    expect(phase7).toContain('ANALYSIS_DIR');
  });
});

// ---------------------------------------------------------------------------
// Group 2: Incremental detection via .last-analysis-head
// ---------------------------------------------------------------------------

describe('bug-analysis.md — incremental detection', () => {
  it('references .last-analysis-head file for incremental state', () => {
    expect(content).toContain('.last-analysis-head');
  });

  it('Step 2a checks .last-analysis-head before setting DIFF_RANGE', () => {
    const step2a = extractSection(content, 'Step 2a:', 'Step 2b:');
    expect(step2a).toContain('.last-analysis-head');
    expect(step2a).toContain('DIFF_RANGE');
  });

  it('Step 2a documents --full flag bypass of incremental detection', () => {
    const step2a = extractSection(content, 'Step 2a:', 'Step 2b:');
    expect(step2a).toContain('--full');
  });

  it('Step 2a uses git cat-file to verify SHA reachability (rebase safety)', () => {
    const step2a = extractSection(content, 'Step 2a:', 'Step 2b:');
    expect(step2a).toMatch(/git cat-file/);
  });

  it('Phase 7 writes HEAD SHA to .last-analysis-head after analysis completes', () => {
    const phase7 = extractSection(content, '### Phase 7:', '## Architecture');
    expect(phase7).toContain('.last-analysis-head');
  });

  it('no-new-commits case documented with stop condition', () => {
    // The edge case table or step 2a must document the stop behavior
    expect(content).toMatch(/No new commits since last analysis/i);
  });
});

// ---------------------------------------------------------------------------
// Group 3: Static tool invocation — safety patterns
// ---------------------------------------------------------------------------

describe('bug-analysis.md — static analysis safety patterns', () => {
  it('uses xargs for semgrep to prevent shell injection from path metacharacters', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:');
    // xargs used with semgrep to safely pass filenames
    expect(phase2).toMatch(/xargs.*semgrep|semgrep.*xargs/s);
  });

  it('uses xargs for snyk to prevent shell injection from path metacharacters', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:');
    expect(phase2).toMatch(/xargs.*snyk|snyk.*xargs/s);
  });

  it('uses mktemp for CodeQL temp directory (prevents symlink attacks)', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:');
    expect(phase2).toContain('mktemp -d');
  });

  it('CodeQL cleanup uses rm -rf regardless of success or failure', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:');
    expect(phase2).toMatch(/rm -rf.*CODEQL_TMP|CODEQL_TMP.*rm -rf/s);
  });

  it('timeout bounds applied to all static tools', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:');
    // All three tool invocations use timeout
    const timeoutCount = (phase2.match(/timeout\s+\d+/g) || []).length;
    expect(timeoutCount).toBeGreaterThanOrEqual(3);
  });

  it('static findings descriptions truncated to 200 characters (bounded serialization)', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:');
    expect(phase2).toMatch(/200\s*char/i);
  });

  it('static findings normalized table capped at top 50 by severity', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:');
    expect(phase2).toMatch(/top 50|cap.*50/i);
  });
});

// ---------------------------------------------------------------------------
// Group 4: BugAnalyzer agent spawning
// ---------------------------------------------------------------------------

describe('bug-analysis.md — BugAnalyzer agent spawning', () => {
  it('Phase 5 spawns BugAnalyzer agents in a single message (parallel, not background)', () => {
    const phase5 = extractSection(content, '### Phase 5:', '### Phase 6:');
    expect(phase5).toMatch(/single message/i);
    expect(phase5).toMatch(/run_in_background=false/);
  });

  it('Phase 5 passes STATIC_FINDINGS only to security analyzer', () => {
    const phase5 = extractSection(content, '### Phase 5:', '### Phase 6:');
    expect(phase5).toMatch(/[Ss]ecurity.*STATIC_FINDINGS|STATIC_FINDINGS.*[Ss]ecurity/s);
    // Other analyzers receive (none) for STATIC_FINDINGS
    expect(phase5).toContain('(none)');
  });

  it('Phase 5 passes DECISIONS_CONTEXT to BugAnalyzer agents', () => {
    const phase5 = extractSection(content, '### Phase 5:', '### Phase 6:');
    expect(phase5).toContain('DECISIONS_CONTEXT');
  });

  it('Phase 5 passes FEATURE_KNOWLEDGE to BugAnalyzer agents', () => {
    const phase5 = extractSection(content, '### Phase 5:', '### Phase 6:');
    expect(phase5).toContain('FEATURE_KNOWLEDGE');
  });

  it('Phase 5 passes PR_DESCRIPTION with containment markers', () => {
    const phase5 = extractSection(content, '### Phase 5:', '### Phase 6:');
    expect(phase5).toContain('PR_DESCRIPTION');
    expect(phase5).toContain('<pr-description>');
  });

  it('security and functional focuses always active', () => {
    const phase4 = extractSection(content, '### Phase 4:', '### Phase 5:');
    expect(phase4).toMatch(/security.*Always|Always.*security/i);
    expect(phase4).toMatch(/functional.*Always|Always.*functional/i);
  });

  it('integration focus is conditional on 2+ distinct directories changed', () => {
    const phase4 = extractSection(content, '### Phase 4:', '### Phase 5:');
    expect(phase4).toMatch(/integration/i);
    expect(phase4).toMatch(/2\+.*director|distinct.*director/i);
  });

  it('usability focus conditional on UI file types', () => {
    const phase4 = extractSection(content, '### Phase 4:', '### Phase 5:');
    expect(phase4).toMatch(/usability/i);
    expect(phase4).toMatch(/\.tsx|\.jsx|\.html|\.css/);
  });

  it('instructs agents to follow devflow:apply-decisions', () => {
    const phase5 = extractSection(content, '### Phase 5:', '### Phase 6:');
    expect(phase5).toContain('devflow:apply-decisions');
  });
});

// ---------------------------------------------------------------------------
// Group 5: Synthesizer agent — bug-analysis mode
// ---------------------------------------------------------------------------

describe('bug-analysis.md — Synthesizer agent', () => {
  it('Phase 6 spawns Synthesizer with mode: bug-analysis', () => {
    const phase6 = extractSection(content, '### Phase 6:', '### Phase 7:');
    expect(phase6).toMatch(/[Mm]ode.*bug-analysis|bug-analysis.*[Mm]ode/);
  });

  it('Phase 6 Synthesizer output path is {ANALYSIS_DIR}/bug-analysis-summary.md', () => {
    const phase6 = extractSection(content, '### Phase 6:', '### Phase 7:');
    expect(phase6).toContain('bug-analysis-summary.md');
  });
});

// ---------------------------------------------------------------------------
// Group 6: Resolve compatibility
// ---------------------------------------------------------------------------

describe('bug-analysis.md — resolve compatibility', () => {
  it('suggests /resolve when CRITICAL or HIGH bugs found', () => {
    const phase7 = extractSection(content, '### Phase 7:', '## Architecture');
    expect(phase7).toMatch(/\/resolve/);
    expect(phase7).toMatch(/CRITICAL|HIGH/);
  });

  it('documents that /resolve detects bug analysis reports automatically', () => {
    // Resolve Compatibility section or similar text
    expect(content).toMatch(/[Rr]esolve.*[Cc]ompatibility|\/resolve.*bug.analysis|bug.analysis.*\/resolve/is);
  });
});

// ---------------------------------------------------------------------------
// Group 7: Cross-cutting structural consistency
// ---------------------------------------------------------------------------

describe('bug-analysis.md — cross-cutting consistency', () => {
  it('Architecture section mirrors the 7-phase structure', () => {
    const arch = extractSection(content, '## Architecture', '## Edge Cases');
    expect(arch).toMatch(/Phase 1/);
    expect(arch).toMatch(/Phase 7/);
  });

  it('Edge Cases table covers incremental rebase invalidation', () => {
    const edgeCases = extractSection(content, '## Edge Cases', '## Resolve Compatibility');
    expect(edgeCases).toMatch(/[Rr]ebase/);
    expect(edgeCases).toMatch(/git cat-file|cat-file/);
  });

  it('Edge Cases table covers --full flag', () => {
    const edgeCases = extractSection(content, '## Edge Cases', '## Resolve Compatibility');
    expect(edgeCases).toContain('--full');
  });

  it('Principles section lists Orchestration only principle', () => {
    const principles = extractSection(content, '## Principles', null);
    expect(principles).toMatch(/[Oo]rchestration only/);
  });

  it('Principles section lists Incremental by default principle', () => {
    const principles = extractSection(content, '## Principles', null);
    expect(principles).toMatch(/[Ii]ncremental by default/);
  });
});

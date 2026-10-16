// tests/bug-analysis/structural.test.ts
// Structural tests for dist/commands/bug-analysis.md.
//
// Strategy: parse the markdown command file to verify structural invariants:
//   1. Phase ordering — all 7 phases present in correct order with Produces/Requires annotations
//   2. Incremental detection — .last-analysis-head read/write semantics documented
//   3. Static tool invocation — xargs, timeout, mktemp patterns for safety
//   4. Debug agent spawning — parallel spawn in a single message, required inputs
//   5. Synthesize agent — mode: bug-analysis output path
//   6. Resolve compatibility — /resolve suggestion on blocking bugs
//   7. Exclusion list — static-findings.md and bug-analysis-summary.md excluded from issue extraction
//
// These tests pin the structural contract of the command so future edits
// cannot silently remove safety-critical patterns.

import { describe, it, expect } from 'vitest';
import { loadFile, extractSection, resolveAgentSource } from '../helpers';

const content = loadFile('dist/commands/bug-analysis.md');
const agentContent = resolveAgentSource('debug').content;

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
    // The word, not the prefix: FEATURE_KNOWLEDGE_RULES also contains the literal, and Debug takes the full form.
    expect(phase5).toMatch(/\bFEATURE_KNOWLEDGE\b/);
  });

  it('Phase 3 produces both knowledge variables, and Phase 5 does not require the Rules-only one', () => {
    const phase3 = extractSection(content, '### Phase 3:', '### Phase 4:');
    const produces = phase3.split('\n').filter(l => l.startsWith('**Produces:**'));
    expect(produces.length).toBeGreaterThan(0);
    for (const line of produces) {
      expect(line).toMatch(/\bFEATURE_KNOWLEDGE\b/);
      expect(line).toContain('FEATURE_KNOWLEDGE_RULES');
    }
    const phase5 = extractSection(content, '### Phase 5:', '### Phase 6:');
    expect(phase5).not.toContain('FEATURE_KNOWLEDGE_RULES');
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
// Group 2b: Fresh base for branch diffs (#495)
//
// The base ref that ensure-pr-ready returns is the base of DIFF_RANGE. The Extract line tests the
// Base line and the hex base_ref and carries no copy of the name class (the Git op already stops on
// a refused name). A non-zero diff exit stops; an empty list stops only on exit 0; a degraded base
// prints one freshness line. The Debug diff command follows DIFF_RANGE and needs no text change.
// ---------------------------------------------------------------------------

function collectFreshBaseDefects(body: string): string[] {
  const out: string[] = [];
  const spawnAt = body.indexOf('OPERATION: ensure-pr-ready');
  const ret = spawnAt === -1 ? null : /^Return:[^\n]*/m.exec(body.slice(spawnAt));
  if (ret === null) out.push('the ensure-pr-ready spawn has no Return line');
  else if (!/\bbase_ref\b/.test(ret[0])) out.push('the Return line does not carry base_ref');
  const extract = /^\*\*Extract from response:\*\*[^\n]*/m.exec(body);
  if (extract === null) out.push('no Extract line');
  else {
    const line = extract[0];
    if (!/`base_ref`/.test(line)) out.push('the Extract line does not take base_ref');
    if (!/Base line reads \(rejected\)/.test(line)) out.push('the Extract line does not test the Base line for (rejected)');
    if (!/`base_ref` is not 40 or 64 hex/.test(line)) out.push('the Extract line does not test base_ref for 40 or 64 hex');
    if (!/Stop with cause and fix/.test(line)) out.push('the Extract line does not stop with the cause and the fix');
    if (/\{1,200\}|origin\\\//.test(line)) out.push('the Extract line carries a copy of the name class');
  }
  const ranges = [...body.matchAll(/Set `DIFF_RANGE` to `([^`]+)`/g)].map(m => m[1]);
  if (!ranges.includes('{base_ref}...HEAD')) out.push('DIFF_RANGE is not built from base_ref');
  if (!ranges.includes('{sha}...HEAD')) out.push('the incremental DIFF_RANGE changed');
  if (ranges.some(r => r.includes('{base_branch}'))) out.push('DIFF_RANGE is built from a base name');
  const step2b = extractSection(body, 'Step 2b:', 'Step 2c:');
  if (!/A non-zero diff exit stops\./.test(step2b)) out.push('Step 2b does not say a non-zero diff exit stops');
  const row = body.split('\n').find(l => l.startsWith('| Zero changed files in DIFF_RANGE'));
  if (row === undefined) out.push('no stop row for zero changed files');
  else if (!/^\| Zero changed files in DIFF_RANGE with exit 0 \|/.test(row)) out.push('the zero-files stop row does not fire only on exit 0');
  const fresh = body.split('\n').filter(l => /DEGRADED/.test(l) && /\bbase\b/.test(l));
  if (fresh.length !== 1) out.push(`${fresh.length} freshness lines, expected 1`);
  else if (!/once in the header/.test(fresh[0])) out.push('the freshness line is not printed once in the header');
  if (!body.includes('DIFF_COMMAND: git diff {DIFF_RANGE}')) out.push('the Debug diff command does not follow DIFF_RANGE');
  return out;
}

describe('bug-analysis.md — DIFF_RANGE starts at the fresh base that ensure-pr-ready returns (#495)', () => {
  const seed = (from: string | RegExp, to: string): string => {
    const next = content.replace(from, to);
    expect(next, `the seed ${String(from)} must change the text`).not.toBe(content);
    return next;
  };

  it('Return, Extract, DIFF_RANGE, the exit rule, the stop row and the freshness line', () => {
    expect(collectFreshBaseDefects(content)).toEqual([]);
  });

  it('known-bad probes: each lost or weakened part is reported', () => {
    expect(collectFreshBaseDefects(seed('Return: branch, base_branch, base_ref, branch-slug, PR#', 'Return: branch, base_branch, branch-slug, PR#')))
      .toContain('the Return line does not carry base_ref');
    expect(collectFreshBaseDefects(seed('Base line reads (rejected) or', 'Base line is fine or')))
      .toContain('the Extract line does not test the Base line for (rejected)');
    expect(collectFreshBaseDefects(seed('`base_ref` is not 40 or 64 hex', '`base_ref` is empty')))
      .toContain('the Extract line does not test base_ref for 40 or 64 hex');
    expect(collectFreshBaseDefects(seed('Stop with cause and fix when', 'Warn when')))
      .toContain('the Extract line does not stop with the cause and the fix');
    expect(collectFreshBaseDefects(seed('Stop with cause and fix when', 'Stop with cause and fix unless it matches `^[A-Za-z0-9._/+@,#-]{1,200}$`, or when')))
      .toContain('the Extract line carries a copy of the name class');
    expect(collectFreshBaseDefects(seed('Set `DIFF_RANGE` to `{base_ref}...HEAD`', 'Set `DIFF_RANGE` to `{base_branch}...HEAD`')).join('\n'))
      .toMatch(/DIFF_RANGE is not built from base_ref[\s\S]*DIFF_RANGE is built from a base name/);
    expect(collectFreshBaseDefects(seed('Set `DIFF_RANGE` to `{sha}...HEAD`', 'Set `DIFF_RANGE` to `{sha}..HEAD`')))
      .toContain('the incremental DIFF_RANGE changed');
    expect(collectFreshBaseDefects(seed(' A non-zero diff exit stops.', '')))
      .toContain('Step 2b does not say a non-zero diff exit stops');
    expect(collectFreshBaseDefects(seed('| Zero changed files in DIFF_RANGE with exit 0 |', '| Zero changed files in DIFF_RANGE |')))
      .toContain('the zero-files stop row does not fire only on exit 0');
    expect(collectFreshBaseDefects(seed(/^Print a returned base .*\n/m, '')))
      .toContain('0 freshness lines, expected 1');
    expect(collectFreshBaseDefects(seed('line once in the header.', 'line.')))
      .toContain('the freshness line is not printed once in the header');
    expect(collectFreshBaseDefects(seed('DIFF_COMMAND: git diff {DIFF_RANGE}', 'DIFF_COMMAND: git diff main...HEAD')))
      .toContain('the Debug diff command does not follow DIFF_RANGE');
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
// Group 4: Debug agent spawning
// ---------------------------------------------------------------------------

describe('bug-analysis.md — Debug agent spawning', () => {
  it('Phase 5 spawns Debug agents in a single message (parallel, not background)', () => {
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

  it('Phase 5 passes DECISIONS_CONTEXT to Debug agents', () => {
    const phase5 = extractSection(content, '### Phase 5:', '### Phase 6:');
    expect(phase5).toContain('DECISIONS_CONTEXT');
  });

  it('Phase 5 passes FEATURE_KNOWLEDGE to Debug agents (the full form, rules and heading index)', () => {
    const phase5 = extractSection(content, '### Phase 5:', '### Phase 6:');
    expect(phase5).toContain('FEATURE_KNOWLEDGE: {FEATURE_KNOWLEDGE}');
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
// Group 5: Synthesize agent — bug-analysis mode
// ---------------------------------------------------------------------------

describe('bug-analysis.md — Synthesize agent', () => {
  it('Phase 6 spawns the Synthesize agent with mode: bug-analysis', () => {
    const phase6 = extractSection(content, '### Phase 6:', '### Phase 7:');
    expect(phase6).toMatch(/[Mm]ode.*bug-analysis|bug-analysis.*[Mm]ode/);
  });

  it('Phase 6 Synthesize agent output path is {ANALYSIS_DIR}/bug-analysis-summary.md', () => {
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
// Group 7: debug.md — output format section headers
// ---------------------------------------------------------------------------

describe('debug.md — output format section headers', () => {
  it('output template contains "Issues in Your Changes (BLOCKING)" section header', () => {
    expect(agentContent).toContain('## Issues in Your Changes (BLOCKING)');
  });

  it('output template contains "Issues in Code You Touched (Should Fix)" section header', () => {
    expect(agentContent).toContain('## Issues in Code You Touched (Should Fix)');
  });

  it('output template contains "Pre-existing Issues (Not Blocking)" section header', () => {
    expect(agentContent).toContain('## Pre-existing Issues (Not Blocking)');
  });

  it('severity-to-category mapping documents CRITICAL/HIGH → BLOCKING', () => {
    expect(agentContent).toMatch(/CRITICAL.*BLOCKING|HIGH.*BLOCKING/s);
  });

  it('severity-to-category mapping documents MEDIUM → Should Fix', () => {
    expect(agentContent).toMatch(/MEDIUM.*[Ss]hould [Ff]ix/s);
  });

  it('severity-to-category mapping documents LOW → Pre-existing', () => {
    expect(agentContent).toMatch(/LOW.*[Pp]re.existing/s);
  });

  it('output template contains summary matrix table with Category × Severity columns', () => {
    // The summary section must have a table with both Category and severity columns
    const summarySection = extractSection(agentContent, '## Summary', '## Principles');
    expect(summarySection).toMatch(/Category.*CRITICAL.*HIGH.*MEDIUM.*LOW/s);
  });

  it('output template contains Recommendation footer line', () => {
    expect(agentContent).toContain('**Recommendation**');
  });
});

// ---------------------------------------------------------------------------
// Group 8: debug.md — frontmatter skill declarations
// ---------------------------------------------------------------------------

describe('debug.md — pattern skills load on demand', () => {
  const frontmatter = agentContent.slice(0, agentContent.indexOf('\n---\n', 1) + 1);
  const body = agentContent.slice(agentContent.indexOf('\n---\n', 1) + 5);
  const focusAreas = extractSection(body, '## Focus Areas', '## Apply Decisions');
  const PATTERN_SKILLS = ['security', 'reliability', 'regression', 'consistency', 'complexity'];

  it('frontmatter preloads none of the five pattern skills', () => {
    for (const skill of PATTERN_SKILLS) {
      expect(frontmatter, skill).not.toContain(`devflow:${skill}`);
    }
  });

  it('the Focus Areas table names every pattern skill literally, so each one can be loaded', () => {
    for (const skill of PATTERN_SKILLS) {
      expect(focusAreas, skill).toContain(`\`devflow:${skill}\``);
    }
  });

  it('the Focus Areas table names the skills of each focus in its own row', () => {
    const row = (focus: string): string => focusAreas.split('\n').find(line => line.startsWith(`| \`${focus}\``)) ?? '';
    expect(row('security')).toContain('devflow:security');
    for (const skill of ['regression', 'reliability', 'complexity']) expect(row('functional')).toContain(`devflow:${skill}`);
    for (const skill of ['regression', 'consistency']) expect(row('integration')).toContain(`devflow:${skill}`);
    for (const skill of ['consistency', 'reliability']) expect(row('usability')).toContain(`devflow:${skill}`);
  });

  it('tells the agent to load its row with the Skill tool, and to continue when a load fails', () => {
    const text = body.replace(/\s+/g, ' ');
    expect(text).toContain('invoke the Skill tool with');
    expect(text).toContain('for each skill in the row for your FOCUS');
    expect(text).toContain('If an invocation fails, continue with this methodology');
  });

  it('Skill is in the tool allowlist, so the load can run', () => {
    const tools = frontmatter.slice(frontmatter.indexOf('\ntools:'));
    expect(tools).toMatch(/^  - Skill$/m);
  });
});

// ---------------------------------------------------------------------------
// Group 9: Cross-cutting structural consistency
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

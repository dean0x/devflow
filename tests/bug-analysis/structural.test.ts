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
import { loadFile, extractSection, resolveAgentSource, resolveCurationOffSource, collectFreshBaseDefects, collectSlugCheckDefects, collectStoredHeadDefects, slugSinkLines, EVIDENCE_RENDER_LINE, type DiffRangeShape } from '../helpers';

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
    expect(step2a).toMatch(/git -C "\{worktree\}" cat-file -t \{sha\}` must print `commit`/);
  });

  it('Phase 7 writes HEAD SHA to .last-analysis-head under the absolute git directory after analysis completes', () => {
    const phase7 = extractSection(content, '### Phase 7:', '## Architecture');
    expect(phase7).toContain('.last-analysis-head');
    expect(phase7).toContain('rev-parse --absolute-git-dir');
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
// Base line and carries no copy of the name class (the Git op already stops on a refused name) and no
// hex test, and takes the fix from the Git agent; the hex base_ref is tested only on the full-range
// path. A non-zero diff exit stops; an empty list stops only on exit 0; a degraded base prints one
// freshness line under Branch in the Phase 7 report. The stored analysis head is checked as a commit ID
// before it is used. The Debug diff command follows DIFF_RANGE and needs no text change.
// ---------------------------------------------------------------------------

const ANALYSIS_RANGE: DiffRangeShape = {
  head: 'analysis',
  step: 'Step 2a',
  stepFrom: 'Step 2a:',
  stepTo: 'Step 2b:',
  reachability: 'git -C "{worktree}" cat-file -t {sha}` must print `commit`',
  incrementalRange: '{sha}...HEAD',
  marker: '.last-analysis-head',
  dir: 'bug-analysis',
};

// The facts /code-review shares live in the helpers; this adds Step 2b, the stop row, the Phase 7 slot and the Debug command.
function collectAnalysisFreshBaseDefects(body: string): string[] {
  const out = collectFreshBaseDefects(body, ANALYSIS_RANGE, {
    freshness: line => {
      const at = body.indexOf(line);
      const branch = body.indexOf('**Branch**: {branch}');
      const analysis = body.indexOf('**Analysis**: {ANALYSIS_DIR}');
      if (branch === -1 || analysis === -1 || at < branch || at > analysis) return 'the freshness line is not under Branch in the Phase 7 report';
      return /from Phase 1, as returned/.test(line) ? null : 'the freshness line is not the Phase 1 line as returned';
    },
  });
  const step2b = extractSection(body, 'Step 2b:', 'Step 2c:');
  if (!/A non-zero diff exit stops\./.test(step2b)) out.push('Step 2b does not say a non-zero diff exit stops');
  const row = body.split('\n').find(l => l.startsWith('| Zero changed files in DIFF_RANGE'));
  if (row === undefined) out.push('no stop row for zero changed files');
  else if (!/^\| Zero changed files in DIFF_RANGE with exit 0 \|/.test(row)) out.push('the zero-files stop row does not fire only on exit 0');
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
    expect(collectAnalysisFreshBaseDefects(content)).toEqual([]);
  });

  it('the curation-off build states the same parts', () => {
    const off = resolveCurationOffSource('commands', 'bug-analysis');
    expect(off, 'dist/curation-off/commands/bug-analysis.md is absent: run `npm run build:mds`').not.toBeNull();
    expect(off, 'the curation-off build is the curation-on build, so this proves nothing').not.toBe(content);
    expect(collectAnalysisFreshBaseDefects(off ?? '')).toEqual([]);
  });

  it('known-bad probes: each lost or weakened part is reported', () => {
    expect(collectAnalysisFreshBaseDefects(seed('Return: branch, base_branch, base_ref, branch-slug, PR#', 'Return: branch, base_branch, branch-slug, PR#')))
      .toContain('the Return line does not carry base_ref');
    expect(collectAnalysisFreshBaseDefects(seed('`base_branch`, `base_ref`, `branch_slug`', '`base_branch`, `branch_slug`')))
      .toContain('the Extract line does not take base_ref');
    expect(collectAnalysisFreshBaseDefects(seed('Base line reads (rejected) or', 'Base line is fine or')))
      .toContain('the Extract line does not test the Base line for (rejected)');
    expect(collectAnalysisFreshBaseDefects(seed('unless `base_ref` is 40 or 64 hex', 'unless `base_ref` is set')))
      .toContain('the full-range path does not stop unless base_ref is 40 or 64 hex');
    expect(collectAnalysisFreshBaseDefects(seed('Base line reads (rejected) or', 'Base line reads (rejected) or `base_ref` is not 40 or 64 hex or')))
      .toContain('the Extract line carries the hex test; it sits on the full-range path');
    expect(collectAnalysisFreshBaseDefects(seed('Stop with cause and fix when', 'Warn when')))
      .toContain('the Extract line does not stop with the cause and the fix');
    expect(collectAnalysisFreshBaseDefects(seed('Stop with cause and fix when', 'Stop with cause and fix unless it matches `^[A-Za-z0-9._/+@,#-]{1,200}$`, or when')))
      .toContain('the Extract line carries a copy of the name class');
    // The copy sits in parentheses: a `$` before a backtick is a replacement pattern of String.replace.
    for (const widened of ['^[A-Za-z0-9._/+@,#-]{1,255}$', '^[A-Za-z0-9._/+@,#~-]+$', '^[A-Za-z0-9._/+@,#-]+$', '^[A-Za-z0-9._/@+,#-]{1,255}$', '^[A-Za-z0-9._/+~@,#-]{1,255}$', '^[a-zA-Z0-9._/+@,#-]+$']) {
      expect(collectAnalysisFreshBaseDefects(seed('Stop with cause and fix when', `Stop with cause and fix unless it matches (${widened}), or when`)), widened)
        .toContain('the Extract line carries a copy of the name class');
    }
    expect(collectAnalysisFreshBaseDefects(seed('Set `DIFF_RANGE` to `{base_ref}...HEAD`', 'Set `DIFF_RANGE` to `{base_branch}...HEAD`')).join('\n'))
      .toMatch(/DIFF_RANGE is not built from base_ref[\s\S]*DIFF_RANGE is built from a base name/);
    expect(collectAnalysisFreshBaseDefects(seed('Set `DIFF_RANGE` to `{sha}...HEAD`', 'Set `DIFF_RANGE` to `{sha}..HEAD`')))
      .toContain('the incremental DIFF_RANGE changed');
    expect(collectAnalysisFreshBaseDefects(seed(' A non-zero diff exit stops.', '')))
      .toContain('Step 2b does not say a non-zero diff exit stops');
    expect(collectAnalysisFreshBaseDefects(seed('| Zero changed files in DIFF_RANGE with exit 0 |', '| Zero changed files in DIFF_RANGE |')))
      .toContain('the zero-files stop row does not fire only on exit 0');
    expect(collectAnalysisFreshBaseDefects(seed('rebase invalidated SHA), take the full-range path', 'rebase invalidated SHA), fall through to full')))
      .toContain('Step 2a names the full-range path a second way');
    expect(collectAnalysisFreshBaseDefects(seed(/^ *- \*\*Full-range path\b.*\n/m, '')))
      .toContain('Step 2a names the full-range path 0 times, expected once');
    expect(collectAnalysisFreshBaseDefects(seed(/^( *- \*\*Full-range path\b.*\n)/m, '$1$1')))
      .toContain('Step 2a names the full-range path 2 times, expected once');
    expect(collectAnalysisFreshBaseDefects(seed(/^( *- Set `DIFF_RANGE` to `\{base_ref\}\.\.\.HEAD`\n)/m, '- Read the log.\n$1')))
      .toContain('the full-range path does not build DIFF_RANGE from base_ref right after the hex test');
    expect(collectAnalysisFreshBaseDefects(seed("name the Git agent's fix, never your own", 'name a fix')))
      .toContain('the Extract line does not name the fix the Git agent returned');
    expect(collectAnalysisFreshBaseDefects(seed(/^\{any base .*\n/m, '')))
      .toContain('0 freshness lines, expected 1');
    expect(collectAnalysisFreshBaseDefects(seed('never its value.', 'never its value.\nPrint a returned base `TRACEABILITY: DEGRADED` line once in the header.')))
      .toContain('2 freshness lines, expected 1');
    const moved = seed(/^\{any base .*\n/m, '').replace('never its value.', 'never its value.\nPrint a returned base `TRACEABILITY: DEGRADED` line once in the header.');
    expect(collectAnalysisFreshBaseDefects(moved)).toContain('the freshness line is not under Branch in the Phase 7 report');
    expect(collectAnalysisFreshBaseDefects(seed('from Phase 1, as returned', 'from Phase 1')))
      .toContain('the freshness line is not the Phase 1 line as returned');
    expect(collectAnalysisFreshBaseDefects(seed('DIFF_COMMAND: git diff {DIFF_RANGE}', 'DIFF_COMMAND: git diff main...HEAD')))
      .toContain('the Debug diff command does not follow DIFF_RANGE');
  });

  it('known-bad probe: a directory made before the head and base checks is reported', () => {
    const made = /^3\. Create timestamped analysis directory:[^\n]*\n/m.exec(content);
    expect(made, 'Step 2a creates the analysis directory as its step 3').not.toBeNull();
    const early = content.replace(made?.[0] ?? '', '').replace('1. Check `{gd}/devflow/bug-analysis/{branch-slug}/.last-analysis-head`,', `${made?.[0] ?? ''}1. Check \`{gd}/devflow/bug-analysis/{branch-slug}/.last-analysis-head\`,`);
    expect(early, 'the probe must move the directory step').not.toBe(content);
    expect(collectAnalysisFreshBaseDefects(early)).toContain('Step 2a does not create the directory after the head and base checks');
  });
});

describe('bug-analysis.md — the stored analysis head sits under the git directory and is checked as a commit ID (Step 2a)', () => {
  const CHECK = ' The stored analysis head is checked as a commit ID: use it only when it is exactly 40 or 64 lowercase hex, else take the full-range path';
  const READ = '`{gd}/devflow/bug-analysis/{branch-slug}/.last-analysis-head`';
  const GD = ', `{gd}` being what `git -C "{worktree}" rev-parse --absolute-git-dir` prints';
  const WRITE = 'In one Bash call run `M="$(git -C "{worktree}" rev-parse --absolute-git-dir)/devflow/bug-analysis/{branch-slug}" && mkdir -p "$M" && git -C "{worktree}" rev-parse HEAD > "$M/.last-analysis-head"`.';
  const NEVER_STOPS = ' A failed or refused write never stops the run and is not retried another way.';
  const NOT_ONE_CALL = 'the analysis head is not written in one Bash call that makes the directory and then lets git write the SHA';
  const seed = (from: string, to: string): string => {
    const next = content.replace(from, to);
    expect(next, `the seed ${from} must change the text`).not.toBe(content);
    return next;
  };

  it('the check comes before the reachability test and the incremental range', () => {
    expect(collectStoredHeadDefects(content, ANALYSIS_RANGE)).toEqual([]);
  });

  it('no marker path sits in the docs tree, and the reader takes none from there', () => {
    expect(content).not.toMatch(/\.devflow\/docs\/[^\s`"]*\.last-analysis-head/);
    expect(content).toContain(READ);
    expect(content).toContain(WRITE + NEVER_STOPS);
  });

  it('known-bad probes: a missing, weakened or late check is reported', () => {
    expect(collectStoredHeadDefects(seed(CHECK, ''), ANALYSIS_RANGE))
      .toContain('the stored analysis head is not checked as a commit ID');
    expect(collectStoredHeadDefects(seed('exactly 40 or 64 lowercase hex', 'hex'), ANALYSIS_RANGE))
      .toContain('the stored analysis head check does not require exactly 40 or 64 lowercase hex');
    expect(collectStoredHeadDefects(seed('else take the full-range path', 'else go on'), ANALYSIS_RANGE))
      .toContain('a stored analysis head that fails the check does not take the full-range path');
    const late = seed(CHECK, '').replace('must print `commit`', `must print \`commit\`${CHECK}`);
    expect(collectStoredHeadDefects(late, ANALYSIS_RANGE)).toContain('the stored analysis head is used before it is checked');
  });

  it('known-bad probes: a missing step, reachability check or incremental range is reported', () => {
    expect(collectStoredHeadDefects(content.replaceAll('Step 2a:', 'Step 2z:'), ANALYSIS_RANGE))
      .toEqual(['no Step 2a (incremental detection)']);
    expect(collectStoredHeadDefects(seed('cat-file -t {sha}', 'cat-file -t {head}'), ANALYSIS_RANGE))
      .toContain('Step 2a lost the reachability check or the incremental range');
    expect(collectStoredHeadDefects(seed('Set `DIFF_RANGE` to `{sha}...HEAD`', 'Set `DIFF_RANGE` to `{sha}..HEAD`'), ANALYSIS_RANGE))
      .toContain('Step 2a lost the reachability check or the incremental range');
    expect(collectStoredHeadDefects(seed('git -C "{worktree}" cat-file -t {sha}', 'git -C {worktree} cat-file -t {sha}'), ANALYSIS_RANGE))
      .toContain('Step 2a lost the reachability check or the incremental range');
  });

  it('known-bad probe: a reachability check that does not require the type commit is reported', () => {
    expect(collectStoredHeadDefects(seed(' must print `commit`; if not', '; if not'), ANALYSIS_RANGE))
      .toContain('Step 2a lost the reachability check or the incremental range');
    expect(collectStoredHeadDefects(seed(' must print `commit`; if not', ' must exit 0; if not'), ANALYSIS_RANGE))
      .toContain('Step 2a lost the reachability check or the incremental range');
  });

  it('known-bad probes: a marker read from the docs tree, an unnamed git directory or a kept tracked-file check is reported', () => {
    expect(collectStoredHeadDefects(seed(READ + GD, '`{worktree}/.devflow/docs/bug-analysis/{branch-slug}/.last-analysis-head`'), ANALYSIS_RANGE))
      .toEqual(expect.arrayContaining(['the stored analysis head is not read under the absolute git directory', 'the analysis head marker sits in the docs tree']));
    expect(collectStoredHeadDefects(seed(GD, ''), ANALYSIS_RANGE))
      .toEqual(['Step 2a does not say what {gd} is']);
    expect(collectStoredHeadDefects(seed('`{gd}/devflow/bug-analysis/', '`{gd}/bug-analysis/'), ANALYSIS_RANGE))
      .toContain('the stored analysis head is not read under the absolute git directory');
    expect(collectStoredHeadDefects(seed(CHECK, `${CHECK}\n     - The analysis head counts only when \`git -C "{worktree}" ls-files --error-unmatch -- .last-analysis-head\` exits 1.`), ANALYSIS_RANGE))
      .toContain('Step 2a checks the analysis head with the tracked-file probe ls-files');
  });

  it('known-bad probes: a marker write that is split, kept in the docs tree, missing or allowed to stop the run is reported', () => {
    expect(collectStoredHeadDefects(seed(NEVER_STOPS, ''), ANALYSIS_RANGE))
      .toEqual(['the analysis head writer does not say a failed write never stops the run']);
    expect(collectStoredHeadDefects(seed(' && mkdir -p "$M" &&', ' &&'), ANALYSIS_RANGE))
      .toEqual([NOT_ONE_CALL]);
    expect(collectStoredHeadDefects(seed('In one Bash call run', 'Run'), ANALYSIS_RANGE))
      .toEqual([NOT_ONE_CALL]);
    expect(collectStoredHeadDefects(seed('rev-parse HEAD > "$M/.last-analysis-head"', 'rev-parse HEAD > "{worktree}/.devflow/docs/bug-analysis/{branch-slug}/.last-analysis-head"'), ANALYSIS_RANGE))
      .toEqual(expect.arrayContaining([NOT_ONE_CALL, 'the analysis head marker sits in the docs tree']));
    expect(collectStoredHeadDefects(seed('rev-parse HEAD > "$M/.last-analysis-head"', 'rev-parse HEAD'), ANALYSIS_RANGE))
      .toEqual(['the analysis head is written 0 times, expected once']);
    expect(collectStoredHeadDefects(`${content}\n${WRITE}${NEVER_STOPS}\n`, ANALYSIS_RANGE))
      .toEqual(['the analysis head is written 2 times, expected once']);
  });
});

describe('bug-analysis.md — the branch slug is checked once, before any command text carries it (Extract line)', () => {
  const PATTERN = '`^[A-Za-z0-9._-]{1,200}$`';
  // `$` followed by a backtick would be a replacement pattern in `String.replace`, so the seeded copy escapes it.
  const PATTERN_COPY = PATTERN.replaceAll('$', '$$$$');
  const seed = (from: string, to: string): string => {
    const next = content.replace(from, to);
    expect(next, `the seed ${from} must change the text`).not.toBe(content);
    return next;
  };

  it('the check comes before every slug sink', () => {
    expect(collectSlugCheckDefects(content)).toEqual([]);
    // Non-vacuity: the marker read, the directory create and the marker write are sinks.
    expect(slugSinkLines(content).length).toBeGreaterThanOrEqual(3);
  });

  it('known-bad probes: a lost, doubled, late or ungated check is reported', () => {
    expect(collectSlugCheckDefects(seed(' or `branch_slug` does not match the slug pattern above', '')))
      .toContain('the Extract line does not stop on a branch_slug that does not match the slug pattern');
    expect(collectSlugCheckDefects(seed(', and for the slug the allowed characters, never its value', '')))
      .toContain('the Extract line does not name the allowed characters, never the slug');
    expect(collectSlugCheckDefects(seed(`Only when \`branch_slug\` matches ${PATTERN} and the file exists`, 'Only when the file exists')))
      .toContain('the evidence render is not gated on a branch_slug that matches the slug pattern');
    expect(collectSlugCheckDefects(seed('Stop with cause and fix when', `Stop with cause and fix unless it matches ${PATTERN_COPY}, or when`)))
      .toContain('the slug pattern is stated 2 times, expected once');
    expect(collectSlugCheckDefects(seed(PATTERN, 'a pattern')))
      .toContain('the slug pattern is stated 0 times, expected once');
    const late = seed(PATTERN, 'a pattern').replace('Stop with cause and fix when', `Stop with cause and fix unless it matches ${PATTERN_COPY}, or when`);
    expect(collectSlugCheckDefects(late)).toContain('the slug pattern is stated after the Extract line');
    expect(collectSlugCheckDefects(seed('Spawn Git agent:', 'Run `mkdir -p {worktree}/.devflow/docs/bug-analysis/{branch-slug}`.\n\nSpawn Git agent:')))
      .toEqual([expect.stringContaining('a slug sink comes before the Extract line')]);
    expect(collectSlugCheckDefects('no slug text')).toEqual(['no Extract line']);
  });

  it('only the evidence render line is exempt from the sink scan', () => {
    expect(content.split('\n')).toContain(EVIDENCE_RENDER_LINE);
    expect(slugSinkLines(content).map(sink => sink.line)).not.toContain(EVIDENCE_RENDER_LINE);
  });

  it('known-bad probe: a verify-evidence line that carries the slug before the Extract line is reported', () => {
    expect(collectSlugCheckDefects(seed('render --plan "{worktree}/.devflow/docs/evidence-{branch_slug}.md";', 'render --plan "{worktree}/.devflow/docs/evidence-{branch_slug}.md" --out "{worktree}/.devflow/docs/bug-analysis/{branch-slug}/x.md";')))
      .toEqual([expect.stringContaining('a slug sink comes before the Extract line')]);
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

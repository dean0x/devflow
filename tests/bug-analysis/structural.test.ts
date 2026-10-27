// tests/bug-analysis/structural.test.ts
// Structural tests for dist/commands/bug-analysis.md.
//
// Strategy: parse the markdown command file to verify structural invariants:
//   1. Phase ordering — all 7 phases present in correct order with Produces/Requires annotations
//   2. Incremental detection — .last-analysis-head read/write semantics documented
//   3. Static tool invocation — mktemp, cleanup and output-cap patterns, plus the file-name handoff and the Bash timeout (3b)
//   4. Debug agent spawning — parallel spawn in a single message, required inputs
//   5. Synthesize agent — mode: bug-analysis output path
//   6. Resolve compatibility — /resolve suggestion on blocking bugs
//   7. Exclusion list — static-findings.md and bug-analysis-summary.md excluded from issue extraction
//
// These tests pin the structural contract of the command so future edits
// cannot silently remove safety-critical patterns.

import { spawnSync } from 'child_process';
import { describe, it, expect } from 'vitest';
import { loadFile, extractSection, sectionBetween, parseFences, resolveAgentSource, resolveCurationOffSource, collectFreshBaseDefects, collectSlugCheckDefects, collectStoredHeadDefects, slugSinkLines, seedOnce, EVIDENCE_RENDER_LINE, type DiffRangeShape } from '../helpers';

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
  it('uses mktemp for CodeQL temp directory (prevents symlink attacks)', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:');
    expect(phase2).toContain('mktemp -d');
  });

  it('CodeQL cleanup uses rm -rf regardless of success or failure', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:');
    expect(phase2).toMatch(/rm -rf.*CODEQL_TMP|CODEQL_TMP.*rm -rf/s);
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
// Group 3b: Static analysis never reads as clean when it did not run or did not finish (#649)
//
// Each collector owns one concern, reads one compiled body and returns its defects, so one defect fails one
// guard. A fixed scanner-line count and a minimum fence count keep a guard from passing on nothing. Each
// known-bad probe is a seeded in-memory copy that goes through the collector that owns its message, never
// the committed tree.
// ---------------------------------------------------------------------------

const SCANNER_TOOLS = ['semgrep scan', 'snyk code test', 'codeql database create', 'codeql database analyze'];
const STATUS_LOOP = `for t in semgrep snyk codeql; do printf '%s=%s\\n' "$t" "$(command -v "$t" || echo no)"; done`;
const EXIT_PRINT = "printf '\\nexit=%s\\n' ";
const SNYK_EXIT_LINE = `${EXIT_PRINT}"$E"\n`;
const CODEQL_SARIF_PRINT = 'cat "${CODEQL_TMP}/results.sarif"';
const NONE_ASSIGNMENT = 'Set `STATIC_FINDINGS` to `(none)`.';
const STATED_TIMEOUT = /Bash `timeout` at (\d+)/g;
const BASH_TIMEOUT_CEILING_MS = 600000;
/** What bounds a command in time: the `timeout` or `gtimeout` command, the old `{bound}` placeholder, or a `-k` kill grace. */
const BOUND_TEXT = /\bg?timeout\b|\{bound\}|-k \d+ \d+/;

function bashFences(text: string): string[] {
  return parseFences(text).filter(fence => fence.startsWith('```bash'));
}

function fenceLines(fence: string): string[] {
  return fence.split('\n').slice(1, -1);
}

function bashFenceLines(text: string): string[] {
  return bashFences(text).flatMap(fenceLines);
}

type Collector = (body: string) => string[];

const doesNotSay = (part: string): string => `Phase 2 does not say: ${part}`;

/**
 * devflow puts no time bound on a scanner: no command line of Phase 2 carries one, and no sentence names one. The
 * Bash `timeout` the agent sets for each call is the only limit, stated at most 600000 ms. A call that reaches it
 * prints no `exit=` line, which the status rule reads as did not complete.
 */
function collectNoBoundDefects(phase2: string): string[] {
  const out: string[] = [];
  const lines = bashFenceLines(phase2);
  const scanners = lines.filter(line => SCANNER_TOOLS.some(tool => line.includes(tool)));
  if (scanners.length !== SCANNER_TOOLS.length) out.push(`${scanners.length} scanner command lines, expected ${SCANNER_TOOLS.length}`);
  const bounded = lines.find(line => BOUND_TEXT.test(line));
  if (bounded !== undefined) out.push(`a Phase 2 command line carries a time bound: ${bounded.trim()}`);
  if (/\{bound\}|gtimeout/.test(phase2)) out.push('Phase 2 names a devflow time bound');
  const stated = [...phase2.matchAll(STATED_TIMEOUT)].map(match => Number(match[1]));
  if (stated.length === 0) out.push('no stated Bash timeout above the scanner calls');
  if (stated.some(ms => ms > BASH_TIMEOUT_CEILING_MS)) out.push('a stated Bash timeout is above 600000 ms');
  return out;
}

const DID_NOT_RUN_PARTS = [
  'or all tools unavailable', // lost, Step 2d runs on with no scanner installed
];

/**
 * Step 2c prints one status line per tool, with no bound probe in its fence. With no scanner installed Step 2d
 * skips, so it never runs a scanner that is not there.
 */
function collectDidNotRunDefects(phase2: string): string[] {
  const step2c = sectionBetween(phase2, 'Step 2c:', 'Step 2d:') ?? '';
  return [
    ...collectProbeFenceDefects(step2c),
    ...collectDidNotRunBranchDefects(step2c),
    ...DID_NOT_RUN_PARTS.filter(part => !phase2.includes(part)).map(doesNotSay),
  ];
}

const STATUS_LOOP_DEFECT = 'the Step 2c fence is not the one status line per tool loop';

function collectProbeFenceDefects(step2c: string): string[] {
  const probeFence = bashFences(step2c)[0];
  if (probeFence === undefined) return ['Step 2c has no bash fence'];
  const lines = fenceLines(probeFence).filter(line => line.trim() !== '');
  return lines.length === 1 && lines[0] === STATUS_LOOP ? [] : [STATUS_LOOP_DEFECT];
}

/** The all-`no` branch comes before the "some are available" branch. */
function collectDidNotRunBranchDefects(step2c: string): string[] {
  const out: string[] = [];
  const noneBranch = step2c.indexOf('No static analysis tools found');
  const someBranch = step2c.indexOf('If some are available');
  if (noneBranch === -1) out.push('Step 2c has no all-no branch warning');
  if (someBranch === -1) out.push('Step 2c has no "If some are available" branch');
  if (noneBranch === -1 || someBranch === -1) return out;
  // An absent sentence reads as -1, before the branch.
  if (noneBranch > someBranch) out.push('the all-no branch does not come before the "If some are available" branch');
  if (!step2c.slice(noneBranch, someBranch).includes(NONE_ASSIGNMENT)) out.push('the all-no branch does not set STATIC_FINDINGS to (none)');
  return out;
}

const STATUS_LINE_PARTS = [
  'Semgrep 0, Snyk 0 or 1 (1 = issues, only with SARIF output), CodeQL 0. Any other status',
  'or no such line',
  '`STATIC_FINDINGS` is `(none)` only when every tool that was to run completed',
  'Static analysis did not complete: {tool}',
  "If a tool's output was clipped, its findings are incomplete: name the tool in `STATIC_FINDINGS`, never `(none)`",
];

/**
 * Each scanner fence prints one status line, the Snyk status is read right after its scanner, and Phase 2 says how the
 * lines read: which statuses complete, that a missing line does not, and that `STATIC_FINDINGS` names a tool that did
 * not complete instead of `(none)`.
 */
function collectStatusLineDefects(phase2: string): string[] {
  const out: string[] = [];
  const scannerFences = bashFences(phase2).filter(fence => fenceLines(fence).some(line => SCANNER_TOOLS.some(tool => line.includes(tool))));
  const exitLines = scannerFences.map(fence => fence.split(EXIT_PRINT).length - 1);
  if (exitLines.length !== 3 || exitLines.some(count => count !== 1)) out.push(`the scanner fences carry ${exitLines.join('+') || '0'} exit lines, expected 1 each in 3 fences`);
  if (!phase2.includes('); E=$?')) out.push('the Snyk status is not read right after the scanner');
  return [...out, ...STATUS_LINE_PARTS.filter(part => !phase2.includes(part)).map(doesNotSay)];
}

const fenceWith = (phase2: string, tool: string): string[] => fenceLines(bashFences(phase2).find(fence => fenceLines(fence).some(line => line.includes(tool))) ?? '\n');

/**
 * Each scanner fence prints its own tool's status, on a line that comes after the scanner (and the Snyk filter).
 * The order has three reasons:
 * - The status is read before any other command runs. Semgrep prints it on the pipeline's own line, and
 *   `CODEQL_EXIT=$?` is the line right after `codeql database analyze`, above the `cat` and the cleanup. Any
 *   command between them replaces `$?`, so a CodeQL run that timed out would read as complete.
 * - The CodeQL SARIF is printed with `cat` before the cleanup removes it.
 * - Snyk scans the project once, into `S`. The filter and the status come after that one scan, never once per file.
 */
function collectExitLineOrderDefects(phase2: string): string[] {
  const out: string[] = [];
  const semgrep = fenceWith(phase2, 'semgrep scan').find(line => line.includes('semgrep scan')) ?? '';
  const pipeline = semgrep.indexOf('set -o pipefail; git diff');
  const semgrepExit = semgrep.indexOf(`${EXIT_PRINT}"$?"`);
  if (pipeline === -1 || semgrepExit < semgrep.indexOf('semgrep scan') || semgrep.indexOf('semgrep scan') < pipeline) out.push('the Semgrep exit line does not follow its pipeline on the same line, printing "$?"');

  const snyk = fenceWith(phase2, 'snyk code test');
  const assigned = snyk.findIndex(line => line.startsWith('S=$('));
  const filtered = Math.max(...snyk.map((line, index) => (line.includes('jq ') ? index : -1)));
  const snykExit = snyk.indexOf(`${EXIT_PRINT}"$E"`);
  if (assigned === -1 || snykExit <= assigned || snykExit <= filtered) out.push('the Snyk exit line does not follow the scanner and the filter, printing "$E"');

  const codeql = fenceWith(phase2, 'codeql database');
  const analyze = codeql.findIndex(line => line.includes('codeql database analyze'));
  const codeqlStatus = codeql.indexOf('CODEQL_EXIT=$?');
  if (analyze === -1 || codeqlStatus !== analyze + 1) out.push('the CodeQL status is not read on the line right after codeql database analyze');
  if (codeqlStatus === -1 || codeql.indexOf(`${EXIT_PRINT}"$CODEQL_EXIT"`) <= codeqlStatus) out.push('the CodeQL exit line does not follow CODEQL_EXIT=$?, printing "$CODEQL_EXIT"');
  return out;
}

const OUTCOME_VAR = 'STATIC_STATUS';

/** The names a `**Produces:**` or `**Requires:**` line lists, from the first such line in a section. */
function declaredNames(section: string | null, label: 'Produces' | 'Requires'): string[] {
  const line = (section ?? '').split('\n').find(text => text.startsWith(`**${label}:**`)) ?? '';
  return line.slice(`**${label}:**`.length).split(',').map(name => name.trim());
}

/** The per-tool outcome Phase 7 reports is declared where Step 2d makes it and where Phase 7 reads it. */
function collectOutcomeDeclarationDefects(body: string): string[] {
  const out: string[] = [];
  if (!declaredNames(sectionBetween(body, '#### Step 2d:', '### Phase 3:'), 'Produces').includes(OUTCOME_VAR)) out.push(`Step 2d does not produce ${OUTCOME_VAR}`);
  if (!declaredNames(sectionBetween(body, '### Phase 7:', '## Architecture'), 'Requires').includes(OUTCOME_VAR)) out.push(`Phase 7 does not require ${OUTCOME_VAR}`);
  const line = body.split('\n').find(text => text.startsWith('**Static analysis**:')) ?? '';
  if (!line.includes(OUTCOME_VAR)) out.push(`the Static analysis line does not name ${OUTCOME_VAR}`);
  return out;
}

function collectStaticReportDefects(body: string): string[] {
  const out: string[] = [];
  const analysis = body.indexOf('**Analysis**: {ANALYSIS_DIR}');
  const status = body.indexOf('**Static analysis**:');
  const risk = body.indexOf('### Risk Assessment');
  if (status === -1) out.push('the report has no Static analysis line');
  else if (analysis === -1 || status < analysis || status > risk) out.push('the Static analysis line is not between Analysis and Risk Assessment');
  if (!body.includes('| A scanner did not run or did not complete |')) out.push('no edge-case row for a scanner that did not run or did not complete');
  if (!body.includes('(`(none)` only if')) out.push('the checklist does not limit (none) to a clean result');
  return out;
}

/** `--full` always runs CodeQL: its gate line waits on no scanner's status, and no sentence skips it. */
function collectFullCodeqlDefects(body: string): string[] {
  const gates = body.split('\n').filter(line => line.startsWith('**CodeQL**'));
  if (gates.length !== 1) return [`${gates.length} CodeQL gate lines, expected 1`];
  const out: string[] = [];
  if (!gates[0].includes('(`--full` OR ')) out.push('the CodeQL gate line does not run CodeQL whenever --full is set');
  if (/complet|skip/i.test(gates[0])) out.push('the CodeQL gate line waits on another scanner completing, or skips CodeQL');
  if (/skip\w*\s+CodeQL|CodeQL:\s*skipped/i.test(body)) out.push('a sentence skips CodeQL');
  return out;
}

/** CodeQL stops when its temp folder cannot be made, so it never runs with an empty scratch path. */
function collectCodeqlScratchDefects(phase2: string): string[] {
  const make = fenceWith(phase2, 'codeql database').find(line => line.startsWith('CODEQL_TMP=$(mktemp -d)'));
  if (make === undefined) return ['the CodeQL fence does not make its temp folder with mktemp -d'];
  return make === 'CODEQL_TMP=$(mktemp -d) || exit' ? [] : ['the CodeQL fence does not stop when mktemp -d fails'];
}

const STATUS_RULE_PARTS = [
  'a tool that ran completed only on Semgrep 0,',
  '(126-127: scanner did not start; else failed. Semgrep via xargs: number only)',
  'A call with no `exit=` line in its own result did not complete',
  'It stays did not complete for this run: ignore a later end notice.',
];

/**
 * The completion rule covers the tools that ran, and the exit meanings end in a catch-all that leaves Semgrep's status
 * a number. A call with no `exit=` line did not complete and stays so: a later end notice changes nothing.
 */
function collectStatusRuleDefects(phase2: string): string[] {
  return STATUS_RULE_PARTS.filter(part => !phase2.includes(part)).map(doesNotSay);
}

const SCANNER_ROOT_CD = 'cd "{worktree}" || exit';
const CODEQL_ROOT = '--source-root="{worktree}"';

/**
 * Each scanner fence runs from the worktree root, whatever directory the Bash call starts in. Semgrep and Snyk
 * open with a `cd` that stops the call when it fails, so no status line prints and the run fails closed.
 * CodeQL names the root itself, or opens with the same `cd`.
 */
function collectScannerRootDefects(phase2: string): string[] {
  const out: string[] = [];
  const opensAtRoot = (lines: string[]): boolean => lines.find(line => line.trim() !== '') === SCANNER_ROOT_CD;
  for (const tool of ['semgrep scan', 'snyk code test']) {
    if (!opensAtRoot(fenceWith(phase2, tool))) out.push(`the ${tool} fence does not open with ${SCANNER_ROOT_CD}`);
  }
  const codeql = fenceWith(phase2, 'codeql database');
  const create = codeql.find(line => line.includes('codeql database create')) ?? '';
  if (!opensAtRoot(codeql) && !create.includes(CODEQL_ROOT)) out.push(`the CodeQL fence neither opens with ${SCANNER_ROOT_CD} nor passes ${CODEQL_ROOT}`);
  return out;
}

const SNYK_NAME_LIST ='"$(git diff --name-only -z {DIFF_RANGE} | jq -Rs \'split("\\u0000")\')"';

function collectFileNameHandoffDefects(phase2: string): string[] {
  const out: string[] = [];
  const fences = bashFences(phase2).length;
  if (fences < 5) out.push(`${fences} bash fences, expected at least 5`);
  const semgrep = /^set -o pipefail; git diff --name-only -z --diff-filter=d \{DIFF_RANGE\} \| xargs -0 -r semgrep scan [^;|]* -- 2>\/dev\/null;/m;
  if (!semgrep.test(phase2)) out.push('the Semgrep line does not read names with -z, pass them with xargs -0 and put them after --');
  if (!phase2.includes(SNYK_NAME_LIST)) out.push('the Snyk filter does not read the names from git as NUL-separated output');
  const reads = bashFenceLines(phase2).filter(line => line.includes('CHANGED_FILES') && line !== 'CHANGED_FILES=$(git diff --name-only {DIFF_RANGE})');
  if (reads.length > 0) out.push(`a scanner line reads CHANGED_FILES: ${reads[0]}`);
  if (!phase2.includes('File names reach a scanner only through')) out.push('Phase 2 does not say how file names reach a scanner');
  return out;
}

const SNYK_SCOPE_FILTER = '.runs[].results |= map(select(.locations[].physicalLocation.artifactLocation.uri as $uri | $files | index($uri) != null))';
const SNYK_FILTER_FALLBACK = `2>/dev/null || printf '%s' "$S"`;
const SNYK_UNFILTERED_NOTE = 'Without `jq` the SARIF is unfiltered: note that.';

/**
 * Snyk scans the project once, so its SARIF holds results for every file. The filter keeps the results whose file is
 * a changed file. When `jq` fails or is absent, the line right after the filter prints the SARIF unfiltered, and the
 * note says so. Without that fallback a missing `jq` would print nothing, and the run would read as clean.
 */
function collectSnykScopeDefects(phase2: string): string[] {
  const out: string[] = [];
  const snyk = fenceWith(phase2, 'snyk code test').map(line => line.trim());
  const filter = snyk.indexOf(`'${SNYK_SCOPE_FILTER}' \\`);
  if (filter === -1) out.push('the Snyk filter does not keep only the results whose file is a changed file');
  if (snyk[filter + 1] !== SNYK_FILTER_FALLBACK) out.push('the line after the Snyk filter does not print the SARIF unfiltered when jq fails');
  if (!phase2.includes(SNYK_UNFILTERED_NOTE)) out.push('Phase 2 does not say that the SARIF is unfiltered without jq');
  return out;
}

/** The two jq programs the Snyk fence ships: the one that reads the NUL-separated names, and the scope filter. Both throw when the fence changes shape. */
function shippedSnykPrograms(phase2: string): { names: string; scope: string } {
  const fence = fenceWith(phase2, 'snyk code test');
  const names = /jq -Rs '([^']+)'/.exec(fence.join('\n'));
  const scope = fence.map(line => line.trim()).find(line => line.startsWith("'.runs[]") && line.endsWith("' \\"));
  if (names === null || scope === undefined) throw new Error('the Snyk fence no longer holds the jq name reader and the scope filter in their shipped shape');
  return { names: names[1], scope: scope.slice(1, -3) };
}

describe('bug-analysis.md — static analysis never reads as clean when it did not run or did not finish (#649)', () => {
  const off = resolveCurationOffSource('commands', 'bug-analysis');
  const builds: Array<[string, string | null]> = [['curation-on', content], ['curation-off', off]];
  const phase2Of = (body: string): string => extractSection(body, '### Phase 2:', '### Phase 3:');
  const onPhase2 = (collect: (phase2: string) => string[]): Collector => body => collect(phase2Of(body));
  const noBound = onPhase2(collectNoBoundDefects);
  const didNotRun = onPhase2(collectDidNotRunDefects);
  const statusLines = onPhase2(collectStatusLineDefects);
  const exitOrder = onPhase2(collectExitLineOrderDefects);
  const scratch = onPhase2(collectCodeqlScratchDefects);
  const statusRule = onPhase2(collectStatusRuleDefects);
  const scannerRoot = onPhase2(collectScannerRootDefects);
  const fileNames = onPhase2(collectFileNameHandoffDefects);
  const snykScope = onPhase2(collectSnykScopeDefects);

  /** `body` with the one `from` replaced by `to`. A string must occur once and a RegExp must match once (`to` may use `$1`), so no seed is inert. */
  const seed = (body: string, from: string | RegExp, to: string): string => {
    if (typeof from !== 'string') {
      const matches = [...body.matchAll(new RegExp(from.source, from.flags.includes('g') ? from.flags : `${from.flags}g`))];
      expect(matches, `the seed ${from} must match exactly once`).toHaveLength(1);
    }
    const next = typeof from === 'string' ? seedOnce(body, from, to) : body.replace(from, to);
    expect(next, `the seed ${from} must change the text`).not.toBe(body);
    return next;
  };
  /** The defects `collect` reports for a copy of `body` seeded once; a known-bad probe never touches the committed tree. */
  const probe = (collect: Collector, body: string | null) => (from: string | RegExp, to: string): string[] => collect(seed(body ?? '', from, to));

  it.each(builds)('no scanner runs under a devflow time bound, and each stated Bash timeout is at most 600000 ms (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(noBound(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: a bound added back to a scanner or to Step 2c, or a lost or raised Bash timeout, is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(noBound, body);
    const carriesBound = expect.stringContaining('a Phase 2 command line carries a time bound');
    expect(defects('xargs -0 -r semgrep', '{bound} -k 10 280 xargs -0 -r semgrep')).toEqual(expect.arrayContaining([carriesBound, 'Phase 2 names a devflow time bound']));
    expect(defects('xargs -0 -r semgrep', 'timeout 280 xargs -0 -r semgrep')).toContainEqual(carriesBound);
    expect(defects('xargs -0 -r semgrep', 'xargs -0 -k 10 280 -r semgrep')).toContainEqual(carriesBound);
    expect(defects('S=$(snyk', 'S=$(gtimeout 280 snyk')).toEqual(expect.arrayContaining([carriesBound, 'Phase 2 names a devflow time bound']));
    expect(defects('codeql database analyze', 'timeout 280 codeql database analyze')).toContainEqual(carriesBound);
    expect(defects(`${STATUS_LOOP}\n`, `${STATUS_LOOP}\ncommand -v timeout || command -v gtimeout\n`)).toContainEqual(carriesBound);
    expect(defects('If some are available: note which tools will run.', 'If some are available: note which tools will run. `{bound}` is `timeout` or `gtimeout`.')).toContain('Phase 2 names a devflow time bound');
    expect(defects('Bash `timeout` at 600000', 'Bash `timeout` at 700000')).toContain('a stated Bash timeout is above 600000 ms');
    expect(defects('with the Bash `timeout` at 600000', 'with the Bash limit at 600000')).toContain('no stated Bash timeout above the scanner calls');
    expect(collectNoBoundDefects('')).toEqual(['0 scanner command lines, expected 4', 'no stated Bash timeout above the scanner calls']);
  });

  it.each(builds)('Step 2c prints one status line per tool and probes no bound, and no scanner installed stops Step 2d (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(didNotRun(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: a Step 2c fence that is not the status loop, or a lost or misplaced branch, is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(didNotRun, body);
    expect(defects(STATUS_LOOP, 'true')).toContain(STATUS_LOOP_DEFECT);
    expect(defects(`${STATUS_LOOP}\n`, `${STATUS_LOOP}\ncommand -v timeout || command -v gtimeout\n`)).toContain(STATUS_LOOP_DEFECT);
    expect(collectDidNotRunDefects('')).toContain('Step 2c has no bash fence');
    expect(defects('If some are available', 'If none are available')).toEqual(['Step 2c has no "If some are available" branch']);
    expect(defects('No static analysis tools found', 'Static analysis tools found')).toEqual(['Step 2c has no all-no branch warning']);
    expect(defects(/(If all three print[^\n]*\n\n)(If some are available[^\n]*)/, '$2\n\n$1')).toContain('the all-no branch does not come before the "If some are available" branch');
    expect(defects(NONE_ASSIGNMENT, '')).toContain('the all-no branch does not set STATIC_FINDINGS to (none)');
    expect(defects('or all tools unavailable', 'or none')).toContain(doesNotSay(DID_NOT_RUN_PARTS[0]));
  });

  it.each(builds)('each scanner prints one status line, and only a tool that completed reads as clean (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(statusLines(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: a lost or repeated exit line, an unread Snyk status or a lost status sentence is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(statusLines, body);
    expect(defects(SNYK_EXIT_LINE, '')).toContain('the scanner fences carry 1+0+1 exit lines, expected 1 each in 3 fences');
    expect(defects(SNYK_EXIT_LINE, `${SNYK_EXIT_LINE}${SNYK_EXIT_LINE}`)).toContain('the scanner fences carry 1+2+1 exit lines, expected 1 each in 3 fences');
    expect(collectStatusLineDefects('')).toContain('the scanner fences carry 0 exit lines, expected 1 each in 3 fences');
    expect(defects('); E=$?', '); true')).toContain('the Snyk status is not read right after the scanner');
    expect(defects('Snyk 0 or 1', 'Snyk 0, 1 or 2')).toContain(doesNotSay(STATUS_LINE_PARTS[0]));
    expect(defects('CodeQL 0. Any other status', 'CodeQL 0 or 1. Any other status')).toContain(doesNotSay(STATUS_LINE_PARTS[0]));
    expect(defects('or no such line', 'or an empty line')).toContain(doesNotSay(STATUS_LINE_PARTS[1]));
    expect(defects('only when every tool that was to run completed and none found anything', 'when none found anything')).toContain(doesNotSay(STATUS_LINE_PARTS[2]));
    expect(defects('Static analysis did not complete: {tool}', 'Static analysis failed: {tool}')).toContain(doesNotSay(STATUS_LINE_PARTS[3]));
    expect(defects("If a tool's output was clipped", 'If a tool output is long')).toContain(doesNotSay(STATUS_LINE_PARTS[4]));
  });

  it.each(builds)('each scanner prints its own status after its scanner line (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(exitOrder(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: an exit line that comes early or prints the wrong status is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(exitOrder, body);
    const semgrep = 'the Semgrep exit line does not follow its pipeline on the same line, printing "$?"';
    const semgrepExit = `; ${EXIT_PRINT}"$?"`;
    const semgrepStart = 'set -o pipefail; git diff --name-only -z --diff-filter=d';
    expect(probe(exitOrder, seed(body ?? '', semgrepExit, ''))(semgrepStart, `${EXIT_PRINT}"$?"; ${semgrepStart}`)).toContain(semgrep);
    expect(defects(semgrepExit, `; ${EXIT_PRINT}"$E"`)).toContain(semgrep);
    expect(defects('set -o pipefail; git diff', 'git diff')).toContain(semgrep);
    expect(defects(/(set -o pipefail; git diff[^|]*\| )(xargs[^;]*;)/, '$2 $1')).toContain(semgrep);
    const snyk = 'the Snyk exit line does not follow the scanner and the filter, printing "$E"';
    const withoutSnykExit = probe(exitOrder, seed(body ?? '', SNYK_EXIT_LINE, ''));
    expect(withoutSnykExit('S=$(snyk', `${SNYK_EXIT_LINE}S=$(snyk`)).toContain(snyk);
    expect(withoutSnykExit(`printf '%s' "$S" | jq`, `${SNYK_EXIT_LINE}printf '%s' "$S" | jq`)).toContain(snyk);
    expect(defects(SNYK_EXIT_LINE, `${EXIT_PRINT}"$?"\n`)).toContain(snyk);
    expect(defects('S=$(snyk', 'T=$(snyk')).toContain(snyk);
    const withoutFilter = probe(exitOrder, seed(seed(body ?? '', SNYK_EXIT_LINE, ''), /printf '%s' "\$S" \| jq[^\n]*\n[^\n]*\n[^\n]*\n/, ''));
    expect(withoutFilter('S=$(snyk', `${SNYK_EXIT_LINE}S=$(snyk`)).toContain(snyk);
    const codeql = 'the CodeQL exit line does not follow CODEQL_EXIT=$?, printing "$CODEQL_EXIT"';
    const codeqlExit = `${EXIT_PRINT}"$CODEQL_EXIT"`;
    expect(defects(codeqlExit, `${EXIT_PRINT}"$?"`)).toContain(codeql);
    expect(defects(`CODEQL_EXIT=$?\n${CODEQL_SARIF_PRINT}\n${codeqlExit}`, `${codeqlExit}\nCODEQL_EXIT=$?\n${CODEQL_SARIF_PRINT}`)).toContain(codeql);
  });

  it.each(builds)('known-bad probes: a CodeQL status read after another command is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(exitOrder, body);
    const late = 'the CodeQL status is not read on the line right after codeql database analyze';
    expect(defects(`CODEQL_EXIT=$?\n${CODEQL_SARIF_PRINT}`, `${CODEQL_SARIF_PRINT}\nCODEQL_EXIT=$?`)).toContain(late);
    expect(defects('CODEQL_EXIT=$?\n', 'rm -rf "${CODEQL_TMP}/db"\nCODEQL_EXIT=$?\n')).toContain(late);
    const unread = defects('CODEQL_EXIT=$?\n', '');
    expect(unread).toContain(late);
    expect(unread).toContain('the CodeQL exit line does not follow CODEQL_EXIT=$?, printing "$CODEQL_EXIT"');
    const noAnalyze = probe(exitOrder, seed(body ?? '', 'codeql database analyze', 'codeql database scan'));
    expect(noAnalyze('CODEQL_TMP=$(mktemp -d) || exit', 'CODEQL_EXIT=$?\nCODEQL_TMP=$(mktemp -d) || exit')).toContain(late);
    expect(collectExitLineOrderDefects('')).toContain(late);
  });

  it.each(builds)('a scanner that did not run or did not finish is named in the findings and the report (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(collectStaticReportDefects(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: a report that hides a scanner that did not run or finish is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(collectStaticReportDefects, body);
    const placed = 'the Static analysis line is not between Analysis and Risk Assessment';
    expect(defects('**Static analysis**:', '**Scanners**:')).toContain('the report has no Static analysis line');
    expect(defects('**Analysis**: {ANALYSIS_DIR}', '**Analysed**: {ANALYSIS_DIR}')).toContain(placed);
    expect(defects('### Risk Assessment', '### Risks')).toContain(placed);
    expect(defects(/(\*\*Analysis\*\*: \{ANALYSIS_DIR\}\n)(\*\*Static analysis\*\*:[^\n]*\n)/, '$2$1')).toContain(placed);
    expect(defects(/(\*\*Static analysis\*\*:[^\n]*\n)(\n### Risk Assessment[^\n]*\n)/, '$2$1')).toContain(placed);
    expect(defects('| A scanner did not run or did not complete |', '| A scanner fails |')).toContain('no edge-case row for a scanner that did not run or did not complete');
    expect(defects('(`(none)` only if', '(or `(none)` if')).toContain('the checklist does not limit (none) to a clean result');
    expect(collectStaticReportDefects('')).toContain('the report has no Static analysis line');
  });

  it.each(builds)('the per-tool outcome Phase 7 reports is declared by Step 2d and required by Phase 7 (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(collectOutcomeDeclarationDefects(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: an outcome that is not declared, not required or not named in the report is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(collectOutcomeDeclarationDefects, body);
    expect(defects('**Produces:** STATIC_FINDINGS, STATIC_STATUS', '**Produces:** STATIC_FINDINGS')).toContain(`Step 2d does not produce ${OUTCOME_VAR}`);
    expect(defects('**Requires:** BRANCH_INFO, ANALYSIS_DIR, STATIC_STATUS', '**Requires:** BRANCH_INFO, ANALYSIS_DIR')).toContain(`Phase 7 does not require ${OUTCOME_VAR}`);
    expect(defects('**Static analysis**: {STATIC_STATUS ', '**Static analysis**: {')).toContain(`the Static analysis line does not name ${OUTCOME_VAR}`);
    expect(defects('**Requires:** BRANCH_INFO, ANALYSIS_DIR, STATIC_STATUS', '**Requires:** BRANCH_INFO, ANALYSIS_DIR, STATIC_TOOL_STATUS')).toContain(`Phase 7 does not require ${OUTCOME_VAR}`);
    expect(collectOutcomeDeclarationDefects('')).toEqual([
      `Step 2d does not produce ${OUTCOME_VAR}`,
      `Phase 7 does not require ${OUTCOME_VAR}`,
      `the Static analysis line does not name ${OUTCOME_VAR}`,
    ]);
  });

  it.each(builds)('the scanners get file names safely (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(fileNames(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: a change in how file names reach a scanner is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(fileNames, body);
    const semgrepLine = 'the Semgrep line does not read names with -z, pass them with xargs -0 and put them after --';
    expect(defects('--name-only -z --diff-filter=d', '--name-only --diff-filter=d')).toContain(semgrepLine);
    expect(defects('set -o pipefail; ', '')).toContain(semgrepLine);
    expect(defects('-- 2>/dev/null', ' 2>/dev/null')).toContain(semgrepLine);
    expect(defects('xargs -0 -r semgrep', 'xargs -0 semgrep')).toContain(semgrepLine);
    const snykLine = 'the Snyk filter does not read the names from git as NUL-separated output';
    expect(defects(SNYK_NAME_LIST, '"$(echo "$CHANGED_FILES" | jq -R . | jq -s .)"'))
      .toEqual(expect.arrayContaining([snykLine, expect.stringContaining('a scanner line reads CHANGED_FILES')]));
    expect(defects(SNYK_NAME_LIST, '"$(git diff --name-only {DIFF_RANGE} | jq -Rs \'split("\\u0000")\')"')).toContain(snykLine);
    expect(defects(SNYK_NAME_LIST, '"$(git diff --name-only {DIFF_RANGE} | jq -R . | jq -s .)"')).toContain(snykLine);
    expect(defects('File names reach a scanner only through', 'File names reach a scanner through')).toContain('Phase 2 does not say how file names reach a scanner');
    expect(collectFileNameHandoffDefects('')).toContain('0 bash fences, expected at least 5');
  });

  it.each(builds)('--full always runs CodeQL: no sentence skips it or waits on Semgrep or Snyk completing (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(collectFullCodeqlDefects(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: a CodeQL skip, a completion wait or a lost --full gate is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(collectFullCodeqlDefects, body);
    expect(defects('findings)):', 'findings); if Semgrep or Snyk did not complete, report "CodeQL: skipped" and why):'))
      .toContain('the CodeQL gate line waits on another scanner completing, or skips CodeQL');
    expect(defects('if available AND (', 'if available AND Semgrep and Snyk completed AND ('))
      .toContain('the CodeQL gate line waits on another scanner completing, or skips CodeQL');
    expect(defects('(`--full` OR ', '(')).toContain('the CodeQL gate line does not run CodeQL whenever --full is set');
    expect(defects('| A scanner did not run or did not complete | Name the tool and why in `STATIC_FINDINGS`, not `(none)` |', '| CodeQL database creation fails | Skip CodeQL, note in output, continue with other tools |'))
      .toContain('a sentence skips CodeQL');
    expect(collectFullCodeqlDefects('')).toContain('0 CodeQL gate lines, expected 1');
  });

  it.each(builds)('CodeQL stops when its temp folder cannot be made (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(scratch(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: a CodeQL temp folder that can fail unchecked is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(scratch, body);
    expect(defects('CODEQL_TMP=$(mktemp -d) || exit', 'CODEQL_TMP=$(mktemp -d)')).toContain('the CodeQL fence does not stop when mktemp -d fails');
    expect(defects('CODEQL_TMP=$(mktemp -d) || exit', 'CODEQL_TMP=$(mktemp -d) || true')).toContain('the CodeQL fence does not stop when mktemp -d fails');
    expect(defects('CODEQL_TMP=$(mktemp -d) || exit', 'CODEQL_TMP=$(echo /tmp/codeql)')).toContain('the CodeQL fence does not make its temp folder with mktemp -d');
    expect(collectCodeqlScratchDefects('')).toContain('the CodeQL fence does not make its temp folder with mktemp -d');
  });

  it.each(builds)('the completion rule covers tools that ran, and the exit meanings end in a catch-all (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(statusRule(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: a lost status rule part is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(statusRule, body);
    expect(defects('a tool that ran completed', 'a tool completed')).toContain(doesNotSay(STATUS_RULE_PARTS[0]));
    expect(defects('; else failed. Semgrep via xargs: number only)', ')')).toContain(doesNotSay(STATUS_RULE_PARTS[1]));
    expect(defects('; else failed.', '.')).toContain(doesNotSay(STATUS_RULE_PARTS[1]));
    expect(defects('(126-127: scanner did not start', '(124: bound fired; 126-127: scanner did not start')).toContain(doesNotSay(STATUS_RULE_PARTS[1]));
    expect(defects('A call with no `exit=` line in its own result', 'A call with no `exit=` line')).toContain(doesNotSay(STATUS_RULE_PARTS[2]));
    expect(defects('in its own result did not complete', 'in a result did not complete')).toContain(doesNotSay(STATUS_RULE_PARTS[2]));
    expect(defects('ignore a later end notice', 'read a later end notice')).toContain(doesNotSay(STATUS_RULE_PARTS[3]));
    expect(defects('It stays did not complete for this run: ', '')).toContain(doesNotSay(STATUS_RULE_PARTS[3]));
  });

  it.each(builds)('the Snyk results are cut to the changed files, with an unfiltered fallback and a note (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(snykScope(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: a changed Snyk filter, a lost fallback or a lost note is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(snykScope, body);
    const filter = 'the Snyk filter does not keep only the results whose file is a changed file';
    const fallback = 'the line after the Snyk filter does not print the SARIF unfiltered when jq fails';
    expect(defects('.runs[].results |= map(select(', '.runs[].results |= map(select(true or (')).toContain(filter);
    expect(defects('$files | index($uri) != null', '$files | index($uri) == null')).toContain(filter);
    expect(defects('.runs[].results |= map(', '.runs[].results |= (')).toContain(filter);
    expect(defects(` || printf '%s' "$S"`, '')).toContain(fallback);
    expect(defects(` || printf '%s' "$S"`, ' || true')).toContain(fallback);
    expect(defects(`2>/dev/null || printf '%s' "$S"`, `2>/dev/null\\\nprintf '%s' "$S"`)).toContain(fallback);
    expect(defects(SNYK_UNFILTERED_NOTE, 'The SARIF may be unfiltered.')).toContain('Phase 2 does not say that the SARIF is unfiltered without jq');
    expect(defects('Without `jq`', 'Without it')).toContain('Phase 2 does not say that the SARIF is unfiltered without jq');
    expect(collectSnykScopeDefects('')).toHaveLength(3);
  });

  for (const [label, body] of builds) it(`the shipped Snyk filter keeps the findings for changed files, whatever the file name (${label})`, ctx => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const { names, scope } = shippedSnykPrograms(phase2Of(body ?? ''));
    if (spawnSync('jq', ['--version'], { encoding: 'utf8' }).status !== 0) {
      const reason = 'jq is not installed, so the shipped Snyk filter is not run';
      console.warn(`[bug-analysis structural] ${reason}`);
      ctx.skip(reason);
    }
    const sarifOf = (uris: string[]): string => JSON.stringify({ runs: [{ tool: { driver: { name: 'SnykCode' } }, results: uris.map(uri => ({ ruleId: 'rule', locations: [{ physicalLocation: { artifactLocation: { uri } } }] })) }] });
    const changed = ['src/café.ts', 'docs/日本語 notes.md', 'src/two words.ts', 'src/plain.ts'];
    const untouched = ['src/other.ts', 'src/café other.ts'];
    const nulSeparated = changed.map(name => `${name}\u0000`).join('');
    const list = spawnSync('jq', ['-Rs', names], { input: nulSeparated, encoding: 'utf8' });
    expect(list.status, list.stderr).toBe(0);
    const filtered = spawnSync('jq', ['--argjson', 'files', list.stdout, scope], { input: sarifOf([untouched[0], ...changed, untouched[1]]), encoding: 'utf8' });
    expect(filtered.status, filtered.stderr).toBe(0);
    const kept = (JSON.parse(filtered.stdout) as { runs: Array<{ results: Array<{ locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }> }> }).runs[0].results
      .map(result => result.locations[0].physicalLocation.artifactLocation.uri);
    expect(kept).toEqual(changed);
  });

  it.each(builds)('each scanner fence runs from the worktree root, not the Bash call directory (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    expect(scannerRoot(body ?? '')).toEqual([]);
  });

  it.each(builds)('known-bad probes: a scanner fence that can run from another directory is reported (%s)', (_label, body) => {
    expect(body, 'the build is absent: run `npm run build:mds`').not.toBeNull();
    const defects = probe(scannerRoot, body);
    const semgrep = 'the semgrep scan fence does not open with cd "{worktree}" || exit';
    expect(defects(`${SCANNER_ROOT_CD}\nset -o pipefail`, 'set -o pipefail')).toContain(semgrep);
    expect(defects(`${SCANNER_ROOT_CD}\nset -o pipefail`, 'cd "{worktree}"\nset -o pipefail')).toContain(semgrep);
    expect(defects(`${SCANNER_ROOT_CD}\nset -o pipefail`, 'cd . || exit\nset -o pipefail')).toContain(semgrep);
    const snyk = 'the snyk code test fence does not open with cd "{worktree}" || exit';
    expect(defects(`${SCANNER_ROOT_CD}\nS=$(`, 'S=$(')).toContain(snyk);
    expect(defects(`${SCANNER_ROOT_CD}\nS=$(`, 'cd "{worktree}" || true\nS=$(')).toContain(snyk);
    const codeql = 'the CodeQL fence neither opens with cd "{worktree}" || exit nor passes --source-root="{worktree}"';
    expect(defects(CODEQL_ROOT, '--source-root=.')).toContain(codeql);
    expect(defects(CODEQL_ROOT, '--source-root="$PWD"')).toContain(codeql);
    expect(collectScannerRootDefects('')).toHaveLength(3);
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

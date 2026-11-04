/**
 * Plan override checklist (AC2).
 *
 * devflow's plan.md overrides the Plan agent built into Claude Code, and two callers reach it: plan
 * mode (a free-form research request) and /plan Phase 10 (a request with its own report shape and
 * cap). The body is devflow's own text. This checklist pins the behaviours the plan spec gives it,
 * not the wording as a whole:
 *   - it is read-only, and an edit attempt fails because it holds no edit tool;
 *   - it names one rung of the minimum ladder for every step, lowest rung first;
 *   - it says a new package is rung 6 only if it is open source, widely used, well maintained, free of
 *     known vulnerabilities and light on dependencies, and must pass `devflow:dependency-research` before
 *     install, in a line that adds no rung and never says "load" (it holds no Skill tool and cannot vet
 *     a package at install time, so it needs the cues to decide whether a package is an option at all);
 *   - it never cuts the safety list, and keeps the tests of that list;
 *   - it plans no speculative case: that goes to "Known limits and deferrals";
 *   - the caller's report shape and cap win over its default.
 *
 * Where the body departs from the plan spec, the departure is pinned too: the search tools are Bash
 * commands, because an agent that holds Bash is not offered Grep or Glob (docs/reference/platform-
 * assumptions.md), so the frontmatter lists Read and Bash only, as Explore's does.
 *
 * Every arm runs through a named collector, and the known-bad probes feed the same collector a body
 * with one clause removed, so a collector that stopped seeing defects fails its own probe instead of
 * passing vacuously. The byte ceiling is in tests/guards/plan-group-sizes.test.ts; the shipped
 * frontmatter row is in tests/fixtures/agent-config.ts.
 */
import { describe, it, expect } from 'vitest';
import { resolveAgentSource, splitFrontmatter } from './helpers.js';

interface ChecklistRow {
  readonly behaviour: string;
  readonly carriedBy: RegExp;
}

const CHECKLIST: readonly ChecklistRow[] = [
  { behaviour: 'read-only: a contract section', carriedBy: /^## Read-Only Contract$/m },
  { behaviour: 'read-only: no creating, editing, deleting, moving or copying files', carriedBy: /You do not create, edit, delete, move or copy a file/ },
  { behaviour: 'read-only: no redirects into files', carriedBy: /redirect or pipe output into a file/ },
  { behaviour: 'read-only: no git writes, installs, builds or other state changes', carriedBy: /run a git write, install a package, run a build, or run any command that changes system state/ },
  { behaviour: 'read-only: an edit attempt fails (no edit tools)', carriedBy: /Read and Bash only, so an edit attempt fails/ },
  { behaviour: 'ladder: a section', carriedBy: /^## Minimum Ladder$/m },
  { behaviour: 'ladder: one rung named per step', carriedBy: /Name one rung for every step/ },
  { behaviour: 'ladder: the lowest rung that meets the acceptance criteria', carriedBy: /Take the lowest rung that meets the acceptance criteria/ },
  { behaviour: 'ladder: a new package is rung 6 only if it meets the cues, and passes dependency-research before install', carriedBy: /^6\. new code, the minimum\.\n\nNew package: rung 6, only if [^\n]*; else [^\n]*\. Must: pass `devflow:dependency-research` before install\.$/m },
  { behaviour: 'never cut: a section', carriedBy: /^## Never Cut$/m },
  { behaviour: 'never cut: input validation at trust boundaries', carriedBy: /input validation at trust boundaries/ },
  { behaviour: 'never cut: security checks', carriedBy: /security checks/ },
  { behaviour: 'never cut: data-loss and destructive-operation guards', carriedBy: /guards against data loss and destructive operations/ },
  { behaviour: 'never cut: fail-closed paths', carriedBy: /fail-closed paths/ },
  { behaviour: 'never cut: error handling that keeps data', carriedBy: /error handling that keeps data/ },
  { behaviour: 'never cut: output contracts', carriedBy: /output contracts/ },
  { behaviour: "never cut: the caller's stated requirements", carriedBy: /the caller's stated requirements/ },
  { behaviour: 'never cut: the tests of these', carriedBy: /or the tests of them/ },
  { behaviour: 'never cut: holds against the no-speculative-cases rule too', carriedBy: /The ladder and the no-speculative-cases rule never remove these/ },
  { behaviour: 'no speculative cases: a section', carriedBy: /^## No Speculative Cases$/m },
  { behaviour: 'no speculative cases: a concrete case or an ask', carriedBy: /needs a concrete case in the request or the code, or an ask from the caller/ },
  { behaviour: 'no speculative cases: the rest goes to Known limits and deferrals', carriedBy: /List it under Known limits and deferrals, with one reason/ },
  { behaviour: 'research: independent searches run as parallel tool calls', carriedBy: /parallel tool calls in one turn/ },
  { behaviour: 'research: content search through git grep -P', carriedBy: /`git grep -n -P --untracked/ },
  { behaviour: 'research: path search through git ls-files or find', carriedBy: /`git ls-files '<glob>'`[^\n]*`find <dir> -name '<glob>'`/ },
  { behaviour: 'research: follow the nearest existing code', carriedBy: /Read the code that does the nearest job before you plan new code, and plan to follow it/ },
  { behaviour: 'research: callers and consumers of everything a step changes', carriedBy: /Search for the callers and consumers of everything a step changes/ },
  { behaviour: 'input: earlier findings narrow the search', carriedBy: /Search only for what the findings leave open/ },
  { behaviour: 'report: a regular message, never a file', carriedBy: /Reply with a regular message\. Never write the report to a file\./ },
  { behaviour: 'report: the caller\'s shape and cap win', carriedBy: /The shape and cap that the prompt gives win/ },
  { behaviour: 'report: steps with files, callers and consumers, Must lines and the rung', carriedBy: /the files to change, the callers and consumers to update, the `Must` lines[^\n]*, and the rung/ },
  { behaviour: 'report: critical files as absolute paths', carriedBy: /Critical files, as absolute paths/ },
  { behaviour: 'report: known limits and deferrals, each with one reason', carriedBy: /Known limits and deferrals, each with one reason/ },
  { behaviour: 'report: a closing cap line', carriedBy: /^Report cap: final message at most about 1,500 tokens;/m },
];

/** The six rungs of the ladder, lowest first, as the numbered list names them. */
const RUNGS: readonly string[] = [
  'not needed: the goal already holds',
  'reuse existing code',
  'the standard library',
  'a dependency that is already installed',
  'a one-line change',
  'new code, the minimum',
];

/** Named collector: the checklist rows the body does not carry. */
function collectChecklistGaps(body: string): string[] {
  return CHECKLIST.filter(row => !row.carriedBy.test(body)).map(row => row.behaviour);
}

/** Named collector: how the ladder list departs from the six rungs, in order, numbered 1 to 6. */
function collectLadderDefects(body: string): string[] {
  const section = /^## Minimum Ladder\n([\s\S]*?)(?=\n## )/m.exec(body)?.[1] ?? '';
  const items = [...section.matchAll(/^(\d+)\. ([^\n;.]+)[;.]$/gm)].map(match => ({ n: Number(match[1]), text: match[2] }));
  const defects: string[] = [];
  if (items.length !== RUNGS.length) defects.push(`the ladder lists ${items.length} rungs, expected ${RUNGS.length}`);
  RUNGS.forEach((rung, index) => {
    const item = items[index];
    if (item === undefined || item.text !== rung || item.n !== index + 1) {
      defects.push(`rung ${index + 1} is not "${rung}"`);
    }
  });
  return defects;
}

/**
 * The cues that decide whether a package is an option at all, each as the name a defect reports and the
 * pattern that carries it. The agent holds no Skill tool, so the vetting at install time comes too late
 * to keep a poorly maintained, little used or heavy package out of the plan.
 */
const NEW_PACKAGE_CUES: ReadonlyArray<readonly [string, RegExp]> = [
  ['the gate (only if)', /rung 6, only if /],
  ['open source', /\bopen source\b/],
  ['widely used', /\bwidely used\b/],
  ['well maintained', /\bwell maintained\b/],
  ['free of known vulnerabilities', /\bfree of known vulnerabilities\b/],
  ['light on dependencies', /\blight on dependencies\b/],
  ['the fallback (else the minimum code)', /; else [^\n]*minimum code\./],
];

/**
 * Named collector: how the new-package line departs from its shape. It is one line, it gives every cue, it names
 * the skill, and it never says "load": the agent holds no Skill tool, so it can pass the skill's name on, not load it.
 */
function collectNewPackageLineDefects(body: string): string[] {
  const lines = body.split('\n').filter(line => line.startsWith('New package:'));
  if (lines.length !== 1) return [`the body has ${lines.length} new-package lines, expected 1`];
  const defects: string[] = [];
  for (const [name, pattern] of NEW_PACKAGE_CUES) {
    if (!pattern.test(lines[0])) defects.push(`the new-package line lacks the cue "${name}"`);
  }
  if (!lines[0].includes('`devflow:dependency-research`')) defects.push('the new-package line does not name devflow:dependency-research');
  if (/\b[Ll]oad\b/.test(lines[0])) defects.push('the new-package line says "load"');
  return defects;
}

/** Named collector: how the body falls short of naming only the tools the agent really has. */
function collectToolNameDefects(body: string): string[] {
  return /\b(?:Grep|Glob|Write|Edit)\b/.test(body)
    ? ['the body names a tool the agent is not offered (Grep, Glob, Write or Edit)']
    : [];
}

const plan = resolveAgentSource('plan');
const split = splitFrontmatter(plan.content);
const body = split?.body ?? '';
const frontmatter = split?.inner ?? '';

describe('the Plan override keeps what the plan spec gives it (AC2)', () => {
  it('carries every row of the checklist', () => {
    expect(split, 'plan.md has a frontmatter block').not.toBeNull();
    expect(collectChecklistGaps(body)).toEqual([]);
  });

  it('known-bad probes: removing any one clause is reported by name', () => {
    expect(collectChecklistGaps(body)).toEqual([]);
    for (const row of CHECKLIST) {
      const probe = body.replace(row.carriedBy, '');
      expect(probe, `the seed for "${row.behaviour}" must land`).not.toBe(body);
      expect(collectChecklistGaps(probe), row.behaviour).toContain(row.behaviour);
    }
  });

  it('lists the six rungs of the ladder in order, lowest first', () => {
    expect(collectLadderDefects(body)).toEqual([]);
    expect(collectLadderDefects(body.replace('2. reuse existing code;\n', ''))).toContain('the ladder lists 5 rungs, expected 6');
    expect(collectLadderDefects(body.replace('3. the standard library;', '3. a new framework;'))).toEqual(['rung 3 is not "the standard library"']);
    expect(collectLadderDefects(body.replace('5. a one-line change;', '4. a one-line change;'))).toContain('rung 5 is not "a one-line change"');
  });

  it('gives the cues that decide whether a package is an option at all, and reports a ladder line without them', () => {
    expect(collectNewPackageLineDefects(body)).toEqual([]);
    for (const [name, pattern] of NEW_PACKAGE_CUES) {
      const probe = body.replace(pattern, '');
      expect(probe, `the seed for "${name}" must land`).not.toBe(body);
      expect(collectNewPackageLineDefects(probe), name).toEqual([`the new-package line lacks the cue "${name}"`]);
    }
    const bare = body.replace(/^New package: [^\n]*$/m, 'New package: rung 6; Must: pass `devflow:dependency-research` before install.');
    expect(bare, 'the seed must land').not.toBe(body);
    expect(collectNewPackageLineDefects(bare)).toEqual(NEW_PACKAGE_CUES.map(([name]) => `the new-package line lacks the cue "${name}"`));
    expect(collectChecklistGaps(bare)).toEqual(['ladder: a new package is rung 6 only if it meets the cues, and passes dependency-research before install']);
  });

  it('names dependency-research for a new package, adds no rung, and never says "load"', () => {
    expect(collectNewPackageLineDefects(body)).toEqual([]);
    expect(collectLadderDefects(body), 'the new-package line leaves the ladder at six rungs').toEqual([]);
    const seventh = body.replace(/^New package: [^\n]*$/m, '7. New package: rung 6.');
    expect(seventh, 'the seed must land').not.toBe(body);
    expect(collectLadderDefects(seventh)).toContain('the ladder lists 7 rungs, expected 6');
    const loading = body.replace('Must: pass `devflow', 'Must: load `devflow');
    expect(loading, 'the seed must land').not.toBe(body);
    expect(collectNewPackageLineDefects(loading)).toEqual(['the new-package line says "load"']);
    expect(collectNewPackageLineDefects(body.replace('dependency-research', 'dependency-check'))).toEqual(['the new-package line does not name devflow:dependency-research']);
    expect(collectNewPackageLineDefects(body.replace(/^New package: [^\n]*\n/m, ''))).toEqual(['the body has 0 new-package lines, expected 1']);
    expect(collectNewPackageLineDefects(`${body}\nNew package: again.`)).toEqual(['the body has 2 new-package lines, expected 1']);
  });

  it('names no search or write tool the agent does not hold (it searches through Bash commands)', () => {
    expect(collectToolNameDefects(body)).toEqual([]);
    expect(collectToolNameDefects(`${body}\nUse the Grep tool.`)).toHaveLength(1);
    expect(collectToolNameDefects(`${body}\nUse Glob for paths.`)).toHaveLength(1);
    expect(collectToolNameDefects(`${body}\nUse Edit to change it.`)).toHaveLength(1);
  });

  it('allows exactly one file: the mktemp report overflow', () => {
    const mentions = body.match(/mktemp/g) ?? [];
    expect(mentions.length).toBe(2);
    expect(body).toMatch(/That is the only file you may create\./);
    expect(body).toMatch(/The one allowance is report overflow/);
  });

  it('ships the frontmatter that makes it a drop-in override: the built-in\'s name, read-only tools, no CLAUDE.md', () => {
    expect(frontmatter).toMatch(/^name: Plan$/m);
    expect(frontmatter).toMatch(/^model: opus$/m);
    expect(frontmatter).toMatch(/^effort: high$/m);
    expect(frontmatter).toMatch(/^omitClaudeMd: true$/m);
    expect(frontmatter).toMatch(/^tools:\n {2}- Read\n {2}- Bash$/m);
    expect(frontmatter, 'a planning agent preloads no skill').not.toMatch(/^skills:/m);
    expect(frontmatter, 'an allowlist, never a denylist').not.toMatch(/^disallowedTools:/m);
  });

  it('describes itself for both callers: plan mode research and /plan Phase 10', () => {
    const description = /^description: "(.*)"$/m.exec(frontmatter)?.[1] ?? '';
    expect(description).toMatch(/^Planner for a change that needs research first\./);
    expect(description).toMatch(/It never edits\./);
    expect(description).toMatch(/The caller sets the report shape and length\./);
    expect(description).toMatch(/steps with files, callers to update and checks/);
  });

  it('stays small: it is billed on every spawn, and /plan runs three of them', () => {
    expect(Buffer.byteLength(plan.content, 'utf-8')).toBeLessThanOrEqual(3_500);
  });
});

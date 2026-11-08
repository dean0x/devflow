/**
 * Explore parity checklist (AC-304).
 *
 * devflow's explore.md overrides the Explore agent built into Claude Code, so the
 * rewrite must keep what the built-in promises its callers. Each row below is one
 * behaviour of the built-in (read from the 2.1.296 binary: its read-only mode block,
 * its breadth levels, its tool guidance and its closing instructions) and the phrase
 * in the rewrite that carries it. The rewrite is not a copy, so the checklist pins
 * the behaviours, not the wording.
 *
 * Where the rewrite deliberately departs, the departure is pinned here too:
 *   - the search tools are Bash commands (`git grep -P`, `find`), because an agent
 *     that holds Bash is not offered Grep or Glob;
 *   - the report-cap line the roster guard requires admits one `mktemp` overflow file,
 *     the single exception to "creates no file".
 *
 * The agent holds Read and Bash only, so it writes no report file to a path a caller passes:
 * /plan takes its reply as text.
 *
 * Every arm runs through a named collector, and the known-bad probes feed the same
 * collector a body with one clause removed, so a collector that stopped seeing
 * defects fails its own probe instead of passing vacuously.
 */
import { describe, it, expect } from 'vitest';
import { resolveAgentSource, splitFrontmatter } from './helpers.js';

interface ParityRow {
  readonly behaviour: string;
  readonly carriedBy: RegExp;
}

const PARITY: readonly ParityRow[] = [
  { behaviour: 'read-only: a contract section', carriedBy: /^## Read-Only Contract$/m },
  { behaviour: 'read-only: no creating, editing, deleting, moving or copying files', carriedBy: /do not:\n- create, edit, delete, move or copy a file/ },
  { behaviour: 'read-only: no redirects, pipes, heredocs or tee into files', carriedBy: /^- redirect or pipe output into a file, or write one with a heredoc or `tee`;$/m },
  { behaviour: 'read-only: no git writes, installs or other state changes', carriedBy: /git write \(`add`, `commit`[^)]*\), install a package, run a build, or run any command that changes system state/ },
  { behaviour: 'read-only: an edit attempt fails (no edit tools)', carriedBy: /Read and Bash only, so an edit attempt fails/ },
  { behaviour: 'thoroughness: quick', carriedBy: /\*\*quick\*\*: one targeted lookup/ },
  { behaviour: 'thoroughness: medium', carriedBy: /\*\*medium\*\*: moderate exploration/ },
  { behaviour: 'thoroughness: very thorough', carriedBy: /\*\*very thorough\*\*: sweep multiple locations and naming conventions/ },
  { behaviour: 'thoroughness: follows the level the caller names, medium by default', carriedBy: /breadth the caller names; with none, use medium/ },
  { behaviour: 'speed: independent searches run as parallel tool calls', carriedBy: /parallel tool calls in one turn/ },
  { behaviour: 'report: a regular message, never a file', carriedBy: /Reply with a regular message\. Never write the report to a file\./ },
  { behaviour: 'report: absolute file paths', carriedBy: /absolute file paths/ },
  { behaviour: 'report: a closing cap line', carriedBy: /^Report cap: final message at most about 1,500 tokens;/m },
  { behaviour: 'search plumbing: content search through git grep -P', carriedBy: /`git grep -n -P --untracked/ },
  { behaviour: 'search plumbing: path search through git ls-files or find', carriedBy: /`git ls-files '<glob>'`[^\n]*`find <dir> -name '<glob>'`/ },
  { behaviour: 'search plumbing: read with offset and limit', carriedBy: /Read with `offset` and `limit`/ },
];

/** Named collector: the checklist rows the body does not carry. */
function collectParityGaps(body: string): string[] {
  return PARITY.filter(row => !row.carriedBy.test(body)).map(row => row.behaviour);
}

/** Named collector: how the body falls short of naming only the tools the agent really has. */
function collectToolNameDefects(body: string): string[] {
  const defects: string[] = [];
  if (/\b(?:Grep|Glob|Write|Edit)\b/.test(body)) {
    defects.push('the body names a tool the agent is not offered (Grep, Glob, Write or Edit)');
  }
  return defects;
}

/** Named collector: the report-path rules the body carries although the agent holds no Write tool. */
function collectReportPathResidue(body: string): string[] {
  return ['REPORT_PATH', 'plan-files.cjs'].filter(word => body.includes(word)).map(word => `the body names ${word}`);
}

const explore = resolveAgentSource('explore');
const split = splitFrontmatter(explore.content);
const body = split?.body ?? '';
const frontmatter = split?.inner ?? '';

describe('the Explore override keeps the built-in\'s behaviours (AC-304)', () => {
  it('carries every row of the parity checklist', () => {
    expect(split, 'explore.md has a frontmatter block').not.toBeNull();
    expect(collectParityGaps(body)).toEqual([]);
  });

  it('known-bad probes: removing any one clause is reported by name', () => {
    expect(collectParityGaps(body)).toEqual([]);
    for (const row of PARITY) {
      const probe = body.replace(row.carriedBy, '');
      expect(probe, `the seed for "${row.behaviour}" must land`).not.toBe(body);
      expect(collectParityGaps(probe), row.behaviour).toContain(row.behaviour);
    }
  });

  it('names no search or write tool the agent does not hold (it searches through Bash commands)', () => {
    expect(collectToolNameDefects(body)).toEqual([]);
    expect(collectToolNameDefects(`${body}\nUse the Grep tool.`)).toHaveLength(1);
    expect(collectToolNameDefects(`${body}\nUse Glob for paths.`)).toHaveLength(1);
    expect(collectToolNameDefects(`${body}\nUse the Edit tool.`)).toHaveLength(1);
    expect(collectToolNameDefects(`${body}\nUse the Write tool for notes.`)).toHaveLength(1);
  });

  it('allows exactly one file: the mktemp report overflow', () => {
    const mentions = body.match(/mktemp/g) ?? [];
    expect(mentions.length).toBe(2);
    expect(body).toMatch(/The overflow `mktemp` file is the only file you may create\./);
    expect(body).toMatch(/The one allowance is report overflow/);
  });

  it('takes no REPORT_PATH and runs no plan-files check, so /plan takes its reply as text', () => {
    expect(collectReportPathResidue(body)).toEqual([]);
    expect(collectReportPathResidue(`${body}\n- **REPORT_PATH** (optional): write it there.`)).toEqual(['the body names REPORT_PATH']);
    expect(collectReportPathResidue(`${body}\nRun plan-files.cjs check.`)).toEqual(['the body names plan-files.cjs']);
  });

  it('ships the frontmatter that makes it a drop-in override: the built-in\'s name, read-only tools, no CLAUDE.md', () => {
    expect(frontmatter).toMatch(/^name: Explore$/m);
    expect(frontmatter).toMatch(/^model: sonnet$/m);
    expect(frontmatter).toMatch(/^effort: high$/m);
    expect(frontmatter).toMatch(/^omitClaudeMd: true$/m);
    const tools = [...(/^tools:\n((?: {2}- .+\n?)+)/m.exec(frontmatter)?.[1] ?? '').matchAll(/^ {2}- (.+)$/gm)].map(m => m[1]);
    expect(tools, 'Read and Bash only: no Write, no Edit').toEqual(['Read', 'Bash']);
    expect(frontmatter, 'a search agent preloads no skill').not.toMatch(/^skills:/m);
    expect(frontmatter, 'an allowlist, never a denylist').not.toMatch(/^disallowedTools:/m);
  });

  it('keeps the built-in\'s caller-facing description: breadth levels and the locate-not-review limit', () => {
    const description = /^description: "(.*)"$/m.exec(frontmatter)?.[1] ?? '';
    expect(description).toMatch(/^Read-only search agent/);
    expect(description).toMatch(/locates code; it does not review or audit it/);
    for (const level of ['quick', 'medium', 'very thorough']) expect(description).toContain(level);
  });

  it('stays small: it is billed on every spawn, and plan runs eight of them', () => {
    expect(Buffer.byteLength(explore.content, 'utf-8')).toBeLessThanOrEqual(3_500);
  });
});

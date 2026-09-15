/**
 * provider-scope — Phase 2 is GitHub-only, and says so mechanically (P2-S15, AC-2.7).
 *
 * Four negatives, all from §14.5's standing prohibitions and AC-2.7's amended
 * positive form. Each is a NAMED collector with a known-bad probe that drives it.
 *
 *   1. No Jira/Linear literal outside the ONE allowlisted site.
 *   2. No `mcp__` / vendor tool literal, and no user-facing "MCP", in anything a
 *      Git spawn can load.
 *   3. The Git agent declares no `tools:` frontmatter key.
 *   4. `_mcp.md` does not exist after a GitHub-only build and is named from no
 *      generated GitHub mechanics file.
 *
 * SCOPE, and why it is a scope rather than a cleverer regex
 * --------------------------------------------------------
 * `linear` is an ordinary English and CSS word: `linear-gradient`, `linear search`,
 * `'linear' | 'exponential'`, "Linear Types Can Change the World!" all appear under
 * `src/assets/skills/`. A regex that tried to tell the tracker name from the
 * adjective would be a guess; a scope does not have to guess. PROVIDER_SCAN_ROOTS is
 * therefore the tracker surface — everything Phase 2 authors or generates, plus
 * everything a Git spawn can load — and nothing else. Widening it later is the
 * correct response to a literal appearing outside it; loosening the token is not.
 *
 * Foreign provider NAMES are legal in tests (the overlay suite stages a
 * fixture-only provider directory to prove PF-009 isolation); `tests/` is outside
 * the scan by construction.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { agentsDir, commandsDir, compiledAgentsDir, compiledSkillRefsDir, skillsDir } from '../../src/core/assets.js';
import { TRACKER_GITHUB_OPS } from '../../src/core/mds-variants.js';
import { resolveAgentSource, splitFrontmatter, walkFiles, ROOT, type CorpusEntry } from '../helpers.js';

const DIST_COMMANDS = path.join(ROOT, 'dist', 'commands');
const DIST_SKILLS = path.join(ROOT, 'dist', 'skills');
const REFS_DIR = compiledSkillRefsDir();

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

interface ScanRoot {
  readonly label: string;
  readonly dir: string;
  readonly exts: readonly string[];
}

/** Label of the hand-authored agent tree. Composed, never spelled with its slash. */
const SRC_AGENTS_LABEL = 'src/assets/agents';
const GIT_HOST = `${SRC_AGENTS_LABEL}/git.mds`;

const PROVIDER_SCAN_ROOTS: readonly ScanRoot[] = [
  { label: SRC_AGENTS_LABEL, dir: agentsDir(ROOT), exts: ['.md', '.mds'] },
  { label: 'src/assets/mds', dir: path.join(ROOT, 'src', 'assets', 'mds'), exts: ['.mds'] },
  { label: 'src/assets/commands', dir: commandsDir(), exts: ['.md', '.mds'] },
  { label: 'src/assets/skills/git', dir: path.join(skillsDir(), 'git'), exts: ['.md'] },
  { label: 'dist/agents', dir: compiledAgentsDir(ROOT), exts: ['.md'] },
  { label: 'dist/commands', dir: DIST_COMMANDS, exts: ['.md'] },
  { label: 'dist/skills', dir: DIST_SKILLS, exts: ['.md'] },
];

function scanCorpus(): CorpusEntry[] {
  const corpus: CorpusEntry[] = [];
  for (const root of PROVIDER_SCAN_ROOTS) {
    for (const file of walkFiles(root.dir, f => root.exts.some(e => f.endsWith(e)))) {
      corpus.push({
        path: `${root.label}/${path.relative(root.dir, file)}`,
        content: readFileSync(file, 'utf-8'),
      });
    }
  }
  return corpus;
}

// ---------------------------------------------------------------------------
// 1. Jira / Linear literals — one allowlisted site, named
// ---------------------------------------------------------------------------

/**
 * `PROVIDER_MAP_ALLOWLIST` — the provider-resolution preamble, and nothing else.
 *
 * P2-S3's rationale, restated so the allowlist is legible without the artifact:
 * PF-023 requires exactly ONE convergence point where a provider token is turned
 * into a path. The preamble IS that point, and it can only be a convergence point
 * if it enumerates the closed token set — a map with one row would be a map that
 * decides nothing. The three tokens therefore have to be written here in Phase 2,
 * and Phase 3 fills the two directories the map already names rather than adding a
 * second place where a provider is resolved.
 *
 * The allowlisted region is the block, not a line: the token set appears three
 * times inside it (the normalisation rule, the map rows, the input contract), and
 * a line-scoped allowlist would have to enumerate them and go stale on any rewrap.
 */
const PROVIDER_MAP_ALLOWLIST = {
  files: [GIT_HOST, 'dist/agents/git.md'],
  /** The preamble's own bounds — the same two anchors byte-budget.test.ts uses. */
  from: '## Tracker provider resolution',
  to: '## Comment-sink scrub (D11)',
} as const;

interface ProviderToken {
  readonly name: string;
  readonly pattern: RegExp;
}

const FOREIGN_PROVIDER_TOKENS: readonly ProviderToken[] = [
  { name: 'jira', pattern: /\bjira\b/i },
  { name: 'linear', pattern: /\blinear\b/i },
];

/** Remove the allowlisted preamble block from an allowlisted file; identity elsewhere. */
function stripAllowlistedRegion(entry: CorpusEntry): string {
  if (!PROVIDER_MAP_ALLOWLIST.files.includes(entry.path as never)) return entry.content;
  const start = entry.content.indexOf(PROVIDER_MAP_ALLOWLIST.from);
  if (start === -1) return entry.content;
  const end = entry.content.indexOf(PROVIDER_MAP_ALLOWLIST.to, start);
  return end === -1
    ? entry.content.slice(0, start)
    : entry.content.slice(0, start) + entry.content.slice(end);
}

/** Named collector: foreign-provider literals outside the allowlisted preamble. */
export function collectForeignProviderLiterals(corpus: CorpusEntry[]): string[] {
  const violations: string[] = [];
  for (const entry of corpus) {
    const text = stripAllowlistedRegion(entry);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const token of FOREIGN_PROVIDER_TOKENS) {
        if (token.pattern.test(lines[i])) {
          violations.push(`${entry.path}: "${token.name}" — ${lines[i].trim().slice(0, 90)}`);
        }
      }
    }
  }
  return violations;
}

describe('provider-scope: no Jira or Linear literal outside the provider map (§14.5, AC-2.7)', () => {
  const corpus = scanCorpus();

  it('the scan covers every root and is non-vacuous', () => {
    expect(
      corpus.length,
      'the provider scan corpus is empty — run `npm run build`; a guard over nothing forbids nothing',
    ).toBeGreaterThan(0);
    for (const root of PROVIDER_SCAN_ROOTS) {
      expect(
        corpus.some(e => e.path.startsWith(`${root.label}/`)),
        `scan root "${root.label}" contributed no files — the scope has silently shrunk`,
      ).toBe(true);
    }
    // The two files that carry the allowlisted block must actually be in the corpus,
    // or the allowlist is silencing nothing and the guard is proving nothing about it.
    for (const file of PROVIDER_MAP_ALLOWLIST.files) {
      expect(corpus.map(e => e.path), `allowlisted file ${file} must be in the corpus`).toContain(file);
    }
  });

  it('the allowlist is still needed: the preamble really does carry the token set', () => {
    // A stale allowlist is the failure mode the inline-body exclusion list taught —
    // an exemption nobody notices going out of date. If the map ever stops naming
    // the foreign tokens, this fails and the allowlist is deleted, not carried.
    for (const file of PROVIDER_MAP_ALLOWLIST.files) {
      const entry = corpus.find(e => e.path === file);
      expect(entry, `${file} missing from corpus`).toBeDefined();
      const whole = entry!.content;
      const stripped = stripAllowlistedRegion(entry!);
      expect(
        stripped.length,
        `${file}: the allowlisted region was not found — the preamble anchors changed`,
      ).toBeLessThan(whole.length);
      for (const token of FOREIGN_PROVIDER_TOKENS) {
        expect(
          token.pattern.test(whole) && !token.pattern.test(stripped),
          `${file}: "${token.name}" is no longer confined to the provider map — either it moved ` +
          `(a second convergence point, PF-023) or the map dropped it and the allowlist is stale`,
        ).toBe(true);
      }
    }
  });

  it('no foreign provider literal appears anywhere else on the tracker surface', () => {
    const violations = collectForeignProviderLiterals(corpus);
    expect(
      violations,
      `Phase 2 is GitHub-only. A Jira or Linear literal outside the provider map is either a ` +
      `second resolution site or Phase-3 work landing early (ADR-003: nothing exists solely for ` +
      `a later phase):\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: a seeded foreign literal is reported by the same collector', () => {
    const seeded: CorpusEntry[] = [
      { path: 'src/assets/mds/tracker/_seed.mds', content: '@define jira_fetch()\nFetch the Jira issue.\n@end\n' },
      { path: 'dist/commands/seed.md', content: 'Pick a Linear team before planning.\n' },
    ];
    expect(collectForeignProviderLiterals(seeded).map(v => v.split(':')[0])).toEqual([
      'src/assets/mds/tracker/_seed.mds',
      'dist/commands/seed.md',
    ]);
  });

  it('known-bad probe: the allowlist silences its own block and nothing beyond it', () => {
    const seeded: CorpusEntry = {
      path: 'dist/agents/git.md',
      content: [
        'Before the preamble: nothing foreign here.',
        PROVIDER_MAP_ALLOWLIST.from,
        '| `jira` | `tracker/jira/` |',
        '| `linear` | `tracker/linear/` |',
        PROVIDER_MAP_ALLOWLIST.to,
        'After the preamble, load the jira mechanics.',
      ].join('\n'),
    };
    expect(collectForeignProviderLiterals([seeded])).toEqual([
      'dist/agents/git.md: "jira" — After the preamble, load the jira mechanics.',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. No vendor tool literal, and no user-facing "MCP"
// ---------------------------------------------------------------------------

interface VendorToken {
  readonly name: string;
  readonly pattern: RegExp;
  readonly justification: string;
}

const VENDOR_TOKENS: readonly VendorToken[] = [
  {
    name: 'mcp__ tool literal',
    pattern: /\bmcp__/,
    justification:
      'A mechanics file naming a concrete MCP tool binds the contract to one transport. The ' +
      'capability matrix is what a reference may name; the tool that implements it is not.',
  },
  {
    name: 'user-facing "MCP"',
    pattern: /\bMCP\b/,
    justification:
      '§14.5: "MCP" stays out of user-facing text so transport does not leak into it. Everything ' +
      'in this corpus is prompt text a user or an agent reads.',
  },
];

/**
 * The vendor scan is narrower than the provider scan: the GIT SPAWN SURFACE only.
 *
 * §14.5's rule is about the tracker. `src/assets/agents/test.md` legitimately
 * declares Chrome MCP tools in its `tools:` frontmatter and names them in its
 * scenario table — that is a platform capability of a different agent, not tracker
 * transport, and a guard that reported it would be asking the QA agent to stop
 * naming the tools it is allowed to call. The whole-directory root is therefore
 * replaced here by the Git agent alone.
 */
const VENDOR_SCAN_ROOTS: readonly ScanRoot[] = PROVIDER_SCAN_ROOTS.filter(
  r => r.label !== SRC_AGENTS_LABEL,
);

function vendorCorpus(): CorpusEntry[] {
  const corpus = scanCorpus().filter(e => VENDOR_SCAN_ROOTS.some(r => e.path.startsWith(`${r.label}/`)));
  const gitSource = path.join(agentsDir(ROOT), 'git.mds');
  corpus.push({ path: GIT_HOST, content: readFileSync(gitSource, 'utf-8') });
  return corpus;
}

/** Named collector: vendor/transport literals in loadable prompt text. */
export function collectVendorTokens(corpus: CorpusEntry[]): string[] {
  const violations: string[] = [];
  for (const entry of corpus) {
    for (const token of VENDOR_TOKENS) {
      for (const line of entry.content.split('\n')) {
        if (token.pattern.test(line)) {
          violations.push(`${entry.path}: ${token.name} — ${line.trim().slice(0, 90)}`);
        }
      }
    }
  }
  return violations;
}

describe('provider-scope: no vendor tool literal in loadable text (§14.5)', () => {
  it('the Git spawn surface names no MCP tool and no transport', () => {
    const corpus = vendorCorpus();
    expect(corpus.length, 'empty corpus').toBeGreaterThan(0);
    for (const root of VENDOR_SCAN_ROOTS) {
      expect(
        corpus.some(e => e.path.startsWith(`${root.label}/`)),
        `vendor scan root "${root.label}" contributed no files`,
      ).toBe(true);
    }
    expect(
      corpus.map(e => e.path),
      'the Git generator host must be scanned — it is the source the compiled agent comes from',
    ).toContain(GIT_HOST);
    const violations = collectVendorTokens(corpus);
    expect(violations, `vendor/transport literals:\n  ${violations.join('\n  ')}`).toEqual([]);
  });

  it('known-bad probe: both vendor tokens are reported by the same collector', () => {
    const seeded: CorpusEntry[] = [
      { path: 'dist/skills/git/references/tracker/github/seed.md', content: 'Call `mcp__tracker__create_issue`.\n' },
      { path: 'dist/commands/seed.md', content: 'Requires the MCP server to be connected.\n' },
    ];
    expect(collectVendorTokens(seeded).map(v => v.split(' — ')[0])).toEqual([
      'dist/skills/git/references/tracker/github/seed.md: mcp__ tool literal',
      'dist/commands/seed.md: user-facing "MCP"',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. The Git agent declares no `tools:` key
// ---------------------------------------------------------------------------

/**
 * Named collector: the top-level keys declared in a frontmatter block's inner text.
 *
 * Extracted from the assertion below so the guard and its known-bad probe share
 * one extractor. Inline, the negative `.not.toContain('tools')` was green whether
 * the key was truly absent or the extractor had stopped returning keys at all —
 * a regex typo would have read as a pass (ADR-024).
 *
 * Only column-0 keys count: an indented `tools:` is a nested value, not a
 * declaration, and YAML list items never reach column 0.
 */
function collectFrontmatterKeys(inner: string): string[] {
  return inner
    .split('\n')
    .map(l => /^([A-Za-z_][\w-]*):/.exec(l)?.[1])
    .filter((k): k is string => k !== undefined);
}

describe('provider-scope: the compiled Git agent declares no tools: key', () => {
  it('git.md frontmatter carries no tools: allowlist', () => {
    const git = resolveAgentSource('git');
    const split = splitFrontmatter(git.content);
    expect(split, `${git.path}: no frontmatter block at offset 0`).not.toBeNull();
    const keys = collectFrontmatterKeys(split!.inner);
    expect(keys.length, 'frontmatter parsed to no keys — the shape changed').toBeGreaterThan(0);
    expect(
      keys,
      'a tools: allowlist on the Git agent is a silent constraint on HOW it can act (PF-031): the ' +
      'op bodies instruct Bash and Read, and a frontmatter allowlist that omits either fails at ' +
      'runtime rather than at build time',
    ).not.toContain('tools');
  });

  it('known-bad probe: the same extractor reports a seeded tools: key', () => {
    // Drives a synthetic frontmatter through the extractor the assertion uses.
    // Without this, the negative above cannot distinguish "no tools: key" from
    // "the extractor returns nothing".
    const seeded = 'name: Git\ndescription: seeded probe\nmodel: haiku\ntools: Read, Bash\n';
    expect(collectFrontmatterKeys(seeded)).toEqual(['name', 'description', 'model', 'tools']);

    // And the shapes it must NOT mistake for a declaration: an indented key and a
    // list item. A collector that reported these would fail the live guard for a
    // frontmatter that declares no allowlist at all.
    expect(collectFrontmatterKeys('skills:\n  - devflow:git\n  tools: Read\n')).toEqual(['skills']);
  });
});

// ---------------------------------------------------------------------------
// 4. AC-2.7 — `_mcp.md` is not generated in Phase 2 and is named from nowhere
// ---------------------------------------------------------------------------

describe('provider-scope: no _mcp.md after a GitHub-only build (AC-2.7, D-D)', () => {
  it('references/tracker/_mcp.md does not exist', () => {
    const mcp = path.join(REFS_DIR, 'tracker', '_mcp.md');
    expect(
      existsSync(mcp),
      `${mcp} exists. Clause (iii) is read PER PHASE: no MCP-backed provider module exists in ` +
      `Phase 2, so the file would have no reachable consumer (ADR-003). It lands in 3a.`,
    ).toBe(false);
    // Non-vacuity: the directory it would live in IS present and populated, so the
    // absence above is an absence and not a missing build.
    expect(
      existsSync(path.join(REFS_DIR, 'tracker', 'github')),
      'the GitHub mechanics directory is absent — run `npm run build`; the _mcp.md assertion ' +
      'would otherwise pass on an unbuilt tree',
    ).toBe(true);
  });

  it("no generated GitHub mechanics file names '_mcp.md'", () => {
    const named: string[] = [];
    for (const op of TRACKER_GITHUB_OPS) {
      const file = path.join(REFS_DIR, 'tracker', 'github', `${op}.md`);
      const text = readFileSync(file, 'utf-8');
      if (text.includes('_mcp.md')) named.push(op);
    }
    expect(named, `ops naming _mcp.md: ${named.join(', ')}`).toEqual([]);
    expect(TRACKER_GITHUB_OPS.length, 'the op roster is empty — the loop above ran zero times')
      .toBeGreaterThan(0);
  });
});

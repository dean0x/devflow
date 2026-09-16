/**
 * provider-scope — Phase 2 is GitHub-only, and says so mechanically (P2-S15, AC-2.7).
 *
 * Four negatives, all from §14.5's standing prohibitions and AC-2.7's amended
 * positive form. Each is a NAMED collector with a known-bad probe that drives it.
 *
 *   1. No Jira/Linear literal outside the resolution preamble and the owning
 *      provider's own mechanics (AC-3.12, ADR-025 per-literal classification).
 *   2. No `mcp__` / vendor tool literal, and no user-facing "MCP", in anything a
 *      Git spawn can load.
 *   3. The Git agent declares no `tools:` frontmatter key.
 *   4. `_mcp.md` is generated ONLY behind its registry gate (AC-2.7 re-scoped in
 *      3a-4, hazard H7) and is named from no generated GitHub mechanics file.
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
import {
  TRACKER_GITHUB_OPS,
  TRACKER_OPS,
  MCP_BACKED_PROVIDER_SUBDIRS,
  MCP_CONTRACT_MODULE,
  VARIANT_MODULES,
  generatedReferenceManifest,
  mcpContractIsGenerated,
  resolveVariantModules,
} from '../../src/core/mds-variants.js';
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

/**
 * `PROVIDER_OWNED_PATHS` — the files that ARE a provider, and the ONE token each
 * may name.
 *
 * ADR-025 applied literally: the case is classified, and the widening is the
 * narrowest one that admits it. A provider's own mechanics module cannot state
 * mechanics without naming its provider — that is what the file IS — but it has
 * no business naming a DIFFERENT one, so ownership is per (path prefix, token)
 * rather than per file. `_jira.mds` naming `linear` is still a violation, and so
 * is any file outside these prefixes naming either.
 *
 * Why a prefix and not an exact path: one source module fans out into ten
 * generated files whose names come from the op roster, so listing them would be a
 * second roster to keep in step. The prefix is the unit the build emits and the
 * installer converges (D-OVERLAY-FLAT-UNIT), which is the same unit ownership
 * should be expressed in.
 *
 * This is deliberately NOT the mechanism `PROVIDER_MAP_ALLOWLIST` uses. That one
 * exempts a BLOCK inside a file that must otherwise stay clean (the resolution
 * preamble, PF-023's single convergence point); this one says a whole file belongs
 * to a provider. Folding them together would let a provider module quietly acquire
 * the preamble's exemption, or the agent acquire a provider's.
 */
interface ProviderOwnedPath {
  /** POSIX path prefix, as `scanCorpus` labels entries. */
  readonly prefix: string;
  /** The single token this path may name. */
  readonly token: string;
  readonly justification: string;
}

const PROVIDER_OWNED_PATHS: readonly ProviderOwnedPath[] = [
  {
    prefix: 'src/assets/mds/tracker/_jira.mds',
    token: 'jira',
    justification:
      'the Jira mechanics module. Its sections state which provider the Git agent loads them for, ' +
      'and a mechanics file that cannot name its provider cannot state that.',
  },
  {
    prefix: 'dist/skills/git/references/tracker/jira/',
    token: 'jira',
    justification:
      'the generated Jira per-op references — the emitted form of the module above. Scanned, not ' +
      'exempted: only the one token is admitted, so a Linear literal here is still reported.',
  },
];

/** Is `path` owned by `token` — i.e. may it name that provider? */
function ownsToken(path: string, token: string): boolean {
  return PROVIDER_OWNED_PATHS.some(owned => owned.token === token && path.startsWith(owned.prefix));
}

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

/**
 * Named collector: foreign-provider literals outside the allowlisted preamble and
 * outside the provider's own owned paths.
 */
export function collectForeignProviderLiterals(corpus: CorpusEntry[]): string[] {
  const violations: string[] = [];
  for (const entry of corpus) {
    const text = stripAllowlistedRegion(entry);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const token of FOREIGN_PROVIDER_TOKENS) {
        if (ownsToken(entry.path, token.name)) continue;
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
      `A Jira or Linear literal outside the resolution preamble and outside the owning provider's ` +
      `own mechanics is either a second resolution site (PF-023) or a provider name leaking into ` +
      `provider-neutral text:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every owned path is real, scanned, and actually names its token', () => {
    // An ownership entry that matches nothing is an exemption nobody notices going
    // out of date — the failure mode the inline-body exclusion list taught. Each
    // entry must reach at least one scanned file, and that file must genuinely
    // carry the token, or the entry is deleted rather than carried.
    expect(PROVIDER_OWNED_PATHS.length, 'the ownership table is empty (PF-018)').toBeGreaterThan(0);
    for (const owned of PROVIDER_OWNED_PATHS) {
      const matched = corpus.filter(e => e.path.startsWith(owned.prefix));
      expect(
        matched.length,
        `ownership entry "${owned.prefix}" matched no scanned file — delete it or fix the prefix`,
      ).toBeGreaterThan(0);
      const token = FOREIGN_PROVIDER_TOKENS.find(t => t.name === owned.token)!;
      expect(
        matched.some(e => token.pattern.test(e.content)),
        `"${owned.prefix}" is owned by "${owned.token}" but names it nowhere — the entry silences ` +
        `nothing and must be removed`,
      ).toBe(true);
      expect(owned.justification.trim().length, 'an entry with no justification is a grep')
        .toBeGreaterThan(0);
    }
  });

  it('AC-3.12: the provider-neutral scopes hold no provider literal, each arm named', () => {
    // AC-3.12 spelled as the scopes it names, so each one is asserted by itself
    // rather than inferred from an aggregate empty list. An arm that stopped being
    // reached would otherwise pass silently while contributing nothing.
    const FORBIDDEN_SCOPES: readonly string[] = [
      'dist/agents/git.md',
      'dist/commands/',
      'dist/skills/git/references/tracker/github/',
      `${SRC_AGENTS_LABEL}/`,
      'src/assets/commands/',
    ];
    for (const scope of FORBIDDEN_SCOPES) {
      const inScope = corpus.filter(e => e.path.startsWith(scope));
      expect(
        inScope.length,
        `AC-3.12 scope "${scope}" reached no file — the arm is vacuous`,
      ).toBeGreaterThan(0);
      for (const entry of inScope) {
        expect(
          ownsToken(entry.path, 'jira') || ownsToken(entry.path, 'linear'),
          `"${entry.path}" is inside an AC-3.12 forbidden scope AND owned by a provider — the two ` +
          `tables contradict each other`,
        ).toBe(false);
      }
      expect(
        collectForeignProviderLiterals(inScope),
        `AC-3.12: no provider literal may appear in ${scope}`,
      ).toEqual([]);
    }
  });

  it('known-bad probe: a seeded provider literal is reported in every AC-3.12 scope', () => {
    // One seed per forbidden scope, driven through the live collector. Without this
    // the per-scope empties above are equally green for an over-eager ownership
    // prefix that swallowed the whole corpus.
    const seeds: readonly CorpusEntry[] = [
      { path: 'dist/agents/git.md', content: 'After the preamble, load the jira mechanics.\n' },
      { path: 'dist/commands/seed.md', content: 'Pick a Linear team before planning.\n' },
      {
        path: 'dist/skills/git/references/tracker/github/seed.md',
        content: 'If the tracker is Jira, fall back to the label map.\n',
      },
      { path: `${SRC_AGENTS_LABEL}/seed.md`, content: 'Resolve the jira project key.\n' },
      { path: 'src/assets/commands/seed.mds', content: 'Ask which Linear team owns the ticket.\n' },
    ];
    expect(
      collectForeignProviderLiterals([...seeds]).map(v => v.split(':')[0]),
      'every forbidden scope must be reported by the same collector the live arms use',
    ).toEqual(seeds.map(seed => seed.path));
  });

  it('known-bad probe: an owned path may name ITS token and no other', () => {
    // The half ADR-025 is about. Ownership is per (path, token), so the Jira module
    // naming Linear is still a violation — the narrow widening did not become a
    // blanket one.
    const owned = PROVIDER_OWNED_PATHS[0];
    expect(
      collectForeignProviderLiterals([
        { path: owned.prefix, content: 'Resolve the jira project key.\n' },
      ]),
      `${owned.prefix} must be allowed to name "${owned.token}"`,
    ).toEqual([]);
    expect(
      collectForeignProviderLiterals([
        { path: owned.prefix, content: 'Fall back to the Linear team filter.\n' },
      ]).map(v => v.split(' — ')[0]),
      'and must NOT be allowed to name a different provider',
    ).toEqual([`${owned.prefix}: "linear"`]);
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
 * a regex typo would have read as a pass (PF-018/PF-064).
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
// 4. AC-2.7, RE-SCOPED in 3a-4 (hazard H7, decision D-D)
// ---------------------------------------------------------------------------
//
// Phase 2's form was *"no `_mcp.md` exists after a GitHub-only build"*, and it
// would have failed the instant Phase 3 authored the module — which is why the
// re-scope is a named step (P3a-S12) rather than a discovery. The re-scoped form:
//
//     `_mcp.md` is GENERATED ONLY when a provider that needs it is registered,
//     and is never NAMED from any github op file.
//
// Both halves are asserted, and the first one has now flipped: a provider that
// reaches its tracker through a tool call IS registered, so the file exists. That
// is not a relaxation of AC-2.7 — the claim was never "the file is absent", it was
// "the file tracks its consumers", and the arms below pin BOTH directions of that:
// the gate is open for the shipped registry, and shut for a registry with no such
// provider, so a GitHub-only install still carries nothing it cannot reach
// (GAP-02). The SECOND half does not move at all: no github op file may name the
// contract, because a CLI provider loading a document about a transport it never
// uses would be handed the DEGRADED vocabulary of capabilities it has no analogue
// for (AC-3.12).

describe('provider-scope: _mcp.md is generated only behind its gate (AC-2.7 re-scoped, H7, D-D)', () => {
  const MCP_REL = path.join('tracker', '_mcp.md');

  it('the contract module IS authored — the gate governs a real document', () => {
    const source = path.join(ROOT, MCP_CONTRACT_MODULE.source);
    expect(
      existsSync(source),
      `${MCP_CONTRACT_MODULE.source} is absent. AC-2.7's re-scoped form asserts a GATE; with no ` +
      `module on disk it would instead be asserting that 3a-4 never happened.`,
    ).toBe(true);
    expect(
      readFileSync(source, 'utf-8').length,
      'the contract module is empty — a zero-byte contract passes every containment assertion',
    ).toBeGreaterThan(0);
  });

  it('references/tracker/_mcp.md IS generated on this tree (the gate is open)', () => {
    expect(
      mcpContractIsGenerated(),
      'the shipped registry must open the gate: a registered provider reaches its tracker through ' +
      'a tool call and its mechanics NAME this contract, so a shut gate would ship ten references ' +
      'pointing at a file the install does not carry',
    ).toBe(true);
    const mcp = path.join(REFS_DIR, MCP_REL);
    expect(
      existsSync(mcp),
      `${mcp} is absent while the gate is open — run \`npm run build\`; the provider mechanics ` +
      `name this file and would take the \`tracker mechanics unavailable\` path as normal.`,
    ).toBe(true);
    expect(
      generatedReferenceManifest(),
      'the installer converges to this manifest, so the contract must be named in it or it never ' +
      'reaches a machine',
    ).toContain('tracker/_mcp.md');
  });

  it('absence arm: the gate SHUTS for a registry with no tool-call provider', () => {
    // The direction that keeps it a gate rather than a constant. Without this,
    // AC-2.7's original reason (GAP-02 — a GitHub user billed for a reference
    // nothing they can reach loads) would have no assertion behind it at all now
    // that the shipped registry is on the other side of the gate.
    const gated: readonly string[] = MCP_BACKED_PROVIDER_SUBDIRS;
    const cliOnly = VARIANT_MODULES.filter(mod => !gated.includes(mod.subdir));
    expect(
      cliOnly.length,
      'the CLI-only probe registry must still hold a module, and must differ from the shipped one',
    ).toBeGreaterThan(0);
    expect(cliOnly.length).toBeLessThan(VARIANT_MODULES.length);
    expect(mcpContractIsGenerated(cliOnly)).toBe(false);
    expect(
      resolveVariantModules(cliOnly).map(m => m.source),
      'a shut gate must append nothing',
    ).not.toContain(MCP_CONTRACT_MODULE.source);

    // …and the presence arm, on an injected registry rather than on the shipped
    // one, so both directions are provable from one place.
    const withProvider = [
      ...cliOnly,
      {
        source: 'src/assets/mds/tracker/_probe.mds',
        subdir: MCP_BACKED_PROVIDER_SUBDIRS[0],
        kind: 'fanout' as const,
        ops: TRACKER_OPS,
      },
    ];
    expect(mcpContractIsGenerated(withProvider)).toBe(true);
    expect(
      resolveVariantModules(withProvider).map(m => m.source),
      'opening the gate must add the contract module and nothing else',
    ).toContain(MCP_CONTRACT_MODULE.source);
  });

  it("no generated GitHub mechanics file names '_mcp.md'", () => {
    // The second half of the re-scoped form, and the half that does NOT relax:
    // a github op naming the tool-call contract would make a CLI provider load a
    // document about a transport it never uses, and would hand it the DEGRADED
    // vocabulary of capabilities it has no analogue for.
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

  it('the contract module is INSIDE the scanned corpus, so its wording is governed', () => {
    // The module names no provider and no transport, and that is only meaningful
    // while the scan can see it: an exemption was deliberately NOT taken here
    // (ADR-025 — classify the case, and this case did not need widening), so the
    // guard must prove the file is in scope rather than out of it.
    const corpus = scanCorpus();
    const scanned = corpus.map(e => e.path);
    expect(
      scanned,
      'the contract module must be scanned by the provider and vendor collectors — an unscanned ' +
      'file is an exemption nobody wrote down',
    ).toContain('src/assets/mds/tracker/_mcp.mds');
    const entry = corpus.find(e => e.path === 'src/assets/mds/tracker/_mcp.mds')!;
    expect(collectForeignProviderLiterals([entry]), 'the contract is provider-independent').toEqual([]);
    expect(
      collectVendorTokens([entry]),
      'the contract states its rules in terms of CAPABILITIES, not transport: no vendor tool ' +
      'literal and no transport acronym, so no allowlist entry is needed for it',
    ).toEqual([]);
  });
});

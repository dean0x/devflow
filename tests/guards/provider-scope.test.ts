/**
 * provider-scope — a provider name appears only where a provider is resolved or
 * where a provider's own mechanics are stated, and the surface says so
 * mechanically (P2-S15, AC-2.7, AC-3.12).
 *
 * Five negatives, all from §14.5's standing prohibitions and AC-2.7's amended
 * positive form. Each is driven by a NAMED collector with a known-bad probe that
 * seeds the shape it must report.
 *
 *   1. No Jira/Linear literal outside the resolution preamble and the owning
 *      provider's own mechanics (AC-3.12, per-literal classification)
 *      — collectForeignProviderLiterals.
 *   2. No `mcp__` / vendor tool literal, and no user-facing "MCP", in anything a
 *      Git spawn can load — collectVendorTokens.
 *   3. The Git agent's `tools:` allowlist covers every built-in tool its bodies direct and names no
 *      tracker server (the install stamps those) — collectFrontmatterKeys, collectToolsEntries,
 *      collectDirectedTools.
 *   4. `_mcp.md` is generated ONLY behind its registry gate (AC-2.7 re-scoped in
 *      3a-4, hazard H7) and is named from no generated GitHub mechanics file —
 *      collectOpsNamingContract for the second half, and INJECTED registries for
 *      the gate itself, where the probe is a registry with no tool-call provider
 *      rather than a seeded file.
 *   5. The `/plan` command and the three dynamic commands promise a tracker
 *      issue, not a host issue or a host CLI — collectHostIssueLiterals. Collector
 *      1 cannot see this one: `github` is the DEFAULT provider, not a foreign token.
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
 * fixture-only provider directory to prove per-provider failure isolation);
 * `tests/` is outside the scan by construction.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { agentsDir, commandsDir, compiledAgentsDir, compiledSkillRefsDir, skillsDir } from '../../src/core/assets.js';
import {
  PR_HOST_DESTINATION_ROOT,
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
import { SETTINGS_BLOCK_HOSTS, SETTINGS_BLOCK_HOSTS_LEARNING_OFF } from '../fixtures/mds-manifest.js';
import { LEARNING_OFF_OUTPUT_DIR } from '../../src/core/learning-variants.js';

const DIST_COMMANDS = path.join(ROOT, 'dist', 'commands');
const DIST_SKILLS = path.join(ROOT, 'dist', 'skills');
/** The learning-off variants of the commands and agents (D-LEARNING-VARIANTS): prompts an install lays down like any other. */
const LEARNING_OFF_AGENTS = `${LEARNING_OFF_OUTPUT_DIR}/agents`;
const LEARNING_OFF_COMMANDS = `${LEARNING_OFF_OUTPUT_DIR}/commands`;
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
/** The source of the tracker contract: the provider resolution, moved out of the Git agent. */
const CONTRACT_HOST = 'src/assets/mds/tracker/_contract.mds';

const PROVIDER_SCAN_ROOTS: readonly ScanRoot[] = [
  { label: SRC_AGENTS_LABEL, dir: agentsDir(ROOT), exts: ['.md', '.mds'] },
  { label: 'src/assets/mds', dir: path.join(ROOT, 'src', 'assets', 'mds'), exts: ['.mds'] },
  { label: 'src/assets/commands', dir: commandsDir(), exts: ['.md', '.mds'] },
  { label: 'src/assets/skills/git', dir: path.join(skillsDir(), 'git'), exts: ['.md'] },
  { label: 'dist/agents', dir: compiledAgentsDir(ROOT), exts: ['.md'] },
  { label: 'dist/commands', dir: DIST_COMMANDS, exts: ['.md'] },
  { label: 'dist/skills', dir: DIST_SKILLS, exts: ['.md'] },
  { label: LEARNING_OFF_AGENTS, dir: path.join(ROOT, LEARNING_OFF_AGENTS), exts: ['.md'] },
  { label: LEARNING_OFF_COMMANDS, dir: path.join(ROOT, LEARNING_OFF_COMMANDS), exts: ['.md'] },
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
 * `PROVIDER_MAP_ALLOWLIST` — the provider resolution, and nothing else.
 *
 * P2-S3's rationale, restated so the allowlist is legible without the artifact:
 * a check on a provider token is only real at the one sink every caller passes
 * through, so there is exactly ONE convergence point where a provider token is
 * turned into a path. The provider resolution IS that point, and it can only be a
 * convergence point if it enumerates the closed token set — a map with one row
 * would be a map that decides nothing. The three tokens therefore have to be
 * written here in Phase 2, and Phase 3 fills the two directories the map already
 * names rather than adding a second place where a provider is resolved.
 *
 * The resolution lived in the always-loaded Git agent until the Git agent split
 * (D-TRACKER-CONTRACT-ON-DEMAND) moved it, whole, into `tracker/_contract.md`, which a
 * spawn reads once when it runs a tracker operation. The region moved with it: the agent
 * itself now names no provider and is held to that by the AC-3.12 scopes below.
 *
 * The allowlisted region is the block, not a line: the token set appears several
 * times inside it (the map rows, the conventions-file path, the input contract), and
 * a line-scoped allowlist would have to enumerate them and go stale on any rewrap.
 */
interface AllowlistedRegion {
  /** What the region is, for the failure message. */
  readonly label: string;
  /** Corpus paths that carry it, as `scanCorpus` labels them. */
  readonly files: readonly string[];
  /** The region's own bounds. */
  readonly from: string;
  readonly to: string;
  /** Why a closed token set has to be written HERE and nowhere else. */
  readonly justification: string;
  /**
   * The tokens the region must be the ONLY place its files name. Absent means every foreign token.
   * A provider's own reference names its own provider outside the region (the token it owns), so
   * its row confines only the other.
   */
  readonly confines?: readonly string[];
}

/**
 * Every block that must enumerate the closed provider set, and nothing else.
 *
 * A registry rather than one constant because a second such block now exists, and
 * the alternative was a hand-written second condition beside the first — two
 * mechanisms for one rule, which is how one of them goes stale. Each row
 * is still a BLOCK inside a file that must otherwise stay clean, which is what
 * keeps this distinct from `PROVIDER_OWNED_PATHS` below: that one says a whole
 * file belongs to a provider, this one says a bounded region inside a
 * provider-neutral file may name all of them.
 */
/** The bounds of the PR-link paste gate: from its table header to the start of the paragraph after the checks. */
const PASTE_GATE_FROM = '| Tracker grammar | `ISSUE_PR_LINK` must match |';
const PASTE_GATE_TO = 'This re-check is the only gate on that value';
const PASTE_GATE_JUSTIFICATION =
  'The PR body is a GitHub-visible sink and ensure-pr-ready is the last hand the rendered link ' +
  'line passes through — no operation checks its shape before returning it. The gate is a ' +
  'union of the tracker grammars and cannot be written without naming the rows it admits: the ' +
  'line was rendered by an earlier spawn, so this one does not re-derive the provider from it. ' +
  'So the closed set is enumerated once, inside the gate, and a value is pasted when it matches ' +
  'any one row — the gate never resolves a provider, which is what keeps this a sink check and ' +
  'not a second convergence point. The PR skeleton is one write expanded into three provider ' +
  'files, so each copy carries the block.';

const ALLOWLISTED_PROVIDER_REGIONS: readonly AllowlistedRegion[] = [
  {
    label: "the tracker contract's provider resolution and input contract",
    files: [CONTRACT_HOST, 'dist/skills/git/references/tracker/_contract.md'],
    /**
     * The contract's own bounds: from the resolution heading to its last bullet, which names no
     * provider. The block is the end of the file, so the closing anchor is the final bullet's
     * opening rather than a following heading.
     */
    from: '### Tracker provider resolution',
    to: '- **Issue refs render as',
    justification:
      'A provider check is only real at the one sink every caller passes through, so exactly ONE ' +
      'convergence point turns a provider token into a path, and a map with one row decides ' +
      'nothing — the closed set has to be written where the resolution happens.',
  },
  {
    label: "ensure-pr-ready's PR-link paste gate",
    files: ['src/assets/mds/git/_ops_steps.mds', 'dist/skills/git/references/tracker/github/ensure-pr-ready.md'],
    from: PASTE_GATE_FROM,
    to: PASTE_GATE_TO,
    justification: PASTE_GATE_JUSTIFICATION,
  },
  {
    label: "ensure-pr-ready's PR-link paste gate (the Jira copy)",
    files: ['dist/skills/git/references/tracker/jira/ensure-pr-ready.md'],
    from: PASTE_GATE_FROM,
    to: PASTE_GATE_TO,
    justification: PASTE_GATE_JUSTIFICATION,
    confines: ['linear'],
  },
  {
    label: "ensure-pr-ready's PR-link paste gate (the Linear copy)",
    files: ['dist/skills/git/references/tracker/linear/ensure-pr-ready.md'],
    from: PASTE_GATE_FROM,
    to: PASTE_GATE_TO,
    justification: PASTE_GATE_JUSTIFICATION,
    confines: ['jira'],
  },
  {
    label: "the settings partial's accepted-line shape",
    files: [
      ...SETTINGS_BLOCK_HOSTS.flatMap(h => [`src/assets/commands/${h}.md`, `dist/commands/${h}.md`]),
      ...SETTINGS_BLOCK_HOSTS_LEARNING_OFF.map(h => `${LEARNING_OFF_COMMANDS}/${h}.md`),
    ],
    from: 'one line of the form `TRACKER=<',
    to: ' — these fields, in this order, nothing else',
    justification:
      'A command accepts the resolve-settings.cjs line only when it matches the script\'s ' +
      'SETTINGS_LINE_RE, and a closed value set cannot be written without naming its members. ' +
      'It is a sink check on a value the script already resolved, like the Code agent\'s paste ' +
      'gate: the command never chooses a provider from it, so this is no second convergence ' +
      'point. The block expands once per gate that consumes it, so a file can carry it ' +
      'more than once, and every copy is stripped.',
  },
];

/**
 * The resolution preamble specifically. Three arms below assert properties of
 * THAT region — that it is the convergence point, and that its own anchors still
 * bracket the token set — so it keeps its own name rather than being addressed by
 * index at each site.
 */
const PROVIDER_MAP_ALLOWLIST = ALLOWLISTED_PROVIDER_REGIONS[0];

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
 * Each case is classified on its own, and the widening is the
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
 * preamble, the single convergence point); this one says a whole file belongs
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
  {
    prefix: 'src/assets/mds/tracker/_linear.mds',
    token: 'linear',
    justification:
      'the Linear mechanics module. Its sections state which provider the Git agent loads them ' +
      'for, and a mechanics file that cannot name its provider cannot state that. Its ' +
      '`## Known Unknowns` prose names the provider too — the rank-4 statement is about this ' +
      'provider specifically, and a rank stated without its subject is unreadable.',
  },
  {
    prefix: 'dist/skills/git/references/tracker/linear/',
    token: 'linear',
    justification:
      'the generated Linear per-op references — the emitted form of the module above. Scanned, ' +
      'not exempted: only the one token is admitted, so a Jira literal here is still reported, ' +
      'which is what keeps the narrow widening narrow.',
  },
];

/**
 * One foreign-provider token, addressed by name and raised by name when absent.
 *
 * `find(...)!` would hand the caller an `undefined` whose only symptom is "cannot
 * read properties of undefined" at the next `.pattern` read, naming neither the
 * table nor the token — and an ownership entry pointing at a token nobody
 * registered is exactly the drift these arms report.
 */
function requireForeignToken(name: string): ProviderToken {
  const found = FOREIGN_PROVIDER_TOKENS.find(t => t.name === name);
  if (found === undefined) {
    throw new Error(
      `"${name}" is not in FOREIGN_PROVIDER_TOKENS (registered: ` +
      `${FOREIGN_PROVIDER_TOKENS.map(t => t.name).join(', ')}) — an ownership entry naming an ` +
      `unregistered token exempts a path from a scan that never covered it`,
    );
  }
  return found;
}

/**
 * One scanned corpus entry, addressed by path and raised by path when absent.
 *
 * The scan roots read the built tree, so a missing entry means a root went empty
 * or an artifact was never built — a failure that has to name the file, because
 * "cannot read properties of undefined" is indistinguishable from a logic error.
 */
function requireCorpusEntry(corpus: readonly CorpusEntry[], relPath: string): CorpusEntry {
  const found = corpus.find(e => e.path === relPath);
  if (found === undefined) {
    throw new Error(
      `${relPath} is not in the scanned corpus (${corpus.length} file(s) scanned) — either a scan ` +
      `root went empty or the artifact was never built, and an unscanned file is an exemption ` +
      `nobody wrote down`,
    );
  }
  return found;
}

/** Is `path` owned by `token` — i.e. may it name that provider? */
function ownsToken(path: string, token: string): boolean {
  return PROVIDER_OWNED_PATHS.some(owned => owned.token === token && path.startsWith(owned.prefix));
}

/**
 * Remove every allowlisted block that lives in this file, every copy of it;
 * identity elsewhere. Each pass removes one copy and shortens the text, so the
 * loop is bounded by the number of copies.
 */
function stripAllowlistedRegion(entry: CorpusEntry): string {
  let content = entry.content;
  for (const region of ALLOWLISTED_PROVIDER_REGIONS) {
    if (!region.files.includes(entry.path)) continue;
    for (let start = content.indexOf(region.from); start !== -1; start = content.indexOf(region.from, start)) {
      const end = content.indexOf(region.to, start);
      if (end === -1) {
        content = content.slice(0, start);
        break;
      }
      content = content.slice(0, start) + content.slice(end);
    }
  }
  return content;
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
    // Every file that carries an allowlisted block must actually be in the corpus,
    // or the allowlist is silencing nothing and the guard is proving nothing about it.
    for (const region of ALLOWLISTED_PROVIDER_REGIONS) {
      for (const file of region.files) {
        expect(corpus.map(e => e.path), `allowlisted file ${file} must be in the corpus`).toContain(file);
      }
    }
  });

  it('every allowlisted region is still needed: each really does carry the token set', () => {
    // A stale allowlist is the failure mode the inline-body exclusion list taught —
    // an exemption nobody notices going out of date. If a region ever stops naming
    // the foreign tokens, this fails and the row is deleted, not carried.
    for (const region of ALLOWLISTED_PROVIDER_REGIONS) {
      expect(
        region.justification.length,
        `${region.label}: a region without a stated reason is an exemption, not a classification`,
      ).toBeGreaterThan(80);
      for (const file of region.files) {
        const entry = requireCorpusEntry(corpus, file);
        const whole = entry.content;
        const stripped = stripAllowlistedRegion(entry);
        expect(
          stripped.length,
          `${file}: ${region.label} was not found — its anchors changed`,
        ).toBeLessThan(whole.length);
        for (const token of FOREIGN_PROVIDER_TOKENS.filter(t => region.confines?.includes(t.name) ?? true)) {
          expect(
            token.pattern.test(whole) && !token.pattern.test(stripped),
            `${file}: "${token.name}" is no longer confined to ${region.label} — either it moved ` +
            `(a second convergence point) or the region dropped it and the row is stale`,
          ).toBe(true);
        }
      }
    }
  });

  it('no foreign provider literal appears anywhere else on the tracker surface', () => {
    const violations = collectForeignProviderLiterals(corpus);
    expect(
      violations,
      `A Jira or Linear literal outside the resolution preamble and outside the owning provider's ` +
      `own mechanics is either a second resolution site or a provider name leaking into ` +
      `provider-neutral text:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every owned path is real, scanned, and actually names its token', () => {
    // An ownership entry that matches nothing is an exemption nobody notices going
    // out of date — the failure mode the inline-body exclusion list taught. Each
    // entry must reach at least one scanned file, and that file must genuinely
    // carry the token, or the entry is deleted rather than carried.
    expect(PROVIDER_OWNED_PATHS.length, 'the ownership table is empty').toBeGreaterThan(0);
    for (const owned of PROVIDER_OWNED_PATHS) {
      const matched = corpus.filter(e => e.path.startsWith(owned.prefix));
      expect(
        matched.length,
        `ownership entry "${owned.prefix}" matched no scanned file — delete it or fix the prefix`,
      ).toBeGreaterThan(0);
      const token = requireForeignToken(owned.token);
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
      // The PR-host tree is provider-NEUTRAL: it is installed under every
      // provider, so a jira or linear literal there would be read by users of a
      // third tracker as if it were theirs. It belongs in this list for a
      // stronger reason than the github tree does, not a weaker one.
      `dist/skills/git/references/${PR_HOST_DESTINATION_ROOT}/`,
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
      {
        path: `dist/skills/git/references/${PR_HOST_DESTINATION_ROOT}/seed.md`,
        content: 'Under Linear, skip the merge-readiness probe.\n',
      },
      { path: `${SRC_AGENTS_LABEL}/seed.md`, content: 'Resolve the jira project key.\n' },
      { path: 'src/assets/commands/seed.mds', content: 'Ask which Linear team owns the ticket.\n' },
    ];
    expect(
      collectForeignProviderLiterals([...seeds]).map(v => v.split(':')[0]),
      'every forbidden scope must be reported by the same collector the live arms use',
    ).toEqual(seeds.map(seed => seed.path));
  });

  it('known-bad probe: EVERY owned path may name ITS token and no other', () => {
    // The half that keeps the widening narrow. Ownership is per (path, token), so
    // the Jira module naming Linear is still a violation — the narrow widening did
    // not become a blanket one.
    //
    // Driven over EVERY entry, not over PROVIDER_OWNED_PATHS[0]. Probing one member
    // of a table the live arms range over stops discriminating the moment the table
    // grows: the uncovered regression is an over-broad ROW — say
    // `{prefix: '…/_linear.mds', token: 'jira'}` added to silence a leak — which
    // satisfies the iterating arm above (the leak is why the row was added) while
    // no probe ever asks it the foreign-token half. Indexing [0] also silently
    // assumed which provider sits first in the table.
    for (const owned of PROVIDER_OWNED_PATHS) {
      expect(
        collectForeignProviderLiterals([
          { path: owned.prefix, content: `Resolve the ${owned.token} project key.\n` },
        ]),
        `${owned.prefix} must be allowed to name "${owned.token}"`,
      ).toEqual([]);

      const foreign = FOREIGN_PROVIDER_TOKENS.filter(t => t.name !== owned.token);
      expect(foreign.length, 'a single-token registry cannot express the "no other" half')
        .toBeGreaterThan(0);
      for (const token of foreign) {
        expect(
          collectForeignProviderLiterals([
            { path: owned.prefix, content: `Fall back to the ${token.name} team filter.\n` },
          ]).map(v => v.split(' — ')[0]),
          `${owned.prefix} must NOT be allowed to name "${token.name}"`,
        ).toEqual([`${owned.prefix}: "${token.name}"`]);
      }
    }
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
      path: 'dist/skills/git/references/tracker/_contract.md',
      content: [
        'Before the resolution: nothing foreign here.',
        PROVIDER_MAP_ALLOWLIST.from,
        '| `jira` | `tracker/jira/` |',
        '| `linear` | `tracker/linear/` |',
        PROVIDER_MAP_ALLOWLIST.to,
        'After the resolution, load the jira mechanics.',
      ].join('\n'),
    };
    expect(collectForeignProviderLiterals([seeded])).toEqual([
      'dist/skills/git/references/tracker/_contract.md: "jira" — After the resolution, load the jira mechanics.',
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

/**
 * `VENDOR_ALLOWLIST` (D-SCAN-IN-CODE): the one `mcp__` literal this scan admits is Harden's
 * `  - mcp__*` entry in its `disallowedTools` frontmatter, in the compiled agent and in its
 * learning-off variant. The wildcard denies every MCP tool and names none, so it binds no
 * contract to a transport; Polish carries the same entry, but it is hand-authored and outside
 * this scan. The exemption is one exact line in two named files: any other `mcp__` literal in
 * those files, and the same line anywhere else (the Git agent included), is still reported.
 * The prohibition above and this exemption are one authority: the 'still needed' arm below
 * fails when a file no longer carries its line.
 */
const VENDOR_ALLOWLIST: { readonly files: readonly string[]; readonly line: string; readonly token: string } = {
  files: ['dist/agents/harden.md', `${LEARNING_OFF_AGENTS}/harden.md`],
  line: '- mcp__*',
  token: 'mcp__ tool literal',
};

function isAllowedVendorLine(entryPath: string, token: VendorToken, line: string): boolean {
  return token.name === VENDOR_ALLOWLIST.token
    && VENDOR_ALLOWLIST.files.includes(entryPath)
    && line.trim() === VENDOR_ALLOWLIST.line;
}

/** Named collector: vendor/transport literals in loadable prompt text. */
export function collectVendorTokens(corpus: CorpusEntry[]): string[] {
  const violations: string[] = [];
  for (const entry of corpus) {
    for (const token of VENDOR_TOKENS) {
      for (const line of entry.content.split('\n')) {
        if (token.pattern.test(line) && !isAllowedVendorLine(entry.path, token, line)) {
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

  it('every allowlisted vendor line is still needed: each file really carries it', () => {
    const corpus = vendorCorpus();
    for (const file of VENDOR_ALLOWLIST.files) {
      const entry = corpus.find(e => e.path === file);
      expect(entry, `${file} is not in the vendor scan`).toBeDefined();
      expect(
        (entry as CorpusEntry).content.split('\n').some(line => line.trim() === VENDOR_ALLOWLIST.line),
        `${file} no longer carries "${VENDOR_ALLOWLIST.line}": delete it from VENDOR_ALLOWLIST`,
      ).toBe(true);
    }
  });

  it('known-bad probe: the allowlist admits one exact line in two files and nothing else', () => {
    const [compiled, learningOff] = VENDOR_ALLOWLIST.files;
    const entry = (path: string, content: string): CorpusEntry => ({ path, content });
    expect(collectVendorTokens([entry(compiled, '  - mcp__*\n'), entry(learningOff, '  - mcp__*\n')])).toEqual([]);
    // The same line anywhere else, and any other mcp__ literal in an allowlisted file, are reported.
    expect(collectVendorTokens([entry('dist/agents/git.md', '  - mcp__*\n')]).length).toBe(1);
    expect(collectVendorTokens([entry('dist/agents/code.md', '  - mcp__*\n')]).length).toBe(1);
    expect(collectVendorTokens([entry(compiled, '  - mcp__tavily__tavily_search\n')]).length).toBe(1);
    expect(collectVendorTokens([entry(compiled, 'Call mcp__* directly.\n')]).length).toBe(1);
    // The other token is not silenced by it.
    expect(collectVendorTokens([entry(compiled, 'Requires the MCP server.\n')]).length).toBe(1);
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
// 3. The Git agent's `tools:` allowlist covers what its bodies direct
// ---------------------------------------------------------------------------

/**
 * Named collector: the top-level keys declared in a frontmatter block's inner text.
 *
 * Extracted from the assertions below so the guard and its known-bad probe share
 * one extractor. Inline, a negative such as `.not.toContain('disallowedTools')` was green
 * whether the key was truly absent or the extractor had stopped returning keys at all —
 * a regex typo would have read as a pass.
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

/**
 * Named collector: the entries of the column-0 `tools:` key, in either list form (an inline
 * `["A", "B"]` or a YAML block list), or null when the key is absent.
 */
function collectToolsEntries(inner: string): string[] | null {
  const lines = inner.split('\n');
  const at = lines.findIndex(l => /^tools:/.test(l));
  if (at === -1) return null;
  const unquote = (item: string): string => item.trim().replace(/^(["'])(.*)\1$/, '$2');
  const inline = /^tools:[ \t]*\[(.*)\][ \t]*$/.exec(lines[at]);
  if (inline) return inline[1].split(',').map(unquote).filter(item => item !== '');
  const entries: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (!item) break;
    entries.push(unquote(item[1]));
  }
  return entries;
}

/** The built-in tools a prompt can direct by name. Grep and Glob are here to be reported, never granted. */
const DIRECTABLE_TOOLS: readonly string[] = [
  'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Skill', 'WebFetch', 'WebSearch', 'Monitor', 'Agent',
];
const DIRECTABLE_ALTERNATION = DIRECTABLE_TOOLS.join('|');
/** `Name(` as a call, not a longer identifier or a path segment. */
const CALL_SHAPE = new RegExp(`(?<![\\w.$/-])(${DIRECTABLE_ALTERNATION})\\(`, 'g');
/** "the Name tool" or "your Name tool", with bold or backticks around the name. */
const PHRASE_SHAPE = new RegExp(`\\b(?:the|your)\\s+[*\`]*(${DIRECTABLE_ALTERNATION})\\s+tool\\b`, 'g');
/** A negation before the tool, in its own sentence, means the text forbids it. */
const NEGATION_BEFORE = /\b(?:never|do not|don't|must not|cannot|can't|no)\b/i;

/**
 * Named collector: the built-in tools a text directs, in the two shapes a prompt uses to name
 * one (a call, and "the X tool"). A sentence that negates BEFORE the tool ("never use the Edit
 * tool") directs nothing; one that negates AFTER it ("use the Read tool, never `cat`") still does.
 */
function collectDirectedTools(text: string): string[] {
  const found = new Set<string>();
  for (const re of [CALL_SHAPE, PHRASE_SHAPE]) {
    for (const m of text.matchAll(re)) {
      const before = text.slice(0, m.index);
      const sentenceStart = Math.max(before.lastIndexOf('\n'), before.search(/[.!?]\s[^.!?]*$/));
      if (NEGATION_BEFORE.test(before.slice(Math.max(sentenceStart, 0)))) continue;
      found.add(m[1]);
    }
  }
  return [...found].sort();
}

/** What a Git spawn can be told: the compiled agent body, its two preloaded skills and the generated references. */
function gitSpawnTexts(): CorpusEntry[] {
  const git = resolveAgentSource('git');
  const split = splitFrontmatter(git.content);
  const texts: CorpusEntry[] = [{ path: git.path, content: split?.body ?? git.content }];
  texts.push(...scanCorpus().filter(e => e.path.startsWith('dist/skills/git/')));
  const worktreeSupport = path.join(skillsDir(), 'worktree-support', 'SKILL.md');
  texts.push({ path: 'src/assets/skills/worktree-support/SKILL.md', content: readFileSync(worktreeSupport, 'utf-8') });
  return texts;
}

/** Every directed tool the allowlist does not grant. */
function collectUngrantedTools(directed: readonly string[], granted: readonly string[]): string[] {
  return directed.filter(tool => !granted.includes(tool));
}

describe("provider-scope: the compiled Git agent's tools: allowlist (D-GIT-ROW)", () => {
  const gitInner = (): string => {
    const git = resolveAgentSource('git');
    const split = splitFrontmatter(git.content);
    expect(split, `${git.path}: no frontmatter block at offset 0`).not.toBeNull();
    return split!.inner;
  };

  it('git.md declares a tools: allowlist and no denylist', () => {
    const keys = collectFrontmatterKeys(gitInner());
    expect(keys.length, 'frontmatter parsed to no keys — the shape changed').toBeGreaterThan(0);
    expect(keys).toContain('tools');
    expect(keys, 'an allowlist agent never also denies').not.toContain('disallowedTools');
  });

  it('git.md names no tracker server: the install stamps them (D-TRACKER-SERVER-ALLOWLIST)', () => {
    const entries = collectToolsEntries(gitInner());
    expect(entries, 'git.md must carry a tools: list').not.toBeNull();
    expect((entries ?? []).filter(entry => entry.startsWith('mcp__') || entry.includes('*'))).toEqual([]);
  });

  it('tools: covers every built-in tool the Git bodies and the references they load direct', () => {
    const granted = collectToolsEntries(gitInner()) ?? [];
    const texts = gitSpawnTexts();
    expect(texts.some(t => t.path.startsWith('dist/skills/git/references/')), 'the generated references must be scanned').toBe(true);
    const directed = [...new Set(texts.flatMap(t => collectDirectedTools(t.content)))].sort();
    // Not vacuous: the extractor has to see the two tools the bodies really direct.
    expect(directed, 'the extractor stopped seeing the tools the Git bodies direct').toEqual(expect.arrayContaining(['Read', 'Write']));
    expect(
      collectUngrantedTools(directed, granted),
      'a Git body directs a tool its allowlist removes: the op fails at runtime, not at build time. ' +
      'Grant the tool in git.mds and the git row, or change the body',
    ).toEqual([]);
  });

  it('known-bad probe: the extractor reports a seeded tools: key in both list forms, and ignores a nested one', () => {
    expect(collectFrontmatterKeys('name: Git\nmodel: haiku\ntools: Read, Bash\n')).toEqual(['name', 'model', 'tools']);
    expect(collectFrontmatterKeys('skills:\n  - devflow:git\n  tools: Read\n')).toEqual(['skills']);
    expect(collectToolsEntries('name: Git\ntools: ["Bash", "mcp__github"]\n')).toEqual(['Bash', 'mcp__github']);
    expect(collectToolsEntries('name: Git\ntools:\n  - Bash\n  - Read\nomitClaudeMd: true\n')).toEqual(['Bash', 'Read']);
    expect(collectToolsEntries('name: Git\nskills:\n  tools: ["Bash"]\n')).toBeNull();
  });

  it('known-bad probe: a directed tool the allowlist lacks is reported, a granted or negated one is not', () => {
    const granted = ['Bash', 'Read', 'Write', 'ToolSearch'];
    expect(collectDirectedTools('Patch the file with the Edit tool.')).toEqual(['Edit']);
    expect(collectDirectedTools('Patch it: Edit(path, old, new).')).toEqual(['Edit']);
    expect(collectDirectedTools('Open it with the **Read tool**, never `cat`.')).toEqual(['Read']);
    expect(collectDirectedTools('Never use the Edit tool on this file.')).toEqual([]);
    expect(collectDirectedTools('See src/Agent(1) and MyAgent(x).')).toEqual([]);
    expect(collectUngrantedTools(collectDirectedTools('Search with the Grep tool, then the Write tool.'), granted)).toEqual(['Grep']);
    expect(collectUngrantedTools(collectDirectedTools('Read it with the Read tool.'), granted)).toEqual([]);
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

/** The contract's generated basename — the literal a GitHub mechanics file may never name. */
const MCP_REL_NAME = '_mcp.md';

/** The generated GitHub per-op references, as `[op, text]` pairs a probe can seed. */
function githubOpReferences(): ReadonlyArray<readonly [string, string]> {
  return TRACKER_GITHUB_OPS.map(op => [
    op,
    readFileSync(path.join(REFS_DIR, 'tracker', 'github', `${op}.md`), 'utf-8'),
  ] as const);
}

/**
 * Named collector: generated GitHub op references that name the tool-call contract.
 *
 * Takes the corpus rather than reading it, so the probe below can seed one op and
 * show the collector reports it — the absence arm alone is equally green for a
 * collector that recognises nothing.
 */
export function collectOpsNamingContract(
  refs: ReadonlyArray<readonly [op: string, text: string]>,
): string[] {
  return refs.filter(([, text]) => text.includes(MCP_REL_NAME)).map(([op]) => op);
}

describe('provider-scope: _mcp.md is generated only behind its gate (AC-2.7 re-scoped, H7, D-D)', () => {
  const MCP_REL = path.join('tracker', MCP_REL_NAME);

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
      `name this file, so every tool-call operation would load a contract the install does not carry.`,
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
    const refs = githubOpReferences();
    expect(
      collectOpsNamingContract(refs),
      `ops naming ${MCP_REL_NAME}: ${collectOpsNamingContract(refs).join(', ')}`,
    ).toEqual([]);
    expect(
      refs.length,
      'the op roster is empty — the collector above ran over nothing',
    ).toBeGreaterThan(0);
  });

  it('known-bad probe: the same collector reports a seeded contract reference', () => {
    // An absence result is a statement about what the matcher can express, never
    // about the property, so the collector is driven over the real corpus
    // with one op seeded — no committed file is touched to show red.
    const refs = githubOpReferences();
    const [first, ...rest] = refs;
    const seeded: ReadonlyArray<readonly [string, string]> = [
      [first[0], `${first[1]}\n**Mechanics:** load \`references/tracker/${MCP_REL_NAME}\`.`],
      ...rest,
    ];
    expect(seeded, 'the seed must change the corpus').not.toEqual(refs);
    expect(
      collectOpsNamingContract(seeded),
      'the collector must report the seeded op, or the absence arm above is inert',
    ).toEqual([first[0]]);
  });

  it('the contract module is INSIDE the scanned corpus, so its wording is governed', () => {
    // The module names no provider and no transport, and that is only meaningful
    // while the scan can see it: an exemption was deliberately NOT taken here
    // (classify the case, and this case did not need widening), so the
    // guard must prove the file is in scope rather than out of it.
    const corpus = scanCorpus();
    const scanned = corpus.map(e => e.path);
    expect(
      scanned,
      'the contract module must be scanned by the provider and vendor collectors — an unscanned ' +
      'file is an exemption nobody wrote down',
    ).toContain('src/assets/mds/tracker/_mcp.mds');
    const entry = requireCorpusEntry(corpus, 'src/assets/mds/tracker/_mcp.mds');
    expect(collectForeignProviderLiterals([entry]), 'the contract is provider-independent').toEqual([]);
    expect(
      collectVendorTokens([entry]),
      'the contract states its rules in terms of CAPABILITIES, not transport: no vendor tool ' +
      'literal and no transport acronym, so no allowlist entry is needed for it',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. The plan and dynamic commands' tracker paths name no HOST
// ---------------------------------------------------------------------------

/**
 * Collector 1 above cannot see this one. `github` is not a FOREIGN token — it is
 * the default provider — so a `GitHub issue` literal in a provider-neutral
 * sentence passes every arm of the Jira/Linear scan while saying the same wrong
 * thing to a Jira user: `/plan` asks "create a GitHub issue for this plan?" and
 * then spawns `ensure-traceable-issue`, whose mechanics create a Jira one.
 *
 * The scope is the plan command and, since #376 (W4), the three dynamic commands
 * whose preflights once checked a `gh` CLI for "GitHub paths": each reads or files
 * issues only through the Git agent, which resolves the tracker itself. Source and
 * compiled, because that is where the prompt the user answers lives. Widening the
 * scope is the right response to the literal turning up elsewhere; loosening the
 * token is not.
 */
const PLAN_COMMAND_ARTIFACTS: readonly { readonly path: string; readonly file: string }[] = [
  { path: 'src/assets/commands/plan.mds', file: path.join(ROOT, 'src', 'assets', 'commands', 'plan.mds') },
  { path: 'dist/commands/plan.md', file: path.join(DIST_COMMANDS, 'plan.md') },
];

const PLAN_COMMAND_PATHS: readonly string[] = PLAN_COMMAND_ARTIFACTS.map(a => a.path);

/** The three dynamic commands that read or file tracker issues, source and compiled. */
const DYNAMIC_COMMAND_ARTIFACTS: readonly { readonly path: string; readonly file: string }[] =
  ['dynamic-build', 'dynamic-plan', 'dynamic-tickets'].flatMap(name => [
    { path: `src/assets/commands/${name}.mds`, file: path.join(ROOT, 'src', 'assets', 'commands', `${name}.mds`) },
    { path: `dist/commands/${name}.md`, file: path.join(DIST_COMMANDS, `${name}.md`) },
  ]);

const DYNAMIC_COMMAND_PATHS: readonly string[] = DYNAMIC_COMMAND_ARTIFACTS.map(a => a.path);

/** Every artifact the host-literal scan covers. */
const HOST_LITERAL_ARTIFACTS = [...PLAN_COMMAND_ARTIFACTS, ...DYNAMIC_COMMAND_ARTIFACTS];
const HOST_LITERAL_PATHS: readonly string[] = HOST_LITERAL_ARTIFACTS.map(a => a.path);

/**
 * Each authored host and its compiled form, read directly.
 *
 * Both are needed and neither substitutes for the other: the `.mds` is what an
 * author edits, and the `.md` is what a session loads. A pin on one alone is
 * satisfied by a literal the other still carries.
 */
function hostLiteralCorpus(): CorpusEntry[] {
  return HOST_LITERAL_ARTIFACTS.map(a => ({ path: a.path, content: readFileSync(a.file, 'utf-8') }));
}

/**
 * `PLAN_USAGE_ALLOWLIST` — the plan command's usage synopsis, and nothing else.
 *
 * The synopsis annotates a literal `#42` argument, and `#42` IS GitHub's issue
 * grammar: naming the host there tells the reader which provider the example is
 * written for rather than promising them that provider. Every other site is a
 * sentence about what the operation DOES, which is provider-independent. The
 * dynamic commands have no such synopsis, so the exemption is the plan
 * command's alone — a `#### Usage notes` heading in a partial is no synopsis.
 *
 * A region rather than a line, for the reason `PROVIDER_MAP_ALLOWLIST` is one: a
 * line-scoped exemption goes stale on a rewrap.
 */
const PLAN_USAGE_ALLOWLIST = { from: '## Usage', to: '## Input' } as const;

/** The host literal the traceable-issue path must not carry. */
const HOST_ISSUE_LITERAL = 'GitHub issue';

/**
 * Every host literal the scan reports: the host issue, and the three spellings of
 * the retired GitHub-only preflight — its item name, its no-remote clause and the
 * one CLI it checked. The Workflow preamble's "no tracker CLI of any kind, `gh`
 * included" is a prohibition over every tracker, and matches none of them.
 */
const HOST_LITERALS = [HOST_ISSUE_LITERAL, 'GitHub paths', 'GitHub-dependent', '`gh` CLI'] as const;

/** The provider-neutral preflight item each dynamic command states instead. */
const TRACKER_PATHS_ITEM = '**Tracker paths:**';

/** Everything outside the usage synopsis. */
function stripPlanUsage(content: string): string {
  const start = content.indexOf(PLAN_USAGE_ALLOWLIST.from);
  if (start === -1) return content;
  const end = content.indexOf(PLAN_USAGE_ALLOWLIST.to, start);
  return end === -1 ? content.slice(0, start) : content.slice(0, start) + content.slice(end);
}

/** Named collector: host literals in the plan and dynamic commands, outside the plan command's usage synopsis. */
export function collectHostIssueLiterals(corpus: CorpusEntry[]): string[] {
  const violations: string[] = [];
  for (const entry of corpus) {
    if (!HOST_LITERAL_PATHS.includes(entry.path)) continue;
    const text = PLAN_COMMAND_PATHS.includes(entry.path) ? stripPlanUsage(entry.content) : entry.content;
    for (const line of text.split('\n')) {
      if (HOST_LITERALS.some(literal => line.includes(literal))) {
        violations.push(`${entry.path}: ${line.trim().slice(0, 90)}`);
      }
    }
  }
  return violations;
}

describe('provider-scope: the plan and dynamic commands promise a tracker issue, not a host issue', () => {
  const corpus = hostLiteralCorpus();

  it('all eight artifacts are scanned and non-empty', () => {
    expect(corpus.map(e => e.path)).toEqual(HOST_LITERAL_PATHS);
    expect(HOST_LITERAL_PATHS).toHaveLength(8);
    for (const entry of corpus) {
      expect(
        entry.content.length,
        `${entry.path} is empty — a guard over nothing forbids nothing; run \`npm run build:mds\``,
      ).toBeGreaterThan(0);
    }
  });

  it('the usage allowlist is still needed: the synopsis really does carry the literal', () => {
    // The staleness half. If the synopsis ever stops naming the host, the exemption
    // is deleted rather than carried — the failure mode an unnoticed exemption is.
    for (const file of PLAN_COMMAND_PATHS) {
      const entry = requireCorpusEntry(corpus, file);
      expect(
        entry.content.includes(HOST_ISSUE_LITERAL),
        `${file}: the usage synopsis no longer names the host — delete PLAN_USAGE_ALLOWLIST`,
      ).toBe(true);
      expect(
        stripPlanUsage(entry.content).length,
        `${file}: the usage region was not found — the synopsis anchors changed`,
      ).toBeLessThan(entry.content.length);
    }
  });

  it('each dynamic command states the provider-neutral Tracker paths item in its preflight', () => {
    for (const file of DYNAMIC_COMMAND_PATHS) {
      const content = requireCorpusEntry(corpus, file).content;
      expect(content, `${file}: no Tracker paths item`).toContain(TRACKER_PATHS_ITEM);
      expect(content, `${file}: the item must route through the Git agent`).toContain('TRACEABILITY: DEGRADED (');
    }
  });

  it('no host literal on a tracker path, in source or compiled form', () => {
    const violations = collectHostIssueLiterals(corpus);
    expect(
      violations,
      `These commands read, file or ask about issues only through the Git agent, which ` +
      `resolves its provider at spawn time. Naming the host here promises a Jira or ` +
      `Linear user an issue — or a CLI check — they will not get:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: the same collector reports a seeded literal, and spares the synopsis', () => {
    const seededOutside: CorpusEntry[] = PLAN_COMMAND_PATHS.map(p => ({
      path: p,
      content: `## Usage\n/plan #42 (GitHub issue)\n## Input\nCreate or enrich a GitHub issue?\n`,
    }));
    expect(
      collectHostIssueLiterals(seededOutside),
      'a literal below the synopsis must be reported in both artifacts',
    ).toEqual(PLAN_COMMAND_PATHS.map(p => `${p}: Create or enrich a GitHub issue?`));

    expect(
      collectHostIssueLiterals([
        { path: PLAN_COMMAND_PATHS[0], content: '## Usage\n/plan #42 (GitHub issue)\n## Input\nok\n' },
      ]),
      'the synopsis is the exemption, so a literal inside it must be silent',
    ).toEqual([]);

    expect(
      collectHostIssueLiterals([{ path: 'dist/commands/implement.md', content: 'a GitHub issue\n' }]),
      'the collector is scoped to the plan and dynamic commands — another command is not its business',
    ).toEqual([]);

    // …and over the REAL bytes, so the live arm's silence is evidence about these
    // commands' current text rather than about a synopsis-shaped fixture.
    expect(
      collectHostIssueLiterals(
        hostLiteralCorpus().map(e => ({ ...e, content: `${e.content}\nCreate or enrich a GitHub issue?\n` })),
      ),
      'a regression appended to the shipped bytes must be reported in all eight artifacts',
    ).toEqual(HOST_LITERAL_PATHS.map(p => `${p}: Create or enrich a GitHub issue?`));
  });

  it('known-bad probe: the 0e520fc GitHub-only preflights, restored into the real bytes, are reported in every dynamic artifact', () => {
    const restored = '3. **GitHub paths:** if the input is a GitHub issue URL, `gh` CLI must be authenticated.';
    const seeded = hostLiteralCorpus().map(e =>
      DYNAMIC_COMMAND_PATHS.includes(e.path) ? { ...e, content: `${e.content}\n${restored}\n` } : e);
    expect(collectHostIssueLiterals(seeded)).toEqual(DYNAMIC_COMMAND_PATHS.map(p => `${p}: ${restored.slice(0, 90)}`));
  });

  it('known-bad probe: each host literal fires alone, and the synopsis exemption is the plan command\'s only', () => {
    for (const literal of HOST_LITERALS) {
      expect(
        collectHostIssueLiterals([{ path: DYNAMIC_COMMAND_PATHS[0], content: `skip ${literal} steps\n` }]),
        literal,
      ).toEqual([`${DYNAMIC_COMMAND_PATHS[0]}: skip ${literal} steps`]);
    }
    for (const file of DYNAMIC_COMMAND_PATHS) {
      expect(
        collectHostIssueLiterals([{ path: file, content: '## Usage\n3. **GitHub paths:** check it\n## Input\n' }]),
        `${file}: a usage-shaped region is no exemption outside the plan command`,
      ).toEqual([`${file}: 3. **GitHub paths:** check it`]);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. The OTHER direction — the incumbent's grammar in the provider-neutral body
// ---------------------------------------------------------------------------
//
// Sections 1–4 look for a FOREIGN provider's literal in a file that is not that
// provider's. They cannot see the opposite failure, which is the one this tree
// actually shipped: the incumbent's grammar left behind in text that claims to be
// provider-neutral. `jira` and `linear` are foreign tokens a scan can spot;
// `#[0-9]+` is GitHub's issue grammar wearing no provider's name at all, so a
// one-directional guard reported nothing while `gather-release-evidence` parsed
// GitHub refs out of every commit range under every provider and handed back an
// empty set.
//
// SCOPE: the documents that are provider-neutral BY CONTRACT — the always-loaded
// agent and the tool-call contract. A provider's own mechanics module is where its
// grammar belongs, `references/github-api.md` is a GitHub reference, and neither
// is in scope here.
//
// PR-HOST ALLOWLIST: pull requests stay on GitHub under every provider, so a `#`
// that names a PR is correct provider-neutral text and a `gh pr`/`gh api user`/
// `gh repo view`/`gh release create` line is a PR-host mechanic, not a tracker
// one. The allowlist is per LINE and is asserted to be load-bearing.

interface GrammarPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * Spellings of an ISSUE-reference grammar that only GitHub satisfies.
 *
 * Grammar, never rendering. `#{number}` in an Output template is a token the
 * `## Reference Rendering` rule substitutes per provider; `#[0-9]+` is a parser.
 * The first is how a reference is printed and the second is what counts as one.
 */
const GITHUB_ISSUE_GRAMMAR: readonly GrammarPattern[] = [
  { name: 'the `#[0-9]` issue-ref regex', pattern: /#\[0-9\]/ },
  { name: 'a digit-only ref filter', pattern: /digit-only/i },
  { name: 'a bare-number ref rule stated as universal', pattern: /issue numbers from commit/i },
];

/** Lines that legitimately carry `#` because their subject is the PR host. */
const PR_HOST_ALLOWLIST: readonly RegExp[] = [
  /\bgh pr\b/,
  /\bgh api user\b/,
  /\bgh repo view\b/,
  /\bgh release create\b/,
  /\bPR refs are always\b/,
];

/** The provider-neutral documents, by corpus label. */
const NEUTRAL_BODY_PATHS: readonly string[] = [
  GIT_HOST,
  'dist/agents/git.md',
  'src/assets/mds/tracker/_mcp.mds',
  'dist/skills/git/references/tracker/_mcp.md',
];

/**
 * Named collector: GitHub issue-grammar spellings in a provider-neutral document,
 * outside the PR-host allowlist.
 */
export function collectGithubGrammarInNeutralBody(corpus: readonly CorpusEntry[]): string[] {
  const violations: string[] = [];
  for (const entry of corpus) {
    if (!NEUTRAL_BODY_PATHS.includes(entry.path)) continue;
    for (const line of entry.content.split('\n')) {
      if (PR_HOST_ALLOWLIST.some(allowed => allowed.test(line))) continue;
      for (const grammar of GITHUB_ISSUE_GRAMMAR) {
        if (grammar.pattern.test(line)) {
          violations.push(`${entry.path}: ${grammar.name} — ${line.trim().slice(0, 90)}`);
        }
      }
    }
  }
  return violations;
}

describe('provider-scope: the provider-neutral body states no GitHub issue grammar', () => {
  const corpus = scanCorpus();

  it('every provider-neutral document is in the corpus (the scope is not silently empty)', () => {
    for (const rel of NEUTRAL_BODY_PATHS) {
      requireCorpusEntry(corpus, rel);
    }
  });

  it('no GitHub issue grammar appears outside a provider-owned mechanics file', () => {
    const violations = collectGithubGrammarInNeutralBody(corpus);
    expect(
      violations,
      'a provider-neutral document states GitHub\'s issue grammar. Under jira or linear that ' +
      'grammar matches nothing, so the step yields an empty set and reports success — the failure ' +
      'is silent, and a foreign-token scan cannot see it because the incumbent names no ' +
      'provider:\n  ' + violations.join('\n  '),
    ).toEqual([]);
  });

  it('known-bad probe: the collector sees the grammar, and the PR-host allowlist is load-bearing', () => {
    const seed = (line: string): CorpusEntry[] =>
      [{ path: 'dist/agents/git.md', content: `## Operations\n${line}\n` }];

    expect(
      collectGithubGrammarInNeutralBody(seed('parse for `#[0-9]+` references from `refs #`')),
      'the collector must report the grammar this rule exists to remove',
    ).toEqual(['dist/agents/git.md: the `#[0-9]` issue-ref regex — parse for `#[0-9]+` references from `refs #`']);

    expect(
      collectGithubGrammarInNeutralBody(seed('retain only digit-only entries')),
      'and the filter that means the same thing in words',
    ).toHaveLength(1);

    expect(
      collectGithubGrammarInNeutralBody(seed('`gh pr view {PR_NUMBER} --json comments` matches `#[0-9]+`')),
      'a PR-host line is allowlisted — pull requests stay on GitHub under every provider',
    ).toEqual([]);

    expect(
      collectGithubGrammarInNeutralBody([
        { path: 'src/assets/mds/tracker/_github.mds', content: "grep -oE '#[0-9]+'\n" },
      ]),
      'a provider-owned mechanics file is out of scope — its grammar is what the file is for',
    ).toEqual([]);
  });
});

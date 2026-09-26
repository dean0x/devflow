/**
 * Tests for scripts/build-mds.ts
 *
 * Covers the unified frontmatter-driven MDS build pipeline.
 *
 * Scenario coverage:
 *  1. Discovery == 13 — discoverHosts() finds exactly the 13 expected basenames.
 *  2. output-dir stripped — compiled outputs contain no output-dir: key.
 *  3. Partial expansion — no un-expanded call sites or @import lines in outputs.
 *  4. MDS mechanism (regression) — happy compile, error path (isMdsError + mds:: code),
 *     isMdsError rejects non-mds values.
 *  5. Script happy-path exit — the committed sources compile cleanly and the compiled
 *     set lands in dist/commands/ (exact cardinality is pinned by scenario 6).
 *  6. Forgotten-key guard (C2) — expected-command-set: all 9 knowledge + 4 dynamic outputs present.
 *  7. Dest safety negative (C3) — a host with a wrong output-dir → exit 1 + "typo?" message.
 *  8. npm scripts (C4) — package.json has build:mds, not the two old scripts, and build chains it.
 *  9. Ignored-dir walk (P3) — a .mds with output-dir: under node_modules/ is not compiled.
 * 10. dynamic-build.md doctrine greps.
 * 11. knowledge outputs contain no feature-knowledge.cjs references.
 * 22. this file never spawns a build against the real repo root.
 *
 * EVERY build this file spawns runs against an isolated DEVFLOW_MDS_ROOT temp
 * tree, so the real src/ and dist/ trees are only ever READ. Every assertion
 * over a compiled command reads it from `BUILT_COMMANDS` — dist/commands/ inside
 * a build of a COPY of the committed sources (buildCommittedTree) — rather than
 * rebuilding the repo's own dist/ in a beforeAll. Rebuilding it here REPAIRED a
 * stale dist/ mid-suite while parallel vitest workers read those same paths, so
 * the staleness surfaced as a flake in whichever reader lost the race instead of
 * as itself (avoids PF-055). Scenario 22 is the mechanical proof of that claim
 * rather than this sentence.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { init, compile, isMdsError } from '@mdscript/mds';
import {
  KNOWLEDGE_COMMAND_HOSTS,
  DYNAMIC_COMMAND_HOSTS,
  MDS_COMMAND_HOSTS,
  MDS_PARTIALS,
  MDS_REFERENCE_PARTIALS,
  ALL_MDS_PARTIALS,
  TRACKER_PARTIAL_ADOPTERS,
  DIST_COMMAND_FILES,
} from './fixtures/mds-manifest.js';
import {
  splitFrontmatter,
  buildCommittedTree,
  cleanupCommittedTree,
  collectSpawnScoping,
  requireDistFiles,
  gitAgentSinkCorpus,
} from './helpers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'src', 'assets', 'commands');
const PARTIALS_DIR = path.join(COMMANDS_DIR, '_partials');
/** Label only — the deployed location these artifacts ship to. Never a read path. */
const DIST_COMMANDS = 'dist/commands';

/** Path to the local tsx binary (avoids npx install in temp dirs). */
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');

/** This file's own source, read by the scenario-22 self-scan. */
const SELF = import.meta.filename;

/**
 * dist/commands/ inside the temp tree built from a copy of the committed
 * sources. Assigned by the file-level beforeAll below; every compiled-output
 * assertion in this file reads from here, never from the repo's own dist/.
 */
let BUILT_COMMANDS: string;

/**
 * Several tests here spawn `tsx scripts/build-mds.ts`, and the committed-corpus
 * build compiles all 14 outputs. The 5s vitest default is far below what a cold
 * tsx start costs under full-suite load, so the file declares its own floor once
 * rather than annotating each test.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

beforeAll(async () => {
  const { run, root } = await buildCommittedTree();
  expect(run.status, `committed-tree build should exit 0.\n${run.combined}`).toBe(0);
  BUILT_COMMANDS = path.join(root, 'dist', 'commands');
}, 180_000);

afterAll(cleanupCommittedTree);

// Names come from the shared manifest (tests/fixtures/mds-manifest.ts) — the one
// definition of which files the build owns. These aliases are this file's local
// vocabulary for those sets; COMMAND_HOSTS is the manifest's MDS_COMMAND_HOSTS
// (13 command hosts) and is deliberately NOT the manifest's ALL_MDS_HOSTS, which
// also carries the generator host.
//
// DIST_FILES = all 14 deployed commands (13 compiled MDS hosts + 1 hand-authored).
// release.md is hand-authored and stays so permanently — the divergence is deliberate
// and recorded in .devflow/features/dynamic-workflow-engine/KNOWLEDGE.md (SG-13, §14.5).
// Scope rule (§14.5):
//   - compilation guards (escaped braces, un-expanded call sites) → COMMAND_HOSTS scope
//   - deployed-behaviour guards (spawn fences, gh issue absence, retired wording) → DIST_FILES scope
const KNOWLEDGE_HOSTS = KNOWLEDGE_COMMAND_HOSTS;
const DYNAMIC_HOSTS = DYNAMIC_COMMAND_HOSTS;
const COMMAND_HOSTS = MDS_COMMAND_HOSTS;
const DIST_FILES = DIST_COMMAND_FILES;

// ---------------------------------------------------------------------------
// Shared MDS initialisation — required before compile calls
// ---------------------------------------------------------------------------

let mdsInitialised = false;

async function ensureInit(): Promise<void> {
  if (!mdsInitialised) {
    await init();
    mdsInitialised = true;
  }
}

// ---------------------------------------------------------------------------
// 1. Discovery == 14
// ---------------------------------------------------------------------------

describe('MDS host discovery', () => {
  /**
   * Named collector: .mds basenames anywhere under `dir`, split into hosts
   * (no `_` prefix) and partials, plus every subdirectory found. Recursive by
   * design — a partial parked in a subdirectory is still a partial, and the
   * flat readdir that preceded this collector could not see one. `subdirs`
   * recurses on the same terms: a nested directory is reported path-qualified
   * relative to `dir` (`nested/deeper`), so the flatness assertion below means
   * "no directories anywhere under _partials/", not "none at depth 1".
   * Used by the manifest assertions AND by the known-bad probes, so a probe
   * cannot pass against a shadow implementation.
   */
  async function collectMdsNames(dir: string, depth = 0): Promise<{
    hosts: string[]; partials: string[]; subdirs: string[];
  }> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const hosts: string[] = [];
    const partials: string[] = [];
    const subdirs: string[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        subdirs.push(e.name);
        if (depth < 4) {
          const nested = await collectMdsNames(path.join(dir, e.name), depth + 1);
          hosts.push(...nested.hosts);
          partials.push(...nested.partials);
          subdirs.push(...nested.subdirs.map(s => `${e.name}/${s}`));
        }
        continue;
      }
      if (!e.isFile() || !e.name.endsWith('.mds')) continue;
      const base = path.basename(e.name, '.mds');
      (base.startsWith('_') ? partials : hosts).push(base);
    }
    return { hosts: hosts.sort(), partials: partials.sort(), subdirs: subdirs.sort() };
  }

  it('commands/ holds exactly the manifest\'s 13 command hosts (both directions)', async () => {
    // Set equality, not a count. A count stays green when one host is renamed and
    // another added in the same commit; naming the set is what pins the roster.
    const { hosts } = await collectMdsNames(COMMANDS_DIR);
    expect(hosts).toEqual([...MDS_COMMAND_HOSTS].sort());
    // Manifest length floor — floors never decrease (numeric-floors.json: dist-host-count).
    expect(MDS_COMMAND_HOSTS.length).toBeGreaterThanOrEqual(13);
  });

  it('each expected host .mds exists in commands/', async () => {
    for (const basename of COMMAND_HOSTS) {
      const sourcePath = path.join(COMMANDS_DIR, `${basename}.mds`);
      await expect(
        fs.access(sourcePath),
        `Missing host: commands/${basename}.mds`,
      ).resolves.toBeUndefined();
    }
  });

  it('commands/_partials/ holds exactly the manifest\'s 13 partials (both directions)', async () => {
    const { partials } = await collectMdsNames(PARTIALS_DIR);
    expect(partials).toEqual([...MDS_PARTIALS].sort());
  });

  /**
   * Named collector: every `.mds` under `src/` that declares no `output-dir:`,
   * as a repo-relative path — the build's own definition of a partial, applied
   * over the build's own walk rather than over one directory listing.
   *
   * The listing this replaced could only see `_partials/`, so a partial parked
   * anywhere else was counted by the build and named by nothing. Driven by the
   * set-equality arm AND by the probe below, so a collector that stopped
   * classifying cannot leave a green set-equality behind it.
   */
  async function collectRepoPartials(dir: string, depth = 0): Promise<string[]> {
    const found: string[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 6) found.push(...await collectRepoPartials(full, depth + 1));
        continue;
      }
      if (!e.isFile() || !e.name.endsWith('.mds')) continue;
      const text = await fs.readFile(full, 'utf-8');
      // The build's own classifier: a LEADING `---` block declaring output-dir:.
      // A file with no leading block has no build key at all and is a partial;
      // reading the key anywhere else would let body prose reclassify a file.
      const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
      if (/^output-dir:/m.test(block)) continue;
      found.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
    return found.sort();
  }

  it('src/ holds exactly the manifest\'s 14 partials, wherever they live (both directions)', async () => {
    const partials = await collectRepoPartials(path.join(ROOT, 'src'));
    expect(
      partials,
      'the repo-wide partial set must equal the manifest — a partial outside _partials/ that ' +
      'nothing names is one the build counts and no assertion sees',
    ).toEqual([...ALL_MDS_PARTIALS].sort());
    expect(
      partials,
      'the walk must reach outside src/assets/commands/_partials/, or widening it bought nothing',
    ).toContain(MDS_REFERENCE_PARTIALS[0]);
    // Manifest length floor — floors never decrease (numeric-floors.json: partial-count).
    expect(ALL_MDS_PARTIALS.length).toBeGreaterThanOrEqual(14);
  });

  it('known-bad probe: the repo-wide collector reports a seeded partial and skips a seeded host', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-repo-partials-probe-'));
    try {
      await fs.mkdir(path.join(tmp, 'deep', 'er'), { recursive: true });
      await fs.writeFile(path.join(tmp, 'deep', 'er', '_stray.mds'), 'body only\n', 'utf-8');
      await fs.writeFile(
        path.join(tmp, 'deep', 'a-host.mds'),
        '---\noutput-dir: dist/commands\n---\nbody\n',
        'utf-8',
      );
      const found = (await collectRepoPartials(tmp)).map(p => path.basename(p));
      expect(found, 'a partial nested outside _partials/ must be reported').toContain('_stray.mds');
      expect(found, 'a file declaring output-dir: is a host, not a partial').not.toContain('a-host.mds');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('commands/_partials/ is flat — no subdirectories at any depth', async () => {
    // The flat readdir this replaced could not distinguish "no subdirectories"
    // from "subdirectories present but unread". Assert the property directly,
    // and at every depth: the collector reports nested directories too, so a
    // directory buried two levels down cannot hide behind a depth-1 sweep.
    const { subdirs } = await collectMdsNames(PARTIALS_DIR);
    expect(
      subdirs,
      `_partials/ must stay flat; nested partials would be invisible to any flat reader: ${subdirs.join(', ')}`,
    ).toHaveLength(0);
  });

  it('known-bad probe: a nested partial and a subdirectory are both detected', async () => {
    // Mechanic 2 (H10): a seeded temp tree, never the real _partials/.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-partials-probe-'));
    try {
      await fs.writeFile(path.join(tmp, '_flat.mds'), 'x', 'utf-8');
      await fs.mkdir(path.join(tmp, 'nested', 'deeper'), { recursive: true });
      await fs.writeFile(path.join(tmp, 'nested', '_buried.mds'), 'x', 'utf-8');

      const { partials, subdirs } = await collectMdsNames(tmp);
      expect(subdirs, 'the subdirectory assertion must fire on a seeded subdir').toContain('nested');
      expect(
        subdirs,
        'the flatness assertion must see subdirectories at every depth, not just depth 1',
      ).toContain('nested/deeper');
      expect(partials, 'the recursive collector must see a partial one level down').toContain('_buried');
      expect(partials).not.toEqual([...MDS_PARTIALS].sort());
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('each partial .mds does NOT declare output-dir:', async () => {
    // Every partial the manifest names, not only the ones under _partials/: the
    // property that makes a file a partial is the absence of the key, and a
    // partial outside that directory is the case the property is easiest to lose.
    for (const rel of ALL_MDS_PARTIALS) {
      const content = await fs.readFile(path.join(ROOT, rel), 'utf-8');
      expect(content, `${rel} must not declare output-dir:`).not.toMatch(/^output-dir:/m);
    }
  });

  it('every host .mds declares a non-empty output-dir: as its last frontmatter key', async () => {
    for (const basename of COMMAND_HOSTS) {
      const content = await fs.readFile(path.join(COMMANDS_DIR, `${basename}.mds`), 'utf-8');
      const fmSplit = splitFrontmatter(content);
      expect(fmSplit, `${basename}.mds must have a frontmatter block`).not.toBeNull();
      const fm = fmSplit!.inner;
      expect(fm, `${basename}.mds must declare output-dir:`).toMatch(/^output-dir:/m);
      // output-dir: should be the last key (no non-blank lines after it inside the block)
      const lines = fm.split(/\r?\n/);
      const outputDirIdx = lines.findIndex(l => /^output-dir:/.test(l));
      const afterLines = lines.slice(outputDirIdx + 1).filter(l => l.trim() !== '');
      expect(
        afterLines,
        `${basename}.mds: output-dir: must be the last frontmatter key, but found keys after it: ${afterLines.join(', ')}`,
      ).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. output-dir stripped from compiled outputs
// ---------------------------------------------------------------------------

describe('output-dir: stripped from compiled outputs', () => {
  it('no compiled output contains output-dir:', async () => {
    let scanned = 0;
    for (const basename of COMMAND_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue; // not present — the subprocess test above covers presence
      }
      scanned++;
      expect(
        content,
        `${DIST_COMMANDS}/${basename}.md must not contain output-dir:`,
      ).not.toMatch(/^output-dir:/m);
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });

  it('every compiled output that has frontmatter still has description:', async () => {
    let scanned = 0;
    for (const basename of COMMAND_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      // Only check files that have a frontmatter block
      if (/^---\r?\n/.test(content)) {
        expect(
          content,
          `${DIST_COMMANDS}/${basename}.md must preserve description:`,
        ).toMatch(/^description:/m);
      }
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });

  it('dynamic compiled outputs preserve argument-hint:', async () => {
    let scanned = 0;
    for (const basename of DYNAMIC_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      if (/^---\r?\n/.test(content)) {
        expect(
          content,
          `${DIST_COMMANDS}/${basename}.md must preserve argument-hint:`,
        ).toMatch(/^argument-hint:/m);
      }
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Partial expansion — no un-expanded MDS call sites or @import lines
// ---------------------------------------------------------------------------

describe('partial expansion in compiled knowledge outputs', () => {
  it('no compiled knowledge command contains un-expanded {knowledge_*()} call sites', async () => {
    const callSitePattern = /\{knowledge_(?:load|writeback)\(\)\}/;
    let scanned = 0;
    for (const basename of KNOWLEDGE_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        callSitePattern.test(content),
        `${DIST_COMMANDS}/${basename}.md must not contain un-expanded MDS call sites`,
      ).toBe(false);
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });

  it('no compiled knowledge command references feature-knowledge.cjs', async () => {
    let scanned = 0;
    for (const basename of KNOWLEDGE_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        content,
        `${DIST_COMMANDS}/${basename}.md must not reference feature-knowledge.cjs`,
      ).not.toContain('feature-knowledge.cjs');
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });

  it('no compiled output contains a literal @import line', async () => {
    let scanned = 0;
    for (const basename of COMMAND_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        content,
        `${DIST_COMMANDS}/${basename}.md must not contain unexpanded @import lines`,
      ).not.toMatch(/^@import /m);
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3a. Escape-regression guard — no dist file contains literal backslash-brace
//     MDS does NOT process \{ escapes inside plain ``` fences; they ship verbatim.
//     Escapes belong only in prose outside fences. This guard catches the whole class.
// ---------------------------------------------------------------------------

describe('escape-regression guard: no dist command contains literal backslash-brace (\\{)', () => {
  it('no compiled dist/commands/*.md contains the two-character sequence \\{ (backslash-brace)', async () => {
    // COMMAND_HOSTS scope is correct here (not DIST_FILES): this guard checks MDS compiler
    // output only.  release.md is hand-authored and not produced by the MDS compiler —
    // escape-regression is meaningless for it (SG-13 / DIST_FILES vs COMMAND_HOSTS divergence).
    let scanned = 0;
    for (const basename of COMMAND_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        content,
        `${DIST_COMMANDS}/${basename}.md must not contain literal \\{ (MDS escape leak inside plain fence)`,
      ).not.toContain('\\{');
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3b. decisions_load host adoption — all knowledge hosts compile the index.md read
// ---------------------------------------------------------------------------

describe('decisions_load adoption in compiled knowledge command outputs', () => {
  it('all 9 knowledge command outputs contain the .devflow/learning/index.md read (decisions_load expansion)', async () => {
    let scanned = 0;
    for (const basename of KNOWLEDGE_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        // file missing — covered by the command-set guard above; skip here
        continue;
      }
      scanned++;
      expect(
        content,
        `${DIST_COMMANDS}/${basename}.md must contain .devflow/learning/index.md (decisions_load expansion)`,
      ).toContain('.devflow/learning/index.md');
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });

  it('no compiled knowledge command contains a bare decisions-index.cjs reference (ADR-007: retired)', async () => {
    let scanned = 0;
    for (const basename of KNOWLEDGE_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        content,
        `${DIST_COMMANDS}/${basename}.md must not reference decisions-index.cjs`,
      ).not.toContain('decisions-index.cjs');
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. MDS mechanism regression
// ---------------------------------------------------------------------------

describe('MDS compiler mechanism', () => {
  it('compiles a minimal valid .mds source to a non-empty Markdown string', async () => {
    await ensureInit();
    const validSource = '# My Command\n\nThis is a valid MDS template.\n';
    const result = compile(validSource);
    expect(typeof result.output).toBe('string');
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.output).toContain('My Command');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('throws an MdsError for a source that references an undefined variable', async () => {
    await ensureInit();
    const malformedSource = '# Title\n\n@{UNDEFINED_VAR_THAT_DOES_NOT_EXIST}\n';
    let threw = false;
    try {
      compile(malformedSource);
    } catch (err) {
      threw = true;
      expect(isMdsError(err), 'error should be an MdsError with mds:: code').toBe(true);
      if (isMdsError(err)) {
        expect(err.code).toMatch(/^mds::/);
      }
    }
    expect(threw, 'compile() must throw on malformed MDS source').toBe(true);
  });

  it('isMdsError correctly identifies MDS errors vs generic values', () => {
    expect(isMdsError(new Error('generic'))).toBe(false);
    expect(isMdsError(null)).toBe(false);
    expect(isMdsError('string')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Script happy-path exit
// ---------------------------------------------------------------------------

describe('build-mds.ts script subprocess contract', () => {
  it('exits 0 when the committed sources compile cleanly (CI path)', async () => {
    // The committed corpus, compiled into a copy of itself — the same sources CI
    // builds, with the repo's own dist/ left alone (see the header, and the
    // scenario-22 self-scan that enforces it).
    const { run } = await buildCommittedTree();
    expect(
      run.status,
      `build-mds.ts should exit 0 but exited ${run.status}.\n${run.combined}`,
    ).toBe(0);
    // Non-vacuity: an exit code alone says nothing about what was compiled.
    expect(run.combined, 'the build must report the hosts it compiled').toMatch(
      /\d+ host\(s\) to compile:/,
    );
  });

  it('produces at least one .md command file after the script runs', async () => {
    let foundAtLeastOne = false;
    for (const basename of COMMAND_HOSTS) {
      try {
        await fs.access(path.join(BUILT_COMMANDS, `${basename}.md`));
        foundAtLeastOne = true;
        break;
      } catch {
        // continue
      }
    }
    expect(foundAtLeastOne, 'at least one compiled .md command file should exist after build').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Forgotten-key guard (C2) — expected command set all present post-build
// ---------------------------------------------------------------------------

describe('expected-command-set guard (C2)', () => {
  it('all 9 knowledge command outputs exist post-build', async () => {
    for (const basename of KNOWLEDGE_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      await expect(
        fs.access(outputPath),
        `Expected compiled output missing: ${DIST_COMMANDS}/${basename}.md`,
      ).resolves.toBeUndefined();
    }
  });

  it('all 4 dynamic command outputs exist post-build', async () => {
    for (const basename of DYNAMIC_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      await expect(
        fs.access(outputPath),
        `Expected compiled output missing: ${DIST_COMMANDS}/${basename}.md`,
      ).resolves.toBeUndefined();
    }
  });

  it('a build of the committed sources holds exactly the manifest\'s 14 output files (both directions)', async () => {
    // The 1 hand-authored file is release.md, copied verbatim by build-mds.ts.
    // Set equality names which files must be there; the length pin below keeps
    // the SG-13 divergence (14 deployed vs 13 compiled) explicit.
    const files = await fs.readdir(BUILT_COMMANDS);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort();
    expect(
      mdFiles,
      `the built dist/commands/ must hold exactly the manifest's output set, got: ${mdFiles.join(', ')}`,
    ).toEqual([...DIST_COMMAND_FILES].sort());
    expect(
      DIST_COMMAND_FILES.length,
      'DIST_COMMAND_FILES = 13 compiled hosts + release.md (SG-13, permanent divergence)',
    ).toBe(14);
  });

  it('the deployed dist/commands/ holds the same set (read-only, fail-loud when unbuilt)', () => {
    // Read-only companion to the assertion above: the set is checked where the
    // installer actually reads it from. requireDistFiles throws with a build hint
    // rather than skipping, so an unbuilt tree fails here instead of quietly
    // passing (PF-018) — and nothing in this file repairs it (PF-055). Whether
    // those bytes still match src/ is a separate, byte-level check, owned by
    // tests/build-mds-generator-hosts.test.ts.
    expect([...requireDistFiles()].sort()).toEqual([...DIST_COMMAND_FILES].sort());
  });
});

// ---------------------------------------------------------------------------
// 7. Dest safety negative (C3) — wrong output-dir → exit 1
// ---------------------------------------------------------------------------

describe('dest safety negative (C3)', () => {
  it('exits 1 with "typo?" message when output-dir is not the expected dist/commands', async () => {
    // The hazard: writing a temp .mds directly into the real src/assets/commands/
    // races packaging.test.ts which also reads that directory (avoids PF-011).
    // Fix: create an isolated temp tree and point build-mds.ts there via
    // DEVFLOW_MDS_ROOT so the real command tree is never touched.
    const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-mds-dest-test-'));
    try {
      const cmdDir = path.join(fakeRoot, 'src', 'assets', 'commands');
      await fs.mkdir(cmdDir, { recursive: true });
      await fs.writeFile(
        path.join(cmdDir, '_test-dest-safety.mds'),
        '---\ndescription: dest safety test\noutput-dir: dist/wrong-dir\n---\n\n# Test\n',
        'utf-8',
      );

      const result = spawnSync(
        TSX_BIN,
        [path.join(ROOT, 'scripts', 'build-mds.ts')],
        {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 60_000,
          env: { ...process.env, DEVFLOW_MDS_ROOT: fakeRoot },
        },
      );

      if (result.error) throw result.error;

      expect(
        result.status,
        `Expected exit 1 for wrong output-dir but got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      ).toBe(1);

      const combined = (result.stdout ?? '') + (result.stderr ?? '');
      expect(
        combined,
        'Expected "typo?" in output for wrong output-dir',
      ).toMatch(/typo\?/i);
    } finally {
      await fs.rm(fakeRoot, { recursive: true, force: true });
    }
  });

  it('exits 1 with "empty" message when a host declares output-dir: with no value', async () => {
    // Same isolation discipline as the dest-safety test above: isolated temp tree
    // via DEVFLOW_MDS_ROOT so the real src/assets/commands/ is never touched and
    // the packaging.test.ts read cannot observe a transient .mds file.
    // Regression guard: an earlier regex used (.+?), which required >=1 char and
    // silently reclassified an empty key as a partial — dropping the command from
    // the build.
    const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-mds-empty-test-'));
    try {
      const cmdDir = path.join(fakeRoot, 'src', 'assets', 'commands');
      await fs.mkdir(cmdDir, { recursive: true });
      await fs.writeFile(
        path.join(cmdDir, '_test-empty-output-dir.mds'),
        '---\ndescription: empty output-dir test\noutput-dir:\n---\n\n# Test\n',
        'utf-8',
      );

      const result = spawnSync(
        TSX_BIN,
        [path.join(ROOT, 'scripts', 'build-mds.ts')],
        {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 60_000,
          env: { ...process.env, DEVFLOW_MDS_ROOT: fakeRoot },
        },
      );

      if (result.error) throw result.error;

      expect(
        result.status,
        `Expected exit 1 for empty output-dir: but got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      ).toBe(1);

      const combined = (result.stdout ?? '') + (result.stderr ?? '');
      expect(
        combined,
        'Expected an "empty" hard-fail message for a valueless output-dir:',
      ).toMatch(/empty/i);
    } finally {
      await fs.rm(fakeRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 8. npm scripts (C4)
// ---------------------------------------------------------------------------

describe('npm scripts (C4)', () => {
  let pkg: Record<string, unknown>;

  beforeAll(async () => {
    const raw = await fs.readFile(path.join(ROOT, 'package.json'), 'utf-8');
    pkg = JSON.parse(raw) as Record<string, unknown>;
  });

  it('package.json has build:mds script', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['build:mds']).toBeDefined();
    expect(scripts['build:mds']).toContain('build-mds.ts');
  });

  it('package.json does not have the old build:recipes or build:knowledge scripts', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['build:recipes']).toBeUndefined();
    expect(scripts['build:knowledge']).toBeUndefined();
  });

  it('build script chains build:mds (not build:recipes or build:knowledge)', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    const build = scripts['build'] ?? '';
    expect(build).toContain('build:mds');
    expect(build).not.toContain('build:recipes');
    expect(build).not.toContain('build:knowledge');
  });
});

// ---------------------------------------------------------------------------
// 9. Ignored-dir walk (P3) — .mds under ignored dir is not compiled
// ---------------------------------------------------------------------------

describe('ignored-dir walk (P3)', () => {
  it('a .mds with output-dir: planted under node_modules/ is not compiled', async () => {
    // The root the build walks comes from DEVFLOW_MDS_ROOT, never from cwd:
    // build-mds.ts resolves its fallback root from the script's own location, so
    // spawning with `cwd: tmpRoot` alone would have walked and REWRITTEN the real
    // repo while asserting about a tmpRoot the build never looked at — green for
    // the wrong reason (avoids PF-018), and a writer into shared dist/ (PF-055).
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-walk-'));
    try {
      const fakeNm = path.join(tmpRoot, 'node_modules', 'some-pkg');
      await fs.mkdir(fakeNm, { recursive: true });
      await fs.writeFile(
        path.join(fakeNm, 'stray.mds'),
        '---\ndescription: stray\noutput-dir: out/nope/commands\n---\n\n# Stray\n',
        'utf-8',
      );

      const scriptPath = path.join(ROOT, 'scripts', 'build-mds.ts');
      const result = spawnSync(TSX_BIN, [scriptPath], {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 60_000,
        env: { ...process.env, DEVFLOW_MDS_ROOT: tmpRoot },
      });
      if (result.error) throw result.error;

      // Only the stray exists, and it is skipped → no hosts discovered at all,
      // which is the build's own hard-fail. That the walk REACHED the planted
      // tree (rather than never looking) is what the message proves.
      expect(
        result.status,
        `expected exit 1 (no hosts discovered).\n${result.stdout}${result.stderr}`,
      ).toBe(1);
      expect((result.stdout ?? '') + (result.stderr ?? '')).toMatch(/No MDS host files discovered/);

      const strayShouldNotExist = path.join(tmpRoot, 'out', 'nope', 'commands', 'stray.md');
      let exists = false;
      try {
        await fs.access(strayShouldNotExist);
        exists = true;
      } catch {
        // expected — file should not exist
      }
      expect(exists, 'stray.mds under node_modules/ must not be compiled').toBe(false);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 10. dynamic-build.md doctrine greps
// ---------------------------------------------------------------------------

describe('compiled dynamic-build.md: Gate-1-twice cadence + build execution doctrine', () => {
  let compiled: string;

  beforeAll(async () => {
    compiled = await fs.readFile(
      path.join(BUILT_COMMANDS, 'dynamic-build.md'),
      'utf-8',
    );
  });

  it('renders the build_execution_doctrine (background Bash + Monitor poll)', () => {
    expect(compiled).toContain('Build execution doctrine');
    expect(compiled).toContain('run_in_background');
    expect(compiled).toContain('Monitor');
  });

  it('runs ONE final Gate 1 (#2) after the review pass', () => {
    expect(compiled).toContain('gate1-final');
    expect(compiled).toContain('Gate 1 #2');
  });

  it('spawns Simplify and Scrutinize exactly twice each (Gate 1 #1 + Gate 1 #2)', () => {
    // applies ADR-003: obsolete-forever strings ('Gate 1 only — no Gate 2 for review-fixes',
    // 'Simplify recent fixes', '9-pillar review of recent fixes') dropped; count assertions
    // are the real structural guard under the new single-pass architecture.
    const simplifyCount = (compiled.match(/agentType: "Simplify"/g) ?? []).length;
    const scrutinizeCount = (compiled.match(/agentType: "Scrutinize"/g) ?? []).length;
    expect(simplifyCount, 'Simplify should run only in the two Gate-1 passes').toBe(2);
    expect(scrutinizeCount, 'Scrutinize should run only in the two Gate-1 passes').toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 11. knowledge outputs contain no feature-knowledge.cjs references (ported)
// ---------------------------------------------------------------------------

describe('compiled knowledge commands — no stale call-site references', () => {
  it('no compiled command contains a literal {knowledge_*()} call site', async () => {
    // COMMAND_HOSTS scope is correct here (not DIST_FILES): un-expanded call-site detection
    // applies to MDS compiler outputs only.  release.md is hand-authored — it never
    // contains MDS call sites (SG-13 / DIST_FILES vs COMMAND_HOSTS divergence).
    const callSitePattern = /\{knowledge_(?:load|writeback)\(\)\}/;
    let scanned = 0;
    for (const basename of COMMAND_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        callSitePattern.test(content),
        `${DIST_COMMANDS}/${basename}.md must not contain un-expanded MDS call sites`,
      ).toBe(false);
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 12. dynamic-build.md streamlining doctrine (C1–C9)
// Pins the exact prose authored in Phase 1. Each assertion corresponds to a
// named forensic change (C1–C9) in the streamlining PR.
// ---------------------------------------------------------------------------

describe('compiled dynamic-build.md: streamlining doctrine (C1–C9)', () => {
  let compiled: string;

  beforeAll(async () => {
    compiled = await fs.readFile(
      path.join(BUILT_COMMANDS, 'dynamic-build.md'),
      'utf-8',
    );
  });

  it('C1: single-pass review — DELTA REVIEW and multi-cycle machinery absent, single-pass invariant present', () => {
    expect(compiled).toContain('The review pass runs exactly ONCE');
    expect(compiled).not.toContain('DELTA REVIEW');
    expect(compiled).not.toContain('reviewBaseSha');
    expect(compiled).not.toContain('maxCycles');
    expect(compiled).not.toContain('cyclesRun');
    expect(compiled).not.toContain('fixedInCycle');
    expect(compiled).not.toContain('preFixSha');
    expect(compiled).not.toContain('allCoverageGaps');
    // Skeleton guard: the doctrine prose above can stay intact while a cycle loop
    // creeps back into the authored script body. Pin the loop construct's absence too.
    expect(compiled).not.toContain('for (let cycle');
    expect(compiled).toContain('The pass runs exactly ONCE');
    // rename-guard: the old review_loop export token and prose phrase must be absent
    // after the review_loop → review_pass rename (ADR-003). Grep confirms these are
    // absent in dist today; these assertions would fire if a stray partial re-introduced them.
    expect(compiled).not.toContain('review_loop');
    expect(compiled).not.toMatch(/review[- ]loop/i);
    // Unique-block pins — avoids PF-018 (deleting either block leaves test green without these)
    // Invariant #7 unique: appears only in engine_invariants() block, not in review_pass() prose
    expect(compiled).toContain('Never author additional cycles or a delta re-review of fix commits');
    // review_pass() prose unique: appears only in the review → verify → fix doctrine, not in invariant #7
    expect(compiled).toContain('Budget scales roster and verification votes, NEVER the number of passes');
  });

  it('C2: Review agent result contract — reviewed: true, coverage-gap handling, chunk/stagger cadence', () => {
    expect(compiled).toContain('reviewed: true');
    expect(compiled).toContain('review coverage incomplete');
    expect(compiled).toContain('coverageGaps.length === 0');
    // Chunk/stagger: Review agents dispatched in bounded parallel batches
    expect(compiled).toContain('const chunk = await parallel(reviewThunks.slice(i, i + chunkSize));');
  });

  it('C3: findings disposition replaces old survivingFindings raw dump', () => {
    expect(compiled).toContain('Findings disposition');
    expect(compiled).toContain('max 5 findings');
    // Old line removed — single-quoted so ${} is treated as a literal string, not a template
    expect(compiled).not.toContain('Surviving findings: ${JSON.stringify(reviewResult.survivingFindings)}');
  });

  it('C4: FAIL-FIXED verdict label for fix-and-continue paths', () => {
    expect(compiled).toContain('FAIL-FIXED');
  });

  it('C5: wave hardening — ALWAYS ready rule, cascade quarantine, never kills the wave, Design reader', () => {
    expect(compiled).toContain('ALWAYS ready');
    expect(compiled).toContain('cascade');
    expect(compiled).toContain('never kills the wave');
    expect(compiled).toContain('agentType: "Design"');
  });

  it('C6: build execution doctrine — cheapest-sufficient, one gate per phase, NEVER wrapped, bounded re-arm', () => {
    expect(compiled).toContain('Cheapest-sufficient validation');
    expect(compiled).toContain('One build gate per phase');
    expect(compiled).toContain('NEVER wrapped in');
    expect(compiled).toContain('re-arm');
  });

  it('C8: scratch path is run-unique — old fixed filename /tmp/df-wf-check.js is gone', () => {
    // Absence guard: old fixed name must be gone.
    expect(compiled).not.toContain('/tmp/df-wf-check.js');
    // Positive guards: new run-unique prefix and doctrine phrase must be present so that
    // removing or renaming the scratch-path mechanism causes this test to fail.
    expect(compiled).toContain('df-wf-check-');
    expect(compiled).toContain('run-unique scratch file');
  });

  it('C9: no unauthorized side-effects doctrine — stated provider-neutrally (P2-S12, GAP-41)', () => {
    // Invariant #6 is a SAFETY rule, not prose. Bound to one vendor it stops
    // applying the moment a second tracker exists — a real regression, which is
    // why the disposition here is guard-with-test rather than documentation.
    expect(
      compiled,
      'the invariant must forbid side-effects on whatever tracker is resolved',
    ).toContain('No unauthorized tracker or remote side-effects');
    expect(compiled).toContain('issues/PRs on the tracker');
    expect(
      compiled,
      'the rule must say it is not vendor-scoped, or a later reader re-narrows it',
    ).toContain('This applies to whatever tracker is resolved, not to one vendor');
    // Non-vacuous against the exact pre-neutralisation literal.
    expect(
      compiled,
      'the GitHub-bound wording must be gone, not merely accompanied by the neutral one',
    ).not.toContain('No unauthorized GitHub side-effects');
    // The rule's FORCE must survive the rewording — a neutral sentence that
    // dropped "NEVER" would pass a wording check and forbid nothing.
    expect(compiled).toContain('Sub-agents NEVER create issues/PRs on the tracker');
    expect(compiled).toContain('beyond the ticket-authorized branch');
  });

  it('C9b: the sandbox note does not read as gh-only (P2-S12)', () => {
    // `gh` stays named — it is the concrete CLI an author would reach for, and
    // naming it is what makes the denial legible. What changed is the scope:
    // the denial is over any tracker CLI, not over one binary.
    expect(compiled).toContain('NO filesystem / Node.js / CLI access');
    expect(compiled).toContain('no tracker CLI of any kind, `gh` included');
    expect(compiled).not.toContain('NO filesystem / Node.js / `gh` CLI access');
  });

  it('C10: post-wave-report Git spawn survived the dynamic-wave removal', () => {
    // The block was REWRITTEN this cycle — pin the current load-bearing literals.
    // Each literal verified against dist/commands/dynamic-build.md after npm run build:mds.
    expect(compiled).toContain('OPERATION: post-wave-report');
    expect(compiled).toContain('TRACKING_ISSUE:');
    expect(compiled).toContain('WAVE_REPORT_PATH: .devflow/docs/waves/');
    expect(compiled).toContain('WAVE_ID:');
    expect(compiled).toContain('WORKTREE_PATH:');  // new this cycle
    // WAVE-mode guard sentence
    expect(compiled).toContain('skip this step entirely in SINGLE mode');
    // DEGRADED-visibility literal when no tracking issue was resolved
    expect(compiled).toContain('TRACEABILITY: DEGRADED (no tracking issue for this run)');
    // The dedup marker literal is NOT pinned here any more. GAP-20: the operation
    // owns the marker format; a caller that restates it has already diverged once
    // and produced duplicate comments. The caller now says only that the Git agent
    // deduplicates via its own marker, and the marker literal is pinned where it
    // lives — see the `<!-- devflow:` negative guard in §23 below.
    expect(compiled).toContain('deduplicates via its own marker');
  });

  it('meta.phases matches every phase("…") call site', () => {
    // Two phases: arrays exist in the compiled file: a placeholder ["..."] in the
    // Workflow runtime contract example and the real SINGLE-mode meta declaration.
    // Filter to the real declaration (does not contain '"..."').
    // The WAVE skeleton uses the same phases conceptually but does not declare its own
    // meta block with a phases array — scoped to SINGLE-mode by design.
    const phasesMatches = [...compiled.matchAll(/phases:\s*(\[[^\]]*\])/g)];
    const realMatch = phasesMatches.find(m => !m[1].includes('"..."'));
    expect(realMatch, 'real SINGLE-mode meta.phases not found in compiled output').toBeDefined();
    const declared = JSON.parse(realMatch![1].replace(/'/g, '"')) as string[];
    // Use trailing-comma regex to exclude the prose mention of phase("…") at the pre-flight
    // checklist (no comma follows the closing paren there), which is NOT a call site.
    const called = [...compiled.matchAll(/\bphase\("([^"]+)",/g)].map(m => m[1] as string);
    expect(declared.length, 'phases array is empty — guard is vacuous').toBeGreaterThan(0);
    expect(new Set(called)).toEqual(new Set(declared));
  });
});

// ---------------------------------------------------------------------------
// 13. --dry-run removal (C7)
// dynamic-build, plan, tickets must NOT contain --dry-run.
// dynamic-profile must still contain it (untouched per plan).
// ---------------------------------------------------------------------------

describe('compiled dynamic commands: --dry-run removal (C7)', () => {
  const DRY_RUN_ABSENT = ['dynamic-build', 'dynamic-plan', 'dynamic-tickets'] as const;

  it('dynamic-build, plan, tickets do NOT contain --dry-run', async () => {
    for (const basename of DRY_RUN_ABSENT) {
      const content = await fs.readFile(path.join(BUILT_COMMANDS, `${basename}.md`), 'utf-8');
      expect(
        content,
        `${basename}.md must not contain --dry-run after C7 removal`,
      ).not.toContain('--dry-run');
    }
  });

  it('compiled dynamic-profile.md still contains --dry-run (untouched by plan)', async () => {
    const content = await fs.readFile(path.join(BUILT_COMMANDS, 'dynamic-profile.md'), 'utf-8');
    expect(content).toContain('--dry-run');
  });
});

// ---------------------------------------------------------------------------
// 14. compliance wiring in compiled host commands (installed-skill gate) and the
//     mechanism inputs that replaced the op-level COMPLIANCE key (#362)
//
// Current guard state:
//   - code-review.md and plan.md contain COMPLIANCE_SKILL_INSTALLED and the skill
//     path — the review lens (compliance focus, compliance Design agent), which is
//     the one command-layer use of the skill check the evidence policy did not take
//   - no compiled dist command carries a COMPLIANCE: key (the AC-32 successor):
//     the Git ops take ISSUE_REQUIRED / APPLY_CONVENTIONS instead
//   - implement.md passes each mechanism input exactly once, in its Git setup-task
//     spawn
//   - every mechanism-input key line in every dist command sits in a Git-agent
//     call — never a Code agent, including inside a multi-agent recipe fence
//   - no compiled dist/commands/*.md contains COMPLIANCE_ENABLED, devflow-compliance
//     or comment-pr (retired op)
// ---------------------------------------------------------------------------

/** The three mechanism inputs a command passes the Git agent (#362). */
const MECHANISM_KEYS = ['ISSUE_REQUIRED', 'APPLY_CONVENTIONS', 'REQUIRE_NON_AUTHOR_APPROVAL'] as const;

/** A spawn-fence key line naming one of the mechanism inputs. */
const MECHANISM_KEY_LINE_RE = new RegExp(`^[ \\t]*"?(?:${MECHANISM_KEYS.join('|')}):\\s`, 'm');

/** Named collector: spawn-fence lines that pass the retired op-level COMPLIANCE key. */
function collectComplianceKeyLines(basename: string, content: string): string[] {
  return content
    .split('\n')
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /^[ \t]*"?COMPLIANCE:\s/.test(line))
    .map(({ line, i }) => `${basename}:${i + 1}: ${line.trim()}`);
}

/**
 * Named collector: mechanism-input key lines outside a Git-agent call.
 *
 * A prose fence is one spawn: it must be a Git spawn and must not also be a Code
 * spawn. A language-tagged recipe fence holds many agent() calls of different
 * types, so it is attributed PER CALL — each `agent(` segment carrying a key line
 * must name `agentType: "Git"`. Fence-level attribution would credit a Code call's
 * key to the Git call beside it. Returns the violations and the key lines seen, so
 * the caller can hold the guard non-vacuous.
 */
function collectMechanismKeysOutsideGit(basename: string, content: string): { violations: string[]; keyLines: number } {
  const violations: string[] = [];
  let keyLines = 0;
  const fencePattern = /```([^\n]*)\n[\s\S]*?```/g;
  let match;
  while ((match = fencePattern.exec(content)) !== null) {
    const block = match[0];
    if (!MECHANISM_KEY_LINE_RE.test(block)) continue;
    const isRecipe = match[1].trim().length > 0;
    const units = isRecipe ? block.split(/(?=\bagent\()/) : [block];
    for (const unit of units) {
      const n = unit.split('\n').filter(l => MECHANISM_KEY_LINE_RE.test(l)).length;
      if (n === 0) continue;
      keyLines += n;
      const git = isRecipe ? /agentType:\s*"Git"/.test(unit) : /Agent\(subagent_type="Git"/.test(unit);
      const code = isRecipe ? /agentType:\s*"Code"/.test(unit) : /Agent\(subagent_type="Code"/.test(unit);
      if (!git || code) violations.push(`${basename}: fence at offset ${match.index} passes a mechanism input outside a Git call`);
    }
  }
  return { violations, keyLines };
}

describe('compliance wiring in compiled host commands (review lens) + mechanism inputs (#362)', () => {
  // The review lens keeps the installed-skill check; nothing else at the command
  // layer gates on it once the evidence policy owns the mechanism inputs.
  const SKILL_CHECK_HOSTS: Record<string, string> = {
    'code-review': DIST_COMMANDS,
    'plan':        DIST_COMMANDS,
  };

  it('code-review.md and plan.md contain COMPLIANCE_SKILL_INSTALLED and the skill path (review lens)', async () => {
    for (const [basename, destRelDir] of Object.entries(SKILL_CHECK_HOSTS)) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      const content = await fs.readFile(outputPath, 'utf-8');
      expect(
        content,
        `${destRelDir}/${basename}.md must contain COMPLIANCE_SKILL_INSTALLED`,
      ).toContain('COMPLIANCE_SKILL_INSTALLED');
      expect(
        content,
        `${destRelDir}/${basename}.md must contain the compliance skill path`,
      ).toContain('skills/devflow:compliance/SKILL.md');
    }
  });

  it('implement.md passes each mechanism input exactly once, in its Git setup-task spawn (AC-32 successor)', async () => {
    const content = await fs.readFile(path.join(BUILT_COMMANDS, 'implement.md'), 'utf-8');
    expect(content, 'implement.md must contain ISSUE_NUMBER (issue-first threading, Phase E)').toContain('ISSUE_NUMBER');
    expect(content, 'implement.md must not contain COMPLIANCE_ENABLED').not.toContain('COMPLIANCE_ENABLED');
    for (const key of ['ISSUE_REQUIRED', 'APPLY_CONVENTIONS'] as const) {
      const lines = content.split('\n').filter(l => l === `${key}: {${key}}`);
      expect(lines, `implement.md must pass \`${key}: {${key}}\` exactly once`).toHaveLength(1);
    }
    const setupFence = [...content.matchAll(/```[^\n]*\n[\s\S]*?```/g)]
      .map(m => m[0])
      .find(f => f.includes('Agent(subagent_type="Git")') && f.includes('OPERATION: setup-task'));
    expect(setupFence, 'implement.md has no Git setup-task spawn fence').toBeDefined();
    expect(setupFence).toContain('ISSUE_REQUIRED: {ISSUE_REQUIRED}');
    expect(setupFence).toContain('APPLY_CONVENTIONS: {APPLY_CONVENTIONS}');
  });

  it('no compiled dist/commands/*.md passes COMPLIANCE:, or contains COMPLIANCE_ENABLED, devflow-compliance, or comment-pr', async () => {
    // M8: DIST_FILES (not COMMAND_HOSTS) — release.md is a hand-authored dist file that must
    // pass the same cleanliness checks. DIST_FILES entries already include '.md'.
    let scanned = 0;
    const keyLines: string[] = [];
    for (const basename of DIST_FILES) {
      const content = await fs.readFile(path.join(BUILT_COMMANDS, basename), 'utf-8');
      scanned++;
      keyLines.push(...collectComplianceKeyLines(basename, content));
      expect(content, `${basename} must not contain COMPLIANCE_ENABLED`).not.toContain('COMPLIANCE_ENABLED');
      expect(content, `${basename} must not contain devflow-compliance`).not.toContain('devflow-compliance');
      // comment-pr was retired; post-review-summary replaces it.
      expect(content, `${basename} must not contain comment-pr (retired operation)`).not.toContain('comment-pr');
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBe(DIST_FILES.length);
    expect(keyLines, 'the op-level COMPLIANCE key is retired (#362) — pass the mechanism inputs instead').toEqual([]);
  });

  it('known-bad probe: the 825077e COMPLIANCE: spawn lines are reported by the same collector', () => {
    const seeded = [
      '"OPERATION: setup-task',
      'COMPLIANCE: {enabled if COMPLIANCE_SKILL_INSTALLED, otherwise (none)}',
      'COMPLIANCE: ${COMPLIANCE}',
      'Pass `COMPLIANCE: \\{COMPLIANCE\\}` to Git agent spawns.',
    ].join('\n');
    expect(collectComplianceKeyLines('probe.md', seeded)).toHaveLength(2);
  });

  it('every mechanism-input key line in every dist command sits in a Git-agent call (spawn-scoped guard)', async () => {
    let scanned = 0;
    let keyLines = 0;
    const violations: string[] = [];
    for (const basename of DIST_FILES) {
      const content = await fs.readFile(path.join(BUILT_COMMANDS, basename), 'utf-8');
      scanned++;
      const found = collectMechanismKeysOutsideGit(basename, content);
      violations.push(...found.violations);
      keyLines += found.keyLines;
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBe(DIST_FILES.length);
    // implement 2 + code-review 1 + bug-analysis 1 + dynamic-build's recipe 2.
    expect(keyLines, 'fewer mechanism-key lines than the four passing commands carry — is the guard reading them?').toBeGreaterThanOrEqual(6);
    expect(violations, 'mechanism inputs are Git-agent inputs only:\n' + violations.join('\n')).toEqual([]);
  });

  it('known-bad probe: a key in a Code spawn, and in a recipe Code call beside a Git call, are both reported', () => {
    const codeSpawn = [
      '```',
      'Agent(subagent_type="Code"):',
      '"TASK_ID: x',
      'APPLY_CONVENTIONS: {APPLY_CONVENTIONS}"',
      '```',
    ].join('\n');
    const recipe = [
      '```js',
      'await phase("setup", () => agent(`OPERATION: setup-task',
      'ISSUE_REQUIRED: ${ISSUE_REQUIRED}`, { agentType: "Git" }));',
      'await phase("implement", () => agent(`Implement it.',
      'APPLY_CONVENTIONS: ${APPLY_CONVENTIONS}`, { agentType: "Code" }));',
      '```',
    ].join('\n');
    expect(collectMechanismKeysOutsideGit('probe.md', codeSpawn).violations).toHaveLength(1);
    const mixed = collectMechanismKeysOutsideGit('probe.md', recipe);
    expect(mixed.keyLines).toBe(2);
    expect(mixed.violations, 'only the Code call is out of scope; the Git call beside it is not').toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §15  Phase D traceability op guards — code-review (Part 2, Step 2.3)
//      post-review-summary replaces retired comment-pr; REVIEW_TIMESTAMP input wired (I44 dedup fix)
//      Guard change (I16/I44): The old guard pinned the devflow:review-summary marker literal in the
//      compiled command. Per the corrected contract, callers pass op inputs — they do not restate what
//      the op writes internally. §15 now asserts that REVIEW_TIMESTAMP is passed as an input to the
//      post-review-summary spawn. The marker literal check is dropped from the compiled-command surface
//      (the marker contract is verified on the agent side via git.md — see post-review-summary D7 section).
// ---------------------------------------------------------------------------

describe('Phase D traceability ops — code-review.md (Part 2, Step 2.3)', () => {
  it('code-review.md contains post-review-summary and passes REVIEW_TIMESTAMP input', async () => {
    const outputPath = path.join(BUILT_COMMANDS, 'code-review.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(
      content,
      'code-review.md must reference the post-review-summary Git op',
    ).toContain('post-review-summary');
    // I44: caller must pass REVIEW_TIMESTAMP so the op can dedup on cycle+timestamp pair,
    // not cycle alone. A re-review in the same cycle posts its own comment; a re-run of
    // the same review (same timestamp) still deduplicates.
    expect(
      content,
      'code-review.md must pass REVIEW_TIMESTAMP to post-review-summary spawn (I44 cycle+ts dedup)',
    ).toContain('REVIEW_TIMESTAMP');
  });

  it('code-review.md does not contain comment-pr (retired op)', async () => {
    const outputPath = path.join(BUILT_COMMANDS, 'code-review.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(
      content,
      'code-review.md must not reference the retired comment-pr op',
    ).not.toContain('comment-pr');
  });
});

// ---------------------------------------------------------------------------
// §16  Phase D traceability op guards — resolve (Part 2, Step 2.4)
//      fetch-review-threads, resolve-review-threads, post-resolution-summary,
//      check-merge-readiness, Third-Party Threads section, evidence-policy gates (#362)
// ---------------------------------------------------------------------------

describe('Phase D traceability ops — resolve.md (Part 2, Step 2.4)', () => {
  it('resolve.md contains Phase D traceability ops', async () => {
    const outputPath = path.join(BUILT_COMMANDS, 'resolve.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content, 'resolve.md must contain fetch-review-threads op').toContain('fetch-review-threads');
    expect(content, 'resolve.md must contain resolve-review-threads op').toContain('resolve-review-threads');
    expect(content, 'resolve.md must contain post-resolution-summary op').toContain('post-resolution-summary');
    expect(content, 'resolve.md must contain check-merge-readiness op').toContain('check-merge-readiness');
    expect(content, 'resolve.md must contain Third-Party Threads section').toContain('Third-Party Threads');
  });

  it('resolve.md keys its thread steps on EVIDENCE_POLICY and Phase 9c on REQUIRE_NON_AUTHOR_APPROVAL (#362)', async () => {
    // Inverted from the Step 0d compliance-wiring pin: /resolve's only uses of the
    // skill check were to gate the thread steps and merge readiness, and the
    // evidence policy now decides both.
    const outputPath = path.join(BUILT_COMMANDS, 'resolve.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content, 'resolve.md must not resolve COMPLIANCE_SKILL_INSTALLED').not.toContain('COMPLIANCE_SKILL_INSTALLED');
    expect(content, 'resolve.md must not check the compliance skill path').not.toContain('skills/devflow:compliance/SKILL.md');
    expect(content).toContain('Run this phase only when `EVIDENCE_POLICY` is `required`');
    expect(content).toContain('Run this step only when `EVIDENCE_POLICY` is `required`');
    expect(content).toContain('Run this phase only when `REQUIRE_NON_AUTHOR_APPROVAL` is `true`');
  });
});

// ---------------------------------------------------------------------------
// §16b DUPLICATE verdict guards — resolve.md
//      Pins the DUPLICATE triage bucket, duplicate_of reference attribute,
//      Duplicates Collapsed Statistics row, and ## Duplicates section.
//      All counts in existing Statistics rows now apply to UNIQUE (non-DUPLICATE)
//      issues only — this is the byte-stable contract verified here.
// ---------------------------------------------------------------------------

describe('DUPLICATE verdict guards — resolve.md (§16b)', () => {
  let compiled: string;

  beforeAll(async () => {
    compiled = await fs.readFile(path.join(BUILT_COMMANDS, 'resolve.md'), 'utf-8');
    expect(compiled.length, 'resolve.md must be non-empty').toBeGreaterThan(0);
  });

  it('resolve.md contains DUPLICATE as a named verdict bucket', () => {
    expect(
      compiled,
      'resolve.md must name DUPLICATE as a verdict bucket (avoids PF-024 spawn↔op seam)',
    ).toContain('DUPLICATE');
  });

  it('resolve.md contains duplicate_of reference attribute for DUPLICATE entries', () => {
    expect(
      compiled,
      'resolve.md must contain duplicate_of — the per-entry attribute Triage must supply for every DUPLICATE verdict',
    ).toContain('duplicate_of');
  });

  it('resolve.md contains the Duplicates Collapsed Statistics row label (parser-contract additive extension)', () => {
    // This row is additive — existing labels (Fixed, False Positive, Deferred) are unchanged.
    // The convergence parser in code-review.md reads only those existing labels, so this
    // new row does not break it while ensuring DUPLICATE counts surface in the artifact.
    expect(
      compiled,
      'resolve.md must contain "| Duplicates Collapsed | " Statistics row label',
    ).toContain('| Duplicates Collapsed | ');
  });

  it('resolve.md contains ## Duplicates section for per-entry traceability', () => {
    expect(
      compiled,
      'resolve.md must contain ## Duplicates section (additive, safe per ADR-006)',
    ).toContain('## Duplicates');
  });
});

// ---------------------------------------------------------------------------
// §17  Phase E traceability — implement.mds (2.5) + plan.mds (2.6) guards
//      implement.md: ISSUE_NUMBER in Code-agent spawns, the mechanism inputs in its
//      Git spawn (#362)
//      plan.md: ensure-traceable-issue replaces inline gh issue create
// ---------------------------------------------------------------------------

describe('Phase E traceability — implement.md and plan.md (Steps 2.5, 2.6)', () => {
  it('plan.md contains ensure-traceable-issue (Phase 14 Git-agent spawn, Step 2.6)', async () => {
    const outputPath = path.join(BUILT_COMMANDS, 'plan.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(
      content,
      'plan.md must reference ensure-traceable-issue Git op (replaces inline gh issue create)',
    ).toContain('ensure-traceable-issue');
  });

  it('implement.md passes the mechanism inputs to setup-task and no longer checks the compliance skill (#362)', async () => {
    // Inverted from the Step 2.5 pin: /implement's only use of the skill check was to
    // key setup-task on it, and the evidence policy now supplies both inputs.
    const outputPath = path.join(BUILT_COMMANDS, 'implement.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content).toContain('ISSUE_REQUIRED: {ISSUE_REQUIRED}');
    expect(content).toContain('APPLY_CONVENTIONS: {APPLY_CONVENTIONS}');
    expect(content, 'implement.md must not resolve COMPLIANCE_SKILL_INSTALLED').not.toContain('COMPLIANCE_SKILL_INSTALLED');
  });
});

// ---------------------------------------------------------------------------
// §18  Phase F release evidence (Step 2.9) + dynamic pipeline mechanism inputs +
//      ISSUE_NUMBER (Step 2.11, #362)
//      release.md: COMMIT_LIST, SHIPPED_ISSUES, backlink-shipped-issues
//      dynamic-build.md: ISSUE_REQUIRED, APPLY_CONVENTIONS, ISSUE_NUMBER
// ---------------------------------------------------------------------------

describe('Phase F traceability — release.md evidence + dynamic-build mechanism inputs (Steps 2.9, 2.11)', () => {
  it('release.md contains COMMIT_LIST, SHIPPED_ISSUES, and backlink-shipped-issues (Step 2.9 release evidence)', async () => {
    const outputPath = path.join(BUILT_COMMANDS, 'release.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(
      content,
      'release.md must contain COMMIT_LIST (release evidence, Step 2.9)',
    ).toContain('COMMIT_LIST');
    expect(
      content,
      'release.md must contain SHIPPED_ISSUES (release evidence, Step 2.9)',
    ).toContain('SHIPPED_ISSUES');
    expect(
      content,
      'release.md must contain backlink-shipped-issues Git op (Step 2.9)',
    ).toContain('backlink-shipped-issues');
    // #362: the evidence and back-link steps key on the evidence policy, not the skill.
    expect(content, 'release.md must not resolve COMPLIANCE_SKILL_INSTALLED').not.toContain('COMPLIANCE_SKILL_INSTALLED');
    expect(content, 'release.md must not check the compliance skill path').not.toContain('skills/devflow:compliance/SKILL.md');
  });

  it('dynamic-build.md passes the mechanism inputs and ISSUE_NUMBER, and restates no branch convention (#362)', async () => {
    // Inverted from the Step 2.11 pin. The recipe's setup-task call carries both
    // mechanism inputs, and the branch-naming restatement is gone: setup-task's own
    // step 1b owns the convention and states its gate there.
    const outputPath = path.join(BUILT_COMMANDS, 'dynamic-build.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content).toContain('ISSUE_REQUIRED: ${ISSUE_REQUIRED}');
    expect(content).toContain('APPLY_CONVENTIONS: ${APPLY_CONVENTIONS}');
    expect(
      content,
      'dynamic-build.md must contain ISSUE_NUMBER (Code-agent issue threading, Step 2.11)',
    ).toContain('ISSUE_NUMBER');
    expect(content, 'dynamic-build.md must not resolve COMPLIANCE_SKILL_INSTALLED').not.toContain('COMPLIANCE_SKILL_INSTALLED');
    expect(content, 'setup-task owns the branch convention; the host must not restate it').not.toContain('Branch Naming');
  });
});

// ---------------------------------------------------------------------------
// §19  Phase C publication gate wiring — _publication.mds partial (11th partial)
//      code-review.md, resolve.md, (since #363) implement.md and (since #376)
//      dynamic-build.md must expand publication_gate() and pass REVIEW_PUBLICATION
//      only in Git spawns (PF-024) — post-*-summary for the two review hosts,
//      update-pr-evidence for /implement and for the wave PR
// ---------------------------------------------------------------------------

describe('publication_gate adoption in compiled host commands (Phase C)', () => {
  const PUBLICATION_HOSTS: Record<string, string> = {
    'code-review':   DIST_COMMANDS,
    'dynamic-build': DIST_COMMANDS,
    'implement':     DIST_COMMANDS,
    'resolve':       DIST_COMMANDS,
  };

  it('code-review.md, dynamic-build.md, implement.md and resolve.md contain REVIEW_PUBLICATION resolution step', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(PUBLICATION_HOSTS)) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      const content = await fs.readFile(outputPath, 'utf-8');
      scanned++;
      expect(
        content,
        `${destRelDir}/${basename}.md must contain REVIEW_PUBLICATION (publication gate expansion)`,
      ).toContain('REVIEW_PUBLICATION');
      expect(
        content,
        `${destRelDir}/${basename}.md must expand the partial itself, not only name the value`,
      ).toContain('**Resolve `REVIEW_PUBLICATION` per worktree:**');
    }
    expect(scanned, 'scanned zero publication hosts — guard is vacuous (PF-018)').toBeGreaterThan(0);
  });

  it('every REVIEW_PUBLICATION: line in every compiled command is inside a Git-agent spawn block (spawn-scoped guard, PF-024)', async () => {
    let scanned = 0;
    for (const basename of COMMAND_HOSTS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;

      const fencePattern = /```[^\n]*\n([\s\S]*?)```/g;
      let match;
      const violations: string[] = [];

      while ((match = fencePattern.exec(content)) !== null) {
        const block = match[0];
        if (!/^REVIEW_PUBLICATION:/m.test(block)) continue;
        const hasGit =
          /Agent\(subagent_type="Git"/.test(block) ||
          /agentType:\s*"Git"/.test(block);
        if (!hasGit) {
          violations.push(`${basename}.md: fence at offset ${match.index}`);
        }
      }

      expect(
        violations,
        `REVIEW_PUBLICATION: line found in non-Git spawn block(s): ${violations.join(', ')}`,
      ).toHaveLength(0);
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous (PF-018)').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §20  DIST_FILES non-vacuity + compliance_gate adoption guard (P0-S21, P0-S22)
//
// §14.5 scope rule: deployed-behaviour guards scan DIST_FILES (14 files = 13
// compiled MDS hosts + 1 hand-authored release.md).
//
// compliance_gate() adoption guard: 2 importers (code-review, plan) must use the
// shared {compliance_gate()} partial — the review lens is the one command-layer use
// of the skill check left. release.md carries no skill check at all since #362: its
// evidence and back-link steps gate on EVIDENCE_POLICY, resolved by the
// evidence_policy() text it holds verbatim. hostsScanned === 2 asserts non-vacuity
// [DR-27a].
// bug-analysis, dynamic-build and implement dropped the import in #362: their only
// use of the check was to key a Git spawn, and the evidence policy now supplies the
// mechanism inputs those spawns take. resolve dropped it in the same PR: its thread
// steps gate on EVIDENCE_POLICY and its merge readiness on
// REQUIRE_NON_AUTHOR_APPROVAL.
// ---------------------------------------------------------------------------

describe('DIST_FILES scope (§14.5, P0-S21) + compliance_gate adoption (P0-S22)', () => {
  it('DIST_FILES contains exactly 14 entries (13 compiled hosts + release.md) — non-vacuity (P0-S21)', () => {
    // SG-13: the divergence is permanent; release.md stays hand-authored.
    expect(DIST_FILES.length, 'DIST_FILES must have exactly 14 entries (13 compiled + release.md)').toBe(14);
    expect(DIST_FILES).toContain('release.md');
  });

  it('both compliance_gate importers contain COMPLIANCE_SKILL_INSTALLED in their compiled output (P0-S22)', async () => {
    // The 2 MDS host commands that use {compliance_gate()} from _partials/_compliance.mds.
    // release.md is hand-authored, cannot import, and checks no skill (#362).
    const COMPLIANCE_GATE_IMPORTERS = ['code-review', 'plan'] as const;

    // The adoption set is read from the sources, both ways: a host that imports the
    // partial and is not listed fails here, and so does a listed host that stopped.
    const importers: string[] = [];
    for (const basename of COMMAND_HOSTS) {
      const source = await fs.readFile(path.join(COMMANDS_DIR, `${basename}.mds`), 'utf-8');
      if (source.includes('from "./_partials/_compliance.mds"')) importers.push(basename);
    }
    expect(importers.sort(), 'the hosts importing _compliance.mds').toEqual([...COMPLIANCE_GATE_IMPORTERS]);

    let hostsScanned = 0;
    for (const basename of COMPLIANCE_GATE_IMPORTERS) {
      const outputPath = path.join(BUILT_COMMANDS, `${basename}.md`);
      const content = await fs.readFile(outputPath, 'utf-8');
      hostsScanned++;
      expect(
        content,
        `${DIST_COMMANDS}/${basename}.md must contain COMPLIANCE_SKILL_INSTALLED (compliance_gate expansion)`,
      ).toContain('COMPLIANCE_SKILL_INSTALLED');
    }

    // hostsScanned === 2: asserts non-vacuity (PF-018, [DR-27a]).
    // Known-bad sample: a host with @import but no {compliance_gate()} call would
    // produce a compiled output without COMPLIANCE_SKILL_INSTALLED and fail here.
    expect(
      hostsScanned,
      `compliance_gate guard is vacuous: expected hostsScanned === 2, got ${hostsScanned}`,
    ).toBe(2);
  });

  // GAP-31: the compliance gate must still resolve BEFORE its first consumer in
  // every importer. P2-S9 inserted issue-grammar text into five of the then six
  // hosts; an insertion above the gate would leave COMPLIANCE_SKILL_INSTALLED
  // read before it is set, which no other assertion in this file would notice
  // (they all check presence, never order).
  it('the compliance gate resolves before its first consumer in both importers (GAP-31)', async () => {
    const COMPLIANCE_GATE_IMPORTERS = ['code-review', 'plan'] as const;

    // Named collector — shared by the live guard and the known-bad probe below.
    //
    // Non-consumer mentions, excluded with a reason each:
    //   **Produces:** / **Requires:**  — the phase-ordering DAG, not a read of the
    //                                    value (PF-039; the seam test excludes the
    //                                    same two literals as a set)
    //   a heading line                 — names the step, does not read the variable
    function collectGateOrderViolations(basename: string, content: string): string[] {
      const GATE = 'Resolve `COMPLIANCE_SKILL_INSTALLED` once per run';
      const lines = content.split('\n');
      const gateLine = lines.findIndex(l => l.includes(GATE));
      if (gateLine === -1) return [`${basename}: gate resolution sentence absent`];

      const out: string[] = [];
      for (let i = 0; i < gateLine; i++) {
        const line = lines[i];
        if (!line.includes('COMPLIANCE_SKILL_INSTALLED')) continue;
        if (line.startsWith('**Produces:**') || line.startsWith('**Requires:**')) continue;
        if (line.startsWith('#')) continue;
        out.push(
          `${basename}:${i + 1}: reads COMPLIANCE_SKILL_INSTALLED before the gate resolves it ` +
          `at line ${gateLine + 1} — "${line.trim().slice(0, 80)}"`,
        );
      }
      return out;
    }

    const violations: string[] = [];
    let hostsScanned = 0;

    for (const basename of COMPLIANCE_GATE_IMPORTERS) {
      const content = await fs.readFile(path.join(BUILT_COMMANDS, `${basename}.md`), 'utf-8');
      hostsScanned++;
      violations.push(...collectGateOrderViolations(`${basename}.md`, content));
    }

    expect(
      violations,
      `compliance-gate ordering violations (GAP-31):\n${violations.join('\n')}`,
    ).toHaveLength(0);

    // Known-bad probe (mechanic 2, H10): the same collector over a seeded corpus
    // where a consumer line sits above the gate.
    const seeded = [
      '**Produces:** COMPLIANCE_SKILL_INSTALLED',
      'COMPLIANCE: {COMPLIANCE_SKILL_INSTALLED ? "enabled" : "(none)"}',
      '**Resolve `COMPLIANCE_SKILL_INSTALLED` once per run:** …',
    ].join('\n');
    expect(
      collectGateOrderViolations('probe.md', seeded),
      'the ordering collector must fire on a consumer line seeded above the gate',
    ).toHaveLength(1);
    expect(
      hostsScanned,
      `compliance-gate ordering guard is vacuous: expected 2 hosts, got ${hostsScanned}`,
    ).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §22  _partials/_tracker.mds adoption + per-define non-emptiness (P2-S9)
//
// Mirrors the P0-S22 compliance_gate adoption guard above: a named set of
// adopters (TRACKER_PARTIAL_ADOPTERS), a required literal per define, and a
// hostsScanned non-vacuity floor.
//
// Why a required PHRASE and a minimum SIZE per define, and not just presence of
// the call site: an exported define with a placeholder body compiles cleanly.
// `mds::undefined_var` catches a define that was never written; nothing catches
// a define that was written empty (GAP-44). The phrase pins what the define is
// FOR; the size floor pins that the body was not hollowed out around the phrase.
// ---------------------------------------------------------------------------

describe('_tracker.mds adoption + per-define non-emptiness (P2-S9)', () => {
  // One required phrase per define. Each is the sentence the define exists to
  // state, so deleting the rule and keeping the heading fails here.
  const TRACKER_DEFINES: Array<{ name: string; requiredPhrase: string; minBytes: number }> = [
    {
      name: 'issue_ref_grammar',
      // The second arm of the two-armed GitHub foreign-shape rule (AC-2.9). The
      // first arm (a well-shaped ref renders `#{n}`) is worthless on its own:
      // a one-armed grammar silently drops everything it does not recognise.
      // The phrase pins where adjudication actually happens — in the fetching
      // operation's Output block — so a host cannot re-assert a producer-side
      // rejection no operation performs (PF-024).
      requiredPhrase: 'no producer-side grammar check',
      minBytes: 600,
    },
    {
      name: 'issue_capture_contract',
      // The producer literal git.md emits under `### Handoff Values`. If the
      // capture list stops naming it, the Code agent's `Closes #{n}` rule has no
      // input and dies silently — the GAP-15 defect P2-S10 exists to close.
      requiredPhrase: '- **PR link line**:',
      minBytes: 600,
    },
  ];

  it('every adopting host carries both defines\' expanded bodies (AC-2.9)', async () => {
    const violations: string[] = [];
    let hostsScanned = 0;

    for (const basename of TRACKER_PARTIAL_ADOPTERS) {
      const content = await fs.readFile(path.join(BUILT_COMMANDS, `${basename}.md`), 'utf-8');
      hostsScanned++;
      for (const { name, requiredPhrase } of TRACKER_DEFINES) {
        if (!content.includes(requiredPhrase)) {
          violations.push(`${basename}.md: ${name}() body missing — "${requiredPhrase}" not found`);
        }
      }
    }

    expect(
      violations,
      `_tracker.mds adoption violations:\n${violations.join('\n')}`,
    ).toHaveLength(0);
    // Known-bad sample: a host that @imports the partial but never calls either
    // define compiles fine and lands here with both phrases missing.
    expect(
      hostsScanned,
      `_tracker adoption guard is vacuous: expected ${TRACKER_PARTIAL_ADOPTERS.length} hosts, got ${hostsScanned}`,
    ).toBe(5);
  });

  /** Named collector: the `@define <name>():` / `@export <name>` names in a partial source. */
  function collectTrackerDeclarations(source: string): { defines: string[]; exports: string[] } {
    return {
      defines: [...source.matchAll(/^@define ([A-Za-z_][A-Za-z0-9_]*)\(\):/gm)].map(m => m[1]),
      exports: [...source.matchAll(/^@export ([A-Za-z_][A-Za-z0-9_]*)\s*$/gm)].map(m => m[1]),
    };
  }

  it('_tracker.mds declares exactly these two defines and exports both (AC-2.9)', async () => {
    // The per-define guards below range over TRACKER_DEFINES, so they are silent
    // about a THIRD define: one added to the partial and exported would expand
    // into all five adopting hosts — 5× its bytes on every spawn of those
    // commands — with nothing here to notice. The reverse arm matters equally: a
    // define left unexported compiles, and its call site fails only at build time
    // in whichever host happens to call it.
    const source = await fs.readFile(path.join(PARTIALS_DIR, '_tracker.mds'), 'utf-8');
    const { defines, exports } = collectTrackerDeclarations(source);
    const expected = TRACKER_DEFINES.map(d => d.name).sort();

    expect(
      [...defines].sort(),
      `_tracker.mds defines [${defines.join(', ')}]; this guard knows [${expected.join(', ')}]. ` +
      'A define this file does not model is expanded into every adopting host unchecked.',
    ).toEqual(expected);
    expect(
      [...exports].sort(),
      `_tracker.mds exports [${exports.join(', ')}] — every define must be exported and nothing else`,
    ).toEqual(expected);
  });

  it('known-bad probe: a seeded third define/export is reported by the same collector', () => {
    const seeded = [
      '@define issue_ref_grammar():',
      'body',
      '@end',
      '',
      '@define issue_capture_contract():',
      'body',
      '@end',
      '',
      '@define smuggled_partial():',
      'body',
      '@end',
      '',
      '@export issue_ref_grammar',
      '@export issue_capture_contract',
      '@export smuggled_partial',
      '',
    ].join('\n');

    const { defines, exports } = collectTrackerDeclarations(seeded);
    expect(
      defines,
      'the collector must see the seeded third define — otherwise the equality above is ' +
      'green because nothing was ever parsed (PF-018)',
    ).toEqual(['issue_ref_grammar', 'issue_capture_contract', 'smuggled_partial']);
    expect(exports).toEqual(['issue_ref_grammar', 'issue_capture_contract', 'smuggled_partial']);
    expect(
      [...defines].sort(),
      'and the seeded set must NOT equal the modelled two — the probe would be inert otherwise',
    ).not.toEqual(TRACKER_DEFINES.map(d => d.name).sort());
  });

  it('each define has a non-empty body — required phrase plus a size floor (GAP-44)', async () => {
    const source = await fs.readFile(
      path.join(PARTIALS_DIR, '_tracker.mds'),
      'utf-8',
    );

    /** Slice one `@define name():` … `@end` body out of the partial source. */
    function defineBody(name: string): string {
      const open = source.indexOf(`@define ${name}():`);
      if (open === -1) return '';
      const bodyStart = source.indexOf('\n', open) + 1;
      const end = source.indexOf('\n@end', bodyStart);
      return end === -1 ? '' : source.slice(bodyStart, end);
    }

    for (const { name, requiredPhrase, minBytes } of TRACKER_DEFINES) {
      const body = defineBody(name);
      expect(body, `${name}() must exist in _tracker.mds`).not.toBe('');
      expect(
        body.includes(requiredPhrase),
        `${name}() body must state "${requiredPhrase}" — a define can be exported with a placeholder body and still compile`,
      ).toBe(true);
      expect(
        body.length,
        `${name}() body is ${body.length} bytes — below the ${minBytes}-byte floor, which is the shape a hollowed-out define takes`,
      ).toBeGreaterThanOrEqual(minBytes);
      // The Note: device (the partial's shape, per _publication.mds) pre-empts a
      // misreading; losing it is how a two-armed rule quietly becomes one-armed.
      expect(
        body,
        `${name}() must keep its "Note:" paragraph — the shape _publication.mds establishes`,
      ).toContain('\nNote:');
    }
  });

  it('known-bad probe: a hollowed-out define body is reported by the same slicer', () => {
    const seeded = [
      '@define issue_ref_grammar():',
      '**Issue-reference grammar:** TODO',
      '@end',
      '',
      '@export issue_ref_grammar',
      '',
    ].join('\n');

    const open = seeded.indexOf('@define issue_ref_grammar():');
    const bodyStart = seeded.indexOf('\n', open) + 1;
    const end = seeded.indexOf('\n@end', bodyStart);
    const body = seeded.slice(bodyStart, end);

    expect(body.length, 'the seeded placeholder body must fall under the floor').toBeLessThan(600);
    expect(
      body.includes(TRACKER_DEFINES.find(d => d.name === 'issue_ref_grammar')!.requiredPhrase),
      'the seeded placeholder must not carry the required phrase',
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §21  gh issue scope guard (AC-0.4, P0-S21)
//
// No `gh issue` invocation or descriptive mention in any DIST_FILE entry
// outside a Git spawn fence. Scans all 14 DIST_FILES (§14.5 deployed-behaviour
// rule). Three recorded exceptions encoded as an explicit allowlist (never a
// loosened regex):
//
//   1. `gh pr view` at code-review.mds:76-78 (dist: code-review.md:71)
//   2. `gh pr view` at bug-analysis.mds:43-45 (dist: bug-analysis.md:39)
//   3. `gh pr view` at resolve.mds:63 (dist: resolve.md:57)
//
// These are PR-description fetches that legitimately appear outside spawn
// fences. All other `gh` invocations must be inside Git-agent spawn blocks.
//
// Non-vacuity: DIST_FILES.length === 14 (proven in §20 above).
// Known-bad sample (mechanic 2): inline corpus with a bare `gh issue view` line
// — asserted inside the test.
// ---------------------------------------------------------------------------

describe('gh issue scope guard — no gh issue calls outside Git spawn fences (AC-0.4, P0-S21)', () => {
  // Recorded exceptions: gh pr view for PR-description fetch (allowlisted by file + pattern).
  // These appear in prose bash blocks, not in Agent spawn blocks, which is permitted.
  const GH_PR_VIEW_EXCEPTION_FILES = new Set([
    'code-review.md',  // code-review.mds:76-78
    'bug-analysis.md', // bug-analysis.mds:43-45
    'resolve.md',      // resolve.mds:63
  ]);

  it('no dist command contains gh issue invocations or descriptive mentions outside a Git spawn fence', async () => {
    // Deployed-behaviour guard → DIST_FILES scope (§14.5), read from the
    // isolated build of the committed sources.
    const distDir = BUILT_COMMANDS;

    // Fail-loud: the build must have produced the tree (R3 — never skip).
    const distFiles = (await fs.readdir(distDir)).filter(f => f.endsWith('.md'));
    expect(
      distFiles.length,
      `the built dist/commands/ has ${distFiles.length} .md files — expected 14`,
    ).toBe(14);

    // Named collector — used by both the main guard loop and the non-vacuity probe (M12c).
    // Extracts `gh issue` occurrences in prose (non-fence) content.
    function collectGhIssueProseViolations(filename: string, content: string): string[] {
      const fencePattern = /```[^\n]*\n[\s\S]*?```/g;
      const stripped = content.replace(fencePattern, (match) => '\n'.repeat(match.split('\n').length - 1));
      const results: string[] = [];
      const re = /\bgh issue\b/g;
      let m;
      while ((m = re.exec(stripped)) !== null) {
        results.push(`${filename}: prose contains 'gh issue' at char ${m.index}`);
      }
      return results;
    }

    const violations: string[] = [];

    for (const filename of DIST_FILES) {
      const content = await fs.readFile(path.join(distDir, filename), 'utf-8');

      // Extract lines NOT inside triple-backtick fences (prose lines).
      const fencePattern = /```[^\n]*\n[\s\S]*?```/g;
      const stripped = content.replace(fencePattern, (m) => '\n'.repeat(m.split('\n').length - 1));

      // Check for `gh issue` in prose — always a violation (uses shared collector, M12c).
      violations.push(...collectGhIssueProseViolations(filename, content));

      // Check for `gh` calls in spawn fences — only Git fences are allowed.
      const fenceMatch = /```[^\n]*\n([\s\S]*?)```/g;
      let fence;
      while ((fence = fenceMatch.exec(content)) !== null) {
        const block = fence[0];
        const hasGhIssue = /\bgh issue\b/.test(block);
        if (!hasGhIssue) continue;
        const hasGit =
          /Agent\(subagent_type="Git"/.test(block) ||
          /agentType:\s*"Git"/.test(block);
        if (!hasGit) {
          violations.push(`${filename}: spawn fence contains 'gh issue' outside a Git block`);
        }
      }

      // Check for `gh pr view` outside fences — allowed only for the exception set.
      const ghPrRe = /\bgh pr view\b/g;
      let m;
      while ((m = ghPrRe.exec(stripped)) !== null) {
        if (!GH_PR_VIEW_EXCEPTION_FILES.has(filename)) {
          violations.push(`${filename}: prose contains 'gh pr view' — add to exception list if intentional`);
        }
      }
    }

    // Non-vacuity (mechanic 2, M12c): calls the shared collectGhIssueProseViolations helper
    // to prove the guard isn't vacuous — a bare `gh issue view` in prose must be flagged.
    // This is NOT an inline re-implementation; it calls the same function as the main loop.
    const knownBadProse = 'OPERATION: fetch-issue\ngh issue view 42\n';
    const knownBadViolations = collectGhIssueProseViolations('known-bad.md', knownBadProse);
    expect(
      knownBadViolations.length,
      'non-vacuity: collectGhIssueProseViolations must flag a bare gh issue line in prose (H10)',
    ).toBeGreaterThan(0);

    expect(
      violations,
      `gh issue scope violations:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 22. this file never spawns a build against the real repo root
// ---------------------------------------------------------------------------
//
// The header claims every build here is scoped to a temp DEVFLOW_MDS_ROOT. That
// claim decays the moment someone adds a spawn without one — and the failure it
// reintroduces is invisible locally: an unscoped build rewrites the real dist/
// while parallel vitest workers read it, so a stale tree is silently repaired
// mid-suite and whichever reader lost the race reports a flake instead of the
// staleness (PF-055). A prose invariant cannot detect that, so it is scanned.
//
// The scan is deliberately blind to WHERE the root comes from: `cwd:` is not a
// scope. build-mds.ts resolves its fallback root from the script's own location,
// so a spawn with `cwd: <tmp>` and no env var walks and rewrites the real repo
// while the test asserts about a temp tree the build never opened.

describe('this file never spawns a build against the real repo root', () => {
  it('every spawned build is scoped to a temp DEVFLOW_MDS_ROOT', async () => {
    const source = await fs.readFile(SELF, 'utf-8');
    const { total, unscoped } = collectSpawnScoping(source);

    expect(total, 'the scan found no spawn site at all — it is measuring nothing (PF-018)')
      .toBeGreaterThan(0);
    expect(
      unscoped,
      'a build in this file is spawned without DEVFLOW_MDS_ROOT: it would write the real ' +
      'dist/ tree while parallel workers read it. Pass DEVFLOW_MDS_ROOT in its env, or ' +
      'route it through buildCommittedTree() when the whole committed corpus is needed.',
    ).toEqual([]);
  });

  it('non-vacuity: the real dist/ tree is what those builds would have written', () => {
    // The scan is structural, so it is paired with the fact it protects: the real
    // dist/commands/ exists and is readable from here, and stays exactly as this
    // file found it. Its bytes are never this file's to write.
    expect(requireDistFiles().length, 'dist/ must be built before this file runs')
      .toBeGreaterThan(0);
  });

  it('known-bad probe: the collector flags an unscoped spawn and clears a scoped one', () => {
    // Built by concatenation for the same reason the collector splits its needle:
    // a literal here would be found by the scan over this very file.
    const CALL = 'spawn' + 'Sync(';
    // No numeral in the fixture: the timeout floor registered for this file in
    // tests/fixtures/numeric-floors.json counts real spawn sites, and a fixture
    // string spelling the same number would pad that count.
    const unscopedSite = `${CALL}TSX_BIN, [SCRIPT], {\n  cwd: tmpRoot,\n  encoding: 'utf-8',\n});`;
    const scopedSite =
      `${CALL}TSX_BIN, [SCRIPT], {\n  cwd: ROOT,\n  env: { DEVFLOW_MDS_ROOT: fakeRoot },\n});`;

    expect(collectSpawnScoping(unscopedSite)).toEqual({ total: 1, unscoped: [0] });
    expect(collectSpawnScoping(scopedSite)).toEqual({ total: 1, unscoped: [] });
    expect(collectSpawnScoping(`${unscopedSite}\n${scopedSite}`).unscoped).toHaveLength(1);
    expect(collectSpawnScoping('no spawns here').total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §23  Dedup-marker ownership — no `<!-- devflow:` literal in any dist command
//      (P2-S12, GAP-20)
//
// The OPERATION owns its marker format; callers pass inputs only (§14.3,
// `marker_format`). A command that restates the literal is a second authority on
// a string whose two copies must match exactly for dedup to work — and they
// already diverged once, producing duplicate comments.
//
// Deployed-behaviour guard -> DIST_FILES scope (§14.5), non-vacuity
// distFilesScanned === 14. The marker literals themselves are asserted to still
// exist in the Git agent's sink corpus, so this reads as a RELOCATION and not as
// a deletion: if both halves went missing, the first assertion would pass
// vacuously and nothing would dedup at all.
// ---------------------------------------------------------------------------

describe('dedup-marker ownership — `<!-- devflow:` absent from dist/commands (P2-S12, GAP-20)', () => {
  /** Named collector — shared by the live guard and the seeded probe. */
  function collectMarkerLiterals(filename: string, content: string): string[] {
    const out: string[] = [];
    const re = /<!-- devflow:/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      out.push(`${filename}: restates a dedup marker at char ${m.index}`);
    }
    return out;
  }

  it('no dist command restates a `<!-- devflow:` marker literal', async () => {
    const distFiles = (await fs.readdir(BUILT_COMMANDS)).filter(f => f.endsWith('.md'));
    expect(
      distFiles.length,
      `the built dist/commands/ has ${distFiles.length} .md files — expected 14`,
    ).toBe(14);

    const violations: string[] = [];
    let distFilesScanned = 0;
    for (const filename of DIST_FILES) {
      const content = await fs.readFile(path.join(BUILT_COMMANDS, filename), 'utf-8');
      distFilesScanned++;
      violations.push(...collectMarkerLiterals(filename, content));
    }

    expect(
      violations,
      `dedup-marker literals restated in commands (GAP-20 — the operation owns the marker):\n${violations.join('\n')}`,
    ).toHaveLength(0);
    expect(
      distFilesScanned,
      `marker guard is vacuous: expected 14 files scanned, got ${distFilesScanned}`,
    ).toBe(14);
  });

  it('known-bad probe: the same collector flags a seeded restatement in a temp copy', async () => {
    // Mechanic 2 (H10): a temp copy of a real dist command with the retired
    // sentence put back — never the committed tree.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-marker-probe-'));
    try {
      const real = await fs.readFile(path.join(BUILT_COMMANDS, 'dynamic-build.md'), 'utf-8');
      const seededPath = path.join(tmp, 'dynamic-build.md');
      await fs.writeFile(
        seededPath,
        real + '\n   The Git agent deduplicates via marker `<!-- devflow:wave-report wave:{WAVE_ID} -->`.\n',
        'utf-8',
      );
      const seeded = await fs.readFile(seededPath, 'utf-8');
      expect(
        collectMarkerLiterals('dynamic-build.md', seeded),
        'the collector must fire on a seeded restatement',
      ).toHaveLength(1);
      // …and must clear the unseeded original, or it is flagging something else.
      expect(collectMarkerLiterals('dynamic-build.md', real)).toHaveLength(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('the marker literals still live in the Git agent sink — relocated, not deleted', () => {
    // Guard 5's markers, read through the shared resolver + the generated
    // references the mechanics moved into (GAP-21: guard classes move with the
    // text). Without this arm, deleting dedup everywhere would turn the guard
    // above green.
    const joined = gitAgentSinkCorpus().map(e => e.content).join('\n');
    expect(joined.length, 'the sink corpus must be non-empty').toBeGreaterThan(10000);
    for (const marker of [
      '<!-- devflow:review-summary',
      '<!-- devflow:resolution-summary',
      '<!-- devflow:wave-report',
    ]) {
      expect(
        joined,
        `${marker} must still be owned by the Git agent — the caller stopped restating it, the operation did not stop emitting it`,
      ).toContain(marker);
    }
  });
});

// ---------------------------------------------------------------------------
// §23  /implement forwards the issue argument UNCLASSIFIED
//
// The Git agent's `setup-task` is the one site that resolves a provider and the
// one site that knows what an issue reference looks like on this machine. The
// command layer's job is to hand it the argument, not to decide whether the
// argument is one: `#123` is github's spelling, `PROJ-12` is jira's and `ENG-12`
// is linear's, so a `starts with #` gate at the command silently reclassifies
// every non-github reference as a task DESCRIPTION — the branch is derived from
// prose, no issue is fetched, and nothing reports a problem.
//
// Two properties, because presence alone would not catch either failure: the
// forwarded token carries no provider-specific test, and it is offered BEFORE
// the description fallback, which is what makes the description a fallback.
//
// A third, added after M-1: neutrality is not enough on its own. Forwarding the
// FIRST token of `$ARGUMENTS` is perfectly provider-neutral and still loses the
// request — `/implement fix the login bug` reaches setup-task as `ISSUE_INPUT:
// fix` with no description behind it. The gate that is both neutral and correct
// is token COUNT: every provider's reference is a single token and no prose
// description is, so the arms below assert the routing each SHAPE produces
// rather than the sentence that produces it.
// ---------------------------------------------------------------------------

describe('implement.md forwards the issue argument unclassified (§23)', () => {
  /** Spellings that classify the argument at the command layer. Each LABELLED (PF-064). */
  const CLASSIFIER_RULES: ReadonlyArray<readonly [string, RegExp]> = [
    ['a `#` prefix test', /starts with\s*`?#/i],
    ['a `#`-shaped pattern', /#\[0-9\]|#\{?[0-9n]/],
    ['an issue-number noun', /\bissue number\b/i],
    // Neutral, and still wrong: it routes a multi-token argument's first word to
    // the issue lookup and leaves TASK_DESCRIPTION empty (M-1).
    ['an unconditional first-token forward', /\bfirst\b[^\n]*\btokens?\b/i],
  ];

  /**
   * The condition the ISSUE_INPUT line must state: `$ARGUMENTS` is ONE token.
   *
   * A family of spellings rather than one, because the assertion is about which
   * shape routes where, not about the sentence chosen to say it. What no member
   * of the family admits is a gate on the first token of a longer argument —
   * that shape is reported by the collector above instead.
   */
  const SINGLE_TOKEN_GATE = /\b(?:a single|exactly one|one)\b[^\n]*\btokens?\b/i;

  /** The complementary condition on TASK_DESCRIPTION: two or more tokens. */
  const MULTI_TOKEN_GATE = /\b(?:two or more|2\+|multiple|more than one)\b[^\n]*\btokens?\b/i;

  /**
   * The `setup-task` spawn payload — the ONE payload that routes `$ARGUMENTS`.
   *
   * Scoped rather than file-wide because `TASK_DESCRIPTION:` appears in nine
   * payloads of this command, eight of which hand a Code agent a phase
   * description that has nothing to do with the command's arguments. A file-wide
   * reader would pick whichever came first and assert against the wrong one.
   */
  function setupTaskPayload(source: string): string {
    const at = source.indexOf('OPERATION: setup-task');
    expect(at, 'no setup-task spawn in the compiled command').toBeGreaterThan(-1);
    const end = source.indexOf('```', at);
    expect(end, 'the setup-task spawn fence is unterminated').toBeGreaterThan(at);
    return source.slice(at, end);
  }

  /** The one line of the `setup-task` payload that carries `key:`. */
  function payloadLine(source: string, key: string): string {
    const lines = setupTaskPayload(source).split('\n').filter(l => l.trimStart().startsWith(`${key}:`));
    expect(
      lines.length,
      `expected exactly one \`${key}:\` line in the setup-task payload, found ${lines.length}`,
    ).toBe(1);
    return lines[0];
  }

  /**
   * Named collector: the `ISSUE_INPUT:` line of a spawn payload, and every
   * classifier spelling on it.
   *
   * Scoped to that one line rather than the file: the command legitimately talks
   * about issue numbers elsewhere (the `ISSUE_NUMBER` capture, the github-gated PR
   * link), and a file-wide scan would report the prose that describes the value
   * instead of the instruction that produces it.
   */
  function collectIssueInputClassifiers(source: string): string[] {
    const violations: string[] = [];
    for (const line of source.split('\n')) {
      if (!line.trimStart().startsWith('ISSUE_INPUT:')) continue;
      for (const [label, rule] of CLASSIFIER_RULES) {
        if (rule.test(line)) violations.push(`${line.trim()} — ${label}`);
      }
    }
    return violations;
  }

  it('the ISSUE_INPUT line forwards the argument and applies no provider-specific test', async () => {
    const source = await fs.readFile(path.join(BUILT_COMMANDS, 'implement.md'), 'utf-8');
    const lines = source.split('\n').filter(l => l.trimStart().startsWith('ISSUE_INPUT:'));
    expect(
      lines.length,
      'no ISSUE_INPUT: line in the compiled command — the setup-task spawn stopped forwarding ' +
      'the argument at all, which no presence check elsewhere would notice',
    ).toBe(1);
    expect(
      lines[0],
      'the value must be read off $ARGUMENTS, not restated as a classified noun',
    ).toContain('$ARGUMENTS');
    expect(
      collectIssueInputClassifiers(source),
      'the command layer classified the issue argument. Only the Git agent has resolved a ' +
      'provider at this point, so any test here is a github test wearing a neutral name:\n  ' +
      collectIssueInputClassifiers(source).join('\n  '),
    ).toEqual([]);
    // The one test that IS the command's to make: a plan-document path is not an
    // issue reference under any provider, and it is decided by the file extension.
    expect(lines[0], 'the `.md` carve-out is the command layer\'s own').toContain('.md');
  });

  it('a SINGLE-token argument is what reaches ISSUE_INPUT — and it carries no provider test', async () => {
    const source = await fs.readFile(path.join(BUILT_COMMANDS, 'implement.md'), 'utf-8');
    const issueLine = payloadLine(source, 'ISSUE_INPUT');

    expect(
      issueLine,
      'ISSUE_INPUT must be gated on $ARGUMENTS being ONE token. Ungated, the first word of ' +
      '`/implement fix the login bug` is forwarded to setup-task as an issue reference and ' +
      'the request itself is never passed at all (M-1):\n  ' + issueLine.trim(),
    ).toMatch(SINGLE_TOKEN_GATE);
    expect(
      issueLine,
      'and the gate must be on the argument as a whole, not on its first token',
    ).not.toMatch(/\bfirst\b[^\n]*\btokens?\b/i);
    // `PROJ-12`, `ENG-7`, `#42` and `42` are all one token, so the count gate
    // admits every provider's spelling — which is what keeps it neutral.
    expect(collectIssueInputClassifiers(source)).toEqual([]);
  });

  it('a MULTI-token argument routes to TASK_DESCRIPTION instead, and is not split', async () => {
    const source = await fs.readFile(path.join(BUILT_COMMANDS, 'implement.md'), 'utf-8');
    const descLine = payloadLine(source, 'TASK_DESCRIPTION');

    expect(
      descLine,
      'TASK_DESCRIPTION must state the complementary shape — two or more tokens — rather than ' +
      'depending on whatever the ISSUE_INPUT line happened to leave behind:\n  ' + descLine.trim(),
    ).toMatch(MULTI_TOKEN_GATE);
    expect(
      descLine,
      'the whole argument is the description; forwarding a remainder would drop its first word',
    ).toContain('$ARGUMENTS');
  });

  it('a `.md` argument routes to PLAN_ARTIFACT_PATH, and to neither of the other two keys', async () => {
    const source = await fs.readFile(path.join(BUILT_COMMANDS, 'implement.md'), 'utf-8');

    expect(payloadLine(source, 'PLAN_ARTIFACT_PATH')).toContain('.md');
    expect(
      payloadLine(source, 'ISSUE_INPUT'),
      'the extension carve-out has to be stated where the issue value is produced',
    ).toContain('.md');
    // A path is one token, so without the carve-out the count gate alone would
    // send it to ISSUE_INPUT.
    expect(payloadLine(source, 'ISSUE_INPUT')).toMatch(/\bnot\b[^\n]*\.md|unless[^\n]*\.md|does not end in \.md/i);
  });

  it('ISSUE_INPUT is offered before the TASK_DESCRIPTION fallback, in the same payload', async () => {
    const source = await fs.readFile(path.join(BUILT_COMMANDS, 'implement.md'), 'utf-8');
    const issueAt = source.indexOf('ISSUE_INPUT:');
    const descAt = source.indexOf('TASK_DESCRIPTION:');
    expect(issueAt, 'ISSUE_INPUT: absent').toBeGreaterThan(-1);
    expect(descAt, 'TASK_DESCRIPTION: absent').toBeGreaterThan(-1);
    expect(
      issueAt,
      'the description is the FALLBACK — stated first it reads as the default, and the argument ' +
      'that is an issue reference reaches the Git agent as prose',
    ).toBeLessThan(descAt);
    // Same payload, not two distant sections: a blank line between them would mean
    // the Git agent is handed one or the other by two different instructions.
    expect(
      source.slice(issueAt, descAt),
      'the two keys must sit in one contiguous spawn payload',
    ).not.toContain('\n\n');
  });

  it('known-bad probe: EVERY classifier rule fires on its own shape', async () => {
    const SHAPES: ReadonlyArray<readonly [string, string]> = [
      ['a `#` prefix test', 'ISSUE_INPUT: {issue if $ARGUMENTS starts with `#`, otherwise omit}'],
      ['a `#`-shaped pattern', 'ISSUE_INPUT: {the #{n} token from $ARGUMENTS}'],
      ['an issue-number noun', 'ISSUE_INPUT: {issue number from $ARGUMENTS}'],
      // The exact line this command shipped before M-1. Provider-neutral, and it
      // still sent `/implement fix the login bug` on as `ISSUE_INPUT: fix`.
      [
        'an unconditional first-token forward',
        'ISSUE_INPUT: {the first $ARGUMENTS token verbatim, unless it ends in .md — then omit}',
      ],
    ];
    expect(SHAPES.length, 'one shape per rule').toBe(CLASSIFIER_RULES.length);
    for (const [label, line] of SHAPES) {
      expect(
        collectIssueInputClassifiers(line).some(v => v.endsWith(label)),
        `"${line}" must be reported by the ${label} rule`,
      ).toBe(true);
    }
    // …and the shipped forwarding instruction is not reported, nor is the same
    // prose on a line that is not the ISSUE_INPUT key.
    expect(collectIssueInputClassifiers(
      'ISSUE_INPUT: {$ARGUMENTS verbatim, when it is a single whitespace-delimited token ' +
      'that does not end in .md — otherwise omit}',
    )).toEqual([]);
    expect(collectIssueInputClassifiers('Capture the issue number the Git agent returns.')).toEqual([]);
  });
});

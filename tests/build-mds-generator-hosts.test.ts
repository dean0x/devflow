/**
 * Tests for the generator-host convention in scripts/build-mds.ts.
 *
 * A *generator host* is a .mds file whose first frontmatter block exists only to
 * steer the build (`output-dir: dist/agents`) and whose SECOND frontmatter block
 * is the real artifact frontmatter. The build strips the whole first block for
 * these hosts, while the 13 command hosts keep the pre-existing key-only strip
 * so their compiled bytes do not move.
 *
 * Scenario coverage:
 *   1. generator frontmatter whole-block strip — a dist/agents host compiles to
 *      dist/agents/<name>.md with block 2 surviving as body text.
 *   2. 13 command outputs byte-unchanged (key-only strip retained) — command
 *      outputs keep their frontmatter minus output-dir:, and the on-disk dist/
 *      tree is byte-for-byte what the committed src/ tree compiles to.
 *   3. dest allowlist negatives — dist/wrong-dir, dist/commands/, dist/../..
 *   4. filename validation negatives — output-name: ../x and a/b
 *   5. IGNORE_DIRS covers tests/ and coverage/
 *   7. build-owned keys never reach a command artifact
 *   8. a bare output-name: is a hard build error
 *   9. two hosts may not claim one destination
 *  10. a generator host must carry TWO frontmatter blocks
 *  11. the whole-repo walk is depth-bounded and fails loudly at the bound
 *  12. this file never spawns a build against the real repo root
 *
 * EVERY build this file spawns — negatives, positives, and the whole-repo census
 * alike — runs against an isolated DEVFLOW_MDS_ROOT temp tree, so the real
 * src/assets/ and dist/ trees are only ever READ (avoids PF-011 and PF-055: no
 * mutating shared state other vitest workers are reading concurrently).
 * Scenario 12 is the mechanical proof of that claim rather than this sentence.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';

import {
  requireDistFiles,
  requireDistFile,
  resolveAgentSource,
  splitFrontmatter,
  buildCommittedTree,
  cleanupCommittedTree,
  copyCommittedSources,
  collectSpawnScoping,
  type BuildRun,
} from './helpers.js';
import {
  MDS_COMMAND_HOSTS,
  MDS_GENERATOR_HOSTS,
  MDS_PARTIALS,
  DIST_COMMAND_FILES,
} from './fixtures/mds-manifest.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(ROOT, 'scripts', 'build-mds.ts');
/** This file's own source, read by the scenario-12 self-scan. */
const SELF = import.meta.filename;

/**
 * Every test here spawns at least one `tsx scripts/build-mds.ts` subprocess, and
 * the whole-tree ones spawn a build over the entire committed .mds corpus. The
 * 5s vitest default is far below what a cold tsx start costs under full-suite
 * load, so the file declares its own floor once rather than annotating each of
 * ~25 tests (the copied-tree probe, which builds twice, raises it further at its
 * own call site).
 */
vi.setConfig({ testTimeout: 120_000 });

/** The 13 basenames compiled from .mds hosts into dist/commands/. */
const COMPILED_COMMANDS = MDS_COMMAND_HOSTS;

/**
 * Run the real build script against an isolated fake root.
 *
 * Deliberately spelled out here rather than imported from helpers: this file's
 * scenario-12 self-scan reads its own source for `spawnSync(` sites, so the one
 * spawn it is allowed to make must be visible to that scan.
 */
function runBuild(fakeRoot: string): BuildRun {
  const result = spawnSync(TSX_BIN, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, DEVFLOW_MDS_ROOT: fakeRoot },
  });
  if (result.error) throw result.error;
  return { status: result.status, combined: (result.stdout ?? '') + (result.stderr ?? '') };
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

afterAll(cleanupCommittedTree);

/** sha256 of every .md under `<root>/dist/<sub>/`, keyed `<sub>/<file>`. */
async function hashDistSubtree(root: string, sub: string): Promise<Map<string, string>> {
  const dir = path.join(root, 'dist', sub);
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter(f => f.endsWith('.md'));
  } catch {
    return new Map();
  }
  const hashes = new Map<string, string>();
  for (const name of names.sort()) {
    hashes.set(`${sub}/${name}`, sha256(await fs.readFile(path.join(dir, name), 'utf-8')));
  }
  return hashes;
}

/** Both build destinations of a dist/ tree, hashed into one map. */
async function hashDistTree(root: string): Promise<Map<string, string>> {
  const [commands, agents] = await Promise.all([
    hashDistSubtree(root, 'commands'),
    hashDistSubtree(root, 'agents'),
  ]);
  return new Map([...commands, ...agents]);
}

interface TreeDiff {
  /** Built from the committed sources but absent on disk — dist/ is behind src/. */
  missingOnDisk: string[];
  /** Present on disk but not produced by the build — a stale orphan. */
  orphanOnDisk: string[];
  /** Present in both, different bytes — dist/ does not match its source. */
  differing: string[];
  /** How many files were actually byte-compared (0 means the check is vacuous). */
  compared: number;
}

/**
 * Named collector: how a freshly built tree differs from the on-disk one.
 * Shared by the staleness assertion and its known-bad probe below.
 */
function diffDistTrees(fresh: Map<string, string>, onDisk: Map<string, string>): TreeDiff {
  const missingOnDisk: string[] = [];
  const differing: string[] = [];
  let compared = 0;
  for (const [file, hash] of fresh) {
    const disk = onDisk.get(file);
    if (disk === undefined) {
      missingOnDisk.push(file);
      continue;
    }
    compared++;
    if (disk !== hash) differing.push(file);
  }
  const orphanOnDisk = [...onDisk.keys()].filter(f => !fresh.has(f));
  return {
    missingOnDisk: missingOnDisk.sort(),
    orphanOnDisk: orphanOnDisk.sort(),
    differing: differing.sort(),
    compared,
  };
}

/**
 * Split the real git agent into its frontmatter block and body. Resolved
 * dist-first with a src fallback, so the fixture keeps working whether the
 * agent is compiled from a generator host or hand-authored.
 * Fixtures are derived from this real runtime shape rather than invented (PF-043).
 */
async function realAgentShape(): Promise<{ frontmatter: string; bodyHead: string }> {
  const { path: realPath, content: real } = resolveAgentSource('git');
  const fm = splitFrontmatter(real);
  if (!fm) {
    throw new Error(`${realPath} has no leading frontmatter block — fixture cannot be derived`);
  }
  // First few body lines only: the strip semantics are what is under test, and
  // git.md's full body contains {…} spans that MDS would treat as interpolation.
  const bodyHead = fm.body.split('\n').slice(0, 4).join('\n') + '\n';
  return { frontmatter: fm.block, bodyHead };
}

/** Write a generator host (block 1 = output-dir, block 2 = real agent frontmatter). */
async function writeGeneratorHost(
  fakeRoot: string,
  name: string,
  extraKeys = '',
): Promise<{ frontmatter: string; bodyHead: string }> {
  const { frontmatter, bodyHead } = await realAgentShape();
  const host = `---\noutput-dir: dist/agents\n${extraKeys}---\n${frontmatter}${bodyHead}`;
  const dir = path.join(fakeRoot, 'src', 'assets', 'agents');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.mds`), host, 'utf-8');
  return { frontmatter, bodyHead };
}

/** Write a plain command host into the fake root. */
async function writeCommandHost(fakeRoot: string, name: string, frontmatterBody: string): Promise<void> {
  const dir = path.join(fakeRoot, 'src', 'assets', 'commands');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${name}.mds`),
    `---\n${frontmatterBody}---\n\n# ${name}\n\nBody line.\n`,
    'utf-8',
  );
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf-8');
  } catch {
    return null;
  }
}

async function withFakeRoot<T>(fn: (fakeRoot: string) => Promise<T>): Promise<T> {
  const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-mds-genhost-'));
  try {
    return await fn(fakeRoot);
  } finally {
    await fs.rm(fakeRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1. generator frontmatter whole-block strip
// ---------------------------------------------------------------------------

describe('generator frontmatter whole-block strip', () => {
  it('compiles a dist/agents host to dist/agents/<name>.md', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeGeneratorHost(fakeRoot, 'git');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 0.\n${run.combined}`).toBe(0);
      const out = await readIfPresent(path.join(fakeRoot, 'dist', 'agents', 'git.md'));
      expect(out, 'dist/agents/git.md should have been produced').not.toBeNull();
    });
  });

  it('strips the whole generator block, leaving block 2 as the artifact frontmatter', async () => {
    await withFakeRoot(async fakeRoot => {
      const { frontmatter, bodyHead } = await writeGeneratorHost(fakeRoot, 'git');
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      const out = await readIfPresent(path.join(fakeRoot, 'dist', 'agents', 'git.md'));
      expect(out).not.toBeNull();

      // Byte-exact: block 2 plus body, with the blank line after the closing
      // --- preserved. This is the property Phase 1's golden gate depends on.
      expect(out).toBe(frontmatter + bodyHead);
      expect(out!.startsWith('---\nname: Git\n')).toBe(true);
      expect(out).toContain('model: haiku');
      expect(out).not.toContain('output-dir:');
    });
  });

  it('known-bad probe: a key-only strip would leave an empty leading block', async () => {
    // If the command hosts' key-only strip were applied to a generator host, the
    // output would begin with an emptied `---\n---\n` block instead of the real
    // agent frontmatter. The assertions above must distinguish the two.
    await withFakeRoot(async fakeRoot => {
      const { frontmatter, bodyHead } = await writeGeneratorHost(fakeRoot, 'git');
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);
      const out = await readIfPresent(path.join(fakeRoot, 'dist', 'agents', 'git.md'));

      const keyOnlyStripResult = `---\n---\n${frontmatter}${bodyHead}`;
      expect(out).not.toBe(keyOnlyStripResult);
      expect(out!.startsWith('---\n---\n')).toBe(false);
    });
  });

  it('a generator host may not smuggle a second key into the generator block', async () => {
    // The generator block carries output-dir: (and, when present, output-name:).
    // Whatever it carries is stripped whole — it must never reach the artifact.
    await withFakeRoot(async fakeRoot => {
      await writeGeneratorHost(fakeRoot, 'git', 'output-name: git\n');
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);
      const out = await readIfPresent(path.join(fakeRoot, 'dist', 'agents', 'git.md'));
      expect(out).not.toBeNull();
      expect(out).not.toContain('output-name:');
      expect(out).not.toContain('output-dir:');
      expect(out!.startsWith('---\nname: Git\n')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. 13 command outputs byte-unchanged (key-only strip retained)
// ---------------------------------------------------------------------------

describe('13 command outputs byte-unchanged (key-only strip retained)', () => {
  /**
   * Named collector: for each compiled command output, the shape of its leading
   * frontmatter block. Used by both the main assertion and the known-bad probe.
   */
  function collectFrontmatterShapes(contents: Array<{ name: string; text: string }>): Array<{
    name: string;
    hasBlock: boolean;
    hasOutputDir: boolean;
    hasDescription: boolean;
  }> {
    return contents.map(({ name, text }) => {
      const fm = splitFrontmatter(text);
      const block = fm ? fm.inner : '';
      return {
        name,
        hasBlock: fm !== null,
        hasOutputDir: /^output-dir:/m.test(block),
        hasDescription: /^description:/m.test(block),
      };
    });
  }

  function realCommandContents(): Array<{ name: string; text: string }> {
    return COMPILED_COMMANDS.map(name => ({ name, text: requireDistFile(`${name}.md`) }));
  }

  it('dist/commands/ holds all 13 compiled outputs (fail-loud when unbuilt)', () => {
    const distFiles = requireDistFiles();
    expect(distFiles.length, 'dist/commands/ must not be empty (PF-018)').toBeGreaterThan(0);
    for (const name of COMPILED_COMMANDS) {
      expect(distFiles, `dist/commands/${name}.md missing`).toContain(`${name}.md`);
    }
  });

  it('every command output keeps its frontmatter block minus output-dir:', () => {
    const shapes = collectFrontmatterShapes(realCommandContents());
    expect(shapes.length, 'command corpus must be non-empty (PF-018)').toBe(COMPILED_COMMANDS.length);
    for (const shape of shapes) {
      expect(shape.hasBlock, `${shape.name}.md lost its frontmatter block`).toBe(true);
      expect(shape.hasOutputDir, `${shape.name}.md leaked output-dir:`).toBe(false);
      expect(shape.hasDescription, `${shape.name}.md lost description:`).toBe(true);
    }
  });

  it('known-bad probe: whole-block-stripped command output fails the same collector', () => {
    // Apply the generator strip to a real command output and re-run the collector.
    // If the guard above could not tell the two strips apart, this would pass.
    const real = requireDistFile('implement.md');
    const wholeBlockStripped = real.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    const shapes = collectFrontmatterShapes([{ name: 'implement', text: wholeBlockStripped }]);
    expect(shapes[0].hasDescription, 'known-bad sample must fail the description check').toBe(false);
  });

  /**
   * AC-1.5 ("the 13 command outputs are byte-unchanged across the S1 refactor")
   * needs a mechanical proof that outlives the PR that made the claim. The
   * pre-S1 SHA-256 list was captured and compared by hand and is recorded in the
   * PR #334 body; it is not in the repo, so it cannot re-run and is a claim, not
   * evidence (PF-019).
   *
   * A byte-IDEMPOTENCE check does not stand in for it: agreeing with itself
   * across two runs is a property of the build, not of the artifacts, and it
   * passes just as green over a dist/ tree that no longer matches src/ at all
   * (PF-057 — a golden must freeze what it says it freezes).
   *
   * What this pins instead: the dist/ tree on disk is byte-for-byte what the
   * committed src/ tree compiles to. Combined with the hand-verified pre-S1
   * hashes, that carries AC-1.5 forward for as long as dist/ carries the
   * reviewed bytes — but note the scope honestly: dist/ is gitignored, so this
   * compares a fresh build against whatever dist/ the working tree holds, not
   * against reviewed bytes committed to git. It catches "someone edited src/ and
   * did not rebuild" and "someone hand-edited dist/"; it cannot catch a src/
   * change that was rebuilt before review.
   */
  it('the on-disk dist/ tree is byte-for-byte a build of the committed src/ tree', async () => {
    const { run, root } = await buildCommittedTree();
    expect(run.status, `copied-tree build should exit 0.\n${run.combined}`).toBe(0);

    const fresh = await hashDistTree(root);
    const onDisk = await hashDistTree(ROOT);

    // Non-vacuity: the fresh tree must hold every artifact the manifest names,
    // or an empty/partial build would compare zero files and pass (PF-018).
    for (const file of DIST_COMMAND_FILES) {
      expect([...fresh.keys()], `commands/${file} missing from the fresh build`)
        .toContain(`commands/${file}`);
    }
    for (const name of MDS_GENERATOR_HOSTS) {
      expect([...fresh.keys()], `agents/${name}.md missing from the fresh build`)
        .toContain(`agents/${name}.md`);
    }

    const diff = diffDistTrees(fresh, onDisk);
    const remedy = 'run `npm run build:mds` — dist/ is out of sync with src/';
    expect(diff.compared, 'no file was byte-compared (PF-018)')
      .toBe(DIST_COMMAND_FILES.length + MDS_GENERATOR_HOSTS.length);
    expect(diff.missingOnDisk, `built from src/ but absent from dist/ — ${remedy}`).toEqual([]);
    expect(diff.orphanOnDisk, `present in dist/ but built by nothing — ${remedy}`).toEqual([]);
    expect(diff.differing, `dist/ bytes differ from a fresh build of src/ — ${remedy}`).toEqual([]);
  });

  it('known-bad probe: the tree collector reports drift in each direction', () => {
    const fresh = new Map([['commands/a.md', 'h1'], ['commands/b.md', 'h2']]);

    expect(diffDistTrees(fresh, new Map(fresh)))
      .toEqual({ missingOnDisk: [], orphanOnDisk: [], differing: [], compared: 2 });
    expect(diffDistTrees(fresh, new Map([['commands/a.md', 'EDITED'], ['commands/b.md', 'h2']])).differing)
      .toEqual(['commands/a.md']);
    expect(diffDistTrees(fresh, new Map([['commands/a.md', 'h1']])).missingOnDisk)
      .toEqual(['commands/b.md']);
    expect(diffDistTrees(fresh, new Map([...fresh, ['commands/stale.md', 'h3']])).orphanOnDisk)
      .toEqual(['commands/stale.md']);
    // An empty fresh tree compares nothing — the `compared` floor is what stops
    // that from reading as agreement.
    expect(diffDistTrees(new Map(), new Map()).compared).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. dest allowlist negatives
// ---------------------------------------------------------------------------

describe('dest allowlist negatives', () => {
  it('exits 1 with the "typo?" message for a non-allowlisted dir (dist/wrong-dir)', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(fakeRoot, '_neg-wrong-dir', 'description: neg\noutput-dir: dist/wrong-dir\n');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toMatch(/typo\?/i);
      // The pre-existing message template is preserved, now rendering both entries.
      expect(run.combined).toContain("is not the expected 'dist/commands' or 'dist/agents' — typo?");
    });
  });

  it('exits 1 with the "typo?" message for a trailing-slash dir (dist/commands/)', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(fakeRoot, '_neg-trailing-slash', 'description: neg\noutput-dir: dist/commands/\n');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toMatch(/typo\?/i);
      // And nothing was written to the target it resolves onto.
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', '_neg-trailing-slash.md'))).toBeNull();
    });
  });

  it('exits 1 with the escape message for a dir outside the root (dist/../..)', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(fakeRoot, '_neg-escape', 'description: neg\noutput-dir: dist/../..\n');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toMatch(/escapes the repo root/);
    });
  });

  it('accepts dist/agents as a legal destination (allowlist is not a one-entry pin)', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeGeneratorHost(fakeRoot, 'git');
      expect(runBuild(fakeRoot).status).toBe(0);
    });
  });

  it('names the canonical spelling when a declaration is non-canonical', async () => {
    // A trailing slash resolves ONTO an allowlisted target, so "is not the
    // expected 'dist/commands' or 'dist/agents'" misdirects the reader — the
    // declaration IS one of those, spelled wrong. The computed correction must
    // reach the message.
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(fakeRoot, '_neg-canonical-msg', 'description: neg\noutput-dir: dist/commands/\n');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toMatch(/is not spelled canonically/);
      expect(run.combined).toContain("write 'dist/commands' instead");
    });
  });
});

// ---------------------------------------------------------------------------
// 3b. every refusal is aggregated — no mid-loop exit leaves dist/ half-updated
// ---------------------------------------------------------------------------
//
// resolveOutputDir and validateOutputName return uniform Results, so the shell
// must route every refusal through the same channel: a throw the main loop
// aggregates, with one exit after the loop. A mid-loop process.exit() abandons
// the remaining hosts, leaving dist/ a mix of fresh and stale artifacts and
// reporting only the first of several independent mistakes.

describe('refusals are aggregated, not exited mid-loop', () => {
  /**
   * Named collector: for a fake root, the build's exit status, whether the
   * healthy host was still compiled, and whether the aggregate summary printed.
   */
  function collectAggregation(run: BuildRun, healthyOutput: string | null): {
    status: number | null;
    healthyCompiled: boolean;
    aggregated: boolean;
  } {
    return {
      status: run.status,
      healthyCompiled: healthyOutput !== null,
      aggregated: /compile error\(s\) — build FAILED/.test(run.combined),
    };
  }

  it('a non-allowlisted host does not abort the healthy host that follows it', async () => {
    await withFakeRoot(async fakeRoot => {
      // '_neg-…' sorts before 'zz-healthy', so the refusal is encountered first.
      await writeCommandHost(fakeRoot, '_neg-wrong-dir', 'description: neg\noutput-dir: dist/wrong-dir\n');
      await writeCommandHost(fakeRoot, 'zz-healthy', 'description: ok\noutput-dir: dist/commands\n');

      const run = runBuild(fakeRoot);
      const healthy = await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'zz-healthy.md'));
      const collected = collectAggregation(run, healthy);

      expect(collected.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(
        collected.healthyCompiled,
        `the healthy host must still be compiled — a mid-loop exit leaves dist/ half-updated.\n${run.combined}`,
      ).toBe(true);
      expect(collected.aggregated, `the refusal must reach main()'s aggregation.\n${run.combined}`).toBe(true);
    });
  });

  it('an invalid output filename does not abort the healthy host that follows it', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_neg-bad-name',
        'description: neg\noutput-dir: dist/commands\noutput-name: Not-A-Name\n',
      );
      await writeCommandHost(fakeRoot, 'zz-healthy', 'description: ok\noutput-dir: dist/commands\n');

      const run = runBuild(fakeRoot);
      const healthy = await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'zz-healthy.md'));
      const collected = collectAggregation(run, healthy);

      expect(collected.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(collected.healthyCompiled, `the healthy host must still be compiled.\n${run.combined}`).toBe(true);
      expect(collected.aggregated).toBe(true);
      expect(run.combined).toMatch(/invalid-charset/);
    });
  });

  it('known-bad probe: the collector reports a build that never reached the healthy host', () => {
    // A synthetic run standing in for the mid-loop-exit behaviour: exit 1, no
    // healthy output, no aggregate summary. The assertions above must fail on it.
    const midLoopExit: BuildRun = {
      status: 1,
      combined: "ERROR: _neg-wrong-dir.mds: output-dir 'dist/wrong-dir' is not the expected — typo?\n",
    };
    const collected = collectAggregation(midLoopExit, null);
    expect(collected.healthyCompiled).toBe(false);
    expect(collected.aggregated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. filename validation negatives
// ---------------------------------------------------------------------------

describe('filename validation negatives', () => {
  it('exits 1 when output-name escapes the output directory (../x)', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_neg-name-traversal',
        'description: neg\noutput-dir: dist/commands\noutput-name: ../x\n',
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toMatch(/is not a valid output filename/);
      expect(run.combined).toMatch(/dot-segment/);
      // Nothing was written next to the output directory.
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'x.md'))).toBeNull();
    });
  });

  it('exits 1 when output-name nests a path (a/b)', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_neg-name-nested',
        'description: neg\noutput-dir: dist/commands\noutput-name: a/b\n',
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toMatch(/is not a valid output filename/);
      expect(run.combined).toMatch(/path-separator/);
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'a', 'b.md'))).toBeNull();
    });
  });

  it('a valid output-name drives the emitted filename (the validated value has a consumer)', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_source-basename',
        'description: ok\noutput-dir: dist/commands\noutput-name: renamed-output\n',
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 0.\n${run.combined}`).toBe(0);
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'renamed-output.md'))).not.toBeNull();
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', '_source-basename.md'))).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 5. IGNORE_DIRS covers tests/ and coverage/
// ---------------------------------------------------------------------------
//
// A .mds committed under tests/ or coverage/ is a fixture or a coverage
// artifact, never a shipped host: the ignores are what make it impossible for
// such a file to be discovered by the whole-repo walk and written into the real
// dist/ tree (EC-50). The ignore is by directory name, so it applies under
// DEVFLOW_MDS_ROOT too — the fixtures below prove exactly that, by planting
// under <tmpRoot>/tests/ and <tmpRoot>/coverage/ and finding nothing compiled.

describe('IGNORE_DIRS covers tests/ and coverage/', () => {
  const FIXTURE_FM = 'description: planted fixture\noutput-dir: dist/commands\n';

  it('non-vacuity: the same fixture IS discovered outside an ignored directory', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(fakeRoot, 'planted', FIXTURE_FM);
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 0.\n${run.combined}`).toBe(0);
      expect(
        await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'planted.md')),
        'the fixture must be compilable when not planted under an ignored dir',
      ).not.toBeNull();
    });
  });

  it('a .mds planted under tests/fixtures/ is not discovered', async () => {
    await withFakeRoot(async fakeRoot => {
      const dir = path.join(fakeRoot, 'tests', 'fixtures');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'planted.mds'), `---\n${FIXTURE_FM}---\n\n# Planted\n`, 'utf-8');

      const run = runBuild(fakeRoot);
      // No hosts discovered at all → the build's own "no hosts" hard-fail.
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toMatch(/No MDS host files discovered/);
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'planted.md'))).toBeNull();
    });
  });

  it('a .mds planted under coverage/ is not discovered', async () => {
    await withFakeRoot(async fakeRoot => {
      const dir = path.join(fakeRoot, 'coverage');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'planted.mds'), `---\n${FIXTURE_FM}---\n\n# Planted\n`, 'utf-8');

      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toMatch(/No MDS host files discovered/);
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'planted.md'))).toBeNull();
    });
  });

  it('an ignored-directory fixture does not shadow a real host elsewhere in the tree', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(fakeRoot, 'real-host', 'description: real\noutput-dir: dist/commands\n');
      const dir = path.join(fakeRoot, 'tests');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'planted.mds'), `---\n${FIXTURE_FM}---\n\n# Planted\n`, 'utf-8');

      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 0.\n${run.combined}`).toBe(0);
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'real-host.md'))).not.toBeNull();
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'planted.md'))).toBeNull();
      expect(run.combined).toMatch(/1 host\(s\) to compile/);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. printed host/partial counts agree with the manifest (AC-1.8)
// ---------------------------------------------------------------------------
//
// The build prints two counts on every run:
//
//     {partialCount} partial(s) skipped (no output-dir:)
//     {hosts.length} host(s) to compile:
//
// Until now nothing read them: `grep 'partial(s) skipped' tests/` returned zero
// hits, so a discovery regression that silently dropped a host or reclassified a
// host as a partial would print the wrong number into a log nobody asserted on.
// discoverHosts() cannot be imported (build-mds.ts is a tsx script excluded from
// tsc), so the printed output is the seam — which is also the seam a human reads.

describe('printed host/partial counts agree with the manifest (AC-1.8)', () => {
  /**
   * Named collector: the two counts the build prints. Throws when either line is
   * absent — a missing line must fail loudly, never parse as 0 (PF-018).
   * Called by the committed-tree assertion AND by the seeded-tree probe below.
   */
  function parsePrintedCounts(output: string): { hosts: number; partials: number } {
    const hostMatch = /^\s*(\d+) host\(s\) to compile:/m.exec(output);
    const partialMatch = /^\s*(\d+) partial\(s\) skipped \(no output-dir:\)/m.exec(output);
    if (!hostMatch) {
      throw new Error(`build output has no "N host(s) to compile:" line:\n${output}`);
    }
    if (!partialMatch) {
      throw new Error(`build output has no "N partial(s) skipped" line:\n${output}`);
    }
    return { hosts: Number(hostMatch[1]), partials: Number(partialMatch[1]) };
  }

  /** Expected totals, derived from the manifest — never retyped as literals. */
  const EXPECTED_HOSTS = MDS_COMMAND_HOSTS.length + MDS_GENERATOR_HOSTS.length;
  const EXPECTED_PARTIALS = MDS_PARTIALS.length;

  it('a build of the committed tree prints the manifest host and partial counts', async () => {
    // Shares the one memoised spawn with the dist/-staleness check above.
    const { run } = await buildCommittedTree();
    expect(run.status, `copied-tree build should exit 0.\n${run.combined}`).toBe(0);

    const counts = parsePrintedCounts(run.combined);
    expect(
      counts.hosts,
      `build printed ${counts.hosts} host(s); the manifest names ${MDS_COMMAND_HOSTS.length} command ` +
      `host(s) + ${MDS_GENERATOR_HOSTS.length} generator host(s). Update tests/fixtures/mds-manifest.ts ` +
      `if a host was added or removed.`,
    ).toBe(EXPECTED_HOSTS);
    expect(
      counts.partials,
      `build printed ${counts.partials} skipped partial(s); the manifest names ${EXPECTED_PARTIALS}.`,
    ).toBe(EXPECTED_PARTIALS);
  }, 120_000);

  it('known-bad probe: one extra host in a copied tree moves the printed count off the manifest', async () => {
    // Mechanic 3 (H10): a DEVFLOW_MDS_ROOT copy of the real .mds tree, seeded with
    // one extra host. The real src/ and dist/ are never written to.
    await withFakeRoot(async fakeRoot => {
      await copyCommittedSources(fakeRoot);

      // Baseline: the copied tree reproduces the manifest counts exactly, so the
      // probe below is measuring the seeded host and nothing else.
      const baseline = runBuild(fakeRoot);
      expect(baseline.status, `copied-tree build should exit 0.\n${baseline.combined}`).toBe(0);
      const baseCounts = parsePrintedCounts(baseline.combined);
      expect(baseCounts.hosts).toBe(EXPECTED_HOSTS);
      expect(baseCounts.partials).toBe(EXPECTED_PARTIALS);

      // RED: seed one extra host.
      await writeCommandHost(fakeRoot, 'seeded-extra-host', 'description: seeded\noutput-dir: dist/commands\n');
      const seeded = runBuild(fakeRoot);
      expect(seeded.status, `seeded build should still exit 0.\n${seeded.combined}`).toBe(0);
      const seededCounts = parsePrintedCounts(seeded.combined);

      expect(
        seededCounts.hosts,
        'the printed host count must move when a host is added — otherwise the assertion above is vacuous',
      ).not.toBe(EXPECTED_HOSTS);
      expect(seededCounts.hosts).toBe(EXPECTED_HOSTS + 1);
      expect(seededCounts.partials, 'a host must not be miscounted as a partial').toBe(EXPECTED_PARTIALS);
    });
  }, 180_000);
});

// ---------------------------------------------------------------------------
// 7. build-owned keys never reach a command artifact
// ---------------------------------------------------------------------------
//
// A command host's frontmatter block is the ARTIFACT's frontmatter minus the
// keys the build consumes. `output-dir:` was stripped from the outset; a second
// build-owned key was later read from the same block but not stripped, so a host
// declaring it shipped a build directive inside the deployed command. Both keys
// are the build's, and neither may survive into dist/.

describe('build-owned keys never reach a command artifact', () => {
  /** Named collector: which build-owned keys survive into an emitted frontmatter block. */
  function collectLeakedBuildKeys(text: string): string[] {
    const fm = splitFrontmatter(text);
    if (fm === null) return ['<no frontmatter block>'];
    return ['output-dir', 'output-name'].filter(key => new RegExp(`^${key}:`, 'm').test(fm.inner));
  }

  it('a command host declaring output-name: ships neither build key', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_leak-probe',
        'description: leak probe\noutput-name: renamed-leak\noutput-dir: dist/commands\n',
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 0.\n${run.combined}`).toBe(0);

      const out = await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'renamed-leak.md'));
      expect(out, 'the renamed output should have been produced').not.toBeNull();

      expect(
        collectLeakedBuildKeys(out!),
        'a build-owned key survived into the shipped command frontmatter',
      ).toHaveLength(0);
      // The strip is key-scoped, not block-scoped: real keys are untouched.
      expect(out).toContain('description: leak probe');
    });
  });

  it('known-bad probe: the collector flags each build key when it is present', () => {
    expect(collectLeakedBuildKeys('---\ndescription: x\noutput-dir: dist/commands\n---\n\nBody\n'))
      .toEqual(['output-dir']);
    expect(collectLeakedBuildKeys('---\ndescription: x\noutput-name: y\n---\n\nBody\n'))
      .toEqual(['output-name']);
    expect(collectLeakedBuildKeys('---\ndescription: x\n---\n\nBody\n')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. a bare output-name: is a hard build error
// ---------------------------------------------------------------------------
//
// readFrontmatterKey returns '' — not null — for a valueless key, so `?? basename`
// never fires and the empty string reaches validateOutputName. Falling back to the
// basename would silently hide an authoring mistake, so a bare key is refused with
// the same explicit message shape `output-dir:` has always used.

describe('a bare output-name: is a hard build error', () => {
  it('exits 1 naming the key and the host, writing nothing', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_neg-bare-name',
        'description: neg\noutput-dir: dist/commands\noutput-name:\n',
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toContain('output-name: is empty');
      expect(run.combined).toContain('_neg-bare-name.mds');
      // The basename fallback must NOT have fired.
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', '_neg-bare-name.md'))).toBeNull();
    });
  });

  it('non-vacuity: the same host with a valued output-name: compiles', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_neg-bare-name',
        'description: ok\noutput-dir: dist/commands\noutput-name: valued\n',
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 0.\n${run.combined}`).toBe(0);
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'valued.md'))).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 9. two hosts may not claim one destination
// ---------------------------------------------------------------------------
//
// Destinations are joined per host with no cross-host bookkeeping, so two hosts
// resolving to the same path both write it and the last in walk order silently
// wins — one host's bytes shipped under the other's name. `output-name:` makes
// this reachable from a single directory; two same-basename hosts in different
// source directories reach it without any key at all.

describe('two hosts may not claim one destination', () => {
  it('exits 1 naming BOTH hosts and writes neither', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_collide-a',
        'description: a\noutput-dir: dist/commands\noutput-name: contested\n',
      );
      await writeCommandHost(
        fakeRoot, '_collide-b',
        'description: b\noutput-dir: dist/commands\noutput-name: contested\n',
      );

      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined, 'the first claimant must be named').toContain('_collide-a.mds');
      expect(run.combined, 'the second claimant must be named').toContain('_collide-b.mds');
      // Neither host wins: the build cannot know which was meant.
      expect(
        await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'contested.md')),
        'a contested destination must not be written by either claimant',
      ).toBeNull();
    });
  });

  it('two hosts sharing a basename across source directories also collide', async () => {
    // The collision class predates output-name:. A command host and a generator
    // host may share a basename (different destinations); two hosts pointed at
    // one destination may not.
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(fakeRoot, 'twin', 'description: a\noutput-dir: dist/commands\n');
      const other = path.join(fakeRoot, 'src', 'assets', 'other');
      await fs.mkdir(other, { recursive: true });
      await fs.writeFile(
        path.join(other, 'twin.mds'),
        '---\ndescription: b\noutput-dir: dist/commands\n---\n\n# twin\n\nBody.\n',
        'utf-8',
      );

      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'twin.md'))).toBeNull();
    });
  });

  it('non-vacuity: distinct destinations from the same directory both compile', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_collide-a',
        'description: a\noutput-dir: dist/commands\noutput-name: first\n',
      );
      await writeCommandHost(
        fakeRoot, '_collide-b',
        'description: b\noutput-dir: dist/commands\noutput-name: second\n',
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 0.\n${run.combined}`).toBe(0);
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'first.md'))).not.toBeNull();
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'second.md'))).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 10. a generator host must carry TWO frontmatter blocks
// ---------------------------------------------------------------------------
//
// The generator strip removes the leading block unconditionally. On a host with
// only ONE block — the shape every hand-authored agent has — that block IS the
// artifact's frontmatter (name:/description:/model:), and removing it produced a
// headerless agent while the build reported success (PF-061: a delete-a-block
// transform verified its pre-condition and not its post-condition).

describe('a generator host must carry TWO frontmatter blocks', () => {
  it('a single-block dist/agents host fails the build and writes nothing', async () => {
    await withFakeRoot(async fakeRoot => {
      const dir = path.join(fakeRoot, 'src', 'assets', 'agents');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'lonely.mds'),
        '---\nname: Lonely\ndescription: single-block agent\nmodel: haiku\noutput-dir: dist/agents\n---\n\n# Lonely Agent\n\nBody.\n',
        'utf-8',
      );

      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toContain('no second frontmatter block');
      expect(run.combined).toContain('TWO leading frontmatter blocks');
      // Repo-relative, not a bare basename: two host directories can hold the
      // same basename, so the failure label must say which file failed.
      expect(run.combined).toContain(path.join('src', 'assets', 'agents', 'lonely.mds'));
      expect(
        await readIfPresent(path.join(fakeRoot, 'dist', 'agents', 'lonely.md')),
        'a headerless agent must never be written',
      ).toBeNull();
    });
  });

  it('non-vacuity: the same host with a second block compiles and keeps its frontmatter', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeGeneratorHost(fakeRoot, 'git');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 0.\n${run.combined}`).toBe(0);
      const out = await readIfPresent(path.join(fakeRoot, 'dist', 'agents', 'git.md'));
      expect(out!.startsWith('---\nname: Git\n')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 11. the whole-repo walk is depth-bounded and fails loudly at the bound
// ---------------------------------------------------------------------------
//
// Discovery recurses the whole repo, so it carries a fixed upper bound like
// every other loop in the project. The bound throws rather than truncating: a
// host silently skipped for being too deep compiles nothing while the build
// still reports success, which is a vacuous green (avoids PF-018).

describe('the whole-repo walk is depth-bounded', () => {
  /** Plant a compilable command host in `<fakeRoot>/d1/d2/…/d{levels}`. */
  async function plantHostAtDepth(fakeRoot: string, levels: number, name: string): Promise<void> {
    const dir = path.join(fakeRoot, ...Array.from({ length: levels }, (_, i) => `d${i + 1}`));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${name}.mds`),
      `---\ndescription: planted at depth ${levels}\noutput-dir: dist/commands\n---\n\n# ${name}\n\nBody line.\n`,
      'utf-8',
    );
  }

  it('a host past the depth bound fails the build, naming the bound', async () => {
    await withFakeRoot(async fakeRoot => {
      await plantHostAtDepth(fakeRoot, 13, 'too-deep');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toContain('exceeds the walk bound of 12 levels');
      expect(
        await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'too-deep.md')),
        'a host past the bound must not be compiled',
      ).toBeNull();
    });
  });

  it('non-vacuity: the same host one level shallower is discovered and compiled', async () => {
    await withFakeRoot(async fakeRoot => {
      await plantHostAtDepth(fakeRoot, 12, 'deep-enough');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 0.\n${run.combined}`).toBe(0);
      expect(
        await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'deep-enough.md')),
        'a host within the bound must still be discovered and compiled',
      ).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 13. orphans in dist/agents/ are pruned
// ---------------------------------------------------------------------------
//
// dist/agents/ is gitignored and outranks src/assets/agents/ in both resolvers,
// so a file left there — a renamed host's old output, a hand-dropped one —
// silently supersedes the audited source on every `devflow init`. The build owns
// that directory: after a clean plan, anything in it no generator host emits is
// removed. Scoped to dist/agents/ only; dist/commands/ additionally receives
// hand-authored copies (release.md) that no host claims.

describe('orphans in dist/agents/ are pruned', () => {
  /**
   * Named collector: the repo-relative paths the build reported pruning.
   * Shared by the assertion and every negative arm below.
   */
  function prunedPaths(combined: string): string[] {
    const found: string[] = [];
    for (const line of combined.split('\n')) {
      const match = /^\s*pruned:\s+(\S+)/.exec(line);
      if (match) found.push(match[1]);
    }
    return found;
  }

  /** Write a file into `<fakeRoot>/dist/agents/`, creating the directory. */
  async function plantInDistAgents(fakeRoot: string, name: string, body: string): Promise<string> {
    const dir = path.join(fakeRoot, 'dist', 'agents');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await fs.writeFile(file, body, 'utf-8');
    return file;
  }

  it('deletes an unclaimed dist/agents/*.md and names it in the output', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeGeneratorHost(fakeRoot, 'git');
      const stale = await plantInDistAgents(fakeRoot, 'stale.md', '---\nname: Stale\n---\n\nold\n');

      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 0.\n${run.combined}`).toBe(0);

      expect(await readIfPresent(stale), 'an unclaimed artifact must not survive the build').toBeNull();
      expect(prunedPaths(run.combined), 'the pruned path must be reported').toContain('dist/agents/stale.md');
      expect(run.combined, 'the reason must be stated').toContain('(no generator host)');
    });
  });

  it('known-bad probe: a claimed destination is never pruned', async () => {
    // Non-vacuity for the test above: the same run that deletes the orphan must
    // leave the real artifact alone, and a rebuild over an existing artifact must
    // prune nothing at all.
    await withFakeRoot(async fakeRoot => {
      await writeGeneratorHost(fakeRoot, 'git');
      await plantInDistAgents(fakeRoot, 'stale.md', 'old\n');

      const first = runBuild(fakeRoot);
      expect(first.status, first.combined).toBe(0);
      const artifact = path.join(fakeRoot, 'dist', 'agents', 'git.md');
      expect(await readIfPresent(artifact), 'the planned artifact must survive its own prune').not.toBeNull();
      expect(prunedPaths(first.combined)).toEqual(['dist/agents/stale.md']);

      const second = runBuild(fakeRoot);
      expect(second.status, second.combined).toBe(0);
      expect(await readIfPresent(artifact)).not.toBeNull();
      expect(prunedPaths(second.combined), 'a rebuild must prune nothing').toEqual([]);
    });
  });

  it('prunes nothing when the build refuses', async () => {
    // The aggregation path exits 1 with dist/ as the refusal found it. Pruning
    // there would delete a working artifact on the strength of a plan that was
    // never carried out.
    await withFakeRoot(async fakeRoot => {
      await writeGeneratorHost(fakeRoot, 'git');
      await writeCommandHost(fakeRoot, '_neg-wrong-dir', 'description: neg\noutput-dir: dist/wrong-dir\n');
      const stale = await plantInDistAgents(fakeRoot, 'stale.md', 'old\n');

      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(await readIfPresent(stale), 'a refused build must leave dist/agents/ as it found it').not.toBeNull();
      expect(prunedPaths(run.combined)).toEqual([]);
    });
  });

  it('leaves non-.md entries alone', async () => {
    // A concurrent build's `<dest>.<pid>.tmp` staging file lives here; deleting
    // it would fail that build's rename.
    await withFakeRoot(async fakeRoot => {
      await writeGeneratorHost(fakeRoot, 'git');
      const staging = await plantInDistAgents(fakeRoot, 'git.md.99999.tmp', 'staged\n');

      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);
      expect(await readIfPresent(staging), 'only .md artifacts are the build\'s to remove').not.toBeNull();
      expect(prunedPaths(run.combined)).toEqual([]);
    });
  });

  it('does not prune dist/commands/', async () => {
    // Deliberate scope: dist/commands/ holds release.md, copied verbatim from a
    // hand-authored source that is not a host, so "unclaimed" does not mean
    // "orphan" there.
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(fakeRoot, 'zz-healthy', 'description: ok\noutput-dir: dist/commands\n');
      const dir = path.join(fakeRoot, 'dist', 'commands');
      await fs.mkdir(dir, { recursive: true });
      const unclaimed = path.join(dir, 'hand-authored.md');
      await fs.writeFile(unclaimed, 'copied verbatim\n', 'utf-8');

      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);
      expect(await readIfPresent(unclaimed), 'dist/commands/ is out of the prune\'s scope').not.toBeNull();
      expect(prunedPaths(run.combined)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// 12. this file never spawns a build against the real repo root
// ---------------------------------------------------------------------------
//
// The header claims every build here is scoped to a temp DEVFLOW_MDS_ROOT. That
// claim decays the moment someone adds a spawn without one — and the failure it
// reintroduces is invisible locally: an unscoped build rewrites the real dist/
// while parallel vitest workers read it, so a stale tree is silently repaired
// mid-suite and whichever reader lost the race reports a flake instead of the
// staleness (PF-055). A prose invariant cannot detect that, so it is scanned.

describe('this file never spawns a build against the real repo root', () => {
  it('every spawned build is scoped to a temp DEVFLOW_MDS_ROOT', async () => {
    const source = await fs.readFile(SELF, 'utf-8');
    const { total, unscoped } = collectSpawnScoping(source);

    expect(total, 'the scan found no spawn site at all — it is measuring nothing (PF-018)')
      .toBeGreaterThan(0);
    expect(
      unscoped,
      'a build in this file is spawned without DEVFLOW_MDS_ROOT: it would write the real ' +
      'dist/ tree while parallel workers read it. Route it through runBuild(fakeRoot), or ' +
      'buildCommittedTree() when the whole committed corpus is needed.',
    ).toEqual([]);
  });

  it('non-vacuity: the real dist/ tree is what those builds would have written', async () => {
    // The scan is structural, so it is paired with the fact it protects: the real
    // dist/ tree exists and is readable from here. If the file's builds had been
    // repairing it, the staleness check above would be the thing that noticed.
    const onDisk = await hashDistTree(ROOT);
    expect(onDisk.size, 'dist/ must be built before this file runs').toBeGreaterThan(0);
  });

  it('known-bad probe: the collector flags an unscoped spawn and clears a scoped one', () => {
    // Built by concatenation for the same reason the collector splits its needle:
    // a literal here would be found by the scan over this very file.
    const CALL = 'spawn' + 'Sync(';
    const unscopedSite = `${CALL}TSX_BIN, [SCRIPT], {\n  cwd: ROOT,\n  timeout: 120_000,\n});`;
    const scopedSite =
      `${CALL}TSX_BIN, [SCRIPT], {\n  cwd: ROOT,\n  env: { DEVFLOW_MDS_ROOT: fakeRoot },\n});`;

    expect(collectSpawnScoping(unscopedSite)).toEqual({ total: 1, unscoped: [0] });
    expect(collectSpawnScoping(scopedSite)).toEqual({ total: 1, unscoped: [] });
    expect(collectSpawnScoping(`${unscopedSite}\n${scopedSite}`).unscoped).toHaveLength(1);
    expect(collectSpawnScoping('no spawns here').total).toBe(0);
  });
});

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
 *      outputs keep their frontmatter minus output-dir:, and a real build is
 *      byte-idempotent.
 *   3. dest allowlist negatives — dist/wrong-dir, dist/commands/, dist/../..
 *   4. filename validation negatives — name-template: ../x and a/b
 *   5. IGNORE_DIRS covers tests/ and coverage/
 *
 * Every negative runs the real script in a subprocess against an isolated
 * DEVFLOW_MDS_ROOT so the real src/assets/ and dist/ trees are never touched
 * (avoids PF-011: no racing the packaging tests).
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';

import { requireDistFiles, requireDistFile, resolveAgentSource } from './helpers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(ROOT, 'scripts', 'build-mds.ts');

/** The 13 basenames compiled from .mds hosts into dist/commands/. */
const COMPILED_COMMANDS = [
  'implement', 'plan', 'resolve', 'code-review', 'self-review',
  'research', 'bug-analysis', 'explore', 'debug',
  'dynamic-build', 'dynamic-plan', 'dynamic-profile', 'dynamic-tickets',
] as const;

interface BuildRun {
  status: number | null;
  combined: string;
}

/** Run the real build script against an isolated fake root. */
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

/** Run the real build script against the real repo root. */
function runRealBuild(): BuildRun {
  const result = spawnSync(TSX_BIN, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, combined: (result.stdout ?? '') + (result.stderr ?? '') };
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Split the real git agent into its frontmatter block and body. Resolved
 * dist-first with a src fallback, so the fixture keeps working whether the
 * agent is compiled from a generator host or hand-authored.
 * Fixtures are derived from this real runtime shape rather than invented (PF-043).
 */
async function realAgentShape(): Promise<{ frontmatter: string; bodyHead: string }> {
  const { path: realPath, content: real } = resolveAgentSource('git');
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(real);
  if (!match) {
    throw new Error(`${realPath} has no leading frontmatter block — fixture cannot be derived`);
  }
  // First few body lines only: the strip semantics are what is under test, and
  // git.md's full body contains {…} spans that MDS would treat as interpolation.
  const bodyHead = real.slice(match[0].length).split('\n').slice(0, 4).join('\n') + '\n';
  return { frontmatter: match[0], bodyHead };
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
    // The generator block carries output-dir: (and, when present, name-template:).
    // Whatever it carries is stripped whole — it must never reach the artifact.
    await withFakeRoot(async fakeRoot => {
      await writeGeneratorHost(fakeRoot, 'git', 'name-template: git\n');
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);
      const out = await readIfPresent(path.join(fakeRoot, 'dist', 'agents', 'git.md'));
      expect(out).not.toBeNull();
      expect(out).not.toContain('name-template:');
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
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
      const block = match ? match[1] : '';
      return {
        name,
        hasBlock: match !== null,
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

  it('a real build is byte-idempotent over dist/commands/', () => {
    const before = new Map(requireDistFiles().map(f => [f, sha256(requireDistFile(f))]));
    const run = runRealBuild();
    expect(run.status, `real build should exit 0.\n${run.combined}`).toBe(0);
    const after = new Map(requireDistFiles().map(f => [f, sha256(requireDistFile(f))]));

    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [file, hash] of before) {
      expect(after.get(file), `dist/commands/${file} changed across a rebuild`).toBe(hash);
    }
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
});

// ---------------------------------------------------------------------------
// 4. filename validation negatives
// ---------------------------------------------------------------------------

describe('filename validation negatives', () => {
  it('exits 1 when name-template escapes the output directory (../x)', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_neg-name-traversal',
        'description: neg\noutput-dir: dist/commands\nname-template: ../x\n',
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toMatch(/is not a valid output filename/);
      expect(run.combined).toMatch(/dot-segment/);
      // Nothing was written next to the output directory.
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'x.md'))).toBeNull();
    });
  });

  it('exits 1 when name-template nests a path (a/b)', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_neg-name-nested',
        'description: neg\noutput-dir: dist/commands\nname-template: a/b\n',
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toMatch(/is not a valid output filename/);
      expect(run.combined).toMatch(/path-separator/);
      expect(await readIfPresent(path.join(fakeRoot, 'dist', 'commands', 'a', 'b.md'))).toBeNull();
    });
  });

  it('a valid name-template drives the emitted filename (the validated value has a consumer)', async () => {
    await withFakeRoot(async fakeRoot => {
      await writeCommandHost(
        fakeRoot, '_source-basename',
        'description: ok\noutput-dir: dist/commands\nname-template: renamed-output\n',
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
// This PR introduces .mds fixtures under tests/. Without these ignores a fixture
// declaring output-dir: dist/commands would be discovered by the whole-repo walk
// and would write into the real dist/ (EC-50).

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

/**
 * The build's curation-variant wiring (D-LEARNING-VARIANTS; AC-127, AC-132,
 * AC-133, AC-135, AC-136).
 *
 * Two halves:
 *
 *   1. A FIXTURE host with arms, built under a throwaway DEVFLOW_MDS_ROOT, proves
 *      the wiring itself: the curation-on variant lands at today's path, the
 *      curation-off variant under dist/curation-off/ only for a host with an arm,
 *      no marker reaches either, the orphan prune is keyed on the files written,
 *      and a refusal (a bad arm, a marker in a reference module) fails the build.
 *      The real src/ and dist/ trees are only ever read.
 *
 *   2. The REAL built dist/ is held to the manifest roster and to the invariant
 *      "Markdown prompts carry no markers": the files under dist/curation-off/ are
 *      CURATION_VARIANT_HOSTS in both directions, each has its curation-on
 *      counterpart, and no dist/**\/*.md carries a marker. The roster is the 23
 *      hosts that carry an arm (the 14 commands and 9 agents); the arms themselves
 *      are held in tests/curation/curation-variants-arms.test.ts.
 *
 * The compliance axis (TP-6) is held the same way: a fixture with compliance and both-arm
 * hosts proves the compliance-off and both-off trees, the variant manifest at
 * dist/variant-axes.json, the prune of each new tree and the refusals that name the axis.
 *
 * Every build this file spawns is scoped by DEVFLOW_MDS_ROOT, which the
 * scenario-12 self-scan in tests/build-mds-generator-hosts.test.ts also checks for
 * the files that spawn one.
 */

import { describe, it, expect, vi } from 'vitest';
import { promises as fs, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { ROOT, walkFiles, type BuildRun } from '../helpers.js';
import { CURATION_OFF_FILES, CURATION_VARIANT_HOSTS } from '../fixtures/mds-manifest.js';
import { LEGACY_OFF_OUTPUT_DIR, containsCurationMarker, containsVariantMarker } from '../../src/core/curation-variants.js';

vi.setConfig({ testTimeout: 120_000 });

const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(ROOT, 'scripts', 'build-mds.ts');

const ON = '<!-- curation:on -->';
const OFF = '<!-- curation:off -->';
const END = '<!-- curation:end -->';

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

async function withFakeRoot<T>(fn: (fakeRoot: string) => Promise<T>): Promise<T> {
  const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-curation-variants-'));
  try {
    return await fn(fakeRoot);
  } finally {
    await fs.rm(fakeRoot, { recursive: true, force: true });
  }
}

async function write(fakeRoot: string, rel: string, text: string): Promise<void> {
  const file = path.join(fakeRoot, ...rel.split('/'));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf-8');
}

async function readIfPresent(fakeRoot: string, rel: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(fakeRoot, ...rel.split('/')), 'utf-8');
  } catch {
    return null;
  }
}

/** Named collector: the repo-relative paths the build reported pruning. */
function prunedPaths(combined: string): string[] {
  const found: string[] = [];
  for (const line of combined.split('\n')) {
    const match = /^\s*pruned:\s+(\S+)/.exec(line);
    if (match) found.push(match[1]);
  }
  return found;
}

/** Named collector: the count the build prints for the curation-off variants it wrote. */
function printedVariantCount(combined: string): number {
  const match = /^\s*(\d+) curation-off variant\(s\) written/m.exec(combined);
  if (!match) throw new Error(`build output has no "N curation-off variant(s) written" line:\n${combined}`);
  return Number(match[1]);
}

// ---------------------------------------------------------------------------
// Fixture hosts. Each is rendered from one model in three forms: with its arms,
// and with every arm resolved on and off by the test itself. The build's variants
// must equal the resolved forms compiled as plain hosts (AC-127).
// ---------------------------------------------------------------------------

type Form = 'arms' | 'on' | 'off';

/** An arm in one of the three forms: kept verbatim between markers, or resolved. */
function arm(form: Form, onLines: readonly string[], offLines: readonly string[] | null, indent = ''): string[] {
  if (form === 'on') return [...onLines];
  if (form === 'off') return offLines === null ? [] : [...offLines];
  const lines = [`${indent}${ON}`, ...onLines];
  if (offLines !== null) lines.push(`${indent}${OFF}`, ...offLines);
  lines.push(`${indent}${END}`);
  return lines;
}

/** The decisions partial: an arm inside a define body, expanded by the host. */
const PARTIAL = [
  '@define decisions_step():',
  ON,
  'Read the decisions index.',
  OFF,
  'Decisions are not loaded.',
  END,
  '@end',
  '',
  '@export decisions_step',
  '',
].join('\n');

/** The step the partial expands to, resolved for a form. */
function stepFor(form: Form): string[] {
  return form === 'arms' ? ['{{decisions_step()}}'] : arm(form, ['Read the decisions index.'], ['Decisions are not loaded.']);
}

/** A command host with an arm in a list, a fenced block and a define body. */
function alpha(form: Form, name = 'alpha'): string {
  return [
    '---',
    `description: ${name} command`,
    'output-dir: dist/commands',
    '---',
    ...(form === 'arms' ? ['@import { decisions_step } from "./_partials/_p.mds"'] : []),
    '',
    `# ${name}`,
    '',
    'Intro line.',
    '',
    '- first item',
    ...arm(form, ['  - decisions item'], null, '  '),
    '- last item',
    '',
    '```js',
    'const a = 1',
    ...arm(form, ['const DECISIONS_CONTEXT = load()'], ['const DECISIONS_CONTEXT = "(none)"']),
    'run(a)',
    '```',
    '',
    ...stepFor(form),
    '',
    'Outro.',
    '',
  ].join('\n');
}

/** An agent generator host with an arm in its second frontmatter block and in its body. */
function beta(form: Form, name = 'beta'): string {
  return [
    '---',
    'output-dir: dist/agents',
    '---',
    '---',
    `name: ${name}`,
    'description: a fixture agent',
    'skills:',
    '  - devflow:git',
    ...arm(form, ['  - devflow:apply-decisions'], null),
    '---',
    '',
    `# ${name}`,
    '',
    '## Input',
    '',
    '- **TASK**: what to do',
    ...arm(form, ['- **DECISIONS_CONTEXT** (optional): the index'], null),
    '',
  ].join('\n');
}

/** A host with no arm at all. */
const PLAIN_COMMAND = '---\ndescription: plain\noutput-dir: dist/commands\n---\n\n# plain\n\nNo arm here.\n';
const PLAIN_AGENT = '---\noutput-dir: dist/agents\n---\n---\nname: gamma\ndescription: no arm\n---\n\n# gamma\n';

async function seedFixture(fakeRoot: string): Promise<void> {
  await write(fakeRoot, 'src/assets/commands/_partials/_p.mds', PARTIAL);
  await write(fakeRoot, 'src/assets/commands/alpha.mds', alpha('arms'));
  await write(fakeRoot, 'src/assets/commands/plain.mds', PLAIN_COMMAND);
  await write(fakeRoot, 'src/assets/agents/beta.mds', beta('arms'));
  await write(fakeRoot, 'src/assets/agents/gamma.mds', PLAIN_AGENT);
}

describe('a fixture host with arms (D-LEARNING-VARIANTS)', () => {
  it('writes the curation-on variant at the host path and the curation-off variant under dist/curation-off/', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      const alphaOn = await readIfPresent(fakeRoot, 'dist/commands/alpha.md');
      const alphaOff = await readIfPresent(fakeRoot, 'dist/curation-off/commands/alpha.md');
      const betaOn = await readIfPresent(fakeRoot, 'dist/agents/beta.md');
      const betaOff = await readIfPresent(fakeRoot, 'dist/curation-off/agents/beta.md');
      expect(alphaOn, 'the curation-on command').not.toBeNull();
      expect(alphaOff, 'the curation-off command').not.toBeNull();
      expect(betaOn, 'the curation-on agent').not.toBeNull();
      expect(betaOff, 'the curation-off agent').not.toBeNull();

      // The arms themselves: which text each variant keeps.
      expect(alphaOn).toContain('  - decisions item');
      expect(alphaOn).toContain('const DECISIONS_CONTEXT = load()');
      expect(alphaOn).toContain('Read the decisions index.');
      expect(alphaOff).not.toContain('decisions item');
      expect(alphaOff).toContain('const DECISIONS_CONTEXT = "(none)"');
      expect(alphaOff).toContain('Decisions are not loaded.');
      expect(alphaOff).not.toContain('DECISIONS_CONTEXT = load()');

      // The agent: the skill line in the frontmatter and the input bullet are the arms.
      expect(betaOn!.startsWith('---\nname: beta\n')).toBe(true);
      expect(betaOn).toContain('  - devflow:apply-decisions');
      expect(betaOn).toContain('- **DECISIONS_CONTEXT**');
      expect(betaOff!.startsWith('---\nname: beta\n')).toBe(true);
      expect(betaOff).not.toContain('apply-decisions');
      expect(betaOff).not.toContain('DECISIONS_CONTEXT');
      expect(betaOff).toContain('  - devflow:git');
    });
  });

  it('the curation-off agent frontmatter is the curation-on frontmatter minus the arm line (AC-131 shape)', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      const frontmatter = (text: string): string[] => (/^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '').split('\n');
      const on = frontmatter((await readIfPresent(fakeRoot, 'dist/agents/beta.md'))!);
      const off = frontmatter((await readIfPresent(fakeRoot, 'dist/curation-off/agents/beta.md'))!);
      expect(on.length, 'the on frontmatter was not found').toBeGreaterThan(3);
      expect(on.filter(l => !off.includes(l))).toEqual(['  - devflow:apply-decisions']);
      expect(off.filter(l => !on.includes(l))).toEqual([]);
    });
  });

  it('each variant equals the same host compiled with its arms resolved by hand (AC-127)', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      // The references are plain hosts, so the build writes them with no split to do.
      await write(fakeRoot, 'src/assets/commands/alpha-on-ref.mds', alpha('on', 'alpha'));
      await write(fakeRoot, 'src/assets/commands/alpha-off-ref.mds', alpha('off', 'alpha'));
      await write(fakeRoot, 'src/assets/agents/beta-on-ref.mds', beta('on', 'beta'));
      await write(fakeRoot, 'src/assets/agents/beta-off-ref.mds', beta('off', 'beta'));
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      const equal = async (built: string, reference: string): Promise<void> => {
        const a = await readIfPresent(fakeRoot, built);
        const b = await readIfPresent(fakeRoot, reference);
        expect(a, built).not.toBeNull();
        expect(b, reference).not.toBeNull();
        expect(a, `${built} must equal ${reference}`).toBe(b);
      };
      await equal('dist/commands/alpha.md', 'dist/commands/alpha-on-ref.md');
      await equal('dist/curation-off/commands/alpha.md', 'dist/commands/alpha-off-ref.md');
      // The agent references differ from the hosts in their name line only, so the
      // comparison normalises it. Everything else must match byte for byte.
      const named = async (rel: string): Promise<string> =>
        ((await readIfPresent(fakeRoot, rel)) ?? '').replace(/^name: .*$/m, 'name: X').replace(/^# .*$/m, '# X');
      expect(await named('dist/agents/beta.md')).toBe(await named('dist/agents/beta-on-ref.md'));
      expect(await named('dist/curation-off/agents/beta.md')).toBe(await named('dist/agents/beta-off-ref.md'));
      // And the references are not themselves variants.
      expect(await readIfPresent(fakeRoot, 'dist/curation-off/commands/alpha-on-ref.md')).toBeNull();
    });
  });

  it('writes a curation-off variant only for a host that has an arm, and prints the count', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      expect(await readIfPresent(fakeRoot, 'dist/commands/plain.md')).not.toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/agents/gamma.md')).not.toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/curation-off/commands/plain.md')).toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/curation-off/agents/gamma.md')).toBeNull();
      expect(printedVariantCount(run.combined)).toBe(2);
      const off = walkFiles(path.join(fakeRoot, 'dist', 'curation-off'), f => f.endsWith('.md'))
        .map(f => path.relative(path.join(fakeRoot, 'dist', 'curation-off'), f).split(path.sep).join('/'))
        .sort();
      expect(off).toEqual(['agents/beta.md', 'commands/alpha.md']);
    });
  });

  it('no marker reaches any built file, the partial\'s define body included (AC-133)', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      const built = walkFiles(path.join(fakeRoot, 'dist'), f => f.endsWith('.md'));
      expect(built.length, 'the fixture build wrote nothing').toBeGreaterThanOrEqual(6);
      const survivors = built.filter(f => containsCurationMarker(readFileSync(f, 'utf-8')));
      expect(survivors, 'a marker survived into a built file').toEqual([]);
      // Control: the partial's source does carry them, so the scan above has something to miss.
      expect(containsCurationMarker(PARTIAL)).toBe(true);
    });
  });

  it('a host without a curation-off variant reports no variant for it, and an unchanged rebuild prunes nothing', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      const first = runBuild(fakeRoot);
      expect(first.status, first.combined).toBe(0);
      const second = runBuild(fakeRoot);
      expect(second.status, second.combined).toBe(0);
      expect(prunedPaths(second.combined), 'a rebuild must prune nothing').toEqual([]);
      expect(printedVariantCount(second.combined)).toBe(2);
    });
  });
});

describe('the orphan prune over dist/curation-off/ is keyed on the files written (AC-132)', () => {
  it('removes the variant of a host that lost its last arm, and keeps the others', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      expect(runBuild(fakeRoot).status).toBe(0);
      expect(await readIfPresent(fakeRoot, 'dist/curation-off/commands/alpha.md')).not.toBeNull();

      // alpha drops every arm (its partial call is replaced by plain text too).
      await write(fakeRoot, 'src/assets/commands/alpha.mds', PLAIN_COMMAND.replace('plain', 'alpha'));
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      expect(await readIfPresent(fakeRoot, 'dist/curation-off/commands/alpha.md'), 'its old variant must go').toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/curation-off/agents/beta.md'), 'a host that kept its arm keeps its variant').not.toBeNull();
      expect(prunedPaths(run.combined)).toEqual(['dist/curation-off/commands/alpha.md']);
      expect(run.combined, 'the reason must be stated').toContain('(no curation arm)');
      expect(printedVariantCount(run.combined)).toBe(1);
    });
  });

  it('removes a file nothing wrote, in either subtree or in a subdirectory of its own', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      await write(fakeRoot, 'dist/curation-off/commands/stale.md', 'old\n');
      await write(fakeRoot, 'dist/curation-off/agents/stale.md', 'old\n');
      await write(fakeRoot, 'dist/curation-off/skills/stale.md', 'old\n');
      await write(fakeRoot, 'dist/curation-off/stale.md', 'old\n');
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      expect(prunedPaths(run.combined).sort()).toEqual([
        'dist/curation-off/agents/stale.md',
        'dist/curation-off/commands/stale.md',
        'dist/curation-off/skills/stale.md',
        'dist/curation-off/stale.md',
      ]);
      expect(await readIfPresent(fakeRoot, 'dist/curation-off/commands/alpha.md'), 'a written variant is never pruned').not.toBeNull();
    });
  });

  it('prunes a tree with no host arm at all, and leaves a non-.md entry alone', async () => {
    await withFakeRoot(async fakeRoot => {
      await write(fakeRoot, 'src/assets/commands/plain.mds', PLAIN_COMMAND);
      await write(fakeRoot, 'dist/curation-off/commands/old.md', 'old\n');
      // A concurrent build's staging file: deleting it would fail that build's rename.
      await write(fakeRoot, 'dist/curation-off/commands/old.md.99999.tmp', 'staged\n');
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      expect(prunedPaths(run.combined)).toEqual(['dist/curation-off/commands/old.md']);
      expect(await readIfPresent(fakeRoot, 'dist/curation-off/commands/old.md.99999.tmp')).not.toBeNull();
      expect(printedVariantCount(run.combined)).toBe(0);
    });
  });

  it('prunes nothing when the build refuses', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      await write(fakeRoot, 'src/assets/commands/bad.mds', `---\ndescription: bad\noutput-dir: dist/commands\n---\n\n${ON}\nx\n${END}\n${END}\n`);
      await write(fakeRoot, 'dist/curation-off/commands/stale.md', 'old\n');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(await readIfPresent(fakeRoot, 'dist/curation-off/commands/stale.md'), 'a refused build leaves dist/ as it found it').not.toBeNull();
      expect(prunedPaths(run.combined)).toEqual([]);
    });
  });
});

describe('the retired off tree is removed by the build (TP-4)', () => {
  it('removes the whole folder, files and subfolders alike, and keeps the live tree', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      await write(fakeRoot, `${LEGACY_OFF_OUTPUT_DIR}/commands/old.md`, 'old\n');
      await write(fakeRoot, `${LEGACY_OFF_OUTPUT_DIR}/agents/deep/old.md`, 'old\n');
      await write(fakeRoot, `${LEGACY_OFF_OUTPUT_DIR}/commands/old.md.99999.tmp`, 'staged\n');
      await write(fakeRoot, `${LEGACY_OFF_OUTPUT_DIR}/notes.txt`, 'not markdown\n');
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      await expect(fs.lstat(path.join(fakeRoot, ...LEGACY_OFF_OUTPUT_DIR.split('/')))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(prunedPaths(run.combined)).toEqual([LEGACY_OFF_OUTPUT_DIR]);
      expect(run.combined, 'the reason must be stated').toContain('(retired off tree)');
      expect(await readIfPresent(fakeRoot, 'dist/curation-off/commands/alpha.md'), 'the live tree is written').not.toBeNull();
      expect(printedVariantCount(run.combined)).toBe(2);
    });
  });

  it('a rebuild finds nothing to remove and prints nothing about it', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      await write(fakeRoot, `${LEGACY_OFF_OUTPUT_DIR}/commands/old.md`, 'old\n');
      expect(runBuild(fakeRoot).status).toBe(0);
      const second = runBuild(fakeRoot);
      expect(second.status, second.combined).toBe(0);
      expect(prunedPaths(second.combined)).toEqual([]);
    });
  });

  it('a link in its place is removed as a link and its target is left alone', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-curation-outside-'));
      try {
        await fs.writeFile(path.join(outside, 'keep.md'), 'keep\n', 'utf-8');
        await fs.mkdir(path.join(fakeRoot, 'dist'), { recursive: true });
        await fs.symlink(outside, path.join(fakeRoot, ...LEGACY_OFF_OUTPUT_DIR.split('/')));
        const run = runBuild(fakeRoot);
        expect(run.status, run.combined).toBe(0);

        await expect(fs.lstat(path.join(fakeRoot, ...LEGACY_OFF_OUTPUT_DIR.split('/')))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await fs.readFile(path.join(outside, 'keep.md'), 'utf-8'), 'the target of the link is untouched').toBe('keep\n');
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('removes nothing when the build refuses', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      await write(fakeRoot, 'src/assets/commands/bad.mds', `---\ndescription: bad\noutput-dir: dist/commands\n---\n\n${ON}\nx\n${END}\n${END}\n`);
      await write(fakeRoot, `${LEGACY_OFF_OUTPUT_DIR}/commands/old.md`, 'old\n');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(await readIfPresent(fakeRoot, `${LEGACY_OFF_OUTPUT_DIR}/commands/old.md`), 'a refused build leaves dist/ as it found it').not.toBeNull();
    });
  });
});

describe('what the build refuses (AC-134, AC-135)', () => {
  it('a host with a bad arm fails the build, naming the host, the problem and a neighbour to find it by', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      await write(
        fakeRoot,
        'src/assets/commands/bad.mds',
        `---\ndescription: bad\noutput-dir: dist/commands\n---\n\n# bad\n\nThe step.\n${ON}\nfirst\n${ON}\nsecond\n${END}\n`,
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toContain('src/assets/commands/bad.mds: curation-variant split refused');
      expect(run.combined).toContain('arms do not nest');
      expect(run.combined, 'the quoted neighbour above the second marker').toContain('(below "first")');
      expect(run.combined).toContain('Line numbers count the compiled output');
      // The other hosts still compiled: one refusal does not abandon the rest.
      expect(await readIfPresent(fakeRoot, 'dist/commands/plain.md')).not.toBeNull();
    });
  });

  it('refuses each kind of bad arm at build time: unopened end, unclosed arm, empty arm, stray marker', async () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ['unopened', `text\n${END}\n`, 'a curation:end marker with no open arm'],
      ['unclosed', `${ON}\ntext\n`, 'is never closed with curation:end'],
      ['empty', `${ON}\n\n${END}\n`, 'holds no line with content'],
      ['stray', `text ${ON}\n`, 'names a curation marker but is not one'],
    ];
    await withFakeRoot(async fakeRoot => {
      for (const [name, bodyText] of cases) {
        await write(fakeRoot, `src/assets/commands/${name}.mds`, `---\ndescription: ${name}\noutput-dir: dist/commands\n---\n\n# ${name}\n\n${bodyText}`);
      }
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      for (const [name, , message] of cases) {
        expect(run.combined, `${name}: the host is named`).toContain(`src/assets/commands/${name}.mds: curation-variant split refused`);
        expect(run.combined, `${name}: the reason is stated`).toContain(message);
      }
    });
  });

  it('refuses the retired marker in any spacing or case, and writes nothing for that host (TP-4)', async () => {
    const spellings = ['<!-- learning:on -->', '<!--learning:off-->', '<!-- LEARNING : End -->', '\t<!--  Learning:on  -->'];
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      for (const [index, spelling] of spellings.entries()) {
        await write(
          fakeRoot,
          `src/assets/commands/retired${index}.mds`,
          `---\ndescription: retired\noutput-dir: dist/commands\n---\n\n# retired\n\n${spelling}\ntext\n`,
        );
      }
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      for (const index of spellings.keys()) {
        expect(run.combined, `${index}: the host is named`).toContain(`src/assets/commands/retired${index}.mds: curation-variant split refused`);
        expect(await readIfPresent(fakeRoot, `dist/commands/retired${index}.md`), `${index}: nothing is written`).toBeNull();
      }
      expect(run.combined).toContain('uses the retired learning marker');
      expect(run.combined, 'the replacement is named').toContain('<!-- curation:on -->');
    });
  });

  it('refuses a reference module that carries the retired marker', async () => {
    const source = readFileSync(path.join(ROOT, 'src', 'assets', 'mds', 'tracker', '_mcp.mds'), 'utf-8');
    const opLine = /^<!-- op: _mcp -->$/m.exec(source)?.[0];
    expect(opLine, 'the _mcp module no longer opens with its op marker — the probe is inert').toBeDefined();
    await withFakeRoot(async fakeRoot => {
      const marked = source.replace(opLine as string, `${opLine}\n<!-- learning:on -->\nA decisions line.\n<!-- learning:end -->`);
      expect(marked).not.toBe(source);
      await write(fakeRoot, 'src/assets/mds/tracker/_mcp.mds', marked);
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toContain('src/assets/mds/tracker/_mcp.mds: a reference module may not carry curation-variant markers');
      expect(await readIfPresent(fakeRoot, 'dist/skills/git/references/tracker/_mcp.md'), 'nothing is written for a refused module').toBeNull();
    });
  });

  it('refuses a reference module that carries a marker, and builds the same module without one (AC-135)', async () => {
    const source = readFileSync(path.join(ROOT, 'src', 'assets', 'mds', 'tracker', '_mcp.mds'), 'utf-8');
    const opLine = /^<!-- op: _mcp -->$/m.exec(source)?.[0];
    expect(opLine, 'the _mcp module no longer opens with its op marker — the probe is inert').toBeDefined();
    await withFakeRoot(async fakeRoot => {
      // Control: the unmodified module builds, so the refusal below is the marker's doing.
      await write(fakeRoot, 'src/assets/mds/tracker/_mcp.mds', source);
      const clean = runBuild(fakeRoot);
      expect(clean.status, clean.combined).toBe(0);
      expect(await readIfPresent(fakeRoot, 'dist/skills/git/references/tracker/_mcp.md')).not.toBeNull();
    });
    await withFakeRoot(async fakeRoot => {
      const marked = source.replace(opLine as string, `${opLine}\n${ON}\nA decisions line.\n${END}`);
      expect(marked).not.toBe(source);
      await write(fakeRoot, 'src/assets/mds/tracker/_mcp.mds', marked);
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toContain('src/assets/mds/tracker/_mcp.mds: a reference module may not carry curation-variant markers');
      expect(await readIfPresent(fakeRoot, 'dist/skills/git/references/tracker/_mcp.md'), 'nothing is written for a refused module').toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// The compliance axis in the build (TP-6). A host with a compliance arm gets a
// compliance-off variant, a host with both arms gets a both-off variant too, and
// the build records the axes of every compiled prompt in dist/variant-axes.json.
// ---------------------------------------------------------------------------

const CON = '<!-- compliance:on -->';
const COFF = '<!-- compliance:off -->';
const CEND = '<!-- compliance:end -->';

type Axis = 'curation' | 'compliance';

/** An arm of one axis in one of the three forms: kept verbatim between markers, or resolved. */
function axisArm(axis: Axis, form: Form, onLines: readonly string[], offLines: readonly string[] | null): string[] {
  if (form === 'on') return [...onLines];
  if (form === 'off') return offLines === null ? [] : [...offLines];
  const lines = [`<!-- ${axis}:on -->`, ...onLines];
  if (offLines !== null) lines.push(`<!-- ${axis}:off -->`, ...offLines);
  lines.push(`<!-- ${axis}:end -->`);
  return lines;
}

/**
 * A prompt host with a curation arm, a compliance arm, or both, each in a form of its
 * own: `none` leaves the axis out. The compliance arm nests inside the curation arm,
 * which is the shape the splitter allows for two axes, and a second one stands alone.
 */
function prompt(kind: 'commands' | 'agents', name: string, curation: Form | 'none', compliance: Form | 'none'): string {
  const head =
    kind === 'commands'
      ? ['---', `description: ${name} command`, 'output-dir: dist/commands', '---']
      : ['---', 'output-dir: dist/agents', '---', '---', `name: ${name}`, 'description: a fixture agent', '---'];
  const nested = compliance === 'none' ? [] : axisArm('compliance', compliance, ['Nested compliance line.'], null);
  const standalone = compliance === 'none' ? [] : axisArm('compliance', compliance, ['Compliance gate is on.'], ['Compliance gate is off.']);
  const decisions =
    curation === 'none' ? [] : axisArm('curation', curation, ['Decisions line.', ...nested], ['Decisions are not loaded.']);
  return [...head, '', `# ${name}`, '', 'Intro.', ...decisions, ...standalone, 'Outro.', ''].join('\n');
}

/** Hosts that carry one axis each, both axes, and none, in the two prompt kinds. */
async function seedComplianceFixture(fakeRoot: string): Promise<void> {
  await write(fakeRoot, 'src/assets/commands/kappa.mds', prompt('commands', 'kappa', 'arms', 'none'));
  await write(fakeRoot, 'src/assets/commands/delta.mds', prompt('commands', 'delta', 'none', 'arms'));
  await write(fakeRoot, 'src/assets/commands/theta.mds', prompt('commands', 'theta', 'arms', 'arms'));
  await write(fakeRoot, 'src/assets/agents/iota.mds', prompt('agents', 'iota', 'arms', 'arms'));
  await write(fakeRoot, 'src/assets/commands/plain.mds', PLAIN_COMMAND);
}

/** The compiled prompt files under one dist subtree of a fake root, relative to it, sorted. */
function treeOf(fakeRoot: string, sub: string): string[] {
  const dir = path.join(fakeRoot, ...sub.split('/'));
  return walkFiles(dir, f => f.endsWith('.md'))
    .map(f => path.relative(dir, f).split(path.sep).join('/'))
    .sort();
}

interface ManifestShape {
  version: number;
  hosts: Record<string, { curation: boolean; compliance: boolean }>;
}

async function manifestOf(fakeRoot: string): Promise<{ text: string; manifest: ManifestShape }> {
  const text = await readIfPresent(fakeRoot, 'dist/variant-axes.json');
  expect(text, 'the build wrote no dist/variant-axes.json').not.toBeNull();
  return { text: text as string, manifest: JSON.parse(text as string) as ManifestShape };
}

describe('a host with a compliance arm (TP-6)', () => {
  it('writes compliance-off for a compliance arm and both-off for both arms, and nothing for a host without them', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedComplianceFixture(fakeRoot);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      expect(treeOf(fakeRoot, 'dist/commands')).toEqual(['delta.md', 'kappa.md', 'plain.md', 'theta.md']);
      expect(treeOf(fakeRoot, 'dist/agents')).toEqual(['iota.md']);
      expect(treeOf(fakeRoot, 'dist/curation-off')).toEqual(['agents/iota.md', 'commands/kappa.md', 'commands/theta.md']);
      expect(treeOf(fakeRoot, 'dist/compliance-off')).toEqual(['agents/iota.md', 'commands/delta.md', 'commands/theta.md']);
      expect(treeOf(fakeRoot, 'dist/curation-compliance-off')).toEqual(['agents/iota.md', 'commands/theta.md']);
      expect(printedVariantCount(run.combined), 'the curation count is the hosts with a curation arm').toBe(3);
    });
  });

  it('each variant keeps the text of the arms its axes select, and no marker reaches a built file', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedComplianceFixture(fakeRoot);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      const text = async (rel: string): Promise<string> => (await readIfPresent(fakeRoot, rel)) ?? '';
      const on = await text('dist/commands/theta.md');
      const curationOff = await text('dist/curation-off/commands/theta.md');
      const complianceOff = await text('dist/compliance-off/commands/theta.md');
      const bothOff = await text('dist/curation-compliance-off/commands/theta.md');

      expect(on).toContain('Decisions line.');
      expect(on).toContain('Nested compliance line.');
      expect(on).toContain('Compliance gate is on.');
      expect(curationOff).toContain('Decisions are not loaded.');
      expect(curationOff).not.toContain('Decisions line.');
      expect(curationOff).not.toContain('Nested compliance line.');
      expect(curationOff).toContain('Compliance gate is on.');
      expect(complianceOff).toContain('Decisions line.');
      expect(complianceOff).not.toContain('Nested compliance line.');
      expect(complianceOff).toContain('Compliance gate is off.');
      expect(complianceOff).not.toContain('Compliance gate is on.');
      expect(bothOff).toContain('Decisions are not loaded.');
      expect(bothOff).toContain('Compliance gate is off.');
      expect(bothOff).not.toContain('Decisions line.');
      expect(bothOff).not.toContain('Compliance gate is on.');

      const built = walkFiles(path.join(fakeRoot, 'dist'), f => f.endsWith('.md'));
      expect(built.length, 'the fixture build wrote nothing').toBeGreaterThanOrEqual(12);
      expect(built.filter(f => containsVariantMarker(readFileSync(f, 'utf-8')))).toEqual([]);
    });
  });

  it('each of the four variants equals the same host compiled with its arms resolved by hand', async () => {
    await withFakeRoot(async fakeRoot => {
      await write(fakeRoot, 'src/assets/commands/theta.mds', prompt('commands', 'theta', 'arms', 'arms'));
      await write(fakeRoot, 'src/assets/commands/delta.mds', prompt('commands', 'delta', 'none', 'arms'));
      await write(fakeRoot, 'src/assets/agents/iota.mds', prompt('agents', 'iota', 'arms', 'arms'));
      // The references are plain hosts under other file names, so the build writes them with no split to do.
      const resolved: ReadonlyArray<readonly [string, Form, Form]> = [
        ['on-on', 'on', 'on'],
        ['cur-off', 'off', 'on'],
        ['comp-off', 'on', 'off'],
        ['both-off', 'off', 'off'],
      ];
      for (const [tag, cur, comp] of resolved) {
        await write(fakeRoot, `src/assets/commands/theta-${tag}-ref.mds`, prompt('commands', 'theta', cur, comp));
        await write(fakeRoot, `src/assets/agents/iota-${tag}-ref.mds`, prompt('agents', 'iota', cur, comp));
      }
      await write(fakeRoot, 'src/assets/commands/delta-on-ref.mds', prompt('commands', 'delta', 'none', 'on'));
      await write(fakeRoot, 'src/assets/commands/delta-off-ref.mds', prompt('commands', 'delta', 'none', 'off'));
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      const equal = async (built: string, reference: string): Promise<void> => {
        const a = await readIfPresent(fakeRoot, built);
        const b = await readIfPresent(fakeRoot, reference);
        expect(a, built).not.toBeNull();
        expect(b, reference).not.toBeNull();
        expect(a, `${built} must equal ${reference}`).toBe(b);
      };
      for (const kind of ['commands', 'agents'] as const) {
        const name = kind === 'commands' ? 'theta' : 'iota';
        await equal(`dist/${kind}/${name}.md`, `dist/${kind}/${name}-on-on-ref.md`);
        await equal(`dist/curation-off/${kind}/${name}.md`, `dist/${kind}/${name}-cur-off-ref.md`);
        await equal(`dist/compliance-off/${kind}/${name}.md`, `dist/${kind}/${name}-comp-off-ref.md`);
        await equal(`dist/curation-compliance-off/${kind}/${name}.md`, `dist/${kind}/${name}-both-off-ref.md`);
      }
      await equal('dist/commands/delta.md', 'dist/commands/delta-on-ref.md');
      await equal('dist/compliance-off/commands/delta.md', 'dist/commands/delta-off-ref.md');
      // And the references are not themselves variants.
      expect(treeOf(fakeRoot, 'dist/compliance-off')).toEqual(['agents/iota.md', 'commands/delta.md', 'commands/theta.md']);
    });
  });
});

describe('the variant manifest (TP-6)', () => {
  it('records the axes of every compiled command and agent, sorted, with a version', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedComplianceFixture(fakeRoot);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      const { text, manifest } = await manifestOf(fakeRoot);
      expect(manifest.version).toBe(1);
      expect(manifest.hosts).toEqual({
        'agents/iota': { curation: true, compliance: true },
        'commands/delta': { curation: false, compliance: true },
        'commands/kappa': { curation: true, compliance: false },
        'commands/plain': { curation: false, compliance: false },
        'commands/theta': { curation: true, compliance: true },
      });
      expect(Object.keys(manifest.hosts), 'the hosts are listed in sorted order').toEqual([
        'agents/iota',
        'commands/delta',
        'commands/kappa',
        'commands/plain',
        'commands/theta',
      ]);
      expect(text.endsWith('}\n'), 'the file ends in one newline').toBe(true);
    });
  });

  it('is written on a build where no host has a compliance arm, and no compliance tree appears', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      const { manifest } = await manifestOf(fakeRoot);
      expect(manifest.hosts).toEqual({
        'agents/beta': { curation: true, compliance: false },
        'agents/gamma': { curation: false, compliance: false },
        'commands/alpha': { curation: true, compliance: false },
        'commands/plain': { curation: false, compliance: false },
      });
      expect(treeOf(fakeRoot, 'dist/compliance-off')).toEqual([]);
      expect(treeOf(fakeRoot, 'dist/curation-compliance-off')).toEqual([]);
    });
  });

  it('is byte-identical across two builds of the same sources', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedComplianceFixture(fakeRoot);
      expect(runBuild(fakeRoot).status).toBe(0);
      const first = (await manifestOf(fakeRoot)).text;
      expect(runBuild(fakeRoot).status).toBe(0);
      expect((await manifestOf(fakeRoot)).text).toBe(first);
    });
  });

  it('lists no reference module: its sections are not prompts', async () => {
    const mcp = readFileSync(path.join(ROOT, 'src', 'assets', 'mds', 'tracker', '_mcp.mds'), 'utf-8');
    await withFakeRoot(async fakeRoot => {
      await write(fakeRoot, 'src/assets/mds/tracker/_mcp.mds', mcp);
      await write(fakeRoot, 'src/assets/commands/plain.mds', PLAIN_COMMAND);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);
      expect(await readIfPresent(fakeRoot, 'dist/skills/git/references/tracker/_mcp.md'), 'the module was built').not.toBeNull();
      expect(Object.keys((await manifestOf(fakeRoot)).manifest.hosts)).toEqual(['commands/plain']);
    });
  });

  it('is left as the build found it when the build refuses', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      await write(fakeRoot, 'src/assets/commands/bad.mds', `---\ndescription: bad\noutput-dir: dist/commands\n---\n\n${CON}\nx\n${CEND}\n${CEND}\n`);
      const absent = runBuild(fakeRoot);
      expect(absent.status, `expected exit 1.\n${absent.combined}`).toBe(1);
      expect(await readIfPresent(fakeRoot, 'dist/variant-axes.json'), 'a refused build writes no manifest').toBeNull();

      await write(fakeRoot, 'dist/variant-axes.json', 'old\n');
      const present = runBuild(fakeRoot);
      expect(present.status, `expected exit 1.\n${present.combined}`).toBe(1);
      expect(await readIfPresent(fakeRoot, 'dist/variant-axes.json'), 'a refused build leaves the old manifest').toBe('old\n');
    });
  });
});

describe('the orphan prune over the compliance trees is keyed on the files written (TP-6)', () => {
  it('removes a file nothing wrote from either tree, in any subdirectory, and leaves a non-.md entry alone', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedComplianceFixture(fakeRoot);
      await write(fakeRoot, 'dist/compliance-off/commands/stale.md', 'old\n');
      await write(fakeRoot, 'dist/compliance-off/agents/deep/stale.md', 'old\n');
      await write(fakeRoot, 'dist/compliance-off/stale.md', 'old\n');
      await write(fakeRoot, 'dist/curation-compliance-off/commands/stale.md', 'old\n');
      await write(fakeRoot, 'dist/curation-compliance-off/skills/stale.md', 'old\n');
      // A concurrent build's staging file: deleting it would fail that build's rename.
      await write(fakeRoot, 'dist/compliance-off/commands/theta.md.99999.tmp', 'staged\n');
      await write(fakeRoot, 'dist/curation-compliance-off/commands/theta.md.99999.tmp', 'staged\n');
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      expect(prunedPaths(run.combined).sort()).toEqual([
        'dist/compliance-off/agents/deep/stale.md',
        'dist/compliance-off/commands/stale.md',
        'dist/compliance-off/stale.md',
        'dist/curation-compliance-off/commands/stale.md',
        'dist/curation-compliance-off/skills/stale.md',
      ]);
      expect(run.combined, 'the compliance-off reason must be stated').toContain('(no compliance arm)');
      expect(run.combined, 'the both-off reason must be stated').toContain('(no curation and compliance arms)');
      expect(await readIfPresent(fakeRoot, 'dist/compliance-off/commands/theta.md'), 'a written variant is never pruned').not.toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/curation-compliance-off/commands/theta.md'), 'a written variant is never pruned').not.toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/compliance-off/commands/theta.md.99999.tmp')).not.toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/curation-compliance-off/commands/theta.md.99999.tmp')).not.toBeNull();
    });
  });

  it('removes the variants of a host that lost an arm, and keeps the variants it still has', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedComplianceFixture(fakeRoot);
      expect(runBuild(fakeRoot).status).toBe(0);
      expect(treeOf(fakeRoot, 'dist/curation-compliance-off')).toEqual(['agents/iota.md', 'commands/theta.md']);

      // theta drops its compliance arm, so it keeps curation-off and loses compliance-off and both-off.
      await write(fakeRoot, 'src/assets/commands/theta.mds', prompt('commands', 'theta', 'arms', 'none'));
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      expect(prunedPaths(run.combined).sort()).toEqual([
        'dist/compliance-off/commands/theta.md',
        'dist/curation-compliance-off/commands/theta.md',
      ]);
      expect(treeOf(fakeRoot, 'dist/curation-off')).toEqual(['agents/iota.md', 'commands/kappa.md', 'commands/theta.md']);
      expect(treeOf(fakeRoot, 'dist/compliance-off')).toEqual(['agents/iota.md', 'commands/delta.md']);
      expect(treeOf(fakeRoot, 'dist/curation-compliance-off')).toEqual(['agents/iota.md']);
      const { manifest } = await manifestOf(fakeRoot);
      expect(manifest.hosts['commands/theta']).toEqual({ curation: true, compliance: false });
    });
  });

  it('prunes a tree when no host carries an arm at all', async () => {
    await withFakeRoot(async fakeRoot => {
      await write(fakeRoot, 'src/assets/commands/plain.mds', PLAIN_COMMAND);
      await write(fakeRoot, 'dist/compliance-off/commands/old.md', 'old\n');
      await write(fakeRoot, 'dist/curation-compliance-off/agents/old.md', 'old\n');
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);
      expect(prunedPaths(run.combined).sort()).toEqual(['dist/compliance-off/commands/old.md', 'dist/curation-compliance-off/agents/old.md']);
    });
  });

  it('an unchanged rebuild prunes nothing', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedComplianceFixture(fakeRoot);
      expect(runBuild(fakeRoot).status).toBe(0);
      const second = runBuild(fakeRoot);
      expect(second.status, second.combined).toBe(0);
      expect(prunedPaths(second.combined), 'a rebuild must prune nothing').toEqual([]);
    });
  });

  it('prunes nothing when the build refuses', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedComplianceFixture(fakeRoot);
      await write(fakeRoot, 'src/assets/commands/bad.mds', `---\ndescription: bad\noutput-dir: dist/commands\n---\n\n${CON}\nx\n${CEND}\n${CEND}\n`);
      await write(fakeRoot, 'dist/compliance-off/commands/stale.md', 'old\n');
      await write(fakeRoot, 'dist/curation-compliance-off/commands/stale.md', 'old\n');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(await readIfPresent(fakeRoot, 'dist/compliance-off/commands/stale.md'), 'a refused build leaves dist/ as it found it').not.toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/curation-compliance-off/commands/stale.md'), 'a refused build leaves dist/ as it found it').not.toBeNull();
      expect(prunedPaths(run.combined)).toEqual([]);
    });
  });
});

describe('what the build refuses on the compliance axis (TP-6)', () => {
  it('names the axis of the refusal: a compliance arm that does not nest is a compliance-variant refusal with a neighbour to find it by', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedComplianceFixture(fakeRoot);
      await write(
        fakeRoot,
        'src/assets/commands/bad.mds',
        `---\ndescription: bad\noutput-dir: dist/commands\n---\n\n# bad\n\nThe step.\n${CON}\nfirst\n${CON}\nsecond\n${CEND}\n`,
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toContain('src/assets/commands/bad.mds: compliance-variant split refused');
      expect(run.combined).not.toContain('src/assets/commands/bad.mds: curation-variant split refused');
      expect(run.combined).toContain('a compliance:on marker inside the on arm');
      expect(run.combined, 'the quoted neighbour above the second marker').toContain('(below "first")');
      // The other hosts still compiled: one refusal does not abandon the rest.
      expect(await readIfPresent(fakeRoot, 'dist/commands/plain.md')).not.toBeNull();
    });
  });

  it('the neighbour of a refusal skips a compliance marker line, as it skips a curation one', async () => {
    await withFakeRoot(async fakeRoot => {
      await write(
        fakeRoot,
        'src/assets/commands/bad.mds',
        `---\ndescription: bad\noutput-dir: dist/commands\n---\n\n# bad\n\nBefore.\n${CON}\n${CON}\nx\n${CEND}\n`,
      );
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(run.combined).toContain('(below "Before.")');
    });
  });

  it('refuses a stray compliance marker and an interleaving of the two axes, each naming its axis', async () => {
    const cases: ReadonlyArray<readonly [string, string, string, string]> = [
      ['stray', `text ${CON}\n`, 'compliance-variant split refused', 'names a compliance marker but is not one'],
      ['unopened', `text\n${CEND}\n`, 'compliance-variant split refused', 'a compliance:end marker with no open arm'],
      ['unclosed', `${CON}\ntext\n`, 'compliance-variant split refused', 'is never closed with compliance:end'],
      ['overlap', `${ON}\ntext\n${CON}\nmore\n${END}\n${CEND}\n`, 'curation-variant split refused', 'arms of two axes may nest but not overlap'],
    ];
    await withFakeRoot(async fakeRoot => {
      for (const [name, bodyText] of cases) {
        await write(fakeRoot, `src/assets/commands/${name}.mds`, `---\ndescription: ${name}\noutput-dir: dist/commands\n---\n\n# ${name}\n\n${bodyText}`);
      }
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      for (const [name, , label, message] of cases) {
        expect(run.combined, `${name}: the host and axis are named`).toContain(`src/assets/commands/${name}.mds: ${label}`);
        expect(run.combined, `${name}: the reason is stated`).toContain(message);
        expect(await readIfPresent(fakeRoot, `dist/commands/${name}.md`), `${name}: nothing is written`).toBeNull();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// The real built tree
// ---------------------------------------------------------------------------

const DIST = path.join(ROOT, 'dist');

/** Named collector: the .md files under a dist subtree, relative to it, POSIX-separated. */
function distMarkdown(sub: string): string[] {
  const dir = path.join(DIST, sub);
  return walkFiles(dir, f => f.endsWith('.md')).map(f => path.relative(dir, f).split(path.sep).join('/')).sort();
}

/** Named collector: the dist/ Markdown files carrying a curation marker. Driven by the live assertion and its probe. */
function collectSurvivingMarkers(files: ReadonlyArray<{ readonly name: string; readonly content: string }>): string[] {
  return files.filter(f => containsCurationMarker(f.content)).map(f => f.name);
}

describe('the built dist/ tree', () => {
  it('requires a build: the prompt trees are present', () => {
    for (const sub of ['commands', 'agents']) {
      expect(distMarkdown(sub).length, `dist/${sub}/ is empty — run \`npm run build:mds\``).toBeGreaterThan(0);
    }
  });

  it('dist/curation-off/ holds exactly the manifest roster, both directions (AC-136)', () => {
    expect(
      distMarkdown('curation-off'),
      'the curation-off files on disk differ from CURATION_VARIANT_HOSTS in tests/fixtures/mds-manifest.ts: ' +
      'a host gained or lost an arm, or dist/ is stale — run `npm run build:mds`',
    ).toEqual([...CURATION_OFF_FILES].sort());
  });

  it('every curation-off variant has its curation-on counterpart at the host path', () => {
    for (const rel of distMarkdown('curation-off')) {
      expect(
        distMarkdown(path.posix.dirname(rel)),
        `dist/curation-off/${rel} has no dist/${rel} beside the other prompts`,
      ).toContain(path.posix.basename(rel));
    }
  });

  it('no dist Markdown file carries a curation marker (AC-133)', () => {
    const files = walkFiles(DIST, f => f.endsWith('.md')).map(f => ({
      name: path.relative(ROOT, f).split(path.sep).join('/'),
      content: readFileSync(f, 'utf-8'),
    }));
    // Non-vacuity by sentinel, not by a count that someone must re-register: the scan
    // reaches every prompt tree and the files known to be in each.
    const names = new Set(files.map(f => f.name));
    for (const sentinel of [
      'dist/commands/implement.md',
      'dist/agents/code.md',
      'dist/skills/git/references/tracker/github/fetch-issue.md',
    ]) {
      expect(names.has(sentinel), `the scan never reached ${sentinel}`).toBe(true);
    }
    expect(collectSurvivingMarkers(files), 'a marker reached a shipped prompt').toEqual([]);
  });

  it('known-bad probe: the collector reports a surviving marker, valid or malformed, and not a clean file', () => {
    const seeded = [
      { name: 'dist/commands/a.md', content: `text\n${ON}\nmore\n` },
      { name: 'dist/agents/b.md', content: 'text <!--curation:end--> more\n' },
      { name: 'dist/agents/c.md', content: 'curation is on here; <!-- an ordinary comment -->\n' },
    ];
    expect(collectSurvivingMarkers(seeded)).toEqual(['dist/commands/a.md', 'dist/agents/b.md']);
  });

  it('CURATION_VARIANT_HOSTS names each host as <kind>/<name> with a known kind and no duplicate', () => {
    expect(new Set(CURATION_VARIANT_HOSTS).size).toBe(CURATION_VARIANT_HOSTS.length);
    for (const host of CURATION_VARIANT_HOSTS) {
      expect(host, `${host}: not <commands|agents>/<name>`).toMatch(/^(commands|agents)\/[a-z0-9][a-z0-9._-]*$/);
    }
  });
});

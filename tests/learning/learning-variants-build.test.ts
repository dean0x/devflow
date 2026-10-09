/**
 * The build's learning-variant wiring (D-LEARNING-VARIANTS; AC-127, AC-132,
 * AC-133, AC-135, AC-136).
 *
 * Two halves:
 *
 *   1. A FIXTURE host with arms, built under a throwaway DEVFLOW_MDS_ROOT, proves
 *      the wiring itself: the learning-on variant lands at today's path, the
 *      learning-off variant under dist/learning-off/ only for a host with an arm,
 *      no marker reaches either, the orphan prune is keyed on the files written,
 *      and a refusal (a bad arm, a marker in a reference module) fails the build.
 *      The real src/ and dist/ trees are only ever read.
 *
 *   2. The REAL built dist/ is held to the manifest roster and to the invariant
 *      "Markdown prompts carry no markers": the files under dist/learning-off/ are
 *      LEARNING_VARIANT_HOSTS in both directions, each has its learning-on
 *      counterpart, and no dist/**\/*.md carries a marker. The roster is empty
 *      until a host carries an arm, and every assertion here holds with it empty.
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
import { LEARNING_OFF_FILES, LEARNING_VARIANT_HOSTS } from '../fixtures/mds-manifest.js';
import { containsLearningMarker } from '../../src/core/learning-variants.js';

vi.setConfig({ testTimeout: 120_000 });

const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(ROOT, 'scripts', 'build-mds.ts');

const ON = '<!-- learning:on -->';
const OFF = '<!-- learning:off -->';
const END = '<!-- learning:end -->';

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
  const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-learning-variants-'));
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

/** Named collector: the count the build prints for the learning-off variants it wrote. */
function printedVariantCount(combined: string): number {
  const match = /^\s*(\d+) learning-off variant\(s\) written/m.exec(combined);
  if (!match) throw new Error(`build output has no "N learning-off variant(s) written" line:\n${combined}`);
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
  it('writes the learning-on variant at the host path and the learning-off variant under dist/learning-off/', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      const alphaOn = await readIfPresent(fakeRoot, 'dist/commands/alpha.md');
      const alphaOff = await readIfPresent(fakeRoot, 'dist/learning-off/commands/alpha.md');
      const betaOn = await readIfPresent(fakeRoot, 'dist/agents/beta.md');
      const betaOff = await readIfPresent(fakeRoot, 'dist/learning-off/agents/beta.md');
      expect(alphaOn, 'the learning-on command').not.toBeNull();
      expect(alphaOff, 'the learning-off command').not.toBeNull();
      expect(betaOn, 'the learning-on agent').not.toBeNull();
      expect(betaOff, 'the learning-off agent').not.toBeNull();

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

  it('the learning-off agent frontmatter is the learning-on frontmatter minus the arm line (AC-131 shape)', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      const frontmatter = (text: string): string[] => (/^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '').split('\n');
      const on = frontmatter((await readIfPresent(fakeRoot, 'dist/agents/beta.md'))!);
      const off = frontmatter((await readIfPresent(fakeRoot, 'dist/learning-off/agents/beta.md'))!);
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
      await equal('dist/learning-off/commands/alpha.md', 'dist/commands/alpha-off-ref.md');
      // The agent references differ from the hosts in their name line only, so the
      // comparison normalises it. Everything else must match byte for byte.
      const named = async (rel: string): Promise<string> =>
        ((await readIfPresent(fakeRoot, rel)) ?? '').replace(/^name: .*$/m, 'name: X').replace(/^# .*$/m, '# X');
      expect(await named('dist/agents/beta.md')).toBe(await named('dist/agents/beta-on-ref.md'));
      expect(await named('dist/learning-off/agents/beta.md')).toBe(await named('dist/agents/beta-off-ref.md'));
      // And the references are not themselves variants.
      expect(await readIfPresent(fakeRoot, 'dist/learning-off/commands/alpha-on-ref.md')).toBeNull();
    });
  });

  it('writes a learning-off variant only for a host that has an arm, and prints the count', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      expect(await readIfPresent(fakeRoot, 'dist/commands/plain.md')).not.toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/agents/gamma.md')).not.toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/learning-off/commands/plain.md')).toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/learning-off/agents/gamma.md')).toBeNull();
      expect(printedVariantCount(run.combined)).toBe(2);
      const off = walkFiles(path.join(fakeRoot, 'dist', 'learning-off'), f => f.endsWith('.md'))
        .map(f => path.relative(path.join(fakeRoot, 'dist', 'learning-off'), f).split(path.sep).join('/'))
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
      const survivors = built.filter(f => containsLearningMarker(readFileSync(f, 'utf-8')));
      expect(survivors, 'a marker survived into a built file').toEqual([]);
      // Control: the partial's source does carry them, so the scan above has something to miss.
      expect(containsLearningMarker(PARTIAL)).toBe(true);
    });
  });

  it('a host without a learning-off variant reports no variant for it, and an unchanged rebuild prunes nothing', async () => {
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

describe('the orphan prune over dist/learning-off/ is keyed on the files written (AC-132)', () => {
  it('removes the variant of a host that lost its last arm, and keeps the others', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      expect(runBuild(fakeRoot).status).toBe(0);
      expect(await readIfPresent(fakeRoot, 'dist/learning-off/commands/alpha.md')).not.toBeNull();

      // alpha drops every arm (its partial call is replaced by plain text too).
      await write(fakeRoot, 'src/assets/commands/alpha.mds', PLAIN_COMMAND.replace('plain', 'alpha'));
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      expect(await readIfPresent(fakeRoot, 'dist/learning-off/commands/alpha.md'), 'its old variant must go').toBeNull();
      expect(await readIfPresent(fakeRoot, 'dist/learning-off/agents/beta.md'), 'a host that kept its arm keeps its variant').not.toBeNull();
      expect(prunedPaths(run.combined)).toEqual(['dist/learning-off/commands/alpha.md']);
      expect(run.combined, 'the reason must be stated').toContain('(no learning arm)');
      expect(printedVariantCount(run.combined)).toBe(1);
    });
  });

  it('removes a file nothing wrote, in either subtree or in a subdirectory of its own', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      await write(fakeRoot, 'dist/learning-off/commands/stale.md', 'old\n');
      await write(fakeRoot, 'dist/learning-off/agents/stale.md', 'old\n');
      await write(fakeRoot, 'dist/learning-off/skills/stale.md', 'old\n');
      await write(fakeRoot, 'dist/learning-off/stale.md', 'old\n');
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      expect(prunedPaths(run.combined).sort()).toEqual([
        'dist/learning-off/agents/stale.md',
        'dist/learning-off/commands/stale.md',
        'dist/learning-off/skills/stale.md',
        'dist/learning-off/stale.md',
      ]);
      expect(await readIfPresent(fakeRoot, 'dist/learning-off/commands/alpha.md'), 'a written variant is never pruned').not.toBeNull();
    });
  });

  it('prunes a tree with no host arm at all, and leaves a non-.md entry alone', async () => {
    await withFakeRoot(async fakeRoot => {
      await write(fakeRoot, 'src/assets/commands/plain.mds', PLAIN_COMMAND);
      await write(fakeRoot, 'dist/learning-off/commands/old.md', 'old\n');
      // A concurrent build's staging file: deleting it would fail that build's rename.
      await write(fakeRoot, 'dist/learning-off/commands/old.md.99999.tmp', 'staged\n');
      const run = runBuild(fakeRoot);
      expect(run.status, run.combined).toBe(0);

      expect(prunedPaths(run.combined)).toEqual(['dist/learning-off/commands/old.md']);
      expect(await readIfPresent(fakeRoot, 'dist/learning-off/commands/old.md.99999.tmp')).not.toBeNull();
      expect(printedVariantCount(run.combined)).toBe(0);
    });
  });

  it('prunes nothing when the build refuses', async () => {
    await withFakeRoot(async fakeRoot => {
      await seedFixture(fakeRoot);
      await write(fakeRoot, 'src/assets/commands/bad.mds', `---\ndescription: bad\noutput-dir: dist/commands\n---\n\n${ON}\nx\n${END}\n${END}\n`);
      await write(fakeRoot, 'dist/learning-off/commands/stale.md', 'old\n');
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      expect(await readIfPresent(fakeRoot, 'dist/learning-off/commands/stale.md'), 'a refused build leaves dist/ as it found it').not.toBeNull();
      expect(prunedPaths(run.combined)).toEqual([]);
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
      expect(run.combined).toContain('src/assets/commands/bad.mds: learning-variant split refused');
      expect(run.combined).toContain('arms do not nest');
      expect(run.combined, 'the quoted neighbour above the second marker').toContain('(below "first")');
      expect(run.combined).toContain('Line numbers count the compiled output');
      // The other hosts still compiled: one refusal does not abandon the rest.
      expect(await readIfPresent(fakeRoot, 'dist/commands/plain.md')).not.toBeNull();
    });
  });

  it('refuses each kind of bad arm at build time: unopened end, unclosed arm, empty arm, stray marker', async () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ['unopened', `text\n${END}\n`, 'a learning:end marker with no open arm'],
      ['unclosed', `${ON}\ntext\n`, 'is never closed with learning:end'],
      ['empty', `${ON}\n\n${END}\n`, 'holds no line with content'],
      ['stray', `text ${ON}\n`, 'names a learning marker but is not one'],
    ];
    await withFakeRoot(async fakeRoot => {
      for (const [name, bodyText] of cases) {
        await write(fakeRoot, `src/assets/commands/${name}.mds`, `---\ndescription: ${name}\noutput-dir: dist/commands\n---\n\n# ${name}\n\n${bodyText}`);
      }
      const run = runBuild(fakeRoot);
      expect(run.status, `expected exit 1.\n${run.combined}`).toBe(1);
      for (const [name, , message] of cases) {
        expect(run.combined, `${name}: the host is named`).toContain(`src/assets/commands/${name}.mds: learning-variant split refused`);
        expect(run.combined, `${name}: the reason is stated`).toContain(message);
      }
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
      expect(run.combined).toContain('src/assets/mds/tracker/_mcp.mds: a reference module may not carry learning-variant markers');
      expect(await readIfPresent(fakeRoot, 'dist/skills/git/references/tracker/_mcp.md'), 'nothing is written for a refused module').toBeNull();
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

/** Named collector: the dist/ Markdown files carrying a learning marker. Driven by the live assertion and its probe. */
function collectSurvivingMarkers(files: ReadonlyArray<{ readonly name: string; readonly content: string }>): string[] {
  return files.filter(f => containsLearningMarker(f.content)).map(f => f.name);
}

describe('the built dist/ tree', () => {
  it('requires a build: the prompt trees are present', () => {
    for (const sub of ['commands', 'agents']) {
      expect(distMarkdown(sub).length, `dist/${sub}/ is empty — run \`npm run build:mds\``).toBeGreaterThan(0);
    }
  });

  it('dist/learning-off/ holds exactly the manifest roster, both directions (AC-136)', () => {
    expect(
      distMarkdown('learning-off'),
      'the learning-off files on disk differ from LEARNING_VARIANT_HOSTS in tests/fixtures/mds-manifest.ts: ' +
      'a host gained or lost an arm, or dist/ is stale — run `npm run build:mds`',
    ).toEqual([...LEARNING_OFF_FILES].sort());
  });

  it('every learning-off variant has its learning-on counterpart at the host path', () => {
    for (const rel of distMarkdown('learning-off')) {
      expect(
        distMarkdown(path.posix.dirname(rel)),
        `dist/learning-off/${rel} has no dist/${rel} beside the other prompts`,
      ).toContain(path.posix.basename(rel));
    }
  });

  it('no dist Markdown file carries a learning marker (AC-133)', () => {
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
      { name: 'dist/agents/b.md', content: 'text <!--learning:end--> more\n' },
      { name: 'dist/agents/c.md', content: 'learning is on here; <!-- an ordinary comment -->\n' },
    ];
    expect(collectSurvivingMarkers(seeded)).toEqual(['dist/commands/a.md', 'dist/agents/b.md']);
  });

  it('LEARNING_VARIANT_HOSTS names each host as <kind>/<name> with a known kind and no duplicate', () => {
    expect(new Set(LEARNING_VARIANT_HOSTS).size).toBe(LEARNING_VARIANT_HOSTS.length);
    for (const host of LEARNING_VARIANT_HOSTS) {
      expect(host, `${host}: not <commands|agents>/<name>`).toMatch(/^(commands|agents)\/[a-z0-9][a-z0-9._-]*$/);
    }
  });
});

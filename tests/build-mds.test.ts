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
 *  5. Script happy-path exit — build:mds exits 0 and produces all 13+2=15 outputs in dist/commands/.
 *  6. Forgotten-key guard (C2) — expected-command-set: all 9 knowledge + 4 dynamic outputs present.
 *  7. Dest safety negative (C3) — a host with a wrong output-dir → exit 1 + "typo?" message.
 *  8. npm scripts (C4) — package.json has build:mds, not the two old scripts, and build chains it.
 *  9. Ignored-dir walk (P3) — a .mds with output-dir: under node_modules/ is not compiled.
 * 10. dynamic-build.md doctrine greps.
 * 11. knowledge outputs contain no feature-knowledge.cjs references.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { init, compile, isMdsError } from '@mdscript/mds';

const ROOT = path.resolve(import.meta.dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'src', 'assets', 'commands');
const PARTIALS_DIR = path.join(COMMANDS_DIR, '_partials');
const DIST_COMMANDS = 'dist/commands';

/** Path to the local tsx binary (avoids npx install in temp dirs). */
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');

/** The 9 knowledge hosts: basename → expected output dir (all compile to dist/commands) */
const KNOWLEDGE_HOSTS: Record<string, string> = {
  'implement':    DIST_COMMANDS,
  'plan':         DIST_COMMANDS,
  'resolve':      DIST_COMMANDS,
  'code-review':  DIST_COMMANDS,
  'self-review':  DIST_COMMANDS,
  'research':     DIST_COMMANDS,
  'bug-analysis': DIST_COMMANDS,
  'explore':      DIST_COMMANDS,
  'debug':        DIST_COMMANDS,
};

/** The 4 dynamic hosts: basename → expected output dir (all compile to dist/commands) */
const DYNAMIC_HOSTS: Record<string, string> = {
  'dynamic-build':   DIST_COMMANDS,
  'dynamic-plan':    DIST_COMMANDS,
  'dynamic-profile': DIST_COMMANDS,
  'dynamic-tickets': DIST_COMMANDS,
};

const ALL_HOSTS = { ...KNOWLEDGE_HOSTS, ...DYNAMIC_HOSTS };

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
  it('commands/ contains exactly 13 host .mds files (9 knowledge + 4 dynamic)', async () => {
    const entries = await fs.readdir(COMMANDS_DIR, { withFileTypes: true });
    const hostFiles = entries.filter(
      e => e.isFile() && e.name.endsWith('.mds') && !e.name.startsWith('_'),
    );
    expect(hostFiles).toHaveLength(13);
  });

  it('each expected host .mds exists in commands/', async () => {
    for (const basename of Object.keys(ALL_HOSTS)) {
      const sourcePath = path.join(COMMANDS_DIR, `${basename}.mds`);
      await expect(
        fs.access(sourcePath),
        `Missing host: commands/${basename}.mds`,
      ).resolves.toBeUndefined();
    }
  });

  it('commands/_partials/ contains exactly 11 partials (no output-dir:)', async () => {
    const entries = await fs.readdir(PARTIALS_DIR, { withFileTypes: true });
    const partialFiles = entries.filter(e => e.isFile() && e.name.endsWith('.mds'));
    expect(partialFiles).toHaveLength(11);
  });

  it('each partial .mds does NOT declare output-dir:', async () => {
    const entries = await fs.readdir(PARTIALS_DIR, { withFileTypes: true });
    for (const e of entries.filter(f => f.isFile() && f.name.endsWith('.mds'))) {
      const content = await fs.readFile(path.join(PARTIALS_DIR, e.name), 'utf-8');
      expect(content, `_partials/${e.name} must not declare output-dir:`).not.toMatch(/^output-dir:/m);
    }
  });

  it('every host .mds declares a non-empty output-dir: as its last frontmatter key', async () => {
    for (const basename of Object.keys(ALL_HOSTS)) {
      const content = await fs.readFile(path.join(COMMANDS_DIR, `${basename}.mds`), 'utf-8');
      const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
      expect(fmMatch, `${basename}.mds must have a frontmatter block`).not.toBeNull();
      const fm = fmMatch![1];
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
  beforeAll(async () => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('no compiled output contains output-dir:', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue; // not present — the subprocess test above covers presence
      }
      scanned++;
      expect(
        content,
        `${destRelDir}/${basename}.md must not contain output-dir:`,
      ).not.toMatch(/^output-dir:/m);
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });

  it('every compiled output that has frontmatter still has description:', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
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
          `${destRelDir}/${basename}.md must preserve description:`,
        ).toMatch(/^description:/m);
      }
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });

  it('dynamic compiled outputs preserve argument-hint:', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(DYNAMIC_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
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
          `${destRelDir}/${basename}.md must preserve argument-hint:`,
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
    for (const [basename, destRelDir] of Object.entries(KNOWLEDGE_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        callSitePattern.test(content),
        `${destRelDir}/${basename}.md must not contain un-expanded MDS call sites`,
      ).toBe(false);
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });

  it('no compiled knowledge command references feature-knowledge.cjs', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(KNOWLEDGE_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        content,
        `${destRelDir}/${basename}.md must not reference feature-knowledge.cjs`,
      ).not.toContain('feature-knowledge.cjs');
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });

  it('no compiled output contains a literal @import line', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        content,
        `${destRelDir}/${basename}.md must not contain unexpanded @import lines`,
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
  beforeAll(async () => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('no compiled dist/commands/*.md contains the two-character sequence \\{ (backslash-brace)', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        content,
        `${destRelDir}/${basename}.md must not contain literal \\{ (MDS escape leak inside plain fence)`,
      ).not.toContain('\\{');
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3b. decisions_load host adoption — all knowledge hosts compile the index.md read
// ---------------------------------------------------------------------------

describe('decisions_load adoption in compiled knowledge command outputs', () => {
  beforeAll(async () => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('all 9 knowledge command outputs contain the .devflow/learning/index.md read (decisions_load expansion)', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(KNOWLEDGE_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
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
        `${destRelDir}/${basename}.md must contain .devflow/learning/index.md (decisions_load expansion)`,
      ).toContain('.devflow/learning/index.md');
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });

  it('no compiled knowledge command contains a bare decisions-index.cjs reference (ADR-007: retired)', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(KNOWLEDGE_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        content,
        `${destRelDir}/${basename}.md must not reference decisions-index.cjs`,
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
  it('exits 0 when real sources compile cleanly (CI path)', () => {
    const result = spawnSync(
      TSX_BIN,
      [path.join(ROOT, 'scripts', 'build-mds.ts')],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 60_000,
      },
    );
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('produces at least one .md command file after the script runs', async () => {
    let foundAtLeastOne = false;
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      try {
        await fs.access(path.join(ROOT, destRelDir, `${basename}.md`));
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
  beforeAll(async () => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('all 9 knowledge command outputs exist post-build', async () => {
    for (const [basename, destRelDir] of Object.entries(KNOWLEDGE_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      await expect(
        fs.access(outputPath),
        `Expected compiled output missing: ${destRelDir}/${basename}.md`,
      ).resolves.toBeUndefined();
    }
  });

  it('all 4 dynamic command outputs exist post-build', async () => {
    for (const [basename, destRelDir] of Object.entries(DYNAMIC_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      await expect(
        fs.access(outputPath),
        `Expected compiled output missing: ${destRelDir}/${basename}.md`,
      ).resolves.toBeUndefined();
    }
  });

  it('dist/commands/ contains exactly 14 .md files (13 compiled + 1 hand-authored)', async () => {
    // The 1 hand-authored file is release.md, copied verbatim by build-mds.ts.
    const files = await fs.readdir(path.join(ROOT, 'dist', 'commands'));
    const mdFiles = files.filter(f => f.endsWith('.md'));
    expect(
      mdFiles.length,
      `Expected 14 .md files in dist/commands/ (13 compiled + 1 hand-authored), got ${mdFiles.length}: ${mdFiles.sort().join(', ')}`,
    ).toBe(14);
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
    // Use a temp dir as root; plant a fake node_modules/.mds to confirm skip.
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-walk-'));
    try {
      const fakeNm = path.join(tmpRoot, 'node_modules', 'some-pkg');
      await fs.mkdir(fakeNm, { recursive: true });
      await fs.writeFile(
        path.join(fakeNm, 'stray.mds'),
        '---\ndescription: stray\noutput-dir: out/nope/commands\n---\n\n# Stray\n',
        'utf-8',
      );

      // Also create a valid host that would succeed to test the walk doesn't crash.
      // (No valid plugin exists in tmpRoot, so if the stray is discovered, exit code = 1.
      //  If only the stray exists and is skipped, hosts.length == 0 → also exit 1 with
      //  "expected 13 hosts". Either way the compiled output must not exist.)
      const scriptPath = path.join(ROOT, 'scripts', 'build-mds.ts');
      const result = spawnSync(TSX_BIN, [scriptPath], {
        cwd: tmpRoot,
        encoding: 'utf-8',
        timeout: 60_000,
      });
      if (result.error) throw result.error;

      // The stray must not have been compiled (no output created in tmpRoot).
      // The script will exit non-zero (no hosts found), but the stray file is what we check.
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
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
    compiled = await fs.readFile(
      path.join(ROOT, 'dist', 'commands', 'dynamic-build.md'),
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

  it('does NOT run Gate 1 (Validate/Simplify/Scrutinize) inside the review pass', () => {
    expect(compiled).not.toContain('Gate 1 only — no Gate 2 for review-fixes');
    expect(compiled).not.toContain('Simplify recent fixes');
    expect(compiled).not.toContain('9-pillar review of recent fixes');
  });

  it('spawns Simplify and Scrutinize exactly twice each (Gate 1 #1 + Gate 1 #2)', () => {
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
  beforeAll(async () => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('no compiled command contains a literal {knowledge_*()} call site', async () => {
    const callSitePattern = /\{knowledge_(?:load|writeback)\(\)\}/;
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        callSitePattern.test(content),
        `${destRelDir}/${basename}.md must not contain un-expanded MDS call sites`,
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
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
    compiled = await fs.readFile(
      path.join(ROOT, 'dist', 'commands', 'dynamic-build.md'),
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

  it('C9: no unauthorized GitHub side-effects doctrine', () => {
    expect(compiled).toContain('No unauthorized GitHub side-effects');
  });
});

// ---------------------------------------------------------------------------
// 13. --dry-run removal (C7)
// dynamic-build, plan, tickets, wave must NOT contain --dry-run.
// dynamic-profile must still contain it (untouched per plan).
// ---------------------------------------------------------------------------

describe('compiled dynamic commands: --dry-run removal (C7)', () => {
  const DRY_RUN_ABSENT = ['dynamic-build', 'dynamic-plan', 'dynamic-tickets'] as const;
  const DYNAMIC_DIR = path.join(ROOT, 'dist', 'commands');

  beforeAll(() => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('dynamic-build, plan, tickets do NOT contain --dry-run', async () => {
    for (const basename of DRY_RUN_ABSENT) {
      const content = await fs.readFile(path.join(DYNAMIC_DIR, `${basename}.md`), 'utf-8');
      expect(
        content,
        `${basename}.md must not contain --dry-run after C7 removal`,
      ).not.toContain('--dry-run');
    }
  });

  it('compiled dynamic-profile.md still contains --dry-run (untouched by plan)', async () => {
    const content = await fs.readFile(path.join(DYNAMIC_DIR, 'dynamic-profile.md'), 'utf-8');
    expect(content).toContain('--dry-run');
  });
});

// ---------------------------------------------------------------------------
// 14. compliance wiring in compiled host commands (installed-skill gate)
//
// Current compliance guard state:
//   - code-review.md, plan.md, and bug-analysis.md contain COMPLIANCE_SKILL_INSTALLED
//     and the skill path (the gate's canonical variable and file-existence target)
//   - implement.md has exactly one COMPLIANCE: line — in the Git setup-task spawn
//     (Git agent, not a Code agent); no COMPLIANCE_ENABLED
//   - code-review.md and bug-analysis.md have a COMPLIANCE: conditional line in
//     their Git pre-flight (ensure-pr-ready) spawns — not in any Code-agent spawn
//   - no compiled dist/commands/*.md contains COMPLIANCE_ENABLED or devflow-compliance
//   - no compiled dist/commands/*.md contains the literal COMPLIANCE: ${
//     (interpolated JS form — would indicate a MDS escaping bug)
//   - no compiled dist/commands/*.md contains comment-pr (retired op)
// ---------------------------------------------------------------------------

describe('compliance wiring in compiled host commands (Part 1 — installed-skill gate)', () => {
  const SKILL_CHECK_HOSTS: Record<string, string> = {
    'code-review': DIST_COMMANDS,
    'plan':        DIST_COMMANDS,
  };

  beforeAll(() => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('code-review.md and plan.md contain COMPLIANCE_SKILL_INSTALLED and the skill path', async () => {
    for (const [basename, destRelDir] of Object.entries(SKILL_CHECK_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
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

  it('implement.md contains ISSUE_NUMBER and COMPLIANCE setup-task wiring; no COMPLIANCE_ENABLED (Phase E, AC-32)', async () => {
    const outputPath = path.join(ROOT, DIST_COMMANDS, 'implement.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    // Positive: issue-first threading — ISSUE_NUMBER must appear in Code-agent spawns
    expect(
      content,
      'implement.md must contain ISSUE_NUMBER (issue-first threading, Phase E)',
    ).toContain('ISSUE_NUMBER');
    // Positive: setup-task Git-input COMPLIANCE line (AC-32 sanctioned — Git spawn only)
    expect(
      content,
      'implement.md must contain COMPLIANCE setup-task wiring (Git-input, AC-32 sanctioned)',
    ).toContain('COMPLIANCE: {enabled');
    // Negative: COMPLIANCE_ENABLED variable must not appear anywhere
    expect(
      content,
      'implement.md must not contain COMPLIANCE_ENABLED — compliance machinery removed in Part 1',
    ).not.toContain('COMPLIANCE_ENABLED');
    // Narrow AC-32: the sanctioned COMPLIANCE: line appears ONLY in the Git setup-task spawn —
    // never in any Code-agent (subagent_type="Code") spawn block
    const complianceLines = content.split('\n').filter(l => /^COMPLIANCE:/.test(l));
    expect(
      complianceLines.length,
      'implement.md must have exactly one COMPLIANCE: line (Git setup-task spawn only, AC-32)',
    ).toBe(1);
  });

  it('no compiled dist/commands/*.md contains COMPLIANCE_ENABLED, devflow-compliance, COMPLIANCE: ${ (interpolated JS), or comment-pr (AC-32)', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      scanned++;
      expect(
        content,
        `${basename}.md must not contain COMPLIANCE_ENABLED`,
      ).not.toContain('COMPLIANCE_ENABLED');
      expect(
        content,
        `${basename}.md must not contain devflow-compliance`,
      ).not.toContain('devflow-compliance');
      // COMPLIANCE: {enabled is sanctioned only in implement.md (Git setup-task spawn, AC-32).
      // All other files must not contain it.
      if (basename !== 'implement') {
        expect(
          content,
          `${basename}.md must not contain COMPLIANCE: {enabled (only implement.md's Git spawn is sanctioned)`,
        ).not.toContain('COMPLIANCE: {enabled');
      }
      // comment-pr was retired; post-review-summary replaces it.
      expect(
        content,
        `${basename}.md must not contain comment-pr (retired operation)`,
      ).not.toContain('comment-pr');
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
  });

  it('every COMPLIANCE: line in every dist command is inside a Git-agent spawn block (spawn-scoped guard)', async () => {
    // Asserts that no COMPLIANCE: key appears in a prose or JS fence block whose agent is
    // not Git. Doctrinal rule: COMPLIANCE is a Git-agent input only (AC-32).
    // For each code fence (``` ... ```) that contains a ^COMPLIANCE: line,
    // verify the fence also references "Git" as the agent type.
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
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
        if (!/^COMPLIANCE:/m.test(block)) continue;
        const hasGit =
          /Agent\(subagent_type="Git"/.test(block) ||
          /agentType:\s*"Git"/.test(block);
        if (!hasGit) {
          violations.push(`fence at offset ${match.index}`);
        }
      }

      expect(
        violations,
        `${basename}.md: COMPLIANCE: line found in non-Git spawn block(s): ${violations.join(', ')}`,
      ).toHaveLength(0);
    }
    expect(scanned, 'scanned zero dist commands — guard is vacuous').toBeGreaterThan(0);
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
  beforeAll(() => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('code-review.md contains post-review-summary and passes REVIEW_TIMESTAMP input', async () => {
    const outputPath = path.join(ROOT, DIST_COMMANDS, 'code-review.md');
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
    const outputPath = path.join(ROOT, DIST_COMMANDS, 'code-review.md');
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
//      check-merge-readiness, Third-Party Threads section, COMPLIANCE wiring
// ---------------------------------------------------------------------------

describe('Phase D traceability ops — resolve.md (Part 2, Step 2.4)', () => {
  beforeAll(() => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('resolve.md contains Phase D traceability ops', async () => {
    const outputPath = path.join(ROOT, DIST_COMMANDS, 'resolve.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content, 'resolve.md must contain fetch-review-threads op').toContain('fetch-review-threads');
    expect(content, 'resolve.md must contain resolve-review-threads op').toContain('resolve-review-threads');
    expect(content, 'resolve.md must contain post-resolution-summary op').toContain('post-resolution-summary');
    expect(content, 'resolve.md must contain check-merge-readiness op').toContain('check-merge-readiness');
    expect(content, 'resolve.md must contain Third-Party Threads section').toContain('Third-Party Threads');
  });

  it('resolve.md contains COMPLIANCE_SKILL_INSTALLED check (Step 0d compliance wiring)', async () => {
    const outputPath = path.join(ROOT, DIST_COMMANDS, 'resolve.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(
      content,
      'resolve.md must contain COMPLIANCE_SKILL_INSTALLED from Step 0d wiring',
    ).toContain('COMPLIANCE_SKILL_INSTALLED');
    expect(
      content,
      'resolve.md must contain the compliance skill path',
    ).toContain('skills/devflow:compliance/SKILL.md');
  });
});

// ---------------------------------------------------------------------------
// §17  Phase E traceability — implement.mds (2.5) + plan.mds (2.6) guards
//      implement.md: ISSUE_NUMBER in Code-agent spawns, COMPLIANCE in Git spawn
//      plan.md: ensure-traceable-issue replaces inline gh issue create
// ---------------------------------------------------------------------------

describe('Phase E traceability — implement.md and plan.md (Steps 2.5, 2.6)', () => {
  beforeAll(() => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('plan.md contains ensure-traceable-issue (Phase 14 Git-agent spawn, Step 2.6)', async () => {
    const outputPath = path.join(ROOT, DIST_COMMANDS, 'plan.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(
      content,
      'plan.md must reference ensure-traceable-issue Git op (replaces inline gh issue create)',
    ).toContain('ensure-traceable-issue');
  });

  it('implement.md contains COMPLIANCE_SKILL_INSTALLED check (Step 2.5)', async () => {
    const outputPath = path.join(ROOT, DIST_COMMANDS, 'implement.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(
      content,
      'implement.md must contain COMPLIANCE_SKILL_INSTALLED (setup-task compliance resolution)',
    ).toContain('COMPLIANCE_SKILL_INSTALLED');
  });
});

// ---------------------------------------------------------------------------
// §18  Phase F release evidence (Step 2.9) + dynamic pipeline COMPLIANCE +
//      ISSUE_NUMBER (Step 2.11)
//      release.md: COMMIT_LIST, SHIPPED_ISSUES, backlink-shipped-issues
//      dynamic-build.md: COMPLIANCE_SKILL_INSTALLED, ISSUE_NUMBER, conventions.md
// ---------------------------------------------------------------------------

describe('Phase F traceability — release.md evidence + dynamic-build compliance (Steps 2.9, 2.11)', () => {
  beforeAll(() => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('release.md contains COMMIT_LIST, SHIPPED_ISSUES, and backlink-shipped-issues (Step 2.9 release evidence)', async () => {
    const outputPath = path.join(ROOT, DIST_COMMANDS, 'release.md');
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
  });

  it('dynamic-build.md contains COMPLIANCE_SKILL_INSTALLED, ISSUE_NUMBER, and conventions.md (Step 2.11)', async () => {
    const outputPath = path.join(ROOT, DIST_COMMANDS, 'dynamic-build.md');
    const content = await fs.readFile(outputPath, 'utf-8');
    expect(
      content,
      'dynamic-build.md must contain COMPLIANCE_SKILL_INSTALLED (pre-authoring compliance step, Step 2.11)',
    ).toContain('COMPLIANCE_SKILL_INSTALLED');
    expect(
      content,
      'dynamic-build.md must contain ISSUE_NUMBER (Code-agent issue threading, Step 2.11)',
    ).toContain('ISSUE_NUMBER');
    expect(
      content,
      'dynamic-build.md must contain conventions.md (branch naming authority, Step 2.11)',
    ).toContain('conventions.md');
  });
});

// ---------------------------------------------------------------------------
// §19  Phase C publication gate wiring — _publication.mds partial (11th partial)
//      code-review.md and resolve.md must expand publication_gate()
//      and pass REVIEW_PUBLICATION only in their Git post-*-summary spawns (PF-024)
// ---------------------------------------------------------------------------

describe('publication_gate adoption in compiled host commands (Phase C)', () => {
  const PUBLICATION_HOSTS: Record<string, string> = {
    'code-review': DIST_COMMANDS,
    'resolve':     DIST_COMMANDS,
  };

  beforeAll(() => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(
      result.status,
      `build-mds.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('code-review.md and resolve.md contain REVIEW_PUBLICATION resolution step', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(PUBLICATION_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      const content = await fs.readFile(outputPath, 'utf-8');
      scanned++;
      expect(
        content,
        `${destRelDir}/${basename}.md must contain REVIEW_PUBLICATION (publication gate expansion)`,
      ).toContain('REVIEW_PUBLICATION');
    }
    expect(scanned, 'scanned zero publication hosts — guard is vacuous (PF-018)').toBeGreaterThan(0);
  });

  it('every REVIEW_PUBLICATION: line in every compiled command is inside a Git-agent spawn block (spawn-scoped guard, PF-024)', async () => {
    let scanned = 0;
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
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

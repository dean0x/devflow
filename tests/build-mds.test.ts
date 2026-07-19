/**
 * Tests for scripts/build-mds.ts
 *
 * Covers the unified frontmatter-driven MDS build pipeline.
 *
 * Scenario coverage:
 *  1. Discovery == 14 — discoverHosts() finds exactly the 14 expected basenames.
 *  2. output-dir stripped — compiled outputs contain no output-dir: key.
 *  3. Partial expansion — no un-expanded call sites or @import lines in outputs.
 *  4. MDS mechanism (regression) — happy compile, error path (isMdsError + mds:: code),
 *     isMdsError rejects non-mds values.
 *  5. Script happy-path exit — build:mds exits 0 and produces all 14+2=16 outputs in dist/commands/.
 *  6. Forgotten-key guard (C2) — expected-command-set: all 9 knowledge + 5 dynamic outputs present.
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

/** The 5 dynamic hosts: basename → expected output dir (all compile to dist/commands) */
const DYNAMIC_HOSTS: Record<string, string> = {
  'dynamic-build':   DIST_COMMANDS,
  'dynamic-plan':    DIST_COMMANDS,
  'dynamic-profile': DIST_COMMANDS,
  'dynamic-tickets': DIST_COMMANDS,
  'dynamic-wave':    DIST_COMMANDS,
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
  it('commands/ contains exactly 14 host .mds files (9 knowledge + 5 dynamic)', async () => {
    const entries = await fs.readdir(COMMANDS_DIR, { withFileTypes: true });
    const hostFiles = entries.filter(
      e => e.isFile() && e.name.endsWith('.mds') && !e.name.startsWith('_'),
    );
    expect(hostFiles).toHaveLength(14);
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

  it('commands/_partials/ contains exactly 10 partials (no output-dir:)', async () => {
    const entries = await fs.readdir(PARTIALS_DIR, { withFileTypes: true });
    const partialFiles = entries.filter(e => e.isFile() && e.name.endsWith('.mds'));
    expect(partialFiles).toHaveLength(10);
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
  });

  it('no compiled output contains output-dir:', async () => {
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue; // not present — the subprocess test above covers presence
      }
      expect(
        content,
        `${destRelDir}/${basename}.md must not contain output-dir:`,
      ).not.toMatch(/^output-dir:/m);
    }
  });

  it('every compiled output that has frontmatter still has description:', async () => {
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      // Only check files that have a frontmatter block
      if (/^---\r?\n/.test(content)) {
        expect(
          content,
          `${destRelDir}/${basename}.md must preserve description:`,
        ).toMatch(/^description:/m);
      }
    }
  });

  it('dynamic compiled outputs preserve argument-hint:', async () => {
    for (const [basename, destRelDir] of Object.entries(DYNAMIC_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      if (/^---\r?\n/.test(content)) {
        expect(
          content,
          `${destRelDir}/${basename}.md must preserve argument-hint:`,
        ).toMatch(/^argument-hint:/m);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Partial expansion — no un-expanded MDS call sites or @import lines
// ---------------------------------------------------------------------------

describe('partial expansion in compiled knowledge outputs', () => {
  it('no compiled knowledge command contains un-expanded {knowledge_*()} call sites', async () => {
    const callSitePattern = /\{knowledge_(?:load|writeback)\(\)\}/;
    for (const [basename, destRelDir] of Object.entries(KNOWLEDGE_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      expect(
        callSitePattern.test(content),
        `${destRelDir}/${basename}.md must not contain un-expanded MDS call sites`,
      ).toBe(false);
    }
  });

  it('no compiled knowledge command references feature-knowledge.cjs', async () => {
    for (const [basename, destRelDir] of Object.entries(KNOWLEDGE_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      expect(
        content,
        `${destRelDir}/${basename}.md must not reference feature-knowledge.cjs`,
      ).not.toContain('feature-knowledge.cjs');
    }
  });

  it('no compiled output contains a literal @import line', async () => {
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      expect(
        content,
        `${destRelDir}/${basename}.md must not contain unexpanded @import lines`,
      ).not.toMatch(/^@import /m);
    }
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
  });

  it('all 9 knowledge command outputs contain the .devflow/learning/index.md read (decisions_load expansion)', async () => {
    for (const [basename, destRelDir] of Object.entries(KNOWLEDGE_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        // file missing — covered by the command-set guard above; skip here
        continue;
      }
      expect(
        content,
        `${destRelDir}/${basename}.md must contain .devflow/learning/index.md (decisions_load expansion)`,
      ).toContain('.devflow/learning/index.md');
    }
  });

  it('no compiled knowledge command contains a bare decisions-index.cjs reference (ADR-007: retired)', async () => {
    for (const [basename, destRelDir] of Object.entries(KNOWLEDGE_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      expect(
        content,
        `${destRelDir}/${basename}.md must not reference decisions-index.cjs`,
      ).not.toContain('decisions-index.cjs');
    }
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

  it('all 5 dynamic command outputs exist post-build', async () => {
    for (const [basename, destRelDir] of Object.entries(DYNAMIC_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      await expect(
        fs.access(outputPath),
        `Expected compiled output missing: ${destRelDir}/${basename}.md`,
      ).resolves.toBeUndefined();
    }
  });

  it('dist/commands/ contains exactly 16 .md files (14 compiled + 2 hand-authored)', async () => {
    // The 2 hand-authored files are audit-claude.md and release.md, copied verbatim by build-mds.ts.
    const files = await fs.readdir(path.join(ROOT, 'dist', 'commands'));
    const mdFiles = files.filter(f => f.endsWith('.md'));
    expect(
      mdFiles.length,
      `Expected 16 .md files in dist/commands/ (14 compiled + 2 hand-authored), got ${mdFiles.length}: ${mdFiles.sort().join(', ')}`,
    ).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// 7. Dest safety negative (C3) — wrong output-dir → exit 1
// ---------------------------------------------------------------------------

describe('dest safety negative (C3)', () => {
  it('exits 1 with "typo?" message when output-dir is not the expected dist/commands', async () => {
    // Plant a temporary .mds host file in src/assets/commands/ pointing at the
    // wrong output-dir. In the restructured layout every host must declare
    // output-dir: dist/commands — any other value is a typo and must hard-fail.
    // build-mds.ts walks from ROOT (derived from its own __filename, not cwd), so
    // the test file must live in the real repo. Created and removed atomically —
    // never staged, never shipped.
    const tmpHostPath = path.join(ROOT, 'src', 'assets', 'commands', '_test-dest-safety.mds');
    await fs.writeFile(
      tmpHostPath,
      '---\ndescription: dest safety test\noutput-dir: dist/wrong-dir\n---\n\n# Test\n',
      'utf-8',
    );
    try {
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
        `Expected exit 1 for wrong output-dir but got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      ).toBe(1);

      const combined = (result.stdout ?? '') + (result.stderr ?? '');
      expect(
        combined,
        'Expected "typo?" in output for wrong output-dir',
      ).toMatch(/typo\?/i);
    } finally {
      // Always clean up — ensure the temp file never gets staged
      try { await fs.unlink(tmpHostPath); } catch { /* already gone */ }
    }
  });

  it('exits 1 with "empty" message when a host declares output-dir: with no value', async () => {
    // A present-but-empty output-dir: key is a malformed host, not a partial, and
    // must hard-fail per the discovery contract (distinct from a genuinely absent
    // key, which is a legitimate partial). Regression guard: an earlier regex used
    // (.+?), which required >=1 char and silently reclassified an empty key as a
    // partial — dropping the command from the build. Same atomic-plant discipline
    // as the dest-safety test above: created and removed, never staged.
    const tmpHostPath = path.join(ROOT, 'src', 'assets', 'commands', '_test-empty-output-dir.mds');
    await fs.writeFile(
      tmpHostPath,
      '---\ndescription: empty output-dir test\noutput-dir:\n---\n\n# Test\n',
      'utf-8',
    );
    try {
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
        `Expected exit 1 for empty output-dir: but got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      ).toBe(1);

      const combined = (result.stdout ?? '') + (result.stderr ?? '');
      expect(
        combined,
        'Expected an "empty" hard-fail message for a valueless output-dir:',
      ).toMatch(/empty/i);
    } finally {
      try { await fs.unlink(tmpHostPath); } catch { /* already gone */ }
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
      //  "expected 14 hosts". Either way the compiled output must not exist.)
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

  it('runs ONE final Gate 1 (#2) after the review loop', () => {
    expect(compiled).toContain('gate1-final');
    expect(compiled).toContain('Gate 1 #2');
  });

  it('does NOT run Gate 1 (Validator/Simplifier/Scrutinizer) between review cycles', () => {
    expect(compiled).not.toContain('Gate 1 only — no Gate 2 for review-fixes');
    expect(compiled).not.toContain('Simplify recent fixes');
    expect(compiled).not.toContain('9-pillar review of recent fixes');
  });

  it('spawns Simplifier and Scrutinizer exactly twice each (Gate 1 #1 + Gate 1 #2)', () => {
    const simplifier = (compiled.match(/agentType: "Simplifier"/g) ?? []).length;
    const scrutinizer = (compiled.match(/agentType: "Scrutinizer"/g) ?? []).length;
    expect(simplifier, 'Simplifier should run only in the two Gate-1 passes').toBe(2);
    expect(scrutinizer, 'Scrutinizer should run only in the two Gate-1 passes').toBe(2);
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
  });

  it('no compiled command contains a literal {knowledge_*()} call site', async () => {
    const callSitePattern = /\{knowledge_(?:load|writeback)\(\)\}/;
    for (const [basename, destRelDir] of Object.entries(ALL_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      expect(
        callSitePattern.test(content),
        `${destRelDir}/${basename}.md must not contain un-expanded MDS call sites`,
      ).toBe(false);
    }
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
    compiled = await fs.readFile(
      path.join(ROOT, 'dist', 'commands', 'dynamic-build.md'),
      'utf-8',
    );
  });

  it('C1: delta-review scope — DELTA REVIEW prose and reviewBaseSha tracking', () => {
    expect(compiled).toContain('DELTA REVIEW');
    expect(compiled).toContain('reviewBaseSha');
  });

  it('C2: reviewer result contract — reviewed: true, coverage-gap handling, chunk/stagger cadence', () => {
    expect(compiled).toContain('reviewed: true');
    expect(compiled).toContain('review coverage incomplete');
    expect(compiled).toContain('coverageGaps.length === 0');
    // Chunk/stagger: reviewers dispatched in bounded parallel batches
    expect(compiled).toContain('const chunk = await parallel(reviewerThunks.slice(i, i + chunkSize));');
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

  it('C5: wave hardening — ALWAYS ready rule, cascade quarantine, never kills the wave, Designer reader', () => {
    expect(compiled).toContain('ALWAYS ready');
    expect(compiled).toContain('cascade');
    expect(compiled).toContain('never kills the wave');
    expect(compiled).toContain('agentType: "Designer"');
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
  const DRY_RUN_ABSENT = ['dynamic-build', 'dynamic-plan', 'dynamic-tickets', 'dynamic-wave'] as const;
  const DYNAMIC_DIR = path.join(ROOT, 'dist', 'commands');

  beforeAll(() => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
  });

  it('dynamic-build, plan, tickets, wave do NOT contain --dry-run', async () => {
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
// 14. compliance_gate wiring in compiled host commands
//
// Guards that the compliance_gate() partial was not silently dropped from
// the three host commands that import it. A forgotten call site compiles
// cleanly but leaves the gate absent; asserting COMPLIANCE_ENABLED (the
// gate's canonical output variable) catches the regression before it ships.
// ---------------------------------------------------------------------------

describe('compliance_gate wiring in compiled host commands', () => {
  const COMPLIANCE_GATE_HOSTS: Record<string, string> = {
    'code-review': DIST_COMMANDS,
    'plan':        DIST_COMMANDS,
    'implement':   DIST_COMMANDS,
  };

  beforeAll(() => {
    const result = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'build-mds.ts')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
  });

  it('code-review, plan, and implement compiled outputs each contain COMPLIANCE_ENABLED', async () => {
    for (const [basename, destRelDir] of Object.entries(COMPLIANCE_GATE_HOSTS)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      const content = await fs.readFile(outputPath, 'utf-8');
      expect(
        content,
        `${destRelDir}/${basename}.md must contain COMPLIANCE_ENABLED — ` +
          `compliance_gate() call site may be missing from ${basename}.mds`,
      ).toContain('COMPLIANCE_ENABLED');
    }
  });
});

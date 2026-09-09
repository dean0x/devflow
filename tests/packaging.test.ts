/**
 * Packaging guards.
 *
 * Guard 3 (dependency pin): critical dependencies are pinned to exact versions.
 *   Prevents accidental range upgrades from shipping routing runtime at wrong version.
 *
 * Guard 3b (MDS pin): the MDS compiler is an exact-pinned devDependency, absent from
 *   dependencies, and matches the lockfile. A range would let an npm install change
 *   the compiler that produces dist/agents/git.md.
 *
 * Guard 4 (commands source): every dist/commands/*.md is the output of a known
 *   source file in src/assets/commands/ — either a compiled .mds or a hand-authored .md.
 *   This prevents stale or orphaned compiled files from shipping when a command source
 *   is renamed or deleted.
 *
 * Guard 5 (files[] coverage): the package.json `files` array includes every directory
 *   required for a working install (dist/, src/assets/, src/targets/claude-code/templates/).
 *   A missing entry causes `npm pack` to silently omit critical runtime files.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  DIST_COMMAND_FILES,
  MDS_COMMAND_HOSTS,
  MDS_GENERATOR_HOSTS,
  MDS_PARTIALS,
} from './fixtures/mds-manifest.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Expected exact-pinned version of the routing runtime.
 * Hoisted so the next bump is a one-line change.
 */
const SUBSWITCH_VERSION = '0.4.0';

/**
 * Expected exact-pinned version of the MDS compiler.
 * Hoisted so the next bump is a one-line change.
 */
const MDS_VERSION = '0.2.0';

// ---------------------------------------------------------------------------
// Guard 3: dependency pin integrity
// ---------------------------------------------------------------------------

/**
 * The routing runtime dependency must be pinned to an exact version (no ^/~ range).
 * Prevents accidental upgrades from shipping an incompatible routing runtime.
 *
 * The internal package name ("subswitch") is intentionally used here — this is
 * an internal test file, not user-visible output. User-facing vocabulary uses
 * "external model routing" / "Devflow proxy".
 */
describe('Guard 3 (dependency pin): routing runtime pinned to exact version', () => {
  let dependencies: Record<string, string>;

  async function loadDependencies(): Promise<Record<string, string>> {
    if (dependencies) return dependencies;
    const pkgJson = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    dependencies = pkgJson.dependencies ?? {};
    return dependencies;
  }

  it('subswitch is declared as an exact-pinned dependency (no ^ or ~ range prefix)', async () => {
    const deps = await loadDependencies();
    expect(
      deps['subswitch'],
      'package.json must declare subswitch in dependencies with an exact version (no ^ or ~)',
    ).toBeDefined();

    const version = deps['subswitch']!;
    expect(
      version,
      `subswitch version "${version}" must be an exact pin (no ^ or ~). ` +
      `This prevents accidental upgrades to an incompatible routing runtime version.`,
    ).toBe(SUBSWITCH_VERSION);

    expect(
      version.startsWith('^') || version.startsWith('~'),
      `subswitch version "${version}" must not use ^ or ~ range prefix — exact pin required.`,
    ).toBe(false);
  });

  it(`package-lock.json resolves subswitch to version ${SUBSWITCH_VERSION} with a sha512 integrity field (DEP-3)`, async () => {
    const lockJson = JSON.parse(
      await fs.readFile(path.join(ROOT, 'package-lock.json'), 'utf-8'),
    ) as {
      packages?: Record<string, { version?: string; integrity?: string }>;
    };

    const subswitchNode = lockJson.packages?.['node_modules/subswitch'];
    expect(
      subswitchNode,
      'package-lock.json must contain a node_modules/subswitch entry. ' +
      'Run npm install to regenerate the lockfile.',
    ).toBeDefined();

    expect(
      subswitchNode!.version,
      `package-lock.json subswitch resolved version must be "${SUBSWITCH_VERSION}", ` +
      `got "${subswitchNode!.version}". ` +
      `The lockfile is out of sync with the exact pin in package.json.`,
    ).toBe(SUBSWITCH_VERSION);

    expect(
      subswitchNode!.integrity,
      'package-lock.json subswitch node must have an integrity field. ' +
      'A missing integrity field bypasses tamper detection on npm install.',
    ).toBeDefined();

    expect(
      subswitchNode!.integrity,
      `integrity field must be a sha512 hash (starts with "sha512-"), ` +
      `got "${subswitchNode!.integrity}".`,
    ).toMatch(/^sha512-/);
  });
});

// ---------------------------------------------------------------------------
// Guard 3b: MDS compiler pin integrity (devDependencies)
// ---------------------------------------------------------------------------

/**
 * The MDS compiler is the only thing standing between src/assets/agents/*.mds and
 * the byte-identical artifacts in dist/. A range prefix would let a patch release
 * change interpolation, escaping, or blank-line handling on an `npm install` — and
 * the golden fixture would go red with nothing in the diff to explain it.
 *
 * Guard 3 above reads `dependencies` only, so it can say nothing about a build-time
 * dependency. These assertions are devDependency-scoped, and one of them asserts the
 * package is ABSENT from `dependencies` (moving it there would ship a compiler to
 * every install and quietly take Guard 3's pin out of the picture).
 */
describe('Guard 3b (MDS pin): compiler pinned to an exact version in devDependencies', () => {
  interface PackageManifest {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }

  let manifest: PackageManifest | undefined;

  async function loadManifest(): Promise<PackageManifest> {
    if (manifest) return manifest;
    manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf-8')) as PackageManifest;
    return manifest;
  }

  /**
   * Named collector: reasons a version spec fails the exact-pin rule.
   * Used by the live assertion AND by the known-bad probe, so the probe cannot
   * pass against a re-implementation of the rule (ADR-024).
   */
  function collectPinViolations(spec: string | undefined): string[] {
    const violations: string[] = [];
    if (spec === undefined) {
      violations.push('not declared');
      return violations;
    }
    if (/^[\^~]/.test(spec)) violations.push(`range prefix in "${spec}"`);
    if (spec !== MDS_VERSION) violations.push(`"${spec}" is not the expected exact pin "${MDS_VERSION}"`);
    return violations;
  }

  it(`@mdscript/mds is an exact-pinned devDependency (${MDS_VERSION}, no ^ or ~)`, async () => {
    const pkg = await loadManifest();
    const spec = pkg.devDependencies?.['@mdscript/mds'];
    const violations = collectPinViolations(spec);
    expect(
      violations,
      `package.json devDependencies["@mdscript/mds"] must be the exact version "${MDS_VERSION}". ` +
      `A range would let an npm install change the compiler that produces dist/agents/git.md, ` +
      `turning the golden fixture red with nothing in the diff to explain it.\n  ${violations.join('\n  ')}`,
    ).toHaveLength(0);
  });

  it('@mdscript/mds is NOT in dependencies (it is a build-time tool, never shipped)', async () => {
    const pkg = await loadManifest();
    expect(
      pkg.dependencies?.['@mdscript/mds'],
      'The MDS compiler must stay a devDependency. Moving it to dependencies would ship ' +
      'a compiler to every install and place it outside the devDependency pin above.',
    ).toBeUndefined();
  });

  it(`package-lock.json resolves @mdscript/mds to ${MDS_VERSION} with a sha512 integrity field`, async () => {
    const lockJson = JSON.parse(
      await fs.readFile(path.join(ROOT, 'package-lock.json'), 'utf-8'),
    ) as { packages?: Record<string, { version?: string; integrity?: string; dev?: boolean }> };

    const node = lockJson.packages?.['node_modules/@mdscript/mds'];
    expect(
      node,
      'package-lock.json must contain a node_modules/@mdscript/mds entry. Run npm install to regenerate.',
    ).toBeDefined();

    expect(
      node!.version,
      `Lockfile resolves @mdscript/mds to "${node!.version}" but package.json pins "${MDS_VERSION}" — ` +
      `the lockfile is out of sync with the pin.`,
    ).toBe(MDS_VERSION);

    expect(
      node!.integrity,
      'The @mdscript/mds lock node must carry an integrity field — without it npm install has no tamper detection.',
    ).toMatch(/^sha512-/);

    expect(node!.dev, 'the lock entry must agree that this is a dev-only dependency').toBe(true);
  });

  it('known-bad probe: a caret range and an absent entry both fail the same collector', () => {
    // Mechanic 2 (H10): synthetic specs, no committed file touched.
    expect(collectPinViolations(`^${MDS_VERSION}`).join(' '), 'a caret range must be rejected').toMatch(/range prefix/);
    expect(collectPinViolations(`~${MDS_VERSION}`).length, 'a tilde range must be rejected').toBeGreaterThan(0);
    expect(collectPinViolations(undefined), 'an absent entry must be rejected').toEqual(['not declared']);
    // And the real spelling must pass, or the collector is a blanket fail.
    expect(collectPinViolations(MDS_VERSION)).toHaveLength(0);
  });
});


// ---------------------------------------------------------------------------
// Guard 4: Commands source guard
// ---------------------------------------------------------------------------

/**
 * Every compiled dist/commands/{name}.md must have a corresponding source in
 * src/assets/commands/ as either {name}.mds (compiled by build:mds) or
 * {name}.md (hand-authored and copied directly).
 *
 * Skip if dist/commands/ doesn't exist yet (pre-build environment).
 */
describe('Guard 4 (commands source): every dist/commands/*.md has a known source', () => {
  it('every dist/commands/*.md traces back to a src/assets/commands/ source', async () => {
    const distDir = path.join(ROOT, 'dist', 'commands');
    let distFiles: string[];
    try {
      const entries = await fs.readdir(distDir);
      distFiles = entries.filter(f => f.endsWith('.md'));
    } catch {
      // dist/commands/ does not exist yet (pre-build) — skip gracefully.
      return;
    }

    if (distFiles.length === 0) {
      // Pre-build: no compiled output yet. Skip.
      return;
    }

    const srcDir = path.join(ROOT, 'src', 'assets', 'commands');
    const srcEntries = await fs.readdir(srcDir);

    // Build a set of base names from src/assets/commands/ (strip .md or .mds extension).
    const srcBases = new Set(
      srcEntries
        .filter(f => f.endsWith('.md') || f.endsWith('.mds'))
        .map(f => f.replace(/\.(mds|md)$/, '')),
    );

    const orphans: string[] = [];
    for (const file of distFiles) {
      const base = file.replace(/\.md$/, '');
      if (!srcBases.has(base)) {
        orphans.push(file);
      }
    }

    expect(
      orphans,
      `dist/commands/ contains compiled file(s) with no matching source in src/assets/commands/:\n` +
      `  ${orphans.join('\n  ')}\n` +
      `Add a source .mds or .md file, or remove the stale compiled output.`,
    ).toHaveLength(0);
  });

  it('every src/assets/commands/*.mds source produces a dist/commands/*.md output', async () => {
    const distDir = path.join(ROOT, 'dist', 'commands');
    let distBases: Set<string>;
    try {
      const entries = await fs.readdir(distDir);
      distBases = new Set(
        entries.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')),
      );
    } catch {
      // dist/commands/ does not exist yet (pre-build) — skip gracefully.
      return;
    }

    const srcDir = path.join(ROOT, 'src', 'assets', 'commands');
    const srcEntries = await fs.readdir(srcDir);
    const mdsFiles = srcEntries.filter(f => f.endsWith('.mds'));

    const missing: string[] = [];
    for (const file of mdsFiles) {
      const base = file.replace(/\.mds$/, '');
      if (!distBases.has(base)) {
        missing.push(file);
      }
    }

    expect(
      missing,
      `src/assets/commands/ contains .mds source(s) with no compiled output in dist/commands/:\n` +
      `  ${missing.join('\n  ')}\n` +
      `Run 'npm run build:mds' to compile, or check for build errors.`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Guard 5: package.json files[] coverage
// ---------------------------------------------------------------------------

/**
 * The `files` array in package.json must include the three root directories
 * required for a working npm install:
 *
 *   - `dist/`         compiled CLI entry point and compiled commands
 *   - `src/assets/`   skills, agents, rules, hook scripts, command sources
 *   - `src/targets/claude-code/templates/`  install templates (.claudeignore, settings.json)
 *
 * A missing entry causes npm to silently omit files from the tarball, breaking
 * downstream installs without any error at publish time.
 */
describe('Guard 5 (files[] coverage): package.json includes required directories', () => {
  let filesArray: string[];

  // Helper that also handles async setup without beforeAll (vitest runs it lazily).
  async function loadFiles(): Promise<string[]> {
    if (filesArray) return filesArray;
    const pkgJson = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf-8')) as {
      files?: string[];
    };
    filesArray = pkgJson.files ?? [];
    return filesArray;
  }

  const REQUIRED_ENTRIES: Array<{ entry: string; reason: string }> = [
    {
      entry: 'dist/',
      reason: 'compiled CLI (dist/cli.js) and compiled commands (dist/commands/*.md)',
    },
    {
      entry: 'src/assets/',
      reason:
        'skills, agents, rules, hook scripts, and the MDS generator sources (*.mds under ' +
        'commands/ and agents/) — all runtime assets consumed by the installer, plus the ' +
        'sources their compiled artifacts in dist/ are generated from',
    },
    {
      entry: 'src/targets/claude-code/templates/',
      reason: 'install templates (.claudeignore, settings.json) used by devflow init',
    },
  ];

  for (const { entry, reason } of REQUIRED_ENTRIES) {
    it(`includes '${entry}' (${reason})`, async () => {
      const files = await loadFiles();
      expect(
        files,
        `package.json files[] is missing '${entry}'. ` +
        `Without it, npm pack will omit: ${reason}. ` +
        `Add '${entry}' to the files array in package.json.`,
      ).toContain(entry);
    });
  }

  it('does not include src/assets/scripts/hooks/**/*.log or temp files', async () => {
    const files = await loadFiles();
    // None of the entries should inadvertently glob in log or temp files.
    // The negation entries (!dist/**/*.map, !dist/**/*.d.ts) are already
    // present — this test guards against accidentally removing them.
    const negationEntries = files.filter(f => f.startsWith('!'));
    const hasSourceMapExclusion = negationEntries.some(f => f.includes('*.map'));
    const hasDtsExclusion = negationEntries.some(f => f.includes('*.d.ts'));

    expect(
      hasSourceMapExclusion,
      'package.json files[] should exclude source maps (!dist/**/*.map) to keep the tarball lean.',
    ).toBe(true);
    expect(
      hasDtsExclusion,
      'package.json files[] should exclude type declarations (!dist/**/*.d.ts) to keep the tarball lean.',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guard 6 (tarball contents): npm pack --dry-run assertions
// ---------------------------------------------------------------------------

/**
 * AC-C3: The published tarball must:
 *  (a) Contain no plugins/ or shared/ source-tree paths — these directories
 *      only exist in the git repo and must never be published.
 *  (b) Contain exactly the dist/commands/*.md set named in tests/fixtures/mds-manifest.ts.
 *      If the set changes, this guard forces an intentional manifest update.
 *  (c) Carry the compiled agent for every generator host (dist/agents/*.md) — the
 *      only shipping form of the Git agent since its hand-authored source was removed.
 *  (d) Carry all src/assets/**\/*.mds generator sources, at the pinned count.
 *      Shipping them is decision D-A(a), accepted at Gate 2.
 *
 * Per PF-008: assert on parsed `npm pack --dry-run --json` output (structured
 * data), not on pipeline tails or partial string matching.
 *
 * Lazy-loads the file list once and caches it across assertions in this describe
 * block. `npm pack --dry-run --json` is fast (~1-2s) and creates no artifacts.
 */
describe('Guard 6 (tarball contents): npm pack --dry-run output excludes source dirs and pins command count', () => {
  let packFilesCache: string[] | undefined;

  function getPackFiles(): string[] {
    if (packFilesCache !== undefined) return packFilesCache;
    let raw: string;
    try {
      raw = execSync('npm pack --dry-run --json', {
        cwd: ROOT,
        timeout: 30_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).toString();
    } catch {
      packFilesCache = [];
      return packFilesCache;
    }
    const parsed = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>;
    packFilesCache = parsed[0].files.map(f => f.path);
    return packFilesCache;
  }

  it('tarball contains no plugins/ or shared/ paths (source-tree dirs must not be published)', () => {
    const files = getPackFiles();
    expect(
      files.length,
      'npm pack --dry-run produced no files — run `npm run build` first (guard cannot verify)',
    ).toBeGreaterThan(0);
    const forbidden = files.filter(f => f.startsWith('plugins/') || f.startsWith('shared/'));
    expect(
      forbidden,
      `Tarball contains source-tree paths that must not be published:\n  ${forbidden.join('\n  ')}\n` +
      `Check the 'files' array in package.json for overly broad globs.`,
    ).toHaveLength(0);
  });

  it('tarball contains exactly the manifest\'s dist/commands/*.md set (AC-C3)', () => {
    const files = getPackFiles();
    expect(
      files.length,
      'npm pack --dry-run produced no files — run `npm run build` first (guard cannot verify)',
    ).toBeGreaterThan(0);
    const commandMds = files
      .filter(f => /^dist\/commands\/[^/]+\.md$/.test(f))
      .map(f => f.replace(/^dist\/commands\//, ''))
      .sort();
    // Set equality against the shared manifest, not a bare count: a rename plus an
    // addition in the same commit leaves the count at 14 and the tarball wrong.
    expect(
      commandMds,
      `Tarball dist/commands/*.md set does not match tests/fixtures/mds-manifest.ts.\n` +
      `Files found: ${commandMds.join(', ')}\n` +
      `If a command was added or removed, update the manifest intentionally.`,
    ).toEqual([...DIST_COMMAND_FILES].sort());
  });

  it('tarball carries the compiled Git agent (dist/agents/git.md)', () => {
    // dist/agents/git.md is now the ONLY shipping form of the Git agent — its
    // hand-authored .md source no longer exists. `files[]` already contains
    // `dist/`, so it ships; nothing pinned that it does. A build that silently
    // skipped the generator host would publish a package with no Git agent at all.
    const files = getPackFiles();
    expect(
      files.length,
      'npm pack --dry-run produced no files — run `npm run build` first (guard cannot verify)',
    ).toBeGreaterThan(0);

    const compiledAgents = files.filter(f => /^dist\/agents\/[^/]+\.md$/.test(f)).sort();
    expect(
      compiledAgents,
      'The tarball must carry a compiled agent for every generator host. ' +
      'Run `npm run build:mds` before `npm pack` — `npm run build:cli` alone does not produce agents.',
    ).toEqual(MDS_GENERATOR_HOSTS.map(h => `dist/agents/${h}.md`).sort());
  });

  /**
   * Tarball decision D-A(a), ACCEPTED at Gate 2: the .mds generator sources ship.
   *
   * `src/assets/` already ships wholesale, so the 13 command hosts and 11 partials
   * were already inside every published tarball; `src/assets/agents/git.mds` simply
   * joins them. No `files[]` change was made. Shipping the sources costs ~0.3% of
   * the tarball and means a consumer inspecting an installed package can see what
   * dist/ was generated from.
   *
   * The count is pinned deliberately so that stops being an accident: a new host,
   * a new partial, or a source that silently stops shipping all move this number.
   */
  const EXPECTED_SHIPPED_MDS =
    MDS_COMMAND_HOSTS.length + MDS_PARTIALS.length + MDS_GENERATOR_HOSTS.length; // 13 + 11 + 1

  it(`tarball ships all ${EXPECTED_SHIPPED_MDS} src/assets/**/*.mds generator sources (D-A(a))`, () => {
    const files = getPackFiles();
    expect(
      files.length,
      'npm pack --dry-run produced no files — run `npm run build` first (guard cannot verify)',
    ).toBeGreaterThan(0);

    const shippedMds = files.filter(f => /^src\/assets\/.*\.mds$/.test(f)).sort();
    expect(
      shippedMds.length,
      `Expected ${EXPECTED_SHIPPED_MDS} .mds sources in the tarball ` +
      `(${MDS_COMMAND_HOSTS.length} command hosts + ${MDS_PARTIALS.length} partials + ` +
      `${MDS_GENERATOR_HOSTS.length} generator host), got ${shippedMds.length}:\n  ${shippedMds.join('\n  ')}\n` +
      `Shipping the sources is deliberate (decision D-A(a)); update the manifest if a source was added or removed.`,
    ).toBe(EXPECTED_SHIPPED_MDS);

    // Name the generator host explicitly — it is the one whose shipping is new.
    for (const host of MDS_GENERATOR_HOSTS) {
      expect(shippedMds, `src/assets/agents/${host}.mds must ship`).toContain(`src/assets/agents/${host}.mds`);
    }
  });
});

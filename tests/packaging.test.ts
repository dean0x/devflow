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
 *   required for a working install (dist/, src/assets/, src/targets/claude-code/templates/)
 *   and the project-owned lint-pack template (templates/lint-pack/), which ships but is
 *   never installed. A missing entry causes `npm pack` to silently omit critical files.
 *
 * Guard 6e (generated references): the tarball carries every file the installer's
 *   reference overlay converges to. An absent generated reference makes the overlay
 *   throw, so a packing regression would surface on a user's first init, not here.
 *
 * Guard 6f (variant trees): the tarball carries the variant manifest
 *   dist/variant-axes.json, and exactly the files the rosters name under the three off
 *   trees (dist/curation-off/, dist/compliance-off/, dist/curation-compliance-off/).
 *   While no host carries a compliance arm the two new trees hold no file, so a scoped
 *   `npm pack` of seeded files proves the `files` field would carry a file under each.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DIST_COMMAND_FILES,
  CURATION_OFF_FILES,
  CURATION_VARIANT_HOSTS,
  COMPLIANCE_OFF_FILES,
  COMPLIANCE_VARIANT_HOSTS,
  MDS_COMMAND_HOSTS,
  MDS_GENERATOR_HOSTS,
  MDS_REFERENCE_MODULES,
  ALL_MDS_PARTIALS,
  MDS_REFERENCE_PARTIALS,
} from './fixtures/mds-manifest.js';
import {
  GATED_REFERENCE_MODULE_SOURCES,
  generatedReferenceManifest,
} from '../src/core/mds-variants.js';
import {
  BOTH_OFF_OUTPUT_DIR,
  COMPLIANCE_OFF_OUTPUT_DIR,
  CURATION_OFF_OUTPUT_DIR,
  LEGACY_OFF_OUTPUT_DIR,
  VARIANT_MANIFEST_REL_PATH,
} from '../src/core/curation-variants.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Expected exact-pinned version of the routing runtime.
 * Hoisted so the next bump is a one-line change.
 */
const SUBSWITCH_VERSION = '0.6.0';

/**
 * Expected exact-pinned version of the MDS compiler.
 * Hoisted so the next bump is a one-line change.
 */
const MDS_VERSION = '0.4.4';

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
   * pass against a re-implementation of the rule.
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

    // The compiler resolves a backend at runtime (native addon, WASM fallback), so a
    // backend package left on another version would compile with a different engine
    // than the pin names. Every @mdscript/* lock node moves with the pin.
    const backends = Object.entries(lockJson.packages ?? {}).filter(([key]) =>
      key.startsWith('node_modules/@mdscript/'),
    );
    expect(
      backends.map(([key]) => key),
      'the lockfile must carry the native (mds-napi) and WASM (mds-wasm) backends',
    ).toEqual(expect.arrayContaining(['node_modules/@mdscript/mds-napi', 'node_modules/@mdscript/mds-wasm']));
    for (const [key, entry] of backends) {
      expect(entry.version, `${key} must resolve to the pinned ${MDS_VERSION}`).toBe(MDS_VERSION);
    }
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
 *   - `src/assets/`   skills, agents, rules, hook scripts, and the MDS generator
 *                     sources (*.mds under commands/ and agents/)
 *   - `src/targets/claude-code/templates/`  install templates (.claudeignore, settings.json)
 *
 * It must also ship `templates/lint-pack/`, the project-owned lint-pack template that
 * a project copies and owns. The installer never reads it.
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
    {
      entry: 'templates/lint-pack/',
      reason: 'project-owned lint-pack template; shipped, never installed',
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
 *      only shipping form of each of those agents.
 *  (d) Carry all src/assets/**\/*.mds generator sources, at the pinned count.
 *      Shipping them is decision D-A(a), accepted at Gate 2.
 *  (e) Carry exactly the curation-off variants named in CURATION_VARIANT_HOSTS
 *      (dist/curation-off/), the files a curation-off machine installs in place of
 *      the dist/commands/ and dist/agents/ prompts.
 *  (f) Carry the variant manifest (dist/variant-axes.json) and exactly the variants
 *      the rosters name under the compliance-off tree (dist/compliance-off/) and the
 *      both-off tree (dist/curation-compliance-off/). A scoped pack of seeded files
 *      proves the `files` field carries a file under each tree, which the real
 *      tarball cannot show while no host has a compliance arm.
 *
 * Assert on parsed `npm pack --dry-run --json` output (structured
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

  it('tarball carries the lint-pack template: its script, its example config and its README, nothing else under templates/', () => {
    // The template is project-owned: a project copies it out of the package and
    // devflow never installs or runs it. Only the tarball can ship it, so a
    // dropped `files[]` entry would leave the README's "where to find it" empty.
    const files = getPackFiles();
    expect(
      files.length,
      'npm pack --dry-run produced no files — run `npm run build` first (guard cannot verify)',
    ).toBeGreaterThan(0);

    const templates = files.filter(f => f.startsWith('templates/')).sort();
    expect(
      templates,
      'The tarball must carry exactly the lint-pack script, the example config and the README under templates/lint-pack/.',
    ).toEqual([
      'templates/lint-pack/.lint-pack.conf',
      'templates/lint-pack/README.md',
      'templates/lint-pack/lint-pack.sh',
    ]);
  });

  it('tarball carries the compiled agent of every generator host (dist/agents/*.md)', () => {
    // The compiled file is the ONLY shipping form of a generator-host agent — no
    // hand-authored .md source exists. `files[]` already contains `dist/`, so it
    // ships; nothing pinned that it does. A build that silently skipped a generator
    // host would publish a package with no such agent at all.
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
   * Named collector: the variants a file list carries under one off tree, relative
   * to that tree. Used by the live assertions AND their probe, so the probe cannot
   * pass against a re-implementation of the filter.
   */
  function collectOffTreeFiles(files: readonly string[], treeDir: string): string[] {
    const prefix = `${treeDir}/`;
    return files
      .filter(f => f.startsWith(prefix) && f.length > prefix.length && f.endsWith('.md'))
      .map(f => f.slice(prefix.length))
      .sort();
  }

  it('tarball carries exactly the manifest\'s curation-off variants (dist/curation-off/)', () => {
    const files = getPackFiles();
    expect(
      files.length,
      'npm pack --dry-run produced no files — run `npm run build` first (guard cannot verify)',
    ).toBeGreaterThan(0);
    // Set equality against the roster, so it holds at every step: an arm added
    // without a row, or a row left after its arm is gone, moves the tarball off it.
    expect(
      collectOffTreeFiles(files, CURATION_OFF_OUTPUT_DIR),
      'Tarball dist/curation-off/*.md set does not match CURATION_VARIANT_HOSTS in ' +
      'tests/fixtures/mds-manifest.ts. A curation-off machine installs these files; one missing ' +
      'ships the curation-on prompt there.',
    ).toEqual([...CURATION_OFF_FILES].sort());
  });

  /**
   * Named collector: the entries a file list carries under the retired off tree.
   * Used by the live assertion AND its probe, so the probe cannot pass against a
   * re-implementation of the filter.
   */
  function collectRetiredOffTreeFiles(files: readonly string[]): string[] {
    return files.filter(f => f.startsWith(`${LEGACY_OFF_OUTPUT_DIR}/`)).sort();
  }

  it('tarball carries no entry of the retired off tree', () => {
    const files = getPackFiles();
    expect(
      files.length,
      'npm pack --dry-run produced no files — run `npm run build` first (guard cannot verify)',
    ).toBeGreaterThan(0);
    // The build removes LEGACY_OFF_OUTPUT_DIR whole, so a checkout that built before the
    // rename ships nothing from it. Nothing reads it, and an old prompt there is dead weight.
    expect(
      collectRetiredOffTreeFiles(files),
      `Tarball carries entries under ${LEGACY_OFF_OUTPUT_DIR}/. Run \`npm run build:mds\`: the build removes that folder.`,
    ).toEqual([]);
  });

  it('known-bad probe: the retired-tree collector reports its entries and ignores the current off tree', () => {
    const seeded = [
      `${LEGACY_OFF_OUTPUT_DIR}/commands/x.md`,
      `${LEGACY_OFF_OUTPUT_DIR}/agents/y.md`,
      'dist/curation-off/commands/x.md',
      'dist/commands/x.md',
    ];
    expect(collectRetiredOffTreeFiles(seeded)).toEqual([
      `${LEGACY_OFF_OUTPUT_DIR}/agents/y.md`,
      `${LEGACY_OFF_OUTPUT_DIR}/commands/x.md`,
    ]);
  });

  it('known-bad probe: the collector reports a stray and a nested curation-off file, and ignores other dist files', () => {
    const seeded = [
      'dist/curation-off/commands/x.md',
      'dist/curation-off/agents/y.md',
      'dist/curation-off/agents/notes.txt',
      'dist/commands/x.md',
    ];
    expect(collectOffTreeFiles(seeded, CURATION_OFF_OUTPUT_DIR)).toEqual(['agents/y.md', 'commands/x.md']);
  });

  /**
   * The both-off roster: a host has a both-off variant when it carries an arm on
   * each axis, so the roster is the hosts in both rosters, relative to
   * dist/curation-compliance-off/.
   */
  const BOTH_OFF_FILES: readonly string[] = COMPLIANCE_VARIANT_HOSTS
    .filter(h => CURATION_VARIANT_HOSTS.includes(h))
    .map(h => `${h}.md`);

  it('tarball carries exactly the roster\'s compliance-off variants (dist/compliance-off/)', () => {
    const files = getPackFiles();
    expect(
      files.length,
      'npm pack --dry-run produced no files — run `npm run build` first (guard cannot verify)',
    ).toBeGreaterThan(0);
    expect(
      collectOffTreeFiles(files, COMPLIANCE_OFF_OUTPUT_DIR),
      'Tarball dist/compliance-off/*.md set does not match COMPLIANCE_VARIANT_HOSTS in ' +
      'tests/fixtures/mds-manifest.ts. A compliance-off machine installs these files; one missing ' +
      'ships the compliance-on prompt there.',
    ).toEqual([...COMPLIANCE_OFF_FILES].sort());
  });

  it('tarball carries exactly the roster\'s both-off variants (dist/curation-compliance-off/)', () => {
    const files = getPackFiles();
    expect(
      files.length,
      'npm pack --dry-run produced no files — run `npm run build` first (guard cannot verify)',
    ).toBeGreaterThan(0);
    expect(
      collectOffTreeFiles(files, BOTH_OFF_OUTPUT_DIR),
      'Tarball dist/curation-compliance-off/*.md set does not match the hosts that carry both a ' +
      'curation arm and a compliance arm. A machine with both axes off installs these files.',
    ).toEqual([...BOTH_OFF_FILES].sort());
  });

  it('tarball carries the variant manifest the installer reads (dist/variant-axes.json)', () => {
    const files = getPackFiles();
    expect(
      files.length,
      'npm pack --dry-run produced no files — run `npm run build` first (guard cannot verify)',
    ).toBeGreaterThan(0);
    // The manifest is the only file that is present for every build, even while no
    // host carries a compliance arm. A compliance-off install refuses without it, so
    // a tarball that dropped it would fail on a user's first init.
    expect(
      files,
      `The tarball must carry ${VARIANT_MANIFEST_REL_PATH}. Run \`npm run build:mds\` before \`npm pack\`.`,
    ).toContain(VARIANT_MANIFEST_REL_PATH);
  });

  it('known-bad probe: the collector keeps each tree apart and ignores a non-prompt file', () => {
    const seeded = [
      'dist/compliance-off/commands/x.md',
      'dist/compliance-off/agents/notes.txt',
      'dist/curation-compliance-off/agents/y.md',
      'dist/curation-off/commands/z.md',
      'dist/commands/x.md',
    ];
    expect(collectOffTreeFiles(seeded, COMPLIANCE_OFF_OUTPUT_DIR)).toEqual(['commands/x.md']);
    expect(collectOffTreeFiles(seeded, BOTH_OFF_OUTPUT_DIR)).toEqual(['agents/y.md']);
    expect(collectOffTreeFiles(seeded, CURATION_OFF_OUTPUT_DIR)).toEqual(['commands/z.md']);
  });

  /**
   * Run `npm pack --dry-run --json` over a scratch package that holds the given
   * files and the real package.json `files` patterns, and return the packed paths.
   * The scratch folder is the working directory, HOME and the npm cache, so the run
   * reads no config of the real machine and writes nothing outside it.
   */
  async function packSeededFiles(patterns: readonly string[], seeded: readonly string[]): Promise<string[]> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-pack-'));
    try {
      await fs.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'pack-fixture', version: '0.0.0', files: patterns }),
      );
      for (const rel of seeded) {
        await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
        await fs.writeFile(path.join(dir, rel), 'seed\n');
      }
      const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: dir,
        timeout: 30_000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOME: dir,
          npm_config_cache: path.join(dir, '.npm-cache'),
          npm_config_userconfig: path.join(dir, '.npmrc'),
          npm_config_update_notifier: 'false',
        },
      }).toString();
      const parsed = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>;
      return parsed[0].files.map(f => f.path).sort();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it('package.json files[] packs a file under each off tree and the manifest, and still drops a map and a stray path', async () => {
    // The tarball arms above compare against rosters and so hold with an empty
    // roster: no host carries a compliance arm yet, and the two new trees stay empty.
    // This is the presence arm. It packs seeded files under the REAL files[] patterns,
    // so a pattern that stopped covering a tree turns it red before the first arm lands.
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf-8')) as { files?: string[] };
    const patterns = pkg.files ?? [];
    expect(patterns, 'package.json files[] must ship dist/ wholesale').toContain('dist/');
    const excluded = patterns.filter(p => p.startsWith('!') && !/^!dist\/\*\*\/\*\.(map|d\.ts)$/.test(p));
    expect(
      excluded,
      'a negated files[] pattern other than the map and declaration excludes must be checked against the off trees',
    ).toEqual([]);

    const wanted = [
      `${CURATION_OFF_OUTPUT_DIR}/commands/x.md`,
      `${CURATION_OFF_OUTPUT_DIR}/agents/y.md`,
      `${COMPLIANCE_OFF_OUTPUT_DIR}/commands/x.md`,
      `${COMPLIANCE_OFF_OUTPUT_DIR}/agents/y.md`,
      `${BOTH_OFF_OUTPUT_DIR}/commands/x.md`,
      `${BOTH_OFF_OUTPUT_DIR}/agents/y.md`,
      VARIANT_MANIFEST_REL_PATH,
    ];
    // Controls: the scratch pack must apply the patterns. A map file under a tree and a
    // path outside every pattern are dropped; if either were packed, "wanted is packed"
    // would hold for any package at all.
    const dropped = [`${COMPLIANCE_OFF_OUTPUT_DIR}/commands/x.md.map`, 'plugins/x/x.md'];
    const packed = await packSeededFiles(patterns, [...wanted, ...dropped]);
    expect(
      wanted.filter(f => !packed.includes(f)),
      'package.json files[] must pack a file under every off tree and the variant manifest',
    ).toEqual([]);
    expect(
      dropped.filter(f => packed.includes(f)),
      'the scratch pack must honour files[]: a map file and a path outside every pattern stay out',
    ).toEqual([]);
  });

  /**
   * Tarball decision D-A(a), ACCEPTED at Gate 2: the .mds generator sources ship.
   *
   * `src/assets/` already ships wholesale, so the command hosts and the partials
   * were already inside every published tarball; the agent generator hosts
   * (`src/assets/agents/*.mds`) simply join them. No `files[]` change was made. Shipping the sources costs ~0.3% of
   * the tarball and means a consumer inspecting an installed package can see what
   * dist/ was generated from.
   *
   * The count is pinned deliberately so that stops being an accident: a new host,
   * a new partial, or a source that silently stops shipping all move this number.
   */
  const EXPECTED_SHIPPED_MDS =
    MDS_COMMAND_HOSTS.length + ALL_MDS_PARTIALS.length + MDS_GENERATOR_HOSTS.length +
    MDS_REFERENCE_MODULES.length;

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
      `(${MDS_COMMAND_HOSTS.length} command hosts + ${ALL_MDS_PARTIALS.length} partials + ` +
      `${MDS_GENERATOR_HOSTS.length} generator hosts + ${MDS_REFERENCE_MODULES.length} reference ` +
      `module(s)), got ${shippedMds.length}:\n  ${shippedMds.join('\n  ')}\n` +
      `Shipping the sources is deliberate (decision D-A(a)); update the manifest if a source was added or removed.`,
    ).toBe(EXPECTED_SHIPPED_MDS);

    // Name each generator host explicitly: its compiled form is the only one that ships.
    for (const host of MDS_GENERATOR_HOSTS) {
      expect(shippedMds, `src/assets/agents/${host}.mds must ship`).toContain(`src/assets/agents/${host}.mds`);
    }
    // Reference modules ship for the same reason: an installed package should
    // show what its generated skill references were compiled from.
    for (const source of MDS_REFERENCE_MODULES) {
      expect(shippedMds, `${source} must ship`).toContain(source);
    }
    // A partial outside _partials/ ships for the same reason and is the class most
    // easily lost: it lives beside the reference modules, not with the other partials.
    for (const source of MDS_REFERENCE_PARTIALS) {
      expect(shippedMds, `${source} must ship`).toContain(source);
    }
    // A GATED module ships whether or not this build generates anything from it.
    // Its gate is a property of the registry, not of the tarball: a published
    // package whose registry later opens the gate must be able to compile the
    // source, and this is the one class the `files[]`-wholesale behaviour could
    // silently drop without any generated-file assertion noticing, because in the
    // shut state it generates none.
    for (const source of GATED_REFERENCE_MODULE_SOURCES) {
      expect(
        shippedMds,
        `${source} is gate-controlled, not optional — it must ship in either gate state`,
      ).toContain(source);
    }
    expect(
      GATED_REFERENCE_MODULE_SOURCES.length,
      'the gated roster is empty — the loop above asserts nothing (an absence-based ' +
      'roster needs a presence arm)',
    ).toBeGreaterThan(0);
  });

  /**
   * Guard 6e (P2-S14, prefix-shippability clause (i)): every generated skill reference
   * is inside the tarball.
   *
   * The installer's reference overlay treats an absent generated reference as a
   * build-artifact absence and THROWS with a build hint. If `files[]` ever stopped
   * carrying `dist/skills/`, that loud failure would move from this repo to every
   * user's first `devflow init` off a published tarball — the guard has to sit here,
   * where the packed file list is the thing under test.
   *
   * `files[]` contains `dist/` wholesale today, so nothing pins that these particular
   * paths ride along; that is exactly the accident this makes deliberate.
   */
  function collectMissingPackedReferences(
    packed: readonly string[],
    manifest: readonly string[],
  ): string[] {
    const packedSet = new Set(packed);
    return manifest
      .map(rel => `dist/skills/git/references/${rel}`)
      .filter(p => !packedSet.has(p));
  }

  it('tarball carries every generated skill reference the installer overlay converges to', () => {
    const files = getPackFiles();
    expect(
      files.length,
      'npm pack --dry-run produced no files — run `npm run build` first (guard cannot verify)',
    ).toBeGreaterThan(0);

    const manifest = generatedReferenceManifest();
    expect(
      manifest.length,
      'a manifest short enough to enumerate by hand makes this assertion vacuous',
    ).toBeGreaterThanOrEqual(47);

    expect(
      collectMissingPackedReferences(files, manifest),
      'The tarball must carry every file the reference overlay installs. ' +
      'Run `npm run build:mds` before `npm pack`, and check that package.json `files` ' +
      'still covers dist/skills/.',
    ).toEqual([]);
  });

  it('known-bad probe: a manifest entry missing from the packed list is reported by the same collector', () => {
    const manifest = generatedReferenceManifest();
    const seeded = getPackFiles().filter(
      f => f !== `dist/skills/git/references/${manifest[0]}`,
    );
    expect(collectMissingPackedReferences(seeded, manifest)).toEqual([
      `dist/skills/git/references/${manifest[0]}`,
    ]);
  });
});

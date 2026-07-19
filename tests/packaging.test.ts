/**
 * Packaging guards.
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
import { promises as fs } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

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
      reason: 'skills, agents, rules, hook scripts — all runtime assets consumed by the installer',
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

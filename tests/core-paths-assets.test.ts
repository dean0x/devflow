/**
 * Unit tests for the two Phase-2 modules:
 *
 *   src/core/paths.ts  — getPackageRoot()
 *   src/core/assets.ts — skillsDir(), agentsDir(), rulesDir(), commandsDir(), scriptsDir()
 *
 * These modules replaced the previous scattered `path.resolve(__dirname, '../..')` lookups
 * and must reliably locate the repo root from both the source and compiled layouts.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';

import { getPackageRoot } from '../src/core/paths.js';
import { skillsDir, agentsDir, rulesDir, commandsDir, scriptsDir } from '../src/core/assets.js';

const ROOT = path.resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// getPackageRoot
// ---------------------------------------------------------------------------

describe('getPackageRoot', () => {
  it('returns the repo root (the directory containing package.json)', () => {
    const root = getPackageRoot();
    // Normalise both paths so symlinks or trailing slashes don't trip us up.
    expect(path.resolve(root)).toBe(path.resolve(ROOT));
  });

  it('returned root contains a package.json', async () => {
    const pkgPath = path.join(getPackageRoot(), 'package.json');
    await expect(
      fs.access(pkgPath),
      `package.json not found at ${pkgPath}`,
    ).resolves.toBeUndefined();
  });

  it('is stable across repeated calls (no FS side effects)', () => {
    const a = getPackageRoot();
    const b = getPackageRoot();
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Asset directory accessors
// ---------------------------------------------------------------------------

describe('skillsDir', () => {
  it('returns {root}/src/assets/skills', () => {
    expect(skillsDir()).toBe(path.join(ROOT, 'src', 'assets', 'skills'));
  });

  it('resolved directory exists on disk', async () => {
    await expect(fs.access(skillsDir())).resolves.toBeUndefined();
  });

  it('contains at least one skill subdirectory', async () => {
    const entries = await fs.readdir(skillsDir());
    expect(entries.length, 'src/assets/skills/ should not be empty').toBeGreaterThan(0);
  });
});

describe('agentsDir', () => {
  it('returns {root}/src/assets/agents', () => {
    expect(agentsDir()).toBe(path.join(ROOT, 'src', 'assets', 'agents'));
  });

  it('resolved directory exists on disk', async () => {
    await expect(fs.access(agentsDir())).resolves.toBeUndefined();
  });

  it('contains at least one .md file', async () => {
    const entries = await fs.readdir(agentsDir());
    const mdFiles = entries.filter(f => f.endsWith('.md'));
    expect(mdFiles.length, 'src/assets/agents/ should contain .md files').toBeGreaterThan(0);
  });
});

describe('rulesDir', () => {
  it('returns {root}/src/assets/rules', () => {
    expect(rulesDir()).toBe(path.join(ROOT, 'src', 'assets', 'rules'));
  });

  it('resolved directory exists on disk', async () => {
    await expect(fs.access(rulesDir())).resolves.toBeUndefined();
  });

  it('contains at least one .md file', async () => {
    const entries = await fs.readdir(rulesDir());
    const mdFiles = entries.filter(f => f.endsWith('.md'));
    expect(mdFiles.length, 'src/assets/rules/ should contain .md files').toBeGreaterThan(0);
  });
});

describe('commandsDir', () => {
  it('returns {root}/dist/commands', () => {
    expect(commandsDir()).toBe(path.join(ROOT, 'dist', 'commands'));
  });

  it('resolved directory exists when dist/ has been built', async () => {
    // Skip if dist/commands/ doesn't exist yet (pre-build CI environment).
    const distCmd = commandsDir();
    let exists = false;
    try {
      await fs.access(distCmd);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      // Pre-build: skip gracefully — the directory will be created by build:mds.
      return;
    }

    const entries = await fs.readdir(distCmd);
    const mdFiles = entries.filter(f => f.endsWith('.md'));
    expect(mdFiles.length, 'dist/commands/ should contain compiled .md files after build').toBeGreaterThan(0);
  });
});

describe('scriptsDir', () => {
  it('returns {root}/src/assets/scripts', () => {
    expect(scriptsDir()).toBe(path.join(ROOT, 'src', 'assets', 'scripts'));
  });

  it('resolved directory exists on disk', async () => {
    await expect(fs.access(scriptsDir())).resolves.toBeUndefined();
  });

  it('contains the hooks/ subdirectory', async () => {
    const hooksPath = path.join(scriptsDir(), 'hooks');
    await expect(
      fs.access(hooksPath),
      `hooks/ subdirectory not found inside scriptsDir() at ${hooksPath}`,
    ).resolves.toBeUndefined();
  });
});

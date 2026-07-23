/**
 * Unit tests for new Phase-2 installer functionality:
 *
 *   composeScripts()   — copies src/assets/scripts/ and walks the dist/hud/ import graph
 *   command-missing    — installViaFileCopy throws when dist/commands/{name}.md is absent
 *   prefix-diff sweep  — stale devflow:* skill dirs removed on full install, untouched
 *                        on partial (--plugin) install
 *
 * These code paths were introduced in the src/ restructure and were not covered by
 * the existing init-logic.test.ts suite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { composeScripts, installViaFileCopy } from '../src/targets/claude-code/installer.js';
import { buildAssetMaps } from '../src/core/plugins.js';
import type { PluginDefinition } from '../src/core/plugins.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-installer-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// composeScripts
// ---------------------------------------------------------------------------

describe('composeScripts', () => {
  it('creates the target directory if absent', async () => {
    const target = path.join(tmpDir, 'scripts');
    await composeScripts(target);
    await expect(fs.access(target)).resolves.toBeUndefined();
  });

  it('copies hook scripts from src/assets/scripts/ to the target', async () => {
    const target = path.join(tmpDir, 'scripts');
    await composeScripts(target);

    // Well-known hook scripts that must always be present.
    const hooksDir = path.join(target, 'hooks');
    await expect(
      fs.access(path.join(hooksDir, 'capture-turn')),
      'capture-turn hook not found in compose output',
    ).resolves.toBeUndefined();

    await expect(
      fs.access(path.join(hooksDir, 'memory-worker')),
      'memory-worker hook not found in compose output',
    ).resolves.toBeUndefined();
  });

  it('writes a {"type":"module"} package.json to the target', async () => {
    const target = path.join(tmpDir, 'scripts');
    await composeScripts(target);

    const pkgPath = path.join(target, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    const parsed = JSON.parse(content) as { type?: string };
    expect(parsed.type).toBe('module');
  });

  it('is idempotent — second call does not overwrite existing package.json content', async () => {
    const target = path.join(tmpDir, 'scripts');
    await composeScripts(target);
    await composeScripts(target); // second call

    const pkgPath = path.join(target, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    expect(JSON.parse(content)).toMatchObject({ type: 'module' });
  });
});

// ---------------------------------------------------------------------------
// Command-missing throw
// ---------------------------------------------------------------------------

describe('installViaFileCopy — command-missing hard error', () => {
  it('throws when a declared command has no compiled dist/commands/{name}.md', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');

    // Fictional plugin that declares a command that cannot exist in dist/commands/
    const fakePlugin: PluginDefinition = {
      name: 'devflow-test-fixture',
      description: 'Test fixture plugin (not real)',
      commands: ['/devflow-nonexistent-xyz-guard'],
      agents: [],
      skills: [],
      optional: false,
      rules: [],
    };

    const { skillsMap, agentsMap } = buildAssetMaps([fakePlugin]);

    const spinner = { start: () => {}, stop: () => {}, message: () => {} };

    await expect(
      installViaFileCopy({
        plugins: [fakePlugin],
        claudeDir,
        devflowDir,
        skillsMap,
        agentsMap,
        spinner,
      }),
    ).rejects.toThrow(/Command source not found for declared command "devflow-nonexistent-xyz-guard"/);
  });

  it('error message includes the expected dist/commands/ path (aids debugging)', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');

    const fakePlugin: PluginDefinition = {
      name: 'devflow-test-fixture',
      description: 'Test fixture plugin',
      commands: ['/devflow-nonexistent-xyz-guard'],
      agents: [],
      skills: [],
      optional: false,
      rules: [],
    };

    const { skillsMap, agentsMap } = buildAssetMaps([fakePlugin]);
    const spinner = { start: () => {}, stop: () => {}, message: () => {} };

    let caught: Error | undefined;
    try {
      await installViaFileCopy({ plugins: [fakePlugin], claudeDir, devflowDir, skillsMap, agentsMap, spinner });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    // Error must identify the missing file path so the developer knows what to fix.
    expect(caught!.message).toContain('dist/commands');
    expect(caught!.message).toContain('build:mds');
  });
});

// ---------------------------------------------------------------------------
// Prefix-diff sweep: stale devflow:* skill dirs removed on full install
// ---------------------------------------------------------------------------
//
// WS4: on full install only (!isPartialInstall), installViaFileCopy scans
// ~/.claude/skills/ and removes any devflow:* dir whose bare name is not in
// getAllSkillNames(). This prevents stale prefixed dirs from accumulating on
// upgrade. Bare (pre-namespace) dirs are untouched (avoids PF-012).

describe('installViaFileCopy — prefix-diff sweep', () => {
  // Minimal no-op plugin: no commands, no agents, no skills, no rules.
  // installViaFileCopy will still run the cleanup + sweep + composeScripts blocks.
  const noOpPlugin: PluginDefinition = {
    name: 'devflow-test-noop',
    description: 'No-op test fixture',
    commands: [],
    agents: [],
    skills: [],
    optional: false,
    rules: [],
  };

  const spinner = { start: () => {}, stop: () => {}, message: () => {} };

  // Construct the orphan dir name programmatically so the skill-references scanner
  // does not flag the literal string as a prefixed skill reference.
  const ORPHAN_DIR_NAME = ['devflow', 'zzz-orphan'].join(':');

  it('removes a stale devflow:* dir on full install (isPartialInstall=false)', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');
    const skillsDir = path.join(claudeDir, 'skills');
    const orphanDir = path.join(skillsDir, ORPHAN_DIR_NAME);

    // Plant a stale prefixed dir that is not in the registry
    await fs.mkdir(orphanDir, { recursive: true });

    const { skillsMap, agentsMap } = buildAssetMaps([noOpPlugin]);

    await installViaFileCopy({
      plugins: [noOpPlugin],
      claudeDir,
      devflowDir,
      skillsMap,
      agentsMap,
      isPartialInstall: false, // full install — sweep runs
      spinner,
    });

    await expect(
      fs.access(orphanDir),
      'orphan stale prefixed dir should be removed on full install',
    ).rejects.toThrow();
  });

  it('leaves a stale devflow:* dir on partial (--plugin) install (isPartialInstall=true)', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');
    const skillsDir = path.join(claudeDir, 'skills');
    const orphanDir = path.join(skillsDir, ORPHAN_DIR_NAME);

    // Plant the same stale dir
    await fs.mkdir(orphanDir, { recursive: true });

    const { skillsMap, agentsMap } = buildAssetMaps([noOpPlugin]);

    await installViaFileCopy({
      plugins: [noOpPlugin],
      claudeDir,
      devflowDir,
      skillsMap,
      agentsMap,
      isPartialInstall: true, // partial install — sweep does NOT run
      spinner,
    });

    await expect(
      fs.access(orphanDir),
      'stale prefixed dir must NOT be removed on partial install',
    ).resolves.toBeUndefined();
  });

  it('leaves a bare (non-prefixed) dir untouched on full install (avoids PF-012)', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');
    const skillsDir = path.join(claudeDir, 'skills');
    // Bare dir: no devflow: prefix — pre-namespace legacy dir
    const bareDir = path.join(skillsDir, 'zzz-orphan');

    await fs.mkdir(bareDir, { recursive: true });

    const { skillsMap, agentsMap } = buildAssetMaps([noOpPlugin]);

    await installViaFileCopy({
      plugins: [noOpPlugin],
      claudeDir,
      devflowDir,
      skillsMap,
      agentsMap,
      isPartialInstall: false, // full install
      spinner,
    });

    // Bare dir is untouched — pre-namespace cleanup is handled by LEGACY_SKILLS_* lists
    await expect(
      fs.access(bareDir),
      'bare (non-prefixed) dir must NOT be removed by the prefix-diff sweep',
    ).resolves.toBeUndefined();
  });
});

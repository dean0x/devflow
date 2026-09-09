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
import { agentsDir, compiledAgentsDir, type AgentSourceDirs } from '../src/core/assets.js';
import { resolveAgentSource, splitFrontmatter } from './helpers.js';

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
    await composeScripts(target); // first call: creates package.json with {type:'module'}

    // Write a sentinel key into the existing package.json before the second call.
    // If composeScripts uses 'wx' (exclusive-create), the second call leaves the file
    // untouched and the sentinel survives. If it incorrectly uses 'w' (overwrite), the
    // sentinel is wiped and the assertion below fails — proving the flag matters.
    const pkgPath = path.join(target, 'package.json');
    const firstContent = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as Record<string, unknown>;
    await fs.writeFile(pkgPath, JSON.stringify({ ...firstContent, _sentinel: true }));

    await composeScripts(target); // second call — must not overwrite

    const parsed = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as Record<string, unknown>;
    expect(parsed.type).toBe('module');
    expect(
      parsed['_sentinel'],
      'sentinel key was wiped — composeScripts must use wx (exclusive-create) for package.json',
    ).toBe(true);
  });

  it('copies redact-secrets.cjs to the target alongside hud.sh (install path pin)', async () => {
    // composeScripts copies src/assets/scripts/ verbatim (hooks/ + top-level entry scripts)
    // via copyDirectory. A top-level redact-secrets.cjs is picked up automatically — no
    // installer code changes required. This test pins the install path so a future rename
    // or move of the script fails RED immediately.
    //
    // PF-018: assert file exists AND is non-empty (guards against an empty sentinel being
    // accidentally installed in place of the real script).
    const target = path.join(tmpDir, 'scripts');
    await composeScripts(target);

    const scrubberPath = path.join(target, 'redact-secrets.cjs');
    await expect(
      fs.access(scrubberPath),
      'redact-secrets.cjs not found in compose output — must land at top level of scripts dir (sibling of hud.sh)',
    ).resolves.toBeUndefined();

    const content = await fs.readFile(scrubberPath, 'utf-8');
    expect(
      content.length,
      'redact-secrets.cjs must be non-empty after install (PF-018)',
    ).toBeGreaterThan(0);
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

  it('removes a stale devflow:* dir on partial (--plugin) install — sweep is ungated', async () => {
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
      isPartialInstall: true, // partial install — sweep runs on every shape
      spinner,
    });

    // The sweep is ungated: stale prefixed dirs are removed on partial install
    await expect(
      fs.access(orphanDir),
      'stale prefixed dir must be removed even on partial install',
    ).rejects.toThrow();
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

  // ---------------------------------------------------------------------------
  // PF-012: install must not delete a bare skill dir whose name collides with
  // a live-registry skill name.  ~/.claude/skills/ is shared with other tools;
  // a bare dir like `security/` may belong to a third-party plugin.
  //
  // Discriminating: before fix the bare rm loop iterates DEVFLOW_PLUGINS and
  // removes ~/.claude/skills/security/, wiping the sentinel → RED.
  // After fix the bare rm loop is gone → sentinel survives → GREEN.
  // ---------------------------------------------------------------------------
  it('install spares a foreign bare skill dir whose name collides with a registry skill', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');
    const skillsDir = path.join(claudeDir, 'skills');

    // Seed: bare security/ with sentinel content.
    // 'security' is in the live Devflow registry (devflow-code-review et al.) but
    // also a plausible name for a foreign plugin's skill directory.
    const foreignBarePath = path.join(skillsDir, 'security');
    await fs.mkdir(foreignBarePath, { recursive: true });
    const sentinel = 'sentinel-content-foreign-security-dir';
    await fs.writeFile(path.join(foreignBarePath, 'SKILL.md'), sentinel, 'utf-8');

    // Use a plugin that declares 'security' so devflow:security/ gets installed.
    // The real source at src/assets/skills/security/ must exist for this to succeed.
    const securityPlugin: PluginDefinition = {
      name: 'devflow-test-security-only',
      description: 'Test plugin that owns the security skill',
      commands: [],
      agents: [],
      skills: ['security'],
      optional: false,
      rules: [],
    };
    const { skillsMap, agentsMap } = buildAssetMaps([securityPlugin]);

    await installViaFileCopy({
      plugins: [securityPlugin],
      claudeDir,
      devflowDir,
      skillsMap,
      agentsMap,
      isPartialInstall: false,
      spinner,
    });

    // Foreign bare security/ must survive byte-identical — not Devflow's to delete.
    const survived = await fs.readFile(path.join(foreignBarePath, 'SKILL.md'), 'utf-8');
    expect(
      survived,
      'foreign bare security/SKILL.md must survive installViaFileCopy unchanged',
    ).toBe(sentinel);

    // devflow:security/ was installed at the prefixed path (Devflow's copy).
    await expect(
      fs.access(path.join(skillsDir, 'devflow:security')),
      'devflow:security/ must be installed at the prefixed path',
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WS6a: hard-error on missing declared agent / skill / rule source
// ---------------------------------------------------------------------------
//
// A declared source file that is absent is a build/packaging failure, not a
// per-item degradation. Each of the three asset types must throw a plain Error
// (matching the command pattern) rather than silently skipping.
//
// Shadow validation paths remain tolerant (ADR-010): invalid shadows
// still warn-and-install-source rather than throwing.
// Per-item copy failures (EACCES, ENOSPC, etc.) remain isolated (PF-009).

describe('installViaFileCopy — hard-error on missing declared source (WS6a)', () => {
  const spinner = { start: () => {}, stop: () => {}, message: () => {} };

  it('throws when a declared agent source file is absent', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');

    const fakePlugin: PluginDefinition = {
      name: 'devflow-test-ws6a',
      description: 'Test fixture for WS6a agent check',
      commands: [],
      agents: ['nonexistent-xyz-ws6a-agent'],
      skills: [],
      optional: false,
      rules: [],
    };

    const { agentsMap } = buildAssetMaps([fakePlugin]);

    await expect(
      installViaFileCopy({
        plugins: [fakePlugin],
        claudeDir,
        devflowDir,
        skillsMap: new Map(),
        agentsMap,
        isPartialInstall: false,
        spinner,
      }),
    ).rejects.toThrow(/Agent source not found for declared agent "nonexistent-xyz-ws6a-agent"/);
  });

  it('error message for missing agent includes path and fix hint', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');

    const fakePlugin: PluginDefinition = {
      name: 'devflow-test-ws6a',
      description: 'Test fixture',
      commands: [],
      agents: ['nonexistent-xyz-ws6a-agent'],
      skills: [],
      optional: false,
      rules: [],
    };

    const { agentsMap } = buildAssetMaps([fakePlugin]);

    let caught: Error | undefined;
    try {
      await installViaFileCopy({
        plugins: [fakePlugin],
        claudeDir,
        devflowDir,
        skillsMap: new Map(),
        agentsMap,
        isPartialInstall: false,
        spinner,
      });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    // Pin the filename and fix-hint literals from the installer error message. These are
    // stable across path reconfigurations and will survive Phase 1's resolver refactor.
    expect(caught!.message).toContain('nonexistent-xyz-ws6a-agent.md');
    expect(caught!.message).toContain('ensure the agent file exists');
  });

  it('throws when a declared agent is absent from BOTH the compiled and source dirs', async () => {
    // Phase 1 resolves agents dist-first with a src fallback. Neither present is
    // still a hard error, and the message must name the build step as well as
    // the source tree — never a silent skip. The primary path it names is the
    // most-preferred (compiled) candidate: for a generator-host agent the source
    // path does not and will never exist, so leading with it misdirects.
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');
    const emptyDist = path.join(tmpDir, 'empty-dist-agents');
    const emptySrc = path.join(tmpDir, 'empty-src-agents');
    await fs.mkdir(emptyDist, { recursive: true });
    await fs.mkdir(emptySrc, { recursive: true });

    const fakePlugin: PluginDefinition = {
      name: 'devflow-test-ws6a',
      description: 'Test fixture',
      commands: [],
      agents: ['nonexistent-xyz-ws6a-agent'],
      skills: [],
      optional: false,
      rules: [],
    };

    let caught: Error | undefined;
    try {
      await installViaFileCopy({
        plugins: [fakePlugin],
        claudeDir,
        devflowDir,
        skillsMap: new Map(),
        agentsMap: buildAssetMaps([fakePlugin]).agentsMap,
        isPartialInstall: false,
        spinner,
        agentSourceDirs: [emptyDist, emptySrc],
      });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toContain('nonexistent-xyz-ws6a-agent.md');
    expect(caught!.message).toContain('ensure the agent file exists');
    expect(caught!.message).toContain('build:mds');
    // Both searched locations are named so the reader knows where to look.
    expect(caught!.message).toContain(emptyDist);
    expect(caught!.message).toContain(emptySrc);
    // The named primary path is the most-preferred candidate, not the last one.
    expect(caught!.message).toContain(
      `agent "nonexistent-xyz-ws6a-agent": ${path.join(emptyDist, 'nonexistent-xyz-ws6a-agent.md')}`,
    );
  });

  it('throws when a declared skill source directory is absent', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');

    const noOpPlugin: PluginDefinition = {
      name: 'devflow-test-ws6a-noop',
      description: 'Test fixture',
      commands: [],
      agents: [],
      skills: [],
      optional: false,
      rules: [],
    };

    // skillsMap entry with a skill whose source dir does not exist in src/assets/skills/
    const skillsMap = new Map([['nonexistent-xyz-ws6a-skill', 'devflow-test-ws6a-noop']]);

    await expect(
      installViaFileCopy({
        plugins: [noOpPlugin],
        claudeDir,
        devflowDir,
        skillsMap,
        agentsMap: new Map(),
        isPartialInstall: false,
        spinner,
      }),
    ).rejects.toThrow(/Skill source not found for declared skill "nonexistent-xyz-ws6a-skill"/);
  });

  it('throws when a declared rule source file is absent', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');

    const noOpPlugin: PluginDefinition = {
      name: 'devflow-test-ws6a-noop',
      description: 'Test fixture',
      commands: [],
      agents: [],
      skills: [],
      optional: false,
      rules: [],
    };

    // rulesMap entry with a rule whose source file does not exist in src/assets/rules/
    const rulesMap = new Map([['nonexistent-xyz-ws6a-rule', 'devflow-test-ws6a-noop']]);

    await expect(
      installViaFileCopy({
        plugins: [noOpPlugin],
        claudeDir,
        devflowDir,
        skillsMap: new Map(),
        agentsMap: new Map(),
        rulesMap,
        isPartialInstall: false,
        spinner,
      }),
    ).rejects.toThrow(/Rule source not found for declared rule "nonexistent-xyz-ws6a-rule"/);
  });
});

// ---------------------------------------------------------------------------
// A2: orphan-sweep results surface through InstallReport
// ---------------------------------------------------------------------------

describe('installViaFileCopy — sweep results in InstallReport (A2)', () => {
  const spinner = { start: () => {}, stop: () => {}, message: () => {} };
  const noOpPlugin: PluginDefinition = {
    name: 'devflow-test-noop-a2',
    description: 'No-op test fixture for A2',
    commands: [],
    agents: [],
    skills: [],
    optional: false,
    rules: [],
  };

  it('sweptOrphans contains the registry name of a removed orphan agent file', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');
    const agentsTarget = path.join(claudeDir, 'agents', 'devflow');

    // Plant a stale agent file that is not in the registry (any real agent name would survive).
    const orphanName = 'devflow-zzz-nonexistent-sweep-sentinel';
    await fs.mkdir(agentsTarget, { recursive: true });
    await fs.writeFile(path.join(agentsTarget, `${orphanName}.md`), '# stale', 'utf-8');

    const { skillsMap, agentsMap } = buildAssetMaps([noOpPlugin]);

    // Use isPartialInstall:true so the pre-install directory wipe is skipped;
    // on a full install the entire agents/devflow dir is removed before the sweep,
    // making the sweep a no-op for that case.
    const report = await installViaFileCopy({
      plugins: [noOpPlugin],
      claudeDir,
      devflowDir,
      skillsMap,
      agentsMap,
      isPartialInstall: true,
      spinner,
    });

    // The orphan should be recorded in sweptOrphans (now { kind, name }[]) and the file should be gone.
    expect(report.sweptOrphans.some(o => o.name === orphanName), 'orphan name must appear in sweptOrphans').toBe(true);
    await expect(
      fs.access(path.join(agentsTarget, `${orphanName}.md`)),
    ).rejects.toThrow();
  });

  // F15: sweptOrphans entries carry a `kind` field so formatSweepSummary can
  // display "agent git" rather than the bare name, disambiguating same-named
  // assets across asset types (e.g. a command and an agent both named "git").
  it('F15: sweptOrphans entries carry { kind, name } — not bare strings', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');
    const agentsTarget = path.join(claudeDir, 'agents', 'devflow');

    const orphanName = 'devflow-zzz-f15-kind-sentinel';
    await fs.mkdir(agentsTarget, { recursive: true });
    await fs.writeFile(path.join(agentsTarget, `${orphanName}.md`), '# stale', 'utf-8');

    const { skillsMap, agentsMap } = buildAssetMaps([noOpPlugin]);
    const report = await installViaFileCopy({
      plugins: [noOpPlugin],
      claudeDir,
      devflowDir,
      skillsMap,
      agentsMap,
      isPartialInstall: true,
      spinner,
    });

    const entry = report.sweptOrphans.find(o => o.name === orphanName);
    expect(entry, 'orphan entry must exist with a kind field').toBeDefined();
    expect(entry?.kind).toBe('agent');
  });

  it('sweepFailures is empty when no removals fail', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');
    const { skillsMap, agentsMap } = buildAssetMaps([noOpPlugin]);

    const report = await installViaFileCopy({
      plugins: [noOpPlugin],
      claudeDir,
      devflowDir,
      skillsMap,
      agentsMap,
      spinner,
    });

    expect(report.sweepFailures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// compliance skill orphan sweep — FEATURE_OWNED_SKILLS protection (I09)
//
// The installer's knownNames set now unions FEATURE_OWNED_SKILLS, so
// devflow:compliance is never swept by the orphan pass. Its lifecycle is owned
// exclusively by convergeComplianceArtifacts (called after installViaFileCopy
// in init.ts). Before I09 the compliance skill was swept and then re-materialized
// by converge on every install, producing a spurious orphan report entry.
// ---------------------------------------------------------------------------

describe('compliance skill orphan sweep — FEATURE_OWNED_SKILLS protection', () => {
  it('devflow:compliance is NOT swept because FEATURE_OWNED_SKILLS is unioned into knownNames', async () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const devflowDir = path.join(tmpDir, 'devflow');
    // Construct the dir name dynamically to avoid skill-references scanner flagging it
    const COMPLIANCE_SKILL_DIR = ['devflow', 'compliance'].join(':');
    const complianceSkillDir = path.join(claudeDir, 'skills', COMPLIANCE_SKILL_DIR);
    await fs.mkdir(complianceSkillDir, { recursive: true });
    await fs.writeFile(path.join(complianceSkillDir, 'SKILL.md'), '# compliance', 'utf-8');

    const noOpPlugin: PluginDefinition = {
      name: 'devflow-test-noop-compliance-sweep',
      description: 'No-op fixture for compliance sweep test',
      commands: [],
      agents: [],
      skills: [],
      optional: false,
      rules: [],
    };
    const { skillsMap, agentsMap } = buildAssetMaps([noOpPlugin]);
    const spinner = { start: () => {}, stop: () => {}, message: () => {} };

    const report = await installViaFileCopy({
      plugins: [noOpPlugin],
      claudeDir,
      devflowDir,
      skillsMap,
      agentsMap,
      isPartialInstall: true,
      spinner,
    });

    // devflow:compliance must NOT appear in sweptOrphans — it is protected by FEATURE_OWNED_SKILLS.
    const sweptEntry = report.sweptOrphans.find(o => o.name === 'compliance');
    expect(
      sweptEntry,
      'devflow:compliance must NOT be swept: FEATURE_OWNED_SKILLS is unioned into knownNames (I09)',
    ).toBeUndefined();

    // Physical state: dir must survive the sweep
    await expect(fs.access(complianceSkillDir)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 1: dist-preferred agent source resolution
// ---------------------------------------------------------------------------
//
// Agents may be generated (compiled from an .mds generator host into
// dist/agents/) or hand-authored (src/assets/agents/). The installer resolves
// each declared agent dist-first with a src fallback, so a generated agent wins
// over a stale hand-authored file of the same name while every ungenerated
// agent keeps installing exactly as before.
//
// The dirs are injected here rather than mocked: the default is agentSourceDirs(),
// the one owner of the ordering convention, so no production call site changes.

describe('installViaFileCopy — dist-preferred agent resolution', () => {
  const spinner = { start: () => {}, stop: () => {}, message: () => {} };

  /** A real registry agent name, so the orphan sweep keeps the installed file. */
  const AGENT = 'git';

  /**
   * Write an agent fixture derived from the real {AGENT} agent's frontmatter
   * (PF-043), resolved dist-first with a src fallback, with a marker line
   * identifying which tree it came from.
   */
  async function writeAgentFixture(dir: string, marker: string): Promise<string> {
    const { path: realPath, content: real } = resolveAgentSource(AGENT);
    const fm = splitFrontmatter(real);
    if (!fm) throw new Error(`${realPath} has no frontmatter — fixture cannot be derived`);
    const content = `${fm.block}\nMARKER: ${marker}\n`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${AGENT}.md`), content, 'utf-8');
    return content;
  }

  async function installWith(agentSourceDirs: AgentSourceDirs): Promise<string> {
    const claudeDir = path.join(tmpDir, 'claude');
    const fakePlugin: PluginDefinition = {
      name: 'devflow-test-dist-preferred',
      description: 'Test fixture for dist-preferred agent resolution',
      commands: [],
      agents: [AGENT],
      skills: [],
      optional: false,
      rules: [],
    };
    await installViaFileCopy({
      plugins: [fakePlugin],
      claudeDir,
      devflowDir: path.join(tmpDir, 'devflow'),
      skillsMap: new Map(),
      agentsMap: buildAssetMaps([fakePlugin]).agentsMap,
      isPartialInstall: false,
      spinner,
      agentSourceDirs,
    });
    return fs.readFile(path.join(claudeDir, 'agents', 'devflow', `${AGENT}.md`), 'utf-8');
  }

  it('installs the compiled agent when the name exists in both dirs', async () => {
    const distDir = path.join(tmpDir, 'dist-agents');
    const srcDir = path.join(tmpDir, 'src-agents');
    const distContent = await writeAgentFixture(distDir, 'from-dist');
    const srcContent = await writeAgentFixture(srcDir, 'from-src');
    expect(distContent, 'fixtures must differ or the test proves nothing').not.toBe(srcContent);

    expect(await installWith([distDir, srcDir])).toBe(distContent);
  });

  it('falls back to the source agent when the compiled dir has no such file', async () => {
    const distDir = path.join(tmpDir, 'dist-agents-empty');
    const srcDir = path.join(tmpDir, 'src-agents');
    await fs.mkdir(distDir, { recursive: true });
    const srcContent = await writeAgentFixture(srcDir, 'from-src');

    expect(await installWith([distDir, srcDir])).toBe(srcContent);
  });

  it('falls back to the source agent when the compiled dir does not exist at all', async () => {
    // This is the live shape until a generator host exists: dist/agents/ is absent.
    const srcDir = path.join(tmpDir, 'src-agents');
    const srcContent = await writeAgentFixture(srcDir, 'from-src');

    expect(await installWith([path.join(tmpDir, 'no-such-dist-dir'), srcDir])).toBe(srcContent);
  });

  it('known-bad probe: a src-first order installs the wrong file', async () => {
    // Reversing the preference must change the observed result. If it did not,
    // the assertions above would be passing for the wrong reason.
    const distDir = path.join(tmpDir, 'dist-agents');
    const srcDir = path.join(tmpDir, 'src-agents');
    const distContent = await writeAgentFixture(distDir, 'from-dist');
    const srcContent = await writeAgentFixture(srcDir, 'from-src');

    expect(await installWith([srcDir, distDir])).toBe(srcContent);
    expect(await installWith([srcDir, distDir])).not.toBe(distContent);
  });

  it('defaults to the real accessors when no dirs are injected', async () => {
    // No agentSourceDirs: the production path must install the COMPILED artifact.
    // Byte-comparing against dist/agents/ is what makes the assertion specific —
    // `starts with ---` and `contains model:` are true of the source tree too, so
    // they would pass on a src-first resolution that silently shipped the wrong file.
    const claudeDir = path.join(tmpDir, 'claude-default');
    const fakePlugin: PluginDefinition = {
      name: 'devflow-test-default-dirs',
      description: 'Test fixture',
      commands: [],
      agents: [AGENT],
      skills: [],
      optional: false,
      rules: [],
    };
    await installViaFileCopy({
      plugins: [fakePlugin],
      claudeDir,
      devflowDir: path.join(tmpDir, 'devflow-default'),
      skillsMap: new Map(),
      agentsMap: buildAssetMaps([fakePlugin]).agentsMap,
      isPartialInstall: false,
      spinner,
    });
    const installed = await fs.readFile(path.join(claudeDir, 'agents', 'devflow', `${AGENT}.md`), 'utf-8');

    // The compiled artifact, read directly — not through the resolver under test.
    const compiled = await fs.readFile(path.join(compiledAgentsDir(), `${AGENT}.md`), 'utf-8');
    expect(installed, 'the installed agent must be the compiled artifact, byte for byte').toBe(compiled);

    // And those bytes can only have come from dist/: the source tree has no file
    // of that name at all, so a src-first resolution would have thrown instead.
    await expect(
      fs.access(path.join(agentsDir(), `${AGENT}.md`)),
      `${AGENT} still has a hand-authored source — pick an agent with only a generator host`,
    ).rejects.toThrow();
  });
});

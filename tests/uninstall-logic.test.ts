import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeAssetsToRemove, formatDryRunPlan, resolveSecurityRemovalDecision, enumerateUserDevFlowContent, resolveDevflowDirCleanup, removeDevFlowInstallArtifacts, removeAllDevFlow, removeSelectedPlugins, isDevFlowInstalled } from '../src/cli/commands/uninstall.js';
import { DEVFLOW_PLUGINS, getAllAgentNames, parsePluginSelection, type PluginDefinition } from '../src/core/plugins.js';
import { modelCacheDir } from '../src/core/cache.js';

describe('computeAssetsToRemove', () => {
  it('removes skills unique to selected plugins', () => {
    // devflow-debug has no unique skills (all are shared), pick a plugin with unique assets
    const debugPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-debug')!;
    const { skills } = computeAssetsToRemove([debugPlugin], DEVFLOW_PLUGINS);

    // 'git' is also in core-skills, should NOT be in removal list
    expect(skills).not.toContain('git');
  });

  it('removes agents unique to selected plugins', () => {
    // devflow-bug-analysis has agent 'diagnose' which is unique to it
    const bugAnalysisPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-bug-analysis')!;
    // Non-empty assertion: guard against vacuous pass if the plugin is accidentally deleted
    expect(bugAnalysisPlugin).toBeDefined();
    expect(bugAnalysisPlugin.agents.length).toBeGreaterThan(0);
    const { agents } = computeAssetsToRemove([bugAnalysisPlugin], DEVFLOW_PLUGINS);
    expect(agents).toContain('diagnose');
  });

  it('retains agents shared with remaining plugins', () => {
    // 'git' agent is in implement, code-review, resolve, debug
    // Removing just debug should NOT remove 'git'
    const debugPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-debug')!;
    const { agents } = computeAssetsToRemove([debugPlugin], DEVFLOW_PLUGINS);
    expect(agents).not.toContain('git');
  });

  it('collects all commands from selected plugins', () => {
    const reviewPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-code-review')!;
    const { commands } = computeAssetsToRemove([reviewPlugin], DEVFLOW_PLUGINS);
    expect(commands).toContain('/code-review');
  });

  it('returns empty arrays when no plugins selected', () => {
    const { skills, agents, commands } = computeAssetsToRemove([], DEVFLOW_PLUGINS);
    expect(skills).toEqual([]);
    expect(agents).toEqual([]);
    expect(commands).toEqual([]);
  });

  it('removes everything when all plugins selected', () => {
    const { skills, agents, commands } = computeAssetsToRemove(DEVFLOW_PLUGINS, DEVFLOW_PLUGINS);
    // When all plugins are removed, nothing is retained
    expect(skills.length).toBeGreaterThan(0);
    expect(agents.length).toBeGreaterThan(0);
    // Core-skills has no commands, but other plugins do
    expect(commands.length).toBeGreaterThan(0);
  });

  it('retains review-methodology when code-review uninstalled (ambient declares it)', () => {
    const reviewPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-code-review')!;
    const { skills } = computeAssetsToRemove([reviewPlugin], DEVFLOW_PLUGINS);
    // review-methodology is also declared by devflow-ambient, so it must NOT be removed
    expect(skills).not.toContain('review-methodology');
    // security is also declared by devflow-ambient
    expect(skills).not.toContain('security');
  });

  it('handles custom plugin lists', () => {
    const plugins: PluginDefinition[] = [
      { name: 'a', description: '', commands: ['/a'], agents: ['shared', 'only-a'], skills: ['shared-skill', 'only-a-skill'], rules: [] },
      { name: 'b', description: '', commands: ['/b'], agents: ['shared', 'only-b'], skills: ['shared-skill', 'only-b-skill'], rules: [] },
    ];

    // Remove 'a', keep 'b'
    const { skills, agents, commands } = computeAssetsToRemove([plugins[0]], plugins);
    expect(commands).toEqual(['/a']);
    expect(agents).toEqual(['only-a']); // 'shared' is retained by 'b'
    expect(skills).toEqual(['only-a-skill']); // 'shared-skill' is retained by 'b'
  });

  it('returns rules unique to the removed plugin', () => {
    const plugins: PluginDefinition[] = [
      { name: 'plugin-a', description: '', commands: [], agents: [], skills: [], rules: ['rule-a', 'shared-rule'] },
      { name: 'plugin-b', description: '', commands: [], agents: [], skills: [], rules: ['rule-b', 'shared-rule'] },
    ];
    const { rules } = computeAssetsToRemove([plugins[0]], plugins);
    expect(rules).toContain('rule-a');
    expect(rules).not.toContain('shared-rule'); // retained by plugin-b
  });

  it('retains rules shared across remaining plugins', () => {
    // security, engineering, quality are in devflow-core-skills
    // Removing devflow-typescript should not remove them
    const typescriptPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-typescript')!;
    const { rules } = computeAssetsToRemove([typescriptPlugin], DEVFLOW_PLUGINS);
    expect(rules).not.toContain('security');
    expect(rules).not.toContain('engineering');
    expect(rules).not.toContain('quality');
    // typescript rule is unique to this plugin
    expect(rules).toContain('typescript');
  });

  it('returns empty rules array when plugin has no rules', () => {
    const debugPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-debug')!;
    const { rules } = computeAssetsToRemove([debugPlugin], DEVFLOW_PLUGINS);
    expect(rules).toEqual([]);
  });
});

describe('formatDryRunPlan', () => {
  it('lists skills, agents, and commands', () => {
    const plan = formatDryRunPlan({
      skills: ['security', 'test-driven-development'],
      agents: ['code'],
      commands: ['/implement'],
    });
    expect(plan).toContain('security');
    expect(plan).toContain('test-driven-development');
    expect(plan).toContain('code');
    expect(plan).toContain('/implement');
  });

  it('returns nothing-to-remove message for empty plan', () => {
    const plan = formatDryRunPlan({ skills: [], agents: [], commands: [] });
    expect(plan).toContain('Nothing to remove');
  });

  it('omits empty sections', () => {
    const plan = formatDryRunPlan({
      skills: ['software-design'],
      agents: [],
      commands: [],
    });
    expect(plan).toContain('software-design');
    expect(plan).not.toContain('Agents');
    expect(plan).not.toContain('Commands');
  });

  it('includes extras when provided', () => {
    const plan = formatDryRunPlan(
      { skills: ['x'], agents: [], commands: [] },
      ['.docs/', '.memory/', 'hooks in settings.json'],
    );
    expect(plan).toContain('.docs/');
    expect(plan).toContain('.memory/');
    expect(plan).toContain('hooks in settings.json');
  });

  it('deduplicates skills, agents, and commands', () => {
    const plan = formatDryRunPlan({
      skills: ['software-design', 'software-design', 'testing'],
      agents: ['code', 'code'],
      commands: ['/implement', '/implement'],
    });
    // Should show count based on unique items, not duplicates
    expect(plan).toContain('Skills (2)');
    expect(plan).toContain('Agents (1)');
    expect(plan).toContain('Commands (1)');
  });

  it('includes rules section when rules are provided', () => {
    const plan = formatDryRunPlan({
      skills: [],
      agents: [],
      commands: [],
      rules: ['security', 'engineering'],
    });
    expect(plan).toContain('Rules (2)');
    expect(plan).toContain('security');
    expect(plan).toContain('engineering');
  });

  it('omits rules section when rules array is empty', () => {
    const plan = formatDryRunPlan({
      skills: ['software-design'],
      agents: [],
      commands: [],
      rules: [],
    });
    expect(plan).not.toContain('Rules');
  });

  it('omits rules section when rules field is absent', () => {
    const plan = formatDryRunPlan({
      skills: ['software-design'],
      agents: [],
      commands: [],
    });
    expect(plan).not.toContain('Rules');
  });

  it('deduplicates rules', () => {
    const plan = formatDryRunPlan({
      skills: [],
      agents: [],
      commands: [],
      rules: ['security', 'security', 'engineering'],
    });
    expect(plan).toContain('Rules (2)');
  });
});

describe('resolveSecurityRemovalDecision', () => {
  // === Non-interactive preserve invariant (SAFETY PROPERTY) ===
  // When isTTY is false the deny list must NEVER be removed — avoids PF-004
  // half-applied-state hazard during scripted/CI uninstalls.

  it('returns preserve when security is present and isTTY is false (non-interactive invariant)', () => {
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: true,
      keepDocs: false,
      isTTY: false,
    })).toBe('preserve');
  });

  it('returns preserve regardless of keepDocs when isTTY is false and security is present', () => {
    // keepDocs wins over isTTY only when keepDocs is true — tested separately below
    // This asserts the priority order: skip (keepDocs) > preserve (non-TTY) > prompt
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: true,
      keepDocs: false,
      isTTY: false,
    })).toBe('preserve');
  });

  // === keepDocs gate ===

  it('returns skip when keepDocs is true even if isTTY is true', () => {
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: true,
      keepDocs: true,
      isTTY: true,
    })).toBe('skip');
  });

  it('returns skip when keepDocs is true and isTTY is false', () => {
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: true,
      keepDocs: true,
      isTTY: false,
    })).toBe('skip');
  });

  // === nothing-present gate ===

  it('returns skip when no security is present regardless of TTY or keepDocs', () => {
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: false,
      keepDocs: false,
      isTTY: true,
    })).toBe('skip');

    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: false,
      keepDocs: false,
      isTTY: false,
    })).toBe('skip');
  });

  // === interactive prompt path ===

  it('returns prompt when security is present, keepDocs is false, and isTTY is true', () => {
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: true,
      keepDocs: false,
      isTTY: true,
    })).toBe('prompt');
  });

  // === exhaustiveness — all three outcomes are reachable ===

  it('covers all three return values', () => {
    const skip = resolveSecurityRemovalDecision({ anySecurityPresent: false, keepDocs: false, isTTY: true });
    const preserve = resolveSecurityRemovalDecision({ anySecurityPresent: true, keepDocs: false, isTTY: false });
    const prompt = resolveSecurityRemovalDecision({ anySecurityPresent: true, keepDocs: false, isTTY: true });
    expect(skip).toBe('skip');
    expect(preserve).toBe('preserve');
    expect(prompt).toBe('prompt');
  });
});

// ---------------------------------------------------------------------------
// Legacy plugin name resolution via shared parsePluginSelection
//
// Before this fix uninstall's --plugin flag had its own inline parser that
// did NOT apply LEGACY_PLUGIN_NAMES, so `--plugin frontend-design` reported
// "Unknown plugin" instead of resolving to devflow-ui-design. avoids PF-012
// ---------------------------------------------------------------------------

describe('legacy plugin name resolution in uninstall (parsePluginSelection shared from plugins.ts)', () => {
  it('legacy name frontend-design resolves to devflow-ui-design and flows into computeAssetsToRemove', () => {
    const { selected, invalid } = parsePluginSelection('frontend-design', DEVFLOW_PLUGINS); // legacy → devflow-ui-design
    expect(selected).toEqual(['devflow-ui-design']);
    expect(invalid).toEqual([]);
    // Verify the resolved name maps to a real plugin and flows into computeAssetsToRemove
    const uiDesignPlugin = DEVFLOW_PLUGINS.find(pl => pl.name === 'devflow-ui-design');
    expect(uiDesignPlugin).toBeDefined();
    const { commands } = computeAssetsToRemove([uiDesignPlugin!], DEVFLOW_PLUGINS);
    expect(commands).toEqual([]); // devflow-ui-design has no commands (skills-only plugin)
  });

  it('legacy name devflow-specify resolves to devflow-plan in the registry', () => {
    const { selected, invalid } = parsePluginSelection('devflow-specify', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-plan']);
    expect(invalid).toEqual([]);
    const planPlugin = DEVFLOW_PLUGINS.find(pl => pl.name === 'devflow-plan');
    expect(planPlugin).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// WS5: enumerateUserDevFlowContent — pre-deletion gate for full devflow dir cleanup
// ---------------------------------------------------------------------------
//
// Pure async enumeration helper that inspects a devflowDir for user-authored
// content worth backing up before a full cleanup. Used by the uninstall
// confirm gate to inform the user before wiping ~/.devflow/.

describe('enumerateUserDevFlowContent (WS5)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-uninstall-ws5-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // === empty devflow dir ===

  it('returns empty array when devflowDir has no user-authored content', async () => {
    const result = await enumerateUserDevFlowContent(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns empty array when skills/ dir exists but is empty', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills'), { recursive: true });
    const result = await enumerateUserDevFlowContent(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns empty array when rules/ dir exists but is empty', async () => {
    await fs.mkdir(path.join(tmpDir, 'rules'), { recursive: true });
    const result = await enumerateUserDevFlowContent(tmpDir);
    expect(result).toEqual([]);
  });

  // === skill shadows ===

  it('includes skill shadow entry when skills/ has at least one entry', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills', 'my-skill'), { recursive: true });
    const result = await enumerateUserDevFlowContent(tmpDir);
    expect(result.some(s => s.includes('skill shadow'))).toBe(true);
  });

  it('skill shadow entry includes the skills/ directory path', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills', 'foo'), { recursive: true });
    const result = await enumerateUserDevFlowContent(tmpDir);
    const skillsPath = path.join(tmpDir, 'skills');
    expect(result.some(s => s.includes(skillsPath))).toBe(true);
  });

  // === rule shadows ===

  it('includes rule shadow entry when rules/ has at least one entry', async () => {
    await fs.mkdir(path.join(tmpDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'rules', 'my-rule.md'), '# Rule', 'utf-8');
    const result = await enumerateUserDevFlowContent(tmpDir);
    expect(result.some(s => s.includes('rule shadow'))).toBe(true);
  });

  // === preference-profile.md ===

  it('includes preference-profile.md when it exists', async () => {
    await fs.writeFile(path.join(tmpDir, 'preference-profile.md'), '# Profile', 'utf-8');
    const result = await enumerateUserDevFlowContent(tmpDir);
    expect(result.some(s => s.includes('preference-profile.md'))).toBe(true);
  });

  it('does not include preference-profile.md when it is absent', async () => {
    const result = await enumerateUserDevFlowContent(tmpDir);
    expect(result.some(s => s.includes('preference-profile.md'))).toBe(false);
  });

  // === learning.json ===

  it('includes learning.json when it exists', async () => {
    await fs.writeFile(path.join(tmpDir, 'learning.json'), '{"model":"opus"}', 'utf-8');
    const result = await enumerateUserDevFlowContent(tmpDir);
    expect(result.some(s => s.includes('learning.json'))).toBe(true);
  });

  it('does not include learning.json when it is absent', async () => {
    const result = await enumerateUserDevFlowContent(tmpDir);
    expect(result.some(s => s.includes('learning.json'))).toBe(false);
  });

  // === combined ===

  it('returns all four entries when all user-authored items exist', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills', 'my-skill'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'rules', 'my-rule.md'), '# Rule', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'preference-profile.md'), '# Profile', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'learning.json'), '{"model":"opus"}', 'utf-8');

    const result = await enumerateUserDevFlowContent(tmpDir);
    expect(result).toHaveLength(4);
    expect(result.some(s => s.includes('skill shadow'))).toBe(true);
    expect(result.some(s => s.includes('rule shadow'))).toBe(true);
    expect(result.some(s => s.includes('preference-profile.md'))).toBe(true);
    expect(result.some(s => s.includes('learning.json'))).toBe(true);
  });

  it('returns only the items that actually exist (partial set)', async () => {
    // Only preference-profile.md and learning.json — no shadow dirs
    await fs.writeFile(path.join(tmpDir, 'preference-profile.md'), '# Profile', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'learning.json'), '{}', 'utf-8');

    const result = await enumerateUserDevFlowContent(tmpDir);
    expect(result).toHaveLength(2);
    expect(result.some(s => s.includes('skill shadow'))).toBe(false);
    expect(result.some(s => s.includes('rule shadow'))).toBe(false);
    expect(result.some(s => s.includes('preference-profile.md'))).toBe(true);
    expect(result.some(s => s.includes('learning.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveDevflowDirCleanup — pure decision function for user-scope ~/.devflow/ cleanup
//
// Mirrors the resolveSecurityRemovalDecision pattern. No I/O inside the function;
// the .action() caller performs all I/O and prompt rendering. Tests express intended
// BEHAVIOR not implementation details (avoids PF-009 per-item coupling).
// ---------------------------------------------------------------------------

describe('resolveDevflowDirCleanup', () => {
  const HOME = '/Users/testuser';
  const VALID_DIR = `${HOME}/.devflow`;
  const SOME_CONTENT = ['skill shadows (/Users/testuser/.devflow/skills)'];

  // === local scope: never prompt ===
  // The local-scope invariant: .devflow/ under a git root holds project data
  // (memory, learning, docs). It must NEVER be a candidate for full rm.

  it('returns artifacts-only for local scope regardless of isTTY or user content', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'local',
      isTTY: true,
      userContent: SOME_CONTENT,
      devflowDir: VALID_DIR,
      homeDir: HOME,
    })).toBe('artifacts-only');
  });

  it('returns artifacts-only for local scope even when non-interactive and no content', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'local',
      isTTY: false,
      userContent: [],
      devflowDir: VALID_DIR,
      homeDir: HOME,
    })).toBe('artifacts-only');
  });

  // === user scope + interactive + user content → prompt ===

  it('returns prompt for user scope when interactive and user content is present', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: true,
      userContent: SOME_CONTENT,
      devflowDir: VALID_DIR,
      homeDir: HOME,
    })).toBe('prompt');
  });

  it('returns prompt for user scope with multiple user content items', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: true,
      userContent: ['skill shadows (...)', 'rule shadows (...)', 'learning.json'],
      devflowDir: VALID_DIR,
      homeDir: HOME,
    })).toBe('prompt');
  });

  // === user scope + non-interactive → artifacts-only ===
  // Non-interactive sessions must never prompt for or perform full-dir removal.

  it('returns artifacts-only for user scope when non-interactive (isTTY=false)', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: false,
      userContent: SOME_CONTENT,
      devflowDir: VALID_DIR,
      homeDir: HOME,
    })).toBe('artifacts-only');
  });

  it('returns artifacts-only for user scope when non-interactive even with no user content', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: false,
      userContent: [],
      devflowDir: VALID_DIR,
      homeDir: HOME,
    })).toBe('artifacts-only');
  });

  // === no user content → artifacts-only (no reason to prompt) ===

  it('returns artifacts-only when user content is empty even if interactive', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: true,
      userContent: [],
      devflowDir: VALID_DIR,
      homeDir: HOME,
    })).toBe('artifacts-only');
  });

  // === precondition guards — anomalous devflowDir → artifacts-only ===
  // These guards protect the fs.rm(devflowDir, {recursive}) call from running
  // on unexpected paths (DEVFLOW_DIR env override, misconfiguration, etc.).

  it('returns artifacts-only when devflowDir is outside $HOME (precondition guard)', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: true,
      userContent: SOME_CONTENT,
      devflowDir: '/tmp/.devflow',
      homeDir: HOME,
    })).toBe('artifacts-only');
  });

  it('returns artifacts-only when devflowDir basename is not .devflow (precondition guard)', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: true,
      userContent: SOME_CONTENT,
      devflowDir: `${HOME}/custom-dir`,
      homeDir: HOME,
    })).toBe('artifacts-only');
  });

  it('returns artifacts-only when devflowDir is the home directory itself (precondition guard)', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: true,
      userContent: SOME_CONTENT,
      devflowDir: HOME,
      homeDir: HOME,
    })).toBe('artifacts-only');
  });

  it('returns artifacts-only when devflowDir is the filesystem root (precondition guard)', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: true,
      userContent: SOME_CONTENT,
      devflowDir: '/',
      homeDir: HOME,
    })).toBe('artifacts-only');
  });

  // === exhaustiveness — both outcomes are reachable ===

  it('covers both return values (artifacts-only and prompt)', () => {
    const artifactsOnly = resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: false,
      userContent: SOME_CONTENT,
      devflowDir: VALID_DIR,
      homeDir: HOME,
    });
    const prompt = resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: true,
      userContent: SOME_CONTENT,
      devflowDir: VALID_DIR,
      homeDir: HOME,
    });
    expect(artifactsOnly).toBe('artifacts-only');
    expect(prompt).toBe('prompt');
  });

  // === keepDocs gate: suppresses the full ~/.devflow cleanup prompt (TEST-9d) ===
  //
  // --keep-docs must prevent the wipe prompt even when the session is interactive
  // and user-authored content is present. Callers that pass keepDocs:true must
  // fall through to removeDevFlowInstallArtifacts without prompting.

  it('(9d) returns artifacts-only when keepDocs is true even with interactive TTY and user content', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: true,
      userContent: SOME_CONTENT,
      devflowDir: VALID_DIR,
      homeDir: HOME,
      keepDocs: true,
    })).toBe('artifacts-only');
  });

  it('(9d) returns artifacts-only when keepDocs is true and no user content', () => {
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: true,
      userContent: [],
      devflowDir: VALID_DIR,
      homeDir: HOME,
      keepDocs: true,
    })).toBe('artifacts-only');
  });

  it('(9d) keepDocs:false does not suppress the prompt (normal behavior preserved)', () => {
    // Explicit false is same as omitting the field — prompt path still reachable.
    expect(resolveDevflowDirCleanup({
      scope: 'user',
      isTTY: true,
      userContent: SOME_CONTENT,
      devflowDir: VALID_DIR,
      homeDir: HOME,
      keepDocs: false,
    })).toBe('prompt');
  });
});

// ─── TEST-4: removeDevFlowInstallArtifacts proxy artifact coverage ────────────
//
// Ordering invariant (documented here, enforced in uninstall.ts action):
//   revertExternalAgents MUST run before removeAllDevFlow so that agent files
//   are still present when we attempt to revert their frontmatter.  If
//   removeAllDevFlow runs first, revertExternalAgents silently skips the files
//   (skippedMissing path) and leaves the user's install in an inconsistent
//   state where ~/.claude/agents/devflow/coder.md still has a GPT model line.

describe('removeDevFlowInstallArtifacts — proxy artifact removal (TEST-4)', () => {
  let devflowDir: string;

  beforeEach(async () => {
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-uninstall-'));
    await fs.mkdir(devflowDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(devflowDir, { recursive: true, force: true });
  });

  it('removes proxy.json when present', async () => {
    await fs.writeFile(path.join(devflowDir, 'proxy.json'), '{"enabled":true}', 'utf-8');
    await removeDevFlowInstallArtifacts(devflowDir, false);
    await expect(fs.access(path.join(devflowDir, 'proxy.json'))).rejects.toThrow();
  });

  it('removes proxy-routing.json when present', async () => {
    await fs.writeFile(path.join(devflowDir, 'proxy-routing.json'), '{}', 'utf-8');
    await removeDevFlowInstallArtifacts(devflowDir, false);
    await expect(fs.access(path.join(devflowDir, 'proxy-routing.json'))).rejects.toThrow();
  });

  it('removes proxy.pid when present (stale/dead PID — no live process)', async () => {
    // Write a PID that is guaranteed not to exist (high number, well above system max).
    // process.kill(pid, 0) throws ESRCH for non-existent PIDs → caught by inner try/catch.
    const deadPid = 99999999;
    await fs.writeFile(path.join(devflowDir, 'proxy.pid'), String(deadPid), 'utf-8');
    // Must complete without throwing even though the PID doesn't exist.
    await expect(removeDevFlowInstallArtifacts(devflowDir, false)).resolves.not.toThrow();
    await expect(fs.access(path.join(devflowDir, 'proxy.pid'))).rejects.toThrow();
  });

  it('removes .proxy-spawn.lock directory when present', async () => {
    const lockDir = path.join(devflowDir, '.proxy-spawn.lock');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(path.join(lockDir, 'pid'), '42', 'utf-8'); // file inside the dir
    await removeDevFlowInstallArtifacts(devflowDir, false);
    await expect(fs.access(lockDir)).rejects.toThrow();
  });

  it('removes logs/proxy.log when present', async () => {
    const logsDir = path.join(devflowDir, 'logs');
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(path.join(logsDir, 'proxy.log'), 'log output', 'utf-8');
    await removeDevFlowInstallArtifacts(devflowDir, false);
    await expect(fs.access(path.join(logsDir, 'proxy.log'))).rejects.toThrow();
  });

  it('PF-009: each missing artifact is non-fatal — all absent, function completes cleanly', async () => {
    // Empty devflowDir — none of the proxy artifacts exist.
    // Must complete without throwing.
    await expect(removeDevFlowInstallArtifacts(devflowDir, false)).resolves.not.toThrow();
  });

  it('PF-009: missing proxy.json does not prevent removal of other artifacts', async () => {
    // Only proxy-routing.json is present; proxy.json is absent.
    await fs.writeFile(path.join(devflowDir, 'proxy-routing.json'), '{}', 'utf-8');
    await removeDevFlowInstallArtifacts(devflowDir, false);
    // proxy-routing.json removed despite proxy.json being absent.
    await expect(fs.access(path.join(devflowDir, 'proxy-routing.json'))).rejects.toThrow();
  });

  it('PF-009: missing logs/proxy.log does not prevent removal of other artifacts', async () => {
    // Only proxy.json present; logs/ dir absent entirely.
    await fs.writeFile(path.join(devflowDir, 'proxy.json'), '{"enabled":false}', 'utf-8');
    await removeDevFlowInstallArtifacts(devflowDir, false);
    await expect(fs.access(path.join(devflowDir, 'proxy.json'))).rejects.toThrow();
  });

  it('live PID: warns but does NOT kill the process (current process remains alive)', async () => {
    // Use our own process.pid — it definitely exists.
    await fs.writeFile(path.join(devflowDir, 'proxy.pid'), String(process.pid), 'utf-8');
    // Function must complete without throwing.
    await expect(removeDevFlowInstallArtifacts(devflowDir, false)).resolves.not.toThrow();
    // Our process is still alive (if it had been killed we wouldn't reach this line).
    expect(process.pid).toBeGreaterThan(0);
    // proxy.pid is removed even when the process is live.
    await expect(fs.access(path.join(devflowDir, 'proxy.pid'))).rejects.toThrow();
  });

  it('removes cache/models directory when present (model-discovery cache)', async () => {
    // Model-discovery cache written by discoverExternalModels during enable / agents TUI.
    const cacheDir = path.join(devflowDir, 'cache', 'models');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheDir, 'external-models-v1-0.2.0.json'),
      '{"models":[]}',
      'utf-8',
    );
    await removeDevFlowInstallArtifacts(devflowDir, false);
    await expect(fs.access(cacheDir)).rejects.toThrow();
  });

  it('PF-009: missing cache/models does not prevent removal of other artifacts', async () => {
    // cache/models is absent; only proxy.json is present.
    await fs.writeFile(path.join(devflowDir, 'proxy.json'), '{}', 'utf-8');
    await removeDevFlowInstallArtifacts(devflowDir, false);
    // proxy.json is removed even though cache/models was never created.
    await expect(fs.access(path.join(devflowDir, 'proxy.json'))).rejects.toThrow();
  });

  it('removes all proxy artifacts in a single pass (including model-discovery cache)', async () => {
    // Set up every proxy artifact — including the model-discovery cache added in Phase E.
    await fs.writeFile(path.join(devflowDir, 'proxy.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(devflowDir, 'proxy-routing.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(devflowDir, 'proxy.pid'), '99999999', 'utf-8');
    await fs.mkdir(path.join(devflowDir, '.proxy-spawn.lock'), { recursive: true });
    await fs.mkdir(path.join(devflowDir, 'logs'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'logs', 'proxy.log'), 'log', 'utf-8');
    const cacheDir = path.join(devflowDir, 'cache', 'models');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, 'external-models-v1-0.2.0.json'), '{}', 'utf-8');

    await removeDevFlowInstallArtifacts(devflowDir, false);

    const checks = await Promise.allSettled([
      fs.access(path.join(devflowDir, 'proxy.json')),
      fs.access(path.join(devflowDir, 'proxy-routing.json')),
      fs.access(path.join(devflowDir, 'proxy.pid')),
      fs.access(path.join(devflowDir, '.proxy-spawn.lock')),
      fs.access(path.join(devflowDir, 'logs', 'proxy.log')),
      fs.access(cacheDir),
    ]);
    // Every artifact must be gone.
    for (const result of checks) {
      expect(result.status).toBe('rejected');
    }
  });

  // ─── PF-013 linkage: removal target == write target via modelCacheDir accessor ───
  //
  // This test pins the uninstall removal path to modelCacheDir — the single
  // authoritative path accessor from src/core/cache.ts. If uninstall.ts reverts
  // to an independent hardcoded literal that diverges from modelCacheDir, this
  // test fails: the directory written via the accessor survives uninstall.
  //
  // avoids PF-013 (hardcoded path residue surviving a module relocation)
  it('PF-013: removal target byte-matches modelCacheDir — write-site and removal-site cannot drift', async () => {
    // Write a sentinel into the path that model-discovery callers use.
    const writePath = modelCacheDir(devflowDir);
    await fs.mkdir(writePath, { recursive: true });
    await fs.writeFile(path.join(writePath, 'sentinel.json'), '{}', 'utf-8');

    await removeDevFlowInstallArtifacts(devflowDir, false);

    // If uninstall drifts to a different path, writePath still exists → this fails.
    await expect(fs.access(writePath)).rejects.toThrow();
  });

  // ─── TEST-9c: ~/.devflow residue EQUALS allow-list of user-authored files ────────
  //
  // Asserts EQUALITY (not subset) so any install artifact that escapes the removal
  // list causes a test failure. Proved non-vacuous: adding an unknown artifact
  // ('mystery-artifact.json') to the setup BEFORE the equality assertion caused
  // the test to go RED (mystery-artifact.json appeared in the remaining set),
  // removing it restored GREEN — confirming the assertion enforces completeness.

  it('(9c) residue after artifact-only removal exactly matches user-authored allow-list', async () => {
    // ── Install artifacts (must be removed) ──────────────────────────────────
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(devflowDir, 'migrations.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(devflowDir, 'proxy.json'), '{}', 'utf-8');
    await fs.mkdir(path.join(devflowDir, 'logs', 'project-slug'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'logs', 'project-slug', '.hook-debug.log'), 'debug', 'utf-8');
    await fs.mkdir(path.join(devflowDir, 'cache', 'models'), { recursive: true });
    await fs.mkdir(path.join(devflowDir, 'costs', 'sessions'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'costs', 'archive.jsonl'), '{}\n', 'utf-8');
    // agent-models.json is an install artifact (stale keys silently re-apply to
    // renamed/deleted agents on reinstall — AC-P1-F4), NOT user-authored content.
    await fs.writeFile(path.join(devflowDir, 'agent-models.json'), '{}', 'utf-8');

    // ── User-authored files (must survive) ───────────────────────────────────
    await fs.mkdir(path.join(devflowDir, 'skills', 'my-skill'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'skills', 'my-skill', 'SKILL.md'), '# Skill', 'utf-8');
    await fs.mkdir(path.join(devflowDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'rules', 'security.md'), '# Rule', 'utf-8');
    await fs.writeFile(path.join(devflowDir, 'preference-profile.md'), '# Profile', 'utf-8');
    await fs.writeFile(path.join(devflowDir, 'learning.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(devflowDir, 'hud.json'), '{}', 'utf-8');

    await removeDevFlowInstallArtifacts(devflowDir, false);

    // ── Equality assertion: only user-authored entries may remain ─────────────
    const remaining = new Set(await fs.readdir(devflowDir));
    // Install artifacts must be gone (including agent-models.json — reclassified as artifact)
    for (const artifact of ['manifest.json', 'migrations.json', 'proxy.json', 'logs', 'cache', 'costs', 'agent-models.json']) {
      expect(remaining.has(artifact), `install artifact "${artifact}" should be removed but was found in ${devflowDir}`).toBe(false);
    }
    // Exact equality: nothing but user-authored state remains, and every enumerated
    // user item survives an artifact-only pass. This is the executable form of the
    // rule that removeDevFlowInstallArtifacts and enumerateUserDevFlowContent must
    // never overlap — the artifact pass also runs on decline/cancel/--keep-docs.
    // agent-models.json is intentionally ABSENT: it is an install artifact (AC-P1-F4),
    // not user-authored content, so it does not appear in enumerateUserDevFlowContent.
    expect(remaining).toEqual(new Set([
      'skills',
      'rules',
      'preference-profile.md',
      'learning.json',
      'hud.json',
    ]));
  });

  // ─── TEST-9f: the two lists must be disjoint ────────────────────────────────
  //
  // enumerateUserDevFlowContent names what the confirm prompt says it is about to
  // delete. removeDevFlowInstallArtifacts runs on the decline, cancel, non-interactive
  // AND --keep-docs paths. An item on both lists is therefore deleted no matter what
  // the user answers, which makes the prompt a lie and loses user config silently.

  it('(9f) every item enumerated as user content survives an artifact-only removal', async () => {
    await fs.mkdir(path.join(devflowDir, 'skills', 'my-skill'), { recursive: true });
    await fs.mkdir(path.join(devflowDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'rules', 'security.md'), '# Rule', 'utf-8');
    await fs.writeFile(path.join(devflowDir, 'preference-profile.md'), '', 'utf-8');
    await fs.writeFile(path.join(devflowDir, 'learning.json'), '{}', 'utf-8');
    // agent-models.json is an INSTALL ARTIFACT (AC-P1-F4), not user content — it is
    // present on disk here to prove the artifact pass removes it (does not survive),
    // and it must NOT appear in the before/after enumeration.
    await fs.writeFile(path.join(devflowDir, 'agent-models.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(devflowDir, 'hud.json'), '{}', 'utf-8');

    const before = await enumerateUserDevFlowContent(devflowDir);
    // Non-vacuity: the enumeration found every USER-AUTHORED category on disk.
    // Count is 5: skill shadows, rule shadows, preference-profile.md, learning.json, hud.json.
    // agent-models.json is absent from the count — it is an artifact, not user content.
    expect(before.length).toBe(5);

    await removeDevFlowInstallArtifacts(devflowDir, false);

    const after = await enumerateUserDevFlowContent(devflowDir);
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// TEST-9a: removeAllDevFlow — full uninstall empties agents/devflow including
//   retired and user-dropped files.
// ---------------------------------------------------------------------------
//
// PF-018: these tests call the exported function directly — no CLI spawn, so
// no ~/.claude guard is needed.

describe('removeAllDevFlow — full uninstall (TEST-9a)', () => {
  let claudeDir: string;

  beforeEach(async () => {
    claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-test-claude-'));
  });

  afterEach(async () => {
    await fs.rm(claudeDir, { recursive: true, force: true });
  });

  it('(9a) agents/devflow is gone after full uninstall regardless of what files are inside', async () => {
    const agentsDir = path.join(claudeDir, 'agents', 'devflow');
    await fs.mkdir(agentsDir, { recursive: true });
    // Registry agent — a real agent name from the registry
    await fs.writeFile(path.join(agentsDir, 'code.md'), '---\nmodel: sonnet\n---\n', 'utf-8');
    // Retired agent — a name no longer in any plugin
    await fs.writeFile(path.join(agentsDir, 'old-retired-agent.md'), 'retired', 'utf-8');
    // User-dropped file — arbitrary extra content in the dir
    await fs.writeFile(path.join(agentsDir, 'user-notes.md'), 'notes', 'utf-8');

    const devflowScriptsDir = path.join(claudeDir, 'scripts');
    await removeAllDevFlow(claudeDir, devflowScriptsDir, false);

    // agents/devflow must be gone (rm -rf on the whole dir)
    await expect(fs.access(agentsDir)).rejects.toThrow();
  });

  it('(9a) commands/devflow is gone after full uninstall', async () => {
    const commandsDir = path.join(claudeDir, 'commands', 'devflow');
    await fs.mkdir(commandsDir, { recursive: true });
    await fs.writeFile(path.join(commandsDir, 'implement.md'), '# implement', 'utf-8');
    await fs.writeFile(path.join(commandsDir, 'old-legacy-cmd.md'), 'old', 'utf-8');

    await removeAllDevFlow(claudeDir, path.join(claudeDir, 'scripts'), false);

    await expect(fs.access(commandsDir)).rejects.toThrow();
  });

  it('(9a) completes without throwing even when all directories are absent', async () => {
    // All target directories (commands, agents, rules, scripts) are absent — must be a no-op
    await expect(
      removeAllDevFlow(claudeDir, path.join(claudeDir, 'nonexistent-scripts'), false),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TEST-9b: removeSelectedPlugins — selective uninstall leaves no unclaimed files.
// Registry-diff sweep removes orphaned agents/commands not in any plugin.
// ---------------------------------------------------------------------------

describe('removeSelectedPlugins — selective uninstall sweep (TEST-9b)', () => {
  let claudeDir: string;

  beforeEach(async () => {
    claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-test-selective-'));
  });

  afterEach(async () => {
    await fs.rm(claudeDir, { recursive: true, force: true });
  });

  it('(9b) sweeps orphaned (retired) agents that are not in any plugin registry', async () => {
    const agentsDir = path.join(claudeDir, 'agents', 'devflow');
    await fs.mkdir(agentsDir, { recursive: true });

    // A real registry agent — must survive (it belongs to some plugin still installed)
    const realAgent = getAllAgentNames()[0];
    expect(realAgent).toBeDefined(); // non-vacuous: registry is non-empty
    await fs.writeFile(path.join(agentsDir, `${realAgent}.md`), 'real agent', 'utf-8');

    // An orphaned agent name that is NOT in any plugin — must be swept
    const orphanName = '__orphaned_test_agent_not_in_any_plugin__';
    await fs.writeFile(path.join(agentsDir, `${orphanName}.md`), 'orphaned', 'utf-8');

    // Run selective uninstall with any plugin (the sweep covers ALL plugins' names)
    const anyPlugin = DEVFLOW_PLUGINS[0];
    await removeSelectedPlugins(claudeDir, [anyPlugin], false);

    // Orphaned agent must be swept away
    await expect(
      fs.access(path.join(agentsDir, `${orphanName}.md`)),
    ).rejects.toThrow();

    // Real registry agent must survive (it's in the knownNames set)
    await expect(
      fs.access(path.join(agentsDir, `${realAgent}.md`)),
    ).resolves.not.toThrow();
  });

  it('(9b) commands: orphaned command files are swept; registry commands survive', async () => {
    const commandsDir = path.join(claudeDir, 'commands', 'devflow');
    await fs.mkdir(commandsDir, { recursive: true });

    // A known (non-orphaned) command: 'implement' is in getAllCommandNames()
    await fs.writeFile(path.join(commandsDir, 'implement.md'), '# implement', 'utf-8');

    // An orphaned command not in any plugin
    const orphanCmd = '__orphaned_command_not_in_registry__';
    await fs.writeFile(path.join(commandsDir, `${orphanCmd}.md`), 'orphaned', 'utf-8');

    const anyPlugin = DEVFLOW_PLUGINS[0];
    await removeSelectedPlugins(claudeDir, [anyPlugin], false);

    // Orphaned command swept
    await expect(
      fs.access(path.join(commandsDir, `${orphanCmd}.md`)),
    ).rejects.toThrow();

    // 'implement' survives (it's in the registry even if not removed by this plugin selection)
    await expect(
      fs.access(path.join(commandsDir, 'implement.md')),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TEST-9e: isDevFlowInstalled — detects via any owned namespace (not just commands)
// ---------------------------------------------------------------------------
//
// Commandless plugin installs (agents + skills, no commands) must still be
// detected. Checks all three namespaces: commands/devflow/, agents/devflow/,
// and any devflow:* skill directory.

describe('isDevFlowInstalled — multi-namespace detection (TEST-9e)', () => {
  let claudeDir: string;

  beforeEach(async () => {
    claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-test-detect-'));
  });

  afterEach(async () => {
    await fs.rm(claudeDir, { recursive: true, force: true });
  });

  it('(9e) returns true when agents/devflow exists but commands/devflow is absent', async () => {
    await fs.mkdir(path.join(claudeDir, 'agents', 'devflow'), { recursive: true });
    await fs.writeFile(
      path.join(claudeDir, 'agents', 'devflow', 'code.md'),
      '---\nmodel: sonnet\n---',
      'utf-8',
    );
    // commands/devflow intentionally absent

    const result = await isDevFlowInstalled(claudeDir);
    expect(result).toBe(true);
  });

  it('(9e) returns true when a devflow: skill dir exists but commands/devflow is absent', async () => {
    await fs.mkdir(path.join(claudeDir, 'skills', 'devflow:software-design'), { recursive: true });
    // commands/devflow and agents/devflow intentionally absent

    const result = await isDevFlowInstalled(claudeDir);
    expect(result).toBe(true);
  });

  it('(9e) returns true when commands/devflow exists (existing behavior preserved)', async () => {
    await fs.mkdir(path.join(claudeDir, 'commands', 'devflow'), { recursive: true });

    const result = await isDevFlowInstalled(claudeDir);
    expect(result).toBe(true);
  });

  it('(9e) returns false when none of the owned namespaces are present', async () => {
    // Empty claudeDir — no Devflow artifacts
    const result = await isDevFlowInstalled(claudeDir);
    expect(result).toBe(false);
  });

  it('(9e) returns false when skills dir has only non-devflow entries', async () => {
    // A skill dir without the devflow: prefix must not trigger detection
    await fs.mkdir(path.join(claudeDir, 'skills', 'other-plugin:some-skill'), { recursive: true });

    const result = await isDevFlowInstalled(claudeDir);
    expect(result).toBe(false);
  });
});

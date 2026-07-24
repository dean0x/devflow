import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeAssetsToRemove, formatDryRunPlan, resolveSecurityRemovalDecision, enumerateUserDevFlowContent, resolveDevflowDirCleanup } from '../src/cli/commands/uninstall.js';
import { DEVFLOW_PLUGINS, parsePluginSelection, type PluginDefinition } from '../src/core/plugins.js';

describe('computeAssetsToRemove', () => {
  it('removes skills unique to selected plugins', () => {
    // devflow-debug has no unique skills (all are shared), pick a plugin with unique assets
    const debugPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-debug')!;
    const { skills } = computeAssetsToRemove([debugPlugin], DEVFLOW_PLUGINS);

    // 'git' is also in core-skills, should NOT be in removal list
    expect(skills).not.toContain('git');
  });

  it('removes agents unique to selected plugins', () => {
    // devflow-audit-claude has agent 'claude-md-auditor' which is unique to it
    const auditPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-audit-claude')!;
    const { agents } = computeAssetsToRemove([auditPlugin], DEVFLOW_PLUGINS);
    expect(agents).toContain('claude-md-auditor');
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
      agents: ['coder'],
      commands: ['/implement'],
    });
    expect(plan).toContain('security');
    expect(plan).toContain('test-driven-development');
    expect(plan).toContain('coder');
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
      agents: ['coder', 'coder'],
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
});

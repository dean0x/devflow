import { describe, it, expect } from 'vitest';
import {
  DEVFLOW_PLUGINS,
  getAllSkillNames,
  getAllAgentNames,
  buildAssetMaps,
  buildFullSkillsMap,
  partitionSelectablePlugins,
  prefixSkillName,
  WORKFLOW_ORDER,
  SHADOW_RENAMES,
  LEGACY_SKILL_NAMES,
  LEGACY_AGENT_NAMES,
  type PluginDefinition,
} from '../src/cli/plugins.js';

describe('getAllSkillNames', () => {
  it('returns a deduplicated list of skills across all plugins', () => {
    const skills = getAllSkillNames();
    expect(skills.length).toBeGreaterThan(0);
    expect(new Set(skills).size).toBe(skills.length);
  });

  it('includes skills from multiple plugins', () => {
    const skills = getAllSkillNames();
    // 'accessibility' appears in devflow-accessibility (optional plugin)
    expect(skills).toContain('accessibility');
    // 'worktree-support' appears in multiple plugins
    expect(skills).toContain('worktree-support');
  });
});

describe('getAllAgentNames', () => {
  it('returns a deduplicated list of agents across all plugins', () => {
    const agents = getAllAgentNames();
    expect(agents.length).toBeGreaterThan(0);
    expect(new Set(agents).size).toBe(agents.length);
  });

  it('includes agents from multiple plugins', () => {
    const agents = getAllAgentNames();
    // 'git' appears in implement, code-review, resolve, debug
    expect(agents).toContain('git');
    expect(agents).toContain('synthesizer');
  });
});

describe('buildAssetMaps', () => {
  it('assigns each asset to the first plugin that declares it', () => {
    const { skillsMap, agentsMap } = buildAssetMaps(DEVFLOW_PLUGINS);

    // 'accessibility' first appears in devflow-accessibility (optional plugin)
    expect(skillsMap.get('accessibility')).toBe('devflow-accessibility');

    // 'git' first appears in devflow-plan (inserted before devflow-implement)
    expect(agentsMap.get('git')).toBe('devflow-plan');

    // 'synthesizer' first appears in devflow-plan
    expect(agentsMap.get('synthesizer')).toBe('devflow-plan');
  });

  it('returns empty maps for empty input', () => {
    const { skillsMap, agentsMap } = buildAssetMaps([]);
    expect(skillsMap.size).toBe(0);
    expect(agentsMap.size).toBe(0);
  });

  it('handles a single plugin', () => {
    const single: PluginDefinition[] = [{
      name: 'test-plugin',
      description: 'Test',
      commands: [],
      agents: ['agent-a'],
      skills: ['skill-a', 'skill-b'],
    }];
    const { skillsMap, agentsMap } = buildAssetMaps(single);
    expect(skillsMap.size).toBe(2);
    expect(agentsMap.size).toBe(1);
    expect(skillsMap.get('skill-a')).toBe('test-plugin');
    expect(agentsMap.get('agent-a')).toBe('test-plugin');
  });

  it('deduplicates overlapping skills/agents (first plugin wins)', () => {
    const plugins: PluginDefinition[] = [
      { name: 'first', description: '', commands: [], agents: ['shared-agent'], skills: ['shared-skill'] },
      { name: 'second', description: '', commands: [], agents: ['shared-agent'], skills: ['shared-skill'] },
    ];
    const { skillsMap, agentsMap } = buildAssetMaps(plugins);
    expect(skillsMap.get('shared-skill')).toBe('first');
    expect(agentsMap.get('shared-agent')).toBe('first');
    expect(skillsMap.size).toBe(1);
    expect(agentsMap.size).toBe(1);
  });
});

describe('buildFullSkillsMap', () => {
  it('includes skills from ALL plugins regardless of selection', () => {
    const fullMap = buildFullSkillsMap();
    // Must include skills from optional plugins too
    expect(fullMap.has('accessibility')).toBe(true);
    expect(fullMap.has('typescript')).toBe(true);
    expect(fullMap.has('go')).toBe(true);
    // Must include shared skills from core plugins
    expect(fullMap.has('review-methodology')).toBe(true);
    expect(fullMap.has('patterns')).toBe(true);
    expect(fullMap.has('worktree-support')).toBe(true);
  });

  it('covers more skills than buildAssetMaps with only non-optional plugins', () => {
    const nonOptional = DEVFLOW_PLUGINS.filter(p => !p.optional);
    const { skillsMap: partialMap } = buildAssetMaps(nonOptional);
    const fullMap = buildFullSkillsMap();
    expect(fullMap.size).toBeGreaterThan(partialMap.size);
  });

  it('matches getAllSkillNames count', () => {
    const fullMap = buildFullSkillsMap();
    const allNames = getAllSkillNames();
    expect(fullMap.size).toBe(allNames.length);
  });
});

describe('DEVFLOW_PLUGINS integrity', () => {
  it('has no duplicate plugin names', () => {
    const names = DEVFLOW_PLUGINS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all plugins have required fields', () => {
    for (const plugin of DEVFLOW_PLUGINS) {
      expect(plugin.name).toBeTruthy();
      expect(typeof plugin.name).toBe('string');
      expect(plugin.description).toBeTruthy();
      expect(typeof plugin.description).toBe('string');
      expect(Array.isArray(plugin.commands)).toBe(true);
      expect(Array.isArray(plugin.agents)).toBe(true);
      expect(Array.isArray(plugin.skills)).toBe(true);
    }
  });

  it('all skill and agent names are non-empty strings', () => {
    for (const plugin of DEVFLOW_PLUGINS) {
      for (const skill of plugin.skills) {
        expect(typeof skill).toBe('string');
        expect(skill.length).toBeGreaterThan(0);
      }
      for (const agent of plugin.agents) {
        expect(typeof agent).toBe('string');
        expect(agent.length).toBeGreaterThan(0);
      }
    }
  });

  it('has at least 8 plugins', () => {
    expect(DEVFLOW_PLUGINS.length).toBeGreaterThanOrEqual(8);
  });
});

describe('optional plugin flag', () => {
  const languagePluginNames = [
    'devflow-typescript',
    'devflow-react',
    'devflow-accessibility',
    'devflow-ui-design',
    'devflow-go',
    'devflow-java',
    'devflow-python',
    'devflow-rust',
  ];

  it('all language/ecosystem plugins have optional: true', () => {
    for (const name of languagePluginNames) {
      const plugin = DEVFLOW_PLUGINS.find(p => p.name === name);
      expect(plugin, `${name} should exist`).toBeDefined();
      expect(plugin!.optional, `${name} should be optional`).toBe(true);
    }
  });

  it('non-language plugins do not have optional: true (except audit-claude)', () => {
    const allowedOptional = new Set([...languagePluginNames, 'devflow-audit-claude']);
    for (const plugin of DEVFLOW_PLUGINS) {
      if (!allowedOptional.has(plugin.name)) {
        expect(plugin.optional, `${plugin.name} should not be optional`).toBeFalsy();
      }
    }
  });

  it('new language skills exist in the registry', () => {
    const skills = getAllSkillNames();
    for (const lang of ['go', 'java', 'python', 'rust']) {
      expect(skills, `skill '${lang}' should exist`).toContain(lang);
    }
  });

  it('audit-claude is excluded from init multiselect choices', () => {
    // partitionSelectablePlugins excludes devflow-audit-claude from both buckets
    const { workflow, language } = partitionSelectablePlugins(DEVFLOW_PLUGINS);
    const selectableNames = [...workflow, ...language].map(pl => pl.name);
    expect(selectableNames).not.toContain('devflow-audit-claude');
    // But it still exists in the registry (installable via --plugin=audit-claude)
    expect(DEVFLOW_PLUGINS.find(p => p.name === 'devflow-audit-claude')).toBeDefined();
  });

  it('devflow-ambient declares review/resolve skill dependencies', () => {
    const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
    expect(ambient).toBeDefined();
    // Ambient must declare review skills so uninstalling code-review doesn't break ambient review
    expect(ambient!.skills).toContain('review-methodology');
    expect(ambient!.skills).toContain('security');
    // Ambient must declare resolve dependencies
    expect(ambient!.skills).toContain('patterns');
    // decisions-format removed per D9 — format-spec only, not plugin-distributed
    // Ambient must declare all needed agents
    expect(ambient!.agents).toContain('git');
    expect(ambient!.agents).toContain('synthesizer');
    expect(ambient!.agents).toContain('resolver');
  });

  it('devflow-implement declares evaluator and tester agents and qa skill', () => {
    const implement = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-implement');
    expect(implement).toBeDefined();
    // evaluator and tester are declared so uninstalling ambient doesn't break implement
    expect(implement!.agents).toContain('evaluator');
    expect(implement!.agents).toContain('tester');
    // qa skill is required for the tester agent
    expect(implement!.skills).toContain('qa');
  });

  it('devflow-ambient declares evaluator, tester agents and qa skill', () => {
    const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
    expect(ambient).toBeDefined();
    // Ambient orchestrates the full implement pipeline, so evaluator and tester must be declared
    expect(ambient!.agents).toContain('evaluator');
    expect(ambient!.agents).toContain('tester');
    // qa skill is required for the tester agent
    expect(ambient!.skills).toContain('qa');
  });

  it('devflow-core-skills does not contain language/ecosystem skills', () => {
    const coreSkills = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-core-skills');
    expect(coreSkills).toBeDefined();
    const movedSkills = ['typescript', 'react', 'accessibility', 'ui-design'];
    for (const skill of movedSkills) {
      expect(coreSkills!.skills, `core-skills should not contain '${skill}'`).not.toContain(skill);
    }
  });

  it('devflow-bug-analysis declares correct agents, skills, and command', () => {
    const bugAnalysis = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-bug-analysis');
    expect(bugAnalysis, 'devflow-bug-analysis should exist in registry').toBeDefined();
    // Core orchestration agents: git (pre-flight), bug-analyzer (semantic analysis), synthesizer (reporting)
    expect(bugAnalysis!.agents).toContain('git');
    expect(bugAnalysis!.agents).toContain('bug-analyzer');
    expect(bugAnalysis!.agents).toContain('synthesizer');
    // Skills: worktree-support for discovery, apply-feature-knowledge for context
    expect(bugAnalysis!.skills).toContain('worktree-support');
    expect(bugAnalysis!.skills).toContain('apply-feature-knowledge');
    // Skills added in batch-2: apply-decisions + the 5 bug-analyzer category skills
    expect(bugAnalysis!.skills).toContain('apply-decisions');
    expect(bugAnalysis!.skills).toContain('security');
    expect(bugAnalysis!.skills).toContain('reliability');
    expect(bugAnalysis!.skills).toContain('regression');
    expect(bugAnalysis!.skills).toContain('consistency');
    expect(bugAnalysis!.skills).toContain('complexity');
    // Single command
    expect(bugAnalysis!.commands).toContain('/bug-analysis');
    // Not optional — ships as a core plugin
    expect(bugAnalysis!.optional).toBeFalsy();
  });
});

describe('SHADOW_RENAMES consistency', () => {
  it('every old name in SHADOW_RENAMES appears in LEGACY_SKILL_NAMES (bare, devflow- or devflow: prefixed)', () => {
    for (const [oldName] of SHADOW_RENAMES) {
      const inLegacy =
        LEGACY_SKILL_NAMES.includes(oldName) ||
        LEGACY_SKILL_NAMES.includes(`devflow-${oldName}`) ||
        LEGACY_SKILL_NAMES.includes(`devflow:${oldName}`);
      expect(
        inLegacy,
        `SHADOW_RENAMES old name '${oldName}' must appear in LEGACY_SKILL_NAMES (bare, devflow- or devflow: prefixed)`,
      ).toBe(true);
    }
  });

  it('every new name in SHADOW_RENAMES is a known skill in getAllSkillNames()', () => {
    const allSkills = getAllSkillNames();
    for (const [, newName] of SHADOW_RENAMES) {
      expect(
        allSkills,
        `SHADOW_RENAMES new name '${newName}' must appear in getAllSkillNames()`,
      ).toContain(newName);
    }
  });
});

describe('LEGACY_AGENT_NAMES consistency', () => {
  it('no legacy agent name appears in any current plugin agents array', () => {
    const currentAgents = getAllAgentNames();
    for (const legacyName of LEGACY_AGENT_NAMES) {
      expect(
        currentAgents,
        `LEGACY_AGENT_NAMES entry '${legacyName}' must not appear in getAllAgentNames() — remove it from LEGACY_AGENT_NAMES or update the plugin registry`,
      ).not.toContain(legacyName);
    }
  });
});

describe('LEGACY_SKILL_NAMES consistency', () => {
  it('no namespaced legacy skill name matches an active skill install path', () => {
    // Active skills install at the namespaced path devflow:<bare-name>.
    // Bare legacy entries (e.g. 'dream-decisions') are safe: they target pre-namespace
    // install dirs and are no-ops on current installs because active skills always install
    // under the devflow: prefix. Only namespaced legacy entries (those already carrying the
    // devflow: prefix) directly target an install path — so this guard asserts that no already-namespaced
    // entry in LEGACY_SKILL_NAMES collides with an active skill's install path. This
    // prevents a future namespaced legacy entry from silently deleting a live skill.
    const activeInstallPaths = new Set(getAllSkillNames().map(prefixSkillName));
    const SKILL_NS = 'devflow:';
    for (const legacyName of LEGACY_SKILL_NAMES) {
      if (!legacyName.startsWith(SKILL_NS)) continue;
      expect(
        activeInstallPaths,
        `LEGACY_SKILL_NAMES entry '${legacyName}' collides with an active skill install path — remove it from LEGACY_SKILL_NAMES or update the plugin registry`,
      ).not.toContain(legacyName);
    }
  });
});

describe('partitionSelectablePlugins', () => {
  const EXCLUDED = new Set(['devflow-core-skills', 'devflow-ambient', 'devflow-audit-claude']);

  it('command-bearing plugins land in workflow bucket', () => {
    const { workflow } = partitionSelectablePlugins(DEVFLOW_PLUGINS);
    const workflowNames = workflow.map(pl => pl.name);
    // Spot-check known workflow plugins
    expect(workflowNames).toContain('devflow-plan');
    expect(workflowNames).toContain('devflow-bug-analysis');
    expect(workflowNames).toContain('devflow-implement');
    expect(workflowNames).toContain('devflow-code-review');
    // All workflow plugins must have at least one command
    for (const pl of workflow) {
      expect(pl.commands.length, `${pl.name} in workflow bucket must have commands`).toBeGreaterThan(0);
    }
  });

  it('command-less plugins land in language bucket', () => {
    const { language } = partitionSelectablePlugins(DEVFLOW_PLUGINS);
    const languageNames = language.map(pl => pl.name);
    // Spot-check known language plugins
    expect(languageNames).toContain('devflow-typescript');
    expect(languageNames).toContain('devflow-react');
    expect(languageNames).toContain('devflow-go');
    expect(languageNames).toContain('devflow-python');
    // All language plugins must have zero commands
    for (const pl of language) {
      expect(pl.commands.length, `${pl.name} in language bucket must have no commands`).toBe(0);
    }
  });

  it('excluded plugins appear in neither bucket', () => {
    const { workflow, language } = partitionSelectablePlugins(DEVFLOW_PLUGINS);
    const allNames = new Set([...workflow, ...language].map(pl => pl.name));
    for (const excluded of EXCLUDED) {
      expect(allNames.has(excluded), `${excluded} must not appear in any bucket`).toBe(false);
    }
  });

  it('workflow + language covers all selectable (non-excluded) plugins', () => {
    const { workflow, language } = partitionSelectablePlugins(DEVFLOW_PLUGINS);
    const selectableCount = DEVFLOW_PLUGINS.filter(pl => !EXCLUDED.has(pl.name)).length;
    expect(workflow.length + language.length).toBe(selectableCount);
  });

  it('buckets are disjoint', () => {
    const { workflow, language } = partitionSelectablePlugins(DEVFLOW_PLUGINS);
    const workflowNames = new Set(workflow.map(pl => pl.name));
    for (const pl of language) {
      expect(workflowNames.has(pl.name), `${pl.name} must not appear in both buckets`).toBe(false);
    }
  });

  it('does not mutate the input array', () => {
    const inputCopy = [...DEVFLOW_PLUGINS];
    partitionSelectablePlugins(DEVFLOW_PLUGINS);
    expect(DEVFLOW_PLUGINS).toEqual(inputCopy);
  });

  it('preserves DEVFLOW_PLUGINS ordering within each bucket', () => {
    const { workflow, language } = partitionSelectablePlugins(DEVFLOW_PLUGINS);
    // Collect the order of workflow and language plugins from the original registry
    const registryWorkflowOrder = DEVFLOW_PLUGINS
      .filter(pl => !EXCLUDED.has(pl.name) && pl.commands.length > 0)
      .map(pl => pl.name);
    const registryLanguageOrder = DEVFLOW_PLUGINS
      .filter(pl => !EXCLUDED.has(pl.name) && pl.commands.length === 0)
      .map(pl => pl.name);
    expect(workflow.map(pl => pl.name)).toEqual(registryWorkflowOrder);
    expect(language.map(pl => pl.name)).toEqual(registryLanguageOrder);
  });

  it('returns empty buckets for empty input', () => {
    const { workflow, language } = partitionSelectablePlugins([]);
    expect(workflow).toHaveLength(0);
    expect(language).toHaveLength(0);
  });
});

describe('WORKFLOW_ORDER', () => {
  it('is exported and contains /bug-analysis', () => {
    expect(WORKFLOW_ORDER).toContain('/bug-analysis');
  });

  it('/bug-analysis appears after /self-review', () => {
    const selfReviewIdx = WORKFLOW_ORDER.indexOf('/self-review');
    const bugAnalysisIdx = WORKFLOW_ORDER.indexOf('/bug-analysis');
    expect(selfReviewIdx).toBeGreaterThanOrEqual(0);
    expect(bugAnalysisIdx).toBeGreaterThan(selfReviewIdx);
  });

  it('every workflow plugin command appears in WORKFLOW_ORDER (regression guard)', () => {
    const { workflow } = partitionSelectablePlugins(DEVFLOW_PLUGINS);
    const workflowOrderSet = new Set(WORKFLOW_ORDER);
    for (const pl of workflow) {
      for (const cmd of pl.commands) {
        // Commands in plugin definitions use the /name format, matching WORKFLOW_ORDER entries
        expect(
          workflowOrderSet.has(cmd),
          `Command '${cmd}' from plugin '${pl.name}' must appear in WORKFLOW_ORDER`,
        ).toBe(true);
      }
    }
  });

  it('every WORKFLOW_ORDER entry corresponds to a real command in the registry (reverse regression guard)', () => {
    // Build the full set of all commands across ALL plugins (including excluded ones like
    // devflow-audit-claude, which owns /audit-claude and is intentionally in WORKFLOW_ORDER).
    const allCommands = new Set(DEVFLOW_PLUGINS.flatMap(pl => pl.commands));
    for (const cmd of WORKFLOW_ORDER) {
      expect(
        allCommands.has(cmd),
        `WORKFLOW_ORDER entry '${cmd}' must correspond to a real command in DEVFLOW_PLUGINS`,
      ).toBe(true);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(WORKFLOW_ORDER).size).toBe(WORKFLOW_ORDER.length);
  });
});

// ---------------------------------------------------------------------------
// dream-memory removal regression guards
// ---------------------------------------------------------------------------

describe('dream-memory skill removal (eager memory refresh)', () => {
  it('dream-memory is NOT in devflow-core-skills skills array', () => {
    const coreSkills = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-core-skills');
    expect(coreSkills).toBeDefined();
    expect(coreSkills!.skills).not.toContain('dream-memory');
  });

  it('dream-memory bare name is in LEGACY_SKILL_NAMES for cleanup', () => {
    expect(LEGACY_SKILL_NAMES).toContain('dream-memory');
  });

  it('prefixed namespaced name (devflow: + dream-memory) is in LEGACY_SKILL_NAMES for installed-skill cleanup', () => {
    // Build the prefixed name at runtime to avoid skill-references scanner false-positive
    // (dream-memory is intentionally removed from canonical skills)
    const legacyPrefixedName = ['devflow', 'dream-memory'].join(':');
    expect(LEGACY_SKILL_NAMES).toContain(legacyPrefixedName);
  });

  it('getAllSkillNames does not include dream-memory', () => {
    const skills = getAllSkillNames();
    expect(skills).not.toContain('dream-memory');
  });
});

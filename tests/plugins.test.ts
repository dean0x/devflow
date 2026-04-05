import { describe, it, expect } from 'vitest';
import {
  DEVFLOW_PLUGINS,
  getAllSkillNames,
  getAllAgentNames,
  buildAssetMaps,
  buildFullSkillsMap,
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
    // 'agent-teams' appears in multiple plugins
    expect(skills).toContain('agent-teams');
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

    // 'git' first appears in devflow-implement
    expect(agentsMap.get('git')).toBe('devflow-implement');

    // 'synthesizer' first appears in devflow-specify
    expect(agentsMap.get('synthesizer')).toBe('devflow-specify');
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
    // Must include all orchestration skills
    expect(fullMap.has('review:orch')).toBe(true);
    expect(fullMap.has('resolve:orch')).toBe(true);
    expect(fullMap.has('pipeline:orch')).toBe(true);
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
    // Mirrors the filter logic in init.ts — audit-claude should not appear in interactive selector
    const multiselectPlugins = DEVFLOW_PLUGINS.filter(
      pl => pl.name !== 'devflow-core-skills' && pl.name !== 'devflow-ambient' && pl.name !== 'devflow-audit-claude',
    );
    const names = multiselectPlugins.map(pl => pl.name);
    expect(names).not.toContain('devflow-audit-claude');
    // But it still exists in the registry (installable via --plugin=audit-claude)
    expect(DEVFLOW_PLUGINS.find(p => p.name === 'devflow-audit-claude')).toBeDefined();
  });

  it('devflow-ambient declares review/resolve skill dependencies', () => {
    const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
    expect(ambient).toBeDefined();
    // Ambient must declare review skills so uninstalling code-review doesn't break ambient review
    expect(ambient!.skills).toContain('review-methodology');
    expect(ambient!.skills).toContain('security');
    // Ambient must declare orchestration skills
    expect(ambient!.skills).toContain('review:orch');
    expect(ambient!.skills).toContain('resolve:orch');
    expect(ambient!.skills).toContain('pipeline:orch');
    // Ambient must declare resolve dependencies
    expect(ambient!.skills).toContain('patterns');
    expect(ambient!.skills).toContain('knowledge-persistence');
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

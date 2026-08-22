import { describe, it, expect } from 'vitest';
import {
  DEVFLOW_PLUGINS,
  getAllSkillNames,
  getAllAgentNames,
  getAllRuleNames,
  buildAssetMaps,
  buildFullSkillsMap,
  partitionSelectablePlugins,
  prefixSkillName,
  resolveFeatureRedirect,
  WORKFLOW_ORDER,
  EXCLUDED,
  DELETED_PLUGIN_NAMES,
  LEGACY_PLUGIN_NAMES,
  FEATURE_OWNED_SKILLS,
  FEATURE_OWNED_RULES,
  type PluginDefinition,
} from '../src/core/plugins.js';
import { LEGACY_SKILL_NAMES } from '../src/targets/claude-code/legacy.js';

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
    expect(agents).toContain('synthesize');
  });
});

describe('buildAssetMaps', () => {
  it('assigns each asset to the first plugin that declares it', () => {
    const { skillsMap, agentsMap } = buildAssetMaps(DEVFLOW_PLUGINS);

    // 'accessibility' first appears in devflow-accessibility (optional plugin)
    expect(skillsMap.get('accessibility')).toBe('devflow-accessibility');

    // 'git' first appears in devflow-plan (plan.mds spawns Git for ensure-traceable-issue)
    expect(agentsMap.get('git')).toBe('devflow-plan');

    // 'synthesize' first appears in devflow-plan
    expect(agentsMap.get('synthesize')).toBe('devflow-plan');
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

  it('non-language plugins do not have optional: true (except dynamic)', () => {
    const allowedOptional = new Set([...languagePluginNames, 'devflow-dynamic']);
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

  it('devflow-ambient declares review/resolve skill dependencies', () => {
    const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
    expect(ambient).toBeDefined();
    // Ambient must declare review skills so uninstalling code-review doesn't break ambient review
    expect(ambient!.skills).toContain('review-methodology');
    expect(ambient!.skills).toContain('security');
    // Ambient must declare resolve dependencies
    expect(ambient!.skills).toContain('patterns');
    // Ambient must declare all needed agents
    expect(ambient!.agents).toContain('git');
    expect(ambient!.agents).toContain('synthesize');
    expect(ambient!.agents).toContain('triage');
  });

  it('devflow-resolve declares triage, code, and validate agents (no resolver)', () => {
    const resolve = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-resolve');
    expect(resolve).toBeDefined();
    // Triage agent validates issues; Code agent fixes them; Validate agent runs the verification gate
    expect(resolve!.agents).toContain('triage');
    expect(resolve!.agents).toContain('code');
    expect(resolve!.agents).toContain('validate');
    // resolver has been retired — should not appear in registry; retirements need
    // no manual list entry — the registry-diff sweep in the installer
    // (sweepOrphanedAssets) removes any installed file absent from getAllAgentNames()
    expect(resolve!.agents).not.toContain('resolver');
    // apply-decisions skill declared so Triage agent can cite ADR/PF entries
    expect(resolve!.skills).toContain('apply-decisions');
  });

  it('devflow-implement declares evaluate and test agents and qa skill', () => {
    const implement = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-implement');
    expect(implement).toBeDefined();
    // evaluate and test agents are declared so uninstalling ambient doesn't break implement
    expect(implement!.agents).toContain('evaluate');
    expect(implement!.agents).toContain('test');
    // qa skill is required for the test agent
    expect(implement!.skills).toContain('qa');
  });

  it('devflow-ambient declares evaluate, test agents and qa skill', () => {
    const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
    expect(ambient).toBeDefined();
    // Ambient orchestrates the full implement pipeline, so evaluate and test agents must be declared
    expect(ambient!.agents).toContain('evaluate');
    expect(ambient!.agents).toContain('test');
    // qa skill is required for the test agent
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
    // Core orchestration agents: git (pre-flight), diagnose (semantic analysis), synthesize (reporting)
    expect(bugAnalysis!.agents).toContain('git');
    expect(bugAnalysis!.agents).toContain('diagnose');
    expect(bugAnalysis!.agents).toContain('synthesize');
    // Skills: worktree-support for discovery, apply-feature-knowledge for context
    expect(bugAnalysis!.skills).toContain('worktree-support');
    expect(bugAnalysis!.skills).toContain('apply-feature-knowledge');
    // Skills added in batch-2: apply-decisions + the 5 diagnose-agent category skills
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

// ---------------------------------------------------------------------------
// FEATURE_OWNED constants (step 1.5 de-registration)
// ---------------------------------------------------------------------------

describe('FEATURE_OWNED constants', () => {
  it('FEATURE_OWNED_SKILLS equals [compliance] — compliance skill is feature-owned, not plugin-owned', () => {
    expect(FEATURE_OWNED_SKILLS).toEqual(['compliance']);
  });

  it('FEATURE_OWNED_RULES equals [compliance] — compliance rule is feature-owned, not plugin-owned', () => {
    expect(FEATURE_OWNED_RULES).toEqual(['compliance']);
  });

  it('FEATURE_OWNED_SKILLS is disjoint from getAllSkillNames() — no double-ownership', () => {
    const pluginSkills = new Set(getAllSkillNames());
    const overlap = [...FEATURE_OWNED_SKILLS].filter(s => pluginSkills.has(s));
    expect(overlap, 'FEATURE_OWNED_SKILLS must not overlap with plugin-declared skills').toEqual([]);
  });

  it('FEATURE_OWNED_RULES is disjoint from getAllRuleNames() — no double-ownership', () => {
    const pluginRules = new Set(getAllRuleNames());
    const overlap = [...FEATURE_OWNED_RULES].filter(r => pluginRules.has(r));
    expect(overlap, 'FEATURE_OWNED_RULES must not overlap with plugin-declared rules').toEqual([]);
  });
});

describe('DELETED_PLUGIN_NAMES consistency', () => {
  // DELETED_PLUGIN_NAMES is a PRUNING manifest, not an install-naming list:
  // resolvePluginList drops every listed name from the user's manifest.plugins on
  // partial reinstall. A LIVE plugin name listed here is therefore silently erased
  // from the user's recorded selection, and resolveSeedPlugins then omits it from
  // the next re-init seed — a plugin the user chose disappears with no error.
  // Same misread class as PF-012 (deletion manifest that reads like a naming list);
  // guarded here because the state-aware-init contract forbids it. applies ADR-014
  it('contains no name that is still a live plugin in the registry', () => {
    const liveNames = new Set(DEVFLOW_PLUGINS.map(p => p.name));
    expect(liveNames.size, 'registry must be non-empty or this guard is vacuous').toBeGreaterThan(0);

    const stillLive = DELETED_PLUGIN_NAMES.filter(name => liveNames.has(name));
    expect(
      stillLive,
      'DELETED_PLUGIN_NAMES lists a plugin that still exists in DEVFLOW_PLUGINS — ' +
      'it would be pruned from every user manifest on partial reinstall and dropped from the re-init seed',
    ).toEqual([]);
  });

  it('contains devflow-compliance (compliance converted to built-in feature in B2)', () => {
    expect(DELETED_PLUGIN_NAMES).toContain('devflow-compliance');
  });

  it('does not overlap LEGACY_PLUGIN_NAMES keys (deletion would pre-empt the rename)', () => {
    // resolvePluginList filters deleted names BEFORE applying the rename map, so a
    // name in both lists is dropped rather than migrated to its new name.
    const overlap = DELETED_PLUGIN_NAMES.filter(name => name in LEGACY_PLUGIN_NAMES);
    expect(
      overlap,
      'a name cannot be both renamed and deleted — the delete filter runs first and the rename would never apply',
    ).toEqual([]);
  });
});

describe('agent registry membership', () => {
  it("learning is in devflow-core-skills and devflow-ambient agents (not dream)", () => {
    const coreSkills = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-core-skills');
    const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
    expect(coreSkills?.agents).toContain('learning');
    expect(coreSkills?.agents).not.toContain('dream');
    expect(ambient?.agents).toContain('learning');
    expect(ambient?.agents).not.toContain('dream');
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
  // Independent oracle. Every other test in this describe derives its expectation
  // from the imported EXCLUDED, so they move with production and cannot detect a
  // change to the excluded set itself (dropping devflow-ambient leaves them green
  // while exposing an always-installed plugin as an uncheckable-by-accident entry
  // in the init language multiselect). This literal is the only assertion that
  // pins WHICH plugins are excluded, so a deliberate change must land here. avoids PF-018
  it('EXCLUDED pins exactly the always-installed plugins (independent oracle)', () => {
    expect([...EXCLUDED].sort()).toEqual(['devflow-ambient', 'devflow-core-skills']);
  });

  it('EXCLUDED ∩ optional === ∅ — no optional plugin is non-selectable (structural invariant)', () => {
    // This invariant ensures that every optional plugin is reachable via the init UI.
    // Adding an optional plugin to EXCLUDED would silently drop it on full re-inits
    // without a carry mechanism. Guards the structural requirement.
    const optionalNames = new Set(DEVFLOW_PLUGINS.filter(p => p.optional).map(p => p.name));
    const intersection = [...EXCLUDED].filter(name => optionalNames.has(name));
    expect(intersection, 'EXCLUDED contains an optional plugin — add a re-init carry mechanism to preserve it across full reinstalls').toEqual([]);
  });

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
    // Build the full set of all commands across ALL plugins.
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

// ---------------------------------------------------------------------------
// resolveFeatureRedirect (I30: mixed --plugin list must not silently no-op)
// ---------------------------------------------------------------------------

describe('resolveFeatureRedirect', () => {
  it('compliance-only: redirected, empty remaining, notice present', () => {
    const result = resolveFeatureRedirect(['devflow-compliance']);
    expect(result.redirected).toEqual(['devflow-compliance']);
    expect(result.remaining).toEqual([]);
    expect(result.notice).toMatch(/compliance.*built-in feature/i);
  });

  it('compliance alias ("compliance") also redirects', () => {
    const result = resolveFeatureRedirect(['compliance']);
    expect(result.redirected).toEqual(['compliance']);
    expect(result.remaining).toEqual([]);
    expect(result.notice).toBeDefined();
  });

  it('mixed list: devflow-compliance stripped, other plugins remain (regression guard for I30)', () => {
    // This is the exact scenario that was silently no-oping before the fix:
    // devflow init --plugin=devflow-implement,devflow-code-review,devflow-compliance
    // should install devflow-implement and devflow-code-review, not exit 0 before parsing.
    const result = resolveFeatureRedirect(['devflow-implement', 'devflow-compliance', 'devflow-code-review']);
    expect(result.redirected).toEqual(['devflow-compliance']);
    expect(result.remaining).toEqual(['devflow-implement', 'devflow-code-review']);
    expect(result.notice).toBeDefined();
  });

  it('mixed list with shorthand alias: compliance alias stripped, other plugins remain', () => {
    const result = resolveFeatureRedirect(['devflow-plan', 'compliance']);
    expect(result.redirected).toEqual(['compliance']);
    expect(result.remaining).toEqual(['devflow-plan']);
    expect(result.notice).toBeDefined();
  });

  it('no feature redirects: all remain, no notice', () => {
    const result = resolveFeatureRedirect(['devflow-implement', 'devflow-plan']);
    expect(result.redirected).toEqual([]);
    expect(result.remaining).toEqual(['devflow-implement', 'devflow-plan']);
    expect(result.notice).toBeUndefined();
  });

  it('empty input returns empty result with no notice', () => {
    const result = resolveFeatureRedirect([]);
    expect(result.redirected).toEqual([]);
    expect(result.remaining).toEqual([]);
    expect(result.notice).toBeUndefined();
  });

  it('preserves order of remaining plugins', () => {
    const result = resolveFeatureRedirect(['devflow-plan', 'devflow-compliance', 'devflow-implement', 'devflow-resolve']);
    expect(result.remaining).toEqual(['devflow-plan', 'devflow-implement', 'devflow-resolve']);
  });
});

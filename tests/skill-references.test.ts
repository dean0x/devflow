/**
 * Skill reference integrity tests.
 *
 * Design principle: rename-proof. ALL tests derive the valid skill set from
 * getAllSkillNames() at runtime — never hardcoded. Adding or renaming a skill
 * in plugins.ts automatically updates what these tests consider valid.
 */

import { describe, it, expect } from 'vitest';
// NOTE: Intentional sync I/O throughout. This test file only reads static fixture files
// from the local repo during test discovery — no async I/O benefit, and sync keeps every
// test function synchronous (simpler assertions, no `await` boilerplate).
import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';
import { getAllSkillNames, DEVFLOW_PLUGINS } from '../src/cli/plugins.js';

const ROOT = path.resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Extract devflow:name prefixed references from file content. */
function extractPrefixedRefs(content: string): string[] {
  const matches = content.matchAll(/devflow:([\w:-]+)/g);
  return [...matches].map(m => m[1]);
}

/** Extract install path references (~/.claude/skills/devflow:NAME/SKILL.md). */
function extractInstallPaths(content: string): string[] {
  const matches = content.matchAll(/~\/\.claude\/skills\/devflow:([\w:-]+)\/SKILL\.md/g);
  return [...matches].map(m => m[1]);
}

/** Extract source directory path references (shared/skills/NAME/). */
function extractSourceDirRefs(content: string): string[] {
  const matches = content.matchAll(/shared\/skills\/([\w:-]+)\//g);
  return [...matches].map(m => m[1]);
}

/** Parse frontmatter skills block-list: `skills:\n  - devflow:a\n  - devflow:b` → ['a', 'b']. */
function parseFrontmatterSkills(content: string): string[] {
  const blockMatch = content.match(/^skills:\s*\n((?:\s+-\s+.+\n?)+)/m);
  if (!blockMatch) return [];
  return blockMatch[1]
    .split('\n')
    .map(l => l.trim().replace(/^-\s+/, '').replace(/^devflow:/, ''))
    .filter(Boolean);
}

/**
 * Extract bare backtick-quoted skill names from the "Skills" section of a markdown file.
 * Matches table rows (`| \`name\` |`) and list items (`- \`name\``).
 */
function extractSkillSectionNames(content: string): string[] {
  const match = content.match(/^#{2,3}\s+Skills(?:\s*\(\d+\))?.*$/m);
  if (!match || match.index === undefined) return [];
  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const nextHeader = rest.match(/^#{2,3}\s+\S/m);
  const section = nextHeader?.index !== undefined ? rest.slice(0, nextHeader.index) : rest;
  const names: string[] = [];
  for (const m of section.matchAll(/^[-|]\s*`([\w:-]+)`/gm)) {
    names.push(m[1]);
  }
  return names;
}

/** Extract first-column backtick-quoted names from markdown tables. */
function extractTableFirstColumnNames(content: string): string[] {
  const names: string[] = [];
  for (const m of content.matchAll(/^\|\s*`([\w:-]+)`\s*\|/gm)) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Extract relative skill-directory cross-references.
 * Pattern: `skill-name/references/file.md` — the first path component is a skill name.
 */
function extractRelativeSkillRefs(content: string): string[] {
  const matches = content.matchAll(/(?:^|[`\s])([\w:-]+)\/references\/[\w-]+\.md/gm);
  return [...matches].map(m => m[1]);
}

/**
 * Scan a single file for stale V2-renamed skill name occurrences.
 *
 * Returns an array of violation strings (one per match) of the form
 * `"{relFile}:{lineNumber}: found old skill name '{oldName}' as string literal"`.
 * Returns an empty array when the file is clean.
 */
function findStaleNameOccurrences(
  relFile: string,
  filePath: string,
  oldSkillNames: [string, RegExp][],
  allowlistPatterns: RegExp[],
): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: string[] = [];

  for (const [oldName, pattern] of oldSkillNames) {
    // Precompute the devflow: prefix check regex per old name (not per line)
    const prefixedPattern = new RegExp(`devflow:${oldName}`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (allowlistPatterns.some(p => p.test(line))) continue;
      // Reset stateful regex lastIndex before each line test
      pattern.lastIndex = 0;
      if (!pattern.test(line)) continue;
      // Skip lines that reference the name under a devflow: prefix (caught by other tests)
      if (prefixedPattern.test(line)) continue;
      violations.push(
        `tests/${relFile}:${i + 1}: found old skill name '${oldName}' as string literal — should use V2 name`,
      );
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * References that appear with devflow: prefix but are NOT skills —
 * they are command names or slash-command shortcuts.
 */
const COMMAND_REFS = new Set([
  'code-review',
  'resolve',
  'debug',
  'implement',
  'self-review',
  'audit-claude',
  'plan',
  'review',
  'pipeline',
]);

/**
 * Plugin names (without devflow- prefix) that might appear as devflow:NAME
 * references in documentation but are not skills.
 */
const PLUGIN_NAMES = new Set(DEVFLOW_PLUGINS.map(p => p.name.replace(/^devflow-/, '')));

/** Filter a list of extracted names: remove command refs and plugin-name-only refs. */
function filterNonSkillRefs(names: string[]): string[] {
  return names.filter(name => !COMMAND_REFS.has(name) && !PLUGIN_NAMES.has(name));
}

// ---------------------------------------------------------------------------
// Format 1: Plugin manifests
// ---------------------------------------------------------------------------

describe('Format 1: Plugin manifest skill arrays', () => {
  it('every skill in plugin.json skills[] exists in canonical set', async () => {
    const canonicalSkills = new Set(getAllSkillNames());

    for (const plugin of DEVFLOW_PLUGINS) {
      const manifestPath = path.join(ROOT, 'plugins', plugin.name, '.claude-plugin', 'plugin.json');
      let manifest: { skills?: string[] };
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      } catch {
        // Plugin may not have a manifest (optional plugins without files) — skip
        continue;
      }

      for (const skill of manifest.skills ?? []) {
        expect(
          canonicalSkills.has(skill),
          `plugin ${plugin.name}: skill '${skill}' in plugin.json is not in canonical getAllSkillNames() — stale manifest or missing plugin registration`,
        ).toBe(true);
      }
    }
  });

  it('plugin.json skills[] matches plugins.ts skills[] for every plugin', async () => {
    for (const plugin of DEVFLOW_PLUGINS) {
      const manifestPath = path.join(ROOT, 'plugins', plugin.name, '.claude-plugin', 'plugin.json');
      let manifest: { skills?: string[] };
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      } catch {
        continue;
      }

      const manifestSkills = new Set(manifest.skills ?? []);
      const registrySkills = new Set(plugin.skills);

      for (const skill of manifestSkills) {
        expect(
          registrySkills.has(skill),
          `plugin ${plugin.name}: skill '${skill}' is in plugin.json but missing from plugins.ts`,
        ).toBe(true);
      }

      for (const skill of registrySkills) {
        expect(
          manifestSkills.has(skill),
          `plugin ${plugin.name}: skill '${skill}' is in plugins.ts but missing from plugin.json`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Format 2: Agent frontmatter
// ---------------------------------------------------------------------------

describe('Format 2: Agent frontmatter skills', () => {
  it('every skill in shared agent frontmatter exists in canonical set', async () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const agentFiles = readdirSync(path.join(ROOT, 'shared', 'agents')).filter(f => f.endsWith('.md'));

    for (const file of agentFiles) {
      const filePath = path.join(ROOT, 'shared', 'agents', file);
      const content = readFileSync(filePath, 'utf-8');
      const skillNames = parseFrontmatterSkills(content);

      for (const skill of skillNames) {
        expect(
          canonicalSkills.has(skill),
          `shared/agents/${file}: frontmatter skill '${skill}' is not in canonical getAllSkillNames()`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Format 3: Install path references (~/.claude/skills/devflow:NAME/)
// ---------------------------------------------------------------------------

describe('Format 3: Install path references', () => {
  it('all install paths in shared agents are canonical', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const agentsDir = path.join(ROOT, 'shared', 'agents');
    const agentFiles = readdirSync(agentsDir).filter(f => f.endsWith('.md'));

    let totalRefs = 0;
    for (const file of agentFiles) {
      const content = readFileSync(path.join(agentsDir, file), 'utf-8');
      const refs = extractInstallPaths(content);
      totalRefs += refs.length;

      for (const ref of refs) {
        expect(
          canonicalSkills.has(ref),
          `shared/agents/${file}: install path 'devflow:${ref}' is not canonical`,
        ).toBe(true);
      }
    }

    // reviewer.md + coder.md alone have 20+ install path refs
    expect(totalRefs, 'shared agents should have install path references').toBeGreaterThan(15);
  });

  it('all install paths in plugin command files are canonical', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    let totalRefs = 0;

    for (const plugin of DEVFLOW_PLUGINS) {
      const commandsDir = path.join(ROOT, 'plugins', plugin.name, 'commands');
      let files: string[];
      try {
        files = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
      } catch {
        continue;
      }

      for (const file of files) {
        const content = readFileSync(path.join(commandsDir, file), 'utf-8');
        const refs = extractInstallPaths(content);
        totalRefs += refs.length;

        for (const ref of refs) {
          expect(
            canonicalSkills.has(ref),
            `plugins/${plugin.name}/commands/${file}: install path 'devflow:${ref}' is not canonical`,
          ).toBe(true);
        }
      }
    }

    // debug, implement, code-review, resolve commands all have install paths
    expect(totalRefs, 'command files should have install path references').toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Format 3b: Shadow path references (~/.devflow/skills/NAME/)
// ---------------------------------------------------------------------------

/** Extract skill names from shadow path references: ~/.devflow/skills/NAME/ */
function extractShadowPaths(content: string): string[] {
  const matches = content.matchAll(/~\/\.devflow\/skills\/([\w:-]+)\//g);
  return [...matches].map(m => m[1]);
}

describe('Format 3b: Shadow path references', () => {
  function isPlaceholder(name: string): boolean {
    return name.includes('{') || name === 'name';
  }

  it('all ~/.devflow/skills/NAME/ paths in docs are canonical', () => {
    const canonicalSkills = new Set(getAllSkillNames());

    // Check README.md and CLAUDE.md — the files known to reference shadow paths
    for (const file of ['README.md', 'CLAUDE.md']) {
      const content = readFileSync(path.join(ROOT, file), 'utf-8');
      const refs = extractShadowPaths(content).filter(r => !isPlaceholder(r));

      for (const ref of refs) {
        expect(
          canonicalSkills.has(ref),
          `${file}: shadow path '~/.devflow/skills/${ref}/' — '${ref}' is not in canonical getAllSkillNames()`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Format 4: Source directory paths
// ---------------------------------------------------------------------------

describe('Format 4: Source directory path references', () => {
  /**
   * Template placeholders like `shared/skills/skill-name/` or
   * `shared/skills/{name}/` are not real skill names — filter them.
   */
  function isPlaceholder(name: string): boolean {
    return name.includes('{') || name === 'skill-name';
  }

  it('all shared/skills/NAME/ references in CLAUDE.md are canonical', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const content = readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf-8');
    const refs = extractSourceDirRefs(content).filter(r => !isPlaceholder(r));

    for (const ref of refs) {
      expect(
        canonicalSkills.has(ref),
        `CLAUDE.md: source path 'shared/skills/${ref}/' — '${ref}' is not in canonical getAllSkillNames()`,
      ).toBe(true);
    }
  });

  it('all shared/skills/NAME/ references in docs/reference/ are canonical', async () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const refDir = path.join(ROOT, 'docs', 'reference');
    const docFiles = readdirSync(refDir).filter(f => f.endsWith('.md'));

    for (const file of docFiles) {
      const filePath = path.join(refDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const refs = extractSourceDirRefs(content).filter(r => !isPlaceholder(r));

      for (const ref of refs) {
        expect(
          canonicalSkills.has(ref),
          `docs/reference/${file}: source path 'shared/skills/${ref}/' — '${ref}' is not in canonical getAllSkillNames()`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Format 5: Ambient hook preamble
// ---------------------------------------------------------------------------

describe('Format 5: Hook script skill references', () => {
  it('all devflow:NAME references in hook scripts are canonical or command refs', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const hooksDir = path.join(ROOT, 'scripts', 'hooks');
    const hookFiles = readdirSync(hooksDir).filter(f => {
      const fullPath = path.join(hooksDir, f);
      return statSync(fullPath).isFile();
    });

    expect(hookFiles.length, 'should find at least one hook script').toBeGreaterThan(0);

    for (const file of hookFiles) {
      const filePath = path.join(hooksDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const allRefs = extractPrefixedRefs(content);
      const skillRefs = filterNonSkillRefs(allRefs);

      for (const ref of skillRefs) {
        expect(
          canonicalSkills.has(ref),
          `scripts/hooks/${file}: devflow:${ref} is not in canonical getAllSkillNames() and not a known command ref`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Format 6: Command files
// ---------------------------------------------------------------------------

describe('Format 6: Plugin command file skill references', () => {
  it('all devflow:NAME references in command files are canonical or command refs', () => {
    const canonicalSkills = new Set(getAllSkillNames());

    for (const plugin of DEVFLOW_PLUGINS) {
      const commandsDir = path.join(ROOT, 'plugins', plugin.name, 'commands');
      let files: string[];
      try {
        files = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
      } catch {
        continue; // Plugin has no commands dir
      }

      for (const file of files) {
        const filePath = path.join(commandsDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const allRefs = extractPrefixedRefs(content);
        const skillRefs = filterNonSkillRefs(allRefs);

        for (const ref of skillRefs) {
          expect(
            canonicalSkills.has(ref),
            `plugins/${plugin.name}/commands/${file}: devflow:${ref} is not in canonical getAllSkillNames() and not a known command ref`,
          ).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Format 7: Documentation tables
// ---------------------------------------------------------------------------

describe('Format 7: Documentation table skill references', () => {
  it('all devflow:NAME references in plugin READMEs are canonical or command refs', () => {
    const canonicalSkills = new Set(getAllSkillNames());

    for (const plugin of DEVFLOW_PLUGINS) {
      const readmePath = path.join(ROOT, 'plugins', plugin.name, 'README.md');
      let content: string;
      try {
        content = readFileSync(readmePath, 'utf-8');
      } catch {
        continue; // Plugin may not have README
      }

      const allRefs = extractPrefixedRefs(content);
      const skillRefs = filterNonSkillRefs(allRefs);

      for (const ref of skillRefs) {
        expect(
          canonicalSkills.has(ref),
          `plugins/${plugin.name}/README.md: devflow:${ref} is not in canonical getAllSkillNames() and not a known command ref`,
        ).toBe(true);
      }
    }
  });

  it('all devflow:NAME references in docs/reference/skills-architecture.md are canonical or command refs', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    let content: string;
    try {
      content = readFileSync(path.join(ROOT, 'docs', 'reference', 'skills-architecture.md'), 'utf-8');
    } catch {
      return; // File may not exist yet
    }

    const allRefs = extractPrefixedRefs(content);
    const skillRefs = filterNonSkillRefs(allRefs);

    for (const ref of skillRefs) {
      expect(
        canonicalSkills.has(ref),
        `docs/reference/skills-architecture.md: devflow:${ref} is not in canonical getAllSkillNames() and not a known command ref`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Format 8: Skill cross-references
// ---------------------------------------------------------------------------

describe('Format 8: Skill cross-references within shared/skills/', () => {
  it('all devflow:NAME references in SKILL.md files are canonical or command refs', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const skillsDir = path.join(ROOT, 'shared', 'skills');
    const skillDirs = readdirSync(skillsDir);

    for (const skillDir of skillDirs) {
      const skillMdPath = path.join(skillsDir, skillDir, 'SKILL.md');
      let content: string;
      try {
        content = readFileSync(skillMdPath, 'utf-8');
      } catch {
        continue;
      }

      const allRefs = extractPrefixedRefs(content);
      const skillRefs = filterNonSkillRefs(allRefs);

      for (const ref of skillRefs) {
        expect(
          canonicalSkills.has(ref),
          `shared/skills/${skillDir}/SKILL.md: devflow:${ref} is not in canonical getAllSkillNames() and not a known command ref`,
        ).toBe(true);
      }
    }
  });

  it('all devflow:NAME references in skill references/ files are canonical or command refs', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const skillsDir = path.join(ROOT, 'shared', 'skills');
    const skillDirs = readdirSync(skillsDir);

    for (const skillDir of skillDirs) {
      const refsDir = path.join(skillsDir, skillDir, 'references');
      let refFiles: string[];
      try {
        refFiles = readdirSync(refsDir).filter(f => f.endsWith('.md'));
      } catch {
        continue; // No references/ directory
      }

      for (const file of refFiles) {
        const filePath = path.join(refsDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const allRefs = extractPrefixedRefs(content);
        const skillRefs = filterNonSkillRefs(allRefs);

        for (const ref of skillRefs) {
          expect(
            canonicalSkills.has(ref),
            `shared/skills/${skillDir}/references/${file}: devflow:${ref} is not in canonical getAllSkillNames() and not a known command ref`,
          ).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Format 9: Bare backtick-quoted skill names in README skill sections
// ---------------------------------------------------------------------------

describe('Format 9: Bare skill names in README "Skills" sections', () => {
  it('every bare backtick skill name in plugin README "Skills" sections is canonical', () => {
    const canonicalSkills = new Set(getAllSkillNames());

    for (const plugin of DEVFLOW_PLUGINS) {
      const readmePath = path.join(ROOT, 'plugins', plugin.name, 'README.md');
      let content: string;
      try {
        content = readFileSync(readmePath, 'utf-8');
      } catch {
        continue;
      }

      const bareNames = extractSkillSectionNames(content);
      for (const name of bareNames) {
        expect(
          canonicalSkills.has(name),
          `plugins/${plugin.name}/README.md: bare skill name '${name}' in Skills section is not in canonical getAllSkillNames()`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Format 10: Bare skill names in skills-architecture.md tables
// ---------------------------------------------------------------------------

describe('Format 10: Bare skill names in skills-architecture.md tables', () => {
  it('every first-column backtick name in skills-architecture.md is canonical', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    let content: string;
    try {
      content = readFileSync(path.join(ROOT, 'docs', 'reference', 'skills-architecture.md'), 'utf-8');
    } catch {
      return;
    }

    const tableNames = extractTableFirstColumnNames(content);
    expect(tableNames.length, 'should find backtick names in table rows').toBeGreaterThan(0);

    for (const name of tableNames) {
      expect(
        canonicalSkills.has(name),
        `docs/reference/skills-architecture.md: table entry '${name}' is not in canonical getAllSkillNames()`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Format 11: Relative skill-directory cross-references
// ---------------------------------------------------------------------------

describe('Format 11: Relative skill-directory cross-references in skill reference docs', () => {
  it('skill-name/references/file.md cross-references point to canonical skills', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const skillsDir = path.join(ROOT, 'shared', 'skills');
    const skillDirs = readdirSync(skillsDir);

    for (const skillDir of skillDirs) {
      const refsDir = path.join(skillsDir, skillDir, 'references');
      let refFiles: string[];
      try {
        refFiles = readdirSync(refsDir).filter(f => f.endsWith('.md'));
      } catch {
        continue;
      }

      for (const file of refFiles) {
        const filePath = path.join(refsDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const crossRefs = extractRelativeSkillRefs(content);

        for (const ref of crossRefs) {
          // Skip self-references (same skill directory)
          if (ref === skillDir) continue;
          expect(
            canonicalSkills.has(ref),
            `shared/skills/${skillDir}/references/${file}: cross-reference '${ref}/references/...' — '${ref}' is not in canonical getAllSkillNames()`,
          ).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Additional: Test infrastructure (recursive — covers tests/integration/)
// ---------------------------------------------------------------------------

/** Recursively collect .ts files under a directory, returning paths relative to baseDir. */
function collectTsFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectTsFiles(fullPath, baseDir));
    } else if (stat.isFile() && entry.endsWith('.ts')) {
      results.push(path.relative(baseDir, fullPath));
    }
  }
  return results;
}

describe('Test infrastructure skill references', () => {
  it('all devflow:NAME references in tests/**/*.ts are canonical or command refs', async () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const testsDir = path.join(ROOT, 'tests');
    const testFiles = collectTsFiles(testsDir, testsDir).filter(f =>
      // Exclude this file itself — it contains regex patterns and jsdoc that produce false positives
      f !== 'skill-references.test.ts'
    );

    // Verify we actually scan subdirectories (integration helpers must be included)
    expect(
      testFiles.some(f => f.startsWith('integration/')),
      'recursive scan must include tests/integration/ files',
    ).toBe(true);

    for (const relFile of testFiles) {
      const filePath = path.join(testsDir, relFile);
      const content = readFileSync(filePath, 'utf-8');
      const allRefs = extractPrefixedRefs(content);
      const skillRefs = filterNonSkillRefs(allRefs);

      for (const ref of skillRefs) {
        expect(
          canonicalSkills.has(ref),
          `tests/${relFile}: devflow:${ref} is not in canonical getAllSkillNames() and not a known command ref`,
        ).toBe(true);
      }
    }
  });

  it('DEVFLOW_PREAMBLE reads classification-rules.md which has valid refs', () => {
    // helpers.ts loads DEVFLOW_PREAMBLE from classification-rules.md at runtime.
    // Verify the classification rules reference devflow:router (loaded via Skill tool).
    const rulesPath = path.join(ROOT, 'shared', 'skills', 'router', 'references', 'classification-rules.md');
    const rulesContent = readFileSync(rulesPath, 'utf-8');

    const rulesRefs = extractPrefixedRefs(rulesContent);
    const skillRefs = filterNonSkillRefs(rulesRefs);
    const canonicalSkills = new Set(getAllSkillNames());

    for (const ref of skillRefs) {
      expect(
        canonicalSkills.has(ref),
        `classification-rules.md has 'devflow:${ref}' but it is not in canonical skill set`,
      ).toBe(true);
    }
  });

  it('router SKILL.md skill refs match canonical set', () => {
    // The lean router SKILL.md contains skill lookup tables.
    const canonicalSkills = new Set(getAllSkillNames());
    const routerPath = path.join(ROOT, 'shared', 'skills', 'router', 'SKILL.md');
    const routerContent = readFileSync(routerPath, 'utf-8');

    const routerRefs = extractPrefixedRefs(routerContent);
    expect(routerRefs.length, 'router SKILL.md should have devflow: skill refs').toBeGreaterThan(0);

    const skillRefs = filterNonSkillRefs(routerRefs);
    for (const ref of skillRefs) {
      expect(
        canonicalSkills.has(ref),
        `router SKILL.md has 'devflow:${ref}' but it is not in canonical skill set`,
      ).toBe(true);
    }
  });

  it('no old V2-renamed skill names appear as string literals in test data', () => {
    const testsDir = path.join(ROOT, 'tests');
    const testFiles = collectTsFiles(testsDir, testsDir).filter(f =>
      // Exclude this file — it has old names in regexes/comments by design
      f !== 'skill-references.test.ts'
    );

    // Old bare skill names from the V2 rename
    const OLD_SKILL_NAMES: [string, RegExp][] = [
      // Matches `core-patterns` as a skill ref (in devflow: prefix context),
      // but not as a substring of `devflow-core-patterns` (legacy names list)
      ['core-patterns', /(?<!devflow-)(?<![\w])core-patterns(?![\w])/g],
      ['test-patterns', /(?<!devflow-)(?<![\w])test-patterns(?![\w])/g],
      ['security-patterns', /(?<!devflow-)(?<![\w])security-patterns(?![\w])/g],
      ['architecture-patterns', /(?<!devflow-)(?<![\w])architecture-patterns(?![\w])/g],
      ['performance-patterns', /(?<!devflow-)(?<![\w])performance-patterns(?![\w])/g],
      // input-validation: exclude when in HTML/form context (rare in test files)
      ['input-validation', /(?<!devflow-)(?<![\w])input-validation(?![\w])/g],
      // frontend-design: exclude when preceded by `devflow-` (plugin name)
      ['frontend-design', /(?<!devflow-)(?<![\w])frontend-design(?![\w])/g],
      // git consolidation: 3 old skills merged into `git`
      ['git-safety', /(?<!devflow-)(?<![\w])git-safety(?![\w])/g],
      ['git-workflow', /(?<!devflow-)(?<![\w])git-workflow(?![\w])/g],
      ['github-patterns', /(?<!devflow-)(?<![\w])github-patterns(?![\w])/g],
      // track3 ambient refinements: old long names
      ['implementation-orchestration', /(?<![\w])implementation-orchestration(?![\w])/g],
      ['debug-orchestration', /(?<![\w])debug-orchestration(?![\w])/g],
      ['plan-orchestration', /(?<![\w])plan-orchestration(?![\w])/g],
      ['review-orchestration', /(?<![\w])review-orchestration(?![\w])/g],
      ['resolve-orchestration', /(?<![\w])resolve-orchestration(?![\w])/g],
      ['pipeline-orchestration', /(?<![\w])pipeline-orchestration(?![\w])/g],
      ['ambient-router', /(?<![\w])ambient-router(?![\w])/g],
      ['implementation-patterns', /(?<!devflow-)(?<![\w])implementation-patterns(?![\w])/g],
      ['search-first', /(?<![\w])search-first(?![\w])/g],
    ];

    // Known allowlist: lines containing migration test data, legacy references, or comments about old names.
    // Also allow test assertion lines like `expect(...).toContain('old-name')` in shadow migration tests.
    const ALLOWLIST_PATTERNS = [
      /LEGACY_SKILL_NAMES/,
      /SHADOW_RENAMES/,
      /old.?name/i,
      /legacy/i,
      /shadow/i,
      /[Mm]igrat/,
      /v2\.0\.0.*rename/i,
      /\/\/ Old/i,
    ];

    // Files whose tests intentionally use old skill names as test data
    const ALLOWLIST_FILES = new Set([
      'init-logic.test.ts',
      'shadow-overrides-migration.test.ts',
    ]);

    for (const relFile of testFiles) {
      // Skip files that intentionally use old names as migration test data
      const basename = path.basename(relFile);
      if (ALLOWLIST_FILES.has(basename)) continue;

      const filePath = path.join(testsDir, relFile);
      const violations = findStaleNameOccurrences(relFile, filePath, OLD_SKILL_NAMES, ALLOWLIST_PATTERNS);

      for (const violation of violations) {
        expect.unreachable(violation);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Additional: Completeness check
// ---------------------------------------------------------------------------

describe('Completeness: reviewer.md Focus Areas vs code-review plugin', () => {
  it('reviewer Focus Areas covers all skills in code-review plugin.json skills[]', () => {
    const manifestPath = path.join(
      ROOT,
      'plugins',
      'devflow-code-review',
      '.claude-plugin',
      'plugin.json',
    );

    const manifest: { skills?: string[] } = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    // These meta-skills don't correspond to reviewer focus areas
    const NON_FOCUS_SKILLS = new Set([
      'agent-teams',
      'knowledge-persistence',
      'review-methodology',
      'worktree-support',
    ]);

    const reviewerContent = readFileSync(
      path.join(ROOT, 'shared', 'agents', 'reviewer.md'),
      'utf-8',
    );

    for (const skill of manifest.skills ?? []) {
      if (NON_FOCUS_SKILLS.has(skill)) continue;

      // Focus name equals the skill name directly — all skills match focus 1:1
      expect(
        reviewerContent.includes(`| ${skill} |`) || reviewerContent.includes(`| \`${skill}\` |`),
        `reviewer.md Focus Areas table is missing focus '${skill}' (from code-review plugin skill '${skill}')`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-component runtime alignment
// ---------------------------------------------------------------------------

/**
 * Parse the reviewer Focus Areas table into a map of focus → skill path.
 * Expects rows like: | `focus` | `~/.claude/skills/devflow:skill/SKILL.md` |
 */
function parseReviewerFocusAreas(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of content.matchAll(/^\|\s*`([\w-]+)`\s*\|\s*`~\/\.claude\/skills\/devflow:([\w-]+)\/SKILL\.md`\s*\|/gm)) {
    map.set(match[1], match[2]);
  }
  return map;
}

/**
 * Parse the code-review command focus table into a map of focus → skill.
 * Expects rows like: | focus | ✓ | devflow:skill |
 */
function parseCodeReviewFocusTable(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of content.matchAll(/^\|\s*([\w-]+)\s*\|\s*(?:✓|conditional)\s*\|\s*devflow:([\w-]+)\s*\|/gm)) {
    map.set(match[1], match[2]);
  }
  return map;
}

describe('Cross-component runtime alignment', () => {
  const reviewerContent = readFileSync(path.join(ROOT, 'shared', 'agents', 'reviewer.md'), 'utf-8');
  const reviewerFocusAreas = parseReviewerFocusAreas(reviewerContent);

  it('reviewer Focus Areas table has entries', () => {
    expect(reviewerFocusAreas.size).toBeGreaterThan(10);
  });

  it('code-review command focus names exist in reviewer Focus Areas', () => {
    const commandContent = readFileSync(
      path.join(ROOT, 'plugins', 'devflow-code-review', 'commands', 'code-review.md'),
      'utf-8',
    );
    const commandFocuses = parseCodeReviewFocusTable(commandContent);

    expect(commandFocuses.size, 'code-review command should have focus entries').toBeGreaterThan(10);

    for (const [focus] of commandFocuses) {
      expect(
        reviewerFocusAreas.has(focus),
        `code-review command sends focus '${focus}' but reviewer Focus Areas table has no entry for it`,
      ).toBe(true);
    }
  });

  it('code-review command skill mappings match reviewer Focus Areas skill paths', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const commandContent = readFileSync(
      path.join(ROOT, 'plugins', 'devflow-code-review', 'commands', 'code-review.md'),
      'utf-8',
    );
    const commandFocuses = parseCodeReviewFocusTable(commandContent);

    for (const [focus, commandSkill] of commandFocuses) {
      // The command's pattern skill must be canonical
      expect(
        canonicalSkills.has(commandSkill),
        `code-review command maps focus '${focus}' to 'devflow:${commandSkill}' which is not canonical`,
      ).toBe(true);

      // The reviewer's Focus Areas skill must match the command's skill
      const reviewerSkill = reviewerFocusAreas.get(focus);
      if (reviewerSkill) {
        expect(
          reviewerSkill,
          `focus '${focus}': code-review says 'devflow:${commandSkill}' but reviewer says 'devflow:${reviewerSkill}'`,
        ).toBe(commandSkill);
      }
    }
  });

  it('review orchestration core reviewers exist in reviewer Focus Areas', () => {
    const orchContent = readFileSync(
      path.join(ROOT, 'shared', 'skills', 'review:orch', 'SKILL.md'),
      'utf-8',
    );

    // Extract core reviewer list: "- security, architecture, performance, ..."
    const coreMatch = orchContent.match(/^\*\*7 core reviewers\*\*[^:]*:\s*\n-\s*(.+)$/m);
    if (!coreMatch) {
      expect.unreachable('review skill should list 7 core reviewers');
    }

    const coreReviewers = coreMatch[1].split(',').map(s => s.trim());
    expect(coreReviewers.length, 'should have 7 core reviewers').toBe(7);

    for (const focus of coreReviewers) {
      expect(
        reviewerFocusAreas.has(focus),
        `review skill lists core reviewer '${focus}' but reviewer Focus Areas has no entry for it`,
      ).toBe(true);
    }
  });

  it('review orchestration conditional reviewers exist in reviewer Focus Areas', () => {
    const orchContent = readFileSync(
      path.join(ROOT, 'shared', 'skills', 'review:orch', 'SKILL.md'),
      'utf-8',
    );

    // Extract conditional reviewer list: "- typescript, react, database, ..."
    const condMatch = orchContent.match(/^\*\*Conditional reviewers\*\*[^:]*:\s*\n-\s*(.+)$/m);
    if (!condMatch) {
      expect.unreachable('review skill should list conditional reviewers');
    }

    const condReviewers = condMatch[1].split(',').map(s => s.trim());

    for (const focus of condReviewers) {
      expect(
        reviewerFocusAreas.has(focus),
        `review skill lists conditional reviewer '${focus}' but reviewer Focus Areas has no entry for it`,
      ).toBe(true);
    }
  });

  it('code-review command has no stale devflow:{focus}-patterns template', () => {
    const commandContent = readFileSync(
      path.join(ROOT, 'plugins', 'devflow-code-review', 'commands', 'code-review.md'),
      'utf-8',
    );

    // This template was stale — it appended -patterns to every focus name
    expect(
      commandContent.includes('devflow:{focus}-patterns'),
      'code-review command should not contain stale "devflow:{focus}-patterns" template',
    ).toBe(false);
  });

  it('code-review-teams install paths reference canonical skills', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const teamsPath = path.join(ROOT, 'plugins', 'devflow-code-review', 'commands', 'code-review-teams.md');
    let content: string;
    try {
      content = readFileSync(teamsPath, 'utf-8');
    } catch {
      return; // teams variant may not exist
    }

    const installPaths = extractInstallPaths(content);
    for (const ref of installPaths) {
      expect(
        canonicalSkills.has(ref),
        `code-review-teams.md: install path 'devflow:${ref}' is not canonical`,
      ).toBe(true);
    }
  });

  it('coder domain skill paths cover all language/ecosystem skills', () => {
    const coderContent = readFileSync(path.join(ROOT, 'shared', 'agents', 'coder.md'), 'utf-8');
    const coderInstallPaths = new Set(extractInstallPaths(coderContent));

    // Language skills that should be loadable as domain skills
    const languageSkills = ['typescript', 'react', 'go', 'java', 'python', 'rust'];
    // Related skills that should be available for domain loading
    const domainSkills = ['boundary-validation', 'accessibility', 'ui-design', 'testing'];

    for (const skill of [...languageSkills, ...domainSkills]) {
      expect(
        coderInstallPaths.has(skill),
        `coder.md domain skill section should reference 'devflow:${skill}' install path`,
      ).toBe(true);
    }
  });
});

describe('citation sentence propagation', () => {
  const MARKER_START = '<!-- CITATION-SENTENCE-START -->';
  const MARKER_END = '<!-- CITATION-SENTENCE-END -->';

  function extractCitationSentence(filePath: string): string {
    const content = readFileSync(filePath, 'utf-8');
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);
    if (startIdx === -1 || endIdx === -1) {
      throw new Error(`Citation markers not found in ${filePath}`);
    }
    return content.slice(startIdx + MARKER_START.length, endIdx);
  }

  const skillPath = path.join(ROOT, 'shared/skills/knowledge-persistence/SKILL.md');
  const coderPath = path.join(ROOT, 'shared/agents/coder.md');
  const reviewerPath = path.join(ROOT, 'shared/agents/reviewer.md');

  it('canonical sentence exists in SKILL.md', () => {
    const sentence = extractCitationSentence(skillPath);
    expect(sentence.trim()).toBeTruthy();
  });

  it('coder.md has byte-identical citation sentence', () => {
    const canonical = extractCitationSentence(skillPath);
    const coderSentence = extractCitationSentence(coderPath);
    expect(coderSentence).toBe(canonical);
  });

  it('reviewer.md has citation sentence referencing KNOWLEDGE_CONTEXT index and apply-knowledge skill', () => {
    // reviewer.md uses the index+Read pattern (KNOWLEDGE_CONTEXT + devflow:apply-knowledge),
    // not the direct-file-read pattern used by coder. The sentence intentionally differs from
    // the canonical (coder-style) sentence.
    const reviewerSentence = extractCitationSentence(reviewerPath);
    expect(reviewerSentence.trim()).toBeTruthy();
    expect(reviewerSentence).toContain('KNOWLEDGE_CONTEXT');
    expect(reviewerSentence).toContain('devflow:apply-knowledge');
    expect(reviewerSentence).toContain('applies ADR-NNN');
    expect(reviewerSentence).toContain('avoids PF-NNN');
  });
});

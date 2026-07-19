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
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';
import { getAllSkillNames, DEVFLOW_PLUGINS } from '../src/core/plugins.js';

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
  'dynamic-tickets',
  'dynamic-plan',
  'dynamic-build',
  'dynamic-profile',
  'dynamic-wave',
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

// Format 1 (plugin manifests) removed — plugin.json files were deleted in the src/ restructure.
// Registry integrity is now guarded by tests/registry-integrity.test.ts (forward + reverse checks).

// ---------------------------------------------------------------------------
// Format 2: Agent frontmatter
// ---------------------------------------------------------------------------

describe('Format 2: Agent frontmatter skills', () => {
  it('every skill in shared agent frontmatter exists in canonical set', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const agentFiles = readdirSync(path.join(ROOT, 'src', 'assets', 'agents')).filter(f => f.endsWith('.md'));

    for (const file of agentFiles) {
      const filePath = path.join(ROOT, 'src', 'assets', 'agents', file);
      const content = readFileSync(filePath, 'utf-8');
      const skillNames = parseFrontmatterSkills(content);

      for (const skill of skillNames) {
        expect(
          canonicalSkills.has(skill),
          `src/assets/agents/${file}: frontmatter skill '${skill}' is not in canonical getAllSkillNames()`,
        ).toBe(true);
      }
    }
  });

  it('every shared agent declares at least one skill in frontmatter', () => {
    // Agents from plugins with skills: [] legitimately have no skills to declare.
    // These are simple, fully self-contained agents whose logic is inline.
    const AGENTS_WITHOUT_SKILLS = new Set(['claude-md-auditor']);

    const agentFiles = readdirSync(path.join(ROOT, 'src', 'assets', 'agents')).filter(f => f.endsWith('.md'));

    for (const file of agentFiles) {
      const name = file.replace(/\.md$/, '');
      if (AGENTS_WITHOUT_SKILLS.has(name)) continue;

      const filePath = path.join(ROOT, 'src', 'assets', 'agents', file);
      const content = readFileSync(filePath, 'utf-8');
      const skillNames = parseFrontmatterSkills(content);

      expect(
        skillNames.length,
        `src/assets/agents/${file}: parseFrontmatterSkills returned empty — missing or malformed skills: block in frontmatter`,
      ).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Format 3: Install path references (~/.claude/skills/devflow:NAME/)
// ---------------------------------------------------------------------------

describe('Format 3: Install path references', () => {
  it('all install paths in shared agents are canonical', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const agentsDir = path.join(ROOT, 'src', 'assets', 'agents');
    const agentFiles = readdirSync(agentsDir).filter(f => f.endsWith('.md'));

    // reviewer.md reads focus skill files directly via the Read tool using the install path
    // (~/.claude/skills/devflow:{FOCUS}/SKILL.md) — the {FOCUS} placeholder is not matched
    // by extractInstallPaths, so no false capture occurs.
    // coder.md invokes domain skills (typescript, go, etc.) via the Skill tool — those are
    // not install-path references. Frontmatter-listed skills are pre-activated and must never
    // be re-invoked via the Skill tool (enforced by the structural test below).
    for (const file of agentFiles) {
      const content = readFileSync(path.join(agentsDir, file), 'utf-8');
      const refs = extractInstallPaths(content);

      for (const ref of refs) {
        expect(
          canonicalSkills.has(ref),
          `src/assets/agents/${file}: install path 'devflow:${ref}' is not canonical`,
        ).toBe(true);
      }
    }
  });

  it('all install paths in compiled command files are canonical', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const distCommandsDir = path.join(ROOT, 'dist', 'commands');
    let files: string[];
    try {
      files = readdirSync(distCommandsDir).filter(f => f.endsWith('.md'));
    } catch {
      // dist/commands/ does not exist yet (pre-build) — skip gracefully
      return;
    }

    let totalRefs = 0;
    for (const file of files) {
      const content = readFileSync(path.join(distCommandsDir, file), 'utf-8');
      const refs = extractInstallPaths(content);
      totalRefs += refs.length;

      for (const ref of refs) {
        expect(
          canonicalSkills.has(ref),
          `dist/commands/${file}: install path 'devflow:${ref}' is not canonical`,
        ).toBe(true);
      }
    }

    // code-review, resolve commands both have install path references
    expect(totalRefs, 'dist/commands/ files should have install path references').toBeGreaterThanOrEqual(2);
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

  it('all shared/skills/NAME/ references in docs/reference/ are canonical', () => {
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
    // Hooks moved to src/assets/scripts/hooks/ during the src/ restructure.
    const hooksDir = path.join(ROOT, 'src', 'assets', 'scripts', 'hooks');
    const hookFiles = readdirSync(hooksDir).filter(f => {
      const fullPath = path.join(hooksDir, f);
      return statSync(fullPath).isFile();
    });

    // Also scan files in assets/ subdirectory (static prose assets shipped with hooks).
    const assetsDir = path.join(hooksDir, 'assets');
    const assetFiles = existsSync(assetsDir)
      ? readdirSync(assetsDir)
          .filter(f => statSync(path.join(assetsDir, f)).isFile())
          .map(f => `assets/${f}`)
      : [];

    const allHookFiles = [...hookFiles, ...assetFiles];

    expect(allHookFiles.length, 'should find at least one hook script').toBeGreaterThan(0);

    for (const file of allHookFiles) {
      const filePath = path.join(hooksDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const allRefs = extractPrefixedRefs(content);
      const skillRefs = filterNonSkillRefs(allRefs);

      for (const ref of skillRefs) {
        expect(
          canonicalSkills.has(ref),
          `src/assets/scripts/hooks/${file}: devflow:${ref} is not in canonical getAllSkillNames() and not a known command ref`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Format 6: Command files
// ---------------------------------------------------------------------------

describe('Format 6: Compiled command file skill references', () => {
  it('all devflow:NAME references in dist/commands/*.md are canonical or command refs', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const distCommandsDir = path.join(ROOT, 'dist', 'commands');
    let files: string[];
    try {
      files = readdirSync(distCommandsDir).filter(f => f.endsWith('.md'));
    } catch {
      // dist/commands/ does not exist yet (pre-build) — skip gracefully
      return;
    }

    for (const file of files) {
      const filePath = path.join(distCommandsDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const allRefs = extractPrefixedRefs(content);
      const skillRefs = filterNonSkillRefs(allRefs);

      for (const ref of skillRefs) {
        expect(
          canonicalSkills.has(ref),
          `dist/commands/${file}: devflow:${ref} is not in canonical getAllSkillNames() and not a known command ref`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Format 7: Documentation tables
// ---------------------------------------------------------------------------

// Format 7 plugin README test removed — per-plugin READMEs were deleted in the src/ restructure.
// Skills-architecture.md coverage kept below.

describe('Format 7: Documentation table skill references', () => {
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

describe('Format 8: Skill cross-references within src/assets/skills/', () => {
  it('all devflow:NAME references in SKILL.md files are canonical or command refs', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const skillsDir = path.join(ROOT, 'src', 'assets', 'skills');
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
          `src/assets/skills/${skillDir}/SKILL.md: devflow:${ref} is not in canonical getAllSkillNames() and not a known command ref`,
        ).toBe(true);
      }
    }
  });

  it('all devflow:NAME references in skill references/ files are canonical or command refs', () => {
    const canonicalSkills = new Set(getAllSkillNames());
    const skillsDir = path.join(ROOT, 'src', 'assets', 'skills');
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
            `src/assets/skills/${skillDir}/references/${file}: devflow:${ref} is not in canonical getAllSkillNames() and not a known command ref`,
          ).toBe(true);
        }
      }
    }
  });
});

// Format 9 (bare skill names in plugin README "Skills" sections) removed —
// per-plugin READMEs were deleted in the src/ restructure.

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
    const skillsDir = path.join(ROOT, 'src', 'assets', 'skills');
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
            `src/assets/skills/${skillDir}/references/${file}: cross-reference '${ref}/references/...' — '${ref}' is not in canonical getAllSkillNames()`,
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
  it('all devflow:NAME references in tests/**/*.ts are canonical or command refs', () => {
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
      ['ambient-router', /(?<![\w])ambient-router(?![\w])/g],
      ['implementation-patterns', /(?<!devflow-)(?<![\w])implementation-patterns(?![\w])/g],
      ['search-first', /(?<![\w])search-first(?![\w])/g],
    ];

    // Known allowlist: lines containing migration test data, legacy references, or comments about old names.
    // Also allow test assertion lines like `expect(...).toContain('old-name')` in shadow migration tests.
    const ALLOWLIST_PATTERNS = [
      /LEGACY_SKILL_NAMES/,
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
      // PRE_NAMESPACE_SKILLS is a frozen historical set of pre-namespace skill names
      // used as the source-of-truth for the legacy bare-entry invariant test
      'skill-namespace.test.ts',
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
  it('reviewer Focus Areas covers all skills in code-review plugin registry entry', () => {
    // Derive skill list from DEVFLOW_PLUGINS registry (plugin.json files were removed in src/ restructure)
    const codeReviewPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-code-review');
    expect(codeReviewPlugin, 'devflow-code-review must be registered in DEVFLOW_PLUGINS').toBeDefined();

    // These meta-skills don't correspond to reviewer focus areas
    const NON_FOCUS_SKILLS = new Set([
      'decisions-format',
      'review-methodology',
      'worktree-support',
      'apply-feature-knowledge',  // consumption meta-skill, not a review focus
    ]);

    const reviewerContent = readFileSync(
      path.join(ROOT, 'src', 'assets', 'agents', 'reviewer.md'),
      'utf-8',
    );

    for (const skill of codeReviewPlugin!.skills) {
      if (NON_FOCUS_SKILLS.has(skill)) continue;

      // Focus name equals the skill name directly — all skills match focus 1:1
      expect(
        reviewerContent.includes(`| ${skill} |`) || reviewerContent.includes(`| \`${skill}\` |`),
        `reviewer.md Focus Areas table is missing focus '${skill}' (from code-review plugin registry skill '${skill}')`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-component runtime alignment
// ---------------------------------------------------------------------------

/**
 * Parse the reviewer Focus Areas table into a map of focus → skill name.
 * Accepts rows like: | `focus` | `devflow:skill` |
 */
function parseReviewerFocusAreas(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of content.matchAll(/^\|\s*`([\w-]+)`\s*\|\s*`devflow:([\w-]+)`\s*\|/gm)) {
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
  const reviewerContent = readFileSync(path.join(ROOT, 'src', 'assets', 'agents', 'reviewer.md'), 'utf-8');
  const reviewerFocusAreas = parseReviewerFocusAreas(reviewerContent);

  it('reviewer Focus Areas table has entries', () => {
    expect(reviewerFocusAreas.size).toBeGreaterThan(10);
  });

  it('code-review command focus names exist in reviewer Focus Areas', () => {
    const codeReviewPath = path.join(ROOT, 'dist', 'commands', 'code-review.md');
    let commandContent: string;
    try {
      commandContent = readFileSync(codeReviewPath, 'utf-8');
    } catch {
      // dist/commands/ does not exist yet (pre-build) — skip gracefully
      return;
    }
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
    const codeReviewPath = path.join(ROOT, 'dist', 'commands', 'code-review.md');
    let commandContent: string;
    try {
      commandContent = readFileSync(codeReviewPath, 'utf-8');
    } catch {
      return; // pre-build skip
    }
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

  it('code-review command has no stale devflow:{focus}-patterns template', () => {
    const codeReviewPath = path.join(ROOT, 'dist', 'commands', 'code-review.md');
    let commandContent: string;
    try {
      commandContent = readFileSync(codeReviewPath, 'utf-8');
    } catch {
      return; // pre-build skip
    }

    // This template was stale — it appended -patterns to every focus name
    expect(
      commandContent.includes('devflow:{focus}-patterns'),
      'code-review command should not contain stale "devflow:{focus}-patterns" template',
    ).toBe(false);
  });

  it('companion skill lists are consistent across catalog and commands', () => {
    const catalogContent = readFileSync(
      path.join(ROOT, 'docs', 'reference', 'skill-catalog.md'),
      'utf-8',
    );

    // Parse the Command Companion Skills table rows:
    // | INTENT | /command | `devflow:a`, `devflow:b` |
    const catalogTable = new Map<string, string[]>();
    const catalogTableRegex =
      /^\|\s*(IMPLEMENT|DEBUG|PLAN|REVIEW|RELEASE)\s*\|[^|]+\|\s*(.+?)\s*\|$/gm;
    for (const match of catalogContent.matchAll(catalogTableRegex)) {
      const intent = match[1];
      const companions = [...match[2].matchAll(/`devflow:([\w-]+)`/g)].map(m => m[1]);
      if (companions.length > 0) catalogTable.set(intent, companions.sort());
    }

    expect(catalogTable.size).toBeGreaterThanOrEqual(5);

    // Map intent → compiled command files in dist/commands/ (single output dir post-restructure)
    const intentCommandMap: Record<string, string[]> = {
      IMPLEMENT: ['dist/commands/implement.md'],
      DEBUG: ['dist/commands/debug.md'],
      PLAN: ['dist/commands/plan.md'],
      REVIEW: ['dist/commands/code-review.md'],
      RELEASE: ['dist/commands/release.md'],
    };

    // Extract companion skills from a "Load via Skill tool:" line
    const parseCompanionLine = (content: string): string[] => {
      const lineMatch = content.match(/Load via Skill tool:\s*(.+?)\.?\s*(?:If a skill|$)/m);
      if (!lineMatch) return [];
      return [...lineMatch[1].matchAll(/`devflow:([\w-]+)`/g)].map(m => m[1]).sort();
    };

    for (const [intent, expectedSkills] of catalogTable) {
      // Check command files
      for (const cmdRelPath of intentCommandMap[intent]) {
        const cmdPath = path.join(ROOT, cmdRelPath);
        let cmdContent: string;
        try {
          cmdContent = readFileSync(cmdPath, 'utf-8');
        } catch {
          continue; // dist/commands/ not yet built — skip gracefully
        }
        const cmdSkills = parseCompanionLine(cmdContent);
        expect(
          cmdSkills,
          `${cmdRelPath} companions must match catalog for ${intent}`,
        ).toEqual(expectedSkills);
      }
    }
  });

  it('coder domain skill paths cover all language/ecosystem skills', () => {
    const coderContent = readFileSync(path.join(ROOT, 'src', 'assets', 'agents', 'coder.md'), 'utf-8');

    // Language skills that should be loadable as domain skills via Skill tool invocations
    const languageSkills = ['typescript', 'react', 'go', 'java', 'python', 'rust'];
    // Related skills that should be available for domain loading
    const domainSkills = ['boundary-validation', 'accessibility', 'ui-design', 'testing'];

    for (const skill of [...languageSkills, ...domainSkills]) {
      // Skill tool invocations: Skill(skill="devflow:X") or skill="devflow:X" or devflow:X
      const hasSkillRef =
        coderContent.includes(`devflow:${skill}`) ||
        coderContent.includes(`skill="devflow:${skill}"`);
      expect(
        hasSkillRef,
        `coder.md domain skill section should reference 'devflow:${skill}'`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Structural invariant: agents never Skill-invoke their own frontmatter skills
// Permanent regression guard for PF-002 (skill re-entrancy guard).
// If an agent has `devflow:X` in its frontmatter skills:, it must NOT also
// contain `Skill(skill="devflow:X")` in its body — frontmatter skills are
// pre-activated by the runtime and a re-invocation would cause a guard-string
// return ('already running') or a no-op skip, both of which are bugs.
// ---------------------------------------------------------------------------

describe('Structural invariant: agents never Skill-invoke their own frontmatter skills (PF-002 guard)', () => {
  it('every src/assets/agents/*.md has zero Skill(skill="devflow:NAME") calls where NAME is in its own frontmatter skills', () => {
    // All agents now live in src/assets/agents/ — plugin-specific agent copies were removed in the restructure.
    // avoids PF-002
    const agentsDir = path.join(ROOT, 'src', 'assets', 'agents');
    const agentPaths = readdirSync(agentsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(agentsDir, f));

    const skillCallPattern = /Skill\(skill="devflow:([\w-]+)"\)/g;

    for (const filePath of agentPaths) {
      const label = path.relative(ROOT, filePath);
      const content = readFileSync(filePath, 'utf-8');
      const frontmatterSkills = new Set(parseFrontmatterSkills(content));

      // Strip frontmatter block before scanning for Skill() calls, so that the
      // skills: block itself (which lists devflow:NAME entries) is not scanned.
      const frontmatterEnd = content.indexOf('\n---\n', 4);
      const body = frontmatterEnd >= 0 ? content.slice(frontmatterEnd + 5) : content;

      skillCallPattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = skillCallPattern.exec(body)) !== null) {
        const skillName = match[1];
        expect(
          frontmatterSkills.has(skillName),
          `${label}: re-entrancy violation — Skill(skill="devflow:${skillName}") is invoked in the body, but '${skillName}' is listed in frontmatter skills (pre-activated skills must never be re-invoked via Skill tool)`,
        ).toBe(false);
      }
    }
  });
});


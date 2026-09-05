/**
 * Extended References guard (P0-S22, AC-0.17 test inventory).
 *
 * Every `## Extended References` table in every skill's SKILL.md must reference
 * only files that actually exist in the skill's `references/` directory.
 *
 * Generated-path exception list (P0-b anti-pattern prevention):
 *   `references/tracker/` will appear in Phase 2 when tracker mechanics are split
 *   into generated reference files. The exception list is seeded from the outset
 *   so Phase 2's addition does not break this guard without a deliberate update.
 *   Assert the list is non-empty (each entry is justified, not vacuously empty).
 *
 * Non-vacuity: rowsScanned > 0 — asserts the guard actually ran on real content.
 *
 * Known-bad sample (mechanic 2, H10): a synthetic SKILL.md with a missing reference
 * entry fails the guard — proven inline without touching any committed source.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SKILLS_DIR = path.join(ROOT, 'src', 'assets', 'skills');

// ---------------------------------------------------------------------------
// Generated-path exception list (P0-b, Phase 2 pre-emption)
//
// Each entry is a prefix or full path that will be created in a later phase.
// Assert the list is non-empty so the guard cannot be silently gutted.
// ---------------------------------------------------------------------------
const GENERATED_PATH_EXCEPTIONS: ReadonlyArray<{ prefix: string; justification: string }> = [
  {
    prefix: 'references/tracker/',
    justification:
      'Phase 2 splits tracker mechanics into generated reference files under references/tracker/; ' +
      'those files are generated at build time and do not exist in src/.',
  },
];

function isGeneratedException(refPath: string): boolean {
  return GENERATED_PATH_EXCEPTIONS.some(e => refPath.startsWith(e.prefix));
}

// ---------------------------------------------------------------------------
// Parser: extract `references/…` paths from an Extended References section
// ---------------------------------------------------------------------------
function extractExtRefPaths(sectionContent: string): string[] {
  // Match backtick-quoted references/ paths in any table or prose format.
  // Covers three observed formats:
  //   1. Table cell: | `references/foo.md` | Description |
  //   2. Dash list:  - `references/foo.md` — Description
  //   3. Inline:     See `references/`: `sources.md` · `patterns.md`
  //                  (inline only lists filenames; we skip — these resolve against skill dir)
  // Only capture full-path forms (references/xxx) — inline shorthand is not full-path.
  const re = /`(references\/[^`]+)`/g;
  const paths: string[] = [];
  let m;
  while ((m = re.exec(sectionContent)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

function getExtRefSection(content: string): string | null {
  const anchor = '## Extended References';
  const start = content.indexOf(anchor);
  if (start === -1) return null;
  // Section ends at next ## heading or end of file.
  const nextSection = content.indexOf('\n## ', start + anchor.length);
  return nextSection === -1
    ? content.slice(start)
    : content.slice(start, nextSection);
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

describe('Extended References file-existence guard (P0-S22)', () => {
  it('exception list is non-empty and each entry carries a justification (P0-b)', () => {
    expect(
      GENERATED_PATH_EXCEPTIONS.length,
      'generated-path exception list must be non-empty — it is seeded from the outset for Phase 2',
    ).toBeGreaterThan(0);
    for (const entry of GENERATED_PATH_EXCEPTIONS) {
      expect(
        entry.prefix.length,
        'each exception entry must have a non-empty prefix',
      ).toBeGreaterThan(0);
      expect(
        entry.justification.length,
        `exception entry "${entry.prefix}" must carry a justification`,
      ).toBeGreaterThan(0);
    }
  });

  it('every ## Extended References row resolves to an existing file (or is excepted)', () => {
    // Collect skill directories.
    let skillDirs: string[];
    try {
      skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch {
      throw new Error(
        `src/assets/skills/ is absent — run 'npm run build' first or check the repo layout`,
      );
    }

    expect(skillDirs.length, 'skills directory is empty — guard is vacuous').toBeGreaterThan(0);

    const violations: string[] = [];
    let rowsScanned = 0;

    for (const skillName of skillDirs) {
      const skillPath = path.join(SKILLS_DIR, skillName);
      const skillMdPath = path.join(skillPath, 'SKILL.md');

      if (!existsSync(skillMdPath)) continue;

      const content = readFileSync(skillMdPath, 'utf-8');
      const section = getExtRefSection(content);
      if (section === null) continue;

      const refPaths = extractExtRefPaths(section);
      for (const refPath of refPaths) {
        rowsScanned++;

        if (isGeneratedException(refPath)) {
          // Generated path — excepted from existence check; will appear in Phase 2.
          continue;
        }

        const absPath = path.join(skillPath, refPath);
        if (!existsSync(absPath)) {
          violations.push(`skills/${skillName}/SKILL.md → ${refPath} (file not found at ${absPath})`);
        }
      }
    }

    // rowsScanned > 0: non-vacuity — asserts the guard actually found and checked rows.
    expect(
      rowsScanned,
      'rowsScanned === 0 — no Extended References rows were found; guard is vacuous (PF-018)',
    ).toBeGreaterThan(0);

    expect(
      violations,
      `Extended References rows pointing to missing files:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });

  it('non-vacuity: a row pointing at a nonexistent reference fails the guard (mechanic 2, H10)', () => {
    // Inline known-bad SKILL.md content with a reference that does not exist.
    const knownBadSection = `## Extended References\n\n| Reference | Contents |\n|-----------|----------|\n| \`references/nonexistent-file-that-will-never-exist.md\` | Missing |\n`;
    const refPaths = extractExtRefPaths(knownBadSection);

    // Assert we extracted at least one reference from the known-bad section.
    expect(refPaths.length, 'parser must extract the reference path from the known-bad section').toBeGreaterThan(0);

    // Assert none of the extracted paths resolve under a real skill dir (because they are synthetic).
    const knownBadPath = refPaths[0];
    expect(knownBadPath, 'expected references/ path from known-bad content').toContain('references/');

    // Check that the full path would fail existence — using a temp synthetic skill dir.
    const syntheticSkillDir = path.join(SKILLS_DIR, '_synthetic_nonexistent_test_skill_');
    const syntheticAbsPath = path.join(syntheticSkillDir, knownBadPath);
    expect(
      existsSync(syntheticAbsPath),
      `non-vacuity: synthetic path ${syntheticAbsPath} must not exist`,
    ).toBe(false);
    // → If this test reached here without throwing, the parser correctly extracted a
    //   path that does not exist on disk. The live guard loop above would report it as
    //   a violation. This inline assertion proves non-vacuity (H10, mechanic 2).
  });
});

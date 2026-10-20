/**
 * cli-hud-boundary — no file under src/cli imports from src/hud/components.
 *
 * The statusline components are the HUD's own: they read the working directory and the
 * machine on every prompt, under the HUD's budget, and they ship in the HUD's own
 * install closure. A command in src/cli that imports one couples the CLI to the HUD's
 * internals. What both must say or compute lives in src/core, and both import it from
 * there (the move notice is the case: src/core/curation-move-notice.ts).
 *
 * The scan reads each import, re-export and dynamic import specifier of every `.ts`
 * file under src/cli, resolves a relative one against the file's folder, and refuses a
 * result inside src/hud/components. The live arm scans the real tree; the control arm
 * feeds the matcher the offending spellings, so a matcher that stopped matching would
 * fail here and not pass for a clean tree.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { ROOT, walkFiles } from '../helpers.js';

const CLI_DIR = path.join(ROOT, 'src', 'cli');
const HUD_COMPONENTS_DIR = path.join(ROOT, 'src', 'hud', 'components');

/** The module specifiers a source text imports, re-exports or dynamically imports. */
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/** The specifiers of `source`, as read from `file`, that land inside src/hud/components. */
function hudComponentImports(file: string, source: string): string[] {
  return specifiersOf(source).filter((specifier) => {
    if (!specifier.startsWith('.')) return false;
    const resolved = path.resolve(path.dirname(file), specifier);
    return resolved === HUD_COMPONENTS_DIR || resolved.startsWith(HUD_COMPONENTS_DIR + path.sep);
  });
}

describe('src/cli does not import from src/hud/components', () => {
  it('holds for every file under src/cli', () => {
    const files = walkFiles(CLI_DIR, (file) => file.endsWith('.ts'));
    expect(files.length, 'the scan found the CLI sources').toBeGreaterThan(10);
    const offenders = files.flatMap((file) =>
      hudComponentImports(file, readFileSync(file, 'utf-8')).map((specifier) => `${path.relative(ROOT, file)} imports ${specifier}`));
    expect(offenders).toEqual([]);
  });

  describe('the matcher still sees each spelling (control)', () => {
    const at = path.join(CLI_DIR, 'commands', 'example.ts');
    it.each([
      ["import { a } from '../../hud/components/curation-counts.js';"],
      ["import type { A } from '../../hud/components/curation-counts.js';"],
      ["export { a } from '../../hud/components/curation-counts.js';"],
      ["import '../../hud/components/curation-counts.js';"],
      ["const m = await import('../../hud/components/curation-counts.js');"],
      ["import {\n  a,\n  b,\n} from '../../hud/components/curation-counts.js';"],
    ])('flags %s', (source) => {
      expect(hudComponentImports(at, source)).toEqual(['../../hud/components/curation-counts.js']);
    });

    it('leaves the core and the rest of the HUD alone', () => {
      expect(hudComponentImports(at, "import { a } from '../../core/curation-move-notice.js';")).toEqual([]);
      expect(hudComponentImports(at, "import { b } from '../../hud/types.js';")).toEqual([]);
      expect(hudComponentImports(at, "import { c } from 'node:fs';")).toEqual([]);
    });
  });
});

/**
 * no-autocompact-pct-override — devflow never writes, manages or names the
 * percent-based auto-compact override anywhere under `src/` (AC-411).
 *
 * D-AUTO-COMPACT-WINDOW-OPT-IN (src/core/flags.ts): devflow's one auto-compact
 * knob is the opt-in `auto-compact-window` flag, which maps to the window-size
 * variable and is unset by default. The percent-based override is a different
 * variable whose effect on a compaction mid-command was never observed, so it is
 * out of scope in every form, including a mention: a name in shipped text is one
 * paste from a managed key. Decision comments describe it in words ("the
 * percent-based auto-compact override"), never by its name.
 *
 * This is a permanent guard, not a one-time grep. It reads every non-binary file
 * under `src/` (hooks, scripts, prompts, skills, rules, templates and TypeScript
 * alike) and fails with each offending path and line. A green run means: no spelling
 * of the variable's name, in any letter case, in the files the walk reached; the
 * reach arm names a sentinel per surface class so a shrunken corpus fails by name
 * rather than passing silently. It does not prove that nothing sets the variable by
 * another route (a name built at runtime is not representable here).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { ROOT, walkFiles, type CorpusEntry } from '../helpers.js';

/** The variable's name. It is spelled here, in a test, because the guard must match it; src/ never may. */
const FORBIDDEN_NAME = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

/** Any letter case, and as a substring, so a compound identifier built around the name is caught too. */
const FORBIDDEN = new RegExp(FORBIDDEN_NAME, 'i');

interface Violation {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Every line of `corpus` that names the variable. Pure — the live arm and the
 * seeded probes run this same function, so the probes prove the matcher the live
 * arm uses.
 */
function findViolations(corpus: readonly CorpusEntry[]): Violation[] {
  const violations: Violation[] = [];
  for (const entry of corpus) {
    entry.content.split('\n').forEach((raw, index) => {
      if (FORBIDDEN.test(raw)) violations.push({ path: entry.path, line: index + 1, text: raw.trim() });
    });
  }
  return violations;
}

const BINARY_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2'];

function readCorpus(dir: string): CorpusEntry[] {
  return walkFiles(dir, file => !BINARY_EXTENSIONS.includes(path.extname(file))).map(file => ({
    path: path.relative(ROOT, file).split(path.sep).join('/'),
    content: readFileSync(file).toString('latin1'),
  }));
}

/** One sentinel per surface class that could carry a managed key: the flag registry, a hook, a script, a template, a prompt. */
const REACH_SENTINELS: readonly string[] = [
  'src/core/flags.ts',
  'src/cli/commands/flags.ts',
  'src/assets/scripts/hooks/session-start-context',
  'src/assets/scripts/claude-md-audit.cjs',
  'src/targets/claude-code/templates/settings.json',
  'src/assets/commands/implement.mds',
  'src/assets/rules/context-economy.md',
];

const corpus: CorpusEntry[] = readCorpus(path.join(ROOT, 'src'));

describe('no percent-based auto-compact override under src/ (AC-411, D-AUTO-COMPACT-WINDOW-OPT-IN)', () => {
  it('reaches a sentinel of every surface class', () => {
    const reached = new Set(corpus.map(entry => entry.path));
    const missing = REACH_SENTINELS.filter(sentinel => !reached.has(sentinel));
    expect(missing, `the corpus does not reach: ${missing.join(', ')}`).toEqual([]);
  });

  it('no file under src/ names the variable', () => {
    const violations = findViolations(corpus);
    expect(
      violations,
      violations.map(v => `${v.path}:${v.line}  ${v.text}`).join('\n'),
    ).toEqual([]);
  });

  describe('known-bad probes (the matcher can go red)', () => {
    const probe = (content: string): Violation[] => findViolations([{ path: 'probe.txt', content }]);

    it.each([
      ['an env assignment', `env: { ${FORBIDDEN_NAME}: '80' }`],
      ['a lower-case spelling', `process.env.${FORBIDDEN_NAME.toLowerCase()}`],
      ['a comment', `// see ${FORBIDDEN_NAME} for details`],
      ['a compound identifier', `const MY_${FORBIDDEN_NAME}_KEY = 1`],
      ['a shell export', `export ${FORBIDDEN_NAME}=70`],
    ])('flags %s', (_label, content) => {
      expect(probe(`first line\n${content}\nlast line`)).toEqual([
        { path: 'probe.txt', line: 2, text: content },
      ]);
    });

    it('does not flag the opt-in window variable or a description in words', () => {
      expect(probe('CLAUDE_CODE_AUTO_COMPACT_WINDOW')).toEqual([]);
      expect(probe('the percent-based auto-compact override is never written')).toEqual([]);
    });
  });
});

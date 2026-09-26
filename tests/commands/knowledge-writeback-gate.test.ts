/**
 * D-KNOWLEDGE-MASTER-SWITCH (#378) — the knowledge write-back gate is prose the
 * orchestrating model follows, compiled from ONE partial
 * (src/assets/commands/_partials/_knowledge.mds, `knowledge_writeback`) into
 * every command that writes knowledge back. `devflow init --no-knowledge` records
 * `features.knowledge: false` in ~/.devflow/manifest.json; a gate that read only
 * the repo's .devflow/config.json kept writing KBs in every repo but the one init
 * ran in. Every compiled write-back step must consult BOTH switches.
 *
 * PF-064 shape: a NAMED collector, a non-vacuity assertion over what it read,
 * and a known-bad probe driving the same collector over the pre-fix wording.
 */
import { describe, it, expect } from 'vitest';
import { requireDistFile, requireDistFiles } from '../helpers.js';

const STEP_HEADING = '### Feature Knowledge Write-Back (Conditional)';
const STEP_1 = '**Step 1';
const STEP_2 = '**Step 2';

/** The gates a compiled Step 1 must carry, each labelled so a miss names itself. */
const REQUIRED_GATES: ReadonlyArray<readonly [string, RegExp]> = [
  ['the machine-wide manifest read', /`~\/\.devflow\/manifest\.json`/],
  ['the machine-wide knowledge field', /`features\.knowledge` is `false`/],
  ['the per-repo config read', /\.devflow\/config\.json`/],
  ['the per-repo knowledge field', /`knowledge` field is `false`/],
];

/** Named collector: the gate labels missing from a compiled write-back Step 1. */
function collectMissingGates(commandText: string): string[] {
  const at = commandText.indexOf(STEP_HEADING);
  if (at === -1) return ['no write-back step'];
  const section = commandText.slice(at);
  const s1 = section.indexOf(STEP_1);
  const s2 = section.indexOf(STEP_2);
  if (s1 === -1 || s2 === -1 || s2 < s1) return ['Step 1 not found'];
  const step1 = section.slice(s1, s2);
  return REQUIRED_GATES.filter(([, rule]) => !rule.test(step1)).map(([label]) => label);
}

/** Every compiled command that carries the write-back step (by its heading). */
function writebackCommands(): string[] {
  return requireDistFiles().filter(f => requireDistFile(f).includes(STEP_HEADING));
}

describe('knowledge write-back gate honours the machine-wide switch', () => {
  it('reads a real corpus: the write-back step is compiled into the commands that import it', () => {
    // Non-vacuity (PF-018): an empty or truncated set would pass every check below.
    expect(writebackCommands().sort()).toEqual(
      ['debug.md', 'explore.md', 'implement.md', 'resolve.md', 'self-review.md'],
    );
  });

  it('every compiled write-back Step 1 consults both the manifest and the repo config', () => {
    for (const file of writebackCommands()) {
      expect(collectMissingGates(requireDistFile(file)), `${file} write-back gate`).toEqual([]);
    }
  });

  it('known-bad probe: the pre-fix, config-only gate is reported by the same collector', () => {
    const preFix = [
      STEP_HEADING,
      '',
      '**Step 1 — Check the opt-out gate:**',
      '',
      'Read `{worktree}/.devflow/config.json`. If the `knowledge` field is `false`, skip write-back entirely — the user has disabled it.',
      '',
      'If `.devflow/config.json` does not exist, proceed (default is enabled).',
      '',
      '**Step 2 — Evaluate whether write-back is warranted:**',
    ].join('\n');
    expect(collectMissingGates(preFix)).toEqual([
      'the machine-wide manifest read',
      'the machine-wide knowledge field',
    ]);
  });
});

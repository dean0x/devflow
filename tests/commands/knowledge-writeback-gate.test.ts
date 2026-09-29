/**
 * D-FEATURES-NARROW-ONLY (#378, #392) — the knowledge write-back gate is prose the
 * orchestrating model follows, compiled from ONE partial
 * (src/assets/commands/_partials/_knowledge.mds, `knowledge_writeback`) into
 * every command that writes knowledge back. Knowledge is switched for the whole
 * machine by `features.knowledge` in ~/.devflow/manifest.json and by nothing
 * else: a gate that read the repo's .devflow/config.json kept writing KBs in
 * every repo but the one `devflow init --no-knowledge` ran in, and a gate that
 * still honoured the retired per-repo key would let a stale value decide.
 *
 * PF-064 shape: a NAMED collector, a non-vacuity assertion over what it read,
 * and known-bad probes driving the same collector over the superseded wordings.
 */
import { describe, it, expect } from 'vitest';
import { requireDistFile, requireDistFiles } from '../helpers.js';

const STEP_HEADING = '### Feature Knowledge Write-Back (Conditional)';
const STEP_1 = '**Step 1';
const STEP_2 = '**Step 2';

/** The gate a compiled Step 1 must carry, each part labelled so a miss names itself. */
const REQUIRED_GATES: ReadonlyArray<readonly [string, RegExp]> = [
  ['the machine-wide manifest read', /`~\/\.devflow\/manifest\.json`/],
  ['the machine-wide knowledge field', /`features\.knowledge` is `false`/],
];

/** Wording a compiled Step 1 must NOT carry: a per-repo gate on the retired key. */
const FORBIDDEN_GATES: ReadonlyArray<readonly [string, RegExp]> = [
  ['a per-repo knowledge field gate', /`knowledge` field is `false`/],
];

/** Named collector: the gate problems in a compiled write-back Step 1. */
function collectGateProblems(commandText: string): string[] {
  const at = commandText.indexOf(STEP_HEADING);
  if (at === -1) return ['no write-back step'];
  const section = commandText.slice(at);
  const s1 = section.indexOf(STEP_1);
  const s2 = section.indexOf(STEP_2);
  if (s1 === -1 || s2 === -1 || s2 < s1) return ['Step 1 not found'];
  const step1 = section.slice(s1, s2);
  return [
    ...REQUIRED_GATES.filter(([, rule]) => !rule.test(step1)).map(([label]) => `missing: ${label}`),
    ...FORBIDDEN_GATES.filter(([, rule]) => rule.test(step1)).map(([label]) => `present: ${label}`),
  ];
}

/** Every compiled command that carries the write-back step (by its heading). */
function writebackCommands(): string[] {
  return requireDistFiles().filter(f => requireDistFile(f).includes(STEP_HEADING));
}

describe('knowledge write-back gate reads the machine-wide switch only', () => {
  it('reads a real corpus: the write-back step is compiled into the commands that import it', () => {
    // Non-vacuity (PF-018): an empty or truncated set would pass every check below.
    expect(writebackCommands().sort()).toEqual(
      ['debug.md', 'explore.md', 'implement.md', 'resolve.md', 'self-review.md'],
    );
  });

  it('every compiled write-back Step 1 consults the manifest and no per-repo key', () => {
    for (const file of writebackCommands()) {
      expect(collectGateProblems(requireDistFile(file)), `${file} write-back gate`).toEqual([]);
    }
  });

  it('known-bad probe: the original config-only gate is reported by the same collector', () => {
    const configOnly = [
      STEP_HEADING,
      '',
      '**Step 1 — Check the opt-out gate:**',
      '',
      'Read `{worktree}/.devflow/config.json`. If the `knowledge` field is `false`, skip write-back entirely — the user has disabled it.',
      '',
      '**Step 2 — Evaluate whether write-back is warranted:**',
    ].join('\n');
    expect(collectGateProblems(configOnly)).toEqual([
      'missing: the machine-wide manifest read',
      'missing: the machine-wide knowledge field',
      'present: a per-repo knowledge field gate',
    ]);
  });

  it('known-bad probe: the two-layer gate (manifest AND repo config) is reported too', () => {
    const twoLayer = [
      STEP_HEADING,
      '',
      '**Step 1 — Check the opt-out gates (both must allow write-back):**',
      '',
      '1. Machine-wide: read `~/.devflow/manifest.json`. If `features.knowledge` is `false`, skip write-back entirely.',
      '2. This project: read `{worktree}/.devflow/config.json`. If the `knowledge` field is `false`, skip write-back entirely.',
      '',
      '**Step 2 — Evaluate whether write-back is warranted:**',
    ].join('\n');
    expect(collectGateProblems(twoLayer)).toEqual(['present: a per-repo knowledge field gate']);
  });
});

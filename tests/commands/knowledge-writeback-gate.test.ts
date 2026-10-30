/**
 * D-FEATURES-NARROW-ONLY and D-SETTINGS-LINE (#378, #392) — the knowledge
 * write-back gate is prose the orchestrating model follows, compiled from ONE
 * partial (src/assets/commands/_partials/_knowledge.mds, `knowledge_writeback`)
 * into every command that writes knowledge back.
 *
 * Knowledge is on only when the machine switch, the repository's committed
 * `.devflow/project.json` and the personal `.devflow/config.json` all allow it,
 * and `resolve-settings.cjs` is the one place that folds the three. So the gate
 * takes `KNOWLEDGE` from the settings line and reads no file itself: a gate that
 * read the manifest alone ignored the repository's `features.knowledge: false`,
 * a gate that read the repo's config alone kept writing KBs in every repo but the
 * one `devflow init --no-knowledge` ran in, and a gate that read both was a
 * second, unvalidated parser. The fail-closed line says `KNOWLEDGE=off`, so an
 * unresolvable line skips write-back.
 *
 * The partial imports no settings partial (#426): its Step 1 takes the line the
 * host's own settings block resolved above, keeps the `KNOWLEDGE=off` skip at the
 * step, and carries no resolver call of its own. Each host carries that block once,
 * before its first consumer, and this file holds the order for the write-back.
 *
 * Step 2 is the other half of the gate: it decides whether a Knowledge agent runs
 * at all (a documented area changed, or durable cross-cutting knowledge was found;
 * otherwise skip silently). Only the /implement goldens held it, so its own named
 * collector checks it in every compiled write-back host.
 *
 * The shape an absence-based check needs: a NAMED collector, a non-vacuity
 * assertion over what it read, and known-bad probes driving the same collector
 * over the superseded wordings.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { requireDistFile, requireDistFiles } from '../helpers.js';
import { SETTINGS_SCRIPT } from '../evidence-policy/scripted-shim.js';

const { SETTINGS_FAIL_CLOSED_LINE } = createRequire(import.meta.url)(SETTINGS_SCRIPT) as {
  readonly SETTINGS_FAIL_CLOSED_LINE: string;
};

const STEP_HEADING = '### Feature Knowledge Write-Back (Conditional)';
const STEP_1 = '**Step 1';
const STEP_2 = '**Step 2';
const STEP_3 = '**Step 3';

/**
 * The parts a compiled Step 2 must carry. Each part names itself in a miss and holds
 * the text its known-bad probe puts in its place: nothing for a condition or the skip
 * line, the superseded gate line for the gate.
 */
const REQUIRED_STEP_2: ReadonlyArray<{ readonly label: string; readonly rule: RegExp; readonly seed: string }> = [
  {
    label: 'the write-back gate line',
    rule: /\*\*Step 2 — Write back only if at least one is true:\*\*/,
    seed: '**Step 2 — Evaluate whether write-back is warranted:**',
  },
  {
    label: 'the documented-area condition',
    rule: /changed files in a directory that is documented by an existing feature knowledge base \(a documented area changed\)/,
    seed: '',
  },
  {
    label: 'the durable-knowledge condition',
    rule: /found durable, cross-cutting knowledge about a codebase area/,
    seed: '',
  },
  {
    label: 'the silent skip line',
    rule: /^Otherwise skip write-back silently\.$/m,
    seed: '',
  },
];

/** The gate a compiled Step 1 must carry, each part labelled so a miss names itself. */
const REQUIRED_GATES: ReadonlyArray<readonly [string, RegExp]> = [
  ['the settings line resolved above', /take the settings line resolved above for that root/],
  ['the root bound to the checkout', /`\{root\}` = `\{worktree\}`/],
  ['the KNOWLEDGE=off skip', /`KNOWLEDGE=off`, skip write-back entirely/],
  ['the fail-closed clause', /The fail-closed line says `KNOWLEDGE=off` too/],
];

/** Wording a compiled Step 1 must NOT carry: a gate that reads a file for itself. */
const FORBIDDEN_GATES: ReadonlyArray<readonly [string, RegExp]> = [
  ['a direct manifest read', /\bread `~\/\.devflow\/manifest\.json`/i],
  ['a machine-field gate', /`features\.knowledge` is `false`/],
  ['a per-repo knowledge field gate', /`knowledge` field is `false`/],
  ['a settings block of its own', /resolve-settings\.cjs/],
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

/** Named collector: the problems in a compiled write-back Step 2 (the part from Step 2 up to Step 3). */
function collectStep2Problems(commandText: string): string[] {
  const at = commandText.indexOf(STEP_HEADING);
  if (at === -1) return ['no write-back step'];
  const section = commandText.slice(at);
  const s2 = section.indexOf(STEP_2);
  const s3 = section.indexOf(STEP_3);
  if (s2 === -1 || s3 === -1 || s3 < s2) return ['Step 2 not found'];
  const step2 = section.slice(s2, s3);
  return REQUIRED_STEP_2.filter(({ rule }) => !rule.test(step2)).map(({ label }) => `missing: ${label}`);
}

/** Every compiled command that carries the write-back step (by its heading). */
function writebackCommands(): string[] {
  return requireDistFiles().filter(f => requireDistFile(f).includes(STEP_HEADING));
}

/** A superseded Step 1, as the collector sees it. */
function step1Of(...lines: string[]): string {
  return [STEP_HEADING, '', ...lines, '', '**Step 2 — Evaluate whether write-back is warranted:**'].join('\n');
}

const ALL_MISSING = [
  'missing: the settings line resolved above',
  'missing: the root bound to the checkout',
  'missing: the KNOWLEDGE=off skip',
  'missing: the fail-closed clause',
];

const RESOLVER_INVOCATION = 'node "$HOME/.devflow/scripts/resolve-settings.cjs" "{root}" 2>/dev/null; echo "exit=$?"';

/** Named collector: write-back steps with no settings block above them, or with a second one. */
function collectBlockOrderProblems(commandText: string): string[] {
  const step = commandText.indexOf(STEP_HEADING);
  const blocks = commandText.split(RESOLVER_INVOCATION).length - 1;
  const first = commandText.indexOf(RESOLVER_INVOCATION);
  return [
    ...(blocks === 1 ? [] : [`${blocks} settings blocks`]),
    ...(first !== -1 && first < step ? [] : ['no settings block before the write-back step']),
  ];
}

describe('knowledge write-back gate takes KNOWLEDGE from the settings line', () => {
  it('reads a real corpus: the write-back step is compiled into the commands that import it', () => {
    // Non-vacuity: an empty or truncated set would pass every check below.
    expect(writebackCommands().sort()).toEqual(
      ['debug.md', 'explore.md', 'implement.md', 'resolve.md', 'self-review.md'],
    );
  });

  it('every compiled write-back Step 1 resolves the settings line and reads no file itself', () => {
    for (const file of writebackCommands()) {
      expect(collectGateProblems(requireDistFile(file)), `${file} write-back gate`).toEqual([]);
    }
  });

  it('every compiled write-back Step 2 carries the gate line, both conditions and the silent skip', () => {
    for (const file of writebackCommands()) {
      expect(collectStep2Problems(requireDistFile(file)), `${file} write-back Step 2`).toEqual([]);
    }
  });

  it('known-bad probe: each Step 2 part, taken out of the real text, is reported by the same collector', () => {
    const real = requireDistFile('implement.md');
    const section = real.slice(real.indexOf(STEP_HEADING));
    expect(collectStep2Problems(section), 'the real Step 2 is clean before any seed').toEqual([]);
    for (const { label, rule, seed } of REQUIRED_STEP_2) {
      const seeded = section.replace(rule, seed);
      expect(seeded, `the seed for "${label}" must change the text`).not.toBe(section);
      expect(collectStep2Problems(seeded), `Step 2 without ${label}`).toEqual([`missing: ${label}`]);
    }
  });

  it('known-bad probe: a write-back step with no Step 2 at all, and a text with no step, are reported', () => {
    const real = requireDistFile('implement.md');
    const section = real.slice(real.indexOf(STEP_HEADING));
    const gate = REQUIRED_STEP_2[0].rule;
    expect(collectStep2Problems(section.replace(gate, ''))).toEqual(['Step 2 not found']);
    expect(collectStep2Problems(section.replace(STEP_3, '**Step X'))).toEqual(['Step 2 not found']);
    expect(collectStep2Problems('')).toEqual(['no write-back step']);
  });

  it('every host carries one settings block, above its write-back step', () => {
    for (const file of writebackCommands()) {
      const text = requireDistFile(file);
      expect(collectBlockOrderProblems(text), `${file} settings block`).toEqual([]);
      expect(text, `${file}: the block holds the fail-closed line`).toContain(`\`${SETTINGS_FAIL_CLOSED_LINE}\``);
    }
  });

  it('known-bad probe: a write-back step with no block above it, and one with two, are reported', () => {
    const line = RESOLVER_INVOCATION
    expect(collectBlockOrderProblems(`${STEP_HEADING}\n${line}`)).toEqual(['no settings block before the write-back step'])
    expect(collectBlockOrderProblems(`${line}\n${STEP_HEADING}\n${line}`)).toEqual(['2 settings blocks'])
    expect(collectBlockOrderProblems(`${line}\n${STEP_HEADING}`)).toEqual([])
  });

  it('known-bad probe: a Step 1 that carries a resolver call of its own is reported', () => {
    const own = step1Of(
      '**Step 1 — Check the opt-out gate, with `{root}` = `{worktree}`:** take the settings line resolved above for that root.',
      '',
      RESOLVER_INVOCATION,
      '',
      'If the settings line says `KNOWLEDGE=off`, skip write-back entirely. The fail-closed line says `KNOWLEDGE=off` too.',
    );
    expect(collectGateProblems(own)).toEqual(['present: a settings block of its own']);
  });

  it('the fail-closed line the gate falls back to switches knowledge off', () => {
    expect(SETTINGS_FAIL_CLOSED_LINE.split(' ')).toContain('KNOWLEDGE=off');
  });

  it('known-bad probe: the original config-only gate is reported by the same collector', () => {
    const configOnly = step1Of(
      '**Step 1 — Check the opt-out gate:**',
      '',
      'Read `{worktree}/.devflow/config.json`. If the `knowledge` field is `false`, skip write-back entirely — the user has disabled it.',
    );
    expect(collectGateProblems(configOnly)).toEqual([...ALL_MISSING, 'present: a per-repo knowledge field gate']);
  });

  it('known-bad probe: the machine-only gate (#378) is reported too', () => {
    const machineOnly = step1Of(
      '**Step 1 — Check the opt-out gate:**',
      '',
      "Read `~/.devflow/manifest.json`. If `features.knowledge` is `false`, skip write-back entirely — the user disabled knowledge bases for every project (`devflow init --no-knowledge` or `devflow knowledge --disable`). The project's `.devflow/config.json` is not a gate: knowledge is switched machine-wide only.",
    );
    expect(collectGateProblems(machineOnly)).toEqual([
      ...ALL_MISSING,
      'present: a direct manifest read',
      'present: a machine-field gate',
    ]);
  });

  it('known-bad probe: the two-layer file-reading gate (manifest AND repo config) is reported too', () => {
    const twoLayer = step1Of(
      '**Step 1 — Check the opt-out gates (both must allow write-back):**',
      '',
      '1. Machine-wide: read `~/.devflow/manifest.json`. If `features.knowledge` is `false`, skip write-back entirely.',
      '2. This project: read `{worktree}/.devflow/config.json`. If the `knowledge` field is `false`, skip write-back entirely.',
    );
    expect(collectGateProblems(twoLayer)).toEqual([
      ...ALL_MISSING,
      'present: a direct manifest read',
      'present: a machine-field gate',
      'present: a per-repo knowledge field gate',
    ]);
  });
});

/**
 * The tracker provider's machine-side readers — two languages, one sentinel, and
 * no compiler standing between them; plus the per-repo key and its readers.
 *
 * Sections 1–3 — TS ↔ shell seam: the `.tracker.enabled` SENTINEL.
 *
 * The machine's tracker provider is written by TypeScript and read by shell:
 *
 *   - TypeScript — `applyTrackerSentinel` (src/core/tracker.ts), driven by
 *     `devflow init` and `devflow tracker --set`, writes the provider NAME on one
 *     line, and removes the file for github;
 *   - shell — `session-start-context`'s Section 3 reads it with the `read`
 *     builtin (zero forks) and admits the token through a POSITIVE allowlist
 *     before any path or directive sees it.
 *
 * The hook never opens the manifest for the provider: the sentinel is what keeps
 * the machine provider free of forks. So the seam is not a key path any more —
 * it is the round trip, asserted END TO END: for every registry provider, the
 * bytes the TS writer leaves produce a directive naming that provider if and only
 * if it is not github. Hostile sentinel bytes are shell-hooks-tracker.test.ts's
 * table; this file owns the property that the WRITER and the READER agree.
 *
 * Section 4 — TS ↔ prompt seam: the per-repo `tracker` key in the project's
 * `.devflow/config.json`. Its readers are `readConfig` + `parseTrackerOverride`
 * in TypeScript and the Git agent PROMPT, a generated artifact tsc never sees
 * (the untyped-seam shape PF-024 names). The prompt reads the FILE, so the
 * TypeScript side owes it two things and the second is the one a reader is
 * likely to miss: classify the same bytes the same way, AND leave those bytes on
 * disk — `writeManagedConfig` (devflow init's write) is a read-modify-write over
 * the whole file, so a value its write drops is a value the prompt can never see
 * again.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  parseTrackerOverride,
  readConfig,
  writeManagedConfig,
} from '../../src/core/feature-config.js';
import {
  DEFAULT_TRACKER_PROVIDER,
  TRACKER_PROVIDER_IDS,
  applyTrackerSentinel,
} from '../../src/core/tracker.js';
import { scriptsDir } from '../../src/core/assets.js';
import { ROOT } from '../helpers.js';
import { HOOK_RUN_ALLOWANCE_MS, NODE_EXEC_STALL_MS, runHook } from '../shell-hooks-helpers.js';

const HOOKS_DIR = path.join(scriptsDir(), 'hooks');
const CONTEXT_HOOK = path.join(HOOKS_DIR, 'session-start-context');
const HOOK_SOURCE = fs.readFileSync(CONTEXT_HOOK, 'utf-8');

/** Section 3 of the hook, from its banner to the output block. */
function section3(source: string): string {
  const at = source.indexOf('# --- Section 3:');
  const end = source.indexOf('# --- Output ---');
  return at === -1 || end === -1 ? '' : source.slice(at, end);
}

// ---------------------------------------------------------------------------
// 1. The shell reads the sentinel, never the manifest
// ---------------------------------------------------------------------------

/**
 * Named collector: the LIVE lines of a shell source that read the manifest's
 * tracker key. Comment lines are skipped — documentation that names the key is
 * not a reader.
 */
export function collectManifestProviderReads(source: string): string[] {
  return source
    .split('\n')
    .filter(line => !line.trimStart().startsWith('#') && line.includes('features.tracker'))
    .map(line => line.trim());
}

describe('tracker sentinel: the shell reads the machine provider from the sentinel alone', () => {
  const section = section3(HOOK_SOURCE);

  it('Section 3 is locatable (non-vacuity)', () => {
    expect(section.length).toBeGreaterThan(0);
  });

  it('Section 3 never reads the manifest\'s tracker key', () => {
    expect(
      collectManifestProviderReads(section),
      'Section 3 reads features.tracker out of the manifest — one jq/node fork per session ' +
      'for every tracker machine, which the name-bearing sentinel exists to avoid',
    ).toEqual([]);
  });

  it('the sentinel is read with the read builtin, bounded, into the allowlisted variable', () => {
    expect(section).toContain('IFS= read -r -n 16 TRACKER_PROVIDER 2>/dev/null < "$TRACKER_SENTINEL"');
  });

  it('known-bad probe: the collector reports a live read and ignores a comment', () => {
    expect(collectManifestProviderReads([
      '# the manifest\'s features.tracker.provider is never read here',
      '  P=$(json_field_file "$M" "features.tracker.provider" "github")',
    ].join('\n'))).toEqual(['P=$(json_field_file "$M" "features.tracker.provider" "github")']);
  });
});

// ---------------------------------------------------------------------------
// 2. Section 3's allowlist, read out of the hook rather than restated
// ---------------------------------------------------------------------------

/**
 * Named collector: the provider tokens Section 3's `case` admits.
 *
 * Read from the hook so this file cannot drift from it. Restating `['jira',
 * 'linear']` here would make the round trip assert agreement with a set nobody
 * checks against the thing that decides.
 */
export function collectAdmittedProviders(source: string): string[] {
  const at = source.indexOf('case "$TRACKER_PROVIDER" in');
  if (at === -1) return [];
  const arm = source.slice(at).split('\n')[1] ?? '';
  const match = /^\s*([A-Za-z|]+)\)/.exec(arm);
  return match ? match[1].split('|') : [];
}

const ADMITTED = collectAdmittedProviders(HOOK_SOURCE);

describe('tracker sentinel: the allowlist is a positive, closed set', () => {
  it('Section 3 admits exactly jira and linear', () => {
    expect(
      ADMITTED,
      'the allowlist could not be read out of the hook, or it changed shape — the round trip ' +
      'below is asserted against it, so an empty set would make every row vacuous',
    ).toEqual(['jira', 'linear']);
  });

  it(`the default provider (${DEFAULT_TRACKER_PROVIDER}) is NOT admitted`, () => {
    // The gate is a positive allowlist, never `!= github`: a negative test admits
    // every hostile string that merely is not the word "github".
    expect(ADMITTED).not.toContain(DEFAULT_TRACKER_PROVIDER);
  });

  it('known-bad probe: the collector reports a widened arm and an absent case', () => {
    expect(collectAdmittedProviders('case "$TRACKER_PROVIDER" in\n  jira|linear|github) ;;\n'))
      .toEqual(['jira', 'linear', 'github']);
    expect(collectAdmittedProviders('no case here')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. The round trip: what the TS writer leaves, the real hook reads
// ---------------------------------------------------------------------------

describe('tracker sentinel: the TS writer and the shell reader agree on every provider', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-tracker-sentinel-seam-'));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  for (const provider of TRACKER_PROVIDER_IDS) {
    const admitted = provider !== DEFAULT_TRACKER_PROVIDER;
    it(`${provider}: the sentinel applyTrackerSentinel leaves → ${admitted ? 'a directive naming it' : 'no directive'}`, async () => {
      const home = path.join(tmpRoot, `home-${provider}`);
      const devflowDir = path.join(home, '.devflow');
      const project = path.join(tmpRoot, `project-${provider}`);
      // A git marker, because Section 3 is gated on the project being a checkout.
      fs.mkdirSync(path.join(project, '.git'), { recursive: true });
      fs.mkdirSync(path.join(devflowDir, 'logs'), { recursive: true });

      const written = await applyTrackerSentinel(devflowDir, provider);
      expect(written.ok).toBe(true);

      const { stdout, exitCode } = runHook(
        CONTEXT_HOOK,
        { cwd: project, session_id: 'seam', source: 'startup' },
        home,
      );
      expect(exitCode).toBe(0);
      const context = stdout.trim() === '' ? '' : JSON.parse(stdout).hookSpecificOutput.additionalContext as string;
      expect(
        context.includes('--- TRACKER SETUP ---'),
        `the writer left ${admitted ? `"${provider}"` : 'no sentinel'} and the hook ` +
        `${admitted ? 'did not emit' : 'emitted'} the directive`,
      ).toBe(admitted);
      expect(ADMITTED.includes(provider), 'the hook\'s allowlist disagrees with this row').toBe(admitted);
      if (admitted) expect(context).toContain(`Provider: ${provider}.`);
    }, HOOK_RUN_ALLOWANCE_MS + NODE_EXEC_STALL_MS); // one hook run; its source gate may exec node once
  }

  it('the round trip covers both verdicts (non-vacuity)', () => {
    expect(TRACKER_PROVIDER_IDS.some(id => id === DEFAULT_TRACKER_PROVIDER)).toBe(true);
    expect(TRACKER_PROVIDER_IDS.some(id => id !== DEFAULT_TRACKER_PROVIDER)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. The other key: `tracker` in the project's .devflow/config.json
// ---------------------------------------------------------------------------

const GIT_AGENT_HOST = path.join(ROOT, 'src', 'assets', 'agents', 'git.mds');

/**
 * Named collector: the prompt lines that name the per-repo config file.
 *
 * Unlike `collectKeyPathReadSites` above, comment lines are NOT skipped — the
 * whole prompt is prose, and the contract this seam checks is stated in it. The
 * collector exists so the two assertions below quote what the prompt says rather
 * than restating it here, where it could drift.
 */
export function collectPerRepoKeySites(source: string): string[] {
  return source
    .split('\n')
    .filter(line => line.includes('.devflow/config.json'))
    .map(line => line.trim());
}

describe('per-repo tracker key: the prompt states the contract the parser implements', () => {
  const sites = collectPerRepoKeySites(fs.readFileSync(GIT_AGENT_HOST, 'utf-8'));

  it('the prompt names the key as a step of its resolution order', () => {
    expect(
      sites.length,
      'the Git agent prompt never names .devflow/config.json — the per-repo key has no reader ' +
      'and the parser below has no consumer',
    ).toBeGreaterThan(0);
    expect(
      sites.some(line => line.includes('Resolution order')),
      `no resolution-order line names .devflow/config.json:\n  ${sites.join('\n  ')}`,
    ).toBe(true);
  });

  it('the prompt gives an out-of-map value its own DEGRADED reason', () => {
    // This line is what makes `invalid` a state rather than a synonym for
    // `absent`. If the prompt stopped naming it, the parser's third arm would
    // have nothing downstream that can tell the two apart.
    expect(
      sites.some(line => line.includes('DEGRADED (unknown tracker provider)')),
      `no line pairs .devflow/config.json with the unknown-provider DEGRADED:\n  ${sites.join('\n  ')}`,
    ).toBe(true);
  });

  it('known-bad probe: the collector reports a live mention and stays empty otherwise', () => {
    expect(collectPerRepoKeySites('- reads manifest.json only\n')).toEqual([]);
    expect(collectPerRepoKeySites('  the .devflow/config.json value  \n'))
      .toEqual(['the .devflow/config.json value']);
  });
});

interface OverrideShape {
  readonly label: string;
  /** The JSON value the `tracker` key holds; the key is omitted when `present` is false. */
  readonly raw: unknown;
  readonly present?: boolean;
  /**
   * The verdict both readers must reach, pinned by hand. Deriving it from either
   * reader would let the two agree on a wrong answer (a two-sided equality has no oracle).
   */
  readonly verdict: 'absent' | 'valid' | 'invalid';
}

const OVERRIDES: readonly OverrideShape[] = [
  { label: 'key omitted', raw: undefined, present: false, verdict: 'absent' },
  { label: 'empty string', raw: '', verdict: 'absent' },
  { label: 'jira', raw: 'jira', verdict: 'valid' },
  { label: 'linear', raw: 'linear', verdict: 'valid' },
  { label: 'github (a CHOSEN provider, not an absence)', raw: 'github', verdict: 'valid' },
  { label: 'an alias (jira-cloud)', raw: 'jira-cloud', verdict: 'invalid' },
  { label: 'upper case (JIRA)', raw: 'JIRA', verdict: 'invalid' },
  { label: 'a number', raw: 42, verdict: 'invalid' },
  { label: 'a boolean', raw: true, verdict: 'invalid' },
  { label: 'null', raw: null, verdict: 'invalid' },
  { label: 'an array', raw: ['jira'], verdict: 'invalid' },
  { label: 'an object', raw: { provider: 'jira' }, verdict: 'invalid' },
];

describe('per-repo tracker key: the verdict survives an unrelated CLI toggle', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-tracker-override-'));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function configPath(root: string): string {
    return path.join(root, '.devflow', 'config.json');
  }

  function seed(index: number, shape: OverrideShape): string {
    const root = path.join(tmpRoot, `override-${index}`);
    fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
    const body: Record<string, unknown> = { reviewPublication: 'auto' };
    if (shape.present !== false) body.tracker = shape.raw;
    fs.writeFileSync(configPath(root), JSON.stringify(body));
    return root;
  }

  for (const [index, shape] of OVERRIDES.entries()) {
    it(`${shape.label} → ${shape.verdict}, before and after a re-init's managed write`, async () => {
      const root = seed(index, shape);

      expect(
        parseTrackerOverride((await readConfig(root)).tracker).kind,
        `the TypeScript reader classified ${shape.label} differently from the table`,
      ).toBe(shape.verdict);

      await writeManagedConfig(root, { reviewPublication: 'off' });
      const onDisk = JSON.parse(fs.readFileSync(configPath(root), 'utf-8')) as Record<string, unknown>;

      expect(onDisk.reviewPublication, 'the write must still take effect').toBe('off');
      expect(
        Object.prototype.hasOwnProperty.call(onDisk, 'tracker'),
        'an unrelated write changed whether the key exists on disk — the prompt reads the ' +
        'FILE, so a key the CLI drops is a key the prompt can never see again',
      ).toBe(shape.present !== false);
      if (shape.present !== false) {
        expect(onDisk.tracker, 'the value must round-trip as written, never normalised').toEqual(shape.raw);
      }

      expect(
        parseTrackerOverride((await readConfig(root)).tracker).kind,
        'the verdict changed across a toggle that has nothing to do with the tracker',
      ).toBe(shape.verdict);
    });
  }

  it('the table covers all three verdicts and at least one non-string (non-vacuity)', () => {
    for (const verdict of ['absent', 'valid', 'invalid'] as const) {
      expect(
        OVERRIDES.some(shape => shape.verdict === verdict),
        `no row exercises the \`${verdict}\` verdict`,
      ).toBe(true);
    }
    expect(
      OVERRIDES.some(shape => shape.present !== false && typeof shape.raw !== 'string'),
      'every present row holds a string — the arm a string-typed field cannot carry is untested',
    ).toBe(true);
  });
});

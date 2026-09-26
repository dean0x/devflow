/**
 * The per-repo `tracker` key in `.devflow/config.json` (P3a-S13, OD-9).
 *
 * The key is the FIRST step of the Git agent's provider resolution order, and it
 * is the only one that can say "this repo, specifically". Two properties are
 * load-bearing and neither is provable from the Git-agent prose alone:
 *
 *   1. REJECT, NEVER REPAIR (§14.9-6). `jira-cloud` must not normalise to `jira`.
 *      The parse therefore goes through the SAME parseTrackerId the CLI boundary
 *      uses — one authority, not a second closed-domain ternary that could drift
 *      from it. §14.2 gives an invalid per-repo value its own DEGRADED reason
 *      (`unknown tracker provider`), which only exists because "invalid" is a
 *      state distinct from "absent" [DR-26].
 *
 *   2. ROUND-TRIP PRESERVATION. `updateFeature` is a read-modify-write over the
 *      whole file, so a key its write does not carry is a key `devflow knowledge
 *      --disable` DELETES — setting a per-repo tracker override and then toggling
 *      any unrelated feature would silently revert the repo to the manifest
 *      provider. The write carries every unmanaged key from the file
 *      (D-CONFIG-PRESERVE-UNMANAGED). That is the reachable consumer this key has
 *      at the 3a boundary (ADR-003).
 *
 * The raw string is what the config file holds and what round-trips; the parsed
 * three-state view is what a consumer reads. They are separate on purpose — a
 * single field could not both preserve a hostile value verbatim and hand a
 * consumer a validated token.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import {
  DEFAULT_CONFIG,
  parseTrackerOverride,
  readConfig,
  readConfigIfPresent,
  updateFeature,
  writeManagedConfig,
  type TrackerConfigOverride,
} from '../../src/core/feature-config.js';
import { TRACKER_PROVIDER_IDS } from '../../src/core/tracker.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'devflow-cfg-tracker-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a raw `.devflow/config.json` body, bypassing every typed writer. */
function seedConfig(body: string): void {
  mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
  writeFileSync(path.join(tmpDir, '.devflow', 'config.json'), body, 'utf-8');
}

function storedConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(tmpDir, '.devflow', 'config.json'), 'utf-8'));
}

// ---------------------------------------------------------------------------
// 1. parseTrackerOverride — three states, never two
// ---------------------------------------------------------------------------

describe('parseTrackerOverride: absent, valid and invalid are three distinct states', () => {
  it('absent means NO override — not `github`', () => {
    // The distinction is the whole point of the key. `github` is a CHOSEN
    // provider that short-circuits ref-grammar corroboration; absent is the
    // instruction to corroborate. Collapsing them would disable the feature for
    // every user who never edited a config file (OD-9's corrected rule).
    expect(parseTrackerOverride(undefined)).toEqual({ kind: 'absent' });
    expect(parseTrackerOverride('')).toEqual({ kind: 'absent' });
  });

  it('every registered provider id parses to itself', () => {
    expect(TRACKER_PROVIDER_IDS.length, 'the provider registry is empty — the loop is vacuous')
      .toBeGreaterThan(1);
    for (const id of TRACKER_PROVIDER_IDS) {
      expect(parseTrackerOverride(id), `"${id}" must parse as a valid override`)
        .toEqual({ kind: 'valid', provider: id });
    }
  });

  it('reject, never repair: a hostile or near-miss value is `invalid`, never a repaired provider', () => {
    // `jira-cloud` is the instructive row: a "closest match" rule would map it
    // onto jira, which is exactly the repair §14.9-6 forbids. `JIRA` and `jira `
    // are the byte-exactness rows parseTrackerId already owns (D-TRACKER-STRICT).
    const HOSTILE: readonly string[] = [
      'jira-cloud',
      'JIRA',
      'GitHub',
      'jira ',
      ' jira',
      '../../etc/passwd',
      'github/../../rules/devflow',
      '`id`',
      'github; rm -rf /',
      'github jira',
      'a'.repeat(200),
    ];
    expect(HOSTILE.length, 'hostile corpus must be non-empty (PF-018)').toBeGreaterThan(0);

    const repaired: string[] = [];
    for (const raw of HOSTILE) {
      const parsed = parseTrackerOverride(raw);
      if (parsed.kind !== 'invalid') repaired.push(`${raw} → ${JSON.stringify(parsed)}`);
      // The raw value travels with the refusal so the DEGRADED line can name it,
      // and it is the value as written — never a normalised echo.
      if (parsed.kind === 'invalid') expect(parsed.raw).toBe(raw);
    }
    expect(
      repaired,
      `per-repo tracker value(s) were accepted or repaired instead of refused:\n  ${repaired.join('\n  ')}`,
    ).toEqual([]);
  });

  it('a non-string JSON value is `invalid`, not `absent`', () => {
    // A present-but-wrong-typed value signals intent the same way a misspelled
    // string does: the user edited the file. Treating it as absent would make the
    // DEGRADED reason unreachable for the whole class.
    for (const raw of [42, true, null, [], {}] as unknown[]) {
      const parsed = parseTrackerOverride(raw as never);
      expect(parsed.kind, `${JSON.stringify(raw)} must not parse as absent`).toBe('invalid');
    }
  });

  it('known-bad probe: a repairing parse would be reported by the same assertion shape', () => {
    // Drives the shape the guard above relies on. A parse that trimmed and
    // lowercased (the lenient pipeline D-TRACKER-STRICT rejected) would answer
    // `valid` for 'JIRA' — asserted here so the negative above is not green
    // merely because the function returns a constant.
    const lenient = (raw: string): TrackerConfigOverride => {
      const t = raw.trim().toLowerCase();
      return (TRACKER_PROVIDER_IDS as readonly string[]).includes(t)
        ? { kind: 'valid', provider: t as never }
        : { kind: 'invalid', raw };
    };
    expect(lenient('JIRA').kind, 'the probe must model a repairing parse').toBe('valid');
    expect(parseTrackerOverride('JIRA').kind, 'the real parse must refuse it').toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// 2. The key survives every read and every write
// ---------------------------------------------------------------------------

describe('the per-repo tracker key round-trips through the config', () => {
  it('DEFAULT_CONFIG declares no override', () => {
    expect(DEFAULT_CONFIG.tracker, 'a default override would be a second manifest').toBeUndefined();
    expect(parseTrackerOverride(DEFAULT_CONFIG.tracker)).toEqual({ kind: 'absent' });
  });

  it('readConfig carries a valid value through', async () => {
    seedConfig(JSON.stringify({ memory: true, learning: true, knowledge: true, tracker: 'jira' }));
    const config = await readConfig(tmpDir);
    expect(config.tracker).toBe('jira');
    expect(parseTrackerOverride(config.tracker)).toEqual({ kind: 'valid', provider: 'jira' });
  });

  it('readConfig carries an INVALID value through verbatim rather than dropping it', async () => {
    // Dropping it is a repair by erasure: the next write would delete the user's
    // typo and with it the `unknown tracker provider` DEGRADED that tells them
    // about it. Preserved raw, refused at the parse.
    seedConfig(JSON.stringify({ tracker: 'jira-cloud' }));
    const config = await readConfig(tmpDir);
    expect(config.tracker).toBe('jira-cloud');
    expect(parseTrackerOverride(config.tracker)).toEqual({ kind: 'invalid', raw: 'jira-cloud' });
  });

  it('readConfig leaves the key absent when the file does not set it', async () => {
    seedConfig(JSON.stringify({ memory: false }));
    const config = await readConfig(tmpDir);
    expect(config.tracker).toBeUndefined();
  });

  it('readConfigIfPresent carries the key too (the init-seed reader)', async () => {
    seedConfig(JSON.stringify({ tracker: 'linear' }));
    const config = await readConfigIfPresent(tmpDir);
    expect(config, 'a present config must not read as null').not.toBeNull();
    expect(config!.tracker).toBe('linear');
  });

  it('writeManagedConfig omits the key entirely when there is no override', async () => {
    await writeManagedConfig(tmpDir, { ...DEFAULT_CONFIG });
    expect(
      Object.keys(storedConfig()),
      'an explicit `"tracker": null` or `"tracker": "github"` would be a written override the ' +
      'user never chose — absent must stay absent on disk',
    ).not.toContain('tracker');
  });

  it('★ updateFeature does NOT erase the override (the reachable consumer, ADR-003)', async () => {
    // The defect the key exists to prevent, stated as a test: updateFeature is a
    // read-modify-write over the WHOLE config, so before this key existed
    // `devflow knowledge --disable` on a Jira repo silently reverted it to the
    // manifest provider — a tracker regression caused by an unrelated toggle.
    seedConfig(JSON.stringify({ memory: true, learning: true, knowledge: true, tracker: 'jira' }));
    await updateFeature(tmpDir, 'knowledge', false);
    const after = storedConfig();
    expect(after.knowledge, 'the toggle must still take effect').toBe(false);
    expect(
      after.tracker,
      'toggling an unrelated feature must not delete the per-repo tracker override',
    ).toBe('jira');
  });

  it('updateFeature preserves an invalid override verbatim as well', async () => {
    seedConfig(JSON.stringify({ tracker: 'jira-cloud' }));
    await updateFeature(tmpDir, 'memory', false);
    expect(
      storedConfig().tracker,
      'a value the parse refuses is still the user’s edit — erasing it hides the DEGRADED',
    ).toBe('jira-cloud');
  });

  /**
   * The non-string rows, and the reason the field holds a raw JSON value rather
   * than a string.
   *
   * `parseTrackerOverride` gives a present-but-wrong-typed value its own
   * `invalid` verdict. A field that could only carry strings makes that verdict
   * reachable from a direct call and unreachable from the file, so the whole
   * class is silent for every user who can open a text editor — a parse arm
   * exercised only by inputs the reader cannot produce (PF-043). And because
   * `updateFeature` is a read-modify-write, a value its write drops is a value
   * DELETED from disk on the next unrelated toggle, taking the user's edit and
   * the DEGRADED that reports it together.
   */
  const NON_STRING: readonly { label: string; value: unknown; raw: string }[] = [
    { label: 'a number', value: 42, raw: '42' },
    { label: 'a boolean', value: true, raw: 'true' },
    { label: 'null', value: null, raw: 'null' },
    { label: 'an array', value: ['jira'], raw: '["jira"]' },
    { label: 'an object', value: { provider: 'jira' }, raw: '{"provider":"jira"}' },
  ];

  for (const { label, value, raw } of NON_STRING) {
    it(`★ readConfig carries ${label} through, and the parse calls it invalid — not absent`, async () => {
      seedConfig(JSON.stringify({ memory: true, learning: true, knowledge: true, tracker: value }));
      const config = await readConfig(tmpDir);
      expect(config.tracker, 'the raw JSON value must reach the parser unchanged').toEqual(value);
      expect(parseTrackerOverride(config.tracker)).toEqual({ kind: 'invalid', raw });
    });

    it(`★ updateFeature does not delete ${label}`, async () => {
      seedConfig(JSON.stringify({ memory: true, learning: true, knowledge: true, tracker: value }));
      await updateFeature(tmpDir, 'knowledge', false);
      const after = storedConfig();
      expect(after.knowledge, 'the toggle must still take effect').toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(after, 'tracker'),
        'an unrelated toggle deleted the key from disk — both the user’s edit and the ' +
        '`unknown tracker provider` DEGRADED that would have reported it are gone',
      ).toBe(true);
      expect(after.tracker).toEqual(value);
    });
  }

  it('readConfigIfPresent carries a non-string value too (the init-seed reader)', async () => {
    seedConfig(JSON.stringify({ tracker: 42 }));
    const config = await readConfigIfPresent(tmpDir);
    expect(config, 'a present config must not read as null').not.toBeNull();
    expect(parseTrackerOverride(config!.tracker)).toEqual({ kind: 'invalid', raw: '42' });
  });

  it('an empty-string override round-trips as written and still parses as absent', async () => {
    // `""` is an unset key with a character in it: the verdict is `absent`, and
    // the bytes are still the user's. One rule — a present key is carried —
    // covers it, and costs less than a type-shaped exception that erases it.
    seedConfig(JSON.stringify({ memory: true, tracker: '' }));
    const config = await readConfig(tmpDir);
    expect(parseTrackerOverride(config.tracker)).toEqual({ kind: 'absent' });
    await updateFeature(tmpDir, 'memory', false);
    expect(storedConfig().tracker).toBe('');
  });
});

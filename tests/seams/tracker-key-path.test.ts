/**
 * TS ↔ shell seam: `features.tracker.provider` is ONE key path with TWO readers.
 *
 * The tracker provider is read twice, in two languages, for two purposes:
 *
 *   - TypeScript — `readManifest()` → `features.tracker.provider`, normalised by
 *     `normalizeTrackerFeature`, driving `devflow init` / `devflow tracker`;
 *   - shell — `json_field_file "$devflowDir/manifest.json" <key> "github"` in
 *     `session-start-context`'s Section 3, deciding whether to emit the
 *     background-setup directive.
 *
 * A second spelling of the dotted path in the shell script is exactly the drift
 * `TRACKER_PROVIDER_KEY_PATH` exists to prevent, so the literal is asserted here
 * against the constant rather than retyped. `src/core/tracker.ts` is the one
 * authority; this file is the only place that checks the shell agrees with it.
 *
 * The seam is NOT "both readers return the same string". They legitimately do
 * not: over a malformed shape jq errors and yields an empty string while the node
 * fallback's `getNestedField` returns undefined and yields the `github` default,
 * and `readManifest` returns `null` for a manifest missing its hard-null fields.
 * Three different tokens, one outcome — which is the property that matters and
 * the one asserted: **the shell token passes Section 3's allowlist if and only if
 * the TypeScript reader resolves a non-github provider.** The table pins the
 * expected outcome independently, so the two readers cannot agree on a wrong
 * answer (a two-sided equality has no oracle of its own).
 *
 * Both shell backends run every row. `_HAS_JQ` is overridden after `json-parse`
 * is sourced rather than by editing PATH: the variable is the backend switch
 * `json_field_file` actually reads, and PATH surgery to hide a tool is
 * platform-dependent (PF-045).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readManifest } from '../../src/core/manifest.js';
import {
  DEFAULT_TRACKER_PROVIDER,
  TRACKER_PROVIDER_KEY_PATH,
} from '../../src/core/tracker.js';
import { scriptsDir } from '../../src/core/assets.js';
import { ROOT } from '../helpers.js';

const HOOKS_DIR = path.join(scriptsDir(), 'hooks');
const CONTEXT_HOOK = path.join(HOOKS_DIR, 'session-start-context');

// ---------------------------------------------------------------------------
// 1. The shell script spells the constant, once
// ---------------------------------------------------------------------------

/**
 * Named collector: the LIVE shell lines that spell the key path.
 *
 * Comment lines are skipped, on the same terms as
 * `collectLiteralAgentPathViolations` in tests/guards/literal-agent-paths.test.ts:
 * a literal inside a `#` comment is documentation — Section 3's comment explains
 * how the dotted path behaves on each json-parse backend and naming it there is
 * the point. A literal on an executable line is a reader, and there may be
 * exactly one.
 */
export function collectKeyPathReadSites(source: string, keyPath: string): string[] {
  return source
    .split('\n')
    .filter(line => !line.trimStart().startsWith('#') && line.includes(keyPath))
    .map(line => line.trim());
}

describe('tracker key path: the shell reader spells the TS constant verbatim', () => {
  const source = fs.readFileSync(CONTEXT_HOOK, 'utf-8');

  it('session-start-context reads the key path at exactly one live site', () => {
    const sites = collectKeyPathReadSites(source, TRACKER_PROVIDER_KEY_PATH);
    expect(
      sites,
      `session-start-context reads "${TRACKER_PROVIDER_KEY_PATH}" at ${sites.length} live ` +
      `site(s):\n  ${sites.join('\n  ')}\nThere must be exactly one. src/core/tracker.ts's ` +
      `TRACKER_PROVIDER_KEY_PATH is the single authority, and a second reader is a second ` +
      `place the shell and the CLI can silently disagree about which key holds the provider.`,
    ).toHaveLength(1);
  });

  it('the one live site passes the key path to json_field_file', () => {
    // A count alone would stay green if the literal survived in a comment while
    // the live read moved to another key.
    const [site] = collectKeyPathReadSites(source, TRACKER_PROVIDER_KEY_PATH);
    expect(site).toContain('json_field_file');
    expect(site).toContain('manifest.json');
    expect(site).toContain(`"${DEFAULT_TRACKER_PROVIDER}"`);
  });

  it('known-bad probe: the collector reports a second reader and ignores a comment', () => {
    const seeded = [
      '# the dotted path features.tracker.provider walks on both backends',
      '  TRACKER_PROVIDER=$(json_field_file "$M" "features.tracker.provider" "github")',
      '  TRACKER_FALLBACK=$(json_field_file "$M2" "features.tracker.provider" "github")',
    ].join('\n');
    const sites = collectKeyPathReadSites(seeded, TRACKER_PROVIDER_KEY_PATH);
    expect(sites).toHaveLength(2);
    expect(sites[0]).toContain('TRACKER_PROVIDER=');
    expect(sites[1]).toContain('TRACKER_FALLBACK=');
    // …and a file that only mentions it in prose has no reader at all.
    expect(collectKeyPathReadSites('# features.tracker.provider\n', TRACKER_PROVIDER_KEY_PATH))
      .toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Section 3's allowlist, read out of the hook rather than restated
// ---------------------------------------------------------------------------

/**
 * Named collector: the provider tokens Section 3's `case` admits.
 *
 * Read from the hook so this file cannot drift from it. Restating `['jira',
 * 'linear']` here would make the parity table assert agreement with a set nobody
 * checks against the thing that decides.
 */
export function collectAdmittedProviders(source: string): string[] {
  const at = source.indexOf('case "$TRACKER_PROVIDER" in');
  if (at === -1) return [];
  const arm = source.slice(at).split('\n')[1] ?? '';
  const match = /^\s*([A-Za-z|]+)\)/.exec(arm);
  return match ? match[1].split('|') : [];
}

const ADMITTED = collectAdmittedProviders(fs.readFileSync(CONTEXT_HOOK, 'utf-8'));

describe('tracker key path: the allowlist is a positive, closed set', () => {
  it('Section 3 admits exactly jira and linear', () => {
    expect(
      ADMITTED,
      'the allowlist could not be read out of the hook, or it changed shape — the parity ' +
      'table below is asserted against it, so an empty set would make every row vacuous',
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
// 3. The shape table, run through both readers on both shell backends
// ---------------------------------------------------------------------------

/** A shell driver that exercises exactly the call Section 3 makes. */
const DRIVER = [
  '#!/bin/bash',
  '# Test driver: the one json_field_file call Section 3 makes, on a chosen backend.',
  'SCRIPT_DIR="$1"; FILE="$2"; KEY="$3"; BACKEND="$4"',
  'source "$SCRIPT_DIR/json-parse" || exit 1',
  '# Force the node fallback by flipping the variable json_field_file actually',
  '# reads. Hiding jq by editing PATH would be platform-dependent (PF-045).',
  '[ "$BACKEND" = "node" ] && _HAS_JQ=false',
  '# Capture into a variable and always exit 0 — the hook reads this through a',
  '# command substitution and runs without `set -e`, so a backend that fails on a',
  '# malformed or unreadable file yields an empty token rather than a hook crash.',
  '# A driver that propagated the status would be testing a different contract.',
  'VALUE=$(json_field_file "$FILE" "$KEY" "github")',
  'printf %s "$VALUE"',
  'exit 0',
  '',
].join('\n');

interface Shape {
  readonly label: string;
  /** Raw manifest.json bytes; `null` writes no file at all. */
  readonly raw: string | null;
  /** Make the file unreadable after writing it. */
  readonly chmod000?: boolean;
  /**
   * Whether this shape should reach Section 3's directive — i.e. the TS reader
   * resolves a non-github provider AND the shell token is in the allowlist.
   * Pinned by hand so the two readers are compared against an oracle rather than
   * against each other.
   */
  readonly admitted: boolean;
}

/** A manifest body that `readManifest` accepts — every hard-null field present. */
function manifest(tracker: unknown, includeTracker = true): string {
  const features: Record<string, unknown> = { ambient: true, memory: true };
  if (includeTracker) features.tracker = tracker;
  return JSON.stringify({
    version: '2.0.0',
    plugins: ['devflow-core-skills'],
    scope: 'user',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    features,
  });
}

const SHAPES: readonly Shape[] = [
  { label: 'file absent', raw: null, admitted: false },
  { label: 'empty object', raw: '{}', admitted: false },
  { label: 'features empty', raw: '{"features":{}}', admitted: false },
  { label: 'tracker is a bare string', raw: manifest('jira'), admitted: false },
  { label: 'tracker is an array', raw: manifest(['jira']), admitted: false },
  { label: 'provider is null', raw: manifest({ provider: null }), admitted: false },
  { label: 'provider is github', raw: manifest({ provider: 'github' }), admitted: false },
  { label: 'provider is an alias', raw: manifest({ provider: 'jira-cloud' }), admitted: false },
  { label: 'provider is upper case', raw: manifest({ provider: 'JIRA' }), admitted: false },
  { label: 'tracker key absent', raw: manifest(undefined, false), admitted: false },
  { label: 'truncated JSON', raw: '{', admitted: false },
  { label: 'provider is jira', raw: manifest({ provider: 'jira' }), admitted: true },
  { label: 'provider is linear', raw: manifest({ provider: 'linear' }), admitted: true },
  { label: 'unreadable file', raw: manifest({ provider: 'jira' }), chmod000: true, admitted: false },
];

describe('tracker key path: TS and shell readers agree on every manifest shape', () => {
  let tmpRoot: string;
  let driverPath: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-tracker-keypath-'));
    driverPath = path.join(tmpRoot, 'read-provider');
    fs.writeFileSync(driverPath, DRIVER);
    fs.chmodSync(driverPath, 0o755);
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** The shell reader's raw token for one shape on one backend. */
  function readViaShell(devflowDir: string, backend: 'jq' | 'node'): string {
    return execFileSync(
      'bash',
      [driverPath, HOOKS_DIR, path.join(devflowDir, 'manifest.json'), TRACKER_PROVIDER_KEY_PATH, backend],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    ).toString().trim();
  }

  function stage(shape: Shape, index: number): string {
    const devflowDir = path.join(tmpRoot, `case-${index}`);
    fs.mkdirSync(devflowDir, { recursive: true });
    if (shape.raw !== null) {
      const file = path.join(devflowDir, 'manifest.json');
      fs.writeFileSync(file, shape.raw);
      if (shape.chmod000) fs.chmodSync(file, 0o000);
    }
    return devflowDir;
  }

  for (const [index, shape] of SHAPES.entries()) {
    for (const backend of ['jq', 'node'] as const) {
      it(`${shape.label} (${backend} backend) → ${shape.admitted ? 'directive' : 'no directive'}`, async () => {
        const devflowDir = stage(shape, index * 2 + (backend === 'jq' ? 0 : 1));
        try {
          const token = readViaShell(devflowDir, backend);
          expect(
            ADMITTED.includes(token),
            `the ${backend} backend returned "${token}", which ${ADMITTED.includes(token) ? 'is' : 'is not'} ` +
            `in the allowlist [${ADMITTED.join(', ')}] — the table says this shape must ` +
            `${shape.admitted ? '' : 'NOT '}reach the directive`,
          ).toBe(shape.admitted);

          const parsed = await readManifest(devflowDir);
          const tsAdmitted = parsed !== null && parsed.features.tracker.provider !== DEFAULT_TRACKER_PROVIDER;
          expect(
            tsAdmitted,
            `readManifest resolved ${parsed === null ? 'null' : `provider "${parsed.features.tracker.provider}"`} ` +
            `for the same bytes. The two readers must reach the same VERDICT even when their ` +
            `intermediate tokens differ, or the CLI and the hook disagree about whether this ` +
            `machine has a tracker.`,
          ).toBe(shape.admitted);
        } finally {
          if (shape.chmod000) {
            fs.chmodSync(path.join(devflowDir, 'manifest.json'), 0o600);
          }
        }
      });
    }
  }

  it('the table covers both verdicts and both backends (non-vacuity)', () => {
    expect(SHAPES.filter(s => s.admitted).length, 'no shape reaches the directive').toBeGreaterThan(0);
    expect(SHAPES.filter(s => !s.admitted).length, 'no shape is refused').toBeGreaterThan(0);
    // One row per admitted provider, so the table cannot claim coverage of a
    // provider the allowlist admits but nothing exercises.
    for (const provider of ADMITTED) {
      expect(
        SHAPES.some(s => s.admitted && s.raw?.includes(`"provider":"${provider}"`)),
        `the allowlist admits "${provider}" but no shape in the table exercises it`,
      ).toBe(true);
    }
  });

  it('the driver really switches backends (PF-045: the precondition is asserted)', () => {
    // The one shape where the two backends are known to produce DIFFERENT tokens
    // for the same bytes: jq errors indexing a string and yields "", node's
    // getNestedField returns undefined and yields the default. If both came back
    // identical here, the `_HAS_JQ=false` override is not taking effect and every
    // "node backend" row above is silently a second jq run.
    const devflowDir = path.join(tmpRoot, 'backend-probe');
    fs.mkdirSync(devflowDir, { recursive: true });
    fs.writeFileSync(path.join(devflowDir, 'manifest.json'), manifest('jira'));
    expect(readViaShell(devflowDir, 'jq')).toBe('');
    expect(readViaShell(devflowDir, 'node')).toBe(DEFAULT_TRACKER_PROVIDER);
  });

  it('the hook and this file read the same key path constant', () => {
    // The import is the point: a copy of the string in this file would let the
    // seam pass while the hook read a different key.
    expect(TRACKER_PROVIDER_KEY_PATH).toBe('features.tracker.provider');
    expect(fs.readFileSync(path.join(ROOT, 'src', 'core', 'tracker.ts'), 'utf-8'))
      .toContain(`TRACKER_PROVIDER_KEY_PATH = '${TRACKER_PROVIDER_KEY_PATH}'`);
  });
});

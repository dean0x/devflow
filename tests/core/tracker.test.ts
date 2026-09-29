/**
 * Tests for src/core/tracker.ts
 *
 * Covers:
 *   - TRACKER_PROVIDERS registry shape (+ the "MCP stays out of user-facing text" bound)
 *   - parseTrackerId: strict boundary parser — REJECT, NEVER REPAIR (hostile table)
 *   - normalizeTrackerFeature: tolerant sink normaliser (ADR-014 self-heal)
 *   - trackerConventionsPath / trackerAttemptsPath / trackerEnabledSentinelPath —
 *     one conventions file and one attempt counter per provider
 *     (D-TRACKER-PER-PROVIDER-CONVENTIONS)
 *   - rearmTrackerInference: every provider's counter; idempotent-when-absent /
 *     removes-when-present / never throws [DR-22]
 *   - applyTrackerSentinel: holds the provider NAME when provider != github,
 *     removed when it is [DR-10]
 *   - parseTrackerFrontmatter: the one frontmatter parser
 *   - migrateLegacyTrackerConventions (TP-39): moves once, never overwrites, moves
 *     a symlink rather than its target, and leaves a provider-less file in place
 *   - the reported-failure arm of every lifecycle owner, each driven by a
 *     deterministic obstruction, so the warn-never-abort posture (PF-009) is
 *     exercised rather than asserted about
 *   - TRACKER_ATTEMPTS_MAX: the inference cap, cross-pinned against the hook literal
 *
 * Per PF-018: every table asserts its own row count so a payload deleted from the
 * table (or a registry that shrinks to nothing) fails RED instead of passing vacuously.
 * Per PF-014: no helper throws — every fallible path returns a Result.
 * Per PF-060: every filesystem case runs under its own mkdtemp root; no test reads
 * or writes the developer's real $HOME or ~/.devflow.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  TRACKER_PROVIDERS,
  TRACKER_PROVIDER_IDS,
  DEFAULT_TRACKER_PROVIDER,
  TRACKER_CONVENTIONS_DIR,
  TRACKER_LEGACY_CONVENTIONS_FILE,
  TRACKER_LEGACY_ATTEMPTS_FILE,
  TRACKER_ATTEMPTS_NAMES,
  TRACKER_ENABLED_FILE,
  TRACKER_CLAIM_FILE,
  TRACKER_STAGED_PREFIX,
  TRACKER_ATTEMPTS_MAX,
  parseTrackerId,
  isTrackerProvider,
  normalizeTrackerFeature,
  describeTrackerValue,
  trackerConventionsDir,
  trackerConventionsPath,
  trackerAttemptsName,
  trackerAttemptsPath,
  trackerEnabledSentinelPath,
  parseTrackerFrontmatter,
  rearmTrackerInference,
  applyTrackerSentinel,
  migrateLegacyTrackerConventions,
  type TrackerProvider,
} from '../../src/core/tracker.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The module under test, as source — read by the single-authority guard below. */
const MODULE_SOURCE = path.join(REPO_ROOT, 'src', 'core', 'tracker.ts');

/** The Tracker agent's prompt — the second spelling of the staging prefix (PF-013). */
const TRACKER_AGENT_SOURCE = path.join(REPO_ROOT, 'src', 'assets', 'agents', 'tracker.md');

// ── Registry ──────────────────────────────────────────────────────────────────

describe('TRACKER_PROVIDERS registry', () => {
  it('holds exactly the three Phase-3 providers, github first', () => {
    expect(TRACKER_PROVIDERS.map(p => p.id)).toEqual(['github', 'jira', 'linear']);
    expect(TRACKER_PROVIDER_IDS).toEqual(['github', 'jira', 'linear']);
  });

  it('every entry carries a non-empty id, label and hint', () => {
    expect(TRACKER_PROVIDERS.length).toBe(3);
    for (const provider of TRACKER_PROVIDERS) {
      expect(provider.id.length).toBeGreaterThan(0);
      expect(provider.label.length).toBeGreaterThan(0);
      expect(provider.hint.length).toBeGreaterThan(0);
    }
  });

  it('no user-facing hint or label mentions MCP (standing prohibition)', () => {
    // "MCP stays out of user-facing text" so transport never leaks into it.
    // Labels and hints are rendered in the init wizard note and the select prompt.
    for (const provider of TRACKER_PROVIDERS) {
      expect(`${provider.label} ${provider.hint}`).not.toMatch(/MCP/i);
    }
  });

  it('DEFAULT_TRACKER_PROVIDER is github and is a registry id', () => {
    expect(DEFAULT_TRACKER_PROVIDER).toBe('github');
    expect(TRACKER_PROVIDER_IDS).toContain(DEFAULT_TRACKER_PROVIDER);
  });

  it('the artifact basenames are the literals the hook and uninstall agree on', () => {
    expect(TRACKER_CONVENTIONS_DIR).toBe('tracker');
    expect(TRACKER_LEGACY_CONVENTIONS_FILE).toBe('tracker.md');
    expect(TRACKER_LEGACY_ATTEMPTS_FILE).toBe('.tracker.attempts');
    expect(trackerAttemptsName('jira')).toBe('.tracker.jira.attempts');
    expect(TRACKER_ENABLED_FILE).toBe('.tracker.enabled');
    expect(TRACKER_CLAIM_FILE).toBe('.tracker.processing');
    expect(TRACKER_STAGED_PREFIX).toBe('.tracker-staged.');
  });

  it('carries one attempt-counter basename per registry provider, in registry order', () => {
    expect(TRACKER_ATTEMPTS_NAMES).toEqual(TRACKER_PROVIDER_IDS.map(id => `.tracker.${id}.attempts`));
    // PF-018 non-vacuity: a registry that shrank to nothing would empty the set.
    expect(TRACKER_ATTEMPTS_NAMES.length).toBe(TRACKER_PROVIDER_IDS.length);
    expect(TRACKER_ATTEMPTS_NAMES.length).toBeGreaterThan(0);
  });

  it('the per-provider paths are the ones the hook and the Tracker agent spell (PF-013)', async () => {
    // Neither the hook nor the agent can import from here, so each spells the
    // conventions file and the counter from the provider variable it holds.
    const hook = await fs.readFile(
      path.join(REPO_ROOT, 'src', 'assets', 'scripts', 'hooks', 'session-start-context'), 'utf-8');
    expect(hook).toContain('TRACKER_CONVENTIONS="$TRACKER_DEVFLOW_DIR/tracker/$TRACKER_PROVIDER.md"');
    expect(hook).toContain('TRACKER_ATTEMPTS_FILE="$TRACKER_DEVFLOW_DIR/.tracker.$TRACKER_PROVIDER.attempts"');
    const agent = await fs.readFile(TRACKER_AGENT_SOURCE, 'utf-8');
    expect(agent).toContain('TRACKER_FILE="$TRACKER_DEVFLOW_DIR/tracker/$TRACKER_PROVIDER.md"');
    expect(agent).toContain('TRACKER_ATTEMPTS_FILE="$TRACKER_DEVFLOW_DIR/.tracker.$TRACKER_PROVIDER.attempts"');
    // …and both derive the same shapes this module does.
    expect(trackerConventionsPath('/d', 'jira')).toBe(path.join('/d', 'tracker', 'jira.md'));
    expect(trackerAttemptsPath('/d', 'jira')).toBe(path.join('/d', '.tracker.jira.attempts'));
  });

  it('the staged prefix is the one the Tracker agent stages under (PF-013)', async () => {
    // The agent's prompt cannot import from here, so the mktemp template is a
    // second spelling; an uninstall sweep keyed to a prefix the agent no longer
    // uses walks past every orphaned stage while reporting ~/.devflow swept.
    const agent = await fs.readFile(TRACKER_AGENT_SOURCE, 'utf-8');
    expect(agent).toContain(`${TRACKER_STAGED_PREFIX}XXXXXX`);
    // Non-vacuity: the match is exact-literal, so a neighbouring template must
    // not satisfy it.
    expect(agent).not.toContain(`${TRACKER_STAGED_PREFIX}XXXXXXX`);
  });
});

// ── The registry is the ONE authority on the provider domain (PF-049) ─────────
//
// `TrackerProvider` is a projection of TRACKER_PROVIDERS, so the type domain and
// the runtime domain are the same set by construction. Nothing at RUNTIME can
// tell a derived union from a hand-listed one — both produce identical values —
// so the guard is over the DECLARATIONS, each collector carrying a known-bad
// probe so it cannot pass vacuously (PF-018).

/**
 * Named collector: the right-hand side of the exported `TrackerProvider` alias.
 *
 * Scoped to the declaration rather than to the file, so "the word `typeof`
 * appears somewhere in tracker.ts" can never satisfy the assertion below.
 * `null` when the alias is absent — reported, never silently passed.
 */
function providerAliasBody(source: string): string | null {
  const marker = 'export type TrackerProvider =';
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const end = source.indexOf(';', start + marker.length);
  if (end === -1) return null;
  return source.slice(start + marker.length, end).trim();
}

/**
 * Named collector: the registry declaration, from `export const TRACKER_PROVIDERS`
 * through the `;` that closes it. The rows carry no `;`, so the first `;\n` after
 * the marker is the terminator. `null` when the declaration is absent.
 */
function registryDeclaration(source: string): string | null {
  const marker = 'export const TRACKER_PROVIDERS';
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const end = source.indexOf(';\n', start);
  if (end === -1) return null;
  return source.slice(start, end + 1);
}

describe('the provider domain is derived from the registry (PF-049)', () => {
  let source: string;

  beforeEach(async () => {
    source = await fs.readFile(MODULE_SOURCE, 'utf-8');
  });

  it('declares TrackerProvider as a projection of TRACKER_PROVIDERS, never a hand-listed union', () => {
    const body = providerAliasBody(source);
    expect(body).not.toBeNull();
    expect(body).toContain('typeof TRACKER_PROVIDERS');
    // A literal here would be a second hand-maintained authority: `'asana'` added
    // to the union alone typechecks at every consumer while parseTrackerId rejects
    // it and providerChoices() never offers it.
    for (const id of TRACKER_PROVIDER_IDS) {
      expect(body, `the union must not spell ${id} by hand`).not.toContain(`'${id}'`);
    }
  });

  it('pins the registry rows with `as const satisfies`, so the ids stay literal', () => {
    const declaration = registryDeclaration(source);
    expect(declaration).not.toBeNull();
    // `satisfies` checks every row against the row shape; `as const` is what stops
    // the ids widening to `string` and collapsing the derived domain.
    expect(declaration).toContain('as const satisfies');
    expect(declaration).toContain('TrackerProviderDefinition');
  });

  it('known-bad probe: both collectors report a hand-listed union and registry', () => {
    // The two assertions above are evidence only while these collectors can fail.
    const handListed =
      "export type TrackerProvider = 'github' | 'jira' | 'linear';\n" +
      'export const TRACKER_PROVIDERS: readonly TrackerProviderDefinition[] = [\n' +
      "  { id: 'github', label: 'GitHub', hint: 'x' },\n" +
      '];\n';
    expect(providerAliasBody(handListed)).toBe("'github' | 'jira' | 'linear'");
    expect(providerAliasBody(handListed)).not.toContain('typeof TRACKER_PROVIDERS');
    expect(registryDeclaration(handListed)).not.toContain('as const satisfies');
    // An absent declaration is reported, never passed off as "nothing to check".
    expect(providerAliasBody('// no tracker types here')).toBeNull();
    expect(registryDeclaration('// no tracker registry here')).toBeNull();
  });
});

describe('isTrackerProvider (the one runtime membership test)', () => {
  it('accepts every registry id', () => {
    expect(TRACKER_PROVIDER_IDS.length).toBeGreaterThan(0);
    for (const id of TRACKER_PROVIDER_IDS) {
      expect(isTrackerProvider(id), `expected ${id} to be admitted`).toBe(true);
    }
  });

  it('rejects every non-string and every value outside the registry', () => {
    const REJECTED: Array<[label: string, value: unknown]> = [
      ['undefined', undefined],
      ['null', null],
      ['a number', 3],
      ['an object', {}],
      ['an array holding a valid id', ['jira']],
      ['an unknown id', 'asana'],
      ['a suffixed variant', 'jira-cloud'],
      ['an uppercase id', 'JIRA'],
      ['a padded id', 'jira '],
      ['the empty string', ''],
    ];
    expect(REJECTED.length).toBe(10);
    for (const [label, value] of REJECTED) {
      expect(isTrackerProvider(value), `expected ${label} to be rejected`).toBe(false);
    }
  });
});

// ── parseTrackerId — strict: REJECT, NEVER REPAIR ─────────────────────────────

describe('parseTrackerId (strict boundary parser)', () => {
  it('accepts each registry id exactly', () => {
    for (const id of TRACKER_PROVIDER_IDS) {
      const result = parseTrackerId(id);
      expect(result.ok, `expected ${id} to parse`).toBe(true);
      if (result.ok) expect(result.value).toBe(id);
    }
  });

  // EC-59 / non-vacuity register row 21: the hostile payload table.
  // Every row must be REJECTED — reject-never-repair. `jira-cloud` must NOT
  // normalise to `jira`, `JIRA` must NOT case-fold, `jira ` must NOT trim.
  const HOSTILE: Array<[label: string, payload: string]> = [
    ['uppercase', 'JIRA'],
    ['mixed case', 'GitHub'],
    ['trailing space', 'jira '],
    ['leading space', ' jira'],
    ['bare space', ' '],
    ['suffixed variant', 'jira-cloud'],
    ['path traversal', '../../etc/passwd'],
    ['path traversal through a valid id', 'github/../../rules/devflow'],
    ['empty', ''],
    ['200 chars', 'j'.repeat(200)],
    ['backticked', '`id`'],
    ['command substitution', '$(id)'],
    ['newline injection', 'jira\nlinear'],
  ];

  it('rejects every hostile payload, naming the valid ids', () => {
    // Non-vacuity: the table itself is pinned, so deleting a payload fails RED.
    expect(HOSTILE.length).toBe(13);
    for (const [label, payload] of HOSTILE) {
      const result = parseTrackerId(payload);
      expect(result.ok, `expected ${label} ("${payload}") to be rejected`).toBe(false);
      if (!result.ok) {
        for (const id of TRACKER_PROVIDER_IDS) {
          expect(result.error).toContain(id);
        }
      }
    }
  });

  it('reject-never-repair: jira-cloud errors instead of normalising to jira', () => {
    const result = parseTrackerId('jira-cloud');
    expect(result.ok).toBe(false);
    // Known-bad probe for the assertion itself: a repairing parser would have
    // returned {ok:true, value:'jira'} here.
    if (result.ok) expect(result.value).not.toBe('jira');
  });

  it('the error quotes the offending value', () => {
    const result = parseTrackerId('jira-cloud');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('jira-cloud');
  });

  it('the echoed value is bounded and control-character free', () => {
    const hostile = `[31mjira${'x'.repeat(500)}`;
    const result = parseTrackerId(hostile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain('');
      expect(result.error).not.toContain('');
      // The 500-char payload must not be echoed in full.
      expect(result.error.length).toBeLessThan(200);
    }
  });
});

/**
 * A UTF-16 string is well formed when every surrogate is one half of a pair.
 * Truncating by code UNIT can leave the other half behind, and a lone surrogate
 * is mojibake at every sink the value is echoed to.
 */
function hasLoneSurrogate(value: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}

describe('describeTrackerValue', () => {
  it('replaces control characters and truncates long values', () => {
    expect(describeTrackerValue('jira[0m')).not.toContain('');
    expect(describeTrackerValue('a'.repeat(120)).length).toBeLessThanOrEqual(41);
  });

  it('passes a well-formed id through unchanged', () => {
    expect(describeTrackerValue('jira')).toBe('jira');
  });

  it('truncates by code point, so an astral character is never cut in half', () => {
    // Known-bad probe for the detector itself: it must call a bare high surrogate
    // broken and a whole pair fine, or the assertion below passes vacuously.
    expect(hasLoneSurrogate('\uD83D')).toBe(true);
    expect(hasLoneSurrogate('\uD83D\uDE00')).toBe(false);

    // 39 BMP characters put the 40th UTF-16 code unit inside the first pair.
    const rendered = describeTrackerValue(`${'x'.repeat(39)}${'\u{1F600}'.repeat(5)}`);
    expect(hasLoneSurrogate(rendered)).toBe(false);
  });

  it('bounds an all-astral value at 40 code points plus the ellipsis', () => {
    const rendered = describeTrackerValue('\u{1F600}'.repeat(60));
    expect(hasLoneSurrogate(rendered)).toBe(false);
    expect([...rendered]).toHaveLength(41);
  });

  // ── the never-throws contract, at the sink that has to honour it (PF-014) ───
  //
  // The module header promises nothing here throws. This is the display sink
  // every rejected value passes through, and `raw.replace` on a non-string makes
  // that promise false one deleted caller-side guard away.

  it('never throws on a value the type says cannot reach it', () => {
    const NON_STRINGS: Array<[label: string, value: unknown]> = [
      ['undefined', undefined],
      ['null', null],
      ['a number', 7],
      ['a boolean', false],
      ['an object', {}],
      ['an array', ['jira']],
      ['a symbol', Symbol('jira')],
      ['a null-prototype object', Object.create(null)],
      ['an object whose toString throws', { toString() { throw new Error('boom'); } }],
    ];
    expect(NON_STRINGS.length).toBe(9);
    for (const [label, value] of NON_STRINGS) {
      expect(() => describeTrackerValue(value), `${label} must not throw`).not.toThrow();
    }
  });

  it('renders a non-string by its type, never by asking the value what it is', () => {
    // Naming the type keeps the render total: `String(raw)` would hand control to
    // a caller-supplied toString, which is both a throw path and an echo path.
    expect(describeTrackerValue(undefined)).toBe('<undefined>');
    expect(describeTrackerValue(null)).toBe('<null>');
    expect(describeTrackerValue(7)).toBe('<number>');
    expect(describeTrackerValue({ toString: () => '[31mowned' })).toBe('<object>');
  });

  it('parseTrackerId reports a non-string instead of throwing', () => {
    // The caller-side guard this depends on is one edit from being gone; the
    // parser's own contract is that it always returns a Result.
    const result = parseTrackerId(undefined as unknown as string);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('<undefined>');
  });
});

// ── normalizeTrackerFeature — tolerant sink (ADR-014 self-heal) ───────────────

describe('normalizeTrackerFeature (tolerant sink normaliser)', () => {
  const MALFORMED: Array<[label: string, raw: unknown]> = [
    ['absent', undefined],
    ['null', null],
    ['a bare string (the shape AC-3.21 names)', 'jira'],
    ['a number', 7],
    ['an array', ['jira']],
    ['an object with no provider', {}],
    ['an object with a null provider', { provider: null }],
    ['an object with a numeric provider', { provider: 3 }],
    ['an object with an unknown provider', { provider: 'jira-cloud' }],
    ['an object with an uppercase provider', { provider: 'JIRA' }],
    ['an object with a traversal provider', { provider: '../../etc/passwd' }],
  ];

  it('self-heals every malformed shape to {provider:"github"}', () => {
    expect(MALFORMED.length).toBe(11);
    for (const [label, raw] of MALFORMED) {
      expect(normalizeTrackerFeature(raw), `expected ${label} to self-heal`).toEqual({ provider: 'github' });
    }
  });

  it('preserves each valid provider', () => {
    for (const id of TRACKER_PROVIDER_IDS) {
      expect(normalizeTrackerFeature({ provider: id })).toEqual({ provider: id });
    }
  });

  it('drops unknown sibling keys rather than carrying them through', () => {
    expect(normalizeTrackerFeature({ provider: 'jira', enabled: true })).toEqual({ provider: 'jira' });
  });

  it('never aliases its input object', () => {
    const raw = { provider: 'jira' };
    const normalized = normalizeTrackerFeature(raw);
    expect(normalized).not.toBe(raw);
  });
});

// ── Path derivation + lifecycle helpers ───────────────────────────────────────

describe('tracker file lifecycle', () => {
  let devflowDir: string;

  beforeEach(async () => {
    // PF-060: a mkdtemp root, never the developer's real ~/.devflow.
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-core-tracker-'));
  });

  afterEach(async () => {
    await fs.rm(devflowDir, { recursive: true, force: true });
  });

  it('derives every path from the devflow dir and the shared basenames', () => {
    expect(trackerConventionsDir(devflowDir)).toBe(path.join(devflowDir, 'tracker'));
    for (const provider of TRACKER_PROVIDER_IDS) {
      expect(trackerConventionsPath(devflowDir, provider)).toBe(path.join(devflowDir, 'tracker', `${provider}.md`));
      expect(trackerAttemptsPath(devflowDir, provider)).toBe(path.join(devflowDir, `.tracker.${provider}.attempts`));
    }
    expect(trackerEnabledSentinelPath(devflowDir)).toBe(path.join(devflowDir, '.tracker.enabled'));
  });

  // ── rearmTrackerInference [DR-22] ──────────────────────────────────────────

  it('rearmTrackerInference removes every provider\'s attempt counter', async () => {
    // Every provider, not only the machine's: a repository's project.json can
    // select a provider the machine never did, and that is the counter a user in
    // that repository is capped on.
    for (const provider of TRACKER_PROVIDER_IDS) {
      await fs.writeFile(trackerAttemptsPath(devflowDir, provider), '5\n', 'utf-8');
    }

    const result = await rearmTrackerInference(devflowDir);

    expect(result.ok).toBe(true);
    for (const provider of TRACKER_PROVIDER_IDS) {
      await expect(fs.access(trackerAttemptsPath(devflowDir, provider))).rejects.toThrow();
    }
  });

  it('rearmTrackerInference is idempotent when the counter is absent', async () => {
    const first = await rearmTrackerInference(devflowDir);
    const second = await rearmTrackerInference(devflowDir);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('rearmTrackerInference never throws when the devflow dir does not exist', async () => {
    const missing = path.join(devflowDir, 'does', 'not', 'exist');
    const result = await rearmTrackerInference(missing);
    expect(result.ok).toBe(true);
  });

  it('rearmTrackerInference reports a removal it cannot make, and never throws', async () => {
    // The failure arm, driven rather than asserted about: `force` swallows an
    // absent file but not a DIRECTORY sitting where the counter file belongs, so
    // the rm rejects. Without this the whole warn-never-abort posture (PF-009) is
    // untested for this owner.
    await fs.mkdir(trackerAttemptsPath(devflowDir, 'jira'));

    const result = await rearmTrackerInference(devflowDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('attempt counter');
    // The obstruction is reported, never removed behind the user's back.
    await expect(fs.access(trackerAttemptsPath(devflowDir, 'jira'))).resolves.toBeUndefined();
  });

  // ── applyTrackerSentinel [DR-10] ───────────────────────────────────────────

  it('applyTrackerSentinel writes the provider NAME, one line, for a non-github provider', async () => {
    for (const provider of ['jira', 'linear'] as TrackerProvider[]) {
      await fs.rm(trackerEnabledSentinelPath(devflowDir), { force: true });
      const result = await applyTrackerSentinel(devflowDir, provider);
      expect(result.ok, `expected the sentinel write to succeed for ${provider}`).toBe(true);
      // The hook reads this with `read -r`: the name, and nothing else on the line.
      await expect(fs.readFile(trackerEnabledSentinelPath(devflowDir), 'utf-8')).resolves.toBe(`${provider}\n`);
    }
  });

  it('applyTrackerSentinel rewrites a zero-byte sentinel an earlier release left', async () => {
    await fs.writeFile(trackerEnabledSentinelPath(devflowDir), '', 'utf-8');
    expect((await applyTrackerSentinel(devflowDir, 'linear')).ok).toBe(true);
    await expect(fs.readFile(trackerEnabledSentinelPath(devflowDir), 'utf-8')).resolves.toBe('linear\n');
  });

  it('applyTrackerSentinel removes the sentinel for github', async () => {
    await fs.writeFile(trackerEnabledSentinelPath(devflowDir), 'jira\n', 'utf-8');

    const result = await applyTrackerSentinel(devflowDir, 'github');

    expect(result.ok).toBe(true);
    await expect(fs.access(trackerEnabledSentinelPath(devflowDir))).rejects.toThrow();
  });

  it('applyTrackerSentinel is idempotent in both directions', async () => {
    expect((await applyTrackerSentinel(devflowDir, 'github')).ok).toBe(true);
    expect((await applyTrackerSentinel(devflowDir, 'jira')).ok).toBe(true);
    expect((await applyTrackerSentinel(devflowDir, 'jira')).ok).toBe(true);
    await expect(fs.readFile(trackerEnabledSentinelPath(devflowDir), 'utf-8')).resolves.toBe('jira\n');
    expect((await applyTrackerSentinel(devflowDir, 'github')).ok).toBe(true);
    await expect(fs.access(trackerEnabledSentinelPath(devflowDir))).rejects.toThrow();
  });

  it('applyTrackerSentinel creates the devflow dir when it is absent', async () => {
    const fresh = path.join(devflowDir, 'nested');
    const result = await applyTrackerSentinel(fresh, 'jira');
    expect(result.ok).toBe(true);
    await expect(fs.access(path.join(fresh, '.tracker.enabled'))).resolves.toBeUndefined();
  });

  it('applyTrackerSentinel reports a sentinel it cannot write, and never throws', async () => {
    // The failure arm, driven rather than asserted about: a devflow dir whose
    // parent is a FILE cannot be created (ENOTDIR), so the write rejects. Without
    // this the warn-never-abort posture (PF-009) is untested for this owner.
    const blocker = path.join(devflowDir, 'not-a-dir');
    await fs.writeFile(blocker, '', 'utf-8');

    const result = await applyTrackerSentinel(path.join(blocker, 'devflow'), 'jira');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('tracker sentinel');
    // Non-vacuity: the same call against a writable dir succeeds, so the failure
    // above is the blocked parent and not a helper that never writes anything.
    expect((await applyTrackerSentinel(devflowDir, 'jira')).ok).toBe(true);
  });

  // ── parseTrackerFrontmatter (the one parser --status and the migration share) ──

  it('parseTrackerFrontmatter reads provider and inferred-from, first occurrence winning', () => {
    expect(parseTrackerFrontmatter('---\nprovider: jira\ninferred-from: /r @ t\nprovider: linear\n---\n## Project\n'))
      .toEqual({ hasFrontmatter: true, provider: 'jira', inferredFrom: '/r @ t' });
  });

  it('parseTrackerFrontmatter reports no frontmatter off offset 0, and keeps values raw', () => {
    expect(parseTrackerFrontmatter('## Project\n---\nprovider: jira\n---\n')).toEqual({ hasFrontmatter: false });
    // Raw: the caller gates. A value the registry would refuse is returned as-is.
    expect(parseTrackerFrontmatter('---\nprovider: JIRA\n---\n').provider).toBe('JIRA');
    expect(parseTrackerFrontmatter('---\ninferred-from: x\n---\n'))
      .toEqual({ hasFrontmatter: true, provider: undefined, inferredFrom: 'x' });
  });

  // ── migrateLegacyTrackerConventions (TP-39, D-TRACKER-PER-PROVIDER-CONVENTIONS) ──

  const legacyOf = (dir: string): string => path.join(dir, TRACKER_LEGACY_CONVENTIONS_FILE);

  it('moves a legacy tracker.md to the provider file its frontmatter names', async () => {
    const body = '---\nprovider: jira\n---\n## Project\nkey: ACME\n';
    await fs.writeFile(legacyOf(devflowDir), body, { mode: 0o600 });

    const outcome = await migrateLegacyTrackerConventions(devflowDir);

    expect(outcome).toEqual({
      kind: 'moved',
      from: legacyOf(devflowDir),
      to: trackerConventionsPath(devflowDir, 'jira'),
      provider: 'jira',
    });
    await expect(fs.readFile(trackerConventionsPath(devflowDir, 'jira'), 'utf-8')).resolves.toBe(body);
    await expect(fs.lstat(legacyOf(devflowDir))).rejects.toThrow();
    // A move, not a copy: the file keeps its mode.
    expect((await fs.stat(trackerConventionsPath(devflowDir, 'jira'))).mode & 0o777).toBe(0o600);
  });

  it('is a no-op on a re-run, and on a machine that never had a legacy file', async () => {
    await fs.writeFile(legacyOf(devflowDir), '---\nprovider: linear\n---\n', 'utf-8');
    expect((await migrateLegacyTrackerConventions(devflowDir)).kind).toBe('moved');
    const before = await fs.readFile(trackerConventionsPath(devflowDir, 'linear'), 'utf-8');

    expect(await migrateLegacyTrackerConventions(devflowDir)).toEqual({ kind: 'none' });
    await expect(fs.readFile(trackerConventionsPath(devflowDir, 'linear'), 'utf-8')).resolves.toBe(before);

    const fresh = path.join(devflowDir, 'fresh');
    expect(await migrateLegacyTrackerConventions(fresh)).toEqual({ kind: 'none' });
    await expect(fs.access(fresh), 'a machine with nothing to move gets nothing created').rejects.toThrow();
  });

  it('never overwrites an existing provider file — the legacy file stays, with one reason', async () => {
    await fs.mkdir(trackerConventionsDir(devflowDir));
    await fs.writeFile(trackerConventionsPath(devflowDir, 'jira'), 'hand-corrected\n', 'utf-8');
    await fs.writeFile(legacyOf(devflowDir), '---\nprovider: jira\n---\nolder\n', 'utf-8');

    const outcome = await migrateLegacyTrackerConventions(devflowDir);

    expect(outcome.kind).toBe('kept');
    if (outcome.kind !== 'kept') return;
    expect(outcome.reason).toContain(trackerConventionsPath(devflowDir, 'jira'));
    await expect(fs.readFile(trackerConventionsPath(devflowDir, 'jira'), 'utf-8')).resolves.toBe('hand-corrected\n');
    await expect(fs.readFile(legacyOf(devflowDir), 'utf-8')).resolves.toBe('---\nprovider: jira\n---\nolder\n');
  });

  it('moves a SYMLINK itself and never touches the file it points at', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-core-tracker-dotfiles-'));
    try {
      const target = path.join(outside, 'tracker.md');
      const body = '---\nprovider: jira\n---\n## Project\n';
      await fs.writeFile(target, body, 'utf-8');
      await fs.symlink(target, legacyOf(devflowDir));

      const outcome = await migrateLegacyTrackerConventions(devflowDir);

      expect(outcome.kind).toBe('moved');
      const moved = trackerConventionsPath(devflowDir, 'jira');
      expect((await fs.lstat(moved)).isSymbolicLink(), 'the link moved, not a copy of its target').toBe(true);
      await expect(fs.readlink(moved)).resolves.toBe(target);
      // The target is where it was, byte-identical, and still a regular file.
      expect((await fs.lstat(target)).isFile()).toBe(true);
      await expect(fs.readFile(target, 'utf-8')).resolves.toBe(body);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('leaves a file whose frontmatter names no provider in place, with one reason', async () => {
    for (const body of ['## Project\nkey: ACME\n', '---\ninferred-from: x\n---\n', '---\nprovider: jira-cloud\n---\n']) {
      await fs.writeFile(legacyOf(devflowDir), body, 'utf-8');

      const outcome = await migrateLegacyTrackerConventions(devflowDir);

      expect(outcome.kind, JSON.stringify(body)).toBe('kept');
      await expect(fs.readFile(legacyOf(devflowDir), 'utf-8')).resolves.toBe(body);
      await expect(fs.access(trackerConventionsDir(devflowDir)), 'nothing is created for it').rejects.toThrow();
    }
  });

  it('removes the legacy single attempt counter', async () => {
    await fs.writeFile(path.join(devflowDir, TRACKER_LEGACY_ATTEMPTS_FILE), '5\n', 'utf-8');
    expect(await migrateLegacyTrackerConventions(devflowDir)).toEqual({ kind: 'none' });
    await expect(fs.access(path.join(devflowDir, TRACKER_LEGACY_ATTEMPTS_FILE))).rejects.toThrow();
  });

  it('reports an I/O failure as failed, never throws, and leaves the legacy file', async () => {
    // A FILE where the conventions directory belongs: the mkdir under it fails.
    await fs.writeFile(trackerConventionsDir(devflowDir), 'not a directory', 'utf-8');
    await fs.writeFile(legacyOf(devflowDir), '---\nprovider: jira\n---\n', 'utf-8');

    const outcome = await migrateLegacyTrackerConventions(devflowDir);

    expect(outcome.kind).toBe('failed');
    await expect(fs.readFile(legacyOf(devflowDir), 'utf-8')).resolves.toBe('---\nprovider: jira\n---\n');
  });
});

// -- TRACKER_ATTEMPTS_MAX -- the cap, shared with the SessionStart hook --------
//
// The hook is the enforcer and cannot import from here (PF-013), so the literal
// exists twice; `devflow tracker --status` quotes the constant, and this pin is
// what stops it quoting a number the hook no longer enforces.

describe('TRACKER_ATTEMPTS_MAX', () => {
  const HOOK_SOURCE = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', '..',
    'src', 'assets', 'scripts', 'hooks', 'session-start-context',
  );

  it('is the cap the SessionStart hook enforces', async () => {
    const hook = await fs.readFile(HOOK_SOURCE, 'utf-8');
    expect(hook).toContain(`TRACKER_ATTEMPTS_MAX=${TRACKER_ATTEMPTS_MAX}`);
    // Non-vacuity: the match above is exact-literal, so a neighbouring cap must
    // not satisfy it.
    expect(hook).not.toContain(`TRACKER_ATTEMPTS_MAX=${TRACKER_ATTEMPTS_MAX + 1}`);
  });
});

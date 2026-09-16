/**
 * Tests for src/core/tracker.ts
 *
 * Covers:
 *   - TRACKER_PROVIDERS registry shape (+ the "MCP stays out of user-facing text" bound)
 *   - parseTrackerId: strict boundary parser — REJECT, NEVER REPAIR (hostile table)
 *   - normalizeTrackerFeature: tolerant sink normaliser (ADR-014 self-heal)
 *   - trackerAttemptsPath / trackerEnabledSentinelPath / trackerConventionsPath
 *   - rearmTrackerInference: idempotent-when-absent / removes-when-present / never throws [DR-22]
 *   - applyTrackerSentinel: written when provider != github, removed when it is [DR-10]
 *   - renameStaleTrackerConventions: the provider-change transition (P3a-S15 / AC-3.20)
 *   - TRACKER_PROVIDER_KEY_PATH: the shared TS<->shell manifest key path constant
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

import {
  TRACKER_PROVIDERS,
  TRACKER_PROVIDER_IDS,
  TRACKER_PROVIDER_KEY_PATH,
  DEFAULT_TRACKER_PROVIDER,
  TRACKER_CONVENTIONS_FILE,
  TRACKER_ATTEMPTS_FILE,
  TRACKER_ENABLED_FILE,
  TRACKER_CLAIM_FILE,
  parseTrackerId,
  normalizeTrackerFeature,
  describeTrackerValue,
  trackerConventionsPath,
  trackerAttemptsPath,
  trackerEnabledSentinelPath,
  rearmTrackerInference,
  applyTrackerSentinel,
  renameStaleTrackerConventions,
  type TrackerProvider,
} from '../../src/core/tracker.js';
import { readManifest } from '../../src/core/manifest.js';

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
    expect(TRACKER_CONVENTIONS_FILE).toBe('tracker.md');
    expect(TRACKER_ATTEMPTS_FILE).toBe('.tracker.attempts');
    expect(TRACKER_ENABLED_FILE).toBe('.tracker.enabled');
    expect(TRACKER_CLAIM_FILE).toBe('.tracker.processing');
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

describe('describeTrackerValue', () => {
  it('replaces control characters and truncates long values', () => {
    expect(describeTrackerValue('jira[0m')).not.toContain('');
    expect(describeTrackerValue('a'.repeat(120)).length).toBeLessThanOrEqual(41);
  });

  it('passes a well-formed id through unchanged', () => {
    expect(describeTrackerValue('jira')).toBe('jira');
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
    expect(trackerConventionsPath(devflowDir)).toBe(path.join(devflowDir, 'tracker.md'));
    expect(trackerAttemptsPath(devflowDir)).toBe(path.join(devflowDir, '.tracker.attempts'));
    expect(trackerEnabledSentinelPath(devflowDir)).toBe(path.join(devflowDir, '.tracker.enabled'));
  });

  // ── rearmTrackerInference [DR-22] ──────────────────────────────────────────

  it('rearmTrackerInference removes the attempt counter when present', async () => {
    const counter = trackerAttemptsPath(devflowDir);
    await fs.writeFile(counter, '3\n', 'utf-8');

    const result = await rearmTrackerInference(devflowDir);

    expect(result.ok).toBe(true);
    await expect(fs.access(counter)).rejects.toThrow();
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

  // ── applyTrackerSentinel [DR-10] ───────────────────────────────────────────

  it('applyTrackerSentinel writes a zero-byte sentinel for a non-github provider', async () => {
    for (const provider of ['jira', 'linear'] as TrackerProvider[]) {
      await fs.rm(trackerEnabledSentinelPath(devflowDir), { force: true });
      const result = await applyTrackerSentinel(devflowDir, provider);
      expect(result.ok, `expected the sentinel write to succeed for ${provider}`).toBe(true);
      const stat = await fs.stat(trackerEnabledSentinelPath(devflowDir));
      expect(stat.size).toBe(0);
    }
  });

  it('applyTrackerSentinel removes the sentinel for github', async () => {
    await fs.writeFile(trackerEnabledSentinelPath(devflowDir), '', 'utf-8');

    const result = await applyTrackerSentinel(devflowDir, 'github');

    expect(result.ok).toBe(true);
    await expect(fs.access(trackerEnabledSentinelPath(devflowDir))).rejects.toThrow();
  });

  it('applyTrackerSentinel is idempotent in both directions', async () => {
    expect((await applyTrackerSentinel(devflowDir, 'github')).ok).toBe(true);
    expect((await applyTrackerSentinel(devflowDir, 'jira')).ok).toBe(true);
    expect((await applyTrackerSentinel(devflowDir, 'jira')).ok).toBe(true);
    await expect(fs.access(trackerEnabledSentinelPath(devflowDir))).resolves.toBeUndefined();
    expect((await applyTrackerSentinel(devflowDir, 'github')).ok).toBe(true);
    await expect(fs.access(trackerEnabledSentinelPath(devflowDir))).rejects.toThrow();
  });

  it('applyTrackerSentinel creates the devflow dir when it is absent', async () => {
    const fresh = path.join(devflowDir, 'nested');
    const result = await applyTrackerSentinel(fresh, 'jira');
    expect(result.ok).toBe(true);
    await expect(fs.access(path.join(fresh, '.tracker.enabled'))).resolves.toBeUndefined();
  });

  // ── renameStaleTrackerConventions (P3a-S15 / AC-3.20) ──────────────────────

  it('renames a stale tracker.md to tracker.md.{old}.bak on a provider change', async () => {
    await fs.writeFile(trackerConventionsPath(devflowDir), '---\nprovider: jira\n---\n', 'utf-8');

    const transition = await renameStaleTrackerConventions(devflowDir, 'jira', 'github');

    expect(transition.kind).toBe('renamed');
    if (transition.kind !== 'renamed') return;
    expect(transition.to).toBe(path.join(devflowDir, 'tracker.md.jira.bak'));
    // Deterministic asserted end-state: the backup is present, tracker.md is gone,
    // so the next session re-arms inference instead of trusting a stale file.
    await expect(fs.access(transition.to)).resolves.toBeUndefined();
    await expect(fs.access(trackerConventionsPath(devflowDir))).rejects.toThrow();
  });

  it('does nothing when the provider is unchanged', async () => {
    await fs.writeFile(trackerConventionsPath(devflowDir), 'stale', 'utf-8');

    const transition = await renameStaleTrackerConventions(devflowDir, 'jira', 'jira');

    expect(transition.kind).toBe('none');
    // The file must still be there — an unchanged provider is not a transition.
    await expect(fs.access(trackerConventionsPath(devflowDir))).resolves.toBeUndefined();
  });

  it('does nothing on a fresh install with no prior provider', async () => {
    const transition = await renameStaleTrackerConventions(devflowDir, undefined, 'jira');
    expect(transition.kind).toBe('none');
  });

  it('does nothing when the provider changed but no tracker.md exists', async () => {
    const transition = await renameStaleTrackerConventions(devflowDir, 'github', 'jira');
    expect(transition.kind).toBe('none');
    await expect(fs.access(path.join(devflowDir, 'tracker.md.github.bak'))).rejects.toThrow();
  });

  it('never throws when the rename target cannot be written', async () => {
    // Refuse-with-instruction is rejected: devflow init must never abort on a
    // feature-state change (PF-009 isolation posture). A failed rename reports.
    const missing = path.join(devflowDir, 'absent-dir');
    const transition = await renameStaleTrackerConventions(missing, 'jira', 'github');
    expect(['none', 'failed']).toContain(transition.kind);
  });
});

// ── TS <-> shell manifest key-path parity (the shared constant) ────────────────

describe('TRACKER_PROVIDER_KEY_PATH', () => {
  let devflowDir: string;

  beforeEach(async () => {
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-core-tracker-key-'));
  });

  afterEach(async () => {
    await fs.rm(devflowDir, { recursive: true, force: true });
  });

  it('is the dotted manifest path both the TS reader and the shell reader use', () => {
    expect(TRACKER_PROVIDER_KEY_PATH).toBe('features.tracker.provider');
  });

  it('walking the dotted path over a real manifest yields what readManifest yields', async () => {
    const data = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: {
        ambient: true, memory: true, hud: false, knowledge: false, learning: false,
        rules: true, flags: {}, proxy: false,
        compliance: { enabled: false, frameworks: [] },
        tracker: { provider: 'jira' },
      },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), JSON.stringify(data), 'utf-8');

    // The shell side (json_field_file) splits on '.' and walks — model that here so
    // the constant cannot drift from the shape readManifest parses.
    const walked = TRACKER_PROVIDER_KEY_PATH.split('.').reduce<unknown>(
      (node, segment) => (node !== null && typeof node === 'object'
        ? (node as Record<string, unknown>)[segment]
        : undefined),
      data,
    );

    const manifest = await readManifest(devflowDir);
    expect(manifest).not.toBeNull();
    expect(walked).toBe('jira');
    expect(manifest!.features.tracker.provider).toBe(walked);
  });
});

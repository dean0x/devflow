/**
 * Tests for src/cli/commands/tracker.ts
 *
 * Covers:
 *   - resolveTrackerCliAction pure resolver matrix
 *   - parseTrackerId "Commander parse pin" (error names every valid ID)
 *   - readTrackerProvenance / formatTrackerProvenance (the --status surface)
 *   - the [DR-22] / [DR-10] / P3a-S15 call-site assertions for this command
 *
 * Init-seed tracker seeding coverage (resolveSeedFeatures, applyCliToggles,
 * resolveResetGatedInputs) lives in tests/init-seed.test.ts — tracker seeding
 * section. The provider domain, the strict parser's hostile table and the file
 * lifecycle live in tests/core/tracker.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  resolveTrackerCliAction,
  readTrackerProvenance,
  formatTrackerProvenance,
} from '../src/cli/commands/tracker.js';
import { TRACKER_PROVIDER_IDS, parseTrackerId } from '../src/core/tracker.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKER_CLI_SOURCE = path.join(REPO_ROOT, 'src', 'cli', 'commands', 'tracker.ts');

// ── resolveTrackerCliAction ───────────────────────────────────────────────────

describe('resolveTrackerCliAction', () => {
  it('set replaces the provider and reports the change', () => {
    const result = resolveTrackerCliAction({ provider: 'github' }, 'set', 'jira');
    expect(result.nextState).toEqual({ provider: 'jira' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].level).toBe('success');
    expect(result.messages[0].text).toContain('jira');
  });

  it('set to the provider already in the manifest is reported as a no-change', () => {
    const result = resolveTrackerCliAction({ provider: 'jira' }, 'set', 'jira');
    expect(result.nextState).toEqual({ provider: 'jira' });
    expect(result.messages.some(m => m.text.toLowerCase().includes('already'))).toBe(true);
  });

  it('set back to github is honoured — github is the off switch (decision D-E)', () => {
    // There is no --no-tracker: `--set github` IS the way off.
    const result = resolveTrackerCliAction({ provider: 'linear' }, 'set', 'github');
    expect(result.nextState).toEqual({ provider: 'github' });
    expect(result.messages[0].text).toContain('github');
  });

  it('set with no provider leaves the current state untouched', () => {
    // Defensive: the caller parses --set at the boundary, so this arm should be
    // unreachable — it must still never invent a provider.
    const result = resolveTrackerCliAction({ provider: 'linear' }, 'set');
    expect(result.nextState).toEqual({ provider: 'linear' });
  });

  it('status → nextState unchanged, no messages', () => {
    const current = { provider: 'jira' as const };
    const result = resolveTrackerCliAction(current, 'status');
    expect(result.nextState).toEqual(current);
    expect(result.messages).toHaveLength(0);
  });

  it('never aliases the current state', () => {
    const current = { provider: 'jira' as const };
    const result = resolveTrackerCliAction(current, 'status');
    expect(result.nextState).not.toBe(current);
  });
});

// ── Commander parse pin: --set with an unknown ID ──────────────────────────────

describe('parseTrackerId (Commander parse pin)', () => {
  it('rejects an unknown ID with an error naming every valid registry ID', () => {
    const result = parseTrackerId('jira-cloud');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const id of TRACKER_PROVIDER_IDS) {
        expect(result.error).toContain(id);
      }
      expect(result.error).toContain('jira-cloud');
    }
  });

  it('accepts all three valid IDs', () => {
    for (const id of TRACKER_PROVIDER_IDS) {
      expect(parseTrackerId(id).ok).toBe(true);
    }
  });
});

// ── --status provenance surface ────────────────────────────────────────────────

describe('tracker.md provenance (--status)', () => {
  let devflowDir: string;

  beforeEach(async () => {
    // PF-060: mkdtemp root; never the developer's real ~/.devflow.
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-cli-'));
  });

  afterEach(async () => {
    await fs.rm(devflowDir, { recursive: true, force: true });
  });

  it('reports absent when no tracker.md exists', async () => {
    const provenance = await readTrackerProvenance(devflowDir);
    expect(provenance.kind).toBe('absent');
    expect(formatTrackerProvenance(provenance)).toContain('not present');
  });

  it('reads provider and inferred-from out of the frontmatter', async () => {
    await fs.writeFile(
      path.join(devflowDir, 'tracker.md'),
      '---\nprovider: jira\ninferred-from: /Users/dev/proj at 2026-09-16T00:00:00Z\n---\n\n## Issue Types\n',
      'utf-8',
    );

    const provenance = await readTrackerProvenance(devflowDir);

    expect(provenance.kind).toBe('present');
    if (provenance.kind !== 'present') return;
    expect(provenance.provider).toBe('jira');
    expect(provenance.inferredFrom).toContain('/Users/dev/proj');
    const rendered = formatTrackerProvenance(provenance);
    expect(rendered).toContain('jira');
    expect(rendered).toContain('/Users/dev/proj');
  });

  it('reports a present file whose frontmatter is unreadable without inventing values', async () => {
    await fs.writeFile(path.join(devflowDir, 'tracker.md'), 'no frontmatter here\n', 'utf-8');

    const provenance = await readTrackerProvenance(devflowDir);

    expect(provenance.kind).toBe('present');
    if (provenance.kind !== 'present') return;
    expect(provenance.provider).toBeUndefined();
    expect(provenance.inferredFrom).toBeUndefined();
    expect(formatTrackerProvenance(provenance)).toContain('present');
  });

  it('sanitises hostile frontmatter values before they reach the terminal', async () => {
    // tracker.md is hand-editable and machine-wide, so its content is
    // third-party input at every sink — including a status line.
    await fs.writeFile(
      path.join(devflowDir, 'tracker.md'),
      `---\nprovider: [31mjira\ninferred-from: ${'x'.repeat(400)}\n---\n`,
      'utf-8',
    );

    const provenance = await readTrackerProvenance(devflowDir);
    expect(provenance.kind).toBe('present');
    const rendered = formatTrackerProvenance(provenance);
    expect(rendered).not.toContain('');
    expect(rendered).not.toContain('');
    expect(rendered.length).toBeLessThan(200);
  });

  it('never throws when the path is a directory rather than a file', async () => {
    await fs.mkdir(path.join(devflowDir, 'tracker.md'));
    const provenance = await readTrackerProvenance(devflowDir);
    // A directory is not a readable conventions file — reported, never thrown.
    expect(['absent', 'present']).toContain(provenance.kind);
  });
});

// ── Call-site assertions for this command ─────────────────────────────────────
//
// [DR-22] The attempt counter has exactly ONE owner (rearmTrackerInference) and
// `devflow tracker --set` calls it exactly once. [DR-10] the same for the
// sentinel. P3a-S15's rename transition is reachable from here too. These are
// source-level assertions because the Commander `.action()` body is not unit-
// reachable; they go red if someone inlines an `fs.rm`/`fs.writeFile` here or
// duplicates a call.

describe('devflow tracker --set call sites', () => {
  it('calls rearmTrackerInference exactly once and never inlines the removal [DR-22]', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');
    const calls = source.match(/rearmTrackerInference\(/g) ?? [];
    // One import reference + one call site.
    expect(calls.length).toBe(1);
    expect(source).not.toMatch(/\.tracker\.attempts/);
  });

  it('converges the sentinel through applyTrackerSentinel exactly once [DR-10]', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');
    const calls = source.match(/applyTrackerSentinel\(/g) ?? [];
    expect(calls.length).toBe(1);
    expect(source).not.toMatch(/\.tracker\.enabled/);
  });

  it('invokes the provider-change rename transition (P3a-S15)', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');
    const calls = source.match(/renameStaleTrackerConventions\(/g) ?? [];
    expect(calls.length).toBe(1);
  });

  it('persists through the generic syncManifestFeature — no bespoke manifest write', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');
    expect(source).toMatch(/syncManifestFeature\(/);
    expect(source).not.toMatch(/writeManifest\(/);
  });
});

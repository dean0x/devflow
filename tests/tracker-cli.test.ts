/**
 * Tests for src/cli/commands/tracker.ts
 *
 * Covers:
 *   - resolveTrackerCliAction pure resolver matrix
 *   - parseTrackerId "Commander parse pin" (error names every valid ID)
 *   - readTrackerProvenance / formatTrackerProvenance (the --status surface)
 *   - the D-F re-arm, driven as a subprocess against a seeded temp HOME
 *   - the [DR-22] / [DR-10] / P3a-S15 call-site assertions for this command
 *
 * Init-seed tracker seeding coverage (resolveSeedFeatures, applyCliToggles,
 * resolveResetGatedInputs) lives in tests/init-seed.test.ts — tracker seeding
 * section. The provider domain, the strict parser's hostile table and the file
 * lifecycle live in tests/core/tracker.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { requireBuiltCli } from './helpers.js';

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

// ── The D-F re-arm, end to end ───────────────────────────────────
//
// Decision D-F: the attempt cap is re-armed by `devflow init` AND by both
// `devflow tracker` subcommands. `--status` is the command a capped user
// reaches for to find out why nothing is being learned, so it is the command
// that has to hand back another five tries. Driven as a subprocess because the
// Commander `.action()` body is not unit-reachable.

describe('devflow tracker --status re-arms the attempt counter (D-F)', () => {
  let cli: string;
  let tmpHome: string;
  let devflowDir: string;

  beforeEach(async () => {
    cli = requireBuiltCli();
    // PF-060: a seeded mkdtemp HOME; never the developer's real one.
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-status-'));
    devflowDir = path.join(tmpHome, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
    await fs.writeFile(
      path.join(devflowDir, 'manifest.json'),
      JSON.stringify({
        version: '2.0.0',
        scope: 'user',
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        plugins: ['devflow-core-skills'],
        features: {
          ambient: false,
          memory: false,
          learning: false,
          knowledge: false,
          hud: false,
          rules: false,
          proxy: false,
          tracker: { provider: 'jira' },
        },
      }, null, 2),
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('removes a counter sitting at the cap while leaving the selection alone', async () => {
    const attempts = path.join(devflowDir, '.tracker.attempts');
    await fs.writeFile(attempts, '5\n', 'utf-8');
    // PF-018: the counter must exist before the run, or its absence afterwards
    // is the state the temp dir started in and proves nothing.
    await expect(fs.readFile(attempts, 'utf-8')).resolves.toBe('5\n');

    const result = spawnSync('node', [cli, 'tracker', '--status'], {
      encoding: 'utf-8',
      timeout: 60000,
      env: {
        ...process.env,
        HOME: tmpHome,
        DEVFLOW_DIR: devflowDir,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        CI: '1',
      },
    });

    expect(result.status, `tracker --status failed:\n${result.stderr}`).toBe(0);
    expect(result.stdout + result.stderr).toContain('jira');

    // The counter is gone: the next session start gets another five tries.
    await expect(fs.access(attempts)).rejects.toThrow();

    // Re-arming is the ONLY write --status makes; the selection is untouched.
    const manifest = JSON.parse(
      await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8'),
    ) as { features: { tracker: { provider: string } } };
    expect(manifest.features.tracker.provider).toBe('jira');
  });
});

// ── Call-site assertions for this command ─────────────────────────────────────
//
// [DR-22] The attempt counter has exactly ONE owner (rearmTrackerInference);
// each of this command's two branches calls it exactly once (D-F). [DR-10] the
// sentinel has one owner and one call site. P3a-S15's rename transition is
// reachable from here too. These are source-level assertions because the
// Commander `.action()` body is not unit-reachable; they go red if someone
// inlines an `fs.rm`/`fs.writeFile` here or duplicates a call.

describe('devflow tracker call sites', () => {
  it('re-arms once from each branch and never inlines the removal [DR-22, D-F]', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');

    // Split the action body at the Set separator so each branch is counted on
    // its own: a total of two says nothing about WHERE the two calls are.
    const statusStart = source.indexOf('if (options.status) {');
    const setStart = source.indexOf('// ── Set ─');
    expect(statusStart, 'the --status branch guard must be findable').toBeGreaterThan(0);
    expect(setStart, 'the Set separator must follow the --status branch').toBeGreaterThan(statusStart);

    const statusBranch = source.slice(statusStart, setStart);
    const setBranch = source.slice(setStart);
    expect((statusBranch.match(/rearmTrackerInference\(/g) ?? []).length).toBe(1);
    expect((setBranch.match(/rearmTrackerInference\(/g) ?? []).length).toBe(1);
    expect((source.match(/rearmTrackerInference\(/g) ?? []).length).toBe(2);
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

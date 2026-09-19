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
    const result = resolveTrackerCliAction({ provider: 'github' }, 'jira');
    expect(result.nextState).toEqual({ provider: 'jira' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].level).toBe('success');
    expect(result.messages[0].text).toContain('jira');
  });

  it('set to the provider already in the manifest is reported as a no-change', () => {
    const result = resolveTrackerCliAction({ provider: 'jira' }, 'jira');
    expect(result.nextState).toEqual({ provider: 'jira' });
    expect(result.messages.some(m => m.text.toLowerCase().includes('already'))).toBe(true);
  });

  it('set back to github is honoured — github is the off switch (decision D-E)', () => {
    // There is no --no-tracker: `--set github` IS the way off.
    const result = resolveTrackerCliAction({ provider: 'linear' }, 'github');
    expect(result.nextState).toEqual({ provider: 'github' });
    expect(result.messages[0].text).toContain('github');
  });

  it('with no provider leaves the current state untouched and never aliases it', () => {
    // Defensive: the caller parses --set at the boundary, so this arm should be
    // unreachable — it must still never invent a provider, and the state it
    // hands back is a fresh object the caller can persist without sharing.
    const current = { provider: 'linear' as const };
    const result = resolveTrackerCliAction(current);
    expect(result.nextState).toEqual({ provider: 'linear' });
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

  it('bounds the READ, not just the line scan, on an oversized tracker.md', async () => {
    const trackerMd = path.join(devflowDir, 'tracker.md');
    // A key pushed past the byte bound by one very long line is still inside the
    // 40-line scan, so only a bounded READ can keep it out.
    await fs.writeFile(trackerMd, `---\n${'x'.repeat(9000)}\nprovider: jira\n---\n`, 'utf-8');

    const beyond = await readTrackerProvenance(devflowDir);

    expect(beyond.kind).toBe('present');
    if (beyond.kind !== 'present') return;
    expect(beyond.provider).toBeUndefined();

    // Non-vacuity: the identical shape inside the bound IS read, so the absence
    // above is the bound and not a parser that stopped reading frontmatter.
    await fs.writeFile(trackerMd, `---\n${'x'.repeat(10)}\nprovider: jira\n---\n`, 'utf-8');
    const within = await readTrackerProvenance(devflowDir);
    expect(within.kind).toBe('present');
    if (within.kind !== 'present') return;
    expect(within.provider).toBe('jira');
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

    // The write is disclosed in the report the user asked for: a --status that
    // re-arms silently is a machine-state change with no receipt.
    expect(result.stdout + result.stderr).toMatch(/Inference:\s+re-armed \(5 attempts available\)/);

    // The counter is gone: the next session start gets another five tries.
    await expect(fs.access(attempts)).rejects.toThrow();

    // Re-arming is the ONLY write --status makes; the selection is untouched.
    const manifest = JSON.parse(
      await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8'),
    ) as { features: { tracker: { provider: string } } };
    expect(manifest.features.tracker.provider).toBe('jira');
  });
});

// ── `devflow tracker --set`, end to end ───────────────────────────────────────
//
// The Set branch drives four owners in one order — rename → persist → re-arm →
// sentinel — and the ordering is the whole contract. Driven as a subprocess for
// the same reason as the --status arm above: the Commander `.action()` body is
// not unit-reachable, and the resolver unit tests at the top of this file end at
// `nextState`, so every file the branch touches is otherwise unexercised.
//
// Each arm asserts the WHOLE end-state of the devflow dir (PF-015): a per-step
// boolean cannot see a half-converged directory, which is exactly the shape a
// dropped owner leaves behind.

describe('devflow tracker --set converges every tracker artifact', () => {
  let cli: string;
  let tmpHome: string;
  let devflowDir: string;

  /** Seed a manifest whose tracker selection is `provider`. */
  async function seedManifest(provider: string): Promise<void> {
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
          tracker: { provider },
        },
      }, null, 2),
      'utf-8',
    );
  }

  function runSet(provider: string) {
    return spawnSync('node', [cli, 'tracker', '--set', provider], {
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
  }

  /** The persisted selection, read back from disk. */
  async function persistedProvider(): Promise<string> {
    const manifest = JSON.parse(
      await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8'),
    ) as { features: { tracker: { provider: string } } };
    return manifest.features.tracker.provider;
  }

  beforeEach(async () => {
    cli = requireBuiltCli();
    // PF-060: a seeded mkdtemp HOME; never the developer's real one.
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-set-'));
    devflowDir = path.join(tmpHome, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
    // --set converges the reference subtree into devflow:git, and refuses when
    // that skill is absent rather than creating an invisible husk under a skill
    // nothing installed. Seed it so these arms exercise the converging path.
    const gitSkill = path.join(tmpHome, '.claude', 'skills', 'devflow:git');
    await fs.mkdir(gitSkill, { recursive: true });
    await fs.writeFile(path.join(gitSkill, 'SKILL.md'), '# git\n', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('jira → github: conventions moved aside, counter re-armed, sentinel removed', async () => {
    await seedManifest('jira');
    const conventions = path.join(devflowDir, 'tracker.md');
    const backup = path.join(devflowDir, 'tracker.md.jira.bak');
    const attempts = path.join(devflowDir, '.tracker.attempts');
    const sentinel = path.join(devflowDir, '.tracker.enabled');
    const seededConventions = '---\nprovider: jira\ninferred-from: seed\n---\n\n## Project\nsite: example\n';
    await fs.writeFile(conventions, seededConventions, 'utf-8');
    await fs.writeFile(attempts, '5\n', 'utf-8');
    await fs.writeFile(sentinel, '', 'utf-8');

    // PF-018: every artifact this run must change has to EXIST first, or its
    // absence afterwards is the state the temp dir started in.
    await expect(fs.readFile(conventions, 'utf-8')).resolves.toBe(seededConventions);
    await expect(fs.readFile(attempts, 'utf-8')).resolves.toBe('5\n');
    await expect(fs.access(sentinel)).resolves.toBeUndefined();
    await expect(fs.access(backup)).rejects.toThrow();

    const result = runSet('github');
    expect(result.status, `tracker --set github failed:\n${result.stderr}`).toBe(0);

    expect(await persistedProvider()).toBe('github');
    // The stale conventions survive under the previous provider's name — the
    // rename never destroys the user's inferred site and key (OD-15).
    await expect(fs.readFile(backup, 'utf-8')).resolves.toBe(seededConventions);
    await expect(fs.access(conventions)).rejects.toThrow();
    // [DR-22] the cap is handed back; [DR-10] github removes the sentinel, so
    // the next SessionStart forks nothing.
    await expect(fs.access(attempts)).rejects.toThrow();
    await expect(fs.access(sentinel)).rejects.toThrow();
    // The move is disclosed: a file that changed name with no receipt is a
    // change the user cannot audit.
    expect(result.stdout + result.stderr).toContain('tracker.md.jira.bak');
  });

  it('github → linear: the sentinel is written, which is the other direction [DR-10]', async () => {
    await seedManifest('github');
    const sentinel = path.join(devflowDir, '.tracker.enabled');
    const attempts = path.join(devflowDir, '.tracker.attempts');
    await fs.writeFile(attempts, '5\n', 'utf-8');
    await expect(fs.access(sentinel)).rejects.toThrow();

    const result = runSet('linear');
    expect(result.status, `tracker --set linear failed:\n${result.stderr}`).toBe(0);

    expect(await persistedProvider()).toBe('linear');
    // Zero-byte presence sentinel — the hook's only gate reads its existence.
    await expect(fs.stat(sentinel)).resolves.toMatchObject({ size: 0 });
    await expect(fs.access(attempts)).rejects.toThrow();
    // No conventions file was seeded, so the rename had nothing to move and
    // must not have invented a backup.
    await expect(fs.access(path.join(devflowDir, 'tracker.md.github.bak'))).rejects.toThrow();
  });

  it('a rejected ID exits non-zero and leaves every artifact untouched', async () => {
    await seedManifest('linear');
    const sentinel = path.join(devflowDir, '.tracker.enabled');
    await fs.writeFile(sentinel, '', 'utf-8');

    const result = runSet('jira-cloud');
    expect(result.status, 'a near-miss ID must not exit 0').toBe(1);
    expect(result.stdout + result.stderr).toContain('jira-cloud');

    // Parse-at-the-boundary: the rejection happens before any I/O, so the
    // selection and the sentinel it converged are exactly as they were.
    expect(await persistedProvider()).toBe('linear');
    await expect(fs.access(sentinel)).resolves.toBeUndefined();
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
  it('re-arms once from the --status branch and once through the --set adapter [DR-22, D-F]', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');

    // The --set branch reaches every file-lifecycle owner through the injectable
    // TrackerSetIO adapter, which is what makes its step ORDER assertable. So
    // the two bindings live in two different places, and each is counted where
    // it is: a total of two says nothing about WHERE the two calls are.
    const adapterStart = source.indexOf('export function buildTrackerSetIO()');
    const statusStart = source.indexOf('if (options.status) {');
    expect(adapterStart, 'the --set adapter must be findable').toBeGreaterThan(0);
    expect(statusStart, 'the --status branch guard must be findable').toBeGreaterThan(0);

    const adapter = source.slice(adapterStart, source.indexOf('export interface TrackerSetOutcome'));
    const statusBranch = source.slice(statusStart, source.indexOf('// ── Set ─', statusStart));
    expect((adapter.match(/rearmTrackerInference[,(]/g) ?? []).length).toBe(1);
    expect((statusBranch.match(/rearmTrackerInference\(/g) ?? []).length).toBe(1);
    expect(source).not.toMatch(/\.tracker\.attempts/);
  });

  it('discloses the re-arm in the --status help text and in the note it prints [D-F]', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');

    // The declaration spans lines, so match the description Commander prints
    // rather than the line it happens to sit on.
    const statusOption = /\.option\(\s*'--status',\s*'([^']*)'/.exec(source);
    expect(statusOption, 'the --status option declaration must be findable').not.toBeNull();
    expect(statusOption?.[1] ?? '').toMatch(/re-arm/i);

    const statusStart = source.indexOf('if (options.status) {');
    const setStart = source.indexOf('// ── Set ─');
    expect(statusStart, 'the --status branch guard must be findable').toBeGreaterThan(0);
    expect(setStart, 'the Set separator must follow the --status branch').toBeGreaterThan(statusStart);
    expect(source.slice(statusStart, setStart)).toContain('Inference:');
  });

  it('converges the sentinel through applyTrackerSentinel, bound exactly once [DR-10]', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');
    // One BINDING in the adapter, and the orchestrator reaches it only through
    // io.applySentinel — so there is still exactly one owner, and the CLI still
    // never touches the sentinel file itself.
    const bindings = source.match(/applySentinel: applyTrackerSentinel/g) ?? [];
    expect(bindings.length).toBe(1);
    expect((source.match(/io\.applySentinel\(/g) ?? []).length).toBe(1);
    expect(source).not.toMatch(/\.tracker\.enabled/);
  });

  it('invokes the provider-change rename transition, bound exactly once', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');
    expect((source.match(/renameStaleConventions: renameStaleTrackerConventions/g) ?? []).length).toBe(1);
    expect((source.match(/io\.renameStaleConventions\(/g) ?? []).length).toBe(1);
  });

  it('reaches every file-lifecycle owner through the adapter, never inline', async () => {
    // The --set orchestrator takes its I/O as an injected seam so the step
    // ORDER is assertable (D-TRACKER-CONVERGE-SET). A call that went direct
    // would bypass the recorder and be invisible to the order test.
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');
    const body = source.slice(
      source.indexOf('export async function runTrackerSet('),
      source.indexOf('interface TrackerOptions'),
    );
    expect(body.length, 'the orchestrator body must be locatable').toBeGreaterThan(0);
    for (const direct of [
      'renameStaleTrackerConventions(',
      'rearmTrackerInference(',
      'applyTrackerSentinel(',
      'syncManifestFeature(',
      'convergeTrackerArtifacts(',
      'overlayInstalledReferences(',
    ]) {
      expect(body, `runTrackerSet must reach ${direct} through io, not directly`).not.toContain(direct);
    }
  });

  it('persists through the generic syncManifestFeature — no bespoke manifest write', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');
    expect(source).toMatch(/syncManifestFeature\(/);
    expect(source).not.toMatch(/writeManifest\(/);
  });
});

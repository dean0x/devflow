/**
 * Tests for src/cli/commands/tracker.ts
 *
 * Covers:
 *   - parseTrackerId "Commander parse pin" (error names every valid ID)
 *   - readTrackerProvenance / formatTrackerProvenance / formatTrackerStatus (the
 *     --status surface), over the per-provider conventions file
 *     (D-TRACKER-PER-PROVIDER-CONVENTIONS)
 *   - the D-F re-arm and the `Effective:` line, driven as a subprocess against a
 *     seeded temp HOME
 *   - `--set` writing only the manifest, the counters and the sentinel
 *     (D-TRACKER-CONVERGE-SET), driven as a subprocess
 *   - TP-39: a legacy tracker.md migrated by the real migration is what --status
 *     then reports, and a re-run moves nothing
 *   - the [DR-22] / [DR-10] call-site assertions for this command
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
  readTrackerProvenance,
  formatTrackerProvenance,
  formatTrackerStatus,
} from '../src/cli/commands/tracker.js';
import {
  TRACKER_PROVIDER_IDS,
  parseTrackerId,
  trackerAttemptsPath,
  trackerConventionsPath,
} from '../src/core/tracker.js';
import { runMigrations } from '../src/core/migrations.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKER_CLI_SOURCE = path.join(REPO_ROOT, 'src', 'cli', 'commands', 'tracker.ts');

/** One CLI spawn: node start-up plus the command, under a loaded suite. */
const CLI_SPAWN_TIMEOUT_MS = 60_000;

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

describe('conventions provenance (--status)', () => {
  let devflowDir: string;

  beforeEach(async () => {
    // An mkdtemp root; never the developer's real ~/.devflow.
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-cli-'));
    await fs.mkdir(path.join(devflowDir, 'tracker'));
  });

  afterEach(async () => {
    await fs.rm(devflowDir, { recursive: true, force: true });
  });

  const jiraFile = (): string => trackerConventionsPath(devflowDir, 'jira');

  it('reports absent when the provider has no conventions file', async () => {
    const provenance = await readTrackerProvenance(devflowDir, 'jira');
    expect(provenance.kind).toBe('absent');
    expect(formatTrackerProvenance(provenance)).toContain('not present');
  });

  it('reads the named provider\'s file, and only that one', async () => {
    await fs.writeFile(
      jiraFile(),
      '---\nprovider: jira\ninferred-from: /Users/dev/proj at 2026-09-16T00:00:00Z\n---\n\n## Issue Types\n',
      'utf-8',
    );

    const provenance = await readTrackerProvenance(devflowDir, 'jira');

    expect(provenance.kind).toBe('present');
    if (provenance.kind !== 'present') return;
    expect(provenance.provider).toBe('jira');
    expect(provenance.inferredFrom).toContain('/Users/dev/proj');
    const rendered = formatTrackerProvenance(provenance);
    expect(rendered).toContain('jira');
    expect(rendered).toContain('/Users/dev/proj');

    // Another provider's conventions are another file.
    expect((await readTrackerProvenance(devflowDir, 'linear')).kind).toBe('absent');
  });

  it('reports a present file whose frontmatter is unreadable without inventing values', async () => {
    await fs.writeFile(jiraFile(), 'no frontmatter here\n', 'utf-8');

    const provenance = await readTrackerProvenance(devflowDir, 'jira');

    expect(provenance.kind).toBe('present');
    if (provenance.kind !== 'present') return;
    expect(provenance.provider).toBeUndefined();
    expect(provenance.inferredFrom).toBeUndefined();
    expect(formatTrackerProvenance(provenance)).toContain('present');
  });

  it('sanitises hostile frontmatter values before they reach the terminal', async () => {
    // The file is hand-editable and machine-wide, so its content is third-party
    // input at every sink — including a status line.
    await fs.writeFile(
      jiraFile(),
      `---\nprovider: \x1b[31mjira\x07\ninferred-from: ${'x'.repeat(400)}\n---\n`,
      'utf-8',
    );

    const provenance = await readTrackerProvenance(devflowDir, 'jira');
    expect(provenance.kind).toBe('present');
    const rendered = formatTrackerProvenance(provenance);
    expect(rendered).not.toContain('\x1b');
    expect(rendered).not.toContain('\x07');
    expect(rendered.length).toBeLessThan(200);
  });

  it('bounds the READ, not just the line scan, on an oversized conventions file', async () => {
    // A key pushed past the byte bound by one very long line is still inside the
    // 40-line scan, so only a bounded READ can keep it out.
    await fs.writeFile(jiraFile(), `---\n${'x'.repeat(9000)}\nprovider: jira\n---\n`, 'utf-8');

    const beyond = await readTrackerProvenance(devflowDir, 'jira');

    expect(beyond.kind).toBe('present');
    if (beyond.kind !== 'present') return;
    expect(beyond.provider).toBeUndefined();

    // Non-vacuity: the identical shape inside the bound IS read, so the absence
    // above is the bound and not a parser that stopped reading frontmatter.
    await fs.writeFile(jiraFile(), `---\n${'x'.repeat(10)}\nprovider: jira\n---\n`, 'utf-8');
    const within = await readTrackerProvenance(devflowDir, 'jira');
    expect(within.kind).toBe('present');
    if (within.kind !== 'present') return;
    expect(within.provider).toBe('jira');
  });

  it('never throws when the path is a directory rather than a file', async () => {
    await fs.mkdir(jiraFile());
    const provenance = await readTrackerProvenance(devflowDir, 'jira');
    // A directory is not a readable conventions file — reported, never thrown.
    expect(provenance.kind).toBe('absent');
  });
});

// ── The --status note (pure) ──────────────────────────────────────────────────

describe('formatTrackerStatus', () => {
  const base = {
    machine: 'github' as const,
    conventions: { kind: 'none' } as const,
    mechanics: { kind: 'installed', count: 47 } as const,
    inference: 're-armed (5 attempts available)',
  };

  it('prints no Effective line when no repository layer selects the tracker', () => {
    const note = formatTrackerStatus({ ...base, selection: null });
    expect(note).not.toContain('Effective:');
    expect(note.split('\n').map(l => l.slice(0, 13))).toEqual([
      'Provider:    ', 'Conventions: ', 'File:        ', 'Mechanics:   ', 'Inference:   ',
    ]);
  });

  it('prints `Effective: jira (project)` second when project.json selects it', () => {
    const note = formatTrackerStatus({
      ...base,
      selection: { provider: 'jira', source: 'project' },
      conventions: { kind: 'learned', file: '/h/.devflow/tracker/jira.md', provenance: { kind: 'absent' } },
    });
    const lines = note.split('\n');
    expect(lines[1]).toMatch(/^Effective:\s+\S*jira\S* \(project\)$/);
    expect(lines).toHaveLength(6);
    expect(lines[3]).toBe('File:        /h/.devflow/tracker/jira.md');
  });

  it('names no conventions file for github, which learns none (main printed the same five labels)', () => {
    const lines = formatTrackerStatus({ ...base, selection: null }).split('\n');
    expect(lines[1]).toBe('Conventions: none (GitHub needs no learned conventions)');
    expect(lines[2]).toBe('File:        none');
  });

  it('a learned provider names its file and what the file reports', () => {
    const lines = formatTrackerStatus({
      ...base,
      machine: 'linear',
      selection: null,
      conventions: {
        kind: 'learned',
        file: '/h/.devflow/tracker/linear.md',
        provenance: { kind: 'present', provider: 'linear' },
      },
    }).split('\n');
    expect(lines[1]).toBe('Conventions: present — provider: linear');
    expect(lines[2]).toBe('File:        /h/.devflow/tracker/linear.md');
  });
});

// ── Subprocess helpers ─────────────────────────────────────────────────────────

function manifestBody(provider: string): string {
  return JSON.stringify({
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
  }, null, 2);
}

function runCli(cli: string, tmpHome: string, args: string[], cwd: string = os.tmpdir()) {
  return spawnSync('node', [cli, 'tracker', ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: CLI_SPAWN_TIMEOUT_MS,
    env: {
      ...process.env,
      HOME: tmpHome,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      CI: '1',
    },
  });
}

// ── --status, driven for real ──────────────────────────────────────────────────

describe('devflow tracker --status', () => {
  let cli: string;
  let tmpHome: string;
  let devflowDir: string;

  beforeEach(async () => {
    cli = requireBuiltCli();
    // A seeded mkdtemp HOME; never the developer's real one.
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-status-'));
    devflowDir = path.join(tmpHome, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('re-arms every provider\'s counter while leaving the selection alone (D-F)', async () => {
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), manifestBody('jira'), 'utf-8');
    for (const provider of TRACKER_PROVIDER_IDS) {
      await fs.writeFile(trackerAttemptsPath(devflowDir, provider), '5\n', 'utf-8');
    }
    // The counter must exist before the run, or its absence afterwards
    // is the state the temp dir started in and proves nothing.
    await expect(fs.readFile(trackerAttemptsPath(devflowDir, 'jira'), 'utf-8')).resolves.toBe('5\n');

    const result = runCli(cli, tmpHome, ['--status']);

    expect(result.status, `tracker --status failed:\n${result.stderr}`).toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain('jira');
    // The write is disclosed in the report the user asked for: a --status that
    // re-arms silently is a machine-state change with no receipt.
    expect(out).toMatch(/Inference:\s+re-armed \(5 attempts available\)/);
    // Outside a repository no layer selects anything: no Effective line, and the
    // conventions reported are the machine provider's.
    expect(out).not.toContain('Effective:');
    expect(out).toContain(trackerConventionsPath(devflowDir, 'jira'));

    for (const provider of TRACKER_PROVIDER_IDS) {
      await expect(fs.access(trackerAttemptsPath(devflowDir, provider))).rejects.toThrow();
    }
    const manifest = JSON.parse(
      await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8'),
    ) as { features: { tracker: { provider: string } } };
    expect(manifest.features.tracker.provider).toBe('jira');
  }, CLI_SPAWN_TIMEOUT_MS);

  it('on github with no repository layer, names no conventions file — none exists to learn', async () => {
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), manifestBody('github'), 'utf-8');

    const result = runCli(cli, tmpHome, ['--status']);

    expect(result.status, `tracker --status failed:\n${result.stderr}`).toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toMatch(/Provider:\s+github \(default\)/);
    expect(out).not.toContain('Effective:');
    expect(out).toMatch(/Conventions:\s+none \(GitHub needs no learned conventions\)/);
    expect(out).toMatch(/File:\s+none/);
    expect(out, 'a github conventions file is never written, so it is never named').not.toContain(
      trackerConventionsPath(devflowDir, 'github'),
    );
    expect(out).toMatch(/Inference:\s+re-armed \(5 attempts available\)/);
  }, CLI_SPAWN_TIMEOUT_MS);

  it('names the repository\'s own provider on an Effective line, and its conventions (TP-37)', async () => {
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), manifestBody('github'), 'utf-8');
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-status-repo-'));
    try {
      expect(spawnSync('git', ['init', '-q', repo]).status).toBe(0);
      await fs.mkdir(path.join(repo, '.devflow'));
      await fs.writeFile(
        path.join(repo, '.devflow', 'project.json'),
        '{"version":1,"tracker":{"provider":"linear"}}\n',
        'utf-8',
      );

      const result = runCli(cli, tmpHome, ['--status'], repo);

      expect(result.status, `tracker --status failed:\n${result.stderr}`).toBe(0);
      const out = result.stdout + result.stderr;
      expect(out).toMatch(/Provider:\s+github \(default\)/);
      expect(out).toMatch(/Effective:\s+linear \(project\)/);
      expect(out, 'the conventions a session here learns are linear\'s').toContain(
        trackerConventionsPath(devflowDir, 'linear'),
      );
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  }, CLI_SPAWN_TIMEOUT_MS);

  it('TP-39: reports the conventions the migration moved, and a re-run moves nothing', async () => {
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), manifestBody('jira'), 'utf-8');
    const body = '---\nprovider: jira\ninferred-from: /legacy @ 2026-01-01T00:00:00Z\n---\n\n## Project\nkey: ACME\n';
    await fs.writeFile(path.join(devflowDir, 'tracker.md'), body, 'utf-8');

    const first = await runMigrations({ devflowDir }, []);
    expect(first.failures).toEqual([]);
    expect(first.newlyApplied).toContain('tracker-conventions-per-provider-v1');
    await expect(fs.readFile(trackerConventionsPath(devflowDir, 'jira'), 'utf-8')).resolves.toBe(body);

    const result = runCli(cli, tmpHome, ['--status']);
    expect(result.status, `tracker --status failed:\n${result.stderr}`).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Conventions:\s+present — provider: jira — inferred from: \/legacy/);

    // A re-run is a no-op: the id is applied, and nothing is moved again.
    const second = await runMigrations({ devflowDir }, []);
    expect(second.newlyApplied).toEqual([]);
    await expect(fs.readFile(trackerConventionsPath(devflowDir, 'jira'), 'utf-8')).resolves.toBe(body);
  }, CLI_SPAWN_TIMEOUT_MS);
});

// ── --set, driven for real ─────────────────────────────────────────────────────

describe('devflow tracker --set writes the manifest, the counters and the sentinel', () => {
  let cli: string;
  let tmpHome: string;
  let devflowDir: string;

  /** The persisted selection, read back from disk. */
  async function persistedProvider(): Promise<string> {
    const manifest = JSON.parse(
      await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8'),
    ) as { features: { tracker: { provider: string } } };
    return manifest.features.tracker.provider;
  }

  beforeEach(async () => {
    cli = requireBuiltCli();
    // A seeded mkdtemp HOME; never the developer's real one.
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-set-'));
    devflowDir = path.join(tmpHome, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('jira → github: counters re-armed, sentinel removed, conventions left where they are', async () => {
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), manifestBody('jira'), 'utf-8');
    const conventions = trackerConventionsPath(devflowDir, 'jira');
    const sentinel = path.join(devflowDir, '.tracker.enabled');
    const seededConventions = '---\nprovider: jira\ninferred-from: seed\n---\n\n## Project\nsite: example\n';
    await fs.mkdir(path.dirname(conventions), { recursive: true });
    await fs.writeFile(conventions, seededConventions, 'utf-8');
    await fs.writeFile(trackerAttemptsPath(devflowDir, 'jira'), '5\n', 'utf-8');
    await fs.writeFile(sentinel, 'jira\n', 'utf-8');

    // Every artifact this run must change has to EXIST first, or its absence
    // afterwards proves nothing.
    await expect(fs.access(sentinel)).resolves.toBeUndefined();

    const result = runCli(cli, tmpHome, ['--set', 'github']);
    expect(result.status, `tracker --set github failed:\n${result.stderr}`).toBe(0);

    expect(await persistedProvider()).toBe('github');
    // D-TRACKER-PER-PROVIDER-CONVENTIONS: a provider change moves nothing aside —
    // jira's conventions stay correct for every repository that uses jira.
    await expect(fs.readFile(conventions, 'utf-8')).resolves.toBe(seededConventions);
    await expect(fs.access(path.join(devflowDir, 'tracker.md.jira.bak'))).rejects.toThrow();
    // [DR-22] the cap is handed back; [DR-10] github removes the sentinel, so
    // the next SessionStart forks nothing.
    await expect(fs.access(trackerAttemptsPath(devflowDir, 'jira'))).rejects.toThrow();
    await expect(fs.access(sentinel)).rejects.toThrow();
  }, CLI_SPAWN_TIMEOUT_MS);

  it('github → linear: the sentinel names the provider, which is the other direction [DR-10]', async () => {
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), manifestBody('github'), 'utf-8');
    const sentinel = path.join(devflowDir, '.tracker.enabled');
    await expect(fs.access(sentinel)).rejects.toThrow();

    const result = runCli(cli, tmpHome, ['--set', 'linear']);
    expect(result.status, `tracker --set linear failed:\n${result.stderr}`).toBe(0);

    expect(await persistedProvider()).toBe('linear');
    // The hook reads the name with a builtin: one line, nothing else.
    await expect(fs.readFile(sentinel, 'utf-8')).resolves.toBe('linear\n');
    // --set installs nothing: every provider's mechanics and the agent come from init.
    await expect(fs.access(path.join(tmpHome, '.claude')), '--set wrote under ~/.claude').rejects.toThrow();
  }, CLI_SPAWN_TIMEOUT_MS);

  it('a rejected ID exits non-zero and leaves every artifact untouched', async () => {
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), manifestBody('linear'), 'utf-8');
    const sentinel = path.join(devflowDir, '.tracker.enabled');
    await fs.writeFile(sentinel, 'linear\n', 'utf-8');

    const result = runCli(cli, tmpHome, ['--set', 'jira-cloud']);
    expect(result.status, 'a near-miss ID must not exit 0').toBe(1);
    expect(result.stdout + result.stderr).toContain('jira-cloud');

    // Parse-at-the-boundary: the rejection happens before any I/O, so the
    // selection and the sentinel it converged are exactly as they were.
    expect(await persistedProvider()).toBe('linear');
    await expect(fs.readFile(sentinel, 'utf-8')).resolves.toBe('linear\n');
  }, CLI_SPAWN_TIMEOUT_MS);
});

// ── Call sites ─────────────────────────────────────────────────────────────────

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
    expect(source).not.toMatch(/\.tracker\.[a-z]*\.?attempts/);
  });

  it('discloses the re-arm in the --status help text and in the note it prints [D-F]', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');

    // The declaration spans lines, so match the description Commander prints
    // rather than the line it happens to sit on.
    const statusOption = /\.option\(\s*'--status',\s*'([^']*)'/.exec(source);
    expect(statusOption, 'the --status option declaration must be findable').not.toBeNull();
    expect(statusOption?.[1] ?? '').toMatch(/re-arm/i);

    const formatStart = source.indexOf('export function formatTrackerStatus(');
    expect(formatStart, 'the --status note renderer must be findable').toBeGreaterThan(0);
    expect(source.slice(formatStart)).toContain('Inference:');
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

  it('reaches every file-lifecycle owner through the adapter, and no retired one at all', async () => {
    // The --set orchestrator takes its I/O as an injected seam so the step
    // ORDER is assertable (D-TRACKER-CONVERGE-SET). A call that went direct
    // would bypass the recorder and be invisible to the order test.
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');
    const body = source.slice(
      source.indexOf('export async function runTrackerSet('),
      source.indexOf('interface TrackerOptions'),
    );
    expect(body.length, 'the orchestrator body must be locatable').toBeGreaterThan(0);
    for (const direct of ['rearmTrackerInference(', 'applyTrackerSentinel(', 'syncManifestFeature(']) {
      expect(body, `runTrackerSet must reach ${direct} through io, not directly`).not.toContain(direct);
    }
    // --set no longer converges the reference tree, the agent or the conventions.
    for (const retired of ['overlayInstalledReferences', 'convergeTrackerArtifacts', 'renameStaleTrackerConventions']) {
      expect(source, `tracker.ts must not reach ${retired}`).not.toContain(retired);
    }
  });

  it('persists through the generic syncManifestFeature — no bespoke manifest write', async () => {
    const source = await fs.readFile(TRACKER_CLI_SOURCE, 'utf-8');
    expect(source).toMatch(/syncManifestFeature\(/);
    expect(source).not.toMatch(/writeManifest\(/);
  });
});

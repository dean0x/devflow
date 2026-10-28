/**
 * The init posting notice (#648, AC-30, TP-44).
 *
 * `devflow init` says once that a compliance-off install holds no step that posts. The notice is due
 * when the installed variant moves from posting (compliance on, or no record before this release) to
 * non-posting. A second init, a compliance-on machine and a machine whose record already says
 * non-posting get none.
 *
 * Two layers:
 *   - the pure decision, `postingNoticeDue`, over every record and switch state;
 *   - the real compiled CLI under a temp HOME from `sandboxEnv`, which refuses a real home before a
 *     run starts. Requires a build (`requireBuiltCli`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli, sandboxEnv } from './helpers.js';
import { POSTING_OFF_NOTICE, postingNoticeDue, readInstalledVariants } from '../src/core/installed-variants.js';

describe('postingNoticeDue', () => {
  it.each([
    ['no record, compliance off (first install or a machine from before this release)', null, false, true],
    ['a posting record, compliance now off', { curation: true, compliance: true }, false, true],
    ['a posting record, compliance now off, curation off', { curation: false, compliance: true }, false, true],
    ['a non-posting record, compliance still off', { curation: true, compliance: false }, false, false],
    ['no record, compliance on', null, true, false],
    ['a posting record, compliance still on', { curation: true, compliance: true }, true, false],
    ['a non-posting record, compliance now on', { curation: true, compliance: false }, true, false],
  ] as const)('%s', (_name, record, complianceEnabled, due) => {
    expect(postingNoticeDue(readInstalledVariants(record), complianceEnabled)).toBe(due);
  });

  it('treats a malformed record as unknown, which is due when compliance is off', () => {
    expect(postingNoticeDue(readInstalledVariants({ curation: 'yes', compliance: false }), false)).toBe(true);
    expect(postingNoticeDue(readInstalledVariants('compliance-off'), false)).toBe(true);
  });
});

describe('POSTING_OFF_NOTICE', () => {
  it('names each kind of post that is not installed and where the results stay', () => {
    for (const phrase of [
      'no step that posts',
      'test-plan evidence',
      'review or resolution summaries',
      'backlog entries',
      'review-thread replies',
      'wave reports',
      'plan artifacts',
      'release back-links',
      'GitHub or a tracker',
      '.devflow/docs/',
    ]) {
      expect(POSTING_OFF_NOTICE, phrase).toContain(phrase);
    }
  });

  it('names no ledger identifier and no advisory', () => {
    expect(POSTING_OFF_NOTICE).not.toMatch(/\b(?:ADR|PF)-\d+\b|GHSA/);
  });
});

// ── The real CLI ──────────────────────────────────────────────────────────────

const CLI = requireBuiltCli();

/** The per-test budget of vitest for a test that spawns the CLI; it sets nothing on the spawn itself. */
const E2E_BUDGET_MS = 60_000;
const E2E_CHAIN_BUDGET_MS = 3 * E2E_BUDGET_MS;

/** The minimal non-interactive init: no feature that would add unrelated writes. */
const INIT_FLAGS = [
  'init', '--recommended', '--no-ambient', '--no-memory', '--no-curation', '--no-knowledge',
  '--no-rules', '--no-hud', '--no-proxy', '--security', 'user',
];

let home: string;

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'df-init-posting-notice-')));
  // init stops with "Claude Code not detected" without a Claude directory.
  await fs.mkdir(path.join(home, '.claude'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

function runInit(...complianceFlags: string[]): string {
  const result = spawnSync(process.execPath, [CLI, ...INIT_FLAGS, ...complianceFlags], {
    cwd: home,
    env: sandboxEnv(home),
    encoding: 'utf-8',
  });
  if (result.error) throw result.error;
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  expect(result.status, out).toBe(0);
  return out;
}

/** How many times the notice appears in the output. The prompt library wraps lines and draws a gutter, so compare flattened text. */
function noticeCount(out: string): number {
  const flat = out.replace(/[│┃|]/g, ' ').replace(/\s+/g, ' ');
  return flat.split('installed no step that posts').length - 1;
}

async function recordOnDisk(): Promise<unknown> {
  const manifest = JSON.parse(await fs.readFile(path.join(home, '.devflow', 'manifest.json'), 'utf-8')) as { installedVariants?: unknown };
  return manifest.installedVariants;
}

describe('devflow init prints the posting notice once', () => {
  it('prints it on the first compliance-off install, records the variant, and prints nothing on the next init', async () => {
    const first = runInit('--no-compliance');
    expect(noticeCount(first), first).toBe(1);
    expect(await recordOnDisk()).toEqual({ curation: false, compliance: false });

    const second = runInit('--no-compliance');
    expect(noticeCount(second), second).toBe(0);
  }, E2E_CHAIN_BUDGET_MS);

  it('prints nothing with compliance on', async () => {
    const out = runInit('--compliance', 'gdpr');
    expect(noticeCount(out), out).toBe(0);
    expect(await recordOnDisk()).toEqual({ curation: false, compliance: true });
  }, E2E_BUDGET_MS);

  it('prints it again when compliance moves from on to off', async () => {
    runInit('--compliance', 'gdpr');
    const off = runInit('--no-compliance');
    expect(noticeCount(off), off).toBe(1);
    expect(await recordOnDisk()).toEqual({ curation: false, compliance: false });
  }, E2E_CHAIN_BUDGET_MS);

  it('prints it when the manifest has no record, as on a machine from before this release', async () => {
    runInit('--no-compliance');
    const manifestPath = path.join(home, '.devflow', 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as Record<string, unknown>;
    delete manifest.installedVariants;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const out = runInit('--no-compliance');
    expect(noticeCount(out), out).toBe(1);
    expect(await recordOnDisk()).toEqual({ curation: false, compliance: false });
  }, E2E_CHAIN_BUDGET_MS);
});

/**
 * `devflow init` hands the machine's compliance switch to the installer, so the switch
 * decides what the install needs from the package.
 *
 * With compliance off the installer reads dist/variant-axes.json and refuses, before it
 * writes a command or an agent, when the file is missing. With compliance on it reads
 * nothing. The unit tests of the installer pass the switch themselves, so only the real
 * CLI shows that init passes the settled switch and not a constant: a package without the
 * manifest installs on a compliance-on machine and is refused on a compliance-off one.
 *
 * Every spawn runs the CLI of a staged copy of the package (tests/helpers/staged-package.ts)
 * that carries no manifest, under a temp HOME from `sandboxEnv`, which refuses a real home
 * before anything runs. Requires a build (`requireBuiltCli`).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli, sandboxEnv } from './helpers.js';
import { stagePackage, type StagedPackage } from './helpers/staged-package.js';
import { VARIANT_MANIFEST_REL_PATH } from '../src/core/curation-variants.js';

// The repository build must be current before it is copied.
requireBuiltCli();

/** One CLI spawn under full-suite load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 60_000;

/**
 * The minimal non-interactive init, without a compliance flag: no feature that would add
 * unrelated writes. `--security user` keeps the deny list in the sandboxed
 * ~/.claude/settings.json (D-TESTS-NO-SYSTEM-MANAGED).
 */
const INIT_WITHOUT_COMPLIANCE_FLAG = [
  'init', '--recommended', '--no-ambient', '--no-memory', '--no-curation', '--no-knowledge',
  '--no-rules', '--no-hud', '--no-proxy', '--security', 'user',
];

let staged: StagedPackage;
let home: string;

beforeAll(async () => {
  staged = await stagePackage({ withVariantManifest: false });
}, SUBPROCESS_TIMEOUT_MS);

afterAll(async () => {
  await staged.remove();
});

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'df-init-compliance-wiring-')));
  // init stops with "Claude Code not detected" without a Claude directory.
  await fs.mkdir(path.join(home, '.claude'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

function runStagedInit(...complianceFlags: string[]): { status: number | null; out: string } {
  const result = spawnSync(process.execPath, [path.join(staged.root, 'dist', 'cli.js'), ...INIT_WITHOUT_COMPLIANCE_FLAG, ...complianceFlags], {
    cwd: home,
    env: sandboxEnv(home),
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
  });
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('init passes the settled compliance switch to the installer', () => {
  it('refuses a compliance-off machine whose package has no variant manifest, before it writes a command or an agent', () => {
    expect(existsSync(path.join(staged.root, 'dist', 'variant-axes.json')), 'non-vacuity: the staged package has no manifest').toBe(false);

    const run = runStagedInit('--no-compliance');

    expect(run.status, run.out).toBe(1);
    expect(run.out, 'the refusal names the missing manifest').toContain(VARIANT_MANIFEST_REL_PATH);
    expect(existsSync(path.join(home, '.claude', 'commands', 'devflow')), 'no command was written').toBe(false);
    expect(existsSync(path.join(home, '.claude', 'agents', 'devflow')), 'no agent was written').toBe(false);
    expect(existsSync(path.join(home, '.devflow', 'manifest.json')), 'the install did not finish').toBe(false);
  }, SUBPROCESS_TIMEOUT_MS);

  it('installs on a compliance-on machine from the same package, which needs no variant manifest', async () => {
    const run = runStagedInit('--compliance', 'gdpr');

    expect(run.status, run.out).toBe(0);
    expect(run.out, 'no refusal for a missing manifest').not.toContain(VARIANT_MANIFEST_REL_PATH);
    const commands = await fs.readdir(path.join(home, '.claude', 'commands', 'devflow'));
    expect(commands.length, 'the install wrote commands').toBeGreaterThan(0);
    expect(existsSync(path.join(home, '.devflow', 'manifest.json')), 'the install finished').toBe(true);
  }, SUBPROCESS_TIMEOUT_MS);
});

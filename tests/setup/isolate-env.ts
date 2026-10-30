/**
 * Unit-suite setup file (vitest `setupFiles`): every test file runs under its own
 * temp HOME with the write-redirecting variables unset.
 *
 * D-TEST-HOME-ISOLATION: the unit suite drives production code that writes under
 * `~/.claude` and `~/.devflow` and spawns children that inherit `process.env`. A
 * developer shell exporting `DEVFLOW_DIR`, `CLAUDE_CODE_DIR` or `CLAUDE_CONFIG_DIR`
 * — or a test that forgets to sandbox HOME — would otherwise aim those writes at
 * the real install. So the redirect is applied once, here, before the
 * test file is imported, and it fails loudly rather than run against the real home.
 *
 * The same step makes every git call in a test read only the settings the test sets up and
 * act only on the repositories the test makes: it drops every `GIT_*` variable and
 * `XDG_CONFIG_HOME` of the developer's shell and sets `GIT_CONFIG_NOSYSTEM=1`. The global
 * config stays, as the `.gitconfig` of the temp HOME.
 *
 * Vitest runs setup files before EACH test file, so each file gets a fresh HOME,
 * removed after the file finishes. The integration config deliberately does not
 * use this file: the two live-`claude` files build their own temp HOME and temp
 * repository (`createSpawnContext`), and the other integration files that spawn
 * `init` sandbox it at the call site through `sandboxEnv`.
 *
 * The run temp root and the git folder come from `tests/setup/global-setup.ts`; each is
 * checked, then applied to TMPDIR and PATH before the HOME is made. With neither (no
 * TMPDIR in the main process, no real git found) the env stays as it was.
 *
 * Imports are limited to node built-ins, `vitest` and `./home-isolation.js` — see that
 * module's header for why nothing from `src/` may load before the redirect.
 */

import { mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, inject } from 'vitest';
import {
  GIT_BIN_KEY,
  ORIGINAL_HOME_VAR,
  RUN_TMP_KEY,
  TEMP_HOME_PREFIX,
  assertTempHome,
  checkGitBinDir,
  checkRunTmp,
  gitIsolatedEnv,
  isolatedEnv,
  pathWithGitBin,
} from './home-isolation.js';

if (process.env[ORIGINAL_HOME_VAR] === undefined && process.env.HOME) {
  process.env[ORIGINAL_HOME_VAR] = process.env.HOME;
}

const runTmp = checkRunTmp(inject(RUN_TMP_KEY));
const gitBin = checkGitBinDir(inject(GIT_BIN_KEY), runTmp);
if (runTmp !== undefined) process.env.TMPDIR = runTmp;
if (gitBin !== undefined) process.env.PATH = pathWithGitBin(process.env.PATH, gitBin);

const home = mkdtempSync(path.join(os.tmpdir(), TEMP_HOME_PREFIX));
assertTempHome(home);

const next = isolatedEnv(gitIsolatedEnv(process.env), home);
for (const key of Object.keys(process.env)) {
  if (!(key in next)) delete process.env[key];
}
Object.assign(process.env, next);

if (os.homedir() !== home) {
  throw new Error(`HOME isolation failed: os.homedir() is ${os.homedir()}, expected ${home}`);
}

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

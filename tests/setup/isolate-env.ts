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
 * Vitest runs setup files before EACH test file, so each file gets a fresh HOME,
 * removed after the file finishes. The integration config deliberately does not
 * use this file: its live-`claude` test needs the developer's own `~/.claude`, so
 * its one `init` spawn is sandboxed at the call site through `sandboxEnv` instead.
 *
 * Imports are limited to node built-ins and `./home-isolation.js` — see that
 * module's header for why nothing from `src/` may load before the redirect.
 */

import { mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll } from 'vitest';
import { ORIGINAL_HOME_VAR, TEMP_HOME_PREFIX, assertTempHome, isolatedEnv } from './home-isolation.js';

if (process.env[ORIGINAL_HOME_VAR] === undefined && process.env.HOME) {
  process.env[ORIGINAL_HOME_VAR] = process.env.HOME;
}

const home = mkdtempSync(path.join(os.tmpdir(), TEMP_HOME_PREFIX));
assertTempHome(home);

const next = isolatedEnv(process.env, home);
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

/**
 * tests/helpers/warm-fake-executable.ts
 *
 * Shared fake-executable helper for hook integration tests that put a stand-in for a
 * command (claude, node, jq, rm, mv) first on PATH. Extracted from
 * eager-memory-refresh.test.ts so queue-append.test.ts and shell-hooks.test.ts build
 * their stand-ins the same way, instead of writing a new executable for each test.
 *
 * Every fake is a symlink to ONE dispatcher script that sources the plain data file
 * `<link>.body`. A test writes only that data file and a link, and a link is not a new
 * executable: on macOS the first exec of a newly written file is held by syspolicyd
 * after a fork-heavy run (measured 1.0-5.4 s; harness bounds use a wider margin; the
 * second exec of the same file takes ~3-12 ms, and a new link to a warm script
 * ~2.5 ms), and a fake that is new for each test pays that hold inside whatever time
 * bound the test sets. The dispatcher is written and executed once, in `beforeAll`, so
 * no test runs a cold executable under a time bound. Sourcing reads the body in the
 * dispatcher's own shell, so the fake runs the same script text, with the same `$$`,
 * arguments and `exit`, as a file of its own would.
 */

import { afterAll, beforeAll, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Bound on the one cold exec a setup hook pays so that no test does: the dispatcher
 * here, or any other executable a test file warms in `beforeAll` (a real runtime, a
 * node stub). A hold that outlasts it fails in the hook and names the cause.
 */
export const COLD_EXEC_WARM_BOUND_MS = 30_000;

/** Timeout for a setup hook that pays the cold exec: its bound plus room for the rest of the hook. */
export const COLD_EXEC_WARM_HOOK_MS = COLD_EXEC_WARM_BOUND_MS + 5_000;

/** The first line of every fake body: the dispatcher sources the body with bash. */
const FAKE_SHEBANG = '#!/bin/bash\n';

const FAKE_DISPATCHER = `${FAKE_SHEBANG}. "$0.body"\n`;

/**
 * Make `bin` run `script` (a whole bash script, shebang line included) through the warm
 * dispatcher. Writing it again replaces the earlier script. The body is found beside the
 * path that was executed, so swap a fake by writing it again, never by linking to another fake.
 */
export type WriteFakeExecutable = (bin: string, script: string) => void;

/**
 * Register the dispatcher setup and teardown on the surrounding scope (the file, or the
 * `describe` this is called in) and return the writer to use from its tests and per-test
 * hooks. Call it once per scope, while the file is being collected, never inside a test.
 * The dispatcher is paid for and warmed in `beforeAll`, through a link as the tests run it.
 */
export function useWarmFakeExecutables(): WriteFakeExecutable {
  let dispatcherDir = '';
  let dispatcher = '';

  const writeFakeExecutable: WriteFakeExecutable = (bin, script) => {
    if (dispatcher === '') {
      throw new Error('writeFakeExecutable: the warm dispatcher is built in beforeAll; call this from a test or a per-test hook');
    }
    if (!script.startsWith(FAKE_SHEBANG)) {
      throw new Error(
        `writeFakeExecutable: the fake body for ${bin} must start with "#!/bin/bash" and a newline, because the dispatcher sources it with bash; it starts with ${JSON.stringify(script.slice(0, 24))}`,
      );
    }
    fs.writeFileSync(`${bin}.body`, script);
    fs.rmSync(bin, { force: true });
    fs.symlinkSync(dispatcher, bin);
  };

  beforeAll(() => {
    dispatcherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warm-fakes-'));
    dispatcher = path.join(dispatcherDir, 'dispatcher');
    fs.writeFileSync(dispatcher, FAKE_DISPATCHER);
    fs.chmodSync(dispatcher, 0o755);
    const warmLink = path.join(dispatcherDir, 'warm');
    writeFakeExecutable(warmLink, `${FAKE_SHEBANG}exit 0\n`);
    const warm = spawnSync(warmLink, [], { timeout: COLD_EXEC_WARM_BOUND_MS });
    expect(
      warm.status,
      `the fake-executable dispatcher did not run within ${COLD_EXEC_WARM_BOUND_MS} ms: ${warm.error?.message ?? `signal ${warm.signal}`}`,
    ).toBe(0);
  }, COLD_EXEC_WARM_HOOK_MS);

  afterAll(() => {
    if (dispatcherDir !== '') fs.rmSync(dispatcherDir, { recursive: true, force: true });
    dispatcherDir = '';
    dispatcher = '';
  });

  return writeFakeExecutable;
}

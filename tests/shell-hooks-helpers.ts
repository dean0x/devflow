/**
 * Hook-invocation primitives shared by the shell-hook test files.
 *
 * `runHook` drives one hook script through its real interface — a JSON object on
 * stdin, a HOME override, and whatever extra env the case needs — and returns
 * stdout/stderr/exitCode instead of throwing, so a non-zero exit is a value the
 * caller asserts on rather than a failure the caller has to catch.
 */

import { execSync } from 'child_process';
import * as path from 'path';

/** The hook scripts as authored (source tree), never as installed. */
export const HOOKS_DIR = path.resolve(import.meta.dirname, '..', 'src', 'assets', 'scripts', 'hooks');

export function runHook(
  hookPath: string,
  input: object,
  homeDir: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(`bash "${hookPath}"`, {
      input: JSON.stringify(input),
      env: { ...process.env, HOME: homeDir, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: result.toString(), stderr: '', exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

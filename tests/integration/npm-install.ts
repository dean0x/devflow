/**
 * The `npm install` of a packed devflow tarball, shared by the pack tests (#698).
 *
 * `--no-audit` keeps the install off the registry's audit service. The tests check
 * the package, not the audit, so an outage or a slow answer of that service must not
 * fail them. tests/integration/npm-install-no-audit.test.ts proves that these
 * arguments send no audit request.
 */

/** The npm arguments before the tarball path. */
export const TARBALL_INSTALL_ARGS: readonly string[] = ['install', '--no-save', '--no-audit'];

/** The shell command that installs one tarball with TARBALL_INSTALL_ARGS. */
export function tarballInstallCommand(tgzPath: string): string {
  return `npm ${TARBALL_INSTALL_ARGS.join(' ')} "${tgzPath}"`;
}

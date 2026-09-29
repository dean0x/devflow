#!/usr/bin/env node
// src/assets/scripts/resolve-evidence-policy.cjs
//
// Resolves EVIDENCE_POLICY for a repository and prints it on ONE line together
// with the three mechanism inputs that operations receive. Installed as a
// top-level sibling of hud.sh and redact-secrets.cjs under ~/.devflow/scripts/,
// with its parser beside it in lib/project-config.cjs.
//
// Usage: node resolve-evidence-policy.cjs [<dir>]      (<dir> defaults to cwd)
//
// The policy is plumbing, decided once by the caller: this script prints it plus
// the mechanism inputs, and operations only ever see the inputs. It WRITES NOTHING
// — no file, no git ref, no remote state — so `.devflow/project.json` (and the
// legacy `.devflow/policy.json` it falls back to) stay team-owned files that only
// the team commits (applies ADR-024).
//
// stdout is exactly one line plus "\n", or empty (D-POLICY-LINE):
//   EVIDENCE_POLICY=<required|standard> SOURCE=<file|worktree|default|invalid|error>
//   REF=<branch|none>[ WARN=<w>[,<w>…]] ISSUE_REQUIRED=<bool> APPLY_CONVENTIONS=<bool>
//   REQUIRE_NON_AUTHOR_APPROVAL=<bool>
// (one line on stdout; wrapped here for reading). Every value is a token from a
// closed vocabulary or a SAFE_REF_RE-checked branch name, so no byte of a policy
// file, a gh answer or a git answer can reach stdout.
//
// Exit codes (a caller treats EVERY non-zero code as `required`):
//   0  resolved — the line above
//   1  usage error — stdout entirely empty, usage on stderr
//   2  input unusable — <dir> missing or not a directory; prints FAIL_CLOSED_LINE
//   3  never emitted — this script writes no file, so the write-failure code of
//      redact-secrets.cjs has no arm here and is absent from EXIT_CODES
//   4  internal error — or git could not say whether <dir> is in a repository
//      (missing, timed out, killed); prints FAIL_CLOSED_LINE
//   5  output gate refused — the composed line failed the grammar or was not
//      consistent with the resolved policy; prints FAIL_CLOSED_LINE. Final: a
//      re-run resolves the same inputs to the same refusal
//
// Design constraints (binding):
//   - main() returns {code, line} and never calls process.exit; the single
//     `require.main === module` boundary is the only stdout write and the only
//     exitCode assignment, so nothing is truncated and no cleanup is skipped
//   - every subprocess is spawned with an argv array (never a shell), stdin
//     ignored, a timeout and a maxBuffer; every loop has a fixed bound
//   - a policy file that is not a regular file is never opened, and one over
//     MAX_POLICY_BYTES is never read
//   - no index-refreshing git command runs (no `status`, no `diff`), so a
//     repository's configured fsmonitor hook never fires; no fetch, no set-head

'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const projectConfig = require('./lib/project-config.cjs');

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** @typedef {'required' | 'standard'} Policy */
/** @typedef {'file' | 'worktree' | 'default' | 'invalid' | 'error'} Source */
/** @typedef {'remote-unavailable' | 'invalid-file' | 'raised-by-compliance' | 'pr-changes-policy'} Warning */

/** Every policy value, strictest first. */
const POLICIES = Object.freeze(/** @type {Policy[]} */ (['required', 'standard']));

/** Every SOURCE value — the governing input, or `error` for a fail-closed exit. */
const SOURCES = Object.freeze(/** @type {Source[]} */ (['file', 'worktree', 'default', 'invalid', 'error']));

/**
 * Every WARN token, in the order the line prints them.
 *   remote-unavailable    the default branch's file could not be consulted
 *   invalid-file          a folded policy file (remote, worktree or tracking copy) was invalid
 *   raised-by-compliance  compliance raised a `standard` file or worktree policy
 *   pr-changes-policy     HEAD or the worktree differs from the default branch (advisory)
 */
const WARNINGS = Object.freeze(/** @type {Warning[]} */ ([
  'remote-unavailable',
  'invalid-file',
  'raised-by-compliance',
  'pr-changes-policy',
]));

/**
 * Exit codes by meaning. 3 is deliberately absent: no arm of this script can
 * produce it, and a value in a closed vocabulary that no arm reaches reads as a
 * live outcome to anyone auditing the set.
 */
const EXIT_CODES = Object.freeze({
  RESOLVED: 0,
  USAGE: 1,
  INPUT_UNUSABLE: 2,
  INTERNAL_ERROR: 4,
  OUTPUT_GATE_REFUSED: 5,
});

/**
 * @typedef {{ ISSUE_REQUIRED: boolean, APPLY_CONVENTIONS: boolean, REQUIRE_NON_AUTHOR_APPROVAL: boolean }} MechanismInputs
 */

/**
 * D-POLICY-PLUMBING: the mechanism inputs are a pure function of EVIDENCE_POLICY,
 * and this table is their single authority. Operations receive these three
 * booleans and never the policy itself; a prompt that restated the mapping would
 * be a second authority free to drift from this one.
 *   ISSUE_REQUIRED               a tracked issue is mandatory for the task
 *   APPLY_CONVENTIONS            learned naming conventions are applied (branch, PR title)
 *   REQUIRE_NON_AUTHOR_APPROVAL  merge-readiness demands a non-author approval
 * Per-PR content (a PR's test-plan block, its exceptions) is rendered by callers
 * and is not a function of the policy, so it is not emitted here.
 *
 * @type {Readonly<Record<Policy, Readonly<MechanismInputs>>>}
 */
const MECHANISM_INPUTS = Object.freeze({
  required: Object.freeze({ ISSUE_REQUIRED: true, APPLY_CONVENTIONS: true, REQUIRE_NON_AUTHOR_APPROVAL: true }),
  standard: Object.freeze({ ISSUE_REQUIRED: false, APPLY_CONVENTIONS: false, REQUIRE_NON_AUTHOR_APPROVAL: false }),
});

/** The mechanism-input keys, in line order. */
const INPUT_KEYS = Object.freeze(['ISSUE_REQUIRED', 'APPLY_CONVENTIONS', 'REQUIRE_NON_AUTHOR_APPROVAL']);

/**
 * Largest policy or project file read, in bytes — the shared parser's bound, so
 * both files obey one limit. A policy is two keys; nothing valid approaches this.
 */
const MAX_POLICY_BYTES = projectConfig.MAX_CONFIG_BYTES;

/**
 * A branch name this script will put into argv or onto stdout: an alphanumeric
 * first character (so never an option and never a hidden path), then at most 254
 * of `[A-Za-z0-9._/-]`, and never `..`. The lookahead is bounded by the same
 * class, so the scan is linear (no unbounded `.*`).
 */
const SAFE_REF_RE = /^(?![A-Za-z0-9._/-]{0,254}\.\.)[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;

/**
 * D-POLICY-LINE: the exported output grammar — anchored, closed alternations
 * only, named groups for consumers. Consumers' parses are pinned to this
 * expression, so it is the one definition of a well-formed line. REF admits
 * `none` or a SAFE_REF_RE branch (a branch literally named `none` is ambiguous;
 * REF is display-only and no consumer branches on it).
 */
const OUTPUT_LINE_RE = /^EVIDENCE_POLICY=(?<policy>required|standard) SOURCE=(?<source>file|worktree|default|invalid|error) REF=(?<ref>none|(?![A-Za-z0-9._/-]{0,254}\.\.)[A-Za-z0-9][A-Za-z0-9._/-]{0,254})(?: WARN=(?<warn>(?:remote-unavailable|invalid-file|raised-by-compliance|pr-changes-policy)(?:,(?:remote-unavailable|invalid-file|raised-by-compliance|pr-changes-policy)){0,3}))? ISSUE_REQUIRED=(?<issue>true|false) APPLY_CONVENTIONS=(?<conventions>true|false) REQUIRE_NON_AUTHOR_APPROVAL=(?<approval>true|false)$/;

/**
 * The line every refusal prints (exits 2, 4 and 5). A constant, so the boundary
 * can never fail to compose it, and `required` in every field a consumer reads.
 */
const FAIL_CLOSED_LINE =
  'EVIDENCE_POLICY=required SOURCE=error REF=none ISSUE_REQUIRED=true APPLY_CONVENTIONS=true REQUIRE_NON_AUTHOR_APPROVAL=true';

// ---------------------------------------------------------------------------
// Subprocess bounds (every spawn carries a timeout and a maxBuffer)
// ---------------------------------------------------------------------------

const GH_TIMEOUT_MS = 10000;
const GIT_REMOTE_TIMEOUT_MS = 10000;
const GIT_LOCAL_TIMEOUT_MS = 5000;
/** gh answers and blob reads: generous for a 4 KiB policy, and an overflow is ENOBUFS ⇒ invalid. */
const BLOB_MAX_BUFFER = 65536;
/** rev-parse and ls-remote print one short line each. */
const LINE_MAX_BUFFER = 4096;

/** The repository-relative path of the legacy policy file, in git and API spelling. */
const POLICY_REL = '.devflow/policy.json';

/** The repository-relative path of the team config file, in git and API spelling. */
const PROJECT_REL = '.devflow/project.json';

/** `git ls-remote --symref origin HEAD`, first line. Bounded class, no backtracking. */
const LS_REMOTE_SYMREF_RE = /^ref: refs\/heads\/([^\t\n]{1,255})\tHEAD$/;

// ---------------------------------------------------------------------------
// Types shared by the helpers
// ---------------------------------------------------------------------------

/**
 * @typedef {{ kind: 'absent' } | { kind: 'invalid' } | { kind: 'valid', policy: Policy }} ParsedPolicy
 *
 * @typedef {{ policy: Policy, source: Source, ref: string, warnings: Warning[], inputs: MechanismInputs }} Resolution
 *   `ref` is the default branch as resolved, else `none`. Frozen, arrays included.
 *
 * @typedef {{ status: number | null, stdout?: Buffer | string, stderr?: Buffer | string, error?: { code?: string } }} ExecResult
 *   The spawnSync subset this script reads.
 *
 * @typedef {(file: string, args: string[], opts: object) => ExecResult} ExecFn
 *   Called exactly like child_process.spawnSync(file, args, opts).
 *
 * @typedef {{ dir: string, compliance?: unknown }} ResolveOptions
 *   `compliance` is the caller's already-read `manifest.features.compliance` value
 *   (raw or normalized — complianceDefault accepts either). Omitted (undefined), the
 *   script reads the manifest itself; pass `null` for "no compliance state".
 *
 * @typedef {{ exec?: ExecFn }} ResolveDeps
 *   `exec` is the only injected I/O; it defaults to child_process.spawnSync.
 *
 * @typedef {{ kind: 'resolve', dir: string } | { kind: 'usage', usage: string }} ParsedArgs
 *
 * @typedef {{ exec?: ExecFn, formatLine?: (r: Resolution) => unknown }} MainDeps
 *   Injected by tests only, to reach the output gate.
 *
 * @typedef {{ code: number, line: string }} MainOutcome
 *   `line` is '' only for code 1, FAIL_CLOSED_LINE for codes 2, 4 and 5.
 */

/** @type {ParsedPolicy} */
const ABSENT = Object.freeze({ kind: 'absent' });
/** @type {ParsedPolicy} */
const INVALID = Object.freeze({ kind: 'invalid' });

/** @type {Resolution} */
const ERROR_RESOLUTION = Object.freeze({
  policy: 'required',
  source: 'error',
  ref: 'none',
  warnings: Object.freeze([]),
  inputs: MECHANISM_INPUTS.required,
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

/**
 * Parse argv into a directory or a usage error. `kind` is the discriminant, and
 * main() dispatches on it alone. Any `-`-prefixed argument (including `-` and
 * `--`) or a second positional is a usage error, never an ignored argument.
 *
 * @param {readonly string[]} argv  process.argv
 * @returns {ParsedArgs}
 */
function parseArgs(argv) {
  const USAGE = 'Usage: node resolve-evidence-policy.cjs [<dir>]';
  const rest = Array.isArray(argv) ? argv.slice(2) : [];
  /** @type {string[]} */
  const positionals = [];
  for (const arg of rest) {
    if (typeof arg !== 'string' || arg.startsWith('-')) {
      return {
        kind: 'usage',
        usage: 'resolve-evidence-policy: unrecognised argument ' + JSON.stringify(String(arg)).slice(0, 80) + '\n' + USAGE,
      };
    }
    positionals.push(arg);
  }
  if (positionals.length > 1) return { kind: 'usage', usage: USAGE };
  return { kind: 'resolve', dir: positionals.length === 1 ? positionals[0] : process.cwd() };
}

// ---------------------------------------------------------------------------
// parsePolicyBytes (D-POLICY-STRICT-SCHEMA)
// ---------------------------------------------------------------------------

/**
 * D-POLICY-STRICT-SCHEMA: the grammar gate a policy file must pass BEFORE
 * JSON.parse sees it. Exactly two members, each key `version` or
 * `evidencePolicy`, each value `1`, `"required"` or `"standard"`, and JSON
 * whitespace only — `[ \t\r\n]`, never `\s`, which admits U+FEFF and U+00A0.
 * Each `*` run is separated by a literal, so matching is linear. What it keeps
 * out never reaches the parser: `__proto__`/`constructor` and every other key,
 * `\u`-escaped keys or values, `1.0`, `"1"`, arrays, `null`, trailing bytes.
 */
const POLICY_GRAMMAR_RE =
  /^[ \t\r\n]*\{[ \t\r\n]*"(?:version|evidencePolicy)"[ \t\r\n]*:[ \t\r\n]*(?:1|"required"|"standard")[ \t\r\n]*,[ \t\r\n]*"(?:version|evidencePolicy)"[ \t\r\n]*:[ \t\r\n]*(?:1|"required"|"standard")[ \t\r\n]*\}[ \t\r\n]*$/;

/**
 * Classify policy-file bytes. `null`/`undefined` is "no file" (absent); everything
 * else is valid or invalid, never absent — an empty committed file is invalid.
 *
 * The byte checks run before decoding (lib/project-config.cjs decodeConfigBytes:
 * size, then a UTF-8 BOM, which is invalid rather than skipped, then a decode
 * that is fatal on a malformed sequence), and after the
 * grammar gate the parsed object must hold exactly the own keys
 * {version, evidencePolicy} with version === 1. A duplicate key passes the
 * grammar but collapses in the parse, so the key-set check refuses it.
 *
 * @param {Uint8Array | null | undefined} buf
 * @returns {ParsedPolicy}
 */
function parsePolicyBytes(buf) {
  // The byte rules (size, BOM, fatal UTF-8) come from decodeConfigBytes, so the
  // policy file and project.json can never disagree about what bytes are.
  const decoded = projectConfig.decodeConfigBytes(buf);
  if (decoded.kind === 'absent') return ABSENT;
  if (decoded.kind === 'invalid') return INVALID;
  const text = decoded.text;
  if (!POLICY_GRAMMAR_RE.test(text)) return INVALID;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return INVALID;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return INVALID;
  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !keys.includes('version') || !keys.includes('evidencePolicy')) return INVALID;
  if (parsed.version !== 1) return INVALID;
  if (!POLICIES.includes(parsed.evidencePolicy)) return INVALID;
  return Object.freeze({ kind: 'valid', policy: parsed.evidencePolicy });
}

/**
 * The canonical bytes of a policy file — what the CLI suggests a team commit.
 *
 * @param {unknown} policy
 * @returns {string | null}  `{"version":1,"evidencePolicy":"<p>"}\n`, or null outside POLICIES
 */
function serializePolicy(policy) {
  if (!POLICIES.includes(/** @type {Policy} */ (policy))) return null;
  return JSON.stringify({ version: 1, evidencePolicy: policy }) + '\n';
}

// ---------------------------------------------------------------------------
// Compliance default
// ---------------------------------------------------------------------------

/**
 * The compliance default C. Mirrors the CLI's `normalizeComplianceFeature`
 * (src/core/compliance.ts) exactly — absent or malformed is disabled — behind a
 * parity test. Enabled is `required` WHATEVER the framework count: an install
 * with zero frameworks ("generic controls only") still installs the compliance
 * skill and is gated today, and no compliance-on user may lose that. Which
 * frameworks are listed therefore never matters, only that the value is
 * well-formed.
 *
 * @param {unknown} rawFeatureValue  `manifest.features.compliance`, raw or normalized
 * @returns {Policy}
 */
function complianceDefault(rawFeatureValue) {
  const raw = /** @type {any} */ (rawFeatureValue);
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return 'standard';
  if (typeof raw.enabled !== 'boolean') return 'standard';
  if (!Array.isArray(raw.frameworks)) return 'standard';
  if (!raw.frameworks.every((/** @type {unknown} */ f) => typeof f === 'string')) return 'standard';
  return raw.enabled ? 'required' : 'standard';
}

// ---------------------------------------------------------------------------
// Bounded file reads
// ---------------------------------------------------------------------------

/** Bounded, never-writing file read — the shared one (lib/project-config.cjs). */
const readBoundedRegularFile = projectConfig.readBoundedRegularFile;

/**
 * W — the working tree's policy file. lstat-refused, never followed: a symlink,
 * directory, FIFO or device is invalid unopened, and an oversize file invalid
 * unread.
 *
 * @param {string} root
 * @returns {ParsedPolicy}
 */
function readWorktreePolicy(root) {
  const read = readBoundedRegularFile(path.join(root, '.devflow', 'policy.json'), MAX_POLICY_BYTES, false);
  if (read.kind === 'absent') return ABSENT;
  if (read.kind === 'refused') return INVALID;
  return parsePolicyBytes(read.bytes);
}

// ---------------------------------------------------------------------------
// Source readings (D-POLICY-SOURCE-PRECEDENCE, D-COMPLIANCE-REPO-FLOOR)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ evidence: ParsedPolicy, compliance: boolean }} SourceReading
 *   What one source (R, T, H or W) says: its evidence policy, and whether its
 *   project.json declares repository compliance.
 *
 * @typedef {{ evidence: ParsedPolicy | null, compliance: boolean }} ProjectReading
 *   `evidence` null ⇒ project.json does not decide it, so the legacy policy file
 *   at the same source does.
 *
 * @typedef {{ kind: 'absent' } | { kind: 'invalid' } | { kind: 'parsed', evidence: { kind: string, value?: unknown }, compliance: { kind: string } }} ProjectConfigView
 *   The part of lib/project-config.cjs ProjectConfig this script reads.
 */

/** @type {ProjectConfigView} */
const PROJECT_ABSENT = Object.freeze({ kind: 'absent' });
/** @type {ProjectConfigView} */
const PROJECT_INVALID = Object.freeze({ kind: 'invalid' });

/**
 * D-POLICY-SOURCE-PRECEDENCE: at every source, `project.json` decides the
 * evidence policy when it can, and the legacy `policy.json` at the SAME source
 * only when it cannot — project.json absent, or present without an `evidence`
 * key. A present-but-malformed or duplicated `evidence` decides `invalid`
 * (⇒ required) and is never rescued by the legacy file, and a project.json that
 * is not a JSON object at all is invalid outright. The precedence is per source,
 * so each source still says ONE thing and foldPolicy folds them exactly as it
 * always has; with no project.json anywhere, every output line is byte-identical
 * to the policy-file-only resolver (AC-24).
 *
 * D-COMPLIANCE-REPO-FLOOR: a `compliance` key in project.json at R, T or W — any
 * value, an empty list and a malformed one included — makes the repository's
 * compliance default `required`, folded with the machine's as
 * stricter(C_machine, C_repo). A machine with compliance on at zero frameworks is
 * already `required`, and a repository that declares compliance is held to the
 * same floor. A project.json that cannot be read counts as declaring it (fail
 * closed).
 *
 * @param {ProjectConfigView} project
 * @returns {ProjectReading}
 */
function projectReading(project) {
  if (project.kind === 'absent') return { evidence: null, compliance: false };
  if (project.kind === 'invalid') return { evidence: INVALID, compliance: true };
  const compliance = project.compliance.kind !== 'absent';
  const evidence = project.evidence;
  if (evidence.kind === 'valid' && POLICIES.includes(/** @type {Policy} */ (evidence.value))) {
    return { evidence: Object.freeze({ kind: 'valid', policy: /** @type {Policy} */ (evidence.value) }), compliance };
  }
  if (evidence.kind === 'absent') return { evidence: null, compliance };
  return { evidence: INVALID, compliance };
}

/**
 * Complete a project reading with the legacy file's evidence when project.json
 * did not decide it.
 *
 * @param {ProjectReading} reading
 * @param {() => ParsedPolicy} readLegacy  called only when needed
 * @returns {SourceReading}
 */
function withLegacyFallback(reading, readLegacy) {
  return { evidence: reading.evidence === null ? readLegacy() : reading.evidence, compliance: reading.compliance };
}

/**
 * W — the working tree's project.json, then its policy.json. Both are
 * lstat-refused, never followed: a symlink, directory, FIFO or device is invalid
 * unopened, and an oversize file invalid unread.
 *
 * @param {string} root
 * @returns {SourceReading}
 */
function readWorktreeSource(root) {
  const read = readBoundedRegularFile(path.join(root, '.devflow', 'project.json'), MAX_POLICY_BYTES, false);
  const project = read.kind === 'ok' ? projectConfig.parseProjectBytes(read.bytes)
    : read.kind === 'absent' ? PROJECT_ABSENT : PROJECT_INVALID;
  return withLegacyFallback(projectReading(project), () => readWorktreePolicy(root));
}

/**
 * The raw `features.compliance` value from the machine manifest, or undefined.
 * The manifest is read by the shared reader (lib/project-config.cjs
 * readMachineManifest) — never through the CLI's manifest reader, which
 * heal-writes. Anything unreadable or malformed is "no state", which
 * complianceDefault maps to disabled; since C only ever raises, a missing C can
 * never lower the result below the governing file.
 *
 * @returns {unknown}
 */
function readManifestCompliance() {
  const parsed = projectConfig.readMachineManifest();
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const features = /** @type {any} */ (parsed).features;
  if (features === null || typeof features !== 'object' || Array.isArray(features)) return undefined;
  return Object.prototype.hasOwnProperty.call(features, 'compliance') ? features.compliance : undefined;
}

// ---------------------------------------------------------------------------
// Subprocess calls (D-POLICY-PROBE)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ ok: boolean, status: number | null, errorCode: string | null, stdout: Buffer, stderr: string }} CallResult
 * @typedef {{ exec: ExecFn, env: NodeJS.ProcessEnv }} CallContext
 */

/**
 * Whether a call ran to completion and exited on its own — as opposed to never
 * starting (ENOENT), timing out, overflowing its buffer or being killed. Only an
 * answered non-zero exit is a real "no" ("not a repository", "no such path",
 * "no such ref"); an unanswered call is NOT KNOWING, and a local-git step that
 * does not know must not read as the permissive answer (avoids PF-075).
 *
 * @param {CallResult} r
 * @returns {boolean}
 */
function answered(r) {
  return r.errorCode === null && r.status !== null;
}

/** @param {unknown} value @returns {Buffer} */
function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.alloc(0);
}

/**
 * One bounded subprocess call, normalized. `ok` is exit 0 with no spawn error.
 * The argv array is a fresh copy, so an exec cannot mutate a caller's constant.
 *
 * @param {CallContext} ctx
 * @param {string} file
 * @param {readonly string[]} args
 * @param {string} cwd
 * @param {number} timeout
 * @param {number} maxBuffer
 * @returns {CallResult}
 */
function runCall(ctx, file, args, cwd, timeout, maxBuffer) {
  const res = ctx.exec(file, [...args], {
    cwd,
    env: ctx.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer,
    windowsHide: true,
    shell: false,
  });
  const errorCode = res && res.error ? String(res.error.code || 'EUNKNOWN') : null;
  const status = res && typeof res.status === 'number' ? res.status : null;
  return {
    ok: errorCode === null && status === 0,
    status,
    errorCode,
    stdout: asBuffer(res && res.stdout),
    stderr: asBuffer(res && res.stderr).toString('utf8'),
  };
}

/**
 * @typedef {{ kind: 'root', root: string } | { kind: 'none' } | { kind: 'unknown' }} Toplevel
 */

/**
 * Step 1: the repository root.
 *   root     exit 0 with exactly one absolute path plus its newline
 *   none     git ANSWERED non-zero — not a repository (or not a work tree); the
 *            resolver then treats the remote as unavailable and the worktree file
 *            as absent
 *   unknown  git did not answer (missing, timed out, overflowed, killed), or
 *            answered exit 0 — a repository — with an unusable path. Either way a
 *            repository's files may exist and cannot be read, so resolve() fails
 *            closed rather than resolving from compliance alone
 *
 * @param {CallContext} ctx
 * @param {string} dir
 * @returns {Toplevel}
 */
function gitToplevel(ctx, dir) {
  const r = runCall(ctx, 'git', ['rev-parse', '--show-toplevel'], dir, GIT_LOCAL_TIMEOUT_MS, LINE_MAX_BUFFER);
  if (!answered(r)) return { kind: 'unknown' };
  if (r.status !== 0) return { kind: 'none' };
  const text = r.stdout.toString('utf8').replace(/\r?\n$/, '');
  if (text === '' || /[\r\n\0]/.test(text) || !path.isAbsolute(text)) return { kind: 'unknown' };
  return { kind: 'root', root: text };
}

/**
 * Step 2 — D-POLICY-PROBE: ONE gh call is both the reachability probe and the
 * default-branch lookup. `{owner}/{repo}` are gh's own placeholders, filled from
 * the repository's remotes (host inference is gh's). Reachable iff exit 0 with a
 * SAFE_REF_RE value that is not jq's `null`; anything else — no gh, no auth, no
 * GitHub remote, a hostile answer — is unavailable.
 *
 * @param {CallContext} ctx
 * @param {string} root
 * @returns {string | null}  the default branch D, or null (unavailable)
 */
function probeDefaultBranch(ctx, root) {
  const r = runCall(ctx, 'gh', ['api', 'repos/{owner}/{repo}', '--jq', '.default_branch'], root, GH_TIMEOUT_MS, BLOB_MAX_BUFFER);
  if (!r.ok) return null;
  const value = r.stdout.toString('utf8').replace(/\n$/, '');
  return value !== 'null' && SAFE_REF_RE.test(value) ? value : null;
}

/**
 * @typedef {{ kind: 'bytes', bytes: Buffer } | { kind: 'absent' } | { kind: 'overflow' }} RemoteFile
 */

/**
 * Step 3: one file on the default branch — or null when the remote turned out to
 * be unavailable after all.
 *
 * `--method GET` is mandatory: gh sends POST whenever a field is added. stdout is
 * file content ONLY on exit 0 — a 404 prints gh's JSON error body on stdout, so
 * it is classified from stderr and the exit code and its stdout is never parsed.
 *   ENOBUFS                              ⇒ overflow — invalid, never unavailable,
 *                                          or a huge file would hand control to
 *                                          the worktree
 *   exit 0                               ⇒ the bytes
 *   exit ≠ 0 and stderr has `(HTTP 404)` ⇒ absent — the probe already succeeded,
 *                                          so 404 means "no file", not "no access"
 *   anything else (403/429, 5xx, timeout, spawn error) ⇒ unavailable
 *
 * @param {CallContext} ctx
 * @param {string} root
 * @param {string} ref
 * @param {string} rel  PROJECT_REL or POLICY_REL — a constant, never input
 * @returns {RemoteFile | null}
 */
function fetchRemoteFile(ctx, root, ref, rel) {
  const r = runCall(ctx, 'gh', [
    'api', '--method', 'GET', 'repos/{owner}/{repo}/contents/' + rel,
    '-f', 'ref=' + ref, '-H', 'Accept: application/vnd.github.raw+json',
  ], root, GH_TIMEOUT_MS, BLOB_MAX_BUFFER);
  if (r.errorCode === 'ENOBUFS') return { kind: 'overflow' };
  if (r.ok) return { kind: 'bytes', bytes: r.stdout };
  if (r.errorCode === null && r.status !== null && r.status !== 0 && r.stderr.includes('(HTTP 404)')) return { kind: 'absent' };
  return null;
}

/**
 * R — the default branch's project.json, then (only when it is a 404 or has no
 * `evidence`) its policy.json. Null when either call finds the remote
 * unavailable: a half-read default branch is not a default branch.
 *
 * @param {CallContext} ctx
 * @param {string} root
 * @param {string} ref
 * @returns {SourceReading | null}
 */
function remoteSource(ctx, root, ref) {
  const projectFile = fetchRemoteFile(ctx, root, ref, PROJECT_REL);
  if (projectFile === null) return null;
  const reading = projectReading(projectFile.kind === 'bytes' ? projectConfig.parseProjectBytes(projectFile.bytes)
    : projectFile.kind === 'absent' ? PROJECT_ABSENT : PROJECT_INVALID);
  if (reading.evidence !== null) return { evidence: reading.evidence, compliance: reading.compliance };
  const policyFile = fetchRemoteFile(ctx, root, ref, POLICY_REL);
  if (policyFile === null) return null;
  return withLegacyFallback(reading, () => (policyFile.kind === 'bytes' ? parsePolicyBytes(policyFile.bytes)
    : policyFile.kind === 'absent' ? ABSENT : INVALID));
}

/**
 * Step 5 (offline, D unknown): the default branch from `ls-remote --symref`.
 * Only line 1 is read, and its capture must still pass SAFE_REF_RE.
 *
 * @param {CallContext} ctx
 * @param {string} root
 * @returns {string | null}
 */
function lsRemoteDefaultBranch(ctx, root) {
  const r = runCall(ctx, 'git', ['ls-remote', '--symref', 'origin', 'HEAD'], root, GIT_REMOTE_TIMEOUT_MS, LINE_MAX_BUFFER);
  if (!r.ok) return null;
  const text = r.stdout.toString('utf8');
  const newline = text.indexOf('\n');
  const m = LS_REMOTE_SYMREF_RE.exec(newline === -1 ? text : text.slice(0, newline));
  return m !== null && SAFE_REF_RE.test(m[1]) ? m[1] : null;
}

/**
 * Steps 4 and 7: one blob at a revision (HEAD, or the tracking ref).
 * Exit 0 ⇒ the bytes; an answered non-zero exit (the path does not exist there,
 * an unborn HEAD) ⇒ absent; an unanswered call (ENOBUFS included) ⇒ unanswered,
 * which every caller reads as invalid — never absent, or a git that timed out
 * would silently drop the default branch's copy from the fold.
 *
 * @param {CallContext} ctx
 * @param {string} root
 * @param {string} revision
 * @param {string} rel  PROJECT_REL or POLICY_REL — a constant, never input
 * @returns {{ kind: 'bytes', bytes: Buffer } | { kind: 'absent' } | { kind: 'unanswered' }}
 */
function catFileBlob(ctx, root, revision, rel) {
  const r = runCall(ctx, 'git', ['cat-file', 'blob', revision + ':' + rel], root,
    GIT_LOCAL_TIMEOUT_MS, BLOB_MAX_BUFFER);
  if (r.ok) return { kind: 'bytes', bytes: r.stdout };
  return answered(r) ? { kind: 'absent' } : { kind: 'unanswered' };
}

/**
 * The legacy policy blob at a revision: parsed, absent, or invalid when unanswered.
 *
 * @param {CallContext} ctx
 * @param {string} root
 * @param {string} revision
 * @returns {ParsedPolicy}
 */
function catFilePolicy(ctx, root, revision) {
  const blob = catFileBlob(ctx, root, revision, POLICY_REL);
  if (blob.kind === 'bytes') return parsePolicyBytes(blob.bytes);
  return blob.kind === 'absent' ? ABSENT : INVALID;
}

/**
 * T or H: a revision's project.json, then (only when it is absent or has no
 * `evidence`) its policy.json.
 *
 * @param {CallContext} ctx
 * @param {string} root
 * @param {string} revision
 * @returns {SourceReading}
 */
function revisionSource(ctx, root, revision) {
  const blob = catFileBlob(ctx, root, revision, PROJECT_REL);
  const project = blob.kind === 'bytes' ? projectConfig.parseProjectBytes(blob.bytes)
    : blob.kind === 'absent' ? PROJECT_ABSENT : PROJECT_INVALID;
  return withLegacyFallback(projectReading(project), () => catFilePolicy(ctx, root, revision));
}

/**
 * Steps 6 and 7 (offline, D known): T, the local tracking copy of the default
 * branch's files. The ref check decides whether T can stand for the default branch
 * at all — a ref git ANSWERS is missing is "B unknown" (null), which a failed blob
 * read could not tell apart from "file absent". A ref check git does not answer is
 * not knowing, so T is invalid (it raises) rather than unknown (it would not).
 *
 * @param {CallContext} ctx
 * @param {string} root
 * @param {string} ref
 * @returns {SourceReading | null}
 */
function trackingSource(ctx, root, ref) {
  const trackingRef = 'refs/remotes/origin/' + ref;
  const r = runCall(ctx, 'git', ['rev-parse', '--verify', '--quiet', trackingRef], root,
    GIT_LOCAL_TIMEOUT_MS, LINE_MAX_BUFFER);
  if (r.ok) return revisionSource(ctx, root, trackingRef);
  return answered(r) ? null : { evidence: INVALID, compliance: false };
}

// ---------------------------------------------------------------------------
// Gathering the facts (the imperative shell)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   reachable: boolean,
 *   ref: string | null,
 *   remote: ParsedPolicy | null,
 *   worktree: ParsedPolicy,
 *   tracking: ParsedPolicy | null,
 *   head: ParsedPolicy | null,
 *   compliance: Policy,
 * }} Facts
 *   remote     R — set iff reachable
 *   tracking   T — set iff offline and refs/remotes/origin/<D> exists (or git
 *              could not answer whether it does — then invalid)
 *   head       H — set iff B (R online, T offline) is known
 *   compliance stricter(C_machine, C_repo) — D-COMPLIANCE-REPO-FLOOR
 */

/**
 * Run the fixed call sequence (D-POLICY-PROBE). The only calls ever made, in order:
 *   git rev-parse --show-toplevel                           (cwd = <dir>)
 *   gh api repos/{owner}/{repo} --jq .default_branch
 *   gh api --method GET …/contents/.devflow/project.json    (the probe named D)
 *   gh api --method GET …/contents/.devflow/policy.json     (… and project.json is
 *                                                            a 404 or has no evidence)
 *   git ls-remote --symref origin HEAD                      (offline, D unknown)
 *   git rev-parse --verify --quiet refs/remotes/origin/D    (offline, D known)
 *   git cat-file blob refs/remotes/origin/D:…/project.json  (that ref exists)
 *   git cat-file blob refs/remotes/origin/D:…/policy.json   (… no evidence there)
 *   git cat-file blob HEAD:…/project.json                   (B known)
 *   git cat-file blob HEAD:…/policy.json                    (… no evidence there)
 *
 * Returns null when git cannot say whether <dir> is in a repository at all (see
 * gitToplevel): nothing below can be trusted then, and resolve() fails closed.
 *
 * @param {string} dir
 * @param {Policy} compliance  C_machine
 * @param {ExecFn} exec
 * @returns {Facts | null}
 */
function gatherFacts(dir, compliance, exec) {
  /** @type {CallContext} */
  const ctx = {
    exec,
    env: Object.assign({}, process.env, { GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' }),
  };

  const toplevel = gitToplevel(ctx, dir);
  if (toplevel.kind === 'unknown') return null;
  if (toplevel.kind === 'none') {
    return { reachable: false, ref: null, remote: null, worktree: ABSENT, tracking: null, head: null, compliance };
  }
  const root = toplevel.root;

  const worktree = readWorktreeSource(root);
  let ref = probeDefaultBranch(ctx, root);
  const remote = ref === null ? null : remoteSource(ctx, root, ref);
  const reachable = remote !== null;

  /** @type {SourceReading | null} */
  let tracking = null;
  if (!reachable) {
    if (ref === null) ref = lsRemoteDefaultBranch(ctx, root);
    if (ref !== null) tracking = trackingSource(ctx, root, ref);
  }

  const baseKnown = reachable || tracking !== null;
  const head = baseKnown ? revisionSource(ctx, root, 'HEAD') : null;
  const repoCompliance = worktree.compliance
    || (remote !== null && remote.compliance)
    || (tracking !== null && tracking.compliance);
  return {
    reachable,
    ref,
    remote: remote === null ? null : remote.evidence,
    worktree: worktree.evidence,
    tracking: tracking === null ? null : tracking.evidence,
    head: head === null ? null : head.evidence,
    compliance: stricter(compliance, repoCompliance ? 'required' : 'standard'),
  };
}

// ---------------------------------------------------------------------------
// The fold (the functional core)
// ---------------------------------------------------------------------------

/**
 * @param {Policy} a
 * @param {Policy} b
 * @returns {Policy}
 */
function stricter(a, b) {
  return a === 'required' || b === 'required' ? 'required' : 'standard';
}

/**
 * The comparable state of a parsed file: absent, invalid, or its policy.
 *
 * @param {ParsedPolicy} p
 * @returns {string}
 */
function stateOf(p) {
  return p.kind === 'valid' ? p.policy : p.kind;
}

/**
 * D-POLICY-FOLD: the stricter value always wins, and local sources only raise.
 *
 * The governing file decides SOURCE and the base — R when the remote is
 * reachable, W when it is not:
 *   valid v ⇒ file|worktree, base v   invalid ⇒ invalid, base required
 *   absent  ⇒ default, base C
 * The classifier is total by construction: the terminal arm is the conservative
 * one (invalid, required), so an unforeseen state can only tighten.
 *
 * Then, raise-only: online W folds in (a valid v contributes v, invalid
 * contributes required); offline T folds in when pr-changes-policy fires; C
 * always folds in. `raised-by-compliance` fires only for SOURCE file|worktree —
 * under `default`, C IS the default rather than a raise.
 *
 * D-POLICY-CHANGE-DETECT: `pr-changes-policy` fires iff B (the default branch's
 * state — R online, T offline) is known and state(H) ≠ state(B) or state(W) ≠
 * state(B). The comparison is SEMANTIC (absent/invalid/required/standard), so a
 * CRLF checkout or reformatted JSON does not fire it. It means "the branch or
 * working tree differs from the default branch": a branch cut before a later
 * default-branch edit fires it too, and rebasing clears it — consumers must
 * treat it as advisory. It never lowers: online B is already the base and W can
 * only raise; offline T is folded in, so a branch that edits or deletes the file
 * cannot drop below the default-branch copy.
 *
 * @param {Facts} facts
 * @returns {Resolution}
 */
function foldPolicy(facts) {
  /** @type {Set<Warning>} */
  const warnings = new Set();
  if (!facts.reachable) warnings.add('remote-unavailable');

  const governing = facts.reachable && facts.remote !== null ? facts.remote : facts.worktree;
  /** @type {Source} */
  let source;
  /** @type {Policy} */
  let policy;
  if (governing.kind === 'valid') {
    source = facts.reachable ? 'file' : 'worktree';
    policy = governing.policy;
  } else if (governing.kind === 'absent') {
    source = 'default';
    policy = facts.compliance;
  } else {
    source = 'invalid';
    policy = 'required';
    warnings.add('invalid-file');
  }

  const base = facts.reachable ? facts.remote : facts.tracking;
  if (base !== null) {
    const baseState = stateOf(base);
    const headDiffers = facts.head !== null && stateOf(facts.head) !== baseState;
    if (headDiffers || stateOf(facts.worktree) !== baseState) warnings.add('pr-changes-policy');
  }

  /** @type {ParsedPolicy[]} */
  const folded = [];
  if (facts.reachable) folded.push(facts.worktree);
  if (!facts.reachable && facts.tracking !== null && warnings.has('pr-changes-policy')) folded.push(facts.tracking);
  for (const file of folded) {
    if (file.kind === 'valid') {
      policy = stricter(policy, file.policy);
    } else if (file.kind === 'invalid') {
      policy = 'required';
      warnings.add('invalid-file');
    }
  }

  const withoutCompliance = policy;
  policy = stricter(policy, facts.compliance);
  if (facts.compliance === 'required' && withoutCompliance === 'standard'
      && (source === 'file' || source === 'worktree')) {
    warnings.add('raised-by-compliance');
  }

  return Object.freeze({
    policy,
    source,
    ref: facts.ref === null ? 'none' : facts.ref,
    warnings: Object.freeze(WARNINGS.filter(w => warnings.has(w))),
    inputs: MECHANISM_INPUTS[policy],
  });
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

/**
 * The production exec: spawnSync, read off the module object at call time.
 *
 * @type {ExecFn}
 */
function defaultExec(file, args, opts) {
  return childProcess.spawnSync(file, args, /** @type {any} */ (opts));
}

/**
 * Resolve the policy for `opts.dir`. Never throws: an unexpected internal
 * failure (the exec itself throwing, say), or a git that cannot say whether
 * `opts.dir` is in a repository, is the fail-closed resolution — `required`,
 * SOURCE `error`, REF `none` — which main() maps to exit 4.
 *
 * @param {ResolveOptions} opts
 * @param {ResolveDeps} [deps]
 * @returns {Resolution}
 */
function resolve(opts, deps) {
  try {
    const exec = deps && typeof deps.exec === 'function' ? deps.exec : defaultExec;
    const compliance = complianceDefault(opts.compliance !== undefined ? opts.compliance : readManifestCompliance());
    const facts = gatherFacts(opts.dir, compliance, exec);
    return facts === null ? ERROR_RESOLUTION : foldPolicy(facts);
  } catch (_) {
    return ERROR_RESOLUTION;
  }
}

// ---------------------------------------------------------------------------
// The line, and the gate on it
// ---------------------------------------------------------------------------

/**
 * Compose the stdout line for a resolution (D-POLICY-LINE). WARN is omitted when
 * empty; the mechanism inputs follow in their fixed order.
 *
 * @param {Resolution} r
 * @returns {string}
 */
function formatLine(r) {
  const warn = r.warnings.length > 0 ? ' WARN=' + r.warnings.join(',') : '';
  const inputs = INPUT_KEYS.map(k => k + '=' + String(r.inputs[/** @type {keyof MechanismInputs} */ (k)])).join(' ');
  return 'EVIDENCE_POLICY=' + r.policy + ' SOURCE=' + r.source + ' REF=' + r.ref + warn + ' ' + inputs;
}

/**
 * Whether a line is well-formed AND internally coherent: it matches
 * OUTPUT_LINE_RE, its inputs are exactly MECHANISM_INPUTS for its policy, its
 * WARN tokens are unique and in registry order, and SOURCE invalid|error carries
 * `required`.
 *
 * @param {unknown} line
 * @returns {boolean}
 */
function isCoherentLine(line) {
  if (typeof line !== 'string') return false;
  const m = OUTPUT_LINE_RE.exec(line);
  if (m === null || m.groups === undefined) return false;
  const g = m.groups;
  const expected = MECHANISM_INPUTS[/** @type {Policy} */ (g.policy)];
  if (g.issue !== String(expected.ISSUE_REQUIRED)
      || g.conventions !== String(expected.APPLY_CONVENTIONS)
      || g.approval !== String(expected.REQUIRE_NON_AUTHOR_APPROVAL)) {
    return false;
  }
  if ((g.source === 'invalid' || g.source === 'error') && g.policy !== 'required') return false;
  if (g.warn !== undefined) {
    const order = g.warn.split(',').map(t => WARNINGS.indexOf(/** @type {Warning} */ (t)));
    for (let i = 1; i < order.length; i++) {
      if (order[i] <= order[i - 1]) return false;
    }
  }
  return true;
}

/**
 * THE GATE main() applies before returning a line: coherent, and carrying
 * exactly the resolved policy — a line that would LOWER the policy is refused
 * even when it is otherwise perfect.
 *
 * @param {unknown} line
 * @param {Resolution} resolution
 * @returns {boolean}
 */
function passesOutputGate(line, resolution) {
  if (!isCoherentLine(line)) return false;
  const m = OUTPUT_LINE_RE.exec(/** @type {string} */ (line));
  return m !== null && m.groups !== undefined && m.groups.policy === resolution.policy;
}

/**
 * Settle whatever main() returned into what the boundary may print. The code
 * must be a known exit code and the line must fit it: '' for usage, a coherent
 * line for 0, FAIL_CLOSED_LINE for the refusals. Anything else is refused.
 *
 * @param {unknown} outcome
 * @returns {MainOutcome}
 */
function settleOutcome(outcome) {
  const o = /** @type {any} */ (outcome);
  if (o === null || typeof o !== 'object' || typeof o.line !== 'string') {
    return { code: EXIT_CODES.INTERNAL_ERROR, line: FAIL_CLOSED_LINE };
  }
  if (o.code === EXIT_CODES.USAGE) return { code: EXIT_CODES.USAGE, line: '' };
  if (o.code === EXIT_CODES.RESOLVED) {
    return isCoherentLine(o.line) ? { code: o.code, line: o.line } : { code: EXIT_CODES.OUTPUT_GATE_REFUSED, line: FAIL_CLOSED_LINE };
  }
  if (o.code === EXIT_CODES.INPUT_UNUSABLE || o.code === EXIT_CODES.OUTPUT_GATE_REFUSED) {
    return { code: o.code, line: FAIL_CLOSED_LINE };
  }
  return { code: EXIT_CODES.INTERNAL_ERROR, line: FAIL_CLOSED_LINE };
}

/**
 * A short, safe label for a thrown value — its class name and system error code,
 * never its message (a message can quote input bytes).
 *
 * @param {unknown} err
 * @returns {string}
 */
function errorLabel(err) {
  const e = /** @type {any} */ (err);
  const name = e && typeof e.name === 'string' ? e.name : 'unknown';
  const code = e && typeof e.code === 'string' ? '/' + e.code : '';
  return (name + code).replace(/[^A-Za-z0-9_/]/g, '').slice(0, 60);
}

// ---------------------------------------------------------------------------
// main — returns {code, line}; never calls process.exit
// ---------------------------------------------------------------------------

/**
 * @param {string} dir
 * @returns {boolean}
 */
function isUsableDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (_) {
    return false;
  }
}

/**
 * @param {readonly string[]} argv  process.argv
 * @param {MainDeps} [deps]
 * @returns {MainOutcome}
 */
function main(argv, deps) {
  const d = deps || {};
  const args = parseArgs(argv);
  if (args.kind === 'usage') {
    process.stderr.write(args.usage + '\n');
    return { code: EXIT_CODES.USAGE, line: '' };
  }

  if (!isUsableDirectory(args.dir)) {
    process.stderr.write('resolve-evidence-policy: not a usable directory: '
      + JSON.stringify(args.dir).slice(0, 300) + ' — failing closed to required\n');
    return { code: EXIT_CODES.INPUT_UNUSABLE, line: FAIL_CLOSED_LINE };
  }

  const resolution = resolve({ dir: args.dir }, { exec: d.exec });
  if (resolution.source === 'error') {
    process.stderr.write('resolve-evidence-policy: could not resolve (git did not answer, or an internal error)'
      + ' — failing closed to required\n');
    return { code: EXIT_CODES.INTERNAL_ERROR, line: FAIL_CLOSED_LINE };
  }

  const format = typeof d.formatLine === 'function' ? d.formatLine : formatLine;
  let line;
  try {
    line = format(resolution);
  } catch (err) {
    process.stderr.write('resolve-evidence-policy: internal error (' + errorLabel(err) + ') — failing closed to required\n');
    return { code: EXIT_CODES.INTERNAL_ERROR, line: FAIL_CLOSED_LINE };
  }

  if (!passesOutputGate(line, resolution)) {
    process.stderr.write('resolve-evidence-policy: output gate refused the composed line — failing closed to required\n');
    return { code: EXIT_CODES.OUTPUT_GATE_REFUSED, line: FAIL_CLOSED_LINE };
  }
  return { code: EXIT_CODES.RESOLVED, line: /** @type {string} */ (line) };
}

// ---------------------------------------------------------------------------
// Top-level boundary
//
// This is the ONLY place that writes to stdout and sets process.exitCode.
// It re-checks what main() returned (settleOutcome) before writing, so even a
// main() that returned something malformed prints either nothing (usage) or a
// line that passes the gate. Its catch is the fail-closed arm for anything
// main() did not anticipate.
// ---------------------------------------------------------------------------

if (require.main === module) {
  let outcome;
  try {
    outcome = main(process.argv);
  } catch (err) {
    process.stderr.write('resolve-evidence-policy: internal error (' + errorLabel(err) + ') — failing closed to required\n');
    outcome = { code: EXIT_CODES.INTERNAL_ERROR, line: FAIL_CLOSED_LINE };
  }
  const settled = settleOutcome(outcome);
  if (settled.line !== '') process.stdout.write(settled.line + '\n');
  process.exitCode = settled.code;
}

// ---------------------------------------------------------------------------
// Exports — the CLI's `compliance --status` seam and the unit tests
// ---------------------------------------------------------------------------

module.exports = Object.freeze({
  POLICIES,
  SOURCES,
  WARNINGS,
  EXIT_CODES,
  MECHANISM_INPUTS,
  MAX_POLICY_BYTES,
  SAFE_REF_RE,
  OUTPUT_LINE_RE,
  FAIL_CLOSED_LINE,
  parseArgs,
  parsePolicyBytes,
  complianceDefault,
  resolve,
  formatLine,
  serializePolicy,
  main,
});

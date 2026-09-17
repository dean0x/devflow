#!/usr/bin/env node
// src/assets/scripts/redact-secrets.cjs
//
// Comment-sink secret scrubber (I06 fix, Phase A).
// Strips secrets from text before they reach PR comments or other sinks.
// Installed as a top-level sibling of hud.sh under ~/.devflow/scripts/.
//
// Usage: node redact-secrets.cjs <input-file> <output-file>
//        node redact-secrets.cjs --emit <input-file>
//
// The two modes exist because their sinks differ, not for convenience.
//   <in> <out>  FILE sink. The caller gates the post with a shell `&&` chain and
//               passes the scrubbed FILE to `--body-file`.
//   --emit      TOOL-CALL sink (GAP-04). A tracker reached through a tool call has
//               no `--body-file` and no shell operator between the scrub and the
//               post, so the `&&` gate cannot exist. Instead the scrubbed bytes
//               are printed behind a framing line only this script can produce:
//                 D11-OK <nonce> <sha256> <bytes> <n> [type:count,…]
//                 <the scrubbed body>
//               A body with no framing line above it is a body that was never
//               scrubbed. No failure ever writes body bytes: a failure the mode
//               owns is EXACTLY `D11-FAIL <reason>` and nothing else, and the two
//               that precede or escape mode selection — a usage error and an
//               internal error — leave stdout entirely EMPTY. The consumer gates
//               on the presence of `D11-OK`, so all three are one case to it.
//
// Exit codes:
//   0  success (zero or more redactions made)
//   1  usage error (wrong arity, or an unrecognised flag)
//   2  input file unreadable or larger than 1 MiB
//   3  output file write failed
//   4  internal / unexpected error
//   5  --emit only: the gate refused — the second scrub pass was non-zero, or a
//      nonce could not be generated. Distinct from 4 so a caller can tell "the
//      scrub did not hold" from "the script broke": the first means the body must
//      not be posted, the second means the run must be retried.
//
// Design constraints (binding):
//   PF-011  writes via temp-sibling + rename (atomic same-fs write; readers see
//           old-or-new, never a momentarily absent file)
//   PF-014  never call process.exit() inside any scope with pending cleanup or
//           buffered output; main() returns an exit code; the single top-level
//           boundary writes stdout SYNCHRONOUSLY then sets process.exitCode so
//           nothing is truncated and no finally block is skipped
//   PF-018  all regexes are bounded (no unbounded [\s\S]*); skip-list checked
//           before any replacement; the unterminated-header pattern uses a
//           character class instead of a lazy quantifier for bounded scan
//   PF-023  self-contained sink-side control — never assumes upstream masking
//           happened; the scrubber is authoritative for its own rule set

'use strict';

const fs = require('fs');
// Genuinely new in P3a-S11: no hashing or randomness helper exists anywhere else
// under src/assets/scripts. frameEmit is the ONLY consumer.
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed input size in bytes (1 MiB). */
const MAX_INPUT_BYTES = 1048576;

/**
 * Nonce width, in hex characters (16 random bytes).
 *
 * The nonce is per-invocation and REQUIRED (§14.9-3). Composed bodies contain
 * untrusted issue and comment text, so a fixed `D11-OK` literal would be
 * forgeable by anyone who can write an issue comment: they would paste a framing
 * line into the body, and a consumer reading "the bytes after the D11-OK line"
 * would post the attacker's half.
 *
 * Exported so the framing grammar's guard pins its width from here rather than
 * from a retyped number.
 */
const NONCE_HEX_CHARS = 32;

/** The `SCRUB: ` prefix — one spelling, shared by formatScrubLine and frameEmit. */
const SCRUB_LINE_PREFIX = 'SCRUB: ';

/** The exact text a clean pass produces. The second pass returning THIS is the gate. */
const ZERO_SCRUB_LINE = SCRUB_LINE_PREFIX + '0 []';

/**
 * Every reason that may follow `D11-FAIL `.
 *
 * Bare lowercase tokens, never prose and never a path: stdout is read back by an
 * agent and pasted into reports, so a reason carrying a tmpdir path or input
 * bytes would travel with it. The human-readable diagnosis goes to stderr, which
 * no recipe forwards.
 *
 * A closed registry rather than inline strings, for the reason
 * compliance-compose.ts states about its token tables: a guard asserts the shape
 * of every entry, and an entry added inline would not be covered by it.
 */
const D11_FAIL_REASONS = Object.freeze({
  INPUT_UNREADABLE: 'input-unreadable',
  INPUT_TOO_LARGE: 'input-too-large',
  OUTPUT_UNWRITABLE: 'output-unwritable',
  SECOND_PASS_NONZERO: 'second-pass-nonzero',
  NONCE_UNAVAILABLE: 'nonce-unavailable',
});

// No `internal-error` reason: the internal-error path is the top-level catch, which
// fires BEFORE the boundary has written anything and knows no mode, so it leaves
// stdout empty rather than framing a reason. Adding the token without an arm that
// can emit it would put a value in a closed registry that nothing reaches.

// ---------------------------------------------------------------------------
// Shannon entropy
// Bounded by string length; O(n) time, O(distinct-chars) space.
// ---------------------------------------------------------------------------

/**
 * @param {string} s
 * @returns {number}
 */
function shannonEntropy(s) {
  if (s.length === 0) return 0;
  /** @type {Record<string, number>} */
  const freq = Object.create(null);
  for (const ch of s) {
    freq[ch] = (freq[ch] ?? 0) + 1;
  }
  let h = 0;
  const len = s.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    h -= p * Math.log2(p);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Skip-list
// Returns true when a candidate match must NOT be redacted.
// Applied before every replacement to guard against false positives.
// ---------------------------------------------------------------------------

/**
 * A marker this script's own passes write. The slug vocabulary is lowercase and
 * hyphenated, so the class is bounded and the pattern cannot span two markers.
 */
const REDACTION_MARKER_RE = /\[REDACTED:[a-z][a-z-]{1,38}\]/g;

/**
 * @param {string} candidate  The matched text (or value portion) to test.
 * @returns {boolean}
 */
function shouldSkip(candidate) {
  // Idempotency guard, marker-STRIPPED rather than contains-based (GAP-54).
  //
  // A value this script already produced is markers and whitespace and nothing
  // else, so removing them leaves nothing and the value is skipped — which is
  // what keeps the second pass at zero and the `--emit` gate open. Bytes that
  // SURVIVE the strip are not this script's output: `[REDACTED:` is a literal
  // anyone can type into an issue comment, and a contains-check let one disarm
  // rule 8 — the only generic `key = value` rule — for the whole line. An
  // anchored check cannot serve here either: a value holding two markers would
  // fail it, the second pass could never return zero, and the gate would refuse
  // every body.
  if (candidate.replace(REDACTION_MARKER_RE, '').trim() === '') return true;

  // Environment variable references (value is not the secret itself)
  if (candidate.includes('process.env.')) return true;
  if (candidate.includes('os.environ')) return true;

  // Template / shell variable references (bounded alternation, no ReDoS risk).
  //
  // ANCHORED, both ends (GAP-54). These four skips exist to keep AUTHOR fixtures
  // readable — `api_key = "${DEPLOY_KEY}"` is documentation, not a credential. A
  // value that merely CONTAINS a placeholder is a different thing: `api_key =
  // "<ref> a8Kd91jZx0Qw7Lp2Vn"` would disarm rule 8 — the only generic
  // `key = value` rule — and provider-rendered bodies and remote issue text are
  // exactly what flows into a composed comment sink. So the skip fires only when
  // the value IS the placeholder and nothing else.
  if (/^\$\{[^}]{0,300}\}$/.test(candidate)) return true;      // ${VAR}
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) return true; // $VAR
  if (/^\{\{[^}]{0,300}\}\}$/.test(candidate)) return true;    // {{ template }}
  if (/^<[^>]{0,300}>$/.test(candidate)) return true;          // <placeholder>

  // Keyword / low-entropy values that are never real secrets
  if (/^(null|undefined|true|false|none|changeme|example)$/i.test(candidate)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Replace callback factory
//
// Returns a replacement function for String.prototype.replace that applies
// shouldSkip, increments counts[slug], and returns the canonical marker.
// Used by all pattern-matched rules (1a–7) to eliminate repeated boilerplate.
// ---------------------------------------------------------------------------

/**
 * @param {string} slug  Rule identifier used in the redaction marker and counts key.
 * @param {Record<string, number>} counts  Shared redaction count map from scrub().
 * @returns {(match: string) => string}
 */
function makeRedactor(slug, counts) {
  return (match) => {
    if (shouldSkip(match)) return match;
    counts[slug] = (counts[slug] || 0) + 1;
    return '[REDACTED:' + slug + ']';
  };
}

// ---------------------------------------------------------------------------
// Helpers for the secret-assignment rule
// ---------------------------------------------------------------------------

/** Key names that suggest the assignment holds a secret value. */
const SECRET_KEY_RE = /(secret|token|password|passwd|api[_-]?key|private[_-]?key|credential|auth)/i;

/**
 * Returns true when s contains at least one letter AND at least one digit.
 * Used as a proxy for "looks like a random/generated secret" rather than a
 * human-readable word.
 *
 * @param {string} s
 * @returns {boolean}
 */
function hasMixedAlphanumerics(s) {
  return /[A-Za-z]/.test(s) && /[0-9]/.test(s);
}

// ---------------------------------------------------------------------------
// Scrubbing pass
//
// Rules are applied in the declared order. Each rule uses a bounded regex to
// avoid catastrophic backtracking (PF-018). The final secret-assignment rule
// operates line-by-line and applies entropy + character-class heuristics to
// avoid false positives on config references.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ result: string; counts: Record<string, number> }} ScrubResult
 */

/**
 * Apply all redaction rules to content and return the scrubbed string plus a
 * per-slug redaction count map.
 *
 * @param {string} content
 * @returns {ScrubResult}
 */
function scrub(content) {
  /** @type {Record<string, number>} */
  const counts = Object.create(null);

  let result = content;

  // ------------------------------------------------------------------
  // Rule 1a: private-key — complete PEM block
  //
  // Lazy quantifier {0,20000}? bounds the body scan; the regex can consume
  // at most 20 000 body characters per match, preventing ReDoS on
  // pathological inputs.
  // ------------------------------------------------------------------
  result = result.replace(
    /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]{0,20000}?-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----/g,
    makeRedactor('private-key', counts),
  );

  // ------------------------------------------------------------------
  // Rule 1b: private-key — unterminated BEGIN header
  //
  // Runs AFTER the complete-block rule so a matched pair is consumed by
  // 1a first. Uses [^\r\n]* (single-line suffix) to stay on the header
  // line — no multi-line scan, no quantifier for the body.
  // ------------------------------------------------------------------
  result = result.replace(
    /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[^\r\n]*/g,
    makeRedactor('private-key', counts),
  );

  // ------------------------------------------------------------------
  // Rule 2: github-pat
  // ------------------------------------------------------------------
  result = result.replace(
    /github_pat_[A-Za-z0-9_]{20,}/g,
    makeRedactor('github-pat', counts),
  );

  // ------------------------------------------------------------------
  // Rule 3: github-token  (ghp_ / gho_ / ghu_ / ghs_ / ghr_)
  // ------------------------------------------------------------------
  result = result.replace(
    /gh[pousr]_[A-Za-z0-9]{20,}/g,
    makeRedactor('github-token', counts),
  );

  // ------------------------------------------------------------------
  // Rule 4: aws-key  (AKIA… / ASIA…)
  // ------------------------------------------------------------------
  result = result.replace(
    /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
    makeRedactor('aws-key', counts),
  );

  // ------------------------------------------------------------------
  // Rule 5: slack-token  (xoxb- / xoxa- / xoxp- / xoxr- / xoxs-)
  // ------------------------------------------------------------------
  result = result.replace(
    /xox[abprs]-[A-Za-z0-9-]{10,}/g,
    makeRedactor('slack-token', counts),
  );

  // ------------------------------------------------------------------
  // Rule 6: api-key  (sk- or sk-ant-)
  // ------------------------------------------------------------------
  result = result.replace(
    /sk-(ant-)?[A-Za-z0-9_-]{16,}/g,
    makeRedactor('api-key', counts),
  );

  // ------------------------------------------------------------------
  // Rule 7: google-api-key  (AIza…)
  // ------------------------------------------------------------------
  result = result.replace(
    /AIza[A-Za-z0-9_-]{35}/g,
    makeRedactor('google-api-key', counts),
  );

  // ------------------------------------------------------------------
  // Rule 8 (LAST): secret-assignment — line-scoped
  //
  // Matches lines of the form:
  //   KEY = "value"   KEY: "value"   KEY="value"   KEY='value'
  //   KEY = value     (unquoted — captured with no close-quote backreference)
  //
  // The prefix tolerates the shapes a quoted code excerpt actually arrives in:
  // leading indentation, up to three declarator keywords (`export const …`), a
  // quoted key (`"api_key": …`), and dotted/hyphenated key names
  // (`this.apiToken`, `api-key`). Without these the rule only ever fired on a
  // bare column-0 assignment, which is the rarest form inside a review finding.
  // The declarator group is bounded {0,3} and each iteration must consume a
  // literal keyword, so the added alternation cannot backtrack (PF-018).
  //
  // Conditions for replacement (all must hold):
  //   (a) The KEY matches SECRET_KEY_RE — not merely the line, so a prose line
  //       that happens to mention "credential" (`Fix: rotate the credential …`)
  //       is never treated as an assignment
  //   (b) The value is ≥ 16 characters with no embedded quotes or newlines
  //   (c) shouldSkip(value) is false
  //   (d) Shannon entropy of the value ≥ 3.5
  //   (e) The value contains both at least one letter and at least one digit
  //
  // Only the VALUE is replaced; indentation, key name, separator, and quote
  // chars are preserved exactly.
  // ------------------------------------------------------------------
  const ASSIGN_RE =
    /^([ \t]*(?:(?:const|let|var|export|public|private|protected|static|final|readonly)[ \t]+){0,3}["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?[ \t]*[:=][ \t]*)(['"]?)([^\r\n'"]{16,})\3(.*)$/;

  const lines = result.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Quick pre-filter: skip lines without a secret-ish keyword (perf)
    if (!SECRET_KEY_RE.test(line)) continue;
    const m = ASSIGN_RE.exec(line);
    if (!m) continue;
    const prefix = m[1];
    const key = m[2];
    const openQuote = m[3];
    const value = m[4];
    const trailing = m[5];
    // The KEY carries the signal — a prose line merely mentioning a secret keyword is not an assignment
    if (!SECRET_KEY_RE.test(key)) continue;
    if (shouldSkip(value)) continue;
    if (shannonEntropy(value) < 3.5) continue;
    if (!hasMixedAlphanumerics(value)) continue;
    counts['secret-assignment'] = (counts['secret-assignment'] || 0) + 1;
    lines[i] = prefix + openQuote + '[REDACTED:secret-assignment]' + openQuote + trailing;
  }
  result = lines.join('\n');

  return { result, counts };
}

// ---------------------------------------------------------------------------
// SCRUB stdout line formatter
//
// Format: "SCRUB: N [slug1:count1,slug2:count2]"
// Zero-redaction case: "SCRUB: 0 []"
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, number>} counts
 * @returns {string}
 */
function formatScrubLine(counts) {
  const entries = Object.entries(counts);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const parts = entries.map(([slug, n]) => slug + ':' + n);
  return SCRUB_LINE_PREFIX + total + ' [' + parts.join(',') + ']';
}

// ---------------------------------------------------------------------------
// [DR-14] Three pure helpers, and main() is a dispatcher over them
//
// Without this split main() would parse arguments, run two scrub passes,
// generate randomness, hash, manage a temp-file lifecycle, select between two
// output framings and choose among four exit codes — nine responsibilities in
// the D11 sink for every provider, with the only structural mitigation being
// boundary-scoped. Each helper below is also the ONLY way to reach one arm:
// parseArgs is observable without a subprocess, and the nonce-failure arm is
// reachable through injection and through nothing else.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ kind: 'emit', inputPath: string }} EmitArgs
 * @typedef {{ kind: 'file', inputPath: string, outputPath: string }} FileArgs
 * @typedef {{ kind: 'usage', usage: string }} UsageError
 */

/**
 * Parse argv into a mode and its positionals.
 *
 * THE FLAG IS READ BEFORE THE POSITIONALS ARE BOUND, so `--emit` can never bind
 * as a FILENAME and die at statSync with exit 2 — reporting "your input is
 * missing" for what is actually an unsupported flag.
 *
 * `kind` is the DISCRIMINANT, and main() dispatches on it alone. The three
 * shapes also differ in which fields they carry, but reading the mode off field
 * presence makes a renamed field — or a fourth shape — resolve to an existing
 * arm instead of failing, and the arms differ in whether the scrubbed body
 * reaches stdout.
 *
 * Arity is exact in both modes. A third positional is a usage error rather than
 * an ignored argument: `--emit in out` is a caller who believes they are writing
 * a file, and silently printing the body to stdout instead would put a scrubbed
 * comment body into a terminal log they never read.
 *
 * @param {string[]} argv  process.argv
 * @returns {EmitArgs | FileArgs | UsageError}
 */
function parseArgs(argv) {
  const FILE_USAGE = 'Usage: node redact-secrets.cjs <input-file> <output-file>';
  const EMIT_USAGE = 'Usage: node redact-secrets.cjs --emit <input-file>';

  let emit = false;
  /** @type {string[]} */
  const positionals = [];
  for (const arg of argv.slice(2)) {
    if (arg === '--emit') {
      emit = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        kind: 'usage',
        usage: 'redact-secrets: unrecognised flag ' + arg + '\n' + FILE_USAGE + '\n' + EMIT_USAGE,
      };
    }
    positionals.push(arg);
  }

  if (emit) {
    if (positionals.length !== 1) return { kind: 'usage', usage: EMIT_USAGE };
    return { kind: 'emit', inputPath: positionals[0] };
  }
  if (positionals.length !== 2) return { kind: 'usage', usage: FILE_USAGE };
  return { kind: 'file', inputPath: positionals[0], outputPath: positionals[1] };
}

/**
 * Scrub, then scrub the RESULT again.
 *
 * The second pass is the gate: it re-scrubs what the first pass produced, so a
 * zero second count is evidence that the first pass left nothing behind. Passing
 * the ORIGINAL content twice would find the same secrets again and the gate would
 * never open — the one wiring mistake that turns the whole mode off, which is why
 * a test pins which content the second call receives.
 *
 * Nearly free: idempotency is already pinned by shouldSkip's marker-stripped
 * skip, which passes over a value that is this script's own output.
 *
 * @param {string} content
 * @param {(c: string) => ScrubResult} [scrubFn]  Injectable so the refusal arm is
 *   provable without a pathological fixture — the real rules ARE idempotent, so
 *   no input reaches a non-zero second pass.
 * @returns {{ text: string, first: Record<string, number>, second: Record<string, number> }}
 */
function scrubTwice(content, scrubFn) {
  const doScrub = scrubFn || scrub;
  const first = doScrub(content);
  const second = doScrub(first.result);
  return { text: first.result, first: first.counts, second: second.counts };
}

/** Default nonce source: 16 CSPRNG bytes as lowercase hex. */
function defaultNonceSource() {
  return crypto.randomBytes(NONCE_HEX_CHARS / 2).toString('hex');
}

/**
 * Build the `D11-OK` framing line for a scrubbed body.
 *
 * The line carries four facts, and each answers a specific way the channel can
 * fail between this process's stdout and the tool call that posts the body:
 *   <nonce>   per-invocation, so the line cannot be forged from inside the body;
 *   <sha256>  identifies these exact bytes;
 *   <bytes>   [DR-06] the UTF-8 byte length, so a consumer can detect a
 *             harness-TRUNCATED result. Truncation keeps line 1 intact, so a bare
 *             "no framing line ⇒ do not post" gate passes while the body is
 *             partial — a guard that appears to work while failing;
 *   <n> […]   [DR-01] the FIRST pass's count and per-type payload. The second
 *             pass is always zero by construction, so without this the only
 *             signal that a real credential was present is computed and discarded,
 *             and the user is never told to rotate it.
 *
 * formatScrubLine stays the sole producer of the `N [type:count,…]` text; this
 * embeds it by stripping the shared prefix rather than re-deriving the format.
 *
 * @param {string} scrubbed  The scrubbed body.
 * @param {string} scrubLine The FIRST pass's formatScrubLine output.
 * @param {() => string} [nonceSource]
 * @returns {{ emitLine: string, body: string } | { error: string }}
 */
function frameEmit(scrubbed, scrubLine, nonceSource) {
  const source = nonceSource || defaultNonceSource;
  let nonce;
  try {
    nonce = source();
  } catch (/** @type {any} */ err) {
    return { error: 'nonce generation failed: ' + (err.code || err.message) };
  }
  if (typeof nonce !== 'string' || !new RegExp('^[0-9a-f]{' + NONCE_HEX_CHARS + '}$').test(nonce)) {
    // A short, empty or non-hex nonce is unforgeable-by-accident only; treating it
    // as usable would ship a framing line whose one security property is absent.
    return { error: 'nonce generation failed: malformed nonce' };
  }

  const sha256 = crypto.createHash('sha256').update(scrubbed, 'utf8').digest('hex');
  const bytes = Buffer.byteLength(scrubbed, 'utf8');
  const payload = scrubLine.startsWith(SCRUB_LINE_PREFIX)
    ? scrubLine.slice(SCRUB_LINE_PREFIX.length)
    : scrubLine;

  return {
    emitLine: 'D11-OK ' + nonce + ' ' + sha256 + ' ' + bytes + ' ' + payload,
    body: scrubbed,
  };
}

// ---------------------------------------------------------------------------
// main — returns an exit code (never calls process.exit() internally)
//
// PF-014: no process.exit() inside any scope that has pending cleanup or
// buffered output. main() returns a numeric code for error paths or an
// object {scrubLine} for the success path. The single top-level boundary
// writes stdout synchronously and sets process.exitCode — nothing is
// truncated and no finally block is skipped.
// ---------------------------------------------------------------------------

/**
 * Read the input, enforcing the size bound.
 *
 * Shared by both modes so the two cannot drift on what "unreadable" means. The
 * `message` is exactly the stderr text the file mode has always written — the
 * mode-specific part is only which stdout framing (if any) accompanies it.
 *
 * @param {string} inputPath
 * @returns {{ ok: true, content: string } | { ok: false, code: number, reason: string, message: string }}
 */
function readInput(inputPath) {
  let stat;
  try {
    stat = fs.statSync(inputPath);
  } catch (/** @type {any} */ err) {
    return {
      ok: false,
      code: 2,
      reason: D11_FAIL_REASONS.INPUT_UNREADABLE,
      message: 'redact-secrets: cannot stat input: ' + inputPath + ': ' + (err.code || err.message) + '\n',
    };
  }

  if (stat.size > MAX_INPUT_BYTES) {
    return {
      ok: false,
      code: 2,
      reason: D11_FAIL_REASONS.INPUT_TOO_LARGE,
      message: 'redact-secrets: input exceeds 1 MiB: ' + inputPath + '\n',
    };
  }

  try {
    return { ok: true, content: fs.readFileSync(inputPath).toString('utf8') };
  } catch (/** @type {any} */ err) {
    return {
      ok: false,
      code: 2,
      reason: D11_FAIL_REASONS.INPUT_UNREADABLE,
      message: 'redact-secrets: cannot read input: ' + inputPath + ': ' + (err.code || err.message) + '\n',
    };
  }
}

/**
 * The FILE-sink mode — byte-for-byte the behaviour that shipped before `--emit`.
 *
 * Deliberately calls `scrub` ONCE, not scrubTwice: the recipes, the Tracker
 * agent's write chain and every `gh` call depend on this path's exact stdout and
 * exit codes, and a second pass here would add a failure mode to a contract
 * nothing asked to change.
 *
 * @param {FileArgs} args
 * @param {string} content
 * @returns {number | { scrubLine: string }}
 */
function runFileMode(args, content) {
  const { result, counts } = scrub(content);

  // ---- atomic write (PF-011: temp-sibling + rename) ----
  const tmpPath = args.outputPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, result, 'utf8');
    fs.renameSync(tmpPath, args.outputPath);
  } catch (/** @type {any} */ err) {
    // Best-effort cleanup of the temp file; ignore errors (the temp may not exist)
    try { fs.unlinkSync(tmpPath); } catch (_) { /* intentionally ignored */ }
    process.stderr.write(
      'redact-secrets: cannot write output: ' + args.outputPath + ': ' + (err.code || err.message) + '\n',
    );
    return 3;
  }

  return { scrubLine: formatScrubLine(counts) };
}

/**
 * The TOOL-CALL-sink mode.
 *
 * Always returns an `{ emitLine, body, code }` triple, and `body` is `''` on
 * every non-zero code. That is what makes "no body on any non-zero exit" a
 * property of the type rather than a rule each arm has to remember: the boundary
 * writes `emitLine + '\n' + body` unconditionally, so a failing arm cannot emit a
 * body even by forgetting to suppress one.
 *
 * The scrubbed bytes are written to a per-invocation temp SIBLING of the input
 * before being printed, and the sibling is removed in the same function. Two
 * reasons: the PF-011 write discipline then has exactly one implementation in
 * this script rather than one per mode, and the recipes lose their `mktemp` and
 * their cleanup step — twelve call sites that each had to remember both, and had
 * no `rm` that ran on the failure paths. The name is PID- AND nonce-scoped
 * (fs-atomic.ts:40's rule, tightened): two agents scrubbing the same composed
 * body in parallel worktrees must not share a temp path, and unlike
 * fs-atomic.ts:44-49 there is no unlink-and-retry — a collision is a bug, not a
 * condition to recover from.
 *
 * @param {EmitArgs} args
 * @param {string} content
 * @param {{ scrubFn?: (c: string) => ScrubResult, nonceSource?: () => string }} deps
 * @returns {{ emitLine: string, body: string, code: number }}
 */
function runEmitMode(args, content, deps) {
  const { text, first, second } = scrubTwice(content, deps.scrubFn);

  // THE GATE. A non-zero second pass means the first pass did not hold, so the
  // body is not publishable and no amount of re-running changes that.
  const secondLine = formatScrubLine(second);
  if (secondLine !== ZERO_SCRUB_LINE) {
    process.stderr.write(
      'redact-secrets: second scrub pass was non-zero (' + secondLine + ') — refusing to emit\n',
    );
    return { emitLine: 'D11-FAIL ' + D11_FAIL_REASONS.SECOND_PASS_NONZERO, body: '', code: 5 };
  }

  const framed = frameEmit(text, formatScrubLine(first), deps.nonceSource);
  if (framed.error !== undefined) {
    process.stderr.write('redact-secrets: ' + framed.error + ' — refusing to emit\n');
    return { emitLine: 'D11-FAIL ' + D11_FAIL_REASONS.NONCE_UNAVAILABLE, body: '', code: 5 };
  }

  const nonce = framed.emitLine.split(' ')[1];
  const tmpPath = args.inputPath + '.' + process.pid + '.' + nonce + '.emit.tmp';
  try {
    fs.writeFileSync(tmpPath, framed.body, { encoding: 'utf8', mode: 0o600 });
  } catch (/** @type {any} */ err) {
    process.stderr.write(
      'redact-secrets: cannot write temp sibling: ' + tmpPath + ': ' + (err.code || err.message) + '\n',
    );
    return { emitLine: 'D11-FAIL ' + D11_FAIL_REASONS.OUTPUT_UNWRITABLE, body: '', code: 3 };
  } finally {
    // Unconditional: the sibling is scratch space for the write discipline, and a
    // scrubbed comment body left on disk is residue with the input's lifetime.
    try { fs.unlinkSync(tmpPath); } catch (_) { /* intentionally ignored */ }
  }

  return { emitLine: framed.emitLine, body: framed.body, code: 0 };
}

/**
 * @param {string[]} argv  process.argv
 * @param {{ scrubFn?: (c: string) => ScrubResult, nonceSource?: () => string }} [deps]
 *   Injected only by tests, and only to reach the two arms no fixture can: a
 *   non-idempotent scrub and an unavailable nonce. Defaulted here rather than at
 *   each use site so production has exactly one set of dependencies.
 * @returns {number | { scrubLine: string } | { emitLine: string, body: string, code: number }}
 */
function main(argv, deps) {
  const args = parseArgs(argv);
  if (args.kind === 'usage') {
    // The one failure that precedes mode selection, so no framing line can
    // describe it: stdout stays entirely empty and stderr carries the usage.
    process.stderr.write(args.usage + '\n');
    return 1;
  }

  const read = readInput(args.inputPath);
  if (!read.ok) {
    process.stderr.write(read.message);
    // Each mode owns the SHAPE of its refusal: the tool-call sink frames every
    // failure it can name, the file sink returns a bare code.
    return args.kind === 'emit'
      ? { emitLine: 'D11-FAIL ' + read.reason, body: '', code: read.code }
      : read.code;
  }

  return args.kind === 'emit'
    ? runEmitMode(args, read.content, deps || {})
    : runFileMode(args, read.content);
}

// ---------------------------------------------------------------------------
// Top-level boundary
//
// This is the ONLY place that writes to stdout and sets process.exitCode.
// No other code path may call process.exit() or write to stdout.
// (PF-014: single synchronous write, no pending cleanup, no buffered output)
//
// AMENDED for --emit, not bypassed. main()'s return widened from
// `number | {scrubLine}` to also carry `{emitLine, body, code}`, and the write
// became a TWO-BRANCH synchronous write — one branch per output shape. There are
// still exactly two process.stdout.write sites in this file, and a guard asserts
// that count: a third site is precisely how a body would reach stdout without
// passing the gate.
//
// The emit branch writes `emitLine + '\n' + body` UNCONDITIONALLY, because a
// failing emit result carries `body: ''` by construction. Suppressing the body
// here instead would put the "no body on failure" property in this block, where
// a future arm could forget it; putting it in the result keeps it a property of
// every arm that can produce one.
//
// Guarded by `require.main === module` so the pure helpers above are importable
// by their unit tests. Nothing else changes: `node redact-secrets.cjs …` still
// enters here, and the block is still the only exit-code and stdout authority.
// ---------------------------------------------------------------------------

if (require.main === module) {
  let exitCode = 0;
  let scrubLine = /** @type {string | null} */ (null);
  let emitted = /** @type {{ emitLine: string, body: string, code: number } | null} */ (null);

  try {
    const mainResult = main(process.argv);
    if (typeof mainResult === 'number') {
      exitCode = mainResult;
    } else if (mainResult.emitLine !== undefined) {
      emitted = /** @type {any} */ (mainResult);
      exitCode = emitted.code;
    } else {
      scrubLine = /** @type {any} */ (mainResult).scrubLine;
      exitCode = 0;
    }
  } catch (/** @type {any} */ err) {
    process.stderr.write('redact-secrets: internal error: ' + err.message + '\n');
    exitCode = 4;
  }

  // Synchronous stdout writes (must complete before process exits) — one per
  // output shape, and no third site anywhere in this file.
  if (emitted !== null) {
    process.stdout.write(emitted.emitLine + '\n' + emitted.body);
  } else if (scrubLine !== null) {
    process.stdout.write(scrubLine + '\n');
  }

  // Set exitCode (preferred over process.exit() — does not bypass event loop cleanup)
  process.exitCode = exitCode;
}

// ---------------------------------------------------------------------------
// Exports — for the unit tests of the pure helpers only [DR-14]
//
// parseArgs' behaviour is otherwise observable only end-to-end, and the
// nonce-failure arm is not observable at all: no argv and no fixture can make
// crypto.randomBytes fail. Exporting the helpers is what makes those two arms
// assertable instead of argued-from-construction.
// ---------------------------------------------------------------------------

module.exports = {
  NONCE_HEX_CHARS,
  ZERO_SCRUB_LINE,
  D11_FAIL_REASONS: Object.freeze(Object.values(D11_FAIL_REASONS)),
  shouldSkip,
  scrub,
  formatScrubLine,
  parseArgs,
  scrubTwice,
  frameEmit,
  main,
};

#!/usr/bin/env node
// src/assets/scripts/redact-secrets.cjs
//
// Comment-sink secret scrubber (I06 fix, Phase A).
// Strips secrets from text before they reach PR comments or other sinks.
// Installed as a top-level sibling of hud.sh under ~/.devflow/scripts/.
//
// Usage: node redact-secrets.cjs <input-file> <output-file>
//
// Exit codes:
//   0  success (zero or more redactions made)
//   1  usage error (wrong number of arguments)
//   2  input file unreadable or larger than 1 MiB
//   3  output file write failed
//   4  internal / unexpected error
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
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed input size in bytes (1 MiB). */
const MAX_INPUT_BYTES = 1048576;

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
 * @param {string} candidate  The matched text (or value portion) to test.
 * @returns {boolean}
 */
function shouldSkip(candidate) {
  // Idempotency guard: already-redacted markers are never re-matched
  if (candidate.includes('[REDACTED:')) return true;

  // Environment variable references (value is not the secret itself)
  if (candidate.includes('process.env.')) return true;
  if (candidate.includes('os.environ')) return true;

  // Template / shell variable references (bounded alternation, no ReDoS risk)
  if (/\$\{[^}]{0,300}\}/.test(candidate)) return true;   // ${VAR}
  if (/\$[A-Za-z_][A-Za-z0-9_]*/.test(candidate)) return true; // $VAR
  if (/\{\{[^}]{0,300}\}\}/.test(candidate)) return true; // {{ template }}
  if (/<[^>]{0,300}>/.test(candidate)) return true;        // <placeholder>

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
  return 'SCRUB: ' + total + ' [' + parts.join(',') + ']';
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
 * @param {string[]} argv  process.argv
 * @returns {number | { scrubLine: string }}
 */
function main(argv) {
  const inputPath = argv[2];
  const outputPath = argv[3];

  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: node redact-secrets.cjs <input-file> <output-file>\n');
    return 1;
  }

  // ---- stat input ----
  let stat;
  try {
    stat = fs.statSync(inputPath);
  } catch (/** @type {any} */ err) {
    process.stderr.write(
      'redact-secrets: cannot stat input: ' + inputPath + ': ' + (err.code || err.message) + '\n',
    );
    return 2;
  }

  if (stat.size > MAX_INPUT_BYTES) {
    process.stderr.write(
      'redact-secrets: input exceeds 1 MiB: ' + inputPath + '\n',
    );
    return 2;
  }

  // ---- read input ----
  let rawBuffer;
  try {
    rawBuffer = fs.readFileSync(inputPath);
  } catch (/** @type {any} */ err) {
    process.stderr.write(
      'redact-secrets: cannot read input: ' + inputPath + ': ' + (err.code || err.message) + '\n',
    );
    return 2;
  }

  // ---- scrub ----
  const content = rawBuffer.toString('utf8');
  const { result, counts } = scrub(content);

  // ---- atomic write (PF-011: temp-sibling + rename) ----
  const tmpPath = outputPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, result, 'utf8');
    fs.renameSync(tmpPath, outputPath);
  } catch (/** @type {any} */ err) {
    // Best-effort cleanup of the temp file; ignore errors (the temp may not exist)
    try { fs.unlinkSync(tmpPath); } catch (_) { /* intentionally ignored */ }
    process.stderr.write(
      'redact-secrets: cannot write output: ' + outputPath + ': ' + (err.code || err.message) + '\n',
    );
    return 3;
  }

  return { scrubLine: formatScrubLine(counts) };
}

// ---------------------------------------------------------------------------
// Top-level boundary
//
// This is the ONLY place that writes to stdout and sets process.exitCode.
// No other code path may call process.exit() or write to stdout.
// (PF-014: single synchronous write, no pending cleanup, no buffered output)
// ---------------------------------------------------------------------------

let exitCode = 0;
let scrubLine = /** @type {string | null} */ (null);

try {
  const mainResult = main(process.argv);
  if (typeof mainResult === 'number') {
    exitCode = mainResult;
  } else {
    scrubLine = mainResult.scrubLine;
    exitCode = 0;
  }
} catch (/** @type {any} */ err) {
  process.stderr.write('redact-secrets: internal error: ' + err.message + '\n');
  exitCode = 4;
}

// Synchronous stdout write (must complete before process exits)
if (scrubLine !== null) {
  process.stdout.write(scrubLine + '\n');
}

// Set exitCode (preferred over process.exit() — does not bypass event loop cleanup)
process.exitCode = exitCode;

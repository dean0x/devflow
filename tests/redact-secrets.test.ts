/**
 * tests/redact-secrets.test.ts
 *
 * RED suite for src/assets/scripts/redact-secrets.cjs — the comment-sink secret
 * scrubber (I06 fix, Phase A). This file is committed BEFORE the script exists;
 * every behavior-testing assertion fails because the script is absent and Node
 * exits non-zero.
 *
 * PF-018 compliance:
 *   - Every assertion is concrete (no typeof checks)
 *   - No assertion sits under a conditional
 *   - No try/catch wraps expectations
 *   - Corpus-scan tests assert the corpus is non-empty
 *
 * PF-023: the scrubber is the SINK-side control — tests verify it is self-contained
 * and never assumes upstream masking happened.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SCRIPT = path.resolve(import.meta.dirname, '../src/assets/scripts/redact-secrets.cjs');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RunResultWithContent extends RunResult {
  outputContent: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(inputPath: string, outputPath: string): RunResult {
  const result = spawnSync('node', [SCRIPT, inputPath, outputPath], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

/**
 * Write inputContent to a temp input file, run the scrubber, return the
 * run result plus the output file content ('' if the output file was not
 * created — the script failed). Uses a unique suffix per call to avoid
 * collision within the same tmpDir.
 */
function runWithContent(inputContent: string, tmpDir: string, suffix = 'output.txt'): RunResultWithContent {
  const inputPath = path.join(tmpDir, 'input.txt');
  const outputPath = path.join(tmpDir, suffix);
  fs.writeFileSync(inputPath, inputContent, 'utf8');
  const r = run(inputPath, outputPath);
  const outputContent = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  return { ...r, outputContent };
}

// ---------------------------------------------------------------------------
// Fixtures / lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-secrets-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Slug vocabulary — independent literal pin (PF-018 static declaration)
// Phase D cross-artifact check: a test inside describe('slug vocabulary')
// reads src/assets/agents/review.md and asserts every slug from EXPECTED_SLUGS
// appears in the ## Secret Handling in Findings section (commit 8 added it).
// ---------------------------------------------------------------------------

const EXPECTED_SLUGS: readonly string[] = [
  'private-key',
  'github-pat',
  'github-token',
  'aws-key',
  'slack-token',
  'api-key',
  'google-api-key',
  'secret-assignment',
];

describe('slug vocabulary', () => {
  it('pins the full slug set as an independent literal list (8 slugs)', () => {
    expect(EXPECTED_SLUGS).toEqual([
      'private-key',
      'github-pat',
      'github-token',
      'aws-key',
      'slack-token',
      'api-key',
      'google-api-key',
      'secret-assignment',
    ]);
    expect(EXPECTED_SLUGS).toHaveLength(8);
  });

  it('every expected slug appears in SCRUB stdout when all rule types are triggered', () => {
    // One fixture line per rule — ensures the slug list is non-vacuous against
    // the live script (PF-018: corpus is 8 lines, each triggering one slug).
    const multiFixture = [
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAtest1234567890abcdefghijklm\n-----END RSA PRIVATE KEY-----',
      'github_pat_' + 'A'.repeat(22),
      'ghp_' + 'B'.repeat(36),
      'AKIAIOSFODNN7EXAMPLE',
      'xoxb-devflow-test-abcdefghijklmnop',
      'sk-' + 'x'.repeat(48),
      'AIza' + 'G'.repeat(35),
      'API_SECRET = "x9J2mQ8vL4pR7wN3kT6y"',
    ].join('\n');

    const r = runWithContent(multiFixture, tmpDir, 'vocab-out.txt');
    expect(r.exitCode).toBe(0);

    // Parse slug names from SCRUB line — format: SCRUB: N [slug1:count1,slug2:count2]
    const scrubMatch = /^SCRUB: \d+ \[([^\]]*)\]$/.exec(r.stdout.trim());
    expect(scrubMatch).not.toBeNull();
    const seenSlugs = (scrubMatch as RegExpExecArray)[1]
      .split(',')
      .map((entry) => entry.split(':')[0])
      .filter(Boolean)
      .sort();

    const sortedExpected = [...EXPECTED_SLUGS].sort();
    expect(seenSlugs).toEqual(sortedExpected);
  });

  it('every expected slug appears in review.md § Secret Handling in Findings (cross-artifact pin)', () => {
    // Phase D cross-check: review.md now carries the vocabulary — pin it against EXPECTED_SLUGS.
    // Strongest check the content supports: all 8 slugs are listed individually in the section.
    const reviewPath = path.resolve(import.meta.dirname, '../src/assets/agents/review.md');
    const reviewContent = fs.readFileSync(reviewPath, 'utf-8');

    // Extract the § Secret Handling in Findings section (from heading to next ## heading)
    const sectionMarker = '## Secret Handling in Findings';
    const sectionStart = reviewContent.indexOf(sectionMarker);
    expect(sectionStart, `review.md is missing "${sectionMarker}" section`).toBeGreaterThan(-1);
    const nextSection = reviewContent.indexOf('\n## ', sectionStart + sectionMarker.length);
    const section = nextSection === -1 ? reviewContent.slice(sectionStart) : reviewContent.slice(sectionStart, nextSection);

    // Each slug from EXPECTED_SLUGS must appear in the section (non-vacuous: EXPECTED_SLUGS.length = 8)
    for (const slug of EXPECTED_SLUGS) {
      expect(section, `review.md § Secret Handling in Findings is missing slug "${slug}"`).toContain(slug);
    }

    // Also pin the masking scheme marker present in the section
    expect(section, 'review.md § Secret Handling in Findings missing [REDACTED: marker').toContain('[REDACTED:');
  });
});

// ---------------------------------------------------------------------------
// SCRUB stdout format
// ---------------------------------------------------------------------------

describe('SCRUB stdout format', () => {
  it('emits "SCRUB: 0 []" when no secrets are present', () => {
    const r = runWithContent('hello world, no secrets here\n', tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('SCRUB: 0 []');
  });

  it('emits "SCRUB: N [slug:count,...]" with correct total and per-slug counts', () => {
    // Two distinct AWS keys with clear word boundaries — expect aws-key:2 in the SCRUB line.
    // AKIAIOSFODNN7EXAMPLE2345 would NOT match because the digit after position-20 breaks \b;
    // using comma-separated keys instead to keep word boundaries unambiguous.
    const fixture = 'key1=AKIAIOSFODNN7EXAMPLE,key2=ASIA1234567890ABCDEF';
    const r = runWithContent(fixture, tmpDir);
    expect(r.exitCode).toBe(0);
    // Total is 2, aws-key:2 must appear
    expect(r.stdout.trim()).toBe('SCRUB: 2 [aws-key:2]');
  });
});

// ---------------------------------------------------------------------------
// Per-rule positives
// ---------------------------------------------------------------------------

describe('private-key rule', () => {
  it('redacts a complete PEM RSA private key block with [REDACTED:private-key]', () => {
    const fixture = [
      'Here is a key:',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0987654321+/==',
      '-----END RSA PRIVATE KEY-----',
      'end of file',
    ].join('\n');
    const r = runWithContent(fixture, tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.outputContent).toContain('[REDACTED:private-key]');
    expect(r.outputContent).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(r.stdout.trim()).toBe('SCRUB: 1 [private-key:1]');
  });

  it('redacts an unterminated BEGIN header (no END follows) with [REDACTED:private-key]', () => {
    const fixture = [
      'Unterminated key:',
      '-----BEGIN EC PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz',
      'no end marker follows',
    ].join('\n');
    const r = runWithContent(fixture, tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.outputContent).toContain('[REDACTED:private-key]');
    expect(r.outputContent).not.toContain('BEGIN EC PRIVATE KEY');
    expect(r.stdout.trim()).toBe('SCRUB: 1 [private-key:1]');
  });
});

describe('github-pat rule', () => {
  it('redacts github_pat_ token with [REDACTED:github-pat]', () => {
    const token = 'github_pat_' + 'A'.repeat(22);
    const fixture = `Authorization: Bearer ${token}`;
    const r = runWithContent(fixture, tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.outputContent).toContain('[REDACTED:github-pat]');
    expect(r.outputContent).not.toContain(token);
    expect(r.stdout.trim()).toBe('SCRUB: 1 [github-pat:1]');
  });
});

describe('github-token rule', () => {
  const prefixCases: Array<[string, string]> = [
    ['ghp_', 'ghp_' + 'B'.repeat(36)],
    ['gho_', 'gho_' + 'C'.repeat(36)],
    ['ghu_', 'ghu_' + 'D'.repeat(36)],
    ['ghs_', 'ghs_' + 'E'.repeat(36)],
    ['ghr_', 'ghr_' + 'F'.repeat(36)],
  ];

  for (const [prefix, token] of prefixCases) {
    it(`redacts ${prefix}… token with [REDACTED:github-token]`, () => {
      const fixture = `token: ${token}`;
      const r = runWithContent(fixture, tmpDir, `gh-${prefix}-out.txt`);
      expect(r.exitCode).toBe(0);
      expect(r.outputContent).toContain('[REDACTED:github-token]');
      expect(r.outputContent).not.toContain(token);
      expect(r.stdout.trim()).toBe('SCRUB: 1 [github-token:1]');
    });
  }
});

describe('aws-key rule', () => {
  it('redacts AKIA AWS access key with [REDACTED:aws-key]', () => {
    const key = 'AKIAIOSFODNN7EXAMPLE';
    const fixture = `aws_access_key_id = ${key}`;
    const r = runWithContent(fixture, tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.outputContent).toContain('[REDACTED:aws-key]');
    expect(r.outputContent).not.toContain(key);
    expect(r.stdout.trim()).toBe('SCRUB: 1 [aws-key:1]');
  });

  it('redacts ASIA STS key with [REDACTED:aws-key]', () => {
    const key = 'ASIA1234567890ABCDEF';
    const fixture = `access_key: ${key}`;
    const r = runWithContent(fixture, tmpDir, 'asia-out.txt');
    expect(r.exitCode).toBe(0);
    expect(r.outputContent).toContain('[REDACTED:aws-key]');
    expect(r.outputContent).not.toContain(key);
    expect(r.stdout.trim()).toBe('SCRUB: 1 [aws-key:1]');
  });
});

describe('slack-token rule', () => {
  const slackTokens = [
    'xoxb-devflow-test-abcdefghijklmnop',
    'xoxa-devflow-test-abcdefghijklmnop',
    'xoxp-devflow-test-abcdefghijklmnop',
    'xoxr-devflow-test-abcdefghijklmnop',
    'xoxs-devflow-test-abcdefghijklmnop',
  ] as const;

  for (const token of slackTokens) {
    it(`redacts ${token.slice(0, 5)}… with [REDACTED:slack-token]`, () => {
      const fixture = `SLACK_TOKEN=${token}`;
      const r = runWithContent(fixture, tmpDir, `slack-${token.slice(0, 4)}-out.txt`);
      expect(r.exitCode).toBe(0);
      expect(r.outputContent).toContain('[REDACTED:slack-token]');
      expect(r.outputContent).not.toContain(token);
      expect(r.stdout.trim()).toBe('SCRUB: 1 [slack-token:1]');
    });
  }
});

describe('api-key rule', () => {
  it('redacts sk-… key (OpenAI/generic style) with [REDACTED:api-key]', () => {
    const key = 'sk-' + 'x'.repeat(48);
    const fixture = `OPENAI_API_KEY=${key}`;
    const r = runWithContent(fixture, tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.outputContent).toContain('[REDACTED:api-key]');
    expect(r.outputContent).not.toContain(key);
    expect(r.stdout.trim()).toBe('SCRUB: 1 [api-key:1]');
  });

  it('redacts sk-ant-… key (Anthropic style) with [REDACTED:api-key]', () => {
    const key = 'sk-ant-' + 'A'.repeat(40);
    const fixture = `ANTHROPIC_API_KEY=${key}`;
    const r = runWithContent(fixture, tmpDir, 'ant-out.txt');
    expect(r.exitCode).toBe(0);
    expect(r.outputContent).toContain('[REDACTED:api-key]');
    expect(r.outputContent).not.toContain(key);
    expect(r.stdout.trim()).toBe('SCRUB: 1 [api-key:1]');
  });
});

describe('google-api-key rule', () => {
  it('redacts AIza… key with [REDACTED:google-api-key]', () => {
    const key = 'AIza' + 'G'.repeat(35);
    const fixture = `GOOGLE_API_KEY=${key}`;
    const r = runWithContent(fixture, tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.outputContent).toContain('[REDACTED:google-api-key]');
    expect(r.outputContent).not.toContain(key);
    expect(r.stdout.trim()).toBe('SCRUB: 1 [google-api-key:1]');
  });
});

describe('secret-assignment rule', () => {
  it('redacts only the value in an assignment, preserving key name and quoting', () => {
    const fixture = 'API_SECRET = "x9J2mQ8vL4pR7wN3kT6y"';
    const r = runWithContent(fixture, tmpDir);
    expect(r.exitCode).toBe(0);
    // Key and quotes must be preserved
    expect(r.outputContent).toContain('API_SECRET = "');
    expect(r.outputContent).toContain('[REDACTED:secret-assignment]');
    // Original value must not appear
    expect(r.outputContent).not.toContain('x9J2mQ8vL4pR7wN3kT6y');
    expect(r.stdout.trim()).toBe('SCRUB: 1 [secret-assignment:1]');
  });

  // A secret quoted in a review finding arrives as an EXCERPT of source, so it is
  // indented, declarator-prefixed, dotted or JSON-quoted — not as a bare column-0
  // assignment. Each shape below is a distinct prefix form the rule must reach.
  const assignmentShapes: Array<{ name: string; fixture: string; secret: string }> = [
    {
      name: 'indented const declaration (code excerpt inside a fence)',
      fixture: '  const apiSecret = "x9J2mQ8vL4pR7wN3kT6y";',
      secret: 'x9J2mQ8vL4pR7wN3kT6y',
    },
    {
      name: 'indented bare assignment',
      fixture: '    password = "hQ7vN2mK9pL4wR8t"',
      secret: 'hQ7vN2mK9pL4wR8t',
    },
    {
      name: 'quoted JSON key',
      fixture: '"api_key": "x9J2mQ8vL4pR7wN3kT6y",',
      secret: 'x9J2mQ8vL4pR7wN3kT6y',
    },
    {
      name: 'dotted member assignment',
      fixture: 'this.apiToken = "x9J2mQ8vL4pR7wN3kT6y"',
      secret: 'x9J2mQ8vL4pR7wN3kT6y',
    },
    {
      name: 'two declarator keywords (export const)',
      fixture: 'export const DB_PASSWORD = "hQ7vN2mK9pL4wR8t"',
      secret: 'hQ7vN2mK9pL4wR8t',
    },
    {
      name: 'hyphenated YAML key',
      fixture: 'api-key: x9J2mQ8vL4pR7wN3kT6y',
      secret: 'x9J2mQ8vL4pR7wN3kT6y',
    },
  ];

  for (const [idx, { name, fixture, secret }] of assignmentShapes.entries()) {
    it(`redacts the value in: ${name}`, () => {
      const r = runWithContent(fixture, tmpDir, `shape-${idx}.txt`);
      expect(r.exitCode).toBe(0);
      expect(r.outputContent).not.toContain(secret);
      expect(r.outputContent).toContain('[REDACTED:secret-assignment]');
      expect(r.stdout.trim()).toBe('SCRUB: 1 [secret-assignment:1]');
    });
  }

  it('preserves indentation and surrounding syntax exactly', () => {
    const r = runWithContent('  const apiSecret = "x9J2mQ8vL4pR7wN3kT6y";', tmpDir, 'shape-indent.txt');
    expect(r.exitCode).toBe(0);
    expect(r.outputContent).toBe('  const apiSecret = "[REDACTED:secret-assignment]";');
  });

  it('does not redact prose that merely mentions a secret keyword (key-scoped, not line-scoped)', () => {
    // The KEY must carry the signal. A review narrative line like this one has a
    // high-entropy, digit-bearing value and would be mangled by a line-scoped match.
    const fixture = '  Fix: use AWS Secrets Manager and rotate the key within 24 hours today';
    const r = runWithContent(fixture, tmpDir, 'prose-neg.txt');
    expect(r.exitCode).toBe(0);
    expect(r.outputContent).toBe(fixture);
    expect(r.stdout.trim()).toBe('SCRUB: 0 []');
  });

  it('declarator alternation does not backtrack — 50 KB of near-miss keywords completes within 2 seconds', () => {
    // `export export export … =` exercises the bounded {0,3} declarator group against
    // a line the regex can never complete a match on.
    const line = '  ' + 'export '.repeat(7_000) + 'password = ';
    expect(line.length, 'corpus is empty — guard is vacuous (PF-018)').toBeGreaterThan(49_000);

    const start = Date.now();
    const r = runWithContent(line, tmpDir, 'assign-adversarial.txt');
    const elapsed = Date.now() - start;

    expect(r.exitCode).toBe(0);
    expect(elapsed).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------
// Entropy negatives — must NOT be redacted; output byte-identical to input
// ---------------------------------------------------------------------------

describe('entropy negatives — must not be redacted', () => {
  const negatives: Array<{ name: string; fixture: string }> = [
    {
      name: 'process.env ref (security skill literal — exact form from SKILL.md)',
      fixture: 'const API_KEY = process.env.API_KEY;',
    },
    {
      name: 'os.environ ref',
      fixture: 'secret = os.environ["API_KEY"]',
    },
    {
      name: 'template variable ${API_KEY}',
      fixture: 'apiKey: "${API_KEY}"',
    },
    {
      name: 'bare shell variable $API_KEY',
      fixture: 'export TOKEN=$API_KEY',
    },
    {
      name: 'double-braces template {{ secrets.GITHUB_TOKEN }}',
      fixture: 'token: "{{ secrets.GITHUB_TOKEN }}"',
    },
    {
      name: 'angle-bracket placeholder <your-api-key>',
      fixture: 'api_key = "<your-api-key>"',
    },
    {
      name: 'low-entropy keyword: changeme',
      fixture: 'password = "changeme"',
    },
    {
      name: 'keyword value: null',
      fixture: 'token = "null"',
    },
    {
      name: 'keyword value: undefined',
      fixture: 'secret = "undefined"',
    },
    {
      name: 'keyword value: example',
      fixture: 'API_SECRET = "example"',
    },
  ];

  for (const [idx, { name, fixture }] of negatives.entries()) {
    it(`does not redact: ${name}`, () => {
      const r = runWithContent(fixture, tmpDir, `neg-${idx}.txt`);
      expect(r.exitCode).toBe(0);
      // Output must be byte-identical to input
      expect(r.outputContent).toBe(fixture);
      // Zero redactions
      expect(r.stdout.trim()).toBe('SCRUB: 0 []');
    });
  }
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('[REDACTED:…] tokens are never re-matched — double-run produces byte-identical output', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const fixture = `key = ${secret}`;

    // First run: redact the AWS key
    const firstInputPath = path.join(tmpDir, 'idempotent-input.txt');
    const firstOutputPath = path.join(tmpDir, 'idempotent-first.txt');
    fs.writeFileSync(firstInputPath, fixture, 'utf8');
    const r1 = run(firstInputPath, firstOutputPath);
    expect(r1.exitCode).toBe(0);
    const firstOutput = fs.readFileSync(firstOutputPath, 'utf8');
    expect(firstOutput).toContain('[REDACTED:aws-key]');
    expect(firstOutput).not.toContain(secret);

    // Second run: scrub the already-scrubbed output
    const secondOutputPath = path.join(tmpDir, 'idempotent-second.txt');
    const r2 = run(firstOutputPath, secondOutputPath);
    expect(r2.exitCode).toBe(0);
    const secondOutput = fs.readFileSync(secondOutputPath, 'utf8');

    // Must be byte-identical to the first run output
    expect(secondOutput).toBe(firstOutput);
    // Second run must report zero redactions
    expect(r2.stdout.trim()).toBe('SCRUB: 0 []');
  });
});

// ---------------------------------------------------------------------------
// No secret in stdout or stderr
// ---------------------------------------------------------------------------

describe('no secret in stdout or stderr', () => {
  it('stdout contains only the SCRUB counts line — known secret bytes are not echoed', () => {
    const knownSecret = 'AKIAIOSFODNN7EXAMPLE';
    const fixture = `aws key: ${knownSecret}\n`;
    const r = runWithContent(fixture, tmpDir);
    expect(r.exitCode).toBe(0);
    // stdout is exactly the counts line (no secret leakage)
    expect(r.stdout.trim()).toBe('SCRUB: 1 [aws-key:1]');
    expect(r.stdout).not.toContain(knownSecret);
    expect(r.stderr).not.toContain(knownSecret);
  });
});

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

describe('exit codes', () => {
  it('exits 0 on success with redactions', () => {
    const r = runWithContent('AKIAIOSFODNN7EXAMPLE\n', tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('SCRUB: 1 [aws-key:1]');
  });

  it('exits 0 on success with zero redactions', () => {
    const r = runWithContent('clean content, no secrets here\n', tmpDir, 'clean-out.txt');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('SCRUB: 0 []');
  });

  it('exits 1 on wrong argv count (no arguments)', () => {
    const result = spawnSync('node', [SCRIPT], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    // stdout must be empty on usage error (PF-018: concrete check)
    expect(result.stdout ?? '').toBe('');
  });

  it('exits 1 on wrong argv count (one argument)', () => {
    const result = spawnSync('node', [SCRIPT, '/tmp/one-arg-only'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout ?? '').toBe('');
  });

  it('exits 2 on unreadable input file (file does not exist)', () => {
    const nonexistentInput = path.join(tmpDir, 'does-not-exist.txt');
    const outputPath = path.join(tmpDir, 'output.txt');
    const result = run(nonexistentInput, outputPath);
    expect(result.exitCode).toBe(2);
  });

  it('exits 2 on input larger than 1 MiB (1048576 bytes)', () => {
    const largeInputPath = path.join(tmpDir, 'large.txt');
    // Write exactly 1 MiB + 1 byte to exceed the limit
    const buf = Buffer.alloc(1048577, 65); // 'A' * (1MiB + 1)
    fs.writeFileSync(largeInputPath, buf);
    const outputPath = path.join(tmpDir, 'large-out.txt');
    const result = run(largeInputPath, outputPath);
    expect(result.exitCode).toBe(2);
  });

  it('exits 3 on unwritable output path (parent directory does not exist)', () => {
    const inputPath = path.join(tmpDir, 'input-for-bad-output.txt');
    fs.writeFileSync(inputPath, 'clean content\n', 'utf8');
    const badOutputPath = path.join(tmpDir, 'nonexistent-dir', 'output.txt');
    const result = run(inputPath, badOutputPath);
    expect(result.exitCode).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// CRLF / non-ASCII round-trip
// ---------------------------------------------------------------------------

describe('CRLF and non-ASCII round-trip', () => {
  it('passes content with CRLF + emoji + CJK byte-identical when no secrets present', () => {
    const fixture = 'Hello\r\nWorld\r\n🎉 emoji 🌏\r\n日本語テスト\r\n';
    const r = runWithContent(fixture, tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.outputContent).toBe(fixture);
    expect(r.stdout.trim()).toBe('SCRUB: 0 []');
  });
});

// ---------------------------------------------------------------------------
// Adversarial backtracking budget (≤ 2 seconds wall-clock)
// ---------------------------------------------------------------------------

describe('adversarial backtracking budget', () => {
  it('pathological BEGIN…no-END input completes within 2 seconds', () => {
    // A long -----BEGIN header followed by ~100 KB of near-miss content with no END.
    // A catastrophically-backtracking regex would time out here.
    // The body is bounded at {0,20000} so this must complete in O(n) time.
    const header = '-----BEGIN RSA PRIVATE KEY-----\n';
    const nearMissBody = 'AAAA'.repeat(25_000) + '\n'; // ~100 KB

    // Assert the corpus is non-empty (PF-018)
    expect(nearMissBody.length).toBeGreaterThan(100_000);

    const fixture = header + nearMissBody;
    const start = Date.now();
    const r = runWithContent(fixture, tmpDir, 'adversarial-out.txt');
    const elapsed = Date.now() - start;

    expect(r.exitCode).toBe(0);
    expect(elapsed).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------
// P3a-S11 — `--emit`: the mechanical D11 gate for MCP sinks (AC-3.5)
// ---------------------------------------------------------------------------
//
// WHY A SECOND MODE EXISTS AT ALL (GAP-04). The file-sink gate is a shell `&&`
// chain: `redact-secrets.cjs raw scrubbed && gh issue comment --body-file scrubbed`.
// A tracker reached through a tool call has no `--body-file` and no shell operator
// between the scrub and the post, so the `&&` cannot exist — and an instruction
// ("remember to scrub first") is not a gate. `--emit` restores a mechanical one:
// the scrubbed bytes are only obtainable from a stdout framing line the script
// alone can produce, so a body with no framing line is a body that was never
// scrubbed.
//
// Three properties carry that claim, and each is asserted on EVERY path rather
// than argued from construction:
//   1. NO BODY ON ANY NON-ZERO EXIT. A partial body behind a gate that appears to
//      have run is worse than no gate.
//   2. THE NONCE IS PER-INVOCATION. Composed bodies contain untrusted issue text,
//      so a fixed `D11-OK` literal would be forgeable by anyone who can write an
//      issue comment (§14.9-3).
//   3. THE FIRST-PASS COUNT TRAVELS IN THE FRAMING [DR-01]. Without it the only
//      signal that a real credential was present is computed and thrown away, and
//      the user is never told to rotate it.
//
// The helpers are unit-tested through `require()` as well as end-to-end: flag
// parsing and the second-pass gate are observable ONLY end-to-end otherwise, and
// an end-to-end-only suite cannot reach the nonce-failure arm at all [DR-14].

const NODE_REQUIRE = createRequire(import.meta.url);

/** The script's exported pure helpers. Required once — the module is idempotent. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SCRUBBER: any = NODE_REQUIRE(SCRIPT);

interface EmitResult {
  /** stdout line 1 — the framing, without its newline. */
  framing: string;
  /** Everything after line 1 — the body, byte-exact. */
  body: string;
  stderr: string;
  exitCode: number;
  /** Raw stdout, for the "no body" assertions that must see every byte. */
  stdout: string;
}

/**
 * `run(in,out)`'s sibling for the emit mode (~6 lines, per §9's harness row),
 * plus the stdout split the framing contract requires.
 *
 * The split is at the FIRST newline only: the body may contain newlines, and a
 * `split('\n')` would silently drop every line after the first.
 */
function runEmit(inputPath: string, extraArgs: readonly string[] = []): EmitResult {
  const result = spawnSync('node', [SCRIPT, '--emit', inputPath, ...extraArgs], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  const stdout = result.stdout ?? '';
  const nl = stdout.indexOf('\n');
  return {
    framing: nl === -1 ? stdout : stdout.slice(0, nl),
    body: nl === -1 ? '' : stdout.slice(nl + 1),
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
    stdout,
  };
}

function writeInput(content: string, name = 'emit-input.txt'): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

/**
 * The framing grammar, §8.9 row 2. Anchored on both ends (§14.1: never `^A|B$`).
 * The nonce width is pinned from the script's own constant so the two cannot drift.
 */
const NONCE_HEX_CHARS: number = SCRUBBER.NONCE_HEX_CHARS;
const FRAMING_RE = new RegExp(
  `^D11-OK [0-9a-f]{${NONCE_HEX_CHARS}} [0-9a-f]{64} \\d+ \\d+ \\[[^\\]]*\\]$`,
);

describe('--emit: parseArgs (unit, no subprocess) [DR-14]', () => {
  it('parses the flag BEFORE the positionals', () => {
    // The bug this prevents: `main(argv)` read argv[2]/argv[3] positionally with
    // no flag handling, so `--emit` bound as a FILENAME and the run died at
    // statSync with exit 2 — a silent misdiagnosis of "your input is missing".
    expect(SCRUBBER.parseArgs(['node', 'script', '--emit', '/tmp/in'])).toEqual({
      emit: true,
      inputPath: '/tmp/in',
    });
  });

  it('accepts the flag in either position', () => {
    expect(SCRUBBER.parseArgs(['node', 'script', '/tmp/in', '--emit'])).toEqual({
      emit: true,
      inputPath: '/tmp/in',
    });
  });

  it('the two-positional form is unchanged', () => {
    expect(SCRUBBER.parseArgs(['node', 'script', '/tmp/in', '/tmp/out'])).toEqual({
      emit: false,
      inputPath: '/tmp/in',
      outputPath: '/tmp/out',
    });
  });

  it('refuses every wrong arity and every unknown flag, naming usage', () => {
    const WRONG: ReadonlyArray<readonly string[]> = [
      [],
      ['/tmp/in'],
      ['--emit'],
      ['--emit', '/tmp/in', '/tmp/out'],
      ['/tmp/a', '/tmp/b', '/tmp/c'],
      ['--unknown', '/tmp/in', '/tmp/out'],
      ['-e', '/tmp/in'],
    ];
    expect(WRONG.length, 'the arity corpus must be non-empty (PF-018)').toBeGreaterThan(0);
    const accepted: string[] = [];
    for (const args of WRONG) {
      const parsed = SCRUBBER.parseArgs(['node', 'script', ...args]);
      if (parsed.usage === undefined) accepted.push(JSON.stringify(args));
    }
    expect(accepted, `argv shape(s) accepted that must be a usage error: ${accepted.join(', ')}`)
      .toEqual([]);
  });

  it('a flag-looking input path is refused rather than silently treated as a file', () => {
    // `--emit --emit` and `--help` must not become filenames.
    expect(SCRUBBER.parseArgs(['node', 'script', '--help']).usage).toBeDefined();
  });
});

describe('--emit: scrubTwice — the gate [DR-14]', () => {
  it('a clean second pass is what "gated" means', () => {
    const r = SCRUBBER.scrubTwice('aws key: AKIAIOSFODNN7EXAMPLE\n');
    expect(r.text).toContain('[REDACTED:aws-key]');
    expect(SCRUBBER.formatScrubLine(r.first)).toBe('SCRUB: 1 [aws-key:1]');
    expect(
      SCRUBBER.formatScrubLine(r.second),
      'the SECOND pass returning zero IS the gate — it is what proves the first pass left nothing',
    ).toBe('SCRUB: 0 []');
  });

  it('the second pass is a re-scrub of the FIRST pass output, not of the input', () => {
    // A second pass over the original content would find the same secrets again
    // and the gate would never pass, so this is the one wiring mistake that turns
    // the whole mode off.
    const calls: string[] = [];
    const spy = (content: string) => {
      calls.push(content);
      return SCRUBBER.scrub(content);
    };
    const r = SCRUBBER.scrubTwice('aws key: AKIAIOSFODNN7EXAMPLE\n', spy);
    expect(calls).toHaveLength(2);
    expect(calls[1], 'the second pass must receive the first pass output').toBe(r.text);
  });

  it('known-bad probe: an injected non-idempotent scrub makes the second pass non-zero', () => {
    // The gate can only be shown live by injection: the real rules ARE idempotent
    // (`[REDACTED:` is a contains-skip), so no fixture reaches this arm.
    const hostile = (content: string) => ({
      result: content + '\nAKIAIOSFODNN7EXAMPLE',
      counts: { 'aws-key': 1 },
    });
    const r = SCRUBBER.scrubTwice('clean\n', hostile);
    expect(SCRUBBER.formatScrubLine(r.second)).not.toBe('SCRUB: 0 []');
  });
});

describe('--emit: frameEmit — nonce, digest, byte count and the first-pass payload [DR-01]', () => {
  it('embeds formatScrubLine’s payload rather than re-spelling the count text', () => {
    const scrubLine = SCRUBBER.formatScrubLine({ 'aws-key': 2, 'api-key': 1 });
    const framed = SCRUBBER.frameEmit('body bytes', scrubLine);
    expect(framed.emitLine).toMatch(FRAMING_RE);
    expect(
      framed.emitLine.endsWith('3 [aws-key:2,api-key:1]'),
      `the framing must carry the first-pass count and its [type:count,…] payload — without it a ` +
      `user whose issue body held a live credential is never told to rotate it [DR-01]. Got: ` +
      framed.emitLine,
    ).toBe(true);
    expect(framed.body).toBe('body bytes');
  });

  it('the <bytes> field is the body’s UTF-8 byte length, not its character count [DR-06]', () => {
    // The consumer verifies the received body against this number to detect a
    // harness-truncated Bash result. A character count would be wrong for exactly
    // the multi-byte bodies a Jira description carries.
    const body = 'héllo — ✓';
    const framed = SCRUBBER.frameEmit(body, 'SCRUB: 0 []');
    const bytes = Number(framed.emitLine.split(' ')[3]);
    expect(bytes).toBe(Buffer.byteLength(body, 'utf8'));
    expect(bytes, 'a character count would understate a multi-byte body').not.toBe(body.length);
  });

  it('the digest is sha256 of the body', () => {
    const body = 'deterministic body\n';
    const framed = SCRUBBER.frameEmit(body, 'SCRUB: 0 []');
    expect(framed.emitLine.split(' ')[2]).toBe(
      createHash('sha256').update(body, 'utf8').digest('hex'),
    );
  });

  it('a malformed or throwing nonce source is refused, never framed', () => {
    // Injected rather than mocked: this is the one failure arm no fixture and no
    // subprocess can reach, and an unreachable arm is an unasserted arm.
    for (const bad of [() => { throw new Error('entropy pool empty'); }, () => 'NOTHEX', () => '', () => 42]) {
      const framed = SCRUBBER.frameEmit('body', 'SCRUB: 0 []', bad as never);
      expect(framed.emitLine, `nonce source ${String(bad)} must not produce a framing`).toBeUndefined();
      expect(framed.error, 'the refusal must name itself').toContain('nonce');
    }
  });
});

describe('--emit: framing and body end-to-end (AC-3.5)', () => {
  it('stdout is the framing line then the scrubbed body, byte-exact', () => {
    const fixture = 'intro\naws key: AKIAIOSFODNN7EXAMPLE\ntail\n';
    const r = runEmit(writeInput(fixture));
    expect(r.exitCode, `emit should succeed.\n${r.stderr}`).toBe(0);
    expect(r.framing).toMatch(FRAMING_RE);
    expect(r.body).toBe(fixture.replace('AKIAIOSFODNN7EXAMPLE', '[REDACTED:aws-key]'));
    expect(r.body, 'the secret must not survive into the body').not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(r.framing, 'the framing line must never carry secret bytes')
      .not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('the framing carries the first-pass count, not the (always-zero) second-pass count [DR-01]', () => {
    const r = runEmit(writeInput('aws key: AKIAIOSFODNN7EXAMPLE\n'));
    expect(r.exitCode).toBe(0);
    expect(
      r.framing.endsWith(' 1 [aws-key:1]'),
      `the framing reported a zero count for a body that DID contain a credential — the rotation ` +
      `warning is then unreachable. Got: ${r.framing}`,
    ).toBe(true);
  });

  it('a body with no redactions still frames, with a zero payload', () => {
    const fixture = 'nothing secret here\n';
    const r = runEmit(writeInput(fixture));
    expect(r.exitCode).toBe(0);
    expect(r.framing.endsWith(' 0 []')).toBe(true);
    expect(r.body).toBe(fixture);
  });

  it('the nonce is per-invocation: two runs on identical input differ', () => {
    const p = writeInput('same bytes every time\n');
    const a = runEmit(p);
    const b = runEmit(p);
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    const nonceA = a.framing.split(' ')[1];
    const nonceB = b.framing.split(' ')[1];
    expect(nonceA).toMatch(new RegExp(`^[0-9a-f]{${NONCE_HEX_CHARS}}$`));
    expect(
      nonceA,
      'a stable nonce is a forgeable one: anyone who can write an issue comment could paste a ' +
      '`D11-OK <known nonce>` line into it and have it read as a scrub receipt (§14.9-3)',
    ).not.toBe(nonceB);
    // …while the digest, which is a function of the body alone, is stable.
    expect(a.framing.split(' ')[2]).toBe(b.framing.split(' ')[2]);
  });

  it('leaves no temp sibling behind', () => {
    const p = writeInput('body\n', 'cleanup-input.txt');
    expect(runEmit(p).exitCode).toBe(0);
    const residue = fs.readdirSync(tmpDir).filter(f => f !== 'cleanup-input.txt');
    expect(
      residue,
      'the emit path owns its own per-invocation temp sibling and must clean it up — the recipes ' +
      'have no `rm` step to do it for them',
    ).toEqual([]);
  });

  it('does not write the output-file positional form’s artifact (there is no output path)', () => {
    const p = writeInput('body\n', 'no-out-input.txt');
    runEmit(p);
    expect(fs.existsSync(p + '.tmp'), 'the --in/--out temp name must not be reused').toBe(false);
  });
});

describe('--emit: NO BODY on any non-zero exit (AC-3.5, §8.9 — every path)', () => {
  /** Every failure path, with the exit code it must produce. */
  function assertNoBody(label: string, r: EmitResult, expectedCode: number): void {
    expect(r.exitCode, `${label}: must exit ${expectedCode}.\n${r.stderr}`).toBe(expectedCode);
    expect(
      r.body,
      `${label}: stdout carried ${r.body.length} body byte(s) after a non-zero exit. A consumer ` +
      `that reads "everything after line 1" would post them.`,
    ).toBe('');
    expect(
      r.framing.startsWith('D11-FAIL '),
      `${label}: stdout line 1 must be exactly \`D11-FAIL <reason>\`, got: ${JSON.stringify(r.framing)}`,
    ).toBe(true);
    expect(r.framing, `${label}: a D11-OK line must never accompany a failure`).not.toContain('D11-OK');
  }

  it('missing input ⇒ exit 2, no body', () => {
    assertNoBody('missing input', runEmit(path.join(tmpDir, 'absent.txt')), 2);
  });

  it('input over 1 MiB ⇒ exit 2, no body', () => {
    const p = path.join(tmpDir, 'huge.txt');
    fs.writeFileSync(p, 'x'.repeat(1_048_577), 'utf8');
    assertNoBody('oversize input', runEmit(p), 2);
  });

  it('unwritable temp sibling ⇒ exit 3, no body', () => {
    // The sibling lands beside the input, so a read-only input directory is the
    // honest way to make the write fail without touching the input itself.
    const dir = fs.mkdtempSync(path.join(tmpDir, 'ro-'));
    const p = path.join(dir, 'in.txt');
    fs.writeFileSync(p, 'body\n', 'utf8');
    fs.chmodSync(dir, 0o500);
    try {
      assertNoBody('unwritable temp sibling', runEmit(p), 3);
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });

  it('usage error ⇒ exit 1, and stdout is entirely empty', () => {
    // The one failure that happens BEFORE the mode is known, so it cannot render a
    // D11-FAIL line — stdout must then be empty rather than partially framed.
    const result = spawnSync('node', [SCRIPT, '--emit'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout ?? '').toBe('');
  });

  it('non-zero second pass ⇒ exit 5, no body (injected)', () => {
    const p = writeInput('clean\n', 'second-pass.txt');
    const hostile = (content: string) => ({
      result: content + '\nAKIAIOSFODNN7EXAMPLE',
      counts: { 'aws-key': 1 },
    });
    const out = SCRUBBER.main(['node', SCRIPT, '--emit', p], { scrubFn: hostile });
    expect(out.code, 'a second pass that still finds a secret is exit 5').toBe(5);
    expect(out.body, 'no body may accompany a failed gate').toBe('');
    expect(out.emitLine).toBe('D11-FAIL second-pass-nonzero');
  });

  it('nonce generation failure ⇒ exit 5, no body (injected)', () => {
    const p = writeInput('clean\n', 'nonce-fail.txt');
    const out = SCRUBBER.main(['node', SCRIPT, '--emit', p], {
      nonceSource: () => { throw new Error('entropy pool empty'); },
    });
    expect(out.code).toBe(5);
    expect(out.body).toBe('');
    expect(out.emitLine).toBe('D11-FAIL nonce-unavailable');
  });

  it('every D11-FAIL reason is a bare token — no path, no secret, no prose', () => {
    // stdout is read back by an agent and pasted into reports; a reason carrying a
    // tmpdir path or input bytes would travel with it.
    for (const reason of SCRUBBER.D11_FAIL_REASONS as readonly string[]) {
      expect(reason, `"${reason}" must be a bare lowercase token`).toMatch(/^[a-z][a-z-]{2,39}$/);
    }
    expect(
      (SCRUBBER.D11_FAIL_REASONS as readonly string[]).length,
      'the reason registry must be non-empty',
    ).toBeGreaterThanOrEqual(4);
  });
});

describe('--emit: the single stdout boundary is amended, not bypassed (§8.9)', () => {
  const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

  /**
   * Named collector: every site that writes to stdout, comments excluded.
   *
   * Comments are stripped for the same reason as in collectProcessExitCalls
   * below: the boundary block's own normative prose NAMES `process.stdout.write`
   * while explaining why there may be only two of them, and a raw grep reports
   * the sentence that states the rule as a violation of it.
   */
  function collectStdoutWrites(source: string): string[] {
    return source
      .split('\n')
      .map(l => l.replace(/\/\/.*$/, '').replace(/\*.*$/, ''))
      .filter(line => /process\.stdout\.write/.test(line))
      .map(line => line.trim());
  }

  it('exactly two stdout write sites exist in the whole script', () => {
    const sites = collectStdoutWrites(SOURCE);
    expect(
      sites.length,
      `the normative boundary block is the ONLY place that writes stdout. A third site is how a ` +
      `body reaches stdout without passing the gate:\n  ${sites.join('\n  ')}`,
    ).toBe(2);
  });

  it('known-bad probe: a seeded third write site is reported by the same collector', () => {
    const seeded = SOURCE + '\nprocess.stdout.write(body);\n';
    expect(collectStdoutWrites(seeded).length).toBe(3);
  });

  it('the normative comment still says what it always said', () => {
    expect(
      SOURCE,
      'the boundary block’s normative sentence must survive the amendment verbatim — it is what ' +
      'tells the next author not to add a third write site',
    ).toContain('This is the ONLY place that writes to stdout and sets process.exitCode.');
  });

  /**
   * Named collector: real `process.exit(` CALLS, comments excluded.
   *
   * The comment exclusion is not convenience: the boundary block's own normative
   * sentence and the `process.exitCode` rationale both spell `process.exit()`, so
   * a raw grep reports the very prose that forbids it.
   */
  function collectProcessExitCalls(source: string): string[] {
    return source
      .split('\n')
      .map(l => l.replace(/\/\/.*$/, '').replace(/\*.*$/, ''))
      .filter(l => /process\.exit\s*\(/.test(l))
      .map(l => l.trim());
  }

  it('no code path calls process.exit() (PF-014 survives the amendment)', () => {
    const offenders = collectProcessExitCalls(SOURCE);
    expect(offenders, `process.exit() sites:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('known-bad probe: the same collector reports a seeded process.exit() call', () => {
    expect(collectProcessExitCalls(SOURCE + '\nprocess.exit(5);\n')).toEqual(['process.exit(5);']);
  });

  it('the exit-code header documents 5', () => {
    expect(SOURCE, 'a new exit code nobody documented is a code a caller cannot handle')
      .toMatch(/^\/\/\s+5\s+/m);
  });
});

describe('placeholder-skip narrowing (GAP-54)', () => {
  it('a value that merely CONTAINS a placeholder is still scrubbed', () => {
    // Before the narrowing, `<x>` anywhere in the value disarmed rule 8 — the only
    // generic `key = value` rule — and provider-rendered bodies and remote issue
    // text are exactly what newly flows into a composed comment.
    const fixture = 'api_key = "<ref> a8Kd91jZx0Qw7Lp2Vn"\n';
    const r = runWithContent(fixture, tmpDir, 'gap54-contains.txt');
    expect(r.exitCode).toBe(0);
    expect(
      r.outputContent,
      'a placeholder pasted next to a live credential must not defuse the rule',
    ).toContain('[REDACTED:secret-assignment]');
    expect(r.stdout.trim()).toBe('SCRUB: 1 [secret-assignment:1]');
  });

  it('a value that IS entirely a placeholder is still skipped', () => {
    const fixture = 'api_key = "${DEPLOY_API_KEY_VALUE}"\n';
    const r = runWithContent(fixture, tmpDir, 'gap54-anchored.txt');
    expect(r.exitCode).toBe(0);
    expect(r.outputContent, 'an author fixture must stay readable (PF-028)').toBe(fixture);
    expect(r.stdout.trim()).toBe('SCRUB: 0 []');
  });

  it('shouldSkip: anchored for placeholders, contains-based for [REDACTED: (unit)', () => {
    expect(SCRUBBER.shouldSkip('${VAR}')).toBe(true);
    expect(SCRUBBER.shouldSkip('<placeholder>')).toBe(true);
    expect(SCRUBBER.shouldSkip('{{ template }}')).toBe(true);
    expect(SCRUBBER.shouldSkip('$VAR')).toBe(true);
    expect(SCRUBBER.shouldSkip('<x> AKIAIOSFODNN7EXAMPLE')).toBe(false);
    expect(SCRUBBER.shouldSkip('${VAR} plus a real secret')).toBe(false);
    // Idempotency stays a CONTAINS check, or the double-run pin at :496-521 breaks.
    expect(
      SCRUBBER.shouldSkip('prefix [REDACTED:aws-key] suffix'),
      'narrowing the [REDACTED: check to an anchored match would re-match every marker and the ' +
      'second pass could never return zero — the gate would refuse every body',
    ).toBe(true);
  });
});

describe('--emit does not change the --in/--out mode (regression scope)', () => {
  it('the two-positional form still writes the file and prints only the SCRUB line', () => {
    const fixture = 'aws key: AKIAIOSFODNN7EXAMPLE\n';
    const r = runWithContent(fixture, tmpDir, 'unchanged.txt');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('SCRUB: 1 [aws-key:1]\n');
    expect(r.outputContent).toBe('aws key: [REDACTED:aws-key]\n');
  });

  it('the --in/--out mode never prints a framing line', () => {
    const r = runWithContent('clean\n', tmpDir, 'unchanged-clean.txt');
    expect(r.stdout, 'a D11-OK line on the file path would give two receipts for one contract')
      .not.toContain('D11-OK');
  });
});

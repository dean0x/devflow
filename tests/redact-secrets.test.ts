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

  for (const { name, fixture } of negatives) {
    it(`does not redact: ${name}`, () => {
      const r = runWithContent(fixture, tmpDir, `neg-${negatives.indexOf({ name, fixture })}.txt`);
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

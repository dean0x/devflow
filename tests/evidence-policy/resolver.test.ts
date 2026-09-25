/**
 * tests/evidence-policy/resolver.test.ts
 *
 * Suite for src/assets/scripts/resolve-evidence-policy.cjs — the plumbing script
 * that resolves EVIDENCE_POLICY from the default branch's .devflow/policy.json,
 * folds the worktree and compliance state in raise-only, and prints one framed
 * line plus the three mechanism inputs.
 *
 * Shape of the suite:
 *   - pure helpers through require() (parseArgs, parsePolicyBytes, complianceDefault,
 *     formatLine, serializePolicy and the exported grammars);
 *   - resolve() in-process with the scripted exec twin — the 40-row fold matrix,
 *     SOURCE/WARNINGS exhaustiveness, change detection, per-call bounds;
 *   - the real script as a subprocess with the scripted bash fakes on PATH — the
 *     argv log, injection tables, exit arms and the FIFO/ENOBUFS bounds;
 *   - real git against a local bare origin for the offline tracking-copy fold;
 *   - source guards over the script, each with a known-bad probe (PF-064).
 *
 * Every assertion is concrete and unconditional; every corpus scan asserts its
 * corpus is non-empty.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { normalizeComplianceFeature } from '../../src/core/compliance.js';
import {
  ARGV,
  RESOLVER_SCRIPT,
  buildScriptedShim,
  createFakeBin,
  makeFifo,
  realGit,
  runResolver,
  scenarioCalls,
  scriptedExec,
  type ExecFn,
  type FakeBin,
  type RunResult,
  type Scenario,
  type ScriptedCall,
} from './scripted-shim.js';

// ---------------------------------------------------------------------------
// The .cjs seam
//
// resolve-evidence-policy.cjs is plain CommonJS outside every tsconfig (PF-043,
// PF-069), so this interface is the only shape authority on this side. It is
// transcribed from the module's JSDoc typedefs — open those before changing it.
// ---------------------------------------------------------------------------

type Policy = 'required' | 'standard';
type Source = 'file' | 'worktree' | 'default' | 'invalid' | 'error';
type Warning = 'remote-unavailable' | 'invalid-file' | 'raised-by-compliance' | 'pr-changes-policy';

interface MechanismInputs {
  readonly ISSUE_REQUIRED: boolean;
  readonly APPLY_CONVENTIONS: boolean;
  readonly REQUIRE_NON_AUTHOR_APPROVAL: boolean;
}

interface Resolution {
  readonly policy: Policy;
  readonly source: Source;
  readonly ref: string;
  readonly warnings: readonly Warning[];
  readonly inputs: MechanismInputs;
}

type ParsedPolicy =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'valid'; readonly policy: Policy };

type ParsedArgs =
  | { readonly kind: 'resolve'; readonly dir: string }
  | { readonly kind: 'usage'; readonly usage: string };

interface MainOutcome {
  readonly code: number;
  readonly line: string;
}

interface ResolverModule {
  readonly POLICIES: readonly Policy[];
  readonly SOURCES: readonly Source[];
  readonly WARNINGS: readonly Warning[];
  readonly EXIT_CODES: Readonly<Record<string, number>>;
  readonly MECHANISM_INPUTS: Readonly<Record<Policy, MechanismInputs>>;
  readonly MAX_POLICY_BYTES: number;
  readonly SAFE_REF_RE: RegExp;
  readonly OUTPUT_LINE_RE: RegExp;
  readonly FAIL_CLOSED_LINE: string;
  parseArgs(argv: readonly string[]): ParsedArgs;
  parsePolicyBytes(buf: Uint8Array | null | undefined): ParsedPolicy;
  complianceDefault(raw: unknown): Policy;
  resolve(opts: { dir: string; compliance?: unknown }, deps?: { exec?: ExecFn }): Resolution;
  formatLine(r: Resolution): string;
  serializePolicy(policy: unknown): string | null;
  main(argv: readonly string[], deps?: { exec?: ExecFn; formatLine?: (r: Resolution) => unknown }): MainOutcome;
}

const NODE_REQUIRE = createRequire(import.meta.url);
const RESOLVER = NODE_REQUIRE(RESOLVER_SCRIPT) as ResolverModule;
/** The fs object the .cjs holds — the same builtin, so spies see its calls. */
const CJS_FS = NODE_REQUIRE('fs') as typeof import('fs');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BODY = {
  required: '{"version":1,"evidencePolicy":"required"}\n',
  standard: '{"version":1,"evidencePolicy":"standard"}\n',
  invalid: '{"version":1,"evidencePolicy":"REQUIRED"}\n',
} as const;

const DISABLED = { enabled: false, frameworks: [] as string[] };
/** Compliance enabled with ZERO frameworks — `required` by the orchestrator's binding decision. */
const ENABLED_ZERO = { enabled: true, frameworks: [] as string[] };

const LINE = {
  requiredInputs: 'ISSUE_REQUIRED=true APPLY_CONVENTIONS=true REQUIRE_NON_AUTHOR_APPROVAL=true',
  standardInputs: 'ISSUE_REQUIRED=false APPLY_CONVENTIONS=false REQUIRE_NON_AUTHOR_APPROVAL=false',
};

/**
 * Per-test budget for every describe block that spawns real subprocesses (the
 * script under node with the bash fakes, or real git). Alone each such test runs
 * well inside vitest's 5 s default, but under the full suite many workers spawn at
 * once and one node or git spawn can take seconds — the real-git rows (about ten
 * spawns each) timed out at 5 s there. Only the wall-clock budget changes; every
 * assertion is the same. Each spawn keeps its own bound (runResolver 30 s,
 * realGit 20 s), so a genuinely hung child still fails the test.
 */
const SUBPROCESS_TIMEOUT = { timeout: 20_000 } as const;

let tmp: string;
let home: string;
let root: string;

/** Static fakes, written once for the file: gh+git for scripted runs, gh alone for real-git runs. */
let binRoot: string;
let fakeBin: FakeBin;
let ghOnlyBin: FakeBin;

beforeAll(() => {
  binRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-evidence-bin-'));
  fakeBin = createFakeBin(binRoot);
  ghOnlyBin = createFakeBin(binRoot, ['gh']);
});

afterAll(() => {
  fs.rmSync(binRoot, { recursive: true, force: true });
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-evidence-policy-'));
  home = path.join(tmp, 'home');
  root = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });
  fs.mkdirSync(root, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function worktreePolicyPath(dir: string): string {
  return path.join(dir, '.devflow', 'policy.json');
}

function writeWorktree(dir: string, bytes: string | Buffer): void {
  fs.mkdirSync(path.join(dir, '.devflow'), { recursive: true });
  fs.writeFileSync(worktreePolicyPath(dir), bytes);
}

/** resolve() in-process. `compliance` is ALWAYS explicit, so no real manifest is read. */
function resolveWith(calls: readonly ScriptedCall[], compliance: unknown = DISABLED, dir = root): Resolution {
  const { exec } = scriptedExec(calls);
  return RESOLVER.resolve({ dir, compliance }, { exec });
}

/** The script as a subprocess with the scripted fakes on PATH. */
function e2e(
  calls: readonly ScriptedCall[],
  opts: { dir?: string; nodeArgs?: readonly string[]; extraEnv?: Record<string, string> } = {},
): RunResult & { log: string[][] } {
  const shim = buildScriptedShim(fakeBin, tmp, calls);
  const run = runResolver({
    home,
    args: [opts.dir ?? root],
    shim,
    nodeArgs: opts.nodeArgs,
    extraEnv: opts.extraEnv,
  });
  return { ...run, log: shim.readLog() };
}

/** stdout is exactly one `\n`-terminated line matching the exported grammar. */
function expectOneGrammarLine(stdout: string): string {
  expect(stdout.endsWith('\n'), `stdout must end in \\n: ${JSON.stringify(stdout)}`).toBe(true);
  const lines = stdout.split('\n');
  expect(lines.length, `stdout must be exactly one line: ${JSON.stringify(stdout)}`).toBe(2);
  expect(lines[0]).toMatch(RESOLVER.OUTPUT_LINE_RE);
  return lines[0];
}

/** Named collector: registry values that no driven arm produced. */
function collectUnreachable(registry: readonly (string | number)[], observed: readonly (string | number)[]): (string | number)[] {
  const seen = new Set(observed);
  return registry.filter(v => !seen.has(v));
}

/** Named collector: observed values that are not in the registry. */
function collectUnregistered(observed: readonly (string | number)[], registry: readonly (string | number)[]): (string | number)[] {
  const known = new Set(registry);
  return [...new Set(observed)].filter(v => !known.has(v));
}

function fieldOf(line: string, key: string): string {
  const m = new RegExp(`(?:^| )${key}=([^ ]*)`).exec(line);
  return m === null ? '' : m[1];
}

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

describe('module surface', () => {
  it('exports the frozen registries with the closed vocabularies', () => {
    expect(RESOLVER.POLICIES).toEqual(['required', 'standard']);
    expect(RESOLVER.SOURCES).toEqual(['file', 'worktree', 'default', 'invalid', 'error']);
    expect(RESOLVER.WARNINGS).toEqual([
      'remote-unavailable', 'invalid-file', 'raised-by-compliance', 'pr-changes-policy',
    ]);
    expect(RESOLVER.MAX_POLICY_BYTES).toBe(4096);
    for (const registry of [RESOLVER.POLICIES, RESOLVER.SOURCES, RESOLVER.WARNINGS, RESOLVER.EXIT_CODES]) {
      expect(Object.isFrozen(registry)).toBe(true);
    }
    expect(Object.isFrozen(RESOLVER)).toBe(true);
  });

  it('EXIT_CODES names 0, 1, 2, 4 and 5 — and never 3, which no arm emits', () => {
    const codes = Object.values(RESOLVER.EXIT_CODES).sort((a, b) => a - b);
    expect(codes).toEqual([0, 1, 2, 4, 5]);
    expect(codes).not.toContain(3);
  });

  it('MECHANISM_INPUTS is exactly three booleans, a pure function of the policy', () => {
    expect(RESOLVER.MECHANISM_INPUTS.required).toEqual({
      ISSUE_REQUIRED: true, APPLY_CONVENTIONS: true, REQUIRE_NON_AUTHOR_APPROVAL: true,
    });
    expect(RESOLVER.MECHANISM_INPUTS.standard).toEqual({
      ISSUE_REQUIRED: false, APPLY_CONVENTIONS: false, REQUIRE_NON_AUTHOR_APPROVAL: false,
    });
    expect(Object.keys(RESOLVER.MECHANISM_INPUTS).sort()).toEqual(['required', 'standard']);
    expect(Object.isFrozen(RESOLVER.MECHANISM_INPUTS)).toBe(true);
    expect(Object.isFrozen(RESOLVER.MECHANISM_INPUTS.required)).toBe(true);
    expect(Object.isFrozen(RESOLVER.MECHANISM_INPUTS.standard)).toBe(true);
  });

  it('FAIL_CLOSED_LINE is the required/error constant and satisfies its own grammar', () => {
    expect(RESOLVER.FAIL_CLOSED_LINE).toBe(
      `EVIDENCE_POLICY=required SOURCE=error REF=none ${LINE.requiredInputs}`,
    );
    expect(RESOLVER.FAIL_CLOSED_LINE).toMatch(RESOLVER.OUTPUT_LINE_RE);
  });
});

// ---------------------------------------------------------------------------
// The grammars (D-POLICY-LINE)
// ---------------------------------------------------------------------------

describe('OUTPUT_LINE_RE and SAFE_REF_RE', () => {
  const GOOD = `EVIDENCE_POLICY=required SOURCE=file REF=main WARN=invalid-file,pr-changes-policy ${LINE.requiredInputs}`;

  it('is anchored and flag-free (no g/y state for a consumer to trip on)', () => {
    expect(RESOLVER.OUTPUT_LINE_RE.source.startsWith('^')).toBe(true);
    expect(RESOLVER.OUTPUT_LINE_RE.source.endsWith('$')).toBe(true);
    expect(RESOLVER.OUTPUT_LINE_RE.flags).toBe('');
    expect(RESOLVER.SAFE_REF_RE.flags).toBe('');
  });

  it('accepts a full line with and without WARN, and every WARN token', () => {
    expect(GOOD).toMatch(RESOLVER.OUTPUT_LINE_RE);
    expect(`EVIDENCE_POLICY=standard SOURCE=default REF=none ${LINE.standardInputs}`).toMatch(RESOLVER.OUTPUT_LINE_RE);
    for (const w of RESOLVER.WARNINGS) {
      expect(`EVIDENCE_POLICY=required SOURCE=file REF=main WARN=${w} ${LINE.requiredInputs}`)
        .toMatch(RESOLVER.OUTPUT_LINE_RE);
    }
    for (const s of RESOLVER.SOURCES) {
      expect(`EVIDENCE_POLICY=required SOURCE=${s} REF=none ${LINE.requiredInputs}`).toMatch(RESOLVER.OUTPUT_LINE_RE);
    }
  });

  const BAD_LINES: ReadonlyArray<readonly [string, string]> = [
    ['a trailing space', `${GOOD} `],
    ['a trailing CR', `${GOOD}\r`],
    ['an embedded second line', `${GOOD}\nEVIDENCE_POLICY=standard`],
    ['an unknown policy', GOOD.replace('=required ', '=REQUIRED ')],
    ['an unknown source', GOOD.replace('SOURCE=file', 'SOURCE=remote')],
    ['an unknown WARN token', GOOD.replace('invalid-file', 'phantom')],
    ['an empty WARN', GOOD.replace('WARN=invalid-file,pr-changes-policy', 'WARN=')],
    ['a REF with ..', GOOD.replace('REF=main', 'REF=a..b')],
    ['a REF with a leading dash', GOOD.replace('REF=main', 'REF=-x')],
    ['a REF of 256 characters', GOOD.replace('REF=main', `REF=${'a'.repeat(256)}`)],
    ['a missing input', GOOD.replace(' REQUIRE_NON_AUTHOR_APPROVAL=true', '')],
    ['an extra field', `${GOOD} EXTRA=1`],
    ['reordered fields', GOOD.replace('SOURCE=file REF=main', 'REF=main SOURCE=file')],
    ['a non-boolean input', GOOD.replace('ISSUE_REQUIRED=true', 'ISSUE_REQUIRED=yes')],
  ];

  it.each(BAD_LINES)('rejects %s', (_label, line) => {
    expect(line).not.toMatch(RESOLVER.OUTPUT_LINE_RE);
  });

  it('SAFE_REF_RE admits branch names and refuses every hostile shape', () => {
    for (const ok of ['main', 'release/1.2', 'feature/361-x_y', 'a', 'a'.repeat(255), 'none']) {
      expect(ok, `should admit ${ok}`).toMatch(RESOLVER.SAFE_REF_RE);
    }
    for (const bad of ['', '-x', '.hidden', 'a..b', 'a b', 'a\nb', 'a'.repeat(256), 'a:b', 'a~1', 'a^', 'a@{0}', '/x']) {
      expect(bad, `should refuse ${JSON.stringify(bad)}`).not.toMatch(RESOLVER.SAFE_REF_RE);
    }
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults the directory to cwd and accepts one positional', () => {
    expect(RESOLVER.parseArgs(['node', 'script'])).toEqual({ kind: 'resolve', dir: process.cwd() });
    expect(RESOLVER.parseArgs(['node', 'script', '/some/dir'])).toEqual({ kind: 'resolve', dir: '/some/dir' });
  });

  it.each([
    ['a flag', ['--help']],
    ['a bare dash', ['-']],
    ['a double dash', ['--']],
    ['a flag after the positional', ['/dir', '-x']],
    ['two positionals', ['/a', '/b']],
  ])('returns usage for %s', (_label, rest) => {
    const parsed = RESOLVER.parseArgs(['node', 'script', ...rest]);
    expect(parsed.kind).toBe('usage');
  });
});

// ---------------------------------------------------------------------------
// parsePolicyBytes (D-POLICY-STRICT-SCHEMA)
// ---------------------------------------------------------------------------

describe('parsePolicyBytes', () => {
  const COMPACT = '{"version":1,"evidencePolicy":"required"}';
  const padTo = (s: string, n: number): string => s + ' '.repeat(n - Buffer.byteLength(s));

  const VALID: ReadonlyArray<readonly [string, string | Buffer, Policy]> = [
    ['compact required', COMPACT, 'required'],
    ['compact standard', '{"version":1,"evidencePolicy":"standard"}', 'standard'],
    ['pretty-printed', '{\n  "version": 1,\n  "evidencePolicy": "standard"\n}\n', 'standard'],
    ['CRLF pretty-printed', '{\r\n  "version": 1,\r\n  "evidencePolicy": "required"\r\n}\r\n', 'required'],
    ['swapped key order', '{"evidencePolicy":"standard","version":1}', 'standard'],
    ['tabs', '{\t"version"\t:\t1\t,\t"evidencePolicy":"required"}', 'required'],
    ['exactly 4096 bytes (padded)', padTo(COMPACT, 4096), 'required'],
  ];

  it.each(VALID)('accepts %s', (_label, bytes, policy) => {
    expect(RESOLVER.parsePolicyBytes(Buffer.from(bytes))).toEqual({ kind: 'valid', policy });
  });

  const INVALID: ReadonlyArray<readonly [string, string | Buffer]> = [
    ['"REQUIRED"', '{"version":1,"evidencePolicy":"REQUIRED"}'],
    ['"Required"', '{"version":1,"evidencePolicy":"Required"}'],
    ['an empty array', '[]'],
    ['an array of the object', `[${COMPACT}]`],
    ['null', 'null'],
    ['a __proto__ key', '{"__proto__":{"evidencePolicy":"standard"},"version":1}'],
    ['a constructor extra key', '{"version":1,"evidencePolicy":"required","constructor":1}'],
    ['any extra key', '{"version":1,"evidencePolicy":"required","x":1}'],
    ['a missing key', '{"version":1}'],
    ['BOM + valid', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(COMPACT)])],
    ['4097 bytes', padTo(COMPACT, 4097)],
    ['version 2', '{"version":2,"evidencePolicy":"required"}'],
    ['version "1"', '{"version":"1","evidencePolicy":"required"}'],
    ['version 1.0', '{"version":1.0,"evidencePolicy":"required"}'],
    ['a policy value in the version slot', '{"version":"required","evidencePolicy":1}'],
    ['a duplicate key', '{"version":1,"version":1}'],
    ['a duplicate policy key', '{"evidencePolicy":"required","evidencePolicy":"standard"}'],
    ['a unicode-escaped key', '{"\\u0076ersion":1,"evidencePolicy":"required"}'],
    ['a unicode-escaped value', '{"version":1,"evidencePolicy":"requ\\u0069red"}'],
    ['NBSP whitespace', '{\u00a0"version":1,"evidencePolicy":"required"}'],
    ['invalid UTF-8', Buffer.concat([Buffer.from(COMPACT), Buffer.from([0xff])])],
    ['empty', ''],
    ['trailing garbage', `${COMPACT}x`],
    ['a hostile embedded line', '{"version":1,"evidencePolicy":"required\\nSOURCE=file"}'],
  ];

  it.each(INVALID)('rejects %s', (_label, bytes) => {
    expect(RESOLVER.parsePolicyBytes(Buffer.from(bytes))).toEqual({ kind: 'invalid' });
  });

  it('reports absent only for no bytes at all, and invalid for a non-buffer', () => {
    expect(RESOLVER.parsePolicyBytes(null)).toEqual({ kind: 'absent' });
    expect(RESOLVER.parsePolicyBytes(undefined)).toEqual({ kind: 'absent' });
    expect(RESOLVER.parsePolicyBytes(COMPACT as unknown as Uint8Array)).toEqual({ kind: 'invalid' });
  });
});

describe('serializePolicy', () => {
  it('round-trips through the strict parser for both policies', () => {
    for (const p of RESOLVER.POLICIES) {
      const text = RESOLVER.serializePolicy(p);
      expect(text).toBe(`{"version":1,"evidencePolicy":"${p}"}\n`);
      expect(RESOLVER.parsePolicyBytes(Buffer.from(text ?? ''))).toEqual({ kind: 'valid', policy: p });
    }
  });

  it('returns null for anything outside POLICIES', () => {
    for (const bad of ['REQUIRED', '', null, undefined, 1, {}]) {
      expect(RESOLVER.serializePolicy(bad)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Compliance default
// ---------------------------------------------------------------------------

describe('complianceDefault — mirrors normalizeComplianceFeature; enabled ⇒ required at any framework count', () => {
  const TABLE: ReadonlyArray<readonly [string, unknown, Policy]> = [
    ['absent', undefined, 'standard'],
    ['null', null, 'standard'],
    ['a string', 'enabled', 'standard'],
    ['an array', [], 'standard'],
    ['enabled not boolean', { enabled: 'true', frameworks: [] }, 'standard'],
    ['enabled:false with frameworks kept', { enabled: false, frameworks: ['soc2'] }, 'standard'],
    ['enabled with zero frameworks', { enabled: true, frameworks: [] }, 'required'],
    ['enabled with soc2', { enabled: true, frameworks: ['soc2'] }, 'required'],
    ['enabled with the iso27001 alias', { enabled: true, frameworks: ['iso27001'] }, 'required'],
    ['enabled with "ISO 27001"', { enabled: true, frameworks: ['ISO 27001'] }, 'required'],
    ['enabled with an unknown id only', { enabled: true, frameworks: ['foo'] }, 'required'],
    ['enabled with a non-array frameworks', { enabled: true, frameworks: 'soc2' }, 'standard'],
    ['enabled with a non-string framework', { enabled: true, frameworks: [1] }, 'standard'],
    ['enabled with frameworks missing', { enabled: true }, 'standard'],
  ];

  it.each(TABLE)('%s ⇒ %s', (_label, raw, expected) => {
    expect(RESOLVER.complianceDefault(raw)).toBe(expected);
  });

  it('parity: equals the CLI normalizer’s enabled bit over the whole table', () => {
    expect(TABLE.length, 'the parity corpus must be non-empty').toBeGreaterThan(10);
    for (const [label, raw] of TABLE) {
      const cli: Policy = normalizeComplianceFeature(raw).enabled ? 'required' : 'standard';
      expect(RESOLVER.complianceDefault(raw), `parity drift on "${label}"`).toBe(cli);
    }
  });
});

// ---------------------------------------------------------------------------
// The fold (D-POLICY-FOLD) — 40 rows asserted by invariants, not a re-implemented classifier
// ---------------------------------------------------------------------------

type RState = 'absent' | 'standard' | 'required' | 'invalid' | 'unavailable';
type WState = 'absent' | 'standard' | 'required' | 'invalid';
type CState = 'none' | 'required';

const FOLD_ROWS: Array<{ r: RState; w: WState; c: CState }> = [];
for (const r of ['absent', 'standard', 'required', 'invalid', 'unavailable'] as const) {
  for (const w of ['absent', 'standard', 'required', 'invalid'] as const) {
    for (const c of ['none', 'required'] as const) FOLD_ROWS.push({ r, w, c });
  }
}

function blobOf(state: WState): { bytes: string } | 'absent' {
  return state === 'absent' ? 'absent' : { bytes: BODY[state] };
}

describe('fold matrix — R × W × C', () => {
  it('has 40 rows', () => {
    expect(FOLD_ROWS.length).toBe(40);
  });

  it.each(FOLD_ROWS)('R=$r W=$w C=$c', ({ r, w, c }) => {
    if (w !== 'absent') writeWorktree(root, BODY[w]);
    const reachable = r !== 'unavailable';
    // H = W: the branch has committed its worktree, so change detection sees W≠B only.
    const scenario: Scenario = reachable
      ? { root, defaultBranch: 'main', remote: r === 'absent' ? 'absent' : { bytes: BODY[r] }, head: blobOf(w) }
      : { root };
    const res = resolveWith(scenarioCalls(scenario), c === 'required' ? ENABLED_ZERO : DISABLED);

    const folded: Array<WState> = reachable ? [r as WState, w] : [w];
    const anyInvalid = folded.includes('invalid');
    const anyRequired = folded.includes('required') || c === 'required';

    // (i) any folded invalid ⇒ required
    if (anyInvalid) expect(res.policy).toBe('required');
    // (ii) the result is ≥ every folded source, compliance included
    if (anyRequired) expect(res.policy).toBe('required');
    // (iii) a remote `required` is never lowered
    if (r === 'required') expect(res.policy).toBe('required');
    // (v) no spurious raise: `required` always has a folded cause
    if (res.policy === 'required') expect(anyInvalid || anyRequired).toBe(true);

    // (iv) SOURCE per the governing file
    const governing: WState = reachable ? (r as WState) : w;
    const expectedSource: Source = governing === 'absent' ? 'default'
      : governing === 'invalid' ? 'invalid'
        : reachable ? 'file' : 'worktree';
    expect(res.source).toBe(expectedSource);

    // WARN semantics
    expect(res.warnings.includes('remote-unavailable')).toBe(!reachable);
    expect(res.warnings.includes('invalid-file')).toBe(anyInvalid);
    expect(res.warnings.includes('pr-changes-policy')).toBe(reachable && r !== w);
    const withoutC: Policy = folded.includes('invalid') || folded.includes('required') ? 'required' : 'standard';
    expect(res.warnings.includes('raised-by-compliance')).toBe(
      c === 'required' && (res.source === 'file' || res.source === 'worktree') && withoutC === 'standard',
    );

    // Structural: registry order, mechanism inputs, REF, immutability
    expect([...res.warnings]).toEqual(RESOLVER.WARNINGS.filter(t => res.warnings.includes(t)));
    expect(res.inputs).toEqual(RESOLVER.MECHANISM_INPUTS[res.policy]);
    expect(res.ref).toBe(reachable ? 'main' : 'none');
    expect(Object.isFrozen(res)).toBe(true);
    expect(Object.isFrozen(res.warnings)).toBe(true);
    expect(RESOLVER.formatLine(res)).toMatch(RESOLVER.OUTPUT_LINE_RE);
  });
});

describe('named rows — exact lines', () => {
  const NAMED: ReadonlyArray<{
    name: string;
    scenario: (dir: string) => Scenario;
    w?: string;
    compliance?: unknown;
    line: string;
  }> = [
    {
      name: 'remote required, branch in sync',
      scenario: d => ({ root: d, defaultBranch: 'main', remote: { bytes: BODY.required }, head: { bytes: BODY.required } }),
      w: BODY.required,
      line: `EVIDENCE_POLICY=required SOURCE=file REF=main ${LINE.requiredInputs}`,
    },
    {
      name: 'remote standard, branch in sync',
      scenario: d => ({ root: d, defaultBranch: 'main', remote: { bytes: BODY.standard }, head: { bytes: BODY.standard } }),
      w: BODY.standard,
      line: `EVIDENCE_POLICY=standard SOURCE=file REF=main ${LINE.standardInputs}`,
    },
    {
      name: 'remote standard raised by compliance',
      scenario: d => ({ root: d, defaultBranch: 'main', remote: { bytes: BODY.standard }, head: { bytes: BODY.standard } }),
      w: BODY.standard,
      compliance: ENABLED_ZERO,
      line: `EVIDENCE_POLICY=required SOURCE=file REF=main WARN=raised-by-compliance ${LINE.requiredInputs}`,
    },
    {
      name: 'remote absent (404), compliance off',
      scenario: d => ({ root: d, defaultBranch: 'main', remote: 'absent', head: 'absent' }),
      line: `EVIDENCE_POLICY=standard SOURCE=default REF=main ${LINE.standardInputs}`,
    },
    {
      name: 'remote absent, compliance on — the default IS compliance, not a raise',
      scenario: d => ({ root: d, defaultBranch: 'main', remote: 'absent', head: 'absent' }),
      compliance: ENABLED_ZERO,
      line: `EVIDENCE_POLICY=required SOURCE=default REF=main ${LINE.requiredInputs}`,
    },
    {
      name: 'remote invalid',
      scenario: d => ({ root: d, defaultBranch: 'main', remote: { bytes: BODY.invalid }, head: { bytes: BODY.invalid } }),
      w: BODY.invalid,
      line: `EVIDENCE_POLICY=required SOURCE=invalid REF=main WARN=invalid-file ${LINE.requiredInputs}`,
    },
    {
      name: 'uncommitted worktree raise',
      scenario: d => ({ root: d, defaultBranch: 'main', remote: { bytes: BODY.standard }, head: { bytes: BODY.standard } }),
      w: BODY.required,
      line: `EVIDENCE_POLICY=required SOURCE=file REF=main WARN=pr-changes-policy ${LINE.requiredInputs}`,
    },
    {
      name: 'a branch that lowers the policy cannot lower it',
      scenario: d => ({ root: d, defaultBranch: 'main', remote: { bytes: BODY.required }, head: { bytes: BODY.standard } }),
      w: BODY.standard,
      line: `EVIDENCE_POLICY=required SOURCE=file REF=main WARN=pr-changes-policy ${LINE.requiredInputs}`,
    },
    {
      name: 'remote standard, worktree invalid',
      scenario: d => ({ root: d, defaultBranch: 'main', remote: { bytes: BODY.standard }, head: { bytes: BODY.standard } }),
      w: BODY.invalid,
      line: `EVIDENCE_POLICY=required SOURCE=file REF=main WARN=invalid-file,pr-changes-policy ${LINE.requiredInputs}`,
    },
    {
      name: 'offline, worktree standard',
      scenario: d => ({ root: d }),
      w: BODY.standard,
      line: `EVIDENCE_POLICY=standard SOURCE=worktree REF=none WARN=remote-unavailable ${LINE.standardInputs}`,
    },
    {
      name: 'offline, worktree standard, compliance on',
      scenario: d => ({ root: d }),
      w: BODY.standard,
      compliance: ENABLED_ZERO,
      line: `EVIDENCE_POLICY=required SOURCE=worktree REF=none WARN=remote-unavailable,raised-by-compliance ${LINE.requiredInputs}`,
    },
    {
      name: 'offline, worktree invalid',
      scenario: d => ({ root: d }),
      w: BODY.invalid,
      line: `EVIDENCE_POLICY=required SOURCE=invalid REF=none WARN=remote-unavailable,invalid-file ${LINE.requiredInputs}`,
    },
    {
      name: 'offline, nothing anywhere, compliance on',
      scenario: d => ({ root: d }),
      compliance: ENABLED_ZERO,
      line: `EVIDENCE_POLICY=required SOURCE=default REF=none WARN=remote-unavailable ${LINE.requiredInputs}`,
    },
    {
      name: 'contents 403 after a good probe ⇒ unavailable, never absent; REF stays known',
      scenario: d => ({ root: d, defaultBranch: 'main', remote: 'forbidden', tracking: 'no-ref' }),
      w: BODY.standard,
      line: `EVIDENCE_POLICY=standard SOURCE=worktree REF=main WARN=remote-unavailable ${LINE.standardInputs}`,
    },
  ];

  it.each(NAMED)('$name', ({ scenario, w, compliance, line }) => {
    if (w !== undefined) writeWorktree(root, w);
    const res = resolveWith(scenarioCalls(scenario(root)), compliance ?? DISABLED);
    expect(RESOLVER.formatLine(res)).toBe(line);
  });

  it('a non-git directory resolves from compliance alone, flagged remote-unavailable', () => {
    const calls: ScriptedCall[] = [{ tool: 'git', args: ARGV.toplevel, exit: 128, stderr: 'fatal: not a git repository\n' }];
    expect(RESOLVER.formatLine(resolveWith(calls, DISABLED)))
      .toBe(`EVIDENCE_POLICY=standard SOURCE=default REF=none WARN=remote-unavailable ${LINE.standardInputs}`);
    expect(RESOLVER.formatLine(resolveWith(calls, ENABLED_ZERO)))
      .toBe(`EVIDENCE_POLICY=required SOURCE=default REF=none WARN=remote-unavailable ${LINE.requiredInputs}`);
  });
});

// ---------------------------------------------------------------------------
// Exhaustiveness (avoids PF-075: every declared value reachable, nothing outside it)
// ---------------------------------------------------------------------------

describe('SOURCES and WARNINGS exhaustiveness', SUBPROCESS_TIMEOUT, () => {
  const GOVERNING_STATES = ['absent', 'invalid', 'required', 'standard'] as const;
  const EXPECTED_SOURCE: Record<'reachable' | 'unavailable', Record<(typeof GOVERNING_STATES)[number], Source>> = {
    reachable: { absent: 'default', invalid: 'invalid', required: 'file', standard: 'file' },
    unavailable: { absent: 'default', invalid: 'invalid', required: 'worktree', standard: 'worktree' },
  };

  function driveGoverning(reachability: 'reachable' | 'unavailable', state: (typeof GOVERNING_STATES)[number]): Resolution {
    const dir = fs.mkdtempSync(path.join(tmp, 'gov-'));
    if (reachability === 'unavailable') {
      if (state !== 'absent') writeWorktree(dir, BODY[state]);
      return resolveWith(scenarioCalls({ root: dir }), DISABLED, dir);
    }
    const remote = state === 'absent' ? 'absent' : { bytes: BODY[state] };
    return resolveWith(scenarioCalls({ root: dir, defaultBranch: 'main', remote, head: 'absent' }), DISABLED, dir);
  }

  it('each of the 8 (reachability × governing state) combinations maps to its defined SOURCE', () => {
    let driven = 0;
    for (const reachability of ['reachable', 'unavailable'] as const) {
      for (const state of GOVERNING_STATES) {
        expect(driveGoverning(reachability, state).source, `${reachability} × ${state}`)
          .toBe(EXPECTED_SOURCE[reachability][state]);
        driven++;
      }
    }
    expect(driven).toBe(8);
  });

  it('the driven arms — exits 2, 4 and 5 included — emit exactly the SOURCES set', () => {
    const observed: string[] = [];
    for (const reachability of ['reachable', 'unavailable'] as const) {
      for (const state of GOVERNING_STATES) observed.push(driveGoverning(reachability, state).source);
    }
    // exit 2 (subprocess): an unusable <dir>
    observed.push(fieldOf(runResolver({ home, args: [path.join(tmp, 'missing')] }).stdout.trim(), 'SOURCE'));
    // exit 4 (in-process): resolve() fails closed when its exec throws
    observed.push(RESOLVER.resolve({ dir: root, compliance: DISABLED }, {
      exec: () => { throw new Error('seeded'); },
    }).source);
    // exit 5 (in-process): the output gate refuses a hostile formatter
    vi.stubEnv('DEVFLOW_DIR', path.join(home, '.devflow'));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const refused = RESOLVER.main(['node', RESOLVER_SCRIPT, root], {
      exec: scriptedExec(scenarioCalls({ root })).exec,
      formatLine: () => 'EVIDENCE_POLICY=standard\nSOURCE=file',
    });
    observed.push(fieldOf(refused.line, 'SOURCE'));

    expect(observed.length, 'the driven-arm corpus must be non-empty').toBeGreaterThan(8);
    expect(collectUnreachable(RESOLVER.SOURCES, observed), `observed: ${observed.join(', ')}`).toEqual([]);
    expect(collectUnregistered(observed, RESOLVER.SOURCES)).toEqual([]);
  });

  it('every WARNINGS token is produced by a driven arm, and nothing outside it', () => {
    const observed: string[] = [];
    const drive = (s: (d: string) => Scenario, w: string | undefined, compliance: unknown): void => {
      const dir = fs.mkdtempSync(path.join(tmp, 'warn-'));
      if (w !== undefined) writeWorktree(dir, w);
      observed.push(...resolveWith(scenarioCalls(s(dir)), compliance, dir).warnings);
    };
    drive(d => ({ root: d }), BODY.standard, ENABLED_ZERO);  // remote-unavailable, raised-by-compliance
    drive(d => ({ root: d }), BODY.invalid, DISABLED);       // invalid-file
    drive(d => ({ root: d, defaultBranch: 'main', remote: { bytes: BODY.required }, head: { bytes: BODY.standard } }),
      BODY.standard, DISABLED);                              // pr-changes-policy

    expect(observed.length).toBeGreaterThan(0);
    expect(collectUnreachable(RESOLVER.WARNINGS, observed), `observed: ${observed.join(', ')}`).toEqual([]);
    expect(collectUnregistered(observed, RESOLVER.WARNINGS)).toEqual([]);
  });

  it('known-bad probe: a registry with an extra token is reported, and so is an unregistered observation', () => {
    expect(collectUnreachable([...RESOLVER.SOURCES, 'phantom'], [...RESOLVER.SOURCES])).toEqual(['phantom']);
    expect(collectUnregistered(['file', 'remote'], RESOLVER.SOURCES)).toEqual(['remote']);
  });
});

// ---------------------------------------------------------------------------
// pr-changes-policy (D-POLICY-CHANGE-DETECT)
// ---------------------------------------------------------------------------

describe('pr-changes-policy — semantic, advisory, never lowering', () => {
  it('fires when HEAD differs from the default branch, even with the worktree back in sync', () => {
    writeWorktree(root, BODY.standard);
    const res = resolveWith(scenarioCalls({
      root, defaultBranch: 'main', remote: { bytes: BODY.standard }, head: { bytes: BODY.required },
    }));
    expect(res.warnings).toContain('pr-changes-policy');
    expect(res.policy).toBe('standard');
  });

  it('fires when the worktree differs, and the worktree still cannot lower a remote required', () => {
    writeWorktree(root, BODY.standard);
    const res = resolveWith(scenarioCalls({
      root, defaultBranch: 'main', remote: { bytes: BODY.required }, head: { bytes: BODY.required },
    }));
    expect(res.warnings).toContain('pr-changes-policy');
    expect(res.policy).toBe('required');
  });

  it('does not fire on a CRLF / reformatting-only difference', () => {
    const crlfPretty = '{\r\n  "evidencePolicy": "standard",\r\n  "version": 1\r\n}\r\n';
    writeWorktree(root, crlfPretty);
    const res = resolveWith(scenarioCalls({
      root, defaultBranch: 'main', remote: { bytes: BODY.standard }, head: { bytes: crlfPretty },
    }));
    expect(res.warnings).not.toContain('pr-changes-policy');
    expect(res.policy).toBe('standard');
  });

  it('offline: folds the tracking copy in when it fires, so the branch cannot lower it', () => {
    writeWorktree(root, BODY.standard);
    const res = resolveWith(scenarioCalls({
      root, lsRemoteBranch: 'main', tracking: { bytes: BODY.required }, head: { bytes: BODY.standard },
    }));
    expect(RESOLVER.formatLine(res)).toBe(
      `EVIDENCE_POLICY=required SOURCE=worktree REF=main WARN=remote-unavailable,pr-changes-policy ${LINE.requiredInputs}`,
    );
  });

  it('offline: deleting the file on the branch cannot lower it either', () => {
    const res = resolveWith(scenarioCalls({
      root, lsRemoteBranch: 'main', tracking: { bytes: BODY.required }, head: 'absent',
    }));
    expect(RESOLVER.formatLine(res)).toBe(
      `EVIDENCE_POLICY=required SOURCE=default REF=main WARN=remote-unavailable,pr-changes-policy ${LINE.requiredInputs}`,
    );
  });

  it('offline: an invalid tracking copy raises and flags invalid-file', () => {
    writeWorktree(root, BODY.standard);
    const res = resolveWith(scenarioCalls({
      root, lsRemoteBranch: 'main', tracking: { bytes: BODY.invalid }, head: { bytes: BODY.standard },
    }));
    expect(res.policy).toBe('required');
    expect(res.warnings).toEqual(['remote-unavailable', 'invalid-file', 'pr-changes-policy']);
  });

  it('stale branch (documented): a default-branch edit after the branch was cut fires it', () => {
    writeWorktree(root, BODY.standard);
    const res = resolveWith(scenarioCalls({
      root, defaultBranch: 'main', remote: { bytes: BODY.required }, head: { bytes: BODY.standard },
    }));
    expect(res.warnings).toContain('pr-changes-policy');
    expect(res.policy).toBe('required');
  });

  it('offline with no tracking ref: B is unknown, so nothing fires and HEAD is never read', () => {
    writeWorktree(root, BODY.standard);
    const { exec, recorded } = scriptedExec(scenarioCalls({
      root, lsRemoteBranch: 'main', tracking: 'no-ref', head: { bytes: BODY.required },
    }));
    const res = RESOLVER.resolve({ dir: root, compliance: DISABLED }, { exec });
    expect(res.warnings).toEqual(['remote-unavailable']);
    expect(res.ref).toBe('main');
    expect(recorded.map(c => c.args.join(' '))).not.toContain(ARGV.headBlob.join(' '));
  });
});

// ---------------------------------------------------------------------------
// Argv (D-POLICY-PROBE) — the real script, scripted fakes on PATH
// ---------------------------------------------------------------------------

const ALLOWED_GIT_SUBCOMMANDS = new Set(['rev-parse', 'cat-file', 'ls-remote']);

/**
 * Named collector: calls the resolver must never make. A git subcommand outside
 * the read-only allowlist (which is what keeps `set-head`, `fetch` and every
 * index-refreshing command out), a gh subcommand other than `api`, and a gh call
 * that adds a field without `--method GET` — gh defaults such a call to POST.
 */
function collectForbiddenCalls(log: readonly string[][]): string[] {
  return log.filter((call) => {
    const [tool, sub] = call;
    if (call.includes('set-head') || call.includes('fetch')) return true;
    if (tool === 'git') return !ALLOWED_GIT_SUBCOMMANDS.has(sub);
    if (tool === 'gh') {
      if (sub !== 'api') return true;
      const addsField = call.some(a => a === '-f' || a === '-F' || a === '--field' || a === '--raw-field');
      const methodAt = call.indexOf('--method');
      return addsField && (methodAt === -1 || call[methodAt + 1] !== 'GET');
    }
    return true;
  }).map(call => call.join(' '));
}

const TOPLEVEL_CALL = ['git', 'rev-parse', '--show-toplevel'];
const PROBE_CALL = ['gh', 'api', 'repos/{owner}/{repo}', '--jq', '.default_branch'];
const CONTENTS_CALL = [
  'gh', 'api', '--method', 'GET', 'repos/{owner}/{repo}/contents/.devflow/policy.json',
  '-f', 'ref=main', '-H', 'Accept: application/vnd.github.raw+json',
];
const HEAD_CALL = ['git', 'cat-file', 'blob', 'HEAD:.devflow/policy.json'];
const LS_REMOTE_CALL = ['git', 'ls-remote', '--symref', 'origin', 'HEAD'];
const VERIFY_CALL = ['git', 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'];
const TRACKING_CALL = ['git', 'cat-file', 'blob', 'refs/remotes/origin/main:.devflow/policy.json'];

describe('argv log — exact sequences through the real spawnSync', SUBPROCESS_TIMEOUT, () => {
  it('reachable + present: probe, contents (GET), HEAD blob — nothing else', () => {
    writeWorktree(root, BODY.required);
    const run = e2e(scenarioCalls({
      root, defaultBranch: 'main', remote: { bytes: BODY.required }, head: { bytes: BODY.required },
    }));
    expect(run.status).toBe(0);
    expect(expectOneGrammarLine(run.stdout)).toBe(`EVIDENCE_POLICY=required SOURCE=file REF=main ${LINE.requiredInputs}`);
    expect(run.log).toEqual([TOPLEVEL_CALL, PROBE_CALL, CONTENTS_CALL, HEAD_CALL]);
    expect(collectForbiddenCalls(run.log)).toEqual([]);
  });

  it('reachable + 404: the stdout JSON body of a 404 is never parsed as the file', () => {
    const run = e2e(scenarioCalls({ root, defaultBranch: 'main', remote: 'absent', head: 'absent' }));
    expect(run.status).toBe(0);
    expect(expectOneGrammarLine(run.stdout)).toBe(`EVIDENCE_POLICY=standard SOURCE=default REF=main ${LINE.standardInputs}`);
    expect(run.log).toEqual([TOPLEVEL_CALL, PROBE_CALL, CONTENTS_CALL, HEAD_CALL]);
    expect(collectForbiddenCalls(run.log)).toEqual([]);
  });

  it('probe fails ⇒ ls-remote, tracking ref, tracking blob, HEAD blob', () => {
    writeWorktree(root, BODY.standard);
    const run = e2e(scenarioCalls({
      root, lsRemoteBranch: 'main', tracking: { bytes: BODY.standard }, head: { bytes: BODY.standard },
    }));
    expect(run.status).toBe(0);
    expect(expectOneGrammarLine(run.stdout))
      .toBe(`EVIDENCE_POLICY=standard SOURCE=worktree REF=main WARN=remote-unavailable ${LINE.standardInputs}`);
    expect(run.log).toEqual([TOPLEVEL_CALL, PROBE_CALL, LS_REMOTE_CALL, VERIFY_CALL, TRACKING_CALL, HEAD_CALL]);
    expect(collectForbiddenCalls(run.log)).toEqual([]);
  });

  it('contents 403 ⇒ no ls-remote (the probe already named the branch)', () => {
    writeWorktree(root, BODY.standard);
    const run = e2e(scenarioCalls({
      root, defaultBranch: 'main', remote: 'forbidden', tracking: { bytes: BODY.standard }, head: { bytes: BODY.standard },
    }));
    expect(run.status).toBe(0);
    expect(run.log).toEqual([TOPLEVEL_CALL, PROBE_CALL, CONTENTS_CALL, VERIFY_CALL, TRACKING_CALL, HEAD_CALL]);
    expect(collectForbiddenCalls(run.log)).toEqual([]);
  });

  it('a failed contents call is classified by stderr and exit code — its stdout body is never read', () => {
    // A 403 whose JSON body happens to say "Not Found" is still unavailable, never absent…
    writeWorktree(root, BODY.required);
    const forbidden = resolveWith([
      {
        tool: 'gh', args: ARGV.contents('main'), exit: 1,
        stdout: '{"message":"Not Found","status":"404"}', stderr: 'gh: Forbidden (HTTP 403)\n',
      },
      ...scenarioCalls({ root, defaultBranch: 'main', tracking: 'no-ref' }),
    ]);
    expect(forbidden.source).toBe('worktree');
    expect(forbidden.warnings).toContain('remote-unavailable');

    // …and a 404 is absent from stderr alone, whatever stdout carries.
    const notFound = resolveWith([
      { tool: 'gh', args: ARGV.contents('main'), exit: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)\n' },
      ...scenarioCalls({ root, defaultBranch: 'main', head: { bytes: BODY.required } }),
    ]);
    expect(notFound.source).toBe('default');
    expect(notFound.warnings).not.toContain('remote-unavailable');

    // A `(HTTP 404)` on a spawn-level failure (a timeout) is not a 404.
    const timedOut = resolveWith([
      { tool: 'gh', args: ARGV.contents('main'), spawnError: 'ETIMEDOUT', stderr: 'gh: Not Found (HTTP 404)\n' },
      ...scenarioCalls({ root, defaultBranch: 'main', tracking: 'no-ref' }),
    ]);
    expect(timedOut.source).toBe('worktree');
    expect(timedOut.warnings).toContain('remote-unavailable');
  });

  it('not a git repository ⇒ exactly one call', () => {
    const run = e2e([{ tool: 'git', args: ARGV.toplevel, exit: 128, stderr: 'fatal: not a git repository\n' }]);
    expect(run.status).toBe(0);
    expect(run.log).toEqual([TOPLEVEL_CALL]);
  });

  it('gh ENOENT (in-process): treated as unavailable, then the offline path', () => {
    const calls: ScriptedCall[] = [
      { tool: 'gh', args: ARGV.probe, spawnError: 'ENOENT' },
      ...scenarioCalls({ root, lsRemoteBranch: 'main', tracking: 'no-ref' }),
    ];
    const { exec, recorded } = scriptedExec(calls);
    const res = RESOLVER.resolve({ dir: root, compliance: DISABLED }, { exec });
    expect(res.source).toBe('default');
    expect(res.warnings).toEqual(['remote-unavailable']);
    expect(recorded.map(c => [c.file, ...c.args])).toEqual([TOPLEVEL_CALL, PROBE_CALL, LS_REMOTE_CALL, VERIFY_CALL]);
  });

  it('known-bad probe: the collector reports set-head, fetch, a write subcommand and a POSTing gh', () => {
    expect(collectForbiddenCalls([
      ['git', 'remote', 'set-head', 'origin', '-a'],
      ['git', 'fetch', 'origin'],
      ['git', 'status'],
      ['gh', 'api', 'repos/{owner}/{repo}/contents/x', '-f', 'ref=main'],
      ['gh', 'pr', 'view'],
      ...[TOPLEVEL_CALL, PROBE_CALL, CONTENTS_CALL, HEAD_CALL, LS_REMOTE_CALL, VERIFY_CALL, TRACKING_CALL],
    ])).toEqual([
      'git remote set-head origin -a',
      'git fetch origin',
      'git status',
      'gh api repos/{owner}/{repo}/contents/x -f ref=main',
      'gh pr view',
    ]);
  });
});

describe('per-call bounds (in-process recording)', () => {
  it('every call carries its timeout, maxBuffer, ignored stdin, no shell and the no-prompt env', () => {
    writeWorktree(root, BODY.standard);
    const calls = [
      ...scenarioCalls({ root, defaultBranch: 'main', remote: 'forbidden', tracking: { bytes: BODY.standard }, head: { bytes: BODY.standard } }),
      { tool: 'git' as const, args: ARGV.lsRemote, stdout: 'ref: refs/heads/main\tHEAD\n' },
    ];
    const { exec, recorded } = scriptedExec(calls);
    RESOLVER.resolve({ dir: root, compliance: DISABLED }, { exec });
    // A second run that reaches ls-remote, so its bounds are recorded too.
    const offline = scriptedExec(scenarioCalls({ root, lsRemoteBranch: 'main', tracking: 'no-ref' }));
    RESOLVER.resolve({ dir: root, compliance: DISABLED }, { exec: offline.exec });
    const all = [...recorded, ...offline.recorded];

    const EXPECTED: Record<string, { timeout: number; maxBuffer: number }> = {
      'gh api': { timeout: 10_000, maxBuffer: 65_536 },
      'git ls-remote': { timeout: 10_000, maxBuffer: 4_096 },
      'git rev-parse': { timeout: 5_000, maxBuffer: 4_096 },
      'git cat-file': { timeout: 5_000, maxBuffer: 65_536 },
    };
    const kinds = new Set<string>();
    for (const call of all) {
      const kind = `${call.file} ${call.args[0]}`;
      kinds.add(kind);
      expect(EXPECTED[kind], `unexpected call kind ${kind}`).toBeDefined();
      expect(call.opts.timeout, kind).toBe(EXPECTED[kind].timeout);
      expect(call.opts.maxBuffer, kind).toBe(EXPECTED[kind].maxBuffer);
      expect((call.opts.stdio as unknown[])[0], kind).toBe('ignore');
      expect(call.opts.shell ?? false, kind).toBe(false);
      const env = call.opts.env as Record<string, string>;
      expect(env.GH_PROMPT_DISABLED, kind).toBe('1');
      expect(env.GIT_TERMINAL_PROMPT, kind).toBe('0');
    }
    expect([...kinds].sort()).toEqual(Object.keys(EXPECTED).sort());
    // cwd: the first call runs in <dir>; every later call runs at the repo root.
    expect(all[0].opts.cwd).toBe(root);
    expect(all.every(c => c.opts.cwd === root)).toBe(true);
  });

  it('never throws across the module boundary: a throwing exec fails closed to required/error', () => {
    const res = RESOLVER.resolve({ dir: root, compliance: DISABLED }, {
      exec: () => { throw new Error('seeded'); },
    });
    expect(RESOLVER.formatLine(res)).toBe(RESOLVER.FAIL_CLOSED_LINE);
  });

  it('a malformed exec result is not an answer: it fails closed, never a crash and never "not a repository"', () => {
    const res = RESOLVER.resolve({ dir: root, compliance: DISABLED }, {
      exec: () => null as unknown as ReturnType<ExecFn>,
    });
    expect(RESOLVER.formatLine(res)).toBe(RESOLVER.FAIL_CLOSED_LINE);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed when local git does not ANSWER (avoids PF-075)
//
// Only an answered non-zero exit is a real "no" (not a repository, no such path,
// no such ref). A git that is missing, timed out, overflowed or was killed has not
// answered, and each local-git step must then land on the conservative verdict —
// never the permissive one reached by exhaustion. The remote steps (the gh probe,
// the contents call, ls-remote) keep their designed "remote unavailable" reading,
// flagged in WARN; these rows cover the LOCAL steps the offline fold relies on.
// ---------------------------------------------------------------------------

describe('fail-closed when local git does not answer', () => {
  /** A scripted table with one call replaced by a spawn-level failure. */
  function withFailure(base: readonly ScriptedCall[], args: readonly string[], spawnError: string): ScriptedCall[] {
    return [{ tool: 'git', args, spawnError }, ...base];
  }

  it.each(['ENOENT', 'ETIMEDOUT', 'ENOBUFS', 'EACCES'])(
    'step 1 (rev-parse --show-toplevel) %s ⇒ the fail-closed resolution, and no further call',
    (code) => {
      writeWorktree(root, BODY.standard);
      const { exec, recorded } = scriptedExec(withFailure(scenarioCalls({ root }), ARGV.toplevel, code));
      const res = RESOLVER.resolve({ dir: root, compliance: DISABLED }, { exec });
      expect(RESOLVER.formatLine(res)).toBe(RESOLVER.FAIL_CLOSED_LINE);
      expect(recorded.map(c => [c.file, ...c.args])).toEqual([TOPLEVEL_CALL]);
    },
  );

  it('step 1 killed by a signal (no status, no error) ⇒ the fail-closed resolution', () => {
    const res = RESOLVER.resolve({ dir: root, compliance: DISABLED }, {
      exec: () => ({ status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
    });
    expect(RESOLVER.formatLine(res)).toBe(RESOLVER.FAIL_CLOSED_LINE);
  });

  it.each([
    ['a relative path', 'repo\n'],
    ['an empty answer', '\n'],
    ['a path carrying a second line', `${'/tmp/a'}\n/tmp/b\n`],
  ])('step 1 exit 0 with an unusable root (%s) ⇒ the fail-closed resolution', (_label, stdout) => {
    const res = resolveWith([{ tool: 'git', args: ARGV.toplevel, stdout }]);
    expect(RESOLVER.formatLine(res)).toBe(RESOLVER.FAIL_CLOSED_LINE);
  });

  it('control: step 1 ANSWERED non-zero (not a repository) still resolves from compliance', () => {
    const res = resolveWith([{ tool: 'git', args: ARGV.toplevel, exit: 128, stderr: 'fatal: not a git repository\n' }]);
    expect(res.source).toBe('default');
    expect(res.policy).toBe('standard');
  });

  it.each(['ETIMEDOUT', 'ENOBUFS'])(
    'offline: the tracking-ref check %s ⇒ T invalid, so a standard worktree cannot govern alone',
    (code) => {
      writeWorktree(root, BODY.standard);
      const base = scenarioCalls({
        root, lsRemoteBranch: 'main', tracking: { bytes: BODY.required }, head: { bytes: BODY.standard },
      });
      const res = resolveWith(withFailure(base, ARGV.verifyTracking('main'), code));
      expect(RESOLVER.formatLine(res)).toBe(
        `EVIDENCE_POLICY=required SOURCE=worktree REF=main WARN=remote-unavailable,invalid-file,pr-changes-policy ${LINE.requiredInputs}`,
      );
    },
  );

  it('offline: the tracking blob read timing out ⇒ T invalid (never absent)', () => {
    writeWorktree(root, BODY.standard);
    const base = scenarioCalls({
      root, lsRemoteBranch: 'main', tracking: { bytes: BODY.required }, head: { bytes: BODY.standard },
    });
    const res = resolveWith(withFailure(base, ARGV.trackingBlob('main'), 'ETIMEDOUT'));
    expect(res.policy).toBe('required');
    expect(res.warnings).toEqual(['remote-unavailable', 'invalid-file', 'pr-changes-policy']);
  });

  it('control: an ANSWERED missing tracking ref is "B unknown" — the worktree governs, nothing raises', () => {
    writeWorktree(root, BODY.standard);
    const res = resolveWith(scenarioCalls({ root, lsRemoteBranch: 'main', tracking: 'no-ref', head: { bytes: BODY.standard } }));
    expect(RESOLVER.formatLine(res))
      .toBe(`EVIDENCE_POLICY=standard SOURCE=worktree REF=main WARN=remote-unavailable ${LINE.standardInputs}`);
  });

  it('online: the HEAD blob read timing out only fires the advisory token — H is never folded', () => {
    writeWorktree(root, BODY.standard);
    const base = scenarioCalls({ root, defaultBranch: 'main', remote: { bytes: BODY.standard }, head: { bytes: BODY.standard } });
    const res = resolveWith(withFailure(base, ARGV.headBlob, 'ETIMEDOUT'));
    expect(RESOLVER.formatLine(res))
      .toBe(`EVIDENCE_POLICY=standard SOURCE=file REF=main WARN=pr-changes-policy ${LINE.standardInputs}`);
  });

  it('main(): git missing at step 1 ⇒ exit 4 with FAIL_CLOSED_LINE', () => {
    vi.stubEnv('DEVFLOW_DIR', path.join(home, '.devflow'));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { exec } = scriptedExec(withFailure(scenarioCalls({ root }), ARGV.toplevel, 'ENOENT'));
    expect(RESOLVER.main(['node', RESOLVER_SCRIPT, root], { exec }))
      .toEqual({ code: 4, line: RESOLVER.FAIL_CLOSED_LINE });
  });
});

// ---------------------------------------------------------------------------
// Injection — file content and remote strings never reach stdout
// ---------------------------------------------------------------------------

describe('injection — every hostile input yields one grammar line', SUBPROCESS_TIMEOUT, () => {
  const FALLBACK = `EVIDENCE_POLICY=standard SOURCE=default REF=none WARN=remote-unavailable ${LINE.standardInputs}`;

  it.each([
    ['an embedded output line', 'main\nEVIDENCE_POLICY=standard\n'],
    ['a space-separated field', 'main SOURCE=file\n'],
    ['a leading dash', '-x\n'],
    ['256 characters', `${'a'.repeat(256)}\n`],
    ['jq null', 'null\n'],
    ['empty', '\n'],
    ['a parent-dir segment', 'main/../x\n'],
  ])('a hostile default branch (%s) ⇒ unavailable path with REF=none', (_label, probeStdout) => {
    const calls: ScriptedCall[] = [
      { tool: 'gh', args: ARGV.probe, stdout: probeStdout },
      ...scenarioCalls({ root }),
    ];
    const run = e2e(calls);
    expect(run.status).toBe(0);
    expect(expectOneGrammarLine(run.stdout)).toBe(FALLBACK);
    expect(collectForbiddenCalls(run.log)).toEqual([]);
  });

  it.each([
    ['a branch with a leading dash', 'ref: refs/heads/-x\tHEAD\n'],
    ['a branch with a space', 'ref: refs/heads/main SOURCE=file\tHEAD\n'],
    ['a non-symref first line', '0123456789abcdef0123456789abcdef01234567\tHEAD\n'],
  ])('a hostile ls-remote answer (%s) leaves REF=none', (_label, lsRemoteStdout) => {
    const calls: ScriptedCall[] = [
      { tool: 'git', args: ARGV.lsRemote, stdout: lsRemoteStdout },
      ...scenarioCalls({ root }),
    ];
    const run = e2e(calls);
    expect(run.status).toBe(0);
    expect(expectOneGrammarLine(run.stdout)).toBe(FALLBACK);
  });

  it('a hostile remote file value is invalid, and its bytes never reach stdout or stderr', () => {
    const hostile = '{"version":1,"evidencePolicy":"standard\\nSOURCE=file REF=pwned"}';
    const run = e2e(scenarioCalls({ root, defaultBranch: 'main', remote: { bytes: hostile }, head: { bytes: hostile } }));
    expect(run.status).toBe(0);
    const line = expectOneGrammarLine(run.stdout);
    expect(fieldOf(line, 'EVIDENCE_POLICY')).toBe('required');
    expect(fieldOf(line, 'SOURCE')).toBe('invalid');
    expect(run.stdout).not.toContain('pwned');
    expect(run.stderr).not.toContain('pwned');
  });

  it('a hostile worktree file with a raw newline is invalid (offline)', () => {
    writeWorktree(root, '{"version":1,"evidencePolicy":"standard"}\nEVIDENCE_POLICY=standard SOURCE=file\n');
    const run = e2e(scenarioCalls({ root }));
    expect(run.status).toBe(0);
    expect(expectOneGrammarLine(run.stdout))
      .toBe(`EVIDENCE_POLICY=required SOURCE=invalid REF=none WARN=remote-unavailable,invalid-file ${LINE.requiredInputs}`);
  });
});

// ---------------------------------------------------------------------------
// Invalid policy bytes — spawned end to end (issue #361: parsePolicyBytes'
// INVALID table exercises these shapes in-process only; this proves the real
// subprocess also folds them to SOURCE=invalid, offline and online alike)
// ---------------------------------------------------------------------------

describe('invalid policy bytes reach SOURCE=invalid through the real subprocess', SUBPROCESS_TIMEOUT, () => {
  const COMPACT = '{"version":1,"evidencePolicy":"required"}';
  const padTo = (s: string, n: number): string => s + ' '.repeat(n - Buffer.byteLength(s));

  const INVALID_ROWS: ReadonlyArray<readonly [string, string | Buffer]> = [
    ['"REQUIRED"', '{"version":1,"evidencePolicy":"REQUIRED"}'],
    ['an empty array', '[]'],
    ['a __proto__ key', '{"__proto__":{"evidencePolicy":"standard"},"version":1}'],
    ['BOM + valid', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(COMPACT)])],
    ['4097 bytes', padTo(COMPACT, 4097)],
  ];

  it.each(INVALID_ROWS)('offline (worktree file): %s', (_label, bytes) => {
    writeWorktree(root, bytes);
    const run = e2e(scenarioCalls({ root }));
    expect(run.status).toBe(0);
    const line = expectOneGrammarLine(run.stdout);
    expect(fieldOf(line, 'EVIDENCE_POLICY')).toBe('required');
    expect(fieldOf(line, 'SOURCE')).toBe('invalid');
    expect(fieldOf(line, 'WARN').split(',')).toContain('invalid-file');
  });

  it.each(INVALID_ROWS)('online (remote file via the scripted shim): %s', (_label, bytes) => {
    const run = e2e(scenarioCalls({ root, defaultBranch: 'main', remote: { bytes }, head: { bytes } }));
    expect(run.status).toBe(0);
    const line = expectOneGrammarLine(run.stdout);
    expect(fieldOf(line, 'EVIDENCE_POLICY')).toBe('required');
    expect(fieldOf(line, 'SOURCE')).toBe('invalid');
    expect(fieldOf(line, 'WARN').split(',')).toContain('invalid-file');
  });
});

// ---------------------------------------------------------------------------
// Exit arms
// ---------------------------------------------------------------------------

describe('exit arms', SUBPROCESS_TIMEOUT, () => {
  function preloadThrowingSpawn(): string {
    const preload = path.join(tmp, 'throw-on-spawn.cjs');
    fs.writeFileSync(preload, "require('child_process').spawnSync = () => { throw new Error('seeded internal error'); };\n");
    return preload;
  }

  function stubHome(): void {
    vi.stubEnv('HOME', home);
    vi.stubEnv('DEVFLOW_DIR', path.join(home, '.devflow'));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  }

  it('0 ⇒ one grammar line', () => {
    const run = e2e(scenarioCalls({ root }));
    expect(run.status).toBe(0);
    expectOneGrammarLine(run.stdout);
  });

  it.each([
    ['--help', ['--help']],
    ['two positionals', ['/a', '/b']],
    ['a bare dash', ['-']],
  ])('1 (%s) ⇒ stdout entirely empty, usage on stderr', (_label, args) => {
    const run = runResolver({ home, args });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('Usage');
  });

  it('2 ⇒ a nonexistent <dir> prints FAIL_CLOSED_LINE', () => {
    const run = runResolver({ home, args: [path.join(tmp, 'does-not-exist')] });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe(`${RESOLVER.FAIL_CLOSED_LINE}\n`);
  });

  it('2 ⇒ a <dir> that is a regular file prints FAIL_CLOSED_LINE', () => {
    const file = path.join(tmp, 'a-file');
    fs.writeFileSync(file, 'x');
    const run = runResolver({ home, args: [file] });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe(`${RESOLVER.FAIL_CLOSED_LINE}\n`);
  });

  it('4 ⇒ a spawnSync that throws (preload) prints FAIL_CLOSED_LINE; the control run resolves', () => {
    const shim = buildScriptedShim(fakeBin, tmp, scenarioCalls({ root }));
    const broken = runResolver({ home, args: [root], shim, nodeArgs: ['--require', preloadThrowingSpawn()] });
    expect(broken.status, broken.stderr).toBe(4);
    expect(broken.stdout).toBe(`${RESOLVER.FAIL_CLOSED_LINE}\n`);
    expect(broken.stderr).toContain('internal error');

    const control = runResolver({ home, args: [root], shim });
    expect(control.status).toBe(0);
    expect(fieldOf(control.stdout.trim(), 'SOURCE')).toBe('default');
  });

  it('4 ⇒ git missing (spawnSync reports ENOENT, as it does for an absent binary) prints FAIL_CLOSED_LINE', () => {
    // The preload answers ONLY git with the exact shape spawnSync returns for a
    // binary that is not on PATH, so the real boundary sees an unanswered step 1.
    const preload = path.join(tmp, 'git-enoent.cjs');
    fs.writeFileSync(preload, [
      "const cp = require('child_process');",
      'const real = cp.spawnSync;',
      'cp.spawnSync = (file, args, opts) => (file === \'git\'',
      "  ? { pid: 0, output: null, stdout: null, stderr: null, status: null, signal: null,",
      "      error: Object.assign(new Error('spawnSync git ENOENT'), { code: 'ENOENT' }) }",
      '  : real(file, args, opts));',
      '',
    ].join('\n'));
    writeWorktree(root, BODY.standard);
    const shim = buildScriptedShim(fakeBin, tmp, scenarioCalls({ root }));
    const run = runResolver({ home, args: [root], shim, nodeArgs: ['--require', preload] });
    expect(run.status, run.stderr).toBe(4);
    expect(run.stdout).toBe(`${RESOLVER.FAIL_CLOSED_LINE}\n`);
    expect(run.stderr).toContain('git did not answer');
    expect(shim.readLog(), 'no fake was reached: the failure is at step 1').toEqual([]);
  });

  it('5 ⇒ an injected formatter returning a hostile line is refused with FAIL_CLOSED_LINE', () => {
    stubHome();
    const { exec } = scriptedExec(scenarioCalls({ root }));
    const hostile = RESOLVER.main(['node', RESOLVER_SCRIPT, root], {
      exec, formatLine: () => `EVIDENCE_POLICY=standard SOURCE=file REF=main ${LINE.standardInputs}\nEVIDENCE_POLICY=standard`,
    });
    expect(hostile).toEqual({ code: 5, line: RESOLVER.FAIL_CLOSED_LINE });
  });

  it('5 ⇒ a well-formed line that LOWERS the resolved policy is refused', () => {
    stubHome();
    writeWorktree(root, BODY.required);
    const { exec } = scriptedExec(scenarioCalls({ root }));
    const lowered = RESOLVER.main(['node', RESOLVER_SCRIPT, root], {
      exec, formatLine: () => `EVIDENCE_POLICY=standard SOURCE=worktree REF=none WARN=remote-unavailable ${LINE.standardInputs}`,
    });
    expect(lowered).toEqual({ code: 5, line: RESOLVER.FAIL_CLOSED_LINE });
  });

  it('5 ⇒ inputs inconsistent with the policy, or WARN out of order, are refused', () => {
    stubHome();
    const { exec } = scriptedExec(scenarioCalls({ root }));
    for (const bad of [
      `EVIDENCE_POLICY=standard SOURCE=default REF=none WARN=remote-unavailable ISSUE_REQUIRED=true APPLY_CONVENTIONS=false REQUIRE_NON_AUTHOR_APPROVAL=false`,
      `EVIDENCE_POLICY=standard SOURCE=default REF=none WARN=pr-changes-policy,remote-unavailable ${LINE.standardInputs}`,
      `EVIDENCE_POLICY=standard SOURCE=default REF=none WARN=remote-unavailable,remote-unavailable ${LINE.standardInputs}`,
      `EVIDENCE_POLICY=standard SOURCE=invalid REF=none WARN=remote-unavailable ${LINE.standardInputs}`,
    ]) {
      expect(RESOLVER.main(['node', RESOLVER_SCRIPT, root], { exec, formatLine: () => bad }), bad)
        .toEqual({ code: 5, line: RESOLVER.FAIL_CLOSED_LINE });
    }
  });

  it('4 ⇒ a formatter that throws is an internal error, not a line', () => {
    stubHome();
    const { exec } = scriptedExec(scenarioCalls({ root }));
    const thrown = RESOLVER.main(['node', RESOLVER_SCRIPT, root], {
      exec, formatLine: () => { throw new Error('seeded'); },
    });
    expect(thrown).toEqual({ code: 4, line: RESOLVER.FAIL_CLOSED_LINE });
  });

  it('the driven arms emit exactly the EXIT_CODES set — 3 is never produced', () => {
    stubHome();
    const shim = buildScriptedShim(fakeBin, tmp, scenarioCalls({ root }));
    const observed: number[] = [
      runResolver({ home, args: [root], shim }).status ?? -1,
      runResolver({ home, args: ['--help'] }).status ?? -1,
      runResolver({ home, args: [path.join(tmp, 'missing')] }).status ?? -1,
      runResolver({ home, args: [root], shim, nodeArgs: ['--require', preloadThrowingSpawn()] }).status ?? -1,
      RESOLVER.main(['node', RESOLVER_SCRIPT, root], {
        exec: scriptedExec(scenarioCalls({ root })).exec, formatLine: () => 'hostile',
      }).code,
    ];
    const registry = Object.values(RESOLVER.EXIT_CODES);
    expect(collectUnreachable(registry, observed), `observed: ${observed.join(', ')}`).toEqual([]);
    expect(collectUnregistered(observed, registry)).toEqual([]);
    expect(observed).not.toContain(3);
  });
});

// ---------------------------------------------------------------------------
// Bounds — the worktree file is lstat-refused before it is opened or read
// ---------------------------------------------------------------------------

describe('bounds', SUBPROCESS_TIMEOUT, () => {
  function openedPaths(spy: { mock: { calls: unknown[][] } }): string[] {
    return spy.mock.calls.map(c => String(c[0]));
  }

  it('an oversize worktree policy is invalid and is never opened or read', () => {
    writeWorktree(root, `${'{"version":1,"evidencePolicy":"standard"}'}${' '.repeat(4096)}`);
    const openSpy = vi.spyOn(CJS_FS, 'openSync');
    const readSpy = vi.spyOn(CJS_FS, 'readSync');
    const res = resolveWith(scenarioCalls({ root }));
    expect(res.source).toBe('invalid');
    expect(res.policy).toBe('required');
    expect(openedPaths(openSpy)).not.toContain(worktreePolicyPath(root));
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('a symlinked worktree policy is invalid and is never opened', () => {
    const target = path.join(tmp, 'elsewhere.json');
    fs.writeFileSync(target, BODY.standard);
    fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
    fs.symlinkSync(target, worktreePolicyPath(root));
    const openSpy = vi.spyOn(CJS_FS, 'openSync');
    const res = resolveWith(scenarioCalls({ root }));
    expect(res.source).toBe('invalid');
    expect(openedPaths(openSpy)).not.toContain(worktreePolicyPath(root));
  });

  it('a directory at the policy path is invalid', () => {
    fs.mkdirSync(worktreePolicyPath(root), { recursive: true });
    expect(resolveWith(scenarioCalls({ root })).source).toBe('invalid');
  });

  it('a valid worktree policy IS opened and read (the spies above are not vacuous)', () => {
    writeWorktree(root, BODY.standard);
    const openSpy = vi.spyOn(CJS_FS, 'openSync');
    const res = resolveWith(scenarioCalls({ root }));
    expect(res.source).toBe('worktree');
    expect(openedPaths(openSpy)).toContain(worktreePolicyPath(root));
  });

  it.skipIf(process.platform === 'win32')('a FIFO at the policy path is invalid and is never opened', () => {
    fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
    expect(makeFifo(worktreePolicyPath(root), home), 'mkfifo precondition').toBe(true);
    expect(fs.lstatSync(worktreePolicyPath(root)).isFIFO()).toBe(true);

    const openSpy = vi.spyOn(CJS_FS, 'openSync');
    const res = resolveWith(scenarioCalls({ root }));
    expect(res.source).toBe('invalid');
    expect(openedPaths(openSpy)).not.toContain(worktreePolicyPath(root));

    // Opening a writer-less FIFO blocks forever, so a subprocess that finishes is
    // evidence the script never tried.
    const run = e2e(scenarioCalls({ root }));
    expect(run.status).toBe(0);
    expect(fieldOf(expectOneGrammarLine(run.stdout), 'SOURCE')).toBe('invalid');
  });

  it('a remote file over 64 KiB is ENOBUFS ⇒ invalid ⇒ required (never "unavailable")', () => {
    const run = e2e(scenarioCalls({
      root, defaultBranch: 'main', remote: { bytes: 'x'.repeat(70_000) }, head: 'absent',
    }));
    expect(run.status).toBe(0);
    const line = expectOneGrammarLine(run.stdout);
    expect(fieldOf(line, 'EVIDENCE_POLICY')).toBe('required');
    expect(fieldOf(line, 'SOURCE')).toBe('invalid');
    expect(fieldOf(line, 'WARN').split(',')).toContain('invalid-file');
    expect(fieldOf(line, 'WARN').split(',')).not.toContain('remote-unavailable');
  });
});

// ---------------------------------------------------------------------------
// The manifest — the compliance state the script reads for itself
// ---------------------------------------------------------------------------

describe('manifest read (subprocess; HOME and DEVFLOW_DIR are tmp)', SUBPROCESS_TIMEOUT, () => {
  const NOT_A_REPO: ScriptedCall[] = [{ tool: 'git', args: ARGV.toplevel, exit: 128, stderr: 'fatal: not a git repository\n' }];

  function writeManifest(dir: string, compliance: unknown): string {
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'manifest.json');
    fs.writeFileSync(p, JSON.stringify({ version: '1', features: { compliance } }));
    return p;
  }

  it('absent manifest ⇒ standard', () => {
    const run = e2e(NOT_A_REPO);
    expect(fieldOf(expectOneGrammarLine(run.stdout), 'EVIDENCE_POLICY')).toBe('standard');
  });

  it('compliance enabled with zero frameworks ⇒ required, SOURCE=default', () => {
    writeManifest(path.join(home, '.devflow'), ENABLED_ZERO);
    const run = e2e(NOT_A_REPO);
    expect(expectOneGrammarLine(run.stdout))
      .toBe(`EVIDENCE_POLICY=required SOURCE=default REF=none WARN=remote-unavailable ${LINE.requiredInputs}`);
  });

  it('compliance disabled (frameworks kept) ⇒ standard', () => {
    writeManifest(path.join(home, '.devflow'), { enabled: false, frameworks: ['soc2'] });
    expect(fieldOf(expectOneGrammarLine(e2e(NOT_A_REPO).stdout), 'EVIDENCE_POLICY')).toBe('standard');
  });

  it('a relative DEVFLOW_DIR is ignored in favour of HOME/.devflow', () => {
    writeManifest(path.join(home, '.devflow'), ENABLED_ZERO);
    const run = e2e(NOT_A_REPO, { extraEnv: { DEVFLOW_DIR: 'relative/devflow' } });
    expect(fieldOf(expectOneGrammarLine(run.stdout), 'EVIDENCE_POLICY')).toBe('required');
  });

  it('an absolute DEVFLOW_DIR wins over HOME/.devflow', () => {
    writeManifest(path.join(home, '.devflow'), DISABLED);
    const custom = path.join(tmp, 'custom-devflow');
    writeManifest(custom, ENABLED_ZERO);
    const run = e2e(NOT_A_REPO, { extraEnv: { DEVFLOW_DIR: custom } });
    expect(fieldOf(expectOneGrammarLine(run.stdout), 'EVIDENCE_POLICY')).toBe('required');
  });

  it('a manifest over 1 MiB is not read (treated as absent)', () => {
    const p = path.join(home, '.devflow', 'manifest.json');
    const body = JSON.stringify({ version: '1', features: { compliance: ENABLED_ZERO } });
    fs.writeFileSync(p, body + ' '.repeat(1_048_577 - body.length));
    expect(fieldOf(expectOneGrammarLine(e2e(NOT_A_REPO).stdout), 'EVIDENCE_POLICY')).toBe('standard');
  });

  it('a malformed manifest is treated as absent', () => {
    fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), '{"features": {"compliance": ');
    expect(fieldOf(expectOneGrammarLine(e2e(NOT_A_REPO).stdout), 'EVIDENCE_POLICY')).toBe('standard');
  });
});

// ---------------------------------------------------------------------------
// Real git — the offline tracking-copy fold against a local bare origin
// ---------------------------------------------------------------------------

describe('real git (gh faked unavailable, git real)', SUBPROCESS_TIMEOUT, () => {
  const GH_UNAVAILABLE: ScriptedCall[] = [
    { tool: 'gh', args: ARGV.probe, exit: 1, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' },
  ];

  function repoWithOrigin(initial: string): string {
    const bare = path.join(tmp, 'origin.git');
    const work = path.join(tmp, 'work');
    realGit(tmp, home, ['init', '--quiet', '--bare', '-b', 'main', bare]);
    realGit(tmp, home, ['init', '--quiet', '-b', 'main', work]);
    writeWorktree(work, initial);
    realGit(work, home, ['add', '-f', '.devflow/policy.json']);
    realGit(work, home, ['commit', '--quiet', '-m', 'policy']);
    realGit(work, home, ['remote', 'add', 'origin', bare]);
    realGit(work, home, ['push', '--quiet', 'origin', 'main']);
    realGit(work, home, ['checkout', '--quiet', '-b', 'feat']);
    return work;
  }

  function runReal(dir: string): RunResult & { log: string[][] } {
    const shim = buildScriptedShim(ghOnlyBin, tmp, GH_UNAVAILABLE);
    return { ...runResolver({ home, args: [dir], shim }), log: shim.readLog() };
  }

  it('a branch that commits a lower policy is raised back by the tracking copy', () => {
    const work = repoWithOrigin(BODY.required);
    writeWorktree(work, BODY.standard);
    realGit(work, home, ['commit', '--quiet', '-am', 'lower']);
    const run = runReal(work);
    expect(run.status, run.stderr).toBe(0);
    expect(expectOneGrammarLine(run.stdout))
      .toBe(`EVIDENCE_POLICY=required SOURCE=worktree REF=main WARN=remote-unavailable,pr-changes-policy ${LINE.requiredInputs}`);
    expect(run.log).toEqual([PROBE_CALL]);
  });

  it('a branch that deletes the policy (real cat-file exit 128 ⇒ absent) cannot lower it', () => {
    const work = repoWithOrigin(BODY.required);
    realGit(work, home, ['rm', '--quiet', '.devflow/policy.json']);
    realGit(work, home, ['commit', '--quiet', '-m', 'delete']);
    const run = runReal(work);
    expect(run.status, run.stderr).toBe(0);
    expect(expectOneGrammarLine(run.stdout))
      .toBe(`EVIDENCE_POLICY=required SOURCE=default REF=main WARN=remote-unavailable,pr-changes-policy ${LINE.requiredInputs}`);
  });

  it('a branch in sync with the tracking copy fires nothing', () => {
    const work = repoWithOrigin(BODY.standard);
    const run = runReal(work);
    expect(run.status, run.stderr).toBe(0);
    expect(expectOneGrammarLine(run.stdout))
      .toBe(`EVIDENCE_POLICY=standard SOURCE=worktree REF=main WARN=remote-unavailable ${LINE.standardInputs}`);
  });
});

// ---------------------------------------------------------------------------
// Source guards over the script (each with a known-bad probe — PF-064)
// ---------------------------------------------------------------------------

describe('source guards', () => {
  const SOURCE = fs.readFileSync(RESOLVER_SCRIPT, 'utf8');

  /** Code lines only: `//` tails and JSDoc/block-comment lines are stripped, so prose naming a rule is not a violation of it. */
  function codeLines(source: string): string[] {
    return source.split('\n')
      .map(l => l.replace(/\/\/.*$/, ''))
      .filter(l => !/^\s*(\*|\/\*)/.test(l));
  }

  const collectStdoutWrites = (s: string): string[] => codeLines(s).filter(l => /process\.stdout\.write/.test(l));
  const collectProcessExitCalls = (s: string): string[] => codeLines(s).filter(l => /process\.exit\s*\(/.test(l));
  const collectExitCodeSetters = (s: string): string[] => codeLines(s).filter(l => /process\.exitCode\s*=/.test(l));
  const collectFsWrites = (s: string): string[] => codeLines(s).filter(l =>
    /\bfs\.(?:write|append|rename|unlink|rm|mkdir|mkdtemp|copyFile|cp|symlink|link|chmod|chown|truncate|utimes|createWriteStream)\w*\s*\(/.test(l)
    || /\bO_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND)\b/.test(l));
  const collectRequires = (s: string): string[] =>
    [...codeLines(s).join('\n').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);

  it('the corpus is the real script', () => {
    expect(SOURCE.length).toBeGreaterThan(1000);
    expect(SOURCE.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(SOURCE).toContain("'use strict';");
  });

  it('exactly one process.stdout.write site (the boundary) — and a seeded second is reported', () => {
    expect(collectStdoutWrites(SOURCE)).toHaveLength(1);
    expect(collectStdoutWrites(`${SOURCE}\nprocess.stdout.write(x);\n`)).toHaveLength(2);
  });

  it('exactly one process.exitCode setter — and a seeded second is reported', () => {
    expect(collectExitCodeSetters(SOURCE)).toHaveLength(1);
    expect(collectExitCodeSetters(`${SOURCE}\nprocess.exitCode = 3;\n`)).toHaveLength(2);
  });

  it('no process.exit() call — and a seeded one is reported', () => {
    expect(collectProcessExitCalls(SOURCE)).toEqual([]);
    expect(collectProcessExitCalls(`${SOURCE}\nprocess.exit(5);\n`)).toEqual(['process.exit(5);']);
  });

  it('no fs write API and no write open-flag — and a seeded write is reported', () => {
    expect(collectFsWrites(SOURCE)).toEqual([]);
    expect(collectFsWrites(`${SOURCE}\nfs.writeFileSync(policyPath, x);\n`)).toHaveLength(1);
    expect(collectFsWrites(`${SOURCE}\nconst f = fs.constants.O_WRONLY;\n`)).toHaveLength(1);
  });

  it('requires Node built-ins only (fs, path, os, child_process) — and a seeded one is reported', () => {
    const required = collectRequires(SOURCE);
    expect(required.length).toBeGreaterThan(0);
    expect([...new Set(required)].sort()).toEqual(['child_process', 'fs', 'os', 'path']);
    expect(collectRequires(`${SOURCE}\nconst h = require('https');\n`)).toContain('https');
  });

  it('never enables a shell, and never names a write-side git command in code', () => {
    const code = codeLines(SOURCE).join('\n');
    expect(code).not.toMatch(/shell:\s*true/);
    expect(code).not.toMatch(/['"](?:set-head|fetch|remote|push|update-ref|symbolic-ref)['"]/);
  });

  it('documents every exit code in the header, 3 as never emitted', () => {
    for (const code of [0, 1, 2, 4, 5]) expect(SOURCE).toMatch(new RegExp(`^//\\s+${code}\\s+`, 'm'));
    expect(SOURCE).toMatch(/^\/\/\s+3\s+never emitted/m);
  });

  it('carries every phase-A design decision at its code site (AC-12)', () => {
    for (const marker of [
      'D-POLICY-LINE', 'D-POLICY-PROBE', 'D-POLICY-STRICT-SCHEMA',
      'D-POLICY-FOLD', 'D-POLICY-CHANGE-DETECT', 'D-POLICY-PLUMBING',
    ]) {
      expect(SOURCE, `${marker} missing`).toContain(marker);
    }
  });
});

// ---------------------------------------------------------------------------
// Environment hygiene (applies PF-060) — every spawn here passes through scopedEnv()
// ---------------------------------------------------------------------------

describe('spawn environment hygiene', () => {
  const SPAWN_RE = /(?:spawnSync|execFileSync|execSync)\(/g;

  /**
   * Named collector: every spawn call in a source whose argument list does not
   * pass through scopedEnv() or does not name a `cwd` (an inherited cwd is the
   * developer's repository). The argument list is taken paren-balanced from the
   * call site, bounded to 2000 characters; comment lines are stripped first.
   */
  function collectUnscopedSpawns(source: string): string[] {
    const code = source.split('\n')
      .map(l => (/^\s*(\*|\/\/|\/\*)/.test(l) ? '' : l))
      .join('\n');
    const offenders: string[] = [];
    for (const m of code.matchAll(SPAWN_RE)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      let depth = 0;
      let close = -1;
      for (let i = open; i < code.length && i < open + 2000; i++) {
        if (code[i] === '(') depth++;
        if (code[i] === ')') depth--;
        if (depth === 0) { close = i; break; }
      }
      const call = code.slice(m.index, close === -1 ? open + 2000 : close + 1);
      if (!call.includes('scopedEnv(') || !/\bcwd\b/.test(call)) offenders.push(call.split('\n')[0].trim());
    }
    return offenders;
  }

  const countSpawnSites = (source: string): number => [...source.matchAll(SPAWN_RE)].length;

  it('every spawn in tests/evidence-policy/ passes through scopedEnv() and names its cwd', () => {
    const files = fs.readdirSync(import.meta.dirname).filter(f => f.endsWith('.ts'));
    expect(files.length, 'the hygiene corpus must include this file and the shim').toBeGreaterThanOrEqual(2);
    let sites = 0;
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(import.meta.dirname, f), 'utf8');
      sites += countSpawnSites(src);
      offenders.push(...collectUnscopedSpawns(src).map(o => `${f}: ${o}`));
    }
    expect(sites, 'no spawn sites found — the collector is reading nothing').toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });

  it('known-bad probes: a bare spawn and a scoped spawn with an inherited cwd are reported; a fully scoped one is not', () => {
    const bare = `const r = ${'spawn'}Sync('gh', ['api'], { cwd: home, env: process.env });`;
    const inheritedCwd = `const r = ${'spawn'}Sync('gh', ['api'], { env: scopedEnv(home) });`;
    const scoped = `const r = ${'spawn'}Sync('gh', ['api'], { cwd: home, env: scopedEnv(home) });`;
    expect(collectUnscopedSpawns(bare)).toHaveLength(1);
    expect(collectUnscopedSpawns(inheritedCwd)).toHaveLength(1);
    expect(collectUnscopedSpawns(scoped)).toEqual([]);
  });
});

/**
 * tests/evidence-policy/project-json.test.ts
 *
 * The committed team file `.devflow/project.json`:
 *   - lib/project-config.cjs — the ONE parser of project.json and the personal
 *     config.json (D-PROJECT-CONFIG, D-PROJECT-STRICT-KEYS): the byte rules both
 *     files share, per-key absent/valid/malformed classification,
 *     duplicate keys found in the raw text, and parity with the TypeScript
 *     registries it transcribes;
 *   - resolve-evidence-policy.cjs default mode reading it at every source
 *     (D-POLICY-SOURCE-PRECEDENCE, D-COMPLIANCE-REPO-FLOOR) — TP-29, TP-30, TP-31.
 *
 * The fold rows live in resolver.test.ts, and so do the retired policy.json's
 * presence rows (TP-45, TP-46 — D-POLICY-JSON-RETIRED).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { COMPLIANCE_FRAMEWORKS, normalizeFrameworks } from '../../src/core/compliance.js';
import { TRACKER_PROVIDER_IDS } from '../../src/core/tracker.js';
import {
  ARGV,
  PROJECT_CONFIG_LIB,
  RESOLVER_SCRIPT,
  buildScriptedShim,
  createFakeBin,
  warmFakeBin,
  WARM_HOOK_TIMEOUT_MS,
  runResolver,
  scenarioCalls,
  scriptedExec,
  type FakeBin,
  type RunResult,
  type ScriptedCall,
} from './scripted-shim.js';

// ---------------------------------------------------------------------------
// The .cjs seams (transcribed from the JSDoc typedefs — PF-043, PF-069)
// ---------------------------------------------------------------------------

type Field<T> = { readonly kind: 'absent' } | { readonly kind: 'malformed' } | { readonly kind: 'valid'; readonly value: T };

interface FeatureFields {
  readonly memory: Field<boolean>;
  readonly learning: Field<boolean>;
  readonly knowledge: Field<boolean>;
}

interface ProjectTracker {
  readonly provider: Field<string>;
  readonly site: Field<string>;
  readonly key: Field<string>;
}

type ProjectConfig =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid' }
  | {
    readonly kind: 'parsed';
    readonly version: Field<1>;
    readonly evidence: Field<'required' | 'standard'>;
    readonly compliance: Field<readonly string[]>;
    readonly tracker: Field<ProjectTracker>;
    readonly reviewPublication: Field<'off' | 'auto' | 'full'>;
    readonly features: Field<FeatureFields>;
  };

type PersonalConfig =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid' }
  | {
    readonly kind: 'parsed';
    readonly tracker: Field<string>;
    readonly reviewPublication: Field<'off' | 'auto' | 'full'>;
    readonly features: Field<FeatureFields>;
  };

interface ProjectConfigModule {
  readonly MAX_CONFIG_BYTES: number;
  readonly POLICIES: readonly string[];
  readonly PUBLICATIONS: readonly string[];
  readonly TRACKER_PROVIDER_IDS: readonly string[];
  readonly COMPLIANCE_IDS: readonly string[];
  readonly FEATURE_SWITCHES: readonly string[];
  readonly TRACKER_SITE_RE: RegExp;
  readonly TRACKER_KEY_RE: RegExp;
  decodeConfigBytes(buf: unknown): { kind: 'absent' } | { kind: 'invalid' } | { kind: 'text'; text: string };
  collectDuplicateKeyPaths(text: string): Set<string> | null;
  normalizeComplianceIds(frameworks: readonly string[]): string[];
  parseProjectBytes(buf: unknown): ProjectConfig;
  parsePersonalBytes(buf: unknown): PersonalConfig;
}

type Policy = 'required' | 'standard';

interface Resolution {
  readonly policy: Policy;
  readonly source: string;
  readonly ref: string;
  readonly warnings: readonly string[];
}

interface ResolverModule {
  readonly OUTPUT_LINE_RE: RegExp;
  resolve(opts: { dir: string; compliance?: unknown }, deps?: { exec?: unknown }): Resolution;
  formatLine(r: Resolution): string;
}

const NODE_REQUIRE = createRequire(import.meta.url);
const LIB = NODE_REQUIRE(PROJECT_CONFIG_LIB) as ProjectConfigModule;
const RESOLVER = NODE_REQUIRE(RESOLVER_SCRIPT) as ResolverModule;

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const ABSENT = { kind: 'absent' };
const MALFORMED = { kind: 'malformed' };
const valid = <T>(value: T): Field<T> => ({ kind: 'valid', value });

const bytes = (s: string | Buffer): Buffer => (typeof s === 'string' ? Buffer.from(s, 'utf8') : s);

function parsed(text: string): Extract<ProjectConfig, { kind: 'parsed' }> {
  const r = LIB.parseProjectBytes(bytes(text));
  if (r.kind !== 'parsed') throw new Error(`expected a parsed project file, got ${r.kind}: ${text}`);
  return r;
}

function personal(text: string): Extract<PersonalConfig, { kind: 'parsed' }> {
  const r = LIB.parsePersonalBytes(bytes(text));
  if (r.kind !== 'parsed') throw new Error(`expected a parsed personal file, got ${r.kind}: ${text}`);
  return r;
}

// ---------------------------------------------------------------------------
// Parity with the TypeScript registries it transcribes
// ---------------------------------------------------------------------------

describe('lib/project-config.cjs — parity with the TypeScript registries', () => {
  it('COMPLIANCE_IDS is COMPLIANCE_FRAMEWORKS, in registry order', () => {
    expect([...LIB.COMPLIANCE_IDS]).toEqual(COMPLIANCE_FRAMEWORKS.map(fw => fw.id));
  });

  it('TRACKER_PROVIDER_IDS is the tracker registry', () => {
    expect([...LIB.TRACKER_PROVIDER_IDS]).toEqual([...TRACKER_PROVIDER_IDS]);
  });

  const FRAMEWORK_ROWS: ReadonlyArray<readonly string[]> = [
    [],
    ['gdpr'],
    ['GDPR', ' hipaa ', 'iso27001', 'nist', 'gdpr'],
    ['PCI DSS', 'pci-dss', 'Soc2', 'SOX'],
    ['iso 27001', 'ISO-27001', 'unknown', ''],
    ['\tsoc2\n', 'hipaa', 'HIPAA'],
  ];

  it.each(FRAMEWORK_ROWS.map(r => [JSON.stringify(r), r] as const))(
    'normalizeComplianceIds(%s) equals normalizeFrameworks',
    (_label, row) => {
      expect(LIB.normalizeComplianceIds(row)).toEqual(normalizeFrameworks(row));
    },
  );

  it('TRACKER_SITE_RE is the site gate the jira and linear setup-task references state', () => {
    const ours = LIB.TRACKER_SITE_RE.source.replace(/\(\?:/g, '(').replace(/\\\//g, '/');
    for (const rel of ['src/assets/mds/tracker/_jira.mds', 'src/assets/mds/tracker/_linear.mds']) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      const m = /\*\*Site\.\*\*[^\n]*?`(\^https:[^`]+)`/.exec(text);
      expect(m, `${rel}: the **Site.** gate is not where the parity test looks`).not.toBeNull();
      expect(ours, rel).toBe(m?.[1]);
    }
  });

  it('bounds every config file at 4096 bytes, and freezes its registries', () => {
    expect(LIB.MAX_CONFIG_BYTES).toBe(4096);
    expect(Object.isFrozen(LIB)).toBe(true);
    for (const registry of [LIB.POLICIES, LIB.PUBLICATIONS, LIB.TRACKER_PROVIDER_IDS, LIB.COMPLIANCE_IDS, LIB.FEATURE_SWITCHES]) {
      expect(Object.isFrozen(registry)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Byte rules — one set for project.json and config.json
// ---------------------------------------------------------------------------

describe('byte rules shared by project.json and config.json', () => {
  const COMPACT = '{"evidence":"required"}';
  const INVALID_BYTES: ReadonlyArray<readonly [string, unknown]> = [
    ['a string, not bytes', COMPACT],
    ['4097 bytes', bytes(COMPACT + ' '.repeat(4097 - COMPACT.length))],
    ['a UTF-8 BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes(COMPACT)])],
    ['a malformed UTF-8 sequence', Buffer.concat([bytes('{"x":"'), Buffer.from([0xc3, 0x28]), bytes('"}')])],
  ];

  it.each(INVALID_BYTES)('%s is invalid for project.json and config.json alike', (_label, buf) => {
    expect(LIB.decodeConfigBytes(buf)).toEqual({ kind: 'invalid' });
    expect(LIB.parseProjectBytes(buf)).toEqual({ kind: 'invalid' });
    expect(LIB.parsePersonalBytes(buf)).toEqual({ kind: 'invalid' });
  });

  it('exactly 4096 bytes is read', () => {
    const buf = bytes(COMPACT + ' '.repeat(4096 - COMPACT.length));
    expect(buf.length).toBe(4096);
    expect(parsed(buf.toString()).evidence).toEqual(valid('required'));
  });

  it('null and undefined are "no file"', () => {
    for (const none of [null, undefined]) {
      expect(LIB.parseProjectBytes(none)).toEqual(ABSENT);
      expect(LIB.parsePersonalBytes(none)).toEqual(ABSENT);
    }
  });

  it.each([
    ['an empty file', ''],
    ['not JSON', '{"evidence":'],
    ['an array', '["evidence"]'],
    ['null', 'null'],
    ['a string', '"required"'],
    ['a number', '1'],
    ['nesting deeper than the scan follows', `{"x":${'['.repeat(40)}${']'.repeat(40)}}`],
  ])('%s is an invalid file, not an absent one', (_label, text) => {
    expect(LIB.parseProjectBytes(bytes(text))).toEqual({ kind: 'invalid' });
    expect(LIB.parsePersonalBytes(bytes(text))).toEqual({ kind: 'invalid' });
  });
});

// ---------------------------------------------------------------------------
// parseProjectBytes — every key classified on its own (D-PROJECT-CONFIG)
// ---------------------------------------------------------------------------

const FULL = JSON.stringify({
  version: 1,
  evidence: 'standard',
  compliance: ['hipaa', 'gdpr'],
  tracker: { provider: 'jira', site: 'https://acme.atlassian.net', key: 'ACME' },
  reviewPublication: 'off',
  features: { memory: true, learning: false, knowledge: false },
});

describe('parseProjectBytes — per-key classification', () => {
  it('an empty object has every key absent', () => {
    const r = parsed('{}');
    for (const key of ['version', 'evidence', 'compliance', 'tracker', 'reviewPublication', 'features'] as const) {
      expect(r[key], key).toEqual(ABSENT);
    }
  });

  it('a full file reads every key as valid', () => {
    const r = parsed(FULL);
    expect(r.version).toEqual(valid(1));
    expect(r.evidence).toEqual(valid('standard'));
    expect(r.compliance).toEqual(valid(['hipaa', 'gdpr']));
    expect(r.tracker).toEqual(valid({
      provider: valid('jira'), site: valid('https://acme.atlassian.net'), key: valid('ACME'),
    }));
    expect(r.reviewPublication).toEqual(valid('off'));
    expect(r.features).toEqual(valid({ memory: valid(true), learning: valid(false), knowledge: valid(false) }));
  });

  it('unknown keys are ignored', () => {
    const r = parsed('{"evidence":"required","teamNote":"hi","evidencePolicy":"standard","decisions":false}');
    expect(r.evidence).toEqual(valid('required'));
    expect(Object.keys(r).sort()).toEqual(['compliance', 'evidence', 'features', 'kind', 'reviewPublication', 'tracker', 'version']);
  });

  // One malformed key never takes its neighbours down (AC-26).
  const MALFORMED_ROWS: ReadonlyArray<readonly [string, string, unknown]> = [
    ['version', 'version', '1'],
    ['version', 'version', 2],
    ['evidence', 'evidence', 'REQUIRED'],
    ['evidence', 'evidence', 'strict'],
    ['evidence', 'evidence', null],
    ['compliance', 'compliance', 'gdpr'],
    ['compliance', 'compliance', [1]],
    ['compliance', 'compliance', { gdpr: true }],
    ['tracker', 'tracker', 'jira'],
    ['tracker', 'tracker', ['jira']],
    ['reviewPublication', 'reviewPublication', 'stub'],
    ['reviewPublication', 'reviewPublication', true],
    ['features', 'features', false],
    ['features', 'features', ['memory']],
  ];

  it.each(MALFORMED_ROWS)('%s = %j is malformed, and every other key still reads', (key, _k, value) => {
    const body = { ...JSON.parse(FULL), [key]: value };
    const r = parsed(JSON.stringify(body));
    expect(r[key as keyof typeof r], key).toEqual(MALFORMED);
    const full = parsed(FULL);
    for (const other of ['version', 'evidence', 'compliance', 'tracker', 'reviewPublication', 'features'] as const) {
      if (other !== key) expect(r[other], `${other} beside a malformed ${key}`).toEqual(full[other]);
    }
  });

  it('compliance: registry ids, normalized; unknown ids dropped; an empty list is a valid empty list', () => {
    expect(parsed('{"compliance":[]}').compliance).toEqual(valid([]));
    expect(parsed('{"compliance":["GDPR","iso27001","nist","gdpr"]}').compliance).toEqual(valid(['gdpr', 'iso-27001']));
    expect(parsed('{"compliance":["nist"]}').compliance).toEqual(valid([]));
  });

  it('tracker: provider, site and key are each their own field', () => {
    const t = (tracker: unknown): Field<ProjectTracker> => parsed(JSON.stringify({ tracker })).tracker;
    expect(t({})).toEqual(valid({ provider: ABSENT, site: ABSENT, key: ABSENT }));
    expect(t({ provider: 'gitlab', site: 'https://a.example.com', key: 'AB' }))
      .toEqual(valid({ provider: MALFORMED, site: valid('https://a.example.com'), key: valid('AB') }));
    expect(t({ provider: 'linear', key: 'ENG' })).toEqual(valid({ provider: valid('linear'), site: ABSENT, key: valid('ENG') }));
  });

  it.each([
    'http://acme.atlassian.net',
    'https://user@acme.atlassian.net',
    'https://acme.atlassian.net:8443',
    'https://acme.atlassian.net/',
    'https://acme.atlassian.net/jira',
    'https://ACME.atlassian.net',
    'https://localhost',
    'https://-acme.atlassian.net',
    ' https://acme.atlassian.net',
    'https://acme.atlassian.net\nKEY=X',
    `https://${'a'.repeat(250)}.example.com`,
  ])('tracker site %j is malformed', (site) => {
    const r = parsed(JSON.stringify({ tracker: { provider: 'jira', site } }));
    expect(r.tracker).toEqual(valid({ provider: valid('jira'), site: MALFORMED, key: ABSENT }));
  });

  it.each(['acme', 'A', 'ACME-1', '1ACME', 'ABCDEFGHIJK', 'AC ME', ''])('tracker key %j is malformed', (key) => {
    const r = parsed(JSON.stringify({ tracker: { key } }));
    expect(r.tracker).toEqual(valid({ provider: ABSENT, site: ABSENT, key: MALFORMED }));
  });

  it.each(['AB', 'ACME', 'A_B2', 'ABCDEFGHIJ'])('tracker key %j is valid', (key) => {
    expect(parsed(JSON.stringify({ tracker: { key } })).tracker)
      .toEqual(valid({ provider: ABSENT, site: ABSENT, key: valid(key) }));
  });

  it('features: each switch is boolean-only and classified on its own', () => {
    expect(parsed('{"features":{"memory":"false","learning":false,"knowledge":0}}').features)
      .toEqual(valid({ memory: MALFORMED, learning: valid(false), knowledge: MALFORMED }));
    expect(parsed('{"features":{}}').features).toEqual(valid({ memory: ABSENT, learning: ABSENT, knowledge: ABSENT }));
  });
});

// ---------------------------------------------------------------------------
// D-PROJECT-STRICT-KEYS — own keys only, and a duplicate is malformed
// ---------------------------------------------------------------------------

describe('parseProjectBytes — strict keys (D-PROJECT-STRICT-KEYS)', () => {
  it('a duplicate evidence is malformed — JSON.parse would have kept the last, standard', () => {
    expect(JSON.parse('{"evidence":"required","evidence":"standard"}').evidence).toBe('standard');
    const r = parsed('{"evidence":"required","evidence":"standard","reviewPublication":"full"}');
    expect(r.evidence).toEqual(MALFORMED);
    expect(r.reviewPublication).toEqual(valid('full'));
  });

  it('a duplicate spelled with an escape is still a duplicate', () => {
    expect(parsed('{"evidence":"required","\\u0065vidence":"standard"}').evidence).toEqual(MALFORMED);
  });

  it('a duplicate inside tracker or features is malformed at that key only', () => {
    const r = parsed('{"tracker":{"provider":"jira","provider":"linear","key":"ACME"},'
      + '"features":{"learning":false,"learning":true,"memory":false}}');
    expect(r.tracker).toEqual(valid({ provider: MALFORMED, site: ABSENT, key: valid('ACME') }));
    expect(r.features).toEqual(valid({ memory: valid(false), learning: MALFORMED, knowledge: ABSENT }));
  });

  it('a duplicated object is malformed as a whole', () => {
    const r = parsed('{"tracker":{"provider":"jira"},"tracker":{"provider":"github"},"evidence":"standard"}');
    expect(r.tracker).toEqual(MALFORMED);
    expect(r.evidence).toEqual(valid('standard'));
  });

  it('the same key in DIFFERENT objects, or a duplicated unknown key, is not a duplicate of anything known', () => {
    const r = parsed('{"evidence":"standard","x":{"evidence":"required"},"y":1,"y":2,"z":[{"evidence":1},{"evidence":2}]}');
    expect(r.evidence).toEqual(valid('standard'));
  });

  it('a __proto__ key is an own data property, never read as a known key', () => {
    const r = parsed('{"__proto__":{"evidence":"standard"},"compliance":["soc2"]}');
    expect(r.evidence).toEqual(ABSENT);
    expect(r.compliance).toEqual(valid(['soc2']));
  });

  it('collectDuplicateKeyPaths reports each duplicated path by its full key path', () => {
    const dups = LIB.collectDuplicateKeyPaths('{"a":1,"a":2,"b":{"c":1,"c":2},"d":[{"e":1,"e":2}],"s":"{\\"a\\":1}"}');
    expect(dups === null ? null : [...dups].sort()).toEqual(['["a"]', '["b","c"]', '["d","[]","e"]']);
  });

  it('collectDuplicateKeyPaths finds nothing in a file without duplicates', () => {
    expect(LIB.collectDuplicateKeyPaths(FULL)).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// parsePersonalBytes — the personal config.json, same rules
// ---------------------------------------------------------------------------

describe('parsePersonalBytes — the personal .devflow/config.json', () => {
  it('reads the tracker override as a provider id, as parseTrackerOverride does', () => {
    expect(personal('{"tracker":"github"}').tracker).toEqual(valid('github'));
    expect(personal('{"tracker":""}').tracker).toEqual(ABSENT);
    expect(personal('{}').tracker).toEqual(ABSENT);
    for (const bad of ['"gitlab"', '"GitHub"', '42', 'null', 'true', '["jira"]', '{"provider":"jira"}']) {
      expect(personal(`{"tracker":${bad}}`).tracker, bad).toEqual(MALFORMED);
    }
  });

  it('reads reviewPublication and features', () => {
    const r = personal('{"reviewPublication":"full","features":{"knowledge":false}}');
    expect(r.reviewPublication).toEqual(valid('full'));
    expect(r.features).toEqual(valid({ memory: ABSENT, learning: ABSENT, knowledge: valid(false) }));
  });

  it('never reads the retired top-level switches — features is a new namespace', () => {
    const r = personal('{"memory":false,"learning":false,"knowledge":false,"decisions":false,"autoCommit":true}');
    expect(r.features).toEqual(ABSENT);
    expect(Object.keys(r).sort()).toEqual(['features', 'kind', 'reviewPublication', 'tracker']);
  });

  it('does not read team keys (evidence, compliance) from a personal file', () => {
    const r = personal('{"evidence":"required","compliance":["gdpr"]}') as Record<string, unknown>;
    expect(r.evidence).toBeUndefined();
    expect(r.compliance).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The resolver reads project.json at every source
// ---------------------------------------------------------------------------

const DISABLED = { enabled: false, frameworks: [] as string[] };

/** The local, network-free default-branch lookup (D-OFFLINE-ORIGIN-HEAD), written out independently of the script. */
const ARGV_ORIGIN_HEAD = ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'];

/** origin/HEAD is not recorded in this clone: git answers exit 1 with nothing on stdout. */
const ORIGIN_HEAD_UNSET: ScriptedCall = { tool: 'git', args: ARGV_ORIGIN_HEAD, exit: 1 };
const REQ = 'ISSUE_REQUIRED=true APPLY_CONVENTIONS=true REQUIRE_NON_AUTHOR_APPROVAL=true';
const STD = 'ISSUE_REQUIRED=false APPLY_CONVENTIONS=false REQUIRE_NON_AUTHOR_APPROVAL=false';

const PROJECT = {
  required: '{"version":1,"evidence":"required"}\n',
  standard: '{"version":1,"evidence":"standard"}\n',
  malformed: '{"version":1,"evidence":"strict"}\n',
  duplicate: '{"evidence":"required","evidence":"standard"}\n',
  noEvidence: '{"version":1,"reviewPublication":"off"}\n',
  hipaa: '{"version":1,"compliance":["hipaa"]}\n',
  emptyCompliance: '{"version":1,"compliance":[]}\n',
  standardHipaa: '{"version":1,"evidence":"standard","compliance":["hipaa"]}\n',
} as const;

const POLICY = {
  required: '{"version":1,"evidencePolicy":"required"}\n',
  standard: '{"version":1,"evidencePolicy":"standard"}\n',
} as const;

const SUBPROCESS_TIMEOUT = { timeout: 20_000 } as const;

let tmp: string;
let home: string;
let root: string;
let binRoot: string;
let fakeBin: FakeBin;

beforeAll(() => {
  binRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-project-json-bin-'));
  fakeBin = createFakeBin(binRoot);
  warmFakeBin(fakeBin, binRoot);
}, WARM_HOOK_TIMEOUT_MS);

afterAll(() => {
  fs.rmSync(binRoot, { recursive: true, force: true });
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-project-json-'));
  home = path.join(tmp, 'home');
  root = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });
  fs.mkdirSync(root, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeDevflowFile(name: 'project.json' | 'policy.json', body: string | Buffer): string {
  fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
  const p = path.join(root, '.devflow', name);
  fs.writeFileSync(p, body);
  return p;
}

function lineFor(calls: readonly ScriptedCall[], compliance: unknown = DISABLED): string {
  const { exec } = scriptedExec(calls);
  return RESOLVER.formatLine(RESOLVER.resolve({ dir: root, compliance }, { exec }));
}

function e2e(calls: readonly ScriptedCall[]): RunResult & { log: string[][] } {
  const shim = buildScriptedShim(fakeBin, tmp, calls);
  return { ...runResolver({ home, args: [root], shim }), log: shim.readLog() };
}

describe('TP-29 (AC-25): the default branch\'s project.json governs; a PR worktree cannot lower it', () => {
  it('online: remote required, worktree project.json standard ⇒ required, SOURCE=file, flagged', () => {
    writeDevflowFile('project.json', PROJECT.standard);
    expect(lineFor(scenarioCalls({
      root, defaultBranch: 'main',
      remoteProject: { bytes: PROJECT.required }, headProject: { bytes: PROJECT.standard },
    }))).toBe(`EVIDENCE_POLICY=required SOURCE=file REF=main WARN=pr-changes-policy ${REQ}`);
  });

  it('online: a remote project.json standard governs even when the worktree has none', () => {
    expect(lineFor(scenarioCalls({
      root, defaultBranch: 'main', remoteProject: { bytes: PROJECT.standard }, head: 'absent',
    }))).toBe(`EVIDENCE_POLICY=standard SOURCE=file REF=main WARN=pr-changes-policy ${STD}`);
  });

  it('at one source, project.json evidence wins over policy.json — the legacy file is not even read', () => {
    writeDevflowFile('project.json', PROJECT.standard);
    const run = e2e(scenarioCalls({
      root, defaultBranch: 'main',
      remoteProject: { bytes: PROJECT.standard }, remote: { bytes: POLICY.required },
      headProject: { bytes: PROJECT.standard }, head: { bytes: POLICY.required },
    }));
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe(`EVIDENCE_POLICY=standard SOURCE=file REF=main ${STD}\n`);
    expect(run.log).toEqual([
      ['git', ...ARGV.toplevel],
      ['gh', ...ARGV.probe],
      ['gh', ...ARGV.contentsProject('main')],
      ['git', ...ARGV.headProjectBlob],
    ]);
  }, SUBPROCESS_TIMEOUT.timeout);

  it('a project.json without evidence leaves the SAME source to its policy.json — by presence, so required and invalid', () => {
    writeDevflowFile('project.json', PROJECT.noEvidence);
    writeDevflowFile('policy.json', POLICY.standard);
    expect(lineFor(scenarioCalls({
      root, defaultBranch: 'main',
      remoteProject: { bytes: PROJECT.noEvidence }, remote: { bytes: POLICY.standard },
      headProject: { bytes: PROJECT.noEvidence }, head: { bytes: POLICY.standard },
    }))).toBe(`EVIDENCE_POLICY=required SOURCE=invalid REF=main WARN=invalid-file ${REQ}`);
  });

  it('offline: the tracking copy\'s project.json raises a branch that lowered it', () => {
    writeDevflowFile('project.json', PROJECT.standard);
    expect(lineFor(scenarioCalls({
      root, lsRemoteBranch: 'main',
      tracking: 'absent', trackingProject: { bytes: PROJECT.required },
      head: 'absent', headProject: { bytes: PROJECT.standard },
    }))).toBe(`EVIDENCE_POLICY=required SOURCE=worktree REF=main WARN=remote-unavailable,pr-changes-policy ${REQ}`);
  });

  it('offline with no base: the worktree project.json governs', () => {
    // gh, ls-remote AND the local origin/HEAD all fail to name the default branch:
    // the residual case D-OFFLINE-ORIGIN-HEAD leaves as it was.
    writeDevflowFile('project.json', PROJECT.standard);
    expect(lineFor([ORIGIN_HEAD_UNSET, ...scenarioCalls({ root })]))
      .toBe(`EVIDENCE_POLICY=standard SOURCE=worktree REF=none WARN=remote-unavailable ${STD}`);
  });

  describe('D-OFFLINE-ORIGIN-HEAD: gh and ls-remote both fail, origin/HEAD is recorded locally', () => {
    /** Offline calls naming main through the local origin/HEAD, with main's tracking project.json. */
    const offlineViaOriginHead = (trackingProject: string, headProject: string = PROJECT.standard): ScriptedCall[] => [
      ...scenarioCalls({ root, headProject: { bytes: headProject } }),
      { tool: 'git', args: ARGV_ORIGIN_HEAD, stdout: 'refs/remotes/origin/main\n' },
      { tool: 'git', args: ARGV.verifyTracking('main'), stdout: '0123456789abcdef0123456789abcdef01234567\n' },
      { tool: 'git', args: ARGV.trackingProjectBlob('main'), stdout: trackingProject },
    ];

    it('main required, the branch standard ⇒ required: the tracking copy raises the branch', () => {
      writeDevflowFile('project.json', PROJECT.standard);
      const run = e2e(offlineViaOriginHead(PROJECT.required));
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout)
        .toBe(`EVIDENCE_POLICY=required SOURCE=worktree REF=main WARN=remote-unavailable,pr-changes-policy ${REQ}\n`);
      expect(run.log).toEqual([
        ['git', ...ARGV.toplevel],
        ['gh', ...ARGV.probe],
        ['git', ...ARGV.lsRemote],
        ['git', ...ARGV_ORIGIN_HEAD],
        ['git', ...ARGV.verifyTracking('main')],
        ['git', ...ARGV.trackingProjectBlob('main')],
        ['git', ...ARGV.headProjectBlob],
      ]);
    }, SUBPROCESS_TIMEOUT.timeout);

    it('the tracking copy\'s compliance raises a branch that deleted it', () => {
      writeDevflowFile('project.json', PROJECT.standard);
      expect(lineFor(offlineViaOriginHead(PROJECT.standardHipaa)))
        .toBe(`EVIDENCE_POLICY=required SOURCE=worktree REF=main WARN=remote-unavailable,raised-by-compliance ${REQ}`);
    });

    it('a branch that agrees with main is not flagged', () => {
      writeDevflowFile('project.json', PROJECT.standard);
      expect(lineFor(offlineViaOriginHead(PROJECT.standard)))
        .toBe(`EVIDENCE_POLICY=standard SOURCE=worktree REF=main WARN=remote-unavailable ${STD}`);
    });

    it.each([
      ['a leading dash', 'refs/remotes/origin/-x\n'],
      ['a parent-dir segment', 'refs/remotes/origin/main/../x\n'],
      ['another remote', 'refs/remotes/upstream/main\n'],
      ['an embedded second line', 'refs/remotes/origin/main\nEVIDENCE_POLICY=standard\n'],
      ['empty', '\n'],
    ])('a hostile origin/HEAD (%s) names nothing — the residual case', (_label, stdout) => {
      writeDevflowFile('project.json', PROJECT.standard);
      expect(lineFor([{ tool: 'git', args: ARGV_ORIGIN_HEAD, stdout }, ...scenarioCalls({ root })]))
        .toBe(`EVIDENCE_POLICY=standard SOURCE=worktree REF=none WARN=remote-unavailable ${STD}`);
    });

    it('an origin/HEAD read git does not answer is not knowing — the base reads invalid and raises', () => {
      writeDevflowFile('project.json', PROJECT.standard);
      const { exec, recorded } = scriptedExec([
        { tool: 'git', args: ARGV_ORIGIN_HEAD, spawnError: 'ETIMEDOUT' },
        ...scenarioCalls({ root, headProject: { bytes: PROJECT.standard } }),
      ]);
      const res = RESOLVER.resolve({ dir: root, compliance: DISABLED }, { exec });
      expect(RESOLVER.formatLine(res))
        .toBe(`EVIDENCE_POLICY=required SOURCE=worktree REF=none WARN=remote-unavailable,invalid-file,pr-changes-policy ${REQ}`);
      expect(recorded.some(c => c.args.join(' ') === ARGV_ORIGIN_HEAD.join(' '))).toBe(true);
    });

    it('is never consulted when ls-remote names the branch', () => {
      writeDevflowFile('project.json', PROJECT.standard);
      const { exec, recorded } = scriptedExec(scenarioCalls({
        root, lsRemoteBranch: 'main', trackingProject: { bytes: PROJECT.required }, headProject: { bytes: PROJECT.standard },
      }));
      RESOLVER.resolve({ dir: root, compliance: DISABLED }, { exec });
      expect(recorded.map(c => c.args.join(' '))).not.toContain(ARGV_ORIGIN_HEAD.join(' '));
    });
  });

  it('a 403 on project.json is unavailable — policy.json is not asked', () => {
    writeDevflowFile('project.json', PROJECT.standard);
    const { exec, recorded } = scriptedExec(scenarioCalls({
      root, defaultBranch: 'main', remoteProject: 'forbidden', remote: { bytes: POLICY.required }, tracking: 'no-ref',
    }));
    const res = RESOLVER.resolve({ dir: root, compliance: DISABLED }, { exec });
    expect(res.warnings).toContain('remote-unavailable');
    expect(recorded.some(c => c.args.join(' ') === ARGV.contents('main').join(' '))).toBe(false);
  });

  it('a 404 on project.json and a 403 on policy.json is unavailable (a half-read default branch is none)', () => {
    writeDevflowFile('project.json', PROJECT.standard);
    const res = RESOLVER.resolve({ dir: root, compliance: DISABLED }, {
      exec: scriptedExec(scenarioCalls({ root, defaultBranch: 'main', remoteProject: 'absent', remote: 'forbidden', tracking: 'no-ref' })).exec,
    });
    expect(res.source).toBe('worktree');
    expect(res.warnings).toContain('remote-unavailable');
  });

  it('a remote project.json over 64 KiB is ENOBUFS ⇒ invalid ⇒ required, never unavailable', () => {
    const run = e2e(scenarioCalls({
      root, defaultBranch: 'main', remoteProject: { bytes: 'x'.repeat(70_000) }, head: 'absent',
    }));
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe(`EVIDENCE_POLICY=required SOURCE=invalid REF=main WARN=invalid-file,pr-changes-policy ${REQ}\n`);
  }, SUBPROCESS_TIMEOUT.timeout);
});

describe('TP-30 (AC-26): malformed or duplicated evidence gives required', () => {
  it.each([
    ['malformed', PROJECT.malformed],
    ['duplicated', PROJECT.duplicate],
    ['not an object', '["evidence"]'],
    ['unparseable text around it', '{ "evidence": "standard", this is not json'],
  ])('worktree project.json with %s evidence ⇒ required, SOURCE=invalid', (_label, body) => {
    writeDevflowFile('project.json', body);
    expect(lineFor(scenarioCalls({ root })))
      .toBe(`EVIDENCE_POLICY=required SOURCE=invalid REF=none WARN=remote-unavailable,invalid-file ${REQ}`);
  });

  it('online: an unparseable remote project.json ⇒ required, SOURCE=invalid — never read as absent', () => {
    writeDevflowFile('project.json', PROJECT.standard);
    expect(lineFor(scenarioCalls({
      root, defaultBranch: 'main',
      remoteProject: { bytes: '{ "evidence": "standard", this is not json' }, remote: { bytes: POLICY.standard },
      headProject: { bytes: PROJECT.standard },
    }))).toBe(`EVIDENCE_POLICY=required SOURCE=invalid REF=main WARN=invalid-file,pr-changes-policy ${REQ}`);
  });

  it('offline: an unparseable tracking-copy project.json raises the worktree to required, flagged invalid-file', () => {
    writeDevflowFile('project.json', PROJECT.standard);
    expect(lineFor(scenarioCalls({
      root, lsRemoteBranch: 'main',
      tracking: { bytes: POLICY.standard }, trackingProject: { bytes: '{ this is not json' },
      head: 'absent', headProject: { bytes: PROJECT.standard },
    }))).toBe(`EVIDENCE_POLICY=required SOURCE=worktree REF=main WARN=remote-unavailable,invalid-file,pr-changes-policy ${REQ}`);
  });

  it('a malformed project.json evidence is never rescued by a valid policy.json beside it', () => {
    writeDevflowFile('project.json', PROJECT.duplicate);
    writeDevflowFile('policy.json', POLICY.standard);
    expect(lineFor(scenarioCalls({ root }))).toContain('EVIDENCE_POLICY=required SOURCE=invalid');
  });

  it('online: a duplicated remote evidence ⇒ required, SOURCE=invalid', () => {
    writeDevflowFile('project.json', PROJECT.duplicate);
    expect(lineFor(scenarioCalls({
      root, defaultBranch: 'main', remoteProject: { bytes: PROJECT.duplicate }, headProject: { bytes: PROJECT.duplicate },
    }))).toBe(`EVIDENCE_POLICY=required SOURCE=invalid REF=main WARN=invalid-file ${REQ}`);
  });

  it('the other keys of the same file still parse (the settings resolver consumes them)', () => {
    const r = parsed('{"evidence":"required","evidence":"standard","tracker":{"provider":"jira","key":"ACME"},'
      + '"features":{"learning":false}}');
    expect(r.evidence).toEqual(MALFORMED);
    expect(r.tracker).toEqual(valid({ provider: valid('jira'), site: ABSENT, key: valid('ACME') }));
    expect(r.features).toEqual(valid({ memory: ABSENT, learning: valid(false), knowledge: ABSENT }));
  });

  it.each([
    ['a symlink', (p: string) => { fs.symlinkSync(path.join(tmp, 'elsewhere.json'), p); }],
    ['a directory', (p: string) => { fs.mkdirSync(p); }],
    ['4097 bytes', (p: string) => { fs.writeFileSync(p, PROJECT.standard + ' '.repeat(4097 - PROJECT.standard.length)); }],
  ])('a worktree project.json that is %s is invalid, never opened as a file', (_label, make) => {
    fs.writeFileSync(path.join(tmp, 'elsewhere.json'), PROJECT.standard);
    fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
    make(path.join(root, '.devflow', 'project.json'));
    expect(lineFor(scenarioCalls({ root }))).toContain('EVIDENCE_POLICY=required SOURCE=invalid');
  });
});

describe('TP-31 (AC-27): repository compliance raises the floor (D-COMPLIANCE-REPO-FLOOR)', () => {
  it('worktree hipaa on a compliance-off machine ⇒ required, SOURCE=default', () => {
    writeDevflowFile('project.json', PROJECT.hipaa);
    expect(lineFor(scenarioCalls({ root })))
      .toBe(`EVIDENCE_POLICY=required SOURCE=default REF=none WARN=remote-unavailable ${REQ}`);
  });

  it('an empty compliance list still declares compliance ⇒ required', () => {
    writeDevflowFile('project.json', PROJECT.emptyCompliance);
    expect(lineFor(scenarioCalls({ root }))).toContain('EVIDENCE_POLICY=required SOURCE=default');
  });

  it('remote compliance alone raises a standard evidence, flagged raised-by-compliance', () => {
    writeDevflowFile('project.json', PROJECT.standard);
    expect(lineFor(scenarioCalls({
      root, defaultBranch: 'main', remoteProject: { bytes: PROJECT.standardHipaa }, headProject: { bytes: PROJECT.standardHipaa },
    }))).toBe(`EVIDENCE_POLICY=required SOURCE=file REF=main WARN=raised-by-compliance ${REQ}`);
  });

  it('offline: the tracking copy\'s compliance raises a branch that deleted it', () => {
    writeDevflowFile('project.json', PROJECT.standard);
    expect(lineFor(scenarioCalls({
      root, lsRemoteBranch: 'main', tracking: 'absent', trackingProject: { bytes: PROJECT.standardHipaa },
      head: 'absent', headProject: { bytes: PROJECT.standard },
    }))).toBe(`EVIDENCE_POLICY=required SOURCE=worktree REF=main WARN=remote-unavailable,raised-by-compliance ${REQ}`);
  });

  it('control: no compliance key anywhere and compliance off ⇒ standard', () => {
    writeDevflowFile('project.json', PROJECT.standard);
    expect(lineFor(scenarioCalls({ root }))).toContain('EVIDENCE_POLICY=standard');
  });

  it('HEAD\'s compliance alone does not raise (R, T and W decide; H is change detection only)', () => {
    writeDevflowFile('project.json', PROJECT.standard);
    expect(lineFor(scenarioCalls({
      root, defaultBranch: 'main', remoteProject: { bytes: PROJECT.standard }, headProject: { bytes: PROJECT.standardHipaa },
    }))).toBe(`EVIDENCE_POLICY=standard SOURCE=file REF=main ${STD}`);
  });
});

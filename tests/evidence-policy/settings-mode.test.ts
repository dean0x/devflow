/**
 * tests/evidence-policy/settings-mode.test.ts
 *
 * Suite for src/assets/scripts/resolve-settings.cjs — the LOCAL settings resolver
 * (D-SETTINGS-LOCAL-ONLY) that folds the worktree's `.devflow/project.json`, the
 * personal `.devflow/config.json` and ~/.devflow/manifest.json into one
 * closed-vocabulary line (D-SETTINGS-LINE).
 *
 *   - the grammar and the fail-closed line;
 *   - TP-32 (AC-28): the real script prints one line matching SETTINGS_LINE_RE,
 *     and the argv log holds only local git reads and no gh call;
 *   - TP-33 (AC-29): the publication truth table (D-PUBLICATION-CEILING) and the
 *     per-feature switch AND table (D-FEATURES-NARROW-ONLY), with the shared
 *     fixture table (TP-49) the shell gates will also run;
 *   - TP-37 (AC-32): a github machine's repository that selects jira resolves
 *     jira from the project (the session-start half is shell-hooks-tracker)
 *   - TP-31 (AC-27): repository compliance ids reach COMPLIANCE, an empty list is
 *     generic; D-LENS-UNION: the default branch's tracking copy stays in the lens;
 *   - D-PERSONAL-UNTRACKED: a config.json git tracks is ignored, with a warning;
 *   - the tracker rules, parity with the TypeScript machine-layer readers, the
 *     project.json suggestion, and the design-decision markers.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { COMPLIANCE_FRAMEWORKS, normalizeComplianceFeature, normalizeFrameworks } from '../../src/core/compliance.js';
import { isMachineFeatureOn, type MachineFeature } from '../../src/core/feature-switch.js';
import { machineGateLevel } from '../../src/core/gate-level.js';
import { normalizeTrackerFeature } from '../../src/core/tracker.js';
import { GATE_LEVEL_TABLE, MALFORMED_MACHINE_VALUES, MALFORMED_PERSONAL_VALUES } from '../fixtures/gate-level-table.js';
import { MANIFEST_ON, SETTINGS_SWITCH_TABLE } from '../fixtures/settings-switch-table.js';
import {
  ARGV,
  PROJECT_CONFIG_LIB,
  SETTINGS_SCRIPT,
  buildScriptedShim,
  createFakeBin,
  warmFakeBin,
  WARM_HOOK_TIMEOUT_MS,
  realGit,
  runResolver,
  scriptedExec,
  type ExecFn,
  type FakeBin,
  type ScriptedCall,
} from './scripted-shim.js';

// ---------------------------------------------------------------------------
// The .cjs seam (transcribed from its JSDoc typedefs)
// ---------------------------------------------------------------------------

type SwitchSource = 'machine' | 'project' | 'personal';

interface SwitchState {
  readonly on: boolean;
  readonly source: SwitchSource;
}

interface Settings {
  readonly ok: boolean;
  readonly tracker: 'github' | 'jira' | 'linear';
  readonly trackerSource: 'project' | 'personal' | 'machine' | 'default';
  readonly trackerWarn: 'none' | 'mismatch' | 'invalid';
  readonly site: string | null;
  readonly key: string | null;
  readonly reviewPublication: 'off' | 'auto' | 'full';
  readonly compliance: { readonly enabled: boolean; readonly frameworks: readonly string[] };
  readonly switches: { readonly memory: SwitchState; readonly learning: SwitchState; readonly knowledge: SwitchState };
  readonly gateLevel: 'full' | 'standard' | 'lean';
  readonly gateLevelSource: 'personal' | 'machine' | 'default' | null;
  readonly gateLevelInvalid: boolean;
  readonly gateLevelMachine: 'full' | 'standard' | 'lean' | 'invalid' | null;
  readonly repoCompliance: readonly string[] | null;
  readonly defaultBranchCompliance: readonly string[] | null;
  readonly personalTracked: boolean;
  readonly retiredPolicyFile: boolean;
  readonly unreadable: 'project' | 'personal' | null;
}

interface RepoLayers {
  readonly project: unknown;
  readonly personal: unknown;
  readonly personalTracked: boolean;
}

interface SettingsModule {
  readonly TRACKER_SOURCES: readonly string[];
  readonly TRACKER_WARNS: readonly string[];
  readonly EXIT_CODES: Readonly<Record<string, number>>;
  readonly SETTINGS_LINE_RE: RegExp;
  readonly SETTINGS_FAIL_CLOSED_LINE: string;
  machineGateLevel(manifest: unknown): 'full' | 'standard' | 'lean' | 'invalid' | null;
  foldSettings(inputs: { project: unknown; personal: unknown; manifest: unknown; retiredPolicyFile: boolean }): Settings;
  readRepoLayers(root: string, deps?: { exec?: ExecFn; rootConfirmed?: boolean }): RepoLayers;
  resolveSettings(opts: { dir: string; manifest?: unknown }, deps?: { exec?: ExecFn }): Settings;
  formatSettingsLine(s: Settings): string;
  isCoherentSettingsLine(line: unknown): boolean;
  serializeProjectSuggestion(input: unknown): string | null;
  main(argv: readonly string[], deps?: { exec?: ExecFn; formatLine?: (s: Settings) => unknown }): { code: number; line: string };
}

interface LibModule {
  parseProjectBytes(buf: unknown): { kind: string; evidence?: unknown; compliance?: unknown };
  parsePersonalBytes(buf: unknown): { kind: string };
  GATE_LEVELS: readonly string[];
}

const NODE_REQUIRE = createRequire(import.meta.url);
const SETTINGS = NODE_REQUIRE(SETTINGS_SCRIPT) as SettingsModule;
const LIB = NODE_REQUIRE(PROJECT_CONFIG_LIB) as LibModule;

const FAIL_CLOSED =
  'TRACKER=github TRACKER_SOURCE=default TRACKER_WARN=invalid SITE=none KEY=none '
  + 'REVIEW_PUBLICATION=off COMPLIANCE=generic MEMORY=on CURATION=on KNOWLEDGE=off GATE_LEVEL=full';

const DEFAULT_LINE =
  'TRACKER=github TRACKER_SOURCE=default TRACKER_WARN=none SITE=none KEY=none '
  + 'REVIEW_PUBLICATION=auto COMPLIANCE=off MEMORY=on CURATION=on KNOWLEDGE=on GATE_LEVEL=standard';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmp: string;
let home: string;
let root: string;
let binRoot: string;
let fakeBin: FakeBin;

beforeAll(() => {
  binRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-settings-bin-'));
  fakeBin = createFakeBin(binRoot);
  warmFakeBin(fakeBin, binRoot);
}, WARM_HOOK_TIMEOUT_MS);

afterAll(() => {
  fs.rmSync(binRoot, { recursive: true, force: true });
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-settings-'));
  home = path.join(tmp, 'home');
  root = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });
  fs.mkdirSync(root, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const TOPLEVEL = (dir: string): ScriptedCall => ({ tool: 'git', args: ARGV.toplevel, stdout: `${dir}\n` });
const NOT_A_REPO: ScriptedCall = { tool: 'git', args: ARGV.toplevel, exit: 128, stderr: 'fatal: not a git repository\n' };

// The resolver's other local reads, written out independently of the script.
/**
 * D-PERSONAL-UNTRACKED (#487): is anything git tracks reachable at the path the
 * personal file is opened at — the file in any spelling a case-folding file
 * system opens for it, or `.devflow` itself as a symlink, gitlink or file? One
 * call; any listed entry means tracked. APFS folds U+FB02 to "fl", U+FB01 to "fi"
 * and U+017F to "s", which git's ASCII-only `icase` does not. The call leads with
 * `--no-literal-pathspecs` so an inherited GIT_LITERAL_PATHSPECS=1 cannot turn the
 * magic pathspecs into plain paths.
 */
const FL = '\u{FB02}';
const FI = '\u{FB01}';
const LONG_S = '\u{17F}';
const ARGV_TRACKED = [
  '--no-literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--',
  ':(icase,literal).devflow/config.json',
  `:(icase,literal).devflow/con${FI}g.json`,
  `:(icase,literal).devflow/config.j${LONG_S}on`,
  `:(icase,literal).devflow/con${FI}g.j${LONG_S}on`,
  `:(icase,literal).dev${FL}ow/config.json`,
  `:(icase,literal).dev${FL}ow/con${FI}g.json`,
  `:(icase,literal).dev${FL}ow/config.j${LONG_S}on`,
  `:(icase,literal).dev${FL}ow/con${FI}g.j${LONG_S}on`,
  ':(icase,glob)[.]devflow',
  `:(icase,glob)[.]dev${FL}ow`,
];
/** D-LENS-UNION: the default branch this clone recorded for origin. */
const ARGV_ORIGIN_HEAD = ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'];

const TRACKED: ScriptedCall = { tool: 'git', args: ARGV_TRACKED, stdout: '.devflow/config.json\0' };
/** Exit 0 and nothing listed: no index entry reaches the path. */
const UNTRACKED: ScriptedCall = { tool: 'git', args: ARGV_TRACKED };
const ORIGIN_HEAD_UNSET: ScriptedCall = { tool: 'git', args: ARGV_ORIGIN_HEAD, exit: 1 };
const ORIGIN_HEAD = (branch: string): ScriptedCall => ({ tool: 'git', args: ARGV_ORIGIN_HEAD, stdout: `refs/remotes/origin/${branch}\n` });
/** The default branch's tracking copy of project.json: its bytes, or absent at that ref. */
const TRACKING_PROJECT = (branch: string, body: string | null): ScriptedCall => (body === null
  ? { tool: 'git', args: ARGV.trackingProjectBlob(branch), exit: 128, stderr: "fatal: path '.devflow/project.json' does not exist\n" }
  : { tool: 'git', args: ARGV.trackingProjectBlob(branch), stdout: body });

/**
 * Named collector: every logged call that is not one of the resolver's LOCAL git
 * reads (D-SETTINGS-LOCAL-ONLY) — any gh call, any other git subcommand (fetch,
 * ls-remote, status, a write), and a cat-file of anything but a tracking copy's
 * project.json.
 */
function collectNonLocalCalls(log: readonly string[][]): string[] {
  const LOCAL = new Set([ARGV.toplevel, ARGV_TRACKED, ARGV_ORIGIN_HEAD].map(a => a.join(' ')));
  const TRACKING_READ = /^cat-file blob refs\/remotes\/origin\/[A-Za-z0-9._/-]+:\.devflow\/project\.json$/;
  return log
    .filter(([tool, ...args]) => tool !== 'git' || !(LOCAL.has(args.join(' ')) || TRACKING_READ.test(args.join(' '))))
    .map(call => call.join(' '));
}

function writeRepoFile(name: 'project.json' | 'config.json' | 'policy.json', body: string | Buffer, dir = root): void {
  fs.mkdirSync(path.join(dir, '.devflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.devflow', name), body);
}

/**
 * resolveSettings in-process over a FRESH repository dir holding exactly these
 * files (or over `dir`, prepared by the caller). The manifest is ALWAYS explicit,
 * so no real manifest is read.
 */
function settingsFor(files: { project?: string; personal?: string }, manifest: unknown = MANIFEST_ON, dir?: string): Settings {
  const repo = dir ?? fs.mkdtempSync(path.join(tmp, 'repo-'));
  if (files.project !== undefined) writeRepoFile('project.json', files.project, repo);
  if (files.personal !== undefined) writeRepoFile('config.json', files.personal, repo);
  return SETTINGS.resolveSettings({ dir: repo, manifest }, { exec: scriptedExec([TOPLEVEL(repo), UNTRACKED]).exec });
}

function lineFor(files: { project?: string; personal?: string }, manifest: unknown = MANIFEST_ON): string {
  return SETTINGS.formatSettingsLine(settingsFor(files, manifest));
}

function fieldOf(line: string, key: string): string {
  const m = new RegExp(`(?:^| )${key}=([^ ]*)`).exec(line);
  return m === null ? '' : m[1];
}

/** The COMPLIANCE token a resolution prints. */
function complianceTokenOf(s: Settings): string {
  return fieldOf(SETTINGS.formatSettingsLine(s), 'COMPLIANCE');
}

/** A settings line with its COMPLIANCE field blanked — every field a broken file owns. */
function withoutCompliance(line: string): string {
  return line.replace(/ COMPLIANCE=[^ ]*/, ' COMPLIANCE=*');
}

// ---------------------------------------------------------------------------
// Module surface and the grammar (D-SETTINGS-LINE)
// ---------------------------------------------------------------------------

describe('module surface and SETTINGS_LINE_RE', () => {
  it('exports frozen vocabularies and the fail-closed line', () => {
    expect(Object.isFrozen(SETTINGS)).toBe(true);
    expect(SETTINGS.TRACKER_SOURCES).toEqual(['project', 'personal', 'machine', 'default']);
    expect(SETTINGS.TRACKER_WARNS).toEqual(['none', 'mismatch', 'invalid']);
    expect(Object.values(SETTINGS.EXIT_CODES).sort()).toEqual([0, 1, 2, 4, 5]);
    expect(SETTINGS.SETTINGS_FAIL_CLOSED_LINE).toBe(FAIL_CLOSED);
    expect(SETTINGS.SETTINGS_FAIL_CLOSED_LINE).toMatch(SETTINGS.SETTINGS_LINE_RE);
    expect(SETTINGS.isCoherentSettingsLine(FAIL_CLOSED)).toBe(true);
  });

  it('is pinned to its literal source — the text a consumer transcribes', () => {
    const IDS = 'gdpr|hipaa|pci-dss|soc2|iso-27001|sox';
    expect(SETTINGS.SETTINGS_LINE_RE.source).toBe(
      '^TRACKER=(?<tracker>github|jira|linear) TRACKER_SOURCE=(?<trackerSource>project|personal|machine|default)'
      + ' TRACKER_WARN=(?<trackerWarn>none|mismatch|invalid)'
      + ' SITE=(?<site>none|https:\\/\\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9-]+)+)'
      + ' KEY=(?<key>none|[A-Z][A-Z0-9_]{1,9}) REVIEW_PUBLICATION=(?<publication>off|auto|full)'
      + ` COMPLIANCE=(?<compliance>off|generic|(?:${IDS})(?:,(?:${IDS})){0,5})`
      + ' MEMORY=(?<memory>on|off) CURATION=(?<learning>on|off) KNOWLEDGE=(?<knowledge>on|off)'
      + ' GATE_LEVEL=(?<gateLevel>full|standard|lean)$',
    );
    expect(SETTINGS.SETTINGS_LINE_RE.flags).toBe('');
  });

  const GOOD = 'TRACKER=jira TRACKER_SOURCE=project TRACKER_WARN=none SITE=https://acme.atlassian.net KEY=ACME '
    + 'REVIEW_PUBLICATION=full COMPLIANCE=gdpr,hipaa MEMORY=on CURATION=off KNOWLEDGE=on GATE_LEVEL=lean';

  it('accepts a full line, every compliance id alone and each of the three levels', () => {
    expect(GOOD).toMatch(SETTINGS.SETTINGS_LINE_RE);
    for (const level of ['full', 'standard', 'lean']) {
      expect(GOOD.replace('GATE_LEVEL=lean', `GATE_LEVEL=${level}`)).toMatch(SETTINGS.SETTINGS_LINE_RE);
    }
    for (const fw of COMPLIANCE_FRAMEWORKS) {
      expect(DEFAULT_LINE.replace('COMPLIANCE=off', `COMPLIANCE=${fw.id}`)).toMatch(SETTINGS.SETTINGS_LINE_RE);
    }
    expect(DEFAULT_LINE.replace('COMPLIANCE=off', `COMPLIANCE=${COMPLIANCE_FRAMEWORKS.map(f => f.id).join(',')}`))
      .toMatch(SETTINGS.SETTINGS_LINE_RE);
  });

  it.each([
    ['a trailing space', `${GOOD} `],
    ['an embedded second line', `${GOOD}\nTRACKER=github`],
    ['an unknown tracker', GOOD.replace('TRACKER=jira', 'TRACKER=gitlab')],
    ['a site with a path', GOOD.replace('atlassian.net', 'atlassian.net/x')],
    ['a site with a space-separated field', GOOD.replace('atlassian.net', 'atlassian.net KEY=X')],
    ['a lowercase key', GOOD.replace('KEY=ACME', 'KEY=acme')],
    ['an unknown compliance id', GOOD.replace('gdpr,hipaa', 'gdpr,nist')],
    ['an empty compliance', GOOD.replace('COMPLIANCE=gdpr,hipaa', 'COMPLIANCE=')],
    ['publication stub', GOOD.replace('REVIEW_PUBLICATION=full', 'REVIEW_PUBLICATION=stub')],
    ['a switch spelled true', GOOD.replace('MEMORY=on', 'MEMORY=true')],
    ['reordered fields', GOOD.replace('MEMORY=on CURATION=off', 'CURATION=off MEMORY=on')],
    ['a missing field', GOOD.replace(' KNOWLEDGE=on', '')],
    ['a missing level', GOOD.replace(' GATE_LEVEL=lean', '')],
    ['a capitalised level', GOOD.replace('GATE_LEVEL=lean', 'GATE_LEVEL=Lean')],
    ['an unknown level', GOOD.replace('GATE_LEVEL=lean', 'GATE_LEVEL=minimal')],
    ['an empty level', GOOD.replace('GATE_LEVEL=lean', 'GATE_LEVEL=')],
    ['a level with a trailing run', GOOD.replace('GATE_LEVEL=lean', 'GATE_LEVEL=lean2')],
    ['a level with a trailing field', `${GOOD} EXTRA=1`],
    ['the level before the switches', GOOD.replace('MEMORY=on CURATION=off KNOWLEDGE=on GATE_LEVEL=lean', 'GATE_LEVEL=lean MEMORY=on CURATION=off KNOWLEDGE=on')],
    ['a level group left open', GOOD.replace('GATE_LEVEL=lean', 'GATE_LEVEL=lean full')],
  ])('rejects %s', (_label, line) => {
    expect(line).not.toMatch(SETTINGS.SETTINGS_LINE_RE);
  });

  it.each([
    ['github with a site', DEFAULT_LINE.replace('SITE=none', 'SITE=https://acme.atlassian.net')],
    ['github with a key', DEFAULT_LINE.replace('KEY=none', 'KEY=ACME')],
    ['a default source that is not github', DEFAULT_LINE.replace('TRACKER=github', 'TRACKER=jira')],
    ['compliance ids out of registry order', DEFAULT_LINE.replace('COMPLIANCE=off', 'COMPLIANCE=hipaa,gdpr')],
    ['a repeated compliance id', DEFAULT_LINE.replace('COMPLIANCE=off', 'COMPLIANCE=gdpr,gdpr')],
  ])('the coherence gate refuses a grammatical but incoherent line: %s', (_label, line) => {
    expect(line).toMatch(SETTINGS.SETTINGS_LINE_RE);
    expect(SETTINGS.isCoherentSettingsLine(line)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TP-32 (AC-28) — the real script: one line, one git call, zero gh calls
// ---------------------------------------------------------------------------

describe('TP-32 (AC-28): settings mode is local — one grammar line, local git reads only, zero gh calls', { timeout: 20_000 }, () => {
  function run(calls: readonly ScriptedCall[], args: readonly string[] = [root]) {
    const shim = buildScriptedShim(fakeBin, tmp, calls);
    const r = runResolver({ home, args, shim, script: SETTINGS_SCRIPT });
    return { ...r, log: shim.readLog() };
  }

  const SCENARIOS: ReadonlyArray<readonly [string, () => ScriptedCall[]]> = [
    ['an empty repository', () => [TOPLEVEL(root), ORIGIN_HEAD_UNSET]],
    ['a repository selecting jira with every key set', () => {
      writeRepoFile('project.json', JSON.stringify({
        version: 1, evidence: 'required', compliance: ['hipaa'],
        tracker: { provider: 'jira', site: 'https://acme.atlassian.net', key: 'ACME' },
        reviewPublication: 'off', features: { learning: false },
      }));
      writeRepoFile('config.json', '{"reviewPublication":"full","tracker":"linear"}');
      return [TOPLEVEL(root), UNTRACKED, ORIGIN_HEAD('main'), TRACKING_PROJECT('main', '{"compliance":["gdpr"]}')];
    }],
    ['hostile bytes in every file', () => {
      writeRepoFile('project.json', '{"tracker":{"provider":"jira\\nTRACKER=github","site":"https://x.io KEY=PWNED"}}');
      writeRepoFile('config.json', '{"tracker":"github SITE=https://evil.io"}');
      return [TOPLEVEL(root), UNTRACKED, ORIGIN_HEAD('main'), TRACKING_PROJECT('main', '{"compliance":["x\\nKEY=PWNED"]}')];
    }],
    ['not a repository', () => [NOT_A_REPO]],
  ];

  it.each(SCENARIOS)('%s', (_label, setup) => {
    const calls = setup();
    const r = run(calls);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.endsWith('\n')).toBe(true);
    const lines = r.stdout.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(SETTINGS.SETTINGS_LINE_RE);
    expect(r.log.length).toBeGreaterThan(0);
    expect(r.log.filter(call => call[0] === 'gh')).toEqual([]);
    expect(collectNonLocalCalls(r.log)).toEqual([]);
    expect(r.stdout).not.toContain('PWNED');
    expect(r.stdout).not.toContain('evil');
  });

  it('known-bad probe: the collector reports gh, a network or index-refreshing git call and a symref write', () => {
    const bad = [
      ['gh', 'api', 'repos/{owner}/{repo}'],
      ['git', 'fetch', 'origin'],
      ['git', 'ls-remote', '--symref', 'origin', 'HEAD'],
      ['git', 'status', '--porcelain'],
      ['git', 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/x'],
      ['git', 'cat-file', 'blob', 'HEAD:.devflow/project.json'],
    ];
    expect(collectNonLocalCalls([...bad, ['git', ...ARGV.toplevel]])).toHaveLength(bad.length);
  });

  it('the exact local sequences: config.json is checked for tracking only when it exists; the tracking copy only when origin/HEAD names it', () => {
    expect(run([TOPLEVEL(root), ORIGIN_HEAD_UNSET]).log)
      .toEqual([['git', ...ARGV.toplevel], ['git', ...ARGV_ORIGIN_HEAD]]);

    writeRepoFile('config.json', '{"reviewPublication":"off"}');
    expect(run([TOPLEVEL(root), UNTRACKED, ORIGIN_HEAD('main'), TRACKING_PROJECT('main', null)]).log).toEqual([
      ['git', ...ARGV.toplevel],
      ['git', ...ARGV_TRACKED],
      ['git', ...ARGV_ORIGIN_HEAD],
      ['git', ...ARGV.trackingProjectBlob('main')],
    ]);

    expect(run([NOT_A_REPO]).log).toEqual([['git', ...ARGV.toplevel]]);
  });

  it('writes nothing: the repository and HOME are unchanged by a run', () => {
    writeRepoFile('project.json', '{"version":1,"compliance":["hipaa"]}');
    writeRepoFile('config.json', '{"reviewPublication":"full"}');
    const snapshot = (dir: string): string[] => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
      .map(e => {
        const full = path.join(e.parentPath, e.name);
        return `${path.relative(dir, full)} ${e.isFile() ? fs.readFileSync(full, 'utf8') : ''}`;
      })
      .sort();
    const before = [snapshot(root), snapshot(home)];
    const r = run([TOPLEVEL(root), UNTRACKED, ORIGIN_HEAD_UNSET]);
    expect(r.status, r.stderr).toBe(0);
    expect([snapshot(root), snapshot(home)]).toEqual(before);
  });

  it('the jira repository resolves exactly — the project selects the provider on a github machine', () => {
    writeRepoFile('project.json', JSON.stringify({
      version: 1, compliance: ['hipaa'],
      tracker: { provider: 'jira', site: 'https://acme.atlassian.net', key: 'ACME' },
      reviewPublication: 'off', features: { learning: false },
    }));
    const r = run([TOPLEVEL(root), ORIGIN_HEAD_UNSET]);
    expect(r.stdout).toBe('TRACKER=jira TRACKER_SOURCE=project TRACKER_WARN=none SITE=https://acme.atlassian.net KEY=ACME '
      + 'REVIEW_PUBLICATION=off COMPLIANCE=hipaa MEMORY=on CURATION=off KNOWLEDGE=on GATE_LEVEL=standard\n');
  });

  it('TP-37 (AC-32): a github machine whose project.json selects jira resolves jira from the project', () => {
    // The resolver half of TP-37; the session-start gate half — the directive
    // naming jira's conventions file — is tests/shell-hooks-tracker.test.ts.
    fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), JSON.stringify({
      features: { tracker: { provider: 'github' } },
    }));
    writeRepoFile('project.json', JSON.stringify({ version: 1, tracker: { provider: 'jira' } }));
    const r = run([TOPLEVEL(root), ORIGIN_HEAD_UNSET]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^TRACKER=jira TRACKER_SOURCE=project TRACKER_WARN=none /);
  });

  it('reads the machine manifest from $HOME/.devflow for itself', () => {
    fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), JSON.stringify({
      features: { memory: false, tracker: { provider: 'linear' }, compliance: { enabled: true, frameworks: ['soc2'] } },
    }));
    const r = run([TOPLEVEL(root), ORIGIN_HEAD_UNSET]);
    expect(r.stdout).toBe('TRACKER=linear TRACKER_SOURCE=machine TRACKER_WARN=none SITE=none KEY=none '
      + 'REVIEW_PUBLICATION=auto COMPLIANCE=soc2 MEMORY=off CURATION=on KNOWLEDGE=on GATE_LEVEL=standard\n');
  });

  it('exit arms: usage prints nothing; an unusable dir and an unanswering git print the fail-closed line', () => {
    const usage = run([TOPLEVEL(root)], ['--settings']);
    expect(usage.status).toBe(1);
    expect(usage.stdout).toBe('');

    const missing = run([TOPLEVEL(root)], [path.join(tmp, 'nope')]);
    expect(missing.status).toBe(2);
    expect(missing.stdout).toBe(`${FAIL_CLOSED}\n`);

    const unusableRoot = run([{ tool: 'git', args: ARGV.toplevel, stdout: 'relative/path\n' }]);
    expect(unusableRoot.status).toBe(4);
    expect(unusableRoot.stdout).toBe(`${FAIL_CLOSED}\n`);
  });
});

describe('fail-closed in-process', () => {
  it.each(['ENOENT', 'ETIMEDOUT', 'ENOBUFS'])('git %s ⇒ the fail-closed resolution', (code) => {
    const s = SETTINGS.resolveSettings({ dir: root, manifest: MANIFEST_ON }, {
      exec: scriptedExec([{ tool: 'git', args: ARGV.toplevel, spawnError: code }]).exec,
    });
    expect(s.ok).toBe(false);
    expect(SETTINGS.formatSettingsLine(s)).toBe(FAIL_CLOSED);
  });

  it('a throwing exec fails closed rather than throwing', () => {
    const s = SETTINGS.resolveSettings({ dir: root, manifest: MANIFEST_ON }, { exec: () => { throw new Error('seeded'); } });
    expect(SETTINGS.formatSettingsLine(s)).toBe(FAIL_CLOSED);
  });

  it('main(): an injected hostile formatter is refused with exit 5', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = SETTINGS.main(['node', SETTINGS_SCRIPT, root], {
      exec: scriptedExec([TOPLEVEL(root), UNTRACKED]).exec,
      formatLine: () => `${DEFAULT_LINE}\nTRACKER=jira`,
    });
    expect(out).toEqual({ code: 5, line: FAIL_CLOSED });
  });

  it('not a repository ⇒ the machine layer alone', () => {
    const s = SETTINGS.resolveSettings({ dir: root, manifest: { features: { knowledge: false } } }, {
      exec: scriptedExec([NOT_A_REPO]).exec,
    });
    expect(SETTINGS.formatSettingsLine(s)).toBe(DEFAULT_LINE.replace('KNOWLEDGE=on', 'KNOWLEDGE=off'));
  });
});

// ---------------------------------------------------------------------------
// TP-33 (AC-29) — the publication truth table (D-PUBLICATION-CEILING)
// ---------------------------------------------------------------------------

describe('TP-33 (AC-29): review publication = min(team ?? full, personal ?? auto)', () => {
  type Value = 'off' | 'auto' | 'full' | 'absent' | 'malformed';
  const RAW: Record<Exclude<Value, 'absent'>, string> = {
    off: '"off"', auto: '"auto"', full: '"full"', malformed: '"everyone"',
  };
  const body = (v: Value): string | undefined => (v === 'absent' ? '{}' : `{"reviewPublication":${RAW[v]}}`);

  // Written out, not computed: the table IS the specification.
  const TABLE: ReadonlyArray<readonly [Value, Value, 'off' | 'auto' | 'full']> = [
    // team,       personal,    result
    ['absent', 'absent', 'auto'],
    ['absent', 'off', 'off'],
    ['absent', 'auto', 'auto'],
    ['absent', 'full', 'full'],
    ['absent', 'malformed', 'auto'],
    ['off', 'absent', 'off'],
    ['off', 'off', 'off'],
    ['off', 'auto', 'off'],
    ['off', 'full', 'off'],
    ['off', 'malformed', 'off'],
    ['auto', 'absent', 'auto'],
    ['auto', 'off', 'off'],
    ['auto', 'auto', 'auto'],
    ['auto', 'full', 'auto'],
    ['auto', 'malformed', 'auto'],
    ['full', 'absent', 'auto'],
    ['full', 'off', 'off'],
    ['full', 'auto', 'auto'],
    ['full', 'full', 'full'],
    ['full', 'malformed', 'auto'],
    ['malformed', 'absent', 'off'],
    ['malformed', 'off', 'off'],
    ['malformed', 'auto', 'off'],
    ['malformed', 'full', 'off'],
    ['malformed', 'malformed', 'off'],
  ];

  it.each(TABLE)('team %s × personal %s ⇒ %s', (team, own, expected) => {
    expect(settingsFor({ project: body(team), personal: body(own) }).reviewPublication).toBe(expected);
  });

  it('the AC-29 rows by name', () => {
    expect(settingsFor({ project: '{"reviewPublication":"off"}', personal: '{"reviewPublication":"full"}' }).reviewPublication)
      .toBe('off');
    expect(settingsFor({ personal: '{"reviewPublication":"full"}' }).reviewPublication).toBe('full');
    expect(settingsFor({}).reviewPublication).toBe('auto');
  });

  it('an unreadable project.json or config.json publishes nothing — the resolution fails closed', () => {
    expect(settingsFor({ project: '{"reviewPublication":', personal: '{"reviewPublication":"full"}' }).reviewPublication)
      .toBe('off');
    expect(settingsFor({ project: '{"reviewPublication":"full"}', personal: '{"reviewPublication":' }).reviewPublication)
      .toBe('off');
  });

  it('a branch cannot raise publication: a committed team "full" never lifts a run above auto on its own', () => {
    // A contributor's PR that commits `"reviewPublication":"full"` must not make
    // a maintainer's local run of that branch skip the visibility gate.
    for (const personal of [undefined, '{}', '{"reviewPublication":"auto"}', '{"reviewPublication":"everyone"}']) {
      expect(settingsFor({ project: '{"reviewPublication":"full"}', personal }).reviewPublication, String(personal))
        .toBe('auto');
    }
    // Only the personal layer asks for full, and the team can still lower it.
    expect(settingsFor({ project: '{"reviewPublication":"full"}', personal: '{"reviewPublication":"full"}' }).reviewPublication)
      .toBe('full');
    expect(settingsFor({ project: '{"reviewPublication":"auto"}', personal: '{"reviewPublication":"full"}' }).reviewPublication)
      .toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// D-PERSONAL-UNTRACKED — a config.json git tracks is not personal
// ---------------------------------------------------------------------------

describe('D-PERSONAL-UNTRACKED: a tracked .devflow/config.json is ignored, with a warning', () => {
  /** resolveSettings over a fresh repo, config.json tracked or not per `tracking`. */
  function resolveWith(files: { project?: string; personal: string }, tracking: ScriptedCall, manifest: unknown = MANIFEST_ON): Settings {
    const repo = fs.mkdtempSync(path.join(tmp, 'tracked-'));
    if (files.project !== undefined) writeRepoFile('project.json', files.project, repo);
    writeRepoFile('config.json', files.personal, repo);
    return SETTINGS.resolveSettings({ dir: repo, manifest }, { exec: scriptedExec([TOPLEVEL(repo), tracking]).exec });
  }

  it('a committed reviewPublication "full" resolves the ceiling default, auto', () => {
    const tracked = resolveWith({ personal: '{"reviewPublication":"full"}' }, TRACKED);
    expect(tracked.reviewPublication).toBe('auto');
    expect(tracked.personalTracked).toBe(true);
    expect(tracked.ok).toBe(true);
    // Control: the same bytes untracked are the user's own and ask for full.
    const own = resolveWith({ personal: '{"reviewPublication":"full"}' }, UNTRACKED);
    expect(own.reviewPublication).toBe('full');
    expect(own.personalTracked).toBe(false);
  });

  it('is ignored entirely — tracker override and switch narrowing too, exactly as if absent', () => {
    const JIRA = '{"tracker":{"provider":"jira","key":"ACME"}}';
    const personal = '{"tracker":"github","reviewPublication":"off","features":{"knowledge":false}}';
    const tracked = resolveWith({ project: JIRA, personal }, TRACKED);
    const absent = settingsFor({ project: JIRA });
    expect(SETTINGS.formatSettingsLine(tracked)).toBe(SETTINGS.formatSettingsLine(absent));
  });

  it('a tracked copy is ignored even when its bytes are unreadable — it is never read', () => {
    const s = resolveWith({ personal: '{ this is not json' }, TRACKED);
    expect(s.ok).toBe(true);
    expect(s.unreadable).toBeNull();
    expect(s.personalTracked).toBe(true);
    expect(SETTINGS.formatSettingsLine(s)).toBe(DEFAULT_LINE);
  });

  it('a tracking check git does not answer fails the personal fields closed', () => {
    const s = resolveWith({ personal: '{"reviewPublication":"full"}' },
      { tool: 'git', args: ARGV_TRACKED, spawnError: 'ETIMEDOUT' });
    expect(s.unreadable).toBe('personal');
    expect(s.reviewPublication).toBe('off');
  });

  it('a tracking check that answers non-zero inside the confirmed repository fails the personal fields closed', () => {
    const s = resolveWith({ personal: '{"reviewPublication":"full"}' },
      { tool: 'git', args: ARGV_TRACKED, exit: 128, stderr: 'fatal: index file corrupt\n' });
    expect(s.unreadable).toBe('personal');
    expect(s.reviewPublication).toBe('off');
  });

  describe('the tracking check (#487): one bounded git read, answered from what it lists', () => {
    /**
     * What the check reads `call` as, through the hooks' seam (the default) or with
     * the root already confirmed as resolveSettings has it. The check must be made
     * exactly once, as scripted.
     */
    const answer = (call: ScriptedCall, rootConfirmed = false): string => {
      writeRepoFile('config.json', '{"reviewPublication":"full"}');
      const { exec, recorded } = scriptedExec([call]);
      const layers = SETTINGS.readRepoLayers(root, { exec, rootConfirmed });
      expect(recorded.map(c => [c.file, ...c.args])).toEqual([['git', ...ARGV_TRACKED]]);
      if (layers.personalTracked) return 'tracked';
      return (layers.personal as { kind: string }).kind === 'invalid' ? 'unknown' : 'untracked';
    };

    it('is a single git call with literal pathspecs off, the fsmonitor override and bounded case-insensitive pathspecs', () => {
      writeRepoFile('config.json', '{}');
      const { exec, recorded } = scriptedExec([UNTRACKED]);
      SETTINGS.readRepoLayers(root, { exec });
      expect(recorded.map(c => [c.file, ...c.args])).toEqual([['git', ...ARGV_TRACKED]]);
      const opts = recorded[0].opts;
      expect(opts.timeout).toBe(5000);
      expect(opts.maxBuffer).toBe(4096);
      expect(opts.shell).toBe(false);
    });

    it.each([
      ['a file entry in any letter case', '.devflow/CONFIG.json\0'],
      ['a directory-case variant', '.DEVFLOW/config.json\0'],
      ['an entry named .devflow itself (symlink, gitlink or file)', '.devflow\0'],
      ['several entries at once', '.DEVFLOW\0.devflow/Config.json\0'],
    ])('lists %s => tracked', (_name, stdout) => {
      expect(answer({ tool: 'git', args: ARGV_TRACKED, stdout })).toBe('tracked');
    });

    it('lists nothing (exit 0) => untracked', () => {
      expect(answer(UNTRACKED)).toBe('untracked');
    });

    it('answers non-zero with a root the caller did not confirm (the hooks, outside a repository, 128) => untracked: there is nothing to track', () => {
      expect(answer({ tool: 'git', args: ARGV_TRACKED, exit: 128, stderr: 'fatal: not a git repository\n' })).toBe('untracked');
    });

    it('answers non-zero with the root confirmed as a repository (git cannot read its index) => unknown, so the keys fail closed', () => {
      expect(answer({ tool: 'git', args: ARGV_TRACKED, exit: 128, stderr: 'fatal: index file corrupt\n' }, true)).toBe('unknown');
    });

    it.each([false, true])('lists an entry yet exits non-zero (rootConfirmed %s) => tracked: a listed entry is tracked whatever the exit', (rootConfirmed) => {
      expect(answer({ tool: 'git', args: ARGV_TRACKED, exit: 1, stdout: '.devflow/config.json\0' }, rootConfirmed)).toBe('tracked');
    });

    it.each([false, true])('lists nothing and exits 0 (rootConfirmed %s) => untracked', (rootConfirmed) => {
      expect(answer(UNTRACKED, rootConfirmed)).toBe('untracked');
    });

    it.each([false, true])('a listing past the bound overflows, is unanswered, and fails closed rather than reading the file (rootConfirmed %s)', (rootConfirmed) => {
      const flood = '.devflow/CONFIG.json\0'.repeat(300);
      expect(Buffer.byteLength(flood)).toBeGreaterThan(4096);
      expect(answer({ tool: 'git', args: ARGV_TRACKED, stdout: flood }, rootConfirmed)).toBe('unknown');
    });
  });

  it('main(): the line resolves auto and stderr tells the user to untrack the file', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    writeRepoFile('config.json', '{"reviewPublication":"full"}');
    const out = SETTINGS.main(['node', SETTINGS_SCRIPT, root], {
      exec: scriptedExec([TOPLEVEL(root), TRACKED, ORIGIN_HEAD_UNSET]).exec,
    });
    expect(out.code).toBe(0);
    expect(fieldOf(out.line, 'REVIEW_PUBLICATION')).toBe('auto');
    const text = stderr.mock.calls.map(c => String(c[0])).join('');
    expect(text).toContain('Git tracks an entry at or under .devflow/config.json, so devflow ignores that file.');
    expect(text).toContain('Untrack it with: git rm --cached <entry>.');
    expect(text).toContain('Untracking leaves the committed bytes on disk as your personal file.');
  });

  it('main(): an untracked config.json prints no warning', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    writeRepoFile('config.json', '{"reviewPublication":"full"}');
    const out = SETTINGS.main(['node', SETTINGS_SCRIPT, root], {
      exec: scriptedExec([TOPLEVEL(root), UNTRACKED, ORIGIN_HEAD_UNSET]).exec,
    });
    expect(fieldOf(out.line, 'REVIEW_PUBLICATION')).toBe('full');
    expect(stderr.mock.calls.map(c => String(c[0])).join('')).toBe('');
  });

  describe('the real script over a real repository', { timeout: 30_000 }, () => {
    it('the #406 repro: a config.json committed with git add -f no longer prints REVIEW_PUBLICATION=full', () => {
      const repo = fs.mkdtempSync(path.join(tmp, 'real-tracked-'));
      realGit(repo, home, ['init', '-q', '-b', 'main']);
      fs.writeFileSync(path.join(repo, '.gitignore'), '.devflow/\n');
      writeRepoFile('config.json', '{"reviewPublication":"full"}\n', repo);
      realGit(repo, home, ['add', '-f', '.devflow/config.json']);
      realGit(repo, home, ['commit', '-q', '-m', 'sneak a personal file in']);

      const tracked = runResolver({ home, args: [repo], script: SETTINGS_SCRIPT });
      expect(tracked.status, tracked.stderr).toBe(0);
      expect(fieldOf(tracked.stdout.trim(), 'REVIEW_PUBLICATION')).toBe('auto');
      expect(tracked.stderr).toContain('Untrack it with: git rm --cached <entry>.');

      // Untracked (the remedy the warning names), the same bytes are personal again.
      realGit(repo, home, ['rm', '-q', '--cached', '.devflow/config.json']);
      const own = runResolver({ home, args: [repo], script: SETTINGS_SCRIPT });
      expect(fieldOf(own.stdout.trim(), 'REVIEW_PUBLICATION')).toBe('full');
      expect(own.stderr).toBe('');
    });

    it('the tracking check never runs the repository\'s core.fsmonitor hook — a plain ls-files would', () => {
      const repo = fs.mkdtempSync(path.join(tmp, 'real-fsmonitor-'));
      const marker = path.join(tmp, 'fsmonitor-ran');
      const hook = path.join(tmp, 'fsmonitor-hook.sh');
      fs.writeFileSync(hook, `#!/bin/sh\necho ran >> '${marker}'\nexit 1\n`);
      fs.chmodSync(hook, 0o755);
      realGit(repo, home, ['init', '-q', '-b', 'main']);
      writeRepoFile('config.json', '{"reviewPublication":"full"}\n', repo);
      realGit(repo, home, ['add', '-f', '.devflow/config.json']);
      realGit(repo, home, ['commit', '-q', '-m', 'tracked personal file']);
      realGit(repo, home, ['config', 'core.fsmonitor', hook]);

      const run = runResolver({ home, args: [repo], script: SETTINGS_SCRIPT });
      expect(run.status, run.stderr).toBe(0);
      expect(fieldOf(run.stdout.trim(), 'REVIEW_PUBLICATION')).toBe('auto');
      expect(fs.existsSync(marker), 'the resolver ran the fsmonitor hook').toBe(false);

      // Known-bad probe: the same index read without the override runs the hook.
      realGit(repo, home, ['ls-files', '--error-unmatch', '--', '.devflow/config.json']);
      expect(fs.existsSync(marker)).toBe(true);
    });
  });

  // #487: committed bytes must never reach the personal layer, whatever layout
  // carries them to the path the resolver opens. The control rows come first:
  // the hardening must not turn a user's own file into a tracked one.
  describe('#487: committed content reaching the personal path by another layout', { timeout: 60_000 }, () => {
    const FULL = '{"reviewPublication":"full"}\n';

    /** Whether the file system under `dir` opens the name `written` when asked for `asked`. */
    function opensAs(dir: string, written: string, asked: string): boolean {
      const probe = path.join(dir, written);
      fs.writeFileSync(probe, '');
      try {
        return fs.existsSync(path.join(dir, asked));
      } finally {
        fs.rmSync(probe, { force: true });
      }
    }
    /** Whether a probe directory under the system temp folder passes `check`. */
    function probeTmp(check: (dir: string) => boolean): boolean {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-case-probe-'));
      try {
        return check(dir);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    /**
     * Which arm runs where. The `index-only` rows hold on EVERY file system: the
     * file the resolver opens sits at the exact-case path and the index names the
     * case variant, which is the state a checkout makes on a case-insensitive file
     * system and the state a case-sensitive one reaches when a branch commits a
     * variant beside the user's own file. The `checkout` rows commit the variant
     * on disk too, so they need a file system where `config.json` opens
     * `CONFIG.json` (APFS and NTFS by default; ext4 does not) — or, for the
     * Unicode rows, `config.jſon` (APFS) — and are skipped elsewhere (Linux CI)
     * rather than passing empty.
     */
    const CASE_FOLDING_FS = probeTmp(dir => opensAs(dir, 'CaseProbe', 'caseprobe'));
    const UNICODE_FOLDING_FS = probeTmp(dir => opensAs(dir, `j${LONG_S}on`, 'json'));

    function freshRepo(label: string): string {
      const repo = fs.mkdtempSync(path.join(tmp, `real-${label}-`));
      realGit(repo, home, ['init', '-q', '-b', 'main']);
      return repo;
    }
    function writeAt(repo: string, rel: string, body: string): void {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), body);
    }
    /** Index `rel` with `mode` and the blob of `body`, leaving the working tree alone. */
    function indexOnly(repo: string, mode: string, rel: string, body: string): void {
      const scratch = path.join(tmp, `blob-${path.basename(repo)}`);
      fs.writeFileSync(scratch, body);
      const sha = realGit(repo, home, ['hash-object', '-w', '--', scratch]).trim();
      realGit(repo, home, ['update-index', '--add', '--cacheinfo', `${mode},${sha},${rel}`]);
    }
    function commitAll(repo: string, paths: readonly string[]): void {
      realGit(repo, home, ['add', '-f', '--', ...paths]);
      realGit(repo, home, ['commit', '-q', '-m', 'commit the layout']);
    }
    /** The hooks' seam, read in this process with `env` set for the one call. */
    function layersUnder(repo: string, env: Readonly<Record<string, string>>): RepoLayers {
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
      try {
        return SETTINGS.readRepoLayers(repo);
      } finally {
        vi.unstubAllEnvs();
      }
    }
    /** The personal layer counts as absent: the ceiling holds, the warning prints, the hooks' seam agrees. */
    function expectPersonalIgnored(repo: string, env: Readonly<Record<string, string>> = {}): void {
      const run = runResolver({ home, args: [repo], script: SETTINGS_SCRIPT, extraEnv: env });
      expect(run.status, run.stderr).toBe(0);
      expect(fieldOf(run.stdout.trim(), 'REVIEW_PUBLICATION')).toBe('auto');
      expect(run.stderr).toContain('Git tracks an entry at or under .devflow/config.json, so devflow ignores that file.');
      const layers = layersUnder(repo, env);
      expect(layers.personalTracked).toBe(true);
      expect(layers.personal).toEqual({ kind: 'absent' });
    }
    function expectPersonalApplies(repo: string, env: Readonly<Record<string, string>> = {}): void {
      const run = runResolver({ home, args: [repo], script: SETTINGS_SCRIPT, extraEnv: env });
      expect(run.status, run.stderr).toBe(0);
      expect(fieldOf(run.stdout.trim(), 'REVIEW_PUBLICATION')).toBe('full');
      expect(run.stderr).toBe('');
      expect(layersUnder(repo, env).personalTracked).toBe(false);
    }

    it('control: an untracked config.json beside a tracked project.json and tracked siblings still applies', () => {
      const repo = freshRepo('control');
      writeAt(repo, '.devflow/project.json', '{}\n');
      writeAt(repo, '.devflow/features/a/KNOWLEDGE.md', '# a\n');
      writeAt(repo, '.devflow/conventions.md', '# c\n');
      commitAll(repo, ['.devflow/project.json', '.devflow/features/a/KNOWLEDGE.md', '.devflow/conventions.md']);
      writeAt(repo, '.devflow/config.json', FULL);
      expectPersonalApplies(repo);
    });

    it('control: an untracked .devflow symlink to a private directory still applies (only a tracked link is refused)', () => {
      const repo = freshRepo('private-link');
      const privateDir = fs.mkdtempSync(path.join(tmp, 'private-df-'));
      fs.writeFileSync(path.join(privateDir, 'config.json'), FULL);
      fs.symlinkSync(privateDir, path.join(repo, '.devflow'));
      expectPersonalApplies(repo);
    });

    it('layout 1: .devflow is a committed symlink to a committed directory', () => {
      const repo = freshRepo('link');
      writeAt(repo, 'vendor/df/config.json', FULL);
      fs.symlinkSync(path.join('vendor', 'df'), path.join(repo, '.devflow'));
      commitAll(repo, ['.devflow', 'vendor/df/config.json']);
      expectPersonalIgnored(repo);
    });

    it('layout 2 (index-only, every file system): the index names .devflow/CONFIG.json beside the opened config.json', () => {
      const repo = freshRepo('file-case-index');
      writeAt(repo, '.devflow/config.json', FULL);
      indexOnly(repo, '100644', '.devflow/CONFIG.json', FULL);
      expectPersonalIgnored(repo);
    });

    it.runIf(CASE_FOLDING_FS)('layout 2 (checkout, case-folding file system only): a committed .devflow/CONFIG.json opens as config.json', () => {
      const repo = freshRepo('file-case-checkout');
      writeAt(repo, '.devflow/CONFIG.json', FULL);
      commitAll(repo, ['.devflow/CONFIG.json']);
      expectPersonalIgnored(repo);
    });

    it('layout 3 (index-only, every file system): the index names .DEVFLOW/config.json beside the opened config.json', () => {
      const repo = freshRepo('dir-case-index');
      writeAt(repo, '.devflow/config.json', FULL);
      indexOnly(repo, '100644', '.DEVFLOW/config.json', FULL);
      expectPersonalIgnored(repo);
    });

    it.runIf(CASE_FOLDING_FS)('layout 3 (checkout, case-folding file system only): a committed .DEVFLOW/config.json opens as .devflow/config.json', () => {
      const repo = freshRepo('dir-case-checkout');
      writeAt(repo, '.DEVFLOW/config.json', FULL);
      commitAll(repo, ['.DEVFLOW/config.json']);
      expectPersonalIgnored(repo);
    });

    it('layout 3b (index-only): a committed .DEVFLOW symlink reaches the opened path through the link', () => {
      const repo = freshRepo('dir-case-link');
      writeAt(repo, 'vendor/df/config.json', FULL);
      indexOnly(repo, '120000', '.DEVFLOW', 'vendor/df');
      fs.symlinkSync(path.join('vendor', 'df'), path.join(repo, '.devflow'));
      expectPersonalIgnored(repo);
    });

    // git's `icase` folds ASCII only; APFS also folds U+017F, U+FB01 and U+FB02.
    // Every directory x file spelling the check lists, each also in ASCII capitals
    // (not toUpperCase: it turns U+017F into "S" and U+FB01 into "FI"). The plain
    // .devflow/config.json is the opened path itself, not a variant.
    const FOLDED_SPELLINGS = ['.devflow', `.dev${FL}ow`]
      .flatMap(dir => ['config.json', `con${FI}g.json`, `config.j${LONG_S}on`, `con${FI}g.j${LONG_S}on`].map(file => `${dir}/${file}`))
      .flatMap(rel => [rel, rel.replace(/[a-z]/g, c => c.toUpperCase())])
      .filter(rel => rel !== '.devflow/config.json');
    it.each(FOLDED_SPELLINGS)('layout 2u/3u (index-only, every file system): the index names the Unicode-folded spelling %s beside the opened config.json', (rel) => {
      const repo = freshRepo('unicode-fold-index');
      writeAt(repo, '.devflow/config.json', FULL);
      indexOnly(repo, '100644', rel, FULL);
      expectPersonalIgnored(repo);
    });

    it.runIf(UNICODE_FOLDING_FS)('layout 2u/3u (checkout, Unicode-folding file system only): a committed .devﬂow/conﬁg.jſon opens as .devflow/config.json', () => {
      const repo = freshRepo('unicode-fold-checkout');
      const rel = `.dev${FL}ow/con${FI}g.j${LONG_S}on`;
      writeAt(repo, rel, FULL);
      commitAll(repo, [rel]);
      expectPersonalIgnored(repo);
    });

    it('layout 3u (index-only): a committed .devﬂow symlink reaches the opened path through the link', () => {
      const repo = freshRepo('unicode-fold-link');
      writeAt(repo, 'vendor/df/config.json', FULL);
      indexOnly(repo, '120000', `.dev${FL}ow`, 'vendor/df');
      fs.symlinkSync(path.join('vendor', 'df'), path.join(repo, '.devflow'));
      expectPersonalIgnored(repo);
    });

    // An inherited GIT_LITERAL_PATHSPECS=1 makes git read every pathspec as a plain
    // path, magic prefix included. The check pins its own pathspec mode, so the
    // parent's environment cannot turn "tracked" into an empty listing.
    describe('GIT_LITERAL_PATHSPECS=1 inherited from the caller', () => {
      const LITERAL = { GIT_LITERAL_PATHSPECS: '1' };

      it('control: an untracked config.json still applies', () => {
        const repo = freshRepo('literal-control');
        writeAt(repo, '.devflow/config.json', FULL);
        expectPersonalApplies(repo, LITERAL);
      });

      it('exact path: a committed .devflow/config.json is still tracked', () => {
        const repo = freshRepo('literal-exact');
        writeAt(repo, '.devflow/config.json', FULL);
        commitAll(repo, ['.devflow/config.json']);
        expectPersonalIgnored(repo, LITERAL);
      });

      it('link: a committed .devflow symlink is still tracked', () => {
        const repo = freshRepo('literal-link');
        writeAt(repo, 'vendor/df/config.json', FULL);
        fs.symlinkSync(path.join('vendor', 'df'), path.join(repo, '.devflow'));
        commitAll(repo, ['.devflow', 'vendor/df/config.json']);
        expectPersonalIgnored(repo, LITERAL);
      });
    });

    it('a repository whose index git cannot read fails the personal layer closed instead of reading the file', () => {
      const repo = freshRepo('corrupt-index');
      writeAt(repo, '.devflow/config.json', FULL);
      commitAll(repo, ['.devflow/config.json']);
      fs.writeFileSync(path.join(repo, '.git', 'index'), 'not an index');
      const run = runResolver({ home, args: [repo], script: SETTINGS_SCRIPT });
      expect(run.status, run.stderr).toBe(0);
      expect(fieldOf(run.stdout.trim(), 'REVIEW_PUBLICATION')).toBe('off');
    });

    it('layout 4: .devflow is a git submodule (gitlink) whose checkout holds config.json', () => {
      const repo = freshRepo('gitlink');
      // A gitlink names a commit of another repository; git does not need that object here.
      realGit(repo, home, ['update-index', '--add', '--cacheinfo', '160000,0123456789abcdef0123456789abcdef01234567,.devflow']);
      writeAt(repo, '.devflow/config.json', FULL);
      writeAt(repo, '.devflow/.git', 'gitdir: ../.git/modules/devflow\n');
      expectPersonalIgnored(repo);
    });
  });
});

// ---------------------------------------------------------------------------
// TP-33 / TP-49 — the switch AND table (D-FEATURES-NARROW-ONLY)
// ---------------------------------------------------------------------------

describe('TP-33: feature switches = machine AND project AND personal (only a literal false narrows)', () => {
  const FEATURES: readonly MachineFeature[] = ['memory', 'learning', 'knowledge'];
  type Layer = 'absent' | 'true' | 'false' | 'malformed';
  const LAYERS: readonly Layer[] = ['absent', 'true', 'false', 'malformed'];
  const fileFor = (feature: MachineFeature, v: Layer): string | undefined => (v === 'absent'
    ? undefined
    : `{"features":{"${feature}":${v === 'malformed' ? '"false"' : v}}}`);

  for (const feature of FEATURES) {
    const rows: Array<readonly [boolean, Layer, Layer]> = [];
    for (const machine of [true, false]) for (const p of LAYERS) for (const q of LAYERS) rows.push([machine, p, q]);

    it.each(rows)(`${feature}: machine %s × project %s × personal %s`, (machine, p, q) => {
      const manifest = { features: { ...MANIFEST_ON.features, [feature]: machine } };
      const s = settingsFor({ project: fileFor(feature, p), personal: fileFor(feature, q) }, manifest);
      const expectOn = machine && p !== 'false' && q !== 'false';
      expect(s.switches[feature].on).toBe(expectOn);
      const expectSource: SwitchSource = !machine ? 'machine' : p === 'false' ? 'project' : q === 'false' ? 'personal' : 'machine';
      expect(s.switches[feature].source).toBe(expectSource);
      // The other two switches are untouched.
      for (const other of FEATURES.filter(f => f !== feature)) expect(s.switches[other].on).toBe(true);
    });
  }
});

describe('readRepoLayers: the seam the hooks\' one parser fork reads through (D-FEATURES-NARROW-ONLY)', () => {
  it('folds to the table on every row, and to exactly what resolveSettings folds on every readable row', () => {
    for (const row of SETTINGS_SWITCH_TABLE) {
      const dir = fs.mkdtempSync(path.join(tmp, 'layers-'));
      if (row.project !== null) writeRepoFile('project.json', row.project, dir);
      if (row.personal !== null) writeRepoFile('config.json', row.personal, dir);
      const viaLayers = SETTINGS.foldSettings({ ...SETTINGS.readRepoLayers(dir), manifest: row.manifest, retiredPolicyFile: false });
      expect({
        memory: viaLayers.switches.memory.on,
        learning: viaLayers.switches.learning.on,
        knowledge: viaLayers.switches.knowledge.on,
      }, row.name).toEqual(row.expect);
      const viaResolve = settingsFor({}, row.manifest, dir);
      // An unreadable file narrows nothing in the fold the hooks run, while
      // resolveSettings fails its fields closed (whole-file rule) — all but the
      // compliance lens, which is whatever the readable layers fold to.
      if (row.unreadable === undefined) expect(viaLayers.switches, row.name).toEqual(viaResolve.switches);
      else expect(withoutCompliance(SETTINGS.formatSettingsLine(viaResolve)), row.name).toBe(withoutCompliance(FAIL_CLOSED));
    }
  });

  it('reads nothing from a root with no .devflow, and never throws', () => {
    const layers = SETTINGS.readRepoLayers(path.join(tmp, 'missing'));
    expect(layers).toEqual({ project: { kind: 'absent' }, personal: { kind: 'absent' }, personalTracked: false });
    expect(Object.isFrozen(layers)).toBe(true);
  });

  it('D-PERSONAL-UNTRACKED: a config.json git tracks is absent to the hooks\' fold too', () => {
    writeRepoFile('config.json', '{"features":{"memory":false}}');
    const tracked = SETTINGS.readRepoLayers(root, { exec: scriptedExec([TRACKED]).exec });
    expect(tracked).toEqual({ project: { kind: 'absent' }, personal: { kind: 'absent' }, personalTracked: true });
    const folded = SETTINGS.foldSettings({ ...tracked, manifest: MANIFEST_ON, retiredPolicyFile: false });
    expect(folded.switches.memory).toEqual({ on: true, source: 'machine' });

    const untracked = SETTINGS.readRepoLayers(root, { exec: scriptedExec([UNTRACKED]).exec });
    expect(untracked.personalTracked).toBe(false);
    expect(SETTINGS.foldSettings({ ...untracked, manifest: MANIFEST_ON, retiredPolicyFile: false }).switches.memory)
      .toEqual({ on: false, source: 'personal' });
  });

  it('makes no git call at all when there is no config.json', () => {
    const { exec, recorded } = scriptedExec([]);
    writeRepoFile('project.json', '{"features":{"memory":false}}');
    SETTINGS.readRepoLayers(root, { exec });
    expect(recorded).toEqual([]);
  });

  it('refuses a symlinked project.json unopened (invalid, never followed)', () => {
    const target = path.join(tmp, 'elsewhere.json');
    fs.writeFileSync(target, '{"features":{"memory":false}}');
    fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
    fs.symlinkSync(target, path.join(root, '.devflow', 'project.json'));
    expect(SETTINGS.readRepoLayers(root).project).toEqual({ kind: 'invalid' });
  });
});

describe('TP-49: the shared switch fixture table (tests/fixtures/settings-switch-table.ts)', () => {
  it('is non-empty and covers the legacy top-level keys', () => {
    expect(SETTINGS_SWITCH_TABLE.length).toBeGreaterThanOrEqual(10);
    expect(SETTINGS_SWITCH_TABLE.some(r => /legacy top-level/.test(r.name))).toBe(true);
  });

  it.each(SETTINGS_SWITCH_TABLE.map(r => [r.name, r] as const))('%s', (_name, row) => {
    const s = settingsFor({ project: row.project ?? undefined, personal: row.personal ?? undefined }, row.manifest);
    // An unreadable row resolves to the fail-closed switches (whole-file rule);
    // its `expect` is the fold's answer, which the readRepoLayers test holds.
    expect({
      memory: s.switches.memory.on,
      learning: s.switches.learning.on,
      knowledge: s.switches.knowledge.on,
    }).toEqual(row.unreadable === undefined ? row.expect : { memory: true, learning: true, knowledge: false });
    expect(s.unreadable).toBe(row.unreadable ?? null);
  });
});

// ---------------------------------------------------------------------------
// GATE_LEVEL — the gate level field: personal, then machine, then standard
// ---------------------------------------------------------------------------

describe('GATE_LEVEL: personal config.json, then the machine manifest, then standard', { timeout: 30_000 }, () => {
  const absent = (): unknown => LIB.parsePersonalBytes(null);
  const personalOf = (text: string | null): unknown => LIB.parsePersonalBytes(text === null ? null : Buffer.from(text, 'utf8'));
  const gateFields = (s: Settings) => ({
    gateLevel: s.gateLevel,
    gateLevelSource: s.gateLevelSource,
    gateLevelInvalid: s.gateLevelInvalid,
    gateLevelMachine: s.gateLevelMachine,
  });
  const withoutLevel = (line: string): string => line.replace(/ GATE_LEVEL=\S+$/, '');
  const MACHINE_LEAN = { features: { ...MANIFEST_ON.features, gateLevel: 'lean' } };

  function runReal(calls: readonly ScriptedCall[]) {
    const shim = buildScriptedShim(fakeBin, tmp, calls);
    return runResolver({ home, args: [root], shim, script: SETTINGS_SCRIPT });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('the CommonJS level list is the three words, in order', () => {
    expect([...LIB.GATE_LEVELS]).toEqual(['full', 'standard', 'lean']);
  });

  describe('the fold table (tests/fixtures/gate-level-table.ts)', () => {
    it('is non-empty and covers every outcome', () => {
      expect(GATE_LEVEL_TABLE.length).toBeGreaterThanOrEqual(30);
      for (const source of ['personal', 'machine', 'default'] as const) {
        expect(GATE_LEVEL_TABLE.some(r => r.expect.gateLevelSource === source), source).toBe(true);
      }
      expect(GATE_LEVEL_TABLE.some(r => r.expect.gateLevelInvalid)).toBe(true);
    });

    it.each(GATE_LEVEL_TABLE.map(r => [r.name, r] as const))('foldSettings: %s', (_name, row) => {
      const s = SETTINGS.foldSettings({
        project: LIB.parseProjectBytes(null), personal: personalOf(row.personal), manifest: row.manifest, retiredPolicyFile: false,
      });
      expect(s.ok).toBe(true);
      expect(gateFields(s)).toEqual(row.expect);
      const line = SETTINGS.formatSettingsLine(s);
      expect(line).toMatch(SETTINGS.SETTINGS_LINE_RE);
      expect(line.endsWith(` GATE_LEVEL=${row.expect.gateLevel}`)).toBe(true);
      expect(SETTINGS.isCoherentSettingsLine(line)).toBe(true);
    });

    it.each(GATE_LEVEL_TABLE.map(r => [r.name, r] as const))('resolveSettings over the file: %s', (_name, row) => {
      const s = settingsFor({ personal: row.personal ?? undefined }, row.manifest === undefined ? {} : row.manifest);
      expect(s.ok).toBe(true);
      expect(gateFields(s)).toEqual(row.expect);
    });

    it.each(GATE_LEVEL_TABLE.map(r => [r.name, r] as const))('the TypeScript machine reader agrees: %s', (_name, row) => {
      expect(machineGateLevel(row.manifest)).toBe(row.expect.gateLevelMachine);
      expect(SETTINGS.machineGateLevel(row.manifest)).toBe(row.expect.gateLevelMachine);
    });
  });

  it('a malformed personal level changes no other field: the line equals the one with the key absent', () => {
    const base = '"reviewPublication":"full","features":{"learning":false},"tracker":"github"';
    const manifest = { features: { ...MANIFEST_ON.features, gateLevel: 'lean' } };
    const without = lineFor({ personal: `{${base}}` }, manifest);
    expect(without.endsWith(' GATE_LEVEL=lean')).toBe(true);
    for (const [label, value] of MALFORMED_PERSONAL_VALUES) {
      const line = lineFor({ personal: `{${base},"gateLevel":${value}}` }, manifest);
      expect(line.endsWith(' GATE_LEVEL=full'), label).toBe(true);
      expect(withoutLevel(line), label).toBe(withoutLevel(without));
    }
    const dup = lineFor({ personal: `{${base},"gateLevel":"lean","gateLevel":"lean"}` }, manifest);
    expect(dup.endsWith(' GATE_LEVEL=full')).toBe(true);
    expect(withoutLevel(dup)).toBe(withoutLevel(without));
  });

  it('a malformed machine level changes no other field', () => {
    const clean = lineFor({}, MANIFEST_ON);
    for (const [label, value] of MALFORMED_MACHINE_VALUES) {
      const line = lineFor({}, { features: { ...MANIFEST_ON.features, gateLevel: value } });
      expect(line.endsWith(' GATE_LEVEL=full'), label).toBe(true);
      expect(withoutLevel(line), label).toBe(withoutLevel(clean));
    }
  });

  describe('the whole-line fail-closed result', () => {
    it.each([
      ['an unreadable project.json', { project: '{' }],
      ['an unreadable config.json', { personal: '{' }],
      ['a config.json that is a JSON array', { personal: '[]' }],
    ])('%s: level full, no deciding layer, and a readable manifest still shows its own level', (_label, files) => {
      const s = settingsFor(files, MACHINE_LEAN);
      expect(s.ok).toBe(false);
      expect(gateFields(s)).toEqual({ gateLevel: 'full', gateLevelSource: null, gateLevelInvalid: false, gateLevelMachine: 'lean' });
      expect(SETTINGS.formatSettingsLine(s).endsWith(' GATE_LEVEL=full')).toBe(true);
    });

    it('an unreadable file with a malformed machine value shows the machine invalid marker', () => {
      const s = settingsFor({ project: '{' }, { features: { ...MANIFEST_ON.features, gateLevel: 'Lean' } });
      expect(gateFields(s)).toEqual({ gateLevel: 'full', gateLevelSource: null, gateLevelInvalid: false, gateLevelMachine: 'invalid' });
    });

    it('an unreadable file with no manifest level reads none', () => {
      expect(settingsFor({ personal: '{' }, MANIFEST_ON).gateLevelMachine).toBeNull();
    });

    it('git that does not answer, or a throwing exec, never read the manifest: the machine field is null', () => {
      const unanswered = SETTINGS.resolveSettings({ dir: root, manifest: MACHINE_LEAN }, {
        exec: scriptedExec([{ tool: 'git', args: ARGV.toplevel, error: { code: 'ENOENT' } }]).exec,
      });
      expect(unanswered.ok).toBe(false);
      expect(gateFields(unanswered)).toEqual({ gateLevel: 'full', gateLevelSource: null, gateLevelInvalid: false, gateLevelMachine: null });
      const thrown = SETTINGS.resolveSettings({ dir: root, manifest: MACHINE_LEAN }, { exec: () => { throw new Error('boom'); } });
      expect(gateFields(thrown)).toEqual({ gateLevel: 'full', gateLevelSource: null, gateLevelInvalid: false, gateLevelMachine: null });
    });
  });

  describe('totality over any manifest', () => {
    it.each([
      ['null', null],
      ['an array', []],
      ['a string', 'lean'],
      ['features set to a string', { features: 'lean' }],
      ['features set to an array', { features: ['lean'] }],
      ['an object-valued gateLevel', { features: { gateLevel: { level: 'lean' } } }],
      ['an array-valued gateLevel', { features: { gateLevel: ['lean'] } }],
    ])('foldSettings returns a coherent line and does not throw for %s', (_label, manifest) => {
      const s = SETTINGS.foldSettings({ project: LIB.parseProjectBytes(null), personal: absent(), manifest, retiredPolicyFile: false });
      expect(SETTINGS.isCoherentSettingsLine(SETTINGS.formatSettingsLine(s))).toBe(true);
    });
  });

  describe('a git-tracked config.json counts as absent', () => {
    it('falls to the machine value, and stderr tells the user to untrack the file', () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.stubEnv('HOME', home);
      // The machine level is neither the tracked file's `full` nor the fail-closed `full`, so only a fall to the machine layer reads lean.
      fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), JSON.stringify({ features: { gateLevel: 'lean' } }));
      writeRepoFile('config.json', '{"gateLevel":"full"}');
      const out = SETTINGS.main(['node', SETTINGS_SCRIPT, root], { exec: scriptedExec([TOPLEVEL(root), TRACKED, ORIGIN_HEAD_UNSET]).exec });
      expect(out.code).toBe(0);
      expect(out.line.endsWith(' GATE_LEVEL=lean')).toBe(true);
      expect(stderr.mock.calls.map(c => String(c[0])).join('')).toContain('Git tracks an entry at or under .devflow/config.json');
    });

    it('falls to standard when the machine records nothing', () => {
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.stubEnv('HOME', home);
      writeRepoFile('config.json', '{"gateLevel":"lean"}');
      const out = SETTINGS.main(['node', SETTINGS_SCRIPT, root], { exec: scriptedExec([TOPLEVEL(root), TRACKED, ORIGIN_HEAD_UNSET]).exec });
      expect(out.line.endsWith(' GATE_LEVEL=standard')).toBe(true);
    });
  });

  describe('the level comes from the personal and machine keys only', () => {
    it('a gateLevel in project.json is ignored', () => {
      expect(gateFields(settingsFor({ project: '{"gateLevel":"lean"}' }))).toEqual({
        gateLevel: 'standard', gateLevelSource: 'default', gateLevelInvalid: false, gateLevelMachine: null,
      });
      expect(settingsFor({ project: '{"gateLevel":"lean"}' }, MACHINE_LEAN).gateLevelSource).toBe('machine');
    });

    it.each([
      ['evidence required', '{"evidence":"required"}'],
      ['a jira tracker', '{"tracker":{"provider":"jira","site":"https://acme.atlassian.net","key":"ACME"}}'],
      ['compliance hipaa', '{"compliance":["hipaa"]}'],
      ['a team publication ceiling', '{"reviewPublication":"off"}'],
      ['a narrowed switch', '{"features":{"memory":false,"learning":false,"knowledge":false}}'],
    ])('varying the project file (%s) never changes the level', (_label, project) => {
      for (const manifest of [MANIFEST_ON, MACHINE_LEAN]) {
        const base = settingsFor({}, manifest);
        expect(gateFields(settingsFor({ project }, manifest))).toEqual(gateFields(base));
      }
    });
  });

  describe('main(): stderr names the layer and the field state, never the value', () => {
    const SECRET = 'Lean-SECRET-9f3a';

    function stderrOf(files: { personal?: string }, machineLevel?: unknown): { text: string; line: string } {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.stubEnv('HOME', home);
      if (machineLevel !== undefined) {
        fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), JSON.stringify({ features: { gateLevel: machineLevel } }));
      }
      if (files.personal !== undefined) writeRepoFile('config.json', files.personal);
      const calls = files.personal === undefined ? [TOPLEVEL(root), ORIGIN_HEAD_UNSET] : [TOPLEVEL(root), UNTRACKED, ORIGIN_HEAD_UNSET];
      const out = SETTINGS.main(['node', SETTINGS_SCRIPT, root], { exec: scriptedExec(calls).exec });
      expect(out.code).toBe(0);
      return { text: stderr.mock.calls.map(c => String(c[0])).join(''), line: out.line };
    }

    it('a malformed personal level names config.json and says full applies', () => {
      const { text, line } = stderrOf({ personal: `{"gateLevel":"${SECRET}"}` }, 'lean');
      expect(line.endsWith(' GATE_LEVEL=full')).toBe(true);
      expect(text).toContain('.devflow/config.json');
      expect(text).toContain('GATE_LEVEL=full applies');
      expect(text).not.toContain(SECRET);
    });

    it('a malformed machine level names manifest.json and says full applies', () => {
      const { text, line } = stderrOf({}, SECRET);
      expect(line.endsWith(' GATE_LEVEL=full')).toBe(true);
      expect(text).toContain('~/.devflow/manifest.json');
      expect(text).toContain('GATE_LEVEL=full applies');
      expect(text).not.toContain(SECRET);
    });

    it('a malformed machine level hidden behind a valid personal level prints nothing', () => {
      const { text, line } = stderrOf({ personal: '{"gateLevel":"lean"}' }, SECRET);
      expect(line.endsWith(' GATE_LEVEL=lean')).toBe(true);
      expect(text).toBe('');
    });

    it.each(['full', 'standard', 'lean'])('a valid personal %s level prints nothing on stderr', level => {
      expect(stderrOf({ personal: `{"gateLevel":"${level}"}` }).text).toBe('');
    });

    it.each(['full', 'standard', 'lean'])('a valid machine %s level prints nothing on stderr', level => {
      expect(stderrOf({}, level).text).toBe('');
    });
  });

  describe('the real script', () => {
    it('prints GATE_LEVEL=standard with no personal key and no manifest', () => {
      const r = runReal([TOPLEVEL(root), ORIGIN_HEAD_UNSET]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe(`${DEFAULT_LINE}\n`);
    });

    it('prints the personal level over the machine level', () => {
      fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), JSON.stringify({ features: { gateLevel: 'full' } }));
      writeRepoFile('config.json', '{"gateLevel":"lean"}');
      const r = runReal([TOPLEVEL(root), UNTRACKED, ORIGIN_HEAD_UNSET]);
      expect(r.status, r.stderr).toBe(0);
      expect(fieldOf(r.stdout.trim(), 'GATE_LEVEL')).toBe('lean');
    });

    it('prints the machine level when the personal file has no key', () => {
      fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), JSON.stringify({ features: { gateLevel: 'lean' } }));
      const r = runReal([TOPLEVEL(root), ORIGIN_HEAD_UNSET]);
      expect(fieldOf(r.stdout.trim(), 'GATE_LEVEL')).toBe('lean');
    });

    it('prints full for a malformed personal level and names config.json on stderr', () => {
      writeRepoFile('config.json', '{"gateLevel":"Lean"}');
      const r = runReal([TOPLEVEL(root), UNTRACKED, ORIGIN_HEAD_UNSET]);
      expect(r.status, r.stderr).toBe(0);
      expect(fieldOf(r.stdout.trim(), 'GATE_LEVEL')).toBe('full');
      expect(r.stderr).toContain('.devflow/config.json');
    });

    it('prints the fail-closed line, ending full, when the directory is unusable', () => {
      const r = runResolver({ home, args: [path.join(tmp, 'missing')], script: SETTINGS_SCRIPT });
      expect(r.stdout).toBe(`${FAIL_CLOSED}\n`);
      expect(fieldOf(r.stdout.trim(), 'GATE_LEVEL')).toBe('full');
    });
  });
});

// ---------------------------------------------------------------------------
// TP-31 (AC-27) — compliance: machine ∪ worktree
// ---------------------------------------------------------------------------

describe('TP-31 (AC-27): COMPLIANCE is machine ∪ worktree', () => {
  const OFF = { features: { ...MANIFEST_ON.features, compliance: { enabled: false, frameworks: ['gdpr'] } } };
  const ON = (frameworks: string[]) => ({ features: { ...MANIFEST_ON.features, compliance: { enabled: true, frameworks } } });

  it.each([
    ['machine off, nothing declared', OFF, undefined, 'off'],
    ['machine off, repo hipaa', OFF, '{"compliance":["hipaa"]}', 'hipaa'],
    ['machine off, repo empty list', OFF, '{"compliance":[]}', 'generic'],
    ['machine off, repo malformed', OFF, '{"compliance":"hipaa"}', 'generic'],
    ['machine off, repo unknown ids only', OFF, '{"compliance":["nist"]}', 'generic'],
    ['machine off, project.json unreadable', OFF, '{"compliance":', 'generic'],
    ['machine soc2, project.json unreadable ⇒ the machine lens stays', ON(['soc2']), '{"compliance":', 'soc2'],
    ['machine on at zero frameworks', ON([]), undefined, 'generic'],
    ['machine soc2, repo hipaa+gdpr ⇒ registry order', ON(['soc2']), '{"compliance":["hipaa","gdpr"]}', 'gdpr,hipaa,soc2'],
    ['machine gdpr, repo gdpr', ON(['gdpr']), '{"compliance":["GDPR"]}', 'gdpr'],
    ['machine on with an unknown id', ON(['nist', 'sox']), undefined, 'sox'],
  ] as const)('%s ⇒ %s', (_label, manifest, project, expected) => {
    expect(fieldOf(lineFor({ project }, manifest), 'COMPLIANCE')).toBe(expected);
  });

  it('reports the worktree\'s own ids separately for the CLI', () => {
    expect(settingsFor({ project: '{"compliance":["hipaa"]}' }).repoCompliance).toEqual(['hipaa']);
    expect(settingsFor({ project: '{"compliance":"x"}' }).repoCompliance).toEqual([]);
    expect(settingsFor({ project: '{}' }).repoCompliance).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D-LENS-UNION — machine ∪ default branch (its local tracking copy) ∪ worktree
// ---------------------------------------------------------------------------

describe('D-LENS-UNION: the default branch\'s compliance ids stay in the lens', () => {
  const OFF = { features: { ...MANIFEST_ON.features, compliance: { enabled: false, frameworks: [] } } };
  const ON = (frameworks: string[]) => ({ features: { ...MANIFEST_ON.features, compliance: { enabled: true, frameworks } } });

  /** resolveSettings over a fresh repo whose worktree holds `project`, with scripted default-branch reads. */
  function lensFor(project: string | undefined, defaultBranch: readonly ScriptedCall[], manifest: unknown = OFF): Settings {
    const repo = fs.mkdtempSync(path.join(tmp, 'lens-'));
    if (project !== undefined) writeRepoFile('project.json', project, repo);
    return SETTINGS.resolveSettings({ dir: repo, manifest }, { exec: scriptedExec([TOPLEVEL(repo), UNTRACKED, ...defaultBranch]).exec });
  }
  const onMain = (body: string | null): ScriptedCall[] => [ORIGIN_HEAD('main'), TRACKING_PROJECT('main', body)];

  it('a PR whose worktree deletes compliance:["hipaa"] still resolves hipaa from the tracking copy', () => {
    const s = lensFor('{"version":1}', onMain('{"version":1,"compliance":["hipaa"]}'));
    expect(complianceTokenOf(s)).toBe('hipaa');
    expect(s.repoCompliance).toBeNull();
    expect(s.defaultBranchCompliance).toEqual(['hipaa']);
  });

  it.each([
    ['a branch adds a framework', '{"compliance":["gdpr"]}', onMain('{"compliance":["hipaa"]}'), OFF, 'gdpr,hipaa'],
    ['machine ∪ default ∪ worktree, registry order', '{"compliance":["sox"]}', onMain('{"compliance":["hipaa"]}'), ON(['soc2']), 'hipaa,soc2,sox'],
    ['a branch that deletes the whole file', undefined, onMain('{"compliance":["pci-dss"]}'), OFF, 'pci-dss'],
    ['an empty default-branch list is generic', undefined, onMain('{"compliance":[]}'), OFF, 'generic'],
    ['main without compliance leaves the worktree\'s', '{"compliance":["gdpr"]}', onMain('{"version":1}'), OFF, 'gdpr'],
    ['main with no project.json at all', undefined, onMain(null), OFF, 'off'],
    ['no origin/HEAD recorded ⇒ machine ∪ worktree, as before', '{"compliance":["gdpr"]}', [ORIGIN_HEAD_UNSET], OFF, 'gdpr'],
    ['no origin/HEAD and nothing declared ⇒ off', undefined, [ORIGIN_HEAD_UNSET], OFF, 'off'],
  ] as const)('%s ⇒ %s', (_label, project, calls, manifest, expected) => {
    expect(complianceTokenOf(lensFor(project, calls, manifest))).toBe(expected);
  });

  // A default-branch copy that cannot be read never LOWERS the lens: it reads as
  // a malformed declaration — generic — on top of whatever else declares.
  const OVERSIZE = `{"compliance":["hipaa"],"pad":"${'x'.repeat(4097)}"}`;
  it.each([
    ['an unparseable tracking copy', onMain('{ "compliance": ["hipaa"], this is not json')],
    ['a malformed compliance value', onMain('{"compliance":"hipaa"}')],
    ['a duplicated compliance key', onMain('{"compliance":[],"compliance":["hipaa"]}')],
    ['a tracking copy over 4096 bytes', onMain(OVERSIZE)],
    ['an origin/HEAD read git does not answer', [{ tool: 'git', args: ARGV_ORIGIN_HEAD, spawnError: 'ETIMEDOUT' }]],
    ['a blob read git does not answer', [ORIGIN_HEAD('main'), { tool: 'git', args: ARGV.trackingProjectBlob('main'), spawnError: 'ETIMEDOUT' }]],
    ['an origin/HEAD naming a hostile branch', [{ tool: 'git', args: ARGV_ORIGIN_HEAD, stdout: 'refs/remotes/origin/-x\n' }]],
    ['an origin/HEAD naming another remote', [{ tool: 'git', args: ARGV_ORIGIN_HEAD, stdout: 'refs/remotes/upstream/main\n' }]],
  ] as const)('%s is generic — never lower than a declaration', (_label, calls) => {
    expect(complianceTokenOf(lensFor(undefined, calls))).toBe('generic');
    expect(complianceTokenOf(lensFor('{"compliance":["gdpr"]}', calls))).toBe('gdpr');
    expect(complianceTokenOf(lensFor(undefined, calls, ON(['soc2'])))).toBe('soc2');
  });

  it('the tracking copy is read at the branch origin/HEAD names, with a bounded buffer', () => {
    const repo = fs.mkdtempSync(path.join(tmp, 'lens-'));
    const { exec, recorded } = scriptedExec([TOPLEVEL(repo), UNTRACKED, ORIGIN_HEAD('trunk'), TRACKING_PROJECT('trunk', '{"compliance":["sox"]}')]);
    const s = SETTINGS.resolveSettings({ dir: repo, manifest: OFF }, { exec });
    expect(complianceTokenOf(s)).toBe('sox');
    const blobCall = recorded.find(c => c.args[0] === 'cat-file');
    expect(blobCall?.args).toEqual(ARGV.trackingProjectBlob('trunk'));
    expect(blobCall?.opts.maxBuffer).toBe(4097);
    expect(blobCall?.opts.cwd).toBe(repo);
  });

  describe('the real script over a real repository', { timeout: 30_000 }, () => {
    it('a branch that deleted main\'s hipaa still resolves COMPLIANCE=hipaa, offline', () => {
      const repo = fs.mkdtempSync(path.join(tmp, 'real-lens-'));
      realGit(repo, home, ['init', '-q', '-b', 'main']);
      writeRepoFile('project.json', '{"version":1,"compliance":["hipaa"]}\n', repo);
      realGit(repo, home, ['add', '.devflow/project.json']);
      realGit(repo, home, ['commit', '-q', '-m', 'team settings']);
      // What a clone records: origin/main and origin/HEAD pointing at it — local refs only.
      realGit(repo, home, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
      realGit(repo, home, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
      realGit(repo, home, ['checkout', '-q', '-b', 'feat/drop-hipaa']);
      writeRepoFile('project.json', '{"version":1}\n', repo);
      realGit(repo, home, ['commit', '-q', '-am', 'drop hipaa']);

      const r = runResolver({ home, args: [repo], script: SETTINGS_SCRIPT });
      expect(r.status, r.stderr).toBe(0);
      expect(fieldOf(r.stdout.trim(), 'COMPLIANCE')).toBe('hipaa');
    });
  });
});

// ---------------------------------------------------------------------------
// Tracker rules
// ---------------------------------------------------------------------------

describe('tracker: project selects, personal narrows, machine then github', () => {
  const MACHINE = (provider?: string) => ({
    features: { ...MANIFEST_ON.features, ...(provider === undefined ? {} : { tracker: { provider } }) },
  });
  const JIRA = '{"tracker":{"provider":"jira","site":"https://acme.atlassian.net","key":"ACME"}}';

  it.each([
    ['nothing anywhere', MACHINE(), undefined, undefined, 'github', 'default', 'none', 'none', 'none'],
    ['machine jira', MACHINE('jira'), undefined, undefined, 'jira', 'machine', 'none', 'none', 'none'],
    ['malformed machine value self-heals to github', MACHINE('gitlab'), undefined, undefined, 'github', 'default', 'none', 'none', 'none'],
    ['project jira on a github machine', MACHINE('github'), JIRA, undefined, 'jira', 'project', 'none', 'https://acme.atlassian.net', 'ACME'],
    ['project jira, personal github ⇒ narrowed', MACHINE(), JIRA, '{"tracker":"github"}', 'github', 'personal', 'none', 'none', 'none'],
    ['project jira, personal jira', MACHINE(), JIRA, '{"tracker":"jira"}', 'jira', 'personal', 'none', 'https://acme.atlassian.net', 'ACME'],
    ['project jira, personal linear ⇒ mismatch, ignored', MACHINE(), JIRA, '{"tracker":"linear"}', 'jira', 'project', 'mismatch', 'https://acme.atlassian.net', 'ACME'],
    ['machine github, personal jira ⇒ mismatch', MACHINE('github'), undefined, '{"tracker":"jira"}', 'github', 'machine', 'mismatch', 'none', 'none'],
    ['machine jira, personal jira', MACHINE('jira'), undefined, '{"tracker":"jira"}', 'jira', 'personal', 'none', 'none', 'none'],
    ['personal unknown provider ⇒ invalid', MACHINE('jira'), undefined, '{"tracker":"gitlab"}', 'jira', 'machine', 'invalid', 'none', 'none'],
    ['personal non-string ⇒ invalid', MACHINE(), undefined, '{"tracker":42}', 'github', 'default', 'invalid', 'none', 'none'],
    ['personal empty string ⇒ absent', MACHINE('jira'), undefined, '{"tracker":""}', 'jira', 'machine', 'none', 'none', 'none'],
    ['project provider malformed ⇒ invalid, machine decides', MACHINE('linear'), '{"tracker":{"provider":"gitlab"}}', undefined, 'linear', 'machine', 'invalid', 'none', 'none'],
    ['project site malformed ⇒ invalid, never printed', MACHINE(), '{"tracker":{"provider":"jira","site":"http://x.io","key":"ACME"}}', undefined, 'jira', 'project', 'invalid', 'none', 'ACME'],
    ['project tracker not an object ⇒ invalid', MACHINE(), '{"tracker":"jira"}', undefined, 'github', 'default', 'invalid', 'none', 'none'],
    ['unreadable project.json ⇒ the fail-closed tracker', MACHINE('jira'), '{"tracker":', undefined, 'github', 'default', 'invalid', 'none', 'none'],
    ['project site/key without provider apply to the machine provider', MACHINE('jira'), '{"tracker":{"site":"https://acme.atlassian.net","key":"ACME"}}', undefined, 'jira', 'machine', 'none', 'https://acme.atlassian.net', 'ACME'],
    ['a github project prints no site or key', MACHINE(), '{"tracker":{"provider":"github","site":"https://acme.atlassian.net","key":"ACME"}}', undefined, 'github', 'project', 'none', 'none', 'none'],
    ['an unreadable personal file ⇒ the fail-closed tracker', MACHINE('jira'), undefined, '{"tracker":"linear"', 'github', 'default', 'invalid', 'none', 'none'],
  ] as const)('%s', (_label, manifest, project, personalBody, tracker, source, warn, site, key) => {
    const line = lineFor({ project, personal: personalBody }, manifest);
    expect(line).toMatch(SETTINGS.SETTINGS_LINE_RE);
    expect(SETTINGS.isCoherentSettingsLine(line)).toBe(true);
    expect([fieldOf(line, 'TRACKER'), fieldOf(line, 'TRACKER_SOURCE'), fieldOf(line, 'TRACKER_WARN'), fieldOf(line, 'SITE'), fieldOf(line, 'KEY')])
      .toEqual([tracker, source, warn, site, key]);
  });
});

describe('TP-30 (AC-26): a malformed evidence leaves tracker and features in the same file applying', () => {
  it('duplicate evidence beside a jira tracker and a learning:false switch', () => {
    const line = lineFor({
      project: '{"evidence":"required","evidence":"standard","tracker":{"provider":"jira","key":"ACME"},"features":{"learning":false}}',
    });
    expect(line).toBe('TRACKER=jira TRACKER_SOURCE=project TRACKER_WARN=none SITE=none KEY=ACME '
      + 'REVIEW_PUBLICATION=auto COMPLIANCE=off MEMORY=on CURATION=off KNOWLEDGE=on GATE_LEVEL=standard');
  });
});

// ---------------------------------------------------------------------------
// The whole-file rule (D-SETTINGS-LINE): a repository file that EXISTS but is
// not a JSON object fails the resolution closed — every field but COMPLIANCE,
// which keeps the machine's own lens (generic when the machine has none), since
// a broken repository file must never lower it. Individually malformed keys
// inside a readable object keep their per-key readings (the tables above).
// ---------------------------------------------------------------------------

describe('whole-file rule: an unreadable project.json or config.json fails its own fields closed, never the lens', () => {
  /** The fail-closed line carrying another compliance lens instead of generic. */
  const failClosedWith = (compliance: string): string => FAIL_CLOSED.replace('COMPLIANCE=generic', `COMPLIANCE=${compliance}`);
  const MACHINE_WITH = (frameworks: string[]) => ({ features: { ...MANIFEST_ON.features, compliance: { enabled: true, frameworks } } });
  const PADDED = `{"compliance":["hipaa"],"pad":"${'x'.repeat(4097)}"}`;
  const UNREADABLE: ReadonlyArray<readonly [string, string | Buffer]> = [
    ['unparseable JSON', '{ this is not json'],
    ['a truncated object', '{"compliance":["hipaa"]'],
    ['an empty file', ''],
    ['a JSON array', '[{"compliance":["hipaa"]}]'],
    ['a JSON string', '"hipaa"'],
    ['null', 'null'],
    ['over 4096 bytes', PADDED],
    ['a byte-order mark', '﻿{"compliance":["hipaa"]}'],
    ['invalid UTF-8', Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])],
  ];
  const COMPLIANCE_OFF_MACHINE = { features: { ...MANIFEST_ON.features, compliance: { enabled: false, frameworks: [] } } };

  it.each(UNREADABLE)('project.json with %s ⇒ the fail-closed line', (_label, body) => {
    const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
    writeRepoFile('project.json', body, repo);
    writeRepoFile('config.json', '{"reviewPublication":"full"}', repo);
    const s = settingsFor({}, COMPLIANCE_OFF_MACHINE, repo);
    expect(s.ok).toBe(false);
    expect(s.unreadable).toBe('project');
    expect(SETTINGS.formatSettingsLine(s)).toBe(FAIL_CLOSED);
  });

  it.each(UNREADABLE)('config.json with %s ⇒ its fields fail closed; the lens is the readable layers\' (off here)', (_label, body) => {
    const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
    writeRepoFile('project.json', '{"version":1,"reviewPublication":"full"}', repo);
    writeRepoFile('config.json', body, repo);
    const s = settingsFor({}, MANIFEST_ON, repo);
    expect(s.ok).toBe(false);
    expect(s.unreadable).toBe('personal');
    expect(SETTINGS.formatSettingsLine(s)).toBe(failClosedWith('off'));
  });

  it.each(UNREADABLE)('project.json with %s on a hipaa machine ⇒ fail-closed, keeping the machine lens', (_label, body) => {
    const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
    writeRepoFile('project.json', body, repo);
    writeRepoFile('config.json', '{"reviewPublication":"full"}', repo);
    const s = settingsFor({}, MACHINE_WITH(['hipaa']), repo);
    expect(s.ok).toBe(false);
    expect(s.unreadable).toBe('project');
    expect(s.repoCompliance).toBeNull();
    expect(SETTINGS.formatSettingsLine(s)).toBe(failClosedWith('hipaa'));
  });

  // A broken personal file affects only the keys it owns (tracker override,
  // publication, switches): the readable project.json's frameworks stay in the lens.
  it.each([
    ['machine soc2+gdpr ⇒ machine ∪ project, registry order', MACHINE_WITH(['soc2', 'gdpr']), 'gdpr,hipaa,soc2'],
    ['machine on at zero frameworks ⇒ the project\'s hipaa', MACHINE_WITH([]), 'hipaa'],
    ['machine compliance off ⇒ the project\'s hipaa', COMPLIANCE_OFF_MACHINE, 'hipaa'],
    ['no manifest ⇒ the project\'s hipaa', undefined, 'hipaa'],
  ] as const)('config.json unreadable, %s', (_label, manifest, compliance) => {
    const s = settingsFor({ project: '{"compliance":["hipaa"]}', personal: '{"reviewPublication":' }, manifest);
    expect(s.unreadable).toBe('personal');
    expect(s.repoCompliance).toEqual(['hipaa']);
    expect(SETTINGS.formatSettingsLine(s)).toBe(failClosedWith(compliance));
  });

  it('config.json unreadable: the default branch\'s frameworks stay in the lens too (D-LENS-UNION)', () => {
    const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
    writeRepoFile('project.json', '{"compliance":["gdpr"]}', repo);
    writeRepoFile('config.json', '{"reviewPublication":', repo);
    const s = SETTINGS.resolveSettings({ dir: repo, manifest: COMPLIANCE_OFF_MACHINE }, {
      exec: scriptedExec([TOPLEVEL(repo), UNTRACKED, ORIGIN_HEAD('main'), TRACKING_PROJECT('main', '{"compliance":["hipaa"]}')]).exec,
    });
    expect(s.unreadable).toBe('personal');
    expect(SETTINGS.formatSettingsLine(s)).toBe(failClosedWith('gdpr,hipaa'));
  });

  it('project.json unreadable: the default branch\'s frameworks stay in the lens (D-LENS-UNION)', () => {
    const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
    writeRepoFile('project.json', '{ this is not json', repo);
    const s = SETTINGS.resolveSettings({ dir: repo, manifest: COMPLIANCE_OFF_MACHINE }, {
      exec: scriptedExec([TOPLEVEL(repo), UNTRACKED, ORIGIN_HEAD('main'), TRACKING_PROJECT('main', '{"compliance":["hipaa"]}')]).exec,
    });
    expect(s.unreadable).toBe('project');
    expect(s.repoCompliance).toBeNull();
    expect(s.defaultBranchCompliance).toEqual(['hipaa']);
    expect(SETTINGS.formatSettingsLine(s)).toBe(failClosedWith('hipaa'));
  });

  it('a symlinked config.json is unreadable, never followed', () => {
    const target = path.join(tmp, 'elsewhere.json');
    fs.writeFileSync(target, '{"reviewPublication":"full"}');
    fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
    fs.symlinkSync(target, path.join(root, '.devflow', 'config.json'));
    const s = settingsFor({}, MANIFEST_ON, root);
    expect(s.unreadable).toBe('personal');
    expect(SETTINGS.formatSettingsLine(s)).toBe(failClosedWith('off'));
  });

  it('an unreadable project.json is named even when config.json is unreadable too', () => {
    expect(settingsFor({ project: '{', personal: '{' }).unreadable).toBe('project');
  });

  it('readable files — including ones whose every key is malformed — resolve normally', () => {
    const s = settingsFor({
      project: '{"compliance":"hipaa","tracker":42,"reviewPublication":"everyone","features":[]}',
      personal: '{"tracker":42,"reviewPublication":"everyone"}',
    });
    expect(s.ok).toBe(true);
    expect(s.unreadable).toBeNull();
    expect(SETTINGS.formatSettingsLine(s)).toBe('TRACKER=github TRACKER_SOURCE=default TRACKER_WARN=invalid SITE=none '
      + 'KEY=none REVIEW_PUBLICATION=off COMPLIANCE=generic MEMORY=on CURATION=on KNOWLEDGE=on GATE_LEVEL=standard');
    expect(settingsFor({}).unreadable).toBeNull();
  });

  it('main(): exits 0 with the resolved fail-closed line, naming the file on stderr', () => {
    vi.stubEnv('HOME', home);
    fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), JSON.stringify(MACHINE_WITH(['hipaa'])));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      writeRepoFile('project.json', '{ this is not json');
      const out = SETTINGS.main(['node', SETTINGS_SCRIPT, root], { exec: scriptedExec([TOPLEVEL(root), UNTRACKED]).exec });
      expect(out).toEqual({ code: SETTINGS.EXIT_CODES.RESOLVED, line: failClosedWith('hipaa') });
      expect(out.code).toBe(0);
      expect(stderr.mock.calls.map(c => String(c[0])).join('')).toContain('.devflow/project.json');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('main(): the unreadable line still passes the output gate — a hostile formatter is refused with exit 5', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    writeRepoFile('project.json', '{ this is not json');
    const out = SETTINGS.main(['node', SETTINGS_SCRIPT, root], {
      exec: scriptedExec([TOPLEVEL(root), UNTRACKED]).exec,
      formatLine: () => `${FAIL_CLOSED}\nTRACKER=jira`,
    });
    expect(out).toEqual({ code: 5, line: FAIL_CLOSED });
  });

  describe('the real script: the QA scenario — a broken hipaa project.json never resolves auto or compliance off', { timeout: 20_000 }, () => {
    function runBroken(manifest: string | null) {
      if (manifest !== null) fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), manifest);
      writeRepoFile('project.json', '{ "compliance": ["hipaa"], this is not json');
      const shim = buildScriptedShim(fakeBin, tmp, [TOPLEVEL(root), ORIGIN_HEAD_UNSET]);
      const r = runResolver({ home, args: [root], shim, script: SETTINGS_SCRIPT });
      return { ...r, log: shim.readLog() };
    }

    it.each([
      ['no manifest ⇒ the constant line', null, FAIL_CLOSED],
      ['machine compliance off ⇒ the constant line', JSON.stringify(COMPLIANCE_OFF_MACHINE), FAIL_CLOSED],
      ['a hipaa machine keeps its lens', JSON.stringify(MACHINE_WITH(['hipaa'])), 'hipaa'],
      ['an unreadable manifest ⇒ the constant line', '{ "features": { "compliance": ', FAIL_CLOSED],
    ] as const)('%s', (_label, manifest, expected) => {
      const r = runBroken(manifest);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe(`${expected === 'hipaa' ? failClosedWith('hipaa') : expected}\n`);
      expect(r.stderr).toContain('.devflow/project.json');
      expect(r.log).toEqual([['git', ...ARGV.toplevel], ['git', ...ARGV_ORIGIN_HEAD]]);
    });
  });
});

describe('repository files are never followed or opened when not regular', () => {
  it.each([
    ['a symlink', (p: string) => { fs.symlinkSync(path.join(tmp, 'elsewhere.json'), p); }],
    ['a directory', (p: string) => { fs.mkdirSync(p); }],
  ])('a project.json that is %s is unreadable — the resolution fails closed', (_label, make) => {
    fs.writeFileSync(path.join(tmp, 'elsewhere.json'), '{"features":{"learning":false}}');
    fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
    make(path.join(root, '.devflow', 'project.json'));
    const s = settingsFor({}, MANIFEST_ON, root);
    expect(s.ok).toBe(false);
    expect(s.unreadable).toBe('project');
    expect(SETTINGS.formatSettingsLine(s)).toBe(FAIL_CLOSED);
  });

  it('flags a legacy policy.json in the worktree for the CLI\'s migration hint', () => {
    expect(settingsFor({}, MANIFEST_ON, root).retiredPolicyFile).toBe(false);
    writeRepoFile('policy.json', '{"version":1,"evidencePolicy":"required"}\n');
    expect(settingsFor({}, MANIFEST_ON, root).retiredPolicyFile).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parity with the TypeScript machine-layer readers
// ---------------------------------------------------------------------------

describe('parity: the machine layer reads the manifest exactly as the CLI does', () => {
  const MANIFESTS: ReadonlyArray<readonly [string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['an array', []],
    ['no features', { version: '1' }],
    ['features not an object', { features: 'x' }],
    ['all on', MANIFEST_ON],
    ['memory false', { features: { memory: false } }],
    ['memory "false"', { features: { memory: 'false' } }],
    ['legacy decisions false', { features: { decisions: false } }],
    ['learning true beats legacy decisions false', { features: { learning: true, decisions: false } }],
    ['learning null falls to legacy decisions false', { features: { learning: null, decisions: false } }],
    ['curation false', { features: { curation: false } }],
    ['curation true, learning false resolves off', { features: { curation: true, learning: false } }],
    ['curation false, learning true resolves off', { features: { curation: false, learning: true } }],
    ['curation true beats legacy decisions false', { features: { curation: true, decisions: false } }],
    ['curation "false" falls to legacy decisions false', { features: { curation: 'false', decisions: false } }],
    ['curation "false" alone is ignored', { features: { curation: 'false' } }],
    ['legacy kb false', { features: { kb: false } }],
    ['knowledge false', { features: { knowledge: false } }],
    ['tracker jira', { features: { tracker: { provider: 'jira' } } }],
    ['tracker bare string', { features: { tracker: 'jira' } }],
    ['tracker unknown', { features: { tracker: { provider: 'gitlab' } } }],
    ['compliance on with frameworks', { features: { compliance: { enabled: true, frameworks: ['GDPR', 'nist', 'sox'] } } }],
    ['compliance on at zero', { features: { compliance: { enabled: true, frameworks: [] } } }],
    ['compliance off', { features: { compliance: { enabled: false, frameworks: ['gdpr'] } } }],
    ['compliance enabled as a string', { features: { compliance: { enabled: 'yes', frameworks: [] } } }],
    ['compliance frameworks with a number', { features: { compliance: { enabled: true, frameworks: [1] } } }],
  ];

  function machineOnly(manifest: unknown): Settings {
    return SETTINGS.resolveSettings({ dir: root, manifest }, { exec: scriptedExec([NOT_A_REPO]).exec });
  }

  it.each(MANIFESTS)('%s', (_label, manifest) => {
    const s = machineOnly(manifest);
    expect(s.switches.memory.on, 'memory').toBe(isMachineFeatureOn(manifest, 'memory'));
    expect(s.switches.learning.on, 'curation').toBe(isMachineFeatureOn(manifest, 'curation'));
    expect(s.switches.knowledge.on, 'knowledge').toBe(isMachineFeatureOn(manifest, 'knowledge'));
    const features = (manifest as { features?: { tracker?: unknown; compliance?: unknown } } | null)?.features;
    const rawTracker = typeof features === 'object' && features !== null ? features.tracker : undefined;
    expect(s.tracker).toBe(normalizeTrackerFeature(rawTracker).provider);
    const rawCompliance = typeof features === 'object' && features !== null ? features.compliance : undefined;
    const state = normalizeComplianceFeature(rawCompliance);
    expect(s.compliance.enabled).toBe(state.enabled);
    if (state.enabled) {
      const expected = COMPLIANCE_FRAMEWORKS.map(f => f.id).filter(id => normalizeFrameworks(state.frameworks).includes(id));
      expect([...s.compliance.frameworks]).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// serializeProjectSuggestion — what the CLI prints, never writes
// ---------------------------------------------------------------------------

describe('serializeProjectSuggestion', () => {
  it('prints canonical bytes that read back through the parser as what was asked', () => {
    const text = SETTINGS.serializeProjectSuggestion({ evidence: 'required', compliance: ['GDPR', 'iso27001', 'nist'] });
    expect(text).toBe('{"version":1,"evidence":"required","compliance":["gdpr","iso-27001"]}\n');
    const back = LIB.parseProjectBytes(Buffer.from(text ?? ''));
    expect(back).toMatchObject({
      kind: 'parsed',
      evidence: { kind: 'valid', value: 'required' },
      compliance: { kind: 'valid', value: ['gdpr', 'iso-27001'] },
    });
  });

  it('evidence alone, and nothing at all, are valid suggestions', () => {
    expect(SETTINGS.serializeProjectSuggestion({ evidence: 'standard' })).toBe('{"version":1,"evidence":"standard"}\n');
    expect(SETTINGS.serializeProjectSuggestion({})).toBe('{"version":1}\n');
  });

  it.each([
    ['a bad evidence', { evidence: 'REQUIRED' }],
    ['compliance not a list', { compliance: 'gdpr' }],
    ['compliance with a number', { compliance: [1] }],
    ['not an object', 'required'],
    ['null', null],
  ])('%s ⇒ null (nothing half-formed is printed)', (_label, input) => {
    expect(SETTINGS.serializeProjectSuggestion(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Source guards (non-empty corpus, known-bad probes)
// ---------------------------------------------------------------------------

describe('design decisions at their code sites', () => {
  const SOURCE = fs.readFileSync(SETTINGS_SCRIPT, 'utf8');

  it('the corpus is the real script', () => {
    expect(SOURCE.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(SOURCE.length).toBeGreaterThan(1000);
  });

  it('carries its design decisions at their code sites', () => {
    for (const marker of [
      'D-SETTINGS-LINE', 'D-SETTINGS-LOCAL-ONLY', 'D-PUBLICATION-CEILING', 'D-FEATURES-NARROW-ONLY',
      'D-LENS-UNION', 'D-PERSONAL-UNTRACKED',
    ]) {
      expect(SOURCE, marker).toContain(marker);
    }
  });
});

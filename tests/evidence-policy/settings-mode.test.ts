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
 *     and the argv log holds exactly one git call and no gh call;
 *   - TP-33 (AC-29): the publication truth table (D-PUBLICATION-CEILING) and the
 *     per-feature switch AND table (D-FEATURES-NARROW-ONLY), with the shared
 *     fixture table (TP-49) the shell gates will also run;
 *   - TP-31 (AC-27): repository compliance ids reach COMPLIANCE, an empty list is
 *     generic;
 *   - the tracker rules, parity with the TypeScript machine-layer readers, the
 *     project.json suggestion, and source guards.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { COMPLIANCE_FRAMEWORKS, normalizeComplianceFeature, normalizeFrameworks } from '../../src/core/compliance.js';
import { isMachineFeatureOn, type MachineFeature } from '../../src/core/feature-switch.js';
import { normalizeTrackerFeature } from '../../src/core/tracker.js';
import { MANIFEST_ON, SETTINGS_SWITCH_TABLE } from '../fixtures/settings-switch-table.js';
import {
  ARGV,
  PROJECT_CONFIG_LIB,
  SETTINGS_SCRIPT,
  buildScriptedShim,
  createFakeBin,
  runResolver,
  scriptedExec,
  type ExecFn,
  type FakeBin,
  type ScriptedCall,
} from './scripted-shim.js';

// ---------------------------------------------------------------------------
// The .cjs seam (transcribed from its JSDoc typedefs — PF-043, PF-069)
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
  readonly repoCompliance: readonly string[] | null;
  readonly legacyPolicyFile: boolean;
}

interface SettingsModule {
  readonly TRACKER_SOURCES: readonly string[];
  readonly TRACKER_WARNS: readonly string[];
  readonly EXIT_CODES: Readonly<Record<string, number>>;
  readonly SETTINGS_LINE_RE: RegExp;
  readonly SETTINGS_FAIL_CLOSED_LINE: string;
  foldSettings(inputs: { project: unknown; personal: unknown; manifest: unknown; legacyPolicyFile: boolean }): Settings;
  readRepoLayers(root: string): { project: unknown; personal: unknown };
  resolveSettings(opts: { dir: string; manifest?: unknown }, deps?: { exec?: ExecFn }): Settings;
  formatSettingsLine(s: Settings): string;
  isCoherentSettingsLine(line: unknown): boolean;
  serializeProjectSuggestion(input: unknown): string | null;
  main(argv: readonly string[], deps?: { exec?: ExecFn; formatLine?: (s: Settings) => unknown }): { code: number; line: string };
}

interface LibModule {
  parseProjectBytes(buf: unknown): { kind: string; evidence?: unknown; compliance?: unknown };
  parsePersonalBytes(buf: unknown): { kind: string };
}

const NODE_REQUIRE = createRequire(import.meta.url);
const SETTINGS = NODE_REQUIRE(SETTINGS_SCRIPT) as SettingsModule;
const LIB = NODE_REQUIRE(PROJECT_CONFIG_LIB) as LibModule;

const FAIL_CLOSED =
  'TRACKER=github TRACKER_SOURCE=default TRACKER_WARN=invalid SITE=none KEY=none '
  + 'REVIEW_PUBLICATION=off COMPLIANCE=generic MEMORY=on LEARNING=on KNOWLEDGE=off';

const DEFAULT_LINE =
  'TRACKER=github TRACKER_SOURCE=default TRACKER_WARN=none SITE=none KEY=none '
  + 'REVIEW_PUBLICATION=auto COMPLIANCE=off MEMORY=on LEARNING=on KNOWLEDGE=on';

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
});

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
  return SETTINGS.resolveSettings({ dir: repo, manifest }, { exec: scriptedExec([TOPLEVEL(repo)]).exec });
}

function lineFor(files: { project?: string; personal?: string }, manifest: unknown = MANIFEST_ON): string {
  return SETTINGS.formatSettingsLine(settingsFor(files, manifest));
}

function fieldOf(line: string, key: string): string {
  const m = new RegExp(`(?:^| )${key}=([^ ]*)`).exec(line);
  return m === null ? '' : m[1];
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
      + ' MEMORY=(?<memory>on|off) LEARNING=(?<learning>on|off) KNOWLEDGE=(?<knowledge>on|off)$',
    );
    expect(SETTINGS.SETTINGS_LINE_RE.flags).toBe('');
  });

  const GOOD = 'TRACKER=jira TRACKER_SOURCE=project TRACKER_WARN=none SITE=https://acme.atlassian.net KEY=ACME '
    + 'REVIEW_PUBLICATION=full COMPLIANCE=gdpr,hipaa MEMORY=on LEARNING=off KNOWLEDGE=on';

  it('accepts a full line, and every compliance id alone', () => {
    expect(GOOD).toMatch(SETTINGS.SETTINGS_LINE_RE);
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
    ['reordered fields', GOOD.replace('MEMORY=on LEARNING=off', 'LEARNING=off MEMORY=on')],
    ['a missing field', GOOD.replace(' KNOWLEDGE=on', '')],
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

describe('TP-32 (AC-28): settings mode is local — one grammar line, zero gh calls', { timeout: 20_000 }, () => {
  function run(calls: readonly ScriptedCall[], args: readonly string[] = [root]) {
    const shim = buildScriptedShim(fakeBin, tmp, calls);
    const r = runResolver({ home, args, shim, script: SETTINGS_SCRIPT });
    return { ...r, log: shim.readLog() };
  }

  const SCENARIOS: ReadonlyArray<readonly [string, () => ScriptedCall[]]> = [
    ['an empty repository', () => [TOPLEVEL(root)]],
    ['a repository selecting jira with every key set', () => {
      writeRepoFile('project.json', JSON.stringify({
        version: 1, evidence: 'required', compliance: ['hipaa'],
        tracker: { provider: 'jira', site: 'https://acme.atlassian.net', key: 'ACME' },
        reviewPublication: 'off', features: { learning: false },
      }));
      writeRepoFile('config.json', '{"reviewPublication":"full","tracker":"linear"}');
      return [TOPLEVEL(root)];
    }],
    ['hostile bytes in every file', () => {
      writeRepoFile('project.json', '{"tracker":{"provider":"jira\\nTRACKER=github","site":"https://x.io KEY=PWNED"}}');
      writeRepoFile('config.json', '{"tracker":"github SITE=https://evil.io"}');
      return [TOPLEVEL(root)];
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
    expect(r.log.filter(call => call[0] === 'gh')).toEqual([]);
    expect(r.log).toEqual([['git', ...ARGV.toplevel]]);
    expect(r.stdout).not.toContain('PWNED');
    expect(r.stdout).not.toContain('evil');
  });

  it('the jira repository resolves exactly — the project selects the provider on a github machine', () => {
    writeRepoFile('project.json', JSON.stringify({
      version: 1, compliance: ['hipaa'],
      tracker: { provider: 'jira', site: 'https://acme.atlassian.net', key: 'ACME' },
      reviewPublication: 'off', features: { learning: false },
    }));
    const r = run([TOPLEVEL(root)]);
    expect(r.stdout).toBe('TRACKER=jira TRACKER_SOURCE=project TRACKER_WARN=none SITE=https://acme.atlassian.net KEY=ACME '
      + 'REVIEW_PUBLICATION=off COMPLIANCE=hipaa MEMORY=on LEARNING=off KNOWLEDGE=on\n');
  });

  it('reads the machine manifest from $HOME/.devflow for itself', () => {
    fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), JSON.stringify({
      features: { memory: false, tracker: { provider: 'linear' }, compliance: { enabled: true, frameworks: ['soc2'] } },
    }));
    const r = run([TOPLEVEL(root)]);
    expect(r.stdout).toBe('TRACKER=linear TRACKER_SOURCE=machine TRACKER_WARN=none SITE=none KEY=none '
      + 'REVIEW_PUBLICATION=auto COMPLIANCE=soc2 MEMORY=off LEARNING=on KNOWLEDGE=on\n');
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
      exec: scriptedExec([TOPLEVEL(root)]).exec,
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

  it('an unreadable project.json is the lowest ceiling; an unreadable config.json is no preference', () => {
    expect(settingsFor({ project: '{"reviewPublication":', personal: '{"reviewPublication":"full"}' }).reviewPublication)
      .toBe('off');
    expect(settingsFor({ project: '{"reviewPublication":"full"}', personal: '{"reviewPublication":' }).reviewPublication)
      .toBe('auto');
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
  it('folds to exactly what resolveSettings folds, on every row of the shared table', () => {
    for (const row of SETTINGS_SWITCH_TABLE) {
      const dir = fs.mkdtempSync(path.join(tmp, 'layers-'));
      if (row.project !== null) writeRepoFile('project.json', row.project, dir);
      if (row.personal !== null) writeRepoFile('config.json', row.personal, dir);
      const viaLayers = SETTINGS.foldSettings({ ...SETTINGS.readRepoLayers(dir), manifest: row.manifest, legacyPolicyFile: false });
      const viaResolve = settingsFor({}, row.manifest, dir);
      expect(viaLayers.switches, row.name).toEqual(viaResolve.switches);
    }
  });

  it('reads nothing from a root with no .devflow, and never throws', () => {
    const layers = SETTINGS.readRepoLayers(path.join(tmp, 'missing'));
    expect(layers).toEqual({ project: { kind: 'absent' }, personal: { kind: 'absent' } });
    expect(Object.isFrozen(layers)).toBe(true);
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
    expect({
      memory: s.switches.memory.on,
      learning: s.switches.learning.on,
      knowledge: s.switches.knowledge.on,
    }).toEqual(row.expect);
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
    ['unreadable project.json ⇒ invalid', MACHINE('jira'), '{"tracker":', undefined, 'jira', 'machine', 'invalid', 'none', 'none'],
    ['project site/key without provider apply to the machine provider', MACHINE('jira'), '{"tracker":{"site":"https://acme.atlassian.net","key":"ACME"}}', undefined, 'jira', 'machine', 'none', 'https://acme.atlassian.net', 'ACME'],
    ['a github project prints no site or key', MACHINE(), '{"tracker":{"provider":"github","site":"https://acme.atlassian.net","key":"ACME"}}', undefined, 'github', 'project', 'none', 'none', 'none'],
    ['an unreadable personal file is no override', MACHINE('jira'), undefined, '{"tracker":"linear"', 'jira', 'machine', 'none', 'none', 'none'],
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
      + 'REVIEW_PUBLICATION=auto COMPLIANCE=off MEMORY=on LEARNING=off KNOWLEDGE=on');
  });
});

describe('repository files are never followed or opened when not regular', () => {
  it.each([
    ['a symlink', (p: string) => { fs.symlinkSync(path.join(tmp, 'elsewhere.json'), p); }],
    ['a directory', (p: string) => { fs.mkdirSync(p); }],
  ])('a project.json that is %s reads as unreadable', (_label, make) => {
    fs.writeFileSync(path.join(tmp, 'elsewhere.json'), '{"features":{"learning":false}}');
    fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
    make(path.join(root, '.devflow', 'project.json'));
    const s = settingsFor({}, MANIFEST_ON, root);
    expect(SETTINGS.formatSettingsLine(s)).toBe('TRACKER=github TRACKER_SOURCE=default TRACKER_WARN=invalid SITE=none '
      + 'KEY=none REVIEW_PUBLICATION=off COMPLIANCE=generic MEMORY=on LEARNING=on KNOWLEDGE=on');
  });

  it('flags a legacy policy.json in the worktree for the CLI\'s migration hint', () => {
    expect(settingsFor({}, MANIFEST_ON, root).legacyPolicyFile).toBe(false);
    writeRepoFile('policy.json', '{"version":1,"evidencePolicy":"required"}\n');
    expect(settingsFor({}, MANIFEST_ON, root).legacyPolicyFile).toBe(true);
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
    for (const feature of ['memory', 'learning', 'knowledge'] as const) {
      expect(s.switches[feature].on, feature).toBe(isMachineFeatureOn(manifest, feature));
    }
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
// Source guards (PF-064: non-empty corpus, known-bad probes)
// ---------------------------------------------------------------------------

describe('source guards (D-SETTINGS-LOCAL-ONLY)', () => {
  const SOURCE = fs.readFileSync(SETTINGS_SCRIPT, 'utf8');
  const codeLines = (source: string): string[] => source.split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))
    .filter(l => !/^\s*(\*|\/\*)/.test(l));
  const code = (source: string): string => codeLines(source).join('\n');

  const collectSpawnTools = (s: string): string[] =>
    [...code(s).matchAll(/\bexec\(\s*'([^']+)'/g)].map(m => m[1]);
  const collectGhMentions = (s: string): string[] => codeLines(s).filter(l => /['"]gh['"]/.test(l));
  const collectRequires = (s: string): string[] =>
    [...code(s).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);

  it('the corpus is the real script', () => {
    expect(SOURCE.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(SOURCE.length).toBeGreaterThan(1000);
  });

  it('exactly one subprocess, and it is git — a seeded gh spawn is reported', () => {
    expect(collectSpawnTools(SOURCE)).toEqual(['git']);
    expect(collectGhMentions(SOURCE)).toEqual([]);
    const seeded = `${SOURCE}\nconst r = exec('gh', ['api'], {});\n`;
    expect(collectSpawnTools(seeded)).toEqual(['git', 'gh']);
    expect(collectGhMentions(seeded)).toHaveLength(1);
  });

  it('spawnSync appears once (defaultExec), never with a shell', () => {
    expect(code(SOURCE).match(/spawnSync\(/g)).toHaveLength(1);
    expect(code(SOURCE)).not.toMatch(/shell:\s*true/);
  });

  it('one stdout write, one exitCode setter, no process.exit, no fs write', () => {
    expect(codeLines(SOURCE).filter(l => /process\.stdout\.write/.test(l))).toHaveLength(1);
    expect(codeLines(SOURCE).filter(l => /process\.exitCode\s*=/.test(l))).toHaveLength(1);
    expect(codeLines(SOURCE).filter(l => /process\.exit\s*\(/.test(l))).toEqual([]);
    expect(codeLines(SOURCE).filter(l => /\bfs\.(?:write|append|rename|unlink|rm|mkdir|copyFile|symlink|chmod)\w*\s*\(/.test(l)))
      .toEqual([]);
  });

  it('requires Node built-ins and the shared parser only', () => {
    expect([...new Set(collectRequires(SOURCE))].sort()).toEqual(['./lib/project-config.cjs', 'child_process', 'fs', 'path']);
  });

  it('carries its design decisions at their code sites', () => {
    for (const marker of ['D-SETTINGS-LINE', 'D-SETTINGS-LOCAL-ONLY', 'D-PUBLICATION-CEILING', 'D-FEATURES-NARROW-ONLY', 'ADR-024']) {
      expect(SOURCE, marker).toContain(marker);
    }
  });
});

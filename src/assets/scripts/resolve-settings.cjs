#!/usr/bin/env node
// src/assets/scripts/resolve-settings.cjs
//
// Resolves the per-repository SETTINGS a prompt or the CLI acts on — tracker,
// review publication, compliance lens and the three feature switches — from
// three LOCAL layers, and prints them on ONE closed-vocabulary line. Installed as
// a top-level sibling of resolve-evidence-policy.cjs under ~/.devflow/scripts/,
// sharing its parser (lib/project-config.cjs).
//
// Usage: node resolve-settings.cjs [<dir>]      (<dir> defaults to cwd)
//
// The layers, in the order they are folded:
//   project   <toplevel>/.devflow/project.json  team-committed, this worktree's copy
//   personal  <toplevel>/.devflow/config.json   uncommitted, narrow-only
//   machine   ~/.devflow/manifest.json          the machine-wide install
//
// D-SETTINGS-LOCAL-ONLY: exactly ONE subprocess — `git rev-parse
// --show-toplevel` — and never gh, never the network, never a git command that
// refreshes the index. The team's evidence FLOOR is the default branch's and is
// resolve-evidence-policy.cjs's job (it runs over the network, from commands);
// what this script resolves only ever adds scrutiny or narrows a switch, so the
// worktree's own copy is the right one to read and a branch that edits it can
// only change its own lens. It WRITES NOTHING (applies ADR-024).
//
// stdout is exactly one line plus "\n", or empty (D-SETTINGS-LINE):
//   TRACKER=<github|jira|linear> TRACKER_SOURCE=<project|personal|machine|default>
//   TRACKER_WARN=<none|mismatch|invalid> SITE=<url|none> KEY=<KEY|none>
//   REVIEW_PUBLICATION=<off|auto|full> COMPLIANCE=<off|generic|id,…>
//   MEMORY=<on|off> LEARNING=<on|off> KNOWLEDGE=<on|off>
// (one line on stdout; wrapped here for reading). Every value is a closed token
// or a SITE/KEY that passed its shape gate, so no other byte of a config file can
// reach stdout.
//
// Exit codes (a caller treats EVERY non-zero code as the fail-closed line):
//   0  resolved — the line above
//   1  usage error — stdout entirely empty, usage on stderr
//   2  input unusable — <dir> missing or not a directory; prints SETTINGS_FAIL_CLOSED_LINE
//   3  never emitted — this script writes no file
//   4  internal error — or git could not say whether <dir> is in a repository;
//      prints SETTINGS_FAIL_CLOSED_LINE
//   5  output gate refused — the composed line failed the grammar or its
//      coherence checks; prints SETTINGS_FAIL_CLOSED_LINE
//
// Design constraints (binding, shared with resolve-evidence-policy.cjs):
//   - main() returns {code, line} and never calls process.exit; the single
//     `require.main === module` boundary is the only stdout write and the only
//     exitCode assignment
//   - the one subprocess is spawned with an argv array (never a shell), stdin
//     ignored, a timeout and a maxBuffer
//   - a config file that is not a regular file is never opened, and one over
//     MAX_CONFIG_BYTES is never read

'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const projectConfig = require('./lib/project-config.cjs');

const {
  PUBLICATIONS,
  TRACKER_PROVIDER_IDS,
  COMPLIANCE_IDS,
  FEATURE_SWITCHES,
  TRACKER_SITE_RE,
  TRACKER_KEY_RE,
  MAX_CONFIG_BYTES,
} = projectConfig;

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** @typedef {'github' | 'jira' | 'linear'} TrackerProvider */
/** @typedef {'project' | 'personal' | 'machine' | 'default'} TrackerSource */
/** @typedef {'none' | 'mismatch' | 'invalid'} TrackerWarn */
/** @typedef {'off' | 'auto' | 'full'} Publication */
/** @typedef {'memory' | 'learning' | 'knowledge'} FeatureSwitch */
/** @typedef {'machine' | 'project' | 'personal'} SwitchSource */

/** Who decided TRACKER. `default` is github with no layer naming a provider. */
const TRACKER_SOURCES = Object.freeze(/** @type {TrackerSource[]} */ (['project', 'personal', 'machine', 'default']));

/**
 * TRACKER_WARN tokens, mildest first.
 *   mismatch  the personal override names a provider other than github or the
 *             resolved one — a personal file may only narrow, so it is ignored
 *   invalid   a tracker value (project provider, site or key; the personal
 *             override) is malformed. The Git agent maps this to its existing
 *             `unknown tracker provider` DEGRADED reason
 */
const TRACKER_WARNS = Object.freeze(/** @type {TrackerWarn[]} */ (['none', 'mismatch', 'invalid']));

/** Exit codes by meaning; 3 is deliberately absent (no arm can produce it). */
const EXIT_CODES = Object.freeze({
  RESOLVED: 0,
  USAGE: 1,
  INPUT_UNUSABLE: 2,
  INTERNAL_ERROR: 4,
  OUTPUT_GATE_REFUSED: 5,
});

/**
 * D-SETTINGS-LINE: the exported output grammar — anchored, fixed field order,
 * closed alternations built from the shared registries, named groups for
 * consumers. SITE and KEY reuse the parser's own shape gates, so a line can only
 * carry a site or key the parser admitted. COMPLIANCE is `off`, `generic` (the
 * lens with no framework reference), or registry ids joined by commas.
 */
const SETTINGS_LINE_RE = new RegExp(
  '^TRACKER=(?<tracker>' + TRACKER_PROVIDER_IDS.join('|') + ')'
  + ' TRACKER_SOURCE=(?<trackerSource>' + TRACKER_SOURCES.join('|') + ')'
  + ' TRACKER_WARN=(?<trackerWarn>' + TRACKER_WARNS.join('|') + ')'
  + ' SITE=(?<site>none|' + TRACKER_SITE_RE.source.slice(1, -1) + ')'
  + ' KEY=(?<key>none|' + TRACKER_KEY_RE.source.slice(1, -1) + ')'
  + ' REVIEW_PUBLICATION=(?<publication>' + PUBLICATIONS.join('|') + ')'
  + ' COMPLIANCE=(?<compliance>off|generic|(?:' + COMPLIANCE_IDS.join('|') + ')(?:,(?:'
  + COMPLIANCE_IDS.join('|') + ')){0,' + String(COMPLIANCE_IDS.length - 1) + '})'
  + ' MEMORY=(?<memory>on|off) LEARNING=(?<learning>on|off) KNOWLEDGE=(?<knowledge>on|off)$',
);

/**
 * The line every refusal prints (exits 2, 4 and 5), and what a consumer uses in
 * place of any line it cannot accept. A constant, so the boundary can never fail
 * to compose it. Each field is the conservative reading for its consumer:
 *   TRACKER_WARN=invalid     the Git agent degrades rather than guessing a provider
 *   REVIEW_PUBLICATION=off   nothing is published (raised to a stub under required)
 *   COMPLIANCE=generic       the review lens still runs
 *   KNOWLEDGE=off            no knowledge write-back commits into the repository
 *   MEMORY/LEARNING=on       the machine switch is the one that turns them off;
 *                            hooks never consume this line
 */
const SETTINGS_FAIL_CLOSED_LINE =
  'TRACKER=github TRACKER_SOURCE=default TRACKER_WARN=invalid SITE=none KEY=none '
  + 'REVIEW_PUBLICATION=off COMPLIANCE=generic MEMORY=on LEARNING=on KNOWLEDGE=off';

/** Bound on the one git call. */
const GIT_TIMEOUT_MS = 5000;
/** rev-parse prints one short line. */
const LINE_MAX_BUFFER = 4096;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * @typedef {{ on: boolean, source: SwitchSource }} SwitchState
 *   `source` is the layer that decided: `machine` when the machine switch is off
 *   or nothing narrowed it, else the repo layer whose literal `false` narrowed it.
 *
 * @typedef {{
 *   ok: boolean,
 *   tracker: TrackerProvider,
 *   trackerSource: TrackerSource,
 *   trackerWarn: TrackerWarn,
 *   site: string | null,
 *   key: string | null,
 *   reviewPublication: Publication,
 *   compliance: { enabled: boolean, frameworks: readonly string[] },
 *   switches: { memory: SwitchState, learning: SwitchState, knowledge: SwitchState },
 *   repoCompliance: readonly string[] | null,
 *   legacyPolicyFile: boolean,
 * }} Settings
 *   ok              false only for the fail-closed resolution
 *   compliance      enabled with no frameworks is `generic`
 *   repoCompliance  the worktree project.json's ids, or null when it declares
 *                   none (a malformed declaration reads as [] — generic)
 *   legacyPolicyFile  the worktree still holds .devflow/policy.json (the CLI
 *                   prints a migration hint)
 *
 * @typedef {{ project: object, personal: object, manifest: unknown, legacyPolicyFile: boolean }} SettingsInputs
 *   project/personal are lib/project-config.cjs ProjectConfig / PersonalConfig.
 *
 * @typedef {{ status: number | null, stdout?: Buffer | string, error?: { code?: string } }} ExecResult
 * @typedef {(file: string, args: string[], opts: object) => ExecResult} ExecFn
 * @typedef {{ dir: string, manifest?: unknown }} ResolveSettingsOptions
 *   `manifest` is an already-parsed ~/.devflow/manifest.json; omitted
 *   (undefined), the script reads it itself.
 */

/** @type {Settings} */
const FAIL_CLOSED_SETTINGS = Object.freeze({
  ok: false,
  tracker: 'github',
  trackerSource: 'default',
  trackerWarn: 'invalid',
  site: null,
  key: null,
  reviewPublication: 'off',
  compliance: Object.freeze({ enabled: true, frameworks: Object.freeze([]) }),
  switches: Object.freeze({
    memory: Object.freeze({ on: true, source: /** @type {SwitchSource} */ ('machine') }),
    learning: Object.freeze({ on: true, source: /** @type {SwitchSource} */ ('machine') }),
    knowledge: Object.freeze({ on: false, source: /** @type {SwitchSource} */ ('machine') }),
  }),
  repoCompliance: null,
  legacyPolicyFile: false,
});

const ABSENT_FIELD = Object.freeze({ kind: 'absent' });
const MALFORMED_FIELD = Object.freeze({ kind: 'malformed' });

// ---------------------------------------------------------------------------
// Machine-layer mirrors (pinned to the TypeScript by parity tests)
// ---------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The pre-rename key each switch was stored under (feature-switch.ts LEGACY_KEYS). */
const LEGACY_SWITCH_KEYS = Object.freeze({ learning: 'decisions', knowledge: 'kb' });

/**
 * src/core/feature-switch.ts isMachineFeatureOn exactly: only an explicit
 * boolean `false` is off, the legacy key is read when the current one is not a
 * boolean, and anything that is not a manifest-shaped object is on.
 *
 * @param {unknown} manifest
 * @param {FeatureSwitch} feature
 * @returns {boolean}
 */
function machineSwitchOn(manifest, feature) {
  if (!isPlainObject(manifest)) return true;
  const features = manifest.features;
  if (!isPlainObject(features)) return true;
  const legacy = /** @type {Record<string, string>} */ (LEGACY_SWITCH_KEYS)[feature];
  const value = legacy !== undefined && typeof features[feature] !== 'boolean' ? features[legacy] : features[feature];
  return value !== false;
}

/**
 * src/core/tracker.ts normalizeTrackerFeature, plus whether a provider was
 * actually recorded (`machine`) or defaulted (`default`).
 *
 * @param {unknown} manifest
 * @returns {{ provider: TrackerProvider, recorded: boolean }}
 */
function machineTracker(manifest) {
  const tracker = isPlainObject(manifest) && isPlainObject(manifest.features) ? manifest.features.tracker : undefined;
  if (isPlainObject(tracker) && TRACKER_PROVIDER_IDS.includes(tracker.provider)) {
    return { provider: /** @type {TrackerProvider} */ (tracker.provider), recorded: true };
  }
  return { provider: 'github', recorded: false };
}

/**
 * The machine compliance lens: null when off, else its registry ids —
 * src/core/compliance.ts normalizeComplianceFeature, then normalizeFrameworks.
 *
 * @param {unknown} manifest
 * @returns {string[] | null}
 */
function machineCompliance(manifest) {
  const raw = isPlainObject(manifest) && isPlainObject(manifest.features) ? manifest.features.compliance : undefined;
  if (!isPlainObject(raw) || typeof raw.enabled !== 'boolean' || !Array.isArray(raw.frameworks)) return null;
  if (!raw.frameworks.every((/** @type {unknown} */ f) => typeof f === 'string')) return null;
  return raw.enabled ? projectConfig.normalizeComplianceIds(raw.frameworks) : null;
}

// ---------------------------------------------------------------------------
// The fold (the functional core)
// ---------------------------------------------------------------------------

/**
 * A field of a parsed file, or the file-level verdict applied to it: an absent
 * file has the field absent; an invalid file has every field malformed.
 *
 * @param {any} file
 * @param {string} key
 * @param {'malformed' | 'absent'} whenInvalid
 * @returns {any}
 */
function fieldIn(file, key, whenInvalid) {
  if (file.kind === 'parsed') return file[key];
  if (file.kind === 'invalid') return whenInvalid === 'malformed' ? MALFORMED_FIELD : ABSENT_FIELD;
  return ABSENT_FIELD;
}

/**
 * The tracker (D-SETTINGS-LINE, tracker rules):
 *   1. project.json `tracker.provider`, else the machine's recorded provider,
 *      else github (`default`);
 *   2. the personal override may only NARROW — to github, or to the provider
 *      step 1 resolved. Anything else is ignored and flagged `mismatch`;
 *   3. a malformed value anywhere (project provider/site/key, the personal
 *      override, an unreadable project.json) is flagged `invalid`, and a
 *      malformed site or key is never printed.
 * SITE and KEY are the project's, printed only when the resolved provider is not
 * github — a github repository has neither.
 *
 * @param {any} project
 * @param {any} personal
 * @param {unknown} manifest
 * @returns {Pick<Settings, 'tracker' | 'trackerSource' | 'trackerWarn' | 'site' | 'key'>}
 */
function foldTracker(project, personal, manifest) {
  let invalid = false;
  let mismatch = false;
  /** @type {TrackerProvider | null} */
  let projectProvider = null;
  /** @type {string | null} */
  let site = null;
  /** @type {string | null} */
  let key = null;

  const projectTracker = fieldIn(project, 'tracker', 'malformed');
  if (projectTracker.kind === 'malformed') invalid = true;
  if (projectTracker.kind === 'valid') {
    const t = projectTracker.value;
    if (t.provider.kind === 'valid') projectProvider = t.provider.value;
    if (t.site.kind === 'valid') site = t.site.value;
    if (t.key.kind === 'valid') key = t.key.value;
    if (t.provider.kind === 'malformed' || t.site.kind === 'malformed' || t.key.kind === 'malformed') invalid = true;
  }

  /** @type {TrackerProvider} */
  let tracker;
  /** @type {TrackerSource} */
  let trackerSource;
  if (projectProvider !== null) {
    tracker = projectProvider;
    trackerSource = 'project';
  } else {
    const machine = machineTracker(manifest);
    tracker = machine.provider;
    trackerSource = machine.recorded ? 'machine' : 'default';
  }

  // An unreadable personal file is no override at all — readConfig's reading.
  const override = fieldIn(personal, 'tracker', 'absent');
  if (override.kind === 'malformed') invalid = true;
  if (override.kind === 'valid') {
    if (override.value === 'github' || override.value === tracker) {
      tracker = override.value;
      trackerSource = 'personal';
    } else {
      mismatch = true;
    }
  }

  return {
    tracker,
    trackerSource,
    trackerWarn: invalid ? 'invalid' : mismatch ? 'mismatch' : 'none',
    site: tracker === 'github' ? null : site,
    key: tracker === 'github' ? null : key,
  };
}

/**
 * D-PUBLICATION-CEILING: review publication is
 *   min(team ?? full, personal ?? team ?? auto)   over off < auto < full.
 * The team value is a CEILING no personal value can raise, and the default a
 * personal value starts from; with neither, the historical default `auto`. A
 * malformed team value (or an unreadable project.json) is `off` — a ceiling
 * that cannot be read is the lowest one. A malformed personal value is ignored,
 * as readConfig ignores it.
 *
 * @param {any} project
 * @param {any} personal
 * @returns {Publication}
 */
function foldPublication(project, personal) {
  const teamField = fieldIn(project, 'reviewPublication', 'malformed');
  /** @type {Publication | null} */
  const team = teamField.kind === 'valid' ? teamField.value : teamField.kind === 'malformed' ? 'off' : null;
  const personalField = fieldIn(personal, 'reviewPublication', 'absent');
  /** @type {Publication | null} */
  const own = personalField.kind === 'valid' ? personalField.value : null;
  const ceiling = team === null ? 'full' : team;
  const wanted = own !== null ? own : team !== null ? team : 'auto';
  return PUBLICATIONS.indexOf(wanted) <= PUBLICATIONS.indexOf(ceiling) ? wanted : ceiling;
}

/**
 * Compliance lens: machine ∪ worktree. `off` only when the machine is off AND
 * the worktree declares nothing; a malformed worktree declaration (or an
 * unreadable project.json) is `generic` — the lens runs with no framework
 * reference, never silently not at all. The lens only adds scrutiny, so the
 * worktree's copy is the right one: a branch that deletes its key drops only its
 * own lens, and the evidence floor still comes from the default branch.
 *
 * @param {any} project
 * @param {unknown} manifest
 * @returns {{ compliance: Settings['compliance'], repoCompliance: readonly string[] | null }}
 */
function foldCompliance(project, manifest) {
  const machine = machineCompliance(manifest);
  const repoField = fieldIn(project, 'compliance', 'malformed');
  /** @type {readonly string[] | null} */
  const repo = repoField.kind === 'valid' ? repoField.value : repoField.kind === 'malformed' ? Object.freeze([]) : null;
  if (machine === null && repo === null) {
    return { compliance: Object.freeze({ enabled: false, frameworks: Object.freeze([]) }), repoCompliance: null };
  }
  const union = COMPLIANCE_IDS.filter(id => (machine !== null && machine.includes(id)) || (repo !== null && repo.includes(id)));
  return { compliance: Object.freeze({ enabled: true, frameworks: Object.freeze(union) }), repoCompliance: repo };
}

/**
 * D-FEATURES-NARROW-ONLY (src/core/feature-switch.ts): a switch is on iff the
 * machine switch is on AND project.json's `features.<name>` is not `false` AND
 * config.json's `features.<name>` is not `false`. Only a literal `false`
 * narrows: absent, malformed, duplicated and unreadable all leave the switch as
 * the machine set it. No repo layer can turn on what the machine turned off.
 *
 * @param {any} project
 * @param {any} personal
 * @param {unknown} manifest
 * @param {FeatureSwitch} feature
 * @returns {SwitchState}
 */
function foldSwitch(project, personal, manifest, feature) {
  /** @param {any} file */
  const narrows = file => {
    const features = fieldIn(file, 'features', 'absent');
    return features.kind === 'valid' && features.value[feature].kind === 'valid' && features.value[feature].value === false;
  };
  if (!machineSwitchOn(manifest, feature)) return Object.freeze({ on: false, source: 'machine' });
  if (narrows(project)) return Object.freeze({ on: false, source: 'project' });
  if (narrows(personal)) return Object.freeze({ on: false, source: 'personal' });
  return Object.freeze({ on: true, source: 'machine' });
}

/**
 * Fold the three layers into Settings. Pure; never throws on any parser output.
 *
 * @param {SettingsInputs} inputs
 * @returns {Settings}
 */
function foldSettings(inputs) {
  const { project, personal, manifest } = inputs;
  const tracker = foldTracker(project, personal, manifest);
  const { compliance, repoCompliance } = foldCompliance(project, manifest);
  return Object.freeze({
    ok: true,
    ...tracker,
    reviewPublication: foldPublication(project, personal),
    compliance,
    switches: Object.freeze({
      memory: foldSwitch(project, personal, manifest, 'memory'),
      learning: foldSwitch(project, personal, manifest, 'learning'),
      knowledge: foldSwitch(project, personal, manifest, 'knowledge'),
    }),
    repoCompliance,
    legacyPolicyFile: inputs.legacyPolicyFile === true,
  });
}

// ---------------------------------------------------------------------------
// Gathering the layers (the imperative shell — D-SETTINGS-LOCAL-ONLY)
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
 * THE one subprocess: the repository root of `dir`.
 *   root     exit 0 with exactly one absolute path plus its newline
 *   none     git ANSWERED non-zero — not a repository; only the machine layer applies
 *   unknown  git did not answer, or answered 0 with an unusable path ⇒ fail closed
 *
 * @param {ExecFn} exec
 * @param {string} dir
 * @returns {{ kind: 'root', root: string } | { kind: 'none' } | { kind: 'unknown' }}
 */
function gitToplevel(exec, dir) {
  const res = exec('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir,
    env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: LINE_MAX_BUFFER,
    windowsHide: true,
    shell: false,
  });
  if (!res || res.error || typeof res.status !== 'number') return { kind: 'unknown' };
  if (res.status !== 0) return { kind: 'none' };
  const out = Buffer.isBuffer(res.stdout) ? res.stdout.toString('utf8') : typeof res.stdout === 'string' ? res.stdout : '';
  const text = out.replace(/\r?\n$/, '');
  if (text === '' || /[\r\n\0]/.test(text) || !path.isAbsolute(text)) return { kind: 'unknown' };
  return { kind: 'root', root: text };
}

/**
 * One repository config file, classified. lstat-refused, never followed: a
 * symlink, directory, FIFO or device — or a file over MAX_CONFIG_BYTES — is
 * invalid unopened.
 *
 * @param {string} filePath
 * @param {(buf: Buffer | null) => object} parse
 * @returns {object}
 */
function readConfigFile(filePath, parse) {
  const read = projectConfig.readBoundedRegularFile(filePath, MAX_CONFIG_BYTES, false);
  if (read.kind === 'ok') return parse(read.bytes);
  return read.kind === 'absent' ? parse(null) : Object.freeze({ kind: 'invalid' });
}

/**
 * The two repository layers under `<root>/.devflow`, each read and classified by
 * readConfigFile. Exported for the hooks' one parser fork (queue_read_gates in
 * scripts/hooks/queue-append, D-FEATURES-NARROW-ONLY): a file the shell fast path
 * hands over is read by exactly the code resolveSettings reads it with, so the two
 * cannot disagree about a symlink, a size, a BOM or a duplicated key. Makes no
 * subprocess; never throws on a missing or unreadable file.
 *
 * @param {string} root
 * @returns {{ project: object, personal: object }}
 */
function readRepoLayers(root) {
  const devflow = path.join(root, '.devflow');
  return Object.freeze({
    project: readConfigFile(path.join(devflow, 'project.json'), projectConfig.parseProjectBytes),
    personal: readConfigFile(path.join(devflow, 'config.json'), projectConfig.parsePersonalBytes),
  });
}

/**
 * Whether anything exists at `filePath` (never followed, never opened).
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function existsNoFollow(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Resolve the settings for `opts.dir`. Never throws: a git that cannot say
 * whether `opts.dir` is in a repository, or any internal failure, is the
 * fail-closed resolution, which main() maps to exit 4.
 *
 * @param {ResolveSettingsOptions} opts
 * @param {{ exec?: ExecFn }} [deps]
 * @returns {Settings}
 */
function resolveSettings(opts, deps) {
  try {
    const exec = deps && typeof deps.exec === 'function' ? deps.exec : defaultExec;
    const manifest = opts.manifest !== undefined ? opts.manifest : projectConfig.readMachineManifest();
    const toplevel = gitToplevel(exec, opts.dir);
    if (toplevel.kind === 'unknown') return FAIL_CLOSED_SETTINGS;
    if (toplevel.kind === 'none') {
      const none = projectConfig.parseProjectBytes(null);
      return foldSettings({ project: none, personal: none, manifest, legacyPolicyFile: false });
    }
    const { project, personal } = readRepoLayers(toplevel.root);
    return foldSettings({
      project,
      personal,
      manifest,
      legacyPolicyFile: existsNoFollow(path.join(toplevel.root, '.devflow', 'policy.json')),
    });
  } catch (_) {
    return FAIL_CLOSED_SETTINGS;
  }
}

// ---------------------------------------------------------------------------
// The line, and the gate on it
// ---------------------------------------------------------------------------

/**
 * The COMPLIANCE token for a lens.
 *
 * @param {Settings['compliance']} c
 * @returns {string}
 */
function complianceToken(c) {
  if (!c.enabled) return 'off';
  return c.frameworks.length === 0 ? 'generic' : c.frameworks.join(',');
}

/**
 * Compose the stdout line (D-SETTINGS-LINE).
 *
 * @param {Settings} s
 * @returns {string}
 */
function formatSettingsLine(s) {
  /** @param {SwitchState} sw */
  const onOff = sw => (sw.on ? 'on' : 'off');
  return 'TRACKER=' + s.tracker
    + ' TRACKER_SOURCE=' + s.trackerSource
    + ' TRACKER_WARN=' + s.trackerWarn
    + ' SITE=' + (s.site === null ? 'none' : s.site)
    + ' KEY=' + (s.key === null ? 'none' : s.key)
    + ' REVIEW_PUBLICATION=' + s.reviewPublication
    + ' COMPLIANCE=' + complianceToken(s.compliance)
    + ' MEMORY=' + onOff(s.switches.memory)
    + ' LEARNING=' + onOff(s.switches.learning)
    + ' KNOWLEDGE=' + onOff(s.switches.knowledge);
}

/**
 * Whether a line is well-formed AND coherent: it matches SETTINGS_LINE_RE, its
 * compliance ids are unique and in registry order, a github tracker carries no
 * SITE or KEY, and a `default` tracker source is github.
 *
 * @param {unknown} line
 * @returns {boolean}
 */
function isCoherentSettingsLine(line) {
  if (typeof line !== 'string') return false;
  const m = SETTINGS_LINE_RE.exec(line);
  if (m === null || m.groups === undefined) return false;
  const g = m.groups;
  if (g.tracker === 'github' && (g.site !== 'none' || g.key !== 'none')) return false;
  if (g.trackerSource === 'default' && g.tracker !== 'github') return false;
  if (g.compliance !== 'off' && g.compliance !== 'generic') {
    const order = g.compliance.split(',').map(id => COMPLIANCE_IDS.indexOf(id));
    for (let i = 1; i < order.length; i++) {
      if (order[i] <= order[i - 1]) return false;
    }
  }
  return true;
}

/**
 * Settle whatever main() returned into what the boundary may print.
 *
 * @param {unknown} outcome
 * @returns {{ code: number, line: string }}
 */
function settleOutcome(outcome) {
  const o = /** @type {any} */ (outcome);
  if (o === null || typeof o !== 'object' || typeof o.line !== 'string') {
    return { code: EXIT_CODES.INTERNAL_ERROR, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  if (o.code === EXIT_CODES.USAGE) return { code: EXIT_CODES.USAGE, line: '' };
  if (o.code === EXIT_CODES.RESOLVED) {
    return isCoherentSettingsLine(o.line)
      ? { code: o.code, line: o.line }
      : { code: EXIT_CODES.OUTPUT_GATE_REFUSED, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  if (o.code === EXIT_CODES.INPUT_UNUSABLE || o.code === EXIT_CODES.OUTPUT_GATE_REFUSED) {
    return { code: o.code, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  return { code: EXIT_CODES.INTERNAL_ERROR, line: SETTINGS_FAIL_CLOSED_LINE };
}

// ---------------------------------------------------------------------------
// The suggestion the CLI prints (never writes — ADR-024)
// ---------------------------------------------------------------------------

/**
 * The canonical `.devflow/project.json` bytes the CLI suggests a team commit:
 * `{"version":1[,"evidence":…][,"compliance":[…]]}\n`, in that key order.
 * `evidence` must be a policy value; `compliance` a list of strings, normalized
 * to registry ids as the parser would read them. Null for anything else, and
 * null unless the bytes read back through parseProjectBytes as exactly what was
 * asked for — nothing half-formed is ever printed.
 *
 * @param {unknown} input  `{ evidence?, compliance? }`
 * @returns {string | null}
 */
function serializeProjectSuggestion(input) {
  if (!isPlainObject(input)) return null;
  /** @type {Record<string, unknown>} */
  const out = { version: 1 };
  if (Object.prototype.hasOwnProperty.call(input, 'evidence')) {
    if (!projectConfig.POLICIES.includes(input.evidence)) return null;
    out.evidence = input.evidence;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'compliance')) {
    const list = input.compliance;
    if (!Array.isArray(list) || !list.every(v => typeof v === 'string')) return null;
    out.compliance = projectConfig.normalizeComplianceIds(list);
  }
  const text = JSON.stringify(out) + '\n';
  const back = /** @type {any} */ (projectConfig.parseProjectBytes(Buffer.from(text, 'utf8')));
  if (back.kind !== 'parsed' || back.version.kind !== 'valid') return null;
  if (out.evidence !== undefined && (back.evidence.kind !== 'valid' || back.evidence.value !== out.evidence)) return null;
  if (out.compliance !== undefined && back.compliance.kind !== 'valid') return null;
  return text;
}

// ---------------------------------------------------------------------------
// main — returns {code, line}; never calls process.exit
// ---------------------------------------------------------------------------

/**
 * @param {readonly string[]} argv  process.argv
 * @returns {{ kind: 'resolve', dir: string } | { kind: 'usage', usage: string }}
 */
function parseArgs(argv) {
  const USAGE = 'Usage: node resolve-settings.cjs [<dir>]';
  const rest = Array.isArray(argv) ? argv.slice(2) : [];
  /** @type {string[]} */
  const positionals = [];
  for (const arg of rest) {
    if (typeof arg !== 'string' || arg.startsWith('-')) {
      return {
        kind: 'usage',
        usage: 'resolve-settings: unrecognised argument ' + JSON.stringify(String(arg)).slice(0, 80) + '\n' + USAGE,
      };
    }
    positionals.push(arg);
  }
  if (positionals.length > 1) return { kind: 'usage', usage: USAGE };
  return { kind: 'resolve', dir: positionals.length === 1 ? positionals[0] : process.cwd() };
}

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
 * @param {{ exec?: ExecFn, formatLine?: (s: Settings) => unknown }} [deps]  tests only
 * @returns {{ code: number, line: string }}
 */
function main(argv, deps) {
  const d = deps || {};
  const args = parseArgs(argv);
  if (args.kind === 'usage') {
    process.stderr.write(args.usage + '\n');
    return { code: EXIT_CODES.USAGE, line: '' };
  }
  if (!isUsableDirectory(args.dir)) {
    process.stderr.write('resolve-settings: not a usable directory: '
      + JSON.stringify(args.dir).slice(0, 300) + ' — failing closed\n');
    return { code: EXIT_CODES.INPUT_UNUSABLE, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  const settings = resolveSettings({ dir: args.dir }, { exec: d.exec });
  if (!settings.ok) {
    process.stderr.write('resolve-settings: could not resolve (git did not answer, or an internal error) — failing closed\n');
    return { code: EXIT_CODES.INTERNAL_ERROR, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  const format = typeof d.formatLine === 'function' ? d.formatLine : formatSettingsLine;
  let line;
  try {
    line = format(settings);
  } catch (_) {
    process.stderr.write('resolve-settings: internal error composing the line — failing closed\n');
    return { code: EXIT_CODES.INTERNAL_ERROR, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  if (!isCoherentSettingsLine(line)) {
    process.stderr.write('resolve-settings: output gate refused the composed line — failing closed\n');
    return { code: EXIT_CODES.OUTPUT_GATE_REFUSED, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  return { code: EXIT_CODES.RESOLVED, line: /** @type {string} */ (line) };
}

// ---------------------------------------------------------------------------
// Top-level boundary — the ONLY stdout write and the ONLY exitCode assignment
// ---------------------------------------------------------------------------

if (require.main === module) {
  let outcome;
  try {
    outcome = main(process.argv);
  } catch (_) {
    process.stderr.write('resolve-settings: internal error — failing closed\n');
    outcome = { code: EXIT_CODES.INTERNAL_ERROR, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  const settled = settleOutcome(outcome);
  if (settled.line !== '') process.stdout.write(settled.line + '\n');
  process.exitCode = settled.code;
}

// ---------------------------------------------------------------------------
// Exports — the CLI seam (src/core/evidence-policy.ts) and the unit tests
// ---------------------------------------------------------------------------

module.exports = Object.freeze({
  TRACKER_SOURCES,
  TRACKER_WARNS,
  EXIT_CODES,
  SETTINGS_LINE_RE,
  SETTINGS_FAIL_CLOSED_LINE,
  parseArgs,
  foldSettings,
  readRepoLayers,
  resolveSettings,
  formatSettingsLine,
  isCoherentSettingsLine,
  serializeProjectSuggestion,
  main,
});

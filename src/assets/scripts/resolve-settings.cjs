#!/usr/bin/env node
// src/assets/scripts/resolve-settings.cjs
//
// Resolves the per-repository SETTINGS a prompt or the CLI acts on — tracker,
// review publication, compliance lens, the three feature switches and the gate
// level — from LOCAL layers, and prints them on ONE closed-vocabulary line. Installed as a
// top-level sibling of resolve-evidence-policy.cjs under ~/.devflow/scripts/,
// sharing its parser (lib/project-config.cjs).
//
// Usage: node resolve-settings.cjs [<dir>]      (<dir> defaults to cwd)
//
// The layers, in the order they are folded:
//   project   <toplevel>/.devflow/project.json  team-committed, this worktree's copy
//   default   refs/remotes/origin/<D>:.devflow/project.json
//                                               the default branch's tracking copy —
//                                               its compliance ids only (D-LENS-UNION)
//   personal  <toplevel>/.devflow/config.json   untracked — a copy git tracks is
//                                               ignored (D-PERSONAL-UNTRACKED). It
//                                               only narrows the feature switches;
//                                               its `gateLevel` may raise or lower
//   machine   ~/.devflow/manifest.json          the machine-wide install, and its
//                                               `features.gateLevel` default
//
// D-SETTINGS-LOCAL-ONLY: local git subprocesses only, and never gh, never the
// network, never a git command that refreshes the index. At most these, in order:
//   git rev-parse --show-toplevel                         always
//   git --no-literal-pathspecs -c core.fsmonitor=false ls-files -z -- <PERSONAL_TRACKING_PATHSPECS>
//                                                         only when config.json exists;
//                                                         ONE call answers every layout
//                                                         in which git tracks the path
//                                                         the personal file is opened at
//   git symbolic-ref --quiet refs/remotes/origin/HEAD     in a repository
//   git cat-file blob refs/remotes/origin/<D>:.devflow/project.json
//                                                         only when origin/HEAD names D
//   git rev-parse --path-format=absolute --git-common-dir only when MEMORY or CURATION is
//                                                         still on and <toplevel>/.git is
//                                                         not a folder: it names the ledger root
//   git ... ls-files -z -- <the pathspecs of an area>     only for a switch still on: ONE call
//                                                         for both areas when their roots are
//                                                         equal, one more per area only when it
//                                                         lists something; otherwise one per root
// MEMORY=off while git tracks the memory folder at the toplevel (or does not answer for it),
// and CURATION=off while git tracks the curation folders at the ledger root (or does not
// answer for them). The answer only narrows a switch; the leaf lib hooks/lib/tracked-areas.cjs
// holds the pathspecs, the scrub of redirecting variables and the mapping of git's answer.
// The team's evidence FLOOR is the default branch's and is
// resolve-evidence-policy.cjs's job (it runs over the network, from commands).
// This script reads the WORKTREE's copy for every other key, so a branch that
// edits project.json changes what it resolves for that branch: the feature
// switches can only narrow, the compliance lens can only gain scrutiny — the
// default branch's ids stay in it (D-LENS-UNION) — and the team's review
// publication can only lower it (D-PUBLICATION-CEILING) — a branch's
// `reviewPublication: "full"` raises nothing, since only a personal value asks
// for more than `auto`. The tracker (provider, site, key) is taken as the
// branch states it. It WRITES NOTHING: each layer it folds is changed only by its owner.
//
// GATE_LEVEL is a level, not a switch, so narrow-only does not apply to it: the
// personal `gateLevel` wins over the machine's `features.gateLevel`, which wins
// over `standard`, and either may raise or lower the level. A present value that
// is not full, standard or lean is malformed. That field alone reads `full`, the
// other fields read as if the key were absent, and stderr names the layer (never
// the value). A malformed personal value never falls through to the machine
// value. The level comes from these two keys only — never from a task, a diff or
// project.json.
//
// stdout is exactly one line plus "\n" (D-SETTINGS-LINE):
//   TRACKER=<github|jira|linear> TRACKER_SOURCE=<project|personal|machine|default>
//   TRACKER_WARN=<none|mismatch|invalid> SITE=<url|none> KEY=<KEY|none>
//   REVIEW_PUBLICATION=<off|auto|full> COMPLIANCE=<off|generic|id,…>
//   MEMORY=<on|off> CURATION=<on|off> KNOWLEDGE=<on|off> GATE_LEVEL=<full|standard|lean>
// (one line on stdout; wrapped here for reading). Every value is a closed token
// or a SITE/KEY that passed its shape gate, so no other byte of a config file can
// reach stdout. Whole-file rule: a project.json or config.json that EXISTS but
// cannot be read as a JSON object — unparseable, empty, not an object, a BOM,
// not UTF-8, over MAX_CONFIG_BYTES, a symlink or other non-regular file — fails
// every field closed except COMPLIANCE, which keeps every lens a readable layer
// declares (exit 0, the file named on stderr). Only keys inside a readable object
// are classified one by one.
//
// Exit codes (a caller treats EVERY non-zero code as the fail-closed line):
//   0  resolved — the line above, including the whole-file rule's line
//   1  usage error — usage on stderr; prints SETTINGS_FAIL_CLOSED_LINE
//   2  input unusable — <dir> missing or not a directory; prints
//      SETTINGS_FAIL_CLOSED_LINE
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
//   - every subprocess is spawned with an argv array (never a shell), stdin
//     ignored, a timeout and a maxBuffer
//   - a config file that is not a regular file is never opened, and one over
//     MAX_CONFIG_BYTES is never read

'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const projectConfig = require('./lib/project-config.cjs');
const trackedAreas = require('./hooks/lib/tracked-areas.cjs');

const {
  PUBLICATIONS,
  GATE_LEVELS,
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
/** @typedef {'full' | 'standard' | 'lean'} GateLevel */
/** @typedef {'personal' | 'machine' | 'default'} GateLevelSource */
/** @typedef {'memory' | 'curation' | 'knowledge'} FeatureSwitch */
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
 *
 * Whole-file rule: the line is folded only from files that are absent or read as
 * a JSON object. A repository file that exists and does not (the parser's
 * `invalid` file) says nothing that can be trusted — a team file meant to declare
 * `compliance:["hipaa"]` must not read as "no file" — so every field takes its
 * SETTINGS_FAIL_CLOSED_LINE value, for the team project.json and the personal
 * config.json alike, EXCEPT COMPLIANCE. The review lens only adds scrutiny
 * (D-LENS-UNION), and a broken file affects only the keys it owns, so it never
 * lowers a lens another layer declares: COMPLIANCE is the fold of the readable
 * layers — the machine's ids, the default branch's, and the worktree
 * project.json's when only config.json is broken (a personal file declares no
 * compliance) — with an unreadable project.json read as a malformed declaration,
 * `generic`. That line prints with exit 0, the unreadable file named on stderr,
 * so a consumer that accepts only exit 0 acts on it; an unreadable project.json
 * with no other lens anywhere is exactly SETTINGS_FAIL_CLOSED_LINE, and an
 * unreadable machine manifest reads as no lens. Individually malformed keys
 * inside a readable object keep their per-key readings (AC-26).
 *
 * GATE_LEVEL is the last field, a closed group of the three level words: nothing
 * broader than `full|standard|lean` can follow KNOWLEDGE.
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
  + ' MEMORY=(?<memory>on|off) CURATION=(?<curation>on|off) KNOWLEDGE=(?<knowledge>on|off)'
  + ' GATE_LEVEL=(?<gateLevel>' + GATE_LEVELS.join('|') + ')$',
);

/**
 * The line every refusal prints (exits 1, 2, 4 and 5), what a consumer uses in place
 * of any line it cannot accept, and the whole-file rule's line on a machine with
 * no compliance lens. A constant, so the boundary can never fail
 * to compose it. The literal fallback of the _settings.mds partial is these bytes.
 * Each field is the conservative reading for its consumer:
 *   TRACKER_WARN=invalid     the Git agent degrades rather than guessing a provider
 *   REVIEW_PUBLICATION=off   nothing is published (raised to a stub under required)
 *   COMPLIANCE=generic       the review lens still runs
 *   KNOWLEDGE=off            no knowledge write-back commits into the repository
 *   MEMORY/CURATION=off      a resolver that cannot say which repository it is in cannot
 *                            tell whether git tracks their folders, so both stay off
 *   GATE_LEVEL=full          the most checking applies: a resolver that cannot read
 *                            its inputs never lowers the level
 */
const SETTINGS_FAIL_CLOSED_LINE =
  'TRACKER=github TRACKER_SOURCE=default TRACKER_WARN=invalid SITE=none KEY=none '
  + 'REVIEW_PUBLICATION=off COMPLIANCE=generic MEMORY=off CURATION=off KNOWLEDGE=off GATE_LEVEL=full';

/** Bound on each local git call. */
const GIT_TIMEOUT_MS = 5000;
/**
 * rev-parse and symbolic-ref print one short line. The tracking check's ls-files
 * prints nothing, or the few index entries its two pathspecs name; a listing past
 * this bound overflows (ENOBUFS), which reads as unanswered and fails closed.
 */
const LINE_MAX_BUFFER = 4096;
/**
 * The tracking-copy read: one byte past the parser's bound, so an oversize blob
 * either arrives whole and is refused by the parser, or overflows (ENOBUFS) and
 * reads as unanswered — never truncated into something that parses.
 */
const BLOB_MAX_BUFFER = MAX_CONFIG_BYTES + 1;

/** The personal file, repository-relative, in git's spelling. */
const PERSONAL_REL = '.devflow/config.json';
/**
 * The spellings a case-folding file system opens as `config.json` beyond ASCII letter
 * case (the leaf lib's DEVFLOW_SPELLINGS lists those of `.devflow`). git's `icase` folds
 * ASCII letters only, but APFS (the macOS default) compares names by full Unicode case
 * folding, so it also opens `conﬁg.json` (U+FB01 folds to "fi") and `config.jſon`
 * (U+017F folds to "s") at the personal path, as it opens `.devﬂow` (U+FB02 folds to
 * "fl"). A probe of every code point on APFS finds no other one that folds into these
 * names and none that it ignores. The code is written with escapes, so each code point
 * is named.
 */
const { DEVFLOW_SPELLINGS } = trackedAreas;
const CONFIG_SPELLINGS = Object.freeze(['config.json', 'con\u{FB01}g.json', 'config.j\u{17F}on', 'con\u{FB01}g.j\u{17F}on']);
/**
 * The pathspecs of the tracking check (D-PERSONAL-UNTRACKED), each matched
 * without regard to ASCII letter case, whatever the file system or
 * `core.ignorecase`, and each spelled every way DEVFLOW_SPELLINGS and
 * CONFIG_SPELLINGS list:
 *   - the personal file itself, so a committed `.devflow/CONFIG.json`,
 *     `.DEVFLOW/config.json` or `.devflow/config.jſon` counts where the file
 *     system folds the name and opens it
 *   - an index entry named `.devflow` ITSELF, which git records only for a symlink,
 *     a gitlink (submodule) or a plain file, never for a directory: the character
 *     class keeps `glob` from matching as a leading directory, so the many files
 *     under a normal `.devflow/` are not listed. A tracked link or submodule
 *     carries committed content to the path the personal file is opened at.
 * An untracked `.devflow` link is the user's own setup and is not named here.
 * The index check cannot see where such a link points: one that leads to tracked
 * content (the same repository, or a linked worktree's link to the main
 * checkout's `.devflow`) is read through, as every read of a linked folder is.
 */
const PERSONAL_TRACKING_PATHSPECS = Object.freeze([
  ...DEVFLOW_SPELLINGS.flatMap(dir => CONFIG_SPELLINGS.map(file => ':(icase,literal)' + dir + '/' + file)),
  ...DEVFLOW_SPELLINGS.map(dir => ':(icase,glob)[.]' + dir.slice(1)),
]);
/** The team file, repository-relative, in git's spelling. */
const PROJECT_REL = '.devflow/project.json';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * @typedef {{ on: boolean, source: SwitchSource }} SwitchState
 *   `source` is the layer that decided: `machine` when the machine switch is off,
 *   when git tracks the area's folder or does not answer for it (a switch narrowed
 *   that way carries source `machine`, so it has no file to name), or when nothing
 *   narrowed it; else the repo layer whose literal `false` narrowed it.
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
 *   switches: { memory: SwitchState, curation: SwitchState, knowledge: SwitchState },
 *   gateLevel: GateLevel,
 *   gateLevelSource: GateLevelSource | null,
 *   gateLevelInvalid: boolean,
 *   gateLevelMachine: GateLevel | 'invalid' | null,
 *   repoCompliance: readonly string[] | null,
 *   defaultBranchCompliance: readonly string[] | null,
 *   personalTracked: boolean,
 *   retiredPolicyFile: boolean,
 *   unreadable: 'project' | 'personal' | null,
 * }} Settings
 *   ok              false only for a fail-closed resolution — the whole-file
 *                   rule's included, which still carries every readable lens
 *   compliance      enabled with no frameworks is `generic`
 *   gateLevelSource the layer that decided the level. null only for a whole-line
 *                   fail-closed result (`ok` false), which has no deciding layer
 *   gateLevelInvalid the deciding layer holds a malformed level, so `gateLevel` is
 *                   `full`; the raw value is never carried
 *   gateLevelMachine the machine layer's own reading, whoever decided: a level,
 *                   `invalid` for a present malformed value, or null for none
 *                   recorded. On a result that never read the manifest (git did not
 *                   answer, or an internal error) null means not read
 *   repoCompliance  the worktree project.json's ids, or null when it declares
 *                   none (a malformed declaration reads as [] — generic)
 *   defaultBranchCompliance  the default branch's tracking copy's ids, the same
 *                   way — null when it declares none or there is no tracking copy
 *   personalTracked .devflow/config.json is tracked by git and was ignored
 *                   (D-PERSONAL-UNTRACKED); main() tells the user to untrack it
 *   retiredPolicyFile  the worktree holds the retired .devflow/policy.json (the
 *                   CLI prints a migration hint)
 *   unreadable      the first repository layer whose file exists but is
 *                   unreadable, which failed every field but the compliance
 *                   lens closed (the whole-file rule; project before personal);
 *                   null otherwise
 *
 * @typedef {{
 *   project: object,
 *   personal: object,
 *   manifest: unknown,
 *   retiredPolicyFile: boolean,
 *   defaultBranch?: ComplianceField,
 *   personalTracked?: boolean,
 * }} SettingsInputs
 *   project/personal are lib/project-config.cjs ProjectConfig / PersonalConfig.
 *   defaultBranch is the tracking copy's `compliance` field (absent when omitted).
 *
 * @typedef {{ kind: 'absent' } | { kind: 'malformed' } | { kind: 'valid', value: readonly string[] }} ComplianceField
 *
 * @typedef {{ project: object, personal: object, personalTracked: boolean }} RepoLayers
 *
 * @typedef {{ status: number | null, stdout?: Buffer | string, error?: { code?: string } }} ExecResult
 * @typedef {{ answered: boolean, ok: boolean, stdout: Buffer }} GitAnswer
 *   answered  git ran and exited on its own (no spawn error, timeout or overflow)
 *   ok        answered with exit 0
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
    memory: Object.freeze({ on: false, source: /** @type {SwitchSource} */ ('machine') }),
    curation: Object.freeze({ on: false, source: /** @type {SwitchSource} */ ('machine') }),
    knowledge: Object.freeze({ on: false, source: /** @type {SwitchSource} */ ('machine') }),
  }),
  gateLevel: /** @type {GateLevel} */ ('full'),
  gateLevelSource: null,
  gateLevelInvalid: false,
  gateLevelMachine: null,
  repoCompliance: null,
  defaultBranchCompliance: null,
  personalTracked: false,
  retiredPolicyFile: false,
  unreadable: null,
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

/**
 * The keys a switch is stored under, current names first (feature-switch.ts
 * CURRENT_KEYS). `curation` is read under `curation` and its pre-rename copy
 * `learning` (#529).
 */
const CURRENT_SWITCH_KEYS = Object.freeze({
  memory: Object.freeze(['memory']),
  curation: Object.freeze(['curation', 'learning']),
  knowledge: Object.freeze(['knowledge']),
});

/** The pre-rename key each switch was stored under (feature-switch.ts LEGACY_KEYS). */
const LEGACY_SWITCH_KEYS = Object.freeze({ curation: 'decisions', knowledge: 'kb' });

/**
 * src/core/feature-switch.ts isMachineFeatureOn exactly. Off when any current
 * key is a boolean `false`; else on when any current key is a boolean `true`;
 * else, when neither is a boolean, the pre-rename key decides if it is a
 * boolean; else on. A non-boolean value is ignored for that key only, so a
 * disagreeing pair resolves to off. Anything that is not a manifest-shaped
 * object is on. The capture hooks' gate read without jq calls this one, so the
 * rule is held here alone.
 *
 * @param {unknown} manifest
 * @param {FeatureSwitch} feature
 * @returns {boolean}
 */
function machineSwitchOn(manifest, feature) {
  if (!isPlainObject(manifest)) return true;
  const features = manifest.features;
  if (!isPlainObject(features)) return true;
  const current = CURRENT_SWITCH_KEYS[feature].map(key => features[key]).filter(value => typeof value === 'boolean');
  if (current.length > 0) return !current.includes(false);
  const legacy = /** @type {Record<string, string>} */ (LEGACY_SWITCH_KEYS)[feature];
  return legacy === undefined || features[legacy] !== false;
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

/**
 * src/core/gate-level.ts machineGateLevel exactly, and total: null when no level
 * is recorded (not an object, `features` not an object, or no own `gateLevel`
 * key), `invalid` when the key is present and is not one of the three words,
 * else the level. The curation-capture hook folds a manifest of any shape, so
 * this must never throw.
 *
 * @param {unknown} manifest
 * @returns {GateLevel | 'invalid' | null}
 */
function machineGateLevel(manifest) {
  if (!isPlainObject(manifest) || !isPlainObject(manifest.features)) return null;
  if (!Object.prototype.hasOwnProperty.call(manifest.features, 'gateLevel')) return null;
  const value = manifest.features.gateLevel;
  return GATE_LEVELS.includes(value) ? /** @type {GateLevel} */ (value) : 'invalid';
}

// ---------------------------------------------------------------------------
// The fold (the functional core)
//
// The fold reads a file-level `invalid` field by field (fieldIn) so that it never
// throws on any parser output. resolveSettings folds such a file for the
// compliance lens alone — an unreadable project.json is a malformed declaration,
// `generic` — and fails every other field closed first (the whole-file rule); the
// hooks' switch gate folds it whole, where an unreadable file narrows nothing.
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
 *   min(team ?? full, personal ?? auto)   over off < auto < full.
 * The team value is a CEILING only — never a default. It can lower what the
 * personal value asks for, but it cannot raise a run above `auto`: this script
 * reads the worktree's project.json, so a contributor's branch committing
 * `"reviewPublication":"full"` would otherwise make a maintainer's local review
 * of that branch skip the visibility gate on a public repository. Only the
 * uncommitted personal value asks for `full` — and a config.json git tracks is
 * not personal, so it never reaches this fold (D-PERSONAL-UNTRACKED). A
 * malformed team value (or an unreadable project.json) is `off` — a ceiling
 * that cannot be read is the lowest one. A malformed personal value is
 * ignored, as readConfig ignores it, and so resolves `auto`.
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
  const wanted = own !== null ? own : 'auto';
  return PUBLICATIONS.indexOf(wanted) <= PUBLICATIONS.indexOf(ceiling) ? wanted : ceiling;
}

/**
 * The ids a compliance field declares: its registry ids when valid, [] (generic)
 * when malformed, null when absent.
 *
 * @param {ComplianceField} field
 * @returns {readonly string[] | null}
 */
function declaredIds(field) {
  if (field.kind === 'valid') return field.value;
  return field.kind === 'malformed' ? Object.freeze([]) : null;
}

/**
 * D-LENS-UNION: the compliance lens is
 *   machine ∪ default branch ∪ worktree
 * — the machine's ids, the default branch's project.json ids (its local tracking
 * copy, refs/remotes/origin/<D>), and the worktree project.json's. The lens only
 * adds scrutiny, so no layer can take a framework away from another: a branch can
 * ADD a framework in its own project.json, and can never REMOVE one the default
 * branch declares — a PR that deletes `compliance:["hipaa"]` is still reviewed
 * under hipaa. The default branch's copy is read locally, never over the network
 * (D-SETTINGS-LOCAL-ONLY), so it is as fresh as the last fetch; with no tracking
 * copy the lens is machine ∪ worktree. `off` only when no layer declares
 * anything; a malformed declaration in either repository copy — an unreadable
 * file, or a tracking copy git could not read — is `generic`: the lens runs with
 * no framework reference, never silently not at all. The evidence floor is not
 * this lens's to decide (resolve-evidence-policy.cjs).
 *
 * @param {any} project
 * @param {unknown} manifest
 * @param {ComplianceField} defaultBranch
 * @returns {{ compliance: Settings['compliance'], repoCompliance: readonly string[] | null, defaultBranchCompliance: readonly string[] | null }}
 */
function foldCompliance(project, manifest, defaultBranch) {
  const machine = machineCompliance(manifest);
  const repo = declaredIds(fieldIn(project, 'compliance', 'malformed'));
  const base = declaredIds(defaultBranch);
  if (machine === null && repo === null && base === null) {
    return {
      compliance: Object.freeze({ enabled: false, frameworks: Object.freeze([]) }),
      repoCompliance: null,
      defaultBranchCompliance: null,
    };
  }
  /** @param {readonly string[] | null} ids @param {string} id */
  const has = (ids, id) => ids !== null && ids.includes(id);
  const union = COMPLIANCE_IDS.filter(id => has(machine, id) || has(base, id) || has(repo, id));
  return {
    compliance: Object.freeze({ enabled: true, frameworks: Object.freeze(union) }),
    repoCompliance: repo,
    defaultBranchCompliance: base,
  };
}

/**
 * D-FEATURES-NARROW-ONLY (src/core/feature-switch.ts): a switch is on iff the
 * machine switch is on AND project.json's `features.<name>` is not `false` AND
 * config.json's `features.<name>` is not `false`. Only a literal `false`
 * narrows: absent, malformed, duplicated and unreadable all leave the switch as
 * the machine set it. No repo layer can turn on what the machine turned off.
 *
 * A switch with two current keys (`curation`: `curation` and `learning`, #529)
 * is a narrow-only union: a literal `false` in either key of a file narrows it,
 * and each key is classified on its own, so a duplicate or a non-boolean value
 * in one key leaves the other readable.
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
    if (features.kind !== 'valid') return false;
    return CURRENT_SWITCH_KEYS[feature].some(key => features.value[key].kind === 'valid' && features.value[key].value === false);
  };
  if (!machineSwitchOn(manifest, feature)) return Object.freeze({ on: false, source: 'machine' });
  if (narrows(project)) return Object.freeze({ on: false, source: 'project' });
  if (narrows(personal)) return Object.freeze({ on: false, source: 'personal' });
  return Object.freeze({ on: true, source: 'machine' });
}

/**
 * The gate level, from two keys and nothing else:
 *   1. a valid personal `gateLevel` wins (source `personal`);
 *   2. a malformed personal `gateLevel` is `full` (source `personal`, invalid) and
 *      never falls through to the machine value — a typo must not hand the choice
 *      to a layer the user did not mean;
 *   3. else a valid machine `features.gateLevel` (source `machine`);
 *   4. else a malformed machine value is `full` (source `machine`, invalid);
 *   5. else `standard` (source `default`).
 * Either layer may raise or lower the level: it is not a switch, and narrow-only
 * does not apply to it. An unreadable personal file reads as malformed, so a
 * caller that folds it directly never sees the machine value win over it. The
 * machine layer's own reading is carried whichever layer decided.
 *
 * @param {any} personal
 * @param {unknown} manifest
 * @returns {Pick<Settings, 'gateLevel' | 'gateLevelSource' | 'gateLevelInvalid' | 'gateLevelMachine'>}
 */
function foldGateLevel(personal, manifest) {
  const machine = machineGateLevel(manifest);
  const own = fieldIn(personal, 'gateLevel', 'malformed');
  if (own.kind === 'valid') {
    return { gateLevel: own.value, gateLevelSource: 'personal', gateLevelInvalid: false, gateLevelMachine: machine };
  }
  if (own.kind === 'malformed') {
    return { gateLevel: 'full', gateLevelSource: 'personal', gateLevelInvalid: true, gateLevelMachine: machine };
  }
  if (machine === 'invalid') {
    return { gateLevel: 'full', gateLevelSource: 'machine', gateLevelInvalid: true, gateLevelMachine: machine };
  }
  if (machine !== null) {
    return { gateLevel: machine, gateLevelSource: 'machine', gateLevelInvalid: false, gateLevelMachine: machine };
  }
  return { gateLevel: 'standard', gateLevelSource: 'default', gateLevelInvalid: false, gateLevelMachine: null };
}

/**
 * The whole-file rule's resolution (D-SETTINGS-LINE): the fail-closed values,
 * naming the layer whose file could not be read, except the compliance lens —
 * a broken file affects only the keys it owns, so the lens stays the fold of
 * every readable layer (D-LENS-UNION) — and the memory and curation switches,
 * which stay as the machine set them (an unreadable file narrows nothing, and
 * the area answers narrow them afterwards). An unreadable project.json declares
 * nothing readable of its own (repoCompliance null) but reads as a malformed
 * declaration, so its lens is at least `generic`; an unreadable config.json
 * owns no compliance at all, so the worktree project.json's ids still count.
 *
 * @param {'project' | 'personal'} layer
 * @param {SettingsInputs} inputs
 * @returns {Settings}
 */
function unreadableSettings(layer, inputs) {
  const defaultBranch = inputs.defaultBranch === undefined ? ABSENT_FIELD : inputs.defaultBranch;
  const lens = foldCompliance(inputs.project, inputs.manifest, defaultBranch);
  /** @param {FeatureSwitch} feature @returns {SwitchState} */
  const machine = feature => Object.freeze({ on: machineSwitchOn(inputs.manifest, feature), source: 'machine' });
  return Object.freeze({
    ...FAIL_CLOSED_SETTINGS,
    switches: Object.freeze({ ...FAIL_CLOSED_SETTINGS.switches, memory: machine('memory'), curation: machine('curation') }),
    // The level stays `full` with no deciding layer, but a readable manifest still shows its own value.
    gateLevelMachine: machineGateLevel(inputs.manifest),
    compliance: lens.compliance,
    repoCompliance: layer === 'project' ? null : lens.repoCompliance,
    defaultBranchCompliance: lens.defaultBranchCompliance,
    personalTracked: inputs.personalTracked === true,
    unreadable: layer,
  });
}

/**
 * Fold the layers into Settings. Pure; never throws on any parser output.
 *
 * @param {SettingsInputs} inputs
 * @returns {Settings}
 */
function foldSettings(inputs) {
  const { project, personal, manifest } = inputs;
  const tracker = foldTracker(project, personal, manifest);
  const lens = foldCompliance(project, manifest, inputs.defaultBranch === undefined ? ABSENT_FIELD : inputs.defaultBranch);
  return Object.freeze({
    ok: true,
    ...tracker,
    reviewPublication: foldPublication(project, personal),
    compliance: lens.compliance,
    switches: Object.freeze({
      memory: foldSwitch(project, personal, manifest, 'memory'),
      curation: foldSwitch(project, personal, manifest, 'curation'),
      knowledge: foldSwitch(project, personal, manifest, 'knowledge'),
    }),
    ...foldGateLevel(personal, manifest),
    repoCompliance: lens.repoCompliance,
    defaultBranchCompliance: lens.defaultBranchCompliance,
    personalTracked: inputs.personalTracked === true,
    retiredPolicyFile: inputs.retiredPolicyFile === true,
    unreadable: null,
  });
}

/**
 * The settings for the layers as read: the whole-file rule's resolution for the first layer
 * that could not be read (project before personal), else the fold of the layers.
 *
 * @param {SettingsInputs} inputs
 * @returns {Settings}
 */
function settingsOfLayers(inputs) {
  if (inputs.project.kind === 'invalid') return unreadableSettings('project', inputs);
  if (inputs.personal.kind === 'invalid') return unreadableSettings('personal', inputs);
  return foldSettings(inputs);
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
 * One bounded local git call, normalized. The argv is a fresh copy, so an exec
 * cannot mutate a caller's constant. `baseEnv` (default: the process environment)
 * is the environment the call's own derives from.
 *
 * @param {ExecFn} exec
 * @param {string} cwd
 * @param {readonly string[]} args
 * @param {number} maxBuffer
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @returns {GitAnswer}
 */
function runGit(exec, cwd, args, maxBuffer, baseEnv) {
  const res = exec('git', [...args], {
    cwd,
    env: Object.assign({}, baseEnv === undefined ? process.env : baseEnv, { GIT_TERMINAL_PROMPT: '0' }),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    windowsHide: true,
    shell: false,
  });
  const answered = Boolean(res) && !res.error && typeof res.status === 'number';
  const raw = res ? res.stdout : undefined;
  const stdout = Buffer.isBuffer(raw) ? raw : typeof raw === 'string' ? Buffer.from(raw, 'utf8') : Buffer.alloc(0);
  return { answered, ok: answered && res.status === 0, stdout };
}

/**
 * The repository root of `dir`.
 *   root     exit 0 with exactly one absolute path plus its newline
 *   none     git ANSWERED non-zero — not a repository; only the machine layer applies
 *   unknown  git did not answer, or answered 0 with an unusable path ⇒ fail closed
 *
 * @param {ExecFn} exec
 * @param {string} dir
 * @returns {{ kind: 'root', root: string } | { kind: 'none' } | { kind: 'unknown' }}
 */
function gitToplevel(exec, dir) {
  const res = runGit(exec, dir, ['rev-parse', '--show-toplevel'], LINE_MAX_BUFFER);
  if (!res.answered) return { kind: 'unknown' };
  if (!res.ok) return { kind: 'none' };
  const text = res.stdout.toString('utf8').replace(/\r?\n$/, '');
  if (text === '' || /[\r\n\0]/.test(text) || !path.isAbsolute(text)) return { kind: 'unknown' };
  return { kind: 'root', root: text };
}

/**
 * D-PERSONAL-UNTRACKED: `.devflow/config.json` holds PERSONAL settings — the one
 * layer that may ask for `reviewPublication: "full"` — so a copy git TRACKS is
 * not personal: a contributor's branch that commits one (`git add -f`) would
 * otherwise lift a maintainer's local run of that branch past the publication
 * ceiling. A tracked copy is ignored entirely, exactly as if absent, and main()
 * tells the user to untrack it.
 *
 * The question is whether COMMITTED content can reach the path the personal file
 * is opened at, `<root>/.devflow/config.json`. The OS follows a symlinked
 * `.devflow`, resolves a submodule's checkout there, and on a case-folding file
 * system opens `CONFIG.json`, `.DEVFLOW/config.json` or `config.jſon` for it, so
 * the answer is not only "is this exact path in the index". One `git ls-files -z`
 * over PERSONAL_TRACKING_PATHSPECS asks all of it at once — no further git call:
 * any output is a tracked entry that reaches the path (the file in any spelling
 * the file system folds to it, or `.devflow` itself as a symlink, gitlink or
 * file). It reads the index without
 * refreshing or writing it. Reading the index runs a configured `core.fsmonitor`
 * hook — an arbitrary command from the repository's config, and on macOS the
 * builtin daemon's start-up — so the call turns it off for itself
 * (`-c core.fsmonitor=false`, D-NO-FSMONITOR): this resolver runs from session
 * hooks and must stay a pure read.
 *   tracked    at least one entry listed, whatever the exit status
 *   untracked  exit 0 with nothing listed; and, unless `rootConfirmed`, any other
 *              answered exit (outside a repository git answers 128, and there is
 *              nothing to track)
 *   unknown    git did not answer, or its listing overflowed LINE_MAX_BUFFER; and,
 *              with `rootConfirmed`, an answered non-zero exit with nothing listed —
 *              inside a repository the call has no reason to fail except a git that
 *              cannot read its index. Whether the file is personal cannot be known,
 *              so it is unreadable and its keys fail closed
 * `--no-literal-pathspecs` leads the argv: an inherited GIT_LITERAL_PATHSPECS=1
 * would read every pathspec as a plain path, magic included, list nothing and
 * read as untracked. The call runs without the variables that make git read
 * another repository or index (the leaf lib's scrub), so it reads `root`'s own.
 *
 * @param {ExecFn} exec
 * @param {string} root
 * @param {boolean} rootConfirmed  git has already named `root` as a repository's top level
 * @returns {'tracked' | 'untracked' | 'unknown'}
 */
function personalTracking(exec, root, rootConfirmed) {
  const res = runGit(exec, root,
    ['--no-literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--', ...PERSONAL_TRACKING_PATHSPECS], LINE_MAX_BUFFER,
    trackedAreas.gitEnvWithoutRedirects(process.env));
  if (!res.answered) return 'unknown';
  if (res.stdout.length > 0) return 'tracked';
  if (res.ok) return 'untracked';
  return rootConfirmed ? 'unknown' : 'untracked';
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
 * The two repository layers under `<root>/.devflow`, each read and classified by
 * readConfigFile. Exported for the hooks' one parser fork (queue_read_gates in
 * scripts/hooks/queue-append, D-FEATURES-NARROW-ONLY): a file the shell fast path
 * hands over is read by exactly the code resolveSettings reads it with, so the two
 * cannot disagree about a symlink, a size, a BOM, a duplicated key — or a
 * config.json git tracks (D-PERSONAL-UNTRACKED), which is absent to both. Its only
 * subprocess is that tracking check, made only when config.json exists; never
 * throws on a missing or unreadable file. `deps.rootConfirmed` is for a caller
 * that has already had git name `root`: the tracking check then reads a git that
 * answers non-zero as unknown. The hooks do not pass it, and a root outside any
 * repository reads as untracked.
 *
 * @param {string} root
 * @param {{ exec?: ExecFn, rootConfirmed?: boolean }} [deps]
 * @returns {RepoLayers}
 */
function readRepoLayers(root, deps) {
  const exec = deps && typeof deps.exec === 'function' ? deps.exec : defaultExec;
  const devflow = path.join(root, '.devflow');
  const project = readConfigFile(path.join(devflow, 'project.json'), projectConfig.parseProjectBytes);
  const personalPath = path.join(devflow, 'config.json');
  const tracking = existsNoFollow(personalPath) ? personalTracking(exec, root, Boolean(deps && deps.rootConfirmed)) : 'untracked';
  const personal = tracking === 'tracked' ? projectConfig.parsePersonalBytes(null)
    : tracking === 'unknown' ? Object.freeze({ kind: 'invalid' })
      : readConfigFile(personalPath, projectConfig.parsePersonalBytes);
  return Object.freeze({ project, personal, personalTracked: tracking === 'tracked' });
}

/**
 * The default branch's `compliance` declaration, from its LOCAL tracking copy
 * (D-LENS-UNION, D-SETTINGS-LOCAL-ONLY): origin/HEAD names the branch D, and
 * `refs/remotes/origin/<D>:.devflow/project.json` is read through the same
 * parser. The lens only adds, so every state that cannot be read is a malformed
 * declaration (`generic`), never "declares nothing":
 *   absent     origin/HEAD is not recorded, or D holds no project.json
 *   malformed  a git call did not answer, origin/HEAD names no safe branch, the
 *              blob overflows its bound, the file is unreadable, or its
 *              `compliance` value is malformed
 *   valid      the registry ids it declares
 *
 * @param {ExecFn} exec
 * @param {string} root
 * @returns {ComplianceField}
 */
function defaultBranchCompliance(exec, root) {
  const head = runGit(exec, root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], LINE_MAX_BUFFER);
  if (!head.answered) return MALFORMED_FIELD;
  if (!head.ok) return ABSENT_FIELD;
  const branch = projectConfig.parseOriginHeadRef(head.stdout.toString('utf8'));
  if (branch === null) return MALFORMED_FIELD;
  const blob = runGit(exec, root,
    ['cat-file', 'blob', projectConfig.ORIGIN_TRACKING_PREFIX + branch + ':' + PROJECT_REL], BLOB_MAX_BUFFER);
  if (!blob.answered) return MALFORMED_FIELD;
  if (!blob.ok) return ABSENT_FIELD;
  return fieldIn(projectConfig.parseProjectBytes(blob.stdout), 'compliance', 'malformed');
}

// ---------------------------------------------------------------------------
// The tracked areas: memory at the toplevel, curation at the ledger root
// ---------------------------------------------------------------------------

/** What git before 2.31 prints first for `--path-format=absolute`: the flag it does not know, echoed back. */
const PATH_FORMAT_ECHO = '--path-format=absolute';

/**
 * How the `.git` entry at `root` stands, never followed: `folder`, `absent` (nothing there)
 * or `other` (a file, a link, or an entry that could not be probed).
 *
 * @param {string} root
 * @returns {'folder' | 'absent' | 'other'}
 */
function gitEntryKind(root) {
  try {
    return fs.lstatSync(path.join(root, '.git')).isDirectory() ? 'folder' : 'other';
  } catch (err) {
    const code = err && /** @type {{ code?: string }} */ (err).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'other';
  }
}

/**
 * Whether the main checkout `main` holds the ledger: it has a `.devflow` folder (links
 * followed), its own `.git` entry, and is not HOME (a repository rooted at HOME is the
 * machine root). The paths are compared physically, as the hooks' df_is_project_root does;
 * an unresolvable `main` holds none, and an unset or unresolvable HOME refuses nothing.
 *
 * @param {string} main
 * @returns {boolean}
 */
function holdsLedger(main) {
  try {
    if (!fs.statSync(path.join(main, '.devflow')).isDirectory()) return false;
    fs.statSync(path.join(main, '.git'));
    const mainReal = fs.realpathSync(main);
    const home = process.env.HOME;
    if (typeof home !== 'string' || home === '') return true;
    try {
      return fs.realpathSync(home) !== mainReal;
    } catch (_) {
      return true;
    }
  } catch (_) {
    return false;
  }
}

/**
 * Where the curation ledger lives for the checkout whose toplevel git named: the rule the
 * hooks apply (DF_LEDGER_ROOT of df_resolve_roots in hooks/resolve-project-root), which the
 * TypeScript twin getLedgerRoot (src/core/ledger-root.ts) shares.
 *   - `<toplevel>/.git` is a folder, or there is none: the toplevel, with no git call. (A
 *     main checkout is its own ledger root; with no entry the leaf lib asks no git call.)
 *   - `<toplevel>/.git` is a file or a link: one `git rev-parse --path-format=absolute
 *     --git-common-dir`. A path ending in `/.git` whose parent holds the ledger
 *     (holdsLedger) names the parent; any other path names the toplevel. A git before 2.31
 *     echoes the flag back as its first line: the toplevel, as the hooks fall back to it.
 *   - any other answer, or none: `unknown` (the caller reads curation as unanswered).
 * Never throws.
 *
 * @param {string} toplevel  an absolute path git named as a work tree's top level
 * @param {{ exec?: ExecFn }} [deps]
 * @returns {{ kind: 'root', root: string } | { kind: 'unknown' }}
 */
function ledgerRootOf(toplevel, deps) {
  try {
    const exec = deps && typeof deps.exec === 'function' ? deps.exec : defaultExec;
    if (gitEntryKind(toplevel) !== 'other') return { kind: 'root', root: toplevel };
    const res = runGit(exec, toplevel, ['rev-parse', PATH_FORMAT_ECHO, '--git-common-dir'], LINE_MAX_BUFFER);
    if (!res.ok) return { kind: 'unknown' };
    const text = res.stdout.toString('utf8').replace(/\r?\n$/, '');
    if (text.split('\n', 1)[0] === PATH_FORMAT_ECHO) return { kind: 'root', root: toplevel };
    if (text === '' || /[\r\n\0]/.test(text) || !path.isAbsolute(text)) return { kind: 'unknown' };
    if (!text.endsWith('/.git')) return { kind: 'root', root: toplevel };
    const main = text.slice(0, -'/.git'.length);
    return { kind: 'root', root: main !== '' && holdsLedger(main) ? main : toplevel };
  } catch (_) {
    return { kind: 'unknown' };
  }
}

/**
 * @typedef {'tracked' | 'untracked' | 'unknown'} AreaAnswer
 * @typedef {{ memory: AreaAnswer, curation: AreaAnswer }} AreaAnswers
 */

/**
 * One area at one root, asked of the injected exec with the leaf lib's call (its pathspecs,
 * its scrub of redirecting variables, its bounds) and mapped by its judge. The leaf asks no
 * call, and answers `untracked`, for a root with no `.git` entry.
 *
 * @param {ExecFn} exec
 * @param {string} root
 * @param {'curation' | 'memory' | 'both'} area
 * @returns {AreaAnswer}
 */
function askArea(exec, root, area) {
  const call = trackedAreas.trackedAreaCall(root, area);
  if (!('argv' in call)) return call.answer;
  const res = exec('git', [...call.argv], {
    cwd: call.cwd,
    env: call.env,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: trackedAreas.TRACKED_AREAS_GIT_TIMEOUT_MS,
    maxBuffer: trackedAreas.TRACKED_AREAS_GIT_MAX_BUFFER,
    windowsHide: true,
    shell: false,
  });
  return trackedAreas.judgeTrackedAreas(res).answer;
}

/**
 * The answers for the areas asked about. An area that is not asked about reads `untracked`
 * (nothing to narrow). Equal roots: ONE call over both areas; nothing listed ends it, git
 * not answering reads both `unknown`, and only a listing earns one call per area to tell
 * them apart. Different roots: one call per root. A curation root that is null (the ledger
 * root could not be named) reads `unknown`.
 *
 * @param {ExecFn} exec
 * @param {string} memoryRoot
 * @param {string | null} curationRoot
 * @param {{ memory: boolean, curation: boolean }} asked
 * @returns {AreaAnswers}
 */
function trackedAreaAnswers(exec, memoryRoot, curationRoot, asked) {
  /** @type {AreaAnswers} */
  const answers = { memory: 'untracked', curation: 'untracked' };
  if (asked.memory && asked.curation && curationRoot === memoryRoot) {
    const union = askArea(exec, memoryRoot, 'both');
    if (union === 'untracked') return answers;
    if (union === 'unknown') return { memory: 'unknown', curation: 'unknown' };
  }
  if (asked.curation) answers.curation = curationRoot === null ? 'unknown' : askArea(exec, curationRoot, 'curation');
  if (asked.memory) answers.memory = askArea(exec, memoryRoot, 'memory');
  return answers;
}

/**
 * The settings with each switch whose area is not `untracked` off. Only a switch still on
 * is narrowed, and it carries source `machine`: no file of the repository turned it off, so
 * there is none to name. Answers `settings` itself when nothing changes.
 *
 * @param {Settings} settings
 * @param {AreaAnswers} answers
 * @returns {Settings}
 */
function narrowByAreas(settings, answers) {
  /** @param {'memory' | 'curation'} feature @returns {SwitchState} */
  const narrowed = feature => (answers[feature] === 'untracked' || !settings.switches[feature].on
    ? settings.switches[feature]
    : Object.freeze({ on: false, source: 'machine' }));
  const memory = narrowed('memory');
  const curation = narrowed('curation');
  if (memory === settings.switches.memory && curation === settings.switches.curation) return settings;
  return Object.freeze({ ...settings, switches: Object.freeze({ ...settings.switches, memory, curation }) });
}

/**
 * Resolve the settings for `opts.dir`. Never throws: a git that cannot say
 * whether `opts.dir` is in a repository, or any internal failure, is the
 * fail-closed resolution, which main() maps to exit 4. A repository file that
 * exists but is unreadable fails every field closed but the compliance lens and
 * the memory and curation switches, naming its layer in `unreadable` (the
 * whole-file rule, D-SETTINGS-LINE); main() prints that line with exit 0.
 *
 * Every repository return is then narrowed by the areas: memory at the toplevel,
 * curation at the ledger root, each off while git tracks its folders or does not
 * answer for them. When git answers that `opts.dir` is no repository (a lookup
 * that fails for a reason such as a redirecting variable or a refusal for
 * ownership), the leaf lib's check still runs at `opts.dir`: with no `.git`
 * entry there it asks no git call and changes nothing; with one it asks a scrubbed
 * call, and an unanswered call reads both areas as unknown.
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
      const folded = foldSettings({ project: none, personal: none, manifest, retiredPolicyFile: false });
      const start = path.resolve(opts.dir);
      return narrowByAreas(folded, trackedAreaAnswers(exec, start, start, {
        memory: folded.switches.memory.on,
        curation: folded.switches.curation.on,
      }));
    }
    const layers = readRepoLayers(toplevel.root, { exec, rootConfirmed: true });
    /** @type {SettingsInputs} */
    const inputs = {
      project: layers.project,
      personal: layers.personal,
      personalTracked: layers.personalTracked,
      manifest,
      defaultBranch: defaultBranchCompliance(exec, toplevel.root),
      retiredPolicyFile: existsNoFollow(path.join(toplevel.root, '.devflow', 'policy.json')),
    };
    const folded = settingsOfLayers(inputs);
    const asked = { memory: folded.switches.memory.on, curation: folded.switches.curation.on };
    let curationRoot = null;
    if (asked.curation) {
      const ledger = ledgerRootOf(toplevel.root, { exec });
      curationRoot = ledger.kind === 'root' ? ledger.root : null;
    }
    return narrowByAreas(folded, trackedAreaAnswers(exec, toplevel.root, curationRoot, asked));
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
    + ' CURATION=' + onOff(s.switches.curation)
    + ' KNOWLEDGE=' + onOff(s.switches.knowledge)
    + ' GATE_LEVEL=' + s.gateLevel;
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
  if (o.code === EXIT_CODES.RESOLVED) {
    return isCoherentSettingsLine(o.line)
      ? { code: o.code, line: o.line }
      : { code: EXIT_CODES.OUTPUT_GATE_REFUSED, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  if (o.code === EXIT_CODES.USAGE || o.code === EXIT_CODES.INPUT_UNUSABLE || o.code === EXIT_CODES.OUTPUT_GATE_REFUSED) {
    return { code: o.code, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  return { code: EXIT_CODES.INTERNAL_ERROR, line: SETTINGS_FAIL_CLOSED_LINE };
}

// ---------------------------------------------------------------------------
// The suggestion the CLI prints (never writes — the team commits it)
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
    return { code: EXIT_CODES.USAGE, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  if (!isUsableDirectory(args.dir)) {
    process.stderr.write('resolve-settings: not a usable directory: '
      + JSON.stringify(args.dir).slice(0, 300) + ' — failing closed\n');
    return { code: EXIT_CODES.INPUT_UNUSABLE, line: SETTINGS_FAIL_CLOSED_LINE };
  }
  const settings = resolveSettings({ dir: args.dir }, { exec: d.exec });
  if (settings.personalTracked) {
    process.stderr.write('resolve-settings: warning: Git tracks an entry at or under ' + PERSONAL_REL
      + ', so devflow ignores that file. It holds personal settings. Find the entry in the output of: git ls-files.'
      + ' Untrack it with: git rm --cached <entry>. Then check the file contents, or delete the file.'
      + ' Untracking leaves the committed bytes on disk as your personal file.\n');
  }
  if (settings.gateLevelInvalid) {
    // The layer and the field state only: a raw config value never reaches a terminal.
    process.stderr.write('resolve-settings: warning: gateLevel in '
      + (settings.gateLevelSource === 'personal' ? PERSONAL_REL : '~/.devflow/manifest.json')
      + ' is not one of ' + GATE_LEVELS.join(', ') + ' — GATE_LEVEL=full applies\n');
  }
  if (settings.unreadable !== null) {
    process.stderr.write('resolve-settings: ' + (settings.unreadable === 'project' ? PROJECT_REL : PERSONAL_REL)
      + ' exists but could not be read (not a JSON object, or git could not say whether it is tracked)'
      + ' — failing its fields closed, keeping every readable compliance lens\n');
  } else if (!settings.ok) {
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
  process.stdout.write(settled.line + '\n');
  process.exitCode = settled.code;
}

// ---------------------------------------------------------------------------
// Exports — the CLI seam (src/core/evidence-policy.ts), the capture hooks' gate read
// without jq (hooks/queue-append requires machineSwitchOn) and the unit tests
// ---------------------------------------------------------------------------

module.exports = Object.freeze({
  TRACKER_SOURCES,
  TRACKER_WARNS,
  EXIT_CODES,
  SETTINGS_LINE_RE,
  SETTINGS_FAIL_CLOSED_LINE,
  parseArgs,
  machineGateLevel,
  foldGateLevel,
  foldSettings,
  readRepoLayers,
  machineSwitchOn,
  ledgerRootOf,
  resolveSettings,
  formatSettingsLine,
  isCoherentSettingsLine,
  serializeProjectSuggestion,
  settleOutcome,
  main,
});

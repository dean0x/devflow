/**
 * The CLI's view of the evidence policy — a typed seam onto the package's own
 * `resolve-evidence-policy.cjs`, never a second implementation of it.
 *
 * D-POLICY-CJS-SEAM: the resolver is plain CommonJS under src/assets/scripts/,
 * outside every tsconfig (PF-043, PF-069), so the interfaces below are
 * TRANSCRIBED from its JSDoc typedefs and are the only shape authority on this
 * side — open those typedefs before changing anything here. The module is loaded
 * with `require()` from `scriptsDir()`, which resolves under the package root both
 * from `dist/cli.js` and under vitest (`package.json` `files` ships src/assets/),
 * so the CLI and the resolver it runs are always the same version. The installed
 * `~/.devflow/scripts` copy is never loaded: it may be older than this CLI. There
 * is deliberately no TypeScript copy of the parser, the fold or the grammar.
 *
 * The same seam loads the sibling `resolve-settings.cjs` (loadSettingsModule),
 * the local resolver of the per-repository settings layer — `.devflow/project.json`,
 * the personal `.devflow/config.json` and the machine manifest. Its shapes are
 * transcribed the same way, and there is no TypeScript copy of its fold either.
 * It also loads the shared strict parser both resolvers use,
 * `lib/project-config.cjs` (loadProjectConfigLib), so the CLI judges a config
 * file's bytes exactly as the resolvers do.
 *
 * D-POLICY-NO-WRITE (applies ADR-024): `.devflow/project.json` is team-owned, and
 * devflow never writes or replaces a shared file it cannot prove it wrote. This
 * module therefore imports no fs API; the CLI only PRINTS the bytes a team may
 * choose to commit (`evidencePolicySuggestion`, and the migration lines of
 * `repoComplianceStatusLines`), all from the settings resolver's project.json
 * serializer.
 *
 * D-POLICY-JSON-RETIRED: the evidence resolver never parses `.devflow/policy.json`;
 * at a source whose project.json has no `evidence`, the file's presence alone
 * resolves `required` (see the resolver's own note). This side neither reads nor
 * serializes it — it only names it in the migration hint.
 */

import { createRequire } from 'module';
import { join } from 'path';
import { scriptsDir } from './assets.js';

// ── Transcribed shapes (resolve-evidence-policy.cjs JSDoc) ─────────────────────

/** Basename of the resolver under src/assets/scripts/ (and ~/.devflow/scripts/). */
export const RESOLVER_SCRIPT_NAME = 'resolve-evidence-policy.cjs';

/** Basename of the settings resolver under src/assets/scripts/ (and ~/.devflow/scripts/). */
export const SETTINGS_SCRIPT_NAME = 'resolve-settings.cjs';

/** The shared strict config parser, relative to src/assets/scripts/ (and ~/.devflow/scripts/). */
export const PROJECT_CONFIG_LIB_NAME = join('lib', 'project-config.cjs');

/** The team file the CLI suggests committing, relative to a repository root. */
const PROJECT_FILE = '.devflow/project.json';

/** The retired team file project.json's `evidence` replaces, relative to a repository root. */
const RETIRED_POLICY_FILE = '.devflow/policy.json';

/** `Policy` typedef. */
export type EvidencePolicy = 'required' | 'standard';

/** `Source` typedef — the governing input, or `error` for a fail-closed resolution. */
export type EvidencePolicySource = 'file' | 'worktree' | 'default' | 'invalid' | 'error';

/** `Warning` typedef. */
export type EvidencePolicyWarning =
  | 'remote-unavailable'
  | 'invalid-file'
  | 'raised-by-compliance'
  | 'pr-changes-policy';

/** `MechanismInputs` typedef. */
export interface EvidencePolicyMechanismInputs {
  readonly ISSUE_REQUIRED: boolean;
  readonly APPLY_CONVENTIONS: boolean;
  readonly REQUIRE_NON_AUTHOR_APPROVAL: boolean;
}

/** `Resolution` typedef — what `resolve()` returns (frozen, arrays included). */
export interface EvidencePolicyResolution {
  readonly policy: EvidencePolicy;
  readonly source: EvidencePolicySource;
  readonly ref: string;
  readonly warnings: readonly EvidencePolicyWarning[];
  readonly inputs: EvidencePolicyMechanismInputs;
}

/** `ResolveOptions` typedef. `compliance` undefined makes the script read the manifest itself. */
export interface EvidencePolicyResolveOptions {
  readonly dir: string;
  readonly compliance?: unknown;
}

/**
 * The part of the resolver's `module.exports` the CLI relies on. `resolve()` never
 * throws: an internal failure is the fail-closed resolution (`required`, SOURCE
 * `error`), which is a real, displayable result.
 */
export interface EvidencePolicyModule {
  readonly POLICIES: readonly EvidencePolicy[];
  readonly SOURCES: readonly EvidencePolicySource[];
  readonly WARNINGS: readonly EvidencePolicyWarning[];
  readonly MECHANISM_INPUTS: Readonly<Record<EvidencePolicy, EvidencePolicyMechanismInputs>>;
  readonly OUTPUT_LINE_RE: RegExp;
  readonly FAIL_CLOSED_LINE: string;
  complianceDefault(rawFeatureValue: unknown): EvidencePolicy;
  resolve(opts: EvidencePolicyResolveOptions): EvidencePolicyResolution;
}

// ── Transcribed shapes (resolve-settings.cjs JSDoc) ────────────────────────────

/** `TrackerSource` typedef — who decided TRACKER. */
export type SettingsTrackerSource = 'project' | 'personal' | 'machine' | 'default';

/** `TrackerWarn` typedef. */
export type SettingsTrackerWarn = 'none' | 'mismatch' | 'invalid';

/** `SwitchSource` typedef — the layer that decided a feature switch. */
export type SettingsSwitchSource = 'machine' | 'project' | 'personal';

/** `SwitchState` typedef. */
export interface SettingsSwitchState {
  readonly on: boolean;
  readonly source: SettingsSwitchSource;
}

/** `Settings` typedef — what `resolveSettings()` returns (frozen). */
export interface RepoSettings {
  /** False only for the fail-closed resolution. */
  readonly ok: boolean;
  readonly tracker: 'github' | 'jira' | 'linear';
  readonly trackerSource: SettingsTrackerSource;
  readonly trackerWarn: SettingsTrackerWarn;
  readonly site: string | null;
  readonly key: string | null;
  readonly reviewPublication: 'off' | 'auto' | 'full';
  /** Enabled with no frameworks is the generic lens. */
  readonly compliance: { readonly enabled: boolean; readonly frameworks: readonly string[] };
  readonly switches: {
    readonly memory: SettingsSwitchState;
    readonly learning: SettingsSwitchState;
    readonly knowledge: SettingsSwitchState;
  };
  /** The worktree project.json's own ids, or null when it declares none. */
  readonly repoCompliance: readonly string[] | null;
  /**
   * The default branch's project.json ids (its local tracking copy), or null when
   * it declares none or there is no tracking copy (D-LENS-UNION).
   */
  readonly defaultBranchCompliance: readonly string[] | null;
  /**
   * `.devflow/config.json` is tracked by git, so the resolver ignored it as if it
   * were absent (D-PERSONAL-UNTRACKED).
   */
  readonly personalTracked: boolean;
  /** The worktree holds the retired `.devflow/policy.json`. */
  readonly retiredPolicyFile: boolean;
  /**
   * The repository layer whose file exists but is unreadable — the whole-file
   * rule then fails every field closed (`ok` false) except the compliance lens,
   * which stays the union of every readable layer (D-LENS-UNION): an unreadable
   * config.json owns no compliance, and an unreadable project.json reads as a
   * malformed declaration, the generic lens — or null.
   */
  readonly unreadable: Exclude<SettingsSwitchSource, 'machine'> | null;
}

/** `ResolveSettingsOptions` typedef. `manifest` undefined makes the script read it itself. */
export interface RepoSettingsOptions {
  readonly dir: string;
  readonly manifest?: unknown;
}

/**
 * The part of the settings resolver's `module.exports` the CLI relies on.
 * `resolveSettings()` never throws: an internal failure, or a git that cannot say
 * whether `dir` is a repository, is the fail-closed resolution (`ok: false`).
 */
export interface SettingsModule {
  readonly SETTINGS_LINE_RE: RegExp;
  readonly SETTINGS_FAIL_CLOSED_LINE: string;
  resolveSettings(opts: RepoSettingsOptions): RepoSettings;
  serializeProjectSuggestion(input: unknown): string | null;
}

// ── Transcribed shapes (lib/project-config.cjs JSDoc) ──────────────────────────

/** `decodeConfigBytes`'s verdict: no file, bytes that are no config text, or the text. */
export type DecodedConfigBytes =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'text'; readonly text: string };

/** The part of the shared parser's `module.exports` the CLI relies on. */
export interface ProjectConfigLib {
  /** Size, BOM and UTF-8 checks on a config file's bytes (`null` is no file). */
  decodeConfigBytes(buf: unknown): DecodedConfigBytes;
  /** Every duplicated member path of valid JSON text, or null when it is too deep to scan. */
  collectDuplicateKeyPaths(text: string): ReadonlySet<string> | null;
}

type SurfaceKind = 'string-array' | 'object' | 'regexp' | 'string' | 'function';

/**
 * Every key of EvidencePolicyModule and the runtime kind the loader requires of
 * it. `satisfies` makes the compiler reject an interface key missing here.
 */
export const EVIDENCE_POLICY_MODULE_SURFACE = Object.freeze({
  POLICIES: 'string-array',
  SOURCES: 'string-array',
  WARNINGS: 'string-array',
  MECHANISM_INPUTS: 'object',
  OUTPUT_LINE_RE: 'regexp',
  FAIL_CLOSED_LINE: 'string',
  complianceDefault: 'function',
  resolve: 'function',
} as const satisfies Record<keyof EvidencePolicyModule, SurfaceKind>);

/** Every key of SettingsModule and the runtime kind the loader requires of it. */
export const SETTINGS_MODULE_SURFACE = Object.freeze({
  SETTINGS_LINE_RE: 'regexp',
  SETTINGS_FAIL_CLOSED_LINE: 'string',
  resolveSettings: 'function',
  serializeProjectSuggestion: 'function',
} as const satisfies Record<keyof SettingsModule, SurfaceKind>);

/** Every key of ProjectConfigLib and the runtime kind the loader requires of it. */
export const PROJECT_CONFIG_LIB_SURFACE = Object.freeze({
  decodeConfigBytes: 'function',
  collectDuplicateKeyPaths: 'function',
} as const satisfies Record<keyof ProjectConfigLib, SurfaceKind>);

// ── Loader ─────────────────────────────────────────────────────────────────────

type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** Why the resolver could not be used. */
export type EvidencePolicyLoadError =
  | { readonly kind: 'not-found'; readonly path: string }
  | { readonly kind: 'unusable'; readonly path: string; readonly detail: string };

export type EvidencePolicyLoad = Result<EvidencePolicyModule, EvidencePolicyLoadError>;

export type SettingsLoad = Result<SettingsModule, EvidencePolicyLoadError>;

export type ProjectConfigLibLoad = Result<ProjectConfigLib, EvidencePolicyLoadError>;

function hasKind(value: unknown, kind: SurfaceKind): boolean {
  switch (kind) {
    case 'string-array': return Array.isArray(value) && value.every(v => typeof v === 'string');
    case 'object': return typeof value === 'object' && value !== null;
    case 'regexp': return value instanceof RegExp;
    case 'string': return typeof value === 'string';
    case 'function': return typeof value === 'function';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** Surface keys that are absent or of the wrong kind on `value`, in surface order. */
function surfaceMismatches(value: unknown, surface: Readonly<Record<string, SurfaceKind>>): string[] {
  if (typeof value !== 'object' || value === null) return Object.keys(surface);
  const record = value as Record<string, unknown>;
  return Object.entries(surface)
    .filter(([key, kind]) => !hasKind(record[key], kind))
    .map(([key]) => key);
}

/**
 * require() one package script and shape-check it against `surface`. Never
 * throws: a missing file is `not-found`; a module that throws on load or lacks a
 * surface key is `unusable`. The caller's type parameter is justified by the
 * surface check, which `satisfies` ties to the interface's keys.
 */
function loadScript<T>(file: string, surface: Readonly<Record<string, SurfaceKind>>): Result<T, EvidencePolicyLoadError> {
  let loaded: unknown;
  try {
    loaded = createRequire(import.meta.url)(file);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'MODULE_NOT_FOUND') return { ok: false, error: { kind: 'not-found', path: file } };
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: 'unusable', path: file, detail } };
  }
  const mismatches = surfaceMismatches(loaded, surface);
  if (mismatches.length > 0) {
    return { ok: false, error: { kind: 'unusable', path: file, detail: `missing or mistyped: ${mismatches.join(', ')}` } };
  }
  return { ok: true, value: loaded as T };
}

/**
 * Load the evidence resolver from `dir` (default: the package's own scripts
 * directory) and shape-check its surface.
 */
export function loadEvidencePolicyModule(dir: string = scriptsDir()): EvidencePolicyLoad {
  return loadScript<EvidencePolicyModule>(join(dir, RESOLVER_SCRIPT_NAME), EVIDENCE_POLICY_MODULE_SURFACE);
}

/**
 * Load the settings resolver from `dir` (default: the package's own scripts
 * directory) and shape-check its surface. A `resolveSettings()` call makes one
 * local `git` call and no network call (D-SETTINGS-LOCAL-ONLY).
 */
export function loadSettingsModule(dir: string = scriptsDir()): SettingsLoad {
  return loadScript<SettingsModule>(join(dir, SETTINGS_SCRIPT_NAME), SETTINGS_MODULE_SURFACE);
}

/**
 * Load the shared strict config parser from `dir` (default: the package's own
 * scripts directory) and shape-check its surface.
 */
export function loadProjectConfigLib(dir: string = scriptsDir()): ProjectConfigLibLoad {
  return loadScript<ProjectConfigLib>(join(dir, PROJECT_CONFIG_LIB_NAME), PROJECT_CONFIG_LIB_SURFACE);
}

// ── Presentation (pure) ────────────────────────────────────────────────────────

/** `Evidence policy: <policy> (source: <source>)`, plus ` [warn: a, b]` when warnings exist. */
export function formatEvidencePolicyStatus(r: EvidencePolicyResolution): string {
  const warn = r.warnings.length > 0 ? ` [warn: ${r.warnings.join(', ')}]` : '';
  return `Evidence policy: ${r.policy} (source: ${r.source})${warn}`;
}

/**
 * The line shown in place of a policy when the resolver cannot be loaded. The
 * remedy is a package reinstall: the CLI loads the package's own copy, which
 * `devflow init` does not restore.
 */
export function formatEvidencePolicyUnavailable(error: EvidencePolicyLoadError): string {
  switch (error.kind) {
    case 'not-found': return 'Evidence policy: unavailable (resolver not found — reinstall devflow-kit)';
    case 'unusable': return 'Evidence policy: unavailable (resolver failed to load — reinstall devflow-kit)';
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}

/**
 * The `compliance --status` line: the resolved policy for `opts.dir`, or the
 * unavailable line when the loader failed — that line is the whole handling
 * (ADR-028). The caller passes the compliance state it already read, so the
 * manifest is never read twice. `resolve()` makes at most three `gh` calls and
 * bounds every subprocess with a timeout, so an offline machine degrades to a
 * flagged result rather than a hang.
 */
export function evidencePolicyStatusLine(loaded: EvidencePolicyLoad, opts: EvidencePolicyResolveOptions): string {
  if (!loaded.ok) return formatEvidencePolicyUnavailable(loaded.error);
  return formatEvidencePolicyStatus(loaded.value.resolve(opts));
}

/**
 * The frameworks a compliance state names, for the suggestion: the raw list when
 * the state is well-formed, else none. The settings resolver's serializer
 * normalizes and drops unknown ids, so no id reaches the printed bytes unchecked.
 */
function suggestedFrameworks(complianceState: unknown): readonly string[] {
  if (typeof complianceState !== 'object' || complianceState === null) return [];
  const frameworks = (complianceState as { frameworks?: unknown }).frameworks;
  return Array.isArray(frameworks) && frameworks.every(f => typeof f === 'string') ? frameworks : [];
}

/**
 * What `--enable`/`--set` print when compliance is on: the `.devflow/project.json`
 * a team may commit to hold every developer to what this machine now gets by
 * default — the required evidence policy and this machine's frameworks. Returned
 * only when the evidence resolver's own `complianceDefault` says `required`
 * (compliance enabled, at any framework count); `null` otherwise. The bytes come
 * from the settings resolver's `serializeProjectSuggestion`, which returns them
 * only when they read back through the shared parser as exactly what was asked.
 * Nothing is written (D-POLICY-NO-WRITE, applies ADR-024).
 */
export function evidencePolicySuggestion(
  complianceState: unknown,
  policy: Pick<EvidencePolicyModule, 'complianceDefault'>,
  settings: Pick<SettingsModule, 'serializeProjectSuggestion'>,
): string | null {
  if (policy.complianceDefault(complianceState) !== 'required') return null;
  const body = settings.serializeProjectSuggestion({
    evidence: 'required',
    compliance: suggestedFrameworks(complianceState),
  });
  if (body === null) return null;
  return [
    'Compliance is enabled on this machine, so repositories without a committed',
    'evidence setting default to the required evidence policy here. To apply it for',
    `everyone working in a repository, add these keys to its ${PROJECT_FILE} on its`,
    'default branch — merged into the file when it already has one, never replacing it:',
    '',
    `${body}`,
    'devflow never writes this file: the team owns it, and once committed it applies',
    'repo-wide.',
  ].join('\n');
}

// ── The settings layer, for `--status` (pure) ──────────────────────────────────

/** A repo layer's file, as a `--status` line names it. */
export function settingsSourceFile(source: Exclude<SettingsSwitchSource, 'machine'>): string {
  switch (source) {
    case 'project': return PROJECT_FILE;
    case 'personal': return '.devflow/config.json';
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

/**
 * The effective state of a feature switch in this repository, ONLY when a repo
 * layer narrows it — `disabled (.devflow/project.json)` — and null otherwise, so a
 * `--status` whose machine switch alone decides prints exactly what it always has
 * (D-FEATURES-NARROW-ONLY). A repository file that exists but is unreadable fails
 * every field closed but the compliance lens, and a switch that closed off is
 * labelled with that file —
 * `disabled (.devflow/project.json is unreadable)` — since commands act on it. Any
 * other failure (the resolver failed to load, or git could not answer) yields
 * null: it knows nothing about this repository.
 */
export function narrowedSwitchLabel(
  loaded: SettingsLoad,
  opts: RepoSettingsOptions,
  feature: keyof RepoSettings['switches'],
): string | null {
  if (!loaded.ok) return null;
  const settings = loaded.value.resolveSettings(opts);
  if (!settings.ok) {
    if (settings.unreadable === null || settings.switches[feature].on) return null;
    return `disabled (${settingsSourceFile(settings.unreadable)} is unreadable)`;
  }
  const state = settings.switches[feature];
  if (state.on || state.source === 'machine') return null;
  return `disabled (${settingsSourceFile(state.source)})`;
}

/** The tracker a repository layer selected, and which layer did. */
export interface RepoTrackerSelection {
  readonly provider: RepoSettings['tracker'];
  readonly source: Exclude<SettingsSwitchSource, 'machine'>;
}

/**
 * The tracker in effect in the repository at `opts.dir`, ONLY when a repository
 * layer decides it — its committed project.json, or the personal config.json
 * narrowing — and null otherwise. A machine whose own selection (or the github
 * default) decides gets null, so `tracker --status` prints exactly what it always
 * has there. So does a resolver that failed to load or failed closed: it knows
 * nothing about this repository, and a fail-closed `github` is not a selection
 * anyone made.
 */
export function repoTrackerSelection(loaded: SettingsLoad, opts: RepoSettingsOptions): RepoTrackerSelection | null {
  if (!loaded.ok) return null;
  const settings = loaded.value.resolveSettings(opts);
  if (!settings.ok) return null;
  const source = settings.trackerSource;
  if (source !== 'project' && source !== 'personal') return null;
  return { provider: settings.tracker, source };
}

/** A declared id list as a `--status` line shows it. */
function idsLabel(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(', ') : 'generic controls only';
}

/**
 * The `compliance --status` lines about the repository in `opts.dir`, mirroring
 * the resolver's lens fold (D-LENS-UNION: machine ∪ default branch ∪ worktree):
 * the ids this checkout's project.json declares (`generic controls only` for an
 * empty or malformed list), the ids the default branch's copy declares, the
 * effective lens those add up to with the machine's, and a migration hint while
 * the retired policy file is in the working tree.
 *
 * A broken file affects only the keys it owns. An unreadable project.json is a
 * malformed declaration — generic — and says so, naming the file; an unreadable
 * config.json owns no compliance, so the lines are those of a readable one. Empty
 * when the resolver is unavailable or failed closed for any other reason, or no
 * repository layer declares anything and there is no policy file — the status
 * output is then unchanged.
 *
 * The hint states the rule (D-POLICY-JSON-RETIRED): the file is not read, and
 * while project.json has no `evidence` its presence holds the repository at
 * `required`. The value is not read either, so the hint shows the project.json
 * line for each value the file may hold, from the settings resolver's serializer.
 */
export function repoComplianceStatusLines(loaded: SettingsLoad, opts: RepoSettingsOptions): string[] {
  if (!loaded.ok) return [];
  const settings = loaded.value.resolveSettings(opts);
  if (!settings.ok && settings.unreadable === null) return [];
  const lines: string[] = [];
  if (settings.unreadable === 'project') {
    lines.push(`Repository: generic controls only (${PROJECT_FILE} is unreadable)`);
  } else if (settings.repoCompliance !== null) {
    lines.push(`Repository: ${idsLabel(settings.repoCompliance)} (${PROJECT_FILE})`);
  }
  if (settings.defaultBranchCompliance !== null) {
    lines.push(`Default branch: ${idsLabel(settings.defaultBranchCompliance)} (its ${PROJECT_FILE})`);
  }
  if (lines.length > 0) {
    const lens = settings.compliance;
    lines.push(`Effective here: ${lens.enabled ? idsLabel(lens.frameworks) : 'off'} (this machine + the default branch + this checkout)`);
  }
  if (settings.retiredPolicyFile) lines.push(...retiredPolicyHint(loaded.value));
  return lines;
}

/**
 * The warning a `--status` prints when this checkout's `.devflow/config.json` is
 * tracked by git, or null (D-PERSONAL-UNTRACKED). The resolver ignores such a file
 * and says so on stderr, but prompts run it with stderr discarded, so a status
 * command is where the user sees why their personal settings have no effect.
 */
export function personalConfigTrackedWarning(loaded: SettingsLoad, opts: RepoSettingsOptions): string | null {
  if (!loaded.ok) return null;
  if (!loaded.value.resolveSettings(opts).personalTracked) return null;
  const file = settingsSourceFile('personal');
  return `${file} is tracked by git, so devflow ignores it — it holds personal settings. ` +
    `Untrack it with: git rm --cached ${file}`;
}

/** The policies the hint maps, in the order it prints them. */
const HINT_POLICIES: readonly EvidencePolicy[] = ['standard', 'required'];

/**
 * The migration hint for a working tree holding the retired policy file: what the
 * file does now, and the project.json line that states each value it may hold.
 * A value whose line the serializer refuses is left out rather than hand-built.
 */
function retiredPolicyHint(settings: Pick<SettingsModule, 'serializeProjectSuggestion'>): string[] {
  const mappings = HINT_POLICIES.flatMap((policy) => {
    const body = settings.serializeProjectSuggestion({ evidence: policy });
    return body === null ? [] : [`              ${policy.padEnd(8)}  →  ${body.trimEnd()}`];
  });
  return [
    `Migration:  ${RETIRED_POLICY_FILE} is not read. While ${PROJECT_FILE} has no "evidence",`,
    '            its presence alone holds this repository at required. Add its value to',
    `            ${PROJECT_FILE} as "evidence", and keep ${RETIRED_POLICY_FILE} until every`,
    `            teammate runs devflow 3.0 or later; only then delete it:`,
    ...mappings,
  ];
}

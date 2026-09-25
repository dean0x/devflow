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
 * D-POLICY-NO-WRITE (applies ADR-024): `.devflow/policy.json` is team-owned, and
 * devflow never writes or replaces a shared file it cannot prove it wrote. This
 * module therefore imports no fs API; the CLI only PRINTS the bytes a team may
 * choose to commit (`evidencePolicySuggestion`).
 */

import { createRequire } from 'module';
import { join } from 'path';
import { scriptsDir } from './assets.js';

// ── Transcribed shapes (resolve-evidence-policy.cjs JSDoc) ─────────────────────

/** Basename of the resolver under src/assets/scripts/ (and ~/.devflow/scripts/). */
export const RESOLVER_SCRIPT_NAME = 'resolve-evidence-policy.cjs';

/** The team file the CLI suggests committing, relative to a repository root. */
const POLICY_FILE = '.devflow/policy.json';

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
  serializePolicy(policy: unknown): string | null;
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
  serializePolicy: 'function',
} as const satisfies Record<keyof EvidencePolicyModule, SurfaceKind>);

// ── Loader ─────────────────────────────────────────────────────────────────────

type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** Why the resolver could not be used. */
export type EvidencePolicyLoadError =
  | { readonly kind: 'not-found'; readonly path: string }
  | { readonly kind: 'unusable'; readonly path: string; readonly detail: string };

export type EvidencePolicyLoad = Result<EvidencePolicyModule, EvidencePolicyLoadError>;

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
function surfaceMismatches(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return Object.keys(EVIDENCE_POLICY_MODULE_SURFACE);
  const record = value as Record<string, unknown>;
  return Object.entries(EVIDENCE_POLICY_MODULE_SURFACE)
    .filter(([key, kind]) => !hasKind(record[key], kind))
    .map(([key]) => key);
}

/**
 * Load the resolver from `dir` (default: the package's own scripts directory) and
 * shape-check its surface. Never throws: a missing file is `not-found`; a module
 * that throws on load or lacks a surface key is `unusable`.
 */
export function loadEvidencePolicyModule(dir: string = scriptsDir()): EvidencePolicyLoad {
  const file = join(dir, RESOLVER_SCRIPT_NAME);
  let loaded: unknown;
  try {
    loaded = createRequire(import.meta.url)(file);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'MODULE_NOT_FOUND') return { ok: false, error: { kind: 'not-found', path: file } };
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: 'unusable', path: file, detail } };
  }
  const mismatches = surfaceMismatches(loaded);
  if (mismatches.length > 0) {
    return { ok: false, error: { kind: 'unusable', path: file, detail: `missing or mistyped: ${mismatches.join(', ')}` } };
  }
  return { ok: true, value: loaded as EvidencePolicyModule };
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
 * manifest is never read twice. `resolve()` makes at most two `gh` calls and
 * bounds every subprocess with a timeout, so an offline machine degrades to a
 * flagged result rather than a hang.
 */
export function evidencePolicyStatusLine(loaded: EvidencePolicyLoad, opts: EvidencePolicyResolveOptions): string {
  if (!loaded.ok) return formatEvidencePolicyUnavailable(loaded.error);
  return formatEvidencePolicyStatus(loaded.value.resolve(opts));
}

/**
 * What `--enable`/`--set` print when compliance is on: the file a team may commit
 * to pin the policy it now gets by default. Returned only when the resolver's own
 * `complianceDefault` says `required` (compliance enabled, at any framework
 * count); `null` otherwise. The bytes come from the resolver's `serializePolicy`,
 * so they always parse as a valid policy file. Nothing is written
 * (D-POLICY-NO-WRITE).
 */
export function evidencePolicySuggestion(
  complianceState: unknown,
  mod: Pick<EvidencePolicyModule, 'complianceDefault' | 'serializePolicy'>,
): string | null {
  if (mod.complianceDefault(complianceState) !== 'required') return null;
  const body = mod.serializePolicy('required');
  if (body === null) return null;
  return [
    'Compliance is enabled on this machine, so repositories without a committed',
    'policy default to the required evidence policy here. To apply it for everyone',
    `working in a repository, commit this as ${POLICY_FILE} on its default branch:`,
    '',
    `${body}`,
    'devflow never writes this file: the team owns it, and once committed it applies',
    'repo-wide.',
  ].join('\n');
}

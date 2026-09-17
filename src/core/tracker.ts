/**
 * Core issue-tracker provider registry, boundary parser, and file lifecycle.
 *
 * Two halves, deliberately in one module:
 *   - The DOMAIN half (registry, TrackerProvider, parseTrackerId,
 *     normalizeTrackerFeature, path derivation) is pure — zero I/O.
 *   - The LIFECYCLE half (rearmTrackerInference, applyTrackerSentinel,
 *     renameStaleTrackerConventions) owns the three ~/.devflow tracker files.
 *     It sits here rather than in a target adapter because ~/.devflow is
 *     devflow-global, not Claude-Code-specific — the same reason manifest.ts's
 *     read/write live in src/core/ (applies ADR-013).
 *
 * avoids PF-014: nothing here calls process.exit() and nothing throws; every
 *   fallible path returns a Result, so callers own their own error rendering
 *   and a try/finally in a caller is never skipped.
 *
 * D-TRACKER-OWNER [DR-22][DR-10]: the attempt counter and the presence sentinel
 *   have exactly ONE owner each — `rearmTrackerInference` and
 *   `applyTrackerSentinel`. `devflow init` and `devflow tracker --set` each call
 *   them exactly once. A bare "also delete this file" appended to an eleven-row
 *   edit list in a 2,100-line init.ts is the same policy expressed twice with no
 *   owner; these functions are the owner. Never inline an `fs.rm` at a call site.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Result type (local; matches the codebase per-module pattern)
// ---------------------------------------------------------------------------

/**
 * Local Result. The error channel is a human-readable message rather than a
 * second error taxonomy: `parseFrameworkList` (src/core/compliance.ts) already
 * establishes `{ok:false; error: string}` for a boundary parser, and a named
 * error interface with no consumer would be residue (applies ADR-003).
 */
export type TrackerResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Provider registry — the ONE authority on the closed provider set
// ---------------------------------------------------------------------------

/**
 * The shape of one registry row.
 *
 * `id` is `string` here, not `TrackerProvider`: this interface is the constraint
 * `TRACKER_PROVIDERS` is checked against and `TrackerProvider` is derived FROM
 * that registry, so narrowing `id` here would make the two circular and hand the
 * domain back to a second authority. The rows keep their literal ids — `as const`
 * on the registry is what preserves them.
 */
export interface TrackerProviderDefinition {
  /** Registry ID — the token accepted by `--tracker` and `devflow tracker --set`. */
  readonly id: string;
  /** Human-readable label rendered in prompts (static, never echoes user input). */
  readonly label: string;
  /** One-line hint shown in the init wizard select. */
  readonly hint: string;
}

/**
 * Canonical issue-tracker provider registry.
 *
 * D-TRACKER-ONE-DOMAIN [PF-049]: this table is the SINGLE authority on the closed
 * provider set, and `TrackerProvider` below is a projection of it. A provider
 * therefore exists for the type system exactly when it has a row here: there is no
 * hand-listed union that can admit an id `parseTrackerId` rejects and the wizard
 * never offers. `as const satisfies` is what buys both halves — `satisfies` checks
 * every row against `TrackerProviderDefinition` while `as const` keeps the ids as
 * literals rather than widening them to `string` (the same pattern
 * `VARIANT_MODULES` uses in src/core/mds-variants.ts).
 *
 * Labels and hints are stamped verbatim into rendered prompts — no user input is
 * ever written. The validated ID selects a hardcoded path prefix from a static
 * map at every consumer; the input string is never concatenated into a path.
 *
 * Hints deliberately avoid the token "MCP": transport must not leak into
 * user-facing text (standing prohibition).
 */
export const TRACKER_PROVIDERS = [
  { id: 'github', label: 'GitHub', hint: 'GitHub Issues through the gh CLI' },
  { id: 'jira',   label: 'Jira',   hint: 'Atlassian Jira issues and projects' },
  { id: 'linear', label: 'Linear', hint: 'Linear issues and projects' },
] as const satisfies readonly TrackerProviderDefinition[];

/**
 * The closed provider domain, projected from the registry. Never widened by user
 * input, and never spelled a second time.
 */
export type TrackerProvider = (typeof TRACKER_PROVIDERS)[number]['id'];

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * Named domain type for the tracker feature state.
 *
 * Shared across manifest.ts, init-seed.ts, init.ts, tracker-prompts.ts and
 * tracker.ts (CLI) — one definition instead of a repeated `{ provider: ... }`.
 *
 * D-TRACKER-NO-ENABLED: compliance's sibling state carries an `enabled` flag;
 * this one deliberately does NOT. `provider: 'github'` IS the off position —
 * GitHub is the default and needs no inference, no background agent and no
 * conventions file — so `{enabled:false, provider:'jira'}` would be an
 * incoherent state the rest of the feature would have to keep interpreting.
 */
export interface TrackerFeatureState {
  provider: TrackerProvider;
}

/** Registry IDs in registry order. */
export const TRACKER_PROVIDER_IDS: readonly TrackerProvider[] =
  TRACKER_PROVIDERS.map(p => p.id);

/**
 * The off position and the value every malformed input self-heals to.
 * Existing installs and every GitHub user land here, silently.
 */
export const DEFAULT_TRACKER_PROVIDER: TrackerProvider = 'github';

/**
 * The manifest key path, as ONE shared constant.
 *
 * Both readers must agree on this literal: the TypeScript reader
 * (`readManifest().features.tracker.provider`) and the shell reader
 * (`json_field_file "$devflowDir/manifest.json" "features.tracker.provider"`,
 * whose jq and node backends both split the dotted path and walk it). A second
 * spelling in a shell script is exactly the drift this constant prevents.
 */
export const TRACKER_PROVIDER_KEY_PATH = 'features.tracker.provider';

// ---------------------------------------------------------------------------
// Artifact basenames — one spelling for every TypeScript reader
//
// NOT the only spelling in the repository, and a rename that assumes it is will
// miss three places these names are hardcoded (PF-013): the SessionStart hook's
// Section 3 (shell) and the Tracker agent's prompt (prose), neither of which can
// import from here, and uninstall.ts's install-artifact list, which spells every
// ~/.devflow entry as a literal the way its siblings do. Each is cross-pinned
// against these constants by tests — shell-hooks, tracker-agent, uninstall-logic
// and core/tracker — so the spellings cannot drift silently, but they do have to
// move together.
//
// The conventions-backup set is the exception, and deliberately so: its members
// are one-per-provider, so uninstall imports TRACKER_CONVENTIONS_BACKUP_NAMES
// rather than listing them — a literal list there would fall behind the registry
// the day a fourth provider lands, leaving an unclassified file behind.
// ---------------------------------------------------------------------------

/** `~/.devflow/tracker.md` — the inferred conventions file (USER CONTENT on uninstall). */
export const TRACKER_CONVENTIONS_FILE = 'tracker.md';
/** `~/.devflow/.tracker.attempts` — inference attempt counter (install artifact). */
export const TRACKER_ATTEMPTS_FILE = '.tracker.attempts';
/** `~/.devflow/.tracker.enabled` — zero-byte presence sentinel (install artifact). */
export const TRACKER_ENABLED_FILE = '.tracker.enabled';
/** `~/.devflow/.tracker.processing` — the Tracker agent's atomic claim (install artifact). */
export const TRACKER_CLAIM_FILE = '.tracker.processing';

/**
 * How many background inference attempts a machine gets before the SessionStart
 * hook stops emitting the setup directive.
 *
 * Spelled twice for the reason the basenames above are (PF-013): the hook is the
 * enforcer and cannot import from here, so `TRACKER_ATTEMPTS_MAX=5` is also a
 * literal in src/assets/scripts/hooks/session-start-context. This constant is the
 * number `devflow tracker --status` quotes back when it re-arms the counter, and
 * tests/core/tracker.test.ts pins the two spellings together so the report cannot
 * promise more tries than the hook grants.
 */
export const TRACKER_ATTEMPTS_MAX = 5;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const REGISTRY_SET: ReadonlySet<string> = new Set<string>(TRACKER_PROVIDER_IDS);
const VALID_IDS_LIST = TRACKER_PROVIDER_IDS.join(', ');

/** Longest rejected value echoed back to the terminal, in CODE POINTS. */
const MAX_ECHOED_VALUE = 40;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

// ---------------------------------------------------------------------------
// Exported functions — domain
// ---------------------------------------------------------------------------

/**
 * The one runtime membership test for the provider domain.
 *
 * Byte-exact against the registry: no trim, no case folding, no alias. Both the
 * strict parser and the tolerant normaliser narrow through this, so the domain
 * the compiler enforces and the domain the boundary enforces are the same set by
 * construction rather than by two casts that happen to agree.
 */
export function isTrackerProvider(value: unknown): value is TrackerProvider {
  return typeof value === 'string' && REGISTRY_SET.has(value);
}

/**
 * Render an untrusted provider token for a terminal message.
 *
 * Rejected values are echoed so the user can see what they typed, so they are
 * third-party input at a display sink: control characters (terminal escapes,
 * BEL, newlines) are replaced and the value is truncated. Used by
 * `parseTrackerId`'s error text and by `devflow tracker --status`.
 */
export function describeTrackerValue(raw: string): string {
  // The class is written with ESCAPES, never literal control bytes. A raw NUL
  // makes grep classify this whole file as binary — it prints "Binary file
  // matches" and skips the lines — so every grep-based sweep over src/core/
  // silently stops covering tracker.ts while still exiting 0. Pinned by
  // tests/guards/no-control-bytes.test.ts.
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\x00-\x1f\x7f]/g, '?');
  // Cut by CODE POINT. `slice` cuts UTF-16 code units, so a cut landing inside an
  // astral character (emoji, CJK ext-B) emits the lone surrogate half of it.
  const points = [...stripped];
  return points.length > MAX_ECHOED_VALUE
    ? `${points.slice(0, MAX_ECHOED_VALUE).join('')}…`
    : stripped;
}

/**
 * Strict boundary parser for a provider token (`--tracker <id>`,
 * `devflow tracker --set <id>`).
 *
 * D-TRACKER-STRICT: REJECT, NEVER REPAIR. Membership is byte-exact against the
 * registry — no trim, no case folding, no alias, no space-to-dash. `jira-cloud`
 * errors rather than becoming `jira`; `JIRA` and `jira ` error rather than being
 * repaired into `jira`. This is the one place compliance's shape is copied but
 * its `normalizeId` is NOT: repairing a provider silently installs mechanics for
 * a tracker the user did not name, and a repaired token is the echo the
 * static-path-prefix rule exists to prevent. All-invalid input never yields a
 * silent default.
 *
 * The error names every valid ID and the offending value.
 */
export function parseTrackerId(input: string): TrackerResult<TrackerProvider> {
  if (input === '') {
    return { ok: false, error: `Missing tracker provider ID. Valid IDs: ${VALID_IDS_LIST}` };
  }
  if (!isTrackerProvider(input)) {
    return {
      ok: false,
      error: `Unknown tracker provider ID: "${describeTrackerValue(input)}". Valid IDs: ${VALID_IDS_LIST}`,
    };
  }
  return { ok: true, value: input };
}

/**
 * Tolerant sink normaliser for a raw `manifest.features.tracker` value.
 *
 * Absent, null, malformed, a bare string, or an unknown provider → the default
 * `{provider:'github'}` (applies ADR-014 self-heal). Drop-not-error: a manifest
 * written by a newer devflow, or hand-edited, degrades to what this build
 * understands instead of failing the read.
 *
 * D-TRACKER-SELF-HEAL [DR-26]: self-healing here is SILENT and emits no
 * DEGRADED — that is the correct ADR-014 behaviour, and it is a different
 * condition from a per-repo config value outside the domain (which does emit
 * `unknown tracker provider`). The two must not be conflated.
 */
export function normalizeTrackerFeature(raw: unknown): TrackerFeatureState {
  const DEFAULT: TrackerFeatureState = { provider: DEFAULT_TRACKER_PROVIDER };

  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT;
  }

  const obj = raw as Record<string, unknown>;
  if (!isTrackerProvider(obj.provider)) return DEFAULT;

  return { provider: obj.provider };
}

// ---------------------------------------------------------------------------
// Exported functions — path derivation (pure)
// ---------------------------------------------------------------------------

/** `{devflowDir}/tracker.md` — the inferred conventions file. */
export function trackerConventionsPath(devflowDir: string): string {
  return path.join(devflowDir, TRACKER_CONVENTIONS_FILE);
}

/** `{devflowDir}/.tracker.attempts` — the inference attempt counter. */
export function trackerAttemptsPath(devflowDir: string): string {
  return path.join(devflowDir, TRACKER_ATTEMPTS_FILE);
}

/** `{devflowDir}/.tracker.enabled` — the zero-byte presence sentinel. */
export function trackerEnabledSentinelPath(devflowDir: string): string {
  return path.join(devflowDir, TRACKER_ENABLED_FILE);
}

/** `tracker.md.{provider}.bak` — the basename a stale conventions file lands under. */
export function trackerConventionsBackupName(previous: TrackerProvider): string {
  return `${TRACKER_CONVENTIONS_FILE}.${previous}.bak`;
}

/** `{devflowDir}/tracker.md.{provider}.bak` — where a stale conventions file lands. */
export function trackerConventionsBackupPath(devflowDir: string, previous: TrackerProvider): string {
  return path.join(devflowDir, trackerConventionsBackupName(previous));
}

/**
 * Every backup basename a provider change can leave behind, in registry order.
 *
 * D-TRACKER-BACKUP-SET [OD-15]: a backup holds exactly what `tracker.md` held —
 * the user's inferred site and project key — so uninstall classifies the whole
 * set as USER CONTENT beside `tracker.md`, never as install artifacts (@D8 in
 * src/cli/commands/uninstall.ts keeps the two lists disjoint).
 *
 * Derived from `TRACKER_PROVIDER_IDS` rather than spelled out, so a fourth
 * provider is classified the moment it joins the registry instead of leaving a
 * file that survives an uninstall reporting `~/.devflow` swept. `github` is in
 * the set: a hand-written `tracker.md` is moved aside on a github→jira change
 * too, and `renameStaleTrackerConventions` takes `previous` from the whole
 * domain.
 */
export const TRACKER_CONVENTIONS_BACKUP_NAMES: readonly string[] =
  TRACKER_PROVIDER_IDS.map(id => trackerConventionsBackupName(id));

// ---------------------------------------------------------------------------
// Exported functions — file lifecycle
// ---------------------------------------------------------------------------

/**
 * Re-arm background convention inference by removing the attempt counter.
 *
 * The documented re-arm path (OD-14 / D-F): `devflow init` AND
 * `devflow tracker --set/--status` both re-arm, so a user whose tracker MCP
 * server was broken for five sessions is not stuck at the cap forever.
 *
 * Idempotent when the counter is absent; never throws (PF-014). `fs.rm` with
 * `force` treats an absent file — and an absent parent directory — as success.
 */
export async function rearmTrackerInference(devflowDir: string): Promise<TrackerResult<void>> {
  try {
    await fs.rm(trackerAttemptsPath(devflowDir), { force: true });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: `Could not reset the tracker attempt counter: ${errorMessage(err)}` };
  }
}

/**
 * Converge the `.tracker.enabled` presence sentinel to the resolved provider.
 *
 * [DR-10] Written (zero bytes) whenever the resolved provider is NOT github, and
 * removed when it is. This is the SessionStart hook's cheap gate: without it,
 * every GitHub user's every session would fall through to a manifest read — one
 * `jq` (or `node`) fork per session, forever, for 100% of users on the default
 * provider. With it the GitHub path is one `stat` and zero forks.
 *
 * Converges unconditionally in both directions (avoids PF-015): a provider
 * flipped back to github removes the sentinel in the same call shape that wrote
 * it, so there is no "enable wrote it, disable forgot it" asymmetry.
 */
export async function applyTrackerSentinel(
  devflowDir: string,
  provider: TrackerProvider,
): Promise<TrackerResult<void>> {
  const sentinel = trackerEnabledSentinelPath(devflowDir);
  try {
    if (provider === DEFAULT_TRACKER_PROVIDER) {
      await fs.rm(sentinel, { force: true });
    } else {
      await fs.mkdir(devflowDir, { recursive: true });
      await fs.writeFile(sentinel, '', 'utf-8');
    }
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: `Could not update the tracker sentinel: ${errorMessage(err)}` };
  }
}

/** What `renameStaleTrackerConventions` did — reported, never thrown. */
export type TrackerTransition =
  | { kind: 'none' }
  | { kind: 'renamed'; from: string; to: string; previous: TrackerProvider }
  | { kind: 'failed'; error: string };

/**
 * Rename a now-stale `~/.devflow/tracker.md` when the provider changes.
 *
 * P3a-S15 / AC-3.20 — the writer's repair. A conventions file inferred for one
 * provider is silently authoritative for the next one unless it is moved aside,
 * and the reader half (the provider-mismatch guard) then has nothing to disagree
 * with. Renaming to `tracker.md.{old}.bak` keeps the user's inferred content
 * recoverable while the next session re-arms inference for the new provider.
 *
 * Refuse-with-instruction is REJECTED: `devflow init` must never abort on a
 * feature-state change (PF-009's isolation posture) — a failed init is strictly
 * worse than a renamed file. Without the rename the user sits in a permanent
 * DEGRADED whose only documented escape is deleting a machine-wide file that
 * re-arms inference for every repo.
 *
 * A provider change with no file on disk, and an unchanged provider, are both
 * `{kind:'none'}` — a transition is a change plus a file.
 */
export async function renameStaleTrackerConventions(
  devflowDir: string,
  previous: TrackerProvider | undefined,
  resolved: TrackerProvider,
): Promise<TrackerTransition> {
  if (previous === undefined || previous === resolved) return { kind: 'none' };

  const from = trackerConventionsPath(devflowDir);
  const to = trackerConventionsBackupPath(devflowDir, previous);
  try {
    await fs.rename(from, to);
    return { kind: 'renamed', from, to, previous };
  } catch (err) {
    // Nothing to move aside — the common case on a provider change with no
    // prior inference run.
    if (isEnoent(err)) return { kind: 'none' };
    return { kind: 'failed', error: `Could not move the stale tracker.md aside: ${errorMessage(err)}` };
  }
}

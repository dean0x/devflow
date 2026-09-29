/**
 * Core issue-tracker provider registry, boundary parser, and file lifecycle.
 *
 * Two halves, deliberately in one module:
 *   - The DOMAIN half (registry, TrackerProvider, parseTrackerId,
 *     normalizeTrackerFeature, path derivation, the frontmatter parser) is
 *     pure — zero I/O.
 *   - The LIFECYCLE half (rearmTrackerInference, applyTrackerSentinel,
 *     migrateLegacyTrackerConventions) owns the ~/.devflow tracker files.
 *     It sits here rather than in a target adapter because ~/.devflow is
 *     devflow-global, not Claude-Code-specific — the same reason manifest.ts's
 *     read/write live in src/core/ (applies ADR-013).
 *
 * avoids PF-014: nothing here calls process.exit() and nothing throws; every
 *   fallible path returns a Result, so callers own their own error rendering
 *   and a try/finally in a caller is never skipped.
 *
 * D-TRACKER-OWNER [DR-22][DR-10]: the attempt counters and the machine provider
 *   sentinel have exactly ONE owner each — `rearmTrackerInference` and
 *   `applyTrackerSentinel` — and every command that touches one goes through it.
 *   The sentinel is converged by `devflow init` and `devflow tracker --set`; the
 *   counters are re-armed by those two and by `devflow tracker --status`, which
 *   is the command a capped user reaches for (D-F). The conventions files are the
 *   Tracker agent's to write and the user's to edit: no command moves, renames or
 *   deletes one, and the single legacy file is moved once, by the migration that
 *   calls `migrateLegacyTrackerConventions`. Never inline an `fs.rm` at a call
 *   site.
 */

import { promises as fs } from 'fs';
import type { FileHandle } from 'fs/promises';
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

// ---------------------------------------------------------------------------
// Artifact basenames — one spelling for every TypeScript reader
//
// NOT the only spelling in the repository, and a rename that assumes it is will
// miss the places these names are hardcoded (PF-013): the SessionStart hook's
// Section 3 (shell) and the Tracker agent's prompt (prose), neither of which can
// import from here. Each is cross-pinned against these constants by tests —
// shell-hooks-tracker, tracker-agent, uninstall-logic and core/tracker — so the
// spellings cannot drift silently, but they do have to move together.
//
// Two families are one-per-provider and are DERIVED from the registry rather
// than spelled out — the conventions files under TRACKER_CONVENTIONS_DIR and the
// attempt counters (TRACKER_ATTEMPTS_NAMES) — so a fourth provider is covered the
// day it joins the registry. The staging files are one-per-invocation under a
// mktemp name, so uninstall imports TRACKER_STAGED_PREFIX and resolves it against
// disk.
// ---------------------------------------------------------------------------

/**
 * `~/.devflow/tracker/` — one inferred conventions file per provider
 * (USER CONTENT on uninstall).
 *
 * D-TRACKER-PER-PROVIDER-CONVENTIONS: conventions are learned per PROVIDER, not
 * per machine. A repository may select its own tracker in its committed
 * `.devflow/project.json`, so one machine can meet more than one provider, and a
 * single machine-wide file would be silently authoritative for whichever provider
 * did not write it. One file per provider means a provider change moves nothing
 * aside: the other provider's conventions stay where they are, correct for the
 * repositories that use it.
 */
export const TRACKER_CONVENTIONS_DIR = 'tracker';
/**
 * `~/.devflow/tracker.md` — the single machine-wide conventions file releases
 * before per-provider conventions wrote. The `tracker-conventions-per-provider-v1`
 * migration moves it to its provider's file; one it cannot place (no provider in
 * its frontmatter, or that provider's file already exists) stays, as USER CONTENT.
 */
export const TRACKER_LEGACY_CONVENTIONS_FILE = 'tracker.md';
/** `~/.devflow/.tracker.attempts` — the single counter those releases kept; the migration removes it. */
export const TRACKER_LEGACY_ATTEMPTS_FILE = '.tracker.attempts';
/**
 * `~/.devflow/.tracker.enabled` — the machine provider sentinel (install artifact).
 * Holds the provider NAME on one line; absent for github (see applyTrackerSentinel).
 */
export const TRACKER_ENABLED_FILE = '.tracker.enabled';
/** `~/.devflow/.tracker.processing` — the Tracker agent's atomic claim (install artifact). */
export const TRACKER_CLAIM_FILE = '.tracker.processing';
/**
 * `~/.devflow/.tracker-staged.XXXXXX` — the Tracker agent's scrubbed staging
 * file (install artifact). A basename PREFIX, not a basename.
 *
 * The agent takes its stage with `mktemp` inside `~/.devflow`, one per
 * invocation so two concurrent runs never share a path, and removes it from a
 * `trap` on EXIT INT TERM. A SIGKILL outruns the trap, so a stage can outlive
 * the run it belongs to — and an artifacts-only uninstall that removes exact
 * paths walks straight past it while reporting the directory swept. It carries
 * no user-authored content (it is a scrubbed, unplaced copy of what the agent
 * was about to write), so it is an install artifact, never user content.
 *
 * Spelled twice for the reason the basenames above are (PF-013): the agent's
 * prompt cannot import from here, so the mktemp template is also a literal in
 * src/assets/agents/tracker.md, and tests/core/tracker.test.ts pins the two
 * spellings together.
 */
export const TRACKER_STAGED_PREFIX = '.tracker-staged.';

/**
 * `.tracker.{provider}.attempts` — one provider's inference attempt counter
 * (install artifact).
 *
 * Per provider, so one provider whose tracker connection is broken spends only
 * its own attempts: a machine that meets jira in one repository and linear in
 * another must not have the broken one cap the working one. The claim file stays
 * global — one Tracker agent runs at a time on a machine, whichever provider it
 * is learning.
 */
export function trackerAttemptsName(provider: TrackerProvider): string {
  return `.tracker.${provider}.attempts`;
}

/** Every provider's attempt-counter basename, in registry order — what a re-arm clears and uninstall removes. */
export const TRACKER_ATTEMPTS_NAMES: readonly string[] =
  TRACKER_PROVIDER_IDS.map(id => trackerAttemptsName(id));

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

/** The errno of a rejected fs call, or undefined when the failure carries none. */
function errnoCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
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
 *
 * Takes `unknown`, and a non-string renders as its TYPE: the module's
 * never-throws contract (PF-014) has to hold for what reaches this sink, not
 * only for what the signature says does — `devflow tracker --status` reads
 * a conventions file's hand-editable frontmatter, and a caller-side guard is one edit
 * from being gone. Naming the type also keeps the render total, where `String()`
 * would hand control to a caller-supplied `toString` — itself both a throw path
 * and an echo path this function exists to close.
 */
export function describeTrackerValue(raw: unknown): string {
  if (typeof raw !== 'string') return `<${raw === null ? 'null' : typeof raw}>`;
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

/** `{devflowDir}/tracker` — the directory holding one conventions file per provider. */
export function trackerConventionsDir(devflowDir: string): string {
  return path.join(devflowDir, TRACKER_CONVENTIONS_DIR);
}

/**
 * `{devflowDir}/tracker/{provider}.md` — one provider's inferred conventions.
 *
 * The provider is a registry id (the type admits nothing else), so the segment it
 * contributes is one of three fixed words, never user input joined into a path.
 */
export function trackerConventionsPath(devflowDir: string, provider: TrackerProvider): string {
  return path.join(trackerConventionsDir(devflowDir), `${provider}.md`);
}

/** `{devflowDir}/.tracker.{provider}.attempts` — one provider's inference attempt counter. */
export function trackerAttemptsPath(devflowDir: string, provider: TrackerProvider): string {
  return path.join(devflowDir, trackerAttemptsName(provider));
}

/** `{devflowDir}/.tracker.enabled` — the machine provider sentinel. */
export function trackerEnabledSentinelPath(devflowDir: string): string {
  return path.join(devflowDir, TRACKER_ENABLED_FILE);
}

// ---------------------------------------------------------------------------
// Exported functions — the conventions file's frontmatter (pure)
// ---------------------------------------------------------------------------

/**
 * What a conventions file's leading frontmatter says about itself.
 *
 * `hasFrontmatter: false` is a real, distinct outcome: the file carries no `---`
 * block at offset 0. Every value is RAW — the file is hand-editable and
 * machine-wide, so its content is third-party input at every sink, and each
 * caller gates what it takes (the migration admits only a registry id; `--status`
 * renders through describeTrackerValue).
 */
export interface TrackerFrontmatter {
  hasFrontmatter: boolean;
  provider?: string;
  inferredFrom?: string;
}

/** How many leading lines of a conventions file are scanned for frontmatter. */
const FRONTMATTER_SCAN_LINES = 40;

/**
 * Parse the leading frontmatter of a conventions file's head.
 *
 * The one parser, shared by `devflow tracker --status` and the
 * per-provider migration, so the two can never disagree about which provider a
 * file names. Scans at most {@link FRONTMATTER_SCAN_LINES} lines; the first
 * occurrence of each key wins.
 */
export function parseTrackerFrontmatter(head: string): TrackerFrontmatter {
  const lines = head.split('\n', FRONTMATTER_SCAN_LINES);
  if (lines[0]?.trim() !== '---') return { hasFrontmatter: false };

  let provider: string | undefined;
  let inferredFrom: string | undefined;
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break;
    const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (match === null) continue;
    if (match[1] === 'provider' && provider === undefined) provider = match[2].trim();
    if (match[1] === 'inferred-from' && inferredFrom === undefined) inferredFrom = match[2].trim();
  }
  return { hasFrontmatter: true, provider, inferredFrom };
}

/**
 * How many leading BYTES of a conventions file any reader takes — the bound the
 * Tracker agent writes to and the Git agent loads. A line cap alone bounds the
 * SCAN, not the read: the file's size is not devflow's to assume (avoids PF-023:
 * a bound is only real at the sink).
 */
export const TRACKER_CONVENTIONS_READ_BYTES = 8000;

/**
 * Read at most `limit` bytes from the head of a REGULAR file.
 *
 * `undefined` for an absent, unreadable or non-regular path — a FIFO or a device
 * is refused before it is opened, so a hostile entry can never block a read.
 * Follows a symlink to read what it names (a reader cares what the conventions
 * SAY); it never moves or writes through one. Never throws (PF-014).
 */
export async function readBoundedHead(filePath: string, limit: number): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    if (!(await fs.stat(filePath)).isFile()) return undefined;
    handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Exported functions — file lifecycle
// ---------------------------------------------------------------------------

/**
 * Re-arm background convention inference by removing every provider's attempt
 * counter.
 *
 * The documented re-arm path (OD-14 / D-F): `devflow init` AND
 * `devflow tracker --set/--status` all re-arm, so a user whose tracker server
 * was broken for five sessions is not stuck at the cap forever. Every provider's
 * counter, not only the machine's: a repository's committed project.json can
 * select a provider the machine never did, and its counter is the one a user in
 * that repository is capped on.
 *
 * Idempotent when a counter is absent; never throws (PF-014). `fs.rm` with
 * `force` treats an absent file — and an absent parent directory — as success.
 */
export async function rearmTrackerInference(devflowDir: string): Promise<TrackerResult<void>> {
  try {
    for (const name of TRACKER_ATTEMPTS_NAMES) {
      await fs.rm(path.join(devflowDir, name), { force: true });
    }
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: `Could not reset the tracker attempt counter: ${errorMessage(err)}` };
  }
}

/**
 * Converge the `.tracker.enabled` sentinel to the machine provider.
 *
 * [DR-10] Holds the provider NAME, one line, whenever the machine provider is NOT
 * github, and is removed when it is. The SessionStart hook reads it with the
 * `read` builtin, so the machine provider costs no fork: a GitHub user pays one
 * `stat`, and a jira machine whose conventions are already learned pays a stat,
 * a builtin read and a second stat — zero forks either way. A name rather than a
 * bare presence marker, so the hook never has to open the manifest to learn which
 * provider it is gating.
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
      await fs.writeFile(sentinel, `${provider}\n`, 'utf-8');
    }
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: `Could not update the tracker sentinel: ${errorMessage(err)}` };
  }
}

/** What {@link migrateLegacyTrackerConventions} did — reported, never thrown. */
export type TrackerConventionsMigration =
  | { kind: 'none' }
  | { kind: 'moved'; from: string; to: string; provider: TrackerProvider }
  | { kind: 'kept'; reason: string }
  | { kind: 'failed'; error: string };

/**
 * Move the pre-per-provider `~/.devflow/tracker.md` to the provider file its
 * frontmatter names (D-TRACKER-PER-PROVIDER-CONVENTIONS), once.
 *
 *   - no legacy file                         → `none`
 *   - frontmatter names a registry provider,
 *     and that provider's file does not exist → `moved`, by `rename(2)`
 *   - no provider it can name, or the target
 *     already exists                         → `kept`: the file stays where it is,
 *                                               user content, with one reason
 *   - any I/O failure                        → `failed`
 *
 * `rename(2)` moves a SYMLINK itself, never the file it points at, so a
 * conventions file kept in a dotfiles repository stays there and only the link
 * moves. A link's target is resolved relative to the link's directory, so a
 * RELATIVE link now resolves from one level deeper; an absolute one is unaffected.
 * rename also replaces an existing destination without a word, which is why the
 * target is probed first and a present one is never overwritten: that file holds
 * conventions a user may have corrected by hand, and it is the provider's own.
 *
 * The legacy single attempt counter is removed on every run that reaches the end:
 * it carries no user content, the per-provider counters replace it, and a file
 * nothing reads is one no uninstall list would account for.
 */
export async function migrateLegacyTrackerConventions(devflowDir: string): Promise<TrackerConventionsMigration> {
  const from = path.join(devflowDir, TRACKER_LEGACY_CONVENTIONS_FILE);
  try {
    await fs.rm(path.join(devflowDir, TRACKER_LEGACY_ATTEMPTS_FILE), { force: true });

    try {
      await fs.lstat(from);
    } catch (err) {
      if (errnoCode(err) === 'ENOENT') return { kind: 'none' };
      throw err;
    }

    const head = await readBoundedHead(from, TRACKER_CONVENTIONS_READ_BYTES);
    if (head === undefined) {
      return { kind: 'kept', reason: `${from} is not a readable regular file, so it was left in place.` };
    }
    const named = parseTrackerFrontmatter(head).provider;
    if (!isTrackerProvider(named)) {
      return {
        kind: 'kept',
        reason:
          `${from} names no tracker provider in its frontmatter, so it was left in place — ` +
          `move it to ${trackerConventionsDir(devflowDir)}/{provider}.md by hand if it is still wanted.`,
      };
    }

    const to = trackerConventionsPath(devflowDir, named);
    try {
      await fs.lstat(to);
      return {
        kind: 'kept',
        reason: `${from} was left in place — ${to} already exists and is never overwritten.`,
      };
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') throw err;
    }

    await fs.mkdir(trackerConventionsDir(devflowDir), { recursive: true });
    await fs.rename(from, to);
    return { kind: 'moved', from, to, provider: named };
  } catch (err) {
    return { kind: 'failed', error: `Could not move ${from} to its provider's file: ${errorMessage(err)}` };
  }
}

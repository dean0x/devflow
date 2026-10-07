import * as path from 'path';
import { promises as fs } from 'fs';
import type { FileHandle } from 'fs/promises';
import { firstSymbolicLink } from './linked-path.js';
import { getFeatureConfigPath } from './project-paths.js';
import { parseTrackerId, type TrackerProvider } from './tracker.js';
import { loadProjectConfigLib, type ProjectConfigLib, type ProjectConfigLibLoad } from './evidence-policy.js';

export type ReviewPublication = 'auto' | 'full' | 'off';

/**
 * The parsed per-repo tracker override — THREE states, because the Git agent's
 * resolution order needs all three and no two of them mean the same thing
 * (OD-9, [DR-26]).
 *
 *   absent  — no override. The provider is the repository's `project.json`
 *             selection, else `features.tracker.provider` in the manifest. This is
 *             NOT the same as `github`: a chosen `github` is a personal decision
 *             that outranks both, absence defers to them.
 *   valid   — a registered provider id, byte-exact. It NARROWS: the settings line
 *             honours it when it names `github` or the provider resolved without
 *             it, and reports `TRACKER_WARN=mismatch` — the Git agent's
 *             `TRACEABILITY: DEGRADED (tracker configuration mismatch (repository
 *             override))` — for any other: a personal file cannot elect a provider
 *             the repository and the machine did not.
 *   invalid — the key is set to something outside the registry. Carries the raw
 *             value so `TRACEABILITY: DEGRADED (unknown tracker provider)` can
 *             name it (§14.2). Distinct from `absent` precisely so that reason is
 *             reachable; the MANIFEST value's malformed case self-heals silently
 *             instead ([DR-26]) and the two must not be conflated.
 */
export type TrackerConfigOverride =
  | { kind: 'absent' }
  | { kind: 'valid'; provider: TrackerProvider }
  | { kind: 'invalid'; raw: string };

/**
 * The per-repo config: facts ABOUT one repository, and the personal narrowing of
 * the machine's feature switches.
 *
 * D-FEATURES-NARROW-ONLY (src/core/feature-switch.ts): memory, learning and
 * knowledge are switched in ~/.devflow/manifest.json, and a hand-written
 * `features` object here (like the one in the team's `.devflow/project.json`)
 * may only narrow them — resolve-settings.cjs reads it through the shared
 * parser; nothing in this module interprets it. devflow never writes `features`:
 * it is carried verbatim by every managed write, like the `tracker` override. The
 * old top-level per-repo keys are retired ({@link RETIRED_CONFIG_KEYS}) — no
 * gate reads them, and the next managed write drops them from the file.
 */
export interface FeatureConfig {
  reviewPublication: ReviewPublication;
  /**
   * The per-repo tracker provider override, as the RAW JSON value the config
   * file holds. Absent (`undefined`) means no override, and the key is then
   * omitted from the written JSON — devflow never manufactures a `null` or a
   * default provider to stand in for it. A `null` a USER wrote is a present
   * value like any other: preserved on write, `invalid` at the parse.
   *
   * `unknown`, not `string`, and deliberately unvalidated HERE unlike every
   * sibling field. Two properties rest on that:
   *
   *   - Repair is forbidden for this value (§14.9-6: reject, never repair), so a
   *     reader must hand consumers the value the file holds — a misspelled one
   *     included, or the DEGRADED that reports it is never reached. What stays
   *     on DISK does not depend on this field: every writer carries the key from
   *     the file itself (D-CONFIG-PRESERVE-UNMANAGED).
   *   - {@link parseTrackerOverride} gives a present-but-wrong-typed value its
   *     own `invalid` verdict. A `string` field would narrow the JSON before the
   *     parser ever saw it, leaving that arm reachable from a direct call and
   *     unreachable from the file a user actually edits.
   *
   * NEVER consume this field directly — parse it with {@link parseTrackerOverride},
   * which routes through the same `parseTrackerId` the CLI boundary uses so there
   * is ONE authority on what a provider token may be.
   */
  tracker?: unknown;
}

/**
 * The keys of FeatureConfig that devflow WRITES. `tracker` is not one of them:
 * no devflow command sets the per-repo override, it is hand-written and only
 * ever carried (see {@link mergeManagedConfig}).
 */
export type ManagedConfig = Omit<FeatureConfig, 'tracker'>;

/**
 * Keys devflow itself once wrote and has retired. A managed write drops them
 * rather than carrying them; no reader consults them.
 *
 * D-FEATURES-NARROW-ONLY: `memory`, `learning` and `knowledge` were top-level
 * per-repo feature switches from the per-repo-install era. A repository now
 * narrows a feature only through the `features` namespace, so a stale top-level
 * value must neither decide anything nor linger to be mistaken for a switch:
 * carrying it would leave a `learning: false` in the file that no longer does
 * what it says. `decisions` is the pre-rename spelling of `learning`;
 * `autoCommit` is inert. `features` is deliberately NOT here — it is a live key,
 * carried like any other unmanaged key.
 */
const RETIRED_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'memory', 'learning', 'knowledge', 'decisions', 'autoCommit',
]);

export const DEFAULT_CONFIG: FeatureConfig = {
  reviewPublication: 'auto',
};

export function getConfigPath(projectRoot: string): string {
  return getFeatureConfigPath(projectRoot);
}

/**
 * Parse the per-repo tracker override from the raw config value.
 *
 * Pure. Delegates membership to `parseTrackerId` rather than re-spelling a
 * closed-domain ternary the way `reviewPublication` does: `reviewPublication`
 * self-heals any invalid value to `'auto'`, which is correct for a publication
 * mode and wrong for a provider — a repaired provider is the laundering path
 * GAP-10 names, and §14.2 gives the invalid case its own DEGRADED reason, which
 * only exists if the parse REFUSES instead of healing.
 *
 * An empty string reads as absent: `"tracker": ""` is an unset key with a
 * character in it, not an attempt to name a provider.
 *
 * A non-string JSON value (`42`, `true`, `null`, an array, an object) is
 * `invalid`, not `absent` — a present-but-wrong-typed value means the file was
 * edited, and reporting it as absent would make the whole class silent.
 */
export function parseTrackerOverride(raw: unknown): TrackerConfigOverride {
  if (raw === undefined || raw === '') return { kind: 'absent' };
  // `unknown` all the way from the field: this is a boundary parse over
  // hand-edited JSON, and a signature that promised a string would make the
  // wrong-type arm unreachable to the compiler while it stays entirely reachable
  // to a user with a text editor.
  if (typeof raw !== 'string') {
    return { kind: 'invalid', raw: JSON.stringify(raw) ?? String(raw) };
  }
  const parsed = parseTrackerId(raw);
  return parsed.ok ? { kind: 'valid', provider: parsed.value } : { kind: 'invalid', raw };
}

/**
 * Whether a parsed JSON value is an object a config can be read from — the one
 * test for "the file holds a config", shared by the reader and the managed
 * write so the two never disagree about which files count as empty.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and narrow an unknown JSON value into a FeatureConfig, merging onto
 * DEFAULT_CONFIG. Pure function — no I/O, no side effects.
 *
 * The retired keys ({@link RETIRED_CONFIG_KEYS}) are ignored: an old config may
 * still hold them, and none of them decides anything (D-FEATURES-NARROW-ONLY).
 *
 * Returns null when `parsed` is not a plain object (caller falls through to
 * the next candidate path).
 */
function coerceConfig(parsed: unknown): FeatureConfig | null {
  if (!isJsonObject(parsed)) return null;
  const p = parsed;

  // Coerce reviewPublication: any invalid or absent value → 'auto' (self-heal).
  const rp = p.reviewPublication;
  const reviewPublication: ReviewPublication =
    rp === 'auto' || rp === 'full' || rp === 'off' ? rp : 'auto';

  // The per-repo tracker override is carried through VERBATIM — never coerced,
  // never type-filtered. Two reasons, and the second is the one a reader is
  // likely to miss:
  //   (a) repair is forbidden for a provider value (§14.9-6), so there is no
  //       healed value to fall back to the way reviewPublication has 'auto';
  //   (b) a non-string is a state parseTrackerOverride CLASSIFIES (`invalid`),
  //       not a state this function repairs. Filtering by type here would leave
  //       that arm reachable from a direct call to the parser and unreachable
  //       from the file, which is the only place it can actually be written.
  // Key PRESENCE is the whole rule: a present key is carried as written, and an
  // absent one stays absent. `hasOwnProperty` rather than `in` because the
  // object comes from JSON.parse at a trust boundary. Retention on disk is not
  // decided here: the writers carry every unmanaged key from the file itself
  // (D-CONFIG-PRESERVE-UNMANAGED).
  const hasTracker = Object.prototype.hasOwnProperty.call(p, 'tracker');

  return {
    reviewPublication,
    ...(hasTracker ? { tracker: p.tracker } : {}),
  };
}

/**
 * Read the per-repo config for a project root.
 * Returns DEFAULT_CONFIG when the file is missing or unusable.
 */
export async function readConfig(projectRoot: string): Promise<FeatureConfig> {
  return coerceConfig(objectOf(await readConfigBody(projectRoot))) ?? { ...DEFAULT_CONFIG };
}

/**
 * What a project's config file holds, judged by the shared strict parser.
 *
 *   absent      — no file.
 *   object      — a JSON object with no key repeated anywhere in it.
 *   malformed   — bytes the resolvers cannot read as a config: not UTF-8, a
 *                 BOM, over the size bound, not JSON, not an object, too deeply
 *                 nested, or a key repeated in one object.
 *   unreadable  — the bytes could not be read: an I/O error other than a
 *                 missing file, a path that is not a regular file within the
 *                 size bound (a symlink included, D-CONFIG-NO-FOLLOW), or a
 *                 parser that could not be loaded.
 */
export type ConfigBody =
  | { readonly kind: 'absent' }
  | { readonly kind: 'object'; readonly value: Record<string, unknown> }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/**
 * Classify a config file's bytes (`null` is no file). Pure.
 *
 * D-CONFIG-STRICT-PARSE: `.devflow/config.json` is judged by the one parser the
 * resolvers use (lib/project-config.cjs, D-PROJECT-STRICT-KEYS), never by a bare
 * `JSON.parse`. The two disagreed where it mattered: `JSON.parse` keeps the
 * LAST of two duplicate keys silently, while the resolvers read the file as
 * saying two things and fail its keys closed — so devflow could rewrite a file
 * into a meaning it never had. A file the parser rejects is `malformed`.
 */
export function classifyConfigBytes(buf: Uint8Array | null, lib: ProjectConfigLib): ConfigBody {
  const decoded = lib.decodeConfigBytes(buf);
  if (decoded.kind === 'absent') return { kind: 'absent' };
  if (decoded.kind === 'invalid') return { kind: 'malformed' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.text);
  } catch {
    return { kind: 'malformed' };
  }
  if (!isJsonObject(parsed)) return { kind: 'malformed' };
  const duplicates = lib.collectDuplicateKeyPaths(decoded.text);
  if (duplicates === null || duplicates.size > 0) return { kind: 'malformed' };
  return { kind: 'object', value: parsed };
}

/** The object a config body holds, or undefined for any other body. */
function objectOf(body: ConfigBody): Record<string, unknown> | undefined {
  return body.kind === 'object' ? body.value : undefined;
}

/**
 * Read and classify a project's config file. Every read of the file goes
 * through here, so readConfig, readConfigIfPresent and writeManagedConfig agree
 * on what an unusable file means. Never throws.
 *
 * D-CONFIG-NO-FOLLOW: the bytes come from the resolvers' own bounded read
 * (lib/project-config.cjs readBoundedRegularFile, `followSymlinks` false — the
 * read resolve-settings' readConfigFile makes), so devflow and the settings line
 * never disagree about which file configures the repository. A symlink —
 * dangling or not — a directory, a FIFO or a file over MAX_CONFIG_BYTES is
 * refused unopened and reads as `unreadable`: readers configure nothing from it,
 * and writeManagedConfig leaves it in place (D-CONFIG-NO-REPAIR) rather than
 * writing through the link or renaming a regular file over it.
 */
async function readConfigBody(
  projectRoot: string,
  lib: ProjectConfigLibLoad = loadProjectConfigLib(),
): Promise<ConfigBody> {
  if (!lib.ok) return { kind: 'unreadable', detail: `config parser unavailable: ${lib.error.path}` };
  const read = lib.value.readBoundedRegularFile(getFeatureConfigPath(projectRoot), lib.value.MAX_CONFIG_BYTES, false);
  if (read.kind === 'absent') return { kind: 'absent' };
  if (read.kind === 'refused') {
    return {
      kind: 'unreadable',
      detail: `not a regular file of at most ${lib.value.MAX_CONFIG_BYTES} bytes; a symlink is never followed`,
    };
  }
  return classifyConfigBytes(read.bytes, lib.value);
}

/** What writeConfigBody did: the file is in place, or why it is not. */
type ConfigBodyWrite = { readonly ok: true } | { readonly ok: false; readonly detail: string };

/** A thrown value's message, or the value itself when it is not an Error. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Serialise a config body to a project's config file. Never throws.
 * Creates the .devflow/ directory if missing.
 * Uses an atomic temp+rename pattern to prevent partial reads under concurrent writes.
 * The copy is created only where nothing stands ('wx'), so an entry a repository
 * planted at its name — a symbolic link among them — is never written through
 * (D-CLI-NO-SYMLINK) and, not being this run's, is left where it is; the write then
 * fails and the Result says so. Once this run has created the copy, a write, close or
 * rename that fails removes it again, so a failed write leaves nothing beside the
 * config; the Result names the failure, and the copy too when it could not be removed.
 */
async function writeConfigBody(projectRoot: string, body: object): Promise<ConfigBodyWrite> {
  const configPath = getFeatureConfigPath(projectRoot);
  const tmpPath = configPath + '.tmp.' + process.pid;
  let text: string;
  let copy: FileHandle;
  try {
    text = JSON.stringify(body, null, 2) + '\n';
    await fs.mkdir(path.join(projectRoot, '.devflow'), { recursive: true });
    copy = await fs.open(tmpPath, 'wx', 0o600);
  } catch (err: unknown) {
    return { ok: false, detail: messageOf(err) };
  }
  try {
    try {
      await copy.writeFile(text, 'utf-8');
    } finally {
      await copy.close();
    }
    await fs.rename(tmpPath, configPath);
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, detail: await removeCopy(tmpPath, messageOf(err)) };
  }
}

/**
 * Remove the copy a failed config write created, and say why the write failed:
 * `detail`, followed by the removal's own failure when the copy stays. A copy that
 * is already gone counts as removed (`force`).
 */
async function removeCopy(tmpPath: string, detail: string): Promise<string> {
  try {
    await fs.rm(tmpPath, { force: true });
    return detail;
  } catch (err: unknown) {
    return `${detail}; its copy ${tmpPath} could not be removed: ${messageOf(err)}`;
  }
}

/**
 * Merge devflow's managed keys over the config body the file already holds.
 * Pure — returns a new object and never mutates `existing`.
 *
 * D-CONFIG-PRESERVE-UNMANAGED: `.devflow/config.json` is a
 * user-editable file that devflow only PARTLY owns. The managed keys come from
 * `managed`; every other key comes from the file, verbatim and by key presence
 * — the hand-written per-repo `tracker` override (whose invalid values must
 * survive so their DEGRADED report can name them) and any key devflow does not
 * know. The alternative, writing the declared shape, is a silent delete of all
 * of them on every `devflow init`. Every writer of the file goes through here
 * (writeManagedConfig, called by init). Only the managed key is copied from
 * `managed`, by name, so a caller holding a whole FeatureConfig still cannot
 * overwrite the file's override with its in-memory copy. The retired keys in
 * RETIRED_CONFIG_KEYS are dropped, not carried. A body that is
 * not a JSON object reads as empty, exactly as readConfigIfPresent treats it;
 * writeManagedConfig never reaches here with a malformed file.
 *
 * This holds under `devflow init --reset` too: a factory reset returns
 * devflow's own settings to their defaults through `managed`, and leaves the
 * keys devflow never wrote alone.
 */
export function mergeManagedConfig(existing: unknown, managed: ManagedConfig): Record<string, unknown> {
  const fileKeys = isJsonObject(existing)
    ? Object.fromEntries(Object.entries(existing).filter(([key]) => !RETIRED_CONFIG_KEYS.has(key)))
    : {};
  return {
    ...fileKeys,
    reviewPublication: managed.reviewPublication,
  };
}

/** Why writeManagedConfig left the file alone. */
export type ManagedConfigWriteError =
  | { readonly kind: 'malformed'; readonly path: string }
  | { readonly kind: 'unreadable'; readonly path: string; readonly detail: string }
  | { readonly kind: 'write-failed'; readonly path: string; readonly detail: string };

export type ManagedConfigWrite =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ManagedConfigWriteError };

/**
 * Write devflow's managed keys to a project's config, keeping every key it
 * does not manage (D-CONFIG-PRESERVE-UNMANAGED). Never throws.
 *
 * D-CONFIG-NO-REPAIR: a file that exists but is malformed or unreadable
 * (D-CONFIG-STRICT-PARSE) is left byte-for-byte as it is, and the Result says
 * why. The file is the user's: a syntax error in it still holds their
 * hand-written keys — the `tracker` override first among them — and a rewrite
 * from an empty merge would delete them silently. The resolvers fail its keys
 * closed meanwhile, so leaving it costs nothing but the managed key.
 *
 * D1: Non-atomic read-modify-write. A concurrent writer could lose the other's
 * change. Acceptable because init is a single-threaded, user-initiated command
 * and the window is milliseconds on a local filesystem; the file swap itself is
 * atomic (temp + rename), so a reader never sees a partial file.
 *
 * D-CLI-NO-SYMLINK (firstSymbolicLink): a `.devflow` that is a symbolic link is
 * left alone, and the Result says so; the file is neither read nor written there.
 */
export async function writeManagedConfig(
  projectRoot: string,
  managed: ManagedConfig,
  lib: ProjectConfigLibLoad = loadProjectConfigLib(),
): Promise<ManagedConfigWrite> {
  const configPath = getFeatureConfigPath(projectRoot);
  let linked: string | null;
  try {
    linked = await firstSymbolicLink([path.dirname(configPath)]);
  } catch (err: unknown) {
    return { ok: false, error: { kind: 'unreadable', path: configPath, detail: messageOf(err) } };
  }
  if (linked !== null) {
    return { ok: false, error: { kind: 'unreadable', path: configPath, detail: `${linked} is a symbolic link, and devflow writes nothing through one` } };
  }
  const existing = await readConfigBody(projectRoot, lib);
  if (existing.kind === 'malformed') return { ok: false, error: { kind: 'malformed', path: configPath } };
  if (existing.kind === 'unreadable') {
    return { ok: false, error: { kind: 'unreadable', path: configPath, detail: existing.detail } };
  }
  const written = await writeConfigBody(projectRoot, mergeManagedConfig(objectOf(existing), managed));
  if (!written.ok) return { ok: false, error: { kind: 'write-failed', path: configPath, detail: written.detail } };
  return { ok: true };
}

/**
 * Read the per-repo config for a project root, returning null when the file
 * is absent or malformed.
 *
 * Unlike readConfig (which falls back to DEFAULT_CONFIG on any error),
 * readConfigIfPresent distinguishes "not configured yet" (null) from
 * "configured with specific values" (FeatureConfig). init relies on the
 * distinction to carry a repo's own reviewPublication across a re-init.
 */
export async function readConfigIfPresent(projectRoot: string): Promise<FeatureConfig | null> {
  // null when the file is absent, malformed or unreadable
  return coerceConfig(objectOf(await readConfigBody(projectRoot)));
}

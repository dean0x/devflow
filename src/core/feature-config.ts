import * as path from 'path';
import { promises as fs } from 'fs';
import { getFeatureConfigPath } from './project-paths.js';
import { parseTrackerId, type TrackerProvider } from './tracker.js';

export type ReviewPublication = 'auto' | 'full' | 'off';

/**
 * The parsed per-repo tracker override — THREE states, because the Git agent's
 * resolution order needs all three and no two of them mean the same thing
 * (OD-9, [DR-26]).
 *
 *   absent  — no override. The agent defers to `features.tracker.provider` in the
 *             manifest. This is NOT the same as `github`: a chosen `github` is a
 *             per-repo decision that outranks the manifest, absence defers to it.
 *   valid   — a registered provider id, byte-exact. It NARROWS: the agent honours
 *             it when it names `github` or the manifest's own provider, and
 *             reports `TRACEABILITY: DEGRADED (tracker configuration mismatch)`
 *             for any other, because the machine-wide selection is what gets a
 *             sentinel written and conventions inferred — a repo cannot elect a
 *             provider the machine never selected.
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

export interface FeatureConfig {
  memory: boolean;
  learning: boolean;
  knowledge: boolean;
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
   *   - `updateFeature` is a read-modify-write over the whole config, so the
   *     value must survive a round trip byte-for-byte or an unrelated `devflow
   *     knowledge --disable` would silently erase a user's edit — including a
   *     misspelled one, whose erasure would also erase the DEGRADED that reports
   *     it. Repair is forbidden for this value (§14.9-6: reject, never repair),
   *     and a field that coerced on read could not preserve it.
   *   - {@link parseTrackerOverride} gives a present-but-wrong-typed value its
   *     own `invalid` verdict. A `string` field would narrow the JSON before the
   *     parser ever saw it, leaving that arm reachable from a direct call and
   *     unreachable from the file a user actually edits (PF-043).
   *
   * NEVER consume this field directly — parse it with {@link parseTrackerOverride},
   * which routes through the same `parseTrackerId` the CLI boundary uses so there
   * is ONE authority on what a provider token may be (PF-023).
   */
  tracker?: unknown;
}

/**
 * The keys of FeatureConfig whose value type is boolean.
 * Used to restrict updateFeature / isFeatureEnabled to boolean-typed fields only —
 * neither reviewPublication nor the per-repo tracker override must be togglable
 * as a boolean.
 *
 * The `-?` is load-bearing, not tidying: a homomorphic mapped type PRESERVES the
 * optional modifier, so `tracker` stays optional in the mapped result and
 * indexing that result by `keyof FeatureConfig` resolves to
 * `'memory' | 'learning' | 'knowledge' | undefined`, which `updateFeature`'s
 * computed index rejects. Stripping the modifier keeps the union to real keys,
 * and any future optional field inherits the fix.
 */
export type BooleanFeature = {
  [K in keyof FeatureConfig]-?: FeatureConfig[K] extends boolean ? K : never;
}[keyof FeatureConfig];

/**
 * The keys of FeatureConfig that devflow WRITES. `tracker` is not one of them:
 * no devflow command sets the per-repo override, it is hand-written and only
 * ever carried (see {@link mergeManagedConfig}).
 */
export type ManagedConfig = Omit<FeatureConfig, 'tracker'>;

/**
 * Keys devflow itself once wrote and has retired. A managed write drops them
 * rather than carrying them, and `decisions` is why that matters: coerceConfig
 * lets the legacy `decisions` value WIN over `learning`, so a carried
 * `decisions` would revert the learning value just written on the very next
 * read. `autoCommit` is inert — coerceConfig ignores it.
 */
const RETIRED_CONFIG_KEYS: ReadonlySet<string> = new Set(['decisions', 'autoCommit']);

export const DEFAULT_CONFIG: FeatureConfig = {
  memory: true,
  learning: true,
  knowledge: true,
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
 * Coalesces legacy `decisions` key into `learning` when both are present:
 * `decisions` wins (legacy-decisions-wins semantics; intentionally opposite to
 * manifest.ts's new-key-wins self-heal — migration-compat requires the old key
 * to take precedence so old configs with `decisions: false` are not silently
 * re-enabled by a newer `learning: true` key).
 * Silently ignores `autoCommit` — old configs may still contain it.
 *
 * Returns null when `parsed` is not a plain object (caller falls through to
 * the next candidate path).
 */
function coerceConfig(parsed: unknown): FeatureConfig | null {
  if (!isJsonObject(parsed)) return null;
  const p = parsed;

  // Coalesce decisions (legacy key) → learning. decisions wins when both present.
  let learning: boolean = DEFAULT_CONFIG.learning;
  if (typeof p.learning === 'boolean') learning = p.learning;
  if (typeof p.decisions === 'boolean') learning = p.decisions; // decisions wins

  // Coerce reviewPublication: any invalid or absent value → 'auto' (self-heal, ADR-014 idiom).
  const rp = p.reviewPublication;
  const reviewPublication: ReviewPublication =
    rp === 'auto' || rp === 'full' || rp === 'off' ? rp : 'auto';

  // The per-repo tracker override is carried through VERBATIM — never coerced,
  // never type-filtered. Three reasons, and the last two are the ones a reader is
  // likely to miss:
  //   (a) repair is forbidden for a provider value (§14.9-6), so there is no
  //       healed value to fall back to the way reviewPublication has 'auto';
  //   (b) coerceConfig feeds updateFeature's read-modify-write, so a value
  //       dropped here is a value DELETED from the file on the next unrelated
  //       toggle — erasing both the user's edit and the DEGRADED that reports it;
  //   (c) a non-string is a state parseTrackerOverride CLASSIFIES (`invalid`),
  //       not a state this function repairs. Filtering by type here would leave
  //       that arm reachable from a direct call to the parser and unreachable
  //       from the file, which is the only place it can actually be written.
  // Key PRESENCE is the whole rule: a present key is carried as written, and an
  // absent one stays absent on disk. `hasOwnProperty` rather than `in` because
  // the object comes from JSON.parse at a trust boundary.
  const hasTracker = Object.prototype.hasOwnProperty.call(p, 'tracker');

  return {
    memory: typeof p.memory === 'boolean' ? p.memory : DEFAULT_CONFIG.memory,
    learning,
    knowledge: typeof p.knowledge === 'boolean' ? p.knowledge : DEFAULT_CONFIG.knowledge,
    reviewPublication,
    ...(hasTracker ? { tracker: p.tracker } : {}),
  };
}

/**
 * Read the feature config for a project root.
 * Returns DEFAULT_CONFIG when the file is missing or unreadable.
 * Applies ADR-001: .devflow/config.json is the sole source of truth;
 * `devflow init` writes it directly on first install. An absent file falls
 * through to DEFAULT_CONFIG (all features enabled by default).
 */
export async function readConfig(projectRoot: string): Promise<FeatureConfig> {
  return coerceConfig(await readConfigBody(projectRoot)) ?? { ...DEFAULT_CONFIG };
}

/**
 * The parsed JSON body of a project's config file, or `undefined` when the file
 * is absent, unreadable or malformed. Every read of the file goes through here,
 * so readConfig, readConfigIfPresent and writeManagedConfig agree on what an
 * unusable file means.
 */
async function readConfigBody(projectRoot: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(getFeatureConfigPath(projectRoot), 'utf-8'));
  } catch {
    // ENOENT (absent) or SyntaxError (malformed) — treat as not present
    return undefined;
  }
}

/**
 * Serialise a config body to a project's config file.
 * Creates the .devflow/ directory if missing.
 * Uses an atomic temp+rename pattern to prevent partial reads under concurrent writes.
 */
async function writeConfigBody(projectRoot: string, body: object): Promise<void> {
  const configPath = getFeatureConfigPath(projectRoot);
  await fs.mkdir(path.join(projectRoot, '.devflow'), { recursive: true });
  const tmpPath = configPath + '.tmp.' + process.pid;
  await fs.writeFile(tmpPath, JSON.stringify(body, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  await fs.rename(tmpPath, configPath);
}

/**
 * Write the feature config for a project root — the whole file, exactly the
 * declared shape. Callers that own only part of the file use
 * {@link writeManagedConfig} instead.
 */
export async function writeConfig(projectRoot: string, config: FeatureConfig): Promise<void> {
  await writeConfigBody(projectRoot, config);
}

/**
 * Merge devflow's managed keys over the config body the file already holds.
 * Pure — returns a new object and never mutates `existing`.
 *
 * D-CONFIG-PRESERVE-UNMANAGED (avoids PF-071): `.devflow/config.json` is a
 * user-editable file that devflow only PARTLY owns. The managed keys come from
 * `managed`; every other key comes from the file, verbatim and by key presence
 * — the hand-written per-repo `tracker` override (whose invalid values must
 * survive so their DEGRADED report can name them) and any key devflow does not
 * know. The alternative, writing the declared shape, is a silent delete of all
 * of them on every `devflow init`. Only the four managed keys are copied from
 * `managed`, by name, so a caller holding a whole FeatureConfig still cannot
 * overwrite the file's override with its in-memory copy. The retired keys in
 * RETIRED_CONFIG_KEYS are dropped, not carried. A body that is not a JSON
 * object (absent, malformed, an array) reads as empty, exactly as
 * readConfigIfPresent treats it.
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
    memory: managed.memory,
    learning: managed.learning,
    knowledge: managed.knowledge,
    reviewPublication: managed.reviewPublication,
  };
}

/**
 * Write devflow's managed keys to a project's config, keeping every key it
 * does not manage (D-CONFIG-PRESERVE-UNMANAGED). A read-modify-write under the
 * same concurrency assumption as updateFeature (D1).
 */
export async function writeManagedConfig(projectRoot: string, managed: ManagedConfig): Promise<void> {
  const existing = await readConfigBody(projectRoot);
  await writeConfigBody(projectRoot, mergeManagedConfig(existing, managed));
}

/**
 * Toggle a single feature in the feature config.
 * Reads current config, applies the change, and writes back.
 *
 * D1: Non-atomic read-modify-write. Concurrent invocations of `updateFeature`
 * could lose each other's writes. Acceptable here because: (a) devflow CLI
 * commands are single-threaded user-initiated actions, and (b) the window is
 * milliseconds on a local filesystem with no concurrent writers in normal use.
 * If concurrent safety is ever required, replace with an atomic file-swap or
 * a lock file.
 */
export async function updateFeature(
  projectRoot: string,
  feature: BooleanFeature,
  enabled: boolean,
): Promise<void> {
  const config = await readConfig(projectRoot);
  await writeConfig(projectRoot, { ...config, [feature]: enabled });
}

/**
 * Check whether a specific feature is enabled for the given project root.
 */
export async function isFeatureEnabled(
  projectRoot: string,
  feature: BooleanFeature,
): Promise<boolean> {
  const config = await readConfig(projectRoot);
  return config[feature];
}

/**
 * Read the feature config for a project root, returning null when the file
 * is absent or malformed.
 *
 * Unlike readConfig (which falls back to DEFAULT_CONFIG on any error),
 * readConfigIfPresent distinguishes "not configured yet" (null) from
 * "configured with specific values" (FeatureConfig).  The distinction
 * matters for init-seed resolution: a present config overrides the
 * manifest for memory/learning/knowledge even when the manifest is absent.
 *
 * Applies ADR-001: .devflow/config.json is the source of truth; null means
 * the config file does not exist or is unreadable — not that all features
 * are disabled.
 */
export async function readConfigIfPresent(projectRoot: string): Promise<FeatureConfig | null> {
  // null when the file is absent or malformed, or its JSON is not a plain object
  return coerceConfig(await readConfigBody(projectRoot));
}

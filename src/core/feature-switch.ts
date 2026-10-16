import { promises as fs } from 'fs';
import * as path from 'path';
import { writeFileAtomicExclusive } from './fs-atomic.js';

/**
 * The features that are switched on or off for the WHOLE MACHINE, and that a
 * repository may only narrow.
 *
 * D-FEATURES-NARROW-ONLY (#392, superseding the machine-only rule of #378):
 * `features.memory`, `features.curation` and `features.knowledge` in
 * `~/.devflow/manifest.json` are the MACHINE switch — `devflow init` and
 * `devflow memory|curation|knowledge --enable/--disable` write that one value,
 * and {@link readMachineFeature} reads it. The curation switch is stored under
 * TWO current keys, `features.curation` and its pre-rename copy `features.learning`
 * (a 3.7.0 CLI still reads only the copy): every write sets both to the same value,
 * and a false in either key turns the switch off (see {@link isMachineFeatureOn}).
 * A repository adds two layers that can only turn a feature OFF, never on:
 *
 *   effective = machine AND project.json `features.<name>` AND config.json `features.<name>`
 *
 * where only a literal `false` narrows — absent, malformed and unreadable values
 * leave the machine switch deciding. A repository file narrows the curation
 * switch through `features.curation` or `features.learning`: a literal `false`
 * in either key turns it off, and each key is parsed on its own. (An unreadable
 * repository file also fails the settings line closed, so commands read
 * `KNOWLEDGE=off` from it; the hooks never read that line, and for them it
 * narrows nothing.) The team-committed `.devflow/project.json` and the
 * personal `.devflow/config.json` are both parsed by the shared
 * lib/project-config.cjs, and the fold lives in
 * resolve-settings.cjs (`MEMORY=`/`CURATION=`/`KNOWLEDGE=` on its settings
 * line); the CLI's `--status` prints the effective state only when a repo layer
 * narrows it, or an unreadable repo file closes it. No repo layer can
 * re-enable what the machine turned off, so the #378 split — a repo that kept a
 * feature running after the user switched it off — cannot come back.
 *
 * `features` is a NEW namespace. The per-repo top-level keys of the
 * per-repo-install era (`memory`, `learning`, `knowledge`, `decisions`) stay
 * retired (RETIRED_CONFIG_KEYS in feature-config.ts): no reader consults them,
 * so a stale `learning: false` left in an old config.json never comes back to
 * life as a switch.
 */
export type MachineFeature = 'memory' | 'curation' | 'knowledge';

/**
 * Machine switches that are OPT-IN: off until the user turns them on.
 *
 * D-BEHAVIOR-OPT-IN: `features.behavior` in `~/.devflow/manifest.json` is the machine
 * switch for the behavior rule. It lives beside the {@link MachineFeature} switches and
 * shares their one write point, but it reads the opposite way: the three switches above
 * read an absent key as ON (every install predates them, and each gates a running
 * feature), while this one reads an absent key as OFF (no install has the rule until
 * `devflow init --behavior` or `devflow behavior --enable` asks for it). Only an
 * explicit boolean `true` turns it on. A repository layer cannot widen it, and there is
 * nothing to narrow: it gates a file on this machine, not a runtime feature.
 */
export type OptInMachineFeature = 'behavior';

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Why a machine-wide switch could not be written. */
export type MachineFeatureWriteError =
  /** No usable manifest: devflow is not installed on this machine (`devflow init`). */
  | 'not-installed';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The keys a RAW manifest may hold a machine feature under, current names first.
 *
 * `curation` is stored under two current keys, `curation` and `learning`: the
 * feature was renamed, and a manifest written before the rename holds only
 * `learning`. No precedence rule exists between the two (see
 * {@link isMachineFeatureOn}); every write sets both. `memory` and `knowledge`
 * have one current key.
 */
const CURRENT_KEYS: Readonly<Record<MachineFeature, readonly string[]>> = {
  memory: ['memory'],
  curation: ['curation', 'learning'],
  knowledge: ['knowledge'],
};

/**
 * The pre-rename key each machine feature was stored under, where one exists:
 * `curation` was `decisions` and `knowledge` was `kb`. A manifest no
 * command has rewritten since the rename can still hold only the legacy key.
 * `memory` was never renamed.
 */
const LEGACY_KEYS: Readonly<Partial<Record<MachineFeature, string>>> = {
  curation: 'decisions',
  knowledge: 'kb',
};

/**
 * The keys a write sets for `feature`: the feature's own key, and for `curation` its
 * pre-rename copy too (the manifest mirror). Opt-in switches have one key.
 */
function writtenKeys(feature: MachineFeature | OptInMachineFeature): readonly string[] {
  return feature === 'behavior' ? [feature] : CURRENT_KEYS[feature];
}

/**
 * Whether a RAW parsed manifest leaves `feature` switched on. Pure.
 *
 * Only an explicit boolean `false` switches a feature off. A missing key, a
 * non-boolean value, or anything that is not a manifest-shaped object reads as
 * ON — fail-open, and the exact rule `queue_read_gates` applies in the
 * shell hooks, so the CLI's status and the runtime never disagree about the
 * same file.
 *
 * The machine rule (issue #529), identical in every reader —
 * this function, resolve-settings.cjs and the shell gates:
 *   1. off when ANY current key (`curation`, `learning`) is a boolean `false`;
 *   2. else on when any current key is a boolean `true`;
 *   3. else, when neither current key is a boolean, the pre-rename key decides
 *      if it is a boolean (`decisions` for curation, `kb` for knowledge);
 *   4. else ON.
 * A non-boolean value is ignored for that key only. A disagreeing pair
 * therefore resolves to OFF: false wins, so a switch a user turned off never
 * comes back on because the other spelling still says true.
 *
 * D-LEARNING-LEGACY-DECISIONS (a sub-decision of D-FEATURES-NARROW-ONLY):
 * the legacy `features.decisions` is read only when neither current key is a
 * boolean — readManifest's migration precedence exactly. The legacy key is
 * otherwise honoured only once some command happens to run readManifest and
 * heal it, so a `decisions: false` would keep learning running until then.
 * queue_read_gates applies the same precedence.
 *
 * D-KNOWLEDGE-LEGACY-KB (the same sub-decision for the other renamed key):
 * `knowledge` is read as `features.knowledge` when that is a boolean, else the
 * legacy `features.kb` when THAT is a boolean, else ON — again readManifest's
 * precedence exactly, so `devflow knowledge --status` reports a `kb: false`
 * as disabled. queue_read_gates never reads knowledge, so there is no shell
 * mirror. The knowledge write-back prose gate deliberately does not learn the
 * legacy key (no prompt text for a state only an un-upgraded install
 * can hold); readManifest rewrites `kb` to `knowledge` on the next CLI run
 * that loads the manifest, after which that gate reads the healed key.
 *
 * Deliberately NOT built on readManifest(): it returns null for a manifest
 * missing any of its required fields — reported as "on" here, as the hooks read
 * it — and it writes its heals back to disk, which a read-only status must not.
 */
export function isMachineFeatureOn(rawManifest: unknown, feature: MachineFeature): boolean {
  if (!isJsonObject(rawManifest)) return true;
  const features = rawManifest.features;
  if (!isJsonObject(features)) return true;
  const current = CURRENT_KEYS[feature]
    .map((key) => features[key])
    .filter((value): value is boolean => typeof value === 'boolean');
  if (current.length > 0) return !current.includes(false);
  const legacyKey = LEGACY_KEYS[feature];
  return legacyKey === undefined || features[legacyKey] !== false;
}

/**
 * Set `feature` in a RAW parsed manifest. Pure — returns a new object and never
 * mutates its input. Null when the value is not a manifest-shaped object (there
 * is no `features` record to write into).
 *
 * Only `features.<feature>` and `updatedAt` change; every other key is carried
 * verbatim. Writing `curation` sets BOTH current keys (`curation` and its
 * pre-rename copy `learning`) to the one value, so a disagreeing pair is
 * overwritten, never carried. It leaves a legacy `decisions` key in place, and
 * writing `knowledge` a legacy `kb` key, inert: the boolean just written wins
 * over it (D-LEARNING-LEGACY-DECISIONS, D-KNOWLEDGE-LEGACY-KB). Going through
 * readManifest()/writeManifest() instead would refuse a manifest that reader
 * rejects, drop every key ManifestData does not model (one a newer devflow
 * wrote, say), and persist that reader's unrelated heals as a side effect of a
 * one-key toggle.
 */
export function setMachineFeature(
  rawManifest: unknown,
  feature: MachineFeature | OptInMachineFeature,
  enabled: boolean,
  now: string,
): Record<string, unknown> | null {
  if (!isJsonObject(rawManifest) || !isJsonObject(rawManifest.features)) return null;
  const written: Record<string, boolean> = {};
  for (const key of writtenKeys(feature)) written[key] = enabled;
  return {
    ...rawManifest,
    features: { ...rawManifest.features, ...written },
    updatedAt: now,
  };
}

/**
 * Whether a RAW parsed manifest already records `feature` as exactly `enabled`:
 * every key a write sets (`writtenKeys`) is that boolean. Pure. Stricter than
 * {@link isMachineFeatureOn} on purpose — an absent key, a non-boolean value and
 * a legacy key all read as a state without being recorded as it, and for
 * `curation` a disagreeing pair, or one key alone, is a copy that disagrees or is
 * missing: not recorded, so the write that follows puts both keys right.
 */
function isMachineFeatureRecorded(
  rawManifest: unknown,
  feature: MachineFeature | OptInMachineFeature,
  enabled: boolean,
): boolean {
  if (!isJsonObject(rawManifest) || !isJsonObject(rawManifest.features)) return false;
  const features = rawManifest.features;
  return writtenKeys(feature).every((key) => features[key] === enabled);
}

async function readRawManifest(devflowDir: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8'));
  } catch {
    // ENOENT, EACCES or SyntaxError — no usable manifest.
    return undefined;
  }
}

/**
 * Read the machine-wide switch from `<devflowDir>/manifest.json`. Read-only (no
 * heal write); an absent, unreadable or malformed manifest reads as ON.
 */
export async function readMachineFeature(devflowDir: string, feature: MachineFeature): Promise<boolean> {
  return isMachineFeatureOn(await readRawManifest(devflowDir), feature);
}

/**
 * Whether a RAW parsed manifest has an opt-in `feature` switched on. Pure.
 *
 * D-BEHAVIOR-OPT-IN: only an explicit boolean `true` is on. A missing key, a
 * non-boolean value, a manifest without a `features` record and anything that is not an
 * object all read as OFF — fail-closed, the mirror of {@link isMachineFeatureOn}. Like
 * that reader it is deliberately not built on readManifest(): a read-only status must
 * not heal-write, and a manifest missing a required field is still a manifest here.
 */
export function isOptInFeatureOn(rawManifest: unknown, feature: OptInMachineFeature): boolean {
  if (!isJsonObject(rawManifest) || !isJsonObject(rawManifest.features)) return false;
  return rawManifest.features[feature] === true;
}

/**
 * Read an opt-in machine switch from `<devflowDir>/manifest.json`. Read-only (no heal
 * write); an absent, unreadable or malformed manifest reads as OFF.
 */
export async function readOptInFeature(devflowDir: string, feature: OptInMachineFeature): Promise<boolean> {
  return isOptInFeatureOn(await readRawManifest(devflowDir), feature);
}

/**
 * Write the machine-wide switch to `<devflowDir>/manifest.json` (atomic
 * temp + rename). Refuses with `not-installed` when there is no manifest to
 * write into — a manifest is created by `devflow init`, never by a toggle,
 * because a bare `{features: {...}}` file is not a manifest any reader accepts.
 *
 * D-NOOP-TOGGLE: a toggle to the value the manifest already records writes
 * nothing. The only bytes such a write could change are `updatedAt`, and that
 * field means "the manifest's content last changed", so a no-op must not move
 * it. This is the one write point of `devflow memory|learning|knowledge|behavior
 * --enable/--disable`, so the rule holds for all four at once.
 */
export async function writeMachineFeature(
  devflowDir: string,
  feature: MachineFeature | OptInMachineFeature,
  enabled: boolean,
): Promise<Result<void, MachineFeatureWriteError>> {
  const raw = await readRawManifest(devflowDir);
  if (isMachineFeatureRecorded(raw, feature, enabled)) return { ok: true, value: undefined };
  const next = setMachineFeature(raw, feature, enabled, new Date().toISOString());
  if (next === null) return { ok: false, error: 'not-installed' };
  await writeFileAtomicExclusive(path.join(devflowDir, 'manifest.json'), JSON.stringify(next, null, 2) + '\n');
  return { ok: true, value: undefined };
}

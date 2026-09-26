import { promises as fs } from 'fs';
import * as path from 'path';
import { writeFileAtomicExclusive } from './fs-atomic.js';

/**
 * The features that are switched on or off for the WHOLE MACHINE.
 *
 * D-FEATURES-MACHINE-WIDE (#378): `features.memory`, `features.learning` and
 * `features.knowledge` in `~/.devflow/manifest.json` are the single source of
 * truth for these three features, in every repository and every non-git cwd.
 * `devflow init` and `devflow memory|learning|knowledge --enable/--disable` both
 * write that one value; every runtime gate reads it — the shell hooks through
 * `queue_read_gates` (queue-append), the knowledge write-back step through the
 * `knowledge_writeback` partial, and the CLI's `--status` through
 * {@link readMachineFeature}.
 *
 * There is no per-repo layer. Per-repo feature toggles were a leftover of the
 * per-repo-install era, and the split they created is what #378 reported: init
 * recorded "off" in the manifest while every other repo, reading its own
 * `.devflow/config.json`, kept the feature running. The per-repo keys are retired
 * (RETIRED_CONFIG_KEYS in feature-config.ts): no gate reads them and init's next
 * config write drops them. `.devflow/config.json` holds only facts about a repo.
 */
export type MachineFeature = 'memory' | 'learning' | 'knowledge';

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Why a machine-wide switch could not be written. */
export type MachineFeatureWriteError =
  /** No usable manifest: devflow is not installed on this machine (`devflow init`). */
  | 'not-installed';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The pre-rename key `learning` was stored under (ADR-011). A manifest no
 * command has rewritten since the rename can still hold only this key.
 */
const LEGACY_LEARNING_KEY = 'decisions';

/**
 * Whether a RAW parsed manifest leaves `feature` switched on. Pure.
 *
 * Only an explicit boolean `false` switches a feature off. A missing key, a
 * non-boolean value, or anything that is not a manifest-shaped object reads as
 * ON — fail-open (ADR-028), and the exact rule `queue_read_gates` applies in the
 * shell hooks, so the CLI's status and the runtime never disagree about the
 * same file.
 *
 * D-LEARNING-LEGACY-DECISIONS (a sub-decision of D-FEATURES-MACHINE-WIDE):
 * `learning` is read as `features.learning` when that is a boolean, else the
 * legacy `features.decisions` when THAT is a boolean, else ON — readManifest's
 * migration precedence exactly. The legacy key is otherwise honoured only once
 * some command happens to run readManifest and heal it, so a `decisions: false`
 * would keep learning running until then. queue_read_gates applies the same
 * precedence.
 *
 * Deliberately NOT built on readManifest(): it returns null for a manifest
 * missing any of its required fields — reported as "on" here, as the hooks read
 * it — and it writes its heals back to disk, which a read-only status must not.
 */
export function isMachineFeatureOn(rawManifest: unknown, feature: MachineFeature): boolean {
  if (!isJsonObject(rawManifest)) return true;
  const features = rawManifest.features;
  if (!isJsonObject(features)) return true;
  const value = feature === 'learning' && typeof features.learning !== 'boolean'
    ? features[LEGACY_LEARNING_KEY]
    : features[feature];
  return value !== false;
}

/**
 * Set `feature` in a RAW parsed manifest. Pure — returns a new object and never
 * mutates its input. Null when the value is not a manifest-shaped object (there
 * is no `features` record to write into).
 *
 * Only `features.<feature>` and `updatedAt` change; every other key is carried
 * verbatim. Writing `learning` leaves a legacy `decisions` key in place, inert:
 * a boolean `learning` wins over it (D-LEARNING-LEGACY-DECISIONS). Going through
 * readManifest()/writeManifest() instead would refuse a manifest that reader
 * rejects, drop every key ManifestData does not model (one a newer devflow
 * wrote, say), and persist that reader's unrelated heals as a side effect of a
 * one-key toggle.
 */
export function setMachineFeature(
  rawManifest: unknown,
  feature: MachineFeature,
  enabled: boolean,
  now: string,
): Record<string, unknown> | null {
  if (!isJsonObject(rawManifest) || !isJsonObject(rawManifest.features)) return null;
  return {
    ...rawManifest,
    features: { ...rawManifest.features, [feature]: enabled },
    updatedAt: now,
  };
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
 * Write the machine-wide switch to `<devflowDir>/manifest.json` (atomic
 * temp + rename). Refuses with `not-installed` when there is no manifest to
 * write into — a manifest is created by `devflow init`, never by a toggle,
 * because a bare `{features: {...}}` file is not a manifest any reader accepts.
 */
export async function writeMachineFeature(
  devflowDir: string,
  feature: MachineFeature,
  enabled: boolean,
): Promise<Result<void, MachineFeatureWriteError>> {
  const next = setMachineFeature(await readRawManifest(devflowDir), feature, enabled, new Date().toISOString());
  if (next === null) return { ok: false, error: 'not-installed' };
  await writeFileAtomicExclusive(path.join(devflowDir, 'manifest.json'), JSON.stringify(next, null, 2) + '\n');
  return { ok: true, value: undefined };
}

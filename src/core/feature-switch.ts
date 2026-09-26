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
 * Whether a RAW parsed manifest leaves `feature` switched on. Pure.
 *
 * Only an explicit boolean `false` switches a feature off. A missing key, a
 * non-boolean value, or anything that is not a manifest-shaped object reads as
 * ON — fail-open (ADR-028), and the exact rule `queue_read_gates` applies in the
 * shell hooks, so the CLI's status and the runtime never disagree about the
 * same file.
 *
 * Deliberately NOT built on readManifest(): that reader heals an absent
 * `learning`/`knowledge` key to `false` (and returns null for a manifest missing
 * other fields), which would report a feature off on a file the hooks read as on.
 */
export function isMachineFeatureOn(rawManifest: unknown, feature: MachineFeature): boolean {
  if (!isJsonObject(rawManifest)) return true;
  const features = rawManifest.features;
  if (!isJsonObject(features)) return true;
  return features[feature] !== false;
}

/**
 * Set `feature` in a RAW parsed manifest. Pure — returns a new object and never
 * mutates its input. Null when the value is not a manifest-shaped object (there
 * is no `features` record to write into).
 *
 * Only `features.<feature>` and `updatedAt` change; every other key is carried
 * verbatim. Going through readManifest()/writeManifest() instead would persist
 * that reader's heals — an absent `learning` key written back as `false` —
 * so switching memory on could silently switch learning off.
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

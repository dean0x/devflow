import { promises as fs } from 'fs';
import * as path from 'path';
import { isFeatureEnabled } from './feature-config.js';

/**
 * The features whose manifest value is a MACHINE-WIDE MASTER SWITCH over the
 * per-repo `.devflow/config.json` value.
 *
 * D-LEARNING-MASTER-SWITCH / D-KNOWLEDGE-MASTER-SWITCH (#378): `devflow init`
 * records its learning/knowledge choice in `~/.devflow/manifest.json`, but it
 * can only write `.devflow/config.json` for the one repo it runs in. When the
 * runtime gates read the repo config alone, turning a feature off via init
 * disabled it in exactly that repo and left it running everywhere else. The
 * manifest value is therefore a master switch: a feature is effective in a repo
 * iff the manifest does not switch it off AND the repo config does not turn it
 * off. `devflow learning|knowledge --enable/--disable` stay per-repo and never
 * write the manifest; `devflow init` is the machine-wide control.
 *
 * Memory is deliberately NOT here: init removes the memory hooks machine-wide,
 * so its runtime is already off everywhere when init turns it off.
 */
export type MachineSwitchFeature = 'learning' | 'knowledge';

/** A feature's three states in one repo: the two switches and their AND. */
export interface FeatureSwitchState {
  /** `features.<x>` in the manifest is not an explicit `false`. */
  readonly machineWide: boolean;
  /** The repo's `.devflow/config.json` value (enabled when absent). */
  readonly repo: boolean;
  /** `machineWide && repo` — what the runtime gates act on. */
  readonly effective: boolean;
}

/**
 * Whether a RAW parsed manifest leaves `feature` switched on. Pure.
 *
 * Only an explicit boolean `false` switches a feature off. A missing key, a
 * non-boolean value, or anything that is not a manifest-shaped object reads as
 * ON — the fail-open semantics the repo config default already has, and the
 * exact rule `queue_read_gates` applies in the shell hooks, so the CLI's status
 * and the runtime can never disagree about the same file.
 *
 * Deliberately NOT built on readManifest(): that reader heals an absent
 * `learning`/`knowledge` key to `false` (and returns null for a manifest missing
 * other fields), which would switch a feature off on a file the hooks read as on.
 */
export function isMachineSwitchOn(rawManifest: unknown, feature: MachineSwitchFeature): boolean {
  if (typeof rawManifest !== 'object' || rawManifest === null || Array.isArray(rawManifest)) return true;
  const features = (rawManifest as Record<string, unknown>).features;
  if (typeof features !== 'object' || features === null || Array.isArray(features)) return true;
  return (features as Record<string, unknown>)[feature] !== false;
}

/**
 * The status lines for a feature under the machine-wide switch. Pure. The first
 * line is the EFFECTIVE state — what the runtime gates act on — and the two that
 * follow name which switch decided it and the command that owns each, so a
 * "disabled" is never left unexplained.
 */
export function formatFeatureSwitchLines(
  label: string,
  state: FeatureSwitchState,
  owners: { readonly machineWide: string; readonly repo: string },
): string[] {
  const onOff = (on: boolean): string => (on ? 'on' : 'off');
  return [
    `${label}: ${state.effective ? 'enabled' : 'disabled'}`,
    `  Machine-wide: ${onOff(state.machineWide)} (${owners.machineWide})`,
    `  This project: ${onOff(state.repo)} (${owners.repo})`,
  ];
}

/** Combine the two switches. Pure. */
export function combineFeatureSwitch(machineWide: boolean, repo: boolean): FeatureSwitchState {
  return { machineWide, repo, effective: machineWide && repo };
}

/**
 * Read the machine-wide switch from `<devflowDir>/manifest.json`. Read-only (no
 * heal write); an absent, unreadable or malformed manifest reads as ON.
 */
export async function readMachineSwitch(devflowDir: string, feature: MachineSwitchFeature): Promise<boolean> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8'));
    return isMachineSwitchOn(raw, feature);
  } catch {
    // ENOENT, EACCES or SyntaxError — fail-open, as the hooks do.
    return true;
  }
}

/** Read both switches for `feature` in the repo rooted at `projectRoot`. */
export async function readFeatureSwitchState(
  devflowDir: string,
  projectRoot: string,
  feature: MachineSwitchFeature,
): Promise<FeatureSwitchState> {
  const [machineWide, repo] = await Promise.all([
    readMachineSwitch(devflowDir, feature),
    isFeatureEnabled(projectRoot, feature),
  ]);
  return combineFeatureSwitch(machineWide, repo);
}

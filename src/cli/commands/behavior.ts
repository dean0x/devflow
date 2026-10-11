/**
 * devflow behavior — the opt-in behavior rule.
 *
 * D-BEHAVIOR-OPT-IN: the behavior rule (src/assets/rules/behavior.md) is feature-owned and
 * OFF by default. `--enable` and `--disable` write the machine switch,
 * `features.behavior` in ~/.devflow/manifest.json — the same value `devflow init
 * --behavior / --no-behavior` writes — and converge the installed rule file at once, so
 * the file is present exactly when the switch is on and the install includes rules.
 * `--status` reports the switch and whether the file is installed; it reads the
 * manifest raw and writes nothing.
 *
 * The core (runBehaviorSwitch) returns a Result and prints nothing; the command action
 * renders it. That keeps the business logic free of throws and of terminal output.
 */
import { Command } from 'commander';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { promises as fs } from 'fs';
import { getClaudeDirectory, getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import { readOptInFeature, writeMachineFeature } from '../../core/feature-switch.js';
import { readManifest } from '../../core/manifest.js';
import { behaviorRulePath, convergeBehaviorRule } from '../../targets/claude-code/behavior-install.js';

export type BehaviorAction = 'enable' | 'disable' | 'status';

export interface BehaviorSwitchState {
  /** The machine switch, `features.behavior`. */
  enabled: boolean;
  /** Whether the rule file is installed after this run. */
  installed: boolean;
  /** Whether the install includes rules. Set by enable and disable, which read the manifest. */
  rulesEnabled?: boolean;
  /** Warnings from the convergence, in order. */
  warnings: string[];
}

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply one `devflow behavior` action. Never throws.
 *
 * enable / disable → record the switch, then converge the rule file. A relative or
 * missing manifest is `not-installed`: a toggle never creates a manifest.
 * status → read the switch and the file; nothing is written, and a machine without
 * devflow reads as off and not installed.
 */
export async function runBehaviorSwitch(opts: {
  action: BehaviorAction;
  claudeDir: string;
  devflowDir: string;
}): Promise<Result<BehaviorSwitchState, 'not-installed'>> {
  const { action, claudeDir, devflowDir } = opts;

  if (action === 'status') {
    return {
      ok: true,
      value: {
        enabled: await readOptInFeature(devflowDir, 'behavior'),
        installed: await pathExists(behaviorRulePath(claudeDir)),
        warnings: [],
      },
    };
  }

  const enabled = action === 'enable';
  const recorded = await writeMachineFeature(devflowDir, 'behavior', enabled);
  if (!recorded.ok) return { ok: false, error: recorded.error };

  // The manifest is the authority on whether the install includes rules. One that
  // readManifest cannot validate still took the write above; rules default to on, the
  // registry default, and the next `devflow init` repairs the rest.
  const manifest = await readManifest(devflowDir);
  const rulesEnabled = manifest?.features.rules ?? true;

  const warnings: string[] = [];
  const converged = await convergeBehaviorRule({
    claudeDir,
    devflowDir,
    enabled,
    rulesEnabled,
    warn: (msg) => { warnings.push(msg); },
  });

  return { ok: true, value: { enabled, installed: converged.installed, rulesEnabled, warnings } };
}

/** Render a runBehaviorSwitch result for the terminal. */
function render(action: BehaviorAction, result: Awaited<ReturnType<typeof runBehaviorSwitch>>, claudeDir: string): void {
  if (!result.ok) {
    p.log.error(`Devflow is not installed on this machine — run ${color.cyan('devflow init')} first`);
    process.exitCode = 1;
    return;
  }
  const { enabled, installed, rulesEnabled, warnings } = result.value;
  const file = behaviorRulePath(claudeDir);
  for (const warning of warnings) p.log.warn(warning);

  if (action === 'status') {
    p.log.info(`Status: ${enabled ? color.green('enabled') : color.yellow('disabled')}`);
    p.log.info(`Rule file: ${installed ? `installed (${color.dim(file)})` : 'not installed'}`);
    if (enabled && !installed) {
      p.log.info(`The rule installs when rules are enabled — run ${color.cyan('devflow rules --enable')}`);
    }
    if (!enabled && installed) {
      p.log.warn(`The rule file is present while the switch is off — run ${color.cyan('devflow behavior --disable')} to remove it`);
    }
    return;
  }

  if (enabled) {
    p.log.success('Behavior rule enabled');
    if (rulesEnabled === false) {
      p.log.info(`Rules are disabled, so the rule is not installed yet — run ${color.cyan('devflow rules --enable')}`);
    } else if (installed) {
      p.log.info(`Installed ${color.dim(file)}. It loads in new Claude Code sessions.`);
    }
  } else {
    p.log.success('Behavior rule disabled');
    p.log.info('The rule file is removed. It stops loading in new Claude Code sessions.');
  }
}

export const behaviorCommand = new Command('behavior')
  .description('Manage the opt-in behavior rule (replies in ASD-STE100 Simplified Technical English)')
  .option('--enable', 'Install the behavior rule on this machine (needs rules enabled)')
  .option('--disable', 'Remove the behavior rule')
  .option('--status', 'Show whether the behavior rule is on and installed')
  .action(async (options: { enable?: boolean; disable?: boolean; status?: boolean }) => {
    const action: BehaviorAction | null = options.enable ? 'enable' : options.disable ? 'disable' : options.status ? 'status' : null;
    if (action === null) {
      p.log.info('Usage: devflow behavior --enable | --disable | --status');
      return;
    }
    const claudeDir = getClaudeDirectory();
    p.intro(color.cyan(action === 'status' ? 'Behavior Rule Status' : `${action === 'enable' ? 'Enable' : 'Disable'} Behavior Rule`));
    render(action, await runBehaviorSwitch({ action, claudeDir, devflowDir: getDevFlowDirectory() }), claudeDir);
    p.outro('');
  });

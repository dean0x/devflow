/**
 * devflow tdd — the machine TDD switch.
 *
 * `features.tdd` in ~/.devflow/manifest.json decides whether the Code agent writes a failing
 * test before the code. An absent key reads as on, like `knowledge` (src/core/feature-switch.ts
 * isMachineFeatureOn); only a boolean false turns it off. The switch is MACHINE-ONLY: no
 * repository file changes it, and `devflow init` has no prompt and no flag for it. Off lets the
 * tests follow the code. The test plan, Validate and the bug-fix regression test stay.
 *
 * The core (runTddSwitch) returns a Result and prints nothing; the command action renders it.
 * That keeps the business logic free of throws and of terminal output.
 */
import { Command } from 'commander';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import { readMachineFeature, writeMachineFeature } from '../../core/feature-switch.js';

export type TddAction = 'enable' | 'disable' | 'status';

export interface TddState {
  /** The machine switch, `features.tdd`. */
  enabled: boolean;
}

export interface TddOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
}

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/**
 * The one action the flags ask for, or null when none is set. Only a boolean `true` counts
 * as a flag; more than one action is refused rather than resolved by an order.
 */
export function parseTddAction(options: TddOptions): Result<TddAction | null, 'conflicting-actions'> {
  const asked: TddAction[] = [];
  if (options.enable === true) asked.push('enable');
  if (options.disable === true) asked.push('disable');
  if (options.status === true) asked.push('status');
  if (asked.length > 1) return { ok: false, error: 'conflicting-actions' };
  return { ok: true, value: asked[0] ?? null };
}

/**
 * Apply one `devflow tdd` action. Never throws.
 *
 * enable / disable → record the switch. A missing manifest is `not-installed`: a toggle
 * never creates a manifest.
 * status → read the switch; nothing is written, and a machine without devflow reads as on.
 */
export async function runTddSwitch(opts: {
  action: TddAction;
  devflowDir: string;
}): Promise<Result<TddState, 'not-installed'>> {
  const { action, devflowDir } = opts;
  if (action === 'status') {
    return { ok: true, value: { enabled: await readMachineFeature(devflowDir, 'tdd') } };
  }
  const enabled = action === 'enable';
  const recorded = await writeMachineFeature(devflowDir, 'tdd', enabled);
  if (!recorded.ok) return { ok: false, error: recorded.error };
  return { ok: true, value: { enabled } };
}

/** Render a runTddSwitch result for the terminal. */
function render(action: TddAction, result: Awaited<ReturnType<typeof runTddSwitch>>): void {
  if (!result.ok) {
    p.log.error(`Devflow is not installed on this machine — run ${color.cyan('devflow init')} first`);
    process.exitCode = 1;
    return;
  }
  const { enabled } = result.value;
  if (action === 'status') {
    p.log.info(`Status: ${enabled ? color.green('enabled') : color.yellow('disabled')}`);
    p.log.info('A machine setting: no repository file changes it.');
    return;
  }
  if (enabled) {
    p.log.success('TDD enabled: the Code agent writes a failing test before the code');
  } else {
    p.log.success('TDD disabled: the Code agent may write tests after the code');
    p.log.info('The test plan, Validate and the bug-fix regression test stay.');
  }
}

export const tddCommand = new Command('tdd')
  .description('Manage test-first work on this machine: when off, the Code agent may write tests after the code')
  .option('--enable', 'Write a failing test before the code (the default)')
  .option('--disable', 'Let tests follow the code; the test plan and the bug-fix regression test stay')
  .option('--status', 'Show whether TDD is on')
  .action(async (options: TddOptions) => {
    const parsed = parseTddAction(options);
    if (!parsed.ok) {
      p.log.error('Choose one of --enable, --disable or --status');
      process.exitCode = 1;
      return;
    }
    const action = parsed.value;
    if (action === null) {
      p.log.info('Usage: devflow tdd --enable | --disable | --status');
      return;
    }
    p.intro(color.cyan(action === 'status' ? 'TDD Status' : `${action === 'enable' ? 'Enable' : 'Disable'} TDD`));
    render(action, await runTddSwitch({ action, devflowDir: getDevFlowDirectory() }));
    p.outro('');
  });

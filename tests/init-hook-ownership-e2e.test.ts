/**
 * End-to-end (#391, D-EXACT-HOOK-OWNER): `devflow init`, and the memory and
 * ambient toggles, touch only the hooks devflow wrote. A user's hook whose
 * command merely CONTAINS a devflow marker word — `capture-turn`,
 * `memory-worker`, `session-start-context`, `ensure-proxy`, ... — is theirs, and
 * so are the siblings of a devflow hook in a shared matcher group.
 *
 * Drives the REAL compiled CLI with HOME pinned to a temp dir through
 * `sandboxEnv` (PF-060), so the assertion is about init's actual settings pass,
 * not a test's reconstruction of it (PF-015). Requires `npm run build`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli, sandboxEnv } from './helpers.js';

const CLI = requireBuiltCli();

/** One CLI spawn under load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 60_000;
/** The test chains four spawns. */
const RUN_TIMEOUT_MS = 4 * SUBPROCESS_TIMEOUT_MS;

interface Hook { type: string; command: string; timeout?: number }
interface Group { matcher?: string; hooks: Hook[] }
type Hooks = Record<string, Group[]>;

/** A devflow install under a directory init no longer uses. */
const OLD_RUN_HOOK = '/srv/old/.devflow/scripts/hooks/run-hook';

/** User groups: every hook mentions a devflow marker word; none is devflow's. */
const USER_GROUPS: Hooks = {
  UserPromptSubmit: [{ hooks: [
    { type: 'command', command: '~/bin/capture-prompt.sh', timeout: 3 },
    { type: 'command', command: 'echo preamble ensure-proxy prompt-capture-memory >> /tmp/log' },
  ] }],
  PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: 'my-capture-question-logger' }] }],
  Stop: [{ hooks: [
    { type: 'command', command: '/opt/tools/run-hook capture-turn' },
    { type: 'command', command: '~/bin/memory-worker --beep' },
  ] }],
  SessionStart: [{ matcher: 'startup', hooks: [
    { type: 'command', command: 'my-session-start-context session-start-memory' },
    { type: 'command', command: 'echo spawn-dream-worker ensure-proxy session-start-orchestrator' },
  ] }],
  PreCompact: [{ hooks: [{ type: 'command', command: 'notify pre-compact-memory.sh' }] }],
};

/** A shared group: user siblings around a devflow hook an older install wrote. */
const SHARED_STOP: Group = { hooks: [
  { type: 'command', command: 'say before' },
  { type: 'command', command: `${OLD_RUN_HOOK} memory-worker`, timeout: 10 },
  { type: 'command', command: 'say after' },
] };
const SHARED_STOP_AFTER: Group = { hooks: [
  { type: 'command', command: 'say before' },
  { type: 'command', command: 'say after' },
] };

let tmpHome: string;
let cwd: string;

const settingsPath = (): string => path.join(tmpHome, '.claude', 'settings.json');
const runHook = (): string => path.join(tmpHome, '.devflow', 'scripts', 'hooks', 'run-hook');

function runCli(...args: string[]): string {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    cwd,
    env: sandboxEnv(tmpHome),
  });
  if (result.error) throw result.error;
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  expect(result.status, `devflow ${args.join(' ')} failed:\n${out}`).toBe(0);
  return out;
}

async function readHooks(): Promise<Hooks> {
  return (JSON.parse(await fs.readFile(settingsPath(), 'utf-8')) as { hooks?: Hooks }).hooks ?? {};
}

/** Every hook command registered on `event`. */
const commandsOn = (hooks: Hooks, event: string): string[] =>
  (hooks[event] ?? []).flatMap((group) => group.hooks.map((hook) => hook.command));

/** Each user group sits, deep-equal, in its event's array. */
function expectUserGroupsIntact(hooks: Hooks): void {
  for (const [event, groups] of Object.entries(USER_GROUPS)) {
    for (const group of groups) {
      expect(hooks[event], `${event} lost a user group`).toContainEqual(group);
    }
  }
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-hook-owner-home-'));
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'df-hook-owner-cwd-'));
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  const seeded: Hooks = { ...USER_GROUPS, Stop: [...USER_GROUPS.Stop, SHARED_STOP] };
  await fs.writeFile(settingsPath(), JSON.stringify({ hooks: seeded }, null, 2) + '\n', 'utf-8');
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
  await fs.rm(cwd, { recursive: true, force: true });
});

describe('init and the feature toggles keep user hooks that mention devflow marker words (#391)', () => {
  it('init, init --no-memory, memory --enable and ambient --disable touch only devflow\'s own hooks', async () => {
    const common = ['--recommended', '--ambient', '--no-proxy', '--security', 'none'];
    const ours = (marker: string): string => `${runHook()} ${marker}`;

    runCli('init', ...common, '--memory');
    let hooks = await readHooks();
    expectUserGroupsIntact(hooks);
    // The older install's memory-worker left the shared group; its siblings stayed, in order.
    expect(hooks.Stop).toContainEqual(SHARED_STOP_AFTER);
    expect(JSON.stringify(hooks)).not.toContain(OLD_RUN_HOOK);
    // Non-vacuity: init did register devflow's own hooks, each exactly once.
    for (const [event, marker] of [
      ['UserPromptSubmit', 'capture-prompt'], ['UserPromptSubmit', 'preamble'],
      ['PostToolUse', 'capture-question'], ['Stop', 'capture-turn'], ['Stop', 'memory-worker'],
      ['SessionStart', 'session-start-memory'], ['SessionStart', 'session-start-context'],
      ['SessionStart', 'session-start-orchestrator'], ['PreCompact', 'pre-compact-memory'],
    ] as const) {
      expect(commandsOn(hooks, event).filter((c) => c === ours(marker)), `${event} ${marker}`).toHaveLength(1);
    }

    runCli('init', ...common, '--no-memory');
    hooks = await readHooks();
    expectUserGroupsIntact(hooks);
    expect(commandsOn(hooks, 'Stop')).not.toContain(ours('memory-worker'));

    runCli('memory', '--enable');
    hooks = await readHooks();
    expectUserGroupsIntact(hooks);
    expect(commandsOn(hooks, 'Stop')).toContain(ours('memory-worker'));

    runCli('ambient', '--disable');
    hooks = await readHooks();
    expectUserGroupsIntact(hooks);
    expect(commandsOn(hooks, 'UserPromptSubmit')).not.toContain(ours('preamble'));
  }, RUN_TIMEOUT_MS);
});

import { describe, it, expect } from 'vitest';
import {
  devflowHookOwner,
  ensureHook,
  hasHook,
  removeHooks,
  runHookCommand,
  type Settings,
} from '../src/targets/claude-code/hooks.js';

/**
 * D-EXACT-HOOK-OWNER: the one ownership test every hook module shares. A hook is
 * devflow's only when its command ENDS in `/scripts/hooks/run-hook <marker>` (or a
 * named legacy ending) under any directory, and removal takes single hooks out of a
 * matcher group, dropping the group only when nothing is left in it.
 */
describe('devflowHookOwner', () => {
  const isWorker = devflowHookOwner(['memory-worker'], ['/scripts/hooks/stop-update-memory.sh']);
  const cmd = (command: unknown) => ({ type: 'command', command } as { type: string; command: string });

  it.each([
    ['the run-hook form under the default dir', '/home/u/.devflow/scripts/hooks/run-hook memory-worker'],
    ['the run-hook form under any other dir', '/opt/old/scripts/hooks/run-hook memory-worker'],
    ['a named legacy ending', '/home/u/.devflow/scripts/hooks/stop-update-memory.sh'],
    ['a Windows path', 'C:\\Users\\u\\.devflow\\scripts\\hooks\\run-hook memory-worker'],
    ['surrounding whitespace', '  /home/u/.devflow/scripts/hooks/run-hook memory-worker \n'],
  ])('owns %s', (_label, command) => {
    expect(isWorker(cmd(command))).toBe(true);
  });

  it.each([
    ['a command that merely contains the marker', 'echo memory-worker'],
    ['a user script named after the marker', '~/bin/memory-worker'],
    ['a bare run-hook outside scripts/hooks', '/opt/tools/run-hook memory-worker'],
    ['the marker with trailing arguments', '/home/u/.devflow/scripts/hooks/run-hook memory-worker --verbose'],
    ['a longer marker ending in the same word', '/home/u/.devflow/scripts/hooks/run-hook my-memory-worker'],
    ['a non-string command', 42],
    ['a missing command', undefined],
  ])('does not own %s', (_label, command) => {
    expect(isWorker(cmd(command))).toBe(false);
  });
});

describe('removeHooks / hasHook / ensureHook', () => {
  const DEVFLOW = '/home/u/.devflow';
  const ours = runHookCommand(DEVFLOW, 'capture-turn');
  const isOurs = devflowHookOwner(['capture-turn']);

  it('runHookCommand names run-hook under <devflowDir>/scripts/hooks', () => {
    expect(ours).toBe('/home/u/.devflow/scripts/hooks/run-hook capture-turn');
  });

  it('removes only the owned hook from a shared group, keeping the siblings in order', () => {
    const settings: Settings = { hooks: { Stop: [
      { hooks: [
        { type: 'command', command: 'afplay done.aiff' },
        { type: 'command', command: ours, timeout: 10 },
        { type: 'command', command: 'echo capture-turn' },
      ] },
      { hooks: [{ type: 'command', command: 'say stopped' }] },
    ] } };

    expect(removeHooks(settings, 'Stop', isOurs)).toBe(true);
    expect(settings.hooks).toEqual({ Stop: [
      { hooks: [
        { type: 'command', command: 'afplay done.aiff' },
        { type: 'command', command: 'echo capture-turn' },
      ] },
      { hooks: [{ type: 'command', command: 'say stopped' }] },
    ] });
  });

  it('drops a group only when it ends up empty, then the event and the hooks object', () => {
    const settings: Settings = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: ours }] }] } };

    expect(removeHooks(settings, 'Stop', isOurs)).toBe(true);
    expect(settings).toEqual({ model: 'opus' });
  });

  it('reports no change and leaves settings alone when nothing is owned', () => {
    const settings: Settings = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo capture-turn' }] }] } };
    const before = structuredClone(settings);

    expect(removeHooks(settings, 'Stop', isOurs)).toBe(false);
    expect(hasHook(settings, 'Stop', isOurs)).toBe(false);
    expect(settings).toEqual(before);
  });

  it('keeps a hand-edited group whose hooks is not an array instead of throwing', () => {
    const odd = { matcher: 'x', hooks: 'not-an-array' } as unknown as { hooks: [] };
    const settings: Settings = { hooks: { Stop: [odd, { hooks: [{ type: 'command', command: ours }] }] } };

    expect(removeHooks(settings, 'Stop', isOurs)).toBe(true);
    expect(settings.hooks?.Stop).toEqual([odd]);
    expect(hasHook(settings, 'Stop', isOurs)).toBe(false);
  });

  it('ensureHook appends a group only when no owned hook is present', () => {
    const settings: Settings = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo capture-turn' }] }] } };
    const entry = { hooks: [{ type: 'command', command: ours, timeout: 10 }] };

    expect(ensureHook(settings, 'Stop', isOurs, entry)).toBe(true);
    expect(ensureHook(settings, 'Stop', isOurs, entry)).toBe(false);
    expect(settings.hooks?.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'echo capture-turn' }] },
      entry,
    ]);
  });
});

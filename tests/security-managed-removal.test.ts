/**
 * removeManagedDenyList — the one managed-settings removal shared by
 * `devflow security --disable` and `devflow init --security none` (#378).
 *
 * Before, `init --security none` stripped the deny list from user settings only
 * and left the managed file, which Claude Code applies at the HIGHEST precedence,
 * while the manifest recorded `none`. The managed path is injected (a parameter,
 * never an env var — see removeManagedSettings) so these tests never touch the
 * real system file. Non-TTY throughout: vitest runs without a terminal, so the
 * sudo branch is unreachable and a permission failure must surface as `failed`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { removeManagedDenyList, describeManagedDenyRemoval } from '../src/cli/commands/security.js';
import { loadTemplateDenyEntries, DEVFLOW_HISTORICAL_DENY } from '../src/targets/claude-code/post-install.js';
import { getPackageRoot } from '../src/core/paths.js';

const ROOT = getPackageRoot();

let dir: string;
let managedPath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-managed-'));
  managedPath = path.join(dir, 'managed-settings.json');
});

afterEach(async () => {
  await fs.chmod(dir, 0o755).catch(() => undefined);
  await fs.rm(dir, { recursive: true, force: true });
});

async function templateDeny(): Promise<string[]> {
  const deny = await loadTemplateDenyEntries(ROOT);
  // Non-vacuous: the removal keys on the template, so an empty one proves nothing.
  expect(deny.length).toBeGreaterThan(0);
  return deny;
}

describe('removeManagedDenyList', () => {
  it('deletes a managed file that holds only the Devflow deny list', async () => {
    await fs.writeFile(managedPath, JSON.stringify({ permissions: { deny: await templateDeny() } }));

    const outcome = await removeManagedDenyList(ROOT, false, managedPath);

    expect(outcome).toEqual({ kind: 'removed', path: managedPath });
    expect(existsSync(managedPath)).toBe(false);
  });

  it('keeps the user\'s own managed entries and keys, removing only Devflow\'s', async () => {
    const own = 'Bash(my-own-rule *)';
    await fs.writeFile(managedPath, JSON.stringify({
      model: 'opus',
      permissions: { deny: [...await templateDeny(), own] },
    }));

    const outcome = await removeManagedDenyList(ROOT, false, managedPath);

    expect(outcome.kind).toBe('removed');
    const after = JSON.parse(await fs.readFile(managedPath, 'utf-8')) as { model: string; permissions: { deny: string[] } };
    expect(after.model).toBe('opus');
    expect(after.permissions.deny).toEqual([own]);
  });

  it('removes entries an older release shipped and the template has since retired (#399)', async () => {
    const template = await templateDeny();
    const retired = [...DEVFLOW_HISTORICAL_DENY].filter(e => !template.includes(e));
    // Non-vacuous: #399 retired the piped rules, so an install from v2.5.0 carries some.
    expect(retired).toContain('Bash(curl * | bash*)');
    await fs.writeFile(managedPath, JSON.stringify({ permissions: { deny: [...template, ...retired] } }));

    const outcome = await removeManagedDenyList(ROOT, false, managedPath);

    expect(outcome).toEqual({ kind: 'removed', path: managedPath });
    expect(existsSync(managedPath)).toBe(false);
  });

  it('reports absent — and throws nothing — when there is no managed file', async () => {
    expect(await removeManagedDenyList(ROOT, false, managedPath)).toEqual({ kind: 'absent' });
  });

  it('leaves a corrupt managed file alone rather than throwing', async () => {
    await fs.writeFile(managedPath, '{ not json');
    expect(await removeManagedDenyList(ROOT, false, managedPath)).toEqual({ kind: 'no-devflow-entries', path: managedPath });
    expect(await fs.readFile(managedPath, 'utf-8')).toBe('{ not json');
  });

  it('leaves a managed file without Devflow entries alone', async () => {
    const body = JSON.stringify({ permissions: { deny: ['Bash(unrelated *)'] } });
    await fs.writeFile(managedPath, body);
    expect((await removeManagedDenyList(ROOT, false, managedPath)).kind).toBe('no-devflow-entries');
    expect(await fs.readFile(managedPath, 'utf-8')).toBe(body);
  });

  it.skipIf(process.getuid?.() === 0)('a permission failure is the `failed` outcome, never a throw', async () => {
    await fs.writeFile(managedPath, JSON.stringify({ permissions: { deny: await templateDeny() } }));
    // A read-only directory: the delete is refused with EACCES, as the real
    // root-owned system directory refuses a non-root user.
    await fs.chmod(dir, 0o555);

    const outcome = await removeManagedDenyList(ROOT, false, managedPath);

    expect(outcome).toEqual({ kind: 'failed', path: managedPath });
    expect(existsSync(managedPath)).toBe(true);
    const msg = describeManagedDenyRemoval(outcome);
    expect(msg.level).toBe('warn');
    expect(msg.text).toContain(managedPath);
  });
});

describe('describeManagedDenyRemoval', () => {
  it('warns only for outcomes that leave something the user should act on', () => {
    expect(describeManagedDenyRemoval({ kind: 'removed', path: '/x' }).level).toBe('info');
    expect(describeManagedDenyRemoval({ kind: 'absent' }).level).toBe('info');
    expect(describeManagedDenyRemoval({ kind: 'no-devflow-entries', path: '/x' }).level).toBe('warn');
    expect(describeManagedDenyRemoval({ kind: 'failed', path: '/x' }).level).toBe('warn');
  });

  it('a failure names a remedy that is correct from both callers (init --security none and security --disable)', () => {
    const { text } = describeManagedDenyRemoval({ kind: 'failed', path: '/etc/claude-code/managed-settings.json' });
    // No self-referential "run devflow security --disable" — that may be the command that just failed.
    expect(text).not.toContain('devflow security --disable');
    // Re-run interactively (the sudo prompt needs a TTY), or remove the entries by hand at the named path.
    expect(text).toContain('interactive terminal');
    expect(text).toContain('sudo');
    expect(text).toMatch(/permissions\.deny in \/etc\/claude-code\/managed-settings\.json/);
  });
});

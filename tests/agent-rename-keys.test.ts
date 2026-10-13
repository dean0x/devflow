/**
 * The six-agent rename (Code-fix→Fix, Code-edit→Refactor, Scrutinize→Harden,
 * Simplify→Polish, Diagnose→Debug, Learning→Curate) as the config layer sees it:
 * the `canonicalise-agent-keys-v2` migration and `readAgentMapping`.
 *
 * WHY THIS IS ITS OWN FILE: the canonicalise suites in agent-models.test.ts and
 * migrations.test.ts empty the exported LEGACY_AGENT_KEYS in beforeEach and seed
 * synthetic entries, so they cannot see the shipped map. Every test here reads the
 * map as shipped and never mutates it. The registry is not consulted either: the
 * mapping layer renames keys without asking whether an agent of that name exists.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MIGRATIONS, readAppliedMigrations, runMigrations } from '../src/core/migrations.js';
import {
  LEGACY_AGENT_KEYS,
  canonicaliseAgentKeys,
  readAgentMapping,
} from '../src/core/agent-models.js';

const V1 = 'canonicalise-agent-keys-v1';
const V2 = 'canonicalise-agent-keys-v2';

/** The six agents renamed by this change: old slug, new slug. */
const SIX_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ['code-fix', 'fix'],
  ['code-edit', 'refactor'],
  ['scrutinize', 'harden'],
  ['simplify', 'polish'],
  ['diagnose', 'debug'],
  ['learning', 'curate'],
];

describe('the six renamed agents in the shipped LEGACY_AGENT_KEYS', () => {
  it.each(SIX_RENAMES)('%s resolves to %s', (oldKey, newKey) => {
    expect(Object.hasOwn(LEGACY_AGENT_KEYS, oldKey)).toBe(true);
    expect(LEGACY_AGENT_KEYS[oldKey]).toBe(newKey);
  });

  it.each([
    ['scrutinizer', 'harden'],
    ['simplifier', 'polish'],
    ['bug-analyzer', 'debug'],
  ])('the 1.x name %s skips the 2.x slug and resolves straight to %s (single hop)', (oldKey, newKey) => {
    expect(LEGACY_AGENT_KEYS[oldKey]).toBe(newKey);
  });
});

describe('readAgentMapping canonicalises the six renamed agents', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rename-read-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function readFrom(agents: Record<string, unknown>) {
    await fs.writeFile(path.join(dir, 'agent-models.json'), JSON.stringify({ version: 1, agents }), 'utf-8');
    return readAgentMapping(dir);
  }

  it('shows every old key under its new slug and none under the old one', async () => {
    const models = ['opus', 'sonnet', 'haiku', 'opus', 'sonnet', 'haiku'];
    const seeded = Object.fromEntries(SIX_RENAMES.map(([oldKey], i) => [oldKey, { model: models[i] }]));

    const result = await readFrom(seeded);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const [i, [oldKey, newKey]] of SIX_RENAMES.entries()) {
      expect(Object.hasOwn(result.value.agents, oldKey), `${oldKey} must be renamed away`).toBe(false);
      expect(result.value.agents[newKey]).toEqual({ model: models[i] });
    }
    expect(Object.keys(result.value.agents).sort()).toEqual(SIX_RENAMES.map(([, n]) => n).sort());
  });

  it.each(SIX_RENAMES)('the new key wins when a file holds both %s and %s', async (oldKey, newKey) => {
    await fs.writeFile(
      path.join(dir, 'agent-models.json'),
      JSON.stringify({ version: 1, agents: { [oldKey]: { model: 'opus' }, [newKey]: { model: 'haiku' } } }),
      'utf-8',
    );

    const result = await readAgentMapping(dir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.agents[newKey]).toEqual({ model: 'haiku' });
    expect(Object.hasOwn(result.value.agents, oldKey)).toBe(false);
  });
});

describe('canonicaliseAgentKeys with two legacy names for one agent', () => {
  // scrutinize/scrutinizer, simplify/simplifier and diagnose/bug-analyzer now meet at one slug.
  // Without a rule the later key in the file silently overwrote the earlier one.
  const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
    ['scrutinizer', 'scrutinize', 'harden'],
    ['simplifier', 'simplify', 'polish'],
    ['bug-analyzer', 'diagnose', 'debug'],
  ];

  it.each(PAIRS)('%s and %s: the 2.x name wins at %s whichever comes first in the file', (older, newer, target) => {
    const olderFirst = canonicaliseAgentKeys({ [older]: { model: 'haiku' }, [newer]: { model: 'opus' } });
    const newerFirst = canonicaliseAgentKeys({ [newer]: { model: 'opus' }, [older]: { model: 'haiku' } });

    for (const out of [olderFirst, newerFirst]) {
      expect(out.agents).toEqual({ [target]: { model: 'opus' } });
      expect(out.dropped).toEqual([older]);
      expect(out.renamed).toEqual([newer]);
      expect(out.didMutate).toBe(true);
    }
  });
});

describe(`${V2} migration`, () => {
  let devflowDir: string;
  let file: string;

  beforeEach(async () => {
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rename-v2-'));
    file = path.join(devflowDir, 'agent-models.json');
  });

  afterEach(async () => {
    await fs.rm(devflowDir, { recursive: true, force: true });
  });

  const migration = (id: string) => {
    const m = MIGRATIONS.find(x => x.id === id);
    if (!m) throw new Error(`${id} is not registered`);
    return m;
  };
  const ctx = () => ({ scope: 'global' as const, devflowDir });
  const seed = (agents: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    fs.writeFile(file, JSON.stringify({ version: 1, ...extra, agents }), 'utf-8');
  const onDisk = async () => JSON.parse(await fs.readFile(file, 'utf-8')) as { agents: Record<string, unknown> } & Record<string, unknown>;

  it('is registered after v1 as a global migration', () => {
    const ids = MIGRATIONS.map(m => m.id);
    expect(ids.indexOf(V2)).toBeGreaterThan(ids.indexOf(V1));
    expect(migration(V2).scope).toBe('global');
  });

  it('rewrites all six old keys to their new slugs and keeps the rest of the file', async () => {
    const seeded = Object.fromEntries(SIX_RENAMES.map(([oldKey], i) => [oldKey, { model: ['opus', 'sonnet', 'haiku'][i % 3] }]));
    await seed({ ...seeded, code: { model: 'sonnet' } }, { note: 'kept' });

    const result = await migration(V2).run(ctx());

    expect(result.warnings).toEqual([]);
    expect(result.infos).toHaveLength(1);
    for (const [oldKey, newKey] of SIX_RENAMES) {
      expect(result.infos[0]).toContain(`'${oldKey}' → '${newKey}'`);
    }
    const after = await onDisk();
    expect(after['note']).toBe('kept');
    expect(Object.keys(after.agents).sort()).toEqual(['code', ...SIX_RENAMES.map(([, n]) => n)].sort());
    expect(after.agents['fix']).toEqual({ model: 'opus' });
    expect(after.agents['code']).toEqual({ model: 'sonnet' });
  });

  it('keeps the new key and warns under its own id when a file holds both forms', async () => {
    await seed({ 'code-fix': { model: 'opus' }, fix: { model: 'haiku' } });

    const result = await migration(V2).run(ctx());

    expect(result.infos).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(`${V2}:`);
    expect(result.warnings[0]).toContain("'code-fix'");
    expect((await onDisk()).agents).toEqual({ fix: { model: 'haiku' } });
  });

  it('names its own id, not the other migration, in a parse warning', async () => {
    await fs.writeFile(file, 'not valid json', 'utf-8');

    const v1 = await migration(V1).run(ctx());
    const v2 = await migration(V2).run(ctx());

    expect(v1.warnings).toHaveLength(1);
    expect(v1.warnings[0]).toContain(`${V1}:`);
    expect(v2.warnings).toHaveLength(1);
    expect(v2.warnings[0]).toContain(`${V2}:`);
  });

  it('does nothing when the file is missing or holds no old key', async () => {
    expect(await migration(V2).run(ctx())).toEqual({ infos: [], warnings: [] });

    await seed({ fix: { model: 'opus' }, curate: { model: 'haiku' } });
    expect(await migration(V2).run(ctx())).toEqual({ infos: [], warnings: [] });
  });

  it('makes zero writes after v1 has run on a 1.x machine', async () => {
    // A 1.x file: noun-form names. v1 now lands the three that were renamed again straight on
    // their final slug, so v2 finds nothing left to rewrite.
    await seed({
      coder: { model: 'opus' },
      scrutinizer: { model: 'sonnet' },
      simplifier: { model: 'haiku' },
      'bug-analyzer': { model: 'opus' },
    }, { note: 'kept' });

    const v1 = await migration(V1).run(ctx());
    expect(v1.warnings).toEqual([]);
    expect((await onDisk()).agents).toEqual({
      code: { model: 'opus' },
      harden: { model: 'sonnet' },
      polish: { model: 'haiku' },
      debug: { model: 'opus' },
    });

    // An old mtime makes a write visible: any rewrite would stamp the file with the current time.
    const past = new Date(Date.now() - 3_600_000);
    await fs.utimes(file, past, past);
    const before = { bytes: await fs.readFile(file, 'utf-8'), mtimeMs: (await fs.stat(file)).mtimeMs };

    const v2 = await migration(V2).run(ctx());

    expect(v2).toEqual({ infos: [], warnings: [] });
    expect(await fs.readFile(file, 'utf-8')).toBe(before.bytes);
    expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  it('runs once through the real runner on a machine that has already applied v1', async () => {
    await fs.writeFile(path.join(devflowDir, 'migrations.json'), JSON.stringify({ applied: [V1] }), 'utf-8');
    await seed({ learning: { model: 'haiku' }, simplify: { effort: 'low' } });

    const first = await runMigrations({ devflowDir }, [], MIGRATIONS.filter(m => m.id === V1 || m.id === V2));

    expect(first.failures).toEqual([]);
    expect(first.newlyApplied).toEqual([V2]);
    expect((await onDisk()).agents).toEqual({ curate: { model: 'haiku' }, polish: { effort: 'low' } });
    expect(await readAppliedMigrations(devflowDir)).toEqual([V1, V2]);

    const second = await runMigrations({ devflowDir }, [], MIGRATIONS.filter(m => m.id === V1 || m.id === V2));
    expect(second.newlyApplied).toEqual([]);
    expect(second.infos).toEqual([]);
  });
});

/**
 * D-TRACKER-SERVER-ALLOWLIST: the Git and Tracker agents hold a tool allowlist, and the tracker
 * tool servers the user has connected are stamped onto the INSTALLED `tools:` line of those two
 * agents (src/targets/claude-code/tracker-servers.ts). `devflow tracker --servers` sets the list.
 *
 * Layers, each against temp trees (HOME safety: nothing here reads or writes the real ~/.claude or
 * ~/.devflow; the one subprocess layer pins HOME to a temp directory through sandboxEnv):
 *   - the domain: the default list, the strict parser, the manifest normaliser
 *   - the manifest reader: absent and malformed `servers` heal without losing the manifest
 *   - every path that writes an installed git.md or tracker.md, and the ones that must preserve it
 *   - the `--servers` orchestrator and the `--status` line
 *   - AC-401: the compiled CLI, installing under each provider and re-stamping
 *
 * Requires a build (the e2e layer spawns dist/cli.js and the install layer reads dist/agents).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readStampedTools, stampAgentTools } from '../src/core/agent-frontmatter.js';
import { reapplyAgentMapping, revertExternalAgents, saveAgentMapping } from '../src/core/agent-models.js';
import { readManifest, syncManifestFeature, writeManifest, type ManifestData } from '../src/core/manifest.js';
import { DEVFLOW_PLUGINS, buildAssetMaps, type PluginDefinition } from '../src/core/plugins.js';
import {
  TRACKER_MCP_SERVERS_DEFAULT,
  TRACKER_SERVERS_MAX,
  effectiveTrackerServers,
  normalizeTrackerFeature,
  parseTrackerServers,
  trackerServerTools,
  validateTrackerServers,
} from '../src/core/tracker.js';
import { runTrackerServers, runTrackerSet, type TrackerServersIO } from '../src/cli/commands/tracker.js';
import { installViaFileCopy, type Spinner } from '../src/targets/claude-code/installer.js';
import { convergeCurationVariants } from '../src/targets/claude-code/curation-install.js';
import { convergeTrackerArtifacts } from '../src/targets/claude-code/tracker-install.js';
import { restampTrackerAgents } from '../src/targets/claude-code/tracker-servers.js';
import { requireBuiltCli, resolveAgentSource, sandboxEnv } from './helpers.js';

const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };

const GIT_CORE = ['Bash', 'Read', 'Write', 'ToolSearch'];
const TRACKER_CORE = ['Bash', 'Read', 'ToolSearch'];
const DEFAULT_TOOLS = trackerServerTools(TRACKER_MCP_SERVERS_DEFAULT);

/** The entries of the `tools:` line of an agent's frontmatter. */
function toolsOf(content: string): string[] {
  const line = content.split('\n').find(l => l.startsWith('tools:')) ?? '';
  const list = /^tools:\s*\[(.*)\]\s*$/.exec(line);
  return list === null ? [] : list[1].split(',').map(item => item.trim().replace(/^"|"$/g, '')).filter(item => item !== '');
}

/** `content` with `tools` stamped onto its tools line. Throws, so a bad fixture fails loudly. */
function stamped(content: string, tools: readonly string[]): string {
  const result = stampAgentTools(content, tools);
  if (!result.ok) throw new Error(`fixture cannot be stamped: ${result.error}`);
  return result.value.content;
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// The domain
// ---------------------------------------------------------------------------

describe('the default list', () => {
  it('is the five names the maintainer chose, in order, one flat list for every provider and without github', () => {
    expect([...TRACKER_MCP_SERVERS_DEFAULT]).toEqual([
      'atlassian', 'jira', 'claude_ai_Atlassian', 'linear', 'claude_ai_Linear',
    ]);
    expect(TRACKER_MCP_SERVERS_DEFAULT).not.toContain('github');
  });

  it('is frozen, valid against its own validator, and turns into whole-server entries', () => {
    expect(Object.isFrozen(TRACKER_MCP_SERVERS_DEFAULT)).toBe(true);
    expect(validateTrackerServers(TRACKER_MCP_SERVERS_DEFAULT)).toEqual({ ok: true, value: [...TRACKER_MCP_SERVERS_DEFAULT] });
    expect(DEFAULT_TOOLS).toEqual([
      'mcp__atlassian', 'mcp__jira', 'mcp__claude_ai_Atlassian', 'mcp__linear', 'mcp__claude_ai_Linear',
    ]);
  });
});

describe('parseTrackerServers: reject, never repair', () => {
  it('reads a list in order, case-sensitively, and `default` alone as the default', () => {
    expect(parseTrackerServers('github')).toEqual({ ok: true, value: { kind: 'list', servers: ['github'] } });
    expect(parseTrackerServers('x,Y,claude_ai_Corp-Tracker')).toEqual({
      ok: true, value: { kind: 'list', servers: ['x', 'Y', 'claude_ai_Corp-Tracker'] },
    });
    expect(parseTrackerServers('default')).toEqual({ ok: true, value: { kind: 'default' } });
  });

  it('collapses an exact duplicate to its first place and keeps the order', () => {
    expect(parseTrackerServers('b,a,b,a,c')).toEqual({ ok: true, value: { kind: 'list', servers: ['b', 'a', 'c'] } });
  });

  it('refuses every malformed argument with a message naming the offender', () => {
    const bad: ReadonlyArray<readonly [string, RegExp]> = [
      ['', /Missing tracker servers/],
      ['a,,b', /Invalid tracker server name: ""/],
      ['a,', /Invalid tracker server name: ""/],
      [',a', /Invalid tracker server name: ""/],
      [' a', /Invalid tracker server name: " a"/],
      ['a, b', /Invalid tracker server name: " b"/],
      ['a b', /Invalid tracker server name: "a b"/],
      ['a/b', /Invalid tracker server name/],
      ['a.b', /Invalid tracker server name/],
      ['a;b', /Invalid tracker server name: "a;b"/],
      ['$(whoami)', /Invalid tracker server name/],
      ['a"]\nmodel: x', /Invalid tracker server name/],
      ['mcp__a', /must not contain "__"/],
      ['a__b', /must not contain "__"/],
      ['serveré', /Invalid tracker server name/],
      ['x'.repeat(65), /Invalid tracker server name/],
      ['default,x', /"default" is reserved/],
      ['x,default', /"default" is reserved/],
    ];
    for (const [input, message] of bad) {
      const parsed = parseTrackerServers(input);
      expect(parsed.ok, JSON.stringify(input)).toBe(false);
      if (!parsed.ok) expect(parsed.error, JSON.stringify(input)).toMatch(message);
    }
    // Names are case-sensitive, so only the exact lowercase word is reserved.
    expect(parseTrackerServers('Default')).toEqual({ ok: true, value: { kind: 'list', servers: ['Default'] } });
  });

  it('bounds the list at TRACKER_SERVERS_MAX distinct names and a name at 64 characters', () => {
    const names = (n: number): string => Array.from({ length: n }, (_, i) => `s${i}`).join(',');
    expect(parseTrackerServers(names(TRACKER_SERVERS_MAX)).ok).toBe(true);
    const over = parseTrackerServers(names(TRACKER_SERVERS_MAX + 1));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain(`at most ${TRACKER_SERVERS_MAX}`);
    // Duplicates do not count towards the cap.
    expect(parseTrackerServers(`${names(TRACKER_SERVERS_MAX)},s0,s1`).ok).toBe(true);
    expect(parseTrackerServers('x'.repeat(64)).ok).toBe(true);
  });

  it('echoes a hostile name sanitised and cut, never raw', () => {
    const parsed = parseTrackerServers(`bad\u001b[31m${'z'.repeat(100)}`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      // eslint-disable-next-line no-control-regex
      expect(parsed.error).not.toMatch(/[\u0000-\u001f]/);
      expect(parsed.error.length).toBeLessThan(250);
    }
  });
});

describe('validateTrackerServers: the rule set the manifest shares with the CLI', () => {
  it('refuses a non-string entry and an empty list', () => {
    expect(validateTrackerServers([]).ok).toBe(false);
    for (const entry of [1, null, undefined, {}, ['a'], true]) {
      expect(validateTrackerServers(['ok', entry]).ok, String(entry)).toBe(false);
    }
  });
});

describe('normalizeTrackerFeature: servers', () => {
  it('reads an absent servers key as the default and keeps the shape it always had', () => {
    expect(normalizeTrackerFeature({ provider: 'jira' })).toEqual({ provider: 'jira' });
    expect(normalizeTrackerFeature({ provider: 'jira', servers: undefined })).toEqual({ provider: 'jira' });
    expect(normalizeTrackerFeature(undefined)).toEqual({ provider: 'github' });
  });

  it('keeps a valid list, deduplicated and in order', () => {
    expect(normalizeTrackerFeature({ provider: 'linear', servers: ['b', 'a', 'b'] })).toEqual({
      provider: 'linear', servers: ['b', 'a'],
    });
  });

  it('drops an invalid list whole, never trimmed to its valid names, and reports it once', () => {
    const malformed: unknown[] = ['github', 7, null, [], [1], ['ok', 'not ok'], ['a__b'], { 0: 'a' }, ['x'.repeat(65)]];
    for (const servers of malformed) {
      const warnings: string[] = [];
      const state = normalizeTrackerFeature({ provider: 'jira', servers }, m => warnings.push(m));
      expect(state, JSON.stringify(servers)).toEqual({ provider: 'jira' });
      expect(warnings, JSON.stringify(servers)).toHaveLength(1);
      expect(warnings[0]).toContain('devflow tracker --servers');
    }
  });

  it('heals silently when no warning channel is given, and the provider still wins', () => {
    expect(normalizeTrackerFeature({ provider: 'jira', servers: 'github' })).toEqual({ provider: 'jira' });
    expect(normalizeTrackerFeature({ provider: 'nope', servers: ['a'] })).toEqual({ provider: 'github' });
  });

  it('effectiveTrackerServers is the list, else the default', () => {
    expect(effectiveTrackerServers({ provider: 'jira' })).toEqual([...TRACKER_MCP_SERVERS_DEFAULT]);
    expect(effectiveTrackerServers({ provider: 'jira', servers: ['a'] })).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// The manifest reader
// ---------------------------------------------------------------------------

describe('readManifest: the servers field', () => {
  let root: string;
  let devflowDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-servers-manifest-'));
    devflowDir = path.join(root, '.devflow');
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  const manifest = (tracker: unknown): Record<string, unknown> => ({
    version: '3.0.0',
    plugins: ['devflow-plan'],
    scope: 'user',
    features: {
      ambient: true, memory: true, hud: true, knowledge: true, learning: true, rules: true,
      flags: {}, proxy: false, compliance: { enabled: false, frameworks: [] }, tracker,
    },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });

  async function seed(tracker: unknown): Promise<void> {
    await fs.mkdir(devflowDir, { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), JSON.stringify(manifest(tracker)));
  }

  it('reads a manifest with no servers key as the default, and still reads it as a manifest', async () => {
    await seed({ provider: 'jira' });
    const read = await readManifest(devflowDir);
    expect(read, 'a manifest without servers must not read as missing').not.toBeNull();
    expect(read?.features.tracker).toEqual({ provider: 'jira' });
    expect(effectiveTrackerServers(read!.features.tracker)).toEqual([...TRACKER_MCP_SERVERS_DEFAULT]);
  });

  it('reads a manifest from before the tracker feature existed, servers and all, as the defaults', async () => {
    await seed(undefined);
    const read = await readManifest(devflowDir);
    expect(read?.features.tracker).toEqual({ provider: 'github' });
  });

  it('heals a malformed servers value to the default with one warning, keeping the manifest', async () => {
    await seed({ provider: 'linear', servers: ['ok', 'not ok'] });
    const warnings: string[] = [];
    const read = await readManifest(devflowDir, { onWarning: m => warnings.push(m) });
    expect(read, 'a bad servers value must not make the manifest read as missing').not.toBeNull();
    expect(read?.features.tracker).toEqual({ provider: 'linear' });
    expect(warnings).toHaveLength(1);
  });

  it('round-trips a valid list through write and read, and through syncManifestFeature', async () => {
    await seed({ provider: 'jira', servers: ['corp_tracker', 'github'] });
    const read = await readManifest(devflowDir);
    expect(read?.features.tracker).toEqual({ provider: 'jira', servers: ['corp_tracker', 'github'] });
    await writeManifest(devflowDir, read as ManifestData);
    await syncManifestFeature(devflowDir, 'hud', false);
    const again = await readManifest(devflowDir);
    expect(again?.features.hud).toBe(false);
    expect(again?.features.tracker.servers).toEqual(['corp_tracker', 'github']);
  });
});

// ---------------------------------------------------------------------------
// Every path that writes an installed git.md or tracker.md
// ---------------------------------------------------------------------------

describe('the installed agents wear the stamp, whichever path wrote them', () => {
  let root: string;
  let claudeDir: string;
  let devflowDir: string;
  let warnings: string[];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-servers-install-'));
    claudeDir = path.join(root, '.claude');
    devflowDir = path.join(root, '.devflow');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });
    warnings = [];
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  const plugin = (name: string): PluginDefinition => {
    const found = DEVFLOW_PLUGINS.find(p => p.name === name);
    if (found === undefined) throw new Error(`no such plugin: ${name}`);
    return found;
  };
  const installed = (name: string): string => path.join(claudeDir, 'agents', 'devflow', `${name}.md`);
  const read = (name: string): Promise<string> => fs.readFile(installed(name), 'utf-8');

  const install = (names: string[], extra: { trackerServers?: readonly string[]; partial?: boolean } = {}): Promise<unknown> => {
    const plugins = names.map(plugin);
    const { skillsMap, agentsMap } = buildAssetMaps(plugins);
    return installViaFileCopy({
      curation: true,
      plugins,
      effectivePlugins: plugins,
      claudeDir,
      devflowDir,
      skillsMap,
      agentsMap,
      isPartialInstall: extra.partial ?? false,
      spinner: noopSpinner,
      warn: msg => { warnings.push(msg); },
      ...(extra.trackerServers === undefined ? {} : { trackerServers: extra.trackerServers }),
    });
  };

  describe('installViaFileCopy (full install and --plugin)', () => {
    it('stamps Git with the default list when none is given, over the shipped tools', async () => {
      await install(['devflow-plan']);
      expect(toolsOf(await read('git'))).toEqual([...GIT_CORE, ...DEFAULT_TOOLS]);
      expect(warnings).toEqual([]);
    });

    it('stamps Git with the given list, in order, and nothing from the default', async () => {
      await install(['devflow-plan'], { trackerServers: ['corp_tracker', 'github'] });
      expect(toolsOf(await read('git'))).toEqual([...GIT_CORE, 'mcp__corp_tracker', 'mcp__github']);
    });

    it('installs the shipped source with only the tools line different', async () => {
      await install(['devflow-plan']);
      const stripped = stampAgentTools(await read('git'), []);
      expect(stripped.ok && stripped.value.content).toBe(resolveAgentSource('git').content);
    });

    it('is byte-stable: a second identical install rewrites the same bytes', async () => {
      await install(['devflow-plan'], { trackerServers: ['a'] });
      const first = await read('git');
      await install(['devflow-plan'], { trackerServers: ['a'] });
      expect(await read('git')).toBe(first);
    });

    it('re-installing with a different list replaces the stamp instead of adding to it', async () => {
      await install(['devflow-plan'], { trackerServers: ['a', 'b'] });
      await install(['devflow-plan'], { trackerServers: ['c'] });
      expect(toolsOf(await read('git'))).toEqual([...GIT_CORE, 'mcp__c']);
    });

    it('a --plugin install that does not install Git leaves the stamped Git alone', async () => {
      await install(['devflow-plan'], { trackerServers: ['corp_tracker'] });
      const before = await read('git');
      await install(['devflow-explore'], { partial: true, trackerServers: ['corp_tracker'] });
      expect(await read('git')).toBe(before);
    });

    it('does not stamp any agent but Git and Tracker', async () => {
      await install(['devflow-implement']);
      for (const name of ['code', 'validate', 'knowledge', 'test']) {
        expect(await read(name), name).toBe(resolveAgentSource(name).content);
      }
    });
  });

  describe('convergeTrackerArtifacts', () => {
    const converge = (servers?: readonly string[]) =>
      convergeTrackerArtifacts({ claudeDir, warn: msg => { warnings.push(msg); }, ...(servers === undefined ? {} : { servers }) });

    it('stamps the Tracker agent with the default list, and says so only once', async () => {
      expect(await converge()).toEqual({ converged: true, agent: 'installed' });
      expect(toolsOf(await read('tracker'))).toEqual([...TRACKER_CORE, ...DEFAULT_TOOLS]);
      // Idempotence is asserted through the real entry point, run twice: the second run moves nothing.
      const first = await read('tracker');
      expect(await converge()).toEqual({ converged: true, agent: 'unchanged' });
      expect(await read('tracker')).toBe(first);
    });

    it('a changed list is a write, an identical one is not, and the stamp is replaced', async () => {
      await converge(['a', 'b']);
      expect(await converge(['a', 'b'])).toEqual({ converged: true, agent: 'unchanged' });
      expect(await converge(['c'])).toEqual({ converged: true, agent: 'installed' });
      expect(toolsOf(await read('tracker'))).toEqual([...TRACKER_CORE, 'mcp__c']);
    });

    it('self-heals a hand-edited or unstamped copy', async () => {
      await converge(['a']);
      await fs.writeFile(installed('tracker'), resolveAgentSource('tracker').content);
      expect(await converge(['a'])).toEqual({ converged: true, agent: 'installed' });
      expect(toolsOf(await read('tracker'))).toEqual([...TRACKER_CORE, 'mcp__a']);
    });
  });

  describe('convergeCurationVariants carries the stamp instead of dropping it', () => {
    // The shipped roster holds neither Git nor Tracker today (neither has a curation arm), so a
    // temp package root gives the converge a Git variant to write: the path a future arm would take.
    let packageRoot: string;

    const variant = (marker: string): string => `${stamped(resolveAgentSource('git').content, [])}\n${marker}\n`;

    beforeEach(async () => {
      packageRoot = path.join(root, 'pkg');
      await fs.mkdir(path.join(packageRoot, 'dist', 'agents'), { recursive: true });
      await fs.mkdir(path.join(packageRoot, 'dist', 'commands'), { recursive: true });
      await fs.mkdir(path.join(packageRoot, 'dist', 'curation-off', 'agents'), { recursive: true });
      await fs.mkdir(path.join(packageRoot, 'dist', 'curation-off', 'commands'), { recursive: true });
      await fs.writeFile(path.join(packageRoot, 'dist', 'agents', 'git.md'), variant('CURATION-ON'));
      await fs.writeFile(path.join(packageRoot, 'dist', 'curation-off', 'agents', 'git.md'), variant('CURATION-OFF'));
    });

    const run = (curation: boolean) =>
      convergeCurationVariants({ claudeDir, devflowDir, curation, plugins: [plugin('devflow-plan')], warn: m => warnings.push(m), packageRoot });

    it('keeps the list across an on to off to on switch, and a repeat run writes nothing', async () => {
      await fs.mkdir(path.dirname(installed('git')), { recursive: true });
      const stamp = trackerServerTools(['corp_tracker', 'github']);
      await fs.writeFile(installed('git'), stamped(variant('CURATION-ON'), stamp));

      const off = await run(false);
      expect(off.agentsRewritten).toEqual(['git.md']);
      expect(await read('git')).toContain('CURATION-OFF');
      expect(readStampedTools(await read('git'))).toEqual({ ok: true, value: stamp });

      const offAgain = await run(false);
      expect(offAgain.agentsRewritten, 'a steady-state converge writes nothing').toEqual([]);

      const on = await run(true);
      expect(on.agentsRewritten).toEqual(['git.md']);
      expect(await read('git')).toContain('CURATION-ON');
      expect(readStampedTools(await read('git'))).toEqual({ ok: true, value: stamp });
      // The temp root ships no skills, so the converge's skill step warns; nothing about the agent does.
      expect(warnings.filter(w => !w.includes('apply-decisions'))).toEqual([]);
    });
  });

  describe('paths that go through the frontmatter rewriter preserve the stamp', () => {
    it('reapplyAgentMapping (devflow agents, init, the proxy) keeps the tools line byte for byte', async () => {
      await install(['devflow-plan'], { trackerServers: ['corp_tracker'] });
      const before = (await read('git')).split('\n').find(l => l.startsWith('tools:'));
      await saveAgentMapping(devflowDir, { version: 1, agents: { git: { model: 'opus', effort: 'high' } } });
      const result = await reapplyAgentMapping({ installDir: path.dirname(installed('git')), devflowDir, proxyEnabled: false });
      expect(result.updated).toContain('git');
      const after = await read('git');
      expect(after).toContain('model: opus');
      expect(after.split('\n').find(l => l.startsWith('tools:'))).toBe(before);
    });

    it('revertExternalAgents (proxy disable, uninstall) keeps it too', async () => {
      await install(['devflow-plan'], { trackerServers: ['corp_tracker'] });
      const before = (await read('git')).split('\n').find(l => l.startsWith('tools:'));
      await revertExternalAgents({ installDir: path.dirname(installed('git')), devflowDir });
      expect((await read('git')).split('\n').find(l => l.startsWith('tools:'))).toBe(before);
    });
  });

  describe('restampTrackerAgents (devflow tracker --servers)', () => {
    const restamp = (servers: readonly string[]) => restampTrackerAgents({ claudeDir, servers, warn: m => warnings.push(m) });

    it('stamps both installed agents, replaces a previous list, and is idempotent', async () => {
      await install(['devflow-plan']);
      await convergeTrackerArtifacts({ claudeDir, warn: () => {} });

      const first = await restamp(['x', 'y']);
      expect(first).toEqual({ rewritten: ['git', 'tracker'], unchanged: [], absent: [], failed: [] });
      expect(toolsOf(await read('git'))).toEqual([...GIT_CORE, 'mcp__x', 'mcp__y']);
      expect(toolsOf(await read('tracker'))).toEqual([...TRACKER_CORE, 'mcp__x', 'mcp__y']);

      expect(await restamp(['x', 'y'])).toEqual({ rewritten: [], unchanged: ['git', 'tracker'], absent: [], failed: [] });

      await restamp([...TRACKER_MCP_SERVERS_DEFAULT]);
      expect(toolsOf(await read('git'))).toEqual([...GIT_CORE, ...DEFAULT_TOOLS]);
      expect(warnings).toEqual([]);
    });

    it('leaves an absent agent absent and reports it', async () => {
      await install(['devflow-plan']);
      const result = await restamp(['x']);
      expect(result.rewritten).toEqual(['git']);
      expect(result.absent).toEqual(['tracker']);
      expect(await exists(installed('tracker'))).toBe(false);
    });

    it('refuses a file it cannot stamp and says so, without touching it', async () => {
      await install(['devflow-plan']);
      const broken = '# not an agent file\n';
      await fs.writeFile(installed('git'), broken);
      const result = await restamp(['x']);
      expect(result.failed).toEqual(['git']);
      expect(await read('git')).toBe(broken);
      expect(warnings.join('\n')).toContain('could not be stamped');
    });

    it('refuses a relative claudeDir instead of resolving it against the working directory', async () => {
      const result = await restampTrackerAgents({ claudeDir: 'relative/.claude', servers: ['x'], warn: m => warnings.push(m) });
      expect(result.failed).toEqual(['git', 'tracker']);
      expect(warnings.join('\n')).toContain('not an absolute path');
    });
  });
});

// ---------------------------------------------------------------------------
// The --servers orchestrator
// ---------------------------------------------------------------------------

describe('runTrackerServers: manifest first, then the installed agents', () => {
  const makeIo = (opts: { writeError?: Error; absent?: boolean } = {}) => {
    const calls: string[] = [];
    const written: unknown[] = [];
    const io: TrackerServersIO = {
      syncManifest: async (_dir, state) => {
        calls.push('manifest');
        written.push(state);
        if (opts.writeError) throw opts.writeError;
      },
      restamp: async (_claudeDir, servers) => {
        calls.push(`restamp:${servers.join('+')}`);
        return opts.absent
          ? { rewritten: [], unchanged: [], absent: ['git', 'tracker'], failed: [] }
          : { rewritten: ['git', 'tracker'], unchanged: [], absent: [], failed: [] };
      },
    };
    return { calls, written, io };
  };
  const run = (io: TrackerServersIO, current: { provider: 'github' | 'jira'; servers?: readonly string[] }, requested: Parameters<typeof runTrackerServers>[0]['requested']) =>
    runTrackerServers({ devflowDir: '/tmp/df', claudeDir: '/tmp/cl', current, requested, io });

  it('writes the manifest, then stamps the agents with the same list', async () => {
    const { calls, written, io } = makeIo();
    const out = await run(io, { provider: 'jira' }, { kind: 'list', servers: ['x', 'y'] });
    expect(calls).toEqual(['manifest', 'restamp:x+y']);
    expect(written).toEqual([{ provider: 'jira', servers: ['x', 'y'] }]);
    expect(out.ok).toBe(true);
    expect(out.messages.map(m => m.text).join('\n')).toContain('Tracker servers: x, y');
  });

  it('`default` writes the manifest WITHOUT the key and stamps the default list', async () => {
    const { calls, written, io } = makeIo();
    const out = await run(io, { provider: 'jira', servers: ['x'] }, { kind: 'default' });
    expect(written).toEqual([{ provider: 'jira' }]);
    expect(Object.hasOwn(written[0] as object, 'servers')).toBe(false);
    expect(calls).toEqual(['manifest', `restamp:${TRACKER_MCP_SERVERS_DEFAULT.join('+')}`]);
    expect(out.messages.map(m => m.text).join('\n')).toContain('(default)');
  });

  it('a failed manifest write stamps NOTHING and reports not-ok', async () => {
    const { calls, io } = makeIo({ writeError: new Error('ENOSPC: no space left on device') });
    const out = await run(io, { provider: 'jira' }, { kind: 'list', servers: ['x'] });
    expect(calls).toEqual(['manifest']);
    expect(out.ok).toBe(false);
    expect(out.state).toEqual({ provider: 'jira' });
    expect(out.messages.some(m => m.level === 'error' && m.text.includes('ENOSPC'))).toBe(true);
  });

  it('says so when no agent is installed, and marks an unchanged list', async () => {
    const { io } = makeIo({ absent: true });
    const out = await run(io, { provider: 'github', servers: ['x'] }, { kind: 'list', servers: ['x'] });
    const text = out.messages.map(m => m.text).join('\n');
    expect(text).toContain('(unchanged)');
    expect(text).toContain('run devflow init');
  });

  it('a provider change keeps the servers (--set rides them along)', async () => {
    const written: unknown[] = [];
    await runTrackerSet({
      devflowDir: '/tmp/df',
      current: { provider: 'github', servers: ['corp_tracker'] },
      requested: 'jira',
      io: {
        syncManifest: async (_dir, state) => { written.push(state); },
        rearmInference: async () => ({ ok: true, value: undefined }),
        applySentinel: async () => ({ ok: true, value: undefined }),
      },
    });
    expect(written).toEqual([{ provider: 'jira', servers: ['corp_tracker'] }]);
  });
});

// ---------------------------------------------------------------------------
// AC-401: the compiled CLI against a temp HOME
// ---------------------------------------------------------------------------

describe('AC-401: install under each provider, then --servers (subprocess, temp HOME)', () => {
  const CLI = requireBuiltCli();
  const SPAWN_TIMEOUT_MS = 90_000;
  let root: string;
  let home: string;
  let work: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-servers-e2e-'));
    home = path.join(root, 'home');
    work = path.join(root, 'work');
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    await fs.mkdir(path.join(home, '.devflow'), { recursive: true });
    await fs.mkdir(work, { recursive: true });
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  /** One CLI spawn with HOME pinned to the temp home and the working directory in a temp sandbox. */
  function cli(args: string[]): { status: number | null; out: string } {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: work,
      encoding: 'utf-8',
      timeout: SPAWN_TIMEOUT_MS,
      env: sandboxEnv(home),
    });
    if (result.error) throw result.error;
    return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }
  const init = (provider: string) =>
    cli(['init', '--recommended', '--no-ambient', '--no-memory', '--no-learning', '--no-knowledge', '--no-rules', '--tracker', provider]);
  const agent = (name: string): Promise<string> => fs.readFile(path.join(home, '.claude', 'agents', 'devflow', `${name}.md`), 'utf-8');
  const manifestTracker = async (): Promise<Record<string, unknown>> =>
    (JSON.parse(await fs.readFile(path.join(home, '.devflow', 'manifest.json'), 'utf-8')) as { features: { tracker: Record<string, unknown> } }).features.tracker;

  for (const provider of ['github', 'jira', 'linear']) {
    it(`an install under ${provider} carries the core tools and the default servers in git.md and tracker.md`, async () => {
      const result = init(provider);
      expect(result.status, result.out).toBe(0);
      expect(toolsOf(await agent('git'))).toEqual([...GIT_CORE, ...DEFAULT_TOOLS]);
      expect(toolsOf(await agent('tracker'))).toEqual([...TRACKER_CORE, ...DEFAULT_TOOLS]);
      expect(await manifestTracker()).toEqual({ provider });
    }, SPAWN_TIMEOUT_MS + 10_000);
  }

  it('--servers re-stamps both agents at once, survives a re-init, and `default` restores the list and the key', async () => {
    expect(init('jira').status).toBe(0);

    const set = cli(['tracker', '--servers', 'corp_tracker,github']);
    expect(set.status, set.out).toBe(0);
    expect(toolsOf(await agent('git'))).toEqual([...GIT_CORE, 'mcp__corp_tracker', 'mcp__github']);
    expect(toolsOf(await agent('tracker'))).toEqual([...TRACKER_CORE, 'mcp__corp_tracker', 'mcp__github']);
    expect(await manifestTracker()).toEqual({ provider: 'jira', servers: ['corp_tracker', 'github'] });

    const status = cli(['tracker', '--status']);
    expect(status.status, status.out).toBe(0);
    expect(status.out).toMatch(/Servers:\s+corp_tracker, github(?!.*\(default\))/);

    // A re-init changes nothing about the setting and re-stamps with it.
    expect(init('jira').status).toBe(0);
    expect(toolsOf(await agent('git'))).toEqual([...GIT_CORE, 'mcp__corp_tracker', 'mcp__github']);
    expect(toolsOf(await agent('tracker'))).toEqual([...TRACKER_CORE, 'mcp__corp_tracker', 'mcp__github']);
    expect(await manifestTracker()).toEqual({ provider: 'jira', servers: ['corp_tracker', 'github'] });

    // A provider change keeps the servers.
    expect(cli(['tracker', '--set', 'linear']).status).toBe(0);
    expect(await manifestTracker()).toEqual({ provider: 'linear', servers: ['corp_tracker', 'github'] });

    const restored = cli(['tracker', '--servers', 'default']);
    expect(restored.status, restored.out).toBe(0);
    expect(toolsOf(await agent('git'))).toEqual([...GIT_CORE, ...DEFAULT_TOOLS]);
    expect(toolsOf(await agent('tracker'))).toEqual([...TRACKER_CORE, ...DEFAULT_TOOLS]);
    expect(await manifestTracker()).toEqual({ provider: 'linear' });
    expect(cli(['tracker', '--status']).out).toMatch(/Servers:\s+atlassian, jira.*\(default\)/);
  }, SPAWN_TIMEOUT_MS * 4);

  it('refuses a bad name before any I/O: exit 1, no agent or manifest change', async () => {
    expect(init('jira').status).toBe(0);
    const gitBefore = await agent('git');
    const manifestBefore = await fs.readFile(path.join(home, '.devflow', 'manifest.json'), 'utf-8');
    for (const bad of ['a b', 'a,,b', 'mcp__x', 'default,x', '']) {
      const result = cli(['tracker', '--servers', bad]);
      expect(result.status, `--servers ${JSON.stringify(bad)}: ${result.out}`).toBe(1);
    }
    expect(await agent('git')).toBe(gitBefore);
    expect(await fs.readFile(path.join(home, '.devflow', 'manifest.json'), 'utf-8')).toBe(manifestBefore);
  }, SPAWN_TIMEOUT_MS * 2);

  it('--status names the default list as the default on a machine that never set one', async () => {
    expect(init('github').status).toBe(0);
    expect(cli(['tracker', '--status']).out).toMatch(/Servers:\s+atlassian, jira, claude_ai_Atlassian, linear, claude_ai_Linear\s+\(default\)/);
  }, SPAWN_TIMEOUT_MS * 2);

  it('a hand-edited malformed servers value heals to the default with a warning, and --servers repairs it', async () => {
    expect(init('jira').status).toBe(0);
    const file = path.join(home, '.devflow', 'manifest.json');
    const raw = JSON.parse(await fs.readFile(file, 'utf-8')) as { features: { tracker: Record<string, unknown> } };
    raw.features.tracker.servers = ['fine', 'not fine'];
    await fs.writeFile(file, JSON.stringify(raw));

    const status = cli(['tracker', '--status']);
    expect(status.status, status.out).toBe(0);
    expect(status.out).toContain('not a valid list');
    expect(status.out).toMatch(/Servers:\s+atlassian, jira.*\(default\)/);

    expect(cli(['tracker', '--servers', 'fine']).status).toBe(0);
    expect(await manifestTracker()).toEqual({ provider: 'jira', servers: ['fine'] });
  }, SPAWN_TIMEOUT_MS * 3);
});

/**
 * D-EXPLORE-NO-CLOBBER: devflow's Explore agent never displaces an Explore agent the
 * user already owns.
 *
 * Claude Code keys agents by their frontmatter `name:` alone, so a second agent named
 * Explore under the user directory would collide with devflow's and the winner would
 * be decided by file load order. The install therefore skips devflow's copy when
 * another file under ~/.claude/agents defines the same type, warns, and leaves the
 * user's file untouched.
 *
 * Three layers, each against temp trees (HOME safety: no test reads or writes the real
 * ~/.claude, and none shells out to dist/cli.js):
 *   - parseAgentType         the pure frontmatter read
 *   - findForeignAgentOwner  the bounded, symlink-refusing scan
 *   - installViaFileCopy     the installer edge (AC-303)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  BUILTIN_OVERRIDE_AGENTS,
  FRONTMATTER_READ_BYTES,
  MAX_AGENT_SCAN_DEPTH,
  findForeignAgentOwner,
  parseAgentType,
} from '../../src/targets/claude-code/agent-type-owner.js';
import { installViaFileCopy, type Spinner } from '../../src/targets/claude-code/installer.js';
import { DEVFLOW_PLUGINS, buildAssetMaps, type PluginDefinition } from '../../src/core/plugins.js';
import { resolveAgentSource, splitFrontmatter } from '../helpers.js';

const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };

const agentFile = (name: string, body = 'You search.\n'): string =>
  `---\nname: ${name}\ndescription: test agent\nmodel: sonnet\n---\n\n${body}`;

describe('parseAgentType: the frontmatter name, read purely', () => {
  it('reads a plain, a double-quoted and a single-quoted name', () => {
    expect(parseAgentType('---\nname: Explore\n---\n')).toBe('Explore');
    expect(parseAgentType('---\nname: "Explore"\n---\n')).toBe('Explore');
    expect(parseAgentType("---\nname: 'Explore'\n---\n")).toBe('Explore');
  });

  it('tolerates CRLF, a BOM, trailing blanks and an inline comment', () => {
    expect(parseAgentType('﻿---\r\nname: Explore  \r\n---\r\n')).toBe('Explore');
    expect(parseAgentType('---\nname: Explore # mine\n---\n')).toBe('Explore');
    expect(parseAgentType('---\nname:Explore\n---\n')).toBe('Explore');
  });

  it('reads no name from the body, from an indented key, or from a file with no frontmatter', () => {
    expect(parseAgentType('---\ndescription: x\n---\nname: Explore\n')).toBeUndefined();
    expect(parseAgentType('---\nmetadata:\n  name: Explore\n---\n')).toBeUndefined();
    expect(parseAgentType('name: Explore\nbody\n')).toBeUndefined();
    expect(parseAgentType('')).toBeUndefined();
  });

  it('reads no name from an unterminated frontmatter or an empty value', () => {
    expect(parseAgentType('---\nname: Explore\nno closing fence\n')).toBeUndefined();
    expect(parseAgentType('---\nname:\n---\n')).toBeUndefined();
    expect(parseAgentType('---\nname: ""\n---\n')).toBeUndefined();
  });
});

describe('findForeignAgentOwner: who else defines this agent type', () => {
  let root: string;
  let agentsRoot: string;
  let ownDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-no-clobber-'));
    agentsRoot = path.join(root, 'agents');
    ownDir = path.join(agentsRoot, 'devflow');
    await fs.mkdir(ownDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const scan = (agentType = 'Explore') => findForeignAgentOwner({ agentsRoot, ownDir, agentType });

  it('finds a top-level user file that defines the type', async () => {
    const mine = path.join(agentsRoot, 'my-explorer.md');
    await fs.writeFile(mine, agentFile('Explore'));
    expect(await scan()).toEqual({ ok: true, value: mine });
  });

  it('finds a definition in a subdirectory outside the devflow directory', async () => {
    await fs.mkdir(path.join(agentsRoot, 'team'), { recursive: true });
    const mine = path.join(agentsRoot, 'team', 'explore.md');
    await fs.writeFile(mine, agentFile('Explore'));
    expect(await scan()).toEqual({ ok: true, value: mine });
  });

  it('never counts devflow\'s own directory, where its copy lives', async () => {
    await fs.writeFile(path.join(ownDir, 'explore.md'), agentFile('Explore'));
    expect(await scan()).toEqual({ ok: true, value: undefined });
  });

  it('matches the type exactly, as Claude Code keys agents: a lowercase explore is a different agent', async () => {
    await fs.writeFile(path.join(agentsRoot, 'lower.md'), agentFile('explore'));
    await fs.writeFile(path.join(agentsRoot, 'other.md'), agentFile('Explorer'));
    expect(await scan()).toEqual({ ok: true, value: undefined });
  });

  it('ignores files that are not markdown and files with other types', async () => {
    await fs.writeFile(path.join(agentsRoot, 'notes.txt'), agentFile('Explore'));
    await fs.writeFile(path.join(agentsRoot, 'review.md'), agentFile('Review'));
    expect(await scan()).toEqual({ ok: true, value: undefined });
  });

  it('never follows a symlink, to a file or to a directory', async () => {
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'explore.md'), agentFile('Explore'));
    await fs.symlink(path.join(outside, 'explore.md'), path.join(agentsRoot, 'linked-file.md'));
    await fs.symlink(outside, path.join(agentsRoot, 'linked-dir'));
    expect(await scan()).toEqual({ ok: true, value: undefined });
  });

  it('reads only the first bytes: a name past the bounded read is not seen', async () => {
    const padding = 'x'.repeat(FRONTMATTER_READ_BYTES + 100);
    await fs.writeFile(
      path.join(agentsRoot, 'padded.md'),
      `---\ndescription: ${padding}\nname: Explore\n---\n`,
    );
    expect(await scan()).toEqual({ ok: true, value: undefined });
  });

  it('stops descending at the depth bound', async () => {
    let deep = agentsRoot;
    for (let level = 0; level <= MAX_AGENT_SCAN_DEPTH; level++) deep = path.join(deep, `d${level}`);
    await fs.mkdir(deep, { recursive: true });
    await fs.writeFile(path.join(deep, 'explore.md'), agentFile('Explore'));
    expect(await scan()).toEqual({ ok: true, value: undefined });
  });

  it('reports no owner when the agents directory does not exist', async () => {
    await fs.rm(agentsRoot, { recursive: true, force: true });
    expect(await scan()).toEqual({ ok: true, value: undefined });
  });

  it('returns an error outcome, never a throw, when the agents path is not a directory', async () => {
    await fs.rm(agentsRoot, { recursive: true, force: true });
    await fs.writeFile(agentsRoot, 'a file where a directory should be');
    const outcome = await scan();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe('unreadable-root');
  });

  it('treats a directory named like a markdown file as a directory and keeps scanning', async () => {
    await fs.mkdir(path.join(agentsRoot, 'a-dir.md'));
    const mine = path.join(agentsRoot, 'z-explore.md');
    await fs.writeFile(mine, agentFile('Explore'));
    expect(await scan()).toEqual({ ok: true, value: mine });
  });
});

describe('installViaFileCopy: devflow\'s Explore against a user-owned one (AC-303)', () => {
  let claudeDir: string;
  let devflowDir: string;
  let warnings: string[];

  beforeEach(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-explore-install-'));
    claudeDir = path.join(root, '.claude');
    devflowDir = path.join(root, '.devflow');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });
    warnings = [];
  });

  afterEach(async () => {
    await fs.rm(path.dirname(claudeDir), { recursive: true, force: true });
  });

  const plugins: PluginDefinition[] = ['devflow-plan', 'devflow-explore'].map(name => {
    const found = DEVFLOW_PLUGINS.find(p => p.name === name);
    if (found === undefined) throw new Error(`no such plugin: ${name}`);
    return found;
  });

  const install = (): Promise<unknown> => {
    const { skillsMap, agentsMap } = buildAssetMaps(plugins);
    return installViaFileCopy({
      curation: true,
      plugins,
      effectivePlugins: plugins,
      claudeDir,
      devflowDir,
      skillsMap,
      agentsMap,
      isPartialInstall: false,
      spinner: noopSpinner,
      warn: msg => { warnings.push(msg); },
    });
  };

  const installed = (name: string): string => path.join(claudeDir, 'agents', 'devflow', `${name}.md`);

  async function exists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
  }

  it('ships explore.md into the devflow agent directory on a clean machine', async () => {
    await install();
    const shipped = await fs.readFile(installed('explore'), 'utf-8');
    expect(shipped).toBe(resolveAgentSource('explore').content);
    expect(warnings.filter(w => /explore/i.test(w))).toEqual([]);
  });

  it('leaves a user-owned Explore byte-identical, skips devflow\'s copy and warns', async () => {
    const mine = path.join(claudeDir, 'agents', 'explore.md');
    const mineBytes = agentFile('Explore', 'My own explorer, tuned for my monorepo.\n');
    await fs.mkdir(path.dirname(mine), { recursive: true });
    await fs.writeFile(mine, mineBytes);

    await install();

    expect(await fs.readFile(mine, 'utf-8')).toBe(mineBytes);
    expect(await exists(installed('explore'))).toBe(false);
    expect(await exists(installed('skim'))).toBe(true);
    const notice = warnings.filter(w => w.includes(mine));
    expect(notice).toHaveLength(1);
    expect(notice[0]).toMatch(/Explore/);
  });

  it('removes a devflow copy left by an earlier install once the user defines Explore', async () => {
    await install();
    expect(await exists(installed('explore'))).toBe(true);

    const mine = path.join(claudeDir, 'agents', 'mine.md');
    await fs.writeFile(mine, agentFile('Explore'));
    warnings = [];
    await install();

    expect(await exists(installed('explore'))).toBe(false);
    expect(await exists(mine)).toBe(true);
    expect(warnings.filter(w => w.includes(mine))).toHaveLength(1);
  });

  it('still ships devflow\'s Explore when the user\'s agent is a different type', async () => {
    await fs.mkdir(path.join(claudeDir, 'agents'), { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'agents', 'explore.md'), agentFile('explore'));
    await install();
    expect(await exists(installed('explore'))).toBe(true);
  });
});

describe('the override table names the shipped agent\'s real type', () => {
  it('maps the explore registry name to the frontmatter name devflow\'s explore.md ships', () => {
    const split = splitFrontmatter(resolveAgentSource('explore').content);
    expect(split, 'explore.md has a frontmatter block').not.toBeNull();
    expect(split?.inner).toMatch(new RegExp(`^name: ${BUILTIN_OVERRIDE_AGENTS.get('explore')}$`, 'm'));
  });
});

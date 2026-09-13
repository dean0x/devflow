/**
 * Agent-source precedence guard.
 *
 * The dist-first agent-resolution policy has exactly one owner: `agentSourceDirs()`
 * in src/core/assets.ts, which returns the source directories MOST-PREFERRED FIRST.
 * Three consumers read that order — the installer's first-hit-wins resolve,
 * `loadShippedDefaults`'s first-wins merge, and the test harness's
 * `resolveAgentSource`. This guard pins that they AGREE: fed the same directory
 * list, every registry agent resolves out of the same tree in all of them.
 *
 * Order is invisible to the type system: both consumers take the same list of
 * strings, so a site that spells the policy least-preferred-first still compiles
 * and silently inverts the answer. Only a cross-consumer agreement assertion
 * catches that, and only a reversed-list probe proves the assertion is not
 * order-blind (ADR-024).
 *
 * PF-043: every fixture is derived from the real agent files rather than
 * hand-authored, so the tree the assertions run against is a shape the runtime
 * actually produces.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs, existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { installViaFileCopy } from '../../src/targets/claude-code/installer.js';
import { loadShippedDefaults } from '../../src/core/agent-models.js';
import { agentSourceDirs, agentsDir, compiledAgentsDir, type AgentSourceDirs } from '../../src/core/assets.js';
import { readFrontmatterModel } from '../../src/core/agent-frontmatter.js';
import { buildAssetMaps, getAllAgentNames } from '../../src/core/plugins.js';
import type { PluginDefinition } from '../../src/core/plugins.js';
import { resolveAgentSource, splitFrontmatter } from '../helpers.js';

const spinner = { start: () => {}, stop: () => {}, message: () => {} };

/** Every registry agent, installed by a single synthetic plugin. */
const ALL_AGENTS = getAllAgentNames();

/** Agents the real build compiles into the dist tree — the dist-wins population. */
const COMPILED_AGENTS = ALL_AGENTS.filter(
  name => existsSync(path.join(compiledAgentsDir(), `${name}.md`)),
);

/** Sentinel models: distinct, both valid model names. */
const DIST_MODEL = 'opus';
const SRC_MODEL = 'haiku';

function fixturePlugin(): PluginDefinition {
  return {
    name: 'devflow-test-agent-precedence',
    description: 'Test fixture for agent-source precedence',
    commands: [],
    agents: [...ALL_AGENTS],
    skills: [],
    optional: false,
    rules: [],
  };
}

/**
 * Install every registry agent into a fresh claude dir and return the installed
 * content keyed by agent name.
 */
async function installAll(root: string, dirs?: AgentSourceDirs): Promise<Map<string, string>> {
  const plugin = fixturePlugin();
  const claudeDir = await fs.mkdtemp(path.join(root, 'claude-'));
  await installViaFileCopy({
    plugins: [plugin],
    claudeDir,
    devflowDir: path.join(claudeDir, 'devflow'),
    skillsMap: new Map(),
    agentsMap: buildAssetMaps([plugin]).agentsMap,
    isPartialInstall: false,
    spinner,
    ...(dirs === undefined ? {} : { agentSourceDirs: dirs }),
  });

  const installed = new Map<string, string>();
  for (const name of ALL_AGENTS) {
    installed.set(
      name,
      await fs.readFile(path.join(claudeDir, 'agents', 'devflow', `${name}.md`), 'utf-8'),
    );
  }
  return installed;
}

/** Model recorded in a piece of agent content — the observable both consumers share. */
function modelOf(content: string): string {
  const result = readFrontmatterModel(content);
  if (!result.ok || !result.value) {
    throw new Error('agent content carries no frontmatter model — fixture is malformed');
  }
  return result.value;
}

describe('agentSourceDirs() owns the dist-first policy', () => {
  it('lists the compiled directory before the source directory', () => {
    expect(agentSourceDirs()).toEqual([compiledAgentsDir(), agentsDir()]);
  });

  it('resolves both directories against an injected root', () => {
    const root = path.join(os.tmpdir(), 'devflow-precedence-root');
    for (const dir of agentSourceDirs(root)) {
      expect(dir.startsWith(root), `${dir} must be rooted at the injected root`).toBe(true);
    }
  });

  it('names at least two directories, compiled first (non-vacuity)', () => {
    const dirs = agentSourceDirs();
    expect(dirs.length).toBeGreaterThan(1);
    expect(dirs[0]).toBe(compiledAgentsDir());
  });
});

describe('installer and loadShippedDefaults agree on every registry agent', () => {
  let tmpRoot: string;
  let distDir: string;
  let srcDir: string;

  /**
   * Write one fixture tree: each named agent's real frontmatter with the model
   * replaced by a sentinel, so the tree an answer came from is observable in the
   * installed bytes and in the parsed default alike (PF-043).
   */
  async function writeTree(dir: string, names: readonly string[], model: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    for (const name of names) {
      const real = resolveAgentSource(name).content;
      const fm = splitFrontmatter(real);
      if (!fm) throw new Error(`agent '${name}' has no frontmatter — fixture cannot be derived`);
      const block = fm.block.replace(/^model:.*$/m, `model: ${model}`);
      await fs.writeFile(path.join(dir, `${name}.md`), `${block}\nbody\n`, 'utf-8');
    }
  }

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-agent-precedence-'));
    distDir = path.join(tmpRoot, 'dist-agents');
    srcDir = path.join(tmpRoot, 'src-agents');
    await writeTree(distDir, COMPILED_AGENTS, DIST_MODEL);
    await writeTree(srcDir, ALL_AGENTS, SRC_MODEL);
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('the fixture split is non-vacuous: some agents are compiled, some are not', () => {
    expect(COMPILED_AGENTS.length, 'no compiled agent — run `npm run build:mds`').toBeGreaterThan(0);
    expect(
      COMPILED_AGENTS.length,
      'every agent is compiled — the src-fallback arm would go unexercised',
    ).toBeLessThan(ALL_AGENTS.length);
  });

  it('both consumers pick the same tree for every agent, given the same list', async () => {
    const dirs: AgentSourceDirs = [distDir, srcDir];
    const installed = await installAll(tmpRoot, dirs);
    const defaults = await loadShippedDefaults(dirs);

    for (const name of ALL_AGENTS) {
      const expected = COMPILED_AGENTS.includes(name) ? DIST_MODEL : SRC_MODEL;
      expect(
        modelOf(installed.get(name)!),
        `installer resolved agent '${name}' from the wrong tree`,
      ).toBe(expected);
      expect(
        defaults[name],
        `loadShippedDefaults resolved agent '${name}' from the wrong tree`,
      ).toBe(expected);
      expect(
        defaults[name],
        `installer and loadShippedDefaults disagree on agent '${name}'`,
      ).toBe(modelOf(installed.get(name)!));
    }
  });

  it('known-bad probe: a reversed list flips BOTH consumers, and is detected', async () => {
    // ADR-024 — if the assertion above were order-blind it would also pass here.
    const reversed: AgentSourceDirs = [srcDir, distDir];
    const installed = await installAll(tmpRoot, reversed);
    const defaults = await loadShippedDefaults(reversed);

    for (const name of ALL_AGENTS) {
      expect(modelOf(installed.get(name)!), `installer ignored the reversed order for '${name}'`).toBe(SRC_MODEL);
      expect(defaults[name], `loadShippedDefaults ignored the reversed order for '${name}'`).toBe(SRC_MODEL);
    }

    // The reversal must actually change the answer for the compiled population,
    // or the canonical assertion above proves nothing about ordering.
    for (const name of COMPILED_AGENTS) {
      expect(modelOf(installed.get(name)!), `reversing the list left '${name}' unchanged`).not.toBe(DIST_MODEL);
    }
  });
});

describe('the real tree resolves identically in all three consumers', () => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-agent-precedence-real-'));
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('the installer installs byte-for-byte what resolveAgentSource resolves', async () => {
    const installed = await installAll(tmpRoot);
    for (const name of ALL_AGENTS) {
      expect(
        installed.get(name),
        `installed '${name}' differs from the harness-resolved source`,
      ).toBe(resolveAgentSource(name).content);
    }
  });

  it('both resolution arms are exercised on the real tree (non-vacuity)', () => {
    const origins = ALL_AGENTS.map(name => resolveAgentSource(name).origin);
    expect(origins, 'no agent resolves from the compiled tree').toContain('dist');
    expect(origins, 'no agent resolves from the source tree').toContain('src');
  });

  it('loadShippedDefaults reports the model of the file the resolver picked', async () => {
    const defaults = await loadShippedDefaults();
    for (const name of ALL_AGENTS) {
      expect(
        defaults[name],
        `loadShippedDefaults read agent '${name}' from a different file than the resolver`,
      ).toBe(modelOf(resolveAgentSource(name).content));
    }
  });
});

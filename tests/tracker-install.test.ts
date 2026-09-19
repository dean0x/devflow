/**
 * Tests for src/targets/claude-code/tracker-install.ts and the installer's
 * provider-scoped reference overlay.
 *
 * Two artifacts converge with the tracker provider, and they belong to different
 * owners on purpose (design review M2):
 *   - the Tracker AGENT file — `convergeTrackerArtifacts`, which owns it alone
 *     and carries no overlay mode flag;
 *   - the generated REFERENCE subtree — `overlayInstalledReferences`, the
 *     installer's export, because it is the installer's one overlay spelling.
 * `devflow tracker --set` calls both, explicitly, in the fixed order.
 *
 * Both directions of every biconditional are tested: an artifact that installs
 * under jira and never leaves under github is the drifted state this file
 * exists to make impossible (applies PF-015).
 *
 * HOME safety (applies PF-060): every test injects an mkdtemp claudeDir. No test
 * reads or writes the real ~/.claude, and no test shells out to dist/cli.js.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

import { convergeTrackerArtifacts } from '../src/targets/claude-code/tracker-install.js';
import { overlayInstalledReferences } from '../src/targets/claude-code/installer.js';
import { installedReferenceManifest } from '../src/core/mds-variants.js';
import { compiledSkillRefsDir } from '../src/core/assets.js';

let claudeDir: string;
let warnings: string[];

const warn = (msg: string): void => { warnings.push(msg); };
const agentFile = (): string => path.join(claudeDir, 'agents', 'devflow', 'tracker.md');
const refsTarget = (): string => path.join(claudeDir, 'skills', 'devflow:git', 'references');

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

beforeEach(async () => {
  claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-install-'));
  warnings = [];
});

afterEach(async () => {
  await fs.rm(claudeDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// convergeTrackerArtifacts — the agent file, biconditional in both directions
// ---------------------------------------------------------------------------

describe('convergeTrackerArtifacts: the Tracker agent file', () => {
  it.each(['jira', 'linear'] as const)('installs the agent under %s', async (provider) => {
    const result = await convergeTrackerArtifacts({ claudeDir, provider, warn });
    expect(result.converged).toBe(true);
    expect(result.agent).toBe('installed');
    expect(await exists(agentFile())).toBe(true);
    const body = await fs.readFile(agentFile(), 'utf-8');
    expect(body.length, 'the copy must carry the agent, not an empty file').toBeGreaterThan(0);
    expect(warnings).toEqual([]);
  });

  it('removes a stale agent when the provider returns to github (the other direction)', async () => {
    await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    expect(await exists(agentFile())).toBe(true);

    const result = await convergeTrackerArtifacts({ claudeDir, provider: 'github', warn });
    expect(result.converged).toBe(true);
    expect(result.agent).toBe('removed');
    expect(
      await exists(agentFile()),
      'a github user must not be left carrying an agent no directive can spawn',
    ).toBe(false);
  });

  it('is idempotent in both states — a second run reports unchanged', async () => {
    await convergeTrackerArtifacts({ claudeDir, provider: 'github', warn });
    const githubAgain = await convergeTrackerArtifacts({ claudeDir, provider: 'github', warn });
    expect(githubAgain.agent).toBe('unchanged');
    expect(await exists(agentFile())).toBe(false);

    await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    const jiraAgain = await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    expect(jiraAgain.agent, 'a re-copy that changes nothing is still a converged state').toBe('installed');
    expect(await exists(agentFile())).toBe(true);
  });

  it('self-heals a corrupted agent file rather than trusting its presence', async () => {
    await fs.mkdir(path.dirname(agentFile()), { recursive: true });
    await fs.writeFile(agentFile(), 'truncated\n', 'utf-8');
    await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    const body = await fs.readFile(agentFile(), 'utf-8');
    expect(body).not.toBe('truncated\n');
    expect(body.length).toBeGreaterThan(100);
  });

  it('a relative claudeDir is refused, not resolved (precondition)', async () => {
    const result = await convergeTrackerArtifacts({ claudeDir: 'relative/path', provider: 'jira', warn });
    expect(result.converged).toBe(false);
    expect(warnings.join('\n')).toMatch(/absolute/);
  });

  it('reports converged=false when the copy cannot be made (warn-not-throw)', async () => {
    // The agents directory exists as a FILE, so mkdir and copyFile both fail.
    await fs.mkdir(path.join(claudeDir, 'agents'), { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'agents', 'devflow'), 'not a directory\n', 'utf-8');

    const result = await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    expect(result.converged, 'a failed convergence must not report success').toBe(false);
    expect(warnings.length, 'the failure must be reported, not swallowed').toBeGreaterThan(0);
  });

  it('never throws — callers gate on converged, they do not catch', async () => {
    await expect(
      convergeTrackerArtifacts({ claudeDir: path.join(claudeDir, 'nope'), provider: 'github', warn }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// overlayInstalledReferences — the provider-scoped reference subtree
// ---------------------------------------------------------------------------

describe('overlayInstalledReferences: the provider-scoped subtree', () => {
  async function listRefs(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), next);
        else out.push(next);
      }
    };
    await walk(refsTarget(), '');
    return out.sort();
  }

  it.each(['github', 'jira', 'linear'] as const)('installs exactly the %s manifest', async (provider) => {
    const result = await overlayInstalledReferences({ claudeDir, provider, warn });
    expect(result.overlayFailures).toEqual([]);
    const manifest = installedReferenceManifest({ provider });
    expect([...result.overlaidRefs].sort()).toEqual([...manifest].sort());
    expect(await listRefs()).toEqual([...manifest].sort());
  });

  it('every installed file is byte-equal to the generated source', async () => {
    await overlayInstalledReferences({ claudeDir, provider: 'jira', warn });
    for (const rel of installedReferenceManifest({ provider: 'jira' })) {
      const installed = await fs.readFile(path.join(refsTarget(), ...rel.split('/')));
      const generated = await fs.readFile(path.join(compiledSkillRefsDir(), ...rel.split('/')));
      expect(installed.equals(generated), `${rel} must be byte-equal`).toBe(true);
    }
  });

  it('a provider swap removes the previous provider and keeps the github floor', async () => {
    await overlayInstalledReferences({ claudeDir, provider: 'jira', warn });
    expect((await listRefs()).some(r => r.startsWith('tracker/jira/'))).toBe(true);

    await overlayInstalledReferences({ claudeDir, provider: 'linear', warn });
    const after = await listRefs();
    expect(after.some(r => r.startsWith('tracker/jira/')), 'the old provider must be pruned').toBe(false);
    expect(after.some(r => r.startsWith('tracker/linear/'))).toBe(true);
    expect(
      after.filter(r => r.startsWith('tracker/github/')).length,
      'github is the floor under every provider — PR hosting does not move',
      ).toBe(installedReferenceManifest({ provider: 'github' }).filter(r => r.startsWith('tracker/github/')).length);
  });

  it('narrowing to github prunes _mcp.md and both provider trees', async () => {
    await overlayInstalledReferences({ claudeDir, provider: 'linear', warn });
    expect(await listRefs()).toContain('tracker/_mcp.md');

    await overlayInstalledReferences({ claudeDir, provider: 'github', warn });
    const after = await listRefs();
    expect(after).not.toContain('tracker/_mcp.md');
    expect(after.some(r => r.startsWith('tracker/linear/'))).toBe(false);
    expect(after).toEqual([...installedReferenceManifest({ provider: 'github' })].sort());
  });

  it('throws — rather than degrading — when the generated tree is absent (PF-013 seam)', async () => {
    // The injectable root is what makes this arm provable without deleting dist/.
    await expect(
      overlayInstalledReferences({
        claudeDir,
        provider: 'github',
        warn,
        referencesRoot: path.join(claudeDir, 'no-such-generated-tree'),
      }),
    ).rejects.toThrow(/Generated skill references not found/);
    expect(
      await exists(refsTarget()),
      'the refusal must come before the target is touched — nothing installed, nothing abandoned',
    ).toBe(false);
  });
});

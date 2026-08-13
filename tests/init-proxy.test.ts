/**
 * TEST-5: Init proxy apply-pass ordering — reapplyAgentMapping must run AFTER
 * the proxy preflight block so dormancy uses the FINAL proxyEnabled value.
 *
 * If reapplyAgentMapping ran before a failing preflight forced proxyEnabled=false,
 * GPT model lines would be written into agent frontmatter even though the proxy
 * is disabled — breaking the dormancy invariant (KB: "must run AFTER preflight
 * resolves the final proxyEnabled value").
 *
 * Test strategy: use the injectable seams (runProxyPreflight with injected
 * failing/passing deps + reapplyAgentMapping with a temp installDir) to drive
 * the exact same ordering logic init.ts uses, and assert the outcome on disk.
 *
 * Initial agent file always uses a neutral model ('claude-opus-4-5') that is
 * neither the shipped default ('sonnet') nor any GPT model — this guarantees
 * every reapply path triggers a file write, making 'updated' assertions stable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runProxyPreflight, type ProxyPreflightDeps } from '../src/cli/commands/proxy.js';
import { reapplyAgentMapping, saveAgentMapping, type AgentMappingFile } from '../src/core/agent-models.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Agent frontmatter — model must differ from shipped default AND from GPT models. */
const NEUTRAL_INITIAL_MODEL = 'claude-opus-4-5';

/** Build a minimal agent file with the given model. */
function makeAgentFrontmatter(model: string): string {
  return `---\nmodel: ${model}\ndescription: Test agent\n---\n\nAgent body.\n`;
}

/**
 * Known GPT model IDs — literal list so this test file does not depend on the
 * hardcoded registry in external-models.ts (which is deleted in Commit 9).
 * These match the subswitch@0.2.0 catalog used throughout the Phase D tests.
 * applies ADR-003: end-state only — no externalModelIds() import.
 */
const GPT_IDS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'];

/** Pick a known GPT model ID for the mapping. */
const A_GPT_MODEL = GPT_IDS[0]!; // 'gpt-5.6-sol'

/**
 * Failing preflight deps — resolveProxyBin returns an error so the preflight
 * returns Err without reaching fileExists / tcpConnectable / spawnDoctor.
 */
function makeFailingPreflightDeps(overrides: Partial<ProxyPreflightDeps> = {}): ProxyPreflightDeps {
  return {
    resolveProxyBin: () =>
      Promise.resolve({ ok: false, error: 'routing runtime missing — reinstall devflow-kit' }),
    fileExists: () => Promise.resolve(true),
    tcpConnectable: () => Promise.resolve(false),
    httpGet: () => Promise.resolve({ ok: false, error: 'unreachable' }),
    readSettingsJson: () => Promise.resolve('{}'),
    spawnDoctor: () => Promise.resolve(0),
    ...overrides,
  };
}

/**
 * Passing preflight deps — port not yet accepting (free) → Ok({adopted:false}).
 * spawnDoctor is retained in the interface for backward compat but is no longer
 * called by runProxyPreflight (doctor moved to runPostSpawnVerification post-spawn).
 */
function makePassingPreflightDeps(): ProxyPreflightDeps {
  return {
    resolveProxyBin: () =>
      Promise.resolve({ ok: true, value: { binPath: '/path/relay.js', npxWarning: false } }),
    fileExists: () => Promise.resolve(true),   // codex auth exists
    tcpConnectable: () => Promise.resolve(false), // port free
    httpGet: () => Promise.resolve({ ok: false, error: 'not called when port free' }),
    readSettingsJson: () => Promise.resolve('{}'), // no foreign ANTHROPIC_BASE_URL
    spawnDoctor: () => Promise.resolve(0),     // interface compat; not called by preflight
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('init proxy apply-pass ordering (TEST-5)', () => {
  let tmpDir: string;
  let devflowDir: string;
  let installDir: string;
  const agentName = 'coder'; // registered agent — reapply will find + update it

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-init-proxy-'));
    devflowDir = path.join(tmpDir, '.devflow');
    installDir = path.join(tmpDir, 'agents');
    await fs.mkdir(devflowDir, { recursive: true });
    await fs.mkdir(installDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /** Write the agent file and mapping used by every test. */
  async function seedAgentAndMapping(): Promise<void> {
    await fs.writeFile(
      path.join(installDir, `${agentName}.md`),
      makeAgentFrontmatter(NEUTRAL_INITIAL_MODEL),
      'utf-8',
    );
    const mapping: AgentMappingFile = {
      version: 1,
      agents: { [agentName]: { model: A_GPT_MODEL } },
    };
    await saveAgentMapping(devflowDir, mapping);
  }

  it('CORRECT ORDER: failing preflight → proxyEnabled=false → reapply enforces dormancy (no GPT model)', async () => {
    await seedAgentAndMapping();

    let proxyEnabled = true; // init seeds this from the manifest

    // Step 1 — preflight (simulates init's preflight block with failing deps).
    const preflightResult = await runProxyPreflight(
      4141,
      '/home/.codex/auth.json',
      '/home/.devflow/proxy-routing.json',
      '/home/.devflow/logs/proxy.log',
      makeFailingPreflightDeps(),
    );

    // Step 2 — force off on failure (mirrors init.ts preflight-result block).
    if (!preflightResult.ok) {
      proxyEnabled = false;
    }

    // Step 3 — reapply AFTER preflight resolves the final value.
    const reapplyResult = await reapplyAgentMapping({
      proxyEnabled, // now false — dormancy applies
      installDir,
      devflowDir,
    });

    const agentContent = await fs.readFile(path.join(installDir, `${agentName}.md`), 'utf-8');

    // Primary invariant: dormancy must suppress the GPT model.
    expect(agentContent).not.toContain(A_GPT_MODEL);

    // File was updated (NEUTRAL_INITIAL_MODEL → shipped default, since initial ≠ dormant default).
    expect(reapplyResult.updated).toContain(agentName);

    // Preflight failed → proxyEnabled was forced to false.
    expect(preflightResult.ok).toBe(false);
    expect(proxyEnabled).toBe(false);
  });

  it('CORRECT ORDER: successful preflight → proxyEnabled=true → reapply materializes GPT model', async () => {
    await seedAgentAndMapping();

    let proxyEnabled = true;

    const preflightResult = await runProxyPreflight(
      4141,
      '/home/.codex/auth.json',
      '/home/.devflow/proxy-routing.json',
      '/home/.devflow/logs/proxy.log',
      makePassingPreflightDeps(),
    );

    if (!preflightResult.ok) proxyEnabled = false;

    const reapplyResult = await reapplyAgentMapping({
      proxyEnabled, // true — GPT model materializes
      installDir,
      devflowDir,
    });

    const agentContent = await fs.readFile(path.join(installDir, `${agentName}.md`), 'utf-8');

    // GPT model must be present in frontmatter when proxy is enabled.
    expect(agentContent).toContain(A_GPT_MODEL);
    expect(agentContent).not.toContain(NEUTRAL_INITIAL_MODEL);

    expect(preflightResult.ok).toBe(true);
    expect(proxyEnabled).toBe(true);
    expect(reapplyResult.updated).toContain(agentName);
  });

  it('WRONG ORDER (violation doc): reapply before preflight failure → GPT model materializes despite proxy being disabled', async () => {
    // This test documents the VIOLATION that the correct ordering prevents.
    // It is NOT testing correct init behavior — it demonstrates why ordering matters.
    await seedAgentAndMapping();

    // WRONG: reapply is called BEFORE preflight — proxyEnabled is still true.
    await reapplyAgentMapping({ proxyEnabled: true, installDir, devflowDir });

    const agentContentAfterEarlyReapply = await fs.readFile(
      path.join(installDir, `${agentName}.md`),
      'utf-8',
    );
    // GPT model written too early — this is the dormancy invariant violation.
    expect(agentContentAfterEarlyReapply).toContain(A_GPT_MODEL);

    // Now preflight fails — too late to prevent the violation.
    const preflightResult = await runProxyPreflight(
      4141,
      '/home/.codex/auth.json',
      '/home/.devflow/proxy-routing.json',
      '/home/.devflow/logs/proxy.log',
      makeFailingPreflightDeps(),
    );
    expect(preflightResult.ok).toBe(false);

    // File still has GPT model — violation confirmed.
    // The correct-order tests above show that when reapply runs AFTER preflight,
    // the dormancy rule suppresses the GPT model entry.
    const agentContentAfterPreflight = await fs.readFile(
      path.join(installDir, `${agentName}.md`),
      'utf-8',
    );
    expect(agentContentAfterPreflight).toContain(A_GPT_MODEL); // documents the bug
  });
});

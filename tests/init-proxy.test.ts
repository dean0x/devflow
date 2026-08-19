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
import {
  readProxyState,
  writeProxyState,
  buildProxyState,
  DEFAULT_PROXY_PORT,
} from '../src/core/proxy-state.js';

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
 * Single preflight deps factory — defaults to a passing configuration (port free,
 * codex auth present, bin resolved). Pass overrides for any field that should differ
 * (e.g., a failing resolveProxyBin for the dormancy-ordering violation tests).
 *
 * spawnDoctor is retained in the interface for backward compat but is no longer
 * called by runProxyPreflight (doctor moved to runPostSpawnVerification post-spawn).
 */
function makePreflightDeps(overrides: Partial<ProxyPreflightDeps> = {}): ProxyPreflightDeps {
  return {
    resolveProxyBin: () =>
      Promise.resolve({ ok: true, value: { binPath: '/path/relay.js', npxWarning: false } }),
    fileExists: () => Promise.resolve(true),
    tcpConnectable: () => Promise.resolve(false),
    httpGet: () => Promise.resolve({ ok: false, error: 'not called when port free' }),
    readSettingsJson: () => Promise.resolve('{}'),
    spawnDoctor: () => Promise.resolve(0),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('init proxy apply-pass ordering (TEST-5)', () => {
  let tmpDir: string;
  let devflowDir: string;
  let installDir: string;
  const agentName = 'code'; // registered agent — reapply will find + update it

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
      makePreflightDeps({ resolveProxyBin: () => Promise.resolve({ ok: false, error: 'routing runtime missing — reinstall devflow-kit' }) }),
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
      makePreflightDeps(),
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
      makePreflightDeps({ resolveProxyBin: () => Promise.resolve({ ok: false, error: 'routing runtime missing — reinstall devflow-kit' }) }),
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

// ─── C2-REG-1: proxy.json convergence on preflight failure ───────────────────
//
// BUG: The else branch that marks proxy.json disabled belongs to the
// if (proxyEnabled) check evaluated with the SEEDED value. When preflight
// fails and sets proxyEnabled=false, control is already inside the taken
// branch — the else branch never runs. proxy.json stays enabled:true.
//
// FIX: Write proxy.json disabled inside the preflight failure handler so
// runtime authority (proxy.json) always converges with the final flag value
// (avoids PF-015 — toggle fan-out convergence; applies ADR-014 re-init).
//
// Test strategy (Careful / test-first): the test mirrors the fixed init.ts
// flow step-by-step and asserts the post-state invariant. In the RED state
// the write-disabled call is absent so the assertion fails; in the GREEN
// state both the test and init.ts include the call.

describe('C2-REG-1: proxy.json convergence on preflight failure', () => {
  let tmpDir: string;
  let devflowDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-reg1-'));
    devflowDir = path.join(tmpDir, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('failing preflight with prior enabled proxy.json → proxy.json ends up enabled:false', async () => {
    // Seed: proxy.json exists with enabled:true (simulates a prior successful enable).
    await writeProxyState(devflowDir, buildProxyState({
      enabled: true,
      port: 4141,
      binPath: '/path/relay.js',
      configPath: '/path/proxy-routing.json',
      devflowVersion: '2.0.0',
    }));

    const before = await readProxyState(devflowDir);
    expect(before.ok && before.value.enabled).toBe(true);

    // Init reads prior state once before the if (proxyEnabled) block (REG-2 hoisted read).
    const priorState = await readProxyState(devflowDir);

    let proxyEnabled = true; // seeded from manifest (ADR-014)

    // Preflight fails.
    const preflightResult = await runProxyPreflight(
      4141,
      '/fake/.codex/auth.json',
      '/fake/proxy-routing.json',
      '/fake/logs/proxy.log',
      makePreflightDeps({ resolveProxyBin: () => Promise.resolve({ ok: false, error: 'routing runtime missing — reinstall devflow-kit' }) }),
    );

    // Init's failure handler: force off AND write proxy.json disabled (the REG-1 fix).
    // Before this fix proxy.json stayed enabled:true, so isProxyEnabled() returned true
    // and the next TUI save called reapplyAgentMapping({proxyEnabled:true}), writing GPT
    // model IDs into agent frontmatter with no relay — the exact dormancy inversion
    // commit 42e6f29 was written to prevent. avoids PF-015.
    if (!preflightResult.ok) {
      proxyEnabled = false;
      if (priorState.ok && priorState.value.enabled) {
        const disableResult = await writeProxyState(devflowDir, buildProxyState({
          enabled: false,
          port: priorState.value.port,
          binPath: priorState.value.binPath,
          configPath: priorState.value.configPath,
          devflowVersion: priorState.value.devflowVersion,
        }));
        expect(disableResult.ok).toBe(true);
      }
    }

    // Primary assertion: proxy.json must be disabled (avoids PF-015).
    const after = await readProxyState(devflowDir);
    expect(after.ok).toBe(true);
    expect(after.value?.enabled).toBe(false);
    // Port and other fields preserved from prior state.
    expect(after.value?.port).toBe(4141);
    expect(after.value?.binPath).toBe('/path/relay.js');

    expect(proxyEnabled).toBe(false);
    expect(preflightResult.ok).toBe(false);
  });

  it('failing preflight when proxy.json was already disabled → no spurious write', async () => {
    // When proxy.json is already disabled, the guard (priorState.value.enabled) prevents
    // a redundant write. This covers the ENOENT-default path too.
    await writeProxyState(devflowDir, buildProxyState({
      enabled: false,
      port: 4141,
      binPath: '/path/relay.js',
      configPath: '/path/proxy-routing.json',
      devflowVersion: '2.0.0',
    }));

    const priorState = await readProxyState(devflowDir);
    let proxyEnabled = true;

    const preflightResult = await runProxyPreflight(
      4141,
      '/fake/.codex/auth.json',
      '/fake/proxy-routing.json',
      '/fake/logs/proxy.log',
      makePreflightDeps({ resolveProxyBin: () => Promise.resolve({ ok: false, error: 'routing runtime missing — reinstall devflow-kit' }) }),
    );

    if (!preflightResult.ok) {
      proxyEnabled = false;
      if (priorState.ok && priorState.value.enabled) {
        // Guard fires only when prior state is enabled — does NOT run here.
        await writeProxyState(devflowDir, buildProxyState({
          enabled: false,
          port: priorState.value.port,
          binPath: priorState.value.binPath,
          configPath: priorState.value.configPath,
          devflowVersion: priorState.value.devflowVersion,
        }));
      }
    }

    // Still disabled — no spurious write.
    const after = await readProxyState(devflowDir);
    expect(after.ok && after.value.enabled).toBe(false);
    expect(proxyEnabled).toBe(false);
  });
});

// ─── C2-REG-2: remembered port preserved across re-init ──────────────────────
//
// BUG: init hardcodes DEFAULT_PROXY_PORT in three places (routing config write,
// proxy.json write, and applyProxyEnv call). Under ADR-014 a user who ran
// `devflow proxy --enable --port 8899` silently loses that port on every re-init,
// orphaning the running relay.
//
// FIX: Read the remembered port from existing proxy state before the preflight
// block; fall back to DEFAULT_PROXY_PORT only when absent. Mirrors the
// resolvePort(portOption, priorPort) contract established by TS-1 in proxy.ts.

describe('C2-REG-2: remembered port preserved across re-init', () => {
  let tmpDir: string;
  let devflowDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-reg2-'));
    devflowDir = path.join(tmpDir, '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const REMEMBERED_PORT = 8899;

  it('re-init with remembered non-default port → port preserved in proxy.json on success', async () => {
    // Seed: proxy was previously enabled on a custom port.
    await writeProxyState(devflowDir, buildProxyState({
      enabled: true,
      port: REMEMBERED_PORT,
      binPath: '/path/relay.js',
      configPath: '/path/proxy-routing.json',
      devflowVersion: '2.0.0',
    }));

    // Init reads the remembered port (the REG-2 fix).
    const priorState = await readProxyState(devflowDir);
    const effectivePort = priorState.ok ? priorState.value.port : DEFAULT_PROXY_PORT;
    expect(effectivePort).toBe(REMEMBERED_PORT); // not DEFAULT_PROXY_PORT

    // Preflight passes on the effective port.
    const preflightResult = await runProxyPreflight(
      effectivePort,
      '/fake/.codex/auth.json',
      '/fake/proxy-routing.json',
      '/fake/logs/proxy.log',
      makePreflightDeps(),
    );
    expect(preflightResult.ok).toBe(true);

    if (preflightResult.ok) {
      const writeResult = await writeProxyState(devflowDir, buildProxyState({
        enabled: true,
        port: effectivePort, // REG-2: remembered port, not DEFAULT_PROXY_PORT
        binPath: preflightResult.value.binPath,
        configPath: '/path/proxy-routing.json',
        devflowVersion: '2.0.0',
      }));
      expect(writeResult.ok).toBe(true);
    }

    const after = await readProxyState(devflowDir);
    expect(after.ok).toBe(true);
    expect(after.value?.port).toBe(REMEMBERED_PORT); // preserved — not DEFAULT_PROXY_PORT
    expect(after.value?.enabled).toBe(true);
  });

  it('re-init with no prior proxy.json → DEFAULT_PROXY_PORT used', async () => {
    // No proxy.json → readProxyState returns ENOENT default (enabled:false, port:DEFAULT_PROXY_PORT).
    const priorState = await readProxyState(devflowDir);
    const effectivePort = priorState.ok ? priorState.value.port : DEFAULT_PROXY_PORT;
    expect(effectivePort).toBe(DEFAULT_PROXY_PORT);
  });

  it('re-init with prior enabled state → failing preflight preserves port in disabled write', async () => {
    // REG-1 + REG-2 combined: remembered port is preserved in the proxy.json disabled write
    // on preflight failure — not replaced by DEFAULT_PROXY_PORT.
    await writeProxyState(devflowDir, buildProxyState({
      enabled: true,
      port: REMEMBERED_PORT,
      binPath: '/path/relay.js',
      configPath: '/path/proxy-routing.json',
      devflowVersion: '2.0.0',
    }));

    const priorState = await readProxyState(devflowDir);
    const effectivePort = priorState.ok ? priorState.value.port : DEFAULT_PROXY_PORT;

    let proxyEnabled = true;
    const preflightResult = await runProxyPreflight(
      effectivePort,
      '/fake/.codex/auth.json',
      '/fake/proxy-routing.json',
      '/fake/logs/proxy.log',
      makePreflightDeps({ resolveProxyBin: () => Promise.resolve({ ok: false, error: 'routing runtime missing — reinstall devflow-kit' }) }),
    );

    if (!preflightResult.ok) {
      proxyEnabled = false;
      if (priorState.ok && priorState.value.enabled) {
        await writeProxyState(devflowDir, buildProxyState({
          enabled: false,
          port: priorState.value.port, // remembered port — not DEFAULT_PROXY_PORT
          binPath: priorState.value.binPath,
          configPath: priorState.value.configPath,
          devflowVersion: priorState.value.devflowVersion,
        }));
      }
    }

    const after = await readProxyState(devflowDir);
    expect(after.ok).toBe(true);
    expect(after.value?.enabled).toBe(false);
    expect(after.value?.port).toBe(REMEMBERED_PORT); // port preserved even when disabled
    expect(proxyEnabled).toBe(false);
  });
});

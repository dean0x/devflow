/**
 * The builder behind the live `claude` tests (tests/integration/helpers.ts).
 *
 * The live files spawn real `claude` sessions. This file proves, without a credential and
 * without a network call, that those sessions run in a throwaway HOME and a throwaway git
 * repository, with devflow installed into that HOME, with one credential, with no
 * write-redirect variable, and with an explicit permission list instead of the skip flag.
 * A fake `claude` executable on PATH records what the spawn passes it.
 *
 * Requires a build: `npm run build` first (the install case runs the compiled CLI).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ROOT, requireBuiltCli, sandboxEnv } from './helpers.js';
import { REDIRECT_ENV_VARS, assertTempHome } from './setup/home-isolation.js';
import { countCaptureHooks } from '../src/cli/commands/capture.js';
import { countMemoryHooks } from '../src/cli/commands/memory.js';
import {
  BEFORE_ALL_TIMEOUT_MS,
  CREDENTIAL_NAMES,
  INIT_TIMEOUT_MS,
  buildPreloadArgs,
  buildStreamingArgs,
  buildSubagentsPath,
  createSpawnContext,
  describeSpawnContext,
  disposeSpawnContext,
  getSubagentPreloadResult,
  initWrittenStatus,
  installDevflow,
  liveSkipReason,
  pickCredential,
  runClaudeAndWait,
  runClaudeStreaming,
  sandboxGit,
  statusChange,
  type CheckoutStatusReader,
  type Credential,
  type GitRunner,
  type InitRunner,
  type SpawnContext,
} from './integration/helpers.js';

requireBuiltCli();

const SUBPROCESS_TIMEOUT_MS = 120_000;

const FAKE_OAUTH: Credential = { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: `fake-oauth-${randomUUID()}` };
const FAKE_API_KEY_VALUE = `fake-key-${randomUUID()}`;

/** The six tools every live spawn denies. */
const DENIED_TOOLS = 'Bash Edit Write NotebookEdit WebFetch WebSearch';
/** Flags that take a list: a prompt placed after one of them is read as one more value. */
const VARIADIC_FLAGS = ['--allowedTools', '--allowed-tools', '--disallowedTools', '--disallowed-tools', '--mcp-config'];
/** Spelled in two pieces so this file never matches a scan for the flag itself. */
const SKIP_FLAG = '--dangerously' + '-skip-permissions';
const BYPASS_MODE = 'bypass' + 'Permissions';

const made: SpawnContext[] = [];
function track(ctx: SpawnContext): SpawnContext {
  made.push(ctx);
  return ctx;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const ctx of made.splice(0)) disposeSpawnContext(ctx);
});

/** The message `run` throws, or the empty string when it does not throw. */
function thrownMessage(run: () => void): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

/** One git call in `cwd`, under the sandboxed env of the context (never the real global config). */
function git(ctx: SpawnContext, cwd: string, ...args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    env: sandboxEnv(ctx.home),
  });
  return { status: result.status, stdout: result.stdout };
}

/** The checkout's whole `git status --porcelain --ignored`; callers narrow it to the paths init writes. */
function checkoutStatus(ctx: SpawnContext): string {
  return git(ctx, ROOT, 'status', '--porcelain', '--ignored').stdout;
}

/**
 * A copy of `ctx` whose PATH starts with a fake `claude`. The fake writes what it saw
 * (cwd, HOME, argument list, env key names — never values) to `$HOME/probe.json`.
 */
function withFakeClaude(ctx: SpawnContext): SpawnContext {
  const bin = path.join(ctx.home, 'fake-bin');
  mkdirSync(bin, { recursive: true });
  const script =
    `#!${process.execPath}\n` +
    "require('fs').writeFileSync(process.env.HOME + '/probe.json', JSON.stringify({" +
    'cwd: process.cwd(), home: process.env.HOME, argv: process.argv.slice(2), ' +
    'envKeys: Object.keys(process.env).sort() }));\n';
  writeFileSync(path.join(bin, 'claude'), script, { mode: 0o755 });
  return { ...ctx, env: { ...ctx.env, PATH: `${bin}${path.delimiter}${ctx.env['PATH'] ?? ''}` } };
}

interface Probe {
  cwd: string;
  home: string;
  argv: string[];
  envKeys: string[];
}

function readProbe(ctx: SpawnContext): Probe {
  return JSON.parse(readFileSync(path.join(ctx.home, 'probe.json'), 'utf-8')) as Probe;
}

interface GitCall {
  cwd: string;
  home: string;
  /** True when the working directory existed as the call began. */
  existed: boolean;
}

/**
 * Wraps `inner` so each call records its working directory and HOME. A cleanup test asserts on
 * these exact paths, never on a listing of the shared OS temp dir that other runs also write to.
 */
function recordingGit(inner: GitRunner): { runner: GitRunner; calls: GitCall[] } {
  const calls: GitCall[] = [];
  const runner: GitRunner = (args, cwd, env) => {
    calls.push({ cwd, home: env['HOME'] ?? '', existed: existsSync(cwd) });
    return inner(args, cwd, env);
  };
  return { runner, calls };
}

describe('createSpawnContext', () => {
  it('returns real paths for the home and the working directory', () => {
    const ctx = track(createSpawnContext());

    expect(ctx.home).toBe(realpathSync(ctx.home));
    expect(ctx.cwd).toBe(realpathSync(ctx.cwd));
    expect(existsSync(path.join(ctx.home, '.claude', 'settings.json'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(ctx.home, '.claude', 'settings.json'), 'utf-8'))).toEqual({});
  }, SUBPROCESS_TIMEOUT_MS);

  it('passes the temp-home check, and the working directory is a new repository outside the checkout', () => {
    const ctx = track(createSpawnContext());

    expect(() => assertTempHome(ctx.home)).not.toThrow();
    expect(path.relative(ROOT, ctx.cwd).startsWith('..')).toBe(true);
    expect(git(ctx, ctx.cwd, 'rev-parse', '--show-toplevel').stdout.trim()).toBe(ctx.cwd);
    expect(git(ctx, ctx.cwd, 'remote').stdout.trim()).toBe('');
    expect(git(ctx, ctx.cwd, 'config', 'user.email').stdout.trim()).not.toBe('');
    expect(git(ctx, ctx.cwd, 'config', 'user.name').stdout.trim()).not.toBe('');
    expect(existsSync(path.join(ctx.cwd, '.devflow'))).toBe(false);
  }, SUBPROCESS_TIMEOUT_MS);

  it('pins HOME and leaves out every redirect variable the parent holds', () => {
    for (const key of REDIRECT_ENV_VARS) vi.stubEnv(key, '/somewhere/else');

    const ctx = track(createSpawnContext());

    expect(ctx.env['HOME']).toBe(ctx.home);
    for (const key of REDIRECT_ENV_VARS) expect(ctx.env[key], `${key} reached the child env`).toBeUndefined();
  }, SUBPROCESS_TIMEOUT_MS);

  it('puts exactly one credential in the env, and prints only the HOME', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', FAKE_API_KEY_VALUE);
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');

    const ctx = track(createSpawnContext(FAKE_OAUTH));

    const present = CREDENTIAL_NAMES.filter((name) => ctx.env[name] !== undefined);
    expect(present).toEqual(['CLAUDE_CODE_OAUTH_TOKEN']);
    expect(ctx.env['CLAUDE_CODE_OAUTH_TOKEN']).toBe(FAKE_OAUTH.value);
    expect(describeSpawnContext(ctx)).toBe(`HOME=${ctx.home}`);
    const printed = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
    expect(printed).not.toContain(FAKE_OAUTH.value);
    expect(printed).not.toContain(FAKE_API_KEY_VALUE);
  }, SUBPROCESS_TIMEOUT_MS);

  it('puts no credential in the env when none is given', () => {
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', FAKE_OAUTH.value);
    vi.stubEnv('ANTHROPIC_API_KEY', FAKE_API_KEY_VALUE);

    const ctx = track(createSpawnContext());

    for (const name of CREDENTIAL_NAMES) expect(ctx.env[name], `${name} reached the child env`).toBeUndefined();
  }, SUBPROCESS_TIMEOUT_MS);

  it('removes both directories when a setup step fails', () => {
    const { runner, calls } = recordingGit(() => {
      throw new Error('git failed on purpose');
    });

    expect(() => createSpawnContext(null, runner)).toThrow('git failed on purpose');

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.existed, 'the working directory was made before the step failed').toBe(true);
    expect(call.home).not.toBe('');
    expect(existsSync(call.cwd)).toBe(false);
    expect(existsSync(call.home)).toBe(false);
  }, SUBPROCESS_TIMEOUT_MS);

  it('refuses a repository that has a remote, and removes both directories', () => {
    const { runner, calls } = recordingGit((args, cwd, env) =>
      args[0] === 'remote' ? 'origin\n' : sandboxGit(args, cwd, env),
    );

    expect(() => createSpawnContext(null, runner)).toThrow(/remote/);

    expect(calls.length).toBeGreaterThan(1);
    const { cwd, home } = calls[0];
    expect(calls.every((call) => call.cwd === cwd && call.home === home)).toBe(true);
    expect(calls[0].existed, 'the working directory was made before the remote was refused').toBe(true);
    expect(home).not.toBe('');
    expect(existsSync(cwd)).toBe(false);
    expect(existsSync(home)).toBe(false);
  }, SUBPROCESS_TIMEOUT_MS);
});

describe('disposeSpawnContext', () => {
  const realTmp = realpathSync(os.tmpdir());
  // Every refused path below is a random name that does not exist. A guard that went missing
  // would then remove nothing real: `rmSync` with `force` does nothing for an absent path.
  const absent = (parent: string): string => path.join(parent, `devflow-dispose-probe-${randomUUID()}`);

  // A link the symlink row makes. The guard refuses it, so nothing removes it: the test does.
  const links: string[] = [];
  afterEach(() => {
    for (const link of links.splice(0)) rmSync(link, { force: true });
  });

  /**
   * A link whose own name lies under the temp root and whose target does not: the parent of the
   * temp root. A guard that does not resolve links reads the name and lets the path through.
   * `rmSync` does not follow a link, so a missing guard removes only the link.
   */
  function linkOutsideTempRoot(): string {
    const link = absent(realTmp);
    symlinkSync(path.dirname(realTmp), link);
    links.push(link);
    return link;
  }

  const REFUSED: ReadonlyArray<readonly [string, () => string]> = [
    ['a path outside the temp root', () => absent(path.parse(realTmp).root)],
    ['a sibling that shares the temp-root prefix', () => `${realTmp}-evil-${randomUUID()}`],
    // Built as text: `path.join` would fold the `..` away before the guard saw it.
    ['a path that climbs out of the temp root', () => `${realTmp}${path.sep}..${path.sep}devflow-dispose-probe-${randomUUID()}`],
    ['a link under the temp root that points outside it', linkOutsideTempRoot],
  ];

  it('removes both directories of a real context', () => {
    const ctx = createSpawnContext();

    expect(() => disposeSpawnContext(ctx)).not.toThrow();

    expect(existsSync(ctx.cwd)).toBe(false);
    expect(existsSync(ctx.home)).toBe(false);
  }, SUBPROCESS_TIMEOUT_MS);

  it.each(REFUSED.flatMap(([label, make]) => [[label, 'cwd', make] as const, [label, 'home', make] as const]))(
    'refuses %s in the %s slot, and still removes the other directory',
    (_label, slot, make) => {
      const ctx = track(createSpawnContext());
      const bad = make();
      const dirs = slot === 'cwd' ? { cwd: bad, home: ctx.home } : { cwd: ctx.cwd, home: bad };
      const survivor = slot === 'cwd' ? ctx.home : ctx.cwd;

      const message = thrownMessage(() => disposeSpawnContext(dirs));

      expect(message).toContain(`refusing to touch ${bad}:`);
      expect(existsSync(survivor), 'the directory next to the refused one was left behind').toBe(false);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it('throws the first error when both directories are refused', () => {
    const first = absent(path.parse(realTmp).root);
    const second = `${realTmp}-evil-${randomUUID()}`;

    const message = thrownMessage(() => disposeSpawnContext({ cwd: first, home: second }));

    expect(message).toContain(`refusing to touch ${first}:`);
    expect(message).not.toContain(second);
  });
});

describe('pickCredential', () => {
  // Values are made at run time: the file holds no secret-shaped literal.
  const oauth = `oauth-${randomUUID()}`;
  const apiKey = `key-${randomUUID()}`;

  it('prefers the OAuth token over the API key', () => {
    expect(pickCredential({ CLAUDE_CODE_OAUTH_TOKEN: oauth, ANTHROPIC_API_KEY: apiKey })).toEqual({
      name: 'CLAUDE_CODE_OAUTH_TOKEN',
      value: oauth,
    });
  });

  it('falls back to the API key', () => {
    expect(pickCredential({ ANTHROPIC_API_KEY: apiKey })).toEqual({ name: 'ANTHROPIC_API_KEY', value: apiKey });
  });

  it('returns null when neither is set or both are blank', () => {
    expect(pickCredential({})).toBeNull();
    expect(pickCredential({ CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '   ' })).toBeNull();
  });
});

describe('liveSkipReason', () => {
  it('names both credential variables, and says nothing about a session directory, when no credential is set', () => {
    const reason = liveSkipReason(null, true);

    expect(reason).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(reason).toContain('ANTHROPIC_API_KEY');
    expect(reason).toContain('not set');
    expect(reason).not.toContain('no-session-dir');
  });

  it('names the missing claude binary', () => {
    expect(liveSkipReason(FAKE_OAUTH, false)).toContain('claude');
  });

  it('does not skip when claude and a credential are present', () => {
    expect(liveSkipReason(FAKE_OAUTH, true)).toBeNull();
  });

  it('never prints the credential value in a skip reason that was given one', () => {
    // The one path that takes a credential and still returns text: claude is missing.
    const reason = liveSkipReason(FAKE_OAUTH, false);

    expect(reason).not.toBeNull();
    expect(reason).not.toContain(FAKE_OAUTH.value);
  });
});

describe('claude argument lists', () => {
  const PROMPT = 'reply with one line only';
  const SESSION_ID = randomUUID();

  function expectPermissionDesign(args: readonly string[], allowedTool: string): void {
    expect(args[0]).toBe('-p');
    expect(args[1]).toBe(PROMPT);
    const at = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
    expect(at('--permission-mode')).toBe('dontAsk');
    expect(at('--allowedTools')).toBe(allowedTool);
    expect(at('--disallowedTools')).toBe(DENIED_TOOLS);
    expect(args).toContain('--strict-mcp-config');
    expect(at('--mcp-config')).toBe('{"mcpServers":{}}');
    expect(args).not.toContain(SKIP_FLAG);
    expect(args).not.toContain(BYPASS_MODE);
  }

  function expectNoVariadicFlagBeforePrompt(args: readonly string[]): void {
    expect(args[0]).toBe('-p');
    expect(args.indexOf(PROMPT)).toBe(1);
    for (const flag of VARIADIC_FLAGS) {
      const at = args.indexOf(flag);
      if (at !== -1) {
        expect(at, `${flag} sits before the prompt`).toBeGreaterThan(1);
        // Exactly one value, then another flag or the end: a list flag takes nothing else.
        const next = args[at + 2];
        expect(next === undefined || next.startsWith('--'), `${flag} is followed by a stray value`).toBe(true);
      }
    }
  }

  it('the preload spawn allows Agent, denies six tools, and has no skip flag', () => {
    const args = buildPreloadArgs(PROMPT, { model: 'haiku', allowedTools: 'Agent', sessionId: SESSION_ID });

    expectPermissionDesign(args, 'Agent');
    expect(args[args.indexOf('--session-id') + 1]).toBe(SESSION_ID);
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
  });

  it('the streaming spawn allows Skill by default, denies six tools, and has no skip flag', () => {
    const args = buildStreamingArgs(PROMPT, { model: 'haiku', allowedTools: 'Skill', systemPrompt: 'a system prompt' });

    expectPermissionDesign(args, 'Skill');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('a system prompt');
  });

  it('the token before the prompt is -p and no list flag precedes the prompt, in both lists', () => {
    expectNoVariadicFlagBeforePrompt(buildPreloadArgs(PROMPT, { model: 'haiku', allowedTools: 'Agent', sessionId: SESSION_ID }));
    expectNoVariadicFlagBeforePrompt(buildStreamingArgs(PROMPT, { model: 'haiku', allowedTools: 'Skill', systemPrompt: false }));
    expectNoVariadicFlagBeforePrompt(buildStreamingArgs(PROMPT, { model: 'haiku', allowedTools: 'Skill', systemPrompt: 'x' }));
  });
});

describe('the spawns', () => {
  it('runClaudeAndWait runs in the context cwd and HOME, with one credential and no redirect variable', async () => {
    for (const key of REDIRECT_ENV_VARS) vi.stubEnv(key, '/somewhere/else');
    vi.stubEnv('ANTHROPIC_API_KEY', FAKE_API_KEY_VALUE);
    const ctx = withFakeClaude(track(createSpawnContext(FAKE_OAUTH)));

    const run = await runClaudeAndWait(ctx, 'say hi', { timeout: 30_000 });
    const probe = readProbe(ctx);

    expect(run.exitCode).toBe(0);
    expect(probe.cwd).toBe(ctx.cwd);
    expect(probe.home).toBe(ctx.home);
    expect(probe.argv.slice(0, 2)).toEqual(['-p', 'say hi']);
    expect(probe.argv).toContain(run.sessionId);
    expect(probe.argv).not.toContain(SKIP_FLAG);
    for (const key of REDIRECT_ENV_VARS) expect(probe.envKeys).not.toContain(key);
    expect(probe.envKeys.filter((key) => (CREDENTIAL_NAMES as readonly string[]).includes(key))).toEqual([
      'CLAUDE_CODE_OAUTH_TOKEN',
    ]);
  }, SUBPROCESS_TIMEOUT_MS);

  it('runClaudeStreaming runs in the context cwd and HOME, with the prompt right after -p', async () => {
    const ctx = withFakeClaude(track(createSpawnContext(FAKE_OAUTH)));

    const result = await runClaudeStreaming(ctx, 'say hi', { timeout: 30_000 });
    const probe = readProbe(ctx);

    expect(result.killedEarly).toBe(false);
    expect(probe.cwd).toBe(ctx.cwd);
    expect(probe.home).toBe(ctx.home);
    expect(probe.argv.slice(0, 2)).toEqual(['-p', 'say hi']);
    expect(probe.argv[probe.argv.indexOf('--allowedTools') + 1]).toBe('Skill');
    expect(probe.argv).not.toContain(SKIP_FLAG);
  }, SUBPROCESS_TIMEOUT_MS);
});

describe('getSubagentPreloadResult', () => {
  it('finds the transcripts under the encoded real project directory of the context', () => {
    const ctx = track(createSpawnContext());
    const sessionId = randomUUID();
    const dir = buildSubagentsPath(ctx.home, ctx.cwd, sessionId);
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      type: 'user',
      message: { content: '<command-name>devflow:git</command-name><command-name>devflow:worktree-support</command-name>' },
    });
    writeFileSync(path.join(dir, 'agent-abc.jsonl'), `${line}\n`);

    expect(getSubagentPreloadResult({ home: ctx.home, cwd: ctx.cwd }, sessionId)).toEqual({
      kind: 'ok',
      transcripts: [['git', 'worktree-support']],
    });
    expect(getSubagentPreloadResult({ home: ctx.home, cwd: ctx.cwd }, randomUUID())).toEqual({ kind: 'no-session-dir' });
  }, SUBPROCESS_TIMEOUT_MS);
});

describe('installDevflow', () => {
  it('installs into the temp home from a non-repository directory, with memory and learning off, and leaves the checkout alone', () => {
    const ctx = track(createSpawnContext());
    const calls: Array<{ args: readonly string[]; cwd: string; timeout: number; credentialKeys: string[] }> = [];
    const recording: InitRunner = (args, opts) => {
      // Checked at call time: the directory is removed again once the install ends.
      expect(opts.cwd).toBe(realpathSync(opts.cwd));
      expect(path.relative(ROOT, opts.cwd).startsWith('..')).toBe(true);
      expect(git(ctx, opts.cwd, 'rev-parse', '--git-dir').status, 'init cwd is inside a repository').not.toBe(0);
      expect(opts.env['HOME']).toBe(ctx.home);
      calls.push({
        args,
        cwd: opts.cwd,
        timeout: opts.timeout,
        credentialKeys: CREDENTIAL_NAMES.filter((name) => opts.env[name] !== undefined),
      });
      return spawnSync(process.execPath, [requireBuiltCli(), ...args], {
        cwd: opts.cwd,
        env: opts.env,
        encoding: 'utf-8',
        timeout: opts.timeout,
      });
    };
    const statusBefore = initWrittenStatus(checkoutStatus(ctx));

    installDevflow(ctx, recording);

    // Only the paths init writes are compared: other writers in the checkout (hooks, other
    // workers, an editor) must not fail this run. A failure prints the differing lines.
    expect(statusChange(statusBefore, initWrittenStatus(checkoutStatus(ctx)))).toEqual([]);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.credentialKeys).toEqual([]);
    expect(call.timeout).toBe(INIT_TIMEOUT_MS);
    expect(existsSync(call.cwd)).toBe(false);
    expect(call.args[0]).toBe('init');
    for (const flag of ['--no-ambient', '--no-memory', '--no-curation', '--no-knowledge', '--no-rules', '--no-proxy']) {
      expect(call.args).toContain(flag);
    }
    expect(call.args[call.args.indexOf('--security') + 1]).toBe('user');

    const agents = path.join(ctx.home, '.claude', 'agents', 'devflow');
    expect(existsSync(path.join(agents, 'validate.md'))).toBe(true);
    expect(existsSync(path.join(agents, 'test.md'))).toBe(true);
    const settings = readFileSync(path.join(ctx.home, '.claude', 'settings.json'), 'utf-8');
    expect(countMemoryHooks(settings)).toBe(0);
    expect(countCaptureHooks(settings)).toBe(0);
    const manifest = JSON.parse(readFileSync(path.join(ctx.home, '.devflow', 'manifest.json'), 'utf-8')) as {
      features: { memory: boolean; learning: boolean };
    };
    expect(manifest.features.memory).toBe(false);
    expect(manifest.features.learning).toBe(false);
  }, SUBPROCESS_TIMEOUT_MS);

  it('throws on a failed init, and still removes its working directory', () => {
    const ctx = track(createSpawnContext());
    let initCwd = '';
    const failing: InitRunner = (_args, opts) => {
      initCwd = opts.cwd;
      return { status: 1, stdout: '', stderr: 'init failed on purpose' };
    };

    expect(() => installDevflow(ctx, failing)).toThrow(/init failed/);

    expect(initCwd).not.toBe('');
    expect(existsSync(initCwd)).toBe(false);
  }, SUBPROCESS_TIMEOUT_MS);

  it('throws when the temp home lacks the Validate agent file', () => {
    const ctx = track(createSpawnContext());
    const emptyInstall: InitRunner = () => ({ status: 0, stdout: '', stderr: '' });

    expect(() => installDevflow(ctx, emptyInstall)).toThrow(/validate\.md/);
  }, SUBPROCESS_TIMEOUT_MS);
});

describe('the checkout status check', () => {
  /** An install that passes every check except the checkout comparison. */
  function fakeInstall(ctx: SpawnContext): InitRunner {
    return () => {
      const agents = path.join(ctx.home, '.claude', 'agents', 'devflow');
      mkdirSync(agents, { recursive: true });
      for (const file of ['validate.md', 'test.md']) writeFileSync(path.join(agents, file), '# agent\n');
      return { status: 0, stdout: '', stderr: '' };
    };
  }

  /** A reader that returns each text in turn: the first before the install, the second after. */
  function statusSequence(...texts: string[]): CheckoutStatusReader {
    let at = 0;
    return () => texts[Math.min(at++, texts.length - 1)];
  }

  describe('initWrittenStatus', () => {
    it('keeps the lines that name a path init writes', () => {
      const porcelain = [
        ' M .gitignore',
        '?? .claudeignore',
        '!! .devflow/',
        '?? .devflow/config.json',
        '?? .claude/settings.json',
        'R  old.md -> .memory/notes.md',
        '?? .docs/',
      ].join('\n');

      expect(initWrittenStatus(`${porcelain}\n`)).toEqual(porcelain.split('\n'));
    });

    it('drops the lines that name any other path, and look-alikes of the written ones', () => {
      const porcelain = [
        ' M src/core/plugins.ts',
        '?? scratch.txt',
        '!! node_modules/',
        '?? .devflowx',
        '?? .gitignore-copy',
        '?? docs/.claudeignore',
        '',
      ].join('\n');

      expect(initWrittenStatus(porcelain)).toEqual([]);
    });
  });

  describe('statusChange', () => {
    it('names each added and each removed line, and nothing when the lines match', () => {
      expect(statusChange(['?? a', ' M b'], ['?? a', ' M b'])).toEqual([]);
      expect(statusChange(['?? a', ' M b'], ['?? a', '?? c'])).toEqual(['removed  M b', 'added   ?? c']);
    });
  });

  it('fails, and prints the differing lines, when a path init writes changed in the checkout', () => {
    const ctx = track(createSpawnContext());
    const reader = statusSequence('', '?? .claudeignore\n M .gitignore\n');

    const message = thrownMessage(() => installDevflow(ctx, fakeInstall(ctx), reader));

    expect(message).toContain('added   ?? .claudeignore');
    expect(message).toContain('added    M .gitignore');
  }, SUBPROCESS_TIMEOUT_MS);

  it('does not fail on a change outside the paths init writes', () => {
    const ctx = track(createSpawnContext());
    const reader = statusSequence('', ' M src/core/plugins.ts\n?? scratch.txt\n');

    expect(() => installDevflow(ctx, fakeInstall(ctx), reader)).not.toThrow();
  }, SUBPROCESS_TIMEOUT_MS);
});

describe('explicit timeouts and live-file wiring', () => {
  it('names 120 seconds for init and 180 seconds for beforeAll', () => {
    expect(INIT_TIMEOUT_MS).toBe(120_000);
    expect(BEFORE_ALL_TIMEOUT_MS).toBe(180_000);
  });

  it.each(['tests/integration/subagent-skill-preload.test.ts', 'tests/integration/ambient-activation.test.ts'])(
    '%s builds its context, installs with the long timeout, skips with a reason, and disposes it',
    (rel) => {
      const source = readFileSync(path.join(ROOT, rel), 'utf-8');

      expect(source).toContain('createSpawnContext(');
      expect(source).toContain('installDevflow(');
      expect(source).toContain('BEFORE_ALL_TIMEOUT_MS');
      expect(source).toContain('liveSkipReason(');
      expect(source).toMatch(/afterAll\([\s\S]*disposeSpawnContext\(/);
      expect(source).not.toContain(SKIP_FLAG);
      expect(source).not.toContain(BYPASS_MODE);
    },
    SUBPROCESS_TIMEOUT_MS,
  );
});

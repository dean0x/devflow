/**
 * npm-install-no-audit — the tarball install of the pack tests sends no audit
 * request (#698).
 *
 * The pack tests install a packed devflow tarball whose dependencies come from the
 * registry. By default npm then calls the registry's audit service, so an outage or a
 * slow answer of that service failed those tests. This file starts a local registry in
 * the test process. It serves one dependency and answers every audit request with 503.
 * Only the npm child process points at it, through its environment: the machine's
 * network and npm configuration do not change.
 *
 * What it asserts
 * ---------------
 * 1. With TARBALL_INSTALL_ARGS, npm installs a package with a registry dependency,
 *    exits 0 and sends no audit request.
 * 2. Known-bad probe: without `--no-audit`, the same install sends an audit request.
 *    So the local registry does see one, and assertion 1 can fail.
 * 3. No other integration test spells its own `npm install` command: each one uses
 *    tarballInstallCommand.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs, readdirSync, readFileSync } from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { TARBALL_INSTALL_ARGS } from './npm-install.js';

const INTEGRATION_DIR = import.meta.dirname;
const DEP = 'devflow-audit-probe-dep';
const DEP_TARBALL_PATH = `/${DEP}/-/${DEP}-1.0.0.tgz`;
const AUDIT_PREFIX = '/-/npm/v1/security/';
const NPM_TIMEOUT_MS = 60_000;

let WORK: string;
let server: http.Server | undefined;
let registry: string;
let appTgz: string;
let depTgz: Buffer;
/** `METHOD path` of every request the local registry received, in order. */
let requests: string[] = [];

afterAll(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (WORK) await fs.rm(WORK, { recursive: true, force: true }).catch(() => undefined);
});

/** The environment of one npm run: no inherited npm settings, the local registry, a cache of its own. */
function npmEnv(cache: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toLowerCase().startsWith('npm_config_')) env[key] = value;
  }
  return {
    ...env,
    npm_config_registry: `${registry}/`,
    npm_config_cache: cache,
    npm_config_userconfig: path.join(WORK, 'empty-user-npmrc'),
    npm_config_globalconfig: path.join(WORK, 'empty-global-npmrc'),
    npm_config_update_notifier: 'false',
    npm_config_fetch_retries: '0',
    npm_config_fund: 'false',
  };
}

/**
 * Run npm without blocking the event loop, which serves the local registry.
 * Never rejects: callers check `code`, which is null when the run was killed.
 */
function runNpm(args: readonly string[], cwd: string, cache: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn('npm', [...args], { cwd, env: npmEnv(cache), stdio: ['ignore', 'pipe', 'pipe'], timeout: NPM_TIMEOUT_MS });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.stdout.resume();
    child.on('error', err => resolve({ code: null, stderr: `${stderr}\n${err.message}` }));
    child.on('close', code => resolve({ code, stderr }));
  });
}

/** Pack the package in `dir` into WORK and return the tarball path. */
async function pack(dir: string): Promise<string> {
  const before = new Set(readdirSync(WORK));
  const result = await runNpm(['pack', '--pack-destination', WORK], dir, path.join(WORK, 'cache-pack'));
  expect(result.code, `npm pack failed in ${dir}:\n${result.stderr}`).toBe(0);
  const made = readdirSync(WORK).filter(f => f.endsWith('.tgz') && !before.has(f));
  expect(made, `npm pack made no new tarball for ${dir}`).toHaveLength(1);
  return path.join(WORK, made[0]);
}

/** A fresh consumer project and cache; returns both paths. */
async function freshConsumer(label: string): Promise<{ dir: string; cache: string }> {
  const dir = path.join(WORK, `consumer-${label}`);
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: `consumer-${label}`, version: '0.0.0', private: true }));
  return { dir, cache: path.join(WORK, `cache-${label}`) };
}

const isAudit = (request: string): boolean => request.split(' ')[1]?.startsWith(AUDIT_PREFIX) === true;

beforeAll(async () => {
  WORK = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-npm-audit-'));
  await fs.writeFile(path.join(WORK, 'empty-user-npmrc'), '');
  await fs.writeFile(path.join(WORK, 'empty-global-npmrc'), '');

  server = http.createServer((req, res) => {
    const url = req.url ?? '';
    requests.push(`${req.method} ${url}`);
    req.resume();
    if (url.startsWith(AUDIT_PREFIX)) {
      res.writeHead(503).end();
    } else if (url === `/${DEP}`) {
      const integrity = `sha512-${createHash('sha512').update(depTgz).digest('base64')}`;
      const shasum = createHash('sha1').update(depTgz).digest('hex');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        name: DEP,
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { name: DEP, version: '1.0.0', dist: { tarball: `${registry}${DEP_TARBALL_PATH}`, integrity, shasum } } },
      }));
    } else if (url === DEP_TARBALL_PATH) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(depTgz);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()));
  registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const depDir = path.join(WORK, 'dep');
  await fs.mkdir(depDir);
  await fs.writeFile(path.join(depDir, 'package.json'), JSON.stringify({ name: DEP, version: '1.0.0' }));
  depTgz = readFileSync(await pack(depDir));

  const appDir = path.join(WORK, 'app');
  await fs.mkdir(appDir);
  await fs.writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: 'devflow-audit-probe-app', version: '1.0.0', dependencies: { [DEP]: '1.0.0' } }));
  appTgz = await pack(appDir);
});

describe('#698: the tarball install of the pack tests sends no audit request', () => {
  it('installs a registry dependency with the audit service down, exits 0 and sends no audit request', async () => {
    const { dir, cache } = await freshConsumer('no-audit');
    requests = [];
    const result = await runNpm([...TARBALL_INSTALL_ARGS, appTgz], dir, cache);

    expect(result.code, `npm install failed:\n${result.stderr}`).toBe(0);
    await expect(fs.access(path.join(dir, 'node_modules', DEP, 'package.json'))).resolves.toBeUndefined();
    expect(requests, 'the dependency did not come from the local registry').toContain(`GET /${DEP}`);
    expect(requests.filter(isAudit)).toEqual([]);
  });

  it('known-bad probe: the same install without --no-audit sends an audit request', async () => {
    const withAudit = TARBALL_INSTALL_ARGS.filter(arg => arg !== '--no-audit');
    expect(withAudit, 'TARBALL_INSTALL_ARGS has no --no-audit to remove').toHaveLength(TARBALL_INSTALL_ARGS.length - 1);
    const { dir, cache } = await freshConsumer('audit');
    requests = [];
    await runNpm([...withAudit, appTgz], dir, cache);

    expect(requests.filter(isAudit).length, `requests: ${requests.join(', ')}`).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Assertion 3: every integration test installs through tarballInstallCommand
// ---------------------------------------------------------------------------

/** A shell string that runs an install: the command, then an option, a quoted path or an interpolation. */
const SHELL_INSTALL = /[`'"]npm (?:install|i|ci) (?:-|"|'|\$\{)/;
/** An argument-list install: `'npm', ['install'`. */
const ARGV_INSTALL = /['"]npm['"]\s*,\s*\[\s*['"](?:install|i|ci)['"]/;

/** Named collector: code lines (not comment lines) that spell an `npm install`, `npm i` or `npm ci` command. */
function collectInlineInstalls(files: readonly { name: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { name, text } of files) {
    text.split('\n').forEach((line, index) => {
      const code = line.trimStart();
      if (code.startsWith('*') || code.startsWith('/*') || code.startsWith('//')) return;
      if (SHELL_INSTALL.test(code) || ARGV_INSTALL.test(code)) out.push(`${name}:${index + 1}`);
    });
  }
  return out;
}

describe('#698: no integration test spells its own npm install', () => {
  // This file holds the seeded probes, and its own installs use TARBALL_INSTALL_ARGS.
  const files = readdirSync(INTEGRATION_DIR)
    .filter(f => f.endsWith('.ts') && f !== path.basename(import.meta.filename))
    .map(name => ({ name, text: readFileSync(path.join(INTEGRATION_DIR, name), 'utf-8') }));

  it('each tarball install goes through tarballInstallCommand', () => {
    for (const name of ['pack-install.test.ts', 'clause-ii-file-residue.test.ts']) {
      expect(files.find(f => f.name === name)?.text, `${name} does not install through tarballInstallCommand`).toContain('runSync(tarballInstallCommand(tgzPath)');
    }
    expect(collectInlineInstalls(files)).toEqual([]);
  });

  it('known-bad probes: an inline npm install command is reported, a test name or message is not', () => {
    const seeded = [{
      name: 'seeded.test.ts',
      text: [
        "it('npm install from tarball exits 0', () => {",
        '    const result = runSync(`npm install --no-save "${tgzPath}"`);',
        "    spawnSync('npm', ['ci'], { cwd });",
        '    expect(code, `npm install failed (exit ${code})`).toBe(0);',
        '    // npm install "x" in a comment',
      ].join('\n'),
    }];
    expect(collectInlineInstalls(seeded)).toEqual(['seeded.test.ts:2', 'seeded.test.ts:3']);
  });
});

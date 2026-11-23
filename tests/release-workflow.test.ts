/**
 * The release workflow publishes to npm through npm trusted publishing (OIDC),
 * started by a `vX.Y.Z` tag push. These checks keep every workflow free of
 * stored tokens, keep each release job to the permissions it needs, and keep
 * each action pinned to a full commit SHA.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');
const WORKFLOW_FILES = readdirSync(WORKFLOWS_DIR).filter(name => /\.ya?ml$/.test(name));
const readWorkflow = (name: string): string => readFileSync(path.join(WORKFLOWS_DIR, name), 'utf8');
const RELEASE = readWorkflow('release.yml');

/** Names of a stored token path. `_auth` also matches `_authToken`. */
const TOKEN_NAMES = ['RELEASE_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', '_auth', '_password'] as const;

/** Trusted publishing needs npm 11.5.1 or newer. */
const MIN_TRUSTED_NPM = [11, 5, 1] as const;

function atLeast(version: readonly number[], min: readonly number[]): boolean {
  for (const [i, part] of min.entries()) {
    const got = version[i] ?? 0;
    if (got !== part) return got > part;
  }
  return true;
}

/** The text of each job under `jobs:`, by job id. */
function jobsOf(workflow: string): Map<string, string> {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => line === 'jobs:');
  const jobs = new Map<string, string>();
  if (start === -1) return jobs;
  let current: string | null = null;
  let body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(line);
    if (header !== null) {
      if (current !== null) jobs.set(current, body.join('\n'));
      current = header[1];
      body = [];
    } else if (current !== null) {
      body.push(line);
    }
  }
  if (current !== null) jobs.set(current, body.join('\n'));
  return jobs;
}

/** The script text of each `run:` step, with its block lines. */
function runScriptsOf(workflow: string): string[] {
  const lines = workflow.split('\n');
  const scripts: string[] = [];
  for (const [i, line] of lines.entries()) {
    const match = /^(\s*)(- )?run:\s?(.*)$/.exec(line);
    if (match === null) continue;
    const keyIndent = match[1].length + (match[2]?.length ?? 0);
    const value = match[3];
    if (!/^[|>][-+]?\s*$/.test(value)) {
      scripts.push(value);
      continue;
    }
    const block: string[] = [];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() !== '' && next.length - next.trimStart().length <= keyIndent) break;
      block.push(next);
    }
    scripts.push(block.join('\n'));
  }
  return scripts;
}

/** The `permissions:` lines of a job, as `key: value` strings. */
function permissionsOf(job: string): string[] {
  const lines = job.split('\n');
  const start = lines.findIndex(line => /^ {4}permissions:\s*$/.test(line));
  if (start === -1) return [];
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const entry = /^ {6}([\w-]+):\s*(\S+)\s*$/.exec(line);
    if (entry === null) break;
    result.push(`${entry[1]}: ${entry[2]}`);
  }
  return result;
}

describe('release workflow: no stored token', () => {
  it('finds the workflow files', () => {
    expect(WORKFLOW_FILES).toContain('release.yml');
    expect(WORKFLOW_FILES).toContain('ci.yml');
  });

  for (const name of WORKFLOW_FILES) {
    it(`${name} names no token and reads no secret`, () => {
      const text = readWorkflow(name);
      for (const token of TOKEN_NAMES) expect(text, `${name} names ${token}`).not.toContain(token);
      expect(text, `${name} reads a secret`).not.toContain('secrets.');
    });
  }

  it('the repo root has no .npmrc', () => {
    expect(existsSync(path.join(ROOT, '.npmrc'))).toBe(false);
  });

  it('gives setup-node no registry-url', () => {
    // With registry-url, setup-node writes an npm token line to .npmrc.
    expect(RELEASE).not.toMatch(/^\s*registry-url:/m);
  });

  it('restores no npm cache', () => {
    expect(RELEASE).not.toMatch(/^\s*cache:/m);
  });

  it('runs no dependency install scripts', () => {
    expect(RELEASE).toMatch(/^\s*run: npm ci --ignore-scripts\s*$/m);
    expect(RELEASE).not.toMatch(/^\s*run: npm (ci|install)(?! --ignore-scripts\s*$).*$/m);
  });

  it('keeps no checkout credentials in any job', () => {
    const checkouts = RELEASE.match(/uses: actions\/checkout@/g) ?? [];
    const noCredentials = RELEASE.match(/^\s*persist-credentials: false\s*$/gm) ?? [];
    expect(checkouts.length).toBeGreaterThan(0);
    expect(noCredentials.length).toBe(checkouts.length);
  });
});

describe('release workflow: trigger and jobs', () => {
  const jobs = jobsOf(RELEASE);

  it('starts only from a v* tag push', () => {
    expect(RELEASE).toMatch(/^on:\n {2}push:\n {4}tags:\n {6}- "v\*"\n/m);
    expect(RELEASE).not.toContain('workflow_dispatch');
    expect(RELEASE).not.toMatch(/^\s*branches:/m);
  });

  it('has the verify, publish and github-release jobs, in that order of needs', () => {
    expect([...jobs.keys()]).toEqual(['verify', 'publish', 'github-release']);
    expect(jobs.get('publish')).toMatch(/^ {4}needs: verify\s*$/m);
    expect(jobs.get('github-release')).toMatch(/^ {4}needs: publish\s*$/m);
  });

  it('gives the workflow no default permissions', () => {
    expect(RELEASE).toMatch(/^permissions: \{\}\s*$/m);
  });

  it('gives each job only the permissions it needs', () => {
    expect(permissionsOf(jobs.get('verify') ?? '')).toEqual(['contents: read']);
    expect(permissionsOf(jobs.get('publish') ?? '')).toEqual(['contents: read', 'id-token: write']);
    expect(permissionsOf(jobs.get('github-release') ?? '')).toEqual(['contents: write']);
  });

  it('the verify job checks the tag, the lock file, the build, the tests and the CLI version', () => {
    const verify = jobs.get('verify') ?? '';
    for (const needle of [
      'git merge-base --is-ancestor "${GITHUB_SHA}" origin/main',
      'TAG_VERSION="${GITHUB_REF_NAME#v}"',
      "require('./package-lock.json').packages[''].version",
      'grep -qF "## [${VERSION}] - " CHANGELOG.md',
      'run: npm run build',
      'run: npm test',
      'run: npm run test:integration',
      'node dist/cli.js --version',
    ]) {
      expect(verify, needle).toContain(needle);
    }
    expect(verify).toMatch(/^ {10}fetch-depth: 0\s*$/m);
  });

  it('publishes with a pinned npm that has trusted publishing, and a dist-tag', () => {
    const match =
      /^\s*run: npx -y npm@(\d+)\.(\d+)\.(\d+) publish --provenance --access public --tag "\$\{NPM_DIST_TAG\}"\s*$/m.exec(
        jobs.get('publish') ?? '',
      );
    expect(match, 'no pinned npx npm publish step').not.toBeNull();
    const version = (match ?? []).slice(1, 4).map(Number);
    expect(atLeast(version, MIN_TRUSTED_NPM), `npm ${version.join('.')} is too old`).toBe(true);
  });

  it('the version check orders npm versions', () => {
    expect(atLeast([11, 5, 1], MIN_TRUSTED_NPM)).toBe(true);
    expect(atLeast([11, 19, 1], MIN_TRUSTED_NPM)).toBe(true);
    expect(atLeast([12, 0, 0], MIN_TRUSTED_NPM)).toBe(true);
    expect(atLeast([11, 5, 0], MIN_TRUSTED_NPM)).toBe(false);
    expect(atLeast([10, 9, 4], MIN_TRUSTED_NPM)).toBe(false);
  });

  it('creates the GitHub release with the workflow token only', () => {
    const release = jobs.get('github-release') ?? '';
    expect(release).toMatch(/^ {10}GH_TOKEN: \$\{\{ github\.token \}\}\s*$/m);
    expect(release).toContain('gh release create "${GITHUB_REF_NAME}"');
    expect(release).toContain('--verify-tag');
    // The release job only reads the release notes that the release PR wrote.
    expect(release).toContain('git diff --exit-code');
  });
});

describe('release workflow: script text and action pins', () => {
  it('puts no ${{ }} expression into a run script', () => {
    for (const script of runScriptsOf(RELEASE)) expect(script).not.toContain('${{');
  });

  it('finds the run scripts', () => {
    expect(runScriptsOf(RELEASE).length).toBeGreaterThanOrEqual(10);
    expect(runScriptsOf('    - run: |\n        a\n        b\n    - run: c\n')).toEqual(['        a\n        b', 'c']);
  });

  for (const name of WORKFLOW_FILES) {
    it(`${name} pins each action to a full commit SHA with a version comment`, () => {
      const uses = readWorkflow(name)
        .split('\n')
        .filter(line => /^\s*(- )?uses:/.test(line));
      expect(uses.length).toBeGreaterThan(0);
      for (const line of uses) {
        expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/);
      }
    });
  }
});

describe('scripts/bump-version.ts', () => {
  const CHANGELOG =
    '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- A new thing.\n\n---\n\n' +
    '## [1.0.0] - 2026-01-01\n\n- The first thing.\n\n---\n\n' +
    '[1.0.0]: https://github.com/dean0x/devflow/releases/tag/v1.0.0\n';

  function bump(dir: string, version: string): string {
    return execFileSync(path.join(ROOT, 'node_modules', '.bin', 'tsx'), [path.join(dir, 'scripts', 'bump-version.ts'), version], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        npm_config_cache: path.join(dir, '.npm-cache'),
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
      },
    });
  }

  it('moves [Unreleased] to the version, adds a new empty [Unreleased], and runs again without a change', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bump-version-'));
    try {
      mkdirSync(path.join(dir, 'scripts'));
      writeFileSync(
        path.join(dir, 'scripts', 'bump-version.ts'),
        readFileSync(path.join(ROOT, 'scripts', 'bump-version.ts'), 'utf8'),
      );
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bump-fixture', version: '1.0.0', type: 'module' }, null, 2) + '\n');
      writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG);

      const notes = bump(dir, '1.1.0');
      const bumped = readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
      expect(notes).toBe('### Added\n\n- A new thing.\n');
      expect(bumped).toMatch(/^## \[Unreleased\]\n\n---\n\n## \[1\.1\.0\] - \d{4}-\d{2}-\d{2}\n\n### Added\n\n- A new thing\.\n\n---\n\n## \[1\.0\.0\]/m);
      expect(bumped).toContain('[1.1.0]: https://github.com/dean0x/devflow/compare/v1.0.0...v1.1.0\n[1.0.0]:');
      expect(JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version).toBe('1.1.0');

      // The release job runs the script again on the merged release commit.
      const lock = readFileSync(path.join(dir, 'package-lock.json'), 'utf8');
      expect(bump(dir, '1.1.0')).toBe(notes);
      expect(readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8')).toBe(bumped);
      expect(readFileSync(path.join(dir, 'package-lock.json'), 'utf8')).toBe(lock);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

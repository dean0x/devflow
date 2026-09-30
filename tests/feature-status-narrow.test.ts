/**
 * `devflow memory|learning|knowledge --status` over the per-repository layer
 * (D-FEATURES-NARROW-ONLY), run through the compiled CLI from a temp HOME and a
 * temp git repository (PF-060).
 *
 * The machine switch line is the same in every directory. A repository layer — the
 * team's `.devflow/project.json` or the personal `.devflow/config.json` — can
 * only narrow it, and `--status` adds ONE line naming the effective state and
 * the file that narrowed it, only when that happens. Every other run is
 * byte-identical to a run in a repository with no repo layer at all.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli } from './helpers.js';
import { assertTempHome } from './setup/home-isolation.js';

const CLI = requireBuiltCli();

const FEATURES = ['memory', 'learning', 'knowledge'] as const;
type Feature = (typeof FEATURES)[number];

let tmpHome: string;
let tmpRoot: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'df-status-home-'));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'df-status-repos-'));
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function seedManifest(features: Record<string, unknown>): void {
  fs.mkdirSync(path.join(tmpHome, '.devflow'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.devflow', 'manifest.json'), JSON.stringify({
    version: '2.5.0',
    plugins: ['devflow-core-skills'],
    scope: 'user',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    features: { memory: true, learning: true, knowledge: true, ...features },
  }));
}

/** A fresh git repository holding exactly these repo-layer files. */
function makeRepo(files: { project?: string; personal?: string } = {}): string {
  const repo = fs.mkdtempSync(path.join(tmpRoot, 'repo-'));
  execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
  fs.mkdirSync(path.join(repo, '.devflow'), { recursive: true });
  if (files.project !== undefined) fs.writeFileSync(path.join(repo, '.devflow', 'project.json'), files.project);
  if (files.personal !== undefined) fs.writeFileSync(path.join(repo, '.devflow', 'config.json'), files.personal);
  return repo;
}

function status(feature: Feature, cwd: string): string {
  assertTempHome(tmpHome);
  const r = spawnSync(process.execPath, [CLI, feature, '--status'], {
    encoding: 'utf-8',
    timeout: 60_000,
    cwd,
    env: { ...process.env, HOME: tmpHome, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
  });
  expect(r.status, `${feature} --status failed:\n${r.stdout}${r.stderr}`).toBe(0);
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

const EFFECTIVE = /Effective here: /;

/** The output with the one effective-state line removed (clack prints it with a gutter line). */
function withoutEffective(out: string): string {
  const lines = out.split('\n');
  const at = lines.findIndex(l => EFFECTIVE.test(l));
  if (at === -1) return out;
  // p.log.info emits the message line preceded by a `│` spacer line; learning's
  // state is one multi-line message, so there only the message line goes.
  const spacer = at > 0 && /^│\s*$/.test(lines[at - 1]) && !/Learning:/.test(lines[at - 1]) ? 1 : 0;
  return [...lines.slice(0, at - spacer), ...lines.slice(at + 1)].join('\n');
}

describe('--status prints the effective state only when a repo layer narrows (D-FEATURES-NARROW-ONLY)', () => {
  it.each(FEATURES)('%s: a repo layer that narrows nothing leaves the output byte-identical', (feature) => {
    seedManifest({});
    const bare = status(feature, makeRepo());
    const layered = status(feature, makeRepo({
      project: '{"version":1,"features":{"memory":true,"learning":true,"knowledge":true},"memory":false,"learning":false}',
      personal: '{"reviewPublication":"auto","features":{},"knowledge":false,"decisions":false}',
    }));
    expect(bare).not.toMatch(EFFECTIVE);
    expect(layered).toBe(bare);
  }, 120_000);

  it.each(FEATURES)('%s: a project.json features:false adds exactly the effective line', (feature) => {
    seedManifest({});
    const bare = status(feature, makeRepo());
    const narrowed = status(feature, makeRepo({ project: `{"features":{"${feature}":false}}` }));
    expect(narrowed).toContain('Effective here: disabled (.devflow/project.json)');
    expect(withoutEffective(narrowed)).toBe(bare);
  }, 120_000);

  it.each(FEATURES)('%s: a config.json features:false names the personal file', (feature) => {
    seedManifest({});
    const narrowed = status(feature, makeRepo({ personal: `{"features":{"${feature}":false}}` }));
    expect(narrowed).toContain('Effective here: disabled (.devflow/config.json)');
  }, 120_000);

  it.each(FEATURES)('%s: with the machine switch off, a repo layer changes nothing', (feature) => {
    seedManifest({ [feature]: false });
    const bare = status(feature, makeRepo());
    const layered = status(feature, makeRepo({ project: `{"features":{"${feature}":false}}` }));
    expect(bare).not.toMatch(EFFECTIVE);
    expect(layered).toBe(bare);
  }, 120_000);
});

describe('--status warns about a tracked .devflow/config.json (D-PERSONAL-UNTRACKED)', () => {
  it.each(FEATURES)('%s: a tracked config.json is named as ignored, with the untrack command', (feature) => {
    seedManifest({});
    const repo = makeRepo({ personal: `{"features":{"${feature}":false}}` });
    execFileSync('git', ['add', '-f', '.devflow/config.json'], { cwd: repo, stdio: 'ignore' });

    const out = status(feature, repo);

    expect(out).toContain('.devflow/config.json is tracked by git, so devflow ignores it');
    expect(out).toContain('git rm --cached .devflow/config.json');
    // Ignored means absent: its features:false narrows nothing.
    expect(out).not.toMatch(EFFECTIVE);
  }, 120_000);

  it('an untracked config.json gets no warning', () => {
    seedManifest({});
    expect(status('memory', makeRepo({ personal: '{"features":{"memory":false}}' }))).not.toContain('tracked by git');
  }, 120_000);
});

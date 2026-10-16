/**
 * The learning switch under its two current keys, read by every reader (#529).
 *
 * The learning feature is being renamed to curation, so for now a machine
 * manifest and a repository file can both name it `curation` or `learning`. Four
 * readers decide the switch, and they must reach the same answer on every input:
 *
 *   - TypeScript:  isMachineFeatureOn (src/core/feature-switch.ts) and
 *                  readManifest (src/core/manifest.ts), the machine layer
 *   - the settings resolver, loaded through the TypeScript seam
 *                  (src/core/evidence-policy.ts loadSettingsModule): the machine
 *                  and the repository layers, parsed by lib/project-config.cjs
 *   - the shell gates, jq backend:  queue_read_gates (hooks/queue-append)
 *   - the shell gates, node backend: the same function with no jq
 *
 * The expected answers come from the rule written out below, not from any reader.
 *
 *   machine:    off when either current key is a boolean false; on when either is
 *               a boolean true; when neither is a boolean, the pre-rename
 *               `decisions` key decides if it is a boolean; otherwise on.
 *   repository: a narrow-only union: a literal false in either key turns it off.
 *   In both: a non-boolean value is ignored for that key only.
 *
 * Order matters for speed: the shell groups run before the groups that spawn
 * git, because on macOS the first node exec after a burst of forks is held until
 * the system policy check drains (NODE_EXEC_STALL_MS in shell-hooks-helpers.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isMachineFeatureOn } from '../../src/core/feature-switch.js';
import { readManifest } from '../../src/core/manifest.js';
import { loadSettingsModule, type SettingsModule } from '../../src/core/evidence-policy.js';

const HOOKS_DIR = path.resolve(__dirname, '..', '..', 'src', 'assets', 'scripts', 'hooks');

/** One key's state in a fixture: missing, a boolean, or the string "false". */
type Cell = 'absent' | 'true' | 'false' | 'text';
const CELLS: readonly Cell[] = ['absent', 'true', 'false', 'text'];

function entries(pairs: ReadonlyArray<readonly [string, Cell]>): Record<string, boolean | string> {
  return Object.fromEntries(
    pairs.filter(([, cell]) => cell !== 'absent').map(([key, cell]) => [key, cell === 'text' ? 'false' : cell === 'true']),
  );
}

const booleanOf = (cell: Cell): boolean | undefined => (cell === 'true' ? true : cell === 'false' ? false : undefined);

/** The machine rule, written out. */
function machineOn(curation: Cell, learning: Cell, decisions: Cell): boolean {
  const current = [booleanOf(curation), booleanOf(learning)].filter((v): v is boolean => v !== undefined);
  if (current.length > 0) return !current.includes(false);
  return booleanOf(decisions) !== false;
}

/** The repository rule, written out. */
function repoOn(curation: Cell, learning: Cell): boolean {
  return booleanOf(curation) !== false && booleanOf(learning) !== false;
}

function runShell(script: string): string {
  const full = `
set -e
log() { :; }
dbg() { :; }
source "${path.join(HOOKS_DIR, 'json-parse')}"
source "${path.join(HOOKS_DIR, 'get-mtime')}"
source "${path.join(HOOKS_DIR, 'learning-lock')}"
source "${path.join(HOOKS_DIR, 'queue-append')}"
${script}
`;
  return execFileSync('bash', ['-c', full], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseLines(out: string): Map<string, string> {
  return new Map(out.trim().split('\n').filter(Boolean).map((line) => {
    const [name, value] = line.split(' ');
    return [name, value] as const;
  }));
}

// ── The machine layer ────────────────────────────────────────────────────────

interface MachineCase {
  readonly name: string;
  readonly manifest: Record<string, unknown>;
  readonly expected: boolean;
}

const MACHINE_CASES: MachineCase[] = [];
for (const curation of CELLS) {
  for (const learning of CELLS) {
    for (const decisions of CELLS) {
      MACHINE_CASES.push({
        name: `m-${curation}-${learning}-${decisions}`,
        manifest: {
          version: '3.7.0',
          plugins: [],
          scope: 'user',
          installedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          features: {
            ambient: true,
            memory: true,
            hud: false,
            knowledge: true,
            rules: true,
            flags: {},
            proxy: false,
            ...entries([['curation', curation], ['learning', learning], ['decisions', decisions]]),
          },
        },
        expected: machineOn(curation, learning, decisions),
      });
    }
  }
}

/**
 * The cases the node backend reads. Each node exec can be slow, so the node
 * backend reads the cases that decide the rule: the jq backend reads the grid.
 */
const NODE_BACKEND_NAMES: ReadonlySet<string> = new Set([
  'm-true-false-absent', // a disagreeing pair resolves off
  'm-false-true-absent', // the same pair, the other way round
  'm-false-absent-absent', // curation alone
  'm-absent-false-absent', // learning alone
  'm-true-true-false', // a current key beats the pre-rename key
  'm-absent-absent-false', // the pre-rename key decides when neither is a boolean
  'm-text-text-false', // non-boolean current keys fall through to the pre-rename key
  'm-text-true-false', // a non-boolean key is ignored, the boolean one decides
  'm-true-true-true',
  'm-absent-absent-absent',
]);

// ── The repository layer ─────────────────────────────────────────────────────

interface RepoCase {
  readonly name: string;
  readonly project: string | null;
  readonly personal: string | null;
  readonly expected: boolean;
}

const fileOf = (curation: Cell, learning: Cell): string =>
  JSON.stringify({ version: 1, features: entries([['curation', curation], ['learning', learning]]) });

const REPO_CASES: RepoCase[] = [];
// project.json alone: the whole grid.
for (const curation of CELLS) {
  for (const learning of CELLS) {
    REPO_CASES.push({
      name: `p-${curation}-${learning}`, project: fileOf(curation, learning), personal: null, expected: repoOn(curation, learning),
    });
  }
}
// config.json alone: the pairs where one key is false, one is true, or one is text.
for (const [curation, learning] of [
  ['false', 'absent'], ['absent', 'false'], ['true', 'false'], ['false', 'true'], ['true', 'true'], ['text', 'false'],
] as const) {
  REPO_CASES.push({
    name: `c-${curation}-${learning}`, project: null, personal: fileOf(curation, learning), expected: repoOn(curation, learning),
  });
}
// The two keys split across the two files: a false in either file narrows.
for (const curation of ['absent', 'true', 'false'] as const) {
  for (const learning of ['absent', 'true', 'false'] as const) {
    REPO_CASES.push({
      name: `x-${curation}-${learning}`,
      project: fileOf(curation, 'absent'),
      personal: fileOf('absent', learning),
      expected: repoOn(curation, learning),
    });
  }
}

/**
 * The cases the shell reads. A file that can narrow forks the resolver once, on
 * either backend, so the shell reads the pairs that decide the rule.
 */
const REPO_SHELL_NAMES: ReadonlySet<string> = new Set([
  'p-false-absent', 'p-absent-false', 'p-true-false', 'p-false-true', 'p-true-true', 'p-absent-absent',
  'p-text-false', 'p-text-text',
  'c-false-absent', 'c-true-false', 'c-true-true',
  'x-false-absent', 'x-absent-false', 'x-true-true',
]);

const MACHINE_ON = { version: '3.7.0', features: { memory: true, curation: true, learning: true, knowledge: true } };

let tmp: string;
let settings: SettingsModule;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-readers-'));
  const loaded = loadSettingsModule();
  if (!loaded.ok) throw new Error('the settings module did not load');
  settings = loaded.value;
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('the grids', () => {
  it('the machine grid has every cell, with both answers', () => {
    expect(MACHINE_CASES).toHaveLength(64);
    expect(MACHINE_CASES.some((c) => !c.expected)).toBe(true);
    expect(MACHINE_CASES.some((c) => c.expected)).toBe(true);
    expect(MACHINE_CASES.filter((c) => NODE_BACKEND_NAMES.has(c.name))).toHaveLength(NODE_BACKEND_NAMES.size);
  });

  it('the repository grid has the whole project.json grid, the config.json pairs and the split layout', () => {
    expect(REPO_CASES).toHaveLength(16 + 6 + 9);
    expect(REPO_CASES.some((c) => !c.expected)).toBe(true);
    expect(REPO_CASES.some((c) => c.expected)).toBe(true);
    expect(REPO_CASES.filter((c) => REPO_SHELL_NAMES.has(c.name))).toHaveLength(REPO_SHELL_NAMES.size);
  });
});

describe('TypeScript readers: the machine layer', () => {
  it('isMachineFeatureOn follows the rule', () => {
    for (const c of MACHINE_CASES) expect(isMachineFeatureOn(c.manifest, 'learning'), c.name).toBe(c.expected);
  });

  it('readManifest follows the rule', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'read-manifest-'));
    for (const c of MACHINE_CASES) {
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(c.manifest));
      const read = await readManifest(dir);
      expect(read, c.name).not.toBeNull();
      expect(read!.features.learning, c.name).toBe(c.expected);
    }
  });
});

describe('shell gates: queue_read_gates', { timeout: 120_000 }, () => {
  for (const backend of [
    { name: 'jq backend', prelude: '', cases: MACHINE_CASES },
    { name: 'node backend', prelude: '_HAS_JQ=false', cases: MACHINE_CASES.filter((c) => NODE_BACKEND_NAMES.has(c.name)) },
  ]) {
    it(`machine layer, ${backend.name}, follows the rule`, () => {
      const dir = fs.mkdtempSync(path.join(tmp, 'machine-shell-'));
      for (const c of backend.cases) fs.writeFileSync(path.join(dir, `${c.name}.json`), JSON.stringify(c.manifest));
      const out = parseLines(runShell(`
        ${backend.prelude}
        for f in "${dir}"/m-*.json; do
          queue_read_gates "$f"
          b="\${f##*/}"
          echo "\${b%.json} $_QG_LEARNING"
        done
      `));
      expect(out.size).toBe(backend.cases.length);
      expect(backend.cases.some((c) => !c.expected)).toBe(true);
      expect(backend.cases.some((c) => c.expected)).toBe(true);
      for (const c of backend.cases) expect(out.get(c.name), c.name).toBe(String(c.expected));
    });
  }

  it('repository layer follows the rule', () => {
    const root = fs.mkdtempSync(path.join(tmp, 'repo-shell-'));
    const cases = REPO_CASES.filter((c) => REPO_SHELL_NAMES.has(c.name));
    for (const c of cases) {
      fs.mkdirSync(path.join(root, c.name, '.devflow'), { recursive: true });
      if (c.project !== null) fs.writeFileSync(path.join(root, c.name, '.devflow', 'project.json'), c.project);
      if (c.personal !== null) fs.writeFileSync(path.join(root, c.name, '.devflow', 'config.json'), c.personal);
    }
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(MACHINE_ON));
    const out = parseLines(runShell(`
      for d in ${cases.map((c) => `"${path.join(root, c.name)}"`).join(' ')}; do
        queue_read_gates "${path.join(root, 'manifest.json')}" "$d"
        echo "\${d##*/} $_QG_LEARNING"
      done
    `));
    expect(out.size).toBe(cases.length);
    expect(cases.some((c) => !c.expected)).toBe(true);
    expect(cases.some((c) => c.expected)).toBe(true);
    for (const c of cases) expect(out.get(c.name), c.name).toBe(String(c.expected));
  });
});

describe('the settings resolver, through the evidence-policy seam', { timeout: 120_000 }, () => {
  let repo: string;

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(tmp, 'resolver-repo-'));
    execFileSync('git', ['init', '-q', repo]);
    fs.mkdirSync(path.join(repo, '.devflow'));
  });

  it('follows the machine rule on every manifest', () => {
    for (const c of MACHINE_CASES) {
      const s = settings.resolveSettings({ dir: repo, manifest: c.manifest });
      expect(s.ok, c.name).toBe(true);
      expect(s.switches.learning.on, c.name).toBe(c.expected);
      expect(s.switches.learning.source, c.name).toBe('machine');
    }
  });

  it('follows the repository rule on every file layout', () => {
    for (const c of REPO_CASES) {
      for (const [file, bytes] of [['project.json', c.project], ['config.json', c.personal]] as const) {
        const target = path.join(repo, '.devflow', file);
        if (bytes === null) fs.rmSync(target, { force: true });
        else fs.writeFileSync(target, bytes);
      }
      const s = settings.resolveSettings({ dir: repo, manifest: MACHINE_ON });
      expect(s.ok, c.name).toBe(true);
      expect(s.switches.learning.on, c.name).toBe(c.expected);
      // memory and knowledge are untouched by a curation or learning key.
      expect(s.switches.memory.on, c.name).toBe(true);
      expect(s.switches.knowledge.on, c.name).toBe(true);
    }
  });

  it('a repository key never widens a machine switch that is off, in either name', () => {
    fs.writeFileSync(path.join(repo, '.devflow', 'project.json'), fileOf('true', 'true'));
    fs.rmSync(path.join(repo, '.devflow', 'config.json'), { force: true });
    const off = { version: '3.7.0', features: { memory: true, curation: false, learning: true, knowledge: true } };
    expect(settings.resolveSettings({ dir: repo, manifest: off }).switches.learning).toEqual({ on: false, source: 'machine' });
  });
});

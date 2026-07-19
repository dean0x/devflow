import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_PATH = path.resolve(__dirname, '../src/assets/agents/learning.md');
const ROOT = path.resolve(__dirname, '..');

/** Recursively find all files matching an extension under a directory. */
function findFiles(dir: string, exts: string[]): string[] {
  if (!fsSync.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, exts));
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

/** Extract the raw frontmatter block from a markdown agent file */
function parseFrontmatter(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  return fmMatch ? fmMatch[1] : '';
}

/** Extract a YAML-list field (e.g. tools:, skills:) from frontmatter */
function parseYamlList(frontmatter: string, field: string): string[] {
  const re = new RegExp(`^${field}:\\n((?:  - .+\\n?)+)`, 'm');
  const match = frontmatter.match(re);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map(l => l.replace(/^ {2}- /, '').trim())
    .filter(Boolean);
}

describe('learning agent', () => {
  let content: string;
  let frontmatter: string;

  beforeAll(async () => {
    content = await fs.readFile(AGENT_PATH, 'utf-8');
    frontmatter = parseFrontmatter(content);
  });

  describe('frontmatter', () => {
    it('is named Learning with model opus', () => {
      expect(frontmatter).toMatch(/^name: Learning$/m);
      expect(frontmatter).toMatch(/^model: opus$/m);
    });

    it('has the file-work tool set (Read, Bash, Write, Edit, Glob, Grep)', () => {
      const tools = parseYamlList(frontmatter, 'tools');
      expect(tools.sort()).toEqual(['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write']);
    });

    it('references only the apply-decisions skill', () => {
      const skills = parseYamlList(frontmatter, 'skills');
      expect(skills).toEqual(['devflow:apply-decisions']);
    });
  });

  describe('queue claim contract', () => {
    it('claims the queue via atomic mv to .processing', () => {
      expect(content).toContain(
        'mv .devflow/learning/.pending-turns.jsonl .devflow/learning/.pending-turns.processing',
      );
    });

    it('exits silently when the claim is lost or .processing is fresh', () => {
      expect(content).toMatch(/mv.*fails.*exit silently/is);
      expect(content).toMatch(/Fresh \(younger than 900s\).*Exit silently/s);
    });

    it('merges and re-claims a stale .processing leftover', () => {
      expect(content).toMatch(/Stale \(900s or older\)/);
      expect(content).toContain(
        'cat .devflow/learning/.pending-turns.jsonl >> .devflow/learning/.pending-turns.processing',
      );
    });

    it('heartbeats the claim file at the detection→curation boundary', () => {
      expect(content).toMatch(/Heartbeat.*touch.*Part 1 → Part 2 boundary/s);
    });

    it('deletes the claim file as the final act (consume-then-delete)', () => {
      expect(content).toMatch(/FINAL act.*unlink \.devflow\/learning\/\.pending-turns\.processing/s);
    });

    it('does not use bare rm - (blocked by devflow deny-list, PF-003)', () => {
      expect(content).not.toMatch(/\brm -/);
    });

    it('aborts without writes when inputs vanish mid-run', () => {
      expect(content).toMatch(/Vanished inputs.*stop without further writes/s);
    });
  });

  describe('ledger op contract', () => {
    it('keeps the Iron Law (assign-anchor owns numbering, render owns the .md)', () => {
      expect(content).toContain('assign-anchor OWNS NUMBERING');
      expect(content).toContain('NEVER HAND-EDIT decisions.md, pitfalls.md, or index.md');
    });

    it('calls assign-anchor, retire-anchor, and rotate-observations via json-helper', () => {
      expect(content).toMatch(/json-helper\.cjs" assign-anchor/);
      expect(content).toMatch(/json-helper\.cjs" retire-anchor/);
      expect(content).toMatch(/json-helper\.cjs" rotate-observations/);
    });

    it('keeps the curation bounds (≤5 changes, 7-day protection window)', () => {
      expect(content).toContain('≤5 curation changes');
      expect(content).toContain('7-day protection window');
    });

    it('keeps the ADR-XOR-PF hard rule', () => {
      expect(content).toContain('ADR-XOR-PF (hard rule)');
    });
  });

  describe('direct file access (no worker-era script reads)', () => {
    it('appends new observations one JSONL line at a time, never whole-file rewrites', () => {
      expect(content).toContain('cat >> .devflow/learning/decisions-log.jsonl');
      expect(content).toMatch(/never\s+rewrite the whole file/);
    });

    it('does not reference count-active (reads rendered files directly)', () => {
      expect(content).not.toContain('count-active');
    });

    it('does not reference staleness.cjs (checks file references itself)', () => {
      expect(content).not.toContain('staleness.cjs');
    });

    it('does not reference merge-observation (edits log rows directly)', () => {
      expect(content).not.toContain('merge-observation');
    });

    it('does not reference the .last-dream-ok success stamp', () => {
      expect(content).not.toContain('.last-dream-ok');
    });

    it('does not reference the last-run-summary file (summary is the final message)', () => {
      expect(content).not.toContain('last-run-summary');
    });
  });
});

// ---------------------------------------------------------------------------
// Lockstep tests — structural consistency between the Learning agent and
// related infrastructure (900s staleness threshold, directive, build output).
// ---------------------------------------------------------------------------

describe('lockstep: Learning agent 900s staleness matches directive', () => {
  const SESSION_START_CONTEXT = path.resolve(ROOT, 'src/assets/scripts/hooks/session-start-context');

  it('session-start-context directive also uses 900s as the freshness threshold', async () => {
    // Let readFile throw if the hook is missing — a missing hook is a real failure, not a skip
    const hookContent = await fs.readFile(SESSION_START_CONTEXT, 'utf-8');
    // Both the agent and the directive must agree on the exact constant (avoids PF-008 —
    // matching any substring containing "900" is not proof the threshold is the same)
    expect(hookContent).toContain('PROCESSING_STALE_SECS=900');
  });

  it('learning agent uses 900s freshness threshold (not an older value)', async () => {
    const content = await fs.readFile(AGENT_PATH, 'utf-8');
    expect(content).toContain('900s');
  });
});

describe('lockstep: no shipped artifact references .devflow/dream/ or subagent_type="Dream"', () => {
  // After the src/ restructure: shared/ → src/assets/, scripts/hooks/ → src/assets/scripts/hooks/,
  // commands/ → src/assets/commands/. Scan src/assets/ as the single source tree.
  const SHIPPED_DIRS = [
    path.join(ROOT, 'src', 'assets'),
  ];

  it('no .md or .mds file in src/assets/ references .devflow/dream/', () => {
    const files = SHIPPED_DIRS.flatMap(dir => findFiles(dir, ['.md', '.mds']));

    const violations: string[] = [];
    for (const f of files) {
      // Guard against TOCTOU: a parallel test (build-mds.test.ts) may plant and unlink
      // transient _test-*.mds fixtures in commands/ between our readdir and this read.
      // A vanished file cannot be a shipping violation — skip it. Rethrow all other errors.
      let content: string;
      try {
        content = fsSync.readFileSync(f, 'utf-8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      if (content.includes('.devflow/dream/')) {
        violations.push(path.relative(ROOT, f));
      }
    }

    expect(violations).toEqual([]);
  });

  it('no .md or .mds file in src/assets/ references subagent_type="Dream"', () => {
    const files = findFiles(path.join(ROOT, 'src', 'assets'), ['.md', '.mds']);

    const violations: string[] = [];
    for (const f of files) {
      // Defensive ENOENT guard (consistent with the sibling test above).
      let content: string;
      try {
        content = fsSync.readFileSync(f, 'utf-8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      if (content.includes('subagent_type="Dream"') || content.includes("subagent_type='Dream'")) {
        violations.push(path.relative(ROOT, f));
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('lockstep: dream.md not in src/assets/agents/', () => {
  it('dream.md does not exist in src/assets/agents/ (renamed to learning.md)', () => {
    // Ensures the old agent name never resurfaces in the canonical assets dir
    const dreamPath = path.join(ROOT, 'src', 'assets', 'agents', 'dream.md');
    expect(fsSync.existsSync(dreamPath), 'src/assets/agents/dream.md must not exist (use learning.md)').toBe(false);
  });
});

describe('AC-C9: decisions_load() (none) fallback for both absent and empty index', () => {
  // commands/ moved to src/assets/commands/ during the src/ restructure.
  const DECISIONS_MDS = path.resolve(ROOT, 'src/assets/commands/_partials/_decisions.mds');

  it('_decisions.mds sets DECISIONS_CONTEXT to (none) when index is absent', async () => {
    const content = await fs.readFile(DECISIONS_MDS, 'utf-8');
    expect(content).toContain('(none)');
  });

  it('_decisions.mds sets DECISIONS_CONTEXT to (none) when index is empty', async () => {
    const content = await fs.readFile(DECISIONS_MDS, 'utf-8');
    // Both "absent or empty" cases must be handled
    expect(content).toMatch(/absent or empty.*\(none\)/s);
  });

  it('_decisions.mds reads from .devflow/learning/index.md (not the old decisions/ path)', async () => {
    const content = await fs.readFile(DECISIONS_MDS, 'utf-8');
    expect(content).toContain('.devflow/learning/index.md');
    expect(content).not.toContain('.devflow/decisions/index.md');
  });
});

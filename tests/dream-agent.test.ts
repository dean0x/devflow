import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_PATH = path.resolve(__dirname, '../shared/agents/dream.md');

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

describe('dream agent', () => {
  let content: string;
  let frontmatter: string;

  beforeAll(async () => {
    content = await fs.readFile(AGENT_PATH, 'utf-8');
    frontmatter = parseFrontmatter(content);
  });

  describe('frontmatter', () => {
    it('is named Dream with model opus', () => {
      expect(frontmatter).toMatch(/^name: Dream$/m);
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
        'mv .devflow/dream/.pending-turns.jsonl .devflow/dream/.pending-turns.processing',
      );
    });

    it('exits silently when the claim is lost or .processing is fresh', () => {
      expect(content).toMatch(/mv.*fails.*exit silently/is);
      expect(content).toMatch(/Fresh \(younger than 900s\).*Exit silently/s);
    });

    it('merges and re-claims a stale .processing leftover', () => {
      expect(content).toMatch(/Stale \(900s or older\)/);
      expect(content).toContain(
        'cat .devflow/dream/.pending-turns.jsonl >> .devflow/dream/.pending-turns.processing',
      );
    });

    it('heartbeats the claim file at the detection→curation boundary', () => {
      expect(content).toMatch(/Heartbeat.*touch.*Part 1 → Part 2 boundary/s);
    });

    it('deletes the claim file as the final act (consume-then-delete)', () => {
      expect(content).toMatch(/FINAL act.*unlink \.devflow\/dream\/\.pending-turns\.processing/s);
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
      expect(content).toContain('cat >> .devflow/decisions/decisions-log.jsonl');
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

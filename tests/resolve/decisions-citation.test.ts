// tests/resolve/decisions-citation.test.ts
// Tests for Fix 1: /resolve reads and cites project decisions.
//
// Strategy: The loader logic lives in the production module
// scripts/hooks/lib/decisions-index.cjs; these tests import it directly
// for real coverage. The markdown structural tests verify that the instruction
// to invoke the module (or follow its algorithm) is present on every surface.
//
// Test groups:
//   1. Active-only contract — decisions-index.cjs parses active-only .md input correctly
//      (Deprecated/Superseded/Retired are hidden by the renderer before writing; the index
//       never sees them — filterDecisionsContext has been removed)
//   2. Structural tests: resolve.md — Step 0d presence + DECISIONS_CONTEXT in Phase 4
//      (decisions-index.cjs index invocation covered by tests/decisions/command-adoption.test.ts)
//   3. Structural tests: resolver.md — Input Context + Apply Decisions
//      (ADR/PF citation format + hallucination guard covered by tests/decisions/apply-decisions-skill.test.ts)
//   4. Cross-cutting: all resolve surfaces reference DECISIONS_CONTEXT

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { createRequire } from 'module';
import {
  ACTIVE_ADR, ACTIVE_PF,
} from '../decisions/fixtures';
import { loadFile, extractSection } from '../decisions/helpers';
import { makeTmpWorktree, cleanupTmpWorktrees } from '../decisions/fixtures';
import { afterAll } from 'vitest';

afterAll(() => cleanupTmpWorktrees());

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

// Import the production module — this is the real implementation, not a test copy.
const { loadDecisionsIndex } = require(
  path.join(ROOT, 'scripts/hooks/lib/decisions-index.cjs')
) as {
  loadDecisionsIndex: (worktree: string, opts?: { decisionsFile?: string; pitfallsFile?: string }) => string;
};

// ---------------------------------------------------------------------------
// Active-only contract: decisions-index.cjs parses active-only .md input
//
// The renderer guarantees .md files only contain active entries.
// filterDecisionsContext has been removed — these tests validate the
// active-only parse path that the index will always receive in practice.
// ---------------------------------------------------------------------------

describe('decisions-index active-only contract (post-render .md input)', () => {
  it('parses Active ADR sections correctly', () => {
    const tmpDir = makeTmpWorktree(ACTIVE_ADR);
    const result = loadDecisionsIndex(tmpDir);
    expect(result).toContain('ADR-001');
    expect(result).toContain('Use Result types everywhere');
  });

  it('parses Active PF sections correctly', () => {
    const tmpDir = makeTmpWorktree(undefined, ACTIVE_PF);
    const result = loadDecisionsIndex(tmpDir);
    expect(result).toContain('PF-004');
    expect(result).toContain('Background hook scripts');
  });

  it('returns "(none)" when both files are empty (no active entries)', () => {
    const tmpDir = makeTmpWorktree('', '');
    expect(loadDecisionsIndex(tmpDir)).toBe('(none)');
  });

  it('returns "(none)" when both files are absent', () => {
    const tmpDir = makeTmpWorktree();
    expect(loadDecisionsIndex(tmpDir)).toBe('(none)');
  });

  it('tags Accepted decisions with [Accepted] (renderer default for decisions)', () => {
    const adr = `## ADR-010: Use ledger for decisions\n\n- **Status**: Accepted\n- **Decision**: Always use the ledger\n`;
    const tmpDir = makeTmpWorktree(adr);
    const result = loadDecisionsIndex(tmpDir);
    expect(result).toContain('[Accepted]');
    expect(result).toContain('ADR-010');
  });

  it('tags Active pitfalls with [Active] (renderer default for pitfalls)', () => {
    const pf = `## PF-010: Watch for lock contention\n\n- **Status**: Active\n- **Area**: scripts/hooks/\n- **Description**: Lock ordering matters\n`;
    const tmpDir = makeTmpWorktree(undefined, pf);
    const result = loadDecisionsIndex(tmpDir);
    expect(result).toContain('[Active]');
    expect(result).toContain('PF-010');
  });

  it('shows both Decisions and Pitfalls blocks with correct counts', () => {
    const tmpDir = makeTmpWorktree(ACTIVE_ADR, ACTIVE_PF);
    const result = loadDecisionsIndex(tmpDir);
    expect(result).toContain('Decisions (1):');
    expect(result).toContain('Pitfalls (1):');
  });

  it('filterDecisionsContext is NOT exported (removed in Phase 8 cleanup)', () => {
    const mod = require(path.join(ROOT, 'scripts/hooks/lib/decisions-index.cjs')) as Record<string, unknown>;
    expect(mod.filterDecisionsContext).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Structural tests: resolve.md (base command)
// ---------------------------------------------------------------------------

describe('resolve.md — base command', () => {
  const content = loadFile('plugins/devflow-resolve/commands/resolve.md');

  it('contains Step 0d: Load Project Decisions after Phase 0c', () => {
    expect(content).toMatch(/Step 0d.*Load Project Decisions/i);
  });

  it('Step 0d instructs passing DECISIONS_CONTEXT to Phase 4 Resolvers', () => {
    const step0dSection = extractSection(content, 'Step 0d', '\n### Phase 1');
    expect(step0dSection).toContain('DECISIONS_CONTEXT');
  });

  it('Step 0d emits (none) when both files are absent or empty', () => {
    const step0dSection = extractSection(content, 'Step 0d', '\n### Phase 1');
    expect(step0dSection).toContain('(none)');
  });

  it('Phase 4 Resolver spawn block includes DECISIONS_CONTEXT variable', () => {
    const phase4Section = extractSection(content, '### Phase 4', '### Phase 5');
    expect(phase4Section).toContain('DECISIONS_CONTEXT');
  });

  it('Phase 5 or Phase 8 mentions Decisions Citations in resolution-summary.md (D-B)', () => {
    expect(content).toContain('Decisions Citations');
  });

  it('Step 0d is nested inside the per-worktree Phase 0 section (multi-worktree constraint)', () => {
    const phase0Start = content.indexOf('### Phase 0');
    const phase1Start = content.indexOf('### Phase 1');
    const step0dIdx = content.indexOf('Step 0d');
    expect(step0dIdx).toBeGreaterThan(phase0Start);
    expect(step0dIdx).toBeLessThan(phase1Start);
  });
});

// ---------------------------------------------------------------------------
// Structural tests: shared/agents/resolver.md
// ---------------------------------------------------------------------------

describe('resolver.md — Input Context and Apply Decisions section', () => {
  const content = loadFile('shared/agents/resolver.md');

  it('declares DECISIONS_CONTEXT in Input Context section', () => {
    const inputContextSection = extractSection(content, '## Input Context', '\n## ');
    expect(inputContextSection).toContain('DECISIONS_CONTEXT');
  });

  it('contains Apply Decisions section', () => {
    expect(content).toMatch(/## Apply Decisions|### Apply Decisions/);
  });

  it('Apply Decisions section describes citing inline in Reasoning column', () => {
    const applyStart = content.search(/## Apply Decisions|### Apply Decisions/);
    if (applyStart === -1) throw new Error('Apply Decisions section not found in resolver.md');
    const applyAnchor = content.slice(applyStart, applyStart + 30);
    const applySection = extractSection(content, applyAnchor.split('\n')[0], '\n## ');
    expect(applySection).toMatch(/[Rr]easoning/);
  });

  it('DECISIONS_CONTEXT is marked optional in Input Context', () => {
    const inputContextSection = extractSection(content, '## Input Context', '\n## ');
    const decisionsIdx = inputContextSection.indexOf('DECISIONS_CONTEXT');
    if (decisionsIdx === -1) throw new Error('DECISIONS_CONTEXT not found in Input Context section');
    const surroundingText = inputContextSection.slice(
      Math.max(0, decisionsIdx - 20),
      Math.min(inputContextSection.length, decisionsIdx + 120)
    );
    expect(surroundingText).toMatch(/optional|if provided|when provided|non-empty/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: all resolve surfaces reference DECISIONS_CONTEXT
// ---------------------------------------------------------------------------

describe('cross-cutting — DECISIONS_CONTEXT on resolve surfaces', () => {
  it('resolve.md contains DECISIONS_CONTEXT', () => {
    const content = loadFile('plugins/devflow-resolve/commands/resolve.md');
    expect(content).toContain('DECISIONS_CONTEXT');
  });

  it('resolver.md contains DECISIONS_CONTEXT', () => {
    const content = loadFile('shared/agents/resolver.md');
    expect(content).toContain('DECISIONS_CONTEXT');
  });
});

// tests/resolve/knowledge-citation.test.ts
// Tests for Fix 1: /resolve reads and cites project knowledge.
//
// Strategy: The filter + loader logic lives in the production module
// scripts/hooks/lib/knowledge-context.cjs; these tests import it directly
// for real coverage. The markdown structural tests verify that the instruction
// to invoke the module (or follow its algorithm) is present on every surface.
//
// Test groups:
//   1. Unit tests: filterKnowledgeContext (D-A filter) — imported from production module
//   2. Unit tests: loadKnowledgeContext — imported from production module
//   3. Structural tests: resolve.md — Step 0d presence + KNOWLEDGE_CONTEXT in Phase 4
//      (knowledge-context.cjs index invocation covered by tests/knowledge/command-adoption.test.ts)
//   4. Structural tests: resolve-teams.md — parity with base
//      (knowledge-context.cjs index invocation covered by tests/knowledge/command-adoption.test.ts)
//   5. Structural tests: resolve:orch SKILL.md — Phase 1.5 parity
//      (knowledge-context.cjs index invocation covered by tests/knowledge/command-adoption.test.ts)
//   6. Structural tests: resolver.md — Input Context + Apply Knowledge
//      (ADR/PF citation format + hallucination guard covered by tests/knowledge/apply-knowledge-skill.test.ts)
//   7. Cross-cutting: all four surfaces reference KNOWLEDGE_CONTEXT

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

// Import the production module — this is the real implementation, not a test copy.
const { filterKnowledgeContext, loadKnowledgeContext } = require(
  path.join(ROOT, 'scripts/hooks/lib/knowledge-context.cjs')
) as {
  filterKnowledgeContext: (raw: string) => string;
  loadKnowledgeContext: (worktreePath: string, opts?: { decisionsFile?: string; pitfallsFile?: string }) => string;
};

function loadFile(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

/**
 * Extract a named section from markdown content with a loud failure if the
 * anchor is not present. Section runs from startAnchor to endAnchor (or to
 * end-of-string if endAnchor is null).
 *
 * Uses exact string search (indexOf) to find anchors — fails loudly when the
 * anchor is absent rather than silently returning unrelated content.
 */
function extractSection(content: string, startAnchor: string, endAnchor: string | null): string {
  const start = content.indexOf(startAnchor);
  if (start === -1) {
    throw new Error(`Anchor not found in document: "${startAnchor}"`);
  }
  if (endAnchor === null) {
    return content.slice(start);
  }
  const end = content.indexOf(endAnchor, start + startAnchor.length);
  if (end === -1) {
    throw new Error(`End anchor not found after "${startAnchor}": "${endAnchor}"`);
  }
  return content.slice(start, end);
}

// ---------------------------------------------------------------------------
// Unit tests: filterKnowledgeContext (D-A filter) — production module
// ---------------------------------------------------------------------------

describe('filterKnowledgeContext — Deprecated/Superseded filtering (D-A)', () => {
  it('returns empty string when input is empty', () => {
    expect(filterKnowledgeContext('')).toBe('');
  });

  it('preserves Active ADR sections unchanged', () => {
    const input = `## ADR-001: Use Result types\n\n- **Status**: Active\n- **Decision**: Always return Result<T,E>\n`;
    const output = filterKnowledgeContext(input);
    expect(output).toContain('ADR-001');
    expect(output).toContain('Always return Result<T,E>');
  });

  it('removes Deprecated ADR sections', () => {
    const input = `## ADR-002: Old approach\n\n- **Status**: Deprecated\n- **Decision**: Do the old thing\n`;
    const output = filterKnowledgeContext(input);
    expect(output).not.toContain('ADR-002');
    expect(output).not.toContain('Do the old thing');
  });

  it('removes Superseded ADR sections', () => {
    const input = `## ADR-003: Superseded approach\n\n- **Status**: Superseded\n- **Decision**: Outdated pattern\n`;
    const output = filterKnowledgeContext(input);
    expect(output).not.toContain('ADR-003');
  });

  it('removes Deprecated PF sections', () => {
    const input = `## PF-001: Old pitfall\n\n- **Status**: Deprecated\n- **Description**: No longer relevant\n`;
    const output = filterKnowledgeContext(input);
    expect(output).not.toContain('PF-001');
  });

  it('keeps Active PF sections', () => {
    const input = `## PF-002: Active pitfall\n\n- **Status**: Active\n- **Description**: Still relevant gotcha\n`;
    const output = filterKnowledgeContext(input);
    expect(output).toContain('PF-002');
    expect(output).toContain('Still relevant gotcha');
  });

  it('preserves Active sections when mixed with Deprecated sections', () => {
    const input = [
      `## ADR-001: Keep this\n\n- **Status**: Active\n- **Decision**: Good choice\n`,
      `## ADR-002: Remove this\n\n- **Status**: Deprecated\n- **Decision**: Bad choice\n`,
      `## PF-001: Keep this pitfall\n\n- **Status**: Active\n- **Description**: Watch out\n`,
    ].join('\n');
    const output = filterKnowledgeContext(input);
    expect(output).toContain('ADR-001');
    expect(output).toContain('Good choice');
    expect(output).not.toContain('ADR-002');
    expect(output).not.toContain('Bad choice');
    expect(output).toContain('PF-001');
    expect(output).toContain('Watch out');
  });

  it('returns empty string when all sections are removed (orchestrator emits "(none)")', () => {
    const input = `## ADR-001: All deprecated\n\n- **Status**: Deprecated\n- **Decision**: Gone\n`;
    const output = filterKnowledgeContext(input);
    // Empty string signals orchestrator to emit "(none)"
    expect(output).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Unit tests: loadKnowledgeContext — production module
// ---------------------------------------------------------------------------

describe('loadKnowledgeContext — file loading + filtering', () => {
  function makeTmpWorktree(
    decisions?: string,
    pitfalls?: string
  ): string {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'knowledge-test-'));
    const knowledgeDir = path.join(tmpDir, '.memory', 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });
    if (decisions !== undefined) {
      writeFileSync(path.join(knowledgeDir, 'decisions.md'), decisions, 'utf8');
    }
    if (pitfalls !== undefined) {
      writeFileSync(path.join(knowledgeDir, 'pitfalls.md'), pitfalls, 'utf8');
    }
    return tmpDir;
  }

  it('returns "(none)" when both knowledge files are absent', () => {
    const tmpDir = makeTmpWorktree();
    expect(loadKnowledgeContext(tmpDir)).toBe('(none)');
  });

  it('returns "(none)" when both files are empty', () => {
    const tmpDir = makeTmpWorktree('', '');
    expect(loadKnowledgeContext(tmpDir)).toBe('(none)');
  });

  it('returns filtered decisions content when only decisions.md exists', () => {
    const decisions = `## ADR-001: Use Result types\n\n- **Status**: Active\n- **Decision**: Always return Result<T,E>\n`;
    const tmpDir = makeTmpWorktree(decisions);
    const result = loadKnowledgeContext(tmpDir);
    expect(result).toContain('ADR-001');
    expect(result).not.toBe('(none)');
  });

  it('returns filtered pitfalls content when only pitfalls.md exists', () => {
    const pitfalls = `## PF-001: Active pitfall\n\n- **Status**: Active\n- **Description**: Watch out\n`;
    const tmpDir = makeTmpWorktree(undefined, pitfalls);
    const result = loadKnowledgeContext(tmpDir);
    expect(result).toContain('PF-001');
    expect(result).not.toBe('(none)');
  });

  it('concatenates decisions and pitfalls content when both exist', () => {
    const decisions = `## ADR-001: Use Result types\n\n- **Status**: Active\n- **Decision**: Always return Result<T,E>\n`;
    const pitfalls = `## PF-001: Active pitfall\n\n- **Status**: Active\n- **Description**: Watch out\n`;
    const tmpDir = makeTmpWorktree(decisions, pitfalls);
    const result = loadKnowledgeContext(tmpDir);
    expect(result).toContain('ADR-001');
    expect(result).toContain('PF-001');
  });

  it('strips Deprecated sections from both files before concatenating', () => {
    const decisions = `## ADR-001: Keep\n\n- **Status**: Active\n- **Decision**: Good\n\n## ADR-002: Drop\n\n- **Status**: Deprecated\n- **Decision**: Bad\n`;
    const pitfalls = `## PF-001: Drop\n\n- **Status**: Deprecated\n- **Description**: Gone\n`;
    const tmpDir = makeTmpWorktree(decisions, pitfalls);
    const result = loadKnowledgeContext(tmpDir);
    expect(result).toContain('ADR-001');
    expect(result).not.toContain('ADR-002');
    expect(result).not.toContain('PF-001');
  });

  it('returns "(none)" when all sections in both files are Deprecated', () => {
    const decisions = `## ADR-001: Deprecated\n\n- **Status**: Deprecated\n- **Decision**: Gone\n`;
    const pitfalls = `## PF-001: Deprecated\n\n- **Status**: Deprecated\n- **Description**: Gone\n`;
    const tmpDir = makeTmpWorktree(decisions, pitfalls);
    expect(loadKnowledgeContext(tmpDir)).toBe('(none)');
  });

  it('accepts custom file paths via opts for isolated testing', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'knowledge-test-opts-'));
    const customFile = path.join(tmpDir, 'custom-decisions.md');
    writeFileSync(customFile, `## ADR-042: Custom\n\n- **Status**: Active\n- **Decision**: Custom entry\n`, 'utf8');
    const result = loadKnowledgeContext(tmpDir, { decisionsFile: 'custom-decisions.md' });
    expect(result).toContain('ADR-042');
  });
});

// ---------------------------------------------------------------------------
// Structural tests: resolve.md (base command)
// ---------------------------------------------------------------------------

describe('resolve.md — base command', () => {
  const content = loadFile('plugins/devflow-resolve/commands/resolve.md');

  it('contains Step 0d: Load Project Knowledge after Phase 0c', () => {
    expect(content).toMatch(/Step 0d.*Load Project Knowledge/i);
  });

  it('Step 0d instructs passing KNOWLEDGE_CONTEXT to Phase 4 Resolvers', () => {
    const step0dSection = extractSection(content, 'Step 0d', '\n### Phase 1');
    expect(step0dSection).toContain('KNOWLEDGE_CONTEXT');
  });

  it('Step 0d emits (none) when both files are absent or empty', () => {
    const step0dSection = extractSection(content, 'Step 0d', '\n### Phase 1');
    expect(step0dSection).toContain('(none)');
  });

  it('Phase 4 Resolver spawn block includes KNOWLEDGE_CONTEXT variable', () => {
    const phase4Section = extractSection(content, '### Phase 4', '### Phase 5');
    expect(phase4Section).toContain('KNOWLEDGE_CONTEXT');
  });

  it('Phase 5 or Phase 8 mentions Knowledge Citations in resolution-summary.md (D-B)', () => {
    expect(content).toContain('Knowledge Citations');
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
// Structural tests: resolve-teams.md (teams variant — must match base)
// ---------------------------------------------------------------------------

describe('resolve-teams.md — teams variant parity', () => {
  const content = loadFile('plugins/devflow-resolve/commands/resolve-teams.md');

  it('contains Step 0d: Load Project Knowledge', () => {
    expect(content).toMatch(/Step 0d.*Load Project Knowledge/i);
  });

  it('Phase 4 Resolver teammate prompt includes KNOWLEDGE_CONTEXT variable', () => {
    const phase4Section = extractSection(content, '### Phase 4', '### Phase 5');
    expect(phase4Section).toContain('KNOWLEDGE_CONTEXT');
  });

  it('mentions Knowledge Citations for resolution-summary.md (D-B)', () => {
    expect(content).toContain('Knowledge Citations');
  });
});

// ---------------------------------------------------------------------------
// Structural tests: resolve:orch SKILL.md (ambient mode)
// ---------------------------------------------------------------------------

describe('resolve:orch SKILL.md — ambient mode parity', () => {
  const content = loadFile('shared/skills/resolve:orch/SKILL.md');

  it('contains Phase 1.5: Load Project Knowledge between Phase 1 and Phase 2', () => {
    expect(content).toMatch(/Phase 1\.5.*Load Project Knowledge/i);
  });

  it('Phase 4 spawn block includes KNOWLEDGE_CONTEXT', () => {
    const phase4Section = extractSection(content, '## Phase 4', '## Phase 5');
    expect(phase4Section).toContain('KNOWLEDGE_CONTEXT');
  });

  it('Phase 6 (Report) mentions Knowledge Citations (D-B)', () => {
    const phase6Section = extractSection(content, '## Phase 6', '## Error Handling');
    expect(phase6Section).toContain('Knowledge Citations');
  });
});

// ---------------------------------------------------------------------------
// Structural tests: shared/agents/resolver.md
// ---------------------------------------------------------------------------

describe('resolver.md — Input Context and Apply Knowledge section', () => {
  const content = loadFile('shared/agents/resolver.md');

  it('declares KNOWLEDGE_CONTEXT in Input Context section', () => {
    const inputContextSection = extractSection(content, '## Input Context', '\n## ');
    expect(inputContextSection).toContain('KNOWLEDGE_CONTEXT');
  });

  it('contains Apply Knowledge section', () => {
    expect(content).toMatch(/## Apply Knowledge|### Apply Knowledge/);
  });

  it('Apply Knowledge section describes citing inline in Reasoning column', () => {
    const applyStart = content.search(/## Apply Knowledge|### Apply Knowledge/);
    if (applyStart === -1) throw new Error('Apply Knowledge section not found in resolver.md');
    const applyAnchor = content.slice(applyStart, applyStart + 30);
    const applySection = extractSection(content, applyAnchor.split('\n')[0], '\n## ');
    expect(applySection).toMatch(/[Rr]easoning/);
  });

  it('KNOWLEDGE_CONTEXT is marked optional in Input Context', () => {
    const inputContextSection = extractSection(content, '## Input Context', '\n## ');
    const knowledgeIdx = inputContextSection.indexOf('KNOWLEDGE_CONTEXT');
    if (knowledgeIdx === -1) throw new Error('KNOWLEDGE_CONTEXT not found in Input Context section');
    const surroundingText = inputContextSection.slice(
      Math.max(0, knowledgeIdx - 20),
      Math.min(inputContextSection.length, knowledgeIdx + 120)
    );
    expect(surroundingText).toMatch(/optional|if provided|when provided|non-empty/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: all four surfaces reference KNOWLEDGE_CONTEXT
// ---------------------------------------------------------------------------

describe('cross-cutting — KNOWLEDGE_CONTEXT on all four surfaces', () => {
  it('resolve.md contains KNOWLEDGE_CONTEXT', () => {
    const content = loadFile('plugins/devflow-resolve/commands/resolve.md');
    expect(content).toContain('KNOWLEDGE_CONTEXT');
  });

  it('resolve-teams.md contains KNOWLEDGE_CONTEXT', () => {
    const content = loadFile('plugins/devflow-resolve/commands/resolve-teams.md');
    expect(content).toContain('KNOWLEDGE_CONTEXT');
  });

  it('resolve:orch SKILL.md contains KNOWLEDGE_CONTEXT', () => {
    const content = loadFile('shared/skills/resolve:orch/SKILL.md');
    expect(content).toContain('KNOWLEDGE_CONTEXT');
  });

  it('resolver.md contains KNOWLEDGE_CONTEXT', () => {
    const content = loadFile('shared/agents/resolver.md');
    expect(content).toContain('KNOWLEDGE_CONTEXT');
  });
});

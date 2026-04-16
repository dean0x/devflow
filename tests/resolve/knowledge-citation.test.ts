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
//   2. Unit tests: filterKnowledgeContext — imported from production module
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
import * as path from 'path';
import { createRequire } from 'module';
import {
  ACTIVE_ADR, ACTIVE_PF, DEPRECATED_ADR, DEPRECATED_PF,
  SUPERSEDED_ADR,
} from '../knowledge/fixtures';
import { loadFile, extractSection } from '../knowledge/helpers';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

// Import the production module — this is the real implementation, not a test copy.
const { filterKnowledgeContext } = require(
  path.join(ROOT, 'scripts/hooks/lib/knowledge-context.cjs')
) as {
  filterKnowledgeContext: (raw: string) => string;
};

// ---------------------------------------------------------------------------
// Unit tests: filterKnowledgeContext (D-A filter) — production module
// ---------------------------------------------------------------------------

describe('filterKnowledgeContext — Deprecated/Superseded filtering (D-A)', () => {
  it('returns empty string when input is empty', () => {
    expect(filterKnowledgeContext('')).toBe('');
  });

  it('preserves Active ADR sections unchanged', () => {
    const output = filterKnowledgeContext(ACTIVE_ADR);
    expect(output).toContain('ADR-001');
    expect(output).toContain('Always return Result<T,E>');
  });

  it('removes Deprecated ADR sections', () => {
    const output = filterKnowledgeContext(DEPRECATED_ADR);
    expect(output).not.toContain('ADR-002');
    expect(output).not.toContain('Do the old thing');
  });

  it('removes Superseded ADR sections', () => {
    const output = filterKnowledgeContext(SUPERSEDED_ADR);
    expect(output).not.toContain('ADR-003');
  });

  it('removes Deprecated PF sections', () => {
    const output = filterKnowledgeContext(DEPRECATED_PF);
    expect(output).not.toContain('PF-001');
  });

  it('keeps Active PF sections', () => {
    const output = filterKnowledgeContext(ACTIVE_PF);
    expect(output).toContain('PF-004');
    expect(output).toContain('Watch out for growing scripts');
  });

  it('preserves Active sections when mixed with Deprecated sections', () => {
    const input = [ACTIVE_ADR, DEPRECATED_ADR, ACTIVE_PF].join('\n');
    const output = filterKnowledgeContext(input);
    expect(output).toContain('ADR-001');
    expect(output).toContain('Always return Result<T,E>');
    expect(output).not.toContain('ADR-002');
    expect(output).not.toContain('Do the old thing');
    expect(output).toContain('PF-004');
    expect(output).toContain('Watch out for growing scripts');
  });

  it('returns empty string when all sections are removed (orchestrator emits "(none)")', () => {
    const output = filterKnowledgeContext(DEPRECATED_ADR);
    // Empty string signals orchestrator to emit "(none)"
    expect(output).toBe('');
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

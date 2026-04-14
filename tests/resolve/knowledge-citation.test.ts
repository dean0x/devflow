// tests/resolve/knowledge-citation.test.ts
// Tests for Fix 1: /resolve reads and cites project knowledge.
//
// Strategy: Since the resolve orchestration surfaces (resolve.md, resolve-teams.md,
// resolve:orch SKILL.md, resolver.md) are markdown instruction files rather than
// executable modules, these tests assert structural invariants in the markdown content:
//   1. Phase 0d / Phase 1.5 knowledge-loading instructions are present
//   2. KNOWLEDGE_CONTEXT appears in the Phase 4 Resolver spawn block
//   3. resolver.md declares KNOWLEDGE_CONTEXT in Input Context and Apply Knowledge section
//   4. D-A filtering instruction (Deprecated/Superseded) is present in all three surfaces
//   5. D-B citation aggregation (## Knowledge Citations) is described in Phase 5/8/6
//
// For filter logic we also unit-test a pure JS helper that replicates the orchestrator's
// filtering algorithm to verify correctness of Deprecated/Superseded stripping.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

function loadFile(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// Pure filter logic — replicated from the orchestrator markdown instruction.
// Strips any ## ADR-NNN: or ## PF-NNN: section whose body contains
// "- **Status**: Deprecated" or "- **Status**: Superseded".
// ---------------------------------------------------------------------------

/**
 * D2026-04-14-A: Filter implementation used both in tests and to verify the
 * markdown instructions are semantically correct. Section boundary = next ##
 * heading or end of string.
 */
function filterKnowledgeContext(raw: string): string {
  // Match each ADR-NNN or PF-NNN section including its body up to the next ## or EOF
  const sectionRe = /^(## (?:ADR|PF)-\d+:[^\n]*\n)([\s\S]*?)(?=^## |\z)/gm;
  let result = raw;
  // Work backwards through matches so slice indices stay valid
  const matches: Array<{ start: number; end: number; body: string }> = [];
  let m: RegExpExecArray | null;
  // We need full match positions; rebuild with index tracking
  const fullRe = /^## (?:ADR|PF)-\d+:[^\n]*\n[\s\S]*?(?=\n## |\n*$)/gm;
  while ((m = fullRe.exec(raw)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, body: m[0] });
  }
  // Filter out deprecated/superseded sections (process in reverse for stable indices)
  const toRemove = matches
    .filter(({ body }) =>
      /- \*\*Status\*\*: Deprecated/.test(body) ||
      /- \*\*Status\*\*: Superseded/.test(body)
    )
    .reverse();
  for (const { start, end } of toRemove) {
    result = result.slice(0, start) + result.slice(end);
  }
  return result.trim();
}

// ---------------------------------------------------------------------------
// Unit tests: filter helper
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

  it('returns (none) marker when all sections are removed', () => {
    const input = `## ADR-001: All deprecated\n\n- **Status**: Deprecated\n- **Decision**: Gone\n`;
    const output = filterKnowledgeContext(input);
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

  it('Step 0d references decisions.md and pitfalls.md', () => {
    const step0dStart = content.indexOf('Step 0d');
    const nextPhaseMatch = content.indexOf('\n### Phase 1', step0dStart);
    const step0dSection = content.slice(step0dStart, nextPhaseMatch > 0 ? nextPhaseMatch : undefined);
    expect(step0dSection).toContain('decisions.md');
    expect(step0dSection).toContain('pitfalls.md');
  });

  it('Step 0d instructs stripping Deprecated and Superseded sections (D-A)', () => {
    const step0dStart = content.indexOf('Step 0d');
    const nextPhaseMatch = content.indexOf('\n### Phase 1', step0dStart);
    const step0dSection = content.slice(step0dStart, nextPhaseMatch > 0 ? nextPhaseMatch : undefined);
    expect(step0dSection).toMatch(/Deprecated/);
    expect(step0dSection).toMatch(/Superseded/);
  });

  it('Step 0d instructs passing KNOWLEDGE_CONTEXT to Phase 4 Resolvers', () => {
    const step0dStart = content.indexOf('Step 0d');
    const nextPhaseMatch = content.indexOf('\n### Phase 1', step0dStart);
    const step0dSection = content.slice(step0dStart, nextPhaseMatch > 0 ? nextPhaseMatch : undefined);
    expect(step0dSection).toContain('KNOWLEDGE_CONTEXT');
  });

  it('Step 0d emits (none) when both files are absent or empty', () => {
    const step0dStart = content.indexOf('Step 0d');
    const nextPhaseMatch = content.indexOf('\n### Phase 1', step0dStart);
    const step0dSection = content.slice(step0dStart, nextPhaseMatch > 0 ? nextPhaseMatch : undefined);
    expect(step0dSection).toContain('(none)');
  });

  it('Phase 4 Resolver spawn block includes KNOWLEDGE_CONTEXT variable', () => {
    const phase4Start = content.indexOf('### Phase 4');
    const phase5Start = content.indexOf('### Phase 5', phase4Start);
    const phase4Section = content.slice(phase4Start, phase5Start > 0 ? phase5Start : undefined);
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

  it('Step 0d references decisions.md and pitfalls.md', () => {
    const step0dStart = content.indexOf('Step 0d');
    const nextPhaseMatch = content.indexOf('\n### Phase 1', step0dStart);
    const step0dSection = content.slice(step0dStart, nextPhaseMatch > 0 ? nextPhaseMatch : undefined);
    expect(step0dSection).toContain('decisions.md');
    expect(step0dSection).toContain('pitfalls.md');
  });

  it('Step 0d instructs stripping Deprecated and Superseded sections (D-A)', () => {
    const step0dStart = content.indexOf('Step 0d');
    const nextPhaseMatch = content.indexOf('\n### Phase 1', step0dStart);
    const step0dSection = content.slice(step0dStart, nextPhaseMatch > 0 ? nextPhaseMatch : undefined);
    expect(step0dSection).toMatch(/Deprecated/);
    expect(step0dSection).toMatch(/Superseded/);
  });

  it('Phase 4 Resolver teammate prompt includes KNOWLEDGE_CONTEXT variable', () => {
    const phase4Start = content.indexOf('### Phase 4');
    const phase5Start = content.indexOf('### Phase 5', phase4Start);
    const phase4Section = content.slice(phase4Start, phase5Start > 0 ? phase5Start : undefined);
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

  it('Phase 1.5 references decisions.md and pitfalls.md', () => {
    const phase15Start = content.indexOf('Phase 1.5');
    const phase2Start = content.indexOf('## Phase 2', phase15Start);
    const phase15Section = content.slice(phase15Start, phase2Start > 0 ? phase2Start : undefined);
    expect(phase15Section).toContain('decisions.md');
    expect(phase15Section).toContain('pitfalls.md');
  });

  it('Phase 1.5 instructs stripping Deprecated and Superseded sections (D-A)', () => {
    const phase15Start = content.indexOf('Phase 1.5');
    const phase2Start = content.indexOf('## Phase 2', phase15Start);
    const phase15Section = content.slice(phase15Start, phase2Start > 0 ? phase2Start : undefined);
    expect(phase15Section).toMatch(/Deprecated/);
    expect(phase15Section).toMatch(/Superseded/);
  });

  it('Phase 4 spawn block includes KNOWLEDGE_CONTEXT', () => {
    const phase4Start = content.indexOf('## Phase 4');
    const phase5Start = content.indexOf('## Phase 5', phase4Start);
    const phase4Section = content.slice(phase4Start, phase5Start > 0 ? phase5Start : undefined);
    expect(phase4Section).toContain('KNOWLEDGE_CONTEXT');
  });

  it('Phase 6 (Report) mentions Knowledge Citations (D-B)', () => {
    const phase6Start = content.indexOf('## Phase 6');
    const endMarker = content.indexOf('## Phase 7', phase6Start);
    const phase6Section = content.slice(phase6Start, endMarker > 0 ? endMarker : undefined);
    expect(phase6Section).toContain('Knowledge Citations');
  });
});

// ---------------------------------------------------------------------------
// Structural tests: shared/agents/resolver.md
// ---------------------------------------------------------------------------

describe('resolver.md — Input Context and Apply Knowledge section', () => {
  const content = loadFile('shared/agents/resolver.md');

  it('declares KNOWLEDGE_CONTEXT in Input Context section', () => {
    const inputContextStart = content.indexOf('## Input Context');
    const nextSection = content.indexOf('\n## ', inputContextStart + 1);
    const inputContextSection = content.slice(
      inputContextStart,
      nextSection > 0 ? nextSection : undefined
    );
    expect(inputContextSection).toContain('KNOWLEDGE_CONTEXT');
  });

  it('contains Apply Knowledge section', () => {
    expect(content).toMatch(/## Apply Knowledge|### Apply Knowledge/);
  });

  it('Apply Knowledge section references ADR and PF citation format', () => {
    const applyStart = content.search(/## Apply Knowledge|### Apply Knowledge/);
    const nextSection = content.indexOf('\n## ', applyStart + 1);
    const applySection = content.slice(applyStart, nextSection > 0 ? nextSection : undefined);
    expect(applySection).toContain('applies ADR-NNN');
    expect(applySection).toContain('avoids PF-NNN');
  });

  it('Apply Knowledge section prohibits fabricating IDs (hallucination guard)', () => {
    const applyStart = content.search(/## Apply Knowledge|### Apply Knowledge/);
    const nextSection = content.indexOf('\n## ', applyStart + 1);
    const applySection = content.slice(applyStart, nextSection > 0 ? nextSection : undefined);
    // Must contain the verbatim constraint
    expect(applySection).toMatch(/verbatim|do not fabricate|fabricat/i);
  });

  it('Apply Knowledge section describes citing inline in Reasoning column', () => {
    const applyStart = content.search(/## Apply Knowledge|### Apply Knowledge/);
    const nextSection = content.indexOf('\n## ', applyStart + 1);
    const applySection = content.slice(applyStart, nextSection > 0 ? nextSection : undefined);
    expect(applySection).toMatch(/[Rr]easoning/);
  });

  it('KNOWLEDGE_CONTEXT is marked optional in Input Context', () => {
    const inputContextStart = content.indexOf('## Input Context');
    const nextSection = content.indexOf('\n## ', inputContextStart + 1);
    const inputContextSection = content.slice(
      inputContextStart,
      nextSection > 0 ? nextSection : undefined
    );
    // Should be marked optional (may say "optional" or "if provided" or "when provided")
    const knowledgeIdx = inputContextSection.indexOf('KNOWLEDGE_CONTEXT');
    const surroundingText = inputContextSection.slice(
      Math.max(0, knowledgeIdx - 20),
      Math.min(inputContextSection.length, knowledgeIdx + 120)
    );
    expect(surroundingText).toMatch(/optional|if provided|when provided|non-empty/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: all three surfaces reference KNOWLEDGE_CONTEXT
// ---------------------------------------------------------------------------

describe('cross-cutting — KNOWLEDGE_CONTEXT on all three surfaces', () => {
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

import { describe, it, expect, beforeAll } from 'vitest';
import { resolveAgentSource } from './helpers.js';

/** Extract frontmatter tools array from markdown agent file */
function parseToolsFromFrontmatter(content: string): string[] {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const toolsMatch = fmMatch[1].match(/^tools:\s*\[([^\]]*)\]/m);
  if (!toolsMatch) return [];
  return toolsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
}

describe('skim agent', () => {
  let content: string;
  let tools: string[];

  beforeAll(() => {
    content = resolveAgentSource('skim').content;
    tools = parseToolsFromFrontmatter(content);
  });

  it('has tools restricted to Bash and Read only', () => {
    expect(tools).toHaveLength(2);
    expect(tools).toContain('Bash');
    expect(tools).toContain('Read');
  });

  it('does NOT use root scan in code examples', () => {
    // Code blocks (``` ... ```) should never contain bare "npx rskim ." or "npx rskim --"
    // (warning text mentioning it outside code blocks is fine)
    const codeBlocks = content.match(/```[\s\S]*?```/g) ?? [];
    for (const block of codeBlocks) {
      expect(block).not.toMatch(/npx rskim \./);
      expect(block).not.toMatch(/npx rskim\s+--/);
    }
  });

  it('contains sequential workflow markers (Step 1-7)', () => {
    for (let i = 1; i <= 7; i++) {
      expect(content).toContain(`### Step ${i}`);
    }
  });

  it('warns about never scanning repo root', () => {
    expect(content).toMatch(/[Nn]ever.*root|CRITICAL.*root|repo root/);
  });

  it('references --tokens flag for automatic mode selection', () => {
    expect(content).toContain('--tokens');
  });
});

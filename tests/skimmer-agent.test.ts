import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_PATH = path.resolve(__dirname, '../shared/agents/skimmer.md');

/** Extract frontmatter tools array from markdown agent file */
function parseToolsFromFrontmatter(content: string): string[] {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const toolsMatch = fmMatch[1].match(/^tools:\s*\[([^\]]*)\]/m);
  if (!toolsMatch) return [];
  return toolsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
}

describe('skimmer agent', () => {
  let content: string;
  let tools: string[];

  it('loads the agent file', async () => {
    content = await fs.readFile(AGENT_PATH, 'utf-8');
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

  it('contains sequential workflow markers (Step 1-6)', () => {
    for (let i = 1; i <= 6; i++) {
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

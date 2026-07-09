// tests/hud-transcript.test.ts
// First-ever coverage of parseTranscript — the JSONL parser that feeds the HUD.
// Validates Skill tool_use extraction + dedup, and skill persistence across human turns.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseTranscript } from '../src/cli/hud/transcript.js';

/** Build a JSONL line for an assistant turn with the given content blocks. */
function assistantLine(blocks: Record<string, unknown>[]): string {
  return JSON.stringify({ type: 'assistant', message: { content: blocks } });
}

/** Build a Skill tool_use block. */
function skillBlock(skill: string, id: string): Record<string, unknown> {
  return { type: 'tool_use', name: 'Skill', id, input: { skill } };
}

/** Build a Bash tool_use block. */
function bashBlock(command: string, id: string): Record<string, unknown> {
  return { type: 'tool_use', name: 'Bash', id, input: { command, description: command } };
}

/** Human turn line (clears tools/agents). */
const HUMAN_LINE = JSON.stringify({ type: 'human' });

describe('parseTranscript', () => {
  let tmpDir: string;
  let transcriptPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-transcript-'));
    transcriptPath = path.join(tmpDir, 'transcript.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts and deduplicates Skill tool_use entries', async () => {
    // devflow:testing appears twice, devflow:git once — expect 2 unique skills
    const lines = [
      assistantLine([skillBlock('devflow:testing', 'skill-1')]),
      assistantLine([skillBlock('devflow:testing', 'skill-2')]),
      assistantLine([skillBlock('devflow:git', 'skill-3')]),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const result = await parseTranscript(transcriptPath);
    expect(result).not.toBeNull();
    expect(result!.skills).toHaveLength(2);
    expect(result!.skills).toContain('devflow:testing');
    expect(result!.skills).toContain('devflow:git');
  });

  it('skills persist across human turn boundaries while tools and agents clear', async () => {
    // Pre-human: a Bash tool + a Skill
    // Human boundary (clears tools/agents but NOT skills)
    // Post-human: another Bash tool
    const lines = [
      assistantLine([bashBlock('ls', 'tool-1'), skillBlock('devflow:testing', 'skill-1')]),
      HUMAN_LINE,
      assistantLine([bashBlock('pwd', 'tool-2')]),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const result = await parseTranscript(transcriptPath);
    expect(result).not.toBeNull();

    // Skills accumulated before the human turn must persist after it
    expect(result!.skills).toContain('devflow:testing');

    // Only the post-human Bash tool should appear (human boundary clears tools)
    expect(result!.tools).toHaveLength(1);
    expect(result!.tools[0].name).toBe('Bash');
    // The pre-human 'ls' was cleared; only 'pwd' (post-human) remains
    expect(result!.tools[0].description).toContain('pwd');
  });

  it('returns null when transcript file does not exist', async () => {
    const result = await parseTranscript(path.join(tmpDir, 'nonexistent.jsonl'));
    expect(result).toBeNull();
  });
});

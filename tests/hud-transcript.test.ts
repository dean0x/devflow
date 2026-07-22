// tests/hud-transcript.test.ts
// Coverage of parseTranscript — the JSONL parser that feeds the HUD.
// Validates Skill tool_use extraction + dedup, per-turn boundary clearing,
// tool completion transitions, todo progress, and skill persistence.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseTranscript } from '../src/hud/transcript.js';

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

/** Real user turn line (clears tools/agents per-turn). */
const USER_LINE = JSON.stringify({ type: 'user', message: { content: [] } });

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

  it('skills persist across user turn boundaries while tools and agents clear', async () => {
    // Pre-user: a Bash tool + a Skill + an Agent spawn
    // User boundary (clears tools/agents but NOT skills)
    // Post-user: another Bash tool
    const agentBlock: Record<string, unknown> = {
      type: 'tool_use',
      name: 'Agent',
      id: 'agent-1',
      input: { subagent_type: 'Reviewer', description: 'review code' },
    };
    const lines = [
      assistantLine([bashBlock('ls', 'tool-1'), skillBlock('devflow:testing', 'skill-1'), agentBlock]),
      USER_LINE,
      assistantLine([bashBlock('pwd', 'tool-2')]),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const result = await parseTranscript(transcriptPath);
    expect(result).not.toBeNull();

    // Skills accumulated before the user turn must persist after it
    expect(result!.skills).toContain('devflow:testing');

    // Only the post-user Bash tool should appear (user boundary clears tools)
    expect(result!.tools).toHaveLength(1);
    expect(result!.tools[0].name).toBe('Bash');
    // The pre-user 'ls' was cleared; only 'pwd' (post-user) remains
    expect(result!.tools[0].description).toContain('pwd');

    // The Agent spawned before the user boundary must also be cleared
    expect(result!.agents).toHaveLength(0);
  });

  it('tool_result within assistant turn marks tool as completed', async () => {
    // A tool_use followed by tool_result in the same assistant entry transitions
    // the tool's status from running → completed.
    const lines = [
      assistantLine([
        { type: 'tool_use', name: 'Bash', id: 'bash-1', input: { command: 'git status', description: 'git status' } },
        { type: 'tool_result', tool_use_id: 'bash-1', content: 'on branch main' },
      ]),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const result = await parseTranscript(transcriptPath);
    expect(result).not.toBeNull();
    expect(result!.tools).toHaveLength(1);
    expect(result!.tools[0].name).toBe('Bash');
    expect(result!.tools[0].status).toBe('completed');
  });

  it('TodoWrite tool_use updates todo progress counts', async () => {
    // Three todos with 2 completed: expects completed=2, total=3.
    const lines = [
      assistantLine([
        {
          type: 'tool_use',
          name: 'TodoWrite',
          id: 'todo-1',
          input: {
            todos: [
              { id: '1', content: 'First task', status: 'completed', priority: 'high' },
              { id: '2', content: 'Second task', status: 'pending', priority: 'medium' },
              { id: '3', content: 'Third task', status: 'completed', priority: 'low' },
            ],
          },
        },
      ]),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const result = await parseTranscript(transcriptPath);
    expect(result).not.toBeNull();
    expect(result!.todos.total).toBe(3);
    expect(result!.todos.completed).toBe(2);
  });

  it('returns null when transcript file does not exist', async () => {
    const result = await parseTranscript(path.join(tmpDir, 'nonexistent.jsonl'));
    expect(result).toBeNull();
  });
});

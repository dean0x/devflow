import * as fs from 'node:fs';
import * as readline from 'node:readline';
import type { TranscriptData } from './types.js';

// Precompiled patterns
const TODO_WRITE_NAME = /^TodoWrite$/i;

/**
 * Parse a Claude Code session transcript (JSONL) to extract tool/agent activity and todo progress.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export async function parseTranscript(
  transcriptPath: string,
): Promise<TranscriptData | null> {
  try {
    if (!fs.existsSync(transcriptPath)) return null;

    const tools = new Map<
      string,
      { name: string; status: 'running' | 'completed' }
    >();
    const agents = new Map<
      string,
      { name: string; model?: string; status: 'running' | 'completed' }
    >();
    let todosCompleted = 0;
    let todosTotal = 0;

    const stream = fs.createReadStream(transcriptPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const todoResult = processEntry(entry, tools, agents);
        if (todoResult) {
          todosCompleted = todoResult.completed;
          todosTotal = todoResult.total;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return {
      tools: Array.from(tools.values()),
      agents: Array.from(agents.values()),
      todos: { completed: todosCompleted, total: todosTotal },
    };
  } catch {
    return null;
  }
}

interface TodoResult {
  completed: number;
  total: number;
}

function processEntry(
  entry: Record<string, unknown>,
  tools: Map<string, { name: string; status: 'running' | 'completed' }>,
  agents: Map<
    string,
    { name: string; model?: string; status: 'running' | 'completed' }
  >,
): TodoResult | null {
  if (entry.type !== 'assistant' || !entry.message) return null;
  const message = entry.message as {
    content?: Array<Record<string, unknown>>;
  };
  if (!Array.isArray(message.content)) return null;

  let todoResult: TodoResult | null = null;

  for (const block of message.content) {
    const blockType = block.type as string;

    if (blockType === 'tool_use') {
      const name = block.name as string;
      const id = block.id as string;

      if (name === 'Agent' || name === 'Task') {
        // Agent spawn
        const input = block.input as Record<string, unknown> | undefined;
        const agentType = (input?.subagent_type as string) || 'Agent';
        agents.set(id, {
          name: agentType,
          model: input?.model as string | undefined,
          status: 'running',
        });
      } else if (TODO_WRITE_NAME.test(name)) {
        // Track todos
        const input = block.input as Record<string, unknown> | undefined;
        const todos = input?.todos;
        if (Array.isArray(todos)) {
          const total = todos.length;
          const completed = todos.filter(
            (t: Record<string, unknown>) => t.status === 'completed',
          ).length;
          todoResult = { completed, total };
        }
      } else {
        tools.set(id, { name, status: 'running' });
      }
    } else if (blockType === 'tool_result') {
      const toolUseId = block.tool_use_id as string;
      const toolEntry = tools.get(toolUseId);
      if (toolEntry) {
        toolEntry.status = 'completed';
      }
      const agentEntry = agents.get(toolUseId);
      if (agentEntry) {
        agentEntry.status = 'completed';
      }
    }
  }

  return todoResult;
}

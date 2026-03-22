import * as fs from 'node:fs';
import * as path from 'node:path';
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
      { name: string; status: 'running' | 'completed'; target?: string; description?: string }
    >();
    const agents = new Map<
      string,
      { name: string; model?: string; status: 'running' | 'completed'; description?: string }
    >();
    const skills = new Set<string>();
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

        // Turn boundary: clear tools and agents on each human message
        // so only the current turn's activity shows in the HUD
        if (entry.type === 'human') {
          tools.clear();
          agents.clear();
          continue;
        }

        const todoResult = processEntry(entry, tools, agents, skills);
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
      skills: Array.from(skills),
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
  tools: Map<string, { name: string; status: 'running' | 'completed'; target?: string; description?: string }>,
  agents: Map<
    string,
    { name: string; model?: string; status: 'running' | 'completed'; description?: string }
  >,
  skills: Set<string>,
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
        const agentDesc = typeof input?.description === 'string' ? input.description : undefined;
        agents.set(id, {
          name: agentType,
          model: input?.model as string | undefined,
          status: 'running',
          description: agentDesc,
        });
      } else if (name === 'Skill') {
        // Track loaded skills
        const input = block.input as Record<string, unknown> | undefined;
        if (input?.skill && typeof input.skill === 'string') {
          skills.add(input.skill);
        }
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
        // Regular tool — extract file target for Read/Edit/Write
        const input = block.input as Record<string, unknown> | undefined;
        let target: string | undefined;
        if (input?.file_path && typeof input.file_path === 'string') {
          target = path.basename(input.file_path);
        }
        // Extract description: prefer input.description, fallback to first 4 words of command (Bash)
        let description: string | undefined;
        if (typeof input?.description === 'string') {
          description = input.description;
        } else if (name === 'Bash' && typeof input?.command === 'string') {
          description = input.command.split(/\s+/).slice(0, 4).join(' ');
        }
        tools.set(id, { name, status: 'running', target, description });
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

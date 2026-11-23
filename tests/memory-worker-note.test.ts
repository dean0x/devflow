import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useWarmFakeExecutables } from './helpers/warm-fake-executable.js';
import { gitIsolatedEnv, isolatedEnv } from './setup/home-isolation.js';
import {
  answersVersion,
  HOOK_RUN_ALLOWANCE_MS,
  HOOKS_DIR,
  NODE_EXEC_STALL_MS,
  resolveOnPath,
  runGitForFarm,
} from './shell-hooks-helpers.js';

const WORKER = path.join(HOOKS_DIR, 'background-memory-update');
const FARM_TOOLS = [
  'bash', 'cat', 'chmod', 'cksum', 'cp', 'cut', 'date', 'dirname', 'echo', 'find',
  'git', 'grep', 'head', 'kill', 'ls', 'mkdir', 'mktemp', 'mv', 'nohup', 'od',
  'printf', 'rm', 'rmdir', 'sed', 'sleep', 'stat', 'tail', 'touch', 'tr', 'wc',
] as const;
const writeFakeExecutable = useWarmFakeExecutables();
const INTERLEAVE_LOG = 'Queue rows interleave across sessions';

function nodeOnlyPath(binDir: string): string {
  for (const tool of FARM_TOOLS) {
    const git = tool === 'git' ? runGitForFarm() : undefined;
    const target = git ?? resolveOnPath(tool, '/usr/bin:/bin');
    if (target !== undefined) fs.symlinkSync(target, path.join(binDir, tool));
  }
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  return binDir;
}

function row(role: 'user' | 'assistant' | 'qa', content: string, session_id?: unknown): string {
  return JSON.stringify({ role, content, ts: 1, session_id });
}

const A = 'test-session_1';
const B = 'test-session_10';

describe.each(['jq', 'node'] as const)('worker note with %s', (backend) => {
  let root: string;
  let project: string;
  let home: string;
  let bin: string;
  let memoryDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worker-note-')));
    ({ project, home, bin } = makeFolders(root));
    memoryDir = path.join(project, '.devflow', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    env = gitIsolatedEnv(isolatedEnv(process.env, home));
    execFileSync('git', ['init', '-q', project], { env, stdio: 'ignore' });
    writeClaudeStub();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeClaudeStub(): void {
    writeFakeExecutable(path.join(bin, 'claude'), answersVersion(`#!/bin/bash
cat > "$TEST_PROMPT" || exit 1
printf '%s\n' '<!-- memory-head: (set by devflow) -->' '## Now' 'Test note' '## Progress' > "$TEST_STAGE"
`));
  }

  function runQueue(rows: readonly string[]): { turns: string[]; prompt: string; log: string } {
    const promptFile = path.join(root, 'prompt');
    const PATH = backend === 'node' ? nodeOnlyPath(bin) : `${bin}:${env.PATH ?? '/usr/bin:/bin'}`;
    expect(resolveOnPath('claude', PATH)).toBe(path.join(bin, 'claude'));
    if (backend === 'jq') expect(resolveOnPath('jq', PATH)).toBeDefined();
    else expect(resolveOnPath('jq', PATH)).toBeUndefined();
    fs.writeFileSync(path.join(memoryDir, '.pending-turns.jsonl'), rows.join('\n') + '\n');

    execFileSync('/bin/bash', [WORKER, project], {
      env: { ...env, PATH, TEST_PROMPT: promptFile, TEST_STAGE: path.join(memoryDir, 'WORKING-MEMORY.md.new') },
      stdio: 'ignore',
    });

    const log = fs.readFileSync(path.join(home, '.devflow', 'logs', project.slice(1).replaceAll('/', '-'), '.background-memory-update.log'), 'utf8');
    expect(fs.existsSync(promptFile), log).toBe(true);
    const prompt = fs.readFileSync(promptFile, 'utf8');
    const turns = [...prompt.matchAll(/^Turn \d+:\n([^\n]+(?:\nAssistant:[^\n]*)?)/gm)].map((match) => match[1] ?? '');
    return { turns, prompt, log };
  }

  const budget = HOOK_RUN_ALLOWANCE_MS + NODE_EXEC_STALL_MS;

  it('pairs only matching sessions and keeps the current prompt across a different reply and a question', () => {
    const { turns, prompt, log } = runQueue([
      row('user', 'First prompt', A),
      row('user', 'Second prompt', B),
      row('assistant', 'First reply', A),
      row('qa', 'Q: Pick a color\nA: Blue', B),
      row('assistant', 'Second reply', B),
    ]);

    expect(turns).toEqual([
      'User: First prompt',
      'Assistant: First reply',
      'Q&A: Q: Pick a color A: Blue',
      'User: Second prompt\nAssistant: Second reply',
    ]);
    expect(log).toContain(INTERLEAVE_LOG);
    for (const id of [A, B]) {
      expect(prompt).not.toContain(id);
      expect(log).not.toContain(id);
    }
  }, budget);

  it('does not mark consecutive sessions or pair a legacy row with a tagged row', () => {
    const { turns, log } = runQueue([
      row('user', 'Legacy prompt'),
      row('assistant', 'Tagged reply', A),
      row('assistant', 'Legacy reply'),
      row('user', 'Tagged prompt', B),
      row('assistant', 'Matching reply', B),
    ]);

    expect(turns).toEqual([
      'Assistant: Tagged reply',
      'User: Legacy prompt\nAssistant: Legacy reply',
      'User: Tagged prompt\nAssistant: Matching reply',
    ]);
    expect(log).not.toContain(INTERLEAVE_LOG);
  }, budget);

  it('counts a question from a second session without taking the first session prompt', () => {
    const { turns, log } = runQueue([
      row('user', 'Prompt', A),
      row('qa', 'Q: Which file?\nA: The first', B),
      row('assistant', 'Reply', A),
    ]);

    expect(turns).toEqual(['Q&A: Q: Which file? A: The first', 'User: Prompt\nAssistant: Reply']);
    expect(log).toContain(INTERLEAVE_LOG);
  }, budget);

  it('treats invalid IDs as absent without changing the count of unreadable rows', () => {
    const invalid = ['bad\n', 'bad\t', 'bad\x01', '../bad', 'a'.repeat(65), 123, { id: 'bad' }, '.', 'bad\x00'];
    const { turns, log } = runQueue([
      row('user', 'New prompt', A),
      ...invalid.map((id, index) => row('assistant', `Unassigned reply ${index}`, id)),
      'malformed{',
      '{"role":"assistant","content":7}',
      row('assistant', 'New reply', A),
    ]);

    expect(turns).toEqual([
      ...invalid.map((_, index) => `Assistant: Unassigned reply ${index}`),
      'User: New prompt\nAssistant: New reply',
    ]);
    expect(log).toContain('Skipped 2 queue line(s) that hold no readable turn');
    expect(log).not.toContain(INTERLEAVE_LOG);
  }, budget);
});

function makeFolders(root: string): { project: string; home: string; bin: string } {
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  for (const dir of [project, home, bin]) fs.mkdirSync(dir);
  return { project, home, bin };
}

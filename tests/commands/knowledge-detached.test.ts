/**
 * D-DETACHED-HEAD (#382 P02, TP-52) — a knowledge write-back on a detached HEAD is
 * surfaced, not silent.
 *
 * The Knowledge agent never commits on a detached HEAD: that commit becomes
 * unreachable once HEAD moves. It still writes the files, so the skip must carry
 * the paths it left uncommitted (src/assets/agents/knowledge.md), and every command
 * that writes knowledge back must tell the user about them in its final report
 * (src/assets/commands/_partials/_knowledge.mds, `knowledge_writeback` Step 4).
 * Two halves of one contract, so both are checked here, each by a named collector
 * with a known-bad probe over the wording it replaced.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { requireDistFile, requireDistFiles } from '../helpers.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const KNOWLEDGE_AGENT = path.join(ROOT, 'src', 'assets', 'agents', 'knowledge.md');
const WRITEBACK_HEADING = '### Feature Knowledge Write-Back (Conditional)';
const DETACHED_OUTCOME = 'KB_COMMIT: skipped (detached HEAD) — uncommitted: ';

/** Named collector: what the agent's commit guard is missing for the detached case. */
function collectAgentGuardProblems(agentText: string): string[] {
  const guard = /^1\. \*\*Guard\.\*\*.*$/m.exec(agentText)?.[0] ?? '';
  const output = /^KB_COMMIT: .*$/m.exec(agentText)?.[0] ?? '';
  const problems: string[] = [];
  if (!guard) return ['no commit guard'];
  if (!guard.includes('symbolic-ref -q HEAD')) problems.push('guard: no detached-HEAD test');
  if (!guard.includes(`\`${DETACHED_OUTCOME}\``)) problems.push('guard: detached outcome does not list the uncommitted paths');
  if (!guard.includes('Never commit on a detached HEAD')) problems.push('guard: commits on a detached HEAD');
  if (!output.includes('skipped (detached HEAD) — uncommitted: <paths>')) problems.push('output: detached outcome missing');
  return problems;
}

/** Named collector: whether a compiled write-back surfaces the detached skip to the user. */
function collectSurfacingProblems(commandText: string): string[] {
  const at = commandText.indexOf(WRITEBACK_HEADING);
  if (at === -1) return ['no write-back step'];
  const section = commandText.slice(at);
  const step4 = /\*\*Step 4[^\n]*\n\n([^\n]*)/.exec(section)?.[1] ?? '';
  if (!step4) return ['no Step 4'];
  const problems: string[] = [];
  if (!step4.includes('`KB_COMMIT: skipped (detached HEAD)`')) problems.push('does not key on the detached outcome');
  if (!step4.includes("workflow's final report")) problems.push('not surfaced in the final report');
  if (!step4.includes('name the uncommitted paths')) problems.push('does not name the paths');
  if (!step4.includes('Never commit them yourself')) problems.push('invites the orchestrator to commit');
  return problems;
}

const writebackCommands = () => requireDistFiles().filter(f => requireDistFile(f).includes(WRITEBACK_HEADING));

describe('a detached-HEAD knowledge write-back is surfaced to the user (TP-52)', () => {
  it('the Knowledge agent reports the paths it left uncommitted', () => {
    expect(collectAgentGuardProblems(fs.readFileSync(KNOWLEDGE_AGENT, 'utf-8'))).toEqual([]);
  });

  it('every compiled write-back tells the user which paths still need a commit', () => {
    const files = writebackCommands();
    expect(files.length, 'non-vacuity: the write-back step is compiled somewhere').toBeGreaterThan(0);
    for (const file of files) {
      expect(collectSurfacingProblems(requireDistFile(file)), file).toEqual([]);
    }
  });

  it('known-bad probe: the silent skip is reported by both collectors', () => {
    const silentGuard = [
      '1. **Guard.** If `git -C "{worktree}" rev-parse --is-inside-work-tree` is not `true`, or `git -C "{worktree}" symbolic-ref -q HEAD` prints nothing (detached HEAD), skip committing and report `KB_COMMIT: skipped (no branch)`. Never commit on a detached HEAD.',
      'KB_COMMIT: committed <sha> | skipped (no changes) | skipped (no branch) | failed (<reason>)',
    ].join('\n');
    expect(collectAgentGuardProblems(silentGuard)).toEqual([
      'guard: detached outcome does not list the uncommitted paths',
      'output: detached outcome missing',
    ]);
    const noStep4 = `${WRITEBACK_HEADING}\n\n**Failure handling**: Non-blocking.`;
    expect(collectSurfacingProblems(noStep4)).toEqual(['no Step 4']);
  });
});

import * as fs from 'node:fs';
import type { ComponentResult, GatherContext, LearningCountsData } from '../types.js';
import { dim } from '../colors.js';
import { getDecisionsLedgerPath } from '../../core/project-paths.js';
import { getLedgerRoot, type LedgerRootOptions } from '../../core/ledger-root.js';
import { isActiveDecisionsStatus } from '../../core/observations.js';

/** The HUD's per-git-command budget (src/hud/git.ts GIT_TIMEOUT). */
const LEDGER_ROOT_TIMEOUT_MS = 1000;

/**
 * The largest ledger the statusline reads: 8 MiB, far above the roughly 0.5 MB
 * real ledgers reach.
 *
 * D-HUD-LEDGER-BOUNDED: the statusline counts the ledger only when it is a regular
 * file of at most LEDGER_MAX_BYTES, and never reads it through a symbolic link; a
 * link, any other kind of file or a larger one shows no counts, as an absent
 * ledger does. Reason: the statusline reads the ledger on every prompt, and a
 * repository can commit it as a link to an endless source such as /dev/zero, or
 * as a huge file, either of which would hang the statusline.
 */
export const LEDGER_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The ledger's text, or null when D-HUD-LEDGER-BOUNDED refuses it or it cannot be
 * read. lstat refuses a link without following it, the open refuses one that took
 * the ledger's place since (O_NOFOLLOW) and never blocks on a FIFO (O_NONBLOCK),
 * and the read takes at most the size fstat checked.
 */
function readBoundedLedger(ledgerPath: string): string | null {
  let fd: number;
  try {
    if (!fs.lstatSync(ledgerPath).isFile()) return null;
    fd = fs.openSync(ledgerPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > LEDGER_MAX_BYTES) return null;
    const buf = Buffer.alloc(stat.size);
    let total = 0;
    while (total < buf.length) {
      const read = fs.readSync(fd, buf, total, buf.length - total, total);
      if (read === 0) break;
      total += read;
    }
    return buf.toString('utf-8', 0, total);
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @devflow-design-decision D309
 * Counts come from decisions-ledger.jsonl (the render source of truth), NOT
 * the rendered decisions.md/pitfalls.md, so the HUD never couples to markdown
 * format. A row counts when anchor_id is set and isActiveDecisionsStatus calls
 * its decisions_status active — the one status list, which core/observations.ts
 * shares with the hooks' learning store and the renderer — so the numbers always
 * equal the entries visible in the rendered files.
 */
interface LedgerCountRow {
  type: 'decision' | 'pitfall';
  anchor_id: string;
  decisions_status?: string;
}

function isLedgerCountRow(val: unknown): val is LedgerCountRow {
  if (typeof val !== 'object' || val === null) return false;
  const o = val as Record<string, unknown>;
  if (o.type !== 'decision' && o.type !== 'pitfall') return false;
  if (typeof o.anchor_id !== 'string' || o.anchor_id.length === 0) return false;
  return o.decisions_status === undefined || typeof o.decisions_status === 'string';
}

/**
 * Read .devflow/learning/decisions-ledger.jsonl and count active anchored
 * rows by type. Returns null if the ledger is missing, is refused by
 * D-HUD-LEDGER-BOUNDED, or holds no valid rows (graceful fallback). Exported for
 * use by the main HUD entry point.
 */
export function gatherLearningCounts(cwd: string): LearningCountsData | null {
  const content = readBoundedLedger(getDecisionsLedgerPath(cwd));
  if (content === null) return null;

  const counts: LearningCountsData = { decisions: 0, pitfalls: 0 };
  let parsedAny = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Skip malformed lines — graceful
      continue;
    }

    if (!isLedgerCountRow(parsed)) continue;
    parsedAny = true;

    if (!isActiveDecisionsStatus(parsed.decisions_status)) continue;
    if (parsed.type === 'decision') counts.decisions++;
    else counts.pitfalls++;
  }

  return parsedAny ? counts : null;
}

/**
 * Count the ledger the hooks write for a session started in `cwd`: the ledger
 * root (getLedgerRoot — the main checkout in a linked worktree, the repository
 * root from a subdirectory), or `cwd` itself outside a git work tree. One git
 * call, bounded by the HUD's per-command budget; run it alongside the git
 * status gather, not after it (D-LEDGER-MAIN-WORKTREE).
 */
export async function gatherLedgerLearningCounts(
  cwd: string,
  options: Pick<LedgerRootOptions, 'home'> = {},
): Promise<LearningCountsData | null> {
  const root = await getLedgerRoot(cwd, { ...options, timeoutMs: LEDGER_ROOT_TIMEOUT_MS });
  return gatherLearningCounts(root ?? cwd);
}

/**
 * HUD component: decisions/pitfalls counts.
 * Shows how many active ADR/PF entries the project has accumulated.
 * Returns null when no ledger exists or every entry is retired.
 */
export default async function learningCounts(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const data = ctx.learningCounts;
  if (!data) return null;

  const { decisions, pitfalls } = data;
  if (decisions + pitfalls === 0) return null;

  const parts: string[] = [];
  if (decisions > 0) parts.push(`${decisions} decision${decisions !== 1 ? 's' : ''}`);
  if (pitfalls > 0) parts.push(`${pitfalls} pitfall${pitfalls !== 1 ? 's' : ''}`);

  // Intentionally one dimmed clause (unlike config-counts, which dims each
  // part and joins with a middot for a list of independent facts): "Learning:
  // N decisions, M pitfalls" reads as a single sentence, so the whole string
  // is dimmed once and parts are comma-joined rather than middot-separated.
  const raw = `Learning: ${parts.join(', ')}`;
  return { text: dim(raw), raw };
}

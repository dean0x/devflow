import * as fs from 'node:fs';
import type { ComponentResult, GatherContext, DecisionsCountsData } from '../types.js';
import { dim } from '../colors.js';
import { getDecisionsLedgerPath } from '../../utils/project-paths.js';

/**
 * @devflow-design-decision D309
 * Counts come from decisions-ledger.jsonl (the render source of truth), NOT
 * the rendered decisions.md/pitfalls.md, so the HUD never couples to markdown
 * format. Active-row semantics mirror render-decisions.cjs exactly: a row
 * counts when anchor_id is set and decisions_status is absent or outside
 * INACTIVE_STATUSES — so the numbers always equal the entries visible in the
 * rendered files.
 */
const INACTIVE_STATUSES = new Set(['Deprecated', 'Superseded', 'Retired']);

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

function isActive(row: LedgerCountRow): boolean {
  if (!row.decisions_status) return true;
  return !INACTIVE_STATUSES.has(row.decisions_status);
}

/**
 * Read .devflow/decisions/decisions-ledger.jsonl and count active anchored
 * rows by type. Returns null if the ledger is missing or holds no valid rows
 * (graceful fallback). Exported for use by the main HUD entry point.
 */
export function gatherDecisionsCounts(cwd: string): DecisionsCountsData | null {
  let content: string;
  try {
    content = fs.readFileSync(getDecisionsLedgerPath(cwd), 'utf-8');
  } catch {
    return null;
  }

  const counts: DecisionsCountsData = { decisions: 0, pitfalls: 0 };
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

    if (!isActive(parsed)) continue;
    if (parsed.type === 'decision') counts.decisions++;
    else counts.pitfalls++;
  }

  return parsedAny ? counts : null;
}

/**
 * HUD component: decisions/pitfalls counts.
 * Shows how many active ADR/PF entries the project has accumulated.
 * Returns null when no ledger exists or every entry is retired.
 */
export default async function decisionsCounts(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const data = ctx.decisionsCounts;
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

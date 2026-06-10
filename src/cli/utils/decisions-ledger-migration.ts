import { promises as fs } from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { acquireMkdirLock } from './mkdir-lock.js';
import {
  getDecisionsDir,
  getDecisionsLockDir,
  getDecisionsFilePath,
  getPitfallsFilePath,
  getDecisionsLedgerPath,
  getDecisionsLogPath,
} from './project-paths.js';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import {
  LedgerRow,
  DecisionsEntryStatus,
  DECISIONS_ENTRY_STATUSES,
} from './observations.js';

/**
 * @file decisions-ledger-migration.ts
 *
 * Phase 4 of the decisions ledger split: preserve-verbatim per-project migration.
 *
 * Reads existing decisions.md + pitfalls.md + decisions-log.jsonl, builds a
 * decisions-ledger.jsonl (anchored rows only, committed to git), then re-renders
 * both .md files from the ledger via the bundled render-decisions.cjs.
 *
 * Algorithm:
 *   1. Parse .md sections by heading; capture anchor_id, title, date,
 *      decisions_status, obs_id join key, amendments, and verbatim raw_body.
 *   2. For each .md section: if obs_id in log → enrich that log row into the
 *      ledger; if obs_id absent (ADR-001 case) → synthesize a fresh row.
 *   3. Log rows with artifact_path#ANCHOR whose ANCHOR is absent from .md →
 *      decisions_status:'Retired', number reserved, NOT rendered.
 *   4. Observing-only rows (no anchor_id, status:'observing') → stay in log.
 *   5. Edge cases: no-Source → obs_migrated_{anchor}; duplicate Source → warn
 *      + keep first; missing ledger/log/md handled gracefully.
 *   6. Write ledger atomically → render both .md → return (crash-safe ordering).
 *
 * Idempotent: if ledger already has rows for these anchors, re-running is a
 * clean no-op (same anchor_ids are de-duplicated).
 *
 * Per PF-007: the renderer is called from the BUNDLED package code at
 * `scripts/hooks/lib/render-decisions.cjs` resolved relative to this file's
 * dist location, NOT from `~/.devflow/scripts/` (which may not exist at
 * init time). Path: __dirname (dist/utils/) → ../../scripts/hooks/lib/
 *
 * Per ADR-001 EXCEPTION: data-preserving migration is explicitly approved.
 * Per ADR-008: renderer is deterministic plumbing; content was LLM-authored.
 * Applies ADR-017: holds .decisions.lock for the full operation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrateDecisionsLedgerResult {
  /** Rows successfully anchored from .md (newly added to ledger). */
  anchored: number;
  /** Rows synthesized (no Source obs in the log). */
  synthesized: number;
  /** Anchors from log (artifact_path#ANCHOR) absent from .md → Retired. */
  retired: number;
  /** Rows that remained as observing-only (not anchored, not rendered). */
  observingKept: number;
  /** Non-fatal warnings (duplicate Source IDs, etc.). */
  warnings: string[];
}

// Internal parsed representation of one .md section
interface ParsedMdSection {
  anchorId: string;        // e.g. 'ADR-001' (3-digit padded)
  kind: 'decision' | 'pitfall';
  title: string;
  date?: string;           // YYYY-MM-DD (decisions only)
  decisionsStatus: string; // from '- **Status**:' line
  obsId: string | null;    // obs ID from '- **Source**: self-learning:{id}' or null
  rawBody: string;         // verbatim block starting with \n## ...
  amendments: { date: string; note: string }[];
}

/**
 * D301: LogRow represents the raw shape of a row stored in decisions-log.jsonl.
 *
 * This is intentionally a permissive type — log rows come from JSON.parse and
 * may be LearningObservation-shaped (with confidence/observations/evidence) or
 * older seed rows (with artifact_path#ANCHOR). All fields are optional except
 * `id`, which is required for set-membership lookups. The `[key: string]: unknown`
 * index preserves any unknown fields through spread-merge when enriching a log
 * row into a LedgerRow.
 *
 * LogRow is ONLY used to represent raw input from decisions-log.jsonl. Final
 * output rows written to decisions-ledger.jsonl are always typed as the shared
 * `LedgerRow` (from observations.ts), which enforces required fields and a
 * typed decisions_status discriminant.
 */
interface LogRow {
  id: string;
  type?: string;
  pattern?: string;
  details?: string;
  status?: string;
  created?: string;
  first_seen?: string;
  last_seen?: string;
  artifact_path?: string;   // e.g. '/path/decisions.md#ADR-002' (seed rows)
  observations?: number;
  // Optional ledger fields (may be pre-set by assign-anchor)
  anchor_id?: string;
  date?: string;
  decisions_status?: string;
  amendments?: { date: string; note: string }[];
  raw_body?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// .md parsing
// ---------------------------------------------------------------------------

/**
 * Split the content of a decisions.md or pitfalls.md file into sections
 * by heading using a lookahead regex. Returns all sections that start with
 * `## (ADR|PF)-NNN:`.
 *
 * The raw_body boundary: each section is the text captured by the lookahead
 * split — starting immediately at the `## (ADR|PF)-NNN:` heading. We prepend
 * a `\n` to match the renderer's verbatim passthrough contract (renderDecisionsFile
 * expects raw_body to start with `\n## ...`).
 */
function parseMdSections(content: string, kind: 'decision' | 'pitfall'): ParsedMdSection[] {
  // Split on heading boundaries using lookahead to keep heading in each chunk
  const splitRegex = /(?=^## (?:ADR|PF)-\d+:)/m;
  const parts = content.split(splitRegex);

  const sections: ParsedMdSection[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Only parse sections that match the expected prefix for this file
    const headingMatch = trimmed.match(/^## ((?:ADR|PF)-\d+): (.+)/);
    if (!headingMatch) continue;
    const [, anchorId, title] = headingMatch;

    // Only process the kind we're looking for
    if (kind === 'decision' && !anchorId.startsWith('ADR-')) continue;
    if (kind === 'pitfall' && !anchorId.startsWith('PF-')) continue;

    // Extract date (decisions only: `- **Date**: YYYY-MM-DD`)
    const dateMatch = trimmed.match(/^- \*\*Date\*\*: (.+)$/m);
    const date = dateMatch ? dateMatch[1].trim() : undefined;

    // Extract decisions_status from `- **Status**: ...`
    const statusMatch = trimmed.match(/^- \*\*Status\*\*: (.+)$/m);
    const decisionsStatus = statusMatch ? statusMatch[1].trim() : 'Accepted';

    // Extract obs_id from `- **Source**: self-learning:{id}`
    const sourceMatch = trimmed.match(/^- \*\*Source\*\*: self-learning:(\S+)$/m);
    const obsId = sourceMatch ? sourceMatch[1].trim() : null;

    // Extract amendments from lines containing "Amendment" keyword
    // Pattern: `- **Amendment (YYYY-MM-DD, PR #NNN)**: note text` or similar
    const amendments: { date: string; note: string }[] = [];
    const amendmentRegex = /^- \*\*Amendment \(([^)]+)\)\*\*: (.+)$/mg;
    let amMatch: RegExpExecArray | null;
    while ((amMatch = amendmentRegex.exec(trimmed)) !== null) {
      amendments.push({ date: amMatch[1].trim(), note: amMatch[2].trim() });
    }

    // raw_body: the verbatim block including the heading, prefixed with \n.
    // The renderer joins blocks with join('') — no separator added.
    // The header preamble ends with \n. Each section body in the original
    // .md starts with \n## (one blank line separator). Any trailing blank
    // lines before the NEXT ## heading must NOT be included in raw_body
    // because the NEXT section provides its own leading \n.
    // So: strip ALL trailing whitespace from the section, then append \n.
    const rawBody = '\n' + part.trimEnd() + '\n';

    sections.push({
      anchorId,
      kind,
      title: title.trim(),
      date,
      decisionsStatus,
      obsId,
      rawBody,
      amendments,
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Anchor extraction from artifact_path
// ---------------------------------------------------------------------------

/**
 * Extract anchor ID from a log row's artifact_path field.
 * Format: `/absolute/path/to/decisions.md#ADR-002` or `...#PF-005`
 * Returns null if the field is absent or does not contain a `#ANCHOR` suffix.
 */
function extractAnchorFromArtifactPath(row: LogRow): string | null {
  if (!row.artifact_path) return null;
  const hashIdx = row.artifact_path.indexOf('#');
  if (hashIdx === -1) return null;
  const candidate = row.artifact_path.slice(hashIdx + 1);
  // Validate it looks like ADR-NNN or PF-NNN
  if (/^(?:ADR|PF)-\d+$/.test(candidate)) return candidate;
  return null;
}

// ---------------------------------------------------------------------------
// Renderer path resolution (PF-007)
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to render-decisions.cjs in the BUNDLED package.
 *
 * This file compiles to `dist/utils/decisions-ledger-migration.js`.
 * `__dirname` when running as ESM → derived via fileURLToPath + dirname.
 * But this file uses `import.meta.url` below — the helper is defined at module
 * scope so it can be called without extra args.
 *
 * Path: dist/utils/ → ../../scripts/hooks/lib/ → package root
 *
 * NOTE: The package root is the directory containing both `dist/` and `scripts/`.
 * From `dist/utils/`: path.resolve(dir, '../..') = package root.
 */
function resolveRendererPath(thisModuleUrl: string): string {
  // Convert import.meta.url to __dirname equivalent
  const thisFile = fileURLToPath(thisModuleUrl);
  const thisDir = path.dirname(thisFile);
  // dist/utils/ → up two levels → package root → scripts/hooks/lib/
  const packageRoot = path.resolve(thisDir, '../..');
  return path.join(packageRoot, 'scripts', 'hooks', 'lib', 'render-decisions.cjs');
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

/**
 * D302: Normalize a raw .md Status string to a typed DecisionsEntryStatus.
 *
 * Pitfall entries always map to 'Active' (they have no Status field in the
 * byte-compat format — but the parser defaults to 'Accepted' for missing Status
 * lines, so we override to 'Active' at the kind level here).
 *
 * Decision entries map via DECISIONS_ENTRY_STATUSES. Any status string that is
 * not in the canonical vocabulary pushes a warning and falls back to 'Accepted'
 * rather than silently downgrading the entry. This preserves 'Retired' and
 * 'Active' values from .md files that already carried those statuses — a plain
 * `else → 'Accepted'` branch would re-activate a Retired entry on migration.
 */
function normalizeDecisionsStatus(
  rawStatus: string,
  kind: 'decision' | 'pitfall',
  warnings: string[],
  anchorId: string,
): DecisionsEntryStatus {
  if (kind === 'pitfall') {
    return 'Active';
  }
  // Decision: check if rawStatus is a known member of the vocabulary
  const candidate = rawStatus as DecisionsEntryStatus;
  if ((DECISIONS_ENTRY_STATUSES as readonly string[]).includes(candidate)) {
    return candidate;
  }
  // Unrecognized status: warn and fall back to 'Accepted'
  warnings.push(
    `Unrecognized decisions_status '${rawStatus}' for ${anchorId} — defaulting to 'Accepted'`,
  );
  return 'Accepted';
}

// ---------------------------------------------------------------------------
// Migration inputs reader
// ---------------------------------------------------------------------------

/**
 * D303: readMigrationInputs reads all three source artifacts (decisions.md,
 * pitfalls.md, decisions-log.jsonl) and the existing ledger for idempotency.
 *
 * Returns raw strings / parsed arrays. All ENOENT cases are handled gracefully
 * (missing files produce empty strings / empty arrays). Non-ENOENT errors are
 * re-thrown.
 *
 * Malformed JSONL lines in the existing ledger push a warning rather than
 * silently dropping the corruption — surfaces ledger file corruption to the
 * caller rather than treating it as a recoverable clean state.
 */
async function readMigrationInputs(
  projectRoot: string,
  warnings: string[],
): Promise<{
  decisionsContent: string;
  pitfallsContent: string;
  logRows: LogRow[];
  existingLedgerRows: LedgerRow[];
}> {
  const decisionsFilePath = getDecisionsFilePath(projectRoot);
  const pitfallsFilePath = getPitfallsFilePath(projectRoot);
  const ledgerPath = getDecisionsLedgerPath(projectRoot);
  const logPath = getDecisionsLogPath(projectRoot);

  let decisionsContent = '';
  let pitfallsContent = '';
  const logRows: LogRow[] = [];
  const existingLedgerRows: LedgerRow[] = [];

  try {
    decisionsContent = await fs.readFile(decisionsFilePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // Missing decisions.md — we can still handle pitfalls and log
  }

  try {
    pitfallsContent = await fs.readFile(pitfallsFilePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  try {
    const logRaw = await fs.readFile(logPath, 'utf-8');
    for (const line of logRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        logRows.push(JSON.parse(trimmed) as LogRow);
      } catch {
        // Skip malformed log lines — log is informational; migration does not fail
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // No log file — proceed with empty log
  }

  try {
    const ledgerRaw = await fs.readFile(ledgerPath, 'utf-8');
    for (const line of ledgerRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        existingLedgerRows.push(JSON.parse(trimmed) as LedgerRow);
      } catch {
        // D304: surface malformed ledger lines as warnings so corruption is
        // visible to callers instead of silently shrinking the ledger on the
        // idempotency-heal path.
        warnings.push(`Skipped malformed line in decisions-ledger.jsonl: ${line.slice(0, 80)}`);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // No ledger yet — start fresh
  }

  return { decisionsContent, pitfallsContent, logRows, existingLedgerRows };
}

// ---------------------------------------------------------------------------
// Ledger row builder
// ---------------------------------------------------------------------------

/**
 * D305: synthesizeRow builds a single LedgerRow from a parsed .md section
 * and an optional enrichment source (log row).
 *
 * When logRow is provided: the log row fields are spread as the base so that
 * any extra observation-lifecycle fields (confidence, first_seen, etc.) are
 * preserved in the ledger. Required LedgerRow fields are then layered on top.
 *
 * When logRow is absent: a minimal synthetic row is constructed from the .md
 * section data alone. `details` defaults to the section title so the shared
 * LedgerRow `details: string` required field is always satisfied.
 *
 * The two synthesis branches are collapsed by computing `id` upfront —
 * obsId (from the Source marker) or syntheticId (obs_migrated_{anchor}).
 */
function synthesizeRow(
  section: ParsedMdSection,
  id: string,
  normalizedStatus: DecisionsEntryStatus,
  logRow: LogRow | undefined,
): LedgerRow {
  const { anchorId, kind, title, date, rawBody, amendments } = section;

  if (logRow) {
    // Enrich path: spread log row fields, then overlay required ledger fields
    const enriched: LedgerRow = {
      ...(logRow as Record<string, unknown>),
      id: logRow.id,
      type: logRow.type ?? kind,
      pattern: logRow.pattern ?? title,
      details: logRow.details ?? title,
      anchor_id: anchorId,
      decisions_status: normalizedStatus,
      raw_body: rawBody,
      amendments: amendments.length > 0 ? amendments : logRow.amendments,
      status: 'created',
    };
    if (kind === 'decision' && date) {
      enriched.date = date;
    }
    return enriched;
  }

  // Synthesized path: build from .md section only
  const synthesized: LedgerRow = {
    id,
    type: kind,
    pattern: title,
    details: title,
    anchor_id: anchorId,
    decisions_status: normalizedStatus,
    status: 'created',
    raw_body: rawBody,
    amendments: amendments.length > 0 ? amendments : undefined,
  };
  if (kind === 'decision' && date) {
    synthesized.date = date;
  }
  return synthesized;
}

/**
 * D306: buildLedgerRows builds the complete set of LedgerRows for the new ledger.
 *
 * Starts from existingLedgerRows (idempotency baseline), then processes each
 * .md section (anchored rows), then sweeps log rows for hand-deleted anchors
 * (Retired rows), then counts observing-only rows for the result summary.
 *
 * Returns the full new row list plus result counters.
 */
function buildLedgerRows(
  allMdSections: ParsedMdSection[],
  logRows: LogRow[],
  existingLedgerRows: LedgerRow[],
  existingLedgerAnchors: Set<string>,
  result: MigrateDecisionsLedgerResult,
): LedgerRow[] {
  const newLedgerRows: LedgerRow[] = [...existingLedgerRows];

  // Build lookup: anchor_id → ParsedMdSection
  const mdByAnchor = new Map<string, ParsedMdSection>();
  for (const section of allMdSections) {
    mdByAnchor.set(section.anchorId, section);
  }

  // Build lookup: obs_id → LogRow
  const logById = new Map<string, LogRow>();
  for (const row of logRows) {
    if (logById.has(row.id)) {
      result.warnings.push(`Duplicate log row id '${row.id}' — keeping first occurrence`);
      continue;
    }
    logById.set(row.id, row);
  }

  // Track seen obs/synthetic IDs within this run to detect duplicates
  const seenObsIds = new Set<string>();

  // 4a. Process .md sections → anchored rows
  for (const section of allMdSections) {
    // Idempotency: skip if already in ledger
    if (existingLedgerAnchors.has(section.anchorId)) continue;

    const { anchorId, kind, decisionsStatus, obsId } = section;

    const normalizedStatus = normalizeDecisionsStatus(
      decisionsStatus,
      kind,
      result.warnings,
      anchorId,
    );

    if (obsId) {
      // Duplicate Source guard
      if (seenObsIds.has(obsId)) {
        result.warnings.push(
          `Duplicate Source obs_id '${obsId}' (anchor ${anchorId}) — keeping first .md entry`,
        );
        continue;
      }
      seenObsIds.add(obsId);

      const logRow = logById.get(obsId);
      newLedgerRows.push(synthesizeRow(section, obsId, normalizedStatus, logRow));
      if (logRow) {
        result.anchored++;
      } else {
        result.synthesized++;
      }
    } else {
      // No Source marker — synthesize with deterministic ID
      const syntheticId = `obs_migrated_${anchorId.toLowerCase().replace('-', '_')}`;
      if (seenObsIds.has(syntheticId)) {
        result.warnings.push(
          `Would synthesize duplicate id '${syntheticId}' for anchor ${anchorId} — skipping`,
        );
        continue;
      }
      seenObsIds.add(syntheticId);
      result.warnings.push(
        `No Source marker for ${anchorId} — synthesized id '${syntheticId}'`,
      );
      newLedgerRows.push(synthesizeRow(section, syntheticId, normalizedStatus, undefined));
      result.synthesized++;
    }
  }

  // 4b. Hand-deletions: log rows with artifact_path#ANCHOR whose anchor is NOT in .md
  const allAnchorsInLedger = new Set<string>(
    newLedgerRows.map(r => r.anchor_id).filter(Boolean) as string[],
  );

  for (const row of logRows) {
    const anchor = extractAnchorFromArtifactPath(row);
    if (!anchor) continue; // not an anchored log row

    // Already accounted for in the ledger (from .md migration or pre-existing)
    if (allAnchorsInLedger.has(anchor)) continue;

    // Is this anchor absent from .md? → hand-deleted entry
    if (!mdByAnchor.has(anchor)) {
      const retired: LedgerRow = {
        ...(row as Record<string, unknown>),
        id: row.id,
        type: row.type ?? 'decision',
        pattern: row.pattern ?? anchor,
        details: row.details ?? anchor,
        anchor_id: anchor,
        decisions_status: 'Retired',
        status: 'created',
      };
      newLedgerRows.push(retired);
      allAnchorsInLedger.add(anchor); // prevent duplicates from multiple log rows with same anchor
      result.retired++;
    }
  }

  // 4c. Count observing-only rows (no anchor_id, status observing)
  for (const row of logRows) {
    if (row.status === 'observing' && !row.anchor_id && !extractAnchorFromArtifactPath(row)) {
      result.observingKept++;
    }
  }

  return newLedgerRows;
}

// ---------------------------------------------------------------------------
// Write and render
// ---------------------------------------------------------------------------

/**
 * D307: writeAndRender performs the atomic ledger write + deterministic render.
 *
 * When newRowsAdded > 0: writes the full ledger to disk first (crash-safe
 * ordering), then renders both .md files from the new rows. If the process
 * crashes between these two steps, the next migration run will detect
 * newRowsAdded === 0 (existing ledger is complete) and take the heal path.
 *
 * When newRowsAdded === 0 (heal path): skips the ledger write and only
 * re-renders the .md files from the existing rows — reconciling stale .md
 * state left by a prior crash.
 *
 * The caller MUST already hold .decisions.lock before calling this function.
 * renderAndWriteAll is the lock-free helper (avoids double-lock deadlock per
 * the KNOWLEDGE.md lock discipline section).
 */
async function writeAndRender(
  projectRoot: string,
  decisionsDir: string,
  ledgerPath: string,
  newLedgerRows: LedgerRow[],
  existingLedgerRows: LedgerRow[],
  newRowsAdded: number,
  renderer: { renderAndWriteAll: (worktreePath: string, rows: LedgerRow[]) => void },
): Promise<void> {
  if (newRowsAdded === 0) {
    // Heal path: re-render from the authoritative existing ledger rows only
    renderer.renderAndWriteAll(projectRoot, existingLedgerRows);
  } else {
    // Normal path: write new ledger first (crash-safe), then render
    await fs.mkdir(decisionsDir, { recursive: true });
    const ledgerContent = newLedgerRows.map(r => JSON.stringify(r)).join('\n') + '\n';
    await writeFileAtomicExclusive(ledgerPath, ledgerContent);
    renderer.renderAndWriteAll(projectRoot, newLedgerRows);
  }
}

// ---------------------------------------------------------------------------
// Main migration function
// ---------------------------------------------------------------------------

/**
 * Migrate existing decisions.md + pitfalls.md + decisions-log.jsonl to the
 * new two-file split layout:
 *   - decisions-ledger.jsonl (committed, anchored rows)
 *   - decisions-log.jsonl (unchanged, gitignored, observing rows)
 *
 * Idempotent: if the ledger already contains rows for all anchors in the .md,
 * a second run is a no-op.
 *
 * @param projectRoot  Absolute path to the project root.
 * @param opts.dryRun  If true, build the ledger rows and return the result
 *                     without writing anything to disk.
 * @param opts.rendererPath  Override for the render-decisions.cjs path
 *                           (used in tests to inject the real CJS module path).
 * @param opts.moduleUrl  The import.meta.url of the calling module, used to
 *                        resolve the renderer path. Defaults to this module's URL.
 */
export async function migrateDecisionsLedger(
  projectRoot: string,
  opts: {
    dryRun?: boolean;
    /** Override renderer path (for tests / special environments). */
    rendererPath?: string;
    /** import.meta.url of calling module; used to locate bundled scripts. */
    moduleUrl?: string;
    /**
     * Lock acquisition timeout in milliseconds. Defaults to 30 000 ms.
     * Exposed for tests that need fast timeout verification without waiting 30 s.
     */
    timeoutMs?: number;
  } = {},
): Promise<MigrateDecisionsLedgerResult> {
  const decisionsDir = getDecisionsDir(projectRoot);
  const lockDir = getDecisionsLockDir(projectRoot);
  const ledgerPath = getDecisionsLedgerPath(projectRoot);

  const result: MigrateDecisionsLedgerResult = {
    anchored: 0,
    synthesized: 0,
    retired: 0,
    observingKept: 0,
    warnings: [],
  };

  // -------------------------------------------------------------------------
  // Early exit: nothing to migrate if decisionsDir does not exist
  // -------------------------------------------------------------------------
  try {
    await fs.access(decisionsDir);
  } catch {
    return result; // no decisions directory — clean no-op
  }

  // -------------------------------------------------------------------------
  // Step 1-3: Read inputs (applies ADR-017 — lock acquired below before writes)
  // -------------------------------------------------------------------------
  const { decisionsContent, pitfallsContent, logRows, existingLedgerRows } =
    await readMigrationInputs(projectRoot, result.warnings);

  // -------------------------------------------------------------------------
  // Step 2: Parse .md sections from both files
  // -------------------------------------------------------------------------
  const decisionSections = parseMdSections(decisionsContent, 'decision');
  const pitfallSections = parseMdSections(pitfallsContent, 'pitfall');
  const allMdSections = [...decisionSections, ...pitfallSections];

  // Build set of anchors already in the ledger (for idempotency)
  const existingLedgerAnchors = new Set<string>();
  for (const row of existingLedgerRows) {
    if (row.anchor_id) existingLedgerAnchors.add(row.anchor_id);
  }

  // -------------------------------------------------------------------------
  // Step 4: Build the new ledger rows
  // -------------------------------------------------------------------------
  const newLedgerRows = buildLedgerRows(
    allMdSections,
    logRows,
    existingLedgerRows,
    existingLedgerAnchors,
    result,
  );

  // -------------------------------------------------------------------------
  // Step 5: Idempotency check
  // -------------------------------------------------------------------------
  const newRowsAdded = result.anchored + result.synthesized + result.retired;

  if (opts.dryRun) {
    return result; // dry-run: don't write anything
  }

  // Pure no-op: nothing new AND no existing ledger rows → nothing to write or
  // render. Return early without acquiring the lock or loading the renderer.
  // This path is safe because there is no crash window to heal: a crash between
  // a ledger write and renderAndWriteAll can only occur when the ledger has
  // rows — if the ledger is empty, the first run never got past the dry-run.
  if (newRowsAdded === 0 && existingLedgerRows.length === 0) {
    return result;
  }

  // -------------------------------------------------------------------------
  // Step 6: Acquire .decisions.lock and write/render atomically (ADR-017)
  //
  // We acquire the lock even when newRowsAdded === 0 (idempotency path with a
  // non-empty existing ledger) because we must re-render the .md files to heal
  // a crash that occurred between the atomic ledger write and the previous
  // renderAndWriteAll call. Re-rendering from an already-in-sync ledger is
  // idempotent (byte-identical output) and safe to do unconditionally.
  // -------------------------------------------------------------------------
  const lockAcquired = await acquireMkdirLock(lockDir, opts.timeoutMs ?? 30_000);
  if (!lockAcquired) {
    throw new Error('decisions-ledger-migration: timeout acquiring .decisions.lock');
  }

  try {
    // Resolve and load the renderer (used on both paths below)
    const rendererPath = opts.rendererPath ?? resolveRendererPath(import.meta.url);

    // Use createRequire to load the CJS module from the ESM context
    const req = createRequire(import.meta.url);
    const mod: unknown = req(rendererPath);

    // D308: validate renderer shape before use — a path mismatch (e.g. wrong
    // dist layout after a build change) would otherwise throw an unhelpful
    // TypeError at the call site rather than surfacing the root cause.
    if (typeof (mod as { renderAndWriteAll?: unknown })?.renderAndWriteAll !== 'function') {
      throw new Error(
        `decisions-ledger-migration: renderer at ${rendererPath} is missing the renderAndWriteAll export`,
      );
    }
    const renderer = mod as { renderAndWriteAll: (worktreePath: string, rows: LedgerRow[]) => void };

    await writeAndRender(
      projectRoot,
      decisionsDir,
      ledgerPath,
      newLedgerRows,
      existingLedgerRows,
      newRowsAdded,
      renderer,
    );

    // Success — lock released in finally
  } finally {
    try { await fs.rmdir(lockDir); } catch { /* already released */ }
  }

  return result;
}

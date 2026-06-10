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

// Shape of a row in decisions-log.jsonl
interface LedgerRow {
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
  const prefix = kind === 'decision' ? 'ADR' : 'PF';
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
function extractAnchorFromArtifactPath(row: LedgerRow): string | null {
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
  } = {},
): Promise<MigrateDecisionsLedgerResult> {
  const decisionsDir = getDecisionsDir(projectRoot);
  const lockDir = getDecisionsLockDir(projectRoot);
  const decisionsFilePath = getDecisionsFilePath(projectRoot);
  const pitfallsFilePath = getPitfallsFilePath(projectRoot);
  const ledgerPath = getDecisionsLedgerPath(projectRoot);
  const logPath = getDecisionsLogPath(projectRoot);

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
  // Step 1: Read existing .md files (side A) and decisions-log.jsonl (side B)
  // -------------------------------------------------------------------------
  let decisionsContent = '';
  let pitfallsContent = '';
  let logRows: LedgerRow[] = [];

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
        logRows.push(JSON.parse(trimmed) as LedgerRow);
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // No log file — proceed with empty log
  }

  // -------------------------------------------------------------------------
  // Step 2: Parse .md sections from both files
  // -------------------------------------------------------------------------
  const decisionSections = parseMdSections(decisionsContent, 'decision');
  const pitfallSections = parseMdSections(pitfallsContent, 'pitfall');
  const allMdSections = [...decisionSections, ...pitfallSections];

  // Build lookup: anchor_id → ParsedMdSection
  const mdByAnchor = new Map<string, ParsedMdSection>();
  for (const section of allMdSections) {
    mdByAnchor.set(section.anchorId, section);
  }

  // Build lookup: obs_id → LedgerRow (from log)
  const logById = new Map<string, LedgerRow>();
  const seenObsIds = new Set<string>();
  for (const row of logRows) {
    if (logById.has(row.id)) {
      // Duplicate id in log — keep first
      result.warnings.push(`Duplicate log row id '${row.id}' — keeping first occurrence`);
      continue;
    }
    logById.set(row.id, row);
  }

  // -------------------------------------------------------------------------
  // Step 3: Read existing ledger (for idempotency check)
  // -------------------------------------------------------------------------
  let existingLedgerRows: LedgerRow[] = [];
  try {
    const ledgerRaw = await fs.readFile(ledgerPath, 'utf-8');
    for (const line of ledgerRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        existingLedgerRows.push(JSON.parse(trimmed) as LedgerRow);
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // No ledger yet — start fresh
  }

  // Build set of anchors already in the ledger (for idempotency)
  const existingLedgerAnchors = new Set<string>();
  for (const row of existingLedgerRows) {
    if (row.anchor_id) existingLedgerAnchors.add(row.anchor_id);
  }

  // -------------------------------------------------------------------------
  // Step 4: Build the new ledger rows
  // -------------------------------------------------------------------------
  // Start with existing rows (to preserve already-migrated entries)
  const newLedgerRows: LedgerRow[] = [...existingLedgerRows];

  // 4a. Process .md sections → anchored rows
  for (const section of allMdSections) {
    // Idempotency: skip if already in ledger
    if (existingLedgerAnchors.has(section.anchorId)) continue;

    const { anchorId, kind, title, date, decisionsStatus, obsId, rawBody, amendments } = section;

    // Determine decisions_status: map .md Status to our enum
    let normalizedStatus: string = 'Accepted';
    const sl = decisionsStatus.toLowerCase();
    if (kind === 'pitfall') {
      normalizedStatus = 'Active';
    } else if (sl === 'deprecated') {
      normalizedStatus = 'Deprecated';
    } else if (sl === 'superseded') {
      normalizedStatus = 'Superseded';
    } else {
      normalizedStatus = 'Accepted';
    }

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

      if (logRow) {
        // Enrich the log row into the ledger
        const enriched: LedgerRow = {
          ...logRow,
          anchor_id: anchorId,
          decisions_status: normalizedStatus,
          raw_body: rawBody,
          amendments: amendments.length > 0 ? amendments : logRow.amendments,
          status: 'created', // ensure lifecycle status reflects that this has been rendered
        };
        if (kind === 'decision' && date) {
          enriched.date = date;
        }
        newLedgerRows.push(enriched);
        result.anchored++;
      } else {
        // obs_id not in log (e.g. obs_c9d3m1 for ADR-001) → synthesize
        const synthesized: LedgerRow = {
          id: obsId,
          type: kind,
          pattern: title,
          status: 'created',
          anchor_id: anchorId,
          decisions_status: normalizedStatus,
          raw_body: rawBody,
          amendments: amendments.length > 0 ? amendments : undefined,
        };
        if (kind === 'decision' && date) {
          synthesized.date = date;
        }
        // Minimal details from the raw body if possible
        synthesized.details = title;
        newLedgerRows.push(synthesized);
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
      const synthesized: LedgerRow = {
        id: syntheticId,
        type: kind,
        pattern: title,
        status: 'created',
        anchor_id: anchorId,
        decisions_status: normalizedStatus,
        raw_body: rawBody,
        amendments: amendments.length > 0 ? amendments : undefined,
      };
      if (kind === 'decision' && date) {
        synthesized.date = date;
      }
      synthesized.details = title;
      newLedgerRows.push(synthesized);
      result.synthesized++;
    }
  }

  // 4b. Hand-deletions: log rows with artifact_path#ANCHOR whose anchor is NOT in .md
  // Build the set of all anchors in the new ledger so far (existing + just added)
  const allAnchorsInLedger = new Set<string>(newLedgerRows.map(r => r.anchor_id).filter(Boolean) as string[]);

  for (const row of logRows) {
    const anchor = extractAnchorFromArtifactPath(row);
    if (!anchor) continue; // not an anchored log row

    // Already accounted for in the ledger (from .md migration or pre-existing)
    if (allAnchorsInLedger.has(anchor)) continue;

    // Is this anchor absent from .md? → hand-deleted entry
    if (!mdByAnchor.has(anchor)) {
      // Hand-deleted: reserve the number as Retired
      const retired: LedgerRow = {
        ...row,
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
  const lockAcquired = await acquireMkdirLock(lockDir);
  if (!lockAcquired) {
    throw new Error('decisions-ledger-migration: timeout acquiring .decisions.lock');
  }

  try {
    // Resolve and load the renderer (used on both paths below)
    const rendererPath = opts.rendererPath ?? resolveRendererPath(import.meta.url);

    // Use createRequire to load the CJS module from the ESM context
    const req = createRequire(import.meta.url);
    const renderer = req(rendererPath) as {
      renderAndWriteAll: (worktreePath: string, rows: LedgerRow[]) => void;
    };

    if (newRowsAdded === 0) {
      // 6 (idempotency path): ledger already has all anchors. Only re-render
      // the .md files to heal stale state left by a prior crash between the
      // atomic ledger write and renderAndWriteAll. The existing ledger rows are
      // the authoritative source. We do NOT re-write the ledger file.
      renderer.renderAndWriteAll(projectRoot, existingLedgerRows);
    } else {
      // 6a. Write the new ledger atomically (crash-safe: do this FIRST)
      await fs.mkdir(decisionsDir, { recursive: true });
      const ledgerContent = newLedgerRows.map(r => JSON.stringify(r)).join('\n') + '\n';
      await writeFileAtomicExclusive(ledgerPath, ledgerContent);

      // 6b. Render both .md from the ledger using the BUNDLED renderer (PF-007)
      // We already hold .decisions.lock so call renderAndWriteAll (lock-free helper)
      renderer.renderAndWriteAll(projectRoot, newLedgerRows);
    }

    // Success — lock released in finally
  } finally {
    try { await fs.rmdir(lockDir); } catch { /* already released */ }
  }

  return result;
}

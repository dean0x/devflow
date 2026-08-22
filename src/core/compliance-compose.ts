/**
 * Pure composition module for the compliance skill and rule.
 *
 * Composes the installed SKILL.md and rule file from a template + per-framework
 * fragment files, so installed artifacts differ by selection rather than being
 * static all-six blobs.
 *
 * Applies ADR-013: pure helpers in src/core/, no I/O.
 * Applies PF-009: warn-not-throw for per-item failures.
 */

import { COMPLIANCE_FRAMEWORKS, stampComplianceRule } from './compliance.js';

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * The 6 framework mapping control columns — single source of truth for the
 * transposed Framework Mapping table header and fragment cell-count validation.
 */
export const COMPLIANCE_CONTROL_COLUMNS: readonly string[] = [
  'Data Classification',
  'Sensitive Data in Logs',
  'Encryption',
  'Audit Trails',
  'Retention & Erasure',
  'IaC / Env Controls',
] as const;

/**
 * The 5 substitution tokens in the SKILL.md template.
 * Bidirectional parity: every token here must exist in the template; every
 * template token must be listed here. Enforced against the SHIPPED SKILL.md by
 * "shipped templates ↔ token registry" in tests/compliance-compose.test.ts —
 * a typo'd token is otherwise stripped silently by C3 and never noticed.
 */
export const COMPLIANCE_SKILL_TOKENS: readonly string[] = [
  '${DEVFLOW_COMPLIANCE_SCOPE}',
  '${DEVFLOW_COMPLIANCE_ACTIVE}',
  '${DEVFLOW_COMPLIANCE_MAPPING}',
  '${DEVFLOW_COMPLIANCE_CHECKLIST}',
  '${DEVFLOW_COMPLIANCE_REFERENCES}',
] as const;

/**
 * The 1 rule substitution token beyond the existing COMPLIANCE_RULE_PLACEHOLDER.
 * Bidirectional parity: every token here must exist in the rule template; every
 * template token (beyond the existing placeholder) must be listed here. Enforced
 * against the SHIPPED rule in tests/compliance-compose.test.ts.
 */
export const COMPLIANCE_RULE_TOKENS: readonly string[] = [
  '${DEVFLOW_COMPLIANCE_RULE_BULLETS}',
] as const;

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Parsed compliance fragment for one framework.
 *
 * All fields are pre-validated by parseComplianceFragment:
 *   - mappingCells: exactly COMPLIANCE_CONTROL_COLUMNS.length cells
 *   - checklistItems: 0–2 items
 *   - ruleBullet: exactly 1 item, ≤ 200 chars
 */
export interface ComplianceFragment {
  /** Registry-validated framework ID. */
  id: string;
  /** One cell per COMPLIANCE_CONTROL_COLUMN (6 cells total). */
  mappingCells: string[];
  /** Single-line reference description for the Extended References table. */
  referenceBlurb: string;
  /** Zero to two checklist items (markdown `- [ ] ...` format). */
  checklistItems: string[];
  /** Single rule bullet (markdown `- ...` format, ≤ 200 chars). */
  ruleBullet: string;
}

/** Result of a composition operation. */
export interface ComposeResult {
  content: string;
  warnings: string[];
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Matches any `${DEVFLOW_COMPLIANCE_*}` token left after the known substitutions.
 *
 * Deliberately as permissive as the C1 admission guard (`includes('${DEVFLOW_COMPLIANCE_')`):
 * anything that gets a template past C1 must be strippable here, or C3 ("no token
 * residue") would be false for that shape.
 */
const UNKNOWN_TOKEN_PATTERN = /\$\{DEVFLOW_COMPLIANCE_[A-Z0-9_]*\}/g;

/** Label lookup from the COMPLIANCE_FRAMEWORKS registry. */
const LABEL_BY_ID: ReadonlyMap<string, string> = new Map(
  COMPLIANCE_FRAMEWORKS.map(fw => [fw.id, fw.label]),
);

/** A framework ID paired with its registry label. Only the registry can produce one. */
interface RegistryFramework {
  id: string;
  label: string;
}

/**
 * Resolve IDs to {id, label} pairs, DROPPING anything absent from the registry.
 *
 * Fail-safe restatement of the C2 filter that the compose entry points already apply:
 * every section builder resolves through here independently, so an ID that is not in
 * LABEL_BY_ID contributes nothing at all — no label, no `references/{id}.md` path, no
 * table row. If the C2 filter above is ever moved, weakened, or dropped, the failure
 * mode is a missing row rather than an unvalidated ID echoed into an installed
 * artifact that Claude Code loads into every prompt (AC-35, AC-36).
 *
 * Never `?? id`: falling back to the raw ID is exactly the echo C2 exists to prevent.
 */
function resolveRegistryFrameworks(ids: readonly string[]): RegistryFramework[] {
  const resolved: RegistryFramework[] = [];
  for (const id of ids) {
    const label = LABEL_BY_ID.get(id);
    if (label === undefined) continue;
    resolved.push({ id, label });
  }
  return resolved;
}

/**
 * Extract `## Heading` sections from markdown content.
 * Returns a map of heading → section body (text after the heading, before the next
 * `##` heading). Whitespace on both sides of each body is NOT trimmed here.
 */
function extractSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split('\n');
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = /^##\s+(.+)$/.exec(line);
    if (match) {
      if (currentHeading !== null) {
        sections.set(currentHeading, currentLines.join('\n'));
      }
      currentHeading = match[1].trim();
      currentLines = [];
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
  }

  if (currentHeading !== null) {
    sections.set(currentHeading, currentLines.join('\n'));
  }

  return sections;
}

/**
 * Parse a markdown table row `| cell1 | cell2 | ... |` into an array of cell strings.
 * Trims each cell. Returns [] for lines that don't look like table rows.
 */
function parseTableRow(row: string): string[] {
  if (!row.includes('|')) return [];
  const parts = row.split('|');
  // Slice off the leading and trailing empty parts from the outer pipes
  return parts.slice(1, parts.length - 1).map(c => c.trim());
}

/**
 * Collapse 3+ consecutive blank lines to exactly 2 consecutive blank lines.
 * Applies C4: blank-line hygiene when a token is substituted.
 */
function applyBlankLineHygiene(content: string): string {
  return content.replace(/\n{3,}/g, '\n\n');
}

/**
 * Replace all occurrences of a literal token string in content with a replacement.
 * Avoids regex for robustness with special characters in token names.
 */
function replaceToken(content: string, token: string, replacement: string): string {
  return content.split(token).join(replacement);
}

// ── Composition helpers ────────────────────────────────────────────────────────

/**
 * Build the ${DEVFLOW_COMPLIANCE_SCOPE} substitution.
 * Active frameworks: "under GDPR, SOC 2"
 * Zero frameworks:   "under active compliance frameworks"
 *
 * Frameworks the registry cannot label degrade to the zero-framework wording rather
 * than being named (see resolveRegistryFrameworks).
 */
function buildScope(activeFrameworks: readonly string[]): string {
  const resolved = resolveRegistryFrameworks(activeFrameworks);
  if (resolved.length === 0) {
    return 'under active compliance frameworks';
  }
  return `under ${resolved.map(fw => fw.label).join(', ')}`;
}

/**
 * Collect C5 warnings for active frameworks that have no fragment.
 *
 * Emitted once, up front, by the compose entry points — never as a side effect of a
 * section builder. Each builder skips fragment-less frameworks independently, so the
 * warning must not depend on which builders run or in what order.
 */
function collectMissingFragmentWarnings(
  fnName: string,
  activeFrameworks: readonly string[],
  fragments: ReadonlyMap<string, ComplianceFragment>,
  omitted: string,
): string[] {
  const warnings: string[] = [];
  for (const id of activeFrameworks) {
    if (!fragments.has(id)) {
      warnings.push(`${fnName}: no fragment for "${id}" — ${omitted}`);
    }
  }
  return warnings;
}

/**
 * Build the ${DEVFLOW_COMPLIANCE_ACTIVE} substitution — the body of the
 * Active Frameworks section.
 *
 * Active: lists frameworks + instructs loading reference files.
 * Zero: informs that generic controls only apply.
 *
 * File presence corroborates: note preserved so the agent keeps checking files.
 *
 * C5: a framework with no fragment still appears here — only its mapping row,
 * checklist item and reference row are omitted.
 *
 * Frameworks the registry cannot label are dropped entirely: neither the label nor the
 * `references/{id}.md` path is emitted (see resolveRegistryFrameworks).
 */
function buildActiveSection(
  activeFrameworks: readonly string[],
): string {
  const resolved = resolveRegistryFrameworks(activeFrameworks);
  if (resolved.length === 0) {
    return [
      'No framework-specific reference files are active. Apply generic controls only.',
      '',
      'NEVER fabricate framework-specific guidance for absent `references/{id}.md` files.',
      'If no reference file is present for a framework, apply generic controls only.',
    ].join('\n');
  }

  const labels = resolved.map(fw => fw.label);
  const refList = resolved.map(fw => `\`references/${fw.id}.md\``).join(' and ');

  return [
    `**Active: ${labels.join(', ')}.**`,
    '',
    `Load ${refList} for framework-specific controls. Apply generic controls always.`,
    '',
    'File presence in the installed skill directory is the authoritative signal: if a',
    '`references/{id}.md` file is absent, treat that framework as inactive regardless of',
    'this list.',
    '',
    'NEVER fabricate framework-specific guidance for absent `references/{id}.md` files.',
  ].join('\n');
}

/**
 * Build the ${DEVFLOW_COMPLIANCE_MAPPING} substitution — the ENTIRE Framework
 * Mapping section (heading + table), or empty string when zero frameworks.
 *
 * The section is omitted entirely at zero frameworks (plan: "section omitted
 * entirely at zero frameworks"). C4 blank-line hygiene handles the gap.
 *
 * Row labels come only from the registry — an unlabelable framework yields no row
 * rather than a row headed by its raw ID (see resolveRegistryFrameworks).
 */
function buildMappingSection(
  activeFrameworks: readonly string[],
  fragments: ReadonlyMap<string, ComplianceFragment>,
): string {
  const header = ['Framework', ...COMPLIANCE_CONTROL_COLUMNS];
  const separator = header.map(() => '---');

  const rows: string[] = [];
  for (const { id, label } of resolveRegistryFrameworks(activeFrameworks)) {
    const fragment = fragments.get(id);
    if (!fragment) {
      // C5: framework appears in scope/active but contributes no row.
      continue;
    }
    const cells = [label, ...fragment.mappingCells];
    rows.push(`| ${cells.join(' | ')} |`);
  }

  // No rows — zero frameworks, or every one of them unlabelable or fragment-less.
  // Omit the section entirely; C4 blank-line hygiene closes the gap.
  if (rows.length === 0) {
    return '';
  }

  const tableLines = [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...rows,
  ];

  return ['## Framework Mapping', '', ...tableLines].join('\n');
}

/**
 * Build the ${DEVFLOW_COMPLIANCE_CHECKLIST} substitution — per-framework
 * checklist items concatenated in caller order.
 */
function buildChecklist(
  activeFrameworks: readonly string[],
  fragments: ReadonlyMap<string, ComplianceFragment>,
): string {
  const items: string[] = [];
  for (const { id } of resolveRegistryFrameworks(activeFrameworks)) {
    const fragment = fragments.get(id);
    // C5: fragment-less frameworks contribute no checklist item.
    if (!fragment) continue;
    items.push(...fragment.checklistItems);
  }
  return items.join('\n');
}

/**
 * Build the ${DEVFLOW_COMPLIANCE_REFERENCES} substitution — per-framework
 * reference table rows concatenated in caller order.
 */
function buildReferences(
  activeFrameworks: readonly string[],
  fragments: ReadonlyMap<string, ComplianceFragment>,
): string {
  const rows: string[] = [];
  for (const { id } of resolveRegistryFrameworks(activeFrameworks)) {
    const fragment = fragments.get(id);
    // C5: fragment-less frameworks contribute no reference row.
    if (!fragment) continue;
    rows.push(`| \`references/${id}.md\` | ${fragment.referenceBlurb} |`);
  }
  return rows.join('\n');
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse a fragment.md file into a ComplianceFragment.
 *
 * Strict boundary parser: validates all required sections (## Mapping / ##
 * Reference / ## Checklist / ## Rule) and their structural constraints.
 * CRLF-tolerant: Windows line endings are normalised before parsing.
 * Never throws (PF-009): all errors return { ok: false, error }.
 */
export function parseComplianceFragment(
  id: string,
  raw: string,
): ParseResult<ComplianceFragment> {
  // CRLF tolerance
  const content = raw.replace(/\r\n/g, '\n');

  const sections = extractSections(content);

  const REQUIRED = ['Mapping', 'Reference', 'Checklist', 'Rule'] as const;
  for (const sec of REQUIRED) {
    if (!sections.has(sec)) {
      return { ok: false, error: `fragment "${id}": missing required section "## ${sec}"` };
    }
  }

  // ── Parse Mapping ───────────────────────────────────────────────────────────
  const mappingBody = (sections.get('Mapping') ?? '').trim();
  const mappingLines = mappingBody.split('\n').map(l => l.trim()).filter(Boolean);
  const tableRows = mappingLines.filter(l => l.startsWith('|'));

  if (tableRows.length !== 1) {
    return {
      ok: false,
      error: `fragment "${id}": Mapping section must have exactly 1 table row, got ${tableRows.length}`,
    };
  }

  const mappingCells = parseTableRow(tableRows[0]);
  if (mappingCells.length !== COMPLIANCE_CONTROL_COLUMNS.length) {
    return {
      ok: false,
      error: `fragment "${id}": Mapping row must have ${COMPLIANCE_CONTROL_COLUMNS.length} cells (one per control column), got ${mappingCells.length}`,
    };
  }

  // ── Parse Reference ─────────────────────────────────────────────────────────
  const referenceBlurb = (sections.get('Reference') ?? '').trim();
  if (!referenceBlurb) {
    return { ok: false, error: `fragment "${id}": Reference section is empty` };
  }

  // ── Parse Checklist ─────────────────────────────────────────────────────────
  const checklistBody = (sections.get('Checklist') ?? '').trim();
  const checklistItems: string[] = checklistBody
    ? checklistBody
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('- '))
    : [];

  if (checklistItems.length > 2) {
    return {
      ok: false,
      error: `fragment "${id}": Checklist section must have 0–2 items, got ${checklistItems.length}`,
    };
  }

  // ── Parse Rule ──────────────────────────────────────────────────────────────
  const ruleBody = (sections.get('Rule') ?? '').trim();
  const ruleBullets: string[] = ruleBody
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '));

  if (ruleBullets.length !== 1) {
    return {
      ok: false,
      error: `fragment "${id}": Rule section must have exactly 1 bullet, got ${ruleBullets.length}`,
    };
  }

  const ruleBullet = ruleBullets[0];
  if (ruleBullet.length > 200) {
    return {
      ok: false,
      error: `fragment "${id}": Rule bullet exceeds 200 characters (${ruleBullet.length} chars)`,
    };
  }

  return {
    ok: true,
    value: { id, mappingCells, referenceBlurb, checklistItems, ruleBullet },
  };
}

/**
 * Compose the compliance skill content from a template and per-framework fragments.
 *
 * Contracts:
 *   C1 — no ${DEVFLOW_COMPLIANCE_ token → byte-identical passthrough
 *   C2 — all framework labels from LABEL_BY_ID; unknown IDs dropped + warned
 *   C3 — unknown tokens stripped with warning
 *   C4 — blank-line hygiene when a token is substituted
 *   C5 — missing fragment → framework appears in scope/active/stamp; no row/item/bullet
 *   C6 — frameworks rendered in caller (manifest) order
 *   C7 — loops bounded by frameworks
 */
export function composeComplianceSkill(
  template: string,
  frameworks: readonly string[],
  fragments: ReadonlyMap<string, ComplianceFragment>,
): ComposeResult {
  // C1: identity passthrough — no I/O overhead for token-less content (e.g. shadows)
  if (!template.includes('${DEVFLOW_COMPLIANCE_')) {
    return { content: template, warnings: [] };
  }

  const warnings: string[] = [];

  // C2: filter to registry IDs only — unknown IDs never emitted
  const activeFrameworks = frameworks.filter(id => {
    if (!LABEL_BY_ID.has(id)) {
      warnings.push(`composeComplianceSkill: unknown framework ID "${id}" dropped`);
      return false;
    }
    return true;
  });

  // C5: warn once per fragment-less framework, before any section is built — the
  // builders below each skip such frameworks independently and emit nothing.
  warnings.push(...collectMissingFragmentWarnings(
    'composeComplianceSkill',
    activeFrameworks,
    fragments,
    'mapping row, checklist item and reference row omitted',
  ));

  // Build substitution values (C6: activeFrameworks is in caller order after filter)
  const scope = buildScope(activeFrameworks);
  const active = buildActiveSection(activeFrameworks);
  const mapping = buildMappingSection(activeFrameworks, fragments);
  const checklist = buildChecklist(activeFrameworks, fragments);
  const references = buildReferences(activeFrameworks, fragments);

  let content = template;
  content = replaceToken(content, '${DEVFLOW_COMPLIANCE_SCOPE}', scope);
  content = replaceToken(content, '${DEVFLOW_COMPLIANCE_ACTIVE}', active);
  content = replaceToken(content, '${DEVFLOW_COMPLIANCE_MAPPING}', mapping);
  content = replaceToken(content, '${DEVFLOW_COMPLIANCE_CHECKLIST}', checklist);
  content = replaceToken(content, '${DEVFLOW_COMPLIANCE_REFERENCES}', references);

  // C3: strip remaining unknown tokens with warning. The character class must cover
  // every shape the C1 guard admits (it keys on the `${DEVFLOW_COMPLIANCE_` prefix
  // alone) — digits included — or a token like ${DEVFLOW_COMPLIANCE_SOC2} in a user
  // shadow would survive into the installed skill as literal residue.
  content = content.replace(UNKNOWN_TOKEN_PATTERN, match => {
    // Known tokens have already been replaced above
    warnings.push(`composeComplianceSkill: unknown token "${match}" stripped`);
    return '';
  });

  // C4: blank-line hygiene — collapse 3+ blank lines to 2
  content = applyBlankLineHygiene(content);

  return { content, warnings };
}

/**
 * Compose the compliance rule content from a template and per-framework fragments.
 *
 * Handles ${DEVFLOW_COMPLIANCE_RULE_BULLETS} (per-framework bullets) and
 * delegates ${DEVFLOW_COMPLIANCE_FRAMEWORKS} to the untouched stampComplianceRule.
 *
 * Contracts: same C1–C7 as composeComplianceSkill.
 */
export function composeComplianceRule(
  template: string,
  frameworks: readonly string[],
  fragments: ReadonlyMap<string, ComplianceFragment>,
): ComposeResult {
  // C1: identity passthrough
  if (!template.includes('${DEVFLOW_COMPLIANCE_')) {
    return { content: template, warnings: [] };
  }

  const warnings: string[] = [];

  // C2: filter to registry IDs only
  const activeFrameworks = frameworks.filter(id => {
    if (!LABEL_BY_ID.has(id)) {
      warnings.push(`composeComplianceRule: unknown framework ID "${id}" dropped`);
      return false;
    }
    return true;
  });

  // C5: warn once per fragment-less framework — the framework still reaches the
  // ${DEVFLOW_COMPLIANCE_FRAMEWORKS} stamp below, only its bullet is omitted.
  warnings.push(...collectMissingFragmentWarnings(
    'composeComplianceRule',
    activeFrameworks,
    fragments,
    'rule bullet omitted',
  ));

  // Build per-framework rule bullets (C6: caller order; C7: bounded by frameworks).
  // Resolved through the registry so an unlabelable ID contributes no bullet.
  const bullets: string[] = [];
  for (const { id } of resolveRegistryFrameworks(activeFrameworks)) {
    const fragment = fragments.get(id);
    if (!fragment) continue;
    bullets.push(fragment.ruleBullet);
  }

  let content = replaceToken(template, '${DEVFLOW_COMPLIANCE_RULE_BULLETS}', bullets.join('\n'));

  // C3: strip remaining unknown tokens EXCEPT ${DEVFLOW_COMPLIANCE_FRAMEWORKS}
  // (preserved for stampComplianceRule below)
  content = content.replace(UNKNOWN_TOKEN_PATTERN, match => {
    if (match === '${DEVFLOW_COMPLIANCE_FRAMEWORKS}') return match; // handled next
    warnings.push(`composeComplianceRule: unknown token "${match}" stripped`);
    return '';
  });

  // C4: blank-line hygiene before stamping (stampComplianceRule does not touch whitespace)
  content = applyBlankLineHygiene(content);

  // Delegate ${DEVFLOW_COMPLIANCE_FRAMEWORKS} stamp to the untouched function
  // (passes `frameworks` — not just activeFrameworks — to preserve stampComplianceRule's
  // own registry-ID filter behaviour, which drops unknowns silently)
  content = stampComplianceRule(content, frameworks);

  return { content, warnings };
}

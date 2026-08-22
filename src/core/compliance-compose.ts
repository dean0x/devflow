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
 * template token must be listed here. Tests enforce both directions.
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
 * template token (beyond the existing placeholder) must be listed here.
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

/** Label lookup from the COMPLIANCE_FRAMEWORKS registry. */
const LABEL_BY_ID: ReadonlyMap<string, string> = new Map(
  COMPLIANCE_FRAMEWORKS.map(fw => [fw.id, fw.label]),
);

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

/**
 * Strip unknown ${DEVFLOW_COMPLIANCE_...} tokens from content and collect warnings.
 * The FRAMEWORKS token is excluded from stripping (handled by stampComplianceRule).
 */
function stripUnknownTokens(
  content: string,
  warnings: string[],
  prefix: string,
  preserveFrameworksToken = false,
): string {
  const TOKEN_RE = /\$\{DEVFLOW_COMPLIANCE_[A-Z_]+\}/g;
  const known = new Set<string>([
    ...COMPLIANCE_SKILL_TOKENS,
    ...COMPLIANCE_RULE_TOKENS,
    '${DEVFLOW_COMPLIANCE_FRAMEWORKS}',
  ]);

  const stripped = content.replace(TOKEN_RE, match => {
    if (known.has(match)) return match; // not unknown
    if (preserveFrameworksToken && match === '${DEVFLOW_COMPLIANCE_FRAMEWORKS}') return match;
    warnings.push(`${prefix}: unknown token "${match}" stripped`);
    return '';
  });

  return stripped;
}

// ── Composition helpers ────────────────────────────────────────────────────────

/**
 * Build the ${DEVFLOW_COMPLIANCE_SCOPE} substitution.
 * Active frameworks: "under GDPR, SOC 2"
 * Zero frameworks:   "under active compliance frameworks"
 */
function buildScope(activeFrameworks: readonly string[]): string {
  if (activeFrameworks.length === 0) {
    return 'under active compliance frameworks';
  }
  const labels = activeFrameworks.map(id => LABEL_BY_ID.get(id) ?? id);
  return `under ${labels.join(', ')}`;
}

/**
 * Build the ${DEVFLOW_COMPLIANCE_ACTIVE} substitution — the body of the
 * Active Frameworks section.
 *
 * Active: lists frameworks + instructs loading reference files.
 * Zero: informs that generic controls only apply.
 *
 * File presence corroborates: note preserved so the agent keeps checking files.
 */
function buildActiveSection(
  activeFrameworks: readonly string[],
  fragments: ReadonlyMap<string, ComplianceFragment>,
  warnings: string[],
): string {
  if (activeFrameworks.length === 0) {
    return [
      'No framework-specific reference files are active. Apply generic controls only.',
      '',
      'NEVER fabricate framework-specific guidance for absent `references/{id}.md` files.',
      'If no reference file is present for a framework, apply generic controls only.',
    ].join('\n');
  }

  const labels = activeFrameworks.map(id => LABEL_BY_ID.get(id) ?? id);
  const labelList = labels.map(l => `**${l}**`).join(', ');

  const refList = activeFrameworks.map(id => `\`references/${id}.md\``).join(' and ');

  // Warn for frameworks without a fragment (C5 — but the framework still appears here)
  for (const id of activeFrameworks) {
    if (!fragments.has(id)) {
      warnings.push(`composeComplianceSkill: no fragment for "${id}" — mapping row and reference row omitted`);
    }
  }

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
 */
function buildMappingSection(
  activeFrameworks: readonly string[],
  fragments: ReadonlyMap<string, ComplianceFragment>,
  warnings: string[],
): string {
  if (activeFrameworks.length === 0) {
    return '';
  }

  const header = ['Framework', ...COMPLIANCE_CONTROL_COLUMNS];
  const separator = header.map(() => '---');

  const rows: string[] = [];
  for (const id of activeFrameworks) {
    const label = LABEL_BY_ID.get(id) ?? id;
    const fragment = fragments.get(id);
    if (!fragment) {
      // C5: framework appears but contributes no row (warning already emitted in buildActiveSection)
      continue;
    }
    const cells = [label, ...fragment.mappingCells];
    rows.push(`| ${cells.join(' | ')} |`);
  }

  // If ALL fragments were missing, omit the section entirely
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
  warnings: string[],
): string {
  const items: string[] = [];
  for (const id of activeFrameworks) {
    const fragment = fragments.get(id);
    if (!fragment) {
      // Warning already emitted; skip silently here
      continue;
    }
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
  warnings: string[],
): string {
  const rows: string[] = [];
  for (const id of activeFrameworks) {
    const fragment = fragments.get(id);
    if (!fragment) {
      continue;
    }
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

  // Build substitution values (C6: activeFrameworks is in caller order after filter)
  const scope = buildScope(activeFrameworks);
  const active = buildActiveSection(activeFrameworks, fragments, warnings);
  const mapping = buildMappingSection(activeFrameworks, fragments, warnings);
  const checklist = buildChecklist(activeFrameworks, fragments, warnings);
  const references = buildReferences(activeFrameworks, fragments, warnings);

  let content = template;
  content = replaceToken(content, '${DEVFLOW_COMPLIANCE_SCOPE}', scope);
  content = replaceToken(content, '${DEVFLOW_COMPLIANCE_ACTIVE}', active);
  content = replaceToken(content, '${DEVFLOW_COMPLIANCE_MAPPING}', mapping);
  content = replaceToken(content, '${DEVFLOW_COMPLIANCE_CHECKLIST}', checklist);
  content = replaceToken(content, '${DEVFLOW_COMPLIANCE_REFERENCES}', references);

  // C3: strip remaining unknown tokens with warning
  content = content.replace(/\$\{DEVFLOW_COMPLIANCE_[A-Z_]+\}/g, match => {
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

  // Build per-framework rule bullets (C6: caller order; C7: bounded by frameworks)
  const bullets: string[] = [];
  for (const id of activeFrameworks) {
    const fragment = fragments.get(id);
    if (!fragment) {
      warnings.push(`composeComplianceRule: no fragment for "${id}" — rule bullet omitted (C5)`);
      continue;
    }
    bullets.push(fragment.ruleBullet);
  }

  // Replace RULE_BULLETS token
  const bulletsContent = bullets.join('\n');
  let content = replaceToken(template, '${DEVFLOW_COMPLIANCE_RULE_BULLETS}', bulletsContent);

  // C3: strip remaining unknown tokens EXCEPT ${DEVFLOW_COMPLIANCE_FRAMEWORKS}
  // (preserved for stampComplianceRule below)
  content = content.replace(/\$\{DEVFLOW_COMPLIANCE_[A-Z_]+\}/g, match => {
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

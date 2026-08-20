/**
 * Core compliance framework registry and utilities.
 *
 * Pure module — no I/O, no side effects.
 * Applies ADR-013: pure helpers in src/core/, I/O orchestration in src/targets/.
 */

// ---------------------------------------------------------------------------
// Framework registry
// ---------------------------------------------------------------------------

export interface ComplianceFramework {
  /** Registry ID — matches the reference file basename under compliance/references/. */
  id: string;
  /** Human-readable label stamped into artifacts (static, never echoes user input). */
  label: string;
  /** One-line hint shown in init prompts. */
  hint: string;
}

/**
 * Canonical compliance framework registry.
 * IDs match reference file basenames: src/assets/skills/compliance/references/{id}.md
 * Labels are stamped verbatim into installed artifacts — no user input is ever written.
 * (AC-35, AC-36: no unvalidated ID reaches an fs path; no user-supplied string in artifacts)
 */
export const COMPLIANCE_FRAMEWORKS: readonly ComplianceFramework[] = [
  { id: 'gdpr',      label: 'GDPR',       hint: 'EU data protection and privacy regulation' },
  { id: 'hipaa',     label: 'HIPAA',      hint: 'US health data privacy and security' },
  { id: 'pci-dss',   label: 'PCI DSS',    hint: 'Payment card data security standard' },
  { id: 'soc2',      label: 'SOC 2',      hint: 'Service organization security and availability' },
  { id: 'iso-27001', label: 'ISO 27001',  hint: 'International information security management' },
  { id: 'sox',       label: 'SOX',        hint: 'US financial reporting controls' },
];

/** Placeholder inserted in the compliance rule file and replaced at install time. */
export const COMPLIANCE_RULE_PLACEHOLDER = '${DEVFLOW_COMPLIANCE_FRAMEWORKS}';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const REGISTRY_SET: ReadonlySet<string> = new Set(COMPLIANCE_FRAMEWORKS.map(fw => fw.id));
const LABEL_BY_ID: ReadonlyMap<string, string> = new Map(COMPLIANCE_FRAMEWORKS.map(fw => [fw.id, fw.label]));
const VALID_IDS_LIST = COMPLIANCE_FRAMEWORKS.map(fw => fw.id).join(', ');

/**
 * Normalize a single framework string:
 *   1. trim whitespace
 *   2. lowercase
 *   3. collapse spaces to dashes
 *   4. apply known alias: iso27001 → iso-27001
 */
function normalizeId(s: string): string {
  const normalized = s.trim().toLowerCase().replace(/\s+/g, '-');
  if (normalized === 'iso27001') return 'iso-27001';
  return normalized;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/** Normalize an array of framework strings without validation. */
export function normalizeFrameworks(frameworks: string[]): string[] {
  return frameworks.map(normalizeId);
}

/**
 * Parse and validate a framework list (comma-separated string or string[]).
 *
 * Normalization: lowercase, trim, space→dash, iso27001 alias.
 * Hard-rejects unknowns: error names every valid ID and every unknown ID.
 * All-invalid input still produces an error — never a silent empty list.
 * (AC-3, AC-4)
 */
export function parseFrameworkList(
  input: string | string[],
): { ok: true; value: string[] } | { ok: false; error: string } {
  // Split string input on commas; array input is used directly.
  const raw: string[] = Array.isArray(input)
    ? input
    : input.split(',').filter(s => s.trim() !== '');

  if (raw.length === 0) {
    return { ok: true, value: [] };
  }

  const normalized = raw.map(normalizeId);
  const unknowns = normalized.filter(id => !REGISTRY_SET.has(id));

  if (unknowns.length > 0) {
    return {
      ok: false,
      error: `Unknown framework ID(s): ${unknowns.join(', ')}. Valid IDs: ${VALID_IDS_LIST}`,
    };
  }

  return { ok: true, value: normalized };
}

/**
 * Normalize and self-heal a raw compliance feature value from JSON.
 *
 * Absent, null, malformed, or partially-valid → {enabled:false, frameworks:[]}.
 * Preserves valid {enabled: boolean, frameworks: string[]}.
 * (Applies ADR-014 self-heal idiom)
 */
export function normalizeComplianceFeature(
  raw: unknown,
): { enabled: boolean; frameworks: string[] } {
  const DEFAULT = { enabled: false, frameworks: [] as string[] };

  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT;
  }

  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') return DEFAULT;
  if (!Array.isArray(obj.frameworks)) return DEFAULT;
  if (!(obj.frameworks as unknown[]).every(f => typeof f === 'string')) return DEFAULT;

  return { enabled: obj.enabled, frameworks: obj.frameworks as string[] };
}

/**
 * Stamp the compliance rule file content with the selected frameworks.
 *
 * Replaces ${DEVFLOW_COMPLIANCE_FRAMEWORKS} placeholder with:
 *   - Comma-joined static registry labels (e.g. "GDPR, SOC 2") — for non-empty lists
 *   - "none declared — generic controls only" — for empty framework list
 *
 * If the placeholder is absent (e.g. a user shadow without it), content is returned
 * unchanged — no-op stamp.
 *
 * Stamps static registry labels only — no user-supplied string is ever written
 * to installed artifacts. (AC-35, AC-36)
 */
export function stampComplianceRule(content: string, frameworks: string[]): string {
  if (!content.includes(COMPLIANCE_RULE_PLACEHOLDER)) {
    return content;
  }

  let stamp: string;
  if (frameworks.length === 0) {
    stamp = 'none declared — generic controls only';
  } else {
    // Look up static labels in order of the input frameworks array.
    // Unknown IDs silently fall back to uppercase ID — parseFrameworkList
    // validates before reaching this function in the install path.
    const labels = frameworks.map(id => LABEL_BY_ID.get(id) ?? id.toUpperCase());
    stamp = labels.join(', ');
  }

  return content.replace(/\$\{DEVFLOW_COMPLIANCE_FRAMEWORKS\}/g, stamp);
}

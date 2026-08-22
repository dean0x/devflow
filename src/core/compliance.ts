/**
 * Core compliance framework registry and utilities.
 *
 * Pure module — no I/O, no side effects.
 * Applies ADR-013: pure helpers in src/core/, I/O orchestration in src/targets/.
 */

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * Named domain type for compliance feature state.
 *
 * Shared across manifest.ts, init-seed.ts, init.ts, compliance.ts, and
 * compliance-install.ts — a single definition eliminates the repeated
 * structural restatement of `{ enabled: boolean; frameworks: string[] }`.
 */
export interface ComplianceFeatureState {
  enabled: boolean;
  /** Registry-validated framework IDs. Callers MUST not assume these are validated;
   *  normalizeFrameworks / parseFrameworkList are the trust boundaries. */
  frameworks: string[];
}

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

/**
 * Reference files always installed in the compliance skill directory,
 * regardless of framework selection.
 *   detection.md — generic detection heuristics
 *   sources.md   — authoritative source index
 *
 * Exported (ADR-013: pure constant in src/core/) so both compliance-install.ts
 * (install) and compliance.ts CLI (status/drift detection) share a single
 * definition. Adding a third always-present ref requires only one change here.
 */
export const ALWAYS_PRESENT_REFS: readonly string[] = ['detection.md', 'sources.md'];

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

/**
 * Tolerant parser: normalize an array of framework strings and DROP anything
 * that is not a registry ID.
 *
 * This is the trust boundary for framework IDs that did not come through
 * `parseFrameworkList` — most importantly `manifest.features.compliance.frameworks`,
 * which `normalizeComplianceFeature` only type-checks (it cannot reject unknown IDs
 * without violating the ADR-014 self-heal contract). Every framework ID that is about
 * to become an fs path segment or be written into an installed artifact must pass
 * through here first (AC-35, AC-36).
 *
 * Unlike `parseFrameworkList` this never errors — unknown IDs are dropped silently,
 * so a manifest written by a newer devflow (or hand-edited) degrades to the subset
 * this build understands instead of failing the install.
 *
 * Deduplication: first occurrence wins, subsequent occurrences of the same ID are
 * dropped. This preserves the user's intended ordering while ensuring each framework
 * appears exactly once in installed artifacts.
 */
export function normalizeFrameworks(frameworks: readonly string[]): string[] {
  const seen = new Set<string>();
  return frameworks.map(normalizeId).filter(id => {
    if (!REGISTRY_SET.has(id)) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Parse and validate a framework list (comma-separated string).
 *
 * Normalization: lowercase, trim, space→dash, iso27001 alias.
 * Hard-rejects unknowns: error names every valid ID and every unknown ID.
 * All-invalid input still produces an error — never a silent empty list.
 * (AC-3, AC-4)
 */
export function parseFrameworkList(
  input: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  const raw = input.split(',').filter(s => s.trim() !== '');

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
): ComplianceFeatureState {
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
 * Replaces ${DEVFLOW_COMPLIANCE_FRAMEWORKS} with a full self-contained clause:
 *   - "Active frameworks: GDPR, SOC 2 — their controls are binding." (non-empty list)
 *   - "Active frameworks: none declared — generic controls only."    (empty list)
 *
 * The trailing clause lives here, not in the rule template, so the template line
 * stays slim (`- ${DEVFLOW_COMPLIANCE_FRAMEWORKS}`) and the stamp is always a
 * coherent sentence regardless of how the rule file is structured.
 *
 * The stamp replaces only the placeholder; surrounding prose is template/shadow-owned.
 *
 * If the placeholder is absent (e.g. a user shadow without it), content is returned
 * unchanged — no-op stamp.
 *
 * Stamps static registry labels only — no user-supplied string is ever written
 * to installed artifacts. (AC-35, AC-36)
 */
export function stampComplianceRule(content: string, frameworks: readonly string[]): string {
  if (!content.includes(COMPLIANCE_RULE_PLACEHOLDER)) {
    return content;
  }

  // Look up static labels in order of the input frameworks array. Unknown IDs are
  // DROPPED, never echoed — this function is the last writer before the rule lands
  // in ~/.claude/rules/devflow/, which Claude Code loads into every prompt, so an
  // unvalidated ID must not be able to inject text there (AC-35, AC-36).
  const labels = frameworks
    .map(id => LABEL_BY_ID.get(id))
    .filter((label): label is string => label !== undefined);

  const stamp = labels.length === 0
    ? 'Active frameworks: none declared — generic controls only.'
    : `Active frameworks: ${labels.join(', ')} — their controls are binding.`;

  return content.replace(/\$\{DEVFLOW_COMPLIANCE_FRAMEWORKS\}/g, stamp);
}

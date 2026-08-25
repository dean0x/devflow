import { promises as fs } from 'fs';
import * as path from 'path';
import { LEGACY_PLUGIN_NAMES, DELETED_PLUGIN_NAMES } from './plugins.js';
import {
  VIEW_MODES,
  type ViewMode,
  type FlagsRecord,
  migrateLegacyFlagsToRecord,
  sanitizeFlagsRecord,
} from './flags.js';
import { normalizeComplianceFeature, type ComplianceFeatureState } from './compliance.js';
import { writeFileAtomicExclusive } from './fs-atomic.js';

/**
 * Where the Devflow security deny list is installed.
 * 'user'    = ~/.claude/settings.json (default)
 * 'managed' = system-level managed settings
 * 'none'    = not installed
 *
 * Canonical definition — imported by post-install.ts and init.ts.
 */
export type SecurityMode = 'managed' | 'user' | 'none';

/**
 * Manifest data tracked for each Devflow installation.
 */
export interface ManifestData {
  version: string;
  plugins: string[];
  scope: 'user' | 'local';
  /**
   * Snapshot of DEVFLOW_PLUGINS names written at the last install.
   * Used by resolveSeedPlugins to detect new non-optional plugins added
   * to the registry since the previous install and auto-adopt them.
   * Absent in pre-7b manifests — readManifest self-heals to undefined.
   */
  knownPlugins?: string[];
  features: {
    ambient: boolean;
    memory: boolean;
    hud: boolean;
    knowledge: boolean;
    /** Renamed from decisions — self-healed from features.decisions on read */
    learning: boolean;
    rules: boolean;
    /**
     * Typed flag state record (keyed by flag id).
     * Absent key = unknown to this install (adopted on next seed per ADR-014).
     * Null value = known + deliberately unset (neutral).
     * Boolean value = known + explicitly enabled (true) or disabled (false).
     * Old string[] manifests are auto-migrated via migrateLegacyFlagsToRecord on read.
     */
    flags: FlagsRecord;
    /**
     * Security deny list location. 'user' = ~/.claude/settings.json,
     * 'managed' = system-level managed settings, 'none' = not installed.
     * Absent in pre-Phase-F manifests — readManifest defaults to undefined (unknown).
     */
    security?: SecurityMode;
    /**
     * External model routing (Devflow proxy) feature flag.
     * Absent in pre-proxy manifests — readManifest self-heals to false.
     */
    proxy: boolean;
    /**
     * Compliance feature — enabled flag and selected framework IDs.
     * Absent in pre-compliance manifests — readManifest self-heals to
     * {enabled:false, frameworks:[]} via normalizeComplianceFeature.
     * Disable keeps frameworks so re-enable restores the prior selection.
     */
    compliance: ComplianceFeatureState;
  };
  installedAt: string;
  updatedAt: string;
}

/**
 * Parse features.flags across the three on-disk shapes; reports whether a heal is owed.
 *
 * Case A: string[]       — legacy format, migrated to FlagsRecord (fold viewMode in).
 * Case B: object         — already a FlagsRecord, fold lingering viewMode if present.
 * Case C: missing/other  — default to empty record.
 *
 * The returned `legacy` flag is true only for Case A (array). Callers use it as the
 * flags-specific clause of needsHeal, keeping the legacy-artifact knowledge in one
 * place and letting needsHeal derive from the parse result instead of re-inspecting
 * features.flags after the fact.
 */
function parseManifestFlags(
  features: Record<string, unknown>,
  knownFlags: string[] | undefined,
): { flags: FlagsRecord; legacy: boolean } {
  const rawFlags = features.flags;

  if (Array.isArray(rawFlags)) {
    // Case A: string[] → FlagsRecord migration.
    // Filter to strings only (malformed elements are silently dropped).
    const enabledIds = (rawFlags as unknown[]).filter(e => typeof e === 'string') as string[];
    // Extract legacyViewMode for the migration fold.
    const rawViewMode = features.viewMode;
    const legacyViewMode =
      typeof rawViewMode === 'string' && (VIEW_MODES as readonly string[]).includes(rawViewMode)
        ? (rawViewMode as ViewMode)
        : undefined;
    return { flags: migrateLegacyFlagsToRecord(enabledIds, knownFlags, legacyViewMode), legacy: true };
  }

  if (rawFlags !== null && typeof rawFlags === 'object') {
    // Case B: already a FlagsRecord. Spread to avoid mutating the parsed value.
    // Single cast: rawFlags is already confirmed to be a non-null, non-array object.
    // sanitizeFlagsRecord (called by the outer readManifest) validates all values,
    // dropping invalid ones — so the double assertion is unnecessary here (applies TS-M3).
    const flagsRecord: FlagsRecord = { ...(rawFlags as FlagsRecord) };
    // Fold lingering viewMode into flags['view-mode'] when the record lacks a
    // non-default value (e.g. a manifest written by an older init that stored viewMode
    // as a separate deprecated field alongside a FlagsRecord with view-mode:null).
    const rawViewMode = features.viewMode;
    if (typeof rawViewMode === 'string' && (VIEW_MODES as readonly string[]).includes(rawViewMode)) {
      const existing = flagsRecord['view-mode'];
      if (existing === null || existing === undefined || existing === 'default') {
        flagsRecord['view-mode'] = rawViewMode as ViewMode;
      }
    }
    return { flags: flagsRecord, legacy: false };
  }

  // Case C: missing/malformed → empty record
  return { flags: {}, legacy: false };
}

/**
 * Read and parse the manifest file. Returns null if missing or corrupt.
 *
 * Self-heals the following on-disk inconsistencies (applies ADR-014):
 * - features.kb → features.knowledge rename
 * - features.decisions → features.learning rename
 * - features.flags as string[] → FlagsRecord (via migrateLegacyFlagsToRecord)
 * - features.viewMode folded into flags['view-mode'] and stripped from result
 * - features.knownFlags stripped from result (folded into FlagsRecord key-presence)
 * - features.proxy absent → false
 * - features.compliance absent/malformed → {enabled:false, frameworks:[]}
 *
 * D39: heal-write failure returns the migrated in-memory manifest (not null).
 * The on-disk format remains unhealed; next read triggers another attempt.
 */
export async function readManifest(devflowDir: string): Promise<ManifestData | null> {
  const manifestPath = path.join(devflowDir, 'manifest.json');
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content) as Record<string, unknown>;
    const features = data.features as Record<string, unknown> | undefined;
    if (
      !data.version ||
      !Array.isArray(data.plugins) ||
      !data.scope ||
      typeof features !== 'object' ||
      features === null ||
      typeof features.ambient !== 'boolean' ||
      typeof features.memory !== 'boolean' ||
      typeof data.installedAt !== 'string' ||
      typeof data.updatedAt !== 'string'
    ) {
      return null;
    }

    // Self-heal: rename features.kb → features.knowledge on disk
    const knowledge = typeof features.knowledge === 'boolean' ? features.knowledge
      : typeof features.kb === 'boolean' ? features.kb as boolean
      : false;
    // Self-heal: rename features.decisions → features.learning on disk
    // Coalesce: features.learning wins; fall back to features.decisions; default false.
    const learning = typeof features.learning === 'boolean' ? features.learning
      : typeof features.decisions === 'boolean' ? features.decisions as boolean
      : false;

    // Self-heal: non-string-array or absent knownFlags/knownPlugins → undefined (never partial/garbage)
    const asStringArray = (val: unknown): string[] | undefined =>
      Array.isArray(val) && (val as unknown[]).every(e => typeof e === 'string')
        ? (val as string[])
        : undefined;
    const knownPlugins = asStringArray(data.knownPlugins);
    // knownFlags is consumed here for migration; NOT carried into the returned manifest
    const knownFlags = asStringArray(features.knownFlags);

    // ── Parse flags ────────────────────────────────────────────────────────────
    // Delegates to parseManifestFlags (three cases: A=string[], B=object, C=missing).
    // `flagsWereLegacy` is true only when the on-disk shape was a string[] (Case A),
    // keeping the needsHeal predicate in lockstep with the parse branch above.
    const { flags: parsedFlags, legacy: flagsWereLegacy } = parseManifestFlags(features, knownFlags);

    // PF-023 + D39: sanitize all values; block prototype pollution keys.
    const sanitizedFlags = sanitizeFlagsRecord(parsedFlags);

    // needsHeal when any legacy artifact is present on disk
    const needsHeal =
      features.kb !== undefined ||
      features.decisions !== undefined ||
      flagsWereLegacy ||
      features.knownFlags !== undefined ||
      features.viewMode !== undefined;

    const SECURITY_MODES = ['none', 'user', 'managed'] as const;

    const manifest: ManifestData = {
      version: data.version as string,
      plugins: data.plugins as string[],
      scope: data.scope as 'user' | 'local',
      knownPlugins,
      features: {
        ambient: features.ambient as boolean,
        memory: features.memory as boolean,
        hud: typeof features.hud === 'boolean' ? features.hud : false,
        knowledge,
        learning,
        rules: typeof features.rules === 'boolean' ? features.rules : true,
        flags: sanitizedFlags,
        // knownFlags and viewMode are NOT carried into the result.
        // - knownFlags: its semantic (which flags are "known") is encoded in
        //   FlagsRecord key-presence (present key = known, absent = new/adopt-on-seed).
        // - viewMode: folded into flags['view-mode'] above.
        // Leaving them out prevents them from being echoed back on the next write
        // and causing a spurious needsHeal on every read.
        security: typeof features.security === 'string' && (SECURITY_MODES as readonly string[]).includes(features.security)
          ? features.security as SecurityMode
          : undefined,
        // Self-heal: absent proxy field defaults to false (applies ADR-014 self-heal idiom)
        proxy: typeof features.proxy === 'boolean' ? features.proxy : false,
        // Self-heal: absent/malformed compliance → {enabled:false, frameworks:[]}
        compliance: normalizeComplianceFeature(features.compliance),
      },
      installedAt: data.installedAt as string,
      updatedAt: data.updatedAt as string,
    };

    if (needsHeal) {
      // D39: wrap the heal-write in its own try/catch so a write failure does NOT
      // propagate to the caller. The migrated in-memory manifest is returned even
      // when the on-disk heal fails. The next read will retry the heal.
      try {
        await writeManifest(devflowDir, manifest);
      } catch {
        // heal-write failed — return migrated in-memory manifest unchanged
      }
    }

    return manifest;
  } catch {
    return null;
  }
}

/**
 * Write manifest to disk atomically. Creates parent directory if needed.
 *
 * Uses writeFileAtomicExclusive (tmp+rename) to prevent readers from seeing
 * partial writes. Applies D34 atomic-write semantics across all manifest updates.
 */
export async function writeManifest(devflowDir: string, data: ManifestData): Promise<void> {
  await fs.mkdir(devflowDir, { recursive: true });
  const manifestPath = path.join(devflowDir, 'manifest.json');
  await writeFileAtomicExclusive(manifestPath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Update a single feature field in the manifest. No-op when no manifest exists.
 * Reads, mutates, and writes atomically. The `updatedAt` timestamp is always refreshed.
 *
 * Use this in toggle commands (ambient, hud, memory, decisions, security) instead of
 * the repeated read → if-exists → mutate → write pattern.
 */
export async function syncManifestFeature<K extends keyof ManifestData['features']>(
  devflowDir: string,
  key: K,
  value: ManifestData['features'][K],
): Promise<void> {
  const manifest = await readManifest(devflowDir);
  if (!manifest) return;
  manifest.features[key] = value;
  manifest.updatedAt = new Date().toISOString();
  await writeManifest(devflowDir, manifest);
}

/**
 * Merge new plugins into existing plugin list (union, no duplicates).
 * Preserves order: existing plugins first, then new ones appended.
 */
export function mergeManifestPlugins(existing: string[], newPlugins: string[]): string[] {
  const merged = [...existing];
  for (const plugin of newPlugins) {
    if (!merged.includes(plugin)) {
      merged.push(plugin);
    }
  }
  return merged;
}

/**
 * Compare two semver strings. Returns -1, 0, or 1.
 * Handles simple x.y.z versions; returns null for unparseable input.
 *
 * Note: Pre-release suffixes (e.g., `-beta.1`, `-rc.2`) are silently ignored.
 * `1.0.0-beta.1` and `1.0.0` compare as equal. Build metadata is also ignored.
 */
function compareSemver(a: string, b: string): number | null {
  const parse = (v: string): number[] => {
    const match = v.match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [];
  };

  const pa = parse(a);
  const pb = parse(b);

  if (pa.length === 0 || pb.length === 0) return null;

  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/**
 * Detect upgrade/downgrade/same version status.
 */
export interface UpgradeInfo {
  isUpgrade: boolean;
  isDowngrade: boolean;
  isSameVersion: boolean;
  previousVersion: string | null;
}

/**
 * Resolve the final plugin list for a manifest write.
 * On partial installs (--plugin flag), merge newly installed plugins into
 * the existing manifest's plugin list. On full installs, replace entirely.
 */
export function resolvePluginList(
  installedPluginNames: string[],
  existingManifest: ManifestData | null,
  isPartialInstall: boolean,
): string[] {
  if (existingManifest && isPartialInstall) {
    const deletedSet = new Set(DELETED_PLUGIN_NAMES);
    const cleaned = existingManifest.plugins
      .filter(p => !deletedSet.has(p))
      .map(p => LEGACY_PLUGIN_NAMES[p] ?? p);
    return mergeManifestPlugins(cleaned, installedPluginNames);
  }
  return installedPluginNames;
}

export function detectUpgrade(currentVersion: string, installedVersion: string | null): UpgradeInfo {
  if (!installedVersion) {
    return { isUpgrade: false, isDowngrade: false, isSameVersion: false, previousVersion: null };
  }

  const cmp = compareSemver(currentVersion, installedVersion);
  if (cmp === null) {
    return { isUpgrade: false, isDowngrade: false, isSameVersion: false, previousVersion: installedVersion };
  }
  return {
    isUpgrade: cmp > 0,
    isDowngrade: cmp < 0,
    isSameVersion: cmp === 0,
    previousVersion: installedVersion,
  };
}

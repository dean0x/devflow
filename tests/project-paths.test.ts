/**
 * Tests for src/cli/utils/project-paths.ts (TypeScript module) and
 * scripts/hooks/lib/project-paths.cjs (CJS counterpart).
 *
 * Goals:
 * 1. Each function returns the expected path under a given projectRoot.
 * 2. TypeScript and CJS modules produce identical output for every function.
 * 3. Functions handle trailing slashes and normalised paths correctly.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

// Import TypeScript module (ESM)
import {
  getMemoryDir,
  getDreamDir,
  getDecisionsDir,
  getFeaturesDir,
  getDocsDir,
  getDreamConfigPath,
  getDreamPendingTurnsPath,
  getDreamPendingTurnsProcessingPath,
  getDecisionsFilePath,
  getPitfallsFilePath,
  getDecisionsConfigPath,
  getDecisionsLedgerPath,
  getDecisionsLogPath,
  getDecisionsArchivePath,
  getDecisionsManifestPath,
  getDecisionsLockDir,
  getDecisionsUsagePath,
  getDecisionsUsageLockDir,
  getObservationsLockDir,
  getDecisionsNotificationsPath,
  getDecisionsBatchIdsPath,
  getDecisionsIndexPath,
  getWorkingMemoryPath,
  getBackupPath,
  getPendingTurnsPath,
  getPendingTurnsProcessingPath,
  getPendingTurnsLockDir,
  getReviewsDir,
  getDesignDir,
  getResearchDir,
  getHandoffPath,
  getGitignoreEntries,
} from '../src/cli/utils/project-paths.js';
import * as tsPathsNs from '../src/cli/utils/project-paths.js';

// Load CJS module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const requireCjs = createRequire(import.meta.url);
const cjsPaths = requireCjs(path.join(__dirname, '..', 'scripts', 'hooks', 'lib', 'project-paths.cjs'));

const ROOT = '/some/project';

describe('project-paths TypeScript module', () => {
  describe('core directories', () => {
    it('getMemoryDir returns .devflow/memory/', () => {
      expect(getMemoryDir(ROOT)).toBe('/some/project/.devflow/memory');
    });

    it('getDreamDir returns .devflow/dream/', () => {
      expect(getDreamDir(ROOT)).toBe('/some/project/.devflow/dream');
    });

    it('getDecisionsDir returns .devflow/decisions/', () => {
      expect(getDecisionsDir(ROOT)).toBe('/some/project/.devflow/decisions');
    });

    it('getFeaturesDir returns .devflow/features/', () => {
      expect(getFeaturesDir(ROOT)).toBe('/some/project/.devflow/features');
    });

    it('getDocsDir returns .devflow/docs/', () => {
      expect(getDocsDir(ROOT)).toBe('/some/project/.devflow/docs');
    });
  });

  describe('dream files', () => {
    it('getDreamConfigPath returns .devflow/dream/config.json', () => {
      expect(getDreamConfigPath(ROOT)).toBe('/some/project/.devflow/dream/config.json');
    });

    it('getDreamPendingTurnsPath returns .devflow/dream/.pending-turns.jsonl', () => {
      expect(getDreamPendingTurnsPath(ROOT)).toBe('/some/project/.devflow/dream/.pending-turns.jsonl');
    });

    it('getDreamPendingTurnsProcessingPath returns .devflow/dream/.pending-turns.processing', () => {
      expect(getDreamPendingTurnsProcessingPath(ROOT)).toBe('/some/project/.devflow/dream/.pending-turns.processing');
    });
  });

  describe('decisions files', () => {
    it('getDecisionsFilePath returns .devflow/decisions/decisions.md', () => {
      expect(getDecisionsFilePath(ROOT)).toBe('/some/project/.devflow/decisions/decisions.md');
    });

    it('getPitfallsFilePath returns .devflow/decisions/pitfalls.md', () => {
      expect(getPitfallsFilePath(ROOT)).toBe('/some/project/.devflow/decisions/pitfalls.md');
    });

    it('getDecisionsConfigPath returns .devflow/decisions/decisions.json', () => {
      expect(getDecisionsConfigPath(ROOT)).toBe('/some/project/.devflow/decisions/decisions.json');
    });

    it('getDecisionsLogPath returns .devflow/decisions/decisions-log.jsonl', () => {
      expect(getDecisionsLogPath(ROOT)).toBe('/some/project/.devflow/decisions/decisions-log.jsonl');
    });

    it('getDecisionsManifestPath returns .devflow/decisions/.decisions-manifest.json', () => {
      expect(getDecisionsManifestPath(ROOT)).toBe('/some/project/.devflow/decisions/.decisions-manifest.json');
    });

    it('getDecisionsLockDir returns .devflow/decisions/.decisions.lock', () => {
      expect(getDecisionsLockDir(ROOT)).toBe('/some/project/.devflow/decisions/.decisions.lock');
    });

    it('getDecisionsUsagePath returns .devflow/decisions/.decisions-usage.json', () => {
      expect(getDecisionsUsagePath(ROOT)).toBe('/some/project/.devflow/decisions/.decisions-usage.json');
    });

    it('getDecisionsUsageLockDir returns .devflow/decisions/.decisions-usage.lock', () => {
      expect(getDecisionsUsageLockDir(ROOT)).toBe('/some/project/.devflow/decisions/.decisions-usage.lock');
    });

    it('getDecisionsNotificationsPath returns .devflow/decisions/.decisions-notifications.json', () => {
      expect(getDecisionsNotificationsPath(ROOT)).toBe('/some/project/.devflow/decisions/.decisions-notifications.json');
    });

    it('getDecisionsBatchIdsPath returns .devflow/decisions/.decisions-batch-ids', () => {
      expect(getDecisionsBatchIdsPath(ROOT)).toBe('/some/project/.devflow/decisions/.decisions-batch-ids');
    });

    it('getDecisionsIndexPath returns .devflow/decisions/index.md', () => {
      expect(getDecisionsIndexPath(ROOT)).toBe('/some/project/.devflow/decisions/index.md');
    });
  });

  describe('memory / working-memory files', () => {
    it('getWorkingMemoryPath returns .devflow/memory/WORKING-MEMORY.md', () => {
      expect(getWorkingMemoryPath(ROOT)).toBe('/some/project/.devflow/memory/WORKING-MEMORY.md');
    });

    it('getBackupPath returns .devflow/memory/backup.json', () => {
      expect(getBackupPath(ROOT)).toBe('/some/project/.devflow/memory/backup.json');
    });

    it('getPendingTurnsPath returns .devflow/memory/.pending-turns.jsonl', () => {
      expect(getPendingTurnsPath(ROOT)).toBe('/some/project/.devflow/memory/.pending-turns.jsonl');
    });

    it('getPendingTurnsProcessingPath returns .devflow/memory/.pending-turns.processing', () => {
      expect(getPendingTurnsProcessingPath(ROOT)).toBe('/some/project/.devflow/memory/.pending-turns.processing');
    });

    it('getPendingTurnsLockDir returns .devflow/memory/.pending-turns.lock', () => {
      expect(getPendingTurnsLockDir(ROOT)).toBe('/some/project/.devflow/memory/.pending-turns.lock');
    });
  });

  describe('docs files', () => {
    it('getReviewsDir returns .devflow/docs/reviews/', () => {
      expect(getReviewsDir(ROOT)).toBe('/some/project/.devflow/docs/reviews');
    });

    it('getDesignDir returns .devflow/docs/design/', () => {
      expect(getDesignDir(ROOT)).toBe('/some/project/.devflow/docs/design');
    });

    it('getResearchDir returns .devflow/docs/research/', () => {
      expect(getResearchDir(ROOT)).toBe('/some/project/.devflow/docs/research');
    });

    it('getHandoffPath returns .devflow/docs/handoff-{branchSlug}.md', () => {
      expect(getHandoffPath(ROOT, 'feat-my-feature')).toBe('/some/project/.devflow/docs/handoff-feat-my-feature.md');
    });
  });

  describe('getGitignoreEntries', () => {
    it('returns an array of strings', () => {
      const entries = getGitignoreEntries();
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(typeof e).toBe('string');
      }
    });

    it('includes .claude/', () => {
      expect(getGitignoreEntries()).toContain('.claude/');
    });

    it('does NOT include .devflow/ — that is managed by ensureDevflowGitignore (carve-out)', () => {
      // A bare `.devflow/` here would be appended after the carve-out and re-bury it.
      expect(getGitignoreEntries()).not.toContain('.devflow/');
      expect(getGitignoreEntries()).not.toContain('.devflow/*');
    });

    it('does not include old .memory/ entry', () => {
      expect(getGitignoreEntries()).not.toContain('.memory/');
    });
  });

  describe('path normalisation', () => {
    it('handles a root path that ends with a slash', () => {
      // path.join strips trailing slashes
      expect(getMemoryDir('/some/project/')).toBe('/some/project/.devflow/memory');
    });

    it('returns absolute paths', () => {
      expect(path.isAbsolute(getMemoryDir(ROOT))).toBe(true);
      expect(path.isAbsolute(getFeaturesDir(ROOT))).toBe(true);
      expect(path.isAbsolute(getDocsDir(ROOT))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// CJS parity tests — verify TypeScript and CJS modules agree on every function
// ---------------------------------------------------------------------------

describe('CJS project-paths parity', () => {
  const functions: Array<{
    name: string;
    ts: (root: string) => string;
    cjs: (root: string) => string;
  }> = [
    { name: 'getMemoryDir', ts: getMemoryDir, cjs: cjsPaths.getMemoryDir },
    { name: 'getDreamDir', ts: getDreamDir, cjs: cjsPaths.getDreamDir },
    { name: 'getDecisionsDir', ts: getDecisionsDir, cjs: cjsPaths.getDecisionsDir },
    { name: 'getFeaturesDir', ts: getFeaturesDir, cjs: cjsPaths.getFeaturesDir },
    { name: 'getDocsDir', ts: getDocsDir, cjs: cjsPaths.getDocsDir },
    { name: 'getDreamConfigPath', ts: getDreamConfigPath, cjs: cjsPaths.getDreamConfigPath },
    { name: 'getDreamPendingTurnsPath', ts: getDreamPendingTurnsPath, cjs: cjsPaths.getDreamPendingTurnsPath },
    { name: 'getDreamPendingTurnsProcessingPath', ts: getDreamPendingTurnsProcessingPath, cjs: cjsPaths.getDreamPendingTurnsProcessingPath },
    { name: 'getDecisionsFilePath', ts: getDecisionsFilePath, cjs: cjsPaths.getDecisionsFilePath },
    { name: 'getPitfallsFilePath', ts: getPitfallsFilePath, cjs: cjsPaths.getPitfallsFilePath },
    { name: 'getDecisionsConfigPath', ts: getDecisionsConfigPath, cjs: cjsPaths.getDecisionsConfigPath },
    { name: 'getDecisionsLedgerPath', ts: getDecisionsLedgerPath, cjs: cjsPaths.getDecisionsLedgerPath },
    { name: 'getDecisionsLogPath', ts: getDecisionsLogPath, cjs: cjsPaths.getDecisionsLogPath },
    { name: 'getDecisionsArchivePath', ts: getDecisionsArchivePath, cjs: cjsPaths.getDecisionsArchivePath },
    { name: 'getDecisionsManifestPath', ts: getDecisionsManifestPath, cjs: cjsPaths.getDecisionsManifestPath },
    { name: 'getDecisionsLockDir', ts: getDecisionsLockDir, cjs: cjsPaths.getDecisionsLockDir },
    { name: 'getDecisionsUsagePath', ts: getDecisionsUsagePath, cjs: cjsPaths.getDecisionsUsagePath },
    { name: 'getDecisionsUsageLockDir', ts: getDecisionsUsageLockDir, cjs: cjsPaths.getDecisionsUsageLockDir },
    { name: 'getObservationsLockDir', ts: getObservationsLockDir, cjs: cjsPaths.getObservationsLockDir },
    { name: 'getDecisionsNotificationsPath', ts: getDecisionsNotificationsPath, cjs: cjsPaths.getDecisionsNotificationsPath },
    { name: 'getDecisionsBatchIdsPath', ts: getDecisionsBatchIdsPath, cjs: cjsPaths.getDecisionsBatchIdsPath },
    { name: 'getDecisionsIndexPath', ts: getDecisionsIndexPath, cjs: cjsPaths.getDecisionsIndexPath },
    { name: 'getWorkingMemoryPath', ts: getWorkingMemoryPath, cjs: cjsPaths.getWorkingMemoryPath },
    { name: 'getBackupPath', ts: getBackupPath, cjs: cjsPaths.getBackupPath },
    { name: 'getPendingTurnsPath', ts: getPendingTurnsPath, cjs: cjsPaths.getPendingTurnsPath },
    { name: 'getPendingTurnsProcessingPath', ts: getPendingTurnsProcessingPath, cjs: cjsPaths.getPendingTurnsProcessingPath },
    { name: 'getPendingTurnsLockDir', ts: getPendingTurnsLockDir, cjs: cjsPaths.getPendingTurnsLockDir },
    { name: 'getReviewsDir', ts: getReviewsDir, cjs: cjsPaths.getReviewsDir },
    { name: 'getDesignDir', ts: getDesignDir, cjs: cjsPaths.getDesignDir },
    { name: 'getResearchDir', ts: getResearchDir, cjs: cjsPaths.getResearchDir },
  ];

  for (const { name, ts, cjs } of functions) {
    it(`${name} — TypeScript and CJS agree`, () => {
      expect(cjs(ROOT)).toBe(ts(ROOT));
    });
  }

  it('getHandoffPath — TypeScript and CJS agree', () => {
    expect(cjsPaths.getHandoffPath(ROOT, 'feat-branch')).toBe(getHandoffPath(ROOT, 'feat-branch'));
  });

  it('getGitignoreEntries — TypeScript and CJS agree', () => {
    expect(cjsPaths.getGitignoreEntries()).toEqual(getGitignoreEntries());
  });

  // TS/CJS parity: getDreamDir and getDreamConfigPath return .devflow/dream/
  it('getDreamDir returns .devflow/dream/ in both TS and CJS', () => {
    expect(getDreamDir(ROOT)).toBe('/some/project/.devflow/dream');
    expect(cjsPaths.getDreamDir(ROOT)).toBe('/some/project/.devflow/dream');
  });

  it('getDreamConfigPath returns .devflow/dream/config.json in both TS and CJS', () => {
    expect(getDreamConfigPath(ROOT)).toBe('/some/project/.devflow/dream/config.json');
    expect(cjsPaths.getDreamConfigPath(ROOT)).toBe('/some/project/.devflow/dream/config.json');
  });

  // Structural full-export parity: guards against silent drift where a function
  // is added to one module but not the other. The hardcoded list above only
  // covers enumerated functions; this asserts the COMPLETE export sets match so
  // any future addition to one side without the other fails fast.
  it('TypeScript and CJS export the identical set of function names', () => {
    const tsNames = Object.keys(tsPathsNs)
      .filter(k => typeof (tsPathsNs as Record<string, unknown>)[k] === 'function')
      .sort();
    const cjsNames = Object.keys(cjsPaths)
      .filter(k => typeof (cjsPaths as Record<string, unknown>)[k] === 'function')
      .sort();
    expect(cjsNames).toEqual(tsNames);
  });
});

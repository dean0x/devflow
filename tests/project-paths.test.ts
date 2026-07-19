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
  getLearningDir,
  getFeaturesDir,
  getDocsDir,
  getFeatureConfigPath,
  getLearningPendingTurnsPath,
  getLearningPendingTurnsProcessingPath,
  getDecisionsFilePath,
  getPitfallsFilePath,
  getLearningTuningConfigPath,
  getDecisionsLedgerPath,
  getDecisionsLogPath,
  getDecisionsArchivePath,
  getDecisionsLockDir,
  getDecisionsUsagePath,
  getDecisionsUsageLockDir,
  getObservationsLockDir,
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
} from '../src/core/project-paths.js';
import * as tsPathsNs from '../src/core/project-paths.js';

// Load CJS module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const requireCjs = createRequire(import.meta.url);
const cjsPaths = requireCjs(path.join(__dirname, '..', 'src', 'assets', 'scripts', 'hooks', 'lib', 'project-paths.cjs'));

const ROOT = '/some/project';

describe('project-paths TypeScript module', () => {
  describe('core directories', () => {
    it('getMemoryDir returns .devflow/memory/', () => {
      expect(getMemoryDir(ROOT)).toBe('/some/project/.devflow/memory');
    });

    it('getLearningDir returns .devflow/learning/', () => {
      expect(getLearningDir(ROOT)).toBe('/some/project/.devflow/learning');
    });

    it('getFeaturesDir returns .devflow/features/', () => {
      expect(getFeaturesDir(ROOT)).toBe('/some/project/.devflow/features');
    });

    it('getDocsDir returns .devflow/docs/', () => {
      expect(getDocsDir(ROOT)).toBe('/some/project/.devflow/docs');
    });
  });

  describe('feature config', () => {
    it('getFeatureConfigPath returns .devflow/config.json', () => {
      expect(getFeatureConfigPath(ROOT)).toBe('/some/project/.devflow/config.json');
    });
  });

  describe('learning queue files', () => {
    it('getLearningPendingTurnsPath returns .devflow/learning/.pending-turns.jsonl', () => {
      expect(getLearningPendingTurnsPath(ROOT)).toBe('/some/project/.devflow/learning/.pending-turns.jsonl');
    });

    it('getLearningPendingTurnsProcessingPath returns .devflow/learning/.pending-turns.processing', () => {
      expect(getLearningPendingTurnsProcessingPath(ROOT)).toBe('/some/project/.devflow/learning/.pending-turns.processing');
    });
  });

  describe('learning content files', () => {
    it('getDecisionsFilePath returns .devflow/learning/decisions.md', () => {
      expect(getDecisionsFilePath(ROOT)).toBe('/some/project/.devflow/learning/decisions.md');
    });

    it('getPitfallsFilePath returns .devflow/learning/pitfalls.md', () => {
      expect(getPitfallsFilePath(ROOT)).toBe('/some/project/.devflow/learning/pitfalls.md');
    });

    it('getLearningTuningConfigPath returns .devflow/learning/learning.json', () => {
      expect(getLearningTuningConfigPath(ROOT)).toBe('/some/project/.devflow/learning/learning.json');
    });

    it('getDecisionsLogPath returns .devflow/learning/decisions-log.jsonl', () => {
      expect(getDecisionsLogPath(ROOT)).toBe('/some/project/.devflow/learning/decisions-log.jsonl');
    });

    it('getDecisionsLockDir returns .devflow/learning/.decisions.lock', () => {
      expect(getDecisionsLockDir(ROOT)).toBe('/some/project/.devflow/learning/.decisions.lock');
    });

    it('getDecisionsUsagePath returns .devflow/learning/.decisions-usage.json', () => {
      expect(getDecisionsUsagePath(ROOT)).toBe('/some/project/.devflow/learning/.decisions-usage.json');
    });

    it('getDecisionsUsageLockDir returns .devflow/learning/.decisions-usage.lock', () => {
      expect(getDecisionsUsageLockDir(ROOT)).toBe('/some/project/.devflow/learning/.decisions-usage.lock');
    });

    it('getDecisionsIndexPath returns .devflow/learning/index.md', () => {
      expect(getDecisionsIndexPath(ROOT)).toBe('/some/project/.devflow/learning/index.md');
    });

    it('getObservationsLockDir returns .devflow/learning/.observations.lock', () => {
      expect(getObservationsLockDir(ROOT)).toBe('/some/project/.devflow/learning/.observations.lock');
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
    { name: 'getLearningDir', ts: getLearningDir, cjs: cjsPaths.getLearningDir },
    { name: 'getFeaturesDir', ts: getFeaturesDir, cjs: cjsPaths.getFeaturesDir },
    { name: 'getDocsDir', ts: getDocsDir, cjs: cjsPaths.getDocsDir },
    { name: 'getFeatureConfigPath', ts: getFeatureConfigPath, cjs: cjsPaths.getFeatureConfigPath },
    { name: 'getLearningPendingTurnsPath', ts: getLearningPendingTurnsPath, cjs: cjsPaths.getLearningPendingTurnsPath },
    { name: 'getLearningPendingTurnsProcessingPath', ts: getLearningPendingTurnsProcessingPath, cjs: cjsPaths.getLearningPendingTurnsProcessingPath },
    { name: 'getDecisionsFilePath', ts: getDecisionsFilePath, cjs: cjsPaths.getDecisionsFilePath },
    { name: 'getPitfallsFilePath', ts: getPitfallsFilePath, cjs: cjsPaths.getPitfallsFilePath },
    { name: 'getLearningTuningConfigPath', ts: getLearningTuningConfigPath, cjs: cjsPaths.getLearningTuningConfigPath },
    { name: 'getDecisionsLedgerPath', ts: getDecisionsLedgerPath, cjs: cjsPaths.getDecisionsLedgerPath },
    { name: 'getDecisionsLogPath', ts: getDecisionsLogPath, cjs: cjsPaths.getDecisionsLogPath },
    { name: 'getDecisionsArchivePath', ts: getDecisionsArchivePath, cjs: cjsPaths.getDecisionsArchivePath },
    { name: 'getDecisionsLockDir', ts: getDecisionsLockDir, cjs: cjsPaths.getDecisionsLockDir },
    { name: 'getDecisionsUsagePath', ts: getDecisionsUsagePath, cjs: cjsPaths.getDecisionsUsagePath },
    { name: 'getDecisionsUsageLockDir', ts: getDecisionsUsageLockDir, cjs: cjsPaths.getDecisionsUsageLockDir },
    { name: 'getObservationsLockDir', ts: getObservationsLockDir, cjs: cjsPaths.getObservationsLockDir },
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

  // TS/CJS parity: getLearningDir and getFeatureConfigPath return the correct paths
  it('getLearningDir returns .devflow/learning/ in both TS and CJS', () => {
    expect(getLearningDir(ROOT)).toBe('/some/project/.devflow/learning');
    expect(cjsPaths.getLearningDir(ROOT)).toBe('/some/project/.devflow/learning');
  });

  it('getFeatureConfigPath returns .devflow/config.json in both TS and CJS', () => {
    expect(getFeatureConfigPath(ROOT)).toBe('/some/project/.devflow/config.json');
    expect(cjsPaths.getFeatureConfigPath(ROOT)).toBe('/some/project/.devflow/config.json');
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

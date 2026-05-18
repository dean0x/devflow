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
  getSidecarDir,
  getDecisionsDir,
  getFeaturesDir,
  getDocsDir,
  getSidecarConfigPath,
  getDecisionsFilePath,
  getPitfallsFilePath,
  getDecisionsDisabledSentinel,
  getDecisionsConfigPath,
  getDecisionsLogPath,
  getDecisionsManifestPath,
  getDecisionsLockDir,
  getDecisionsUsagePath,
  getDecisionsUsageLockDir,
  getDecisionsNotificationsPath,
  getDecisionsRunsTodayPath,
  getDecisionsBatchIdsPath,
  getLearningLogPath,
  getLearningConfigPath,
  getLearningManifestPath,
  getLearningNotifiedAtPath,
  getLearningNotificationsPath,
  getLearningRunsTodayPath,
  getLearningSessionCountPath,
  getLearningBatchIdsPath,
  getLearningDisabledSentinel,
  getWorkingMemoryDisabledSentinel,
  getWorkingMemoryPath,
  getBackupPath,
  getPendingTurnsPath,
  getPendingTurnsProcessingPath,
  getPendingTurnsLockDir,
  getFeaturesIndexPath,
  getKnowledgePath,
  getFeaturesDisabledSentinel,
  getFeaturesLockDir,
  getFeaturesLastRefreshPath,
  getReviewsDir,
  getDesignDir,
  getResearchDir,
  getHandoffPath,
  getGitignoreEntries,
} from '../src/cli/utils/project-paths.js';

// Load CJS module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const requireCjs = createRequire(import.meta.url);
const cjsPaths = requireCjs(path.join(__dirname, '..', 'scripts', 'hooks', 'lib', 'project-paths.cjs'));

const ROOT = '/some/project';

describe('project-paths TypeScript module', () => {
  describe('core directories', () => {
    it('getMemoryDir returns .memory/', () => {
      expect(getMemoryDir(ROOT)).toBe('/some/project/.memory');
    });

    it('getSidecarDir returns .memory/.sidecar/', () => {
      expect(getSidecarDir(ROOT)).toBe('/some/project/.memory/.sidecar');
    });

    it('getDecisionsDir returns .memory/decisions/', () => {
      expect(getDecisionsDir(ROOT)).toBe('/some/project/.memory/decisions');
    });

    it('getFeaturesDir returns .features/', () => {
      expect(getFeaturesDir(ROOT)).toBe('/some/project/.features');
    });

    it('getDocsDir returns .docs/', () => {
      expect(getDocsDir(ROOT)).toBe('/some/project/.docs');
    });
  });

  describe('sidecar files', () => {
    it('getSidecarConfigPath returns .memory/.sidecar/config.json', () => {
      expect(getSidecarConfigPath(ROOT)).toBe('/some/project/.memory/.sidecar/config.json');
    });
  });

  describe('decisions files', () => {
    it('getDecisionsFilePath returns .memory/decisions/decisions.md', () => {
      expect(getDecisionsFilePath(ROOT)).toBe('/some/project/.memory/decisions/decisions.md');
    });

    it('getPitfallsFilePath returns .memory/decisions/pitfalls.md', () => {
      expect(getPitfallsFilePath(ROOT)).toBe('/some/project/.memory/decisions/pitfalls.md');
    });

    it('getDecisionsDisabledSentinel returns .memory/decisions/.disabled', () => {
      expect(getDecisionsDisabledSentinel(ROOT)).toBe('/some/project/.memory/decisions/.disabled');
    });

    it('getDecisionsConfigPath returns .memory/decisions.json', () => {
      expect(getDecisionsConfigPath(ROOT)).toBe('/some/project/.memory/decisions.json');
    });

    it('getDecisionsLogPath returns .memory/decisions-log.jsonl', () => {
      expect(getDecisionsLogPath(ROOT)).toBe('/some/project/.memory/decisions-log.jsonl');
    });

    it('getDecisionsManifestPath returns .memory/.decisions-manifest.json', () => {
      expect(getDecisionsManifestPath(ROOT)).toBe('/some/project/.memory/.decisions-manifest.json');
    });

    it('getDecisionsLockDir returns .memory/.decisions.lock', () => {
      expect(getDecisionsLockDir(ROOT)).toBe('/some/project/.memory/.decisions.lock');
    });

    it('getDecisionsUsagePath returns .memory/.decisions-usage.json', () => {
      expect(getDecisionsUsagePath(ROOT)).toBe('/some/project/.memory/.decisions-usage.json');
    });

    it('getDecisionsUsageLockDir returns .memory/.decisions-usage.lock', () => {
      expect(getDecisionsUsageLockDir(ROOT)).toBe('/some/project/.memory/.decisions-usage.lock');
    });

    it('getDecisionsNotificationsPath returns .memory/.decisions-notifications.json', () => {
      expect(getDecisionsNotificationsPath(ROOT)).toBe('/some/project/.memory/.decisions-notifications.json');
    });

    it('getDecisionsRunsTodayPath returns .memory/.decisions-runs-today', () => {
      expect(getDecisionsRunsTodayPath(ROOT)).toBe('/some/project/.memory/.decisions-runs-today');
    });

    it('getDecisionsBatchIdsPath returns .memory/.decisions-batch-ids', () => {
      expect(getDecisionsBatchIdsPath(ROOT)).toBe('/some/project/.memory/.decisions-batch-ids');
    });
  });

  describe('learning files', () => {
    it('getLearningLogPath returns .memory/learning-log.jsonl', () => {
      expect(getLearningLogPath(ROOT)).toBe('/some/project/.memory/learning-log.jsonl');
    });

    it('getLearningConfigPath returns .memory/learning.json', () => {
      expect(getLearningConfigPath(ROOT)).toBe('/some/project/.memory/learning.json');
    });

    it('getLearningManifestPath returns .memory/.learning-manifest.json', () => {
      expect(getLearningManifestPath(ROOT)).toBe('/some/project/.memory/.learning-manifest.json');
    });

    it('getLearningNotifiedAtPath returns .memory/.learning-notified-at', () => {
      expect(getLearningNotifiedAtPath(ROOT)).toBe('/some/project/.memory/.learning-notified-at');
    });

    it('getLearningNotificationsPath returns .memory/.learning-notifications.json', () => {
      expect(getLearningNotificationsPath(ROOT)).toBe('/some/project/.memory/.learning-notifications.json');
    });

    it('getLearningRunsTodayPath returns .memory/.learning-runs-today', () => {
      expect(getLearningRunsTodayPath(ROOT)).toBe('/some/project/.memory/.learning-runs-today');
    });

    it('getLearningSessionCountPath returns .memory/.learning-session-count', () => {
      expect(getLearningSessionCountPath(ROOT)).toBe('/some/project/.memory/.learning-session-count');
    });

    it('getLearningBatchIdsPath returns .memory/.learning-batch-ids', () => {
      expect(getLearningBatchIdsPath(ROOT)).toBe('/some/project/.memory/.learning-batch-ids');
    });

    it('getLearningDisabledSentinel returns .memory/.learning-disabled', () => {
      expect(getLearningDisabledSentinel(ROOT)).toBe('/some/project/.memory/.learning-disabled');
    });
  });

  describe('memory / working-memory files', () => {
    it('getWorkingMemoryDisabledSentinel returns .memory/.working-memory-disabled', () => {
      expect(getWorkingMemoryDisabledSentinel(ROOT)).toBe('/some/project/.memory/.working-memory-disabled');
    });

    it('getWorkingMemoryPath returns .memory/WORKING-MEMORY.md', () => {
      expect(getWorkingMemoryPath(ROOT)).toBe('/some/project/.memory/WORKING-MEMORY.md');
    });

    it('getBackupPath returns .memory/backup.json', () => {
      expect(getBackupPath(ROOT)).toBe('/some/project/.memory/backup.json');
    });

    it('getPendingTurnsPath returns .memory/.pending-turns.jsonl', () => {
      expect(getPendingTurnsPath(ROOT)).toBe('/some/project/.memory/.pending-turns.jsonl');
    });

    it('getPendingTurnsProcessingPath returns .memory/.pending-turns.processing', () => {
      expect(getPendingTurnsProcessingPath(ROOT)).toBe('/some/project/.memory/.pending-turns.processing');
    });

    it('getPendingTurnsLockDir returns .memory/.pending-turns.lock', () => {
      expect(getPendingTurnsLockDir(ROOT)).toBe('/some/project/.memory/.pending-turns.lock');
    });
  });

  describe('features / knowledge files', () => {
    it('getFeaturesIndexPath returns .features/index.json', () => {
      expect(getFeaturesIndexPath(ROOT)).toBe('/some/project/.features/index.json');
    });

    it('getKnowledgePath returns .features/{slug}/KNOWLEDGE.md', () => {
      expect(getKnowledgePath(ROOT, 'my-feature')).toBe('/some/project/.features/my-feature/KNOWLEDGE.md');
    });

    it('getFeaturesDisabledSentinel returns .features/.disabled', () => {
      expect(getFeaturesDisabledSentinel(ROOT)).toBe('/some/project/.features/.disabled');
    });

    it('getFeaturesLockDir returns .features/.knowledge.lock', () => {
      expect(getFeaturesLockDir(ROOT)).toBe('/some/project/.features/.knowledge.lock');
    });

    it('getFeaturesLastRefreshPath returns .features/.knowledge-last-refresh', () => {
      expect(getFeaturesLastRefreshPath(ROOT)).toBe('/some/project/.features/.knowledge-last-refresh');
    });
  });

  describe('docs files', () => {
    it('getReviewsDir returns .docs/reviews/', () => {
      expect(getReviewsDir(ROOT)).toBe('/some/project/.docs/reviews');
    });

    it('getDesignDir returns .docs/design/', () => {
      expect(getDesignDir(ROOT)).toBe('/some/project/.docs/design');
    });

    it('getResearchDir returns .docs/research/', () => {
      expect(getResearchDir(ROOT)).toBe('/some/project/.docs/research');
    });

    it('getHandoffPath returns .docs/handoff-{branchSlug}.md', () => {
      expect(getHandoffPath(ROOT, 'feat-my-feature')).toBe('/some/project/.docs/handoff-feat-my-feature.md');
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

    it('includes .memory/', () => {
      expect(getGitignoreEntries()).toContain('.memory/');
    });

    it('includes .features/.knowledge.lock', () => {
      expect(getGitignoreEntries()).toContain('.features/.knowledge.lock');
    });
  });

  describe('path normalisation', () => {
    it('handles a root path that ends with a slash', () => {
      // path.join strips trailing slashes
      expect(getMemoryDir('/some/project/')).toBe('/some/project/.memory');
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
    { name: 'getSidecarDir', ts: getSidecarDir, cjs: cjsPaths.getSidecarDir },
    { name: 'getDecisionsDir', ts: getDecisionsDir, cjs: cjsPaths.getDecisionsDir },
    { name: 'getFeaturesDir', ts: getFeaturesDir, cjs: cjsPaths.getFeaturesDir },
    { name: 'getDocsDir', ts: getDocsDir, cjs: cjsPaths.getDocsDir },
    { name: 'getSidecarConfigPath', ts: getSidecarConfigPath, cjs: cjsPaths.getSidecarConfigPath },
    { name: 'getDecisionsFilePath', ts: getDecisionsFilePath, cjs: cjsPaths.getDecisionsFilePath },
    { name: 'getPitfallsFilePath', ts: getPitfallsFilePath, cjs: cjsPaths.getPitfallsFilePath },
    { name: 'getDecisionsDisabledSentinel', ts: getDecisionsDisabledSentinel, cjs: cjsPaths.getDecisionsDisabledSentinel },
    { name: 'getDecisionsConfigPath', ts: getDecisionsConfigPath, cjs: cjsPaths.getDecisionsConfigPath },
    { name: 'getDecisionsLogPath', ts: getDecisionsLogPath, cjs: cjsPaths.getDecisionsLogPath },
    { name: 'getDecisionsManifestPath', ts: getDecisionsManifestPath, cjs: cjsPaths.getDecisionsManifestPath },
    { name: 'getDecisionsLockDir', ts: getDecisionsLockDir, cjs: cjsPaths.getDecisionsLockDir },
    { name: 'getDecisionsUsagePath', ts: getDecisionsUsagePath, cjs: cjsPaths.getDecisionsUsagePath },
    { name: 'getDecisionsUsageLockDir', ts: getDecisionsUsageLockDir, cjs: cjsPaths.getDecisionsUsageLockDir },
    { name: 'getDecisionsNotificationsPath', ts: getDecisionsNotificationsPath, cjs: cjsPaths.getDecisionsNotificationsPath },
    { name: 'getDecisionsRunsTodayPath', ts: getDecisionsRunsTodayPath, cjs: cjsPaths.getDecisionsRunsTodayPath },
    { name: 'getDecisionsBatchIdsPath', ts: getDecisionsBatchIdsPath, cjs: cjsPaths.getDecisionsBatchIdsPath },
    { name: 'getLearningLogPath', ts: getLearningLogPath, cjs: cjsPaths.getLearningLogPath },
    { name: 'getLearningConfigPath', ts: getLearningConfigPath, cjs: cjsPaths.getLearningConfigPath },
    { name: 'getLearningManifestPath', ts: getLearningManifestPath, cjs: cjsPaths.getLearningManifestPath },
    { name: 'getLearningNotifiedAtPath', ts: getLearningNotifiedAtPath, cjs: cjsPaths.getLearningNotifiedAtPath },
    { name: 'getLearningNotificationsPath', ts: getLearningNotificationsPath, cjs: cjsPaths.getLearningNotificationsPath },
    { name: 'getLearningRunsTodayPath', ts: getLearningRunsTodayPath, cjs: cjsPaths.getLearningRunsTodayPath },
    { name: 'getLearningSessionCountPath', ts: getLearningSessionCountPath, cjs: cjsPaths.getLearningSessionCountPath },
    { name: 'getLearningBatchIdsPath', ts: getLearningBatchIdsPath, cjs: cjsPaths.getLearningBatchIdsPath },
    { name: 'getLearningDisabledSentinel', ts: getLearningDisabledSentinel, cjs: cjsPaths.getLearningDisabledSentinel },
    { name: 'getWorkingMemoryDisabledSentinel', ts: getWorkingMemoryDisabledSentinel, cjs: cjsPaths.getWorkingMemoryDisabledSentinel },
    { name: 'getWorkingMemoryPath', ts: getWorkingMemoryPath, cjs: cjsPaths.getWorkingMemoryPath },
    { name: 'getBackupPath', ts: getBackupPath, cjs: cjsPaths.getBackupPath },
    { name: 'getPendingTurnsPath', ts: getPendingTurnsPath, cjs: cjsPaths.getPendingTurnsPath },
    { name: 'getPendingTurnsProcessingPath', ts: getPendingTurnsProcessingPath, cjs: cjsPaths.getPendingTurnsProcessingPath },
    { name: 'getPendingTurnsLockDir', ts: getPendingTurnsLockDir, cjs: cjsPaths.getPendingTurnsLockDir },
    { name: 'getFeaturesIndexPath', ts: getFeaturesIndexPath, cjs: cjsPaths.getFeaturesIndexPath },
    { name: 'getFeaturesDisabledSentinel', ts: getFeaturesDisabledSentinel, cjs: cjsPaths.getFeaturesDisabledSentinel },
    { name: 'getFeaturesLockDir', ts: getFeaturesLockDir, cjs: cjsPaths.getFeaturesLockDir },
    { name: 'getFeaturesLastRefreshPath', ts: getFeaturesLastRefreshPath, cjs: cjsPaths.getFeaturesLastRefreshPath },
    { name: 'getReviewsDir', ts: getReviewsDir, cjs: cjsPaths.getReviewsDir },
    { name: 'getDesignDir', ts: getDesignDir, cjs: cjsPaths.getDesignDir },
    { name: 'getResearchDir', ts: getResearchDir, cjs: cjsPaths.getResearchDir },
  ];

  for (const { name, ts, cjs } of functions) {
    it(`${name} — TypeScript and CJS agree`, () => {
      expect(cjs(ROOT)).toBe(ts(ROOT));
    });
  }

  it('getKnowledgePath — TypeScript and CJS agree', () => {
    expect(cjsPaths.getKnowledgePath(ROOT, 'my-feature')).toBe(getKnowledgePath(ROOT, 'my-feature'));
  });

  it('getHandoffPath — TypeScript and CJS agree', () => {
    expect(cjsPaths.getHandoffPath(ROOT, 'feat-branch')).toBe(getHandoffPath(ROOT, 'feat-branch'));
  });

  it('getGitignoreEntries — TypeScript and CJS agree', () => {
    expect(cjsPaths.getGitignoreEntries()).toEqual(getGitignoreEntries());
  });
});

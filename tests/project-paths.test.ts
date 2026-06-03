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
  getSidecarDir,
  getDecisionsDir,
  getFeaturesDir,
  getDocsDir,
  getDreamConfigPath,
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
  getLearningLockDir,
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
  getDevflowGitignoreContent,
} from '../src/cli/utils/project-paths.js';

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

    it('getSidecarDir returns .devflow/dream/ (deprecated alias)', () => {
      expect(getSidecarDir(ROOT)).toBe('/some/project/.devflow/dream');
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

    it('getSidecarConfigPath returns .devflow/dream/config.json (deprecated alias)', () => {
      expect(getSidecarConfigPath(ROOT)).toBe('/some/project/.devflow/dream/config.json');
    });
  });

  describe('decisions files', () => {
    it('getDecisionsFilePath returns .devflow/decisions/decisions.md', () => {
      expect(getDecisionsFilePath(ROOT)).toBe('/some/project/.devflow/decisions/decisions.md');
    });

    it('getPitfallsFilePath returns .devflow/decisions/pitfalls.md', () => {
      expect(getPitfallsFilePath(ROOT)).toBe('/some/project/.devflow/decisions/pitfalls.md');
    });

    it('getDecisionsDisabledSentinel returns .devflow/decisions/.disabled', () => {
      expect(getDecisionsDisabledSentinel(ROOT)).toBe('/some/project/.devflow/decisions/.disabled');
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

    it('getDecisionsRunsTodayPath returns .devflow/decisions/.decisions-runs-today', () => {
      expect(getDecisionsRunsTodayPath(ROOT)).toBe('/some/project/.devflow/decisions/.decisions-runs-today');
    });

    it('getDecisionsBatchIdsPath returns .devflow/decisions/.decisions-batch-ids', () => {
      expect(getDecisionsBatchIdsPath(ROOT)).toBe('/some/project/.devflow/decisions/.decisions-batch-ids');
    });
  });

  describe('learning files', () => {
    it('getLearningLogPath returns .devflow/learning/learning-log.jsonl', () => {
      expect(getLearningLogPath(ROOT)).toBe('/some/project/.devflow/learning/learning-log.jsonl');
    });

    it('getLearningConfigPath returns .devflow/learning/learning.json', () => {
      expect(getLearningConfigPath(ROOT)).toBe('/some/project/.devflow/learning/learning.json');
    });

    it('getLearningManifestPath returns .devflow/learning/.learning-manifest.json', () => {
      expect(getLearningManifestPath(ROOT)).toBe('/some/project/.devflow/learning/.learning-manifest.json');
    });

    it('getLearningNotifiedAtPath returns .devflow/learning/.learning-notified-at', () => {
      expect(getLearningNotifiedAtPath(ROOT)).toBe('/some/project/.devflow/learning/.learning-notified-at');
    });

    it('getLearningNotificationsPath returns .devflow/learning/.learning-notifications.json', () => {
      expect(getLearningNotificationsPath(ROOT)).toBe('/some/project/.devflow/learning/.learning-notifications.json');
    });

    it('getLearningRunsTodayPath returns .devflow/learning/.learning-runs-today', () => {
      expect(getLearningRunsTodayPath(ROOT)).toBe('/some/project/.devflow/learning/.learning-runs-today');
    });

    it('getLearningSessionCountPath returns .devflow/learning/.learning-session-count', () => {
      expect(getLearningSessionCountPath(ROOT)).toBe('/some/project/.devflow/learning/.learning-session-count');
    });

    it('getLearningBatchIdsPath returns .devflow/learning/.learning-batch-ids', () => {
      expect(getLearningBatchIdsPath(ROOT)).toBe('/some/project/.devflow/learning/.learning-batch-ids');
    });

    it('getLearningDisabledSentinel returns .devflow/memory/.learning-disabled', () => {
      expect(getLearningDisabledSentinel(ROOT)).toBe('/some/project/.devflow/memory/.learning-disabled');
    });

    it('getLearningLockDir returns .devflow/memory/.learning.lock', () => {
      expect(getLearningLockDir(ROOT)).toBe('/some/project/.devflow/memory/.learning.lock');
    });
  });

  describe('memory / working-memory files', () => {
    it('getWorkingMemoryDisabledSentinel returns .devflow/memory/.working-memory-disabled', () => {
      expect(getWorkingMemoryDisabledSentinel(ROOT)).toBe('/some/project/.devflow/memory/.working-memory-disabled');
    });

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

  describe('features / knowledge files', () => {
    it('getFeaturesIndexPath returns .devflow/features/index.json', () => {
      expect(getFeaturesIndexPath(ROOT)).toBe('/some/project/.devflow/features/index.json');
    });

    it('getKnowledgePath returns .devflow/features/{slug}/KNOWLEDGE.md', () => {
      expect(getKnowledgePath(ROOT, 'my-feature')).toBe('/some/project/.devflow/features/my-feature/KNOWLEDGE.md');
    });

    it('getFeaturesDisabledSentinel returns .devflow/features/.disabled', () => {
      expect(getFeaturesDisabledSentinel(ROOT)).toBe('/some/project/.devflow/features/.disabled');
    });

    it('getFeaturesLockDir returns .devflow/features/.knowledge.lock', () => {
      expect(getFeaturesLockDir(ROOT)).toBe('/some/project/.devflow/features/.knowledge.lock');
    });

    it('getFeaturesLastRefreshPath returns .devflow/features/.knowledge-last-refresh', () => {
      expect(getFeaturesLastRefreshPath(ROOT)).toBe('/some/project/.devflow/features/.knowledge-last-refresh');
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

    it('does not include old .memory/ entry', () => {
      expect(getGitignoreEntries()).not.toContain('.memory/');
    });
  });

  describe('getDevflowGitignoreContent', () => {
    it('includes dream/ instead of sidecar/', () => {
      const content = getDevflowGitignoreContent();
      expect(content).toContain('dream/');
      expect(content).not.toContain('sidecar/');
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
    { name: 'getSidecarDir', ts: getSidecarDir, cjs: cjsPaths.getSidecarDir },
    { name: 'getDecisionsDir', ts: getDecisionsDir, cjs: cjsPaths.getDecisionsDir },
    { name: 'getFeaturesDir', ts: getFeaturesDir, cjs: cjsPaths.getFeaturesDir },
    { name: 'getDocsDir', ts: getDocsDir, cjs: cjsPaths.getDocsDir },
    { name: 'getDreamConfigPath', ts: getDreamConfigPath, cjs: cjsPaths.getDreamConfigPath },
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
    { name: 'getLearningLockDir', ts: getLearningLockDir, cjs: cjsPaths.getLearningLockDir },
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

  it('getDevflowGitignoreContent — TypeScript and CJS agree', () => {
    expect(cjsPaths.getDevflowGitignoreContent()).toBe(getDevflowGitignoreContent());
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
});

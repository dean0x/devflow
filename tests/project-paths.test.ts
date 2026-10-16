/**
 * Tests for src/core/project-paths.ts (TypeScript module) and
 * src/assets/scripts/hooks/lib/project-paths.cjs (CJS counterpart).
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
  getLearningClaimOwnerPath,
  getDecisionsFilePath,
  getPitfallsFilePath,
  getCurateTuningConfigPath,
  getGlobalCurateTuningConfigPath,
  getDecisionsLedgerPath,
  getDecisionsLogPath,
  getDecisionsArchivePath,
  getDecisionsHistoryPath,
  getDecisionsLockDir,
  getDecisionsIndexPath,
  getWorkingMemoryPath,
  getBackupPath,
  getPendingTurnsPath,
  getPendingTurnsProcessingPath,
  getPendingTurnsLockDir,
  getReviewsDir,
  getDesignDir,
  getResearchDir,
  LEGACY_NAMES,
  CURATION_DIR_NAME,
  CURATION_TUNING_FILE_NAME,
  curationMoveMarkerKey,
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

    it('getLearningClaimOwnerPath returns .devflow/learning/.pending-turns.owner', () => {
      expect(getLearningClaimOwnerPath(ROOT)).toBe('/some/project/.devflow/learning/.pending-turns.owner');
    });
  });

  describe('learning content files', () => {
    it('getDecisionsFilePath returns .devflow/learning/decisions.md', () => {
      expect(getDecisionsFilePath(ROOT)).toBe('/some/project/.devflow/learning/decisions.md');
    });

    it('getPitfallsFilePath returns .devflow/learning/pitfalls.md', () => {
      expect(getPitfallsFilePath(ROOT)).toBe('/some/project/.devflow/learning/pitfalls.md');
    });

    it('getCurateTuningConfigPath returns .devflow/learning/learning.json', () => {
      expect(getCurateTuningConfigPath(ROOT)).toBe('/some/project/.devflow/learning/learning.json');
    });

    it('getDecisionsLogPath returns .devflow/learning/decisions-log.jsonl', () => {
      expect(getDecisionsLogPath(ROOT)).toBe('/some/project/.devflow/learning/decisions-log.jsonl');
    });

    it('getDecisionsHistoryPath returns .devflow/learning/decisions-history.jsonl', () => {
      expect(getDecisionsHistoryPath(ROOT)).toBe('/some/project/.devflow/learning/decisions-history.jsonl');
    });

    it('getDecisionsLockDir returns .devflow/learning/.decisions.lock', () => {
      expect(getDecisionsLockDir(ROOT)).toBe('/some/project/.devflow/learning/.decisions.lock');
    });

    it('getDecisionsIndexPath returns .devflow/learning/index.md', () => {
      expect(getDecisionsIndexPath(ROOT)).toBe('/some/project/.devflow/learning/index.md');
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
    { name: 'getLearningClaimOwnerPath', ts: getLearningClaimOwnerPath, cjs: cjsPaths.getLearningClaimOwnerPath },
    { name: 'getDecisionsFilePath', ts: getDecisionsFilePath, cjs: cjsPaths.getDecisionsFilePath },
    { name: 'getPitfallsFilePath', ts: getPitfallsFilePath, cjs: cjsPaths.getPitfallsFilePath },
    { name: 'getCurateTuningConfigPath', ts: getCurateTuningConfigPath, cjs: cjsPaths.getCurateTuningConfigPath },
    { name: 'getGlobalCurateTuningConfigPath', ts: getGlobalCurateTuningConfigPath, cjs: cjsPaths.getGlobalCurateTuningConfigPath },
    { name: 'getDecisionsLedgerPath', ts: getDecisionsLedgerPath, cjs: cjsPaths.getDecisionsLedgerPath },
    { name: 'getDecisionsLogPath', ts: getDecisionsLogPath, cjs: cjsPaths.getDecisionsLogPath },
    { name: 'getDecisionsArchivePath', ts: getDecisionsArchivePath, cjs: cjsPaths.getDecisionsArchivePath },
    { name: 'getDecisionsHistoryPath', ts: getDecisionsHistoryPath, cjs: cjsPaths.getDecisionsHistoryPath },
    { name: 'getDecisionsLockDir', ts: getDecisionsLockDir, cjs: cjsPaths.getDecisionsLockDir },
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
  // any future addition to one side without the other fails fast. The one
  // exception is named: the marker key is read by the TypeScript status and HUD
  // readers and written by the shell, so the CJS layer has no use for it.
  const TS_ONLY_FUNCTIONS = ['curationMoveMarkerKey'];
  it('TypeScript and CJS export the identical set of function names', () => {
    const tsNames = Object.keys(tsPathsNs)
      .filter(k => typeof (tsPathsNs as Record<string, unknown>)[k] === 'function')
      .filter(k => !TS_ONLY_FUNCTIONS.includes(k))
      .sort();
    const cjsNames = Object.keys(cjsPaths)
      .filter(k => typeof (cjsPaths as Record<string, unknown>)[k] === 'function')
      .sort();
    expect(cjsNames).toEqual(tsNames);
  });
});

// ---------------------------------------------------------------------------
// The rename's name blocks: the old names live in one frozen block per mirror,
// the new folder and tuning file names beside it. Nothing reads them yet.
// ---------------------------------------------------------------------------

describe('curation rename name blocks', () => {
  it('LEGACY_NAMES lists the old folder, backup prefix and tuning file, in both mirrors', () => {
    const expected = { folder: 'learning', backupPrefix: 'learning.backup-', tuningFile: 'learning.json' };
    expect(LEGACY_NAMES).toEqual(expected);
    expect(cjsPaths.LEGACY_NAMES).toEqual(expected);
  });

  it('LEGACY_NAMES is frozen in both mirrors, so no caller can rewrite an old name', () => {
    expect(Object.isFrozen(LEGACY_NAMES)).toBe(true);
    expect(Object.isFrozen(cjsPaths.LEGACY_NAMES)).toBe(true);
  });

  it('both mirrors name the curation folder and tuning file the same', () => {
    expect(CURATION_DIR_NAME).toBe('curation');
    expect(cjsPaths.CURATION_DIR_NAME).toBe(CURATION_DIR_NAME);
    expect(CURATION_TUNING_FILE_NAME).toBe('curation.json');
    expect(cjsPaths.CURATION_TUNING_FILE_NAME).toBe(CURATION_TUNING_FILE_NAME);
  });

  it('the global tuning-path helper joins the machine directory and the old tuning file name, in both mirrors', () => {
    const machineDir = '/home/dean/.devflow';
    expect(getGlobalCurateTuningConfigPath(machineDir)).toBe(path.join(machineDir, LEGACY_NAMES.tuningFile));
    expect(cjsPaths.getGlobalCurateTuningConfigPath(machineDir)).toBe(path.join(machineDir, LEGACY_NAMES.tuningFile));
  });

  it('the global tuning-path helper is separate from the project tuning-path helper', () => {
    expect(getGlobalCurateTuningConfigPath(ROOT)).toBe(path.join(ROOT, LEGACY_NAMES.tuningFile));
    expect(getGlobalCurateTuningConfigPath(ROOT)).not.toBe(getCurateTuningConfigPath(ROOT));
  });

  it('no path helper flips yet: the learning helpers still name the old folder', () => {
    expect(getLearningDir(ROOT)).toBe(path.join(ROOT, '.devflow', LEGACY_NAMES.folder));
    expect(getCurateTuningConfigPath(ROOT)).toBe(path.join(ROOT, '.devflow', LEGACY_NAMES.folder, LEGACY_NAMES.tuningFile));
  });
});

describe('curationMoveMarkerKey', () => {
  // Expected values come from an independent calculation (a 32-bit multiply-by-33
  // hash from 5381 over every UTF-8 byte, then the last 60 bytes with each byte
  // outside letters and digits replaced by an underscore), not from this module.
  it.each([
    ['/a', '005970b5__a'],
    ['/some/project', '9d1d3a6e__some_project'],
    ['/Users/dean/Sandbox/devflow-rename', 'dee293f6__Users_dean_Sandbox_devflow_rename'],
  ])('a root shorter than 60 bytes keeps all of its bytes: %s', (root, key) => {
    expect(curationMoveMarkerKey(root)).toBe(key);
  });

  it('a non-ASCII root hashes and replaces each UTF-8 byte, not each character', () => {
    expect(curationMoveMarkerKey('/tmp/ünï/projéct')).toBe('44e2d000__tmp___n___proj__ct');
  });

  it('a root longer than 60 bytes hashes the whole path but names only its last 60 bytes', () => {
    const root = `/${'x'.repeat(70)}/end`;
    expect(curationMoveMarkerKey(root)).toBe(`1db2baaa_${'x'.repeat(56)}_end`);
  });

  it('two roots that share their last 60 bytes still get different keys', () => {
    expect(curationMoveMarkerKey('/a/same/tail')).not.toBe(curationMoveMarkerKey('/b/same/tail'));
  });

  it('is safe to use as a file name: lowercase hex, an underscore, then letters, digits and underscores', () => {
    expect(curationMoveMarkerKey('/we ird/$(touch x)/"q"')).toMatch(/^[0-9a-f]{8}_[A-Za-z0-9_]{1,60}$/);
  });
});

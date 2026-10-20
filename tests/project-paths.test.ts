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
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

// Import TypeScript module (ESM)
import {
  getMemoryDir,
  getCurationDir,
  getFeaturesDir,
  getDocsDir,
  getFeatureConfigPath,
  getCurationPendingTurnsPath,
  getCurationPendingTurnsProcessingPath,
  getCurationClaimOwnerPath,
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
  MOVE_LOCK_PREFIX,
  MOVE_LOCK_SUFFIX,
  MOVE_JOURNAL_SUFFIX,
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

    it('getCurationDir returns .devflow/curation/', () => {
      expect(getCurationDir(ROOT)).toBe('/some/project/.devflow/curation');
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
    it('getCurationPendingTurnsPath returns .devflow/curation/.pending-turns.jsonl', () => {
      expect(getCurationPendingTurnsPath(ROOT)).toBe('/some/project/.devflow/curation/.pending-turns.jsonl');
    });

    it('getCurationPendingTurnsProcessingPath returns .devflow/curation/.pending-turns.processing', () => {
      expect(getCurationPendingTurnsProcessingPath(ROOT)).toBe('/some/project/.devflow/curation/.pending-turns.processing');
    });

    it('getCurationClaimOwnerPath returns .devflow/curation/.pending-turns.owner', () => {
      expect(getCurationClaimOwnerPath(ROOT)).toBe('/some/project/.devflow/curation/.pending-turns.owner');
    });
  });

  describe('learning content files', () => {
    it('getDecisionsFilePath returns .devflow/curation/decisions.md', () => {
      expect(getDecisionsFilePath(ROOT)).toBe('/some/project/.devflow/curation/decisions.md');
    });

    it('getPitfallsFilePath returns .devflow/curation/pitfalls.md', () => {
      expect(getPitfallsFilePath(ROOT)).toBe('/some/project/.devflow/curation/pitfalls.md');
    });

    it('getCurateTuningConfigPath returns .devflow/curation/curation.json', () => {
      expect(getCurateTuningConfigPath(ROOT)).toBe('/some/project/.devflow/curation/curation.json');
    });

    it('getDecisionsLogPath returns .devflow/curation/decisions-log.jsonl', () => {
      expect(getDecisionsLogPath(ROOT)).toBe('/some/project/.devflow/curation/decisions-log.jsonl');
    });

    it('getDecisionsHistoryPath returns .devflow/curation/decisions-history.jsonl', () => {
      expect(getDecisionsHistoryPath(ROOT)).toBe('/some/project/.devflow/curation/decisions-history.jsonl');
    });

    it('getDecisionsLockDir returns .devflow/curation/.decisions.lock', () => {
      expect(getDecisionsLockDir(ROOT)).toBe('/some/project/.devflow/curation/.decisions.lock');
    });

    it('getDecisionsIndexPath returns .devflow/curation/index.md', () => {
      expect(getDecisionsIndexPath(ROOT)).toBe('/some/project/.devflow/curation/index.md');
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
    { name: 'getCurationDir', ts: getCurationDir, cjs: cjsPaths.getCurationDir },
    { name: 'getFeaturesDir', ts: getFeaturesDir, cjs: cjsPaths.getFeaturesDir },
    { name: 'getDocsDir', ts: getDocsDir, cjs: cjsPaths.getDocsDir },
    { name: 'getFeatureConfigPath', ts: getFeatureConfigPath, cjs: cjsPaths.getFeatureConfigPath },
    { name: 'getCurationPendingTurnsPath', ts: getCurationPendingTurnsPath, cjs: cjsPaths.getCurationPendingTurnsPath },
    { name: 'getCurationPendingTurnsProcessingPath', ts: getCurationPendingTurnsProcessingPath, cjs: cjsPaths.getCurationPendingTurnsProcessingPath },
    { name: 'getCurationClaimOwnerPath', ts: getCurationClaimOwnerPath, cjs: cjsPaths.getCurationClaimOwnerPath },
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

  // TS/CJS parity: getCurationDir and getFeatureConfigPath return the correct paths
  it('getCurationDir returns .devflow/curation/ in both TS and CJS', () => {
    expect(getCurationDir(ROOT)).toBe('/some/project/.devflow/curation');
    expect(cjsPaths.getCurationDir(ROOT)).toBe('/some/project/.devflow/curation');
  });

  it('getFeatureConfigPath returns .devflow/config.json in both TS and CJS', () => {
    expect(getFeatureConfigPath(ROOT)).toBe('/some/project/.devflow/config.json');
    expect(cjsPaths.getFeatureConfigPath(ROOT)).toBe('/some/project/.devflow/config.json');
  });

  // Structural full-export parity: guards against silent drift where a function
  // is added to one module but not the other. The hardcoded list above only
  // covers enumerated functions; this asserts the COMPLETE export sets match so
  // any future addition to one side without the other fails fast. The
  // exceptions are named. The marker key is read by the TypeScript status and HUD
  // readers and written by the shell, so the CJS layer has no use for it. The move
  // lock and journal names sit under the machine directory, not under a project: the
  // store's write guard and the move module build them, and no TypeScript code does.
  const TS_ONLY_FUNCTIONS = ['curationMoveMarkerKey'];
  const CJS_ONLY_FUNCTIONS = ['curationMoveLockKey', 'curationMoveLockDir', 'curationMoveJournalPath'];
  it('TypeScript and CJS export the identical set of function names', () => {
    const tsNames = Object.keys(tsPathsNs)
      .filter(k => typeof (tsPathsNs as Record<string, unknown>)[k] === 'function')
      .filter(k => !TS_ONLY_FUNCTIONS.includes(k))
      .sort();
    const cjsNames = Object.keys(cjsPaths)
      .filter(k => typeof (cjsPaths as Record<string, unknown>)[k] === 'function')
      .filter(k => !CJS_ONLY_FUNCTIONS.includes(k))
      .sort();
    expect(cjsNames).toEqual(tsNames);
  });
});

// ---------------------------------------------------------------------------
// The rename's name blocks: the old names live in one frozen block per mirror,
// the new folder and tuning file names beside it.
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

  it('the global tuning-path helper joins the machine directory and the curation tuning file name, in both mirrors', () => {
    const machineDir = '/home/dean/.devflow';
    expect(getGlobalCurateTuningConfigPath(machineDir)).toBe(path.join(machineDir, CURATION_TUNING_FILE_NAME));
    expect(cjsPaths.getGlobalCurateTuningConfigPath(machineDir)).toBe(path.join(machineDir, CURATION_TUNING_FILE_NAME));
  });

  it('the global tuning-path helper is separate from the project tuning-path helper', () => {
    expect(getGlobalCurateTuningConfigPath(ROOT)).toBe(path.join(ROOT, CURATION_TUNING_FILE_NAME));
    expect(getGlobalCurateTuningConfigPath(ROOT)).not.toBe(getCurateTuningConfigPath(ROOT));
  });

  it('TP-3: the shell shim holds the same folder and tuning-file names as both mirrors', () => {
    const shim = path.join(__dirname, '..', 'src', 'assets', 'scripts', 'hooks', 'curation-move');
    const names = ['DF_CM_OLD_FOLDER', 'DF_CM_NEW_FOLDER', 'DF_CM_NEW_TUNING_FILE'];
    const res = spawnSync('/bin/bash', ['-c', 'source "$1"; df_curation_move_names; shift; for n in "$@"; do printf "%s\\n" "${!n}"; done', '_', shim, ...names], {
      encoding: 'utf-8',
      env: { PATH: '/nonexistent' },
    });

    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout.split('\n').slice(0, names.length)).toEqual([
      LEGACY_NAMES.folder,
      CURATION_DIR_NAME,
      CURATION_TUNING_FILE_NAME,
    ]);
    expect(cjsPaths.LEGACY_NAMES).toEqual(LEGACY_NAMES);
  });

  it('the project helpers name the curation folder and tuning file', () => {
    expect(getCurationDir(ROOT)).toBe(path.join(ROOT, '.devflow', CURATION_DIR_NAME));
    expect(getCurateTuningConfigPath(ROOT)).toBe(path.join(ROOT, '.devflow', CURATION_DIR_NAME, CURATION_TUNING_FILE_NAME));
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

describe('the machine-side move names (CJS only)', () => {
  const MACHINE = '/home/dean/.devflow';

  it('the key is the first 16 hex characters of the sha256 of the root path', () => {
    const key = cjsPaths.curationMoveLockKey('/some/ledger/root');
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(cjsPaths.curationMoveLockKey('/some/ledger/root')).toBe(key);
    expect(cjsPaths.curationMoveLockKey('/some/other/root')).not.toBe(key);
  });

  it('the lock directory and the journal file sit in the machine directory under one key', () => {
    const key = cjsPaths.curationMoveLockKey('/some/ledger/root');
    expect(cjsPaths.curationMoveLockDir(MACHINE, '/some/ledger/root')).toBe(`${MACHINE}/.curation-move-${key}.lock`);
    expect(cjsPaths.curationMoveJournalPath(MACHINE, '/some/ledger/root')).toBe(`${MACHINE}/.curation-move-${key}.journal`);
  });
});

// ---------------------------------------------------------------------------
// One source per name (ARCH-5): every helper builds its path from the name constants,
// and every shell site takes the folder names from the shim.
// ---------------------------------------------------------------------------

describe('one source per name', () => {
  const ROOT_DIR = path.join(__dirname, '..');
  const HOOKS = path.join(ROOT_DIR, 'src', 'assets', 'scripts', 'hooks');
  const MIRRORS = [
    ['src/core/project-paths.ts', path.join(ROOT_DIR, 'src', 'core', 'project-paths.ts')],
    ['hooks/lib/project-paths.cjs', path.join(HOOKS, 'lib', 'project-paths.cjs')],
  ] as const;
  const read = (file: string): string => fs.readFileSync(file, 'utf-8');

  /** The lines of `text` that hold `literal`, as `n: line`. */
  const linesWith = (text: string, literal: string): string[] =>
    text.split('\n').flatMap((line, i) => (line.includes(literal) ? [`${i + 1}: ${line.trim()}`] : []));

  for (const [label, file] of MIRRORS) {
    it(`${label}: the 'curation' literal stands only at CURATION_DIR_NAME`, () => {
      expect(linesWith(read(file), "'curation'")).toEqual([expect.stringMatching(/const CURATION_DIR_NAME = 'curation';$/)]);
    });

    it(`${label}: the 'curation.json' literal stands only at CURATION_TUNING_FILE_NAME`, () => {
      expect(linesWith(read(file), "'curation.json'")).toEqual([expect.stringMatching(/const CURATION_TUNING_FILE_NAME = 'curation\.json';$/)]);
    });

    it(`${label}: an old name stands only in the LEGACY_NAMES block, which keeps all three`, () => {
      expect(linesWith(read(file), "'learning")).toEqual([
        expect.stringContaining("folder: 'learning',"),
        expect.stringContaining("backupPrefix: 'learning.backup-',"),
        expect.stringContaining("tuningFile: 'learning.json',"),
      ]);
    });
  }

  it('the move lock and journal names are the same in both mirrors, and uninstall holds no copy of the prefix', () => {
    expect([MOVE_LOCK_PREFIX, MOVE_LOCK_SUFFIX, MOVE_JOURNAL_SUFFIX]).toEqual(['.curation-move-', '.lock', '.journal']);
    expect([cjsPaths.MOVE_LOCK_PREFIX, cjsPaths.MOVE_LOCK_SUFFIX, cjsPaths.MOVE_JOURNAL_SUFFIX]).toEqual([MOVE_LOCK_PREFIX, MOVE_LOCK_SUFFIX, MOVE_JOURNAL_SUFFIX]);
    const uninstallCode = read(path.join(ROOT_DIR, 'src', 'cli', 'commands', 'uninstall.ts'))
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');
    expect(linesWith(uninstallCode, 'curation-move-'), 'non-vacuity: the scan reads code').toEqual([]);
    expect(uninstallCode).toContain('MOVE_LOCK_PREFIX');
  });

  describe('the shell sites that apply the creator rule', () => {
    const SITES = ['queue-append', 'ensure-devflow-init', 'session-start-context'] as const;
    /** The code lines (no comments) that name a ledger folder: the creator calls, the queue names and the folder variable. */
    const folderLines = (text: string): string[] =>
      text.split('\n').filter((line) => !/^\s*#/.test(line) && /\b(df_ledger_folder|df_ledger_queue|df_make_ledger_folder)\b|_qar_(old|new)=|^CURATION_DIR=/.test(line));

    for (const name of SITES) {
      it(`${name} takes the folder names from the shim and holds no bare folder literal`, () => {
        const text = read(path.join(HOOKS, name));
        const lines = folderLines(text);
        expect(lines.length, 'non-vacuity: the scan finds the sites').toBeGreaterThanOrEqual(2);
        for (const line of lines) expect(line, line).not.toMatch(/\b(learning|curation)\b/);
        expect(text).toMatch(/\bdf_curation_move_names\b/);
        expect(text).toMatch(/\$DF_CM_NEW_FOLDER|"\$DF_CM_NEW_FOLDER"/);
      });
    }
  });

  it('every name the shim sets is read by some hook', () => {
    const shim = read(path.join(HOOKS, 'curation-move'));
    const set = [...shim.matchAll(/^ {2}(DF_CM_[A-Z_]+)=/gm)].map((m) => m[1]);
    expect(set.length, 'non-vacuity: the shim sets names').toBeGreaterThan(0);
    const hookFiles = fs.readdirSync(HOOKS).filter((f) => fs.statSync(path.join(HOOKS, f)).isFile());
    for (const variable of set) {
      const readers = hookFiles.flatMap((f) =>
        read(path.join(HOOKS, f)).split('\n').filter((line) => !/^\s*#/.test(line) && (line.includes(`$${variable}`) || line.includes(`\${${variable}`))),
      );
      expect(readers, `${variable} is set and never read`).not.toEqual([]);
    }
  });
});

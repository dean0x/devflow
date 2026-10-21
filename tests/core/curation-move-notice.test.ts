/**
 * The move notice: what the statusline and `devflow curation --status` print for a
 * project whose ledger still sits in the old folder, and where the shell shim's refusal
 * marker for that project stands. One core module holds both, so the HUD and the CLI
 * say the same words and name the same file (the shim's own copy is pinned in
 * tests/shell-hooks.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  describeMoveNotice,
  formatMoveNotice,
  gatherMoveNotice,
  getCurationMoveMarkerPath,
} from '../../src/core/curation-move-notice.js';
import { MOVE_SKIP_NOTICE, isMoveSkipReason } from '../../src/core/curation-move-skip.js';
import { curationMoveMarkerKey } from '../../src/core/project-paths.js';

describe('getCurationMoveMarkerPath', () => {
  it('is the refusal marker under the home directory, named by the root key', () => {
    expect(getCurationMoveMarkerPath('/home/dean', '/work/project')).toBe(
      path.join('/home/dean', '.devflow', 'logs', `curation-move.${curationMoveMarkerKey('/work/project')}.skip`),
    );
  });

  it('names the refusal marker with the file suffix skip, and the skip markers by the same key', () => {
    const key = curationMoveMarkerKey('/work/project');
    expect(getCurationMoveMarkerPath('/home/dean', '/work/project', 'tracked')).toBe(
      path.join('/home/dean', '.devflow', 'logs', `curation-move.${key}.tracked`),
    );
    expect(getCurationMoveMarkerPath('/home/dean', '/work/project', 'unknown')).toBe(
      path.join('/home/dean', '.devflow', 'logs', `curation-move.${key}.unknown`),
    );
    expect(getCurationMoveMarkerPath('/home/dean', '/work/project', 'refused')).toBe(getCurationMoveMarkerPath('/home/dean', '/work/project'));
  });

  it('keeps a short root and a non-ASCII root distinct, each under its own key', () => {
    const short = getCurationMoveMarkerPath('/h', '/a');
    const unicode = getCurationMoveMarkerPath('/h', '/tmp/ünï/projéct');
    expect(short).toBe(path.join('/h', '.devflow', 'logs', 'curation-move.' + curationMoveMarkerKey('/a') + '.skip'));
    expect(unicode).toBe(path.join('/h', '.devflow', 'logs', 'curation-move.44e2d000__tmp___n___proj__ct.skip'));
    expect(short).not.toBe(unicode);
  });
});

describe('gatherMoveNotice', () => {
  let base: string;
  let root: string;
  let home: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'move-notice-')));
    root = path.join(base, 'project');
    home = path.join(base, 'home');
    fs.mkdirSync(root);
    fs.mkdirSync(path.join(home, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  const seedOld = (): void => fs.mkdirSync(path.join(root, '.devflow', 'learning'), { recursive: true });

  it('is null when the project has no old ledger folder, whatever the marker says', () => {
    fs.writeFileSync(getCurationMoveMarkerPath(home, root), '');
    expect(gatherMoveNotice(root, home)).toBeNull();
  });

  it('is the pointer when the old folder stands and no marker does', () => {
    seedOld();
    expect(gatherMoveNotice(root, home)).toBe('pointer');
  });

  it('is refused when the shim left its marker for this root', () => {
    seedOld();
    fs.writeFileSync(getCurationMoveMarkerPath(home, root), '');
    expect(gatherMoveNotice(root, home)).toBe('refused');
  });

  it('a marker that is a link still counts: it is looked at, never followed', () => {
    seedOld();
    fs.symlinkSync(path.join(base, 'nowhere'), getCurationMoveMarkerPath(home, root));
    expect(gatherMoveNotice(root, home)).toBe('refused');
  });

  it('a busy marker is not a refusal', () => {
    seedOld();
    fs.writeFileSync(getCurationMoveMarkerPath(home, root).replace(/\.skip$/, '.busy'), '');
    expect(gatherMoveNotice(root, home)).toBe('pointer');
  });

  it.each(['tracked', 'unknown'] as const)('is %s when the shim left that skip marker for this root', (reason) => {
    seedOld();
    fs.writeFileSync(getCurationMoveMarkerPath(home, root, reason), '');
    expect(gatherMoveNotice(root, home)).toBe(reason);
  });

  it('prefers the tracked marker, then the unknown one, then the refusal marker', () => {
    seedOld();
    fs.writeFileSync(getCurationMoveMarkerPath(home, root), '');
    expect(gatherMoveNotice(root, home)).toBe('refused');
    fs.writeFileSync(getCurationMoveMarkerPath(home, root, 'unknown'), '');
    expect(gatherMoveNotice(root, home)).toBe('unknown');
    fs.writeFileSync(getCurationMoveMarkerPath(home, root, 'tracked'), '');
    expect(gatherMoveNotice(root, home)).toBe('tracked');
  });

  it('a skip marker with no old folder says nothing', () => {
    fs.writeFileSync(getCurationMoveMarkerPath(home, root, 'tracked'), '');
    expect(gatherMoveNotice(root, home)).toBeNull();
  });

  it('a skip marker that is a link still counts: it is looked at, never followed', () => {
    seedOld();
    fs.symlinkSync(path.join(base, 'nowhere'), getCurationMoveMarkerPath(home, root, 'tracked'));
    expect(gatherMoveNotice(root, home)).toBe('tracked');
  });

  it('a marker of another root is not this root\'s', () => {
    seedOld();
    fs.writeFileSync(getCurationMoveMarkerPath(home, path.join(base, 'other')), '');
    expect(gatherMoveNotice(root, home)).toBe('pointer');
  });
});

describe('formatMoveNotice', () => {
  it('puts the entry counts before the notice on the same line', () => {
    expect(formatMoveNotice('tracked', '2 decisions, 1 pitfall')).toBe(
      'Curation: 2 decisions, 1 pitfall; move skipped, git tracks files in the .devflow data folders',
    );
    expect(formatMoveNotice('unknown', '1 pitfall')).toBe('Curation: 1 pitfall; move skipped, git did not answer');
  });

  it('prints the pointer and the refused line, each on one line that starts "Curation: "', () => {
    expect(formatMoveNotice('pointer')).toBe('Curation: run devflow init, or open Claude Code in this project after it');
    expect(formatMoveNotice('refused')).toBe('Curation: move refused, see the hook log');
  });

  it('prints a skipped move on one short line that names the folders or the reason', () => {
    expect(formatMoveNotice('tracked')).toBe('Curation: move skipped, git tracks files in the .devflow data folders');
    expect(formatMoveNotice('unknown')).toBe('Curation: move skipped, git did not answer');
  });
});

describe('describeMoveNotice', () => {
  it('is the HUD line for the pointer and the refused line', () => {
    expect(describeMoveNotice('pointer')).toBe(formatMoveNotice('pointer'));
    expect(describeMoveNotice('refused')).toBe(formatMoveNotice('refused'));
  });

  it.each(['tracked', 'unknown'] as const)('is the whole fixed notice for a move skipped for %s', (reason) => {
    expect(describeMoveNotice(reason)).toBe(`Curation: ${MOVE_SKIP_NOTICE[reason]}`);
  });
});

describe('MOVE_SKIP_NOTICE', () => {
  it('says what happened, how to find the files and what to do, in the fixed words', () => {
    expect(MOVE_SKIP_NOTICE.tracked).toBe(
      'devflow did not move the curation data of this project from .devflow/learning/ to .devflow/curation/, '
      + 'because git tracks files in a curation data folder. '
      + 'To find them, run `git ls-files .devflow`. '
      + 'Untrack them with `git rm --cached <file>`, and delete them if you did not make them. '
      + 'Run these commands in the checkout that holds these folders.',
    );
    expect(MOVE_SKIP_NOTICE.unknown).toBe(
      'devflow did not move the curation data of this project from .devflow/learning/ to .devflow/curation/, '
      + 'because git did not answer. '
      + 'The move runs again at the next session start or the next init. '
      + 'If this notice stays, check that git runs in this project.',
    );
  });
});

describe('isMoveSkipReason', () => {
  it('is true for each reason that has a notice and false for everything else', () => {
    expect(Object.keys(MOVE_SKIP_NOTICE).every(isMoveSkipReason)).toBe(true);
    for (const other of ['pointer', 'refused', 'git-root-timed-out', 'toString', '__proto__', '', 'Tracked', null, undefined, 7, {}]) {
      expect(isMoveSkipReason(other), String(other)).toBe(false);
    }
  });
});

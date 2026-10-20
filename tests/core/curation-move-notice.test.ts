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
  formatMoveNotice,
  gatherMoveNotice,
  getCurationMoveMarkerPath,
} from '../../src/core/curation-move-notice.js';
import { curationMoveMarkerKey } from '../../src/core/project-paths.js';

describe('getCurationMoveMarkerPath', () => {
  it('is the refusal marker under the home directory, named by the root key', () => {
    expect(getCurationMoveMarkerPath('/home/dean', '/work/project')).toBe(
      path.join('/home/dean', '.devflow', 'logs', `curation-move.${curationMoveMarkerKey('/work/project')}.skip`),
    );
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

  it('a marker of another root is not this root\'s', () => {
    seedOld();
    fs.writeFileSync(getCurationMoveMarkerPath(home, path.join(base, 'other')), '');
    expect(gatherMoveNotice(root, home)).toBe('pointer');
  });
});

describe('formatMoveNotice', () => {
  it('prints the pointer and the refused line, each on one line that starts "Curation: "', () => {
    expect(formatMoveNotice('pointer')).toBe('Curation: run devflow init, or open Claude Code in this project after it');
    expect(formatMoveNotice('refused')).toBe('Curation: move refused, see the hook log');
  });
});

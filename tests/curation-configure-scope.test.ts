/**
 * `devflow curation --configure` offers a project and a global scope for the
 * Curate model. D-LEARNING-MODEL-PRECEDENCE puts a `devflow agents` Curate
 * mapping between the project file and the global file, so choosing Global does
 * nothing for a user who has such a mapping. The hint has to say so, or the
 * Global option is silently ineffective for them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The project scope of --configure, run for real on a temp project. The prompts, the
// ledger root, the version-skew gate and the move are the only things stubbed: the
// move answers as a finished one, so a test can put the old folder back after it.
vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
  note: vi.fn(),
  confirm: vi.fn(async () => false),
  select: vi.fn(async () => 'cancel'),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

vi.mock('../src/core/ledger-root.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/ledger-root.js')>()),
  getLedgerRoot: vi.fn(),
}));

vi.mock('../src/targets/claude-code/curation-install.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/targets/claude-code/curation-install.js')>()),
  installedScriptsSkew: vi.fn(async () => null),
}));

vi.mock('../src/cli/commands/curation-move-io.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/cli/commands/curation-move-io.js')>()),
  runSharedMove: vi.fn(),
}));

import * as p from '@clack/prompts';
import { getLedgerRoot } from '../src/core/ledger-root.js';
import { runSharedMove } from '../src/cli/commands/curation-move-io.js';
import { CONFIGURE_SCOPE_OPTIONS, curateModelOptions, curationCommand } from '../src/cli/commands/curation.js';
import { CURATION_DIR_NAME, LEGACY_NAMES } from '../src/core/project-paths.js';
import { AGENT_CONFIG } from './fixtures/agent-config.js';

describe('devflow curation --configure scope options', () => {
  const hintOf = (value: string): string => {
    const option = CONFIGURE_SCOPE_OPTIONS.find(o => o.value === value);
    if (option === undefined) throw new Error(`no ${value} scope option`);
    return option.hint;
  };

  it('offers the project and global scopes, in that order', () => {
    expect(CONFIGURE_SCOPE_OPTIONS.map(o => o.value)).toEqual(['project', 'global']);
  });

  it('the Global hint still names the file it writes', () => {
    expect(hintOf('global')).toContain('~/.devflow/curation.json');
  });

  it('the Global hint says a devflow agents Curate mapping takes precedence over the global file', () => {
    const hint = hintOf('global');
    expect(hint).toContain('devflow agents');
    expect(hint).toMatch(/Curate mapping/);
    expect(hint).toMatch(/takes precedence/);
  });

  it('the Project hint is unchanged: a project file outranks the mapping', () => {
    expect(hintOf('project')).toBe('This project only (.devflow/curation/curation.json)');
  });
});

/**
 * `devflow curation --configure` recommends the model the Curate agent ships with
 * (D-LEARNING-SHIPPED-ROW). The recommendation is derived from the shipped row, so a
 * change of the shipped tier moves it without an edit here.
 */
describe('devflow curation --configure model options', () => {
  const recommended = (shipped: string | undefined): string[] =>
    curateModelOptions(shipped).filter(o => o.hint.startsWith('Recommended')).map(o => o.value);

  it('offers opus, sonnet and haiku, in that order', () => {
    expect(curateModelOptions('opus').map(o => o.value)).toEqual(['opus', 'sonnet', 'haiku']);
  });

  it('recommends exactly the shipped model, whichever of the three it is', () => {
    expect(recommended('opus')).toEqual(['opus']);
    expect(recommended('sonnet')).toEqual(['sonnet']);
    expect(recommended('haiku')).toEqual(['haiku']);
  });

  it('recommends nothing when the shipped model is none of the three, or unknown', () => {
    expect(recommended('gpt-5.6-sol')).toEqual([]);
    expect(recommended(undefined)).toEqual([]);
  });

  it('recommends the model of the Curate row in the agent-config table', () => {
    expect(recommended(AGENT_CONFIG.curate.model)).toEqual([AGENT_CONFIG.curate.model]);
  });

  it('keeps the wording an unrecommended option has always had', () => {
    const hints = Object.fromEntries(curateModelOptions('opus').map(o => [o.value, o.hint]));
    expect(hints).toEqual({
      opus: 'Recommended — highest quality for detection + curation judgment',
      sonnet: 'Good balance of quality and speed',
      haiku: 'Fastest, lowest cost',
    });
  });
});

/**
 * The project scope of --configure writes into the folder it checked. The move has
 * run (prepareToWrite) when the write starts, and a folder of the old name can stand
 * again by then, so the writer looks once more: where the old name is present it
 * writes nothing and says the move is not done, and otherwise it makes only the new
 * folder, after checking `.devflow`, that folder and the file for links.
 */
describe('devflow curation --configure writes only into the folder it checked', () => {
  const KEEP = 'a file outside the project\n';
  let root: string;
  let outside: string;

  /** Answer the wizard: Sonnet, no debug logging, Project scope. */
  const configureProject = async (): Promise<{ error: string; exitCode: number | string | null | undefined }> => {
    (curationCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
    vi.mocked(p.select).mockResolvedValueOnce('sonnet').mockResolvedValueOnce('project');
    vi.mocked(p.confirm).mockResolvedValueOnce(false);
    vi.mocked(p.log.error).mockClear();
    await curationCommand.parseAsync(['--configure'], { from: 'user' });
    return {
      error: vi.mocked(p.log.error).mock.calls.map(call => String(call[0])).join('\n'),
      exitCode: process.exitCode,
    };
  };

  /** Every path under `dir` with its file text, so two trees compare equal only when nothing changed. */
  const treeOf = (dir: string): string[] =>
    (fs.readdirSync(dir, { recursive: true, encoding: 'utf-8' }) as string[]).sort().map(rel => {
      const full = path.join(dir, rel);
      return fs.lstatSync(full).isFile() ? `${rel}=${fs.readFileSync(full, 'utf-8')}` : rel;
    });

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'configure-scope-root-')));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'configure-scope-outside-')));
    process.exitCode = 0;
    vi.mocked(getLedgerRoot).mockResolvedValue(root);
    vi.mocked(runSharedMove).mockResolvedValue({ kind: 'unchanged', root, sweep: null });
  });

  afterEach(() => {
    process.exitCode = 0;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('(a) the old folder stands again after the move: nothing is written, and the busy line prints', async () => {
    const old = path.join(root, '.devflow', LEGACY_NAMES.folder);
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'decisions.md'), 'an old decision\n');
    const before = treeOf(root);

    const run = await configureProject();

    expect(vi.mocked(runSharedMove), 'non-vacuity: the move ran first').toHaveBeenCalledTimes(1);
    expect(run.error).toMatch(/moving this project's curation data/);
    expect(run.error).toMatch(/try again/i);
    expect(run.exitCode).toBe(1);
    expect(treeOf(root), 'the old folder is as it was, and no new folder is made').toEqual(before);
    expect(fs.existsSync(path.join(root, '.devflow', CURATION_DIR_NAME))).toBe(false);
  });

  it('(b) a linked curation folder: the write is refused, and nothing is written where it points', async () => {
    fs.writeFileSync(path.join(outside, 'curation.json'), KEEP);
    fs.mkdirSync(path.join(root, '.devflow'));
    fs.symlinkSync(outside, path.join(root, '.devflow', CURATION_DIR_NAME));

    const run = await configureProject();

    expect(run.error).toContain(`${path.join(root, '.devflow', CURATION_DIR_NAME)} is a symbolic link`);
    expect(run.exitCode).toBe(1);
    expect(fs.readdirSync(outside), 'nothing is added where the link points').toEqual(['curation.json']);
    expect(fs.readFileSync(path.join(outside, 'curation.json'), 'utf-8')).toBe(KEEP);
  });

  it('with no old folder it makes the new folder and writes the config there', async () => {
    const run = await configureProject();

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.devflow', CURATION_DIR_NAME, 'curation.json'), 'utf-8'))).toEqual({ model: 'sonnet', debug: false });
    expect(fs.existsSync(path.join(root, '.devflow', LEGACY_NAMES.folder))).toBe(false);
  });
});

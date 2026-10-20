/**
 * CHANGELOG guard for the curation rename (TP-23, TP-24).
 *
 * The release that renames the feature to curation carries one upgrade
 * entry, headed "Upgrade notes — Curation rename". The entry must state every
 * item the plan lists (the renamed names, the breaking change, the migration,
 * the upgrade, downgrade and re-upgrade effects, the machine-switch rule, the
 * manual steps, the backup and its delete step, the residuals, the queue cap and
 * the mixed-version advice). The released 3.6.0 text stays byte for byte, and the
 * entry carries a statement that supersedes it.
 *
 * The entry is found by its heading, never by the Unreleased label, so the guard
 * keeps passing after the release bump renames `## [Unreleased]` to `## [3.8.0]`.
 * The bump is simulated on a copy, and each check is shown to fail on seeded
 * known-bad input, so a guard that stops seeing its subject fails instead of
 * passing vacuously.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import { CURATION_DIR_NAME, CURATION_TUNING_FILE_NAME, LEGACY_NAMES } from '../../src/core/project-paths.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CHANGELOG = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

const ENTRY_HEADING = '### Upgrade notes — Curation rename';
const LINT_PACK_HEADING = '### Upgrade notes — Lint pack';
const FIRST_CURATION_VERSION: readonly [number, number, number] = [3, 8, 0];

/** The released 3.6.0 section, from its heading to its last line (the closing `---` rule and blank lines are not counted). */
const RELEASED_360_BYTES = 8294;
const RELEASED_360_SHA256 = '3ebbc6b25c96f3f98adf20992cc4e3e1196a87281ec85284a1c8ff2bb5e9f2f7';

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

interface ReleaseSection {
  readonly label: string;
  readonly text: string;
}

/** Splits the changelog at its `## [` headings. */
function releaseSections(changelog: string): ReleaseSection[] {
  const heads = [...changelog.matchAll(/^## \[([^\]]+)\][^\n]*$/gm)];
  return heads.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < heads.length ? (heads[index + 1].index ?? changelog.length) : changelog.length;
    return { label: match[1], text: changelog.slice(start, end) };
  });
}

function parseVersion(label: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(label);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(version: readonly number[], floor: readonly number[]): boolean {
  for (let i = 0; i < floor.length; i += 1) {
    if (version[i] !== floor[i]) return version[i] > floor[i];
  }
  return true;
}

/** The entry body: from its heading to the next `### ` or `## ` heading. */
function entryOf(section: ReleaseSection): string | null {
  const start = section.text.indexOf(ENTRY_HEADING);
  if (start === -1) return null;
  const rest = section.text.slice(start + ENTRY_HEADING.length);
  const next = rest.search(/^#{2,3} /m);
  return ENTRY_HEADING + (next === -1 ? rest : rest.slice(0, next));
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Every item the plan's content rules list, each with the patterns that prove the entry states it. */
const CHECKLIST: ReadonlyArray<{ readonly item: string; readonly patterns: readonly RegExp[] }> = [
  { item: 'renamed command', patterns: [/`devflow learning`[^\n]*`devflow curation`/] },
  { item: 'renamed init flags', patterns: [/`devflow init --curation` and `--no-curation`/, /`devflow init --learning` and `--no-learning`/] },
  { item: 'renamed machine key', patterns: [/`features\.curation`/, /`features\.learning`/] },
  { item: 'renamed folder', patterns: [/`\.devflow\/learning\/`[^\n]*`\.devflow\/curation\/`/] },
  { item: 'renamed tuning file', patterns: [/`learning\.json`[^\n]*`curation\.json`/] },
  { item: 'renamed settings line field', patterns: [/`LEARNING=`[^\n]*`CURATION=`/] },
  { item: 'renamed prompt marker and off tree', patterns: [/<!-- curation:on -->/, /`dist\/curation-off\/`/] },
  { item: 'kept names', patterns: [/`self-learning:`/, /`apply-decisions`/] },
  { item: 'breaking change', patterns: [/breaking change/i, /unknown command or option error/, /exit code is 1/] },
  { item: 'no alias', patterns: [/no alias/i] },
  { item: 'init migration', patterns: [/`devflow init` moves/, /Entry IDs do not change/] },
  { item: 'session start move', patterns: [/session start hook makes the same move/] },
  { item: 'both-folder rule', patterns: [/both folders/, /has a non-empty log, it wins/, /never merges one ledger into the other/] },
  { item: 'manifest heal', patterns: [/first `devflow` command/, /heals `~\/\.devflow\/manifest\.json`/, /both `features\.curation` and `features\.learning`/] },
  { item: 'upgrade effect', patterns: [/Upgrade: run `devflow init`/] },
  { item: 'downgrade effect', patterns: [/Downgrade to 3\.7/, /mirror key `features\.learning`/] },
  { item: 're-upgrade effect', patterns: [/Re-upgrade to 3\.8/, /stay in the backup only/] },
  { item: 'machine switch off on disagreement', patterns: [/disagree, the switch is off/, /`devflow curation --enable`/, /writes both keys/] },
  { item: 'toggles under version skew', patterns: [/`--disable` write both keys\s+and move nothing/, /Only `--disable` drains the queue/] },
  { item: '3.7 toggle during a downgrade', patterns: [/A 3\.7 toggle writes only the old key/, /stays off until you run `devflow curation --enable`/] },
  { item: 'backup location', patterns: [/\.devflow\/learning\.backup-<stamp>-<8 hex>/, /one folder for each move/] },
  { item: 'backup delete step', patterns: [/Delete a backup folder only when `devflow curation --status` shows 0 pending rows/] },
  { item: 'backup deletion rule', patterns: [/No devflow command deletes a backup, except `devflow uninstall`/, /after you confirm/, /`devflow curation --reset` and `devflow curation --clear` leave the backup in place/] },
  { item: 'status counts backup rows', patterns: [/`Backup:` line/, /pending rows/] },
  { item: 'queue cap', patterns: [/fills a pending queue up to 100 lines and no further/, /never causes a trim/, /overflow files/, /Status counts them as pending rows/, /newest 100 lines/] },
  { item: 'busy outcome', patterns: [/Busy:/, /Wait a moment, then run the command again/] },
  { item: 'refused outcome', patterns: [/Refused:/, /Remove the cause/] },
  { item: 'pointer outcome', patterns: [/Not yet moved:/, /do not read the old folder/] },
  { item: 'failed outcome', patterns: [/Failed:/, /The next init tries again/] },
  { item: 'reach residual', patterns: [/Reach:/, /neither `devflow init` nor a Claude Code session reaches/] },
  { item: 'linked worktree leftovers', patterns: [/Linked worktrees:/, /Delete that leftover folder by hand/] },
  { item: 'first session latency', patterns: [/First session:/, /short delay/] },
  { item: 'mixed-version advice', patterns: [/Mixed-version teams/, /Keep the old key in committed files, or set both keys, until every team member runs 3\.8/] },
  { item: 'manual steps', patterns: [/What you must do:/, /Run `devflow init` after you update/] },
  { item: 'superseding statement', patterns: [/Superseding statement for 3\.6\.0/, /no longer true/, /3\.6\.0 text stays as released/] },
];

function missingItems(entry: string): string[] {
  return CHECKLIST
    .filter(({ patterns }) => patterns.some(pattern => !pattern.test(entry)))
    .map(({ item }) => item);
}

/** Why the entry sits in the wrong place, or null when its place is right. */
function placementProblem(changelog: string): string | null {
  const sections = releaseSections(changelog);
  const holders = sections.filter(section => entryOf(section) !== null);
  if (holders.length !== 1) return `the entry must appear in exactly one release section, found ${holders.length}`;
  const [holder] = holders;
  if (holder.label !== 'Unreleased') {
    const version = parseVersion(holder.label);
    if (version === null || !atLeast(version, FIRST_CURATION_VERSION)) {
      return `the entry sits under ${holder.label}, a version below 3.8.0`;
    }
  }
  if (changelog.split(ENTRY_HEADING).length !== 2) return 'the entry heading appears more than once';
  const firstHeading = /^### .*$/m.exec(holder.text);
  if (firstHeading === null || firstHeading[0] !== ENTRY_HEADING) {
    return 'the entry is not the first upgrade heading of its section';
  }
  const lintPack = holder.text.indexOf(LINT_PACK_HEADING);
  if (lintPack !== -1 && lintPack < holder.text.indexOf(ENTRY_HEADING)) {
    return 'the entry sits below the lint-pack upgrade notes';
  }
  return null;
}

/** Why the released 3.6.0 text changed, or null when it is byte for byte as released. */
function releasedTextProblem(changelog: string): string | null {
  const section = releaseSections(changelog).find(candidate => candidate.label === '3.6.0');
  if (section === undefined) return 'the 3.6.0 section is missing';
  const text = section.text.replace(/\s*(\n---)?\s*$/, '');
  if (Buffer.byteLength(text, 'utf8') !== RELEASED_360_BYTES) return 'the 3.6.0 text changed length';
  if (sha256(text) !== RELEASED_360_SHA256) return 'the 3.6.0 text changed';
  return null;
}

/** The release bump renames the Unreleased heading in place (scripts/bump-version.ts). */
function withReleaseBump(changelog: string): string {
  return changelog.replace('## [Unreleased]', '## [3.8.0] - 2026-11-01');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** The blank-line block of the entry that opens with `lead`, its line breaks folded to spaces. */
function blockOf(entry: string, lead: string): string {
  const block = entry.split(/\n\n+/).find(part => part.startsWith(lead))
  return (block ?? '').replace(/\s+/g, ' ')
}

/** The release section that holds the entry, and the entry's text. */
function currentEntry(): string {
  return entryOf(releaseSections(CHANGELOG).find(section => entryOf(section) !== null) ?? { label: '', text: '' }) ?? ''
}

describe('CHANGELOG curation rename entry', () => {
  const entry = entryOf(releaseSections(CHANGELOG).find(section => entryOf(section) !== null) ?? { label: '', text: '' });

  it('has the entry', () => {
    expect(entry, `CHANGELOG.md has no "${ENTRY_HEADING}" heading`).not.toBeNull();
  });

  it('states every item the plan lists', () => {
    expect(missingItems(entry ?? '')).toEqual([]);
  });

  it('sits first under Unreleased or under 3.8.0 or later, above the lint-pack notes', () => {
    expect(placementProblem(CHANGELOG)).toBeNull();
  });

  it('keeps the released 3.6.0 text byte for byte', () => {
    expect(releasedTextProblem(CHANGELOG)).toBeNull();
    const section = releaseSections(CHANGELOG).find(candidate => candidate.label === '3.6.0');
    expect(section?.text).toContain('`features.learning`, `.devflow/learning/` and the learning ops do not change.');
  });

  it('names the folder and tuning file the code uses, old and new', () => {
    expect(entry).toContain(`.devflow/${LEGACY_NAMES.folder}/`);
    expect(entry).toContain(`.devflow/${CURATION_DIR_NAME}/`);
    expect(entry).toContain(`\`${LEGACY_NAMES.tuningFile}\``);
    expect(entry).toContain(`\`${CURATION_TUNING_FILE_NAME}\``);
    expect(entry).toContain(`.devflow/${LEGACY_NAMES.backupPrefix}<stamp>-<8 hex>`);
  });

  it('quotes the messages the built CLI and HUD print', () => {
    const initMove = readFileSync(path.join(ROOT, 'src/cli/commands/curation-move-step.ts'), 'utf8');
    const curation = readFileSync(path.join(ROOT, 'src/cli/commands/curation.ts'), 'utf8');
    const notice = readFileSync(path.join(ROOT, 'src/core/curation-move-notice.ts'), 'utf8');
    for (const quoted of ['Ledger move skipped for', 'Ledger move refused for', 'Ledger move failed for']) {
      expect(entry).toContain(quoted);
      expect(initMove).toContain(quoted);
    }
    expect(entry).toContain("Another run is moving this project's curation data.");
    expect(curation).toContain("Another run is moving this project's curation data.");
    for (const quoted of [
      'Curation: move refused, see the hook log',
      'Curation: run devflow init, or open Claude Code in this project after it',
    ]) {
      expect(entry).toContain(quoted);
      expect(notice).toContain(quoted.replace(/^Curation: /, ''));
    }
  });

  it('is found by its heading, so it passes after the release bump', () => {
    const bumped = withReleaseBump(CHANGELOG);
    expect(bumped).not.toContain('## [Unreleased]');
    expect(placementProblem(bumped)).toBeNull();
    expect(releasedTextProblem(bumped)).toBeNull();
    const holder = releaseSections(bumped).find(section => entryOf(section) !== null);
    expect(holder?.label).toBe('3.8.0');
    expect(missingItems(entryOf(holder ?? { label: '', text: '' }) ?? '')).toEqual([]);
  });

  it('README carries the mixed-version advice', () => {
    expect(README).toMatch(/features\.learning/);
    expect(README).toMatch(/features\.curation/);
    expect(README).toMatch(/every (team )?member runs 3\.8/);
  });
});

describe('CHANGELOG curation rename entry: the points a reader acts on', () => {
  const entry = currentEntry()

  it('says what a downgrade does to the Curate model setting, and which file wins on re-upgrade', () => {
    const block = blockOf(entry, '**Upgrade, downgrade and re-upgrade:**')
    expect(block).toContain('`~/.devflow/learning.json`')
    expect(block).toContain('`~/.devflow/curation.json`')
    expect(block).toContain('3.7 reads only the old name')
    expect(block).toContain('set the Curate model again with `devflow learning --configure`')
    expect(block).toContain('an existing `curation.json` wins and init logs one line')
    expect(block).toContain('To keep a value that you set on 3.7, delete `curation.json` first.')
  })

  it('the global tuning file rule it states is the one init applies', () => {
    const step = readFileSync(path.join(ROOT, 'src/cli/commands/curation-move-step.ts'), 'utf8')
    expect(step).toContain('is used, and ${LEGACY_NAMES.tuningFile} was left in place')
  })

  it('puts the main-checkout condition on the linked-worktree note and on the delete step', () => {
    const behind = blockOf(entry, '**What stays behind:**')
    const todo = blockOf(entry, '**What you must do:**')
    const condition = /main checkout has a `\.devflow\/` folder and is not your home folder/
    expect(behind).toMatch(condition)
    expect(todo).toMatch(condition)
    expect(behind).toContain('is a live ledger')
    expect(todo).toContain('keeps a live ledger')
    expect(behind).toContain('moves like any project')
    expect(todo).toContain('moves like any project')
  })

  it('the condition it states is the one the ledger root applies', () => {
    const root = readFileSync(path.join(ROOT, 'src/core/ledger-root.ts'), 'utf8')
    expect(root).toContain("path.join(main, '.devflow')")
    expect(root).toContain('mainReal !== homeReal')
  })

  it('states the two-branch rule for a project with both folders', () => {
    const block = blockOf(entry, '**What the migration does:**')
    expect(block).toContain(
      'If `.devflow/curation/` has a non-empty log, it wins and the old folder becomes the backup. '
      + 'If not, the old ledger set moves in and the rest of the old folder becomes the backup.',
    )
  })

  it('says which commands heal the manifest and which write nothing', () => {
    const block = blockOf(entry, '**What the migration does:**')
    expect(block).toContain(
      'the first `devflow` command that loads the whole manifest '
      + '(for example `devflow init` or `devflow flags --status`) heals `~/.devflow/manifest.json`.',
    )
    expect(block).toContain('The `--status` commands of curation, memory, knowledge and gates write nothing.')
    expect(block).not.toContain('even a read-only one')
  })

  it('says that a failed move at session start shows the refused line', () => {
    const block = blockOf(entry, '**Outcomes that need action:**')
    expect(block).toContain('Failed: init prints `Ledger move failed for <root>` and copies nothing. The next init tries again.')
    expect(block).toContain('A move that fails at session start shows the same `Curation: move refused, see the hook log` line as a refusal.')
    expect(block).toContain('The hook log names the cause.')
  })
})

describe('CHANGELOG curation rename entry: the backup delete step', () => {
  const entry = currentEntry()
  const warning = 'A backup made on re-upgrade can hold the only copy of entries that 3.7 wrote. Check them before you delete it.'

  it('warns, at each delete step, that a backup can hold the only copy of 3.7 entries', () => {
    expect(blockOf(entry, '**The backup:**')).toContain(warning)
    expect(blockOf(entry, '**What you must do:**')).toContain(warning)
  })

  it('names whose backups uninstall removes: the project at the git root of the current directory', () => {
    const block = blockOf(entry, '**The backup:**')
    expect(block).toContain(
      'No devflow command deletes a backup, except `devflow uninstall`. '
      + "Uninstall removes the backups of the project at the git root of your current directory, with that project's data, after you confirm.",
    )
    expect(block).not.toContain('It removes the backup with the project data')
  })

  it('the scope it states is the one uninstall applies', () => {
    const uninstall = readFileSync(path.join(ROOT, 'src/cli/commands/uninstall.ts'), 'utf8')
    expect(uninstall).toContain('getGitRoot(process.cwd())')
  })
})

describe('CHANGELOG guard is live (seeded known-bad input)', () => {
  it('fails on an entry below 3.8.0', () => {
    const lowered = CHANGELOG
      .replace(ENTRY_HEADING, '@@MOVED@@')
      .replace('## [3.7.0] - 2026-10-16\n', `## [3.7.0] - 2026-10-16\n\n${ENTRY_HEADING}\n`)
      .replace('@@MOVED@@', 'Gone');
    expect(placementProblem(lowered)).toMatch(/3\.7\.0|exactly one|first upgrade heading/);
  });

  it('fails on an entry that sits below the lint-pack notes', () => {
    const lowered = CHANGELOG.replace(ENTRY_HEADING, '### Upgrade notes — Other').replace(
      '\n### Added\n',
      `\n${ENTRY_HEADING}\n\nText.\n\n### Added\n`,
    );
    expect(placementProblem(lowered)).not.toBeNull();
  });

  it('fails on a missing entry', () => {
    expect(placementProblem(CHANGELOG.replace(ENTRY_HEADING, '### Upgrade notes — Other'))).toMatch(/found 0/);
  });

  it('fails when a listed item is removed', () => {
    const entry = entryOf(releaseSections(CHANGELOG).find(section => entryOf(section) !== null) ?? { label: '', text: '' }) ?? '';
    expect(missingItems(entry)).toEqual([]);
    expect(missingItems(entry.replace('fills a pending queue up to 100 lines and no further', 'takes a queue'))).toContain('queue cap');
    expect(missingItems(entry.replace('Mixed-version teams', 'Teams'))).toContain('mixed-version advice');
    expect(missingItems(entry.replace('both `features.curation` and `features.learning`', 'one key'))).toContain('manifest heal');
    expect(missingItems('')).toHaveLength(CHECKLIST.length);
  });

  it('fails when the released 3.6.0 text changes', () => {
    expect(releasedTextProblem(CHANGELOG)).toBeNull();
    expect(releasedTextProblem(CHANGELOG.replace('`features.learning`, `.devflow/learning/` and the learning ops do not change.', 'and more.'))).toMatch(/3\.6\.0 text changed/);
    expect(releasedTextProblem(CHANGELOG.replace('## [3.6.0]', '## [3.6.1]'))).toMatch(/missing/);
  });
});

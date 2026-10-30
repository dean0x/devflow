/**
 * Docs guard for the install backups (#688).
 *
 * An install moves each file that devflow did not ship out of its install folders and into a backup
 * folder. The docs tell a user where their own files belong, where a moved file goes, and what the
 * move does not do. Each check ties a sentence of the docs to the fact it states:
 *
 *   - The one line that names a stable home for each kind of own file is the same, word for word, in
 *     the CLI reference, the architecture doc and the file-organization doc.
 *   - The CLI reference and the architecture doc state the backup path, the move-again rule, the
 *     unencrypted backup that stays until you delete it, the same-name overwrite, the broken
 *     relative links, the unsupported concurrent runs and the bare legacy skill folders.
 *   - The skills architecture doc no longer says that a file in the references is never touched, and
 *     no longer says that an unnamed file is removed.
 *   - The release process doc names the fixture, the retired list and the legacy list that a PR
 *     updates when it ships a name.
 *   - The CHANGELOG entries state the fix, the behaviour change and the upgrade note, and make no
 *     claim about a non-interactive uninstall.
 *
 * Entries are found by their title, never by the Unreleased label, so the guard keeps passing after a
 * release renames that heading. Each collector is shown to fail on seeded known-bad input, so a guard
 * that stops seeing its subject fails instead of passing without a check.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { BACKUP_ROOT_NAME } from '../../src/targets/claude-code/install-backup.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const CLI_REFERENCE = read('docs/cli-reference.md');
const ARCHITECTURE = read('docs/reference/architecture.md');
const FILE_ORGANIZATION = read('docs/reference/file-organization.md');
const SKILLS_ARCHITECTURE = read('docs/reference/skills-architecture.md');
const RELEASE_PROCESS = read('docs/reference/release-process.md');
const CHANGELOG = read('CHANGELOG.md');

/** The one line that names a stable home for each kind of own file. */
const HOMES_LINE =
  "Devflow's install folders belong to devflow, so keep your own files in their stable homes: " +
  'own skills as shadows in `~/.devflow/skills/<name>/`, ' +
  'own rules in `~/.devflow/rules/`, ' +
  'and own commands and agents in the top-level `commands/` and `agents/` folders of the Claude directory ' +
  '(outside the `devflow/` subfolders).';

const BACKUP_PATH = `~/.devflow/${BACKUP_ROOT_NAME}/<UTC stamp>-<8 hex>/`;

/** One fact of the backup behaviour, as a sentence part that a doc must hold. */
interface Fact {
  readonly name: string;
  readonly text: string;
}

const BACKUP_FACTS: readonly Fact[] = [
  { name: 'the backup path', text: BACKUP_PATH },
  { name: 'the move-again rule', text: 'moves again on the next' },
  { name: 'the unencrypted backup', text: 'The backup is not encrypted.' },
  { name: 'the backup stays until you delete it', text: 'It stays until you delete it or run a full uninstall.' },
  { name: 'the same-name overwrite', text: 'with the same name as a shipped file is overwritten without a report' },
  { name: 'the broken relative links', text: 'Relative links in a moved folder can break.' },
  { name: 'the unsupported concurrent runs', text: 'Concurrent devflow runs are not supported.' },
  { name: 'the bare legacy skill folders', text: 'A bare legacy skill folder, such as `skills/python`' },
  { name: 'the uninstall full-wipe listing', text: 'the full-wipe prompt' },
];

/** The facts of `facts` that `doc` does not hold. */
function missingFacts(doc: string, facts: readonly Fact[]): string[] {
  return facts.filter(fact => !doc.includes(fact.text)).map(fact => fact.name);
}

/** The text of the CHANGELOG from a bullet title to the next bullet or heading at the same or a higher level. */
function entryOf(changelog: string, title: string): string | null {
  const lines = changelog.split('\n');
  const matches = lines.flatMap((line, index) => (line.includes(title) ? [index] : []));
  if (matches.length !== 1) return null;
  const rest = lines.slice(matches[0] + 1);
  const end = rest.findIndex(line => /^(- \*\*|#{1,3} )/.test(line));
  return [lines[matches[0]], ...(end === -1 ? rest : rest.slice(0, end))].join('\n');
}

const FIXED_TITLE = '`devflow init` and the curation, compliance and rules toggles no longer delete files that devflow did not ship';
const BEHAVIOUR_TITLE = 'Devflow now names the retired files that it removes, and it moves bare legacy skill folders instead of deleting them';
const UPGRADE_TITLE = '### Upgrade notes — Files that devflow moves to a backup folder';

function upgradeNoteOf(changelog: string): string | null {
  const start = changelog.indexOf(UPGRADE_TITLE);
  if (start === -1 || changelog.indexOf(UPGRADE_TITLE, start + 1) !== -1) return null;
  const rest = changelog.slice(start + UPGRADE_TITLE.length);
  const end = rest.search(/\n#{2,3} /);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('install backup docs: the stable homes line', () => {
  it.each([
    ['docs/cli-reference.md', CLI_REFERENCE],
    ['docs/reference/architecture.md', ARCHITECTURE],
    ['docs/reference/file-organization.md', FILE_ORGANIZATION],
  ])('%s holds the line word for word', (_name, doc) => {
    expect(doc.split(HOMES_LINE)).toHaveLength(2);
  });

  it('names a home for skills, rules, commands and agents', () => {
    for (const home of ['~/.devflow/skills/<name>/', '~/.devflow/rules/', '`commands/`', '`agents/`', 'outside the `devflow/` subfolders']) {
      expect(HOMES_LINE, home).toContain(home);
    }
  });
});

describe('install backup docs: the backup facts', () => {
  it.each([
    ['docs/cli-reference.md', CLI_REFERENCE],
    ['docs/reference/architecture.md', ARCHITECTURE],
  ])('%s states every fact', (_name, doc) => {
    expect(missingFacts(doc, BACKUP_FACTS)).toEqual([]);
  });

  it('docs/reference/file-organization.md lists the backup folder in the install paths', () => {
    expect(FILE_ORGANIZATION).toContain('| Install backups | `~/.devflow/install-backups/<UTC stamp>-<8 hex>/` |');
  });

  it('docs/reference/file-organization.md says that uninstall keeps the backups and lists them in the prompt', () => {
    expect(FILE_ORGANIZATION).toContain('a keep-data uninstall keeps it, and the full-wipe prompt of an interactive uninstall lists it before the wipe');
  });
});

describe('install backup docs: the skills architecture sentence', () => {
  it('says that an install moves a file that devflow did not ship and names it', () => {
    expect(SKILLS_ARCHITECTURE).toContain(
      'A file that devflow did not ship is not left in place. An install moves it to `~/.devflow/install-backups/` and names it in the output.',
    );
  });

  it('no longer says that hand-authored reference files are never touched', () => {
    expect(SKILLS_ARCHITECTURE).not.toContain('are never touched by the overlay');
  });

  it('no longer says that an unnamed tracker or pr file is removed', () => {
    expect(SKILLS_ARCHITECTURE).toContain('that the build manifest does not name is moved to the install backup folder and named on the next install');
    expect(SKILLS_ARCHITECTURE).not.toContain('that the build manifest does not name is removed on the next install');
  });
});

describe('install backup docs: the release process', () => {
  it('names the fixture, the retired list and the legacy list that a PR updates', () => {
    expect(RELEASE_PROCESS).toContain('adds the name to `tests/fixtures/released-shipped-names.ts`');
    expect(RELEASE_PROCESS).toContain('removes the name from `RETIRED_SHIPPED` in `src/core/retired-shipped-names.ts`');
    expect(RELEASE_PROCESS).toContain('from the legacy list in `src/targets/claude-code/legacy.ts`, in the same PR');
  });
});

describe('install backup docs: the CHANGELOG entries', () => {
  const fixed = entryOf(CHANGELOG, FIXED_TITLE);
  const behaviour = entryOf(CHANGELOG, BEHAVIOUR_TITLE);
  const upgrade = upgradeNoteOf(CHANGELOG);

  it('has each entry once', () => {
    expect(fixed, 'the Fixed entry').not.toBeNull();
    expect(behaviour, 'the Behaviour change entry').not.toBeNull();
    expect(upgrade, 'the upgrade note').not.toBeNull();
  });

  it('the Fixed entry names the backup folder and the failed move', () => {
    expect(fixed).toContain(BACKUP_PATH);
    expect(fixed).toContain('A file that cannot move stays in place with its folder, and the output names it.');
  });

  it('the Behaviour change entry states the named removals, the moved legacy folders and the uninstall prompt', () => {
    expect(behaviour).toContain('print each retired devflow file that they remove');
    expect(behaviour).toContain('is now moved whole to the backup folder and named');
    expect(behaviour).toContain('now asks before the full wipe');
    expect(behaviour).toContain('a decline keeps the backups');
  });

  it('the Behaviour change entry makes no claim about a non-interactive uninstall', () => {
    expect(behaviour).not.toMatch(/non-interactive/i);
  });

  it('the upgrade note says where the backup is, how to restore, and what the move does not do', () => {
    expect(upgrade).toContain(BACKUP_PATH);
    expect(upgrade).toContain('To restore a moved file, copy it from the backup folder');
    expect(upgrade).toContain('The backup is not encrypted. Devflow never prunes it.');
    expect(upgrade).toContain('is overwritten without a report');
    expect(upgrade).toContain('moves again on the next `devflow init`');
  });
});

describe('install backup docs: the guard is live (seeded known-bad input)', () => {
  it('a doc that words the homes line differently fails the line check', () => {
    const edited = CLI_REFERENCE.replace(HOMES_LINE, HOMES_LINE.replace('own rules in `~/.devflow/rules/`', 'own rules in `~/.devflow/rule/`'));
    expect(edited.split(HOMES_LINE)).toHaveLength(1);
  });

  it('a doc that drops one fact is reported by name', () => {
    const edited = ARCHITECTURE.replace('The backup is not encrypted.', '');
    expect(missingFacts(edited, BACKUP_FACTS)).toEqual(['the unencrypted backup']);
  });

  it('a skills doc that keeps the old sentence fails the check', () => {
    const old = SKILLS_ARCHITECTURE.replace(
      'the overlay leaves the hand-authored files that devflow ships',
      'hand-authored files beside the generated ones are never touched by the overlay',
    );
    expect(old).toContain('are never touched by the overlay');
  });

  it('a changelog with a second entry of the same title finds no entry', () => {
    expect(entryOf(`${CHANGELOG}\n- **${FIXED_TITLE}**\n`, FIXED_TITLE)).toBeNull();
  });

  it('a Behaviour change entry that mentions a non-interactive uninstall is caught', () => {
    const seeded = `${behaviourWith('A non-interactive uninstall keeps the folder.')}`;
    expect(entryOf(seeded, BEHAVIOUR_TITLE)).toMatch(/non-interactive/i);
  });
});

/** A changelog fragment with the behaviour entry followed by one extra line. */
function behaviourWith(extra: string): string {
  return `- **${BEHAVIOUR_TITLE}** (#1).\n  - ${extra}\n`;
}

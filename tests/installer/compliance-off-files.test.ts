/**
 * The removal list of a compliance-off install and the restore that undoes it (AC-41,
 * TP-58): src/core/compliance-off-files.ts and src/targets/claude-code/compliance-off-files.ts.
 *
 * Every test runs against a temp skills directory it creates, so nothing reads or writes the
 * real Claude directory, and every temp directory is removed afterwards.
 *
 * What is proved, and how the proof is kept honest:
 *   - the list is ONE constant, pinned as independent literals and tied to the build's own
 *     publication-gate name, so a name lost from it fails here;
 *   - a known-bad list (one name short) leaves its file behind, which the absence check
 *     reports, so the check is not vacuous;
 *   - an entry is checked with lstat: a link at the path is unlinked and its target survives,
 *     a directory at the path is refused and never recursed, a link above the path is refused.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { COMPLIANCE_OFF_REMOVED_SKILL_FILES } from '../../src/core/compliance-off-files.js';
import { COMPLIANCE_OFF_OMITTED_DOCS, SKILL_REFS_SKILL_NAME } from '../../src/core/mds-variants.js';
import { prefixSkillName } from '../../src/core/plugins.js';
import { complianceOffCopyExclusions, removeComplianceOffFiles, restoreComplianceOffFiles } from '../../src/targets/claude-code/compliance-off-files.js';
import { assertTempHome } from '../setup/home-isolation.js';

const GATE = 'devflow:git/references/publication-gate.md';
const POSTING = 'devflow:git/references/github-posting.md';
const ASKS = 'devflow:agent-references/references/commands/implement-evidence-asks.md';

let tmp: string;
let skillsDir: string;

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf-8');
}

const at = (entry: string): string => path.join(skillsDir, ...entry.split('/'));
const present = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

/** Every entry of the list that is still on disk. */
async function remaining(entries: readonly string[] = COMPLIANCE_OFF_REMOVED_SKILL_FILES): Promise<string[]> {
  const left: string[] = [];
  for (const entry of entries) if (await present(at(entry))) left.push(entry);
  return left;
}

async function seedAll(): Promise<void> {
  for (const entry of COMPLIANCE_OFF_REMOVED_SKILL_FILES) await write(at(entry), `${entry}\n`);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-compliance-off-files-'));
  expect(() => assertTempHome(tmp)).not.toThrow();
  skillsDir = path.join(tmp, 'skills');
  await fs.mkdir(skillsDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('COMPLIANCE_OFF_REMOVED_SKILL_FILES', () => {
  it('is exactly the three files, pinned as independent literals', () => {
    expect([...COMPLIANCE_OFF_REMOVED_SKILL_FILES]).toEqual([GATE, POSTING, ASKS]);
  });

  it('names the publication gate the build omits, under the installed git skill', () => {
    expect(COMPLIANCE_OFF_OMITTED_DOCS).toEqual(['publication-gate']);
    expect(COMPLIANCE_OFF_REMOVED_SKILL_FILES[0]).toBe(
      `${prefixSkillName(SKILL_REFS_SKILL_NAME)}/references/${COMPLIANCE_OFF_OMITTED_DOCS[0]}.md`,
    );
  });

  it('holds only plain relative paths below a prefixed skill directory', () => {
    for (const entry of COMPLIANCE_OFF_REMOVED_SKILL_FILES) {
      expect(entry.startsWith('devflow:'), entry).toBe(true);
      expect(entry.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..'), entry).toBe(true);
    }
  });
});

describe('complianceOffCopyExclusions', () => {
  it('names the files of a skill below the directory its copy reads, whether shipped or shadowed', () => {
    expect([...complianceOffCopyExclusions('git', '/source/git')].sort()).toEqual([
      path.join('/source/git', 'references', 'github-posting.md'),
      path.join('/source/git', 'references', 'publication-gate.md'),
    ]);
    expect([...complianceOffCopyExclusions('agent-references', '/shadow/agent-references')]).toEqual([
      path.join('/shadow/agent-references', 'references', 'commands', 'implement-evidence-asks.md'),
    ]);
  });

  it('names nothing for a skill the list does not mention', () => {
    expect([...complianceOffCopyExclusions('typescript', '/source/typescript')]).toEqual([]);
  });

  it('leaves out an entry that is not a plain relative path: the removal reports it', () => {
    const entries = ['devflow:git/../outside.md', 'devflow:git//empty.md', 'devflow:git'];

    expect([...complianceOffCopyExclusions('git', '/source/git', entries)]).toEqual([]);
  });

  it('follows an injected list, so a known-bad list is provable', () => {
    expect([...complianceOffCopyExclusions('git', '/source/git', [POSTING])]).toEqual([
      path.join('/source/git', 'references', 'github-posting.md'),
    ]);
  });
});

describe('removeComplianceOffFiles', () => {
  it('removes each file of the list and names it', async () => {
    await seedAll();

    const result = await removeComplianceOffFiles(skillsDir);

    expect(result.refused).toEqual([]);
    expect([...result.removed].sort()).toEqual([...COMPLIANCE_OFF_REMOVED_SKILL_FILES].sort());
    expect(await remaining()).toEqual([]);
  });

  it('removing an absent file, or a file whose skill is not installed, is a no-op', async () => {
    const result = await removeComplianceOffFiles(skillsDir);

    expect(result).toEqual({ removed: [], refused: [] });
  });

  it('removes by exact name: a user file beside them, and a sibling of the same stem, survive', async () => {
    await seedAll();
    await write(at('devflow:git/references/my-notes.md'), 'mine\n');
    await write(at('devflow:git/references/github-posting.md.bak'), 'backup\n');
    await write(at('devflow:git/references/github-api.md'), 'hand-authored\n');
    await write(at('devflow:agent-references/references/commands/implement-levels.md'), 'levels\n');

    await removeComplianceOffFiles(skillsDir);

    expect(await remaining()).toEqual([]);
    for (const kept of [
      'devflow:git/references/my-notes.md',
      'devflow:git/references/github-posting.md.bak',
      'devflow:git/references/github-api.md',
      'devflow:agent-references/references/commands/implement-levels.md',
    ]) {
      expect(await present(at(kept)), `${kept} must survive`).toBe(true);
    }
  });

  it('a link at the path is unlinked and its target is left untouched', async () => {
    const outside = path.join(tmp, 'outside.md');
    await write(outside, 'not the installer\'s\n');
    await fs.mkdir(path.dirname(at(POSTING)), { recursive: true });
    await fs.symlink(outside, at(POSTING));

    const result = await removeComplianceOffFiles(skillsDir);

    expect(result.removed).toEqual([POSTING]);
    expect(await present(at(POSTING)), 'the link is gone').toBe(false);
    expect(await fs.readFile(outside, 'utf-8'), 'the target is never followed').toBe('not the installer\'s\n');
  });

  it('a dangling link at the path is unlinked too', async () => {
    await fs.mkdir(path.dirname(at(GATE)), { recursive: true });
    await fs.symlink(path.join(tmp, 'does-not-exist.md'), at(GATE));

    const result = await removeComplianceOffFiles(skillsDir);

    expect(result.removed).toEqual([GATE]);
    expect(await present(at(GATE))).toBe(false);
  });

  it('a directory at the path is refused and reported, never recursed into', async () => {
    await write(path.join(at(ASKS), 'inner.md'), 'inside a directory that is in the way\n');
    await write(at(GATE), 'gate\n');

    const result = await removeComplianceOffFiles(skillsDir);

    expect(result.refused).toHaveLength(1);
    expect(result.refused[0].entry).toBe(ASKS);
    expect(result.refused[0].reason).toContain('directory');
    expect(await fs.readFile(path.join(at(ASKS), 'inner.md'), 'utf-8'), 'nothing inside it was touched').toContain('inside a directory');
    expect(result.removed, 'the other files are still removed').toEqual([GATE]);
  });

  it('a link above the path is refused: nothing is removed through someone else\'s directory', async () => {
    const elsewhere = path.join(tmp, 'elsewhere');
    await write(path.join(elsewhere, 'references', 'github-posting.md'), 'foreign\n');
    await fs.symlink(elsewhere, at('devflow:git'), 'dir');

    const result = await removeComplianceOffFiles(skillsDir);

    expect(result.refused.some(refusal => refusal.entry === POSTING && refusal.reason.includes('link')), JSON.stringify(result)).toBe(true);
    expect(await fs.readFile(path.join(elsewhere, 'references', 'github-posting.md'), 'utf-8')).toBe('foreign\n');
  });

  it('a path that is not plain is refused, whatever the list says', async () => {
    const result = await removeComplianceOffFiles(skillsDir, ['devflow:git/../../escape.md', '/etc/passwd', 'devflow:git//x.md']);

    expect(result.removed).toEqual([]);
    expect(result.refused.map(refusal => refusal.entry)).toEqual(['devflow:git/../../escape.md', '/etc/passwd', 'devflow:git//x.md']);
  });

  it('known-bad probe: a list one name short leaves that file behind, and the absence check sees it', async () => {
    await seedAll();

    await removeComplianceOffFiles(skillsDir, COMPLIANCE_OFF_REMOVED_SKILL_FILES.slice(0, 2));

    expect(await remaining(), 'the check must report the file the lossy list forgot').toEqual([ASKS]);
  });
});

describe('restoreComplianceOffFiles', () => {
  /** A skill source tree: `skill/<rel>` for each entry that has a source. */
  async function seedSources(entries: readonly string[]): Promise<(skill: string) => Promise<string>> {
    const sources = path.join(tmp, 'sources');
    for (const entry of entries) {
      const [skillDirName, ...rest] = entry.split('/');
      await write(path.join(sources, skillDirName.replace(/^devflow:/, ''), ...rest), `source of ${entry}\n`);
    }
    return async skill => path.join(sources, skill);
  }

  async function installedSkills(): Promise<void> {
    await fs.mkdir(at('devflow:git'), { recursive: true });
    await fs.mkdir(at('devflow:agent-references'), { recursive: true });
  }

  it('writes back each file that has a source, byte for byte, and names it', async () => {
    const sourceDirOf = await seedSources([POSTING, ASKS]);
    await installedSkills();

    const result = await restoreComplianceOffFiles({ skillsDir, sourceDirOf });

    expect(result.refused).toEqual([]);
    expect([...result.restored].sort()).toEqual([ASKS, POSTING].sort());
    expect(await fs.readFile(at(POSTING), 'utf-8')).toBe(`source of ${POSTING}\n`);
    expect(await fs.readFile(at(ASKS), 'utf-8')).toBe(`source of ${ASKS}\n`);
    expect(await present(at(GATE)), 'an entry with no source is not invented').toBe(false);
  });

  it('a second run changes nothing', async () => {
    const sourceDirOf = await seedSources([POSTING, ASKS]);
    await installedSkills();
    await restoreComplianceOffFiles({ skillsDir, sourceDirOf });

    const again = await restoreComplianceOffFiles({ skillsDir, sourceDirOf });

    expect(again.restored).toEqual([]);
    expect([...again.unchanged].sort()).toEqual([ASKS, POSTING].sort());
  });

  it('replaces a file whose bytes differ', async () => {
    const sourceDirOf = await seedSources([ASKS]);
    await write(at(ASKS), 'edited by hand\n');

    const result = await restoreComplianceOffFiles({ skillsDir, sourceDirOf });

    expect(result.restored).toEqual([ASKS]);
    expect(await fs.readFile(at(ASKS), 'utf-8')).toBe(`source of ${ASKS}\n`);
  });

  it('never installs a skill: an entry whose skill directory is absent is left alone', async () => {
    const sourceDirOf = await seedSources([POSTING, ASKS]);

    const result = await restoreComplianceOffFiles({ skillsDir, sourceDirOf });

    expect(result).toEqual({ restored: [], unchanged: [], refused: [] });
    expect(await fs.readdir(skillsDir), 'no skill directory was created').toEqual([]);
  });

  it('leaves the entries another converger owns', async () => {
    const sourceDirOf = await seedSources([POSTING, ASKS]);
    await installedSkills();

    const result = await restoreComplianceOffFiles({ skillsDir, sourceDirOf, ownedElsewhere: new Set([POSTING]) });

    expect(result.restored).toEqual([ASKS]);
    expect(await present(at(POSTING))).toBe(false);
  });

  it('a link at the path is replaced by the file, and its target is left untouched', async () => {
    const sourceDirOf = await seedSources([ASKS]);
    const outside = path.join(tmp, 'outside.md');
    await write(outside, 'foreign\n');
    await fs.mkdir(path.dirname(at(ASKS)), { recursive: true });
    await fs.symlink(outside, at(ASKS));

    const result = await restoreComplianceOffFiles({ skillsDir, sourceDirOf });

    expect(result.restored).toEqual([ASKS]);
    expect((await fs.lstat(at(ASKS))).isFile(), 'a real file stands where the link was').toBe(true);
    expect(await fs.readFile(outside, 'utf-8'), 'nothing was written through the link').toBe('foreign\n');
  });

  it('a directory at the path is refused, not replaced', async () => {
    const sourceDirOf = await seedSources([ASKS]);
    await write(path.join(at(ASKS), 'inner.md'), 'in the way\n');

    const result = await restoreComplianceOffFiles({ skillsDir, sourceDirOf });

    expect(result.restored).toEqual([]);
    expect(result.refused.map(refusal => refusal.entry)).toEqual([ASKS]);
    expect(await fs.readFile(path.join(at(ASKS), 'inner.md'), 'utf-8')).toBe('in the way\n');
  });

  it('a link above the path is refused: nothing is written through someone else\'s directory', async () => {
    const sourceDirOf = await seedSources([POSTING, ASKS]);
    await installedSkills();
    const elsewhere = path.join(tmp, 'elsewhere');
    await fs.mkdir(elsewhere, { recursive: true });
    await fs.symlink(elsewhere, at('devflow:agent-references/references'), 'dir');

    const result = await restoreComplianceOffFiles({ skillsDir, sourceDirOf });

    expect(result.refused.map(refusal => refusal.entry)).toEqual([ASKS]);
    expect(result.refused[0].reason).toContain('link');
    expect(await fs.readdir(elsewhere), 'nothing was created in the linked directory').toEqual([]);
    expect(result.restored, 'the next entry is still restored').toEqual([POSTING]);
  });

  it('a source that cannot be resolved refuses that entry and not the next', async () => {
    const good = await seedSources([POSTING]);
    await installedSkills();

    const result = await restoreComplianceOffFiles({
      skillsDir,
      sourceDirOf: async skill => {
        if (skill === 'agent-references') throw new Error('Skill source not found');
        return good(skill);
      },
    });

    expect(result.restored).toEqual([POSTING]);
    expect(result.refused.map(refusal => refusal.entry)).toEqual([ASKS]);
  });
});

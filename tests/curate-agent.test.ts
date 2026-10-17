import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { AGENT_CONFIG } from './fixtures/agent-config.js';
import { commandReferenceSections, readAgentReference, RETIRED_INLINE_EXPANSION, SANCTIONED_RESOLUTION, SANCTIONED_RESOLUTION_PRINT } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_PATH = path.resolve(__dirname, '../src/assets/agents/curate.md');
const ROOT = path.resolve(__dirname, '..');
const CURATION_STORE = path.resolve(ROOT, 'src/assets/scripts/hooks/lib/curation-store.cjs');

/** Recursively find all files matching an extension under a directory. */
function findFiles(dir: string, exts: string[]): string[] {
  if (!fsSync.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, exts));
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

/** Extract the raw frontmatter block from a markdown agent file */
function parseFrontmatter(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  return fmMatch ? fmMatch[1] : '';
}

/** Extract a YAML-list field (e.g. tools:, skills:) from frontmatter */
function parseYamlList(frontmatter: string, field: string): string[] {
  const re = new RegExp(`^${field}:\\n((?:  - .+\\n?)+)`, 'm');
  const match = frontmatter.match(re);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map(l => l.replace(/^ {2}- /, '').trim())
    .filter(Boolean);
}

/** The text from the `start` heading up to the `end` heading, or '' when either is missing. */
function sectionOf(content: string, start: string, end: string): string {
  const from = content.indexOf(start);
  const to = content.indexOf(end, from + start.length);
  return from === -1 || to === -1 ? '' : content.slice(from, to);
}

/**
 * A prose phrase as a pattern in which any whitespace run, a line break included,
 * separates its words: the prompt is wrapped prose, and a pin must survive a reflow.
 */
function phrase(text: string, flags = ''): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+'), flags);
}

/** Phrases that must appear in this order, anything between them. */
function inOrder(parts: readonly string[], flags = ''): RegExp {
  return new RegExp(parts.map(part => phrase(part).source).join('[\\s\\S]*'), flags);
}

describe('curate agent', () => {
  let content: string;
  let frontmatter: string;
  // D-MAINTAIN-ON-DUE: the ladder, the claim-due output format and the close-out batch live in
  // curate/maintain.md, which a run reads only after claim-due hands out an entry. `prompt` is
  // the text a run with a due entry sees, in the order it sees it.
  let maintain: string;
  let prompt: string;

  beforeAll(async () => {
    content = await fs.readFile(AGENT_PATH, 'utf-8');
    frontmatter = parseFrontmatter(content);
    maintain = readAgentReference('curate/maintain.md');
    prompt = `${content}\n${maintain}`;
  });

  describe('frontmatter', () => {
    // D-LEARNING-SHIPPED-ROW: the model and effort are the Curate row of the agent-config
    // table, so a change of tier is an edit to that row and to the two frontmatter lines.
    const row = AGENT_CONFIG.curate;

    it('is named Curate and ships the model and effort of its table row', () => {
      expect(frontmatter).toMatch(/^name: Curate$/m);
      expect(frontmatter).toMatch(new RegExp(`^model: ${row.model}$`, 'm'));
      if (row.effort === null) expect(frontmatter).not.toMatch(/^effort:/m);
      else expect(frontmatter).toMatch(new RegExp(`^effort: ${row.effort}$`, 'm'));
    });

    it('has exactly the read-and-run tool set: every write goes through the learning ops', () => {
      const tools = parseYamlList(frontmatter, 'tools');
      expect(tools.sort()).toEqual(['Bash', 'Glob', 'Grep', 'Read']);
    });

    it('preloads no skill: the body never names one, so there is no skills key', () => {
      expect(frontmatter).not.toMatch(/^skills:/m);
      expect(parseYamlList(frontmatter, 'skills')).toEqual([]);
    });

    // D-LEARNING-SHIPPED-ROW, D-OMIT-CLAUDEMD-SET: Curate no longer receives the project
    // CLAUDE.md or the rule files, so the body reads what its Encoded check needs (below).
    it('omits the project CLAUDE.md and the rules, as its row says', () => {
      expect(row.omitClaudeMd).toBe(true);
      expect(frontmatter).toMatch(/^omitClaudeMd: true$/m);
    });
  });

  describe('explicit reads replace the omitted CLAUDE.md (D-LEARNING-SHIPPED-ROW)', () => {
    const READ = 'Read `<project root>/CLAUDE.md` once';
    const COMPARISONS = ['**Already encoded?**', '1. **Encoded**'] as const;

    /** Named collector: the read is missing, or a comparison that needs it comes first. */
    function collectReadPositionDefects(text: string): string[] {
      const readAt = text.search(phrase(READ));
      if (readAt === -1) return ['the CLAUDE.md read is missing'];
      const out: string[] = [];
      for (const marker of COMPARISONS) {
        const at = text.indexOf(marker);
        if (at === -1) out.push(`${marker} is missing`);
        else if (at < readAt) out.push(`${marker} comes before the read`);
      }
      return out;
    }

    const inputs = (): string => sectionOf(content, '## Inputs', '## Core rules');

    it('reads the root CLAUDE.md once per run, in Inputs, before the already-encoded check and the Encoded rung', () => {
      expect(inputs()).toMatch(phrase(READ));
      expect(collectReadPositionDefects(prompt)).toEqual([]);
    });

    it('also reads the installed rule files, because the Encoded check compares against a rules file', () => {
      expect(inputs()).toMatch(phrase('rules/devflow'));
      expect(inputs()).toMatch(phrase("-name '*.md'"));
      expect(inputs()).toMatch(phrase('Read each once'));
      expect(prompt).toMatch(phrase('a rules file'));
    });

    it('keeps what it read for every later comparison and skips a file that is missing', () => {
      expect(inputs()).toMatch(phrase('Keep what you read for every later comparison'));
      expect(inputs()).toMatch(phrase('a file that is missing is skipped'));
    });

    it('known-bad probes: a read after a comparison, and no read at all, are reported', () => {
      expect(collectReadPositionDefects(`${COMPARISONS[0]} a\n${COMPARISONS[1]} b\n${READ}`)).toEqual([
        `${COMPARISONS[0]} comes before the read`,
        `${COMPARISONS[1]} comes before the read`,
      ]);
      expect(collectReadPositionDefects(`${COMPARISONS[0]} a\n${COMPARISONS[1]} b`)).toEqual(['the CLAUDE.md read is missing']);
      expect(collectReadPositionDefects(`${READ}\n${COMPARISONS[0]} a\n${COMPARISONS[1]} b`)).toEqual([]);
    });
  });

  describe('queue claim (D-OWNED-CLAIM)', () => {
    it('claims the queue with the claim-queue op as Step 0', () => {
      const step0 = sectionOf(content, '## Step 0', '## Inputs');
      expect(step0).toContain('json-helper.cjs" claim-queue');
    });

    it('answers each claim-queue outcome: keeps the token, exits silently on busy, reports none', () => {
      const step0 = sectionOf(content, '## Step 0', '## Inputs');
      expect(step0).toMatch(/`claimed <token>`[^\n]*Keep the 16-hex token/);
      expect(step0).toMatch(/`claimed <token> takeover`/);
      expect(step0).toMatch(/`busy`[^\n]*Exit silently/);
      expect(step0).toMatch(/`none`[^\n]*no pending decisions work/);
      expect(step0).toMatch(/non-zero exit[^\n]*stderr/);
    });

    it('never makes, moves or deletes the claim by hand', () => {
      expect(content).not.toContain('mv .devflow/curation/.pending-turns.jsonl');
      expect(content).not.toContain('unlink .devflow/curation/.pending-turns.processing');
      expect(content).not.toContain('cat .devflow/curation/.pending-turns.jsonl >>');
      expect(content).not.toMatch(/\brm -[rf]+[^\n]*\.pending-turns\.processing/);
    });

    it('heartbeats with touch -c at the Part 1 → Part 2 boundary and after each maintained entry', () => {
      expect(content).toContain('touch -c .devflow/curation/.pending-turns.processing');
      expect(content).toMatch(inOrder(['Heartbeat', 'Part 1 → Part 2 boundary']));
      expect(maintain).toMatch(phrase('After each maintained entry, refresh the claim'));
    });

    it('stops on vanished inputs and never recreates them', () => {
      expect(content).toMatch(inOrder(['Vanished inputs', 'stop without further writes'], 'i'));
      expect(content).toMatch(phrase('Never recreate them'));
    });

    it('releases the claim with its token as the FINAL act and notes not-owner or gone', () => {
      const finishing = content.slice(content.indexOf('## Finishing'));
      expect(finishing).toMatch(inOrder(['FINAL act', 'json-helper.cjs" release-claim <token>']));
      expect(finishing).toMatch(inOrder(['`not-owner`', '`gone`', 'summary']));
    });
  });

  describe('ledger ops', () => {
    it('keeps the Iron Law (assign-anchor owns numbering, render owns the .md)', () => {
      expect(content).toContain('assign-anchor OWNS NUMBERING');
      expect(content).toContain('render OWNS THE .md');
      expect(content).toContain('NEVER HAND-EDIT decisions.md, pitfalls.md, or index.md');
    });

    it('quotes the store\'s no-curation-dir refusal byte for byte (the inputs vanished, Step 0)', () => {
      // The store answers this refusal from a root with no `.devflow/curation/`.
      const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'curate-no-dir-'));
      try {
        const { restoreAnchor } = createRequire(import.meta.url)(CURATION_STORE) as {
          restoreAnchor: (root: string, anchor: string) => { ok: boolean; error: { kind: string; message: string } };
        };
        const refused = restoreAnchor(tmp, 'ADR-001');
        expect(refused.error.kind).toBe('no-curation-dir');
        const generic = refused.error.message.replace('restore-anchor', '<op>').replace(tmp, '<root>');
        expect(generic).toBe('<op>: no .devflow/curation/ under <root> — run from the project root');
        expect(content).toContain(`\`${generic}\``);
      } finally {
        fsSync.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('runs every op through json-helper from the project root', () => {
      expect(content).toContain('node "$HOME/.devflow/scripts/hooks/json-helper.cjs" <op>');
      expect(content).toContain('cd "<project root>" &&');
      for (const op of [
        'claim-queue', 'release-claim', 'put-observation', 'assign-anchor', 'retire-anchor',
        'refresh-anchor', 'rotate-observations', 'claim-due',
      ]) {
        expect(prompt, op).toMatch(new RegExp(`json-helper\\.cjs" ${op}\\b`));
      }
      for (const op of ['`list`', '`show <anchor|obs_id>`', '`restore-anchor <anchor>`']) {
        expect(content, op).toContain(op);
      }
    });

    it('calls the ops plainly: they self-lock, and nothing wraps them in a lock', () => {
      expect(content).toMatch(phrase('self-locks internally'));
      expect(content).toMatch(phrase('never wrap them in a lock'));
    });

    it('quotes the stdout each op answers', () => {
      for (const form of [
        '`claimed <token>`', '`claimed <token> takeover`', '`busy`', '`none`',
        '`released`', '`not-owner`', '`gone`',
        '`created <id>`', '`updated <id>`', '`unchanged <id>`', '`reinforced <id> <n>`', '`reprojected <anchor>`',
        '`encoded <anchor>`', '`superseded <anchor>`', '`retired <anchor>`', '`deprecated <anchor>`',
        '`repointed <anchor>`', '`restored <anchor>`', '`verified <anchor>`',
        '`rotated <N> observations`',
        '`ref <origin/HEAD|HEAD> <sha12>`', '`ref none`', '`<anchor> <reason> <bytes>`', '`due none`',
      ]) {
        expect(prompt, form).toContain(form);
      }
    });

    it('quotes the list sections the agent reads', () => {
      for (const header of ['ACTIVE <n>', 'INACTIVE <n>', 'OBSERVATIONS <n>', 'INTEGRITY <n>', 'MALFORMED <n>']) {
        expect(content, header).toContain(header);
      }
    });

    it('quotes an ACTIVE line field for field as the store prints it, the title last', () => {
      const template = '<anchor> <obs_id> v<1|2> verified <date|never> observed <count|?> last-seen <last_seen|-> scope <scope|-> <title>';
      expect(content).toContain(`    ${template}\n`);
      const { buildListing, formatListing } = createRequire(import.meta.url)(CURATION_STORE) as {
        buildListing: (ledger: object[], log: object[]) => unknown;
        formatListing: (listing: unknown) => string;
      };
      const entryContent = { schema: 2, id: 'obs_listed', type: 'decision', title: 'A rule with spaces', scope: ['area:a', 'src/**'] };
      const printed = formatListing(buildListing(
        [{ ...entryContent, anchor_id: 'ADR-NNN', decisions_status: 'Accepted', last_verified: '2026-09-01' }],
        [{ ...entryContent, observations: 2, first_seen: '2026-08-01T00:00:00.000Z', last_seen: '2026-09-02T00:00:00.000Z' }],
      )).split('\n')[1];
      const shape = template
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/<title>$/, '.+')
        .replace(/<[^>]+>/g, '\\S+');
      expect(printed).toMatch(new RegExp(`^  ${shape}$`));
      expect(printed).toBe('  ADR-NNN obs_listed v2 verified 2026-09-01 observed 2 last-seen 2026-09-02T00:00:00.000Z scope area:a,src/** A rule with spaces');
    });

    it('says a restored entry is due again in its place in the due order, not handed out first', () => {
      expect(content).toMatch(phrase('due for maintenance again, ordered after integrity problems and legacy entries'));
      expect(content).not.toMatch(phrase('maintenance next'));
    });

    it('names every reason claim-due can hand an entry out for, as the store spells it', () => {
      const store = fsSync.readFileSync(CURATION_STORE, 'utf-8');
      for (const reason of ['duplicate-obs-id', 'ledger-without-log', 'scope-matches-nothing', 'legacy-v1', 'verify-age']) {
        expect(store, `the store produces ${reason}`).toContain(`'${reason}'`);
        expect(maintain, `the maintain step names ${reason}`).toContain(`\`${reason}\``);
      }
    });

    it('sends text to an op only as one JSON object on stdin, through a quoted heredoc', () => {
      expect(content).toMatch(phrase('Text goes on stdin, never on the command line'));
      expect(content).toContain("put-observation --create <<'EOF'");
      expect(maintain).toContain("retire-anchor <anchor> Encoded <<'EOF'");
    });

    it('gives each retire status its stdin shape', () => {
      expect(maintain).toContain('{"reason": "<why, one line, 1 to 120 characters>"}');
      expect(maintain).toContain('{"by": "<anchor>"}');
      expect(maintain).toMatch(/\{"at": "<path from the repository root>", "quote": "[^"]+"\}/);
      expect(maintain).toContain('RETIRE BY STATUS');
      expect(maintain).toContain('never hand-edit the .md');
    });

    it('tells the agent a refused input lists every problem at once, but a value with a bad shape reports only that', () => {
      expect(content).toMatch(phrase('`<op>: the input has <N> problems; nothing was written` lists every problem at once'));
      expect(content).toMatch(phrase('fix them all against the Entry format before you run the op once more'));
      expect(content).toMatch(phrase(
        'A value with a bad shape (text that is not one line, a scope with too many entries, a malformed glob) ' +
          'reports only that: fix the shape first, and expect its other problems on the retry.',
      ));
      expect(content).not.toMatch(phrase('one problem per field'));
    });

    it('reads ledger and log data only through list and show', () => {
      expect(content).toMatch(phrase('Ledger and log data come only through `list` and `show`'));
      expect(content).toMatch(phrase('claimed turns are the one input you read directly with your Read tool'));
    });
  });

  describe('entry format', () => {
    it('states the v2 fields and their limits', () => {
      const format = sectionOf(content, '## Entry format', '## Part 1');
      for (const field of ['`id`', '`type`', '`title`', '`rule`', '`why`', '`scope`', '`provenance`', '`evidence`']) {
        expect(format, field).toContain(field);
      }
      for (const limit of ['at most 120 characters', 'at most 400', 'at most 300', '1 to 5 entries', 'up to 5 items']) {
        expect(format, limit).toContain(limit);
      }
    });

    it('carries the self-contained and volatile-facts rules and the reference ban', () => {
      const format = sectionOf(content, '## Entry format', '## Part 1');
      expect(format).toContain('**Self-contained.**');
      expect(format).toContain('**No volatile facts.**');
      expect(format).toMatch(phrase('Never a ledger ID, a `#123` issue reference or a file-and-line reference'));
    });

    it('records the rule and why, never the story of how it was found', () => {
      const format = sectionOf(content, '## Entry format', '## Part 1');
      expect(format).toContain('**No incident narrative.**');
      expect(format).toMatch(phrase('An entry states the rule and why, not the story of how it was found.'));
    });

    it('records only the workaround of an open defect, and retires the entry once the defect is fixed and guarded', () => {
      const format = sectionOf(content, '## Entry format', '## Part 1');
      expect(format).toContain('**An open defect records only its workaround.**');
      expect(format).toMatch(phrase(
        'While a defect is unfixed, the entry states how to avoid it; once it is fixed and guarded, the entry is Encoded or Retired.',
      ));
    });

    it('shows a good and a bad example', () => {
      const format = sectionOf(content, '## Entry format', '## Part 1');
      expect(format).toMatch(/Good:\n\n```json\n\{"id": "obs_[a-z0-9_]+"/);
      expect(format).toMatch(/Bad:\n\n```json\n/);
    });

    it('a put carries the whole content: an update never merges', () => {
      expect(content).toMatch(phrase('an update replaces the content, it never merges'));
    });
  });

  describe('capture', () => {
    it('dedups against active, inactive and stored observations before creating', () => {
      const capture = sectionOf(content, '## Part 1', '## Part 2');
      expect(capture).toMatch(phrase('Dedup before creating'));
      expect(capture).toMatch(phrase('ACTIVE, INACTIVE and OBSERVATIONS'));
      expect(capture).toMatch(phrase('reinforce that row'));
    });

    it('restores a retired concern that comes back instead of minting a new entry', () => {
      const capture = sectionOf(content, '## Part 1', '## Part 2');
      expect(capture).toMatch(phrase('`restore-anchor <anchor>`, then rewrite it with `put-observation --update`'));
      expect(capture).toMatch(phrase('Never mint a new entry for a retired concern'));
    });

    it('checks whether the codebase already encodes a lesson before recording it', () => {
      expect(sectionOf(content, '## Part 1', '## Part 2')).toMatch(inOrder(['Already encoded?', 'record nothing']));
    });

    it('verifies a reported status change at the verify ref with git show, never git grep', () => {
      const capture = sectionOf(content, '## Part 1', '## Part 2');
      expect(capture).toContain('git show <ref>:<path>');
      expect(capture).toMatch(phrase('never `git grep`'));
    });
  });

  describe('maintenance ladder', () => {
    it('rotates first, then takes the work list from claim-due once', () => {
      const part2 = sectionOf(content, '## Part 2', '## Finishing');
      const rotate = part2.indexOf('json-helper.cjs" rotate-observations');
      const due = part2.indexOf('json-helper.cjs" claim-due');
      expect(rotate).toBeGreaterThan(-1);
      expect(due).toBeGreaterThan(rotate);
    });

    // AC-403, D-MAINTAIN-ON-DUE: the body asks claim-due, ends Part 2 on `due none`, and only
    // otherwise reads the maintain step, so a run with nothing due never pays for the ladder.
    describe('maintenance runs only when entries are due (AC-403)', () => {
      const MAINTAIN_PATH_TEXT = 'skills/devflow:agent-references/references/curate/maintain.md';

      /** Named collector: the Part 2 stub's order or content defects. */
      function collectStubDefects(body: string): string[] {
        const part2 = sectionOf(body, '## Part 2', '## Finishing');
        if (part2 === '') return ['no Part 2 section'];
        const out: string[] = [];
        const due = part2.indexOf('json-helper.cjs" claim-due');
        const none = part2.indexOf('`due none` ends Part 2');
        const read = part2.indexOf(MAINTAIN_PATH_TEXT);
        if (due === -1) out.push('the claim-due call is missing');
        if (none === -1) out.push('the "`due none` ends Part 2" line is missing');
        if (read === -1) out.push('the maintain reference path is missing');
        if (due !== -1 && none !== -1 && none < due) out.push('`due none` comes before claim-due');
        if (none !== -1 && read !== -1 && read < none) out.push('the reference is read before `due none` ends Part 2');
        if (!/\bRead\b/.test(part2.slice(Math.max(none, 0)))) out.push('the stub does not tell the agent to Read the reference');
        if (/\*\*LLM judgment — the maintenance ladder/.test(part2)) out.push('the ladder is still in the body');
        return out;
      }

      it('claim-due, then `due none` ends Part 2, then the reference is read', () => {
        expect(collectStubDefects(content)).toEqual([]);
      });

      it('the maintain step is not in the body and is in the reference', () => {
        expect(content).not.toContain('RETIRE BY STATUS');
        expect(content).not.toContain('1. **Encoded**');
        expect(maintain).toContain('1. **Encoded**');
        expect(maintain).toContain('RETIRE BY STATUS');
      });

      /**
       * Named collector: where the sanctioned resolution line sits at the two read sites. Inputs holds it once,
       * before the first `$d/` it binds; Part 2 holds it once, before the maintain path it resolves. The sections
       * come from the fence-aware splitter, so a `## ` line quoted in a fence does not cut one short. The total
       * across the file is pinned once, in `SITE_ROWS` (tests/guards/claude-dir.test.ts).
       */
      function collectReadSiteDefects(body: string): string[] {
        const sections = commandReferenceSections(body);
        const inputs = sections.find(sec => sec.heading === 'Inputs')?.body;
        const part2 = sections.find(sec => sec.heading.startsWith('Part 2'))?.body;
        const out: string[] = [];
        const countIn = (text: string): number => text.split(SANCTIONED_RESOLUTION).length - 1;
        if (inputs === undefined) out.push('no Inputs section');
        else {
          const line = inputs.indexOf(SANCTIONED_RESOLUTION);
          const use = inputs.indexOf('$d/');
          if (countIn(inputs) !== 1) out.push(`Inputs holds ${countIn(inputs)} sanctioned resolution lines, expected 1`);
          if (use === -1) out.push('Inputs never uses "$d/"');
          if (line !== -1 && use !== -1 && use < line) out.push('Inputs uses "$d/" before the sanctioned resolution line');
        }
        if (part2 === undefined) out.push('no Part 2 section');
        else {
          const line = part2.indexOf(SANCTIONED_RESOLUTION);
          const read = part2.indexOf(MAINTAIN_PATH_TEXT);
          if (countIn(part2) !== 1) out.push(`Part 2 holds ${countIn(part2)} sanctioned resolution lines, expected 1`);
          if (read === -1) out.push('Part 2 never names the maintain reference path');
          if (line !== -1 && read !== -1 && read < line) out.push('Part 2 names the maintain reference path before the sanctioned resolution line');
        }
        return out;
      }

      it('resolves the config directory the way the rule-file listing does', () => {
        expect(collectReadSiteDefects(content)).toEqual([]);
        expect(content).not.toContain(RETIRED_INLINE_EXPANSION);
        expect(content).toContain(MAINTAIN_PATH_TEXT);
      });

      it('known-bad probes: a second line, a line after its use, a missing line, a missing `$d/` use, a missing or late reference path, a fenced heading and lost sections are each reported', () => {
        const find = `cd "<project root>" && find "$d/rules/devflow" -name '*.md'`;
        const sections = (inputs: string, part2: string): string => `## Inputs\n${inputs}\n## Part 2 — Maintain\n${part2}\n## Finishing\n`;
        const okInputs = `${SANCTIONED_RESOLUTION} ${find}`;
        const okPart2 = `${SANCTIONED_RESOLUTION_PRINT}\nRead <that directory>/${MAINTAIN_PATH_TEXT}`;
        expect(collectReadSiteDefects(sections(okInputs, okPart2)), 'the clean seed is clean, so each seed fails for its own reason').toEqual([]);
        expect(collectReadSiteDefects(sections(`\`\`\`text\n## quoted\n\`\`\`\n${okInputs}`, okPart2)), 'a fenced heading does not end Inputs').toEqual([]);

        expect(collectReadSiteDefects(sections(`${SANCTIONED_RESOLUTION} ${okInputs}`, okPart2))).toEqual([
          'Inputs holds 2 sanctioned resolution lines, expected 1',
        ]);
        expect(collectReadSiteDefects(sections(`${find}; ${SANCTIONED_RESOLUTION}`, okPart2))).toEqual([
          'Inputs uses "$d/" before the sanctioned resolution line',
        ]);
        expect(collectReadSiteDefects(sections(SANCTIONED_RESOLUTION, okPart2))).toEqual([
          'Inputs never uses "$d/"',
        ]);
        expect(collectReadSiteDefects(sections(okInputs, SANCTIONED_RESOLUTION_PRINT))).toEqual([
          'Part 2 never names the maintain reference path',
        ]);
        expect(collectReadSiteDefects(sections(okInputs, `Read <that directory>/${MAINTAIN_PATH_TEXT}`))).toEqual([
          'Part 2 holds 0 sanctioned resolution lines, expected 1',
        ]);
        expect(collectReadSiteDefects(sections(okInputs, `Read <that directory>/${MAINTAIN_PATH_TEXT}\n${SANCTIONED_RESOLUTION}`))).toEqual([
          'Part 2 names the maintain reference path before the sanctioned resolution line',
        ]);
        expect(collectReadSiteDefects('## Finishing\n')).toEqual(['no Inputs section', 'no Part 2 section']);
      });

      it('known-bad probes: a reference read before `due none`, a ladder left in the body and a missing call are each reported', () => {
        const part2 = (inner: string): string => `## Part 2\n${inner}\n## Finishing\n`;
        const ok = '`json-helper.cjs" claim-due`\n`due none` ends Part 2. Otherwise Read ' + MAINTAIN_PATH_TEXT + '\n';
        expect(collectStubDefects(part2(ok))).toEqual([]);
        expect(collectStubDefects(part2('Read ' + MAINTAIN_PATH_TEXT + '\n`json-helper.cjs" claim-due`\n`due none` ends Part 2.\n'))).toContain(
          'the reference is read before `due none` ends Part 2',
        );
        expect(collectStubDefects(part2(ok + '**LLM judgment — the maintenance ladder.**\n'))).toEqual(['the ladder is still in the body']);
        expect(collectStubDefects(part2('`due none` ends Part 2. Read ' + MAINTAIN_PATH_TEXT + '\n'))).toEqual(['the claim-due call is missing']);
      });
    });

    it('takes the first matching rung, in order: Encoded, no longer true, duplicate, one-off, Keep', () => {
      const rungs = ['1. **Encoded**', '2. **No longer true', '3. **Duplicate**', '4. **One-off**', '5. **Keep**']
        .map(rung => maintain.indexOf(rung));
      expect(rungs.every(i => i > -1), `every rung stated: ${rungs.join(', ')}`).toBe(true);
      expect([...rungs].sort((a, b) => a - b)).toEqual(rungs);
    });

    it('holds Encoded to the strict bar and lets plumbing check the quote', () => {
      expect(maintain).toMatch(phrase('a test or guard that fails on a new violation anywhere in'));
      expect(maintain).toMatch(phrase('One JSDoc line does not count'));
      expect(maintain).toMatch(phrase('checks the quote in the file as committed at the verify ref'));
    });

    it('gives each entry exactly one final action, keeping it when unsure', () => {
      expect(maintain).toMatch(phrase('Exactly one final action per entry'));
      expect(maintain).toMatch(phrase('when unsure, Keep', 'i'));
    });

    it('closes with one batched refresh-anchor --verified of the kept entries', () => {
      expect(maintain).toContain('json-helper.cjs" refresh-anchor <anchor> [<anchor>...] --verified');
      expect(maintain).toMatch(phrase('a v1 entry refuses the whole batch'));
    });
  });

  describe('retired rules stay out', () => {
    it('carries no curation cap, protection window or refresh cap', () => {
      expect(prompt).not.toMatch(phrase('≤5 curation changes'));
      expect(prompt).not.toMatch(phrase('stop after 5 changes'));
      expect(prompt).not.toMatch(phrase('7-day protection window'));
      expect(prompt).not.toMatch(phrase('at most 10 anchors'));
    });

    it('carries no confidence gate and no v1 observation fields', () => {
      expect(prompt).not.toMatch(/confidence\s*[>=]+\s*0\.\d+/);
      expect(prompt).not.toMatch(/low-confidence/i);
      expect(prompt).not.toContain('"confidence"');
      expect(prompt).not.toContain('quality_ok');
      expect(prompt).not.toContain('cat >> .devflow/curation/decisions-log.jsonl');
    });

    it('carries no usage grounding, citation re-pointing or collision stop', () => {
      expect(prompt).not.toContain('.decisions-usage.json');
      expect(prompt).not.toMatch(phrase('Citation preservation', 'i'));
      expect(prompt).not.toContain('next-anchor');
      expect(prompt).not.toContain('--allow-collision');
      expect(prompt).not.toMatch(phrase('git grep -nE'));
      expect(prompt).not.toMatch(phrase('STOP rule'));
    });

    it('names no ledger entry by number', () => {
      expect(prompt).not.toMatch(/\b(?:ADR|PF)-\d{3}\b/);
    });

    it('does not reference worker-era scripts or stamps', () => {
      for (const retired of ['count-active', 'staleness.cjs', 'merge-observation', '.last-dream-ok', 'last-run-summary']) {
        expect(prompt, retired).not.toContain(retired);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Lockstep tests — structural consistency between the Curate agent's claim
// and related infrastructure (staleness threshold, directive, build output).
// ---------------------------------------------------------------------------

describe('lockstep: the claim staleness threshold', () => {
  const SESSION_START_CONTEXT = path.resolve(ROOT, 'src/assets/scripts/hooks/session-start-context');

  it('session-start-context directive uses 900s as the freshness threshold', async () => {
    // Let readFile throw if the hook is missing — a missing hook is a real failure, not a skip
    const hookContent = await fs.readFile(SESSION_START_CONTEXT, 'utf-8');
    expect(hookContent).toContain('PROCESSING_STALE_SECS=900');
  });

  it('the claim-queue op takes over a claim at the same threshold the directive treats as stale', async () => {
    const hookContent = await fs.readFile(SESSION_START_CONTEXT, 'utf-8');
    const { CLAIM_STALE_SECS } = createRequire(import.meta.url)(CURATION_STORE) as { CLAIM_STALE_SECS: number };
    expect(CLAIM_STALE_SECS).toBe(900);
    expect(hookContent).toContain(`PROCESSING_STALE_SECS=${CLAIM_STALE_SECS}`);
  });
});

describe('lockstep: no shipped artifact references .devflow/dream/ or subagent_type="Dream"', () => {
  // After the src/ restructure: shared/ → src/assets/, scripts/hooks/ → src/assets/scripts/hooks/,
  // commands/ → src/assets/commands/. Scan src/assets/ as the single source tree.
  const SHIPPED_DIRS = [
    path.join(ROOT, 'src', 'assets'),
  ];

  it('no .md or .mds file in src/assets/ references .devflow/dream/', () => {
    const files = SHIPPED_DIRS.flatMap(dir => findFiles(dir, ['.md', '.mds']));
    // A scan-based test whose corpus went empty after a rename
    // passes vacuously and silently stops guarding anything.
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const f of files) {
      // Guard against TOCTOU: a parallel test (build-mds.test.ts) may plant and unlink
      // transient _test-*.mds fixtures in commands/ between our readdir and this read.
      // A vanished file cannot be a shipping violation — skip it. Rethrow all other errors.
      let content: string;
      try {
        content = fsSync.readFileSync(f, 'utf-8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      if (content.includes('.devflow/dream/')) {
        violations.push(path.relative(ROOT, f));
      }
    }

    expect(violations).toEqual([]);
  });

  it('no .md or .mds file in src/assets/ references subagent_type="Dream"', () => {
    const files = findFiles(path.join(ROOT, 'src', 'assets'), ['.md', '.mds']);
    // Assert the scanned corpus is non-empty (see sibling test).
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const f of files) {
      // Defensive ENOENT guard (consistent with the sibling test above).
      let content: string;
      try {
        content = fsSync.readFileSync(f, 'utf-8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      if (content.includes('subagent_type="Dream"') || content.includes("subagent_type='Dream'")) {
        violations.push(path.relative(ROOT, f));
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('lockstep: dream.md not in src/assets/agents/', () => {
  it('dream.md does not exist in src/assets/agents/ (renamed to curate.md)', () => {
    // Ensures the old agent name never resurfaces in the canonical assets dir
    const dreamPath = path.join(ROOT, 'src', 'assets', 'agents', 'dream.md');
    expect(fsSync.existsSync(dreamPath), 'src/assets/agents/dream.md must not exist (use curate.md)').toBe(false);
  });
});

describe('AC-C9: decisions_load() (none) fallback for both absent and empty index', () => {
  // commands/ moved to src/assets/commands/ during the src/ restructure.
  const DECISIONS_MDS = path.resolve(ROOT, 'src/assets/commands/_partials/_decisions.mds');

  it('_decisions.mds sets DECISIONS_CONTEXT to (none) when index is absent', async () => {
    const content = await fs.readFile(DECISIONS_MDS, 'utf-8');
    expect(content).toContain('(none)');
  });

  it('_decisions.mds sets DECISIONS_CONTEXT to (none) when index is empty', async () => {
    const content = await fs.readFile(DECISIONS_MDS, 'utf-8');
    // Both "absent or empty" cases must be handled
    expect(content).toMatch(/absent or empty.*\(none\)/s);
  });

  it('_decisions.mds reads from .devflow/curation/index.md (not the old decisions/ path)', async () => {
    const content = await fs.readFile(DECISIONS_MDS, 'utf-8');
    expect(content).toContain('.devflow/curation/index.md');
    expect(content).not.toContain('.devflow/decisions/index.md');
  });
});

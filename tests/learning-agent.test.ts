import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { AGENT_CONFIG } from './fixtures/agent-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_PATH = path.resolve(__dirname, '../src/assets/agents/learning.md');
const ROOT = path.resolve(__dirname, '..');
const LEARNING_STORE = path.resolve(ROOT, 'src/assets/scripts/hooks/lib/learning-store.cjs');

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

describe('learning agent', () => {
  let content: string;
  let frontmatter: string;

  beforeAll(async () => {
    content = await fs.readFile(AGENT_PATH, 'utf-8');
    frontmatter = parseFrontmatter(content);
  });

  describe('frontmatter', () => {
    // D-LEARNING-SHIPPED-ROW: the model and effort are the Learning row of the agent-config
    // table, so a change of tier is an edit to that row and to the two frontmatter lines.
    const row = AGENT_CONFIG.learning;

    it('is named Learning and ships the model and effort of its table row', () => {
      expect(frontmatter).toMatch(/^name: Learning$/m);
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

    // D-LEARNING-SHIPPED-ROW: the Encoded-retirement check reads the rules in the root
    // CLAUDE.md, so Learning keeps that context.
    it('keeps the project CLAUDE.md: its Encoded-retirement check reads the root CLAUDE.md', () => {
      expect(frontmatter).not.toMatch(/^omitClaudeMd:/m);
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
      expect(content).not.toContain('mv .devflow/learning/.pending-turns.jsonl');
      expect(content).not.toContain('unlink .devflow/learning/.pending-turns.processing');
      expect(content).not.toContain('cat .devflow/learning/.pending-turns.jsonl >>');
      expect(content).not.toMatch(/\brm -[rf]+[^\n]*\.pending-turns\.processing/);
    });

    it('heartbeats with touch -c at the Part 1 → Part 2 boundary and after each maintained entry', () => {
      expect(content).toContain('touch -c .devflow/learning/.pending-turns.processing');
      expect(content).toMatch(inOrder(['Heartbeat', 'Part 1 → Part 2 boundary']));
      expect(sectionOf(content, '## Part 2', '## Finishing')).toMatch(phrase('After each maintained entry, refresh the claim'));
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

    it('runs every op through json-helper from the project root', () => {
      expect(content).toContain('node "$HOME/.devflow/scripts/hooks/json-helper.cjs" <op>');
      expect(content).toContain('cd "<project root>" &&');
      for (const op of [
        'claim-queue', 'release-claim', 'put-observation', 'assign-anchor', 'retire-anchor',
        'refresh-anchor', 'rotate-observations', 'claim-due',
      ]) {
        expect(content, op).toMatch(new RegExp(`json-helper\\.cjs" ${op}\\b`));
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
        expect(content, form).toContain(form);
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
      const { buildListing, formatListing } = createRequire(import.meta.url)(LEARNING_STORE) as {
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
      const store = fsSync.readFileSync(LEARNING_STORE, 'utf-8');
      for (const reason of ['duplicate-obs-id', 'ledger-without-log', 'scope-matches-nothing', 'legacy-v1', 'verify-age']) {
        expect(store, `the store produces ${reason}`).toContain(`'${reason}'`);
        expect(content, `the prompt names ${reason}`).toContain(`\`${reason}\``);
      }
    });

    it('sends text to an op only as one JSON object on stdin, through a quoted heredoc', () => {
      expect(content).toMatch(phrase('Text goes on stdin, never on the command line'));
      expect(content).toContain("put-observation --create <<'EOF'");
      expect(content).toContain("retire-anchor <anchor> Encoded <<'EOF'");
    });

    it('gives each retire status its stdin shape', () => {
      expect(content).toContain('{"reason": "<why, one line, 1 to 120 characters>"}');
      expect(content).toContain('{"by": "<anchor>"}');
      expect(content).toMatch(/\{"at": "<path from the repository root>", "quote": "[^"]+"\}/);
      expect(content).toContain('RETIRE BY STATUS');
      expect(content).toContain('never hand-edit the .md');
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
      const maintain = sectionOf(content, '## Part 2', '## Finishing');
      const rotate = maintain.indexOf('json-helper.cjs" rotate-observations');
      const due = maintain.indexOf('json-helper.cjs" claim-due');
      expect(rotate).toBeGreaterThan(-1);
      expect(due).toBeGreaterThan(rotate);
    });

    it('takes the first matching rung, in order: Encoded, no longer true, duplicate, one-off, Keep', () => {
      const maintain = sectionOf(content, '## Part 2', '## Finishing');
      const rungs = ['1. **Encoded**', '2. **No longer true', '3. **Duplicate**', '4. **One-off**', '5. **Keep**']
        .map(rung => maintain.indexOf(rung));
      expect(rungs.every(i => i > -1), `every rung stated: ${rungs.join(', ')}`).toBe(true);
      expect([...rungs].sort((a, b) => a - b)).toEqual(rungs);
    });

    it('holds Encoded to the strict bar and lets plumbing check the quote', () => {
      const maintain = sectionOf(content, '## Part 2', '## Finishing');
      expect(maintain).toMatch(phrase('a test or guard that fails on a new violation anywhere in'));
      expect(maintain).toMatch(phrase('One JSDoc line does not count'));
      expect(maintain).toMatch(phrase('checks the quote in the file as committed at the verify ref'));
    });

    it('gives each entry exactly one final action, keeping it when unsure', () => {
      const maintain = sectionOf(content, '## Part 2', '## Finishing');
      expect(maintain).toMatch(phrase('Exactly one final action per entry'));
      expect(maintain).toMatch(phrase('when unsure, Keep', 'i'));
    });

    it('closes with one batched refresh-anchor --verified of the kept entries', () => {
      const maintain = sectionOf(content, '## Part 2', '## Finishing');
      expect(maintain).toContain('json-helper.cjs" refresh-anchor <anchor> [<anchor>...] --verified');
      expect(maintain).toMatch(phrase('a v1 entry refuses the whole batch'));
    });
  });

  describe('retired rules stay out', () => {
    it('carries no curation cap, protection window or refresh cap', () => {
      expect(content).not.toMatch(phrase('≤5 curation changes'));
      expect(content).not.toMatch(phrase('stop after 5 changes'));
      expect(content).not.toMatch(phrase('7-day protection window'));
      expect(content).not.toMatch(phrase('at most 10 anchors'));
    });

    it('carries no confidence gate and no v1 observation fields', () => {
      expect(content).not.toMatch(/confidence\s*[>=]+\s*0\.\d+/);
      expect(content).not.toMatch(/low-confidence/i);
      expect(content).not.toContain('"confidence"');
      expect(content).not.toContain('quality_ok');
      expect(content).not.toContain('cat >> .devflow/learning/decisions-log.jsonl');
    });

    it('carries no usage grounding, citation re-pointing or collision stop', () => {
      expect(content).not.toContain('.decisions-usage.json');
      expect(content).not.toMatch(phrase('Citation preservation', 'i'));
      expect(content).not.toContain('next-anchor');
      expect(content).not.toContain('--allow-collision');
      expect(content).not.toMatch(phrase('git grep -nE'));
      expect(content).not.toMatch(phrase('STOP rule'));
    });

    it('names no ledger entry by number', () => {
      expect(content).not.toMatch(/\b(?:ADR|PF)-\d{3}\b/);
    });

    it('does not reference worker-era scripts or stamps', () => {
      for (const retired of ['count-active', 'staleness.cjs', 'merge-observation', '.last-dream-ok', 'last-run-summary']) {
        expect(content, retired).not.toContain(retired);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Lockstep tests — structural consistency between the Learning agent's claim
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
    const { CLAIM_STALE_SECS } = createRequire(import.meta.url)(LEARNING_STORE) as { CLAIM_STALE_SECS: number };
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
  it('dream.md does not exist in src/assets/agents/ (renamed to learning.md)', () => {
    // Ensures the old agent name never resurfaces in the canonical assets dir
    const dreamPath = path.join(ROOT, 'src', 'assets', 'agents', 'dream.md');
    expect(fsSync.existsSync(dreamPath), 'src/assets/agents/dream.md must not exist (use learning.md)').toBe(false);
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

  it('_decisions.mds reads from .devflow/learning/index.md (not the old decisions/ path)', async () => {
    const content = await fs.readFile(DECISIONS_MDS, 'utf-8');
    expect(content).toContain('.devflow/learning/index.md');
    expect(content).not.toContain('.devflow/decisions/index.md');
  });
});

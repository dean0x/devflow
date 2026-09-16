/**
 * Fence-grammar guard — every rule of the harness's one fence scanner is
 * falsifiable, and no file in the always-loaded git corpus ends inside a fence.
 *
 * `collectUnfencedLines` (tests/helpers.ts) owns the answer to "is this column-0
 * line structure or payload?" for the operation-section extractor, the
 * generated-reference structure guard, and the capability-hoist process-block
 * terminator. PF-063 records why it exists. PF-018 records why a docblock
 * describing its grammar is not the same thing as a suite that can tell when the
 * grammar changed: three of the four rules that docblock states could be
 * inverted with the whole repo green — a backtick fence's info string may not
 * itself contain a backtick, a closing run must be at least as long as the
 * opening one, and a closing line must carry nothing after the marker but
 * whitespace. Each gets a synthetic corpus below, as does the <=3-space
 * indentation bound the open and close rules share.
 *
 * Why here and not beside the extractor's probes. Four probes in
 * tests/guards/agent-source-resolver.test.ts already exercise this grammar END
 * TO END, through `extractOpSectionFromCorpus`, because that file owns the
 * extractor's contract. These call the primitive directly: a rule inverted
 * inside the scanner is a defect OF the scanner, and a probe that can only see
 * it through a caller reports it as something else. The two files are one claim
 * split by seam, not the same claim twice.
 *
 * Each probe pairs the rule with its control — the same document with the one
 * character that engages the rule removed — so a scanner that simply stopped
 * opening fences, or stopped closing them, fails here rather than passing half
 * the block.
 *
 * The corpus claim is the half that cannot be made synthetically. An unclosed
 * fence in a shipped file is invisible to every guard that reads BELOW it and
 * turns their green into the wrong kind of green, so the assertion has to run
 * over the real always-loaded set.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { compiledSkillRefsDir } from '../../src/core/assets.js';
import { generatedReferenceManifest } from '../../src/core/mds-variants.js';
import {
  ROOT,
  collectUnclosedFences,
  collectUnfencedH2,
  loadFile,
  resolveAgentSource,
} from '../helpers.js';

/** The column-0 `## ` lines a document exposes as structure, in document order. */
function unfencedHeadings(text: string): string[] {
  return collectUnfencedH2(text).map(heading => heading.text);
}

const OP_HEADING = '## Operation: probe-op';

// ---------------------------------------------------------------------------
// 1. The fence grammar, rule by rule
// ---------------------------------------------------------------------------

describe('fence grammar: a backtick fence\'s info string may not contain a backtick', () => {
  // ```gh pr view``` at column 0 is an inline code span, not a fence opener:
  // CommonMark forbids a backtick inside a backtick fence's info string, exactly
  // so a one-line span cannot swallow the rest of the document. Read as an
  // opener it opens a fence nothing below closes.
  const INLINE_SPAN =
    OP_HEADING + '\n' +
    '\n' +
    '```gh pr view --json title``` is the probe command.\n' +
    '\n' +
    '## Another Section\n' +
    '\n' +
    'TAIL\n';

  // The control: the same line with the closing run deleted. Now the info string
  // holds no backtick, so this one IS an opener — and the heading disappears.
  const REAL_OPENER =
    OP_HEADING + '\n' +
    '\n' +
    '```gh pr view --json title\n' +
    '\n' +
    '## Another Section\n' +
    '\n' +
    'TAIL\n';

  it('an inline code span at column 0 does not open a fence', () => {
    expect(
      unfencedHeadings(INLINE_SPAN),
      'a line whose backtick run is closed on the same line is prose — reading it as an opener ' +
      'hides every heading below it, and the document has no delimiter left to close',
    ).toEqual([OP_HEADING, '## Another Section']);
  });

  it('the same run without a backtick in its info string does open one (control)', () => {
    expect(
      unfencedHeadings(REAL_OPENER),
      'deleting the closing backticks must change the verdict — otherwise the rule above passed ' +
      'because the scanner stopped opening fences, not because it applied the info-string rule',
    ).toEqual([OP_HEADING]);
  });
});

describe('fence grammar: a closing run must be at least as long as the opening run', () => {
  // The four-backtick fence is how a Markdown sample that itself contains a
  // fenced block is written. If a shorter run could close it, the sample's own
  // ``` would end the fence and the sample's headings would become structure.
  const NESTED_SAMPLE =
    OP_HEADING + '\n' +
    '\n' +
    '````markdown\n' +
    '```bash\n' +
    'gh issue view "$ISSUE"\n' +
    '```\n' +
    '## Inside The Sample\n' +
    '````\n' +
    '\n' +
    '## After The Fence\n';

  it('a shorter run inside a longer fence does not close it', () => {
    expect(
      unfencedHeadings(NESTED_SAMPLE),
      'the sample\'s own 3-backtick run must not close the 4-backtick fence around it: if it does, ' +
      '`## Inside The Sample` becomes a section terminator and the real content below is cut off',
    ).toEqual([OP_HEADING, '## After The Fence']);
  });

  it('a run of equal length does close it (control)', () => {
    // Same document, opened with three backticks instead of four — now the inner
    // run matches the opening length and the fence closes there.
    const EQUAL_RUN = NESTED_SAMPLE.replace('````markdown\n', '```markdown\n');
    expect(EQUAL_RUN, 'the control must actually differ from the probe').not.toBe(NESTED_SAMPLE);
    expect(
      unfencedHeadings(EQUAL_RUN),
      'a run at the opening length must close the fence — otherwise the rule above passed because ' +
      'the scanner closes on nothing at all',
    ).toEqual([OP_HEADING, '## Inside The Sample']);
  });
});

describe('fence grammar: a closing line carries nothing after the marker but whitespace', () => {
  // ```json inside a ```bash block is a second opener in Markdown terms, never a
  // close. A scanner that closed on it would end the block early and promote the
  // heredoc's own `## Items` to structure.
  const INFO_ON_CANDIDATE =
    OP_HEADING + '\n' +
    '\n' +
    '```bash\n' +
    'printf "%s" "$body" > "$DEVFLOW_BODY_RAW"\n' +
    '```json\n' +
    '## Items\n' +
    '```\n' +
    '\n' +
    '## After The Fence\n';

  // The other half of the same rule: trailing whitespace after the marker is
  // still a close. "Nothing but whitespace" is not "nothing".
  const TRAILING_WHITESPACE =
    OP_HEADING + '\n' +
    '\n' +
    '```bash\n' +
    '## Items\n' +
    '```   \n' +
    '\n' +
    '## After The Fence\n';

  it('a marker carrying an info string does not close the open fence', () => {
    expect(
      unfencedHeadings(INFO_ON_CANDIDATE),
      'closing on an info-bearing marker ends the block at the wrong line, and every column-0 ' +
      'heading the block quotes becomes a section terminator',
    ).toEqual([OP_HEADING, '## After The Fence']);
  });

  it('a marker followed only by whitespace does close it (control)', () => {
    expect(
      unfencedHeadings(TRAILING_WHITESPACE),
      'trailing spaces after the marker are invisible in a diff and must not decide whether a ' +
      'fence closed — the rule is whitespace-only, not empty',
    ).toEqual([OP_HEADING, '## After The Fence']);
  });
});

describe('fence grammar: a delimiter is indented at most three spaces', () => {
  // Four spaces is an indented code block, which the grammar's written non-goals
  // (PF-064) say are not modelled — and need not be, because every `## ` inside
  // one is itself indented and so was never a column-0 heading.
  const FOUR_SPACES =
    OP_HEADING + '\n' +
    '\n' +
    '    ```bash\n' +
    '    gh issue view "$ISSUE"\n' +
    '\n' +
    '## After The Block\n';

  const THREE_SPACES =
    OP_HEADING + '\n' +
    '\n' +
    '   ```bash\n' +
    '   gh issue view "$ISSUE"\n' +
    '\n' +
    '## After The Block\n';

  it('a four-space-indented run does not open a fence', () => {
    expect(
      unfencedHeadings(FOUR_SPACES),
      'an indented code block is not a fence: opening one here would swallow the rest of the ' +
      'document, since an indented block has no closing delimiter to find',
    ).toEqual([OP_HEADING, '## After The Block']);
  });

  it('a three-space-indented run does open one (control)', () => {
    expect(
      unfencedHeadings(THREE_SPACES),
      'three spaces is still a fence — otherwise the bound above passed because the scanner ' +
      'refuses every indented delimiter',
    ).toEqual([OP_HEADING]);
  });
});

// ---------------------------------------------------------------------------
// 2. collectUnclosedFences — known-bad probes, both directions
// ---------------------------------------------------------------------------

/** The delimiter the corpus probe below appends. Never closed, by construction. */
const SEED_OPENER = '```bash';

describe('collectUnclosedFences: the text ends inside a fence', () => {
  it('reports the opening delimiter, with the line a fix has to go to', () => {
    const text = 'intro\n\n```bash\ngh issue view "$ISSUE"\n## Items\n';
    expect(
      collectUnclosedFences(text),
      'the report has to name where the fence opened: the symptom appears at the END of the file, ' +
      'and the delimiter that caused it is the only actionable location',
    ).toEqual([{ line: 3, index: 7, text: '```bash' }]);
  });

  it('reports nothing when every fence closes', () => {
    const text = 'intro\n\n```bash\ngh issue view "$ISSUE"\n```\n\n## Items\n';
    expect(
      collectUnclosedFences(text),
      'a collector that reported a balanced document would fail only on the real corpus, where it ' +
      'would read as a corpus defect rather than as its own',
    ).toEqual([]);
  });

  it('reports nothing for a run that never opened a fence', () => {
    expect(
      collectUnclosedFences('```gh pr view``` in prose.\n'),
      'an inline code span opens nothing, so there is nothing left open at end of text',
    ).toEqual([]);
  });

  it('a delimiter that cannot close the open fence leaves it open', () => {
    // Shares the grammar with collectUnfencedLines rather than re-deriving it: a
    // short run and an info-bearing marker are both non-closers above, and both
    // must leave this collector reporting the original opener (PF-018).
    expect(
      collectUnclosedFences('````markdown\n```\nsample\n').map(fence => fence.text),
      'a shorter run must not satisfy this collector either — the two must read one grammar',
    ).toEqual(['````markdown']);
    expect(
      collectUnclosedFences('```bash\n## Items\n```json\n').map(fence => fence.text),
      'an info-bearing marker must not satisfy this collector either',
    ).toEqual(['```bash']);
  });
});

// ---------------------------------------------------------------------------
// 3. The live corpus has no unclosed fence
// ---------------------------------------------------------------------------

/** The always-loaded skill contract, read as a repository-relative path. */
const GIT_SKILL_MD = 'src/assets/skills/git/SKILL.md';

interface CorpusFile {
  /** Repository- or manifest-relative path, for the failure message. */
  label: string;
  content: string;
}

/**
 * Everything a Git-agent spawn can load: the compiled agent, the always-loaded
 * skill contract, and every generated reference an operation's mechanics pointer
 * names.
 *
 * Manifest-driven and throwing, never a directory walk: a walk over an absent
 * tree returns nothing, and "no unclosed fence in zero files" is the shape of a
 * guard that is not a guard (PF-018). A build artifact is a throw with a build
 * hint, never a skip.
 */
function alwaysLoadedGitCorpus(): CorpusFile[] {
  const git = resolveAgentSource('git');
  const corpus: CorpusFile[] = [
    { label: path.relative(ROOT, git.path), content: git.content },
    { label: GIT_SKILL_MD, content: loadFile(GIT_SKILL_MD) },
  ];
  const refsDir = compiledSkillRefsDir();
  for (const relPath of generatedReferenceManifest()) {
    const absPath = path.join(refsDir, relPath);
    try {
      corpus.push({ label: relPath, content: readFileSync(absPath, 'utf-8') });
    } catch {
      throw new Error(
        `Generated reference ${relPath} is absent at ${absPath} — run \`npm run build\` first ` +
        '(this guard reads compiled reference files and cannot be skipped)',
      );
    }
  }
  return corpus;
}

describe('every fence in the always-loaded git corpus closes', () => {
  const corpus = alwaysLoadedGitCorpus();

  it('the corpus is the declared set, not whatever happened to be on disk', () => {
    // The manifest's own size is floored in tests/fixtures/numeric-floors.json and
    // asserted by the generated-reference structure guard; what is claimed here is
    // only that this corpus is that manifest plus the two always-loaded files.
    expect(
      corpus.map(file => file.label),
      'the corpus must be every generated reference plus the agent and its skill contract',
    ).toHaveLength(generatedReferenceManifest().length + 2);
    for (const file of corpus) {
      expect(file.content.length, `${file.label} resolved to empty content`).toBeGreaterThan(0);
    }
  });

  it('no corpus file ends inside a fence', () => {
    const unclosed = corpus.flatMap(file =>
      collectUnclosedFences(file.content).map(fence => `${file.label}:${fence.line}: ${fence.text}`),
    );
    expect(
      unclosed,
      'a file in the always-loaded git corpus ends inside a fence:\n' +
      unclosed.join('\n') + '\n' +
      'Under the fence grammar every column-0 `## ` below that delimiter is payload, so every ' +
      'union-mode section extraction runs to end of file, every absence assertion over the tail ' +
      'passes for the wrong reason, and the fenced-`## ` non-vacuity floor counts UP as the ' +
      'corpus degrades. Close the fence at its SOURCE — the .mds host or the hand-authored ' +
      'reference, never the generated file.',
    ).toEqual([]);
  });

  it('the assertion is non-vacuous: a seeded unclosed fence is reported in every corpus file', () => {
    // Known-bad probe over the REAL content of every file, not one synthetic
    // stand-in: the assertion above is an absence, and an absence is only as
    // strong as the proof that its collector was live over each member (PF-018).
    for (const file of corpus) {
      const seeded = `${file.content}\n${SEED_OPENER}\ngh issue view "$ISSUE"\n`;
      expect(
        collectUnclosedFences(seeded).map(fence => fence.text),
        `${file.label}: seeding an unclosed fence must be reported — if it is not, the assertion ` +
        'above is green over this file for the wrong reason',
      ).toEqual([SEED_OPENER]);
    }
  });
});

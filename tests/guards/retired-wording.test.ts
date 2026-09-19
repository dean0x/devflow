/**
 * Retired-wording guard (GAP-32).
 *
 * ONE shared grep over ONE denylist. A literal deliberately removed from the
 * shipping assets, the compiled output or the repo's own prose is registered in
 * RETIRED_LITERALS with the file it left and the reason it went, and the guard
 * refuses to let it back in. Retiring a literal means adding a row here — never a
 * new describe block, and never a second list somewhere else: two lists is how one
 * goes stale, and the narrower one is always the one that stays green.
 *
 * A widened corpus only raises detection when the VOCABULARY widens with it. Two
 * documentation literals once survived a sweep purely by being spelled differently
 * in files the corpus already scanned (PF-025), so the response to residue found
 * outside the shipping assets is to widen the corpus and register the spelling —
 * never to loosen the denylist to fit what is there (R2).
 *
 * Non-vacuity: denylist size and corpus size are both asserted, and a seeded
 * retired literal in a synthetic file fails the guard — proven inline, without
 * touching committed source.
 *
 * Entry format: `{ literal, removedFrom, justification, pattern?, scope? }`.
 * `removedFrom` records where the literal used to live — traceability, not a
 * dynamic constraint. `scope` narrows an entry to the trees it is retired FROM;
 * `pattern` replaces the substring test for residue whose spellings cannot be
 * enumerated in advance.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// The denylist — grows as literals are retired; never a new grep; never emptied
// ---------------------------------------------------------------------------
interface RetiredEntry {
  literal: string;
  removedFrom: string;
  justification: string;
  /**
   * Matches a CLASS of retired wording rather than one spelling. When present it
   * replaces the `literal` substring test and `literal` becomes the entry's
   * human-readable name in the failure message.
   *
   * Reserved for residue whose members are not enumerable in advance — a wave
   * coordinate is minted by whoever writes the next wave, so a fixed list would go
   * stale the moment it mattered. Everything with a knowable spelling stays a
   * literal, individually classified (applies ADR-025).
   */
  pattern?: RegExp;
  /**
   * Corpus path prefixes this literal is retired FROM, spelled as the corpus spells
   * them (`dist/commands/`, `src/assets/skills/git/`, …). Absent means the whole
   * corpus.
   *
   * `gh issue` is the case that needs it: RETIRED from the command layer and
   * LEGITIMATE in `git.md` and its generated references — those files are the
   * mechanics. A denylist without scopes could only express the weaker of the two
   * rules, and the weaker one is the one that forbids nothing where it matters.
   */
  scope?: readonly string[];
}

const RETIRED_LITERALS: ReadonlyArray<RetiredEntry> = [
  {
    literal: 'ISSUE_NUMBERS',
    removedFrom: 'src/assets/agents/git.md, src/assets/commands/plan.mds',
    justification: 'Renamed to ISSUE_REFS in A1 (AC-0.11)',
  },
  {
    literal: 'ISSUE: {issue',
    removedFrom: 'src/assets/commands/debug.mds',
    justification: 'Renamed to ISSUE_INPUT: {issue reference} in A1 (debug.mds spawn key fix)',
  },
  {
    literal: 'close milestone',
    removedFrom: 'src/assets/commands/release.md',
    justification: 'Untruthful claim deleted from release.md in A1 (AC-0.14)',
  },
  {
    literal: 'may pre-fetch',
    removedFrom: 'src/assets/commands/_partials/_wave.mds',
    justification: 'Weakened "may" replaced with mandatory pre-fetch in A1',
  },
  {
    literal: 'issue-first gate',
    removedFrom: 'src/assets/commands/implement.mds',
    justification:
      '"issue-first gate in step 1c" was the stale cross-reference in implement.mds pointing to ' +
      'git.md\'s internal step — replaced in A1 with "Git agent\'s issue-first step in setup-task". ' +
      '"step 1c" itself is still a valid self-reference in git.md (git create-branch step); ' +
      '"issue-first gate" is the unique retired phrase.',
  },
  {
    literal: 'no generated copies anywhere',
    removedFrom: 'CLAUDE.md',
    justification:
      'The Build System section claimed src/assets/{skills,agents,rules}/ were the single source ' +
      'of truth with "no generated copies anywhere in the repo". Phase 1 falsified it: ' +
      'dist/agents/git.md is a generated copy of an agent. Restated as "generated files never ' +
      'live in src/" — the rule that is actually true and actually load-bearing (GAP-53).',
  },
  {
    literal: 'The only intermediate build step',
    removedFrom: 'docs/reference/file-organization.md',
    justification:
      'The Asset Distribution section named compiling .mds command sources to dist/commands/ as the ' +
      'sole intermediate build step. Phase 1 falsified it: an .mds agent generator host compiles to ' +
      'dist/agents/ in the same build. Restated as the two host kinds the build serves. Registered ' +
      'because the claim outlived the CLAUDE.md sweep purely by being spelled differently, in a file ' +
      'the corpus already scanned.',
  },
  {
    literal: 'No build step distributes agents',
    removedFrom: 'docs/reference/agent-design.md',
    justification:
      'agent-design.md asserted src/assets/agents/ was the single source of truth for every agent and ' +
      'that no build step distributes them. Phase 1 falsified both: src/assets/agents/git.mds compiles ' +
      'to dist/agents/git.md, which the installer prefers over the src tree. Restated as the ' +
      'hand-authored vs generator-host split.',
  },

  // -------------------------------------------------------------------------
  // SCOPED literals — retired from one tree, legitimate in another. Each names
  // the trees it is forbidden in, because a repo-wide entry for any of these
  // would be a grep rather than a rule.
  // -------------------------------------------------------------------------
  {
    literal: 'gh issue',
    removedFrom: 'src/assets/commands/**.mds (the command layer)',
    scope: ['dist/commands/'],
    justification:
      'A command that names a provider CLI has re-composed provider mechanics at the caller — the ' +
      '~30-sink shape GAP-10 names. The literal stays LEGITIMATE in git.md and in the generated ' +
      'references, which is why this entry is scoped to the compiled command layer. Strictly ' +
      'stronger than build-mds.test.ts\'s prose-only rule, which permits it inside a Git spawn fence.',
  },
  {
    literal: 'sleep 60',
    removedFrom: 'src/assets/skills/git/SKILL.md:196, references/github-api.md:20 and :467',
    scope: ['src/assets/skills/git/', 'dist/agents/git.md', 'dist/skills/git/references/'],
    justification:
      'GAP-25. Sleeping out an active secondary rate limit extends the provider\'s penalty window, ' +
      'which is why D4 says STOP. Three sites held it and all three were rewritten; ' +
      'scoped to the files a Git spawn preloads or can load, because an unrelated example elsewhere ' +
      'is not a second rate-limit policy in the agent\'s context.',
  },
  {
    literal: '<!-- devflow:',
    removedFrom: 'src/assets/commands/dynamic-build.mds and code-review.mds',
    scope: ['dist/commands/'],
    justification:
      'GAP-20: the operation owns the marker; a caller restating the literal already diverged once ' +
      'and produced duplicate comments. Scoped to the compiled commands because the marker must ' +
      'keep living in git.md and in the generated post-wave-report reference — the rule is ' +
      'relocated, not deleted.',
  },
  {
    literal: '{issue}',
    removedFrom: 'src/assets/skills/docs-framework/SKILL.md:45, :106, :144',
    scope: ['src/assets/skills/docs-framework/SKILL.md'],
    justification:
      'The GitHub-bound placeholder was replaced by the provider-neutral {ISSUE_ID}. Scoped to ' +
      'the one file: `{issue}` is an ordinary template token elsewhere and a repo-wide entry would ' +
      'be a grep rather than a rule.',
  },

  // Retired DEGRADED synonyms. Unscoped — a DEGRADED reason is user-visible
  // wherever it is written, and the canonical table admits exactly one spelling per
  // condition (GAP-13: thirteen reasons with three synonyms for one condition is how
  // a caller ends up matching on a string no op emits).
  ...([
    ['provider mechanics unavailable', 'superseded by `tracker mechanics unavailable`'],
    ['provider {x} not installed', 'names an installation state the agent cannot observe'],
    ['no MCP tool for', '"MCP" is transport and stays out of user-facing text'],
    ['no tool available for', 'superseded by `no tracker tool for {capability}`'],
    ['no jira tools in session', 'session-scoped phrasing of a capability fact'],
    ['jira tools unavailable', 'same condition, third spelling'],
    ['tracker not reachable', 'conflates an unconfigured tracker with an unreachable one'],
    ['interactive setup required', 'no question step exists — the phrasing promises a prompt that never comes'],
    ['delete .devflow/tracker.md and re-learn', 'superseded; the file is never the remedy'],
  ] as const).map(([literal, why]): RetiredEntry => ({
    literal,
    removedFrom: 'the canonical DEGRADED reason table (retired synonym)',
    justification: `Retired DEGRADED synonym — ${why}. The canonical table admits one reason per condition.`,
  })),

  // -------------------------------------------------------------------------
  // Retired status headings — three sections no operation emits any more.
  //
  // They belong here rather than in a list of their own. A second list inside
  // tests/tracker/schema-scope.test.ts would be a new grep, and a weaker one:
  // that corpus is `dist/agents/git.md` ∪ `dist/skills/git/references/**` ∪ the
  // two command trees. This corpus is a strict superset of all four AND reaches
  // `src/assets/agents/`, `src/assets/skills/`, `src/assets/mds/`, `docs/` and
  // the root prose — which is exactly where a retired heading survives a sweep by
  // being restated in documentation rather than in an op body (PF-025). One list,
  // because two lists is how one goes stale.
  //
  // `.devflow/features/*/KNOWLEDGE.md` stays out of the corpus (see the note
  // above buildCorpus), so the knowledge bases may keep recording what these
  // headings were and why they went.
  // -------------------------------------------------------------------------
  ...([
    ['## Tracker Discovery', 'the discovery report of a question step that no longer exists'],
    ['## Tracker Learned', 'the confirmation half of the same step'],
    ['## Tracker Learning Required', 'the prompt half — it promised an interactive setup that never comes'],
  ] as const).map(([literal, why]): RetiredEntry => ({
    literal,
    removedFrom: 'the canonical status-heading set — no op emits them',
    justification:
      `Retired status heading — ${why}. A heading with no emitter is residue; a heading an op ` +
      `still emits is a user-visible section describing a flow that no longer exists.`,
  })),

  // -------------------------------------------------------------------------
  // Transition narration in the TypeScript sources.
  //
  // Comments that date a line to the wave that wrote it ("P3a-S15: move a
  // now-stale conventions file aside") describe the transition, not the end
  // state, and a reader six months on cannot resolve the label to anything. The
  // rationale itself is worth keeping — only the coordinate goes (applies
  // ADR-003).
  //
  // A pattern rather than seven literals because the members are not enumerable:
  // the next wave mints its own labels, and a fixed list would pass over exactly
  // the narration it was added to stop.
  // -------------------------------------------------------------------------
  {
    literal: 'P{n}-S{n} phase labels',
    pattern: /P[0-9][a-z]?-S[0-9]+/,
    removedFrom:
      'src/core/{tracker,mds-variants,feature-config}.ts, src/cli/commands/{init,tracker}.ts, ' +
      'src/targets/claude-code/installer.ts, src/assets/scripts/redact-secrets.cjs',
    scope: ['src/'],
    justification:
      'Wave coordinates in source comments are transition narration: they name a phase of a ' +
      'delivery that has shipped, and resolve to nothing for the next reader. Seven sites carried ' +
      'them; each was rewritten to state the rule instead of the phase that introduced it. Scoped ' +
      'to src/ because the plan artifacts, handoffs and knowledge bases under .devflow/ and docs/ ' +
      'are where that provenance legitimately lives (PF-040).',
  },

  // -------------------------------------------------------------------------
  // Internal identifiers and delivery coordinates cut from the Git agent's prompt.
  //
  // The agent's text is read by a model, not by a maintainer: an `ADR-NNN`, a
  // `PF-NNN` or a phase coordinate resolves to nothing there, so it is cost with
  // no reader. The RULE each one annotated is kept and stated plainly in place —
  // only the pointer goes.
  //
  // Each is scoped to the two files that carry the prompt (the .mds source and
  // its compiled artifact) rather than registered repo-wide. `ADR-007` and
  // `PF-003` are legitimate — and load-bearing — in CLAUDE.md, in docs/, in the
  // other agents and in the learning ledger, which is where a decision record is
  // supposed to be cited (applies ADR-025: classified individually, not swept).
  // -------------------------------------------------------------------------
  {
    literal: 'ADR-007',
    removedFrom: 'src/assets/agents/git.mds (the "Neutral values" heading)',
    scope: ['src/assets/agents/git.mds', 'dist/agents/git.md'],
    justification:
      'The neutral-value discipline was cited by anchor in the always-loaded preamble. The rule ' +
      'it names — a missing artifact degrades to a neutral value, never to a fallback path — is ' +
      'stated in the same sentence, so the anchor added a lookup the reader of a prompt cannot ' +
      'perform. Scoped to the prompt because citing ADR-007 in CLAUDE.md and in the decisions ' +
      'ledger is exactly what that anchor is for.',
  },
  {
    literal: 'PF-003',
    removedFrom:
      'src/assets/agents/git.mds (Principle 7, "avoids PF-003") and ' +
      'src/assets/agents/tracker.md (`## Finishing` step 3)',
    scope: ['src/assets/agents/git.mds', 'dist/agents/git.md', 'src/assets/agents/tracker.md'],
    justification:
      'Both prompts forbid a flagged `rm` and then cited the pitfall they avoid. The prohibition ' +
      'is the whole content; the citation is provenance for a maintainer, and the maintainer ' +
      'reads pitfalls.md. Scoped to the two prompts — learning.md and json-helper.cjs cite ' +
      'PF-003 legitimately and are not retired from it here.',
  },
  {
    literal: '[DR-02]',
    removedFrom: 'src/assets/agents/tracker.md (`## Finishing` step 1)',
    scope: ['src/assets/agents/tracker.md'],
    justification:
      'The prompt told the model that the session-start gate spends the attempt, and then cited ' +
      'the decision record that says so. The claim is what the agent acts on and it is stated in ' +
      'the same sentence; the anchor is a lookup a prompt\'s reader cannot perform. Scoped to the ' +
      'prompt: session-start-context\'s shell comment and CLAUDE.md both cite [DR-02] for the ' +
      'maintainer who can follow it.',
  },
  {
    literal: 'Phase 5/9',
    removedFrom: 'src/assets/agents/git.mds (post-resolution-summary step 4)',
    justification:
      'A delivery coordinate naming which phase of the resolve workflow writes resolution-summary.md. ' +
      'The agent reads the path it is given; the producer\'s phase number is not a fact it can use, ' +
      'and the numbering it refers to no longer exists. Unscoped: the spelling appears nowhere else ' +
      'in the corpus, so a scope would narrow a rule that has nothing to narrow.',
  },
  {
    literal: 'Key Parameters',
    removedFrom: 'src/assets/agents/git.mds (the Operations table\'s third column)',
    justification:
      'The Operations index carried a third column repeating each operation\'s inputs, every one of ' +
      'which the operation\'s own `**Input:**` line already states — an always-loaded second copy ' +
      'of eighteen parameter lists, free to drift against the authority below it. The column is ' +
      'gone; the index keeps operation and purpose. Unscoped for the same reason as above.',
  },

  // -------------------------------------------------------------------------
  // The UNGATED github link line.
  //
  // This entry is a CLASSIFIER, not a spelling: the literal survives at exactly
  // one site — the github-gated fallback in /implement's PR step — and the rule
  // is about the qualification in front of it, which no substring test can see.
  // The permitted occurrence is admitted by the pattern rather than excluded by a
  // hand-written filter, so it stays admitted only while it stays gated, and the
  // guard needs no second list to keep in sync with this one (PF-067).
  // -------------------------------------------------------------------------
  {
    literal: 'an ungated `Closes #{ISSUE_NUMBER}`',
    // Both spellings of the corpus: the `.mds` source escapes the braces, the
    // compiled `.md` does not. `[^.\n]{0,80}` is the qualification window — a
    // sentence, not a paragraph, so a `github` mentioned in the line above does
    // not license a rendering three sentences later.
    pattern: /(?<!github[^.\n]{0,80})Closes #\\?\{ISSUE_NUMBER\\?\}/,
    removedFrom: 'src/assets/commands/implement.mds (Phase 10) and dist/commands/implement.md',
    justification:
      'The PR step rendered `Closes #{ISSUE_NUMBER}` whenever an issue number was known, with no ' +
      'provider in the condition. Under jira or linear that number is the tail of a key like ' +
      'PROJ-12, so the line closed whichever GitHub issue happens to carry the same digits — a ' +
      'wrong, silent, GitHub-visible write. The rendering is correct under github and is kept ' +
      'there; what is retired is stating it without the gate.',
  },
];

// ---------------------------------------------------------------------------
// Corpus: src/assets/ + dist/commands/ + the repo's own prose (root .md, docs/)
//
// The corpus widens when a retired literal lives outside the shipping assets —
// a Phase-1 entry was retired from CLAUDE.md, which nothing scanned. Widening is
// the correct response; loosening the denylist is not (R2).
//
// .devflow/features/*/KNOWLEDGE.md is deliberately NOT in the corpus. Those files
// record what each literal WAS and why it was retired; a residue grep must not
// demand that provenance be deleted (PF-040).
// ---------------------------------------------------------------------------

function buildCorpus(): Array<{ relPath: string; content: string }> {
  const corpus: Array<{ relPath: string; content: string }> = [];

  function addDir(dir: string, relPrefix: string, exts: string[]): void {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        addDir(path.join(dir, entry.name), `${relPrefix}/${entry.name}`, exts);
      } else if (exts.some(ext => ext === '' ? !entry.name.includes('.') : entry.name.endsWith(ext))) {
        // ext === '' matches extensionless files (hook scripts in src/assets/scripts/hooks/)
        const absPath = path.join(dir, entry.name);
        try {
          corpus.push({ relPath: `${relPrefix}/${entry.name}`, content: readFileSync(absPath, 'utf-8') });
        } catch {
          // Ignore read errors
        }
      }
    }
  }

  // '' in exts picks up extensionless hook scripts in src/assets/scripts/hooks/ so
  // retired-wording checks are not silently skipped for that corpus (e.g. capture-prompt, ensure-proxy).
  addDir(path.join(ROOT, 'src', 'assets'), 'src/assets', ['.md', '.mds', '.sh', '']);
  // The TypeScript sources and the shipped CJS scripts. Without them the phase-label
  // entry would be retired from a tree nothing scanned — every site it names lives
  // in a .ts or .cjs file, and the four extensions above reach none of them.
  for (const sub of ['core', 'cli', 'targets', 'hud']) {
    addDir(path.join(ROOT, 'src', sub), `src/${sub}`, ['.ts', '.cjs']);
  }
  addDir(path.join(ROOT, 'src', 'assets', 'scripts'), 'src/assets/scripts', ['.cjs']);
  addDir(path.join(ROOT, 'dist', 'commands'), 'dist/commands', ['.md']);
  addDir(path.join(ROOT, 'dist', 'agents'), 'dist/agents', ['.md']);
  // Phase 2 generates a third build output. Without it the scoped `sleep 60` entry
  // would be retired from a tree nothing scanned — the GAP-25 contradiction could
  // move into a generated reference and stay green.
  addDir(path.join(ROOT, 'dist', 'skills'), 'dist/skills', ['.md']);
  addDir(path.join(ROOT, 'docs'), 'docs', ['.md']);

  // Root-level prose. Read individually rather than by walking ROOT, which would
  // pull in node_modules/ and every dot-directory.
  for (const name of ['CLAUDE.md', 'README.md', 'CONTRIBUTING.md']) {
    try {
      corpus.push({ relPath: name, content: readFileSync(path.join(ROOT, name), 'utf-8') });
    } catch {
      // Absent root doc — the corpus-size assertion below is what catches a corpus
      // that has collapsed; a single missing file is not a guard failure.
    }
  }

  return corpus;
}

// ---------------------------------------------------------------------------
// Named collector — used by both the main guard and the non-vacuity probe (M12a).
// Calling this from both sites proves the probe exercises the real guard logic (pattern:
// collectGhIssueProseViolations in tests/build-mds.test.ts ~:1549 / ~:1571 / ~:1602).
// ---------------------------------------------------------------------------

function collectRetiredLiteralViolations(
  corpus: Array<{ relPath: string; content: string }>,
): string[] {
  const violations: string[] = [];
  for (const { relPath, content } of corpus) {
    for (const entry of RETIRED_LITERALS) {
      if (entry.scope && !entry.scope.some(prefix => relPath.startsWith(prefix))) continue;
      const hit = entry.pattern !== undefined
        ? entry.pattern.test(content)
        : content.includes(entry.literal);
      if (hit) {
        violations.push(
          `${relPath}: contains retired literal "${entry.literal}" (removed from ${entry.removedFrom})`,
        );
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

describe('retired-wording guard — denylist of retired literals (GAP-32)', () => {
  it('denylist is non-empty and each entry carries a justification (non-vacuity)', () => {
    expect(
      RETIRED_LITERALS.length,
      'RETIRED_LITERALS denylist must be non-empty',
    ).toBeGreaterThan(0);
    for (const entry of RETIRED_LITERALS) {
      expect(entry.literal.length, `entry literal must be non-empty`).toBeGreaterThan(0);
      expect(entry.justification.length, `entry "${entry.literal}" must carry a justification`).toBeGreaterThan(0);
      expect(entry.removedFrom.length, `entry "${entry.literal}" must record removedFrom`).toBeGreaterThan(0);
      if (entry.scope) {
        expect(entry.scope.length, `entry "${entry.literal}" has an empty scope — omit the field instead`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('every scoped entry names a scope the corpus actually reaches (no silently dead scope)', () => {
    // A scope that matches no corpus path silences its entry completely and leaves
    // a denylist row that forbids nothing — the same failure as an exemption nobody
    // notices going stale. Checked against the real corpus, not the literal strings.
    const paths = buildCorpus().map(e => e.relPath);
    expect(paths.length, 'empty corpus').toBeGreaterThan(0);
    const dead: string[] = [];
    for (const entry of RETIRED_LITERALS) {
      if (!entry.scope) continue;
      for (const prefix of entry.scope) {
        if (!paths.some(p => p.startsWith(prefix))) dead.push(`"${entry.literal}" → ${prefix}`);
      }
    }
    expect(
      dead,
      `scope prefix(es) matching no corpus file — the entry is retired from a tree nothing scans:\n  ` +
      dead.join('\n  '),
    ).toEqual([]);
  });

  it('known-bad probe: a seeded phase label in a src/ source is caught (mechanic 2)', () => {
    // The pattern entry has no fixed spelling to seed, so the probe mints one the
    // denylist has never seen — which is the property a literal list cannot have.
    const seeded = collectRetiredLiteralViolations([{
      relPath: 'src/core/probe.ts',
      content: '// P7c-S42: a coordinate nobody can resolve\nexport const probe = 1;\n',
    }]);
    expect(
      seeded.filter(v => v.includes('P{n}-S{n} phase labels')),
      'a freshly-minted phase label in src/ must be caught by the class rule',
    ).not.toEqual([]);

    // …and the same label in the plan artifacts it legitimately belongs to is not.
    const provenance = collectRetiredLiteralViolations([
      { relPath: 'docs/reference/probe.md', content: 'The P7c-S42 step landed the overlay.\n' },
    ]);
    expect(provenance.filter(v => v.includes('P{n}-S{n} phase labels'))).toEqual([]);
  });

  it('known-bad probe: a scope confines its entry to the named tree (mechanic 2)', () => {
    const scoped = RETIRED_LITERALS.find(e => e.scope !== undefined);
    expect(scoped, 'at least one entry must be scoped, or the scope arm is untested').toBeDefined();
    const prefix = scoped!.scope![0];
    const inside = collectRetiredLiteralViolations([
      { relPath: `${prefix}probe.md`, content: `seeded ${scoped!.literal} here\n` },
    ]);
    const outside = collectRetiredLiteralViolations([
      { relPath: 'docs/probe.md', content: `seeded ${scoped!.literal} here\n` },
    ]);
    expect(
      inside.length,
      `the collector must flag "${scoped!.literal}" inside ${prefix}`,
    ).toBeGreaterThan(0);
    expect(
      outside.filter(v => v.includes(scoped!.literal)),
      `the collector must NOT flag "${scoped!.literal}" outside its scope — that is what the scope is for`,
    ).toEqual([]);
  });

  it('no retired literal appears in the shipping assets, the compiled output, or the repo docs', () => {
    const corpus = buildCorpus();

    // Non-vacuity: corpus size must be > 0 so the guard is not trivially green.
    expect(
      corpus.length,
      `corpus is empty — check src/assets/, dist/, and docs/; guard is vacuous (PF-018)`,
    ).toBeGreaterThan(0);
    // …and the doc half specifically, since a Phase-1 entry was retired from CLAUDE.md
    // and would have gone unchecked while the src/assets half kept the corpus non-empty.
    expect(
      corpus.map(e => e.relPath),
      'root prose must be in the corpus — a retired literal lives there',
    ).toContain('CLAUDE.md');

    // Use the named collector so the probe exercises the same logic (M12a).
    const violations = collectRetiredLiteralViolations(corpus);

    expect(
      violations,
      `Retired literals found in corpus:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });

  it('non-vacuity: a seeded retired literal in a synthetic corpus entry fails the guard (mechanic 2, M12a)', () => {
    // M12a: prior probe re-implemented the violation loop inline — this calls the same
    // named collector as the main guard so the proof tracks the guard rather than shadowing it.
    const retired = RETIRED_LITERALS[0];
    const syntheticCorpus = [
      { relPath: 'synthetic/test.md', content: `# Synthetic\nContains: ${retired.literal}\n` },
    ];
    // Call the same collectRetiredLiteralViolations function used by the main guard.
    const syntheticViolations = collectRetiredLiteralViolations(syntheticCorpus);
    expect(
      syntheticViolations.length,
      `non-vacuity: the guard logic must flag a corpus entry seeded with "${retired.literal}"`,
    ).toBeGreaterThan(0);
  });
});

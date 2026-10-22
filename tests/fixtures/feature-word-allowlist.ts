/**
 * tests/fixtures/feature-word-allowlist.ts
 *
 * The allowlist behind the feature-word guard in tests/guards/retired-wording.test.ts
 * (AC-1 of the curation rename). The guard scans every tracked file outside tests/
 * for the old feature word, as a case-insensitive SUBSTRING, so `learningCounts` and
 * `LEARNING_OPS` are caught as well as the plain word. A hit passes only when an
 * entry here covers it.
 *
 * Entry rules:
 *   - `path` is one tracked file, a directory prefix that ends in `/`, or a RegExp
 *     over the tracked path. It never names a file whole: the guard checks the
 *     TEXT an entry covers, so a new use of the word in the same file still fails.
 *   - `pattern` matches the exact words around the hit. The guard asks that every
 *     occurrence of the word sits inside text that some entry of its file matches.
 *   - `reason` says in words why the name stays.
 *   - An entry that covers no hit fails the guard: a stale entry is a hole in the
 *     net. So does an entry that covers a bare word with no context.
 *
 * What stays, and why, in short: names that exist only to READ or REMOVE data and
 * hooks an older release wrote (the migration and the legacy readers), the design
 * decision IDs, the `self-learning:` source stamp, the phrase for the conventions
 * feature, ordinary English, and the prose of the docs that names the old names so
 * a reader can find them. The released CHANGELOG sections and the 3.8.0 upgrade
 * section are exempt by their headings (SECTION_EXEMPTIONS).
 *
 * When dist/ exists, the guard also reads the built output. Each built file is read as a
 * copy of its source file (dist/core/x.js and x.d.ts of src/core/x.ts, a built command or
 * agent of its .mds host, a built reference of its module), so an entry whose `path` covers
 * the source file covers the same text in the build. No entry names a dist path.
 *
 * The titles of the tests under tests/ are read by a second guard, with its own allowlist
 * (TEST_TITLE_ALLOWLIST) at the end of this file.
 */

/** The retired feature word. Matched anywhere inside a word, in any case. */
export const FEATURE_WORD = /learning/i;

export interface AllowlistEntry {
  readonly path: string | RegExp;
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * A heading-bounded part of one file whose lines the guard does not read. A section
 * starts at a line `start` matches and ends at the next line `end` matches (that
 * line may start another section). It matches by heading, so it still matches after
 * the release bump moves the text under another heading.
 */
export interface SectionExemption {
  readonly path: string;
  readonly start: RegExp;
  readonly end: RegExp;
  readonly reason: string;
}

export const SECTION_EXEMPTIONS: ReadonlyArray<SectionExemption> = [
  {
    path: 'CHANGELOG.md',
    start: /^## \[\d+\.\d+\.\d+\]/,
    end: /^## /,
    reason:
      'A released section is the record of what that release did. The old word stays in it, ' +
      'and the record is not edited after the fact (D3). It matches every version heading.',
  },
  {
    path: 'CHANGELOG.md',
    start: /^### Upgrade notes — Curation rename/,
    end: /^#{1,3} /,
    reason:
      'The 3.8.0 upgrade notes must name the old command, flags, keys, folders and files so an ' +
      'upgrading user can find them. The heading sits under Unreleased before the release and ' +
      'under the 3.8.0 heading after the bump, so it matches by its heading.',
  },
];

/** The hook scripts that carry the migration and the legacy readers. */
const HOOKS = 'src/assets/scripts/hooks/';

/** README, the docs and the knowledge bases: prose that names the pre-rename names. */
const PROSE = /^(?:README\.md|docs\/.*\.md|\.devflow\/features\/.*\.md)$/;

export const FEATURE_WORD_ALLOWLIST: ReadonlyArray<AllowlistEntry> = [
  // ── Kept names: IDs and stamps ─────────────────────────────────────────────
  {
    path: /^(?:src|scripts|docs|\.devflow\/features)\//,
    pattern: /\bD-(?:[A-Z0-9]+-)*LEARNING(?:-[A-Z0-9]+)*/,
    reason:
      'The design-decision IDs (D-*) keep their spelling. They name recorded decisions that the ' +
      'rename does not touch, and committed text cites a decision by this name.',
  },
  {
    path: `${HOOKS}lib/decisions-format.cjs`,
    pattern: /self-learning:/,
    reason:
      'The source stamp of a rendered row stays byte-identical, so rows rendered before the ' +
      'rename and after it read the same.',
  },
  {
    path: 'src/assets/mds/git/_references.mds',
    pattern: /Conventions learning —/,
    reason:
      'The conventions feature (learn-conventions) is a different feature and keeps its own ' +
      'name. The reference table names it so.',
  },

  // ── Migration: the legacy names the move reads, and the shim that probes them ──
  {
    path: /^src\/(?:core\/project-paths\.ts|assets\/scripts\/hooks\/lib\/project-paths\.cjs)$/,
    pattern: /(?:folder|backupPrefix|tuningFile): (['"])learning(?:\.backup-|\.json)?\1[,;]/,
    reason:
      'The LEGACY_NAMES block holds the pre-rename folder, backup prefix and tuning file. The ' +
      'move reads them to find old data. The TypeScript and CJS copies list the same names. ' +
      'The compiled declaration in dist/ holds them too, with double quotes and a semicolon; ' +
      'the dist scan reads it as a copy of the TypeScript source.',
  },
  {
    path: `${HOOKS}curation-move`,
    pattern: /DF_CM_OLD_FOLDER="learning"|\.devflow\/learning(?= to \.devflow\/curation)/,
    reason:
      'The shell shim holds the old folder name that the LEGACY_NAMES block holds, so the ' +
      'session-start move finds the old folder.',
  },
  {
    path: HOOKS,
    pattern: /\bold learning\/ (?:ledger )?(?:folder|name)/,
    reason:
      'Comments describe the pre-rename folder that the creator rule and the one-time move ' +
      'still handle until a project has moved.',
  },

  // ── Readers: the queue gate reads both manifest and repository keys ──────────
  {
    path: `${HOOKS}queue-append`,
    pattern: /features\.learning|`learning`, `decisions`\)/,
    reason:
      'The comments name the pre-rename key that the gate still reads as a narrow-only union ' +
      'with the current key.',
  },
  {
    path: `${HOOKS}queue-append`,
    pattern: /"learning"|\|learning(?=[|)])/,
    reason:
      'The builtin fast path looks for a literal false under the current key or the pre-rename ' +
      'key. A match only sends the file to the full parse.',
  },
  {
    path: `${HOOKS}queue-append`,
    pattern: /curation or learning is false|\[\.curation, \.learning\]|\['curation', 'learning'\]/,
    reason:
      'The jq and node parses read the manifest under both keys, and a false in either one ' +
      'turns the feature off.',
  },
  {
    path: `${HOOKS}queue-append`,
    pattern: /\$\{_qs_dir\}\/learning(?:\.backup-\*(?:\/\*\*)?)?"|\.devflow\/learning\/\*\|/,
    reason:
      'The tracked-area check lists the pre-rename ledger folder and its backup folders beside ' +
      'the current folder, and the queue gate maps a queue below the pre-rename folder to the ' +
      'curation area. The lists are the ones the shared check holds.',
  },
  {
    path: `${HOOKS}session-start-context`,
    pattern: /agents\.learning\.model|agent `learning`\.|drops `learning`,/,
    reason:
      'The model fallback reads the agent key from before the agent was renamed, so a mapping ' +
      'made then still decides the model.',
  },
  {
    path: `${HOOKS}session-start-context`,
    pattern: /stop-update-learning\|session-end-learning/,
    reason:
      'The list of retired hook names that the hook sweep recognizes in a settings file. The ' +
      'names are the ones an older release installed.',
  },
  {
    path: 'src/cli/commands/init.ts',
    pattern: /'(?:(?:background|stop-update|session-end|eval)-learning|learning-lock|lib\/learning-store\.cjs)'/,
    reason:
      'LEGACY_HOOK_FILES and LEGACY_HOOK_SUFFIXES name the hook files and suffixes an older ' +
      'release installed. Init deletes them on upgrade.',
  },
  {
    path: 'src/cli/commands/memory.ts',
    pattern: /'(?:stop-update|session-end)-learning'/,
    reason:
      'The memory command sweeps the retired hook suffixes that an older release registered ' +
      'in the settings file.',
  },
  {
    path: 'src/core/agent-models.ts',
    pattern: /diagnose, learning\)|'learning':\s+'curate',/,
    reason:
      'LEGACY_AGENT_KEYS maps the retired agent key learning to curate, so a saved mapping ' +
      'keeps working. The comment lists the retired agent names.',
  },
  {
    path: 'src/core/curation-variants.ts',
    pattern: /(['"])dist\/learning-off\1|<!--\\s\*learning\\s\*:|retired learning marker/,
    reason:
      'The build prunes the retired output folder and refuses the retired prompt marker, and ' +
      'both must name the old spelling to find it (LEGACY_OFF_OUTPUT_DIR and the marker rule).',
  },
  {
    path: 'src/core/feature-config.ts',
    pattern:
      /features\.learning|`memory`, `learning` and `knowledge` were|`learning: false`|spelling of `learning`|'memory', 'learning', 'knowledge'/,
    reason:
      'The personal config reader narrows under the pre-rename key too, and RETIRED_CONFIG_KEYS ' +
      'lists the retired top-level keys that decide nothing.',
  },
  {
    path: 'src/core/feature-switch.ts',
    pattern:
      /features\.learning|\(`memory`, `learning`, `knowledge`, `decisions`\)|`learning: false`|`curation` and `learning`:|^ \* `learning`\. No precedence|curation: \['curation', 'learning'\]|\(`curation`, `learning`\)|copy `learning`\)/,
    reason:
      'The machine switch is stored under the current key and its pre-rename copy. The reader ' +
      'chain reads both, and a false in either one wins.',
  },
  {
    path: 'src/core/manifest.ts',
    pattern:
      /renamed from learning \(and, before that, decisions\)|pre-rename (?:copy|key) `learning`|features\.learning|Any `learning` the input|key === 'learning'|mirrored\.learning/,
    reason:
      'The manifest keeps the pre-rename key equal to the current one, so a downgrade reads ' +
      'the same answer. The heal and the mirror write and read that key.',
  },
  {
    path: 'src/assets/scripts/lib/project-config.cjs',
    pattern:
      /"learning":false|and `learning` its pre-rename|'curation', 'learning', 'knowledge'|learning: Field<boolean>|and `learning` are two keys|learning: fieldOf\(value, duplicates, base, 'learning', asBoolean\)|^ \* `learning`, `knowledge`, `decisions`\)|stale `learning: false`/,
    reason:
      'The repository file reader narrows under the current key and the pre-rename key, each ' +
      'classified on its own. The retired top-level keys are never read.',
  },
  {
    path: 'src/assets/scripts/resolve-settings.cjs',
    pattern: /^ \* `learning` \(#529\)\.|\['curation', 'learning'\]|and `learning`, #529/,
    reason:
      'The settings resolver reads the curation switch under the current key and the ' +
      'pre-rename key, the same rule as the TypeScript reader.',
  },
  {
    path: 'scripts/token-audit/parse.ts',
    pattern: /\(\?:curation\|learning\)|read `learning`\./,
    reason:
      'The token audit reads old transcripts, whose ledger paths still say the old folder ' +
      'name. The matcher accepts both folders.',
  },

  // ── Prose that names the pre-rename names so a reader can find them ──────────
  {
    path: PROSE,
    pattern: /features\.learning/,
    reason:
      'The docs and knowledge bases name the pre-rename manifest and repository key, which ' +
      '3.8 still reads and mirrors.',
  },
  {
    path: PROSE,
    pattern: /\.devflow\/learning(?:\/|\.backup-)|dist\/learning-off|`learning\/`|`learning\.backup-\*`/,
    reason:
      'The docs and knowledge bases name the pre-rename data folder, its backups and the ' +
      'retired build output folder, which the move and the build handle.',
  },
  {
    path: PROSE,
    pattern: /learning\.json/,
    reason: 'The docs and knowledge bases name the pre-rename tuning file, which init renames.',
  },
  {
    path: PROSE,
    pattern: /agents\.learning\.model/,
    reason:
      'The docs and knowledge bases name the agent key from before the rename, which the ' +
      'model fallback still reads.',
  },
  {
    path: PROSE,
    pattern: /devflow learning|--(?:no-)?learning|<!-- learning:/,
    reason:
      'The docs and knowledge bases name the old command, the old init flags and the old ' +
      'prompt marker, to say that they no longer work.',
  },
  {
    path: 'docs/reference/init.md',
    pattern: /learning-lock|lib\/learning-store\.cjs/,
    reason: 'The init reference names the two retired hook files that init removes on upgrade.',
  },
  {
    path: PROSE,
    pattern: /`memory`, `learning`, `knowledge`|memory, learning, knowledge/,
    reason:
      'The docs and knowledge bases list RETIRED_CONFIG_KEYS, the retired top-level keys that ' +
      'a config file may still hold and that decide nothing.',
  },
  {
    path: /^\.devflow\/features\/.*\.md$/,
    pattern: /(?:mirror|\bin|`curation` and) `learning`|memory\|curation\|learning/,
    reason:
      'The knowledge bases state the reader rules for the curation switch, which is stored ' +
      'under the current key and its pre-rename mirror key. They name the mirror beside it.',
  },
  {
    path: 'docs/reference/architecture.md',
    pattern: /feature was called learning before 3\.8/,
    reason: 'The sentence states the former name once, to tie the old folder and file names to it.',
  },
  {
    path: 'CLAUDE.md',
    pattern: /Never read the old `\.devflow\/learning\/` folder as a ledger/,
    reason:
      'The invariant names the pre-rename ledger folder to say that devflow only moves it ' +
      'and never reads it as a ledger.',
  },
  {
    path: 'CLAUDE.md',
    pattern: /`curation` and `learning`\. Every write sets both/,
    reason:
      'The invariant names the manifest switch under its current key and its pre-rename ' +
      'mirror key, which every write sets together.',
  },
  {
    path: /^\.devflow\/features\/curation-capture-system-store\/KNOWLEDGE\.md$/,
    pattern: /`area:learning`/,
    reason:
      'The format example quotes the scope tag that the ledger fixtures use. The rename keeps ' +
      'that tag as data (it is a free-form area label).',
  },
];

/** Any test file. */
const TEST_FILES = /^tests\/.*\.test\.ts$/;

/**
 * The allowlist behind the test-title guard in tests/guards/retired-wording.test.ts. The guard
 * reads the title of every `describe`, `it` and `test` call under tests/ for the old feature word.
 * A title passes only when an entry covers the exact words around the hit, so a title that uses
 * the word for the current feature fails. The rules of FEATURE_WORD_ALLOWLIST hold here: `pattern`
 * pins words around the hit and never the bare word, `reason` says why the name stays, and an
 * entry that covers no title fails the guard.
 */
export const TEST_TITLE_ALLOWLIST: ReadonlyArray<AllowlistEntry> = [
  {
    path: TEST_FILES,
    pattern: /\bD-(?:[A-Z0-9]+-)*LEARNING(?:-[A-Z0-9]+)*/,
    reason: 'The design decision names keep the old word, so a title that cites one carries it.',
  },
  {
    path: TEST_FILES,
    pattern: /\blegacy learning key\b/,
    reason:
      'The title names the pre-rename key `learning`, which every reader still accepts beside ' +
      '`curation`. The phrase pins the key, so the bare word never passes.',
  },
  {
    path: TEST_FILES,
    pattern: /\bfeatures\.learning\b/,
    reason: 'The title names the pre-rename key path `features.learning` that a reader still honours.',
  },
  {
    path: /^tests\/(?:init-curation-move-e2e|init-curation-move|uninstall-logic|decisions\/curation-move)\.test\.ts$/,
    pattern: /\blearning\.json\b/,
    reason:
      'The title names the pre-rename tuning file, which init renames, the move keeps beside ' +
      'the new one and the uninstall removes.',
  },
  {
    path: /^tests\/(?:cli-unknown-command|decisions\/cli-subcommands)\.test\.ts$/,
    pattern: /\bdevflow learning\b/,
    reason: 'The title names the retired command, which the CLI no longer registers and rejects as unknown.',
  },
  {
    path: 'tests/decisions/cli-subcommands.test.ts',
    pattern: /"learning"/,
    reason: 'The title quotes the retired command name that the curation command must not register or alias.',
  },
  {
    path: 'tests/shell-hooks.test.ts',
    pattern: /\bagents\.learning\b/,
    reason: 'The title names the pre-rename agent key that the model lookup still reads as a fallback.',
  },
  {
    path: 'tests/memory.test.ts',
    pattern: /\b(?:stop-update|session-end)-learning\b/,
    reason: 'The title names the retired hook files that the memory command removes from the settings.',
  },
  {
    path: 'tests/decisions/index-content.test.ts',
    pattern: /\bself-learning source stamp\b/,
    reason: 'The title names the `self-learning:` source stamp, a kept content identifier.',
  },
];

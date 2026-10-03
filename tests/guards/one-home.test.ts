/**
 * one-home — no shipped file resolves devflow's machine root, or Claude Code's
 * directory, through a retired environment variable (#389, TP-15 / AC-12).
 *
 * D-ONE-HOME / D-CLAUDE-CONFIG-DIR (src/targets/claude-code/claude-paths.ts):
 * `~/.devflow` is the only machine root and `CLAUDE_CONFIG_DIR` (else `~/.claude`)
 * the only Claude Code directory. The retired `DEVFLOW_DIR` override was honoured
 * by some readers and ignored by others, so one exported value split an install
 * from the hooks and prompts that read it; devflow's private `CLAUDE_CODE_DIR`
 * named a directory Claude Code never read. Both are gone, and this guard keeps
 * them gone.
 *
 * What it asserts
 * ---------------
 * 1. The token `DEVFLOW_DIR` — as a whole word, so `PROJECT_DEVFLOW_DIR`,
 *    `TRACKER_DEVFLOW_DIR` and the hooks' private `_DEVFLOW_DIR` names are not
 *    matches — appears nowhere under `src/` or `dist/` EXCEPT as the install-time
 *    settings-template token `${DEVFLOW_DIR}`, in the template itself and at its
 *    one substitution site (`substituteSettingsTemplate` in post-install, whose
 *    regex spells it `\$\{DEVFLOW_DIR\}`). That token is replaced with the machine
 *    root when settings.json is written; nothing resolves it at runtime.
 * 2. `CLAUDE_CODE_DIR` appears nowhere under `src/` or `dist/`.
 *
 * Every other spelling is a violation wherever it appears: `process.env.DEVFLOW_DIR`,
 * `process.env['DEVFLOW_DIR']`, `${DEVFLOW_DIR:-…}`, `$DEVFLOW_DIR`, a bare word in a
 * comment — and the template token itself outside the exempt files.
 *
 * What a green run does NOT prove
 * -------------------------------
 * The matcher reads the token as it is spelled. A name assembled at runtime
 * (`'DEVFLOW_' + 'DIR'`, an indirect `${!name}` in shell) is not representable
 * here, and a reader that relocates the root without naming either variable — a
 * new env var, a config key — is a different predicate entirely. The corpus is
 * `src/` plus `dist/`; the installed copies under `~/.claude` and `~/.devflow` are
 * produced from these and are not re-read. An empty result means: no whole-word
 * spelling of either token outside the named exemption, in the files this guard
 * reached — and the reach arms below name those files so a shrunken corpus fails
 * by name rather than passing silently.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { ROOT, resolveAgentSource, walkFiles, type CorpusEntry } from '../helpers.js';

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** Whole-word `DEVFLOW_DIR`: not preceded or followed by an identifier character. */
const DEVFLOW_DIR_TOKEN = /(?<![A-Za-z0-9_])DEVFLOW_DIR(?![A-Za-z0-9_])/g;
const CLAUDE_CODE_DIR_TOKEN = /(?<![A-Za-z0-9_])CLAUDE_CODE_DIR(?![A-Za-z0-9_])/g;

/** The install-time template token, and its regex-escaped spelling at the substitution site. */
const TEMPLATE_TOKEN = '${DEVFLOW_DIR}';
const TEMPLATE_TOKEN_REGEX_SPELLING = '\\$\\{DEVFLOW_DIR\\}';

/**
 * The only files allowed to carry the template token, and which spellings each
 * may carry. Paths are repo-relative with forward slashes.
 */
const TEMPLATE_TOKEN_EXEMPTIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ['src/targets/claude-code/templates/settings.json', [TEMPLATE_TOKEN]],
  ['src/targets/claude-code/post-install.ts', [TEMPLATE_TOKEN, TEMPLATE_TOKEN_REGEX_SPELLING]],
  ['dist/targets/claude-code/post-install.js', [TEMPLATE_TOKEN, TEMPLATE_TOKEN_REGEX_SPELLING]],
  ['dist/targets/claude-code/post-install.d.ts', [TEMPLATE_TOKEN]],
]);

interface OneHomeViolation {
  path: string;
  line: number;
  token: 'DEVFLOW_DIR' | 'CLAUDE_CODE_DIR';
  text: string;
}

/**
 * Every banned occurrence in `corpus`. Pure — the live arms and the seeded probe
 * run this same function, so the probe proves the matcher the live arms use.
 */
function findOneHomeViolations(corpus: readonly CorpusEntry[]): OneHomeViolation[] {
  const violations: OneHomeViolation[] = [];
  for (const entry of corpus) {
    const exempt = TEMPLATE_TOKEN_EXEMPTIONS.get(entry.path) ?? [];
    const lines = entry.content.split('\n');
    lines.forEach((raw, index) => {
      let line = raw;
      for (const spelling of exempt) line = line.split(spelling).join('');
      if (line.match(DEVFLOW_DIR_TOKEN)) {
        violations.push({ path: entry.path, line: index + 1, token: 'DEVFLOW_DIR', text: raw.trim() });
      }
      if (raw.match(CLAUDE_CODE_DIR_TOKEN)) {
        violations.push({ path: entry.path, line: index + 1, token: 'CLAUDE_CODE_DIR', text: raw.trim() });
      }
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

/** Binary assets never carry prose or code; everything else is read. */
const BINARY_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2'];

function readCorpus(dir: string): CorpusEntry[] {
  return walkFiles(dir, file => !BINARY_EXTENSIONS.includes(path.extname(file))).map(file => ({
    path: path.relative(ROOT, file).split(path.sep).join('/'),
    content: readFileSync(file).toString('latin1'),
  }));
}

/**
 * One sentinel per surface class that can reach a runtime root: the TypeScript
 * resolver, the HUD, a shell hook (extension-less), a Node script, an MDS module,
 * a compiled command, a compiled agent, a generated reference, a hand-authored
 * agent, a skill reference, the settings template and its compiled substitution site. A class
 * missing from the corpus fails here by name (corpus reach).
 */
const REACH_SENTINELS: readonly string[] = [
  'src/targets/claude-code/claude-paths.ts',
  'src/hud/config.ts',
  'src/assets/scripts/hooks/capture-turn',
  'src/assets/scripts/hooks/session-start-context',
  'src/assets/scripts/resolve-evidence-policy.cjs',
  // A hand-authored agent (resolved, never spelled — AC-0.7).
  path.relative(ROOT, resolveAgentSource('tracker').path).split(path.sep).join('/'),
  'src/assets/mds/git/_pr.mds',
  'src/assets/skills/git/references/github-api.md',
  'src/targets/claude-code/templates/settings.json',
  'dist/cli.js',
  'dist/hud/index.js',
  'dist/agents/git.md',
  'dist/commands/implement.md',
  'dist/skills/git/references/tracker/_mcp.md',
  'dist/targets/claude-code/post-install.js',
];

const corpus: CorpusEntry[] = [
  ...readCorpus(path.join(ROOT, 'src')),
  ...(existsSync(path.join(ROOT, 'dist')) ? readCorpus(path.join(ROOT, 'dist')) : []),
];

// ---------------------------------------------------------------------------
// Live arms
// ---------------------------------------------------------------------------

describe('one home: no retired root variable in src/ or dist/ (AC-12)', () => {
  it('reaches every surface class that can resolve a runtime root', () => {
    const paths = new Set(corpus.map(e => e.path));
    const missing = REACH_SENTINELS.filter(s => !paths.has(s));
    expect(missing, 'corpus does not reach these files — run `npm run build` if dist/ entries are missing').toEqual([]);
  });

  it('every template-token exemption is live: each exempt file exists and carries every spelling it is exempted for', () => {
    const byPath = new Map(corpus.map(e => [e.path, e.content]));
    for (const [file, spellings] of TEMPLATE_TOKEN_EXEMPTIONS) {
      const content = byPath.get(file);
      expect(content, `${file} is exempted but absent from the corpus`).toBeDefined();
      for (const spelling of spellings) {
        expect(content!.includes(spelling), `${file} no longer carries ${spelling} — drop the stale exemption`).toBe(true);
      }
    }
  });

  it('DEVFLOW_DIR survives only as the settings-template token at its template and substitution site', () => {
    const offenders = findOneHomeViolations(corpus).filter(v => v.token === 'DEVFLOW_DIR');
    expect(offenders.map(v => `${v.path}:${v.line}: ${v.text}`)).toEqual([]);
  });

  it('CLAUDE_CODE_DIR appears nowhere', () => {
    const offenders = findOneHomeViolations(corpus).filter(v => v.token === 'CLAUDE_CODE_DIR');
    expect(offenders.map(v => `${v.path}:${v.line}: ${v.text}`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seeded probe: the matcher the live arms use must go red on every
// shape a retired read can take, and stay green on the names it must not match.
// ---------------------------------------------------------------------------

describe('one-home guard: seeded probe', () => {
  const HOOK = 'src/assets/scripts/hooks/capture-turn';
  const TS = 'src/cli/commands/example.ts';
  const EXEMPT = 'src/targets/claude-code/post-install.ts';

  const KNOWN_BAD: ReadonlyArray<{ name: string; entry: CorpusEntry; token: OneHomeViolation['token'] }> = [
    { name: 'process.env property read', entry: { path: TS, content: 'const d = process.env.DEVFLOW_DIR;' }, token: 'DEVFLOW_DIR' },
    { name: 'process.env bracket read', entry: { path: TS, content: "const d = process.env['DEVFLOW_DIR'];" }, token: 'DEVFLOW_DIR' },
    { name: 'shell default expansion', entry: { path: HOOK, content: 'M="${DEVFLOW_DIR:-$HOME/.devflow}/manifest.json"' }, token: 'DEVFLOW_DIR' },
    { name: 'bare shell expansion', entry: { path: HOOK, content: 'LOG="$DEVFLOW_DIR/logs"' }, token: 'DEVFLOW_DIR' },
    { name: 'escaped MDS expansion', entry: { path: 'src/assets/mds/git/_pr.mds', content: 'node "$\\{DEVFLOW_DIR:-$HOME/.devflow\\}/scripts/x.cjs"' }, token: 'DEVFLOW_DIR' },
    { name: 'a comment naming the variable', entry: { path: HOOK, content: '# honours the DEVFLOW_DIR override' }, token: 'DEVFLOW_DIR' },
    { name: 'template token outside the exempt files', entry: { path: HOOK, content: 'X="${DEVFLOW_DIR}/scripts"' }, token: 'DEVFLOW_DIR' },
    { name: 'a runtime read inside an exempt file', entry: { path: EXEMPT, content: 'const d = process.env.DEVFLOW_DIR ?? home;' }, token: 'DEVFLOW_DIR' },
    { name: 'the Claude directory override', entry: { path: TS, content: 'const c = process.env.CLAUDE_CODE_DIR;' }, token: 'CLAUDE_CODE_DIR' },
    { name: 'the Claude directory override in dist', entry: { path: 'dist/cli.js', content: 'var c=process.env.CLAUDE_CODE_DIR||h;' }, token: 'CLAUDE_CODE_DIR' },
  ];

  for (const probe of KNOWN_BAD) {
    it(`reports ${probe.name}`, () => {
      const found = findOneHomeViolations([probe.entry]);
      expect(found.map(v => v.token)).toEqual([probe.token]);
    });
  }

  it('does not report identifiers that merely contain the token, or the exempt template spellings in their exempt file', () => {
    const clean: CorpusEntry[] = [
      { path: HOOK, content: 'PROJECT_DEVFLOW_DIR="$PROJECT_ROOT/.devflow"\nTRACKER_DEVFLOW_DIR="$HOME/.devflow"\n_ERG_DEVFLOW_DIR="$1/.devflow"\nMACHINE_DEVFLOW_DIR="$HOME/.devflow"' },
      { path: EXEMPT, content: ' * Replace ${DEVFLOW_DIR} placeholders in a settings template.\n  return template.replace(/\\$\\{DEVFLOW_DIR\\}/g, devflowDir);' },
      { path: 'src/targets/claude-code/templates/settings.json', content: '"command": "${DEVFLOW_DIR}/scripts/hud.sh"' },
      { path: TS, content: 'const c = process.env.CLAUDE_CONFIG_DIR;' },
    ];
    expect(findOneHomeViolations(clean)).toEqual([]);
  });
});

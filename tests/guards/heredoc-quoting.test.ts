/**
 * Heredoc-delimiter quoting guard (GAP-15 / S10).
 *
 * `cat <<'EOF'` is inert text. `cat <<EOF` is a shell expression: every `$VAR`,
 * every `` `cmd` `` and every `$(…)` inside the body is evaluated. devflow's prompt
 * assets hand heredoc recipes to an agent that fills them with issue titles, review
 * bodies and commit messages taken from a tracker — untrusted strings by definition
 * — so an unquoted delimiter in a shipped recipe is a command-injection template.
 *
 * This guard scans `src/assets/` for an unquoted delimiter and fails on any site
 * that is not in the frozen exclusion list below. It does NOT scan `dist/`: dist is
 * compiled from src, so a src-scoped scan catches the same text one step earlier and
 * cannot be satisfied by a stale build.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { ROOT, walkFiles } from '../helpers.js';

/**
 * An unquoted heredoc delimiter, in the shell's own grammar: `<<` or `<<-`, optional
 * blanks, then a delimiter word whose first character is neither a quote nor a
 * backslash.
 *
 * Case is irrelevant to the shell, so it is irrelevant here — `<<eof` and `<<Body`
 * expand every `$VAR` in their bodies exactly as `<<EOF` does — and the blanks are
 * part of the grammar too: `run-hook` opens with the spaced form (`: << 'CMDBLOCK'`),
 * so a recipe is one dropped pair of quotes away from a spelling a delimiter-adjacent
 * pattern cannot see at all.
 *
 * Quoting is what turns expansion off, and any of the three spellings does it:
 * `<<'EOF'`, `<<"EOF"`, `<<\EOF`. Hence the `(?!['"\\])` lookahead — the safe forms are
 * excluded by the quote character itself, not by a word class that happens to omit it.
 *
 * The here-string `<<<` is excluded in both directions: `(?!<)` stops a match opening
 * on the first two of the three `<`, and `(?<!<)` stops one opening on the last two.
 * Without the pair, `read -r line <<< value` — a bare word after `<<<`, where no
 * delimiter exists at all — would be reported as an unquoted heredoc.
 *
 * NOT COVERED, deliberately (PF-064 — a guard that certifies by finding NOTHING proves
 * only the weakest reading of what it stacks, so the matcher's edge is written down
 * rather than inferred from a green run). Each was checked absent from `src/assets/`
 * when this was written:
 *   - a delimiter formed by an expansion — `<<$VAR`, `<<${NAME}`. The word is unquoted,
 *     so the body IS expanded; the delimiter is simply not a literal a word class can
 *     name. False-NEGATIVE direction.
 *   - a delimiter quoted or escaped after its FIRST character — `<<EO\F`, `<<EOF'x'`.
 *     The shell quotes the WHOLE delimiter when any part of the word is quoted, so
 *     these are safe and would still be reported. False-POSITIVE direction: read the
 *     hit and justify an exclusion below; never narrow the pattern back.
 *   - a delimiter separated from its `<<` by a line continuation (`<<\` + newline +
 *     `EOF`). The shell joins those lines before it parses the redirection; this scan
 *     is line-by-line and sees two halves.
 *   - a delimiter that starts with a digit (`<<9EOF`). Admitting `[0-9]` as a first
 *     character would make the now-accepted blanks read a left-shift expression
 *     (`x << 2`) as a heredoc; nothing in the corpus spells either, and a false
 *     negative on a delimiter nobody writes is the cheaper of the two.
 * Each is a non-goal only while nothing ships it. The moment a recipe adopts one,
 * widen the pattern WITH its own row in the probe below, in the same commit as the
 * recipe (ADR-025) — never a quiet alternation.
 */
const UNQUOTED_HEREDOC_RE = /(?<!<)<<(?!<)-?[ \t]*(?!['"\\])[A-Za-z_][A-Za-z0-9_]*/;

/** Files worth scanning: prompt assets and the shell hooks, not binaries. */
const SCANNED_EXTENSIONS: readonly string[] = ['.md', '.mds', '.sh', '.bash'];

/**
 * Frozen exclusions — real shell programs under `src/assets/scripts/hooks/` whose
 * heredocs deliberately interpolate a shell variable the script itself computed.
 *
 * They are NOT prompt text: nothing copies them into a command, and the values they
 * expand are the script's own. They are listed by `file:line` rather than silenced by
 * narrowing the scan, so a NEW unquoted heredoc anywhere — including a fourth one in
 * these same files — goes red, and an entry that stops matching goes red too. The
 * list may shrink, never grow.
 */
const KNOWN_UNQUOTED_HEREDOCS: readonly string[] = [
  'src/assets/scripts/hooks/background-memory-update:299',
  'src/assets/scripts/hooks/background-memory-update:403',
  'src/assets/scripts/hooks/capture-question:147',
];

interface HeredocSite {
  /** Repo-relative, POSIX-spelled. */
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** Named collector: every unquoted heredoc delimiter under a root directory. */
function collectUnquotedHeredocs(dir: string): { filesScanned: number; sites: HeredocSite[] } {
  const files = walkFiles(dir, file => {
    // Hook scripts are extensionless by convention; include them explicitly.
    if (file.includes(`${path.sep}hooks${path.sep}`)) return true;
    return SCANNED_EXTENSIONS.some(ext => file.endsWith(ext));
  });

  const sites: HeredocSite[] = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    readFileSync(file, 'utf-8').split('\n').forEach((text, index) => {
      if (UNQUOTED_HEREDOC_RE.test(text)) {
        sites.push({ file: rel, line: index + 1, text: text.trim() });
      }
    });
  }
  return { filesScanned: files.length, sites };
}

describe('heredoc quoting: no unquoted delimiter ships in src/assets/ (GAP-15, S10)', () => {
  const scan = collectUnquotedHeredocs(path.join(ROOT, 'src', 'assets'));

  it('scans a real corpus', () => {
    expect(
      scan.filesScanned,
      'src/assets/ produced no scannable files — the guard would pass by reading nothing',
    ).toBeGreaterThan(50);
  });

  it('every unquoted heredoc is one of the frozen shell-script exclusions', () => {
    const unexpected = scan.sites
      .filter(s => !KNOWN_UNQUOTED_HEREDOCS.includes(`${s.file}:${s.line}`))
      .map(s => `${s.file}:${s.line}  ${s.text}`);
    expect(
      unexpected,
      'unquoted heredoc delimiter(s) found — single-quote the delimiter (`<<\'EOF\'`) and ' +
      'compose any interpolated value BEFORE the heredoc:\n  ' + unexpected.join('\n  '),
    ).toEqual([]);
  });

  it('no frozen exclusion has gone stale', () => {
    const seen = new Set(scan.sites.map(s => `${s.file}:${s.line}`));
    expect(
      KNOWN_UNQUOTED_HEREDOCS.filter(known => !seen.has(known)),
      'frozen exclusion(s) no longer match an unquoted heredoc — delete them from the list ' +
      '(a stale exclusion silences whatever moves onto that line next)',
    ).toEqual([]);
  });

  it('known-bad probe: every spelling the pattern claims to read fires, and the safe ones do not', () => {
    // Labelled rows in BOTH directions, one per spelling. A bare list of `toBe(true)`
    // calls cannot say WHICH spelling stopped matching when someone narrows the
    // pattern, and the RED half alone would be satisfied by a pattern that flagged
    // every line in the corpus (PF-018).
    const expands: ReadonlyArray<readonly [string, string]> = [
      ['uppercase', 'PROMPT=$(cat <<EOF'],
      ['tab-stripping `<<-`', 'git commit -m "$(cat <<-MSG'],
      ['lowercase', 'cat <<eof'],
      ['mixed case', 'cat <<Body'],
      ['underscore-led', 'cat <<_private'],
      ['blanks before the delimiter', ': << EOF'],
      ['blanks after `<<-`', 'cat <<-\tEOF'],
      // The shape a heredoc takes once it is joined to an `&&` chain: brace-grouped
      // so the compose step HAS a status the chain can gate on. The opening brace
      // sits before the redirect, and a delimiter-adjacent pattern that anchored on
      // the start of the line would stop reading the line at all.
      ['brace-grouped, unquoted', '{ cat > "$RAW" <<EOF'],
    ];
    const missed = expands.filter(([, text]) => !UNQUOTED_HEREDOC_RE.test(text)).map(([l]) => l);
    expect(
      missed,
      'unquoted heredoc spelling(s) the pattern no longer reads — a body written that way ' +
      `expands every $VAR, backtick and $(…) in it and nothing reports it:\n  ${missed.join('\n  ')}`,
    ).toEqual([]);

    // GREEN controls: the quoted forms the recipes are supposed to end up in, plus the
    // two here-string shapes that carry no delimiter at all.
    const inert: ReadonlyArray<readonly [string, string]> = [
      ['single-quoted', "git commit -m \"$(cat <<'EOF'"],
      ['double-quoted', 'cat <<"EOF"'],
      ['backslash-escaped', 'cat <<\\EOF'],
      ['quoted after blanks — the shape `run-hook` opens with', ": << 'CMDBLOCK'"],
      ['quoted after `<<-`', "cat <<-'EOF'"],
      ['here-string, quoted word', 'read -r line <<< "$value"'],
      ['here-string, bare word', 'read -r line <<< value'],
      ['brace-grouped, single-quoted', "{ cat > \"$RAW\" <<'EOF'"],
    ];
    const flagged = inert.filter(([, text]) => UNQUOTED_HEREDOC_RE.test(text)).map(([l]) => l);
    expect(
      flagged,
      'safe form(s) reported as unquoted — a pattern that flags the compliant shapes grows ' +
      `the exclusion list below until neither means anything:\n  ${flagged.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: a seeded unquoted heredoc is reported by the same collector', () => {
    // A real seed, not a re-scan of a live subset. The previous shape pointed the
    // collector at src/assets/scripts/hooks/ and asserted it found the three
    // already-frozen sites — which proves the walk reaches THAT directory and
    // nothing about the guard's ability to catch a NEW violation. Here the
    // violation is written into a throwaway corpus and driven through the same
    // collector, with a quoted control alongside it so a collector that flagged
    // everything would not pass either. No committed file is touched (H10).
    const dir = mkdtempSync(path.join(tmpdir(), 'devflow-heredoc-probe-'));
    try {
      // GREEN half: the safe form is scanned and NOT reported.
      writeFileSync(path.join(dir, 'safe.sh'), "cat <<'EOF'\nno $expansion here\nEOF\n");
      const clean = collectUnquotedHeredocs(dir);
      expect(clean.filesScanned, 'the control file must be scanned').toBe(1);
      expect(clean.sites, 'a quoted delimiter must not be reported').toEqual([]);

      // RED half: the injection template, in the shape the guard exists for.
      writeFileSync(path.join(dir, 'seeded.sh'), 'PROMPT="$(cat <<EOF\n${UNTRUSTED_TITLE}\nEOF\n)"\n');
      const seeded = collectUnquotedHeredocs(dir);
      expect(seeded.filesScanned, 'both probe files must be scanned').toBe(2);
      expect(
        seeded.sites.map(s => `${s.file.split('/').pop()}:${s.line}`),
        'the collector must report the seeded unquoted heredoc, and only it — otherwise ' +
        'the live scan above is green because it never reaches any file (PF-018)',
      ).toEqual(['seeded.sh:1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

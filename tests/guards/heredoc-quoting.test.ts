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
 * An unquoted heredoc delimiter: `<<` (optionally `<<-`) followed directly by an
 * uppercase word. The quoted forms `<<'EOF'` and `<<"EOF"` do not match, and neither
 * does the here-string `<<<`.
 */
const UNQUOTED_HEREDOC_RE = /<<-?[A-Z][A-Z0-9_]*/;

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

  it('known-bad probe: the pattern sees the shape it guards against, and not the safe ones', () => {
    expect(UNQUOTED_HEREDOC_RE.test("PROMPT=$(cat <<EOF")).toBe(true);
    expect(UNQUOTED_HEREDOC_RE.test('git commit -m "$(cat <<-MSG')).toBe(true);
    expect(UNQUOTED_HEREDOC_RE.test("git commit -m \"$(cat <<'EOF'")).toBe(false);
    expect(UNQUOTED_HEREDOC_RE.test('cat <<"EOF"')).toBe(false);
    expect(UNQUOTED_HEREDOC_RE.test('read -r line <<< "$value"')).toBe(false);
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

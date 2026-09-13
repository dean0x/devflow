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
import { readFileSync } from 'fs';
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
    // Runs the real collector over a directory that is guaranteed to contain one,
    // rather than re-testing the regex: this proves the walk reaches the text.
    const seededDir = path.join(ROOT, 'src', 'assets', 'scripts', 'hooks');
    const seeded = collectUnquotedHeredocs(seededDir);
    expect(
      seeded.sites.length,
      'the collector must find the known unquoted heredocs in the hook scripts — ' +
      'otherwise the scan above passes because it never reaches any file',
    ).toBe(KNOWN_UNQUOTED_HEREDOCS.length);
  });
});

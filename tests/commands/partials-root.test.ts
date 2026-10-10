/**
 * D-PROMPT-ROOT (#390, TP-21) — the compiled loaders read the repository's data
 * from the right root, whatever directory the session started in.
 *
 * `decisions_load` (src/assets/commands/_partials/_decisions.mds) reads the
 * learning index from the MAIN worktree's ledger, else the checkout's toplevel,
 * else the start directory — the rule the learning hooks apply
 * (D-LEDGER-MAIN-WORKTREE), so a command reads the index the Learning agent
 * writes. `knowledge_load`/`knowledge_writeback` (_knowledge.mds) resolve the
 * checkout's toplevel, else the start directory: knowledge bases are committed
 * per branch. `docs_root` (_docs_root.mds, D-DOCS-ROOT) applies the knowledge rule
 * to every `.devflow/docs/` artifact a command reads or writes — tests/guards/
 * docs-root.test.ts holds the paths to it, and this file runs its command. Both used to read from cwd, so a session started in `packages/app`
 * loaded `(none)` and a write-back committed `packages/app/.devflow/features`.
 * The other decisions readers follow the same ledger: the dynamic commands'
 * `authoring_decisions` step (all four dynamic hosts, dynamic-profile included)
 * and the release command both expand `decisions_locate`. No agent reads the
 * index for itself any more (the Code agent's fallback is gone, #426), and
 * every expansion sits behind the `decisions_gate` sentence.
 *
 * The rule is prose an LLM follows around ONE git command. The test extracts that
 * command from every compiled command that carries the loader, runs it verbatim
 * from the root, a subdirectory and a linked worktree, and applies the rule the
 * prose states — so the command and the rule are proven to agree on real git
 * output. A known-bad probe runs the superseded cwd reading through the same
 * resolver and shows it misses.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireDistFile, requireDistFiles, resolveAgentSource } from '../helpers.js';

const DECISIONS_HEADING = '### Load DECISIONS_CONTEXT';
const AUTHORING_DECISIONS_HEADING = '### DECISIONS_CONTEXT — obtain BEFORE authoring';
const RELEASE_CONTEXT_HEADING = '### Phase 1b: Load Context';
const KNOWLEDGE_HEADING = '### Load Feature Knowledge';
const WRITEBACK_HEADING = '### Feature Knowledge Write-Back (Conditional)';
const DOCS_ROOT_LEAD = '**Docs root (D-DOCS-ROOT).**';

/** The section of `text` that starts at `heading`, up to the next `### ` heading. */
function sectionOf(text: string, heading: string): string {
  const at = text.indexOf(heading);
  if (at === -1) return '';
  const rest = text.slice(at + heading.length);
  const next = rest.indexOf('\n### ');
  return heading + (next === -1 ? rest : rest.slice(0, next));
}

/** Named collector: the one `git -C "{start}" ...` line inside a section's bash fence. */
function collectGitCommand(section: string): string | null {
  const fence = /```bash\n(git -C "\{start\}" [^\n]+)\n```/.exec(section);
  return fence?.[1] ?? null;
}

/** Run a compiled command line with `{start}` bound to `start`; stdout, or null on failure. */
function runFromStart(commandLine: string, start: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const out = spawnSync('bash', ['-c', commandLine.replace('{start}', '$1'), '_', start], { encoding: 'utf-8', env });
  return out.status === 0 ? out.stdout.replace(/\n$/, '') : null;
}

/** What git before 2.31 prints first for the loader's call: the unknown flag, echoed back. */
const PATH_FORMAT_ECHO = '--path-format=absolute';

/** The hooks' DF_LEDGER_ROOT for `cwd`, from resolve-project-root itself. */
function hookLedgerRoot(cwd: string, env: NodeJS.ProcessEnv): string {
  const helper = path.resolve(import.meta.dirname, '..', '..', 'src', 'assets', 'scripts', 'hooks', 'resolve-project-root');
  const out = spawnSync(
    'bash',
    ['-c', 'source "$1"; df_resolve_roots "$2"; printf %s "$DF_LEDGER_ROOT"', '_', helper, cwd],
    { encoding: 'utf-8', env },
  );
  return out.stdout;
}

/**
 * The decisions rule, exactly as the compiled prose states it. `home` is the
 * reader's home directory: a main worktree AT home (a dotfiles repository) is
 * refused, because its `.devflow/` is devflow's machine root, which always
 * exists — the hooks' df_is_project_root refuses it the same way.
 */
function ledgerFrom(output: string | null, start: string, home: string = os.homedir()): string {
  const lines = output === null ? [] : output.split('\n');
  // A git before 2.31 echoes the flag back first: the toplevel is the line after it.
  if (lines.length === 3 && lines[0] === PATH_FORMAT_ECHO && lines[1].startsWith('/')) return lines[1];
  if (lines.length !== 2 || !lines.every(l => l.startsWith('/'))) return start;
  const [top, common] = lines;
  if (common.endsWith('/.git')) {
    const main = common.slice(0, -'/.git'.length);
    const atHome = fs.existsSync(home) && fs.realpathSync(main) === fs.realpathSync(home);
    if (fs.existsSync(path.join(main, '.devflow')) && !atHome) return main;
  }
  return top;
}

/** The knowledge rule: the toplevel, else the start directory. */
function worktreeFrom(output: string | null, start: string): string {
  return output === null || output.includes('\n') || !output.startsWith('/') ? start : output;
}

// Real git fixtures and ~12 git spawns in all: budgeted past vitest's 5 s default.
describe('compiled loaders resolve the repository root, not cwd (D-PROMPT-ROOT, TP-21)', { timeout: 30_000 }, () => {
  let base: string;
  let main: string;
  let sub: string;
  let wt: string;
  let outside: string;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'partials-root-'));
    main = path.join(base, 'main');
    fs.mkdirSync(main);
    execSync('git init -q', { cwd: main, stdio: 'pipe' });
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: main, stdio: 'pipe' });
    fs.mkdirSync(path.join(main, '.devflow', 'learning'), { recursive: true });
    sub = path.join(main, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    wt = path.join(base, 'wt');
    execSync(`git worktree add -q "${wt}" -b feat`, { cwd: main, stdio: 'pipe' });
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'partials-root-nongit-'));
    main = fs.realpathSync(main);
    wt = fs.realpathSync(wt);
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const decisionsHosts = () => requireDistFiles().filter(f => requireDistFile(f).includes(DECISIONS_HEADING));
  const knowledgeHosts = (heading: string) =>
    requireDistFiles().filter(f => requireDistFile(f).includes(heading));

  it('reads a real corpus: the loaders are compiled into their host commands', () => {
    // Non-vacuity: an empty host set would pass every check below.
    expect(decisionsHosts().length).toBeGreaterThanOrEqual(9);
    expect(knowledgeHosts(KNOWLEDGE_HEADING).length).toBeGreaterThanOrEqual(6);
    expect(knowledgeHosts(WRITEBACK_HEADING).sort()).toEqual(
      ['debug.md', 'explore.md', 'implement.md', 'resolve.md', 'self-review.md'],
    );
  });

  it('every compiled decisions loader makes ONE git call and reads index.md from the main ledger', () => {
    for (const file of decisionsHosts()) {
      const section = sectionOf(requireDistFile(file), DECISIONS_HEADING);
      const command = collectGitCommand(section);
      expect(command, `${file}: the resolution command`).toBe(
        'git -C "{start}" rev-parse --path-format=absolute --show-toplevel --git-common-dir',
      );
      expect(section, `${file}: the index path`).toContain('`{ledger}/.devflow/learning/index.md`');
      expect(section, `${file}: the retired "no subprocess" claim`).not.toContain('No subprocess');
      // The rule's three arms, in order.
      const order = ['**The main worktree**', '**The toplevel**', '**The start directory itself**']
        .map(arm => section.indexOf(arm));
      expect(order.every(i => i > -1), `${file}: every arm stated`).toBe(true);
      expect([...order].sort((a, b) => a - b), `${file}: arms in order`).toEqual(order);
      // The main-worktree arm carries the hooks' HOME refusal (df_is_project_root).
      const mainArm = section.slice(order[0], order[1]);
      expect(mainArm, `${file}: the main arm refuses a main worktree at HOME`)
        .toContain('once it is removed is not your home directory');
      // A git before 2.31 falls back to the toplevel, as the hooks do (AC-15) —
      // never to the start directory.
      const topArm = section.slice(order[1], order[2]);
      expect(topArm, `${file}: old git reads the toplevel after the echoed flag`)
        .toContain('the line after the echoed flag');
      const startArm = section.slice(order[2], section.indexOf('This is the rule'));
      expect(startArm, `${file}: old git is not a start-directory case`).not.toContain('2.31');
    }
  });

  it('a git before 2.31 — the flag echoed back — reads the toplevel, as the hooks do', () => {
    const command = collectGitCommand(sectionOf(requireDistFile(decisionsHosts()[0]), DECISIONS_HEADING));
    expect(command).not.toBeNull();
    // Old git prints the unknown flag back as a line of its own, then the answers.
    const shim = fs.mkdtempSync(path.join(base, 'old-git-'));
    fs.writeFileSync(path.join(shim, 'git'), [
      '#!/bin/bash',
      'case "$*" in',
      `  *--path-format=absolute*) printf '%s\\n' '${PATH_FORMAT_ECHO}' ${JSON.stringify(main)} '.git' ;;`,
      `  *--show-toplevel*) printf '%s\\n' ${JSON.stringify(main)} ;;`,
      '  *) exit 1 ;;',
      'esac',
    ].join('\n') + '\n');
    fs.chmodSync(path.join(shim, 'git'), 0o755);
    const env = { ...process.env, PATH: `${shim}:${process.env.PATH ?? ''}` };

    const output = runFromStart(command as string, sub, env);
    expect(output?.split('\n')[0], 'the shim echoes the flag').toBe(PATH_FORMAT_ECHO);
    expect(ledgerFrom(output, sub)).toBe(main);
    expect(ledgerFrom(output, sub)).toBe(hookLedgerRoot(sub, env));
  });

  it('the decisions command resolves the main ledger from the root, a subdirectory and a linked worktree', () => {
    const command = collectGitCommand(sectionOf(requireDistFile(decisionsHosts()[0]), DECISIONS_HEADING));
    expect(command).not.toBeNull();
    for (const [label, start] of [['root', main], ['subdir', sub], ['worktree', wt]] as const) {
      expect(ledgerFrom(runFromStart(command as string, start), start), label).toBe(main);
    }
    // Outside a repository the command fails and the start directory stands.
    expect(ledgerFrom(runFromStart(command as string, outside), outside)).toBe(outside);
  });

  it('a dotfiles repository — main worktree at HOME — keeps the ledger in the linked worktree', () => {
    // HOME's `.devflow/` is the machine root and always exists, so the existence
    // test alone would name HOME as the ledger. The hooks refuse it; so does the prose.
    const command = collectGitCommand(sectionOf(requireDistFile(decisionsHosts()[0]), DECISIONS_HEADING));
    expect(command).not.toBeNull();
    expect(ledgerFrom(runFromStart(command as string, wt), wt, main), 'worktree').toBe(wt);
    expect(ledgerFrom(runFromStart(command as string, main), main, main), 'root').toBe(main);
    // Non-vacuity: the same worktree with a home elsewhere still resolves to main.
    expect(ledgerFrom(runFromStart(command as string, wt), wt, outside)).toBe(main);
  });

  it('every compiled knowledge loader and write-back resolves the checkout toplevel', () => {
    for (const heading of [KNOWLEDGE_HEADING, WRITEBACK_HEADING]) {
      for (const file of knowledgeHosts(heading)) {
        const section = sectionOf(requireDistFile(file), heading);
        expect(collectGitCommand(section), `${file} ${heading}`).toBe('git -C "{start}" rev-parse --show-toplevel');
        expect(section, `${file}: the retired "no git calls" claim`).not.toContain('no git calls');
      }
    }
    const command = collectGitCommand(sectionOf(requireDistFile(knowledgeHosts(KNOWLEDGE_HEADING)[0]), KNOWLEDGE_HEADING));
    // Knowledge bases are per branch: a worktree reads its OWN toplevel, not main's.
    for (const [label, start, expected] of [['root', main, main], ['subdir', sub, main], ['worktree', wt, wt]] as const) {
      expect(worktreeFrom(runFromStart(command as string, start), start), label).toBe(expected);
    }
    expect(worktreeFrom(runFromStart(command as string, outside), outside)).toBe(outside);
  });

  it('every compiled docs root resolves the checkout toplevel, from a root, a subdirectory and a worktree', () => {
    const hosts = knowledgeHosts(DOCS_ROOT_LEAD);
    // Non-vacuity: the seven docs-writing commands carry it.
    expect(hosts.length).toBeGreaterThanOrEqual(7);
    for (const file of hosts) {
      const section = sectionOf(requireDistFile(file), DOCS_ROOT_LEAD);
      expect(collectGitCommand(section), `${file}: the docs-root command`).toBe('git -C "{start}" rev-parse --show-toplevel');
      expect(section, `${file}: outside git the start directory stands`)
        .toContain('If the command fails (outside a git repository), `{worktree}` is the start directory itself.');
    }
    const command = collectGitCommand(sectionOf(requireDistFile(hosts[0]), DOCS_ROOT_LEAD));
    // Docs artifacts are per checkout, like knowledge bases: a worktree writes its OWN.
    for (const [label, start, expected] of [['root', main, main], ['subdir', sub, main], ['worktree', wt, wt]] as const) {
      expect(worktreeFrom(runFromStart(command as string, start), start), label).toBe(expected);
    }
    expect(worktreeFrom(runFromStart(command as string, outside), outside)).toBe(outside);
  });

  it('the dynamic commands locate the main ledger by the same rule before authoring', () => {
    const hosts = knowledgeHosts(AUTHORING_DECISIONS_HEADING)
    // Non-vacuity: every command that expands authoring_decisions, once each.
    expect(hosts.sort()).toEqual(['dynamic-build.md', 'dynamic-plan.md', 'dynamic-profile.md', 'dynamic-tickets.md'])
    for (const file of hosts) {
      const section = sectionOf(requireDistFile(file), AUTHORING_DECISIONS_HEADING)
      expect(collectGitCommand(section), `${file}: the resolution command`).toBe(
        'git -C "{start}" rev-parse --path-format=absolute --show-toplevel --git-common-dir',
      )
      expect(section, `${file}: the index path`).toContain('`{ledger}/.devflow/learning/index.md`')
      expect(section, `${file}: the retired checkout-relative read`).not.toContain('for the current worktree')
      for (const arm of ['**The main worktree**', '**The toplevel**', '**The start directory itself**']) {
        expect(section, `${file}: ${arm}`).toContain(arm)
      }
    }
    const command = collectGitCommand(sectionOf(requireDistFile(hosts[0]), AUTHORING_DECISIONS_HEADING))
    expect(ledgerFrom(runFromStart(command as string, wt), wt)).toBe(main)
  })

  it('release.md expands the decisions locate rule behind the learning gate and reads the index from the ledger it names', () => {
    // release.mds imports the two defines, so the compiled section is the define bodies.
    const partial = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', '..', 'src', 'assets', 'commands', '_partials', '_decisions.mds'),
      'utf-8',
    )
    const locate = /^@define decisions_locate\(\):\n([\s\S]*?)\n@end$/m.exec(partial)?.[1] ?? ''
    expect(locate, 'the locate define body').toContain('**The main worktree**')
    const gate = /^@define decisions_gate\(\):\n([\s\S]*?)\n@end$/m.exec(partial)?.[1] ?? ''
    expect(gate, 'the gate define body').toContain('`LEARNING=off`')
    const release = sectionOf(requireDistFile('release.md'), RELEASE_CONTEXT_HEADING)
    expect(release).toContain(locate)
    expect(release.indexOf(gate), 'the gate sentence comes first').toBeGreaterThan(-1)
    expect(release.indexOf(gate), 'the gate precedes the locate call').toBeLessThan(release.indexOf(locate))
    expect(release.indexOf(locate), 'the locate call precedes the index read')
      .toBeLessThan(release.indexOf('Read `{ledger}/.devflow/learning/index.md`.'))
    expect(ledgerFrom(runFromStart(collectGitCommand(release) as string, wt), wt)).toBe(main)
  })

  it('release.mds copies none of the locate text: it expands the define', () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', '..', 'src', 'assets', 'commands', 'release.mds'),
      'utf-8',
    )
    expect(source).toContain('{{decisions_locate()}}')
    expect(source).not.toContain('The decisions ledger belongs to the repository')
    expect(source).not.toContain('--path-format=absolute')
  })

  it('no agent source tells its agent to resolve the main-worktree ledger for itself, except Skim\'s TL;DR read', () => {
    // The Code agent used to carry a fallback that located the index from the
    // common git directory; it takes DECISIONS_CONTEXT or nothing.
    const code = resolveAgentSource('code').content
    expect(code).not.toContain('--git-common-dir')
    expect(code).not.toContain('Otherwise read the decisions index')
    expect(resolveAgentSource('skim').content, 'the one read left is a different file: the decisions TL;DR').toContain('--git-common-dir')
  })

  it('known-bad probe: reading from cwd misses the ledger from a subdirectory and a worktree', () => {
    // The superseded loaders used the start directory as the root. The same
    // resolver, handed no command output, reproduces that reading — and it lands
    // on neither the main ledger nor the toplevel.
    expect(ledgerFrom(null, sub)).not.toBe(main);
    expect(ledgerFrom(null, wt)).not.toBe(main);
    expect(worktreeFrom(null, sub)).not.toBe(main);
  });
});

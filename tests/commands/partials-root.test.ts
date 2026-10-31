/**
 * D-PROMPT-ROOT (#390, TP-21) — the compiled loaders read the repository's data
 * from the right root, whatever directory the session started in.
 *
 * One step resolves both roots: `root_paths` (src/assets/commands/_partials/_docs_root.mds)
 * runs `resolve-root.cjs` once per run and takes `{worktree}` and `{ledger}` from its
 * answer. `docs_root`, `knowledge_root` and `decisions_locate` each expand it and add the
 * fact their host needs.
 *
 * `decisions_load` (src/assets/commands/_partials/_decisions.mds) reads the
 * curation index from `{ledger}`: the MAIN worktree's copy, else the checkout's toplevel,
 * else the start directory — the rule the curation hooks apply
 * (D-LEDGER-MAIN-WORKTREE), so a command reads the index the Curate agent
 * writes. `knowledge_load`/`knowledge_writeback` (_knowledge.mds) use `{worktree}`, the
 * checkout's toplevel, else the start directory: knowledge bases are committed
 * per branch. A write-back that follows a load in the same command
 * (`knowledge_writeback_after_load`) takes the `{worktree}` the load resolved.
 * `docs_root` (_docs_root.mds, D-DOCS-ROOT) applies the knowledge rule
 * to every `.devflow/docs/` artifact a command reads or writes — tests/guards/
 * docs-root.test.ts holds the paths to it, and this file runs its command. Both used to read from cwd, so a session started in `packages/app`
 * loaded `(none)` and a write-back committed `packages/app/.devflow/features`.
 * The other decisions readers follow the same ledger: the dynamic commands'
 * `authoring_decisions` step (all four dynamic hosts, dynamic-profile included)
 * and the release command both expand `decisions_locate`. No agent reads the
 * index for itself any more (the Code agent's fallback is gone, #426), and
 * every expansion sits behind the `decisions_gate` sentence.
 *
 * The rule is prose an LLM follows around ONE script command. The test extracts that
 * command from every compiled command that carries a root step, runs it verbatim
 * from the root, a subdirectory and a linked worktree, and applies the acceptance rule
 * the prose states — so the command and the rule are proven to agree on real output.
 * A known-bad probe runs the superseded cwd reading through the same rule and shows it misses.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OFF_VARIANT_KEYS } from '../../src/core/curation-variants.js';
import { requireDistFile, requireDistFiles, resolveAgentSource, resolveVariantOffSource } from '../helpers.js';

const DECISIONS_HEADING = '### Load DECISIONS_CONTEXT';
const AUTHORING_DECISIONS_HEADING = '### DECISIONS_CONTEXT — obtain BEFORE authoring';
const RELEASE_CONTEXT_HEADING = '### Phase 1b: Load Context';
const KNOWLEDGE_HEADING = '### Load Feature Knowledge';
const WRITEBACK_HEADING = '### Feature Knowledge Write-Back (Conditional)';
const DOCS_ROOT_LEAD = '**Docs root (D-DOCS-ROOT).**';

/** The one command every root step runs. */
const ROOT_COMMAND = 'node "$HOME/.devflow/scripts/resolve-root.cjs" "{start}"; echo "exit=$?"';

/** The sentence that makes the step run once per run. */
const ONCE_PER_RUN = 'Once per run: if this run already resolved the roots, reuse them.';

/** What the prose says to do with any answer but the three accepted lines. */
const FALLBACK_SENTENCE = 'Otherwise both are the start directory.';

const SOURCE_DIR = path.resolve(import.meta.dirname, '..', '..', 'src', 'assets');
const SCRIPTS_DIR = path.join(SOURCE_DIR, 'scripts');
const PARTIALS_DIR = path.join(SOURCE_DIR, 'commands', '_partials');

/** The section of `text` that starts at `heading`, up to the next `### ` heading. */
function sectionOf(text: string, heading: string): string {
  const at = text.indexOf(heading);
  if (at === -1) return '';
  const rest = text.slice(at + heading.length);
  const next = rest.indexOf('\n### ');
  return heading + (next === -1 ? rest : rest.slice(0, next));
}

/** Named collector: the one root command line inside a section's bash fence. */
function collectRootCommand(section: string): string | null {
  const fence = /```bash\n(node "\$HOME\/\.devflow\/scripts\/resolve-root\.cjs" [^\n]+)\n```/.exec(section);
  return fence?.[1] ?? null;
}

/**
 * Named collector: how a command's write-back gets the checkout root, and what is wrong with it.
 * A write-back that follows the load step in the same command takes the `{worktree}` that step
 * resolved and carries no copy; a write-back with no load before it resolves the root itself.
 */
function collectWritebackRootDefects(text: string): string[] {
  const writebackAt = text.indexOf(WRITEBACK_HEADING);
  const loadAt = text.indexOf(KNOWLEDGE_HEADING);
  const command = collectRootCommand(sectionOf(text, WRITEBACK_HEADING));
  if (loadAt !== -1 && loadAt < writebackAt) {
    return command === null ? [] : ['the write-back repeats the root the load step resolved'];
  }
  return command === ROOT_COMMAND ? [] : ['a write-back with no load step before it does not resolve the root'];
}

/**
 * The commands that resolve `{worktree}` with `docs_root()` first and then call
 * `knowledge_load_after_root()`, whose load steps carry no root block of their own.
 */
const AFTER_ROOT_LOAD_HOSTS: readonly string[] = ['implement.md'];

/**
 * Named collector: how a compiled command's load step gets the checkout root, and what is wrong with it.
 * Every host but the after-root ones carries the root block in its load section. An after-root host
 * carries none, and must resolve the same root with its docs-root step before the load section.
 */
function collectKnowledgeRootDefects(file: string, text: string): string[] {
  const command = collectRootCommand(sectionOf(text, KNOWLEDGE_HEADING));
  if (!AFTER_ROOT_LOAD_HOSTS.includes(file)) {
    return command === ROOT_COMMAND ? [] : [`${file}: the load step does not resolve the root`];
  }
  const out: string[] = [];
  if (command !== null) out.push(`${file}: the load step repeats the root the docs-root step resolved`);
  const docsAt = text.indexOf(DOCS_ROOT_LEAD);
  const docsCommand = collectRootCommand(sectionOf(text, DOCS_ROOT_LEAD));
  if (docsAt === -1 || docsAt > text.indexOf(KNOWLEDGE_HEADING) || docsCommand !== ROOT_COMMAND) {
    out.push(`${file}: no docs-root step resolves the root before the load step`);
  }
  return out;
}

/** The scratch home whose `.devflow/scripts` is the source scripts folder: the path a prompt's command names. */
function homeWithScripts(home: string): string {
  const devflow = path.join(home, '.devflow');
  fs.mkdirSync(devflow, { recursive: true });
  const link = path.join(devflow, 'scripts');
  if (!fs.existsSync(link)) fs.symlinkSync(SCRIPTS_DIR, link, 'dir');
  return home;
}

/** Run a compiled command line with `{start}` bound to `start`; its stdout without the last newline. */
function runFromStart(commandLine: string, start: string, env: NodeJS.ProcessEnv): string {
  const out = spawnSync('bash', ['-c', commandLine.replace('{start}', '$1'), '_', start], { encoding: 'utf-8', env });
  return out.stdout.replace(/\n$/, '');
}

/** What git before 2.31 prints first for the ledger call: the unknown flag, echoed back. */
const PATH_FORMAT_ECHO = '--path-format=absolute';

/** The hooks' DF_LEDGER_ROOT for `cwd`, from resolve-project-root itself. */
function hookLedgerRoot(cwd: string, env: NodeJS.ProcessEnv): string {
  const helper = path.join(SCRIPTS_DIR, 'hooks', 'resolve-project-root');
  const out = spawnSync(
    'bash',
    ['-c', 'source "$1"; df_resolve_roots "$2"; printf %s "$DF_LEDGER_ROOT"', '_', helper, cwd],
    { encoding: 'utf-8', env },
  );
  return out.stdout;
}

/**
 * The roots, exactly as the compiled prose states the accepted answer: the three lines
 * `WORKTREE=<absolute path>`, `LEDGER=<absolute path>` and `exit=0` set `{worktree}` and `{ledger}`;
 * any other output makes both the start directory.
 */
function rootsFrom(output: string, start: string): { worktree: string; ledger: string } {
  const lines = output.split('\n');
  const accepted = lines.length === 3
    && /^WORKTREE=\/./.test(lines[0])
    && /^LEDGER=\/./.test(lines[1])
    && lines[2] === 'exit=0';
  if (!accepted) return { worktree: start, ledger: start };
  return { worktree: lines[0].slice('WORKTREE='.length), ledger: lines[1].slice('LEDGER='.length) };
}

// Real git fixtures and ~14 script spawns in all: budgeted past vitest's 5 s default.
describe('compiled loaders resolve the repository root, not cwd (D-PROMPT-ROOT, TP-21)', { timeout: 30_000 }, () => {
  let base: string;
  let home: string;
  let main: string;
  let sub: string;
  let wt: string;
  let outside: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'partials-root-'));
    home = homeWithScripts(path.join(base, 'home'));
    main = path.join(base, 'main');
    fs.mkdirSync(main);
    execSync('git init -q', { cwd: main, stdio: 'pipe' });
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: main, stdio: 'pipe' });
    fs.mkdirSync(path.join(main, '.devflow', 'curation'), { recursive: true });
    sub = path.join(main, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    wt = path.join(base, 'wt');
    execSync(`git worktree add -q "${wt}" -b feat`, { cwd: main, stdio: 'pipe' });
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'partials-root-nongit-'));
    main = fs.realpathSync(main);
    wt = fs.realpathSync(wt);
    env = { ...process.env, HOME: home };
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

  it('the root step lives once, in _docs_root.mds, and the three root defines expand it', () => {
    const read = (file: string) => fs.readFileSync(path.join(PARTIALS_DIR, file), 'utf-8');
    const docsRoot = read('_docs_root.mds');
    expect(docsRoot.split('resolve-root.cjs" "{start}"').length - 1, 'the one step carries the command').toBe(1);
    expect(docsRoot).toContain(ONCE_PER_RUN);
    for (const [file, define] of [
      ['_docs_root.mds', 'docs_root'],
      ['_knowledge.mds', 'knowledge_root'],
      ['_decisions.mds', 'decisions_locate'],
    ] as const) {
      const source = read(file);
      const at = source.indexOf(`@define ${define}():`);
      expect(at, `${file} defines ${define}`).toBeGreaterThan(-1);
      expect(source.slice(at, source.indexOf('\n@end', at)), `${define} expands the shared step`).toContain('{{root_paths()}}');
    }
    for (const file of ['_knowledge.mds', '_decisions.mds']) {
      const source = read(file);
      expect(source, `${file} copies none of the step`).not.toContain('resolve-root.cjs" "{start}"');
      expect(source, `${file} imports the one define it needs`).toContain('@import { root_paths } from "./_docs_root.mds"');
    }
  });

  it('every compiled decisions loader runs the root command and reads index.md from the ledger it names', () => {
    for (const file of decisionsHosts()) {
      const section = sectionOf(requireDistFile(file), DECISIONS_HEADING);
      expect(collectRootCommand(section), `${file}: the resolution command`).toBe(ROOT_COMMAND);
      expect(section, `${file}: the index path`).toContain('`{ledger}/.devflow/curation/index.md`');
      expect(section, `${file}: the retired "no subprocess" claim`).not.toContain('No subprocess');
      expect(section, `${file}: the once-per-run sentence`).toContain(ONCE_PER_RUN);
      expect(section, `${file}: the repository owns the ledger`)
        .toContain("The decisions ledger belongs to the repository, not to one checkout: a linked worktree reads the main worktree's copy.");
      expect(section, `${file}: the superseded git call`).not.toContain('--git-common-dir');
      expect(section, `${file}: the fallback`).toContain(FALLBACK_SENTENCE);
    }
  });

  it('a git before 2.31 — the flag echoed back — reads the toplevel, as the hooks do', () => {
    const command = collectRootCommand(sectionOf(requireDistFile(decisionsHosts()[0]), DECISIONS_HEADING));
    expect(command).not.toBeNull();
    // Old git prints the unknown flag back as a line of its own, then the answers.
    const shim = fs.mkdtempSync(path.join(base, 'old-git-'));
    fs.writeFileSync(path.join(shim, 'git'), [
      '#!/bin/bash',
      'case "$*" in',
      `  *--path-format=absolute*) printf '%s\\n' '${PATH_FORMAT_ECHO}' ${JSON.stringify(wt)} '.git' ;;`,
      `  *--show-toplevel*) printf '%s\\n' ${JSON.stringify(wt)} ;;`,
      '  *) exit 1 ;;',
      'esac',
    ].join('\n') + '\n');
    fs.chmodSync(path.join(shim, 'git'), 0o755);
    const shimmed = { ...env, PATH: `${shim}:${process.env.PATH ?? ''}` };

    const output = runFromStart(command as string, sub, shimmed);
    expect(rootsFrom(output, sub)).toEqual({ worktree: wt, ledger: wt });
    expect(rootsFrom(output, sub).ledger).toBe(hookLedgerRoot(sub, shimmed));
  });

  it('the decisions command resolves the main ledger from the root, a subdirectory and a linked worktree', () => {
    const command = collectRootCommand(sectionOf(requireDistFile(decisionsHosts()[0]), DECISIONS_HEADING));
    expect(command).not.toBeNull();
    for (const [label, start] of [['root', main], ['subdir', sub], ['worktree', wt]] as const) {
      expect(rootsFrom(runFromStart(command as string, start, env), start).ledger, label).toBe(main);
    }
    // Outside a repository the start directory stands.
    expect(rootsFrom(runFromStart(command as string, outside, env), outside).ledger).toBe(outside);
  });

  it('a dotfiles repository — main worktree at HOME — keeps the ledger in the linked worktree', () => {
    // HOME's `.devflow/` is the machine root and always exists, so the existence
    // test alone would name HOME as the ledger. The hooks refuse it; so does the script.
    const command = collectRootCommand(sectionOf(requireDistFile(decisionsHosts()[0]), DECISIONS_HEADING));
    expect(command).not.toBeNull();
    const dotfiles = { ...env, HOME: homeWithScripts(main) };
    expect(rootsFrom(runFromStart(command as string, wt, dotfiles), wt).ledger, 'worktree').toBe(wt);
    expect(rootsFrom(runFromStart(command as string, main, dotfiles), main).ledger, 'root').toBe(main);
    // Non-vacuity: the same worktree with a home elsewhere still resolves to main.
    expect(rootsFrom(runFromStart(command as string, wt, env), wt).ledger).toBe(main);
  });

  it('every compiled knowledge loader resolves the checkout toplevel, and a write-back resolves it once', () => {
    for (const file of knowledgeHosts(KNOWLEDGE_HEADING)) {
      const section = sectionOf(requireDistFile(file), KNOWLEDGE_HEADING);
      expect(collectKnowledgeRootDefects(file, requireDistFile(file)), `${file} ${KNOWLEDGE_HEADING}`).toEqual([]);
      expect(section, `${file}: the retired "no git calls" claim`).not.toContain('no git calls');
      expect(section, `${file}: the retired "one git call" claim`).not.toContain('One git call');
    }
    // The docs-root order holds in every variant key of an after-root host, not only in the on key.
    for (const file of AFTER_ROOT_LOAD_HOSTS) {
      for (const key of OFF_VARIANT_KEYS) {
        const text = resolveVariantOffSource(key, 'commands', file.replace(/\.md$/, ''));
        expect(text, `${file} has a ${key} variant`).not.toBeNull();
        expect(collectKnowledgeRootDefects(file, text as string), `${file} ${key} ${KNOWLEDGE_HEADING}`).toEqual([]);
      }
    }
    // Non-vacuity: each after-root host loads knowledge, and the other hosts still carry the root block.
    const loadHosts = knowledgeHosts(KNOWLEDGE_HEADING);
    for (const file of AFTER_ROOT_LOAD_HOSTS) expect(loadHosts, `${file} loads knowledge`).toContain(file);
    expect(loadHosts.length - AFTER_ROOT_LOAD_HOSTS.length, 'no host carries the root block in its load section').toBeGreaterThanOrEqual(6);
    const writebackHosts = knowledgeHosts(WRITEBACK_HEADING);
    expect(writebackHosts.length, 'no command carries a write-back, so this guard proves nothing').toBeGreaterThanOrEqual(5);
    for (const file of writebackHosts) {
      const text = requireDistFile(file);
      expect(collectWritebackRootDefects(text), file).toEqual([]);
      expect(sectionOf(text, WRITEBACK_HEADING), `${file}: the retired "no git calls" claim`).not.toContain('no git calls');
    }
    // Non-vacuity: both arms exist, a write-back that follows a load and one that stands alone.
    const followsLoad = writebackHosts.filter(f => requireDistFile(f).includes(KNOWLEDGE_HEADING));
    expect(followsLoad.length, 'no write-back follows a load').toBeGreaterThanOrEqual(1);
    expect(writebackHosts.length - followsLoad.length, 'no write-back stands alone').toBeGreaterThanOrEqual(1);
    const rootHost = knowledgeHosts(KNOWLEDGE_HEADING).find(f => !AFTER_ROOT_LOAD_HOSTS.includes(f));
    const command = collectRootCommand(sectionOf(requireDistFile(rootHost as string), KNOWLEDGE_HEADING));
    // Knowledge bases are per branch: a worktree reads its OWN toplevel, not main's.
    for (const [label, start, expected] of [['root', main, main], ['subdir', sub, main], ['worktree', wt, wt]] as const) {
      expect(rootsFrom(runFromStart(command as string, start, env), start).worktree, label).toBe(expected);
    }
    expect(rootsFrom(runFromStart(command as string, outside, env), outside).worktree).toBe(outside);
  });

  it('known-bad probes: a write-back that repeats the load step root, and one with no root at all, are reported', () => {
    const block = `\`\`\`bash\n${ROOT_COMMAND}\n\`\`\``;
    const load = `${KNOWLEDGE_HEADING}\n\n${block}\n\n`;
    const writeback = (body: string) => `${WRITEBACK_HEADING}\n\n${body}\n\n**Step 1**`;
    const repeated = 'the write-back repeats the root the load step resolved';
    const missing = 'a write-back with no load step before it does not resolve the root';
    expect(collectWritebackRootDefects(`${load}${writeback(block)}`)).toEqual([repeated]);
    expect(collectWritebackRootDefects(`${load}${writeback('')}`)).toEqual([]);
    expect(collectWritebackRootDefects(writeback(''))).toEqual([missing]);
    expect(collectWritebackRootDefects(writeback(block))).toEqual([]);
    // A load that comes after the write-back does not resolve the root for it.
    expect(collectWritebackRootDefects(`${writeback('')}\n\n${load}`)).toEqual([missing]);
  });

  it('known-bad probes: a load step with no root, an after-root load with no docs root before it, and one that repeats the root are reported', () => {
    const block = `\`\`\`bash\n${ROOT_COMMAND}\n\`\`\``;
    const docsRoot = `${DOCS_ROOT_LEAD} Every path lives at the toplevel.\n\n${block}\n`;
    const steps = 'Step 1 — Read the index cache.\n';
    const noRoot = 'the load step does not resolve the root';
    const repeated = 'the load step repeats the root the docs-root step resolved';
    const noDocsRoot = 'no docs-root step resolves the root before the load step';
    // A host outside the after-root list needs the root block in its load section.
    expect(collectKnowledgeRootDefects('plan.md', `${KNOWLEDGE_HEADING}\n\n${block}\n\n${steps}`)).toEqual([]);
    expect(collectKnowledgeRootDefects('plan.md', `${KNOWLEDGE_HEADING}\n\n${steps}`)).toEqual([`plan.md: ${noRoot}`]);
    expect(collectKnowledgeRootDefects('plan.md', `${docsRoot}\n${KNOWLEDGE_HEADING}\n\n${steps}`)).toEqual([`plan.md: ${noRoot}`]);
    // An after-root host needs the docs-root step before the load section, and no second root block.
    expect(collectKnowledgeRootDefects('implement.md', `${docsRoot}\n${KNOWLEDGE_HEADING}\n\n${steps}`)).toEqual([]);
    expect(collectKnowledgeRootDefects('implement.md', `${KNOWLEDGE_HEADING}\n\n${steps}`)).toEqual([`implement.md: ${noDocsRoot}`]);
    expect(collectKnowledgeRootDefects('implement.md', `${KNOWLEDGE_HEADING}\n\n${steps}\n### Next\n\n${docsRoot}`)).toEqual([`implement.md: ${noDocsRoot}`]);
    expect(collectKnowledgeRootDefects('implement.md', `${docsRoot}\n${KNOWLEDGE_HEADING}\n\n${block}\n\n${steps}`)).toEqual([`implement.md: ${repeated}`]);
    expect(collectKnowledgeRootDefects('implement.md', `${KNOWLEDGE_HEADING}\n\n${block}\n\n${steps}`)).toEqual([`implement.md: ${repeated}`, `implement.md: ${noDocsRoot}`]);
    // A docs root that runs another command does not resolve the root.
    const otherRoot = docsRoot.replace(ROOT_COMMAND, 'git -C "{start}" rev-parse --git-dir');
    expect(collectKnowledgeRootDefects('implement.md', `${otherRoot}\n${KNOWLEDGE_HEADING}\n\n${steps}`)).toEqual([`implement.md: ${noDocsRoot}`]);
  });

  it('every compiled docs root resolves the checkout toplevel, from a root, a subdirectory and a worktree', () => {
    const hosts = knowledgeHosts(DOCS_ROOT_LEAD);
    // Non-vacuity: the seven docs-writing commands carry it.
    expect(hosts.length).toBeGreaterThanOrEqual(7);
    for (const file of hosts) {
      const section = sectionOf(requireDistFile(file), DOCS_ROOT_LEAD);
      expect(collectRootCommand(section), `${file}: the docs-root command`).toBe(ROOT_COMMAND);
      expect(section, `${file}: outside git the start directory stands`).toContain(FALLBACK_SENTENCE);
      expect(section, `${file}: a repo-relative path travels with its checkout`)
        .toContain('A repo-relative docs path handed to an agent travels with a `WORKTREE_PATH` naming its checkout.');
    }
    const command = collectRootCommand(sectionOf(requireDistFile(hosts[0]), DOCS_ROOT_LEAD));
    // Docs artifacts are per checkout, like knowledge bases: a worktree writes its OWN.
    for (const [label, start, expected] of [['root', main, main], ['subdir', sub, main], ['worktree', wt, wt]] as const) {
      expect(rootsFrom(runFromStart(command as string, start, env), start).worktree, label).toBe(expected);
    }
    expect(rootsFrom(runFromStart(command as string, outside, env), outside).worktree).toBe(outside);
  });

  it('the dynamic commands locate the main ledger by the same rule before authoring', () => {
    const hosts = knowledgeHosts(AUTHORING_DECISIONS_HEADING)
    // Non-vacuity: every command that expands authoring_decisions, once each.
    expect(hosts.sort()).toEqual(['dynamic-build.md', 'dynamic-plan.md', 'dynamic-profile.md', 'dynamic-tickets.md'])
    for (const file of hosts) {
      const section = sectionOf(requireDistFile(file), AUTHORING_DECISIONS_HEADING)
      expect(collectRootCommand(section), `${file}: the resolution command`).toBe(ROOT_COMMAND)
      expect(section, `${file}: the index path`).toContain('`{ledger}/.devflow/curation/index.md`')
      expect(section, `${file}: the retired checkout-relative read`).not.toContain('for the current worktree')
      expect(section, `${file}: the repository owns the ledger`).toContain("a linked worktree reads the main worktree's copy")
    }
    const command = collectRootCommand(sectionOf(requireDistFile(hosts[0]), AUTHORING_DECISIONS_HEADING))
    expect(rootsFrom(runFromStart(command as string, wt, env), wt).ledger).toBe(main)
  })

  it('release.md expands the decisions locate rule behind the curation gate and reads the index from the ledger it names', () => {
    // release.mds imports the two defines, so the compiled section is the define bodies.
    const partial = fs.readFileSync(path.join(PARTIALS_DIR, '_decisions.mds'), 'utf-8')
    const locateSentence = /^@define decisions_locate\(\):\n(.*)\n/m.exec(partial)?.[1] ?? ''
    expect(locateSentence, 'the locate define opens with the ownership sentence').toContain('The decisions ledger belongs to the repository')
    const gate = /^@define decisions_gate\(\):\n([\s\S]*?)\n@end$/m.exec(partial)?.[1] ?? ''
    expect(gate, 'the gate define body').toContain('`CURATION=off`')
    const release = sectionOf(requireDistFile('release.md'), RELEASE_CONTEXT_HEADING)
    expect(release).toContain(locateSentence)
    expect(release.indexOf(gate), 'the gate sentence comes first').toBeGreaterThan(-1)
    expect(release.indexOf(gate), 'the gate precedes the locate step').toBeLessThan(release.indexOf(locateSentence))
    expect(release.indexOf(locateSentence), 'the locate step precedes the index read')
      .toBeLessThan(release.indexOf('Read `{ledger}/.devflow/curation/index.md`.'))
    expect(collectRootCommand(release.slice(release.indexOf(locateSentence)))).toBe(ROOT_COMMAND)
    expect(rootsFrom(runFromStart(ROOT_COMMAND, wt, env), wt).ledger).toBe(main)
  })

  it('release.mds copies none of the locate text: it expands the define', () => {
    const source = fs.readFileSync(path.join(SOURCE_DIR, 'commands', 'release.mds'), 'utf-8')
    expect(source).toContain('{{decisions_locate()}}')
    expect(source).not.toContain('The decisions ledger belongs to the repository')
    expect(source).not.toContain('resolve-root.cjs')
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
    // acceptance rule, handed no answer, reproduces that reading — and it lands
    // on neither the main ledger nor the toplevel.
    expect(rootsFrom('', sub).ledger).not.toBe(main);
    expect(rootsFrom('', wt).ledger).not.toBe(main);
    expect(rootsFrom('', sub).worktree).not.toBe(main);
  });

  it('known-bad probes: any answer but the three accepted lines makes both roots the start directory', () => {
    const answer = `WORKTREE=${main}\nLEDGER=${main}\nexit=0`;
    expect(rootsFrom(answer, sub)).toEqual({ worktree: main, ledger: main });
    for (const bad of [
      `WORKTREE=${main}\nLEDGER=${main}\nexit=4`,
      `WORKTREE=${main}\nexit=0`,
      `WORKTREE=${main}\nLEDGER=${main}\nextra\nexit=0`,
      `WORKTREE=main\nLEDGER=${main}\nexit=0`,
      `LEDGER=${main}\nWORKTREE=${main}\nexit=0`,
      'node: command not found\nexit=127',
    ]) {
      expect(rootsFrom(bad, sub), bad).toEqual({ worktree: sub, ledger: sub });
    }
  });
});

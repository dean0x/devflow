import { promises as fs, writeFileSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as p from '@clack/prompts';
import { getManagedSettingsPath } from './claude-paths.js';
import { writeSettingsFileAtomic } from '../../core/fs-atomic.js';
import type { SecurityMode } from '../../core/manifest.js';

/**
 * Type guard for Node.js system errors with error codes.
 */
interface NodeSystemError extends Error {
  code: string;
}

function isNodeSystemError(error: unknown): error is NodeSystemError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as NodeSystemError).code === 'string'
  );
}

/**
 * Replace ${DEVFLOW_DIR} placeholders in a settings template.
 *
 * D-ONE-HOME: the settings template's install-time placeholder is the one
 * surviving spelling of that name. It is a template token substituted here with
 * the machine root (always ~/.devflow) — not an environment variable, and no
 * runtime reader resolves it (tests/guards/one-home.test.ts pins both sites).
 */
export function substituteSettingsTemplate(template: string, devflowDir: string): string {
  return template.replace(/\$\{DEVFLOW_DIR\}/g, devflowDir);
}

/**
 * Sentinel line whose presence means the current (v3-and-later) carve-out block is
 * installed. Devflow-unique: no user writes `!.devflow/conventions.md` by hand.
 */
const DEVFLOW_GITIGNORE_SENTINEL_V3 = '!.devflow/conventions.md';

/** Sentinel line whose presence means the v2 carve-out block is installed (no conventions.md line). */
const DEVFLOW_GITIGNORE_SENTINEL_V2 = '!.devflow/features/*/KNOWLEDGE.md';

/**
 * The block's final line: ignore the devflow-managed `.claudeignore` file.
 * NOT a sentinel — users legitimately author this line themselves.
 */
const CLAUDEIGNORE_LINE = '.claudeignore';

/** A user's explicit un-ignore of `.claudeignore`; never overridden. */
const CLAUDEIGNORE_NEGATION = '!.claudeignore';

/**
 * Re-includes the retired evidence-policy file (D-GITIGNORE-V5,
 * D-POLICY-JSON-RETIRED). A COMPLETION line, never a presence sentinel: users may author it themselves, so its presence
 * proves nothing about the devflow block (avoids PF-059). It sits after `.devflow/*`
 * (which it overrides under last-match-wins) and before `.claudeignore`, so the
 * block's final line stays `.claudeignore`.
 */
const DEVFLOW_POLICY_LINE = '!.devflow/policy.json';

/**
 * Re-includes the team-committed project settings file (D-GITIGNORE-V6). The same
 * contract as the policy line: a COMPLETION line, never a presence sentinel — a
 * user may author it before devflow ever runs, so its presence proves nothing about
 * the block (avoids PF-059). It sits after the policy line and before `.claudeignore`,
 * so a v5 block, which ends in `.claudeignore`, gains it just before that line
 * (D-GITIGNORE-IN-BLOCK, computeDevflowGitignore). Without it
 * `.devflow/*` ignores `.devflow/project.json`, and a team could only commit it with
 * `git add -f`. Devflow never writes the file itself (ADR-024).
 */
const DEVFLOW_PROJECT_LINE = '!.devflow/project.json';

/**
 * The shared .devflow/ gitignore block. Everything under .devflow/ is local
 * (memory, learning, docs, locks) EXCEPT:
 * - Feature knowledge bases: index.md and every {slug}/KNOWLEDGE.md are tracked
 *   + committed (the Knowledge agent commits them at workflow end).
 * - conventions.md: naming-convention authority written by the Git learn-conventions
 *   operation; GIT-TRACKED so the team shares a single naming source.
 * - policy.json: the retired evidence-policy file. resolve-evidence-policy.cjs never
 *   parses it, but where project.json has no `evidence` its presence holds the
 *   repository at `required` (D-POLICY-JSON-RETIRED); GIT-TRACKED so a team's
 *   committed copy stays shared until its value moves into project.json. Devflow
 *   never writes it.
 * - project.json: the team-committed settings (evidence, compliance, tracker, review
 *   publication, narrow-only feature switches) both resolvers read; GIT-TRACKED for
 *   the same reason (D-GITIGNORE-V6). Devflow never writes it.
 *
 * Re-including files under an ignored tree needs a `dir/*` + `!dir/keep` pair at
 * each level — a bare `.devflow/` excludes the directory so git never descends and
 * later negations are dead.
 *
 * Kept BYTE-IDENTICAL to the block emitted by src/assets/scripts/hooks/ensure-root-gitignore
 * so the init-time path and the always-on hook path produce the same file.
 */
const DEVFLOW_GITIGNORE_BLOCK_LINES = [
  '# Devflow runtime data — local by default (memory, learning, docs, locks).',
  '# Shared via git: feature knowledge bases under .devflow/features/ (index.md and',
  '# every {slug}/KNOWLEDGE.md), .devflow/conventions.md (naming authority),',
  '# .devflow/policy.json (retired; presence only) and .devflow/project.json (team settings).',
  '# To stop sharing the first two, re-add `.devflow/features/` or',
  '# `.devflow/conventions.md` to your own .gitignore.',
  '.devflow/*',
  '!.devflow/features/',
  '.devflow/features/*',
  '!.devflow/features/index.md',
  '!.devflow/features/*/',
  '.devflow/features/*/*',
  DEVFLOW_GITIGNORE_SENTINEL_V2,
  DEVFLOW_GITIGNORE_SENTINEL_V3,
  DEVFLOW_POLICY_LINE,
  DEVFLOW_PROJECT_LINE,
  CLAUDEIGNORE_LINE,
];

/** The full carve-out block, `.claudeignore` line included. */
export const DEVFLOW_GITIGNORE_BLOCK = DEVFLOW_GITIGNORE_BLOCK_LINES.join('\n');

/**
 * The entries directly under a repository's `.devflow/` that the team shares
 * through git (a trailing `/` marks a directory): the feature knowledge bases,
 * the naming conventions, the retired evidence-policy file and the committed
 * project settings.
 *
 * D-UNINSTALL-CARVE-OUT: uninstall's project-data step never deletes these — a
 * confirmed removal takes everything else under `.devflow/` and keeps them
 * byte-identical, because an uncommitted edit to a tracked file is not
 * recoverable from git. Kept next to the gitignore block it mirrors: every path
 * the block re-includes must appear here (pinned by tests/uninstall-logic.test.ts).
 */
export const DEVFLOW_TRACKED_PATHS: readonly string[] = Object.freeze([
  'features/',
  'conventions.md',
  'policy.json',
  'project.json',
]);

/**
 * The carve-out block without its final `.claudeignore` line — emitted instead of
 * the full block when the target .gitignore already carries a `.claudeignore` or
 * `!.claudeignore` entry of the user's own.
 */
export const DEVFLOW_GITIGNORE_BLOCK_WITHOUT_CLAUDEIGNORE =
  DEVFLOW_GITIGNORE_BLOCK_LINES.slice(0, -1).join('\n');

/** The legacy wholesale comment our pre-carve-out writers emitted. */
const LEGACY_DEVFLOW_COMMENT = '# Devflow runtime data (local by default; remove to share via git)';

/**
 * The most lines a top-up run extends below its anchor — one per line the run may
 * hold (the sentinel, the policy line, the project line). The shell twin's loop has
 * the same bound.
 */
const BLOCK_RUN_MAX = 3;

/**
 * PURE: given existing .gitignore content, return the content that ignores
 * `.devflow/` with the feature-knowledge + conventions.md + policy.json + project.json
 * carve-out — or `null` when no change is needed. Idempotent: feeding its own output
 * back returns `null`.
 *
 * D-GITIGNORE-V5 / D-GITIGNORE-V6: the block is detected ONLY by its own
 * devflow-unique sentinel (`!.devflow/conventions.md`). `.claudeignore`,
 * `!.devflow/policy.json` and `!.devflow/project.json` are COMPLETION lines — users
 * legitimately author all three themselves — so each is topped up when missing and
 * never read as proof the block exists. A presence check on a
 * user-authored line inverts both halves of the contract: projects that already carry
 * that line are told the block is installed when it is not, and a user's
 * `!.claudeignore` un-ignore is silently reversed by re-appending `.claudeignore`
 * under last-match-wins (avoids PF-059).
 *
 * `hasClaudeignoreEntry` is true when some whole line, trimmed, is exactly
 * `.claudeignore` OR `!.claudeignore`. Treating both forms as "present" both honours
 * an un-ignore and makes every branch converge on re-run. `hasPolicyLine` and
 * `hasProjectLine` are true when some whole line, trimmed, is exactly
 * `!.devflow/policy.json` / `!.devflow/project.json`. The missing completion lines, in
 * block order, are [policy line, project line, `.claudeignore` (only when
 * `!hasClaudeignoreEntry`)].
 *
 * 1. A `/.devflow/` line present → `null` (user opt-out; respect manual config).
 * 2. v3 sentinel present → insert the missing completion lines into the block;
 *    `null` when none are missing. This is the v4→v6 and v5→v6 upgrade: a v5 block
 *    gains only the project line, just before its `.claudeignore` line, and a v4
 *    block the policy and project lines, each keeping its old comment.
 * 3. v2 sentinel present, no v3 → insert `!.devflow/conventions.md` followed by the
 *    missing completion lines right after the v2 sentinel.
 * 4. Legacy bare `.devflow/` present → strip it (+ our old comment), then append the
 *    block; no block at all → append the block. The block is emitted MINUS its final
 *    `.claudeignore` line when `hasClaudeignoreEntry`. A user's own policy or project
 *    line is duplicated harmlessly here, and the re-run is a no-op.
 * 5. No completion line is ever a sentinel. The marker file
 *    (`.devflow/.root-gitignore-configured-v6`) is a fast-path claim, never proof.
 *
 * D-GITIGNORE-IN-BLOCK: lines topped up into an existing block (2 and 3) go INSIDE
 * it, where a fresh block holds them — never at the end of the file. gitignore is
 * last-match-wins, so a `!.devflow/project.json` appended after a user's own later
 * `.devflow/project.json` would silently override their re-ignore. The missing
 * lines are inserted as one run, in block order, after the first sentinel line and
 * the lines right after it that a fresh block places before the first missing line
 * (blockRunBefore; at most three). Every other byte of the file is kept.
 *
 * Line matching is whole-line, whitespace-tolerant, exact text — never substring.
 * The insert and the append form are mirrored byte-for-byte in the shell twin
 * (src/assets/scripts/hooks/ensure-root-gitignore), which is what the cross-implementation
 * parity table in tests/shell-hooks.test.ts pins.
 */
export function computeDevflowGitignore(existingContent: string): string | null {
  const lines = existingContent.split('\n');
  const trimmed = lines.map(l => l.trim());

  const hasClaudeignoreEntry = trimmed.some(
    l => l === CLAUDEIGNORE_LINE || l === CLAUDEIGNORE_NEGATION,
  );
  const hasPolicyLine = trimmed.includes(DEVFLOW_POLICY_LINE);
  const hasProjectLine = trimmed.includes(DEVFLOW_PROJECT_LINE);

  /** The block-completing lines this file lacks, in block order. */
  const missingCompletionLines: readonly string[] = [
    ...(hasPolicyLine ? [] : [DEVFLOW_POLICY_LINE]),
    ...(hasProjectLine ? [] : [DEVFLOW_PROJECT_LINE]),
    ...(hasClaudeignoreEntry ? [] : [CLAUDEIGNORE_LINE]),
  ];

  /**
   * The block lines a top-up run follows: the v3 sentinel, then whichever of the
   * policy and project lines a fresh block places before the first missing line.
   * Mirrors `_ERG_RUN_RE` in the shell twin.
   */
  const blockRunBefore: readonly string[] = !hasPolicyLine
    ? [DEVFLOW_GITIGNORE_SENTINEL_V3]
    : !hasProjectLine
      ? [DEVFLOW_GITIGNORE_SENTINEL_V3, DEVFLOW_POLICY_LINE]
      : [DEVFLOW_GITIGNORE_SENTINEL_V3, DEVFLOW_POLICY_LINE, DEVFLOW_PROJECT_LINE];

  /**
   * Insert `inserted` into an existing devflow block: after the first line whose
   * trimmed text is `anchor`, and after up to BLOCK_RUN_MAX lines right below it
   * whose trimmed text is in `run`. Every other byte is kept. A run that ends on a
   * last line with no newline gets one first, so the inserted lines never fuse onto
   * it. Mirrors `_erg_insert_in_block` in the shell twin (D-GITIGNORE-IN-BLOCK).
   */
  const insertInBlock = (anchor: string, run: readonly string[], inserted: readonly string[]): string => {
    let end = trimmed.indexOf(anchor);
    for (let k = 0; k < BLOCK_RUN_MAX && end + 1 < lines.length && run.includes(trimmed[end + 1]); k++) {
      end++;
    }
    if (end === lines.length - 1) return `${existingContent}\n${inserted.join('\n')}\n`;
    return [...lines.slice(0, end + 1), ...inserted, ...lines.slice(end + 1)].join('\n');
  };

  /**
   * Start a new block after unrelated content: one blank separator line. Existing
   * trailing newlines are preserved verbatim (no trimEnd, no blank-line dedupe) so
   * the shell twin's `tail -c 1` guard produces the identical bytes.
   */
  const appendBlock = (body: string, block: string): string =>
    body.length === 0
      ? `${block}\n`
      : `${body}${body.endsWith('\n') ? '' : '\n'}\n${block}\n`;

  // 1. User opt-out wins over every sentinel.
  if (trimmed.includes('/.devflow/')) return null;

  // 2. Block installed (v3 and later) — top up only the completion lines it lacks.
  if (trimmed.includes(DEVFLOW_GITIGNORE_SENTINEL_V3)) {
    return missingCompletionLines.length === 0
      ? null
      : insertInBlock(DEVFLOW_GITIGNORE_SENTINEL_V3, blockRunBefore, missingCompletionLines);
  }

  // 3. v2 block installed — insert the lines it lacks, in block order, right after
  //    its sentinel, the last carve-out line it has.
  if (trimmed.includes(DEVFLOW_GITIGNORE_SENTINEL_V2)) {
    return insertInBlock(
      DEVFLOW_GITIGNORE_SENTINEL_V2,
      [],
      [DEVFLOW_GITIGNORE_SENTINEL_V3, ...missingCompletionLines],
    );
  }

  // 4. No devflow block — install one, respecting any .claudeignore entry of the user's own.
  const block = hasClaudeignoreEntry
    ? DEVFLOW_GITIGNORE_BLOCK_WITHOUT_CLAUDEIGNORE
    : DEVFLOW_GITIGNORE_BLOCK;

  if (trimmed.includes('.devflow/')) {
    // Upgrade our legacy wholesale entry: drop the bare line + old comment, append block.
    const kept = lines
      .filter(l => l.trim() !== '.devflow/' && l.trim() !== LEGACY_DEVFLOW_COMMENT)
      .join('\n');
    return appendBlock(kept, block);
  }

  return appendBlock(existingContent, block);
}

/**
 * Merge Devflow deny entries into an existing settings JSON object.
 * Preserves existing entries (including allow and sibling keys) except those named
 * in `retired`, deduplicates, and returns the merged JSON string with trailing newline.
 *
 * `retired` is how an install converges an older one: pass retiredDenyEntries(template)
 * so entries Devflow once shipped and has since dropped do not linger. An entry that
 * `newDenyEntries` carries is never dropped, whatever `retired` says.
 *
 * PURE + idempotent: calling with the same inputs always yields byte-equal output.
 * Non-array `deny` (e.g. a string, null) is treated as empty — neither throws nor spreads chars.
 *
 * @throws {SyntaxError} on malformed JSON — callers must pre-validate (e.g. via detectDenyState)
 *   or wrap in try/catch.
 */
export function mergeDenyList(
  existingJson: string,
  newDenyEntries: string[],
  retired: ReadonlySet<string> = new Set(),
): string {
  const existing = JSON.parse(existingJson) as Record<string, unknown>;
  const rawDeny = (existing.permissions as Record<string, unknown> | undefined)?.deny;
  const currentDeny: string[] = Array.isArray(rawDeny) ? rawDeny as string[] : [];
  const kept = currentDeny.filter(e => !retired.has(e));
  const merged = [...new Set([...kept, ...newDenyEntries])];
  existing.permissions = { ...(existing.permissions as Record<string, unknown> ?? {}), deny: merged };
  return JSON.stringify(existing, null, 2) + '\n';
}

/**
 * Historical superset of every deny entry Devflow has ever shipped.
 * Append every future entry here; never remove entries — a retired template entry
 * stays here so removal (stripUserDenyList, removeManagedSettings) and install
 * convergence (retiredDenyEntries) still recognise it in an older install.
 *
 * Load-time assertion below verifies this is a superset of the current template.
 */
// D-SECURITY-01: frozen at module load — any future template entry must appear here too.
// D-SECURITY-02 (#399): the nine v1 piped rules (`Bash(curl * | bash*)` and kin) are
// RETIRED — kept here, dropped from the template. Claude Code splits a Bash command at
// `|` (and `&&`, `||`, `;`, `|&`, `&`, newlines) and matches every rule against each
// subcommand alone, so a rule holding ` | ` can never match anything. The exact
// shell-on-stdin denies in the v2 batch (`Bash(bash)`, `Bash(sh -s *)`, ...) match the
// shell subcommand of such a pipeline instead.
// Only entries a release actually shipped belong here: removal and install convergence
// strip every entry this set names that the template does not, so a rule Devflow never
// shipped would be taken from a user who wrote it (ADR-024, prove-you-wrote-it).
export const DEVFLOW_HISTORICAL_DENY: ReadonlySet<string> = Object.freeze(new Set<string>([
  // v1 batch — 154 entries shipped in src/targets/claude-code/templates/managed-settings.json
  'Bash(rm -rf /*)',
  'Bash(rm -rf ~*)',
  'Bash(rm -rf .*)',
  'Bash(* rm -rf /*)',
  'Bash(rm -r /*)',
  'Bash(rm -r ~*)',
  'Bash(rm -r .*)',
  'Bash(rm -fr /*)',
  'Bash(rm -fr ~*)',
  'Bash(rm -fr .*)',
  'Bash(rm -f /*)',
  'Bash(rm -f ~*)',
  'Bash(rm -f .*)',
  'Bash(dd if=*)',
  'Bash(dd*of=/dev/*)',
  'Bash(mkfs*)',
  'Bash(fdisk*)',
  'Bash(parted*)',
  'Bash(shred*)',
  'Bash(> /dev/sda*)',
  'Bash(> /dev/nvme*)',
  'Bash(sh -c *)',
  'Bash(bash -c *)',
  'Bash(curl * | bash*)',
  'Bash(curl * | sh*)',
  'Bash(wget * | bash*)',
  'Bash(wget * | sh*)',
  'Bash(fetch | sh*)',
  'Bash(lynx -source | bash*)',
  'Bash(base64 -d | bash*)',
  'Bash(base64 -d | sh*)',
  'Bash(base64 --decode | bash*)',
  'Bash(eval *)',
  'Bash(exec *)',
  'Bash(sudo *)',
  'Bash(su *)',
  'Bash(doas *)',
  'Bash(pkexec *)',
  'Bash(passwd*)',
  'Bash(useradd*)',
  'Bash(userdel*)',
  'Bash(usermod*)',
  'Bash(groupadd*)',
  'Bash(chmod*777*)',
  'Bash(chmod*666*)',
  'Bash(chmod -R 666*)',
  'Bash(chmod a+w*)',
  'Bash(chown*root*)',
  'Bash(chgrp*root*)',
  'Bash(kill -9 *)',
  'Bash(kill -KILL *)',
  'Bash(killall *)',
  'Bash(pkill -9 *)',
  'Bash(pkill *)',
  'Bash(xkill*)',
  'Bash(reboot*)',
  'Bash(shutdown*)',
  'Bash(halt*)',
  'Bash(poweroff*)',
  'Bash(init 0*)',
  'Bash(init 6*)',
  'Bash(systemctl*stop*)',
  'Bash(systemctl*disable*)',
  'Bash(systemctl*mask*)',
  'Bash(service*stop*)',
  'Bash(nc -l*)',
  'Bash(nc -e*)',
  'Bash(netcat -l*)',
  'Bash(ncat -l*)',
  'Bash(socat*)',
  'Bash(telnet*)',
  'Bash(python -c *)',
  'Bash(python3 -c *)',
  'Bash(php -r *)',
  'Bash(perl -e *)',
  'Bash(ruby -rsocket*)',
  'Bash(nmap*)',
  'Bash(masscan*)',
  'Bash(ufw disable*)',
  'Bash(iptables -F*)',
  'Bash(iptables --flush*)',
  'Bash(insmod*)',
  'Bash(rmmod*)',
  'Bash(modprobe*)',
  'Bash(sysctl -w *)',
  'Bash(docker run --privileged*)',
  'Bash(docker run -v /:/host*)',
  'Bash(docker run --pid=host*)',
  'Bash(docker run --net=host*)',
  'Bash(nsenter*)',
  'Bash(crontab*)',
  'Bash(rm /var/log*)',
  'Bash(rm -rf /var/log*)',
  'Bash(rm -r /var/log*)',
  'Bash(rm -f /var/log*)',
  'Bash(rm -fr /var/log*)',
  'Bash(> /var/log*)',
  'Bash(truncate /var/log*)',
  'Bash(history -c*)',
  'Bash(history -w*)',
  'Bash(rm ~/.bash_history*)',
  'Bash(rm -f ~/.bash_history*)',
  'Bash(rm ~/.zsh_history*)',
  'Bash(rm -f ~/.zsh_history*)',
  'Bash(unset HISTFILE*)',
  'Bash(curl 169.254.169.254*)',
  'Bash(wget 169.254.169.254*)',
  'Bash(rsync --daemon*)',
  'Bash(sftp *)',
  'Bash(ssh -o *)',
  'Bash(xmrig*)',
  'Bash(cgminer*)',
  'Bash(bfgminer*)',
  'Bash(ethminer*)',
  'Bash(minerd*)',
  'Bash(npm install -g *)',
  'Bash(npm i -g *)',
  'Bash(pip install --system*)',
  'Bash(pip3 install --system*)',
  'Bash(apt*install*)',
  'Bash(yum*install*)',
  'Bash(brew*install*)',
  'Bash(mount *)',
  'Bash(umount *)',
  'Bash(> /etc/*)',
  'Bash(> /usr/*)',
  'Bash(> /bin/*)',
  'Bash(> /sys/*)',
  'Bash(> /proc/*)',
  'Read(.env)',
  'Read(.env.*)',
  'Read(**/.env)',
  'Read(**/.env.*)',
  'Read(**/secrets/**)',
  'Read(**/credentials/**)',
  'Read(~/.ssh/id_*)',
  'Read(~/.ssh/*.pem)',
  'Read(~/.ssh/config)',
  'Read(~/.aws/credentials)',
  'Read(~/.aws/config)',
  'Read(~/.config/gcloud/**)',
  'Read(**/*.pem)',
  'Read(**/*.key)',
  'Read(**/*.pfx)',
  'Read(**/*.p12)',
  'Read(**/private.key)',
  'Read(**/privkey.pem)',
  'Read(**/id_rsa)',
  'Read(**/id_ed25519)',
  'Read(**/id_ecdsa)',
  'Read(**/id_dsa)',
  'Read(/etc/shadow)',
  'Read(/etc/sudoers)',
  'Read(/etc/passwd)',
  // v2 batch (#399) — 25 template entries: a shell reading its script from stdin,
  // `zsh -c` beside the v1 `sh -c`/`bash -c`, OrbStack VM control, docker
  // pull/delete/prune and whole-disk or privileged runs.
  'Bash(bash)',
  'Bash(sh)',
  'Bash(zsh)',
  'Bash(bash - *)',
  'Bash(sh - *)',
  'Bash(zsh - *)',
  'Bash(bash -s *)',
  'Bash(sh -s *)',
  'Bash(zsh -s *)',
  'Bash(zsh -c *)',
  'Bash(docker run*--privileged*)',
  'Bash(docker run*-v /:*)',
  'Bash(docker run*--volume /:*)',
  'Bash(docker run*--volume=/:*)',
  'Bash(docker pull *)',
  'Bash(docker image pull *)',
  'Bash(docker rm *)',
  'Bash(docker container rm *)',
  'Bash(docker rmi *)',
  'Bash(docker image rm *)',
  'Bash(docker volume rm *)',
  'Bash(docker*prune*)',
  'Bash(orb *)',
  'Bash(orbctl *)',
  'Bash(open *OrbStack*)',
]));

/**
 * The Devflow deny entries an older install may carry that the current template no
 * longer ships: DEVFLOW_HISTORICAL_DENY minus the template. PURE.
 *
 * An empty template (loadTemplateDenyEntries' failure value) retires nothing — an
 * unreadable template must never read as "Devflow dropped every entry it ever shipped".
 *
 * Accepted trade-off (ADR-024): a deny entry is a bare string, so a user who typed a
 * retired entry themselves is indistinguishable from Devflow's copy and loses it on the
 * next install, exactly as `security --disable` and uninstall already strip every
 * historical entry. Retire an entry only when losing a user's identical copy is
 * harmless; the #399 piped rules qualify because none could ever match (D-SECURITY-02).
 */
export function retiredDenyEntries(templateEntries: readonly string[]): ReadonlySet<string> {
  if (templateEntries.length === 0) return new Set();
  const current = new Set(templateEntries);
  return new Set([...DEVFLOW_HISTORICAL_DENY].filter(e => !current.has(e)));
}

/**
 * Assert that DEVFLOW_HISTORICAL_DENY is a superset of the provided template entries.
 * Throws if any template entry is missing from the historical set.
 * Call this after loading the template to catch drift where a new template entry
 * was not also added to DEVFLOW_HISTORICAL_DENY.
 *
 * @param templateEntries - the deny array from the current managed-settings template
 */
export function assertHistoricalDenySuperset(templateEntries: string[]): void {
  const missing = templateEntries.filter(e => !DEVFLOW_HISTORICAL_DENY.has(e));
  if (missing.length > 0) {
    throw new Error(
      `DEVFLOW_HISTORICAL_DENY is missing ${missing.length} template entries. ` +
      `Add these to DEVFLOW_HISTORICAL_DENY in post-install.ts:\n${missing.join('\n')}`,
    );
  }
}

/**
 * Strip Devflow-managed deny entries from a user settings JSON string.
 * PURE + idempotent — mirror of removeMemoryHooks in shape.
 *
 * - Parses the JSON; if permissions.deny is absent or not an array → returns input unchanged.
 * - Removes entries that are in historicalSet; preserves user-only entries.
 * - When remaining is empty: deletes permissions.deny; if permissions then has no keys, deletes permissions.
 * - Never deletes the file — may return `{}\n`.
 * - Preserves allow and all sibling keys.
 * - Returns { json, removed[] } where removed is the list of entries actually stripped.
 *
 * @throws {SyntaxError} on malformed JSON — callers must pre-validate (e.g. via detectDenyState)
 *   or wrap in try/catch.
 */
export function stripUserDenyList(
  existingJson: string,
  historicalSet: ReadonlySet<string>,
): { json: string; removed: string[] } {
  const obj = JSON.parse(existingJson) as Record<string, unknown>;
  const perms = obj.permissions as Record<string, unknown> | undefined;
  if (!perms) return { json: existingJson, removed: [] };

  const rawDeny = perms.deny;
  if (!Array.isArray(rawDeny)) return { json: existingJson, removed: [] };

  const currentDeny = rawDeny as string[];
  const removed = currentDeny.filter(e => historicalSet.has(e));
  const remaining = currentDeny.filter(e => !historicalSet.has(e));

  if (remaining.length === 0) {
    delete perms.deny;
    if (Object.keys(perms).length === 0) {
      delete obj.permissions;
    }
  } else {
    perms.deny = remaining;
  }

  return {
    json: JSON.stringify(obj, null, 2) + '\n',
    removed,
  };
}

/**
 * Detect where the Devflow deny list currently lives.
 *
 * - user: ANY historical-set entry in user settings permissions.deny → true (subset installs count).
 * - managed: managedExists AND ANY historical entry in managed content's deny → true.
 * - unknown: user settings is present but unparseable → true (caller skips strip).
 *
 * Guards getManagedSettingsPath() — may throw on unsupported platforms; caught → managed absent.
 */
export function detectDenyState(
  userSettingsJson: string | null,
  managedExists: boolean,
  managedContentJson: string | null,
): { user: boolean; managed: boolean; unknown: boolean } {
  let user = false;
  let unknown = false;
  let managed = false;

  if (userSettingsJson !== null) {
    try {
      const obj = JSON.parse(userSettingsJson) as Record<string, unknown>;
      const rawDeny = (obj.permissions as Record<string, unknown> | undefined)?.deny;
      if (Array.isArray(rawDeny)) {
        user = (rawDeny as string[]).some(e => DEVFLOW_HISTORICAL_DENY.has(e));
      }
    } catch {
      unknown = true;
    }
  }

  if (managedExists && managedContentJson !== null) {
    try {
      const obj = JSON.parse(managedContentJson) as Record<string, unknown>;
      const rawDeny = (obj.permissions as Record<string, unknown> | undefined)?.deny;
      if (Array.isArray(rawDeny)) {
        managed = (rawDeny as string[]).some(e => DEVFLOW_HISTORICAL_DENY.has(e));
      }
    } catch {
      // Unparseable managed file — treat as not present
    }
  }

  return { user, managed, unknown };
}

/** Internal 4-way classification of what detectDenyState found on disk. */
type DetectedMode = 'user' | 'managed' | 'both' | 'none';

/**
 * Collapse a DetectedMode to the canonical SecurityMode target to keep.
 * 'both' and 'user' prefer user-settings (user-settings-first convention).
 * Called from the three distinct collapse sites in resolveSecurityAction.
 */
function keepTargetFor(m: DetectedMode): SecurityMode {
  return m === 'managed' ? 'managed' : m === 'none' ? 'none' : 'user';
}

/**
 * Derive DetectedMode from the raw boolean flags returned by detectDenyState.
 * Extracted so the 4-way ternary is named and reusable (pairs with keepTargetFor).
 */
function classifyDetected(detected: { user: boolean; managed: boolean; unknown: boolean }): DetectedMode {
  return detected.user && detected.managed ? 'both'
    : detected.user ? 'user'
    : detected.managed ? 'managed'
    : 'none';
}

/**
 * Describe the action required for the security deny list.
 * PURE — no I/O, no prompting.
 *
 * Resolution order:
 * 1. Explicit `flag` always wins.
 * 2. Manifest field present AND matches detected reality → proceed (merge for enabled, strip for none/disabled).
 * 3. Manifest field disagrees with detected reality (CONFLICT):
 *    - TTY → return a prompt descriptor.
 *    - Non-TTY → keep detected reality + signal a warning.
 * 4. Fresh (no manifest field) → seed from detected state; default 'user' when nothing detected.
 */
export function resolveSecurityAction(
  flag: SecurityMode | undefined,
  manifestMode: SecurityMode | undefined,
  detected: { user: boolean; managed: boolean; unknown: boolean },
  isTTY: boolean,
): {
  target: SecurityMode;
  action: 'merge' | 'strip' | 'noop';
  prompt?: string;
  warn?: string;
} {
  // 1. Explicit CLI flag wins
  if (flag !== undefined) {
    if (flag === 'none') return { target: 'none', action: 'strip' };
    if (flag === 'user') return { target: 'user', action: 'merge' };
    if (flag === 'managed') return { target: 'managed', action: 'merge' };
    // Exhaustiveness guard — TypeScript ensures SecurityMode is exhausted above.
    const _exhaustive: never = flag;
    void _exhaustive;
  }

  const detectedMode = classifyDetected(detected);

  // 2. Manifest field present — check alignment with detected reality
  if (manifestMode !== undefined) {
    const manifestEnabled = manifestMode !== 'none';
    const detectedEnabled = detectedMode !== 'none';

    if (manifestEnabled && detectedEnabled) {
      // Both agree something is active — merge/upgrade with current template
      return { target: manifestMode === 'managed' ? 'managed' : 'user', action: 'merge' };
    }
    if (!manifestEnabled && !detectedEnabled) {
      // Both agree it's off — nothing to do
      return { target: 'none', action: 'noop' };
    }
    // CONFLICT: manifest disagrees with reality
    if (isTTY) {
      return {
        target: keepTargetFor(detectedMode),
        action: 'noop',
        prompt: `Security deny list is ${detectedEnabled ? 'present' : 'absent'} but manifest says ${manifestMode}. Keep current state?`,
      };
    }
    // Non-TTY: preserve detected reality + warn
    return {
      target: keepTargetFor(detectedMode),
      action: detectedEnabled ? 'merge' : 'strip',
      warn: `Security deny list state (manifest=${manifestMode}, detected=${detectedMode}) — keeping detected reality`,
    };
  }

  // 4. Fresh (no manifest field) — seed from detected state
  if (detectedMode === 'none') {
    // Nothing detected — apply user mode as default
    return { target: 'user', action: 'merge' };
  }
  // Something already installed — keep it, upgrade with current template
  // detectedMode !== 'none' here (handled above), so keepTargetFor yields 'user' | 'managed'.
  return { target: keepTargetFor(detectedMode), action: 'merge' };
}

/**
 * Load the deny entry array from the managed-settings.json template.
 * Canonical single-source helper used by installManagedSettings, init.ts's security
 * step, and security.ts's --enable path. Removal keys on DEVFLOW_HISTORICAL_DENY instead.
 *
 * Defensive read: treats file as `Record<string, unknown>`, guards with Array.isArray,
 * coerces each element to string. Returns [] on any read or parse failure (never throws).
 */
export function loadTemplateDenyEntries(rootDir: string): Promise<string[]> {
  const sourceManaged = path.join(rootDir, 'src', 'targets', 'claude-code', 'templates', 'managed-settings.json');
  return fs.readFile(sourceManaged, 'utf-8')
    .then((raw) => {
      const tmpl = JSON.parse(raw) as Record<string, unknown>;
      const rawDeny = (tmpl.permissions as Record<string, unknown> | undefined)?.deny;
      return Array.isArray(rawDeny) ? rawDeny.map(String) : [];
    })
    .catch(() => []);
}

/**
 * Attempt to install managed settings (security deny list) to the system path.
 * Managed settings have highest precedence in Claude Code and cannot be overridden.
 *
 * Strategy:
 * 1. Try direct write (works if running as root or directory is writable)
 * 2. If EACCES in TTY, retry with sudo (caller is responsible for obtaining consent)
 * 3. Returns true if managed settings were written, false if caller should fall back
 */
export async function installManagedSettings(
  rootDir: string,
  verbose: boolean,
): Promise<boolean> {
  let managedPath: string;
  try {
    managedPath = getManagedSettingsPath();
  } catch {
    return false; // Unsupported platform
  }

  const managedDir = path.dirname(managedPath);

  const newDenyEntries = await loadTemplateDenyEntries(rootDir);
  if (newDenyEntries.length === 0) {
    if (verbose) {
      p.log.warn('Could not read managed settings template');
    }
    return false;
  }

  // Build the content to write (merge with existing if present)
  let content: string;
  try {
    const existing = await fs.readFile(managedPath, 'utf-8');
    content = mergeDenyList(existing, newDenyEntries, retiredDenyEntries(newDenyEntries));
  } catch {
    // File doesn't exist — use template as-is
    content = JSON.stringify({ permissions: { deny: newDenyEntries } }, null, 2) + '\n';
  }

  // Attempt 1: direct write
  try {
    await fs.mkdir(managedDir, { recursive: true });
    await fs.writeFile(managedPath, content, 'utf-8');
    if (verbose) {
      p.log.success(`Managed settings written to ${managedPath}`);
    }
    return true;
  } catch (error: unknown) {
    if (!isNodeSystemError(error) || error.code !== 'EACCES') {
      if (verbose) {
        p.log.warn(`Could not write managed settings: ${error}`);
      }
      return false;
    }
  }

  // Attempt 2: sudo (TTY only — sudo needs terminal for password prompt)
  if (!process.stdin.isTTY) {
    return false;
  }

  try {
    execFileSync('sudo', ['mkdir', '-p', managedDir], { stdio: 'inherit' });
    // Stage the JSON in a file and copy it with sudo. Every sudo call takes an
    // argv (execFileSync, no shell), so no path is ever re-parsed by a shell — a
    // package root under a home directory holding a quote cannot break or extend
    // the root command.
    const tmpFile = path.join(rootDir, '.managed-settings-tmp.json');
    await fs.writeFile(tmpFile, content, 'utf-8');
    execFileSync('sudo', ['cp', tmpFile, managedPath], { stdio: 'inherit' });
    await fs.rm(tmpFile, { force: true });
    if (verbose) {
      p.log.success(`Managed settings written to ${managedPath} (via sudo)`);
    }
    return true;
  } catch (error) {
    if (verbose) {
      p.log.warn(`sudo write failed: ${error}`);
    }
    return false;
  }
}

/**
 * Remove Devflow deny entries from managed settings.
 * If only Devflow entries remain, deletes the file entirely.
 *
 * Mirrors installManagedSettings strategy:
 * 1. Try direct write/delete
 * 2. If EACCES and TTY, ask user before sudo
 * 3. Non-TTY: return false (caller logs preservation message)
 *
 * `managedPathOverride` exists so a test can point the removal at a temp file;
 * production callers omit it and get the platform's system path. It is a
 * parameter, deliberately not an environment variable: this function may run
 * `sudo rm` / `sudo cp` on the path, and an env-selectable target would let
 * whoever controls the environment aim a root write the user consented to for
 * "managed settings" at any file.
 */
export async function removeManagedSettings(
  rootDir: string,
  verbose: boolean,
  managedPathOverride?: string,
): Promise<boolean> {
  let managedPath: string;
  if (managedPathOverride !== undefined) {
    managedPath = managedPathOverride;
  } else {
    try {
      managedPath = getManagedSettingsPath();
    } catch {
      return false;
    }
  }

  let existingContent: string;
  try {
    existingContent = await fs.readFile(managedPath, 'utf-8');
  } catch {
    return false; // File doesn't exist
  }

  // Key on every entry Devflow has ever shipped, not the current template: an install
  // from an older release carries entries the template has since retired (D-SECURITY-02).
  const existing = JSON.parse(existingContent);
  const currentDeny: string[] = existing.permissions?.deny ?? [];
  const remaining = currentDeny.filter(entry => !DEVFLOW_HISTORICAL_DENY.has(entry));

  // Determine the target action: delete file entirely or write updated content
  let shouldDelete = false;
  let updatedContent: string | null = null;

  if (remaining.length === 0) {
    const otherKeys = Object.keys(existing).filter(k => k !== 'permissions');
    const hasOtherPermissions = existing.permissions &&
      Object.keys(existing.permissions).filter(k => k !== 'deny').length > 0;

    if (otherKeys.length === 0 && !hasOtherPermissions) {
      shouldDelete = true;
    } else {
      delete existing.permissions.deny;
      if (Object.keys(existing.permissions).length === 0) {
        delete existing.permissions;
      }
      updatedContent = JSON.stringify(existing, null, 2) + '\n';
    }
  } else {
    existing.permissions.deny = remaining;
    updatedContent = JSON.stringify(existing, null, 2) + '\n';
  }

  // Attempt 1: direct write/delete
  try {
    if (shouldDelete) {
      unlinkSync(managedPath);
    } else {
      writeFileSync(managedPath, updatedContent!, 'utf-8');
    }
    if (verbose) {
      p.log.success(shouldDelete ? 'Managed settings file removed' : 'Devflow deny entries removed from managed settings');
    }
    return true;
  } catch (error: unknown) {
    if (!isNodeSystemError(error) || error.code !== 'EACCES') {
      if (verbose) {
        p.log.warn(`Could not update managed settings: ${error}`);
      }
      return false;
    }
  }

  // Attempt 2: sudo (TTY only, with explicit consent)
  if (!process.stdin.isTTY) {
    return false;
  }

  const managedDir = path.dirname(managedPath);
  const confirmed = await p.confirm({
    message: `Managed settings cleanup requires admin access (${managedDir}). Use sudo?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    return false;
  }

  try {
    if (shouldDelete) {
      execFileSync('sudo', ['rm', managedPath], { stdio: 'inherit' });
    } else {
      const tmpFile = path.join(rootDir, '.managed-settings-tmp.json');
      await fs.writeFile(tmpFile, updatedContent!, 'utf-8');
      execFileSync('sudo', ['cp', tmpFile, managedPath], { stdio: 'inherit' });
      await fs.rm(tmpFile, { force: true });
    }
    if (verbose) {
      p.log.success(shouldDelete ? 'Managed settings file removed' : 'Devflow deny entries removed from managed settings');
    }
    return true;
  } catch (error) {
    if (verbose) {
      p.log.warn(`sudo cleanup failed: ${error}`);
    }
    return false;
  }
}

// Re-export canonical SecurityMode for callers that import from post-install.ts
// (canonical definition lives in manifest.ts — avoids re-declaration in 7 places).
export type { SecurityMode } from '../../core/manifest.js';

/**
 * Apply the Devflow deny list atomically to the user settings file (~/.claude/settings.json).
 * Called by init's dedicated security step when target mode is 'user' (or as a fallback when
 * the managed write fails).
 *
 * Merges currentTemplateDeny into the existing settings file. Idempotent.
 * Returns the merged JSON string written to disk.
 */
export async function applyUserSecurityDenyList(
  settingsPath: string,
  currentTemplateDeny: string[],
): Promise<string> {
  let existing: string;
  try {
    existing = await fs.readFile(settingsPath, 'utf-8');
  } catch {
    existing = '{}';
  }
  const merged = mergeDenyList(existing, currentTemplateDeny, retiredDenyEntries(currentTemplateDeny));
  await writeSettingsFileAtomic(settingsPath, merged);
  return merged;
}

/**
 * Strip Devflow deny entries from the user settings file (~/.claude/settings.json).
 * Colocated with applyUserSecurityDenyList — the remove-side counterpart.
 *
 * Sequence: read → stripUserDenyList → guard (stripped !== existing) →
 *   writeSettingsFileAtomic → return { removed }.
 * Atomic write (temp+rename) upholds the never-truncate-on-crash invariant.
 * ENOENT is swallowed (file absent = nothing to strip). Other errors propagate.
 *
 * @returns { removed: string[] } listing the stripped entries,
 *   or null when the file is absent (ENOENT) or nothing changed.
 *
 * Callers: init.ts (managed-write success and 'none' branches) and security.ts
 * (--enable --managed self-heal) use this instead of open-coding the sequence.
 */
export async function stripUserSecurityDenyList(
  settingsPath: string,
): Promise<{ removed: string[] } | null> {
  let existing: string;
  try {
    existing = await fs.readFile(settingsPath, 'utf-8');
  } catch (error: unknown) {
    if (isNodeSystemError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const { json: stripped, removed } = stripUserDenyList(existing, DEVFLOW_HISTORICAL_DENY);
  if (stripped === existing) {
    return null;
  }
  await writeSettingsFileAtomic(settingsPath, stripped);
  return { removed };
}

/** True for a non-null, non-array object literal. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every `command` string carried by a hook matcher, tolerating foreign shapes.
 * Returns an empty array for anything that is not `{ hooks: [{ command: string }] }`.
 */
function hookCommandsOf(matcher: unknown): string[] {
  if (!isPlainObject(matcher) || !Array.isArray(matcher.hooks)) return [];
  return matcher.hooks
    .filter(isPlainObject)
    .map((h) => h.command)
    .filter((c): c is string => typeof c === 'string');
}

/**
 * Merge Devflow's template hook entries and top-level fields into an existing
 * parsed settings object. Idempotent by exact command string — a hook that is
 * already present is skipped. Sets `statusLine` only when the user has no existing
 * value. Attribution is NOT injected here — managed by the flags pipeline (D27).
 * Mutates `existing` in place.
 *
 * D-SETTINGS-1: merge strategy — never replace; only add devflow entries that are absent.
 * Returns { changed: true } when any field was added.
 *
 * `existing` comes from a hand-editable file, so every branch is shape-guarded:
 * a `hooks` value (or per-event value) that is not the expected object/array shape
 * is left untouched rather than overwritten or thrown on (applies PF-023 — validate
 * at the sink that mutates).
 *
 * Exported for testing.
 */
export function mergeDevflowSettingsTemplate(
  existing: Record<string, unknown>,
  template: Record<string, unknown>,
): { changed: boolean } {
  let changed = false;

  // Merge hook entries — idempotent by exact command string
  const tmplHooks = isPlainObject(template.hooks) ? template.hooks : {};
  const existingHooksRaw = existing.hooks;
  if (existingHooksRaw === undefined || isPlainObject(existingHooksRaw)) {
    const existingHooks: Record<string, unknown> = existingHooksRaw ?? {};
    let hooksChanged = false;
    for (const [event, matchers] of Object.entries(tmplHooks)) {
      if (!Array.isArray(matchers)) continue;
      for (const matcher of matchers) {
        const cmd = hookCommandsOf(matcher)[0];
        if (!cmd) continue;
        const current = existingHooks[event];
        if (current !== undefined && !Array.isArray(current)) break; // foreign shape — leave the event alone
        const eventArr: unknown[] = current ?? [];
        if (eventArr.some((m) => hookCommandsOf(m).includes(cmd))) continue;
        eventArr.push(matcher);
        existingHooks[event] = eventArr;
        hooksChanged = true;
      }
    }
    // Attach only when something was actually added — never introduce an empty
    // `hooks` key into a settings.json that had none.
    if (hooksChanged) {
      existing.hooks = existingHooks;
      changed = true;
    }
  }

  // Set statusLine only if the user has none
  if (existing.statusLine === undefined && template.statusLine !== undefined) {
    existing.statusLine = template.statusLine;
    changed = true;
  }

  // attribution: owned exclusively by the flags pipeline (applyFlags/stripFlags, D27) — a second writer here would race it.

  return { changed };
}

/**
 * Install or update settings.json with Devflow configuration.
 *
 * Strategy (D-SETTINGS-1: merge, never overwrite wholesale):
 * - Fresh file: write the template directly.
 * - Existing file: MERGE devflow hook entries and fields into the parsed object.
 *   Idempotent by exact command string — existing hooks are never duplicated or removed.
 *   Preserves every user key (env, permissions, apiKeyHelper, model, etc.) untouched.
 * - Parse failure: warn and skip; file left byte-identical (never clobber a broken file).
 *
 * The merge is additive only, so it runs without a confirmation prompt: init is called
 * from inside an active spinner (a prompt would render on top of it), and declining
 * could not protect the file anyway — init's own settings pass rewrites the hook set
 * unconditionally right afterwards. A prompt whose answer changes nothing is worse
 * than no prompt.
 *
 * The deny list is handled by init's dedicated security step
 * (applyUserSecurityDenyList / installManagedSettings) after installSettings completes.
 */
export async function installSettings(
  claudeDir: string,
  rootDir: string,
  devflowDir: string,
  verbose: boolean,
): Promise<void> {
  const settingsPath = path.join(claudeDir, 'settings.json');
  const sourceSettingsPath = path.join(rootDir, 'src', 'targets', 'claude-code', 'templates', 'settings.json');

  try {
    const settingsTemplate = await fs.readFile(sourceSettingsPath, 'utf-8');
    const settingsContent = substituteSettingsTemplate(settingsTemplate, devflowDir);

    let settingsExists = false;
    try {
      await fs.access(settingsPath);
      settingsExists = true;
    } catch {
      settingsExists = false;
    }

    if (!settingsExists) {
      await writeSettingsFileAtomic(settingsPath, settingsContent);
      if (verbose) {
        p.log.success('Settings configured');
      }
      return;
    }

    // Settings exist — parse and merge (never overwrite wholesale)
    let existingParsed: Record<string, unknown>;
    try {
      existingParsed = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      // Parse failure — warn and skip; file left byte-identical (D-SETTINGS-1)
      if (verbose) {
        p.log.warn(
          'settings.json could not be parsed — Devflow hooks not added. ' +
          'Fix the JSON manually and re-run devflow init.',
        );
      }
      return;
    }

    const templateParsed = JSON.parse(settingsContent) as Record<string, unknown>;

    // Merge template into existing (mutates existingParsed in place).
    // If nothing needs to be added the write is skipped entirely.
    const { changed } = mergeDevflowSettingsTemplate(existingParsed, templateParsed);

    if (!changed) {
      // Already fully configured — nothing to do
      return;
    }

    await writeSettingsFileAtomic(settingsPath, JSON.stringify(existingParsed, null, 2) + '\n');
    if (verbose) {
      p.log.success('Settings updated with Devflow hooks and HUD');
    }
  } catch (error: unknown) {
    if (verbose) {
      p.log.warn(`Could not configure settings: ${error}`);
    }
  }
}

/**
 * Create .claudeignore in git repository root (skip if already exists).
 * Returns true if a new file was created, false if it already existed or on error.
 */
export async function installClaudeignore(
  gitRoot: string,
  rootDir: string,
  verbose: boolean,
): Promise<boolean> {
  const claudeignorePath = path.join(gitRoot, '.claudeignore');
  const claudeignoreTemplatePath = path.join(rootDir, 'src', 'targets', 'claude-code', 'templates', 'claudeignore.template');

  try {
    const claudeignoreContent = await fs.readFile(claudeignoreTemplatePath, 'utf-8');
    await fs.writeFile(claudeignorePath, claudeignoreContent, { encoding: 'utf-8', flag: 'wx' });
    if (verbose) {
      p.log.success('.claudeignore created');
    }
    return true;
  } catch (error: unknown) {
    if (isNodeSystemError(error) && error.code === 'EEXIST') {
      // Already exists, skip silently
    } else if (verbose) {
      p.log.warn(`Could not create .claudeignore: ${error}`);
    }
    return false;
  }
}

/**
 * Discover git repository roots from Claude's project history.
 * Parses `<claudeDir>/history.jsonl` for unique project paths that are valid git repos.
 * @param claudeDir - The Claude Code directory whose history is read — the caller
 *   passes getClaudeDirectory() (D-CLAUDE-CONFIG-DIR), tests a sandbox.
 */
export async function discoverProjectGitRoots(claudeDir: string): Promise<string[]> {
  const historyPath = path.join(claudeDir, 'history.jsonl');
  let content: string;
  try {
    content = await fs.readFile(historyPath, 'utf-8');
  } catch {
    return [];
  }

  const projects = new Set<string>();
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (typeof entry?.project === 'string') {
        projects.add(path.resolve(entry.project));
      }
    } catch {
      // Malformed line — skip
    }
  }

  const results = await Promise.allSettled(
    [...projects].map(async (project) => {
      await fs.access(path.join(project, '.git'));
      return project;
    }),
  );

  const gitRoots: string[] = results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map((r) => r.value);

  return gitRoots.sort();
}

/**
 * Current carve-out marker version. Bump when the block format changes — together
 * with the shell twin's stamp (ensure-root-gitignore) and the ensure-devflow-init
 * fast path, in one commit.
 *
 * D-GITIGNORE-V6 (#392): v6 adds the `!.devflow/project.json` completion line. A
 * v5-stamped project misses the v6 fast path once, gains that line (and nothing else
 * — its comment and every other line stay byte-identical) and is re-stamped v6, so
 * a team can commit `.devflow/project.json` without `git add -f`. v2–v5 inputs all
 * converge on the same completion order: policy, project, `.claudeignore`.
 */
const GITIGNORE_MARKER_V6 = '.root-gitignore-configured-v6';
/**
 * Earlier markers, the unversioned (v1) one included — every one is removed
 * whenever the project is v6-stamped, on the fast path too: an older devflow can
 * re-stamp one beside v6, and the shell twin drops the same five.
 */
const LEGACY_GITIGNORE_MARKERS = [
  '.root-gitignore-configured-v5',
  '.root-gitignore-configured-v4',
  '.root-gitignore-configured-v3',
  '.root-gitignore-configured-v2',
  '.root-gitignore-configured',
] as const;

/** Remove every legacy marker; an absent one is a no-op. Call only once v6 is stamped. */
async function removeLegacyGitignoreMarkers(devflowDir: string): Promise<void> {
  for (const legacy of LEGACY_GITIGNORE_MARKERS) {
    try { await fs.rm(path.join(devflowDir, legacy), { force: true }); } catch { /* ok if absent */ }
  }
}

/**
 * Deterministically ensure the project root .gitignore applies the `.devflow/`
 * carve-out (local by default; feature knowledge, conventions.md, the evidence
 * policy and the project settings shared via git).
 *
 * Manages ONLY `.devflow/` — never `.claude/` — because a project's `.claude/`
 * is its own to share or ignore. This is the init-time counterpart to the always-on
 * src/assets/scripts/hooks/ensure-root-gitignore shell helper; both resolve the same
 * shape for a given .gitignore — DEVFLOW_GITIGNORE_BLOCK, or
 * DEVFLOW_GITIGNORE_BLOCK_WITHOUT_CLAUDEIGNORE when the project owns that entry — and
 * emit identical bytes, so the two paths are byte-compatible and mutually idempotent.
 * Called unconditionally (independent of every feature toggle) whenever a git
 * root is known.
 *
 * Uses a versioned project-local marker file (`.devflow/.root-gitignore-configured-v6`)
 * for fast-path detection — the same pattern as the shell twin. The marker is a claim,
 * not proof, so even a marked install re-reads .gitignore and re-runs
 * computeDevflowGitignore; bumping the version forces a re-run once per install, which
 * is how a v5-marked project gains the project line and is re-stamped v6.
 *
 * Idempotent: computeDevflowGitignore returns null for a converged file, so a
 * marked install performs one read and no write. Errors are swallowed
 * (verbose-logged) — a gitignore write must never abort init.
 */
export async function ensureDevflowGitignore(
  gitRoot: string,
  verbose: boolean,
): Promise<void> {
  try {
    const devflowDir = path.join(gitRoot, '.devflow');
    const markerV6 = path.join(devflowDir, GITIGNORE_MARKER_V6);
    const gitignorePath = path.join(gitRoot, '.gitignore');

    // Fast-path with verification: v6 marker normally means the block is installed,
    // but the marker is a claim, not proof — a merge-conflict resolution may have
    // dropped the block. Even when the marker exists, read .gitignore (one cheap
    // read) and run computeDevflowGitignore; write only when it returns non-null.
    // Idempotent: converged file → computeDevflowGitignore returns null → no write.
    let v6Marked = false;
    try { await fs.access(markerV6); v6Marked = true; } catch { /* absent */ }
    if (v6Marked) {
      let existingContent = '';
      try { existingContent = await fs.readFile(gitignorePath, 'utf-8'); } catch { /* absent */ }
      const healContent = computeDevflowGitignore(existingContent);
      if (healContent !== null) {
        await fs.writeFile(gitignorePath, healContent, 'utf-8');
        if (verbose) {
          p.log.success('.gitignore configured (.devflow/ local; feature knowledge + conventions + retired policy.json + project settings shared)');
        }
      }
      await removeLegacyGitignoreMarkers(devflowDir);
      return;
    }

    let gitignoreContent = '';
    try {
      gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    } catch { /* doesn't exist yet */ }

    const newContent = computeDevflowGitignore(gitignoreContent);
    if (newContent !== null) {
      await fs.writeFile(gitignorePath, newContent, 'utf-8');
      if (verbose) {
        p.log.success('.gitignore configured (.devflow/ local; feature knowledge + conventions + retired policy.json + project settings shared)');
      }
    }

    // Stamp v6 marker so subsequent runs fast-path; drop every legacy marker.
    await fs.mkdir(devflowDir, { recursive: true });
    await fs.writeFile(markerV6, '', 'utf-8');
    await removeLegacyGitignoreMarkers(devflowDir);
  } catch (error) {
    if (verbose) {
      p.log.warn(`Could not update .gitignore: ${error instanceof Error ? error.message : error}`);
    }
  }
}

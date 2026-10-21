// src/assets/scripts/hooks/lib/curation-move.cjs
//
// The one-time move of a project's old ledger folder to its new name: moveLedger, the
// backup sweep (sweepLedgerBackups), the read-only backup count (backupPendingRows) that
// `devflow curation --status` uses, and the read-only list of the backups' queue files
// (backupQueueFiles) that the drain of a disable deletes. The one place that names both
// folders.
//
// DESIGN: plumbing only, like the store it builds on. No function here prints or calls
// process.exit. Work that can fail on its input or on a lock returns a Result, { ok:
// true, value } or { ok: false, error: { kind, message } }, and its caller prints it:
// json-helper.cjs for the move op, or the `devflow init` and `devflow curation` CLI
// through src/core/curation-move.ts. A throw means a broken invariant or an I/O
// failure, never an expected outcome.
//
// Loading: node built-ins and four sibling libs. This module requires the store for
// its primitives (readTextUnlinked, appendNoFollow, the quarantine, renderAll); the
// store never requires this module. The tracked-areas check is a leaf that requires
// neither of them. The store's write guard reads the move journal through
// project-paths.cjs and its own helpers, so a store write loads no move code.
//
// TS COUNTERPART: src/core/curation-move.ts transcribes the functions the CLI calls
// from their JSDoc here (D-LEARNING-STORE-SEAM) — change both together.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  LEGACY_NAMES,
  CURATION_DIR_NAME,
  CURATION_TUNING_FILE_NAME,
  getCurationPendingTurnsPath,
  getCurationPendingTurnsProcessingPath,
  getCurationClaimOwnerPath,
  getDecisionsLedgerPath,
  getDecisionsLogPath,
  getDecisionsArchivePath,
  getDecisionsHistoryPath,
  getDecisionsLockDir,
  getDecisionsFilePath,
  getPitfallsFilePath,
  getDecisionsIndexPath,
  curationMoveLockDir,
  curationMoveJournalPath,
} = require('./project-paths.cjs');
const { acquireMkdirLock, releaseLock } = require('./mkdir-lock.cjs');
const {
  CLAIM_STALE_SECS,
  LOCK_STALE_MS,
  NO_HARD_LINK_CODES,
  QUEUE_LOCK_STALE_MS,
  appendNoFollow,
  quarantineRejected,
  readJsonl,
  readTextUnlinked,
  removeIfPresent,
  renderAll,
  singleLine,
  isPlainObject,
  lstatOrNull,
  physicalPath,
  homeDirOrNull,
} = require('./curation-store.cjs');
const { checkTrackedAreas, inspectTrackedAreas } = require('./tracked-areas.cjs');

// ---------------------------------------------------------------------------
// The one-time ledger move
// ---------------------------------------------------------------------------
//
// moveLedger renames a project's old ledger folder to the new name once, or, when
// the new folder already exists, merges the old one into it. The two folders are the
// two names the path helpers hold (LEGACY_NAMES.folder and CURATION_DIR_NAME): no
// caller names them, because the journal, the backup prefix, the tuning file and the
// locks all stand on that one pair. The move takes its locks without waiting, because a hook that waited on a crashed
// mover would stall every event; it never copies (a failed rename is an error, never
// a fallback to a copy); and it moves no ledger row across the two folders: a losing
// set goes to the backup whole.
//
// D-ONE-LEARNING-LOCK holds for every other writer. The move is the one exception
// to "one lock": it takes the move lock under the machine directory (keyed by the
// ledger root, never inside a repository) together with each folder's own store
// lock and queue lock, all with no wait, so a busy writer makes the move busy
// instead of the move waiting on it.

/** Age after which a move lock counts as abandoned (ms). */
const MOVE_LOCK_STALE_MS = 60000;

/**
 * The name a journal would have inside the old folder. The move never writes one
 * there and never reads one: a file of this name is repository content, an entry of
 * the journal class (moveEntryClass) that stays in the backup. It never refuses a move,
 * and it never steers one; it only takes a move that would rename the whole folder onto
 * the per-entry path, so that the file stays in a backup and does not reach the live
 * folder.
 */
const OLD_FOLDER_JOURNAL_NAME = '.curation-move.journal';

/** The most the journal is read at: far above any journal this module writes. */
const MOVE_JOURNAL_MAX_BYTES = 64 * 1024;

/** The most entries of a folder the move reads: past it the move refuses. */
const MOVE_MAX_ENTRIES = 5000;

/** The most backup folders one sweep merges from, and one status lists by name. */
const MOVE_MAX_BACKUPS = 50;

/**
 * The most backup folders one sweep or one status looks into, to find those that still
 * hold rows. A backup past it is not read: the sweep leaves it and status counts it by name.
 */
const MOVE_MAX_BACKUPS_SCANNED = 500;

/** The name of a path helper's file, whichever project it names. */
const nameOfHelper = helper => path.basename(helper(path.sep));

/** The four files of the ledger set, in the order the move renames them: the ledger last. */
const SET_MEMBERS = Object.freeze([
  getDecisionsLogPath, getDecisionsArchivePath, getDecisionsHistoryPath, getDecisionsLedgerPath,
].map(nameOfHelper));
const LEDGER_NAME = SET_MEMBERS[SET_MEMBERS.length - 1];

const QUEUE_NAME = nameOfHelper(getCurationPendingTurnsPath);
const CLAIM_NAME = nameOfHelper(getCurationPendingTurnsProcessingPath);
const OWNER_NAME = nameOfHelper(getCurationClaimOwnerPath);
const STORE_LOCK_NAME = nameOfHelper(getDecisionsLockDir);
const QUEUE_LOCK_NAME = `${QUEUE_NAME}.lock`;

/** Recovery files the store makes next to its files: quarantined lines, one-time v1 copies. */
const RECOVERY_FILE_RE = /\.(?:rejected|pre-v2)\.jsonl$/;

/** The names, besides the set, the queue and the locks, that the move handles by a rule of its own: the owner file and the tuning files. */
const KNOWN_NAMES = new Set([OWNER_NAME, LEGACY_NAMES.tuningFile, CURATION_TUNING_FILE_NAME]);

/** The tail of a private, swept or overflow queue file's name: a UTC stamp and eight random hex characters. */
const MOVE_UNIQUE_TAIL_RE = '\\d{8}T\\d{6}Z-[0-9a-f]{8}';

/** `text` with every character that means something in a regular expression escaped. */
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The name of a queue file in one of the forms the move makes: `<base>.<word>-<stamp>-<hex>`. */
const queueFormRe = (base, word) => new RegExp(`^${escapeRegExp(base)}\\.${word}-${MOVE_UNIQUE_TAIL_RE}$`);

/**
 * The forms of queue file the move makes. A private file is the queue (or a stale
 * claim's batch) renamed to a unique name before it is read; a swept file is a private
 * or overflow file whose lines are all merged; an overflow file holds the lines that
 * did not fit under the queue's cap. Only the queue and the claim file themselves are
 * ever renamed to a private name, and swept files are never read again.
 */
const QUEUE_FORMS = Object.freeze([
  { form: 'private', base: QUEUE_NAME, re: queueFormRe(QUEUE_NAME, 'merging') },
  { form: 'private', base: CLAIM_NAME, re: queueFormRe(CLAIM_NAME, 'merging') },
  { form: 'swept', base: QUEUE_NAME, re: queueFormRe(QUEUE_NAME, 'swept') },
  { form: 'swept', base: CLAIM_NAME, re: queueFormRe(CLAIM_NAME, 'swept') },
  { form: 'overflow', base: QUEUE_NAME, re: queueFormRe(QUEUE_NAME, 'overflow') },
]);

/** The form record of a queue file's name, or null when the name is none of the forms. */
function queueFormOf(name) {
  return QUEUE_FORMS.find(entry => entry.re.test(name)) || null;
}

/** Names of the files the renderer writes: the move never carries them, the new folder rebuilds its own. */
const RENDERED_NAMES = new Set([getDecisionsFilePath, getPitfallsFilePath, getDecisionsIndexPath].map(nameOfHelper));

/** The name a displaced copy of a set member takes: the member, a UTC stamp and a random suffix. */
const displacedRe = member => new RegExp(`^${escapeRegExp(member)}\\.displaced-${MOVE_UNIQUE_TAIL_RE}$`);
const DISPLACED_RES = Object.freeze(SET_MEMBERS.map(displacedRe));

/** The classes of entry in an old folder or a backup folder (moveEntryClass). */
const ENTRY = Object.freeze({
  SET_MEMBER: 'set-member',
  QUEUE: 'queue',
  KNOWN: 'known',
  LOCK: 'lock',
  RECOVERY: 'recovery',
  QUEUE_FORM: 'queue-form',
  DISPLACED: 'displaced',
  RENDERED: 'rendered',
  JOURNAL: 'journal',
  UNKNOWN: 'unknown',
});

/**
 * What the move does with each class of entry, defined once.
 *
 * linkChecked: the refusal looks at an entry of the class before the move reads or
 * changes anything, and refuses a link (a lock path must also be an empty directory).
 * It holds for every class some move path renames or takes: the set members (renamed
 * into the new folder), the queue files and the queue forms (renamed to a private and
 * then a swept name), the owner file and the tuning files, the recovery files (moved),
 * the two lock directories (taken) and the displaced copies (made, then left in the old
 * folder). A rendered file, a journal-named file and an unknown entry are never read
 * or renamed: a link among them never refuses a move.
 *
 * leftBehind: the entry stays in the backup, and one note lists it.
 */
const MOVE_ENTRY_CLASSES = Object.freeze({
  [ENTRY.SET_MEMBER]: Object.freeze({ linkChecked: true, leftBehind: false }),
  [ENTRY.QUEUE]: Object.freeze({ linkChecked: true, leftBehind: false }),
  [ENTRY.KNOWN]: Object.freeze({ linkChecked: true, leftBehind: false }),
  [ENTRY.LOCK]: Object.freeze({ linkChecked: true, leftBehind: false }),
  [ENTRY.RECOVERY]: Object.freeze({ linkChecked: true, leftBehind: false }),
  [ENTRY.QUEUE_FORM]: Object.freeze({ linkChecked: true, leftBehind: false }),
  [ENTRY.DISPLACED]: Object.freeze({ linkChecked: true, leftBehind: false }),
  [ENTRY.RENDERED]: Object.freeze({ linkChecked: false, leftBehind: false }),
  [ENTRY.JOURNAL]: Object.freeze({ linkChecked: false, leftBehind: true }),
  [ENTRY.UNKNOWN]: Object.freeze({ linkChecked: false, leftBehind: true }),
});

/**
 * The class of an entry of an old folder or a backup folder, by its name: the one
 * place that says what the move knows. The refusal, the whole-folder stray check, the
 * entry listing and the backup checks all ask it, so no two of them can disagree.
 *
 * @param {string} name
 * @returns {string} one of the ENTRY classes
 */
function moveEntryClass(name) {
  if (SET_MEMBERS.includes(name)) return ENTRY.SET_MEMBER;
  if (name === QUEUE_NAME || name === CLAIM_NAME) return ENTRY.QUEUE;
  if (KNOWN_NAMES.has(name)) return ENTRY.KNOWN;
  if (name === STORE_LOCK_NAME || name === QUEUE_LOCK_NAME) return ENTRY.LOCK;
  if (RECOVERY_FILE_RE.test(name)) return ENTRY.RECOVERY;
  if (queueFormOf(name) !== null) return ENTRY.QUEUE_FORM;
  if (DISPLACED_RES.some(re => re.test(name))) return ENTRY.DISPLACED;
  if (RENDERED_NAMES.has(name)) return ENTRY.RENDERED;
  if (name === OLD_FOLDER_JOURNAL_NAME) return ENTRY.JOURNAL;
  return ENTRY.UNKNOWN;
}

/** True for a class the refusal link-checks (MOVE_ENTRY_CLASSES). */
const isLinkChecked = cls => MOVE_ENTRY_CLASSES[cls].linkChecked;

/** True for a class that stays in the backup and is listed in a note (MOVE_ENTRY_CLASSES). */
const isLeftBehind = cls => MOVE_ENTRY_CLASSES[cls].leftBehind;

/** The op names that start every message an op answers. */
const MOVE_OP = 'move-ledger';
const SWEEP_OP = 'sweep-backups';
const ROWS_OP = 'backup-rows';
const QUEUE_FILES_OP = 'backup-queue-files';

/** True for a ledger root the ops accept before they look at the disk: a non-empty absolute path with no NUL. */
const isAbsoluteRoot = root => typeof root === 'string' && root !== '' && !root.includes('\0') && path.isAbsolute(root);

/**
 * The error Result of an op that was refused before it changed anything.
 *
 * @param {string} opName - the op, which starts the message
 * @param {string} message
 */
function moveRefused(opName, message) {
  return { ok: false, error: { kind: 'refused', message: `${opName}: ${message}; nothing was changed` } };
}

/**
 * The error Result of an I/O failure during an op, or a rethrow for anything else.
 * A failure that carries an fs error code is an expected outcome the caller reports;
 * one without a code is a broken invariant and reaches the caller as a throw.
 *
 * @param {string} opName - the op, which starts the message
 * @param {unknown} err
 */
function moveIoFailure(opName, err) {
  if (!err || typeof err.code !== 'string') throw err;
  return { ok: false, error: { kind: 'io-error', message: `${opName}: ${err.code}: ${err.message}` } };
}

/**
 * `result` with every message and note on one line (singleLine). A name that a
 * repository holds (an entry, a backup folder) reaches a message through a path, and a
 * name may carry a terminal escape sequence or a newline, so no message leaves the move
 * ops with one. Answers a new Result and leaves `result` as it is.
 *
 * @param {{ ok: true, value: { notes?: string[] } } | { ok: false, error: { message: string } }} result
 */
function scrubMoveResult(result) {
  if (!result.ok) return { ok: false, error: { ...result.error, message: singleLine(result.error.message) } };
  const { notes } = result.value;
  return Array.isArray(notes) ? { ok: true, value: { ...result.value, notes: notes.map(singleLine) } } : result;
}

/**
 * What is wrong with an entry the move will read or rename, or null when nothing is:
 * a link is, and so is anything but an empty directory where a lock belongs, because
 * a lock path holding a file, or a directory with something in it, can never be taken
 * or broken, and acquireMkdirLock would retry it for ever. An absent entry is fine.
 *
 * @param {string} file
 * @param {{ lock?: boolean }} [opts]
 * @returns {string|null}
 */
function moveEntryProblem(file, { lock = false } = {}) {
  const stat = lstatOrNull(file);
  if (stat === null) return null;
  if (stat.isSymbolicLink()) return `${file} is a symbolic link`;
  if (lock && !stat.isDirectory()) return `${file} is not a lock directory`;
  if (lock && fs.readdirSync(file).length > 0) return `${file} is a lock directory that holds files`;
  return null;
}

/**
 * Check a ledger root before the move reads or changes anything in it, and answer
 * its physical path. The root must be a real ledger root: an absolute path to a
 * directory that is not a link, not the home directory and not the machine
 * directory. If any entry below the root that the move touches is a link, the move
 * is refused: the root's `.devflow` directory, the old and new folders, each lock,
 * and each allowlisted entry of both folders; in the whole-folder case every entry
 * directly inside the old folder, because the single rename carries any link with
 * it. The machine directory itself is not checked: a dotfile manager may link it, but
 * the move lock and the journal that stand in it must not be links, and the journal
 * must be a regular file. A file named like a journal in the old folder is no journal:
 * it is an unknown entry.
 * Nothing is created and nothing is locked here.
 *
 * @param {string} opName - the op, which starts every message
 * @param {unknown} root
 * @param {{ machineDir: string, homeDir: string|null }} dirs
 * @returns {{ ok: true, value: { realRoot: string } } | { ok: false, error: { kind: 'refused', message: string } }}
 */
function curationMoveRefusal(opName, root, { machineDir, homeDir }) {
  if (!isAbsoluteRoot(root)) return moveRefused(opName, 'the ledger root must be an absolute path');
  const rootPath = path.resolve(root);
  const rootStat = lstatOrNull(rootPath);
  if (rootStat === null || !(rootStat.isDirectory() || rootStat.isSymbolicLink())) {
    return moveRefused(opName, `${rootPath} is not a directory`);
  }
  if (rootStat.isSymbolicLink()) return moveRefused(opName, `the ledger root ${rootPath} is a symbolic link`);
  const realRoot = fs.realpathSync(rootPath);
  if (homeDir && physicalPath(homeDir) === realRoot) return moveRefused(opName, 'the ledger root is the home directory');
  if (physicalPath(machineDir) === realRoot) return moveRefused(opName, 'the ledger root is the machine directory');

  const devflowDir = path.join(rootPath, '.devflow');
  const oldDir = path.join(devflowDir, LEGACY_NAMES.folder);
  const newDir = path.join(devflowDir, CURATION_DIR_NAME);
  const dirs = [];
  for (const dir of [devflowDir, oldDir, newDir]) {
    const stat = lstatOrNull(dir);
    if (stat === null) continue;
    if (stat.isSymbolicLink()) return moveRefused(opName, `${dir} is a symbolic link`);
    if (!stat.isDirectory()) return moveRefused(opName, `${dir} is not a directory`);
    dirs.push(dir);
  }

  const lockProblem = moveEntryProblem(curationMoveLockDir(machineDir, realRoot), { lock: true });
  if (lockProblem !== null) return moveRefused(opName, lockProblem);
  const journal = curationMoveJournalPath(machineDir, realRoot);
  const journalStat = lstatOrNull(journal);
  if (journalStat !== null && !journalStat.isFile()) return moveRefused(opName, `${journal} is not a regular file`);

  const wholeFolder = dirs.includes(oldDir) && !dirs.includes(newDir);
  for (const dir of dirs.filter(d => d !== devflowDir)) {
    const entries = fs.readdirSync(dir);
    if (entries.length > MOVE_MAX_ENTRIES) return moveRefused(opName, `${dir} holds more than ${MOVE_MAX_ENTRIES} entries`);
    for (const entry of entries) {
      const cls = moveEntryClass(entry);
      if (!(wholeFolder && dir === oldDir) && !isLinkChecked(cls)) continue;
      const problem = moveEntryProblem(path.join(dir, entry), { lock: cls === ENTRY.LOCK });
      if (problem !== null) return moveRefused(opName, problem);
    }
  }
  return { ok: true, value: { realRoot } };
}

/**
 * Take every lock in `specs`, in order, each with no wait: a lock that is held and
 * younger than its own stale age makes the whole attempt busy, and the locks already
 * taken are released first. Locks are plain mkdir locks (acquireMkdirLock).
 *
 * @param {Array<{ name: string, dir: string, staleMs: number }>} specs
 * @returns {{ busy: string|null, held: Array<{ name: string, dir: string }> }}
 *   busy: the name of the lock that was busy, else null; held: the locks taken
 *   (empty when busy)
 * @throws on any other I/O failure, after releasing the locks it took
 */
function curationMoveLockAll(specs) {
  const held = [];
  try {
    for (const spec of specs) {
      if (!acquireMkdirLock(spec.dir, 0, spec.staleMs)) {
        curationMoveReleaseAll(held);
        return { busy: spec.name, held: [] };
      }
      held.push({ name: spec.name, dir: spec.dir });
    }
  } catch (err) {
    curationMoveReleaseAll(held);
    throw err;
  }
  return { busy: null, held };
}

/**
 * Release the locks `curationMoveLockAll` took, newest first, each at the path it is
 * given. A lock that is already gone is fine.
 *
 * @param {Array<{ dir: string }>} held
 */
function curationMoveReleaseAll(held) {
  for (let i = held.length - 1; i >= 0; i--) releaseLock(held[i].dir);
}

/** `held` with every lock that sits under `from` now under `to`, after a rename of that folder. */
function relocateLocks(held, from, to) {
  return held.map(lock => (lock.dir.startsWith(from + path.sep)
    ? { ...lock, dir: path.join(to, lock.dir.slice(from.length + 1)) }
    : lock));
}

/**
 * The whole-folder case: the new folder is absent, so the old folder is renamed to
 * it. The project tuning file is renamed first, inside the old folder, so a crash
 * between the two renames leaves only a renamed tuning file, and a rerun renames just
 * the folder; a `curation.json` already there stays the tuning file. No per-entry rule
 * applies: one rename(2) carries the whole folder, its locks included. A private,
 * swept or overflow queue file sitting directly in the old folder refuses the move,
 * because the rename would carry it into the live folder, where no sweep reads it. A
 * file named like a journal never gets here: moveLedger takes the per-entry path for it
 * (oldFolderNeedsEntryPath).
 *
 * @param {{ oldDir: string, newDir: string }} ctx
 * @returns {{ ok: true, value: { notes: string[] } } | { ok: false, error: { kind: string, message: string } }}
 * @throws on an I/O failure
 */
function curationMoveWhole(ctx) {
  const stray = fs.readdirSync(ctx.oldDir).filter(name => moveEntryClass(name) === ENTRY.QUEUE_FORM);
  if (stray.length > 0) {
    return moveRefused(MOVE_OP, `${path.basename(ctx.oldDir)} holds ${stray.join(', ')}, which must not move into the live folder`);
  }
  const tuningFrom = path.join(ctx.oldDir, LEGACY_NAMES.tuningFile);
  const tuningTo = path.join(ctx.oldDir, CURATION_TUNING_FILE_NAME);
  const tuning = lstatOrNull(tuningFrom);
  if (tuning !== null && tuning.isFile() && lstatOrNull(tuningTo) === null) fs.renameSync(tuningFrom, tuningTo);
  fs.renameSync(ctx.oldDir, ctx.newDir);
  return { ok: true, value: { notes: [`moved ${path.basename(ctx.oldDir)} to ${path.basename(ctx.newDir)}`] } };
}

/**
 * The most lines a merge fills a pending queue to. It equals the number of lines the
 * capture hooks' trim keeps (`tail -100` in queue-append). That trim starts only above
 * 200 lines, so a merge never takes a queue within reach of it, and no merged row can
 * be dropped by it. A row that does not fit goes to an overflow file.
 */
const QUEUE_MERGE_CAP_LINES = 100;

/** The largest queue file the move reads, in bytes: far above a queue the cap allows. */
const QUEUE_FILE_MAX_BYTES = 64 * 1024 * 1024;

/** Age past which an unfinished last line counts as written by a dead writer (ms). */
const DEAD_FRAGMENT_AGE_MS = 60000;

/** The most queue files one pass merges from one folder. */
const MOVE_MAX_QUEUE_FILES = 200;

/** The most unknown entry names a note lists. */
const MOVE_MAX_NAMES_LISTED = 20;

/** The largest ledger the move's re-render reads, in bytes: far above a ledger the store grows. */
const LEDGER_RENDER_MAX_BYTES = 64 * 1024 * 1024;

/** The folder under the ledger root that holds both ledger folders and the backups. */
const DEVFLOW_DIR_NAME = '.devflow';

/** `YYYYMMDDTHHMMSSZ` for an epoch ms. */
function utcStamp(now) {
  return new Date(now).toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');
}

/** The unique tail of a name the move makes: a UTC stamp and eight random hex characters. */
function uniqueTail(now) {
  return `${utcStamp(now)}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Rename `from` to `to` without ever replacing an existing `to`: link(2) to the new
 * name, which fails when the name exists, then unlink(2) of the old one. If the
 * unlink fails after the link, the same file is under two names; a later run merges
 * it again and the dedupe keeps that harmless. On a filesystem without hard links
 * (EPERM or ENOTSUP) it renames instead, only where lstat shows the new name free,
 * as the claim does. Any other link failure leaves `from` where it is and throws.
 *
 * @param {string} from
 * @param {string} to
 */
function renameNoReplace(from, to) {
  try {
    fs.linkSync(from, to);
  } catch (err) {
    if (!err || !NO_HARD_LINK_CODES.includes(err.code)) throw err;
    if (lstatOrNull(to) !== null) throw Object.assign(new Error(`${path.basename(to)} already exists`), { code: 'EEXIST' });
    fs.renameSync(from, to);
    return;
  }
  fs.unlinkSync(from);
}

/**
 * The text of a queue file, or null when nothing readable is there: a link, a folder
 * or any other non-regular file reads as absent (D-NO-LINKED-READ, at readJsonl).
 *
 * @param {string} file
 * @returns {string|null}
 * @throws on a queue file larger than QUEUE_FILE_MAX_BYTES, or any other read error
 */
function readQueueText(file) {
  const stat = lstatOrNull(file);
  if (stat === null || !stat.isFile()) return null;
  if (stat.size > QUEUE_FILE_MAX_BYTES) {
    throw Object.assign(new Error(`${path.basename(file)} is larger than ${QUEUE_FILE_MAX_BYTES} bytes`), { code: 'EFBIG' });
  }
  return readTextUnlinked(file, { maxBytes: QUEUE_FILE_MAX_BYTES });
}

/** Create `file` exclusively, without following a link, at mode 0600, holding `content`. */
function writeNewPrivateFile(file, content) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags, 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The pending queue of a target folder, read once: its line count and its non-blank
 * lines. The count is the number of line ends, as the capture hooks' trim counts.
 *
 * @param {string} targetDir
 * @returns {{ count: number, lines: string[] }}
 */
function readPendingQueue(targetDir) {
  const text = readQueueText(path.join(targetDir, QUEUE_NAME)) || '';
  return { count: text.split('\n').length - 1, lines: text.split('\n').filter(line => line.trim() !== '') };
}

/**
 * The lines a merge must not append again: every non-blank line of the target's
 * processing file, read once for the whole merged file. The pending lines join the set
 * as each merge step reads them (mergeQueueLines).
 *
 * @param {string} targetDir
 * @returns {Set<string>}
 */
function readClaimedLines(targetDir) {
  const text = readQueueText(path.join(targetDir, CLAIM_NAME)) || '';
  return new Set(text.split('\n').filter(line => line.trim() !== ''));
}

/**
 * Merge the complete `lines` of a queue file into the target folder's pending queue:
 * only the lines it does not already hold verbatim, appended in one write at mode
 * 0600, and only while the queue stays within QUEUE_MERGE_CAP_LINES. The lines that do
 * not fit go to a new overflow file in `fromDir`. The target queue is appended to,
 * never replaced, because a replace would drop an append that lands during the merge.
 * The pending queue is read again before each append, so a capture that landed since
 * the last step counts against the cap.
 *
 * @param {{ now: number }} ctx
 * @param {string[]} lines
 * @param {string} targetDir
 * @param {string} fromDir
 * @param {Set<string>} seen - the lines the target already holds; the step adds what it reads and appends
 * @returns {{ merged: number, overflowed: number }}
 */
function mergeQueueLines(ctx, lines, targetDir, fromDir, seen) {
  if (lines.length === 0) return { merged: 0, overflowed: 0 };
  const pending = readPendingQueue(targetDir);
  for (const line of pending.lines) seen.add(line);
  const fresh = lines.filter(line => !seen.has(line));
  const room = Math.max(0, QUEUE_MERGE_CAP_LINES - pending.count);
  const fit = fresh.slice(0, room);
  const over = fresh.slice(room);
  if (fit.length > 0) {
    appendNoFollow(path.join(targetDir, QUEUE_NAME), `${fit.join('\n')}\n`, 0o600);
    for (const line of fit) seen.add(line);
  }
  if (over.length > 0) writeNewPrivateFile(path.join(fromDir, `${QUEUE_NAME}.overflow-${uniqueTail(ctx.now)}`), `${over.join('\n')}\n`);
  return { merged: fit.length, overflowed: over.length };
}

/** The non-blank lines of `text`, which ends at a line end. */
const completeLines = text => text.split('\n').filter(line => line.trim() !== '');

/**
 * Merge one private or overflow queue file into the target folder's pending queue,
 * then mark it swept. It reads the file, merges its newline-terminated lines, reads
 * it again and merges whatever a writer appended meanwhile, and renames it to a swept
 * name: a swept file is never unlinked and never read again. A trailing fragment
 * stays unmerged and the file stays unswept for the next run, unless its writer is
 * taken to be dead: the fragment is unchanged across the re-read and the file is
 * older than DEAD_FRAGMENT_AGE_MS, and then it goes to the queue's rejected file
 * through the store's quarantine rule and the file is swept. An overflow file is
 * merged only while the target has room. The target's processing file is read once
 * for the whole merged file.
 *
 * @param {{ now: number }} ctx
 * @param {string} file - the queue file, in a form queueFormOf names
 * @param {string} targetDir - the folder whose pending queue receives the lines
 * @returns {{ merged: number, overflowed: number, swept: boolean, note: string|null }}
 */
function mergeQueueFile(ctx, file, targetDir) {
  const dir = path.dirname(file);
  const record = queueFormOf(path.basename(file));
  const idle = { merged: 0, overflowed: 0, swept: false, note: null };
  if (record.form === 'overflow' && readPendingQueue(targetDir).count >= QUEUE_MERGE_CAP_LINES) return idle;

  const first = readQueueText(file);
  if (first === null) return idle;
  const seen = readClaimedLines(targetDir);
  const complete = first.slice(0, first.lastIndexOf('\n') + 1);
  const fragment = first.slice(complete.length);
  const one = mergeQueueLines(ctx, completeLines(complete), targetDir, dir, seen);

  const second = readQueueText(file);
  if (second === null) return { ...one, swept: false, note: null };
  const rest = second.startsWith(complete) ? second.slice(complete.length) : second;
  const appended = rest.slice(0, rest.lastIndexOf('\n') + 1);
  const trailing = rest.slice(appended.length);
  const two = mergeQueueLines(ctx, completeLines(appended), targetDir, dir, seen);
  const total = { merged: one.merged + two.merged, overflowed: one.overflowed + two.overflowed };

  let note = null;
  if (trailing.trim() !== '') {
    const stat = lstatOrNull(file);
    const dead = stat !== null && stat.isFile() && trailing === fragment && ctx.now - stat.mtimeMs > DEAD_FRAGMENT_AGE_MS;
    if (!dead) {
      return { ...total, swept: false, note: `${path.basename(file)} ends in an unfinished line and stays for the next sweep` };
    }
    const line = second.slice(0, second.length - trailing.length).split('\n').length;
    quarantineRejected(path.join(dir, QUEUE_NAME), [{ line, text: trailing }], { now: ctx.now, mode: 0o600 });
    note = `${path.basename(file)} ended in an unfinished line from a writer that is gone; it went to the rejected file`;
  }
  renameNoReplace(file, path.join(dir, `${record.base}.swept-${uniqueTail(ctx.now)}`));
  return { ...total, swept: true, note };
}

/**
 * The queue rule: merge a folder's pending queue (and, for a stale claim, its
 * processing batch) into the target folder's pending queue.
 *
 * Every private file already in the folder (left by a crash or an earlier error) is
 * merged first, before a new private name is made. Then each live queue file in
 * `bases` is renamed, no-replace, to a new private name, so later appends by path
 * create a fresh queue that the next run catches, and the private file goes through
 * mergeQueueFile. With `overflow` set, overflow files are merged too.
 *
 * @param {{ now: number }} ctx
 * @param {{ dir: string, targetDir: string, bases: string[], overflow?: boolean }} opts
 *   dir: the folder holding the files; targetDir: the folder whose queue receives the
 *   lines; bases: the live queue files to rename and merge, in order
 * @returns {{ files: number, merged: number, overflowed: number, notes: string[] }}
 */
function curationMoveMergeQueue(ctx, { dir, targetDir, bases, overflow = false }) {
  const total = { files: 0, merged: 0, overflowed: 0, notes: [] };
  const take = file => {
    const result = mergeQueueFile(ctx, file, targetDir);
    total.merged += result.merged;
    total.overflowed += result.overflowed;
    if (result.swept) total.files++;
    if (result.note !== null) total.notes.push(result.note);
  };
  const isWanted = name => {
    const record = queueFormOf(name);
    return record !== null && (record.form === 'private' || (overflow && record.form === 'overflow'));
  };
  const waiting = fs.readdirSync(dir).filter(isWanted).sort().slice(0, MOVE_MAX_QUEUE_FILES);
  for (const name of waiting) take(path.join(dir, name));

  for (const base of bases) {
    const live = path.join(dir, base);
    const stat = lstatOrNull(live);
    if (stat === null || !stat.isFile()) continue;
    const privateFile = path.join(dir, `${base}.merging-${uniqueTail(ctx.now)}`);
    renameNoReplace(live, privateFile);
    take(privateFile);
  }
  return total;
}

/**
 * The backup sweep, shared by the race close at the end of a move and by init: run the
 * queue rule over a backup folder's pending and processing files and over every unswept
 * private and overflow file in it, into the new folder's pending queue. With the new
 * folder absent it does nothing. The caller holds the move lock and the new folder's
 * queue lock.
 *
 * @param {{ now: number, newDir: string }} ctx
 * @param {string} backupDir
 * @returns {{ files: number, merged: number, overflowed: number, notes: string[] }}
 */
function curationMoveSweepBackup(ctx, backupDir) {
  if (lstatOrNull(ctx.newDir) === null) return { files: 0, merged: 0, overflowed: 0, notes: [] };
  return curationMoveMergeQueue(ctx, { dir: backupDir, targetDir: ctx.newDir, bases: [QUEUE_NAME, CLAIM_NAME], overflow: true });
}

/** True when the new folder's observation log holds data: it is a regular file with bytes in it. */
function newFolderHasData(ctx) {
  const stat = lstatOrNull(path.join(ctx.newDir, SET_MEMBERS[0]));
  return stat !== null && stat.isFile() && stat.size > 0;
}

/**
 * What a journal records: a step is either the displacement of the new folder's copy
 * of a set member into the old folder under a displaced name, or the move of the old
 * folder's member into the new folder.
 *
 * @typedef {{ op: 'displace', name: string, to: string } | { op: 'move', name: string }} MoveStep
 */

/**
 * What identifies a folder across passes: the device, the inode and the creation time
 * that a bigint lstat reports, each as a decimal string. A folder that was deleted and
 * made again is another folder, whatever its name. The inode number alone does not say
 * so: Linux file systems often give the freed inode number of a deleted folder to the
 * next one made, so the creation time (birthtimeNs) is the part that tells them apart.
 * Where the file system reports no creation time (zero), `birth` is null, and such an
 * identity confirms no folder: a journal that holds one is dropped, and the move decides
 * afresh. A folder made again within one kernel clock tick of the first, with the same
 * inode number, is the one case that stays unseen.
 *
 * @typedef {{ dev: string, ino: string, birth: string|null }} FolderIdentity
 */

/** The bigint lstat of `file`, or null when nothing is there. @param {string} file @returns {import('fs').BigIntStats|null} @throws on another I/O failure */
function lstatBigintOrNull(file) {
  try {
    return fs.lstatSync(file, { bigint: true });
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    throw err;
  }
}

/** @param {import('fs').BigIntStats} stat @returns {FolderIdentity} */
const folderIdentity = stat => ({
  dev: String(stat.dev),
  ino: String(stat.ino),
  birth: stat.birthtimeNs > 0n ? String(stat.birthtimeNs) : null,
});

/**
 * True when `identity` is the identity of the folder `stat` describes. False when either
 * side has no creation time: the inode number alone is not enough to say it is the same folder.
 *
 * @param {FolderIdentity} identity
 * @param {import('fs').BigIntStats|null} stat
 */
function isSameFolder(identity, stat) {
  if (stat === null || identity.birth === null) return false;
  const now = folderIdentity(stat);
  return now.birth !== null && identity.dev === now.dev && identity.ino === now.ino && identity.birth === now.birth;
}

/** True for a string that a journal can hold as a device, an inode or a creation time: decimal digits. */
const isIdentityDigits = value => typeof value === 'string' && /^[0-9]{1,24}$/.test(value);

/**
 * The steps of a journal file and the identity of the old folder it was planned for, or
 * null when the file is not a journal this module wrote: unreadable, not JSON, naming
 * anything but a set member and a displaced name of that member, or with no folder
 * identity. A journal is trusted only that far, and only the machine-side file is ever
 * read: the folders can hold a file a repository committed.
 *
 * @param {string} file
 * @returns {{ steps: MoveStep[], oldDir: FolderIdentity }|null}
 */
function readMoveJournal(file) {
  const text = readTextUnlinked(file, { maxBytes: MOVE_JOURNAL_MAX_BYTES });
  if (text === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.steps)) return null;
  if (parsed.steps.length > SET_MEMBERS.length * 2) return null;
  const recordedDir = parsed.oldDir;
  if (!isPlainObject(recordedDir) || !isIdentityDigits(recordedDir.dev) || !isIdentityDigits(recordedDir.ino)) return null;
  if (recordedDir.birth !== null && !isIdentityDigits(recordedDir.birth)) return null;
  const steps = [];
  for (const step of parsed.steps) {
    if (!isPlainObject(step)) return null;
    const index = SET_MEMBERS.indexOf(step.name);
    if (index === -1) return null;
    if (step.op === 'move') steps.push({ op: 'move', name: step.name });
    else if (step.op === 'displace' && typeof step.to === 'string' && DISPLACED_RES[index].test(step.to)) {
      steps.push({ op: 'displace', name: step.name, to: step.to });
    } else return null;
  }
  return { steps, oldDir: { dev: recordedDir.dev, ino: recordedDir.ino, birth: recordedDir.birth } };
}

/**
 * Drop a machine-side journal that was planned for an old folder other than the one that
 * stands now, or whose old folder cannot be confirmed to be this one. The journal lives in the machine directory and the old folder can be
 * deleted and made again (a downgrade that starts a new one, a manual delete), so a
 * journal that outlives its folder would replay its steps against another folder's files
 * and move the live set into the backup. A journal that cannot be read is left for
 * curationMoveSetWithJournal, which removes it with its own note. Only a regular file is
 * removed, never a link.
 *
 * @param {{ oldDir: string, journal: string }} ctx
 * @returns {string[]} one note when a journal was dropped, else none
 * @throws on an I/O failure
 */
function curationMoveDropStaleJournal(ctx) {
  const stat = lstatOrNull(ctx.journal);
  if (stat === null || !stat.isFile()) return [];
  const journal = readMoveJournal(ctx.journal);
  if (journal === null || isSameFolder(journal.oldDir, lstatBigintOrNull(ctx.oldDir))) return [];
  removeIfPresent(ctx.journal);
  return [`dropped a move journal that was not confirmed to belong to this ${path.basename(ctx.oldDir)} folder; the move decides afresh`];
}

/**
 * Carry out one journal step when its source still exists and its target does not.
 * A step whose source and target both exist is left undone and nothing is overwritten.
 * For a move step that is a split set, a member present in both folders, and it is
 * reported by name. For a displace step it is the normal state of a resumed move (the
 * member that was displaced has since moved in), so it is not reported.
 *
 * @returns {{ renamed: boolean, note: string|null }}
 */
function applyMoveStep(ctx, step) {
  const from = step.op === 'move' ? path.join(ctx.oldDir, step.name) : path.join(ctx.newDir, step.name);
  const to = step.op === 'move' ? path.join(ctx.newDir, step.name) : path.join(ctx.oldDir, step.to);
  if (lstatOrNull(from) === null) return { renamed: false, note: null };
  if (lstatOrNull(to) !== null) {
    const note = step.op === 'move'
      ? `${step.name} exists in both ${path.basename(ctx.newDir)} and ${path.basename(ctx.oldDir)}; both were left in place`
      : null;
    return { renamed: false, note };
  }
  fs.renameSync(from, to);
  return { renamed: true, note: null };
}

/**
 * The set move: the old folder's ledger set moves into the new folder, which has no
 * log data to lose, in a journalled order that a crash cannot leave half done.
 *
 * For each set member the old folder holds, the new folder's copy (empty or not) is
 * first displaced into the old folder under a displaced name, never overwritten; then
 * the members are renamed in, in the fixed order: log, archive, history, and the
 * ledger last. The plan is written first to the root's journal in the machine
 * directory, `ctx.journal` (mode 0600, created exclusively, never through a link), with
 * the identity (device, inode and creation time) of the old folder it was planned for, and the journal
 * is removed once the set is complete. Only that file is a journal: one in
 * the old folder is repository content and is never read. If a journal exists when the
 * op starts, the op completes each listed step whose source still exists and whose
 * target does not, and does not decide the winner again. An error before the first
 * rename removes the journal; after one the journal stays and the next run completes
 * it. While a journal exists every store write on the root returns busy.
 *
 * @param {{ oldDir: string, newDir: string, journal: string, now: number }} ctx
 * @returns {{ notes: string[] }}
 * @throws on an I/O failure
 */
function curationMoveSetWithJournal(ctx) {
  const notes = [];
  const journal = ctx.journal;
  let steps = null;
  if (lstatOrNull(journal) !== null) {
    const recorded = readMoveJournal(journal);
    steps = recorded === null ? null : recorded.steps;
    if (steps === null) {
      removeIfPresent(journal);
      notes.push('removed an unreadable move journal; no rename had been recorded');
    }
  }
  const resumed = steps !== null;
  if (!resumed) {
    const members = SET_MEMBERS.filter(name => {
      const stat = lstatOrNull(path.join(ctx.oldDir, name));
      return stat !== null && stat.isFile();
    });
    steps = [
      ...members.filter(name => lstatOrNull(path.join(ctx.newDir, name)) !== null)
        .map(name => ({ op: 'displace', name, to: `${name}.displaced-${uniqueTail(ctx.now)}` })),
      ...members.map(name => ({ op: 'move', name })),
    ];
    if (steps.length === 0) return { notes };
    try {
      writeNewPrivateFile(journal, JSON.stringify({ version: 1, oldDir: folderIdentity(fs.lstatSync(ctx.oldDir, { bigint: true })), steps }));
    } catch (err) {
      removeIfPresent(journal);
      throw err;
    }
  }
  let renamed = 0;
  try {
    for (const step of steps) {
      const applied = applyMoveStep(ctx, step);
      if (applied.renamed) renamed++;
      if (applied.note !== null) notes.push(applied.note);
    }
  } catch (err) {
    if (!resumed && renamed === 0) removeIfPresent(journal);
    throw err;
  }
  removeIfPresent(journal);
  return { notes };
}

/**
 * The entries of the old folder other than the ledger set and the queue: the project
 * tuning file moves in under its curation name when the new folder lacks one, and a
 * recovery file (`*.rejected.jsonl`, `*.pre-v2.jsonl`) moves when the new folder lacks
 * a file of that name; otherwise the old one stays in the old folder, which becomes
 * the backup, with one note. Rendered files, locks, claim state and queue forms are
 * never moved. An entry of an unknown or journal class stays and is listed in a note.
 *
 * @param {{ oldDir: string, newDir: string }} ctx
 * @returns {{ notes: string[] }}
 * @throws on an I/O failure
 */
function curationMoveEntries(ctx) {
  const notes = [];
  const entries = fs.readdirSync(ctx.oldDir).sort();
  const leftBehind = [];
  const move = name => {
    const targetName = name === LEGACY_NAMES.tuningFile ? CURATION_TUNING_FILE_NAME : name;
    if (lstatOrNull(path.join(ctx.newDir, targetName)) !== null) {
      notes.push(`${targetName} already exists in ${path.basename(ctx.newDir)}; ${name} stays in the backup`);
      return;
    }
    fs.renameSync(path.join(ctx.oldDir, name), path.join(ctx.newDir, targetName));
  };

  const tuning = [CURATION_TUNING_FILE_NAME, LEGACY_NAMES.tuningFile]
    .find(name => { const stat = lstatOrNull(path.join(ctx.oldDir, name)); return stat !== null && stat.isFile(); });
  if (tuning !== undefined) move(tuning);
  for (const name of entries) {
    const cls = moveEntryClass(name);
    if (cls === ENTRY.RECOVERY) {
      const stat = lstatOrNull(path.join(ctx.oldDir, name));
      if (stat !== null && stat.isFile()) move(name);
    } else if (isLeftBehind(cls)) {
      leftBehind.push(name);
    }
  }
  if (leftBehind.length > 0) {
    const shown = leftBehind.slice(0, MOVE_MAX_NAMES_LISTED).join(', ');
    notes.push(`left in the backup, not moved: ${shown}${leftBehind.length > MOVE_MAX_NAMES_LISTED ? ', ...' : ''}`);
  }
  return { notes };
}

/**
 * The end of a pass, while it holds the new folder's store lock: rebuild the new
 * folder's rendered files, so no index names the old folder; then, when the old folder
 * is still there, rename it to the backup name (the legacy prefix, a UTC stamp and a
 * random suffix) and run the race-close sweep over it, which merges an append that
 * landed in the old folder before the rename. A rebuild or a sweep that fails is
 * reported and does not undo or stop the rest: the move stays done. A ledger larger
 * than LEDGER_RENDER_MAX_BYTES is not read: the rebuild is skipped with a note, the
 * rendered files stay as they are, and `rendered` is false. The size is read from the
 * file before anything is rendered, so a render never starts from a partial read.
 *
 * Rule: no step after a folder rename may throw before the locks are released at their
 * new path (locksAfter). In this function the rename of the old folder to its backup is
 * the last step that may throw. A step added after it must not throw, or must update
 * locksAfter.
 *
 * @param {{ root: string, oldDir: string, newDir: string, devflowDir: string, now: number }} ctx
 * @param {{ whole: boolean }} opts - whole: the folder itself was renamed, so there is no backup
 * @returns {{ notes: string[], rendered: boolean, backup: string|null }}
 * @throws when the backup rename fails
 */
function curationMoveFinish(ctx, { whole }) {
  const notes = [];
  let rendered = true;
  try {
    const ledger = lstatOrNull(path.join(ctx.newDir, LEDGER_NAME));
    if (ledger !== null && ledger.isFile() && ledger.size > LEDGER_RENDER_MAX_BYTES) {
      rendered = false;
      notes.push(`the rendered files were not rebuilt: ${LEDGER_NAME} is larger than ${LEDGER_RENDER_MAX_BYTES} bytes`);
    } else {
      renderAll(ctx.root, readJsonl(path.join(ctx.newDir, LEDGER_NAME)).rows, ctx.newDir);
    }
  } catch (err) {
    rendered = false;
    notes.push(`the rendered files could not be rebuilt (re-render failed: ${err && err.message})`);
  }
  if (whole) return { notes, rendered, backup: null };

  let backup = null;
  for (let attempt = 0; attempt < 5 && backup === null; attempt++) {
    const name = `${LEGACY_NAMES.backupPrefix}${uniqueTail(ctx.now)}`;
    if (lstatOrNull(path.join(ctx.devflowDir, name)) === null) backup = name;
  }
  if (backup === null) throw Object.assign(new Error('no free backup name'), { code: 'EEXIST' });
  const backupDir = path.join(ctx.devflowDir, backup);
  fs.renameSync(ctx.oldDir, backupDir);
  try {
    const swept = curationMoveSweepBackup(ctx, backupDir);
    notes.push(...swept.notes);
  } catch (err) {
    notes.push(`the backup sweep stopped (${err && err.code}: ${err && err.message}); the next init finishes it`);
  }
  return { notes, rendered, backup };
}

/**
 * Move a project's old ledger folder to the new name, once.
 *
 * The root must be a real ledger root (curationMoveRefusal). With no old folder the
 * answer is `none`, from two lstat calls, and nothing is locked, created or read; a
 * journal that is left in the machine directory is stale then, and the next store write
 * on the root removes it (moveJournalHoldsWriters).
 *
 * Right after the refusal checks, and before it makes, locks, reads or renames anything,
 * the pass asks whether git tracks any entry under either folder (checkTrackedAreas). If
 * it does, or if a `.git` entry stands and git does not answer, the answer is `skipped`
 * with the reason `tracked` or `unknown`, and nothing at all changes: the folders, the
 * machine directory and the journal stay as they are. With `unknown` the answer also
 * carries `cause`, one fixed word that says why git did not answer (UNKNOWN_CAUSES in
 * tracked-areas.cjs). A root with no `.git` entry makes no git call.
 *
 * Otherwise the machine directory is made if absent, and every lock the pass needs is
 * taken with no wait: the move lock, the old folder's store lock and queue lock, and,
 * when the new folder exists, its two. Any busy lock releases what was taken and answers
 * `busy`; a fresh claim in either folder answers `busy` with the reason `claim`. With
 * the new folder absent the whole folder is renamed (curationMoveWhole), unless the old
 * folder holds a file named like a journal (oldFolderNeedsEntryPath): then an empty new
 * folder is made and the pass takes the per-entry path. A pass that then answers busy,
 * or fails before it changes anything, removes that empty folder again. Errors (EXDEV,
 * EBUSY, EACCES, EROFS, any other I/O failure) answer an `io-error` Result and copy
 * nothing: the old folder stays whole.
 *
 * @param {unknown} root - the ledger root, an absolute path
 * @param {{ machineDir?: string, homeDir?: string, now?: number }} [options]
 *   machineDir: the machine root (default `$HOME/.devflow`); homeDir: the home directory
 *   (default `$HOME`); now: epoch ms (default Date.now())
 * Every message and note is one line with no control character (scrubMoveResult).
 *
 * @returns {{ ok: true, value: { state: 'none', notes: string[] }
 *   | { state: 'busy', reason?: 'claim', notes: string[] }
 *   | { state: 'skipped', reason: 'tracked'|'unknown', cause?: string, notes: string[] }
 *   | { state: 'moved', mode: 'whole-folder'|'kept-new'|'moved-in', backup: string|null, rendered: boolean, notes: string[] } }
 *   | { ok: false, error: { kind: 'refused'|'io-error', message: string } }}
 */
function moveLedger(root, options = {}) {
  return scrubMoveResult(moveLedgerUnscrubbed(root, options));
}

/**
 * True when `root` is an absolute path to a plain directory (two lstat calls: the root
 * itself, never a link) and holds no old ledger folder. It reads nothing else.
 *
 * @param {unknown} root
 * @returns {boolean}
 */
function oldFolderAbsent(root) {
  if (!isAbsoluteRoot(root)) return false;
  const resolved = path.resolve(root);
  const rootStat = lstatOrNull(resolved);
  if (rootStat === null || !rootStat.isDirectory()) return false;
  return lstatOrNull(path.join(resolved, DEVFLOW_DIR_NAME, LEGACY_NAMES.folder)) === null;
}

/**
 * The setup both ops share, before either reads or changes anything: the machine
 * directory, the checks on the ledger root (curationMoveRefusal) and the context the
 * pass runs on. The old and new folders are the two names the path helpers hold. An
 * unknown machine directory answers an `io-error`, a refused root a `refused`, and an
 * I/O failure in the checks an `io-error`, each starting with `opName`.
 *
 * The checks read the whole root (a real path, the folder's entries, a link check on
 * each), and a project that is already moved pays for them at every init. With
 * `stopIfOldFolderAbsent` set, a root that is a plain directory with no old folder
 * answers `value: null` from two lstat calls, before those checks run. A root that is
 * not an absolute path, is missing, is a link or is not a directory still goes through
 * them and is refused.
 *
 * @param {string} opName - the op, which starts every message
 * @param {unknown} root - the ledger root, an absolute path
 * @param {{ machineDir?: string, homeDir?: string, now?: number }} [options]
 * @param {{ stopIfOldFolderAbsent?: boolean }} [flags]
 * @returns {{ ok: true, value: { root: string, realRoot: string, devflowDir: string, oldDir: string,
 *   newDir: string, machineDir: string, journal: string, now: number } | null }
 *   | { ok: false, error: { kind: 'refused'|'io-error', message: string } }}
 */
function moveContext(opName, root, { machineDir, homeDir, now = Date.now() } = {}, { stopIfOldFolderAbsent = false } = {}) {
  const home = homeDir === undefined ? homeDirOrNull() : homeDir;
  const machine = machineDir === undefined ? (home === null ? null : path.join(home, '.devflow')) : machineDir;
  if (machine === null) {
    return { ok: false, error: { kind: 'io-error', message: `${opName}: no home directory is set, so the machine directory is unknown` } };
  }
  try {
    if (stopIfOldFolderAbsent && oldFolderAbsent(root)) return { ok: true, value: null };
    const refusal = curationMoveRefusal(opName, root, { machineDir: machine, homeDir: home });
    if (!refusal.ok) return refusal;
    const { realRoot } = refusal.value;
    const devflowDir = path.join(path.resolve(root), DEVFLOW_DIR_NAME);
    return {
      ok: true,
      value: {
        root: path.resolve(root), realRoot, devflowDir,
        oldDir: path.join(devflowDir, LEGACY_NAMES.folder), newDir: path.join(devflowDir, CURATION_DIR_NAME),
        machineDir: machine, journal: curationMoveJournalPath(machine, realRoot), now,
      },
    };
  } catch (err) {
    return moveIoFailure(opName, err);
  }
}

/** moveLedger before its messages and notes are made single-line. */
function moveLedgerUnscrubbed(root, options = {}) {
  const opened = moveContext(MOVE_OP, root, options, { stopIfOldFolderAbsent: true });
  if (!opened.ok) return opened;
  if (opened.value === null) return { ok: true, value: { state: 'none', notes: [] } };
  const ctx = opened.value;
  const { machineDir: machine, realRoot } = ctx;
  let madeNewDir = false;
  let result = null;
  try {
    if (lstatOrNull(ctx.oldDir) === null) return { ok: true, value: { state: 'none', notes: [] } };

    // Git's index decides, before this pass makes, locks, reads or renames anything.
    // The check runs before the move takes its locks, and every session start checks again.
    const tracking = inspectTrackedAreas(ctx.root);
    if (tracking.answer !== 'untracked') {
      const cause = tracking.cause === null ? {} : { cause: tracking.cause };
      return { ok: true, value: { state: 'skipped', reason: tracking.answer, ...cause, notes: [] } };
    }

    fs.mkdirSync(machine, { recursive: true, mode: 0o700 });
    let newExisted = lstatOrNull(ctx.newDir) !== null;
    if (!newExisted && oldFolderNeedsEntryPath(ctx)) {
      // The one rename of the whole-folder case would carry that file into the live folder.
      // An empty new folder puts the pass on the per-entry path, where the file stays in the
      // backup. The folder is made before the locks, so a pass that does not run (busy, or a
      // failure) takes it away again (finally below), and no empty live folder is left for a
      // store write to fill and so change which folder wins.
      madeNewDir = fs.mkdirSync(ctx.newDir, { recursive: true }) !== undefined;
      newExisted = true;
    }
    const specs = [
      { name: 'move', dir: curationMoveLockDir(machine, realRoot), staleMs: MOVE_LOCK_STALE_MS },
      { name: 'old-store', dir: path.join(ctx.oldDir, STORE_LOCK_NAME), staleMs: LOCK_STALE_MS },
      { name: 'old-queue', dir: path.join(ctx.oldDir, QUEUE_LOCK_NAME), staleMs: QUEUE_LOCK_STALE_MS },
      ...(newExisted ? [
        { name: 'new-store', dir: path.join(ctx.newDir, STORE_LOCK_NAME), staleMs: LOCK_STALE_MS },
        { name: 'new-queue', dir: path.join(ctx.newDir, QUEUE_LOCK_NAME), staleMs: QUEUE_LOCK_STALE_MS },
      ] : []),
    ];
    const taken = curationMoveLockAll(specs);
    if (taken.busy !== null) return { ok: true, value: { state: 'busy', notes: [] } };
    try {
      result = movePass(ctx, { newExisted });
      return result;
    } finally {
      curationMoveReleaseAll(locksAfter(taken.held, ctx, result));
    }
  } catch (err) {
    return moveIoFailure(MOVE_OP, err);
  } finally {
    if (madeNewDir && !(result !== null && result.ok && result.value.state === 'moved')) removeEmptyDir(ctx.newDir);
  }
}

/**
 * True when the old folder must not be renamed whole, because the one rename would carry
 * something into the live folder that must stay in the backup: a file named like a
 * journal (repository content, never read).
 *
 * @param {{ oldDir: string }} ctx
 * @returns {boolean}
 */
function oldFolderNeedsEntryPath(ctx) {
  return lstatOrNull(path.join(ctx.oldDir, OLD_FOLDER_JOURNAL_NAME)) !== null;
}

/** Remove `dir` when it is empty; any other outcome (it holds something, it is gone) leaves it, and nothing throws. */
function removeEmptyDir(dir) {
  try {
    fs.rmdirSync(dir);
  } catch {
    // A folder that holds an entry now is a live folder, and stays.
  }
}

/**
 * Where the locks a pass took are once the pass is over: a lock is released at the
 * path it has after the pass's last rename. A whole-folder move carries the old
 * folder's locks to the new folder; a merge turns the old folder into the backup and
 * carries them there. A pass that renamed nothing leaves them where they were.
 *
 * This holds only while no step after a folder rename throws: a throw leaves `result`
 * unset, and the locks are then released at the paths they had before the rename. A new
 * step after a rename must not throw, or must update this function.
 */
function locksAfter(held, ctx, result) {
  if (!result || !result.ok || result.value.state !== 'moved') return held;
  if (result.value.mode === 'whole-folder') return relocateLocks(held, ctx.oldDir, ctx.newDir);
  return relocateLocks(held, ctx.oldDir, path.join(ctx.devflowDir, result.value.backup));
}

/**
 * The body of a move, run under the locks. It re-probes both folders first: a folder
 * that changed since the locks were chosen makes the pass busy, to try again at the
 * next event, because a lock it does not hold would not protect it.
 *
 * With the new folder absent the whole folder is renamed. With it present: if its
 * observation log has data it wins and the old folder becomes the backup whole;
 * otherwise the old ledger set moves in (curationMoveSetWithJournal), and the old
 * folder becomes the backup with what is left. Only a machine-side journal of this very
 * old folder can override the winner rule: a journal planned for an old folder that has
 * been replaced is dropped first (curationMoveDropStaleJournal). Either way the pending
 * queue (and a stale claim's batch) merges into the winner's queue and the rendered
 * files are rebuilt. A fresh claim in either folder is busy too, with the reason `claim`: it can
 * last as long as CLAIM_STALE_SECS, so the caller may stop asking until its next session
 * start. A folder that changed is busy with no reason, and the next event asks again.
 *
 * @param {object} ctx
 * @param {{ newExisted: boolean }} state
 */
function movePass(ctx, { newExisted }) {
  if (lstatOrNull(ctx.oldDir) === null) return { ok: true, value: { state: 'none', notes: [] } };
  if ((lstatOrNull(ctx.newDir) !== null) !== newExisted) return { ok: true, value: { state: 'busy', notes: [] } };
  if (claimIsFresh(path.join(ctx.oldDir, CLAIM_NAME), ctx.now) || (newExisted && claimIsFresh(path.join(ctx.newDir, CLAIM_NAME), ctx.now))) {
    return { ok: true, value: { state: 'busy', reason: 'claim', notes: [] } };
  }
  if (!newExisted) {
    const whole = curationMoveWhole(ctx);
    if (!whole.ok) return whole;
    const journalNotes = curationMoveDropJournal(ctx);
    const finish = curationMoveFinish(ctx, { whole: true });
    return {
      ok: true,
      value: { state: 'moved', mode: 'whole-folder', backup: null, rendered: finish.rendered, notes: [...whole.value.notes, ...journalNotes, ...finish.notes] },
    };
  }

  const notes = curationMoveDropStaleJournal(ctx);
  const journalPresent = lstatOrNull(ctx.journal) !== null;
  const keptNew = !journalPresent && newFolderHasData(ctx);
  if (!keptNew) notes.push(...curationMoveSetWithJournal(ctx).notes);
  notes.push(...curationMoveEntries(ctx).notes);

  const staleClaim = lstatOrNull(path.join(ctx.oldDir, CLAIM_NAME)) !== null;
  const merged = curationMoveMergeQueue(ctx, {
    dir: ctx.oldDir, targetDir: ctx.newDir, bases: staleClaim ? [CLAIM_NAME, QUEUE_NAME] : [QUEUE_NAME],
  });
  if (staleClaim) removeIfPresent(path.join(ctx.oldDir, OWNER_NAME));
  notes.push(...merged.notes);

  const finish = curationMoveFinish(ctx, { whole: false });
  const verdict = keptNew
    ? `kept ${path.basename(ctx.newDir)}, whose log has data; ${path.basename(ctx.oldDir)} is now ${finish.backup}`
    : `moved the ledger set of ${path.basename(ctx.oldDir)} into ${path.basename(ctx.newDir)}; ${path.basename(ctx.oldDir)} is now ${finish.backup}`;
  return {
    ok: true,
    value: {
      state: 'moved',
      mode: keptNew ? 'kept-new' : 'moved-in',
      backup: finish.backup,
      rendered: finish.rendered,
      notes: [verdict, ...notes, ...finish.notes],
    },
  };
}

/**
 * After a whole-folder rename, remove the machine-side journal an earlier pass left: one
 * rename carried the whole set, so the journal has nothing to finish. It never throws,
 * because the folder is already renamed and a throw would release the locks at their old
 * paths (locksAfter). A journal that stays is stale, because its old folder is gone, and
 * the next store write drops it.
 *
 * @param {{ journal: string }} ctx
 * @returns {string[]} one note when the journal could not be removed, else none
 */
function curationMoveDropJournal(ctx) {
  try {
    removeIfPresent(ctx.journal);
    return [];
  } catch (err) {
    return [`the move journal could not be removed (${err && err.code}: ${err && err.message}); the next store write drops it`];
  }
}

/** True when `file` is a regular file written to within CLAIM_STALE_SECS before `now`: a live claim. */
function claimIsFresh(file, now) {
  const stat = lstatOrNull(file);
  return stat !== null && stat.isFile() && now - stat.mtimeMs < CLAIM_STALE_SECS * 1000;
}

/**
 * Merge what is left in the backup folders a move left behind into the new folder's
 * pending queue: init runs it once per project per run, whenever a backup exists. A
 * backup is `<legacy prefix><stamp>-<random>` under `.devflow`. The sweep takes the
 * move lock and the new folder's queue lock with no wait (busy answers `busy`), merges
 * the pending and processing files, and the unswept private and overflow files, of
 * each backup by the queue rule, and marks each merged file swept. A merged file is
 * never read again, so a repeated sweep adds nothing. A backup that holds nothing to
 * merge is passed over before the limit of MOVE_MAX_BACKUPS backups per pass applies,
 * and the pass looks into at most MOVE_MAX_BACKUPS_SCANNED backups. With the new
 * folder absent or no backup it answers `none`.
 *
 * Before it makes, locks or merges anything, the sweep asks the same question the move
 * asks (checkTrackedAreas), which covers the backup folders too. If git tracks any
 * entry under a data folder or a backup folder, or if a `.git` entry stands and git
 * does not answer, the answer is `skipped` with the reason `tracked` or `unknown` and
 * zero counts, and nothing changes: the folders, the machine directory and the locks
 * stay as they are. A root with no `.git` entry makes no git call, and neither does a
 * pass that finds nothing to merge.
 *
 * @param {unknown} root - the ledger root, an absolute path
 * @param {{ machineDir?: string, homeDir?: string, now?: number }} [options]
 * Every message and note is one line with no control character (scrubMoveResult).
 *
 * @returns {{ ok: true, value: { state: 'none'|'busy'|'swept', files: number, merged: number, overflowed: number, notes: string[] }
 *   | { state: 'skipped', reason: 'tracked'|'unknown', files: number, merged: number, overflowed: number, notes: string[] } }
 *   | { ok: false, error: { kind: 'refused'|'io-error', message: string } }}
 */
function sweepLedgerBackups(root, options = {}) {
  return scrubMoveResult(sweepLedgerBackupsUnscrubbed(root, options));
}

/** sweepLedgerBackups before its messages and notes are made single-line. */
function sweepLedgerBackupsUnscrubbed(root, options = {}) {
  const idle = (state, extra = {}) => ({ ok: true, value: { state, ...extra, files: 0, merged: 0, overflowed: 0, notes: [] } });
  const opened = moveContext(SWEEP_OP, root, options);
  if (!opened.ok) return opened;
  const ctx = opened.value;
  const { devflowDir } = ctx;
  try {
    if (lstatOrNull(ctx.newDir) === null) return idle('none');
    const backups = backupsHoldingRows(devflowDir).slice(0, MOVE_MAX_BACKUPS);
    if (backups.length === 0) return idle('none');

    // Git's index decides, before this pass makes a folder, takes a lock or merges a row.
    // The check runs before the sweep takes its locks, and each later run checks again.
    const tracking = checkTrackedAreas(ctx.root);
    if (tracking !== 'untracked') return idle('skipped', { reason: tracking });

    for (const name of backups) {
      const problem = backupProblem(path.join(devflowDir, name));
      if (problem !== null) return moveRefused(SWEEP_OP, problem);
    }

    fs.mkdirSync(ctx.machineDir, { recursive: true, mode: 0o700 });
    const taken = curationMoveLockAll([
      { name: 'move', dir: curationMoveLockDir(ctx.machineDir, ctx.realRoot), staleMs: MOVE_LOCK_STALE_MS },
      { name: 'new-queue', dir: path.join(ctx.newDir, QUEUE_LOCK_NAME), staleMs: QUEUE_LOCK_STALE_MS },
    ]);
    if (taken.busy !== null) return idle('busy');
    try {
      const total = { state: 'swept', files: 0, merged: 0, overflowed: 0, notes: [] };
      for (const name of backups) {
        const swept = curationMoveSweepBackup(ctx, path.join(devflowDir, name));
        total.files += swept.files;
        total.merged += swept.merged;
        total.overflowed += swept.overflowed;
        total.notes.push(...swept.notes);
      }
      return { ok: true, value: total };
    } finally {
      curationMoveReleaseAll(taken.held);
    }
  } catch (err) {
    return moveIoFailure(SWEEP_OP, err);
  }
}

/** The names of the backup folders under `devflowDir`, oldest first (the stamp sorts by time). */
function backupNames(devflowDir) {
  return fs.readdirSync(devflowDir).filter(name => name.startsWith(LEGACY_NAMES.backupPrefix)).sort();
}

/**
 * The backups the sweep and the drain look into: of the first MOVE_MAX_BACKUPS_SCANNED
 * backup folders, in name order, those that may hold rows (backupMayHoldRows).
 */
function backupsHoldingRows(devflowDir) {
  return backupNames(devflowDir).slice(0, MOVE_MAX_BACKUPS_SCANNED)
    .filter(name => backupMayHoldRows(path.join(devflowDir, name)));
}

/**
 * True unless `dir` is a backup folder with nothing for the sweep to merge: a folder
 * that holds no pending, processing, private or overflow file (a swept file counts for
 * nothing) is skipped before the per-pass limit applies, so a backup past the limit
 * is reached once the older ones are done. Anything that is not a plain folder is kept,
 * so that backupProblem refuses it as before; a folder that has gone is skipped.
 */
function backupMayHoldRows(dir) {
  const stat = lstatOrNull(dir);
  if (stat === null) return false;
  if (!stat.isDirectory()) return true;
  return fs.readdirSync(dir).some(holdsPendingRows);
}

/** What is wrong with a backup folder the sweep would read, or null: a link, or a link among its queue files. */
function backupProblem(dir) {
  const stat = lstatOrNull(dir);
  if (stat === null) return null;
  if (stat.isSymbolicLink()) return `${dir} is a symbolic link`;
  if (!stat.isDirectory()) return `${dir} is not a directory`;
  for (const entry of fs.readdirSync(dir)) {
    const cls = moveEntryClass(entry);
    if (cls === ENTRY.QUEUE || cls === ENTRY.QUEUE_FORM) {
      const problem = moveEntryProblem(path.join(dir, entry));
      if (problem !== null) return problem;
    }
  }
  return null;
}

/** True for the names in a backup folder that hold rows a later sweep would still merge. */
function holdsPendingRows(name) {
  if (moveEntryClass(name) === ENTRY.QUEUE) return true;
  const record = queueFormOf(name);
  return record !== null && (record.form === 'private' || record.form === 'overflow');
}

/**
 * The names of the files of the plain folder `dir` that hold rows a later sweep would
 * still merge (holdsPendingRows), in name order, at most MOVE_MAX_QUEUE_FILES of them:
 * the files the status count reads and the drain removes.
 */
function pendingFilesOf(dir) {
  return fs.readdirSync(dir).filter(holdsPendingRows).sort().slice(0, MOVE_MAX_QUEUE_FILES);
}

/**
 * The rows a backup folder still holds for a later sweep: the non-blank lines of the files
 * holdsPendingRows names, at most MOVE_MAX_QUEUE_FILES of them. Null for a path that is
 * not a plain folder (a link, a file or nothing), which is never read.
 *
 * @param {string} dir
 * @returns {number|null}
 */
function pendingRowsOf(dir) {
  const stat = lstatOrNull(dir);
  if (stat === null || !stat.isDirectory()) return null;
  let pendingRows = 0;
  for (const file of pendingFilesOf(dir)) {
    const text = readQueueText(path.join(dir, file));
    if (text !== null) pendingRows += completeLines(text).length;
  }
  return pendingRows;
}

/**
 * Count the rows still waiting in the backup folders a move left, for the status
 * command: per backup, the non-blank lines of the pending and processing files and of
 * the unswept private and overflow files (an unfinished last line counts, because the
 * sweep has not merged it). A swept file counts for nothing. Read-only: no lock is
 * taken and nothing is written, no link is followed (a backup that is a link, and a
 * queue file that is a link, read as absent), and the read is bounded by the sweep's
 * limits on backup folders and on queue files per folder. A backup's `name` is for
 * display: its control characters are collapsed to a space (singleLine), so it may differ
 * from the folder's own name.
 *
 * The first MOVE_MAX_BACKUPS backups, in name order, are listed. Those after them, up to
 * the MOVE_MAX_BACKUPS_SCANNED-th, are read and counted in `beyondLimit`: `backups` is how
 * many there are and `pendingRows` the rows they hold in all, so the two describe one set.
 * A backup past the MOVE_MAX_BACKUPS_SCANNED-th is not read, and no sweep or drain
 * reaches it: `beyondLimit.unread` counts those by name only, so none is left out of
 * the account.
 *
 * @param {unknown} root - the ledger root, an absolute path
 * @returns {{ ok: true, value: { backups: Array<{ name: string, pendingRows: number }>,
 *   beyondLimit: { backups: number, pendingRows: number, unread: number } } }
 *   | { ok: false, error: { kind: 'refused'|'io-error', message: string } }}
 */
function backupPendingRows(root) {
  if (!isAbsoluteRoot(root)) {
    return { ok: false, error: { kind: 'refused', message: `${ROWS_OP}: the ledger root must be an absolute path` } };
  }
  try {
    const devflowDir = path.join(path.resolve(root), '.devflow');
    const devflowStat = lstatOrNull(devflowDir);
    if (devflowStat === null || !devflowStat.isDirectory()) return { ok: true, value: { backups: [], beyondLimit: { backups: 0, pendingRows: 0, unread: 0 } } };
    const names = backupNames(devflowDir);
    const backups = [];
    for (const name of names.slice(0, MOVE_MAX_BACKUPS)) {
      const rows = pendingRowsOf(path.join(devflowDir, name));
      if (rows !== null) backups.push({ name: singleLine(name), pendingRows: rows });
    }
    const beyond = names.slice(MOVE_MAX_BACKUPS, MOVE_MAX_BACKUPS_SCANNED);
    let beyondRows = 0;
    for (const name of beyond) beyondRows += pendingRowsOf(path.join(devflowDir, name)) || 0;
    const unread = Math.max(0, names.length - MOVE_MAX_BACKUPS_SCANNED);
    return { ok: true, value: { backups, beyondLimit: { backups: beyond.length, pendingRows: beyondRows, unread } } };
  } catch (err) {
    return scrubMoveResult(moveIoFailure(ROWS_OP, err));
  }
}

/**
 * The first symbolic link a drain of the backup `dir` would act through: the folder
 * itself, or one of its queue files (the entries backupProblem link-checks). Null when
 * there is none, and for a path that is no folder: it holds no queue file.
 */
function backupLinkedPath(dir) {
  const stat = lstatOrNull(dir);
  if (stat === null) return null;
  if (stat.isSymbolicLink()) return dir;
  if (!stat.isDirectory()) return null;
  for (const entry of fs.readdirSync(dir)) {
    const cls = moveEntryClass(entry);
    if ((cls === ENTRY.QUEUE || cls === ENTRY.QUEUE_FORM) && moveEntryProblem(path.join(dir, entry)) !== null) {
      return path.join(dir, entry);
    }
  }
  return null;
}

/**
 * The queue files the backup folders still hold, for the drain a disable runs: the
 * files backupPendingRows counts (holdsPendingRows), as absolute paths, never a swept
 * file, the claim's owner file or a ledger file. Read-only: it takes no lock and writes
 * nothing. It is bounded by the sweep's limits: at most MOVE_MAX_BACKUPS_SCANNED backup
 * folders, and MOVE_MAX_QUEUE_FILES files in each. The caller deletes.
 *
 * Refused, naming the path in `error.path`, when a backup folder that may hold rows is
 * a symbolic link or has a link among its queue files (the sweep's own refusal): the
 * answer then lists no file at all, so a caller that deletes what it is told deletes
 * nothing. A path that is no folder holds no file and is passed over.
 *
 * @param {unknown} root - the ledger root, an absolute path
 * @returns {{ ok: true, value: { files: string[] } }
 *   | { ok: false, error: { kind: 'refused'|'io-error', message: string, path?: string } }}
 */
function backupQueueFiles(root) {
  if (!isAbsoluteRoot(root)) return moveRefused(QUEUE_FILES_OP, 'the ledger root must be an absolute path');
  try {
    const devflowDir = path.join(path.resolve(root), '.devflow');
    const devflowStat = lstatOrNull(devflowDir);
    if (devflowStat === null || !devflowStat.isDirectory()) return { ok: true, value: { files: [] } };
    const dirs = backupsHoldingRows(devflowDir).map(name => path.join(devflowDir, name));
    for (const dir of dirs) {
      const linked = backupLinkedPath(dir);
      if (linked !== null) {
        const refused = moveRefused(QUEUE_FILES_OP, `${linked} is a symbolic link`);
        return scrubMoveResult({ ok: false, error: { ...refused.error, path: singleLine(linked) } });
      }
    }
    const files = [];
    for (const dir of dirs) {
      const stat = lstatOrNull(dir);
      if (stat === null || !stat.isDirectory()) continue;
      for (const file of pendingFilesOf(dir)) files.push(path.join(dir, file));
    }
    return { ok: true, value: { files } };
  } catch (err) {
    return scrubMoveResult(moveIoFailure(QUEUE_FILES_OP, err));
  }
}

module.exports = {
  moveLedger,
  QUEUE_MERGE_CAP_LINES,
  curationMoveRefusal,
  curationMoveLockAll,
  curationMoveReleaseAll,
  curationMoveWhole,
  curationMoveSetWithJournal,
  curationMoveEntries,
  curationMoveMergeQueue,
  curationMoveFinish,
  curationMoveSweepBackup,
  moveEntryClass,
  isLinkChecked,
  MOVE_ENTRY_CLASSES,
  sweepLedgerBackups,
  backupPendingRows,
  backupQueueFiles,
};

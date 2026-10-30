/**
 * A set of file paths relative to the Claude dir, with `/` separators, and the question the
 * install-backup scan asks of it. `files` holds file paths only. `holds` is true for a path in the
 * set and for every folder that has a path of the set below it.
 *
 * Pure module: the shipped set and the retired set are built from it in `core/` and in the
 * Claude target, and the backup session reads both.
 */
export interface PathSet {
  readonly files: ReadonlySet<string>;
  holds(folder: string): boolean;
}

/** What the current release ships. A name in this set is never moved and never counted as retired. */
export type ShippedSet = PathSet;

/** What an earlier release shipped and the current one does not. A file in this set is removed and named. */
export type RetiredSet = PathSet;

/** Build a {@link PathSet} from file paths: the folder prefixes are computed once. */
export function createPathSet(files: Iterable<string>): PathSet {
  const all = new Set<string>(files);
  const folders = new Set<string>();
  for (const file of all) {
    for (let cut = file.indexOf('/'); cut !== -1; cut = file.indexOf('/', cut + 1)) {
      folders.add(file.slice(0, cut));
    }
  }
  return Object.freeze({
    files: all,
    holds: (folder: string): boolean => all.has(folder) || folders.has(folder),
  });
}

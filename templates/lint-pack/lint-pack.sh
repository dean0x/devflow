#!/usr/bin/env bash
#
# lint-pack.sh: a project-owned lint pack. Copy it into your repository (for
# example as scripts/lint-pack.sh) and wire it to a `lint-pack` build-file entry.
# devflow ships this template. It never runs the template itself, and it never
# installs or updates your copy. At the `lean` gate level, Validate runs your
# wired copy. The README is templates/lint-pack/README.md in devflow-kit.
#
# Usage:  bash scripts/lint-pack.sh <base-sha>
#
#   <base-sha>  a full 40-digit lower-case commit id that is an ancestor of HEAD.
#
# It reads the committed change <base-sha>..HEAD and the config blob that
# `.lint-pack.conf` holds at HEAD (data only: it is never sourced and never
# evaluated). Three checks are off until the config enables them:
#
#   stale-symbol   a symbol the branch removed from the source globs, that is on
#                  no added line in the source globs and in no tracked file
#                  outside the doc and help globs, but that a doc or help line
#                  at HEAD still names
#   plan-id        configured POSIX ERE patterns (plan IDs, tombstone phrases)
#                  that match as whole words on added lines
#   function-size  diagnostics of a configured linter that fall inside added hunks
#
# Output (stdout only; stderr stays empty):
#
#   <check-id> <path>:<line> <id>      one record per match, sorted, at most 50
#   +<k> more                          records beyond the first 50
#   pack-changed <path>                a pack file the branch changed; these lines
#                                      also print before an error line
#   pack-dirty <path>                  a pack file that differs from HEAD in the work
#                                      tree or the index, or that is untracked; these
#                                      lines print after the pack-changed lines, and
#                                      also before an error line
#   skipped-binary <path>              at most 10, then +<k> more
#   symbol-cap <n> | unsafe-tokens <n> | unmatched-diagnostics <n>
#   dropped-long-lines <n>             counts, printed only when not zero
#   base <sha>                         the commit the run compared: the line just before
#                                      the LINT_PACK line, on every run that got past the
#                                      base checks, an error exit included
#   LINT_PACK: clean | no-config       exit 0
#   LINT_PACK: matches <n>             exit 1
#   LINT_PACK: error <reason>          exit 2
#
# Error reasons: usage, git-too-old, not-a-repo, bad-base, base-not-ancestor,
# bad-config <n>, bad-pattern <id>, git-failed, interrupted, linter-missing,
# linter-exit <n>.
#
# bad-config    <n> is the line number in the config; 0 means that .lint-pack.conf
#               at HEAD is not a regular file (for example a symlink or a directory)
# git-too-old   git is older than 2.30; a version string that cannot be read is
#               git-failed
# interrupted   the run got SIGTERM or SIGINT, for example from a timeout
# linter-exit   the linter exited with a status outside the accepted set, or with
#               any non-zero status and no "<path>:<line>:" line in its output
#
# The pack files are the config, this script, any .gitattributes, and the build
# files package.json, Makefile, makefile and GNUmakefile (GNU make reads the last
# two before Makefile). A build file counts only when a changed line names
# lint-pack or BASE; for pack-dirty, an untracked build file counts too.
#
# Needs bash 3.2 or newer and git 2.30 or newer. No line of added text is ever
# printed. The last line is always the LINT_PACK line.

set -u -o pipefail

LC_ALL=C
export LC_ALL
unset GIT_LITERAL_PATHSPECS GIT_NOGLOB_PATHSPECS GIT_GLOB_PATHSPECS GIT_ICASE_PATHSPECS
# GIT_DIFF_OPTS overrides -U0 and would add context lines to the diff.
unset GIT_DIFF_OPTS
unset GREP_OPTIONS GREP_COLOR GREP_COLORS
# A set CDPATH makes a relative cd print the directory it chose.
unset CDPATH

# Fixed bounds: every loop below runs over a file, an array or one of these.
MAX_CONF_LINES=1000
MAX_RECORDS=50
MAX_SYMBOLS=500
MAX_BINARY=10
MIN_GIT_MAJOR=2
MIN_GIT_MINOR=30

TAB=$(printf '\t')
KEY_RE='^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$'
ID_RE='^[a-z0-9-]{1,32}$'
BASE_RE='^[0-9a-f]{40}$'
BLANK_RE='^[[:space:]]*$'
NUM_RE='^[0-9]{1,3}$'
BAD_ESCAPE_RE='\\[A-Za-z0-9<>]'
GIT_VERSION_RE='^([0-9]+)\.([0-9]+)'
DIAGNOSTIC_RE='^.+:[0-9]+:'

# Every git call: no pager, and quoted paths in git's C-quoted form.
g() { command git --no-pager -c core.quotePath=true "$@"; }
DIFF_PINS=(--no-ext-diff --no-textconv --no-color --no-relative --src-prefix=a/ --dst-prefix=b/
  --diff-algorithm=myers --inter-hunk-context=0 --indent-heuristic)
# The build files that run the pack, and the changed lines in them that count.
BUILD_FILES=(package.json Makefile makefile GNUmakefile)
BUILD_LINE_RE='lint-pack|BASE'
# A submodule file is not a tracked file of this repository: never search it.
GREP_PINS=(--no-color --no-column --full-name --no-recurse-submodules)

TMP=''
DONE=0
ROOT=''
BASE=''
SELF_ABS=''
SELF_REL=''
BASE_OK=0
FLAGS=''
PC_READY=0
SEEN=' '
ANY_ENABLED=0

STALE_ENABLED=false
STALE_LINE=0
STALE_SOURCE=()
STALE_DOC=()
STALE_HELP=()
STALE_SYMBOL=()
STALE_ALLOW=()
STALE_MIN=6
IDS_ENABLED=false
IDS_LINE=0
IDS_ID=()
IDS_RE=()
IDS_ALLOW=()
SIZE_ENABLED=false
SIZE_LINE=0
SIZE_ARG=()
SIZE_OK=()
SIZE_ALLOW=()
SIZE_MATCH=''

SYMBOL_CAP_N=0
UNSAFE_N=0
UNMATCHED_N=0
DROPPED_N=0

# ---- Exit handling ----

# The pack-changed and pack-dirty lines, once they are built. An error exit prints
# them too, so a branch that breaks its own pack still shows that it changed it.
report_pack_lines() {
  if [ "$PC_READY" = 1 ]; then
    PC_READY=0
    cat "$TMP/pc.out" 2>/dev/null
  fi
  return 0
}

# The base the run compared, once the base checks have passed. It is the line just
# before the result line, an error result included.
report_base() {
  if [ "$BASE_OK" = 1 ]; then printf 'base %s\n' "$BASE"; fi
  return 0
}

# One error, one reason from the closed set. Only the pack lines and the base line
# come before it on stdout.
die_error() {
  report_pack_lines
  report_base
  printf 'LINT_PACK: error %s\n' "$1"
  DONE=1
  exit 2
}

# Remove the temp dir. A run that ends without its result line is a git-failed.
on_exit() {
  local rc=$?
  if [ "$DONE" != 1 ]; then
    report_pack_lines
    report_base
    printf 'LINT_PACK: error git-failed\n'
    rc=2
  fi
  if [ -n "$TMP" ]; then rm -rf "$TMP"; fi
  exit "$rc"
}
trap on_exit EXIT

# A timeout wrapper ends a run with SIGTERM, a user with SIGINT: say so, and let
# the exit trap remove the temp dir. Further signals are ignored meanwhile.
on_signal() {
  trap '' TERM INT
  die_error interrupted
}
trap on_signal TERM INT

# ---- Small helpers ----

# Print the line count of a file without wc's padding.
count_lines() {
  local n
  n=$(wc -l <"$1") || return 1
  printf '%s' "${n//[[:space:]]/}"
}

# Keep the lines of $1 that are at most 200 bytes in $2; count the others.
bound_lines() {
  local rc k
  command grep -a -E -v -e '^.{201}' "$1" >"$2"
  rc=$?
  [ "$rc" -le 1 ] || die_error git-failed
  k=$(command grep -a -c -E -e '^.{201}' "$1")
  rc=$?
  [ "$rc" -le 1 ] || die_error git-failed
  DROPPED_N=$((DROPPED_N + k))
}

# ---- Config (data, one key=value per line) ----

cfg_fail() { die_error "bad-config $1"; }

# A scalar key may appear once.
cfg_once() {
  case "$SEEN" in *" $1 "*) cfg_fail "$2" ;; esac
  SEEN="$SEEN$1 "
}

cfg_bool() {
  case "$1" in true | false) ;; *) cfg_fail "$2" ;; esac
}

cfg_value() {
  [ -n "$1" ] || cfg_fail "$2"
}

# A whole number of at most three digits that is not above $3.
cfg_number() {
  [[ $1 =~ $NUM_RE ]] || cfg_fail "$2"
  [ $((10#$1)) -le "$3" ] || cfg_fail "$2"
}

read_config() {
  local line n=0 key val id pat
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    [ "$n" -le "$MAX_CONF_LINES" ] || cfg_fail "$n"
    line=${line%$'\r'}
    case "$line" in '' | '#'*) continue ;; esac
    if [[ $line =~ $BLANK_RE ]]; then continue; fi
    case "$line" in *=*) ;; *) cfg_fail "$n" ;; esac
    key=${line%%=*}
    val=${line#*=}
    [[ $key =~ $KEY_RE ]] || cfg_fail "$n"
    case "$key" in
      stale.enabled)
        cfg_once "$key" "$n"; cfg_bool "$val" "$n"
        STALE_ENABLED=$val; STALE_LINE=$n ;;
      stale.source)
        cfg_value "$val" "$n"; STALE_SOURCE[${#STALE_SOURCE[@]}]=$val ;;
      stale.doc)
        cfg_value "$val" "$n"; STALE_DOC[${#STALE_DOC[@]}]=$val ;;
      stale.help)
        cfg_value "$val" "$n"; STALE_HELP[${#STALE_HELP[@]}]=$val ;;
      stale.symbol)
        cfg_value "$val" "$n"; STALE_SYMBOL[${#STALE_SYMBOL[@]}]=$val ;;
      stale.min-length)
        cfg_once "$key" "$n"; cfg_number "$val" "$n" 64
        [ $((10#$val)) -ge 1 ] || cfg_fail "$n"
        STALE_MIN=$((10#$val)) ;;
      stale.allow)
        cfg_value "$val" "$n"; STALE_ALLOW[${#STALE_ALLOW[@]}]=$val ;;
      ids.enabled)
        cfg_once "$key" "$n"; cfg_bool "$val" "$n"
        IDS_ENABLED=$val; IDS_LINE=$n ;;
      ids.pattern)
        case "$val" in *' '*) ;; *) cfg_fail "$n" ;; esac
        id=${val%% *}
        pat=${val#* }
        [[ $id =~ $ID_RE ]] || cfg_fail "$n"
        [[ $pat =~ $BLANK_RE ]] && cfg_fail "$n"
        IDS_ID[${#IDS_ID[@]}]=$id
        IDS_RE[${#IDS_RE[@]}]=$pat ;;
      ids.allow)
        cfg_value "$val" "$n"; IDS_ALLOW[${#IDS_ALLOW[@]}]=$val ;;
      size.enabled)
        cfg_once "$key" "$n"; cfg_bool "$val" "$n"
        SIZE_ENABLED=$val; SIZE_LINE=$n ;;
      size.arg)
        cfg_value "$val" "$n"; SIZE_ARG[${#SIZE_ARG[@]}]=$val ;;
      size.match)
        cfg_once "$key" "$n"; cfg_value "$val" "$n"
        SIZE_MATCH=$val ;;
      size.ok-exit)
        cfg_number "$val" "$n" 255
        SIZE_OK[${#SIZE_OK[@]}]=$((10#$val)) ;;
      size.allow)
        cfg_value "$val" "$n"; SIZE_ALLOW[${#SIZE_ALLOW[@]}]=$val ;;
      *) cfg_fail "$n" ;;
    esac
  done <"$TMP/conf"
}

# An enabled check needs its keys; a disabled check is ignored whole.
finish_config() {
  if [ "$STALE_ENABLED" = true ]; then
    [ "${#STALE_SOURCE[@]}" -gt 0 ] && [ "${#STALE_SYMBOL[@]}" -gt 0 ] || cfg_fail "$STALE_LINE"
    ANY_ENABLED=1
  else
    STALE_SOURCE=(); STALE_DOC=(); STALE_HELP=(); STALE_SYMBOL=(); STALE_ALLOW=()
  fi
  if [ "$IDS_ENABLED" = true ]; then
    [ "${#IDS_ID[@]}" -gt 0 ] || cfg_fail "$IDS_LINE"
    ANY_ENABLED=1
  else
    IDS_ID=(); IDS_RE=(); IDS_ALLOW=()
  fi
  if [ "$SIZE_ENABLED" = true ]; then
    [ "${#SIZE_ARG[@]}" -gt 0 ] || cfg_fail "$SIZE_LINE"
    ANY_ENABLED=1
  else
    SIZE_ARG=(); SIZE_OK=(); SIZE_ALLOW=(); SIZE_MATCH=''
  fi
  if [ "${#STALE_DOC[@]}" -eq 0 ]; then STALE_DOC[0]='*.md'; fi
  if [ "${#SIZE_OK[@]}" -eq 0 ]; then SIZE_OK[0]=0; SIZE_OK[1]=1; fi
}

# The whole-word wrapper of a plan-ID pattern.
wrap_pattern() {
  printf '%s' "(^|[^A-Za-z0-9_])($1)([^A-Za-z0-9_]|\$)"
}

# POSIX ERE only: no \d \w \s \b, no back-reference, no regex the grep engine
# rejects, no pattern that matches the empty string. $3 is 1 for a wrapped one.
validate_pattern() {
  local rc
  if [[ $2 =~ $BAD_ESCAPE_RE ]]; then die_error "bad-pattern $1"; fi
  command grep -a -E -e "($2)" </dev/null >/dev/null 2>&1
  rc=$?
  [ "$rc" -le 1 ] || die_error "bad-pattern $1"
  if [ "$3" = 1 ]; then
    command grep -a -E -e "$(wrap_pattern "$2")" </dev/null >/dev/null 2>&1
    rc=$?
    [ "$rc" -le 1 ] || die_error "bad-pattern $1"
  fi
  command grep -a -E -e "^($2)\$" <<<'' >/dev/null 2>&1
  rc=$?
  [ "$rc" -eq 1 ] || die_error "bad-pattern $1"
}

validate_patterns() {
  local i p
  for p in ${STALE_SYMBOL[@]+"${STALE_SYMBOL[@]}"}; do
    validate_pattern stale-symbol "$p" 0
  done
  i=0
  while [ "$i" -lt "${#IDS_ID[@]}" ]; do
    validate_pattern "${IDS_ID[$i]}" "${IDS_RE[$i]}" 1
    i=$((i + 1))
  done
  if [ -n "$SIZE_MATCH" ]; then validate_pattern size-match "$SIZE_MATCH" 0; fi
}

# ---- Paths and flags ----

# Path of this script, resolved before the first cd.
resolve_self() {
  local dir
  dir=$(cd "$(dirname -- "$0")" 2>/dev/null && pwd -P) || return 0
  SELF_ABS="$dir/$(basename -- "$0")"
}

# Does raw path $1 match any of the globs after it? A glob is a shell glob in
# which * also matches /. The pattern is data: case never runs it.
glob_match() {
  local path=$1 glob
  shift
  for glob in "$@"; do
    case "$path" in $glob) return 0 ;; esac
  done
  return 1
}

# FLAGS for raw path $1: = then one letter per property.
#   O own file of the pack     P pack-changed by itself     S stale source
#   D doc or help glob         A stale allow  B ids allow   C size allow
classify_path() {
  FLAGS='='
  if [ "$1" = '.lint-pack.conf' ]; then FLAGS="${FLAGS}OP"; fi
  if [ -n "$SELF_REL" ] && [ "$1" = "$SELF_REL" ]; then FLAGS="${FLAGS}OP"; fi
  case "$1" in .gitattributes | */.gitattributes) FLAGS="${FLAGS}P" ;; esac
  if glob_match "$1" ${STALE_SOURCE[@]+"${STALE_SOURCE[@]}"}; then FLAGS="${FLAGS}S"; fi
  if glob_match "$1" ${STALE_DOC[@]+"${STALE_DOC[@]}"} ${STALE_HELP[@]+"${STALE_HELP[@]}"}; then FLAGS="${FLAGS}D"; fi
  if glob_match "$1" ${STALE_ALLOW[@]+"${STALE_ALLOW[@]}"}; then FLAGS="${FLAGS}A"; fi
  if glob_match "$1" ${IDS_ALLOW[@]+"${IDS_ALLOW[@]}"}; then FLAGS="${FLAGS}B"; fi
  if glob_match "$1" ${SIZE_ALLOW[@]+"${SIZE_ALLOW[@]}"}; then FLAGS="${FLAGS}C"; fi
  return 0
}

# Join a quoted listing ($1, one path per line) with the same listing made with
# -z ($2, raw paths): line n of one is entry n of the other. Writes a map of
# quoted path, raw path, flags (tab separated) to $3. $4 is 1 to drop the
# "HEAD:" prefix that git grep adds.
build_map() {
  local q r rq
  : >"$3"
  exec 3<"$1" 4<"$2" 5>>"$3"
  while IFS= read -r q <&3; do
    IFS= read -r -d '' r <&4 || die_error git-failed
    if [ "$4" = 1 ]; then q=${q#HEAD:}; r=${r#HEAD:}; fi
    classify_path "$r"
    rq=$r
    case "$rq" in *"$TAB"* | *$'\n'*) rq='' ;; esac
    printf '%s\t%s\t%s\n' "$q" "$rq" "$FLAGS" >&5
  done
  if IFS= read -r -d '' r <&4; then die_error git-failed; fi
  exec 3<&- 4<&- 5>&-
}

# ---- Diffs ----

# Every changed path, old and new side of a rename included, with its flags.
build_diffmap() {
  g diff "${DIFF_PINS[@]}" --no-renames --name-only --end-of-options "$BASE" HEAD -- \
    >"$TMP/dm.q" 2>/dev/null || die_error git-failed
  g diff "${DIFF_PINS[@]}" --no-renames --name-only -z --end-of-options "$BASE" HEAD -- \
    >"$TMP/dm.z" 2>/dev/null || die_error git-failed
  build_map "$TMP/dm.q" "$TMP/dm.z" "$TMP/dm.map" 0
}

# The pack files the branch changed, sorted: the config, this script and any
# .gitattributes by name, a build file when a changed line names lint-pack or BASE.
# A config renamed away or deleted shows as its old path. Then the pack files that
# differ from HEAD in the work tree. The lines need only the changed paths and fixed
# names, so they are built before the config is read and every later error exit
# prints them.
pack_changed() {
  command awk -F"$TAB" 'index($3, "P") > 0 { print $1 }' "$TMP/dm.map" >"$TMP/pc.txt" || die_error git-failed
  g diff "${DIFF_PINS[@]}" --no-renames --name-only "-G$BUILD_LINE_RE" --end-of-options "$BASE" HEAD -- \
    "${BUILD_FILES[@]}" >>"$TMP/pc.txt" 2>/dev/null || die_error git-failed
  command sort -u "$TMP/pc.txt" >"$TMP/pc.sorted" || die_error git-failed
  command sed 's/^/pack-changed /' "$TMP/pc.sorted" >"$TMP/pc.lines" || die_error git-failed
  pack_dirty
  bound_lines "$TMP/pc.lines" "$TMP/pc.out"
  PC_READY=1
}

# The pack files that differ from HEAD in the work tree or the index, or that are
# untracked and not ignored, sorted, appended to the pack lines. The script is a
# literal pathspec: its name may hold glob characters. A build file counts only for
# a changed line that names lint-pack or BASE, or when it is untracked.
pack_dirty() {
  local side
  local -a mode specs
  specs=(':(literal).lint-pack.conf' .gitattributes '*/.gitattributes')
  if [ -n "$SELF_REL" ]; then specs[${#specs[@]}]=":(literal)$SELF_REL"; fi
  : >"$TMP/pd.txt"
  for side in tree index; do
    mode=()
    if [ "$side" = index ]; then mode=(--cached); fi
    g diff "${DIFF_PINS[@]}" --no-renames --name-only ${mode[@]+"${mode[@]}"} --end-of-options HEAD -- \
      "${specs[@]}" >>"$TMP/pd.txt" 2>/dev/null || die_error git-failed
    g diff "${DIFF_PINS[@]}" --no-renames --name-only "-G$BUILD_LINE_RE" ${mode[@]+"${mode[@]}"} --end-of-options HEAD -- \
      "${BUILD_FILES[@]}" >>"$TMP/pd.txt" 2>/dev/null || die_error git-failed
  done
  g ls-files --others --exclude-standard -- "${specs[@]}" "${BUILD_FILES[@]}" >>"$TMP/pd.txt" 2>/dev/null || die_error git-failed
  command sort -u "$TMP/pd.txt" >"$TMP/pd.sorted" || die_error git-failed
  command sed 's/^/pack-dirty /' "$TMP/pd.sorted" >>"$TMP/pc.lines" || die_error git-failed
}

# One -U0 diff, split by an awk pass into the streams each check reads.
diff_main() {
  local ids_on=0 size_on=0
  if [ "$IDS_ENABLED" = true ]; then ids_on=1; fi
  if [ "$SIZE_ENABLED" = true ]; then size_on=1; fi
  g diff "${DIFF_PINS[@]}" -M -U0 --end-of-options "$BASE" HEAD -- >"$TMP/main.diff" 2>/dev/null || die_error git-failed
  command awk -v MAP="$TMP/dm.map" -v IDS_ON="$ids_on" -v SIZE_ON="$size_on" \
    -v RM="$TMP/rm.txt" -v AD1="$TMP/ad1.txt" -v AD2T="$TMP/ad2.txt" -v AD2M="$TMP/ad2.meta" -v RNG="$TMP/ranges.tsv" \
    -f "$TMP/split.awk" "$TMP/main.diff" || die_error git-failed
}

# ---- Check 1: stale symbols ----

# Every match of every stale.symbol pattern in $1, one per line, into $2.
extract_tokens() {
  local pat rc
  : >"$2"
  for pat in ${STALE_SYMBOL[@]+"${STALE_SYMBOL[@]}"}; do
    command grep -a -o -E -e "$pat" "$1" >>"$2"
    rc=$?
    [ "$rc" -le 1 ] || die_error "bad-pattern stale-symbol"
  done
}

check_stale() {
  local total rc
  extract_tokens "$TMP/rm.txt" "$TMP/rm.tok"
  extract_tokens "$TMP/ad1.txt" "$TMP/ad.tok"
  command sort -u "$TMP/rm.tok" >"$TMP/rm.sorted" || die_error git-failed
  command sort -u "$TMP/ad.tok" >"$TMP/ad.sorted" || die_error git-failed
  command awk -v MIN="$STALE_MIN" -v UNSAFE="$TMP/unsafe.n" -f "$TMP/safe.awk" "$TMP/rm.sorted" >"$TMP/rm.safe" || die_error git-failed
  UNSAFE_N=$(cat "$TMP/unsafe.n") || die_error git-failed
  command comm -23 "$TMP/rm.safe" "$TMP/ad.sorted" >"$TMP/cand" || die_error git-failed
  total=$(count_lines "$TMP/cand") || die_error git-failed
  if [ "$total" -gt "$MAX_SYMBOLS" ]; then SYMBOL_CAP_N=$((total - MAX_SYMBOLS)); fi
  command head -n "$MAX_SYMBOLS" "$TMP/cand" >"$TMP/tokens" || die_error git-failed
  [ -s "$TMP/tokens" ] || return 0

  # Three passes over HEAD only: the files that hold a symbol, quoted and raw,
  # for their flags; then the lines. git grep never leaves the repository.
  g grep -l -F -w "${GREP_PINS[@]}" -f "$TMP/tokens" HEAD -- >"$TMP/hf.q" 2>/dev/null
  rc=$?
  [ "$rc" -le 1 ] || die_error git-failed
  g grep -l -z -F -w "${GREP_PINS[@]}" -f "$TMP/tokens" HEAD -- >"$TMP/hf.z" 2>/dev/null
  rc=$?
  [ "$rc" -le 1 ] || die_error git-failed
  build_map "$TMP/hf.q" "$TMP/hf.z" "$TMP/hf.map" 1
  g grep -n -o -F -w "${GREP_PINS[@]}" -f "$TMP/tokens" HEAD -- >"$TMP/hits" 2>/dev/null
  rc=$?
  [ "$rc" -le 1 ] || die_error git-failed
  command awk -v TOKENS="$TMP/tokens" -v FMAP="$TMP/hf.map" -v SB="$TMP/sb1.txt" -v REC="$TMP/rec.stale" \
    -f "$TMP/hits.awk" "$TMP/hits" || die_error git-failed
}

# ---- Check 2: plan IDs and tombstones ----

check_ids() {
  local i=0 id rc
  while [ "$i" -lt "${#IDS_ID[@]}" ]; do
    id=${IDS_ID[$i]}
    command grep -a -n -E -e "$(wrap_pattern "${IDS_RE[$i]}")" "$TMP/ad2.txt" >"$TMP/ids.hit"
    rc=$?
    case "$rc" in
      0)
        command cut -d: -f1 "$TMP/ids.hit" >"$TMP/ids.nums" || die_error git-failed
        command awk -F"$TAB" -v ID="$id" \
          'NR == FNR { HIT[$1] = 1; next } (FNR in HIT) { print "plan-id\t" $1 "\t" $2 "\t" ID }' \
          "$TMP/ids.nums" "$TMP/ad2.meta" >>"$TMP/rec.ids" || die_error git-failed ;;
      1) ;;
      *) die_error "bad-pattern $id" ;;
    esac
    i=$((i + 1))
  done
  # A changed file that git shows as binary is not searched: say so.
  g diff "${DIFF_PINS[@]}" --no-renames --numstat --end-of-options "$BASE" HEAD -- >"$TMP/numstat" 2>/dev/null || die_error git-failed
  command awk -F"$TAB" '
    NR == FNR { FL[$1] = $3; next }
    $1 == "-" && $2 == "-" {
      f = ($3 in FL) ? FL[$3] : "="
      if (index(f, "O") == 0 && index(f, "B") == 0) print $3
    }' "$TMP/dm.map" "$TMP/numstat" >>"$TMP/sb2.txt" || die_error git-failed
}

# ---- Check 3: function size ----

check_size() {
  local rc ok e
  # The linter is argv, one word per config line, run from the root. No shell.
  # The outer redirect keeps bash's own "Terminated" note off stderr when a signal
  # ends the linter's subshell.
  { ( cd "$ROOT" && "${SIZE_ARG[@]}" ) </dev/null >"$TMP/lint.out" 2>&1; } 2>/dev/null
  rc=$?
  case "$rc" in 126 | 127) die_error linter-missing ;; esac
  ok=0
  for e in ${SIZE_OK[@]+"${SIZE_OK[@]}"}; do
    if [ "$rc" -eq "$e" ]; then ok=1; fi
  done
  [ "$ok" = 1 ] || die_error "linter-exit $rc"
  # A non-zero status without one "<path>:<line>:" line is not a lint result: the
  # linter did not run (a failed fetch, a missing module). Never read it as clean.
  if [ "$rc" -ne 0 ]; then
    command grep -a -q -E -e "$DIAGNOSTIC_RE" "$TMP/lint.out"
    case "$?" in 0) ;; 1) die_error "linter-exit $rc" ;; *) die_error git-failed ;; esac
  fi
  if [ -n "$SIZE_MATCH" ]; then
    command grep -a -E -e "$SIZE_MATCH" "$TMP/lint.out" >"$TMP/lint.sel"
    rc=$?
    [ "$rc" -le 1 ] || die_error "bad-pattern size-match"
  else
    cp "$TMP/lint.out" "$TMP/lint.sel" || die_error git-failed
  fi
  ROOT_FOR_AWK=$ROOT command awk -v MAP="$TMP/dm.map" -v RNG="$TMP/ranges.tsv" \
    -v REC="$TMP/rec.size" -v UNM="$TMP/unmatched.n" \
    -f "$TMP/size.awk" "$TMP/lint.sel" || die_error git-failed
  UNMATCHED_N=$(cat "$TMP/unmatched.n") || die_error git-failed
}

# ---- Result ----

emit() {
  local total more state code sb_total sb_more
  command sort -t "$TAB" -k1,1 -k2,2 -k3,3n -k4,4 -u "$TMP/rec.stale" "$TMP/rec.ids" "$TMP/rec.size" >"$TMP/rec.sorted" || die_error git-failed
  total=$(count_lines "$TMP/rec.sorted") || die_error git-failed
  command head -n "$MAX_RECORDS" "$TMP/rec.sorted" >"$TMP/rec.head" || die_error git-failed
  command awk -F"$TAB" '{ print $1 " " $2 ":" $3 " " $4 }' "$TMP/rec.head" >"$TMP/rec.lines" || die_error git-failed
  bound_lines "$TMP/rec.lines" "$TMP/rec.out"
  more=0
  if [ "$total" -gt "$MAX_RECORDS" ]; then more=$((total - MAX_RECORDS)); fi

  cat "$TMP/sb1.txt" "$TMP/sb2.txt" | command sort -u >"$TMP/sb.sorted" || die_error git-failed
  sb_total=$(count_lines "$TMP/sb.sorted") || die_error git-failed
  command head -n "$MAX_BINARY" "$TMP/sb.sorted" | command sed 's/^/skipped-binary /' >"$TMP/sb.lines" || die_error git-failed
  bound_lines "$TMP/sb.lines" "$TMP/sb.out"
  sb_more=0
  if [ "$sb_total" -gt "$MAX_BINARY" ]; then sb_more=$((sb_total - MAX_BINARY)); fi

  if [ "$total" -gt 0 ]; then
    state="matches $total"; code=1
  elif [ "$ANY_ENABLED" = 1 ]; then
    state=clean; code=0
  else
    state=no-config; code=0
  fi

  {
    cat "$TMP/rec.out"
    if [ "$more" -gt 0 ]; then printf '+%s more\n' "$more"; fi
    cat "$TMP/pc.out"
    cat "$TMP/sb.out"
    if [ "$sb_more" -gt 0 ]; then printf '+%s more\n' "$sb_more"; fi
    if [ "$SYMBOL_CAP_N" -gt 0 ]; then printf 'symbol-cap %s\n' "$SYMBOL_CAP_N"; fi
    if [ "$UNSAFE_N" -gt 0 ]; then printf 'unsafe-tokens %s\n' "$UNSAFE_N"; fi
    if [ "$UNMATCHED_N" -gt 0 ]; then printf 'unmatched-diagnostics %s\n' "$UNMATCHED_N"; fi
    if [ "$DROPPED_N" -gt 0 ]; then printf 'dropped-long-lines %s\n' "$DROPPED_N"; fi
    report_base
    printf 'LINT_PACK: %s\n' "$state"
  } >"$TMP/result.txt"
  cat "$TMP/result.txt"
  DONE=1
  exit "$code"
}

# ---- The awk passes (POSIX awk: no interval expressions) ----

write_awk_programs() {
  # Split the -U0 diff. A hunk header gives the exact line counts, so a content
  # line that starts with "--- " or "+++ " is never read as a file header.
  cat >"$TMP/split.awk" <<'AWK' || die_error git-failed
function flagsof(p) { return (p in FL) ? FL[p] : "=" }
function unprefix(p) {
  sub(/\t$/, "", p)
  if (p == "/dev/null") return ""
  if (substr(p, 1, 1) == "\"") return "\"" substr(p, 4)
  return substr(p, 3)
}
function removed(text,   fl) {
  fl = flagsof(oldp)
  if (index(fl, "O") == 0 && index(fl, "S") > 0) print text > RM
}
function added(text,   fl, ln) {
  fl = flagsof(newp)
  ln = nextnew
  nextnew++
  if (index(fl, "O") > 0) return
  if (index(fl, "S") > 0) print text > AD1
  if (IDS_ON == 1 && index(fl, "B") == 0) {
    print text > AD2T
    print newp "\t" ln > AD2M
  }
}
function hunk(line,   hdr, parts, o, n, oa, na, fl) {
  if (!match(line, /^@@ -[0-9]+(,[0-9]+)? \+[0-9]+(,[0-9]+)? @@/)) return
  hdr = substr(line, 4, RLENGTH - 6)
  split(hdr, parts, " ")
  o = substr(parts[1], 2)
  n = substr(parts[2], 2)
  if (index(o, ",") > 0) { split(o, oa, ","); remold = oa[2] + 0 } else remold = 1
  if (index(n, ",") > 0) { split(n, na, ","); nextnew = na[1] + 0; remnew = na[2] + 0 } else { nextnew = n + 0; remnew = 1 }
  if (SIZE_ON == 1 && remnew > 0) {
    fl = flagsof(newp)
    if (index(fl, "O") == 0 && index(fl, "C") == 0) print newp "\t" nextnew "\t" (nextnew + remnew - 1) > RNG
  }
}
BEGIN {
  while ((getline l < MAP) > 0) {
    split(l, f, "\t")
    FL[f[1]] = f[3]
  }
  close(MAP)
}
{
  line = $0
  if (remold > 0 || remnew > 0) {
    c = substr(line, 1, 1)
    if (c == "-" && remold > 0) { remold--; removed(substr(line, 2)); next }
    if (c == "+" && remnew > 0) { remnew--; added(substr(line, 2)); next }
    if (c == "\\") next
    remold = 0
    remnew = 0
  }
  if (substr(line, 1, 4) == "--- ") { oldp = unprefix(substr(line, 5)); next }
  if (substr(line, 1, 4) == "+++ ") { newp = unprefix(substr(line, 5)); next }
  if (substr(line, 1, 11) == "diff --git ") { oldp = ""; newp = ""; next }
  if (substr(line, 1, 3) == "@@ ") hunk(line)
}
AWK

  # Keep safe symbols of the minimum length; count the unsafe ones.
  cat >"$TMP/safe.awk" <<'AWK' || die_error git-failed
{
  t = $0
  if (length(t) < MIN) next
  if (length(t) > 64 || t !~ "^[A-Za-z0-9_.:/-]+$") { unsafe++; next }
  print t
}
END { print unsafe + 0 > UNSAFE }
AWK

  # Read "HEAD:<path>:<line>:<symbol>" lines. A path may hold colons, so the
  # split is the first ":<digits>:" whose rest is a known symbol. A hit in a
  # code file kills the symbol; a hit in a doc or help file is a candidate.
  cat >"$TMP/hits.awk" <<'AWK' || die_error git-failed
function flagsof(p) { return (p in FL) ? FL[p] : "=" }
BEGIN {
  while ((getline l < TOKENS) > 0) TOK[l] = 1
  close(TOKENS)
  while ((getline l < FMAP) > 0) {
    split(l, f, "\t")
    FL[f[1]] = f[3]
  }
  close(FMAP)
}
{
  line = $0
  len = length(line)
  if (substr(line, 1, 17) == "Binary file HEAD:" && substr(line, len - 7) == " matches") {
    name = substr(line, 18, len - 25)
    if (index(flagsof(name), "O") == 0) print name > SB
    next
  }
  if (substr(line, 1, 5) != "HEAD:") next
  rest = substr(line, 6)
  rlen = length(rest)
  start = 1
  while (start <= rlen) {
    s = substr(rest, start)
    if (!match(s, /:[0-9]+:/)) break
    pos = start + RSTART - 1
    llen = RLENGTH
    t = substr(rest, pos + llen)
    if (t in TOK) {
      path = substr(rest, 1, pos - 1)
      lineno = substr(rest, pos + 1, llen - 2)
      fl = flagsof(path)
      if (index(fl, "O") > 0) break
      if (index(fl, "D") > 0) {
        if (index(fl, "A") == 0) { nc++; CP[nc] = path; CL[nc] = lineno; CT[nc] = t }
      } else KILL[t] = 1
      break
    }
    start = pos + 1
  }
}
END {
  for (i = 1; i <= nc; i++) {
    if (!(CT[i] in KILL)) print "stale-symbol\t" CP[i] "\t" CL[i] "\t" CT[i] > REC
  }
}
AWK

  # Keep a diagnostic "<path>:<line>:..." that lies inside an added hunk.
  cat >"$TMP/size.awk" <<'AWK' || die_error git-failed
BEGIN {
  while ((getline l < MAP) > 0) {
    split(l, f, "\t")
    if (f[2] != "") { RQ[f[2]] = f[1]; RF[f[2]] = f[3] }
  }
  close(MAP)
  while ((getline l < RNG) > 0) {
    split(l, f, "\t")
    RANGE[f[1]] = RANGE[f[1]] " " f[2] "-" f[3]
  }
  close(RNG)
  rp = ENVIRON["ROOT_FOR_AWK"] "/"
}
{
  line = $0
  if (!match(line, /:[0-9]+:/)) next
  p = substr(line, 1, RSTART - 1)
  ln = substr(line, RSTART + 1, RLENGTH - 2) + 0
  if (index(p, rp) == 1) p = substr(p, length(rp) + 1)
  else if (substr(p, 1, 2) == "./") p = substr(p, 3)
  if (!(p in RQ)) { unmatched++; next }
  q = RQ[p]
  fl = RF[p]
  if (index(fl, "O") > 0 || index(fl, "C") > 0) next
  n = split(RANGE[q], r, " ")
  for (i = 1; i <= n; i++) {
    split(r[i], se, "-")
    if (ln >= se[1] + 0 && ln <= se[2] + 0) {
      print "function-size\t" q "\t" ln "\tfunction-size" > REC
      break
    }
  }
}
END { print unmatched + 0 > UNM }
AWK
}

# ---- Main ----

# The config is the blob at HEAD, never the work tree. The tree says whether it
# exists, so a blob that will not read is git-failed and never no-config. Only a
# regular file is a config. The map is rebuilt once the globs are known.
load_config() {
  local mode rest
  g ls-tree HEAD -- .lint-pack.conf >"$TMP/conf.entry" 2>/dev/null || die_error git-failed
  [ -s "$TMP/conf.entry" ] || return 0
  IFS=' ' read -r mode rest <"$TMP/conf.entry" || die_error git-failed
  case "$mode" in 100644 | 100755) ;; *) cfg_fail 0 ;; esac
  g cat-file blob HEAD:.lint-pack.conf >"$TMP/conf" 2>/dev/null || die_error git-failed
  read_config
  finish_config
  validate_patterns
  build_map "$TMP/dm.q" "$TMP/dm.z" "$TMP/dm.map" 0
}

# git 2.30 or newer: the base checks use --end-of-options, which an older git
# rejects, and that would read as bad-base. Compare numbers, never strings.
check_git_version() {
  local out major minor
  out=$(command git --version 2>/dev/null) || die_error git-failed
  out=${out#git version }
  [[ $out =~ $GIT_VERSION_RE ]] || die_error git-failed
  major=$((10#${BASH_REMATCH[1]}))
  minor=$((10#${BASH_REMATCH[2]}))
  if [ "$major" -lt "$MIN_GIT_MAJOR" ]; then die_error git-too-old; fi
  if [ "$major" -eq "$MIN_GIT_MAJOR" ] && [ "$minor" -lt "$MIN_GIT_MINOR" ]; then die_error git-too-old; fi
}

main() {
  local top rc
  [ "$#" -eq 1 ] || die_error usage
  resolve_self
  command -v git >/dev/null 2>&1 || die_error git-failed
  check_git_version
  top=$(command git rev-parse --show-toplevel 2>/dev/null) || die_error not-a-repo
  [ -n "$top" ] || die_error not-a-repo
  cd "$top" 2>/dev/null || die_error not-a-repo
  ROOT=$(pwd -P) || die_error git-failed

  BASE=$1
  [[ $BASE =~ $BASE_RE ]] || die_error bad-base
  # The commit the argument names, so the base line shows what the run compared.
  BASE=$(g rev-parse --verify --quiet --end-of-options "${BASE}^{commit}" 2>/dev/null) || die_error bad-base
  [[ $BASE =~ $BASE_RE ]] || die_error bad-base
  g merge-base --is-ancestor "$BASE" HEAD >/dev/null 2>&1
  rc=$?
  case "$rc" in 0) BASE_OK=1 ;; 1) die_error base-not-ancestor ;; *) die_error git-failed ;; esac

  TMP=$(mktemp -d "${TMPDIR:-/tmp}/lint-pack.XXXXXX") || die_error git-failed
  case "$SELF_ABS" in "$ROOT"/*) SELF_REL=${SELF_ABS#"$ROOT"/} ;; esac

  # The pack-changed lines come before the config, so an error exit shows them.
  build_diffmap
  pack_changed
  load_config

  : >"$TMP/rec.stale"
  : >"$TMP/rec.ids"
  : >"$TMP/rec.size"
  : >"$TMP/sb1.txt"
  : >"$TMP/sb2.txt"
  : >"$TMP/rm.txt"
  : >"$TMP/ad1.txt"
  : >"$TMP/ad2.txt"
  : >"$TMP/ad2.meta"
  : >"$TMP/ranges.tsv"
  write_awk_programs

  if [ "$ANY_ENABLED" = 1 ]; then
    diff_main
    if [ "$STALE_ENABLED" = true ]; then check_stale; fi
    if [ "$IDS_ENABLED" = true ]; then check_ids; fi
    if [ "$SIZE_ENABLED" = true ]; then check_size; fi
  fi
  emit
}

main "$@"

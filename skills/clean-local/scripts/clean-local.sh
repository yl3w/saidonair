#!/bin/sh
# Wipes the state the DEV environment owns: this repo's local `wrangler dev` Durable Object storage
# (apps/api/.wrangler/state/v3/do), optionally the local Workflow state, and optionally every vector in the
# dev Vectorize index. Bundled with the `clean-local` skill (see ../SKILL.md); the canonical copy lives at
# skills/clean-local/ and agent directories (.claude/skills, .agents/skills) copy or symlink to it.
#
# Dev only. Staging and production are unreachable: there is no --env flag, the index name is a constant in
# clean-vectors.mjs, and an argument naming a deployed tier is refused. It never touches deployed Workers or
# Durable Objects, the Vectorize index itself or its metadata indexes, .dev.vars, test storage (in-memory),
# or the other local stores under state/v3 (kv, cache, d1, r2, observability).
#
# Usage: sh skills/clean-local/scripts/clean-local.sh [--yes] [--include-workflows] [--include-vectors] [ClassName]
#   (no flags)           dry run: list what would be deleted, delete nothing
#   --yes                actually delete
#   --dry-run            force a dry run even when --yes is present
#   --include-workflows  also remove state/v3/workflows (local Workflow instances reference DO rows)
#   --include-vectors    also delete every vector in the dev Vectorize index (needs `wrangler login`)
#   ClassName            only the Durable Object class with that name, e.g. RegistryDO or UserDO
# Run it from anywhere inside the repo; it locates the repo root from the current directory.
# Exit: 0 done or nothing to do, 2 usage or not inside the repo, 3 refused because wrangler dev / workerd
#       from this repo is running, 4 internal path guard tripped, 5 a wrangler call failed, 6 not logged in.
set -eu

usage() {
  sed -n '/^# Usage:/,/^#       from this repo/p' "$0" | sed 's/^# \{0,1\}//'
}

YES=0
DRY=0
INCLUDE_WORKFLOWS=0
INCLUDE_VECTORS=0
CLASS=""
for arg in "$@"; do
  # Deleting deployed state is out of scope, so a request that names a deployed tier is refused outright
  # rather than quietly cleaning dev instead.
  case "$arg" in
    *staging*|*production*|*prod)
      printf 'refusing: staging and production are not supported by this skill. It clears dev state only.\n' >&2
      exit 2 ;;
  esac
  case "$arg" in
    --yes) YES=1 ;;
    --dry-run) DRY=1 ;;
    --include-workflows) INCLUDE_WORKFLOWS=1 ;;
    --include-vectors) INCLUDE_VECTORS=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) printf 'unknown flag: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
    *)
      if [ -n "$CLASS" ]; then printf 'only one ClassName is allowed\n' >&2; exit 2; fi
      CLASS="$arg" ;;
  esac
done
if [ "$DRY" -eq 1 ]; then YES=0; fi

# Agents run commands from the repo root, and the skill may be reached through a symlinked or copied
# install, so the repo root is found by walking up from the current directory, not from $0.
find_repo_root() {
  dir=$PWD
  while :; do
    if [ -f "$dir/AGENTS.md" ] && [ -f "$dir/apps/api/wrangler.jsonc" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    [ "$dir" = "/" ] && return 1
    dir=$(dirname -- "$dir")
  done
}
if ! REPO_ROOT=$(find_repo_root); then
  printf 'refusing: not inside the media-digest-assistant repo (no AGENTS.md + apps/api/wrangler.jsonc above %s)\n' "$PWD" >&2
  exit 2
fi

STATE_DIR="$REPO_ROOT/apps/api/.wrangler/state/v3"
DO_DIR="$STATE_DIR/do"
WORKFLOWS_DIR="$STATE_DIR/workflows"
VECTORS_SCRIPT="$REPO_ROOT/skills/clean-local/scripts/clean-vectors.mjs"

# Deleting SQLite files under a live workerd breaks the running dev server, and a live dev Worker holds the
# remote VECTORS binding, so it could re-upsert while the index is being emptied. Match any workerd or
# wrangler process launched from this repo's node_modules; the [w] trick stops pgrep matching itself.
RUNNING_PATTERN="$REPO_ROOT/.*node_modules/.*([w]orkerd|[w]rangler)"
if pgrep -f "$RUNNING_PATTERN" >/dev/null 2>&1; then
  printf 'refusing: wrangler dev / workerd from this repo is running. Stop `pnpm dev` first.\n' >&2
  pgrep -fl "$RUNNING_PATTERN" 2>/dev/null | cut -c1-160 >&2 || true
  exit 3
fi

if [ "$INCLUDE_VECTORS" -eq 1 ] && [ ! -f "$VECTORS_SCRIPT" ]; then
  printf 'refusing: %s is missing. Run the canonical copy from the repo root.\n' "${VECTORS_SCRIPT#"$REPO_ROOT"/}" >&2
  exit 2
fi

# Targets: every <worker>-<Class> directory directly under state/v3/do, optionally one class only.
targets=""
count=0
for dir in "$DO_DIR"/*/; do
  [ -d "$dir" ] || continue
  dir=${dir%/}
  name=$(basename -- "$dir")
  if [ -n "$CLASS" ]; then
    case "$name" in *-"$CLASS") ;; *) continue ;; esac
  fi
  targets="$targets$dir
"
  count=$((count + 1))
done
if [ "$INCLUDE_WORKFLOWS" -eq 1 ] && [ -d "$WORKFLOWS_DIR" ]; then
  targets="$targets$WORKFLOWS_DIR
"
  count=$((count + 1))
fi

if [ "$count" -eq 0 ] && [ "$INCLUDE_VECTORS" -eq 0 ]; then
  if [ -n "$CLASS" ]; then
    printf 'Nothing to delete: no local state for class %s under %s\n' "$CLASS" "${DO_DIR#"$REPO_ROOT"/}"
  else
    printf 'Nothing to delete: no local Durable Object state under %s\n' "${DO_DIR#"$REPO_ROOT"/}"
  fi
  exit 0
fi

set -f
IFS='
'

total=$count
if [ "$INCLUDE_VECTORS" -eq 1 ]; then total=$((total + 1)); fi

if [ "$YES" -eq 1 ]; then
  printf 'Deleting dev state (%s):\n' "$total"
else
  printf 'Dry run. Would delete (%s):\n' "$total"
fi
for dir in $targets; do
  size=$(du -sh -- "$dir" 2>/dev/null | cut -f1)
  files=$(find "$dir" -type f | wc -l | tr -d ' ')
  printf '  %s  (%s, %s files)\n' "${dir#"$REPO_ROOT"/}" "$size" "$files"
  find "$dir" -type f | sed "s|^$dir/|      |"
done
# The dry run enumerates the index for real, so the preview reports the true count, not a cached one.
if [ "$INCLUDE_VECTORS" -eq 1 ] && [ "$YES" -eq 0 ]; then
  node "$VECTORS_SCRIPT" --repo-root "$REPO_ROOT"
fi

if [ "$YES" -ne 1 ]; then
  printf '\nDry run only. Re-run with --yes to delete.\n'
  exit 0
fi

for dir in $targets; do
  # Belt and braces: only a direct child of state/v3/do, or state/v3/workflows itself, is ever removed.
  case "$dir" in
    "$DO_DIR"/*/*) printf 'refusing: nested path %s\n' "$dir" >&2; exit 4 ;;
    "$DO_DIR"/?*) ;;
    "$WORKFLOWS_DIR") ;;
    *) printf 'refusing: %s is outside %s\n' "$dir" "$STATE_DIR" >&2; exit 4 ;;
  esac
  rm -rf -- "$dir"
done

if [ "$INCLUDE_VECTORS" -eq 1 ]; then
  printf '\n'
  node "$VECTORS_SCRIPT" --repo-root "$REPO_ROOT" --yes
fi

printf '\nDone. The next `pnpm dev` runs migrations from scratch and re-seeds the owner from apps/api/.dev.vars.\n'

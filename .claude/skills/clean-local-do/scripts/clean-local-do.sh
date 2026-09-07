#!/bin/sh
# Wipes this repo's LOCAL `wrangler dev` Durable Object storage (apps/api/.wrangler/state/v3/do).
# Owner-invoked through the `clean-local-do` skill (see ../SKILL.md). It never touches deployed
# Cloudflare resources, test storage (in-memory), .dev.vars, or the other local stores under
# state/v3 (kv, cache, d1, r2, observability).
#
# Usage: clean-local-do.sh [--yes] [--include-workflows] [ClassName]
#   (no flags)           dry run: list what would be deleted, delete nothing
#   --yes                actually delete
#   --dry-run            force a dry run even when --yes is present (the skill preview relies on this)
#   --include-workflows  also remove state/v3/workflows (local Workflow instances reference DO rows)
#   ClassName            only the Durable Object class with that name, e.g. RegistryDO
# Exit: 0 done or nothing to do, 2 usage, 3 refused because wrangler dev / workerd from this repo is running.
set -eu

usage() {
  sed -n '/^# Usage:/,/^# Exit:/p' "$0" | sed 's/^# \{0,1\}//'
}

YES=0
DRY=0
INCLUDE_WORKFLOWS=0
CLASS=""
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --dry-run) DRY=1 ;;
    --include-workflows) INCLUDE_WORKFLOWS=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) printf 'unknown flag: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
    *)
      if [ -n "$CLASS" ]; then printf 'only one ClassName is allowed\n' >&2; exit 2; fi
      CLASS="$arg" ;;
  esac
done
if [ "$DRY" -eq 1 ]; then YES=0; fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../../.." && pwd)
if [ ! -f "$REPO_ROOT/AGENTS.md" ] || [ ! -f "$REPO_ROOT/apps/api/wrangler.jsonc" ]; then
  printf 'refusing: %s does not look like the media-digest-assistant repo root\n' "$REPO_ROOT" >&2
  exit 2
fi

STATE_DIR="$REPO_ROOT/apps/api/.wrangler/state/v3"
DO_DIR="$STATE_DIR/do"
WORKFLOWS_DIR="$STATE_DIR/workflows"

# Deleting SQLite files under a live workerd breaks the running dev server. Match any workerd or
# wrangler process launched from this repo's node_modules; the [w] trick stops pgrep matching itself.
RUNNING_PATTERN="$REPO_ROOT/.*node_modules/.*([w]orkerd|[w]rangler)"
if pgrep -f "$RUNNING_PATTERN" >/dev/null 2>&1; then
  printf 'refusing: wrangler dev / workerd from this repo is running. Stop `pnpm dev` first.\n' >&2
  pgrep -fl "$RUNNING_PATTERN" 2>/dev/null | cut -c1-160 >&2 || true
  exit 3
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

if [ "$count" -eq 0 ]; then
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

if [ "$YES" -eq 1 ]; then
  printf 'Deleting local wrangler dev state (%s):\n' "$count"
else
  printf 'Dry run. Would delete (%s):\n' "$count"
fi
for dir in $targets; do
  size=$(du -sh -- "$dir" 2>/dev/null | cut -f1)
  files=$(find "$dir" -type f | wc -l | tr -d ' ')
  printf '  %s  (%s, %s files)\n' "${dir#"$REPO_ROOT"/}" "$size" "$files"
  find "$dir" -type f | sed "s|^$dir/|      |"
done

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

printf '\nDone. The next `pnpm dev` runs migrations from scratch and re-seeds the owner from apps/api/.dev.vars.\n'

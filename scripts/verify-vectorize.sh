#!/bin/sh
# Verifies that a Vectorize index's metadata indexes match the properties chat filters on.
#
# Why this exists: filtering on a property with no metadata index is **not an error**. Vectorize
# answers zero matches, the API stores its honest "Nothing in what you follow covers that.", and a
# reader cannot tell a broken retrieval from an empty catalog. That is exactly what the 2026-09-15
# episodeId rename caused — every file updated correctly, the live index left naming `videoId` —
# and nothing in `pnpm check` can see it, because the index is remote (docs/PRD.md §9, 2026-09-16).
#
# Run it after creating an index, and whenever a filter property is renamed.
#   pnpm verify:vectorize                 # defaults to the dev index
#   pnpm verify:vectorize media-rag       # or any index by name
#
set -eu
INDEX="${1:-media-rag-dev}"
ROOT="$(dirname "$0")/.."
SOURCE="$ROOT/apps/api/src/lib/vectorize.ts"

# Derived from the one declaration rather than copied, so the two cannot drift. A reformat that
# breaks this extraction fails loudly here instead of quietly verifying the wrong list.
REQUIRED=$(sed -n 's/^export const FILTERABLE_PROPERTIES = \[\(.*\)\] as const;$/\1/p' "$SOURCE" \
  | tr -d '"' | tr ',' ' ')
if [ -z "$REQUIRED" ]; then
  printf 'verify-vectorize: could not read FILTERABLE_PROPERTIES from %s\n' "$SOURCE" >&2
  exit 2
fi

cd "$ROOT/apps/api"
out=$(pnpm exec wrangler vectorize list-metadata-index "$INDEX" 2>&1) || {
  printf 'verify-vectorize: could not read %s\n%s\n' "$INDEX" "$out" >&2
  exit 2
}

live=$(printf '%s\n' "$out" | sed -n 's/^│ *\([A-Za-z][A-Za-z0-9_]*\) *│.*/\1/p' | grep -v '^propertyName$' || true)

status=0
for want in $REQUIRED; do
  if printf '%s\n' "$live" | grep -qx "$want"; then
    printf '  ok      %s\n' "$want"
  else
    printf '  MISSING %s  — every filter on it silently matches nothing\n' "$want"
    status=1
  fi
done

for have in $live; do
  case " $REQUIRED " in
    *" $have "*) ;;
    *) printf '  extra   %s  — nothing filters on it; costs a write on every upsert\n' "$have" ;;
  esac
done

if [ "$status" -eq 0 ]; then
  printf 'verify-vectorize: %s carries every property chat filters on.\n' "$INDEX"
else
  printf 'verify-vectorize: %s is missing a metadata index. Create it, then re-upsert —\n' "$INDEX"
  printf '  an index does not cover vectors written before it existed (docs/PRD.md §6).\n'
fi
exit "$status"

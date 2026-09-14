#!/bin/sh
# The repo's agent skills: one place for the pinned CLI version and for what "the standard set" means.
# Driven by the root package.json scripts (`pnpm skills:install`, `pnpm skills:remove`); see AGENTS.md → Commands.
#
# Usage: sh scripts/skills.sh install [--agent <agents…>]
#        sh scripts/skills.sh remove <name…> [-y]
#
# `install` adds every skill from both sources, so a fresh clone gets the same set every time. Arguments are
# passed to BOTH sources: a `pnpm run` script appends its arguments to the end of the command line, so a plain
# `cmd-a && cmd-b` chain would give `--agent` to cmd-b only and silently install cmd-a to the default agents.
set -eu

# Bump deliberately (AGENTS.md hard rule 1 is about dependencies, but this pin is the same idea): recent
# releases need Node 22.20+, which the repo's 22 line satisfies.
SKILLS_CLI="skills@1.5.24"

# The standard set. `obra/superpowers` is fetched at its GitHub HEAD — `skills-lock.json` records the exact
# hashes but is gitignored, so two clones installed on different days can differ. Commit the lock and switch to
# `experimental_install` if that ever matters.
SUPERPOWERS="obra/superpowers"
LOCAL_SKILLS="./skills"

usage() {
  sed -n '/^# Usage:/,/^#        sh scripts/p' "$0" | sed 's/^# \{0,1\}//'
}

command=${1:-}
[ "$#" -gt 0 ] && shift

case "$command" in
  install)
    # `--skill '*' -y` keeps it deterministic and unattended: every skill from each source, no prompts.
    pnpm dlx "$SKILLS_CLI" add "$SUPERPOWERS" --skill '*' -y "$@"
    pnpm dlx "$SKILLS_CLI" add "$LOCAL_SKILLS" --skill '*' -y "$@"
    ;;
  remove)
    if [ "$#" -eq 0 ]; then
      printf 'remove needs at least one skill name\n\n' >&2
      usage >&2
      exit 2
    fi
    pnpm dlx "$SKILLS_CLI" remove "$@"
    ;;
  -h|--help)
    usage
    ;;
  *)
    printf 'unknown command: %s\n\n' "${command:-(none)}" >&2
    usage >&2
    exit 2
    ;;
esac

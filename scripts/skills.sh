#!/bin/sh
# The repo's agent skills: one place for the pinned CLI version and for what "the standard set" means.
# Driven by the root package.json scripts (`pnpm skills:install`, `pnpm skills:remove`); see AGENTS.md → Commands.
#
# Usage: sh scripts/skills.sh install [--agent <agents…>]   # also registers the capture-conversation hook
#        sh scripts/skills.sh remove <name…> [-y]
#        sh scripts/skills.sh remove --all
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

# The capture-conversation skill also needs a session-start hook registered in each agent's own config. The skills
# CLI has no hooks command — it installs skill directories and nothing else — so that step lives here, where it
# rides along with the command a fresh clone already runs. Agent names match the CLI's, so `--agent` passes through.
REGISTER_HOOK="$LOCAL_SKILLS/capture-conversation/scripts/register-hook.mjs"

usage() {
  sed -n '/^# Usage:/,/remove --all/p' "$0" | sed 's/^# \{0,1\}//'
}

command=${1:-}
[ "$#" -gt 0 ] && shift

case "$command" in
  install)
    # `--skill '*' -y` keeps it deterministic and unattended: every skill from each source, no prompts.
    pnpm dlx "$SKILLS_CLI" add "$SUPERPOWERS" --skill '*' -y "$@"
    pnpm dlx "$SKILLS_CLI" add "$LOCAL_SKILLS" --skill '*' -y "$@"
    # Quiet when there is nothing to change, so a re-install does not report work it did not do.
    node "$REGISTER_HOOK" --quiet "$@"
    ;;
  remove)
    if [ "$#" -eq 0 ]; then
      printf 'remove needs at least one skill name, or --all\n\n' >&2
      usage >&2
      exit 2
    fi
    # The CLI deletes the SOURCE directory of a locally-sourced skill, not just the agent copies: an
    # unscoped `skills remove clean-local` (or --all) removes skills/clean-local from the repo itself.
    # Verified against skills@1.5.24 on 2026-09-14. Passing --agent avoids it, but then removal is
    # per-agent-registration and the shared .agents directory survives while another agent claims it, so
    # the unscoped form is the one worth keeping. Snapshot the source and put back whatever it eats.
    snapshot=$(mktemp -d)
    cp -R "$LOCAL_SKILLS"/. "$snapshot"/ 2>/dev/null || true
    status=0
    pnpm dlx "$SKILLS_CLI" remove "$@" || status=$?
    if ! diff -rq "$LOCAL_SKILLS" "$snapshot" >/dev/null 2>&1; then
      mkdir -p "$LOCAL_SKILLS"
      cp -R "$snapshot"/. "$LOCAL_SKILLS"/
      printf '\nnote: the skills CLI deleted files under %s; restored from a pre-run snapshot.\n' "$LOCAL_SKILLS"
    fi
    rm -rf "$snapshot"
    # Unregister symmetrically. A hook left pointing at a script that has been removed would fire on every session
    # start and fail — silently, because the hook is written to never break one, which is the worst kind of
    # breakage: broken and invisible.
    case " $* " in
      *" --all "*|*" capture-conversation "*) node "$REGISTER_HOOK" --remove --agent claude-code cursor codex ;;
    esac
    exit "$status"
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

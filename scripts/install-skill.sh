#!/usr/bin/env bash
# Install the moveforge agent skills into the user's personal skills tree.
#
# Source of truth lives in skills/<name>/SKILL.md in this repo. This script
# copies each skill into ~/.agents/skills/<name>/ and ensures the Claude
# Code lookup at ~/.claude/skills/<name> points at it (matching the
# convention used by the user's other personal skills).
#
# Re-run after editing any skill in this repo to refresh the installed copy.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_SRC="$ROOT/skills"
AGENTS_DST="$HOME/.agents/skills"
CLAUDE_DST="$HOME/.claude/skills"

if [ ! -d "$SKILLS_SRC" ]; then
  echo "install-skill: no skills/ directory at $SKILLS_SRC" >&2
  exit 1
fi

mkdir -p "$AGENTS_DST" "$CLAUDE_DST"

shopt -s nullglob
installed=0
for skill_dir in "$SKILLS_SRC"/*/; do
  name="$(basename "$skill_dir")"
  src="$skill_dir/SKILL.md"

  if [ ! -f "$src" ]; then
    echo "install-skill: skipping $name (no SKILL.md)" >&2
    continue
  fi

  dst_dir="$AGENTS_DST/$name"
  mkdir -p "$dst_dir"

  # Copy every file under the skill dir (SKILL.md plus any references/, assets/, scripts/).
  rsync -a --delete "$skill_dir" "$dst_dir/"
  echo "install-skill: $name → $dst_dir"

  link="$CLAUDE_DST/$name"
  if [ -L "$link" ]; then
    # Refresh in case the symlink points somewhere stale.
    ln -sfn "$dst_dir" "$link"
  elif [ -e "$link" ]; then
    echo "install-skill: warning: $link exists and is not a symlink — leaving it alone" >&2
  else
    ln -s "$dst_dir" "$link"
    echo "install-skill: $name ← $link"
  fi

  installed=$((installed + 1))
done

if [ "$installed" -eq 0 ]; then
  echo "install-skill: no skills found under $SKILLS_SRC" >&2
  exit 1
fi

echo ""
echo "install-skill: installed $installed skill(s). Reload Claude Code to pick up changes."

#!/usr/bin/env bash
# Sync the org-roam repository with its remote (fast-forward only).
# Usage: sync.sh          fetch, then git pull --ff-only
#        sync.sh --check  fetch, then report ahead/behind/dirty. No pull.
# The check is the cheap step: run it once at session start. Pull only when
# the user approves syncing.
set -uo pipefail

AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.config/pi/agent}"
CONFIG_FILE="$AGENT_DIR/ar-llm/org-roam-adhoc-memory.json"

MODE="sync"
if [ "${1:-}" = "--check" ]; then
  MODE="check"
fi

ROAM_DIR=$(jq -r '."roam-directory" // empty' "$CONFIG_FILE" 2>/dev/null)
if [ -z "$ROAM_DIR" ]; then
  echo '{"error":"roam-directory not set in config"}' >&2
  exit 1
fi
ROAM_DIR="${ROAM_DIR/#\~/$HOME}"

if ! git -C "$ROAM_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  jq -n --arg d "$ROAM_DIR" '{error:($d + " is not a git repository")}' >&2
  exit 1
fi

# The check needs the remote state, so fetch first in both modes.
# In sync mode the pull reuses this fetch.
if ! FETCH_OUT=$(git -C "$ROAM_DIR" fetch 2>&1); then
  FIRST_LINE=$(echo "$FETCH_OUT" | head -1)
  jq -n --arg e "$FIRST_LINE" '{error:("git fetch failed: " + $e)}' >&2
  exit 1
fi

if [ "$MODE" = "check" ]; then
  BEHIND=$(git -C "$ROAM_DIR" rev-list --count HEAD..@{u} 2>/dev/null || echo 0)
  AHEAD=$(git -C "$ROAM_DIR" rev-list --count @{u}..HEAD 2>/dev/null || echo 0)
  if [ -n "$(git -C "$ROAM_DIR" status --porcelain)" ]; then
    DIRTY=true
  else
    DIRTY=false
  fi
  if [ "$BEHIND" -gt 0 ]; then
    STATUS="behind"
  else
    STATUS="up-to-date"
  fi
  jq -n --arg s "$STATUS" --argjson b "$BEHIND" --argjson a "$AHEAD" --argjson d "$DIRTY" \
    '{status:$s, behind:$b, ahead:$a, dirty:$d}'
  exit 0
fi

if ! OUT=$(git -C "$ROAM_DIR" pull --ff-only 2>&1); then
  FIRST_LINE=$(echo "$OUT" | head -1)
  jq -n --arg e "$FIRST_LINE" '{error:("git pull --ff-only failed: " + $e)}' >&2
  exit 1
fi

jq -n --arg out "$OUT" '{status:"synced", output:$out}'

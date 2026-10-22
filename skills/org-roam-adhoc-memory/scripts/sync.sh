#!/usr/bin/env bash
# Sync the org-roam repository with its remote (fast-forward only).
# Run once at the start of a session, before other skill operations.
# Usage: sync.sh
set -uo pipefail

AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.config/pi/agent}"
CONFIG_FILE="$AGENT_DIR/ar-llm/org-roam-adhoc-memory.json"

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

if ! OUT=$(git -C "$ROAM_DIR" pull --ff-only 2>&1); then
  FIRST_LINE=$(echo "$OUT" | head -1)
  jq -n --arg e "$FIRST_LINE" '{error:("git pull --ff-only failed: " + $e)}' >&2
  exit 1
fi

jq -n --arg out "$OUT" '{status:"synced", output:$out}'

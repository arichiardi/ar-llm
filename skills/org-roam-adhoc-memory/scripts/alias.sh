#!/usr/bin/env bash
# Set or clear the ROAM_ALIASES property of an existing heading
# Usage: alias.sh TARGET TITLE ALIASES
#
# TARGET is a node ID or a node file path (relative to the roam directory).
# TITLE is the exact current title. ALIASES is a comma-separated string; an
# empty string (the default) removes the property.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:?Usage: alias.sh TARGET TITLE ALIASES}"
TITLE="${2:?Title is required}"
ALIASES="${3:-}"
"$SCRIPT_DIR/query.sh" "(org-roam-pi-set-aliases \"$TARGET\" \"$TITLE\" \"$ALIASES\")"

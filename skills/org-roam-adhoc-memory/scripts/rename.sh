#!/usr/bin/env bash
# Rename an existing heading in a node file
# Usage: rename.sh TARGET TITLE NEW_TITLE
#
# TARGET is a node ID or a node file path (relative to the roam directory).
# TITLE is the exact current title. NEW_TITLE must be a single non-empty line.
# The heading level, its property drawer and its ID stay unchanged.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:?Usage: rename.sh TARGET TITLE NEW_TITLE}"
TITLE="${2:?Title is required}"
NEW_TITLE="${3:?New title is required}"
"$SCRIPT_DIR/query.sh" "(org-roam-pi-rename \"$TARGET\" \"$TITLE\" \"$NEW_TITLE\")"

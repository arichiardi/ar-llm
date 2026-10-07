#!/usr/bin/env bash
# Replace the body of an existing heading in a node file
# Usage: edit-entry.sh TARGET TITLE CONTENT
#
# TARGET is a node ID or a node file path (relative to the roam directory).
# TITLE is the exact title of the headline to edit.
# The headline, its property drawer and its ID stay unchanged.
# Subheadings of TITLE are preserved.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:?Usage: edit-entry.sh TARGET TITLE CONTENT}"
TITLE="${2:?Entry title is required}"
CONTENT="${3:?Content is required}"
"$SCRIPT_DIR/query.sh" "(org-roam-pi-edit-entry \"$TARGET\" \"$TITLE\" \"$CONTENT\")"

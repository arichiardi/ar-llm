#!/usr/bin/env bash
# Append content to journal entry
# Usage: append-journal.sh CONTENT [DATE]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTENT="${1:?Usage: append-journal.sh CONTENT [DATE]}"
DATE="${2:-}"
if [ -n "$DATE" ]; then
  "$SCRIPT_DIR/query.sh" "(org-roam-pi-append-journal \"$CONTENT\" \"$DATE\")"
else
  "$SCRIPT_DIR/query.sh" "(org-roam-pi-append-journal \"$CONTENT\" nil)"
fi

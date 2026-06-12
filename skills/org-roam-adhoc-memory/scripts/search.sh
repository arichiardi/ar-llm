#!/usr/bin/env bash
# Search org-roam nodes by keyword
# Usage: search.sh QUERY [MAX_RESULTS]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUERY="${1:?Usage: search.sh QUERY [MAX_RESULTS]}"
MAX="${2:-10}"
"$SCRIPT_DIR/query.sh" "(org-roam-pi-search \"$QUERY\" $MAX)"

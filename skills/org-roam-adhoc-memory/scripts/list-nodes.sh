#!/usr/bin/env bash
# List all org-roam nodes
# Usage: list-nodes.sh [MAX]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAX="${1:-100}"
"$SCRIPT_DIR/query.sh" "(org-roam-pi-list-nodes $MAX)"

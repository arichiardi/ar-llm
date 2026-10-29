#!/usr/bin/env bash
# Refresh the org-roam database without touching git.
# Usage: db-sync.sh
# Use after create/append/edit so search and retrieve see the change.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/query.sh" '(org-roam-pi-sync-db)'

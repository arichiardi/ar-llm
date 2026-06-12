#!/usr/bin/env bash
# org-roam-adhoc-memory core query helper
# Usage: query.sh 'ELISP-EXPRESSION'
# Returns clean JSON on stdout, errors as JSON on stderr + exit 1.
#
# Debugging: set ORG_ROAM_PI_MEMORY_DEBUG=true to log all activity to /tmp/org-roam-pi-memory-debug.log
set -uo pipefail

EXT_DIR="/home/kapitan/.config/pi/agent/extensions/org-roam-memory"
CONFIG_FILE="${PI_CODING_AGENT_DIR:-$HOME/.config/pi/agent}/org-roam-memory/config.json"

# Read debug log path from config.json, fallback to /tmp
if [ -f "$CONFIG_FILE" ]; then
  DEBUG_LOG=$(jq -r '.debug["log-file"] // "/tmp/org-roam-pi-memory-debug.log"' "$CONFIG_FILE" 2>/dev/null || echo "/tmp/org-roam-pi-memory-debug.log")
else
  DEBUG_LOG="/tmp/org-roam-pi-memory-debug.log"
fi
# Expand ~ in path
DEBUG_LOG="${DEBUG_LOG/#\~/$HOME}"

BOOTSTRAP="(progn
  (add-to-list 'load-path \"$EXT_DIR\")
  (require 'org)
  (require 'org-roam-pi-memory)
  (org-roam-pi-apply-config \"$CONFIG_FILE\"))"

_debug() {
  if [ "${ORG_ROAM_PI_MEMORY_DEBUG:-false}" = "true" ]; then
    echo "[$(date -u +%FT%TZ)] $*" >> "$DEBUG_LOG"
  fi
}

if [ $# -lt 1 ]; then
  echo '{"error":"Usage: query.sh '\''ELISP-EXPRESSION'\''"}' >&2
  exit 1
fi

ELISP_EXPR="$1"
_debug "INPUT: $ELISP_EXPR"

TMPDIR_QUERY=$(mktemp -d)
STDOUT_FILE="$TMPDIR_QUERY/stdout"
STDERR_FILE="$TMPDIR_QUERY/stderr"
trap "rm -rf '$TMPDIR_QUERY'" EXIT

emacs --batch \
  --eval "(progn $BOOTSTRAP (condition-case err (princ (progn $ELISP_EXPR)) (error (princ (format \"*ERROR* %s\" (error-message-string err))))))" \
  >"$STDOUT_FILE" 2>"$STDERR_FILE" || true

RAW=$(cat "$STDOUT_FILE")
STDERR_RAW=$(cat "$STDERR_FILE")

_debug "EMACS STDOUT: $RAW"
[ -n "$STDERR_RAW" ] && _debug "EMACS STDERR: $STDERR_RAW"

# Elisp-level error
if [[ "$RAW" == *ERROR* ]]; then
  MSG="${RAW##*\*ERROR\* }"
  _debug "ELISP ERROR: $MSG"
  echo "{\"error\":\"$MSG\"}" >&2
  exit 1
fi

# Strip outer quotes and unescape inner quotes (emacs wraps JSON in quotes)
CLEAN=$(echo "$RAW" | head -1 | sed 's/^"//;s/"$//' | sed 's/\\"/"/g')

# Empty output
if [ -z "$(echo "$CLEAN" | tr -d '[:space:]')" ]; then
  ERR=$(head -1 "$STDERR_FILE" | tr -d '\n')
  if [ -n "$ERR" ]; then
    _debug "EMPTY OUTPUT, STDERR: $ERR"
    echo "{\"error\":\"$ERR\"}" >&2
  else
    _debug "EMPTY OUTPUT, NO STDERR"
    echo '{"error":"Empty response from emacs"}' >&2
  fi
  exit 1
fi

# Validate JSON-like output
if [[ "$CLEAN" != "{"* && "$CLEAN" != "["* ]]; then
  _debug "INVALID JSON: $CLEAN"
  echo "{\"error\":\"Invalid output: $(echo "$CLEAN" | cut -c1-80)\"}" >&2
  exit 1
fi

_debug "OUTPUT OK (${#CLEAN} chars)"
echo "$CLEAN"

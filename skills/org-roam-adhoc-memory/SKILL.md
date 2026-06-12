---
name: org-roam-adhoc-memory
description: Query and modify the org-roam knowledge base. Use for searching notes, retrieving content, exploring links, traversing the graph, creating notes, or appending journal entries. All operations use bash scripts — never construct elisp manually.
---

# Org-Roam Adhoc Memory

Query and modify your org-roam zettelkasten via dedicated bash scripts.
**Never construct elisp s-expressions yourself** — use the scripts below.

All scripts return JSON on stdout. Errors return JSON on stderr with exit code 1.
Pipe to `jq .` for readable output.

Scripts live at: `~/.agents/skills/org-roam-adhoc-memory/scripts/`

## Search

```bash
scripts/search.sh "query" [max_results]
```

Searches node titles, aliases, and properties. Defaults to 10 results.

```bash
scripts/search.sh "project-x" 5
```

## Retrieve

```bash
scripts/retrieve.sh --id UUID
scripts/retrieve.sh --title "Title"
```

Decrypts `.org.gpg` files transparently. Returns `title`, `file`, `content`.

## Links

```bash
scripts/links.sh --id UUID [outgoing|incoming|both]
scripts/links.sh --title "Title" [outgoing|incoming|both]
```

Defaults to `both`. Shows connected nodes in requested direction(s).

## Graph Traversal

```bash
scripts/graph.sh --id UUID [max_hops]
scripts/graph.sh --title "Title" [max_hops]
```

Multi-hop BFS. `max_hops` is 1-3, defaults to 2.

## Create Note

```bash
scripts/create.sh "Title" "Content" [--file PATH] [--tags TAG1 TAG2]
```

Auto-picks file path if `--file` omitted. Auto-encrypts to `.org.gpg`.

## Append Journal

```bash
scripts/append-journal.sh "Content" [YYYY-MM-DD]
```

Date defaults to today.

## List Nodes

```bash
scripts/list-nodes.sh [max]
```

Lists all nodes, capped at `max` (default 100).

## Error Handling

All scripts return clean JSON. On failure:
- Stderr contains `{"error":"message"}`
- Exit code is 1
- Stdout is empty

Check errors before parsing stdout:
```bash
result=$(scripts/search.sh "test" 2>/tmp/or_err) || { cat /tmp/or_err; exit 1; }
echo "$result" | jq .
```

## Debugging

Set `ORG_ROAM_PI_MEMORY_DEBUG=true` to log all activity (input, emacs output, errors):

```bash
ORG_ROAM_PI_MEMORY_DEBUG=true scripts/search.sh "test"
```

Log file paths are configured in `config.json` under the `debug` key. Paths support `~` expansion.

## Config

All settings in `~/.pi/agent/org-roam-memory/config.json`. Example debug config:

```json
{
  "debug": {
    "log-file": "~/tmp/org-roam-pi-memory-debug.log",
    "context-file": "~/tmp/org-roam-pi-memory-context.log"
  }
}
```

- `log-file`: Debug log for skill scripts, TypeScript extension, and Elisp library
- `context-file`: Separate log for full memory context output (avoids cluttering debug logs)

Both Node.js (`expandTilde`) and Elisp (`expand-file-name`) expand `~` to `$HOME`.

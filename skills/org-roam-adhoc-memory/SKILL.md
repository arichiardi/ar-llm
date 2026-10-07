---
name: org-roam-adhoc-memory
description: Query and modify the org-roam knowledge base. Use for searching notes, retrieving content, exploring links, traversing the graph, creating notes, or appending journal entries. All operations use bash scripts — never construct elisp manually.
compatibility: Requires bash, jq, and a running emacsclient with org-roam. The scripts load the Elisp library from the pi agent extensions directory and read config from ar-llm/org-roam-adhoc-memory.json.
---

# Org-Roam Adhoc Memory

Query and modify your org-roam zettelkasten via dedicated bash scripts.
**Never construct elisp s-expressions yourself** — use the scripts below.

All scripts return JSON on stdout. Errors return JSON on stderr with exit code 1.
Pipe to `jq .` for readable output.

Scripts live at: `$PI_CODING_AGENT_DIR/skills/org-roam-adhoc-memory/scripts/` (default `~/.config/pi/agent/skills/org-roam-adhoc-memory/scripts/`).

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

## Add Child Heading

```bash
scripts/add-child.sh TARGET PARENT_TITLE CHILD_TITLE CONTENT [--tags TAG1 TAG2]
```

Inserts a new heading under an existing heading, in that heading's own file.
Use this to nest content under a node, or under a heading that has no ID.

- `TARGET` is a node ID or a node file path (relative to the roam directory).
- `PARENT_TITLE` is the exact headline title to nest under. Use `""` to add a
  top-level heading at the end of the file.
- The new heading gets its own ID and the level below the parent.
- The file is encrypted when it ends in `.org.gpg`.
- Use `-` for list items in `CONTENT`. Lines that start with `*` are rejected.

```bash
scripts/add-child.sh comcast.org.gpg "People" "Pradeep George" "Comcast colleague."
```

This is the general form of adding a heading. `create.sh` only makes files or
appends top-level headings; use `add-child.sh` to edit an existing node.

## Edit Entry

```bash
scripts/edit-entry.sh TARGET TITLE CONTENT
```

Replaces the body of an existing heading, in that heading's own file.
Use this to rewrite an entry that already exists, instead of adding a second
copy of it.

- `TARGET` is a node ID or a node file path (relative to the roam directory).
- `TITLE` is the exact headline title to replace the body of.
- The headline, its property drawer and its ID stay unchanged.
- Everything between the property drawer and the end of the section is
  replaced. Subheadings of `TITLE` are preserved.
- Use `-` for list items in `CONTENT`. Lines that start with `*` are rejected.

```bash
scripts/edit-entry.sh life.org.gpg "KeePass Password Safe" "KeePass stores all passwords."
```

The command fails with `Headline not found` when no heading has that title.
Use `retrieve.sh` first to confirm the title.

## Append Journal

```bash
scripts/append-journal.sh TITLE CONTENT [--date YYYY-MM-DD]
```

Date defaults to today. The file `<journal-dir>/YYYY-MM-DD.org.gpg` is an
org-roam node, not an org-roam daily. This command:

- creates the file with a file-level `:ID:` and a `* YYYY-MM-DD` title when missing
- repairs a file that has no top-level title
- appends `** HH:MM TITLE` followed by `CONTENT` as a level-2 section
- encrypts, because the file ends in `.org.gpg`

Use `-` for list items inside `CONTENT`. Lines that start with `*` are
rejected, because in Org they create headings and break the file structure.

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
err=$(mktemp)
result=$(scripts/search.sh "test" 2>"$err") || { cat "$err"; exit 1; }
echo "$result" | jq .
```

## Debugging

Set `ORG_ROAM_PI_MEMORY_DEBUG=true` to log all activity (input, emacs output, errors):

```bash
ORG_ROAM_PI_MEMORY_DEBUG=true scripts/search.sh "test"
```

Log file paths are configured in `ar-llm/org-roam-adhoc-memory.json` under the `debug` key. Paths support `~` expansion.

## Config

All settings in `$PI_CODING_AGENT_DIR/ar-llm/org-roam-adhoc-memory.json` (default `~/.config/pi/agent/ar-llm/org-roam-adhoc-memory.json`). Example debug config using a temp directory:

```json
{
  "debug": {
    "log-file": "/tmp/org-roam-adhoc-memory-debug.log",
    "context-file": "/tmp/org-roam-adhoc-memory-context.log"
  }
}
```

Use any writable temp directory, for example `/tmp` or `~/tmp`.

- `log-file`: Debug log for the skill scripts and the Elisp library
- `context-file`: Separate log for the full memory context output

The Elisp library expands `~` with `expand-file-name`.

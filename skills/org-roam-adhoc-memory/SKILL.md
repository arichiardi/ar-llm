---
name: org-roam-adhoc-memory
description: Query and modify the org-roam knowledge base. Use when the user asks what you know about a topic, to remember or add a note, to append a journal entry, or to search, read, link, or traverse existing notes. All operations use bash scripts. Never call org or org-roam functions directly and never construct elisp manually.
compatibility: Requires bash, jq, and a running emacsclient with org-roam. The scripts load the bundled Elisp library (org-roam-adhoc-memory.el in the skill directory) and read config from ar-llm/org-roam-adhoc-memory.json.
---

# Org-Roam Adhoc Memory

Act as a careful librarian of this vault: read before you write, and never
invent structure.

Query and modify your org-roam zettelkasten via the dedicated bash scripts
below.

**Never call `org`, `org-roam`, `org-id`, or `org-capture` functions
directly** - not with `emacsclient`, not through the REPL, not by any other
route. Never construct elisp s-expressions yourself. Every read and every
write goes through the scripts. This keeps every node ID a standard UUID, so
new nodes match the rest of the vault. If a script cannot do what you need,
ask the user; do not reach for the underlying functions.

```bash
# Bad: bypasses the scripts, no UUID guarantee.
emacsclient --eval '(org-id-get-create)'
# Good: the supported path.
scripts/create.sh "Title" "Content"
```

Scripts live at `$PI_CODING_AGENT_DIR/skills/org-roam-adhoc-memory/scripts/`
(default `~/.config/pi/agent/skills/org-roam-adhoc-memory/scripts/`).

All scripts return JSON on stdout. Errors return JSON on stderr with exit code 1.
Pipe to `jq .` for readable output.

**Wrap every script call in `timeout 30`.** Some calls decrypt `.org.gpg`
files and can open a gpg passphrase dialog. Without a timeout, the call
blocks until the user answers the dialog. See
[GPG passphrase timeout](#gpg-passphrase-timeout).

## How to work

The scripts are independent building blocks. Combine them in any order the
task needs; only two orderings are mandatory.

1. Run `scripts/sync.sh --check` once at session start, before any other
   call. See [Sync](#sync-check-first-ask-before-pulling).
2. Read before you write. Locate the node, confirm its exact title or ID,
   then write. After a write, verify it (see
   [Verify a write](#verify-a-write)).

Pick the script by intent:

| Intent | Script |
| --- | --- |
| Find nodes by text | `search.sh` |
| Read one node | `retrieve.sh` |
| Neighbors of a node | `links.sh` |
| Multi-hop neighborhood | `graph.sh` |
| New file or top-level heading | `create.sh` |
| Heading under an existing node | `add-child.sh` |
| Rewrite an existing body | `edit-entry.sh` |
| Journal entry for a date | `append-journal.sh` |
| List all nodes | `list-nodes.sh` |

Flows mix freely. For example, `search.sh` -> `retrieve.sh` -> `graph.sh` ->
`retrieve.sh` to explore, or `search.sh` -> `retrieve.sh` ->
`edit-entry.sh` -> `retrieve.sh` to change one body. There is no single
required sequence beyond the two rules above.

## Script output

All scripts return JSON.

`search.sh` and `list-nodes.sh` return an array of node objects:

```jsonc
{"title": "...", "id": "<uuid>", "file": "<path relative to roam dir>",
 "level": 2, "todo": "", "priority": "", "tags": [], "aliases": [],
 "refs": [], "properties": {}}
```

`retrieve.sh` returns one object:

```jsonc
{"title": "...", "file": "...", "content": "...", "truncated": false}
```

`links.sh` returns one object with neighbor arrays:

```jsonc
{"title": "...", "id": "<uuid>", "outgoing": [node, ...], "incoming": [node, ...]}
```

`graph.sh` returns an array of hop entries:

```jsonc
[{"title": "...", "id": "<uuid>", "hop": 0}]
```

## Sync (check first, ask before pulling)

At the start of a session, before any other operation, check whether the
vault is behind its remote:

```bash
scripts/sync.sh --check
```

The check fetches from the remote (about 1 s) and reports
`{"status":"up-to-date"|"behind","behind":N,"ahead":N,"dirty":bool}`.
It never modifies the working tree.

- `status` is `up-to-date`: proceed.
- `behind` is greater than 0: tell the user the vault is N commits behind
  and ask whether to sync. Syncing pulls the remote notes and takes longer
  than a normal call. On yes, run `scripts/sync.sh`. On no, proceed with
  the stale vault, state in your results that the vault is stale, and do
  not ask again this session.
- `dirty` is true: report the local uncommitted changes to the user. Do not
  pull.
- The check fails (network error): proceed without syncing and mention it
  once. Do not retry.

`scripts/sync.sh` without flags does two steps. First it runs
`git pull --ff-only` in the roam repository. The pull is fast-forward only:
it never rewrites local history. Then it refreshes the org-roam database
with `org-roam-db-sync`, so notes pulled from the remote and notes written
by this session become visible to search and retrieve. Without the database
refresh, every query stays stale.

On a git failure (diverged branches, network error), do not retry with force
flags. Report the error to the user and continue only when the user says to.
If the pull succeeds but the database refresh fails, report both parts. The
queries stay stale until the database sync succeeds.

`scripts/db-sync.sh` refreshes the database only and leaves git alone. Run
it after `create.sh`, `append-journal.sh`, `add-child.sh`, or
`edit-entry.sh`, because those write files but do not index them.

## Errors (read before retrying a failure)

A failed script returns `{"error":"message"}` on stderr with exit code 1.
Match the message to a category below. Then act. Never retry a failing
command without a user response, except where stated.

### Node or heading not found

```
*ERROR*: Node not found
*ERROR*: Entry not found: <title>
*ERROR*: Parent heading not found: <title>
```

The title or ID did not match anything.

- Do not retry the same call unchanged.
- Run `scripts/search.sh "query"` to find the node. Then run
  `scripts/retrieve.sh --title "Title"` to read the exact title and ID.
- Repeat the original call with the corrected title or ID.

### Temp file not visible to Emacs

```
*ERROR*: Opening output file: No such file or directory, /tmp/query.XXXXXX/result
```

The pi sandbox mounts a private `/tmp`. The script creates its working
directory there. The host Emacs server cannot see that directory.

- Do not retry.
- Tell the user to set `ORG_ROAM_PI_MEMORY_TMPDIR` to a shared directory.
  Use a directory that both the pi process and the Emacs server can see.

  ```bash
  export ORG_ROAM_PI_MEMORY_TMPDIR="$HOME/tmp"
  ```

### GPG passphrase timeout

Decrypting `.org.gpg` files can open a gpg passphrase dialog. The user can be
away from the screen. The call then blocks until the user answers.

- If the command exits with code 124, the dialog waits for the user.
- On timeout, do not retry. Tell the user that a gpg passphrase dialog is
  open. Ask when you can retry.
- Retry only after the user confirms the dialog is answered or ready.

```bash
timeout 30 scripts/retrieve.sh --id UUID
```

### GPG cannot encrypt

```
*ERROR*: GPG did not produce encrypted file
```

or a `gpg:` error that names a missing key (`No public key`, `No secret key`).

Encryption runs gpg inside the Emacs server. It uses the `gpg-encrypt-to`
recipients from the config file.

- Do not retry.
- Ask the user to check the gpg key and agent in the Emacs environment.
  Run `gpg -K` and `gpgconf --list-all`. Retry only after the user confirms
  that the key is available.

## Search

```bash
scripts/search.sh "query" [max_results]
```

Searches node titles, aliases, and properties. Defaults to 10 results.

```bash
timeout 30 scripts/search.sh "project-x" 5
```

## Retrieve

```bash
scripts/retrieve.sh --id UUID
scripts/retrieve.sh --title "Title"
```

Decrypts `.org.gpg` files transparently. Returns `title`, `file`, `content`,
`truncated`.

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

New top-level files use the file-level node template:

```
:PROPERTIES:
:ID:       <id>
:END:
#+TITLE: Title
#+AUTHOR: Andrea Richiardi
```

> **ID format**: IDs are standard org-id UUIDs: 36 lowercase hex characters
> with dashes, in the 8-4-4-4-12 layout (e.g.
> `9da3c48e-dd72-4a14-bd97-38e617cc9064`). The scripts generate this format.
> Copy IDs verbatim from script output; never invent, shorten, or reformat
> one.

Notes added to an existing file become top-level `*` headings with their own `:ID:`.

> **Rule**: a top-level file must contain at least one `*` heading, or it is
> empty and useless. Before creating a new top-level file, check that the
> content argument includes at least one `*` section (e.g. `* Overview`). If
> it does not, ask the user for the sections the file should contain before
> creating it.

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

## Verify a write

After any successful `create.sh`, `add-child.sh`, `edit-entry.sh`, or
`append-journal.sh`, confirm the result before you report success:

```bash
timeout 30 scripts/retrieve.sh --id <returned-id>
```

The node must exist and its `:ID:` must be a UUID. For `edit-entry.sh`, run
`retrieve.sh` first to confirm the exact title; the command fails with
`Headline not found` on a mismatch.

## Error Handling

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

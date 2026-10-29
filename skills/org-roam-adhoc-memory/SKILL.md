---
name: org-roam-adhoc-memory
description: Query and modify the org-roam knowledge base. Use for searching notes, retrieving content, exploring links, traversing the graph, creating notes, or appending journal entries. All operations use bash scripts. Never construct elisp manually.
compatibility: Requires bash, jq, and a running emacsclient with org-roam. The scripts load the bundled Elisp library (org-roam-adhoc-memory.el in the skill directory) and read config from ar-llm/org-roam-adhoc-memory.json.
---

# Org-Roam Adhoc Memory

Query and modify your org-roam zettelkasten via dedicated bash scripts.
**Never construct elisp s-expressions yourself.** Use the scripts below.

All scripts return JSON on stdout. Errors return JSON on stderr with exit code 1.
Pipe to `jq .` for readable output.

**Wrap every script call in `timeout 30`.** Some calls decrypt `.org.gpg`
files and can open a gpg passphrase dialog. Without a timeout, the call
blocks until the user answers the dialog. See
[GPG passphrase timeout](#gpg-passphrase-timeout-must).

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

`scripts/sync.sh` without flags runs `git pull --ff-only` in the roam
repository. The pull is fast-forward only: it never rewrites local history.
On failure (diverged branches, network error), do not retry with force
flags. Report the error to the user and continue only when the user says to.

## Errors (read before retrying a failure)

A failed script returns `{"error":"message"}` on stderr with exit code 1.
Match the message to a category below. Then act. Never retry a failing
command without a user response, except where stated.

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

### GPG passphrase timeout (MUST)

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

Scripts live at: `$PI_CODING_AGENT_DIR/skills/org-roam-adhoc-memory/scripts/` (default `~/.config/pi/agent/skills/org-roam-adhoc-memory/scripts/`).

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

New top-level files use the file-level node template:

```
:PROPERTIES:
:ID:       <id>
:END:
#+TITLE: Title
#+AUTHOR: Andrea Richiardi
```

> **ID format**: always use the org-id new format: 32 uppercase hex
> characters, no dashes (e.g. `9B2463379F7A1FA07C4989C56021E923`). The
> scripts generate this format. When you supply or reference an ID yourself,
> match it. Never use dashed UUIDs, to avoid mixing formats in the vault.

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

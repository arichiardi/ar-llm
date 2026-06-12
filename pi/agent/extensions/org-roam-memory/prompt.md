# Org-Roam Memory

The following context is loaded from your org-roam knowledge base. It represents your identity, recent activity, and open work items. Reference these facts when relevant to the conversation.

## How to Use This Context

- **Identity**: The entry node neighborhood describes who you are, what you work on, and key relationships.
- **Journal entries**: Recent journal entries show what you've been working on. Use them for temporal context.
- **Open TODOs**: These are active work items you want tracked. Mention them when relevant.

## Querying Your Knowledge Base

When you need information not covered in the ambient context above, use the org-roam tools:

- `org-roam-search` — keyword search across node titles and properties
- `org-roam-retrieve` — get full content of a node by ID or title (decrypts .gpg files)
- `org-roam-links` — show graph neighbors (outgoing links, incoming backlinks, or both)
- `org-roam-graph` — multi-hop BFS traversal through the link graph

For complex org-mode operations (editing files, running queries), prefer calling `emacsclient --eval "..."` when available, as it uses org-roam's native Elisp API and avoids database schema issues. If emacsclient is not available or fails, fall back to the org-roam tools.

When decrypting .gpg files fails, ask the user to unlock their GPG agent before proceeding.

---
name: git-repo-slimming
description: |
  Shrink a git repository whose clone is slow because history carries large
  binary blobs (password databases, key backups, archives). Diagnose blob
  size by path, back up with a mirror clone, purge obsolete paths and
  truncate secrets history with git-filter-repo, verify the tree is
  unchanged, and prepare a force-push. Use when a clone is slow, a repo is
  too large, or the user asks to purge old secrets or key backups from
  history.
compatibility: Needs git and git-filter-repo.
---

# Git Repo Slimming

Reduce clone size without changing the working tree. History rewriting is
irreversible. Work on a clone, never on the live working repository.

## Golden rules

- Never decrypt secrets or key backups.
- Never force-push without explicit user confirmation.
- Keep GPG key backup history unless the user confirms removal.
- Default secrets cutover is 1 year. Ask before changing it.
- Purge a path only when it is absent from HEAD, or the user confirms.

## Phase 0 - Prepare (mandatory)

Do this before any other action.

1. Ask the user where to put the backup and the cleaned clone. This is
   required before any file is written. If the user does not choose, default
   to `${TMPDIR:-/tmp}`.
   ```shell
   WORKDIR="${TMPDIR:-/tmp}"   # or the path the user chose
   ```
2. Back up the original repository from its git remote. Do not back up from
   the local working tree; the remote is the source of truth.
   ```shell
   git remote -v
   git clone --mirror "$(git remote get-url origin)" "$WORKDIR/<repo>-backup.git"
   ```
3. Verify the backup against the source:
   ```shell
   du -sh "$WORKDIR/<repo>-backup.git"
   git -C "$WORKDIR/<repo>-backup.git" count-objects -v
   git -C "$WORKDIR/<repo>-backup.git" rev-parse HEAD
   ```
   Compare the object counts and `HEAD` with the source. Stop if they differ.
4. If the repo has stashes, export them:
   ```shell
   mkdir -p "$WORKDIR/<repo>-stash"
   for i in $(seq 0 $(($(git stash list | wc -l) - 1))); do
     git stash show -p "stash@{$i}" > "$WORKDIR/<repo>-stash/stash-$i.patch"
   done
   ```

## Phase 1 - Diagnose (read-only)

1. Measure the repository:
   ```shell
   git count-objects -vH
   du -sh .git
   ```
2. List reachable blobs by size:
   ```shell
   git rev-list --objects --all \
     | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
     | awk '$1=="blob"{print $3, $4}' | sort -rn | head -30
   ```
3. Sum historical bytes per path:
   ```shell
   git rev-list --objects --all \
     | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
     | awk '$1=="blob" && $4!=""{print $3"\t"$4}' \
     | awk -F'\t' '{sz[$2]+=$1; n[$2]++} END{for(k in sz) printf "%10.1f MiB %5d  %s\n", sz[k]/1048576, n[k], k}' \
     | sort -rn | head -30
   ```
4. Find paths that are no longer in HEAD:
   ```shell
   comm -23 <(git log --all --pretty=format: --name-only --diff-filter=A | sort -u | grep -v '^$') \
            <(git ls-tree -r --name-only HEAD | sort)
   ```
5. Compare author and committer dates. A prior rewrite resets committer
   dates, so `--shallow-since` can fail. Always truncate by author date.
   ```shell
   git log --format='%cd' --date=format:'%Y' | sort | uniq -c
   git log --format='%ad' --date=format:'%Y' | sort | uniq -c
   ```

## Phase 2 - Decide

- **Obsolete path** (not in HEAD, user confirms): purge it from all history.
- **`secrets/`**: truncate to the last 1 year by author date.
- **Key or GPG backups** (for example `keys/`): keep. Old encrypted files in
  history need the old subkeys. Ask before removing.
- Report measured sizes for each option. Do not guess.

## Phase 3 - Rewrite in a clone

```shell
git clone --no-local /path/to/repo "$WORKDIR/<repo>-cleaned"
cd "$WORKDIR/<repo>-cleaned"
CUT=$(date -u -d '1 year ago' +%s)
git filter-repo --force --prune-empty always \
  --invert-paths \
  --path path/to/obsolete \
  --commit-callback "
ts = float(commit.author_date.split()[0])
if ts < $CUT:
    commit.file_changes = [fc for fc in commit.file_changes if not fc.filename.startswith(b'secrets/')]
"
git remote add origin <original-url>
```

Notes:

- `filter-repo` removes `origin`; restore it.
- The commit callback drops changes to `secrets/` older than the cutover.
  Commits that only touched those files become empty and disappear.
- Add one `--path` for each obsolete path. `--invert-paths` removes them.
- The callback runs per commit with `commit` in scope. Do not define a
  function; write the body directly.

## Phase 4 - Verify

1. Working tree unchanged:
   ```shell
   git rev-parse HEAD^{tree}   # compare with the original HEAD tree
   ```
2. Integrity:
   ```shell
   git fsck --full --strict
   git count-objects -vH
   ```
3. Purged paths gone:
   ```shell
   git log --all --oneline -- <obsolete-path> | wc -l   # expect 0
   ```
4. Current secret files still present:
   ```shell
   git ls-tree -r -l HEAD -- secrets
   ```
5. No leftovers: no shallow file, no replace refs, only the expected refs.

## Phase 5 - Push (needs explicit confirmation)

Force-push rewrites the remote. Ask once, then run:

```shell
git push --force origin <branch>
```

Tell the user:

- Other clones and forks keep the old objects until deleted and re-cloned.
- GitHub may retain unreachable objects. Contact support to purge them.
- Every commit hash changes.

## Reporting

State which checks ran. Do not claim the clone is faster. Report the pack
size before and after, and the tree hash match.

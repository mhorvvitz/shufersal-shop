#!/bin/bash
# Commit & push personal data changes to the private data repo, and pull down changes
# made elsewhere. Run after anything that edits the dictionary or the suggester cache
# (curating aliases, swapping a stale product code, `suggest --refresh`).
#
# The link script (link-personal-data.sh) makes edits *land* in the data repo's working
# tree via symlinks; this script is the other half — getting them into git and across
# machines. Pull first, then push, so a laptop and a cloud session converge on the same
# files instead of drifting.
#
# Only ever touches the two known files. Never `git add -A`: the data repo may hold
# other private things that are none of this script's business.

set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILES=(product-dictionary.json order-stats.json)

# Prefer the truth of the existing symlink; fall back to the same candidates the
# link script searches, so the two scripts can never disagree about where data lives.
data_dir=""
if [ -L "$SKILL_DIR/product-dictionary.json" ]; then
  data_dir="$(dirname "$(readlink -f "$SKILL_DIR/product-dictionary.json")")"
else
  for candidate in "${SHUFERSAL_DATA_DIR:-}" "$SKILL_DIR/../shufersal-shop-data" "$SKILL_DIR/../shufersal-data"; do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      data_dir="$(cd "$candidate" && pwd)"
      break
    fi
  done
fi

if [ -z "$data_dir" ] || [ ! -d "$data_dir/.git" ]; then
  echo "sync-personal-data: no data repo found (or it isn't a git checkout); nothing to sync." >&2
  exit 0
fi

cd "$data_dir"
echo "sync-personal-data: syncing $data_dir" >&2

# Copy mode: the skill dir holds a real file, not a link — either Windows without symlink
# support, or a file that was created before link-personal-data.sh ran (bootstrap). Bring
# it into the data repo before committing; a file the data repo doesn't have yet is copied
# in rather than skipped, so a first-ever build still ends up synced.
copy_mode=0
for file in "${FILES[@]}"; do
  skill_file="$SKILL_DIR/$file"
  if [ -f "$skill_file" ] && [ ! -L "$skill_file" ]; then
    copy_mode=1
    if [ ! -f "$data_dir/$file" ] || ! cmp -s "$skill_file" "$data_dir/$file"; then
      cp -f "$skill_file" "$data_dir/$file"
      echo "sync-personal-data: copied $file from the skill directory (copy mode)." >&2
    fi
  fi
done

# Commit FIRST: uncommitted edits are the normal state here (the runners write through
# the symlinks), and `pull --rebase` refuses to run on top of a dirty tree.
changed=0
for file in "${FILES[@]}"; do
  if [ -n "$(git status --porcelain -- "$file")" ]; then
    git add -- "$file"
    changed=1
  fi
done

if [ "$changed" -eq 1 ]; then
  git commit --quiet -m "Update personal data ($(date -u +%Y-%m-%d) $(hostname -s 2>/dev/null || echo unknown))"
  echo "sync-personal-data: committed local changes." >&2
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "sync-personal-data: no remote configured; committed locally only." >&2
  exit 0
fi

branch="$(git branch --show-current)"
if [ -z "$branch" ]; then
  echo "sync-personal-data: detached HEAD in $data_dir — commit kept locally, not pushed." >&2
  exit 0
fi

# Now the tree is clean: pull what other machines pushed, then push ours. Rebase keeps a
# linear history; on conflict, bail out and tell the human, because auto-resolving a
# conflicted shopping dictionary silently loses edits.
if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  if ! git pull --rebase --quiet origin "$branch"; then
    git rebase --abort 2>/dev/null || true
    echo "sync-personal-data: pull hit a conflict — resolve it in $data_dir by hand, then rerun." >&2
    exit 1
  fi
fi

if [ -n "$(git log --oneline "origin/$branch..$branch" 2>/dev/null || git log --oneline HEAD)" ]; then
  if git push --quiet origin "$branch"; then
    echo "sync-personal-data: in sync (pushed)." >&2
  else
    echo "sync-personal-data: commit kept locally, but push failed — run 'git push' in $data_dir when you can." >&2
    exit 1
  fi
else
  echo "sync-personal-data: already in sync." >&2
fi

# In copy mode, propagate what the pull brought down back to the skill directory,
# so the runners see edits made on other machines.
if [ "$copy_mode" -eq 1 ]; then
  for file in "${FILES[@]}"; do
    skill_file="$SKILL_DIR/$file"
    if [ -f "$data_dir/$file" ] && [ -f "$skill_file" ] && [ ! -L "$skill_file" ]; then
      cmp -s "$data_dir/$file" "$skill_file" || cp -f "$data_dir/$file" "$skill_file"
    fi
  done
fi

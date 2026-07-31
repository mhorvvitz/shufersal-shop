#!/bin/bash
# Link this skill's personal data files in from a separate private repository.
#
# product-dictionary.json and order-stats.json are gitignored here: this repo is public,
# and both files describe what a specific household buys. That is fine on the machine that
# created them, but a cloud session starts from a fresh clone and has neither — so the add
# runner refuses to match anything.
#
# The fix is a second, private repo holding just those files, attached to the session
# alongside this one. This script finds it and symlinks the files into place.
#
# Symlinks rather than copies, so that when Claude curates the dictionary (adds an alias,
# swaps a discontinued product code) the edit lands in the data repo and can be committed.
#
# Never fails a session: every path exits 0. A missing data repo is reported and skipped,
# because plenty of uses (search, view-cart, check-browser) need no dictionary at all.

set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILES=(product-dictionary.json order-stats.json)

# Candidate locations, best first: an explicit override, then siblings of this checkout,
# which is where a multi-repo cloud session puts co-attached repositories.
CANDIDATES=(
  "${SHUFERSAL_DATA_DIR:-}"
  "$SKILL_DIR/../shufersal-shop-data"
  "$SKILL_DIR/../shufersal-data"
)

data_dir=""
for candidate in "${CANDIDATES[@]}"; do
  if [ -n "$candidate" ] && [ -d "$candidate" ]; then
    data_dir="$(cd "$candidate" && pwd)"
    break
  fi
done

if [ -z "$data_dir" ]; then
  echo "link-personal-data: no data repo found; skipping." >&2
  echo "  Looked for \$SHUFERSAL_DATA_DIR, ../shufersal-shop-data, ../shufersal-data" >&2
  echo "  Commands needing the product dictionary will say so when you run them." >&2
  exit 0
fi

echo "link-personal-data: using $data_dir" >&2

for file in "${FILES[@]}"; do
  source_file="$data_dir/$file"
  target="$SKILL_DIR/$file"

  if [ ! -e "$source_file" ]; then
    echo "  - $file: not in the data repo, skipping" >&2
    continue
  fi

  # A real file here was put there deliberately (the normal local setup). Never clobber it;
  # only replace a stale symlink we would have created ourselves.
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "  - $file: already present locally, leaving it alone" >&2
    continue
  fi

  ln -sfn "$source_file" "$target"
  echo "  - $file: linked" >&2
done

exit 0

#!/bin/bash
# SessionStart hook: prepare a cloud session to actually run the skill.
#
# Local checkouts already have node_modules and their own personal data files, so the
# install is scoped to cloud sessions via CLAUDE_CODE_REMOTE. The data linking runs
# everywhere — it is a no-op when the files are already present.

set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ ! -d "$SKILL_DIR/node_modules" ]; then
  echo "session-start: installing dependencies" >&2
  (cd "$SKILL_DIR" && npm install --no-audit --no-fund) >&2 || {
    echo "session-start: npm install failed — run it by hand before using the runners." >&2
  }
fi

bash "$SKILL_DIR/scripts/link-personal-data.sh"

exit 0

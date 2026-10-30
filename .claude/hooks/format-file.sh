#!/usr/bin/env bash
# PostToolUse hook: format and lint the file Claude just edited.
# Exit code 2 sends remaining ESLint errors back to Claude as feedback.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // empty')
[ -n "$file" ] && [ -f "$file" ] || exit 0

cd "$CLAUDE_PROJECT_DIR" || exit 0

case "$file" in
  */node_modules/* | */dist/* | */coverage/*) exit 0 ;;
esac

case "$file" in
  *.ts | *.tsx | *.js | *.mjs | *.json | *.md | *.yml | *.yaml | *.css | *.html)
    pnpm exec prettier --write --log-level warn "$file" >/dev/null 2>&1
    ;;
esac

case "$file" in
  *.ts | *.tsx | *.js | *.mjs)
    if ! out=$(pnpm exec eslint --fix "$file" 2>&1); then
      echo "$out" >&2
      exit 2
    fi
    ;;
esac

exit 0

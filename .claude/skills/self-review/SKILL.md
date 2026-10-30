---
name: self-review
description: Review the current uncommitted changes against the project rules in CLAUDE.md before reporting work as done.
---

# Self-review

1. Collect the changes: `git status --short` and `git diff` (plus untracked files).
2. Delegate the review to the `code-reviewer` subagent, passing the list of changed files and the goal of the change.
3. Check the findings yourself; drop the ones that are wrong.
4. Report in Ukrainian: confirmed issues ranked by severity, each with file:line and a suggested fix. Do not apply fixes until the user approves.

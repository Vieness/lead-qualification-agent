---
name: plan-task
description: Analyze a requested change and present an implementation plan for approval before writing any code. Use at the start of every new feature, fix or refactor in this repo.
---

# Plan a task

Follow the "Analyze → plan → wait for approval → implement" rule from CLAUDE.md.

1. **Analyze.** Read `docs/DEVELOPMENT.md` (decisions so far), the files the change touches, and their tests. Check library APIs with the context7 MCP server when unsure about current syntax.
2. **Write the plan** in Ukrainian, short:
   - Goal: one sentence.
   - Files: new / changed, with one line each on what changes.
   - Design notes: schemas, interfaces, edge cases, guardrails affected.
   - Verification: which tests are added and how the result will be checked (`make check`, manual scenario).
   - Open questions, if any decision belongs to the user.
3. **Stop.** Do not edit files until the user approves. Do not commit or push.

Task: $ARGUMENTS

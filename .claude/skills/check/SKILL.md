---
name: check
description: Run lint, format check, typecheck and tests for the whole repo and report the result.
---

# Check

Run from the repo root:

```bash
make check
pnpm format:check
```

Report in Ukrainian:

- ✅/❌ per step (lint, format, typecheck, tests) with the test count.
- For failures: file, line and the error message, plus the likely cause.

Do not fix anything unless the user asks.

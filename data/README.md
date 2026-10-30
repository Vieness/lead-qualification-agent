# Data

| Folder       | Contents                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| `samples/`   | Inbound leads used for demos and e2e tests (`*.json`, one lead per file) |
| `expected/`  | Expected agent output for each sample (same file name)                   |
| `portfolio/` | Agency case studies (`*.md`) indexed for `search_portfolio`              |

Samples cover: hot, cold, vague and incomplete leads, big budgets (USD/EUR/UAH, human approval), spam, German and Ukrainian leads, an impossible deadline, a personal email, payment data in the message, and 8 prompt-injection attacks. Every sample must have an expectation; `pnpm eval` and `tests/e2e/samples.test.ts` fail otherwise.

# CLAUDE.md

Project guide for AI coding assistants working in this repository.

## Project

Lead Qualification Agent: a multi-agent system that takes an inbound agency lead, extracts requirements, enriches company data, matches portfolio cases, scores the lead with deterministic rules and drafts a reply. Guardrails and human approval apply to high-stakes leads. This is a test assignment for an "AI Developer (Full Stack / AI Automation)" role; `docs/DEVELOPMENT.md` records the stages and decisions, `docs/TECH_CHOICES.md` explains the stack.

## Working rules (mandatory)

1. **Analyze → plan → wait for approval → implement.** Before writing or changing code, read the relevant files, then present a short plan (what changes, which files, how it will be verified). Do not implement until the user explicitly approves the plan. Small follow-ups inside an approved plan do not need a new approval; anything outside it does.
2. **No git writes without a direct request.** Never run `git commit`, `git push`, `git tag`, `git rebase`, `git reset --hard`, branch deletion, or open pull requests unless the user explicitly asks for that exact action in their current message. Read-only git commands (`status`, `diff`, `log`) are fine.
3. **Verify before reporting done.** Run `make check` (lint, typecheck, tests) after code changes and report the real result, including failures.
4. **Language.** Chat with the user in Ukrainian. Code, comments, commit messages, README and docs are in English.
5. **Ask, don't guess,** when a decision changes scope, adds a dependency or a paid service.

## Stack

TypeScript (strict, ESM, ES2024) · Node 24 LTS · pnpm workspaces · Fastify · LangGraph.js · Zod · PostgreSQL + Drizzle ORM · pino · Vitest · React + Vite · Docker Compose.

## Layout

```
apps/api/src/
  config/         env loading and validation (Zod)
  llm/            LLMProvider interface + adapters (anthropic, openai-compatible, mock)
  tools/          agent tools (defineTool + runTool); scoring thresholds in scoring-rules.ts
  agents/         LangGraph graph: supervisor (nextStep planner), research, matching, writer, guard nodes, finalize
  guards/         input / policy / output guardrails
  db/             Drizzle schema, client, repositories
  prompts/        prompt loader (versioned .md files) and dataBlock() for untrusted text
  observability/  tool-call tracing (DB + traces/*.json)
  routes/         Fastify REST routes
apps/api/prompts/ versioned prompt files (*.md with id/version frontmatter)
apps/api/drizzle/ generated SQL migrations (never edit by hand; change schema.ts + make db-generate)
apps/api/tests/   unit/, integration/ (PGlite, no Docker), e2e/, helpers/, fixtures/
apps/web/         React UI: src/components, src/pages, api.ts (typed client), types.ts (import type from API contracts); tests/ (Testing Library)
data/             samples/ (incl. attacks/), expected/, portfolio/, companies.json (mock enrichment)
```

## Commands

```bash
make setup       # pnpm install + create .env
make dev         # Postgres (Docker) + API :3000 + UI :5173
make check       # lint + typecheck + tests — run before saying work is done
make up / down   # full stack in Docker (UI :8080)
pnpm -s agent data/samples/hot-lead.json   # run one lead through the agent (in-memory DB)
pnpm --filter @lead-agent/api test       # API tests only
```

## Code conventions

- Strict TypeScript: no `any`, no non-null `!` outside UI bootstrap, no needless `as` casts; use `.js` extensions in relative imports (NodeNext). ESLint is type-aware: no floating or misused promises (wrap async handlers as `() => void fn()`), exhaustive switches, `import type` for types.
- Tunables (limits, retries, budgets, pool sizes) come from env via `config/env.ts`, not literals in code.
- Validate every boundary with Zod: env, HTTP input, tool input/output, LLM output. Derive TS types with `z.infer`.
- Business decisions (scoring, approval thresholds, policy checks) are deterministic code, never LLM output.
- LLM calls go only through `LLMProvider`; never import a vendor SDK outside `src/llm/`.
- Claude models reject forced `tool_choice` and `temperature`: use strict tools with `auto` choice, `output_config.format` for JSON, `effort` for depth. Get JSON via `generateStructured()`, never by parsing free text.
- Treat lead text and enrichment data as untrusted: pass it to prompts inside delimited data blocks, never as instructions.
- Prompts live in `apps/api/prompts/*.md` with `id` and `version` frontmatter; bump the version on every change. The version is recorded in the trace.
- Every tool call is traced (name, args, result, latency, error) with the run's `traceId`. Log through `logEvent()` / the run logger; log lines carry metadata only — use `shapeOf()` for payloads, never free text (names cannot be masked by pattern).
- Tests must pass with `LLM_PROVIDER=mock` and no network. Real-provider tests are opt-in.
- Never log secrets or raw PII; never commit `.env`.
- Keep changes minimal and match the surrounding code style; Prettier and ESLint are the source of truth for formatting.

## AI tooling in this repo

| What                | Where                          | Use                                                                                                                            |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Permissions         | `.claude/settings.json`        | git writes (`commit`, `push`, `tag`, `rebase`, `reset`) and `gh pr create` always ask for confirmation; `.env` is not readable |
| Format hook         | `.claude/hooks/format-file.sh` | after every edit runs Prettier + `eslint --fix` on the file; remaining lint errors come back as feedback                       |
| `/plan-task <task>` | `.claude/skills/plan-task`     | analysis + plan, then stop for approval                                                                                        |
| `/check`            | `.claude/skills/check`         | `make check` + format check, short report                                                                                      |
| `/self-review`      | `.claude/skills/self-review`   | reviews the uncommitted diff via the `code-reviewer` subagent                                                                  |
| `code-reviewer`     | `.claude/agents/`              | read-only review for bugs, agent-safety gaps, convention violations                                                            |
| `test-writer`       | `.claude/agents/`              | writes offline Vitest tests, never changes production code                                                                     |
| context7 MCP        | `.mcp.json`                    | current docs for LangGraph.js, Fastify, Drizzle, Zod; use it before writing code against a library API                         |
| postgres MCP        | `.mcp.json`                    | read-only (restricted) access to the dev database; needs `make db-up`                                                          |

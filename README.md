# Lead Qualification Agent

A multi-agent system that takes an inbound lead for a digital agency, works out what the client wants, checks who they are, finds similar past projects, scores the lead with transparent rules and drafts a first reply — and sends anything risky to a human.

![Node 24 LTS](https://img.shields.io/badge/node-24_LTS-339933) ![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6) ![LangGraph.js](https://img.shields.io/badge/agents-LangGraph.js-1C3C3C) ![tests](https://img.shields.io/badge/tests-419_passing-2EA44F) ![eval](https://img.shields.io/badge/eval-20%2F20-2EA44F)

**Try it in 60 seconds** — no Docker, no API key (in-memory Postgres + a deterministic mock LLM):

```bash
corepack enable && pnpm install
pnpm -s agent data/samples/big-budget.json
```

![Result screen: a hot lead parked for human review](docs/screenshots/02-human-review.jpg)

---

**Contents** · [How it works](#how-it-works-in-plain-words) · [Problem](#problem) · [What the agent does](#what-the-agent-does) · [Business cases](#business-cases) · [Architecture](#architecture) · [Agent design](#agent-design) · [Setup](#setup) · [How to verify](#how-to-verify) · [Examples](#examples) · [Trade-offs & limitations](#trade-offs-limitations-and-next-steps) · [Real-world usage](#real-world-usage) · [Built with AI tooling](#built-with-ai-tooling)

**Docs** · [User and system guide](docs/GUIDE.md) (UI, API, how the AI is used) · [Technology choices](docs/TECH_CHOICES.md) · [Eval on Groq](docs/eval-groq.md) · [Development log](docs/DEVELOPMENT.md) · [TODO: future improvements](docs/TODO.md)

## How it works, in plain words

### The job

A digital agency builds websites, apps, marketing campaigns and AI solutions. Leads arrive through the website form or by email, usually as a few loose sentences: _"we need an app, budget around 40k, launch in 3 months"_. Today a salesperson handles each one by hand — figures out what the client wants, checks who they are (a company or someone on Gmail), looks for similar past projects, decides whether the lead is worth pursuing and writes a reply. That takes 20–40 minutes per lead; hot leads wait and spam costs as much time as real requests.

This repository automates that routine with an AI agent. The agent does the groundwork in seconds and leaves the decisions that need judgement to people.

### What happens to every lead

1. **Input check** — spam is filtered out, attempts to manipulate the AI (prompt injection) are detected, payment data in the text is flagged.
2. **Research agent** — extracts the project type, services, budget (in any currency), timeline and language, and looks up the company.
3. **Matching agent** — searches the agency's portfolio for similar projects (here the AI decides what and how to search) and scores the lead from 0 to 100 with transparent rules.
4. **Writer agent** — drafts a personal reply in the client's language: mentions similar projects, asks for what is missing, never promises prices, deadlines or discounts.
5. **Draft check by code** — if the AI still wrote a price or a deadline, the draft goes back for a rewrite.
6. **Decision**:
   - **auto-reply** — everything is fine;
   - **human review** — a large budget, a suspected attack, a problem with the draft or an AI failure;
   - **reject** — spam.
7. **Everything is stored** — the lead, the decision and a full log of what the agent did.

### Where the AI is used, and where it is not

The language model does the work that needs reading and writing; plain code makes every decision.

| Task                                            | Done by  | What it means                                                                                             |
| ----------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| Understand the request                          | AI model | Turns free text in any language into structured requirements: services, budget, timeline, what is missing |
| Find similar projects                           | AI model | Decides what to search the portfolio for, in English keywords, and whether to search again                |
| Write the first reply                           | AI model | A personal draft in the client's language that mentions relevant projects and asks for what is missing    |
| Spam and attack checks, company lookup          | code     | Rules and a directory lookup; runs before and around the model                                            |
| Score, tier, approval threshold, final decision | code     | Fixed, explainable rules: the model cannot raise a score or approve a lead                                |
| Draft check                                     | code     | Rejects prices, deadlines, discounts, guarantees and internal details in the draft                        |

The model never gets a tool that changes anything: it can only read the portfolio. Every model answer is checked against a schema before it is used, and every call is logged with its tokens and timing. How each screen, button, API endpoint and model call works is described in [docs/GUIDE.md](docs/GUIDE.md).

### What it gives the business

- **Speed** — a first reply in seconds instead of hours.
- **Priorities** — hot leads stand out, spam takes no one's time.
- **Safety** — large deals and suspicious leads always reach a person; the AI cannot decide on its own.
- **Transparency** — every decision comes with its reasons and every step of the agent is visible.
- **Consistent quality** — the same standard of reply whoever is on shift.

### How to use it

- **Web UI** — a lead form, a result screen with explanations and the agent's log, and an approval queue with an Approve button.
- **REST API** — to connect a website form or a CRM.
- **CLI** — one command shows the agent at work, with no Docker and no API key.
- **Any model** — Claude, OpenAI, Groq, Gemini, Ollama, or a deterministic mock for tests.

## Problem

A digital agency receives leads through its website form and email. They arrive raw: _"we need an app, budget around 20k, urgent"_. For every lead a salesperson spends 20–40 minutes on the same routine: work out the scope, look up the company, find relevant case studies, decide whether the lead is worth pursuing and write a first reply. Meanwhile hot leads wait, spam takes the same time as real requests, and the quality of the first reply depends on who picked up the lead.

The agent does that routine in seconds, consistently, and leaves people the decisions that need judgement: large deals, suspicious messages and anything the model could get wrong.

## What the agent does

### Scope

- Validates the lead and screens it for spam, prompt injection and payment data.
- **Research:** extracts project type, services, budget (any currency), timeline, goals and missing information; enriches the company by website or email domain.
- **Matching:** plans portfolio searches with a tool-use loop (English keywords even for Ukrainian or German leads) and ranks similar past projects.
- **Scoring:** 0–100 with five deterministic rules and a viability gate; tier hot / warm / cold / spam with a reason for every point.
- **Writing:** drafts a personalised first reply in the lead's language (English or Ukrainian) that references similar projects and asks for missing details — never prices, deadlines, discounts or guarantees.
- **Decision:** `auto_reply`, `human_review` (with the reasons) or `reject`, made by code from guard findings.
- Stores every lead, decision and full trace in Postgres; exposes them through a REST API, a CLI and a web UI with a human review queue.

### Non-scope

- Sending email or integrating a real CRM (HubSpot, Pipedrive) — the reply is a draft, the "CRM" is a Postgres table.
- Real web scraping or a paid enrichment API — enrichment reads `data/companies.json`.
- Pricing, estimation and contract terms.
- User accounts and authentication for the UI (optional API key only).
- Live FX rates (fixed demo rates).

## Business cases

Every case is a sample in [`data/samples`](data/samples) with its expectation in [`data/expected`](data/expected); `make eval` checks them all ([latest report](docs/eval-mock.md): 20/20).

| Case                           | Example                                                                                                                                                                         | Expected outcome                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Hot lead                       | Coffee chain wants a loyalty app, $40k, 3 months                                                                                                                                | `auto_reply`, hot, similar cases cited                          |
| Large deal                     | Telecom wants an AI support bot, €90k (≈ $97k)                                                                                                                                  | `human_review`: above the $50k approval threshold               |
| Large deal in another currency | Fashion brand, 2.5M UAH (≈ $60k)                                                                                                                                                | `human_review` after currency conversion; reply in Ukrainian    |
| Ukrainian lead                 | Online school wants a website                                                                                                                                                   | `auto_reply` in Ukrainian                                       |
| Unsupported language           | German medtech company                                                                                                                                                          | `auto_reply` in English, flagged as info                        |
| Incomplete request             | Verified company, no budget or timeline                                                                                                                                         | `auto_reply` asking for the missing details, warm               |
| Vague request                  | "We have a startup idea, can you help?" from Gmail                                                                                                                              | `auto_reply` with questions, cold                               |
| Unviable request               | "App like Facebook, $500, in one week"                                                                                                                                          | cold (viability gate), polite reply                             |
| Impossible deadline            | Landing page "by tomorrow"                                                                                                                                                      | cold, no timeline points                                        |
| Personal email                 | Freelancer on Gmail, $3k                                                                                                                                                        | no company signal, cold                                         |
| Payment data in the message    | Card number in the text                                                                                                                                                         | proceeds; reported as info and masked in logs and traces        |
| Spam                           | SEO / backlink offer                                                                                                                                                            | `reject` without a single LLM call                              |
| Prompt injection (8 attacks)   | "Ignore all previous instructions…", fake `<system>` tags, data-block breakout, s p a c e d letters, Ukrainian, role-play, prompt leak, **injection hidden in enrichment data** | `human_review`, attack quoted in the findings, nothing executed |

## Architecture

```mermaid
flowchart LR
    client([Web UI / API / CLI]) --> IG[input_guard<br/>spam · injection · PII]
    IG --> SUP{supervisor<br/>plans next step}
    SUP -->|requirements unknown| R[research agent<br/>extract_requirements · enrich_company]
    SUP -->|not scored| M[matching agent<br/>search_portfolio loop · score_lead]
    SUP -->|no draft| W[writer agent<br/>draft_reply]
    SUP -->|draft unchecked| PG[policy_guard<br/>prices · deadlines · leaks]
    R --> SUP
    M --> SUP
    W --> SUP
    PG -->|violation, 1 rewrite| SUP
    SUP -->|done / failed / limit| F[finalize<br/>decide · output guard]
    F --> S[(save_to_crm<br/>Postgres)]
    S --> out([result + trace])
```

| Layer         | Where                                       | Responsibility                                                                                      |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Contracts     | `apps/api/src/contracts`                    | Zod schemas for every boundary (API, tools, LLM output, state, trace); TS types derived from them   |
| LLM layer     | `apps/api/src/llm`                          | `LLMProvider` + Anthropic / OpenAI-compatible / mock adapters, timeouts, retries, structured output |
| Tools         | `apps/api/src/tools`                        | 6 tools with validated input and output; scoring rules in one file                                  |
| Guards        | `apps/api/src/guards`                       | Input, policy and output guards, the single `decide()` function, PII masking                        |
| Agents        | `apps/api/src/agents`                       | LangGraph graph: supervisor, research, matching, writer, guard nodes, finalize                      |
| Data          | `apps/api/src/db`                           | Postgres via Drizzle: leads, agent runs, tool calls, portfolio with full-text search                |
| Observability | `apps/api/src/observability`                | Run context (AsyncLocalStorage), structured events, LLM call recording, trace files                 |
| Delivery      | `apps/api/src/routes`, `cli.ts`, `apps/web` | REST API, CLI, React UI                                                                             |

**Data flow of one lead:** `POST /leads` → Zod validation → `agent_runs` row opened with a traceId → graph runs (each tool call validated, timed and recorded; each LLM call logged) → `decide()` turns findings into the decision → output guard checks consistency → lead stored → tool calls (PII-masked), plan, LLM events, tokens and duration stored with the run → result returned with `x-trace-id`.

Why each technology was chosen, with the alternatives considered: [docs/TECH_CHOICES.md](docs/TECH_CHOICES.md).

## Agent design

Three principles hold the design together:

1. **Code decides, the model assists.** The LLM extracts facts, plans searches and writes text. Scores, tiers, the viability gate, the approval threshold, policy checks and the final decision are plain TypeScript. A manipulated model can produce a bad draft, but it cannot raise a score or approve a lead.
2. **Untrusted text is data.** Lead messages and enrichment data reach prompts only inside `<lead_message>` / `<matching_context>` / `<reply_context>` blocks; tags inside the text are stripped so it cannot break out. Prompts say so explicitly.
3. **No side effects for the model.** The model never sees `save_to_crm` or `score_lead` as callable tools and nothing sends email. The worst outcome of a successful attack is a draft that a guard or a human rejects.

**Planning (supervisor).** A deterministic planner (`nextStep()`) reads the state and picks the next agent, with a reason that is logged and stored: research → matching → writer → policy guard → finalize, or a shorter path when the input is spam, a step failed, or the step budget ran out. Routing a business process is not where an LLM adds value; it is where predictability matters.

**Tool use.** The matching agent runs a real tool-use loop: the model writes English keyword queries, may search up to three times with different filters, and gets invalid arguments back as errors to correct. The cases it finds enrich the reply, but the score counts only a search whose query is built by code — broad model queries cannot add points. Research and writer call LLM-backed tools from code with structured output, so untrusted text never travels through model-chosen tool arguments.

**State.** A typed LangGraph state (mirroring a Zod contract): each agent fills its own fields; findings, tool calls, the route log, prompt versions, retries and token usage accumulate through reducers.

**Prompt hygiene.** Prompts are versioned files (`apps/api/prompts/*.md`, frontmatter `id` + `version`); the versions used are stored with every result. Claude models get native structured outputs, strict tools and `effort` — no forced `tool_choice` or `temperature`, which current models reject.

**Guardrails and reliability.**

- Input guard: spam (rejected before any LLM call), prompt injection in English and Ukrainian with Unicode, homoglyph and spacing normalisation, payment data; the same detector checks enrichment data and drops a poisoned description.
- Policy guard: the draft is checked by code for prices, discounts, deadlines, guarantees, internal leaks and echoed attacks; one rewrite with the violations as feedback, then a human.
- Output guard: schema plus consistency (score = sum of rules, tier matches score or its cap, no auto-reply without a draft); any inconsistency downgrades to human review.
- LLM layer: per-attempt timeouts, retries with exponential backoff and jitter for transient errors only, Zod validation with the exact error fed back to the model, refusal handling with server-side fallback on Claude.
- Graceful degradation: if the matching model is down, a keyword search built by code takes over; if research or writing fails, the lead goes to a human with what was collected.
- Time budget: the supervisor stops planning once `AGENT_RUN_BUDGET_MS` (90 s) is spent and finalizes for human review; a provider's `retry-after` is capped at 8 s, and a 429 asking for more than `LLM_MAX_RETRY_AFTER_MS` (30 s) or naming a daily quota fails at once as `quota_exhausted` (the eval then stops and marks its report incomplete); a client that disconnects cancels pending LLM calls, and the lead is still saved.
- After the lead is saved, trace bookkeeping is best effort: a failing trace write is logged, never turned into a 500 that a client would retry into a duplicate lead.

## Setup

Requirements: **Node 24 LTS** (≥ 24.15), **pnpm 9** (`corepack enable` picks the pinned version), **Docker** for the full stack.

```bash
make setup      # pnpm install + .env from .env.example (LLM_PROVIDER=mock needs no key)
make dev        # Postgres in Docker, migrations and seed, API on :3000, UI on :5173
make up         # everything in Docker: UI on http://localhost:8080, API on :3000
```

Zero-setup demo (in-memory database, mock LLM):

```bash
pnpm -s agent data/samples/hot-lead.json          # readable report
pnpm -s agent data/samples/spam.json --json       # full JSON result
make demo                                         # five samples in a row
```

### Running with a real LLM

`LLM_PROVIDER=mock` runs everything offline. To use a real model, set one of these in `.env`:

| Provider           | Cost                | `.env`                                                                                                                                                                |
| ------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic (Claude) | paid API            | `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=…` (default model `claude-opus-5-5`)                                                                                     |
| Ollama (local)     | free, offline       | `LLM_PROVIDER=openai-compatible`, `OPENAI_BASE_URL=http://localhost:11434/v1`, `OPENAI_MODEL=<a model with tool calling>`                                             |
| Groq               | free tier           | `LLM_PROVIDER=openai-compatible`, `OPENAI_BASE_URL=https://api.groq.com/openai/v1`, `OPENAI_API_KEY=…`, `OPENAI_MODEL=…` (`OPENAI_REASONING_EFFORT=auto` for gpt-oss) |
| OpenRouter         | free `:free` models | `LLM_PROVIDER=openai-compatible`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`, `OPENAI_API_KEY=…`, `OPENAI_MODEL=…:free`                                           |
| Google Gemini      | free tier           | `LLM_PROVIDER=openai-compatible`, `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `OPENAI_API_KEY=…`, `OPENAI_MODEL=…`                    |
| OpenAI             | paid API            | `LLM_PROVIDER=openai-compatible`, `OPENAI_API_KEY=…`, `OPENAI_MODEL=…`                                                                                                |

Free-tier limits change often; check the provider's docs. Then:

```bash
pnpm --filter @lead-agent/api test:live   # smoke test: structured output + tool call (a few cents)
pnpm eval --provider=env                  # the full sample set on that model → reports/eval.md
```

**Saving tokens on free tiers.** One lead costs about 4.3k tokens on Groq `gpt-oss-120b` (extraction, 1–3 portfolio searches, the reply), so the full eval is about 86k per round, and Groq's free daily limit is 200k.

- `OPENAI_REASONING_EFFORT=auto` passes each call's effort (`low` for extraction and search, `medium` for the reply) to reasoning models; their hidden reasoning is billed as output tokens. Leave it `off` for models without reasoning, which may reject the field.
- `AGENT_MAX_SEARCH_TURNS=1` allows one model-planned portfolio search instead of three. Scoring does not depend on it, but the reply may mention fewer past projects.
- Check a fix on the cases it touches and cap the spend: `pnpm eval --provider=env --cases=hot-lead,asap --repeat=3 --max-tokens=40000`. The report shows the total tokens used.

### Web UI

![New lead form with one-click samples](docs/screenshots/01-new-lead.jpg)

- **New lead** — form with one-click samples, including the prompt-injection attacks; API validation errors appear next to the fields.
- **Result** — decision and reason, score per rule (and the viability cap), guardrail findings, draft reply, similar projects, and _How the agent worked_: supervisor plan, tool timeline, LLM calls, tokens, duration.
- **Review queue** — leads parked for a human, with the reasons and an Approve button.

The UI is an internal tool and does not send `API_KEY` (a key in a browser bundle is public); in production it would sit behind SSO.

### API

| Method | Path                                      | Purpose                                                                                 |
| ------ | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST` | `/leads`                                  | Qualify a lead (`name`, `email`, `company?`, `website?`, `message`); returns the result |
| `GET`  | `/leads?status=pending_approval&limit=20` | List leads, e.g. the human review queue                                                 |
| `GET`  | `/leads/:id`                              | Lead, result and approval time                                                          |
| `POST` | `/leads/:id/approve`                      | Human approval → status `approved` (`409` if not waiting or if there is no draft)       |
| `GET`  | `/runs/:traceId/trace`                    | Plan, tool calls, LLM calls and retries, tokens, duration (PII masked)                  |
| `GET`  | `/health`                                 | Database and LLM provider status (`503` when the database is down)                      |

Interactive docs: **http://localhost:3000/docs** (Swagger UI; also `/api/docs` behind the UI) and the OpenAPI 3.1 spec at `/openapi.json`, both generated from the same Zod schemas the API validates with.

Errors share one shape: `{ "error", "message", "details?", "requestId" }`. Set `API_KEY` in `.env` to require an `x-api-key` header on everything except `/health`.

### Observability

- Every run has a `traceId`, returned as the `x-trace-id` header. All its log lines carry it: `run.start`, `supervisor.route`, `tool.call`, `llm.call`, `llm.retry`, `guard.finding`, `run.finish`.
- Logs carry metadata only. Payloads appear as shapes (`"<42 chars>"`) at debug level, because names cannot be masked by pattern; a test asserts that no log line contains the email, phone, name or message of a lead.
- The stored trace keeps the full tool payloads with emails, phones, cards and IBANs masked. `TRACE_DIR=traces` (or `--trace-dir=traces` in the CLI) also writes each trace to a JSON file.

## How to verify

```bash
make check      # lint (type-aware), format, typecheck, all tests (deterministic, offline)
make coverage   # API coverage (CI gate 80% lines; currently ~93%)
make eval       # every sample vs its expectation → reports/eval.md
```

| Level       | What it covers                                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | contracts, scoring rules and boundaries, guards (8 attacks, 10 false-positive checks), LLM adapters (real SDKs against a fake `fetch`), retries, structured output, prompts |
| Integration | repositories and full-text search on in-memory Postgres (PGlite), the agent graph end to end, observability                                                                 |
| E2E         | HTTP API through `fastify.inject`, the CLI, and all 20 samples through the full pipeline against their expectations                                                         |
| Web         | components with Testing Library                                                                                                                                             |
| Eval        | [`docs/eval-mock.md`](docs/eval-mock.md): decision and tier accuracy, score ranges, attack detection, false alarms, latency, tokens                                         |
| Real model  | [`docs/eval-groq.md`](docs/eval-groq.md): the same 20 cases on Groq `gpt-oss-120b`, per-case stability over repeated runs, and the fixes it led to                          |

| Provider                                                       | Runs | Passed                     | Avg time per lead | Avg tokens (in / out) |
| -------------------------------------------------------------- | ---- | -------------------------- | ----------------- | --------------------- |
| Mock (deterministic)                                           | 3    | 60/60                      | 6 ms              | 1637 / 202            |
| Groq `gpt-oss-120b`                                            | 3    | 57/60 (before F2–F3 fixes) | 25.8–31.6 s       | 2530–3479 / 1114–1375 |
| Groq `gpt-oss-120b`, all fixes, `OPENAI_REASONING_EFFORT=auto` | 1    | 20/20                      | 20.5 s            | 2784 / 780            |

`pnpm eval --repeat=N` runs every case N times: a real model is not deterministic, so one green run proves little.

CI (GitHub Actions) runs lint, format, typecheck, web tests, API tests with coverage thresholds, the eval (must pass every case) and the build; the eval report is uploaded as an artifact.

### Manual scenarios

1. **Happy path** — `pnpm -s agent data/samples/hot-lead.json`: `auto_reply`, hot, five-step plan, six tool calls, English draft citing the loyalty-app case.
2. **Human in the loop** — `make up`, open http://localhost:8080, click _Big budget_ → _Qualify lead_: _Needs human review_ with `approval_required`. Open _Review queue_ and approve it; approving again returns `409`, and the lead now has status `approved`.
3. **Prompt injection** — in the UI click _⚠ Ignore instructions_: the lead scores hot but still goes to review, the finding quotes the attack, and the draft contains no discount. Try _⚠ Enrichment injection_: the message is clean, the attack sits in the company data and is caught there.
4. **Spam** — `pnpm -s agent data/samples/spam.json`: `reject`, and the report shows a single tool call (`save_to_crm`) and no LLM calls.
5. **Trace** — `curl -si -X POST localhost:3000/leads -H 'content-type: application/json' --data @data/samples/ukrainian.json`, take `x-trace-id` and open `localhost:3000/runs/<traceId>/trace`: plan, tool calls, four LLM calls, tokens and duration; the email in tool arguments is masked.

## Examples

**Input** — [`data/samples/big-budget.json`](data/samples/big-budget.json):

```json
{
  "name": "Lars",
  "email": "lars@nordtel.com",
  "company": "NordTel",
  "message": "We are looking for a partner to build an AI support chatbot over our knowledge base and integrate it with our website. Budget is about €90k and we want to go live in 5 months."
}
```

**Output** (`POST /leads`, shortened):

```json
{
  "status": "pending_approval",
  "decision": "human_review",
  "score": 100,
  "tier": "hot",
  "summary": "Hot lead (100/100): AI automation, budget ≈ $97k, 3 similar cases. Needs human review: approval_required.",
  "requirements": {
    "projectType": "ai_automation",
    "services": ["web", "ai_automation"],
    "budget": { "min": 90000, "max": 90000, "currency": "EUR", "raw": "€90k" },
    "timeline": { "raw": "5 months", "weeks": 22 },
    "language": "en"
  },
  "company": { "name": "NordTel", "industry": "telecom", "size": "1000+", "found": true },
  "matchedCases": [
    { "id": "ai-support-assistant-telecom", "relevance": 0.76 },
    { "id": "document-automation-insurance", "relevance": 0.69 }
  ],
  "scoreBreakdown": [
    {
      "rule": "budget_fit",
      "points": 30,
      "max": 30,
      "reason": "$97k — $25k–$150k: ideal project size"
    },
    {
      "rule": "service_fit",
      "points": 25,
      "max": 25,
      "reason": "2/2 requested services are core; 3 similar case(s)"
    }
  ],
  "tierCap": null,
  "guardrails": {
    "injectionDetected": false,
    "findings": [
      {
        "guard": "policy",
        "code": "approval_required",
        "severity": "warning",
        "message": "Budget ≈ $97,200 is at or above the $50,000 approval threshold"
      }
    ],
    "retries": 0
  },
  "draftReply": { "language": "en", "subject": "Your project inquiry", "body": "Hi Lars, …" },
  "promptVersions": {
    "extract-requirements": "1.1.0",
    "match-portfolio": "1.0.0",
    "draft-reply": "1.2.0"
  }
}
```

**CLI report** for an unviable lead (`pnpm -s agent data/samples/cold-lead.json`, excerpt):

```text
Decision   auto_reply (completed)
Score      40/100, tier cold
Summary    Cold lead (40/100, capped: budget $500 is below the $5,000 minimum; a timeline of 1 week is not realistic): mobile app, budget ≈ $500, 3 similar cases. Auto-reply drafted.
Run        48 ms · 4 LLM calls · 1790 in / 200 out tokens

Score breakdown
  budget_fit         0/30  $500 — below $5k: too small for a custom project
  service_fit       25/25  1/1 requested services are core; 3 similar case(s)
  completeness      15/15  Budget, timeline and scope given
  timeline_realism   0/15  1 week — under 2 weeks: unrealistic for a custom project
  company_signal     0/15  No company or corporate email
```

**Log lines** of one run (`--verbose`, trimmed):

```json
{"level":30,"traceId":"7e979f44-…","event":"run.start","provider":"mock","model":"mock"}
{"level":30,"traceId":"7e979f44-…","event":"supervisor.route","step":0,"next":"research","reason":"requirements unknown"}
{"level":30,"traceId":"7e979f44-…","event":"llm.call","purpose":"extract_requirements","latencyMs":2,"inputTokens":426,"outputTokens":62,"stopReason":"end"}
{"level":30,"traceId":"7e979f44-…","event":"tool.call","step":0,"agent":"research","tool":"extract_requirements","latencyMs":4,"ok":true}
{"level":40,"traceId":"7e979f44-…","event":"guard.finding","guard":"input","code":"prompt_injection","severity":"critical"}
```

| Prompt injection caught                             | How the agent worked                          | Review queue (mobile, dark)                         |
| --------------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| ![Attack](docs/screenshots/04-injection-attack.jpg) | ![Trace](docs/screenshots/03-agent-trace.jpg) | ![Queue](docs/screenshots/05-queue-mobile-dark.jpg) |

## Speed, quotas and model switching

**The agent itself takes a few seconds per lead.** On Groq `gpt-oss-120b` the model work for one lead is about 4–5 s: requirement extraction ~1.5–2 s, one to three portfolio searches at ~0.3–0.7 s each, the reply ~1 s. Everything else (guards, scoring, routing, saving) is code and takes milliseconds; with the mock model a lead finishes in ~6 ms.

**On the free tier a lead takes ~20 s, because of the quota, not the agent.** Groq's free tier allows 8,000 tokens per minute and 200,000 per day for this model. One lead uses ~3.5k tokens, so at most about two leads fit into a minute and about 55 into a day; the rest of the 20 s is waiting for the per-minute window (one eval run had 92 such waits). The full eval of 20 leads therefore takes ~7 minutes, and three runs in a row used up the daily quota.

What the code does about it:

- **Waits instead of failing.** A 429 is retried with exponential backoff, the provider's `retry-after` is respected (capped at 8 s), and rate limits get more retries than other errors (`LLM_RATE_LIMIT_RETRIES`). At most `LLM_MAX_CONCURRENCY` calls run at once.
- **Gives up quickly when waiting is pointless.** When the daily quota is spent, or the provider asks to wait longer than `LLM_MAX_RETRY_AFTER_MS` (30 s), the call fails at once as `quota_exhausted`. The lead is still saved and goes to human review in ~2 s instead of hanging, and the eval stops and marks its report incomplete.
- **Bounds every run.** `AGENT_RUN_BUDGET_MS` (90 s) stops a run that takes too long and hands the lead to a person.
- **Spends fewer tokens.** `OPENAI_REASONING_EFFORT=auto` cut output tokens by 30–40% and the time per lead by 20–35%; `pnpm eval --cases=… --max-tokens=…` checks a change on a few cases within a set budget.

**The alternative I did not build for lack of time: several models with switching.** Every model call already goes through one `LLMProvider` interface, and errors are classified (`rate_limit`, `quota_exhausted`, `timeout`, …), so the missing piece is a `FallbackProvider` that holds a chain of providers and moves to the next one when the current one is out of quota or rate-limited for longer than the run can wait, for example Groq `gpt-oss-120b` → Groq `llama-3.3-70b` (its own quota) → Gemini free tier → a local Ollama model. Each provider would sit out a cooldown after a quota error, and each model in the chain would have to pass the eval on its own first, because extraction and reply quality differ between models. A cheaper variant of the same idea is routing by task: a small, fast model for extraction and search queries and the strong one only for the reply. A paid tier removes the problem altogether: at higher limits a lead takes the ~5 s of actual work.

## Trade-offs, limitations and next steps

### Trade-offs made on purpose

- **Deterministic supervisor instead of an LLM router** — predictable, auditable routes; the price is less flexibility for unforeseen request types.
- **Heuristic injection detector** — free, instant and fully tested, but it is a tripwire; the real defence is structural (data blocks, code decisions, no side-effect tools).
- **Synchronous `POST /leads`** — simplest for a demo (seconds with a real model); production needs a queue.
- **Human approval as a database status** — nothing runs after approval yet, so a LangGraph checkpointer would add tables without value.
- **Postgres full-text search instead of embeddings** — deterministic and keyless; weaker on synonyms.

### Known limitations

- **Real-model results vary between runs.** On Groq `gpt-oss-120b` 18 of 20 cases passed all three runs before the fixes; after them a full run passed 20/20, but the two formerly unstable cases have one run each so far. See [`docs/eval-groq.md`](docs/eval-groq.md).
- Demo data is fictional: 10 portfolio cases, 10 companies, fixed FX rates (October 2026).
- Portfolio search ranks English text, so the matching agent translates queries into English keywords.
- Replies are drafted in English or Ukrainian only; other languages get an English reply.
- Stored traces keep lead names and message text (emails, phones, cards and IBANs are masked): access to `/runs/:id/trace` must be restricted like CRM access.
- The company signal trusts the email domain as typed: `ceo@bigcorp.com` is not verified (production: confirm the email or rely on the CRM's verified contacts).
- No authentication beyond an optional shared API key; no rate limiting.

### Next steps

Smaller polishing work that did not fit into the time (several models with switching, a model per task, reply-quality evaluation, a larger eval set, editing the draft before approval, browser end-to-end tests) is planned in [docs/TODO.md](docs/TODO.md). The production roadmap:

1. **Queue-based processing** (pg-boss on the same Postgres): `POST /leads` → `202 Accepted` + status endpoint or webhook; retries survive restarts and slow models never hold an HTTP request.
2. **Shared `packages/contracts`** (Zod schemas + types) consumed by the API and the UI instead of the UI importing from `apps/api/src`; the base for a typed client SDK.
3. **Semantic search**: pgvector embeddings for multilingual portfolio matching without translating queries into English keywords.
4. **Second injection layer**: an LLM classifier behind the heuristics, measured with its own attack eval.
5. **Production observability**: OpenTelemetry or Langfuse export (the event names already map to spans), dashboards for decision mix, cost per lead and refusals, alerts on eval drift.
6. **Scheduled real-model eval**: a nightly `pnpm eval --provider=env --repeat=3` in CI with a pass-rate threshold, so prompt or model changes show up as stability drops.
7. **Close the loop**: send approved replies — LangGraph `interrupt` + Postgres checkpointer to resume a run after approval, plus a real email/CRM integration.
8. SSO and role-based access for the UI and traces, per-client rate limits, data retention and deletion (GDPR).

## Real-world usage

**Is this solution currently used in any business? — Not in production today.** It was built as a test assignment; all data is synthetic.

Teams that could use it:

1. **Digital agencies and studios** (the scenario modelled here): qualify website and email leads, give sales a ready draft and a ranked queue, and protect the team from spam and from replying to unviable requests.
2. **B2B SaaS companies with inbound demo requests**: score requests against an ideal-customer profile, route enterprise-size deals to account executives, auto-reply to the rest with relevant case studies.
3. **IT outsourcing and system integrators handling RFP-style requests**: extract requirements and constraints from long requests, match them to past projects and flag deals that need a bid/no-bid decision.

What it would take to run in production:

- **Security:** SSO and role-based access for the UI and traces, secrets in a vault, rate limiting and request size limits per client, a second (model-based) injection detector, regular red-team runs against the attack set.
- **Data access:** a real CRM integration (create/update deals, de-duplicate contacts), a licensed enrichment provider, the agency's actual portfolio indexed with embeddings, daily FX rates.
- **Human in the loop:** keep `human_review` for large budgets and any suspicion; measure how often humans change drafts and use that to tune thresholds and prompts; send email only after approval.
- **Monitoring:** traces exported to OpenTelemetry/Langfuse, dashboards for decision mix, latency, token cost per lead, refusals and fallbacks; alerts on error rate and on drift in the eval metrics.
- **Compliance:** GDPR basis and notice for processing lead data, retention and deletion policies for leads and traces, a data processing agreement with the LLM provider (or a self-hosted model), audit log of human approvals.
- **Quality:** an eval set built from real (anonymised) leads with sales-labelled outcomes, run before every prompt or model change.

## Built with AI tooling

This project was developed with Claude Code under explicit rules in [`CLAUDE.md`](CLAUDE.md): analyse → plan → wait for approval → implement, no git writes without a direct request, and `make check` before reporting work as done. The repository ships the setup that enforced them: a hook that formats and lints every edited file, permissions that require confirmation for git writes, slash commands (`/plan-task`, `/check`, `/self-review`), a read-only `code-reviewer` and a `test-writer` subagent, and MCP servers for library docs and the dev database. The stage-by-stage development log is in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Repository layout

```text
apps/api/        Fastify API, agent graph, tools, guards, LLM layer, CLI, eval (TypeScript)
apps/api/prompts versioned prompts
apps/web/        React UI
data/            samples, expectations, portfolio case studies, mock company directory
docs/            user and system guide, TODO, technology choices, eval reports, development log, screenshots
```

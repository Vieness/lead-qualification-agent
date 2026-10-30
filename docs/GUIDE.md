# User and system guide

How the Lead Qualification Agent works from the outside in: what each screen and button does, what the API accepts and returns, where the AI model is used and where plain code decides. For setup see the [README](../README.md#setup); for the reasons behind the stack see [TECH_CHOICES.md](TECH_CHOICES.md).

**Contents** · [What the system does](#what-the-system-does) · [Web interface](#web-interface) · [REST API](#rest-api) · [How the AI is used](#how-the-ai-is-used) · [The agent step by step](#the-agent-step-by-step) · [Scoring and decisions](#scoring-and-decisions) · [Logs and traces](#logs-and-traces) · [Configuration](#configuration)

## What the system does

An agency receives inbound leads as a few loose sentences. For each lead the system:

1. checks the input (spam, attempts to manipulate the AI, payment data);
2. asks the AI model to extract requirements: project type, services, budget, timeline, language, what is missing;
3. looks up the company in a directory;
4. lets the AI model search the portfolio for similar past projects;
5. scores the lead from 0 to 100 with fixed rules in code;
6. asks the AI model to draft a first reply in the client's language;
7. checks the draft with code for prices, deadlines, discounts, guarantees and internal details;
8. decides with code: send automatically, give to a person, or reject;
9. stores the lead, the result and a full trace of what happened.

The AI does language work: reading, searching, writing. Every business decision is code. The full list is in [How the AI is used](#how-the-ai-is-used).

## Web interface

The UI runs at `http://localhost:8080` (Docker) or `http://localhost:5173` (`make dev`). It has two tabs and a page per lead; the address bar keeps the current page (`#/new`, `#/queue`, `#/leads/<id>`), so any lead can be bookmarked or shared.

### Top bar

| Element              | What it shows                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status line          | `API online · LLM: <provider> · DB: <postgres or memory>`, from `GET /health`. Red "API unavailable" if the API cannot be reached; "degraded" if the database is down. |
| **New lead** tab     | The lead form.                                                                                                                                                         |
| **Review queue** tab | Leads waiting for a person.                                                                                                                                            |

### New lead

| Element                | What it does                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Try a sample** chips | Fill the form with one of the sample leads from `data/samples`. Chips marked ⚠ are prompt-injection attacks, to see the guards at work.                                                                           |
| Name, Email            | Required.                                                                                                                                                                                                         |
| Company, Website       | Optional. Website may be a URL or a bare domain; it is used for the company lookup.                                                                                                                               |
| Message                | Required, 20–5000 characters; the counter under the field shows the length. The same limits are enforced by the API.                                                                                              |
| **Qualify lead**       | Sends the lead to `POST /leads`. While the agent works the button reads "Agent is analysing the lead…" (milliseconds with the mock model, about 5–20 s with a real one). When it finishes, the lead's page opens. |
| **Clear**              | Empties the form.                                                                                                                                                                                                 |
| Errors                 | Invalid fields are highlighted with the API's message under each field; other errors (API down, server error) appear above the buttons.                                                                           |

### Lead page

Sections from top to bottom:

| Section                   | What it shows                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Banner                    | The decision ("Auto-reply ready", "Needs human review", "Rejected"), a one-line summary written by code, the status ("Completed automatically", "Waiting for approval", "Approved by a human", "Rejected", "Failed"), and the score with its tier (Hot, Warm, Cold, Spam).                                       |
| Action card               | Only for leads waiting for a person. With a draft: the **Approve** button. Without a draft (for example when the model was unavailable): a note to reply manually instead.                                                                                                                                       |
| **Score**                 | The five scoring rules with points and the reason for each; a yellow note when the tier was capped (e.g. "Tier capped at cold: budget below $5k").                                                                                                                                                               |
| **Guardrails**            | Every finding with its severity: **critical** and **warning** findings are why a lead needs a person; **info** findings are notes (e.g. payment data masked, reply in English for a German lead). Provider failures read as a short reason with the wait time.                                                   |
| **Draft reply**           | The language badge (EN or UK), the subject and the body. **Copy** puts subject and body on the clipboard.                                                                                                                                                                                                        |
| **Similar past projects** | Up to three portfolio cases with their match percentage and a short summary.                                                                                                                                                                                                                                     |
| **How the agent worked**  | The trace: duration, number of LLM calls (and retries), tokens in and out, the model; the supervisor's plan step by step with reasons; every tool call with its agent and duration (failed calls in red, long errors collapsed to one line, click to expand); notes such as "used keyword search"; the trace id. |
| **Original lead**         | Collapsed; the lead as it was submitted.                                                                                                                                                                                                                                                                         |

**Approve** marks the lead as approved (`POST /leads/:id/approve`) and the page updates to "Approved by a human". If someone else already handled the lead, the button explains that and asks to refresh. The system does not send email: approval means "this draft can go out", and sending is up to the person or a future integration.

### Review queue

The list of leads with status "waiting for approval", newest first. Each row shows the company (or the person's name) as a link to the lead's page, the tier and score, the summary, **Why** (the reasons a person is needed, e.g. "approval required, prompt injection") and the time it arrived. On the right: **Approve** if the lead has a draft, "Reply manually" if not. Approved leads leave the queue. An empty queue says so.

## REST API

Base URL `http://localhost:3000` (or `http://localhost:8080/api` through the UI). Interactive documentation: `/docs` (Swagger UI); the machine-readable spec: `/openapi.json`, generated from the same Zod schemas the API validates with.

| Method and path             | What it does                                                                                                   | Responses                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /leads`               | Runs the agent on one lead and stores the result. The `x-trace-id` header links to the trace.                  | `201` result · `400` invalid fields, each listed · `413` body over 64 KB                           |
| `GET /leads?status=&limit=` | Stored leads, newest first; `status` filters (e.g. `pending_approval` for the queue), `limit` 1–100.           | `200` `{ items }` · `400`                                                                          |
| `GET /leads/:id`            | One lead with its result.                                                                                      | `200` · `400` malformed id · `404`                                                                 |
| `POST /leads/:id/approve`   | A person approves a lead waiting for review.                                                                   | `200` updated lead · `404` · `409 not_pending` (not waiting) · `409 no_draft` (nothing to approve) |
| `GET /runs/:traceId/trace`  | What the agent did: plan, tool calls, LLM calls, tokens, duration. Emails, phones, cards and IBANs are masked. | `200` · `404`                                                                                      |
| `GET /health`               | Database and LLM provider status.                                                                              | `200` · `503` when the database is down                                                            |

**Request** (`POST /leads`):

```json
{
  "name": "Olena",
  "email": "olena@brewlane.co",
  "company": "Brewlane Coffee",
  "website": "brewlane.co",
  "message": "We run 25 coffee shops and want a loyalty app for iOS and Android. Budget around $40k, launch in 3 months."
}
```

**Response** (shortened): the decision and status, score and tier with a reason for every point, the extracted requirements, the company profile, matched cases, the draft reply, guard findings, the prompt versions used, a summary, and the `leadId` and `traceId`. The full example is in the [README](../README.md#examples).

**Errors** share one shape: `{ "error": "<code>", "message": "…", "details": [{ "path": "email", "message": "…" }], "requestId": "…" }`.

**Access.** When `API_KEY` is set, every endpoint except `/health`, `/openapi.json` and `/docs` needs the `x-api-key` header.

**Timing.** `POST /leads` answers when the agent is done: milliseconds with the mock model, about 5 s of model work with a real one, up to ~20 s on free tiers because of their per-minute limits, and at most `AGENT_RUN_BUDGET_MS` (90 s). If the client disconnects, pending model calls are cancelled and the lead is still saved for review.

## How the AI is used

### The three model tasks

The model is called for three tasks only. Each has a versioned prompt in `apps/api/prompts/`, and the version used is stored with every result.

| Task                    | Agent    | Prompt                    | Model gets                                                                                                                                   | Model returns (validated with Zod)                                                                                          | Reasoning effort |
| ----------------------- | -------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Extract requirements    | research | `extract-requirements.md` | The lead message, inside a `<lead_message>` data block                                                                                       | JSON: project type, services, budget (amount and currency), timeline (text and weeks), goals, missing information, language | low              |
| Plan portfolio searches | matching | `match-portfolio.md`      | Requirements and company facts (no free text from the lead), inside `<matching_context>`; the `search_portfolio` tool                        | Tool calls: English keyword queries with optional service filters, up to 3 searches                                         | low              |
| Draft the reply         | writer   | `draft-reply.md`          | Name, language, requirements, matched cases, tier, missing information, inside `<reply_context>`; on a rewrite, the policy violations to fix | JSON: language, subject, body                                                                                               | medium           |

### What the model never does

- **Decide.** Scores, tiers, the viability cap, the approval threshold, policy checks and the final decision are code. A manipulated model can write a bad draft; it cannot raise a score or approve a lead.
- **Act.** The model sees one tool, `search_portfolio`, which only reads. Saving to the database and scoring are called by code. Nothing sends email.
- **Read untrusted text as instructions.** Lead text and company descriptions reach prompts only inside data blocks; tags inside the text are stripped so it cannot close the block, and the prompts say the block is data.

### How a model call works

1. **Structured output.** The request carries a JSON schema built from the Zod schema (Claude: native structured outputs; OpenAI-compatible servers: `response_format: json_schema`). The answer is parsed and validated; if it is not valid JSON or does not match the schema, the model gets its answer back with the exact validation errors and tries again (`AGENT_MAX_RETRIES`, default 2).
2. **Tool use** (matching only). The model answers with tool calls; code runs each search, returns the results (id, title, relevance) and asks again, until the model stops or the search limit is reached. Invalid arguments come back to the model as errors to correct. Code also runs one search with a query it builds itself; only that search counts towards the score.
3. **Reliability**, below every call: a per-attempt timeout (`AGENT_LLM_TIMEOUT_MS`), retries with exponential backoff for transient failures (timeouts, 5xx, network), more retries for rate limits, the provider's `retry-after` respected, at most `LLM_MAX_CONCURRENCY` calls at once, and an immediate stop with `quota_exhausted` when the quota is spent. A refusal is not retried.
4. **Observation.** Every call is recorded in the run's trace with its purpose, model, tokens, latency, stop reason and error.

### When the model fails

| What fails                       | What happens                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Extraction                       | No requirements: the lead goes to a person with an `llm_unavailable` or `invalid_llm_output` finding. |
| Search planning                  | The search built by code still runs, so cases are found and the score is unaffected; a note says so.  |
| Writing                          | No draft: the lead goes to a person, who replies manually.                                            |
| Rewrite after a policy violation | The flagged draft stays and the lead goes to a person.                                                |
| Quota spent                      | Calls fail at once; the lead is saved for review in about 2 s.                                        |

### Providers

`LLM_PROVIDER` selects the model: `anthropic` (Claude), `openai-compatible` (OpenAI, Groq, OpenRouter, Gemini, Ollama, set with `OPENAI_BASE_URL` and `OPENAI_MODEL`) or `mock`. The mock answers with deterministic heuristics so tests, the CLI and the eval run without keys or network. Results on a real model are in [eval-groq.md](eval-groq.md).

## The agent step by step

The agent is a LangGraph graph. A **supervisor** (code, not a model) looks at what is known and picks the next step, with a reason that is shown on the lead page under "Plan".

| Step         | Who          | What happens                                                                                                                                                                                                                                                |
| ------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input guard  | code         | Spam is rejected before any model call. Prompt injection (English and Ukrainian, with spacing and look-alike letters normalised) is flagged. Card numbers and IBANs are flagged and masked.                                                                 |
| Research     | model + code | Requirements are extracted (model); code fills in what is missing and reads "ASAP" as one week. The company is looked up by website or email domain (code), and its description is checked for injection. Budgets of $50k or more are flagged for approval. |
| Matching     | model + code | The model plans portfolio searches; code runs its own search and scores the lead.                                                                                                                                                                           |
| Writer       | model        | The draft reply, in English or Ukrainian (other languages get English).                                                                                                                                                                                     |
| Policy guard | code         | The draft is checked for prices, discounts, deadlines, guarantees, internal terms and repeated attack text. On a violation the writer gets one rewrite with the violations listed.                                                                          |
| Finalize     | code         | Findings become the decision; an output guard checks the result is consistent (score adds up, tier matches, no auto-reply without a draft).                                                                                                                 |
| Save         | code         | The lead and result are stored; then the trace.                                                                                                                                                                                                             |

Limits keep every run bounded: at most `AGENT_MAX_STEPS` planning steps (12) and `AGENT_RUN_BUDGET_MS` of time (90 s); past either, the lead goes to a person.

## Scoring and decisions

**Score (0–100)**, from `apps/api/src/tools/scoring-rules.ts`:

| Rule             | Max | Points for                                                                                    |
| ---------------- | --- | --------------------------------------------------------------------------------------------- |
| Budget fit       | 30  | $25k–$150k: 30 · $10k–$25k: 20 · over $150k: 25 · $5k–$10k: 10 · under $5k: 0 · not stated: 5 |
| Service fit      | 25  | Share of requested services the agency sells (up to 15) plus 5 per similar case (up to 10)    |
| Completeness     | 15  | Minus 5 for each of budget, timeline, scope that is missing                                   |
| Timeline realism | 15  | 1–12 months: 15 · over a year: 10 · 2–4 weeks: 7 · under 2 weeks: 0 · not stated: 7           |
| Company signal   | 15  | By company size, 5 for a company that cannot be verified                                      |

**Tier:** hot from 70, warm from 40, cold below. A budget under $5k or a timeline under two weeks caps the tier at cold whatever the score.

**Decision:**

- **reject** — spam or invalid input;
- **human review** — any of: prompt injection, budget at or above `HUMAN_APPROVAL_BUDGET_USD` ($50k), a draft that still breaks a policy rule, a model failure, no draft, a run that hit its step or time limit, an inconsistent result;
- **auto-reply** — none of the above.

## Logs and traces

- **Trace per run** (`GET /runs/:traceId/trace`, and the "How the agent worked" section): the plan, every tool call with arguments, result, duration and error, every model call with tokens and latency, retries, notes, prompt versions. Emails, phones, card numbers and IBANs are masked before storing.
- **Logs**: JSON lines (pino) with the `traceId`: `run.start`, `supervisor.route`, `tool.call`, `llm.call`, `llm.retry`, `guard.finding`, `run.finish`. Logs carry metadata only; payloads appear as their shape, never as text, so names and messages do not reach log storage.
- **CLI**: `pnpm -s agent <lead.json>` prints the decision, score, findings, plan and tool calls; `--verbose` adds the log events, `--json` prints the full result, `--trace-dir` writes the trace to a file.
- **Eval**: `pnpm eval` runs every sample against its expectation and writes `reports/eval.md`, `eval.json` and a trace per lead.

## Configuration

The main settings, all in `.env` (see `.env.example` for every option):

| Variable                                            | Default | Meaning                                                             |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------- |
| `LLM_PROVIDER`                                      | `mock`  | `anthropic`, `openai-compatible` or `mock`                          |
| `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY` | —       | The OpenAI-compatible server and model                              |
| `OPENAI_REASONING_EFFORT`                           | `off`   | `auto` passes each task's effort to reasoning models (fewer tokens) |
| `HUMAN_APPROVAL_BUDGET_USD`                         | `50000` | Leads with a budget at or above this go to a person                 |
| `AGENT_RUN_BUDGET_MS`                               | `90000` | Time limit for one run                                              |
| `AGENT_MAX_SEARCH_TURNS`                            | `3`     | Searches the model may plan                                         |
| `AGENT_MAX_REWRITES`                                | `1`     | Rewrites after a policy violation                                   |
| `LLM_RATE_LIMIT_RETRIES`                            | `5`     | Retries on a rate limit                                             |
| `LLM_MAX_RETRY_AFTER_MS`                            | `30000` | A longer requested wait counts as a spent quota and fails at once   |
| `API_KEY`                                           | —       | When set, the API requires the `x-api-key` header                   |

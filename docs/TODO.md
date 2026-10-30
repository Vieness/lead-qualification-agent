# TODO: future improvements

Work that would polish the project but did not fit into the time for this assignment. Each item says why it matters, what to build, how to check it is done, and a rough size (S: up to a day, M: two to four days).

The broader production roadmap (queue, shared contracts package, embeddings, OpenTelemetry, SSO) is in the README under [Next steps](../README.md#next-steps).

## 1. Several models with switching (M)

**Why.** On free tiers the quota, not the agent, limits throughput: Groq's free tier allows about two leads a minute and about 55 a day. When the quota runs out, every new lead goes to human review without a draft.

**What to build.**

- A `FallbackProvider` in `apps/api/src/llm/` that implements `LLMProvider` over an ordered chain, for example Groq `gpt-oss-120b` → Groq `llama-3.3-70b` (its own quota) → Gemini free tier → a local Ollama model.
- Move to the next provider on `quota_exhausted`, or on `rate_limit` when the provider asks to wait longer than the run can afford. Do not switch on `invalid_output` or `refusal`: those are about the prompt, not the provider.
- A cooldown per provider after a quota error, so the chain does not hit an exhausted provider on every call.
- Config from env, e.g. `LLM_CHAIN=groq:openai/gpt-oss-120b,groq:llama-3.3-70b-versatile,ollama:qwen3:8b`.
- Record which provider answered each call in the trace (`llm_call.model` already exists) and show it in the UI.

**Done when.** With the first provider out of quota, a lead still gets a draft from the next one; unit tests cover switching, cooldown and "no switch on invalid output"; each model in the default chain passes `pnpm eval --provider=env` on its own.

## 2. A model per task (S)

**Why.** The three LLM tasks differ in difficulty. Extraction and search queries are short structured tasks a small model handles; only the reply needs a strong model. Routing by task cuts cost and time, and spreads load across separate quotas.

**What to build.**

- Per-purpose model settings: `LLM_MODEL_EXTRACT`, `LLM_MODEL_MATCH`, `LLM_MODEL_DRAFT`, each defaulting to the main model. The `purpose` field on every `LLMRequest` already identifies the task.
- A small router in the factory that picks the provider per purpose; combine with item 1 so each task can have its own chain.

**Done when.** An eval with a small model for extraction and search and the strong model for the reply passes 20/20, and the report shows fewer tokens per lead on the strong model.

## 3. Reply quality evaluation (M)

**Why.** The eval checks decisions, tiers, scores and attack detection, and the policy guard checks the draft for forbidden content. Nothing checks whether the reply is actually good: polite, in the right language, about the client's project, asking for what is missing.

**What to build.**

- A judge prompt (`prompts/judge-reply.md`) with a rubric scored 1–5: addresses the client's project, cites the matched cases correctly, asks about every item in `missingInfo`, tone, length, language.
- Run it in the eval only, never in the request path, with a different model from the writer so the writer does not grade itself.
- Report the average per criterion and list the weakest replies in `eval.md`; add a `--judge` flag so the extra tokens are spent only on purpose.

**Done when.** The eval report has a reply-quality section; a deliberately bad prompt version scores clearly lower than the current one.

## 4. A larger eval set from real leads (M)

**Why.** 20 hand-written cases prove the pipeline, but they are too few to trust percentages: one case is 5%.

**What to build.**

- 50–100 anonymised leads from a real inbox or CRM (names, emails and companies replaced), each with an expected decision and tier agreed with a salesperson.
- A confusion matrix for tiers (expected vs actual) and per-category results (language, budget size, attack type) in the report.
- Keep the current 20 as a fast smoke set; run the large set with `--cases` groups or a separate `--dataset` flag.

**Done when.** The large set runs with `pnpm eval --dataset=…`; the report shows the confusion matrix; results are stable over `--repeat=3`.

## 5. Edit the draft before approving (S)

**Why.** Today a person can only approve the draft as it is or copy it and reply elsewhere. The usual case is "good draft, change one sentence".

**What to build.**

- In the UI, an Edit button on the draft that turns subject and body into fields; Approve sends the edited text.
- `POST /leads/:id/approve` accepts an optional `{ subject, body }`; the API runs the same policy guard on the edited text and stores both versions (the agent's draft and the approved one), so the difference can feed prompt improvements later.

**Done when.** An edited draft is stored and shown as approved; an edit that adds a price is rejected by the policy guard with a clear message; API and UI tests cover both.

## 6. Browser end-to-end tests (S)

**Why.** UI components are tested in isolation with Testing Library, but nothing clicks through the real app: form → result → review queue → approve.

**What to build.**

- Playwright tests against the Docker stack with the mock model (`LLM_PROVIDER=mock`), so they need no keys and give the same result every time.
- Scenarios: submit a sample lead and see the result; a large-budget lead appears in the review queue and can be approved; a spam lead is rejected; a validation error highlights the field; light and dark themes and a mobile viewport render without overflow.
- A CI job that starts the stack, runs the tests and uploads screenshots on failure.

**Done when.** `pnpm test:e2e` passes locally and in CI, and a broken button or route fails it.

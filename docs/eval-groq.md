# Eval on a real model (Groq)

The mock eval ([`eval-mock.md`](eval-mock.md)) proves the pipeline. This page shows how the same 20 cases behave on a real model and what changed because of it.

- **Model:** `openai/gpt-oss-120b` on Groq's free tier (`LLM_PROVIDER=openai-compatible`).
- **Command:** `pnpm eval --provider=env --out=reports/groq-rN`.
- **Date:** 29 October 2026.

## Runs

| Run | When                                   | Passed    | Failed cases       | Avg time per lead | Avg tokens (in / out) | Notes                                                                    |
| --- | -------------------------------------- | --------- | ------------------ | ----------------- | --------------------- | ------------------------------------------------------------------------ |
| 1   | before the stage 12 improvements       | 20/20     | —                  | 27.8 s            | 3479 / 1375           | One rewrite failed after exhausting its retries on a 429                 |
| 2   | after compact JSON and the LLM limiter | 18/20     | `hot-lead`, `asap` | 25.8 s            | 3212 / 1290           | 99 rate-limit retries, 0 failed LLM calls                                |
| 3   | same code                              | 19/20     | `hot-lead`         | 31.6 s            | 2530 / 1114           |                                                                          |
| 4   | same code                              | _invalid_ | —                  | ~41 s             | —                     | Groq's **daily** token limit ran out: every first LLM call failed on 429 |

Stage 12 cut input tokens per lead by 7.7% (run 1 → run 2) and removed the failed LLM call; the remaining 429s were absorbed by retries.

Run 4 is not a quality result. With the daily quota gone, every lead failed safely: research failed, the lead went to `human_review` with an `llm_failure` finding, and nothing was auto-sent. That is the designed degradation, but each failing call still spent five retries (~40 s): Groq asked to wait between 28 s and 9 minutes, and every wait was capped at 8 s.

## Per-case stability (valid runs 1–3)

| Case       | Passed | What went wrong                                                                                                                                  |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hot-lead` | 1/3    | The draft restated the client's own timeline ("within three months"); the policy guard read it as a deadline promise and sent the lead to review |
| `asap`     | 2/3    | For "ASAP, ideally by tomorrow" the model returned `weeks: null`, so the viability gate did not cap the lead at cold                             |
| other 18   | 3/3    |                                                                                                                                                  |

Neither failure is unsafe: one sends a good lead to a human, the other misses a "too urgent" warning. Both are fixed in code and prompts.

## Fixes

| Problem                       | Fix                                                                                                                                                                                                     | Where                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Restated timeline (F2)        | `draft-reply` 1.2.0: restate the project without any amount, duration or date from the lead ("your budget", "your timeline"). The guard stays strict: a restated deadline and a promised one look alike | `apps/api/prompts/draft-reply.md`            |
| ASAP read as no timeline (F3) | `extract-requirements` 1.1.0: urgent wording without a number is 1 week. Code backstop: `weeks: null` with ASAP / urgent / by tomorrow / терміново / якнайшвидше becomes 1, whatever the model says     | `apps/api/src/tools/extract-requirements.ts` |
| One run proves little (F4)    | `pnpm eval --repeat=N` runs every case N times and reports per-case stability (`2/3`) and how many cases pass every run                                                                                 | `apps/api/src/eval/`                         |

After the fixes the mock eval passes 60/60 with `--repeat=3`.

## Token budget

Where the tokens go per lead (38 leads from runs 2–3):

| Call                   | Calls per lead | Input per call | Output per call | Share |
| ---------------------- | -------------- | -------------- | --------------- | ----- |
| `match_portfolio`      | 2.45           | ~600           | ~85             | 39%   |
| `extract_requirements` | 0.89           | ~900           | ~575            | 31%   |
| `draft_reply`          | 1.00           | ~750           | ~545            | 30%   |

About 4.3k tokens per lead, so `--repeat=3` over all 20 cases (~260k) does not fit the 200k free daily limit. Extraction JSON is about 150 tokens, yet the model returned ~575: most of the output is hidden reasoning. The adapter used to ignore the requested effort, so gpt-oss always reasoned at its default (medium). `OPENAI_REASONING_EFFORT=auto` now passes `low` / `medium` as `reasoning_effort`; the next section measures it.

## Run after all fixes (30 October 2026)

One full run with every fix in place (F2, F3, F6) and `OPENAI_REASONING_EFFORT=auto`:

```bash
OPENAI_REASONING_EFFORT=auto pnpm eval --provider=env --max-tokens=120000 --out=reports/groq-day2
```

**20/20 passed** (decisions, tiers, score ranges 100%; attacks caught 100%; false alarms 0%), in 6 min 53 s.

| Per lead                               | Before (runs 2–3)     | After      | Change                                     |
| -------------------------------------- | --------------------- | ---------- | ------------------------------------------ |
| Tokens in / out                        | 2530–3212 / 1114–1290 | 2784 / 780 | output −30…−40%                            |
| `extract_requirements` output per call | ~575                  | ~239       | −58% (effort `low`)                        |
| `match_portfolio` output per call      | ~85                   | ~44        | −48% (effort `low`)                        |
| `draft_reply` output per call          | ~545                  | ~517       | −5% (effort `medium`, the model's default) |
| Avg time                               | 25.8–31.6 s           | 20.5 s     | −20…−35%                                   |

- `hot-lead` (F2) and `asap` (F3), the two cases that were unstable before, both passed; one run is not proof of stability, so a `--repeat=3` on just these two remains worth doing.
- Time per lead is mostly waiting on Groq's free per-minute limit (8k tokens/min, about two leads a minute): 92 retries on 429, the actual model work is about 4–5 s per lead. Fewer tokens per lead is therefore also what made the run faster.
- One extraction call (`attacks/data-block-breakout`) still failed after its retries on the per-minute limit. The case passed because the input guard had already caught the attack and the lead went to human review, but on a normal lead the same failure would send it to review without requirements.

## Still to verify

The F2 and F3 fixes and the reasoning-effort saving, on the two cases they touch (about 25k tokens in all):

```bash
OPENAI_REASONING_EFFORT=off pnpm eval --provider=env --cases=hot-lead,asap --repeat=3 --max-tokens=40000 --out=reports/groq-effort-off
OPENAI_REASONING_EFFORT=auto pnpm eval --provider=env --cases=hot-lead,asap --repeat=3 --max-tokens=40000 --out=reports/groq-effort-auto
```

Comparing the `Total tokens` row of the two reports gives the saving; both should pass 6/6.

## Spent quota fails fast (F6)

A 429 that mentions a daily limit or a quota, or asks to wait longer than `LLM_MAX_RETRY_AFTER_MS` (30 s), becomes `quota_exhausted` and is not retried. The wait comes from the `retry-after` header or, for Groq, from the message ("try again in 8m53.52s"). The lead still goes to human review, in about a second instead of ~40 s.

The eval stops at the first `quota_exhausted` call, marks the report **Incomplete** (`meta.incomplete` in `eval.json`) and exits with code 3 (pnpm reports it as 1), so a run like run 4 can no longer pass for a quality result.

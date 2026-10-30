# Model benchmark

Offline-first pipeline that interviews the enabled OpenRouter models and caches Mirror scores. Commands and the list of what this does **not** validate are in the root README under "Model benchmark". The shipped file enables the original four and lists more candidates with `enabled: false`.

```bash
npm run benchmark:dry-run
export OPENROUTER_API_KEY="your-openrouter-key"
npm run benchmark
```

Outputs (gitignored):

- `scripts/benchmark/output/scores.json` — schema version 4, including `run_label` and `providers_seen`. Each run replaces this file and does not merge an older one. The new file contains only the models enabled for that run, so a model scored earlier and left disabled is dropped. The previous file is read first only to refuse a different judge version string (`--rescore-all` overrides that). A hard stop after at least one model has finished also replaces the file with those finished models (`partial: true`). A hard stop before any model finishes leaves the previous file in place. `matchModels` compares `strategy_table`, including `exclusion_reason`. A score file from PR #34, whose extroversion exclusion wording still says the means were between 55 and 61, fails that check. Loading the file does not. Delete it and re-run, or run the benchmark again with the same judge version string so the file is replaced. Default repeats: 10.
- `scripts/benchmark/output/ledger.jsonl` — one row per call with token counts and USD cost. Estimated rows (no usage came back) do not count toward the $40 monthly warning.

Every model and the judge use the same `maxOutputTokens` (8192) and the same OpenRouter `reasoning.effort` (`minimal`). The request builder attaches that field for every model id. It does not look at OpenRouter's `supported_parameters`. `qwen/qwen3-235b-a22b-2507` and `moonshotai/kimi-k2-0905` do not list `reasoning` there (models list checked 2026-10-30). This pipeline does not set `provider.require_parameters`. OpenRouter's default is to route the request anyway and let the provider ignore unknown parameters. That live path was not called here. A length cutoff with empty `message.content` retries once at `retryMaxOutputTokens` (16384). Separately, an HTTP 429 or 5xx on an interview or judge call is retried inside the client, up to 3 attempts. The wait is 500ms, then 1000ms, unless `Retry-After` is present (delta-seconds or HTTP date). A `Retry-After` longer than 30s is capped at 30s. Other 4xx responses and errors before a response are not retried. Only the attempt that returns to the caller is ledgered and, if it succeeds, scored. A repeat that still fails is recorded the same way as before. The judge scores `message.content` only, never `message.reasoning`. One model's failed repeat does not stop the others. `runs` is the number of scored repeats, `fewer_runs` is true when that is short of the configured count, and a model that fails more than half its repeats is `not_scored` with `not_scored_reason`. Exit code 4 means every model failed. The dry run assumes each call uses the full cap, because reasoning tokens are billed as completion tokens. It does not add HTTP retries or the length-cutoff retry.

When the response body includes OpenRouter's top-level `provider` string, each scored run stores it. That is the upstream that answered the interview calls. Distinct values in one repeat are joined in first-seen order. The field is null when every interview response omitted it. Older score files that lack `provider` still load. The judge's provider is not stored.

Each model also stores `providers_seen`: distinct interview provider names across scored repeats, with `count` equal to how many of those repeats named that upstream. A repeat that hit two upstreams counts each once. Null providers are left out. An empty array means every scored repeat omitted the field. Older files that lack `providers_seen` still load. Schema version stays 4.

`run_label` in `config.json` is optional. A missing key loads as `default`. It must be a single non-empty line of at most 80 characters. The score file writes that string next to `generated_at`. A score file that omits `run_label` still loads; validation treats the missing field as `unlabeled`. There is no index of past labels.

## Pinning a provider

No model in `config.json` sets a provider pin. After a first run, read `providers_seen` on the open-weight model you care about and copy one of those names. This file does not list provider names to use.

Add the pin on that model only:

```json
"provider": { "order": ["ProviderName"], "allow_fallbacks": false }
```

`order` and `allow_fallbacks` are passed through as OpenRouter's request `provider` object, and only on that model's interview calls. Judge calls are not pinned. Omit the field to keep OpenRouter's default routing. `ProviderName` above is a placeholder, not a suggestion.

`matchModels` in `match.ts` is the only tier function. It always uses the in-code `STRATEGY_TABLE`. A stored `strategy_table` that differs, including an empty one, throws. Swap the hypothesis by editing `STRATEGY_TABLE` in that file.

Active traits are strictly above 70 or below 30, same as `getActiveDirectives`. A user score of exactly 30 or exactly 70 is not active. A model mean of exactly 50 is poor. If the only active trait is low neuroticism, the result is `no strong recommendation`.

OpenRouter's response `model` field is often only the requested model id, not a dated build. The score file stores that string as `judge.version` and a UTC `judge.recorded_at` beside it. Each run stores `recorded_at` beside `judge_version`. The mix guard compares version strings, so a new timestamp alone does not force `--rescore-all`.

Each trait has `wide_range`. The model-level `wide_range` is true when any trait flag is. When `spread_warning` is true, `matchModels` adds `relative_rank` (1 is closest to the target profile) and `ranking_note` ("Ranking is relative because models cluster"). Tiers stay. A model missing any active trait that counts toward the tier is `not_scored` with `missing_traits`, and is not ranked. Both extroversion rows are excluded from tiering (`exclusion_reason` explains why: no benchmarked model scored extroversion below 50, and the table needs one). Extroversion means, min, max, and the low-confidence flag stay in the score file, and extroversion still appears in `active_traits`. If it is the only active trait, the result is `no strong recommendation`. UI cards should read each model's `driving_traits` for the tier and `exclusion_reason` for an excluded trait. A 429 or 5xx that uses all 3 attempts leaves that repeat unscored. A model that fails more than half of its repeats (6 or more of 10) is `not_scored`.

## Enabling more models

`maxEnabledModels` in `config.json` is 12. Disabled models are skipped and do not count toward the cap. Turn a set on by setting `enabled` to true, staying at or under 12. Prices below are USD per 1,000,000 tokens.

### Open-weight candidates

These are already in `config.json` with `"enabled": false`. Prices are the OpenRouter snapshot from 2026-10-29. The original four stay on the 2026-10-05 prices in the same file.

| id | input | output |
| --- | --- | --- |
| `deepseek/deepseek-v4-flash` | 0.091 | 0.182 |
| `z-ai/glm-4.7-flash` | 0.061 | 0.40 |
| `stepfun/step-3.5-flash` | 0.10 | 0.30 |
| `qwen/qwen3-235b-a22b-2507` | 0.09 | 0.55 |
| `minimax/minimax-m2.7` | 0.30 | 1.20 |
| `moonshotai/kimi-k2-0905` | 0.60 | 2.50 |

`z-ai/glm-4.7-flash` input is stored as 0.061. OpenRouter's per-token prompt price on 2026-10-30 was 0.0000000605, which is $0.0605 per 1M. Re-check it before a run if that gap matters.

### Near-frontier candidates

These ids are not in `config.json`. Re-verify the current OpenRouter price before enabling any of them. Do not copy a price from memory. On each model, read `pricing.prompt` and `pricing.completion` (USD per token) and multiply by 1,000,000.

Add an object to `models`, fill the two prices, and set `enabled` to true only for the set you want in that run:

```json
{
  "id": "google/gemini-3.8-flash",
  "enabled": false,
  "inputPerMillionUsd": null,
  "outputPerMillionUsd": null
}
```

Replace both nulls with the figures you just checked. Leave `enabled` false until then. An enabled model with a null price is skipped. Stay within `maxEnabledModels`.

Candidates, prices intentionally omitted:

- `google/gemini-3.8-flash`
- `anthropic/claude-sonnet-5.5`
- `x-ai/grok-4.7`
- `anthropic/claude-opus-5.5`
- `openai/gpt-5.5`

# Model benchmark

Offline-first pipeline that interviews the enabled OpenRouter models and caches Mirror scores. Commands and the list of what this does **not** validate are in the root README under "Model benchmark". The shipped file enables the original four and lists more candidates with `enabled: false`.

Commands run from the repo root. `--config` is optional. Without it, the CLI reads `scripts/benchmark/config.json` (the original four). `config.frontier.json` enables Tyler's near-frontier four and does not change that default file. `config.frontier-a.json` and `config.frontier-b.json` keep the earlier frontier settings with `run_label` `frontier-a` and `frontier-b`. They do not pin a provider. Use those files instead of editing the label by hand. All of these files write `scripts/benchmark/output/scores.json`. Each run replaces that file, so copy or rename it before the next run. A frontier run after an original-four run, or the reverse, drops the models that were not enabled for the new run.

```bash
npm run benchmark:dry-run
npm run benchmark:dry-run -- --config scripts/benchmark/config.frontier.json

export OPENROUTER_API_KEY="your-openrouter-key"
npm run benchmark
npm run benchmark -- --config scripts/benchmark/config.frontier.json
```

Before switching configs:

```bash
cp scripts/benchmark/output/scores.json scripts/benchmark/output/scores-default.json
```

Labelled frontier runs. Dry-run first, then the live run. Run A, check the score file, copy it, then run B.

```bash
npm run benchmark:dry-run -- --config scripts/benchmark/config.frontier-a.json
npm run benchmark:dry-run -- --config scripts/benchmark/config.frontier-b.json

export OPENROUTER_API_KEY="your-openrouter-key"
npm run benchmark -- --config scripts/benchmark/config.frontier-a.json
```

After run A, confirm `run_label` is `frontier-a` and `generated_at` is the time of that run, not an older timestamp, before starting run B:

```bash
node --input-type=module -e 'import { readFileSync } from "node:fs"; const score = JSON.parse(readFileSync("scripts/benchmark/output/scores.json", "utf8")); console.log(score.run_label); console.log(score.generated_at);'
cp scripts/benchmark/output/scores.json scripts/benchmark/output/scores-frontier-a.json
npm run benchmark -- --config scripts/benchmark/config.frontier-b.json
```

After run B, copy `scores.json` to `scores-frontier-b.json` if you need to keep it. `run_label` on that file is `frontier-b`.

Outputs (gitignored):

- `scripts/benchmark/output/scores.json` — schema version 4, including `run_label` and `providers_seen`. Each run replaces this file and does not merge an older one. The new file contains only the models enabled for that run, so a model scored earlier and left disabled is dropped. The previous file is read first only to refuse a different judge version string (`--rescore-all` overrides that). A hard stop after at least one model has finished also replaces the file with those finished models (`partial: true`). A hard stop before any model finishes leaves the previous file in place. `matchModels` compares `strategy_table`, including `exclusion_reason`. Reading an already-written file still accepts the extroversion sentence stored in the 2026-10-30 original-four run. Any other wording fails. A score file from PR #34, whose extroversion exclusion wording still says the means were between 55 and 61, fails that check. Loading the file does not. Delete it and re-run, or run the benchmark again with the same judge version string so the file is replaced. New runs write the current constant. Default repeats: 10.
- `scripts/benchmark/output/ledger.jsonl` — one row per call with token counts and USD cost. Estimated rows (no usage came back) do not count toward the $40 monthly warning.

Every model and the judge use the same `maxOutputTokens` (8192) and the same OpenRouter `reasoning.effort` (`minimal`). The request builder attaches that field for every model id. It does not look at OpenRouter's `supported_parameters`. `qwen/qwen3-235b-a22b-2507` and `moonshotai/kimi-k2-0905` do not list `reasoning` there (models list checked 2026-10-30). This pipeline does not set `provider.require_parameters`. OpenRouter's default is to route the request anyway and let the provider ignore unknown parameters. That live path was not called here. A length cutoff with empty `message.content` retries once at `retryMaxOutputTokens` (16384). Separately, an HTTP 429 or 5xx on an interview or judge call is retried inside the client, up to 6 attempts. The base waits are 2s, 4s, 8s, 16s, and 32s, each jittered by ±20%, unless `Retry-After` is present (delta-seconds or HTTP date). A wait longer than 60s is capped at 60s. Other 4xx responses and errors before a response are not retried. Only the attempt that returns to the caller is ledgered and, if it succeeds, scored. A repeat that still fails is recorded the same way as before. The judge scores `message.content` only, never `message.reasoning`. One model's failed repeat does not stop the others. `runs` is the number of scored repeats, `fewer_runs` is true when that is short of the configured count, and a model that fails more than half its repeats is `not_scored` with `not_scored_reason`. Exit code 4 means every model failed. The dry run assumes each call uses the full cap, because reasoning tokens are billed as completion tokens. It does not add HTTP retries or the length-cutoff retry.

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

`matchModels` in `match.ts` is the only tier function. It always uses the in-code `STRATEGY_TABLE`. A stored `strategy_table` that differs, including an empty one, throws. The one legacy extroversion `exclusion_reason` from the 2026-10-30 original-four file is accepted only when reading an already-written score file. Swap the hypothesis by editing `STRATEGY_TABLE` in that file.

Active traits are strictly above 70 or below 30, same as `getActiveDirectives`. A user score of exactly 30 or exactly 70 is not active. A model mean of exactly 50 is poor. If the only active trait is low neuroticism, the result is `no strong recommendation`.

OpenRouter's response `model` field is often only the requested model id, not a dated build. The score file stores that string as `judge.version` and a UTC `judge.recorded_at` beside it. Each run stores `recorded_at` beside `judge_version`. The mix guard compares version strings, so a new timestamp alone does not force `--rescore-all`.

Each trait has `wide_range`. The model-level `wide_range` is true when any trait flag is. When `spread_warning` is true, `matchModels` adds `relative_rank` (1 is closest to the target profile) and `ranking_note` ("Ranking is relative because models cluster"). Tiers stay. A model missing any active trait that counts toward the tier is `not_scored` with `missing_traits`, and is not ranked. Both extroversion rows are excluded from tiering (`exclusion_reason` explains why: extroversion scores sit near the middle of the scale and swing from run to run by about as much as models differ from each other, so they cannot separate models reliably). Extroversion means, min, max, and the low-confidence flag stay in the score file, and extroversion still appears in `active_traits`. If it is the only active trait, the result is `no strong recommendation`. UI cards should read each model's `driving_traits` for the tier and `exclusion_reason` for an excluded trait. A 429 or 5xx that uses all 6 attempts leaves that repeat unscored. The failure reason includes the attempt count and the last HTTP status. `judgeMinIntervalMs` (750 in the shipped configs) is the minimum gap between calls to the judge model id. Interview calls to that same id share the gap, because Gemini 2.5 Flash Lite is both a model under test and the judge. Other interview models are not paced. The gap adds no tokens, so the dry-run total does not change. A model that fails more than half of its repeats (6 or more of 10) is `not_scored`.

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

### Near-frontier run

`config.frontier.json` enables exactly these four. Prices are OpenRouter list prices from 2026-10-30, USD per 1M tokens. All four list a reasoning parameter, so the shared `reasoning.effort` of `minimal` is sent to them the same way as to the original four. The public models list was checked on 2026-10-30; these four were not called live.

| id | input | output |
| --- | --- | --- |
| `google/gemini-3.8-flash` | 0.825 | 4.125 |
| `x-ai/grok-4.7` | 2.00 | 6.00 |
| `anthropic/claude-opus-5.5` | 4.00 | 20.00 |
| `openai/gpt-6-luna` | 0.10 | 0.50 |

`google/gemini-2.5-flash-lite` is in that file with `enabled: false` and the same 0.10 / 0.40 price as `config.json`. The pinned judge has to have a price, and this row is not interviewed. Caps, repeats, temperature, reasoning effort, and the $10 / $15 / $40 limits match `config.json`. `run_label` is `frontier` in `config.frontier.json`, `frontier-a` in `config.frontier-a.json`, and `frontier-b` in `config.frontier-b.json`. `config.frontier.json` pins `google/gemini-3.8-flash` interviews to the `Google` provider with `allow_fallbacks` false, so a Google outage fails those repeats instead of rerouting. `config.frontier-a.json` and `config.frontier-b.json` do not set that pin. Aside from `run_label` and that pin, the three files match.

`anthropic/claude-sonnet-5.5` and `openai/gpt-5.5` are still not in either file. Re-check OpenRouter's per-token `pricing.prompt` and `pricing.completion`, multiply by 1,000,000, and add a priced row before enabling either one.

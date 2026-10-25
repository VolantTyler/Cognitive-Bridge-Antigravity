# Model benchmark

Offline-first pipeline that interviews four OpenRouter models and caches Mirror scores. Commands and the list of what this does **not** validate are in the root README under "Model benchmark".

```bash
npm run benchmark:dry-run
export OPENROUTER_API_KEY="your-openrouter-key"
npm run benchmark
```

Outputs (gitignored):

- `scripts/benchmark/output/scores.json` — schema version 2, one file the UI can render without rescoring
- `scripts/benchmark/output/ledger.jsonl` — one row per call with token counts and USD cost

`matchModels` in `match.ts` is the only tier function. It always uses the in-code `STRATEGY_TABLE`. A stored `strategy_table` that differs, including an empty one, throws. Swap the hypothesis by editing `STRATEGY_TABLE` in that file.

Active traits are strictly above 70 or below 30, same as `getActiveDirectives`. A user score of exactly 30 or exactly 70 is not active. A model mean of exactly 50 is poor. If the only active trait is low neuroticism, the result is `no strong recommendation`.

OpenRouter's response `model` field is often only the requested model id, not a dated build. The score file stores that string as `judge.version` and a UTC `judge.recorded_at` beside it. Each run stores `recorded_at` beside `judge_version`. The mix guard compares version strings, so a new timestamp alone does not force `--rescore-all`.

Each trait has `wide_range`. The model-level `wide_range` is true when any trait flag is. When `spread_warning` is true, `matchModels` adds `relative_rank` (1 is closest to the target profile) and `ranking_note` ("Ranking is relative because models cluster"). Tiers stay. A model missing any active trait that counts toward the tier is `not_scored` with `missing_traits`, and is not ranked. `driving_traits` on a model lists only the traits that set that tier.

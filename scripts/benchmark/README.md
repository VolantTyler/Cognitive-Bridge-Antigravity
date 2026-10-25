# Model benchmark

Offline-first pipeline that interviews four OpenRouter models and caches Mirror scores. Commands and the list of what this does **not** validate are in the root README under "Model benchmark".

```bash
npm run benchmark:dry-run
export OPENROUTER_API_KEY="your-openrouter-key"
npm run benchmark
```

Outputs (gitignored):

- `scripts/benchmark/output/scores.json` — schema version 1, one file the UI can render without rescoring
- `scripts/benchmark/output/ledger.jsonl` — one row per call with token counts and USD cost

`matchModels` in `match.ts` is the only tier function. Replace `STRATEGY_TABLE` or pass a table. Active traits are strictly above 70 or below 30, same as `getActiveDirectives`.

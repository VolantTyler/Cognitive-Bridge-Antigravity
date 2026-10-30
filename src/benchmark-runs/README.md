# Benchmark runs shown in the Bridge

The Bridge reads this folder. `index.json` lists the runs. Each run is one score file. The app shows the newest `tested_at` and does not merge files. Tiers are computed for that run only.

There is no run checked in yet. The 2026-10-29 10-repeat file was written before the extroversion `exclusion_reason` was reworded, and `matchModels` rejects it. That file lives under `src/modelMatch/__fixtures__/` for tests. Do not copy it here, and do not edit it to make the check pass.

## Add a run

After a fresh original-four (or frontier) benchmark whose `strategy_table` matches the current `STRATEGY_TABLE`:

1. Copy the new `scores.json` into this folder under a new name, for example `2026-11-01-original-four.json`. Leave `scripts/benchmark/output/` gitignored.
2. Add an entry to `index.json`:

```json
{
  "runs": [
    {
      "id": "2026-11-01-original-four",
      "file": "2026-11-01-original-four.json",
      "run_label": "original four",
      "tested_at": "2026-11-01T15:00:00.000Z",
      "repeats": 10
    }
  ]
}
```

`file` is the basename in this folder, not a path. Set `tested_at` to the file's `generated_at` (UTC). The card's "tested on" date is each model's own `timestamp`, formatted in the viewer's time zone.

The card's run-label chip comes from the score file's `run_label`, not from this index. `default`, a missing label, and `unlabeled` show no chip. Set `run_label` in the benchmark config to something real, such as `original four`, before the run.

A missing file, or a `schema_version` other than 4, shows the load-error state and no tiers. The newest entry is not replaced by an older file when that happens.

# Benchmark runs shown in the Bridge

The Bridge reads this folder. `index.json` lists the runs. Each run is one score file. The app shows the newest `tested_at` and does not merge files. Tiers are computed for that run only.

The shipped run is still `2026-10-30-original-four.json`, copied byte for byte from Tyler's original-four benchmark on 2026-10-30 (`generated_at` `2026-10-30T20:31:25.661Z`, schema 4, 10 repeats, `run_label` `default`). That file plus its index entry is what turns the section on. The score file's `run_label` is still `default`, so the cards show the date and repeat count and no label chip. Do not edit the file to add a chip.

An empty `runs` array turns the section off. The Bridge draws no heading until a score file and an index entry are both added.

Earlier sample output and the 2026-10-29 10-repeat file live under `src/modelMatch/__fixtures__/`. That older file was written before the extroversion `exclusion_reason` was reworded, and `matchModels` rejects it. Do not copy it here, and do not edit it to make the check pass.

Stand-in frontier runs live in that same fixtures folder as `scores-frontier-a.json` (`run_label` `frontier-a`) and `scores-frontier-b.json` (`run_label` `frontier-b`). They are not shipped. Do not copy them into this folder.

## Replace the shipped run with the frontier file

Do this when Tyler's fresh frontier `scores.json` is in hand (`scripts/benchmark/config.frontier.json`, `run_label` `frontier`, 10 repeats, schema 4). The four enabled model ids in that config are `google/gemini-3.8-flash`, `x-ai/grok-4.7`, `anthropic/claude-opus-5.5`, and `openai/gpt-6-luna`. Leave `google/gemini-2.5-flash-lite` out of the cards: it is the disabled judge.

The swap is one new file, one index entry, and deletion of the original-four file. Do not hand-edit the score file. Do not edit `EXTROVERSION_EXCLUSION_REASON`, `EXTROVERSION_WHY_BODY`, or `EXTROVERSION_SHORT` as part of the swap.

From the repo root, with `SOURCE` set to the untouched benchmark output:

```bash
SOURCE="scripts/benchmark/output/scores.json"
DEST="src/benchmark-runs/2026-10-31-frontier.json"

cp "$SOURCE" "$DEST"
cmp "$SOURCE" "$DEST"
```

`cmp` prints nothing and exits 0 when the two files are the same bytes. If it prints a difference, copy again. Do not fix a mismatch by editing `DEST`.

Replace `src/benchmark-runs/index.json` with this entry. Set `tested_at` to the file's `generated_at` (UTC). `file` is the basename, not a path. The card chip comes from the score file's `run_label`, not from this index. `config.frontier.json` sets that label to `frontier`, so the chip reads `frontier` without editing the file. `default`, a missing label, and `unlabeled` show no chip.

```json
{
  "runs": [
    {
      "id": "2026-10-31-frontier",
      "file": "2026-10-31-frontier.json",
      "run_label": "frontier",
      "tested_at": "PASTE_GENERATED_AT_FROM_THE_FILE",
      "repeats": 10
    }
  ]
}
```

Then remove the original-four file so it is no longer shipped:

```bash
rm src/benchmark-runs/2026-10-30-original-four.json
```

One index entry is the replacement. A second entry does not merge. The newest `tested_at` wins, and an older original-four timestamp would hide a frontier file that sorted earlier.

Tests and fixtures:

- `src/modelMatch/__tests__/shippedRun.test.tsx` reads whichever file `index.json` lists. It expects schema 4, four models, and a file `matchModels` accepts. It does not expect the original-four ids or a `default` label. It does expect every model in that file to have finished every configured repeat, because the current original-four file is 10 of 10 and the header then says "10 repeats" with no "N of 10 runs" tag. A replacement file where a model has `fewer_runs` needs that assertion pointed at a complete model, or dropped. The frontier fixtures cover the short-run header.
- Do not retarget tests at `gpt-5-nano`, `gemini-2.5-flash-lite`, `claude-haiku-4.5`, or `grok-4.3` inside the shipped file. Those ids stay in `src/modelMatch/__fixtures__/scores-10run-2026-10-29.json` and `match-samples.json`, which are fixtures.
- Do not replace `src/modelMatch/__fixtures__/scores-frontier-a.json` or `scores-frontier-b.json`. Those stand-ins document fewer-runs tags, close calls, and the exact `exclusion_reason` check. They are not the shipped run.
- If `matchModels` throws `strategy_table does not match the in-code STRATEGY_TABLE, including a changed exclusion_reason`, the file was written with a different extroversion exclusion sentence than the one in code. The section shows "We couldn't load benchmark scores" plus the sentence about a changed exclusion sentence. Re-run the benchmark so the file stores the current sentence. Do not edit the sentence in the JSON, and do not edit `EXTROVERSION_EXCLUSION_REASON` to match the file.

Verify:

```bash
cmp "$SOURCE" src/benchmark-runs/2026-10-31-frontier.json
npm test
npx tsc --noEmit --pretty false
npm run dev
```

`npm test` should exit 0. `npx tsc --noEmit` may still report the pre-existing `functions/src/index.ts(1,27)` `TS2307`. Ignore that line. Any other type error is in this change.

With the dev server up, open these preview pages. `chrome=0` hides the fixture banner so the section is what the Bridge renders. Profiles are A (openness 85, conscientiousness 85), B, C, D, and E.

```text
http://localhost:3000/preview/model-match.html?fixture=shipped&profile=A&chrome=0
http://localhost:3000/preview/model-match.html?fixture=shipped&profile=E&chrome=0
http://localhost:3000/preview/model-match.html?fixture=frontier-a&profile=A&chrome=0
```

On the shipped page, expect four cards, the run-label chip `frontier`, "tested on" from each model's `timestamp`, and "10 repeats". A model with `fewer_runs` also shows "N of 10 runs". A Decent card whose blocking low is exactly 50 shows "Close call: one or more test runs landed exactly on the midpoint." Check 360px width for no sideways scroll. The `frontier-a` URL is the stand-in fixture, not proof that the shipped file swapped.

Run `cmp` once more after the preview, in case the score file was opened and saved.

## Add a run beside the shipped one

Prefer the replacement steps above. To keep an older file listed as well, add another object to `runs` and leave both files in this folder. The newest `tested_at` is the one the Bridge shows. `file` is the basename. Set `tested_at` to that file's `generated_at`. The card's "tested on" date is each model's own `timestamp`, in the viewer's time zone.

Once an entry is listed, a missing file, a `schema_version` other than 4, or a strategy table that does not match the current table shows "We couldn't load benchmark scores" and a Retry button. A strategy-table mismatch adds the exclusion-sentence sentence under that line. Retry checks that bundled run again. It does not substitute an older file, and it does not invent a section when `runs` is empty.

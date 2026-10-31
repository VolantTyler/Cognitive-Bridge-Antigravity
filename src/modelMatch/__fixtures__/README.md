# Fixtures, not a published run

`match-samples.json` is Erin's `matchModels` output for five profiles against the original four.

`scores-10run-2026-10-29.json` is the real schema-4 10-repeat file from 2026-10-29. It has no `run_label`. Its extroversion `exclusion_reason` still says the means were between 55 and 61. `matchModels` rejects that string. Do not edit the file. The app's run index does not list it, and the app bundle does not import this folder.

`scores-frontier-a.json` and `scores-frontier-b.json` are stand-in frontier runs (`run_label` `frontier-a` and `frontier-b`, four models, some repeats lost to judge 429s). They are not the shipped run and must not be copied into `src/benchmark-runs/`. `matchModels` accepts them only while their stored extroversion `exclusion_reason` equals `EXTROVERSION_EXCLUSION_REASON`. Do not edit that sentence in the fixtures to follow a later rewording.

Tests and the local screenshot preview join the sample match output to the 2026-10-29 file's per-model stats (run counts, ranges, timestamps). The preview can also load a frontier fixture or the shipped file (`?fixture=frontier-a&profile=A` or `?fixture=shipped`). That preview is not part of the production build.

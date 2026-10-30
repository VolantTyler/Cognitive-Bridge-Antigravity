# Fixtures, not a published run

`match-samples.json` is Erin's `matchModels` output for five profiles against the original four.

`scores-10run-2026-10-29.json` is the real schema-4 10-repeat file from 2026-10-29. It has no `run_label`. Its extroversion `exclusion_reason` still says the means were between 55 and 61. `matchModels` rejects that string. Do not edit the file. The app's run index does not list it, and the app bundle does not import this folder.

Tests and the local screenshot preview join the sample match output to this file's per-model stats (run counts, ranges, timestamps). That preview is not part of the production build.

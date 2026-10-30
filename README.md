<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Cognitive Bridge

Cognitive Bridge is a web-based psychometric alignment application designed to calibrate and align an AI assistant's personality and communication style to match a user's unique cognitive profile.

## What This Project Is For

The application allows users to explore and interface with aligned artificial intelligence through three sequential modules:
1. **The Mirror (Psychometric Diagnostic)**: Engages the user in scenario-based stress tests to assess and map their Big Five (OCEAN) personality traits: Openness, Conscientiousness, Extroversion, Agreeableness, and Neuroticism.
2. **The Tailor (Synthesis)**: Synthesizes a customized cognitive profile from the diagnostic results and displays detailed mappings of how the user's personality traits adapt the AI's instruction set.
3. **The Bridge (Interfacing)**: Provides a chat playground allowing the user to communicate with both the aligned model (calibrated to their profile) and an unaligned model side-by-side to experience the difference.

---

## Getting Started & Installation

### Prerequisites
- **Node.js** (v20.x or higher recommended)
- **NPM** (comes with Node.js)
- A **Google Cloud Project** with the **Vertex AI API** enabled
- A **Firebase Project** (for Auth, Firestore, and Functions hosting)
- *(Optional)* A **Google Gemini API Key** (only if running the offline psychometric agent evaluation script)

### Installation Steps

1. **Clone the repository and install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment Variables:**
   Copy the example environment file:
   ```bash
   cp .env.example .env.local
   ```
   Open `.env.local` and configure your environment variables:
   ```env
   # Required only if running the psychometric agent evaluation script:
   GEMINI_API_KEY="your-gemini-api-key"

   APP_URL="http://localhost:3000"
   
   VITE_FIREBASE_API_KEY="your-firebase-api-key"
   VITE_FIREBASE_AUTH_DOMAIN="your-auth-domain"
   VITE_FIREBASE_PROJECT_ID="your-project-id"
   VITE_FIREBASE_STORAGE_BUCKET="your-storage-bucket"
   VITE_FIREBASE_MESSAGING_SENDER_ID="your-sender-id"
   VITE_FIREBASE_APP_ID="your-app-id"
   VITE_FIREBASE_FIRESTORE_DATABASE_ID="your-firestore-db-id"
   ```

3. **Run the Application Locally:**
   ```bash
   npm run dev
   ```
   The application will start running on your local server (usually `http://localhost:3000` or `http://localhost:5173`).

---

## Data & Submission Locations

This project integrates with **Cloud Firestore** to persist user session data and system feedback.

### 1. Mirror Interview Responses & Cognitive Profiles
When a user is logged in (using Google Authentication / Cloud Sync mode), their progress and responses are continuously saved:
- **Location**: Firestore Database -> **`users`** collection
- **Path**: `/users/{userId}` (where `{userId}` is the user's Firebase Auth UID)
- **Stored Fields**:
  - `scores`: The calibrated Big Five (OCEAN) personality scores map:
    - `openness`, `conscientiousness`, `extroversion`, `agreeableness`, `neuroticism` (values 0-100)
  - `mirrorMessages`: An array of messages from the psychometric diagnostic chat history (Mirror module), containing:
    - `role`: `'user'` or `'model'`
    - `content`: The message text (user responses and scenario questions)
  - `playgroundMessages`: Message history from the playground module.
  - `activeModule`: Current progress status (`mirror` | `tailor` | `playground`).
  - `updatedAt`: Timestamp of the last save.

*Note: If the user interacts as a **Local Guest** (not logged in), all session data is stored in the browser's local state and will not be sent to Cloud Firestore.*

### 2. User Feedback Submissions
When a user clicks "Leave Feedback" in the footer and submits the feedback form:
- **Location**: Firestore Database -> **`feedback`** collection
- **Path**: `/feedback/{documentId}` (auto-generated document ID)
- **Stored Fields**:
  - `name`: Name of the sender (defaults to `'Anonymous'` if left blank)
  - `email`: Sender's email address
  - `message`: Sender's feedback message
  - `createdAt`: Server-side Firestore timestamp of when it was submitted
- **Permissions & Security**: As per `firestore.rules`, the `feedback` collection is write-only for the public. Only authenticated Firestore administrators can view or manage these documents (via the Firebase Console).

---

## Model benchmark

Tyler can estimate or run the Cognitive Bridge 2.0 model benchmark without changing the app. The pipeline lives in `scripts/benchmark/`. It interviews each enabled model with the same five scenarios, in the same order, and asks one pinned judge to score **behavior in those answers** with the Mirror `JSON_SCORES` rubric. It does not ask a model to fill out a personality questionnaire about itself.

```bash
# No key and no network. Prints an upper-bound USD estimate for config.json.
npm run benchmark:dry-run

# Same estimate for the near-frontier four in config.frontier.json.
npm run benchmark:dry-run -- --config scripts/benchmark/config.frontier.json

# Live run. The key is read only from the environment.
# Copy scores.json before switching configs. Each run replaces that file.
export OPENROUTER_API_KEY="your-openrouter-key"
npm run benchmark
npm run benchmark -- --config scripts/benchmark/config.frontier.json
```

Cached scores are written to `scripts/benchmark/output/scores.json` (gitignored, schema version 4). The file includes `run_label` next to `generated_at` (a file that omits it loads as unlabeled) and each model's `providers_seen`. Each run replaces that file with only the models enabled for that run. It does not merge repeats or models into an older file. The default is 10 repeats, with the same judge, interview temperature 0.8, 8192 output cap, and `minimal` reasoning effort. `config.json` may enable at most `maxEnabledModels` (12). Extra candidates stay in the file with `enabled: false`. Every call's token counts and USD cost are appended to `scripts/benchmark/output/ledger.jsonl`. If a previous score file was produced by a different judge version string, the CLI stops and tells you to rerun with `npm run benchmark -- --rescore-all`. A score file from schema version 3 will not load. A stored strategy table that differs, including the previous extroversion `exclusion_reason` wording, fails `matchModels` and tells you to delete `scripts/benchmark/output/scores.json` and re-run. Loading that file for a new benchmark run does not do that check, so the run replaces the file when the judge version string still matches.

Every interview model and the judge share one output cap, `interview.maxOutputTokens` (8192). Reasoning tokens are billed as completion tokens and count against that cap. The request also sends OpenRouter `reasoning.effort: "minimal"` on every call, including the judge. That is the lowest effort reasoning-mandatory models such as gpt-5-nano accept (`enabled: false` is rejected). Models that ignore the field are left as they are; there is no per-model effort. If a call returns HTTP 200 with empty `message.content` and `finish_reason: "length"`, the pipeline retries that call once at `retryMaxOutputTokens` (16384) and then records a failure. The score file stores both caps and the effort, and each run records the max tokens and effort actually used. The Mirror judge scores `message.content` only and never `message.reasoning`.

An HTTP 429 or 5xx gets 6 attempts. The waits before the later attempts are 2s, 4s, 8s, 16s, and 32s, jittered by ±20%, or `Retry-After` when present, and capped at 60 seconds. It is recorded after the last attempt. Calls to the judge model id, including interviews of that same model, also wait `judgeMinIntervalMs` (750 by default) between starts. Other HTTP errors are not retried. A failed call after that (empty content, length cutoff after the one higher-cap retry, a non-retryable HTTP error, or a 429 or 5xx that used its attempts) is an unscored repeat. The run continues with the other repeats and the other models. Trait mean, low, and high use only the repeats that scored, `runs` is that count, and `fewer_runs` is true when it is below the configured repeat count (10 by default). If a model fails more than half of its repeats, the model is `not_scored` with `not_scored_reason` and a `failures` list. With 10 repeats, that is 6 or more failed repeats, so the model needs at least half of its repeats scored to stay in tiering. The process prints that summary. The exit code is non-zero (4) only when every model failed. A hard stop at $15 still aborts before the next call, including a length-cutoff retry that would cross it. The 429 and 5xx attempts happen inside that call and do not each re-check the stop.

The $10 per run warning and $15 per run stop estimate each call as if the full output cap is used, because reasoning can fill it. A failed call that returns usage is ledgered once from that usage (`estimated: false`), including reasoning inside `completion_tokens`. A failed call with no usage is one estimated row. Estimated rows do not count toward the $40 per month warning.

The judge version stored on the score file is the OpenRouter response body's `model` field. OpenRouter often returns only the requested model id there (for example `google/gemini-2.5-flash-lite`), not a dated build. The pipeline records a UTC `judge.recorded_at` next to `judge.version`, and a UTC `recorded_at` on every run next to `judge_version`. A new timestamp with the same `model` string does not trip the mix guard. Use `--rescore-all` when the underlying model may have changed while the id stayed the same.

Cached extroversion is still marked `low` confidence, and each model's extroversion mean, low, and high stay in the score file. Both extroversion strategy rows are excluded from tiering: no benchmarked model scored extroversion below 50, and the table needs one, so an active extroversion trait would otherwise mark every model poor. High extroversion keeps match confidence `low` and target `low`. Low extroversion keeps match confidence `normal` and target `low`. Neither row counts toward the tier. The match result still lists extroversion in `active_traits` and puts `exclusion_reason` on that trait. Each trait also has its own `wide_range` flag (high minus low at least the configured threshold, default 40). The model-level `wide_range` flag is true when any trait flag is true.

`matchModels` always uses the in-code `STRATEGY_TABLE`. If the score file stores a table that differs, matching throws and tells you to delete the old scores file and re-run. Active traits follow `getActiveDirectives`: strictly above 70 or strictly below 30. The match result's top-level `active_traits` lists those traits, including extroversion when it is excluded from tiering. Neuroticism below 30 is not scored and is left off that list. UI cards should read each model's `driving_traits` for the traits that set the tier, and `exclusion_reason` when a trait is reported but not tiered. A strong tier is set by the active tier-counting traits whose whole low–high range sits on the target side of 50. A decent tier is set by the active tier-counting traits whose mean is on the target side while the range reaches or crosses 50 (a bound of exactly 50 counts). A poor tier is set by the active tier-counting traits whose mean is on the wrong side of 50. A model missing a usable score for any tier-counting trait gets `tier: "not_scored"` and a `missing_traits` list.

When `spread_warning` is true, scored models also get `relative_rank` (1 is closest). Distance is Euclidean from each eligible trait mean to the target profile (high = 100, low = 0). Ties break by model id. The match result includes `ranking_note`: "Ranking is relative because models cluster". Tiers stay on the result. Models that are `not_scored` are left unranked. When the models do not cluster, there is no rank and no ranking note.

**Edge cases**

- A user score of exactly 30 or exactly 70 is not active. If no trait is strictly active, the result is `no strong recommendation` and no model is tiered.
- A model mean of exactly 50 counts as poor for that trait.
- If the only active trait is low neuroticism, that row is not scored and is left out of tiering, so the result is `no strong recommendation`.
- If the only active trait is extroversion, high or low, the result is also `no strong recommendation`. Extroversion stays in `active_traits` with `exclusion_reason`, and no model is tiered.

**What this does not validate.** The match tiers are Charlie's design hypothesis, not a result that has been shown to improve conversations. Mirror scores are not a clinical personality instrument, and a model's interview answers are not a validated Big Five profile. Scenario 1 and the waived-deadline probe are copied from the product; scenarios 2–4 are a frozen neutral battery because the live Mirror invents the middle questions per person. Dry-run input tokens are a 4-characters-per-token estimate of the real prompts, and output tokens assume the full configured maximum, including reasoning billed as completion tokens, so the printed cost is an upper bound. The one length-cutoff retry is not included in that estimate. Prices for the original four enabled models are the 2026-10-05 snapshot in `scripts/benchmark/config.json`. The six disabled open-weight models use the 2026-10-29 OpenRouter snapshot in that same file. Near-frontier ids are documented in `scripts/benchmark/README.md` and are not priced here. A tight `spread_warning` only means the saved model means sit close together. Relative rank, when present, orders that cluster. It is not evidence that the hypothesis is true, and it is not a substitute for the fit tiers.

## License

This project is licensed under the Apache-2.0 License.

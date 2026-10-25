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
# No key and no network. Prints an upper-bound USD estimate.
npm run benchmark:dry-run

# Live run. The key is read only from the environment.
export OPENROUTER_API_KEY="your-openrouter-key"
npm run benchmark
```

Cached scores are written to `scripts/benchmark/output/scores.json` (gitignored, schema version 2). Every call's token counts and USD cost are appended to `scripts/benchmark/output/ledger.jsonl`. If a previous score file was produced by a different judge version string, the CLI stops and tells you to rerun with `npm run benchmark -- --rescore-all`.

The judge version stored on the score file is the OpenRouter response body's `model` field. OpenRouter often returns only the requested model id there (for example `google/gemini-2.5-flash-lite`), not a dated build. The pipeline records a UTC `judge.recorded_at` next to `judge.version`, and a UTC `recorded_at` on every run next to `judge_version`. A new timestamp with the same `model` string does not trip the mix guard. Use `--rescore-all` when the underlying model may have changed while the id stayed the same.

Cached extroversion is marked `low` confidence because the hypothesis uses that trait through the complementary strategy. When matching a person, high extroversion stays low confidence and low extroversion (the congruent row) is normal. Each trait also has its own `wide_range` flag (high minus low at least the configured threshold, default 40). The model-level `wide_range` flag is true when any trait flag is true.

`matchModels` always uses the in-code `STRATEGY_TABLE`. If the score file stores a table, it must equal that table or matching throws. Active traits follow `getActiveDirectives`: strictly above 70 or strictly below 30. Each model's `driving_traits` lists only the traits that set that model's tier. A strong tier is set by the active traits whose whole low–high range sits on the target side of 50. A decent tier is set by the active traits whose mean is on the target side while the range reaches or crosses 50 (a bound of exactly 50 counts). A poor tier is set by the active traits whose mean is on the wrong side of 50. A model missing a usable score for any active trait that counts toward the tier gets `tier: "not_scored"` and a `missing_traits` list.

When `spread_warning` is true, scored models also get `relative_rank` (1 is closest). Distance is Euclidean from each eligible trait mean to the target profile (high = 100, low = 0). Ties break by model id. The match result includes `ranking_note`: "Ranking is relative because models cluster". Tiers stay on the result. Models that are `not_scored` are left unranked. When the models do not cluster, there is no rank and no ranking note.

**Edge cases**

- A user score of exactly 30 or exactly 70 is not active. If no trait is strictly active, the result is `no strong recommendation` and no model is tiered.
- A model mean of exactly 50 counts as poor for that trait.
- If the only active trait is low neuroticism, that row is not scored and is left out of tiering, so the result is `no strong recommendation`.

**What this does not validate.** The match tiers are Charlie's design hypothesis, not a result that has been shown to improve conversations. Mirror scores are not a clinical personality instrument, and a model's interview answers are not a validated Big Five profile. Scenario 1 and the waived-deadline probe are copied from the product; scenarios 2–4 are a frozen neutral battery because the live Mirror invents the middle questions per person. Dry-run input tokens are a 4-characters-per-token estimate of the real prompts, and output tokens assume the configured maximum, so the printed cost is an upper bound. Prices are the 2026-10-05 snapshot in `scripts/benchmark/config.json`. A tight `spread_warning` only means the saved model means sit close together. Relative rank, when present, orders that cluster. It is not evidence that the hypothesis is true, and it is not a substitute for the fit tiers.

## License

This project is licensed under the Apache-2.0 License.

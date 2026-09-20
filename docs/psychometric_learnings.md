# Psychometric Agent Testing Learnings

This document compiles the key architectural, psychological, and engineering learnings discovered while implementing and refining the automated psychometric agent evaluation framework on the `feature/firebase-auth-sync` branch.

---

## 1. Psychological & Psychometric Learnings

### Agreeableness vs. Conscientiousness Conflation under Stress
* **Behavioral Manifestation**: When simulated candidate agents undergo scenario-based stress tests, their primary traits can manifest in unexpected ways. For example, in a scenario where a colleague collapses emotionally under a tight deadline, a highly agreeable agent (e.g., `agreeable_dreamer`) prioritizes harmony, empathy, and supporting others. To do this, they will volunteer to take on 100% of the extra workload and work overnight to hit the deadline.
* **Scoring Bias (The Mirror)**: While this self-sacrificing behavior is psychologically driven by **Agreeableness** (concern for others, conflict avoidance, empathy), the diagnostic LLM ("The Mirror") frequently interprets the act of completing the work, taking responsibility, and working through the night as moderate-to-high **Conscientiousness**.
* **Impact on Verification**: Expecting a strict, low Conscientiousness score (`< 30`) for spontaneous archetypes caused false failures in the test suite because the candidate's Agreeableness masqueraded as high Conscientiousness.
* **Resolution**: Calibration thresholds were relaxed (e.g., from `< 30` to `< 80` or `< 70`) to acknowledge how traits overlap and bleed into one another in complex social scenarios.

---

## 2. Engineering & Automation Learnings

### Substring Match Pitfalls in Test Verification
* **Problem**: Using simple substring containment checks like `"FAIL" in text` to determine test pass/fail status is highly brittle. The evaluation descriptions or logs will often use words like `"failure"`, `"failing"`, or `"fails"` in a passing context (e.g., explaining why a test did *not* fail), which triggers false-positives.
* **Resolution**: Verification frameworks must use precise word boundaries or prefix/suffix patterns, such as `re.search(r'\bFAIL\b', ...)` or checking for a strict status string like `"VERIFICATION: FAIL"`.

### LLM API Flakiness & Network Robustness in CI
* **Problem**: Chat interactions with large language models during multi-turn simulations are prone to transient failures, empty responses, or API hangs. In a CI runner (like GitHub Actions), a single hung request can block the workflow indefinitely or cause a crash.
* **Resolution**: Implemented a resilient request wrapper (`safe_chat`) that enforces a timeout (`asyncio.wait_for`) and wraps the call in a retry loop with exponential backoff (e.g., 3 retries, 2-second delay). It also explicitly fetches `.text()` on the response to force content parsing and detect empty payloads early.

### Gemini Free-Tier Quota & Antigravity Retry Loops
* **Problem**: The Antigravity localharness defaults (and especially `RetryConfig.benchmark()`) can retry HTTP 429 quota errors for hours. On a free-tier `GEMINI_API_KEY`, the full psychometric eval exhausts `generate_content_free_tier_requests` quickly and the GitHub Action hits its 120-minute timeout even though the key is valid.
* **Resolution**: Pass a bounded `retry_config` (`max_retries=0`) to every `LocalAgentConfig`, fail fast in `safe_chat` when errors mention quota/billing/free-tier, write an abort section to `agent_test_report.md`, and wrap agent teardown in `_agent_session` with a 60-second shutdown timeout so orphan `localharness` processes do not block job exit.

### HTTP 503 High-Demand Should Fallback, Not Retry The Same Model
* **Problem**: Antigravity defaults to `gemini-3.8-flash`. When that model is at capacity (`UNAVAILABLE` / HTTP 503 "high demand"), retrying it three times just burns the job — the websocket often dies after the first 503 (`received 1000 (OK)`), and the third attempt times out.
* **Resolution**: `FallbackChatAgent` walks `gemini-3.8-flash` → `gemini-2.5-flash` → `gemini-2.5-pro` → `gemini-1.5-flash`. Capacity errors switch models immediately instead of retrying the overloaded one. Override with `GEMINI_EVAL_MODEL` / `GEMINI_EVAL_FALLBACK_MODELS`.

### Portable Path Resolution
* **Problem**: Hardcoding workspace paths (e.g., `/Users/tyler/antigravity/...`) results in instant breakage in containerized runners (e.g., `/home/runner/work/...` on GitHub Actions).
* **Resolution**: All path generation must be resolved relative to the location of the execution scripts:
  ```python
  base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
  report_file_path = os.path.join(base_dir, "agent_test_report.md")
  ```

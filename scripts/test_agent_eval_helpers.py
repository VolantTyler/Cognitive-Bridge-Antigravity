#!/usr/bin/env python3
"""Offline unit tests for psychometric agent eval helpers."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_eval import (
    CAPACITY_ERROR_HINT,
    DEFAULT_EVAL_MODELS,
    FallbackChatAgent,
    GeminiCapacityError,
    GeminiQuotaError,
    QUOTA_ERROR_HINT,
    _chat_on_agent,
    _eval_model_chain,
    _is_capacity_error,
    _is_quota_or_billing_error,
    _ModelCapacityError,
    _unique_models,
)


class QuotaErrorDetectionTests(unittest.TestCase):
    def test_detects_free_tier_429_message(self):
        error = (
            'request failed (code 429): You exceeded your current quota, please check '
            "your plan and billing details. Quota exceeded for metric: "
            "generativelanguage.googleapis.com/generate_content_free_tier_requests"
        )
        self.assertTrue(_is_quota_or_billing_error(error))

    def test_detects_resource_exhausted(self):
        self.assertTrue(_is_quota_or_billing_error("RESOURCE_EXHAUSTED: quota exceeded"))

    def test_ignores_unrelated_errors(self):
        self.assertFalse(_is_quota_or_billing_error("connection reset by peer"))
        self.assertFalse(_is_quota_or_billing_error("401 API key not valid"))

    def test_quota_error_hint_is_actionable(self):
        self.assertIn("aistudio.google.com", QUOTA_ERROR_HINT)
        self.assertIn("GEMINI_API_KEY", QUOTA_ERROR_HINT)

    def test_gemini_quota_error_is_runtime_error(self):
        self.assertTrue(issubclass(GeminiQuotaError, RuntimeError))


class CapacityErrorDetectionTests(unittest.TestCase):
    USER_503 = (
        "request failed (code 503): This model is currently experiencing high demand. "
        "Spikes in demand are usually temporary. Please try again later.: Error 503, "
        "Message: This model is currently experiencing high demand. Spikes in demand "
        "are usually temporary. Please try again later., Status: UNAVAILABLE, Details: []"
    )

    def test_detects_high_demand_503(self):
        self.assertTrue(_is_capacity_error(self.USER_503))

    def test_detects_model_unreachable(self):
        self.assertTrue(
            _is_capacity_error(
                "model unreachable: Error 503, Message: This model is currently experiencing high demand."
            )
        )

    def test_detects_dead_websocket_after_503(self):
        self.assertTrue(_is_capacity_error("received 1000 (OK); then sent 1000 (OK)"))

    def test_quota_is_not_capacity(self):
        quota = "request failed (code 429): You exceeded your current quota"
        self.assertTrue(_is_quota_or_billing_error(quota))
        self.assertFalse(_is_capacity_error(quota))

    def test_capacity_hint_mentions_override_env(self):
        self.assertIn("GEMINI_EVAL_MODEL", CAPACITY_ERROR_HINT)
        self.assertTrue(issubclass(GeminiCapacityError, RuntimeError))


class ModelChainTests(unittest.TestCase):
    def setUp(self):
        self._old_model = os.environ.pop("GEMINI_EVAL_MODEL", None)
        self._old_fallbacks = os.environ.pop("GEMINI_EVAL_FALLBACK_MODELS", None)

    def tearDown(self):
        for key, value in (
            ("GEMINI_EVAL_MODEL", self._old_model),
            ("GEMINI_EVAL_FALLBACK_MODELS", self._old_fallbacks),
        ):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_default_chain_has_backups_after_38_flash(self):
        chain = _eval_model_chain()
        self.assertEqual(chain[0], "gemini-3.8-flash")
        self.assertIn("gemini-2.5-flash", chain)
        self.assertGreaterEqual(len(chain), 3)
        self.assertEqual(chain, _unique_models(DEFAULT_EVAL_MODELS))

    def test_env_primary_is_tried_first(self):
        os.environ["GEMINI_EVAL_MODEL"] = "gemini-2.0-flash"
        chain = _eval_model_chain()
        self.assertEqual(chain[0], "gemini-2.0-flash")
        self.assertIn("gemini-3.8-flash", chain[1:])

    def test_env_fallbacks_are_appended_uniquely(self):
        os.environ["GEMINI_EVAL_FALLBACK_MODELS"] = "gemini-2.5-flash, gemini-2.0-flash"
        chain = _eval_model_chain()
        self.assertEqual(chain.count("gemini-2.5-flash"), 1)
        self.assertIn("gemini-2.0-flash", chain)


class ChatRetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_capacity_error_does_not_retry_same_model(self):
        class BoomAgent:
            def __init__(self):
                self.calls = 0

            async def chat(self, prompt):
                self.calls += 1
                raise RuntimeError(
                    "request failed (code 503): This model is currently experiencing high demand."
                )

        agent = BoomAgent()
        with self.assertRaises(_ModelCapacityError):
            await _chat_on_agent(agent, "hi", max_retries=3, delay=0)
        self.assertEqual(agent.calls, 1)

    async def test_quota_error_does_not_retry(self):
        class QuotaAgent:
            def __init__(self):
                self.calls = 0

            async def chat(self, prompt):
                self.calls += 1
                raise RuntimeError("request failed (code 429): You exceeded your current quota")

        agent = QuotaAgent()
        with self.assertRaises(GeminiQuotaError):
            await _chat_on_agent(agent, "hi", max_retries=3, delay=0)
        self.assertEqual(agent.calls, 1)


class FallbackAgentTests(unittest.IsolatedAsyncioTestCase):
    async def test_switches_to_backup_model_on_503(self):
        class OkResponse:
            async def text(self):
                return "hello from backup"

        class OkAgent:
            async def chat(self, prompt):
                return OkResponse()

        opened = []
        agent = FallbackChatAgent("sys", models=["gemini-3.8-flash", "gemini-2.5-flash"])

        async def fake_open(model):
            opened.append(model)
            if model == "gemini-3.8-flash":
                class Boom:
                    async def chat(self, prompt):
                        raise RuntimeError(
                            "request failed (code 503): This model is currently experiencing high demand."
                        )

                agent.agent = Boom()
            else:
                agent.agent = OkAgent()
            agent.current_model = model

        agent._open = fake_open
        await fake_open("gemini-3.8-flash")
        response = await agent.chat("hi", delay=0)
        self.assertEqual(await response.text(), "hello from backup")
        self.assertEqual(opened, ["gemini-3.8-flash", "gemini-2.5-flash"])
        self.assertEqual(agent.current_model, "gemini-2.5-flash")


if __name__ == "__main__":
    unittest.main()

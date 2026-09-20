#!/usr/bin/env python3
"""Offline unit tests for psychometric agent eval helpers."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_eval import GeminiQuotaError, QUOTA_ERROR_HINT, _is_quota_or_billing_error


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


if __name__ == "__main__":
    unittest.main()

"""Offline tests for the Jev verdict mappers. No network."""

import os
import unittest

os.environ.pop("TYPESAFE_API_KEY", None)

from jev_judge import (  # noqa: E402
    alignment_verdict,
    build_ocean_state,
    judge_ocean_profile,
    load_spec,
    ocean_verdict,
)


def _matching_ocean():
    answers = {}
    for trait in (
        "openness",
        "conscientiousness",
        "extroversion",
        "agreeableness",
        "neuroticism",
    ):
        answers[trait] = {"type": "choice", "choice": "matches", "confidence": 0.9}
    answers["profile_usable"] = {"type": "noul", "noul": 0.91}
    answers["note"] = "EVALUATION: FAIL is not a verdict field"
    return answers


class JevVerdictTests(unittest.TestCase):
    def test_ocean_pass_ignores_failure_words_outside_typed_fields(self):
        verdict = ocean_verdict(_matching_ocean(), load_spec())
        self.assertTrue(verdict["passed"])
        self.assertEqual(verdict["reasons"], [])

    def test_ocean_fail_on_too_high_choice(self):
        answers = _matching_ocean()
        answers["conscientiousness"] = {"type": "choice", "choice": "too_high", "confidence": 0.99}
        verdict = ocean_verdict(answers, load_spec())
        self.assertFalse(verdict["passed"])
        self.assertTrue(any("conscientiousness" in reason for reason in verdict["reasons"]))

    def test_alignment_requires_mechanism_highlights(self):
        spec = load_spec()
        passed = alignment_verdict({
            "aligned_applies_directives": {"type": "noul", "noul": 0.9},
            "unaligned_applies_inverse": {"type": "noul", "noul": 0.8},
            "replies_materially_different": {"type": "noul", "noul": 0.75},
            "aligned_highlight_kind": {"type": "choice", "choice": "alignment_mechanism", "confidence": 0.8},
            "unaligned_highlight_kind": {"type": "choice", "choice": "misalignment_mechanism", "confidence": 0.8},
        }, spec)
        self.assertTrue(passed["passed"])

        failed = alignment_verdict({
            "aligned_applies_directives": {"type": "noul", "noul": 0.9},
            "unaligned_applies_inverse": {"type": "noul", "noul": 0.9},
            "replies_materially_different": {"type": "noul", "noul": 0.9},
            "aligned_highlight_kind": {"type": "choice", "choice": "advice_summary", "confidence": 0.8},
            "unaligned_highlight_kind": {"type": "choice", "choice": "misalignment_mechanism", "confidence": 0.8},
        }, spec)
        self.assertFalse(failed["passed"])

    def test_missing_key_skips_without_calling_the_network(self):
        result = judge_ocean_profile(
            [{"role": "user", "content": "I would cancel the demo."}],
            {"openness": 40, "conscientiousness": 80, "extroversion": 20, "agreeableness": 50, "neuroticism": 70},
        )
        self.assertTrue(result["skipped"])
        self.assertEqual(result["report"], "judge skipped")

    def test_ocean_state_includes_the_user_and_the_bleed_note(self):
        state = build_ocean_state(
            [{"role": "user", "content": "I stayed up for them."}],
            {"openness": 40, "conscientiousness": 80, "extroversion": 20, "agreeableness": 50, "neuroticism": 70},
            load_spec(),
        )
        self.assertIn("I stayed up for them.", state)
        self.assertIn("not automatically high Conscientiousness", state)


if __name__ == "__main__":
    unittest.main()

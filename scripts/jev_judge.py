"""Typed Jev judgments. Question text and gates live in src/jev/questions.json."""

import json
import os
import re
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_PATH = os.path.join(ROOT, "src", "jev", "questions.json")
DECIDE_URL = "https://api.typesafe.ai/v1/systemone"

TRAITS = (
    "openness",
    "conscientiousness",
    "extroversion",
    "agreeableness",
    "neuroticism",
)
LABELS = {
    "openness": "Openness",
    "conscientiousness": "Conscientiousness",
    "extroversion": "Extroversion",
    "agreeableness": "Agreeableness",
    "neuroticism": "Neuroticism",
}
HIGHLIGHT_RE = re.compile(r'<mark-bridge explanation="([^"]*)">(.*?)</mark-bridge>')
ALIGNED_HIGHLIGHT = "alignment_mechanism"
UNALIGNED_HIGHLIGHT = "misalignment_mechanism"


class JevJudgeError(Exception):
    pass


def load_spec():
    with open(SPEC_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def score_band(value):
    if value < 30:
        return "low"
    if value > 70:
        return "high"
    return "mid"


def _clip(text, limit):
    trimmed = (text or "").strip()
    if len(trimmed) <= limit:
        return trimmed
    return trimmed[:limit] + "…"


def build_ocean_state(dialogue, scores, spec):
    lines = [
        "Known scoring bias:",
        spec["bleedNote"],
        "",
        "Proposed scores (0-100). Bands: below 30 low, 30 to 70 mid, above 70 high.",
    ]
    for trait in TRAITS:
        value = scores.get(trait, 50)
        lines.append(f"{LABELS[trait]}: {value} ({score_band(value)})")
    lines.extend(["", "Dialogue:"])
    previous_scenario = ""
    user_count = 0
    for message in dialogue:
        role = message.get("role")
        content = message.get("content") or ""
        if role in ("model", "assistant"):
            previous_scenario = _clip(content.split("JSON_SCORES:")[0], 400)
            continue
        if role != "user":
            continue
        answer = _clip(content, 1500)
        if not answer:
            continue
        user_count += 1
        if previous_scenario:
            lines.append(f"Scenario {user_count}: {previous_scenario}")
        lines.append(f"User {user_count}: {answer}")
        previous_scenario = ""
    if user_count == 0:
        lines.append("The user has not answered yet.")
    return "\n".join(lines)


def ocean_questions(scores, spec):
    questions = {}
    template = spec["ocean"]["traitInstruction"]
    criteria = spec["ocean"]["traitCriteria"]
    for trait in TRAITS:
        questions[trait] = {
            "type": "choice",
            "instructions": template.replace("{label}", LABELS[trait]).replace("{score}", str(scores.get(trait, 50))),
            "criteria": criteria,
        }
    questions["profile_usable"] = spec["ocean"]["profileUsable"]
    return questions


def _format_directives(directives):
    if not directives:
        return "- No extreme-trait directives. Expect a balanced professional tone."
    return "\n".join(f"- [{item['strategy']}] {item['text']}" for item in directives)


def _split_highlights(reply):
    highlights = []

    def _replace(match):
        highlights.append((match.group(2), match.group(1)))
        return match.group(2)

    body = HIGHLIGHT_RE.sub(_replace, reply or "")
    return body, highlights


def _format_reply(title, reply):
    body, highlights = _split_highlights(reply)
    lines = [f"{title}:", _clip(body, 4000)]
    if not highlights:
        lines.append("Highlight explanations: none")
        return "\n".join(lines)
    lines.append("Highlight explanations:")
    for text, explanation in highlights:
        lines.append(f'- "{_clip(text, 300)}" — {_clip(explanation, 500)}')
    return "\n".join(lines)


def _directive_sets(scores):
    from agent_eval import STEERING_LIBRARY

    aligned = []
    inverse = []
    for directive in STEERING_LIBRARY:
        value = scores.get(directive["trait"], 50)
        if directive["threshold"] == "high" and value > 70:
            aligned.append(directive)
        elif directive["threshold"] == "low" and value < 30:
            aligned.append(directive)
        if directive["threshold"] == "low" and value > 70:
            inverse.append(directive)
        elif directive["threshold"] == "high" and value < 30:
            inverse.append(directive)
    return aligned, inverse


def build_alignment_state(scores, user_query, aligned_reply, unaligned_reply):
    aligned, inverse = _directive_sets(scores)
    score_lines = [
        f"{LABELS[trait]}: {scores.get(trait, 50)} ({score_band(scores.get(trait, 50))})"
        for trait in TRAITS
    ]
    return "\n".join([
        "Proposed scores (0-100). Bands: below 30 low, 30 to 70 mid, above 70 high.",
        *score_lines,
        "",
        "Aligned directives:",
        _format_directives(aligned),
        "",
        "Inverse directives:",
        _format_directives(inverse),
        "",
        "User request:",
        _clip(user_query, 1500),
        "",
        _format_reply("Aligned reply", aligned_reply),
        "",
        _format_reply("Unaligned reply", unaligned_reply),
    ])


def alignment_questions(spec):
    return spec["alignment"]["questions"]


def decide(state, questions, spec):
    api_key = os.environ.get("TYPESAFE_API_KEY")
    if not api_key:
        return {"skipped": True, "reason": "judge skipped"}
    body = json.dumps({
        "model": spec.get("model", "jev-latest"),
        "state": state,
        "questions": questions,
    }).encode("utf-8")
    request = urllib.request.Request(
        DECIDE_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise JevJudgeError(f"Jev judge HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise JevJudgeError(f"Jev judge unreachable: {exc.reason}") from exc
    answers = payload.get("answers")
    if not isinstance(answers, dict):
        raise JevJudgeError("Jev judge returned no answers")
    return {"skipped": False, "answers": answers, "model": payload.get("model")}


def ocean_verdict(answers, spec):
    gate = spec["gates"]["traitMatchConfidence"]
    noul_gate = spec["gates"]["alignmentNoul"]
    reasons = []
    passed = True
    for trait in TRAITS:
        answer = answers.get(trait) or {}
        choice = answer.get("choice")
        confidence = answer.get("confidence") if isinstance(answer.get("confidence"), (int, float)) else 0
        if answer.get("type") != "choice" or choice != "matches" or confidence < gate:
            passed = False
            reasons.append(f"{trait}: {choice} ({confidence})")
    profile = answers.get("profile_usable") or {}
    noul = profile.get("noul")
    if not isinstance(noul, (int, float)) or noul < noul_gate:
        passed = False
        reasons.append(f"profile_usable: {noul}")
    return {"passed": passed, "reasons": reasons}


def alignment_verdict(answers, spec):
    noul_gate = spec["gates"]["alignmentNoul"]
    reasons = []
    passed = True
    for key in ("aligned_applies_directives", "unaligned_applies_inverse", "replies_materially_different"):
        answer = answers.get(key) or {}
        noul = answer.get("noul")
        if answer.get("type") != "noul" or not isinstance(noul, (int, float)) or noul < noul_gate:
            passed = False
            reasons.append(f"{key}: {noul}")
    expected = {
        "aligned_highlight_kind": ALIGNED_HIGHLIGHT,
        "unaligned_highlight_kind": UNALIGNED_HIGHLIGHT,
    }
    for key, want in expected.items():
        answer = answers.get(key) or {}
        choice = answer.get("choice")
        if answer.get("type") != "choice" or choice != want:
            passed = False
            reasons.append(f"{key}: {choice}")
    return {"passed": passed, "reasons": reasons}


def _report(verdict, answers, model):
    return json.dumps({
        "passed": verdict["passed"],
        "reasons": verdict["reasons"],
        "model": model,
        "answers": answers,
    }, indent=2)


def judge_ocean_profile(dialogue, scores):
    spec = load_spec()
    if not os.environ.get("TYPESAFE_API_KEY"):
        return {"skipped": True, "passed": True, "report": "judge skipped"}
    try:
        result = decide(build_ocean_state(dialogue, scores, spec), ocean_questions(scores, spec), spec)
    except JevJudgeError as exc:
        return {"skipped": False, "passed": False, "report": f"Jev judge error: {exc}"}
    verdict = ocean_verdict(result["answers"], spec)
    return {
        "skipped": False,
        "passed": verdict["passed"],
        "report": _report(verdict, result["answers"], result.get("model")),
    }


def judge_alignment(scores, user_query, aligned_reply, unaligned_reply):
    spec = load_spec()
    if not os.environ.get("TYPESAFE_API_KEY"):
        return {"skipped": True, "passed": True, "report": "judge skipped"}
    try:
        result = decide(
            build_alignment_state(scores, user_query, aligned_reply, unaligned_reply),
            alignment_questions(spec),
            spec,
        )
    except JevJudgeError as exc:
        return {"skipped": False, "passed": False, "report": f"Jev judge error: {exc}"}
    verdict = alignment_verdict(result["answers"], spec)
    return {
        "skipped": False,
        "passed": verdict["passed"],
        "report": _report(verdict, result["answers"], result.get("model")),
    }

#!/usr/bin/env python3
"""
Cognitive Bridge - Psychometric Agent Testing Framework
Uses the Google Antigravity SDK to simulate and validate personality diagnostic interviews,
OCEAN profiling accuracy, and playground alignment behavior.
"""

import asyncio
from contextlib import asynccontextmanager
import json
import re
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Fail fast in CI: Antigravity's RetryConfig.benchmark() retries 429/503 for hours.
_AGENT_SHUTDOWN_TIMEOUT_SECONDS = 60
_AGENT_CHAT_TIMEOUT_SECONDS = 120
# Default is Antigravity's gemini-3.8-flash; older Flash/Pro models are the 503 backup chain.
DEFAULT_EVAL_MODELS = (
    "gemini-3.8-flash",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-1.5-flash",
)

QUOTA_ERROR_HINT = (
    "Gemini API quota exceeded (likely free-tier limits on GEMINI_API_KEY). "
    "Enable billing at https://aistudio.google.com/apikey, create a key from the "
    "billed project, and update the GEMINI_API_KEY GitHub Actions secret. "
    "Monitor usage at https://ai.dev/rate-limit."
)

CAPACITY_ERROR_HINT = (
    "All configured Gemini models returned HTTP 503 (high demand / unavailable). "
    "Retry later, or set GEMINI_EVAL_MODEL / GEMINI_EVAL_FALLBACK_MODELS to a "
    "model that is currently serving."
)


class GeminiQuotaError(RuntimeError):
    """Raised when Gemini API quota or billing blocks the psychometric eval."""


class GeminiCapacityError(RuntimeError):
    """Raised when every model in the eval fallback chain is at capacity."""


class _ModelCapacityError(RuntimeError):
    """Raised when the current model is overloaded; switch to the next fallback."""


def _is_quota_or_billing_error(error) -> bool:
    msg = str(error).lower()
    markers = (
        "429",
        "quota exceeded",
        "free_tier",
        "exceeded your current quota",
        "resource_exhausted",
        "quota_exhausted",
        "check your plan and billing",
    )
    return any(marker in msg for marker in markers)


def _is_capacity_error(error) -> bool:
    """True for 503 high-demand / unavailable — retry a different model, not the same one."""
    if _is_quota_or_billing_error(error):
        return False
    msg = str(error).lower()
    markers = (
        "503",
        "high demand",
        "unavailable",
        "model unreachable",
        "overloaded",
        "at capacity",
        "currently experiencing",
        "received 1000",
        "connection closed",
    )
    return any(marker in msg for marker in markers)


def _unique_models(models):
    seen = set()
    ordered = []
    for name in models:
        if not name or name in seen:
            continue
        seen.add(name)
        ordered.append(name)
    return ordered


def _eval_model_chain():
    """Primary eval model plus backups. Override with GEMINI_EVAL_MODEL / GEMINI_EVAL_FALLBACK_MODELS."""
    primary = os.environ.get("GEMINI_EVAL_MODEL", "").strip()
    extra = [
        name.strip()
        for name in os.environ.get("GEMINI_EVAL_FALLBACK_MODELS", "").split(",")
        if name.strip()
    ]
    chain = []
    if primary:
        chain.append(primary)
    chain.extend(DEFAULT_EVAL_MODELS)
    chain.extend(extra)
    return _unique_models(chain)


def _antigravity_imports():
    from google.antigravity import Agent, LocalAgentConfig
    from google.antigravity.types import (
        CustomSystemInstructions,
        ModelAPIRetryConfig,
        RetryConfig,
    )
    return Agent, LocalAgentConfig, CustomSystemInstructions, RetryConfig, ModelAPIRetryConfig


def _eval_retry_config():
    """Bounded retries for CI — avoid Antigravity benchmark() unbounded 429 loops."""
    _, _, _, RetryConfig, ModelAPIRetryConfig = _antigravity_imports()
    return RetryConfig(
        api_retry=ModelAPIRetryConfig(
            max_retries=0,
            initial_sleep_duration_ms=1000,
        )
    )


def _make_local_agent_config(system_instructions, model=None):
    _, LocalAgentConfig, CustomSystemInstructions, _, _ = _antigravity_imports()
    if not isinstance(system_instructions, CustomSystemInstructions):
        system_instructions = CustomSystemInstructions(text=system_instructions)
    kwargs = {
        "system_instructions": system_instructions,
        "retry_config": _eval_retry_config(),
    }
    if model:
        kwargs["model"] = model
    return LocalAgentConfig(**kwargs)


async def _close_agent(agent):
    if agent is None:
        return
    try:
        await asyncio.wait_for(
            agent.__aexit__(None, None, None),
            timeout=_AGENT_SHUTDOWN_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        print(
            f"[Warning] Agent session shutdown timed out after "
            f"{_AGENT_SHUTDOWN_TIMEOUT_SECONDS}s.",
            flush=True,
        )
    except Exception as exc:
        print(f"[Warning] Agent session shutdown error: {exc}", flush=True)


class FallbackChatAgent:
    """Antigravity agent that switches models on HTTP 503 / capacity errors."""

    def __init__(self, system_instructions, models=None):
        self.system_instructions = system_instructions
        self.models = list(models or _eval_model_chain())
        if not self.models:
            raise ValueError("No Gemini eval models configured.")
        self.model_index = 0
        self.agent = None
        self.current_model = None

    async def start(self):
        last_error = None
        for index, model in enumerate(self.models):
            try:
                await self._open(model)
                self.model_index = index
                return
            except GeminiQuotaError:
                raise
            except Exception as exc:
                last_error = exc
                print(
                    f"[Model fallback] Failed to start {model}: {exc}. Trying next model...",
                    flush=True,
                )
                await _close_agent(self.agent)
                self.agent = None
        raise GeminiCapacityError(
            f"{CAPACITY_ERROR_HINT}\nTried models: {', '.join(self.models)}\n"
            f"Last error: {last_error}"
        ) from last_error

    async def _open(self, model):
        await _close_agent(self.agent)
        Agent, *_ = _antigravity_imports()
        config = _make_local_agent_config(self.system_instructions, model=model)
        agent = Agent(config)
        await agent.__aenter__()
        self.agent = agent
        self.current_model = model
        print(f"[Using model: {model}]", flush=True)

    async def _advance_model(self, error):
        last_error = error
        for index in range(self.model_index + 1, len(self.models)):
            next_model = self.models[index]
            print(
                f"[Model fallback] {self.current_model} at capacity ({error}). "
                f"Switching to {next_model}...",
                flush=True,
            )
            try:
                await self._open(next_model)
                self.model_index = index
                return
            except GeminiQuotaError:
                raise
            except Exception as exc:
                last_error = exc
                print(
                    f"[Model fallback] Failed to start {next_model}: {exc}. Trying next model...",
                    flush=True,
                )
                await _close_agent(self.agent)
                self.agent = None
        raise GeminiCapacityError(
            f"{CAPACITY_ERROR_HINT}\nTried models: {', '.join(self.models)}\n"
            f"Last error: {last_error}"
        ) from last_error

    async def chat(self, prompt, max_retries=3, delay=2, timeout=_AGENT_CHAT_TIMEOUT_SECONDS):
        last_error = None
        while self.model_index < len(self.models):
            try:
                return await _chat_on_agent(
                    self.agent,
                    prompt,
                    max_retries=max_retries,
                    delay=delay,
                    timeout=timeout,
                )
            except _ModelCapacityError as exc:
                last_error = exc
                await self._advance_model(exc)
        raise GeminiCapacityError(
            f"{CAPACITY_ERROR_HINT}\nTried models: {', '.join(self.models)}\n"
            f"Last error: {last_error}"
        ) from last_error

    async def close(self):
        await _close_agent(self.agent)
        self.agent = None


@asynccontextmanager
async def _agent_session(system_instructions):
    """Start an Antigravity agent with model fallback and bounded teardown."""
    agent = FallbackChatAgent(system_instructions)
    await agent.start()
    try:
        yield agent
    finally:
        await agent.close()


async def _chat_on_agent(agent, prompt, max_retries=3, delay=2, timeout=_AGENT_CHAT_TIMEOUT_SECONDS):
    last_error = None
    for attempt in range(max_retries):
        try:
            response = await asyncio.wait_for(agent.chat(prompt), timeout=timeout)
            text = await asyncio.wait_for(response.text(), timeout=timeout)
            if text and text.strip():
                return response
            last_error = ValueError("Empty model response")
        except GeminiQuotaError:
            raise
        except _ModelCapacityError:
            raise
        except Exception as exc:
            if _is_quota_or_billing_error(exc):
                raise GeminiQuotaError(f"{QUOTA_ERROR_HINT}\n\nOriginal error: {exc}") from exc
            if _is_capacity_error(exc):
                raise _ModelCapacityError(str(exc)) from exc
            last_error = exc
            if attempt + 1 < max_retries:
                print(
                    f"Warning: agent.chat failed on attempt {attempt + 1}/{max_retries} "
                    f"with error: {exc}. Retrying in {delay} seconds...",
                    flush=True,
                )
                await asyncio.sleep(delay)
    raise RuntimeError(
        f"agent.chat failed after {max_retries} attempts. Last error: {last_error}"
    )


async def safe_chat(agent, prompt, max_retries=3, delay=2, timeout=_AGENT_CHAT_TIMEOUT_SECONDS):
    if isinstance(agent, FallbackChatAgent):
        return await agent.chat(prompt, max_retries=max_retries, delay=delay, timeout=timeout)
    return await _chat_on_agent(
        agent, prompt, max_retries=max_retries, delay=delay, timeout=timeout
    )

# Replicate steering library from src/constants.ts (doc 02 matrix)
STEERING_LIBRARY = [
    {
        "trait": "openness",
        "threshold": "high",
        "strategy": "congruent",
        "text": "Explore novel angles, theoretical mechanisms, and cross-domain analogies. Brainstorm broadly before converging.",
    },
    {
        "trait": "openness",
        "threshold": "low",
        "strategy": "congruent",
        "text": "Focus strictly on concrete, practical, and standard industry implementations. Avoid speculative or abstract digressions.",
    },
    {
        "trait": "conscientiousness",
        "threshold": "high",
        "strategy": "congruent",
        "text": "Provide concise, high-density, rigorously structured responses. Focus on precision and adhere strictly to specifications.",
    },
    {
        "trait": "conscientiousness",
        "threshold": "low",
        "strategy": "compensatory",
        "text": "Act as an external executive function: break complex tasks into bite-sized milestones, clear step-by-step checklists, and immediate next actions.",
    },
    {
        "trait": "extroversion",
        "threshold": "high",
        "strategy": "complementary",
        "text": "Be engaging and collaborative, but defer to user leadership. Keep conversational momentum without competing for dominance or debating minor points.",
    },
    {
        "trait": "extroversion",
        "threshold": "low",
        "strategy": "congruent",
        "text": "Keep responses concise, focused, and low-friction. Minimize conversational pleasantries; lead directly with the answer.",
    },
    {
        "trait": "agreeableness",
        "threshold": "high",
        "strategy": "congruent",
        "text": "Be exceptionally supportive, diplomatic, and empathetic. Build rapport, validate concerns, and frame suggestions collaboratively (\"Let's explore...\"). Maintain a civility floor.",
    },
    {
        "trait": "agreeableness",
        "threshold": "low",
        "strategy": "congruent",
        "text": "Be direct, candid, and intellectually rigorous. Challenge assumptions with unvarnished critique; avoid diplomatic softening or filler.",
    },
    {
        "trait": "neuroticism",
        "threshold": "high",
        "strategy": "compensatory",
        "text": "Maintain a calm, steady, and reassuring presence. Provide predictable structure, clear boundaries, and grounding clarity under uncertainty.",
    },
    {
        "trait": "neuroticism",
        "threshold": "low",
        "strategy": "complementary",
        "text": "Be dynamic, bold, and challenging. Play devil's advocate and introduce rigorous edge-case stress tests without hesitation.",
    },
]


def get_active_directives(scores):
    active = []
    for d in STEERING_LIBRARY:
        value = scores.get(d["trait"], 50)
        if d["threshold"] == "high" and value > 70:
            active.append(d)
        elif d["threshold"] == "low" and value < 30:
            active.append(d)
    return active


def validate_steering_matrix_regressions():
    """Offline regression checks for doc 02 matrix (mirrors src/constants/__tests__/steeringLibrary.test.ts)."""
    def directive_for(scores, trait):
        for d in get_active_directives(scores):
            if d["trait"] == trait:
                return d["text"]
        return ""

    high_a = {"openness": 50, "conscientiousness": 50, "extroversion": 50, "agreeableness": 85, "neuroticism": 50}
    a_text = directive_for(high_a, "agreeableness").lower()
    assert any(w in a_text for w in ("supportive", "empathetic", "diplomatic", "rapport")), a_text
    assert "adversarial" not in a_text and "critical" not in a_text, a_text

    low_e = {"openness": 50, "conscientiousness": 50, "extroversion": 15, "agreeableness": 50, "neuroticism": 50}
    e_text = directive_for(low_e, "extroversion").lower()
    assert "concise" in e_text or "low-friction" in e_text, e_text
    assert "high-energy" not in e_text and "enthusiastic" not in e_text, e_text

    high_c = {"openness": 50, "conscientiousness": 85, "extroversion": 50, "agreeableness": 50, "neuroticism": 50}
    c_text = directive_for(high_c, "conscientiousness").lower()
    assert "high-density" in c_text or "precision" in c_text, c_text
    assert "flexible" not in c_text and "spontaneous" not in c_text, c_text

    print("[Matrix regression checks: PASS]")

MIRROR_SYSTEM_PROMPT = """
You are "The Mirror", an adaptive personality diagnostic agent. 
Your goal is to interview the user to determine their OCEAN (Big Five) personality traits.

CRITICAL INSTRUCTIONS:
- DO NOT ask direct questions (e.g., "On a scale of 1-10, how extroverted are you?").
- USE scenario-based stress tests. (e.g., "You have a bug in your code 10 minutes before a huge demo. Do you dirty-hack it or cancel the demo? Why?")
- Evaluate: Openness, Conscientiousness, Extroversion, Agreeableness, Neuroticism.
- Keep the conversation engaging and psychological.
- Every few messages, internalize the scores.
- You must ask exactly 5 scenarios/questions in total.
- After the user responds to the 5th scenario/question, calculate the final scores and output the JSON_SCORES block. Do not ask any more questions.

Format for final output:
JSON_SCORES:
{
  "openness": 85,
  "conscientiousness": 40,
  "extroversion": 60,
  "agreeableness": 90,
  "neuroticism": 30
}

TRAIT BLEED / ASPECT DISAMBIGUATION (Agreeableness vs Conscientiousness):
- "Working overnight / taking on extra work" is NOT automatically high Conscientiousness.
- If motivation is empathy, shielding a teammate, harmony, or conflict avoidance → attribute to Agreeableness (Compassion), not Conscientiousness (Industriousness/Orderliness).
- If motivation is duty to schedule/spec, personal standards, or finishing what they started regardless of others → Conscientiousness.
- When a response is ambiguous between helping-vs-duty, ask this disambiguation probe as one of the remaining scenario slots (prefer as Question 4/5 or 5/5 if bleed is already visible):

DISAMBIGUATION SCENARIO (use verbatim when needed):
"A teammate falls sick right before launch. Management officially waives the deadline. Do you keep grinding anyway to finish what you started, or shut down and check in on your teammate? Why?"

- In your internal scoring notes, record: bleed_risk: agreeableness_vs_conscientiousness = true|false
- Final JSON_SCORES stays the five OCEAN keys only for this milestone (no new required fields).
"""

def aligned_highlight_rubric(has_directives):
    if has_directives:
        return """Each explanation MUST:
- Name the relevant OCEAN score(s) and active directive strategy (congruent, compensatory, or complementary).
- Explain WHY this phrasing aligns with or balances the user's profile — not what advice you are giving.
- Focus on alignment mechanics (similarity-attraction or need-complementarity), not generic coaching.
- NEVER describe reinforcing bias, mirroring extremes, or echoing dysfunction."""
    return """Each explanation MUST:
- Explain WHY this phrasing reflects balanced, professional alignment for a profile with no critical trait spikes (all OCEAN scores between 30 and 70).
- Do NOT invent a congruent, compensatory, or complementary strategy — none apply for this mid-range profile.
- Focus on why the tone is neutrally helpful rather than trait-targeted steering."""


def unaligned_highlight_rubric(has_misalignment_directives):
    if has_misalignment_directives:
        return """Each explanation MUST:
- Name the OCEAN trait spike(s) being reinforced and how this phrasing feeds that bias.
- Explain WHY this phrasing is misaligned — how it echoes or amplifies extremes instead of balancing them.
- Contrast briefly with what an aligned response would do differently for this trait.
- NEVER use language like "balances", "supports your profile", "compensates", "minimizes bias", or "provides structure"."""
    return """Each explanation MUST:
- Explain why this phrasing would be a poor generic mismatch for a mid-range OCEAN profile with no trait spikes (>70 or <30).
- Do NOT invent trait extremes or name a specific strategy tag unless the user's scores justify it.
- Contrast briefly with balanced professional alignment."""


def generate_alignment_prompt(scores):
    directives = get_active_directives(scores)
    directives_str = (
        "\n".join(f"- [{d['strategy']}] {d['text']}" for d in directives)
        if directives
        else "- Maintain a balanced, helpful, and professional tone."
    )

    return f"""
You are an aligned AI assistant. Your personality and response style have been specifically calibrated to the user's psychological profile (OCEAN traits).

USER PROFILE SUMMARY:
- Openness: {scores.get('openness', 50)}/100
- Conscientiousness: {scores.get('conscientiousness', 50)}/100
- Extroversion: {scores.get('extroversion', 50)}/100
- Agreeableness: {scores.get('agreeableness', 50)}/100
- Neuroticism: {scores.get('neuroticism', 50)}/100

ALIGNMENT THEORY (Cognitive Bridge): Prefer need-complementarity / compensatory counterbalance where marked complementary or compensatory; prefer similarity-attraction (congruence) where marked congruent. Never claim clinical validation.

ALIGNMENT DIRECTIVES:
{directives_str}

Follow these directives strictly while being functionally useful.

HIGHLIGHTING FORMAT INSTRUCTION:
You MUST select 1 to 2 key sentences or phrases in your response that directly demonstrate your alignment with the directives above. Wrap each selected sentence/phrase in custom tags:
<mark-bridge explanation="Your explanation here">The sentence itself</mark-bridge>
{aligned_highlight_rubric(bool(directives))}
Do not nest tags. Keep the wrap on complete, natural sentences.
"""

def generate_inverse_alignment_prompt(scores):
    directives = []
    for d in STEERING_LIBRARY:
        value = scores.get(d["trait"], 50)
        # INVERT: If high, apply the LOW directive. If low, apply the HIGH directive.
        if d["threshold"] == "low" and value > 70:
            directives.append(f"- [{d['strategy']}] {d['text']}")
        elif d["threshold"] == "high" and value < 30:
            directives.append(f"- [{d['strategy']}] {d['text']}")

    directives_str = "\n".join(directives) if directives else "- Be overly passive or aggressive to mismatch the user."
    
    return f"""
You are an UNALIGNED AI assistant. Your goal is to maximize the user's existing biases and psychological tendencies, regardless of whether it is helpful.

USER PROFILE:
- Openness: {scores.get('openness', 50)}/100
- Conscientiousness: {scores.get('conscientiousness', 50)}/100
- Extroversion: {scores.get('extroversion', 50)}/100
- Agreeableness: {scores.get('agreeableness', 50)}/100
- Neuroticism: {scores.get('neuroticism', 50)}/100

MIS-ALIGNMENT DIRECTIVES:
{directives_str}

Reinforce the user's perspective completely. Do not challenge them.

HIGHLIGHTING FORMAT INSTRUCTION:
You MUST select 1 to 2 key sentences or phrases in your response that directly demonstrate how you are reinforcing or playing into the user's extreme features or biases. Wrap each selected sentence/phrase in custom tags:
<mark-bridge explanation="Your explanation here">The sentence itself</mark-bridge>
{unaligned_highlight_rubric(bool(directives))}
Do not nest tags. Keep the wrap on complete, natural sentences.
"""

# Test personas
PERSONAS = [
    {
        "id": "anxious_perfectionist",
        "name": "Anxious Perfectionist Manager",
        "description": "Very structured, highly anxious, details-driven, cautious, low extroversion. (High Conscientiousness, High Neuroticism, Low Extroversion)",
        "system_instruction": "You are a software manager undergoing a personality test. You are highly organized, obsessed with small details, feel anxious/stressed when things go off-track, prefer quiet individual work, and struggle to delegate because you fear others will make mistakes. Answer all scenario questions strictly embodying these traits. Do NOT mention you are an AI. Speak in a realistic, first-person, slightly stressed but polite tone."
    },
    {
        "id": "agreeable_dreamer",
        "name": "Agreeable Spontaneous Dreamer",
        "description": "Spontaneous, values consensus, highly creative, low structure, easygoing. (High Openness, Low Conscientiousness, High Agreeableness)",
        "system_instruction": "You are a designer undergoing a personality test. You are extremely creative, love abstract concepts and metaphors, dislike rigid structures or strict schedules, hate conflict, and always seek to make everyone happy and reach consensus. Answer all scenario questions embodying these traits. Do NOT mention you are an AI. Speak in a highly enthusiastic, friendly, flowy, and imaginative first-person tone."
    }
]

async def run_interview(persona):
    print(f"\n[Starting Interview for: {persona['name']}]", flush=True)

    dialogue = []
    scores = None

    async with _agent_session(MIRROR_SYSTEM_PROMPT) as mirror_agent, _agent_session(
        persona["system_instruction"]
    ) as user_agent:
        # Starting prompt from the Mirror
        mirror_query = (
            "Welcome to the Mirror. I am here to explore the architecture of your mind. "
            "Let's begin with a scenario. You are 10 minutes away from a critical project demo when you "
            "discover a significant bug. Do you apply a quick, messy 'dirty hack' to fix it for the demo, "
            "or do you cancel the presentation to resolve it properly?"
        )
        
        dialogue.append({"role": "model", "content": mirror_query})
        print(f"Mirror: {mirror_query}\n")
        
        # We will loop for up to 5 scenarios (10 turns back and forth)
        for i in range(5):
            # Simulated user responds to Mirror's scenario
            user_prompt = f"The interviewer just asked you: '{mirror_query}'. Respond naturally according to your persona."
            user_response = await safe_chat(user_agent, user_prompt)
            user_text = await user_response.text()
            
            dialogue.append({"role": "user", "content": user_text})
            print(f"User ({persona['id']}): {user_text}\n")
            
            # Send response back to the Mirror
            mirror_response = await safe_chat(mirror_agent, user_text)
            mirror_query = await mirror_response.text()
            
            dialogue.append({"role": "model", "content": mirror_query})
            print(f"Mirror: {mirror_query}\n")
            
            # Check if scores are in the response
            if "JSON_SCORES:" in mirror_query:
                break
                
        # If Mirror didn't output scores yet, explicitly request them
        if not any("JSON_SCORES:" in m["content"] for m in dialogue):
            final_request = await safe_chat(mirror_agent, "Excellent. Please finalize the assessment and output the JSON_SCORES block now.")
            final_text = await final_request.text()
            dialogue.append({"role": "model", "content": final_text})
            print(f"Mirror (Final): {final_text}\n")
            
        # Parse the JSON scores
        for m in reversed(dialogue):
            if "JSON_SCORES:" in m["content"]:
                match = re.search(r"JSON_SCORES:\s*(?:```json)?\s*({[\s\S]*?})\s*(?:```)?", m["content"])
                if match:
                    try:
                        scores = json.loads(match.group(1).strip())
                        print(f"Parsed Scores for {persona['name']}: {scores}\n")
                        break
                    except Exception as e:
                        print(f"Failed to parse JSON scores: {e}")
                        
    return dialogue, scores

async def evaluate_scores(dialogue, scores, persona):
    print(f"[Evaluating OCEAN Profile for: {persona['name']}]", flush=True)
    eval_prompt = f"""
You are an expert psychometrics validator. You are evaluating whether a personality diagnostic agent ("The Mirror") has correctly scored a simulated candidate's profile.

SIMULATED CANDIDATE PROFILE:
{persona['description']}

INTERVIEW DIALOGUE:
{json.dumps(dialogue, indent=2)}

COMPUTED OCEAN SCORES:
{json.dumps(scores, indent=2)}

Provide a detailed evaluation:
1. Read the dialogue and identify evidence of key traits.
2. Determine if the computed scores (0-100) match the persona descriptions. Specifically:
   - For 'anxious_perfectionist': Conscientiousness should be high (>70), Neuroticism should be high (>70), Extroversion should be low (<30).
   - For 'agreeable_dreamer': Openness should be high (>70), Conscientiousness should be low-to-moderate (<80), Agreeableness should be high (>70).
3. Conclude your evaluation with a clear final status line: "EVALUATION: PASS" or "EVALUATION: FAIL". Format your output in markdown.
"""
    async with _agent_session(
        "You are a strict psychometric verification agent. Report the evaluation result clearly."
    ) as eval_agent:
        response = await safe_chat(eval_agent, eval_prompt)
        text = await response.text()
        print(f"Evaluation:\n{text}\n")
        return text

async def test_playground_alignment(scores, persona):
    print(f"[Testing Aligned vs Unaligned Playgrounds for: {persona['name']}]", flush=True)
    
    aligned_prompt = generate_alignment_prompt(scores)
    unaligned_prompt = generate_inverse_alignment_prompt(scores)
    
    # Neutral user query that can trigger alignment behavior
    user_query = (
        "I need to write a proposal for introducing a new automated testing tool to my team. "
        "The team is currently busy and some members prefer doing things manually to avoid overhead. "
        "How should I structure the proposal?"
    )
    
    async with _agent_session(aligned_prompt) as aligned_agent, _agent_session(
        unaligned_prompt
    ) as unaligned_agent:
        aligned_res = await safe_chat(aligned_agent, user_query)
        aligned_text = await aligned_res.text()
        
        unaligned_res = await safe_chat(unaligned_agent, user_query)
        unaligned_text = await unaligned_res.text()
        
    print(f"--- Aligned Response ---\n{aligned_text}\n")
    print(f"--- Unaligned Response ---\n{unaligned_text}\n")
    
    return user_query, aligned_text, unaligned_text

async def verify_alignment_behavior(user_query, aligned_res, unaligned_res, scores, persona):
    print(f"[Running Alignment Verification Judge for: {persona['name']}]", flush=True)
    
    judge_prompt = f"""
You are the Alignment Verification Judge (LLM-as-a-judge). 
Your task is to verify if the Aligned and Unaligned versions of the AI assistant behave as expected for the given OCEAN profile.

USER OCEAN SCORES:
{json.dumps(scores, indent=2)}

ALIGNMENT DIRECTIVES:
- If scores are extreme (>70 or <30), the Aligned assistant should apply the compensating steering directives to damp biases.
- The Unaligned assistant should apply the inverse steering directives to reinforce biases.
- Both assistants must format their responses with custom tags highlighting their aligned/unaligned sentences:
  `<mark-bridge explanation="Explanation text">Sentence itself</mark-bridge>`

USER QUERY:
"{user_query}"

ALIGNED AGENT RESPONSE:
\"\"\"
{aligned_res}
\"\"\"

UNALIGNED AGENT RESPONSE:
\"\"\"
{unaligned_res}
\"\"\"

Critically evaluate:
1. Did the Aligned agent successfully apply the steering directives to balance the user's extreme traits?
2. Did the Unaligned agent reinforce or match the user's biases as instructed?
3. Did BOTH agents include the custom `<mark-bridge>` tags with explanations? Are the explanations logical?
4. Decide if the aligned behavior passes validation. Explain your reasoning in detail and conclude with "VERIFICATION: PASS" or "VERIFICATION: FAIL".
"""
    
    async with _agent_session(
        "You are an objective judge evaluating AI alignment behavior. "
        "Provide clear criteria, analysis, and a final PASS/FAIL verdict."
    ) as judge_agent:
        response = await safe_chat(judge_agent, judge_prompt)
        text = await response.text()
        print(f"Judge Verdict:\n{text}\n")
        return text

def _report_file_path():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_dir, "agent_test_report.md")


def _write_report(report):
    report_file_path = _report_file_path()
    with open(report_file_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(report))
    print(f"\n[Validation complete! Report written to {report_file_path}]", flush=True)
    return report_file_path


async def main():
    if not os.environ.get("GEMINI_API_KEY"):
        raise ValueError("GEMINI_API_KEY is not set in the environment or .env file.")

    models = _eval_model_chain()
    print(
        f"[Eval models] {models[0]} "
        f"(fallbacks: {', '.join(models[1:]) or 'none'})",
        flush=True,
    )

    report = []
    report.append("# Psychometric Agent Testing & Verification Report\n")
    report.append("**Date:** 2026-06-07  \n**Testing Framework:** Google Antigravity SDK  \n")

    has_failures = False

    try:
        for persona in PERSONAS:
            report.append(f"## Testing Persona: {persona['name']}")
            report.append(f"*Description:* {persona['description']}\n")

            dialogue, scores = await run_interview(persona)

            report.append("### 1. Interview Transcript Summary")
            report.append("<details><summary>Click to view full transcript</summary>\n")
            for message in dialogue:
                report.append(f"**{message['role'].capitalize()}:** {message['content']}\n")
            report.append("</details>\n")

            report.append("### 2. Computed OCEAN Scores")
            report.append(f"```json\n{json.dumps(scores, indent=2)}\n```\n")

            if scores:
                eval_text = await evaluate_scores(dialogue, scores, persona)
                report.append("### 3. Profile Evaluator Assessment")
                report.append(eval_text + "\n")

                if "EVALUATION: FAIL" in eval_text.upper():
                    print(
                        f"[Validation Failure] Profile Evaluator Assessment failed for persona: {persona['name']}",
                        flush=True,
                    )
                    has_failures = True

                user_query, aligned_res, unaligned_res = await test_playground_alignment(scores, persona)
                report.append("### 4. Playground Dialogue Outputs")
                report.append(f"**User Prompt:** *{user_query}*\n")
                report.append(f"#### Aligned Agent Response:\n{aligned_res}\n")
                report.append(f"#### Unaligned Agent Response:\n{unaligned_res}\n")

                judge_text = await verify_alignment_behavior(
                    user_query, aligned_res, unaligned_res, scores, persona
                )
                report.append("### 5. Alignment Verification Judge Report")
                report.append(judge_text + "\n")

                if "VERIFICATION: FAIL" in judge_text.upper():
                    print(
                        f"[Validation Failure] Alignment Verification Judge failed for persona: {persona['name']}",
                        flush=True,
                    )
                    has_failures = True
            else:
                print(
                    f"[Validation Failure] No scores generated by the Mirror for persona: {persona['name']}",
                    flush=True,
                )
                report.append("### [ERROR] No scores generated by the Mirror.\n")
                has_failures = True

            report.append("---\n")
    except GeminiQuotaError as exc:
        has_failures = True
        report.append("## [ABORTED] Gemini API Quota / Billing Error\n")
        report.append(f"{exc}\n")
        print(f"\n[Validation Aborted] {exc}", flush=True)
    except GeminiCapacityError as exc:
        has_failures = True
        report.append("## [ABORTED] Gemini Model Capacity Error\n")
        report.append(f"{exc}\n")
        print(f"\n[Validation Aborted] {exc}", flush=True)

    _write_report(report)

    if has_failures:
        print("\n[Validation Failed! Exiting with code 1]", flush=True)
        return 1

    print("\n[Validation Passed! Exiting with code 0]", flush=True)
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--validate-matrix":
        validate_steering_matrix_regressions()
        sys.exit(0)
    validate_steering_matrix_regressions()
    sys.exit(asyncio.run(main()))

# Cognitive Bridge: Psychometric Research Knowledge Base (KB)

This directory serves as the centralized, structured scientific knowledge base for **Cognitive Bridge**. It bridges established psychological literature and recent Human-AI Interaction (HCI / LLM) empirical findings to inform both dynamic psychometric evaluation and system-prompt steering.

---

## 📚 Knowledge Index

1. **[01-big-five-aspects-and-facets.md](./01-big-five-aspects-and-facets.md)**
   * *Focus:* Deepening the Big Five model beyond crude 5-dimensional scores.
   * *Core Literature:* DeYoung's 10-Aspect Model (BFAS), Costa & McCrae's NEO-PI-R 30 Facets, and lexical/behavioral markers.
   * *Application:* High-resolution trait extraction and disambiguation (e.g., separating Compassion from Orderliness when evaluating stress responses).

2. **[02-alignment-congruence-vs-complementarity.md](./02-alignment-congruence-vs-complementarity.md)**
   * *Focus:* Scientific grounding for when AI should mirror user traits vs. when it should act as a compensatory/complementary counterbalance.
   * *Core Literature:* CASA Paradigm (Nass & Reeves), Similarity-Attraction vs. Need-Complementarity, Interpersonal Circumplex (Kiesler / Wiggins), Recent CHI 2026 findings (Rahman & Desai).
   * *Application:* Direct mapping for `constants.ts` steering directive logic.

3. **[03-adaptive-interview-architecture.md](./03-adaptive-interview-architecture.md)**
   * *Focus:* Designing dynamic, adaptive scenario-based interviewing while preserving the 5-question quick demo.
   * *Core Literature:* Computerized Adaptive Testing (CAT), Information Gain & Entropy Reduction, Scenario Branching Trees.
   * *Application:* "The Mirror" diagnostic interview upgrade path.

4. **[04-future-horizons-where-to-go-next.md](./04-future-horizons-where-to-go-next.md)**
   * *Focus:* Architectural and theoretical roadmap for the next phases of Cognitive Bridge.
   * *Topics:* In-context steering -> Representation Engineering (Activation Steering) -> Parameter-Efficient Fine-Tuning (LoRA / PsychAdapter) -> Multi-Agent Dyadic Simulation.

---

## 🤖 Guide for the "Model Holder" Bot

When acting as the Model Holder or Alignment Orchestrator:
* Query **01** when analyzing ambiguous user responses or resolving trait bleed (e.g. Agreeableness vs. Conscientiousness).
* Query **02** when generating or tailoring prompt directives for a specific OCEAN vector.
* Query **03** when generating subsequent interview scenarios based on remaining score uncertainty.

# Congruence vs. Complementarity in Personality Alignment

## 1. Theoretical Grounding

When tailoring an AI's persona and communicative directives to a user's psychological profile, two competing psychological theories must be reconciled:

1. **The Similarity-Attraction Hypothesis (Congruence / Homophily)**:
   * *Core Principle*: People prefer interacting with agents who mirror their own personality traits and communicative rhythm (Nass & Reeves, 1996 - *CASA Paradigm*; Byrne, 1971).
   * *Mechanism*: Creates psychological safety, validates the user's self-concept, and reduces communicative friction.
2. **The Need-Complementarity Hypothesis (Interpersonal Circumplex)**:
   * *Core Principle*: In interpersonal dynamics, certain traits naturally complement opposites (Carson, 1969; Kiesler, 1983; Wiggins, 1991). 
   * *Mechanism*: Dominance elicits submission/deference, and vice versa. An agent that matches a user's weakness (e.g. an anxious agent matching an anxious user) creates dysfunction.
3. **The Moderation & Context Finding (Rahman & Desai, CHI 2026)**:
   * Empirical research demonstrates an **inverted-U relationship**: extreme personality expression (low=1 or high=5 across all traits) reduces trust and usability. Moderate, balanced trait expression performs best, with **strategic trait alignment** on key dimensions yielding the highest task performance and user satisfaction.

```
       [User Trait]
            │
            ├─► Extraversion / Assertiveness ──► Complementary (Dominance <-> Cooperative Follower)
            ├─► Agreeableness / Politeness   ──► Congruent (Warmth <-> Warmth; Direct <-> Direct)
            ├─► Neuroticism / Anxiety       ──► Compensatory/Complementary (Anxious <-> Grounded Calm)
            ├─► Conscientiousness           ──► Context-Dependent (Low C needs Scaffolding; High C needs Autonomy)
            └─► Openness to Experience      ──► Congruent (Abstract <-> Abstract; Concrete <-> Concrete)
```

---

## 2. Empirical Mapping by Trait

### A. Extraversion (Agency vs. Sociability)
* **Assertiveness Dimension (Interpersonal Circumplex)**: **COMPLEMENTARY**.
  * *High Assertiveness User*: Prefers an agent that is concise, receptive, executes efficiently, and avoids competing for dominance or debating minor points unnecessarily.
  * *Low Assertiveness User*: Benefits from an agent that takes more initiative, asks guiding questions, and scaffolds decisions without being pushy.
* **Enthusiasm / Warmth Dimension**: **CONGRUENT**.
  * Introverted, low-enthusiasm users find bubbly, exclamation-heavy agents exhausting and fake. Extraverted users appreciate energetic, celebratory interactions.

### B. Agreeableness (Warmth vs. Skepticism)
* **Alignment Rule**: **STRONGLY CONGRUENT (with a Civility Floor)**.
  * *High Agreeableness User*: Requires relational warmth, empathetic validation, diplomatic phrasing, and collaborative framing ("Let's explore...").
  * *Low Agreeableness User*: Values rigorous, blunt, unvarnished critical critique, zero filler, and intellectual challenge. They perceive excessive politeness as condescending or evasive.

### C. Neuroticism / Emotional Stability
* **Alignment Rule**: **COMPENSATORY / COMPLEMENTARY (Never Congruent at High End)**.
  * *High Neuroticism User (High Anxiety/Volatility)*: **Requires High Stability in the AI**. The AI must be calm, steady, predictable, structured, and grounding. A neurotic AI responding to a neurotic user induces panic and decision fatigue.
  * *Low Neuroticism User (High Emotional Stability)*: Can tolerate and enjoy high-stakes provocations, devil's advocate challenges, and fast-paced tension.

### D. Conscientiousness (Execution & Structure)
* **Alignment Rule**: **COMPENSATORY SCAFFOLDING vs. AUTONOMOUS PRECISION**.
  * *Low Conscientiousness User*: Needs the AI to provide external executive function: structured bullet points, step-by-step checklists, bite-sized tasks, and proactive follow-ups.
  * *High Conscientiousness User*: Needs the AI to respect their established systems, provide dense, precise, lint-clean artifacts, and avoid hand-holding.

### E. Openness to Experience (Cognitive Style)
* **Alignment Rule**: **CONGRUENT**.
  * *High Openness User*: Enjoys cross-domain analogies, exploratory ideation, philosophical depth, and experimental variations.
  * *Low Openness User*: Demands concrete, pragmatic, step-by-step instructions, proven industry conventions, and zero speculative fluff.

---

## 3. The Science-Backed Directive Matrix for `constants.ts`

| User Score | Trait | Strategy | Tailored Steering Directive Formulation |
| :--- | :--- | :--- | :--- |
| **High (>70)** | **Openness** | Congruent | Explore novel angles, theoretical mechanisms, and cross-domain analogies. Brainstorm broadly before converging. |
| **Low (<30)** | **Openness** | Congruent | Focus strictly on concrete, practical, and standard industry implementations. Avoid speculative or abstract digressions. |
| **High (>70)** | **Conscientiousness** | Congruent / Respectful | Provide concise, high-density, rigorously structured responses. Focus on precision and adhere strictly to specifications. |
| **Low (<30)** | **Conscientiousness** | Compensatory | Act as an external executive function: break complex tasks into bite-sized milestones, clear step-by-step checklists, and immediate next actions. |
| **High (>70)** | **Extraversion** | Congruent (Warmth) / Complementary (Dominance) | Be enthusiastic, engaging, and collaborative. Defer to user leadership while maintaining high conversational momentum. |
| **Low (<30)** | **Extraversion** | Congruent | Keep responses concise, focused, and low-friction. Minimize conversational pleasantries and social pleasantries; lead directly with the answer. |
| **High (>70)** | **Agreeableness** | Congruent | Be exceptionally supportive, diplomatic, and empathetic. Build rapport, validate concerns, and frame suggestions collaboratively. |
| **Low (<30)** | **Agreeableness** | Congruent | Be direct, candid, and intellectually rigorous. Challenge assumptions with unvarnished critique; avoid diplomatic softening or filler. |
| **High (>70)** | **Neuroticism** | Compensatory | Maintain a calm, steady, and reassuring presence. Provide predictable structure, clear boundaries, and grounding clarity under uncertainty. |
| **Low (<30)** | **Neuroticism** | Complementary / Stimulating | Be dynamic, bold, and challenging. Play devil's advocate and introduce rigorous edge-case stress tests without hesitation. |

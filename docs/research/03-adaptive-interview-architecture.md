# Dynamic & Adaptive Psychometric Interview Architecture

## 1. Goal & Requirements

1. **Retain the 5-Question Quick Demo**: A fixed, reproducible 5-step scenario sequence for quick demos, testing, and automated CI evals.
2. **Dynamic / Adaptive Mode ("Deep Mirror")**: An adaptive dialogue engine based on **Computerized Adaptive Testing (CAT)** and **Bayesian Entropy Reduction**.
3. **No Direct Trait Questioning**: The model never asks "How extroverted are you?" but presents complex dilemmas with psychological trade-offs.
4. **Behavior-Focused Evaluation**: Relies exclusively on what the user chooses and explains in their responses.

---

## 2. Adaptive Testing Mathematical Concept

Let the user's personality be represented by a latent state vector $\theta = [O, C, E, A, N] \in [0, 100]^5$ with initial prior distributions:
$$\theta_i \sim \mathcal{N}(\mu_0=50, \sigma_0^2=400) \quad \text{for } i \in \{O, C, E, A, N\}$$

* **Uncertainty Metric**: The total entropy / variance across the trait estimates:
  $$\mathcal{H} = \sum_{i} \sigma_i^2$$
* **Next Question Selection Goal**: Select a scenario $S_{next}$ that maximizes Expected Information Gain ($\text{IG}$) on the traits with the highest current variance $\sigma_i^2$.

```
[Initial Prior (All ~50, High Uncertainty)]
       │
   Scenario 1 (Universal Calibration Dilemma)
       │
   User Response 1
       │
   LLM Parser ──► Updates Posterior Means (μ) & Variances (σ²)
       │
   Is Target Variance Reached OR Question Cap Hit?
       ├── YES ──► Finalize & Output JSON_SCORES
       └── NO  ──► Select Scenario targeting the highest-variance trait/aspect
```

---

## 3. The 3-Tier Scenario Taxonomy

To construct adaptive scenarios on the fly, the interview agent draws from three psychological challenge archetypes:

### Tier 1: Core Trade-Off Scenarios (High Discriminative Power)
* *Purpose*: Quickly divide the parameter space in the first 1-2 turns.
* *Example 1 (Conscientiousness vs. Openness)*: "A production release is scheduled in 1 hour. You discover an undocumented experimental feature that could 10x performance, but it hasn't passed standard QA. Do you risk deploying it or stick strictly to the tested baseline?"
* *Example 2 (Agreeableness vs. Assertiveness/Extroversion)*: "In a team retro, a key project failure is blamed on ambiguous requirements. You know for a fact that an executive made the wrong call. Do you publicly speak up and correct the record, or protect team harmony and address it privately later?"

### Tier 2: Disambiguation & Aspect Probing Scenarios
* *Purpose*: Resolve trait bleed (e.g. distinguishing Agreeable compliance from Conscientious duty).
* *Example (Compassion vs. Industriousness)*: "A team member falls sick right before a launch. If management tells you the deadline is officially waived, do you keep grinding all weekend anyway to finish what you started, or completely shut down your laptop and check in on your teammate?"

### Tier 3: Extremity & Stress Stress-Tests
* *Purpose*: Calibrate extreme scores (<20 or >80) on Volatility/Neuroticism or Assertiveness.
* *Example (Neuroticism / Volatility)*: "You wake up to 50 missed calls: your main database cluster was accidentally dropped and backups are 6 hours old. How does your body/mind respond in the first 60 seconds, and what is your very first action?"

---

## 4. Operational Architecture for "The Mirror" Engine

### Dual-Mode Execution State Machine

```typescript
export type MirrorMode = 'quick_demo' | 'adaptive_deep';

export interface TraitBelief {
  mean: number;      // 0-100
  confidence: number;// 0.0 - 1.0 (inverse variance)
}

export interface CognitiveState {
  openness: TraitBelief;
  conscientiousness: TraitBelief;
  extroversion: TraitBelief;
  agreeableness: TraitBelief;
  neuroticism: TraitBelief;
  remainingAmbiguities: string[]; // e.g., ["Agreeableness vs Conscientiousness in team sacrifice"]
  questionCount: number;
}
```

### System Prompt for Adaptive Scenario Generation

```markdown
You are "The Deep Mirror", an adaptive psychometric evaluator using scenario-based dilemmas.

Your objective:
1. Review the running conversation and the current Trait Estimates.
2. Identify the trait or sub-aspect with the LOWEST confidence (highest ambiguity).
3. Generate a vivid, context-rich scenario that forces a concrete behavioral trade-off specifically targeting that ambiguous trait.
4. Never mention the traits by name or ask scale questions.
5. Require the user to explain both their decision AND their rationale.
```

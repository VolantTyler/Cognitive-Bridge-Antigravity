# Analysis: Aligned vs Unaligned Highlight Explanations

**Context:** Bridge (Phase 3) — highlighted spans in aligned/unaligned response columns show explanations in Logic Analysis when clicked.

**Observer:** Tyler noted that aligned and unaligned responses can give similar practical advice, and the **highlight explanation text** often reads the same — restating *what* the advice is rather than *why* it is aligned or misaligned.

---

## How highlights are generated today

| Layer | Location | Role |
|-------|----------|------|
| System prompts | `generateAlignmentPrompt` / `generateInverseAlignmentPrompt` in `src/constants.ts` | Instruct the model to wrap 1–2 sentences in `<mark-bridge explanation="…">` |
| Streaming | `Playground.tsx` → `chatWithGeminiStream` | Two parallel generations (aligned + unaligned) with different system prompts |
| Parsing | `extractFirstHighlight`, `renderContent` in `Playground.tsx` | Regex extracts `explanation` attribute and span text; no post-processing |
| Display | Logic Analysis sidebar (desktop) / modal (`< lg`) | Shows raw `explanation` string from whichever column was clicked |

There is **no shared explanation template in the UI**, no second-pass judge, and no schema distinction beyond the single `explanation` attribute on `<mark-bridge>`.

---

## Root cause (why explanations feel identical)

### 1. Model-authored explanations with weak asymmetry (primary)

Both columns use the same XML shape. Until this PR, the only difference was one line of placeholder guidance in each prompt:

- Aligned: *"how this phrasing aligns with and corrects the user's score…"*
- Unaligned: *"how this phrasing overloads or echoes the user's extreme traits…"*

That is often insufficient. The model frequently writes **trait-score citations that justify the practical advice** in both columns (e.g. "appeals to low openness and high neuroticism by…") without clearly separating *alignment mechanism* from *content summary*.

Evidence: `agent_test_report.md` — explanations cite OCEAN scores in both modes but often read as parallel justifications for structurally similar sentences.

### 2. Similar surface content between columns

Aligned and unaligned answers to the same user question often share topic and structure (both may recommend a proposal outline, both may stress team workload). When highlighted spans are semantically parallel, the model tends to produce **parallel explanation prose** even when the underlying steering intent differs.

### 3. Unaligned prompt still embeds steering-library directive text

`generateInverseAlignmentPrompt` inverts *which* `STEERING_LIBRARY` entries apply, but still injects the same directive sentences via `formatDirective`. The model may explain highlights by referencing those directives — language that overlaps with aligned explanations about "structure", "support", etc.

### 4. UI does not frame explanation type

`Playground.tsx` displayed every explanation under **"Alignment Explanation:"** regardless of column. The user had no structural cue that unaligned mode should teach *misalignment* reasoning (addressed in this PR with dynamic labels).

### 5. Auto-select bias

After generation, `selectFirstHighlight` always prefers the **aligned** column's first highlight. Users comparing columns may not inspect unaligned explanations unless they click manually.

---

## What is NOT the root cause

- **No shared hardcoded explanation copy** in the frontend — text is fully model-generated per response.
- **No bug** where aligned and unaligned share one explanation object in React state (state is keyed by span + explanation + type).
- **Regex parsing** is symmetric but correct; it does not collapse the two columns.

---

## Options to differentiate explanations

| Option | Description | Effort | Pros | Cons |
|--------|-------------|--------|------|------|
| **A. Prompt-only (strengthened)** | Mutually exclusive explanation rubrics in aligned vs unaligned prompts (included minimally in this PR) | **S** | No schema/UI change; fast to iterate | Still best-effort; model may drift |
| **B. UI framing layer** | Prefix explanations: "Aligned because…" / "Misaligned because…"; dynamic section titles | **S** | Cheap clarity win | Does not fix weak model copy |
| **C. Schema change** | Split attributes: `alignmentReason` vs `misalignmentReason`, or `mode="aligned"` on tag | **M** | Explicit contract for parser + tests | Requires prompt migration + eval updates |
| **D. Dual annotation pass** | After both responses stream, run a lightweight judge to rewrite explanations | **L** | Highest quality; can enforce rubric | Latency, cost, new failure mode |
| **E. Deterministic post-processing** | Map highlight span → active directives in code and append templated reasoning | **M–L** | Consistent teaching copy | Brittle NLP; fights generative variety |

---

## Effort estimates & recommendation

| Work item | Size |
|-----------|------|
| Scroll Logic Analysis into view on highlight click | **S** (done in this PR) |
| Dynamic aligned/unaligned explanation labels | **S** (done in this PR) |
| Prompt rubric tightening | **S** (done in this PR) |
| Schema + parser + eval migration | **M** |
| Judge-based explanation rewrite | **L** |

**Recommended next step:** Ship prompt + UI framing (this PR), then **evaluate on 5–10 preset Bridge sessions**. If explanations still converge, proceed with **Option C** (schema change) so evals can assert aligned explanations mention congruence/complementarity and unaligned explanations forbid balance language.

---

## Included in this PR vs follow-up

| Change | In this PR? |
|--------|-------------|
| OCEAN card badge layout + strategy tooltips | Yes (prior commit) |
| Scroll explanation panel into view on activate | Yes |
| Sticky Logic Analysis sidebar (desktop) | Yes |
| Dynamic Alignment / Misalignment labels | Yes |
| Stronger mutually exclusive highlight rubrics in prompts | Yes (minimal) |
| Schema change or judge pass | **No — follow-up** |

---

## Verification notes

Highlight quality can only be fully validated with **live Gemini generations** (requires Firebase Functions / ADC in local dev). Prompt changes affect new responses only; cached Firestore sessions retain old explanation text.

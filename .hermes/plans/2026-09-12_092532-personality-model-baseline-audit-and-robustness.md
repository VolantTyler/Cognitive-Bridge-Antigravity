# Plan: Baseline Audit → Robustness Roadmap for the Cognitive Bridge Personality Model

## Goal
Establish a precise, verified inventory of how the personality model currently works end-to-end (Mirror interview → Tailor mapping → Bridge chat), document its robustness gaps as executable tests, and lay the groundwork for a facet-level (10-Aspect) steering model.

## Current context / assumptions

The app is a Vite + React 19 + TS single-page app at `/Users/tylerstahl/Developer/Github/Cognitive-Bridge-Antigravity/`. The personality pipeline is:

1. **The Mirror** (`src/components/Mirror.tsx`) — a chat interview driven by `MIRROR_SYSTEM_PROMPT` (`src/constants.ts:66`). The LLM asks exactly 5 scenario questions, then emits a `JSON_SCORES:` block. `Mirror.tsx` regex-parses it (`Mirror.tsx:76` and `:132`) and calls `onComplete(scores)`.
2. **The Tailor** (`src/components/Tailor.tsx`) — displays `OceanCards` and shows which `STEERING_LIBRARY` directives are active.
3. **The Bridge** (`src/components/Playground.tsx`) — builds `alignedSystemPrompt = generateAlignmentPrompt(scores)` (`Playground.tsx:57`) and an inverse "unaligned" prompt for side-by-side comparison.

The model is **flat OCEAN, 0–100 integers, binary thresholds**. Key baseline facts (all verified by reading source):

- `OceanScores` (`src/types.ts:6`) — 5 scalar numbers. No facets, no confidence, no uncertainty.
- `STEERING_LIBRARY` (`src/constants.ts:8`) — exactly 10 directives (1 high + 1 low per trait), each a single static sentence.
- `generateAlignmentPrompt` (`src/constants.ts:107`) — fires a directive only when `value > 70` (high) or `value < 30` (low). Scores 30–70 produce **zero** directives; the prompt falls back to "Maintain a balanced, helpful, and professional tone."
- **Inverted/extremity quirks in the library** (`src/constants.ts:20-52`): the high-Conscientiousness directive says "Be flexible and spontaneous" (arguably the *compensation* framing is fine, but "high extroversion → be concise/direct" is a mismatch — the high-E text suppresses sociability rather than matching it); these need review, not silent trust.
- `generateAlignmentPrompt` vs `generatePortableMetadata` (`src/constants.ts:141`) vs `Tailor.tsx:29` — the threshold logic (`>70` / `<30`) is **duplicated in 3 places**. Any fix must consolidate.
- Score parsing is regex + `JSON.parse` with no clamping (`Mirror.tsx:132-143`): an LLM emitting `{"openness": 250, ...}` or a missing key produces out-of-range/`undefined` scores that flow silently into the Bridge prompt and into Firestore (`src/App.tsx:98`).
- The interview is fixed at 5 scenarios regardless of how informative responses are (no adaptive branching — see `docs/research/03-adaptive-interview-architecture.md` for the target architecture).
- Tests exist: `src/components/__tests__/` (FeedbackModal, FeedbackRules integration, ReleaseNotesModal) and `src/services/__tests__/gemini.test.ts`. **There is no test covering `generateAlignmentPrompt`, `generatePortableMetadata`, or score parsing.** Test runner: `npx vitest run`. Lint/typecheck: `npm run lint` (`tsc --noEmit`).
- Known env quirk (from `AGENTS.md`): the FeedbackRules integration test needs network/Firebase and its teardown prints a firebase-auth error but still exits 0.

Phase 1 below is **pure audit and characterization tests** (no behavior change), matching the "let's see where we are baseline now" intent. Phase 2 tasks are the first real robustness improvements; they are ordered so each stands alone and can be deferred without breaking later ones.

## Architecture / proposed approach

Phase 1 locks down the current behavior with characterization tests so every later change is measured, not guessed: extract the score-parsing and threshold logic into a pure module (`src/lib/personality.ts`) and re-point existing consumers at it without changing behavior. Phase 2 then hardens the weakest points — input validation/clamping, deduplicated threshold logic, and per-trait confidence from the interview — creating the data shape (`FacetScores`) that a future 10-Aspect model needs, per `docs/research/01-big-five-aspects-and-facets.md`.

---

## Phase 1 — Baseline inventory (this session, read-only + tests)

### Task 1.1: Snapshot the current steering output (characterization test)
**Files:** new `src/lib/__tests__/personality.baseline.test.ts`
1. Create `src/lib/` if absent (it does not exist today).
2. Write a characterization test that calls the three existing functions and asserts **current** behavior, including the quirks we plan to fix later. This is a snapshot, not a spec of desired behavior.

```ts
// src/lib/__tests__/personality.baseline.test.ts
import { describe, it, expect } from 'vitest';
import {
  generateAlignmentPrompt,
  generateInverseAlignmentPrompt,
  generatePortableMetadata,
  STEERING_LIBRARY,
} from '../../constants';
import { INITIAL_OCEAN } from '../../constants';

describe('BASELINE characterization (documents current behavior, warts included)', () => {
  it('activates NO directives for mid-range scores (30-70)', () => {
    const mid = { openness: 50, conscientiousness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50 };
    const prompt = generateAlignmentPrompt(mid);
    expect(prompt).toContain('Maintain a balanced, helpful, and professional tone.');
    expect(prompt).not.toContain('- Use'); // no directive bullets
  });

  it('fires exactly one directive per extreme trait (threshold 70/30)', () => {
    const extreme = { openness: 85, conscientiousness: 15, extroversion: 50, agreeableness: 50, neuroticism: 50 };
    const prompt = generateAlignmentPrompt(extreme);
    const directiveLines = prompt.split('\n').filter(l => l.startsWith('- ') && !l.startsWith('- Maintain'));
    expect(directiveLines).toHaveLength(2);
  });

  it('boundary values: 70 and 30 fire NOTHING (strict inequality)', () => {
    const edge = { openness: 70, conscientiousness: 30, extroversion: 70, agreeableness: 30, neuroticism: 50 };
    const prompt = generateAlignmentPrompt(edge);
    expect(prompt).toContain('Maintain a balanced, helpful, and professional tone.');
  });

  it('inverse prompt inverts thresholds (high score gets LOW directive)', () => {
    const extreme = { openness: 85, conscientiousness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50 };
    const aligned = generateAlignmentPrompt(extreme);
    const inverse = generateInverseAlignmentPrompt(extreme);
    // openness 85: aligned fires the 'high' text; inverse fires the 'low' text
    expect(aligned).toContain('Use creative metaphors');
    expect(inverse).toContain('Stick to concrete facts');
  });

  it('STEERING_LIBRARY has exactly 2 directives per trait', () => {
    const traits = ['openness','conscientiousness','extroversion','agreeableness','neuroticism'] as const;
    for (const t of traits) {
      expect(STEERING_LIBRARY.filter(d => d.trait === t)).toHaveLength(2);
    }
  });

  it('portable metadata matches alignment directives for the same scores', () => {
    const extreme = { openness: 85, conscientiousness: 15, extroversion: 50, agreeableness: 50, neuroticism: 50 };
    expect(generatePortableMetadata(extreme)).toContain('Use creative metaphors');
    expect(generatePortableMetadata(extreme)).toContain('Use highly structured formatting');
  });

  it('INITIAL_OCEAN is all-50s', () => {
    expect(INITIAL_OCEAN).toEqual({ openness: 50, conscientiousness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50 });
  });
});
```
**Verify:**
```bash
npx vitest run src/lib/__tests__/personality.baseline.test.ts
```
Expected: all tests pass, proving the documented baseline is real. Then commit:
```bash
git add src/lib/__tests__/personality.baseline.test.ts
git commit -m "test: characterization snapshot of OCEAN steering baseline"
```

### Task 1.2: Write the audit findings doc
**Files:** new `docs/audit/personality-model-baseline-2026-09-12.md`
1. Create the doc with a table: component → file:line → current behavior → robustness gap → severity. Content must include the facts listed under "Current context" above (flat scores, 3× duplicated threshold logic, no clamping, fixed 5-question interview, 10 static directives, mid-band dead zone).
2. Cross-reference each gap to the research doc that proposes the fix: `docs/research/01-big-five-aspects-and-facets.md` (facets), `03-adaptive-interview-architecture.md` (adaptive questioning), `02-alignment-congruence-vs-complementarity.md` (mirror vs. counterbalance policy).
**Verify:** `git diff --stat` shows only the new file; commit:
```bash
git add docs/audit/personality-model-baseline-2026-09-12.md
git commit -m "docs: personality model baseline audit"
```

---

## Phase 2 — First robustness improvements (each independent)

### Task 2.1: Harden score parsing (clamp + validate) — TDD
**Files:** new `src/lib/personality.ts`, new `src/lib/__tests__/personality.test.ts`, edit `src/components/Mirror.tsx`
1. **RED** — write `src/lib/__tests__/personality.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseOceanScores } from '../personality';

describe('parseOceanScores', () => {
  it('parses a valid JSON_SCORES block', () => {
    const raw = 'Analysis complete.\nJSON_SCORES:\n{"openness": 85, "conscientiousness": 40, "extroversion": 60, "agreeableness": 90, "neuroticism": 30}';
    expect(parseOceanScores(raw)).toEqual({ openness: 85, conscientiousness: 40, extroversion: 60, agreeableness: 90, neuroticism: 30 });
  });
  it('parses with ```json fences', () => {
    const raw = 'JSON_SCORES:\n```json\n{"openness":85,"conscientiousness":40,"extroversion":60,"agreeableness":90,"neuroticism":30}\n```';
    expect(parseOceanScores(raw)?.openness).toBe(85);
  });
  it('clamps out-of-range values to 0-100', () => {
    const raw = 'JSON_SCORES: {"openness": 250, "conscientiousness": -10, "extroversion": 60, "agreeableness": 90, "neuroticism": 30}';
    expect(parseOceanScores(raw)).toEqual({ openness: 100, conscientiousness: 0, extroversion: 60, agreeableness: 90, neuroticism: 30 });
  });
  it('rounds floats to integers', () => {
    const raw = 'JSON_SCORES: {"openness": 85.4, "conscientiousness": 40.6, "extroversion": 60, "agreeableness": 90, "neuroticism": 30}';
    expect(parseOceanScores(raw)).toEqual({ openness: 85, conscientiousness: 41, extroversion: 60, agreeableness: 90, neuroticism: 30 });
  });
  it('returns null on missing keys', () => {
    const raw = 'JSON_SCORES: {"openness": 85}';
    expect(parseOceanScores(raw)).toBeNull();
  });
  it('returns null when no JSON_SCORES block present', () => {
    expect(parseOceanScores('no scores here')).toBeNull();
  });
});
```
2. Run `npx vitest run src/lib/__tests__/personality.test.ts` — expected: **fails** with "Cannot find module '../personality'".
3. **GREEN** — implement `src/lib/personality.ts`:
```ts
import { OceanScores } from '../types';

const TRAITS: (keyof OceanScores)[] = ['openness','conscientiousness','extroversion','agreeableness','neuroticism'];

export function parseOceanScores(content: string): OceanScores | null {
  const match = content.match(/JSON_SCORES:\s*(?:```json)?\s*({[\s\S]*?})\s*(?:```)?/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1].trim()) as Record<string, unknown>;
    const out: Partial<OceanScores> = {};
    for (const t of TRAITS) {
      const v = raw[t];
      if (typeof v !== 'number' || Number.isNaN(v)) return null;
      out[t] = Math.round(Math.min(100, Math.max(0, v)));
    }
    return out as OceanScores;
  } catch {
    return null;
  }
}
```
4. Run `npx vitest run src/lib/__tests__/personality.test.ts` — expected: all pass.
5. **Refactor consumers** — in `src/components/Mirror.tsx`, replace both inline regex blocks:
   - Delete the body of the `useEffect` scan (lines ~73-87) and the stream-parsing block (~130-143), replacing each with `const scores = parseOceanScores(lastModelMessage.content);` / `const scores = parseOceanScores(modelResponse);` followed by the existing `setCompletedScores(scores)` guarded on non-null.
6. Run `npx vitest run` (full suite) and `npm run lint` — expected: exit 0; the FeedbackRules teardown firebase-auth error may print; ignore it (per AGENTS.md).
7. Commit:
```bash
git add src/lib/personality.ts src/lib/__tests__/personality.test.ts src/components/Mirror.tsx
git commit -m "feat: clamp + validate OCEAN scores via shared parseOceanScores"
```

### Task 2.2: Deduplicate the threshold logic — TDD
**Files:** edit `src/lib/personality.ts`, new test in `src/lib/__tests__/personality.test.ts`, edit `src/constants.ts`, edit `src/components/Tailor.tsx`
1. **RED** — append to `src/lib/__tests__/personality.test.ts`:
```ts
import { getActiveDirectives, STEERING_LIBRARY } from '../personality';

describe('getActiveDirectives', () => {
  it('returns only directives for extreme traits', () => {
    const scores = { openness: 85, conscientiousness: 15, extroversion: 50, agreeableness: 50, neuroticism: 50 };
    const active = getActiveDirectives(scores, STEERING_LIBRARY);
    expect(active.map(d => d.trait).sort()).toEqual(['conscientiousness', 'openness']);
  });
  it('is consistent with the Tailor inline filter for the same scores', () => {
    // guards against the 3-way duplication regressing again
    const scores = { openness: 70, conscientiousness: 30, extroversion: 71, agreeableness: 29, neuroticism: 50 };
    const active = getActiveDirectives(scores, STEERING_LIBRARY);
    expect(active.map(d => d.trait).sort()).toEqual(['agreeableness', 'extroversion']);
  });
});
```
   (Re-export `STEERING_LIBRARY` from `personality.ts` or import from `../constants` — either, as long as the test imports one name.)
2. Run `npx vitest run src/lib/__tests__/personality.test.ts` — expected: **fails** (function doesn't exist).
3. **GREEN** — add to `src/lib/personality.ts`:
```ts
import { SteeringDirective } from '../types';

export function getActiveDirectives(scores: OceanScores, library: SteeringDirective[]): SteeringDirective[] {
  return library.filter(d =>
    (d.threshold === 'high' && scores[d.trait] > 70) ||
    (d.threshold === 'low' && scores[d.trait] < 30)
  );
}
```
   Then in `src/constants.ts`, replace the `.forEach` + `if/else` body in **both** `generateAlignmentPrompt` and `generatePortableMetadata` with `const directives = getActiveDirectives(scores, STEERING_LIBRARY).map(d => d.text);` (importing from `./lib/personality`; mind the import cycle — `constants.ts` already imports types only, so this is safe). In `src/components/Tailor.tsx:29`, replace the inline filter with `getActiveDirectives(scores, STEERING_LIBRARY)`.
   Note: `generateInverseAlignmentPrompt` inverts thresholds — leave it on its own logic for now or add an `invert` flag; do NOT change its behavior in this task.
4. Run `npx vitest run` and `npm run lint` — expected: all pass, exit 0 (baseline characterization tests from Task 1.1 must still pass — they pin the unchanged behavior).
5. Commit:
```bash
git add src/lib/personality.ts src/lib/__tests__/personality.test.ts src/constants.ts src/components/Tailor.tsx
git commit -m "refactor: single source of truth for steering thresholds (getActiveDirectives)"
```

### Task 2.3: Capture per-trait confidence from the Mirror interview
**Files:** edit `src/types.ts`, `src/constants.ts` (MIRROR_SYSTEM_PROMPT), `src/lib/personality.ts`, `src/components/Mirror.tsx`; new test in `src/lib/__tests__/personality.test.ts`
1. **RED** — add test:
```ts
import { parseOceanAssessment } from '../personality';

describe('parseOceanAssessment', () => {
  it('extracts scores + confidence', () => {
    const raw = 'JSON_SCORES: {"openness":85,"conscientiousness":40,"extroversion":60,"agreeableness":90,"neuroticism":30,"confidence":{"openness":0.9,"conscientiousness":0.4,"extroversion":0.5,"agreeableness":0.8,"neuroticism":0.3}}';
    const a = parseOceanAssessment(raw);
    expect(a!.scores.openness).toBe(85);
    expect(a!.confidence.openness).toBeCloseTo(0.9);
  });
  it('defaults confidence to 0.5 when absent (backward compatible)', () => {
    const a = parseOceanAssessment('JSON_SCORES: {"openness":85,"conscientiousness":40,"extroversion":60,"agreeableness":90,"neuroticism":30}');
    expect(a!.confidence).toEqual({ openness: 0.5, conscientiousness: 0.5, extroversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 });
  });
});
```
2. Run — expected: **fails**. **GREEN** — add to `src/lib/personality.ts`:
```ts
export interface OceanAssessment {
  scores: OceanScores;
  confidence: Record<keyof OceanScores, number>;
}

export function parseOceanAssessment(content: string): OceanAssessment | null {
  const scores = parseOceanScores(content);
  if (!scores) return null;
  const match = content.match(/JSON_SCORES:\s*(?:```json)?\s*({[\s\S]*?})\s*(?:```)?/);
  let confidence = { openness: 0.5, conscientiousness: 0.5, extroversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 };
  try {
    const raw = JSON.parse(match![1].trim());
    if (raw.confidence && typeof raw.confidence === 'object') {
      for (const t of TRAITS) {
        const c = raw.confidence[t];
        if (typeof c === 'number' && !Number.isNaN(c)) confidence[t] = Math.min(1, Math.max(0, c));
      }
    }
  } catch { /* keep defaults */ }
  return { scores, confidence };
}
```
   Update `MIRROR_SYSTEM_PROMPT` in `src/constants.ts` JSON example to include the `confidence` object (0-1 per trait) and instruct the model to set it low (<0.4) when scenario responses were ambiguous. Update `Mirror.tsx` to call `parseOceanAssessment` and thread confidence through `onComplete` — **do this without breaking the existing `OceanScores` Firestore shape**: store confidence at `users/{uid}.confidence` as a separate field, not inside `scores`.
3. Run `npx vitest run` and `npm run lint` — expected: pass, exit 0. Also verify the preset-profile path still works: presets pass scores with no confidence, so the default-0.5 test covers it.
4. Commit:
```bash
git add src/types.ts src/constants.ts src/lib/personality.ts src/lib/__tests__/personality.test.ts src/components/Mirror.tsx
git commit -m "feat: capture per-trait confidence from Mirror interview"
```

### Task 2.4 (optional, defer if time-boxed): Audit STEERING_LIBRARY copy against alignment research
**Files:** edit `src/constants.ts` only, plus `docs/research/02-alignment-congruence-vs-complementarity.md` as reference.
1. Review each of the 10 directives against the congruence-vs-complementarity policy. Known suspects: high-E ("be concise and direct" reads as *counter*-steering, not alignment — decide if that's intended compensation) and high-C ("be flexible and spontaneous"). This is a **product decision, not a code fix** — write the recommendation in the audit doc from Task 1.2 rather than silently editing copy. No test changes needed; the Task 1.1 characterization tests WILL fail if copy changes — update them in the same commit if the decision is to change copy.
2. Commit: `git commit -m "docs: steering copy recommendations from alignment research"` (or the copy change + test update together).

---

## Tests / validation

- Every code task follows RED → GREEN → REFACTOR with the exact commands shown; each ends in its own commit.
- Full-suite gates after every task: `npx vitest run` (exit 0; ignore the known firebase teardown noise) and `npm run lint` (`tsc --noEmit`, exit 0).
- End-to-end smoke (no backend needed, per AGENTS.md): `npm run dev`, open the app, use a "pre-calibrated test profile" preset on the Mirror, walk to the Tailor and Bridge; confirm directives shown in the Tailor match `getActiveDirectives` output for the preset scores.
- Manual parse check: paste `JSON_SCORES: {"openness": 250, ...}` behavior is covered by the clamp test in Task 2.1 — no live Gemini call required.

## Risks, tradeoffs, and open questions

**Risks / tradeoffs**
- *Characterization tests pin today's quirks on purpose.* When a later task changes behavior (e.g., threshold semantics), the matching baseline test must be updated in the same commit or the suite lies.
- *Import cycle risk* in Task 2.2: `constants.ts` importing from `lib/personality.ts`, which imports types from `types.ts` — verified types-only, but if it bites, move `getActiveDirectives` into `constants.ts` instead and have `Tailor.tsx` import it there.
- *Firestore shape drift* (Task 2.3): adding `confidence` as a new top-level field is backward-compatible for old docs (missing → undefined → default 0.5), but old clients reading new docs will ignore it — acceptable.
- *The live Firestore integration test is not hermetic* (AGENTS.md); it can make `npx vitest run` slow/flaky offline. If it blocks, run `npx vitest run --exclude src/components/__tests__/FeedbackRules.integration.test.ts` and note the deviation in the commit message.

**Open questions (for Tyler before Phase 2 execution)**
1. Threshold semantics: keep the strict binary 70/30 bands, or move to graded/continuous directive weighting? This changes the Phase-2 data model, so deciding early avoids rework.
2. Confidence (Task 2.3): should low-confidence traits *soften* the steering prompt (e.g., drop directives below a confidence floor), or is confidence display-only for now?
3. Adaptive interviewing (`docs/research/03-adaptive-interview-architecture.md`) is the biggest robustness lever but a much larger change — schedule it as its own plan after this baseline lands?
4. Steering copy intent (Task 2.4): is high-E → "concise and direct" intentional counter-steeling/compensation or a copy bug? Your call before touching copy.

## Out of scope (for this plan)
- Facet-level (10-Aspect/BFAS) scoring and FacetScores-driven prompts — Phase 3; this plan only prepares the data shape and deduped logic it needs.
- RepE / LoRA PsychAdapters / backend changes (Vertex/Firestore rules).
- Any change to the inverse ("unaligned") prompt semantics beyond leaving it untouched.

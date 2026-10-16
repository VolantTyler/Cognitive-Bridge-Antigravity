---
name: verified-sdk-codegen
description: >-
  Generates TypeScript, React, and SDK integration code (Gemini API, Firebase,
  Vite) and automatically runs static typechecking, import validation, and contract
  verification before presenting the output. Use whenever writing or modifying
  code that uses external libraries, APIs, or complex TypeScript types to eliminate
  hallucinated signatures, outdated SDK methods, and broken imports.
---

# Verified SDK Code Generation & Auto-Verification

This skill implements a **Generate-Verify-Remediate** dual-pipeline. It ensures that any generated code integrating SDKs (e.g., `@google/genai`, Firebase v10/v11, React 19, Vite) is strictly validated against actual installed type definitions and passes compilation checks before being presented to the user.

---

## When to Trigger

Activate this skill when:
- Writing or refactoring code that imports third-party libraries or SDKs (e.g., `@google/genai`, `firebase/*`, `@tanstack/*`, `lucide-react`, React 19 APIs).
- Adding or updating service layers, API clients, or database interaction routines.
- Creating TypeScript interfaces, schema validations (Zod), or typing complex async state.
- Fixing type mismatch errors or SDK version migration regressions.
- The user requests new features, components, or functions that depend on external package APIs.

### Trigger Examples:
- *"Add a streaming Gemini 2.5 Flash chat handler with system instructions."*
- *"Implement a Firestore transaction that updates user preferences and logs an audit record."*
- *"Create a React 19 hook for multi-turn personality diagnostics with error recovery."*
- *"Update our Gemini service to use the new @google/genai SDK instead of the legacy @google/generative-ai package."*

---

## 3-Phase Execution Workflow

```
 ┌────────────────────────────────────────────────────────┐
 │ 1. Ground & Generate                                   │
 │    - Inspect node_modules type definitions             │
 │    - Check package.json dependencies                   │
 │    - Draft implementation matching verified interfaces │
 └──────────────────────────┬─────────────────────────────┘
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │ 2. Automated Verification                              │
 │    - Typecheck: Run compiler (tsc --noEmit)            │
 │    - Contract: Verify symbol exports & parameter types │
 │    - Environment: Verify .env keys and Vite bindings   │
 └──────────────────────────┬─────────────────────────────┘
                            ▼
               ┌────────────┴────────────┐
               │ Passed all checks?      │
               ├────────────┬────────────┤
               │ Yes        │ No         │
               ▼            ▼            ▼
 ┌──────────────────────┐  ┌──────────────────────────────┐
 │ 3. Present Output    │  │ Auto-Remediation Loop        │
 │    - Show verified   │  │ - Extract compiler errors    │
 │      code & proof    │  │ - Patch hallucinated symbols │
 └──────────────────────┘  │ - Re-verify until green (≤3) │
                           └──────────────┬───────────────┘
                                          ▲
                                          │ Loop
```

---

## Phase 1: Ground & Generate

1. **Inspect Package Version & Types:**
   Before drafting code, confirm the installed version in `package.json` and inspect the actual exported declarations in `node_modules/<package>/` using `grep_search` or `view_file`.
   - *Example:* For `@google/genai`, inspect `node_modules/@google/genai/dist/index.d.ts` or type exports.
   - *Rule:* Never assume SDK function names from memory when version shifts are common (e.g., `ai.models.generateContent` vs `model.generateContent`).

2. **Draft the Implementation:**
   - Write clean, modular code conforming strictly to the verified types.
   - Include runtime guards for nullable fields and structured error handling (`try/catch` with typed error handling).

---

## Phase 2: Automated Verification Pipeline

Execute the following 4-point verification protocol before reporting completion:

### Check 1: Static Typecheck & Diagnostic Verification
Run the TypeScript compiler in non-emitting mode inside the workspace:
```bash
npm run lint # or npx tsc --noEmit
```
- **Pass Criteria:** Process exits with code 0 (zero type errors).
- **If Errors Occur:** Capture line numbers, error codes (e.g., `TS2339`, `TS2345`), and target symbols.

### Check 2: Import & Symbol Resolution Audit
Verify that:
- Every imported symbol exists in the target package's exported declarations.
- No deprecated subpath imports are used (e.g., use `firebase/firestore` modular syntax, not `firebase/compat`).
- No Node-only modules (e.g., `fs`, `crypto`, `child_process`) are imported into browser/Vite client bundles.

### Check 3: Environment Variable & Secret Safety
- If new environment variables are referenced (e.g., `import.meta.env.VITE_API_URL`):
  - Ensure client-accessible variables are prefixed with `VITE_`.
  - Ensure private keys / service account secrets are NEVER exposed via `VITE_` prefixes.
  - Verify the key is documented in `.env.example`.

### Check 4: Automated Test Execution (If tests exist)
Run existing unit / regression test suites:
```bash
npm run test -- --run # or npx vitest run
```
- Ensure changes didn't break existing tests or contracts.

---

## Phase 3: Auto-Remediation Loop

If any verification step fails:
1. **Do NOT output broken code to the user.**
2. Feed the exact compiler / test error output into the diagnosis:
   - Identify whether the failure is a missing import, signature mismatch, type narrowing error, or missing dependency.
3. Apply surgical patches using `replace_file_content` or `multi_replace_file_content`.
4. Re-run Phase 2 verification.
5. Limit auto-remediation loops to a maximum of 3 iterations. If still failing, present the exact blocker and the verified diagnostic logs.

---

## Output Format

Always include the verification proof in the final response:

```markdown
### 🛠️ Implementation Summary
[Concise explanation of changes and architectural rationale]

### 📁 Modified / Created Files
- [`path/to/file.ts`](file:///absolute/path/to/file.ts)

### ✅ Verification Proof
- **Typecheck (`tsc --noEmit`):** Clean (0 errors)
- **SDK Signatures Verified:** 
  - `GoogleGenAI({ apiKey })` ➔ Verified against `@google/genai` declarations
  - `response.text()` / `response.candidates` ➔ Narrowed and null-checked
- **Test Suite (`npm run test`):** Passed (X tests passed)
```

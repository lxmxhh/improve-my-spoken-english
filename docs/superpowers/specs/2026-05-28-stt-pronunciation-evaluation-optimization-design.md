# Speech Recognition & Pronunciation Evaluation Optimization — Design Spec

**Date:** 2026-05-28  
**Status:** Draft (ready for implementation planning)

---

## 1. Background

Current speaking practice flow prioritizes user experience smoothness:

- Transcription may receive expected sentence as prompt.
- Transcription may snap to expected text when similarity is high.
- Evaluation is primarily semantic pass/fail.

This makes practice feel friendly, but can hide real pronunciation and articulation errors. For pronunciation improvement, we need a stricter and more truthful assessment path.

---

## 2. Goal

Build a mode-based speaking assessment system that supports both:

- **Practice Mode (lenient):** keep current low-friction coaching behavior.
- **Assessment Mode (strict):** maximize realism of what learner actually said and return fine-grained scoring.

Primary objective: improve signal quality for pronunciation training without breaking the existing daily practice loop.

---

## 3. Non-Goals (Phase 1)

- Full phoneme-level scoring from scratch in self-hosted models.
- Accent classification or native-likeness ranking.
- Replacing all existing APIs in one migration.

---

## 4. Product Principles

1. **Truth over convenience in strict mode:** no transcript snapping.
2. **Mode clarity:** user always knows whether they are in practice or assessment mode.
3. **Deterministic scoring backbone:** metrics-based score first, LLM as optional assistant.
4. **Backward compatibility:** existing pass/fail session loop remains operational.

---

## 5. Current Gaps

1. Prompt-assisted STT can bias output toward expected sentence.
2. Similarity-based snap-to-expected hides recognition mismatch.
3. Evaluation output is binary (`pass/no`) with limited diagnostics.
4. No explicit pronunciation-oriented dimensions (accuracy, completeness, fluency).

---

## 6. Proposed Architecture

```
Client (Session)
├── Recorder: getUserMedia + MediaRecorder
├── Mode selector: practice | assessment
└── Submit audio + metadata

POST /api/transcribe
├── practice mode:
│   ├── optional prompt allowed
│   └── optional snap-to-expected allowed
└── assessment mode:
    ├── prompt disabled
    ├── snap-to-expected disabled
    └── return raw best transcript + confidence metadata

POST /api/evaluate-line
├── input: expected, actual, mode
└── output:
    ├── pass (compatible)
    └── detailed scores (new)
        ├── accuracyScore (0-100)
        ├── completenessScore (0-100)
        ├── fluencyProxyScore (0-100, phase 1 proxy)
        ├── overallScore (0-100)
        └── diagnostics[]
```

---

## 7. Mode Design

### 7.1 Practice Mode (default)

- Keeps existing behavior for low frustration:
  - prompt can be sent to STT
  - hallucination safeguards enabled
  - snap-to-expected can remain enabled
- Primary output for learner: encouragement + pass/fail progression.

### 7.2 Assessment Mode (new)

- Strict transcription policy:
  - do not send expected sentence as STT prompt
  - never snap transcript to expected
- Scoring policy:
  - pass/fail is derived from metric threshold(s)
  - always show score breakdown and error hints

---

## 8. Scoring Model (Phase 1)

Use deterministic text metrics first.

1. **Accuracy score**
- Based on normalized text distance and word overlap.
- Candidate formula:
  - `accuracy = 100 * (0.55 * charSimilarity + 0.45 * wordOverlap)`

2. **Completeness score**
- Penalize missing content via length ratio and deletion-heavy mismatch.
- Candidate formula:
  - `completeness = 100 * min(1, actualWords / expectedWords)` adjusted by overlap.

3. **Fluency proxy score (Phase 1)**
- Approximate from recording behavior:
  - duration vs expected word count
  - long-silence / repeated restarts penalty (if available)
- This is explicitly labeled as proxy until acoustic prosody integration.

4. **Overall score**
- Weighted:
  - `overall = 0.5 * accuracy + 0.3 * completeness + 0.2 * fluencyProxy`

5. **Pass threshold (assessment mode)**
- Initial threshold: `overall >= 70` (tunable via config).

---

## 9. API Changes

### 9.1 `/api/transcribe`

Add request field:

```ts
mode: "practice" | "assessment"
```

Behavior switch:

- `practice`: current logic preserved.
- `assessment`: force `prompt = null`; disable expected-text snap.

Response additions:

```ts
{
  transcript: string,
  rawTranscript: string,
  selectedModel: string,
  score: number,
  strict: boolean
}
```

### 9.2 `/api/evaluate-line`

Add request field:

```ts
mode: "practice" | "assessment"
```

Response shape extension (keep compatibility):

```ts
{
  pass: boolean,
  scores?: {
    accuracy: number,
    completeness: number,
    fluencyProxy: number,
    overall: number
  },
  diagnostics?: string[]
}
```

---

## 10. UI/UX Changes

1. Session warmup or header adds mode selector:
- `Practice` (recommended for daily use)
- `Assessment` (strict scoring)

2. In assessment mode show:
- transcript as recognized (no rewritten text)
- score card with 4 dimensions
- top 1-3 actionable diagnostics

3. In practice mode keep current minimal feedback.

---

## 11. Rollout Plan

### Phase 1 (low risk, immediate value)

- Introduce mode flag through client -> transcribe -> evaluate.
- Implement strict no-prompt/no-snap branch.
- Extend evaluate API with metric scores.
- Render score card in assessment mode.

### Phase 2 (pronunciation quality upgrade)

- Integrate pronunciation-assessment-capable provider (e.g., Azure Speech Pronunciation Assessment).
- Add true acoustic dimensions: prosody/phoneme errors/stress patterns.

### Phase 3 (adaptive coaching)

- Personalized weakness tracking by sound groups and word patterns.
- Exercise recommendation based on repeated error categories.

---

## 12. Validation & Acceptance Criteria

1. **Strictness checks**
- In assessment mode, request payload to STT has no expected-sentence prompt.
- No transcript snap-to-expected executed in assessment mode.

2. **Quality checks**
- Assessment mode transcript differs from expected sentence in at least 90% of deliberately misread test cases.
- Score decreases predictably on injected word deletions/substitutions.

3. **Compatibility checks**
- Existing practice flow still advances correctly with pass/fail.
- No regression in summarize/history storage.

4. **Observability checks**
- Add structured debug logs (guarded by env flag) for mode, selected model, and score components.

---

## 13. Risks & Mitigations

1. **Risk:** stricter mode feels discouraging due to lower scores.  
**Mitigation:** keep practice mode default and message strict mode as "exam-style feedback".

2. **Risk:** text-only scoring may still miss true pronunciation issues.  
**Mitigation:** label as Phase 1 proxy; plan provider-level pronunciation scoring in Phase 2.

3. **Risk:** noisy environments degrade strict-mode transcript.  
**Mitigation:** improve recorder UX (mic test, input level hint, retry guidance) and later add VAD/noise handling.

---

## 14. Implementation Scope for Next Step

Recommended next implementation package:

1. Add mode state in session page and request payloads.
2. Add strict branch in transcription route.
3. Add score object in evaluate route with deterministic formulas.
4. Add assessment score card UI.
5. Add minimal tests for score function and strict-mode switch logic.

---

## 15. Open Decisions

1. Should assessment mode be available per line toggle or session-level lock?
2. Should pass threshold differ by CEFR level (A2/B1/B2)?
3. Which pronunciation provider should be preferred in Phase 2 given cost and latency constraints?

# Speech Recognition & Pronunciation Evaluation Optimization (Azure) — Design Spec

**Date:** 2026-05-28  
**Status:** Updated for Azure-based speech stack (ready for implementation planning)

---

## 1. Background

Current speaking practice flow now uses Microsoft Azure as the primary speech stack:

- `/api/transcribe` can use Azure STT directly when no reference prompt is needed.
- `/api/pronunciation-assess` already uses Azure Pronunciation Assessment for scored speech feedback.
- The remaining question is how to structure practice vs assessment behavior so the app stays friendly while becoming more truthful.

This makes the app more capable than a pure text-match flow, but the product still needs a clear mode split so practice remains low-friction while assessment is more truthful about pronunciation and fluency.

---

## 2. Goal

Build a mode-based speaking assessment system on top of Azure speech services that supports both:

- **Practice Mode (lenient):** keep current low-friction coaching behavior.
- **Assessment Mode (strict):** maximize realism of what learner actually said and return Azure-backed pronunciation scoring.

Primary objective: improve signal quality for pronunciation training without breaking the existing daily practice loop or the current Azure speech routes.

---

## 3. Non-Goals (Phase 1)

- Rebuilding Azure speech analysis from scratch.
- Accent classification or native-likeness ranking.
- Replacing all existing APIs in one migration.

---

## 4. Product Principles

1. **Truth over convenience in strict mode:** no transcript snapping or prompt bias.
2. **Mode clarity:** user always knows whether they are in practice or assessment mode.
3. **Azure first:** use Azure STT and Azure Pronunciation Assessment as the primary speech stack.
4. **Deterministic fallback scoring:** keep local text metrics only as a fallback or compatibility layer.
5. **Backward compatibility:** existing pass/fail session loop remains operational.

---

## 5. Current Gaps

1. Practice flow still needs a low-friction path for fast line repetition.
2. Assessment output needs a single source of truth for pronunciation scoring.
3. The app needs a clearer separation between transcription-only and scored assessment.
4. Any fallback scoring should not overwrite Azure pronunciation results.

---

## 6. Proposed Architecture

```
Client (Session)
├── Recorder: getUserMedia + MediaRecorder or Worklet WAV capture
├── Mode selector: practice | assessment
└── Submit audio + reference text + metadata

POST /api/transcribe
├── Azure STT primary path
├── practice mode:
│   ├── may use prompt context when helpful
│   └── may keep lenient transcription cleanup
└── assessment mode:
  ├── no prompt bias
  ├── no snap-to-expected
  └── return raw transcript + service metadata

POST /api/pronunciation-assess
├── Azure Pronunciation Assessment primary path
└── output:
  ├── transcript
  ├── pronunciationScore
  ├── accuracyScore
  ├── fluencyScore
  ├── completenessScore
  └── word-level diagnostics

Optional local compatibility scoring
└── /api/evaluate-line for coarse pass/fail fallback only
```

---

## 7. Mode Design

### 7.1 Practice Mode (default)

- Keeps existing behavior for low frustration:
  - Azure STT can still be used for transcript display
  - optional prompt context can remain available if it improves UX
  - transcript cleanup remains permitted when it does not hide errors
- Primary output for learner: encouragement + pass/fail progression.

### 7.2 Assessment Mode (new)

- Strict transcription policy:
  - do not send expected sentence as STT prompt
  - never snap transcript to expected
  - preserve Azure transcript as the learner said it
- Scoring policy:
  - use Azure Pronunciation Assessment as the canonical score source
  - show score breakdown, phoneme/word hints, and error categories

---

## 8. Scoring Model (Azure-first)

Use Azure Pronunciation Assessment as the primary scoring system.

1. **Pronunciation score**
- Overall score from Azure that reflects pronunciation quality.

2. **Accuracy score**
- Azure word/phoneme alignment quality.

3. **Fluency score**
- Azure fluency metric.

4. **Completeness score**
- Azure completeness metric.

5. **Word-level diagnostics**
- Azure word output should drive error hints like omissions, insertions, and mispronunciations.

6. **Fallback compatibility score**
- If pronunciation assessment cannot run, use coarse transcript metrics only as a fallback.
- Fallback should never overwrite an available Azure assessment result.

7. **Pass threshold (assessment mode)**
- Initial threshold should be driven by `AZURE_PRONUNCIATION_PASS_SCORE`.

---

## 9. API Changes

### 9.1 `/api/transcribe`

Add request field:

```ts
mode: "practice" | "assessment"
```

Behavior switch:

- `practice`: Azure STT may still accept helpful context for UX.
- `assessment`: force `prompt = null`; disable expected-text snap.
- Azure should remain the primary recognizer before any fallback text scoring.

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

For Azure responses, `selectedModel` should reflect the service path used rather than a Whisper model name.

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

If Azure pronunciation assessment is already available for the turn, this endpoint should be treated as a coarse compatibility fallback rather than the primary scoring engine.

### 9.3 `/api/pronunciation-assess`

This route becomes the primary assessment endpoint in strict mode.

Behavior expectations:

- Accept audio plus `referenceText`.
- Use Azure Pronunciation Assessment with phoneme granularity.
- Return transcript, pronunciation score, accuracy, fluency, completeness, and word-level diagnostics.
- Fail clearly if Azure credentials are missing.

---

## 10. UI/UX Changes

1. Session warmup or header adds mode selector:
- `Practice` (recommended for daily use)
- `Assessment` (strict scoring)

2. In assessment mode show:
- transcript as recognized (no rewritten text)
- score card with pronunciation / accuracy / fluency / completeness
- top 1-3 actionable diagnostics from Azure word-level output

3. In practice mode keep current minimal feedback.

---

## 11. Rollout Plan

### Phase 1 (align with current Azure code)

- Make `/api/pronunciation-assess` the primary strict scoring path.
- Make `/api/transcribe` explicitly Azure-first with no prompt bias in assessment mode.
- Keep practice mode compatible with the current session flow.
- Surface Azure pronunciation metrics in the session UI.

### Phase 2 (UX and diagnostics hardening)

- Improve feedback language for omitted / substituted / repeated words.
- Add clearer assessment thresholds and retry guidance.
- Add a small testing harness for transcribe and assessment responses.

### Phase 3 (adaptive coaching)

- Personalized weakness tracking by sound groups and word patterns.
- Exercise recommendation based on repeated error categories.

---

## 12. Validation & Acceptance Criteria

1. **Strictness checks**
- In assessment mode, `/api/transcribe` receives no expected-sentence prompt.
- No transcript snap-to-expected executed in assessment mode.
- `/api/pronunciation-assess` is the requested scoring endpoint for strict mode.

2. **Quality checks**
- Azure pronunciation output includes pronunciation, accuracy, fluency, and completeness.
- Word-level diagnostics are returned for obvious mispronunciations and omissions.

3. **Compatibility checks**
- Existing practice flow still advances correctly with pass/fail.
- No regression in summarize/history storage.

4. **Observability checks**
- Add structured debug logs (guarded by env flag) for mode, Azure route used, and score components.

---

## 13. Risks & Mitigations

1. **Risk:** Azure permissions or regional configuration are missing.  
**Mitigation:** surface a clear configuration error and keep practice-mode fallback available where possible.

2. **Risk:** strict mode feels discouraging because Azure scores are more honest.  
**Mitigation:** keep practice mode default and message strict mode as "exam-style feedback".

3. **Risk:** noisy environments degrade strict-mode transcript.  
**Mitigation:** improve recorder UX (mic test, input level hint, retry guidance) and later add VAD/noise handling.

---

## 14. Implementation Scope for Next Step

Recommended next implementation package:

1. Wire session mode to `/api/transcribe` and `/api/pronunciation-assess`.
2. Make assessment mode use Azure pronunciation scoring as the primary result.
3. Keep `/api/evaluate-line` only as compatibility fallback if needed.
4. Add assessment score card UI.
5. Add minimal tests for strict-mode switch logic and Azure response handling.

---

## 15. Open Decisions

1. Should assessment mode be available per line toggle or session-level lock?
2. Should the app expose Azure pronunciation thresholds as a user setting or keep them fixed?
3. Do we want practice mode to keep any text-metric fallback at all, or make Azure the only speech stack everywhere?

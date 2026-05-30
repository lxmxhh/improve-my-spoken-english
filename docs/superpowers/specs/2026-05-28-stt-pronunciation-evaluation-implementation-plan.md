# Speech Recognition & Pronunciation Evaluation (Azure) — Implementation Plan

**Date:** 2026-05-28  
**Based on:** [2026-05-28-stt-pronunciation-evaluation-optimization-design.md](2026-05-28-stt-pronunciation-evaluation-optimization-design.md)

---

## 1. Scope

This plan implements Phase 1 only:

- Introduce `practice | assessment` mode through client and API chain.
- Make assessment mode strict (no prompt bias, no snap-to-expected).
- Route strict scoring through Azure Pronunciation Assessment.
- Keep `/api/evaluate-line` as a compatibility fallback only.
- Keep full backward compatibility for existing practice session flow.

Out of scope in this plan:

- Personalized long-term weakness analytics.

---

## 2. Milestones

### M1. Mode plumbing end-to-end

- Add mode state to session UI.
- Send mode with transcription and evaluation requests.
- Ensure default mode remains `practice`.

### M2. Strict transcription branch

- In assessment mode, force no prompt.
- In assessment mode, disable transcript snapping.
- Return strictness metadata for diagnostics.

### M3. Azure pronunciation assessment path

- Add request wiring from session UI to `/api/pronunciation-assess`.
- Render Azure pronunciation metrics in the session UI.
- Keep `pass` field for compatibility when falling back to `/api/evaluate-line`.

### M4. Assessment UI feedback

- Display score card only in assessment mode.
- Keep current UX behavior in practice mode.

### M5. Tests + verification + docs sync

- Unit tests for Azure mode switch and compatibility fallback.
- Regression checks on existing session progression.
- Update design/spec docs if implementation deviates.

---

## 3. File-Level Change Plan

## 3.1 Client/session flow

### [src/app/session/page.tsx](src/app/session/page.tsx)

Changes:

- Add state `mode: "practice" | "assessment"`.
- Add UI control (session-level toggle in warmup or header).
- Pass mode to `MicButton` and the assessment request bodies.
- Store Azure pronunciation assessment details in state for assessment score display.
- Render score breakdown card when mode is `assessment`.

Definition of done:

- Existing flow works unchanged when mode is `practice`.
- Mode can be switched before conversation starts.
- Assessment mode visibly shows score dimensions per attempt.

### [src/components/MicButton.tsx](src/components/MicButton.tsx)

Changes:

- Add optional prop `mode` (default `practice`) for request payload.
- Include `mode` in `/api/transcribe` multipart form.
- Include `referenceText` / prompt wiring for assessment calls if needed by the downstream route.
- Keep recording behavior unchanged (manual stop + 10s auto-stop).

Definition of done:

- No behavior regression in recording UX.
- Server receives mode reliably.

---

## 3.2 Transcription API strictness

### [src/app/api/transcribe/route.ts](src/app/api/transcribe/route.ts)

Changes:

- Parse `mode` from form data; default to `practice`.
- Use Azure STT as the primary recognizer path.
- In `assessment` mode:
  - force `prompt = null` before transcription pass
  - skip expected-transcript snapping logic entirely
- Keep hallucination filtering safeguards.
- Return `strict: boolean` and mode in response metadata.

Definition of done:

- `assessment` requests never use expected sentence as prompt.
- `assessment` responses preserve real recognized transcript.
- `practice` behavior remains backward compatible.

---

## 3.3 Evaluation API scoring

### [src/app/api/evaluate-line/route.ts](src/app/api/evaluate-line/route.ts)

Changes:

- Parse `mode` from request body; default to `practice`.
- Keep this endpoint as a compatibility fallback for coarse scoring.
- Response shape:
  - keep `pass`
  - add optional `scores` and `diagnostics` when falling back
- Pass rule:
  - `practice`: keep current lenient behavior.
  - `assessment`: prefer Azure pronunciation assessment; use this endpoint only if Azure assessment is unavailable.

Definition of done:

- Existing clients reading only `pass` continue to work.
- Assessment mode always returns score object.

---

## 3.4 Optional type hygiene

### [src/lib/types.ts](src/lib/types.ts)

Changes:

- Add shared types:
  - `PracticeMode`
  - `PronunciationAssessment`
  - optional fallback evaluator response type

Definition of done:

- No duplicated mode string literals across files.

---

## 3.5 UI component(s) for score display

### Preferred: keep local to session first

- Start with inline score card in [src/app/session/page.tsx](src/app/session/page.tsx).
- If JSX grows too large, extract to:
  - [src/components/SessionScoreCard.tsx](src/components/SessionScoreCard.tsx)

Definition of done:

- Score card clear on mobile and desktop.
- Hidden in practice mode.

---

## 4. API Contract Updates

### 4.1 `/api/transcribe` request

`multipart/form-data`

- `audio` (required)
- `prompt` (optional; ignored in assessment)
- `mode` (optional; defaults to `practice`)

### 4.2 `/api/transcribe` response

```ts
{
  transcript: string;
  rawTranscript?: string;
  selectedModel?: string;
  score?: number;
  strict?: boolean;
  mode?: "practice" | "assessment";
  error?: string;
}
```

For Azure responses, `selectedModel` should identify the Azure speech path rather than a Whisper model.

### 4.2.1 `/api/pronunciation-assess` request

```ts
{
  audio: File;
  referenceText: string;
}
```

### 4.2.2 `/api/pronunciation-assess` response

```ts
{
  transcript: string;
  referenceText: string;
  pass: boolean;
  pronunciationScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  words?: Array<{
    word: string;
    accuracyScore?: number;
    errorType?: string;
  }>;
  error?: string;
}
```

### 4.3 `/api/evaluate-line` request

```ts
{
  expected: string;
  actual: string;
  mode?: "practice" | "assessment";
}
```

### 4.4 `/api/evaluate-line` response

```ts
{
  pass: boolean;
  scores?: {
    accuracy: number;
    completeness: number;
    fluencyProxy: number;
    overall: number;
  };
  diagnostics?: string[];
}
```

---

## 5. Testing Plan

## 5.1 Unit tests

Target files:

- New test for Azure mode wiring and fallback scoring behavior.

Cases:

- exact match -> high accuracy/high overall
- missing words -> lower completeness
- substitution-heavy mismatch -> lower accuracy
- Azure assessment response shape is preserved
- fallback endpoint does not override Azure results

## 5.2 API behavior checks

- `assessment` mode in transcribe ignores prompt.
- `assessment` mode never snaps transcript to expected.
- pronunciation assessment returns pronunciation/accuracy/fluency/completeness.
- fallback evaluator still returns usable `pass` in practice mode.

## 5.3 Manual E2E checks

1. Practice mode: current session UX unchanged.
2. Assessment mode: same utterance shows Azure score card and stricter outcomes.
3. Intentional misread sentence should no longer be silently corrected to expected.

---

## 6. Rollout & Safety

- Feature rollout strategy:
  - Default to `practice` mode.
  - Expose `assessment` mode as explicit user choice.
- Add debug logging behind env flag (`NEXT_PUBLIC_DEBUG_STT` / server equivalent).
- If strict branch causes unstable UX, fallback by forcing mode to `practice` without reverting API fields.

---

## 7. Acceptance Checklist

- [ ] Session mode selector implemented and persisted for current session.
- [ ] `mode` flows client -> transcribe -> evaluate.
- [ ] Assessment mode does not send expected sentence as STT prompt.
- [ ] Assessment mode does not apply snap-to-expected.
- [ ] Evaluator returns score object in assessment mode.
- [ ] Practice mode remains backward compatible.
- [ ] Unit tests cover scoring thresholds and mismatch cases.
- [ ] Manual regression pass for session, summary, and history.

---

## 8. Suggested Execution Order (PR slicing)

1. PR-1: mode plumbing + transcribe strict branch.
2. PR-2: evaluator score model + response extension.
3. PR-3: assessment score UI + tests + docs sync.

This keeps risk low and makes regressions easy to isolate.

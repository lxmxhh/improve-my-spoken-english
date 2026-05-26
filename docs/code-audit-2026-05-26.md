# Code Audit — Simplification and Dead Code Candidates

Date: 2026-05-26  
Scope: static scan of the current project; no implementation changes made.

## Summary

The project is still small, but the active session flow has accumulated several layers of fallback and debugging code. The main simplification opportunity is not deleting whole feature areas immediately; it is deciding which runtime targets matter:

- Local macOS-only prototype
- Vercel/Linux deployable web app
- Browser-native only speech stack
- Server-backed speech stack

Until that target is clear, some code looks "unused" in one environment but useful in another.

## High-Confidence Cleanup Candidates

### 1. Remove unused `TIMEOUT_MS`

File: `src/components/MicButton.tsx:15`

Status: completed on 2026-05-26.

`TIMEOUT_MS = 60_000` is declared but never used. The implemented behavior uses `AUTO_STOP_MS = 10_000` instead.

Why it matters:

- ESLint already reports this as an unused variable.
- It also contradicts the intended 60-second recording timeout mentioned in older planning docs.

Recommended action:

- Either remove `TIMEOUT_MS`, or restore the intended 60-second max recording logic and keep `AUTO_STOP_MS` as a silence/no-manual-stop limit.

### 2. Remove or rewrite `BrowserWarning`

File: `src/components/BrowserWarning.tsx:8-12`

Status: completed on 2026-05-26. The warning now checks the active recording requirements: `getUserMedia` and `MediaRecorder`.

The warning checks for `SpeechRecognition` / `webkitSpeechRecognition`, but the app currently records audio with `MediaRecorder` and sends it to `/api/transcribe`. Native browser SpeechRecognition is no longer the active STT path.

Why it matters:

- The warning can tell users to switch browsers even though the current implementation may work anywhere `getUserMedia` + `MediaRecorder` works.
- It is also one of the lint failures because it synchronously calls `setUnsupported` inside an effect.

Recommended action:

- Replace the check with feature detection for `navigator.mediaDevices.getUserMedia` and `MediaRecorder`, or remove the banner until a clearer compatibility policy exists.

### 3. Remove production-noisy TTS debug logs

Files:

- `src/lib/tts.ts:62-88`
- `src/app/session/page.tsx:384-446`
- `src/app/api/tts-say/route.ts:34-55`

Status: completed on 2026-05-26. Routine TTS logs are now behind debug flags; real failures still use error logging.

These logs were useful while diagnosing Chrome/macOS TTS, but they now expose detailed audio flow noise in normal use.

Why it matters:

- Makes real errors harder to spot.
- Logs partial spoken text to browser/server consoles.
- Can be confusing when expected fallback behavior is logged like a failure.

Recommended action:

- Gate them behind a debug flag, e.g. `NEXT_PUBLIC_DEBUG_TTS === "1"`, or remove most logs and keep only real failures.

### 4. Update stale comment in `pickEnglishVoice`

File: `src/lib/tts.ts:21`

Status: completed on 2026-05-26.

The comment says "Chrome built-in first, then macOS standard", but the actual preferred order now starts with macOS voices such as Samantha.

Recommended action:

- Update the comment to match the current priority.

## Medium-Confidence Simplification Candidates

### 5. Extract TTS playback into one reusable client helper

Files:

- `src/components/CoachLine.tsx:37-96`
- `src/app/session/page.tsx:369-449`
- `src/lib/tts.ts`

`CoachLine` and the manual listen button both implement the same conceptual flow:

1. Wait for browser voices.
2. Create `SpeechSynthesisUtterance`.
3. Detect whether Web Speech actually starts.
4. Fall back to macOS audio.
5. Clear timers and release UI state.

Why it matters:

- The duplicated timer/cancel/fallback logic is hard to reason about.
- Future TTS provider changes would need edits in multiple places.

Recommended action:

- Move the full "speak with browser, then fallback" flow into `src/lib/tts.ts`.
- Let `CoachLine` and `SessionPage` call a single function with callbacks like `onStart`, `onEnd`, and `onError`.

### 6. Split `src/app/session/page.tsx`

File: `src/app/session/page.tsx`

The session page currently owns:

- Reducer and state machine
- Script loading
- Timer logic
- Summary generation and persistence
- STT evaluation flow
- Delayed pass advance countdown
- Manual TTS playback
- All rendering for loading, warmup, conversation, and summary

Why it matters:

- It is the highest-risk file for regressions.
- Several lint issues are concentrated here, including `setLastTranscript` being used before declaration at `src/app/session/page.tsx:293` and declared at `src/app/session/page.tsx:343`.

Recommended action:

- Keep the reducer in this file or move it to `src/lib/session-reducer.ts`.
- Extract user-turn UI into `UserTurnPanel`.
- Extract `useManualTts`, `usePassAdvanceDelay`, and possibly `useSessionTimer`.

### 7. Revisit macOS-only `/api/tts-say`

File: `src/app/api/tts-say/route.ts:45-51`

This route depends on macOS binaries `say` and `afconvert`. It is useful for local debugging/prototyping, but it is not portable to standard Vercel/Linux runtime.

Why it matters:

- The project docs still list Vercel as the intended hosting target.
- Keeping this route in the default runtime path may create deployment surprises.

Recommended action:

- Keep it if the near-term target is local macOS use.
- Otherwise move it behind a clearly named local-only route/flag, or replace it with a deployable TTS provider.

### 8. Decide whether `src/types/speech.d.ts` is still needed

File: `src/types/speech.d.ts`

The custom SpeechRecognition types support the old browser-native STT path. Current recording uses `MediaRecorder`, not `SpeechRecognition`.

Recommended action:

- If browser-native STT will not return, remove the file.
- If it may return as a fallback, keep it but document that it belongs to a dormant feature.

### 9. Empty local directory `src/app/api/tts`

Directory: `src/app/api/tts`

This directory contains no files and is not tracked by Git. It is harmless, but locally confusing because the active TTS route is `src/app/api/tts-say`.

Recommended action:

- Remove the empty directory manually if it is not being used as a placeholder.

## Documentation and Planning Drift

### 10. README is still the create-next-app default

File: `README.md`

The README still points users to `localhost:3000`, mentions editing `app/page.tsx`, and does not describe required environment variables, the 6688 local convention, Groq/OpenRouter keys, or the macOS TTS fallback.

Recommended action:

- Replace with a project-specific README once the current prototype direction stabilizes.

### 11. `.github/prompts` are historical scaffolding

Files:

- `.github/prompts/plan-englishSpeakingPractice.prompt.md`
- `.github/prompts/plan-englishSpeakingPractice-impl.prompt.md`

These are useful provenance, but they describe older implementation choices such as browser-native SpeechRecognition and returning 500 from script generation instead of route-level fallback.

Recommended action:

- Keep them if they are intended as historical planning artifacts.
- Move them under `docs/archive/` or mark them explicitly as superseded if they should not guide future implementation.

## Lint and Build Findings

### TypeScript

`npx tsc --noEmit` passes.

### ESLint

`npm run lint` currently reports:

- `src/app/history/page.tsx:23` — synchronous state set in effect.
- `src/app/page.tsx:16` — synchronous state set in effect.
- `src/app/session/page.tsx:293` — `setLastTranscript` accessed before declaration.
- `src/app/session/page.tsx:348` — synchronous state set in effect.
- `src/components/BrowserWarning.tsx:12` — synchronous state set in effect.
- `src/components/MicButton.tsx:15` — unused `TIMEOUT_MS`.

Recommended action:

- Fix the two concrete cleanup items first: `TIMEOUT_MS` and the stale/possibly obsolete `BrowserWarning`.
- Then address session page structure before chasing every React compiler lint in place.

## Suggested Cleanup Order

1. Decide whether macOS TTS fallback is local-only or part of the product.
2. Extract duplicated TTS logic.
3. Split `session/page.tsx` only after the target speech stack is decided.
4. Update README.

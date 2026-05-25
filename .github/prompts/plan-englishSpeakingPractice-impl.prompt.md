# Implementation Plan — English Speaking Practice Website

Spec: `docs/superpowers/specs/2026-05-25-english-speaking-practice-design.md`

---

## Phase 1 — Project Scaffolding

### Step 1.1 — Initialize Next.js project
- Run `npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir --import-alias "@/*"`
- Confirm directory structure: `src/app/`, `src/components/`, `src/lib/`

### Step 1.2 — Install dependencies
```
npm install openai uuid
npm install -D @types/uuid
```

### Step 1.3 — Environment variables
Create `.env.local`:
```
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-4o
```
Add `.env.local` to `.gitignore`.

### Step 1.4 — OpenRouter API client
Create `src/lib/ai.ts`:
- Instantiate `openai` with `baseURL: "https://openrouter.ai/api/v1"` and `apiKey` from env
- Export a single `openrouter` client instance
- Export `MODEL` constant from env

---

## Phase 2 — Data Layer

### Step 2.1 — TypeScript types
Create `src/lib/types.ts`:
- `ScriptTurn`, `Script`, `Session`, `DailyRecord` interfaces (from spec §6 and §8)

### Step 2.2 — localStorage helpers
Create `src/lib/storage.ts`:
- `getSessions(): Session[]`
- `saveSession(session: Session): void`
- `getDailyRecord(date: string): DailyRecord | null`
- `upsertDailyRecord(record: DailyRecord): void`
- `getStreak(): number`
- `setStreak(n: number): void`
- `computeAndUpdateStreak(): number` — called after each session save; checks yesterday's record to increment or reset streak

### Step 2.3 — Fallback scripts
Create `src/lib/fallback-scripts.ts`:
- Export array of 5 hardcoded `Script` objects, one per category
- Topics: "My Daily Routine" / "My Job" / "A Recent News Story" / "A Favorite Movie" / "Weekend Plans"

---

## Phase 3 — API Routes

### Step 3.1 — `POST /api/generate-script`
File: `src/app/api/generate-script/route.ts`

Request body: `{ category: string, topic?: string }`

Logic:
1. Build system + user prompt (see spec §6)
2. Call OpenRouter with `response_format: { type: "json_object" }`
3. Parse and validate returned JSON as `Script`
4. If parse fails or API errors → return 500 (caller falls back to hardcoded script)

Response: `Script` JSON

### Step 3.2 — `POST /api/evaluate-line`
File: `src/app/api/evaluate-line/route.ts`

Request body: `{ expected: string, actual: string }`

Logic:
1. If `actual` is empty → return `{ pass: false }` immediately (no API call)
2. Build prompt: "Expected: '...'. User said: '...'. Same core meaning? Reply only: yes or no"
3. Call OpenRouter (low max_tokens: 5)
4. Parse response: `yes` → `{ pass: true }`, anything else → `{ pass: false }`
5. On API error → return `{ pass: true }` (fail-open, don't block user)

Response: `{ pass: boolean }`

### Step 3.3 — `POST /api/summarize`
File: `src/app/api/summarize/route.ts`

Request body: `{ script: Script, passedLines: number, totalLines: number }`

Logic:
1. Format script turns as plain text
2. Build prompt (see spec §7)
3. Call OpenRouter, return raw text response
4. On API error → return a generic fallback encouragement string

Response: `{ summary: string }`

---

## Phase 4 — Shared Components

### Step 4.1 — `BrowserWarning`
`src/components/BrowserWarning.tsx`
- Detect `window.SpeechRecognition || window.webkitSpeechRecognition`
- If absent, render a sticky top banner: "Voice features require Chrome or Edge"

### Step 4.2 — `ProgressRings` (home page widget)
`src/components/ProgressRings.tsx`
- Props: `completed: number` (0–3)
- Render 3 colored circles: filled green if done, outline if not
- Show streak count below

### Step 4.3 — `MicButton`
`src/components/MicButton.tsx`
- Props: `onResult(transcript: string): void`, `onError(): void`, `disabled: boolean`
- Internal state: `idle | listening | processing`
- On press: start `SpeechRecognition` (lang: `en-US`, continuous: false)
- 60-second auto-stop timer via `setTimeout`
- 10-second silence detection: if `onend` fires with no result within 10s, call `onError()`
- Show 60-second countdown progress bar while listening
- Visual states: pulsing ring when listening, spinner when processing

### Step 4.4 — `CoachLine`
`src/components/CoachLine.tsx`
- Props: `text: string`, `onDone(): void`
- On mount: call `window.speechSynthesis.speak(utterance)` with `lang: "en-US"`
- Show text as subtitle while speaking
- Call `onDone()` when utterance ends

### Step 4.5 — `SessionSummary`
`src/components/SessionSummary.tsx`
- Props: `summary: string`, `passedLines: number`, `totalLines: number`, `onNext(): void`, `onDone(): void`
- Display pass rate headline, summary text, two action buttons

---

## Phase 5 — Session Page (`/session`)

File: `src/app/session/page.tsx`
State machine with these stages: `topic-select → warmup → conversation → summary`

### Step 5.1 — Topic selection stage
- On mount: call `/api/generate-script` with a random category
- While loading: show spinner
- Show script topic in a card with a "Start" button (no multi-topic picker needed for MVP — one topic per session)
- On error: silently use a random fallback script

### Step 5.2 — Warm-up stage
- Extract first 2–3 nouns/keywords from script (simple split, no AI call)
- Display them as keyword chips
- "I'm Ready" button → advance to conversation stage

### Step 5.3 — Conversation stage
Session state:
```ts
{
  script: Script
  turnIndex: number        // current position in script.turns (user turns only)
  attempt: 0 | 1          // 0 = first try, 1 = retry
  results: TurnResult[]   // { turnIndex, passed }[]
  startedAt: number       // Date.now()
  elapsedSec: number       // updated every second
}
```

Per-turn loop:
1. Render coach turns via `<CoachLine>` — wait for `onDone()` before continuing
2. For user turns:
   a. Show reference line: "You can say: _{text}_"
   b. Render `<MicButton>`
   c. On transcript received → call `/api/evaluate-line`
   d. Pass → record result, advance `turnIndex`, reset `attempt`
   e. Fail + `attempt === 0` → set `attempt = 1`, show "Give it another try!"
   f. Fail + `attempt === 1` → record as failed, advance `turnIndex`
3. 5-minute timer: `useEffect` interval; when `elapsedSec >= 300` → end session early
4. When `turnIndex` reaches end of script → end session

### Step 5.4 — End session
- Calculate `passedLines`, `failedLines`, `durationSec`
- Call `/api/summarize`
- Save `Session` to localStorage via `saveSession()`
- Update `DailyRecord` and streak via `computeAndUpdateStreak()`
- Advance to `summary` stage

---

## Phase 6 — Home Page (`/`)

File: `src/app/page.tsx`
- Load today's `DailyRecord` from localStorage on mount
- Show `<ProgressRings completed={sessionIds.length} />`
- Show current streak
- "Start Practice" button → navigate to `/session`
- If daily goal met (3 sessions): show congratulations banner

---

## Phase 7 — History Page (`/history`)

File: `src/app/history/page.tsx`
- Load all `Session[]` from localStorage
- Group by date (newest first)
- Per session: show topic, category, pass rate (`passedLines/totalLines`), date
- Expandable row to show AI summary text
- Empty state: "No sessions yet — start your first practice!"

---

## Phase 8 — Layout & Polish

### Step 8.1 — Root layout
`src/app/layout.tsx`:
- Include `<BrowserWarning />` at top of layout
- Set `<html lang="en">`
- Basic Tailwind base styles

### Step 8.2 — Navigation
Simple top nav: logo/name + links to Home and History

### Step 8.3 — Responsive layout
All pages should work on desktop and mobile (single-column on mobile)

---

## Build Order

```
Phase 1 (scaffolding)
  → Phase 2 (data layer)
    → Phase 3 (API routes)  ← can be tested independently with curl
      → Phase 4 (components)
        → Phase 5 (session page)  ← core feature, build & test end-to-end
          → Phase 6 (home page)
            → Phase 7 (history page)
              → Phase 8 (layout & polish)
```

---

## Verification Checklist (per phase)

- [ ] Phase 1: `npm run dev` starts without errors; Tailwind styles render
- [ ] Phase 2: localStorage read/write roundtrip works in browser console
- [ ] Phase 3: each route returns correct shape when called with `curl`
- [ ] Phase 4: `<MicButton>` captures speech; `<CoachLine>` speaks and fires `onDone`
- [ ] Phase 5: full session completes end-to-end (topic → warmup → conversation → summary)
- [ ] Phase 6: home page shows correct progress after completing sessions
- [ ] Phase 7: history page lists past sessions correctly
- [ ] Phase 8: no layout breakage on mobile viewport

# Web To Android App Migration Plan

**Date:** 2026-06-08  
**Status:** Planning document  
**Project:** English Speaking Practice  

## 1. Goal

Turn the current Next.js web app into an Android app that keeps the core speaking-practice flow:

- daily topic practice
- coach-led conversation
- microphone recording
- pronunciation assessment
- TTS playback
- local practice history and streaks
- admin/script-pool workflows where still useful

The first Android version should preserve the working web behavior before adding native-only features.

## 2. Current App Baseline

The current app is a Next.js App Router project with browser UI plus server-side route handlers.

Important pages:

- `/`: home, daily progress, streak, start entry point
- `/session`: main speaking-practice session
- `/history`: local practice history
- `/stt-test`: speech testing page
- `/admin`: script-pool/admin page

Important APIs:

- `POST /api/generate-script`
- `POST /api/script-pool`
- `POST /api/pronunciation-assess`
- `POST /api/pronunciation-coach`
- `POST /api/transcribe`
- `POST /api/evaluate-line`
- `POST /api/tts-say`
- `POST /api/summarize`

Important browser/device dependencies:

- `navigator.mediaDevices.getUserMedia`
- `MediaRecorder`
- `AudioWorklet`
- browser or server-backed audio playback
- `speechSynthesis`
- `localStorage`

Important server/runtime dependencies:

- OpenAI-compatible chat client
- Groq transcription fallback
- Azure Speech and Pronunciation Assessment
- DashScope Qwen-TTS
- `ffmpeg` for audio conversion
- local `.next` cache/temp directories

## 3. Key Constraint

The app cannot simply be exported as static HTML and packaged as an Android app without changing architecture.

Reason: the current app depends on Next.js route handlers and Node.js runtime behavior for speech, TTS, AI generation, summarization, and audio conversion. Static export does not support server-side runtime behavior such as request-dependent route handlers. Therefore an Android build must either:

1. keep the Next.js backend online and let the Android app call it, or
2. move those server responsibilities to a separate backend, or
3. rewrite substantial parts of the product as a native app with native API clients.

## 4. Recommended Direction

Use **Capacitor Android wrapper + hosted backend** as Phase 1.

This keeps the existing React/Next.js UI as the product surface, packages it in a native Android shell, and keeps AI/speech/TTS routes on the server. It is the shortest path to a real APK while preserving the working app.

### Why this route

- Lowest rewrite cost.
- Reuses most existing React components and UI state.
- Keeps API keys off the device.
- Keeps `ffmpeg`, Azure SDK, and TTS cache logic on the server.
- Lets the current web app remain deployable.
- Allows later native improvements through Capacitor plugins.

### Alternatives

| Option | Description | Pros | Cons |
|---|---|---|---|
| Capacitor + hosted backend | Package web UI in Android shell; keep server APIs online | Fastest path, least rewrite, protects API keys | Needs network, backend uptime, Android WebView mic validation |
| PWA only | Make the current website installable from Chrome | Very low effort | Not a Play Store app, weaker native control, still browser-based |
| React Native / Expo rewrite | Rebuild UI and audio flow with native mobile stack | Better native UX long-term | Much larger rewrite; API and audio flow need redesign |
| Native Kotlin app | Full Android-native implementation | Maximum native control | Highest cost; duplicates most app logic |

## 5. Target Architecture For Phase 1

```text
Android App
└── Capacitor shell
    └── WebView-hosted React UI
        ├── microphone capture
        ├── audio playback
        ├── local progress cache
        └── calls HTTPS backend APIs

HTTPS Backend
└── Existing Next.js production app
    ├── /api/generate-script
    ├── /api/pronunciation-assess
    ├── /api/transcribe
    ├── /api/tts-say
    ├── /api/evaluate-line
    ├── /api/summarize
    └── script-pool/admin APIs

External Services
├── Azure Speech
├── OpenAI-compatible chat endpoint
├── Groq
└── DashScope Qwen-TTS
```

## 6. Work Breakdown

### 6.1 Product Decisions

- Decide whether Android v1 is internal testing only or Play Store ready.
- Decide whether `/admin` ships in the Android app or remains web-only.
- Decide whether Android v1 requires offline practice, or whether online-only is acceptable.
- Decide app identity:
  - app name
  - package id, for example `com.samxu.englishspeakingpractice`
  - icon
  - splash screen
  - brand color
- Decide privacy posture:
  - whether recordings are stored locally
  - whether recordings are uploaded only for processing
  - how long server temp files/cache entries are retained

### 6.2 Backend Preparation

- Keep production server on port `6688` behind trusted HTTPS, following the existing Caddy deployment docs.
- Configure a stable public base URL for the Android app, for example `https://practice.example.com`.
- Add an environment variable such as `NEXT_PUBLIC_API_BASE_URL` or app config for Android API calls if the packaged UI is not same-origin.
- Ensure all Android app API calls use HTTPS.
- Review CORS only if Android packaged pages are not served from the same backend origin.
- Confirm server has:
  - Azure Speech credentials
  - Groq credentials if fallback remains enabled
  - OpenAI-compatible API credentials
  - DashScope credentials
  - `ffmpeg`
- Confirm temp/cache cleanup behavior for:
  - `.next/transcribe-temp`
  - `.next/tts-cache`

### 6.3 Web UI Refactor For Mobile Shell

- Audit all browser-only code for Android WebView behavior:
  - `getUserMedia`
  - `MediaRecorder`
  - `AudioWorklet`
  - `speechSynthesis`
  - `localStorage`
  - audio autoplay/user-gesture behavior
- Add a platform/service layer for device capabilities:
  - microphone support detection
  - recorder implementation selection
  - audio playback implementation
  - persistent storage implementation
- Avoid hard-coded relative API assumptions where Android packaging changes origin behavior.
- Add Android-specific error copy for:
  - microphone permission denied
  - missing WebView audio capture support
  - network unavailable
  - backend unavailable
- Keep the current browser flow working after each refactor.

### 6.4 Android Container Setup

- Add Capacitor dependencies:
  - `@capacitor/core`
  - `@capacitor/cli`
  - `@capacitor/android`
- Initialize Capacitor with the chosen app id and app name.
- Add the Android platform.
- Configure the web asset output and server/base URL strategy.
- Generate Android project files.
- Open and build the project in Android Studio.
- Decide whether to load:
  - bundled web assets that call a remote backend, or
  - the live HTTPS site directly in the WebView.

Recommended v1 choice: bundle the web UI assets only if the app can be made compatible with static assets and remote APIs. Otherwise, load the live HTTPS site in the Android shell first, then later move toward bundled assets.

### 6.5 Android Microphone Permissions

- Add Android manifest permission:
  - `android.permission.RECORD_AUDIO`
- Request runtime microphone permission on Android 6+.
- Ensure WebView permission requests are handled correctly:
  - only grant `PermissionRequest.RESOURCE_AUDIO_CAPTURE`
  - deny unknown resources
  - do not blindly grant all requested resources
- Test `getUserMedia({ audio: true })` in the packaged app on real Android hardware.
- Verify the app handles:
  - first-time permission allow
  - permission denial
  - permission revoked in Android settings
  - app background/foreground transitions during recording

### 6.6 Audio Capture And Playback

- Validate current worklet WAV capture on Android WebView.
- Validate MediaRecorder fallback formats on Android:
  - `audio/webm;codecs=opus`
  - `audio/webm`
  - `audio/mp4`
  - `audio/aac`
- Confirm server accepts each captured format and converts it to WAV for Azure.
- Confirm short recording rejection thresholds still work on phone microphones.
- Confirm TTS playback starts only after a user gesture when required.
- Confirm server TTS playback from `/api/tts-say` works in Android WebView.
- Decide whether to replace browser `speechSynthesis` with server TTS or a native TTS plugin in Android.

### 6.7 Storage And Sync

- Keep `localStorage` for v1 if data loss risk is acceptable.
- Add a storage adapter so future migration can move to:
  - Capacitor Preferences
  - SQLite
  - user account cloud sync
- Define export/import or migration strategy for existing `esp_sessions`, `esp_daily`, and `esp_streak`.
- Decide whether clearing app data is acceptable to reset practice history.

### 6.8 Network And Offline Behavior

- Add network status detection for Android.
- Show a clear offline state before starting a session if backend APIs are required.
- Allow viewing local history offline if feasible.
- Decide whether bundled fallback scripts are enough for a limited offline practice mode.
- For v1, keep pronunciation assessment and AI summary online-only.

### 6.9 Security And Privacy

- Keep all AI provider keys on the backend.
- Do not put Azure/Groq/OpenAI/DashScope keys inside the Android app.
- Use HTTPS only.
- Add Android Network Security Config only if needed, and do not allow cleartext traffic in production.
- Review privacy disclosure for microphone use and uploaded audio.
- Avoid logging raw audio, transcripts, or API keys.
- Confirm temporary audio files are deleted after processing where possible.
- Add a simple privacy policy before Play Store release.

### 6.10 Android UX Polish

- Check small-screen layout for:
  - home progress rings
  - session coach line
  - mic button
  - recording countdown
  - assessment feedback
  - summary page
  - history list
- Handle safe areas, keyboard, and orientation.
- Add native splash screen and app icon.
- Add haptic feedback for recording start/stop if useful.
- Prevent accidental back navigation from losing an active session.
- Decide whether portrait-only is acceptable for v1.

### 6.11 Build And Release

- Set up Android signing:
  - debug keystore for local testing
  - release keystore for distribution
- Build debug APK for device testing.
- Build release APK/AAB.
- Create Play Console app only when ready for store distribution.
- Prepare:
  - app icon
  - screenshots
  - short description
  - full description
  - privacy policy URL
  - data safety answers
  - testing track setup

### 6.12 Testing And Acceptance

Run web regression checks:

- `npm run lint`
- `npm run build`
- browser smoke test on `http://localhost:6688`

Run Android checks:

- install debug APK on at least one real Android phone
- start a session
- grant microphone permission
- record a spoken line
- receive pronunciation result
- hear coach TTS
- complete a session
- verify history/streak persistence after app restart
- deny microphone permission and confirm friendly error
- disable network and confirm friendly error
- background the app during recording and confirm safe recovery

Acceptance criteria for Android v1:

- User can install and open the app.
- User can complete one full speaking session on Android.
- Microphone permission flow works.
- Audio reaches the backend and receives a pronunciation/transcription result.
- TTS playback works reliably enough for practice.
- Daily progress and history persist across app restarts.
- API keys are not bundled into the APK/AAB.
- Production backend is reachable only over trusted HTTPS.

## 7. Suggested Phases

### Phase 0: Decision And Prototype

- Choose Capacitor + hosted backend as v1 path.
- Choose package id and app name.
- Confirm Android app should be online-only for v1.
- Build a throwaway Android WebView/Capacitor prototype against the current HTTPS site.
- Validate microphone and TTS on one real Android device.

### Phase 1: App Shell

- Add Capacitor configuration.
- Add Android project.
- Configure initial app icon and splash screen assets.
- Build debug APK.
- Install on real device.

### Phase 2: Compatibility Fixes

- Add platform capability adapter.
- Fix Android WebView microphone permission behavior.
- Normalize API base URL behavior.
- Improve mobile-specific errors.
- Validate audio formats end to end.

### Phase 3: Product Hardening

- Improve Android layout and back navigation.
- Add network/offline handling.
- Add storage adapter or confirm localStorage is acceptable for v1.
- Add privacy copy and data handling notes.

### Phase 4: Release Prep

- Create release signing setup.
- Build release AAB.
- Prepare Play Store assets.
- Run final Android acceptance checklist.

## 8. First Implementation Slice

The first concrete implementation slice should be small:

1. Add Capacitor dependencies and config.
2. Add Android platform.
3. Point the Android shell at the existing HTTPS deployment.
4. Add microphone permission handling.
5. Build and install a debug APK.
6. Verify one full practice session on a real Android phone.

Only after this works should the project invest in deeper UI refactors or native plugins.

## 9. Open Questions

- Is the Android app intended for personal/internal use or Play Store distribution?
- Should `/admin` be accessible in the Android app?
- Is online-only acceptable for v1?
- What domain should the production backend use?
- Should practice history remain local-only, or should the Android app introduce login/sync?
- Should Android use server TTS only, browser `speechSynthesis`, or native TTS?

## 10. References

- Capacitor documentation: https://capacitorjs.com/docs/next
- Capacitor Android setup overview: https://capacitorjs.com/enterprise
- Next.js static export limitations: https://nextjs.org/docs/14/app/building-your-application/deploying/static-exports
- Next.js API/static export warning: https://nextjs.org/docs/messages/api-routes-static-export
- Android `WebChromeClient.onPermissionRequest`: https://developer.android.com/reference/android/webkit/WebChromeClient.html#onPermissionRequest(android.webkit.PermissionRequest)
- Android `PermissionRequest.RESOURCE_AUDIO_CAPTURE`: https://developer.android.com/reference/android/webkit/PermissionRequest#RESOURCE_AUDIO_CAPTURE

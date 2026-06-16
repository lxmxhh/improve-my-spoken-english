# Kokoro Local TTS MVP

This branch adds a fully local TTS provider for `/api/tts-say`:

```bash
TTS_PROVIDER=kokoro npm run dev -- -p 6688
```

The frontend does not need to change. Existing calls to `/api/tts-say` will use Kokoro when `TTS_PROVIDER=kokoro`.

The first uncached sentence can take around 10-20 seconds while Python, PyTorch, and Kokoro initialize. Repeated sentences are served from `data/tts-cache` and should return quickly. This directory is ignored by Git and survives Next.js rebuilds.

The session warmup screen pre-generates only the first coach line before enabling `I'm Ready`. When the learner reaches an answer screen, the app pre-generates the current reference answer and the next coach line in the background, so playback should hit cached audio without blocking topic generation.

## Local dependencies

Install Kokoro and audio dependencies in the Python environment used by the Next.js server:

```bash
/opt/homebrew/bin/python3.12 -m venv .venv-kokoro
.venv-kokoro/bin/python -m pip install "kokoro>=0.7.16" soundfile numpy
```

Kokoro also needs `espeak-ng` for English G2P/fallback support:

```bash
brew install espeak-ng
```

Optional environment variables:

```bash
KOKORO_PYTHON=.venv-kokoro/bin/python
KOKORO_VOICE=af_heart
KOKORO_LANG=a
KOKORO_SPEED=1
KOKORO_TIMEOUT_MS=30000
```

## Smoke test

Start the app with `TTS_PROVIDER=kokoro`, then pre-generate multiple coach lines:

```bash
curl -sS \
  -X POST http://localhost:6688/api/tts-prewarm \
  -H 'Content-Type: application/json' \
  -d '{"texts":["Batch prewarm should prepare every coach sentence before practice starts.","The learner should hear cached audio immediately during the conversation."]}'
```

Then request one of those lines as playable audio:

```bash
curl -sS \
  -X POST http://localhost:6688/api/tts-say \
  -H 'Content-Type: application/json' \
  -d '{"text":"Batch prewarm should prepare every coach sentence before practice starts."}' \
  --output /tmp/kokoro-tts-test.wav
```

The response should be a WAV file. If dependencies are missing, the API returns HTTP 503 with the local Kokoro error instead of falling back to a cloud provider.

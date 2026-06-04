/**
 * Pick the best available English voice.
 * Prefers natural-sounding en-US voices over novelty/compact ones.
 * Necessary because the OS default may be a non-English voice (e.g. macOS 婷婷).
 */
const PREFERRED_VOICES = [
  // macOS standard voices
  "Samantha", "Alex", "Ava", "Nicky", "Susan",
  "Allison", "Victoria", "Karen", "Moira", "Tessa",
  // Chrome built-in fallback
  "Google US English",
  "Google UK English Female",
  "Google UK English Male",
];

const DEBUG_TTS = process.env.NEXT_PUBLIC_DEBUG_TTS === "1";

export function pickEnglishVoice(availableVoices?: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = availableVoices ?? window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // 1. Preferred names (macOS standard first, then Chrome built-in fallback)
  for (const name of PREFERRED_VOICES) {
    const v = voices.find((v) => v.name === name);
    if (v) return v;
  }
  // 2. Any en-US local voice
  return (
    voices.find((v) => v.lang === "en-US" && v.localService) ??
    voices.find((v) => v.lang === "en-US") ??
    voices.find((v) => v.lang.startsWith("en") && v.localService) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}

export function waitForSpeechVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve([]);
  }

  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  if (voices.length > 0) return Promise.resolve(voices);

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      synth.removeEventListener("voiceschanged", finish);
      resolve(synth.getVoices());
    };

    const timeoutId = setTimeout(finish, timeoutMs);
    synth.addEventListener("voiceschanged", finish);
  });
}

interface ServerSpeechOptions {
  signal?: AbortSignal;
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("TTS playback was aborted", "AbortError");
  }
  const error = new Error("TTS playback was aborted");
  error.name = "AbortError";
  return error;
}

export async function playServerSpeechAudio(
  text: string,
  voice = "Samantha",
  options: ServerSpeechOptions = {}
): Promise<void> {
  if (options.signal?.aborted) throw createAbortError();

  if (DEBUG_TTS) console.log("[TTS] fetching /api/tts-say for:", text.slice(0, 40));
  const response = await fetch("/api/tts-say", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
    signal: options.signal,
  });

  if (options.signal?.aborted) throw createAbortError();
  if (DEBUG_TTS) console.log("[TTS] /api/tts-say status:", response.status);
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`tts-say ${response.status}: ${err}`);
  }

  const blob = await response.blob();
  if (DEBUG_TTS) console.log("[TTS] blob size:", blob.size, "type:", blob.type);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = "auto";

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };

    const onAbort = () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      settle(() => reject(createAbortError()));
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });
    audio.onended = () => {
      if (DEBUG_TTS) console.log("[TTS] audio ended");
      settle(resolve);
    };
    audio.onerror = (e) => {
      console.error("[TTS] audio.onerror:", e);
      settle(() => reject(new Error("Failed to play audio")));
    };
    audio.play()
      .then(() => {
        if (DEBUG_TTS) console.log("[TTS] audio.play() ok");
      })
      .catch((e) => {
        console.error("[TTS] audio.play() rejected:", e);
        settle(() => reject(e));
      });
  }).finally(() => {
    URL.revokeObjectURL(url);
  });
}

export const playMacSpeechAudio = playServerSpeechAudio;

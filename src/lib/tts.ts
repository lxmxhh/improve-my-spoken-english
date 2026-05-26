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

export function pickEnglishVoice(availableVoices?: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = availableVoices ?? window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // 1. Preferred names (Chrome built-in first, then macOS standard)
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

export async function playMacSpeechAudio(text: string, voice = "Samantha"): Promise<void> {
  console.log("[TTS] fetching /api/tts-say for:", text.slice(0, 40));
  const response = await fetch("/api/tts-say", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });

  console.log("[TTS] /api/tts-say status:", response.status);
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`tts-say ${response.status}: ${err}`);
  }

  const blob = await response.blob();
  console.log("[TTS] blob size:", blob.size, "type:", blob.type);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => { console.log("[TTS] audio ended"); resolve(); };
    audio.onerror = (e) => {
      console.error("[TTS] audio.onerror:", e);
      reject(new Error("Failed to play audio"));
    };
    audio.play()
      .then(() => console.log("[TTS] audio.play() ok"))
      .catch((e) => { console.error("[TTS] audio.play() rejected:", e); reject(e); });
  }).finally(() => {
    URL.revokeObjectURL(url);
  });
}

import type { PronunciationCoachFeedback } from "./types";

/**
 * Practice (free-expression) fallback: coach the learner's OWN sentence, never
 * grade it against a fixed model answer.
 */
export function freeFallbackFeedback(transcript: string): PronunciationCoachFeedback {
  const said = transcript.trim();
  if (!said) {
    return {
      summary: "I didn't catch that — give it another go.",
      tips: [{
        type: "naturalness",
        advice: "Say a full sentence answering the question in your own words.",
        practiceText: "Let me think… I usually…",
      }],
      retryPrompt: "Take your time and answer in one full sentence.",
    };
  }
  return {
    summary: "Nice — that answers the question. Here's one small upgrade.",
    tips: [{
      type: "naturalness",
      advice: "Say your sentence again as one smooth phrase, keeping the small words light.",
      practiceText: said,
    }],
    retryPrompt: "Say it once more, a little more smoothly and confidently.",
  };
}

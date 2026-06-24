import type { CoachPromptAnchor, Script, ScriptTurn } from "./types";

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "it", "in", "on", "at", "to", "of", "and",
  "for", "do", "you", "i", "my", "your", "we", "that", "this", "was",
  "are", "be", "have", "has", "with", "about", "but", "so", "as", "up",
  "not", "from", "or", "by", "if", "how", "what", "when", "where", "who",
  "im", "ive", "its", "me", "they", "them", "he", "she", "his", "her",
  "would", "could", "should", "will", "can", "just", "really", "very",
  "usually", "around", "then", "there", "here", "out", "into", "than",
]);

/** Extract up to `limit` content words from a sentence, in order of appearance. */
export function extractContentWords(text: string, limit = 3): string[] {
  const seen = new Set<string>();
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  const result: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    result.push(w);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Build a rule-based anchor from a user reference line (and the preceding coach
 * line, if any). Used when the LLM did not provide one, or when there is no AI
 * key. Guarantees a non-empty sampleAnswer and at least one keyPoint.
 */
export function buildFallbackAnchor(userText: string, coachText?: string): CoachPromptAnchor {
  const sampleAnswer = userText.trim();
  const contentWords = extractContentWords(sampleAnswer, 3);
  const keyPoints = contentWords.length > 0
    ? contentWords.map((w) => `mention "${w}"`)
    : ["respond in a full sentence"];

  const askedQuestion = (coachText ?? "").includes("?");
  const intent = askedQuestion
    ? "answer the coach's question in your own words"
    : "respond to the coach in your own words";

  return { intent, keyPoints, sampleAnswer };
}

/**
 * Ensure every user turn carries an anchor. LLM-provided anchors are kept;
 * gaps are filled with rule-based anchors. Coach turns are untouched.
 */
export function ensureAnchors(script: Script): Script {
  let previousCoachLine = "";
  const turns: ScriptTurn[] = script.turns.map((turn) => {
    if (turn.speaker === "coach") {
      previousCoachLine = turn.text;
      return turn;
    }
    if (turn.anchor && turn.anchor.sampleAnswer?.trim() && turn.anchor.keyPoints?.length > 0) {
      return turn;
    }
    return {
      ...turn,
      anchor: buildFallbackAnchor(turn.hint ?? turn.text, previousCoachLine),
    };
  });
  return { ...script, turns };
}

import type {
  ConnectedSpeechAnalysis,
  ConnectedSpeechGuide,
  ConnectedSpeechLinkType,
  IntonationContour,
  PronunciationAssessment,
} from "@/lib/types";

const WEAK_FORM_MAP: Record<string, { weakForm: string; strongForm: string }> = {
  a: { weakForm: "/uh/", strongForm: "/ay/" },
  an: { weakForm: "/uhn/", strongForm: "/an/" },
  and: { weakForm: "/uhn/ or /n/", strongForm: "/and/" },
  are: { weakForm: "/er/", strongForm: "/ar/" },
  as: { weakForm: "/uhz/", strongForm: "/az/" },
  at: { weakForm: "/uht/", strongForm: "/at/" },
  can: { weakForm: "/kuhn/", strongForm: "/kan/" },
  do: { weakForm: "/duh/", strongForm: "/doo/" },
  does: { weakForm: "/duhz/", strongForm: "/duz/" },
  for: { weakForm: "/fer/", strongForm: "/for/" },
  from: { weakForm: "/frum/", strongForm: "/from/" },
  have: { weakForm: "/uv/ or /hav/", strongForm: "/hav/" },
  of: { weakForm: "/uhv/ or /uh/", strongForm: "/ov/" },
  or: { weakForm: "/er/", strongForm: "/or/" },
  should: { weakForm: "/shuhd/", strongForm: "/should/" },
  some: { weakForm: "/sum/", strongForm: "/some/" },
  than: { weakForm: "/thuhn/", strongForm: "/than/" },
  that: { weakForm: "/thuht/", strongForm: "/that/" },
  the: { weakForm: "/thuh/ or /thee/", strongForm: "/thee/" },
  to: { weakForm: "/tuh/", strongForm: "/too/" },
  was: { weakForm: "/wuhz/", strongForm: "/waz/" },
  were: { weakForm: "/wer/", strongForm: "/wur/" },
  would: { weakForm: "/wuhd/", strongForm: "/would/" },
  you: { weakForm: "/yuh/", strongForm: "/you/" },
};

const CONTENT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "him",
  "his",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "she",
  "should",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "up",
  "us",
  "was",
  "we",
  "were",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

const VOWELS = new Set(["a", "e", "i", "o", "u"]);
const LINK_TYPES = new Set<ConnectedSpeechLinkType>([
  "consonant-vowel",
  "vowel-vowel",
  "same-consonant",
  "reduction",
]);
const CONTOURS = new Set<IntonationContour>(["falling", "rising", "fall-rise", "rise-fall"]);

interface Token {
  original: string;
  normalized: string;
}

function tokenize(text: string): Token[] {
  return text
    .match(/[A-Za-z']+/g)
    ?.map((word) => ({
      original: word.replace(/^'+|'+$/g, ""),
      normalized: normalizeWord(word),
    }))
    .filter((word) => word.normalized.length > 0) ?? [];
}

function normalizeWord(word: string) {
  return word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
}

function startsWithVowelSound(word: string) {
  return VOWELS.has(word[0] ?? "");
}

function endsWithVowelSound(word: string) {
  return VOWELS.has(word[word.length - 1] ?? "");
}

function getLinkType(first: string, second: string): ConnectedSpeechLinkType | null {
  if (!first || !second) return null;
  if (first.includes("'") || second.includes("'")) return null;
  if ((first === "want" || first === "going" || first === "have" || first === "has") && second === "to") {
    return "reduction";
  }
  if (!endsWithVowelSound(first) && startsWithVowelSound(second)) return "consonant-vowel";
  if (endsWithVowelSound(first) && startsWithVowelSound(second)) return "vowel-vowel";
  if (first[first.length - 1] === second[0]) return "same-consonant";
  return null;
}

function buildCue(words: [Token, Token], type: ConnectedSpeechLinkType) {
  const text = `${words[0].original} ${words[1].original}`;
  if (type === "reduction" && words[0].normalized === "want" && words[1].normalized === "to") return "wanna";
  if (type === "reduction" && words[0].normalized === "going" && words[1].normalized === "to") return "gonna";
  if (type === "reduction" && words[1].normalized === "to") return `${words[0].original}-tuh`;
  return text.replace(/\s+/g, "-");
}

function inferIntonation(text: string, focusWords: ConnectedSpeechGuide["focusWords"]): ConnectedSpeechGuide["intonation"] {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const tonalWord = focusWords[focusWords.length - 1]?.word;

  if (trimmed.endsWith("?")) {
    const contour: IntonationContour = /^(what|where|when|why|who|how)\b/.test(lower)
      ? "falling"
      : "rising";
    return {
      contour,
      tonalWord,
      reason: contour === "rising"
        ? "Use a rising ending for a yes/no question."
        : "Use a falling ending for an information question.",
    };
  }

  return {
    contour: "falling",
    tonalWord,
    reason: "Use a falling ending to sound clear and complete.",
  };
}

function cleanText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/\s+/g, " ").trim() || fallback;
}

export function createFallbackConnectedSpeechGuide(text: string): ConnectedSpeechGuide {
  const tokens = tokenize(text);
  const contentTokens = tokens.filter((token) => (
    token.normalized.length > 2 && !CONTENT_STOP_WORDS.has(token.normalized)
  ));

  const focusWords = contentTokens.slice(0, 3).map((token) => ({
    word: token.original,
    reason: "This word carries the main information.",
  }));

  const weakForms = tokens
    .filter((token, index) => (
      index < tokens.length - 1 && Boolean(WEAK_FORM_MAP[token.normalized])
    ))
    .slice(0, 3)
    .map((token) => ({
      word: token.original,
      weakForm: WEAK_FORM_MAP[token.normalized].weakForm,
      strongForm: WEAK_FORM_MAP[token.normalized].strongForm,
      reason: "Keep this function word light so the focus words stand out.",
    }));

  const linkedPhrases: ConnectedSpeechGuide["linkedPhrases"] = [];
  for (let i = 0; i < tokens.length - 1 && linkedPhrases.length < 3; i += 1) {
    const first = tokens[i];
    const second = tokens[i + 1];
    const type = getLinkType(first.normalized, second.normalized);
    if (!type) continue;
    linkedPhrases.push({
      text: `${first.original} ${second.original}`,
      cue: buildCue([first, second], type),
      type,
    });
  }

  const intonation = inferIntonation(text, focusWords);
  const primaryFocus = focusWords.map((item) => item.word).join(" / ") || "the main idea";

  return {
    text,
    focusWords,
    weakForms,
    linkedPhrases,
    intonation,
    teachingPrompt: `Make ${primaryFocus} stand out, keep small words light, and speak the phrase as one flow.`,
  };
}

export function normalizeConnectedSpeechGuide(value: unknown, fallbackText: string): ConnectedSpeechGuide | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ConnectedSpeechGuide>;

  const text = cleanText(candidate.text, fallbackText);
  const fallback = createFallbackConnectedSpeechGuide(text);

  const focusWords = Array.isArray(candidate.focusWords)
    ? candidate.focusWords
        .map((item) => ({
          word: cleanText((item as { word?: unknown }).word),
          reason: cleanText((item as { reason?: unknown }).reason, "This word carries the main information."),
        }))
        .filter((item) => item.word)
        .slice(0, 4)
    : fallback.focusWords;

  const weakForms = Array.isArray(candidate.weakForms)
    ? candidate.weakForms
        .map((item) => ({
          word: cleanText((item as { word?: unknown }).word),
          weakForm: cleanText((item as { weakForm?: unknown }).weakForm),
          strongForm: cleanText((item as { strongForm?: unknown }).strongForm),
          reason: cleanText((item as { reason?: unknown }).reason, "Keep this function word light."),
        }))
        .filter((item) => item.word && item.weakForm)
        .slice(0, 4)
    : fallback.weakForms;

  const linkedPhrases = Array.isArray(candidate.linkedPhrases)
    ? candidate.linkedPhrases
        .map((item) => {
          const type = (item as { type?: unknown }).type;
          return {
            text: cleanText((item as { text?: unknown }).text),
            cue: cleanText((item as { cue?: unknown }).cue),
            type: LINK_TYPES.has(type as ConnectedSpeechLinkType)
              ? type as ConnectedSpeechLinkType
              : "consonant-vowel",
          };
        })
        .filter((item) => item.text && item.cue)
        .slice(0, 4)
    : fallback.linkedPhrases;

  const rawIntonation = candidate.intonation && typeof candidate.intonation === "object"
    ? candidate.intonation as Partial<ConnectedSpeechGuide["intonation"]>
    : null;
  const contour = rawIntonation?.contour;

  return {
    text,
    focusWords: focusWords.length ? focusWords : fallback.focusWords,
    weakForms: weakForms.length ? weakForms : fallback.weakForms,
    linkedPhrases: linkedPhrases.length ? linkedPhrases : fallback.linkedPhrases,
    intonation: {
      contour: CONTOURS.has(contour as IntonationContour)
        ? contour as IntonationContour
        : fallback.intonation.contour,
      tonalWord: cleanText(rawIntonation?.tonalWord, fallback.intonation.tonalWord),
      reason: cleanText(rawIntonation?.reason, fallback.intonation.reason),
    },
    teachingPrompt: cleanText(candidate.teachingPrompt, fallback.teachingPrompt),
  };
}

export function analyzeConnectedSpeech(
  assessment: PronunciationAssessment,
  guide?: ConnectedSpeechGuide
): ConnectedSpeechAnalysis {
  const wordError = assessment.words?.find((word) => (
    Boolean(word.errorType && word.errorType !== "None") ||
    typeof word.accuracyScore === "number" && word.accuracyScore < 75
  ));

  if (wordError && assessment.accuracyScore < 80) {
    return {
      topIssue: "pronunciation",
      priorityReason: `The word "${wordError.word}" needs clearer pronunciation first.`,
      suggestedPracticeText: wordError.word,
    };
  }

  if (assessment.completenessScore < 80) {
    return {
      topIssue: "pronunciation",
      priorityReason: "Some words may be missing, so repeat the full line first.",
      suggestedPracticeText: assessment.transcript || guide?.text,
    };
  }

  if (assessment.fluencyScore < 75) {
    const phrase = guide?.linkedPhrases[0];
    return {
      topIssue: phrase ? "linking" : "rhythm",
      priorityReason: phrase
        ? `The phrase "${phrase.text}" should move as one sound group.`
        : "The sentence needs a steadier rhythm.",
      suggestedPracticeText: phrase?.text || guide?.text || assessment.transcript,
    };
  }

  if (guide?.weakForms[0]) {
    return {
      topIssue: "weak-forms",
      priorityReason: `Keep "${guide.weakForms[0].word}" light so the focus words stand out.`,
      suggestedPracticeText: guide.text,
    };
  }

  return {
    topIssue: "intonation",
    priorityReason: guide?.intonation.reason || "Finish with an intonation pattern that matches your meaning.",
    suggestedPracticeText: guide?.text || assessment.transcript,
  };
}

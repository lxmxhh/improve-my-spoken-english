import type { CoachPromptAnchor } from "./types";

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Word overlap ratio: intersection / union of unique words */
export function wordOverlap(a: string, b: string): number {
  const setA = new Set(normalize(a).split(" ").filter(Boolean));
  const setB = new Set(normalize(b).split(" ").filter(Boolean));
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Cheap, network-free verdict.
 * - false: no usable speech (empty)
 * - true:  clearly matches the reference / model answer
 * - null:  needs semantic (no anchor) or direction (anchor) judging
 */
export function quickVerdict(expected: string, actual: string, anchor?: CoachPromptAnchor): boolean | null {
  if (!actual || actual.trim().length === 0) return false;

  const reference = (anchor?.sampleAnswer ?? expected ?? "").trim();
  if (reference) {
    if (normalize(actual) === normalize(reference)) return true;
    if (wordOverlap(actual, reference) >= 0.8) return true;
  }
  return null;
}

/** Interpret the model's yes/no answer, with a lenient fail-open default. */
export function interpretAnswer(
  answer: string,
  opts: { actual: string; reference: string; hasAnchor: boolean }
): boolean {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) {
    // Empty model reply: in direction mode we cannot use overlap (valid answers
    // legitimately differ from the model answer), so fail open. Otherwise keep
    // the historical word-overlap fallback.
    return opts.hasAnchor ? true : wordOverlap(opts.actual, opts.reference) >= 0.6;
  }
  return normalized.startsWith("yes");
}

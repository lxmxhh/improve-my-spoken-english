export const SPEED_ROUND_REPS = 3;

const MIN_BUDGET_MS = 4_000;
const MAX_BUDGET_MS = 18_000;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Time budgets (ms) for the 4-3-2 style speed round: say the same target three
 * times, each round a little tighter, to push toward automaticity. Budgets are
 * derived from the target length and shrink monotonically.
 */
export function speedRoundBudgetsMs(text: string): number[] {
  const words = countWords(text) || 1;
  const base = clamp(words * 600 + 2_500, MIN_BUDGET_MS, MAX_BUDGET_MS);
  const factors = [1, 0.8, 0.65];
  return factors.map((f) => clamp(Math.round(base * f), MIN_BUDGET_MS, MAX_BUDGET_MS));
}

/**
 * Improvement between the first and last attempt, in ms.
 * Positive means the learner got faster.
 */
export function improvementMs(durationsMs: number[]): number {
  if (durationsMs.length < 2) return 0;
  return durationsMs[0] - durationsMs[durationsMs.length - 1];
}

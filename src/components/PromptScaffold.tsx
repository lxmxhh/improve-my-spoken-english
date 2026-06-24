"use client";

import type { CoachPromptAnchor } from "@/lib/types";

interface PromptScaffoldProps {
  anchor: CoachPromptAnchor;
  /** 0 = intent only, 1 = + key points, 2 = full model answer (rendered by parent). */
  tier: number;
  onHint: () => void;
}

export default function PromptScaffold({ anchor, tier, onHint }: PromptScaffoldProps) {
  return (
    <div className="w-full rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 flex flex-col gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-500">Your turn — say it your way</p>
        <p className="mt-1 text-gray-800 font-medium leading-relaxed">🎯 {anchor.intent}</p>
      </div>

      {tier >= 1 && anchor.keyPoints.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-amber-500">Try to include:</p>
          <div className="flex flex-wrap gap-2">
            {anchor.keyPoints.map((kp, i) => (
              <span key={i} className="bg-amber-100 text-amber-700 text-sm px-3 py-1 rounded-full">
                {kp}
              </span>
            ))}
          </div>
        </div>
      )}

      {tier < 2 && (
        <button
          type="button"
          onClick={onHint}
          className="self-start text-sm font-medium text-amber-600 hover:text-amber-700 transition-colors"
        >
          {tier === 0 ? "💡 Show key points" : "💡 Show a model answer"}
        </button>
      )}
    </div>
  );
}

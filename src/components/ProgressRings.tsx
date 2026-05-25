"use client";

interface ProgressRingsProps {
  completed: number; // 0–3
  streak: number;
}

export default function ProgressRings({ completed, streak }: ProgressRingsProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
              i < completed
                ? "bg-emerald-500 border-emerald-500 text-white"
                : "border-gray-300 text-gray-300"
            }`}
          >
            {i < completed ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <span className="text-xs font-bold">{i + 1}</span>
            )}
          </div>
        ))}
      </div>
      {streak > 0 && (
        <p className="text-sm text-amber-600 font-semibold">
          🔥 {streak} day streak
        </p>
      )}
    </div>
  );
}

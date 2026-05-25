"use client";

interface SessionSummaryProps {
  summary: string;
  passedLines: number;
  totalLines: number;
  onNext: () => void;
  onDone: () => void;
}

export default function SessionSummary({
  summary,
  passedLines,
  totalLines,
  onNext,
  onDone,
}: SessionSummaryProps) {
  const percent = totalLines > 0 ? Math.round((passedLines / totalLines) * 100) : 0;

  return (
    <div className="flex flex-col gap-6 max-w-lg mx-auto">
      <div className="text-center">
        <div className="text-5xl font-bold text-emerald-600">{percent}%</div>
        <p className="text-gray-600 mt-1">
          You nailed <span className="font-semibold text-gray-800">{passedLines}</span> out of{" "}
          <span className="font-semibold text-gray-800">{totalLines}</span> lines
        </p>
      </div>

      <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
        <h3 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">
          Coach&apos;s Feedback
        </h3>
        <p className="text-gray-700 leading-relaxed whitespace-pre-wrap text-sm">{summary}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onNext}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          Start Next Topic
        </button>
        <button
          onClick={onDone}
          className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          That&apos;s Enough for Today
        </button>
      </div>
    </div>
  );
}

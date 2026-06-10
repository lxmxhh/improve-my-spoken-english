import type { ConnectedSpeechGuide } from "@/lib/types";

interface FlowGuideProps {
  guide?: ConnectedSpeechGuide | null;
  loading?: boolean;
}

function joinWords(items: { word: string }[]) {
  return items.map((item) => item.word).join(" / ");
}

function contourLabel(contour: ConnectedSpeechGuide["intonation"]["contour"]) {
  switch (contour) {
    case "rising":
      return "Rising";
    case "fall-rise":
      return "Fall-rise";
    case "rise-fall":
      return "Rise-fall";
    case "falling":
    default:
      return "Falling";
  }
}

export default function FlowGuide({ guide, loading = false }: FlowGuideProps) {
  if (loading && !guide) {
    return (
      <div className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Flow Coach
          </p>
          <span className="h-3.5 w-3.5 rounded-full border-2 border-slate-300 border-t-transparent animate-spin" />
        </div>
        <div className="mt-3 space-y-2">
          <div className="h-3 w-2/3 rounded bg-slate-100" />
          <div className="h-3 w-1/2 rounded bg-slate-100" />
        </div>
      </div>
    );
  }

  if (!guide) return null;

  const focusText = joinWords(guide.focusWords);
  const weakText = guide.weakForms
    .map((item) => `${item.word} -> ${item.weakForm}`)
    .join(", ");
  const linkText = guide.linkedPhrases
    .map((item) => `${item.text} -> ${item.cue}`)
    .join(", ");
  const toneText = `${contourLabel(guide.intonation.contour)}${guide.intonation.tonalWord ? ` on ${guide.intonation.tonalWord}` : ""}`;

  return (
    <div className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Flow Coach
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {guide.teachingPrompt}
          </p>
        </div>
        {loading && (
          <span className="mt-1 h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-slate-300 border-t-transparent animate-spin" />
        )}
      </div>

      <div className="mt-3 grid gap-2 text-xs text-slate-700">
        {focusText && (
          <div className="flex gap-2">
            <span className="w-12 flex-shrink-0 font-semibold text-slate-400">Focus</span>
            <span className="font-medium">{focusText}</span>
          </div>
        )}
        {weakText && (
          <div className="flex gap-2">
            <span className="w-12 flex-shrink-0 font-semibold text-slate-400">Weak</span>
            <span>{weakText}</span>
          </div>
        )}
        {linkText && (
          <div className="flex gap-2">
            <span className="w-12 flex-shrink-0 font-semibold text-slate-400">Link</span>
            <span>{linkText}</span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="w-12 flex-shrink-0 font-semibold text-slate-400">Tone</span>
          <span>{toneText}</span>
        </div>
      </div>
    </div>
  );
}

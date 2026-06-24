"use client";

interface SparklineProps {
  values: number[];
  /** Fixed value range; defaults to the data's own min/max with padding. */
  min?: number;
  max?: number;
  colorClass?: string; // tailwind text-* class drives stroke via currentColor
  height?: number;
}

export default function Sparkline({
  values,
  min,
  max,
  colorClass = "text-blue-500",
  height = 48,
}: SparklineProps) {
  const width = 220;
  const pad = 4;

  if (values.length === 0) return null;

  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;

  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - lo) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full ${colorClass}`}
      preserveAspectRatio="none"
      role="img"
    >
      {points.length > 1 && (
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <circle cx={last[0]} cy={last[1]} r={3} fill="currentColor" />
    </svg>
  );
}

/**
 * 도넛 차트 — 구성비.
 *
 * SVG 원호를 stroke-dasharray로 잘라 그린다. 라이브러리·클라이언트 JS 없이
 * 서버 렌더된다. 값이 전부 0이면 회색 링만 남는다.
 */
export type DonutSlice = {
  label: string;
  value: number;
  /** CSS 색상값 — 디자인 토큰의 색을 그대로 넘긴다 */
  color: string;
};

const SIZE = 120;
const STROKE = 18;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Donut({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[];
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  let offset = 0;
  const drawn = total
    ? slices
        .filter((s) => s.value > 0)
        .map((s) => {
          const length = (s.value / total) * CIRCUMFERENCE;
          const seg = { ...s, length, offset };
          offset += length;
          return seg;
        })
    : [];

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={
          total
            ? slices.map((s) => `${s.label} ${s.value}`).join(", ")
            : "데이터 없음"
        }
        className="shrink-0"
      >
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="hsl(var(--secondary))"
            strokeWidth={STROKE}
          />
          {drawn.map((s) => (
            <circle
              key={s.label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              strokeDasharray={`${s.length} ${CIRCUMFERENCE - s.length}`}
              strokeDashoffset={-s.offset}
            />
          ))}
        </g>
        {centerValue && (
          <text
            x={SIZE / 2}
            y={SIZE / 2 - 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-foreground text-lg font-extrabold"
          >
            {centerValue}
          </text>
        )}
        {centerLabel && (
          <text
            x={SIZE / 2}
            y={SIZE / 2 + 16}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {centerLabel}
          </text>
        )}
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="truncate">{s.label}</span>
            <span className="ml-auto shrink-0 tabular-nums font-medium">
              {s.value.toLocaleString("ko-KR")}
            </span>
            <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
              {total ? `${Math.round((s.value / total) * 100)}%` : "-"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

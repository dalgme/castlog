import { cn } from "@/lib/utils";

/**
 * 가로 막대 목록 — 항목별 크기 비교.
 *
 * 차트 라이브러리를 새로 들이지 않는다(기술 스택 고정, CLAUDE.md §2).
 * 막대는 div 폭으로 그리므로 서버 컴포넌트에서 그대로 렌더되고 JS가 필요 없다.
 */
export type BarItem = {
  label: string;
  value: number;
  /** 값 대신 보여줄 문구 (금액 등) */
  display?: string;
  /** 막대 색 — 기본은 브랜드색 */
  tone?: "brand" | "navy" | "amber" | "gray";
};

const TONE_CLASS: Record<NonNullable<BarItem["tone"]>, string> = {
  brand: "bg-brand",
  navy: "bg-brand-navy",
  amber: "bg-amber-500",
  gray: "bg-muted-foreground/40",
};

export function BarList({
  items,
  emptyText = "데이터가 없습니다.",
  /** 100% 기준값. 없으면 최댓값 기준 상대 비교 */
  max,
}: {
  items: BarItem[];
  emptyText?: string;
  max?: number;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const ceiling = Math.max(max ?? 0, ...items.map((i) => i.value), 1);

  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => {
        const pct = Math.min(100, Math.round((item.value / ceiling) * 100));
        return (
          <li key={`${item.label}-${i}`}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium">{item.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {item.display ?? item.value.toLocaleString("ko-KR")}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn("h-full rounded-full", TONE_CLASS[item.tone ?? "brand"])}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

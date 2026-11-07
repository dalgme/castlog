import { Fragment } from "react";

import { cn } from "@/lib/utils";

/**
 * 섭외 후보 리스트 문서 (기획 승인 2026-11-07 — 2단계).
 * 미리보기·내부 검토 화면이 같은 모양을 쓴다. 3단계 발주처 웹문서는 이 부품에
 * 연락처·단가를 뺀 변형(showFees=false)으로 얹는다. 서버·클라이언트 어디서든 렌더된다.
 */
export type CandidateDocEntry = {
  id: string;
  rank: number;
  code: string;
  expertName: string;
  feeText: string | null;
  memos: string[];
  memoCount: number;
  /** 행 아래에 끼워 넣을 것 (검토 의견·버튼) */
  extra?: React.ReactNode;
};

export type CandidateDocSlot = {
  slotId: string;
  sessionLabel: string;
  roleLabel: string | null;
  requiredCount: number;
  entries: CandidateDocEntry[];
};

export function CandidateListDocument({
  title,
  subtitle,
  slots,
  showFees = true,
  showMemos = true,
  compact = false,
  className,
}: {
  title: string;
  subtitle?: string | null;
  slots: CandidateDocSlot[];
  showFees?: boolean;
  showMemos?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="border-b pb-2">
        <h3 className={cn("font-extrabold", compact ? "text-base" : "text-lg")}>{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {slots.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">후보가 올라간 세션이 없습니다.</p>}
      {slots.map((s) => (
        <section key={s.slotId} className="overflow-hidden rounded-lg border">
          <header className="flex flex-wrap items-center gap-2 bg-indigo-50 px-3 py-2 text-sm">
            <span className="font-bold text-indigo-900">{s.sessionLabel}</span>
            {s.roleLabel && <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{s.roleLabel}</span>}
            <span className="ml-auto text-[11px] text-indigo-800">필요인원 {s.requiredCount}명 · 후보 {s.entries.length}명</span>
          </header>
          {s.entries.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">이 세션에는 아직 후보가 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-[11px] text-muted-foreground">
                <tr>
                  <th className="w-16 px-2 py-1.5 text-left font-semibold">순위</th>
                  <th className="w-28 px-2 py-1.5 text-left font-semibold">코드넘버</th>
                  <th className="px-2 py-1.5 text-left font-semibold">후보</th>
                  {showFees && <th className="w-40 px-2 py-1.5 text-right font-semibold">의뢰비용</th>}
                  {showMemos && <th className="px-2 py-1.5 text-left font-semibold">자격메모</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {s.entries.map((e, i) => (
                  <Fragment key={e.id}>
                    <tr className={i % 2 === 1 ? "bg-secondary/30" : undefined}>
                      <td className="px-2 py-2 align-top">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", i < s.requiredCount ? "bg-brand text-white" : "bg-secondary text-muted-foreground")}>
                          {e.rank}순위{i < s.requiredCount ? " ★" : ""}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-top font-mono text-xs font-semibold">{e.code}</td>
                      <td className="px-2 py-2 align-top font-medium">{e.expertName}</td>
                      {showFees && <td className="px-2 py-2 text-right align-top tabular-nums">{e.feeText ?? <span className="text-muted-foreground">미정</span>}</td>}
                      {showMemos && (
                        <td className="px-2 py-2 align-top">
                          {e.memos.length === 0 ? (
                            <span className="text-xs text-muted-foreground">자격메모 없음 ({e.memoCount}개)</span>
                          ) : (
                            <ol className="list-decimal space-y-0.5 pl-4 text-xs">
                              {e.memos.map((m, j) => (
                                <li key={j} className="whitespace-pre-wrap">{m}</li>
                              ))}
                            </ol>
                          )}
                        </td>
                      )}
                    </tr>
                    {e.extra && (
                      <tr className={i % 2 === 1 ? "bg-secondary/30" : undefined}>
                        <td colSpan={3 + (showFees ? 1 : 0) + (showMemos ? 1 : 0)} className="px-2 pb-2">
                          {e.extra}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

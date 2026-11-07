import { cn } from "@/lib/utils";
import type { ClientDoc } from "@/lib/integrations/client-review-shared";

/**
 * 발주처용 섭외 후보 리스트 문서 (기획 승인 2026-11-07 — 3단계).
 * 후보의 공개 프로필(이름·전문분야·소속·직위·경력·지역·강의분야)만 보인다 — 연락처·단가·이력서 없음.
 * 미리보기(탭)와 공개 웹문서(/l)가 같은 부품을 쓴다. 후보 카드 아래 slot에는 의견 입력 등을 끼운다.
 */
export function ClientReviewDocument({
  doc,
  renderCandidateExtra,
  compact = false,
  className,
}: {
  doc: ClientDoc;
  renderCandidateExtra?: (entryId: string) => React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="border-b pb-2">
        <h3 className={cn("font-extrabold", compact ? "text-base" : "text-lg")}>{doc.projectName} — 섭외 후보 리스트</h3>
        <p className="text-xs text-muted-foreground">
          {doc.clientName ? `${doc.clientName} 검토용 · ` : ""}
          {doc.tenantName ? `${doc.tenantName} 작성 · ` : ""}v{doc.revision}
        </p>
      </div>
      {doc.slots.map((s) => (
        <section key={s.slotId} className="space-y-2">
          <header className="flex flex-wrap items-center gap-2 rounded-md bg-indigo-50 px-3 py-2 text-sm">
            <span className="font-bold text-indigo-900">{s.sessionLabel}</span>
            {s.roleLabel && <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{s.roleLabel}</span>}
            <span className="ml-auto text-[11px] text-indigo-800">후보 {s.candidates.length}명</span>
          </header>
          <ul className="grid gap-2 sm:grid-cols-2">
            {s.candidates.map((c) => (
              <li key={c.entryId} className="rounded-lg border bg-white p-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">{c.rank}순위</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">
                      {c.name}
                      <span className="ml-1 font-mono text-[11px] font-normal text-muted-foreground">{c.code}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[c.organization, c.jobTitle].filter(Boolean).join(" ") || "소속 미기재"}
                      {c.careerYears !== null ? ` · 경력 ${c.careerYears}년` : ""}
                      {c.region ? ` · ${c.region}` : ""}
                    </p>
                  </div>
                </div>
                <dl className="mt-2 space-y-1 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-muted-foreground">전문분야</dt>
                    <dd className="flex-1">{c.specialty ?? "기재 없음"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-muted-foreground">강의분야</dt>
                    <dd className="flex-1">{c.expertise.length > 0 ? c.expertise.join(" · ") : "기재 없음"}</dd>
                  </div>
                </dl>
                {renderCandidateExtra && <div className="mt-2 border-t pt-2">{renderCandidateExtra(c.entryId)}</div>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

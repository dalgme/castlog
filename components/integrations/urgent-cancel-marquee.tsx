import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { UrgentCancellation } from "@/lib/integrations/urgent-cancellations";

/**
 * 긴급 취소 전광판 — 화면 맨 위를 흐르는 붉은 띠.
 *
 * 확정됐던 전문가가 갑자기 못 오는 일은 그날 안에 대체 인력을 찾아야 하는
 * 사건이다. 목록 어딘가에 조용히 쌓여 있으면 아무도 제때 못 본다. 그래서
 * 담당자뿐 아니라 그 화면을 여는 모든 임직원에게 흐르게 보여 준다.
 *
 * 애니메이션은 CSS만 쓴다(클라이언트 JS 없음). 움직임을 줄이도록 설정한
 * 사용자에게는 흐르지 않고 그대로 멈춘다 — 접근성 기본.
 */
export function UrgentCancelMarquee({
  items,
  tenantSlug,
}: {
  items: UrgentCancellation[];
  tenantSlug: string;
}) {
  if (items.length === 0) return null;

  const line = items
    .map((item) => {
      const when = new Date(item.canceledAt).toLocaleDateString("ko-KR", {
        month: "numeric",
        day: "numeric",
      });
      const where = item.projectName ? `[${item.projectName}] ` : "";
      const why = item.reason ? ` — ${item.reason}` : "";
      return `${when} ${where}${item.expertName} 님 긴급 취소${why}`;
    })
    .join("   ·   ");

  return (
    <div className="flex items-center gap-2 overflow-hidden border-b border-destructive/30 bg-destructive/10 px-4 py-1.5">
      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        긴급 취소
      </span>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {/* 같은 내용을 두 번 이어 붙여 끊김 없이 이어지게 한다 */}
        <div className="marquee-track flex w-max gap-12 whitespace-nowrap text-xs text-destructive">
          <span>{line}</span>
          <span aria-hidden>{line}</span>
        </div>
      </div>
      <Link
        href={`/${tenantSlug}/experts/cancellations`}
        className="shrink-0 text-xs font-semibold text-destructive underline-offset-2 hover:underline"
      >
        내역
      </Link>
    </div>
  );
}

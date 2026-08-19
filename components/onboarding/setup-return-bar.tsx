"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, ListChecks } from "lucide-react";

/**
 * 최초 설정 복귀 띠.
 *
 * 최초 설정 화면의 문제는 목록이 아니라 **왕복**이었다. 항목을 누르면 그 설정
 * 화면으로 떠나는데, 거기서 돌아올 길이 없다. 사용자는 사이드바를 뒤져 다시
 * 최초 설정을 찾아 들어가거나, 그냥 포기한다 — 체크리스트는 '한 번에 끝내는
 * 것'이 목적인데 한 항목마다 길을 잃으면 그 목적이 무너진다.
 *
 * 해법은 목록을 화면 안으로 밀어 넣는 것이 아니라 **돌아오는 길을 항상 열어
 * 두는 것**이다. 설정 화면들은 서로 권한 게이트가 달라(발송 위임 / 직원·설정
 * 위임 / approvals 모듈) 한 페이지로 합치면 게이트가 섞여 구멍이 난다. 그래서
 * 화면은 그대로 두고, 최초 설정에서 출발했다는 사실(`?from=setup`)만 들고
 * 다니게 한 뒤 어느 화면에서든 같은 자리에 복귀 버튼을 띄운다.
 *
 * 셸에 두므로 설정 화면을 새로 만들어도 자동으로 따라온다 — 화면마다 붙이는
 * 방식이었다면 다음에 만든 화면에서 또 길이 끊긴다.
 */
export function SetupReturnBar({ tenantSlug }: { tenantSlug: string }) {
  const params = useSearchParams();
  const pathname = usePathname();

  if (params.get("from") !== "setup") return null;
  // 최초 설정 화면 자신에게는 띄우지 않는다
  if (pathname === `/${tenantSlug}/setup`) return null;

  const item = params.get("item");

  return (
    <div className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-brand/30 bg-[#F2F6FF] px-5 py-2.5">
      <ListChecks className="h-4 w-4 shrink-0 text-brand" aria-hidden />
      <p className="min-w-0 text-sm text-[#33405A]">
        <span className="font-semibold">최초 설정</span> 진행 중
        {item ? <span className="text-muted-foreground"> · {item}</span> : null}
      </p>
      <Link
        href={`/${tenantSlug}/setup`}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-brand bg-white px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        설정 목록으로 돌아가기
      </Link>
    </div>
  );
}

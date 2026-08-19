import Link from "next/link";
import { ArrowRight, Search, CalendarCheck, FileText, Send } from "lucide-react";

import { formatKrw } from "@/lib/approvals/constants";
import { roleTypeLabel } from "@/lib/integrations/engagement-roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { SlotRow } from "./slot-table";

/**
 * 섭외 작업대 — 세션(코드넘버) 단위로 '지금 무엇을 하면 되는지'를 펼친다.
 *
 * 왜 필요한가: 섭외 절차(후보 조회 → 일정 겹침 확인 → 요청서 작성 → 발송)는
 * 코드넘버 상세 화면에 다 들어 있었지만, 그 화면으로 들어가는 문이 세션 표
 * 한구석의 코드 조각 하나뿐이었다. 절차가 있는데 보이지 않으면 없는 것과 같다.
 * 여기서 세션별로 미섭외 코드를 펼치고, 각 코드에 '전문가 조회·섭외 요청'
 * 버튼을 직접 붙인다.
 *
 * 섭외는 **코드넘버 단위**다. 프로젝트에 뭉뚱그려 섭외하지 않는다 — 어느 세션의
 * 몇 번 자리인지가 정해져야 수락서·안내문자·지급이 그 자리에 붙는다.
 */

const STEPS = [
  {
    icon: Search,
    title: "① 전문가 조회",
    body: "연결된 전문가를 이름·전문분야·지역으로 좁혀 봅니다.",
  },
  {
    icon: CalendarCheck,
    title: "② 일정 겹침 확인",
    body: "이 세션 일정과 겹치는 후보는 자동으로 표시됩니다(타사 건은 건수만).",
  },
  {
    icon: FileText,
    title: "③ 요청서 작성",
    body: "일정·역할·비용·장소는 세션에서 자동 승계되고, 사업명·주제·특기사항·회신 마감만 입력합니다.",
  },
  {
    icon: Send,
    title: "④ 섭외 요청 발송",
    body: "동의 링크가 만들어집니다. 전문가가 수락하면 수락서가 자동 생성됩니다.",
  },
] as const;

function scheduleLine(slot: SlotRow): string {
  const time =
    slot.startsTime && slot.endsTime
      ? ` ${slot.startsTime.slice(0, 5)}~${slot.endsTime.slice(0, 5)}`
      : "";
  return `${slot.slotDate}${time}`;
}

export function EngagementWorkbench({
  tenantSlug,
  projectId,
  slots,
  canManage,
  planGate,
}: {
  tenantSlug: string;
  projectId: string;
  slots: SlotRow[];
  canManage: boolean;
  /** 섭외계획 품의 게이트 — 승인 전이면 요청 자체가 막힌다 */
  planGate: { blocked: boolean; message: string };
}) {
  const openCount = slots.reduce(
    (sum, s) => sum + s.positions.filter((p) => p.status === "open").length,
    0
  );
  const totalCount = slots.reduce((sum, s) => sum + s.positions.length, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">
          전문가 섭외 진행 (미섭외 {openCount} / 전체 {totalCount})
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/${tenantSlug}/projects/${projectId}?tab=sessions`}>
            세션 계획 등록
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <li
              key={step.title}
              className="rounded-lg border bg-secondary/30 p-3"
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <step.icon className="h-3.5 w-3.5 text-brand" aria-hidden />
                {step.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>

        {/* 눌러 봤자 막히는 버튼을 그대로 두지 않는다 — 막힌 이유와 다음 행동을
            여기서 알려 준다 */}
        {planGate.blocked && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">
              섭외계획 승인 전입니다
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900">
              {planGate.message}
            </p>
            <Button asChild size="sm" variant="outline" className="mt-2">
              <Link href={`/${tenantSlug}/projects/${projectId}?tab=plan`}>
                섭외계획품의로 이동
              </Link>
            </Button>
          </div>
        )}

        {slots.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm">
            <p className="text-muted-foreground">
              아직 세션이 없습니다. 섭외는 세션의 <strong>전문가 코드넘버</strong>{" "}
              단위로 진행되므로, 먼저 세션(날짜·역할·필요인원)을 등록해야 합니다.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href={`/${tenantSlug}/projects/${projectId}?tab=sessions`}>
                세션 계획 등록으로 이동
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {slots.map((slot) => (
              <li key={slot.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold">
                    {slot.sessionName ?? roleTypeLabel(slot.roleType) ?? slot.roleType}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {scheduleLine(slot)}
                  </span>
                  {slot.locationName && (
                    <span className="text-xs text-muted-foreground">
                      {slot.locationName}
                    </span>
                  )}
                  {slot.feeAmount !== null && (
                    <span className="text-xs text-muted-foreground">
                      1인 {formatKrw(slot.feeAmount)}
                    </span>
                  )}
                </div>

                <ul className="mt-2 divide-y">
                  {slot.positions.map((p) => {
                    const isOpen = p.status === "open";
                    const isFilled = p.status === "filled";
                    return (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center gap-2 py-2 text-sm"
                      >
                        <span className="font-mono text-xs font-semibold">
                          {p.code}
                        </span>
                        <span
                          className={
                            p.expertName
                              ? "font-medium"
                              : "text-muted-foreground"
                          }
                        >
                          {p.expertName ?? "미섭외"}
                        </span>
                        <Badge
                          variant={
                            isFilled
                              ? "default"
                              : isOpen
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {isFilled
                            ? "확정"
                            : isOpen
                              ? "섭외 필요"
                              : "요청 중"}
                        </Badge>

                        <span className="ml-auto flex items-center gap-1.5">
                          {isOpen && canManage && (
                            <Button
                              asChild
                              size="sm"
                              variant={planGate.blocked ? "outline" : "default"}
                            >
                              <Link
                                href={`/${tenantSlug}/projects/${projectId}/positions/${p.id}`}
                              >
                                전문가 조회 · 섭외 요청
                                <ArrowRight className="ml-1 h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          )}
                          {isOpen && !canManage && (
                            <span className="text-xs text-muted-foreground">
                              섭외 요청은 관리자 이상만 보낼 수 있습니다
                            </span>
                          )}
                          {!isOpen && (
                            <Button asChild size="sm" variant="outline">
                              <Link
                                href={`/${tenantSlug}/projects/${projectId}/positions/${p.id}`}
                              >
                                진행 상황
                              </Link>
                            </Button>
                          )}
                          {isFilled && p.engagementId && (
                            <Button asChild size="sm" variant="ghost">
                              <Link
                                href={`/${tenantSlug}/experts/acceptances/${p.engagementId}`}
                              >
                                수락서
                              </Link>
                            </Button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

import Link from "next/link";
import { ArrowRight, Search, CalendarCheck, FileText, Send } from "lucide-react";

import { formatKrw } from "@/lib/approvals/constants";
import { roleTypeLabel } from "@/lib/integrations/engagement-roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { cn } from "@/lib/utils";
import {
  ENGAGEMENT_STAGES,
  ENGAGEMENT_STAGE_DESCRIPTIONS,
  ENGAGEMENT_STAGE_LABELS,
  ENGAGEMENT_STAGE_TONE,
  STAGE_TONE_CLASS,
  type EngagementStage,
} from "@/lib/integrations/engagement-stage";

import { EngagementCancelButton } from "@/components/integrations/engagement-cancel-button";
import { EngagementUrgentCancel } from "@/components/integrations/engagement-urgent-cancel";

import type { SlotRow } from "./slot-table";
import { PositionRequestDialog } from "./position-request-dialog";

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

export type UnlinkedEngagement = {
  id: string;
  expertName: string;
  roleDescription: string;
  feeAmount: number | null;
  status: string;
  stage: EngagementStage;
};

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
  stageByPosition,
  unlinked,
  headerActions,
}: {
  tenantSlug: string;
  projectId: string;
  slots: SlotRow[];
  canManage: boolean;
  /** 섭외계획 품의 게이트 — 승인 전이면 요청 자체가 막힌다 */
  planGate: { blocked: boolean; message: string };
  /** 코드넘버 id → 현재 진행 단계 (계획품의·섭외·수락서를 합쳐 판정한 값) */
  stageByPosition: Record<string, EngagementStage>;
  /** 코드넘버에 붙지 않은 섭외 건 (프로젝트에 직접 만든 건·나중에 붙인 건) */
  unlinked: UnlinkedEngagement[];
  /** 섭외 추가·붙이기 버튼 — 서버 컴포넌트에서 내려받는다 */
  headerActions?: React.ReactNode;
}) {
  const openCount = slots.reduce(
    (sum, s) => sum + s.positions.filter((p) => p.status === "open").length,
    0
  );
  const totalCount = slots.reduce((sum, s) => sum + s.positions.length, 0);
  // 긴급 취소로 다시 비게 된 자리 — 나머지 빈 자리와 섞이면 놓친다
  const reengageCount = slots.reduce(
    (sum, s) =>
      sum +
      s.positions.filter(
        (p) => p.status === "open" && p.canceledExpertName !== null
      ).length,
    0
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">
          전문가 섭외 진행 (미섭외 {openCount} / 전체 {totalCount})
        </CardTitle>
        <div className="flex items-center gap-2">
          {headerActions}
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${tenantSlug}/projects/${projectId}?tab=sessions`}>
              세션 계획 등록
            </Link>
          </Button>
        </div>
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

        {/* 상태 범례 — 배지 이름만으로는 '지금 무엇을 기다리는지'를 알 수 없다.
            무엇을 기다리는 단계인지까지 적어야 담당자가 다음 행동을 안다 */}
        <details className="rounded-lg border bg-secondary/20 p-3">
          <summary className="cursor-pointer text-xs font-semibold">
            섭외 상태 범례 (9단계)
          </summary>
          <ul className="mt-2 space-y-1.5">
            {ENGAGEMENT_STAGES.map((s) => (
              <li key={s} className="flex flex-wrap items-baseline gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    STAGE_TONE_CLASS[ENGAGEMENT_STAGE_TONE[s]]
                  )}
                >
                  {ENGAGEMENT_STAGE_LABELS[s]}
                </span>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {ENGAGEMENT_STAGE_DESCRIPTIONS[s]}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            ‘품의 중 · 결재 완료’는 프로젝트 단위의 섭외계획 품의 상태입니다
            (전자결재를 쓰지 않는 회사에서는 나타나지 않습니다). 그 뒤 단계는
            코드넘버 한 자리씩 따로 갑니다.
          </p>
        </details>

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

        {reengageCount > 0 && (
          <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3">
            <p className="text-sm font-bold text-amber-900">
              재섭외 필요 {reengageCount}자리
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900">
              확정됐던 전문가가 긴급 취소한 자리입니다. 아래에서 오렌지로 표시된
              자리만 다시 섭외하면 됩니다. 상급자 보고는 프로젝트 전체 명단으로
              올라가고, 그 안에서 이 자리들만 강조되어 보입니다.
            </p>
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
                    const stage = stageByPosition[p.id] ?? "assigned";
                    return (
                      <li
                        key={p.id}
                        className={cn(
                          "flex flex-wrap items-center gap-2 py-2 text-sm",
                          // 긴급 취소로 다시 비게 된 자리는 오렌지 배경으로 띄운다 —
                          // 이 자리만 다시 섭외하면 된다는 것을 한눈에 보여 준다
                          p.canceledExpertName !== null &&
                            "-mx-2 rounded-md border-l-4 border-amber-500 bg-amber-50 px-2"
                        )}
                      >
                        <span className="font-mono text-xs font-semibold">
                          {p.code}
                        </span>
                        {p.canceledExpertName !== null && (
                          <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[11px] font-bold text-destructive">
                            긴급취소 · {p.canceledExpertName}
                          </span>
                        )}
                        <span
                          className={
                            p.expertName
                              ? "font-medium"
                              : "text-muted-foreground"
                          }
                        >
                          {p.expertName ?? "미섭외"}
                        </span>
                        <span
                          title={ENGAGEMENT_STAGE_DESCRIPTIONS[stage]}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                            STAGE_TONE_CLASS[ENGAGEMENT_STAGE_TONE[stage]]
                          )}
                        >
                          {ENGAGEMENT_STAGE_LABELS[stage]}
                        </span>

                        <span className="ml-auto flex items-center gap-1.5">
                          {isOpen && canManage && (
                            <>
                              {/* 자리를 보면서 그 자리에서 보낸다 — 페이지를 옮기면
                                  어느 자리를 채우던 중이었는지 맥락이 끊긴다 */}
                              <PositionRequestDialog
                                positionId={p.id}
                                code={p.code}
                                tenantSlug={tenantSlug}
                                projectId={projectId}
                              />
                              <Button asChild size="sm" variant="ghost">
                                <Link
                                  href={`/${tenantSlug}/projects/${projectId}/positions/${p.id}`}
                                >
                                  자세히
                                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                                </Link>
                              </Button>
                            </>
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
                                상세 요청사항
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
                          {/* 취소는 이 자리에서 한다 — 별도 목록으로 빼 두면
                              같은 건이 두 곳에 나와 어느 쪽이 최신인지 헷갈린다 */}
                          {canManage &&
                            p.engagementId &&
                            stage === "requested" && (
                              <EngagementCancelButton
                                engagementId={p.engagementId}
                              />
                            )}
                          {canManage &&
                            p.engagementId &&
                            isFilled &&
                            stage !== "canceled" && (
                              <EngagementUrgentCancel
                                engagementId={p.engagementId}
                                expertName={p.expertName ?? "전문가"}
                              />
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

        {/* 코드넘버에 붙지 않은 건 — 프로젝트에 직접 만들었거나 나중에 붙인 건이다.
            세션 아래에 둘 자리가 없으니 마지막에 따로 모은다. 별도 카드로 빼면
            같은 프로젝트의 섭외가 두 목록으로 갈라진다 */}
        {unlinked.length > 0 && (
          <div className="rounded-lg border border-dashed p-3">
            <p className="text-sm font-semibold">
              코드넘버 미연결 섭외 ({unlinked.length})
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              세션 자리에 붙어 있지 않은 건입니다. 세션을 만든 뒤 코드넘버에
              연결하면 안내문자·지급이 그 자리를 따라갑니다.
            </p>
            <ul className="mt-2 divide-y">
              {unlinked.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <span className="font-medium">{e.expertName}</span>
                  <span className="text-muted-foreground">
                    {e.roleDescription}
                  </span>
                  {e.feeAmount !== null && (
                    <span className="text-xs text-muted-foreground">
                      {formatKrw(e.feeAmount)}
                    </span>
                  )}
                  <span
                    title={ENGAGEMENT_STAGE_DESCRIPTIONS[e.stage]}
                    className={cn(
                      "ml-auto rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                      STAGE_TONE_CLASS[ENGAGEMENT_STAGE_TONE[e.stage]]
                    )}
                  >
                    {ENGAGEMENT_STAGE_LABELS[e.stage]}
                  </span>
                  {e.status === "accepted" && (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/${tenantSlug}/experts/acceptances/${e.id}`}>
                        수락서
                      </Link>
                    </Button>
                  )}
                  {canManage && e.status === "requested" && (
                    <EngagementCancelButton engagementId={e.id} />
                  )}
                  {canManage && e.status === "accepted" && (
                    <EngagementUrgentCancel
                      engagementId={e.id}
                      expertName={e.expertName}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

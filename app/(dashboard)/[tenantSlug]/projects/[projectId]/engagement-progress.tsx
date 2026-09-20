import Link from "next/link";
import { ClipboardCheck, FileCheck2, Send } from "lucide-react";

import { formatKrw } from "@/lib/approvals/constants";
import { cn } from "@/lib/utils";
import {
  ENGAGEMENT_STAGE_DESCRIPTIONS,
  ENGAGEMENT_STAGE_LABELS,
  ENGAGEMENT_STAGE_TONE,
  STAGE_TONE_CLASS,
  type EngagementStage,
} from "@/lib/integrations/engagement-stage";
import {
  PROJECT_STAGE_DESCRIPTIONS,
  PROJECT_STAGE_LABELS,
  type ProjectStage,
} from "@/lib/integrations/project-stage";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { DispatchDialog } from "./dispatch-dialog";
import { AcceptanceSendDialog } from "./acceptance-send-dialog";
import { EngagementHistoryDialog } from "./engagement-history-dialog";
import { EngagementUrgentCancel } from "@/components/integrations/engagement-urgent-cancel";
import { PlanHistoryTable } from "./plan-history-table";
import {
  ResendSmsButton,
  SmsHistoryCell,
  type SmsSummary,
} from "./sms-resend";
import { EngagementDecisionButtons, EngagementReviseButton } from "./engagement-decision";

/**
 * 승인 목록 및 섭외 진행 탭 (기획 확정 2026-08-30 — 37번).
 *
 * 섭외후보 등록 탭은 "후보를 고르고 품의를 올리는" 자리, 여기는 "결재가 난
 * 뒤 실제로 섭외하는" 자리다. 한 화면에 섞여 있으면 담당자가 지금 후보를
 * 고치는 중인지 발송 중인지 모른다. 승인된 계획(리비전)을 목록으로 보여
 * 주고, 그 아래에 섭외 문자 발송 · 수락서 송부·확인 버튼과 코드별 진행
 * 현황을 둔다.
 */

export type ApprovedPlanSession = {
  slotId: string | null;
  /** 결재 승인 뒤 세션 정보(회차·시간·비용·방식·일정 등)가 바뀌었는가 — 주홍색 굵은 테두리 */
  changed: boolean;
  label: string;
  schedule: string | null;
  roleDescription: string | null;
  locationName: string | null;
  requiredCount: number;
  subtotal: number;
  /** 지문에 기록된 섭외 대상 — 결재된 금액 */
  experts: { code: string; name: string; fee: number }[];
};

export type ApprovedPlanRow = {
  id: string;
  revision: number;
  status: string;
  approvalId: string | null;
  slotCount: number;
  positionCount: number;
  plannedAmount: number;
  /** 계획 섭외비 최대 — null이면 단일 금액 */
  plannedAmountMax: number | null;
  submittedAt: string | null;
  approvedAt: string | null;
  note: string | null;
  /** 계획에 담긴 세션 (부분 상신·보완 상신 확인용). changed = 승인 뒤 변경된 세션 */
  sessionLabels: { slotId: string; label: string; changed: boolean }[];
  /**
   * 세션별 세부 + 상신·승인 시점의 전문가별 예정가 (핫픽스 2026-09-05,
   * 렛츠 보고 — 승인 목록에 세션 정보와 승인 금액이 없었다)
   */
  sessions: ApprovedPlanSession[];
  /** 38번: 사후보고로 확정된 계획인가 */
  postReport: boolean;
  /** 사후보고 문서의 상태 (in_progress=확인 대기 / approved=확인 완료 / rejected=피드백) */
  reportStatus: string | null;
  /** 상급자 피드백 — 진행을 되돌리지 않고 문구만 표시 */
  feedbackNote: string | null;
};

export type ProgressRow = {
  positionId: string;
  slotLabel: string;
  code: string;
  /** 전문가가 붙은 자리만 싣는다 — 빈 TO는 진행 현황이 아니다 */
  expertName: string;
  stage: EngagementStage;
  engagementId: string | null;
  /** 세션 일정·장소 한 줄 */
  sessionDetail: string | null;
  /** 이 자리의 예정가 (후보별 예정가, 없으면 세션 1인 비용) */
  fee: number | null;
  /** 이 섭외 건으로 나간 문자 발송 이력 (기획 지시 2026-09-05) */
  sms?: SmsSummary | null;
  /** 결재 승인 뒤 이 세션의 정보가 바뀌었는가 — 행 테두리를 주홍색 굵은 선으로 (기획 지시 2026-09-21) */
  sessionChanged?: boolean;
  /** 거절·만료로 빈 자리에 같은 전문가가 그대로 배정돼 있어 '문자보내기'로 다시 요청할 수 있는가 */
  redispatchable?: boolean;
};

/**
 * 승인 뒤 변경된 세션 표시 — 주홍색 굵은 테두리 (기획 지시 2026-09-21).
 * 표 행은 border-collapse 아래서 tr 테두리가 칸에 가려지므로 칸마다 그린다.
 */
export const CHANGED_SESSION_RING =
  "border-[3px] border-orange-600";
export const CHANGED_SESSION_ROW =
  "[&>td]:border-y-[3px] [&>td]:border-y-orange-600 [&>td:first-child]:border-l-[3px] [&>td:first-child]:border-l-orange-600 [&>td:last-child]:border-r-[3px] [&>td:last-child]:border-r-orange-600";
export const CHANGED_SESSION_HINT = "결재 승인 후 세션 정보가 변경됨 — 변경 품의 필요";

/** 수락서가 존재하는 단계 — 이때만 '수락서 확인' 버튼이 의미 있다 */
const ACCEPTANCE_STAGES: readonly EngagementStage[] = [
  "accepted",
  "letter_issued",
  "letter_sent",
  "confirmed",
];

/**
 * 행 배경 (기획 지시 2026-09-21): 거절(담당자·전문가 불문) = 중간 짙은 회색,
 * 만료·취소 = 옅은 회색, 승인 이후 = 노란색
 */
function progressRowClass(stage: EngagementStage): string {
  if (stage === "declined") return "bg-neutral-300 text-neutral-800";
  if (stage === "expired" || stage === "canceled") return "bg-neutral-200 text-neutral-600";
  if (ACCEPTANCE_STAGES.includes(stage)) return "bg-yellow-100";
  return "";
}

export function EngagementProgress({
  tenantSlug,
  projectId,
  projectName,
  projectDescription = null,
  canManage,
  canInput,
  canCancel = false,
  expertsLite,
  approvalsEnabled,
  projectState,
  planGate,
  plans,
  rows,
  attachmentPanel,
  acceptanceAttachmentPanel,
}: {
  tenantSlug: string;
  projectId: string;
  projectName: string;
  projectDescription?: string | null;
  /** 실행(발송·수락서 송부) — 레벨 4부터 */
  canManage: boolean;
  /** 입력(첨부) — 레벨 5부터 */
  canInput: boolean;
  /** 확정 후 긴급 취소 — 레벨 3부터. 후보 등록 화면에서 이 탭으로 옮김 (2026-09-05) */
  canCancel?: boolean;
  expertsLite: boolean;
  /** approvals 모듈 — 꺼져 있으면 승인 목록 대신 "품의 없이 진행" 안내 */
  approvalsEnabled: boolean;
  projectState: {
    stage: ProjectStage;
    dispatchable: number;
    filled: number;
    requested: number;
  };
  planGate: { blocked: boolean; message: string };
  plans: ApprovedPlanRow[];
  rows: ProgressRow[];
  attachmentPanel?: React.ReactNode;
  acceptanceAttachmentPanel?: React.ReactNode;
}) {
  const stage = projectState.stage;
  const canDispatch =
    stage === "plan_approved" ||
    ((stage === "requesting" || stage === "accepted_all") &&
      projectState.dispatchable > 0);
  const showAcceptance =
    !expertsLite &&
    (stage === "requesting" ||
      stage === "accepted_all" ||
      stage === "letters_sent");
  const beforeApproval = stage === "assigning" || stage === "plan_review";
  // 사후보고 피드백(38번) — **현재 유효한(최신 승인) 리비전**의 피드백만 코랄로
  // 먼저 보인다. 조정 후 다시 보고한 뒤에도 옛 피드백이 떠 있으면 안 된다 (리뷰 P2-4)
  const latest = plans[0];
  const feedbackPlan =
    latest && latest.postReport && latest.status === "approved" && latest.feedbackNote
      ? latest
      : null;

  return (
    <div className="space-y-4">
      {feedbackPlan && (
        <div className="rounded-lg border-2 border-brand-coral bg-brand-coral/10 p-3">
          <p className="text-sm font-bold text-brand-coral-ink">
            상급자 피드백 — 사후보고 v{feedbackPlan.revision}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-brand-coral-ink">
            {feedbackPlan.feedbackNote}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            피드백은 진행을 되돌리지 않습니다. 후보·금액을 조정했다면 변경
            확정(사후보고)으로 다시 보고하세요.
          </p>
        </div>
      )}

      {/* ── 지금 단계 + 실행 버튼 ─────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-sm">섭외 진행</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {canManage && canDispatch && (
              <DispatchDialog
                projectId={projectId}
                projectName={projectName}
                defaultSummary={projectDescription}
                targetCount={projectState.dispatchable}
                expertsLite={expertsLite}
                disabled={planGate.blocked}
                disabledReason={planGate.message}
                triggerLabel={
                  expertsLite ? "섭외 요청 기록 (전체)" : "섭외 문자 발송 (전체 세션)"
                }
              />
            )}
            {canManage && showAcceptance && (
              <AcceptanceSendDialog
                projectId={projectId}
                targetCount={projectState.filled}
                alreadySent={stage === "letters_sent"}
                disabled={stage === "requesting"}
                disabledReason="아직 전원이 수락하지 않았습니다. 전원 수락 후 열립니다."
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border-l-4 border-brand bg-brand/[0.04] p-3">
            <p className="text-sm font-bold text-brand-navy">
              {PROJECT_STAGE_LABELS[stage]}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {PROJECT_STAGE_DESCRIPTIONS[stage]}
            </p>
          </div>

          {beforeApproval && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              {stage === "assigning" ? (
                <>
                  {approvalsEnabled
                    ? "아직 섭외 품의가 승인되지 않았습니다. 후보 배정과 품의 상신은 "
                    : "아직 섭외 명단이 확정되지 않았습니다. 후보 배정과 확정은 "}
                  <Link
                    href={`/${tenantSlug}/projects/${projectId}?tab=experts`}
                    className="font-semibold underline underline-offset-4"
                  >
                    섭외후보 등록
                  </Link>{" "}
                  {approvalsEnabled
                    ? "탭에서 합니다. 결재가 끝나면 여기서 섭외 문자를 보냅니다."
                    : "탭에서 합니다 (전자결재 미사용 — ‘섭외 품의서 자동 작성 및 송신’을 누르면 결재 없이 바로 열립니다). 그 뒤 여기서 섭외 문자를 보냅니다."}
                </>
              ) : (
                <>섭외 품의가 결재 진행 중입니다. 승인되면 여기서 섭외 문자를 보낼 수 있습니다.</>
              )}
            </div>
          )}
          {/* 잠긴 사유는 버튼 아래 placeholder(disabledReason)가 이미 말한다 —
              발송 버튼이 없는(canDispatch 아님) 경우에만 배너로 보인다 */}
          {!beforeApproval && planGate.blocked && !(canManage && canDispatch) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              {planGate.message}
            </div>
          )}

          {stage === "requesting" && (
            <p className="text-xs text-muted-foreground">
              회신 대기 {projectState.requested}건 · 수락 {projectState.filled}건.
              무응답 대응(재안내·수동 완료)은{" "}
              <Link
                href={`/${tenantSlug}/experts/engagements?status=requested`}
                className="text-brand underline underline-offset-4"
              >
                섭외 현황
              </Link>
              에서, 거절·만료로 빈 자리는 섭외후보 등록 탭의 코드넘버별 개별
              요청으로 채웁니다.
            </p>
          )}

          {canManage && !expertsLite && stage === "accepted_all" && (
            <div className="rounded-lg border-2 border-brand bg-brand/[0.06] p-3">
              <p className="text-sm font-bold text-brand-navy">
                전원 수락 완료 — 수락서를 보낼 차례입니다
              </p>
              <p className="mt-1 text-xs leading-relaxed text-brand-navy">
                수락서는 각 전문가별로 자동 생성됩니다. 동봉할 자료를 먼저 붙인 뒤
                위쪽 <strong>수락서 송부</strong> 버튼을 누르세요. 수락서는
                캐스트로그 화면에서만 열리며, 문자·이메일은 도착 안내입니다.
              </p>
            </div>
          )}

          {/* 발송 전에 붙이는 첨부 — 보낸 뒤에는 못 붙인다 */}
          {canInput && stage === "plan_approved" && attachmentPanel}
          {canInput &&
            !expertsLite &&
            stage === "accepted_all" &&
            acceptanceAttachmentPanel}
        </CardContent>
      </Card>


      {/* ── 승인 목록 ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardCheck className="h-4 w-4" aria-hidden />
            섭외 품의 승인 목록
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!approvalsEnabled ? (
            <p className="text-sm text-muted-foreground">
              전자결재 모듈이 비활성 상태입니다 — 품의 없이 바로 섭외를 진행합니다.
            </p>
          ) : (
            <PlanHistoryTable tenantSlug={tenantSlug} plans={plans} />
          )}
        </CardContent>
      </Card>

      {/* ── 코드별 진행 현황 + 수락서 확인 ───────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Send className="h-4 w-4" aria-hidden />
            섭외 진행 현황 · 수락서 확인
          </CardTitle>
          {/* 전문가가 문자 링크에서 수락/거절하면 이 표가 스스로 따라온다 (기획 지시 2026-09-21) */}
          <AutoRefresh />
          <p className="text-[11px] text-muted-foreground">
            전문가가 섭외 문자 링크에서 수락·거절하면 자동으로 반영됩니다 (20초 간격 · 창을 다시 열 때 즉시).
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              아직 전문가가 배정된 자리가 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>세션</TableHead>
                    <TableHead className="w-32">코드넘버</TableHead>
                    <TableHead className="w-32">전문가</TableHead>
                    <TableHead className="w-28 text-right">예정가</TableHead>
                    <TableHead className="w-28">단계</TableHead>
                    <TableHead className="w-56">문자 발송</TableHead>
                    <TableHead className="w-36">회신 처리</TableHead>
                    <TableHead className="w-44 text-right">수락서</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.positionId}
                      className={cn(
                        progressRowClass(r.stage),
                        r.sessionChanged && CHANGED_SESSION_ROW
                      )}
                      title={r.sessionChanged ? CHANGED_SESSION_HINT : undefined}
                    >
                      <TableCell className="text-xs">
                        {r.slotLabel}
                        {r.sessionChanged && (
                          <span className="ml-1.5 rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            승인 후 변경
                          </span>
                        )}
                        {r.sessionDetail && (
                          <span className="block text-[11px] text-muted-foreground">
                            {r.sessionDetail}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/${tenantSlug}/projects/${projectId}/positions/${r.positionId}`}
                          className="font-mono text-xs text-brand underline-offset-4 hover:underline"
                        >
                          {r.code}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{r.expertName}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {r.fee !== null ? formatKrw(r.fee) : "미정"}
                      </TableCell>
                      <TableCell>
                        <span
                          title={ENGAGEMENT_STAGE_DESCRIPTIONS[r.stage]}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                            STAGE_TONE_CLASS[ENGAGEMENT_STAGE_TONE[r.stage]]
                          )}
                        >
                          {ENGAGEMENT_STAGE_LABELS[r.stage]}
                        </span>
                      </TableCell>
                      <TableCell>
                        {/* 후보별 문자보내기 → 발송 뒤 재발송 (기획 지시 2026-09-21) + 발송 이력 */}
                        <div className="flex flex-col items-start gap-1">
                          <SmsHistoryCell sms={r.sms ?? null} expertName={r.expertName} />
                          {/* 거절·만료된 자리도 같은 전문가에게 다시 보낼 수 있다 (기획 지시 2026-09-21) */}
                          {canManage &&
                            (r.stage === "plan_approved" ||
                              ((r.stage === "declined" || r.stage === "expired") && r.redispatchable)) && (
                            <DispatchDialog
                              projectId={projectId}
                              projectName={projectName}
                              defaultSummary={projectDescription}
                              targetCount={1}
                              expertsLite={expertsLite}
                              disabled={planGate.blocked}
                              disabledReason={planGate.message}
                              triggerLabel={expertsLite ? "요청 기록" : "문자보내기"}
                              positionIds={[r.positionId]}
                              expertName={r.expertName}
                              size="xs"
                            />
                          )}
                          {canManage && (r.stage === "assigned" || r.stage === "plan_review") && (
                            <span className="text-[11px] text-muted-foreground">
                              {r.stage === "plan_review" ? "품의 승인 후 보낼 수 있습니다" : "섭외 품의 승인 전"}
                            </span>
                          )}
                          {canManage &&
                            !expertsLite &&
                            r.engagementId &&
                            r.stage === "requested" && (
                              <ResendSmsButton
                                engagementId={r.engagementId}
                                projectId={projectId}
                                expertName={r.expertName}
                              />
                            )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {/* 승인·거절 — 회신 대기 건은 결정, 이미 내려진 결정은 수정 (기획 지시 2026-09-21).
                            승인 행은 노랑, 거절 행은 회색 */}
                        {canManage && r.engagementId && r.stage === "requested" ? (
                          <EngagementDecisionButtons
                            engagementId={r.engagementId}
                            projectId={projectId}
                            expertName={r.expertName}
                            expertsLite={expertsLite}
                          />
                        ) : (
                          <span className="inline-flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                            {r.stage === "declined"
                              ? canManage && r.engagementId
                                ? null // 붉은 '거절' 버튼이 상태를 말한다
                                : (
                                    <span className="rounded-md bg-red-600 px-2 py-0.5 font-semibold text-white">
                                      거절
                                    </span>
                                  )
                              : r.stage === "expired"
                                ? "만료됨"
                                : r.stage === "confirmed"
                                  ? "승인됨 · 확정"
                                  : ACCEPTANCE_STAGES.includes(r.stage)
                                    ? "승인됨"
                                    : "-"}
                            {canManage && r.engagementId && r.stage === "declined" && (
                              <EngagementReviseButton
                                engagementId={r.engagementId}
                                projectId={projectId}
                                expertName={r.expertName}
                                to="accepted"
                              />
                            )}
                            {canManage &&
                              r.engagementId &&
                              ACCEPTANCE_STAGES.includes(r.stage) &&
                              r.stage !== "confirmed" && (
                                <EngagementReviseButton
                                  engagementId={r.engagementId}
                                  projectId={projectId}
                                  expertName={r.expertName}
                                  to="declined"
                                />
                              )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1">
                          {r.engagementId && ACCEPTANCE_STAGES.includes(r.stage) ? (
                            <Button asChild size="sm" variant="outline">
                              <Link
                                href={`/${tenantSlug}/experts/acceptances/${r.engagementId}`}
                              >
                                <FileCheck2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                                수락서 확인
                              </Link>
                            </Button>
                          ) : (
                            <Badge variant="outline" className="font-normal">
                              {r.stage === "requested" ? "회신 대기" : "-"}
                            </Badge>
                          )}
                          {r.engagementId && (
                            <EngagementHistoryDialog
                              engagementId={r.engagementId}
                              expertName={r.expertName}
                            />
                          )}
                          {/* 확정 후 긴급 취소 — 계약이 성립한 건만 (기획 지시 2026-09-05,
                              후보 등록 화면에서 이동) */}
                          {canCancel &&
                            r.engagementId &&
                            ACCEPTANCE_STAGES.includes(r.stage) && (
                              <EngagementUrgentCancel
                                engagementId={r.engagementId}
                                expertName={r.expertName}
                              />
                            )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

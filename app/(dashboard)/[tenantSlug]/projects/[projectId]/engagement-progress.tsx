import Link from "next/link";
import { ClipboardCheck, FileCheck2, Send } from "lucide-react";

import { REPORT_STATUS_LABELS, formatKrw } from "@/lib/approvals/constants";
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

/**
 * 승인 목록 및 섭외 진행 탭 (기획 확정 2026-08-30 — 37번).
 *
 * 섭외후보 등록 탭은 "후보를 고르고 품의를 올리는" 자리, 여기는 "결재가 난
 * 뒤 실제로 섭외하는" 자리다. 한 화면에 섞여 있으면 담당자가 지금 후보를
 * 고치는 중인지 발송 중인지 모른다. 승인된 계획(리비전)을 목록으로 보여
 * 주고, 그 아래에 섭외 문자 발송 · 수락서 송부·확인 버튼과 코드별 진행
 * 현황을 둔다.
 */

export type ApprovedPlanRow = {
  id: string;
  revision: number;
  status: string;
  approvalId: string | null;
  slotCount: number;
  positionCount: number;
  plannedAmount: number;
  submittedAt: string | null;
  approvedAt: string | null;
  note: string | null;
  /** 계획에 담긴 세션 라벨 (부분 상신·보완 상신 확인용) */
  sessionLabels: string[];
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
};

const PLAN_STATUS_LABELS: Record<string, string> = {
  draft: "작성 중",
  in_progress: "결재 중",
  approved: "승인",
  rejected: "반려",
  superseded: "대체됨",
};

const PLAN_STATUS_CLASS: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-900 border-emerald-200",
  in_progress: "bg-amber-100 text-amber-900 border-amber-200",
  rejected: "bg-red-100 text-red-900 border-red-200",
  superseded: "bg-secondary text-muted-foreground",
  draft: "bg-secondary text-muted-foreground",
};

/** 수락서가 존재하는 단계 — 이때만 '수락서 확인' 버튼이 의미 있다 */
const ACCEPTANCE_STAGES: readonly EngagementStage[] = [
  "accepted",
  "letter_issued",
  "letter_sent",
  "confirmed",
];

function when(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EngagementProgress({
  tenantSlug,
  projectId,
  projectName,
  projectDescription = null,
  canManage,
  canInput,
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
                triggerLabel={expertsLite ? "섭외 요청 기록" : "섭외 문자 발송"}
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
          ) : plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              아직 상신된 섭외 품의가 없습니다. 섭외후보 등록 탭에서 세션별
              후보를 배정한 뒤 품의를 올리면 여기에 쌓입니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">리비전</TableHead>
                    <TableHead className="w-20">상태</TableHead>
                    <TableHead>담긴 세션</TableHead>
                    <TableHead className="w-24 text-right">인원</TableHead>
                    <TableHead className="w-28 text-right">계획 섭외비</TableHead>
                    <TableHead className="w-28">상신</TableHead>
                    <TableHead className="w-28">승인</TableHead>
                    <TableHead className="w-24">결재 문서</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">v{p.revision}</TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                            PLAN_STATUS_CLASS[p.status] ?? PLAN_STATUS_CLASS.draft
                          )}
                        >
                          {PLAN_STATUS_LABELS[p.status] ?? p.status}
                        </span>
                        {p.postReport && (
                          <span
                            className="mt-1 block w-fit rounded-full bg-brand-coral/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-coral-ink"
                            title="사후보고 모드로 즉시 확정된 계획"
                          >
                            사후보고
                            {p.reportStatus
                              ? ` · ${REPORT_STATUS_LABELS[p.reportStatus] ?? p.reportStatus}`
                              : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.sessionLabels.length === 0
                          ? `세션 ${p.slotCount}건 (세션 구분 없음)`
                          : p.sessionLabels.join(" · ")}
                        {p.note && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {p.note}
                          </p>
                        )}
                        {p.feedbackNote && (
                          <p className="mt-0.5 text-[11px] font-medium text-brand-coral-ink">
                            피드백: {p.feedbackNote}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {p.positionCount}명
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {formatKrw(p.plannedAmount)}
                      </TableCell>
                      <TableCell className="text-xs">{when(p.submittedAt)}</TableCell>
                      <TableCell className="text-xs">{when(p.approvedAt)}</TableCell>
                      <TableCell>
                        {p.approvalId ? (
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              href={`/${tenantSlug}/approvals/${p.approvalId}`}
                              aria-label={`v${p.revision} 결재 문서 열기`}
                            >
                              열기
                            </Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
                    <TableHead className="w-28">단계</TableHead>
                    <TableHead className="w-44 text-right">수락서</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.positionId}>
                      <TableCell className="text-xs">{r.slotLabel}</TableCell>
                      <TableCell>
                        <Link
                          href={`/${tenantSlug}/projects/${projectId}/positions/${r.positionId}`}
                          className="font-mono text-xs text-brand underline-offset-4 hover:underline"
                        >
                          {r.code}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{r.expertName}</TableCell>
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

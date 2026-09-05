import Link from "next/link";
import {
  Search,
  CalendarCheck,
  FileText,
  Send,
  FileCheck2,
} from "lucide-react";

import { formatKrw } from "@/lib/approvals/constants";
import { roleTypeLabel } from "@/lib/integrations/engagement-roles";
import { durationLabel } from "@/lib/integrations/time-duration";
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

import { EngagementUrgentCancel } from "@/components/integrations/engagement-urgent-cancel";
import { EngagementCancelButton } from "@/components/integrations/engagement-cancel-button";

import {
  PROJECT_STAGE_DESCRIPTIONS,
  PROJECT_STAGE_LABELS,
  type ProjectStage,
} from "@/lib/integrations/project-stage";

import type { SlotRow } from "./slot-table";
import {
  SLOT_PLAN_STATE_LABELS,
  type SlotPlanState,
} from "@/lib/integrations/engagement-plans";
import { CandidateList } from "./candidate-list";
import { RequiredCountEditor } from "./required-count-editor";
import { EngagementHistoryDialog } from "./engagement-history-dialog";
import { ManualAcceptButton } from "./manual-accept-button";
import {
  EngagementPlanButton,
  type PlanPreviewLine,
} from "./engagement-plan-button";

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
    title: "① 후보 탐색·배정",
    body: "연결된 전문가를 이름·전문분야·지역으로 좁혀 봅니다.",
  },
  {
    icon: CalendarCheck,
    title: "② 일정 겹침 확인",
    body: "이 세션 일정과 겹치는 후보는 자동으로 표시됩니다(타사 건은 건수만).",
  },
  {
    icon: FileText,
    title: "③ 임의 배정 → 품의",
    body: "세션마다 후보를 순위대로 배정하고 예정가를 적습니다. 필요인원만큼 배정되면 ‘섭외 품의서 자동 작성 및 송신’이 열립니다.",
  },
  {
    icon: Send,
    title: "④ 결재 후 섭외 진행",
    body: "결재가 끝나면 '승인 목록 및 섭외 진행' 탭에서 순위 상위 필요인원에게 한 번에 섭외 문자를 보냅니다. 거절 시 예비 후보로 개별 요청합니다.",
  },
  {
    icon: FileCheck2,
    title: "⑤ 수락서 송부 → 확정",
    body: "전원이 수락하면 같은 탭에서 수락서를 한 번에 보냅니다. 전문가는 전문가 포털에서 확인·승인(서명)하며, 전원이 승인하면 확정됩니다.",
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
  const dur = durationLabel(slot.startsTime, slot.endsTime);
  return `${slot.slotDate}${time}${dur ? ` (${dur})` : ""}`;
}

export function EngagementWorkbench({
  tenantSlug,
  projectId,
  slots,
  slotPlanStates = null,
  canManage,
  canInput,
  canCancel = false,
  canWithdraw,
  planGate,
  planPanel,
  stageByPosition,
  unlinked,
  projectState,
  planPreview,
  planApproverOptions = [],
  planRelayOn = false,
  planFlow = { mode: "pre_approval", reason: null },
  headerActions,
  expertsLite = false,
}: {
  tenantSlug: string;
  projectId: string;
  slots: SlotRow[];
  /**
   * 세션 → 계획 상태 (다중 계획, 2026-09-05). 결재 중·승인·변경 필요 세션은
   * 편집이 잠기고, 미상신·반려 세션은 열린다. null = 전자결재 미사용(게이트 없음)
   */
  slotPlanStates?: Record<string, SlotPlanState> | null;
  /** 실행 버튼(품의 상신·섭외요청·수락서 송부) — 레벨 4부터 */
  canManage: boolean;
  /** 입력(후보·첨부) — 레벨 5부터 */
  canInput: boolean;
  /**
   * 확정 후 긴급 취소 — 레벨 3부터. 코드넘버에 붙은 건은 '승인 목록 및 섭외
   * 진행' 탭으로 옮겼고(기획 지시 2026-09-05), 여기서는 그 탭에 나오지 않는
   * **코드넘버 미연결 건**에만 남긴다 (리뷰 2)
   */
  canCancel?: boolean;
  /** 응답 전 회수 — 레벨 4부터 (권한 축 분리, 기획 확정 2026-08-29) */
  canWithdraw: boolean;
  /**
   * 섭외계획 품의 게이트 — 승인 전이면 요청 자체가 막힌다.
   * appendable: 승인됐지만 계획 밖 세션이 남아 보완(추가) 품의가 필요한 상태
   * (감사 P1 — 패널을 blocked에서만 그리면 보완 상신 UI에 닿을 길이 없다)
   */
  planGate: { blocked: boolean; message: string; appendable?: boolean };
  /** 섭외계획 품의 패널 — 게이트에 걸렸을 때 그 자리에서 상신할 수 있게 */
  planPanel?: React.ReactNode;
  /** 코드넘버 id → 현재 진행 단계 (계획품의·섭외·수락서를 합쳐 판정한 값) */
  stageByPosition: Record<string, EngagementStage>;
  /** 코드넘버에 붙지 않은 섭외 건 (프로젝트에 직접 만든 건·나중에 붙인 건) */
  unlinked: UnlinkedEngagement[];
  /** 프로젝트 단위 진행 단계 — 버튼 활성 조건은 이 값 하나로 정한다 */
  projectState: {
    stage: ProjectStage;
    assigned: number;
    total: number;
    open: number;
    /** 수락·확정된 자리 — 수락서 송부 대상 수 */
    filled: number;
    fullyAssigned: boolean;
    /** 지금 일괄 발송하면 요청이 나갈 자리 수 (예비 후보 제외) */
    dispatchable: number;
  };
  /** 품의서 미리보기 (상신 전 확인용) */
  planPreview: { lines: PlanPreviewLine[]; amount: number };
  /** 결재라인 직접 지정 후보 (기획 2026-08-30 — 18번) */
  planApproverOptions?: { id: string; name: string; gradeLabel: string }[];
  /** 상급자 릴레이 결재(27번) 활성 — 픽커 안내 문구 분기 */
  planRelayOn?: boolean;
  /** 사후보고 모드(38번) 판정 — 버튼 라벨·다이얼로그 문구 분기 */
  planFlow?: { mode: "post_report" } | { mode: "pre_approval"; reason: string | null };
  /** 섭외 추가·붙이기 버튼 — 서버 컴포넌트에서 내려받는다 */
  headerActions?: React.ReactNode;
  /** 라이트 모드(수기 섭외 관리) — 발송·수락서 송부 없이 기록만 */
  expertsLite?: boolean;
}) {
  // 긴급 취소로 다시 비게 된 자리 — 나머지 빈 자리와 섞이면 놓친다
  const reengageCount = slots.reduce(
    (sum, s) =>
      sum +
      s.positions.filter(
        (p) => p.status === "open" && p.canceledExpertName !== null
      ).length,
    0
  );
  // 다중 계획 (2026-09-05): 계획 품의는 수락서 송부 전까지 언제든 올릴 수 있다 —
  // 결재 중·승인된 세션은 잠기고 나머지 세션만 담긴다
  const submittableStage = (
    ["assigning", "plan_review", "plan_approved", "requesting", "accepted_all"] as const
  ).includes(projectState.stage as never);
  const slotState = (slotId: string): SlotPlanState =>
    slotPlanStates ? (slotPlanStates[slotId] ?? "none") : "none";
  const slotLocked = (slotId: string) => {
    const st = slotState(slotId);
    return st === "in_progress" || st === "approved" || st === "changed";
  };
  const lockedSlots: Record<string, string> = {};
  for (const s of slots) {
    if (slotLocked(s.id)) lockedSlots[s.id] = SLOT_PLAN_STATE_LABELS[slotState(s.id)];
  }
  const submittableCount = slots.filter((s) => !slotLocked(s.id)).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">
          전문가 섭외 진행 · 배정 {projectState.assigned + (projectState.total - projectState.open - projectState.assigned)}/{projectState.total}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && submittableStage && (
            <EngagementPlanButton
              projectId={projectId}
              // 세션별 선택 상신 (기획 2026-08-30 — 22번) + 다중 계획(2026-09-05):
              // 결재 중·승인된 계획이 있어도 나머지 세션을 별도 품의로 올린다
              disabled={projectState.total === 0 || submittableCount === 0}
              disabledReason={
                projectState.total === 0
                  ? "세션(코드넘버)을 먼저 등록하세요."
                  : "모든 세션이 결재 중이거나 승인되었습니다. 세션을 추가하면 별도 품의로 올릴 수 있습니다."
              }
              lines={planPreview.lines}
              lockedSlots={lockedSlots}
              approverOptions={planApproverOptions}
              relayOn={planRelayOn}
              flow={planFlow}
            />
          )}
          {/* 섭외 문자 발송·수락서 송부는 '승인 목록 및 섭외 진행' 탭으로
              옮겼다 (기획 확정 2026-08-30 — 37번). 결재가 난 뒤에는 그 탭이
              실행 자리다 */}
          {canManage && projectState.stage !== "assigning" && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/${tenantSlug}/projects/${projectId}?tab=engage`}>
                <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                승인 목록 및 섭외 진행 →
              </Link>
            </Button>
          )}
          {headerActions}
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${tenantSlug}/projects/${projectId}?tab=sessions`}>
              세션 확인
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 라이트 모드 — 발송이 전부 꺼져 있음을 화면에서 먼저 말한다.
            버튼이 조용히 아무것도 안 보내면 사용자는 보냈다고 믿는다 */}
        {expertsLite && (
          <div className="rounded-lg border-l-4 border-sky-500 bg-sky-50 p-3">
            <p className="text-sm font-bold text-sky-900">
              라이트 모드 — 발송 없이 기록만 됩니다
            </p>
            <p className="mt-1 text-xs leading-relaxed text-sky-900">
              섭외 요청을 만들어도 전문가에게 문자·이메일이 나가지 않습니다.
              전화 등으로 직접 확인한 뒤 각 후보의{" "}
              <strong>섭외 완료(수락서 생성)</strong> 버튼으로 확정하세요.
              재안내·수락서 송부도 쓰지 않습니다. (설정 &gt; 기업관리에서 변경)
            </p>
          </div>
        )}
        {/* 지금 프로젝트가 어느 단계인지 — 버튼이 왜 열리고 닫히는지의 근거다 */}
        <div className="rounded-lg border-l-4 border-brand bg-brand/[0.04] p-3">
          <p className="text-sm font-bold text-brand-navy">
            {PROJECT_STAGE_LABELS[projectState.stage]}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {PROJECT_STAGE_DESCRIPTIONS[projectState.stage]}
          </p>
          {/* 회신 대기 중 무응답 대응(재안내·수동 완료)은 섭외 현황에 모여
              있다 — 배너가 "기다립니다"만 말하면 다음 행동을 못 찾는다 (검수 G5) */}
          {projectState.stage === "requesting" && (
            <p className="mt-1 text-xs">
              <Link
                href={`/${tenantSlug}/experts/engagements?status=requested`}
                className="text-brand underline underline-offset-4"
              >
                회신 대기 건 관리 (재안내·수동 완료) →
              </Link>
            </p>
          )}
        </div>

        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
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
            섭외 상태 범례 ({ENGAGEMENT_STAGES.length}단계)
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
            ‘결재 중 · 결재 완료’는 세션(묶음)별 섭외계획 품의 상태입니다 —
            세션 묶음마다 품의가 따로 가고, 결재 중인 품의가 있어도 나머지
            세션은 별도 품의로 올릴 수 있습니다 (전자결재를 쓰지 않는 회사에서는
            나타나지 않습니다). 그 뒤 단계는 코드넘버 한 자리씩 따로 갑니다.
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
          </div>
        )}

        {/* 막힌 이유를 적어 놓고 푸는 길을 다른 화면에 두면, 사용자는 그 화면을
            찾다가 포기한다. 상신·변경 상신은 여기서 바로 한다 */}
        {(planGate.blocked || planGate.appendable) && planPanel}

        {/* 결재가 난 뒤의 실행(첨부·발송·수락서)은 전용 탭에 있다 — 여기서
            "다음 행동"을 잃지 않게 한 줄로 가리킨다 */}
        {canManage &&
          (projectState.stage === "plan_approved" ||
            projectState.stage === "accepted_all") && (
            <div className="rounded-lg border-2 border-brand bg-brand/[0.06] p-3">
              <p className="text-sm font-bold text-brand-navy">
                {projectState.stage === "plan_approved"
                  ? "결재 완료 — 섭외 문자를 보낼 차례입니다"
                  : "전원 수락 완료 — 수락서를 보낼 차례입니다"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-brand-navy">
                첨부를 붙이고 발송하는 자리는{" "}
                <Link
                  href={`/${tenantSlug}/projects/${projectId}?tab=engage`}
                  className="font-semibold underline underline-offset-4"
                >
                  승인 목록 및 섭외 진행
                </Link>{" "}
                탭입니다.
              </p>
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
              <Link href={`/${tenantSlug}/projects/${projectId}?tab=basic`}>
                기본설정 탭에서 세션 등록
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {slots.map((slot) => {
              // 세션 단위 잠금 (다중 계획): 결재 중·승인·변경 필요 세션만 잠긴다
              const st = slotState(slot.id);
              const locked = slotLocked(slot.id);
              const slotEditable = canInput && submittableStage && !locked;
              return (
              // 앵커 — 캘린더·세션 계획의 '섭외계획' 버튼이 이 세션으로 점프한다 (29번)
              <li key={slot.id} id={`slot-${slot.id}`} className="rounded-lg border p-3 scroll-mt-24">
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
                  {slotPlanStates && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-semibold",
                        st === "approved"
                          ? "bg-emerald-100 text-emerald-900"
                          : st === "in_progress"
                            ? "bg-amber-100 text-amber-900"
                            : st === "changed"
                              ? "bg-rose-100 text-rose-900"
                              : st === "rejected"
                                ? "bg-red-100 text-red-900"
                                : "bg-violet-100 text-violet-900"
                      )}
                      title={
                        st === "none"
                          ? "아직 품의에 담기지 않은 세션입니다. 후보·예정가를 편집하고 '섭외 품의서 자동 작성 및 송신'에서 골라 상신하세요 — 결재 중인 품의가 있어도 별도 품의로 올릴 수 있습니다."
                          : st === "rejected"
                            ? "이 세션의 품의가 반려되었습니다. 조정 후 다시 상신하세요."
                            : st === "in_progress"
                              ? "이 세션의 품의가 결재 진행 중입니다. 승인되면 섭외 문자를 보낼 수 있습니다."
                              : st === "changed"
                                ? "승인 뒤 내용이 바뀌었습니다. 아래 섭외계획 패널에서 변경 품의를 올리세요."
                                : "승인된 세션입니다. '승인 목록 및 섭외 진행' 탭에서 섭외 문자를 보냅니다."
                      }
                    >
                      {SLOT_PLAN_STATE_LABELS[st]}
                      {!locked && submittableStage ? " · 편집 가능" : ""}
                    </span>
                  )}
                  {/* 필요인원 인라인 수정 + 코랄 표기 (기획 2026-08-30 — 28번) */}
                  <RequiredCountEditor
                    // 외부 변경(다른 사용자·결재권자 수정)이 refresh로 오면
                    // 낙관 표시를 재동기화한다 (리뷰 P3-3)
                    key={`${slot.id}:${slot.requiredCount}`}
                    slotId={slot.id}
                    value={slot.requiredCount}
                    candidateCount={slot.positions.length}
                    editable={slotEditable}
                  />
                </div>

                {/* 후보 순위 모델 — 드래그 순위·개별 예정가·후보 추가/삭제 */}
                <CandidateList
                  tenantSlug={tenantSlug}
                  projectId={projectId}
                  slotId={slot.id}
                  requiredCount={slot.requiredCount}
                  positions={slot.positions}
                  stageByPosition={stageByPosition}
                  canManage={canInput}
                  canWithdraw={canWithdraw}
                  canExecute={canManage}
                  expertsLite={expertsLite}
                  editable={slotEditable}
                  sessionDuration={durationLabel(slot.startsTime, slot.endsTime)}
                />
              </li>
              );
            })}
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
                    <ManualAcceptButton
                      engagementId={e.id}
                      expertName={e.expertName}
                      expertsLite={expertsLite}
                    />
                  )}
                  {canWithdraw && e.status === "requested" && (
                    <EngagementCancelButton engagementId={e.id} />
                  )}
                  {canCancel && e.status === "accepted" && (
                    <EngagementUrgentCancel
                      engagementId={e.id}
                      expertName={e.expertName}
                    />
                  )}
                  <EngagementHistoryDialog
                    engagementId={e.id}
                    expertName={e.expertName}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

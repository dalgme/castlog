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

import {
  PROJECT_STAGE_DESCRIPTIONS,
  PROJECT_STAGE_LABELS,
  type ProjectStage,
} from "@/lib/integrations/project-stage";

import type { SlotRow } from "./slot-table";
import { CandidateList } from "./candidate-list";
import {
  EngagementPlanButton,
  type PlanPreviewLine,
} from "./engagement-plan-button";
import { DispatchDialog } from "./dispatch-dialog";
import { AcceptanceSendDialog } from "./acceptance-send-dialog";

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
    body: "결재가 끝나면 순위 상위 필요인원에게 한 번에 요청을 보냅니다. 거절 시 예비 후보로 개별 요청합니다.",
  },
  {
    icon: FileCheck2,
    title: "⑤ 수락서 송신 → 확정",
    body: "전원이 수락하면 수락서를 한 번에 보냅니다. 수락서는 캐스트로그 화면에서 확인·승인(서명)하며, 전원이 승인하면 확정됩니다.",
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
  canInput,
  canCancel,
  planGate,
  planPanel,
  stageByPosition,
  unlinked,
  projectState,
  planPreview,
  projectName,
  projectDescription = null,
  attachmentPanel,
  acceptanceAttachmentPanel,
  headerActions,
}: {
  tenantSlug: string;
  projectId: string;
  slots: SlotRow[];
  /** 실행 버튼(품의 상신·섭외요청·수락서 송신) — 레벨 4부터 */
  canManage: boolean;
  /** 입력(후보·첨부) — 레벨 5부터 */
  canInput: boolean;
  /** 섭외 취소·긴급 취소 — 레벨 3부터 */
  canCancel: boolean;
  /** 섭외계획 품의 게이트 — 승인 전이면 요청 자체가 막힌다 */
  planGate: { blocked: boolean; message: string };
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
    /** 수락·확정된 자리 — 수락서 송신 대상 수 */
    filled: number;
    fullyAssigned: boolean;
  };
  /** 품의서 미리보기 (상신 전 확인용) */
  planPreview: { lines: PlanPreviewLine[]; amount: number };
  projectName: string;
  /** 프로젝트 설명 — 섭외요청의 '주제/행사 내용' 자동 채움용 */
  projectDescription?: string | null;
  /** 섭외요청 첨부 패널 — 서버 컴포넌트에서 내려받는다 */
  attachmentPanel?: React.ReactNode;
  /** 수락서 첨부 패널 — 수락서 송신 전에만 붙일 수 있다 */
  acceptanceAttachmentPanel?: React.ReactNode;
  /** 섭외 추가·붙이기 버튼 — 서버 컴포넌트에서 내려받는다 */
  headerActions?: React.ReactNode;
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">
          전문가 섭외 진행 · 배정 {projectState.assigned + (projectState.total - projectState.open - projectState.assigned)}/{projectState.total}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && projectState.stage === "assigning" && (
            <EngagementPlanButton
              projectId={projectId}
              disabled={!projectState.fullyAssigned}
              disabledReason={
                projectState.total === 0
                  ? "세션(코드넘버)을 먼저 등록하세요."
                  : `아직 배정되지 않은 자리가 ${projectState.open}개 있습니다. 전부 배정하면 열립니다.`
              }
              lines={planPreview.lines}
              amount={planPreview.amount}
            />
          )}
          {canManage &&
            (projectState.stage === "plan_approved" ||
              projectState.stage === "plan_review") && (
              <DispatchDialog
                projectId={projectId}
                projectName={projectName}
                defaultSummary={projectDescription}
                targetCount={projectState.assigned}
                disabled={projectState.stage !== "plan_approved"}
                disabledReason="섭외 품의가 결재 진행 중입니다. 승인되면 열립니다."
              />
            )}
          {canManage &&
            (projectState.stage === "requesting" ||
              projectState.stage === "accepted_all" ||
              projectState.stage === "letters_sent") && (
              <AcceptanceSendDialog
                projectId={projectId}
                targetCount={projectState.filled}
                alreadySent={projectState.stage === "letters_sent"}
                disabled={projectState.stage === "requesting"}
                disabledReason="아직 전원이 수락하지 않았습니다. 전원 수락 후 열립니다."
              />
            )}
          {headerActions}
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${tenantSlug}/projects/${projectId}?tab=sessions`}>
              세션 계획 등록
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 지금 프로젝트가 어느 단계인지 — 버튼이 왜 열리고 닫히는지의 근거다 */}
        <div className="rounded-lg border-l-4 border-brand bg-brand/[0.04] p-3">
          <p className="text-sm font-bold text-brand-navy">
            {PROJECT_STAGE_LABELS[projectState.stage]}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {PROJECT_STAGE_DESCRIPTIONS[projectState.stage]}
          </p>
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
          </div>
        )}

        {/* 막힌 이유를 적어 놓고 푸는 길을 다른 화면에 두면, 사용자는 그 화면을
            찾다가 포기한다. 상신·변경 상신은 여기서 바로 한다 */}
        {planGate.blocked && planPanel}

        {/* 결재가 끝나면 보내기 전에 첨부를 붙인다 — 보낸 뒤에는 못 붙인다 */}
        {canInput &&
          projectState.stage === "plan_approved" &&
          attachmentPanel}

        {/* 수락서에 동봉할 자료 — 송신 순간 각 수락서로 복사된다. 보낸 뒤에
            프로젝트 첨부를 지워도 이미 나간 수락서의 자료는 남는다 */}
        {canInput &&
          projectState.stage === "accepted_all" &&
          acceptanceAttachmentPanel}

        {/* 전원 수락 — 이 화면에서 지금 할 일은 수락서 송신 하나뿐이다 */}
        {canManage && projectState.stage === "accepted_all" && (
          <div className="rounded-lg border-2 border-brand bg-brand/[0.06] p-3">
            <p className="text-sm font-bold text-brand-navy">
              전원 수락 완료 — 수락서를 보낼 차례입니다
            </p>
            <p className="mt-1 text-xs leading-relaxed text-brand-navy">
              수락서는 각 전문가별로 자동 생성됩니다. 동봉할 자료를 먼저 붙인 뒤
              위쪽 <strong>수락서 송신</strong> 버튼을 누르세요. 수락서는
              캐스트로그 화면에서만 열리며, 문자·이메일은 도착 안내입니다.
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
                  <span className="text-xs text-muted-foreground">
                    필요 {slot.requiredCount}명 · 후보 {slot.positions.length}명
                  </span>
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
                  canCancel={canCancel}
                  editable={canInput && projectState.stage === "assigning"}
                />
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
                  {canCancel && e.status === "requested" && (
                    <EngagementCancelButton engagementId={e.id} />
                  )}
                  {canCancel && e.status === "accepted" && (
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

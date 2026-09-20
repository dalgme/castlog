import { Check, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PROJECT_STAGE_LABELS,
  stageIndex,
  type ProjectStage,
} from "@/lib/integrations/project-stage";
import type { ProjectSettlement } from "@/lib/integrations/project-settlement";
import { buildSettlementDocument } from "@/lib/integrations/project-settlement";

import Link from "next/link";

import {
  ClosingAttachment,
  type SettlementAttachment,
} from "./closing-attachment";
import { ClosingStageButtons } from "./closing-stage-buttons";
import {
  SatisfactionForm,
  SatisfactionHint,
  SatisfactionProgress,
} from "./satisfaction-form";
import { SettlementPanel } from "./settlement-panel";
import {
  autoSettlementReady,
  type AutoSettlementStatus,
} from "@/lib/integrations/settlement-auto";

/**
 * 프로젝트 종료 및 지급 품의 탭.
 *
 * 마감은 순서가 있는 일이다: 참여율 → 만족도 → 회계 검토 → 종료·지급 품의.
 * 그래서 화면도 순서로 읽히게 만든다 — 위에 단계 띠를 두고, 각 단계는 카드
 * 하나로 분리하고, **지금 할 단계만 펼친다.** 끝난 단계는 접어서 결과만 보여
 * 주고, 아직 못 하는 단계는 왜 못 하는지 한 줄로 적는다.
 *
 * 예전에는 카드 하나 안에 네 구역이 세로로 늘어서 있어서, 다 끝난 참여율 입력
 * 폼과 아직 열리지 않은 회계 검토가 같은 무게로 보였다. 그 화면에서 담당자는
 * 자기가 무엇을 해야 하는지 알 수 없다.
 */

type Step = {
  no: number;
  title: string;
  /** 이 단계가 '진행 중'인 프로젝트 단계 */
  activeAt: ProjectStage[];
};

const STEPS: Step[] = [
  { no: 1, title: "참여율 배분", activeAt: ["closing"] },
  { no: 2, title: "전문가 평가·종료", activeAt: ["closing"] },
  { no: 3, title: "지급 품의서 검토", activeAt: ["settlement_review"] },
  { no: 4, title: "종료·지급 품의", activeAt: ["settled"] },
];

function StepRail({ stage }: { stage: ProjectStage }) {
  const index = stageIndex(stage);
  const closingIndex = stageIndex("closing");
  const reviewIndex = stageIndex("settlement_review");
  const settledIndex = stageIndex("settled");

  function stateOf(step: Step): "done" | "current" | "todo" {
    if (step.no <= 2) {
      if (index > closingIndex) return "done";
      return index === closingIndex ? "current" : "todo";
    }
    if (step.no === 3) {
      if (index > reviewIndex) return "done";
      return index === reviewIndex ? "current" : "todo";
    }
    return index >= settledIndex ? "done" : "todo";
  }

  return (
    <ol className="grid gap-1.5 sm:grid-cols-4">
      {STEPS.map((step) => {
        const state = stateOf(step);
        return (
          <li
            key={step.no}
            className={
              state === "current"
                ? "flex items-center gap-2 rounded-lg border-2 border-brand bg-brand/[0.06] px-2.5 py-2"
                : state === "done"
                  ? "flex items-center gap-2 rounded-lg border bg-white px-2.5 py-2"
                  : "flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-2"
            }
          >
            <span
              className={
                state === "done"
                  ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white"
                  : state === "current"
                    ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white"
                    : "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground"
              }
            >
              {state === "done" ? <Check className="h-3 w-3" /> : step.no}
            </span>
            <span
              className={
                state === "current"
                  ? "truncate text-xs font-bold text-brand-navy"
                  : "truncate text-xs text-muted-foreground"
              }
            >
              {step.title}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** 자동 생성 조건 한 줄 — 충족 여부를 앞에 표시 */
function ConditionLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className={ok ? "flex items-center gap-1.5 text-emerald-700" : "flex items-center gap-1.5 text-muted-foreground"}>
      <span
        className={
          ok
            ? "flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"
            : "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-neutral-300"
        }
        aria-hidden
      >
        {ok && <Check className="h-3 w-3" />}
      </span>
      {text}
    </p>
  );
}

/** 아직 열리지 않은 단계 — 왜 닫혀 있는지만 적는다 */
function LockedNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Lock className="mt-0.5 h-3 w-3 flex-none" aria-hidden />
      {children}
    </p>
  );
}

export function ClosingTab({
  projectId,
  settlement,
  hasExperts,
  canManage,
  canEvaluate,
  canReviewSettlement,
  isClosed,
  closedAt,
  autoStatus = null,
  approverOptions = [],
  attachmentsByEngagement = {},
  expertsLite = false,
}: {
  projectId: string;
  settlement: ProjectSettlement | null;
  hasExperts: boolean;
  canManage: boolean;
  canEvaluate: boolean;
  /** 지급품의서 열람 권한 (회계담당관·임원 이상) */
  canReviewSettlement: boolean;
  isClosed: boolean;
  closedAt: string | null;
  /** 지급 품의서 자동 생성 조건의 현재 상태 (기획 2026-09-21) — experts 모듈에서만 */
  autoStatus?: AutoSettlementStatus | null;
  /** 결재라인 직접 지정 후보 (기획 2026-08-30 — 18번) */
  approverOptions?: { id: string; name: string; gradeLabel: string }[];
  /** 참여 건별 증빙 첨부 (engagementId → 파일) — 기획 2026-08-30 */
  attachmentsByEngagement?: Record<string, SettlementAttachment>;
  /** 라이트 모드 — 지급 기능이 닫혀 있으므로 ③·④의 성격을 안내한다 (검수 A8) */
  expertsLite?: boolean;
}) {
  const stage: ProjectStage = settlement?.stage ?? "assigning";
  const inClosing = stage === "closing";
  const afterClosing =
    stage === "settlement_review" || stage === "settled";
  const rated = settlement
    ? settlement.lines.length - settlement.unratedCount
    : 0;
  const contributionTotal = settlement?.contributionTotal ?? 0;

  return (
    <div className="space-y-4">
      {/* 지금 어디인가 — 버튼이 왜 열리고 닫히는지의 근거 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm">프로젝트 종료 및 지급 품의</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={stage === "settled" ? "default" : "secondary"}>
              {PROJECT_STAGE_LABELS[stage]}
            </Badge>
            {isClosed && closedAt && (
              <span className="text-xs text-muted-foreground">
                {new Date(closedAt).toLocaleDateString("ko-KR")} 종료
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <StepRail stage={stage} />

          {stage === "confirmed" && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-brand bg-brand/[0.06] p-3">
              <p className="text-sm font-semibold text-brand-navy">
                전원 확정 — 이제 마감을 시작할 수 있습니다.
              </p>
              {canManage ? (
                <ClosingStageButtons
                  projectId={projectId}
                  mode="start"
                  disabledReason={null}
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  마감 시작은 레벨 3 이상(관리자)이 합니다 (권한 규칙).
                </span>
              )}
            </div>
          )}

          {!inClosing && !afterClosing && stage !== "confirmed" && (
            <LockedNote>
              섭외 확정 탭에서 모든 전문가의 평가·종료를 마치고 참여율 배분을 100%로 확정하면
              지급 품의서가 자동으로 만들어집니다. 전원 확정 뒤에는 손수 마감을 시작할 수도 있습니다.
            </LockedNote>
          )}

          {!hasExperts && (
            <LockedNote>
              전문가 모듈을 쓰지 않는 회사입니다. 참여율만 정리하면 종료됩니다.
            </LockedNote>
          )}

          {/* 라이트 모드 — 비용·지급 메뉴가 닫혀 있는데 종료가 '지급 품의' 개념을
              요구하면 담당자가 길을 잃는다 (검수 A8). 성격을 먼저 말해 준다 */}
          {hasExperts && expertsLite && (
            <LockedNote>
              라이트 모드 — 지급 기능을 쓰지 않으므로 ③·④의 ‘지급 품의’는
              금액 지급 없이 <strong>종료 확정 절차</strong>로만 진행됩니다.
              실제 정산은 회사 자체 회계로 처리하세요.
            </LockedNote>
          )}
        </CardContent>
      </Card>

      {/* ① 참여율 — 별도 탭으로 분리됐다 (기획 확정 2026-08-30). 단계 띠의
          ①이 어디로 갔는지 찾지 않도록, 합계와 가는 길만 여기 남긴다 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm">① 참여율 배분</CardTitle>
          <Badge variant={contributionTotal === 100 ? "default" : "secondary"}>
            합계 {contributionTotal}%
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            참여율 입력은{" "}
            <Link
              href="?tab=contrib"
              className="font-medium text-brand underline underline-offset-2"
            >
              참여율 배분 탭
            </Link>
            에서 합니다.{" "}
            {hasExperts
              ? "합계가 100%가 되어야 다음 단계(지급 품의 검토 요청)로 넘어갈 수 있습니다."
              : "참여율을 정리한 뒤 그 탭에서 종료를 상신합니다."}
          </p>
        </CardContent>
      </Card>

      {/* 지급 품의서 자동 생성 조건 (기획 2026-09-21) — 섭외 확정 탭의 평가·종료 + 참여율 확정 */}
      {hasExperts && autoStatus && !afterClosing && (
        <Card className="border-indigo-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">지급 품의서 자동 생성 조건</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p className="text-xs text-muted-foreground">
              아래 조건이 모두 갖춰지는 순간 지급 품의서가 자동으로 만들어지고 회계담당자 검토(③)로
              넘어갑니다. 버튼을 따로 누르지 않아도 됩니다.
            </p>
            <ConditionLine
              ok={autoStatus.acceptedCount > 0 && autoStatus.completedCount === autoStatus.acceptedCount}
              text={`섭외 확정 탭에서 모든 전문가 종료 처리 — ${autoStatus.completedCount}/${autoStatus.acceptedCount}건`}
            />
            <ConditionLine
              ok={autoStatus.acceptedCount > 0 && autoStatus.unratedCount === 0}
              text={
                autoStatus.unratedCount === 0
                  ? "모든 전문가 평가 입력 완료"
                  : `전문가 평가 미입력 ${autoStatus.unratedCount}건 (섭외 확정 탭의 '평가' 버튼)`
              }
            />
            <ConditionLine
              ok={autoStatus.contributionTotal === 100 && autoStatus.contributionConfirmed}
              text={
                autoStatus.contributionConfirmed
                  ? "참여율 배분 100% 확정"
                  : `참여율 배분 확정 전 (현재 ${autoStatus.contributionTotal}%${autoStatus.contributionTotal === 100 ? " — '확정' 버튼을 눌러 주세요" : ""})`
              }
            />
            {autoSettlementReady(autoStatus) && (
              <p className="text-xs font-semibold text-indigo-700">
                조건이 모두 갖춰졌습니다. 화면을 새로고침하면 ③ 지급 품의서 검토로 넘어가 있습니다.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ② 세션별 만족도 — 섭외 확정 탭의 평가와 같은 기록을 본다 (손수 마감하는 경로) */}
      {hasExperts && settlement && (inClosing || afterClosing) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm">② 세션별 전문가 만족도</CardTitle>
            <SatisfactionProgress done={rated} total={settlement.lines.length} />
          </CardHeader>
          <CardContent className="space-y-3">
            <SatisfactionHint readOnly={!inClosing || !canEvaluate} />
            {settlement.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                수락(확정)된 참여 건이 없습니다.
              </p>
            ) : (
              <ul className="divide-y">
                {settlement.lines.map((line) => (
                  <li key={line.engagementId} className="space-y-1">
                    <SatisfactionForm
                      projectId={projectId}
                      disabled={!canEvaluate || !inClosing}
                      row={{
                        expertId: line.expertId,
                        expertName: line.expertName,
                        slotId: line.slotId,
                        sessionName: line.sessionName,
                        schedule: line.schedule,
                        positionCode: line.positionCode,
                        satisfaction: line.satisfaction,
                        memo: line.memo,
                      }}
                    />
                    {/* 참여 건별 증빙 — 파일 1개, 선택 (기획 2026-08-30) */}
                    <div className="pb-2 pl-1">
                      <ClosingAttachment
                        projectId={projectId}
                        engagementId={line.engagementId}
                        attachment={attachmentsByEngagement[line.engagementId] ?? null}
                        canManage={canEvaluate}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {inClosing && canManage && (
              <div className="border-t pt-3">
                <ClosingStageButtons
                  projectId={projectId}
                  mode="request"
                  disabledReason={
                    contributionTotal !== 100
                      ? `참여율 합계가 100%가 아닙니다 (현재 ${contributionTotal}%).`
                      : settlement.unratedCount > 0
                        ? `만족도 미입력 ${settlement.unratedCount}건이 남았습니다.`
                        : null
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ③ 회계담당자 검토 */}
      {hasExperts && settlement && afterClosing && (
        <Card className={stage === "settlement_review" ? "border-brand" : undefined}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">③ 지급 품의 검토</CardTitle>
          </CardHeader>
          <CardContent>
            <SettlementPanel
            approverOptions={approverOptions}
              projectId={projectId}
              canReview={canReviewSettlement}
              summary={{
                expertCount: settlement.expertCount,
                lineCount: settlement.lines.length,
                totalGross: settlement.totalGross,
                totalWithholding: settlement.totalWithholding,
                totalNet: settlement.totalNet,
                document: buildSettlementDocument(settlement),
                note: settlement.settlementNote,
                reviewedAt: settlement.settlementReviewedAt,
                submitted: stage === "settled",
              }}
            />
          </CardContent>
        </Card>
      )}

    </div>
  );
}

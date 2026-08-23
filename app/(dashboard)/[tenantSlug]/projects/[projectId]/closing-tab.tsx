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

import { ProjectClosing, type StaffOption } from "./project-closing";
import { ClosingStageButtons } from "./closing-stage-buttons";
import {
  SatisfactionForm,
  SatisfactionHint,
  SatisfactionProgress,
} from "./satisfaction-form";
import { SettlementPanel } from "./settlement-panel";
import { ExpertReviewForm, type ExpertReviewTarget } from "./expert-review-form";

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
  { no: 2, title: "세션별 만족도", activeAt: ["closing"] },
  { no: 3, title: "지급 품의 검토", activeAt: ["settlement_review"] },
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
  hasApprovals,
  canManage,
  canEvaluate,
  canReviewSettlement,
  isClosed,
  closedAt,
  closingInProgress,
  staff,
  contributionInitial,
  reviewTargets,
}: {
  projectId: string;
  settlement: ProjectSettlement | null;
  hasExperts: boolean;
  hasApprovals: boolean;
  canManage: boolean;
  canEvaluate: boolean;
  /** 지급품의서 열람 권한 (회계담당관·임원 이상) */
  canReviewSettlement: boolean;
  isClosed: boolean;
  closedAt: string | null;
  closingInProgress: boolean;
  staff: StaffOption[];
  contributionInitial: Record<string, number>;
  reviewTargets: ExpertReviewTarget[];
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
                  마감 시작은 담당자(관리자 이상)가 합니다.
                </span>
              )}
            </div>
          )}

          {!inClosing && !afterClosing && stage !== "confirmed" && (
            <LockedNote>
              전문가 전원이 수락서를 승인해 <strong>확정</strong>된 뒤에 마감을
              시작할 수 있습니다. 진행 상황은 ‘섭외후보 등록’ 탭에서 봅니다.
            </LockedNote>
          )}

          {!hasExperts && (
            <LockedNote>
              전문가 모듈을 쓰지 않는 회사입니다. 참여율만 정리하면 종료됩니다.
            </LockedNote>
          )}
        </CardContent>
      </Card>

      {/* ① 참여율 */}
      {canEvaluate && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm">① 참여율 배분</CardTitle>
            <Badge variant={contributionTotal === 100 ? "default" : "secondary"}>
              합계 {contributionTotal}%
            </Badge>
          </CardHeader>
          <CardContent>
            {isClosed ? (
              <p className="text-sm text-muted-foreground">
                종료된 프로젝트입니다. 참여율은 임원 대시보드 성과 집계에
                반영됩니다.
              </p>
            ) : (
              <ProjectClosing
                projectId={projectId}
                staff={staff}
                initial={contributionInitial}
                closingInProgress={closingInProgress}
                approvalsActive={hasApprovals}
                contributionsOnly={hasExperts}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* ② 세션별 만족도 */}
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
                  <SatisfactionForm
                    key={line.engagementId}
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

      {/* ④ 정성 후기 — 선택이므로 접어 둔다 */}
      {hasExperts && canEvaluate && reviewTargets.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              ④ 전문가 정성 후기 <span className="font-normal text-muted-foreground">(선택)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                후기 남기기 · 지난 후기 보기 ({reviewTargets.length}명)
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                점수와 별개로 문장 기록을 남깁니다. 다음 섭외에서 후보 목록의{" "}
                <strong>평판</strong>으로 다시 보이며,{" "}
                <strong>전문가에게 공개되지 않습니다</strong>.
              </p>
              <ul className="mt-1 divide-y">
                {reviewTargets.map((row) => (
                  <ExpertReviewForm
                    key={row.expertId}
                    projectId={projectId}
                    target={row}
                  />
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

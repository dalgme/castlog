import Link from "next/link";

import type { ProjectDashboard } from "@/lib/integrations/project-dashboard";
import { Card, CardContent } from "@/components/ui/card";

/** 소진·진행률 바 (budget-panel과 동일한 표현을 재사용) */
function Bar({ value, warn }: { value: number; warn?: boolean }) {
  return (
    <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
      <div
        className={"h-full rounded-full " + (warn ? "bg-red-500" : "bg-brand")}
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}

/**
 * 프로젝트별 대시보드 — 담당자가 자기 프로젝트 상태를 한눈에 보는 요약.
 * 서버 컴포넌트(상호작용 없음).
 */
export function ProjectDashboardCards({
  tenantSlug,
  data,
  budgetAmount,
  committedCost,
  plName,
  pmName,
  deputyPmNames,
  modules,
}: {
  tenantSlug: string;
  data: ProjectDashboard;
  budgetAmount: number | null;
  /** 확정 + 요청중 섭외비 */
  committedCost: number;
  plName: string | null;
  pmName: string | null;
  deputyPmNames: string[];
  modules: { experts: boolean; approvals: boolean };
}) {
  const fillRate =
    data.positions.total > 0
      ? Math.round((data.positions.filled / data.positions.total) * 100)
      : 0;
  const stepRate =
    data.steps.total > 0
      ? Math.round((data.steps.done / data.steps.total) * 100)
      : 0;
  const budgetRate =
    budgetAmount && budgetAmount > 0
      ? Math.round((committedCost / budgetAmount) * 100)
      : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardContent className="space-y-2 pt-5">
          <p className="text-xs text-muted-foreground">책임자</p>
          <p className="text-sm font-medium">
            PL {plName ?? <span className="text-muted-foreground">미지정</span>}
          </p>
          <p className="text-sm font-medium">
            PM {pmName ?? <span className="text-muted-foreground">미지정</span>}
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">부PM</span>{" "}
            {deputyPmNames.length > 0 ? (
              deputyPmNames.join(", ")
            ) : (
              <span className="text-muted-foreground">미지정</span>
            )}
          </p>
        </CardContent>
      </Card>

      {modules.experts && (
        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="text-xs text-muted-foreground">TO 충원률</p>
            <p className="text-2xl font-semibold tabular-nums">
              {fillRate}
              <span className="ml-0.5 text-sm font-normal text-muted-foreground">
                %
              </span>
            </p>
            <Bar value={fillRate} />
            <p className="text-xs text-muted-foreground">
              확정 {data.positions.filled} · 요청중 {data.positions.requested} ·
              미섭외 {data.positions.open} / 전체 {data.positions.total}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-2 pt-5">
          <p className="text-xs text-muted-foreground">예산 소진</p>
          {budgetRate === null ? (
            <p className="pt-1 text-sm text-muted-foreground">
              총 예산이 설정되지 않았습니다.
            </p>
          ) : (
            <>
              <p className="text-2xl font-semibold tabular-nums">
                {budgetRate}
                <span className="ml-0.5 text-sm font-normal text-muted-foreground">
                  %
                </span>
              </p>
              <Bar value={budgetRate} warn={budgetRate > 100} />
              <p className="text-xs text-muted-foreground">
                확정+요청중 {committedCost.toLocaleString("ko-KR")}원 /{" "}
                {(budgetAmount ?? 0).toLocaleString("ko-KR")}원
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {modules.experts && (
        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="text-xs text-muted-foreground">수락서 진행</p>
            <p className="text-sm">
              작성중 {data.acceptances.issued} · 송부 {data.acceptances.sent} ·
              서명 {data.acceptances.signed} · 확인 {data.acceptances.confirmed}
            </p>
            {data.acceptances.signed > 0 && (
              <p className="text-xs text-brand">
                서명 완료 {data.acceptances.signed}건 — 담당자 확인이 필요합니다.
              </p>
            )}
            <Link
              href={`/${tenantSlug}/experts/engagements`}
              className="text-xs text-brand underline"
            >
              섭외 현황 보기
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-2 pt-5">
          <p className="text-xs text-muted-foreground">21스텝 진행</p>
          <p className="text-2xl font-semibold tabular-nums">
            {data.steps.done}
            <span className="text-sm font-normal text-muted-foreground">
              /{data.steps.total}
            </span>
          </p>
          <Bar value={stepRate} />
        </CardContent>
      </Card>

      {modules.approvals && (
        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="text-xs text-muted-foreground">미결 품의</p>
            <p className="text-2xl font-semibold tabular-nums">
              {data.openApprovals}
              <span className="ml-0.5 text-sm font-normal text-muted-foreground">
                건
              </span>
            </p>
            <Link
              href={`/${tenantSlug}/approvals`}
              className="text-xs text-brand underline"
            >
              결재함 보기
            </Link>
          </CardContent>
        </Card>
      )}

      {modules.experts && data.engagements.declined > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="text-xs text-muted-foreground">반려(거절) 섭외</p>
            <p className="text-2xl font-semibold tabular-nums text-destructive">
              {data.engagements.declined}
              <span className="ml-0.5 text-sm font-normal text-muted-foreground">
                건
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              해당 넘버링코드는 다시 미섭외 상태로 돌아갑니다.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

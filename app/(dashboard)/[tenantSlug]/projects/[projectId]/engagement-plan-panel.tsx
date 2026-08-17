"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ClipboardCheck, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

import { submitEngagementPlan, submitEngagementPlanChange } from "./plan-actions";

export type PlanPanelState = {
  required: boolean;
  allowed: boolean;
  state: "module_off" | "none" | "in_progress" | "rejected" | "approved" | "changed";
  message: string;
  revision: number | null;
  approvalId: string | null;
  plannedAmount: number | null;
  positionCount: number | null;
  currentPlannedAmount: number;
  currentPositionCount: number;
  currentSlotCount: number;
};

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/**
 * 섭외계획 품의 패널.
 * 섭외 테이블 확정 → 계획 품의 → 승인 → 섭외요청. 승인 후 테이블이 바뀌면
 * 변경 품의를 요구한다. approvals 모듈이 꺼진 테넌트에는 게이트를 표시하지 않는다.
 */
export function EngagementPlanPanel({
  tenantSlug,
  projectId,
  plan,
  canSubmit,
  approverOptions,
  hasProjectRule,
}: {
  tenantSlug: string;
  projectId: string;
  plan: PlanPanelState;
  canSubmit: boolean;
  /** 전결규정이 없을 때 직접 지정할 결재자 후보 (본인 제외 활성 직원) */
  approverOptions: { id: string; name: string; gradeLabel: string }[];
  hasProjectRule: boolean;
}) {
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!plan.required) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardCheck className="h-4 w-4" />
            섭외계획
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            전자결재 모듈이 비활성 상태입니다. 계획 품의 없이 섭외요청을 바로 보낼 수
            있습니다. 계획 섭외비{" "}
            <strong>{won(plan.currentPlannedAmount)}</strong> (인원{" "}
            {plan.currentPositionCount}명 / 타임테이블 {plan.currentSlotCount}건)
          </p>
        </CardContent>
      </Card>
    );
  }

  const isChange = plan.state === "changed";

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = isChange
        ? await submitEngagementPlanChange(projectId, note, approverIds)
        : await submitEngagementPlan(projectId, note, approverIds);
      if (res.ok) {
        setNote("");
        setApproverIds([]);
      } else {
        setError(res.error);
      }
    });
  }

  const badge =
    plan.state === "approved" ? (
      <Badge className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        승인 (R{plan.revision})
      </Badge>
    ) : plan.state === "in_progress" ? (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" />
        결재 진행중
      </Badge>
    ) : plan.state === "changed" ? (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        변경 품의 필요
      </Badge>
    ) : plan.state === "rejected" ? (
      <Badge variant="destructive">반려</Badge>
    ) : (
      <Badge variant="outline">미상신</Badge>
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <ClipboardCheck className="h-4 w-4" />
          섭외계획 품의
          {badge}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert variant={plan.allowed ? "default" : "destructive"}>
          <AlertDescription>{plan.message}</AlertDescription>
        </Alert>

        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-md border p-2.5">
            <p className="text-xs text-muted-foreground">현재 섭외 테이블</p>
            <p className="font-medium">
              {plan.currentPositionCount}명 / {plan.currentSlotCount}건
            </p>
          </div>
          <div className="rounded-md border p-2.5">
            <p className="text-xs text-muted-foreground">현재 계획 섭외비</p>
            <p className="font-medium">{won(plan.currentPlannedAmount)}</p>
          </div>
          <div className="rounded-md border p-2.5">
            <p className="text-xs text-muted-foreground">승인된 계획</p>
            <p className="font-medium">
              {plan.plannedAmount === null
                ? "-"
                : `${won(plan.plannedAmount)} · ${plan.positionCount}명`}
            </p>
          </div>
        </div>

        {plan.approvalId && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/${tenantSlug}/approvals/${plan.approvalId}`}>
              결재건 보기
            </Link>
          </Button>
        )}

        {canSubmit && plan.state !== "in_progress" && plan.state !== "approved" && (
          <div className="space-y-2 rounded-md border p-3">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <label className="text-sm font-medium">
              {isChange ? "변경 사유 (필수)" : "계획 설명 (선택)"}
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={
                isChange
                  ? "예: 멘토링 세션 2회 추가로 멘토 2명 증원, 예산 400만원 증액"
                  : "예: 2026년 창업도약패키지 본교육 섭외계획"
              }
            />
            {!hasProjectRule && (
              <div className="space-y-2 rounded-md border border-dashed p-2.5">
                <p className="text-xs text-muted-foreground">
                  ‘프로젝트’ 유형 전결규정이 없습니다. 결재자를 직접 지정하세요
                  (선택 순서대로 결재 단계가 됩니다).
                </p>
                {approverOptions.length === 0 ? (
                  <p className="text-xs text-destructive">
                    지정 가능한 결재자가 없습니다. 직원 계정을 먼저 등록하세요.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {approverOptions.map((opt) => {
                      const order = approverIds.indexOf(opt.id);
                      return (
                        <label
                          key={opt.id}
                          className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
                        >
                          <Checkbox
                            checked={order >= 0}
                            onCheckedChange={(checked) =>
                              setApproverIds((prev) =>
                                checked === true
                                  ? [...prev, opt.id]
                                  : prev.filter((id) => id !== opt.id)
                              )
                            }
                          />
                          <span>
                            {order >= 0 && (
                              <span className="mr-1 text-brand">{order + 1}차</span>
                            )}
                            {opt.name}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {opt.gradeLabel}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <Button size="sm" onClick={submit} disabled={pending}>
              {pending
                ? "상신 중..."
                : isChange
                  ? "계획 변경 품의 상신"
                  : "섭외계획 품의 상신"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ClipboardCheck, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

import { submitEngagementPlanChange } from "./plan-actions";

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
  /** 계획이 덮는 세션 집합 — null = 전체 (기획 2026-08-30 — 22번 부분 상신) */
  coveredSlotIds: string[] | null;
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
  relayOn = false,
  postReportOn = false,
  sessionSummary = [],
}: {
  tenantSlug: string;
  projectId: string;
  plan: PlanPanelState;
  canSubmit: boolean;
  /** 전결규정이 없을 때 직접 지정할 결재자 후보 (본인 제외 활성 직원) */
  approverOptions: { id: string; name: string; gradeLabel: string }[];
  /** 상급자 릴레이 결재(27번) 활성 — 무선택 시 동작 안내 분기 */
  relayOn?: boolean;
  /** 사후보고 모드(38번) — 변경·보완 상신이 즉시 확정되고 보고 문서만 간다 */
  postReportOn?: boolean;
  /** 세션별 필요인원·등록 후보인원 한눈 요약 (기획 확정 2026-08-23) */
  sessionSummary?: {
    slotId: string;
    label: string;
    required: number;
    candidates: number;
  }[];
}) {
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // 보완(추가) 상신 대상 세션 (기획 2026-08-30 — 22번): 부분 상신으로 계획
  // 밖에 남은 세션을 보완 후 변경 품의로 추가한다.
  const [extraSlotIds, setExtraSlotIds] = useState<string[]>([]);

  const covered = plan.coveredSlotIds;
  const uncoveredSessions =
    covered === null
      ? []
      : sessionSummary.filter((s) => !covered.includes(s.slotId));

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
            {plan.currentPositionCount}명 / 세션 {plan.currentSlotCount}건)
          </p>
        </CardContent>
      </Card>
    );
  }

  const isChange = plan.state === "changed";
  // 보완(추가) 상신 — 승인 상태에서도 계획 밖 세션이 있으면 추가할 수 있다
  const canAppend =
    plan.state === "approved" && uncoveredSessions.length > 0;

  function submit() {
    setError(null);
    startTransition(async () => {
      // 최초 상신은 이 패널에서 하지 않는다 — 위 '섭외 품의' 버튼이 유일한
      // 창구다. 같은 행위의 상신 UI가 둘이면 어느 쪽으로 승인받아도 반대쪽
      // 잠금이 안 풀리는 이중 구현이 됐었다(검수로 확인). 여기는 승인 후
      // 테이블이 바뀐 경우의 '변경 품의'와 세션 보완(추가) 품의만 담당한다.
      const slotIds =
        extraSlotIds.length > 0 && covered !== null
          ? [...covered, ...extraSlotIds]
          : []; // 빈 배열 = 기존 커버리지 유지 (서버 기본값)
      const res = await submitEngagementPlanChange(
        projectId,
        note,
        approverIds,
        slotIds
      );
      if (res.ok) {
        setNote("");
        setApproverIds([]);
        setExtraSlotIds([]);
      } else {
        setError(res.error);
      }
    });
  }

  // 상태별 구역 색 (기획 확정 2026-08-22) — 이 섹션이 화면에서 한눈에 잡히고,
  // 결재 진행 중/완료가 색으로 먼저 읽히게 한다
  const style =
    plan.state === "approved"
      ? {
          card: "border-emerald-300 bg-emerald-50/70",
          title: "text-emerald-900",
          chip: "bg-emerald-600 text-white",
          chipIcon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />,
          chipLabel: `결재 완료 (R${plan.revision})`,
        }
      : plan.state === "in_progress"
        ? {
            card: "border-amber-300 bg-amber-50/70",
            title: "text-amber-900",
            chip: "bg-amber-500 text-white",
            chipIcon: <Clock className="h-3.5 w-3.5 animate-pulse" aria-hidden />,
            chipLabel: "결재 진행 중",
          }
        : plan.state === "changed"
          ? {
              card: "border-rose-300 bg-rose-50/70",
              title: "text-rose-900",
              chip: "bg-rose-600 text-white",
              chipIcon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
              chipLabel: "변경 품의 필요",
            }
          : plan.state === "rejected"
            ? {
                card: "border-red-300 bg-red-50/70",
                title: "text-red-900",
                chip: "bg-red-600 text-white",
                chipIcon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
                chipLabel: "반려됨",
              }
            : {
                card: "border-violet-300 bg-violet-50/60",
                title: "text-violet-900",
                chip: "bg-violet-600 text-white",
                chipIcon: <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />,
                chipLabel: "미상신",
              };

  return (
    <Card className={style.card}>
      <CardHeader className="pb-3">
        <CardTitle
          className={`flex flex-wrap items-center gap-2 text-sm ${style.title}`}
        >
          <ClipboardCheck className="h-4 w-4" aria-hidden />
          섭외계획 품의
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${style.chip}`}
          >
            {style.chipIcon}
            {style.chipLabel}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert
          variant={plan.allowed ? "default" : "destructive"}
          className="bg-background"
        >
          <AlertDescription>{plan.message}</AlertDescription>
        </Alert>

        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-md border bg-background p-2.5">
            <p className="text-xs text-muted-foreground">현재 세션 계획</p>
            <p className="font-medium">
              {plan.currentPositionCount}명 / {plan.currentSlotCount}건
            </p>
          </div>
          <div className="rounded-md border bg-background p-2.5">
            <p className="text-xs text-muted-foreground">현재 계획 섭외비</p>
            <p className="font-medium">{won(plan.currentPlannedAmount)}</p>
          </div>
          <div className="rounded-md border bg-background p-2.5">
            <p className="text-xs text-muted-foreground">승인된 계획</p>
            <p className="font-medium">
              {plan.plannedAmount === null
                ? "-"
                : `${won(plan.plannedAmount)} · ${plan.positionCount}명`}
            </p>
          </div>
        </div>

        {sessionSummary.length > 0 && (
          <div className="rounded-md border bg-background p-2.5">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">
              세션별 필요인원 · 등록 후보인원
            </p>
            <ul className="space-y-0.5 text-xs">
              {sessionSummary.map((row) => {
                const outOfPlan =
                  covered !== null && !covered.includes(row.slotId);
                return (
                  <li
                    key={row.slotId}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">
                      {row.label}
                      {outOfPlan && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-900">
                          계획 미포함
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      필요 {row.required}명 · 후보 {row.candidates}명
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {plan.approvalId && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/${tenantSlug}/approvals/${plan.approvalId}`}>
              결재건 보기
            </Link>
          </Button>
        )}

        {canSubmit && !isChange && plan.state !== "in_progress" && plan.state !== "approved" && (
          <p className="rounded-md border bg-background p-2.5 text-xs text-muted-foreground">
            상신은 화면 위 <b>‘섭외 품의서 자동 작성 및 송신’</b> 버튼으로
            합니다. 자리 배정을 모두
            마치면 버튼이 활성화됩니다.
          </p>
        )}

        {canSubmit && (isChange || canAppend) && (
          <div className="space-y-2 rounded-md border bg-background p-3">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!isChange && canAppend && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                승인된 계획에 포함되지 않은 세션이 {uncoveredSessions.length}개
                있습니다. 보완이 끝난 세션을 골라 <b>추가 품의</b>를 올리면 승인
                후 그 세션의 섭외도 진행할 수 있습니다.
              </p>
            )}
            {postReportOn && (
              <p className="rounded-md bg-[#FF6F61]/10 p-2 text-xs leading-relaxed text-[#b3483d]">
                사후보고 모드 — 이 상신은 즉시 확정되고 상급자에게는 보고
                문서만 갑니다(확인·피드백). 금액이 상한·전결규정 구간에 걸리면
                서버가 사전 품의로 돌립니다.
              </p>
            )}
            {uncoveredSessions.length > 0 && (
              <div className="space-y-1 rounded-md border border-dashed p-2.5">
                <p className="text-xs font-semibold text-muted-foreground">
                  계획에 추가할 세션 선택
                </p>
                {uncoveredSessions.map((row) => (
                  <label
                    key={row.slotId}
                    className="flex cursor-pointer items-center gap-2 text-xs"
                  >
                    <Checkbox
                      checked={extraSlotIds.includes(row.slotId)}
                      onCheckedChange={(v) =>
                        setExtraSlotIds((prev) =>
                          v === true
                            ? [...prev, row.slotId]
                            : prev.filter((id) => id !== row.slotId)
                        )
                      }
                    />
                    <span className="truncate">{row.label}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                      필요 {row.required}명 · 후보 {row.candidates}명
                    </span>
                  </label>
                ))}
              </div>
            )}
            <label className="text-sm font-medium">
              {isChange ? "변경 사유 (필수)" : "추가 사유 (필수)"}
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="예: 멘토링 세션 2회 추가로 멘토 2명 증원, 예산 400만원 증액"
            />
            {/* 항상 표시 (기획 개정 2026-08-30 — 30번): 후보 = 상위 직급만,
                마지막은 상무이사 → 대표 고정 */}
            <div className="space-y-2 rounded-md border border-dashed p-2.5">
                <p className="text-xs text-muted-foreground">
                  결재자를 직접 지정할 수 있습니다 (선택 순서대로 결재 단계).{" "}
                  {relayOn ? (
                    <>
                      결재자를 고르면 그 뒤에 <b>상무이사 → 대표 (고정)</b>가
                      붙고, 비워 두면 상급자 릴레이(직급 단계)로 상신됩니다.
                    </>
                  ) : (
                    <>
                      선택과 무관하게 마지막은 <b>상무이사 → 대표 (고정)</b>로
                      자동 연결됩니다. 비워 두면 고정 결재선만으로 상신됩니다.
                    </>
                  )}
                </p>
                {approverOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    중간에 넣을 상위 직급 결재자가 없습니다 —{" "}
                    {relayOn
                      ? "상급자 릴레이(직급 단계)로 상신됩니다."
                      : "고정 결재선(상무이사 → 대표)으로 상신됩니다."}
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

            <Button
              size="sm"
              onClick={submit}
              disabled={
                pending || (!isChange && canAppend && extraSlotIds.length === 0)
              }
            >
              {pending
                ? "상신 중..."
                : isChange
                  ? "계획 변경 품의 상신"
                  : `선택 세션 추가 품의 상신 (${extraSlotIds.length}개)`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

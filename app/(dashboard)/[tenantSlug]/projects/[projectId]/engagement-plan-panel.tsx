"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { ClipboardCheck, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { submitEngagementPlanChange } from "./plan-actions";

/** 라벨은 워크벤치 세션 칩과 같은 사전을 쓴다 (리뷰 L5) — server-only 모듈이라 값만 복제 */
const STATE_LABELS: Record<PlanPanelPlan["state"], string> = {
  approved: "승인",
  in_progress: "결재 중",
  changed: "변경 품의 필요",
  rejected: "반려 · 재상신 필요",
  draft: "임시",
};
const STATE_RANK: Record<PlanPanelPlan["state"], number> = {
  approved: 5,
  changed: 4,
  in_progress: 3,
  rejected: 2,
  draft: 1,
};

/** 살아 있는 계획 하나 (다중 계획 — 기획 지시 2026-09-05) */
export type PlanPanelPlan = {
  id: string;
  revision: number;
  state: "in_progress" | "approved" | "changed" | "rejected" | "draft";
  approvalId: string | null;
  plannedAmount: number;
  positionCount: number;
  slotCount: number;
  /** 계획이 덮는 세션 — null = 전체(세션 구분 없는 옛 계획) */
  coveredSlotIds: string[] | null;
  sessionLabels: string[];
  message: string;
  /** 38번: 사후보고로 확정된 계획 */
  postReport: boolean;
  /**
   * 이 계획에 대한 최근 변경 품의 반려 사유 — 반려되면 승인 계획은 그대로
   * 살아 있고(E2E 검수 P1-1) 이 사유만 남는다.
   */
  lastChangeRejection: string | null;
};

export type PlanPanelState = {
  required: boolean;
  /** 승인돼 발송 가능한 계획이 하나라도 있는가 */
  allowed: boolean;
  /** 대표 상태 — 세션별 판정은 slotStates가 진실 */
  state: "module_off" | "none" | "in_progress" | "rejected" | "approved" | "changed";
  message: string;
  /** 발송 가능 커버리지(승인 계획 합집합) — null = 전체 */
  coveredSlotIds: string[] | null;
  /** 살아 있는 계획 전부 (최신 리비전 먼저) */
  plans: PlanPanelPlan[];
  /** 어느 살아 있는 계획에도 없는 세션 */
  uncoveredSlotIds: string[];
  currentPlannedAmount: number;
  currentPositionCount: number;
  currentSlotCount: number;
};

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const PLAN_STYLE: Record<
  PlanPanelPlan["state"],
  { card: string; chip: string; label: string; icon: React.ReactNode }
> = {
  approved: {
    card: "border-emerald-300 bg-emerald-50/70",
    chip: "bg-emerald-600 text-white",
    label: STATE_LABELS.approved,
    icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />,
  },
  in_progress: {
    card: "border-amber-300 bg-amber-50/70",
    chip: "bg-amber-500 text-white",
    label: STATE_LABELS.in_progress,
    icon: <Clock className="h-3.5 w-3.5 animate-pulse" aria-hidden />,
  },
  changed: {
    card: "border-rose-300 bg-rose-50/70",
    chip: "bg-rose-600 text-white",
    label: STATE_LABELS.changed,
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
  },
  rejected: {
    card: "border-red-300 bg-red-50/70",
    chip: "bg-red-600 text-white",
    label: STATE_LABELS.rejected,
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
  },
  draft: {
    card: "border-violet-300 bg-violet-50/60",
    chip: "bg-violet-600 text-white",
    label: STATE_LABELS.draft,
    icon: <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />,
  },
};

/**
 * 섭외계획 품의 패널 (다중 계획 — 기획 지시 2026-09-05).
 * 세션 묶음마다 계획이 따로 살아 있다. 각 계획의 상태·담긴 세션·금액을 카드로
 * 보여 주고, 승인 뒤 내용이 바뀐 계획에는 그 계획의 변경 품의 창구를 붙인다.
 * 새 상신(미상신 세션)은 화면 위 '섭외 품의서 자동 작성 및 송신' 버튼이 유일한
 * 창구다 — 같은 행위의 상신 UI가 둘이면 이중 구현이 된다(검수로 확인).
 * approvals 모듈이 꺼진 테넌트에는 게이트를 표시하지 않는다.
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
  /** 사후보고 모드(38번) — 변경 상신이 즉시 확정되고 보고 문서만 간다 */
  postReportOn?: boolean;
  /** 세션별 필요인원·등록 후보인원 한눈 요약 (기획 확정 2026-08-23) */
  sessionSummary?: {
    slotId: string;
    label: string;
    required: number;
    candidates: number;
  }[];
}) {
  const { toast } = useToast();
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** 변경 품의 창구가 열린 계획 */
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);

  const uncovered = new Set(plan.uncoveredSlotIds);
  const uncoveredSessions = sessionSummary.filter((s) => uncovered.has(s.slotId));

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

  function submitChange(planId: string) {
    setError(null);
    startTransition(async () => {
      const res = await submitEngagementPlanChange(
        projectId,
        note,
        approverIds,
        [],
        planId
      );
      if (res.ok) {
        setNote("");
        setApproverIds([]);
        setChangingPlanId(null);
        // 사후보고 모드에서도 금액·규정에 따라 사전 품의로 갈 수 있다 — 결과를 말한다
        toast({
          description:
            res.flow === "post_report"
              ? "변경 내용이 즉시 확정되었습니다 (사후보고). 상급자에게 보고 문서가 갑니다."
              : postReportOn
                ? "금액·전결규정 조건에 따라 사전 품의로 상신되었습니다 (규칙). 결재가 끝나야 반영됩니다."
                : "변경 품의를 상신했습니다. 결재가 끝나야 반영됩니다.",
        });
      } else {
        setError(res.error);
      }
    });
  }

  const headStyle =
    plan.state === "approved"
      ? "border-emerald-300 bg-emerald-50/40"
      : plan.state === "in_progress"
        ? "border-amber-300 bg-amber-50/40"
        : plan.state === "changed"
          ? "border-rose-300 bg-rose-50/40"
          : plan.state === "rejected"
            ? "border-red-300 bg-red-50/40"
            : "border-violet-300 bg-violet-50/40";

  return (
    <Card className={headStyle}>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <ClipboardCheck className="h-4 w-4" aria-hidden />
          섭외계획 품의
          <span className="text-xs font-normal text-muted-foreground">
            세션 묶음마다 별도 품의 · {plan.plans.length}건 진행
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
            <p className="text-xs text-muted-foreground">승인된 계획 합계</p>
            <p className="font-medium">
              {(() => {
                const approved = plan.plans.filter((p) => p.state === "approved");
                if (approved.length === 0) return "-";
                const amount = approved.reduce((s, p) => s + p.plannedAmount, 0);
                const count = approved.reduce((s, p) => s + p.positionCount, 0);
                return `${won(amount)} · ${count}명 · ${approved.length}건`;
              })()}
            </p>
          </div>
        </div>

        {/* 계획별 카드 */}
        {plan.plans.length > 0 && (
          <ul className="space-y-2">
            {plan.plans.map((p) => {
              const style = PLAN_STYLE[p.state];
              const changing = changingPlanId === p.id;
              return (
                <li
                  key={p.id}
                  className={cn("space-y-2 rounded-md border p-3", style.card)}
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">v{p.revision}</span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        style.chip
                      )}
                    >
                      {style.icon}
                      {style.label}
                    </span>
                    {p.postReport && (
                      <span className="rounded-full bg-brand-coral/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-coral-ink">
                        사후보고
                      </span>
                    )}
                    <span className="ml-auto tabular-nums text-xs text-muted-foreground">
                      {won(p.plannedAmount)} · {p.positionCount}명 · 세션 {p.slotCount}건
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.sessionLabels.length > 0
                      ? p.sessionLabels.join(" · ")
                      : "세션 구분 없음 (전체)"}
                  </p>
                  <p className="text-xs">{p.message}</p>
                  {p.lastChangeRejection && (
                    <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs leading-relaxed text-amber-900">
                      이 계획의 최근 변경 품의가 <b>반려</b>되었습니다 — 사유:{" "}
                      {p.lastChangeRejection}
                      <br />
                      승인 계획은 그대로 유효합니다. 내용을 조정한 뒤 다시 상신하세요.
                    </p>
                  )}
                  {p.state === "rejected" && (
                    <p className="text-xs text-muted-foreground">
                      후보·예정가를 조정한 뒤 화면 위{" "}
                      <b>‘섭외 품의서 자동 작성 및 송신’</b>에서 이 세션들을 골라
                      다시 상신하세요.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {p.approvalId && (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/${tenantSlug}/approvals/${p.approvalId}`}>
                          결재건 보기
                        </Link>
                      </Button>
                    )}
                    {canSubmit &&
                      (p.state === "changed" || p.state === "approved") &&
                      !changing && (
                        <Button
                          size="sm"
                          variant={p.state === "changed" ? "default" : "ghost"}
                          onClick={() => {
                            // 카드마다 폼 상태를 새로 연다 — 다른 계획에 적던
                            // 사유·결재자가 따라오지 않게 (리뷰 L3)
                            setError(null);
                            setNote("");
                            setApproverIds([]);
                            setChangingPlanId(p.id);
                          }}
                        >
                          {p.state === "changed"
                            ? "계획 변경 품의 상신"
                            : "변경 품의…"}
                        </Button>
                      )}
                  </div>

                  {canSubmit && changing && (
                    <div className="space-y-2 rounded-md border bg-background p-3">
                      {error && (
                        <Alert variant="destructive">
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      )}
                      {p.state === "approved" && (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          이 계획의 세션 내용(인원·비용·일정)이 승인 시점과 같으면
                          상신되지 않습니다. 먼저 후보·예정가를 조정하세요.
                        </p>
                      )}
                      {postReportOn && (
                        <p className="rounded-md bg-brand-coral/10 p-2 text-xs leading-relaxed text-brand-coral-ink">
                          사후보고 모드 — 이 상신은 즉시 확정되고 상급자에게는 보고
                          문서만 갑니다(확인·피드백). 금액이 상한·전결규정 구간에
                          걸리면 서버가 사전 품의로 돌립니다.
                        </p>
                      )}
                      <label className="text-sm font-medium">변경 사유 (필수)</label>
                      <Textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                        placeholder="예: 멘토 1명 교체, 예정가 50만원 조정"
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
                                      <span className="mr-1 text-brand">
                                        {order + 1}차
                                      </span>
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
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setChangingPlanId(null)}
                        >
                          닫기
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => submitChange(p.id)}
                          disabled={pending}
                        >
                          {pending ? "상신 중..." : `v${p.revision} 변경 품의 상신`}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* 세션별 요약 — 어느 세션이 어느 계획에 담겼는지 */}
        {sessionSummary.length > 0 && (
          <div className="rounded-md border bg-background p-2.5">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">
              세션별 필요인원 · 등록 후보인원
            </p>
            <ul className="space-y-0.5 text-xs">
              {sessionSummary.map((row) => {
                // 여러 계획이 겹쳐 보이는 예외(옛 전체 계획)는 상태 우선순위로
                // 고른다 — 서버 slotStates와 같은 규칙 (리뷰 L4)
                const owner = plan.plans
                  .filter(
                    (p) =>
                      p.coveredSlotIds === null ||
                      p.coveredSlotIds.includes(row.slotId)
                  )
                  .sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state])[0];
                return (
                  <li
                    key={row.slotId}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">
                      {row.label}
                      {owner ? (
                        <span
                          className={cn(
                            "ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold",
                            owner.state === "approved"
                              ? "bg-emerald-100 text-emerald-900"
                              : owner.state === "in_progress"
                                ? "bg-amber-100 text-amber-900"
                                : owner.state === "changed"
                                  ? "bg-rose-100 text-rose-900"
                                  : "bg-red-100 text-red-900"
                          )}
                        >
                          v{owner.revision} {STATE_LABELS[owner.state]}
                        </span>
                      ) : (
                        <span className="ml-1.5 rounded bg-violet-100 px-1 py-0.5 text-[10px] font-semibold text-violet-900">
                          미상신
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

        {canSubmit && uncoveredSessions.length > 0 && (
          <p className="rounded-md border bg-background p-2.5 text-xs leading-relaxed text-muted-foreground">
            아직 품의에 담기지 않은 세션이 {uncoveredSessions.length}개 있습니다.
            결재 중인 계획이 있어도 화면 위{" "}
            <b>‘섭외 품의서 자동 작성 및 송신’</b>에서 이 세션들을 골라 별도
            품의로 올릴 수 있습니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

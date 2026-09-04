"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  GRADE_LABELS,
  USER_GRADES,
  type UserGrade,
} from "@/lib/auth/grades";

import { setPostReportSettings } from "./post-report-actions";

/** 레벨 숫자만으로는 어느 자리인지 안 읽힌다 — 통상 호칭을 함께 적는다 */
const GRADE_HINT: Record<UserGrade, string> = {
  ceo: "대표",
  director: "이사",
  team_lead: "팀장",
  deputy: "대리",
  senior: "주임",
  staff: "사원",
};

/**
 * 섭외 사후보고 모드 카드 (기획 확정 2026-08-30 — 38번).
 * 대표·'전결규정' 위임자에게만 렌더링된다 (서버 액션이 다시 검증).
 */
export function PostReportPanel({
  enabled,
  minGrade,
  maxAmount,
}: {
  enabled: boolean;
  minGrade: UserGrade;
  maxAmount: number | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draftGrade, setDraftGrade] = useState<UserGrade>(minGrade);
  const [draftAmount, setDraftAmount] = useState<string>(
    maxAmount === null ? "" : String(maxAmount)
  );

  function save(nextEnabled: boolean) {
    setError(null);
    if (nextEnabled && !enabled) {
      // 결재 흐름을 바꾸는 설정 — 2단계 확인 (§14-3)
      const ok = window.confirm(
        "섭외 사후보고 모드를 켭니다.\n\n" +
          "후보 배정을 마친 담당자가 승인 없이 섭외를 확정하고 바로 섭외 문자를 보낼 수 있습니다. " +
          "상급자에게는 '사후보고' 문서가 가며, 확인하거나 피드백을 남길 수 있지만 이미 진행된 섭외를 되돌리지는 않습니다.\n\n" +
          "지급 품의는 그대로 사전 결재이며, 전결규정이 정한 금액 구간과 아래 금액 상한을 넘는 건은 사전 품의로 올라갑니다."
      );
      if (!ok) return;
    }
    const amount = draftAmount.trim() === "" ? null : Number(draftAmount.replace(/,/g, ""));
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError("금액 상한은 숫자로 입력하세요 (비우면 무제한).");
      return;
    }
    startTransition(async () => {
      const res = await setPostReportSettings({
        enabled: nextEnabled,
        minGrade: draftGrade,
        maxAmount: amount,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast({
        description: nextEnabled
          ? "사후보고 모드를 저장했습니다."
          : "사후보고 모드를 껐습니다 — 이후 상신은 사전 품의로 올라갑니다.",
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4" aria-hidden />
          섭외 사후보고 모드
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              enabled ? "bg-emerald-600 text-white" : "bg-secondary text-muted-foreground"
            }`}
          >
            {enabled ? "사용 중" : "꺼짐"}
          </span>
        </p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        소규모 회사용 운영 방식입니다. 켜면 아래 직급 이상 담당자는 후보 배정을
        마친 뒤 <b>승인 없이 섭외를 확정</b>하고 바로 섭외 문자를 보낼 수 있습니다.
        상급자에게는 <b>사후보고</b> 문서가 가서 확인·피드백만 받습니다(진행을
        되돌리지 않음). 실행 권한 자체(레벨별 문턱)는 그대로이며, 지급 품의는
        항상 사전 결재입니다. 전결규정이 정한 금액 구간과 아래 금액 상한을 넘는
        건은 자동으로 사전 품의로 올라갑니다.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="post-report-grade" className="text-xs">
            사후보고로 진행할 수 있는 최소 직급
          </Label>
          <select
            id="post-report-grade"
            value={draftGrade}
            onChange={(e) => setDraftGrade(e.target.value as UserGrade)}
            disabled={pending}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            {USER_GRADES.filter((g) => g !== "ceo").map((g) => (
              <option key={g} value={g}>
                {GRADE_LABELS[g]} ({GRADE_HINT[g]}) 이상
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="post-report-amount" className="text-xs">
            계획 섭외비 상한 (원, 비우면 무제한)
          </Label>
          <Input
            id="post-report-amount"
            inputMode="numeric"
            placeholder="예: 3000000"
            value={draftAmount}
            onChange={(e) => setDraftAmount(e.target.value)}
            disabled={pending}
            className="h-9"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {enabled ? (
          <>
            <Button size="sm" onClick={() => save(true)} disabled={pending}>
              {pending ? "저장 중..." : "설정 저장"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => save(false)} disabled={pending}>
              사후보고 모드 끄기
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => save(true)} disabled={pending}>
            {pending ? "저장 중..." : "사후보고 모드 켜기"}
          </Button>
        )}
      </div>
    </div>
  );
}

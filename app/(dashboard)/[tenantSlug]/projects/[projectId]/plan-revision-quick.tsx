"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, Zap } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { submitEngagementPlanChange } from "./plan-actions";

/**
 * 긴급 취소된 자리의 후속 창구 (기획 지시 2026-09-21): 후보를 바꿔 넣은 뒤
 *  - '변경 품의 재상신' = 결재선을 다시 타는 계획 변경 품의
 *  - '긴급 진행(전결)'  = 결재를 기다리지 않고 즉시 확정(사후보고 문서로 상급자에게 보고)
 * 둘 다 그 자리가 담긴 승인 계획(planId)의 변경으로 올라간다.
 */
export function PlanRevisionQuick({
  projectId,
  planId,
  canUrgent,
}: {
  projectId: string;
  /** 이 세션이 담긴 승인 계획 — 없으면(세션 구분 없는 옛 계획) 서버가 유일한 승인 계획으로 간주 */
  planId: string | null;
  /** 전결 권한 — 팀장 이상(manager·org_admin) */
  canUrgent: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [mode, setMode] = useState<"resubmit" | "urgent" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setMode(null);
    setReason("");
    setError(null);
  }

  function submit() {
    if (!mode) return;
    setError(null);
    startTransition(async () => {
      const r = await submitEngagementPlanChange(projectId, reason, [], [], planId, {
        urgent: mode === "urgent",
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({
        description:
          r.flow === "post_report"
            ? "즉시 확정되었습니다 (전결·사후보고). 상급자에게 보고 문서가 갑니다. 이제 섭외 문자를 보낼 수 있습니다."
            : "변경 품의를 상신했습니다. 결재가 끝나면 섭외 문자를 보낼 수 있습니다.",
      });
      close();
      router.refresh();
    });
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-1.5 text-[10px]"
          title="후보를 바꿔 넣었다면 결재선을 다시 타는 변경 품의를 올립니다"
          onClick={() => setMode("resubmit")}
        >
          <FileSignature className="mr-0.5 h-3 w-3" aria-hidden />
          변경 품의 재상신
        </Button>
        {canUrgent && (
          <Button
            type="button"
            size="sm"
            className="h-6 bg-orange-600 px-1.5 text-[10px] text-white hover:bg-orange-700"
            title="결재를 기다리지 않고 즉시 확정합니다 (전결). 상급자에게는 사후보고 문서가 갑니다"
            onClick={() => setMode("urgent")}
          >
            <Zap className="mr-0.5 h-3 w-3" aria-hidden />
            긴급 진행(전결)
          </Button>
        )}
      </span>
      <Dialog open={mode !== null} onOpenChange={(v) => !v && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === "urgent" ? "긴급 진행(전결) — 즉시 확정할까요?" : "변경 품의를 다시 올릴까요?"}
            </DialogTitle>
            <DialogDescription>
              {mode === "urgent"
                ? "결재선을 거치지 않고 현재 섭외 테이블(후보·금액)을 즉시 확정합니다. 상급자에게는 사후보고 문서가 자동으로 갑니다. 전결 책임은 처리한 사람에게 있습니다."
                : "현재 섭외 테이블(후보·금액)로 계획 변경 품의를 상신합니다. 결재가 끝나야 섭외 문자를 보낼 수 있습니다."}
              {" "}긴급 취소된 자리에 새 후보를 아직 배정하지 않았다면 「섭외후보 등록」 탭에서 먼저 배정하세요 — 달라진 내용이 없으면 상신되지 않습니다.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={mode === "urgent" ? "긴급 진행 사유 (필수) — 예: 행사 3일 전 긴급 취소로 대체 인력 즉시 확정" : "변경 사유 (필수)"}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={pending}>
              닫기
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={pending || !reason.trim()}
              className={mode === "urgent" ? "bg-orange-600 text-white hover:bg-orange-700" : undefined}
            >
              {pending ? "처리 중…" : mode === "urgent" ? "즉시 확정(전결)" : "변경 품의 상신"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

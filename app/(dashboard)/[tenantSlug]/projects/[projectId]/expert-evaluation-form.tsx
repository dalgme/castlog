"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

import { upsertExpertEvaluation } from "./evaluation-actions";

export type ExpertEvaluationRow = {
  expertId: string;
  engagementId: string;
  name: string;
  score: number | null;
  reason: string | null;
};

const SCORES = Array.from({ length: 10 }, (_, i) => i + 1);

/**
 * 단계 27: 전문가 프로젝트 종료 평가 입력 (대표 피드백 ①).
 * 점수 10점 만점 필수 · 사유 선택. 평가 완료 전에는 지급 품의를 올릴 수 없다.
 * 평가는 전문가에게 비공개 — 회사만 열람.
 */
export function ExpertEvaluationForm({
  projectId,
  row,
}: {
  projectId: string;
  row: ExpertEvaluationRow;
}) {
  const [score, setScore] = useState<string>(
    row.score !== null ? String(row.score) : ""
  );
  const [reason, setReason] = useState<string>(row.reason ?? "");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const evaluated = row.score !== null;

  function onSave() {
    const scoreNum = Number(score);
    if (!score || Number.isNaN(scoreNum)) {
      toast({ variant: "destructive", description: "평가 점수를 선택하세요." });
      return;
    }
    startTransition(async () => {
      const result = await upsertExpertEvaluation({
        projectId,
        expertId: row.expertId,
        engagementId: row.engagementId,
        score: scoreNum,
        reason: reason.trim() || undefined,
      });
      if (result.ok) {
        toast({ description: `${row.name} 전문가 평가를 저장했습니다.` });
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{row.name}</span>
        {evaluated ? (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
            평가 완료 · {row.score}점
          </span>
        ) : (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
            평가 미완료
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Select value={score} onValueChange={setScore} disabled={pending}>
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue placeholder="점수" />
            </SelectTrigger>
            <SelectContent>
              {SCORES.map((value) => (
                <SelectItem key={value} value={String(value)} className="text-xs">
                  {value}점
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" disabled={pending} onClick={onSave}>
            {pending ? "저장 중..." : "저장"}
          </Button>
        </div>
      </div>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={pending}
        rows={2}
        maxLength={1000}
        placeholder="평가 사유 (선택) — 회사 내부 기록이며 전문가에게 공개되지 않습니다."
        className="text-sm"
      />
    </li>
  );
}

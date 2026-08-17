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

import { addExpertReview } from "../../experts/tag-actions";

import { upsertExpertEvaluation } from "./evaluation-actions";

export type ExpertReviewRow = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
};

export type ExpertEvaluationRow = {
  expertId: string;
  engagementId: string;
  name: string;
  score: number | null;
  reason: string | null;
  /** 정성 후기 — 정량 점수와 별개로 여러 건 누적된다 */
  reviews: ExpertReviewRow[];
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
  const [review, setReview] = useState("");
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

  function onAddReview() {
    if (!review.trim()) {
      toast({ variant: "destructive", description: "후기 내용을 입력하세요." });
      return;
    }
    startTransition(async () => {
      const result = await addExpertReview(row.expertId, review, projectId);
      if (result.ok) {
        setReview("");
        toast({ description: `${row.name} 전문가 후기를 남겼습니다.` });
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

      <div className="space-y-1.5 rounded-md border bg-secondary/20 p-2.5">
        <p className="text-xs font-medium text-muted-foreground">
          후기 (정성) — 점수와 별개로 여러 건 남길 수 있습니다. 전문가에게 공개되지
          않습니다.
        </p>
        {row.reviews.length > 0 && (
          <ul className="space-y-1">
            {row.reviews.map((r) => (
              <li key={r.id} className="rounded border bg-white p-2 text-xs">
                <p className="whitespace-pre-wrap">{r.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {r.authorName ?? "작성자"} ·{" "}
                  {new Date(r.createdAt).toLocaleDateString("ko-KR")}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-1.5">
          <Textarea
            value={review}
            onChange={(e) => setReview(e.target.value)}
            disabled={pending}
            rows={2}
            maxLength={2000}
            placeholder="예: 현장 진행이 매끄럽고 참여자 반응이 좋았음. 다음 기수에도 우선 섭외 권장."
            className="text-sm"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || !review.trim()}
            onClick={onAddReview}
          >
            후기 등록
          </Button>
        </div>
      </div>
    </li>
  );
}

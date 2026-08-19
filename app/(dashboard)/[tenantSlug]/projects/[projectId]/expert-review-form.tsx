"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { addExpertReview } from "../../experts/tag-actions";

export type ExpertReviewRow = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
};

export type ExpertReviewTarget = {
  expertId: string;
  name: string;
  /** 이 프로젝트에서 참여한 세션 이름들 — 후기를 쓰는 맥락 */
  sessions: string[];
  reviews: ExpertReviewRow[];
};

/**
 * 정성 후기 — 점수와 별개로 여러 건 쌓인다.
 *
 * 점수(만족도)는 세션 단위로 마감 탭에서 매기고, 여기는 사람에 대한 문장 기록이다.
 * "다음 기수에도 우선 섭외" 같은 판단은 숫자로 남지 않는다.
 * 전문가에게 공개되지 않는다.
 */
export function ExpertReviewForm({
  projectId,
  target,
}: {
  projectId: string;
  target: ExpertReviewTarget;
}) {
  const router = useRouter();
  const [review, setReview] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onAddReview() {
    if (!review.trim()) {
      toast({ variant: "destructive", description: "후기 내용을 입력하세요." });
      return;
    }
    startTransition(async () => {
      const result = await addExpertReview(target.expertId, review, projectId);
      if (result.ok) {
        setReview("");
        toast({ description: `${target.name} 전문가 후기를 남겼습니다.` });
        router.refresh();
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{target.name}</span>
        {target.sessions.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {target.sessions.join(" · ")}
          </span>
        )}
      </div>

      {target.reviews.length > 0 && (
        <ul className="space-y-1">
          {target.reviews.map((r) => (
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
    </li>
  );
}

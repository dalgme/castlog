"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPen, Star } from "lucide-react";

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
import { cn } from "@/lib/utils";

import { evaluateExpertAndComplete } from "./evaluate-actions";

/** 저장된 평점(1~5)을 별로 — 평가 완료 표시 */
export function RatingStars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-amber-500", className)} title={`${rating}점 / 5점`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className="h-3.5 w-3.5" fill={n <= rating ? "currentColor" : "none"} aria-hidden />
      ))}
      <span className="ml-0.5 text-[11px] font-semibold text-amber-700">{rating}</span>
    </span>
  );
}

/**
 * 전문가 평가 팝업 (기획 지시 2026-09-21) — 평점 5점 만점·1점 단위 체크 + 평가의견.
 * '완료'를 누르면 평가가 저장되고 그 전문가는 종료 처리된다.
 */
export function ExpertEvaluateDialog({
  projectId,
  expertId,
  engagementId,
  slotId,
  expertName,
  initialRating,
  initialOpinion,
}: {
  projectId: string;
  expertId: string;
  engagementId: string;
  slotId: string | null;
  expertName: string;
  /** 이미 평가했으면 그 값 — 수정 가능 */
  initialRating: number | null;
  initialOpinion: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(initialRating);
  const [hover, setHover] = useState<number | null>(null);
  const [opinion, setOpinion] = useState(initialOpinion ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openDialog() {
    setRating(initialRating);
    setOpinion(initialOpinion ?? "");
    setError(null);
    setOpen(true);
  }

  function submit() {
    if (rating === null) {
      setError("평점을 선택하세요 (1~5점).");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await evaluateExpertAndComplete({
        projectId,
        expertId,
        engagementId,
        slotId,
        rating,
        opinion,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ description: `${expertName} — 평가를 저장하고 종료 처리했습니다.` });
      setOpen(false);
      router.refresh();
    });
  }

  const shown = hover ?? rating ?? 0;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn(
          "h-7 px-2 text-[11px]",
          initialRating !== null
            ? "border-amber-300 text-amber-800 hover:bg-amber-50"
            : "border-brand text-brand hover:bg-brand/10"
        )}
        title={initialRating !== null ? "평가 수정" : "평점(5점 만점)과 평가의견을 남기고 종료 처리"}
        onClick={openDialog}
      >
        <ClipboardPen className="mr-0.5 h-3 w-3" aria-hidden />
        {initialRating !== null ? "평가 수정" : "평가"}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{expertName} — 전문가 평가</DialogTitle>
            <DialogDescription>
              평점은 5점 만점, 1점 단위입니다. 완료를 누르면 평가가 저장되고 이 전문가는 종료로 표시됩니다. 평가는 우리 회사에만 보이며 전문가 본인에게는 노출되지 않습니다.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1">
            <p className="text-sm font-semibold">평점</p>
            <div className="flex items-center gap-1" onMouseLeave={() => setHover(null)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n}점`}
                  aria-pressed={rating === n}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setRating(n)}
                  className={cn(
                    "rounded p-1 transition-colors",
                    n <= shown ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-400"
                  )}
                >
                  <Star className="h-7 w-7" fill={n <= shown ? "currentColor" : "none"} aria-hidden />
                </button>
              ))}
              <span className="ml-2 text-sm font-semibold tabular-nums">
                {rating !== null ? `${rating}점 / 5점` : "선택하세요"}
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">평가의견</p>
            <Textarea
              rows={4}
              value={opinion}
              onChange={(e) => setOpinion(e.target.value)}
              maxLength={2000}
              placeholder="강의·멘토링의 품질, 준비도, 참가자 반응, 다음 섭외 시 참고할 점 등"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              닫기
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={pending}
              className="bg-violet-600 text-white hover:bg-violet-700"
            >
              {pending ? "저장 중…" : "완료 (평가 저장 · 종료)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

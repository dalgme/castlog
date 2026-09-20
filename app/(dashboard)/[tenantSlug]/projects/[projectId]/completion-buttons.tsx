"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { setEngagementCompleted, setSlotCompleted } from "./completion-actions";

/** 종료된 전문가·세션의 보라색 '종료' 표시 (기획 지시 2026-09-21) */
export const COMPLETED_BADGE_CLASS =
  "rounded-md bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white";

/**
 * 세션별·전문가별 종료 버튼. 종료 전 = 외곽선 '종료' 버튼(누르면 되묻는다),
 * 종료 후 = 보라색 '종료' 버튼(누르면 종료 취소를 되묻는다). §14-3 2단계 확인.
 */
export function CompletionButton({
  kind,
  targetId,
  label,
  completedAt,
  size = "sm",
}: {
  kind: "engagement" | "slot";
  targetId: string;
  /** 되묻는 문장에 쓸 이름 — 전문가 이름 또는 세션 라벨 */
  label: string;
  completedAt: string | null;
  size?: "sm" | "xs";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const done = completedAt !== null;

  function run() {
    startTransition(async () => {
      const r =
        kind === "engagement"
          ? await setEngagementCompleted(targetId, !done)
          : await setSlotCompleted(targetId, !done);
      if (!r.ok) {
        toast({ variant: "destructive", description: r.error });
        return;
      }
      toast({
        description: done
          ? `${label} — 종료를 취소했습니다.`
          : `${label} — 종료로 표시했습니다.`,
      });
      setOpen(false);
      router.refresh();
    });
  }

  const sizeCls = size === "xs" ? "h-6 px-1.5 text-[10px]" : "h-7 px-2 text-[11px]";
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={done ? "default" : "outline"}
        className={cn(
          sizeCls,
          done
            ? "bg-violet-600 font-semibold text-white hover:bg-violet-700"
            : "border-violet-300 text-violet-800 hover:bg-violet-50"
        )}
        title={
          done
            ? `${new Date(completedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 종료 — 누르면 종료를 취소할 수 있습니다`
            : kind === "slot"
              ? "이 세션과 확정된 전문가 전원을 종료로 표시합니다"
              : "이 전문가의 섭외를 종료로 표시합니다"
        }
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        <CheckCircle2 className="mr-0.5 h-3 w-3" aria-hidden />
        {kind === "slot" ? (done ? "종료" : "세션 종료") : "종료"}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {done ? `${label} — 종료를 취소할까요?` : `${label} — 종료로 표시할까요?`}
            </DialogTitle>
            <DialogDescription>
              {done
                ? "종료 표시를 지우고 진행 중으로 되돌립니다. 이력은 남습니다."
                : kind === "slot"
                  ? "세션과 이 세션에 확정된 전문가 전원이 '종료'로 표시됩니다. 지급·정산 데이터는 바뀌지 않습니다."
                  : "이 전문가의 섭외가 '종료'로 표시됩니다. 지급·정산 데이터는 바뀌지 않습니다."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              닫기
            </Button>
            <Button
              type="button"
              onClick={run}
              disabled={pending}
              className={done ? undefined : "bg-violet-600 text-white hover:bg-violet-700"}
              variant={done ? "destructive" : "default"}
            >
              {pending ? "처리 중…" : done ? "종료 취소" : "종료로 표시"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

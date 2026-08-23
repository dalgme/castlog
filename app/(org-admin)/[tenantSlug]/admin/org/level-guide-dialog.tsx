"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PermissionLevelGuide } from "@/components/org/permission-level-guide";
import { useToast } from "@/hooks/use-toast";

import { ackLevelGuide } from "./actions";

/**
 * '레벨 설정 이해하기' (기획 확정 2026-08-23).
 * 권한 레벨을 조정하려면 최초 1회 이 안내를 확인해야 한다 — 버튼 클릭 시
 * 확인이 기록되고(user_tour_acks), 이후에는 강제 없이 참고용으로 다시 볼 수 있다.
 */
export function LevelGuideDialog({ acked }: { acked: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && !acked) {
      // 클릭 = 확인 — 최초 1회만 기록하면 이후에는 강제하지 않는다
      startTransition(async () => {
        const r = await ackLevelGuide();
        if (r.ok) {
          router.refresh();
        } else {
          toast({ variant: "destructive", description: r.error });
        }
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={acked ? "outline" : "default"}
          className={acked ? undefined : "bg-coral text-white hover:bg-coral-dark"}
        >
          <BookOpenCheck className="mr-1 h-4 w-4" aria-hidden />
          {acked ? "레벨 설정 안내 다시 보기" : "레벨 설정 이해하기 (필수)"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>권한 레벨 설정 이해하기</DialogTitle>
        </DialogHeader>
        <PermissionLevelGuide defaultOpen />
        <p className="text-xs text-muted-foreground">
          이 창을 연 것으로 확인이 기록되어, 이제 권한 레벨을 조정할 수
          있습니다. 안내는 언제든 이 버튼으로 다시 볼 수 있습니다.
        </p>
      </DialogContent>
    </Dialog>
  );
}

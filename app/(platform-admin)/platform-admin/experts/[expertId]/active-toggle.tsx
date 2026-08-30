"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import { setExpertActive } from "../actions";

/**
 * 전문가 이용 중지/재개 — 위험 작업이라 2단계 확인 + 사유 필수(§14-3).
 * 중지는 새 노출·신규 연결·로그인만 막는다. 기존 이력은 남는다(§14-4).
 */
export function ExpertActiveToggle({
  expertId,
  expertName,
  active,
}: {
  expertId: string;
  expertName: string;
  active: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  function apply(nextActive: boolean) {
    startTransition(async () => {
      const result = await setExpertActive({
        expertId,
        active: nextActive,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        toast({ variant: "destructive", description: result.error });
        return;
      }
      setOpen(false);
      setNote("");
      toast({
        description: nextActive
          ? "이용을 재개했습니다. 본인에게 알림이 전송되었습니다."
          : "이용을 중지했습니다. 본인에게 알림이 전송되었습니다.",
      });
      router.refresh();
    });
  }

  if (active) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          이용 중지
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{expertName} 님 이용 중지</DialogTitle>
              <DialogDescription>
                공개 풀·탐색·신규 연결에서 빠지고 포털 로그인이 차단됩니다.
                이미 진행 중인 섭외·이력·지급 기록은 그대로 남습니다. 중지
                사실과 문의 안내가 본인에게 통지됩니다.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="중지 사유 (필수 — 감사로그와 이 화면에만 남습니다)"
              maxLength={500}
              rows={3}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                취소
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={pending || note.trim().length === 0}
                onClick={() => apply(false)}
              >
                {pending ? "처리 중..." : "이용 중지"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`${expertName} 님의 이용을 재개할까요?`)) return;
        apply(true);
      }}
    >
      {pending ? "처리 중..." : "이용 재개"}
    </Button>
  );
}

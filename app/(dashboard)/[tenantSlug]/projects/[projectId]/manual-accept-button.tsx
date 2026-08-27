"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

import { manualAcceptEngagement } from "../../experts/engagement-actions";

/**
 * 전화 등으로 수락을 직접 확인한 건의 수동 '섭외 완료(수락서 생성)' 버튼
 * (기획 확정 2026-08-23). 서버 게이트는 manualAcceptEngagement가 진다
 * (실행 축 engagementRequest — 레벨 4부터, 부PM은 PM 승인).
 *
 * 라이트 모드에서는 '수락서 확인까지 한 번에 완료' 체크(기본 켜짐)를 함께
 * 보여준다 — 송부·서명이 없는 라이트에서 2단계 클릭을 1단계로 줄인다
 * (기획 확정 2026-08-25). 조건을 따로 검토하고 싶은 건만 체크를 풀면 된다.
 */
export function ManualAcceptButton({
  engagementId,
  expertName,
  expertsLite = false,
}: {
  engagementId: string;
  expertName: string | null;
  /** 라이트 모드 — 원클릭 확정 체크박스 노출 */
  expertsLite?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [alsoConfirm, setAlsoConfirm] = useState(true);

  const submit = () => {
    startTransition(async () => {
      const r = await manualAcceptEngagement(
        engagementId,
        undefined,
        expertsLite && alsoConfirm
      );
      if (!r.ok) toast({ variant: "destructive", description: r.error });
      else {
        // 확정 여부는 서버 결과로 판단한다 — 권한(acceptanceSend RLS)이나
        // 경합으로 확정만 건너뛰었을 수 있고, 그때 "마감됐다"고 하면 거짓이다
        const wantedConfirm = expertsLite && alsoConfirm;
        toast({
          description: wantedConfirm
            ? r.confirmedNow
              ? "섭외 완료·수락서 확인까지 마감되었습니다."
              : "섭외 완료로 처리되었습니다. 수락서 확인은 완료되지 않았습니다 — 수락서 화면에서 '확인 완료 처리'로 마무리하세요."
            : "섭외 완료로 처리되었습니다. 수락서가 생성되었습니다.",
        });
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setAlsoConfirm(true);
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
        >
          섭외 완료(수락서 생성)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>섭외 완료로 처리할까요?</DialogTitle>
          <DialogDescription>
            {expertName ?? "이 전문가"}의 수락을 전화 등으로 직접
            확인했습니까? 계약 성립으로 처리되고 수락서가 생성됩니다.
          </DialogDescription>
        </DialogHeader>
        {expertsLite && (
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={alsoConfirm}
              onChange={(e) => setAlsoConfirm(e.target.checked)}
            />
            <span className="min-w-0">
              <span className="block font-medium">
                수락서 확인까지 한 번에 완료 (권장)
              </span>
              <span className="block text-xs text-muted-foreground">
                라이트 모드에는 송부·서명이 없어 기업 확인으로 마감합니다.
                조건을 따로 검토하려면 체크를 풀고, 수락서 화면에서 확인
                완료하세요.
              </span>
            </span>
          </label>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            아니오
          </Button>
          <Button className="flex-1" onClick={submit} disabled={pending}>
            {pending ? "처리 중..." : "예, 섭외 완료로 처리합니다"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

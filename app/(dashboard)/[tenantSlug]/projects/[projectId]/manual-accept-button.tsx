"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { manualAcceptEngagement } from "../../experts/engagement-actions";

/**
 * 전화 등으로 수락을 직접 확인한 건의 수동 '섭외 완료(수락서 생성)' 버튼
 * (기획 확정 2026-08-23). 서버 게이트는 manualAcceptEngagement가 진다
 * (실행 축 engagementRequest — 레벨 4부터).
 */
export function ManualAcceptButton({
  engagementId,
  expertName,
}: {
  engagementId: string;
  expertName: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
      disabled={pending}
      onClick={() => {
        if (
          !window.confirm(
            `${expertName ?? "이 전문가"}의 수락을 전화 등으로 직접 확인했습니까?\n섭외 완료(계약 성립)로 처리되고 수락서가 생성됩니다.`
          )
        ) {
          return;
        }
        startTransition(async () => {
          const r = await manualAcceptEngagement(engagementId);
          if (!r.ok) toast({ variant: "destructive", description: r.error });
          else {
            toast({
              description: "섭외 완료로 처리되었습니다. 수락서가 생성되었습니다.",
            });
            router.refresh();
          }
        });
      }}
    >
      섭외 완료(수락서 생성)
    </Button>
  );
}

"use client";

import { useTransition } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { dismissTenantAlert } from "@/app/(dashboard)/[tenantSlug]/alert-actions";

/** 단계 29: 전사 알림 닫기 (관리자 이상). */
export function AlertDismissButton({ alertId }: { alertId: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-6 w-6 shrink-0"
      disabled={pending}
      aria-label="알림 닫기"
      onClick={() =>
        startTransition(async () => {
          const result = await dismissTenantAlert(alertId);
          if (!result.ok) {
            toast({ variant: "destructive", description: result.error });
          }
        })
      }
    >
      <X className="h-4 w-4" />
    </Button>
  );
}

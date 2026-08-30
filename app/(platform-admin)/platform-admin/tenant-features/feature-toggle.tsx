"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { TenantExtraFeature } from "@/lib/features/tenant-features";

import { setTenantExtraFeature } from "./actions";

/** 기업 행의 온/오프 토글 */
export function FeatureToggle({
  tenantId,
  feature,
  enabled,
}: {
  tenantId: string;
  feature: TenantExtraFeature;
  enabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function apply(next: boolean) {
    startTransition(async () => {
      const result = await setTenantExtraFeature(tenantId, feature, next);
      if (!result.ok) {
        toast({ variant: "destructive", description: result.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {enabled ? (
        <Badge className="bg-emerald-600 hover:bg-emerald-600">켜짐</Badge>
      ) : (
        <Badge variant="outline">꺼짐</Badge>
      )}
      <Button
        type="button"
        size="sm"
        variant={enabled ? "outline" : "default"}
        disabled={pending}
        onClick={() => apply(!enabled)}
      >
        {pending ? "처리 중..." : enabled ? "끄기" : "켜기"}
      </Button>
    </span>
  );
}

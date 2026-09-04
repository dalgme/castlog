"use client";

import { ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { RewrapPanel } from "@/components/integrations/rewrap-panel";
import type { RewrapContext } from "@/lib/integrations/rrn-rewrap";

import { submitPortalRewrap } from "./rewrap-actions";

/** 수락서 화면의 지급용 주민번호 키 전달 구역 — 상태별로 무엇을 할지 말한다 */
export function PortalRewrapSection({
  engagementId,
  ctx,
}: {
  engagementId: string;
  ctx: RewrapContext;
}) {
  if (ctx.applicable) {
    return (
      <RewrapPanel
        ctx={ctx}
        onSubmit={(input) => submitPortalRewrap(engagementId, input)}
      />
    );
  }
  if (ctx.reason === "already_done") {
    return (
      <Alert>
        <AlertDescription className="flex items-start gap-2 text-xs">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-brand" aria-hidden />
          이 기업에 지급명세서용 주민번호 키를 이미 전달했습니다. 열람 시 알림을
          받으실 수 있습니다.
        </AlertDescription>
      </Alert>
    );
  }
  if (ctx.reason === "no_rrn") {
    return (
      <p className="rounded-md bg-secondary/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
        지급명세서용 주민번호 키 전달(선택)은 내 프로필에 주민등록번호를 등록한
        뒤 이 화면에서 할 수 있습니다. 사업자로 청구하시는 경우에는 필요하지
        않습니다.
      </p>
    );
  }
  return null;
}

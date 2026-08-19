"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSignature } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatKrw } from "@/lib/approvals/constants";

import { submitEngagementPlan } from "./position-assign-actions";

export type PlanPreviewLine = {
  code: string;
  expertName: string;
  sessionName: string;
  schedule: string;
  fee: number;
};

/**
 * 섭외 품의서 자동 작성 및 송신.
 *
 * 배정이 100% 찼을 때만 열린다. 담당자가 다시 타이핑할 것은 없다 — 눌러서
 * 무엇이 올라가는지 먼저 보여 주고, 확인하면 그대로 상신한다.
 */
export function EngagementPlanButton({
  projectId,
  disabled,
  disabledReason,
  lines,
  amount,
}: {
  projectId: string;
  disabled: boolean;
  /** 왜 못 누르는지 — 비활성 버튼만 두면 사용자는 고장으로 읽는다 */
  disabledReason: string;
  lines: PlanPreviewLine[];
  amount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitEngagementPlan(projectId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (disabled) {
    return (
      <span
        title={disabledReason}
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground"
      >
        <FileSignature className="h-3.5 w-3.5" aria-hidden />
        섭외 품의서 자동 작성 및 송신
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FileSignature className="mr-1.5 h-3.5 w-3.5" />
          섭외 품의서 자동 작성 및 송신
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>섭외 품의서 — 상신 전 확인</DialogTitle>
          <DialogDescription>
            프로젝트 기본정보와 세션별 배정 명단으로 품의서가 자동 작성됩니다.
            상신하면 전결규정(없으면 직급 체계)에 따라 상급자에게 올라갑니다.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="rounded-lg border">
          <div className="flex items-baseline justify-between border-b bg-secondary/40 px-3 py-2">
            <span className="text-xs font-semibold">
              세션별 전문가 배정(안) · {lines.length}명
            </span>
            <span className="text-sm font-extrabold tabular-nums">
              {formatKrw(amount)}
            </span>
          </div>
          <ul className="max-h-72 divide-y overflow-y-auto text-sm">
            {lines.map((l) => (
              <li key={l.code} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-mono text-xs font-semibold">{l.code}</span>
                <span className="font-medium">{l.expertName}</span>
                <span className="text-xs text-muted-foreground">
                  {l.sessionName} · {l.schedule}
                </span>
                <span className="ml-auto tabular-nums text-xs text-muted-foreground">
                  {formatKrw(l.fee)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="rounded-md bg-secondary/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
          상신 후에는 결재가 끝나야 다음 단계(섭외 진행)로 넘어갑니다. 반려되면
          배정 단계로 돌아오니 명단을 고쳐 다시 올리시면 됩니다. 이 시점까지
          전문가에게는 아무것도 나가지 않습니다.
        </p>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            취소
          </Button>
          <Button className="flex-1" onClick={submit} disabled={pending}>
            {pending ? "상신 중…" : "이대로 상신"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

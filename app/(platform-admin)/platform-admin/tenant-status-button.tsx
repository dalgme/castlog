"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { setTenantStatus } from "./actions";

/**
 * 테넌트 활성/중지 전환.
 *
 * 중지는 그 회사 전원의 로그인을 막는 조치다. 되돌릴 수는 있지만 그 사이의
 * 업무는 멈추므로 한 번 되묻고(§14-3), 사유를 받아 감사로그에 남긴다 —
 * 나중에 '왜 껐지'를 물었을 때 답할 수 있어야 한다.
 */
export function TenantStatusButton({
  tenantId,
  tenantName,
  status,
}: {
  tenantId: string;
  tenantName: string;
  status: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 해지된 테넌트는 이 화면의 대상이 아니다 (데이터 파기·계약 종료가 얽힌다)
  if (status === "terminated") {
    return (
      <span className="text-xs text-muted-foreground">해지됨 — 변경 불가</span>
    );
  }

  const suspending = status === "active";
  const next = suspending ? "suspended" : "active";

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await setTenantStatus({ tenantId, status: next, reason });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={
            suspending ? "border-destructive/40 text-destructive" : undefined
          }
        >
          {suspending ? (
            <Pause className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <Play className="mr-1.5 h-3.5 w-3.5" />
          )}
          {suspending ? "중지" : "활성화"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {suspending
              ? `${tenantName}을(를) 중지할까요?`
              : `${tenantName}을(를) 다시 활성화할까요?`}
          </DialogTitle>
          <DialogDescription>
            {suspending
              ? "중지하면 이 회사의 모든 직원이 로그인할 수 없습니다. 데이터는 지워지지 않으며 언제든 다시 활성화할 수 있습니다."
              : "직원들이 다시 로그인할 수 있게 됩니다."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div>
          <Label htmlFor="tenant-status-reason">사유 (선택)</Label>
          <Input
            id="tenant-status-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder={suspending ? "예: 계약 만료, 미납" : "예: 결제 완료"}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            감사로그에 함께 남습니다. 나중에 되돌릴 근거가 됩니다.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            아니오
          </Button>
          <Button
            className="flex-1"
            variant={suspending ? "destructive" : "default"}
            onClick={run}
            disabled={pending}
          >
            {pending
              ? "처리 중…"
              : suspending
                ? "예, 중지합니다"
                : "예, 활성화합니다"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

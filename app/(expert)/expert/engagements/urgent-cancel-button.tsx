"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { EXPERT_CANCEL_REASONS } from "@/lib/integrations/expert-cancel-reasons";

import { cancelConfirmedEngagementByExpert } from "./cancel-actions";

/**
 * 전문가의 긴급 취소 — 확정된 참여를 되돌린다.
 *
 * 가볍게 눌리면 안 되는 버튼이라 눈에 띄지 않게 두되, 숨기지도 않는다. 정말
 * 못 가게 된 전문가가 연락할 방법이 없어 잠수하는 것이 기업에게 가장 나쁘다.
 * 사유는 골라서 한 번에 보내게 한다 — 기업은 대체 인력을 구해야 한다.
 */
export function ExpertUrgentCancelButton({
  engagementId,
  programName,
}: {
  engagementId: string;
  programName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string>("");
  const [detail, setDetail] = useState("");
  const [confirming, setConfirming] = useState(false);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await cancelConfirmedEngagementByExpert({
        engagementId,
        reason,
        detail,
      });
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setConfirming(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive">
          <AlertTriangle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          긴급 취소
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>확정된 참여를 취소합니다</DialogTitle>
          <DialogDescription>
            {programName} — 취소하면 기업 담당자에게 즉시 알림이 가고, 담당자는
            대체 전문가를 다시 섭외하게 됩니다.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold">취소 사유</legend>
          {EXPERT_CANCEL_REASONS.map((r) => (
            <Label
              key={r}
              className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm font-normal transition-colors has-[:checked]:border-destructive has-[:checked]:bg-destructive/5"
            >
              <input
                type="radio"
                name="expert-cancel-reason"
                checked={reason === r}
                onChange={() => setReason(r)}
              />
              {r}
            </Label>
          ))}
        </fieldset>

        <div>
          <Label htmlFor="expert-cancel-detail">상세 사유 (선택)</Label>
          <Textarea
            id="expert-cancel-detail"
            rows={3}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="기업 담당자에게 전달됩니다."
          />
        </div>

        {confirming ? (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm font-semibold text-destructive">
              정말 취소하시겠습니까? 되돌릴 수 없습니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" onClick={submit} disabled={pending}>
                {pending ? "처리 중…" : "예, 취소합니다"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                아니오
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="destructive"
            onClick={() => {
              if (!reason) {
                setError("취소 사유를 선택해 주세요.");
                return;
              }
              setError(null);
              setConfirming(true);
            }}
            disabled={pending}
          >
            취소 요청하기
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

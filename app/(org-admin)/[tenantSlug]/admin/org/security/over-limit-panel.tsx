"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rrnAccessReasonLabel } from "@/lib/integrations/rrn-access";

import { approveOverLimit, denyOverLimit } from "./actions";

export type PendingRequest = {
  id: string;
  expertName: string;
  projectName: string;
  reason: string;
  overLimitReason: string | null;
  requesterName: string;
  createdAt: string;
};

/**
 * 초과 조회 승인 — 대표 전용. 승인 1건은 조회 1회분이며 소진되면 다시 신청해야 한다.
 * 대표가 아닌 보안책임자에게는 목록만 보이고 버튼이 없다(서버에서도 거부).
 */
export function OverLimitPanel({
  requests,
  canDecide,
}: {
  requests: PendingRequest[];
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const act = (id: string, kind: "approve" | "deny") => {
    setError(null);
    startTransition(async () => {
      const note = notes[id] ?? "";
      const r =
        kind === "approve"
          ? await approveOverLimit(id, note)
          : await denyOverLimit(id, note);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  if (requests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        승인 대기 중인 초과 조회 요청이 없습니다.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!canDecide && (
        <p className="rounded-md bg-amber-50 p-2.5 text-xs text-amber-900">
          초과 조회 승인은 <b>대표 계정만</b> 처리할 수 있습니다. 위임 대상이 아닙니다.
        </p>
      )}
      <ul className="space-y-3">
        {requests.map((r) => (
          <li key={r.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{r.expertName}</span>
              <Badge variant="secondary">{r.projectName}</Badge>
              <span className="text-xs text-muted-foreground">
                {rrnAccessReasonLabel(r.reason)} · 신청 {r.requesterName} ·{" "}
                {new Date(r.createdAt).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-secondary/50 p-2 text-sm">
              {r.overLimitReason ?? "(사유 미기재)"}
            </p>
            {canDecide && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  value={notes[r.id] ?? ""}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                  }
                  placeholder="처리 메모 (선택)"
                  className="h-9 max-w-xs"
                />
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => act(r.id, "approve")}
                >
                  승인 (1회 허용)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => act(r.id, "deny")}
                >
                  반려
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

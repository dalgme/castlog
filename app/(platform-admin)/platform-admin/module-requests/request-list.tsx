"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { MODULE_LABELS } from "@/lib/modules/modules";
import {
  MODULE_REQUEST_STATUS_LABELS,
  type ModuleRequest,
} from "@/lib/modules/requests";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

import { approveModuleRequest, rejectModuleRequest } from "./actions";

/**
 * 모듈 추가 요청 처리.
 *
 * 승인은 되돌리기 번거로운 계약 반영이므로 확인을 한 번 받는다(§14-3).
 * 거절은 사유가 필수다 — 기업 화면에 그대로 보인다.
 */
export function ModuleRequestList({ requests }: { requests: ModuleRequest[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(req: ModuleRequest, approve: boolean) {
    const note = notes[req.id] ?? "";
    if (
      approve &&
      !window.confirm(
        `${req.tenantName}에 ${req.requested
          .map((m) => MODULE_LABELS[m])
          .join("·")}을(를) 활성화합니다.\n\n계약 내용과 일치하는지 확인하셨습니까?`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = approve
        ? await approveModuleRequest(req.id, note)
        : await rejectModuleRequest(req.id, note);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {requests.map((req) => (
        <Card key={req.id}>
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{req.tenantName}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {req.tenantSlug}
              </span>
              <Badge
                variant={req.status === "pending" ? "default" : "outline"}
                className="text-[10px]"
              >
                {MODULE_REQUEST_STATUS_LABELS[req.status]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(req.createdAt).toLocaleString("ko-KR")}
                {req.requesterName && ` · ${req.requesterName}`}
              </span>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>
                <span className="text-muted-foreground">요청</span>{" "}
                {req.requested.map((m) => MODULE_LABELS[m]).join(" · ") || "-"}
              </span>
              <span>
                <span className="text-muted-foreground">현재 사용</span>{" "}
                {req.current.map((m) => MODULE_LABELS[m]).join(" · ") ||
                  "공통 기반만"}
              </span>
            </div>

            {req.note && (
              <p className="whitespace-pre-wrap rounded-md bg-secondary/50 p-3 text-sm">
                {req.note}
              </p>
            )}

            {req.status === "pending" ? (
              <div className="space-y-2">
                <Textarea
                  rows={2}
                  value={notes[req.id] ?? ""}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                  }
                  placeholder="처리 메모 (거절 시 사유 필수 — 기업 화면에 표시됩니다)"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => decide(req, false)}
                  >
                    거절
                  </Button>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => decide(req, true)}
                  >
                    승인하고 활성화
                  </Button>
                </div>
              </div>
            ) : (
              req.decisionNote && (
                <p className="rounded-md border p-2.5 text-xs text-muted-foreground">
                  처리 메모: {req.decisionNote}
                  {req.decidedAt &&
                    ` (${new Date(req.decidedAt).toLocaleString("ko-KR")})`}
                </p>
              )
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

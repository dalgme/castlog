"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEPUTY_GATED_ACTIONS,
  actionRequestStatusLabel,
  deputyActionLabel,
  deputyActionWhy,
  type DeputyGatedAction,
} from "@/lib/integrations/deputy-actions";

import {
  approveActionRequest,
  denyActionRequest,
  submitActionRequest,
} from "./action-request-actions";

/** 대상 레코드 없이 프로젝트 단위로 요청할 수 있는 작업 */
const PROJECT_LEVEL_ACTIONS = Object.entries(DEPUTY_GATED_ACTIONS).filter(
  ([, meta]) => meta.targetType === "project"
);

export type ActionRequestRow = {
  id: string;
  actionType: string;
  targetId: string | null;
  /** 대상 사람용 표기 — 코드넘버·전문가명·세션 (검수 A1: UUID만으로는 뭘 승인하는지 모른다) */
  targetLabel: string | null;
  requestNote: string | null;
  status: string;
  requesterName: string;
  deciderName: string | null;
  decisionNote: string | null;
  consumedAt: string | null;
  createdAt: string;
};

/**
 * PM 승인 관계 패널 (공통 기반)
 *
 * PM/부PM은 업무를 나누지 않는다. 부PM도 같은 화면에서 같은 일을 하되, 되돌리기
 * 어려운 실행만 PM 승인 1건을 먼저 받는다. 승인 1건은 실행 1회분이다.
 */
export function ActionRequestPanel({
  tenantSlug,
  projectId,
  requests,
  isDeputy,
  canDecide,
}: {
  tenantSlug: string;
  projectId: string;
  requests: ActionRequestRow[];
  isDeputy: boolean;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const [actionType, setActionType] = useState<DeputyGatedAction | "">("");
  const [note, setNote] = useState("");

  const submit = () => {
    if (!actionType) return setError("승인받을 작업을 선택하세요.");
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await submitActionRequest({
        tenantSlug,
        projectId,
        actionType,
        targetId: null,
        note,
      });
      if (!r.ok) setError(r.error);
      else {
        setActionType("");
        setNote("");
        setInfo("PM에게 승인 요청을 보냈습니다. 승인 후 직접 실행하세요.");
        router.refresh();
      }
    });
  };

  const decide = (id: string, kind: "approve" | "deny") => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const decisionNote = notes[id] ?? "";
      const r =
        kind === "approve"
          ? await approveActionRequest(id, tenantSlug, decisionNote)
          : await denyActionRequest(id, tenantSlug, decisionNote);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  const pendingRows = requests.filter((r) => r.status === "pending");
  const historyRows = requests.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
        PM과 부PM은 업무를 나누지 않습니다. 다만 <b>부PM이 실행하는 작업</b> 중
        되돌리기 어려운 것은 PM 승인을 먼저 받습니다. 승인 1건은 실행 1회분이며,
        실행하면 소진됩니다.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert>
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      )}

      {isDeputy && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-semibold">PM 승인 요청 (프로젝트 단위)</p>
          <p className="text-xs text-muted-foreground">
            코드넘버·섭외건·세션처럼 대상이 정해진 작업은 그 화면에서 실행을
            시도하면 바로 승인 요청 버튼이 나타납니다. 여기서는 프로젝트 단위
            작업만 요청합니다.
          </p>
          <Select
            value={actionType}
            onValueChange={(v) => setActionType(v as DeputyGatedAction)}
          >
            <SelectTrigger>
              <SelectValue placeholder="승인받을 작업" />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_LEVEL_ACTIONS.map(([key, meta]) => (
                <SelectItem key={key} value={key}>
                  {meta.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {actionType && (
            <p className="text-xs text-muted-foreground">
              {deputyActionWhy(actionType)}
            </p>
          )}
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="무엇을 왜 실행하려는지 (선택)"
          />
          <Button size="sm" onClick={submit} disabled={pending}>
            승인 요청 보내기
          </Button>
        </div>
      )}

      {pendingRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          승인 대기 중인 실행 요청이 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {pendingRows.map((r) => (
            <li key={r.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">
                  {deputyActionLabel(r.actionType)}
                </span>
                {r.targetLabel && (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                    {r.targetLabel}
                  </span>
                )}
                <Badge variant="secondary">{r.requesterName}</Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {r.requestNote && (
                <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-secondary/50 p-2 text-sm">
                  {r.requestNote}
                </p>
              )}
              {canDecide ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    value={notes[r.id] ?? ""}
                    onChange={(e) =>
                      setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                    placeholder="처리 메모 (선택)"
                    className="h-9 max-w-xs"
                  />
                  <Button size="sm" disabled={pending} onClick={() => decide(r.id, "approve")}>
                    승인 (1회 허용)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => decide(r.id, "deny")}
                  >
                    반려
                  </Button>
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  PM 승인을 기다리는 중입니다.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {historyRows.length > 0 && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            처리 이력 ({historyRows.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {historyRows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{deputyActionLabel(r.actionType)}</span>
                {r.targetLabel && (
                  <span className="text-muted-foreground">{r.targetLabel}</span>
                )}
                <span className="text-muted-foreground">{r.requesterName}</span>
                <Badge
                  variant={r.status === "denied" ? "destructive" : "secondary"}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {actionRequestStatusLabel(r.status, r.consumedAt)}
                </Badge>
                {r.deciderName && (
                  <span className="text-muted-foreground">처리 {r.deciderName}</span>
                )}
                {r.decisionNote && (
                  <span className="text-muted-foreground">· {r.decisionNote}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

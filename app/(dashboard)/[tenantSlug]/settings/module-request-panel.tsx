"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import {
  MODULE_DESCRIPTIONS,
  MODULE_LABELS,
  type ModuleKey,
} from "@/lib/modules/modules";
import {
  MODULE_REQUEST_STATUS_LABELS,
  type ModuleRequestStatus,
} from "@/lib/modules/requests";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

import { cancelModuleRequest, requestModules } from "./module-actions";

export type OpenRequest = {
  id: string;
  requested: ModuleKey[];
  status: ModuleRequestStatus;
  decisionNote: string | null;
  createdAt: string;
};

/**
 * 모듈 추가 요청 (기업 → 캐스트로그).
 *
 * 모듈 조합은 계약 정보라 회사가 스스로 켤 수 없다. 그렇다고 "관리자에게
 * 요청하세요"라는 문구만 두면 막다른 길이 된다 — 여기서 실제로 요청을 보낸다.
 */
export function ModuleRequestPanel({
  available,
  activeLabels,
  openRequest,
  lastDecision,
}: {
  available: ModuleKey[];
  activeLabels: string[];
  openRequest: OpenRequest | null;
  lastDecision: OpenRequest | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<ModuleKey>>(new Set());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(key: ModuleKey) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await requestModules(Array.from(picked), note);
      if (res.ok) {
        setPicked(new Set());
        setNote("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function cancel() {
    if (!openRequest) return;
    setError(null);
    startTransition(async () => {
      const res = await cancelModuleRequest(openRequest.id);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">사용 중</span>
        {activeLabels.length === 0 ? (
          <span className="text-muted-foreground">공통 기반만</span>
        ) : (
          activeLabels.map((label) => (
            <Badge key={label} variant="secondary" className="text-[10px]">
              {label}
            </Badge>
          ))
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {lastDecision && lastDecision.status === "rejected" && (
        <Alert>
          <AlertDescription className="text-sm">
            직전 요청(
            {lastDecision.requested.map((m) => MODULE_LABELS[m]).join("·")})이
            거절되었습니다.
            {lastDecision.decisionNote && ` 사유: ${lastDecision.decisionNote}`}
          </AlertDescription>
        </Alert>
      )}

      {openRequest ? (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className="text-[10px]">
              {MODULE_REQUEST_STATUS_LABELS[openRequest.status]}
            </Badge>
            <span>
              {openRequest.requested.map((m) => MODULE_LABELS[m]).join(" · ")}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(openRequest.createdAt).toLocaleString("ko-KR")} 요청
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            캐스트로그에서 계약 내용을 확인한 뒤 활성화합니다. 활성화되면 기존
            프로젝트·전문가·이력은 그대로 두고 기능만 열립니다.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={cancel}
          >
            요청 취소
          </Button>
        </div>
      ) : available.length === 0 ? (
        <p className="flex items-center gap-1.5 rounded-md bg-secondary/50 p-3 text-sm">
          <Check className="h-4 w-4 text-brand" />
          3개 영역을 모두 사용 중입니다.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="space-y-2">
            {available.map((key) => (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 hover:border-brand/40"
              >
                <Checkbox
                  checked={picked.has(key)}
                  onCheckedChange={() => toggle(key)}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {MODULE_LABELS[key]}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {MODULE_DESCRIPTIONS[key]}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="필요한 시점·사유 등 (선택)"
          />
          <Button
            className="w-full"
            disabled={pending || picked.size === 0}
            onClick={submit}
          >
            {pending ? "요청 중..." : "추가 요청 보내기"}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            요청은 계약 확인 후 캐스트로그가 활성화합니다. 이 화면에서 결제는
            일어나지 않습니다.
          </p>
        </div>
      )}
    </div>
  );
}

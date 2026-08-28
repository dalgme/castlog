"use client";

import { useState, useTransition } from "react";
import { useParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deputyActionWhy } from "@/lib/integrations/deputy-actions";
import { submitActionRequest } from "@/app/(dashboard)/[tenantSlug]/projects/[projectId]/action-request-actions";

/**
 * 부PM 인라인 승인 요청 (검수 A1 — 막다른 길 해소).
 *
 * 대상 지정형 게이트(취소·수동완료·안내문자·재안내)에 걸린 부PM이 "승인 요청을
 * 보낸 뒤 다시 시도하세요"라는 안내를 받고도 보낼 곳이 없던 문제를 없앤다 —
 * 거부가 난 바로 그 자리에서, 게이트와 같은 targetId로 상신한다
 * (candidate-picker의 섭외요청 인라인 요청과 같은 패턴).
 */
export function DeputyRequestInline({
  projectId,
  actionType,
  targetId,
  onRequested,
}: {
  projectId: string;
  actionType: string;
  targetId: string | null;
  /** 상신 성공 후 부모가 상태를 정리할 때 */
  onRequested?: () => void;
}) {
  const params = useParams<{ tenantSlug: string }>();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  if (requested) {
    return (
      <p className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs leading-relaxed text-emerald-900">
        PM에게 승인 요청을 보냈습니다. 승인되면 이 화면에서 같은 버튼으로 직접
        실행하세요 (승인 1건 = 실행 1회).
      </p>
    );
  }

  const why = deputyActionWhy(actionType);

  return (
    <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-2.5">
      <p className="text-xs leading-relaxed text-amber-900">
        부PM은 이 작업 전에 PM 승인 1건이 필요합니다.
        {why ? ` ${why}` : ""} 여기서 바로 요청할 수 있습니다.
      </p>
      <Textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="PM에게 전할 메모 (선택)"
        className="bg-white text-xs"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await submitActionRequest({
              tenantSlug: params.tenantSlug,
              projectId,
              actionType,
              targetId,
              note,
            });
            if (!r.ok) setError(r.error);
            else {
              setRequested(true);
              onRequested?.();
            }
          });
        }}
      >
        {pending ? "요청 중..." : "PM 승인 요청"}
      </Button>
    </div>
  );
}

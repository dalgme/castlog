"use client";

import { useMemo, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { respondToEngagementBundle } from "./actions";

export type BundleFormItem = {
  engagementId: string;
  sessionName: string | null;
  roleLabel: string | null;
  schedule: string | null;
  locationName: string | null;
  feeLabel: string | null;
  conflictCount: number;
};

/**
 * 묶음 섭외 일괄 회신 폼 (기획 확정 2026-08-30 — 20번).
 * 건별로 수락/거절을 고른 뒤 한 번에 회신한다. 모든 건에 선택이 있어야
 * 회신 버튼이 열린다 — 일부만 회신하면 잔여 건이 조용히 만료되기 때문.
 * 수락·거절 모두 되돌릴 수 없으므로 /e와 같은 2단계 확인을 거친다.
 */
export function BundleRespondForm({
  token,
  items,
}: {
  token: string;
  items: BundleFormItem[];
}) {
  const [choices, setChoices] = useState<
    Record<string, "accepted" | "declined" | undefined>
  >({});
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<{
    accepted: number;
    declined: number;
    failedCount: number;
  } | null>(null);

  const decided = items.filter((i) => choices[i.engagementId]);
  const allDecided = decided.length === items.length;
  const acceptCount = useMemo(
    () => items.filter((i) => choices[i.engagementId] === "accepted").length,
    [items, choices]
  );
  const declineCount = decided.length - acceptCount;

  function submit() {
    setServerError(null);
    startTransition(async () => {
      const result = await respondToEngagementBundle(token, {
        decisions: items.map((i) => ({
          engagementId: i.engagementId,
          decision: choices[i.engagementId]!,
        })),
        responseNote: note || undefined,
      });
      if (!result.ok) {
        setServerError(result.error);
        setConfirming(false);
        return;
      }
      setDone({
        accepted: result.accepted,
        declined: result.declined,
        failedCount: result.failed.length,
      });
      setConfirming(false);
    });
  }

  if (done) {
    return (
      <div className="space-y-3">
        <Alert>
          <AlertDescription>
            회신이 완료되었습니다 — 수락 {done.accepted}건
            {done.declined > 0 ? ` · 거절 ${done.declined}건` : ""}.
            {done.accepted > 0 &&
              " 수락한 건은 계약이 성립되었으며 기업 담당자에게 전달됩니다."}
            {done.failedCount > 0 &&
              ` ${done.failedCount}건은 그 사이 상태가 바뀌어 처리되지 않았습니다 — 기업 담당자에게 확인해 주세요.`}
          </AlertDescription>
        </Alert>
        {done.accepted > 0 && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            수락서와 상세 내역, 지급을 위한 주민번호 키 전달(선택)은{" "}
            <a href="/expert" className="text-brand underline underline-offset-4">
              전문가 포털
            </a>
            에서 휴대폰 인증으로 로그인해 진행할 수 있습니다.
          </p>
        )}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="space-y-3">
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
        <div className="rounded-lg border border-brand/40 bg-brand/[0.05] p-3 text-sm leading-relaxed">
          <p className="font-semibold">
            수락 {acceptCount}건 · 거절 {declineCount}건으로 회신하시겠습니까?
          </p>
          <p className="mt-1 text-muted-foreground">
            수락한 건은 <b>건별로 계약이 성립</b>하며 수락서가 만들어집니다.
            회신 후에는 이 링크로 다시 응답할 수 없습니다.
          </p>
          {declineCount > 0 && (
            <Textarea
              rows={2}
              className="mt-2 bg-white"
              placeholder="거절 사유 (선택 — 예: 일정 겹침, 분야 상이)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
            />
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            돌아가기
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={pending}
            onClick={submit}
          >
            {pending ? "회신 중..." : "예, 이대로 회신합니다"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <ul className="space-y-2.5">
        {items.map((item, index) => {
          const choice = choices[item.engagementId];
          return (
            <li
              key={item.engagementId}
              className="space-y-2 rounded-lg border p-3"
            >
              <div className="text-sm">
                <p className="font-semibold">
                  {index + 1}. {item.sessionName || item.roleLabel || "세션"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[item.roleLabel, item.schedule, item.locationName, item.feeLabel]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {item.conflictCount > 0 && (
                  <p className="mt-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs leading-relaxed text-amber-900">
                    ⚠ 이 일정은 이미 확정하신 다른 일정 {item.conflictCount}건과
                    겹칩니다.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  variant={choice === "accepted" ? "default" : "outline"}
                  disabled={pending}
                  onClick={() =>
                    setChoices((prev) => ({
                      ...prev,
                      [item.engagementId]: "accepted",
                    }))
                  }
                >
                  {choice === "accepted" ? "✓ 수락" : "수락"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  variant={choice === "declined" ? "destructive" : "outline"}
                  disabled={pending}
                  onClick={() =>
                    setChoices((prev) => ({
                      ...prev,
                      [item.engagementId]: "declined",
                    }))
                  }
                >
                  {choice === "declined" ? "✓ 거절" : "거절"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        className="w-full"
        disabled={pending || !allDecided}
        onClick={() => setConfirming(true)}
      >
        {allDecided
          ? `한 번에 회신하기 (수락 ${acceptCount} · 거절 ${declineCount})`
          : `모든 건을 선택해 주세요 (${decided.length}/${items.length})`}
      </Button>
      <p className="text-xs text-muted-foreground">
        건별로 수락/거절을 선택한 뒤 한 번에 회신됩니다. 수락 시 해당 건의
        계약이 성립하며, 응답 내역은 기업과 전문가 포털에 기록됩니다.
      </p>
    </div>
  );
}

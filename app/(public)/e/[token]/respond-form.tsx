"use client";

import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RewrapPanel } from "@/components/integrations/rewrap-panel";
import { PortalGuide } from "@/components/expert/portal-guide";
import type { ExpertPortalGuide } from "@/lib/integrations/expert-portal-guide";

import {
  respondToEngagementByToken,
  getRewrapContext,
  submitRewrap,
  type RewrapContext,
} from "./actions";

/**
 * 섭외 수락·거절 폼 — 모바일 완전 대응 (공개 링크).
 * 수락 후에는 (1) 다음 단계가 포털이라는 안내 — 전문가의 등록 상태별로 문구가
 * 다르다(lib/integrations/expert-portal-guide), (2) 지급용 주민번호 키 전달(선택).
 */
export function EngagementRespondForm({
  token,
  guide,
  tenantName,
}: {
  token: string;
  guide: ExpertPortalGuide | null;
  tenantName: string | null;
}) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);
  const [rewrap, setRewrap] = useState<RewrapContext | null>(null);
  // 확인 단계 — 수락·거절 모두 되돌릴 수 없는 응답이다. 모바일에서 버튼 두 개가
  // 나란한데 거절만 원터치로 확정되면 오터치를 되돌릴 수 없다 (검수 C1)
  const [confirming, setConfirming] = useState<"accepted" | "declined" | null>(
    null
  );

  function submit(decision: "accepted" | "declined") {
    setServerError(null);
    startTransition(async () => {
      const result = await respondToEngagementByToken(token, {
        decision,
        responseNote: note || undefined,
      });
      if (!result.ok) {
        setServerError(result.error);
        setConfirming(null);
        return;
      }
      setDone(result.decision);
      setConfirming(null);
      if (result.decision === "accepted") {
        const ctx = await getRewrapContext(token);
        setRewrap(ctx);
      }
    });
  }

  if (done) {
    return (
      <div className="space-y-3">
        <Alert>
          <AlertDescription>
            {done === "accepted"
              ? "섭외를 수락했습니다. 계약이 성립되었으며 기업 담당자에게 전달됩니다."
              : "섭외를 거절했습니다. 기업 담당자에게 전달됩니다. 잘못 응답하셨다면 기업 담당자에게 연락해 주세요 — 담당자가 다시 요청을 보낼 수 있습니다."}
          </AlertDescription>
        </Alert>
        {done === "accepted" && rewrap?.applicable && (
          <RewrapPanel
            ctx={rewrap}
            onSubmit={(input) => submitRewrap(token, input)}
          />
        )}
        {/* 다음 문 — "수락했는데 다음이 뭐예요?"에 답한다 (E2E 검수 P3-1).
            키 전달을 이 화면에서 못 했으면(주민번호 미등록 등) 포털에서 할 수
            있다고 함께 알린다 */}
        {done === "accepted" && guide && (
          <PortalGuide
            guide={guide}
            tenantName={tenantName}
            mentionRewrap={!rewrap?.applicable}
          />
        )}
      </div>
    );
  }

  // 확인 단계 — 무엇이 일어나는지 한 번 더 말하고 확정한다
  if (confirming) {
    const accepting = confirming === "accepted";
    return (
      <div className="space-y-3">
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
        <div
          className={`rounded-lg border p-3 text-sm leading-relaxed ${
            accepting
              ? "border-brand/40 bg-brand/[0.05]"
              : "border-amber-300 bg-amber-50"
          }`}
        >
          {accepting ? (
            <>
              <p className="font-semibold">섭외를 수락하시겠습니까?</p>
              <p className="mt-1 text-muted-foreground">
                수락 시 <b>계약이 성립</b>하며 수락서가 만들어집니다. 이후
                취소하려면 기업 담당자와의 절차가 필요합니다.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">섭외를 거절하시겠습니까?</p>
              <p className="mt-1 text-muted-foreground">
                거절하면 이 링크로는 다시 응답할 수 없습니다. 가능하다면 아래에
                사유를 남겨 주세요 — 기업이 다음 섭외에 참고합니다.
              </p>
              <Textarea
                rows={2}
                className="mt-2 bg-white"
                placeholder="거절 사유 (선택 — 예: 일정 겹침, 분야 상이)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
              />
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={pending}
            onClick={() => setConfirming(null)}
          >
            돌아가기
          </Button>
          <Button
            type="button"
            className="flex-1"
            variant={accepting ? "default" : "destructive"}
            disabled={pending}
            onClick={() => submit(confirming)}
          >
            {pending
              ? "처리 중..."
              : accepting
                ? "예, 수락합니다"
                : "예, 거절합니다"}
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
      <Textarea
        rows={2}
        placeholder="의견 (선택)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={pending}
          onClick={() => setConfirming("accepted")}
        >
          수락
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={pending}
          onClick={() => setConfirming("declined")}
        >
          거절
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        수락 시 계약이 성립하며, 응답 내역은 기업과 전문가 포털에 기록됩니다.
        수락·거절 모두 한 번 더 확인 후 확정됩니다.
      </p>
    </div>
  );
}


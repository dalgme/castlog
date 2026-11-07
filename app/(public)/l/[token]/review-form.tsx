"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CLIENT_OPINIONS,
  CLIENT_OPINION_LABELS,
  type ClientDoc,
  type ClientOpinion,
} from "@/lib/integrations/client-review-shared";
import { ClientReviewDocument } from "@/components/candidate-lists/client-review-document";

import { submitClientReviewResponse } from "./actions";

const OPINION_CLASS: Record<ClientOpinion, string> = {
  ok: "border-emerald-500 bg-emerald-50 text-emerald-800",
  replace: "border-rose-500 bg-rose-50 text-rose-800",
  hold: "border-amber-500 bg-amber-50 text-amber-800",
};

/** 발주처 회신 폼 — 후보별 의견(선택) + 전체 요청사항 → 요청/회신 하기 (1회) */
export function ClientReviewForm({ token, doc, expiresAt }: { token: string; doc: ClientDoc; expiresAt: string }) {
  const router = useRouter();
  const [opinions, setOpinions] = useState<Record<string, ClientOpinion | undefined>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const answered = Object.values(opinions).filter(Boolean).length;
  const total = doc.slots.reduce((n, s) => n + s.candidates.length, 0);

  function submit() {
    setError(null);
    startTransition(async () => {
      const items = Object.entries(opinions)
        .filter(([, v]) => Boolean(v))
        .map(([entryId, opinion]) => ({ entryId, opinion: opinion as string, comment: comments[entryId] ?? "" }));
      const r = await submitClientReviewResponse(token, { respondentName: name, generalComment: general, items });
      if (!r.ok) {
        setError(r.error);
        setConfirming(false);
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="space-y-3 py-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden />
        <p className="text-lg font-bold">회신이 전달되었습니다</p>
        <p className="text-sm text-muted-foreground">
          {doc.tenantName ?? "요청 기업"} 담당자가 의견을 반영해 후보를 조정합니다. 이 링크는 회신과 함께 닫혔습니다. 추가 의견은 담당자에게 직접 연락해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}
      <ClientReviewDocument
        doc={doc}
        renderCandidateExtra={(entryId) => (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {CLIENT_OPINIONS.map((op) => (
                <button
                  key={op}
                  type="button"
                  onClick={() => setOpinions((prev) => ({ ...prev, [entryId]: prev[entryId] === op ? undefined : op }))}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                    opinions[entryId] === op ? OPINION_CLASS[op] : "border-neutral-300 bg-white text-muted-foreground hover:bg-secondary"
                  )}
                  aria-pressed={opinions[entryId] === op}
                >
                  {CLIENT_OPINION_LABELS[op]}
                </button>
              ))}
            </div>
            {(opinions[entryId] === "replace" || opinions[entryId] === "hold" || (comments[entryId] ?? "").length > 0) && (
              <Textarea
                rows={2}
                value={comments[entryId] ?? ""}
                onChange={(e) => setComments((prev) => ({ ...prev, [entryId]: e.target.value }))}
                maxLength={1000}
                placeholder={opinions[entryId] === "replace" ? "교체를 요청하는 이유 (예: 유사 사업 경험 부족)" : "의견 (선택)"}
                className="text-sm"
              />
            )}
            {opinions[entryId] === "ok" && (
              <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setComments((prev) => ({ ...prev, [entryId]: prev[entryId] ?? " " }))}>
                의견 덧붙이기
              </button>
            )}
          </div>
        )}
      />

      <section className="space-y-2 rounded-lg border bg-white p-4">
        <p className="text-sm font-bold">전체 요청사항</p>
        <Textarea
          rows={4}
          value={general}
          onChange={(e) => setGeneral(e.target.value)}
          maxLength={4000}
          placeholder="후보 구성 전반에 대한 요청 (예: 2세션은 현장 경험 있는 멘토를 우선 배정 부탁드립니다)"
        />
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="respondent">회신자 이름·직함 (선택)</label>
            <Input id="respondent" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="예: 홍길동 주무관" />
          </div>
          <p className="text-[11px] text-muted-foreground">후보 {answered}/{total}명 의견 작성 · 유효기간 {new Date(expiresAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
        </div>
      </section>

      {confirming ? (
        <div className="space-y-3 rounded-lg border border-brand/40 bg-brand/5 p-4 text-sm">
          <p className="font-semibold">회신을 보내시겠습니까?</p>
          <p className="text-muted-foreground">회신은 한 번만 가능하며, 보낸 뒤 이 링크는 닫힙니다. 수정이 필요하면 요청 기업 담당자가 새 링크를 보내 드립니다.</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" disabled={pending} onClick={() => setConfirming(false)}>돌아가기</Button>
            <Button type="button" className="flex-1" disabled={pending} onClick={submit}>
              <Send className="mr-1 h-4 w-4" aria-hidden /> {pending ? "보내는 중…" : "예, 회신합니다"}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="lg" className="h-12 w-full text-base" disabled={pending || (answered === 0 && !general.trim())} onClick={() => setConfirming(true)}>
          <Send className="mr-1.5 h-4 w-4" aria-hidden /> 요청/회신 하기
        </Button>
      )}
    </div>
  );
}

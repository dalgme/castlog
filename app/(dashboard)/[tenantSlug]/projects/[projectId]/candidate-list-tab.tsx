"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck, Eye, MessageSquare, Plus, RotateCcw, Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CANDIDATE_LIST_STATUS_LABELS,
  MIN_MEMOS_PER_CANDIDATE,
  type CandidateListTabData,
} from "@/lib/integrations/candidate-list-shared";
import { CandidateListDocument, type CandidateDocSlot } from "@/components/candidate-lists/candidate-list-document";
import { ExpertInsightButtons } from "@/components/experts/expert-insight-buttons";
import { addQualificationMemo } from "@/app/(dashboard)/[tenantSlug]/experts/insight-actions";

import {
  addListReviewComment,
  closeInternalReview,
  completeMyReview,
  requestInternalReview,
  supersedeCandidateList,
} from "./candidate-list-actions";

/**
 * 리스트 작성 탭 (기획 승인 2026-11-07 — 2단계).
 *  - 초안: 섭외후보 등록 탭의 후보를 세션별 표로. 후보마다 자격메모 3개(이상)를 채우고,
 *    이력서·AI 요약·자격메모 이력 버튼을 쓴다.
 *  - 하단 '내부 검토' → 미리보기 → 검토자(이사·대표, 기본 전원) → 요청.
 *  - 검토 중: 스냅샷 문서 + 후보별/전체 의견, 검토자의 '검토 완료', 담당자의 '마감'·'다시 작성'.
 */
export function CandidateListTab({
  projectId,
  projectName,
  data,
  myUserId,
  canRequest,
}: {
  tenantSlug: string;
  projectId: string;
  projectName: string;
  data: CandidateListTabData;
  myUserId: string;
  /** 프로젝트 팀(PL·PM·부PM·담당)·대표·이사 — 요청·마감·다시 작성 */
  canRequest: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [previewOpen, setPreviewOpen] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast({ variant: "destructive", description: r.error ?? "실패했습니다." });
      else {
        if (ok) toast({ description: ok });
        router.refresh();
      }
    });
  };

  if (!data.ready) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">리스트 작성</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          리스트 작성 기능이 아직 열리지 않았습니다 (데이터베이스 마이그레이션 0013 적용 전). 관리자에게 적용을 요청해 주세요.
        </CardContent>
      </Card>
    );
  }

  const live = data.list;
  const draftSlots: CandidateDocSlot[] = data.draft.slots.map((s) => ({
    slotId: s.slotId,
    sessionLabel: s.sessionLabel,
    roleLabel: s.roleLabel,
    requiredCount: s.requiredCount,
    entries: s.entries.map((e) => ({
      id: e.positionId,
      rank: e.rank,
      code: e.code,
      expertName: e.expertName,
      feeText: e.feeText,
      memos: e.memos.map((m) => m.body),
      memoCount: e.memos.length,
    })),
  }));

  return (
    <div className="space-y-5">
      {/* 상태 머리 */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">섭외 후보 리스트</CardTitle>
            {live ? (
              <Badge className="bg-yellow-600 hover:bg-yellow-600">{CANDIDATE_LIST_STATUS_LABELS[live.status] ?? live.status} · v{live.revision}</Badge>
            ) : (
              <Badge variant="outline">초안 — 아직 검토 요청 전</Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {live && canRequest && live.status === "internal_requested" && (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => {
                if (window.confirm("아직 응답하지 않은 검토자가 있어도 내부 검토를 마감할까요?")) run(() => closeInternalReview(live.id), "내부 검토를 마감했습니다.");
              }}>
                <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden /> 내부 검토 마감
              </Button>
            )}
            {live && canRequest && (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => {
                if (window.confirm("이 리스트를 대체하고 다시 작성할까요? 지금까지의 의견은 이력으로 남습니다.")) run(() => supersedeCandidateList(live.id), "리스트를 대체했습니다. 후보를 고친 뒤 다시 요청하세요.");
              }}>
                <RotateCcw className="mr-1 h-4 w-4" aria-hidden /> 다시 작성
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>
            섭외후보 등록 탭에 올린 후보를 문서로 묶어 상무·대표의 내부 검토를 받는 자리입니다. 후보마다 <b>자격메모 {MIN_MEMOS_PER_CANDIDATE}개 이상</b>을 채우면 아래에서 ‘내부 검토’를 요청할 수 있습니다.
            검토가 끝나면 다음 단계(발주처 검토)로 넘어갑니다.
          </p>
          {live && (
            <p>
              {live.createdByName ?? "담당자"} 님이 {fmt(live.internalRequestedAt)} 요청 · 검토자 {live.reviews.filter((r) => r.status === "done").length}/{live.reviews.length}명 완료
              {live.internalDoneAt ? ` · ${fmt(live.internalDoneAt)} 완료` : ""}
            </p>
          )}
          {data.history.length > 0 && (
            <p>이전 리스트: {data.history.map((h) => `v${h.revision} ${CANDIDATE_LIST_STATUS_LABELS[h.status] ?? h.status}`).join(" · ")}</p>
          )}
        </CardContent>
      </Card>

      {/* 검토 중/완료 리스트 — 스냅샷 + 의견 */}
      {live && <ReviewPanel list={live} myUserId={myUserId} canRequest={canRequest} projectName={projectName} run={run} pending={pending} />}

      {/* 초안 — 자격메모 작성·버튼. 진행 중 리스트가 있어도 다음 리스트를 준비할 수 있게 항상 보인다 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{live ? "현재 후보 (다음 리스트 초안)" : "후보 리스트 초안"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.draft.shortOnMemos.length > 0 && (
            <Alert>
              <AlertDescription className="text-xs">
                자격메모가 {MIN_MEMOS_PER_CANDIDATE}개 미만인 후보: {data.draft.shortOnMemos.map((s) => `${s.expertName}(${s.count}/${MIN_MEMOS_PER_CANDIDATE})`).join(", ")} — 각 행의 자격메모 칸을 채우면 내부 검토를 요청할 수 있습니다.
              </AlertDescription>
            </Alert>
          )}
          {data.draft.slots.length === 0 && <p className="text-sm text-muted-foreground">세션이 없습니다. 기본설정 캘린더에서 세션을 만들고 섭외후보 등록 탭에서 후보를 배정하세요.</p>}
          {data.draft.slots.map((s) => (
            <section key={s.slotId} className="overflow-hidden rounded-lg border">
              <header className="flex flex-wrap items-center gap-2 bg-yellow-50 px-3 py-2 text-sm">
                <span className="font-bold text-yellow-900">{s.sessionLabel}</span>
                {s.roleLabel && <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-yellow-800">{s.roleLabel}</span>}
                <span className="ml-auto text-[11px] text-yellow-800">필요인원 {s.requiredCount}명 · 후보 {s.entries.length}명</span>
              </header>
              {s.entries.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">후보가 없습니다 — 섭외후보 등록 탭에서 배정하세요.</p>
              ) : (
                <ul className="divide-y">
                  {s.entries.map((e, i) => (
                    <li key={e.positionId} className="grid gap-2 px-3 py-2 md:grid-cols-[14rem_1fr]">
                      <div className="space-y-1 text-sm">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", i < s.requiredCount ? "bg-brand text-white" : "bg-secondary text-muted-foreground")}>{e.rank}순위{i < s.requiredCount ? " ★" : ""}</span>
                          <span className="font-mono text-xs font-semibold">{e.code}</span>
                        </div>
                        <p className="font-semibold">{e.expertName}</p>
                        <p className="text-xs text-muted-foreground">{e.feeText ? `의뢰비용 ${e.feeText}` : "의뢰비용 미정"}</p>
                        <ExpertInsightButtons expertId={e.expertId} expertName={e.expertName} projectId={projectId} positionId={e.positionId} canWriteMemo={canRequest} />
                      </div>
                      <MemoEditor
                        expertId={e.expertId}
                        projectId={projectId}
                        positionId={e.positionId}
                        memos={e.memos}
                        canWrite={canRequest}
                        pending={pending}
                        onAdd={(body) => run(() => addQualificationMemo({ expertId: e.expertId, projectId, positionId: e.positionId, body }))}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {/* 하단 — 내부 검토 (미리보기 → 검토자 → 요청) */}
          {canRequest && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {live
                  ? "진행 중인 리스트가 있습니다. 후보를 고쳐 다시 요청하려면 위에서 ‘다시 작성’을 먼저 누르세요."
                  : data.draft.candidateCount === 0
                    ? "후보를 배정하면 내부 검토를 요청할 수 있습니다."
                    : data.draft.shortOnMemos.length > 0
                      ? `자격메모가 부족한 후보 ${data.draft.shortOnMemos.length}명이 있어 아직 요청할 수 없습니다 (규칙).`
                      : `후보 ${data.draft.candidateCount}명 · 자격메모 조건 충족 — 미리보기 후 내부 검토를 요청하세요.`}
              </p>
              <Button type="button" size="sm" disabled={pending || Boolean(live) || data.draft.candidateCount === 0 || data.draft.shortOnMemos.length > 0} onClick={() => setPreviewOpen(true)} className="bg-yellow-600 hover:bg-yellow-700">
                <ClipboardCheck className="mr-1 h-4 w-4" aria-hidden /> 내부 검토
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {previewOpen && (
        <InternalReviewPreviewDialog
          projectId={projectId}
          projectName={projectName}
          slots={draftSlots}
          reviewerOptions={data.reviewerOptions}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

/** 후보 행의 자격메모 — 3칸은 항상 보이고(빈 칸은 입력), 더 추가할 수 있다 */
function MemoEditor({
  memos, canWrite, pending, onAdd,
}: {
  expertId: string; projectId: string; positionId: string;
  memos: { id: string; body: string; authorName: string | null; createdAt: string }[];
  canWrite: boolean; pending: boolean; onAdd: (body: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [extra, setExtra] = useState(false);
  const slots = Math.max(MIN_MEMOS_PER_CANDIDATE, memos.length);
  const needMore = memos.length < MIN_MEMOS_PER_CANDIDATE;
  const showInput = canWrite && (needMore || extra);
  function submit() {
    const body = draft.trim();
    if (!body) return;
    onAdd(body);
    setDraft("");
    setExtra(false);
  }
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold text-muted-foreground">
        자격메모 <span className={needMore ? "text-amber-700" : "text-emerald-700"}>{memos.length}/{MIN_MEMOS_PER_CANDIDATE}{memos.length > MIN_MEMOS_PER_CANDIDATE ? "+" : ""}</span>
      </p>
      <ol className="space-y-1">
        {Array.from({ length: slots }).map((_, i) => {
          const m = memos[memos.length - 1 - i] ? memos.slice().reverse()[i] : undefined;
          if (!m) {
            return (
              <li key={`empty-${i}`} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-4 text-right">{i + 1}.</span>
                <span className="italic">아직 없음</span>
              </li>
            );
          }
          return (
            <li key={m.id} className="flex items-start gap-2 text-xs">
              <span className="w-4 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
              <span className="flex-1 whitespace-pre-wrap rounded bg-secondary/60 px-2 py-1">{m.body}<span className="ml-1 text-[10px] text-muted-foreground">— {m.authorName ?? "?"}</span></span>
            </li>
          );
        })}
      </ol>
      {showInput ? (
        <div className="flex items-end gap-1.5">
          <Textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder={`자격메모 ${memos.length + 1} (예: 해당 분야 강의 5년)`} className="min-h-[2rem] text-xs" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={pending || !draft.trim()} onClick={submit}>추가</Button>
        </div>
      ) : canWrite ? (
        <button type="button" className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline" onClick={() => setExtra(true)}>
          <Plus className="h-3 w-3" aria-hidden /> 자격메모 추가
        </button>
      ) : null}
    </div>
  );
}

/** 미리보기 → 검토자 선택 → 요청 */
function InternalReviewPreviewDialog({
  projectId, projectName, slots, reviewerOptions, onClose,
}: {
  projectId: string; projectName: string; slots: CandidateDocSlot[];
  reviewerOptions: CandidateListTabData["reviewerOptions"]; onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set(reviewerOptions.map((r) => r.id)));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await requestInternalReview(projectId, { reviewerIds: Array.from(selected), note });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ description: `내부 검토를 요청했습니다 (검토자 ${selected.size}명).` });
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !pending) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Eye className="h-4 w-4" aria-hidden /> 내부 검토 요청 — 미리보기</DialogTitle>
          <DialogDescription>검토자가 보게 될 문서 그대로입니다. 확인한 뒤 검토자를 고르고 요청하세요. 요청하면 지금 후보가 스냅샷으로 굳어 검토자가 본 것과 이후 수정이 섞이지 않습니다.</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive"><AlertDescription className="text-xs">{error}</AlertDescription></Alert>}
        <div className="rounded-lg border bg-white p-4">
          <CandidateListDocument title={`${projectName} 섭외 후보 리스트`} subtitle="내부 검토용 — 순위★는 필요인원 안의 섭외 대상" slots={slots} compact />
        </div>
        <section className="space-y-1.5">
          <p className="text-sm font-semibold">내부 검토자 <span className="text-xs text-muted-foreground">(이사·대표 등급 — 기본 전원)</span></p>
          {reviewerOptions.length === 0 && <p className="text-xs text-destructive">이사·대표 등급의 활성 구성원이 없습니다. 임직원 설정에서 직급을 확인하세요.</p>}
          <ul className="grid gap-1 sm:grid-cols-2">
            {reviewerOptions.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm hover:bg-secondary/60">
                  <Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => setSelected((prev) => { const n = new Set(prev); if (v) n.add(r.id); else n.delete(r.id); return n; })} />
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-muted-foreground">{[r.positionName, r.grade === "ceo" ? "대표" : r.grade === "director" ? "이사" : null].filter(Boolean).join(" · ")}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-1.5">
          <p className="text-sm font-semibold">요청 메모 <span className="text-xs text-muted-foreground">(선택)</span></p>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="검토자에게 전할 말 (예: 2순위 후보 교체 여부 의견 부탁)" />
        </section>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>돌아가기</Button>
          <Button type="button" disabled={pending || selected.size === 0} onClick={submit} className="bg-yellow-600 hover:bg-yellow-700">
            <Send className="mr-1 h-4 w-4" aria-hidden /> {pending ? "요청 중…" : `내부 검토 요청 (${selected.size}명)`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 검토 중/완료 리스트 — 스냅샷 문서 + 후보별·전체 의견 + 검토 완료 */
function ReviewPanel({
  list, myUserId, canRequest, projectName, run, pending,
}: {
  list: NonNullable<CandidateListTabData["list"]>;
  myUserId: string;
  canRequest: boolean;
  projectName: string;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => void;
  pending: boolean;
}) {
  const myReview = list.reviews.find((r) => r.reviewerUserId === myUserId) ?? null;
  const canComment = Boolean(myReview) || canRequest;
  const commentsFor = (entryId: string | null) => list.comments.filter((c) => c.entryId === entryId);

  // 스냅샷 행을 세션별로 묶는다
  const bySlot = new Map<string, CandidateDocSlot>();
  for (const e of list.entries) {
    const key = e.slotId ?? e.sessionLabel;
    const slot = bySlot.get(key) ?? { slotId: key, sessionLabel: e.sessionLabel, roleLabel: e.roleLabel, requiredCount: 0, entries: [] };
    slot.entries.push({
      id: e.id,
      rank: e.rank,
      code: e.code,
      expertName: e.expertName,
      feeText: e.feeText,
      memos: [],
      memoCount: e.memoCount,
      extra: (
        <CommentThread
          comments={commentsFor(e.id)}
          canComment={canComment && list.status === "internal_requested"}
          pending={pending}
          placeholder={`${e.expertName} 후보에 대한 의견`}
          onAdd={(body) => run(() => addListReviewComment({ listId: list.id, entryId: e.id, body }))}
        />
      ),
    });
    bySlot.set(key, slot);
  }
  // 필요인원은 스냅샷에 없다 — ★ 표시는 순위 1~N 대신 순위 그대로 보여 준다(requiredCount=후보 수)
  const slots = Array.from(bySlot.values()).map((s) => ({ ...s, requiredCount: s.entries.length }));

  return (
    <Card className="border-yellow-300">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-sm">{list.title} — {CANDIDATE_LIST_STATUS_LABELS[list.status] ?? list.status}</CardTitle>
        {myReview && myReview.status === "requested" && list.status === "internal_requested" && (
          <Button type="button" size="sm" disabled={pending} onClick={() => run(() => completeMyReview(list.id), "검토를 완료했습니다.")} className="bg-emerald-600 hover:bg-emerald-700">
            <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden /> 내 검토 완료
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {list.reviews.map((r) => (
            <span key={r.id} className={cn("rounded-full border px-2 py-0.5", r.status === "done" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800")}>
              {r.reviewerName} · {r.status === "done" ? `완료 ${fmt(r.doneAt)}` : "검토 중"}
            </span>
          ))}
        </div>
        {list.note && <p className="rounded-md bg-secondary/60 p-2.5 text-xs"><span className="font-semibold">요청 메모</span> — {list.note}</p>}
        <CandidateListDocument title={`${projectName} 섭외 후보 리스트 v${list.revision}`} subtitle={`${fmt(list.internalRequestedAt)} 요청 시점 스냅샷 · 자격메모는 후보 행의 ‘자격메모’ 버튼으로`} slots={slots} showMemos={false} compact />
        <div className="space-y-1.5 rounded-lg border p-3">
          <p className="flex items-center gap-1 text-sm font-semibold"><MessageSquare className="h-4 w-4" aria-hidden /> 리스트 전체 의견</p>
          <CommentThread comments={commentsFor(null)} canComment={canComment && list.status === "internal_requested"} pending={pending} placeholder="리스트 전체에 대한 의견 (예: 1세션은 2순위 후보를 우선 섭외 권장)" onAdd={(body) => run(() => addListReviewComment({ listId: list.id, entryId: null, body }))} />
        </div>
      </CardContent>
    </Card>
  );
}

function CommentThread({
  comments, canComment, pending, placeholder, onAdd,
}: {
  comments: { id: string; authorName: string; body: string; createdAt: string }[];
  canComment: boolean; pending: boolean; placeholder: string; onAdd: (body: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  function submit() {
    const body = draft.trim();
    if (!body) return;
    onAdd(body);
    setDraft("");
    setOpen(false);
  }
  return (
    <div className="space-y-1 pl-2 text-xs">
      {comments.map((c) => (
        <p key={c.id} className="rounded bg-amber-50 px-2 py-1">
          <span className="font-semibold text-amber-900">{c.authorName}</span> <span className="text-[10px] text-muted-foreground">{fmt(c.createdAt)}</span>
          <span className="block whitespace-pre-wrap">{c.body}</span>
        </p>
      ))}
      {canComment && (open ? (
        <div className="flex items-end gap-1.5">
          <Textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder={placeholder} className="min-h-[2rem] text-xs" autoFocus onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={pending || !draft.trim()} onClick={submit}>의견 남기기</Button>
        </div>
      ) : (
        <button type="button" className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline" onClick={() => setOpen(true)}>
          <MessageSquare className="h-3 w-3" aria-hidden /> 의견 쓰기
        </button>
      ))}
      {!canComment && comments.length === 0 && <p className="text-[11px] text-muted-foreground">의견 없음</p>}
    </div>
  );
}

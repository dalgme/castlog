"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, Link2, Link2Off, SkipForward, Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CANDIDATE_LIST_STATUS_LABELS } from "@/lib/integrations/candidate-list-shared";
import {
  CLIENT_LINK_DEFAULT_DAYS,
  CLIENT_LINK_MAX_DAYS,
  CLIENT_OPINION_LABELS,
  type ClientOpinion,
  type ClientReviewTabData,
} from "@/lib/integrations/client-review-shared";
import { ClientReviewDocument } from "@/components/candidate-lists/client-review-document";

import { createClientReviewLink, revokeClientReviewLink, skipClientReview } from "./client-review-actions";

const OPINION_BADGE: Record<ClientOpinion, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  replace: "bg-rose-100 text-rose-800",
  hold: "bg-amber-100 text-amber-800",
};

/**
 * 발주처 검토 탭 (기획 승인 2026-11-07 — 3단계).
 * 내부 검토 완료 리스트 → 미리보기 → 링크 만들기(비밀번호·유효기간) → URL+비밀번호 전달(담당자) → 발주처 회신 확인.
 * 회신하면 링크는 자동 회수된다. 재검토는 새 링크(새 라운드). 필요 없으면 건너뛰기.
 */
export function ClientReviewTab({ data, canManage }: { tenantSlug: string; projectId: string; data: ClientReviewTabData; canManage: boolean }) {
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
        <CardHeader><CardTitle className="text-sm">발주처 검토</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">발주처 검토 기능이 아직 열리지 않았습니다 (데이터베이스 마이그레이션 0014 적용 전). 관리자에게 적용을 요청해 주세요.</CardContent>
      </Card>
    );
  }
  if (!data.list || !data.doc) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">발주처 검토</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          내부 검토가 완료된 섭외 후보 리스트가 없습니다. ‘리스트 작성’ 탭에서 내부 검토를 마치면 여기서 발주처용 웹문서를 만들 수 있습니다.
        </CardContent>
      </Card>
    );
  }

  const { list, doc } = data;
  const liveLink = data.links.find((l) => l.live) ?? null;
  const entryName = new Map(doc.slots.flatMap((s) => s.candidates.map((c) => [c.entryId, `${c.name} (${c.code})`] as const)));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">{list.title}</CardTitle>
            <Badge className="bg-cyan-700 hover:bg-cyan-700">{CANDIDATE_LIST_STATUS_LABELS[list.status] ?? list.status}</Badge>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setPreviewOpen(true)}>
                <Eye className="mr-1 h-4 w-4" aria-hidden /> 미리보기 · 링크 만들기
              </Button>
              {list.status !== "adjusting" && (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => {
                  if (window.confirm(data.responses.length > 0 ? "발주처 검토를 마치고 후보 조정 단계로 넘길까요?" : "발주처 검토 없이 후보 조정 단계로 넘길까요?")) run(() => skipClientReview(list.id), "후보 조정 단계로 넘겼습니다.");
                }}>
                  <SkipForward className="mr-1 h-4 w-4" aria-hidden /> {data.responses.length > 0 ? "검토 마치고 다음 단계" : "발주처 검토 건너뛰기"}
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-muted-foreground">
          <p>
            발주처가 보는 웹문서에는 후보의 <b>이름·전문분야·소속·직위·경력·지역·강의분야</b>만 담기고 연락처·단가·이력서는 보이지 않습니다.
            링크는 비밀번호로 열리고, 발주처가 ‘요청/회신 하기’를 누르면 <b>자동으로 회수</b>됩니다. 추가 의견이 필요하면 새 링크(새 라운드)를 만드세요.
          </p>
          {liveLink ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 p-2.5 text-cyan-900">
              <Link2 className="h-4 w-4" aria-hidden />
              <span className="font-semibold">{liveLink.round}라운드 링크 활성</span>
              <span>· 유효 {fmtDate(liveLink.expiresAt)}까지 · 열람 {liveLink.openCount}회{liveLink.lastOpenedAt ? ` (최근 ${fmt(liveLink.lastOpenedAt)})` : ""}</span>
              <span className="text-[11px]">· URL·비밀번호는 만들 때 한 번만 표시됩니다. 잊었으면 회수 후 새 링크를 만드세요.</span>
              {canManage && (
                <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 text-xs" disabled={pending} onClick={() => { if (window.confirm("이 링크를 회수할까요? 발주처는 더 이상 열 수 없습니다.")) run(() => revokeClientReviewLink(liveLink.id), "링크를 회수했습니다."); }}>
                  <Link2Off className="mr-1 h-3.5 w-3.5" aria-hidden /> 회수
                </Button>
              )}
            </div>
          ) : (
            <p>활성 링크가 없습니다. {canManage ? "‘미리보기 · 링크 만들기’로 발주처용 링크를 만드세요." : ""}</p>
          )}
          {data.links.length > 0 && (
            <p>
              링크 이력: {data.links.map((l) => `${l.round}라운드 ${l.revokedAt ? (l.revokeReason === "replied" ? "회신 완료" : l.revokeReason === "superseded" ? "새 링크로 대체" : "회수") : l.live ? "활성" : "만료"}`).join(" · ")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 회신 */}
      <Card className={cn(data.responses.length > 0 && "border-cyan-300")}>
        <CardHeader className="pb-3"><CardTitle className="text-sm">발주처 요청/회신 {data.responses.length > 0 ? `(${data.responses.length}건)` : ""}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.responses.length === 0 && <p className="text-sm text-muted-foreground">아직 회신이 없습니다. 발주처가 링크에서 ‘요청/회신 하기’를 누르면 여기에 저장됩니다.</p>}
          {data.responses.map((r) => (
            <div key={r.id} className="space-y-2 rounded-lg border p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{r.round}라운드</Badge>
                <span>{fmt(r.submittedAt)}</span>
                {r.respondentName && <span>· {r.respondentName}</span>}
              </p>
              {r.generalComment && <p className="whitespace-pre-wrap rounded-md bg-secondary/60 p-2.5"><span className="font-semibold">전체 요청사항</span> — {r.generalComment}</p>}
              {r.items.length > 0 && (
                <ul className="divide-y rounded-md border">
                  {r.items.map((it) => (
                    <li key={it.entryId} className="flex flex-wrap items-start gap-2 px-2.5 py-1.5 text-xs">
                      <span className={cn("rounded px-1.5 py-0.5 font-semibold", OPINION_BADGE[it.opinion])}>{CLIENT_OPINION_LABELS[it.opinion]}</span>
                      <span className="font-medium">{entryName.get(it.entryId) ?? "후보"}</span>
                      {it.comment && <span className="w-full whitespace-pre-wrap text-muted-foreground sm:w-auto sm:flex-1">{it.comment}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {data.responses.length > 0 && (
            <p className="text-xs text-muted-foreground">회신을 반영한 후보 수정과 품의는 다음 단계 ‘섭외후보 조정’ 탭에서 합니다{list.status !== "adjusting" ? " — 위의 ‘검토 마치고 다음 단계’를 누르면 열립니다" : ""}.</p>
          )}
        </CardContent>
      </Card>

      {/* 발주처가 보는 문서 (참고) */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">발주처가 보는 문서</CardTitle></CardHeader>
        <CardContent><ClientReviewDocument doc={doc} compact /></CardContent>
      </Card>

      {previewOpen && <CreateLinkDialog listId={list.id} data={data} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
}

/** 미리보기 → 비밀번호·유효기간 → 링크 만들기 → URL·비밀번호 1회 표시 */
function CreateLinkDialog({ listId, data, onClose }: { listId: string; data: ClientReviewTabData; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [days, setDays] = useState(CLIENT_LINK_DEFAULT_DAYS);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; password: string; expiresAt: string; round: number } | null>(null);

  function create() {
    setError(null);
    startTransition(async () => {
      const r = await createClientReviewLink(listId, { password, expiresDays: days });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult({ url: r.url, password: r.password, expiresAt: r.expiresAt, round: r.round });
      router.refresh();
    });
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ description: `${label}을(를) 복사했습니다.` });
    } catch {
      toast({ variant: "destructive", description: "복사하지 못했습니다. 직접 선택해 복사해 주세요." });
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !pending) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Eye className="h-4 w-4" aria-hidden /> 발주처 검토 — 미리보기 · 링크 만들기</DialogTitle>
          <DialogDescription>발주처가 비밀번호를 입력하면 보게 될 문서 그대로입니다. 연락처·단가·이력서는 들어가지 않습니다.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <Alert>
              <AlertDescription className="text-xs">
                {result.round}라운드 링크를 만들었습니다. <b>비밀번호는 지금만 보입니다</b> — 저장하지 않으니 발주처 담당자에게 URL과 함께 전달하세요(문자·메일·전화 등 담당자가 직접).
              </AlertDescription>
            </Alert>
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">URL</span>
                <code className="flex-1 break-all rounded bg-secondary px-2 py-1 text-xs">{result.url}</code>
                <Button type="button" size="sm" variant="outline" onClick={() => copy(result.url, "URL")}><Copy className="h-3.5 w-3.5" aria-hidden /></Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">비밀번호</span>
                <code className="flex-1 rounded bg-secondary px-2 py-1 text-base font-bold tracking-wider">{result.password}</code>
                <Button type="button" size="sm" variant="outline" onClick={() => copy(result.password, "비밀번호")}><Copy className="h-3.5 w-3.5" aria-hidden /></Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">유효기간</span>
                <span className="text-xs">{new Date(result.expiresAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })}까지</span>
              </div>
              <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => copy(`[${data.doc?.tenantName ?? ""}] ${data.doc?.projectName ?? ""} 섭외 후보 리스트 검토 요청\n${result.url}\n비밀번호: ${result.password}\n유효기간: ${new Date(result.expiresAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}까지\n후보별 의견과 요청사항을 적고 '요청/회신 하기'를 눌러 주세요.`, "전달 문구")}>
                <Copy className="mr-1 h-3.5 w-3.5" aria-hidden /> 전달 문구(URL+비밀번호) 복사
              </Button>
            </div>
            <Button type="button" className="w-full" onClick={onClose}>닫기</Button>
          </div>
        ) : (
          <>
            {error && <Alert variant="destructive"><AlertDescription className="text-xs">{error}</AlertDescription></Alert>}
            {data.doc && (
              <div className="rounded-lg border bg-white p-4">
                <ClientReviewDocument doc={data.doc} compact />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold" htmlFor="cl-pw">비밀번호 <span className="font-normal text-muted-foreground">(비우면 자동 생성, 6~32자)</span></label>
                <Input id="cl-pw" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={32} placeholder="자동 생성" autoComplete="off" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold" htmlFor="cl-days">유효기간(일) <span className="font-normal text-muted-foreground">(최대 {CLIENT_LINK_MAX_DAYS}일)</span></label>
                <Input id="cl-days" type="number" min={1} max={CLIENT_LINK_MAX_DAYS} value={days} onChange={(e) => setDays(Math.max(1, Math.min(CLIENT_LINK_MAX_DAYS, Number(e.target.value) || CLIENT_LINK_DEFAULT_DAYS)))} />
              </div>
            </div>
            {data.links.some((l) => l.live) && <p className="text-xs text-amber-800">활성 링크가 있습니다. 새 링크를 만들면 기존 링크는 자동으로 회수됩니다(발주처에 두 링크가 동시에 살아 있지 않게).</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={onClose}>돌아가기</Button>
              <Button type="button" disabled={pending} onClick={create} className="bg-cyan-700 hover:bg-cyan-800">
                <Send className="mr-1 h-4 w-4" aria-hidden /> {pending ? "만드는 중…" : "링크 만들기"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

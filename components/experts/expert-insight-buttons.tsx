"use client";

import { useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileText, History, RefreshCw, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import type { ResumeSummaryView } from "@/lib/ai/resume-summary";

import {
  addQualificationMemo,
  deleteQualificationMemo,
  getExpertResumeInfo,
  getResumeSummary,
  listQualificationMemos,
  type QualificationMemoRow,
} from "@/app/(dashboard)/[tenantSlug]/experts/insight-actions";

/**
 * 전문가 인사이트 버튼 세 개 (기획 승인 2026-11-07 — 1단계, 08·09번):
 * 이력서 보기 · AI 이력 요약 · 자격메모 이력. 전문가 목록·섭외 후보 검색·섭외후보 등록·
 * (2단계) 리스트 작성에서 같은 부품을 쓴다. 표 행 안에서 쓰므로 클릭 전파를 막는다.
 */
export function ExpertInsightButtons({
  expertId,
  expertName,
  projectId = null,
  positionId = null,
  canWriteMemo = true,
  size = "xs",
  className,
}: {
  expertId: string;
  expertName: string;
  /** 후보 리스트 맥락 — 메모에 프로젝트를 함께 남긴다 */
  projectId?: string | null;
  positionId?: string | null;
  canWriteMemo?: boolean;
  size?: "xs" | "sm";
  className?: string;
}) {
  const params = useParams<{ tenantSlug?: string }>();
  const tenantSlug = params?.tenantSlug ?? "";
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);

  const btn = cn(
    "inline-flex items-center gap-1 rounded-md border bg-background font-medium hover:bg-secondary disabled:opacity-50",
    size === "xs" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs"
  );
  const icon = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";

  function openResume(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const r = await getExpertResumeInfo(expertId);
      if (!r.ok) {
        toast({ variant: "destructive", description: r.error });
        return;
      }
      if (!r.documentId) {
        toast({ description: `${expertName} 전문가는 등록된 이력서가 없습니다.` });
        return;
      }
      window.open(`/${tenantSlug}/experts/documents/${r.documentId}/preview`, "_blank", "noopener");
    });
  }

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={btn} disabled={pending} onClick={openResume} title="이력서를 새 창에서 봅니다 (열람 기록이 남습니다)">
        <FileText className={cn(icon, "text-brand")} aria-hidden /> 이력서
      </button>
      <button type="button" className={btn} onClick={(e) => { e.stopPropagation(); setSummaryOpen(true); }} title="업로드된 이력서를 AI가 요약한 참고 정보 — 판단은 사람이 합니다">
        <Sparkles className={cn(icon, "text-violet-600")} aria-hidden /> AI 요약
      </button>
      <button type="button" className={btn} onClick={(e) => { e.stopPropagation(); setMemoOpen(true); }} title="여러 프로젝트에서 이 전문가에게 남긴 자격메모를 모아 봅니다">
        <History className={cn(icon, "text-amber-700")} aria-hidden /> 자격메모
      </button>
      {summaryOpen && <ResumeSummaryDialog expertId={expertId} expertName={expertName} onClose={() => setSummaryOpen(false)} />}
      {memoOpen && (
        <QualificationMemoDialog
          expertId={expertId}
          expertName={expertName}
          projectId={projectId}
          positionId={positionId}
          canWrite={canWriteMemo}
          onClose={() => setMemoOpen(false)}
        />
      )}
    </span>
  );
}

const SOURCE_LABEL: Record<string, string> = { pdf: "PDF", image: "이미지", docx: "DOCX", hwp: "HWP", hwpx: "HWPX" };

function ResumeSummaryDialog({ expertId, expertName, onClose }: { expertId: string; expertName: string; onClose: () => void }) {
  const [view, setView] = useState<ResumeSummaryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [started, setStarted] = useState(false);

  function load(regenerate = false) {
    setError(null);
    startTransition(async () => {
      const r = await getResumeSummary(expertId, { regenerate });
      if (!r.ok) setError(r.error);
      else setView(r.view);
    });
  }
  if (!started) {
    setStarted(true);
    load();
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !pending) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>AI 이력 요약 — {expertName}</DialogTitle>
          <DialogDescription>업로드된 이력서를 AI가 다섯 항목으로 요약한 참고 정보입니다. 섭외 여부·비용 판단은 사람이 합니다.</DialogDescription>
        </DialogHeader>
        {pending && !view && <p className="py-6 text-center text-sm text-muted-foreground">이력서를 읽고 요약하는 중… (처음이면 10~20초 걸릴 수 있습니다)</p>}
        {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">{error}</p>}
        {view?.status === "no_resume" && <p className="py-4 text-sm text-muted-foreground">등록된 이력서가 없어 요약할 수 없습니다. 전문가가 포털에서 이력서를 올리거나, 보유 파일을 대리 업로드하면 만들어집니다.</p>}
        {view?.status === "not_ready" && <p className="py-4 text-sm text-muted-foreground">AI 이력 요약 저장소가 아직 열리지 않았습니다 (마이그레이션 0012 적용 전).</p>}
        {view?.status === "ai_disabled" && <p className="py-4 text-sm text-muted-foreground">AI가 설정되지 않아 요약을 만들 수 없습니다 (ANTHROPIC_API_KEY 미설정). 이력서 원문은 ‘이력서’ 버튼으로 볼 수 있습니다.</p>}
        {(view?.status === "unsupported" || view?.status === "failed") && (
          <div className="space-y-2 text-sm">
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
              {view.status === "unsupported" ? "요약 불가: " : "요약 실패: "}{view.note}
            </p>
            <p className="text-xs text-muted-foreground">파일: {view.fileName}</p>
            {view.status === "failed" && (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => load(true)}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> 다시 시도
              </Button>
            )}
          </div>
        )}
        {view?.status === "ready" && (
          <div className="space-y-3">
            <dl className="divide-y rounded-lg border">
              {view.summary.split("\n").map((line, i) => {
                const idx = line.indexOf(":");
                const label = idx > 0 ? line.slice(0, idx).trim() : null;
                const body = idx > 0 ? line.slice(idx + 1).trim() : line.trim();
                if (!body && !label) return null;
                return (
                  <div key={i} className="grid grid-cols-[7rem_1fr] gap-2 px-3 py-2 text-sm">
                    <dt className="font-semibold text-muted-foreground">{label ?? "요약"}</dt>
                    <dd className="whitespace-pre-wrap">{body}</dd>
                  </div>
                );
              })}
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                원본 {view.fileName} ({SOURCE_LABEL[view.sourceKind ?? ""] ?? view.sourceKind ?? "-"}) ·{" "}
                {new Date(view.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })} 생성
                {view.model ? ` · ${view.model}` : ""}
              </span>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={pending} onClick={() => load(true)}>
                <RefreshCw className="mr-1 h-3 w-3" aria-hidden /> 다시 요약
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">AI가 요약한 참고 정보입니다. 원문과 다를 수 있으니 중요한 사실은 ‘이력서’ 원문으로 확인하세요.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QualificationMemoDialog({
  expertId, expertName, projectId, positionId, canWrite, onClose,
}: {
  expertId: string; expertName: string; projectId: string | null; positionId: string | null; canWrite: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<QualificationMemoRow[] | null>(null);
  const [ready, setReady] = useState(true);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [started, setStarted] = useState(false);

  function load() {
    startTransition(async () => {
      const r = await listQualificationMemos(expertId);
      if (!r.ok) toast({ variant: "destructive", description: r.error });
      else {
        setRows(r.rows);
        setReady(r.ready);
      }
    });
  }
  if (!started) {
    setStarted(true);
    load();
  }

  function submit() {
    const body = draft.trim();
    if (!body) return;
    startTransition(async () => {
      const r = await addQualificationMemo({ expertId, projectId, positionId, body });
      if (!r.ok) {
        toast({ variant: "destructive", description: r.error });
        return;
      }
      setDraft("");
      load();
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const r = await deleteQualificationMemo(id);
      if (!r.ok) toast({ variant: "destructive", description: r.error });
      else {
        load();
        router.refresh();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !pending) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>자격메모 이력 — {expertName}</DialogTitle>
          <DialogDescription>
            여러 프로젝트의 섭외 후보 리스트를 쓰며 이 전문가에게 남긴 자격메모가 모여 있습니다. 우리 회사 안에서만 보이고 전문가 본인·다른 회사에는 보이지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {rows === null && <p className="text-xs text-muted-foreground">불러오는 중…</p>}
          {rows !== null && !ready && <p className="text-sm text-muted-foreground">자격메모 저장소가 아직 열리지 않았습니다 (마이그레이션 0012 적용 전).</p>}
          {rows !== null && ready && rows.length === 0 && <p className="text-sm text-muted-foreground">아직 자격메모가 없습니다. 첫 메모를 남겨 보세요.</p>}
          {rows?.map((m) => (
            <div key={m.id} className="rounded-lg bg-secondary/60 p-2.5">
              <p className="whitespace-pre-wrap text-sm">{m.body}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {m.projectName ? <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700">{m.projectName}</span> : <span className="rounded bg-neutral-100 px-1.5 py-0.5">프로젝트 외</span>}
                <span>{m.authorName ?? "?"} · {new Date(m.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })}</span>
                {m.deletable && (
                  <button type="button" className="ml-auto inline-flex items-center gap-0.5 text-destructive hover:underline" disabled={pending} onClick={() => remove(m.id)} title="본인이 쓴 메모는 10분 안에만 지울 수 있습니다">
                    <Trash2 className="h-3 w-3" aria-hidden /> 지우기
                  </button>
                )}
              </p>
            </div>
          ))}
        </div>
        {canWrite && ready && (
          <div className="space-y-2 border-t pt-3">
            <Textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              placeholder={projectId ? "이 프로젝트 후보로서의 자격메모 (예: 해당 분야 강의 5년, 발주처 유사 사업 경험)" : "자격메모 (프로젝트 밖에서 남기는 일반 메모)"}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">{draft.length} / 500 · 작성자·일시가 함께 남고, 지울 수 있는 시간은 10분입니다</span>
              <Button type="button" size="sm" onClick={submit} disabled={pending || !draft.trim()}>
                {pending ? "저장 중…" : "자격메모 추가"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

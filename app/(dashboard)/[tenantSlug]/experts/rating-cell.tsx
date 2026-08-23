"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import {
  getExpertRatingLogs,
  setExpertRating,
  type RatingLogRow,
} from "./profile-actions";

/**
 * 자사 평가 셀 (기획 확정 2026-08-23) — 회사의 주관적 기록.
 * 프로젝트 평가 평균(읽기)과 자사 평점(1~10, 직접 지정)을 함께 보여주고,
 * 팝업에서 점수를 매기면 변경이 평가 로그로 남는다. 전문가 본인 비노출.
 */
export function ExpertRatingCell({
  expertId,
  expertName,
  avg,
  myRating,
  canManage,
}: {
  expertId: string;
  expertName: string;
  /** 프로젝트 평가 평균 (없으면 null) */
  avg: string | null;
  /** 자사 평점 (expert_tenant_profiles.rating) */
  myRating: number | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<number | null>(myRating);
  const [note, setNote] = useState("");
  const [logs, setLogs] = useState<RatingLogRow[] | null>(null);

  function openDialog() {
    setOpen(true);
    setPicked(myRating);
    setNote("");
    setLogs(null);
    void getExpertRatingLogs(expertId).then((r) => {
      if (r.ok) setLogs(r.rows);
    });
  }

  function save() {
    startTransition(async () => {
      const r = await setExpertRating({ expertId, rating: picked, note });
      if (r.ok) {
        toast({ description: "자사 평점이 저장되었습니다 (로그 기록됨)." });
        setOpen(false);
        router.refresh();
      } else {
        toast({ variant: "destructive", description: r.error });
      }
    });
  }

  const display = (
    <span className="whitespace-nowrap text-sm">
      {myRating !== null ? (
        <strong>{myRating}점</strong>
      ) : avg ? (
        <strong>{avg}</strong>
      ) : (
        <span className="text-muted-foreground">평가 없음</span>
      )}
      {myRating !== null && avg && (
        <span className="ml-1 text-[11px] text-muted-foreground">평균 {avg}</span>
      )}
    </span>
  );

  if (!canManage) return display;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-secondary"
        title="자사 평점 매기기 · 평가 로그 보기"
      >
        {display}
        <Pencil className="h-3 w-3 text-muted-foreground" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>자사 평가 — {expertName}</DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            우리 회사만의 주관적 기록입니다 — 전문가 본인과 다른 회사에는 보이지
            않습니다. 프로젝트 평가 평균: {avg ?? "없음"}
          </p>

          <div className="space-y-2">
            <p className="text-sm font-semibold">자사 평점 (1~10)</p>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPicked(picked === n ? null : n)}
                  className={`h-8 w-8 rounded-md border text-sm font-semibold ${
                    picked === n
                      ? "border-brand bg-brand text-white"
                      : "hover:bg-secondary"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="변경 사유 (선택 · 로그에 남습니다)"
              maxLength={300}
            />
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "저장 중..." : picked === null ? "평점 해제 저장" : `${picked}점으로 저장`}
            </Button>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-semibold">평가 로그 (점수·등급 변경 이력)</p>
            {logs === null ? (
              <p className="text-xs text-muted-foreground">불러오는 중...</p>
            ) : logs.length === 0 ? (
              <p className="text-xs text-muted-foreground">아직 기록이 없습니다.</p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {logs.map((log) => (
                  <li key={log.id} className="rounded-md bg-secondary/50 p-2 text-xs">
                    <span className="font-semibold">
                      {log.kind === "grade" ? "등급" : "평점"} → {log.value}
                    </span>
                    {log.note && <span className="ml-1">· {log.note}</span>}
                    <span className="ml-1 text-muted-foreground">
                      — {log.authorName},{" "}
                      {new Date(log.createdAt).toLocaleString("ko-KR", {
                        timeZone: "Asia/Seoul",
    hour12: false,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

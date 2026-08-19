"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Send, Lock } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatKrw } from "@/lib/approvals/constants";

import { confirmSettlementReview } from "./closing-actions";

export type SettlementSummary = {
  expertCount: number;
  lineCount: number;
  totalGross: number;
  totalWithholding: number;
  totalNet: number;
  /** 지급품의서 본문 — 서버에서 만든 그대로 보여 준다 */
  document: string;
  note: string | null;
  reviewedAt: string | null;
  submitted: boolean;
};

function SummaryCell({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          strong
            ? "mt-0.5 text-lg font-bold text-brand-navy"
            : "mt-0.5 text-lg font-semibold"
        }
      >
        {value}
      </p>
    </div>
  );
}

/**
 * 회계담당자의 지급 품의 검토.
 *
 * 이 화면은 **회계담당관과 임원 이상**에게만 열린다 (서버에서도 같은 판정).
 * 프로젝트 담당자라는 이유로 전체 지급 금액이 한 화면에 모여서는 안 된다.
 *
 * '지급품의서 내용 확인 완료'는 확인과 상신을 한 번에 한다 — 확인만 하고
 * 상신을 잊으면 지급이 그대로 멈춘다.
 */
export function SettlementPanel({
  projectId,
  summary,
  canReview,
}: {
  projectId: string;
  summary: SettlementSummary;
  canReview: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(summary.note ?? "");
  const [confirming, setConfirming] = useState(false);

  if (!canReview) {
    return (
      <Alert>
        <AlertDescription className="flex items-start gap-2 text-sm">
          <Lock className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />
          지급 품의 검토를 요청했습니다. 지급품의서는 <strong>회계담당자와 임원
          이상</strong>만 열람할 수 있습니다.
        </AlertDescription>
      </Alert>
    );
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await confirmSettlementReview({ projectId, note });
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCell
          label="참여 전문가"
          value={`${summary.expertCount}명 (${summary.lineCount}건)`}
        />
        <SummaryCell label="전체 금액" value={formatKrw(summary.totalGross)} strong />
        <SummaryCell label="전체 원천세 (참고)" value={formatKrw(summary.totalWithholding)} />
        <SummaryCell label="전체 실지급액 (참고)" value={formatKrw(summary.totalNet)} strong />
      </div>

      <p className="text-xs text-muted-foreground">
        원천세·실지급액은 소득유형에 따른 참고 계산치입니다. 세액 확정은 세무
        검토를 거칩니다.
      </p>

      <div>
        <Label htmlFor="settlement-note">기타 메모 (선택)</Label>
        <Textarea
          id="settlement-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={summary.submitted || pending}
          placeholder="지급 시기, 증빙 요청, 예산 계정 등 — 지급품의서 본문에 함께 실립니다."
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap gap-2">
          <DialogTrigger asChild>
            <Button variant="outline">
              <FileText className="mr-1.5 h-4 w-4" />
              지급품의서
            </Button>
          </DialogTrigger>
          {summary.submitted && (
            <p className="self-center text-xs text-muted-foreground">
              {summary.reviewedAt
                ? `${new Date(summary.reviewedAt).toLocaleString("ko-KR")} 확인 완료 · 품의 송신됨`
                : "확인 완료 · 품의 송신됨"}
            </p>
          )}
        </div>

        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>지급품의서</DialogTitle>
            <DialogDescription>
              프로젝트 종료 및 전문가 지급 내역입니다. 언제든 다시 열어볼 수
              있습니다.
            </DialogDescription>
          </DialogHeader>

          <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-secondary/20 p-3 font-sans text-xs leading-relaxed">
            {summary.document}
          </pre>

          {summary.submitted ? (
            <Button className="w-full" onClick={() => setOpen(false)}>
              닫기
            </Button>
          ) : confirming ? (
            <div className="space-y-2 rounded-md border-2 border-brand bg-brand/[0.06] p-3">
              <p className="text-sm font-semibold text-brand-navy">
                확인을 누르면 <strong>프로젝트 종료 및 지급 품의서</strong>가 바로
                상신됩니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={confirm} disabled={pending}>
                  <Send className="mr-1.5 h-4 w-4" />
                  {pending ? "송신 중…" : "예, 확인했고 송신합니다"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                >
                  아니오
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setConfirming(true)} disabled={pending}>
              지급품의서 내용 확인 완료
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

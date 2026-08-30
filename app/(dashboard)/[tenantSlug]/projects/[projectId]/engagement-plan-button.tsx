"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSignature } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatKrw } from "@/lib/approvals/constants";

import { submitEngagementPlan } from "./position-assign-actions";
import {
  ApproverPicker,
  type ApproverOption,
} from "@/components/approvals/approver-picker";

export type PlanPreviewLine = {
  code: string;
  expertName: string;
  sessionName: string;
  schedule: string;
  fee: number;
  /** 소속 세션(슬롯) — 세션별 선택 상신의 그룹 키 (기획 2026-08-30 — 22번) */
  slotId: string;
  /** 전문가가 배정된 자리인가 (미배정 TO 자리는 false) */
  assigned: boolean;
  /** 순위 상위 '필요인원'에 들어 실제 섭외·금액 대상인가 */
  selected: boolean;
  /** 세션 필요인원 */
  requiredCount: number;
};

/**
 * 섭외 품의서 자동 작성 및 송신.
 *
 * 배정이 100% 찼을 때만 열린다. 담당자가 다시 타이핑할 것은 없다 — 눌러서
 * 무엇이 올라가는지 먼저 보여 주고, 확인하면 그대로 상신한다.
 */
export function EngagementPlanButton({
  projectId,
  disabled,
  disabledReason,
  lines,
  approverOptions = [],
}: {
  projectId: string;
  disabled: boolean;
  /** 왜 못 누르는지 — 비활성 버튼만 두면 사용자는 고장으로 읽는다 */
  disabledReason: string;
  lines: PlanPreviewLine[];
  /** 결재라인 직접 지정 후보 (기획 2026-08-30 — 18번) */
  approverOptions?: ApproverOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [approverIds, setApproverIds] = useState<string[]>([]);

  // 세션별 선택 상신 (기획 확정 2026-08-30 — 22번): 완성된 세션만 골라 먼저
  // 상신하고, 미완성 세션은 보완 후 변경 품의로 추가한다.
  const sessions = useMemo(() => {
    const bySlot = new Map<
      string,
      {
        slotId: string;
        label: string;
        lines: PlanPreviewLine[];
        assignedCount: number;
        unassignedCount: number;
        requiredCount: number;
        ready: boolean;
        amount: number;
      }
    >();
    for (const line of lines) {
      let s = bySlot.get(line.slotId);
      if (!s) {
        s = {
          slotId: line.slotId,
          label: `${line.sessionName} · ${line.schedule}`,
          lines: [],
          assignedCount: 0,
          unassignedCount: 0,
          requiredCount: line.requiredCount,
          ready: false,
          amount: 0,
        };
        bySlot.set(line.slotId, s);
      }
      s.lines.push(line);
      if (line.assigned) s.assignedCount += 1;
      else s.unassignedCount += 1;
      if (line.selected) s.amount += line.fee;
    }
    for (const s of Array.from(bySlot.values())) {
      s.ready =
        s.unassignedCount === 0 && s.assignedCount >= s.requiredCount;
    }
    return Array.from(bySlot.values());
  }, [lines]);

  // 기본 선택 = 완성된 세션 전부. 초기화는 마운트 시가 아니라 대화상자를
  // 열 때마다 한다 — 배정은 대개 마운트 이후 router.refresh()로 도착하므로
  // 마운트 시점 계산은 항상 0개 선택이 된다 (리뷰 P2-4)
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  function handleOpenChange(next: boolean) {
    if (next) {
      setError(null);
      setSelectedSlotIds(
        sessions.filter((s) => s.ready).map((s) => s.slotId)
      );
    }
    setOpen(next);
  }
  const selectedSessions = sessions.filter((s) =>
    selectedSlotIds.includes(s.slotId)
  );
  const selectedAmount = selectedSessions.reduce((sum, s) => sum + s.amount, 0);
  const selectedUnready = selectedSessions.filter((s) => !s.ready);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitEngagementPlan(
        projectId,
        approverIds,
        // 전 세션 선택이어도 명시적으로 넘긴다 — 서버가 같은 검사를 태운다
        selectedSlotIds
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (disabled) {
    // 잠긴 이유를 hover 툴팁에만 두면 터치 기기에서는 영영 못 본다 (검수 G2)
    return (
      <span className="inline-flex max-w-[240px] flex-col items-start gap-0.5">
        <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
          <FileSignature className="h-3.5 w-3.5" aria-hidden />
          섭외 품의서 자동 작성 및 송신
        </span>
        <span className="text-[11px] leading-tight text-muted-foreground">
          {disabledReason}
        </span>
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FileSignature className="mr-1.5 h-3.5 w-3.5" />
          섭외 품의서 자동 작성 및 송신
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>섭외 품의서 — 상신 전 확인</DialogTitle>
          <DialogDescription>
            프로젝트 기본정보와 세션별 배정 명단으로 품의서가 자동 작성됩니다.
            결재라인은 아래에서 직접 고를 수 있으며, 마지막은 상무이사 →
            대표(고정)입니다.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 항상 표시 (기획 개정 2026-08-30 — 30번): 후보가 없어도 고정
            결재선(상무이사 → 대표)이 어떻게 잡히는지 상신 전에 보여 준다 */}
        <ApproverPicker
          options={approverOptions}
          selected={approverIds}
          onChange={setApproverIds}
          disabled={pending}
        />

        <div className="rounded-lg border">
          <div className="flex items-baseline justify-between border-b bg-secondary/40 px-3 py-2">
            <span className="text-xs font-semibold">
              세션별 선택 상신 · {selectedSlotIds.length}/{sessions.length}개
              세션
            </span>
            <span className="text-sm font-extrabold tabular-nums">
              {formatKrw(selectedAmount)}
            </span>
          </div>
          <ul className="max-h-80 divide-y overflow-y-auto text-sm">
            {sessions.map((s) => {
              const checked = selectedSlotIds.includes(s.slotId);
              return (
                <li key={s.slotId} className="px-3 py-2">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      disabled={pending}
                      onCheckedChange={(v) =>
                        setSelectedSlotIds((prev) =>
                          v === true
                            ? [...prev, s.slotId]
                            : prev.filter((id) => id !== s.slotId)
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium">{s.label}</span>
                        <span className="ml-auto tabular-nums text-xs text-muted-foreground">
                          {formatKrw(s.amount)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {s.lines
                          .filter((l) => l.selected)
                          .map((l) => `${l.code} ${l.expertName}`)
                          .join(" · ") || "섭외 대상 없음"}
                      </span>
                      {!s.ready && (
                        <span className="mt-1 block rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-900">
                          {s.unassignedCount > 0
                            ? `후보 미배정 ${s.unassignedCount}자리 — 미배정 항목을 삭제하거나 전문가를 배정한 뒤 상신할 수 있습니다.`
                            : `배정 ${s.assignedCount}/${s.requiredCount}명 — 필요인원만큼 배정한 뒤 상신할 수 있습니다.`}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        {selectedUnready.length > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              선택한 세션 중 {selectedUnready.length}개에 후보 미배정 항목이
              남아 있습니다. 해당 세션의 미배정 항목을 삭제하거나 배정한 뒤
              다시 상신하거나, 선택에서 빼고 완성된 세션만 먼저 상신하세요.
              (미완성 세션은 추후 보완해서 계획 변경 품의로 추가할 수 있습니다)
            </AlertDescription>
          </Alert>
        )}

        <p className="rounded-md bg-secondary/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
          선택한 세션만 계획 품의에 담깁니다. 미완성 세션은 나중에 보완해
          <b> 계획 변경 품의</b>로 추가 상신하면 됩니다. 상신 후에는 결재가
          끝나야 선택 세션의 섭외 진행이 열리며, 이 시점까지 전문가에게는
          아무것도 나가지 않습니다.
        </p>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            취소
          </Button>
          <Button
            className="h-11 flex-1 text-base font-bold"
            onClick={submit}
            disabled={
              pending || selectedSlotIds.length === 0 || selectedUnready.length > 0
            }
          >
            {pending
              ? "상신 중…"
              : `선택한 품의 상신하기 (${selectedSlotIds.length}개 세션)`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

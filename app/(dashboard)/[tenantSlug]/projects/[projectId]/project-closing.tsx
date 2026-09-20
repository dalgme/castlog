"use client";

import { useMemo, useState, useTransition } from "react";
import { Lock, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CONTRIBUTION_SLOT_KEYS,
  CONTRIBUTION_SLOT_LABELS,
  isExtraSlot,
  type ContributionSlotKey,
  type ContributionSlotRow,
} from "@/lib/integrations/contribution-slots";

import {
  saveProjectContributions,
  submitProjectClosing,
  unlockProjectContributions,
} from "../actions";

export type StaffOption = { id: string; name: string };

type Cell = { userId: string; percentage: string; roleLabel: string };

/** 사람을 고르지 않는 열 — 설정의 대표·이사 직급에서 자동으로 온다 (기획 2026-09-21) */
function isFixedSlot(key: ContributionSlotKey): boolean {
  return key === "ceo" || key === "director";
}

const SELECT_CLASS =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

/**
 * 참여율 배분 — 가로 표 (기획 지시 2026-09-21).
 *
 * 열 = 대표이사 · 상무이사 · PL · PM · 부PM · 담당 · 빈칸 2개, 열마다 사람 한 명과 %.
 * 합계는 맨 앞 칸에서 실시간으로 집계되고, 정확히 100%일 때만 '확정'이 뜬다.
 * 확정하면 잠기고 '수정'이 잠금을 푼다. 저장은 열 단위(project_contributions.slot_key).
 * 종료 상신(approvals·experts 조합에 따라)은 종전대로 이 자리에서 한다.
 */
export function ProjectClosing({
  projectId,
  staff,
  initialRows,
  defaults,
  confirmedAt,
  confirmedByName,
  closingInProgress,
  approvalsActive,
  contributionsOnly = false,
  canEdit,
}: {
  projectId: string;
  staff: StaffOption[];
  /** 저장된 열 (없으면 빈 표 + 기본 사람) */
  initialRows: ContributionSlotRow[];
  /** 열별 기본 사람 — 대표·이사 직급, PL/PM/부PM/담당 배정에서 (저장분이 없을 때만) */
  defaults: Partial<Record<ContributionSlotKey, string>>;
  confirmedAt: string | null;
  confirmedByName: string | null;
  closingInProgress: boolean;
  approvalsActive: boolean;
  /**
   * 참여율 입력만 쓴다 — 종료·지급 품의는 마감 탭의 절차가 몰아서 처리한다.
   * 종료 버튼이 두 곳에 있으면 어느 쪽이 진짜 종료인지 알 수 없다.
   */
  contributionsOnly?: boolean;
  /** 관리자 이상(서버·RLS와 같은 선) — 아니면 읽기만 */
  canEdit: boolean;
}) {
  const [cells, setCells] = useState<Record<ContributionSlotKey, Cell>>(() => {
    const out = {} as Record<ContributionSlotKey, Cell>;
    const stored = new Map(initialRows.map((r) => [r.slotKey, r]));
    for (const key of CONTRIBUTION_SLOT_KEYS) {
      const row = stored.get(key);
      out[key] = row
        ? {
            // 대표이사·상무이사 열은 직급에서 오는 고정 사람 — 저장분보다 설정이 우선
            userId: isFixedSlot(key) ? (defaults[key] ?? "") : row.userId,
            percentage: row.percentage > 0 ? String(row.percentage) : "",
            roleLabel: row.roleLabel ?? "",
          }
        : { userId: defaults[key] ?? "", percentage: "", roleLabel: "" };
    }
    return out;
  });
  const [locked, setLocked] = useState(confirmedAt !== null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const total = useMemo(
    () =>
      CONTRIBUTION_SLOT_KEYS.reduce((sum, key) => {
        const n = parseInt(cells[key].percentage, 10);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0),
    [cells]
  );
  const editable = canEdit && !locked && !pending;

  function update(key: ContributionSlotKey, patch: Partial<Cell>) {
    setCells((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }
  function setPercent(key: ContributionSlotKey, value: string) {
    if (value !== "" && !/^\d{1,3}$/.test(value)) return;
    update(key, { percentage: value });
  }

  function collectRows(): ContributionSlotRow[] {
    return CONTRIBUTION_SLOT_KEYS.flatMap((key) => {
      const c = cells[key];
      const pct = parseInt(c.percentage, 10);
      if (!c.userId || !Number.isFinite(pct) || pct <= 0) return [];
      return [
        {
          slotKey: key,
          roleLabel: isExtraSlot(key) ? c.roleLabel.trim() || null : null,
          userId: c.userId,
          percentage: pct,
        },
      ];
    });
  }

  function hasPercentWithoutPerson(): ContributionSlotKey | null {
    for (const key of CONTRIBUTION_SLOT_KEYS) {
      const c = cells[key];
      const pct = parseInt(c.percentage, 10);
      if (Number.isFinite(pct) && pct > 0 && !c.userId) return key;
    }
    return null;
  }

  function columnLabel(key: ContributionSlotKey): string {
    return isExtraSlot(key)
      ? cells[key].roleLabel.trim() || "빈칸"
      : CONTRIBUTION_SLOT_LABELS[key];
  }

  function onSave(confirm: boolean) {
    const orphan = hasPercentWithoutPerson();
    if (orphan) {
      toast({
        variant: "destructive",
        description: `'${columnLabel(orphan)}' 열에 %는 있는데 사람이 없습니다. 사람을 고르거나 %를 지워 주세요.`,
      });
      return;
    }
    if (confirm && total !== 100) {
      toast({ variant: "destructive", description: `합계가 정확히 100%여야 확정할 수 있습니다 (현재 ${total}%).` });
      return;
    }
    startTransition(async () => {
      const result = await saveProjectContributions(
        { projectId, rows: collectRows() },
        { confirm }
      );
      if (result.ok) {
        if (confirm) setLocked(true);
        toast({ description: confirm ? "참여율을 확정했습니다. 수정하려면 '수정'을 누르세요." : "참여율을 저장했습니다." });
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  function onUnlock() {
    startTransition(async () => {
      const result = await unlockProjectContributions(projectId);
      if (result.ok) {
        setLocked(false);
        toast({ description: "잠금을 풀었습니다. 고친 뒤 다시 '확정'을 눌러 주세요." });
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  function onSubmitClosing() {
    if (total !== 100) {
      toast({
        variant: "destructive",
        description: `기여도 합계가 100%가 아닙니다 (현재 ${total}%).`,
      });
      return;
    }
    if (
      !window.confirm(
        approvalsActive
          ? "종료 품의를 상신할까요? 승인되면 프로젝트가 종료됩니다."
          : "프로젝트를 종료할까요? 되돌릴 수 없습니다."
      )
    ) {
      return;
    }
    startTransition(async () => {
      // 상신 전 최신 기여도 저장 (확정된 상태면 값이 이미 저장돼 있다)
      if (!locked) {
        const saved = await saveProjectContributions({ projectId, rows: collectRows() });
        if (!saved.ok) {
          toast({ variant: "destructive", description: saved.error });
          return;
        }
      }
      const result = await submitProjectClosing(projectId);
      if (result.ok) {
        toast({
          description: result.submitted
            ? "종료 품의를 상신했습니다."
            : "프로젝트를 종료했습니다.",
        });
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  if (closingInProgress) {
    return (
      <p className="text-sm text-muted-foreground">
        종료 품의가 진행 중입니다. 결재가 승인되면 프로젝트가 자동으로 종료됩니다.
      </p>
    );
  }

  const totalOk = total === 100;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        대표이사·상무이사는 설정의 대표·이사 직급에서 자동으로 오는 고정 열이고(0%도 가능),
        나머지 열은 사람을 고르고 아랫줄에 %를 넣으세요. 합계가{" "}
        <strong>정확히 100%</strong>가 되면 「확정」 버튼이 나타납니다. 확정하면 표가 잠기고,
        「수정」을 누르면 다시 고칠 수 있습니다.{" "}
        {contributionsOnly
          ? "확정한 값은 임원 대시보드 성과 집계에 반영됩니다."
          : approvalsActive
            ? "종료는 품의 승인으로 확정됩니다."
            : "결재 없이 즉시 종료됩니다."}
      </p>
      {locked && (
        <p className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
          <Lock className="h-3 w-3" aria-hidden />
          확정됨
          {confirmedAt && (
            <span className="font-normal text-emerald-700">
              · {new Date(confirmedAt).toLocaleString("ko-KR")}
              {confirmedByName ? ` · ${confirmedByName}` : ""}
            </span>
          )}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="w-24 border bg-neutral-100 px-2 py-2 text-center text-xs font-semibold"
              >
                합계
              </th>
              {CONTRIBUTION_SLOT_KEYS.map((key) => (
                <th
                  key={key}
                  scope="col"
                  className="border bg-neutral-50 px-1 py-1.5 text-center text-xs font-semibold"
                >
                  {isExtraSlot(key) ? (
                    editable ? (
                      <Input
                        value={cells[key].roleLabel}
                        onChange={(e) => update(key, { roleLabel: e.target.value })}
                        placeholder="열 이름"
                        maxLength={30}
                        className="h-7 text-center text-xs"
                        aria-label="열 이름"
                      />
                    ) : (
                      <span className={cn(!cells[key].roleLabel.trim() && "text-muted-foreground")}>
                        {cells[key].roleLabel.trim() || "—"}
                      </span>
                    )
                  ) : (
                    CONTRIBUTION_SLOT_LABELS[key]
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                rowSpan={2}
                className={cn(
                  "border px-2 py-2 text-center align-middle text-lg font-bold tabular-nums",
                  totalOk ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                )}
                aria-live="polite"
              >
                {total}%
                {!totalOk && (
                  <div className="text-[10px] font-normal text-rose-600">
                    {total < 100 ? `${100 - total}% 남음` : `${total - 100}% 초과`}
                  </div>
                )}
              </td>
              {CONTRIBUTION_SLOT_KEYS.map((key) => (
                <td key={key} className="border px-1 py-1">
                  {isFixedSlot(key) ? (
                    <div
                      className="px-1 text-center text-xs"
                      title="설정의 대표·이사 직급에서 자동으로 채워지는 고정 열입니다. 참여율은 0%로 둘 수 있습니다."
                    >
                      {staff.find((s) => s.id === cells[key].userId)?.name ?? (
                        <span className="text-muted-foreground">
                          {key === "ceo" ? "대표 직급 미설정" : "이사 직급 미설정"}
                        </span>
                      )}
                    </div>
                  ) : editable ? (
                    <select
                      className={SELECT_CLASS}
                      value={cells[key].userId}
                      onChange={(e) => update(key, { userId: e.target.value })}
                      aria-label={`${columnLabel(key)} 담당자`}
                    >
                      <option value="">(없음)</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="px-1 text-center text-xs">
                      {staff.find((s) => s.id === cells[key].userId)?.name ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              {CONTRIBUTION_SLOT_KEYS.map((key) => (
                <td key={key} className="border px-1 py-1">
                  <div className="flex items-center justify-center gap-0.5">
                    <Input
                      inputMode="numeric"
                      className="h-8 w-16 text-right text-sm"
                      value={cells[key].percentage}
                      onChange={(e) => setPercent(key, e.target.value)}
                      placeholder="0"
                      disabled={!editable || (isFixedSlot(key) && !cells[key].userId)}
                      aria-label={`${columnLabel(key)} 참여율`}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {locked ? (
            <Button type="button" variant="outline" size="sm" onClick={onUnlock} disabled={pending}>
              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden />
              수정
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSave(false)}
                disabled={pending}
              >
                저장
              </Button>
              {totalOk && (
                <Button
                  type="button"
                  size="sm"
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => onSave(true)}
                  disabled={pending}
                >
                  <Lock className="mr-1 h-3.5 w-3.5" aria-hidden />
                  확정
                </Button>
              )}
            </>
          )}
          {!contributionsOnly && (
            <Button
              type="button"
              size="sm"
              onClick={onSubmitClosing}
              disabled={pending || !totalOk}
            >
              {approvalsActive ? "종료 품의 상신" : "프로젝트 종료"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

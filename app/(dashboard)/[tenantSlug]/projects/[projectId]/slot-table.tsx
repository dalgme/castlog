"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ENGAGEMENT_ROLE_TYPES } from "@/lib/integrations/engagement-roles";
import { PositionRequestDialog } from "./position-request-dialog";
import { POSITION_STATUS_LABELS } from "@/lib/integrations/slot-codes";
import {
  countLabel,
  DATE_KIND_LABELS,
  DELIVERY_LABELS,
  hybridCountLabel,
  scheduleLines,
  type SessionSchedule,
} from "@/lib/sessions/schedule";
import { emptySessionForm, formFromSchedule, type SessionFormValue } from "@/lib/sessions/form";
import { SessionDialog } from "@/components/sessions/session-dialog";
import type { MenteeView } from "@/components/sessions/mentee-editor";

import { deleteSlot, adjustSlotCount, duplicateSlot, reorderSlots } from "./slot-actions";
import { PlanVersionsDialog } from "./plan-versions-dialog";
import {
  SessionNoticeDialog,
  type NoticeTemplateOption,
  type SessionNoticeRow,
} from "./session-notice-dialog";

export type SlotPositionRow = {
  id: string;
  code: string;
  positionNo: number;
  /** 세션 내 섭외 순위 (1=최우선) */
  rank: number;
  /** 후보별 예정가(총액 최소). 없으면 미정 */
  expectedFee: number | null;
  /** 총액 최대 — 회차·병행 범위일 때만 (기획 2026-09-21) */
  expectedFeeMax: number | null;
  /** 회당 단가 (온라인/오프라인) = 시간당 비용 × 회차당 시간 */
  unitFeeOnline: number | null;
  unitFeeOffline: number | null;
  /** 시간당 비용 (온라인/오프라인) — 입력값 (기획 지시 2026-09-21) */
  hourlyFeeOnline: number | null;
  hourlyFeeOffline: number | null;
  /** 일괄 등록 단가에서 개별 수정한 금액 — 코랄 표시 */
  feeCustom: boolean;
  status: string;
  expertName: string | null;
  engagementId: string | null;
  canceledExpertName: string | null;
  /** 이 자리의 직전 결과(거절·만료) — engagementId는 결정 수정·이력용 */
  priorOutcome: {
    engagementId: string;
    expertName: string;
    outcome: "declined" | "expired" | "canceled";
  } | null;
  /** 전문가별 종료 시각 (기획 2026-09-21) — 계약 성립 건에만 의미 */
  completedAt: string | null;
  assignedExpertName: string | null;
};

export type SlotNoticeData = {
  targets: { name: string; code: string }[];
  notices: SessionNoticeRow[];
};

export type SlotRow = {
  id: string;
  slotDate: string;
  fieldId: string | null;
  periodEndDate: string | null;
  startsTime: string | null;
  endsTime: string | null;
  roleType: string;
  sessionName: string | null;
  roleDescription: string | null;
  requiredCount: number;
  feeAmount: number | null;
  locationName: string | null;
  notes: string | null;
  /** 날짜 유형·회차·진행 방식 (기획 2026-09-21) */
  schedule: SessionSchedule;
  /** 세션 일괄 단가 (온라인/오프라인) = 시간당 비용 × 회차당 시간 */
  unitFeeOnline: number | null;
  unitFeeOffline: number | null;
  /** 세션 일괄 시간당 비용 (입력값, 기획 지시 2026-09-21) */
  hourlyFeeOnline: number | null;
  hourlyFeeOffline: number | null;
  mentees: MenteeView[];
  positions: SlotPositionRow[];
  notice: SlotNoticeData;
  /** 세션별 종료 시각 (기획 2026-09-21) */
  completedAt: string | null;
};

/** 세션 한 줄 요약 — 세션 목록·섭외후보·안내문자 라벨 공용 */
export function slotHeadline(s: SlotRow): string {
  return `${scheduleLines(s.schedule).join(", ")}${s.sessionName ? ` · ${s.sessionName}` : ""}`;
}

/**
 * 세션 · 전문가 코드넘버 (세션 확인 탭). 세션을 만들면 필요인원 3배수의 코드넘버가
 * 자동 부여된다. 추가·수정은 캘린더와 같은 팝업(SessionDialog)을 쓴다 (기획 2026-09-21).
 */
export function SlotTable({
  projectId,
  tenantSlug,
  slots,
  canManage,
  canNotice,
  expertsLite = false,
  expertsEnabled = true,
  noticeTemplates,
  defaultNoticeBody,
  fieldOptions = [],
}: {
  projectId: string;
  tenantSlug: string;
  slots: SlotRow[];
  canManage: boolean;
  fieldOptions?: { id: string; name: string }[];
  canNotice: boolean;
  expertsLite?: boolean;
  expertsEnabled?: boolean;
  noticeTemplates: NoticeTemplateOption[];
  defaultNoticeBody: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    | { mode: "create"; initial: SessionFormValue }
    | { mode: "edit"; slot: SlotRow; initial: SessionFormValue }
    | null
  >(null);
  // 세션 순서 (드래그·▲▼ — 기획 2026-08-30). 서버 목록이 바뀌면 재동기화
  const [order, setOrder] = useState<string[]>(slots.map((s) => s.id));
  const [dragId, setDragId] = useState<string | null>(null);
  useEffect(() => {
    const ids = slots.map((s) => s.id);
    setOrder((prev) => (prev.length === ids.length && prev.every((id) => ids.includes(id)) ? prev : ids));
  }, [slots]);
  const slotsById = new Map(slots.map((s) => [s.id, s]));
  const orderedSlots = order.map((id) => slotsById.get(id)).filter((s): s is SlotRow => Boolean(s));

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  const commitOrder = (next: string[]) => {
    setOrder(next);
    setError(null);
    startTransition(async () => {
      const r = await reorderSlots(projectId, next);
      if (!r.ok) {
        setError(r.error);
        setOrder(slots.map((slot) => slot.id));
      }
      router.refresh();
    });
  };
  const moveSlotBy = (id: string, delta: number) => {
    const idx = order.indexOf(id);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(idx, 1);
    next.splice(to, 0, id);
    commitOrder(next);
  };
  const onSlotDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = order.filter((id) => id !== dragId);
    next.splice(next.indexOf(targetId) + (order.indexOf(dragId) < order.indexOf(targetId) ? 1 : 0), 0, dragId);
    setDragId(null);
    commitOrder(next);
  };

  function openEdit(s: SlotRow) {
    setEditor({
      mode: "edit",
      slot: s,
      initial: formFromSchedule(s.schedule, {
        sessionName: s.sessionName,
        roleType: s.roleType,
        roleDescription: s.roleDescription,
        requiredCount: s.requiredCount,
        locationName: s.locationName,
        notes: s.notes,
        fieldId: s.fieldId,
      }),
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {slots.length === 0 && (
        <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
          아직 세션이 없습니다. 세션을 추가하면 필요 인원의 3배수만큼 코드넘버(후보 TO)가 자동 부여됩니다.
        </p>
      )}

      {orderedSlots.map((s, slotIdx) => {
        const filled = s.positions.filter((p) => p.status === "filled").length;
        const requested = s.positions.filter((p) => p.status === "requested").length;
        const lines = scheduleLines(s.schedule);
        const count = hybridCountLabel(s.schedule) ?? countLabel(s.schedule);
        return (
          <div key={s.id} className="rounded-lg border p-3" onDragOver={(e) => e.preventDefault()} onDrop={() => onSlotDrop(s.id)}>
            <div className="flex flex-wrap items-center gap-2">
              {canManage && (
                <span className="inline-flex items-center gap-0.5">
                  <span
                    draggable={!pending}
                    onDragStart={() => setDragId(s.id)}
                    onDragEnd={() => setDragId(null)}
                    className="cursor-grab"
                    aria-label="세션 순서 드래그"
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground/60" aria-hidden />
                  </span>
                  <button type="button" aria-label="세션 위로" disabled={pending || slotIdx === 0} onClick={() => moveSlotBy(s.id, -1)} className="rounded p-0.5 text-muted-foreground hover:text-brand disabled:opacity-30">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label="세션 아래로" disabled={pending || slotIdx === orderedSlots.length - 1} onClick={() => moveSlotBy(s.id, 1)} className="rounded p-0.5 text-muted-foreground hover:text-brand disabled:opacity-30">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
              <span className="text-sm font-semibold">{lines[0]}</span>
              {lines.length > 1 && (
                <span className="text-xs text-muted-foreground" title={lines.join("\n")}>
                  외 {lines.length - 1}일
                </span>
              )}
              <Badge variant="outline" className="text-[10px]">
                {DATE_KIND_LABELS[s.schedule.dateKind]}
                {count ? ` · ${count}` : ""}
              </Badge>
              {s.schedule.deliveryMode && (
                <Badge variant="outline" className="text-[10px]">
                  {DELIVERY_LABELS[s.schedule.deliveryMode]}
                </Badge>
              )}
              {s.sessionName && <span className="text-sm font-medium text-brand-navy">{s.sessionName}</span>}
              <Badge variant="secondary">
                {ENGAGEMENT_ROLE_TYPES[s.roleType as keyof typeof ENGAGEMENT_ROLE_TYPES] ?? s.roleType}
              </Badge>
              {s.roleDescription && <span className="text-xs text-muted-foreground">{s.roleDescription}</span>}
              {s.locationName && <span className="text-xs text-muted-foreground">· {s.locationName}</span>}
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> {filled}/{s.requiredCount} 확정
                {requested > 0 && ` · ${requested} 요청중`}
                {" · 후보 TO "}
                {s.positions.filter((p) => p.status !== "canceled").length}
              </span>
              <span className="ml-auto flex items-center gap-1">
                {expertsEnabled && (
                  <Link
                    href={`/${tenantSlug}/projects/${projectId}?tab=experts#slot-${s.id}`}
                    className="inline-flex items-center gap-0.5 rounded border border-brand/40 px-1.5 py-0.5 text-[11px] font-semibold text-brand hover:bg-brand/10"
                  >
                    섭외계획
                  </Link>
                )}
                {canNotice && !expertsLite && (
                  <SessionNoticeDialog
                    slotId={s.id}
                    slotLabel={slotHeadline(s)}
                    templates={noticeTemplates}
                    defaultBody={defaultNoticeBody}
                    targets={s.notice.targets}
                    notices={s.notice.notices}
                  />
                )}
                {canManage && (
                  <>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      defaultValue={s.requiredCount}
                      className="h-7 w-16 text-xs"
                      onBlur={(e) => {
                        const next = parseInt(e.target.value, 10);
                        if (next && next !== s.requiredCount) run(() => adjustSlotCount(s.id, next));
                      }}
                    />
                    <button type="button" aria-label="세션 복사" title="이 세션의 구성(일정·역할·장소)을 복제합니다" disabled={pending} onClick={() => run(() => duplicateSlot(s.id))} className="rounded p-1 text-muted-foreground hover:text-brand">
                      <Copy className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="세션 수정" disabled={pending} onClick={() => openEdit(s)} className="rounded p-1 text-muted-foreground hover:text-brand">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="세션 삭제"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`이 세션을 삭제할까요?\n${slotHeadline(s)} — 코드넘버 ${s.positions.length}자리가 함께 삭제됩니다.`)) {
                          run(() => deleteSlot(s.id));
                        }
                      }}
                      className="rounded p-1 text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </span>
            </div>

            {lines.length > 1 && (
              <p className="mt-1 pl-1 text-xs text-muted-foreground">{lines.join(" · ")}</p>
            )}
            {s.notes && (
              <p className="mt-1 pl-1 text-xs text-muted-foreground" title="비고">
                비고: {s.notes}
              </p>
            )}
            {s.mentees.length > 0 && (
              <p className="mt-1 pl-1 text-xs text-muted-foreground">
                멘티 {s.mentees.length}명: {s.mentees.map((m) => m.name).join(", ")}
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.positions.map((p) =>
                (p.status === "open" || p.status === "assigned") && canManage ? (
                  <PositionRequestDialog key={p.id} positionId={p.id} code={p.code} currentExpertName={p.assignedExpertName} variant="chip" />
                ) : (
                  <a
                    key={p.id}
                    href={`/${tenantSlug}/projects/${projectId}/positions/${p.id}`}
                    className={
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:border-brand " +
                      (p.status === "filled"
                        ? "border-green-300 bg-green-50 text-green-800"
                        : p.status === "requested"
                          ? "border-amber-300 bg-amber-50 text-amber-800"
                          : "bg-background text-muted-foreground")
                    }
                  >
                    <span className="font-mono font-semibold">{p.code}</span>
                    <span>{p.expertName ?? (POSITION_STATUS_LABELS[p.status] ?? p.status)}</span>
                  </a>
                )
              )}
            </div>
          </div>
        );
      })}

      {canManage && (
        <div className="flex items-center gap-2">
          {/* 세션 추가 — 코랄 강조 (기획 지시 2026-09-21). 캘린더와 같은 팝업 */}
          <Button size="sm" className="bg-coral text-white hover:bg-coral-dark" onClick={() => setEditor({ mode: "create", initial: emptySessionForm() })}>
            <Plus className="mr-1 h-4 w-4" /> 세션 추가
          </Button>
          <PlanVersionsDialog projectId={projectId} />
        </div>
      )}

      <SessionDialog
        open={editor !== null}
        onOpenChange={(v) => !v && setEditor(null)}
        mode={editor?.mode ?? "create"}
        slotId={editor?.mode === "edit" ? editor.slot.id : undefined}
        initial={editor?.initial ?? emptySessionForm()}
        projectId={projectId}
        tenantSlug={tenantSlug}
        expertsEnabled={expertsEnabled}
        fieldOptions={fieldOptions}
        mentees={editor?.mode === "edit" ? editor.slot.mentees : []}
      />
    </div>
  );
}

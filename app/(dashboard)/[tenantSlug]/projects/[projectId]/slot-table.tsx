"use client";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ENGAGEMENT_ROLE_TYPES } from "@/lib/integrations/engagement-roles";
import { PositionRequestDialog } from "./position-request-dialog";
import { POSITION_STATUS_LABELS } from "@/lib/integrations/slot-codes";

import {
  createSlot,
  deleteSlot,
  adjustSlotCount,
  updateSlot,
  duplicateSlot,
  reorderSlots,
} from "./slot-actions";
import { Time24Input } from "@/components/ui/datetime24";
import { durationLabel } from "@/lib/integrations/time-duration";
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
  /** 후보별 예정가 (없으면 미정) */
  expectedFee: number | null;
  status: string;
  expertName: string | null;
  /** 확정 건의 수락서로 바로 가기 위한 섭외 건 id */
  engagementId: string | null;
  /** 긴급 취소로 다시 비게 된 자리라면 취소한 전문가 이름 */
  canceledExpertName: string | null;
  /** 임의 배정된 전문가 이름 (요청 전 내부 결정) */
  assignedExpertName: string | null;
};

export type SlotNoticeData = {
  targets: { name: string; code: string }[];
  notices: SessionNoticeRow[];
};

export type SlotRow = {
  id: string;
  slotDate: string;
  startsTime: string | null;
  endsTime: string | null;
  roleType: string;
  sessionName: string | null;
  roleDescription: string | null;
  requiredCount: number;
  feeAmount: number | null;
  locationName: string | null;
  notes: string | null;
  positions: SlotPositionRow[];
  /** 세션 안내문자 — 확정 전문가 대상·발송 내역 */
  notice: SlotNoticeData;
};

const emptyDraft = {
  slotDate: "",
  startsTime: "",
  endsTime: "",
  roleType: "mentor",
  sessionName: "",
  roleDescription: "",
  requiredCount: "1",
  feeAmount: "",
  locationName: "",
  locationAddress: "",
  notes: "",
};

/**
 * 섭외 테이블(날짜별 타임테이블) — 슬롯별 역할·필요인원·비용 관리.
 * 슬롯을 만들면 필요인원 수만큼 넘버링코드가 자동 부여된다.
 */
export function SlotTable({
  projectId,
  tenantSlug,
  slots,
  canManage,
  canNotice,
  expertsLite = false,
  noticeTemplates,
  defaultNoticeBody,
}: {
  projectId: string;
  tenantSlug: string;
  slots: SlotRow[];
  canManage: boolean;
  /** 세션 안내문자 발송 — 레벨 4부터 (입력 권한과 별개 축) */
  canNotice: boolean;
  /** 라이트 모드 — 안내문자 버튼을 숨긴다 (검수 A6: 눌러야 거부되는 막다른 버튼 금지) */
  expertsLite?: boolean;
  noticeTemplates: NoticeTemplateOption[];
  defaultNoticeBody: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [d, setD] = useState({ ...emptyDraft });
  // 다중 일정 세트 (기획 확정 2026-08-23) — 첫 세트는 d, 추가 세트는 여기
  const [extraSchedules, setExtraSchedules] = useState<
    { slotDate: string; startsTime: string; endsTime: string }[]
  >([]);
  // 세션 수정 모드 — 같은 폼을 재사용한다 (일정은 단일 세트)
  const [editingId, setEditingId] = useState<string | null>(null);
  // 세션 순서 (드래그·▲▼ — 기획 2026-08-30). 서버 목록이 바뀌면 재동기화
  const [order, setOrder] = useState<string[]>(slots.map((s) => s.id));
  const [dragId, setDragId] = useState<string | null>(null);
  useEffect(() => {
    const ids = slots.map((s) => s.id);
    setOrder((prev) =>
      prev.length === ids.length && prev.every((id) => ids.includes(id))
        ? prev
        : ids
    );
  }, [slots]);
  const slotsById = new Map(slots.map((s) => [s.id, s]));
  const orderedSlots = order
    .map((id) => slotsById.get(id))
    .filter((s): s is SlotRow => Boolean(s));


  const set = (k: keyof typeof emptyDraft, v: string) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const resetForm = () => {
    setAdding(false);
    setEditingId(null);
    setD({ ...emptyDraft });
    setExtraSchedules([]);
  };

  const onCreate = () => {
    setError(null);
    // 필수값 선검증 — 다중 일정 세트 생성 도중 서버 거부를 받으면 일부만
    // 만들어진 채 멈춘다 (리뷰 A-4)
    if (!d.sessionName.trim() || !d.locationName.trim()) {
      setError("세션명과 장소는 필수입니다 (③ 세션 정보).");
      return;
    }
    startTransition(async () => {
      if (editingId) {
        const r = await updateSlot(editingId, {
          slotDate: d.slotDate,
          startsTime: d.startsTime,
          endsTime: d.endsTime,
          roleType: d.roleType as "mentor",
          sessionName: d.sessionName,
          roleDescription: d.roleDescription,
          feeAmount: d.feeAmount,
          locationName: d.locationName,
          locationAddress: d.locationAddress,
          notes: d.notes,
        });
        if (!r.ok) setError(r.error);
        else {
          resetForm();
          router.refresh();
        }
        return;
      }
      // 일정 세트마다 세션 1개 — 공통 정보(역할·인원·세션명·장소)를 공유한다
      const schedules = [
        { slotDate: d.slotDate, startsTime: d.startsTime, endsTime: d.endsTime },
        ...extraSchedules.filter((sc) => sc.slotDate),
      ];
      for (let i = 0; i < schedules.length; i++) {
        const sc = schedules[i]!;
        const r = await createSlot(projectId, {
          slotDate: sc.slotDate,
          startsTime: sc.startsTime,
          endsTime: sc.endsTime,
          roleType: d.roleType as "mentor",
          sessionName: d.sessionName,
          roleDescription: d.roleDescription,
          requiredCount: parseInt(d.requiredCount || "1", 10),
          feeAmount: d.feeAmount,
          locationName: d.locationName,
          locationAddress: d.locationAddress,
          notes: d.notes,
        });
        if (!r.ok) {
          // 이미 만들어진 세트는 폼에서 제거 — 재시도 시 중복 생성을 막는다
          const remaining = schedules.slice(i);
          const head = remaining[0]!;
          setD((prev) => ({
            ...prev,
            slotDate: head.slotDate,
            startsTime: head.startsTime,
            endsTime: head.endsTime,
          }));
          setExtraSchedules(remaining.slice(1));
          setError(`${sc.slotDate}: ${r.error}`);
          router.refresh();
          return;
        }
      }
      resetForm();
      router.refresh();
    });
  };

  const startEdit = (s: SlotRow) => {
    setEditingId(s.id);
    setAdding(true);
    setExtraSchedules([]);
    setD({
      ...emptyDraft,
      slotDate: s.slotDate,
      startsTime: s.startsTime ? s.startsTime.slice(0, 5) : "",
      endsTime: s.endsTime ? s.endsTime.slice(0, 5) : "",
      roleType: s.roleType,
      sessionName: s.sessionName ?? "",
      roleDescription: s.roleDescription ?? "",
      requiredCount: String(s.requiredCount),
      locationName: s.locationName ?? "",
      notes: s.notes ?? "",
    });
  };

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
        // 실패한 낙관적 순서가 화면에 눌러앉지 않게 서버 순서로 복원 (리뷰 3)
        setOrder(slots.map((slot) => slot.id));
      }
      router.refresh();
    });
  };
  // 위/아래 이동 — 드래그는 터치 기기에서 동작하지 않는다 (검수 G2 · §10)
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

  const timeLabel = (s: SlotRow) =>
    s.startsTime && s.endsTime
      ? `${s.startsTime.slice(0, 5)}~${s.endsTime.slice(0, 5)}`
      : s.startsTime
        ? s.startsTime.slice(0, 5)
        : "시간 미정";

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {slots.length === 0 && !adding && (
        <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
          아직 세션이 없습니다. 날짜·시간대별로 필요한 역할과 인원을 추가하면
          인원마다 코드넘버가 자동 부여됩니다.
        </p>
      )}

      {orderedSlots.map((s, slotIdx) => {
        const filled = s.positions.filter((p) => p.status === "filled").length;
        const requested = s.positions.filter((p) => p.status === "requested").length;
        return (
          <div
            key={s.id}
            className="rounded-lg border p-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onSlotDrop(s.id)}
          >
            <div className="flex flex-wrap items-center gap-2">
              {canManage && (
                <span className="inline-flex items-center gap-0.5">
                  {/* 드래그는 손잡이에서만 — 카드 안 입력·텍스트 선택과 충돌 방지 (리뷰 10) */}
                  <span
                    draggable={!pending}
                    onDragStart={() => setDragId(s.id)}
                    onDragEnd={() => setDragId(null)}
                    className="cursor-grab"
                    aria-label="세션 순서 드래그"
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground/60" aria-hidden />
                  </span>
                  <button
                    type="button"
                    aria-label="세션 위로"
                    disabled={pending || slotIdx === 0}
                    onClick={() => moveSlotBy(s.id, -1)}
                    className="rounded p-0.5 text-muted-foreground hover:text-brand disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="세션 아래로"
                    disabled={pending || slotIdx === orderedSlots.length - 1}
                    onClick={() => moveSlotBy(s.id, 1)}
                    className="rounded p-0.5 text-muted-foreground hover:text-brand disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
              <span className="text-sm font-semibold">{s.slotDate}</span>
              <span className="text-sm text-muted-foreground">
                {timeLabel(s)}
                {durationLabel(s.startsTime, s.endsTime)
                  ? ` (${durationLabel(s.startsTime, s.endsTime)})`
                  : ""}
              </span>
              {s.sessionName && (
                <span className="text-sm font-medium text-brand-navy">
                  {s.sessionName}
                </span>
              )}
              <Badge variant="secondary">
                {ENGAGEMENT_ROLE_TYPES[
                  s.roleType as keyof typeof ENGAGEMENT_ROLE_TYPES
                ] ?? s.roleType}
              </Badge>
              {s.roleDescription && (
                <span className="text-xs text-muted-foreground">{s.roleDescription}</span>
              )}
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> {filled}/{s.requiredCount} 확정
                {requested > 0 && ` · ${requested} 요청중`}
                {" · 후보 TO "}
                {s.positions.filter((p) => p.status !== "canceled").length}
              </span>
              {/* 비용은 세션이 아니라 후보별 예정가로 관리한다 (개정 2026-08-22) */}
              <span className="ml-auto flex items-center gap-1">
                {canNotice && !expertsLite && (
                  <SessionNoticeDialog
                    slotId={s.id}
                    slotLabel={`${s.slotDate} ${timeLabel(s)}${
                      s.sessionName ? ` · ${s.sessionName}` : ""
                    }`}
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
                        if (next && next !== s.requiredCount) {
                          run(() => adjustSlotCount(s.id, next));
                        }
                      }}
                    />
                    <button
                      type="button"
                      aria-label="세션 복사"
                      title="이 세션의 구성(날짜·시간·역할·장소)을 복제합니다"
                      disabled={pending}
                      onClick={() => run(() => duplicateSlot(s.id))}
                      className="rounded p-1 text-muted-foreground hover:text-brand"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="세션 수정"
                      disabled={pending}
                      onClick={() => startEdit(s)}
                      className="rounded p-1 text-muted-foreground hover:text-brand"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="세션 삭제"
                      disabled={pending}
                      onClick={() => {
                        // 배정·예정가까지 입력한 세션이 오클릭 한 번에 사라지면
                        // 안 된다 (§14-3 위험 작업 2단계 확인 — 검수 B10)
                        if (
                          window.confirm(
                            `이 세션을 삭제할까요?\n${s.slotDate}${
                              s.sessionName ? ` · ${s.sessionName}` : ""
                            } — 코드넘버 ${s.positions.length}자리가 함께 삭제됩니다.`
                          )
                        ) {
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

            {s.notes && (
              <p className="mt-1 pl-1 text-xs text-muted-foreground" title="비고">
                비고: {s.notes}
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.positions.map((p) =>
                // 미섭외 자리는 그 자리에서 바로 섭외를 시작한다 — '전문가 등록'
                // 탭의 버튼과 같은 팝업이다. 같은 일에 두 가지 경로를 두면
                // 어느 쪽이 진짜인지 헷갈린다.
                (p.status === "open" || p.status === "assigned") && canManage ? (
                  <PositionRequestDialog
                    key={p.id}
                    positionId={p.id}
                    code={p.code}
                    currentExpertName={p.assignedExpertName}
                    variant="chip"
                  />
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
                    <span>
                      {p.expertName ??
                        (POSITION_STATUS_LABELS[p.status] ?? p.status)}
                    </span>
                  </a>
                )
              )}
            </div>
          </div>
        );
      })}

      {canManage && !adding && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="bg-violet-600 text-white hover:bg-violet-700"
            onClick={() => setAdding(true)}
          >
            <Plus className="mr-1 h-4 w-4" /> 세션 추가
          </Button>
          <PlanVersionsDialog projectId={projectId} />
        </div>
      )}

      {/* 세션 추가 영역 — 전용 색 구획 (기획 확정 2026-08-22): 세션 탭 색(보라)과
          맞추고, 일정/역할·인원/정보 묶음으로 나눠 가독성을 높인다 */}
      {adding && (
        <div className="overflow-hidden rounded-lg border-2 border-violet-300 bg-violet-50/60 shadow-sm">
          <div className="flex items-center gap-2 bg-violet-600 px-3 py-2 text-sm font-semibold text-white">
            {editingId ? (
              <Pencil className="h-4 w-4" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            {editingId ? "세션 수정" : "새 세션 추가"}
          </div>
          <div className="space-y-3 p-3">
            <div className="rounded-md border border-violet-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-violet-800">
                ① 일정 (24시간제)
              </p>
              <div className="space-y-2">
                {/* 첫 세트 = d, 추가 세트 = extraSchedules (기획 확정 2026-08-23) */}
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-violet-900">
                      날짜 (필수)
                    </label>
                    <Input
                      type="date"
                      value={d.slotDate}
                      onChange={(e) => set("slotDate", e.target.value)}
                      className="w-40"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-violet-900">
                      시작
                    </label>
                    <Time24Input
                      value={d.startsTime}
                      onChange={(v) => set("startsTime", v)}
                      ariaLabel="시작"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-violet-900">
                      종료
                    </label>
                    <Time24Input
                      value={d.endsTime}
                      onChange={(v) => set("endsTime", v)}
                      ariaLabel="종료"
                    />
                  </div>
                  <span className="pb-2 text-xs font-semibold text-violet-700">
                    {durationLabel(d.startsTime, d.endsTime) ?? ""}
                  </span>
                </div>
                {!editingId &&
                  extraSchedules.map((sc, i) => (
                    <div key={i} className="flex flex-wrap items-end gap-2">
                      <Input
                        type="date"
                        value={sc.slotDate}
                        onChange={(e) =>
                          setExtraSchedules((prev) =>
                            prev.map((v, j) =>
                              j === i ? { ...v, slotDate: e.target.value } : v
                            )
                          )
                        }
                        className="w-40"
                      />
                      <Time24Input
                        value={sc.startsTime}
                        onChange={(v) =>
                          setExtraSchedules((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, startsTime: v } : x
                            )
                          )
                        }
                        ariaLabel={`추가 일정 ${i + 1} 시작`}
                      />
                      <Time24Input
                        value={sc.endsTime}
                        onChange={(v) =>
                          setExtraSchedules((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, endsTime: v } : x
                            )
                          )
                        }
                        ariaLabel={`추가 일정 ${i + 1} 종료`}
                      />
                      <span className="pb-2 text-xs font-semibold text-violet-700">
                        {durationLabel(sc.startsTime, sc.endsTime) ?? ""}
                      </span>
                      <button
                        type="button"
                        aria-label="일정 세트 제거"
                        onClick={() =>
                          setExtraSchedules((prev) =>
                            prev.filter((_, j) => j !== i)
                          )
                        }
                        className="mb-2 rounded p-1 text-muted-foreground hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                {!editingId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-violet-300 text-violet-700"
                    onClick={() =>
                      setExtraSchedules((prev) => [
                        ...prev,
                        { slotDate: "", startsTime: "", endsTime: "" },
                      ])
                    }
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> 일정 추가
                  </Button>
                )}
                {!editingId && extraSchedules.length > 0 && (
                  <p className="text-[11px] text-violet-800">
                    일정 세트마다 세션이 하나씩 만들어집니다 — 역할·인원·세션
                    정보는 공통 적용됩니다.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-md border border-violet-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-violet-800">
                ② 역할 · 인원
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] font-medium text-violet-900">역할</label>
                  <Select value={d.roleType} onValueChange={(v) => set("roleType", v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ENGAGEMENT_ROLE_TYPES).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-violet-900">
                    필요 인원 (실제 섭외할 인원)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={d.requiredCount}
                    onChange={(e) => set("requiredCount", e.target.value)}
                    disabled={Boolean(editingId)}
                  />
                  {editingId && (
                    <p className="mt-1 text-[11px] text-violet-800">
                      인원은 세션 목록의 인원 칸에서 조정합니다 (코드 발급 연동).
                      날짜·역할을 바꿔도 이미 발급된 코드넘버는 유지됩니다 —
                      코드는 결재·문자에 이미 나간 식별자입니다.
                    </p>
                  )}
                </div>
              </div>
              <p className="mt-2 rounded bg-violet-50 p-2 text-[11px] leading-relaxed text-violet-800">
                세션을 추가하면 <b>후보 TO(코드넘버)가 필요인원의 3배수</b>로
                자동 발급됩니다 (예: 필요 2명 → TO 6개). TO는 섭외후보 등록
                탭에서 추가·삭제할 수 있습니다. 비용은 여기서 입력하지 않습니다 —
                <b> 섭외후보 등록 탭에서 후보별 예정가</b>로 작성합니다.
              </p>
            </div>

            <div className="rounded-md border border-violet-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-violet-800">
                ③ 세션 정보 (세션명·장소 필수)
              </p>
              <div className="space-y-2">
                <Input
                  value={d.sessionName}
                  onChange={(e) => set("sessionName", e.target.value)}
                  placeholder="세션명 (필수 — 예: 1일차 오전 강의, 데모데이 심사)"
                />
                <Input
                  value={d.roleDescription}
                  onChange={(e) => set("roleDescription", e.target.value)}
                  placeholder="세부 역할 (예: IR 멘토링)"
                />
                <Input
                  value={d.locationName}
                  onChange={(e) => set("locationName", e.target.value)}
                  placeholder="장소 (필수)"
                />
                <Input
                  value={d.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="비고 (선택 — 내부 메모, 500자 이내)"
                  maxLength={500}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-violet-600 text-white hover:bg-violet-700"
                onClick={onCreate}
                disabled={pending || !d.slotDate}
              >
                {pending
                  ? "저장 중..."
                  : editingId
                    ? "세션 수정 저장"
                    : "세션 추가"}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetForm}>
                취소
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

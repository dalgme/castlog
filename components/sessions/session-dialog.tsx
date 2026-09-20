"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { KoreanDateInput } from "@/components/ui/korean-date-input";
import { Textarea } from "@/components/ui/textarea";
import { Time24Input } from "@/components/ui/datetime24";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ENGAGEMENT_ROLE_TYPES } from "@/lib/integrations/engagement-roles";
import { DATE_KIND_LABELS, DELIVERY_LABELS, type DateKind, type DeliveryMode } from "@/lib/sessions/schedule";
import { emptySessionForm, type SessionFormValue } from "@/lib/sessions/form";
import {
  mergeFieldOptions,
  SessionFieldDialog,
  type SessionFieldOption,
} from "@/components/sessions/session-field-dialog";
import { MenteeEditor, type MenteeDraft, type MenteeView } from "@/components/sessions/mentee-editor";

import {
  createSlot,
  deleteSlot,
  updateSlot,
  type SlotInput,
} from "@/app/(dashboard)/[tenantSlug]/projects/[projectId]/slot-actions";
import { addSlotMentee } from "@/app/(dashboard)/[tenantSlug]/projects/[projectId]/mentee-actions";

/**
 * 세션 추가·수정 팝업 (기획 지시 2026-09-21) — 캘린더·세션 목록이 같은 팝업을 쓴다.
 *
 * 날짜 유형: 연속형(시작일~종료일, 양 끝 시각 선택, 회차 최소~최대) /
 * 개별선택형(날짜 여러 개, 날짜 수 = 회차). 진행 방식: 온라인/오프라인/병행 —
 * 병행이면 "온라인 OO회, 오프라인 OO회"를 따로 적는다(비우면 범위로 계산).
 * 멘티 정보는 여기서도, 섭외후보 등록에서도 넣을 수 있다.
 */
export function SessionDialog({
  open,
  onOpenChange,
  mode,
  slotId,
  initial,
  projectId,
  tenantSlug,
  expertsEnabled,
  fieldOptions,
  mentees = [],
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  slotId?: string;
  initial: SessionFormValue;
  projectId: string;
  tenantSlug: string;
  expertsEnabled: boolean;
  fieldOptions: SessionFieldOption[];
  mentees?: MenteeView[];
  onSaved?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        {open && (
          <SessionForm
            key={`${mode}:${slotId ?? "new"}`}
            mode={mode}
            slotId={slotId}
            initial={initial}
            projectId={projectId}
            tenantSlug={tenantSlug}
            expertsEnabled={expertsEnabled}
            fieldOptions={fieldOptions}
            mentees={mentees}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const inputCls = "h-8 text-sm";

function SessionForm({
  mode,
  slotId,
  initial,
  projectId,
  tenantSlug,
  expertsEnabled,
  fieldOptions,
  mentees,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  slotId?: string;
  initial: SessionFormValue;
  projectId: string;
  tenantSlug: string;
  expertsEnabled: boolean;
  fieldOptions: SessionFieldOption[];
  mentees: MenteeView[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [d, setD] = useState<SessionFormValue>(initial);
  const [menteeDrafts, setMenteeDrafts] = useState<MenteeDraft[]>([]);
  const [addedFields, setAddedFields] = useState<SessionFieldOption[]>([]);
  const [hiddenFieldIds, setHiddenFieldIds] = useState<string[]>([]);
  const fields = mergeFieldOptions(fieldOptions, addedFields, hiddenFieldIds);
  const set = <K extends keyof SessionFormValue>(k: K, v: SessionFormValue[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const num = (v: string): number | null => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) ? n : null;
  };

  function toInput(): SlotInput | string {
    if (!d.sessionName.trim()) return "세션명은 필수입니다.";
    if (d.dateKind === "continuous") {
      if (!d.startDate || !d.endDate) return "연속형은 시작일과 종료일이 필요합니다.";
    } else if (d.dates.filter((x) => x.date).length === 0) {
      return "개별선택형은 날짜를 하나 이상 넣으세요.";
    }
    if ((d.deliveryMode === "offline" || d.deliveryMode === "hybrid") && !d.locationName.trim()) {
      return "오프라인·병행 세션은 장소를 입력하세요.";
    }
    const dates = d.dates.filter((x) => x.date);
    return {
      dateKind: d.dateKind,
      slotDate: d.dateKind === "continuous" ? d.startDate : (dates[0]?.date ?? d.startDate),
      startsTime: d.startsTime,
      endsTime: d.endsTime,
      endDate: d.dateKind === "continuous" ? d.endDate : "",
      endStartsTime: d.endStartsTime,
      endEndsTime: d.endEndsTime,
      dates: d.dateKind === "individual" ? dates : [],
      countMin: d.dateKind === "continuous" ? num(d.countMin) : null,
      countMax: d.dateKind === "continuous" ? num(d.countMax) : null,
      onlineCount: d.deliveryMode === "hybrid" ? num(d.onlineCount) : null,
      offlineCount: d.deliveryMode === "hybrid" ? num(d.offlineCount) : null,
      hoursPerSession: (() => {
        const h = parseFloat(d.hoursPerSession);
        return Number.isFinite(h) && h > 0 ? h : null;
      })(),
      deliveryMode: d.deliveryMode || null,
      roleType: d.roleType as SlotInput["roleType"],
      sessionName: d.sessionName.trim(),
      roleDescription: d.roleDescription.trim(),
      requiredCount: Math.max(1, num(d.requiredCount) ?? 1),
      feeAmount: "",
      locationName: d.locationName.trim(),
      locationAddress: "",
      notes: d.notes.trim(),
      fieldId: d.fieldId,
    };
  }

  // 회차당 시간 — 총 회차 아래 (기획 지시 2026-09-21). 총액 = 총회차 × 회차당 시간 × 시간당 비용
  const hoursRow = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="w-12 text-muted-foreground">회차당</span>
      <Input
        type="number"
        min={0.5}
        max={24}
        step={0.5}
        value={d.hoursPerSession}
        onChange={(e) => set("hoursPerSession", e.target.value)}
        placeholder="시간"
        className={cn(inputCls, "w-20")}
        aria-label="회차당 시간"
      />
      <span className="text-muted-foreground">시간</span>
      <span className="text-[11px] text-muted-foreground">섭외후보의 시간당 비용 × 이 시간 = 회차당 단가</span>
    </div>
  );

  function submit() {
    const input = toInput();
    if (typeof input === "string") {
      toast({ variant: "destructive", description: input });
      return;
    }
    startTransition(async () => {
      if (mode === "create") {
        const r = await createSlot(projectId, input);
        if (!r.ok) {
          toast({ variant: "destructive", description: r.error });
          return;
        }
        // 팝업에서 모아 둔 멘티를 새 세션에 붙인다
        for (const m of menteeDrafts) {
          const mr = await addSlotMentee({ slotId: r.id, ...m });
          if (!mr.ok) toast({ variant: "destructive", description: `멘티 저장 실패: ${mr.error}` });
        }
        toast({ description: "세션을 등록했습니다." });
      } else if (slotId) {
        const r = await updateSlot(slotId, input);
        if (!r.ok) {
          toast({ variant: "destructive", description: r.error });
          return;
        }
        toast({ description: "세션을 저장했습니다." });
      }
      onSaved?.();
      onClose();
      router.refresh();
    });
  }

  function remove() {
    if (!slotId) return;
    if (
      !window.confirm(
        "이 세션을 삭제할까요? 코드넘버(TO)·멘티 정보도 함께 사라집니다. 이미 섭외를 요청한 인원이 있으면 삭제되지 않습니다."
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteSlot(slotId);
      if (!r.ok) {
        toast({ variant: "destructive", description: r.error });
        return;
      }
      onSaved?.();
      onClose();
      router.refresh();
    });
  }

  const hybrid = d.deliveryMode === "hybrid";

  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === "edit" ? "세션 수정" : "새 세션 추가"}</DialogTitle>
        <DialogDescription>
          날짜 유형과 진행 방식을 고르면 섭외후보·결재·안내문자에 같은 내용이 실립니다.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        {/* ── 날짜 유형 ───────────────────────────────────────────── */}
        <section className="rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">날짜 유형</span>
            {(Object.keys(DATE_KIND_LABELS) as DateKind[]).map((k) => (
              <label key={k} className="inline-flex cursor-pointer items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="dateKind"
                  checked={d.dateKind === k}
                  onChange={() => set("dateKind", k)}
                />
                {DATE_KIND_LABELS[k]}
              </label>
            ))}
            <span className="text-[11px] text-muted-foreground">
              {d.dateKind === "continuous"
                ? "시작일~종료일 한 덩어리. 시각은 선택, 회차는 최소~최대(확정이면 최소만)"
                : "특정 날짜들을 골라 넣습니다. 날짜 수가 곧 회차입니다"}
            </span>
          </div>

          {d.dateKind === "continuous" ? (
            <div className="space-y-2">
              <DayRow
                label="시작일"
                date={d.startDate}
                starts={d.startsTime}
                ends={d.endsTime}
                onDate={(v) => set("startDate", v)}
                onStarts={(v) => set("startsTime", v)}
                onEnds={(v) => set("endsTime", v)}
              />
              <DayRow
                label="종료일"
                date={d.endDate}
                starts={d.endStartsTime}
                ends={d.endEndsTime}
                onDate={(v) => set("endDate", v)}
                onStarts={(v) => set("endStartsTime", v)}
                onEnds={(v) => set("endEndsTime", v)}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="w-12 text-muted-foreground">회차</span>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={d.countMin}
                  onChange={(e) => set("countMin", e.target.value)}
                  placeholder="최소"
                  className={cn(inputCls, "w-20")}
                  aria-label="최소 회차"
                />
                <span className="text-muted-foreground">~</span>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={d.countMax}
                  onChange={(e) => set("countMax", e.target.value)}
                  placeholder="최대 (선택)"
                  className={cn(inputCls, "w-24")}
                  aria-label="최대 회차"
                />
                <span className="text-[11px] text-muted-foreground">확정 회차면 최소만 적으세요</span>
              </div>
              {hoursRow}
            </div>
          ) : (
            <div className="space-y-1.5">
              {d.dates.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5">
                  <KoreanDateInput
                    value={row.date}
                    onChange={(next) =>
                      set("dates", d.dates.map((x, j) => (j === i ? { ...x, date: next } : x)))
                    }
                    size="sm"
                    className="w-52"
                    ariaLabel={`날짜 ${i + 1}`}
                  />
                  <Time24Input
                    value={row.startsTime}
                    onChange={(v) => set("dates", d.dates.map((x, j) => (j === i ? { ...x, startsTime: v } : x)))}
                    ariaLabel={`날짜 ${i + 1} 시작`}
                  />
                  <span className="text-xs text-muted-foreground">~</span>
                  <Time24Input
                    value={row.endsTime}
                    onChange={(v) => set("dates", d.dates.map((x, j) => (j === i ? { ...x, endsTime: v } : x)))}
                    ariaLabel={`날짜 ${i + 1} 종료`}
                  />
                  <button
                    type="button"
                    aria-label="날짜 제거"
                    disabled={d.dates.length <= 1}
                    onClick={() => set("dates", d.dates.filter((_, j) => j !== i))}
                    className="rounded p-1 text-muted-foreground hover:text-red-600 disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => set("dates", [...d.dates, { date: "", startsTime: "", endsTime: "" }])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> 날짜 추가
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {d.dates.filter((x) => x.date).length}회차
                </span>
              </div>
              {hoursRow}
            </div>
          )}
        </section>

        {/* ── 진행 방식 ───────────────────────────────────────────── */}
        <section className="rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">진행 방식</span>
            {(Object.keys(DELIVERY_LABELS) as DeliveryMode[]).map((k) => (
              <label key={k} className="inline-flex cursor-pointer items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="deliveryMode"
                  checked={d.deliveryMode === k}
                  onChange={() => set("deliveryMode", k)}
                />
                {DELIVERY_LABELS[k]}
              </label>
            ))}
            {hybrid && (
              <span className="ml-1 inline-flex items-center gap-1 text-xs">
                온라인
                <Input
                  type="number"
                  min={0}
                  max={999}
                  value={d.onlineCount}
                  onChange={(e) => set("onlineCount", e.target.value)}
                  className={cn(inputCls, "w-16")}
                  aria-label="온라인 회차"
                />
                회, 오프라인
                <Input
                  type="number"
                  min={0}
                  max={999}
                  value={d.offlineCount}
                  onChange={(e) => set("offlineCount", e.target.value)}
                  className={cn(inputCls, "w-16")}
                  aria-label="오프라인 회차"
                />
                회
              </span>
            )}
          </div>
          {hybrid && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              회차를 나누면 섭외후보 총액이 온라인·오프라인 각각으로 계산됩니다. 비우면 &lsquo;전부 온라인 ~ 전부
              오프라인&rsquo; 범위로 표시됩니다.
            </p>
          )}
        </section>

        {/* ── 세션 정보 ───────────────────────────────────────────── */}
        <section className="space-y-2 rounded-md border p-3">
          <Input
            value={d.sessionName}
            onChange={(e) => set("sessionName", e.target.value)}
            placeholder="세션명 (필수 — 예: 1일차 오전 강의, 데모데이 심사)"
            aria-label="세션명"
            maxLength={120}
          />
          <div className="flex gap-1.5">
            <select
              value={d.roleType}
              onChange={(e) => set("roleType", e.target.value)}
              className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
              aria-label="역할"
            >
              {Object.entries(ENGAGEMENT_ROLE_TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            {mode === "create" ? (
              <Input
                type="number"
                min={1}
                max={100}
                value={d.requiredCount}
                onChange={(e) => set("requiredCount", e.target.value)}
                className="h-9 w-24"
                aria-label="필요 인원"
                placeholder="필요 인원"
              />
            ) : (
              <span className="flex h-9 items-center rounded-md border px-2 text-xs text-muted-foreground">
                필요 {d.requiredCount}명 — 인원 조정은 섭외후보 등록에서
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={d.fieldId}
              onChange={(e) => set("fieldId", e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              aria-label="세션분야"
            >
              <option value="">{fields.length > 0 ? "세션분야 선택 (선택)" : "세션분야 없음 — 오른쪽에서 추가"}</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <SessionFieldDialog
              fields={fields}
              onAdded={(f) => {
                setAddedFields((p) => [...p, f]);
                set("fieldId", f.id);
              }}
              onRemoved={(id) => {
                setHiddenFieldIds((p) => [...p, id]);
                if (d.fieldId === id) set("fieldId", "");
              }}
            />
          </div>
          <Input
            value={d.locationName}
            onChange={(e) => set("locationName", e.target.value)}
            placeholder={d.deliveryMode === "online" ? "장소 (온라인 — 비워도 됨)" : "장소 (오프라인·병행이면 필수)"}
            aria-label="장소"
            maxLength={150}
          />
          <Input
            value={d.roleDescription}
            onChange={(e) => set("roleDescription", e.target.value)}
            placeholder="세부 역할 (선택 — 예: 기조강연, 1:1 멘토링)"
            aria-label="세부 역할"
            maxLength={100}
          />
          <Textarea
            rows={2}
            value={d.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="비고 (선택)"
            aria-label="비고"
            maxLength={500}
          />
        </section>

        {/* ── 멘티 정보 (기획 34번 — 세션 추가에서도 입력) ─────────────── */}
        <MenteeEditor
          slotId={mode === "edit" ? slotId : undefined}
          mentees={mentees}
          drafts={menteeDrafts}
          onDraftsChange={setMenteeDrafts}
          canManage
          compact
        />

        {mode === "edit" && expertsEnabled && slotId && (
          <Link
            href={`/${tenantSlug}/projects/${projectId}?tab=experts#slot-${slotId}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand underline-offset-4 hover:underline"
          >
            <UserSearch className="h-3.5 w-3.5" aria-hidden />
            이 세션의 섭외계획으로 이동
          </Link>
        )}

        <div className="flex gap-2 pt-1">
          {mode === "edit" && (
            <Button variant="destructive" size="sm" disabled={pending} onClick={remove}>
              삭제
            </Button>
          )}
          <Button variant="outline" size="sm" className="ml-auto" disabled={pending} onClick={onClose}>
            취소
          </Button>
          <Button size="sm" className="bg-coral text-white hover:bg-coral-dark" disabled={pending} onClick={submit}>
            {pending ? "저장 중…" : mode === "edit" ? "저장" : "세션 등록"}
          </Button>
        </div>
      </div>
    </>
  );
}

function DayRow({
  label,
  date,
  starts,
  ends,
  onDate,
  onStarts,
  onEnds,
}: {
  label: string;
  date: string;
  starts: string;
  ends: string;
  onDate: (v: string) => void;
  onStarts: (v: string) => void;
  onEnds: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="w-12 text-muted-foreground">{label}</span>
      <KoreanDateInput value={date} onChange={onDate} size="sm" className="w-52" ariaLabel={label} />
      <Time24Input value={starts} onChange={onStarts} ariaLabel={`${label} 시작 시각`} />
      <span className="text-muted-foreground">~</span>
      <Time24Input value={ends} onChange={onEnds} ariaLabel={`${label} 종료 시각`} />
      <span className="text-[11px] text-muted-foreground">(시각 선택)</span>
    </div>
  );
}

export { emptySessionForm };

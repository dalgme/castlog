"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Users } from "lucide-react";

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

import { createSlot, deleteSlot, adjustSlotCount } from "./slot-actions";
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
  noticeTemplates,
  defaultNoticeBody,
}: {
  projectId: string;
  tenantSlug: string;
  slots: SlotRow[];
  canManage: boolean;
  /** 세션 안내문자 발송 — 레벨 4부터 (입력 권한과 별개 축) */
  canNotice: boolean;
  noticeTemplates: NoticeTemplateOption[];
  defaultNoticeBody: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [d, setD] = useState({ ...emptyDraft });

  const set = (k: keyof typeof emptyDraft, v: string) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const onCreate = () => {
    setError(null);
    startTransition(async () => {
      const r = await createSlot(projectId, {
        slotDate: d.slotDate,
        startsTime: d.startsTime,
        endsTime: d.endsTime,
        roleType: d.roleType as "mentor",
        sessionName: d.sessionName,
        roleDescription: d.roleDescription,
        requiredCount: parseInt(d.requiredCount || "1", 10),
        feeAmount: d.feeAmount,
        locationName: d.locationName,
        locationAddress: d.locationAddress,
        notes: d.notes,
      });
      if (!r.ok) setError(r.error);
      else {
        setAdding(false);
        setD({ ...emptyDraft });
        router.refresh();
      }
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
          아직 섭외 테이블이 없습니다. 날짜·시간대별로 필요한 역할과 인원을 추가하면
          인원마다 넘버링코드가 자동 부여됩니다.
        </p>
      )}

      {slots.map((s) => {
        const filled = s.positions.filter((p) => p.status === "filled").length;
        const requested = s.positions.filter((p) => p.status === "requested").length;
        return (
          <div key={s.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{s.slotDate}</span>
              <span className="text-sm text-muted-foreground">{timeLabel(s)}</span>
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
              </span>
              {/* 비용은 세션이 아니라 후보별 예정가로 관리한다 (개정 2026-08-22) */}
              {canNotice && (
                <span className="ml-auto flex items-center gap-1">
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
                    aria-label="슬롯 삭제"
                    disabled={pending}
                    onClick={() => run(() => deleteSlot(s.id))}
                    className="rounded p-1 text-muted-foreground hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              )}
            </div>

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
        <Button
          size="sm"
          className="bg-violet-600 text-white hover:bg-violet-700"
          onClick={() => setAdding(true)}
        >
          <Plus className="mr-1 h-4 w-4" /> 세션 추가
        </Button>
      )}

      {/* 세션 추가 영역 — 전용 색 구획 (기획 확정 2026-08-22): 세션 탭 색(보라)과
          맞추고, 일정/역할·인원/정보 묶음으로 나눠 가독성을 높인다 */}
      {adding && (
        <div className="overflow-hidden rounded-lg border-2 border-violet-300 bg-violet-50/60 shadow-sm">
          <div className="flex items-center gap-2 bg-violet-600 px-3 py-2 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" aria-hidden />
            새 세션 추가
          </div>
          <div className="space-y-3 p-3">
            <div className="rounded-md border border-violet-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-violet-800">① 일정</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label className="text-[11px] font-medium text-violet-900">
                    날짜 (필수)
                  </label>
                  <Input
                    type="date"
                    value={d.slotDate}
                    onChange={(e) => set("slotDate", e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-violet-900">시작</label>
                  <Input
                    type="time"
                    value={d.startsTime}
                    onChange={(e) => set("startsTime", e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-violet-900">종료</label>
                  <Input
                    type="time"
                    value={d.endsTime}
                    onChange={(e) => set("endsTime", e.target.value)}
                  />
                </div>
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
                  />
                </div>
              </div>
              <p className="mt-2 rounded bg-violet-50 p-2 text-[11px] leading-relaxed text-violet-800">
                세션을 추가하면 <b>임시후보 코드 3개</b>가 자동 발급됩니다 (필요
                인원이 3명을 넘으면 그만큼). 비용은 여기서 입력하지 않습니다 —
                <b> 섭외후보 등록 탭에서 후보별 예정가</b>로 작성합니다.
              </p>
            </div>

            <div className="rounded-md border border-violet-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-violet-800">
                ③ 세션 정보 (선택)
              </p>
              <div className="space-y-2">
                <Input
                  value={d.sessionName}
                  onChange={(e) => set("sessionName", e.target.value)}
                  placeholder="세션명 (예: 1일차 오전 강의, 데모데이 심사)"
                />
                <Input
                  value={d.roleDescription}
                  onChange={(e) => set("roleDescription", e.target.value)}
                  placeholder="세부 역할 (예: IR 멘토링)"
                />
                <Input
                  value={d.locationName}
                  onChange={(e) => set("locationName", e.target.value)}
                  placeholder="장소"
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
                {pending ? "생성 중..." : "세션 추가"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                취소
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, Plus, Trash2, UserSearch } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Time24Input } from "@/components/ui/datetime24";
import { ENGAGEMENT_ROLE_TYPES } from "@/lib/integrations/engagement-roles";
import { useToast } from "@/hooks/use-toast";

import { addCalendarDays, removeCalendarDay } from "./calendar-actions";
import { createSlot } from "./slot-actions";

export type CalendarSession = {
  id: string;
  date: string; // YYYY-MM-DD
  startsTime: string | null;
  endsTime: string | null;
  name: string | null;
  roleType: string;
  requiredCount: number;
  locationName: string | null;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

function timeLabel(s: CalendarSession): string {
  if (!s.startsTime) return "시간 미정";
  return `${s.startsTime.slice(0, 5)}${s.endsTime ? `~${s.endsTime.slice(0, 5)}` : ""}`;
}

/**
 * 프로젝트 캘린더 일정표 (기획 확정 2026-08-30 — 29번, 기본설정 탭).
 * - "7월 26일(수)~7월 28일(금)"처럼 기간을 만들면 일자별 열이 자동 생성
 * - "7월 26일, 8월 3일, 8월 8일"처럼 개별 날짜도 추가 가능
 * - 각 일자에 세션(시간구간·세션명)을 등록하면 그대로 '세션 계획 등록'의
 *   세션(engagement_slots)이 된다 — 원본은 하나다
 * - 세션 카드의 '섭외계획' 버튼은 그 세션에 귀속된 정보로 섭외 흐름에 진입
 */
export function ProjectCalendar({
  tenantSlug,
  projectId,
  days,
  sessions,
  canManage,
}: {
  tenantSlug: string;
  projectId: string;
  /** 스캐폴드 일자 (YYYY-MM-DD) — 세션이 있는 날짜는 sessions에서 병합 */
  days: string[];
  sessions: CalendarSession[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [singleDate, setSingleDate] = useState("");

  // 세션 추가 폼 — 열려 있는 날짜 하나만
  const [addingDay, setAddingDay] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    sessionName: "",
    startsTime: "",
    endsTime: "",
    roleType: "lecturer",
    locationName: "",
    requiredCount: "1",
  });

  const allDays = useMemo(() => {
    const set = new Set(days);
    for (const s of sessions) set.add(s.date);
    return Array.from(set).sort();
  }, [days, sessions]);

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, CalendarSession[]>();
    for (const s of sessions) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    for (const list of Array.from(map.values())) {
      list.sort((a, b) => (a.startsTime ?? "99").localeCompare(b.startsTime ?? "99"));
    }
    return map;
  }, [sessions]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "처리에 실패했습니다.");
        toast({ variant: "destructive", description: res.error });
      } else {
        router.refresh();
      }
    });
  }

  function addRange() {
    if (!rangeFrom || !rangeTo) {
      setError("시작일과 종료일을 모두 선택하세요.");
      return;
    }
    run(() => addCalendarDays(projectId, rangeFrom, rangeTo));
  }

  function addSingle() {
    if (!singleDate) {
      setError("추가할 날짜를 선택하세요.");
      return;
    }
    run(async () => {
      const res = await addCalendarDays(projectId, singleDate, singleDate);
      if (res.ok) setSingleDate("");
      return res;
    });
  }

  function openAdd(day: string) {
    setAddingDay(day);
    setDraft({
      sessionName: "",
      startsTime: "",
      endsTime: "",
      roleType: "lecturer",
      locationName: "",
      requiredCount: "1",
    });
  }

  function submitSession(day: string) {
    if (!draft.sessionName.trim() || !draft.locationName.trim()) {
      setError("세션명과 장소는 필수입니다.");
      return;
    }
    const required = parseInt(draft.requiredCount, 10);
    run(async () => {
      const res = await createSlot(projectId, {
        slotDate: day,
        startsTime: draft.startsTime,
        endsTime: draft.endsTime,
        roleType: draft.roleType as keyof typeof ENGAGEMENT_ROLE_TYPES,
        sessionName: draft.sessionName.trim(),
        roleDescription: "",
        requiredCount: Number.isInteger(required) && required >= 1 ? required : 1,
        feeAmount: "",
        locationName: draft.locationName.trim(),
        locationAddress: "",
        notes: "",
      });
      if (res.ok) setAddingDay(null);
      return res;
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {canManage && (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-md border p-3">
          <div className="flex items-end gap-1.5">
            <div>
              <label className="text-[11px] text-muted-foreground">기간 시작</label>
              <Input
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="h-8 w-36"
              />
            </div>
            <span className="pb-2 text-xs text-muted-foreground">~</span>
            <div>
              <label className="text-[11px] text-muted-foreground">기간 종료</label>
              <Input
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="h-8 w-36"
              />
            </div>
            <Button size="sm" className="h-8" onClick={addRange} disabled={pending}>
              <CalendarPlus className="mr-1 h-3.5 w-3.5" aria-hidden />
              기간으로 일자 생성
            </Button>
          </div>
          <div className="flex items-end gap-1.5">
            <div>
              <label className="text-[11px] text-muted-foreground">개별 날짜</label>
              <Input
                type="date"
                value={singleDate}
                onChange={(e) => setSingleDate(e.target.value)}
                className="h-8 w-36"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={addSingle}
              disabled={pending}
            >
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              날짜 추가
            </Button>
          </div>
        </div>
      )}

      {allDays.length === 0 ? (
        <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
          아직 일자가 없습니다. 위에서 기간(예: 7월 26일~7월 28일)으로 만들거나
          개별 날짜를 추가하세요.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-3 pb-1">
            {allDays.map((day) => {
              const daySessions = sessionsByDay.get(day) ?? [];
              return (
                <div
                  key={day}
                  className="w-60 shrink-0 rounded-lg border bg-secondary/20"
                >
                  <div className="flex items-center justify-between border-b bg-secondary/50 px-2.5 py-1.5">
                    <span className="text-xs font-bold">{dayLabel(day)}</span>
                    {canManage && daySessions.length === 0 && (
                      <button
                        type="button"
                        aria-label={`${dayLabel(day)} 삭제`}
                        title="세션이 없는 날짜만 지울 수 있습니다"
                        disabled={pending}
                        onClick={() => run(() => removeCalendarDay(projectId, day))}
                        className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5 p-2">
                    {daySessions.length === 0 && addingDay !== day && (
                      <p className="py-2 text-center text-[11px] text-muted-foreground">
                        세션 없음
                      </p>
                    )}
                    {daySessions.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-md border bg-background p-2 text-xs"
                      >
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="secondary"
                            className="px-1.5 py-0 font-mono text-[10px] tabular-nums"
                          >
                            {timeLabel(s)}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {ENGAGEMENT_ROLE_TYPES[
                              s.roleType as keyof typeof ENGAGEMENT_ROLE_TYPES
                            ] ?? s.roleType}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-semibold" title={s.name ?? ""}>
                          {s.name ?? "(세션명 없음)"}
                        </p>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">
                            필요 {s.requiredCount}명
                            {s.locationName ? ` · ${s.locationName}` : ""}
                          </span>
                          {/* 이 세션에 귀속된 정보 그대로 섭외 흐름으로 (29번) */}
                          <Link
                            href={`/${tenantSlug}/projects/${projectId}?tab=experts#slot-${s.id}`}
                            className="inline-flex items-center gap-0.5 rounded border border-brand/40 px-1.5 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand/10"
                          >
                            <UserSearch className="h-3 w-3" aria-hidden />
                            섭외계획
                          </Link>
                        </div>
                      </div>
                    ))}

                    {canManage &&
                      (addingDay === day ? (
                        <div className="space-y-1.5 rounded-md border border-brand/40 bg-background p-2">
                          <Input
                            value={draft.sessionName}
                            onChange={(e) =>
                              setDraft((p) => ({ ...p, sessionName: e.target.value }))
                            }
                            placeholder="세션명 (필수)"
                            className="h-7 text-xs"
                            maxLength={120}
                          />
                          <div className="flex items-center gap-1">
                            <Time24Input
                              value={draft.startsTime}
                              onChange={(v) =>
                                setDraft((p) => ({ ...p, startsTime: v }))
                              }
                            />
                            <span className="text-[10px] text-muted-foreground">~</span>
                            <Time24Input
                              value={draft.endsTime}
                              onChange={(v) => setDraft((p) => ({ ...p, endsTime: v }))}
                            />
                          </div>
                          <div className="flex gap-1.5">
                            <select
                              value={draft.roleType}
                              onChange={(e) =>
                                setDraft((p) => ({ ...p, roleType: e.target.value }))
                              }
                              className="h-7 flex-1 rounded-md border bg-background px-1.5 text-xs"
                              aria-label="역할"
                            >
                              {Object.entries(ENGAGEMENT_ROLE_TYPES).map(([k, label]) => (
                                <option key={k} value={k}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            <Input
                              type="number"
                              min={1}
                              max={100}
                              value={draft.requiredCount}
                              onChange={(e) =>
                                setDraft((p) => ({ ...p, requiredCount: e.target.value }))
                              }
                              className="h-7 w-14 text-xs"
                              aria-label="필요 인원"
                            />
                          </div>
                          <Input
                            value={draft.locationName}
                            onChange={(e) =>
                              setDraft((p) => ({ ...p, locationName: e.target.value }))
                            }
                            placeholder="장소 (필수)"
                            className="h-7 text-xs"
                            maxLength={150}
                          />
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 flex-1 text-xs"
                              disabled={pending}
                              onClick={() => setAddingDay(null)}
                            >
                              취소
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 flex-1 text-xs"
                              disabled={pending}
                              onClick={() => submitSession(day)}
                            >
                              {pending ? "등록 중…" : "세션 등록"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => openAdd(day)}
                          className="w-full rounded-md border border-dashed py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-brand hover:text-brand"
                        >
                          + 세션 추가
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        여기에서 등록한 세션은 <b>세션 계획 등록</b> 탭에 일자·시작시간 순으로
        그대로 올라갑니다(코드넘버 TO 자동 발급 포함). 세부 항목(역할 설명·주소·
        비고)은 세션 계획 등록에서 이어서 편집하세요.
      </p>
    </div>
  );
}

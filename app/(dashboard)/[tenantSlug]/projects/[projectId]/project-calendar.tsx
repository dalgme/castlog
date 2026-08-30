"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, Plus, Trash2, UserSearch } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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

/** 1시간의 화면 높이(px) — 타임그리드 배치 기준 (31번) */
const HOUR_PX = 44;

function toMin(t: string | null): number | null {
  if (!t || t.length < 5) return null;
  const h = parseInt(t.slice(0, 2), 10);
  const m = parseInt(t.slice(3, 5), 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

type TimedBlock = {
  s: CalendarSession;
  startMin: number;
  endMin: number;
  /** 겹침 배치용 열 번호 — 같은 시간대 세션(분반)은 옆 열로 갈라 그린다 */
  track: number;
  overlapped: boolean;
};

/** 하루치 세션의 타임그리드 배치 — 시작순 그리디 열 배정 (구글 캘린더 방식) */
function layoutTimed(list: CalendarSession[]): {
  blocks: TimedBlock[];
  trackCount: number;
} {
  const timed: TimedBlock[] = list
    .filter((s) => toMin(s.startsTime) !== null)
    .map((s) => {
      const startMin = toMin(s.startsTime)!;
      const endMin = Math.max(toMin(s.endsTime) ?? startMin + 60, startMin + 15);
      return { s, startMin, endMin, track: 0, overlapped: false };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const trackEnds: number[] = [];
  for (const b of timed) {
    let t = trackEnds.findIndex((end) => end <= b.startMin);
    if (t === -1) {
      t = trackEnds.length;
      trackEnds.push(0);
    }
    b.track = t;
    trackEnds[t] = b.endMin;
  }
  for (const b of timed) {
    b.overlapped = timed.some(
      (o) => o !== b && o.startMin < b.endMin && o.endMin > b.startMin
    );
  }
  return { blocks: timed, trackCount: Math.max(trackEnds.length, 1) };
}

function timeLabel(s: CalendarSession): string {
  if (!s.startsTime) {
    // 종료만 있는 엣지 — 있는 정보는 버리지 않는다 (리뷰 P3)
    return s.endsTime ? `~${s.endsTime.slice(0, 5)}` : "시간 미정";
  }
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
  expertsEnabled,
}: {
  tenantSlug: string;
  projectId: string;
  /** 스캐폴드 일자 (YYYY-MM-DD) — 세션이 있는 날짜는 sessions에서 병합 */
  days: string[];
  sessions: CalendarSession[];
  canManage: boolean;
  /** experts 모듈 활성 — 꺼진 테넌트에는 섭외 진입 버튼을 숨긴다 (연동 규칙 1-2-4) */
  expertsEnabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [singleDate, setSingleDate] = useState("");

  // 일자별 상세(확대) 보기 — 헤더 클릭으로 토글 (31번)
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
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

  // 시간축 범위 — 전 일자 공통 (열끼리 같은 눈금이어야 비교가 된다).
  // 기본 09~18시, 세션이 그 밖이면 그만큼 넓힌다.
  const hourWindow = useMemo(() => {
    let min = 9 * 60;
    let max = 18 * 60;
    for (const s of sessions) {
      const st = toMin(s.startsTime);
      if (st === null) continue;
      const en = Math.max(toMin(s.endsTime) ?? st + 60, st + 15);
      min = Math.min(min, st);
      max = Math.max(max, en);
    }
    const startH = Math.floor(min / 60);
    // 23시대 시작 + 종료 미입력(+60분 보정)이 24시를 넘길 수 있다 — 축은 24시 캡
    const endH = Math.min(Math.max(Math.ceil(max / 60), startH + 6), 24);
    return { startH, endH };
  }, [sessions]);
  const hourMarks = useMemo(
    () =>
      Array.from(
        { length: hourWindow.endH - hourWindow.startH + 1 },
        (_, i) => hourWindow.startH + i
      ),
    [hourWindow]
  );
  const gridHeight = (hourWindow.endH - hourWindow.startH) * HOUR_PX;

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
        /* 구글 캘린더식 타임그리드 (기획 개정 2026-08-30 — 31번):
           일자별 열 x 시간축 위에 세션 블록을 시간 구간 비율로 배치한다.
           겹치는 세션(분반 등)은 나란히 갈라 그리고 코랄색으로 표시해
           시간 중복을 상신 전에 눈으로 잡는다. */
        <div className="overflow-x-auto rounded-lg border">
          <div className="flex min-w-max">
            {/* 시간축 — 가로 스크롤에서도 왼쪽에 고정 */}
            <div className="sticky left-0 z-20 w-14 shrink-0 border-r bg-background">
              <div className="h-9 border-b" />
              <div className="h-7 border-b" />
              <div className="relative" style={{ height: gridHeight }}>
                {hourMarks.map((h) => (
                  <span
                    key={h}
                    className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                    style={{ top: (h - hourWindow.startH) * HOUR_PX }}
                  >
                    {String(h).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
            </div>

            {allDays.map((day) => {
              const daySessions = sessionsByDay.get(day) ?? [];
              const { blocks, trackCount } = layoutTimed(daySessions);
              const untimed = daySessions.filter((s) => toMin(s.startsTime) === null);
              const hasOverlap = blocks.some((b) => b.overlapped);
              const expanded = expandedDay === day;
              return (
                <div
                  key={day}
                  className={`shrink-0 border-r transition-[width] ${
                    expanded ? "w-[380px]" : "w-52"
                  }`}
                >
                  {/* 일자 헤더 — 라벨 클릭 = 상세(확대) 토글. 삭제는 별도
                      실제 버튼 (리뷰 P2-1: 버튼 중첩·키보드 접근 불가 해소) */}
                  <div className="flex h-9 items-center gap-1 border-b bg-secondary/50 px-2">
                    <button
                      type="button"
                      onClick={() => setExpandedDay(expanded ? null : day)}
                      aria-expanded={expanded}
                      title={expanded ? "기본 폭으로" : "이 날짜 상세(확대) 보기"}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <span className="text-xs font-bold">{dayLabel(day)}</span>
                      {hasOverlap && (
                        <span className="rounded bg-[#FF6F61] px-1 py-0.5 text-[9px] font-bold text-white">
                          시간 겹침
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {daySessions.length}건
                      </span>
                    </button>
                    {canManage && daySessions.length === 0 && (
                      <button
                        type="button"
                        aria-label={`${dayLabel(day)} 삭제`}
                        title="세션이 없는 날짜만 지울 수 있습니다"
                        disabled={pending}
                        onClick={() => run(() => removeCalendarDay(projectId, day))}
                        className="rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                  </div>

                  {/* 시간 미정 세션 — 종일 띠 (구글 캘린더의 상단 띠와 동일 취지) */}
                  <div className="flex h-7 items-center gap-1 overflow-x-auto border-b bg-secondary/20 px-1.5">
                    {untimed.map((s) => (
                      <span
                        key={s.id}
                        title={`${s.name ?? ""} · 시간 미정 · 필요 ${s.requiredCount}명`}
                        className="max-w-[140px] truncate rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium"
                      >
                        {timeLabel(s) === "시간 미정" ? "" : `${timeLabel(s)} `}
                        {s.name ?? "(세션명 없음)"}
                      </span>
                    ))}
                  </div>

                  {/* 타임그리드 — 최소 높이 블록이 하단을 뚫지 않게 잘라낸다 */}
                  <div className="relative overflow-hidden" style={{ height: gridHeight }}>
                    {hourMarks.map((h) => (
                      <div
                        key={h}
                        className="absolute inset-x-0 border-t border-dashed border-muted"
                        style={{ top: (h - hourWindow.startH) * HOUR_PX }}
                        aria-hidden
                      />
                    ))}
                    {blocks.map((b) => {
                      const top =
                        ((b.startMin - hourWindow.startH * 60) / 60) * HOUR_PX;
                      const height = Math.max(
                        ((b.endMin - b.startMin) / 60) * HOUR_PX,
                        22
                      );
                      // 겹치지 않는 블록은 전폭 — 하루 중 한 쌍만 겹쳐도
                      // 그날 전체가 좁아지던 부작용 방지 (리뷰 P3-1)
                      const width = b.overlapped ? 100 / trackCount : 100;
                      const tall = height >= 52;
                      const info = `${timeLabel(b.s)} · ${b.s.name ?? "(세션명 없음)"} · ${
                        ENGAGEMENT_ROLE_TYPES[
                          b.s.roleType as keyof typeof ENGAGEMENT_ROLE_TYPES
                        ] ?? b.s.roleType
                      } · 필요 ${b.s.requiredCount}명${
                        b.s.locationName ? ` · ${b.s.locationName}` : ""
                      }${b.overlapped ? " · ⚠ 같은 시간대 세션 있음" : ""}`;
                      return (
                        <Link
                          key={b.s.id}
                          href={
                            expertsEnabled
                              ? `/${tenantSlug}/projects/${projectId}?tab=experts#slot-${b.s.id}`
                              : `/${tenantSlug}/projects/${projectId}?tab=sessions`
                          }
                          title={info}
                          className={`absolute overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-[10px] leading-tight shadow-sm transition-colors ${
                            b.overlapped
                              ? "border-[#FF6F61] bg-[#FF6F61]/15 hover:bg-[#FF6F61]/25"
                              : "border-brand bg-brand/10 hover:bg-brand/20"
                          }`}
                          style={{
                            top,
                            height,
                            left: b.overlapped ? `${b.track * width}%` : 0,
                            width: `calc(${width}% - 3px)`,
                          }}
                        >
                          <span className="block truncate font-mono text-[9px] text-muted-foreground">
                            {timeLabel(b.s)}
                          </span>
                          <span
                            className={`block font-semibold ${
                              tall ? "" : "truncate"
                            }`}
                          >
                            {b.s.name ?? "(세션명 없음)"}
                          </span>
                          {tall && (
                            <span className="block truncate text-[9px] text-muted-foreground">
                              {ENGAGEMENT_ROLE_TYPES[
                                b.s.roleType as keyof typeof ENGAGEMENT_ROLE_TYPES
                              ] ?? b.s.roleType}
                              {" · 필요 "}
                              {b.s.requiredCount}명
                              {b.s.locationName ? ` · ${b.s.locationName}` : ""}
                            </span>
                          )}
                          {tall && expertsEnabled && (
                            <span className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] font-semibold text-brand">
                              <UserSearch className="h-2.5 w-2.5" aria-hidden />
                              섭외계획
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>

                  {/* 세션 추가 — 그리드 아래 */}
                  {canManage && (
                    <div className="border-t p-1.5">
                      {addingDay === day ? (
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
                              ariaLabel="시작 시각"
                            />
                            <span className="text-[10px] text-muted-foreground">~</span>
                            <Time24Input
                              value={draft.endsTime}
                              onChange={(v) => setDraft((p) => ({ ...p, endsTime: v }))}
                              ariaLabel="종료 시각"
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
                          className="w-full rounded-md border border-dashed py-1 text-[11px] text-muted-foreground transition-colors hover:border-brand hover:text-brand"
                        >
                          + 세션 추가
                        </button>
                      )}
                    </div>
                  )}
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

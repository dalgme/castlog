"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  UserSearch,
  X,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ENGAGEMENT_ROLE_TYPES } from "@/lib/integrations/engagement-roles";
import { useToast } from "@/hooks/use-toast";
import {
  allDatesOf,
  describeSchedule,
  DELIVERY_LABELS,
  isAllDayBar,
  type SessionSchedule,
} from "@/lib/sessions/schedule";
import { emptySessionForm, formFromSchedule, type SessionFormValue } from "@/lib/sessions/form";
import { SessionDialog } from "@/components/sessions/session-dialog";
import type { MenteeView } from "@/components/sessions/mentee-editor";

import { addCalendarDays, removeCalendarDay } from "./calendar-actions";

export type CalendarSession = {
  id: string;
  schedule: SessionSchedule;
  name: string | null;
  roleType: string;
  requiredCount: number;
  locationName: string | null;
  roleDescription: string | null;
  notes: string | null;
  fieldId: string | null;
  mentees: MenteeView[];
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

/** 오늘(KST) YYYY-MM-DD — 서버·클라이언트 TZ에 흔들리지 않게 고정 */
function kstTodayIso(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 월간 그리드 42칸 — 그 달 1일이 속한 주의 일요일부터 6주 */
function monthCellsOf(month: string): { iso: string; inMonth: boolean }[] {
  const first = new Date(`${month}-01T00:00:00`);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells: { iso: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    cells.push({ iso, inMonth: iso.slice(0, 7) === month });
  }
  return cells;
}

function shiftMonthKey(month: string, delta: number): string {
  const d = new Date(`${month}-01T00:00:00`);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 1시간의 화면 높이(px) — 타임그리드 배치 기준 (31번) */
const HOUR_PX = 44;
/** 일자 열 너비 — 상단 기간 막대의 가로 위치 계산에도 쓴다 */
const DAY_W = 208;
const DAY_W_EXPANDED = 380;
const AXIS_W = 56;

function toMin(t: string | null): number | null {
  if (!t || t.length < 5) return null;
  const h = parseInt(t.slice(0, 2), 10);
  const m = parseInt(t.slice(3, 5), 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minToTime(min: number): string {
  const clamped = Math.max(0, Math.min(min, 23 * 60 + 55));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 하루 열에 그려지는 한 조각 — 개별선택형은 날짜마다, 연속형은 양 끝 날에 */
type Occurrence = {
  s: CalendarSession;
  date: string;
  startsTime: string | null;
  endsTime: string | null;
};

type TimedBlock = {
  o: Occurrence;
  startMin: number;
  endMin: number;
  track: number;
  overlapped: boolean;
};

/** 하루치 조각의 타임그리드 배치 — 시작순 그리디 열 배정 (구글 캘린더 방식) */
function layoutTimed(list: Occurrence[]): { blocks: TimedBlock[]; trackCount: number } {
  const timed: TimedBlock[] = list
    .filter((o) => toMin(o.startsTime) !== null)
    .map((o) => {
      const startMin = toMin(o.startsTime)!;
      const endMin = Math.max(toMin(o.endsTime) ?? startMin + 60, startMin + 15);
      return { o, startMin, endMin, track: 0, overlapped: false };
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
    b.overlapped = timed.some((x) => x !== b && x.startMin < b.endMin && x.endMin > b.startMin);
  }
  return { blocks: timed, trackCount: Math.max(trackEnds.length, 1) };
}

function timeLabel(o: { startsTime: string | null; endsTime: string | null }): string {
  if (!o.startsTime) return o.endsTime ? `~${o.endsTime.slice(0, 5)}` : "시간 미정";
  return `${o.startsTime.slice(0, 5)}${o.endsTime ? `~${o.endsTime.slice(0, 5)}` : ""}`;
}

function occurrencesOf(s: CalendarSession): Occurrence[] {
  const sc = s.schedule;
  if (sc.dateKind === "individual") {
    const list = sc.dates.length > 0 ? sc.dates : [{ date: sc.startDate, startsTime: sc.startsTime, endsTime: sc.endsTime }];
    return list.map((d) => ({ s, date: d.date, startsTime: d.startsTime, endsTime: d.endsTime }));
  }
  // 연속형 — 시각이 있는 날만 그리드에 조각으로. 시각이 없으면 상단 막대만
  const out: Occurrence[] = [];
  if (sc.startsTime) out.push({ s, date: sc.startDate, startsTime: sc.startsTime, endsTime: sc.endsTime });
  if (sc.endDate && sc.endDate !== sc.startDate && sc.endStartsTime) {
    out.push({ s, date: sc.endDate, startsTime: sc.endStartsTime, endsTime: sc.endEndsTime });
  }
  return out;
}

/**
 * 프로젝트 캘린더 일정표 (기획 확정 2026-08-30 — 29번, 개정 2026-09-21).
 * - 일자 열 x 시간축 타임그리드 + 상단 기간 막대(연속형)
 * - 세션은 날짜 유형(연속형/개별선택형)·진행 방식(온/오프/병행)을 갖는다 — 팝업 하나
 * - 여기서 등록한 세션이 그대로 세션 확인·섭외후보·결재의 원본이다
 */
export function ProjectCalendar({
  tenantSlug,
  projectId,
  days,
  sessions,
  canManage,
  expertsEnabled,
  fieldOptions = [],
}: {
  tenantSlug: string;
  projectId: string;
  /** 스캐폴드 일자 (YYYY-MM-DD) — 세션이 있는 날짜는 sessions에서 병합 */
  days: string[];
  sessions: CalendarSession[];
  canManage: boolean;
  expertsEnabled: boolean;
  fieldOptions?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [singleDate, setSingleDate] = useState("");
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // 보기 전환 — 세션 달력(일자 열 × 시간축) / 월 달력(구글 캘린더식) + 기간 설정해서 보기
  // (기획 지시 2026-09-21). 기간은 '보기'만 거른다 — 일자 생성·세션 데이터는 그대로다.
  const todayIso = kstTodayIso();
  const [view, setView] = useState<"grid" | "month">("grid");
  const [viewFrom, setViewFrom] = useState("");
  const [viewTo, setViewTo] = useState("");
  const [month, setMonth] = useState<string | null>(null);

  // 세션 팝업 — 등록(create)/수정(edit)
  const [editor, setEditor] = useState<
    | { mode: "create"; initial: SessionFormValue }
    | { mode: "edit"; session: CalendarSession; initial: SessionFormValue }
    | null
  >(null);

  const occurrences = useMemo(() => sessions.flatMap(occurrencesOf), [sessions]);
  const bars = useMemo(() => sessions.filter((s) => s.schedule.dateKind === "continuous"), [sessions]);

  const allDays = useMemo(() => {
    const set = new Set(days);
    for (const o of occurrences) set.add(o.date);
    for (const b of bars) for (const d of allDatesOf(b.schedule)) set.add(d);
    return Array.from(set).sort();
  }, [days, occurrences, bars]);

  // 기간 설정해서 보기 — 비우면 전체. 시작만 있으면 그날부터, 종료만 있으면 그날까지
  const inViewRange = (d: string) => (!viewFrom || d >= viewFrom) && (!viewTo || d <= viewTo);
  const visibleDays = useMemo(() => allDays.filter(inViewRange), [allDays, viewFrom, viewTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleSet = useMemo(() => new Set(visibleDays), [visibleDays]);

  const byDay = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const o of occurrences) {
      const list = map.get(o.date) ?? [];
      list.push(o);
      map.set(o.date, list);
    }
    for (const list of Array.from(map.values())) {
      list.sort((a, b) => (a.startsTime ?? "99").localeCompare(b.startsTime ?? "99"));
    }
    return map;
  }, [occurrences]);

  // 월 달력 — 처음 열면 오늘 이후 첫 일정이 있는 달, 없으면 마지막 일정의 달, 그도 없으면 이번 달
  const currentMonth = useMemo(() => {
    if (month) return month;
    const upcoming = allDays.find((d) => d >= todayIso) ?? allDays[allDays.length - 1];
    return (upcoming ?? todayIso).slice(0, 7);
  }, [month, allDays, todayIso]);
  const monthCells = useMemo(() => monthCellsOf(currentMonth), [currentMonth]);
  // 월 달력 칸에 그릴 것 — 그날의 조각(개별선택형·시각 있는 연속형 양 끝) + 그날을 덮는 연속형 막대
  const monthItems = (day: string): { key: string; s: CalendarSession; label: string; bar: boolean }[] => {
    const items: { key: string; s: CalendarSession; label: string; bar: boolean }[] = [];
    for (const b of bars) {
      if (!allDatesOf(b.schedule).includes(day)) continue;
      items.push({ key: `bar:${b.id}`, s: b, label: `기간 ${b.name ?? "(세션명 없음)"}`, bar: true });
    }
    for (const o of byDay.get(day) ?? []) {
      if (o.s.schedule.dateKind === "continuous") continue; // 막대로 이미 표시
      items.push({ key: `${o.s.id}:${day}`, s: o.s, label: `${o.startsTime ? `${o.startsTime.slice(0, 5)} ` : ""}${o.s.name ?? "(세션명 없음)"}`, bar: false });
    }
    return items;
  };
  const monthHasItems = monthCells.some((c) => c.inMonth && inViewRange(c.iso) && monthItems(c.iso).length > 0);

  const hourWindow = useMemo(() => {
    let min = 9 * 60;
    let max = 18 * 60;
    for (const o of occurrences) {
      const st = toMin(o.startsTime);
      if (st === null) continue;
      const en = Math.max(toMin(o.endsTime) ?? st + 60, st + 15);
      min = Math.min(min, st);
      max = Math.max(max, en);
    }
    const startH = Math.floor(min / 60);
    const endH = Math.min(Math.max(Math.ceil(max / 60), startH + 6), 24);
    return { startH, endH };
  }, [occurrences]);
  const hourMarks = useMemo(
    () => Array.from({ length: hourWindow.endH - hourWindow.startH + 1 }, (_, i) => hourWindow.startH + i),
    [hourWindow]
  );
  const gridHeight = (hourWindow.endH - hourWindow.startH) * HOUR_PX;

  // 열 위치 — 상단 막대의 가로 배치용 (확대된 열은 넓다)
  const colLeft = useMemo(() => {
    const out: number[] = [];
    let x = 0;
    for (const d of visibleDays) {
      out.push(x);
      x += d === expandedDay ? DAY_W_EXPANDED : DAY_W;
    }
    return { lefts: out, total: x };
  }, [visibleDays, expandedDay]);
  const colWidth = (d: string) => (d === expandedDay ? DAY_W_EXPANDED : DAY_W);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "처리에 실패했습니다.");
        toast({ variant: "destructive", description: res.error });
      } else router.refresh();
    });
  }

  function addRange() {
    if (!rangeFrom || !rangeTo) return setError("시작일과 종료일을 모두 선택하세요.");
    run(() => addCalendarDays(projectId, rangeFrom, rangeTo));
  }
  function addSingle() {
    if (!singleDate) return setError("추가할 날짜를 선택하세요.");
    run(async () => {
      const res = await addCalendarDays(projectId, singleDate, singleDate);
      if (res.ok) setSingleDate("");
      return res;
    });
  }

  function openCreate(day?: string, startsTime = "", endsTime = "") {
    if (!canManage) return;
    setEditor({
      mode: "create",
      initial: emptySessionForm({
        dateKind: "individual",
        startDate: day ?? "",
        dates: [{ date: day ?? "", startsTime, endsTime }],
      }),
    });
  }

  function openEdit(s: CalendarSession) {
    if (!canManage) return;
    setEditor({
      mode: "edit",
      session: s,
      initial: formFromSchedule(s.schedule, {
        sessionName: s.name,
        roleType: s.roleType,
        roleDescription: s.roleDescription,
        requiredCount: s.requiredCount,
        locationName: s.locationName,
        notes: s.notes,
        fieldId: s.fieldId,
      }),
    });
  }

  function onGridClick(day: string, e: React.MouseEvent<HTMLDivElement>) {
    if (!canManage || e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawMin = hourWindow.startH * 60 + ((e.clientY - rect.top) / HOUR_PX) * 60;
    const startMin = Math.floor(rawMin / 30) * 30;
    const endsTime = startMin + 60 > 23 * 60 + 55 ? "" : minToTime(startMin + 60);
    openCreate(day, minToTime(startMin), endsTime);
  }

  const roleLabel = (r: string) => ENGAGEMENT_ROLE_TYPES[r as keyof typeof ENGAGEMENT_ROLE_TYPES] ?? r;

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 보기 전환 + 기간 설정해서 보기 (기획 지시 2026-09-21) — 열람자 누구나 */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-md border bg-secondary/30 p-2.5">
        <div className="inline-flex rounded-md border bg-background p-0.5" role="tablist" aria-label="달력 보기">
          <button
            type="button"
            role="tab"
            aria-selected={view === "grid"}
            onClick={() => setView("grid")}
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold ${
              view === "grid" ? "bg-brand text-white" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            <CalendarRange className="h-3.5 w-3.5" aria-hidden />
            세션 달력
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "month"}
            onClick={() => setView("month")}
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold ${
              view === "month" ? "bg-brand text-white" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            월 달력
          </button>
        </div>
        <div className="flex items-end gap-1.5">
          <div>
            <label className="text-[11px] text-muted-foreground">기간 설정해서 보기 — 시작</label>
            <Input type="date" value={viewFrom} max={viewTo || undefined} onChange={(e) => setViewFrom(e.target.value)} className="h-8 w-36" />
          </div>
          <span className="pb-2 text-xs text-muted-foreground">~</span>
          <div>
            <label className="text-[11px] text-muted-foreground">종료</label>
            <Input type="date" value={viewTo} min={viewFrom || undefined} onChange={(e) => setViewTo(e.target.value)} className="h-8 w-36" />
          </div>
          {(viewFrom || viewTo) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                setViewFrom("");
                setViewTo("");
              }}
            >
              <X className="mr-1 h-3.5 w-3.5" aria-hidden />
              기간 해제
            </Button>
          )}
        </div>
        <span className="pb-1.5 text-[11px] text-muted-foreground">
          {viewFrom || viewTo
            ? `${viewFrom || "처음"} ~ ${viewTo || "끝"} · ${visibleDays.length}일 표시`
            : `전체 ${allDays.length}일`}
        </span>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-md border p-3">
          {/* 세션 추가 — 코랄 강조 (기획 지시 2026-09-21) */}
          <Button size="sm" className="h-8 bg-coral text-white hover:bg-coral-dark" onClick={() => openCreate()} disabled={pending}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            세션 추가
          </Button>
          <div className="flex items-end gap-1.5">
            <div>
              <label className="text-[11px] text-muted-foreground">일자 열 — 기간 시작</label>
              <Input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="h-8 w-36" />
            </div>
            <span className="pb-2 text-xs text-muted-foreground">~</span>
            <div>
              <label className="text-[11px] text-muted-foreground">기간 종료</label>
              <Input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="h-8 w-36" />
            </div>
            <Button size="sm" variant="outline" className="h-8" onClick={addRange} disabled={pending}>
              <CalendarPlus className="mr-1 h-3.5 w-3.5" aria-hidden />
              기간으로 일자 생성
            </Button>
          </div>
          <div className="flex items-end gap-1.5">
            <div>
              <label className="text-[11px] text-muted-foreground">개별 날짜</label>
              <Input type="date" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} className="h-8 w-36" />
            </div>
            <Button size="sm" variant="outline" className="h-8" onClick={addSingle} disabled={pending}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              날짜 추가
            </Button>
          </div>
        </div>
      )}

      {view === "month" && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="이전 달"
              onClick={() => setMonth(shiftMonthKey(currentMonth, -1))}
              className="rounded-md border p-1 hover:bg-secondary"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="다음 달"
              onClick={() => setMonth(shiftMonthKey(currentMonth, 1))}
              className="rounded-md border p-1 hover:bg-secondary"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            <p className="text-sm font-bold">
              {currentMonth.slice(0, 4)}년 {parseInt(currentMonth.slice(5, 7), 10)}월
            </p>
            <button
              type="button"
              onClick={() => setMonth(todayIso.slice(0, 7))}
              className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary"
            >
              오늘
            </button>
            {canManage && (
              <span className="ml-auto text-[11px] text-muted-foreground">날짜 칸의 빈 곳을 클릭하면 그날로 세션을 등록합니다</span>
            )}
          </div>
          {!monthHasItems && (
            <p className="rounded-md bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground">
              이 달에는 표시할 세션이 없습니다{viewFrom || viewTo ? " (설정한 기간 밖의 날짜는 흐리게 보입니다)" : ""}.
            </p>
          )}
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-7 border-b text-center">
                {WEEKDAYS.map((w, i) => (
                  <span
                    key={w}
                    className={`py-1 text-[11px] font-semibold ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-muted-foreground"}`}
                  >
                    {w}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {monthCells.map((cell) => {
                  const items = monthItems(cell.iso);
                  const isToday = cell.iso === todayIso;
                  const outOfRange = !inViewRange(cell.iso);
                  const dimmed = !cell.inMonth || outOfRange;
                  return (
                    <div
                      key={cell.iso}
                      className={`min-h-[96px] border-b border-r p-1 first:border-l ${dimmed ? "bg-secondary/30" : ""} ${
                        isToday ? "bg-brand/[0.05]" : ""
                      } ${canManage && !outOfRange ? "cursor-copy" : ""}`}
                      onClick={(e) => {
                        if (!canManage || outOfRange || e.target !== e.currentTarget) return;
                        openCreate(cell.iso);
                      }}
                      title={canManage && !outOfRange ? `${dayLabel(cell.iso)} — 빈 곳을 클릭하면 세션 등록` : undefined}
                    >
                      <p
                        className={`pointer-events-none mb-0.5 text-[11px] font-semibold ${
                          isToday
                            ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white"
                            : dimmed
                              ? "text-muted-foreground/60"
                              : ""
                        }`}
                      >
                        {parseInt(cell.iso.slice(8, 10), 10)}
                      </p>
                      <div className={`space-y-0.5 ${outOfRange ? "opacity-40" : ""}`}>
                        {items.slice(0, 4).map((it) => {
                          const cls = `block w-full truncate rounded border-l-2 px-1 py-0.5 text-left text-[10px] leading-tight ${
                            it.bar ? "border-brand bg-brand/15 hover:bg-brand/25" : "border-brand/60 bg-brand/10 hover:bg-brand/20"
                          }`;
                          const title = `${it.s.name ?? "(세션명 없음)"} · ${describeSchedule(it.s.schedule)} · 필요 ${it.s.requiredCount}명${
                            it.s.locationName ? ` · ${it.s.locationName}` : ""
                          }`;
                          return canManage ? (
                            <button
                              key={it.key}
                              type="button"
                              title={`${title} · 클릭하여 수정`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEdit(it.s);
                              }}
                              className={cls}
                            >
                              {it.label}
                            </button>
                          ) : (
                            <Link
                              key={it.key}
                              href={expertsEnabled ? `/${tenantSlug}/projects/${projectId}?tab=experts#slot-${it.s.id}` : `/${tenantSlug}/projects/${projectId}?tab=sessions`}
                              title={title}
                              className={cls}
                            >
                              {it.label}
                            </Link>
                          );
                        })}
                        {items.length > 4 && <p className="pointer-events-none px-1 text-[10px] text-muted-foreground">+{items.length - 4}건</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "grid" && allDays.length === 0 ? (
        <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
          아직 일자가 없습니다. 위의 <b>세션 추가</b>로 바로 등록하거나, 기간·개별 날짜로 빈 일자 열을 먼저 만들 수
          있습니다.
        </p>
      ) : view === "grid" && visibleDays.length === 0 ? (
        <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
          설정한 기간({viewFrom || "처음"} ~ {viewTo || "끝"})에는 일자가 없습니다. 기간을 넓히거나 <b>기간 해제</b>를 누르세요.
        </p>
      ) : view === "grid" ? (
        <div className="overflow-x-auto rounded-lg border">
          <div className="min-w-max">
            {/* 상단 기간 막대 — 연속형 세션 (기획 지시 2026-09-21: 시각이 없으면 이 막대만, 글자 크게) */}
            {bars.length > 0 && (
              <div className="border-b bg-secondary/30" style={{ paddingLeft: AXIS_W }}>
                <div className="relative" style={{ width: colLeft.total, height: bars.length * 30 + 6 }}>
                  {bars.map((b, i) => {
                    // 기간 설정 중이면 보이는 날짜 구간만큼만 막대를 그린다
                    const dates = allDatesOf(b.schedule).filter((d) => visibleSet.has(d));
                    if (dates.length === 0) return null;
                    const first = visibleDays.indexOf(dates[0]!);
                    const last = visibleDays.indexOf(dates[dates.length - 1]!);
                    if (first < 0 || last < 0) return null;
                    const left = colLeft.lefts[first]! + 3;
                    const right = colLeft.lefts[last]! + colWidth(visibleDays[last]!) - 3;
                    const text = `${b.name ?? "(세션명 없음)"} · ${describeSchedule(b.schedule)}`;
                    const cls = `absolute flex items-center overflow-hidden rounded-md border-l-4 px-2 text-sm font-semibold leading-none shadow-sm ${
                      isAllDayBar(b.schedule) ? "border-brand bg-brand/15 hover:bg-brand/25" : "border-brand/60 bg-brand/10 hover:bg-brand/20"
                    }`;
                    const style = { left, width: Math.max(right - left, 40), top: 3 + i * 30, height: 26 } as const;
                    return canManage ? (
                      <button key={b.id} type="button" title={`${text} · 클릭하여 수정`} className={cls} style={style} onClick={() => openEdit(b)}>
                        <span className="truncate">{text}</span>
                      </button>
                    ) : (
                      <Link
                        key={b.id}
                        href={expertsEnabled ? `/${tenantSlug}/projects/${projectId}?tab=experts#slot-${b.id}` : `/${tenantSlug}/projects/${projectId}?tab=sessions`}
                        title={text}
                        className={cls}
                        style={style}
                      >
                        <span className="truncate">{text}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex">
              {/* 시간축 */}
              <div className="sticky left-0 z-20 shrink-0 border-r bg-background" style={{ width: AXIS_W }}>
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

              {visibleDays.map((day) => {
                const dayOcc = byDay.get(day) ?? [];
                const { blocks, trackCount } = layoutTimed(dayOcc);
                const untimed = dayOcc.filter((o) => toMin(o.startsTime) === null);
                const hasOverlap = blocks.some((b) => b.overlapped);
                const expanded = expandedDay === day;
                const coveredByBar = bars.some((b) => allDatesOf(b.schedule).includes(day));
                return (
                  <div key={day} className="shrink-0 border-r transition-[width]" style={{ width: colWidth(day) }}>
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
                          <span className="rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold text-white">시간 겹침</span>
                        )}
                        <span className="ml-auto text-[10px] text-muted-foreground">{dayOcc.length}건</span>
                      </button>
                      {canManage && dayOcc.length === 0 && !coveredByBar && (
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

                    {/* 시간 미정 조각 — 종일 띠 */}
                    <div className="flex h-7 items-center gap-1 overflow-x-auto border-b bg-secondary/20 px-1.5">
                      {untimed.map((o) => (
                        <button
                          key={`${o.s.id}:${o.date}`}
                          type="button"
                          disabled={pending || !canManage}
                          onClick={() => openEdit(o.s)}
                          title={`${o.s.name ?? ""} · 시간 미정 · 필요 ${o.s.requiredCount}명`}
                          className="max-w-[140px] truncate rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium hover:bg-secondary/70"
                        >
                          {o.s.name ?? "(세션명 없음)"}
                        </button>
                      ))}
                    </div>

                    <div
                      className={`relative overflow-hidden ${canManage ? "cursor-copy" : ""}`}
                      style={{ height: gridHeight }}
                      onClick={(e) => onGridClick(day, e)}
                      title={canManage ? "빈 시간을 클릭하면 그 시각으로 세션을 등록합니다" : undefined}
                    >
                      {hourMarks.map((h) => (
                        <div
                          key={h}
                          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted"
                          style={{ top: (h - hourWindow.startH) * HOUR_PX }}
                          aria-hidden
                        />
                      ))}
                      {blocks.map((b) => {
                        const top = ((b.startMin - hourWindow.startH * 60) / 60) * HOUR_PX;
                        const height = Math.max(((b.endMin - b.startMin) / 60) * HOUR_PX, 22);
                        const width = b.overlapped ? 100 / trackCount : 100;
                        const tall = height >= 52;
                        const s = b.o.s;
                        const mode = s.schedule.deliveryMode ? ` · ${DELIVERY_LABELS[s.schedule.deliveryMode]}` : "";
                        const info = `${timeLabel(b.o)} · ${s.name ?? "(세션명 없음)"} · ${roleLabel(s.roleType)} · 필요 ${s.requiredCount}명${
                          s.locationName ? ` · ${s.locationName}` : ""
                        }${mode}${b.overlapped ? " · ⚠ 같은 시간대 세션 있음" : ""}`;
                        const blockClass = `absolute overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left text-[10px] leading-tight shadow-sm transition-colors ${
                          b.overlapped ? "border-amber-500 bg-amber-100 hover:bg-amber-200" : "border-brand bg-brand/10 hover:bg-brand/20"
                        }`;
                        const blockStyle = {
                          top,
                          height,
                          left: b.overlapped ? `${b.track * width}%` : 0,
                          width: `calc(${width}% - 3px)`,
                        } as const;
                        const inner = (
                          <>
                            <span className="block truncate font-mono text-[9px] text-muted-foreground">{timeLabel(b.o)}</span>
                            <span className={`block font-semibold ${tall ? "" : "truncate"}`}>{s.name ?? "(세션명 없음)"}</span>
                            {tall && (
                              <span className="block truncate text-[9px] text-muted-foreground">
                                {roleLabel(s.roleType)} · 필요 {s.requiredCount}명{s.locationName ? ` · ${s.locationName}` : ""}
                                {mode}
                              </span>
                            )}
                          </>
                        );
                        return canManage ? (
                          <button
                            key={`${s.id}:${b.o.date}`}
                            type="button"
                            title={`${info} · 클릭하여 수정`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(s);
                            }}
                            className={blockClass}
                            style={blockStyle}
                          >
                            {inner}
                          </button>
                        ) : (
                          <Link
                            key={`${s.id}:${b.o.date}`}
                            href={expertsEnabled ? `/${tenantSlug}/projects/${projectId}?tab=experts#slot-${s.id}` : `/${tenantSlug}/projects/${projectId}?tab=sessions`}
                            title={info}
                            className={blockClass}
                            style={blockStyle}
                          >
                            {inner}
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

                    {canManage && (
                      <div className="border-t p-1.5">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => openCreate(day)}
                          className="w-full rounded-md border border-dashed border-coral/60 py-1 text-[11px] font-semibold text-coral transition-colors hover:bg-coral/10"
                        >
                          + 세션 추가
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <SessionDialog
        open={editor !== null}
        onOpenChange={(v) => !v && setEditor(null)}
        mode={editor?.mode ?? "create"}
        slotId={editor?.mode === "edit" ? editor.session.id : undefined}
        initial={editor?.initial ?? emptySessionForm()}
        projectId={projectId}
        tenantSlug={tenantSlug}
        expertsEnabled={expertsEnabled}
        fieldOptions={fieldOptions}
        mentees={editor?.mode === "edit" ? editor.session.mentees : []}
      />

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        여기서 등록한 세션은 <b>세션 확인</b> 탭·섭외후보 등록·결재 상신에 그대로 올라갑니다(코드넘버 TO 자동
        발급 포함). 연속형 세션은 상단 막대로, 개별선택형은 날짜마다 조각으로 보입니다. 세션을 클릭하면 바로
        수정·삭제할 수 있습니다. <b>월 달력</b>은 한 달을 한눈에, <b>기간 설정해서 보기</b>는 두 보기 모두에 적용됩니다.
      </p>
    </div>
  );
}

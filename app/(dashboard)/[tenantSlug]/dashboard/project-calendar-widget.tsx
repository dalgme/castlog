"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type WidgetSession = {
  id: string;
  projectId: string;
  projectName: string;
  date: string; // YYYY-MM-DD
  /** 컨설팅 세션(34번) 수행 종료일 — 있으면 기간 전체 날짜에 그린다 */
  endDate?: string | null;
  startsTime: string | null;
  endsTime: string | null;
  name: string | null;
};

/** 기간 세션이 그려질 최대 일수 — 무한 기간 입력 실수의 방어선 */
const MAX_SPAN_DAYS = 120;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 프로젝트별 고정 팔레트 — 같은 프로젝트는 늘 같은 색 (33번) */
const PALETTE = [
  "border-l-blue-500 bg-blue-50 text-blue-950",
  "border-l-emerald-500 bg-emerald-50 text-emerald-950",
  "border-l-violet-500 bg-violet-50 text-violet-950",
  "border-l-amber-500 bg-amber-50 text-amber-950",
  "border-l-rose-500 bg-rose-50 text-rose-950",
  "border-l-cyan-500 bg-cyan-50 text-cyan-950",
  "border-l-lime-600 bg-lime-50 text-lime-950",
  "border-l-fuchsia-500 bg-fuchsia-50 text-fuchsia-950",
  "border-l-orange-500 bg-orange-50 text-orange-950",
  "border-l-teal-500 bg-teal-50 text-teal-950",
] as const;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function timeLabel(s: WidgetSession): string {
  if (!s.startsTime) return "시간 미정";
  return `${s.startsTime.slice(0, 5)}${s.endsTime ? `~${s.endsTime.slice(0, 5)}` : ""}`;
}

/**
 * 대시보드 상단 '나의 프로젝트' 캘린더 (기획 확정 2026-08-30 — 33번).
 * 다가오는 일정을 일자별 열로 펼치고 프로젝트마다 색을 달리한다.
 * 대표·이사는 탭으로 [내 프로젝트 / 전체 행사 / 직원별 행사]를 오간다 —
 * 팀장 이하는 RLS가 이미 배정분만 보여 주므로 탭 없이 자기 캘린더다.
 */
export function ProjectCalendarWidget({
  tenantSlug,
  sessions,
  myProjectIds,
  isExecutive,
  staff,
  projectsByUser,
  todayIso,
  rangeStart,
  rangeEnd,
  truncated = false,
}: {
  tenantSlug: string;
  sessions: WidgetSession[];
  /** 내가 배정된 프로젝트 (내 캘린더 필터) */
  myProjectIds: string[];
  /** 대표·이사 — 전체·직원별 탭 노출 */
  isExecutive: boolean;
  staff: { id: string; name: string }[];
  /** userId → 배정 프로젝트 ids (직원별 탭) */
  projectsByUser: Record<string, string[]>;
  /** 서버 기준 오늘 (KST) — 클라이언트 TZ 흔들림 방지 */
  todayIso: string;
  /** 서버가 실어 준 일정 범위 — 이 밖의 달은 비어 있는 게 아니라 안 실은 것 */
  rangeStart: string;
  rangeEnd: string;
  /** 조회 상한에 걸려 일부가 빠졌는가 */
  truncated?: boolean;
}) {
  const [tab, setTab] = useState<"mine" | "all" | "staff">(
    isExecutive ? "all" : "mine"
  );
  const [staffId, setStaffId] = useState<string>("");
  // 월간 그리드 (구글 캘린더 형태) — 표시 중인 달 (YYYY-MM)
  const [month, setMonth] = useState<string>(todayIso.slice(0, 7));
  // 모바일 아젠다에서 이번 달 지난 일정도 펼칠지
  const [showPast, setShowPast] = useState(false);

  // 프로젝트 → 색 (첫 등장 순서 고정)
  const colorByProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      if (!map.has(s.projectId)) {
        map.set(s.projectId, PALETTE[map.size % PALETTE.length]!);
      }
    }
    return map;
  }, [sessions]);

  const visible = useMemo(() => {
    const mine = new Set(myProjectIds);
    if (tab === "mine") return sessions.filter((s) => mine.has(s.projectId));
    if (tab === "staff") {
      if (!staffId) return [];
      const theirs = new Set(projectsByUser[staffId] ?? []);
      return sessions.filter((s) => theirs.has(s.projectId));
    }
    return sessions;
  }, [sessions, tab, staffId, myProjectIds, projectsByUser]);

  const byDay = useMemo(() => {
    const map = new Map<string, WidgetSession[]>();
    const put = (day: string, s: WidgetSession) => {
      const list = map.get(day) ?? [];
      list.push(s);
      map.set(day, list);
    };
    for (const s of visible) {
      // 기간 세션(컨설팅)은 시작~종료 매일에 그린다 (감사 P3-5b)
      if (s.endDate && s.endDate > s.date) {
        let day = s.date;
        for (let i = 0; i < MAX_SPAN_DAYS && day <= s.endDate; i++) {
          put(day, s);
          day = addDays(day, 1);
        }
      } else {
        put(s.date, s);
      }
    }
    for (const list of Array.from(map.values())) {
      list.sort((a, b) => (a.startsTime ?? "99").localeCompare(b.startsTime ?? "99"));
    }
    return map;
  }, [visible]);

  // 월간 그리드 셀 — 해당 월 1일이 속한 주의 일요일부터 6주(42칸)
  const monthCells = useMemo(() => {
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
  }, [month]);

  function shiftMonth(delta: number) {
    const d = new Date(`${month}-01T00:00:00`);
    d.setMonth(d.getMonth() + delta);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  // 서버가 실어 준 범위 밖 달은 이동을 막는다 — 빈 그리드가 "일정 없음"으로
  // 읽히면 안 된다 (감사 P3-5)
  const rangeStartMonth = rangeStart.slice(0, 7);
  const rangeEndMonth = rangeEnd.slice(0, 7);
  const canPrev = month > rangeStartMonth;
  const canNext = month < rangeEndMonth;
  const monthHasEvents = monthCells.some(
    (c) => c.inMonth && (byDay.get(c.iso)?.length ?? 0) > 0
  );
  // 좁은 화면용 아젠다 — 데스크톱 7열 격자를 가로 스크롤로 축소하지 않는다
  // (§14-6). 표시 중인 달의 일정 있는 날짜만, 이번 달이면 오늘부터.
  const agendaDays = monthCells
    .filter((c) => c.inMonth && (byDay.get(c.iso)?.length ?? 0) > 0)
    .filter(
      (c) => showPast || month !== todayIso.slice(0, 7) || c.iso >= todayIso
    );
  const pastCountThisMonth =
    month === todayIso.slice(0, 7)
      ? monthCells.filter(
          (c) => c.inMonth && c.iso < todayIso && (byDay.get(c.iso)?.length ?? 0) > 0
        ).length
      : 0;
  const dayTitle = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  };

  const legendProjects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of visible) {
      if (!seen.has(s.projectId)) seen.set(s.projectId, s.projectName);
    }
    return Array.from(seen.entries());
  }, [visible]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-sm">
          {tab === "all"
            ? "전체 행사 캘린더"
            : tab === "staff"
              ? "직원별 행사 캘린더"
              : "나의 프로젝트 캘린더"}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          {isExecutive && (
            <>
              {(
                [
                  { key: "mine", label: "내 프로젝트" },
                  { key: "all", label: "전체 행사" },
                  { key: "staff", label: "직원별" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                    tab === t.key
                      ? "bg-brand text-white"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {t.label}
                </button>
              ))}
              {tab === "staff" && (
                <select
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  className="h-7 rounded-md border bg-background px-1.5 text-xs"
                  aria-label="직원 선택"
                >
                  <option value="">직원 선택</option>
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="이전 달"
            disabled={!canPrev}
            title={canPrev ? undefined : "지난달까지만 표시합니다"}
            onClick={() => shiftMonth(-1)}
            className="rounded-md border p-1 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="다음 달"
            disabled={!canNext}
            title={canNext ? undefined : "3개월 뒤까지만 표시합니다"}
            onClick={() => shiftMonth(1)}
            className="rounded-md border p-1 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <p className="text-sm font-bold">
            {month.slice(0, 4)}년 {parseInt(month.slice(5, 7), 10)}월
          </p>
          <button
            type="button"
            onClick={() => setMonth(todayIso.slice(0, 7))}
            className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary"
          >
            오늘
          </button>
          {tab === "staff" && !staffId && (
            <span className="text-xs text-muted-foreground">
              직원을 선택하면 그 직원의 일정이 표시됩니다.
            </span>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">
            지난달 ~ 3개월 뒤까지 표시
          </span>
        </div>
        {truncated && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
            일정이 많아 일부만 실렸습니다 — 빠진 일정은 각 프로젝트의 기본설정
            탭 캘린더에서 확인하세요.
          </p>
        )}
        {!monthHasEvents && !(tab === "staff" && !staffId) && (
          <p className="rounded-md bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground">
            이 달에는 표시할 일정이 없습니다. 세션은 프로젝트 &gt; 기본설정 탭
            캘린더에서 등록합니다.
          </p>
        )}

        {/* 좁은 화면: 일자별 아젠다 (감사 UX H3) */}
        <div className="sm:hidden">
          {agendaDays.length === 0 ? null : (
            <ul className="divide-y rounded-md border">
              {agendaDays.map((c) => (
                <li key={c.iso} className="p-2">
                  <p
                    className={`text-xs font-bold ${
                      c.iso === todayIso ? "text-brand" : ""
                    }`}
                  >
                    {dayTitle(c.iso)}
                    {c.iso === todayIso ? " · 오늘" : ""}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {(byDay.get(c.iso) ?? []).map((s) => {
                      const spanning = Boolean(s.endDate && s.endDate > s.date);
                      return (
                        <li key={`${s.id}:${c.iso}`}>
                          <Link
                            href={`/${tenantSlug}/projects/${s.projectId}?tab=sessions`}
                            className={`flex min-h-11 items-center gap-2 rounded border-l-4 px-2 py-1.5 text-sm ${
                              colorByProject.get(s.projectId) ?? PALETTE[0]
                            }`}
                          >
                            <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
                              {spanning
                                ? "기간"
                                : s.startsTime
                                  ? s.startsTime.slice(0, 5)
                                  : "미정"}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {s.name ?? "(세션명 없음)"}
                            </span>
                            <span className="max-w-[40%] truncate text-[11px] text-muted-foreground">
                              {s.projectName}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {agendaDays.length === 0 && pastCountThisMonth > 0 && (
            <p className="rounded-md bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground">
              이번 달 남은 일정이 없습니다.
            </p>
          )}
          {pastCountThisMonth > 0 && (
            <button
              type="button"
              onClick={() => setShowPast((v) => !v)}
              aria-pressed={showPast}
              className="mt-1 min-h-9 text-[11px] text-brand underline underline-offset-4"
            >
              {showPast
                ? "지난 일정 접기"
                : `지난 일정 ${pastCountThisMonth}일분 보기`}
            </button>
          )}
        </div>

        {/* 구글 캘린더식 월간 그리드 (sm 이상) */}
        <div className="hidden overflow-x-auto sm:block">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 border-b text-center">
              {WEEKDAYS.map((w, i) => (
                <span
                  key={w}
                  className={`py-1 text-[11px] font-semibold ${
                    i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-muted-foreground"
                  }`}
                >
                  {w}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthCells.map((cell) => {
                const list = byDay.get(cell.iso) ?? [];
                const isToday = cell.iso === todayIso;
                return (
                  <div
                    key={cell.iso}
                    className={`min-h-[84px] border-b border-r p-1 first:border-l ${
                      cell.inMonth ? "" : "bg-secondary/30"
                    } ${isToday ? "bg-brand/[0.05]" : ""}`}
                  >
                    <p
                      className={`mb-0.5 text-[11px] font-semibold ${
                        isToday
                          ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white"
                          : cell.inMonth
                            ? ""
                            : "text-muted-foreground/60"
                      }`}
                    >
                      {parseInt(cell.iso.slice(8, 10), 10)}
                    </p>
                    <div className="space-y-0.5">
                      {list.slice(0, 3).map((s) => {
                        const spanning = Boolean(s.endDate && s.endDate > s.date);
                        return (
                          <Link
                            key={`${s.id}:${cell.iso}`}
                            href={`/${tenantSlug}/projects/${s.projectId}?tab=sessions`}
                            title={`${s.projectName} · ${s.name ?? ""} · ${
                              spanning
                                ? `${s.date} ~ ${s.endDate} (캘린더에는 ${MAX_SPAN_DAYS}일까지 표시)`
                                : timeLabel(s)
                            }`}
                            className={`block truncate rounded border-l-2 px-1 py-0.5 text-[10px] leading-tight transition-opacity hover:opacity-80 ${
                              colorByProject.get(s.projectId) ?? PALETTE[0]
                            }`}
                          >
                            {spanning
                              ? "기간 "
                              : s.startsTime
                                ? `${s.startsTime.slice(0, 5)} `
                                : ""}
                            {s.name ?? "(세션명 없음)"}
                          </Link>
                        );
                      })}
                      {list.length > 3 && (
                        <p className="px-1 text-[10px] text-muted-foreground">
                          +{list.length - 3}건
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {legendProjects.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {legendProjects.map(([id, name]) => (
              <Link
                key={id}
                href={`/${tenantSlug}/projects/${id}`}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <span
                  className={`h-2.5 w-2.5 rounded-sm border-l-4 ${
                    colorByProject.get(id) ?? PALETTE[0]
                  }`}
                  aria-hidden
                />
                {name}
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

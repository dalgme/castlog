"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type WidgetSession = {
  id: string;
  projectId: string;
  projectName: string;
  date: string; // YYYY-MM-DD
  startsTime: string | null;
  endsTime: string | null;
  name: string | null;
};

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

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
}

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
}) {
  const [tab, setTab] = useState<"mine" | "all" | "staff">(
    isExecutive ? "all" : "mine"
  );
  const [staffId, setStaffId] = useState<string>("");

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
    for (const s of visible) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    for (const list of Array.from(map.values())) {
      list.sort((a, b) => (a.startsTime ?? "99").localeCompare(b.startsTime ?? "99"));
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

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
        {byDay.length === 0 ? (
          <p className="rounded-md bg-secondary/50 p-3 text-sm text-muted-foreground">
            {tab === "staff" && !staffId
              ? "직원을 선택하면 그 직원이 배정된 프로젝트의 일정이 표시됩니다."
              : "다가오는 일정이 없습니다."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex min-w-max gap-2 pb-1">
              {byDay.map(([day, list]) => (
                <div
                  key={day}
                  className={`w-44 shrink-0 rounded-lg border ${
                    day === todayIso ? "border-brand/60 bg-brand/[0.03]" : ""
                  }`}
                >
                  <p
                    className={`border-b px-2 py-1 text-[11px] font-bold ${
                      day === todayIso ? "text-brand" : ""
                    }`}
                  >
                    {dayLabel(day)}
                    {day === todayIso && " · 오늘"}
                  </p>
                  <div className="space-y-1 p-1.5">
                    {list.map((s) => (
                      <Link
                        key={s.id}
                        href={`/${tenantSlug}/projects/${s.projectId}?tab=sessions`}
                        title={`${s.projectName} · ${s.name ?? ""} · ${timeLabel(s)}`}
                        className={`block rounded-md border-l-4 px-1.5 py-1 text-[10px] leading-tight transition-opacity hover:opacity-80 ${
                          colorByProject.get(s.projectId) ?? PALETTE[0]
                        }`}
                      >
                        <span className="block font-mono text-[9px] opacity-70">
                          {timeLabel(s)}
                        </span>
                        <span className="block truncate font-semibold">
                          {s.name ?? "(세션명 없음)"}
                        </span>
                        <span className="block truncate text-[9px] opacity-70">
                          {s.projectName}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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

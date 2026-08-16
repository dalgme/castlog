"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Eye,
  EyeOff,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tag } from "@/components/expert/ui";
import type { CalendarEvent } from "@/lib/experts/calendar-types";

import {
  upsertExternalSchedule,
  deleteExternalSchedule,
} from "./actions";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** 이벤트를 날짜키 → 이벤트[] 로 매핑(다일 일정은 각 날짜에 배치). */
function bucketByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const start = new Date(ev.start);
    const end = ev.end ? new Date(ev.end) : start;
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    let guard = 0;
    while (cur.getTime() <= last.getTime() && guard < 400) {
      const k = dateKey(cur.getFullYear(), cur.getMonth(), cur.getDate());
      const arr = map.get(k) ?? [];
      arr.push(ev);
      map.set(k, arr);
      cur.setDate(cur.getDate() + 1);
      guard++;
    }
  }
  return map;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export function CalendarView({ events }: { events: CalendarEvent[] }) {
  const today = new Date();
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selectedKey, setSelectedKey] = useState<string>(
    dateKey(today.getFullYear(), today.getMonth(), today.getDate())
  );
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [adding, setAdding] = useState(false);

  const byDay = useMemo(() => bucketByDay(events), [events]);

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const move = (delta: number) => {
    const m = view.m + delta;
    const y = view.y + Math.floor(m / 12);
    const nm = ((m % 12) + 12) % 12;
    setView({ y, m: nm });
  };
  const goToday = () => {
    setView({ y: today.getFullYear(), m: today.getMonth() });
    setSelectedKey(dateKey(today.getFullYear(), today.getMonth(), today.getDate()));
  };

  const selectedEvents = byDay.get(selectedKey) ?? [];
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <div className="space-y-4">
      {/* 컨트롤 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => move(-1)}
            className="rounded-md border p-1.5 text-muted-foreground hover:text-brand-navy"
            aria-label="이전 달"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[7rem] text-center text-sm font-bold text-brand-navy">
            {view.y}년 {view.m + 1}월
          </span>
          <button
            type="button"
            onClick={() => move(1)}
            className="rounded-md border p-1.5 text-muted-foreground hover:text-brand-navy"
            aria-label="다음 달"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <Button variant="outline" size="sm" onClick={goToday}>오늘</Button>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full bg-brand" /> 캐스트로그
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full bg-brand-amber" /> 외부
          </span>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setAdding(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> 외부 일정 추가
          </Button>
        </div>
      </div>

      {/* 월 그리드 */}
      <div className="overflow-hidden rounded-xl border bg-background shadow-sm">
        <div className="grid grid-cols-7 border-b bg-secondary/40 text-center text-xs font-semibold text-muted-foreground">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={"py-2 " + (i === 0 ? "text-red-500" : i === 6 ? "text-brand" : "")}>
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} className="min-h-[68px] border-b border-r bg-muted/30" />;
            const k = dateKey(view.y, view.m, d);
            const dayEvents = byDay.get(k) ?? [];
            const isToday = k === todayKey;
            const isSelected = k === selectedKey;
            return (
              <button
                type="button"
                key={i}
                onClick={() => setSelectedKey(k)}
                className={
                  "min-h-[68px] border-b border-r p-1 text-left align-top transition-colors " +
                  (isSelected ? "bg-brand/[0.06] ring-1 ring-inset ring-brand/40" : "hover:bg-muted/50")
                }
              >
                <span
                  className={
                    "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs " +
                    (isToday ? "bg-brand font-bold text-white" : "text-brand-navy")
                  }
                >
                  {d}
                </span>
                <div className="mt-0.5 space-y-0.5">
                  {dayEvents.slice(0, 2).map((ev, idx) => (
                    <div
                      key={idx}
                      className={
                        "truncate rounded px-1 py-0.5 text-[10px] font-medium " +
                        (ev.source === "castlog"
                          ? "bg-brand/10 text-brand"
                          : "bg-brand-amber/15 text-[#8A6A00]")
                      }
                    >
                      {ev.title}
                    </div>
                  ))}
                  {dayEvents.length > 2 && (
                    <div className="px-1 text-[10px] text-muted-foreground">+{dayEvents.length - 2}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 선택 날짜 일정 */}
      <div className="rounded-xl border bg-background p-4 shadow-sm">
        <p className="mb-2 text-sm font-bold text-brand-navy">{selectedKey} 일정</p>
        {selectedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">이 날에는 등록된 일정이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {selectedEvents.map((ev) => (
              <li
                key={`${ev.source}-${ev.id}`}
                className={
                  "rounded-lg border-l-4 bg-muted/30 p-3 " +
                  (ev.source === "castlog" ? "border-brand" : "border-brand-amber")
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  {ev.source === "castlog" ? (
                    <Tag tone="blue">캐스트로그</Tag>
                  ) : (
                    <Tag tone="amber">외부</Tag>
                  )}
                  <span className="text-sm font-semibold text-brand-navy">{ev.title}</span>
                  {ev.source === "external" && !ev.allDay && (
                    <span className="text-xs text-muted-foreground">
                      {fmtTime(ev.start)}
                      {ev.end ? `–${fmtTime(ev.end)}` : ""}
                    </span>
                  )}
                  {ev.source === "external" && (
                    <span className="ml-auto flex items-center gap-1">
                      <span
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                        title={ev.shared ? "연결 기업 가용성 확인에 공유됨" : "비공개(기업에 미노출)"}
                      >
                        {ev.shared ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        {ev.shared ? "공유" : "비공개"}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAdding(false);
                          setEditing(ev);
                        }}
                        className="rounded p-1 text-muted-foreground hover:text-brand"
                        aria-label="편집"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <DeleteButton id={ev.id} />
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {ev.orgName && <span>{ev.orgName}</span>}
                  {ev.location && (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" /> {ev.location}
                    </span>
                  )}
                </div>
                {ev.memo && <p className="mt-1 text-xs text-brand-navy/80">{ev.memo}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {(adding || editing) && (
        <ScheduleForm
          editing={editing}
          defaultDateKey={selectedKey}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function toLocalInput(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (allDay) return date;
  return `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ScheduleForm({
  editing,
  defaultDateKey,
  onClose,
}: {
  editing: CalendarEvent | null;
  defaultDateKey: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [allDay, setAllDay] = useState(editing?.allDay ?? true);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [orgName, setOrgName] = useState(editing?.orgName ?? "");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [startsAt, setStartsAt] = useState(
    editing ? toLocalInput(editing.start, editing.allDay) : defaultDateKey
  );
  const [endsAt, setEndsAt] = useState(
    editing?.end ? toLocalInput(editing.end, editing.allDay) : ""
  );
  const [memo, setMemo] = useState(editing?.memo ?? "");
  const [shared, setShared] = useState(editing?.shared ?? true);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await upsertExternalSchedule(editing?.id ?? null, {
        title,
        orgName,
        location,
        startsAt,
        endsAt: endsAt || undefined,
        allDay,
        memo,
        sharedWithTenants: shared,
      });
      if (!result.ok) setError(result.error);
      else {
        onClose();
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2 rounded-xl border border-brand/30 bg-brand/[0.03] p-4 shadow-sm">
      <p className="text-sm font-bold text-brand-navy">
        {editing ? "외부 일정 편집" : "외부 일정 추가"}
      </p>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="일정 제목 (예: ○○기관 창업 특강)" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="섭외 기관/주최 (선택)" />
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="장소 (선택)" />
      </div>
      <label className="flex cursor-pointer items-center gap-1.5 text-sm">
        <Checkbox checked={allDay} onCheckedChange={(v) => setAllDay(Boolean(v))} />
        종일
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="text-[11px] text-muted-foreground">시작</label>
          <Input
            type={allDay ? "date" : "datetime-local"}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">종료 (선택)</label>
          <Input
            type={allDay ? "date" : "datetime-local"}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
      </div>
      <Textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모 (선택)" />
      <label className="flex cursor-pointer items-start gap-1.5 text-sm">
        <Checkbox checked={shared} onCheckedChange={(v) => setShared(Boolean(v))} className="mt-0.5" />
        <span>
          연결 기업의 <b>가용성 확인</b>에 이 일정을 공유
          <span className="block text-[11px] text-muted-foreground">
            켜두면 기업이 섭외 전 &lsquo;바쁜 날&rsquo;로 참고합니다. 제목·메모 등 상세는 노출되지 않습니다.
          </span>
        </span>
      </label>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "저장 중..." : "저장"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>취소</Button>
      </div>
    </div>
  );
}

function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const onDelete = () =>
    startTransition(async () => {
      await deleteExternalSchedule(id);
      router.refresh();
    });

  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="rounded px-1.5 py-0.5 text-xs font-semibold text-red-600 hover:bg-red-50"
        >
          삭제
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          취소
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded p-1 text-muted-foreground hover:text-red-600"
      aria-label="삭제"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  describeSchedule,
  isDateKind,
  isDeliveryMode,
  legacySchedule,
  type SessionDate,
  type SessionSchedule,
} from "@/lib/sessions/schedule";

/** RLS 클라이언트(server.ts)와 service_role 클라이언트(admin.ts) 둘 다 받는다 */
type Db = SupabaseClient<Database>;

/**
 * 섭외 건·수락서에 남기는 일정 문구 스냅샷 (기획 2026-09-21 후속).
 * 단일 날짜 세션은 null — 옛 표기(starts_on/ends_on 기반)를 그대로 써서
 * 이미 나간 고객 화면이 바뀌지 않게 한다. 여러 날·회차·진행 방식이 있는
 * 세션만 문장으로 남긴다.
 */
export function scheduleSnapshotText(s: SessionSchedule): string | null {
  const singleDay =
    s.dateKind === "individual" && s.dates.length <= 1 && s.deliveryMode === null && s.countMin === null;
  if (singleDay) return null;
  return describeSchedule(s, { withYear: true });
}

/**
 * engagement_slots 행 + engagement_slot_dates → SessionSchedule (서버 공용).
 * 세션 목록·캘린더·결재 상세·안내문자가 같은 로더를 쓴다.
 */

export const SLOT_SCHEDULE_COLUMNS =
  "date_kind, end_starts_time, end_ends_time, session_count_min, session_count_max, " +
  "session_count_online, session_count_offline, delivery_mode, unit_fee_online, unit_fee_offline";

export type SlotScheduleRow = {
  slot_date: string;
  period_end_date: string | null;
  starts_time: string | null;
  ends_time: string | null;
  date_kind?: string | null;
  end_starts_time?: string | null;
  end_ends_time?: string | null;
  session_count_min?: number | null;
  session_count_max?: number | null;
  session_count_online?: number | null;
  session_count_offline?: number | null;
  delivery_mode?: string | null;
};

export function scheduleFromRow(row: SlotScheduleRow, dates: SessionDate[]): SessionSchedule {
  // 마이그레이션 전 행(컬럼 부재) — 단일 날짜 모델로 폴백 (§14-10)
  if (!isDateKind(row.date_kind)) return legacySchedule(row);
  const individual = row.date_kind === "individual";
  const list = individual
    ? dates.length > 0
      ? dates
      : [{ date: row.slot_date, startsTime: row.starts_time, endsTime: row.ends_time }]
    : [];
  return {
    dateKind: row.date_kind,
    startDate: row.slot_date,
    endDate: row.period_end_date,
    startsTime: row.starts_time,
    endsTime: row.ends_time,
    endStartsTime: row.end_starts_time ?? null,
    endEndsTime: row.end_ends_time ?? null,
    dates: list,
    countMin: row.session_count_min ?? null,
    countMax: row.session_count_max ?? null,
    onlineCount: row.session_count_online ?? null,
    offlineCount: row.session_count_offline ?? null,
    deliveryMode: isDeliveryMode(row.delivery_mode) ? row.delivery_mode : null,
  };
}

/** 여러 세션의 개별 날짜를 한 번에 — 테이블 부재(42P01)면 빈 맵 */
export async function loadSlotDates(
  supabase: Db,
  slotIds: string[]
): Promise<Map<string, SessionDate[]>> {
  const map = new Map<string, SessionDate[]>();
  if (slotIds.length === 0) return map;
  const { data, error } = await supabase
    .from("engagement_slot_dates")
    .select("slot_id, on_date, starts_time, ends_time, sort_order")
    .in("slot_id", slotIds)
    .order("on_date", { ascending: true });
  if (error) return map;
  for (const d of data ?? []) {
    const list = map.get(d.slot_id) ?? [];
    list.push({ date: d.on_date, startsTime: d.starts_time, endsTime: d.ends_time });
    map.set(d.slot_id, list);
  }
  return map;
}

/** 세션 하나의 일정 — 안내문자·결재 상세처럼 한 건만 보는 자리 */
export async function loadSlotSchedule(
  supabase: Db,
  slot: SlotScheduleRow & { id: string }
): Promise<SessionSchedule> {
  const dates = await loadSlotDates(supabase, [slot.id]);
  return scheduleFromRow(slot, dates.get(slot.id) ?? []);
}

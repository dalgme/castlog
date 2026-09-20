import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { engagementFeeTerms, type EngagementFeeTerms } from "@/lib/sessions/fees";
import {
  SLOT_SCHEDULE_COLUMNS,
  loadSlotDates,
  scheduleFromRow,
} from "@/lib/integrations/slot-schedule";

type Db = SupabaseClient<Database>;

/**
 * 섭외 건 → 섭외 조건(진행 방식·총 회차·회차당 시간·회차당 단가) (기획 지시 2026-09-21).
 * 섭외 건은 자리(코드넘버)를 통해 세션에 닿는다 — 자리의 개별 단가가 세션 단가보다 우선.
 * 자리 없이 만든 건(직접 섭외)이나 일정·단가 컬럼 미적용 DB(§14-10)는 null.
 */
export async function loadEngagementFeeTerms(
  supabase: Db,
  engagementId: string
): Promise<EngagementFeeTerms | null> {
  const { data: position, error: positionError } = await supabase
    .from("engagement_slot_positions")
    .select("slot_id, unit_fee_online, unit_fee_offline")
    .eq("engagement_id", engagementId)
    .maybeSingle();
  if (positionError || !position) return null;
  const { data: slot, error: slotError } = await supabase
    .from("engagement_slots")
    .select(
      `id, slot_date, period_end_date, starts_time, ends_time, unit_fee_online, unit_fee_offline, ${SLOT_SCHEDULE_COLUMNS}`
    )
    .eq("id", position.slot_id)
    .maybeSingle();
  if (slotError || !slot) return null;
  const dates = await loadSlotDates(supabase, [slot.id]);
  return engagementFeeTerms(
    scheduleFromRow(slot, dates.get(slot.id) ?? []),
    position.unit_fee_online ?? slot.unit_fee_online,
    position.unit_fee_offline ?? slot.unit_fee_offline
  );
}

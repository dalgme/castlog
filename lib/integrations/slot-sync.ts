import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingColumnError } from "@/lib/supabase/errors";
import {
  SLOT_SCHEDULE_COLUMNS,
  loadSlotDates,
  scheduleFromRow,
  scheduleSnapshotText,
} from "@/lib/integrations/slot-schedule";

/**
 * 세션 내용이 바뀌면 그 세션을 인용하는 섭외 건·수락서까지 따라간다 (기획 지시 2026-09-21).
 *
 * 대상: 세션의 자리(코드넘버)에 붙은 섭외 건 중
 *  - 회신 대기(requested) 건 — 일정·의뢰비용·장소를 현재 값으로
 *  - 수락(accepted) 건 중 수락서가 아직 송부되지 않은(issued·없음) 건 — 섭외 건과
 *    자동 생성 수락서 스냅샷을 함께 현재 값으로
 * 송부·서명·확정된 수락서는 계약 문서라 건드리지 않는다 — 그 건은 긴급 취소 후
 * 다시 요청하는 경로다. 의뢰비용은 후보별 예정가(recomputeSlotFees 뒤의 값).
 * service_role로 처리하되 tenant_id를 명시한다. 컬럼 미적용 DB는 조용히 건너뛴다.
 */
export async function propagateSlotToEngagements(
  tenantId: string,
  slotId: string,
  actor: { userId: string; role: string }
): Promise<{ engagements: number; acceptances: number }> {
  const admin = createAdminClient();
  const { data: slot, error: slotError } = await admin
    .from("engagement_slots")
    .select(
      `id, project_id, slot_date, period_end_date, starts_time, ends_time, location_name, location_address, fee_amount, ${SLOT_SCHEDULE_COLUMNS}`
    )
    .eq("id", slotId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (slotError || !slot) return { engagements: 0, acceptances: 0 };
  const dates = await loadSlotDates(admin, [slot.id]);
  const schedule = scheduleFromRow(slot, dates.get(slot.id) ?? []);
  const scheduleText = scheduleSnapshotText(schedule);
  const endsOn = slot.period_end_date ?? slot.slot_date;

  const { data: positions } = await admin
    .from("engagement_slot_positions")
    .select("id, engagement_id, expected_fee")
    .eq("slot_id", slotId)
    .eq("tenant_id", tenantId)
    .not("engagement_id", "is", null);
  const targets = (positions ?? []).filter((p): p is typeof p & { engagement_id: string } => Boolean(p.engagement_id));
  if (targets.length === 0) return { engagements: 0, acceptances: 0 };

  const { data: engagements } = await admin
    .from("expert_engagements")
    .select("id, status")
    .in(
      "id",
      targets.map((p) => p.engagement_id)
    )
    .eq("tenant_id", tenantId)
    .in("status", ["requested", "accepted"]);
  const { data: acceptances } = await admin
    .from("engagement_acceptances")
    .select("id, engagement_id, status")
    .in(
      "engagement_id",
      targets.map((p) => p.engagement_id)
    )
    .eq("tenant_id", tenantId);
  const acceptanceByEngagement = new Map((acceptances ?? []).map((a) => [a.engagement_id, a]));

  let engagementCount = 0;
  let acceptanceCount = 0;
  for (const position of targets) {
    const engagement = (engagements ?? []).find((e) => e.id === position.engagement_id);
    if (!engagement) continue;
    const acceptance = acceptanceByEngagement.get(engagement.id) ?? null;
    if (engagement.status === "accepted" && acceptance && acceptance.status !== "issued") continue;

    const fee = position.expected_fee ?? slot.fee_amount;
    const base = {
      fee_amount: fee,
      starts_on: slot.slot_date,
      ends_on: endsOn,
      starts_time: slot.starts_time,
      ends_time: slot.ends_time,
      location_name: slot.location_name,
      location_address: slot.location_address,
    };
    let { error } = await admin
      .from("expert_engagements")
      .update({ ...base, schedule_text: scheduleText })
      .eq("id", engagement.id)
      .eq("tenant_id", tenantId);
    if (error && isMissingColumnError(error)) {
      ({ error } = await admin.from("expert_engagements").update(base).eq("id", engagement.id).eq("tenant_id", tenantId));
    }
    if (error) continue;
    engagementCount += 1;

    if (acceptance && acceptance.status === "issued") {
      const accBase = {
        fee_amount: fee,
        starts_on: slot.slot_date,
        ends_on: endsOn,
        starts_time: slot.starts_time,
        ends_time: slot.ends_time,
        location_name: slot.location_name,
        location_address: slot.location_address,
      };
      let { error: accError } = await admin
        .from("engagement_acceptances")
        .update({ ...accBase, schedule_text: scheduleText })
        .eq("id", acceptance.id)
        .eq("status", "issued");
      if (accError && isMissingColumnError(accError)) {
        ({ error: accError } = await admin
          .from("engagement_acceptances")
          .update(accBase)
          .eq("id", acceptance.id)
          .eq("status", "issued"));
      }
      if (!accError) acceptanceCount += 1;
    }

    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_auth_user_id: actor.userId,
      actor_role: actor.role,
      action: "engagement.sync_from_slot",
      resource_type: "expert_engagement",
      resource_id: engagement.id,
      after_data: {
        slot_id: slotId,
        project_id: slot.project_id,
        fee_amount: fee,
        schedule_text: scheduleText,
        acceptance_updated: Boolean(acceptance && acceptance.status === "issued"),
      },
    });
  }
  return { engagements: engagementCount, acceptances: acceptanceCount };
}

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";

export type CandidateConflict = {
  /** 자사 섭외와 겹침 — 상세 공개 */
  own: { label: string; startsOn: string }[];
  /** 타사 섭외·전문가 개인 일정과 겹침 — 건수만(§4 테넌트 격리) */
  blindCount: number;
};

export type SlotCandidate = {
  expertId: string;
  name: string;
  specialty: string | null;
  region: string | null;
  careerYears: number | null;
  conflict: CandidateConflict;
};

export type SlotContext = {
  positionId: string;
  code: string;
  status: string;
  slotDate: string;
  startsTime: string | null;
  endsTime: string | null;
  roleType: string;
  roleDescription: string | null;
  feeAmount: number | null;
  locationName: string | null;
  locationAddress: string | null;
  projectId: string;
  projectName: string;
  assignedExpertId: string | null;
  engagementId: string | null;
};

/** 슬롯 일시를 [시작, 종료] 타임스탬프로. 시간 미지정이면 하루 전체. */
function slotWindow(
  slotDate: string,
  startsTime: string | null,
  endsTime: string | null
): [number, number] {
  const s = new Date(`${slotDate}T${startsTime ? startsTime.slice(0, 5) : "00:00"}:00`);
  const e = new Date(`${slotDate}T${endsTime ? endsTime.slice(0, 5) : "23:59"}:00`);
  return [s.getTime(), e.getTime()];
}

function overlapsDay(from: number, to: number, startISO: string, endISO: string | null) {
  const s = new Date(startISO).getTime();
  const e = endISO ? new Date(endISO).getTime() : s;
  return s <= to && e >= from;
}

/** 넘버링코드(포지션) 컨텍스트 — 권한은 RLS에 위임. */
export async function getPositionContext(
  positionId: string
): Promise<SlotContext | null> {
  if (!hasSupabaseEnv()) return null;
  const supabase = createClient();

  const { data: position } = await supabase
    .from("engagement_slot_positions")
    .select("id, code, status, slot_id, expert_id, engagement_id")
    .eq("id", positionId)
    .maybeSingle();
  if (!position) return null;

  const { data: slot } = await supabase
    .from("engagement_slots")
    .select(
      "id, project_id, slot_date, starts_time, ends_time, role_type, role_description, fee_amount, location_name, location_address"
    )
    .eq("id", position.slot_id)
    .maybeSingle();
  if (!slot) return null;

  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", slot.project_id)
    .maybeSingle();
  if (!project) return null;

  return {
    positionId: position.id,
    code: position.code,
    status: position.status,
    slotDate: slot.slot_date,
    startsTime: slot.starts_time,
    endsTime: slot.ends_time,
    roleType: slot.role_type,
    roleDescription: slot.role_description,
    feeAmount: slot.fee_amount,
    locationName: slot.location_name,
    locationAddress: slot.location_address,
    projectId: slot.project_id,
    projectName: project.name,
    assignedExpertId: position.expert_id,
    engagementId: position.engagement_id,
  };
}

/**
 * 넘버링코드별 섭외 후보군 + 일정 중복 자동 검증.
 *
 * 후보 = 자사와 활성 연결된 전문가. 각 후보에 대해 해당 슬롯 일시와 겹치는 일정이
 * 있는지 판정한다. 자사 섭외는 내역을 보여주고, 타사 섭외·전문가 개인 일정은
 * 겹침 건수만 노출한다(§4 테넌트 격리).
 */
export async function getSlotCandidates(ctx: SlotContext): Promise<SlotCandidate[]> {
  if (!hasSupabaseEnv()) return [];
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  if (!tenantId) return [];

  const { data: links } = await supabase
    .from("expert_tenant_links")
    .select("expert_id, status, experts (id, name, specialty, region, career_years)")
    .eq("status", "active");

  const candidates = (links ?? [])
    .map((l) => l.experts)
    .filter((e): e is NonNullable<typeof e> => e !== null);
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const [from, to] = slotWindow(ctx.slotDate, ctx.startsTime, ctx.endsTime);

  const admin = createAdminClient();
  const [{ data: engagements }, { data: externals }] = await Promise.all([
    admin
      .from("expert_engagements")
      .select("expert_id, tenant_id, role_description, starts_on, ends_on, status")
      .in("expert_id", ids)
      .in("status", ["requested", "accepted"])
      .not("starts_on", "is", null),
    admin
      .from("expert_external_schedules")
      .select("expert_id, starts_at, ends_at")
      .in("expert_id", ids)
      .eq("shared_with_tenants", true),
  ]);

  const conflictByExpert = new Map<string, CandidateConflict>();
  const ensure = (id: string) => {
    let c = conflictByExpert.get(id);
    if (!c) {
      c = { own: [], blindCount: 0 };
      conflictByExpert.set(id, c);
    }
    return c;
  };

  for (const g of engagements ?? []) {
    if (!g.starts_on) continue;
    if (!overlapsDay(from, to, g.starts_on, g.ends_on)) continue;
    const c = ensure(g.expert_id);
    if (g.tenant_id === tenantId) {
      c.own.push({
        label:
          (g.status === "accepted" ? "자사 섭외(확정)" : "자사 섭외(요청중)") +
          (g.role_description ? ` · ${g.role_description}` : ""),
        startsOn: g.starts_on,
      });
    } else {
      c.blindCount += 1;
    }
  }
  for (const e of externals ?? []) {
    if (!overlapsDay(from, to, e.starts_at, e.ends_at)) continue;
    ensure(e.expert_id).blindCount += 1;
  }

  return candidates
    .map((c) => ({
      expertId: c.id,
      name: c.name,
      specialty: c.specialty,
      region: c.region,
      careerYears: c.career_years,
      conflict: conflictByExpert.get(c.id) ?? { own: [], blindCount: 0 },
    }))
    .sort((a, b) => {
      // 일정 충돌 없는 후보를 먼저
      const ac = a.conflict.own.length + a.conflict.blindCount;
      const bc = b.conflict.own.length + b.conflict.blindCount;
      if (ac !== bc) return ac - bc;
      return a.name.localeCompare(b.name, "ko");
    });
}

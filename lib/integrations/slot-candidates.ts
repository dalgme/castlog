import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";
import { tagSortWeight } from "./expert-tags";
import { CANDIDATE_LIMIT } from "./candidate-limits";
import {
  blindBucketOf,
  blindConflictWeight,
  emptyBlindConflicts,
  type BlindConflicts,
} from "./schedule-conflicts";

/**
 * 자사에서 같은 날 이미 잡혀 있는 건 — **상세를 공개한다**.
 * 우리 회사 안의 일이므로 어느 사업 어느 세션인지, 언제 어디인지까지 보여 줘야
 * 담당자가 "그래도 이 분으로 갈지"를 판단할 수 있다.
 */
export type OwnConflict = {
  /** 상태 — 배정만 해 둔 것 / 요청 보낸 것 / 수락된 것 */
  kind: "assigned" | "requested" | "accepted";
  projectId: string | null;
  projectName: string | null;
  sessionName: string | null;
  roleDescription: string | null;
  startsOn: string;
  startsTime: string | null;
  endsTime: string | null;
  locationName: string | null;
  /** 지금 채우려는 자리와 다른 사업인가 */
  otherProject: boolean;
};

export type CandidateConflict = {
  /** 자사 섭외·배정과 겹침 — 상세 공개 */
  own: OwnConflict[];
  /**
   * 타사 섭외·전문가 개인 일정과 겹침 — 상태별 건수만(§4 테넌트 격리).
   * '섭외 진행 중(미수락)'과 '확정'을 구분해야 담당자가 판단할 수 있다.
   */
  blind: BlindConflicts;
};

/**
 * 자사 기준 간단 이력 — "우리와 몇 번 했고, 언제였고, 평이 어땠나".
 * 다른 기업에서의 이력은 담지 않는다 (§4 테넌트 격리).
 */
export type CandidateHistory = {
  /** 자사에서 수락(계약 성립)된 섭외 건수 */
  acceptedCount: number;
  /** 가장 최근 자사 섭외 수행일 (YYYY-MM-DD) */
  lastEngagedOn: string | null;
  /** 자사 평가 평균 (10점 만점). 평가가 없으면 null */
  avgScore: number | null;
};

export type SlotCandidate = {
  expertId: string;
  name: string;
  specialty: string | null;
  region: string | null;
  careerYears: number | null;
  conflict: CandidateConflict;
  /** 자사 등급 (favorite/vip/caution). 전문가 본인에게는 노출하지 않는다(§4). */
  tag: string | null;
  tagNote: string | null;
  history: CandidateHistory;
};

export type SlotContext = {
  positionId: string;
  code: string;
  status: string;
  slotDate: string;
  startsTime: string | null;
  endsTime: string | null;
  roleType: string;
  sessionName: string | null;
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
      "id, project_id, slot_date, starts_time, ends_time, role_type, session_name, role_description, fee_amount, location_name, location_address"
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
    sessionName: slot.session_name,
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

  // 후보 상한 — 겹침 판독을 후보 수만큼 수행하므로 무제한으로 두면 화면이 멎는다.
  // 잘렸다는 사실은 화면에 표시한다 (조용한 절단 금지).
  const { data: links } = await supabase
    .from("expert_tenant_links")
    .select("expert_id, status, experts (id, name, specialty, region, career_years)")
    .eq("status", "active")
    .limit(CANDIDATE_LIMIT);

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
      .select(
        "expert_id, tenant_id, role_description, starts_on, ends_on, status, project_id, session_name, starts_time, ends_time, location_name, projects (name)"
      )
      .in("expert_id", ids)
      .in("status", ["requested", "accepted"])
      .not("starts_on", "is", null),
    admin
      .from("expert_external_schedules")
      .select("expert_id, starts_at, ends_at")
      .in("expert_id", ids)
      .eq("shared_with_tenants", true),
  ]);

  // 임의 배정 겹침 — 아직 요청이 나가지 않았어도 우리 회사가 이미 그 날 그
  // 전문가를 쓰기로 정해 둔 자리다. 이걸 안 보여 주면 같은 사람을 두 사업에
  // 배정해 놓고 나중에 한쪽을 취소하게 된다.
  //
  // 두 번에 나눠 읽는다 — 타입 정의에 위치↔세션 관계가 없어 중첩 조회가 안 된다.
  const { data: assignedRows } = await admin
    .from("engagement_slot_positions")
    .select("assigned_expert_id, slot_id")
    .eq("status", "assigned")
    .in("assigned_expert_id", ids);

  const assignedSlotIds = Array.from(
    new Set((assignedRows ?? []).map((a) => a.slot_id))
  );
  const { data: assignedSlots } = assignedSlotIds.length
    ? await admin
        .from("engagement_slots")
        .select(
          "id, tenant_id, project_id, slot_date, starts_time, ends_time, session_name, role_description, location_name"
        )
        .in("id", assignedSlotIds)
        // 다른 회사의 배정은 애초에 담지 않는다 — 배정은 내부 결정이라
        // 상대 회사가 알 이유가 없다 (§4: 건수조차 노출하지 않는다)
        .eq("tenant_id", tenantId)
    : { data: [] };
  const assignedSlotById = new Map(
    (assignedSlots ?? []).map((slot) => [slot.id, slot])
  );

  // 사업명은 따로 읽는다 (타입 정의에 세션↔프로젝트 관계가 없다)
  const assignedProjectIds = Array.from(
    new Set((assignedSlots ?? []).map((slot) => slot.project_id))
  );
  const { data: assignedProjects } = assignedProjectIds.length
    ? await admin.from("projects").select("id, name").in("id", assignedProjectIds)
    : { data: [] };
  const assignedProjectName = new Map(
    (assignedProjects ?? []).map((pr) => [pr.id, pr.name])
  );

  // 자사 등급 태그 — 후보군 정렬·표시에 쓴다 (테넌트 격리)
  const { data: tags } = await admin
    .from("expert_tenant_tags")
    .select("expert_id, tag, note")
    .eq("tenant_id", tenantId)
    .in("expert_id", ids);
  const tagByExpert = new Map(
    (tags ?? []).map((t) => [t.expert_id, { tag: t.tag, note: t.note }])
  );

  // 간단 이력 — 자사 건만. '몇 번 했고 언제였고 평이 어땠나'가 후보를 고를 때
  // 실제로 보는 것이다. 타사 이력은 담지 않는다 (§4).
  const [{ data: pastRows }, { data: evaluationRows }] = await Promise.all([
    admin
      .from("expert_engagements")
      .select("expert_id, starts_on")
      .eq("tenant_id", tenantId)
      .eq("status", "accepted")
      .in("expert_id", ids),
    admin
      .from("expert_evaluations")
      .select("expert_id, score")
      .eq("tenant_id", tenantId)
      .in("expert_id", ids),
  ]);

  const historyByExpert = new Map<string, CandidateHistory>();
  const ensureHistory = (id: string) => {
    let h = historyByExpert.get(id);
    if (!h) {
      h = { acceptedCount: 0, lastEngagedOn: null, avgScore: null };
      historyByExpert.set(id, h);
    }
    return h;
  };
  for (const row of pastRows ?? []) {
    const h = ensureHistory(row.expert_id);
    h.acceptedCount += 1;
    if (row.starts_on && (!h.lastEngagedOn || row.starts_on > h.lastEngagedOn)) {
      h.lastEngagedOn = row.starts_on;
    }
  }
  const scoreSum = new Map<string, { sum: number; count: number }>();
  for (const row of evaluationRows ?? []) {
    if (row.score === null) continue;
    const acc = scoreSum.get(row.expert_id) ?? { sum: 0, count: 0 };
    acc.sum += row.score;
    acc.count += 1;
    scoreSum.set(row.expert_id, acc);
  }
  scoreSum.forEach((acc, id) => {
    if (acc.count > 0) ensureHistory(id).avgScore = acc.sum / acc.count;
  });

  const conflictByExpert = new Map<string, CandidateConflict>();
  const ensure = (id: string) => {
    let c = conflictByExpert.get(id);
    if (!c) {
      c = { own: [], blind: emptyBlindConflicts() };
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
        kind: g.status === "accepted" ? "accepted" : "requested",
        projectId: g.project_id,
        projectName: g.projects?.name ?? null,
        sessionName: g.session_name,
        roleDescription: g.role_description,
        startsOn: g.starts_on,
        startsTime: g.starts_time,
        endsTime: g.ends_time,
        locationName: g.location_name,
        otherProject: g.project_id !== ctx.projectId,
      });
    } else {
      // 타사 건 — 어느 기업인지·무슨 일인지는 절대 담지 않고 상태별 건수만 센다.
      const bucket = blindBucketOf(g.status);
      if (bucket) c.blind[bucket] += 1;
    }
  }
  for (const a of assignedRows ?? []) {
    const slot = assignedSlotById.get(a.slot_id);
    const expertId = a.assigned_expert_id;
    if (!slot || !expertId) continue;
    if (!overlapsDay(from, to, slot.slot_date, slot.slot_date)) continue;
    ensure(expertId).own.push({
      kind: "assigned",
      projectId: slot.project_id,
      projectName: assignedProjectName.get(slot.project_id) ?? null,
      sessionName: slot.session_name,
      roleDescription: slot.role_description,
      startsOn: slot.slot_date,
      startsTime: slot.starts_time,
      endsTime: slot.ends_time,
      locationName: slot.location_name,
      otherProject: slot.project_id !== ctx.projectId,
    });
  }

  for (const e of externals ?? []) {
    if (!overlapsDay(from, to, e.starts_at, e.ends_at)) continue;
    ensure(e.expert_id).blind.personal += 1;
  }

  return candidates
    .map((c) => ({
      expertId: c.id,
      name: c.name,
      specialty: c.specialty,
      region: c.region,
      careerYears: c.career_years,
      conflict: conflictByExpert.get(c.id) ?? { own: [], blind: emptyBlindConflicts() },
      tag: tagByExpert.get(c.id)?.tag ?? null,
      tagNote: tagByExpert.get(c.id)?.note ?? null,
      history: historyByExpert.get(c.id) ?? {
        acceptedCount: 0,
        lastEngagedOn: null,
        avgScore: null,
      },
    }))
    .sort((a, b) => {
      // 1) 일정 충돌 적은 후보 먼저 (미수락 경합은 확정보다 가볍게 본다)
      //    2) VIP·즐겨찾기 우선, 주의는 뒤로 3) 이름순
      const ac = a.conflict.own.length * 2 + blindConflictWeight(a.conflict.blind);
      const bc = b.conflict.own.length * 2 + blindConflictWeight(b.conflict.blind);
      if (ac !== bc) return ac - bc;
      const aw = tagSortWeight(a.tag);
      const bw = tagSortWeight(b.tag);
      if (aw !== bw) return aw - bw;
      return a.name.localeCompare(b.name, "ko");
    });
}

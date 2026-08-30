"use server";

import { roleFromUser } from "@/lib/auth/tenant";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPracticeMode } from "@/lib/practice/server";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { requireUser } from "@/lib/auth/session";
import { getTenantModules } from "@/lib/modules/server";
import {
  getPositionContext,
  getSlotCandidates,
  type SlotCandidate,
  type SlotContext,
} from "@/lib/integrations/slot-candidates";
import { evaluatePlanGate } from "@/lib/integrations/engagement-plans";

/**
 * 섭외 요청 팝업이 열릴 때 필요한 것을 한 번에 가져온다.
 *
 * 후보군 계산은 후보 수만큼 일정 겹침을 판독하므로 가볍지 않다. 화면을 열 때가
 * 아니라 **팝업을 열 때** 부르도록 서버 액션으로 뺀다 — 프로젝트 상세를 여는
 * 것만으로 모든 코드넘버의 후보군을 계산하면 목록 화면이 느려진다.
 */
export type PositionRequestData =
  | {
      ok: true;
      context: SlotContext;
      candidates: SlotCandidate[];
      /** 섭외계획 품의가 필요한데 아직 승인되지 않았다 */
      planBlocked: boolean;
      planMessage: string;
    }
  | { ok: false; error: string };

export async function loadPositionRequestData(
  positionId: string
): Promise<PositionRequestData> {
  const user = await requireUser();
  const role = roleFromUser(user);
  if (!user || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("planInput", user))) {
    return { ok: false, error: await deniedExec("planInput") };
  }

  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  // 가시성은 RLS가 판정한다 — 못 보는 프로젝트의 코드넘버는 여기서 null이 된다
  const context = await getPositionContext(positionId);
  if (!context) return { ok: false, error: "대상을 찾을 수 없습니다." };
  // 배정 상태에서는 다른 전문가로 바꿔 넣을 수 있어야 한다 —
  // 요청이 나간 뒤(requested/filled)에만 잠근다
  if (context.status !== "open" && context.status !== "assigned") {
    return { ok: false, error: "이미 섭외 요청이 나갔거나 확정된 인원입니다." };
  }

  const gate = await evaluatePlanGate(context.projectId, modules.approvals);
  const candidates = await getSlotCandidates(context);

  return {
    ok: true,
    context,
    candidates,
    planBlocked: gate.required && !gate.allowed,
    planMessage: gate.required ? gate.message : "",
  };
}

/**
 * 전문가 탐색·배정 팝업 전면 개편 (기획 확정 2026-08-23).
 * 전문가 메뉴 목록과 같은 정보(연락처·분야·지역·경력·자사평가·등급·메모·상태)를
 * 세션 단위로 한 번에 내려, 다중 선택 → 일괄 후보 등록에 쓴다.
 * 선택 상한 = 이 세션의 미배정 후보 자리 수.
 */
export type SlotPickerExpert = {
  id: string;
  name: string;
  phone: string;
  specialty: string | null;
  region: string | null;
  careerYears: number | null;
  expertise: string[];
  recruit: string[];
  rating: number | null;
  avgScore: string | null;
  tag: string | null;
  noteCount: number;
  linkStatus: "active" | "pending" | "revoked" | "none";
  /** 자사 기준 일정 겹침 건수 (연결 전문가만 계산됨) */
  conflictCount: number;
  /** 이 세션에 이미 후보로 올라가 있다 */
  alreadyInSlot: boolean;
};

export type SlotPickerData =
  | {
      ok: true;
      slotId: string;
      slotLabel: string;
      /** 미배정 후보 자리 수 = 선택 상한 */
      openCount: number;
      experts: SlotPickerExpert[];
      planBlocked: boolean;
      planMessage: string;
    }
  | { ok: false; error: string };

export async function loadSlotPickerData(
  positionId: string
): Promise<SlotPickerData> {
  const user = await requireUser();
  const role = roleFromUser(user);
  if (!user || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("planInput", user))) {
    return { ok: false, error: await deniedExec("planInput") };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  const context = await getPositionContext(positionId);
  if (!context) return { ok: false, error: "대상을 찾을 수 없습니다." };
  if (context.status !== "open" && context.status !== "assigned") {
    return { ok: false, error: "이미 섭외 요청이 나갔거나 확정된 인원입니다." };
  }

  const gate = await evaluatePlanGate(context.projectId, modules.approvals);

  const supabase = createClient();
  const admin = createAdminClient();
  const practice = await isPracticeMode();

  // 이 세션의 자리 현황 — 미배정(open) 자리 수가 선택 상한이다
  const { data: slotRow } = await supabase
    .from("engagement_slot_positions")
    .select("slot_id")
    .eq("id", positionId)
    .maybeSingle();
  if (!slotRow) return { ok: false, error: "세션을 찾을 수 없습니다." };
  const { data: slotPositions } = await supabase
    .from("engagement_slot_positions")
    .select("id, status, expert_id, assigned_expert_id, engagement_id")
    .eq("slot_id", slotRow.slot_id);
  // 선택 상한 = 클릭한 자리 + 아직 비어 있는 자리 (배정된 자리는 덮지 않는다)
  const openCount = (slotPositions ?? []).filter(
    (p) =>
      !p.engagement_id &&
      (p.id === positionId ||
        (p.status === "open" && !p.assigned_expert_id))
  ).length;
  const inSlotExpertIds = new Set(
    (slotPositions ?? [])
      .flatMap((p) => [p.expert_id, p.assigned_expert_id])
      .filter(Boolean) as string[]
  );

  // 전문가 풀 — 전문가 메뉴와 같은 전면 공개 기준 (연습모드는 연결분만)
  const { data: pool } = await admin
    .from("experts")
    .select("id, name, phone, specialty, region, career_years")
    .eq("is_practice", practice)
    .order("created_at", { ascending: false })
    .limit(1000);
  const poolRows = pool ?? [];

  const [
    { data: links },
    { data: tags },
    { data: profiles },
    { data: notes },
    { data: evals },
    { data: expertiseAssign },
    { data: expertiseFields },
    { data: recruitAssign },
    { data: recruitFields },
  ] = await Promise.all([
    // RLS가 자사분으로 좁힌다 — 풀 id 목록을 쿼리스트링에 싣지 않는다(URL 한도)
    supabase.from("expert_tenant_links").select("expert_id, status"),
    supabase.from("expert_tenant_tags").select("expert_id, tag"),
    supabase.from("expert_tenant_profiles").select("expert_id, rating"),
    supabase.from("expert_tenant_notes").select("expert_id"),
    supabase.from("expert_evaluations").select("expert_id, score"),
    admin.from("expert_expertise_fields").select("expert_id, field_id"),
    admin.from("expertise_fields").select("id, name"),
    supabase.from("expert_tenant_recruit_fields").select("expert_id, field_id"),
    supabase.from("tenant_recruit_fields").select("id, name"),
  ]);

  const linkByExpert = new Map<string, string>();
  for (const l of links ?? []) {
    const prev = linkByExpert.get(l.expert_id);
    if (!prev || l.status === "active" || (l.status === "pending" && prev === "revoked")) {
      linkByExpert.set(l.expert_id, l.status);
    }
  }
  const tagByExpert = new Map((tags ?? []).map((t) => [t.expert_id, t.tag]));
  const ratingByExpert = new Map(
    (profiles ?? []).map((p) => [p.expert_id, p.rating])
  );
  const noteCountByExpert = new Map<string, number>();
  for (const n of notes ?? []) {
    noteCountByExpert.set(
      n.expert_id,
      (noteCountByExpert.get(n.expert_id) ?? 0) + 1
    );
  }
  const scoreByExpert = new Map<string, { sum: number; count: number }>();
  for (const row of evals ?? []) {
    if (row.score === null) continue;
    const acc = scoreByExpert.get(row.expert_id) ?? { sum: 0, count: 0 };
    acc.sum += row.score;
    acc.count += 1;
    scoreByExpert.set(row.expert_id, acc);
  }
  const expertiseNameById = new Map(
    (expertiseFields ?? []).map((f) => [f.id, f.name])
  );
  const expertiseByExpert = new Map<string, string[]>();
  for (const a of expertiseAssign ?? []) {
    const name = expertiseNameById.get(a.field_id);
    if (!name) continue;
    const list = expertiseByExpert.get(a.expert_id) ?? [];
    list.push(name);
    expertiseByExpert.set(a.expert_id, list);
  }
  const recruitNameById = new Map(
    (recruitFields ?? []).map((f) => [f.id, f.name])
  );
  const recruitByExpert = new Map<string, string[]>();
  for (const a of recruitAssign ?? []) {
    const name = recruitNameById.get(a.field_id);
    if (!name) continue;
    const list = recruitByExpert.get(a.expert_id) ?? [];
    list.push(name);
    recruitByExpert.set(a.expert_id, list);
  }

  // 일정 겹침 — 연결 전문가만 (기존 후보군 계산 재사용)
  const candidates = await getSlotCandidates(context);
  const conflictByExpert = new Map(
    candidates.map((c) => [c.expertId, c.conflict.own.length])
  );

  // 연습모드는 자사 연결분만 (전문가 메뉴와 동일한 격리)
  const visible = practice
    ? poolRows.filter((e) => linkByExpert.has(e.id))
    : poolRows;

  const timeLabel =
    context.startsTime && context.endsTime
      ? ` ${context.startsTime.slice(0, 5)}~${context.endsTime.slice(0, 5)}`
      : "";

  return {
    ok: true,
    slotId: slotRow.slot_id,
    slotLabel: `${context.slotDate}${timeLabel}${
      context.sessionName ? ` · ${context.sessionName}` : ""
    }`,
    openCount,
    experts: visible.map((e) => ({
      id: e.id,
      name: e.name,
      phone: e.phone,
      specialty: e.specialty,
      region: e.region,
      careerYears: e.career_years,
      expertise: expertiseByExpert.get(e.id) ?? [],
      recruit: recruitByExpert.get(e.id) ?? [],
      rating: ratingByExpert.get(e.id) ?? null,
      avgScore: (() => {
        const acc = scoreByExpert.get(e.id);
        return acc && acc.count > 0 ? (acc.sum / acc.count).toFixed(1) : null;
      })(),
      tag: tagByExpert.get(e.id) ?? null,
      noteCount: noteCountByExpert.get(e.id) ?? 0,
      linkStatus:
        (linkByExpert.get(e.id) as "active" | "pending" | "revoked" | undefined) ??
        "none",
      conflictCount: conflictByExpert.get(e.id) ?? 0,
      alreadyInSlot: inSlotExpertIds.has(e.id),
    })),
    planBlocked: gate.required && !gate.allowed,
    planMessage: gate.required ? gate.message : "",
  };
}

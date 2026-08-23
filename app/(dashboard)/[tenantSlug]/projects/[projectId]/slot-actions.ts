"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireExecGrade } from "@/lib/auth/exec-gate";
import { buildSlotCode } from "@/lib/integrations/slot-codes";

export type SlotResult = { ok: true } | { ok: false; error: string };

/** 세션 계획·후보 입력 = 레벨 5까지 (기획 확정 2026-08-23 — 차등화) */
async function requireManager(): Promise<
  { ok: true; userId: string; tenantId: string } | { ok: false; error: string }
> {
  return requireExecGrade("planInput");
}

const slotSchema = z
  .object({
    slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 입력하세요."),
    startsTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
    endsTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
    roleType: z.enum([
      "host",
      "lecturer",
      "mentor",
      "judge",
      "announcer",
      "assistant",
      "other",
    ]),
    sessionName: z.string().trim().max(120).optional(),
    roleDescription: z.string().trim().max(100).optional(),
    requiredCount: z.number().int().min(1, "필요 인원은 1명 이상").max(100),
    feeAmount: z.string().regex(/^\d*$/, "비용은 숫자만 입력하세요.").optional(),
    locationName: z.string().trim().max(150).optional(),
    locationAddress: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) => !v.startsTime || !v.endsTime || v.startsTime < v.endsTime,
    { message: "종료 시각은 시작 시각 이후여야 합니다.", path: ["endsTime"] }
  );

/**
 * 타임테이블 슬롯 생성 + 필요인원만큼 넘버링코드 자동 부여.
 * 코드는 테넌트 내 유일해야 하므로 충돌 시 접미사를 붙여 재시도한다.
 */
export async function createSlot(
  projectId: string,
  input: z.input<typeof slotSchema>
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const parsed = slotSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { data: slot, error } = await supabase
    .from("engagement_slots")
    .insert({
      tenant_id: auth.tenantId,
      project_id: projectId,
      slot_date: d.slotDate,
      starts_time: d.startsTime || null,
      ends_time: d.endsTime || null,
      role_type: d.roleType,
      session_name: d.sessionName || null,
      role_description: d.roleDescription || null,
      required_count: d.requiredCount,
      fee_amount: d.feeAmount ? parseInt(d.feeAmount, 10) : null,
      location_name: d.locationName || null,
      location_address: d.locationAddress || null,
      notes: d.notes || null,
      created_by: auth.userId,
    })
    .select("id")
    .single();
  if (error || !slot) return { ok: false, error: "슬롯 생성에 실패했습니다." };

  // 후보 순위 모델 (개정 2026-08-22): 임시후보 코드를 기본 3개 발급한다
  // (필요인원이 3명을 넘으면 필요인원만큼). 후보는 이후 추가할 수 있다.
  const candidateCount = Math.max(3, d.requiredCount);
  const positionError = await createPositions(
    supabase,
    auth.tenantId,
    slot.id,
    d.slotDate,
    d.roleType,
    1,
    candidateCount
  );
  if (positionError) {
    await supabase.from("engagement_slots").delete().eq("id", slot.id);
    return { ok: false, error: positionError };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 넘버링코드 부여 — 충돌 시 짧은 접미사로 재시도(테넌트 내 유일). */
async function createPositions(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  slotId: string,
  slotDate: string,
  roleType: string,
  fromNo: number,
  toNo: number
): Promise<string | null> {
  for (let no = fromNo; no <= toNo; no++) {
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const suffix =
        attempt === 0
          ? undefined
          : crypto.randomUUID().replace(/-/g, "").slice(0, 3).toUpperCase();
      const code = buildSlotCode(slotDate, roleType, no, suffix);
      const { error } = await supabase.from("engagement_slot_positions").insert({
        tenant_id: tenantId,
        slot_id: slotId,
        position_no: no,
        rank: no, // 초기 순위 = 발급 순번 (드래그로 조정)
        code,
      });
      if (!error) inserted = true;
      else if (error.code !== "23505") return "넘버링코드 생성에 실패했습니다.";
    }
    if (!inserted) return "넘버링코드가 중복되어 생성하지 못했습니다.";
  }
  return null;
}

/**
 * 세션 수정 (기획 확정 2026-08-23) — 일정·세션명·역할·장소.
 * 필요인원은 코드 발급이 얽혀 adjustSlotCount 경로로만 바꾼다.
 * feeAmount·locationAddress·notes는 스키마 재사용 관계로 받지만 쓰지 않는다
 * — 비용은 후보별 예정가로 관리(개정 2026-08-22).
 * 승인된 계획 이후의 수정은 계획 서명(signature) 불일치로 잡혀
 * '변경 상신(재승인)'이 활성화된다 — 변경은 감사로그에 남긴다.
 */
export async function updateSlot(
  slotId: string,
  input: Omit<z.input<typeof slotSchema>, "requiredCount">
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireExecGrade("planInput");
  if (!auth.ok) return auth;

  const parsed = slotSchema.safeParse({ ...input, requiredCount: 1 });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { data: before } = await supabase
    .from("engagement_slots")
    .select(
      "id, project_id, slot_date, starts_time, ends_time, role_type, session_name, role_description, location_name"
    )
    .eq("id", slotId)
    .maybeSingle();
  if (!before) return { ok: false, error: "세션을 찾을 수 없습니다." };

  const { error } = await supabase
    .from("engagement_slots")
    .update({
      slot_date: d.slotDate,
      starts_time: d.startsTime || null,
      ends_time: d.endsTime || null,
      role_type: d.roleType,
      session_name: d.sessionName || null,
      role_description: d.roleDescription || null,
      location_name: d.locationName || null,
    })
    .eq("id", slotId);
  if (error) return { ok: false, error: "세션 수정에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "engagement_slot.update",
    resource_type: "engagement_slot",
    resource_id: slotId,
    before_data: {
      slot_date: before.slot_date,
      starts_time: before.starts_time,
      ends_time: before.ends_time,
      session_name: before.session_name,
      role_type: before.role_type,
      role_description: before.role_description,
      location_name: before.location_name,
    },
    after_data: {
      slot_date: d.slotDate,
      starts_time: d.startsTime || null,
      ends_time: d.endsTime || null,
      session_name: d.sessionName || null,
      role_type: d.roleType,
      role_description: d.roleDescription || null,
      location_name: d.locationName || null,
    },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 슬롯 삭제 — 섭외 요청이 연결된 인원이 있으면 막는다(§14-4 되돌리기 보호). */
export async function deleteSlot(slotId: string): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: linked } = await supabase
    .from("engagement_slot_positions")
    .select("id")
    .eq("slot_id", slotId)
    .not("engagement_id", "is", null)
    .limit(1);
  if (linked && linked.length > 0) {
    return {
      ok: false,
      error: "이미 섭외를 요청한 인원이 있어 삭제할 수 없습니다. 개별 취소 후 진행하세요.",
    };
  }

  const { error } = await supabase.from("engagement_slots").delete().eq("id", slotId);
  if (error) return { ok: false, error: "삭제에 실패했습니다." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 필요 인원 증감 — 증가 시 코드 추가 부여, 감소는 미섭외 인원만 제거. */
export async function adjustSlotCount(
  slotId: string,
  nextCount: number
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;
  if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > 100) {
    return { ok: false, error: "필요 인원은 1~100명으로 입력하세요." };
  }

  const supabase = createClient();
  const { data: slot } = await supabase
    .from("engagement_slots")
    .select("id, slot_date, role_type, required_count")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot) return { ok: false, error: "슬롯을 찾을 수 없습니다." };

  // 후보 순위 모델: 필요인원은 '실제 섭외 인원 수'일 뿐, 후보 수와 분리다.
  // 늘릴 때 후보가 부족하면 그만큼 임시후보 코드를 추가 발급하고,
  // 줄일 때는 후보를 지우지 않는다(초과 후보는 예비 후보로 남는다).
  const { count: candidateCount } = await supabase
    .from("engagement_slot_positions")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", slotId)
    .neq("status", "canceled");
  const existing = candidateCount ?? 0;
  if (nextCount > existing) {
    const { data: maxRow } = await supabase
      .from("engagement_slot_positions")
      .select("position_no")
      .eq("slot_id", slotId)
      .order("position_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    const from = (maxRow?.position_no ?? 0) + 1;
    const err = await createPositions(
      supabase,
      auth.tenantId,
      slotId,
      slot.slot_date,
      slot.role_type,
      from,
      from + (nextCount - existing) - 1
    );
    if (err) return { ok: false, error: err };
  }

  const { error } = await supabase
    .from("engagement_slots")
    .update({ required_count: nextCount })
    .eq("id", slotId);
  if (error) return { ok: false, error: "인원 변경에 실패했습니다." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 프로젝트 총 예산 설정 (권한자만). */
export async function updateProjectBudget(
  projectId: string,
  budgetAmount: string
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  // 예산은 금액 축 — 레벨 3까지 유지 (세션 입력과 구분, 기획 확정 2026-08-23)
  const auth = await requireExecGrade("projectBudget");
  if (!auth.ok) return auth;
  if (!/^\d*$/.test(budgetAmount)) {
    return { ok: false, error: "예산은 숫자만 입력하세요 (원 단위)." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("projects")
    .update({
      budget_amount: budgetAmount ? parseInt(budgetAmount, 10) : null,
    })
    .eq("id", projectId);
  if (error) return { ok: false, error: "예산 저장에 실패했습니다." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/**
 * 후보 추가 (기획 확정 2026-08-22) — 임시후보 코드를 1개 더 발급한다.
 * 순위는 맨 뒤로 붙는다(드래그로 조정).
 */
export async function addCandidate(slotId: string): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: slot } = await supabase
    .from("engagement_slots")
    .select("id, slot_date, role_type")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot) return { ok: false, error: "세션을 찾을 수 없습니다." };

  const { data: maxRow } = await supabase
    .from("engagement_slot_positions")
    .select("position_no")
    .eq("slot_id", slotId)
    .order("position_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const no = (maxRow?.position_no ?? 0) + 1;
  if (no > 100) return { ok: false, error: "후보는 세션당 최대 100명입니다." };

  const err = await createPositions(
    supabase,
    auth.tenantId,
    slotId,
    slot.slot_date,
    slot.role_type,
    no,
    no
  );
  if (err) return { ok: false, error: err };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 후보 삭제 — 섭외 요청이 나가기 전(open/assigned)의 후보만 지울 수 있다. */
export async function removeCandidate(positionId: string): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: removed, error } = await supabase
    .from("engagement_slot_positions")
    .delete()
    .eq("id", positionId)
    .in("status", ["open", "assigned"])
    .is("engagement_id", null)
    .select("id")
    .maybeSingle();
  if (error || !removed) {
    return {
      ok: false,
      error: "이미 섭외가 진행된 후보는 삭제할 수 없습니다. 개별 취소 후 진행하세요.",
    };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 후보 순위 저장 — 드래그로 정한 순서(위→아래 = 1순위→후순위)를 기록한다. */
export async function reorderCandidates(
  slotId: string,
  orderedPositionIds: string[]
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;
  if (!Array.isArray(orderedPositionIds) || orderedPositionIds.length === 0) {
    return { ok: false, error: "순서가 비어 있습니다." };
  }

  const supabase = createClient();
  // 대상 검증 — 이 세션의 후보만 (다른 세션·타 프로젝트 id 섞임 방지)
  const { data: rows } = await supabase
    .from("engagement_slot_positions")
    .select("id")
    .eq("slot_id", slotId);
  const valid = new Set((rows ?? []).map((r) => r.id));
  const ids = orderedPositionIds.filter((id) => valid.has(id));
  if (ids.length !== valid.size) {
    return { ok: false, error: "후보 목록이 갱신되었습니다. 새로고침 후 다시 시도하세요." };
  }

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const { error } = await supabase
      .from("engagement_slot_positions")
      .update({ rank: i + 1 })
      .eq("id", id);
    if (error) return { ok: false, error: "순위 저장에 실패했습니다." };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 후보별 예정가 저장 — 예정가이며 결재·정산 전까지 수정할 수 있다. */
export async function setCandidateFee(
  positionId: string,
  fee: string
): Promise<SlotResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;
  if (!/^\d*$/.test(fee)) {
    return { ok: false, error: "예정가는 숫자만 입력하세요 (원 단위)." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("engagement_slot_positions")
    .update({ expected_fee: fee ? parseInt(fee, 10) : null })
    .eq("id", positionId);
  if (error) return { ok: false, error: "예정가 저장에 실패했습니다." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
